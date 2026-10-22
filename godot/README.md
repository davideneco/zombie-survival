# Zombie Survival — Godot port

Port of the Strasbourg survival game (browser version: [`../README.md`](../README.md)) to **Godot 4.7.2**, in GDScript, Forward+ rendering (Vulkan). `godot-port` branch. The game's text is in French.

**Status**: complete solo game (Strasbourg map, zombies, 23 weapons, vehicles including a drivable tram, perks, bosses, finale, HUD, menus, audio) and a Windows export. **Multiplayer is not ported.** The developer has never run it on a real Windows machine: see [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French) for what is and isn't verified.

## Running it

Requirement: [Godot 4.7.2](https://godotengine.org/download) (standard build, not .NET). Part of the baked world is not versioned (see "Regenerating assets").

```bash
godot --path godot                 # main menu; the world only loads after "Jouer"
godot --path godot -- --map=arena  # small test arena
```

Or open the `godot/` folder in the editor and press F5. Settings, key bindings, statistics and the trophy are stored in `user://`.

### Windows
`tools/export-windows.sh` builds a ready-to-run zip: `Zombie.exe`, `Zombie.console.exe`, `Zombie.pck`, `LISEZMOI.txt`, `LICENCES/`. The zip is not in the repository (`godot/build/` is git-ignored). You need the Godot 4.7.2 Windows export templates (procedure in `docs/GODOT_PORT.md`, section J21). The exe is unsigned, so SmartScreen may warn.

## Notes

- **Menu**: Play, game mode, best score / statistics, map choice (Strasbourg or arena) and difficulty (Easy / Normal / Hard), Multiplayer (greyed out).
- **Game modes** (menu "Mode de jeu", v0.26.0): **Classique** (the whole Grande Île, paid doors, finale; unchanged) and **Zone unique**: pick one of the 27 zones on a map thumbnail; you are locked in it (every door is bricked up for good), zombies spawn from the zone's windows and ground out of your sight, the zone's machines stay (plus a mystery box, Juggernog-like and Quick Revive-like perks and an MP5 when the zone has none), and an **exit door** in the middle of the zone costs 20,000 points: buying it ends the game in victory ("Évasion réussie"). Zone scores are kept per zone, apart from the classic statistics. Two more modes are listed as "coming soon".
- **Perks** (v0.27.0): 16 perks, at most **4 carried** (the Dawn Blessing lifts the limit). Besides the 7 of the browser game, nine new ones inspired by Call of Duty Zombies under original names, each with its own machine on the map: Œil-de-lynx (headshots), Cerise-foudre (shock on reload), Veuve noire (web that slows zombies), Vautour (ammo / point drops), Pierre tombale (get your perks back after going down), Ultime Volonté (survive a lethal hit), Bastion (less damage while holding a spot), Sixième sens (wider radar, critical hits), Cartouchière (more reserve ammo). List in the menu: "ATOUTS"; details in `docs/GODOT_PORT.md` (v0.27.0).
- **Wall weapons and ammo stations** (v0.28.0): framed plank panels with the real weapon model hung on hooks and its glowing outline, sharp name / state / price plates (BUY, AMMO, PACK-A-PUNCH; price in red when you cannot pay), LED strip and sconce lit at night; ammo stations are olive steel lockers with a lit price screen. The interaction prompt shows an icon and the price apart (red with the missing points). Details: `docs/GODOT_PORT.md` (v0.28.0).
- **Mystery box** (v0.29.0): an iron-bound chest with brass fittings, padlock and glowing question marks; the lid opens, light and sparks rise, the real 3D models of the 23 weapons cycle more and more slowly, the teddy bear sends it away in smoke and it drops from the sky at its new place. The animation is a pure function of the simulation (`sim/box_anim.gd`, suite `j36`).
- **Drivable tram** (v0.30.0): the body is now built by code after the Alstom Citadis 405 of the CTS (Strasbourg): raked panoramic windscreen, rounded snout, double LED headlights, lit destination display, wipers, mirrors, white livery with red and blue stripes and a plain "CTS" text logo, large glazed bays, roof air-conditioning and a single-arm pantograph (`scenes/tram_body.gd`); the interior, doors and seats are still the JS bake. Same dimensions (23.5 m).
- **Quality and upscaling** (Options): Fast / Normal / High presets; 3D upscaling **Native, FSR 1.0 or FSR 2.2 (trial)**, 3D resolution (100, 85, 75, 67, 50 %) and sharpness. The HUD stays sharp. No DLSS: the engine does not offer it.
- **First launch on Windows**: with an integrated GPU, the "Fast" quality is chosen automatically.
- **Characters** (v0.31.0): the 8 playable survivors are original high-quality models generated entirely by script (`tools/build-characters.py` + `tools/charlib/`: signed distance fields meshed with OpenVDB, decimated, procedural PBR textures baked per texel, hair cards, 57-bone skeleton with fingers, eyes, eyelids and jaw; 21-32 k triangles, 2048 px textures, LODs generated on import; see `assets/characters/LICENSE.txt`): rotating studio-lit preview in the character menu (the survivor looks at the camera and blinks; drag to rotate), third-person view on foot with hands and fingers on the weapon, seated on bikes and tram seats with fists on the handlebars, first-person gloves and sleeves using the outfit's generated fabric. Sheet: `docs/personnages.png`.
- **Loading**: a warm-up step (pipelines, sounds, navigation grids) avoids in-game stutters.
- **Music**: `theme.*` is never shipped (copyright). Drop an mp3, ogg or wav file in `user://music/` to use it.

## Diagnosing stutters

```bash
Zombie.console.exe -- --perf-log=perf.txt
```

Play 5 to 10 minutes, close the window normally, then send `perf.txt` (the `SPIKE` lines are enough). Automatic bench: `--perf-soak=5` (a bot plays for 5 minutes).

## Useful launch options

After `--`: `--map=arena` (Strasbourg otherwise), `--mode=classic|zone`, `--zone=N|Name` (Zone unique in that zone), `--difficulty=easy|normal|hard`, `--seed=N`, `--bot` (the bot plays), `--no-music`, `--no-warmup`, `--no-boss-intro`, `--perf-log=F`, `--perf-soak=N`, `--quit-at=S`, `--shot=f.png --at=S` (screenshot), `--god` (health kept full, for performance runs). `--show-collision[=report.json]` draws the collision through the walls, `--eye-y=Y` raises the camera (see `docs/GODOT_PORT.md`, geometry diagnostics). The others (`--do=`, `--horde=`, `--seat=`, `--tram-at=`, `--zoo*`…) are for test captures; they are parsed in `scenes/main.gd`.

## Tests

```bash
tools/godot-check.sh          # everything: export config and golden files from the JS, import, run all suites
tools/godot-check.sh j9       # one suite
```

More than 159,000 checks, 0 failures at v0.19.1. The **golden files** are outputs of the JS game (Node or Chrome) that the GDScript must reproduce: config, collision, navigation, weapons, vehicles, prices, tram, bosses. Tests run headless, without rendering; screenshots need a display (or `xvfb-run`).

## Layout

| Folder | Contents |
|---|---|
| `sim/` | Pure simulation, no nodes: collision, navigation (flow field), zombies, rounds, weapons, vehicles, tram, bosses, difficulty, settings |
| `scenes/` | Views and UI: world, zombies, weapons, tram, HUD, menus, `main.gd` (input and test options) |
| `autoload/` | `Config` (balance from the JS), `Game` (state), `Sfx` (audio) |
| `shaders/` | Sky, ground, facades, water, foliage, zombies |
| `data/` | Config and data exported from the JS; `golden/` (tests, never exported) |
| `assets/` | Weapons (OBJ), zombies (glb), tram, textures, sounds; part of it is regenerated, see below |
| `tests/` | Suites `test_j0` to `test_j34`, `runner.tscn`, and the `place_perks` tool (writes `data/perk_machines.json`) |

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
```

Weapons and zombies: `tools/build-weapons.py` and `tools/build-zombies.py` (Blender). Characters: `blender -b --disable-autoexec --python tools/build-characters.py -- godot/assets/characters [id ...]` (about 20 min for the 8; `--fast` for quick 1024 px previews), then `godot --path godot --script ../tools/character-sheet.gd -- assets/characters PORTRAITS` for the menu portraits. Logs, decisions and measurements are in [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French).
