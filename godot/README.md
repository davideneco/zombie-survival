# Zombie Survival — Godot port

Port of the Strasbourg survival game (browser version: [`../README.md`](../README.md)) to **Godot 4.7.2**, in GDScript, Forward+ rendering (Vulkan). `godot-port` branch. The game's text is in French.

**Status**: complete solo game (Strasbourg map, a second map — the Station des Aiguilles alpine resort —, zombies, 23 weapons, vehicles including a drivable tram, perks, bosses, finale, HUD, menus, audio) and a Windows export. **Multiplayer is not ported.** The developer has never run it on a real Windows machine: see [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French) for what is and isn't verified.

## Running it

Requirement: [Godot 4.7.2](https://godotengine.org/download) (standard build, not .NET). Part of the baked world is not versioned (see "Regenerating assets").

```bash
godot --path godot                 # main menu; the world only loads after "Jouer"
godot --path godot -- --map=alpine # second map: the Station des Aiguilles (alpine resort in winter)
godot --path godot -- --map=arena  # small test arena
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
- **Screen sizes** (v0.34.7): menus and HUD are designed for 1280 x 720 and scaled to the window (x 1.5 in 1080p, x 2 in 1440p and 3440 x 1440); wider or taller screens get a larger UI area with the HUD anchored to the edges. The 3D is always rendered at the window size. `tools/ui-shots.sh` captures the menus and HUD at several sizes (gamescope headless).
- **Loading**: a warm-up step (pipelines, sounds, navigation grids) avoids in-game stutters. Since v0.34.6 the heavy parts of the city load (texture decoding, tile meshes, facade details, vegetation, floor navigation grids) run on worker threads and the game resources are read ahead by the loader threads (Strasbourg from the menu: 9.6 s -> about 7 s on the test laptop); `--startup-log` details every step.
- **Music**: `theme.*` is never shipped (copyright). Drop an mp3, ogg or wav file in `user://music/` to use it.

## Diagnosing stutters

```bash
Zombie.console.exe -- --perf-log=perf.txt
```

Play 5 to 10 minutes, close the window normally, then send `perf.txt` (the `SPIKE` lines are enough). Automatic bench: `--perf-soak=5` (a bot plays for 5 minutes).

## Useful launch options

After `--`: `--map=alpine|arena` (Strasbourg otherwise), `--mode=classic|zone|timed|arsenal`, `--zone=N|Name` (Zone unique in that zone), `--difficulty=easy|normal|hard`, `--seed=N`, `--bot` (the bot plays), `--no-music`, `--no-warmup`, `--no-boss-intro`, `--perf-log=F`, `--perf-soak=N`, `--quit-at=S`, `--shot=f.png --at=S` (screenshot), `--god` (health kept full, for performance runs). `--show-collision[=report.json]` draws the collision through the walls, `--eye-y=Y` raises the camera (see `docs/GODOT_PORT.md`, geometry diagnostics). The others (`--do=`, `--horde=`, `--seat=`, `--tram-at=`, `--zoo*`…) are for test captures; they are parsed in `scenes/main.gd`.

## Tests

```bash
tools/godot-check.sh          # everything: export config and golden files from the JS, import, run all suites
tools/godot-check.sh j9       # one suite
```

More than 162,000 checks (162,768), 0 failures at v0.34.8. The **golden files** are outputs of the JS game (Node or Chrome) that the GDScript must reproduce: config, collision, navigation, weapons, vehicles, prices, tram, bosses. Tests run headless, without rendering; screenshots need a display (or `xvfb-run`).

## Layout

| Folder | Contents |
|---|---|
| `sim/` | Pure simulation, no nodes: collision, navigation (flow field), zombies, rounds, weapons, vehicles, tram, bosses, difficulty, settings |
| `scenes/` | Views and UI: world, zombies, weapons, tram, HUD, menus, `main.gd` (input and test options) |
| `autoload/` | `Config` (balance from the JS), `Game` (state), `Sfx` (audio) |
| `shaders/` | Sky, ground, facades, water, foliage, zombies |
| `data/` | Config and data exported from the JS; `golden/` (tests, never exported) |
| `assets/` | Weapons (OBJ), zombies (glb), tram, textures, sounds; part of it is regenerated, see below |
| `tests/` | Suites `test_j0` to `test_j39`, `runner.tscn`, and the `place_perks` and `place_furniture` tools (write `data/perk_machines.json`, `data/street_furniture.json`) |

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
