// Cuisson des véhicules et du tram pour le port Godot (J5, docs/GODOT_PORT.md § J5) : lance le vrai jeu dans Chrome (?debug), lit window.game et écrit
//   godot/data/world/vehicles.json   motos et vélos (position, cap, variante, station), parkings (borne, panneau), stations de vélos,
//                                    modèles (sièges hip / eye, rayon de roue), rame (sièges, portes, arrêts), portes de zone sur les voies,
//                                    sous-station, rames de décor de l'Homme de Fer
// Prérequis : le serveur de dev tourne (npm run dev), puis  node tools/bake-vehicles.mjs [url]     (navigateur : google-chrome-stable, ou CHROME)
// Les voies elles-mêmes ne sont pas cuites : elles se recalculent depuis CONFIG.tram (sim/tram_track.gd, port de tramTrack.js).
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const PORT = process.env.CDP_PORT || 9342;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-bakev-'));
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
  const g = window.game, w = g.world, T = g.trams[0], info = w.tram;
  const hdf = await import('/src/hommedefer.js');
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const seat = (s) => ({ hip: s.hip.map(r4), eye: s.eye.map(r4), ry: s.ry || 0 });
  const models = {};
  for (const v of g.vehicles) if (!models[v.type]) models[v.type] = { seats: v.model.seats.map(seat), wheelRadius: v.model.wheelRadius, length: v.model.length ?? 0 };
  return {
    vehicles: g.vehicles.map((v, i) => ({ id: v.id, type: v.type, x: v.spawn.x, z: v.spawn.z, yaw: v.spawn.yaw, variant: w.vehicleSpawns[i].variant ?? 0, station: v.station })),
    models,
    parkingsFull: w.parkings.map((p) => { const o = {}; for (const k of Object.keys(p)) { const v = p[k]; if (v === null || ['number', 'string'].includes(typeof v)) o[k] = v; else if (v && typeof v.x === 'number' && typeof v.z === 'number') o[k] = { x: v.x, z: v.z, yaw: v.yaw ?? null }; } return o; }),
    bikeStations: w.bikeStations.map((b) => { const o = {}; for (const k of Object.keys(b)) { const v = b[k]; if (v === null || ['number', 'string'].includes(typeof v)) o[k] = v; else if (v && typeof v.x === 'number' && typeof v.z === 'number') o[k] = { x: v.x, z: v.z }; } return o; }),
    tram: info ? {
      carSeats: T.model.seats.map((s) => ({ ...seat(s), module: s.module, driver: !!s.driver })),
      doorsAt: T.doorSpots.map((d) => (typeof d === 'number' ? r4(d) : d)),
      doorStarts: hdf.carDoorStarts().map(r4),
      start: { line: T.line0.id, s: T.startS, x: T.pos.x, z: T.pos.z, yaw: T.yaw },
      hdfTram: hdf.HDF.tram,
      stops: info.tracks.map((t) => ({ line: t.id, L: t.L, stops: t.stops.map((s) => ({ name: s.name, s: s.s, len: s.len })) })),
      gates: info.gates.map((q) => ({ line: q.line, s: q.s, door: q.door.id })),
      routeGates: Object.fromEntries(Object.entries(info.routeGates || {}).map(([k, a]) => [k, a.map((q) => ({ line: q.line, s: q.s, door: q.door.id }))])),
      signals: (info.signals || []).map((q) => ({ arm: q.arm, side: q.side, x: r4(q.x), z: r4(q.z), tx: r4(q.tx), tz: r4(q.tz) })), // têtes de signal de l'aiguillage (feux « tout droit » / « dévié » : le port les redessine selon le réglage)
      substation: info.substation ? { x: info.substation.x, z: info.substation.z } : null,
      decor: (w.hdf?.trams || []).map((d) => ({ line: d.line, lo: d.lo, hi: d.hi, L: d.L, modules: d.modules, x: d.x, z: d.z })),
      junction: info.net.junction ? { name: info.net.junction.name, x: info.net.junction.x, z: info.net.junction.z, sNode: info.net.junction.sNode, routes: info.net.junction.routes.map((r) => ({ id: r.id, L: r.track.L, meta: r.meta })) } : null,
    } : null,
  };
})()`;
try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1500);
  const out = await evaluate(PAGE);
  fs.writeFileSync(path.join(ROOT, 'godot/data/world/vehicles.json'), JSON.stringify(out));
  console.log('vehicles.json :', out.vehicles.length, 'véhicules,', out.parkingsFull.length, 'parkings,', out.bikeStations.length, 'stations,', out.tram ? `${out.tram.gates.length} portes de zone sur les voies` : 'pas de tram');
  done(0);
} catch (e) { console.error(e); done(1); }
