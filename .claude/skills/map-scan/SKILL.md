---
name: map-scan
description: Scan the Strasbourg map for defects with tools/stuck-scan.mjs (isolated areas, trap pockets you can enter but not leave, bots getting stuck, invisible walls, walk-through walls, z-fighting), and check that every spawn point is open. Use after changing collision, buildings, terrain, doors or spawn points, or when a player reports being stuck.
---

# Map scan

Needs the dev server (see the `play-test` skill).

## Full scan
```bash
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs ONLY=comp,pockets,bots,rays RAYS=6000 BOTS=80 BOT_SECONDS=40 \
  node tools/stuck-scan.mjs http://localhost:5173/ "$SCRATCH/scan"
```
It runs several minutes: start it in the background and wait for `"$SCRATCH/scan/report.json"`. Steps (`ONLY=`): `comp`, `pockets`, `bots`, `rays`, `zfight`. All doors are open during the scan.

## Reading the results
- `liens.txt`: every finding with coordinates and a `?debug&x&z&yaw&pitch` link that drops the player on the spot; `hotspots.png`: the findings on the map; `report.json`: details.
- **Trap pockets** (enter but cannot leave) and **stuck bots** are real bugs: fix them.
- **Invisible walls** (collision without mesh): most hits on thin circles (`kind: prop`, `r ≈ 0.1`) are lamp posts the ray test misses; check a segment (`kind: wall`) with a screenshot before changing anything.
- **Walk step** (`ONLY=walk WALKS=4000`): walks with the real player collision and, at each block, looks for a visible mesh at 0.3 / 0.9 / 1.6 m. Most hits are false positives: props drawn only near the player (instanced furniture, Morris columns), benches and barriers the rays pass under or over, shelf ends and door-jamb corners hit at a grazing angle. Re-check each hit on the spot (teleport the player there, let the scenery load, raycast again with DoubleSide) and look at a screenshot before changing anything.
- **Walk-through walls** (mesh without collision): thin decorative meshes (tram platforms, a few cm) are usually harmless.
- A few hundred small "pockets" are normal: building interiors and courtyards closed off from the street.

## Spawn points (random start)
`CONFIG.spawnPoints` in `src/config.js`. Each must be on a free nav cell connected to the city. Check in the page:
```js
const nav = game.world.nav, { labels, sizes } = nav.components();
(await import('/src/config.js')).CONFIG.spawnPoints.map((s) => { const id = labels[nav.idx(nav.cx(s.x), nav.cz(s.z))]; return [s.name, id ? Math.round(sizes[id] * nav.cell ** 2) : 'BLOCKED']; })
```
`BLOCKED` or a tiny area means the player would start inside a wall or a closed courtyard. `applySpawnPoint` in `src/main.js` also moves a blocked spawn to the nearest free cell as a safety net.
