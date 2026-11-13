# Audio — how the sound works and what is wanted

Gemini no longer works on this project (v0.95.1): Claude owns the audio files like the rest of the code. The "Requests" list below is a to-do list.

## How the sound works today
- `src/audio.js`, class `Sfx` (one instance, `const sfx = new Sfx()` in `src/main.js`, passed to the `installX(game, { sfx })` modules). WebAudio, **everything procedural** (noise buffer + oscillators + filters), no sample files. Chain: sources → `this.master` (gain = `sfx.volume`) → destination; music has its own gain (`musicVolume`).
- One-shot sounds are methods, called from gameplay code as `sfx.name(volume?, distance?)`: guns (`gun(id)`, `shotgun`, `reload(cat, time)`, `knife(kind)`, `hit(head)`), shop (`buy`, `deny`, `pap`, `jingle`), rounds (`roundStart`, `roundEnd`, `powerup`, `nuke`, `explosion`), ambience details (`knock`, `glass`, `rumble`, `dirt`, `groan(volume)`, `bell`), train (`roofStep`, `trainDoors`, `roadkill`), vehicles/loops (`createEngine(kind)`, `createTramEngine()`, `createTrainSound()` return objects with start/update/stop).
- `src/music.js`, class `Music`: procedural rock (sections verse / chorus / bridge, drums, guitar, 4 intensity levels driven by `sfx.setMood(intensity, muffled)`), plus a playlist of files in `public/music/` (`jeaux_davide.ogg`, `midnight_lurch.ogg`, optional git-ignored `theme.*`). Track switching: key N, options menu, F9 menu.
- Ambience loops (`createCityAmbience`, `createStationAmbience`; code in `src/audioAmbience.js`, mixer in `src/ambience.js`): the graph exists only between `start()` and `stop()`; `update()` is called 10 times a second and only sets AudioParam targets; random events (dogs, bells, pigeons, announcements) are scheduled on the audio clock. During the intro ride neither plays.
- Full method list: `grep -n "^  [a-zA-Z]*(.*) {" src/audio.js`.

## Rules for new audio
- No copyrighted material. Generated or CC0 only; write the source/licence of every file below in "Credits". Ogg Vorbis/Opus, mono for effects, ≤ 300 KB per file, ≤ 2 MB added per change. Procedural is preferred (the repo has no sample pipeline).
- A new sound = a new method on `Sfx` (same style: `v` volume, optional `dist` attenuation, nodes disconnected when done, short-lived, no per-frame allocation). Loops return `{ start, update, stop }`.
- Respect `sfx.volume` / `sfx.musicVolume`; never exceed the master (no clipping: keep a limiter or conservative gains); must not throw before the first user gesture (the context starts suspended).
- Verify with `node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-smoke.js` (calls every sound, lists exceptions; it cannot judge how it sounds: say so in the changelog, "sons non écoutés").

## To do (sounds wanted)
Format: `- [ ] <who asks> · <sound/method name> · <when it must play, in which file/function> · <volume/params>`. The receiver ticks it when done.

- [x] station ambience loop (hall echo, distant announcements murmur, pigeons) · `createStationAmbience()` returning `{ start, update(zoneName, night, level?), stop }` · done: `src/audioAmbience.js` (`buildStation`), driven by `src/ambience.js` from `gare.zoneName(x, z)` (added to `src/gare/index.js`).
- [x] footsteps by surface (stone, wood interior, metal train floor, platform) · `step(surface, v)` · done: `Player.footstep()` / `surface()` in `src/player.js`, one step per half bob cycle. Remote players and zombies are silent (`remote.js` has no `sfx` handle; not trivial).
- [x] tram bell + doors beeps for the transfer tram, train-ride wind at broken windows · `tramBell(v, n)`, `tramDoors(open, v)` · done: `src/transfer.js` (doors open at the call, departure bell, arrival). `createTrainSound`: window gust now buffets (5.3 Hz LFO) with a whistle, `set()` throttled to 20 Hz.
- [x] city ambience by day/night (wind, distant bells, dogs far away, night insects) · `createCityAmbience()` returning `{ start, update(night, zoneIndex, hour?, level?), stop }` · done: `buildCity`, bells at the game hours of `CONFIG.audio.city.bell.hours`.
- [x] intro: level-crossing bell with doppler and bridge rumble · `crossingDing(v, doppler)`, `bridgeRumble(v, dur)` · done in `src/intro.js` (`lineSounds`; `route.crossingS` set by `rideLand.js`, `route.bridges` from `railNet.js`).

All constants: `CONFIG.audio` (`src/config.js`). Measurements without ears: `tools/audio-smoke.js` (exceptions, node counts through start/stop cycles), `tools/audio-render.js` (OfflineAudioContext: peak, RMS, band powers, spectral peaks).

## Credits
(none yet: everything is procedural)
