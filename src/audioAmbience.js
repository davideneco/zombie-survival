// Ambience loops of the procedural audio (city and station) : persistent oscillator / noise graphs driven by a few AudioParams, plus
// random one-shots (dogs, bells, pigeons, announcements) scheduled on the audio clock from update(). Built by Sfx.createCityAmbience /
// createStationAmbience (audio.js). Levels, intervals and ranges : CONFIG.audio. Nothing is allocated per frame : update() only sets
// AudioParam targets and compares times ; every source is stopped by stop() and the graph is disconnected when the last one ends.
import { CONFIG } from './config.js';
import { rnd, clamp } from './dsp.js';

// shared helpers on a context : noise source through a filter, LFO (oscillator -> gain -> target param), looping oscillator
function kit(sfx, srcs) {
  const c = sfx.ctx;
  return {
    noise(type, f, q) {
      const s = c.createBufferSource(), fl = c.createBiquadFilter();
      s.buffer = sfx.noiseBuf; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      s.connect(fl); s.start(0, Math.random() * 1.5); srcs.push(s);
      return fl;
    },
    lfo(hz, depth, target) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = hz; g.gain.value = depth; o.connect(g).connect(target); o.start(); srcs.push(o);
      return o;
    },
    osc(type, f) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); srcs.push(o); return o; },
    gain(v, to) { const g = c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; },
  };
}

// stops every source after `tail` s of fade, disconnects the output when the last one ends (no node left in the graph)
function teardown(c, out, srcs, tail) {
  const t = c.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setTargetAtTime(0, t, tail / 4);
  srcs.forEach((s, i) => {
    s.stop(t + tail);
    if (i === srcs.length - 1) s.onended = () => { try { out.disconnect(); } catch { /* already gone */ } };
  });
}

// ------------------------------------------------------------------ city : wind, crickets at night, far dogs, far bells
export function buildCity(sfx) {
  const c = sfx.ctx, A = CONFIG.audio.city, M = CONFIG.audio.mix, srcs = [], K = kit(sfx, srcs);
  const out = K.gain(0, sfx.bus);
  // wind : a low howl and a mid whoosh, each slowly swelling (LFO on a gain that sits before the level gain) ; the howl's cutoff drifts
  const windG = K.gain(0, out);
  const howl = K.noise('lowpass', 360, 0.8), howlMod = K.gain(1, windG);
  howl.connect(howlMod); K.lfo(0.083, 0.45, howlMod.gain); K.lfo(0.047, 110, howl.frequency);
  const whoosh = K.noise('bandpass', 950, 0.5), whooshMod = K.gain(0.5, windG);
  whoosh.connect(whooshMod); K.lfo(0.061, 0.4, whooshMod.gain); K.lfo(0.037, 260, whoosh.frequency);
  // crickets : a sine carrier gated by two LFOs (a fast trill inside a slow chirp rhythm), two voices slightly detuned
  const crickG = K.gain(0, out);
  for (const [f, fast, slow] of [[4300, 24, 1.7], [3850, 21, 1.3]]) {
    const o = K.osc('sine', f), a = K.gain(0.5), b = K.gain(0.5);
    K.lfo(fast, 0.5, a.gain); K.lfo(slow, 0.5, b.gain);
    o.connect(a).connect(b).connect(crickG);
  }
  crickG.gain.value = 0;
  // far sounds (dogs, bells) share a lowpass : distance muffles them
  // (farG follows the zone : inside the cathedral the dogs and the bells are muffled by the walls)
  const farG = K.gain(1, out), far = c.createBiquadFilter(); far.type = 'lowpass'; far.frequency.value = 1300; far.Q.value = 0.5; far.connect(farG);
  const st = { nextDog: c.currentTime + rnd(...A.dog.every), lastHour: -1, level: 0 };

  const bark = (at, v, f0) => { // one bark : saw voice dropping in pitch through two vowel formants, plus a breath of noise
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain(), fa = c.createBiquadFilter(), fb = c.createBiquadFilter(), rv = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.17);
    fa.type = 'bandpass'; fa.frequency.value = 650; fa.Q.value = 3; fb.type = 'bandpass'; fb.frequency.value = 1500; fb.Q.value = 4;
    o.connect(fa).connect(g); o.connect(fb).connect(g);
    sfx._env(g, t, 0.012, v, 0.22);
    rv.gain.value = 0.5; g.connect(far); g.connect(rv).connect(sfx.verbIn);
    o.start(t); o.stop(t + 0.26);
    sfx._noise(0.1, v * 0.35, 1200, 'bandpass', { at, q: 1, out: far });
  };
  const ringBell = (strokes) => { // far cathedral bell : a few partials, strokes `gap` s apart, through the distance lowpass
    const B = A.bell;
    for (let i = 0; i < strokes; i++) {
      const at = i * B.gap, v = B.vol * (1 - 0.04 * i);
      sfx._tone('sine', 196, 194, 3.2, v, { at, send: 0.8, out: far });
      sfx._tone('sine', 394, 391, 2.2, v * 0.4, { at, send: 0.8, out: far });
      sfx._tone('sine', 590, 586, 1.4, v * 0.18, { at, send: 0.8, out: far });
      sfx._tone('triangle', 98, 97, 3.4, v * 0.5, { at, send: 0.8, out: far });
    }
  };

  return {
    // night 0..1, zoneIndex (< 0 : silent, e.g. in the station), hour of the game clock (< 0 : unknown), level multiplier
    update(night, zoneIndex, hour = -1, mul = 1) {
      const t = c.currentTime, on = zoneIndex >= 0, zm = on ? (A.zoneWind[zoneIndex] ?? 1) : 0, tc = M.fade / 3;
      st.level = on ? mul * M.city : 0;
      out.gain.setTargetAtTime(st.level, t, tc);
      farG.gain.setTargetAtTime(Math.min(1, zm), t, 0.5);
      windG.gain.setTargetAtTime((A.windDay + (A.windNight - A.windDay) * night) * zm, t, 0.6);
      crickG.gain.setTargetAtTime(A.crickets * clamp((night - 0.55) * 2.2, 0, 1) * (zm > 0.5 ? 1 : 0.3), t, 1.2);
      if (!on || st.level < 0.02) { st.lastHour = -1; return; }
      if (t >= st.nextDog) { // a barking session : 2 to 4 barks by one far dog, mostly at night
        st.nextDog = t + rnd(...A.dog.every);
        if (Math.random() < A.dog.dayChance + (1 - A.dog.dayChance) * night) {
          const n = 2 + Math.floor(Math.random() * 3), f0 = rnd(300, 480);
          for (let i = 0; i < n; i++) bark(i * rnd(0.3, 0.42), A.dog.vol * rnd(0.7, 1), f0 * rnd(0.95, 1.05));
        }
      }
      if (hour >= 0) {
        const h = Math.floor(hour);
        if (h !== st.lastHour) {
          if (st.lastHour >= 0 && A.bell.hours.includes(h)) ringBell(Math.min(A.bell.maxStrokes, ((h + 11) % 12) + 1));
          st.lastHour = h;
        }
      }
    },
    stop() { teardown(c, out, srcs, 1.2); },
  };
}

// ------------------------------------------------------------------ station : room tone, hall echo, distant announcements, pigeons
export function buildStation(sfx) {
  const c = sfx.ctx, A = CONFIG.audio.station, M = CONFIG.audio.mix, srcs = [], K = kit(sfx, srcs);
  const out = K.gain(0, sfx.bus);
  // everything that should echo in the hall goes into `inp` : dry to out, and through a damped feedback delay
  const inp = K.gain(1, out);
  const send = K.gain(A.echo.mix, null), delay = c.createDelay(1), lp = c.createBiquadFilter(), fb = K.gain(A.echo.feedback, null);
  delay.delayTime.value = A.echo.time; lp.type = 'lowpass'; lp.frequency.value = 2400;
  inp.connect(send).connect(delay).connect(lp); lp.connect(fb).connect(delay); lp.connect(out);
  // room tone : dark rumble of the hall, a ventilation hum (100 Hz and a weak third), wind along the platforms
  const roomG = K.gain(A.room, out);
  K.noise('lowpass', 240, 0.7).connect(roomG);
  const hum = K.gain(A.room * 0.12, out); K.osc('sine', 100).connect(hum); K.osc('sine', 300).connect(K.gain(0.3, hum));
  const windG = K.gain(0, out), wf = K.noise('bandpass', 650, 0.6), wMod = K.gain(1, windG);
  wf.connect(wMod); K.lfo(0.09, 0.45, wMod.gain); K.lfo(0.05, 150, wf.frequency);
  // announcer : a sawtooth voice (vibrato) through three vowel formants, gated by a syllable LFO, with a little static ; the phrase envelope
  // and the vowel drift are scheduled on the persistent chain (no node per phrase)
  const voiceG = K.gain(0, inp), gate = K.gain(0.55, voiceG);
  const vo = K.osc('sawtooth', 118);
  K.lfo(5.4, 4, vo.frequency); K.lfo(3.9, 0.45, gate.gain);
  const forms = [[520, 6, 1], [1450, 8, 0.7], [2500, 8, 0.35]].map(([f, q, g]) => {
    const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
    vo.connect(b).connect(K.gain(g, gate)); return b;
  });
  K.noise('bandpass', 1800, 1.2).connect(K.gain(0.08, gate));
  const st = { nextVoice: c.currentTime + rnd(6, 14), nextBird: c.currentTime + rnd(2, 6), level: 0 };

  const phrase = (dur) => {
    const t = c.currentTime + 0.05, V = A.voice, base = rnd(105, 135);
    sfx._tone('sine', 659, 659, 0.9, V.chime, { atk: 0.01, send: 0.4, out: inp });
    sfx._tone('sine', 523, 523, 1.2, V.chime, { at: 0.42, atk: 0.01, send: 0.4, out: inp });
    const t0 = t + 1.3, n = Math.max(3, Math.round(dur * 2));
    voiceG.gain.cancelScheduledValues(t);
    voiceG.gain.setValueAtTime(0, t0 - 0.05);
    voiceG.gain.linearRampToValueAtTime(V.vol, t0 + 0.2);
    voiceG.gain.setValueAtTime(V.vol, t0 + dur);
    voiceG.gain.setTargetAtTime(0, t0 + dur, 0.12);
    for (let i = 0; i < n; i++) { // the vowels and the pitch wander phrase-wise
      const ti = t0 + (i * dur) / n;
      vo.frequency.setTargetAtTime(base * rnd(0.85, 1.2) * (1 - 0.1 * (i / n)), ti, 0.08);
      forms[0].frequency.setTargetAtTime(rnd(420, 720), ti, 0.07);
      forms[1].frequency.setTargetAtTime(rnd(1100, 1900), ti, 0.07);
    }
  };
  const coo = (v) => { // "rou-ku-kouou" : three falling notes with a soft octave, and sometimes a clatter of wings
    for (const [at, f, d] of [[0, 430, 0.17], [0.21, 470, 0.14], [0.42, 390, 0.42]]) {
      sfx._tone('sine', f, f * 0.78, d, v, { at, atk: 0.03, out: inp, send: 0.25 });
      sfx._tone('sine', f * 2, f * 1.5, d, v * 0.25, { at, atk: 0.03, out: inp });
    }
    if (Math.random() < 0.3) for (let i = 0; i < 6; i++) sfx._noise(0.045, v * 0.9, 1700, 'bandpass', { at: 1.1 + i * 0.075, q: 0.9, out: inp });
  };

  return {
    // zoneName : a key of CONFIG.audio.station.zoneMul (null : silent, not in the station), night 0..1, level multiplier
    update(zoneName, night, mul = 1) {
      const t = c.currentTime, zm = zoneName ? (A.zoneMul[zoneName] ?? 0.6) : 0, tc = M.fade / 3;
      st.level = zm * mul * M.station;
      out.gain.setTargetAtTime(st.level, t, tc);
      windG.gain.setTargetAtTime(zoneName === 'Quais' ? A.wind : A.wind * 0.25, t, 0.8);
      if (st.level < 0.02) return;
      if (t >= st.nextVoice) { const d = rnd(...A.voice.dur); st.nextVoice = t + rnd(...A.voice.every) + d; phrase(d); }
      if (t >= st.nextBird) {
        st.nextBird = t + rnd(...A.pigeon.every);
        if (Math.random() < A.pigeon.nightChance + (1 - A.pigeon.nightChance) * (1 - night)) coo(A.pigeon.vol * rnd(0.7, 1));
      }
    },
    stop() { teardown(c, out, srcs, 1.2); },
  };
}
