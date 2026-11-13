---
name: perf-check
description: Measure what the game asks of the browser at given spots (draw calls, triangles, meshes, instances, textures, programs, JS heap, game.update cost, load time) with tools/perf-probe.js, and compare before/after an optimisation. Use before and after any rendering, scenery, building or streaming change, and when a player reports a slow game.
---

# Performance check

Needs the dev server (see `play-test`). Headless Chromium renders in **software**: frame times mean nothing, the **counts** do (draw calls, triangles, meshes, heap) and so does `game.update` cost.

## Baseline views (always measure the same ones, at 1280x720)
```bash
H=".claude/skills/play-test/harness.mjs"; P="tools/perf-probe.js"
node $H --size 1280x720 --url "debug&x=-0.6&z=-28&yaw=0" --file $P     # island start (Marché-Neuf)
node $H --size 1280x720 --url "debug&gare" --file $P                    # station, quai 1
node $H --size 1280x720 --url "debug&intro" --file $P                   # intro, inside the moving train
```
Each prints one JSON line: `render.calls`, `render.triangles`, `memory.{geometries,textures,programs}`, `scene.{meshes,visibleMeshes,instancedMeshes,instances}`, `updateMs.{median,p95}`, `heapMB`, `loadMs`.

## Budgets (target: 60 FPS on a mid-range PC, integrated GPU acceptable at "low")
- ≤ 300 draw calls and ≤ 1.5 M triangles in any view at default quality; shadow pass included in the calls count.
- `game.update` p95 ≤ 4 ms with a full round of zombies.
- JS heap ≤ 400 MB after load (measured after a GC); no growth over a 10-minute session (check `heapMB` again after `for (i < 36000) game.update(1/60)`).
- Programs (shader variants) ≤ 60: every `onBeforeCompile` patch must set `customProgramCacheKey`.

## Baseline after the triangle + heap pass (steps A2 + A3, 2026-11-13), island start
279 draw calls (233 main + 40 shadow), 1.10 M triangles (0.92 M main + 0.18 M shadow), 85 programs (still over 60), heap 347-368 MB after GC (the harness runs Chromium with `--expose-gc` and the probe calls `gc()` before reading it), update 0.4-0.6 ms median (p95 is noise-bound when the machine is shared: compare best-of-N, see below). Station quai 1: 185 calls, 0.64 M triangles. Intro: 96 calls, 0.51 M triangles. Mechanisms: ground chunks, tree range culling, GPU-only geometry (`gpuOnly.js`), freed build buffers (details in `docs/ARCHITECTURE.md` §3). `perf-breakdown.js` now lists the biggest triangle consumers first. To find heap consumers: CDP `HeapProfiler.takeHeapSnapshot`, sum `self_size` by type (the typed-array backing stores show as `native system / JSArrayBufferData`; `performance.memory` counts them).

## (older) Baseline after the draw-call pass (step A1, 2026-11-12), island start (day, fog 0.011)
271 draw calls (`tools/perf-breakdown.js`: 224 main + 40 shadow), 1.97 M triangles (1.56 M main + 0.40 M shadow), 8 178 meshes (2 352 visible, 4 083 InstancedMesh with 471 k instances), 3 054 geometries, 320 textures, 85 programs, heap 756-803 MB (noisy), update 0.6 ms median / 3.3 ms p95, load 0.7 s.
Station quai 1: 185 calls, 0.64 M triangles. Intro (train at speed): 96 calls, 0.50 M triangles. Before A1 (v0.87.1): 858 / 319 / 110 calls, 2.29 M triangles at the island start. Heap and mesh count are the same everywhere (the whole world stays loaded). Update this section when an optimisation lands.
For the per-object split of one frame (main vs shadow pass): `node $H --size 1280x720 --url "debug&x=-0.6&z=-28&yaw=0" --file tools/perf-breakdown.js`.

## Reading the numbers
- Many visible meshes with few instances each → merge per material and per chunk (static) or use one InstancedMesh per prop type for the whole chunk.
- Draw calls far above visible meshes → the shadow pass draws too much: restrict `castShadow` to near, large casters.
- Triangles high → LOD (simplified far facades, no relief beyond ~80 m), cull interiors when the player is outside.
- Heap high → shared geometries/materials, typed arrays instead of object arrays for map data, dispose what an area unloads.
- Docs: `git show origin/reference-docs:three-r170/api/en/objects/InstancedMesh.html` (see the `reference-docs` branch README).
