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
- JS heap ≤ 400 MB after load; no growth over a 10-minute session (check `heapMB` again after `for (i < 36000) game.update(1/60)`).
- Programs (shader variants) ≤ 60: every `onBeforeCompile` patch must set `customProgramCacheKey`.

## Baseline measured on v0.87.1 (2026-11-12), island start
858 draw calls, 2.29 M triangles, 11 343 meshes (6 276 visible, 4 083 InstancedMesh with 471 k instances), 5 863 geometries, 373 textures, 85 programs, heap 756 MB, update 0.6 ms median / 2.9 ms p95, load 0.7 s (assets keep streaming after that).
Station quai 1: 319 calls, 0.64 M triangles. Intro (train at speed): 110 calls, 0.50 M triangles. Heap and mesh count are the same everywhere (the whole world stays loaded). Update this section when an optimisation lands.

## Reading the numbers
- Many visible meshes with few instances each → merge per material and per chunk (static) or use one InstancedMesh per prop type for the whole chunk.
- Draw calls far above visible meshes → the shadow pass draws too much: restrict `castShadow` to near, large casters.
- Triangles high → LOD (simplified far facades, no relief beyond ~80 m), cull interiors when the player is outside.
- Heap high → shared geometries/materials, typed arrays instead of object arrays for map data, dispose what an area unloads.
- Docs: `git show origin/reference-docs:three-r170/api/en/objects/InstancedMesh.html` (see the `reference-docs` branch README).
