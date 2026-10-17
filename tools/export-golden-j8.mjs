// J8 : valeurs de référence calculées par le JS pour les tests headless de l'audio du port Godot : godot/data/golden/j8.json.
// Le VRAI src/audio.js et src/music.js s'exécutent avec un faux contexte WebAudio qui enregistre ce qu'ils programment (aucun son n'est rendu ici) :
//   sounds  : pour chaque son de tools/audio-list.mjs, les sons de base programmés (_tone / _noise : type, fréquences, durée, volume, retard) et la durée
//             attendue (max retard + durée) ; la cuisson (tools/bake-audio.mjs) rend ces mêmes appels dans Chrome, le test Godot relit les WAV et compare
//   music   : niveau et tempo choisis par Music._beginBar pour une grille d'intensités (avec et sans accalmie) ; intensité de updateMusicMood (main.js)
//   engines : fréquence de la première oscillation et gain de sortie de createEngine / createTramEngine pour une grille de régimes
//   mix     : réglages de la chaîne (_build) : gain du bus, compresseur, limiteur, réverbération
// Usage : node tools/export-golden-j8.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sfx } from '../src/audio.js';
import { Music } from '../src/music.js';
import { soundList, ENGINES } from './audio-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- faux contexte : tout nœud est un objet dont les paramètres enregistrent leurs appels
function makeParam(v = 0) {
  const p = { value: v, calls: [] };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) p[m] = (...a) => { p.calls.push([m, ...a]); return p; };
  return p;
}
function makeCtx() {
  const nodes = [];
  const ctx = { currentTime: 0, sampleRate: 44100, destination: {}, nodes };
  const mk = (type, params = {}) => () => {
    const n = { kind: type, connect: (d) => d || n, disconnect() {}, start() {}, stop() {}, params: {} };
    for (const [k, v] of Object.entries(params)) { n[k] = makeParam(v); }
    nodes.push(n);
    return n;
  };
  ctx.createGain = mk('gain', { gain: 1 });
  ctx.createOscillator = mk('osc', { frequency: 440, detune: 0 });
  ctx.createBiquadFilter = mk('biquad', { frequency: 350, Q: 1, gain: 0 });
  ctx.createDynamicsCompressor = mk('comp', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  ctx.createConvolver = mk('conv');
  ctx.createWaveShaper = mk('shaper');
  ctx.createBufferSource = mk('src');
  ctx.createStereoPanner = mk('pan', { pan: 0 });
  ctx.createDelay = mk('delay', { delayTime: 0 });
  ctx.createBuffer = (nc, len) => ({ getChannelData: () => new Float32Array(Math.min(len, 8)), length: len });
  return ctx;
}
const round = (v) => Math.round(v * 1e6) / 1e6;

// ---- sons
const { list } = soundList();
const sounds = {};
for (const s of list) {
  const sfx = new Sfx();
  sfx.ctx = makeCtx();
  sfx.noiseBuf = {};
  sfx.bus = {}; sfx.verbIn = {}; sfx.dist = {};
  const calls = [];
  sfx._tone = (type, f0, f1, dur, vol, o = {}) => { if (vol >= 0.002) calls.push({ k: 'tone', type, f0, f1, dur, vol: round(vol), at: o.at || 0, send: o.send || 0, atk: o.atk ?? 0.002 }); };
  sfx._noise = (dur, vol, freq, type = 'lowpass', o = {}) => { if (vol >= 0.002) calls.push({ k: 'noise', type, f0: freq, f1: o.f1 ?? null, dur, vol: round(vol), at: o.at || 0, send: o.send || 0 }); };
  let direct = null;   // sons faits de nœuds bruts (non enregistrés ci-dessus) : durée connue du code
  if (s.call === 'gun' && s.args[0] === 'raygun') direct = 0.34;
  if (s.call === 'groan') direct = null;
  try { sfx[s.call](...s.args); } catch (e) { if (direct === null && s.call !== 'groan') throw e; }
  const exp = calls.length ? Math.max(...calls.map((c) => c.at + c.dur)) : null;
  sounds[s.name] = { call: s.call, expected: direct ?? exp, direct: direct !== null || s.call === 'groan', calls };
}
sounds.groan.expected = null;   // durée tirée au hasard entre 0,9 et 1,5 s (+ souffle)
sounds.groan.range = [0.9, 1.6];

// ---- musique
const mctx = makeCtx();
const music = new Music(mctx, mctx.createGain(), { noise: {} });
const musicGrid = [];
for (const lull of [false, true]) {
  for (const x of [0, 0.05, 0.1, 0.119, 0.12, 0.3, 0.449, 0.45, 0.6, 0.749, 0.75, 0.85, 1]) {
    music.lull = lull; music.intensity = x; music.nextTime = 0; music._beginBar();
    musicGrid.push({ lull, intensity: x, level: music.level, bpm: round(music.bpm), step: round(music.stepDur) });
  }
}
// main.js updateMusicMood : intensité de la partie selon la manche, la finale, le menu
const mood = [];
for (const [inGame, finale, round_] of [[false, false, 0], [true, false, 1], [true, false, 2], [true, false, 5], [true, false, 8], [true, false, 10], [true, false, 11], [true, false, 20], [true, true, 12]]) {
  mood.push({ inGame, finale, round: round_, intensity: !inGame ? 0.3 : finale ? 1 : Math.min(0.85, 0.3 + round_ * 0.05) });
}

// ---- moteurs
const engines = {};
for (const e of ENGINES) {
  const grid = [];
  const rpms = e.create === 'createEngine' ? [0.15, 0.3, 0.5, 0.75, 1] : [0, 0.25, 0.5, 0.75, 1];
  for (const r of rpms) for (const th of [-1, 0, 0.5, 1]) {
    const sfx = new Sfx(); sfx.ctx = makeCtx(); sfx.noiseBuf = {}; sfx.bus = {};
    const eng = e.create === 'createEngine' ? sfx.createEngine(e.kind) : sfx.createTramEngine();
    const osc1 = sfx.ctx.nodes.find((n) => n.kind === 'osc'), outGain = sfx.ctx.nodes.find((n) => n.kind === 'gain');
    if (e.create === 'createEngine') eng.set(r, th, 0.3, 1); else eng.set(r, th, 1);
    const last = (p, m) => { const c = p.calls.filter((x) => x[0] === m).pop(); return c ? c[1] : null; };
    grid.push({ rpm: r, throttle: th, freq: round(last(osc1.frequency, 'setTargetAtTime')), gain: round(last(outGain.gain, 'setTargetAtTime')) });
  }
  engines[e.name] = { kind: e.kind, grid, bake: { rpm: e.rpm ?? null, ratio: e.ratio, throttle: e.throttle } };
}

// ---- chaîne de mixage
const bctx = makeCtx();
const bsfx = new Sfx(); bsfx.ctx = bctx; bsfx._build(bctx);
const comps = bctx.nodes.filter((n) => n.kind === 'comp');
const gains = bctx.nodes.filter((n) => n.kind === 'gain');
const mix = {
  limiter: { threshold: comps[0].threshold.value, knee: comps[0].knee.value, ratio: comps[0].ratio.value, attack: comps[0].attack.value, release: comps[0].release.value },
  comp: { threshold: comps[1].threshold.value, knee: comps[1].knee.value, ratio: comps[1].ratio.value, attack: comps[1].attack.value, release: comps[1].release.value },
  bus: bsfx.bus.gain.value, master: bsfx.master.gain.value, verbOut: gains[2].gain.value,
  musicDefault: bsfx.musicVolume, muffle: { freq: 650, duck: 0.55 },
};
const muffled = new Music(makeCtx(), makeCtx().createGain(), { noise: {} });
muffled.setMuffled(true);
mix.muffle = { freq: muffled.lp.frequency.calls.pop()[1], duck: muffled.duck.gain.calls.pop()[1] };
mix.lowpassOpen = (() => { muffled.setMuffled(false); return muffled.lp.frequency.calls.pop()[1]; })();

fs.mkdirSync(path.join(ROOT, 'godot/data/golden'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'godot/data/golden/j8.json'), JSON.stringify({ sounds, music: musicGrid, mood, engines, mix }));
console.log('j8.json :', Object.keys(sounds).length, 'sons,', musicGrid.length, 'cas de musique,', Object.keys(engines).length, 'moteurs');
