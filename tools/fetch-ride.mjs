// Extends the intro route of public/data/rail.json to the south-west (the Molsheim line through Lingolsheim / Entzheim, ~4.7 km beyond the
// old start) and writes public/data/rideland.json : the real landscape along the whole ride (buildings, churches, fields, woods, water, roads,
// level crossings, bridges), all in the frame of area.json (x east, z south, metres).
//
// Data : OpenStreetMap (ODbL) map calls (api.openstreetmap.org, 0.01 degree tiles ; the Overpass mirrors are not reachable from the build box).
// Downloaded files are data only : parsed with JSON.parse, never executed. Keep them in a fresh directory.
//   node tools/fetch-ride.mjs --download <dir>            (NODE_USE_ENV_PROXY=1 behind an HTTPS proxy) : tiles -> <dir>
//   node tools/fetch-ride.mjs --tiles <dir> [--len 4700]  : builds rail.json (routes.intro prefix, neighbouring tracks) and rideland.json
// Re-running is safe : the prefix of a previous run (routes.intro.ext) is stripped first.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DL = opt('--download'), TILES = opt('--tiles'), LEN = parseFloat(opt('--len', 4700));
const RAIL_FILE = 'public/data/rail.json', LAND_FILE = 'public/data/rideland.json';
const area = JSON.parse(fs.readFileSync('public/data/area.json', 'utf8'));
const LAT = area.center.lat, LON = area.center.lon, M_LAT = 111320, M_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const toLocal = (lon, lat) => [(lon - LON) * M_LON, -(lat - LAT) * M_LAT];
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- download
if (DL) {
  fs.mkdirSync(DL, { recursive: true });
  const get = async (b) => {
    const name = `${DL}/t_${b.map((v) => v.toFixed(4)).join('_')}.json`;
    if (fs.existsSync(name)) return;
    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${b.map((v) => v.toFixed(5)).join(',')}`;
    for (let k = 0; k < 4; k++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'ZombieSurvivalGame/1.0 (tools/fetch-ride.mjs)' } }), txt = await res.text();
        if (res.status === 400 && /too many nodes/.test(txt)) { const [w, s, e, n] = b, mx = (w + e) / 2, my = (s + n) / 2; for (const q of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]) await get(q); return; }
        if (res.ok) { fs.writeFileSync(name, txt); console.log('ok', name, txt.length); return; }
        console.log('http', res.status, txt.slice(0, 80));
      } catch (e) { console.log('err', e.message); }
      await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
    }
  };
  // rows of 0.01 degree tiles covering lon 7.62..7.74, lat 48.535..48.59 (the line from Entzheim to the station)
  for (let lon = 7.62; lon < 7.7399; lon += 0.01) for (let lat = 48.535; lat < 48.5899; lat += 0.01) await get([lon, lat, lon + 0.01, lat + 0.01]);
  console.log('done');
  process.exit(0);
}
if (!TILES) { console.error('Usage: --download <dir> | --tiles <dir> [--len 4700]'); process.exit(1); }

// ---------------------------------------------------------------- load tiles
const nodes = new Map(), ways = new Map();
for (const f of fs.readdirSync(TILES)) {
  if (!f.endsWith('.json')) continue;
  for (const e of JSON.parse(fs.readFileSync(`${TILES}/${f}`, 'utf8')).elements) { if (e.type === 'node') nodes.set(e.id, e); else if (e.type === 'way') ways.set(e.id, e); }
}
console.log('nodes', nodes.size, 'ways', ways.size);
const rail = JSON.parse(fs.readFileSync(RAIL_FILE, 'utf8'));
const intro = rail.routes.intro;
if (intro.ext) { intro.samples = intro.samples.slice(intro.ext.n); rail.tracks = rail.tracks.filter((t) => !t.id.startsWith('osm-ext-')); rail.sources = rail.sources.filter((s) => !s.ext); delete intro.ext; }

// ---------------------------------------------------------------- geometry helpers
const pt = (id) => { const n = nodes.get(id); return n ? toLocal(n.lon, n.lat) : null; };
const wayPts = (w) => w.nodes.map(pt).filter(Boolean);
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// closed ring (first point = last) : simplified as two open halves
const simplifyRing = (pts, tol) => { const m = Math.floor(pts.length / 2), a = simplify(pts.slice(0, m + 1), tol), b = simplify(pts.slice(m), tol); return [...a, ...b.slice(1)]; };
const chaikin = (pts, it) => { for (let k = 0; k < it; k++) { const o = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; o.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]); } o.push(pts[pts.length - 1]); pts = o; } return pts; };
function resample(pts, step) {
  const out = [pts[0].slice()]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    for (; s <= d; s += step) out.push([ax + ((bx - ax) * s) / d, az + ((bz - az) * s) / d]);
    carry = d - (s - step);
  }
  return out;
}
// a polyline with cumulative lengths : nearest point (s, d)
function Poly(pts) {
  const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const cell = 40, grid = new Map(), key = (i, j) => i * 100003 + j;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; for (const x of [a[0], b[0], (a[0] + b[0]) / 2]) for (const z of [a[1], b[1], (a[1] + b[1]) / 2]) { const k = key(Math.floor(x / cell), Math.floor(z / cell)); let l = grid.get(k); if (!l) grid.set(k, l = new Set()); l.add(i); } }
  return {
    pts, S, L: S[S.length - 1],
    near(x, z, max = 400) {
      let bd = Infinity, bs = 0; const r = Math.ceil(max / cell);
      const i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
      for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
        const l = grid.get(key(i, j)); if (!l) continue;
        for (const k of l) { const [ax, az] = pts[k - 1], [bx, bz] = pts[k], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < bd) { bd = d; bs = S[k - 1] + t * Math.sqrt(l2); } }
      }
      return { s: bs, d: bd };
    },
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- 1) trace the line from the old start of the route
const N = new Map(), adj = new Map(), wayOf = new Map();
const addE = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
for (const w of ways.values()) {
  const t = w.tags || {};
  if (t.railway !== 'rail' || t.service) continue;
  w.nodes.forEach((id) => { const p = pt(id); if (p) N.set(id, p); });
  for (let i = 1; i < w.nodes.length; i++) { addE(w.nodes[i - 1], w.nodes[i]); wayOf.set(w.nodes[i - 1] + '-' + w.nodes[i], w); wayOf.set(w.nodes[i] + '-' + w.nodes[i - 1], w); }
}
const start = intro.samples[0], back = intro.samples[Math.min(40, intro.samples.length - 1)];
let dir = [start[0] - back[0], start[1] - back[1]]; { const l = Math.hypot(...dir); dir = [dir[0] / l, dir[1] / l]; }
let startNode = null, bd = Infinity;
for (const [id, p] of N) { const d = Math.hypot(p[0] - start[0], p[1] - start[1]); if (d < bd) { bd = d; startNode = id; } }
const path = [startNode]; let cur = startNode, prev = null, len = 0, dd = dir;
while (len < LEN + 400) {
  const c = (adj.get(cur) || []).filter((n) => n !== prev && !path.includes(n));
  let bn = null, bs = -2;
  for (const n of c) { const a = N.get(cur), b = N.get(n), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = ((b[0] - a[0]) * dd[0] + (b[1] - a[1]) * dd[1]) / l; if (k > bs) { bs = k; bn = n; } }
  if (!bn || bs < 0.2) break;
  const a = N.get(cur), b = N.get(bn), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l > 0.01) dd = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  len += l; prev = cur; cur = bn; path.push(cur);
}
console.log('traced', path.length, 'nodes', len.toFixed(0), 'm, start node offset', bd.toFixed(1), 'm');
// bridge flags per traced edge, then the smooth centreline (start node first)
const tracedPts = path.map((id) => N.get(id));
const edgeBridge = path.slice(1).map((id, i) => !!wayOf.get(path[i] + '-' + id)?.tags?.bridge);
let line = resample(chaikin(tracedPts, 3), 1);
{ // cut at LEN, drop the near end (the SNCF samples take over at the start node)
  let acc = 0, k = 1; for (; k < line.length; k++) { acc += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]); if (acc >= LEN) break; }
  line = line.slice(0, k + 1);
}
const traced = Poly(line);
// the join : shift the whole prefix so it ends exactly on the first SNCF sample (eased out over 600 m)
const sh = [start[0] - line[0][0], start[1] - line[0][1]];
const shiftAt = (s) => { const w = 1 - smooth(0, 600, s); return [sh[0] * w, sh[1] * w]; };
const prefix = line.map((p, i) => { const [dx, dz] = shiftAt(traced.S[i]); return [r1(p[0] + dx), r1(p[1] + dz)]; }).reverse();
prefix.pop(); // (the last prefix sample is the SNCF start)
intro.samples = [...prefix, ...intro.samples];
intro.length = Math.round(intro.samples.length);
intro.ext = { n: prefix.length, source: 'OSM', note: 'tools/fetch-ride.mjs' };
rail.sources.push({ name: 'OpenStreetMap contributors (Molsheim line, 2026, OSM API map calls)', licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', date: new Date().toISOString().slice(0, 10), ext: true });
console.log('prefix', prefix.length, 'samples; route now', intro.samples.length, 'samples');

// ---------------------------------------------------------------- 2) neighbouring tracks of the extension (the other track of the double line, sidings)
const full = Poly(intro.samples.map((p) => [p[0], p[1]])), pre = prefix.length;
const used = new Set(path.slice(1).map((id, i) => wayOf.get(path[i] + '-' + id)?.id));
let nTr = 0;
for (const w of ways.values()) {
  const t = w.tags || {};
  if (t.railway !== 'rail' || t.service || used.has(w.id)) continue;
  const dense = resample(wayPts(w), 2); let run = [];
  const flush = () => { if (run.length > 2) { rail.tracks.push({ id: 'osm-ext-' + w.id + '-' + nTr, type: 'VPL', pts: simplify(run, 0.3).map(([x, z]) => [r1(x), r1(z)]) }); nTr++; } run = []; };
  for (let p of dense) {
    const u = traced.near(p[0], p[1], 40), [dx, dz] = shiftAt(u.s); // (the same shift as the route near the join)
    p = [p[0] + dx, p[1] + dz];
    const q = full.near(p[0], p[1], 40);
    if (u.d > 3.2 && u.d < 26 && q.s > 30 && q.s < pre - 10) run.push(p); else flush();
  }
  flush();
}
console.log('neighbouring tracks', nTr);

// ---------------------------------------------------------------- 3) the landscape (rideland.json)
const R = 220; // m from the route
const near = (x, z, m = R) => full.near(x, z, m + 20);
const land = { buildings: [], churches: [], fields: [], woods: [], water: [], streams: [], roads: [], crossings: [], bridges: [] };
const FIELD = new Set(['farmland', 'meadow', 'grass', 'farmyard', 'grassland', 'allotments', 'orchard', 'vineyard', 'cemetery', 'recreation_ground', 'pitch']);
const WOOD = new Set(['forest', 'wood', 'scrub', 'park']);
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
function obb(p) { // oriented bounding box by the polygon edges : [cx, cz, L, D, yaw] (L >= D, local +x along L)
  let best = null;
  for (let i = 1; i < p.length; i++) {
    const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of p) { const x = q[0] * c + q[1] * s, z = -q[0] * s + q[1] * c; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const ar = (x1 - x0) * (z1 - z0);
    if (!best || ar < best.ar) best = { ar, a, x0, x1, z0, z1 };
  }
  if (!best) return null;
  const { a, x0, x1, z0, z1 } = best, c = Math.cos(a), s = Math.sin(a), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  let L = x1 - x0, D = z1 - z0, yaw = a; if (D > L) { [L, D] = [D, L]; yaw = a + Math.PI / 2; }
  return [r1(mx * c - mz * s), r1(mx * s + mz * c), r1(L), r1(D), Math.round(yaw * 100) / 100];
}
for (const w of ways.values()) {
  const t = w.tags || {}, p = wayPts(w);
  if (p.length < 2) continue;
  const [cx, cz] = centroid(p);
  if (t.building && p.length > 3) {
    const q = near(cx, cz, 170); if (q.d > 170 || q.d < 7) continue;
    const b = obb(p); if (!b || b[2] * b[3] < 16) continue;
    const kind = /church|chapel|cathedral/.test(t.building) || t.amenity === 'place_of_worship' ? 'c' : /industrial|warehouse|retail|commercial|hangar|garage/.test(t.building) ? 'w' : /apartments|residential/.test(t.building) && +t['building:levels'] > 2 ? 'a' : 'h';
    (kind === 'c' ? land.churches : land.buildings).push([...b, kind, Math.min(8, +t['building:levels'] || 0)]);
  } else if (t.railway || t.tram) continue;
  else if (t.landuse || t.natural || t.leisure) {
    const k = t.landuse || t.natural || t.leisure, q = near(cx, cz, 300); if (q.d > 280) continue;
    if (!(p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5)) continue;
    const sp = simplifyRing(p, 2.5).map(([x, z]) => [r1(x), r1(z)]); if (sp.length < 4) continue;
    if (FIELD.has(k)) land.fields.push({ k: k === 'orchard' || k === 'vineyard' ? 'o' : k === 'farmland' ? 'f' : k === 'allotments' ? 'a' : 'g', p: sp });
    else if (WOOD.has(k)) land.woods.push({ k: k === 'scrub' ? 's' : 'w', p: sp });
    else if (k === 'water') land.water.push({ p: sp });
  } else if (t.waterway && /river|stream|canal|ditch|drain/.test(t.waterway)) {
    const q = near(cx, cz, 300); if (q.d > 280) continue;
    land.streams.push({ k: t.waterway === 'river' ? 3 : t.waterway === 'canal' ? 2 : 1, p: simplify(p, 2).map(([x, z]) => [r1(x), r1(z)]) });
  } else if (t.highway && /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service|living_street)$/.test(t.highway)) {
    const q = near(cx, cz, 300); if (q.d > 260) continue;
    land.roads.push({ k: t.highway === 'track' ? 0 : /residential|service|unclassified|living/.test(t.highway) ? 1 : t.highway === 'tertiary' ? 2 : 3, br: t.bridge ? 1 : 0, p: simplify(p, 1.5).map(([x, z]) => [r1(x), r1(z)]) });
  }
}
// level crossings : yaw of the nearest road
for (const n of nodes.values()) {
  if (n.tags?.railway !== 'level_crossing') continue;
  const p = toLocal(n.lon, n.lat), q = full.near(p[0], p[1], 12); if (q.d > 8) continue;
  let best = null, bdist = 1e9;
  for (const r of land.roads) for (let i = 1; i < r.p.length; i++) { const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, tt = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)), d = Math.hypot(ax + dx * tt - p[0], az + dz * tt - p[1]); if (d < bdist) { bdist = d; best = { yaw: Math.atan2(dz, dx), k: r.k }; } }
  land.crossings.push([r1(p[0]), r1(p[1]), best ? Math.round(best.yaw * 100) / 100 : 0, best ? best.k : 1]);
}
// bridges of the traced line : runs of bridge edges (start / end points, what they cross)
{
  let a = -1;
  const done = (i0, i1) => {
    const p0 = line[0], pa = tracedPts[i0], pb = tracedPts[i1];
    const ma = traced.near(pa[0], pa[1], 15), mb = traced.near(pb[0], pb[1], 15); // (positions on the smooth line)
    const at = (s) => { let i = 1; while (i < traced.S.length - 1 && traced.S[i] < s) i++; const t = (s - traced.S[i - 1]) / (traced.S[i] - traced.S[i - 1] || 1); return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; };
    const s0 = Math.min(ma.s, mb.s), s1 = Math.max(ma.s, mb.s); if (s1 - s0 < 4 || s0 > LEN) return;
    const mid = at((s0 + s1) / 2); let over = 'road';
    for (const r of land.streams) if (r.p.some(([x, z]) => Math.hypot(x - mid[0], z - mid[1]) < (s1 - s0) / 2 + 6)) over = 'water';
    const [dx, dz] = shiftAt((s0 + s1) / 2), A = at(s0), B = at(s1);
    land.bridges.push({ a: [r1(A[0] + dx), r1(A[1] + dz)], b: [r1(B[0] + dx), r1(B[1] + dz)], over });
  };
  for (let i = 0; i < edgeBridge.length; i++) { if (edgeBridge[i] && a < 0) a = i; if ((!edgeBridge[i] || i === edgeBridge.length - 1) && a >= 0) { done(a, edgeBridge[i] ? i + 1 : i); a = -1; } }
}
// merge bridges that touch (the two ways of a double bridge are one)
land.bridges = land.bridges.filter((b, i, l) => !l.slice(0, i).some((c) => Math.hypot(c.a[0] - b.a[0], c.a[1] - b.a[1]) < 25 && Math.hypot(c.b[0] - b.b[0], c.b[1] - b.b[1]) < 25));
console.log('buildings', land.buildings.length, 'churches', land.churches.length, 'fields', land.fields.length, 'woods', land.woods.length, 'water', land.water.length, 'streams', land.streams.length, 'roads', land.roads.length, 'crossings', land.crossings.length, 'bridges', land.bridges.length);
fs.writeFileSync(RAIL_FILE, JSON.stringify(rail));
fs.writeFileSync(LAND_FILE, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL 1.0), tools/fetch-ride.mjs', land }));
console.log('written', RAIL_FILE, fs.statSync(RAIL_FILE).size, LAND_FILE, fs.statSync(LAND_FILE).size);
