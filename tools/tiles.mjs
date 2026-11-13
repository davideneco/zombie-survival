// World tiles outside the island core (step B). Produces public/data/tiles/t_<ix>_<iz>.json + manifest.json in the frame of area.json
// (origin = its centre, x east, z south, metres). Tile (ix, iz) covers [ix * size, (ix + 1) * size) x [iz * size, (iz + 1) * size).
//
//   NODE_USE_ENV_PROXY=1 node tools/tiles.mjs --fetch x0,z0,x1,z1 [--raw .cache/tiles-raw]   download the raw OSM data of every tile touching the rect
//   node tools/tiles.mjs --build  [--raw .cache/tiles-raw]                                       raw -> public/data/tiles/*.json + manifest.json
//   node tools/tiles.mjs --verify                                                                manifest hashes vs files
//
// Data: OpenStreetMap (ODbL), api.openstreetmap.org map calls first (proven from the build box), then the Overpass mirrors overpass.kumi.systems and
// overpass.private.coffee. IGN BD TOPO (data.geopf.fr) is not reachable from the build box: heights come from the OSM `height` tag, then
// `building:levels`, then CONFIG.world.defaultLevels (recorded as `hSrc`). Downloaded files are untrusted data: only JSON.parse, never executed;
// the raw cache is git-ignored (.cache/).
//
// Rules of the build (so that nothing is built twice and every peer sees the same tile):
//  - a building belongs to the tile that contains its centroid; one with ANY vertex inside the core rect is already built by area.json and is dropped;
//  - each file also carries `halo` m of the neighbours' outlines (`halo: 1`, never built) so street detection does not need the neighbour tile;
//  - elements sorted by OSM id, coordinates rounded to the centimetre, so the files (and the manifest hash) are byte-stable between runs.
import fs from 'node:fs';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const RAW = opt('--raw', '.cache/tiles-raw'), OUT = 'public/data/tiles';
const area = JSON.parse(fs.readFileSync('public/data/area.json', 'utf8'));
const LAT = area.center.lat, LON = area.center.lon, M_LAT = 111320, M_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
// the world constants live in src/config.js (an ES module that only needs plain objects): read them as text so this tool has no browser dependencies
const cfgText = fs.readFileSync('src/config.js', 'utf8');
const cfgNum = (re, d) => { const m = cfgText.match(re); return m ? parseFloat(m[1]) : d; };
const SIZE = cfgNum(/world: \{[\s\S]*?tileSize: (\d+)/, 480), HALO = cfgNum(/world: \{[\s\S]*?halo: (\d+)/, 30), DEF_LEVELS = cfgNum(/world: \{[\s\S]*?defaultLevels: (\d+)/, 5);
const coreM = cfgText.match(/world: \{[\s\S]*?core: \{ x0: (-?\d+), x1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}/);
const CORE = coreM ? { x0: +coreM[1], x1: +coreM[2], z0: +coreM[3], z1: +coreM[4] } : { x0: -820, x1: 820, z0: -560, z1: 560 };
const toLocal = (lon, lat) => [(lon - LON) * M_LON, -(lat - LAT) * M_LAT];
const toLonLat = (x, z) => [LON + x / M_LON, LAT - z / M_LAT];
const r2 = (v) => Math.round(v * 100) / 100;
const inCore = (x, z) => x >= CORE.x0 && x <= CORE.x1 && z >= CORE.z0 && z <= CORE.z1;
const tileName = (ix, iz) => `t_${ix}_${iz}`;

// ---------------------------------------------------------------- fetch
const UA = 'ZombieSurvivalGame/1.0 (tools/tiles.mjs)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchApi(b) { // b = [west, south, east, north] ; splits a bbox the API refuses (too many nodes) into four
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${b.map((v) => v.toFixed(6)).join(',')}`;
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } }), txt = await res.text();
      if (res.status === 400 && /too many nodes|exceeds/i.test(txt)) {
        const [w, s, e, n] = b, mx = (w + e) / 2, my = (s + n) / 2, els = [];
        for (const q of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]) els.push(...(await fetchApi(q)));
        return els;
      }
      if (res.ok) return JSON.parse(txt).elements;
      console.log('  api http', res.status, txt.slice(0, 80));
    } catch (e) { console.log('  api error', e.message); }
    await sleep(1500 * (k + 1));
  }
  return null;
}
const MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function fetchOverpass(b) {
  const bb = `${b[1]},${b[0]},${b[3]},${b[2]}`;
  const q = `[out:json][timeout:120];(way["building"](${bb});relation["building"](${bb});node["natural"="tree"](${bb});node["highway"="street_lamp"](${bb}););out body;>;out skel qt;`;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'data=' + encodeURIComponent(q) }), txt = await res.text();
      if (res.ok && txt.startsWith('{')) return JSON.parse(txt).elements;
      console.log('  overpass', url, res.status);
    } catch (e) { console.log('  overpass error', e.message); }
  }
  return null;
}

if (has('--fetch')) {
  const [x0, z0, x1, z1] = opt('--fetch').split(',').map(Number);
  fs.mkdirSync(RAW, { recursive: true });
  for (let iz = Math.floor(z0 / SIZE); iz <= Math.floor((z1 - 1e-6) / SIZE); iz++) for (let ix = Math.floor(x0 / SIZE); ix <= Math.floor((x1 - 1e-6) / SIZE); ix++) {
    const name = `${RAW}/${tileName(ix, iz)}.json`;
    if (fs.existsSync(name)) { console.log('have', name); continue; }
    // the tile plus its halo
    const [w, n] = toLonLat(ix * SIZE - HALO, iz * SIZE - HALO), [e, s] = toLonLat((ix + 1) * SIZE + HALO, (iz + 1) * SIZE + HALO);
    const b = [w, s, e, n];
    console.log('tile', ix, iz, 'bbox', b.map((v) => v.toFixed(5)).join(','));
    let els = await fetchApi(b), src = 'api.openstreetmap.org';
    if (!els) { els = await fetchOverpass(b); src = 'overpass'; }
    if (!els) { console.log('  FAILED: no server reachable for this tile'); process.exitCode = 1; continue; }
    const seen = new Set(), uniq = els.filter((e) => { const k = e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
    fs.writeFileSync(name, JSON.stringify({ tile: [ix, iz], source: src, fetched: new Date().toISOString().slice(0, 10), elements: uniq }));
    console.log('  ok', src, uniq.length, 'elements');
    await sleep(1000);
  }
}

// ---------------------------------------------------------------- build
const KEEP = ['building', 'building:levels', 'roof:shape', 'roof:levels', 'roof:height', 'roof:orientation', 'height', 'min_height', 'building:colour', 'roof:colour', 'building:material', 'roof:material', 'amenity', 'tourism', 'religion', 'name'];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; s += ax * bz - bx * az; } return s / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };

function parseRaw(file) {
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const e of JSON.parse(fs.readFileSync(file, 'utf8')).elements) {
    if (e.type === 'node') nodes.set(e.id, e); else if (e.type === 'way') ways.set(e.id, e); else if (e.type === 'relation') rels.push(e);
  }
  const ring = (w) => { const p = (w.nodes || []).map((id) => { const n = nodes.get(id); return n ? toLocal(n.lon, n.lat) : null; }); return p.every(Boolean) ? p : null; };
  const out = { buildings: [], trees: [], lamps: [] };
  const addB = (id, pts, tags) => {
    pts = pts.slice(); if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3 || Math.abs(area2(pts)) < 4) return;
    if (area2(pts) < 0) pts.reverse(); // counter-clockwise like area.json after stitchRings
    out.buildings.push({ id, pts, tags });
  };
  for (const [id, w] of ways) {
    const t = w.tags || {};
    if (!t.building || t.building === 'no') continue;
    const p = ring(w); if (p) addB('w' + id, p, t);
  }
  for (const r of rels) { // multipolygon buildings: the closed outer ways, drawn without the courtyards (like area.json)
    const t = r.tags || {}; if (!t.building) continue;
    for (const m of r.members || []) if (m.type === 'way' && m.role === 'outer') { const w = ways.get(m.ref); const p = w && ring(w); if (p && w.nodes[0] === w.nodes[w.nodes.length - 1] && !(w.tags && w.tags.building)) addB('r' + r.id + 'w' + m.ref, p, t); }
  }
  for (const [id, n] of nodes) {
    const t = n.tags || {};
    if (t.natural === 'tree') out.trees.push([id, ...toLocal(n.lon, n.lat)]);
    else if (t.highway === 'street_lamp') out.lamps.push([id, ...toLocal(n.lon, n.lat)]);
  }
  return out;
}

function heightOf(tags) { // [h, hSrc]
  const GF = 4.2, FL = 3.25;
  const h = num(tags.height); if (h != null && h > 1) return [h, 'height'];
  const l = num(tags['building:levels']); if (l != null && l >= 1) return [GF + (Math.min(l, 12) - 1) * FL, 'levels'];
  return [GF + (DEF_LEVELS - 1) * FL, 'default'];
}

if (has('--build')) {
  if (!fs.existsSync(RAW)) { console.error('no raw cache at', RAW, '(run --fetch first)'); process.exit(1); }
  const files = fs.readdirSync(RAW).filter((f) => /^t_-?\d+_-?\d+\.json$/.test(f)).sort();
  // every building / tree / lamp of every raw file, once (a raw file also holds its halo)
  const B = new Map(), T = new Map(), L = new Map();
  for (const f of files) {
    const p = parseRaw(`${RAW}/${f}`);
    for (const b of p.buildings) B.set(b.id, b);
    for (const t of p.trees) T.set(t[0], t);
    for (const l of p.lamps) L.set(l[0], l);
  }
  const wanted = new Set(files.map((f) => f.slice(0, -5)));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^t_-?\d+_-?\d+\.json$/.test(f)) fs.unlinkSync(`${OUT}/${f}`);
  const tiles = {};
  const hashes = [];
  for (const name of [...wanted].sort()) {
    const [ix, iz] = name.slice(2).split('_').map(Number), x0 = ix * SIZE, z0 = iz * SIZE;
    const inT = (x, z) => x >= x0 && x < x0 + SIZE && z >= z0 && z < z0 + SIZE;
    const inH = (x, z) => x >= x0 - HALO && x < x0 + SIZE + HALO && z >= z0 - HALO && z < z0 + SIZE + HALO;
    const blds = [];
    let dropped = 0;
    for (const b of [...B.values()].sort((p, q) => (p.id < q.id ? -1 : 1))) {
      const [cx, cz] = centroid(b.pts);
      if (b.pts.some(([x, z]) => inCore(x, z))) { if (inH(cx, cz)) dropped++; continue; } // already built by area.json
      const own = inT(cx, cz);
      if (!own && !inH(cx, cz)) continue;
      const [h, hSrc] = heightOf(b.tags);
      const tg = {}; for (const k of KEEP) if (b.tags[k] != null) tg[k] = b.tags[k];
      const o = { id: b.id, pts: b.pts.map(([x, z]) => [r2(x), r2(z)]), h: r2(h), hSrc, tags: tg };
      if (!own) o.halo = 1;
      blds.push(o);
    }
    const trees = [...T.values()].filter(([, x, z]) => inT(x, z) && !inCore(x, z)).sort((a, b) => a[0] - b[0]).map(([, x, z]) => [r2(x), r2(z)]);
    const lamps = [...L.values()].filter(([, x, z]) => inT(x, z) && !inCore(x, z)).sort((a, b) => a[0] - b[0]).map(([, x, z]) => [r2(x), r2(z)]);
    const json = JSON.stringify({ ix, iz, size: SIZE, halo: HALO, buildings: blds, trees, lamps });
    fs.writeFileSync(`${OUT}/${name}.json`, json);
    const sha = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
    hashes.push(name + sha);
    const own = blds.filter((b) => !b.halo);
    tiles[`${ix},${iz}`] = { k: (ix + 32768) * 65536 + (iz + 32768), file: name + '.json', bytes: json.length, sha, counts: { buildings: own.length, halo: blds.length - own.length, trees: trees.length, lamps: lamps.length, droppedCore: dropped, hSrc: own.reduce((m, b) => (m[b.hSrc] = (m[b.hSrc] || 0) + 1, m), {}) } };
    console.log(name, tiles[`${ix},${iz}`].counts, json.length, 'bytes');
  }
  const manifest = { tileSize: SIZE, origin: area.center, core: CORE, halo: HALO, tiles, hash: crypto.createHash('sha256').update(hashes.join('|')).digest('hex').slice(0, 16) };
  fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log('manifest hash', manifest.hash, Object.keys(tiles).length, 'tiles');
}

if (has('--verify')) {
  const m = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8')), hashes = [];
  let bad = 0;
  for (const [k, t] of Object.entries(m.tiles)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(`${OUT}/${t.file}`, 'utf8')).digest('hex').slice(0, 16);
    if (sha !== t.sha) { console.log('MISMATCH', k); bad++; }
    hashes.push(t.file.slice(0, -5) + t.sha);
  }
  const h = crypto.createHash('sha256').update(hashes.join('|')).digest('hex').slice(0, 16);
  console.log(bad ? 'FAIL' : 'ok', Object.keys(m.tiles).length, 'tiles, hash', h, h === m.hash ? 'matches' : 'DIFFERS');
  process.exit(bad || h !== m.hash ? 1 : 0);
}
if (!has('--fetch') && !has('--build') && !has('--verify')) console.error('Usage: --fetch x0,z0,x1,z1 | --build | --verify (see the header of this file)');
