---
name: playtest-bug-hunter
description: Investigates, reproduces, and resolves gameplay bugs (stuck zombies, invisible walls, state desync, memory leaks, frame drops) and writes automated regression tests.
---

# Playtest & Bug Hunter

## Purpose
Track down gameplay and networking defects, determine root causes, fix them, and ensure regression test coverage.

## Guidelines
- Create minimal reproductions.
- For performance drops, first inspect game loop allocations and uncleaned resources (zombie pools, projectiles, event listeners).

### Browser Regression Testing
- Drive the game via Playwright/CDP scripts in `tools/` (reference: `tools/mp-smoke.mjs`).
- Launch with `?debug` and step simulation using `game.update(dt)`.
- For multi-instance network tests, disable rendering (`game.renderer.render = () => {}`) to minimize resource consumption.
- Re-run the reproduction script to confirm resolution.

### Godot Regression Testing
- Add regression tests under `godot/tests/` and run `tools/godot-check.sh`.
- For hitching or frame pacing issues, analyze with `--perf-log=FILE` and `--perf-soak=N`.
