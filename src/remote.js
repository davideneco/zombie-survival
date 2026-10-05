import * as THREE from 'three';
import { Avatar, charOf, slotColor } from './characters.js';

export { slotColor };

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 80;
  const x = c.getContext('2d');
  x.font = 'bold 40px Arial';
  x.textAlign = 'center';
  x.lineWidth = 8; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(text, 160, 52);
  x.fillStyle = color; x.fillText(text, 160, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  sp.scale.set(1.8, 0.45, 1);
  sp.renderOrder = 10;
  return sp;
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
    this.pap = false;
    this.reloading = false;
    this.aiming = false;
    this.seen = false;
    this.fireNext = false;
    this.vel = new THREE.Vector3();

    this.avatar = new Avatar(charOf(slot));
    this.group = new THREE.Group();
    this.group.add(this.avatar.root);
    this.group.rotation.order = 'YXZ';
    this.tag = nameTag(name, this.color);
    this.tag.position.y = 2.2;
    this.group.add(this.tag);
    scene.add(this.group);
  }

  // Réception d'un état {x,y,z,yaw,pitch,hp,dead,pts,w,pap,rl,ads}
  setState(s) {
    this.tpos.set(s.x, s.y, s.z);
    if (!this.seen) { this.pos.copy(this.tpos); this.yaw = s.yaw; this.seen = true; }
    this.tyaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.hp;
    this.points = s.pts;
    this.weapon = s.w;
    this.pap = !!s.pap;
    this.reloading = !!s.rl;
    this.aiming = !!s.ads;
    this.downed = !!s.downed;
    this.dead = !!s.dead;
  }

  hurt(amount, kx = 0, kz = 0) { this.net.send({ t: 'hurt', amount, kx, kz }, this.id); }

  // Un tir de ce joueur vient d'être signalé : éclair de bouche et recul
  fire() { this.fireNext = true; }

  update(dt) {
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
    this.tag.position.y = isDown ? 0.9 : 2.2;
    this.tag.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.tag.material.map.dispose(); this.tag.material.dispose();
  }
}
