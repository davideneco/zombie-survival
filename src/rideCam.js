import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Avatar, mountAvatar, dismountAvatar, seatedUpdate } from './characters.js';

// =====================================================================
//  Vue à la troisième personne sur une moto (CONFIG.vehicles.cam). Il n'y a toujours qu'UNE caméra : player.camera, qui sert aussi aux tirs.
//  - Le pivot suit l'œil du pilote (+ 0,35 m en hauteur ; épaule droite pour le passager), lissé ; la caméra recule sur un bras derrière
//    le pivot, dans la direction de visée (lacet et tangage suivent la souris sans retard).
//  - Collision : trois rayons pivot -> caméra (centre, puis ±0,25 m), on garde la médiane moins 0,3 m (au moins 0,8 m) ; la caméra se
//    rapproche d'un coup et s'éloigne à 4 m/s ; plafond (passage sous immeuble, cathédrale) et sol bornent sa hauteur.
//  - Transitions : montée 0,35 s, descente 0,25 s, visée (passager, clic droit) 0,15 s vers la première personne.
//  - Le personnage du joueur (Avatar) est posé sur la selle : visible si le bras dépasse 0,8 m ; l'arme de la vue (viewmodel) n'est
//    visible que si le bras est inférieur à 0,3 m. Les tirs partent d'un point avancé du bras sur le rayon de la caméra : le réticule
//    touche ce qu'il montre, et un zombie entre la caméra et le pilote n'est pas touché.
//  - AUCUNE lumière ajoutée ni masquée (ce qui recompilerait tous les shaders).
// =====================================================================

const ease = (t) => 1 - (1 - t) ** 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class RideCam {
  constructor(player) {
    this.p = player;
    this.k = 0;               // 0 = première personne, 1 = bras tendu
    this.dist = 0;            // distance réelle caméra - pivot (m)
    this.cl = Infinity;       // longueur autorisée par les obstacles (lissée)
    this.len = 0;             // longueur du bras de la dernière moto
    this.pivot = new THREE.Vector3();
    this.hasPivot = false;
    this.rateUp = 1 / CONFIG.vehicles.cam.mountTime;
    this.wasVeh = false; this.wasWant = false;
    this.avatar = null;
    this.holder = new THREE.Group();
    this.holder.visible = false;
    this.mounted = null;      // moto sur laquelle le personnage est posé
    this.fireNow = false;
    this.fl = { y: 0, region: 0 };
    this.d = new THREE.Vector3(); this.tmp = new THREE.Vector3();
  }

  // Nouvelle partie / réapparition : retour à une vue normale
  reset() {
    this.k = 0; this.dist = 0; this.cl = Infinity; this.hasPivot = false; this.wasVeh = false; this.wasWant = false;
    if (this.mounted) { dismountAvatar(this.holder); this.mounted = null; }
    this.holder.visible = false;
  }

  get avatarVisible() { return this.holder.visible; }
  // le joueur regarde de l'extérieur de sa moto (les tirs partent de plus loin que la caméra, l'arme de la vue est cachée)
  get external() { return this.dist >= CONFIG.vehicles.cam.viewmodelMax; }
  fire() { this.fireNow = true; }

  wantThird(veh) {
    const p = this.p;
    return !!veh && p.game.settings.tpVehicle !== false && !(!veh.v.isDriver(veh.seat) && p.aiming); // visée du passager : retour en première personne
  }

  // Appelé à chaque image (après le tir) : renvoie true si la caméra a été placée ici (sinon Player pose la vue à la première personne).
  // veh : { v, seat } ou null ; foot : œil à pied { x, y, z } (pivot de la sortie de moto) ; shake : secousse (m)
  update(dt, veh, foot, shake) {
    const C = CONFIG.vehicles.cam, p = this.p, w = p.world;
    const want = this.wantThird(veh);
    if (veh && !this.wasVeh) this.rateUp = 1 / C.mountTime;
    else if (veh && want && !this.wasWant) this.rateUp = 1 / C.aimTime; // retour après la visée, ou touche V
    this.wasVeh = !!veh; this.wasWant = want;
    if (want) this.k = Math.min(1, this.k + dt * this.rateUp);
    else this.k = Math.max(0, this.k - dt / (veh ? C.aimTime : C.leaveTime));
    if (veh) this.len = veh.v.def.camArm;

    if (this.k <= 0) { // première personne (ou à pied)
      this.dist = 0; this.cl = Infinity; this.hasPivot = false;
      this.syncAvatar(dt, null);
      return false;
    }
    const arm = this.len * ease(this.k);

    // direction de visée (la même que celle de la caméra)
    const yaw = p.yaw, pitch = p.pitch + p.recoil;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const d = this.d.set(-sy * cp, sp, -cy * cp);

    // pivot : œil du pilote + 0,35 m (passager : + 0,35 m à droite), lissé
    const t = this.tmp;
    if (veh) {
      veh.v.eyeWorld(veh.seat, t);
      t.y += C.pivotUp;
      if (!veh.v.isDriver(veh.seat)) { t.x += cy * C.pivotRight; t.z -= sy * C.pivotRight; } // passager : épaule droite
    } else t.set(foot.x, foot.y, foot.z); // sortie de moto : le pivot rejoint l'œil du joueur à pied
    if (!this.hasPivot) { this.pivot.copy(t); this.hasPivot = true; }
    else this.pivot.lerp(t, 1 - Math.exp(-C.follow * dt));
    const pv = this.pivot;

    // collision : trois rayons parallèles pivot -> caméra (au centre, puis ±rayOffset), médiane
    let lim = this.len;
    if (w.rayHit) {
      const hits = [0, C.rayOffset, -C.rayOffset].map((off) => w.rayHit(pv.x + cy * off, pv.y, pv.z - sy * off, -d.x, -d.y, -d.z, this.len));
      hits.sort((a, b) => a - b);
      lim = hits[1] >= this.len ? this.len : Math.min(this.len, Math.max(C.minArm, hits[1] - C.margin)); // rien sur le chemin : bras entier
    }
    if (lim < this.cl) this.cl = lim; else this.cl = Math.min(lim, this.cl + C.retreat * dt); // proche d'un coup, loin à 4 m/s
    const dist = Math.min(arm, this.cl);
    this.dist = dist;

    // position : le long de la visée, sous le plafond et au-dessus du sol
    const x = pv.x - d.x * dist, z = pv.z - d.z * dist;
    let y = pv.y - d.y * dist;
    if (w.floorAt) { w.floorAt(x, z, pv.y, this.fl); y = Math.max(y, this.fl.y + C.floorMargin); }
    const ceil = w.ceilingAt ? w.ceilingAt(x, z) : Infinity;
    if (ceil < Infinity) y = Math.min(y, ceil - C.ceilingMargin);
    const cam = p.camera;
    cam.position.set(x + (shake ? (Math.random() - 0.5) * shake * 0.25 : 0), y + (shake ? (Math.random() - 0.5) * shake * 0.25 : 0), z + (shake ? (Math.random() - 0.5) * shake * 0.25 : 0));
    cam.rotation.set(pitch, yaw, 0);

    this.syncAvatar(dt, veh);
    return true;
  }

  // Le personnage du joueur est posé sur la selle (créé au premier montage en vue externe), visible si le bras dépasse 0,8 m
  syncAvatar(dt, veh) {
    const C = CONFIG.vehicles.cam, p = this.p;
    if (!veh || this.k <= 0) {
      if (this.mounted) { dismountAvatar(this.holder); this.mounted = null; }
      this.holder.visible = false;
      return;
    }
    const ch = p.game.localCharacter();
    if (!this.avatar || this.avatar.ch.id !== ch.id) {
      if (this.mounted) { dismountAvatar(this.holder); this.mounted = null; }
      if (this.avatar) this.holder.remove(this.avatar.root);
      this.avatar = new Avatar(ch);
      this.holder.add(this.avatar.root);
      this.holder.userData.seat = -1;
    }
    if (this.mounted !== veh.v || this.holder.userData.seat !== veh.seat) {
      mountAvatar(this.holder, veh.v, veh.seat, this.avatar);
      this.mounted = veh.v; this.holder.userData.seat = veh.seat;
    }
    this.holder.visible = this.dist > C.avatarMin;
    if (!this.holder.visible) return;
    const w = p.curW;
    seatedUpdate(this.holder, veh.v, veh.seat, this.avatar, { dt, aimYaw: p.yaw, pitch: p.pitch, weapon: w.id, pap: w.pap | 0, reloading: w.reloading, aiming: p.aiming, fire: this.fireNow });
    this.fireNow = false;
  }

  // Bouche de l'arme du personnage (monde), ou null si le personnage n'est pas visible
  muzzleWorld(out) {
    if (!this.avatar || !this.holder.visible) return null;
    const a = this.avatar;
    a.weapon.updateWorldMatrix(true, false);
    return a.weapon.localToWorld(out.set(0, 0.015, a.muzzleZ));
  }

  // Point d'où part une grenade en vue externe : l'œil du pilote
  eyeOrigin(veh, foot, out) {
    if (veh) return veh.v.eyeWorld(veh.seat, out);
    return out.set(foot.x, foot.y, foot.z);
  }

  // Recentrage de la vue du conducteur derrière sa moto, et tangage borné en vue externe (appelé par Player quand il est sur une moto)
  steer(dt, veh, sinceMouse) {
    const C = CONFIG.vehicles.cam, p = this.p;
    if (this.k < 0.5) return;
    p.pitch = clamp(p.pitch, C.pitchMin, C.pitchMax);
    if (veh.v.isDriver(veh.seat) && sinceMouse > C.recenterAfter) { // regard libre ; sans souris depuis 1,5 s : la vue revient derrière la moto (la rame : derrière la cabine) à 2 rad/s
      const dy = angDiff(veh.v.seatYaw(veh.seat) + (veh.v.model.seats[veh.seat].ry || 0), p.yaw);
      p.yaw += Math.sign(dy) * Math.min(Math.abs(dy), C.recenterRate * dt);
      const dp = C.recenterPitch - p.pitch;
      p.pitch += Math.sign(dp) * Math.min(Math.abs(dp), C.recenterRate * 0.4 * dt);
    }
  }
}
