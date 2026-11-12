# Zombie Survival — intro video: reference images and shot list (for Google AI Studio / Veo)

> **How to use:** in Google AI Studio, pick a Veo video model. For each shot of section 3: upload the image of the same name as the **first frame** (image-to-video), paste the shot's prompt after the common style block of section 2, generate 8 s. Keep the best take per shot, then assemble in a video editor (section 5). The images are screenshots of the real game (HUD removed): they give Veo the places, the architecture and the framing. Veo cannot see the game itself.

## 1. The film (about 56 s, 7 shots of 8 s + a title card)
A regional train, night. It brings the survivors back to **Strasbourg**, but the station and the city have fallen. The announcer stays calm. Then the horde reaches the train. Dawn rises on an empty station: it is time to get off.

Rhythm: calm and eerie → tension → shock → relief that is not one. No gunfire is shown, no weapon, no UI, no text in the generated clips (titles are added in the editor: Veo draws text badly).

## 2. Common style block (paste at the start of every prompt)
> Photorealistic cinematic live-action, 35 mm anamorphic look, serious survival-horror drama (grounded, not gory), desaturated teal and amber, heavy fog and haze, subtle film grain, natural handheld camera. Keep the architecture, layout and composition of the reference image. French city of Strasbourg, post-apocalyptic but quiet. No text, no logos, no brand names, no on-screen UI, no weapons visible.

If you prefer a stylized look closer to the game itself, replace "Photorealistic cinematic live-action" by "Stylized low-poly game-trailer look, faithful to the reference image" and keep the rest.

## 3. Shots
| # | Image | Seconds | Prompt (after the style block) | Sound to add in the editor |
|---|---|---|---|---|
| 1 | `n2_loco_night.jpg` | 0–8 | Night. A regional train with its headlights on races toward the camera along electrified tracks, overhead wires, a lit house in the distance, stars. Slow push-in, ground mist whipped by the train. | rolling train, rail joints; voice `intro_pa_1` starts at 6 s |
| 2 | `n1_aisle.jpg` | 8–16 | Inside the train, night. Slow dolly forward along the aisle between blue seats, ceiling lights flickering, outside the windows only darkness. Gentle sway of a moving train. Nobody in sight. | train interior ambience, the calm announcement continues |
| 3 | `n3_window_zombie.jpg` | 16–24 | Outside view of a train window at night from the track side: a pale, wounded man climbs onto the moving train and slams his hands on the glass, cracks spreading, sleepers blurred below. Slight push-in, tense. | glass thuds, `intro_windows` (narrator) |
| 4 | `n4_zombie_aisle.jpg` | 24–32 | Inside the train: a zombie with glowing eyes lurches forward in the aisle toward the camera, shaky handheld, lights flickering, fast cut-like movement, red stains on his shirt. | `intro_pa_panic`, zombie attack growls |
| 5 | `t2_loco_a.jpg` | 32–40 | Dawn. The train glides into a station under a glass canopy, pink-orange light through the glass, mist on the platform, hanging lamps swaying. Slow forward tracking along the platform, perfectly still platform. | brakes, `intro_pa_2` |
| 6 | `g3_hall_along.jpg` | 40–48 | Dawn, the empty platform beside the parked train, golden light through the canopy, a bench, a yellow safety line. Slow glide forward, distant shadows moving far away in the haze. Peaceful on the surface, uneasy underneath. | station ambience, `intro_arrival` ("Tout le monde descend.") |
| 7 | `g1_facade.jpg` | 48–56 | Dawn over the station square: the large glass vault and the stone facade in fog, empty cobbled square, a lamp post, pink sky. Slow crane-up revealing the whole facade. | wind, distant bell, `narr_round_start` ("Ils arrivent… Tenez bon.") |
| Title | none | 56–60 | Black card in the editor: **ZOMBIE SURVIVAL — STRASBOURG** | music: `public/music/` track or Gemini's |

Alternates (swap in if a shot fails or for a longer cut):
- `g2_verriere_side.jpg`: the glass vault seen from the side at dawn (replaces 7).
- `t1_train_side_a.jpg`, `t1_train_side_b.jpg`: the train along the platform and from the track side.
- `t2_loco_b.jpg`: the locomotive nose, lower angle.
- `d4_cathedral.jpg`: a street of Strasbourg with the cathedral spire at dusk, half-timbered houses (city shot for an extended cut, with the Gare Centrale tram).
- `f1_hdf.jpg`, `f2_hdf.jpg`: the Homme de Fer tram stop with a tram, shopfronts and a bench at dusk.

## 4. Voices and music (already produced)
Use the French voices of `AI_STUDIO_BRIEF.md` (the 28 files, once replaced by the AI Studio versions) or, for a quick test, the ones already in the game (`public/sfx/*.ogg`): `intro_pa_1`, `intro_windows`, `intro_pa_panic`, `intro_pa_2`, `intro_arrival`, `narr_round_start`. The game's own tracks are in `public/music/` (`jeaux_davide.ogg`, `midnight_lurch.ogg`).

## 5. Assembly
1. Put the 7 clips end to end (cut each to the best 6–8 s).
2. Add the voices at the times of the table, the train and station ambiences underneath, then the music rising from shot 3 and dropping at shot 6.
3. Add the title card, a 1 s fade in and a 1.5 s fade out. Export 1920×1080 or 1280×720, H.264.

## 6. Notes
- The images are 1280×720 JPEG (16:9), taken from the real game at dawn/dusk or night. The game's low-poly look is expected: Veo re-renders it.
- Keep the character count of each prompt reasonable; if Veo drifts away from the picture, shorten the prompt and keep only the camera move.
- Use only these images and your own prompts: no real brand, no real person.
