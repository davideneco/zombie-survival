// Passages sous immeubles (OSM tunnel=building_passage) : couloirs qui traversent les bâtiments.
// Ce module ne fait que de la géométrie 2D (x, z) ; realworld.js s'en sert pour percer façades,
// collisions et grille de navigation.

const DEFAULT_WIDTH = 3.2; // largeur par défaut d'un passage (m)
const EXTEND = 1.5;        // prolongement des extrémités, pour être sûr de traverser la façade

export function preparePassages(list) {
  const out = [];
  for (const p of list || []) {
    if (!p.pts || p.pts.length < 2) continue;
    const pts = p.pts.map((q) => q.slice());
    const ext = (a, b) => { // prolonge a dans la direction b -> a
      const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1;
      return [a[0] + (dx / l) * EXTEND, a[1] + (dz / l) * EXTEND];
    };
    pts[0] = ext(pts[0], pts[1]);
    pts[pts.length - 1] = ext(pts[pts.length - 1], pts[pts.length - 2]);
    const w = p.width && p.width > 2 ? Math.min(p.width, 6) : DEFAULT_WIDTH;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const hw = w / 2;
    out.push({ pts, hw, minX: minX - hw, maxX: maxX + hw, minZ: minZ - hw, maxZ: maxZ + hw });
  }
  return out;
}

const overlaps = (it, minX, minZ, maxX, maxZ) => it.maxX >= minX && it.minX <= maxX && it.maxZ >= minZ && it.minZ <= maxZ;

// Point de l'axe le plus proche de (x, z) pour un passage : [distance, px, pz]
function nearestOnAxis(it, x, z) {
  let best = [Infinity, 0, 0];
  for (let k = 0; k + 1 < it.pts.length; k++) {
    const [ax, az] = it.pts[k], [bx, bz] = it.pts[k + 1];
    const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
    let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + abx * t, pz = az + abz * t, d = Math.hypot(x - px, z - pz);
    if (d < best[0]) best = [d, px, pz];
  }
  return best;
}

// Intervalles [t0, t1] (0..1) d'un mur (a -> b) à ouvrir :
//  - là où l'axe d'un passage le traverse (façades, murs mitoyens en travers) ;
//  - là où le mur est dans le couloir alors que l'axe passe dans un bâtiment (mur mitoyen le long du passage).
// axisInside(x, z) : l'axe est-il dans un bâtiment à cet endroit ?
export function cutIntervals(items, ax, az, bx, bz, axisInside = null) {
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
  const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
  if (len < 1e-6) return [];
  const res = [];
  for (const it of items) {
    if (!overlaps(it, minX, minZ, maxX, maxZ)) continue;
    for (let k = 0; k + 1 < it.pts.length; k++) {
      const [px, pz] = it.pts[k], [qx, qz] = it.pts[k + 1];
      const fx = qx - px, fz = qz - pz;
      const den = ex * fz - ez * fx;
      if (Math.abs(den) < 1e-9) continue; // parallèle
      const t = ((px - ax) * fz - (pz - az) * fx) / den; // sur le mur
      const u = ((px - ax) * ez - (pz - az) * ex) / den; // sur le passage
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const sin = Math.abs(den) / (len * Math.hypot(fx, fz));
      const half = Math.min(it.hw / Math.max(sin, 0.2), it.hw * 3) / len;
      res.push([Math.max(0, t - half), Math.min(1, t + half)]);
    }
    if (axisInside) {
      const n = Math.max(2, Math.ceil(len / 0.2));
      let start = -1;
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        let inCorridor = false;
        if (s < n || start >= 0) {
          const [d, px, pz] = nearestOnAxis(it, ax + ex * t, az + ez * t);
          inCorridor = d < it.hw * 0.95 && axisInside(px, pz);
        }
        if (inCorridor && start < 0) start = t;
        if ((!inCorridor || s === n) && start >= 0) { res.push([Math.max(0, start - 0.2 / len), Math.min(1, t + 0.2 / len)]); start = -1; }
      }
    }
  }
  res.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of res) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  }
  return merged;
}

// Portions de l'axe situées à l'intérieur des bâtiments : [{ hw, pts: [[x, z], ...] }]
// (échantillonnées tous les `step` mètres ; isInside(x, z) teste l'intérieur d'un bâtiment)
export function insideRuns(items, isInside, step = 0.5) {
  const runs = [];
  for (const it of items) {
    let cur = null;
    for (let k = 0; k + 1 < it.pts.length; k++) {
      const [px, pz] = it.pts[k], [qx, qz] = it.pts[k + 1];
      const l = Math.hypot(qx - px, qz - pz), n = Math.max(1, Math.ceil(l / step));
      for (let s = (k === 0 ? 0 : 1); s <= n; s++) {
        const x = px + ((qx - px) * s) / n, z = pz + ((qz - pz) * s) / n;
        if (isInside(x, z)) {
          if (!cur) { cur = { hw: it.hw, pts: [] }; runs.push(cur); }
          cur.pts.push([x, z]);
        } else cur = null;
      }
    }
  }
  return runs.filter((r) => r.pts.length >= 2);
}

// Distance de (x, z) à l'axe du passage le plus proche
export function distToPassage(items, x, z) {
  let best = Infinity;
  for (const it of items) {
    if (x < it.minX - 3 || x > it.maxX + 3 || z < it.minZ - 3 || z > it.maxZ + 3) continue;
    for (let k = 0; k + 1 < it.pts.length; k++) {
      const [ax, az] = it.pts[k], [bx, bz] = it.pts[k + 1];
      const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(x - ax - abx * t, z - az - abz * t));
    }
  }
  return best;
}
