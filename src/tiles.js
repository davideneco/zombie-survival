import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { seeded, hash32 } from './rng.js';
import { addShadowProxy, removeShadowProxy } from './shadowProxy.js';
import { detailCull } from './detailCull.js';
import { gpuOnly, warmUpload } from './gpuOnly.js';
import { buildSurfacesSteps, surfaceMaterial } from './surfaces.js';

// =====================================================================
//  World tiles (step B, chunk 1). The island core (area.json) is built once by realworld.js and never unloaded. Everything outside it is described
//  by tiles (public/data/tiles/t_<ix>_<iz>.json, produced by tools/tiles.mjs, listed in manifest.json) and streamed around the LOCAL camera:
//      absent  --fetch-->  data (JSON in memory)  --build-->  built (GPU meshes)  --dispose-->  data  --drop-->  absent
//  A tile is built only from its own file and its own seeds (rng.js: hash of the building's position, never the build order), so a tile rebuilt after
//  an unload is identical, and every peer sees the same geometry: residency is purely local and visual, there are NO network messages.
//  Per built tile (render only; collision, nav and zones are the districts' business, chunk 2): facade walls and roof (one mesh each, from a STREAMED
//  architecture instance that reuses the core texture array and materials: no new texture, no new shader program), the merged shadow proxy, the ground
//  (one mesh with the shared ground material), the trees (CPU set in the island's culled tree layers) and the lamps (2 instanced meshes + light sources).
//  Everything a tile creates is released by dispose(); shared materials, the facade array and the lamp geometries are never disposed.
//  The build is a generator run in slices (CONFIG.world.stream.sliceMs per frame, one tile at a time: the streamed architecture instance has one set of builders).
// =====================================================================

const ABSENT = 0, DATA = 1, BUILT = 2;
const NO_CUTS = () => [];
const TREE_SLICE = 48; // tile trees handed to the island tree layers per step (each tree writes ~24 foliage cards)

function pointInPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Spatial hash of the footprints of one tile (own buildings and halo): "is this point inside a building" for the street-wall test
function footprintIndex(blds, cell = 32) {
  const grid = new Map();
  const key = (i, j) => i * 65536 + j;
  blds.forEach((b, n) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    b.bb = [x0, z0, x1, z1];
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
      const k = key(i + 4096, j + 4096); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(n);
    }
  });
  return (x, z) => {
    const l = grid.get(key(Math.floor(x / cell) + 4096, Math.floor(z / cell) + 4096));
    if (!l) return false;
    for (const n of l) { const b = blds[n], bb = b.bb; if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pointInPoly(b.pts, x, z)) return true; }
    return false;
  };
}

// the part(s) of rect `a` outside rect `c` (up to 4 rectangles), all { x0, z0, x1, z1 }
function rectsMinus(a, c) {
  const out = [], add = (x0, z0, x1, z1) => { if (x1 - x0 > 0.01 && z1 - z0 > 0.01) out.push({ x0, z0, x1, z1 }); };
  add(a.x0, a.z0, Math.min(a.x1, c.x0), a.z1);
  add(Math.max(a.x0, c.x1), a.z0, a.x1, a.z1);
  const mx0 = Math.max(a.x0, c.x0), mx1 = Math.min(a.x1, c.x1);
  if (mx1 > mx0) { add(mx0, a.z0, mx1, Math.min(a.z1, c.z0)); add(mx0, Math.max(a.z0, c.z1), mx1, a.z1); }
  return out;
}

// shared (tiles and districts): pole + cap (pole material) and lantern (lamp material), pre-translated so an instance is just (x, 0, z)
let lampGeo = null;
export function lampGeometries() {
  if (lampGeo) return lampGeo;
  const pole = mergeGeometries([new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8).translate(0, 2.1, 0), new THREE.ConeGeometry(0.28, 0.2, 8).translate(0, 4.65, 0)]);
  const lantern = new THREE.CylinderGeometry(0.2, 0.14, 0.4, 8).translate(0, 4.35, 0);
  return (lampGeo = { pole, lantern });
}

export function installTiles(game, ctx) {
  const { world, scene, camera } = ctx;
  const W = CONFIG.world, S = W.stream, SK = world.stream; // SK: what realworld.js hands over (core streaming kit)
  if (!SK || (typeof location !== 'undefined' && /[?&]notiles/.test(location.search))) { game.tiles = null; return null; }
  const root = new THREE.Group(); root.name = 'tiles'; scene.add(root);
  const tiles = new Map();   // "ix,iz" -> tile
  const list = [];           // the same tiles, for the residency loops
  let arch = null;           // streamed architecture instance (lazy: the core one must have finished)
  let sliceEnd = 0, timer = 0, manifest = null, job = null, jobTile = null, focusAt = null;
  const queue = [];          // tiles waiting for a build (one job at a time)
  const dummy = new THREE.Matrix4();
  const stats = { built: 0, data: 0, builds: 0, disposes: 0, fetches: 0, errors: 0, lastBuildMs: 0, maxStepMs: 0 };

  // ---------------------------------------------------------------- data
  function fetchData(t) {
    if (t.loading || t.state !== ABSENT) return;
    stats.fetches++;
    t.loading = fetch(`/data/tiles/${t.file}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => { if (t.state === ABSENT && t.want) { t.data = d; t.state = DATA; stats.data++; } })
      .catch((e) => { stats.errors++; console.warn('[tiles] fetch failed', t.file, e.message); t.dead = true; })
      .finally(() => { t.loading = null; });
  }

  // ---------------------------------------------------------------- build (generator: yields when the frame's time slice is used)
  function* buildJob(t) {
    const D = t.data, t0 = performance.now();
    if (!arch) arch = SK.createArchitecture({ renderer: SK.renderer, plasterImg: null, plaster2Img: null, roofP: null, rnd: seeded(1), stream: SK.arch.streamKit() });
    const inside = footprintIndex(D.buildings);
    let nb = 0;
    for (const b of D.buildings) {
      if (b.halo) continue;
      try {
        let cx = 0, cz = 0; for (const [x, z] of b.pts) { cx += x; cz += z; } cx /= b.pts.length; cz /= b.pts.length;
        const rnd = seeded(hash32(Math.round(cx * 10), Math.round(cz * 10), W.seed ^ W.streams.facade)); // the seed of a building is its position, not its rank in the file
        const commercial = !!b.tags.amenity || ['retail', 'commercial', 'hotel'].includes(b.tags.building);
        const streetEdges = b.pts.map(([ax, az], i) => {
          const [bx, bz] = b.pts[(i + 1) % b.pts.length], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
          if (len < 2) return false;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          let nx = dz / len, nz = -dx / len;
          if (pointInPoly(b.pts, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
          return [1.2, 3].every((d) => !inside(mx + nx * d, mz + nz * d));
        });
        arch.building(b.pts, b.tags, b.h, NO_CUTS, { shop: commercial || rnd() < W.shopChance, passageH: 3.6, streetEdges, island: false, rnd });
        nb++;
      } catch (e) { stats.errors++; console.warn('[tiles] building skipped', b.id, e.message); }
      if (performance.now() >= sliceEnd) yield;
    }
    const fg = arch.flushTileSteps(t.ix, t.iz); let fr; // (the builders are emptied step by step: a cancel between two steps is cleaned by abort())
    while (!(fr = fg.next()).done) { if (performance.now() >= sliceEnd) yield; }
    const out = fr.value;
    // ---- objects of the tile, all registered in `o` (t.obj) from the first one on, so that release() undoes exactly what exists at ANY point (a build can be cancelled between two slices)
    const o = { meshes: [], dc: [], proxy: null, lights: [], treeKey: t.key };
    t.obj = o;
    const add = (m) => { root.add(m); o.meshes.push(m); return m; };
    for (const m of [out.walls, out.roof]) if (m) { add(m); detailCull.addMesh(m); o.dc.push(m); }
    if (out.proxy.idx.length) o.proxy = addShadowProxy(root, out.proxy.pos, out.proxy.idx, 'island');
    // ground: the tile minus the island ground plane (which already covers the strip of the core's border)
    const rects = rectsMinus(t, W.groundCore), GT = SK.ground.tile;
    if (rects.length) {
      const pos = [], uv = [], nor = [], idx = [];
      for (const r of rects) {
        const b = pos.length / 3;
        for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]) { pos.push(x, 0, z); nor.push(0, 1, 0); uv.push((x + SK.ground.w / 2) / GT, (-z + SK.ground.h / 2) / GT); } // same mapping as the island plane
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, SK.ground.material); m.receiveShadow = true; m.name = 'tile:ground'; m.matrixAutoUpdate = false;
      gpuOnly(m); add(m);
    }
    yield;
    // flat map layers: roads, pavements, parks, water (2 merged meshes, shared materials)
    {
      const sg = buildSurfacesSteps(D); let sr; // (stepwise: the road / pavement / park / water passes yield every few features)
      while (!(sr = sg.next()).done) { if (performance.now() >= sliceEnd) yield; }
      const g = sr.value;
      if (g.surf) { const m = new THREE.Mesh(g.surf, surfaceMaterial()); m.receiveShadow = true; m.name = 'tile:surf'; m.matrixAutoUpdate = false; gpuOnly(m); add(m); }
      if (g.water && SK.water) { const m = new THREE.Mesh(g.water, SK.water); m.receiveShadow = true; m.name = 'tile:water'; m.matrixAutoUpdate = false; m.userData.noTerrain = true; gpuOnly(m); add(m); }
      else g.water?.dispose();
    }
    yield;
    // trees (CPU set in the island layers: 0 draw calls) and lamps (2 instanced meshes + light sources)
    let nTrees = 0;
    if (SK.trees) {
      for (let i = 0; i < D.trees.length; i += TREE_SLICE) {
        const chunk = D.trees.slice(i, i + TREE_SLICE).map(([x, z]) => ({ x, z, th: 3.2 + 1.3 * (hash32(Math.round(x * 100), Math.round(z * 100), W.seed ^ W.streams.trees) / 4294967296) }));
        nTrees = SK.trees.addSet(t.key, chunk, true); // (returns the size of the whole set)
        if (performance.now() >= sliceEnd) yield;
      }
    }
    if (D.lamps.length) {
      const G = lampGeometries(), n = D.lamps.length;
      const poles = new THREE.InstancedMesh(G.pole, SK.lamps.poleMat, n), lanterns = new THREE.InstancedMesh(G.lantern, SK.lamps.lampMat, n);
      D.lamps.forEach(([x, z], i) => {
        dummy.makeTranslation(x, 0, z); poles.setMatrixAt(i, dummy); lanterns.setMatrixAt(i, dummy);
        const L = W.lampLight, src = { x, y: L.y, z, color: L.color, intensity: L.intensity, dist: L.dist, tile: t.key };
        SK.lightSources.push(src); o.lights.push(src);
      });
      for (const m of [poles, lanterns]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.name = 'tile:lamps'; add(m); }
      poles.castShadow = false;
    }
    t.digest = { buildings: nb, verts: out.digest.verts, tris: out.digest.tris, sum: Math.round(out.digest.sum * 1000) / 1000, trees: nTrees, lamps: D.lamps.length };
    t.state = BUILT; stats.built++; stats.builds++; stats.lastBuildMs = performance.now() - t0;
    warm.push(t);
  }

  // A finished tile sends its meshes (and its shadow proxy) to the GPU at once so the callbacks of gpuOnly free the CPU arrays: a tile beyond the
  // detailCull range is hidden and would keep ~5 MB of vertex arrays until the camera came near.
  const warm = [];
  function warmTiles() {
    const meshes = [];
    for (const t of warm) if (t.state === BUILT && t.obj) { for (const m of t.obj.meshes) meshes.push(m); if (t.obj.proxy) meshes.push(t.obj.proxy); }
    warm.length = 0;
    if (meshes.length && game.gfx?.render) try { warmUpload(scene, SK.renderer, () => game.gfx.render(), meshes); } catch (e) { console.warn('[tiles] warm upload failed', e.message); }
  }

  // frees what the tile owns right now (complete or partial build)
  function release(t) {
    const o = t.obj; if (!o) return;
    for (const m of o.dc) detailCull.remove(m);
    for (const m of o.meshes) {
      root.remove(m);
      if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); // (the lamp geometries are shared)
    }
    if (o.proxy) removeShadowProxy(o.proxy);
    for (const s of o.lights) { const i = SK.lightSources.indexOf(s); if (i >= 0) SK.lightSources.splice(i, 1); }
    SK.trees?.removeSet(o.treeKey);
    t.obj = null;
  }
  function dispose(t) { release(t); if (t.state === BUILT) { t.state = DATA; stats.built--; stats.disposes++; } }
  function abort(t) { // cancelled or failed build: drop the partial objects and whatever the architecture builders still hold
    release(t);
    if (arch) { const o = arch.flushTile(t.ix, t.iz); for (const m of [o.walls, o.roof]) m?.geometry.dispose(); }
  }

  function cancelJob() {
    if (!job) return;
    job.return(); job = null;
    abort(jobTile); // (the builders must be empty for the next tile)
    jobTile.queued = false; jobTile = null;
  }

  // ---------------------------------------------------------------- residency
  const rectDist = (t, x, z) => { const dx = x < t.x0 ? t.x0 - x : x > t.x1 ? x - t.x1 : 0, dz = z < t.z0 ? t.z0 - z : z > t.z1 ? z - t.z1 : 0; return Math.hypot(dx, dz); };

  function check() {
    if (!manifest) return;
    const cx = focusAt ? focusAt.x : camera.position.x, cz = focusAt ? focusAt.z : camera.position.z;
    let built = 0;
    for (const t of list) {
      t.d = rectDist(t, cx, cz);
      t.want = t.d < S.dataOut;
      if (t.state === BUILT || t.queued) built++;
      if (t.state === BUILT && t.d >= S.visOut) { dispose(t); built--; }
      else if (t.queued && t.d >= S.visOut) { if (t === jobTile) cancelJob(); else queue.splice(queue.indexOf(t), 1); t.queued = false; built--; }
      if (t.state === DATA && !t.want && !t.queued) { t.data = null; t.state = ABSENT; stats.data--; }
      else if (t.state === ABSENT && t.want && !t.dead) fetchData(t);
    }
    // builds: the nearest tiles first, within the cap (a nearer tile evicts the farthest built one that is beyond visIn)
    for (;;) {
      let best = null;
      for (const t of list) if (t.state === DATA && !t.queued && !t.dead && t.d < S.visIn && (!best || t.d < best.d)) best = t;
      if (!best) break;
      if (built >= S.maxBuilt) {
        let far = null;
        for (const t of list) if (t.state === BUILT && t.d > S.visIn && t.d > best.d && (!far || t.d > far.d)) far = t;
        if (!far) break;
        dispose(far); built--;
      }
      best.queued = true; queue.push(best); built++;
    }
  }

  function work(budgetMs) {
    sliceEnd = performance.now() + budgetMs;
    for (;;) {
      if (!job) {
        const t = queue.shift(); if (!t) return;
        if (t.state !== DATA) { t.queued = false; continue; }
        jobTile = t; job = buildJob(t);
      }
      let r;
      const t0 = performance.now();
      try { r = job.next(); } catch (e) { stats.errors++; console.warn('[tiles] build failed', jobTile.file, e); r = { done: true }; jobTile.dead = true; abort(jobTile); }
      stats.maxStepMs = Math.max(stats.maxStepMs, performance.now() - t0);
      if (r.done) { jobTile.queued = false; job = null; jobTile = null; }
      if (warm.length && !job && !queue.length) warmTiles(); // (once per batch of builds)
      if (performance.now() >= sliceEnd) return;
    }
  }

  // called once per frame by game.update
  function update(dt) {
    if (!manifest) return;
    timer += dt;
    if (timer >= S.checkEvery) { timer = 0; check(); }
    if (job || queue.length) work(S.sliceMs);
  }

  const busy = () => !!(job || queue.length || list.some((t) => t.loading));
  // Test helper: pretend the camera is at (x, z) (null = back to the real camera), then wait until every tile that must be built is, and every one that must go has gone.
  async function focus(x, z) {
    await ready; focusAt = x == null ? null : { x, z };
    for (let i = 0; i < 400; i++) {
      check();
      await Promise.all(list.map((t) => t.loading).filter(Boolean));
      check();
      work(1e9);
      if (!busy()) break;
    }
    return api.stats();
  }

  const api = {
    root, update, focus, check, work,
    list: () => list,
    stats: () => ({ built: stats.built, data: stats.data, builds: stats.builds, disposes: stats.disposes, fetches: stats.fetches, errors: stats.errors, lastBuildMs: +stats.lastBuildMs.toFixed(1), maxStepMs: +stats.maxStepMs.toFixed(1),
      queued: queue.length + (job ? 1 : 0), geometries: game.renderer ? game.renderer.info.memory.geometries : null, trees: SK.trees?.stats?.() ?? null,
      tiles: list.map((t) => ({ k: t.key, s: t.state, d: Math.round(t.d ?? -1) })) }),
    digest: (key) => { const t = tiles.get(key); return t ? t.digest ?? null : null; },
    manifest: () => manifest,
  };
  game.tiles = api;

  // manifest (async: the game does not wait for it)
  const ready = fetch('/data/tiles/manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
    if (!m) return;
    manifest = m;
    for (const [key, e] of Object.entries(m.tiles)) {
      const [ix, iz] = key.split(',').map(Number), size = m.tileSize;
      const t = { key, ix, iz, k: e.k, file: e.file, x0: ix * size, z0: iz * size, x1: (ix + 1) * size, z1: (iz + 1) * size, state: ABSENT, data: null, obj: null, loading: null, queued: false, want: false, dead: false, d: Infinity, digest: null };
      tiles.set(key, t); list.push(t);
    }
  }).catch(() => {});
  return api;
}
