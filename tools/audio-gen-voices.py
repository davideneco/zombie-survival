#!/usr/bin/env python3
"""Generate lightweight French voice Ogg Vorbis files in public/sfx/ using edge-tts + ffmpeg."""
import asyncio
import os
import subprocess
import tempfile
import edge_tts

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "sfx")

# Voice profiles:
# - PA (Train / Tram announcements): fr-FR-DeniseNeural
# - Narrator (Intro + dark game narrator): fr-FR-HenriNeural (pitched deeper/slower)
# - Character (Survivor voice shared by all characters): fr-FR-RemyMultilingualNeural
CLIPS = [
    # --- Intro train PA & narrator ---
    ("intro_pa_1", "fr-FR-DeniseNeural", "-4%", "+0Hz",
     "Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus."),
    ("intro_pa_panic", "fr-FR-DeniseNeural", "+12%", "+4Hz",
     "Attention ! Ils sont dans la rame ! Fermez les portes !"),
    ("intro_slow", "fr-FR-HenriNeural", "-8%", "-8Hz",
     "Ralentissement. Obstacle sur la voie."),
    ("intro_windows", "fr-FR-HenriNeural", "+2%", "-6Hz",
     "Ils s'accrochent aux fenêtres ! Abattez-les avant qu'ils ne montent !"),
    ("intro_roof", "fr-FR-HenriNeural", "-12%", "-10Hz",
     "Écoutez... des pas sur le toit..."),
    ("intro_pa_2", "fr-FR-DeniseNeural", "-4%", "+0Hz",
     "Strasbourg. Strasbourg, terminus de ce train."),
    ("intro_arrival", "fr-FR-HenriNeural", "-8%", "-8Hz",
     "Strasbourg, terminus. Tout le monde descend."),

    # --- Transfer tram PA ---
    ("tram_dep_gare", "fr-FR-DeniseNeural", "-2%", "+0Hz",
     "Tram C, direction Gare Centrale."),
    ("tram_dep_hdf", "fr-FR-DeniseNeural", "-2%", "+0Hz",
     "Tram C, direction Homme de Fer."),
    ("tram_arr_gare", "fr-FR-DeniseNeural", "-2%", "+0Hz",
     "Prochain arrêt : Gare Centrale."),
    ("tram_arr_hdf", "fr-FR-DeniseNeural", "-2%", "+0Hz",
     "Prochain arrêt : Homme de Fer."),

    # --- Game Narrator ---
    ("narr_round_start", "fr-FR-HenriNeural", "-10%", "-12Hz",
     "Ils arrivent... Tenez bon."),
    ("narr_round_end", "fr-FR-HenriNeural", "-10%", "-10Hz",
     "Manche terminée. Reprenez votre souffle."),
    ("narr_max_ammo", "fr-FR-HenriNeural", "-6%", "-12Hz",
     "Munitions maximum !"),
    ("narr_instakill", "fr-FR-HenriNeural", "-6%", "-12Hz",
     "Mort instantanée !"),
    ("narr_nuke", "fr-FR-HenriNeural", "-6%", "-12Hz",
     "Bombe !"),
    ("narr_double", "fr-FR-HenriNeural", "-6%", "-12Hz",
     "Points doubles !"),
    ("narr_gameover", "fr-FR-HenriNeural", "-12%", "-14Hz",
     "La horde a eu raison de vous..."),

    # --- Character (shared survivor voice) ---
    ("char_reload_1", "fr-FR-RemyMultilingualNeural", "+6%", "-2Hz",
     "Je recharge !"),
    ("char_reload_2", "fr-FR-RemyMultilingualNeural", "+4%", "-2Hz",
     "Couvrez-moi, je recharge !"),
    ("char_empty", "fr-FR-RemyMultilingualNeural", "+8%", "+0Hz",
     "À sec ! Plus de balles !"),
    ("char_hurt_1", "fr-FR-RemyMultilingualNeural", "+10%", "-3Hz",
     "Argh ! Ils m'ont touché !"),
    ("char_hurt_2", "fr-FR-RemyMultilingualNeural", "+8%", "-2Hz",
     "Reculez, sales bêtes !"),
    ("char_down", "fr-FR-RemyMultilingualNeural", "+4%", "-4Hz",
     "Je suis à terre ! À l'aide !"),
    ("char_revive", "fr-FR-RemyMultilingualNeural", "+4%", "-2Hz",
     "Je me relève, on reprend le combat !"),
    ("char_headshot_1", "fr-FR-RemyMultilingualNeural", "+6%", "-2Hz",
     "En pleine tête !"),
    ("char_headshot_2", "fr-FR-RemyMultilingualNeural", "+4%", "-2Hz",
     "Et un de moins !"),
    ("char_buy", "fr-FR-RemyMultilingualNeural", "+2%", "-3Hz",
     "Parfait, ça va faire mal."),
]


async def gen_one(name, voice, rate, pitch, text):
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{name}.ogg")
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await comm.save(tmp_path)
        # Convert to compact mono Ogg Vorbis (24 kHz, q=2, stripped silence at start/end)
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", tmp_path,
            "-af", "silenceremove=start_periods=1:start_silence=0.04:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse",
            "-ac", "1", "-ar", "24000", "-c:a", "libvorbis", "-q:a", "2",
            out_path
        ], check=True)
        sz = os.path.getsize(out_path)
        print(f"Generated {name}.ogg ({sz / 1024:.1f} KB)")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


async def main():
    for clip in CLIPS:
        await gen_one(*clip)


if __name__ == "__main__":
    asyncio.run(main())
