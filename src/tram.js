import * as THREE from 'three';
import { CONFIG } from './config.js';
import { carGeometries, atlas, HDF } from './hommedefer.js';
import { fx } from './fx.js';
import { interiorOf } from './tramInterior.js';

// =====================================================================
//  Rame de tram conduisible (v0.39.0).
//  - UNE rame de 5 modules (23,5 m) sur la voie B / C / F, position 1D `s` (m depuis le début de la ligne, centre de la rame) et vitesse signée `v`
//    (m/s, positive vers `s` croissant). Les modules sont articulés : chacun suit la voie à son propre centre (maillages séparés, un par module).
//  - Elle se comporte comme une moto pour le reste du jeu (`player.vehicle = { v, seat }`, RideCam, places, v_req / v_seats) : mêmes champs et
//    méthodes que Vehicle (pos, yaw, dyaw, speed, def, model.seats, hipWorld, eyeWorld, seats, hp, state…), plus isDriver / seatYaw.
//    Les identifiants de rame commencent à 100 (TRAM_ID0) : les messages v_* des motos servent aussi aux rames.
//  - Places : 0 = conducteur, cabine avant (sens de `s` croissant) ; 1 = conducteur, cabine arrière (sens inverse) ; 2 à 15 = passagers assis.
//  - Réseau : le client du CONDUCTEUR simule et diffuse t_state 20 fois par seconde ; sans conducteur, l'hôte (ou le solo) freine la rame.
//  - Collisions : une boîte orientée par module, obstacles DYNAMIQUES de Collision (setDynamic) : les joueurs et les zombies sont repoussés.
// =====================================================================

export const TRAM_ID0 = 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

const hud_ = (g) => g.hud;
let CAR = null; // géométries partagées (une seule rame)
let MATS = null;
const mats = () => MATS || (MATS = {
  body: atlas('car').mat,
  dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6, emissive: 0x16191d }), // un peu d'émission : l'intérieur n'a aucune lumière
});

export class Tram {
  constructor(game, scene, index, track, startS) {
    const T = CONFIG.tram, C = T.car, D = T.drive;
    this.game = game; this.scene = scene;
    this.index = index; this.id = TRAM_ID0 + index; this.type = 'tram'; this.isTram = true;
    this.track = track; this.startS = startS;
    this.def = { name: 'TRAM', seats: 16, camArm: C.camArm, maxSpeed: D.maxSpeed, hp: T.hp, zombieHit: T.zombieHit, roadkill: { vmin: T.hit.zombieSpeed }, tank: 1 };
    this.n = C.modules; this.M = C.module; this.L = this.n * this.M;
    this.seats = Array(16).fill(null);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.dyaw = 0; this.lean = 0; this.throttle = 0;
    this._o = {}; this._o2 = {}; this._out = new THREE.Vector3();
    // ---- modèle
    if (!CAR) CAR = carGeometries();
    const M = mats();
    this.group = new THREE.Group(); this.group.rotation.order = 'YXZ'; scene.add(this.group);
    this.mods = CAR.modules.map((m, i) => {
      const g = new THREE.Group(), inner = new THREE.Group(); inner.rotation.y = Math.PI / 2; g.add(inner); this.group.add(g);
      const body = new THREE.Mesh(m.body.clone(), M.body), dark = new THREE.Mesh(m.dark.clone(), M.dark);
      for (const o of [body, dark]) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; inner.add(o); }
      const pos = dark.geometry.attributes.position, base = new Float32Array(m.leaves.reduce((a, l) => a + l.n, 0)); // abscisses de repos des vantaux
      let k = 0; for (const l of m.leaves) for (let v = 0; v < l.n; v++) base[k++] = pos.getX(l.v0 + v);
      return { g, inner, body, dark, leaves: m.leaves, leafBase: base, pose: { x: 0, z: 0, yaw: 0, tx: 1, tz: 0, dyaw: 0 }, openF: -1 };
    });
    // places : 0 conducteur avant, 1 conducteur arrière, puis les passagers (rangés par module, côté gauche puis droit)
    const sd = CAR.seats, front = sd.find((s) => s.driver && s.module === this.n - 1), rear = sd.find((s) => s.driver && s.module === 0);
    const pass = sd.filter((s) => !s.driver).sort((a, b) => a.module - b.module || a.side - b.side || b.hip[2] - a.hip[2]);
    this.model = { group: this.group, seats: [front, rear, ...pass].map((s) => ({ hip: s.hip, eye: s.eye, ry: s.ry, module: s.module, driver: s.driver, twist: s.driver ? 0 : 2.2 })), wheelRadius: 0.4, steer: null, wheels: [] };
    this.doorSpots = CAR.doorsAt;
    this.interior = interiorOf(this); // sièges, pupitres, parois : collision locale du joueur debout (v0.40.0)
    this.doors = { open: false, f: 0 };
    this.engine = null; this.sound = { gong: 0, chime: 0, alarm: 0, squeal: 0 };
    this.reset();
  }

  reset() {
    this.s = this.startS; this.v = 0; this.speed = 0;
    this.hp = this.def.hp; this.state = 'ok'; this.hpDirty = false; this.hpSendT = 0; this.respawnRound = 0; this.respawnPending = false; this.respawnRetry = 0;
    this.seats.fill(null); this.sendT = 0; this.hitCd = new Map(); this.limitMsg = 0; this.autoMsg = 0; this.fxAcc = 0;
    this.doors.open = false; this.doors.f = 0; this.gongCd = 0;
    this.stopEngine();
    this.syncNet();
    this.apply(0, true);
  }

  get maxHp() { return this.def.hp; }
  get hpFrac() { return this.hp / this.def.hp; }
  get usable() { return this.state === 'ok'; }
  get fuelFrac() { return this.game.tramPowered ? 1 : 0; } // « énergie » : alimentée ou non
  get fuel() { return this.fuelFrac; }
  set fuel(v) { /* pas d'essence : l'énergie vient de la sous-station */ }
  get hasDriver() { return this.seats[0] != null || this.seats[1] != null; }
  isDriver(seat) { return seat <= 1; }
  freeSeat() { return this.seats.findIndex((s) => s == null); }
  seatModule(seat) { return this.mods[this.model.seats[seat].module]; }
  seatParent(seat) { return this.seatModule(seat).g; }
  seatYaw(seat) { return this.seatModule(seat).pose.yaw; }
  seatDyaw(seat) { return this.seatModule(seat).pose.dyaw; }
  // sens de marche de la cabine de `seat` dans l'axe de la voie : +1 (cabine avant) ou -1 (cabine arrière)
  cabDir(seat) { return seat === 0 ? 1 : -1; }
  syncNet() { this.net = { s: this.s, v: this.v, d: this.doors.open ? 1 : 0, t: 0 }; }

  // ---- repère de la rame (v0.40.0, voir tramInterior.js) : u le long de la rame depuis son centre (+ vers l'avant), w à droite ; un point (u, w) est celui de
  // la voie à l'abscisse s + u décalé de w vers la droite (continu d'un module à l'autre)
  frame(u, out) { return this.track.at(clamp(this.s + u, 0, this.track.L), out); }
  walkToWorld(u, w, y, out) { const o = this._wf || (this._wf = {}); this.frame(u, o); out.x = o.x - o.tz * w; out.z = o.z + o.tx * w; out.y = y; return out; }
  worldToWalk(x, z, out) { const r = this._wp || (this._wp = {}); this.track.project(x, z, 10, r); out.u = r.s - this.s; out.w = r.d === Infinity ? 99 : r.side * r.d; return out; }
  // les portes laissent passer : ouvertes (à plus de walk.doorOpen) et rame (presque) arrêtée
  walkOpen() { return this.doors.f >= CONFIG.tram.walk.doorOpen && Math.abs(this.v) <= CONFIG.tram.drive.boardSpeed; }
  // module qui porte l'abscisse u (avatars des coéquipiers debout)
  moduleAt(u) { return clamp(Math.floor((u + this.L / 2) / this.M), 0, this.n - 1); }
  moduleU(i) { return -this.L / 2 + this.M / 2 + i * this.M; }

  // point local d'un module (repère « groupe » : x droite, y haut, z arrière) -> monde
  localToWorld(modIdx, p, out) {
    const q = this.mods[modIdx].pose, c = Math.cos(q.yaw), s = Math.sin(q.yaw);
    return out.set(q.x + c * p[0] + s * p[2], p[1], q.z - s * p[0] + c * p[2]);
  }
  toWorld(p, out) { return this.localToWorld(Math.floor(this.n / 2), p, out); }
  hipWorld(seat, out) { const s = this.model.seats[seat]; return this.localToWorld(s.module, s.hip, out); }
  eyeWorld(seat, out) { const s = this.model.seats[seat]; return this.localToWorld(s.module, s.eye, out); }

  // ------------------------------------------------------------------ pose des modules
  apply(dt = 0, force = false) {
    const T = this.track, o = this._o, o2 = this._o2;
    T.at(this.s, o);
    this.dyaw = force ? 0 : angDiff(o.yaw, this.yaw);
    this.pos.set(o.x, 0, o.z); this.yaw = o.yaw;
    this.group.position.copy(this.pos); this.group.rotation.set(0, o.yaw, 0);
    const rx = -o.tz, rz = o.tx;
    for (let i = 0; i < this.n; i++) {
      const m = this.mods[i], si = this.s + (-this.L / 2 + this.M / 2 + i * this.M);
      T.at(clamp(si, 0, T.L), o2);
      const dx = o2.x - o.x, dz = o2.z - o.z;
      m.g.position.set(dx * rx + dz * rz, 0, -(dx * o.tx + dz * o.tz)); m.g.rotation.y = o2.yaw - o.yaw;
      const p = m.pose; p.dyaw = force ? 0 : angDiff(o2.yaw, p.yaw); p.x = o2.x; p.z = o2.z; p.yaw = o2.yaw; p.tx = o2.tx; p.tz = o2.tz;
    }
    // portes : coulissement des vantaux (positions des sommets, seulement quand l'ouverture change)
    const f = this.doors.f;
    for (const m of this.mods) {
      if (!m.leaves.length || Math.abs(m.openF - f) < 1e-4) continue;
      m.openF = f;
      const pos = m.dark.geometry.attributes.position; let k = 0;
      for (const l of m.leaves) { for (let v = 0; v < l.n; v++) pos.setX(l.v0 + v, m.leafBase[k++] + l.dir * f * 0.62); }
      pos.needsUpdate = true;
    }
    // obstacles dynamiques : une boîte par module
    if (this.state !== 'gone') this.game.world.collision?.setDynamic?.('tram' + this.id, this.mods.map((m) => ({ x: m.pose.x, z: m.pose.z, w: HDF.tram.body, d: HDF.tram.width, rot: Math.atan2(m.pose.tz, m.pose.tx), h: HDF.tram.height })));
  }

  // ------------------------------------------------------------------ boucle
  update(dt) {
    const g = this.game, me = g.localId();
    const dSeat = this.seats[0] === me ? 0 : this.seats[1] === me ? 1 : -1;
    const local = this.state === 'ok' && dSeat >= 0;
    const prevS = this.s;
    if (local) this.drive(dt, dSeat);
    else if (!g.isClient && !this.hasDriver) this.freewheel(dt); // personne aux commandes (solo ou hôte) : la rame freine
    else this.follow(dt);
    // portes : animation
    const target = this.doors.open ? 1 : 0, rate = dt / CONFIG.tram.drive.doorTime;
    if (this.doors.f < target) this.doors.f = Math.min(target, this.doors.f + rate); else if (this.doors.f > target) this.doors.f = Math.max(target, this.doors.f - rate);
    this.speed = this.v;
    this.apply(dt);
    this.updateEngine(dt, local);
    this.updateFx(dt);
    if (local && g.isMultiplayer && g.net?.connected) {
      this.sendT -= dt;
      if (this.sendT <= 0) { this.sendT = 0.05; this.sendState(); }
    } else if (!local && !g.isClient && g.isMultiplayer && g.net?.connected && !this.hasDriver && (Math.abs(this.v) > 0.01 || Math.abs(prevS - this.s) > 1e-4)) {
      this.sendT -= dt;
      if (this.sendT <= 0) { this.sendT = 0.05; this.sendState(); } // l'hôte simule la rame sans conducteur : il diffuse
    }
    if (this.sound.gong > 0) this.sound.gong -= dt;
    if (this.gongCd > 0) this.gongCd -= dt; // recharge du gong (v0.39.3 : le compte à rebours ne descendait jamais, un seul gong par partie)
  }
  sendState() { this.game.net?.send({ t: 't_state', id: this.id, s: r2(this.s), v: r2(this.v), d: this.doors.open ? 1 : 0 }); }

  // Rame d'un autre joueur : on rejoint l'état reçu (extrapolé à la vitesse reçue)
  follow(dt) {
    const n = this.net;
    n.s += n.v * dt;
    const k = Math.min(1, dt * 8);
    if (Math.abs(n.s - this.s) > 20) this.s = n.s;
    this.s += (n.s - this.s) * k;
    this.v += (n.v - this.v) * k;
    this.doors.open = !!n.d;
    this.s = clamp(this.s, 0, this.track.L);
  }

  // Sans conducteur : frein d'urgence jusqu'à l'arrêt
  freewheel(dt) {
    const D = CONFIG.tram.drive;
    if (Math.abs(this.v) < 0.02) { this.v = 0; return; }
    const dv = (this.state === 'ok' ? D.emergency : D.brake) * dt;
    this.v = Math.abs(this.v) <= dv ? 0 : this.v - Math.sign(this.v) * dv;
    this.integrate(dt);
  }

  // ------------------------------------------------------------------ limites : gates, extrémités, virages
  // Premier obstacle devant, dans le sens `dir` (+1 / -1) : distance libre du nez (m) jusqu'à une porte de zone fermée ou un heurtoir
  // { d, kind } ; null si rien à moins de lookAhead
  ahead(dir) {
    const T = CONFIG.tram, tr = this.track, nose = this.s + dir * this.L / 2, GAP = T.gate.stopGap;
    let best = null;
    const endD = dir > 0 ? tr.L - 1.2 - nose : nose - 1.2;       // le nez s'arrête à 1,2 m du heurtoir
    best = { d: endD, kind: 'end' };
    for (const gt of this.game.tramGates?.(tr.id) || []) {
      if (gt.door.open) continue;
      const d = dir > 0 ? gt.s - GAP - nose : nose - (gt.s + GAP);
      if (d > -1 && d < best.d) best = { d, kind: 'gate' };
    }
    return best;
  }
  // Plafond de vitesse (m/s, positif) dans le sens `dir` : virages (sqrt(grip R) pour tout le tronçon sous la rame, puis en regardant devant) et obstacles
  limit(dir) {
    const D = CONFIG.tram.drive, tr = this.track;
    let lim = Infinity, why = null;
    const capAt = (s) => { const i = clamp(Math.round(s), 0, tr.n - 1), R = tr.R[i]; return R === Infinity ? Infinity : Math.sqrt(D.grip * R); };
    for (let q = -this.L / 2; q <= this.L / 2; q += 2) { const c = capAt(this.s + q); if (c < lim) { lim = c; why = 'curve'; } }
    const nose = this.s + dir * this.L / 2;
    for (let d = 2; d <= D.lookAhead; d += 2) {
      const c = capAt(nose + dir * d);
      if (c === Infinity) continue;
      const allowed = Math.sqrt(c * c + 2 * D.autoBrake * 0.85 * d); // marge : on freine un peu plus tôt que nécessaire
      if (allowed < lim) { lim = allowed; why = 'curve'; }
    }
    const a = this.ahead(dir);
    if (a) {
      const allowed = Math.sqrt(2 * D.emergency * 0.9 * Math.max(0, a.d));
      if (allowed < lim) { lim = allowed; why = a.kind; }
      return { v: lim, why, d: a.d, kind: a.kind };
    }
    return { v: lim, why, d: Infinity, kind: null };
  }

  integrate(dt) {
    const tr = this.track, T = CONFIG.tram, half = this.L / 2;
    let s = this.s + this.v * dt;
    // butées : extrémités de la ligne (heurtoir) et portes de zone fermées
    let lo = half + 1.2, hi = tr.L - half - 1.2;
    for (const gt of this.game.tramGates?.(tr.id) || []) {
      if (gt.door.open) continue;
      if (this.s <= gt.s) hi = Math.min(hi, gt.s - T.gate.stopGap - half); else lo = Math.max(lo, gt.s + T.gate.stopGap + half);
    }
    if (s > hi) { s = hi; if (this.v > 0) this.v = 0; }
    if (s < lo) { s = lo; if (this.v < 0) this.v = 0; }
    this.s = s;
  }

  // ------------------------------------------------------------------ conduite (client du conducteur)
  drive(dt, dSeat) {
    const T = CONFIG.tram, D = T.drive, g = this.game, K = g.player.keys, B = g.binds, dir = this.cabDir(dSeat);
    const powered = !!g.tramPowered, can = this.state === 'ok' && powered && this.doors.f === 0 && !this.doors.open && !g.player.locked;
    const fwd = can && B.down('forward', K), back = B.down('back', K), emg = B.down('jump', K);
    if (!can && B.down('forward', K) && this.state === 'ok') { // pourquoi la rame ne démarre pas
      this.warnT = (this.warnT ?? 0) - dt;
      if (this.warnT <= 0) { this.warnT = 3.5; if (!powered) hud_(g).announce('HORS TENSION', `Sous-station de l'Homme de Fer : ${T.power.price} pts, une seule fois pour l'équipe`, 3000); else hud_(g).announce('PORTES OUVERTES', `${B.label('tramDoors')} : fermer les portes avant de démarrer`, 2500); }
    }
    let vf = this.v * dir; // vitesse dans le sens de la cabine
    this.throttle = 0;
    if (emg) { const dv = D.emergency * dt; vf = Math.abs(vf) <= dv ? 0 : vf - Math.sign(vf) * dv; if (Math.abs(vf) > 1) this.sound.squeal = 0.3; }
    else if (fwd && !back) {
      this.throttle = 1;
      if (vf < 0) vf += D.brake * 1.5 * dt;
      else vf += D.accel * Math.max(0.05, 1 - (vf / D.maxSpeed) ** 2) * dt;
    } else if (back && !fwd) {
      this.throttle = -1;
      if (vf > 0.15) { vf = Math.max(0, vf - D.brake * dt); this.sound.squeal = Math.max(this.sound.squeal, vf > 2 ? 0.2 : 0); }
      else if (can) vf = Math.max(-D.reverse, vf - D.accel * 0.8 * dt);
      else vf = 0;
    } else { // roue libre : la résistance et un léger frein à l'arrêt
      const dv = D.drag * dt; vf = Math.abs(vf) <= dv ? 0 : vf - Math.sign(vf) * dv;
    }
    vf = clamp(vf, -D.reverse, D.maxSpeed);
    // portes ouvertes ou rame hors tension : pas de traction (la rame peut seulement ralentir)
    if (!can && vf * this.v >= 0) vf = Math.sign(vf) * Math.max(0, Math.abs(vf) - D.drag * 2 * dt);
    // limites : virage, feu rouge, heurtoir
    let v = vf * dir;
    const sgn = Math.sign(v) || dir;
    const lim = this.limit(sgn);
    let av = Math.abs(v);
    if (av > lim.v) {
      const br = lim.why === 'curve' ? D.autoBrake : D.emergency;
      // le frein automatique part de la vitesse de l'image précédente : la traction de cette image (touche d'avance maintenue) ne le contrarie pas (v0.39.2)
      av = Math.max(lim.v, Math.min(av, Math.abs(this.v)) - br * dt * (av > lim.v + 1.5 ? 1.5 : 1));
      if (lim.why === 'curve' && av > lim.v - 0.01) this.alarm(dt, 'VIRAGE', 'Vitesse limitée : ' + Math.round(lim.v * 3.6) + ' km/h');
      else if (lim.kind === 'gate') this.alarm(dt, 'FEU ROUGE', 'Freinage automatique : porte de zone fermée');
      else if (lim.kind === 'end') this.alarm(dt, 'HEURTOIR', 'Fin de ligne : freinage automatique');
      v = sgn * av;
    }
    this.v = v;
    // zombies : au-dessus du seuil on les fauche, en dessous ils bloquent la rame
    const sOld = this.s;
    this.integrate(dt);
    if (this.zombies(dt)) { this.s = sOld; this.v = 0; }
    this.hitPlayers(dt);
    this.syncNet();
    if (this.doors.open && Math.abs(this.v) > D.doorSpeed) this.setDoors(false); // la rame ne roule jamais portes ouvertes
  }

  alarm(dt, title, sub) {
    this.sound.alarm -= dt;
    if (this.sound.alarm > 0) return;
    this.sound.alarm = 0.7;
    this.game.sfx.alarm?.(0.8);
    if (this.limitMsg <= 0) { this.game.hud.announce(title, sub, 1500); this.limitMsg = 3; }
  }

  // Portes de la rame (touche des portes) : à l'arrêt seulement ; carillon
  setDoors(open, quiet = false) {
    if (this.doors.open === open) return;
    this.doors.open = open;
    if (!quiet) this.game.sfx.tramChime?.(open, this.distVol());
    if (this.game.isMultiplayer && !this.game.isClient) this.sendState();
  }
  toggleDoors() {
    if (this.state !== 'ok') return;
    if (Math.abs(this.v) > CONFIG.tram.drive.doorSpeed) { this.game.sfx.deny(); this.game.hud.announce('PORTES', 'Arrêtez la rame pour ouvrir les portes', 1500); return; }
    this.setDoors(!this.doors.open);
    if (this.game.isMultiplayer) this.sendState();
  }

  distVol(maxD = 60) { const d = this.game.player.camera.position.distanceTo(this.group.position); return clamp(1 - d / maxD, 0, 1) ** 2; }

  // Zombies devant le nez (conducteur ou hôte) : renvoie true si un zombie lent bloque la rame
  zombies(dt) {
    const g = this.game, H = CONFIG.tram.hit, v = this.v;
    if (Math.abs(v) < 0.05 || !g.zombies) return false;
    const dir = Math.sign(v), lead = this.mods[dir > 0 ? this.n - 1 : 0].pose, fx_ = lead.tx * dir, fz_ = lead.tz * dir, rx = -lead.tz, rz = lead.tx;
    // zone : devant le centre du module de tête, du nez (2,2 m) à 1,3 m devant, un peu plus large que la caisse
    const noseD = this.M / 2 - 0.15;
    let blocked = false;
    for (const z of g.zombies) {
      if (!z.targetable || z.isBoss) continue;
      const dx = z.pos.x - lead.x, dz = z.pos.z - lead.z, ahead = dx * fx_ + dz * fz_, lat = dx * rx + dz * rz;
      if (ahead < noseD - 1.2 || ahead > noseD + 1.1 || Math.abs(lat) > HDF.tram.width / 2 + 0.5) continue;
      if (Math.abs(v) >= H.zombieSpeed) {
        const until = this.hitCd.get(z.id) ?? 0;
        if (until > g.time) continue;
        this.hitCd.set(z.id, g.time + H.zombieCooldown);
        const dmg = H.zombieK * Math.abs(v);
        g.hitZombie(z, false, new THREE.Vector3(z.pos.x, 1, z.pos.z), dmg, 1);
        g.shake = Math.max(g.shake || 0, 0.15);
      } else blocked = true;
    }
    return blocked;
  }

  // Joueur local à pied touché par une rame rapide (chaque machine règle son propre joueur : jamais mortel)
  hitPlayers(dt) {
    const g = this.game, p = g.player, H = CONFIG.tram.hit;
    if (p.vehicle || p.onTram || p.downed || p.dead) return; // (debout dans la rame : solidaire d'elle, jamais heurté)
    if (Math.abs(this.v) < H.playerSpeed) return;
    for (const m of this.mods) {
      const dx = p.pos.x - m.pose.x, dz = p.pos.z - m.pose.z;
      if (dx * dx + dz * dz > 16) continue;
      const lx = dx * m.pose.tx + dz * m.pose.tz, lz = -dx * m.pose.tz + dz * m.pose.tx;
      if (Math.abs(lx) < HDF.tram.body / 2 + 0.7 && Math.abs(lz) < HDF.tram.width / 2 + 0.7 && (this.hitCd.get('p') ?? 0) <= g.time) {
        this.hitCd.set('p', g.time + 1.2);
        const d = Math.min(H.playerDamage, p.health - 1);
        if (d > 0) p.hurt(d, 'crash');
        g.shake = Math.max(g.shake || 0, 0.4);
        g.sfx.crash?.(0.5);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ effets : fumée selon les PV, moteur
  updateFx(dt) {
    if (this.limitMsg > 0) this.limitMsg -= dt;
    const g = this.game, cam = g.player.camera.position;
    if (Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z) > 80) return;
    const f = this.hpFrac;
    const rate = this.state === 'wreck' ? 12 : f < 0.1 ? 10 : f < 0.25 ? 6 : f < 0.5 ? 3 : 0;
    this.fxAcc += rate * dt;
    const n = Math.floor(this.fxAcc);
    if (n < 1) return;
    this.fxAcc -= n;
    const m = this.mods[Math.floor(this.n / 2) + (Math.random() < 0.5 ? -1 : 1)] || this.mods[0], q = m.pose;
    for (let i = 0; i < n; i++) fx.emit(q.x, 3.5, q.z, { count: 1, color: this.state === 'wreck' ? [0x2a2b2f, 0x35363b] : [0x6b6e73, 0x7c7f84, 0x8d9096], speed: 0.4, up: 1.1, size: 0.34, life: 2.2, grav: -0.5, spread: 0.3, glow: true });
  }
  updateEngine(dt, local) {
    const g = this.game;
    const running = this.hasDriver && this.state === 'ok' && !!g.tramPowered;
    if (running && !this.engine) this.engine = g.sfx.createTramEngine?.() || null;
    if (!running && this.engine) this.stopEngine();
    if (this.sound.squeal > 0) { this.sound.squeal -= dt; if (this.sound.squeal > 0 && Math.abs(this.v) > 1.5) g.sfx.tramBrake?.(this.distVol(), Math.abs(this.v)); }
    if (!this.engine) return;
    const ratio = clamp(Math.abs(this.v) / CONFIG.tram.drive.maxSpeed, 0, 1);
    this.engine.set(ratio, Math.max(0, this.throttle), local ? 1 : this.distVol(70));
  }
  stopEngine() { if (this.engine) { this.engine.stop(); this.engine = null; } }

  // ------------------------------------------------------------------ pour le jeu : textes
  hudInfo() { return { speed: this.v, vmax: CONFIG.tram.drive.maxSpeed, vmin: CONFIG.tram.hit.zombieSpeed, hp: this.hp, hpMax: this.maxHp, fuel: this.fuelFrac, name: 'TRAM', fuelLabel: 'ÉNERGIE' }; }
}

// ====================================================================== installation dans le jeu
export function installTram(game, { world, hud, sfx, scene }) {
  const T = CONFIG.tram;
  const myId = () => game.net?.id ?? 0;
  const tag = (id) => game.binds.tag(id);
  const gatesBy = {};
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();

  Object.assign(game, {
    trams: [],
    tramPowered: false,

    initTrams() {
      const info = world.tram;
      if (!info) return;
      const line = info.net.byId[T.car.start.line], stop = line.stops.find((s) => s.name === T.car.start.stop) || line.stops[0];
      const t = new Tram(this, scene, 0, line, stop.s);
      t.spawn = { x: t.pos.x, z: t.pos.z, yaw: t.yaw };
      this.trams.push(t);
      world.trams = this.trams;
      world.shield = (target, z) => this.tramShield(target, z);
      world.tramGoal = (target, z) => this.tramGoal(target, z);
      world.lure = null;
      for (const g of info.gates) (gatesBy[g.line] ||= []).push(g);
      info.setPowered?.(false);
    },
    tramGates(lineId) { return gatesBy[lineId] || []; },
    resetTrams() {
      for (const t of this.trams) t.reset();
      this.setPower(false, true);
      world.lure = null;
    },
    updateTrams(dt) {
      for (const t of this.trams) t.update(dt);
      const L = world.lure;
      if (L) {
        L.t -= dt;
        const t = this.trams[0];
        if (t) { L.x = t.pos.x; L.z = t.pos.z; }
        if (L.t <= 0) world.lure = null;
      }
    },
    rides() { return [...this.vehicles, ...this.trams]; },
    rideById(id) { return id >= TRAM_ID0 ? this.trams[id - TRAM_ID0] : this.vehicles[id]; },

    // ----------------------------------------------------------- monter : la place la plus proche (cabine près d'un bout de la rame)
    nearTram() {
      const p = this.player;
      if (p.vehicle || p.downed || p.dead) return null;
      if (p.onTram) return this.nearSeatInside(); // debout dans la rame : un siège libre à portée
      const door = this.nearOpenDoor(); // porte ouverte : on monte à pied
      if (door) return door;
      let best = null;
      for (const t of this.trams) {
        if (!t.usable || Math.abs(t.v) > T.drive.boardSpeed) continue;
        let dBody = Infinity;
        for (const m of t.mods) {
          const q = m.pose, dx = p.pos.x - q.x, dz = p.pos.z - q.z, lx = dx * q.tx + dz * q.tz, lz = -dx * q.tz + dz * q.tx;
          dBody = Math.min(dBody, Math.hypot(Math.max(0, Math.abs(lx) - HDF.tram.body / 2), Math.max(0, Math.abs(lz) - HDF.tram.width / 2)));
        }
        if (dBody > 2.2) continue;
        // portes fermées : directement à une place. Bouts : à moins de 4 m du nez, la cabine (si libre) ; sinon la place de passager libre la plus proche
        let seat = -1, bd = Infinity;
        for (const [cab, mi] of [[0, t.n - 1], [1, 0]]) {
          if (t.seats[cab] != null) continue;
          const q = t.mods[mi].pose, ex = q.x + q.tx * (cab === 0 ? 1 : -1) * (t.M / 2), ez = q.z + q.tz * (cab === 0 ? 1 : -1) * (t.M / 2), d = Math.hypot(p.pos.x - ex, p.pos.z - ez);
          if (d < 4 && d < bd) { bd = d; seat = cab; }
        }
        if (seat < 0) {
          bd = Infinity;
          for (let i = 2; i < t.seats.length; i++) {
            if (t.seats[i] != null) continue;
            t.hipWorld(i, tmpV);
            const d = Math.hypot(p.pos.x - tmpV.x, p.pos.z - tmpV.z);
            if (d < bd) { bd = d; seat = i; }
          }
        }
        if (seat < 0) continue;
        if (!best || dBody < best.d) best = { v: t, seat, d: dBody };
      }
      return best;
    },
    tramPrompt(nv) {
      const t = nv.v, seat = nv.seat;
      if (nv.foot) return `${tag('interact')} Monter dans le tram (porte ouverte, PV ${Math.round(t.hpFrac * 100)} %)`;
      const role = t.isDriver(seat) ? ` — conducteur (cabine ${seat === 0 ? 'avant' : 'arrière'})` : ' — passager';
      const power = this.tramPowered ? '' : ' · hors tension';
      if (nv.sit) return `${tag('interact')} S'asseoir${role}${power}`;
      return `${tag('interact')} Monter dans le tram${role} (PV ${Math.round(t.hpFrac * 100)} %${power})`;
    },

    // ----------------------------------------------------------- textes en rame
    tramEnterText(t, seat) {
      const B = game.binds;
      if (t.isDriver(seat)) {
        const pw = this.tramPowered ? '' : ` · HORS TENSION : sous-station de l'Homme de Fer`;
        return [`TRAM — conducteur${pw}`, `${B.moveLabel()} : conduire · ${B.label('jump')} : frein d'urgence · ${B.label('tramDoors')} : portes · ${B.label('tramGong')} : gong · ${B.label('vehicleView')} : vue · ${B.label('interact')} : se lever`];
      }
      return ['TRAM — passager', `Vous êtes assis : tirez ! · ${B.label('tramGong')} : gong · ${B.label('vehicleView')} : vue · ${B.label('interact')} : se lever`];
    },
    tramRideHint(t, seat) {
      const B = game.binds, kE = tag('interact');
      if (t.state !== 'ok') return `${kE} Se lever (rame hors service)`;
      if (t.isDriver(seat)) return `${kE} Se lever · ${tag('tramDoors')} portes ${t.doors.open ? '(ouvertes)' : '(fermées)'} · ${tag('tramGong')} gong · ${tag('jump')} frein d'urgence`;
      return `${kE} Se lever · clic gauche : tirer · ${tag('tramGong')} gong`;
    },

    // ----------------------------------------------------------- sous-station (2000 pts, une fois pour l'équipe)
    nearSubstation() {
      const p = this.player, ss = world.tram?.substation;
      if (!ss || p.vehicle || p.downed || p.dead) return false;
      return Math.hypot(p.pos.x - ss.x, p.pos.z - ss.z) <= T.power.range;
    },
    substationPrompt() {
      if (this.tramPowered) return 'Sous-station : le tram est alimenté';
      return `${tag('interact')} Remettre le courant du tram (${T.power.price} pts, une fois pour toute l'équipe)`;
    },
    useSubstation() {
      if (this.tramPowered) return;
      if (this.points < T.power.price) { sfx.deny(); return; }
      this.points -= T.power.price; // le client paie d'abord (comme la borne des motos) : l'hôte rembourse s'il refuse
      sfx.buy();
      if (this.isClient) this.net?.send({ t: 't_power_req', paid: T.power.price });
      else this.hostPower(null, T.power.price);
    },
    hostPower(pid, paid) {
      const refund = () => { if (pid == null) this.points += paid; else this.net?.send({ t: 't_refund', pts: paid }, pid); };
      if (this.tramPowered) { refund(); return; }
      this.setPower(true);
      if (this.isMultiplayer) this.net?.send({ t: 't_power' });
    },
    setPower(on, silent = false) {
      if (this.tramPowered === on) return;
      this.tramPowered = on;
      world.tram?.setPowered?.(on);
      if (on && !silent) { hud.announce('SOUS-STATION', 'Le tram est alimenté : conduite gratuite', 3500); sfx.tramChime?.(true, 1); }
    },

    // ----------------------------------------------------------- gong, portes (touches en rame)
    tramGong() {
      const rv = this.player.vehicle, t = rv?.v.isTram ? rv.v : this.player.onTram?.v;
      if (!t) return;
      if (t.gongCd > 0) return;
      t.gongCd = T.gong.cooldown;
      sfx.tramGong?.(1);
      if (this.isClient) this.net?.send({ t: 't_gong', id: t.id });
      else { this.setLure(t); if (this.isMultiplayer) this.net?.send({ t: 't_gong_fx', id: t.id }); }
    },
    setLure(t) { world.lure = { x: t.pos.x, z: t.pos.z, t: T.gong.duration, range: T.gong.range }; },
    // Touche des portes : le conducteur (assis) ; sinon, quand personne ne conduit, n'importe quel occupant (assis ou debout), via l'hôte
    tramDoors() {
      const p = this.player, rv = p.vehicle, t = rv?.v.isTram ? rv.v : p.onTram?.v;
      if (!t) return;
      if (rv && rv.v.isDriver(rv.seat)) { t.toggleDoors(); return; }
      if (t.hasDriver) { sfx.deny(); hud.announce('PORTES', 'Le conducteur commande les portes', 1500); return; }
      if (this.isClient) {
        if (Math.abs(t.v) > T.drive.doorSpeed) { sfx.deny(); return; }
        this.net?.send({ t: 't_doors', id: t.id });
      } else t.toggleDoors();
    },
    // (coup de zombie sur un occupant de la rame : tramShield, voir tramInterior.js)

    // ----------------------------------------------------------- PV : l'hôte écrit (damageVehicle), pas de feu ni d'explosion
    hostBreakTram(t) {
      if (t.state !== 'ok') return;
      this.flushVehicleHp(t);
      t.respawnRound = this.round + T.power.respawnRounds;
      if (this.isMultiplayer) this.net?.send({ t: 't_wreck', id: t.id });
      this.startTramWreck(t);
    },
    startTramWreck(t) {
      if (t.state !== 'ok') return;
      t.state = 'wreck'; t.hp = 0; t.hpDirty = false;
      t.setDoors(true, true);
      hud.announce('TRAM HORS SERVICE', `Retour au dépôt dans ${T.power.respawnRounds} manches`, 3500);
    },

    // ----------------------------------------------------------- réseau
    bindTramNet(net) {
      net.on('t_state', (m) => {
        const t = this.rideById(m.id);
        if (!t?.isTram) return;
        const me = myId();
        if (t.seats[0] === me || t.seats[1] === me) return; // je conduis : je suis la source
        t.net = { s: +m.s, v: +m.v, d: m.d ? 1 : 0, t: 0 };
      });
      net.on('t_doors', (m) => { // un occupant sans conducteur demande l'ouverture ou la fermeture des portes : l'hôte décide
        const t = this.rideById(m.id);
        if (this.isHost && t?.isTram && !t.hasDriver) t.toggleDoors();
      });
      net.on('t_gong', (m) => {
        const t = this.rideById(m.id);
        if (!this.isHost || !t?.isTram) return;
        this.setLure(t);
        net.send({ t: 't_gong_fx', id: t.id });
        sfx.tramGong?.(t.distVol());
      });
      net.onHost('t_gong_fx', (m) => { const t = this.rideById(m.id); if (t?.isTram) sfx.tramGong?.(Math.max(0.35, t.distVol(120))); });
      net.on('t_power_req', (m) => { if (this.isHost) this.hostPower(m.from, +m.paid || 0); });
      net.onHost('t_power', () => this.setPower(true));
      net.onHost('t_refund', (m) => { if (+m.pts > 0) { this.points += Math.round(m.pts); hud.announce('SOUS-STATION', `Remboursé : ${Math.round(m.pts)} pts`, 1800); } });
      net.onHost('t_wreck', (m) => { const t = this.rideById(m.id); if (t?.isTram && !this.isHost) this.startTramWreck(t); });
    },
    tramSnapshot() {
      return this.trams.map((t) => ({ id: t.id, tr: 1, s: r2(t.s), v: r2(t.v), d: t.doors.open ? 1 : 0, seats: t.seats, hp: r2(t.hp), st: t.state, back: t.respawnRound, pw: this.tramPowered ? 1 : 0 }));
    },
    applyTramSnapshot(s) {
      const t = this.rideById(s.id);
      if (!t?.isTram) return;
      t.s = +s.s; t.v = +s.v; t.doors.open = !!s.d; t.doors.f = t.doors.open ? 1 : 0; t.seats = s.seats.slice(); t.syncNet(); t.apply(0, true);
      if (s.hp != null) t.hp = clamp(+s.hp, 0, t.maxHp);
      t.respawnRound = s.back || 0;
      if (s.st === 'wreck') { t.state = 'wreck'; t.hp = 0; }
      this.setPower(!!s.pw, true);
    },
  });
}

