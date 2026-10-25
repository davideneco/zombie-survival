# Zombie Survival — Godot port

Port of the Strasbourg survival game (browser version: [`../README.md`](../README.md)) to **Godot 4.7.2**, in GDScript, Forward+ rendering (Vulkan). `godot-port` branch. The game's text is in French.

**Status**: complete solo game (Strasbourg map, a second map — the Station des Aiguilles alpine resort —, zombies, 23 weapons, vehicles including a drivable tram, perks, bosses, finale, HUD, menus, audio) and a Windows export. **Multiplayer is not ported.** The developer has never run it on a real Windows machine: see [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French) for what is and isn't verified.

## Running it

Requirement: [Godot 4.7.2](https://godotengine.org/download) (standard build, not .NET). Part of the baked world is not versioned (see "Regenerating assets").

```bash
godot --path godot                 # main menu; the world only loads after "Jouer"
godot --path godot -- --map=alpine # second map: the Station des Aiguilles (alpine resort in winter)
godot --path godot -- --map=arena  # small test arena
godot --path godot -- --map=vehicules  # vehicle test track (every vehicle, no zombies, no weapons)
```

Or open the `godot/` folder in the editor and press F5. Settings, key bindings, statistics and the trophy are stored in `user://`.

### Windows
`tools/export-windows.sh` builds a ready-to-run zip: `Zombie.exe`, `Zombie.console.exe`, `Zombie.pck`, `LISEZMOI.txt`, `LICENCES/`. The zip is not in the repository (`godot/build/` is git-ignored). You need the Godot 4.7.2 Windows export templates (procedure in `docs/GODOT_PORT.md`, section J21). The exe is unsigned, so SmartScreen may warn.

## Notes

- **Menu**: Play, game mode, best score / statistics, map choice (Strasbourg, Station des Aiguilles or arena) and difficulty (Easy / Normal / Hard), Multiplayer (greyed out).
- **Game modes** (menu "Mode de jeu", v0.26.0): **Classique** (the whole Grande Île, paid doors, finale; unchanged) and **Zone unique**: pick one of the 27 zones on a map thumbnail; you are locked in it (every door is bricked up for good), zombies spawn from the zone's windows and ground out of your sight, the zone's machines stay (plus a mystery box, Juggernog-like and Quick Revive-like perks and an MP5 when the zone has none), and an **exit door** in the middle of the zone costs 20,000 points: buying it ends the game in victory ("Évasion réussie"). Zone scores are kept per zone, apart from the classic statistics. **Contre la montre** (v0.33.0): the whole map without the finale, a 4-minute clock that runs down, each kill gives back 2 s (3 s for a headshot), each cleared round 15 s, capped at 10 minutes; "Temps écoulé" at 0:00, the score is the points earned. **Arsenal aléatoire** (v0.33.0): the whole map without the finale, a single weapon drawn at random at the start and at every round (never the same twice in a row, stronger weapons unlocked by round), no weapon buying (wall weapons and mystery box closed), the Pack-a-Punch level carries over to the next weapon. Both modes keep their own best scores.
- **Perks** (v0.27.0): 16 perks, at most **4 carried** (the Dawn Blessing lifts the limit). Besides the 7 of the browser game, nine new ones inspired by Call of Duty Zombies under original names, each with its own machine on the map: Œil-de-lynx (headshots), Cerise-foudre (shock on reload), Veuve noire (web that slows zombies), Vautour (ammo / point drops), Pierre tombale (get your perks back after going down), Ultime Volonté (survive a lethal hit), Bastion (less damage while holding a spot), Sixième sens (wider radar, critical hits), Cartouchière (more reserve ammo). List in the menu: "ATOUTS"; details in `docs/GODOT_PORT.md` (v0.27.0).
- **Wall weapons and ammo stations** (v0.28.0): framed plank panels with the real weapon model hung on hooks and its glowing outline, sharp name / state / price plates (BUY, AMMO, PACK-A-PUNCH; price in red when you cannot pay), LED strip and sconce lit at night; ammo stations are olive steel lockers with a lit price screen. The interaction prompt shows an icon and the price apart (red with the missing points). Details: `docs/GODOT_PORT.md` (v0.28.0).
- **Mystery box** (v0.29.0): an iron-bound chest with brass fittings, padlock and glowing question marks; the lid opens, light and sparks rise, the real 3D models of the 23 weapons cycle more and more slowly, the teddy bear sends it away in smoke and it drops from the sky at its new place. The animation is a pure function of the simulation (`sim/box_anim.gd`, suite `j36`).
- **Drivable tram** (v0.30.0): the body is now built by code after the Alstom Citadis 405 of the CTS (Strasbourg): raked panoramic windscreen, rounded snout, double LED headlights, lit destination display, wipers, mirrors, white livery with red and blue stripes and a plain "CTS" text logo, large glazed bays, roof air-conditioning and a single-arm pantograph (`scenes/tram_body.gd`); the interior, doors and seats are still the JS bake. Same dimensions (23.5 m).
- **Quality and upscaling** (Options): Fast / Normal / High presets; 3D upscaling **Native, FSR 1.0 or FSR 2.2 (trial)**, 3D resolution (100, 85, 75, 67, 50 %) and sharpness. The HUD stays sharp. No DLSS: the engine does not offer it.
- **First launch on Windows**: with an integrated GPU, the "Fast" quality is chosen automatically.
- **Characters** (v0.31.0): the 8 playable survivors are original high-quality models generated entirely by script (`tools/build-characters.py` + `tools/charlib/`: signed distance fields meshed with OpenVDB, decimated, procedural PBR textures baked per texel, hair cards, 57-bone skeleton with fingers, eyes, eyelids and jaw; 21-32 k triangles, 2048 px textures, LODs generated on import; see `assets/characters/LICENSE.txt`): rotating studio-lit preview in the character menu (the survivor looks at the camera and blinks; drag to rotate), third-person view on foot with hands and fingers on the weapon, seated on bikes and tram seats with fists on the handlebars, first-person gloves and sleeves using the outfit's generated fabric. Sheet: `docs/personnages.png`.
- **Realistic cathedral, buildings and city** (v0.32.x): the cathedral exterior is rebuilt by code around the playable spaces (nave with flying buttresses, pinnacles and gargoyles, clerestory and aisle windows with tracery, slate / patinated copper roofs, transept gables, octagonal crossing tower, choir, north tower octagon with openwork stair turrets, openwork spire with stacked turret columns up to 142 m); the baked OSM outline inside the cathedral footprint is re-skinned with PBR stone or removed where replaced (`scenes/world/cathedral_*.gd`). Gameplay geometry (collision, floors, stairs, ramp) is unchanged and checked by suite `j30`. Daytime haze is lighter. Buildings get 3D window frames, recessed glass (parallax), louvred shutters, wrought-iron balconies, flower boxes, cornices, gutters, downpipes and chimneys, placed on the painted facades by `tools/build-city-details.py` (writes the git-ignored `data/city_details.bin`; run it after `bake-world`). The city gets lawns and grass tufts around tree clusters, tree grates, modelled parked cars, varied translucent foliage, reflections that follow the time of day, and (High quality) a planar reflection of the city in the river and canals. Before / after captures: `docs/audit-ville/avant-apres-v032-*.png`. Details, per-quality settings and costs: `docs/GODOT_PORT.md` (v0.32.x).
- **Parked cars** (v0.33.2): four modelled silhouettes instead of one (city car, estate, small van, compact SUV), picked from each car's position; the JS collision box is unchanged.
- **Street furniture** (v0.33.1): 480 added objects with collision (benches, bins, old-style street lamps lit at night, bollards, crowd barriers, octagonal newspaper kiosks, advertising columns), placed once by `tests/test_place_furniture.gd` into the versioned `data/street_furniture.json`: against straight facades (flush, or 1.1 m away for lamps and bollards) or, for round objects only, in the middle of squares, away from doors, spawn windows, machines, wall weapons, tram tracks, stairs and the Zone unique exits, and never cutting a path (navigation components checked by suite `j30`; `tools/walkthrough-scan.py --furniture` finds no walk-through face). `--no-furniture` turns it off.
- **Station des Aiguilles** (v0.34.x): a second, much smaller map, entirely different from Strasbourg: an abandoned ski resort in winter, 300 x 300 m playable, 6 zones (village square, Grand Cerf hotel, Saint-Bernard church, chairlift station, Col car park, frozen lake), 7 paid doors (750 to 1,750), 4 walk-through interiors (hotel lobby, church, chairlift station with the Pack-a-Punch, lake refuge), 11 perk machines, 6 mystery box spots, 12 wall weapons, 2 drivable snowmobiles, and its own finale "La Nuit blanche" (ring the church bell from round 10 with every zone open: 3 waves, then the Bourreau des neiges, a ground-only Bourreau). Scripted, no OSM and no Chrome bake: `tools/build-alpine.py` writes the versioned plan `data/alpine.json`; `sim/alpine_map.gd` builds collision, navigation, zones, doors and spawn windows at load; `scenes/world/alpine_view.gd` builds the view (snow on every upward face, frozen lake ice, snowy fir forest, mountains, falling snow stopped by roofs, a blizzard every 5 minutes and during the finale with fog and a synthesized wind loop). The playable ground is flat (the resort plateau); the relief is around it. Classique, Contre la montre and Arsenal aléatoire are playable there (Zone unique stays on Strasbourg). Suite `j39`; captures in `../docs/station-alpine/`.
- **Drivable car** (v0.36.0, Strasbourg only, port-specific: the browser game has none): a generic French five-door city car modelled by code (`scenes/car_view.gd`, about 10,800 triangles; no real make or logo): smoothed body sections, rounded nose and tail, see-through tinted glazing, wheel arches, five-spoke alloys with discs and red calipers, grille, almond headlights with daytime running lights, wrap-around tail lights, brake / reverse / indicator lamps, mirrors, handles, wipers, shark-fin aerial, fictitious number plates; a cabin with dashboard, lit instrument cluster and screen, a three-spoke steering wheel that turns with the steering, bucket seats and a rear bench. Clear-coated metallic paint with road grime (`shaders/drive_car.gdshader`), duller as it gets damaged; smoke then fire under the bonnet; a charred wreck. Three cars: place Kléber, quai Schoepflin, Ancienne Douane quay (violet car icon on the `M` map). Physics in `sim/car_sim.gd` (`CarSim`, extends `VehicleSim` without changing the bikes): acceleration that fades near 94 km/h, brakes, reverse, speed-dependent steering, a slight slide in tight fast corners, handbrake slides, oriented-box collision against walls, props and other cars (never through a thin wall), crash damage from 3 m/s, occupants hurt above 9 m/s (never killed), zombies run over above 6 m/s (points as with the bikes), 35 L tank (fuel cans give 8 L, the car park pump serves it), 900 HP, fire, explosion, wreck, back two rounds later. Zombies come to hit the bodywork: the car loses 12 HP per blow and the player takes only 30 % of the zombie's damage. Keys: `E` in / out (driver's door on the left), `Z Q S D`, `Space` handbrake, `F` headlights (switched on at night when you get in; the flashlight is off in a car), `H` horn (draws zombies like the tram gong), `V` first / third person. Engine: the big bike's loop pitched down; horn synthesised at start-up.
- **Vehicle test track** (v0.37.0, map `vehicules`, menu card "BANC D'ESSAI DES VÉHICULES", `--map=vehicules`): a small 260 x 260 m map built in code (`sim/vehicle_lab_map.gd` writes a plan in the Station des Aiguilles format and `AlpineMap.build` turns it into a World; the course and the measures live in `sim/vehicle_lab.gd`, the view in `scenes/world/vehicle_lab_view.gd`). A hangar in the middle holds every vehicle of the game (bike, big bike, bicycle, snowmobile, two cars) and a tram runs on a 220 m test track; around it: a 12 m wide ring road (start / finish line and three checkpoints), a 224 m straight for 0-50 / 0-100 km/h and braking distance ending at a crash wall, two jump ramps (1.8 m and 0.7 m), speed bumps and bumps, a 20 % hill, a mud strip on the ring and an ice rink (reduced grip), an 8-cone slalom and a 10-cone target that get knocked over. No zombies, no weapons, no rounds, no purchases, no game over, no stats; the player cannot die. Relief and grip are a small optional hook (`World.terrain`, null on the other maps): vehicles follow the ground, take off at a ramp lip, fly and land, slow down uphill; the grip scales acceleration, braking and cornering. In-game telemetry panel (speed, longitudinal / lateral g, slip angle, airborne time, HP, fuel, surface, current and best lap, 0-50 / 0-100, braking distance, last crash speed and HP lost, last jump length). Keys on this map only: `R` repair + refuel (a wreck comes back new), `X` reset (stopped, upright, cones up, measures cleared), `P` back to the hangar, `C` take the next vehicle out in front of you / put it back, `N` day / night. `--vehicle-log[=file]` (default `user://vehicle_log.jsonl`) writes one JSON line per measure (lap, accel, brake, crash, jump, cone, service) and a sample every 0.25 s while driving. Suite `j44`; screenshots in `../docs/banc-essai/`.
- **Screen sizes** (v0.34.7): menus and HUD are designed for 1280 x 720 and scaled to the window (x 1.5 in 1080p, x 2 in 1440p and 3440 x 1440); wider or taller screens get a larger UI area with the HUD anchored to the edges. The 3D is always rendered at the window size. `tools/ui-shots.sh` captures the menus and HUD at several sizes (gamescope headless).
- **Loading**: a warm-up step (pipelines, sounds, navigation grids) avoids in-game stutters. Since v0.34.6 the heavy parts of the city load (texture decoding, tile meshes, facade details, vegetation, floor navigation grids) run on worker threads and the game resources are read ahead by the loader threads (Strasbourg from the menu: 9.6 s -> about 7 s on the test laptop); `--startup-log` details every step.
- **Music**: `theme.*` is never shipped (copyright). Drop an mp3, ogg or wav file in `user://music/` to use it.

## Diagnosing stutters

```bash
Zombie.console.exe -- --perf-log=perf.txt
```

Play 5 to 10 minutes, close the window normally, then send `perf.txt` (the `SPIKE` lines are enough). Automatic bench: `--perf-soak=5` (a bot plays for 5 minutes).

## Diagnosing stuck zombies and spawns

```bash
Zombie.console.exe -- --zombie-stuck-log=zombies.jsonl      # or diagnostic-zombies.bat in the Windows package
```

The game starts normally (menu); every zombie that stays still, pushes against a wall, ends up inside an obstacle, loses its way or jumps (teleport), every appearance (window or ground, straight-line and walking distance to the player, seen or hidden) and every recovery is written as one JSON object per line, with a summary every 30 s (`sim/zombie_watch.gd`). Default file: `user://zombie-stuck-log.jsonl`. In game, F9 then P shows the same counters; U forces the recovery of stuck zombies. Suite `j42` measures both maps with a scripted tour.

Since v0.34.11, zombies and spawns follow port rules (not in the JS): the alpine map's flow field covers the whole station; the added street furniture is in the Strasbourg navigation grid; a zombie blocked against a corner follows the field cell by cell, one inside an obstacle walks out to the nearest free cell, a crowd never pushes a zombie through a wall; a stuck, lost or far zombie is never teleported: it sinks into the ground if the player sees it, then comes back by a window or from the ground, hidden from the player. Round spawns are always animated, in an open zone, hidden from the player and within 70 m of walking (95 m fallback); nothing appears in the 2 s after a door is bought. `--no-furniture-nav` keeps the furniture out of the grid (comparisons).

## Useful launch options

After `--`: `--map=alpine|arena|vehicules` (Strasbourg otherwise), `--mode=classic|zone|timed|arsenal`, `--zone=N|Name` (Zone unique in that zone), `--difficulty=easy|normal|hard`, `--seed=N`, `--bot` (the bot plays), `--no-music`, `--no-warmup`, `--no-boss-intro`, `--perf-log=F`, `--perf-soak=N`, `--quit-at=S`, `--shot=f.png --at=S` (screenshot), `--god` (health kept full, for performance runs). `--show-collision[=report.json]` draws the collision through the walls, `--eye-y=Y` raises the camera (see `docs/GODOT_PORT.md`, geometry diagnostics). `--mount=voiture --car=N` (sit in car N: 0 Kléber, 1 quai Schoepflin, 2 Ancienne Douane), `--car-passengers=N` (survivors in the passenger seats, for screenshots), `--car-lights=0|1`, `--first-person`, `--mount=motoneige`, `--veh-at=x,z,heading_deg[,km/h]` (place and launch the mounted vehicle), `--vehicle-log[=file]` (test track measures). The others (`--do=`, `--horde=`, `--seat=`, `--tram-at=`, `--zoo*`…) are for test captures; they are parsed in `scenes/main.gd`.

## Tests

```bash
tools/godot-check.sh          # everything: export config and golden files from the JS, import, run all suites
tools/godot-check.sh j9       # one suite
```

More than 163,000 checks (163,114), 0 failures at v0.37.0. The **golden files** are outputs of the JS game (Node or Chrome) that the GDScript must reproduce: config, collision, navigation, weapons, vehicles, prices, tram, bosses. Tests run headless, without rendering; screenshots need a display (or `xvfb-run`).

## Layout

| Folder | Contents |
|---|---|
| `sim/` | Pure simulation, no nodes: collision, navigation (flow field), zombies, rounds, weapons, vehicles, tram, bosses, difficulty, settings |
| `scenes/` | Views and UI: world, zombies, weapons, tram, HUD, menus, `main.gd` (input and test options) |
| `autoload/` | `Config` (balance from the JS), `Game` (state), `Sfx` (audio) |
| `shaders/` | Sky, ground, facades, water, foliage, zombies |
| `data/` | Config and data exported from the JS; `golden/` (tests, never exported) |
| `assets/` | Weapons (OBJ), zombies (glb), tram, textures, sounds; part of it is regenerated, see below |
| `tests/` | Suites `test_j0` to `test_j43`, `runner.tscn`, and the tools `place_perks`, `place_furniture` (write `data/perk_machines.json`, `data/street_furniture.json`), `place_cars` (prints the car spots of `CarSim.SPOTS`) and `carsheet` (picture sheet of the car, needs a display: `godot --path godot res://tests/runner.tscn -- --suite=carsheet --out=sheet.png [--night]`) |

Model licences: `assets/weapons/LICENSE.txt` (Quaternius, Tabasco) and `assets/zombies/LICENSE.txt` (Quaternius).

## Regenerating assets

The map, textures and audio come from the JS game and are "baked" with Chrome. They are git-ignored (except game data and the tram). Run `npm run dev` at the repository root, then:

```bash
node tools/bake-world.mjs       # geometry, collision, navigation, doors
node tools/bake-vehicles.mjs    # machines, stations, tram
node tools/bake-graphics.mjs    # atlases, ground
node tools/bake-portraits.mjs   # map and portraits
node tools/bake-audio.mjs       # sounds and music loops
node tools/bake-tram.mjs        # tram (already versioned)
node tools/download-textures.mjs
python3 tools/build-city-details.py   # v0.32.2: 3D facade and roof details (data/city_details.bin)
```

Station des Aiguilles: `python3 tools/build-alpine.py` rewrites the versioned plan `data/alpine.json` (nothing to bake). Its geometry can be exported for the diagnostic scans: `godot --path godot -- --map=alpine --no-warmup --export-geom=/tmp/alpine`, then `ZS_WORLD_DIR=/tmp/alpine python3 tools/collision-scan.py` (and `walkthrough-scan.py`).

Weapons and zombies: `tools/build-weapons.py` and `tools/build-zombies.py` (Blender). Characters: `blender -b --disable-autoexec --python tools/build-characters.py -- godot/assets/characters [id ...]` (about 20 min for the 8; `--fast` for quick 1024 px previews), then `godot --path godot --script ../tools/character-sheet.gd -- assets/characters PORTRAITS` for the menu portraits. Logs, decisions and measurements are in [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French).
