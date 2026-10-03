// Grille de navigation + champ de flux (flow field) : calcule, pour chaque case,
// la distance de marche jusqu'au joueur. Les zombies descendent ce gradient, ce qui
// leur permet de contourner les bâtiments dans les rues étroites.
const INF = 0x3fffffff;

export class NavGrid {
  constructor(half, collision, polygons, cell = 0.5, margin = 0.5) {
    this.half = half;
    this.cell = cell;
    this.n = Math.round((half * 2) / cell);
    this.margin = margin;
    this.col = collision;
    this.polys = polygons; // [{pts:[[x,z],...]}]
    this.blocked = new Uint8Array(this.n * this.n);
    this.dist = new Int32Array(this.n * this.n).fill(INF);
    this.lastTarget = -1;
  }

  // ---- conversions ----
  cx(x) { return Math.floor((x + this.half) / this.cell); }
  cz(z) { return Math.floor((z + this.half) / this.cell); }
  idx(ix, iz) { return iz * this.n + ix; }
  inside(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.n && iz < this.n; }
  worldX(ix) { return (ix + 0.5) * this.cell - this.half; }
  worldZ(iz) { return (iz + 0.5) * this.cell - this.half; }

  isBlockedAt(x, z) {
    const ix = this.cx(x), iz = this.cz(z);
    return !this.inside(ix, iz) || this.blocked[this.idx(ix, iz)] === 1;
  }

  // ---- construction de la grille d'obstacles ----
  build() {
    const { n, cell, half, margin } = this;
    const b = this.blocked;
    b.fill(0);

    // 1) intérieur des bâtiments
    for (const poly of this.polys) {
      const pts = poly.pts;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const ix0 = Math.max(0, this.cx(minX)), ix1 = Math.min(n - 1, this.cx(maxX));
      const iz0 = Math.max(0, this.cz(minZ)), iz1 = Math.min(n - 1, this.cz(maxZ));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          if (pointInPoly(this.worldX(ix), this.worldZ(iz), pts)) b[this.idx(ix, iz)] = 1;
        }
      }
    }

    // 2) marge autour de tous les segments et cercles (rayon du zombie)
    const mark = (ax, az, bx, bz, r) => {
      const ix0 = Math.max(0, this.cx(Math.min(ax, bx) - r)), ix1 = Math.min(n - 1, this.cx(Math.max(ax, bx) + r));
      const iz0 = Math.max(0, this.cz(Math.min(az, bz) - r)), iz1 = Math.min(n - 1, this.cz(Math.max(az, bz) + r));
      const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = this.worldX(ix), pz = this.worldZ(iz);
          let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
          if (dx * dx + dz * dz < r * r) b[this.idx(ix, iz)] = 1;
        }
      }
    };
    for (const s of this.col.segs) mark(s.ax, s.az, s.bx, s.bz, margin);
    for (const c of this.col.circles) mark(c.x, c.z, c.x, c.z, c.r + margin);

    // 3) bord de la zone de jeu
    const m = Math.ceil(margin / cell);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < m; k++) {
        b[this.idx(i, k)] = 1; b[this.idx(i, n - 1 - k)] = 1;
        b[this.idx(k, i)] = 1; b[this.idx(n - 1 - k, i)] = 1;
      }
    }
    this.lastTarget = -1;
  }

  // Case libre la plus proche (recherche en spirale)
  nearestFree(x, z, maxR = 12) {
    const ix = this.cx(x), iz = this.cz(z);
    if (this.inside(ix, iz) && !this.blocked[this.idx(ix, iz)]) return [ix, iz];
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (this.inside(jx, jz) && !this.blocked[this.idx(jx, jz)]) return [jx, jz];
        }
      }
    }
    return null;
  }

  // ---- champ de distances (Dijkstra multi-sources à seaux, coûts 10 / 14) ----
  computeField(tx, tz) {
    const targets = Array.isArray(tx) ? tx : [{ x: tx, z: tz }];
    const starts = [];
    for (const t of targets) {
      if (!t || t.dead) continue;
      const px = t.x != null ? t.x : (t.pos ? t.pos.x : 0);
      const pz = t.z != null ? t.z : (t.pos ? t.pos.z : 0);
      const src = this.nearestFree(px, pz);
      if (src) {
        const id = this.idx(src[0], src[1]);
        if (!starts.includes(id)) starts.push(id);
      }
    }
    if (starts.length === 0) return false;
    const key = starts.slice().sort().join(',');
    if (key === this.lastTargetKey) return true;
    this.lastTargetKey = key;
    const { n, dist, blocked } = this;
    dist.fill(INF);
    for (const s of starts) dist[s] = 0;
    const buckets = [starts.slice()];
    const NB = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let bi = 0; bi < bucket.length; bi++) {
        const i = bucket[bi];
        if (dist[i] !== d) continue;
        const ix = i % n, iz = (i / n) | 0;
        for (const [dx, dz, c] of NB) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          if (blocked[j]) continue;
          if (dx !== 0 && dz !== 0 && (blocked[iz * n + jx] || blocked[jz * n + ix])) continue; // pas de coin coupé
          const nd = d + c;
          if (nd < dist[j]) {
            dist[j] = nd;
            (buckets[nd] || (buckets[nd] = [])).push(j);
          }
        }
      }
      buckets[d] = null;
    }
    return true;
  }

  // Distance de marche (en mètres) depuis la case de (x,z) jusqu'à la cible, ou Infinity
  walkDistance(x, z) {
    const ix = this.cx(x), iz = this.cz(z);
    if (!this.inside(ix, iz)) return Infinity;
    const d = this.dist[this.idx(ix, iz)];
    return d >= INF ? Infinity : (d / 10) * this.cell;
  }

  // Ligne de vue libre entre deux points ?
  los(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isBlockedAt(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  // Direction (x,z normalisée) à suivre pour rejoindre le joueur ; null = chemin inconnu.
  steer(x, z, out) {
    const ix = this.cx(x), iz = this.cz(z);
    if (!this.inside(ix, iz)) return null;
    const { n, dist } = this;
    let best = dist[this.idx(ix, iz)], bx = ix, bz = iz;
    const R = 4; // regarde ~2 m devant pour un mouvement fluide
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const d = dist[jz * n + jx];
        // favorise les cases les plus avancées vers la cible
        if (d < best) { best = d; bx = jx; bz = jz; }
      }
    }
    if (best >= INF || (bx === ix && bz === iz)) return null;
    const vx = this.worldX(bx) - x, vz = this.worldZ(bz) - z;
    const l = Math.hypot(vx, vz) || 1;
    out.x = vx / l; out.z = vz / l;
    return out;
  }
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
