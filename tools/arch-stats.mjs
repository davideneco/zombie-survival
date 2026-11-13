// Prints how many buildings each facade style gets per district (archStyle.js on public/data/area.json).
//   node tools/arch-stats.mjs
// Frontage is approximated by the longest edge of the footprint (the game uses the longest edge with open street outside).
import fs from 'node:fs';
import { computeIsland, stitchRings } from '../src/island.js';
import { classify, districtOf } from '../src/archStyle.js';
import { CONFIG } from '../src/config.js';

const d = JSON.parse(fs.readFileSync(new URL('../public/data/area.json', import.meta.url)));
d.buildings = stitchRings(d.buildings);
d.water = [...d.water.filter((w) => w.line), ...stitchRings(d.water.filter((w) => !w.line))];
const I = computeIsland(d, CONFIG.startHint.x, CONFIG.startHint.z);
const onIsland = (x, z) => { const i = Math.floor((x + I.hx) / I.cell), j = Math.floor((z + I.hz) / I.cell); return i >= 0 && j >= 0 && i < I.nx && j < I.nz && I.island[j * I.nx + i] === 1; };
const cfg = CONFIG.architecture, table = {}, styles = new Set();
for (const b of d.buildings) {
  const p = b.pts; let cx = 0, cz = 0, a = 0, front = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; cx += p[i][0] / p.length; cz += p[i][1] / p.length; front = Math.max(front, Math.hypot(q[0] - p[i][0], q[1] - p[i][1])); }
  const area = Math.abs(a / 2), tags = b.tags || {}, lv = parseFloat(tags['building:levels']);
  const levels = Number.isFinite(lv) ? Math.max(1, lv) : Math.max(2, Math.round(((b.h || 12) - 4.2) / 3.25) + 1);
  const island = onIsland(cx, cz);
  const r = classify({ tags, area, levels, ignH: b.ignH, frontage: front, island, cx, cz }, cfg);
  const row = table[r.district] || (table[r.district] = {});
  row[r.style] = (row[r.style] || 0) + 1; row._n = (row._n || 0) + 1; styles.add(r.style);
}
const cols = [...styles].sort();
console.log(['district'.padEnd(14), 'n'.padStart(5), ...cols.map((c) => c.padStart(9))].join(' '));
for (const [k, row] of Object.entries(table)) console.log([k.padEnd(14), String(row._n).padStart(5), ...cols.map((c) => String(row[c] || 0).padStart(9))].join(' '));
