# Zombie Survival — voices and sounds brief (to upload to Google AI Studio)

> **How to use:** upload this file in Google AI Studio with a Gemini model that can output audio and say: *"Read the brief. Produce the 28 files of part A, one downloadable audio file each, named exactly as in the table. Then part B."* Download the files into one folder and bring the folder back to Claude Code: it converts them and swaps them into the game. Same file names = nothing else to change.

## 1. The game, in 5 lines
Co-op zombie survival in **Strasbourg, France** (browser game). Dark, realistic, tense mood: cold night, damp stone, a railway station. The player starts in a regional train arriving at night, zombies attack the windows, then the fight continues in the city. Everything is **French (France)**. No real person's voice, no brand jingle (not the SNCF jingle), no copyrighted material.

## 2. Format (all files)
- WAV, **mono**, 48 kHz, 16-bit. Peak about -3 dBFS, no clipping, no more than 50 ms of silence at the start/end.
- **Clean and dry**: no reverb, no loudspeaker filter, no background noise. The game adds the loudspeaker / echo / radio effects itself while playing.
- One line = one file, exactly the name below (lowercase, `.wav`). If a take is bad, give a better take under the same name.

## 3. Part A — replace the 28 current voices (robotic text-to-speech stand-ins)

Three speakers; keep each one consistent across all their files.
- **Woman "PA"** (station/train announcer): calm, neutral, professional, clear diction, mid-age. Stays calm even when things go wrong (except `intro_pa_panic`).
- **Man "narrator"**: deep, grave, slow, dark; like the narrator of a horror game. Not theatrical, not a monster.
- **Man "survivor"**: ordinary person under stress, mid-age, warm voice, natural fighting shouts; short, breathy, human.

| File | Speaker | Direction | Text (French) |
|---|---|---|---|
| `intro_pa_1.wav` | PA | calm, professional, reassuring | Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus. |
| `intro_pa_panic.wav` | PA | the calm voice breaks: urgent, panicked, rising | Attention ! Ils sont dans la rame ! Fermez les portes ! |
| `intro_slow.wav` | narrator | low, serious, warning | Ralentissement. Obstacle sur la voie. |
| `intro_windows.wav` | narrator | tense, urgent, fast | Ils s'accrochent aux fenêtres ! Abattez-les avant qu'ils ne montent ! |
| `intro_roof.wav` | narrator | whispering, dread | Écoutez... des pas sur le toit... |
| `intro_pa_2.wav` | PA | calm and flat, almost eerie given the situation | Strasbourg. Strasbourg, terminus de ce train. |
| `intro_arrival.wav` | narrator | grave, heavy, slow, relieved but ominous | Strasbourg, terminus. Tout le monde descend. |
| `tram_dep_gare.wav` | PA | tram announcement, neutral | Tram C, direction Gare Centrale. |
| `tram_dep_hdf.wav` | PA | same | Tram C, direction Homme de Fer. |
| `tram_arr_gare.wav` | PA | neutral | Prochain arrêt : Gare Centrale. |
| `tram_arr_hdf.wav` | PA | neutral | Prochain arrêt : Homme de Fer. |
| `narr_round_start.wav` | narrator | low, menacing, slow | Ils arrivent... Tenez bon. |
| `narr_round_end.wav` | narrator | tired, calm, a breath of relief | Manche terminée. Reprenez votre souffle. |
| `narr_max_ammo.wav` | narrator | punchy, short, energetic | Munitions maximum ! |
| `narr_instakill.wav` | narrator | punchy, aggressive | Mort instantanée ! |
| `narr_nuke.wav` | narrator | punchy, explosive | Bombe ! |
| `narr_double.wav` | narrator | punchy, bright | Points doubles ! |
| `narr_gameover.wav` | narrator | slow, hopeless, final | La horde a eu raison de vous... |
| `char_reload_1.wav` | survivor | quick, focused, under fire | Je recharge ! |
| `char_reload_2.wav` | survivor | shouting to a teammate | Couvrez-moi, je recharge ! |
| `char_empty.wav` | survivor | frustrated, alarmed | À sec ! Plus de balles ! |
| `char_hurt_1.wav` | survivor | pained grunt, then the words | Argh ! Ils m'ont touché ! |
| `char_hurt_2.wav` | survivor | angry, pushing back | Reculez, sales bêtes ! |
| `char_down.wav` | survivor | weak, desperate, calling | Je suis à terre ! À l'aide ! |
| `char_revive.wav` | survivor | breathing hard, determined | Je me relève, on reprend le combat ! |
| `char_headshot_1.wav` | survivor | satisfied, sharp | En pleine tête ! |
| `char_headshot_2.wav` | survivor | cold, relieved | Et un de moins ! |
| `char_buy.wav` | survivor | grim satisfaction, low | Parfait, ça va faire mal. |

Lengths: each file is as long as the sentence takes (about 1–5 s); the PA/narrator ones can breathe, the survivor ones are quick.

## 4. Part B — new sounds (optional, only after part A)
Dry, mono WAV, same format, 4 variations `_a` `_b` `_c` `_d` where noted. These are NEW files: the game needs a small update to play them, so name them exactly.
- `zombie_groan_a.wav` … `_f.wav`: 6 different low, wet, hoarse idle groans, human and damaged (not cartoonish), 1–2 s.
- `zombie_attack_a.wav` … `_c.wav`: 3 aggressive snarls/screams, 0.7–1 s.
- `zombie_die_a.wav` … `_c.wav`: 3 short death rattles, 0.8–1.2 s.
- `zombie_window_grab.wav`: a zombie slaps a window and snarls, muffled by glass, 1.5 s.
- `player_hurt_a.wav` … `_d.wav`: short pained grunts, no words (a–b a man, c–d a woman), 0.4–0.6 s.
- `player_down.wav` (a gasp then a weak groan, 1.5 s) and `player_revive.wav` (a deep sharp breath, 1 s).
- `pa_cut.wav`: the PA woman starts « Mesdames et messieurs, nous vous informons… » then the loudspeaker cracks into static and distant screams, 3 s.

## 5. What to give back
1. The 28 files of part A (then part B), each downloadable, named exactly.
2. A `manifest.json` listing every file: `{ "file": "...", "speaker": "...", "text": "..." }`.
3. Tell me which texts you changed (if one sounded wrong in French) and what you could not produce.
