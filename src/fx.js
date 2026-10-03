import * as THREE from 'three';

// Effets visuels légers : particules instanciées (sang, verre, terre, poussière)
// et taches de sang persistantes au sol. Un seul draw call pour toutes les particules.
const N = 280;
const DECALS = 36;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  for (let i = 0; i < 38; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 34;
    const r = 5 + Math.random() * 16 * (1 - d / 50);
    const g = x.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 14; i++) { // gouttelettes
    const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 30;
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + Math.random() * 3, 0, Math.PI * 2); x.fill();
  }
  return new THREE.CanvasTexture(c);
}

class Fx {
  init(scene) {
    if (this.scene) return;
    this.scene = scene;

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      N
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < N; i++) { this.mesh.setColorAt(i, _c.set(0xffffff)); this.mesh.setMatrixAt(i, ZERO); }
    scene.add(this.mesh);
    this.parts = Array.from({ length: N }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, grav: 12 }));
    this.cursor = 0;
    this.active = 0;

    // Taches de sang
    const tex = splatTexture();
    this.decals = [];
    for (let i = 0; i < DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0x4a0707, transparent: true, opacity: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.decalCursor = 0;

    // Boules de feu des explosions (une lumière unique réutilisée : le nombre de lumières reste constant)
    this.booms = [];
    this.boomGeo = new THREE.SphereGeometry(1, 16, 12);
    this.boomLight = new THREE.PointLight(0xffa040, 0, 18, 2);
    scene.add(this.boomLight);
  }

  // Explosion : boule de feu, débris, fumée, éclair lumineux, trace au sol
  explosion(x, y, z, radius = 5, color = 0xff8a2a) {
    if (!this.scene) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.boomGeo, mat);
    m.position.set(x, Math.max(0.4, y), z);
    m.scale.setScalar(0.3);
    this.scene.add(m);
    this.booms.push({ mesh: m, life: 0.45, max: 0.45, r: radius * 0.45 });
    this.boomLight.color.setHex(color);
    this.boomLight.position.set(x, Math.max(1, y + 0.8), z);
    this.boomLight.intensity = 140;
    this.boomLightT = 0.35;
    this.emit(x, y + 0.3, z, { count: 34, color: [0x2b2621, 0x3d342b, 0x1a1714], speed: 7, up: 7, size: 0.09, life: 1.4, spread: 0.8 });
    this.emit(x, y + 0.3, z, { count: 18, color: [color, 0xffd27a], speed: 5, up: 4, size: 0.05, life: 0.6, grav: 4 });
    this.decal(x, z, radius * 0.5, 0x0d0b09);
  }

  // Émet `count` particules autour de (x,y,z).
  emit(x, y, z, o = {}) {
    if (!this.scene) return;
    const { count = 8, color = 0xffffff, speed = 3, up = 2, size = 0.06, life = 0.8, nx = 0, nz = 0, push = 0, grav = 12, spread = 0.1 } = o;
    const colors = Array.isArray(color) ? color : [color];
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.cursor];
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % N;
      if (p.life <= 0) this.active++;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.x = x + (Math.random() - 0.5) * spread; p.y = y + (Math.random() - 0.5) * spread; p.z = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      p.vx = Math.cos(a) * s + nx * push; p.vz = Math.sin(a) * s + nz * push;
      p.vy = up * (0.4 + Math.random() * 0.9);
      p.size = size * (0.5 + Math.random());
      p.rx = Math.random() * 6; p.ry = Math.random() * 6; p.rz = Math.random() * 6;
      p.sx = (Math.random() - 0.5) * 12; p.sy = (Math.random() - 0.5) * 12; p.sz = (Math.random() - 0.5) * 12;
      p.grav = grav;
      this.mesh.setColorAt(idx, _c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  blood(x, y, z, big = false) {
    this.emit(x, y, z, { count: big ? 22 : 8, color: [0x7a0a0a, 0x5c0606, 0x990d0d], speed: big ? 3.2 : 1.8, up: big ? 4 : 2, size: 0.05, life: 0.9 });
  }
  dust(x, y, z) {
    this.emit(x, y, z, { count: 5, color: [0x9a9a96, 0x77746f], speed: 1.2, up: 1.2, size: 0.035, life: 0.5, grav: 6 });
  }
  dirt(x, y, z, count = 18) {
    this.emit(x, y, z, { count, color: [0x3b2f24, 0x2a2119, 0x4a3b2c], speed: 2.4, up: 4, size: 0.06, life: 1.1, spread: 0.7 });
  }
  glass(x, y, z, nx, nz) {
    this.emit(x, y, z, { count: 36, color: [0xbfd6e6, 0x8fb0c4, 0xdbe8f0], speed: 1.6, up: 2.2, size: 0.07, life: 1.4, nx, nz, push: 3.2, spread: 0.9 });
  }

  decal(x, z, size = 1.6, color = 0x4a0707) {
    if (!this.scene) return;
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % DECALS;
    d.life = 30;
    d.mesh.visible = true;
    d.mesh.position.set(x, 0.02 + Math.random() * 0.004, z);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mesh.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    d.mesh.material.opacity = 0.85;
    d.mesh.material.color.setHex(color);
  }

  update(dt) {
    if (!this.scene) return;
    if (this.active > 0) {
      for (let i = 0; i < N; i++) {
        const p = this.parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { this.active--; this.mesh.setMatrixAt(i, ZERO); continue; }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy = Math.abs(p.vy) * 0.2; p.vx *= 0.5; p.vz *= 0.5; p.sx = p.sy = p.sz = 0; }
        p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
        const k = Math.min(1, p.life / 0.25) * p.size;
        _e.set(p.rx, p.ry, p.rz);
        _q.setFromEuler(_e);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(k, k * 0.6, k));
        this.mesh.setMatrixAt(i, _m);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.life -= dt;
      const t = 1 - Math.max(0, b.life) / b.max;
      b.mesh.scale.setScalar(0.3 + b.r * Math.sqrt(t));
      b.mesh.material.opacity = 0.9 * (1 - t);
      if (b.life <= 0) { this.scene.remove(b.mesh); b.mesh.material.dispose(); this.booms.splice(i, 1); }
    }
    if (this.boomLightT > 0) {
      this.boomLightT -= dt;
      this.boomLight.intensity = Math.max(0, this.boomLightT / 0.35) * 140;
    }
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      d.mesh.material.opacity = 0.85 * Math.min(1, d.life / 6);
    }
  }

  clear() {
    if (!this.scene) return;
    for (let i = 0; i < N; i++) { this.parts[i].life = 0; this.mesh.setMatrixAt(i, ZERO); }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.active = 0;
    for (const d of this.decals) { d.life = 0; d.mesh.visible = false; }
  }
}

export const fx = new Fx();
