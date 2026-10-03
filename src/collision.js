// Collisions cercle (joueur / zombie) contre des segments (murs de bâtiments,
// côtés de caisses) et des cercles (arbres, lampadaires). Accélérées par une grille.
export class Collision {
  constructor(halfX, halfZ = halfX, cell = 4) {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.cell = cell;
    this.segs = [];
    this.circles = [];
    this.grid = new Map();
    this.stamp = 0;
  }

  // h : hauteur de l'obstacle (les balles passent au-dessus). off : obstacle désactivé (porte ouverte).
  addSegment(ax, az, bx, bz, h = Infinity) {
    const s = { ax, az, bx, bz, h, off: false, stamp: 0 };
    this.segs.push(s);
    return s;
  }

  addCircle(x, z, r, h = 4) { this.circles.push({ x, z, r, h, off: false, stamp: 0 }); }

  // Boîte orientée (caisses, voitures, barrières) = 4 segments
  addBox(x, z, w, d, rot = 0, h = Infinity) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      this.addSegment(a[0], a[1], b[0], b[1], h);
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
  resolve(pos, radius) {
    const c = this.cell;
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
            let cx, cz, rr = radius;
            if (it.r !== undefined) {
              cx = it.x; cz = it.z; rr += it.r;
              const dx = pos.x - cx, dz = pos.z - cz;
              const d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-8) {
                const d = Math.sqrt(d2), push = rr - d;
                pos.x += (dx / d) * push; pos.z += (dz / d) * push;
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
              }
            }
          }
        }
      }
    }
    const limX = this.halfX - radius, limZ = this.halfZ - radius;
    pos.x = Math.max(-limX, Math.min(limX, pos.x));
    pos.z = Math.max(-limZ, Math.min(limZ, pos.z));
  }

  // Lancer de rayon 3D contre les obstacles (murs, arbres, voitures) + le sol.
  // Retourne la distance t (en mètres) du premier obstacle, ou maxT. Remplace le raycast sur les maillages
  // de bâtiments, beaucoup trop lent avec plusieurs milliers de bâtiments.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    if (dy < -1e-6) best = Math.min(best, oy / -dy); // sol
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
            if (y >= 0 && y <= it.h) best2d = t;
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
