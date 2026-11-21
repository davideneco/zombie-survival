# Zombie Survival — AI collaboration rules (all agents)

Browser game (Three.js + Vite, Node relay), deployed from `main` on Render. Game text is French.
Instructions per agent: Claude → [`CLAUDE.md`](CLAUDE.md) (subagents `.claude/agents/`, skills `.claude/skills/`).

## Who owns what
Claude owns everything, sound included (`src/audio.js`, `src/music.js`, `public/music/`, `public/sfx/`, `docs/AUDIO.md`, `tools/audio-*`). If several agents work at the same time, keep each to its own files and ship small and often.

## Git workflow (the user wants every change on `main` with a version and a description)
1. Work on **your own branch** (the session branch `claude/...`, created from `origin/main`). Never commit on `main`, never force-push `main`.
2. Ship with the one command (it rebases on `main`, takes the next free version, writes the CHANGELOG entry, builds, pushes branch and `main`):
   ```bash
   node tools/ship.mjs <patch|minor> "<English subject>" --changelog notes.txt [--body body.txt] [--trailer "Co-Authored-By: …"]
   ```
   `notes.txt` = French player-facing bullets ending with "Vérifié : … / Non vérifié : …" (no heading). Details: header of `tools/ship.mjs`.
3. Ship small and often: the shorter a branch lives, the fewer conflicts. If the rebase reports a conflict, nothing is lost: merge `origin/main` by hand.

## Technical memory (read before changing the engine or the city)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): conventions, rendering pipeline, performance mechanisms and budgets, city/building/interior generation, progression systems, scaling limits.
- Official docs pinned to the versions used: branch `reference-docs` (`git fetch origin reference-docs`, then `git show origin/reference-docs:three-r170/api/en/objects/InstancedMesh.html`). Prefer them to memory for three.js r170 APIs.
- Performance budgets and how to measure: `.claude/skills/perf-check/SKILL.md` (`tools/perf-probe.js`).
- **CPU & RAM discipline (mandatory for every future update)**:
  - Keep the FPS cap (`settings.maxFps`, default 60), idle/menu/pause/gunsmith 3D throttling (~15 FPS, no shadow re-renders), and `document.hidden` render pause intact — never run unbounded 144 Hz rendering in menus or background tabs.
  - Stream long audio/music via `<audio>` (`MediaElementAudioSourceNode`), NEVER `decodeAudioData` full multi-minute OGG/MP3 tracks into RAM.
  - Keep static scenery `matrixAutoUpdate = false`, wrap tiled LOD meshes in static parent `THREE.Group`s, call `gpuOnly()` on static geometry, and free temporary canvas/typed-array buffers right after GPU upload.
  - Cap `pixelRatio <= 1.5`, keep post MSAA `samples <= 2`, keep facade atlas slices power-of-two height (`<= 640×512`), and never mutate DOM `.style` / `.textContent` every frame without a dirty check.
  - Stay within ≤ 300 draw calls, ≤ 1.5 M triangles, ≤ 60 shader programs, `game.update` p95 ≤ 4 ms, and JS heap ≤ 400 MB.

## Rules for everyone
- Be honest about what was verified (build, headless run, screenshots) and what was not.
- Balance values live in `src/config.js`. `docs/REFERENCE.md` and `docs/csv/` are generated (`node tools/make-docs.mjs`), never edited by hand.
- No copyrighted music (`public/music/theme.*` is git-ignored). No screenshots, logs or `dist/` in commits.
- Verification: `npx vite build`, then the real game headless via `.claude/skills/play-test/harness.mjs` (see its `SKILL.md`; the harness is plain Node + Playwright, usable by any agent).
- Save tokens: grep before reading big files (`src/main.js`, `src/realworld.js`, `src/vehicles.js`, `src/config.js`), never read `public/data/*.json`, `package-lock.json` or generated docs, keep reports short.
