// Pilote Chrome headless (CDP) pour tester le jeu sans écran : charge la page, exécute un script, enregistre des captures.
//   node tools/cdp.mjs <dossier-temp> <url> [script-js]
//   SHOT=chemin.png   capture d'écran finale   · SAVEPNG=chemin.png : enregistre window.__png
//   SAVEPNGS=prefixe  enregistre chaque data-URL de window.__pngs (prefixe0.png, prefixe1.png…)
//   CDP_PORT=9333  WIN=1280,720
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const S = process.argv[2], URL = process.argv[3], script = process.argv[4] || '';
const PORT = process.env.CDP_PORT || 9333;
const chrome = spawn('google-chrome-stable', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=' + (process.env.WIN || '1280,720'), '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(S, 'prof' + PORT), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://localhost:' + PORT + '/json')).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'debug') console.log('[console]', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') console.log('[EXC]', JSON.stringify(m.params.exceptionDetails).slice(0, 1200));
});
await call('Runtime.enable'); await call('Page.enable');
await call('Page.navigate', { url: URL });
for (let i = 0; i < 200; i++) { await sleep(1000); const r = await call('Runtime.evaluate', { expression: 'typeof window.game', returnByValue: true }); if (r.result?.value === 'object') break; }
await sleep(1500);
if (script) {
  const r = await call('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
  console.log('[eval]', JSON.stringify(r.result?.value ?? r).slice(0, 30000));
}
if (process.env.SAVEPNGS) {
  const r = await call('Runtime.evaluate', { expression: 'JSON.stringify(window.__pngs||[])', returnByValue: true });
  JSON.parse(r.result?.value || '[]').forEach((d, i) => fs.writeFileSync(process.env.SAVEPNGS + i + '.png', Buffer.from(d.split(',')[1], 'base64')));
}
if (process.env.SAVEPNG) {
  const r = await call('Runtime.evaluate', { expression: 'window.__png', returnByValue: true });
  if (r.result?.value) fs.writeFileSync(process.env.SAVEPNG, Buffer.from(r.result.value.split(',')[1], 'base64'));
}
await sleep(1000);
const shot = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.env.SHOT || path.join(S, 'shot.png'), Buffer.from(shot.data, 'base64'));
chrome.kill(); process.exit(0);
