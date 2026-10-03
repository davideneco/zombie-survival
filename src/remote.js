import * as THREE from 'three';

// Un skin par emplacement : tenue, teint et couvre-chef distincts pour reconnaître chaque joueur.
const SKINS = [
  { color: 0x3a7bd5, pants: 0x232a38, skin: 0xe0b48f, hair: 0x2b1d12, gear: 'cap' },       // bleu : casquette
  { color: 0x3ad56a, pants: 0x2d3a26, skin: 0x8d5a3b, hair: 0x111111, gear: 'helmet' },    // vert : casque militaire
  { color: 0xd5a63a, pants: 0x3a3226, skin: 0xf1d0b0, hair: 0xb8832f, gear: 'headband' },  // jaune : bandeau
  { color: 0xd53a4a, pants: 0x2a1f22, skin: 0xc9a07a, hair: 0x7a2a12, gear: 'beanie' },    // rouge : bonnet
];
const skinOf = (slot) => SKINS[((slot % SKINS.length) + SKINS.length) % SKINS.length];
export const slotColor = (slot) => '#' + skinOf(slot).color.toString(16).padStart(6, '0');

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

// Coéquipier : avatar humanoïde + état reçu du réseau. Même interface que Player pour les zombies (pos, dead, hurt).
export class RemotePlayer {
  constructor(scene, id, name, slot, net) {
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.net = net;
    this.slot = slot;
    const sk = skinOf(slot);
    this.color = slotColor(slot);
    this.pos = new THREE.Vector3();
    this.tpos = new THREE.Vector3();
    this.yaw = 0; this.tyaw = 0; this.pitch = 0;
    this.health = 100;
    this.points = 0;
    this.dead = false;
    this.weapon = 'rifle';
    this.seen = false;
    this.walkT = 0;

    const std = (color, rough = 0.75, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const shirt = std(sk.color), pants = std(sk.pants), skin = std(sk.skin, 0.8), hair = std(sk.hair, 0.9);
    const dark = std(0x1b1b1d, 0.5, 0.6), boot = std(0x15130f, 0.9);
    const add = (geo, mat, parent, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.group = new THREE.Group();
    // torse + bassin
    add(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), shirt, this.group, 0, 1.12, 0).scale.set(1.1, 1, 0.7);
    add(new THREE.CapsuleGeometry(0.17, 0.1, 3, 8), pants, this.group, 0, 0.78, 0).scale.set(1.15, 1, 0.75);
    // jambes (pivot à la hanche, animées à la marche)
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.11, 0.78, 0);
      add(new THREE.CapsuleGeometry(0.075, 0.55, 3, 8), pants, hip, 0, -0.35, 0);
      add(new THREE.BoxGeometry(0.12, 0.09, 0.28), boot, hip, 0, -0.74, 0.05);
      this.group.add(hip);
      this.legs.push(hip);
    }
    // tête + couvre-chef
    this.headG = new THREE.Group(); this.headG.position.y = 1.62;
    add(new THREE.SphereGeometry(0.14, 14, 10), skin, this.headG, 0, 0, 0);
    if (sk.gear === 'cap') {
      add(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shirt, this.headG, 0, 0.02, 0);
      add(new THREE.BoxGeometry(0.2, 0.02, 0.16), shirt, this.headG, 0, 0.04, -0.15);
    } else if (sk.gear === 'helmet') {
      add(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), std(0x4a5a3a, 0.6, 0.2), this.headG, 0, 0.02, 0);
    } else if (sk.gear === 'headband') {
      add(new THREE.CylinderGeometry(0.148, 0.148, 0.045, 14), std(0xd53a4a), this.headG, 0, 0.06, 0);
      add(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.3), hair, this.headG, 0, 0.03, 0.01);
    } else {
      add(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), std(0xeeeeee), this.headG, 0, 0.03, 0);
      add(new THREE.SphereGeometry(0.04, 8, 6), std(0xeeeeee), this.headG, 0, 0.19, 0);
    }
    this.group.add(this.headG);
    // bras + arme (pivot à l'épaule, suit le pitch)
    this.pitchG = new THREE.Group(); this.pitchG.position.y = 1.4;
    add(new THREE.CapsuleGeometry(0.055, 0.35, 3, 8), shirt, this.pitchG, -0.26, -0.12, -0.1).rotation.x = -1.2;
    add(new THREE.CapsuleGeometry(0.055, 0.35, 3, 8), shirt, this.pitchG, 0.26, -0.1, -0.2).rotation.x = -1.3;
    add(new THREE.BoxGeometry(0.07, 0.1, 0.7), dark, this.pitchG, 0.14, -0.12, -0.45);
    this.group.add(this.pitchG);

    this.tag = nameTag(name, this.color);
    this.tag.position.y = 2.2;
    this.group.add(this.tag);
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
  }

  // Réception d'un état {x,y,z,yaw,pitch,hp,dead,pts,w}
  setState(s) {
    this.tpos.set(s.x, s.y, s.z);
    if (!this.seen) { this.pos.copy(this.tpos); this.yaw = s.yaw; this.seen = true; }
    this.tyaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.hp;
    this.points = s.pts;
    this.weapon = s.w;
    this.downed = !!s.downed;
    this.dead = !!s.dead;
  }

  hurt(amount) { this.net.send({ t: 'hurt', amount }, this.id); }

  update(dt) {
    const k = Math.min(1, dt * 12);
    this.pos.lerp(this.tpos, k);
    let d = this.tyaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.pitchG.rotation.x = this.pitch;
    this.headG.rotation.x = this.pitch * 0.6;
    // marche : les jambes se balancent selon la vitesse réelle
    const speed = Math.hypot(this.tpos.x - this.pos.x, this.tpos.z - this.pos.z);
    this.walkT += dt * Math.min(12, 3 + speed * 8);
    const sw = speed > 0.05 ? Math.sin(this.walkT) * 0.6 : 0;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    // à terre : allongé au sol
    const isDown = this.downed || this.dead;
    this.group.rotation.x += ((isDown ? -Math.PI / 2 : 0) - this.group.rotation.x) * k;
    this.group.position.y += isDown ? 0.25 : 0;
    this.tag.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
}
