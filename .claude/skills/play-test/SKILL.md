---
name: play-test
description: Run the real Zombie Survival game headless (Vite dev server + Playwright Chromium with software rendering), place the player or camera with ?debug, drive the game through window.game, take screenshots and collect console errors. Use to verify any gameplay, rendering or UI change, or to reproduce a bug.
---

# Play-test the real game

## 1. Dev server
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/   # 200 = already running
```
If not running, start it detached (in cloud sessions a plain background job can die with the shell):
```bash
(setsid nohup npx vite --port 5173 > /tmp/vite.log 2>&1 &) ; sleep 6
```
Check again with `curl` before every run: it may have stopped since the last command.

## 2. Harness
`.claude/skills/play-test/harness.mjs` loads the game, waits for `game.started`, runs `--eval` steps and takes `--shot` screenshots, then prints console errors.
```bash
node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28&yaw=0&pitch=0.1" \
  --eval "game.player.pos.y" --shot "$SCRATCH/start.png"
```
Put screenshots and throwaway scripts in the session scratchpad, never in the repo. Then **open each screenshot with Read and look at it**.

## 3. Useful URL and in-page handles
- `?debug&x=..&z=..&yaw=..&pitch=..`: start directly in game at that spot (yaw 0 looks toward -z; forward = (-sin yaw, -cos yaw)).
- `window.game` (= `game` in `--eval`): `player` (`pos`, `yaw`, `pitch`, `giveWeapon(id, papLevel)` (replaces the weapon in hand when the inventory is full), `switchWeapon(i)` (find `i` with `inventory.findIndex((w) => w.id === id)`), `inventory`, `addPerk(id)`, `hurt(n)`), `zombies`, `vehicles`, `world` (`floorAt`, `collide`, `rayHit`, `nav`, `machines`, `doors`, `openDoor(id)`, `terrainY`), `summitFx` (sky: `step(dt)` advances the day/night clock, `clockText()`), `perkFx`, `scene`, `update(dt)`.
- Teleport: `game.player.pos.set(x, game.world.terrainY(x, z), z); game.player.yaw = a`.
- Time of day: `for (let i = 0; i < 100; i++) game.summitFx.step(0.5)` (≈ 3.5 h of game time).
- Vehicles headless: audio may not start, so stub `v.stopEngine = v.updateEngine = () => {}` before calling `v.reset()` / `v.update(dt)`.
- Physics checks: set state, then call the object's `update(1 / 60)` in a loop inside one `--eval` and return numbers.

## 4. Practical limits
- Software rendering is slow: one browser at a time, small `--size`, generous waits. Long runs: start the command in the background and wait for its output file.
- Kill leftover browsers if runs start timing out: `pkill -f headless_shell`.
- Weapon models: use the `weapon-sheet` skill. Map defects: use the `map-scan` skill.
