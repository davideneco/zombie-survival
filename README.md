# Zombie Survival — Strasbourg

A co-op survival game against waves of zombies, set in the **Grande Île of Strasbourg**, rebuilt from OpenStreetMap and IGN BD TOPO data (buildings with real photogrammetric heights, quays, squares, street furniture, the cathedral). Play solo or with up to **4 players**.

There are two versions of the same game:

| Version | Where | Tech | Status |
|---|---|---|---|
| **Browser** (this page) | `main` branch | [Three.js](https://threejs.org/), [Vite](https://vite.dev/), Node.js WebSocket relay | complete, solo and multiplayer, deployed on Render |
| **Godot port** | `godot-port` branch, [`godot/`](https://github.com/davideneco/zombie-survival/tree/godot-port/godot) folder | Godot 4.7 (GDScript, Forward+) | complete solo game, Windows export; multiplayer not ported yet |

The game's text and menus are in French.

## How it works

You start at place du Marché-Neuf with a pistol, an assault rifle and 500 points. Zombies come in rounds that get bigger, faster and tougher. Survive as long as you can.

**Earning points**: hit a zombie (10), kill it (60), headshot kill (100), revive a teammate (250).

**Spending them**:
- **Doors**: 27 zones built around real places (place Kléber, place Gutenberg, the cathedral, Petite France, Homme de Fer…). The further from the start, the pricier the door.
- **Wall weapons** (chalk outlines) and their ammo.
- **Perks**: Mastodonte (extra health), Speed Cola, Double Tap, Quick Revive, Mule Kick, Stamin-Up, PHD Flopper.
- **Mystery box**: a random weapon; the box then moves.
- **Pack-a-Punch**: 3 levels, inside the cathedral.

**Power-ups** dropped by zombies: max ammo, instant kill, bomb, double points, fuel cans.

A **downed** player has 45 s to be revived (hold the interact key).

### Vehicles
- **Motorbikes**: a bike and a big two-seater (place Gutenberg, place Broglie). Hit points, fuel, they only run zombies over above a certain speed.
- **Bicycles**: 23 free bikes at 19 stations (a "V" marker on the map). 43 km/h, 150 HP, no shooting, never run zombies over; a hard crash throws the rider.
- **Tram**: two real CTS lines across the Grande Île (**A / D** from Pont de Paris through Homme de Fer, Place Kléber, Langstross Grand'Rue and Saint-Nicolas; **B / C / F** from Pont Kuss / Alt Winmärik through Homme de Fer, Broglie and Opéra) with rails, platforms, overhead wires, and red lights in front of doors that are still closed. A **drivable tram** (23.5 m, 50 km/h, 3,000 HP, mows zombies down) waits at the "Homme de Fer" platform: restore power at the substation (2,000 points, once for the whole team), then drive. You can board on foot, walk and sit inside while it moves, and pick the track at the Homme de Fer switch (`B`). Zombies cannot enter the tram.

### Endgame
- **Maître Tanneur**: from round 15, every 5 rounds, a huge plague victim roams Petite France or Saint-Pierre-le-Vieux.
- **"L'Heure du Jugement"**: from round 12 with 18 districts open, the cathedral hosts the boss, **the Executioner** (350,000 HP, +70 % per extra player), in four phases. His weak spot is the lantern on his back. Reward: 10,000 points and the Executioner's Axe.
- **Act V "L'Aube"** (the dawn): climb the spire (gargoyles, then **the Angel of Judgment**, a secret boss), then all players light **Erwin's Beacon**. Day breaks, zombies turn to ashes, "STRASBOURG LIBÉRÉE". Rewards: the Blessing of Dawn, a trophy, then the **Eternal Night** (zombies get +30 % health).

All values, prices, zones and rounds are in [`docs/REFERENCE.md`](docs/REFERENCE.md) (French), with the [annotated map](docs/carte.png) and CSV tables in [`docs/csv/`](docs/csv/).

## Controls

Every key can be changed in **Options > Touches** (click an action, press the new key, `Esc` cancels; a swap is offered if the key is taken). Fixed: mouse, wheel, `Esc`, `F9`. Default keys:

| Key | Action |
|---|---|
| `Z Q S D` / `W A S D`, arrows | Move |
| Mouse, left click, right click | Aim, shoot, aim down sights |
| `Left Shift` | Sprint |
| `Space` | Jump (vault a low obstacle) |
| `R` | Reload |
| `1` `2` `3` / wheel | Switch weapon |
| `G` / `V` / `F` | Grenade / knife / flashlight |
| `E` | Buy, open, use, mount or dismount a vehicle, revive (hold) |
| `M` | Map |
| `Esc` | Closes chat, map or menu; otherwise pause |
| `K` (hold 2 s) | Get unstuck |
| `Enter` | Text chat (multiplayer) |

- **Motorbike / bicycle**: `Z Q S D` to drive, `Space` handbrake, `V` changes view, `E` to get off.
- **Tram**: `Z`/`W` accelerate, `S` brake then reverse, `Space` emergency brake, `O` doors, `H` bell (draws zombies within 50 m), `V` view, `B` switch, `E` board, sit, stand.
- **Pack-a-Punch III assault rifle**: middle click fires the grenade launcher.
- **Host**: `F9` opens the debug menu.

## Graphics options

In Options: brightness, field of view, sensitivity, **Quality** (Rapide / Normale / Haute = Fast / Normal / High), volumes, cinematic effects, halo, chat, keys, fullscreen. All of it is visual and local: no effect on networking, balance or collisions.

| | Fast | Normal | High |
|---|---|---|---|
| Sharpness (render scale) | x0.75 | x1 | up to x2 |
| Moon shadows | none | soft, 1024 px | soft, 2048 px |
| Trees | smooth blobs | foliage cards | cards + branches |
| Rendering and grading | direct | direct | multisampled + colour LUT |
| Glow halo | no | no | yes |
| Particles / blood splats | 50 % / 16 | 100 % / 36 | 100 % / 64 |

The values are in the `graphics` block of `src/config.js`.

## Playing on your PC (browser version)

Requirements: [Node.js](https://nodejs.org/) 20 or newer, a WebGL2 browser (Chrome or Edge recommended), [Git](https://git-scm.com/).

```bash
git clone https://github.com/davideneco/zombie-survival.git
cd zombie-survival
npm install
npm run dev
```

Open **http://localhost:5173** and click *Jouer* (Play). For the optimised build: `npm run build` then `npm start` (port 3000, or the `PORT` variable).

### Playing with others
- One player **creates a room** and gets a **4-letter code**; the others enter it. The host simulates the zombies: if the host leaves, the game ends.
- **Local network**: `npm run dev -- --host`, then `http://IP_ADDRESS:5173`; the firewall must allow the port.
- **Online**: any Node.js host (built for [Render](https://render.com/): build `npm install && npm run build`, start `npm start`). Everyone must run the **same version**: reload the page after an update.

### Custom music (optional)
Drop `theme.mp3` (or `.ogg`, `.m4a`, `.wav`) in `public/music/` to replace the synthesised rock track. The file is never pushed to GitHub (copyright); see [`public/music/LISEZMOI.txt`](public/music/LISEZMOI.txt).

## Troubleshooting

- **Black screen or slow game**: enable hardware acceleration and check WebGL2 (`about:gpu` in Chrome). The first load takes a few seconds.
- **Mouse won't capture**: click the game window; the browser sometimes refuses right after `Esc`.
- **Stuck in the scenery**: hold `K` for 2 seconds; in multiplayer the host can teleport you with `F9`.
- **Can't join a room**: check the code, the game version, and that the port is reachable.

## Repository layout

| Folder / File | Contents |
|---|---|
| `src/` | The game (ES modules); balance in `src/config.js` |
| `server/` | Multiplayer relay (`rooms.mjs`) and production server (`prod.mjs`) |
| `public/` | Map (`data/area.json`), textures, music |
| `tools/` | OSM extraction, doc generation, stuck detection, baking and golden files for the Godot port |
| `docs/` | Reference, annotated map, CSV; `GODOT_PORT.md` (plan and log of the port, French) |
| `godot/` | Godot port (`godot-port` branch) |
| `.agents/` | Agent skills & roles (`explorer`, `game-designer`, `gameplay-coder`, `gui-test-debugger`, `playtest-bug-hunter`) |
| `GEMINI.md` / `AGENTS.md` | Development rules and guidelines for AI pair programmers |

To check a change: `npx vite build`, then play a game with `?debug` in the URL.

## Credits

- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL) and [IGN BD TOPO](https://geoservices.ign.fr/bdtopo) (Licence Ouverte Etalab 2.0).
- 3D engine: [Three.js](https://threejs.org/). Port: [Godot](https://godotengine.org/).
- Godot port weapons: Quaternius and Tabasco; zombies: Quaternius; details and licences in `godot/assets/*/LICENSE.txt`.
