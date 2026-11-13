import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { doorSignTex } from '../gare/index.js';
import { gpuOnly } from '../gpuOnly.js';
import { planDress, dressBoxes, buildDress } from './dress.js';

// =====================================================================
//  Krutenau, the first walkable district outside the island core (step B, chunk 2). A separate AREA like the station: its own floor region (own nav grid),
//  collision from the footprints of the tile buildings (public/data/tiles/, tools/tiles.mjs), zones with their items, zombie spawns. The island is not
//  touched: the zones are the `pocket: 'krutenau'` zones appended after the station's (no `seed`, so the island loops skip them), the one door is
//  appended after the station doors, nothing here draws from the island `rnd`, every choice is a deterministic scan of the data (same on every peer).
//  The tiles are rendered by the streamer (tiles.js); this module only builds the LOGIC (collision, nav region, zones, doors, items, spawns).
//  Entry: ONE purchasable gate on the island's east edge (CONFIG.districts.krutenau.gatePrice) opens all the district zones; once it is open, the
//  interaction at the gate walks the player over the bridge (district/bridge.js), and a return point in the district leads back.
// =====================================================================

const pointIn = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const distSeg = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - ax - dx * t, z - az - dz * t); };

// the tiles that overlap the district rect: buildings (footprints) and trees inside it. null when disabled or when the tile data is missing
export async function loadKrutenauData() {
  const D = CONFIG.districts?.krutenau;
  if (!D?.enabled) return null;
  try {
    const man = await fetch('/data/tiles/manifest.json').then((r) => (r.ok ? r.json() : null));
    if (!man) return null;
    const R = D.rect, S = man.tileSize, blds = new Map(), trees = [], roads = new Map(), parks = new Map(), water = new Map();
    const touches = (pts) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); } return b >= R.x0 - 30 && a <= R.x1 + 30 && d >= R.z0 - 30 && c <= R.z1 + 30; };
    for (const [key, e] of Object.entries(man.tiles)) {
      const [ix, iz] = key.split(',').map(Number);
      if ((ix + 1) * S < R.x0 - 40 || ix * S > R.x1 + 40 || (iz + 1) * S < R.z0 - 40 || iz * S > R.z1 + 40) continue;
      const t = await fetch(`/data/tiles/${e.file}`).then((r) => r.json());
      for (const b of t.buildings) if (!blds.has(b.id)) blds.set(b.id, b.pts);
      for (const [src, dst] of [[t.roads, roads], [t.parks, parks], [t.water, water]]) for (const o of src || []) if (!dst.has(o.id) && touches(o.pts)) dst.set(o.id, o); // (flat layers, for the dressing and the map)
      for (const [x, z] of t.trees) if (x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1) trees.push([x, z]);
    }
    return { buildings: [...blds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, p]) => p), trees, roads: [...roads.values()], parks: [...parks.values()], water: [...water.values()], hash: man.hash };
  } catch (e) { console.warn('[krutenau] tile data', e); return null; }
}

// ctx: { data, scene, collision, levels, lightSources, props, zoneNames, island: { find(x, z, snap) -> { x, z, zone, yaw } | null } }
export function buildKrutenau(ctx) {
  const { data, scene, collision, levels, lightSources, props, zoneNames, island, ground } = ctx;
  const D = CONFIG.districts.krutenau, R = D.rect;
  if (!data || !data.buildings.length) return null;
  const zoneDefs = CONFIG.sector.zones.filter((z) => z.pocket === 'krutenau');
  const zoneIdx = zoneDefs.map((z) => zoneNames.indexOf(z.name));
  if (!zoneDefs.length || zoneIdx.some((i) => i < 0)) return null;

  // ---------------------------------------------------------------- footprints -> collision
  const blds = data.buildings.filter((p) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return x1 >= R.x0 - 2 && x0 <= R.x1 + 2 && z1 >= R.z0 - 2 && z0 <= R.z1 + 2; });
  for (const p of blds) for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; if (Math.hypot(bx - ax, bz - az) > 0.05) collision.addSegment(ax, az, bx, bz); }
  for (const [x, z] of data.trees) collision.addCircle(x, z, 0.3);
  collision.addBounds(R);

  // ---------------------------------------------------------------- 1 m grid: blocked cells, clearance, the main walkable component
  const C = 1, nx = Math.ceil((R.x1 - R.x0) / C), nz = Math.ceil((R.z1 - R.z0) / C), N = nx * nz;
  const cx = (x) => Math.floor((x - R.x0) / C), cz = (z) => Math.floor((z - R.z0) / C), wx = (i) => R.x0 + (i + 0.5) * C, wz = (j) => R.z0 + (j + 0.5) * C;
  const blocked = new Uint8Array(N);
  const mark = (i, j) => { if (i >= 0 && j >= 0 && i < nx && j < nz) blocked[j * nx + i] = 1; };
  for (const p of blds) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.max(0, cz(z0) - 1); j <= Math.min(nz - 1, cz(z1) + 1); j++) for (let i = Math.max(0, cx(x0) - 1); i <= Math.min(nx - 1, cx(x1) + 1); i++) if (pointIn(p, wx(i), wz(j))) blocked[j * nx + i] = 1;
    for (let k = 0; k < p.length; k++) { // a margin along every wall (the nav grid keeps 0.5 m)
      const [ax, az] = p[k], [bx, bz] = p[(k + 1) % p.length];
      for (let j = cz(Math.min(az, bz) - 1); j <= cz(Math.max(az, bz) + 1); j++) for (let i = cx(Math.min(ax, bx) - 1); i <= cx(Math.max(ax, bx) + 1); i++) if (distSeg(wx(i), wz(j), ax, az, bx, bz) < 0.8) mark(i, j);
    }
  }
  for (const [x, z] of data.trees) for (let j = cz(z - 1); j <= cz(z + 1); j++) for (let i = cx(x - 1); i <= cx(x + 1); i++) if (Math.hypot(wx(i) - x, wz(j) - z) < 1) mark(i, j);
  // set dressing: wrecks along the kerb and the checkpoint at the bridge head; their footprints are blocked cells too (items, spawns and the components avoid them)
  const freeAt = (x, z, r) => { for (let j = cz(z - r); j <= cz(z + r); j++) for (let i = cx(x - r); i <= cx(x + r); i++) { if (i < 0 || j < 0 || i >= nx || j >= nz || blocked[j * nx + i]) return false; } return true; };
  const keepR = D.dress.keepRadius, keep = [{ ...D.entry, r: keepR }, { x: D.entry.x + 5, z: D.entry.z, r: keepR }, ...zoneDefs.map((z) => ({ x: z.site.x, z: z.site.z, r: keepR }))];
  const dressList = planDress({ roads: data.roads || [], D, free: freeAt, entry: D.entry, keep });
  for (const b of dressBoxes(dressList)) { // (a 0.7 m margin around the oriented box)
    const c = Math.cos(b.rot), s = Math.sin(b.rot), ext = Math.hypot(b.w, b.d) / 2 + 1;
    for (let j = cz(b.z - ext); j <= cz(b.z + ext); j++) for (let i = cx(b.x - ext); i <= cx(b.x + ext); i++) {
      const dx = wx(i) - b.x, dz = wz(j) - b.z, u = dx * c + dz * s, v = -dx * s + dz * c;
      if (Math.abs(u) <= b.w / 2 + 0.7 && Math.abs(v) <= b.d / 2 + 0.7) mark(i, j);
    }
  }
  // clearance (distance to the nearest blocked cell or to the rect border, m): two-pass chamfer
  const clr = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) clr[j * nx + i] = blocked[j * nx + i] ? 0 : Math.min(i + 1, j + 1, nx - i, nz - j, 40);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; let d = clr[k]; if (i > 0) d = Math.min(d, clr[k - 1] + 1); if (j > 0) d = Math.min(d, clr[k - nx] + 1); clr[k] = d; }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; let d = clr[k]; if (i < nx - 1) d = Math.min(d, clr[k + 1] + 1); if (j < nz - 1) d = Math.min(d, clr[k + nx] + 1); clr[k] = d; }
  // connected components of the free cells: the main one (largest) is the playable district
  const comp = new Int32Array(N).fill(-1), sizes = [], stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (blocked[s] || comp[s] >= 0) continue;
    const id = sizes.length; let n = 0, sp = 0; stack[sp++] = s; comp[s] = id;
    while (sp) {
      const c = stack[--sp]; n++; const i = c % nx, j = (c / nx) | 0;
      if (i > 0 && !blocked[c - 1] && comp[c - 1] < 0) { comp[c - 1] = id; stack[sp++] = c - 1; }
      if (i < nx - 1 && !blocked[c + 1] && comp[c + 1] < 0) { comp[c + 1] = id; stack[sp++] = c + 1; }
      if (j > 0 && !blocked[c - nx] && comp[c - nx] < 0) { comp[c - nx] = id; stack[sp++] = c - nx; }
      if (j < nz - 1 && !blocked[c + nx] && comp[c + nx] < 0) { comp[c + nx] = id; stack[sp++] = c + nx; }
    }
    sizes.push(n);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const inMain = (i) => comp[i] === main;
  const nearestMain = (x, z, minClr = 0) => { // the main-component cell closest to (x, z) with at least `minClr` clearance
    let best = -1, bd = Infinity;
    for (let k = 0; k < N; k++) { if (!inMain(k) || clr[k] < minClr) continue; const d = (wx(k % nx) - x) ** 2 + (wz((k / nx) | 0) - z) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  };

  // ---------------------------------------------------------------- zones: walking-distance flood fill from the sites (multi-source BFS), then widened over the walls
  const zlab = new Int8Array(N).fill(-1), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const siteCell = zoneDefs.map((z) => nearestMain(z.site.x, z.site.z, 2.5));
  siteCell.forEach((c, k) => { if (c >= 0) { zlab[c] = zoneIdx[k]; queue[qt++] = c; } });
  while (qh < qt) {
    const c = queue[qh++], i = c % nx, j = (c / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const k = b * nx + a; if (zlab[k] >= 0 || !inMain(k)) continue;
      zlab[k] = zlab[c]; queue[qt++] = k;
    }
  }
  const walk = Uint8Array.from(zlab, (v) => (v >= 0 ? 1 : 0)); // (the reachable cells, before the widening)
  for (let step = 0; step < 6; step++) {
    const prev = zlab.slice();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (prev[k] >= 0) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && prev[b * nx + a] >= 0) { zlab[k] = prev[b * nx + a]; break; } }
    }
  }
  const inArea = (x, z) => x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1;
  const zoneOf = (x, z) => (inArea(x, z) ? zlab[cz(z) * nx + cx(x)] : -1);
  const zoneCenters = {};
  zoneDefs.forEach((zd, k) => {
    let sx = 0, sz = 0, n = 0; for (let c = 0; c < N; c++) if (walk[c] && zlab[c] === zoneIdx[k]) { sx += wx(c % nx); sz += wz((c / nx) | 0); n++; }
    const best = n ? nearestMain(sx / n, sz / n, 2) : siteCell[k];
    zoneCenters[zoneIdx[k]] = { name: zd.name, x: wx(best % nx), z: wz((best / nx) | 0), area: n * C * C };
  });

  // ---------------------------------------------------------------- the gate on the island (a door), the arrival point and the return point
  const entryCell = nearestMain(D.entry.x, D.entry.z, 3.5), entry = { x: wx(entryCell % nx), z: wz((entryCell / nx) | 0), yaw: D.entry.yaw };
  // the return point: a free spot 4-6 m from the arrival (the interaction of a point must not overlap the other's)
  const retCell = nearestMain(entry.x + 5, entry.z, 3), ret = { x: wx(retCell % nx), z: wz((retCell / nx) | 0) };
  const gate = island.find(D.gateHint.x, D.gateHint.z, D.gateSnap);
  if (!gate) { console.warn('[krutenau] no gate spot on the island'); return null; }

  // ---------------------------------------------------------------- ground: one flat quad over the rect with the island's ground material (same ground shader: cobbles, normal / roughness /
  // puddle variation, same UV mapping). Built with the district, NOT by the tile streamer: it exists the moment the player arrives, whatever the streamer has built so far. It sits 2 cm below
  // the tile ground (tiles.js) so the two never fight; terrainY is 0 out here, so the player's feet (y = 0) match it.
  if (ground) {
    const GT = ground.tile, c = [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap(([x, z]) => [x, -0.02, z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(c.flatMap(() => [0, 1, 0]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(c.flatMap(([x, z]) => [(x + ground.w / 2) / GT, (-z + ground.h / 2) / GT]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const m = new THREE.Mesh(g, ground.material); m.receiveShadow = true; m.name = 'krutenau:ground'; m.matrixAutoUpdate = false;
    gpuOnly(m); scene.add(m);
  }

  // ---------------------------------------------------------------- set dressing: instanced props + collision (before levels.buildNavs, so the nav grid sees them)
  const dressMeshes = buildDress(dressList, { props, scene, collision });

  // ---------------------------------------------------------------- floor region (own nav grid)
  const region = levels.addRegion('Krutenau', 0, 'floor', { ground: true, navCell: D.navCell, navMaxCost: D.navMaxCost, navMargin: 0.5 });
  levels.addPoly(region, [[R.x0, R.z0], [R.x0, R.z1], [R.x1, R.z1], [R.x1, R.z0]].reverse(), 0);

  // ---------------------------------------------------------------- doors: the gate only (it opens every zone of the district)
  const doors = [];
  const makeDoors = ({ doorList }) => {
    const price = D.gatePrice, door = { id: doorList.length, price, a: zoneIdx[0], b: zoneIdx[0], toZone: zoneIdx[0], name: zoneDefs[0].name, open: false, points: [], segs: [], meshes: [], cells: [], portal: false, pocket: 'krutenau', gate: true, extra: zoneIdx.slice(1) };
    const len = 5, gm = props.gate(len);
    gm.position.set(gate.x, 0, gate.z); gm.rotation.y = -gate.yaw;
    const mat = new THREE.MeshStandardMaterial({ map: doorSignTex(price, 'Grande Île ↔ Krutenau'), roughness: 0.72 });
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6 * 0.375), mat);
      sign.position.set(0, 2.0, side * 0.16); sign.rotation.y = side > 0 ? 0 : Math.PI; gm.add(sign);
    }
    scene.add(gm); door.meshes.push(gm);
    for (let s = -len / 2; s <= len / 2; s += 1.25) door.points.push({ x: gate.x + Math.cos(gate.yaw) * s, z: gate.z + Math.sin(gate.yaw) * s });
    lightSources.push({ x: gate.x, y: 2.8, z: gate.z, color: 0xff8844, intensity: 9, dist: 8, door });
    doorList.push(door); doors.push(door);
  };

  // ---------------------------------------------------------------- items (deterministic spots: nearest to the zone centre, 7 m apart, away from the arrival and return points)
  const placeItems = ({ addStation, addWallBuy, addMachine, stations, wallWeapons, wallColors }) => {
    const taken = [[entry.x, entry.z], [ret.x, ret.z]];
    zoneDefs.forEach((zd, k) => {
      const zi = zoneIdx[k], zc = zoneCenters[zi], cells = [];
      for (let c = 0; c < N; c++) if (walk[c] && zlab[c] === zi) cells.push(c);
      const dist = (c) => (wx(c % nx) - zc.x) ** 2 + (wz((c / nx) | 0) - zc.z) ** 2;
      cells.sort((a, b) => dist(a) - dist(b) || a - b);
      for (const item of zd.items || []) {
        const [type, id] = item.split(':'), wall = type === 'wall', minC = wall ? 1.4 : 3.2, maxC = wall ? 2.6 : 40;
        const c = cells.find((q) => clr[q] >= minC && clr[q] <= maxC && taken.every(([tx, tz]) => Math.hypot(wx(q % nx) - tx, wz((q / nx) | 0) - tz) > D.itemGap));
        if (c == null) continue;
        const x = wx(c % nx), z = wz((c / nx) | 0); taken.push([x, z]);
        const dx = zc.x - x, dz = zc.z - z, l = Math.hypot(dx, dz) || 1, fx = x + (dx / l) * 3, fz = z + (dz / l) * 3;
        if (type === 'station') { addStation(x, z, fx, fz); stations[stations.length - 1].zone = zi; }
        else if (wall) { const W = CONFIG.weapons[id], n0 = wallWeapons.length; addWallBuy(id, W.name, W.price, W.ammoPrice, wallColors[id] || 0xff8833, [x, z], fx, fz); if (wallWeapons.length > n0) wallWeapons[n0].zone = zi; }
        else addMachine(type, id, [x, z], zi, Math.atan2(fx - x, fz - z));
      }
    });
  };

  // ---------------------------------------------------------------- zombie spawns: a lattice of free cells of the main component
  const spawns = [];
  for (let j = 7; j < nz; j += D.spawnEvery) for (let i = 7; i < nx; i += D.spawnEvery) {
    let k = j * nx + i;
    if (!(inMain(k) && clr[k] >= 1.5)) { // nudge to a free cell nearby
      k = -1; for (let r = 1; r <= 5 && k < 0; r++) for (let dj = -r; dj <= r && k < 0; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const q = b * nx + a; if (inMain(q) && clr[q] >= 1.5) { k = q; break; } }
    }
    if (k >= 0 && zlab[k] >= 0) spawns.push({ x: wx(k % nx), z: wz((k / nx) | 0), zone: zlab[k] });
  }
  let nav = null;
  const finishNav = () => { nav = levels.regions[region].nav || null; api.nav = nav; };
  const probe = { x: 0, y: 0.1, z: 0 }, probeOut = { push: 0, kind: null, nx: 0, nz: 0 };
  const pickGround = (px, pz, minD, maxD, isOpen) => {
    const pZone = zoneOf(px, pz);
    const ok = (s, lo, hi) => {
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d < lo || d > hi || !(isOpen(s.zone) || s.zone === pZone)) return false;
      if (nav && nav.isBlockedAt(s.x, s.z)) return false;
      probe.x = s.x; probe.y = 0.1; probe.z = s.z; probeOut.push = 0; collision.resolve(probe, 0.45, probeOut);
      return probeOut.push < 0.05;
    };
    for (const [lo, hi] of [[minD, maxD], [Math.max(6, minD * 0.6), maxD * 1.6], [4, 400]]) {
      const c = spawns.filter((s) => ok(s, lo, hi));
      if (c.length) { const s = c[Math.floor(Math.random() * c.length)]; return new THREE.Vector3(s.x + (Math.random() - 0.5) * 0.6, 0, s.z + (Math.random() - 0.5) * 0.6); }
    }
    return null;
  };

  const api = {
    rect: R, region, nav, doors, zoneIdx, zoneCenters, spawns, entry, ret, gate, inArea, zoneOf, pickGround, makeDoors, placeItems, finishNav,
    inRegion: (x, z) => inArea(x, z) && levels.inRegion(region, x, z),
    stats: { buildings: blds.length, trees: data.trees.length, cells: N, free: sizes[main], components: sizes.length, spawns: spawns.length, dress: dressList.length, cars: dressList.filter((o) => o.type === 'car').length, roads: (data.roads || []).length },
    dressMeshes,
  };
  return api;
}
