// J7 : valeurs de référence calculées par le JS pour les tests headless du port Godot : godot/data/golden/j7.json.
//   radar   : points dessinés par Hud.drawRadar (src/hud.js) pour 300 cas (position et cap du joueur, points d'intérêt, zombies) ; un contexte 2D factice
//             enregistre les arc() remplis, le vrai code du HUD s'exécute
//   compass : graduations, lettres et repères de Hud.drawCompass pour 200 caps
//   map     : cadrage de Hud.drawMap (rectangle de l'image, flèche du joueur) pour 40 tailles d'écran et positions
//   binds   : keybinds.js : pour chaque action et chaque touche d'essai, la liaison déduite (fromEvent) et les conflits ; puis une suite
//             d'opérations (set, swap, reset) avec l'état complet après chacune
//   inv     : textes de l'inventaire, des munitions et des couleurs de PV du véhicule
// Hud et keybinds.js s'exécutent tels quels, avec un faux `document` / `window`.
// Usage : node tools/export-golden-j7.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.document = { getElementById: () => null };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { CONFIG } = await import(path.join(ROOT, 'src/config.js'));
const { Hud } = await import(path.join(ROOT, 'src/hud.js'));
const { createKeybinds } = await import(path.join(ROOT, 'src/keybinds.js'));

let seed = 20261017;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);

// contexte 2D factice : enregistre les arc() remplis, les fillText, fillRect, moveTo, drawImage, translate
function mockCtx() {
  const c = { arcs: [], fills: [], texts: [], rects: [], moves: [], images: [], translates: [], fillStyle: '', _arc: null };
  const noop = () => {};
  for (const k of ['clearRect', 'beginPath', 'closePath', 'stroke', 'lineTo', 'strokeRect', 'strokeText', 'save', 'restore', 'rotate', 'roundRect', 'quadraticCurveTo']) c[k] = noop;
  c.arc = (x, y, r) => { c._arc = [x, y, r]; };
  c.fill = () => { if (c._arc) c.fills.push({ x: c._arc[0], y: c._arc[1], r: c._arc[2], style: c.fillStyle }); c._arc = null; };
  c.fillText = (t, x, y) => c.texts.push({ t, x, y });
  c.fillRect = (x, y, w, h) => c.rects.push({ x, y, w, h });
  c.moveTo = (x, y) => c.moves.push({ x, y });
  c.drawImage = (...a) => c.images.push(a);
  c.translate = (x, y) => c.translates.push({ x, y });
  return c;
}

// ---------------------------------------------------------------- radar
const hud = new Hud();
const radar = [];
for (let i = 0; i < 300; i++) {
  const player = { yaw: rr(-7, 7), pos: { x: rr(-300, 300), y: 0, z: rr(-300, 300) } };
  const near = () => ({ x: player.pos.x + rr(-45, 45), z: player.pos.z + rr(-45, 45) });
  const pois = Array.from({ length: 6 }, () => ({ ...near(), color: '#33ff77' }));
  const zombies = Array.from({ length: 8 }, () => ({ dead: false, spawnT: 0, pos: near() }));
  const ctx = mockCtx();
  hud.radarCtx = ctx;
  hud.drawRadar(player, zombies, pois, []);
  // pois puis zombies, dans l'ordre : les cercles d'anneaux sont tracés mais non remplis
  radar.push({
    player: { x: player.pos.x, z: player.pos.z, yaw: player.yaw },
    pois: pois.map((p) => [p.x, p.z]), zombies: zombies.map((z) => [z.pos.x, z.pos.z]),
    drawn: ctx.fills.filter((f) => f.r === 3.5 || f.r === 2.5).map((f) => [f.x, f.y, f.r]),
  });
}

// ---------------------------------------------------------------- boussole
const compass = [];
for (let i = 0; i < 200; i++) {
  const yaw = rr(-12, 12);
  const marks = i % 4 === 0 ? [{ bearing: rr(0, 360), color: '#3a7bd5', down: false }, { bearing: rr(0, 360), color: '#e02820', down: false }] : [];
  const ctx = mockCtx();
  hud.compassCtx = ctx;
  hud.drawCompass(yaw, marks);
  const ticks = ctx.rects.filter((r) => r.y === 18 && r.w === 1).map((r) => r.x + 0.5);
  const cards = ctx.texts.map((t) => [t.t, t.x]);
  // moveTo : repères (x - 7) puis (x - 5) pour chaque coéquipier, puis le repère doré (W / 2 - 6)
  const markX = [];
  for (let k = 0; k < marks.length; k++) markX.push(ctx.moves[k * 2].x + 7);
  compass.push({ yaw, marks: marks.map((m) => m.bearing), ticks, cards, markX });
}

// ---------------------------------------------------------------- carte
const map = [];
for (let i = 0; i < 40; i++) {
  const W = Math.round(rr(900, 2600)), H = Math.round(rr(500, 1500));
  globalThis.window.innerWidth = W; globalThis.window.innerHeight = H;
  const crop = { x0: rr(-800, -300), x1: rr(300, 800), z0: rr(-560, -200), z1: rr(200, 560) };
  const scale = 0.7;
  const world = {
    mapImage: {}, mapView: { halfX: 820, halfZ: 560, scale }, mapCrop: crop, zoneCenters: [{ name: 'Test', x: 0, z: 0 }], zoneArea: [rr(500, 90000)],
    zoneOf: () => 0, isZoneOpen: () => true, doors: [], sealedPoints: [], stations: [], wallWeapons: [], parkings: [], bikeStations: [], vehicles: [], trams: [], machines: [], mapTitle: '',
  };
  const player = { yaw: rr(-3, 3), pos: { x: rr(crop.x0, crop.x1), z: rr(crop.z0, crop.z1) } };
  const ctx = mockCtx();
  hud.mapOpen = true;
  hud.el.mapCanvas = { width: W, height: H, getContext: () => ctx };
  hud.drawMap(world, player, [], '#66ff99');
  const img = ctx.images[0];
  map.push({ w: W, h: H, crop, scale, player: [player.pos.x, player.pos.z], image: [img[5], img[6], img[7], img[8]], arrow: [ctx.translates[0].x, ctx.translates[0].y], fontArea: world.zoneArea[0] });
}

// ---------------------------------------------------------------- touches
const defs = CONFIG.keybinds.map((d) => d.id);
const events = [
  { code: 'KeyW', key: 'w' }, { code: 'KeyW', key: 'z' }, { code: 'KeyA', key: 'q' }, { code: 'KeyQ', key: 'a' }, { code: 'Digit1', key: '&' }, { code: 'Digit1', key: '1' },
  { code: 'ArrowUp', key: 'ArrowUp' }, { code: 'Escape', key: 'Escape' }, { code: 'Space', key: ' ' }, { code: 'KeyR', key: 'r' }, { code: 'KeyE', key: 'e' },
  { code: 'KeyM', key: 'm' }, { code: 'Semicolon', key: 'm' }, { code: 'F5', key: 'F5' }, { code: 'F9', key: 'F9' }, { code: 'ShiftLeft', key: 'Shift' }, { code: 'KeyV', key: 'v' },
  { code: 'KeyG', key: 'g' }, { code: 'KeyF', key: 'f' }, { code: 'Enter', key: 'Enter' }, { code: 'Backquote', key: '²' }, { code: 'Tab', key: 'Tab' }, { code: 'KeyK', key: 'k' },
];
const B = createKeybinds();
const state = () => Object.fromEntries(defs.map((id) => [id, B.get(id)]));
const names = () => Object.fromEntries(defs.map((id) => [id, B.label(id)]));
const fromEvent = [];
for (const id of defs) {
  for (const e of events) {
    const r = B.fromEvent(id, e);
    fromEvent.push({ id, code: e.code, key: e.key, binding: r.binding || null, error: r.error || null, conflicts: r.binding ? B.conflicts(id, r.binding, r.ev) : [] });
  }
}
const ops = [];
const rec = (op) => ops.push({ ...op, state: state(), names: names(), changed: B.anyChanged() });
B.set('reload', 'key:x'); rec({ op: 'set', id: 'reload', binding: 'key:x' });
B.set('jump', 'code:KeyB'); rec({ op: 'set', id: 'jump', binding: 'code:KeyB' });
const ok = B.swap('forward', 'code:KeyA', 'left'); rec({ op: 'swap', id: 'forward', binding: 'code:KeyA', other: 'left', ok });
const bad = B.swap('reload', 'key:g', 'grenade'); rec({ op: 'swap', id: 'reload', binding: 'key:g', other: 'grenade', ok: bad });
B.reset('jump'); rec({ op: 'reset', id: 'jump' });
B.set('knife', 'code:ArrowUp'); rec({ op: 'set', id: 'knife', binding: 'code:ArrowUp' });
B.set('map', 'key:n'); rec({ op: 'set', id: 'map', binding: 'key:n' });
B.resetAll(); rec({ op: 'resetAll' });
// « alt » (flèches de secours) : actives tant qu'aucune action ne prend la flèche
const B2 = createKeybinds();
const altBefore = Object.fromEntries(['forward', 'left', 'back', 'right'].map((id) => [id, B2.down(id, { ArrowUp: true, ArrowLeft: true, ArrowDown: true, ArrowRight: true })]));
B2.set('knife', 'code:ArrowUp');
const altAfter = Object.fromEntries(['forward', 'left', 'back', 'right'].map((id) => [id, B2.down(id, { ArrowUp: true, ArrowLeft: true, ArrowDown: true, ArrowRight: true })]));

// ---------------------------------------------------------------- textes
hud.el.ammo = { set innerHTML(v) { this._h = v; } };
const inv = [
  { inventory: [{ id: 'rifle', pap: 0 }, { id: 'm1911', pap: 2 }, { id: 'deagle', pap: 3 }], idx: 1 },
  { inventory: [{ id: 'ak47', pap: 1 }, { id: 'raygun', pap: 0 }], idx: 0 },
];
const invOut = inv.map((c) => {
  const els = { inv: { innerHTML: '' } };
  hud.el.inv = els.inv; hud.binds = { label: (id) => id.replace('weapon', '') };
  hud.cache = {};
  hud.setInventory(c.inventory, c.idx);
  return { inventory: c.inventory, idx: c.idx, html: els.inv.innerHTML };
});
const out = { radar, compass, map, binds: { defs, fromEvent, ops, altBefore, altAfter }, inv: invOut };
const dir = path.join(ROOT, 'godot/data/golden');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'j7.json'), JSON.stringify(out));
console.log(`golden j7 : ${radar.length} radars, ${compass.length} boussoles, ${map.length} cartes, ${fromEvent.length} liaisons, ${ops.length} opérations`);
