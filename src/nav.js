// Grille de navigation + champ de flux (flow field) : calcule, pour chaque case,
// la distance de marche jusqu'au joueur. Les zombies descendent ce gradient, ce qui
// leur permet de contourner les bâtiments dans les rues étroites.
const INF = 0x3fffffff;
const NEIGHBORS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];

export class NavGrid {
  // Zone rectangulaire de demi-dimensions halfX x halfZ. Le champ de flux est borné (maxCost) :
  // sur une grande carte on ne calcule que le voisinage des joueurs.
  constructor(halfX, halfZ, collision, polygons, cell = 0.5, margin = 0.5, maxCost = Infinity) {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.ox = -halfX; this.oz = -halfZ; // coin (x, z) minimal de la grille : une grille locale (étage) peut être décalée
    this.cell = cell;
    this.nx = Math.round((halfX * 2) / cell);
    this.nz = Math.round((halfZ * 2) / cell);
    this.margin = margin;
    this.maxCost = maxCost;
    this.col = collision;
    this.polys = polygons; // [{pts:[[x,z],...]}]
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.dist = new Int32Array(this.nx * this.nz).fill(INF);
    this.touched = [];
    this.lastTargetKey = null;
    this.walkable = null; // (x, z) => true si praticable (grille locale d'un étage : tout le reste est bloqué)
    this.segFilter = null; // (segment | cercle) => true si l'obstacle compte pour cette grille (obstacles de l'étage)
    this.outside = null; // (x, z) => true si hors de la zone jouable
    this.carve = null;   // (blocked) => libère les cases des passages sous immeubles
    this.vaultCost = 40; // coût de traversée d'une case enjambable dans le champ de flux (10 = case libre) : CONFIG.zombie.vault.cost
  }

  // ---- conversions ----
  cx(x) { return Math.floor((x - this.ox) / this.cell); }
  cz(z) { return Math.floor((z - this.oz) / this.cell); }
  idx(ix, iz) { return iz * this.nx + ix; }
  inside(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz; }
  worldX(ix) { return this.ox + (ix + 0.5) * this.cell; }
  worldZ(iz) { return this.oz + (iz + 0.5) * this.cell; }

  // À appeler quand l'état des obstacles change (porte ouverte) : force le recalcul du champ.
  invalidate() { this.lastTargetKey = null; this.version = (this.version || 0) + 1; }

  // Composantes connexes des cases libres (8 voisins, sans coin coupé) : { labels: Int32Array (0 = case bloquée), sizes: [0, n1, n2…], version }.
  // Mémorisées jusqu'au prochain invalidate() (porte ouverte). Sert à repérer les poches fermées (outil stuck-scan, bouton « se débloquer »).
  components() {
    if (this._comp && this._comp.version === (this.version || 0)) return this._comp;
    const { nx, nz, blocked } = this, labels = new Int32Array(nx * nz), sizes = [0], stack = new Int32Array(nx * nz);
    for (let start = 0; start < labels.length; start++) {
      if (blocked[start] || labels[start]) continue;
      const id = sizes.length; let n = 0, sp = 0;
      labels[start] = id; stack[sp++] = start;
      while (sp) {
        const i = stack[--sp]; n++;
        const ix = i % nx, iz = (i / nx) | 0;
        for (let k = 0; k < 8; k++) {
          const dx = NEIGHBORS[k][0], dz = NEIGHBORS[k][1], jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (blocked[j] || labels[j]) continue;
          if (dx !== 0 && dz !== 0 && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) continue;
          labels[j] = id; stack[sp++] = j;
        }
      }
      sizes.push(n);
    }
    this._comp = { labels, sizes, version: this.version || 0 };
    return this._comp;
  }

  isBlockedAt(x, z) {
    const ix = this.cx(x), iz = this.cz(z);
    return !this.inside(ix, iz) || this.blocked[this.idx(ix, iz)] !== 0; // 1 = bloquée, 2 = obstacle enjambable (bloquée pour tout sauf le champ de flux)
  }

  // ---- construction de la grille d'obstacles ----
  build() {
    const { nx, nz, cell, margin } = this;
    const b = this.blocked;
    b.fill(0);
    if (this.walkable) { // grille locale : seul ce qui est praticable est libre
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) b[iz * nx + ix] = this.walkable(this.worldX(ix), this.worldZ(iz)) ? 0 : 1;
    }

    // 1) intérieur des bâtiments
    for (const poly of (this.walkable ? [] : this.polys)) {
      const pts = poly.pts;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const ix0 = Math.max(0, this.cx(minX)), ix1 = Math.min(nx - 1, this.cx(maxX));
      const iz0 = Math.max(0, this.cz(minZ)), iz1 = Math.min(nz - 1, this.cz(maxZ));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          if (pointInPoly(this.worldX(ix), this.worldZ(iz), pts)) b[this.idx(ix, iz)] = 1;
        }
      }
    }

    // 1b) couloirs creusés dans les bâtiments (passages sous immeubles)
    if (this.carve) this.carve(b);

    // 2) marge autour de tous les segments et cercles (rayon du zombie)
    const mark = (ax, az, bx, bz, r) => {
      const ix0 = Math.max(0, this.cx(Math.min(ax, bx) - r)), ix1 = Math.min(nx - 1, this.cx(Math.max(ax, bx) + r));
      const iz0 = Math.max(0, this.cz(Math.min(az, bz) - r)), iz1 = Math.min(nz - 1, this.cz(Math.max(az, bz) + r));
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
    const keep = this.segFilter;
    for (const s of this.col.segs) if (!s.off && !s.vid && (!keep || keep(s))) mark(s.ax, s.az, s.bx, s.bz, margin);
    for (const c of this.col.circles) if (!c.off && !c.vid && (!keep || keep(c))) mark(c.x, c.z, c.x, c.z, c.r + margin);
    // obstacles enjambables (banc, caisse, barrière…) : cases de valeur 2 (« franchissables ») là où aucun autre obstacle ne bloque ; le champ de
    // flux les traverse à un coût de vaultCost (au lieu de 10), les zombies les enjambent (zombie.js) ; ailleurs elles comptent comme bloquées
    const b1 = b.slice();
    for (const s of this.col.segs) if (!s.off && s.vid && (!keep || keep(s))) mark(s.ax, s.az, s.bx, s.bz, margin);
    for (const c of this.col.circles) if (!c.off && c.vid && (!keep || keep(c))) mark(c.x, c.z, c.x, c.z, c.r + margin);
    for (let i = 0; i < b.length; i++) if (b[i] === 1 && b1[i] === 0) b[i] = 2;

    // 3) bord de la zone de jeu
    const m = Math.ceil(margin / cell);
    for (let i = 0; i < nx; i++) for (let k = 0; k < m; k++) { b[this.idx(i, k)] = 1; b[this.idx(i, nz - 1 - k)] = 1; }
    for (let i = 0; i < nz; i++) for (let k = 0; k < m; k++) { b[this.idx(k, i)] = 1; b[this.idx(nx - 1 - k, i)] = 1; }

    // 4) hors de la zone jouable (eau, autre rive)
    if (this.outside) {
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        if (this.outside(this.worldX(ix), this.worldZ(iz))) b[iz * nx + ix] = 1;
      }
    }
    this.lastTargetKey = null;
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
    const { nx, nz, dist, blocked, touched, maxCost } = this;
    for (let k = 0; k < touched.length; k++) dist[touched[k]] = INF; // remise à zéro locale (pas de fill global)
    touched.length = 0;
    for (const s of starts) { dist[s] = 0; touched.push(s); }
    const buckets = [starts.slice()];
    const NB = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    for (let d = 0; d < buckets.length && d <= maxCost; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let bi = 0; bi < bucket.length; bi++) {
        const i = bucket[bi];
        if (dist[i] !== d) continue;
        const ix = i % nx, iz = (i / nx) | 0;
        for (const [dx, dz, c] of NB) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (blocked[j] === 1) continue;
          if (dx !== 0 && dz !== 0 && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) continue; // pas de coin coupé
          const nd = d + (blocked[j] === 2 ? this.vaultCost * (c > 10 ? 1.4 : 1) : c);
          if (nd < dist[j]) {
            if (dist[j] >= INF) touched.push(j);
            dist[j] = nd;
            (buckets[nd] || (buckets[nd] = [])).push(j);
          }
        }
      }
      buckets[d] = null;
    }
    return true;
  }

  // ---- champ global incrémental (double tampon) ----
  // Calcule le champ de flux autour des cibles, par tranches de `budget` cases par appel, puis l'échange avec le champ courant.
  // maxCost : coût maximal exploré (10 par case, 14 en diagonale ; 160 m de marche = 160 / cell x 10) ; au-delà les cases restent
  // sans chemin (steer() rend null) : sur une grande carte, c'est le voisinage des joueurs seul qui est calculé.
  // Retourne true tant qu'un calcul est en cours (l'appelant peut espacer les relances une fois qu'il est fini : `this.job` est null).
  updateField(targets, budget = 50000, maxCost = Infinity) {
    if (!this.job) {
      const starts = [];
      for (const t of targets) {
        if (!t) continue;
        const src = this.nearestFree(t.pos ? t.pos.x : t.x, t.pos ? t.pos.z : t.z);
        if (src) { const id = this.idx(src[0], src[1]); if (!starts.includes(id)) starts.push(id); }
      }
      if (!starts.length) return false;
      if (!this.distB) { this.distB = new Int32Array(this.nx * this.nz).fill(INF); this.touchedB = []; }
      const { distB, touchedB } = this;
      for (let k = 0; k < touchedB.length; k++) distB[touchedB[k]] = INF;
      touchedB.length = 0;
      for (const s of starts) { distB[s] = 0; touchedB.push(s); }
      this.job = { buckets: [starts.slice()], d: 0, bi: 0 };
    }
    const job = this.job, { nx, nz, blocked } = this, dist = this.distB, touched = this.touchedB;
    const NB = NEIGHBORS;
    let ops = 0;
    while (job.d < job.buckets.length && job.d <= maxCost) {
      const bucket = job.buckets[job.d];
      if (!bucket) { job.d++; job.bi = 0; continue; }
      while (job.bi < bucket.length) {
        const i = bucket[job.bi++];
        const d = job.d;
        if (dist[i] !== d) continue;
        const ix = i % nx, iz = (i / nx) | 0;
        for (let k = 0; k < 8; k++) {
          const dx = NB[k][0], dz = NB[k][1];
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (blocked[j] === 1) continue;
          if (dx !== 0 && dz !== 0 && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) continue;
          const nd = d + (blocked[j] === 2 ? this.vaultCost * (NB[k][2] > 10 ? 1.4 : 1) : NB[k][2]);
          if (nd < dist[j]) {
            if (dist[j] >= INF) touched.push(j);
            dist[j] = nd;
            (job.buckets[nd] || (job.buckets[nd] = [])).push(j);
          }
        }
        if (++ops >= budget) return true;
      }
      job.buckets[job.d] = null;
      job.d++; job.bi = 0;
    }
    // terminé : on échange les tampons
    [this.dist, this.distB] = [this.distB, this.dist];
    [this.touched, this.touchedB] = [this.touchedB, this.touched];
    this.lastTargetKey = null;
    this.job = null;
    return false;
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

  // Ligne droite libre pour un zombie ? (aucune case bloquée entre les deux : sinon on viserait à travers un mur mince)
  clear(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedAt(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  // Direction (x,z normalisée) à suivre pour rejoindre le joueur ; null = chemin inconnu.
  steer(x, z, out) {
    const ix = this.cx(x), iz = this.cz(z);
    if (!this.inside(ix, iz)) return null;
    const { nx, nz, dist, blocked } = this;
    let best = dist[this.idx(ix, iz)], bx = ix, bz = iz;
    // dans la marge d'un mur (case bloquée) : seuls les voisins immédiats sont sûrs, sinon on viserait à travers le mur
    const R = blocked[this.idx(ix, iz)] ? 1 : Math.max(2, Math.round(2 / this.cell)); // sinon regarde ~2 m devant pour un mouvement fluide
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const d = dist[jz * nx + jx];
        if (d >= best) continue;
        // voisins immédiats : atteignables (sauf coin coupé) ; plus loin : ligne droite libre exigée
        const adj = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
        if (adj ? (dx !== 0 && dz !== 0 && (blocked[iz * nx + jx] || blocked[jz * nx + ix])) : !this.clear(x, z, this.worldX(jx), this.worldZ(jz))) continue;
        best = d; bx = jx; bz = jz;
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
