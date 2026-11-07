# Train intro, Gare de Strasbourg and tram transfer — design spec

Status: design only, nothing implemented. Player-facing text is in French; everything else in English.
Evidence references are `file:line` in the current tree (v0.78.2) unless noted.

## Summary

- The game can start inside a moving regional train that follows **real SNCF track geometry** and stops at quai 1 of the **Gare de Strasbourg**.
- The station is a **separate small playable area** placed at its **real coordinates in the same frame as `area.json`**. No streets are modelled between it and the Grande Île.
- A CTS tram stop on the forecourt (« Gare Centrale ») sends players to the **Homme de Fer** B/C/F platform: a short tram ride animation, then a teleport. A terminal there takes them back.
- The train reuses the tram's walkable moving frame (walking, shooting, grenades, network), with **one rigid frame per coach** because coaches are much longer than tram modules.
- The station model is new and faithful (historic 1883 building, 2007 glass verrière, platform canopies, hall, forecourt). Nothing of the v0.59 geometry is reused.
- Later phases: real terrain from IGN RGE ALTI, then optionally better buildings from Strasbourg open data.

---

## 0. What exists today

### Map data
- `public/data/area.json` keys: `center` (48.5822, 7.7485), `half` 820, `halfZ` 560, `buildings` 3186, `parts` 764, `passages`, `water`, `trees`, `lamps`, `furniture`, `extraFurniture`. `roads`, `parks`, `barriers` are empty.
- It has **no `rails` and no `platforms` key**: it predates v0.59.0, which added `rails`, `platforms` and `way["highway"]` to `tools/fetch-osm.mjs`. The only rails in the game are the two hand-traced tram lines in `src/config.js:596-607`.
- `data/osm_raw.json` is an unrelated 273-element fetch with no rails.

### Bounds and island
- Frame: x in [-820, 820] (east), z in [-560, 560] (south) (`src/realworld.js:180`, `src/island.js:47`).
- `Collision` clamps every position to ±halfX/±halfZ (`src/collision.js:6`, `:218-224`). The ground NavGrid is ±820 × ±560 at 0.75 m (`src/realworld.js:739`).
- `computeIsland` on the data: island x [-737, 621], z [-551, 381], about 0.79 km². West edge x ≈ -731 for z in [-50, 150]; the Ill at x ≈ -751 to -770.
- `terrainY` clamps to the island grid edge outside it (`src/terrain.js:26-34`).

### Where the station is (old `gare.json` from commit `4880783`, re-projected into the `area.json` frame)

| Feature | x | z | Notes |
|---|---|---|---|
| Station building (`building=train_station`, Q801473) | -1120 to -964 | -429 to -215 | long axis SW–NE, ~32° east of north |
| Verrière (`roof:shape=round`, `roof:height` 12, glass) | -1073 to -979 | -380 to -244 | curved strip on the SE face |
| Quai 1 | -1107 to -947 | -503 to -215 | |
| Forecourt hotels (Ibis, Grand Hôtel, Vendôme) | -901 to -845 | | east side of Place de la Gare |

The station is 130–400 m outside the current bounds and 110–250 m from the island.

### SNCF track data (downloaded by the main session)
- Source: SNCF Réseau « Fichier de formes des voies du Réseau Ferré National » (ODbL), 112 LineStrings within 6 km.
- Fields: `code_ligne`, `nom_voie`, `code_voie`, `type_voie` (VPL main / VPA / VS service), `pk_debut_r`, `pk_fin_r`, endpoints in Lambert-93 and WGS84.
- Each feature spans its whole line, so it must be clipped to a corridor.
- Clipped to 3 km around the station:
  - SW approach: lines 115000 and 110000, tracks V1/V2, ~3 km, from about (-3200, +1700) to (-1150, -200);
  - north / north-east: 070000, 145000; south-east (passing south of the island): 142000 V1;
  - station tracks VPA/5, VPA/7 (x -1102 to -995, z -521 to -357, beside the building), VPA/12, VPA/13.
- Some station service tracks and **all platforms are missing**: OSM is still needed for those.

### The old Gare map (v0.59.0 `4880783`, v0.59.1 `29ce4f3`, removed v0.61.0 `71de7c3`)
- A separate map (`setMap()` + reload) with its own origin, so it could never connect to the island.
- `planGare` used axis-aligned rectangles, not the real rotated outline (gare.js@29ce4f3:567-590).
- 43 bare `BoxGeometry`, brand logos and text (SNCF, TER Fluo, Paul, Relay), glass with `transmission`.
- Removal reason not stated. **No geometry is reused**; only its OSM data (platforms, outlines, 65 rail ways, 54 buildings) via `git show 4880783:public/data/gare.json`.

### Moving-vehicle tech already in the tram
- **Walk frame**: `p.onTram = {v, u, w, y, fy}` (`src/player.js:91`). `tramWalkStep` (`src/tramInterior.js:102-131`) projects world velocity into (u along, w right), `pushOut` (`:52`) resolves seat/wall boxes, `walkToWorld` gives the world position (`src/tram.js:104-106`). View yaw follows the track (`tramInterior.js:107`). Doors pass only when open and slow (`tram.js:108`).
- **Zombies**: `tramGoal` sends them to an open door (`tramInterior.js:250-265`, `src/zombie.js:599`); `tramShield` makes the body absorb hits unless at an open door (`:267-275`, `zombie.js:711`). Zombies never get inside.
- **Grenades**: inherit tram speed (`player.js:913`), keep a tram reference (`main.js:787`, `:1902`), bounce on its floor (`main.js:811`).
- **Network**: `p_state` carries `vh, lx, ly, lz, lyw` (`main.js:1180`); remote avatars are parented to the carrying module (`src/remote.js:182-192`); the driver sends `t_state` at 20 Hz (`tram.js:16`, `:182`, `:689`).
- **Collision**: one dynamic box per module (`tram.js:152`); `rayHit` ignores dynamic boxes, so bullets pass through car bodies.

### Game start
- `reset()` → `pickRandomSpawn` / `applySpawnPoint` (`main.js:1185-1262`) over 8 `CONFIG.spawnPoints` (`config.js:69-78`), opening the spawn zone.
- Host sends `{t:'start', sp}` (`main.js:2255-2262`), handled at `:2049`; late joiners get `sync` (`:2019`).
- `startRound` spawns (4 + 3r) × (1 + 0.75 per extra player) (`:975-995`); intermission at `:1383-1391`.
- `?debug&x&z` starts directly in game (`:2486`); the play-test harness depends on it.

### Regions (basis for a separate station area)
- `Levels` floor regions get their own offset NavGrid (`src/levels.js:146-157`, `src/nav.js:13`); `buildNavs` hard-codes 0.5 m cells.
- Zombies use their region's nav (`zombie.js:605`) and only chase players of their region unless a stair link exists (`main.js:384-413`). Relocation skips region ≠ 0 (`main.js:423-430`).
- Region spawn lists exist (`cath/crypt.js:54`, `finale.js:334`); `z_spawn` carries `region` (`main.js:1013`).

### Draw distance
Fog `FogExp2` 0.019 (night) to 0.011 (day) (`src/summit.js:24`), camera far 170 m (`main.js:57`): nothing past ~150 m is visible.

---

## 1. Player experience

### Intro (~95 s)

| Time | What happens |
|---|---|
| 0–4 s | Black card « TRAIN RÉGIONAL 17412 — DIRECTION STRASBOURG », fade-in. Players stand in coaches 2–3 with an M1911 and 500 pts. Flickering lights, night. |
| 4–30 s | 80 km/h. Announcement « Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus… », then static and screams. Players walk aisle and gangways, shoot through windows at zombies along the track. Zombies on the track are run over (thud, blood on cab windows, 0 pts). |
| 30–55 s | « RALENTISSEMENT — Obstacle sur la voie », 15 km/h past derailed wagons. « Ils s'accrochent aux fenêtres ! »: zombies run alongside, grab a window (3 s), smash it, climb in (1.2 s) — a moving CoD window barrier. |
| 55–80 s | 50 km/h. Footsteps on the roof; zombies that got on come through the rear gangway. |
| 80–95 s | Under the platform canopies, stop at quai 1. Doors open: « STRASBOURG — Terminus. Tout le monde descend. » Zombies climb out of the track bed. 5 s later: « MANCHE 1 ». |

Skip: « Maintenir [Espace] : passer l'introduction » (1.5 s hold) → train stopped, doors open. Solo: anyone; co-op: host only.

### Station loop
Three zones with the usual wall weapons, perks, box and Pack-a-Punch rules:
- **Quais** (start zone),
- **Hall de la Gare** (door 750),
- **Place de la Gare** (door 1000, tram stop « Gare Centrale »).

### Tram transfer
1. At the stop: « [E] Appeler le tram — Direction Homme de Fer », then « Départ dans 8 s — montez à bord ».
2. A CTS tram pulls in; players board standing (tram walk frame); it leaves along the forecourt; fade on the street.
3. Players appear on the Homme de Fer B/C/F platform: « HOMME DE FER ». The Homme de Fer zone opens (as a random spawn opens its zone today). This follows the real line C route (Gare Centrale → Alt Winmärik → Homme de Fer).
4. Return: a CTS terminal on that platform, « [E] Appeler le tram — Direction Gare Centrale ».

---

## 2. Balance values (proposed `src/config.js` entries)

```js
train: {
  loco: 17.5, coach: 24.5, gap: 1.0, coaches: 3,            // m; ~93 m total, fits a 400 m platform
  width: 2.9, height: 4.05, railY: -0.55, floor: 1.10,        // platform y=0 is 0.55 m below the coach floor (< STEP 0.6)
  bogie: 17.0,                                                 // m between bogie pivots (rigid coach frame)
  doorsPerSide: 2, doorWidth: 1.3, windowsPerSide: 8,
  walk: { radius: 0.3, wall: 1.25, thick: 0.12, doorOpen: 0.6, enterEase: 9 },  // same fields as tram.walk
  drive: { accel: 0.6, brake: 0.9, aLat: 0.65 },               // m/s²; curve speed <= sqrt(aLat·R): 40 km/h at R 190 m
  profile: [ {at: 0, v: 22}, {at: 640, v: 4}, {at: 760, v: 4}, {at: 820, v: 14}, {at: 1180, v: 8}, {at: 'end', v: 0} ], // m along route, m/s
  sway: { roll: 0.4, bob: 0.015, hz: 1.4 },                    // deg / m / Hz, local camera only
},
intro: {
  enabled: true, skipHold: 1.5, fadeIn: 2.5, roundDelay: 5,    // s
  trackZombies: 4, sideZombies: 6, breachers: 6, gangway: 3,   // solo; × (1 + 0.75 per extra player), as startRound
  breach: { grab: 3.0, climb: 1.2, maxHanging: 4, maxHanging4p: 8 },
  healthRound: 1,                                              // ride zombies use round-1 health (100 HP)
  roadkillPoints: 0,
},
gare: {
  bounds: { x0: -1190, x1: -840, z0: -480, z1: -165 },         // final values from data
  floorY: 0, navCell: 0.75, navMaxCost: 1300, maxLights: 8,
  zones: [
    { name: 'Quais', start: true, items: ['station', 'wall:m1911', 'wall:shotgun'] },
    { name: 'Hall de la Gare', doorPrice: 750, items: ['station', 'wall:mp5', 'perk:quickrevive', 'box'] },
    { name: 'Place de la Gare', doorPrice: 1000, items: ['station', 'wall:famas', 'perk:staminup', 'tramstop'] },
  ],
  verriere: { length: 120, depth: 25, height: 15, ribEvery: 3.0 }, // check against photos
},
transfer: {
  countdown: 8, ride: 7, fade: 0.8, cooldown: 20, price: 0, boardRadius: 7,   // s, s, s, s, pts, m
  stops: { gare: { at: [/* forecourt x, z */] }, hdf: { line: 'BCF', stop: 'Homme de Fer' } },
},
start: 'intro',   // 'intro' | 'gare' | 'classic' (lobby option)
```

Rationale:
- A solo ride gives ~10 kills × 100 pts, about a classic round 1: the economy is unchanged.
- The hanging cap (4 solo, 8 with four players) keeps breaches fair.
- The ride is a prologue outside the round counter: health and speed curves are unchanged.

---

## 3. Rails and data pipeline (pluggable sources)

### `tools/fetch-rail.mjs` (new)
Writes `public/data/rail.json` in the `area.json` frame (origin forced to 48.5822 / 7.7485):

```
{ origin, sources: [{ name, licence, date }],
  tracks: [{ id, line, voie, type, pts: [[x, z], ...], y?: [...], electrified?, bridge?: [[s0, s1]], maxspeed? }],
  platforms: [{ ref, pts }], masts?: [[x, z]], signals?: [[x, z, yaw]],
  routes: { intro: { samples, stopAt: [x, z] } } }
```

Required from any source: per-track LineStrings in WGS84 (or Lambert-93 with a built-in inverse projection, no new dependency), a track id, a line code, a track name, a type (main vs service). Optional: elevation, electrification, bridges, maxspeed.

| Adapter | Source | Use |
|---|---|---|
| `--sncf <geojson>` | SNCF Réseau track shapes (ODbL) | main source: ride and station main tracks, clipped to a corridor |
| `--osm` | Overpass | platforms, service tracks, `railway:track_ref`, `power=catenary_mast`, signals, buffer stops |
| `--bdtopo` | IGN `BDTOPO_V3:troncon_de_voie_ferree` via the WFS already used at `fetch-osm.mjs:137` | 3D geometry for bridges/embankments; check fields with DescribeFeatureType |
| `--bootstrap-git` | old `gare.json` from `4880783` | offline fallback for platforms and outlines |

### Route builder
- Proposed route: line 115000 or 110000, track V1, from the SW; clip ~1.4 km ending on VPA/7 or the quai 1 track.
- Join tracks whose endpoints are within 0.5 m, graph search between start and stop.
- Resample every 1 m, smooth (Chaikin + curvature cap), feed `Track` through `def.samples` (`src/tramTrack.js:16`).

### `tools/fetch-osm.mjs` patches
- `--origin lat,lon` separate from the bbox (today one point is both, `:14`, `:75`), plus output path.
- Keep rail tags (dropped at `:119`); test `railway` before `highway` (`:117`).
- Produce `public/data/gare.json` (station-area buildings, parts, platforms) in the same frame, dropping footprints already in `area.json` (centroid within 3 m).

### Track mesh (`src/railNet.js`, built like `tramNet.js`)
- 200 m chunks for frustum culling.
- Ballast prism ribbon with normal/roughness maps; instanced concrete sleepers every 0.6 m; rails extruded from a 60E1-like profile (polished head: metalness 0.7, roughness 0.35 — the one exception to the roughness rule).
- Catenary masts every 55 m with cantilevers (instanced; real mast positions when available), contact and messenger wires as ribbons, droppers; signals and cabinets as decor.
- No shadows; `userData.noTerrain` until phase 6.

---

## 4. Train and the moving frame

### Model (`src/trainModel.js`)
- Generic electric locomotive + 3 single-deck coaches, no logos, generic number « 17412 ».
- Exterior: desaturated aluminium grey with a muted ochre band and dirt gradient; chamfered door frames, window gaskets, handrails; bogies (frames, springs, wheels, discs); couplers; black corrugated gangway bellows; pantograph.
- Interior: 2+2 dark blue-grey high-back seats, tube-and-glass luggage racks; LED strips (emissive, some flickering or dead); screen « Prochain arrêt : Strasbourg »; vestibules with emissive door buttons; WC cubicle; blood decals.
- Cab locked: « Cabine de conduite — verrouillée ».
- One merged geometry per material per coach type, shared: ~25 draw calls.

### Moving frame
- Reuse `tramWalkStep`, `pushOut`, `p.onTram`, `p_state vh/lx/ly/lz/lyw` and remote parenting.
- Required change: the tram maps (u, w) onto the **track curve** (`tram.js:104`). A straight 24.5 m coach in a 190 m curve is up to **0.39 m** off that curve, so walls and avatars would miss the mesh. `Train` therefore uses **one rigid frame per coach** (axis between bogie points at s ± bogie/2); u stays continuous across gangways, yaw follows the coach.
- Add `walkFrame: true` to `Tram` and `Train`; replace `isTram` with it only on walk paths: `tramInterior.js:92-94`, `remote.js:182`, `main.js:811`, `main.js:1902` (26 `isTram` uses total; seat/driving ones unchanged). The train is not a vehicle in `vehicles.js` and has no seats.
- Interior collision: seats, walls, vestibule partitions, coach ends with a 1.0 m gangway opening; only the current coach and its neighbours are tested.

### Shooting, grenades, zombies
- Hitscan already passes through car bodies (works through windows).
- Grenades inherit train speed (generalise `player.js:913`); once landed, stored in coach (u, w) so they don't slide when braking.
- New zombie state `z.onTrain = { u, w, y, st: 'hang' | 'climb' | 'in' }`: hang at a window (attack animation), climb through, then steer straight in (u, w) toward the nearest standing player with `pushOut` (the aisle is a corridor, no flow field needed). `tramShield` returns false inside. On arrival they are released into the station region.

### Sound (procedural, like `sfx`)
Rolling noise and motor whine scaled by speed; rail-joint clicks from speed and bogie spacing; brake squeal; air release; generic two-tone chime (not the trademarked SNCF jingle); door beeps; wind at broken windows.

---

## 5. Station area

### Placement and integration
- At real coordinates inside `CONFIG.gare.bounds`; edges closed by hotel facades (existing `architecture.js`, no interiors), crowd barriers, a burnt-out bus and fog. The tram is the only link.
- One `Levels` floor region **`GARE`** at y = 0, triangles from walkable polygons (platforms, hall, verrière, forecourt). Its nav comes from `buildNavs` with a per-region `cell` (0.75) and `maxCost` (~470 × 420 cells). No stair link → island and station zombies stay separate (`main.js:384-391`).
- `Collision` gets one bounds rectangle (union of island, station, ride corridor) instead of ±half.
- `terrainY` returns 0 outside the island grid, with a 20 m fade.
- Station zones tagged `pocket: 'gare'`, appended at the end of `sector.zones` with `isolatedRnd` (island zones and seeded draws unchanged). `zoneOf` reads the plan's polygons. Doors, item slots and spawns are fixed positions, like the cathedral PaP (`realworld.js` ~`:1531`); station doors go at the end of the door list.
- `pickSpawn` (`main.js:1080-1097`) picks a target player, then a spawn in that player's area. Station zombies spawn along the platform edges with the ground-emergence animation (reads as climbing from the track bed).
- Platform edges block players (tactile strip + collision).

### Model scope (`src/gare/plan.js` pure geometry from the real outline; `src/gare/build.js` meshes)
1. **Historic building (1883)**: sandstone in desaturated grey-beige (roughness 0.8); central pavilion with three tall round arches and a clock; arched windows on the wings; end pavilions; slate roof with dormers; cornices, pilasters, plinth, quoins as relief strips.
2. **Verrière (2007)**: shell swept along its real curved footprint (quarter-ellipse profile); steel ribs every 3 m (instanced); glass `MeshPhysicalMaterial`, opacity ~0.22, roughness 0.05, envMap, **no transmission**; cold LED uplights.
3. **Hall des pas perdus**: ticket windows, departures board (emissive amber, « DÉPARTS »), benches, unbranded kiosks, underpass stairs blocked by rubble.
4. **Platforms 1 and 2/3**: cast-iron canopies (columns, riveted trusses, skylight strips), warm lamps, benches, boards, a dead train on track 2 as cover.
5. **Place de la Gare**: paving with puddles, trees, lamps, the CTS stop « Gare Centrale » (shelter, ticket machine, emissive screen), taxi rank, bike racks.

### Performance budget (station on screen)

| Item | Limit |
|---|---|
| Draw calls | ≤ 300 |
| Triangles | ≤ 1 M |
| Point lights | ≤ 8, pooled, `decay: 2` |
| Shadow-casting lights | 1 (moon) |
| Train + track | ~+40 draw calls |

- Island top-level groups hidden while all local views are at the station or on the ride (`world.setAreaVisible`).
- No per-frame allocation (preallocated `_wf` / `_wp` style outputs).
- Station and train materials added to `precompileShaders` (`main.js:2420`).

---

## 6. Multiplayer

`server/rooms.mjs:90-110` relays any `t`: no server change.

Host simulates: intro clock τ; train position s(τ), a deterministic function of τ and the config profile; scripted events, ride and station zombies, breaches, transfer departures, round start.

| Message | Direction | Fields | When |
|---|---|---|---|
| `start` | host → all | existing `sp` + `intro: { tau: 0 }` or `area: 'gare'` | once |
| `tn_sync` | host → all | `tau`, `ph` ('ride', 'stopped', 'done') | 2 Hz |
| `intro_skip` | client → host, host → all | `tau` | on request |
| `z_spawn` | host → all | + `tn: [coach, side, win]` | per spawn |
| zombie state | host → all | + optional `tu, tw, ty` (frame-local) | existing rate |
| `xf_req` | client → host | `stop` | on interact |
| `xf_call` | host → all | `stop`, `at` | countdown start |
| `xf_go` | host → all | `stop`, `dest`, `pids` | departure |
| `sync` | host → joiner | + `intro: { tau, ph }`, host area | late join |

- Clients advance τ locally and nudge toward host τ + ping/2; no train state traffic.
- Players use `p_state` with `vh = TRAIN_ID`; `rideById` must resolve the train.
- `xf_go` takes every alive, non-downed player within `boardRadius` when the doors close; each plays the animation locally, then teleports to a `findSafeSpot` point (`debugMenu.js:33`).
- When the last player leaves the station, the host despawns its zombies back into `toSpawn`.
- Late joiners: during the ride, standing in coach 3; otherwise next to the host.

Local only: camera sway, sounds, glass, sparks, blood, fades and titles, announcement timing (from τ), corridor chunk culling, transfer animation.

---

## 7. Phased plan (each phase ships to `main` on its own; intro and station first)

### Phase 0 — data and tools (minor)
- `tools/fetch-rail.mjs` (`--sncf`, `--osm`, `--bdtopo`, `--bootstrap-git`); patch `tools/fetch-osm.mjs`; commit `public/data/rail.json` and `public/data/gare.json`, licences in `sources` (ODbL SNCF and OSM, Etalab IGN).
- Verify: feature counts; route ≥ 1.2 km ending at quai 1; scratchpad PNG of tracks / station / island bounds, looked at; `npx vite build`.

### Phase 1 — playable station and tram transfer with a fade (minor)
- New: `src/gare/plan.js`, `src/gare/build.js`, `src/gare/index.js`, `src/transfer.js`.
- Touch: `src/realworld.js` (load data, region, zones, doors, items, `areaOf`, `setAreaVisible`), `src/collision.js` (bounds), `src/terrain.js` (outside grid), `src/levels.js` (per-region cell), `src/main.js` (`pickSpawn` per area, `start.area`, `?debug&gare`), `src/hud.js` (minimap per area, « GARE CENTRALE — STRASBOURG »), `src/config.js`, `tools/stuck-scan.mjs`, `tools/make-docs.mjs`.
- Classic start stays default; lobby option « Départ : Gare Centrale ». Homme de Fer terminal live.
- Verify: build; harness `?debug&gare` screenshots (verrière, hall, platforms, forecourt; night and day) looked at; `renderer.info` within budget; scripted transfer round trip (position, zone opened); stuck-scan; `tools/mp-smoke.mjs` (one tab transfers, others stay, zombies separated).

### Phase 2 — track and a parked walkable train (minor)
- New: `src/railNet.js`, `src/trainModel.js`, `src/train.js`; `walkFrame` in `src/tramInterior.js`, `src/player.js`, `src/remote.js`, `src/main.js`. Train parked at quai 1, doors open.
- Verify: walk every coach and gangway by eval (never stuck, avatars on the mesh in curves); grenade inside; screenshots; frame time.

### Phase 3 — moving intro, no zombies (minor)
- New: `src/intro.js` (timeline, profile, announcements, skip, fades, late join); `src/audio.js` sounds; start flow in `src/main.js`, `index.html`, `src/ui.js` (`start: 'intro'` default, `?debug&intro`; plain `?debug` unchanged).
- Verify: harness stepping `game.update(1/60)` to the stop with doors open; screenshots at τ = 10, 50, 90 looked at; 2-tab mp-smoke with train `s` within 0.5 m; skip and restart.

### Phase 4 — zombie threat during the ride (minor)
- `src/zombie.js` (`onTrain`), events in `src/intro.js`, spawn/cleanup in `src/main.js`, network fields.
- Verify: kills and points per player count; hanging cap; no zombie left in the corridor; consistent MP positions; frame time with 8 zombies on board.

### Phase 5 — rendered transfer animation (patch or minor)
- `src/transfer.js`: decor CTS tram from the shared `carGeometries()` on a short `Track` across the forecourt, players standing in it; arrival effect at Homme de Fer.
- Verify: screenshots of the sequence; MP group departure.

### Phase 6 — real terrain from IGN RGE ALTI (minor, after the intro ships)
- Replace the ±0.3 m fake undulation in `installTerrain` (`terrain.js:38-72`) with a baked grid relative to a 140 m datum (measured: station 140.3 m, cathedral 144.0 m, south 137.9 m).
- New `tools/fetch-elevation.mjs`: batches to `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` (`resource=ign_rge_alti_wld`, `zonly=true`) on a 5 m grid over the full bounds (~115k points), Int16 centimetres to `public/data/height.bin`.
- Keep the water level and the bank / parvis shaping; track grade from the grid, smoothed to ≤ 1.5 %.
- Risk: everything reads `terrainY` (floors, interiors, absolute cathedral levels, tram rails). Feature flag; full harness, mp-smoke, stuck-scan.

### Phase 7 (optional) — better buildings
- Sources: Strasbourg open data « Maquette 3D 2022 » (`odata3d_maquette_2022`), « Raster de hauteur des bâtiments 2025 » (`raster_hauteur_bati_2025`), LiDAR 2026 (`lidar_portail`), IGN BD TOPO buildings.
- Use for heights and roof shapes on the island and low-detail corridor buildings (no interiors). Formats to confirm (likely CityGML / 3D Tiles / GeoTIFF); a converter writes per-footprint `h` and roof data into `area.json` without re-centring it.

---

## 8. Risks
- **Never re-centre `area.json`**: all config coordinates depend on it. New data goes in separate files in the same frame.
- **Broad changes** (bounds, `terrainY`, `walkFrame`) touch many systems: keep `?debug` and the classic start; run harness and mp-smoke.
- **Bullets pass through the lower coach walls**: acceptable first; later a ray test against the coach (solid below the sill).
- **Motion comfort**: option « Mouvements de caméra du train : réduits ».
- **Overpass is flaky**: SNCF data + git bootstrap cover phases 0–4.

---

## 9. Open questions (recommended answer)
1. Approach direction? **SW, line 115000 or 110000, track V1** (in the SNCF data, passes no modelled buildings).
2. Ride length? **1.3–1.5 km, ~95 s, skippable.**
3. Train type? **Generic loco + 3 single-deck coaches, no brands.**
4. Keep the classic start? **Yes, as a lobby option; `?debug` unchanged.**
5. Who rides a transfer? **Everyone on the platform at departure; free; 20 s cooldown; downed players can't board.**
6. Arrival stop? **Homme de Fer, B/C/F platform** (real line C route; opens that zone).
7. Station zones? **Quais / Hall / Place** with the items in §2.
8. Tracks or roof walkable? **No** (zombie-only).
9. Restart replays the intro? **Yes, skippable; remember « intro vue » in localStorage.**
10. Train destructible? **No, scripted.**
11. Real terrain? **Yes, phase 6, after the intro and station ship.**
