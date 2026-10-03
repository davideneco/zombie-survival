import * as THREE from 'three';

const COLORS = [0x3a7bd5, 0x3ad56a, 0xd5a63a, 0xb23ad5];

function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px Arial';
  x.textAlign = 'center';
  x.lineWidth = 6; x.strokeStyle = '#000'; x.strokeText(text, 128, 44);
  x.fillStyle = '#fff'; x.fillText(text, 128, 44);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.4, 0.35, 1);
  sp.renderOrder = 10;
  return sp;
}

// Coéquipier : avatar simple + état reçu du réseau. Même interface que Player pour les zombies (pos, dead, hurt).
export class RemotePlayer {
  constructor(scene, id, name, slot, net) {
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.net = net;
    this.color = '#' + COLORS[slot % COLORS.length].toString(16).padStart(6, '0');
    this.pos = new THREE.Vector3();
    this.tpos = new THREE.Vector3();
    this.yaw = 0; this.tyaw = 0; this.pitch = 0;
    this.health = 100;
    this.points = 0;
    this.dead = false;
    this.weapon = 'rifle';
    this.seen = false;

    const mat = new THREE.MeshStandardMaterial({ color: COLORS[slot % COLORS.length], roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.6 });
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.7, 4, 10), mat);
    body.position.y = 0.85; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    head.position.y = 1.58; head.castShadow = true;
    this.pitchG = new THREE.Group(); this.pitchG.position.y = 1.4;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), dark);
    gun.position.set(0.2, -0.1, -0.4);
    this.pitchG.add(gun);
    this.group.add(body, head, this.pitchG);
    this.tag = nameTag(name);
    this.tag.position.y = 2.1;
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
