// Cuisson du monde de Strasbourg pour le port Godot (J2, docs/GODOT_PORT.md § J2, D2) :
// lance le vrai jeu dans Chrome (?debug), exécute tools/bake-world.page.js dans la page, récupère les fichiers produits et les écrit dans
//   godot/data/world/   collision, étages, grilles de navigation (gzip), zones, portes, fenêtres, objets, tuiles de géométrie, golden_j2.json
//   godot/assets/baked/ textures dessinées sur canevas (PNG) ; godot/assets/textures/ copie des textures PBR de public/textures
// Prérequis : le serveur de dev tourne (npm run dev), puis  node tools/bake-world.mjs [url]
//   url par défaut : http://localhost:5173/   (navigateur : google-chrome-stable, ou variable CHROME)
// Le monde vient d'un tirage graine fixe (seeded(20240611)) : deux cuissons donnent les mêmes fichiers (hors l'ordre des textures canevas).
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { installNoDecor, CHECK_NO_DECOR } from './bake-nodecor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const OUT = path.join(ROOT, 'godot/data/world'), BAKED = path.join(ROOT, 'godot/assets/baked'), TEX = path.join(ROOT, 'godot/assets/textures');
const PORT = process.env.CDP_PORT || 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-bake-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=800,500', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 30 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 2000)); return r.result?.value; };
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };
try {
  await call('Runtime.enable');
  // v0.17.0 : sans les rames de décor (une seule rame : la conduisible) ; NODECOR=0 pour refaire la cuisson d'origine
  const patched = process.env.NODECOR === '0' ? null : await installNoDecor(ws, call);
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1500);
  if (patched) { const c = await evaluate(CHECK_NO_DECOR); if (patched() < 1 || c.decor !== 0 || c.trams !== 0) throw new Error('rames de décor encore présentes : ' + JSON.stringify(c)); console.log('rames de décor neutralisées :', JSON.stringify(c)); }
  console.log('jeu chargé, cuisson dans la page…');
  const t0 = Date.now();
  const summary = await evaluate(fs.readFileSync(path.join(ROOT, 'tools/bake-world.page.js'), 'utf8'));
  console.log(`cuisson page : ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(summary.stats));

  // récupération par morceaux (base64) puis écriture
  fs.rmSync(OUT, { recursive: true, force: true }); fs.rmSync(BAKED, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(BAKED, { recursive: true });
  // fichiers lus par FileAccess / Image.load_from_file, jamais importés par l'éditeur (pas de .import, pas de cache .godot)
  fs.writeFileSync(path.join(BAKED, '.gdignore'), '');
  const CH = 3 << 20, manifest = {};
  let bytes = 0;
  for (const [name, size] of Object.entries(summary.sizes)) {
    const parts = [];
    for (let off = 0; off < size; off += CH) {
      const b64 = await evaluate(`(() => { const a = window.__bake[${JSON.stringify(name)}].subarray(${off}, ${Math.min(size, off + CH)}); let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768)); return btoa(s); })()`);
      parts.push(Buffer.from(b64, 'base64'));
    }
    let buf = Buffer.concat(parts);
    let outName = name;
    if (name.endsWith('.gz')) buf = zlib.gzipSync(buf, { level: 9, mtime: 0 });
    let dest;
    if (name.startsWith('tex/')) dest = path.join(BAKED, path.basename(name));
    else dest = path.join(OUT, outName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    bytes += buf.length;
  }
  // textures PBR : copie des fichiers de public/ référencés + chemins res:// dans textures.json
  const texPath = path.join(OUT, 'textures.json');
  const textures = JSON.parse(fs.readFileSync(texPath, 'utf8'));
  for (const t of textures) {
    if (t.file.startsWith('tex/')) { t.file = 'res://assets/baked/' + path.basename(t.file); continue; }
    const src = path.join(ROOT, 'public', t.file.replace(/^textures\//, 'textures/'));
    const dst = path.join(ROOT, 'godot/assets', t.file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(path.join(TEX, '.gdignore'), '');
    fs.copyFileSync(src, dst);
    t.file = 'res://assets/' + t.file;
  }
  fs.writeFileSync(texPath, JSON.stringify(textures));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [...walk(OUT), ...walk(BAKED)]) {
    if (f.endsWith('manifest.json') || f.endsWith('.gdignore')) continue;
    manifest[path.relative(path.join(ROOT, 'godot'), f)] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`${Object.keys(summary.sizes).length} fichiers, ${(bytes / 1048576).toFixed(1)} Mo dans ${path.relative(ROOT, OUT)}`);
  done(0);
} catch (e) {
  console.error(e);
  done(1);
}
