// Rail clearance scan (v0.99.0) : finds everything whose footprint enters the train's clearance corridor, in the real game (Playwright, ?debug&gare).
//
//   node tools/rail-clear-scan.mjs [url] [out.json]
//     url      game already running (npm run dev) ; default http://localhost:5173/
//     out.json report (default ./rail-clear-out.json) ; the categories and counts are printed
//   variables : HALF=2.4 (m from the track axis) · TOP=4.6 (m above the rail head) · LOW=0.45 (things lower than this above the rail head are the track itself : ballast, rails, sleepers)
//               PLAYWRIGHT=/path/to/playwright/index.mjs · CHROME=/path/to/chrome · STATION=0 (the intro route only, not the other station tracks)
//
// What it samples : the intro route (the track the train runs on : the open line, the approach, quai 1) and, unless STATION=0, every other SNCF track of the station area
// (rail.json, |u| < stationClip.u). Corridor = the polyline offset by HALF on both sides, from the rail head + LOW to + TOP. Where it looks :
//   collision   every wall segment and circle of the collision grid (buildings, walls, fences, trees, lamps, props, cars, wrecks) : the part that blocks bodies
//   instances   every InstancedMesh of the station and of the ride scenery (trees, lamps, signals, houses, hedges, posts, girders...) : bounding box of each instance
//   meshes      the triangles of the merged meshes of the station and the ride (building walls, canopies, columns, bridges) : edges sampled every metre
// Near a platform, things lower than 1.3 m and further than 1.5 m from the axis are the platform edge itself and are listed apart ('platformEdge').
// The collision grid also holds the island (area.json) : anything of it near the line is listed too. The game is loaded with ?keepgeom (CPU vertex arrays kept).
import fs from 'fs';
import path from 'path';

const URL_ = process.argv[2] || 'http://localhost:5173/';
const OUT = path.resolve(process.argv[3] || 'rail-clear-out.json');
const OPTS = { half: +(process.env.HALF || 2.4), top: +(process.env.TOP || 4.6), low: +(process.env.LOW || 0.45), station: process.env.STATION !== '0' };

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found : set PLAYWRIGHT=/path/to/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 320, height: 200 } })).newPage();
page.setDefaultTimeout(0);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/theme|404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.addInitScript(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 4000); try { localStorage.setItem('zombie_settings', JSON.stringify({ quality: 0 })); } catch { /* ignore */ } });
await page.goto(`${URL_}${URL_.includes('?') ? '&' : '?'}debug&gare&keepgeom`, { timeout: 600000 });
await page.waitForFunction(() => window.game && window.game.world && window.game.world.gare && window.game.started, null, { timeout: 600000 });
await page.waitForTimeout(1500);

const report = await page.evaluate((O) => {
  const game = window.game, world = game.world, G = world.gare, route = G.route, tr = route.track, plan = G.plan, railY = G.train ? G.train.railY : -0.74;
  const lo = railY + O.low, hi = railY + O.top, HALF = O.half;
  // ---- polylines : the route, then the other tracks of the station area ; samples every ~1 m in a hash grid (8 m cells)
  const CELL = 8, grid = new Map(), key = (i, j) => i * 100003 + j, polyName = [];
  const put = (x, z, id) => { const k = key(Math.floor(x / CELL), Math.floor(z / CELL)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(x, z, id); };
  const addPoly = (name, pts) => { const id = polyName.push(name) - 1; for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d)); for (let k = 0; k <= n; k++) put(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, id); } };
  const rp = []; for (let i = 0; i < tr.n; i++) rp.push([tr.x[i], tr.z[i]]);
  addPoly('route', rp);
  if (O.station) for (const t of G.rail?.tracks || []) { if (t.type === 'OSM' || !t.pts?.length) continue; const inside = t.pts.some(([x, z]) => Math.abs(plan.L(x, z)[0]) < 230); if (inside) addPoly(t.id || t.name || 'track', t.pts); }
  // nearest polyline sample within r of (x, z) : { d, id } or null
  const near = (x, z, r) => {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    let best = Infinity, bid = -1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = grid.get(key(i, j)); if (!a) continue; for (let k = 0; k < a.length; k += 3) { const dx = a[k] - x, dz = a[k + 1] - z, d = Math.hypot(dx, dz); if (d < best) { best = d; bid = a[k + 2]; } } }
    return best <= r ? { d: best, id: bid } : null;
  };
  const sOf = (x, z) => { const o = tr.project(x, z, 30, {}); return o.d === Infinity ? -1 : Math.round(o.s); };
  const uvOf = (x, z) => plan.L(x, z).map((v) => Math.round(v * 10) / 10);
  const res = { opts: O, railY, polylines: polyName.length, cats: {}, items: [] }, seen = new Set();
  const hit = (cat, name, x, z, info) => {
    const tid0 = info.tid;
    const k = cat + '|' + name + '|' + Math.round(x * 2) + '|' + Math.round(z * 2);
    if (seen.has(k)) return; seen.add(k);
    const c = res.cats[cat] || (res.cats[cat] = {}), tk = polyName[info.tid] === 'route' ? 'route' : 'other'; delete info.tid; const e = c[name] || (c[name] = { route: 0, other: 0 }); e[tk]++;
    res.items.push({ cat, name, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, s: sOf(x, z), uv: uvOf(x, z), ...info, track: polyName[tid0] });
  };
  // ---- 1. collision : segments (walls) and circles (trees, lamps, props)
  const col = world.collision;
  const lowEdge = (it, d) => it.h !== undefined && it.h <= 1.3 && d >= 1.5;
  let nseg = 0, ncirc = 0;
  if (col) {
    for (const sg of col.segs) {
      const l = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az), n = Math.max(1, Math.ceil(l)); nseg++;
      for (let k = 0; k <= n; k++) {
        const x = sg.ax + ((sg.bx - sg.ax) * k) / n, z = sg.az + ((sg.bz - sg.az) * k) / n, q = near(x, z, HALF);
        if (!q) continue;
        if (sg.y0 !== undefined && sg.y0 > O.top) break; // (a bridge deck, a floor above)
        hit(lowEdge(sg, q.d) ? 'platformEdge' : 'collision', 'wall:' + (sg.kind || 'wall') + (sg.h === Infinity ? '' : ':h' + Math.round(sg.h)), x, z, { tid: q.id, track: polyName[q.id], d: Math.round(q.d * 10) / 10, h: sg.h === Infinity ? 'inf' : sg.h });
        break;
      }
    }
    for (const c of col.circles) { ncirc++; const q = near(c.x, c.z, HALF + c.r); if (q) hit(lowEdge(c, q.d - c.r) ? 'platformEdge' : 'collision', 'circle:' + (c.kind || 'prop') + ':r' + c.r.toFixed(1), c.x, c.z, { tid: q.id, track: polyName[q.id], d: Math.round(q.d * 10) / 10, h: c.h }); }
  }
  res.scanned = { segs: nseg, circles: ncirc };
  // ---- 2. instanced meshes (station and ride) : the bounding box of each instance
  const m4 = new window.game.scene.matrix.constructor(), v3 = new window.game.scene.position.constructor();
  const roots = [G.root, G.scenery ? G.scenery.root : null].filter(Boolean);
  const skipName = /^train|^railNet|^ride:(ground|field|road|water|crossing|wood|fence$)|shadowProxy/;
  let ninst = 0, ntri = 0;
  for (const root of roots) root.traverse((o) => {
    if (!o.isMesh || skipName.test(o.name || '')) return;
    const nm = o.name || o.parent?.name || '?';
    if (o.isInstancedMesh) {
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4); ninst++;
        v3.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2).applyMatrix4(m4).applyMatrix4(o.matrixWorld);
        const e = m4.elements;
        const y0 = v3.y - ((bb.max.y - bb.min.y) * Math.hypot(e[4], e[5], e[6])) / 2, y1 = v3.y + ((bb.max.y - bb.min.y) * Math.hypot(e[4], e[5], e[6])) / 2;
        if (y1 < lo || y0 > hi) continue;
        // footprint : the xz rectangle of the local bounding box through the instance matrix, sampled every ~0.8 m
        const cs = [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z], [bb.min.x, bb.max.z]].map(([x, z]) => { v3.set(x, 0, z).applyMatrix4(m4).applyMatrix4(o.matrixWorld); return [v3.x, v3.z]; });
        const nu = Math.max(1, Math.ceil(Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]) / 0.8)), nv = Math.max(1, Math.ceil(Math.hypot(cs[3][0] - cs[0][0], cs[3][1] - cs[0][1]) / 0.8));
        let q = null, fx = 0, fz = 0;
        for (let i = 0; i <= nu && !q; i++) for (let j = 0; j <= nv && !q; j++) { const x = cs[0][0] + ((cs[1][0] - cs[0][0]) * i) / nu + ((cs[3][0] - cs[0][0]) * j) / nv, z = cs[0][1] + ((cs[1][1] - cs[0][1]) * i) / nu + ((cs[3][1] - cs[0][1]) * j) / nv; q = near(x, z, HALF); fx = x; fz = z; }
        if (q) hit('instances', nm, fx, fz, { tid: q.id, track: polyName[q.id], d: Math.round(q.d * 10) / 10, y: [Math.round(y0 * 10) / 10, Math.round(y1 * 10) / 10] });
      }
    } else {
      const g = o.geometry, p = g.attributes.position, idx = g.index; if (!p || !p.array) return; // (without ?keepgeom the static meshes free their CPU arrays after the GPU upload)
      o.updateMatrixWorld(true); const mw = o.matrixWorld, n = idx ? idx.count : p.count, A = [0, 0, 0].map(() => v3.clone());
      for (let t = 0; t + 2 < n; t += 3) {
        for (let k = 0; k < 3; k++) A[k].fromBufferAttribute(p, idx ? idx.getX(t + k) : t + k).applyMatrix4(mw);
        ntri++;
        const y0 = Math.min(A[0].y, A[1].y, A[2].y), y1 = Math.max(A[0].y, A[1].y, A[2].y);
        if (y1 < lo || y0 > hi) continue;
        const bx0 = Math.min(A[0].x, A[1].x, A[2].x), bx1 = Math.max(A[0].x, A[1].x, A[2].x), bz0 = Math.min(A[0].z, A[1].z, A[2].z), bz1 = Math.max(A[0].z, A[1].z, A[2].z);
        if (!near((bx0 + bx1) / 2, (bz0 + bz1) / 2, HALF + Math.hypot(bx1 - bx0, bz1 - bz0) / 2 + 0.01)) continue; // quick reject
        let found = null;
        for (let e = 0; e < 3 && !found; e++) { // edges sampled every metre, plus the centroid
          const a = A[e], b = A[(e + 1) % 3], l = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(1, Math.ceil(l));
          for (let k = 0; k <= m; k++) { const x = a.x + ((b.x - a.x) * k) / m, z = a.z + ((b.z - a.z) * k) / m, q = near(x, z, HALF); if (q) { found = { x, z, q }; break; } }
        }
        if (!found) { const cx = (A[0].x + A[1].x + A[2].x) / 3, cz = (A[0].z + A[1].z + A[2].z) / 3, q = near(cx, cz, HALF); if (q) found = { x: cx, z: cz, q }; }
        if (!found) continue;
        const low = y1 <= railY + 1.3 && found.q.d >= 1.5;
        hit(low ? 'platformEdge' : 'meshes', nm, found.x, found.z, { tid: found.q.id, track: polyName[found.q.id], d: Math.round(found.q.d * 10) / 10, y: [Math.round(y0 * 10) / 10, Math.round(y1 * 10) / 10] });
      }
    }
  });
  res.scanned.instances = ninst; res.scanned.triangles = ntri;
  const total = {}; for (const [c, m] of Object.entries(res.cats)) { total[c] = { route: 0, other: 0 }; for (const v of Object.values(m)) { total[c].route += v.route; total[c].other += v.other; } }
  res.total = total;
  return res;
}, OPTS);

fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log('scanned', JSON.stringify(report.scanned), 'polylines', report.polylines, 'railY', report.railY);
for (const [cat, m] of Object.entries(report.cats)) { console.log(`\n${cat} : route ${report.total[cat].route}, other tracks ${report.total[cat].other}`); for (const [n, c] of Object.entries(m).sort((a, b) => b[1].route + b[1].other - a[1].route - a[1].other)) console.log(`  route ${String(c.route).padStart(4)}  other ${String(c.other).padStart(4)}  ${n}`); }
console.log(errors.length ? '\nerrors:\n' + errors.join('\n') : '\nno console errors');
console.log('report', OUT);
await browser.close();
