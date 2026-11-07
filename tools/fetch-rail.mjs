// Builds the railway and Gare de Strasbourg data used by the station area (phase 0 of docs/TRAIN_INTRO_SPEC.md).
// Writes two files in the SAME frame as public/data/area.json (origin = its `center`, x = east, z = south, metres):
//   public/data/rail.json : SNCF tracks clipped to a corridor around the station, platforms, CTS tram tracks, the intro route
//   public/data/gare.json : station-area buildings, building parts, platforms, trees, furniture, footways (footprints already in area.json dropped)
//
// Usage (NODE_USE_ENV_PROXY=1 when the network goes through an HTTPS proxy):
//   node tools/fetch-rail.mjs --sncf <tracks.geojson> [--bootstrap-git] [--bdtopo] [--osm] [--radius 2600] [--out-rail p] [--out-gare p]
// Sources (pluggable, any subset):
//   --sncf <file>     SNCF Réseau « Fichier de formes des voies du Réseau Ferré National » (GeoJSON, WGS84, ODbL)
//   --bootstrap-git   OSM extract of the station saved in git (commit 4880783, public/data/gare.json, ODbL) : platforms, outlines
//   --bdtopo          IGN BD TOPO (Géoplateforme WFS, Licence Ouverte Etalab 2.0) : tram tracks (troncon_de_voie_ferree), building heights
//   --osm             OpenStreetMap (ODbL) tram stop nodes, via Overpass or else the OSM API : cross-check of the derived stop (optional)
// Downloaded files are data only : parsed with JSON.parse, never executed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const SNCF = opt('--sncf'), GIT = !!opt('--bootstrap-git'), BDTOPO = !!opt('--bdtopo'), OSM = !!opt('--osm');
const RADIUS = parseFloat(opt('--radius', 2600));
const OUT_RAIL = opt('--out-rail', 'public/data/rail.json'), OUT_GARE = opt('--out-gare', 'public/data/gare.json');
if (!SNCF && !GIT && !BDTOPO && !OSM) {
  console.error('Usage: node tools/fetch-rail.mjs --sncf <geojson> [--bootstrap-git] [--bdtopo] [--osm]');
  process.exit(1);
}

// ---------------------------------------------------------------- frame (never re-centre area.json : every config coordinate depends on it)
const area = JSON.parse(fs.readFileSync('public/data/area.json', 'utf8'));
const LAT = area.center.lat, LON = area.center.lon;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const toLocal = (lon, lat) => [(lon - LON) * M_LON, -(lat - LAT) * M_LAT];
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
const STATION = [-1040, -320]; // centre of the Gare de Strasbourg in this frame (checked against the OSM outline below)
// station area kept in gare.json (a little wider than CONFIG.gare.bounds : the facades that close the forecourt)
const GARE_BOX = { x0: -1260, x1: -800, z0: -620, z1: -60 };
const inBox = (x, z, b = GARE_BOX) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
const sources = [];
const now = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- geometry helpers
function simplify(pts, tol) { // Douglas-Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const lenOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
// runs of consecutive points within `r` of the station (a long line is clipped to the corridor)
function clipRuns(pts, r) {
  const out = []; let cur = [];
  for (const p of pts) {
    if (Math.hypot(p[0] - STATION[0], p[1] - STATION[1]) <= r) cur.push(p);
    else { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- network helpers (retry with backoff)
async function fetchText(url, init = {}, tries = 4) {
  let last = null;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': 'ZombieSurvivalGame/1.0 (tools/fetch-rail.mjs)', ...(init.headers || {}) } });
      const text = await res.text();
      if (res.ok) return text;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1500 * 2 ** k));
  }
  throw last;
}

// ---------------------------------------------------------------- outputs
const rail = { origin: { lat: LAT, lon: LON }, sources, tracks: [], tram: [], platforms: [], stops: [], routes: {} };
const gare = { origin: { lat: LAT, lon: LON }, sources, bounds: GARE_BOX, buildings: [], parts: [], platforms: [], trees: [], lamps: [], furniture: [], extraFurniture: [], roads: [] };

// ---------------------------------------------------------------- SNCF Réseau track shapes
if (SNCF) {
  const g = JSON.parse(fs.readFileSync(SNCF, 'utf8'));
  let n = 0;
  for (const f of g.features || []) {
    const p = f.properties || {}, geom = f.geometry || {};
    const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
    for (const c of lines) {
      const pts = c.map(([lon, lat]) => toLocal(lon, lat));
      for (const run of clipRuns(pts, RADIUS)) {
        const s = simplify(run, 0.05).map(([x, z]) => [r1(x), r1(z)]);
        if (s.length < 2 || lenOf(s) < 5) continue;
        rail.tracks.push({ id: `${p.code_ligne}-${p.nom_voie}-${n++}`, line: p.code_ligne || null, voie: p.nom_voie || null, type: p.type_voie || null, pk: [p.pk_debut_r || null, p.pk_fin_r || null], pts: s });
      }
    }
  }
  sources.push({ name: 'SNCF Réseau — Fichier de formes des voies du Réseau Ferré National', licence: 'ODbL 1.0', url: 'https://ressources.data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/', date: now });
  console.log(`SNCF : ${rail.tracks.length} track runs within ${RADIUS} m (${(g.features || []).length} features read)`);
}

// ---------------------------------------------------------------- OSM extract saved in git (v0.59.0)
let osmOld = null;
if (GIT) {
  try {
    osmOld = JSON.parse(execFileSync('git', ['show', '4880783:public/data/gare.json'], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    sources.push({ name: 'OpenStreetMap contributors (extract of 2026-10-24, git 4880783)', licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', date: '2026-10-24' });
  } catch (e) { console.log('git bootstrap unavailable :', e.message); }
}
if (osmOld) {
  // the old extract has its own origin : back to WGS84, then into this frame
  const oc = osmOld.center, oLon = 111320 * Math.cos((oc.lat * Math.PI) / 180);
  const R = ([x, z]) => { const [a, b] = toLocal(oc.lon + x / oLon, oc.lat - z / M_LAT); return [r2(a), r2(b)]; };
  const ring = (pts) => pts.map(R);
  // footprints already drawn by area.json (centroid within 3 m) are dropped : no double building at the edge of the island
  const known = area.buildings.map((b) => centroid(b.pts));
  const dup = (pts) => { const [cx, cz] = centroid(pts); return known.some(([x, z]) => Math.abs(x - cx) < 3 && Math.abs(z - cz) < 3); };
  let dropped = 0;
  for (const b of osmOld.buildings) {
    const pts = ring(b.pts), [cx, cz] = centroid(pts);
    if (!inBox(cx, cz)) continue;
    if (dup(pts)) { dropped++; continue; }
    gare.buildings.push({ pts, h: r1(b.h), ignH: b.ignH ?? null, name: b.name || null, tags: b.tags || {} });
  }
  for (const p of osmOld.parts) { const pts = ring(p.pts), [cx, cz] = centroid(pts); if (inBox(cx, cz)) gare.parts.push({ pts, tags: p.tags || {} }); }
  for (const p of osmOld.platforms) { const pts = ring(p.pts); gare.platforms.push({ ref: p.ref, pts }); rail.platforms.push({ ref: p.ref, pts: pts.map(([x, z]) => [r1(x), r1(z)]) }); }
  for (const t of osmOld.trees) { const q = R(t); if (inBox(q[0], q[1])) gare.trees.push(q.map(r1)); }
  for (const t of osmOld.lamps || []) { const q = R(t); if (inBox(q[0], q[1])) gare.lamps.push(q.map(r1)); }
  for (const f of osmOld.furniture) { const q = R(f.p); if (inBox(q[0], q[1])) gare.furniture.push({ p: q.map(r1), kind: f.kind, name: f.name || null }); }
  for (const f of osmOld.extraFurniture) { const q = R(f.p); if (inBox(q[0], q[1])) gare.extraFurniture.push({ p: q.map(r1), kind: f.kind }); }
  for (const r of osmOld.roads) {
    const pts = ring(r.pts);
    if (!pts.some(([x, z]) => inBox(x, z))) continue;
    if (!['pedestrian', 'footway', 'steps', 'platform', 'busway', 'secondary', 'service', 'elevator'].includes(r.type)) continue;
    gare.roads.push({ type: r.type, area: !!r.area, pts: simplify(pts, 0.1).map(([x, z]) => [r1(x), r1(z)]) });
  }
  // old OSM rails : only the station tracks the SNCF file lacks are useful ; kept as `osm` tracks (no id from SNCF)
  let k = 0;
  for (const w of osmOld.rails) {
    const pts = simplify(ring(w.pts), 0.05).map(([x, z]) => [r1(x), r1(z)]);
    if (lenOf(pts) > 5) rail.tracks.push({ id: `osm-${k++}`, line: null, voie: null, type: 'OSM', pts });
  }
  console.log(`git OSM : ${gare.buildings.length} buildings (${dropped} already in area.json), ${gare.parts.length} parts, ${gare.platforms.length} platforms, ${k} OSM rail ways, ${gare.trees.length} trees`);
}

// ---------------------------------------------------------------- IGN BD TOPO (WFS) : tram tracks, building heights
if (BDTOPO) {
  const bb = (() => { // WGS84 bbox of the station box
    const lon = (x) => LON + x / M_LON, lat = (z) => LAT - z / M_LAT;
    return [lon(GARE_BOX.x0), lat(GARE_BOX.z1), lon(GARE_BOX.x1), lat(GARE_BOX.z0)].map((v) => v.toFixed(6)).join(',');
  })();
  const wfs = (type) => `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${type}&SRSNAME=CRS:84&BBOX=${bb},CRS:84&OUTPUTFORMAT=application/json&COUNT=5000`;
  try {
    const vf = JSON.parse(await fetchText(wfs('BDTOPO_V3:troncon_de_voie_ferree')));
    let nt = 0;
    for (const f of vf.features || []) {
      const p = f.properties || {};
      if (!/tram/i.test(p.nature || '')) continue;
      const pts = (f.geometry?.coordinates || []).map(([lon, lat, y]) => { const [x, z] = toLocal(lon, lat); return [r1(x), r1(z), y != null ? r1(y) : null]; });
      if (pts.length < 2) continue;
      rail.tram.push({ id: p.cleabs, level: parseInt(p.position_par_rapport_au_sol, 10) || 0, pts: pts.map(([x, z]) => [x, z]), alt: pts.map((q) => q[2]) });
      nt++;
    }
    console.log(`BD TOPO : ${nt} tram track pieces`);
  } catch (e) { console.log('BD TOPO tram tracks skipped :', e.message); }
  try {
    const bt = JSON.parse(await fetchText(wfs('BDTOPO_V3:batiment')));
    const ign = [];
    for (const f of bt.features || []) {
      const h = parseFloat(f.properties?.hauteur);
      const ring0 = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates[0]?.[0] : f.geometry?.coordinates?.[0];
      if (!Number.isFinite(h) || h <= 0 || !ring0?.length) continue;
      ign.push({ c: centroid(ring0.map(([lon, lat]) => toLocal(lon, lat))), h: r1(h) });
    }
    let m = 0;
    for (const b of gare.buildings) {
      const [cx, cz] = centroid(b.pts);
      let bd = 14, bh = null;
      for (const q of ign) { const d = Math.hypot(q.c[0] - cx, q.c[1] - cz); if (d < bd) { bd = d; bh = q.h; } }
      if (bh != null) { b.ignH = bh; m++; }
    }
    console.log(`BD TOPO : ${m}/${gare.buildings.length} station-area buildings calibrated`);
  } catch (e) { console.log('BD TOPO buildings skipped :', e.message); }
  sources.push({ name: 'IGN BD TOPO (troncon_de_voie_ferree, batiment) via data.geopf.fr', licence: 'Licence Ouverte Etalab 2.0', url: 'https://geoservices.ign.fr/bdtopo', date: now });
}

// ---------------------------------------------------------------- OSM tram stops (optional) : Overpass, else the main OSM API (bbox map call)
// Kept in `rail.osmStops` (points only, with their level) : `rail.stops` holds stops WITH a track (src/gare/plan.js uses the first « Gare Centrale »).
// They only cross-check the derived stop below. Overpass is often refused from cloud sessions ; the OSM API answers.
if (OSM) {
  const lon = (x) => LON + x / M_LON, lat = (z) => LAT - z / M_LAT;
  const isStop = (t = {}) => t.railway === 'tram_stop' || (t.public_transport === 'stop_position' && t.tram === 'yes');
  const keep = (els, via) => {
    rail.osmStops = els.filter((el) => el.type === 'node' && isStop(el.tags))
      .map((el) => ({ name: el.tags.name || null, level: el.tags.level != null ? parseFloat(el.tags.level) : 0, at: toLocal(el.lon, el.lat).map(r1), id: el.id }));
    sources.push({ name: `OpenStreetMap contributors (${via})`, licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', date: now });
    console.log(`OSM (${via}) : ${rail.osmStops.length} tram stop nodes`);
  };
  try {
    const bbox = `${lat(GARE_BOX.z1)},${lon(GARE_BOX.x0)},${lat(GARE_BOX.z0)},${lon(GARE_BOX.x1)}`;
    const q = `[out:json][timeout:90];(node["railway"="tram_stop"](${bbox});node["public_transport"="stop_position"]["tram"="yes"](${bbox}););out;`;
    keep(JSON.parse(await fetchText('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, 2)).elements || [], 'Overpass');
  } catch (e) {
    console.log('Overpass unreachable :', e.message, '— trying the OSM API');
    try {
      // the API caps a bbox at 0.25 deg² and 50 000 nodes : the station box is ~0.00003 deg²
      const bbox = [lon(GARE_BOX.x0), lat(GARE_BOX.z1), lon(GARE_BOX.x1), lat(GARE_BOX.z0)].map((v) => v.toFixed(6)).join(',');
      keep(JSON.parse(await fetchText(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, {}, 3)).elements || [], 'OSM API');
    } catch (e2) { console.log('OSM API skipped :', e2.message); }
  }
}

// ---------------------------------------------------------------- derived : CTS « Gare Centrale » surface stop (line C), from the BD TOPO tram tracks
// The surface tram track that ends inside the station box is the line C terminus on Place de la Gare (lines A / D run underground : level -1).
if (!rail.stops.some((s) => /gare centrale/i.test(s.name || ''))) {
  const surf = rail.tram.filter((t) => t.level >= 0);
  const ends = surf.flatMap((t) => [t.pts[0], t.pts[t.pts.length - 1]]);
  const shared = (p) => ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1).length > 1;
  let buf = null;
  for (const t of surf) for (const end of [0, t.pts.length - 1]) {
    const p = t.pts[end];
    if (inBox(p[0], p[1], { x0: -1000, x1: -880, z0: -460, z1: -340 }) && !shared(p)) buf = { t, end };
  }
  if (buf) {
    // track from the buffer stop outward, following connected surface pieces
    let pts = buf.end === 0 ? buf.t.pts.slice() : buf.t.pts.slice().reverse();
    const used = new Set([buf.t]);
    for (let grown = true; grown;) {
      grown = false;
      const tail = pts[pts.length - 1];
      for (const t of surf) {
        if (used.has(t)) continue;
        const a = t.pts[0], b = t.pts[t.pts.length - 1];
        if (Math.hypot(a[0] - tail[0], a[1] - tail[1]) < 1) { pts = pts.concat(t.pts.slice(1)); used.add(t); grown = true; break; }
        if (Math.hypot(b[0] - tail[0], b[1] - tail[1]) < 1) { pts = pts.concat(t.pts.slice().reverse().slice(1)); used.add(t); grown = true; break; }
      }
    }
    // stop centred `back` m from the buffer, along the track
    const back = 22;
    let s = 0, at = pts[0];
    for (let i = 1; i < pts.length && s < back; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); const f = Math.min(1, (back - s) / d); at = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; s += d; }
    rail.stops.push({ name: 'Gare Centrale', line: 'C', at: at.map(r1), buffer: pts[0].map(r1), track: pts.map(([x, z]) => [r1(x), r1(z)]), src: 'bdtopo' });
    console.log(`CTS « Gare Centrale » (line C, surface) : stop at (${at.map(r1).join(', ')}), buffer at (${pts[0].map(r1).join(', ')})`);
    // cross-check against the surface OSM stop nodes (lines A / D are underground : level < 0)
    const osm = (rail.osmStops || []).filter((s) => /gare centrale/i.test(s.name || '') && !(s.level < 0));
    if (osm.length) {
      const d = Math.min(...osm.map((s) => Math.hypot(s.at[0] - at[0], s.at[1] - at[1])));
      console.log(`  nearest OSM surface stop node : ${d.toFixed(1)} m${d > 15 ? '  (!) more than 15 m : check the derived stop' : ''}`);
    }
  }
}

// ---------------------------------------------------------------- intro route : SW approach, ending at quai 1
// Directed graph of SNCF tracks : every track is split where the end of another track (a switch) touches it, pieces are joined at shared ends
// (0.6 m), and a move from one piece to the next is allowed only without a sharp turn (a train cannot reverse through a switch).
if (rail.tracks.length) {
  const T = rail.tracks.filter((t) => t.type !== 'OSM');
  const dSeg = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; let u = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; u = Math.max(0, Math.min(1, u)); return { d: Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u), u }; };
  // 1) cut points : ends of other tracks lying on a track's interior
  const ends = T.flatMap((t) => [t.pts[0], t.pts[t.pts.length - 1]]);
  const pieces = [];
  for (const t of T) {
    const cuts = []; // [segment index, u, point]
    for (const e of ends) {
      for (let i = 1; i < t.pts.length; i++) {
        const r = dSeg(e[0], e[1], t.pts[i - 1], t.pts[i]);
        if (r.d < 0.8 && !(i === 1 && r.u < 0.02) && !(i === t.pts.length - 1 && r.u > 0.98)) { cuts.push([i, r.u, e]); break; }
      }
    }
    cuts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = [t.pts[0]], ci = 0;
    for (let i = 1; i < t.pts.length; i++) {
      while (ci < cuts.length && cuts[ci][0] === i) { const [, u] = cuts[ci++]; const a = t.pts[i - 1], b = t.pts[i], p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; cur.push(p); if (lenOf(cur) > 0.5) pieces.push({ t, pts: cur }); cur = [p]; }
      cur.push(t.pts[i]);
    }
    if (lenOf(cur) > 0.5) pieces.push({ t, pts: cur });
  }
  // 2) directed edges (each piece both ways) and nodes at shared ends
  const keyOf = (p) => `${Math.round(p[0] / 0.6)},${Math.round(p[1] / 0.6)}`;
  const nodes = new Map();
  const nodeOf = (p) => { const bx = Math.round(p[0] / 0.6), bz = Math.round(p[1] / 0.6); for (const dx of [0, -1, 1]) for (const dz of [0, -1, 1]) { const k = `${bx + dx},${bz + dz}`; if (nodes.has(k)) return k; } const k = keyOf(p); nodes.set(k, []); return k; };
  const head = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const edges = [];
  for (const pc of pieces) {
    const L = lenOf(pc.pts), A = nodeOf(pc.pts[0]), B = nodeOf(pc.pts[pc.pts.length - 1]);
    for (const fwd of [true, false]) {
      const pts = fwd ? pc.pts : pc.pts.slice().reverse();
      const e = { id: edges.length, t: pc.t, pts, L, from: fwd ? A : B, to: fwd ? B : A, h0: head(pts[0], pts[1]), h1: head(pts[pts.length - 2], pts[pts.length - 1]) };
      edges.push(e); nodes.get(e.from).push(e);
    }
  }
  const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const q1 = gare.platforms.find((p) => p.ref === '1');
  const hall = gare.parts.find((p) => /verri/i.test(p.tags?.name || '')) || gare.buildings.find((b) => b.tags?.building === 'train_station');
  if (q1 && hall) {
    const [qx, qz] = centroid(hall.pts); // the train stops beside the middle of the station (the hall exit)
    const dTrack = (x, z, pts) => { let m = Infinity; for (let i = 1; i < pts.length; i++) m = Math.min(m, dSeg(x, z, pts[i - 1], pts[i]).d); return m; };
    // track along quai 1 : the main track whose pieces pass nearest to the platform centre
    const stopE = edges.filter((e) => e.t.type === 'VPL' || e.t.type === 'VPA').sort((a, b) => dTrack(qx, qz, a.pts) - dTrack(qx, qz, b.pts));
    const goalT = stopE[0]?.t;
    // SW entry : lines 115000 / 110000, track V1, piece end ~1.4 km before the platform, south-west of it, heading toward the station
    let start = null;
    for (const e of edges) {
      if (!/^11[05]000$/.test(e.t.line || '') || e.t.voie !== 'V1') continue;
      const p = e.pts[0], d = Math.hypot(p[0] - qx, p[1] - qz);
      if (p[0] < qx && p[1] > qz && dTrack(qx, qz, e.pts) < d && (!start || Math.abs(d - 1350) < Math.abs(start.d - 1350))) start = { e, d };
    }
    if (goalT && start) {
      // Dijkstra on directed edges
      const dist = new Map([[start.e.id, 0]]), prev = new Map(), done = new Set();
      let found = null;
      for (;;) {
        let u = null, du = Infinity;
        for (const [k, d] of dist) if (!done.has(k) && d < du) { du = d; u = k; }
        if (u == null) break;
        const e = edges[u];
        if (e.t === goalT && dTrack(qx, qz, e.pts) < 40 && Math.hypot(e.pts[e.pts.length - 1][0] - qx, e.pts[e.pts.length - 1][1] - qz) < Math.hypot(e.pts[0][0] - qx, e.pts[0][1] - qz) + 200) { found = e; break; }
        done.add(u);
        for (const n of nodes.get(e.to)) {
          if (n.pts === e.pts || n.t === e.t && n.L === e.L || turn(e.h1, n.h0) > 0.35) continue;
          const nd = du + e.L;
          if (nd < (dist.get(n.id) ?? Infinity)) { dist.set(n.id, nd); prev.set(n.id, u); }
        }
      }
      if (found) {
        const chain = [];
        for (let k = found.id; k != null; k = prev.get(k)) chain.unshift(edges[k]);
        let pts = [];
        for (const e of chain.slice(0, -1)) pts = pts.length ? pts.concat(e.pts.slice(1)) : e.pts.slice();
        // last piece : up to the point beside the platform centre (the train stops there)
        const lp = found.pts; let bi = 0, bd = Infinity;
        for (let i = 0; i < lp.length; i++) { const d = Math.hypot(lp[i][0] - qx, lp[i][1] - qz); if (d < bd) { bd = d; bi = i; } }
        pts = pts.concat(lp.slice(pts.length ? 1 : 0, bi + 1));
        const samples = [pts[0]];
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az);
          let s = 1 - acc;
          while (s <= d) { samples.push([r1(ax + ((bx - ax) * s) / d), r1(az + ((bz - az) * s) / d)]); s += 1; }
          acc = (acc + d) % 1;
        }
        rail.routes.intro = { from: start.e.t.id, platformTrack: goalT.id, length: Math.round(lenOf(pts)), stopAt: pts[pts.length - 1].map(r1), samples };
        console.log(`intro route : ${rail.routes.intro.length} m over ${chain.length} pieces (${[...new Set(chain.map((e) => e.t.line + ' ' + e.t.voie))].join(' > ')}), stops at (${rail.routes.intro.stopAt.join(', ')}) beside quai 1`);
      } else console.log('intro route : no path found');
    }
  }
}

for (const [file, obj] of [[OUT_RAIL, rail], [OUT_GARE, gare]]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  console.log(`→ ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
