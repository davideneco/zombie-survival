// Détermine la zone jouable (l'île) à partir de l'eau OpenStreetMap, sur une grille grossière.
// L'eau est rastérisée, puis "fermée" (dilatation + érosion) pour boucher les trous laissés par les ponts ;
// l'île est la zone connectée au point de départ, sans traverser l'eau.

const WATER_LINE_WIDTH = 10;   // largeur par défaut d'un cours d'eau (m)
const CLOSE_RADIUS = 7;        // rayon de fermeture, en cases : comble les trous d'eau jusqu'à ~2 * 7 * cell mètres

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Dilatation (ou érosion si erode) séparable avec un carré de rayon r
function morph(src, nx, nz, r, erode) {
  const tmp = new Uint8Array(nx * nz), out = new Uint8Array(nx * nz);
  const hit = erode ? 0 : 1;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let v = erode ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= nx ? (erode ? 1 : 0) : src[z * nx + xx];
        if (s === hit) { v = hit; break; }
      }
      tmp[z * nx + x] = v;
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let v = erode ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const zz = z + k;
        const s = zz < 0 || zz >= nz ? (erode ? 1 : 0) : tmp[zz * nx + x];
        if (s === hit) { v = hit; break; }
      }
      out[z * nx + x] = v;
    }
  }
  return out;
}

export function computeIsland(data, startX, startZ, cell = 2) {
  const hx = data.half, hz = data.halfZ || data.half;
  const nx = Math.ceil((hx * 2) / cell), nz = Math.ceil((hz * 2) / cell);
  const ix = (x) => Math.floor((x + hx) / cell), iz = (z) => Math.floor((z + hz) / cell);
  let water = new Uint8Array(nx * nz);

  for (const w of data.water) {
    if (!w.line) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of w.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      for (let j = Math.max(0, iz(minZ)); j <= Math.min(nz - 1, iz(maxZ)); j++) {
        for (let i = Math.max(0, ix(minX)); i <= Math.min(nx - 1, ix(maxX)); i++) {
          if (pointInPoly((i + 0.5) * cell - hx, (j + 0.5) * cell - hz, w.pts)) water[j * nx + i] = 1;
        }
      }
    } else {
      const r = (w.width || WATER_LINE_WIDTH) / 2;
      for (let k = 0; k + 1 < w.pts.length; k++) {
        const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const px = ax + ((bx - ax) * s) / steps, pz = az + ((bz - az) * s) / steps;
          const rr = Math.ceil(r / cell);
          for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
            const i = ix(px) + di, j = iz(pz) + dj;
            if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
            const cx = (i + 0.5) * cell - hx - px, cz = (j + 0.5) * cell - hz - pz;
            if (cx * cx + cz * cz <= r * r) water[j * nx + i] = 1;
          }
        }
      }
    }
  }

  const rawWater = water;
  water = morph(morph(water, nx, nz, CLOSE_RADIUS, false), nx, nz, CLOSE_RADIUS, true); // fermeture
  for (let i = 0; i < water.length; i++) if (rawWater[i]) water[i] = 1;

  // île = composante connexe du départ (4-voisins) hors eau
  const island = new Uint8Array(nx * nz);
  const stack = [];
  // départ : case sans eau la plus proche (le point demandé peut tomber sur une fontaine)
  let s0 = -1;
  for (let r = 0; r < 40 && s0 < 0; r++) {
    for (let dj = -r; dj <= r && s0 < 0; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ix(startX) + di, j = iz(startZ) + dj;
      if (i >= 0 && j >= 0 && i < nx && j < nz && !water[j * nx + i]) { s0 = j * nx + i; break; }
    }
  }
  if (s0 >= 0) { island[s0] = 1; stack.push(s0); }
  while (stack.length) {
    const c = stack.pop(), x = c % nx, z = (c / nx) | 0;
    if (x > 0 && !island[c - 1] && !water[c - 1]) { island[c - 1] = 1; stack.push(c - 1); }
    if (x < nx - 1 && !island[c + 1] && !water[c + 1]) { island[c + 1] = 1; stack.push(c + 1); }
    if (z > 0 && !island[c - nx] && !water[c - nx]) { island[c - nx] = 1; stack.push(c - nx); }
    if (z < nz - 1 && !island[c + nx] && !water[c + nx]) { island[c + nx] = 1; stack.push(c + nx); }
  }
  return { cell, nx, nz, hx, hz, water, rawWater, island };
}
