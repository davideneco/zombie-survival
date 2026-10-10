import * as THREE from 'three';
import { Avatar, charOf, slotColor, mountAvatar, dismountAvatar, seatedUpdate } from './characters.js';

export { slotColor };

// ---------------------------------------------------------------------------------------------------------------------------
// Repères des coéquipiers (v0.31.0). Par coéquipier, trois sprites (un appel de rendu chacun, sans test de profondeur) :
//   - l'étiquette : nom + barre de vie (canevas 256 x 64), redessinée à chaque écart de 5 PV ; sa taille à l'écran est celle d'un objet
//     de 1,8 m doublée puis bornée à tagMin..tagMax pixels (elle ne devient ni illisible au loin, ni énorme de près) ;
//   - le losange : visible au-delà de markFar m ou si le coéquipier est caché derrière un mur (rayon testé 4 fois par seconde) ;
//   - la croix rouge et son compte à rebours (secondes avant la mort), seulement à terre.
// Les mises à jour de texture partagent un budget (texPerSec par seconde, voir RemotePlayer.tick).
// ---------------------------------------------------------------------------------------------------------------------------
const TEAM = { tagMin: 40, tagMax: 200, tagGain: 2, markPx: 22, crossPx: 84, markFar: 25, hiddenEvery: 0.25, texPerSec: 4, hpStep: 5 };
export const TEAMMATE_VIEW = TEAM;

function barColor(f) { return f > 0.5 ? '#6fd36f' : f > 0.25 ? '#e8c43a' : '#e0443a'; }

function drawTag(cv, text, color, hp, downed) {
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  x.font = 'bold 27px Arial';
  x.textAlign = 'center';
  x.lineWidth = 6; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(text, 128, 28);
  x.fillStyle = color; x.fillText(text, 128, 28);
  const f = Math.max(0, Math.min(1, hp / 100));
  x.fillStyle = 'rgba(0,0,0,0.72)'; x.fillRect(38, 40, 180, 14);
  if (downed) { x.fillStyle = '#e0443a'; x.fillRect(40, 42, 176, 10); }
  else { x.fillStyle = barColor(f); x.fillRect(40, 42, 176 * f, 10); }
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1.5; x.strokeRect(38.5, 40.5, 179, 13);
}

function makeSprite(cv, order) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  sp.renderOrder = order;
  return sp;
}

function drawDiamond(cv, color) {
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.beginPath(); x.moveTo(32, 4); x.lineTo(58, 32); x.lineTo(32, 60); x.lineTo(6, 32); x.closePath();
  x.fillStyle = color; x.fill(); x.lineWidth = 5; x.strokeStyle = '#000'; x.stroke();
}

function drawBleed(cv, sec) {
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 128, 64);
  const cx = 20, cy = 32;
  x.fillStyle = '#000'; x.fillRect(cx - 7, cy - 19, 14, 38); x.fillRect(cx - 19, cy - 7, 38, 14); // contour
  x.fillStyle = '#d4201a'; x.fillRect(cx - 5, cy - 17, 10, 34); x.fillRect(cx - 17, cy - 5, 34, 10);
  x.font = 'bold 34px Arial'; x.textAlign = 'left';
  x.lineWidth = 6; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(`${sec} s`, 46, 43);
  x.fillStyle = '#fff'; x.fillText(`${sec} s`, 46, 43);
}

// Coéquipier : personnage articulé (voir characters.js) + état reçu du réseau.
// Même interface que Player pour les zombies (pos, dead, hurt).
export class RemotePlayer {
  constructor(scene, id, name, slot, net) {
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.net = net;
    this.slot = slot;
    this.color = slotColor(slot);
    this.pos = new THREE.Vector3();
    this.tpos = new THREE.Vector3();
    this.yaw = 0; this.tyaw = 0; this.pitch = 0;
    this.health = 100;
    this.points = 0;
    this.dead = false;
    this.weapon = 'rifle';
    this.pap = 0;
    this.reloading = false;
    this.aiming = false;
    this.seen = false;
    this.fireNext = false;
    this.vel = new THREE.Vector3();
    this.ride = null; // { v, seat } quand il est assis sur une moto

    this.avatar = new Avatar(charOf(slot));
    this.group = new THREE.Group();
    this.group.add(this.avatar.root);
    this.group.rotation.order = 'YXZ';
    // étiquette (nom + barre de vie), losange et croix de saignement : voir TEAM plus haut
    this.tagCv = document.createElement('canvas'); this.tagCv.width = 256; this.tagCv.height = 64;
    drawTag(this.tagCv, name, this.color, 100, false);
    this.tag = makeSprite(this.tagCv, 10);
    this.tag.scale.set(1.8, 0.45, 1);
    this.tag.position.y = 2.2;
    this.group.add(this.tag);
    this.tagHp = 100; this.tagDown = false;
    const dc = document.createElement('canvas'); dc.width = 64; dc.height = 64; drawDiamond(dc, this.color);
    this.mark = makeSprite(dc, 11); this.mark.visible = false;
    this.bleedCv = document.createElement('canvas'); this.bleedCv.width = 128; this.bleedCv.height = 64;
    this.bleed = makeSprite(this.bleedCv, 12); this.bleed.visible = false;
    this.bleedSec = -1;
    scene.add(this.group);
    scene.add(this.mark); scene.add(this.bleed); // hors du groupe : l'avatar couché le fait pivoter
    this.hidden = false; this.hiddenT = Math.random() * TEAM.hiddenEvery;
    this.bo = 0; this.rv = null; this.rvl = 0;
  }

  // Budget des mises à jour de texture : à appeler une fois par image avant les update() des coéquipiers
  static tick(dt) { RemotePlayer.tokens = Math.min(TEAM.texPerSec, (RemotePlayer.tokens ?? TEAM.texPerSec) + dt * TEAM.texPerSec); }
  static spend() { if ((RemotePlayer.tokens ?? TEAM.texPerSec) < 1) return false; RemotePlayer.tokens = (RemotePlayer.tokens ?? TEAM.texPerSec) - 1; return true; }

  // Réception d'un état {x,y,z,yaw,pitch,hp,dead,pts,w,pap,rl,ads}
  setState(s) {
    this.tpos.set(s.x, s.y, s.z);
    if (!this.seen) { this.pos.copy(this.tpos); this.yaw = s.yaw; this.seen = true; }
    this.tyaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.hp;
    this.points = s.pts;
    this.weapon = s.w;
    this.pap = s.pap | 0; // niveau du Pack-a-Punch (0 à 3)
    this.reloading = !!s.rl;
    this.aiming = !!s.ads;
    this.downed = !!s.downed;
    this.dead = !!s.dead;
    if (s.mc != null) { if (this.mc != null && s.mc !== this.mc && !this.downed) this.avatar.stab(); this.mc = s.mc; } // coup de couteau
    this.fh = s.fh | 0;                  // maintient la touche d'interaction au Fanal d'Erwin (Acte V)
    this.vt = +s.vt || 0;                // progression de l'enjambement (0 : à plat)
    this.bo = s.bo | 0;                  // secondes avant la mort (à terre)
    this.rv = s.rv ?? null;              // identifiant du joueur qu'il est en train de réanimer
    this.rvl = +s.rvl || 0;              // secondes restantes de cette réanimation
  }

  hurt(amount, kx = 0, kz = 0, src = null) { this.net.send({ t: 'hurt', amount, kx, kz, src }, this.id); } // src : 'blast' | 'crash' | absent (coup)

  // Un tir de ce joueur vient d'être signalé : éclair de bouche et recul
  fire() { this.fireNext = true; }

  // Assis sur une moto : le personnage devient un enfant de la moto (voir mountAvatar dans characters.js)
  setRide(v, seat) {
    if (this.ride && this.ride.v === v && this.ride.seat === seat) return;
    this.ride = { v, seat };
    mountAvatar(this.group, v, seat, this.avatar);
  }

  clearRide() {
    if (!this.ride) return;
    this.ride = null;
    dismountAvatar(this.group);
    this.scene.add(this.group);
    this.pos.copy(this.tpos);
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, 0);
  }

  update(dt, view = null) {
    if (this.ride) { // sur une moto : position et cap suivent la moto, jambes pliées ; le passager peut tourner le buste pour tirer
      const { v, seat } = this.ride;
      v.hipWorld(seat, this.pos);
      seatedUpdate(this.group, v, seat, this.avatar, { dt, aimYaw: this.tyaw, pitch: this.pitch, weapon: this.weapon, pap: this.pap, reloading: this.reloading, aiming: this.aiming, fire: this.fireNext });
      this.fireNext = false;
      this.tag.visible = true;
      this.updateMarks(dt, view);
      return;
    }
    const k = Math.min(1, dt * 12);
    const px = this.pos.x, pz = this.pos.z;
    this.pos.lerp(this.tpos, k);
    let d = this.tyaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // vitesse réelle (m/s) et sens par rapport à l'avant du personnage
    const vx = (this.pos.x - px) / Math.max(dt, 1e-3), vz = (this.pos.z - pz) / Math.max(dt, 1e-3);
    this.vel.x += (vx - this.vel.x) * Math.min(1, dt * 8); this.vel.z += (vz - this.vel.z) * Math.min(1, dt * 8);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwd = -(this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)); // -z = avant
    const isDown = this.downed || this.dead;
    this.avatar.setWeapon(this.weapon, this.pap);
    this.avatar.update({ dt, speed: isDown ? 0 : speed, fwd, pitch: this.pitch, reloading: this.reloading, aiming: this.aiming, fire: this.fireNext });
    this.fireNext = false;
    // à terre : allongé sur le dos
    this.group.rotation.x += ((isDown ? -Math.PI / 2 : 0) - this.group.rotation.x) * k;
    this.group.position.y += isDown ? 0.25 : 0;
    if (this.vt > 0) this.group.position.y += 0.55 * Math.sin(Math.PI * Math.min(1, this.vt)); // enjambement : l'avatar passe par-dessus
    this.tag.position.y = isDown ? 0.9 : 2.2;
    this.tag.visible = true;
    this.updateMarks(dt, view);
  }

  // Taille constante à l'écran des repères, barre de vie, losange à travers les murs, croix et compte à rebours. view = { camera, height,
  // occluded(from, to) } fourni par main.js (absent : tailles par défaut).
  updateMarks(dt, view) {
    const hp = this.downed || this.dead ? 0 : this.health;
    if ((Math.abs(hp - this.tagHp) >= TEAM.hpStep || (this.downed || this.dead) !== this.tagDown) && RemotePlayer.spend()) {
      this.tagHp = hp; this.tagDown = this.downed || this.dead;
      drawTag(this.tagCv, this.name, this.color, hp, this.tagDown);
      this.tag.material.map.needsUpdate = true;
    }
    const tw = this._tw || (this._tw = new THREE.Vector3());
    this.tag.getWorldPosition(tw);
    // les repères hors du groupe suivent la tête (ou le corps couché)
    const down = this.downed && !this.dead;
    this.mark.position.set(tw.x, tw.y + 0.55, tw.z);
    this.bleed.position.set(tw.x, tw.y + 1.15, tw.z);
    if (!view) return;
    const cam = view.camera, d = Math.max(0.5, cam.position.distanceTo(tw));
    const perPx = (2 * d / cam.projectionMatrix.elements[5]) / Math.max(1, view.height); // mètres par pixel d'écran à cette distance
    const nat = 1.8 / perPx;
    const px = Math.max(TEAM.tagMin, Math.min(TEAM.tagMax, nat * TEAM.tagGain));
    this.tag.scale.set(px * perPx, px * perPx / 4, 1);
    // caché derrière un mur ? (rayon de la caméra vers la poitrine, 4 fois par seconde)
    this.hiddenT -= dt;
    if (this.hiddenT <= 0) {
      this.hiddenT = TEAM.hiddenEvery;
      this.hidden = view.occluded ? view.occluded(cam.position, this.pos, this.pos.y + (down ? 0.4 : 1.2)) : false;
    }
    const far = d > TEAM.markFar;
    this.mark.visible = !this.dead && (far || this.hidden);
    const mp = TEAM.markPx * perPx; this.mark.scale.set(mp, mp, 1);
    this.bleed.visible = down;
    if (down) {
      const sec = Math.max(0, this.bo);
      if (sec !== this.bleedSec && RemotePlayer.spend()) { this.bleedSec = sec; drawBleed(this.bleedCv, sec); this.bleed.material.map.needsUpdate = true; }
      const bw = TEAM.crossPx * perPx; this.bleed.scale.set(bw, bw / 2, 1);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.mark); this.scene.remove(this.bleed);
    for (const sp of [this.tag, this.mark, this.bleed]) { sp.material.map.dispose(); sp.material.dispose(); }
  }
}
