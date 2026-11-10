# Zombie Survival — brief for the voices and sound effects (to upload to Google AI Studio)

> How to use this file: upload it (or paste it) in Google AI Studio with a Gemini model that can output audio, then say: **"Read the brief and produce the files of section 3, starting with the group P1. Give each file separately, named exactly as in the table."** Download the audio files, put them in one folder, and bring them back to Claude Code (it will add them to the game).

## 1. The game
Co-op zombie survival set in **Strasbourg, France**, browser game, dark realistic mood (cold nights, damp stone streets, a railway station). The player starts on a regional train arriving at night at the station, fights zombies through the windows, then plays on the city streets. All the **game text is French**. All voices are **French (France)**. No real person's voice, no brand jingle (not the SNCF jingle: use a generic two-tone chime), no copyrighted music or sounds.

The game already generates by code (do NOT redo): gunshots, reloads, knife, explosions, shop sounds, vehicle engines, train/tram rolling, rail clacks, brake squeal, door beeps, glass, the cathedral bell. What is missing and wanted here: **voices** and **ambiences / footsteps / small details**.

## 2. Technical format (all files)
- WAV, mono, 48 kHz, 16-bit (we convert to Ogg ourselves). Voices: close-mic, dry (no reverb), the game adds the room sound. Speaker-filtered ones are marked "PA".
- Peak at about -3 dBFS, no clipping, no more than 50 ms of silence at the start or end (except where noted).
- Loops must be **seamless** (end matches start, no click, no fade-in/out).
- One sound per file; for variations give separate files (`_a`, `_b`, `_c`).
- File name = exactly the name in the tables (lowercase, no spaces).

## 3. Files wanted

### P1 — Announcements (PA voice: calm, neutral, a woman's voice, as if through a station loudspeaker: band-limited 400 Hz–6 kHz, slight distortion)
| File | Text (French) | Length |
|---|---|---|
| `pa_train_approach.wav` | « Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus. » | 6–7 s |
| `pa_train_terminus.wav` | « Strasbourg. Strasbourg, terminus de ce train. Tout le monde descend. » | 5–6 s |
| `pa_train_cut.wav` | The same woman starts « Mesdames et messieurs, nous vous informons… » then the loudspeaker cracks into static and **distant screams** of several people | 3 s |
| `pa_tram_c_homme_de_fer.wav` | « Tram C, direction Homme de Fer. » | 2 s |
| `pa_tram_c_gare_centrale.wav` | « Tram C, direction Gare Centrale. » | 2 s |
| `pa_next_homme_de_fer.wav` | « Prochain arrêt : Homme de Fer. » | 2 s |
| `pa_next_gare_centrale.wav` | « Prochain arrêt : Gare Centrale. » | 2 s |
| `pa_doors_closing.wav` | « Attention, fermeture des portes. » | 2 s |
| `pa_chime.wav` | generic two-tone soft chime (before announcements), no brand melody | 1.5 s |

### P2 — Zombies and people (dry voice, no words)
| File | Content | Length |
|---|---|---|
| `zombie_groan_a.wav` … `_f.wav` | 6 different low, wet, hoarse groans (not cartoonish), idle | 1–2 s each |
| `zombie_attack_a.wav` … `_c.wav` | 3 aggressive snarls/screams when attacking | 0.7–1 s |
| `zombie_die_a.wav` … `_c.wav` | 3 short gurgling death rattles | 0.8–1.2 s |
| `zombie_window_grab.wav` | one zombie bangs the window and snarls, muffled by glass | 1.5 s |
| `player_hurt_a.wav` … `_d.wav` | 4 short pained grunts, adult man (a-b) and adult woman (c-d) | 0.4–0.6 s |
| `player_down.wav` | a gasp then a weak groan, falling to the ground | 1.5 s |
| `player_revive.wav` | a deep sharp breath, recovering | 1 s |

### P3 — Ambiences (loops, seamless, 40–60 s)
`amb_station_hall.wav` (large echoing hall, distant murmur and metallic creaks, pigeons, no clear words) · `amb_city_night.wav` (wind in narrow streets, distant dog, faint bell, insects) · `amb_city_day.wav` (light wind, distant birds, far traffic hum) · `amb_train_interior.wav` (inside a moving regional train: low rumble, rattles, no clacks) · `amb_wind_window.wav` (wind through a broken train window, steady).

### P4 — Footsteps and small details (short, dry; give 4 variations `_a`–`_d` for each footstep)
`step_stone_a.wav`… (cobblestones, leather boots) · `step_wood_a.wav`… (wooden floor inside a building) · `step_metal_a.wav`… (train floor) · `step_platform_a.wav`… (concrete platform) · `step_gravel_a.wav`… (railway ballast) · `roof_step.wav` (heavy step on a metal roof, hollow) · `train_door_forced.wav` (metal door forced open, bang and screech) · `window_smash.wav` (a train window smashed from outside, glass falls inside) · `tram_bell.wav` (tram bell, two rings) · `tram_horn.wav` (short tram warning horn) · `door_wood_open.wav` · `door_wood_close.wav` · `pickup_item.wav` (short, satisfying, small) · `heartbeat_low.wav` (loop of a slow heartbeat, 4 s, for low health).

## 4. What to give back
1. All the files above (start with P1, then P2, P3, P4), each downloadable, named exactly.
2. At the end a `manifest.json` listing every file: `{ "file": "...", "text": "<the French text, if a voice>", "loop": true/false, "notes": "..." }`.
3. Tell me which lines you changed (if a text sounded wrong in French) and which sounds you could not produce.

## 5. Direction notes
- Mood: serious and tense, never funny. Voices natural, not theatrical, except the zombies.
- The announcer stays calm even when the situation turns bad: that contrast is the point.
- Zombies are former citizens: human voices, damaged, not monsters.
