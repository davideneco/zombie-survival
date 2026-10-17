// Cuisson graphique pour le port Godot (J9, docs/GODOT_PORT.md § J9) : lance le vrai jeu dans Chrome (?debug) et en extrait ce que le JS dessine sur
// des canevas ou calcule au chargement, pour que Godot affiche les mêmes pixels :
//   godot/assets/graphics/zombie_flesh.png   atlas des visages et des peaux (4 x 3 cellules de 256), zombieSkin.js
//   godot/assets/graphics/zombie_cloth.png   atlas des hauts, pantalons, pierre, toile
//   godot/assets/graphics/zombie_blood.png   masque de sang (bruit 256 x 256, canal rouge)
//   godot/assets/graphics/zombie_geo.bin     géométries des zombies (tête sculptée, mâchoire, buste, membres, main à griffes), non indexées, sens horaire
//   godot/assets/graphics/fx_atlas.png       atlas des particules (8 cellules de 128), fx.js ;  fx_splat.png : 4 taches de sang
//   godot/assets/graphics/ground_sdf.png     champ de distance aux façades (1 m par pixel, (d + 3) / 16), ground.js
//   godot/assets/graphics/ground_noise.png   bruit périodique 4 canaux du sol (graine fixe)
//   godot/assets/graphics/arch_detail.png   texture de détail des façades (plâtre peint en niveaux de gris, 256 px), architecture.js withDetail
//   godot/data/graphics/lights.json         toutes les sources de lumière du monde (realworld.js lightSources : lampadaires, machines, passages, parkings, rames…), retrouvées en balayant
//                                           le monde et en lisant les 8 PointLight que le JS redistribue sur les plus proches (la liste est fermée dans realworld.js)
//   godot/assets/graphics/graphics.json      origine / taille du champ de distance, liste des géométries
// Prérequis : le serveur de dev tourne (npm run dev), puis  node tools/bake-graphics.mjs [url]   (url par défaut : http://localhost:5173/?debug)
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const OUT = path.join(ROOT, 'godot/assets/graphics'), DATA = path.join(ROOT, 'godot/data/graphics');
const PORT = process.env.CDP_PORT || 9345;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(OUT, '.gdignore'), ''); // lus par Image.load_from_file, jamais importés par l'éditeur

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-bakeg-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=800,500', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 1 << 30 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500)); return r.result?.value; };
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };

// PNG minimal (type 0 : gris, 6 : RGBA), 8 bits
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
function png(w, h, type, data) {
  const bpp = type === 0 ? 1 : 4, raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * bpp + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * bpp, w * bpp).copy(raw, y * (w * bpp + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
  if (!ready) throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`);
  await sleep(1500);
  const res = await evaluate(`(async () => {
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
    const zs = await import('/src/zombieSkin.js'), fxm = await import('/src/fx.js');
    const S = zs.skinAssets(), G = zs.zombieGeometries();
    const canvasPng = (c) => c.toDataURL('image/png').split(',')[1];
    const ground = game.world.ground, sd = ground.sdf, noise = ground.noise.image;
    fxm.fx.init?.(game.scene); // (déjà fait par le jeu)
    const geo = {};
    for (const name of ['torso', 'pelvis', 'head', 'jaw', 'eye', 'thigh', 'shinFoot', 'upperArm', 'foreHand']) {
      let g = G[name]; if (g.index) g = g.toNonIndexed();
      const n = g.attributes.position.count;
      const take = (a, k) => { const o = new Float32Array(n * k); for (let t = 0; t < n; t += 3) for (const [d, s] of [[0, 0], [1, 2], [2, 1]]) for (let c = 0; c < k; c++) o[(t + d) * k + c] = a.array[(t + s) * k + c]; return o; }; // sommets 1 et 2 permutés : sens horaire
      const p = take(g.attributes.position, 3), nr = take(g.attributes.normal, 3), uv = take(g.attributes.uv, 2);
      geo[name] = { n, pos: b64(new Uint8Array(p.buffer)), nor: b64(new Uint8Array(nr.buffer)), uv: b64(new Uint8Array(uv.buffer)) };
    }
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = '/textures/plaster2/diff.jpg'; });
    const dcv = document.createElement('canvas'); dcv.width = dcv.height = 256; const dx = dcv.getContext('2d'); dx.filter = 'grayscale(1) contrast(1.7) brightness(1.1)'; dx.drawImage(img, 0, 0, 256, 256); // comme architecture.js
    const ov = ground.uniforms ? [ground.uniforms.uOrigin.value.x, ground.uniforms.uOrigin.value.y] : null;
    return {
      flesh: canvasPng(S.flesh.image), cloth: canvasPng(S.cloth.image), blood: { w: S.blood.image.width, h: S.blood.image.height, data: b64(new Uint8Array(S.blood.image.data.buffer)) },
      detail: canvasPng(dcv), fx: canvasPng(fxm.flashMaterial().map.image), splat: canvasPng(fxm.fx.decalMesh.material.map.image),
      sdf: { nx: sd.nx, nz: sd.nz, data: b64(sd.data), origin: ov, size: ground.uniforms ? [ground.uniforms.uSize.value.x, ground.uniforms.uSize.value.y] : null },
      noise: { w: noise.width, h: noise.height, data: b64(new Uint8Array(noise.data.buffer, noise.data.byteOffset, noise.data.byteLength)) },
      geo,
    };
  })()`);
  // sources de lumière : balayage au pas de 10 m, lecture des PointLight allumées (le JS en redistribue 8 sur les sources les plus proches du joueur)
  const lights = await evaluate(`(async () => {
    const w = game.player.world, found = new Map();
    for (let x = -850; x <= 850; x += 10) {
      for (let z = -600; z <= 600; z += 10) {
        w.update(x, z, 1);
        game.scene.traverse((o) => {
          if (!o.isPointLight || !(o.intensity > 0) || !(o.distance > 0)) return;
          const k = o.position.x.toFixed(2) + ',' + o.position.y.toFixed(2) + ',' + o.position.z.toFixed(2) + ',' + o.intensity.toFixed(1);
          if (!found.has(k)) found.set(k, [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3), o.color.getHex(), o.intensity, o.distance]);
        });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    return [...found.values()];
  })()`);
  fs.writeFileSync(path.join(DATA, 'lights.json'), JSON.stringify({ comment: 'x, y, z, couleur 0xRRGGBB, intensité (candela de Three.js), portée (m) ; tools/bake-graphics.mjs', lights }) + '\n');
  console.log('lights.json', lights.length, 'sources');
  const w = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(name, buf.length); };
  w('zombie_flesh.png', Buffer.from(res.flesh, 'base64')); w('zombie_cloth.png', Buffer.from(res.cloth, 'base64'));
  const bl = new Uint8Array(Buffer.from(res.blood.data, 'base64')); w('zombie_blood.png', png(res.blood.w, res.blood.h, 6, bl));
  w('arch_detail.png', Buffer.from(res.detail, 'base64'));
  w('fx_atlas.png', Buffer.from(res.fx, 'base64')); w('fx_splat.png', Buffer.from(res.splat, 'base64'));
  w('ground_sdf.png', png(res.sdf.nx, res.sdf.nz, 0, new Uint8Array(Buffer.from(res.sdf.data, 'base64'))));
  w('ground_noise.png', png(res.noise.w, res.noise.h, 6, new Uint8Array(Buffer.from(res.noise.data, 'base64'))));
  // géométries : « ZGE1 », u32 longueur du JSON, JSON { parts : { nom : { n, pos, nor, uv } } } (décalages en octets dans les blobs), blobs float32
  const blobs = [], parts = {}; let off = 0;
  for (const [name, g] of Object.entries(res.geo)) {
    const e = { n: g.n };
    for (const k of ['pos', 'nor', 'uv']) { const b = Buffer.from(g[k], 'base64'); e[k] = off; blobs.push(b); off += b.length; }
    parts[name] = e;
  }
  const head = Buffer.from(JSON.stringify({ parts }), 'utf8'), pre = Buffer.alloc(8); pre.write('ZGE1', 0); pre.writeUInt32LE(head.length, 4);
  w('zombie_geo.bin', Buffer.concat([pre, head, ...blobs]));
  const meta = { sdf_origin: res.sdf.origin, sdf_size: res.sdf.size, sdf_nx: res.sdf.nx, sdf_nz: res.sdf.nz, sdf_min: -3, sdf_range: 16, cell: 1 };
  fs.writeFileSync(path.join(OUT, 'graphics.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta));
  done(0);
} catch (e) { console.error(e); done(1); }
