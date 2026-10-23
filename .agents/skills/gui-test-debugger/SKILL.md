---
name: gui-test-debugger
description: Runs the real game (headless Playwright browser for web, or Godot on virtual display), captures screenshots, and inspects visual/UI bugs (missing textures, broken HUD, camera clipping, misaligned models, invisible walls).
---

# GUI & Visual Test Debugger

## Purpose
Inspect the game visually like a player and verify UI/rendering fixes.

## Guidelines
- Observe and report visual anomalies without modifying game code directly.
- Report observations with screenshots, reproduction steps, and probable root causes (`file:line`).
- Keep throwaway test scripts and screenshots in temporary directories outside repository tracking.

### Browser Testing Procedure
1. Start local dev server: `npx vite --port 5173 --host 127.0.0.1`
2. Open Chromium with `?debug` via Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
3. Set player coordinates via `game.player.pos`, step the loop with `game.update(dt)`.
4. Use a moderate viewport (~1200x400) to maintain performance under software rendering.
5. Inspect captured frames.
6. Terminate the dev server after testing.

### Godot Testing Procedure
- Headless mode does not render visuals. Use a virtual display:
  `xvfb-run -a godot --path godot --write-movie <dir>/run.png --fixed-fps 30 --quit-after <frames> -- --scenario=<name>`
- Compare Godot captures with Three.js web captures at matching coordinates.
