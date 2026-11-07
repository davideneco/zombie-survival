import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { planGare } from './plan.js';
import { buildGareMeshes } from './build.js';
import { buildIntroRoute, buildRailNet } from '../railNet.js';
import { Train } from '../train.js';
import { buildRideScenery } from '../rideScenery.js';
import { introProfile } from '../intro.js';

// =====================================================================
//  Gare de Strasbourg (v0.79.0) : a separate small playable area at its real coordinates (same frame as area.json), joined to the
//  Grande Île only by the tram (src/transfer.js). Called by realworld.js :
//    loadGareData()           public/data/gare.json + rail.json (null when missing : the island works alone)
//    buildGare(ctx)           meshes, collision, the floor region GARE (its own nav grid), light spots, zones, doors, spawn points
//    gare.placeItems(h)       ammo stations, wall weapons, perks, box of the station zones (fixed spots, realworld helpers)
//    gare.beforeNavs() / gare.finishNav()   door segments are off while the region grid is built, then their cells are blocked
//  The returned object answers zoneOf / inArea / pickGround / map for the station ; realworld.js routes its public API to it.
// =====================================================================

export async function loadGareData() {
  if (!CONFIG.gare?.enabled) return null;
  try {
    const [g, r] = await Promise.all(['/data/gare.json', '/data/rail.json'].map((u) => fetch(u).then((res) => (res.ok ? res.json() : null))));
    return g && r ? { gare: g, rail: r } : null;
  } catch { return null; }
}

const inPoly = (x, z, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; } return a / 2; };

function seeded(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildGare(ctx) {
  const { data, scene, collision, levels, lightSources, props, pbr, tiled, zoneNames, createArchitecture, createTrees, renderer, plasterImg, plaster2Img, roofP, barkMat, envMap } = ctx;
  const G = CONFIG.gare;
  const plan = planGare(data.gare, data.rail);
  if (!plan) return null;
  const route = buildIntroRoute(data.rail, plan); // v0.80.0 : the south-west approach of the intro, laid beside quai 1 (railNet.js)
  const { root, colliders, mats } = buildGareMeshes({ plan, gare: data.gare, rail: data.rail, pbr, tiled, props, envMap, route });
  scene.add(root);
  const railNet = buildRailNet({ rail: data.rail, plan, route, mats: { ballast: mats.ballast, sleeper: mats.sleeper, rail: mats.rail, steel: mats.steel, iron: mats.iron } });
  root.add(railNet.root);
  const W = plan.W;

  // ---------------------------------------------------------------- surrounding buildings (hotels, SNCF offices) : the island's façade builder,
  // with its own seeded draw (the island's draws are untouched) ; the station itself and its parts are drawn by build.js
  const arch = createArchitecture({ renderer, plasterImg, plaster2Img, roofP, rnd: seeded(55331) });
  const bldPolys = [];
  for (const b of data.gare.buildings || []) {
    if ((b.tags?.building === 'train_station') || !b.pts || b.pts.length < 3) continue;
    let pts = b.pts.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    const a = polyArea(pts);
    if (Math.abs(a) < 40 || (b.h || 10) < 6) continue; // shelters and kiosks : drawn as street furniture
    if (a < 0) pts.reverse();
    arch.building(pts, b.tags || {}, b.h || 14, () => [], { ignH: b.ignH, inSector: true, shop: false });
    bldPolys.push(pts);
    for (let i = 0; i < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length]; collision.addSegment(ax, az, bx, bz); }
  }
  arch.finish(root);

  // ---------------------------------------------------------------- trees (OSM) : forecourt groves ; collision for the ones in the playable place
  const treeList = [];
  for (const [x, z] of data.gare.trees || []) {
    const [u, v] = plan.L(x, z);
    if (v < plan.body.v1 + 2 && v > plan.body.v0 - 60) continue; // station building and tracks
    if (plan.walls.some((w) => distSeg(u, v, w.a, w.b) < 1.2) || colliders.some((c) => Math.abs(c.u - u) < c.lu / 2 + 1 && Math.abs(c.v - v) < c.lv / 2 + 1)) continue;
    treeList.push({ x, z, th: 3.4 + 1.3 * (Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) });
    if (inPoly(x, z, plan.walk.place)) collision.addCircle(x, z, 0.3);
  }
  const trees = createTrees(root, treeList, barkMat);

  // ---------------------------------------------------------------- collision : walkable boundary walls, furniture boxes
  for (const w of plan.walls) {
    const [ax, az] = W(...w.a), [bx, bz] = W(...w.b);
    collision.addSegment(ax, az, bx, bz, w.h, -Infinity, w.kind === 'barrier' ? 'prop' : 'wall');
  }
  const F = plan.frame;
  for (const c of colliders) {
    const [x, z] = W(c.u, c.v);
    const du = Math.cos(c.rot || 0), dv = Math.sin(c.rot || 0), dx = F.ux * du + F.vx * dv, dz = F.uz * du + F.vz * dv;
    collision.addBox(x, z, c.lu, c.lv, Math.atan2(dz, dx), c.h ?? 3, -Infinity, c.prop ? 'prop' : 'wall', false);
  }
  collision.addBounds?.(plan.bounds);

  // ---------------------------------------------------------------- floor region (own nav grid ; no stair link : island and station zombies stay apart)
  const region = levels.addRegion('Gare de Strasbourg', 0, 'floor', { ground: true, navCell: G.navCell, navMaxCost: G.navMaxCost, navMargin: 0.5 });
  for (const poly of Object.values(plan.walk)) {
    let pts = poly.slice();
    if (polyArea(pts) < 0) pts.reverse();
    try { levels.addPoly(region, pts, 0); } catch (e) { console.warn('[gare] floor polygon', e.message); }
  }

  // ---------------------------------------------------------------- the regional train, parked at quai 1, doors open (train.js ; v0.80.0)
  let train = null;
  if (route) {
    try { train = new Train(route, { parent: root, collision, lightSources, region, y0: G.railY + CONFIG.railNet.railTop, envMap }); }
    catch (e) { console.warn('[gare] train', e); }
  }

  // ---------------------------------------------------------------- trackside scenery of the intro ride (v0.81.0, rideScenery.js)
  let scenery = null;
  if (route && train && CONFIG.intro?.enabled) {
    try {
      const P = introProfile(), s0 = route.parkHeadS - P.D, W = CONFIG.intro.scenery.wreck;
      const midU = train.L / 2 - train.veh[Math.min(2, train.n - 1)].uc; // nose -> middle of the second coach (where the players stand)
      scenery = buildRideScenery({ route, plan, rail: data.rail, gare: data.gare, sFrom: Math.max(0, s0 - CONFIG.intro.scenery.from), wreckS: s0 + P.dist(W.at) - midU, groundMat: railNet.groundMat, groundY: railNet.groundY });
      root.add(scenery.root);
    } catch (e) { console.warn('[gare] ride scenery', e); }
  }
  // the train's approach counts as the station area (areaOf : the station is drawn, not the island) : within `corridor` m of the route
  const _pr = {};
  const inCorridor = (x, z) => !!route && route.track.project(x, z, CONFIG.intro?.corridor ?? 60, _pr).d < Infinity;

  // ---------------------------------------------------------------- light spots (pooled point lights of realworld.js)
  for (const l of plan.lights) { const [x, z] = W(...l.l); lightSources.push({ x, y: l.y, z, color: l.color, intensity: l.intensity, dist: l.dist }); }

  // ---------------------------------------------------------------- zones : polygons rasterised at 1 m, widened over walls (like the island)
  const zoneIdx = {};
  for (const name of Object.keys(plan.zones)) zoneIdx[name] = zoneNames.indexOf(name);
  const b = plan.bounds, ZC = 1, zx = Math.ceil((b.x1 - b.x0) / ZC), zz = Math.ceil((b.z1 - b.z0) / ZC);
  const zlab = new Int8Array(zx * zz).fill(-1);
  for (let j = 0; j < zz; j++) for (let i = 0; i < zx; i++) {
    const x = b.x0 + (i + 0.5) * ZC, z = b.z0 + (j + 0.5) * ZC;
    for (const [name, polys] of Object.entries(plan.zones)) if (polys.some((p) => inPoly(x, z, p))) { zlab[j * zx + i] = zoneIdx[name]; break; }
  }
  for (let step = 0; step < 3; step++) {
    const prev = zlab.slice();
    for (let j = 0; j < zz; j++) for (let i = 0; i < zx; i++) {
      const k = j * zx + i; if (prev[k] >= 0) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, c = j + dj; if (a >= 0 && c >= 0 && a < zx && c < zz && prev[c * zx + a] >= 0) { zlab[k] = prev[c * zx + a]; break; } }
    }
  }
  const inArea = (x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  const zoneOf = (x, z) => { if (!inArea(x, z)) return -1; const i = Math.floor((x - b.x0) / ZC), j = Math.floor((z - b.z0) / ZC); return zlab[j * zx + i]; };
  const zoneCenters = {};
  for (const [name, polys] of Object.entries(plan.zones)) {
    let best = null, ba = 0;
    for (const p of polys) { const a = Math.abs(polyArea(p)); if (a > ba) { ba = a; best = p; } }
    let cx = 0, cz = 0, a2 = 0; // area centroid (the vertex average leans toward the finely traced verrière curve)
    for (let i = 0; i < best.length; i++) { const [x0, z0] = best[i], [x1, z1] = best[(i + 1) % best.length], k = x0 * z1 - x1 * z0; a2 += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k; }
    const c = [cx / (3 * a2), cz / (3 * a2)];
    zoneCenters[zoneIdx[name]] = { name, x: c[0], z: c[1], area: polys.reduce((s, p) => s + Math.abs(polyArea(p)), 0) };
  }

  // ---------------------------------------------------------------- spawn points (world) per zone
  const spawns = plan.spawns.map((s) => { const [x, z] = W(...s.l); return { x, z, zone: zoneIdx[s.zone] }; }).filter((s) => s.zone >= 0);

  // ---------------------------------------------------------------- doors (same fields as the island doors ; their cells live in the region grid)
  const doors = [];
  const makeDoors = ({ doorList, zonePrice }) => {
    for (const d of plan.doors) {
      const a = zoneIdx[d.a], bz = zoneIdx[d.b];
      if (a < 0 || bz < 0) continue;
      const price = Math.max(zonePrice(a), zonePrice(bz));
      const door = { id: doorList.length, price, a, b: bz, toZone: zoneIdx[d.to], name: d.to, open: false, points: [], segs: [], meshes: [], cells: [], portal: false, pocket: 'gare' };
      const tex = doorSignTex(price, `${d.a} ↔ ${d.b}`);
      const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 });
      for (const [p, q] of d.segs) {
        const [x0, z0] = W(...p), [x1, z1] = W(...q), len = Math.hypot(x1 - x0, z1 - z0);
        door.segs.push(collision.addSegment(x0, z0, x1, z1, 3.4));
        const gm = props.gate(len);
        gm.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); gm.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        for (const side of [-1, 1]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.6, len), Math.min(2.6, len) * 0.375), signMat);
          sign.position.set(0, 2.0, side * 0.16); sign.rotation.y = side > 0 ? 0 : Math.PI; gm.add(sign);
        }
        root.add(gm); door.meshes.push(gm);
        for (let s = 0; s <= len; s += 1.5) door.points.push({ x: x0 + ((x1 - x0) * s) / len, z: z0 + ((z1 - z0) * s) / len });
        lightSources.push({ x: (x0 + x1) / 2, y: 2.8, z: (z0 + z1) / 2, color: 0xff8844, intensity: 9, dist: 8, door });
      }
      doorList.push(door); doors.push(door);
    }
  };

  // ---------------------------------------------------------------- items (fixed spots ; the realworld helpers add them to the scene)
  const placeItems = ({ addStation, addWallBuy, addMachine, stations, wallWeapons, wallColors }) => {
    const before = new Set(scene.children);
    for (const [name, list] of Object.entries(plan.items)) {
      const zi = zoneIdx[name];
      if (zi < 0) continue;
      for (const [type, id, u, v, phi] of list) {
        const [x, z] = W(u, v), du = Math.sin(phi), dv = Math.cos(phi);
        const fx = x + (F.ux * du + F.vx * dv) * 3, fz = z + (F.uz * du + F.vz * dv) * 3;
        if (type === 'station') { addStation(x, z, fx, fz); stations[stations.length - 1].zone = zi; }
        else if (type === 'wall') {
          const Wc = CONFIG.weapons[id], n0 = wallWeapons.length;
          addWallBuy(id, Wc.name, Wc.price, Wc.ammoPrice, wallColors[id] || 0xff8833, [x, z], fx, fz);
          if (wallWeapons.length > n0) wallWeapons[n0].zone = zi;
        } else addMachine(type, id, [x, z], zi, Math.atan2(fx - x, fz - z));
      }
    }
    for (const o of scene.children) if (!before.has(o)) { scene.remove(o); root.add(o); } // into the station group (area visibility)
  };

  // ---------------------------------------------------------------- navigation : door cells blocked in the region grid
  let nav = null;
  const beforeNavs = () => { for (const d of doors) for (const s of d.segs) s.off = true; };
  const finishNav = () => {
    nav = levels.regions[region].nav || null;
    for (const d of doors) {
      d.nav = nav;
      for (const s of d.segs) {
        s.off = false;
        if (!nav) continue;
        const r = nav.margin + nav.cell;
        const ix0 = Math.max(0, nav.cx(Math.min(s.ax, s.bx) - r)), ix1 = Math.min(nav.nx - 1, nav.cx(Math.max(s.ax, s.bx) + r));
        const iz0 = Math.max(0, nav.cz(Math.min(s.az, s.bz) - r)), iz1 = Math.min(nav.nz - 1, nav.cz(Math.max(s.az, s.bz) + r));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
          const i = nav.idx(ix, iz);
          if (nav.blocked[i]) continue;
          const px = nav.worldX(ix), pz = nav.worldZ(iz), abx = s.bx - s.ax, abz = s.bz - s.az, l2 = abx * abx + abz * abz;
          let t = l2 > 0 ? ((px - s.ax) * abx + (pz - s.az) * abz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - (s.ax + abx * t), dz = pz - (s.az + abz * t);
          if (dx * dx + dz * dz < nav.margin * nav.margin + 0.3) { nav.blocked[i] = 1; d.cells.push(i); }
        }
      }
    }
    nav?.invalidate();
    api.nav = nav;
  };

  // ---------------------------------------------------------------- zombie spawns in the station : the points of open zones (or the player's zone)
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

  // ---------------------------------------------------------------- map (M) : its own plan
  const mapScale = 1.6, map = drawMap(plan, data.gare, bldPolys, mapScale);

  // ---------------------------------------------------------------- distance cull of the station items (v0.80.0, draw calls) : machines, wall
  // weapons, ammo stations, the box and door gates are small objects made of many meshes ; past CONFIG.gare.itemCull m from the camera they are
  // not drawn. Each one is wrapped in a group of its own on the first call (the game keeps showing / hiding the item itself).
  const baseChildren = new Set(root.children); // everything built so far ; the items come later (makeDoors, placeItems, realworld.js)
  let culls = null, cullT = 0;
  const cullItems = (cam, dt) => {
    if ((cullT -= dt) > 0) return;
    cullT = 0.25;
    if (!culls) {
      culls = [];
      const box = new THREE.Box3(), sph = new THREE.Sphere();
      for (const o of [...root.children]) {
        if (baseChildren.has(o) || o.isLight) continue;
        let light = false; o.traverse((q) => { if (q.isLight) light = true; });
        box.setFromObject(o);
        if (light || box.isEmpty()) continue;
        box.getBoundingSphere(sph);
        if (sph.radius > 8) continue;
        const g = new THREE.Group(); g.name = 'gare:cull'; root.remove(o); g.add(o); root.add(g);
        culls.push({ g, x: sph.center.x, z: sph.center.z, r: sph.radius });
      }
    }
    const D = CONFIG.gare.itemCull;
    for (const c of culls) c.g.visible = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r < D;
  };

  const start = { ...CONFIG.gareSpawn, x: plan.start.x, z: plan.start.z, yaw: plan.start.yaw };
  const api = {
    plan, root, region, trees, arch, nav, doors, spawns, zoneIdx, zoneCenters, start, route, railNet, train, scenery,
    bounds: plan.bounds, inArea, inCorridor, zoneOf,
    inRegion: (x, z) => inArea(x, z) && levels.inRegion(region, x, z),
    makeDoors, placeItems, beforeNavs, finishNav, pickGround, cullItems,
    stop: plan.stop, map: { image: map, view: { halfX: -plan.bounds.x0, halfZ: -plan.bounds.z0, scale: mapScale }, crop: { ...plan.bounds }, title: 'GARE CENTRALE — STRASBOURG' },
  };
  return api;
}

const distSeg = (u, v, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; let t = l2 ? ((u - a[0]) * dx + (v - a[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(u - a[0] - dx * t, v - a[1] - dz * t); };

function doorSignTex(price, names) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
  const x = cv.getContext('2d');
  x.fillStyle = '#1a0d0a'; x.fillRect(0, 0, 512, 192);
  x.strokeStyle = '#ffd24a'; x.lineWidth = 6; x.strokeRect(8, 8, 496, 176);
  x.textAlign = 'center';
  x.fillStyle = '#fff'; x.font = 'bold 34px Arial, sans-serif'; x.fillText('PORTE VERROUILLÉE', 256, 62);
  x.fillStyle = '#ffd24a'; x.font = 'bold 54px Arial, sans-serif'; x.fillText(`${price} PTS`, 256, 126);
  x.fillStyle = '#aaa'; x.font = '24px Arial, sans-serif'; x.fillText(names, 256, 164, 480);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// station map : walkable floor by zone, buildings, platforms, tracks, the verrière
function drawMap(plan, gare, bldPolys, S) {
  const b = plan.bounds, W = Math.round((b.x1 - b.x0) * S), H = Math.round((b.z1 - b.z0) * S);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const P = ([px, pz]) => [(px - b.x0) * S, (pz - b.z0) * S];
  const fill = (pts, col) => { x.fillStyle = col; x.beginPath(); pts.forEach((p, i) => { const [X, Y] = P(p); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.closePath(); x.fill(); };
  x.fillStyle = '#16181c'; x.fillRect(0, 0, W, H);
  for (const p of gare.platforms || []) fill(p.pts, '#2a2d31');
  fill(plan.walk.place, '#3a3e44'); fill(plan.walk.q1, '#44484e'); fill(plan.walk.q23, '#44484e'); for (const k of Object.keys(plan.walk)) if (k.startsWith('crossing')) fill(plan.walk[k], '#5a5040');
  fill(plan.walk.hall, '#4c4436'); fill(plan.walk.verriere, '#2f4a5e');
  for (const p of bldPolys) fill(p, '#7a6a55');
  const B = plan.body;
  const box = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => plan.W(u, v));
  for (const [a, c] of [[B.u0, plan.hall.u0], [plan.hall.u1, B.u1]]) fill(box(a, c, B.v0, B.v1), '#8a7860');
  for (const p of [...plan.pavilions, ...plan.annexes]) fill(box(p.u0, p.u1, p.v0, p.v1), '#8a7860');
  x.strokeStyle = 'rgba(160,150,140,0.5)'; x.lineWidth = 1;
  return cv;
}
