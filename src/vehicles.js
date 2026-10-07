import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BUILDERS } from './vehicleModels.js';

// Motos : conduite, places (conducteur / passager), collisions, zombies écrasés, synchro réseau.
//  - Le client du CONDUCTEUR simule la moto et diffuse son état 20 fois par seconde ; tous les autres l'interpolent.
//  - Les places sont arbitrées par l'hôte (deux joueurs ne peuvent pas prendre la même) et diffusées à tous.
//  - Un passager voit la moto bouger comme les autres ; son personnage (vu par les coéquipiers) est posé sur la selle.

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const fl = { y: 0, region: 0 };

export class Vehicle {
  constructor(game, scene, id, type, spawn) {
    this.game = game;
    this.id = id;
    this.type = type;
    this.def = CONFIG.vehicles.types[type];
    this.spawn = { x: spawn.x, z: spawn.z, yaw: spawn.yaw };
    this.model = BUILDERS[type]();
    this.group = this.model.group;
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.seats = Array(this.def.seats).fill(null); // id réseau du joueur assis (0 en solo), null = libre
    this.engine = null;
    this.reset();
  }

  reset() {
    const s = this.spawn;
    this.pos.set(s.x, 0, s.z);
    this.yaw = s.yaw; this.dyaw = 0;
    this.speed = 0; this.steer = 0; this.steerAngle = 0; this.lean = 0; this.wheelRot = 0; this.throttle = 0;
    this.crashT = 0; this.sendT = 0;
    this.seats.fill(null);
    this.syncNet();
    this.stopEngine();
    this.apply();
  }

  // état cible (reçu du conducteur) vers lequel on interpole quand on ne conduit pas
  syncNet() { this.net = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, speed: this.speed, steer: this.steer, lean: this.lean }; }

  // point local de la moto -> monde (sans tenir compte de l'inclinaison, négligeable pour une position)
  toWorld(p, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + c * p[0] + s * p[2], this.pos.y + p[1], this.pos.z - s * p[0] + c * p[2]);
  }
  hipWorld(seat, out) { return this.toWorld(this.model.seats[seat].hip, out); }
  eyeWorld(seat, out) { return this.toWorld(this.model.seats[seat].eye, out); }

  get hasDriver() { return this.seats[0] != null; }
  freeSeat() { return this.seats.findIndex((s) => s == null); }

  // ------------------------------------------------------------------ boucle
  update(dt) {
    const g = this.game;
    const local = this.seats[0] != null && this.seats[0] === g.localId();
    const prevYaw = this.yaw;
    if (this.crashT > 0) this.crashT -= dt;
    if (local) this.drive(dt); else this.follow(dt);
    this.dyaw = angDiff(this.yaw, prevYaw);
    this.apply(dt);
    this.updateEngine(dt, local);
    if (local && g.isMultiplayer && g.net?.connected) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.05;
        g.net.send({ t: 'v_state', id: this.id, x: r2(this.pos.x), z: r2(this.pos.z), yaw: r2(this.yaw), spd: r2(this.speed), st: r2(this.steer), ln: r2(this.lean) });
      }
    }
  }

  // Pose du modèle : position, cap, inclinaison, guidon, roues
  apply(dt = 0) {
    const m = this.model;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, this.lean);
    m.steer.rotation.y = -this.steerAngle;
    this.wheelRot += (this.speed / m.wheelRadius) * dt;
    for (const w of m.wheels) w.rotation.x = -this.wheelRot;
  }

  // Moto d'un autre joueur (ou garée) : on rejoint doucement le dernier état reçu
  follow(dt) {
    const n = this.net, k = Math.min(1, dt * 10);
    if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 15) { this.pos.x = n.x; this.pos.z = n.z; this.yaw = n.yaw; }
    this.pos.x += (n.x - this.pos.x) * k;
    this.pos.z += (n.z - this.pos.z) * k;
    this.yaw += angDiff(n.yaw, this.yaw) * k;
    this.speed += (n.speed - this.speed) * k;
    this.steer += (n.steer - this.steer) * k;
    this.lean += (n.lean - this.lean) * k;
    this.steerAngle = this.steer * this.def.maxSteer / (1 + Math.abs(this.speed) * 0.12);
    this.throttle = 0;
  }

  // ------------------------------------------------------------------ conduite (client du conducteur)
  drive(dt) {
    const D = this.def, g = this.game, K = g.player.keys;
    const fwdKey = !!(K.KeyW || K.ArrowUp), backKey = !!(K.KeyS || K.ArrowDown), hb = !!K.Space;
    const steerIn = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let sp = this.speed;

    // vitesse : accélération qui faiblit près du maximum, freinage, marche arrière, résistance
    this.throttle = 0;
    if (fwdKey && !backKey) {
      this.throttle = 1;
      sp += (sp < 0 ? D.brake : D.accel * Math.max(0.1, 1 - sp / D.maxSpeed)) * dt;
    } else if (backKey && !fwdKey) {
      this.throttle = -1;
      sp = sp > 0.3 ? sp - D.brake * dt : Math.max(-D.reverseSpeed, sp - D.accel * 0.5 * dt);
    } else {
      const drag = (D.drag * Math.abs(sp) + 0.8) * dt;
      sp = Math.abs(sp) <= drag ? 0 : sp - Math.sign(sp) * drag;
    }
    if (hb) {
      const b = D.brake * 1.1 * dt;
      sp = Math.abs(sp) <= b ? 0 : sp - Math.sign(sp) * b;
    }
    sp = clamp(sp, -D.reverseSpeed, D.maxSpeed);

    // direction : angle de braquage qui diminue avec la vitesse, modèle « bicyclette » ; le frein à main donne du dérapage
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 7);
    this.steerAngle = this.steer * D.maxSteer / (1 + Math.abs(sp) * 0.12);
    let yawRate = -(sp / D.wheelbase) * Math.tan(this.steerAngle) * (hb ? 1.5 : 1);
    const maxYaw = (D.grip * (hb ? 1.6 : 1)) / Math.max(3, Math.abs(sp)); // limite d'adhérence : à haute vitesse, on ne tourne plus sec
    yawRate = clamp(yawRate, -maxYaw, maxYaw);
    this.yaw += yawRate * dt;
    this.lean += (clamp(yawRate * Math.abs(sp) * 0.035, -0.55, 0.55) - this.lean) * Math.min(1, dt * 6);

    // déplacement + collisions (murs, voitures, mobilier) ; on ne monte pas d'escalier ni ne descend de trou
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ox = this.pos.x, oz = this.pos.z;
    const p = { x: ox + fx * sp * dt, y: 0.1, z: oz + fz * sp * dt };
    g.world.collide(p, D.radius);
    const cx = p.x - (ox + fx * sp * dt), cz = p.z - (oz + fz * sp * dt), cl = Math.hypot(cx, cz);
    g.world.floorAt?.(p.x, p.z, 0.1, fl);
    if (g.world.floorAt && (fl.region !== 0 || Math.abs(fl.y) > 0.25)) { // marche, trou : on ne passe pas
      this.crash(Math.abs(sp));
      sp = -sp * 0.15;
    } else {
      this.pos.x = p.x; this.pos.z = p.z;
      if (cl > 1e-4) { // poussée du mur : plus on fonce dedans de face, plus on perd de vitesse
        const into = clamp(-(fx * cx + fz * cz) / cl * Math.sign(sp), 0, 1);
        if (into > 0.05) {
          this.crash(Math.abs(sp) * into);
          sp *= 1 - 0.92 * into * into;
        }
      }
    }
    this.speed = sp;
    this.roadkill();
    this.syncNet();
  }

  // Zombies écrasés : dégâts proportionnels à la vitesse, la moto ralentit un peu
  roadkill() {
    const R = CONFIG.vehicles.roadkill, g = this.game, sp = this.speed;
    if (Math.abs(sp) < R.minSpeed) return;
    const dir = Math.sign(sp), fx = -Math.sin(this.yaw) * dir, fz = -Math.cos(this.yaw) * dir;
    const cx = this.pos.x + fx * 0.6, cz = this.pos.z + fz * 0.6, reach = this.def.radius + 0.45;
    for (const z of g.zombies) {
      if (!z.targetable || z.isBoss || (z._runOver || 0) > g.time) continue;
      if (Math.hypot(z.pos.x - cx, z.pos.z - cz) > reach) continue;
      z._runOver = g.time + R.cooldown;
      g.hitZombie(z, false, new THREE.Vector3(z.pos.x, 1, z.pos.z), Math.abs(sp) * this.def.roadkill, 1);
      this.speed *= R.slowdown;
    }
  }

  // Choc : secousse, bruit ; au-dessus du seuil les occupants se blessent (jamais mortel)
  crash(impact) {
    const C = CONFIG.vehicles.crash, g = this.game;
    if (impact < 3) return;
    g.shake = Math.max(g.shake || 0, Math.min(1, impact / 22));
    g.sfx.crash?.(Math.min(1, impact / 20));
    if (impact < C.minSpeed || this.crashT > 0) return;
    this.crashT = 0.8;
    const dmg = Math.min(C.maxDamage, (impact - C.minSpeed) * C.damagePerMs);
    this.seats.forEach((pid) => {
      if (pid == null) return;
      if (pid === g.localId()) { const p = g.player, d = Math.min(dmg, p.health - 1); if (d > 0) p.hurt(d, 'crash'); }
      else { const rp = g.remotes.get(pid), d = rp ? Math.min(dmg, rp.health - 1) : 0; if (d > 0) rp.hurt(d, 0, 0, 'crash'); }
    });
  }

  // ------------------------------------------------------------------ son du moteur
  updateEngine(dt, local) {
    const g = this.game;
    if (this.seats[0] != null && !this.engine) this.engine = g.sfx.createEngine?.(this.type) || null;
    if (this.seats[0] == null && this.engine) this.stopEngine();
    if (!this.engine) return;
    // 4 rapports : le régime retombe à chaque passage de vitesse
    const ratio = clamp(Math.abs(this.speed) / this.def.maxSpeed, 0, 1), gears = 4, gear = Math.min(gears - 1, Math.floor(ratio * gears));
    const rpm = clamp(0.22 + 0.68 * (ratio * gears - gear) + Math.max(0, this.throttle) * 0.08, 0.15, 1);
    const d = g.player.camera.position.distanceTo(this.group.position);
    this.engine.set(rpm, this.throttle, ratio, local ? 1 : clamp(1 - d / 55, 0, 1) ** 2);
  }
  stopEngine() { if (this.engine) { this.engine.stop(); this.engine = null; } }
}

// ====================================================================== installation dans le jeu
export function installVehicles(game, { world, hud, sfx, scene }) {
  const myId = () => game.net?.id ?? 0;
  const R = () => CONFIG.vehicles;
  const pt = new THREE.Vector3();

  Object.assign(game, {
    vehicles: [],
    localId: myId,

    initVehicles() {
      this.vehicles = (world.vehicleSpawns || []).map((s, i) => new Vehicle(this, scene, i, s.type, s));
      world.vehicles = this.vehicles; // pour la carte
    },

    resetVehicles() {
      for (const v of this.vehicles) v.reset();
      this.player.vehicle = null;
      this.refreshRiders();
    },

    updateVehicles(dt) {
      const p = this.player;
      if (p.vehicle && (p.downed || p.dead)) this.leaveVehicle(); // à terre : on est éjecté
      for (const v of this.vehicles) v.update(dt);
    },

    // Moto la plus proche avec une place libre : { v, seat } (conducteur d'abord)
    nearVehicle() {
      const p = this.player;
      if (p.vehicle || p.downed || p.dead) return null;
      let best = null, bd = R().mountRange;
      for (const v of this.vehicles) {
        const seat = v.freeSeat();
        if (seat < 0) continue;
        const d = Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z);
        if (d < bd) { bd = d; best = { v, seat }; }
      }
      return best;
    },

    vehiclePrompt(nv) {
      const role = nv.v.def.seats > 1 ? (nv.seat === 0 ? ' (conducteur)' : ' (passager)') : '';
      return `[E] Monter sur la ${nv.v.def.name.toLowerCase()}${role}`;
    },

    // ----------------------------------------------------------- monter / descendre
    tryMount(v, seat) {
      if (v.seats[seat] != null) return;
      if (!this.isMultiplayer) { v.seats[seat] = myId(); this.enterVehicle(v, seat); }
      else if (this.isHost) this.hostSeat(v.id, seat, myId());
      else this.net?.send({ t: 'v_req', id: v.id, seat }); // réponse : v_seats
    },

    enterVehicle(v, seat) {
      const p = this.player;
      if (p.vehicle) return;
      p.vehicle = { v, seat };
      p.yaw = v.yaw; p.pitch = 0;
      p.mouseDown = false; p.aiming = false;
      v.syncNet();
      sfx.mount?.(v.type);
      hud.announce(v.def.name, seat === 0 ? 'ZQSD : conduire · Espace : frein à main · E : descendre' : 'Vous êtes passager : tirez ! · E : descendre', 3500);
      this.refreshRiders();
    },

    leaveVehicle() {
      const p = this.player, rv = p.vehicle;
      if (!rv) return;
      const { v, seat } = rv;
      // on descend sur le côté (gauche pour le conducteur, droite pour le passager), sinon de l'autre côté
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      v.hipWorld(seat, pt);
      let ex = pt.x, ez = pt.z;
      for (const side of [seat === 0 ? -1 : 1, seat === 0 ? 1 : -1]) {
        const q = { x: pt.x + c * side * 1.0, y: 0.1, z: pt.z - s * side * 1.0 };
        world.collide(q, 0.4);
        ex = q.x; ez = q.z;
        if (Math.hypot(q.x - (pt.x + c * side), q.z - (pt.z - s * side)) < 0.3) break;
      }
      const sp = v.speed, fx = -s, fz = -c;
      world.floorAt?.(ex, ez, 0.1, fl);
      p.pos.set(ex, world.floorAt ? fl.y : 0, ez);
      p.vel.set(clamp(fx * sp * 0.3, -6, 6), 0, clamp(fz * sp * 0.3, -6, 6));
      p.vy = 0; p.vehicle = null;
      if (seat === 0) { // le conducteur descend : la moto s'arrête là
        v.speed = 0; v.steer = 0; v.lean = 0; v.throttle = 0; v.syncNet();
        if (this.isMultiplayer) this.net?.send({ t: 'v_state', id: v.id, x: r2(v.pos.x), z: r2(v.pos.z), yaw: r2(v.yaw), spd: 0, st: 0, ln: 0 });
      }
      sfx.knock?.(0.5);
      if (!this.isMultiplayer) v.seats[seat] = null;
      else if (this.isHost) { v.seats[seat] = null; this.broadcastSeats(v); }
      else { v.seats[seat] = null; this.net?.send({ t: 'v_leave', id: v.id }); }
      this.refreshRiders();
    },

    // ----------------------------------------------------------- places (arbitrées par l'hôte)
    hostSeat(vid, seat, pid) {
      const v = this.vehicles[vid];
      if (!v || seat < 0 || seat >= v.seats.length) return;
      if (v.seats[seat] != null && v.seats[seat] !== pid) { if (pid !== myId()) this.net?.send({ t: 'v_deny', id: vid }, pid); return; }
      this.freeSeatsOf(pid, v, seat);
      v.seats[seat] = pid;
      this.broadcastSeats(v);
      if (pid === myId()) this.enterVehicle(v, seat);
      else this.refreshRiders();
    },

    // libère les places d'un joueur (sauf `keep` : la place qu'il vient de prendre)
    freeSeatsOf(pid, keepV = null, keepSeat = -1) {
      for (const v of this.vehicles) v.seats.forEach((s, i) => { if (s === pid && !(v === keepV && i === keepSeat)) { v.seats[i] = null; if (v !== keepV) this.broadcastSeats(v); } });
    },

    broadcastSeats(v) { if (this.isMultiplayer) this.net?.send({ t: 'v_seats', id: v.id, seats: v.seats }); },

    onPeerLeft(pid) {
      if (!this.isHost) return;
      this.freeSeatsOf(pid);
      for (const v of this.vehicles) this.broadcastSeats(v);
      this.refreshRiders();
    },

    // coéquipiers assis sur une moto : leur personnage est posé sur la selle
    refreshRiders() {
      const riding = new Map();
      for (const v of this.vehicles) v.seats.forEach((pid, i) => { if (pid != null && pid !== myId()) riding.set(pid, { v, seat: i }); });
      for (const [pid, rp] of this.remotes) {
        const r = riding.get(pid);
        if (r) rp.setRide(r.v, r.seat); else rp.clearRide();
      }
    },

    // ----------------------------------------------------------- réseau
    bindVehicleNet(net) {
      net.on('v_state', (m) => {
        const v = this.vehicles[m.id];
        if (!v || v.seats[0] === myId()) return;
        v.net = { x: m.x, z: m.z, yaw: m.yaw, speed: m.spd, steer: m.st, lean: m.ln };
      });
      net.on('v_req', (m) => { if (this.isHost) this.hostSeat(m.id, m.seat, m.from); });
      net.on('v_leave', (m) => {
        if (!this.isHost) return;
        const v = this.vehicles[m.id];
        if (!v) return;
        v.seats.forEach((s, i) => { if (s === m.from) v.seats[i] = null; });
        this.broadcastSeats(v);
        this.refreshRiders();
      });
      net.on('v_deny', () => hud.announce('PLACE PRISE', 'Un coéquipier est déjà assis là.', 1800));
      net.on('v_seats', (m) => {
        const v = this.vehicles[m.id];
        if (!v) return;
        v.seats = m.seats.slice();
        const me = v.seats.indexOf(myId());
        if (me >= 0 && !this.player.vehicle) this.enterVehicle(v, me); // ma demande a été acceptée
        else this.refreshRiders();
      });
    },

    // Nouvel arrivant : positions et occupants de toutes les motos
    vehicleSnapshot() { return this.vehicles.map((v) => ({ id: v.id, x: v.pos.x, z: v.pos.z, yaw: v.yaw, seats: v.seats })); },
    applyVehicleSnapshot(list) {
      for (const s of list || []) {
        const v = this.vehicles[s.id];
        if (!v) continue;
        v.pos.set(s.x, 0, s.z); v.yaw = s.yaw; v.speed = 0; v.seats = s.seats.slice(); v.syncNet(); v.apply();
      }
      this.refreshRiders();
    },
  });
}
