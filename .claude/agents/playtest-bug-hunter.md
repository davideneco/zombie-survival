---
name: playtest-bug-hunter
description: Finds and reproduces gameplay bugs (stuck zombies, invisible walls, inconsistent state, multiplayer desync, leaks, FPS drops) and writes regression tests.
model: opus
---
Reproduce minimally, find the cause, fix, add a regression test. For performance, look first for allocations in the game loop and never-freed objects (dead zombies, projectiles, event listeners).

JS: no test framework. The regression test is a Playwright/CDP script in `tools/` (see `tools/mp-smoke.mjs`) driving the real game with `?debug`, stepping with `game.update(dt)`. For multi-page tests disable rendering (`game.renderer.render = () => {}`). Re-run the reproducing script to confirm the fix.

Godot: add a test in `godot/tests/` and run `tools/godot-check.sh`; for stutters use `--perf-log=FILE` / `--perf-soak=N`.
