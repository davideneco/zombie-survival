// Le quartier de départ (place du Marché-Neuf) est entièrement fermé par des bâtiments dans les données OSM.
// On choisit quelques petits bâtiments qui séparent la place du reste de la ville : ils seront "effondrés"
// (retirés de la carte) et leurs brèches fermées par des portes payantes.
import { Collision } from './collision.js';
import { NavGrid } from './nav.js';

function flood(nav, x, z) {
  const mask = new Uint8Array(nav.nx * nav.nz);
  const s = nav.nearestFree(x, z, 40);
  if (!s) return mask;
  const stack = [nav.idx(s[0], s[1])];
  mask[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop(), cx = c % nav.nx, cz = (c / nav.nx) | 0;
    const push = (j) => { if (!mask[j] && !nav.blocked[j]) { mask[j] = 1; stack.push(j); } };
    if (cx > 0) push(c - 1);
    if (cx < nav.nx - 1) push(c + 1);
    if (cz > 0) push(c - nav.nx);
    if (cz < nav.nz - 1) push(c + nav.nx);
  }
  return mask;
}

/**
 * rings : contours des bâtiments (sans point de fermeture dupliqué)
 * start : point de départ ; city : point situé dans le réseau de rues principal
 * Retourne { removed: Set(indices de rings), startMask: Uint8Array (cases de la place sur une grille nav identique) }
 */
export function findBreaches(rings, halfX, halfZ, start, city, count, cell, margin) {
  const col = new Collision(halfX, halfZ);
  const polys = rings.map((pts) => ({ pts }));
  for (const pts of rings) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      col.addSegment(a[0], a[1], b[0], b[1]);
    }
  }
  col.build();
  const nav = new NavGrid(halfX, halfZ, col, polys, cell, margin);
  nav.build();
  const A = flood(nav, start.x, start.z), B = flood(nav, city.x, city.z);
  const removed = new Set();
  const at = (m, x, z) => { const i = nav.cx(x), j = nav.cz(z); return nav.inside(i, j) && m[nav.idx(i, j)] === 1; };
  // Déjà connectée à la ville : rien à ouvrir
  if (at(B, start.x, start.z)) return { removed, startMask: A };

  const cands = [];
  rings.forEach((pts, k) => {
    // on ne regarde que les bâtiments proches de la place
    if (Math.hypot(pts[0][0] - start.x, pts[0][1] - start.z) > 150) return;
    let touchA = false, touchB = false, area = 0, cx = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1; cx += x1; cz += z1;
      const len = Math.hypot(x2 - x1, z2 - z1) || 1;
      for (let s = 0; s <= len; s += 0.5) {
        const x = x1 + ((x2 - x1) * s) / len, z = z1 + ((z2 - z1) * s) / len;
        for (const [ox, oz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
          if (at(A, x + ox, z + oz)) touchA = true;
          if (at(B, x + ox, z + oz)) touchB = true;
        }
      }
    }
    area = Math.abs(area / 2);
    // assez grand pour faire un vrai passage, assez petit pour rester crédible
    if (touchA && touchB && area > 20 && area < 400) cands.push({ k, area, cx: cx / pts.length, cz: cz / pts.length });
  });
  cands.sort((a, b) => a.area - b.area);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) > 25)) picked.push(c);
    if (picked.length >= count) break;
  }
  for (const p of picked) removed.add(p.k);
  return { removed, startMask: A };
}
