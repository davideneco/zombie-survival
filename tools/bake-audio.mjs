// Cuisson de l'audio pour le port Godot (J8, docs/GODOT_PORT.md § 3.4) : exécute le VRAI src/audio.js et src/music.js dans Chrome avec un OfflineAudioContext
// et écrit
//   godot/assets/audio/sfx/<nom>_<n>.wav        un rendu « sec » par variante (mono 16 bits 44,1 kHz, fin silencieuse rognée)
//   godot/assets/audio/sfx/<nom>_<n>_send.wav   la part envoyée à la réverbération (refaite par le bus « Réverbération » de Godot), si elle est audible
//   godot/assets/audio/sfx/engine_*.wav         boucles de moteur (moto, grosse moto, tram) : le régime se règle par pitch_scale
//   godot/assets/audio/music/music_<niveau>.ogg boucles de 16 mesures par niveau d'intensité (calme, rythmé, dur, à fond), réverbération incluse
//   godot/data/audio.json                       manifeste : fichiers, durées, correction de gain, armes -> rechargement, moteurs, musique
// Le rendu est aléatoire (bruit, hauteur, décalages) comme dans le jeu : deux cuissons ne donnent pas les mêmes octets.
// Prérequis : google-chrome-stable (ou CHROME), ffmpeg avec libvorbis pour la musique.   Usage : node tools/bake-audio.mjs [nom-ou-préfixe …]
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { soundList, ENGINES, MUSIC_LEVELS, MUSIC_BARS } from './audio-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SFX_DIR = path.join(ROOT, 'godot/assets/audio/sfx'), MUSIC_DIR = path.join(ROOT, 'godot/assets/audio/music');
const RATE = 44100, TRIM = 0.002, PEAK = 0.98, SEND_MIN = 0.01;
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.some((p) => n.startsWith(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SFX_DIR, { recursive: true }); fs.mkdirSync(MUSIC_DIR, { recursive: true });

// ---- serveur statique minimal (modules ES du jeu + page de cuisson)
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u === '/' ? path.join(ROOT, 'tools/bake-audio.page.html') : path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/`;

// ---- Chrome (CDP)
const PORT = process.env.CDP_PORT || 9344;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-bakea-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', ['--headless=new', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const done = (code) => { try { chrome.kill(); } catch {} try { server.close(); } catch {} process.exit(code); };
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 29 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500)); return r.result?.value; };
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

function wavBuffer(channels, samples) { // channels : tableau de Float32Array (même longueur) ; 16 bits entrelacés
  const n = samples, nc = channels.length, buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), 44 + (i * nc + c) * 2);
  return buf;
}
const peakOf = (a) => { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
const trimEnd = (a) => { let n = a.length; while (n > 1 && Math.abs(a[n - 1]) < TRIM) n--; return Math.min(a.length, n + 441); };

const manifest = fs.existsSync(path.join(ROOT, 'godot/data/audio.json')) && only.length ? JSON.parse(fs.readFileSync(path.join(ROOT, 'godot/data/audio.json'), 'utf8')) : { rate: RATE, sounds: {}, reloads: {}, engines: {}, music: {} };
const { list, reloads } = soundList();
manifest.reloads = Object.fromEntries(Object.entries(list.length ? Object.entries(reloads) : []).map(([name, id]) => [name, id]));
// armes -> son de rechargement (toutes les armes partageant (catégorie, durée) partagent le son)
const { CONFIG } = await import('../src/config.js');
manifest.weaponReload = Object.fromEntries(Object.entries(CONFIG.weapons).map(([id, w]) => [id, `reload_${w.cat}_${String(w.reloadTime).replace('.', 'p')}`]));
delete manifest.reloads;

try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  for (let i = 0; i < 60 && (await evaluate('window.bakeReady === true')) !== true; i++) await sleep(500);
  if ((await evaluate('window.bakeReady === true')) !== true) throw new Error('page de cuisson non chargée');

  let total = 0;
  for (const s of list) {
    if (!want(s.name)) continue;
    const entry = { files: [], send: [], dur: [], gain_db: 0 };
    const renders = [];
    let peak = 0;
    for (let v = 0; v < s.variants; v++) {
      const r = await evaluate(`renderSfx(${JSON.stringify(s.call)}, ${JSON.stringify(s.args)}, ${s.dur})`);
      const dry = f32(r.dry), send = f32(r.send);
      renders.push({ dry, send });
      peak = Math.max(peak, peakOf(dry), peakOf(send));
    }
    const k = peak > PEAK ? PEAK / peak : 1;   // jamais d'écrêtage : le gain perdu est rendu par volume_db côté Godot
    entry.gain_db = k < 1 ? +(-20 * Math.log10(k)).toFixed(3) : 0;
    renders.forEach(({ dry, send }, v) => {
      const n = trimEnd(dry), d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = dry[i] * k * (i > n - 441 ? Math.max(0, (n - i) / 441) : 1);
      fs.writeFileSync(path.join(SFX_DIR, `${s.name}_${v}.wav`), wavBuffer([d], n));
      entry.files.push(`${s.name}_${v}.wav`); entry.dur.push(+(n / RATE).toFixed(4)); total += n;
      if (peakOf(send) * k > SEND_MIN) {
        const m = trimEnd(send), q = new Float32Array(m);
        for (let i = 0; i < m; i++) q[i] = send[i] * k * (i > m - 441 ? Math.max(0, (m - i) / 441) : 1);
        fs.writeFileSync(path.join(SFX_DIR, `${s.name}_${v}_send.wav`), wavBuffer([q], m));
        entry.send.push(`${s.name}_${v}_send.wav`);
      } else entry.send.push(null);
    });
    manifest.sounds[s.name] = entry;
    console.log(s.name.padEnd(26), entry.files.length, 'x', entry.dur.map((d) => d.toFixed(2)).join('/'), 's', entry.gain_db ? `gain +${entry.gain_db} dB` : '', entry.send.some(Boolean) ? 'envoi réverbération' : '');
  }

  for (const e of ENGINES) {
    if (!want(e.name)) continue;
    const r = await evaluate(`renderEngine(${JSON.stringify(e.create)}, ${JSON.stringify(e.kind)}, ${JSON.stringify(e)}, 4)`);
    const a = f32(r.dry), start = Math.round(0.8 * RATE), L = Math.round(3 * RATE), N = Math.round(0.3 * RATE);
    const out = new Float32Array(L - N);
    for (let i = 0; i < L - N; i++) {
      const x = a[start + i];
      out[i] = i >= N ? x : x * Math.sin(Math.PI / 2 * i / N) + a[start + L - N + i] * Math.cos(Math.PI / 2 * i / N);
    }
    const p = peakOf(out), k = p > PEAK ? PEAK / p : 1;
    for (let i = 0; i < out.length; i++) out[i] *= k;
    fs.writeFileSync(path.join(SFX_DIR, `${e.name}.wav`), wavBuffer([out], out.length));
    manifest.engines[e.name] = { file: `${e.name}.wav`, kind: e.kind, rpm: e.rpm ?? null, ratio: e.ratio, throttle: e.throttle, gain_db: k < 1 ? +(-20 * Math.log10(k)).toFixed(3) : 0, dur: +(out.length / RATE).toFixed(3) };
    console.log(e.name.padEnd(26), (out.length / RATE).toFixed(2), 's boucle, pic', p.toFixed(2));
  }

  for (const m of MUSIC_LEVELS) {
    if (!want(`music_${m.level}`)) continue;
    const r = await evaluate(`renderMusic(${JSON.stringify(m)}, ${MUSIC_BARS})`);
    const L = f32(r.l), R = f32(r.r), t0 = Math.round(r.t0 * RATE), N = Math.round(r.loop * RATE);
    const o = [new Float32Array(N), new Float32Array(N)];
    for (let c = 0; c < 2; c++) { // la fin (queue de réverbération, notes tenues) se replie sur le début : la boucle est continue
      const src = c ? R : L;
      for (let i = 0; i < N; i++) o[c][i] = src[t0 + i] + (t0 + N + i < src.length ? src[t0 + N + i] : 0);
    }
    const p = Math.max(peakOf(o[0]), peakOf(o[1])), k = p > PEAK ? PEAK / p : 1;
    for (const ch of o) for (let i = 0; i < N; i++) ch[i] *= k;
    const tmp = path.join(os.tmpdir(), `music_${m.level}.wav`);
    fs.writeFileSync(tmp, wavBuffer(o, N));
    const out = path.join(MUSIC_DIR, `music_${m.level}.ogg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '4', out]);
    fs.unlinkSync(tmp);
    manifest.music[m.level] = { file: `music_${m.level}.ogg`, bpm: +r.bpm.toFixed(2), level: r.level, bars: MUSIC_BARS, loop: +(N / RATE).toFixed(4), gain_db: k < 1 ? +(-20 * Math.log10(k)).toFixed(3) : 0, bytes: fs.statSync(out).size };
    console.log(`music_${m.level}`.padEnd(26), (N / RATE).toFixed(2), 's,', r.bpm.toFixed(1), 'bpm, niveau', r.level, ',', (fs.statSync(out).size / 1024).toFixed(0), 'Ko, pic', p.toFixed(2));
  }
  fs.writeFileSync(path.join(ROOT, 'godot/data/audio.json'), JSON.stringify(manifest, null, 1));
  console.log('audio.json :', Object.keys(manifest.sounds).length, 'sons,', Object.keys(manifest.engines).length, 'moteurs,', Object.keys(manifest.music).length, 'musiques');
  done(0);
} catch (e) { console.error(e); done(1); }
