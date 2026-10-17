// J5 : valeurs de référence des véhicules et du tram pour les tests headless du port Godot  ->  godot/data/golden/j5.json
//   - voies du tram (src/tramTrack.js : Track.at / project / minRadius, aiguillages : crossingOf, routes) ;
//   - intérieur de la rame (src/tramInterior.js : interiorOf, pushOut, doorIndexAt) ;
//   - physique des motos et vélos : la VRAIE méthode Vehicle.drive (src/vehicles.js) exécutée sur un objet de test (Object.create(Vehicle.prototype)),
//     dans une scène de collision synthétique (mur, caisse, arbre), avec scénarios d'entrées : accélération, freinage, virages, frein à main, panne sèche,
//     choc de mur, choc moto contre moto, écrasement de zombies ;
//   - physique de la rame : la VRAIE méthode Tram.drive / limit / ahead / integrate / freewheel / approach / junctionStep (src/tram.js), portes de zone,
//     aiguillage, zombies fauchés ou bloquants.
// Aucune valeur n'est recalculée à la main. Usage : node tools/export-golden-j5.mjs     (nécessite godot/data/world/vehicles.json : tools/bake-vehicles.mjs)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG } = await import(path.join(ROOT, 'src/config.js'));
const THREE = await import('three');
const { Collision } = await import(path.join(ROOT, 'src/collision.js'));
const { Vehicle } = await import(path.join(ROOT, 'src/vehicles.js'));
const { Tram } = await import(path.join(ROOT, 'src/tram.js'));
const { buildTracks, buildJunction, crossingOf } = await import(path.join(ROOT, 'src/tramTrack.js'));
const { interiorOf, pushOut, doorIndexAt } = await import(path.join(ROOT, 'src/tramInterior.js'));

let seed = 20260617;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);
const fin = (v) => (Number.isFinite(v) ? v : null);
const VD = JSON.parse(fs.readFileSync(path.join(ROOT, 'godot/data/world/vehicles.json'), 'utf8'));
const out = {};

// ====================================================================== voies du tram
const T = CONFIG.tram;
const net = buildTracks(T);
const jn = buildJunction(T.junction, net.byId, T.step ?? 1);
const tracks = [...net.tracks, ...jn.routes.map((r) => r.track)];
for (const t of net.tracks) { t.stops = (t.def.stops || []).map((st) => ({ ...st, line: t.id, s: t.project(st.at[0], st.at[1], 80, {}).s })); t.stops.sort((a, b) => a.s - b.s); }
out.tracks = tracks.map((t) => {
  const samples = [], proj = [], o = {}, pr = {};
  for (let s = -3; s <= t.L + 3; s += 7.37) { t.at(s, o); samples.push({ s, x: o.x, z: o.z, tx: o.tx, tz: o.tz, yaw: o.yaw, R: fin(o.R) }); }
  for (let k = 0; k < 150; k++) {
    t.at(R(0, t.L), o);
    const x = o.x + R(-20, 20), z = o.z + R(-20, 20), mx = [4, 12, 30][k % 3];
    t.project(x, z, mx, pr);
    proj.push({ x, z, max: mx, s: pr.s, d: fin(pr.d), side: pr.side });
  }
  return { id: t.id, n: t.n, L: t.L, minR: fin(t.minRadius(0, t.L)), minR2: fin(t.minRadius(10, 60)), samples, proj, stops: (t.stops || []).map((s) => ({ name: s.name, s: s.s, len: s.len })) };
});
{
  const c = crossingOf(net.byId.AD, net.byId.BCF);
  out.junction = { crossing: c, x: jn.x, z: jn.z, sNode: jn.sNode, routes: jn.routes.map((r) => ({ id: r.id, L: r.track.L, n: r.track.n, meta: r.meta, connectorL: r.connector.L })) };
}

// ====================================================================== intérieur de la rame
{
  const ds = VD.tram.doorStarts;
  const seats = VD.tram.carSeats.map((s) => ({ hip: s.hip, module: s.module, driver: s.driver }));
  const t = { L: T.car.modules * T.car.module, M: T.car.module, n: T.car.modules, model: { seats } };
  const I = interiorOf(t);
  const pushes = [];
  const lists = [[I.boxes, I.wallsClosed], [I.boxes, I.wallsOpen]];
  for (let k = 0; k < 400; k++) {
    const p = { u: R(-I.uEnd - 1, I.uEnd + 1), w: R(-1.6, 1.6) }, li = k % 2, p0 = { ...p };
    const best = pushOut(lists[li], p, T.walk.radius);
    pushes.push({ list: li, u: p0.u, w: p0.w, ru: p.u, rw: p.w, best });
  }
  const doors = [];
  for (let k = 0; k < 200; k++) { const u = R(-12, 12), m = [0, 0.1, -0.2, 0.55][k % 4]; doors.push({ u, m, i: doorIndexAt(I, u, m) }); }
  out.interior = { L: t.L, M: t.M, uEnd: I.uEnd, spans: I.spans, boxes: I.boxes, wallsClosed: I.wallsClosed, wallsOpen: I.wallsOpen, seatSpots: I.seatSpots, pushes, doors };
}

// ====================================================================== physique des motos et vélos
const gbox = { v: [], logs: [] };
const sceneDef = {
  halfX: 400, halfZ: 400, cell: 4,
  segs: [
    { ax: -60, az: -120, bx: 60, bz: -120, h: null, y0: null, kind: 'wall' },     // mur nord
    { ax: 80, az: -50, bx: 80, bz: 50, h: null, y0: null, kind: 'wall' },         // mur est
    { ax: -90, az: 60, bx: -40, bz: 60, h: 3, y0: null, kind: 'prop' },           // barrière (prop)
  ],
  circles: [{ x: -20, z: -70, r: 0.6, h: 4, kind: 'prop' }, { x: 30, z: 40, r: 1.2, h: 4, kind: 'prop' }],
};
const col = new Collision(sceneDef.halfX, sceneDef.halfZ, sceneDef.cell);
for (const s of sceneDef.segs) col.addSegment(s.ax, s.az, s.bx, s.bz, s.h === null ? Infinity : s.h, -Infinity, s.kind);
for (const c of sceneDef.circles) col.addCircle(c.x, c.z, c.r, c.h, -Infinity, c.kind);
col.build();

function mkGame(log) {
  const g = {
    player: { keys: {}, health: 100, hurt: (d, s) => log.push(['hurt', d, s]) }, binds: { down: (a, K) => !!K[a] }, sfx: {}, hud: { announce: () => {} },
    world: { collide: (p, r, o) => col.resolve(p, r, o), floorAt: undefined }, vehicles: [], zombies: [], time: 0, shake: 0, localId: () => 0, isMultiplayer: false,
    damageVehicle: (v, a, s) => { if (!(a > 0) || v.state !== 'ok') return; v.hp = Math.max(0, v.hp - a); log.push(['dmg', v.id, a, s]); },
    hitZombie: (z, head, pt, dmg, mult) => { const killed = dmg * (z.armor || 1) >= z.health; z.health -= dmg * (z.armor || 1); log.push(['zhit', z.id, dmg, killed]); return killed; },
  };
  return g;
}
function mkVehicle(g, id, type, x, z, yaw) {
  const v = Object.create(Vehicle.prototype);
  const def = CONFIG.vehicles.types[type];
  const chain = () => ({ copy() {}, set() {}, rotation: { set() {}, x: 0, y: 0, z: 0 }, position: { copy() {} }, visible: true });
  Object.assign(v, {
    game: g, id, type, def, spawn: { x, z, yaw }, pos: new THREE.Vector3(), seats: Array(def.seats).fill(null), engine: null, station: -1,
    group: chain(), model: { steer: { rotation: { y: 0 } }, wheels: [], wheelRadius: VD.models[type].wheelRadius, seats: VD.models[type].seats, crank: null },
    setWreckLook() {}, stopEngine() {}, syncNet() {}, apply() {},
  });
  v.reset();
  v.seats[0] = 0;
  g.vehicles.push(v);
  return v;
}
const stepVeh = (v, dt, g) => { if (v.crashT > 0) v.crashT -= dt; if (v.hitT > 0) v.hitT -= dt; const prev = v.yaw; v.drive(dt); const d = Math.atan2(Math.sin(v.yaw - prev), Math.cos(v.yaw - prev)); v.dyaw = d; v.wheelRot += (v.speed / v.model.wheelRadius) * dt; };
const keysOf = (i) => ({ forward: i.fwd, back: i.back, jump: i.hb, right: i.steer > 0, left: i.steer < 0 });

// scénario : { name, bikes: [{type,x,z,yaw,fuel?,driven?,speed?}], zombies?, script: [[t, {fwd,back,hb,steer}]], T }
const vscen = [];
const S = (name, bikes, script, Tend, zombies = []) => vscen.push({ name, bikes, script, T: Tend, zombies });
const F = (o = {}) => ({ fwd: false, back: false, hb: false, steer: 0, ...o });
S('moto_ligne', [{ type: 'moto', x: 0, z: 100, yaw: 0 }], [[0, F({ fwd: true })]], 6);
S('moto_arret_marche_arriere', [{ type: 'moto', x: -100, z: 100, yaw: 0 }], [[0, F({ fwd: true })], [3, F({ back: true })], [7, F()], [8, F({ back: true })]], 11);
S('grosse_moto_virages', [{ type: 'grosseMoto', x: 0, z: 150, yaw: 0.5 }], [[0, F({ fwd: true })], [1.5, F({ fwd: true, steer: 1 })], [3.5, F({ fwd: true, steer: -1 })], [5.5, F({ fwd: true })], [6.5, F({ back: true, steer: 1 })], [8, F()]], 10);
S('velo_slalom', [{ type: 'velo', x: 20, z: 100, yaw: 1 }], [[0, F({ fwd: true })], [2, F({ fwd: true, steer: 1 })], [3, F({ fwd: true, steer: -1 })], [4, F({ fwd: true, steer: 0.5 })], [6, F({ back: true })], [7.5, F()]], 9);
S('moto_frein_a_main', [{ type: 'moto', x: 0, z: 200, yaw: 0 }], [[0, F({ fwd: true })], [3, F({ fwd: true, steer: 1, hb: true })], [4.5, F({ fwd: true })], [6, F({ hb: true })]], 8);
S('moto_mur_face', [{ type: 'moto', x: 0, z: -60, yaw: 0 }], [[0, F({ fwd: true })]], 6);
S('moto_mur_biais', [{ type: 'moto', x: -30, z: -60, yaw: -0.5 }], [[0, F({ fwd: true })]], 6);
S('moto_caisse_arbre', [{ type: 'moto', x: -20, z: -40, yaw: 0 }, { type: 'velo', x: 30, z: 100, yaw: 3.14159 }], [[0, F({ fwd: true })]], 6);
S('moto_barriere', [{ type: 'grosseMoto', x: -60, z: 100, yaw: 0 }], [[0, F({ fwd: true })]], 6);
S('moto_panne_seche', [{ type: 'moto', x: 100, z: 100, yaw: 0, fuel: 0 }], [[0, F({ fwd: true })], [6, F({ back: true })], [9, F()]], 11);
S('moto_reserve', [{ type: 'moto', x: 120, z: 100, yaw: 0, fuel: 0.9 }], [[0, F({ fwd: true })]], 6);
S('moto_contre_moto_garee', [{ type: 'moto', x: 200, z: 100, yaw: 0 }, { type: 'grosseMoto', x: 200, z: 70, yaw: 0, driven: false }], [[0, F({ fwd: true })]], 5);
S('moto_contre_moto_conduite', [{ type: 'moto', x: 220, z: 100, yaw: 0 }, { type: 'grosseMoto', x: 220.5, z: 50, yaw: 3.14159, speed: 0, driven: true, still: true }], [[0, F({ fwd: true })]], 5);
S('moto_ecrasement_rapide', [{ type: 'moto', x: 150, z: 100, yaw: 0 }], [[0, F({ fwd: true })]], 6, [{ id: 1, x: 150, z: 55, health: 70 }, { id: 2, x: 150.2, z: 35, health: 70, armor: 0.5 }, { id: 3, x: 149.5, z: 20, health: 400 }]);
S('velo_zombie_arret', [{ type: 'velo', x: 160, z: 100, yaw: 0 }], [[0, F({ fwd: true })]], 6, [{ id: 1, x: 160, z: 70, health: 70 }]);
S('grosse_moto_ecrasement', [{ type: 'grosseMoto', x: 180, z: 100, yaw: 0 }], [[0, F({ fwd: true })]], 6, [{ id: 1, x: 180.3, z: 60, health: 70 }, { id: 2, x: 180, z: 45, health: 70 }]);
out.vehicleScene = sceneDef;
out.vehicleScenarios = vscen.map((sc) => {
  const log = [], g = mkGame(log);
  const bikes = sc.bikes.map((b, i) => {
    const v = mkVehicle(g, i, b.type, b.x, b.z, b.yaw);
    if (b.fuel != null) v.fuel = b.fuel;
    if (b.driven === false) v.seats[0] = null;
    if (b.driven === true) v.seats[0] = 7;
    return v;
  });
  g.zombies = sc.zombies.map((z) => ({ id: z.id, pos: { x: z.x, z: z.z }, targetable: true, isBoss: false, health: z.health, armor: z.armor }));
  const me = bikes[0], dt = 1 / 60, trace = [];
  const steps = Math.round(sc.T * 60);
  let si = 0;
  for (let k = 0; k < steps; k++) {
    const t = k * dt;
    while (si + 1 < sc.script.length && sc.script[si + 1][0] <= t + 1e-9) si++;
    const inp = sc.script[si][1];
    g.player.keys = keysOf(inp);
    g.time = (k + 1) * dt;
    stepVeh(me, dt, g);
    if (k % 6 === 5) trace.push([g.time, me.pos.x, me.pos.z, me.yaw, me.speed, me.lean, me.steerAngle, me.fuel, me.hp, me.wheelRot, me.dyaw, bikes.length > 1 ? bikes[1].pos.x : 0, bikes.length > 1 ? bikes[1].pos.z : 0]);
  }
  return { name: sc.name, bikes: sc.bikes, script: sc.script, T: sc.T, zombies: sc.zombies, trace, log: log.map((e) => e.map((x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x))), final: { x: me.pos.x, z: me.pos.z, yaw: me.yaw, speed: me.speed, fuel: me.fuel, hp: me.hp, zhealth: g.zombies.map((z) => z.health) } };
});
// dégâts d'écrasement et de seuil (roadkillDamage) par type et vitesse
out.roadkill = [];
for (const type of ['moto', 'grosseMoto', 'velo']) for (let sp = 0; sp <= 22; sp += 1.5) { const g = mkGame([]), v = mkVehicle(g, 0, type, 0, 0, 0); out.roadkill.push({ type, sp, dmg: v.roadkillDamage(sp) }); }

// ====================================================================== physique de la rame
const tramGatesDef = VD.tram.gates.map((q) => ({ ...q, door: { open: false, id: q.door } }));
const routeGatesDef = Object.fromEntries(Object.entries(VD.tram.routeGates).map(([k, a]) => [k, a.map((q) => ({ ...q, door: { open: false, id: q.door } }))]));
function mkTramWorld(openDoors = []) {
  const by = {};
  for (const gt of tramGatesDef) { (by[gt.line] ||= []).push(gt); gt.door.open = openDoors.includes(gt.door.id); }
  for (const [k, a] of Object.entries(routeGatesDef)) { by[k] = [...a]; for (const gt of a) gt.door.open = openDoors.includes(gt.door.id); }
  // rames de décor
  const o = {}, ps = {};
  const reg = { ...net.byId, ...jn.byId };
  for (const d of VD.tram.decor) for (const trk of Object.values(reg)) {
    for (const sEnd of [d.lo, d.hi]) {
      let s = null;
      if (trk.id === d.line) s = sEnd; else { net.byId[d.line].at(sEnd, o); const p = trk.project(o.x, o.z, 3, ps); if (p.d < 1) s = p.s; }
      if (s != null) (by[trk.id] ||= []).push({ line: trk.id, s, door: { open: false }, decor: true });
    }
  }
  return { by, reg };
}
function mkTram(g, W) {
  const t = Object.create(Tram.prototype);
  const C = T.car, D = T.drive;
  const mods = [];
  for (let i = 0; i < C.modules; i++) mods.push({ g: { position: { set() {} }, rotation: { y: 0 } }, leaves: [], pose: { x: 0, z: 0, yaw: 0, tx: 1, tz: 0, dyaw: 0 }, openF: -1 });
  const line = net.byId[C.start.line], stop = line.stops.find((s) => s.name === C.start.stop);
  Object.assign(t, {
    game: g, scene: null, index: 0, id: 100, type: 'tram', isTram: true, track: line, startS: stop.s, line0: line, reg: W.reg, jn,
    sw: 0, def: { name: 'TRAM', seats: 16, camArm: C.camArm, maxSpeed: D.maxSpeed, hp: T.hp, zombieHit: T.zombieHit, roadkill: { vmin: T.hit.zombieSpeed }, tank: 1 },
    n: C.modules, M: C.module, L: C.modules * C.module, seats: Array(16).fill(null), pos: new THREE.Vector3(), yaw: 0, dyaw: 0, lean: 0, throttle: 0, _o: {}, _o2: {}, _out: new THREE.Vector3(),
    group: { position: { copy() {} }, rotation: { set() {} }, visible: true }, mods, doors: { open: false, f: 0 }, engine: null, sound: { gong: 0, chime: 0, alarm: 0, squeal: 0 }, net: null,
    stopEngine() {}, syncNet() {}, sendState() {},
  });
  t.reset();
  return t;
}
function mkTramGame(W, powered = true, log = []) {
  return {
    player: { keys: {}, vehicle: { v: null }, onTram: null, locked: false, pos: { x: 1e5, z: 1e5 }, health: 100, hurt() {} }, binds: { down: (a, K) => !!K[a], label: (a) => a, tag: (a) => a }, sfx: { alarm() {}, tramChime() {}, deny() {} },
    hud: { announce: (a, b) => log.push(['announce', a]) }, world: { tram: { setSwitch() {} }, collision: null }, zombies: [], time: 0, shake: 0, localId: () => 0, isMultiplayer: false, isClient: false,
    tramPowered: powered, tramGates: (id) => W.by[id] || [],
    hitZombie: (z, head, pt, dmg, mult) => { z.health -= dmg; log.push(['zhit', z.id, dmg]); return z.health <= 0; },
  };
}
const stepTram = (t, g, dt, seat) => {
  if (seat >= 0) t.drive(dt, seat); else if (!t.hasDriver) t.freewheel(dt);
  const target = t.doors.open ? 1 : 0, rate = dt / T.drive.doorTime;
  if (t.doors.f < target) t.doors.f = Math.min(target, t.doors.f + rate); else if (t.doors.f > target) t.doors.f = Math.max(target, t.doors.f - rate);
  t.speed = t.v; t.apply(dt);
  if (t.limitMsg > 0) t.limitMsg -= dt;
};
const tscen = [];
const TS = (name, o) => tscen.push({ name, powered: true, seat: 0, open: [], sw: 0, s0: null, v0: 0, track0: null, zombies: [], doors0: false, ...o });
const TF = (o = {}) => ({ fwd: false, back: false, emg: false, ...o });
TS('rame_avant', { script: [[0, TF({ fwd: true })]], T: 40 });
TS('rame_hors_tension', { powered: false, script: [[0, TF({ fwd: true })]], T: 8 });
TS('rame_arriere_cabine', { seat: 1, script: [[0, TF({ fwd: true })], [20, TF({ back: true })], [30, TF()]], T: 40 });
TS('rame_marche_arriere', { script: [[0, TF({ back: true })]], T: 20 });
TS('rame_frein_urgence', { script: [[0, TF({ fwd: true })], [12, TF({ emg: true })], [20, TF()]], T: 24 });
TS('rame_portes_ouvertes', { doors0: true, script: [[0, TF({ fwd: true })]], T: 6 });
TS('rame_aiguillage_devie', { sw: 1, script: [[0, TF({ fwd: true })]], T: 60 });
TS('rame_aiguillage_droit', { script: [[0, TF({ fwd: true })]], T: 60, s0: 120 });
TS('rame_feu_rouge', { script: [[0, TF({ fwd: true })]], T: 60, s0: 250 });
TS('rame_porte_ouverte_passe', { open: [11], script: [[0, TF({ fwd: true })]], T: 40, s0: 250 });
TS('rame_heurtoir_ouest', { script: [[0, TF({ back: true })]], T: 80, s0: 100 });
TS('rame_roue_libre', { seat: -1, v0: 9, script: [[0, TF()]], T: 10, s0: 300 });
TS('rame_quai_a_quai', { open: [2, 8, 11, 29, 43, 51, 14, 19, 25], script: [[0, TF({ fwd: true })], [30, TF({ back: true })], [34.5, TF()]], T: 60 });
TS('rame_zombie_fauche', { script: [[0, TF({ fwd: true })]], T: 14, s0: 100, zombiesAt: [{ id: 1, du: 40, w: 0.3, health: 70 }, { id: 2, du: 55, w: -0.5, health: 5000 }] });
TS('rame_zombie_lent_bloque', { script: [[0, TF({ fwd: true })], [2, TF()]], T: 10, s0: 100, v0: 2, zombiesAt: [{ id: 1, du: 16, w: 0.2, health: 70 }] });
out.tramScenarios = tscen.map((sc) => {
  const log = [], W = mkTramWorld(sc.open), g = mkTramGame(W, sc.powered, log);
  const t = mkTram(g, W);
  if (sc.s0 != null) { t.s = sc.s0; t.apply(0, true); }
  t.v = sc.v0; t.sw = sc.sw; t.doors.open = sc.doors0; t.doors.f = sc.doors0 ? 1 : 0;
  if (sc.seat >= 0) t.seats[sc.seat] = 0;
  if (sc.zombiesAt) {
    const o = {}; t.track.at(t.s + 11.75 + sc.zombiesAt[0].du, o);
    g.zombies = sc.zombiesAt.map((z) => { t.track.at(t.s + z.du + 11.75, o); return { id: z.id, pos: { x: o.x + -o.tz * z.w, z: o.z + o.tx * z.w }, targetable: true, isBoss: false, health: z.health }; });
    sc.zombiesPos = g.zombies.map((z) => ({ id: z.id, x: z.pos.x, z: z.pos.z, health: z.health }));
  }
  const dt = 1 / 60, trace = [], steps = Math.round(sc.T * 60), appr = [];
  let si = 0;
  for (let k = 0; k < steps; k++) {
    const tt = k * dt;
    while (si + 1 < sc.script.length && sc.script[si + 1][0] <= tt + 1e-9) si++;
    const inp = sc.script[si][1];
    g.player.keys = { forward: inp.fwd, back: inp.back, jump: inp.emg };
    g.time = (k + 1) * dt;
    stepTram(t, g, dt, sc.seat);
    if (k % 12 === 11) {
      trace.push([g.time, t.s, t.v, t.track.id, t.sw, t.doors.f, t.mods[0].pose.x, t.mods[0].pose.z, t.mods[4].pose.yaw, t.pos.x, t.pos.z, t.yaw]);
      const a = t.approach(); appr.push(a ? [a.arm, a.exit, a.dist, a.locked] : null);
    }
  }
  return { name: sc.name, powered: sc.powered, seat: sc.seat, open: sc.open, sw: sc.sw, s0: sc.s0, v0: sc.v0, doors0: sc.doors0, script: sc.script, T: sc.T, zombies: sc.zombiesPos || [], trace, approach: appr, log: log.map((e) => e.map((x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x))), final: { s: t.s, v: t.v, track: t.track.id, sw: t.sw } };
});
// limit() et ahead() isolés, à des positions variées
{
  const W = mkTramWorld([]), g = mkTramGame(W), t = mkTram(g, W);
  out.tramLimits = [];
  for (const id of ['BCF', 'AD']) for (let k = 0; k < 60; k++) {
    t.track = net.byId[id]; t.sw = 0; t.s = R(15, t.track.L - 15); const dir = k % 2 ? 1 : -1, l = t.limit(dir);
    out.tramLimits.push({ line: id, s: t.s, dir, v: fin(l.v), why: l.why, d: fin(l.d), kind: l.kind });
  }
}
fs.writeFileSync(path.join(ROOT, 'godot/data/golden/j5.json'), JSON.stringify(out) + '\n');
console.log(`j5.json : ${out.tracks.length} voies, ${out.vehicleScenarios.length} scénarios de véhicules, ${out.tramScenarios.length} scénarios de rame, ${out.tramLimits.length} limites, ${out.interior.pushes.length} pushOut`);
