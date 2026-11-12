#!/usr/bin/env python3
"""
Generate all 48 audio files specified in docs/AI_STUDIO_BRIEF.md:
  - Part A: 28 French voice lines (Woman "PA", Man "narrator", Man "survivor")
  - Part B: 20 new sound effects (zombie groans/attacks/deaths/window grab,
            player hurt/down/revive, and PA cut into static & screams)
  - manifest.json

Outputs:
  1. WAV deliverables (48 kHz, 16-bit, mono, peak -3 dBFS, <= 50 ms head/tail silence)
     in /home/david/Téléchargements/ai_studio_audio/
  2. Ogg Vorbis game assets (24 kHz, mono, q3)
     in /home/david/zombie-survival/public/sfx/

Run with:
  uv run --with edge-tts --with numpy --with scipy python3 tools/audio-gen-voices.py
"""
import asyncio
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import edge_tts
import numpy as np
from scipy import signal

SR = 48000
PEAK_LINEAR = 10 ** (-3.0 / 20.0)  # -3.0 dBFS (~0.7079)

ROOT_DIR = Path(__file__).resolve().parent.parent
SFX_DIR = ROOT_DIR / "public" / "sfx"
WAV_OUT_DIR = Path("/home/david/Téléchargements/ai_studio_audio")

VOICE_PA = "fr-FR-VivienneMultilingualNeural"
VOICE_NARR = "fr-FR-HenriNeural"
VOICE_SURV = "fr-FR-RemyMultilingualNeural"
VOICE_FEM2 = "fr-FR-DeniseNeural"


# ---------------------------------------------------------------------------
# DSP helpers (48 kHz float64 mono)
# ---------------------------------------------------------------------------
def butter_filter(x: np.ndarray, cutoff, btype: str, order: int = 4) -> np.ndarray:
    nyq = 0.5 * SR
    if isinstance(cutoff, (list, tuple)):
        wn = [max(1e-4, min(0.999, f / nyq)) for f in cutoff]
    else:
        wn = max(1e-4, min(0.999, cutoff / nyq))
    sos = signal.butter(order, wn, btype=btype, output="sos")
    return signal.sosfiltfilt(sos, x)


def peaking_eq(x: np.ndarray, f0: float, q: float, gain_db: float) -> np.ndarray:
    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2.0 * q)
    cw = np.cos(w0)
    b0 = 1.0 + alpha * A
    b1 = -2.0 * cw
    b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A
    a1 = -2.0 * cw
    a2 = 1.0 - alpha / A
    b = np.array([b0 / a0, b1 / a0, b2 / a0])
    a = np.array([1.0, a1 / a0, a2 / a0])
    return signal.lfilter(b, a, x)


def trim_and_normalize(x: np.ndarray, max_pad_ms: float = 25.0, target_dur: float | None = None) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    x = x - np.mean(x)
    peak = np.max(np.abs(x)) if x.size else 0.0
    if peak > 1e-8:
        x = x / peak

    # Envelope for silence trimming (-45 dBFS threshold)
    win = max(1, int(0.008 * SR))
    env = np.sqrt(np.convolve(x * x, np.ones(win) / win, mode="same"))
    active = np.where(env > 0.0055)[0]
    pad = int((max_pad_ms / 1000.0) * SR)
    if active.size > 0:
        i0 = max(0, int(active[0]) - pad)
        i1 = min(x.size, int(active[-1]) + pad)
        x = x[i0:i1]

    if target_dur is not None:
        target_len = int(round(target_dur * SR))
        if x.size > target_len:
            x = x[:target_len]
        elif x.size < target_len:
            # Extend tail softly with low-level room air so silence never exceeds 50 ms
            diff = target_len - x.size
            tail = x[-min(x.size, diff):] * np.linspace(0.15, 0.01, min(x.size, diff))
            if tail.size < diff:
                tail = np.pad(tail, (0, diff - tail.size))
            x = np.concatenate([x, tail])

    # Smooth 8 ms fade in / 12 ms fade out
    fi = min(int(0.008 * SR), x.size // 4)
    fo = min(int(0.012 * SR), x.size // 4)
    if fi > 1:
        x[:fi] *= 0.5 * (1.0 - np.cos(np.pi * np.arange(fi) / fi))
    if fo > 1:
        x[-fo:] *= 0.5 * (1.0 + np.cos(np.pi * np.arange(fo) / fo))

    peak = np.max(np.abs(x)) if x.size else 0.0
    if peak > 1e-8:
        x = x * (PEAK_LINEAR / peak)
    return np.clip(x, -0.999, 0.999)


def save_wav_and_ogg(stem: str, x: np.ndarray, max_pad_ms: float = 25.0, target_dur: float | None = None):
    y = trim_and_normalize(x, max_pad_ms=max_pad_ms, target_dur=target_dur)
    pcm16 = np.round(y * 32767.0).astype(np.int16)

    wav_path = WAV_OUT_DIR / f"{stem}.wav"
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm16.tobytes())

    ogg_path = SFX_DIR / f"{stem}.ogg"
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(wav_path),
            "-ac", "1", "-ar", "24000",
            "-c:a", "libvorbis", "-q:a", "3",
            str(ogg_path),
        ],
        check=True,
    )
    return wav_path, ogg_path, len(pcm16) / SR


async def tts_clause_to_array(text: str, voice: str, rate: str, pitch: str, tmp_dir: Path, tag: str) -> np.ndarray:
    mp3_path = tmp_dir / f"{tag}.mp3"
    wav_path = tmp_dir / f"{tag}.wav"
    # Parse pitch Hz offset and apply via high-quality resampling + formant shift so edge-tts never rejects multilingual pitch tags
    hz_shift = 0.0
    if pitch and pitch.endswith("Hz"):
        try:
            hz_shift = float(pitch[:-2])
        except ValueError:
            hz_shift = 0.0
    safe_pitch = "+0Hz"
    for attempt in range(3):
        try:
            v_use = voice if attempt < 2 else (VOICE_FEM2 if "Vivienne" in voice else VOICE_NARR)
            comm = edge_tts.Communicate(text, v_use, rate=rate, pitch=safe_pitch)
            await comm.save(str(mp3_path))
            break
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(0.3)
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(mp3_path),
            "-ac", "1", "-ar", str(SR),
            "-c:a", "pcm_s16le",
            str(wav_path),
        ],
        check=True,
    )
    with wave.open(str(wav_path), "rb") as wf:
        raw = wf.readframes(wf.getnframes())
    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    if abs(hz_shift) > 0.5 and arr.size > 128:
        # Pitch & formant shift factor (~180 Hz reference fundamental)
        factor = np.clip(1.0 + (hz_shift / 240.0), 0.72, 1.28)
        new_len = max(64, int(round(arr.size / factor)))
        arr = signal.resample(arr, new_len)
    return trim_and_normalize(arr, max_pad_ms=14.0)


def synth_breath(dur: float, intensity: float = 0.25, sharp: bool = False, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.linspace(0.0, 1.0, n)
    white = rng.standard_normal(n)
    # Vocal tract aspiration formants (F1 ~ 550 Hz, F2 ~ 1550 Hz, F3 ~ 2600 Hz)
    f1 = butter_filter(white, (380, 750), "bandpass", 2) * 0.6
    f2 = butter_filter(white, (1200, 1950), "bandpass", 2) * 0.45
    f3 = butter_filter(white, (2300, 3200), "bandpass", 2) * 0.2
    b = f1 + f2 + f3
    if sharp:
        env = np.sin(np.pi * (t ** 0.65)) ** 1.4
    else:
        env = np.sin(np.pi * t) ** 1.6
    return b * env * intensity


def synth_human_grunt(
    dur: float,
    f0_start: float,
    f0_end: float,
    formants: list[tuple[float, float, float]],
    roughness: float = 0.25,
    breathiness: float = 0.25,
    seed: int = 42,
) -> np.ndarray:
    """Synthesize a realistic non-verbal human vocal grunt/groan using a Rosenberg glottal source + formant cascade."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = np.linspace(0.0, 1.0, n)

    # Pitch contour with natural jitter + vibrato
    f0 = f0_start + (f0_end - f0_start) * (u ** 0.85)
    jitter = butter_filter(rng.standard_normal(n), 18.0, "lowpass", 2) * (0.025 * f0)
    vibrato = np.sin(2.0 * np.pi * 5.8 * t) * (0.015 * f0)
    inst_f = np.clip(f0 + jitter + vibrato, 35.0, 650.0)
    phase = np.cumsum(inst_f / SR)

    # Glottal pulse train + subharmonic diplophonia (roughness)
    cyc = np.mod(phase, 1.0)
    glottal = np.where(cyc < 0.42, 0.5 * (1.0 - np.cos(np.pi * cyc / 0.42)), np.cos(0.5 * np.pi * (cyc - 0.42) / 0.58))
    glottal = np.diff(glottal, prepend=glottal[0]) * 18.0

    sub_cyc = np.mod(phase * 0.5, 1.0)
    sub_pulse = np.sin(2.0 * np.pi * sub_cyc) + 0.5 * np.sin(4.0 * np.pi * sub_cyc)
    asp = rng.standard_normal(n) * (0.4 + 0.6 * np.maximum(0.0, np.sin(2.0 * np.pi * phase)))

    src = glottal * (1.0 - 0.35 * roughness) + sub_pulse * roughness + asp * breathiness

    # Parallel + cascade vocal tract formants
    out = np.zeros(n)
    for fc, bw, amp in formants:
        low = max(50.0, fc - bw * 0.5)
        high = min(SR * 0.46, fc + bw * 0.5)
        out += butter_filter(src, (low, high), "bandpass", 2) * amp

    # Natural attack/decay amplitude contour
    atk = min(int(0.045 * SR), n // 4)
    rel = min(int(0.14 * SR), n // 2)
    env = np.ones(n)
    if atk > 1:
        env[:atk] = np.linspace(0.0, 1.0, atk) ** 0.7
    if rel > 1:
        env[-rel:] = np.linspace(1.0, 0.0, rel) ** 1.4
    out *= env
    return np.tanh(out * 1.6)


def apply_vocal_tremor(x: np.ndarray, depth_ms: float = 1.6, rate_hz: float = 6.2) -> np.ndarray:
    n = x.size
    t = np.arange(n) / SR
    mod = (depth_ms / 1000.0) * SR * np.sin(2.0 * np.pi * rate_hz * t)
    idx = np.clip(np.arange(n, dtype=np.float64) + mod, 0, n - 1)
    return np.interp(idx, np.arange(n, dtype=np.float64), x)


def apply_whisper_dread(x: np.ndarray, seed: int = 7) -> np.ndarray:
    """Transform voiced speech into a tense, hushed human whisper while preserving French articulation."""
    rng = np.random.default_rng(seed)
    n = x.size
    win = int(0.006 * SR)
    env = np.sqrt(np.convolve(x * x, np.ones(win) / win, mode="same"))
    noise = rng.standard_normal(n) * env
    # Extract consonant/formant bands from original voice and modulate aspiration
    hi_voice = butter_filter(x, (260, 4800), "bandpass", 3)
    asp_f1 = butter_filter(noise, (450, 1150), "bandpass", 2) * 0.55
    asp_f2 = butter_filter(noise, (1300, 2900), "bandpass", 2) * 0.75
    asp_f3 = butter_filter(noise, (2900, 5200), "bandpass", 2) * 0.45
    whisper = hi_voice * 0.52 + (asp_f1 + asp_f2 + asp_f3) * 0.85
    return peaking_eq(whisper, 1850.0, 1.2, 3.5)


def enhance_pa(x: np.ndarray, panic: bool = False) -> np.ndarray:
    # Clean, dry, clear mid-age woman diction
    y = butter_filter(x, 75.0, "highpass", 2)
    y = peaking_eq(y, 240.0, 1.1, 1.8)
    y = peaking_eq(y, 2850.0, 1.4, 2.2)
    if panic:
        y = apply_vocal_tremor(y, depth_ms=1.1, rate_hz=6.4)
        y = peaking_eq(y, 1950.0, 1.2, 3.0)
        y = np.tanh(y * 1.35)
    return y


def enhance_narrator(x: np.ndarray, whisper: bool = False, punchy: bool = False) -> np.ndarray:
    if whisper:
        return apply_whisper_dread(x)
    # Deep, grave, slow, dark horror narrator: subtle chest sub-harmonic + warm low-mid body
    y = butter_filter(x, 55.0, "highpass", 2)
    sub = butter_filter(x, (65.0, 155.0), "bandpass", 2)
    y = y + np.tanh(sub * 2.2) * 0.28
    y = peaking_eq(y, 125.0, 1.1, 3.8)
    y = peaking_eq(y, 2400.0, 1.3, 1.8 if not punchy else 3.2)
    y = butter_filter(y, 7800.0, "lowpass", 3)
    if punchy:
        y = np.tanh(y * 1.45)
    return y


def enhance_survivor(x: np.ndarray, stressed: bool = False, weak: bool = False) -> np.ndarray:
    # Ordinary man under stress: warm chest, slight grit
    y = butter_filter(x, 70.0, "highpass", 2)
    y = peaking_eq(y, 185.0, 1.1, 2.4)
    y = peaking_eq(y, 2150.0, 1.2, 2.8)
    if weak:
        y = apply_vocal_tremor(y, depth_ms=1.4, rate_hz=5.8)
        y = butter_filter(y, 4600.0, "lowpass", 2)
    elif stressed:
        y = np.tanh(y * 1.38)
    return y


def concat_clauses(parts: list[tuple[np.ndarray, float]]) -> np.ndarray:
    """Concatenate audio arrays with specified gap (in seconds, can be negative for crossfade)."""
    out = np.zeros(0, dtype=np.float64)
    for idx, (seg, gap_s) in enumerate(parts):
        if idx == 0 or out.size == 0:
            out = seg.copy()
            continue
        gap_n = int(round(gap_s * SR))
        if gap_n >= 0:
            out = np.concatenate([out, np.zeros(gap_n), seg])
        else:
            ov = min(-gap_n, out.size, seg.size)
            fade = np.linspace(0.0, 1.0, ov)
            mixed = out[-ov:] * (1.0 - fade) + seg[:ov] * fade
            out = np.concatenate([out[:-ov], mixed, seg[ov:]])
    return out


# ---------------------------------------------------------------------------
# PART A — 28 Voices (exact names and texts from docs/AI_STUDIO_BRIEF.md)
# ---------------------------------------------------------------------------
PART_A_SPECS = [
    {
        "stem": "intro_pa_1",
        "speaker": "PA",
        "text": "Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus.",
        "clauses": [
            ("Mesdames et messieurs,", VOICE_PA, "-4%", "+0Hz", 0.14),
            ("dans quelques minutes notre train arrivera en gare de Strasbourg,", VOICE_PA, "-3%", "+0Hz", 0.12),
            ("son terminus.", VOICE_PA, "-6%", "-2Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "intro_pa_panic",
        "speaker": "PA",
        "text": "Attention ! Ils sont dans la rame ! Fermez les portes !",
        "clauses": [
            ("Attention !", VOICE_PA, "+14%", "+18Hz", 0.05),
            ("__BREATH_SHARP__", "", "", "", 0.03),
            ("Ils sont dans la rame !", VOICE_PA, "+24%", "+34Hz", 0.05),
            ("__BREATH_SHARP__", "", "", "", 0.02),
            ("Fermez les portes !", VOICE_PA, "+30%", "+48Hz", 0.0),
        ],
        "mode": "pa_panic",
    },
    {
        "stem": "intro_slow",
        "speaker": "narrator",
        "text": "Ralentissement. Obstacle sur la voie.",
        "clauses": [
            ("Ralentissement.", VOICE_NARR, "-14%", "-16Hz", 0.18),
            ("Obstacle sur la voie.", VOICE_NARR, "-16%", "-18Hz", 0.0),
        ],
        "mode": "narr_grave",
    },
    {
        "stem": "intro_windows",
        "speaker": "narrator",
        "text": "Ils s'accrochent aux fenêtres ! Abattez-les avant qu'ils ne montent !",
        "clauses": [
            ("Ils s'accrochent aux fenêtres !", VOICE_NARR, "+10%", "-6Hz", 0.07),
            ("Abattez-les avant qu'ils ne montent !", VOICE_NARR, "+14%", "-4Hz", 0.0),
        ],
        "mode": "narr_punchy",
    },
    {
        "stem": "intro_roof",
        "speaker": "narrator",
        "text": "Écoutez... des pas sur le toit...",
        "clauses": [
            ("Écoutez...", VOICE_NARR, "-18%", "-12Hz", 0.26),
            ("des pas sur le toit...", VOICE_NARR, "-22%", "-16Hz", 0.0),
        ],
        "mode": "narr_whisper",
    },
    {
        "stem": "intro_pa_2",
        "speaker": "PA",
        "text": "Strasbourg. Strasbourg, terminus de ce train.",
        "clauses": [
            ("Strasbourg.", VOICE_PA, "-8%", "-3Hz", 0.22),
            ("Strasbourg, terminus de ce train.", VOICE_PA, "-7%", "-4Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "intro_arrival",
        "speaker": "narrator",
        "text": "Strasbourg, terminus. Tout le monde descend.",
        "clauses": [
            ("Strasbourg, terminus.", VOICE_NARR, "-16%", "-18Hz", 0.22),
            ("Tout le monde descend.", VOICE_NARR, "-20%", "-22Hz", 0.0),
        ],
        "mode": "narr_grave",
    },
    {
        "stem": "tram_dep_gare",
        "speaker": "PA",
        "text": "Tram C, direction Gare Centrale.",
        "clauses": [
            ("Tram C,", VOICE_PA, "-3%", "+0Hz", 0.10),
            ("direction Gare Centrale.", VOICE_PA, "-4%", "-1Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "tram_dep_hdf",
        "speaker": "PA",
        "text": "Tram C, direction Homme de Fer.",
        "clauses": [
            ("Tram C,", VOICE_PA, "-3%", "+0Hz", 0.10),
            ("direction Homme de Fer.", VOICE_PA, "-4%", "-1Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "tram_arr_gare",
        "speaker": "PA",
        "text": "Prochain arrêt : Gare Centrale.",
        "clauses": [
            ("Prochain arrêt :", VOICE_PA, "-4%", "+0Hz", 0.10),
            ("Gare Centrale.", VOICE_PA, "-4%", "-1Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "tram_arr_hdf",
        "speaker": "PA",
        "text": "Prochain arrêt : Homme de Fer.",
        "clauses": [
            ("Prochain arrêt :", VOICE_PA, "-4%", "+0Hz", 0.10),
            ("Homme de Fer.", VOICE_PA, "-4%", "-1Hz", 0.0),
        ],
        "mode": "pa_calm",
    },
    {
        "stem": "narr_round_start",
        "speaker": "narrator",
        "text": "Ils arrivent... Tenez bon.",
        "clauses": [
            ("Ils arrivent...", VOICE_NARR, "-18%", "-18Hz", 0.20),
            ("Tenez bon.", VOICE_NARR, "-14%", "-16Hz", 0.0),
        ],
        "mode": "narr_grave",
    },
    {
        "stem": "narr_round_end",
        "speaker": "narrator",
        "text": "Manche terminée. Reprenez votre souffle.",
        "clauses": [
            ("__BREATH_SOFT__", "", "", "", 0.04),
            ("Manche terminée.", VOICE_NARR, "-12%", "-14Hz", 0.16),
            ("Reprenez votre souffle.", VOICE_NARR, "-15%", "-16Hz", 0.0),
        ],
        "mode": "narr_grave",
    },
    {
        "stem": "narr_max_ammo",
        "speaker": "narrator",
        "text": "Munitions maximum !",
        "clauses": [
            ("Munitions maximum !", VOICE_NARR, "+6%", "-8Hz", 0.0),
        ],
        "mode": "narr_punchy",
    },
    {
        "stem": "narr_instakill",
        "speaker": "narrator",
        "text": "Mort instantanée !",
        "clauses": [
            ("Mort instantanée !", VOICE_NARR, "+4%", "-12Hz", 0.0),
        ],
        "mode": "narr_punchy",
    },
    {
        "stem": "narr_nuke",
        "speaker": "narrator",
        "text": "Bombe !",
        "clauses": [
            ("Bombe !", VOICE_NARR, "+2%", "-14Hz", 0.0),
        ],
        "mode": "narr_punchy",
    },
    {
        "stem": "narr_double",
        "speaker": "narrator",
        "text": "Points doubles !",
        "clauses": [
            ("Points doubles !", VOICE_NARR, "+8%", "-6Hz", 0.0),
        ],
        "mode": "narr_punchy",
    },
    {
        "stem": "narr_gameover",
        "speaker": "narrator",
        "text": "La horde a eu raison de vous...",
        "clauses": [
            ("La horde", VOICE_NARR, "-18%", "-18Hz", 0.08),
            ("a eu raison de vous...", VOICE_NARR, "-22%", "-22Hz", 0.0),
        ],
        "mode": "narr_grave",
    },
    {
        "stem": "char_reload_1",
        "speaker": "survivor",
        "text": "Je recharge !",
        "clauses": [
            ("Je recharge !", VOICE_SURV, "+16%", "+8Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_reload_2",
        "speaker": "survivor",
        "text": "Couvrez-moi, je recharge !",
        "clauses": [
            ("Couvrez-moi,", VOICE_SURV, "+16%", "+10Hz", 0.05),
            ("je recharge !", VOICE_SURV, "+20%", "+14Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_empty",
        "speaker": "survivor",
        "text": "À sec ! Plus de balles !",
        "clauses": [
            ("À sec !", VOICE_SURV, "+20%", "+14Hz", 0.06),
            ("Plus de balles !", VOICE_SURV, "+22%", "+18Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_hurt_1",
        "speaker": "survivor",
        "text": "Argh ! Ils m'ont touché !",
        "clauses": [
            ("__GRUNT_HURT__", "", "", "", 0.04),
            ("Ils m'ont touché !", VOICE_SURV, "+18%", "+12Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_hurt_2",
        "speaker": "survivor",
        "text": "Reculez, sales bêtes !",
        "clauses": [
            ("Reculez,", VOICE_SURV, "+16%", "+10Hz", 0.05),
            ("sales bêtes !", VOICE_SURV, "+18%", "+14Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_down",
        "speaker": "survivor",
        "text": "Je suis à terre ! À l'aide !",
        "clauses": [
            ("__BREATH_SHARP__", "", "", "", 0.03),
            ("Je suis à terre !", VOICE_SURV, "-4%", "-4Hz", 0.08),
            ("__BREATH_SOFT__", "", "", "", 0.03),
            ("À l'aide !", VOICE_SURV, "+10%", "+16Hz", 0.0),
        ],
        "mode": "surv_weak",
    },
    {
        "stem": "char_revive",
        "speaker": "survivor",
        "text": "Je me relève, on reprend le combat !",
        "clauses": [
            ("__BREATH_SHARP__", "", "", "", 0.04),
            ("Je me relève,", VOICE_SURV, "+6%", "+4Hz", 0.07),
            ("on reprend le combat !", VOICE_SURV, "+14%", "+10Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_headshot_1",
        "speaker": "survivor",
        "text": "En pleine tête !",
        "clauses": [
            ("En pleine tête !", VOICE_SURV, "+14%", "+8Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_headshot_2",
        "speaker": "survivor",
        "text": "Et un de moins !",
        "clauses": [
            ("Et un de moins !", VOICE_SURV, "+10%", "+4Hz", 0.0),
        ],
        "mode": "surv_stress",
    },
    {
        "stem": "char_buy",
        "speaker": "survivor",
        "text": "Parfait, ça va faire mal.",
        "clauses": [
            ("Parfait,", VOICE_SURV, "-4%", "-4Hz", 0.09),
            ("ça va faire mal.", VOICE_SURV, "-6%", "-6Hz", 0.0),
        ],
        "mode": "surv_calm",
    },
]


async def build_part_a(tmp_dir: Path, manifest: list[dict]):
    for i, spec in enumerate(PART_A_SPECS):
        stem = spec["stem"]
        parts: list[tuple[np.ndarray, float]] = []
        for c_idx, (txt, voice, rate, pitch, gap) in enumerate(spec["clauses"]):
            if txt == "__BREATH_SHARP__":
                seg = synth_breath(0.16, intensity=0.22, sharp=True, seed=100 + i * 10 + c_idx)
            elif txt == "__BREATH_SOFT__":
                seg = synth_breath(0.22, intensity=0.16, sharp=False, seed=200 + i * 10 + c_idx)
            elif txt == "__GRUNT_HURT__":
                grunt = synth_human_grunt(
                    0.34, 155.0, 108.0,
                    [(580, 160, 1.0), (1320, 240, 0.7), (2450, 350, 0.35)],
                    roughness=0.38, breathiness=0.32, seed=301,
                )
                inhale = synth_breath(0.11, intensity=0.25, sharp=True, seed=302)
                seg = concat_clauses([(grunt, 0.02), (inhale, 0.0)])
            else:
                seg = await tts_clause_to_array(txt, voice, rate, pitch, tmp_dir, f"{stem}_{c_idx}")
            parts.append((seg, gap))

        raw = concat_clauses(parts)
        mode = spec["mode"]
        if mode == "pa_calm":
            proc = enhance_pa(raw, panic=False)
        elif mode == "pa_panic":
            proc = enhance_pa(raw, panic=True)
        elif mode == "narr_grave":
            proc = enhance_narrator(raw, whisper=False, punchy=False)
        elif mode == "narr_punchy":
            proc = enhance_narrator(raw, whisper=False, punchy=True)
        elif mode == "narr_whisper":
            proc = enhance_narrator(raw, whisper=True, punchy=False)
        elif mode == "surv_stress":
            proc = enhance_survivor(raw, stressed=True, weak=False)
        elif mode == "surv_weak":
            proc = enhance_survivor(raw, stressed=True, weak=True)
        else:
            proc = enhance_survivor(raw, stressed=False, weak=False)

        _, ogg_p, dur = save_wav_and_ogg(stem, proc)
        manifest.append({
            "file": f"{stem}.wav",
            "speaker": spec["speaker"],
            "text": spec["text"],
        })
        print(f"[Part A] {stem}.wav ({dur:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")


# ---------------------------------------------------------------------------
# PART B — 20 New Sounds (zombie groans/attacks/deaths/window, player, pa_cut)
# ---------------------------------------------------------------------------
def resample_speed(x: np.ndarray, factor: float) -> np.ndarray:
    """Resample by factor (< 1.0 lowers pitch & formants and lengthens duration)."""
    new_len = max(64, int(round(x.size / factor)))
    return signal.resample(x, new_len)


def wet_throat_layer(dur: float, f0_a: float, f0_b: float, roughness: float, seed: int) -> np.ndarray:
    """Damaged human vocal cords + wet pharyngeal bubbling modulation."""
    rng = np.random.default_rng(seed)
    base = synth_human_grunt(
        dur, f0_a, f0_b,
        [(360, 110, 1.0), (920, 180, 0.75), (1880, 280, 0.35), (2750, 400, 0.18)],
        roughness=roughness, breathiness=0.38, seed=seed,
    )
    n = base.size
    t = np.arange(n) / SR
    # Wet gurgle/bubble modulation (irregular 14-24 Hz amplitude & formant flutter)
    flutter = 0.65 + 0.35 * np.sin(2.0 * np.pi * (15.0 + 4.0 * np.sin(2.0 * np.pi * 2.3 * t)) * t)
    wet_noise = butter_filter(rng.standard_normal(n), (550, 2100), "bandpass", 2) * flutter * 0.25
    return np.tanh((base * flutter + wet_noise) * 1.45)


async def build_part_b(tmp_dir: Path, manifest: list[dict]):
    # 1. zombie_groan_a.wav .. zombie_groan_f.wav (6 variations, 1.25 - 1.85 s)
    groan_recipes = [
        ("zombie_groan_a", "Oh... rrrhhh... ahhh...", VOICE_NARR, "-35%", "-30Hz", 0.66, 78.0, 62.0, 0.55, 1.55, 401),
        ("zombie_groan_b", "Rrrhhhaaa... hhhnnn...", VOICE_SURV, "-32%", "-28Hz", 0.64, 86.0, 68.0, 0.48, 1.40, 402),
        ("zombie_groan_c", "Hhhnnn... oooaaargh...", VOICE_NARR, "-38%", "-32Hz", 0.62, 72.0, 56.0, 0.62, 1.75, 403),
        ("zombie_groan_d", "Aaaahhh... ggrrrhhh...", VOICE_FEM2, "-34%", "-28Hz", 0.60, 96.0, 74.0, 0.52, 1.45, 404),
        ("zombie_groan_e", "Ooorrrhhh... mmmhhh...", VOICE_SURV, "-36%", "-30Hz", 0.63, 82.0, 59.0, 0.58, 1.65, 405),
        ("zombie_groan_f", "Grrrhhhooo... hhh...", VOICE_NARR, "-40%", "-34Hz", 0.59, 68.0, 52.0, 0.65, 1.80, 406),
    ]
    for stem, utt, voice, rate, pitch, warp, f0a, f0b, rough, target_d, seed in groan_recipes:
        tts_seg = await tts_clause_to_array(utt, voice, rate, pitch, tmp_dir, stem)
        warped = resample_speed(tts_seg, warp)
        warped = butter_filter(warped, (70, 2400), "bandpass", 2)
        if warped.size > int(target_d * SR):
            warped = warped[:int(target_d * SR)]
        dur = max(1.2, min(1.9, target_d))
        throat = wet_throat_layer(dur, f0a, f0b, rough, seed)
        m = min(warped.size, throat.size)
        mix = warped[:m] * 0.58 + throat[:m] * 0.72
        # Add irregular subharmonic vocal fry
        fry = butter_filter(np.tanh(mix * 2.4), (55, 1650), "bandpass", 2)
        _, ogg_p, d = save_wav_and_ogg(stem, fry, target_dur=dur)
        manifest.append({"file": f"{stem}.wav", "speaker": "zombie", "text": "(grognement rauque et humide)"})
        print(f"[Part B] {stem}.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 2. zombie_attack_a.wav .. zombie_attack_c.wav (3 aggressive snarls/screams, 0.7-1.0 s)
    attack_recipes = [
        ("zombie_attack_a", "Raaah !", VOICE_SURV, "+10%", "-18Hz", 0.76, 135.0, 195.0, 0.82, 501),
        ("zombie_attack_b", "Graaah !", VOICE_NARR, "+8%", "-22Hz", 0.72, 118.0, 175.0, 0.88, 502),
        ("zombie_attack_c", "Krrrhaaa !", VOICE_FEM2, "+12%", "-16Hz", 0.68, 155.0, 225.0, 0.92, 503),
    ]
    for stem, utt, voice, rate, pitch, warp, f0a, f0b, dur, seed in attack_recipes:
        tts_seg = await tts_clause_to_array(utt, voice, rate, pitch, tmp_dir, stem)
        warped = resample_speed(tts_seg, warp)
        snarl = synth_human_grunt(
            dur, f0a, f0b,
            [(480, 160, 1.0), (1280, 260, 0.9), (2450, 420, 0.65)],
            roughness=0.68, breathiness=0.48, seed=seed,
        )
        m = min(warped.size, snarl.size)
        mix = np.tanh((warped[:m] * 0.55 + snarl[:m] * 0.85) * 2.2)
        _, ogg_p, d = save_wav_and_ogg(stem, mix, target_dur=dur)
        manifest.append({"file": f"{stem}.wav", "speaker": "zombie", "text": "(feulement d'attaque agressif)"})
        print(f"[Part B] {stem}.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 3. zombie_die_a.wav .. zombie_die_c.wav (3 short death rattles, 0.8-1.2 s)
    die_recipes = [
        ("zombie_die_a", "Arrrgh... hhh...", VOICE_NARR, "-22%", "-26Hz", 0.66, 115.0, 46.0, 0.95, 601),
        ("zombie_die_b", "Ooorgh... khhh...", VOICE_SURV, "-25%", "-24Hz", 0.64, 128.0, 48.0, 1.05, 602),
        ("zombie_die_c", "Grrrhh... ahhh...", VOICE_NARR, "-28%", "-30Hz", 0.62, 102.0, 42.0, 1.12, 603),
    ]
    for stem, utt, voice, rate, pitch, warp, f0a, f0b, dur, seed in die_recipes:
        tts_seg = await tts_clause_to_array(utt, voice, rate, pitch, tmp_dir, stem)
        warped = resample_speed(tts_seg, warp)
        rattle = wet_throat_layer(dur, f0a, f0b, 0.72, seed)
        m = min(warped.size, rattle.size)
        decay = np.linspace(1.0, 0.08, m) ** 1.2
        mix = (warped[:m] * 0.48 + rattle[:m] * 0.82) * decay
        _, ogg_p, d = save_wav_and_ogg(stem, mix, target_dur=dur)
        manifest.append({"file": f"{stem}.wav", "speaker": "zombie", "text": "(râle d'agonie)"})
        print(f"[Part B] {stem}.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 4. zombie_window_grab.wav (slaps a window and snarls, muffled by glass, 1.5 s)
    rng = np.random.default_rng(701)
    n_win = int(1.50 * SR)
    t_win = np.arange(n_win) / SR
    # Fleshy palm slap + glass pane thud & frame rattle at t=0.02s and secondary knock at t=0.38s
    slap = np.zeros(n_win)
    for t0, amp in [(0.02, 1.0), (0.36, 0.55)]:
        idx0 = int(t0 * SR)
        L = n_win - idx0
        tt = np.arange(L) / SR
        pane = (
            np.sin(2.0 * np.pi * 148.0 * tt) * np.exp(-tt * 24.0) * 0.75
            + np.sin(2.0 * np.pi * 390.0 * tt) * np.exp(-tt * 38.0) * 0.35
            + np.sin(2.0 * np.pi * 1120.0 * tt) * np.exp(-tt * 65.0) * 0.20
            + butter_filter(rng.standard_normal(L), (180, 1400), "bandpass", 2) * np.exp(-tt * 42.0) * 0.55
        )
        slap[idx0:] += pane * amp
    # Muffled snarl behind glass (lowpassed at 680 Hz)
    snarl_raw = wet_throat_layer(1.35, 112.0, 74.0, 0.65, 702)
    snarl_muffled = butter_filter(snarl_raw, 680.0, "lowpass", 3)
    win_mix = slap * 0.85
    win_mix[int(0.12 * SR):int(0.12 * SR) + snarl_muffled.size] += snarl_muffled * 0.78
    _, ogg_p, d = save_wav_and_ogg("zombie_window_grab", win_mix, target_dur=1.50)
    manifest.append({"file": "zombie_window_grab.wav", "speaker": "zombie", "text": "(coup contre la vitre et grognement étouffé)"})
    print(f"[Part B] zombie_window_grab.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 5. player_hurt_a.wav .. player_hurt_d.wav (0.4 - 0.6 s; a-b man, c-d woman)
    hurt_recipes = [
        ("player_hurt_a", "survivor_m", 0.48, 162.0, 118.0, [(560, 150, 1.0), (1350, 220, 0.72), (2500, 350, 0.32)], 801),
        ("player_hurt_b", "survivor_m", 0.54, 178.0, 126.0, [(620, 160, 1.0), (1420, 240, 0.75), (2650, 380, 0.35)], 802),
        ("player_hurt_c", "survivor_f", 0.46, 265.0, 198.0, [(680, 170, 1.0), (1680, 260, 0.78), (2950, 420, 0.40)], 803),
        ("player_hurt_d", "survivor_f", 0.52, 288.0, 212.0, [(740, 180, 1.0), (1790, 280, 0.80), (3100, 450, 0.42)], 804),
    ]
    for stem, spk, dur, f0a, f0b, fmts, seed in hurt_recipes:
        grunt = synth_human_grunt(dur * 0.78, f0a, f0b, fmts, roughness=0.32, breathiness=0.28, seed=seed)
        breath = synth_breath(dur * 0.28, intensity=0.26, sharp=True, seed=seed + 10)
        mix = concat_clauses([(grunt, -0.02), (breath, 0.0)])
        _, ogg_p, d = save_wav_and_ogg(stem, mix, target_dur=dur)
        manifest.append({"file": f"{stem}.wav", "speaker": spk, "text": "(cri court de douleur)"})
        print(f"[Part B] {stem}.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 6. player_down.wav (a gasp then a weak groan, 1.5 s)
    gasp = synth_breath(0.38, intensity=0.42, sharp=True, seed=901)
    weak_groan = synth_human_grunt(
        1.06, 148.0, 88.0,
        [(520, 140, 1.0), (1240, 220, 0.65), (2350, 320, 0.25)],
        roughness=0.45, breathiness=0.40, seed=902,
    )
    weak_groan = apply_vocal_tremor(weak_groan, depth_ms=1.8, rate_hz=5.5)
    down_mix = concat_clauses([(gasp, 0.06), (weak_groan, 0.0)])
    _, ogg_p, d = save_wav_and_ogg("player_down", down_mix, target_dur=1.50)
    manifest.append({"file": "player_down.wav", "speaker": "survivor", "text": "(suffocation puis gémissement faible)"})
    print(f"[Part B] player_down.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 7. player_revive.wav (a deep sharp breath, 1.0 s)
    inhale_deep = synth_breath(0.56, intensity=0.48, sharp=True, seed=910)
    exhale_relief = synth_human_grunt(
        0.38, 138.0, 112.0,
        [(490, 150, 0.8), (1320, 240, 0.55), (2450, 350, 0.25)],
        roughness=0.22, breathiness=0.55, seed=911,
    )
    rev_mix = concat_clauses([(inhale_deep, 0.05), (exhale_relief, 0.0)])
    _, ogg_p, d = save_wav_and_ogg("player_revive", rev_mix, target_dur=1.00)
    manifest.append({"file": "player_revive.wav", "speaker": "survivor", "text": "(grande inspiration brusque)"})
    print(f"[Part B] player_revive.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")

    # 8. pa_cut.wav (PA starts « Mesdames et messieurs, nous vous informons… » then cracks into static & distant screams, 3.0 s)
    pa_start = await tts_clause_to_array(
        "Mesdames et messieurs, nous vous informons...",
        VOICE_PA, "-2%", "+0Hz", tmp_dir, "pa_cut_start",
    )
    pa_start = enhance_pa(pa_start, panic=False)
    cut_len = min(pa_start.size, int(1.75 * SR))
    pa_start = pa_start[:cut_len]

    # Static crackle + distant panicked screams (1.35 s, overlapping last 0.10 s of speech)
    rng_sc = np.random.default_rng(950)
    n_tail = int(1.35 * SR)
    t_tail = np.arange(n_tail) / SR
    # Electrical crack bursts + band-limited intercom static
    crackle_env = (np.sin(2.0 * np.pi * 19.0 * t_tail) > -0.2).astype(np.float64)
    crackle_env *= np.exp(-t_tail * 0.45)
    static_noise = butter_filter(rng_sc.standard_normal(n_tail), (380, 3900), "bandpass", 3) * crackle_env * 0.55
    # High-pitched distant screams filtered through the intercom
    scream1 = synth_human_grunt(
        0.72, 410.0, 520.0,
        [(880, 220, 1.0), (2150, 340, 0.85), (3300, 480, 0.55)],
        roughness=0.55, breathiness=0.35, seed=951,
    )
    scream2 = synth_human_grunt(
        0.65, 340.0, 260.0,
        [(760, 200, 1.0), (1850, 300, 0.80), (2950, 420, 0.45)],
        roughness=0.60, breathiness=0.40, seed=952,
    )
    screams = np.zeros(n_tail)
    screams[int(0.08 * SR):int(0.08 * SR) + scream1.size] += scream1 * 0.48
    screams[int(0.45 * SR):int(0.45 * SR) + scream2.size] += scream2 * 0.42
    screams_muffled = butter_filter(screams, (450, 2800), "bandpass", 2)
    tail_mix = np.tanh((static_noise + screams_muffled) * 1.6)

    pa_cut_full = concat_clauses([(pa_start, -0.08), (tail_mix, 0.0)])
    _, ogg_p, d = save_wav_and_ogg("pa_cut", pa_cut_full, target_dur=3.00)
    manifest.append({
        "file": "pa_cut.wav",
        "speaker": "PA",
        "text": "Mesdames et messieurs, nous vous informons… (grésillements et cris lointains)",
    })
    print(f"[Part B] pa_cut.wav ({d:.2f}s) -> {ogg_p.stat().st_size / 1024:.1f} KB ogg")


async def main():
    SFX_DIR.mkdir(parents=True, exist_ok=True)
    WAV_OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    with tempfile.TemporaryDirectory() as td:
        tmp_dir = Path(td)
        await build_part_a(tmp_dir, manifest)
        await build_part_b(tmp_dir, manifest)

    manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (WAV_OUT_DIR / "manifest.json").write_text(manifest_json, encoding="utf-8")
    (SFX_DIR / "manifest.json").write_text(manifest_json, encoding="utf-8")
    print(f"\nGenerated {len(manifest)} WAV files in {WAV_OUT_DIR} and {len(manifest)} OGG files in {SFX_DIR}.")


if __name__ == "__main__":
    asyncio.run(main())
