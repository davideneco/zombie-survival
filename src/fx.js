import * as THREE from 'three';
import { CONFIG } from './config.js';

// Effets visuels légers (v0.47.0 : particules en vraies images) : particules instanciées (sang en gouttes, fumée douce, poussière, éclats, étincelles,
// flammes), taches de sang persistantes au sol ET sur les murs, éclair de tir étoilé. Aucune lumière de plus.
//  - un atlas canvas 512 x 256 (8 cellules de 128) partagé : bouffée douce, goutte, étoile, éclat, éclaboussure, étincelle, braise, bouffée 2 ;
//  - deux réserves de particules (éclairée / sans éclairage), un InstancedMesh de quadrilatères tournés vers la caméra dans le shader chacune ;
//  - toutes les taches (sol et murs) dans UN SEUL InstancedMesh (64 instances, dont CONFIG.graphics.levels[q].decals utilisées) : un appel de rendu
//    au lieu de 64 maillages.
const N = 280;
const NG = 220; // particules sans éclairage
const DECALS = 64; // taches allouées ; le nombre utilisé dépend de la qualité (setQuality : 16 / 36 / 64)

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _n = new THREE.Vector3();
const Zaxis = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// cellules de l'atlas : 0 bouffée, 1 goutte, 2 étoile, 3 éclat, 4 éclaboussure, 5 étincelle, 6 braise, 7 bouffée 2
export const CELL = { puff: 0, drop: 1, star: 2, shard: 3, splat: 4, spark: 5, ember: 6, puff2: 7 };
const SIZE_K = [4.2, 2.3, 5, 2.2, 3, 1.8, 3.2, 4.6]; // taille visuelle / `size` des appels (calée sur les anciens cubes)

function atlasTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  let seed = 4141; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cell = (i, draw) => { x.save(); x.translate((i % 4) * 128 + 64, Math.floor(i / 4) * 128 + 64); x.beginPath(); x.rect(-64, -64, 128, 128); x.clip(); draw(); x.restore(); };
  const soft = (r0, r1, a0, a1 = 0) => { const g = x.createRadialGradient(0, 0, r0, 0, 0, r1); g.addColorStop(0, `rgba(255,255,255,${a0})`); g.addColorStop(1, `rgba(255,255,255,${a1})`); return g; };
  const puff = (i, n) => cell(i, () => { // bouffée douce : plusieurs lobes flous
    for (let k = 0; k < n; k++) { const a = R() * 6.28, d = R() * 18, px = Math.cos(a) * d, py = Math.sin(a) * d, r = 20 + R() * 20; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  });
  puff(0, 7); puff(7, 9);
  cell(1, () => { // goutte : tête ronde, queue effilée vers le haut, reflet
    x.fillStyle = 'rgba(255,255,255,1)'; x.beginPath(); x.moveTo(0, -46); x.bezierCurveTo(10, -22, 30, -6, 30, 12); x.arc(0, 12, 30, 0, Math.PI, false); x.bezierCurveTo(-30, -6, -10, -22, 0, -46); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.ellipse(-10, 8, 6, 10, 0.4, 0, 7); x.fill();
  });
  cell(2, () => { // étoile de bouche de canon : halo + pointes (4 longues, 4 courtes) + cœur blanc
    x.fillStyle = soft(0, 62, 0.6); x.fillRect(-64, -64, 128, 128);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2, L = k % 2 ? 36 : 62, w = k % 2 ? 7 : 9; x.save(); x.rotate(a); const g = x.createLinearGradient(0, 0, L, 0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(0, -w); x.lineTo(L, 0); x.lineTo(0, w); x.closePath(); x.fill(); x.restore(); }
    x.fillStyle = soft(0, 20, 1, 0.15); x.beginPath(); x.arc(0, 0, 20, 0, 7); x.fill();
  });
  cell(3, () => { // éclat : polygone anguleux
    x.fillStyle = 'rgba(255,255,255,1)'; x.beginPath(); const n = 6; for (let k = 0; k < n; k++) { const a = (k / n) * 6.28 + R() * 0.3, r = (k % 2 ? 0.55 : 1) * (28 + R() * 14); x.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.7); } x.closePath(); x.fill();
    x.strokeStyle = 'rgba(200,200,200,0.8)'; x.lineWidth = 2; x.stroke();
  });
  cell(4, () => { // éclaboussure : disque et gouttelettes
    x.fillStyle = soft(10, 34, 1, 0.9); for (let k = 0; k < 8; k++) { const a = R() * 6.28, d = 8 + R() * 18, r = 8 + R() * 14; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, 7); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,0.95)'; for (let k = 0; k < 10; k++) { const a = R() * 6.28, d = 34 + R() * 24; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 1.5 + R() * 3.5, 0, 7); x.fill(); }
  });
  cell(5, () => { x.fillStyle = soft(0, 30, 1, 0); x.fillRect(-64, -64, 128, 128); x.fillStyle = 'rgba(255,255,255,1)'; x.beginPath(); x.arc(0, 0, 8, 0, 7); x.fill(); });
  cell(6, () => { x.fillStyle = soft(0, 56, 0.95, 0); x.fillRect(-64, -64, 128, 128); x.fillStyle = soft(0, 22, 1, 0.5); x.beginPath(); x.arc(0, 0, 22, 0, 7); x.fill(); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  return t;
}

// atlas des taches de sang : 4 variantes 128 x 128 (2 x 2)
function splatAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  let seed = 977; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let v = 0; v < 4; v++) {
    x.save(); x.translate((v % 2) * 128 + 64, Math.floor(v / 2) * 128 + 64); x.beginPath(); x.rect(-64, -64, 128, 128); x.clip();
    const lobes = 22 + v * 4;
    for (let i = 0; i < lobes; i++) {
      const a = R() * Math.PI * 2, d = R() * 32, r = 5 + R() * 15 * (1 - d / 52);
      const g = x.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 16; i++) { const a = R() * Math.PI * 2, d = 30 + R() * 30; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + R() * 3, 0, Math.PI * 2); x.fill(); } // gouttelettes
    if (v >= 2) { x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineCap = 'round'; for (let i = 0; i < 4; i++) { const a = R() * 6.28; x.lineWidth = 2 + R() * 3; x.beginPath(); x.moveTo(Math.cos(a) * 14, Math.sin(a) * 14); x.lineTo(Math.cos(a) * (34 + R() * 24), Math.sin(a) * (34 + R() * 24)); x.stroke(); } } // traînées
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Éclair de tir étoilé : matériau additif partagé (viewmodel du joueur et avatars distants)
let ATLAS = null;
const getAtlas = () => (ATLAS ||= atlasTexture());
export function flashMaterial(opts = {}) {
  const t = getAtlas().clone(); t.needsUpdate = true;
  t.repeat.set(0.25, 0.5); t.offset.set(0.5, 0.5); // cellule 2 (étoile) : colonne 2, rangée du haut
  return new THREE.MeshBasicMaterial({ map: t, color: 0xffcc66, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...opts });
}

// Patch commun : quadrilatère face à la caméra (position de l'instance, taille = norme des colonnes de la matrice, rotation dans l'écran = angle de la colonne x),
// cellule de l'atlas et transparence par instance (attribut aP = [cellule, alpha])
function billboard(mat, atlas) {
  mat.map = atlas;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aP; varying float vA;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvA = aP.y;\n#ifdef USE_MAP\nvMapUv = vec2((uv.x + mod(aP.x, 4.0)) * 0.25, 1.0 - 0.5 * (floor(aP.x / 4.0) + 1.0 - uv.y));\n#endif')
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = vec3(0.0, 0.0, 1.0);')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = modelViewMatrix * (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0));
        float bsx = length(instanceMatrix[0].xyz), bsy = length(instanceMatrix[1].xyz), ba = atan(instanceMatrix[0].y, instanceMatrix[0].x), bc = cos(ba), bs = sin(ba);
        vec2 bo = position.xy * vec2(bsx, bsy);
        mvPosition.xy += vec2(bc * bo.x - bs * bo.y, bs * bo.x + bc * bo.y);
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vA;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vA;');
  };
  mat.customProgramCacheKey = () => 'fx-billboard-v1';
  return mat;
}

class Fx {
  constructor() { this.partK = 1; this.decalMax = 36; }

  // Qualité (CONFIG.graphics.levels) : part des particules émises (1 = toutes) et nombre de taches de sang gardées (sol et murs)
  setQuality(particles = 1, decals = 36) {
    this.partK = particles;
    this.decalMax = Math.min(DECALS, decals);
    if (this.decals) { for (let i = this.decalMax; i < DECALS; i++) this._killDecal(i); if (this.decalCursor >= this.decalMax) this.decalCursor = 0; }
  }

  makePool(material, n) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2); aP.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', aP);
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    for (let i = 0; i < n; i++) { mesh.setColorAt(i, _c.set(0xffffff)); mesh.setMatrixAt(i, ZERO); }
    this.scene.add(mesh);
    const parts = Array.from({ length: n }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, rot: 0, spin: 0, grav: 12, cell: 0, grow: 0, a: 1 }));
    return { mesh, parts, aP, n, cursor: 0, active: 0 };
  }

  init(scene) {
    if (this.scene) return;
    this.scene = scene;
    const atlas = getAtlas();

    // Deux réserves de particules (un seul dessin chacune) : la principale (éclairée : sang, poussière, débris) et une « sans éclairage »
    // (option glow : flammes et fumée des motos, qui doivent rester visibles de nuit). Aucune lumière dans les deux cas.
    const lit = billboard(new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true, depthWrite: false }), atlas);
    const glow = billboard(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: true }), atlas);
    this.pools = [this.makePool(lit, N), this.makePool(glow, NG)];

    // Taches de sang (sol et murs) : un seul InstancedMesh ; la couleur et l'opacité sont par instance
    const dgeo = new THREE.PlaneGeometry(1, 1);
    this.decalP = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 2), 2); this.decalP.setUsage(THREE.DynamicDrawUsage); // [cellule 0..3, opacité]
    dgeo.setAttribute('aP', this.decalP);
    const dmat = new THREE.MeshBasicMaterial({ map: splatAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    dmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aP; varying float vA;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvA = aP.y;\n#ifdef USE_MAP\nvMapUv = vec2((uv.x + mod(aP.x, 2.0)) * 0.5, 1.0 - 0.5 * (floor(aP.x / 2.0) + 1.0 - uv.y));\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vA;');
    };
    dmat.customProgramCacheKey = () => 'fx-decal-v1';
    this.decalMesh = new THREE.InstancedMesh(dgeo, dmat, DECALS);
    this.decalMesh.frustumCulled = false; this.decalMesh.renderOrder = 2;
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DECALS; i++) { this.decalMesh.setMatrixAt(i, ZERO); this.decalMesh.setColorAt(i, _c.set(0x4a0707)); }
    scene.add(this.decalMesh);
    this.decals = Array.from({ length: DECALS }, () => ({ life: 0, m: new THREE.Matrix4() }));
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
    this.emit(x, y + 0.3, z, { count: 22, color: [0x2b2621, 0x3d342b, 0x1a1714], speed: 5, up: 5.5, size: 0.14, life: 1.7, spread: 0.8, grav: 1.5, grow: 1.4, cell: CELL.puff }); // fumée
    this.emit(x, y + 0.3, z, { count: 16, color: [0x2b2621, 0x3d342b], speed: 7, up: 7, size: 0.05, life: 1.2, spread: 0.8, cell: CELL.shard });          // débris
    this.emit(x, y + 0.3, z, { count: 18, color: [color, 0xffd27a], speed: 5, up: 4, size: 0.05, life: 0.6, grav: 4, cell: CELL.spark, glow: true });   // étincelles
    this.decal(x, z, radius * 0.5, 0x0d0b09);
  }

  // Émet `count` particules autour de (x,y,z). cell : cellule de l'atlas (par défaut selon le type : fumée / éclat / braise) ; grow : grossit pendant sa vie
  emit(x, y, z, o = {}) {
    if (!this.scene) return;
    const { count = 8, color = 0xffffff, speed = 3, up = 2, size = 0.06, life = 0.8, nx = 0, nz = 0, push = 0, grav = 12, spread = 0.1, glow = false, grow = 0 } = o;
    const colors = Array.isArray(color) ? color : [color];
    const pool = this.pools[glow ? 1 : 0];
    const n = this.partK >= 1 ? count : Math.max(1, Math.round(count * this.partK));
    let cell = o.cell;
    if (cell == null) { // déduit des anciens appels : lueur chaude -> braise, gris / sombre -> bouffée, petit éclat -> éclat
      const c0 = _c.set(colors[0]); const warm = c0.r > 0.7 && c0.b < 0.75 && c0.r > c0.b + 0.15;
      cell = glow ? (warm ? CELL.ember : CELL.puff) : size < 0.07 ? CELL.shard : CELL.puff;
    }
    for (let i = 0; i < n; i++) {
      const p = pool.parts[pool.cursor];
      const idx = pool.cursor;
      pool.cursor = (pool.cursor + 1) % pool.n;
      if (p.life <= 0) pool.active++;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.x = x + (Math.random() - 0.5) * spread; p.y = y + (Math.random() - 0.5) * spread; p.z = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      p.vx = Math.cos(a) * s + nx * push; p.vz = Math.sin(a) * s + nz * push;
      p.vy = up * (0.4 + Math.random() * 0.9);
      const cc = Array.isArray(cell) ? cell[Math.floor(Math.random() * cell.length)] : cell;
      p.cell = cc; p.size = size * SIZE_K[cc] * (0.55 + Math.random() * 0.9); p.grow = grow;
      p.rot = Math.random() * 6.28; p.spin = (Math.random() - 0.5) * (cc === CELL.puff || cc === CELL.puff2 ? 2 : 8);
      p.grav = grav;
      pool.mesh.setColorAt(idx, _c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  blood(x, y, z, big = false) {
    this.emit(x, y, z, { count: big ? 22 : 8, color: [0x7a0a0a, 0x5c0606, 0x990d0d], speed: big ? 3.2 : 1.8, up: big ? 4 : 2, size: 0.05, life: 0.9, cell: CELL.drop });
    this.emit(x, y, z, { count: big ? 4 : 2, color: [0x5c0606, 0x7a0a0a], speed: 0.5, up: 0.6, size: 0.06, life: 0.7, grav: 0.5, grow: 1.2, cell: CELL.puff2 }); // fine brume rouge
  }
  dust(x, y, z) {
    this.emit(x, y, z, { count: 4, color: [0x9a9a96, 0x77746f], speed: 1.2, up: 1.2, size: 0.04, life: 0.6, grav: 3, grow: 1.5, cell: [CELL.puff, CELL.puff2] });
    this.emit(x, y, z, { count: 3, color: [0x9a9a96, 0x77746f], speed: 1.6, up: 1.4, size: 0.03, life: 0.45, grav: 8, cell: CELL.shard });
  }
  dirt(x, y, z, count = 18) {
    this.emit(x, y, z, { count, color: [0x3b2f24, 0x2a2119, 0x4a3b2c], speed: 2.4, up: 4, size: 0.05, life: 1.1, spread: 0.7, cell: [CELL.shard, CELL.puff2, CELL.shard] });
  }
  glass(x, y, z, nx, nz) {
    this.emit(x, y, z, { count: 36, color: [0xbfd6e6, 0x8fb0c4, 0xdbe8f0], speed: 1.6, up: 2.2, size: 0.06, life: 1.4, nx, nz, push: 3.2, spread: 0.9, cell: CELL.shard });
  }

  // tache : place libre dans la réserve ; m : matrice de la tache (taille et orientation), cell : variante, color
  _putDecal(m, cell, color, life = 30) {
    const i = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % this.decalMax;
    const d = this.decals[i];
    d.life = d.max = life; d.m.copy(m);
    this.decalMesh.setMatrixAt(i, m); this.decalMesh.setColorAt(i, _c.setHex(color));
    this.decalP.setXY(i, cell, 0.85);
    this.decalMesh.instanceMatrix.needsUpdate = true; this.decalMesh.instanceColor.needsUpdate = true; this.decalP.needsUpdate = true;
  }
  _killDecal(i) {
    const d = this.decals[i]; d.life = 0;
    this.decalMesh.setMatrixAt(i, ZERO); this.decalP.setXY(i, 0, 0);
    this.decalMesh.instanceMatrix.needsUpdate = true; this.decalP.needsUpdate = true;
  }

  decal(x, z, size = 1.6, color = 0x4a0707) {
    if (!this.scene) return;
    const sc = size * (0.8 + Math.random() * 0.5);
    _q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * Math.PI * 2, 'XYZ'));
    _m.compose(_p.set(x, 0.02 + Math.random() * 0.004, z), _q, _s.set(sc, sc, 1));
    this._putDecal(_m, Math.floor(Math.random() * 4), color);
  }

  // Tache sur un mur : au point (x, y, z), orientée vers (nx, nz) (la normale approchée du mur : vers le tireur)
  wallDecal(x, y, z, nx, nz, size = 0.9, color = 0x4a0707) {
    if (!this.scene) return;
    const sc = size * (0.7 + Math.random() * 0.6);
    _n.set(nx, 0, nz).normalize();
    _q.setFromUnitVectors(Zaxis, _n).multiply(new THREE.Quaternion().setFromAxisAngle(Zaxis, Math.random() * Math.PI * 2));
    _m.compose(_p.set(x + _n.x * 0.03, y, z + _n.z * 0.03), _q, _s.set(sc, sc, 1));
    this._putDecal(_m, Math.floor(Math.random() * 4), color, 24);
  }

  update(dt) {
    if (!this.scene) return;
    for (const pool of this.pools) {
      if (pool.active <= 0) continue;
      const P = pool.aP.array;
      for (let i = 0; i < pool.n; i++) {
        const p = pool.parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { pool.active--; pool.mesh.setMatrixAt(i, ZERO); P[i * 2 + 1] = 0; continue; }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy = Math.abs(p.vy) * 0.2; p.vx *= 0.5; p.vz *= 0.5; p.spin = 0; }
        p.rot += p.spin * dt;
        const k = 1 - p.life / p.max, fade = Math.min(1, p.life / 0.3) * Math.min(1, 0.4 + k * 6); // apparition rapide, disparition douce
        const sz = p.size * (1 + p.grow * k);
        _q.setFromAxisAngle(Zaxis, p.rot);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(sz, sz, 1));
        pool.mesh.setMatrixAt(i, _m);
        P[i * 2] = p.cell; P[i * 2 + 1] = p.cell === CELL.puff || p.cell === CELL.puff2 ? fade * 0.7 : fade;
      }
      pool.mesh.instanceMatrix.needsUpdate = true; pool.aP.needsUpdate = true;
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
    let dirty = false;
    for (let i = 0; i < DECALS; i++) {
      const d = this.decals[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { this._killDecal(i); continue; }
      const a = 0.85 * Math.min(1, d.life / 6);
      if (d.life < 6) { this.decalP.setY(i, a); dirty = true; }
    }
    if (dirty) this.decalP.needsUpdate = true;
  }

  clear() {
    if (!this.scene) return;
    for (const pool of this.pools) {
      for (let i = 0; i < pool.n; i++) { pool.parts[i].life = 0; pool.mesh.setMatrixAt(i, ZERO); }
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.active = 0;
    }
    for (let i = 0; i < DECALS; i++) this._killDecal(i);
  }
}

export const fx = new Fx();
void CONFIG;
