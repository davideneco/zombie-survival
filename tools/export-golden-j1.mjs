// J1 : valeurs de référence de Collision (src/collision.js) et de l'arène (src/world.js) pour les tests headless du port Godot.
//   godot/data/arena.json      : plan de l'arène extrait de world.js (obstacles, point de départ), lu par sim/arena.gd
//   godot/data/golden/j1.json  : scène de collision tirée au hasard + 1000 resolve, 1000 rayHit, 200 findVault,
//                                et 600 comparaisons avec resolveCollisions (rectangles) de world.js sur l'arène
// Usage : node tools/export-golden-j1.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG } = await import(path.join(ROOT, 'src/config.js'));
const { Collision } = await import(path.join(ROOT, 'src/collision.js'));

// ---------- plan de l'arène : extrait du code source de world.js (une seule vérité) ----------
const src = fs.readFileSync(path.join(ROOT, 'src/world.js'), 'utf8');
const obsMatch = src.match(/const obstacles = \[([\s\S]*?)\n  \];/);
if (!obsMatch) throw new Error('world.js : tableau obstacles introuvable');
const obstacles = [...obsMatch[1].matchAll(/\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/g)].map((m) => m.slice(1).map(Number));
const startMatch = src.match(/startPos: new THREE\.Vector3\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)/);
// resolveCollisions (rectangles) : extraite du source, world.js importe Three.js (pas toujours installé)
const rcMatch = src.match(/export function (resolveCollisions\(pos, radius, colliders, half\) \{[\s\S]*?\n\})\n/);
if (!rcMatch) throw new Error('world.js : resolveCollisions introuvable');
const resolveCollisions = new Function('clamp', `return function ${rcMatch[1]}`)((v, a, b) => Math.max(a, Math.min(b, v)));
if (!obstacles.length || !startMatch) throw new Error('world.js : plan de l\'arène illisible');
const arena = { half: CONFIG.arenaHalf, obstacles, startPos: startMatch.slice(1).map(Number) };
const arenaOut = path.join(ROOT, 'godot/data/arena.json');
fs.writeFileSync(arenaOut, JSON.stringify(arena) + '\n');

// ---------- générateur déterministe ----------
let seed = 20260611;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);
const enc = (v) => (Number.isFinite(v) ? v : null); // null = Infinity pour h, -Infinity pour y0

// ---------- scène de collision au hasard ----------
const HX = 60, HZ = 45;
const col = new Collision(HX, HZ, 4);
const scene = { halfX: HX, halfZ: HZ, cell: 4, segs: [], circles: [], boxes: [], floors: [], dyn: [] };
const heights = [Infinity, 5, 3.4, 2.2, 1.0, 0.9, 0.25, 1.5];
for (let i = 0; i < 70; i++) {
  const ax = R(-55, 55), az = R(-40, 40), len = R(1, 14), a = R(0, 6.28);
  const h = heights[Math.floor(rnd() * heights.length)];
  const y0 = rnd() < 0.2 ? R(0.5, 4) : -Infinity;
  const kind = rnd() < 0.5 ? 'wall' : 'prop';
  const s = { ax, az, bx: ax + Math.cos(a) * len, bz: az + Math.sin(a) * len, h: enc(h), y0: enc(y0), kind };
  scene.segs.push(s);
  col.addSegment(s.ax, s.az, s.bx, s.bz, h, y0, kind);
}
for (let i = 0; i < 45; i++) {
  const c = { x: R(-55, 55), z: R(-40, 40), r: R(0.2, 1.6), h: enc(heights[Math.floor(rnd() * heights.length)]), y0: null, kind: rnd() < 0.5 ? 'wall' : 'prop', vault: rnd() < 0.3 };
  scene.circles.push(c);
  col.addCircle(c.x, c.z, c.r, c.h === null ? Infinity : c.h, -Infinity, c.kind, c.vault);
}
for (let i = 0; i < 30; i++) {
  const vault = rnd() < 0.4;
  const b = { x: R(-50, 50), z: R(-38, 38), w: R(0.8, 6), d: R(0.8, 6), rot: R(0, 6.28), h: vault ? R(0.4, 1.15) : enc(heights[Math.floor(rnd() * heights.length)]), y0: null, kind: 'prop', vault };
  scene.boxes.push(b);
  col.addBox(b.x, b.z, b.w, b.d, b.rot, b.h === null ? Infinity : b.h, -Infinity, b.kind, b.vault);
}
for (const y of [3.2, 7.5]) {
  const tris = [];
  for (let i = 0; i < 5; i++) { const x = R(-40, 40), z = R(-30, 30), s = R(4, 14); tris.push([x, z, x + s, z, x, z + s], [x + s, z + s, x + s, z, x, z + s]); }
  scene.floors.push({ y, tris });
  col.addFloor(y, tris);
}
col.build();
const dyn = [];
for (let i = 0; i < 4; i++) dyn.push({ x: R(-30, 30), z: R(-25, 25), w: R(2, 12), d: R(1.5, 3), rot: R(0, 6.28), h: i % 2 ? 3.4 : 1.2 });
scene.dyn = [{ key: 'tram', kind: 'prop', boxes: dyn }];
col.setDynamic('tram', dyn, 'prop');

// ---------- cas ----------
const ys = [0, 0, 0, 0.5, 1.2, 2.5, 3.6];
const resolve = [];
for (let i = 0; i < 1000; i++) {
  const radius = rnd() < 0.5 ? 0.4 : R(0.2, 0.9);
  const p = { x: R(-62, 62), y: ys[Math.floor(rnd() * ys.length)], z: R(-47, 47) };
  if (rnd() < 0.5 && scene.circles.length) { const c = scene.circles[Math.floor(rnd() * scene.circles.length)]; p.x = c.x + R(-1.5, 1.5); p.z = c.z + R(-1.5, 1.5); } // près d'un obstacle
  const pos = { x: p.x, y: p.y, z: p.z }, out = {};
  col.resolve(pos, radius, out, i % 7 === 0 ? 'tram' : null);
  resolve.push({ p, r: radius, ignore: i % 7 === 0, x: pos.x, z: pos.z, kind: out.kind, push: out.push, nx: out.nx, nz: out.nz });
}
const ray = [];
for (let i = 0; i < 1000; i++) {
  const o = { x: R(-58, 58), y: R(0.1, 8), z: R(-43, 43) };
  let d = { x: R(-1, 1), y: R(-0.6, 0.6), z: R(-1, 1) };
  if (i % 50 === 0) d = { x: 0, y: -1, z: 0 };
  if (i % 50 === 1) d = { x: 1, y: 0, z: 0 };
  if (i % 50 === 2) d = { x: 0, y: 0.5, z: -1 };
  const l = Math.hypot(d.x, d.y, d.z); d = { x: d.x / l, y: d.y / l, z: d.z / l };
  const maxT = R(20, 120);
  ray.push({ o, d, maxT, t: col.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, maxT) });
}
const vault = [];
for (let i = 0; i < 200; i++) {
  const a = R(0, 6.28), o = { x: R(-50, 50), z: R(-38, 38) }, reach = R(0.8, 2.5);
  if (i % 2 === 0 && scene.boxes.length) { const b = scene.boxes.filter((q) => q.vault)[i % 5]; if (b) { o.x = b.x + R(-3, 3); o.z = b.z + R(-3, 3); } }
  const r = col.findVault(o.x, o.z, Math.cos(a), Math.sin(a), reach);
  vault.push({ o, ux: Math.cos(a), uz: Math.sin(a), reach, res: r ? { h: r.v.h, tIn: r.tIn, tOut: r.tOut, nx: r.nx, nz: r.nz } : null });
}

// ---------- arène : le Collision de sim/arena.gd doit pousser comme resolveCollisions (rectangles) de world.js ----------
const half = CONFIG.arenaHalf;
const rects = obstacles.map(([x, z, w, d]) => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }));
rects.push({ minX: -half + 0.6 - 0.6, maxX: -half + 0.6 + 0.6, minZ: -1.5, maxZ: 1.5 }); // borne d'achat
for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const x = sx * (half - 6), z = sz * (half - 6); rects.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15 }); }
const arenaCases = [];
for (let i = 0; i < 600; i++) {
  const r = i % 3 === 0 ? CONFIG.zombie.radius : CONFIG.player.radius;
  const pos = { x: R(-half - 3, half + 3), y: 0, z: R(-half - 3, half + 3) };
  if (rects.some((q) => pos.x > q.minX && pos.x < q.maxX && pos.z > q.minZ && pos.z < q.maxZ)) { i--; continue; } // centre dans une boîte : seul le Collision par segments (comme en jeu) ne sait pas en sortir
  const p = { x: pos.x, z: pos.z };
  resolveCollisions(pos, r, rects, half);
  arenaCases.push({ p, r, x: pos.x, z: pos.z });
}

const out = path.join(ROOT, 'godot/data/golden/j1.json');
fs.writeFileSync(out, JSON.stringify({ scene, resolve, ray, vault, arenaCases }) + '\n');
const hits = ray.filter((c) => c.t < c.maxT).length;
console.log(`${path.relative(ROOT, arenaOut)} : ${obstacles.length} obstacles ; ${path.relative(ROOT, out)} : ${resolve.length} resolve, ${ray.length} rayHit (${hits} touchent), ${vault.length} findVault (${vault.filter((v) => v.res).length} trouvés), ${arenaCases.length} cas d'arène`);
