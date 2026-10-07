// Collisions cercle (joueur / zombie) contre des segments (murs de bâtiments,
// côtés de caisses) et des cercles (arbres, lampadaires). Accélérées par une grille.
export class Collision {
  constructor(halfX, halfZ = halfX, cell = 4) {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.cell = cell;
    this.segs = [];
    this.circles = [];
    this.floors = [];
    this.grid = new Map();
    this.stamp = 0;
  }

  // h : hauteur du dessus de l'obstacle (les balles passent au-dessus) ; y0 : hauteur du dessous (obstacles d'étage :
  // garde-corps d'un balcon, mur d'une tour…). off : obstacle désactivé (porte ouverte).
  // kind : nature de l'obstacle pour les dégâts des motos : 'wall' (architecture : façade, quai, parapet, porte payante ou
  // scellée, marche : la moto ne s'abîme pas) ou 'prop' (objet physique : voiture, mobilier, arbre, machine… : elle s'abîme).
  // addSegment = 'wall' par défaut ; addCircle et addBox = 'prop' par défaut.
  addSegment(ax, az, bx, bz, h = Infinity, y0 = -Infinity, kind = 'wall') {
    const s = { ax, az, bx, bz, h, y0, kind, off: false, stamp: 0 };
    this.segs.push(s);
    return s;
  }

  addCircle(x, z, r, h = 4, y0 = -Infinity, kind = 'prop') { const c = { x, z, r, h, y0, kind, off: false, stamp: 0 }; this.circles.push(c); return c; }

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
    return it.h === Infinity || y < Math.max(it.h - 0.35, 1.35);
  }

  // Boîte orientée (caisses, voitures, barrières) = 4 segments
  addBox(x, z, w, d, rot = 0, h = Infinity, y0 = -Infinity, kind = 'prop') {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      this.addSegment(a[0], a[1], b[0], b[1], h, y0, kind);
    }
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
  resolve(pos, radius, out = null) {
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
