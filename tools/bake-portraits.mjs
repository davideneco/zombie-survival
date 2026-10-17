// Cuisson des portraits du choix du survivant pour le port Godot (J11) : lance le vrai jeu dans Chrome (?debug) et appelle renderPortraits() de
// src/characters.js (le rendu du menu du JS : un petit contexte WebGL, les Avatar des 8 personnages avec le fusil), puis écrit
//   godot/assets/portraits/<id>.png   (220 x 275, fond transparent)
//   godot/assets/graphics/map.png     le plan de la ville du JS (world.mapImage : île, eau, bâtiments, passages dorés, secteur éclairci), lu par sim/map_image.gd
// Prérequis : le serveur de dev tourne (npm run dev), puis  node tools/bake-portraits.mjs [url]     (navigateur : google-chrome-stable, ou CHROME)
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const PORT = process.env.CDP_PORT || 9343;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-bakep-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=800,500', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 2000)); return r.result?.value; };
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };

const PAGE = `(async () => {
  const m = await import('/src/characters.js');
  return { ids: m.CHARACTERS.map((c) => c.id), urls: m.renderPortraits(220), map: window.game.world.mapImage.toDataURL('image/png') };
})()`;
try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1500);
  const out = await evaluate(PAGE);
  const dir = path.join(ROOT, 'godot/assets/portraits');
  fs.mkdirSync(dir, { recursive: true });
  out.ids.forEach((id, i) => {
    const u = out.urls[i];
    if (!u) throw new Error(`portrait vide : ${id} (WebGL indisponible ?)`);
    fs.writeFileSync(path.join(dir, `${id}.png`), Buffer.from(u.split(',')[1], 'base64'));
  });
  fs.mkdirSync(path.join(ROOT, 'godot/assets/graphics'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'godot/assets/graphics/map.png'), Buffer.from(out.map.split(',')[1], 'base64'));
  console.log('portraits :', out.ids.join(', '));
  done(0);
} catch (e) { console.error(e); done(1); }
