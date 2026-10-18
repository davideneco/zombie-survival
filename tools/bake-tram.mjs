// Cuisson de la rame conduisible pour le port Godot (v0.17.3, docs/GODOT_PORT.md « Rame cuite ») : lance le vrai jeu dans Chrome (?debug) et lit
// carGeometries() / atlas('car') de src/hommedefer.js (les MÊMES maillages que le jeu JS : caisse par module avec nez, soufflets, bogies, pantographes,
// intérieur praticable, cabines, vantaux de portes) puis écrit
//   godot/assets/tram/car.bin        « TRM1 », u32 longueur du JSON, JSON, blobs float32 (non indexés, sens horaire : sommets 1 et 2 permutés, v d'UV retournée)
//   godot/assets/tram/car.json       modules ({ c, leaves, body, dark : { n, pos, nor, uv | col } }), sièges, portes, longueur, matériaux
//   godot/assets/tram/car_map.png    livrée (atlas 1024 x 512 : flanc, nez, fenêtres, embrasures de portes)
//   godot/assets/tram/car_emissive.png  son émissive (éclairage des portes, phares, girouette)
// Prérequis : le serveur de dev tourne (npm run dev), puis  node tools/bake-tram.mjs [url]     (navigateur : google-chrome-stable, ou CHROME)
// Les fichiers sont petits : versionnés (pas besoin de relancer la cuisson pour jouer). À relancer si hommedefer.js (carGeometries, atlas) change.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const PORT = process.env.CDP_PORT || 9347;
const OUT = path.join(ROOT, 'godot/assets/tram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.gdignore'), ''); // lus par FileAccess / Image.load_from_file, jamais importés par l'éditeur
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-baket-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=800,500', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 29 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 2000)); return r.result?.value; };
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };

const PAGE = `(async () => {
  const hdf = await import('/src/hommedefer.js'), cfg = await import('/src/config.js');
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
  const car = hdf.carGeometries(), A = hdf.atlas('car');
  const pack = (g, withColor) => {
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    const take = (a, k, flipV) => { const o = new Float32Array(n * k); for (let t = 0; t < n; t += 3) for (const [d, s] of [[0, 0], [1, 2], [2, 1]]) for (let c = 0; c < k; c++) { let v = a.array[(t + s) * k + c]; if (flipV && c === 1) v = 1 - v; o[(t + d) * k + c] = v; } return o; };
    const out = { n, pos: take(g.attributes.position, 3), nor: take(g.attributes.normal, 3) };
    if (withColor) out.col = take(g.attributes.color, 3); else out.uv = take(g.attributes.uv, 2, true);
    return out;
  };
  const mods = car.modules.map((m) => { const b = pack(m.body, false), d = pack(m.dark, true); const o = { c: m.c, leaves: m.leaves, body: { n: b.n }, dark: { n: d.n } }; return { o, blobs: { body: b, dark: d } }; });
  const blobs = mods.map((m) => { const r = {}; for (const part of ['body', 'dark']) for (const [k, arr] of Object.entries(m.blobs[part])) if (k !== 'n') r[part + '.' + k] = b64(new Uint8Array(arr.buffer)); return r; });
  const C = cfg.CONFIG.tram.car, T = hdf.HDF.tram;
  return {
    modules: mods.map((m) => m.o), blobs, seats: car.seats, doorsAt: car.doorsAt, L: car.L, windows: hdf.carWindowStarts(), doorStarts: hdf.carDoorStarts(),
    car: { modules: C.modules, module: C.module, doorWidth: C.doorWidth, hdfTram: T },
    mat: { body: { roughness: A.mat.roughness, metalness: A.mat.metalness, emissiveIntensity: A.mat.emissiveIntensity }, dark: { roughness: 0.6, metalness: 0.3, emissive: 0x16191d } },
    map: A.map.image.toDataURL('image/png').split(',')[1], emissive: A.emissive.image.toDataURL('image/png').split(',')[1],
  };
})()`;
try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1000);
  const res = await evaluate(PAGE);
  const blobs = []; let off = 0;
  res.modules.forEach((m, i) => {
    for (const part of ['body', 'dark']) {
      for (const k of part === 'body' ? ['pos', 'nor', 'uv'] : ['pos', 'nor', 'col']) {
        const b = Buffer.from(res.blobs[i][part + '.' + k], 'base64'); m[part][k] = off; blobs.push(b); off += b.length;
      }
    }
  });
  const meta = { modules: res.modules, seats: res.seats, doorsAt: res.doorsAt, L: res.L, windows: res.windows, doorStarts: res.doorStarts, car: res.car, mat: res.mat };
  fs.writeFileSync(path.join(OUT, 'car.json'), JSON.stringify(meta) + '\n');
  const head = Buffer.from(JSON.stringify({ modules: res.modules }), 'utf8'), pre = Buffer.alloc(8); pre.write('TRM1', 0); pre.writeUInt32LE(head.length, 4);
  fs.writeFileSync(path.join(OUT, 'car.bin'), Buffer.concat([pre, head, ...blobs]));
  fs.writeFileSync(path.join(OUT, 'car_map.png'), Buffer.from(res.map, 'base64'));
  fs.writeFileSync(path.join(OUT, 'car_emissive.png'), Buffer.from(res.emissive, 'base64'));
  console.log('car.bin', off, 'octets de blobs,', res.modules.length, 'modules,', res.modules.reduce((a, m) => a + m.body.n + m.dark.n, 0), 'sommets,', res.seats.length, 'sièges,', res.doorsAt.length, 'vantaux de porte');
  done(0);
} catch (e) { console.error(e); done(1); }
