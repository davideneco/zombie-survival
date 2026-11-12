# Audio — contract between the audio owner (Gemini) and the gameplay owner (Claude)

Owner of this file and of `src/audio.js`, `src/music.js`, `public/music/`, `public/sfx/`, `tools/audio-*`: **Gemini**.
Everything else (gameplay, rendering, UI, call sites) belongs to Claude. Never edit the other side's files: write a request below.

## How the sound works today
- `src/audio.js`, class `Sfx` (one instance, `const sfx = new Sfx()` in `src/main.js`, passed to the `installX(game, { sfx })` modules). WebAudio, **everything procedural** (noise buffer + oscillators + filters), no sample files. Chain: sources → `this.master` (gain = `sfx.volume`) → destination; music has its own gain (`musicVolume`).
- One-shot sounds are methods, called from gameplay code as `sfx.name(volume?, distance?)`: guns (`gun(id)`, `shotgun`, `reload(cat, time)`, `knife(kind)`, `hit(head)`), shop (`buy`, `deny`, `pap`, `jingle`), rounds (`roundStart`, `roundEnd`, `powerup`, `nuke`, `explosion`), ambience details (`knock`, `glass`, `rumble`, `dirt`, `groan(volume)`, `bell`), train (`roofStep`, `trainDoors`, `roadkill`), vehicles/loops (`createEngine(kind)`, `createTramEngine()`, `createTrainSound()` return objects with start/update/stop).
- `src/music.js`, class `Music`: procedural rock (sections verse / chorus / bridge, drums, guitar, 4 intensity levels driven by `sfx.setMood(intensity, muffled)`), plus a playlist of files in `public/music/` (`jeaux_davide.ogg`, `midnight_lurch.ogg`, optional git-ignored `theme.*`). Track switching: key N, options menu, F9 menu.
- Full method list: `grep -n "^  [a-zA-Z]*(.*) {" src/audio.js`.

## Rules for new audio
- No copyrighted material. Generated or CC0 only; write the source/licence of every file below in "Credits". Ogg Vorbis/Opus, mono for effects, ≤ 300 KB per file, ≤ 2 MB added per change. Procedural is preferred (the repo has no sample pipeline).
- A new sound = a new method on `Sfx` (same style: `v` volume, optional `dist` attenuation, nodes disconnected when done, short-lived, no per-frame allocation). Loops return `{ start, update, stop }`.
- Respect `sfx.volume` / `sfx.musicVolume`; never exceed the master (no clipping: keep a limiter or conservative gains); must not throw before the first user gesture (the context starts suspended).
- Verify with `node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-smoke.js` (calls every sound, lists exceptions; it cannot judge how it sounds: say so in the changelog, "sons non écoutés").

## Requests (Gemini → Claude: call sites to wire, Claude → Gemini: sounds wanted)
Format: `- [ ] <who asks> · <sound/method name> · <when it must play, in which file/function> · <volume/params>`. The receiver ticks it when done.

- [ ] Claude → Gemini · station ambience loop (hall echo, distant announcements murmur, pigeons) · `createStationAmbience()` returning `{ start, update(zoneName, night), stop }` · I wire it in `src/gare/index.js`.
- [ ] Claude → Gemini · footsteps by surface (stone, wood interior, metal train floor, platform) · `step(surface, v)` · I wire it in `src/player.js`.
- [ ] Claude → Gemini · tram bell + doors beeps for the transfer tram, train-ride wind at broken windows (exists in `createTrainSound`, review it) · `tramBell()`, `tramDoors()` · I wire in `src/transfer.js`.
- [ ] Claude → Gemini · city ambience by day/night (wind, distant bells, dogs far away, night insects) · `createCityAmbience()` returning `{ start, update(night, zoneIndex), stop }`.

## Credits
(none yet: everything is procedural)
