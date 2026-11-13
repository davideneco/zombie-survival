// Audio render check, run through the play-test harness (nothing is heard : the sounds are rendered in an OfflineAudioContext and measured) :
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-render.js
// For each new sound or loop : peak (must stay <= 1.0), RMS, band powers (dB) and spectral peaks, so a silent, clipping or wrong-pitch sound shows up as a number.
// Everything is rendered in ONE offline context (Chromium stalls on the 4th OfflineAudioContext of a page) : each case is a time segment, started
// from a suspend() callback so the sounds are scheduled on the offline clock exactly like the game schedules them.
const { Sfx } = await import('/src/audio.js');
const { CONFIG } = await import('/src/config.js');
const SR = 44100, Q = 128;
const mono = (b) => { const l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l, m = new Float32Array(l.length); for (let i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) / 2; return m; };
function fft(re, im) { // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
const N = 8192;
function psd(d) { // averaged power spectrum (Hann, up to 60 frames spread over the signal)
  const P = new Float64Array(N / 2), frames = Math.max(1, Math.floor(d.length / N)), step = Math.max(1, Math.floor(frames / 60)); let used = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f += step) {
    for (let i = 0; i < N; i++) { re[i] = (d[f * N + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); im[i] = 0; }
    fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; used++;
  }
  for (let k = 0; k < N / 2; k++) P[k] /= used;
  return P;
}
const hz = (k) => k * SR / N;
const dB = (x) => Math.round(10 * Math.log10(x + 1e-20) * 10) / 10;
const band = (P, f0, f1) => { let s = 0; for (let k = 1; k < N / 2; k++) if (hz(k) >= f0 && hz(k) < f1) s += P[k]; return dB(s); };
const peakHz = (P) => { let b = 1; for (let k = 2; k < N / 2; k++) if (P[k] > P[b]) b = k; return Math.round(hz(b)); };
function stats(d, win = 0) { // d : mono Float32Array of one segment
  let peak = 0, sum = 0, nan = 0, clip = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a !== a) nan++; if (a > peak) peak = a; if (a >= 0.999) clip++; sum += d[i] * d[i]; }
  const P = psd(d), out = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), nan, clipped: clip, peakHz: peakHz(P), low: band(P, 20, 500), mid: band(P, 500, 2000), high: band(P, 2000, 8000) };
  if (win) { out.rmsWin = []; const w = Math.floor(SR * win); for (let s = 0; s + w <= d.length; s += w) { let e = 0; for (let i = s; i < s + w; i++) e += d[i] * d[i]; out.rmsWin.push(+Math.sqrt(e / w).toFixed(4)); } }
  return out;
}

// ---- the cases : seg(name, duration, setup(o) -> ctrl, tick(o, ctrl, t) every `every` s, stop(ctrl))
const segs = []; let T = 1;
const seg = (name, dur, setup, tick, every = 2, stop) => { segs.push({ name, t0: T, dur, setup, tick, every, stop }); T += dur + 2.5; };
for (const surf of ['stone', 'wood', 'metal', 'concrete']) seg('step ' + surf, 0.7, (o) => o.step(surf, 1));
seg('step sprint stone x1.35', 0.7, (o) => o.step('stone', 1.35));
seg('tramBell x3', 1.6, (o) => o.tramBell(1, 3));
seg('tramDoors open', 2.2, (o) => o.tramDoors(true, 1));
seg('tramDoors close', 2.4, (o) => o.tramDoors(false, 1));
seg(`crossingDing doppler 1.087 (approaching 30 m/s, base ${CONFIG.audio.crossing.freq} Hz)`, 0.5, (o) => o.crossingDing(1, 1.087));
seg('crossingDing doppler 0.92 (receding)', 0.5, (o) => o.crossingDing(1, 0.92));
seg('bridgeRumble 3 s', 4.5, (o) => o.bridgeRumble(1, 3));
for (const gust of [0, 1]) seg('trainSound 22 m/s gust ' + gust, 5, (o) => { const t = o.createTrainSound(); t.set(22, 0, 0.9, gust); return t; }, (o, t) => t.set(22, 0, 0.9, gust), 1, (t) => t.stop());
const city = (name, night, zone) => seg(name, 70, (o) => { const a = o.createCityAmbience(); a.start(); return a; }, (o, a, t) => a.update(night, zone, 11.5 + (t - 0) / 40, 1), 2, (a) => a.stop());
city('city night zone5', 1, 5); city('city day zone5', 0, 5); city('city night zone8 (cathedral interior)', 1, 8); city('city muted (zone -1)', 1, -1);
const stn = (name, zone, night) => seg(name, 70, (o) => { const a = o.createStationAmbience(); a.start(); return a; }, (o, a, t) => a.update(zone, night, 1), 2, (a) => a.stop());
stn('station hall day', 'Hall de la Gare', 0); stn('station quais night', 'Quais', 1); stn('station muted (null)', null, 0);

const secs = T + 1, off = new OfflineAudioContext(2, Math.ceil(secs * SR / Q) * Q, SR), o = Object.create(Sfx.prototype);
o.ctx = off; o.volume = 1; o.musicVolume = 0; o.mood = { intensity: 0.3, muffled: false }; o._build(off); o.music.setVolume(0);
const jobs = new Map(), qt = (t) => Math.round(t * SR / Q) * Q / SR, at = (t, fn) => { const k = qt(t); if (!jobs.has(k)) jobs.set(k, []); jobs.get(k).push(fn); };
for (const s of segs) {
  at(s.t0, () => { s.ctrl = s.setup(o); });
  if (s.tick) for (let t = s.every; t < s.dur; t += s.every) at(s.t0 + t, () => s.tick(o, s.ctrl, t));
  if (s.stop) at(s.t0 + s.dur, () => s.stop(s.ctrl));
}
for (const [k, fns] of [...jobs.entries()].sort((a, b) => a[0] - b[0])) off.suspend(k).then(() => { for (const f of fns) f(); off.resume(); });
const d = mono(await off.startRendering());
const R = segs.map((s) => {
  const a = Math.floor(s.t0 * SR), b = Math.min(d.length, Math.floor((s.t0 + s.dur + 2) * SR)), v = stats(d.subarray(a, b), s.dur > 20 ? 5 : 0);
  return `${s.name}: pk ${v.peak} rms ${v.rms} clip ${v.clipped} nan ${v.nan} @${v.peakHz}Hz L/M/H ${v.low}/${v.mid}/${v.high} dB${v.rmsWin ? ' win ' + v.rmsWin.join(',') : ''}`;
});
R.push('overall peak ' + stats(d).peak);
return R; // (compact lines : the harness cuts its output at 4000 characters)
