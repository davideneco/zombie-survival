# Reference documentation (offline copy for agents)

This branch (`reference-docs`) holds the official documentation of the engines, libraries and web APIs used by Zombie Survival, **pinned to the versions the game uses**. It contains no game code and is never merged into `main`.

| Folder | Source | Version | Licence |
|---|---|---|---|
| `three-r170/` | [mrdoob/three.js](https://github.com/mrdoob/three.js) `docs/` (API in `api/en/`, manual in `manual/en/`, addons in `examples/en/`) | r170 (`three@0.170.0`) | MIT (`three-r170/LICENSE`) |
| `vite-6.4.3/` | [vitejs/vite](https://github.com/vitejs/vite) `docs/` (guide, config) | 6.4.3 | MIT |
| `ws-8.22.0/` | [websockets/ws](https://github.com/websockets/ws) `doc/ws.md`, README | 8.22.0 | MIT |
| `playwright-1.63.0/` | [microsoft/playwright](https://github.com/microsoft/playwright) `docs/src` (Page, Browser, Context, Locator, Keyboard, Mouse, ConsoleMessage, screenshots, evaluating) | 1.63.0 (the global one the harness uses) | Apache-2.0 |
| `mdn/` | [mdn/content](https://github.com/mdn/content) `files/en-us/web/api/` subset: Web Audio API and its nodes, WebGL best practices and examples, WebSocket, requestAnimationFrame, performance.now, Page Visibility | `main` at download time | CC-BY-SA 2.5 (`mdn/LICENSE.md`), © Mozilla Contributors |

Exact commits: `SOURCES.txt`. Refresh: `tools/fetch-reference-docs.sh` on `main` (update the versions in it first when `package.json` changes).

## How to read it without leaving your branch
```bash
git fetch origin reference-docs
git show origin/reference-docs:three-r170/api/en/objects/InstancedMesh.html | sed 's/<[^>]*>//g' | less
git grep -n "frustumCulled" origin/reference-docs -- three-r170/
```
Or check it out beside the repo: `git worktree add ../zs-reference reference-docs`.

## Most useful pages for this project
- Three.js: `api/en/objects/InstancedMesh.html`, `api/en/objects/BatchedMesh.html`, `api/en/objects/LOD.html`, `api/en/core/BufferGeometry.html`, `examples/en/utils/BufferGeometryUtils.html` (mergeGeometries), `api/en/materials/Material.html` (onBeforeCompile, customProgramCacheKey), `api/en/renderers/WebGLRenderer.html` (info, shadowMap), `api/en/textures/Texture.html`, `api/en/math/Frustum.html`, `manual/en/introduction/How-to-dispose-of-objects.html`, `manual/en/introduction/How-to-update-things.html`.
- Web Audio (MDN): `web_audio_api/best_practices/`, `audioparam/` (scheduling), `baseaudiocontext/`.
- WebGL (MDN): `webgl_api/webgl_best_practices/index.md`.
