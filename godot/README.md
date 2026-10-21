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

- **Menu**: Play, best score / statistics, map choice (Strasbourg or arena) and difficulty (Easy / Normal / Hard), Multiplayer (greyed out).
- **Quality and upscaling** (Options): Fast / Normal / High presets; 3D upscaling **Native, FSR 1.0 or FSR 2.2 (trial)**, 3D resolution (100, 85, 75, 67, 50 %) and sharpness. The HUD stays sharp. No DLSS: the engine does not offer it.
- **First launch on Windows**: with an integrated GPU, the "Fast" quality is chosen automatically.
- **Characters**: the 8 playable survivors have original low-poly 3D models (`assets/characters/*.glb`, built by `tools/build-characters.py`, see `assets/characters/LICENSE.txt`): rotating preview in the character menu, seated on bikes and tram seats in third person, first-person gloves and sleeves from their outfit. Sheet: `docs/personnages.png`.
- **Loading**: a warm-up step (pipelines, sounds, navigation grids) avoids in-game stutters.
- **Music**: `theme.*` is never shipped (copyright). Drop an mp3, ogg or wav file in `user://music/` to use it.

## Diagnosing stutters

```bash
Zombie.console.exe -- --perf-log=perf.txt
```

Play 5 to 10 minutes, close the window normally, then send `perf.txt` (the `SPIKE` lines are enough). Automatic bench: `--perf-soak=5` (a bot plays for 5 minutes).

## Useful launch options

After `--`: `--map=arena` (Strasbourg otherwise), `--difficulty=easy|normal|hard`, `--seed=N`, `--bot` (the bot plays), `--no-music`, `--no-warmup`, `--no-boss-intro`, `--perf-log=F`, `--perf-soak=N`, `--quit-at=S`, `--shot=f.png --at=S` (screenshot). `--show-collision[=report.json]` draws the collision through the walls, `--eye-y=Y` raises the camera (see `docs/GODOT_PORT.md`, geometry diagnostics). The others (`--do=`, `--horde=`, `--seat=`, `--tram-at=`, `--zoo*`…) are for test captures; they are parsed in `scenes/main.gd`.

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
| `tests/` | Suites `test_j0` to `test_j23` and `runner.tscn` |

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

Weapons and zombies: `tools/build-weapons.py` and `tools/build-zombies.py` (Blender). Logs, decisions and measurements are in [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) (French).
