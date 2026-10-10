// Collisions cercle (joueur / zombie) contre des segments (murs de bâtiments,
// côtés de caisses) et des cercles (arbres, lampadaires). Accélérées par une grille.
const WALK_OVER = 0.3;      // un obstacle au sol de cette hauteur ou moins (palette) ne bloque pas : on marche dessus
const VAULT_MAX_H = 1.15;   // hauteur maximale d'un obstacle enjambable (m)
export class Collision {
  constructor(halfX, halfZ = halfX, cell = 4) {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.cell = cell;
    this.segs = [];
    this.circles = [];
    this.floors = [];
    this.vaults = [];   // obstacles enjambables : { id, h, segs | circle }
    this.dyn = new Map(); // obstacles DYNAMIQUES (v0.39.0) : clé -> { boxes } ; boîtes orientées qui bougent (rames du tram), mises à jour par leur propriétaire
    this.grid = new Map();
    this.stamp = 0;
  }

  // h : hauteur du dessus de l'obstacle (les balles passent au-dessus) ; y0 : hauteur du dessous (obstacles d'étage :
  // garde-corps d'un balcon, mur d'une tour…). off : obstacle désactivé (porte ouverte).
  // kind : nature de l'obstacle pour les dégâts des motos : 'wall' (architecture : façade, quai, parapet, porte payante ou
  // scellée, marche : la moto ne s'abîme pas) ou 'prop' (objet physique : voiture, mobilier, arbre, machine… : elle s'abîme).
  // addSegment = 'wall' par défaut ; addCircle et addBox = 'prop' par défaut.
  addSegment(ax, az, bx, bz, h = Infinity, y0 = -Infinity, kind = 'wall', vid = 0) {
    const s = { ax, az, bx, bz, h, y0, kind, vid, off: false, stamp: 0 };
    this.segs.push(s);
    return s;
  }

  // vault (v0.33.0) : obstacle que le joueur peut enjamber (Espace, voir findVault) : hauteur <= 1,15 m
  addCircle(x, z, r, h = 4, y0 = -Infinity, kind = 'prop', vault = false) {
    const c = { x, z, r, h, y0, kind, vid: 0, off: false, stamp: 0 };
    if (vault) { c.vid = this.vaults.length + 1; this.vaults.push({ id: c.vid, h, circle: c }); }
    this.circles.push(c);
    return c;
  }

  // Obstacles dynamiques : liste de boîtes orientées { x, z, w, d, rot, h } (même convention qu'addBox : w le long de (cos rot, sin rot)), remplacée à chaque
  // appel pour la clé donnée. Ils repoussent les cercles de resolve() (joueurs, zombies, motos) mais ne sont pas dans la grille : les balles et les rayons
  // de caméra les traversent. `kind` : nature pour les dégâts des motos ('prop' : un objet physique).
  setDynamic(key, boxes, kind = 'prop') {
    let e = this.dyn.get(key);
    if (!e) this.dyn.set(key, e = { boxes: [], kind });
    e.boxes.length = 0;
    for (const b of boxes) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), hx = b.w / 2, hz = b.d / 2;
      e.boxes.push({ x: b.x, z: b.z, hx, hz, c, s, h: b.h ?? 3.4, r2: (Math.hypot(hx, hz) + 1.2) ** 2 });
    }
  }
  clearDynamic(key) { this.dyn.delete(key); }

  // Dalles horizontales (planchers des étages) qui arrêtent les balles : triangles [ax,az,bx,bz,cx,cz] à la hauteur y
  addFloor(y, tris) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const t of tris) for (let i = 0; i < 6; i += 2) { minX = Math.min(minX, t[i]); maxX = Math.max(maxX, t[i]); minZ = Math.min(minZ, t[i + 1]); maxZ = Math.max(maxZ, t[i + 1]); }
    this.floors.push({ y, tris, minX, maxX, minZ, maxZ });
  }

  // Cet obstacle gêne-t-il un corps dont les pieds sont à la hauteur y ?
  //  - obstacle posé au sol : il bloque tant qu'on est en dessous de son sommet (au moins 1,35 m : on ne saute pas par-dessus un banc)
  //  - obstacle d'étage (y0 fini) : il bloque entre son dessous et son dessus
  _blocks(it, y) {
    if (it.y0 > -Infinity) return y + 1.7 > it.y0 && y < it.h - 0.3;
    if (it.h <= WALK_OVER) return false; // palette, câble au sol… : on marche dessus
    return it.h === Infinity || y < Math.max(it.h - 0.35, 1.35);
  }

  // Boîte orientée (caisses, voitures, barrières) = 4 segments
  addBox(x, z, w, d, rot = 0, h = Infinity, y0 = -Infinity, kind = 'prop', vault = false) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
    const vid = vault ? this.vaults.length + 1 : 0, segs = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      segs.push(this.addSegment(a[0], a[1], b[0], b[1], h, y0, kind, vid));
    }
    if (vault) this.vaults.push({ id: vid, h, segs });
  }

  // Enjambement : depuis (ox, oz) en regardant dans la direction (ux, uz) unitaire, y a-t-il un obstacle enjambable à moins de reach m ?
  // Renvoie { v, tIn, tOut, nx, nz } (distances le long du rayon ; n : normale de la face d'entrée) ou null. Les obstacles non enjambables
  // (voiture, mur…) placés avant lui l'emportent : le rayon doit atteindre l'obstacle sans rien rencontrer d'autre.
  findVault(ox, oz, ux, uz, reach, out = {}) {
    if (!this.vaults.length) return null;
    const c = this.cell, x0 = Math.floor((ox - reach) / c), x1 = Math.floor((ox + reach) / c), z0 = Math.floor((oz - reach) / c), z1 = Math.floor((oz + reach) / c);
    let best = null;
    this.stamp++;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = this.grid.get(this._key(ix, iz));
      if (!arr) continue;
      for (const it of arr) {
        if (!it.vid || it.stamp === this.stamp || it.off) continue;
        it.stamp = this.stamp;
        const v = this.vaults[it.vid - 1];
        if (!v || v.h > VAULT_MAX_H) continue;
        let tIn = Infinity, tOut = -Infinity, nx = 0, nz = 0;
        if (v.circle) {
          const cc = v.circle, fx = cc.x - ox, fz = cc.z - oz, proj = fx * ux + fz * uz, d2 = fx * fx + fz * fz - proj * proj;
          if (d2 >= cc.r * cc.r || proj <= 0) continue;
          const hw = Math.sqrt(cc.r * cc.r - d2);
          tIn = proj - hw; tOut = proj + hw;
          const px = ox + ux * tIn - cc.x, pz = oz + uz * tIn - cc.z, l = Math.hypot(px, pz) || 1; nx = px / l; nz = pz / l;
        } else {
          for (const sg of v.segs) {
            const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, den = ux * ez - uz * ex;
            if (Math.abs(den) < 1e-9) continue;
            const ax = sg.ax - ox, az = sg.az - oz, tt = (ax * ez - az * ex) / den, uu = (ax * uz - az * ux) / den;
            if (uu < 0 || uu > 1 || tt < 0) continue;
            if (tt < tIn) { tIn = tt; const l = Math.hypot(ex, ez) || 1; nx = ez / l; nz = -ex / l; if (nx * ux + nz * uz > 0) { nx = -nx; nz = -nz; } } // normale tournée vers l'expéditeur
            if (tt > tOut) tOut = tt;
          }
          if (tIn === Infinity) continue;
          if (tOut - tIn < 0.05) tOut = tIn + 0.05;
        }
        if (tIn > reach || tIn >= (best ? best.tIn : Infinity)) continue;
        best = { v, tIn, tOut, nx, nz };
      }
    }
    if (!best) return null;
    return Object.assign(out, best);
  }

  _key(ix, iz) { return ix * 4096 + iz; }

  _insert(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(item);
      }
    }
  }

  // À appeler après tous les add*()
  build() {
    this.grid.clear();
    for (const s of this.segs) {
      this._insert(s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz));
    }
    for (const c of this.circles) this._insert(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  }

  // Pousse `pos` (x,z) hors des obstacles et le garde dans la zone de jeu.
  // out (facultatif) : reçoit la poussée la plus forte { kind: 'wall' | 'prop' | null, push, nx, nz } (normale unitaire vers l'extérieur) ;
  // le bord de la zone de jeu compte comme un mur.
  // ignore : clé d'un obstacle dynamique à ne pas compter (ses propres occupants)
  resolve(pos, radius, out = null, ignore = null) {
    const c = this.cell, py = pos.y || 0;
    let bestPush = 0, bestKind = null, bnx = 0, bnz = 0;
    for (let pass = 0; pass < 2; pass++) {
      this.stamp++;
      const x0 = Math.floor((pos.x - radius) / c), x1 = Math.floor((pos.x + radius) / c);
      const z0 = Math.floor((pos.z - radius) / c), z1 = Math.floor((pos.z + radius) / c);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const arr = this.grid.get(this._key(ix, iz));
          if (!arr) continue;
          for (const it of arr) {
            if (it.stamp === this.stamp || it.off) continue;
            it.stamp = this.stamp;
            if (!this._blocks(it, py)) continue;
            let cx, cz, rr = radius;
            if (it.r !== undefined) {
              cx = it.x; cz = it.z; rr += it.r;
              const dx = pos.x - cx, dz = pos.z - cz;
              const d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-8) {
                const d = Math.sqrt(d2), push = rr - d;
                pos.x += (dx / d) * push; pos.z += (dz / d) * push;
                if (push > bestPush) { bestPush = push; bestKind = it.kind; bnx = dx / d; bnz = dz / d; }
              }
            } else {
              const abx = it.bx - it.ax, abz = it.bz - it.az;
              const len2 = abx * abx + abz * abz;
              let t = len2 > 0 ? ((pos.x - it.ax) * abx + (pos.z - it.az) * abz) / len2 : 0;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              cx = it.ax + abx * t; cz = it.az + abz * t;
              const dx = pos.x - cx, dz = pos.z - cz;
              const d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-8) {
                const d = Math.sqrt(d2), push = rr - d;
                pos.x += (dx / d) * push; pos.z += (dz / d) * push;
                if (push > bestPush) { bestPush = push; bestKind = it.kind; bnx = dx / d; bnz = dz / d; }
              }
            }
          }
        }
      }
    }
    // obstacles dynamiques (rames) : le point le plus proche de la boîte, dans son repère ; au centre, on sort par la face la plus proche
    if (this.dyn.size) {
      for (const [key, e] of this.dyn) {
        if (key === ignore) continue;
        for (const b of e.boxes) {
          if (py >= b.h - 0.3) continue;
          const dx = pos.x - b.x, dz = pos.z - b.z;
          if (dx * dx + dz * dz > b.r2 + radius * radius + 2 * radius) continue;
          const lx = b.c * dx + b.s * dz, lz = -b.s * dx + b.c * dz;
          const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
          const ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez;
          if (d2 >= radius * radius) continue;
          let nx, nz, push;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); push = radius - d; nx = ex / d; nz = ez / d; }
          else if (b.hx - Math.abs(lx) < b.hz - Math.abs(lz)) { nx = lx < 0 ? -1 : 1; nz = 0; push = b.hx - Math.abs(lx) + radius; }
          else { nx = 0; nz = lz < 0 ? -1 : 1; push = b.hz - Math.abs(lz) + radius; }
          const wx = b.c * nx - b.s * nz, wz = b.s * nx + b.c * nz; // normale en repère monde
          pos.x += wx * push; pos.z += wz * push;
          if (push > bestPush) { bestPush = push; bestKind = e.kind; bnx = wx; bnz = wz; }
        }
      }
    }
    const limX = this.halfX - radius, limZ = this.halfZ - radius;
    const qx = Math.max(-limX, Math.min(limX, pos.x)), qz = Math.max(-limZ, Math.min(limZ, pos.z));
    if (out) {
      const edge = Math.hypot(qx - pos.x, qz - pos.z);
      if (edge > bestPush) { bestPush = edge; bestKind = 'wall'; bnx = (qx - pos.x) / edge; bnz = (qz - pos.z) / edge; }
      out.kind = bestKind; out.push = bestPush; out.nx = bnx; out.nz = bnz;
    }
    pos.x = qx; pos.z = qz;
  }

  // Lancer de rayon 3D contre les obstacles (murs, arbres, voitures) + le sol.
  // Retourne la distance t (en mètres) du premier obstacle, ou maxT. Remplace le raycast sur les maillages
  // de bâtiments, beaucoup trop lent avec plusieurs milliers de bâtiments.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    if (dy < -1e-6 && oy > 0) best = Math.min(best, oy / -dy); // sol
    for (const f of this.floors) { // planchers : la balle les traverse seulement par les trous (escaliers)
      if (Math.abs(dy) < 1e-6) break;
      const t = (f.y - oy) / dy;
      if (t <= 0.02 || t >= best) continue;
      const px = ox + dx * t, pz = oz + dz * t;
      if (px < f.minX || px > f.maxX || pz < f.minZ || pz > f.maxZ) continue;
      for (const tr of f.tris) {
        const d1 = (px - tr[2]) * (tr[1] - tr[3]) - (tr[0] - tr[2]) * (pz - tr[3]);
        const d2 = (px - tr[4]) * (tr[3] - tr[5]) - (tr[2] - tr[4]) * (pz - tr[5]);
        const d3 = (px - tr[0]) * (tr[5] - tr[1]) - (tr[4] - tr[0]) * (pz - tr[1]);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { best = t; break; }
      }
    }
    const h2 = Math.hypot(dx, dz);
    if (h2 < 1e-9) return best;
    const ux = dx / h2, uz = dz / h2; // direction horizontale unitaire ; la distance 3D = t2d / h2
    const range2d = best * h2;
    const c = this.cell;
    let ix = Math.floor(ox / c), iz = Math.floor(oz / c);
    const sx = ux > 0 ? 1 : -1, sz = uz > 0 ? 1 : -1;
    const tdx = Math.abs(ux) > 1e-9 ? Math.abs(c / ux) : Infinity, tdz = Math.abs(uz) > 1e-9 ? Math.abs(c / uz) : Infinity;
    let tx = Math.abs(ux) > 1e-9 ? ((ux > 0 ? (ix + 1) * c - ox : ox - ix * c)) / Math.abs(ux) : Infinity;
    let tz = Math.abs(uz) > 1e-9 ? ((uz > 0 ? (iz + 1) * c - oz : oz - iz * c)) / Math.abs(uz) : Infinity;
    this.stamp++;
    let best2d = range2d;
    for (let guard = 0; guard < 4000; guard++) {
      const arr = this.grid.get(this._key(ix, iz));
      if (arr) {
        for (const it of arr) {
          if (it.stamp === this.stamp || it.off) continue;
          it.stamp = this.stamp;
          let t = -1;
          if (it.r !== undefined) { // cercle
            const fx = it.x - ox, fz = it.z - oz;
            const proj = fx * ux + fz * uz;
            const d2 = fx * fx + fz * fz - proj * proj;
            if (d2 < it.r * it.r && proj > 0) t = proj - Math.sqrt(it.r * it.r - d2);
          } else { // segment
            const ex = it.bx - it.ax, ez = it.bz - it.az;
            const den = ux * ez - uz * ex;
            if (Math.abs(den) > 1e-9) {
              const ax = it.ax - ox, az = it.az - oz;
              const tt = (ax * ez - az * ex) / den;
              const uu = (ax * uz - az * ux) / den;
              if (tt > 0 && uu >= 0 && uu <= 1) t = tt;
            }
          }
          if (t > 0 && t < best2d) {
            const y = oy + dy * (t / h2);
            if (y >= it.y0 && y <= it.h) best2d = t;
          }
        }
      }
      const tNext = Math.min(tx, tz);
      if (tNext > best2d) break;
      if (tx < tz) { tx += tdx; ix += sx; } else { tz += tdz; iz += sz; }
    }
    return best2d / h2;
  }
}
