// J3 : valeurs de référence du champ de flux (src/nav.js), des liens d'escalier (src/levels.js) et des grilles d'étage pour les tests headless du port Godot.
//   godot/data/golden/j3.json
// Le JS est exécuté TEL QUEL sur les données cuites (godot/data/world/ : grille de navigation, collision, étages) : NavGrid.updateField / computeField /
// steer / los / clear / nearestFree / components, Levels.buildNavs / nextHop / hopDistance / endRegion / project / pointOn. Aucune valeur n'est recalculée à la main.
// Usage : node tools/export-golden-j3.mjs     (nécessite le monde cuit : tools/bake-world.mjs)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = path.join(ROOT, 'godot/data/world');
const { CONFIG } = await import(path.join(ROOT, 'src/config.js'));
const { NavGrid } = await import(path.join(ROOT, 'src/nav.js'));
const { Collision } = await import(path.join(ROOT, 'src/collision.js'));
const { Levels } = await import(path.join(ROOT, 'src/levels.js'));

let seed = 20260612;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);
const pick = (n) => Math.floor(rnd() * n);
const json = (p) => JSON.parse(fs.readFileSync(path.join(W, p), 'utf8'));
const INF = 0x3fffffff;

// ---------------------------------------------------------------- grille de la carte (cuite)
const meta = json('nav/meta.json');
const blocked0 = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(W, 'nav/blocked.u8.gz'))));
const objects = json('objects.json');
const mkNav = (open) => {
  const nav = new NavGrid(meta.halfX, meta.halfZ, null, [], meta.cell, meta.margin, 1300);
  nav.blocked.set(blocked0);
  nav.vaultCost = CONFIG.zombie.vault.cost;
  if (open) for (const d of objects.doors) for (const c of d.cells) nav.blocked[c] = 0;
  return nav;
};
const F = CONFIG.zombie.flow;
const maxCost = Math.round((F.range / meta.cell) * 10);
const cellsOf = (nav, n, pred) => { const out = []; for (let t = 0; t < 4000000 && out.length < n; t++) { const i = pick(nav.nx * nav.nz); if (pred(i)) out.push(i); } return out; };
const freeRandom = (nav, n, near) => cellsOf(nav, n, (i) => {
  if (nav.blocked[i]) return false;
  if (!near) return true;
  return Math.hypot(nav.worldX(i % nav.nx) - near[0], nav.worldZ((i / nav.nx) | 0) - near[1]) < 90;
});
const hashBlocked = (b) => { let h = 0; for (let i = 0; i < b.length; i++) h = (h + b[i] * (1 + (i % 251))) % 2147483647; return h; };

const out = { meta: { maxCost, vaultCost: CONFIG.zombie.vault.cost }, fields: [], nearest: [], components: [], regions: [], hops: {}, links: [] };

// positions de départ : quartiers variés (centres de zones) + départ du jeu
const starts = [[objects.start.x, objects.start.z]];
for (const z of objects.zones) { if (z.center || z.x != null) starts.push([z.center ? z.center.x : z.x, z.center ? z.center.z : z.z]); }
const spots = [];
for (let i = 0; i < 6; i++) spots.push(starts[pick(starts.length)] || starts[0]);

for (const open of [false, true]) {
  const nav = mkNav(open);
  for (let s = 0; s < 6; s++) {
    const tg = [{ x: spots[s][0] + R(-3, 3), z: spots[s][1] + R(-3, 3) }];
    if (s >= 4) tg.push({ x: spots[(s + 1) % 6][0] + R(-3, 3), z: spots[(s + 1) % 6][1] + R(-3, 3) }); // deux joueurs
    nav.job = null;
    while (nav.updateField(tg, 7000, maxCost)) { /* tranches : même résultat que d'un coup */ }
    let reached = 0, sum = 0;
    for (let i = 0; i < nav.dist.length; i++) if (nav.dist[i] < INF) { reached++; sum = (sum + nav.dist[i]) % 2147483647; }
    // cases à contrôler : atteintes (proches du bord du champ comprises), non atteintes, bloquées, enjambables
    const near = tg[0];
    const reachedCells = []; for (let i = 0; i < nav.dist.length && reachedCells.length < 5000; i++) if (nav.dist[i] < INF && rnd() < 0.5) reachedCells.push(i);
    const sample = [];
    for (let k = 0; k < 400 && reachedCells.length; k++) sample.push(reachedCells[pick(reachedCells.length)]);
    for (const i of freeRandom(nav, 60, [near.x, near.z])) sample.push(i);
    for (const i of cellsOf(nav, 40, (i) => nav.blocked[i] === 2)) sample.push(i);
    for (const i of cellsOf(nav, 20, (i) => nav.blocked[i] === 1)) sample.push(i);
    // cases de vault proches du champ
    const vaultNear = []; for (let i = 0; i < nav.dist.length && vaultNear.length < 40; i++) if (nav.blocked[i] === 2 && nav.dist[i] < INF && rnd() < 0.1) vaultNear.push(i);
    sample.push(...vaultNear);
    // steer / walkDistance / los / clear en des points continus de la zone du champ
    const steer = [], walk = [], los = [], clear = [];
    for (let k = 0; k < 300; k++) {
      const i = reachedCells[pick(reachedCells.length)];
      const x = nav.worldX(i % nav.nx) + R(-0.37, 0.37), z = nav.worldZ((i / nav.nx) | 0) + R(-0.37, 0.37);
      const o = { x: 0, z: 0 };
      const r = nav.steer(x, z, o);
      steer.push([x, z, r ? o.x : null, r ? o.z : null]);
      const wd = nav.walkDistance(x, z);
      walk.push([x, z, Number.isFinite(wd) ? wd : null]);
    }
    for (let k = 0; k < 300; k++) {
      const i = reachedCells[pick(reachedCells.length)];
      const x0 = nav.worldX(i % nav.nx), z0 = nav.worldZ((i / nav.nx) | 0);
      const a = R(0, 6.2832), l = R(0.5, 25);
      const x1 = x0 + Math.cos(a) * l, z1 = z0 + Math.sin(a) * l;
      los.push([x0, z0, x1, z1, nav.los(x0, z0, x1, z1)]);
      clear.push([x0, z0, x1, z1, nav.clear(x0, z0, x1, z1)]);
    }
    out.fields.push({ open, targets: tg.map((t) => [t.x, t.z]), reached, sum, cells: sample.map((i) => [i, nav.dist[i] >= INF ? null : nav.dist[i]]), steer, walk, los, clear });
  }
  // case libre la plus proche (spirale)
  const nf = [];
  for (let k = 0; k < 120; k++) {
    const i = pick(nav.nx * nav.nz);
    const x = nav.worldX(i % nav.nx) + R(-0.4, 0.4), z = nav.worldZ((i / nav.nx) | 0) + R(-0.4, 0.4);
    const r = nav.nearestFree(x, z, k % 3 ? 12 : 4);
    nf.push([x, z, k % 3 ? 12 : 4, r ? nav.idx(r[0], r[1]) : null]);
  }
  out.nearest.push({ open, cases: nf });
  // composantes connexes de la grille entière
  nav.invalidate();
  const c = nav.components();
  const sizes = c.sizes.slice(1).sort((a, b) => b - a);
  let lh = 0; for (let i = 0; i < c.labels.length; i++) if (c.labels[i]) lh = (lh + (i % 251 + 1) * (c.sizes[c.labels[i]] % 1009)) % 2147483647;
  out.components.push({ open, count: c.sizes.length - 1, top: sizes.slice(0, 8), tiny: sizes.filter((s) => s < 20).length, sig: lh });
}

// ---------------------------------------------------------------- étages : Levels + Collision cuits, grilles d'étage, liens
const cm = json('collision/meta.json');
const col = new Collision(cm.halfX, cm.halfZ, cm.cell);
{
  const sd = new Float64Array(fs.readFileSync(path.join(W, 'collision/segs.f64')).buffer.slice(0));
  const cd = new Float64Array(fs.readFileSync(path.join(W, 'collision/circles.f64')).buffer.slice(0));
  for (let i = 0; i < sd.length; i += 10) { const s = col.addSegment(sd[i], sd[i + 1], sd[i + 2], sd[i + 3], sd[i + 4], sd[i + 5], sd[i + 6] > 0.5 ? 'prop' : 'wall', sd[i + 7]); s.off = sd[i + 9] > 0.5; }
  for (let i = 0; i < cd.length; i += 8) { const c = { x: cd[i], z: cd[i + 1], r: cd[i + 2], h: cd[i + 3], y0: cd[i + 4], kind: cd[i + 5] > 0.5 ? 'prop' : 'wall', vid: cd[i + 6], off: cd[i + 7] > 0.5, stamp: 0 }; col.circles.push(c); }
  col.build();
}
const lj = json('levels.json');
const lev = new Levels();
for (const r of lj.regions.slice(1)) lev.addRegion(r.name, r.y, r.kind);
for (const t of lj.tris) lev.addTri(t[0], [t[1], t[2], t[3]], [t[4], t[5], t[6]], [t[7], t[8], t[9]]);
for (const l of lj.links) lev.addLink(l.name, l.a, l.b, l.path, l.region);
lev.build();
lev.buildNavs(NavGrid, col);
for (const R_ of lev.regions) {
  if (!R_.nav) continue;
  const n = R_.nav;
  const cnt = [0, 0, 0]; for (const v of n.blocked) cnt[v]++;
  const e = { region: R_.id, nx: n.nx, nz: n.nz, ox: n.ox, oz: n.oz, counts: cnt, hash: hashBlocked(n.blocked), field: null };
  // champ complet depuis une case libre au hasard (ou deux)
  const free = []; for (let i = 0; i < n.blocked.length; i++) if (!n.blocked[i]) free.push(i);
  if (free.length) {
    const tg = [free[pick(free.length)]].map((i) => ({ x: n.worldX(i % n.nx), z: n.worldZ((i / n.nx) | 0) }));
    n.computeField(tg);
    let reached = 0, sum = 0; for (const d of n.dist) if (d < INF) { reached++; sum = (sum + d) % 2147483647; }
    const cells = []; for (let k = 0; k < 150; k++) { const i = pick(n.dist.length); cells.push([i, n.dist[i] >= INF ? null : n.dist[i]]); }
    const steer = [];
    for (let k = 0; k < 60 && free.length; k++) { const i = free[pick(free.length)]; const x = n.worldX(i % n.nx), z = n.worldZ((i / n.nx) | 0); const o = { x: 0, z: 0 }; const r = n.steer(x, z, o); steer.push([x, z, r ? o.x : null, r ? o.z : null]); }
    e.field = { targets: tg.map((t) => [t.x, t.z]), reached, sum, cells, steer };
  }
  out.regions.push(e);
}
// liens : nextHop, hopDistance, endRegion, project, pointOn
const nreg = lev.regions.length;
out.hops.next = []; out.hops.dist = [];
for (let a = 0; a < nreg; a++) for (let b = 0; b < nreg; b++) {
  const h = lev.nextHop(a, b), d = lev.hopDistance(a, b);
  out.hops.next.push([a, b, h ? h.link.id : null, h ? h.dir : null, h ? h.next : null]);
  out.hops.dist.push([a, b, Number.isFinite(d) ? d : null]);
}
for (let k = 0; k < 120; k++) {
  const L = lev.links[pick(lev.links.length)];
  const p = L.path[pick(L.path.length)];
  const x = p[0] + R(-1.5, 1.5), z = p[2] + R(-1.5, 1.5), y = p[1] + R(-0.8, 0.8);
  const s = lev.project(L, x, z, y);
  if (Math.abs(s - L.length / 2) < 1e-6) continue; // pile au milieu du lien : départagé à 1 ulp près, sans intérêt
  const o = {}; lev.pointOn(L, R(-1, L.length + 1), o);
  out.links.push({ link: L.id, x, y, z, project: s, end: lev.endRegion(L.region == null ? L.a : L.region, x, z, y), regionArg: L.region == null ? L.a : L.region, point: [o.x, o.y, o.z, o.yaw], s: null });
}
// pointOn avec abscisses connues
out.pointOn = [];
for (let k = 0; k < 120; k++) { const L = lev.links[pick(lev.links.length)]; const s = R(-1, L.length + 1); const o = {}; lev.pointOn(L, s, o); out.pointOn.push([L.id, s, o.x, o.y, o.z, o.yaw]); }
out.regionsInfo = lev.regions.map((r) => ({ id: r.id, kind: r.kind, hasNav: !!r.nav }));

// pondération de l'apparition entre joueurs (main.js spawnTarget) : poids 1 / (1 + n)
out.balance = [];
for (let k = 0; k < 30; k++) {
  const R_ = CONFIG.zombie.spawnBalance.radius;
  const players = [], zs = [];
  for (let i = 0; i < 2 + pick(3); i++) players.push([R(-200, 200), R(-200, 200)]);
  for (let i = 0; i < pick(20); i++) { const p = players[pick(players.length)]; zs.push([p[0] + R(-80, 80), p[1] + R(-80, 80)]); }
  const w = players.map((pl) => { let n = 0; for (const z of zs) if (Math.hypot(z[0] - pl[0], z[1] - pl[1]) < R_) n++; return 1 / (1 + n); });
  out.balance.push({ radius: R_, players, zombies: zs, weights: w });
}

const dest = path.join(ROOT, 'godot/data/golden/j3.json');
fs.writeFileSync(dest, JSON.stringify(out) + '\n');
console.log(`j3.json : ${(fs.statSync(dest).size / 1024).toFixed(0)} Ko, ${out.fields.length} champs, ${out.regions.length} grilles d'étage, ${out.components.map((c) => c.count).join('/')} composantes`);
