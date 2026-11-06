---
name: weapon-sheet
description: Render all weapon models (or a chosen few) side by side on a contact sheet with tools/weapon-sheet.html, to review or compare weapon designs before and after a change. Use when editing src/weaponParts.js or src/viewmodels.js.
---

# Weapon contact sheet

Needs the dev server (see the `play-test` skill). The page `tools/weapon-sheet.html` builds every model with `buildWeaponModels` and renders them in a grid.

Query parameters:
- `ids=rifle,ak47,…` (default: all 23), `cols=4`, `cw=520&ch=250` (cell size in px)
- `view=side` (default, profile) or `view=three` (three-quarter)
- `hands=1` to show the hand blocks

Capture with Playwright (the page sets `window.__done` when rendered):
```js
await page.goto('http://localhost:5173/tools/weapon-sheet.html?cols=4&cw=520&ch=250');
await page.waitForFunction(() => window.__done);
await (await page.$('canvas')).screenshot({ path: OUT });
```
Then open the PNG with Read and look at it. Check in first person too (`play-test` skill: `game.player.giveWeapon(id, pap)` then `switchWeapon`), including Pack-a-Punch level 3, because accessories are placed from each weapon's `anchors` in `DEFS` (`src/viewmodels.js`).

## How models are built
`src/weaponParts.js` lists the parts of each weapon; `src/viewmodels.js` builds them:
- `P(points, thickness, mat, round, ...tags)`: side profile `[z, y]` (forward is -z) extruded on x, corners rounded; `{ hole: [...] }` cuts a hole (trigger guard, skeleton stock).
- `L(profile, mat, y)`: lathe around the z axis, profile `[[z, radius], …]` (barrels, handguards, suppressors).
- `B(...)` box for small details, `Cz` cylinder, `rail`, `vents`, `flash`, `ring` helpers.
- Tags: `'mag'`, `'stock'`, `'optic'`, `'bolt'` let accessories hide the original part. Keep `anchors`, `muzzle`, `offset` and hands in `DEFS` consistent when moving parts.
