import * as THREE from 'three';

// =====================================================================
//  Étages : surfaces praticables à plusieurs hauteurs (balcons, escaliers, plateforme, flèche…).
//  - un « plancher » est un ensemble de triangles 3D (planchers plats, rampes, marches d'un escalier en colimaçon) ;
//  - chaque triangle appartient à une RÉGION (étage, escalier…) ;
//  - les escaliers relient deux régions par un LIEN (chemin 3D) : les zombies le suivent pour changer d'étage ;
//  - floorAt(x, z, y) donne la hauteur du sol sous un point : le plus haut triangle situé sous y + marche.
//  Le sol de la ville (y = 0) est implicite : région 0.
// =====================================================================

export const STEP = 0.6; // hauteur maximale qu'on monte sans sauter (marche / pente)
const CELL = 4;
const key = (ix, iz) => ix * 8192 + iz;

export class Levels {
  constructor() {
    this.tris = [];
    this.grid = new Map();
    this.holes = []; // trous dans le sol de la ville (cages d'escalier descendantes) : le sol implicite y est supprimé
    this.holePolys = []; // les mêmes trous en polygones [[x, z], …] : le sol dessiné (pavés) y est percé aussi
    this.regions = [{ id: 0, name: 'Niveau du sol', y: 0, kind: 'ground', bbox: null }];
    this.links = [];
    this.built = false;
    this._hop = null;
  }

  // kind : 'floor' (étage plat) | 'stair' (escalier : région intermédiaire)
  addRegion(name, y, kind = 'floor') {
    const r = { id: this.regions.length, name, y, kind, bbox: [Infinity, Infinity, -Infinity, -Infinity], tris: [], spawns: [], link: null };
    this.regions.push(r);
    return r.id;
  }

  addTri(region, a, b, c) {
    const R = this.regions[region];
    const t = { region, x0: a[0], y0: a[1], z0: a[2], x1: b[0], y1: b[1], z1: b[2], x2: c[0], y2: c[1], z2: c[2] };
    const det = (t.z1 - t.z2) * (t.x0 - t.x2) + (t.x2 - t.x1) * (t.z0 - t.z2);
    if (Math.abs(det) < 1e-9) return;
    t.det = det;
    t.minX = Math.min(a[0], b[0], c[0]); t.maxX = Math.max(a[0], b[0], c[0]);
    t.minZ = Math.min(a[2], b[2], c[2]); t.maxZ = Math.max(a[2], b[2], c[2]);
    this.tris.push(t);
    R.tris.push(t);
    R.bbox[0] = Math.min(R.bbox[0], t.minX); R.bbox[1] = Math.min(R.bbox[1], t.minZ);
    R.bbox[2] = Math.max(R.bbox[2], t.maxX); R.bbox[3] = Math.max(R.bbox[3], t.maxZ);
    this.built = false;
  }

  // Polygone plat [[x,z],…] à la hauteur y, avec trous éventuels. Retourne les triangles (pour les planchers qui arrêtent les balles).
  addPoly(region, pts, y, holes = []) {
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    const out = [];
    for (const [i, j, k] of tris) {
      const a = all[i], b = all[j], c = all[k];
      this.addTri(region, [a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y]);
      out.push([a.x, a.y, b.x, b.y, c.x, c.y]);
    }
    return out;
  }

  // Quadrilatère incliné (rampe, marche d'un colimaçon) : 4 sommets [x, y, z]
  addQuad(region, p0, p1, p2, p3) {
    this.addTri(region, p0, p1, p2);
    this.addTri(region, p0, p2, p3);
  }

  // Trou dans le sol de la ville (polygone [[x, z], …]) : on y descend par un escalier
  addGroundHole(pts) {
    this.holePolys.push(pts);
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const a = contour[i], b = contour[j], c = contour[k];
      this.holes.push({ x0: a.x, z0: a.y, x1: b.x, z1: b.y, x2: c.x, z2: c.y });
    }
  }
  inHole(x, z) {
    for (const t of this.holes) {
      const d = (t.z1 - t.z2) * (t.x0 - t.x2) + (t.x2 - t.x1) * (t.z0 - t.z2);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((t.z1 - t.z2) * (x - t.x2) + (t.x2 - t.x1) * (z - t.z2)) / d, l1 = ((t.z2 - t.z0) * (x - t.x2) + (t.x0 - t.x2) * (z - t.z2)) / d;
      if (l0 >= 0 && l1 >= 0 && l0 + l1 <= 1) return true;
    }
    return false;
  }

  build() {
    this.grid.clear();
    for (let i = 0; i < this.tris.length; i++) {
      const t = this.tris[i];
      for (let ix = Math.floor(t.minX / CELL); ix <= Math.floor(t.maxX / CELL); ix++) {
        for (let iz = Math.floor(t.minZ / CELL); iz <= Math.floor(t.maxZ / CELL); iz++) {
          const k = key(ix, iz);
          let a = this.grid.get(k);
          if (!a) { a = []; this.grid.set(k, a); }
          a.push(t);
        }
      }
    }
    this.built = true;
  }

  // Sol sous (x, z) pour un corps dont les pieds sont à la hauteur y. Remplit out = { y, region } ; toujours vrai
  // (le sol de la ville, y = 0, existe partout).
  floorAt(x, z, y, out) {
    if (!this.built) this.build();
    let best = y + STEP >= 0 && !(this.holes.length && this.inHole(x, z)) ? 0 : -Infinity, reg = 0;
    const arr = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
        const l0 = ((t.z1 - t.z2) * (x - t.x2) + (t.x2 - t.x1) * (z - t.z2)) / t.det;
        const l1 = ((t.z2 - t.z0) * (x - t.x2) + (t.x0 - t.x2) * (z - t.z2)) / t.det;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const h = l0 * t.y0 + l1 * t.y1 + l2 * t.y2;
        if (h <= y + STEP && h > best) { best = h; reg = t.region; }
      }
    }
    if (best === -Infinity) best = y; // sous tout plancher connu : on ne bouge pas (ne devrait pas arriver)
    out.y = best; out.region = reg;
    return out;
  }

  regionAt(x, z, y) { const o = { y: 0, region: 0 }; this.floorAt(x, z, y, o); return o.region; }

  // Le point (x, z) est-il sur un plancher de cette région ?
  inRegion(regionId, x, z) {
    if (!this.built) this.build();
    const arr = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return false;
    for (const t of arr) {
      if (t.region !== regionId || x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
      const l0 = ((t.z1 - t.z2) * (x - t.x2) + (t.x2 - t.x1) * (z - t.z2)) / t.det;
      const l1 = ((t.z2 - t.z0) * (x - t.x2) + (t.x0 - t.x2) * (z - t.z2)) / t.det;
      if (l0 >= -1e-6 && l1 >= -1e-6 && 1 - l0 - l1 >= -1e-6) return true;
    }
    return false;
  }

  // Grille de navigation de chaque étage plat : cases praticables = plancher de la région, obstacles = ceux de cette hauteur
  buildNavs(NavGrid, collision, cell = 0.5, margin = 0.4) {
    if (!this.built) this.build();
    for (const R of this.regions) {
      if (R.kind !== 'floor' || !R.tris.length) continue;
      const x0 = R.bbox[0] - 1, z0 = R.bbox[1] - 1, x1 = R.bbox[2] + 1, z1 = R.bbox[3] + 1;
      const nav = new NavGrid((x1 - x0) / 2, (z1 - z0) / 2, collision, [], cell, margin);
      nav.ox = x0; nav.oz = z0;
      nav.walkable = (x, z) => this.inRegion(R.id, x, z);
      nav.segFilter = (it) => collision._blocks(it, R.y);
      nav.build();
      R.nav = nav;
    }
  }

  // ------------------------------------------------------------------ liens (escaliers)
  // path : [[x, y, z], …] du bas vers le haut, de la région a (début) à la région b (fin)
  addLink(name, a, b, path, regionId = null) {
    const len = [0];
    for (let i = 1; i < path.length; i++) len.push(len[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
    const link = { id: this.links.length, name, a, b, path, len, length: len[len.length - 1], region: regionId };
    this.links.push(link);
    if (regionId != null) this.regions[regionId].link = link;
    this._hop = null;
    return link;
  }

  // Position (x, y, z) à l'abscisse s le long du lien
  pointOn(link, s, out) {
    const { path, len } = link;
    s = Math.max(0, Math.min(link.length, s));
    let i = 1;
    while (i < len.length - 1 && len[i] < s) i++;
    const seg = len[i] - len[i - 1] || 1, f = (s - len[i - 1]) / seg;
    out.x = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f;
    out.y = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f;
    out.z = path[i - 1][2] + (path[i][2] - path[i - 1][2]) * f;
    out.yaw = Math.atan2(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    return out;
  }

  // Abscisse du point du lien le plus proche de (x, z, y)
  project(link, x, z, y) {
    let best = Infinity, bs = 0;
    const { path, len } = link;
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1][0], az = path[i - 1][2], bx = path[i][0], bz = path[i][2];
      const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const py = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t;
      const d = Math.hypot(x - ax - abx * t, z - az - abz * t) + Math.abs(y - py) * 1.5;
      if (d < best) { best = d; bs = len[i - 1] + (len[i] - len[i - 1]) * t; }
    }
    return bs;
  }

  // Région « utile » d'un point sur un escalier : l'extrémité la plus proche (pour savoir où est le joueur)
  endRegion(regionId, x, z, y) {
    const R = this.regions[regionId];
    if (!R || !R.link) return regionId;
    const s = this.project(R.link, x, z, y);
    return s < R.link.length / 2 ? R.link.a : R.link.b;
  }

  // Prochain lien à emprunter depuis la région `from` pour rejoindre `to` : { link, dir (+1 : de a vers b), next }.
  // Les escaliers (régions 'stair') ne sont pas des étapes : seuls les liens comptent. Table calculée une fois (BFS).
  nextHop(from, to) {
    if (from === to) return null;
    if (!this._hop) this._buildHops();
    return this._hop.get(from * 1024 + to) || null;
  }
  _buildHops() {
    const n = this.regions.length;
    const adj = Array.from({ length: n }, () => []);
    for (const l of this.links) { adj[l.a].push({ to: l.b, link: l, dir: 1 }); adj[l.b].push({ to: l.a, link: l, dir: -1 }); }
    this._hop = new Map();
    this._dist = new Map();
    for (let target = 0; target < n; target++) {
      const dist = new Array(n).fill(Infinity); dist[target] = 0;
      const q = [target];
      for (let h = 0; h < q.length; h++) {
        const u = q[h];
        for (const e of adj[u]) {
          // arête e : u -> e.to ; on remonte depuis la cible : le voisin v = e.to prend le lien dans le sens inverse
          if (dist[e.to] > dist[u] + e.link.length) { dist[e.to] = dist[u] + e.link.length; this._hop.set(e.to * 1024 + target, { link: e.link, dir: -e.dir, next: u }); q.push(e.to); }
        }
      }
      for (let i = 0; i < n; i++) this._dist.set(i * 1024 + target, dist[i]);
    }
  }
  // Longueur du chemin d'escaliers entre deux régions (Infinity si non reliées)
  hopDistance(from, to) {
    if (from === to) return 0;
    if (!this._hop) this._buildHops();
    return this._dist.get(from * 1024 + to) ?? Infinity;
  }
}
