import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BUILDERS, wreckMaterial } from './vehicleModels.js';
import { fx } from './fx.js';

// Motos et vélos : conduite, places (conducteur / passager), collisions, zombies écrasés, synchro réseau.
//  - Le client du CONDUCTEUR simule la moto et diffuse son état 20 fois par seconde ; tous les autres l'interpolent.
//  - Les places sont arbitrées par l'hôte (deux joueurs ne peuvent pas prendre la même) et diffusées à tous.
//  - Un passager voit la moto bouger comme les autres ; son personnage (vu par les coéquipiers) est posé sur la selle.
//  - Points de vie : l'HÔTE est seul à les écrire (v_dmg des clients -> v_hp à tous). À 0 PV : en feu 2 s (v_burn), explosion (v_boom :
//    chaque machine montre l'effet, éjecte son joueur et applique ses propres dégâts), épave, puis retour au parking (v_respawn).
//  - État : 'ok' | 'burning' | 'wreck' (épave visible, sans collision) | 'gone' (disparue, revient à la manche respawnRound).
//  - Le vélo (type sans réservoir et sans explosion : def.tank 0, def.blast null) suit les mêmes règles, mais à 0 PV il est seulement CASSÉ :
//    pas d'incendie ni d'explosion (v_break), épave def.wreckTime s puis retour à sa station gratuitement (v_respawn).

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const fl = { y: 0, region: 0 };
const tmpV = new THREE.Vector3();
const colOut = { kind: null, push: 0, nx: 0, nz: 0 }; // nature et normale de la poussée la plus forte (Collision.resolve)

export class Vehicle {
  constructor(game, scene, id, type, spawn) {
    this.game = game;
    this.id = id;
    this.type = type;
    this.variant = spawn.variant ?? 0;
    this.def = CONFIG.vehicles.types[type];
    this.spawn = { x: spawn.x, z: spawn.z, yaw: spawn.yaw };
    this.model = BUILDERS[type](this.variant);
    this.station = spawn.station ?? -1; // station de vélos d'attache (-1 : une moto de parking)
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
    this.speed = 0; this.vLat = 0; this.steer = 0; this.steerAngle = 0;
    this.lean = 0; this.rollVel = 0; this.pitch = 0; this.pitchVel = 0; this.suspY = 0; this.suspVel = 0;
    this.wheelRot = 0; this.throttle = 0; this.braking = false; this.gear = 1;
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
    const walk = (o) => {
      if (o.userData.noWreck) return; // les personnages assis sur la moto (groupes fils) gardent leurs couleurs
      if (o.isMesh) {
        if (on) { o.userData.mat0 ??= o.material; o.material = wm; }
        else if (o.userData.mat0) o.material = o.userData.mat0;
      }
      for (const c of o.children) walk(c);
    };
    walk(this.group);
  }

  get maxHp() { return this.def.hp; }
  get hasTank() { return this.def.tank > 0; }                       // un vélo n'a pas de réservoir
  get fuelFrac() { return this.hasTank ? this.fuel / this.def.tank : 1; } // (sans réservoir : toujours « plein », jamais 0/0)
  get hpFrac() { return this.hp / this.def.hp; }
  get usable() { return this.state === 'ok'; }

  // état cible (reçu du conducteur) vers lequel on interpole quand on ne conduit pas
  syncNet() {
    this.net = {
      x: this.pos.x, z: this.pos.z, yaw: this.yaw, speed: this.speed, steer: this.steer, lean: this.lean,
      pitch: this.pitch || 0, suspY: this.suspY || 0, vLat: this.vLat || 0, braking: !!this.braking, throttle: this.throttle || 0,
    };
  }

  // point local de la moto -> monde (sans tenir compte de l'inclinaison, négligeable pour une position)
  toWorld(p, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + c * p[0] + s * p[2], this.pos.y + p[1], this.pos.z - s * p[0] + c * p[2]);
  }
  hipWorld(seat, out) { return this.toWorld(this.model.seats[seat].hip, out); }
  eyeWorld(seat, out) { return this.toWorld(this.model.seats[seat].eye, out); }
  seatParent() { return this.model.body || this.group; } // sur voiture/4x4, les occupants suivent la carrosserie suspendue

  get hasDriver() { return this.seats[0] != null; }
  isDriver(seat) { return seat === 0; }          // la place de conducteur (les rames de tram en ont deux : une par cabine)
  seatYaw() { return this.yaw; }                  // cap de la place (les modules d'une rame ont chacun le leur)
  seatDyaw() { return this.dyaw; }
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
      if (this.wreckT <= 0) {
        if (g.world?.isCircuitTest && !g.isClient) {
          g.respawnVehicle(this);
          if (g.isMultiplayer) g.net?.send({ t: 'v_respawn', id: this.id });
          return;
        }
        this.state = 'gone'; this.group.visible = false; return;
      }
    } else if (local) this.drive(dt); else this.follow(dt);
    if (this.state !== 'wreck') this.dyaw = angDiff(this.yaw, prevYaw);
    this.apply(dt);
    this.updateEngine(dt, local);
    this.updateFx(dt);
    if (local && g.isMultiplayer && g.net?.connected) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.05;
        g.net.send({
          t: 'v_state', id: this.id, x: r2(this.pos.x), z: r2(this.pos.z), yaw: r2(this.yaw),
          spd: r2(this.speed), st: r2(this.steer), ln: r2(this.lean), fu: r1(this.fuel),
          pt: r2(this.pitch || 0), sy: r2(this.suspY || 0), vl: r2(this.vLat || 0), br: this.braking ? 1 : 0, th: this.throttle || 0,
        });
      }
    }
  }

  // Fumée (grise sous 50 % des PV, noire sous 25 %, flammèches sous 10 %), flammes pendant l'incendie, fumée de l'épave : particules
  // de fx.emit seulement (aucune lumière). Déduite des PV : chaque machine l'affiche pour elle-même, rien à synchroniser.
  updateFx(dt) {
    const g = this.game, D = CONFIG.vehicles.damage.smoke, cam = g.player.camera.position;
    if (this.def.fx === false) return; // un vélo ne fume pas
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

  // Pose du modèle : position, cap, inclinaison de caisse suspendue, braquage Ackermann, roues et optiques
  apply(dt = 0) {
    const m = this.model;
    this.group.position.copy(this.pos);
    if (this.state === 'wreck') { // couchée sur le flanc (côté fixé par le numéro), à plat sur le sol
      if (m.body) { m.body.rotation.set(0, 0, 0); m.body.position.y = 0; }
      this.group.rotation.set(0, this.yaw, (this.id % 2 ? 1 : -1) * 1.5);
      this.group.position.y += this.def.wreckLift ?? 0.45;
      return;
    }
    if (m.body) {
      // Les 4 roues restent plaquées à plat sur l'asphalte tandis que la carrosserie suspendue tangue, roule et rebondit
      this.group.rotation.set(0, this.yaw, 0);
      m.body.rotation.set(this.pitch || 0, 0, this.lean || 0);
      m.body.position.y = this.suspY || 0;
    } else {
      this.group.rotation.set(this.pitch || 0, this.yaw, this.lean);
    }

    if (m.steerLeft && m.steerRight) {
      // Géométrie de direction Ackermann : la roue intérieure braque davantage que la roue extérieure
      const sa = this.steerAngle;
      m.steerLeft.rotation.y = -(sa < 0 ? sa * 1.14 : sa * 0.88);
      m.steerRight.rotation.y = -(sa > 0 ? sa * 1.14 : sa * 0.88);
      if (m.volant) m.volant.rotation.z = sa * 4.2;
    } else if (m.steer) {
      m.steer.rotation.y = -this.steerAngle;
    }
    this.wheelRot += (this.speed / m.wheelRadius) * dt;
    for (const w of m.wheels) w.rotation.x = -this.wheelRot;
    if (m.crank) m.crank.rotation.x = -this.wheelRot * m.crankRatio; // le pédalier tourne avec les roues

    // Phares avant, feux stop dynamiques et feux de recul
    if (m.headlights) {
      const lightsOn = this.hasDriver && this.state === 'ok';
      for (const h of m.headlights) h.visible = lightsOn;
    }
    if (m.brakeMat) {
      m.brakeMat.emissiveIntensity = (this.hasDriver && this.braking) ? 5.2 : 1.5;
    }
    if (m.revMat) {
      m.revMat.emissiveIntensity = (this.hasDriver && this.speed < -0.25) ? 3.8 : 0;
    }
  }

  // Moto ou voiture d'un autre joueur (ou garée) : on rejoint doucement le dernier état reçu (suspension, feux stop et fumée de drift compris)
  follow(dt) {
    const n = this.net, k = Math.min(1, dt * 10);
    if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 15) { this.pos.x = n.x; this.pos.z = n.z; this.yaw = n.yaw; }
    this.pos.x += (n.x - this.pos.x) * k;
    this.pos.z += (n.z - this.pos.z) * k;
    this.yaw += angDiff(n.yaw, this.yaw) * k;
    this.speed += (n.speed - this.speed) * k;
    this.steer += (n.steer - this.steer) * k;
    this.lean += (n.lean - this.lean) * k;
    this.pitch = (this.pitch || 0) + ((n.pitch || 0) - (this.pitch || 0)) * k;
    this.suspY = (this.suspY || 0) + ((n.suspY || 0) - (this.suspY || 0)) * k;
    this.vLat = (this.vLat || 0) + ((n.vLat || 0) - (this.vLat || 0)) * k;
    this.steerAngle = this.steer * this.def.maxSteer / (1 + Math.abs(this.speed) * (this.def.isCar ? 0.085 : 0.12));
    this.throttle = n.throttle || 0;
    this.braking = !!n.braking;
    if (this.def.isCar && (Math.abs(this.vLat) > 2.2 || (this.braking && Math.abs(this.speed) > 8))) {
      this.emitDriftFx(dt);
    }
  }

  emitDriftFx(dt) {
    this.driftFxT = (this.driftFxT || 0) + dt;
    if (this.driftFxT > 0.045) {
      this.driftFxT = 0;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), halfTw = this.def.isSuv ? 0.89 : 0.82, rearZ = this.def.wheelbase / 2;
      for (const sx of [-halfTw, halfTw]) {
        const wx = this.pos.x + cy * sx + sy * rearZ;
        const wz = this.pos.z - sy * sx + cy * rearZ;
        fx.emit(wx, this.pos.y + 0.08, wz, {
          count: 2, color: [0xe2e4e8, 0xc0c4cc, 0x9ea2a8], speed: 1.1, up: 0.45, size: 0.26, life: 0.65, grav: -0.15, spread: 0.35,
        });
        fx.emit(wx, this.pos.y + 0.03, wz, {
          count: 1, color: [0x151618, 0x222428], speed: 0.2, up: 0.02, size: 0.16, life: 1.8, grav: 0, spread: 0.08,
        });
      }
    }
  }

  // ------------------------------------------------------------------ conduite (client du conducteur)
  drive(dt) {
    const D = this.def, g = this.game, K = g.player.keys;
    const on = this.state === 'ok'; // en feu : moteur coupé, roue libre, direction à plat
    const B = g.binds;
    const fwdKey = on && B.down('forward', K), backKey = on && B.down('back', K), hb = on && B.down('jump', K);
    const steerIn = on ? (B.down('right', K) ? 1 : 0) - (B.down('left', K) ? 1 : 0) : 0;
    const prevSp = this.speed;
    let sp = this.speed;

    // essence : réserve (bips), ratés sous missBelow, panne sèche (poussée au pas) ; un vélo (sans réservoir) n'a rien de tout cela
    const FU = CONFIG.vehicles.fuel, tank = this.hasTank, frac = this.fuelFrac, dry = tank && on && this.fuel <= 0;
    let miss = false;
    if (tank && on && !dry && frac < FU.missBelow) {
      this.missCd -= dt;
      if (this.missT > 0) this.missT -= dt;
      else if (this.missCd <= 0) { this.missT = FU.missLen; this.missCd = FU.missEvery * (0.7 + 0.6 * Math.random()); g.sfx.cough?.(0.8); }
      miss = this.missT > 0;
    } else this.missT = 0;
    if (tank && on && !dry && frac < FU.lowBelow) { this.beepT -= dt; if (this.beepT <= 0) { this.beepT = FU.lowBeep; g.sfx.beep?.(); } } else this.beepT = 0;
    if (dry && !this.dryNoted) { this.dryNoted = true; g.sfx.cough?.(1); g.hud.announce('PANNE SÈCHE', `Plus d'essence : ${D.det || 'la'} ${(D.hudName || 'moto').toLowerCase()} n'avance plus qu'au pas`, 3500); }
    if (!dry && this.fuel > 0) this.dryNoted = false;

    // vitesse : courbe de couple par rapport, freinage dégressif, marche arrière, résistance aérodynamique quadratique
    const aeroDrag = D.isCar ? (0.012 * sp * Math.abs(sp) + D.drag * Math.abs(sp) + 0.55) : (D.drag * Math.abs(sp) + 0.8);
    const coast = () => { const drag = aeroDrag * dt; sp = Math.abs(sp) <= drag ? 0 : sp - Math.sign(sp) * drag; };
    this.throttle = 0;
    this.braking = false;
    if (fwdKey && !backKey) {
      this.throttle = 1;
      if (sp < -0.1) { sp += D.brake * dt; this.braking = true; }
      else if (dry) { if (sp < FU.pushSpeed) sp = Math.min(FU.pushSpeed, sp + FU.pushAccel * dt); else coast(); }
      else if (miss) { this.throttle = 0; coast(); }
      else {
        // Courbe de poussée sportive : fort couple à bas/moyen régime
        const ratio = Math.abs(sp) / D.maxSpeed;
        const torqueCurve = D.isCar ? Math.max(0.18, 1.08 - 0.88 * (ratio ** 1.35)) : Math.max(0.1, 1 - ratio);
        sp += D.accel * torqueCurve * dt;
      }
    } else if (backKey && !fwdKey) {
      this.throttle = -1;
      if (sp > 0.25) {
        sp -= D.brake * dt;
        this.braking = true;
      } else {
        sp = Math.max(-(dry ? Math.min(D.reverseSpeed, FU.pushSpeed) : D.reverseSpeed), sp - (dry ? FU.pushAccel : D.accel * 0.55) * dt);
      }
    } else coast();

    if (hb) {
      this.braking = true;
      // Sur voiture, le frein à main bloque surtout le train arrière (déclenche la glisse sans stopper net l'élan)
      const b = D.brake * (D.isCar ? 0.52 : 1.1) * dt;
      sp = Math.abs(sp) <= b ? 0 : sp - Math.sign(sp) * b;
    }
    sp = clamp(sp, -D.reverseSpeed, D.maxSpeed);

    // consommation : ralenti + gaz (marche arrière x 0,6) ; moteur coupé (en feu) ou réservoir vide : rien
    if (tank && on && this.fuel > 0) {
      const gas = this.throttle === 0 ? 0 : (D.gas + D.perSpeed * Math.abs(sp) / D.maxSpeed) * (this.throttle < 0 ? 0.6 : 1);
      this.fuel = Math.max(0, this.fuel - (D.idle + gas) * dt);
    }

    // Direction et physique de dérive latérale (Slip angle + transfert de masse pour la voiture)
    const steerRate = D.isCar ? (steerIn !== 0 ? 8.5 : 11.0) : 7.0;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * steerRate);
    const speedFactor = D.isCar ? 0.085 : 0.12;
    this.steerAngle = this.steer * D.maxSteer / (1 + Math.abs(sp) * speedFactor);

    let yawRate = -(sp / D.wheelbase) * Math.tan(this.steerAngle) * (hb ? (D.isCar ? 1.85 : 1.5) : 1);
    const maxYaw = (D.grip * (hb ? (D.isCar ? 1.75 : 1.6) : 1)) / Math.max(3, Math.abs(sp));
    yawRate = clamp(yawRate, -maxYaw, maxYaw);

    if (D.isCar) {
      // Vitesse latérale réelle (dérive / survirage au frein à main ou à haute vitesse)
      const vLat = this.vLat || 0;
      const isSuv = !!D.isSuv;
      // Force centrifuge projetée sur l'axe latéral droit (+x local) : le 4x4 (transmission intégrale) dérive moins facilement que la propulsion GT
      const centrif = yawRate * sp * (hb ? (isSuv ? 0.78 : 0.92) : (isSuv ? 0.28 : 0.38));
      // Adhérence latérale des pneus (pneus tout-terrain 4WD plus accrocheurs, propulsion GT plus joueuse en glisse)
      const latGrip = hb ? (isSuv ? 3.4 : 2.6) : (Math.abs(vLat) > 3.5 ? (isSuv ? 8.2 : 6.5) : (isSuv ? 13.5 : 11.5));
      const nextVLat = (vLat + centrif * dt) * Math.max(0, 1 - latGrip * dt);
      this.vLat = clamp(nextVLat, -12, 12);
      // En drift, la dérive fait pivoter l'arrière (survirage contrôlable au contre-braquage)
      if (hb && Math.abs(sp) > 4) {
        yawRate += -this.steer * (isSuv ? 0.48 : 0.65) * Math.sign(sp);
      }
      // Légère perte de vitesse longitudinale proportionnelle à l'angle de dérive (frottement des pneus en travers)
      if (Math.abs(this.vLat) > 0.8) {
        sp *= Math.max(0.92, 1 - 0.018 * Math.abs(this.vLat) * dt);
      }
    } else {
      this.vLat = 0;
    }

    this.yaw += yawRate * dt;

    // Suspension 3D à ressort-amortisseur (Roulis, Tangage, Rebond vertical sur vibreurs)
    if (D.isCar) {
      const isSuv = !!D.isSuv;
      const accelLon = dt > 1e-4 ? clamp((sp - prevSp) / dt, -35, 25) : 0;
      const accelLat = yawRate * sp + (this.vLat || 0) * 1.8;

      // Tangage (Pitch) : cabrage à l'accélération (< 0), plongée au freinage (> 0) — débattement plus ample sur le 4x4
      const pitchMult = isSuv ? 0.0036 : 0.0024;
      const targetPitch = clamp(-accelLon * pitchMult + (this.braking && sp > 1 ? (isSuv ? 0.042 : 0.028) : 0), isSuv ? -0.095 : -0.065, isSuv ? 0.11 : 0.075);
      const pitchK = isSuv ? 44 : 65, pitchDamp = isSuv ? 8.5 : 11;
      this.pitchVel = ((this.pitchVel || 0) + (targetPitch - (this.pitch || 0)) * pitchK * dt) * Math.max(0, 1 - pitchDamp * dt);
      this.pitch = clamp((this.pitch || 0) + this.pitchVel * dt, -0.12, 0.12);

      // Roulis (Roll / Lean) : inclinaison extérieure en virage sous l'effet de la force centrifuge (centre de gravité plus haut sur le 4x4)
      const targetRoll = clamp(accelLat * (D.leanK ?? -0.014), isSuv ? -0.16 : -0.11, isSuv ? 0.16 : 0.11);
      const rollK = isSuv ? 38 : 58, rollDamp = isSuv ? 8.0 : 10;
      this.rollVel = ((this.rollVel || 0) + (targetRoll - (this.lean || 0)) * rollK * dt) * Math.max(0, 1 - rollDamp * dt);
      this.lean = clamp((this.lean || 0) + this.rollVel * dt, -0.18, 0.18);

      // Excitation verticale de la suspension (vibreurs du circuit + irrégularités à haute vitesse) : grand débattement tout-terrain sur le 4x4
      const kerb = g.world.kerbAt?.(this.pos.x, this.pos.z) || 0;
      const vibe = kerb > 0 && Math.abs(sp) > 1 ? Math.sin(this.wheelRot * 3.5) * (isSuv ? 0.052 : 0.028) * kerb : 0;
      const bump = Math.abs(sp) > 5 ? Math.sin(this.wheelRot * 1.7) * (isSuv ? 0.008 : 0.004) * (Math.abs(sp) / D.maxSpeed) : 0;
      const targetY = vibe + bump;
      const suspK = isSuv ? 58 : 90, suspDamp = isSuv ? 10 : 14, maxSusp = isSuv ? 0.11 : 0.06;
      this.suspVel = ((this.suspVel || 0) + (targetY - (this.suspY || 0)) * suspK * dt) * Math.max(0, 1 - suspDamp * dt);
      this.suspY = clamp((this.suspY || 0) + this.suspVel * dt, -maxSusp, maxSusp);
    } else {
      this.lean += (clamp(yawRate * Math.abs(sp) * (D.leanK ?? 0.035), -0.55, 0.55) - this.lean) * Math.min(1, dt * 6);
    }

    // Fumée de pneus arrière et traces de gomme en dérapage (frein à main ou forte dérive latérale)
    const isDrifting = D.isCar && ((hb && Math.abs(sp) > 3) || Math.abs(this.vLat || 0) > 2.2);
    if (isDrifting) this.emitDriftFx(dt);

    // Klaxon de voiture (clic gauche ou touche H du conducteur), synchronisé en multijoueur
    if (D.isCar && (g.player.keys.click || K['KeyH']) && (!this.hornT || this.hornT <= 0)) {
      this.hornT = 0.35;
      g.sfx.horn?.();
      if (g.isMultiplayer && g.net?.connected) g.net.send({ t: 'v_horn', id: this.id });
    }
    if (this.hornT > 0) this.hornT -= dt;

    // déplacement 2D (longitudinal + dérive latérale) + collisions (murs, voitures, mobilier)
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const vLat = this.vLat || 0;
    const vx = fwdX * sp + rx * vLat, vz = fwdZ * sp + rz * vLat;
    const ox = this.pos.x, oz = this.pos.z;
    const p = { x: ox + vx * dt, y: 0.1, z: oz + vz * dt };
    colOut.kind = null; colOut.push = 0;
    g.world.collide(p, D.radius, colOut);
    const cx = p.x - (ox + vx * dt), cz = p.z - (oz + vz * dt), cl = Math.hypot(cx, cz);
    g.world.floorAt?.(p.x, p.z, 0.1, fl);
    if (g.world.floorAt && (fl.region !== 0 || Math.abs(fl.y) > 0.25)) { // marche, trou : on ne passe pas
      this.crash(Math.abs(sp), 'wall'); // marche, trou : de l'architecture
      sp = -sp * 0.15;
      this.vLat = 0;
    } else {
      this.pos.x = p.x; this.pos.z = p.z;
      if (cl > 1e-4) { // poussée du mur : plus on fonce dedans de face, plus on perd de vitesse
        const into = clamp(-(fwdX * cx + fwdZ * cz) / cl * Math.sign(sp || 1), 0, 1);
        this.vLat *= 0.35;
        if (into > 0.05) {
          this.crash(Math.abs(sp) * into, colOut.kind || 'wall');
          sp *= 1 - 0.92 * into * into;
          this.pitchVel = (this.pitchVel || 0) + Math.min(0.6, Math.abs(sp) * 0.04);
        }
      }
    }
    sp = this.collideBikes(sp, dt);
    this.speed = sp;
    if (this.roadkill()) { this.pos.x = ox; this.pos.z = oz; } // arrêtée net par un zombie au contact : on ne le traverse pas
    this.syncNet();
  }

  // Deux cercles par moto (à +- empattement / 2 le long du cap) : l'avant et l'arrière. Renvoie [x0, z0, x1, z1, rayon].
  bikeCircles(out = []) {
    const h = this.def.wheelbase / 2, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    out[0] = this.pos.x + fx * h; out[1] = this.pos.z + fz * h; out[2] = this.pos.x - fx * h; out[3] = this.pos.z - fz * h; out[4] = this.def.bikeRadius;
    return out;
  }

  // Moto contre moto (conducteur local seulement) : chaque conducteur résout SA moto contre la position interpolée des autres. Une moto
  // garée (sans conducteur) est un obstacle fixe : on la heurte pleinement, et c'est nous qui lui infligeons ses dégâts (v_dmg). Entre deux
  // motos conduites, chacune ne s'abîme que par elle-même (poussée partielle, `driven`). Dégâts : max(0, vitesse d'approche - free) x perMs
  // pour chacune ; le pilote suit la règle habituelle des chocs (crash) ; rebond : sp -= bounce x vitesse vers l'autre. Renvoie la vitesse.
  collideBikes(sp, dt) {
    const g = this.game, M = CONFIG.vehicles.damage.motoHit;
    if (this.state !== 'ok' || !g.vehicles) return sp;
    this._bikeHit ??= {};
    for (const k in this._bikeHit) this._bikeHit[k] -= dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), a = this.bikeCircles(this._ca ??= []);
    const reach = this.def.wheelbase / 2 + this.def.bikeRadius;
    for (const o of g.vehicles) {
      if (o === this || (o.state !== 'ok' && o.state !== 'burning')) continue;
      if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) > reach + o.def.wheelbase / 2 + o.def.bikeRadius) continue;
      const b = o.bikeCircles(o._cb ??= []);
      let pen = 0, nx = 0, nz = 0;
      for (let i = 0; i < 4; i += 2) for (let j = 0; j < 4; j += 2) {
        const dx = a[i] - b[j], dz = a[i + 1] - b[j + 1], d = Math.hypot(dx, dz), p = a[4] + b[4] - d;
        if (p > pen) { pen = p; if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { nx = -fx; nz = -fz; } }
      }
      if (pen <= 0) continue;
      const driven = o.seats[0] != null;
      const k = driven ? M.driven : 1;
      this.pos.x += nx * pen * k; this.pos.z += nz * pen * k;   // normale de l'autre moto vers la nôtre
      const ofx = -Math.sin(o.yaw) * o.speed, ofz = -Math.cos(o.yaw) * o.speed;
      const vx = fx * sp, vz = fz * sp;
      const closing = (ofx - vx) * nx + (ofz - vz) * nz;      // vitesse d'approche (m/s), > 0 si on se rapproche
      if (closing < 0.3) continue;
      const into = Math.max(0, -(vx * nx + vz * nz));          // notre vitesse vers l'autre moto
      if (into > 0 && sp !== 0) sp = clamp(sp - Math.sign(sp) * M.bounce * into, -this.def.reverseSpeed, this.def.maxSpeed);
      if ((this._bikeHit[o.id] ?? 0) > 0) continue;            // un choc compte une fois
      this._bikeHit[o.id] = M.hitCooldown;
      const dmg = Math.max(0, closing - M.free) * M.perMs;
      if (dmg > 0) {
        g.damageVehicle(this, dmg, 'crash');
        if (!driven) g.damageVehicle(o, dmg, 'crash');         // moto garée : son conducteur n'existe pas, c'est nous qui la blessons
      }
      this.crash(closing, 'moto');
    }
    return sp;
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

  // Choc : secousse, bruit ; au-dessus du seuil les occupants se blessent (jamais mortel). kind : 'prop' (objet physique : la moto
  // s'abîme de max(0, impact - crashFree) x crashPerMs), 'wall' (architecture : D.wall x ce montant, 0 par défaut) ou 'moto' (autre moto :
  // les dégâts de la moto sont calculés par collideBikes, seuls la secousse, le bruit et le pilote sont traités ici)
  crash(impact, kind = 'prop') {
    const C = this.def.crash || CONFIG.vehicles.crash, g = this.game; // chute propre au type (le vélo), sinon celle des motos
    if (impact < 3) return;
    g.shake = Math.max(g.shake || 0, Math.min(1, impact / 22));
    g.sfx.crash?.(Math.min(1, impact / 20));
    const D = CONFIG.vehicles.damage, wear = kind === 'moto' ? 0 : Math.max(0, impact - D.crashFree) * D.crashPerMs * (kind === 'wall' ? D.wall : 1);
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

  // ------------------------------------------------------------------ son du moteur & boîte 6 rapports + retour de flamme
  updateEngine(dt, local) {
    const g = this.game;
    const running = this.hasTank && this.seats[0] != null && this.state === 'ok' && this.fuel > 0; // pas de conducteur, en feu ou à sec : moteur arrêté (un vélo n'a pas de moteur)
    if (running && !this.engine) this.engine = g.sfx.createEngine?.(this.type) || null;
    if (!running && this.engine) this.stopEngine();
    // 6 rapports pour la voiture GT (4 pour les motos) : le régime retombe à chaque passage de vitesse avec retour de flamme à l'échappement
    const gears = this.def.isCar ? 6 : 4;
    const ratio = clamp(Math.abs(this.speed) / this.def.maxSpeed, 0, 1), gear = Math.min(gears - 1, Math.floor(ratio * gears));
    if (this.def.isCar && gear !== this.gear) {
      if (gear > this.gear && this.throttle > 0 && ratio > 0.22) {
        const pts = this.model.exhaustPoints || [[0, 0.3, 2.15]];
        for (const ep of pts) {
          this.toWorld(ep, tmpV);
          fx.emit(tmpV.x, tmpV.y, tmpV.z, { count: 3, color: [0xff7a18, 0xffb040, 0x66ccff], speed: 1.8, up: 0.2, size: 0.18, life: 0.22, grav: 0, spread: 0.25 });
        }
        this.pitchVel = (this.pitchVel || 0) - 0.35; // léger à-coup de passage de rapport
      }
      this.gear = gear;
    }
    if (!this.engine) return;
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

    spawnVehicle(type = 'voiture', x, z, yaw, variant = 0) {
      if (!CONFIG.vehicles.types[type]) return null;
      const p = this.player;
      const px = x != null ? x : (p.pos.x - Math.sin(p.yaw) * 4.5);
      const pz = z != null ? z : (p.pos.z - Math.cos(p.yaw) * 4.5);
      const pyaw = yaw != null ? yaw : p.yaw;
      if (this.isMultiplayer && this.isClient) {
        this.net?.send({ t: 'v_spawn_req', type, x: r2(px), z: r2(pz), yaw: r2(pyaw), var: variant | 0 });
        return null;
      }
      const id = this.vehicles.length;
      const v = new Vehicle(this, scene, id, type, { x: px, z: pz, yaw: pyaw, variant: variant | 0 });
      this.vehicles.push(v);
      if (this.isMultiplayer && this.isHost) {
        this.net?.send({ t: 'v_spawn', id, type, x: r2(px), z: r2(pz), yaw: r2(pyaw), var: variant | 0 });
      }
      return v;
    },

    resetVehicles() {
      for (const v of this.vehicles) v.reset();
      this.resetTrams?.();
      this.player.vehicle = null;
      this.tramWalkOff?.();
      this.refreshRiders();
    },

    updateVehicles(dt) {
      const p = this.player;
      if (p.vehicle && (p.downed || p.dead)) this.leaveVehicle(true); // à terre : on est éjecté
      for (const v of this.vehicles) v.update(dt);
      this.cullParkedBikes(dt);
      this.updateTrams?.(dt);
      this.updateTramBoarding?.(dt); // monter à pied en poussant contre une porte ouverte
      if (!this.isClient) for (const v of this.rides()) this.hostVehicleTick(v, dt);
    },

    // Vélos garés loin du joueur : non dessinés (16 à 24 vélos de 5 maillages ne doivent pas ajouter des centaines d'appels de rendu) ; stations idem.
    // Un vélo conduit (même par un coéquipier) reste toujours visible. Test toutes les 0,25 s.
    cullParkedBikes(dt) {
      this.cullT = (this.cullT || 0) - dt;
      if (this.cullT > 0) return;
      this.cullT = 0.25;
      const c = this.player.camera.position;
      for (const v of this.vehicles) {
        const cd = v.def.cullDist;
        if (!cd || v.state === 'gone') continue;
        v.group.visible = v.hasDriver || Math.hypot(v.pos.x - c.x, v.pos.z - c.z) < cd;
      }
      const sd = R().bikeStation?.cullDist ?? 90;
      for (const st of world.bikeStations || []) st.group.visible = Math.hypot(st.x - c.x, st.z - c.z) < sd;
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
      return best || this.nearTram?.() || null;
    },

    vehiclePrompt(nv) {
      if (nv.v.isTram) return this.tramPrompt(nv);
      const v = nv.v, role = v.def.seats > 1 ? (nv.seat === 0 ? ' — conducteur' : ' — passager') : '';
      const fuel = v.hasTank ? ` · essence ${Math.round(v.fuelFrac * 100)} %` : ''; // un vélo n'a pas de réservoir
      const verb = v.def.isCar ? 'Monter dans' : 'Monter sur';
      return `${game.binds.tag('interact')} ${verb} ${v.def.det || 'la'} ${v.def.name.toLowerCase()}${role} (PV ${Math.round(v.hpFrac * 100)} %${fuel})`;
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
      const v = rv?.v || this.tramOfTarget?.(target); // une rame : aussi pour un occupant debout
      if (v) this.damageVehicle(v, v.def.zombieHit ?? R().damage.zombieHit, 'zombie'); // une rame : 2 PV par coup sur la caisse
    },

    // Mise à feu (hôte) : v_hp puis v_burn à tous
    igniteVehicle(v) {
      if (v.isTram) { this.hostBreakTram(v); return; } // une rame n'explose pas : elle tombe en panne (hors service jusqu'au dépôt)
      if (v.state !== 'ok') return;
      if (v.def.blast === null) { this.hostBreakVehicle(v); return; } // un vélo n'explose pas : il est cassé
      this.flushVehicleHp(v);
      if (this.isMultiplayer) this.net?.send({ t: 'v_burn', id: v.id });
      this.startBurn(v);
    },
    startBurn(v) {
      if (v.state !== 'ok') return;
      v.hp = 0; v.state = 'burning'; v.burnT = R().damage.burnTime; v.alarmT = 0;
      if (this.player.vehicle?.v === v) hud.announce('SAUTEZ !', `${game.binds.tag('interact')} : ${v.def.det || 'la'} ${v.def.name.toLowerCase()} va exploser`, 1800);
    },

    // Vélo cassé (hôte) : v_hp puis v_break à tous ; ni incendie ni explosion. Épave, puis retour à la station à la manche suivante (v_respawn)
    hostBreakVehicle(v) {
      if (v.state !== 'ok') return;
      this.flushVehicleHp(v);
      if (this.isMultiplayer) this.net?.send({ t: 'v_break', id: v.id });
      this.onVehicleBreak(v);
      if (this.isMultiplayer) this.broadcastSeats(v);
    },
    // Chaque machine : épave (matériau noir partagé), le cycliste chute (sans dégâts de plus : la chute éventuelle a eu lieu au choc)
    onVehicleBreak(v) {
      if (v.state !== 'ok' && v.state !== 'burning') return;
      const p = this.player, mine = p.vehicle?.v === v;
      v.state = 'wreck'; v.wreckT = v.def.wreckTime ?? R().damage.wreckTime; v.hp = 0; v.speed = 0; v.hpDirty = false;
      v.respawnRound = this.round + (v.def.respawnRounds ?? R().damage.respawnRounds);
      v.setWreckLook(true);
      if (mine) { this.ejectFromVehicle(v, 2); hud.announce('VÉLO CASSÉ', 'Il revient à sa station à la manche suivante', 2600); }
      v.seats.fill(null);
      sfx.crash?.(0.5);
      this.refreshRiders();
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
    ejectFromVehicle(v, push = 5) { // push : vitesse de projection (m/s) ; un vélo cassé : chute douce
      const p = this.player;
      this.leaveVehicle();
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z, l = Math.hypot(dx, dz) || 1;
      p.vel.set((dx / l) * push, 0, (dz / l) * push); p.vy = push > 3 ? 4 : 2;
    },

    // ----------------------------------------------------------- réapparition au parking (hôte)
    // À chaque début de manche : les motos détruites dont la manche de retour est arrivée reviennent (si personne n'est sur l'emplacement)
    hostRespawnCheck() {
      for (const v of this.rides()) {
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
      if (!v.isTram) v.fuel = v.def.tank * (world.isCircuitTest ? 1 : R().fuel.respawn); // 100 % sur le circuit, 40 % en survie
      if (this.player.vehicle?.v === v) this.player.vehicle = null;
      if (this.player.onTram?.v === v) this.tramWalkOff?.(); // la rame retourne au dépôt : on n'y est plus
      this.refreshRiders();
    },

    // ----------------------------------------------------------- monter / descendre
    tryMount(v, seat) {
      if (v.seats[seat] != null || !v.usable) return;
      if (!this.isMultiplayer) { v.seats[seat] = myId(); this.enterVehicle(v, seat); }
      else if (this.isHost) this.hostSeat(v.id, seat, myId());
      else { this.seatReq = { id: v.id, until: this.time + 4 }; this.net?.send({ t: 'v_req', id: v.id, seat }); } // réponse : v_seats
    },

    enterVehicle(v, seat) {
      const p = this.player;
      if (p.vehicle) return;
      this.tramWalkOff?.(); // assis : la position vient du siège
      p.vehicle = { v, seat };
      p.yaw = v.seatYaw(seat) + (v.model.seats[seat].ry || 0); p.pitch = 0; // (une rame : la place regarde vers l'avant, l'arrière ou l'allée)
      p.mouseDown = false; p.aiming = false;
      v.syncNet();
      if (v.isTram) sfx.tramChime?.(true, 0.6); else sfx.mount?.(v.type);
      const B = game.binds, kE = B.label('interact'), kV = B.label('vehicleView');
      if (v.isTram) { const [a, b] = this.tramEnterText(v, seat); hud.announce(a, b, 4500); }
      else hud.announce(v.def.name, seat === 0 ? `${B.moveLabel()} : conduire · ${B.label('jump')} : ${v.hasTank ? 'frein à main' : 'frein'} · ${kE} : descendre` : (world.isCircuitTest ? `Passager à bord · ${kV} : changer de vue · ${kE} : descendre` : `Vous êtes passager : tirez ! · ${kE} : descendre`), 3500);
      this.refreshRiders();
    },

    leaveVehicle(force = false) {
      const p = this.player, rv = p.vehicle;
      if (!rv) return;
      const { v, seat } = rv;
      if (v.isTram) { this.leaveTram(v, seat, force); return; }
      // on descend du côté de la portière du siège (gauche pour conducteur/arrière-gauche, droite pour passager/arrière-droit)
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      v.hipWorld(seat, pt);
      let ex = pt.x, ez = pt.z;
      const prefSide = (v.model.seats[seat]?.hip?.[0] ?? 0) < -0.05 ? -1 : (seat === 0 ? -1 : 1);
      const stepOut = v.def.isCar ? 1.35 : 1.0;
      for (const side of [prefSide, -prefSide]) {
        const q = { x: pt.x + c * side * stepOut, y: 0.1, z: pt.z - s * side * stepOut };
        world.collide(q, 0.4);
        ex = q.x; ez = q.z;
        if (Math.hypot(q.x - (pt.x + c * side * stepOut), q.z - (pt.z - s * side * stepOut)) < 0.3) break;
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
      this.freeMySeat(v, seat);
    },

    // Se lever d'un siège de la rame (v0.40.0) : on reste DANS la rame, debout à côté du siège, quelle que soit sa vitesse ; on en sort à pied par une porte
    // ouverte (voir tramInterior.js). `force` : levé d'office (à terre, place retirée par l'hôte) : même chose.
    leaveTram(v, seat, force) {
      this.standInTram(v, seat);
      sfx.knock?.(0.3);
      this.freeMySeat(v, seat);
    },
    freeMySeat(v, seat) {
      if (!this.isMultiplayer) v.seats[seat] = null;
      else if (this.isHost) { v.seats[seat] = null; this.broadcastSeats(v); }
      else { v.seats[seat] = null; this.net?.send({ t: 'v_leave', id: v.id }); }
      this.refreshRiders();
    },

    // ----------------------------------------------------------- places (arbitrées par l'hôte)
    hostSeat(vid, seat, pid) {
      const v = this.rideById(vid);
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
      for (const v of this.rides()) v.seats.forEach((s, i) => { if (s === pid && !(v === keepV && i === keepSeat)) { v.seats[i] = null; if (v !== keepV) this.broadcastSeats(v); } });
    },

    broadcastSeats(v) { if (this.isMultiplayer) this.net?.send({ t: 'v_seats', id: v.id, seats: v.seats }); },

    onPeerLeft(pid) {
      if (!this.isHost) return;
      this.freeSeatsOf(pid);
      for (const v of this.rides()) this.broadcastSeats(v);
      this.refreshRiders();
    },

    // coéquipiers assis sur une moto : leur personnage est posé sur la selle
    refreshRiders() {
      const riding = new Map();
      for (const v of this.rides()) v.seats.forEach((pid, i) => { if (pid != null && pid !== myId()) riding.set(pid, { v, seat: i }); });
      for (const [pid, rp] of this.remotes) {
        const r = riding.get(pid);
        if (r) rp.setRide(r.v, r.seat); else rp.clearRide();
      }
    },

    // ----------------------------------------------------------- réseau
    bindVehicleNet(net) {
      this.bindTramNet?.(net); // messages de la rame (t_*)
      net.on('v_state', (m) => {
        const v = this.vehicles[m.id];
        if (!v || v.seats[0] === myId()) return;
        v.net = {
          x: m.x, z: m.z, yaw: m.yaw, speed: m.spd, steer: m.st, lean: m.ln,
          pitch: m.pt || 0, suspY: m.sy || 0, vLat: m.vl || 0, braking: !!m.br, throttle: m.th || 0,
        };
        if (m.fu != null && performance.now() > v.fuelLock) v.fuel = clamp(+m.fu, 0, v.def.tank); // anciens messages : pas de `fu`
      });
      net.on('v_horn', (m) => {
        const v = this.vehicles[m.id];
        if (!v) return;
        const d = Math.hypot(v.pos.x - this.player.pos.x, v.pos.z - this.player.pos.z);
        if (d < 65) sfx.horn?.();
      });
      net.on('v_spawn_req', (m) => {
        if (this.isHost && CONFIG.vehicles.types[m.type]) {
          this.spawnVehicle(m.type, +m.x || 0, +m.z || 0, +m.yaw || 0, m.var | 0);
        }
      });
      net.onHost('v_spawn', (m) => {
        if (this.isHost || !CONFIG.vehicles.types[m.type]) return;
        const id = m.id | 0;
        if (!this.vehicles[id]) {
          this.vehicles[id] = new Vehicle(this, scene, id, m.type, { x: +m.x || 0, z: +m.z || 0, yaw: +m.yaw || 0, variant: m.var | 0 });
        }
      });
      net.on('v_req', (m) => { if (this.isHost) this.hostSeat(m.id, m.seat, m.from); });
      net.on('v_leave', (m) => {
        if (!this.isHost) return;
        const v = this.rideById(m.id);
        if (!v) return;
        v.seats.forEach((s, i) => { if (s === m.from) v.seats[i] = null; });
        this.broadcastSeats(v);
        this.refreshRiders();
      });
      net.onHost('v_deny', () => hud.announce('PLACE INDISPONIBLE', 'Place prise ou véhicule hors d\'usage.', 1800));
      // points de vie : l'hôte les écrit (v_dmg des clients), les autres les reçoivent
      net.on('v_dmg', (m) => { const v = this.rideById(m.id); if (this.isHost && v) this.damageVehicle(v, clamp(+m.amt || 0, 0, 200), m.src || ''); });
      net.onHost('v_hp', (m) => { const v = this.rideById(m.id); if (v && !this.isHost && v.state === 'ok') v.hp = clamp(+m.hp, 0, v.maxHp); });
      net.onHost('v_burn', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.startBurn(v); });
      net.onHost('v_break', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.onVehicleBreak(v); });
      net.onHost('v_boom', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.onVehicleBoom(v, m.x, m.z, false); });
      net.onHost('v_respawn', (m) => { const v = this.rideById(m.id); if (v && !this.isHost) this.respawnVehicle(v); });
      // borne du parking : le client a déjà payé ; l'hôte vérifie et rend la différence (v_refund)
      net.onHost('v_fuel', (m) => { const v = this.vehicles[m.id]; if (v && !this.isHost) this.setFuel(v, m.fu); });
      net.on('v_service', (m) => { if (this.isHost) this.hostService(m.id, m.from, +m.paid || 0); });
      net.onHost('v_refund', (m) => { if (+m.pts > 0) { this.points += Math.round(m.pts); hud.announce('BORNE', `Remboursé : ${Math.round(m.pts)} pts`, 1800); } });
      net.onHost('v_seats', (m) => {
        const v = this.rideById(m.id);
        if (!v) return;
        v.seats = m.seats.slice();
        const me = v.seats.indexOf(myId()), req = this.seatReq;
        if (me >= 0 && !this.player.vehicle && req && req.id === v.id && this.time < req.until) { this.seatReq = null; this.enterVehicle(v, me); } // ma demande a été acceptée
        else if (me < 0 && this.player.vehicle?.v === v) this.leaveVehicle(true); // l'hôte ne me compte plus sur cette moto (explosion, départ…)
        else this.refreshRiders();
      });
    },

    // (les messages de la rame : voir bindTramNet dans tram.js)

    // Nouvel arrivant : positions, occupants, PV et état de tous les véhicules (y compris ceux apparus via F9)
    vehicleSnapshot() {
      return [
        ...this.vehicles.map((v) => ({
          id: v.id, type: v.type, var: v.variant || 0,
          sx: r2(v.spawn.x), sz: r2(v.spawn.z), syaw: r2(v.spawn.yaw),
          x: v.pos.x, z: v.pos.z, yaw: v.yaw, seats: v.seats,
          hp: r2(v.hp), fu: r2(v.fuel), st: v.state, wreck: r2(v.wreckT), back: v.respawnRound,
        })),
        ...(this.tramSnapshot?.() || []),
      ];
    },
    applyVehicleSnapshot(list) {
      for (const s of list || []) {
        if (s.tr) { this.applyTramSnapshot(s); continue; } // une rame (id >= 100)
        if (!this.vehicles[s.id] && s.type && CONFIG.vehicles.types[s.type]) {
          this.vehicles[s.id] = new Vehicle(this, scene, s.id, s.type, {
            x: s.sx ?? s.x, z: s.sz ?? s.z, yaw: s.syaw ?? s.yaw, variant: s.var ?? 0,
          });
        }
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
      const p = this.player;
      if (p.vehicle || p.downed || p.dead) return null;
      const pk = (world.parkings || []).find((q) => Math.hypot(p.pos.x - q.pump.x, p.pos.z - q.pump.z) <= R().pumpRange);
      if (!pk) return null;
      let best = null, bd = R().pumpReach;
      for (const v of this.vehicles) {
        if (!v.usable || !v.hasTank) continue; // la borne ne sert que les motos (un vélo n'a ni réservoir ni réparation payante)
        const d = Math.hypot(v.pos.x - pk.pump.x, v.pos.z - pk.pump.z);
        if (d <= bd) { bd = d; best = v; }
      }
      return { v: best };
    },
    // Ce que la borne ferait pour la moto : { cost (pts), missing (PV), liters }
    serviceOf(v) {
      const missing = Math.max(0, v.maxHp - v.hp), liters = v.hasTank ? Math.max(0, v.def.tank - v.fuel) : 0;
      const rawCost = Math.ceil(missing * R().damage.repairPrice + liters * R().fuel.pricePerL - 1e-6);
      return { missing, liters, cost: world.isCircuitTest ? 0 : rawCost, needed: rawCost > 0 };
    },
    pumpPrompt(np) {
      if (!np.v) return 'Borne du stand : aucun véhicule à portée (8 m)';
      const sv = this.serviceOf(np.v), name = np.v.def.name;
      if (!sv.needed) return `${name} : plein fait, en parfait état`;
      if (world.isCircuitTest) return `${game.binds.tag('interact')} Plein + réparation ${name} : GRATUIT (essence ${Math.round(np.v.fuelFrac * 100)} % · PV ${Math.round(np.v.hpFrac * 100)} %)`;
      return `${game.binds.tag('interact')} Plein + réparation ${name} : ${sv.cost} pts (essence ${Math.round(np.v.fuelFrac * 100)} % · PV ${Math.round(np.v.hpFrac * 100)} %)`;
    },
    usePump(np) {
      const v = np.v;
      if (!v) { sfx.deny(); return; }
      const sv = this.serviceOf(v);
      if (!sv.needed) return;
      if (this.points < sv.cost) { sfx.deny(); return; }
      this.points -= sv.cost; // le client paie d'abord (comme les portes) : l'hôte rembourse s'il refuse
      sfx.buy();
      hud.announce(v.def.name, world.isCircuitTest ? 'Plein + réparation : GRATUIT' : `Plein + réparation : −${sv.cost} pts`, 2200);
      if (this.isClient) this.net?.send({ t: 'v_service', id: v.id, paid: sv.cost });
      else this.hostService(v.id, null, sv.cost);
    },
    // Essence absolue d'une moto (hôte : à la borne ou au bidon ; v_fuel : les autres l'adoptent, conducteur compris)
    setFuel(v, fu, broadcast = false) {
      if (!v.hasTank) return;
      v.fuel = clamp(+fu, 0, v.def.tank);
      v.fuelLock = performance.now() + 300; // un v_state déjà en route avec l'ancienne valeur ne doit pas l'écraser
      if (broadcast && this.isMultiplayer) this.net?.send({ t: 'v_fuel', id: v.id, fu: r2(v.fuel) });
    },

    // Bidon d'essence (hôte) : 3 % par zombie tué, seulement si une moto en état est sous 50 % de réservoir, un seul à la fois au sol
    maybeDropFuel(pos) {
      const F = R().fuel;
      if (this.isClient || Math.random() >= F.dropChance) return;
      if (this.powerups.some((q) => q.type === 'fuel') || !this.vehicles.some((v) => v.usable && v.hasTank && v.fuelFrac < F.dropBelow)) return;
      this.spawnPowerup(pos, null, 'fuel');
    },
    // Bidon ramassé par `pid` (hôte) : +jerrican L à la moto du ramasseur, sinon à la moto la plus vide
    hostFuelPickup(pid) {
      const F = R().fuel;
      let v = this.vehicles.find((q) => q.usable && q.hasTank && q.seats.includes(pid));
      if (!v) v = this.vehicles.filter((q) => q.usable && q.hasTank).sort((a, b) => a.fuelFrac - b.fuelFrac)[0];
      if (v) this.setFuel(v, v.fuel + F.jerrican, true);
      return v;
    },

    // hôte : applique le service payé `paid` par le joueur `pid` (null : l'hôte lui-même) ; rembourse l'excédent ou tout si impossible
    hostService(vid, pid, paid) {
      const v = this.vehicles[vid];
      const refund = (pts) => { if (pts <= 0) return; if (pid == null) this.points += pts; else this.net?.send({ t: 'v_refund', pts }, pid); };
      if (!v || !v.usable || !v.hasTank) { refund(paid); return; }
      const sv = this.serviceOf(v);
      if (!sv.needed || sv.cost > paid) { refund(paid); return; } // déjà en parfait état, ou plus abîmée depuis : on rend tout
      v.hp = v.maxHp;
      this.flushVehicleHp(v);
      this.setFuel(v, v.def.tank, true);
      refund(paid - sv.cost);
    },
  });
}
