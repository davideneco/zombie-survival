// Balayage « un zombie sort d'une fenêtre, le joueur attend à 35-55 m » (J11, parité Godot / JS) : rejoue dans le VRAI jeu JS (Chrome, ?debug, game.update) la liste
// d'essais écrite par le port Godot (tests/test_probe.gd, --out=essais.json : { wi, px, pz } par essai) et écrit { wi, arrived, d } par essai.
//   node tools/window-scan.mjs essais.json sortie.json [url]       (npm run dev lancé)
// Un essai : monde ouvert, joueur immobile et invulnérable en (px, pz), zombie de vitesse 2 m/s qui sort de la fenêtre wi (apparition par fenêtre, cogne puis enjambe),
// 63 s de jeu à 60 images/s ; arrivé = à moins de 2 m du joueur.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

const [, , IN, OUT, URL = 'http://localhost:5173/?debug'] = process.argv;
const trials = JSON.parse(fs.readFileSync(IN, 'utf8'));
const PORT = process.env.CDP_PORT || 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-winscan-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=640,400', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 2000)); return r.result?.value; };
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };

const PAGE = (list) => `(async () => {
  const g = window.game, w = g.world, p = g.player;
  for (const d of w.doors) g.openDoor(d.id);
  g.started = true; g.playing = true; g.over = false; g.round = 1; g.toSpawn = 0; g.intermission = 1e9; g.zombieSpeed = 2;
  const out = [];
  for (const t of ${JSON.stringify(list)}) {
    for (const z of g.zombies) z.dispose?.();
    g.zombies.length = 0;
    p.pos.set(t.px, 0, t.pz); p.vel.set(0, 0, 0); p.health = 1e9; p.maxHealth = 1e9; p.dead = false; p.downed = false; p.region = 0;
    w.nav.invalidate?.();
    g.pickSpawn = () => w.windowSpawns[t.wi];
    g.flowCool = 0; if (w.nav.job) w.nav.job = null;
    g.spawnZombie(true);
    const z = g.zombies[g.zombies.length - 1];
    z.speed = 2; z.limp = false; z.maxHealth = z.health = 1e9;
    let arrived = -1, reloc = 0;
    for (let i = 0; i < 60 * 63; i++) {
      g.update(1 / 60);
      if (!g.zombies.includes(z)) break;
      if (Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 2) { arrived = i / 60; break; }
    }
    out.push({ wi: t.wi, arrived, d: Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) });
  }
  return out;
})()`;
try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1500);
  const res = await evaluate(PAGE(trials));
  fs.writeFileSync(OUT, JSON.stringify(res));
  const fails = res.filter((r) => r.arrived < 0);
  console.log(`JS : ${res.length} essais, ${fails.length} échecs`);
  done(0);
} catch (e) { console.error(e); done(1); }
