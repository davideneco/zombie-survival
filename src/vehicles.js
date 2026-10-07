import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BUILDERS, wreckMaterial } from './vehicleModels.js';
import { fx } from './fx.js';

// Motos : conduite, places (conducteur / passager), collisions, zombies écrasés, synchro réseau.
//  - Le client du CONDUCTEUR simule la moto et diffuse son état 20 fois par seconde ; tous les autres l'interpolent.
//  - Les places sont arbitrées par l'hôte (deux joueurs ne peuvent pas prendre la même) et diffusées à tous.
//  - Un passager voit la moto bouger comme les autres ; son personnage (vu par les coéquipiers) est posé sur la selle.
//  - Points de vie : l'HÔTE est seul à les écrire (v_dmg des clients -> v_hp à tous). À 0 PV : en feu 2 s (v_burn), explosion (v_boom :
//    chaque machine montre l'effet, éjecte son joueur et applique ses propres dégâts), épave, puis retour au parking (v_respawn).
//  - État : 'ok' | 'burning' | 'wreck' (épave visible, sans collision) | 'gone' (disparue, revient à la manche respawnRound).

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const fl = { y: 0, region: 0 };
const tmpV = new THREE.Vector3();

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
    this.crashT = 0; this.sendT = 0; this.hitT = 0;
    this.hp = this.def.hp; this.state = 'ok'; this.burnT = 0; this.wreckT = 0; this.hpDirty = false; this.hpSendT = 0;
    this.respawnRound = 0; this.respawnPending = false; this.respawnRetry = 0; this.fxAcc = 0; this.alarmT = 0;
    this.fuel = this.def.tank; this.fuelLock = 0; this.missCd = 1; this.missT = 0; this.beepT = 0; this.dryNoted = false;
    this.seats.fill(null);
    this.setWreckLook(false);
    this.group.visible = true;
    this.syncNet();
    this.stopEngine();
    this.apply();
  }

  // Épave : matériau noir partagé (les matériaux d'origine sont gardés pour la réapparition)
  setWreckLook(on) {
    if (this.wreckLook === on) return;
    this.wreckLook = on;
    const wm = wreckMaterial();
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      if (on) { o.userData.mat0 ??= o.material; o.material = wm; }
      else if (o.userData.mat0) o.material = o.userData.mat0;
    });
  }

  get maxHp() { return this.def.hp; }
  get fuelFrac() { return this.fuel / this.def.tank; }
  get hpFrac() { return this.hp / this.def.hp; }
  get usable() { return this.state === 'ok'; }

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
    if (this.state === 'gone') return;
    const local = this.state !== 'wreck' && this.seats[0] != null && this.seats[0] === g.localId();
    const prevYaw = this.yaw;
    if (this.crashT > 0) this.crashT -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.state === 'wreck') {
      this.speed = 0; this.dyaw = 0; this.throttle = 0;
      this.wreckT -= dt;
      if (this.wreckT <= 0) { this.state = 'gone'; this.group.visible = false; return; }
    } else if (local) this.drive(dt); else this.follow(dt);
    if (this.state !== 'wreck') this.dyaw = angDiff(this.yaw, prevYaw);
    this.apply(dt);
    this.updateEngine(dt, local);
    this.updateFx(dt);
    if (local && g.isMultiplayer && g.net?.connected) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.05;
        g.net.send({ t: 'v_state', id: this.id, x: r2(this.pos.x), z: r2(this.pos.z), yaw: r2(this.yaw), spd: r2(this.speed), st: r2(this.steer), ln: r2(this.lean), fu: r1(this.fuel) });
      }
    }
  }

  // Fumée (grise sous 50 % des PV, noire sous 25 %, flammèches sous 10 %), flammes pendant l'incendie, fumée de l'épave : particules
  // de fx.emit seulement (aucune lumière). Déduite des PV : chaque machine l'affiche pour elle-même, rien à synchroniser.
  updateFx(dt) {
    const g = this.game, D = CONFIG.vehicles.damage.smoke, cam = g.player.camera.position;
    if (Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z) > 70) return;
    let grey = 0, black = 0, flame = 0;
    if (this.state === 'ok') {
      const f = this.hpFrac;
      if (f < D.black.below) black = D.black.rate; else if (f < D.grey.below) grey = D.grey.rate;
      if (f < D.flames.below) flame = D.flames.rate;
    } else if (this.state === 'burning') { black = 18; flame = 30; }
    else if (this.state === 'wreck') { black = 7; flame = this.wreckT > CONFIG.vehicles.damage.wreckTime - 8 ? 5 : 0; }
    if (this.state === 'burning') {
      this.alarmT -= dt;
      if (this.alarmT <= 0) { this.alarmT = 0.42; g.sfx.alarm?.(Math.max(0, 1 - Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z) / 60)); }
    }
    this.fxAcc += (grey + black + flame) * dt;
    const n = Math.floor(this.fxAcc);
    if (n < 1) return;
    this.fxAcc -= n;
    const o = this.toWorld(this.state === 'wreck' ? [0, 0.4, 0] : [0, 0.62, 0.05], tmpV);
    for (let i = 0; i < n; i++) {
      const r = Math.random() * (grey + black + flame);
      if (r < flame) fx.emit(o.x, o.y, o.z, { count: 1, color: [0xff7a1a, 0xffc04a, 0xff4a10], speed: 0.5, up: 2.0, size: 0.2, life: 0.55, grav: -2.5, spread: 0.3, glow: true });
      else if (r < flame + black) fx.emit(o.x, o.y + 0.2, o.z, { count: 1, color: [0x2a2b2f, 0x35363b, 0x404247], speed: 0.4, up: 1.2, size: 0.3, life: 2.0, grav: -0.7, spread: 0.25, glow: true });
      else fx.emit(o.x, o.y + 0.2, o.z, { count: 1, color: [0x6b6e73, 0x7c7f84, 0x8d9096], speed: 0.35, up: 0.9, size: 0.24, life: 1.7, grav: -0.6, spread: 0.2, glow: true });
    }
  }

  // Pose du modèle : position, cap, inclinaison, guidon, roues
  apply(dt = 0) {
    const m = this.model;
    this.group.position.copy(this.pos);
    if (this.state === 'wreck') { // couchée sur le flanc (côté fixé par le numéro), à plat sur le sol
      this.group.rotation.set(0, this.yaw, (this.id % 2 ? 1 : -1) * 1.5);
      this.group.position.y += 0.45;
      return;
    }
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
    const on = this.state === 'ok'; // en feu : moteur coupé, roue libre, direction à plat
    const fwdKey = on && !!(K.KeyW || K.ArrowUp), backKey = on && !!(K.KeyS || K.ArrowDown), hb = on && !!K.Space;
    const steerIn = on ? (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0) : 0;
    let sp = this.speed;

    // essence : réserve (bips), ratés sous missBelow, panne sèche (poussée au pas)
    const FU = CONFIG.vehicles.fuel, frac = this.fuelFrac, dry = on && this.fuel <= 0;
    let miss = false;
    if (on && !dry && frac < FU.missBelow) {
      this.missCd -= dt;
      if (this.missT > 0) this.missT -= dt;
      else if (this.missCd <= 0) { this.missT = FU.missLen; this.missCd = FU.missEvery * (0.7 + 0.6 * Math.random()); g.sfx.cough?.(0.8); }
      miss = this.missT > 0;
    } else this.missT = 0;
    if (on && !dry && frac < FU.lowBelow) { this.beepT -= dt; if (this.beepT <= 0) { this.beepT = FU.lowBeep; g.sfx.beep?.(); } } else this.beepT = 0;
    if (dry && !this.dryNoted) { this.dryNoted = true; g.sfx.cough?.(1); g.hud.announce('PANNE SÈCHE', 'Plus d\'essence : la moto n\'avance plus qu\'au pas', 3500); }
    if (!dry && this.fuel > 0) this.dryNoted = false;

    // vitesse : accélération qui faiblit près du maximum, freinage, marche arrière, résistance
    const coast = () => { const drag = (D.drag * Math.abs(sp) + 0.8) * dt; sp = Math.abs(sp) <= drag ? 0 : sp - Math.sign(sp) * drag; };
    this.throttle = 0;
    if (fwdKey && !backKey) {
      this.throttle = 1;
      if (sp < 0) sp += D.brake * dt;
      else if (dry) { if (sp < FU.pushSpeed) sp = Math.min(FU.pushSpeed, sp + FU.pushAccel * dt); else coast(); }
      else if (miss) { this.throttle = 0; coast(); }
      else sp += D.accel * Math.max(0.1, 1 - sp / D.maxSpeed) * dt;
    } else if (backKey && !fwdKey) {
      this.throttle = -1;
      sp = sp > 0.3 ? sp - D.brake * dt : Math.max(-(dry ? Math.min(D.reverseSpeed, FU.pushSpeed) : D.reverseSpeed), sp - (dry ? FU.pushAccel : D.accel * 0.5) * dt);
    } else coast();
    if (hb) {
      const b = D.brake * 1.1 * dt;
      sp = Math.abs(sp) <= b ? 0 : sp - Math.sign(sp) * b;
    }
    sp = clamp(sp, -D.reverseSpeed, D.maxSpeed);
    // consommation : ralenti + gaz (marche arrière x 0,6) ; moteur coupé (en feu) ou réservoir vide : rien
    if (on && this.fuel > 0) {
      const gas = this.throttle === 0 ? 0 : (D.gas + D.perSpeed * Math.abs(sp) / D.maxSpeed) * (this.throttle < 0 ? 0.6 : 1);
      this.fuel = Math.max(0, this.fuel - (D.idle + gas) * dt);
    }

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
    if (this.roadkill()) { this.pos.x = ox; this.pos.z = oz; } // arrêtée net par un zombie au contact : on ne le traverse pas
    this.syncNet();
  }

  // Dégâts d'un écrasement à la vitesse `speed` (m/s) : 0 sous le seuil vmin de la moto, puis K x v x r, r montant de 0,4 à 1 sur rampSpeed m/s
  roadkillDamage(speed = this.speed) {
    const RK = this.def.roadkill, v = Math.abs(speed);
    if (v < RK.vmin) return 0;
    return RK.K * v * Math.min(1, 0.4 + 0.6 * (v - RK.vmin) / CONFIG.vehicles.roadkill.rampSpeed);
  }

  // Zombies écrasés. Au-dessus du seuil de vitesse : dégâts, la moto perd de la vitesse. En dessous : aucun dégât, un zombie devant
  // la moto la ralentit (vitesse plafonnée) puis l'arrête net au contact ; il n'est pas déplacé et continue de frapper le pilote.
  // Renvoie true si un zombie au contact bloque la moto (le conducteur annule alors le déplacement de l'image).
  roadkill() {
    const R = CONFIG.vehicles.roadkill, RK = this.def.roadkill, g = this.game, sp = this.speed;
    if (Math.abs(sp) < 0.05) return false;
    const dir = Math.sign(sp), fx = -Math.sin(this.yaw) * dir, fz = -Math.cos(this.yaw) * dir;
    const cx = this.pos.x + fx * 0.6, cz = this.pos.z + fz * 0.6, reach = this.def.radius + 0.45;
    const fast = Math.abs(sp) >= RK.vmin;
    let blocked = false;
    for (const z of g.zombies) {
      if (!z.targetable || z.isBoss) continue;
      const d = Math.hypot(z.pos.x - cx, z.pos.z - cz);
      if (d > reach) continue;
      if (fast) {
        if ((z._runOver || 0) > g.time) continue;
        z._runOver = g.time + R.cooldown;
        const dmg = this.roadkillDamage(sp);
        const killed = g.hitZombie(z, false, new THREE.Vector3(z.pos.x, 1, z.pos.z), dmg, 1) ?? dmg * (z.armor || 1) >= z.health; // client : estimation
        g.damageVehicle(this, killed ? CONFIG.vehicles.damage.roadkillKill : CONFIG.vehicles.damage.roadkillHurt, 'roadkill');
        this.speed *= RK.slowdown;
      } else {
        if (d < R.contactStop) { this.speed = 0; blocked = true; }
        else this.speed = Math.sign(this.speed) * Math.min(Math.abs(this.speed), R.stopSpeed);
      }
    }
    return blocked;
  }

  // Choc : secousse, bruit ; au-dessus du seuil les occupants se blessent (jamais mortel)
  crash(impact) {
    const C = CONFIG.vehicles.crash, g = this.game;
    if (impact < 3) return;
    g.shake = Math.max(g.shake || 0, Math.min(1, impact / 22));
    g.sfx.crash?.(Math.min(1, impact / 20));
    const D = CONFIG.vehicles.damage, wear = Math.max(0, impact - D.crashFree) * D.crashPerMs;
    if (wear > 0 && this.hitT <= 0) { this.hitT = 0.5; g.damageVehicle(this, wear, 'crash'); } // un choc compte une fois (même mur, images suivantes)
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
    const running = this.seats[0] != null && this.state === 'ok' && this.fuel > 0; // pas de conducteur, en feu ou à sec : moteur arrêté
    if (running && !this.engine) this.engine = g.sfx.createEngine?.(this.type) || null;
    if (!running && this.engine) this.stopEngine();
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
      world.onStrike = (target) => this.onZombieStrike(target); // appelé par zombie.js à chaque coup porté à un joueur
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
      if (!this.isClient) for (const v of this.vehicles) this.hostVehicleTick(v, dt);
    },

    // Moto la plus proche avec une place libre : { v, seat } (conducteur d'abord)
    nearVehicle() {
      const p = this.player;
      if (p.vehicle || p.downed || p.dead) return null;
      let best = null, bd = R().mountRange;
      for (const v of this.vehicles) {
        if (!v.usable) continue; // en feu, épave ou disparue : on ne monte pas
        const seat = v.freeSeat();
        if (seat < 0) continue;
        const d = Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z);
        if (d < bd) { bd = d; best = { v, seat }; }
      }
      return best;
    },

    vehiclePrompt(nv) {
      const v = nv.v, role = v.def.seats > 1 ? (nv.seat === 0 ? ' — conducteur' : ' — passager') : '';
      return `[E] Monter sur la ${v.def.name.toLowerCase()}${role} (PV ${Math.round(v.hpFrac * 100)} % · essence ${Math.round(v.fuelFrac * 100)} %)`;
    },

    // ----------------------------------------------------------- points de vie (écrits par l'hôte seul)
    // amt : dégâts (PV) ; src : 'crash' | 'roadkill' | 'zombie' | 'blast' (informatif). Un client demande à l'hôte.
    damageVehicle(v, amt, src = '') {
      if (!(amt > 0) || !v || v.state !== 'ok') return;
      if (this.isClient) { this.net?.send({ t: 'v_dmg', id: v.id, amt: r2(Math.min(amt, 200)), src }); return; }
      v.hp = Math.max(0, v.hp - amt);
      v.hpDirty = true;
      if (v.hp <= 0) this.igniteVehicle(v);
    },

    // Explosions : les motos subissent explosion x les dégâts infligés aux zombies, avec la même atténuation (hôte, voir explode)
    damageVehiclesInRadius(pos, radius, damage) {
      const k = R().damage.explosion;
      for (const v of this.vehicles) {
        if (v.state !== 'ok') continue;
        const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
        if (d < radius) this.damageVehicle(v, damage * k * Math.pow(1 - d / radius, 0.6), 'blast');
      }
    },

    // Un zombie vient de frapper `target` (le joueur local ou un coéquipier) : s'il est sur une moto, elle perd zombieHit PV (hôte)
    onZombieStrike(target) {
      const rv = target === this.player ? this.player.vehicle : target?.ride;
      if (rv?.v) this.damageVehicle(rv.v, R().damage.zombieHit, 'zombie');
    },

    // Mise à feu (hôte) : v_hp puis v_burn à tous
    igniteVehicle(v) {
      if (v.state !== 'ok') return;
      this.flushVehicleHp(v);
      if (this.isMultiplayer) this.net?.send({ t: 'v_burn', id: v.id });
      this.startBurn(v);
    },
    startBurn(v) {
      if (v.state !== 'ok') return;
      v.hp = 0; v.state = 'burning'; v.burnT = R().damage.burnTime; v.alarmT = 0;
      if (this.player.vehicle?.v === v) hud.announce('SAUTEZ !', '[E] : la moto va exploser', 1800);
    },

    // hôte : envoi des PV (au plus 5 fois par seconde), explosion à la fin de l'incendie, réapparition en attente
    hostVehicleTick(v, dt) {
      v.hpSendT -= dt;
      if (v.hpDirty && v.hpSendT <= 0) this.flushVehicleHp(v);
      if (v.state === 'burning') { v.burnT -= dt; if (v.burnT <= 0) this.hostExplodeVehicle(v); }
      if (v.respawnPending) {
        v.respawnRetry -= dt;
        if (v.respawnRetry <= 0) this.hostTryRespawn(v);
      }
    },
    flushVehicleHp(v) {
      v.hpDirty = false; v.hpSendT = 0.2;
      if (this.isMultiplayer) this.net?.send({ t: 'v_hp', id: v.id, hp: r2(v.hp) });
    },

    // Explosion (hôte) : points au conducteur (null : l'hôte ; false : personne), effets chez tous
    hostExplodeVehicle(v) {
      const d0 = v.seats[0], owner = d0 == null ? false : d0 === myId() ? null : d0;
      const x = v.pos.x, z = v.pos.z;
      if (this.isMultiplayer) this.net?.send({ t: 'v_boom', id: v.id, x: r2(x), z: r2(z) });
      v.respawnRound = this.round + R().damage.respawnRounds;
      this.onVehicleBoom(v, x, z, owner);
      if (this.isMultiplayer) { v.seats.fill(null); this.broadcastSeats(v); }
    },

    // Chaque machine : effet, éjection de son joueur, ses propres dégâts (jamais mortels, PHD Flopper protège), épave
    onVehicleBoom(v, x, z, owner = false) {
      const B = R().damage.blast, p = this.player;
      v.state = 'wreck'; v.wreckT = R().damage.wreckTime; v.hp = 0; v.speed = 0; v.hpDirty = false;
      v.setWreckLook(true);
      if (p.vehicle?.v === v) this.ejectFromVehicle(v);
      v.seats.fill(null);
      this.refreshRiders();
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < B.radius && !p.downed && !p.dead) {
        const dmg = Math.min(B.players * (1 - d / B.radius), p.health - 1);
        if (dmg > 0) p.hurt(dmg, 'blast');
      }
      this.shake = Math.max(this.shake || 0, 0.6 * Math.max(0, 1 - d / 40));
      // l'épave a déjà quitté l'état 'ok' : elle ne se blesse pas elle-même ; les autres motos proches, si
      this.explode(new THREE.Vector3(x, 0.6, z), B.radius, B.zombies, owner, B.color, false, 'blast');
    },

    // Descente forcée (explosion) : le joueur est projeté loin de la moto
    ejectFromVehicle(v) {
      const p = this.player;
      this.leaveVehicle();
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z, l = Math.hypot(dx, dz) || 1;
      p.vel.set((dx / l) * 5, 0, (dz / l) * 5); p.vy = 4;
    },

    // ----------------------------------------------------------- réapparition au parking (hôte)
    // À chaque début de manche : les motos détruites dont la manche de retour est arrivée reviennent (si personne n'est sur l'emplacement)
    hostRespawnCheck() {
      for (const v of this.vehicles) {
        if ((v.state === 'wreck' || v.state === 'gone' || v.state === 'burning') && v.respawnRound > 0 && this.round >= v.respawnRound) { v.respawnPending = true; v.respawnRetry = 0; }
      }
    },
    hostTryRespawn(v) {
      const r = R().damage.respawnClear, p = this.player, s = v.spawn;
      const busy = (!p.dead && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < r) || [...this.remotes.values()].some((q) => Math.hypot(q.pos.x - s.x, q.pos.z - s.z) < r);
      if (busy) { v.respawnRetry = R().damage.respawnRetry; return; }
      if (this.isMultiplayer) this.net?.send({ t: 'v_respawn', id: v.id });
      this.respawnVehicle(v);
    },
    respawnVehicle(v) {
      v.reset();
      v.fuel = v.def.tank * R().fuel.respawn; // revient avec 40 % d'essence
      if (this.player.vehicle?.v === v) this.player.vehicle = null;
      this.refreshRiders();
    },

    // ----------------------------------------------------------- monter / descendre
    tryMount(v, seat) {
      if (v.seats[seat] != null || !v.usable) return;
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
        if (this.isMultiplayer) this.net?.send({ t: 'v_state', id: v.id, x: r2(v.pos.x), z: r2(v.pos.z), yaw: r2(v.yaw), spd: 0, st: 0, ln: 0, fu: r1(v.fuel) }); // l'essence passe au prochain conducteur
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
      if (!v || seat < 0 || seat >= v.seats.length || !v.usable) { if (v && pid !== myId()) this.net?.send({ t: 'v_deny', id: vid }, pid); return; }
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
        if (m.fu != null && performance.now() > v.fuelLock) v.fuel = clamp(+m.fu, 0, v.def.tank); // anciens messages : pas de `fu`
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
      net.on('v_deny', () => hud.announce('PLACE INDISPONIBLE', 'Place prise ou moto hors d\'usage.', 1800));
      // points de vie : l'hôte les écrit (v_dmg des clients), les autres les reçoivent
      net.on('v_dmg', (m) => { const v = this.vehicles[m.id]; if (this.isHost && v) this.damageVehicle(v, clamp(+m.amt || 0, 0, 200), m.src || ''); });
      net.on('v_hp', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost && v.state === 'ok') v.hp = clamp(+m.hp, 0, v.maxHp); });
      net.on('v_burn', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.startBurn(v); });
      net.on('v_boom', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.onVehicleBoom(v, m.x, m.z, false); });
      net.on('v_respawn', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.respawnVehicle(v); });
      // borne du parking : le client a déjà payé ; l'hôte vérifie et rend la différence (v_refund)
      net.on('v_fuel', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.setFuel(v, m.fu); });
      net.on('v_service', (m) => { if (this.isHost) this.hostService(m.id, m.from, +m.paid || 0); });
      net.on('v_refund', (m) => { if (+m.pts > 0) { this.points += Math.round(m.pts); hud.announce('BORNE', `Remboursé : ${Math.round(m.pts)} pts`, 1800); } });
      net.on('v_seats', (m) => {
        const v = this.vehicles[m.id];
        if (!v) return;
        v.seats = m.seats.slice();
        const me = v.seats.indexOf(myId());
        if (me >= 0 && !this.player.vehicle) this.enterVehicle(v, me); // ma demande a été acceptée
        else this.refreshRiders();
      });
    },

    // Nouvel arrivant : positions, occupants, PV et état de toutes les motos (wreck : secondes d'épave restantes ; back : manche de retour)
    vehicleSnapshot() {
      return this.vehicles.map((v) => ({ id: v.id, x: v.pos.x, z: v.pos.z, yaw: v.yaw, seats: v.seats, hp: r2(v.hp), fu: r2(v.fuel), st: v.state, wreck: r2(v.wreckT), back: v.respawnRound }));
    },
    applyVehicleSnapshot(list) {
      for (const s of list || []) {
        const v = this.vehicles[s.id];
        if (!v) continue;
        v.pos.set(s.x, 0, s.z); v.yaw = s.yaw; v.speed = 0; v.seats = s.seats.slice(); v.syncNet(); v.apply();
        if (s.hp != null) v.hp = clamp(+s.hp, 0, v.maxHp);
        if (s.fu != null) v.fuel = clamp(+s.fu, 0, v.def.tank);
        v.respawnRound = s.back || 0;
        if (s.st === 'burning') this.startBurn(v);
        else if (s.st === 'wreck' || s.st === 'gone') {
          v.state = s.st; v.hp = 0; v.wreckT = s.wreck || 0; v.seats.fill(null);
          v.setWreckLook(true); v.group.visible = s.st === 'wreck'; v.apply();
        }
      }
      this.refreshRiders();
    },

    // ----------------------------------------------------------- borne du parking : réparation (2 pts / PV)
    // La borne agit sur la moto la plus proche du joueur, à moins de pumpReach m de la borne ; il faut être descendu
    nearPump() {
      const pk = world.parking, p = this.player;
      if (!pk || p.vehicle || p.downed || p.dead) return null;
      if (Math.hypot(p.pos.x - pk.pump.x, p.pos.z - pk.pump.z) > R().pumpRange) return null;
      let best = null, bd = R().pumpReach;
      for (const v of this.vehicles) {
        if (!v.usable) continue;
        const d = Math.hypot(v.pos.x - pk.pump.x, v.pos.z - pk.pump.z);
        if (d <= bd) { bd = d; best = v; }
      }
      return { v: best };
    },
    // Ce que la borne ferait pour la moto : { cost (pts), missing (PV), liters }
    serviceOf(v) {
      const missing = Math.max(0, v.maxHp - v.hp), liters = Math.max(0, v.def.tank - v.fuel);
      return { missing, liters, cost: Math.ceil(missing * R().damage.repairPrice + liters * R().fuel.pricePerL - 1e-6) };
    },
    pumpPrompt(np) {
      if (!np.v) return 'Borne du parking : aucune moto à portée (8 m)';
      const sv = this.serviceOf(np.v), name = np.v.def.name;
      if (sv.cost <= 0) return `${name} : plein fait, en parfait état`;
      return `[E] Plein + réparation ${name} : ${sv.cost} pts (essence ${Math.round(np.v.fuelFrac * 100)} % · PV ${Math.round(np.v.hpFrac * 100)} %)`;
    },
    usePump(np) {
      const v = np.v;
      if (!v) { sfx.deny(); return; }
      const sv = this.serviceOf(v);
      if (sv.cost <= 0) return;
      if (this.points < sv.cost) { sfx.deny(); return; }
      this.points -= sv.cost; // le client paie d'abord (comme les portes) : l'hôte rembourse s'il refuse
      sfx.buy();
      hud.announce(v.def.name, `Plein + réparation : −${sv.cost} pts`, 2200);
      if (this.isClient) this.net?.send({ t: 'v_service', id: v.id, paid: sv.cost });
      else this.hostService(v.id, null, sv.cost);
    },
    // Essence absolue d'une moto (hôte : à la borne ou au bidon ; v_fuel : les autres l'adoptent, conducteur compris)
    setFuel(v, fu, broadcast = false) {
      v.fuel = clamp(+fu, 0, v.def.tank);
      v.fuelLock = performance.now() + 300; // un v_state déjà en route avec l'ancienne valeur ne doit pas l'écraser
      if (broadcast && this.isMultiplayer) this.net?.send({ t: 'v_fuel', id: v.id, fu: r2(v.fuel) });
    },

    // Bidon d'essence (hôte) : 3 % par zombie tué, seulement si une moto en état est sous 50 % de réservoir, un seul à la fois au sol
    maybeDropFuel(pos) {
      const F = R().fuel;
      if (this.isClient || Math.random() >= F.dropChance) return;
      if (this.powerups.some((q) => q.type === 'fuel') || !this.vehicles.some((v) => v.usable && v.fuelFrac < F.dropBelow)) return;
      this.spawnPowerup(pos, null, 'fuel');
    },
    // Bidon ramassé par `pid` (hôte) : +jerrican L à la moto du ramasseur, sinon à la moto la plus vide
    hostFuelPickup(pid) {
      const F = R().fuel;
      let v = this.vehicles.find((q) => q.usable && q.seats.includes(pid));
      if (!v) v = this.vehicles.filter((q) => q.usable).sort((a, b) => a.fuelFrac - b.fuelFrac)[0];
      if (v) this.setFuel(v, v.fuel + F.jerrican, true);
      return v;
    },

    // hôte : applique le service payé `paid` par le joueur `pid` (null : l'hôte lui-même) ; rembourse l'excédent ou tout si impossible
    hostService(vid, pid, paid) {
      const v = this.vehicles[vid];
      const refund = (pts) => { if (pts <= 0) return; if (pid == null) this.points += pts; else this.net?.send({ t: 'v_refund', pts }, pid); };
      if (!v || !v.usable) { refund(paid); return; }
      const sv = this.serviceOf(v);
      if (sv.cost <= 0 || sv.cost > paid) { refund(paid); return; } // déjà en parfait état, ou plus abîmée depuis : on rend tout
      v.hp = v.maxHp;
      this.flushVehicleHp(v);
      this.setFuel(v, v.def.tank, true);
      refund(paid - sv.cost);
    },
  });
}
