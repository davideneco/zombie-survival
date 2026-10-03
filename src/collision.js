// Collisions cercle (joueur / zombie) contre des segments (murs de bâtiments,
// côtés de caisses) et des cercles (arbres, lampadaires). Accélérées par une grille.
export class Collision {
  constructor(half, cell = 4) {
    this.half = half;
    this.cell = cell;
    this.segs = [];
    this.circles = [];
    this.grid = new Map();
    this.stamp = 0;
  }

  addSegment(ax, az, bx, bz) { this.segs.push({ ax, az, bx, bz, stamp: 0 }); }

  addCircle(x, z, r) { this.circles.push({ x, z, r, stamp: 0 }); }

  // Boîte orientée (caisses, voitures, barrières) = 4 segments
  addBox(x, z, w, d, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      this.addSegment(a[0], a[1], b[0], b[1]);
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
            if (it.stamp === this.stamp) continue;
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
    const lim = this.half - radius;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }
}
