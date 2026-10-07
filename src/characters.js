import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneWeapon, weaponKit } from './weaponDisplay.js';

// =====================================================================
//  Les personnages jouables : quatre survivants au physique, aux vêtements et à l'équipement distincts.
//  Le modèle est un humanoïde articulé (hanches, genoux, épaules, coudes) : les jambes marchent, les bras
//  saisissent réellement l'arme (cinématique inverse à deux segments), la tête suit la visée.
//  Repère : pieds à y = 0, l'avant du personnage est -z (comme la vue à la première personne).
// =====================================================================

export const CHARACTERS = [
  { id: 'marc', name: 'MARC', role: 'Soldat', accent: '#7cb342', skin: 0xe0b48f, hair: 0x2b1d12, hairStyle: 'short', beard: false, scale: [1.04, 1.02], fp: { sleeve: 0x4a5530, hand: 0x1c1c1e } },
  { id: 'lea', name: 'LÉA', role: 'Infirmière', accent: '#4fc3f7', skin: 0xf1d0b0, hair: 0x8a3a18, hairStyle: 'ponytail', beard: false, scale: [0.94, 0.97], fp: { sleeve: 0xdfe6ee, hand: 0x4aa8e0 } },
  { id: 'karim', name: 'KARIM', role: 'Pompier', accent: '#ff8a3d', skin: 0x8d5a3b, hair: 0x111111, hairStyle: 'buzz', beard: true, scale: [1.1, 1.04], fp: { sleeve: 0xd8541a, hand: 0x2a2a2e } },
  { id: 'chloe', name: 'CHLOÉ', role: 'Étudiante', accent: '#ff5c7a', skin: 0xc9a07a, hair: 0x1c1a24, hairStyle: 'long', beard: false, scale: [0.96, 0.99], fp: { sleeve: 0xb8283c, hand: 0xe0d0b8 } },
  { id: 'lucian', name: 'LUCIAN', role: 'Le Purificateur', accent: '#dfe6ff', skin: 0x6b4630, hair: 0x15110e, hairStyle: 'buzz', beard: true, scale: [1.03, 1.05], fp: { sleeve: 0x16161c, hand: 0x24242a } },
  { id: 'picsou', name: 'PICSOU', role: 'Milliardaire', accent: '#ffd24a', skin: 0xf6f4ee, hair: 0xf6f4ee, hairStyle: 'none', duck: true, scale: [1.02, 0.8], fp: { sleeve: 0xb02020, hand: 0xf6f4ee } },
  { id: 'klukai', name: 'KLUKAI', role: 'Poupée tactique', accent: '#8fd3ff', skin: 0xf3dccb, hair: 0x9fd0ee, hairStyle: 'longtail', beard: false, eye: 0x3aa060, scale: [0.93, 0.98], fp: { sleeve: 0x6a3a9a, hand: 0x141418 } },
  { id: 'harry', name: 'HARRY', role: 'Sorcier', accent: '#e0b040', skin: 0xf0cfb4, hair: 0x16110d, hairStyle: 'messy', beard: false, eye: 0x2f8a3a, scale: [0.95, 0.97], fp: { sleeve: 0x141416, hand: 0xf0cfb4 } },
];
export const charOf = (slot) => CHARACTERS[((slot % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length];
export const slotColor = (slot) => charOf(slot).accent;

// ------------------------------------------------------------------ matériaux (partagés : peu de shaders différents)
const MATS = new Map();
const mat = (color, rough = 0.8, metal = 0.05, map = null) => {
  const key = `${color}|${rough}|${metal}|${map ? map.uuid : ''}`;
  let m = MATS.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map }); MATS.set(key, m); }
  return m;
};

function camoTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#4a5530'; x.fillRect(0, 0, 128, 128);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const col of ['#2f3a22', '#6b6a44', '#1f261a', '#7a7550']) {
    x.fillStyle = col;
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * 128, cy = rnd() * 128, r = 6 + rnd() * 16;
      x.beginPath();
      for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.283, rr = r * (0.6 + rnd() * 0.7); x.lineTo(cx + Math.cos(a) * rr * 1.5, cy + Math.sin(a) * rr * 0.8); }
      x.closePath(); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 1.5); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let CAMO = null;

// ------------------------------------------------------------------ petites aides de construction
const geoCache = new Map();
const G = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const put = (parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
};
const capsule = (r, len) => G(`cap${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 5, 10));
const box = (w, h, d) => G(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphere = (r) => G(`sph${r}`, () => new THREE.SphereGeometry(r, 14, 10));
const cyl = (rt, rb, h, seg = 12) => G(`cyl${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const torus = (r, t) => G(`tor${r}|${t}`, () => new THREE.TorusGeometry(r, t, 8, 18));
const dome = (r, frac = 0.5) => G(`dome${r}|${frac}`, () => new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * frac));

const L1 = 0.3, L2 = 0.3; // bras : épaule -> coude, coude -> poignet (+ main)
const T1 = 0.45, T2 = 0.45; // jambes
const SHOULDER_X = 0.2;
const DOWN = new THREE.Vector3(0, -1, 0);

// Fusionne, dans chaque articulation, les pièces fixes qui partagent le même matériau
function mergeStatic(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh && o.children.length) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) if (c.isMesh && !c.children.length) { if (!byMat.has(c.material)) byMat.set(c.material, []); byMat.get(c.material).push(c); }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); const gg = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); return gg.applyMatrix4(m.matrix); });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const m of list) g.remove(m);
      const mm = new THREE.Mesh(merged, mat); mm.castShadow = true;
      g.add(mm);
    }
  }
}

export class Avatar {
  constructor(ch) {
    this.ch = ch;
    const skin = mat(ch.skin, 0.75), hair = mat(ch.hair, 0.9);
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // mis à l'échelle (taille / carrure)
    this.body.scale.set(ch.scale[0], ch.scale[1], ch.scale[0]);
    this.root.add(this.body);

    // ---- bassin et jambes
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.body.add(this.hips);
    this.torsoG = new THREE.Group(); this.torsoG.position.y = 0.93; this.body.add(this.torsoG);
    this.legs = [];
    this.mats = { skin, hair };
    const out = this.outfit();
    this.mats.out = out;
    put(this.hips, capsule(0.15, 0.08), out.pants, 0, 0.02, 0, 0, 0, Math.PI / 2, 1, 1.05, 0.8);
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.095, 0, 0); this.hips.add(hip);
      put(hip, capsule(0.078, 0.3), out.pants, 0, -0.23, 0);
      const knee = new THREE.Group(); knee.position.y = -T1; hip.add(knee);
      put(knee, capsule(0.062, 0.29), out.pantsLow || out.pants, 0, -0.225, 0);
      put(knee, sphere(0.068), out.pants, 0, 0, 0.012); // genou
      const foot = new THREE.Group(); foot.position.y = -T2; knee.add(foot);
      put(foot, box(0.1, 0.09, 0.27), out.boots, 0, -0.03, -0.05);
      put(foot, box(0.1, 0.035, 0.28), out.sole, 0, -0.075, -0.05);
      put(foot, cyl(0.062, 0.066, 0.12, 10), out.boots, 0, 0.03, 0.02); // tige de la chaussure
      this.legs.push({ hip, knee, side });
    }

    // ---- buste
    const t = this.torsoG;
    put(t, capsule(0.15, 0.1), out.pants, 0, 0.02, 0, 0, 0, Math.PI / 2, 1, 1.0, 0.82);
    put(t, cyl(0.15, 0.16, 0.26, 14), out.top, 0, 0.17, 0, 0, 0, 0, 1.05, 1, 0.82);
    put(t, capsule(0.165, 0.16), out.top, 0, 0.4, 0, 0, 0, 0, 1.15, 1, 0.78);
    put(t, cyl(0.045, 0.05, 0.1, 10), skin, 0, 0.6, 0);
    put(t, cyl(0.158, 0.158, 0.035, 16), out.belt, 0, 0.065, 0, 0, 0, 0, 1.07, 1, 0.84);
    put(t, box(0.045, 0.04, 0.012), mat(0xc0c0c8, 0.3, 0.9), 0, 0.065, -0.14);
    // épaulières / manches
    for (const side of [-1, 1]) put(t, sphere(0.068), out.sleeve, side * SHOULDER_X, 0.5, 0, 0, 0, 0, 1, 0.95, 1);

    // ---- pivot de visée : épaules, bras, arme
    this.pitchG = new THREE.Group(); this.pitchG.position.set(0, 0.5, 0); t.add(this.pitchG);
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(side * SHOULDER_X, 0, 0); this.pitchG.add(sh);
      put(sh, capsule(0.052, 0.2), out.sleeve, 0, -0.15, 0);
      const el = new THREE.Group(); el.position.y = -L1; sh.add(el);
      put(el, sphere(0.05), out.sleeve, 0, 0, 0);
      put(el, capsule(0.044, 0.18), out.foreSleeve || out.sleeve, 0, -0.15, 0);
      const wrist = new THREE.Group(); wrist.position.y = -L2; el.add(wrist);
      put(wrist, box(0.075, 0.1, 0.05), out.gloves, 0, -0.04, 0);
      put(wrist, box(0.075, 0.035, 0.07), out.gloves, 0, -0.1, -0.012); // doigts
      this.arms.push({ sh, el, wrist, side });
    }

    // ---- tête
    this.headG = new THREE.Group(); this.headG.position.set(0, 0.66, 0); this.headG.scale.setScalar(1.1); t.add(this.headG);
    const white = mat(0xf2f2f2, 0.4), dark = mat(0x16100c, 0.5);
    if (ch.duck) this.duckHead(skin);
    else {
    put(this.headG, sphere(0.1), skin, 0, 0.07, 0, 0, 0, 0, 0.92, 1.1, 1.0);
    put(this.headG, sphere(0.085), skin, 0, 0.0, -0.02, 0, 0, 0, 0.95, 0.9, 1.0); // mâchoire
    for (const sx of [-1, 1]) {
      put(this.headG, sphere(0.017), white, sx * 0.04, 0.085, -0.088, 0, 0, 0, 1.15, 0.8, 0.6);
      put(this.headG, sphere(0.01), mat(ch.eye || 0x2a4a68, 0.3), sx * 0.04, 0.085, -0.096);
      put(this.headG, box(0.045, 0.008, 0.012), hair, sx * 0.04, 0.115, -0.092, 0, 0, sx * -0.12);
      put(this.headG, sphere(0.022), skin, sx * 0.093, 0.06, 0.0, 0, 0, 0, 0.5, 1.1, 0.8); // oreilles
    }
    put(this.headG, box(0.022, 0.04, 0.03), mat(ch.skin, 0.8), 0, 0.055, -0.096, 0.25);
    put(this.headG, box(0.05, 0.009, 0.012), mat(0x7a3a34, 0.6), 0, 0.012, -0.088);
    }
    this.hairStyle(hair);
    this.gear();
    this.weapon = null; this.weaponId = null; this.hands = null;
    this.flash = null;
    this.walk = 0; this.kick = 0; this.sway = 0;
    this.pole = [new THREE.Vector3(-0.5, -1, 0.15), new THREE.Vector3(0.5, -1, 0.15)];
    mergeStatic(this.root); // ~80 maillages -> ~30 : beaucoup moins d'appels de dessin par coéquipier
    this.setWeapon('rifle');
  }

  // -------------------------------------------------------------- vêtements
  outfit() {
    const id = this.ch.id;
    if (id === 'marc') {
      CAMO = CAMO || camoTexture();
      const camo = mat(0xffffff, 0.9, 0, CAMO);
      return { top: camo, sleeve: camo, pants: camo, pantsLow: camo, boots: mat(0x1b1710, 0.85), sole: mat(0x0c0c0c, 0.9), belt: mat(0x2a2418, 0.6), gloves: mat(0x1a1a1a, 0.7) };
    }
    if (id === 'lea') {
      return { top: mat(0xdfe6ee, 0.8), sleeve: mat(0xdfe6ee, 0.8), foreSleeve: mat(0x3a8ab8, 0.8), pants: mat(0x3a8ab8, 0.8), boots: mat(0xf0f0f0, 0.6), sole: mat(0x9a9aa4, 0.7), belt: mat(0x1c3a52, 0.7), gloves: mat(0x4aa8e0, 0.6) };
    }
    if (id === 'lucian') {
      const blk = mat(0x16161c, 0.65);
      return { top: blk, sleeve: blk, pants: mat(0x1e1e24, 0.8), boots: mat(0x0e0e10, 0.6), sole: mat(0x060606, 0.9), belt: mat(0xc8a040, 0.35, 0.8), gloves: mat(0x24242a, 0.6) };
    }
    if (id === 'picsou') {
      const red = mat(0xb02020, 0.75), white = mat(0xf6f4ee, 0.9);
      return { top: red, sleeve: red, foreSleeve: red, pants: white, pantsLow: white, boots: mat(0xf0f0f0, 0.7), sole: mat(0xf0a020, 0.5), belt: red, gloves: white };
    }
    if (id === 'klukai') {
      const blk = mat(0x141418, 0.6);
      return { top: blk, sleeve: mat(0x6a3a9a, 0.7), foreSleeve: blk, pants: mat(0x22222a, 0.7), pantsLow: mat(0x0c0c10, 0.5), boots: mat(0x101014, 0.5), sole: mat(0x050505, 0.9), belt: mat(0x3ac8ff, 0.3, 0.3), gloves: blk };
    }
    if (id === 'harry') {
      const robe = mat(0x141416, 0.85);
      return { top: robe, sleeve: robe, pants: mat(0x4a4a50, 0.85), boots: mat(0x1a120c, 0.6), sole: mat(0x0a0a0a, 0.9), belt: mat(0x141416, 0.85), gloves: mat(0xf0cfb4, 0.75) };
    }
    if (id === 'karim') {
      return { top: mat(0xd8541a, 0.75), sleeve: mat(0xd8541a, 0.75), pants: mat(0x1d2536, 0.85), boots: mat(0x141414, 0.7), sole: mat(0x0a0a0a, 0.9), belt: mat(0x111111, 0.6), gloves: mat(0x2a2a2e, 0.7) };
    }
    return { top: mat(0xb8283c, 0.85), sleeve: mat(0xb8283c, 0.85), pants: mat(0x3f5f9a, 0.9), boots: mat(0xf2f2f2, 0.65), sole: mat(0xc8c8d0, 0.8), belt: mat(0x3a2a22, 0.7), gloves: mat(0xe0d0b8, 0.9) };
  }

  hairStyle(hair) {
    const h = this.headG, st = this.ch.hairStyle;
    if (st === 'short') { put(h, dome(0.108, 0.58), hair, 0, 0.075, 0.006, 0, 0, 0, 0.94, 1.1, 1.02); }
    else if (st === 'buzz') { put(h, dome(0.104, 0.5), hair, 0, 0.08, 0.002, 0, 0, 0, 0.93, 1.1, 1.0); }
    else if (st === 'ponytail') {
      put(h, dome(0.11, 0.6), hair, 0, 0.07, 0.01, 0, 0, 0, 0.95, 1.1, 1.05);
      put(h, capsule(0.03, 0.16), hair, 0, 0.0, 0.14, 0.7, 0, 0);
      put(h, torus(0.032, 0.008), mat(0xc22a3a, 0.6), 0, 0.06, 0.112, 0.7, 0, 0);
    } else if (st === 'none') {
      // (Picsou : plumes)
    } else if (st === 'messy') { // cheveux en bataille
      put(h, dome(0.11, 0.6), hair, 0, 0.075, 0.008, 0, 0, 0, 0.96, 1.12, 1.05);
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; put(h, sphere(0.035), hair, Math.cos(a) * 0.07, 0.16 + (k % 3) * 0.012, Math.sin(a) * 0.07 - 0.01); }
      put(h, sphere(0.04), hair, 0.03, 0.13, -0.085, 0, 0, 0, 1.4, 0.7, 0.6); // mèche sur le front
    } else if (st === 'longtail') { // longue queue de cheval
      put(h, dome(0.112, 0.62), hair, 0, 0.07, 0.01, 0, 0, 0, 0.96, 1.1, 1.06);
      put(h, capsule(0.04, 0.42), hair, 0, -0.12, 0.13, 0.25, 0, 0);
      put(h, torus(0.036, 0.01), mat(0x3ac8ff, 0.3, 0.4), 0, 0.08, 0.12, 0.7, 0, 0);
      for (const sx of [-1, 1]) put(h, capsule(0.026, 0.14), hair, sx * 0.09, -0.02, -0.03);
    } else {
      put(h, dome(0.113, 0.62), hair, 0, 0.07, 0.01, 0, 0, 0, 0.96, 1.1, 1.06);
      put(h, capsule(0.085, 0.16), hair, 0, -0.04, 0.05, 0, 0, 0, 1.0, 1, 0.7);
      for (const sx of [-1, 1]) put(h, capsule(0.03, 0.15), hair, sx * 0.088, -0.04, -0.01);
    }
    if (this.ch.beard) {
      put(h, G('beard', () => new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4)), hair, 0, 0.06, -0.012, 0, 0, 0, 0.95, 1.1, 1.02);
      put(h, box(0.06, 0.012, 0.014), hair, 0, 0.032, -0.095); // moustache
    }
  }

  duckHead(white) {
    const h = this.headG;
    put(h, sphere(0.12), white, 0, 0.07, 0, 0, 0, 0, 1.0, 1.1, 1.05);
    const orange = mat(0xf0a020, 0.5);
    put(h, box(0.11, 0.035, 0.13), orange, 0, 0.03, -0.14);       // bec
    put(h, box(0.1, 0.025, 0.11), orange, 0, -0.005, -0.13);
    for (const sx of [-1, 1]) {
      put(h, sphere(0.032), mat(0xffffff, 0.3), sx * 0.045, 0.11, -0.1, 0, 0, 0, 0.9, 1.3, 0.6);
      put(h, sphere(0.014), mat(0x101010, 0.3), sx * 0.045, 0.11, -0.122);
      put(h, torus(0.03, 0.004), mat(0xd4a640, 0.3, 0.8), sx * 0.045, 0.11, -0.125); // pince-nez
      put(h, capsule(0.03, 0.06), white, sx * 0.105, 0.02, 0.0); // favoris
    }
  }

  // -------------------------------------------------------------- équipement propre à chaque personnage
  gear() {
    const id = this.ch.id, t = this.torsoG, h = this.headG, o = this.mats.out;
    if (id === 'lucian') {
      const blk = mat(0x101014, 0.6), white = mat(0xe8e8ee, 0.5), gold = mat(0xc8a040, 0.35, 0.8), glow = mat(0xdfe8ff, 0.3);
      glow.emissive = new THREE.Color(0x8fa8ff); glow.emissiveIntensity = 0.8;
      put(t, box(0.36, 0.55, 0.06), blk, 0, -0.18, 0.15); // pans du long manteau
      put(t, box(0.13, 0.55, 0.05), blk, -0.13, -0.18, -0.14); put(t, box(0.13, 0.55, 0.05), blk, 0.13, -0.18, -0.14);
      put(t, box(0.03, 0.62, 0.065), white, -0.07, 0.3, -0.145); put(t, box(0.03, 0.62, 0.065), white, 0.07, 0.3, -0.145); // liserés blancs
      put(t, cyl(0.1, 0.12, 0.12, 12), white, 0, 0.6, 0); // col montant
      for (const sx of [-1, 1]) { put(t, box(0.12, 0.05, 0.16), gold, sx * SHOULDER_X, 0.56, 0); put(t, box(0.06, 0.16, 0.1), white, sx * 0.17, -0.22, -0.02); }
      put(t, box(0.04, 0.04, 0.04), glow, 0, 0.45, -0.17); // relique lumineuse
    } else if (id === 'picsou') {
      const blk = mat(0x15151a, 0.6), spats = mat(0xf0f0f0, 0.7), orange = mat(0xf0a020, 0.5);
      put(h, cyl(0.1, 0.1, 0.2, 14), blk, 0, 0.27, 0.0); put(h, cyl(0.15, 0.15, 0.015, 16), blk, 0, 0.17, 0); // haut-de-forme
      put(h, cyl(0.101, 0.101, 0.03, 14), mat(0xb02020, 0.6), 0, 0.2, 0);
      put(t, box(0.3, 0.12, 0.2), blk, 0, 0.55, 0.0); // col de la redingote
      put(t, box(0.36, 0.4, 0.05), mat(0xb02020, 0.75), 0, -0.12, 0.13); // basques
      for (const l of this.legs) { put(l.knee, box(0.12, 0.08, 0.3), orange, 0, -0.43, -0.08); put(l.knee, cyl(0.065, 0.065, 0.12, 10), spats, 0, -0.36, 0); }
    } else if (id === 'klukai') {
      const blk = mat(0x141418, 0.6), purple = mat(0x6a3a9a, 0.7), cyan = mat(0x3ac8ff, 0.3, 0.3);
      put(h, dome(0.125, 0.5), blk, 0, 0.09, 0.0, 0, 0, 0, 1, 1, 1.05); put(h, box(0.18, 0.012, 0.12), blk, 0, 0.11, -0.13); // casquette
      put(t, torus(0.07, 0.025), blk, 0, 0.56, 0, Math.PI / 2, 0, 0); // masque autour du cou
      put(t, capsule(0.17, 0.08), purple, 0, 0.22, 0, 0, 0, 0, 1.18, 1, 0.84); // veste violette
      for (const sx of [-1, 1]) put(t, box(0.02, 0.36, 0.012), cyan, sx * 0.06, 0.35, -0.145);
      put(t, box(0.24, 0.26, 0.11), blk, 0, 0.36, 0.17); // sac tactique
      for (const l of this.legs) put(l.hip, box(0.1, 0.06, 0.13), cyan, 0, -0.3, -0.03); // sangles
    } else if (id === 'harry') {
      const blk = mat(0x121214, 0.85), red = mat(0x8a1a1a, 0.8), gold = mat(0xd0a030, 0.6), wood = mat(0x5a3a1e, 0.8);
      for (const sx of [-1, 1]) put(h, torus(0.03, 0.005), mat(0x202024, 0.3, 0.7), sx * 0.04, 0.085, -0.1); // lunettes rondes
      put(h, box(0.025, 0.004, 0.005), mat(0x202024, 0.3, 0.7), 0, 0.087, -0.104);
      put(h, box(0.006, 0.03, 0.004), mat(0xa02020, 0.6), 0.02, 0.14, -0.1, 0, 0, 0.6); // cicatrice
      put(t, cyl(0.17, 0.27, 0.62, 14), blk, 0, -0.2, 0.0, 0, 0, 0, 1, 1, 0.8); // robe de sorcier
      put(t, torus(0.09, 0.03), red, 0, 0.55, 0, Math.PI / 2, 0, 0); // écharpe Gryffondor
      for (let k = 0; k < 3; k++) put(t, box(0.07, 0.025, 0.04), k % 2 ? gold : red, 0.06, 0.42 - k * 0.07, -0.14);
      put(t, cyl(0.008, 0.008, 0.32, 6), wood, -0.16, 0.0, -0.1, 0.4, 0, 0); // baguette à la ceinture
    } else if (id === 'marc') {
      const od = mat(0x3a4228, 0.85), steel = mat(0x4a5238, 0.6, 0.2), blk = mat(0x1d1f1c, 0.7), strap = mat(0x25271f, 0.8);
      // casque avec couvre-casque, lunettes de vision nocturne relevées
      put(h, dome(0.128, 0.6), steel, 0, 0.075, 0.004, 0, 0, 0, 1, 1.08, 1.04);
      put(h, torus(0.122, 0.012), steel, 0, 0.06, 0, Math.PI / 2, 0, 0, 1, 1.05, 1.05);
      put(h, box(0.04, 0.05, 0.05), blk, 0, 0.17, -0.1);
      put(h, cyl(0.016, 0.016, 0.05, 8), blk, -0.018, 0.2, -0.118, Math.PI / 2);
      put(h, cyl(0.016, 0.016, 0.05, 8), blk, 0.018, 0.2, -0.118, Math.PI / 2);
      // gilet tactique : plaques, poches, sangles
      put(t, box(0.34, 0.36, 0.1), blk, 0, 0.4, -0.085);
      put(t, box(0.32, 0.34, 0.09), blk, 0, 0.4, 0.088);
      for (const x of [-0.11, 0, 0.11]) put(t, box(0.085, 0.1, 0.05), od, x, 0.3, -0.15);
      put(t, box(0.1, 0.08, 0.04), od, -0.1, 0.46, -0.145);
      put(t, box(0.04, 0.05, 0.03), mat(0xb89a30, 0.5, 0.6), 0.1, 0.46, -0.145);
      for (const sx of [-1, 1]) put(t, box(0.05, 0.12, 0.2), blk, sx * 0.13, 0.55, 0);
      put(t, box(0.04, 0.05, 0.03), mat(0x222222, 0.5, 0.5), 0.2, 0.52, -0.02); // radio d'épaule
      // sac à dos + sac de couchage roulé
      put(t, box(0.26, 0.34, 0.14), od, 0, 0.36, 0.19);
      put(t, box(0.2, 0.14, 0.05), strap, 0, 0.27, 0.27);
      put(t, cyl(0.055, 0.055, 0.3, 12), mat(0x5a5a46, 0.9), 0, 0.57, 0.2, 0, 0, Math.PI / 2);
      // genouillères
      for (const l of this.legs) put(l.knee, box(0.11, 0.1, 0.05), blk, 0, 0.01, -0.07);
    } else if (id === 'lea') {
      const white = mat(0xf4f4f6, 0.7), red = mat(0xc8202c, 0.5), bag = mat(0x3a7a52, 0.8);
      // blouse ouverte, brassard, stéthoscope, sacoche de soins
      put(t, capsule(0.17, 0.16), white, 0, 0.3, 0, 0, 0, 0, 1.08, 1, 0.82);
      put(t, box(0.05, 0.4, 0.06), mat(0x3a8ab8, 0.8), 0, 0.3, -0.11);
      put(h, torus(0.1, 0.014), red, 0, 0.095, 0, Math.PI / 2 - 0.1, 0, 0, 1, 1.1, 1);
      put(t, torus(0.085, 0.01), mat(0x222226, 0.5, 0.6), 0, 0.5, -0.02, Math.PI / 2 + 0.5, 0, 0);
      put(t, sphere(0.022), mat(0xc0c0c8, 0.3, 0.9), 0, 0.33, -0.15);
      put(t, box(0.07, 0.07, 0.07), white, -SHOULDER_X, 0.31, 0);
      put(t, box(0.04, 0.012, 0.075), red, -SHOULDER_X, 0.31, 0);
      put(t, box(0.012, 0.04, 0.075), red, -SHOULDER_X, 0.31, 0);
      put(t, box(0.28, 0.32, 0.14), bag, 0, 0.36, 0.18);
      put(t, box(0.09, 0.025, 0.01), white, 0, 0.4, 0.255);
      put(t, box(0.025, 0.09, 0.01), red, 0, 0.4, 0.256);
      put(t, box(0.3, 0.07, 0.15), mat(0x2d6042, 0.8), 0, 0.5, 0.18);
      for (const sx of [-1, 1]) put(t, box(0.04, 0.34, 0.012), mat(0x2d6042, 0.8), sx * 0.09, 0.4, -0.1); // bretelles
    } else if (id === 'karim') {
      const refl = mat(0xdfe600, 0.4, 0.2), blk = mat(0x141414, 0.7), yel = mat(0xe8c020, 0.55), met = mat(0x9a9aa2, 0.4, 0.8);
      // veste de pompier : bandes réfléchissantes
      put(t, box(0.36, 0.03, 0.27), refl, 0, 0.27, 0, 0, 0, 0, 1, 1, 0.8);
      put(t, box(0.36, 0.03, 0.27), refl, 0, 0.14, 0, 0, 0, 0, 1, 1, 0.78);
      for (const sx of [-1, 1]) put(t, box(0.05, 0.03, 0.05), refl, sx * SHOULDER_X, 0.4, 0, 0, 0, 0, 1, 1, 1).scale.set(1.2, 1, 1.2);
      put(t, box(0.04, 0.3, 0.012), refl, -0.07, 0.4, -0.14);
      put(t, box(0.04, 0.3, 0.012), refl, 0.07, 0.4, -0.14);
      // casque de chantier / pompier avec bavolet
      put(h, dome(0.13, 0.58), yel, 0, 0.075, 0.004, 0, 0, 0, 1, 1.05, 1.05);
      put(h, box(0.2, 0.012, 0.09), yel, 0, 0.085, -0.115);
      put(h, box(0.02, 0.025, 0.2), yel, 0, 0.2, 0);
      put(h, box(0.24, 0.07, 0.02), yel, 0, 0.0, 0.12, -0.2);
      // bouteille d'air + hache dans le dos
      put(t, cyl(0.065, 0.065, 0.46, 12), met, -0.075, 0.38, 0.2);
      put(t, cyl(0.065, 0.065, 0.46, 12), met, 0.075, 0.38, 0.2);
      put(t, cyl(0.022, 0.022, 0.1, 8), blk, 0, 0.62, 0.2, 0, 0, Math.PI / 2);
      put(t, cyl(0.014, 0.014, 0.6, 8), mat(0x6a4a2a, 0.8), 0.17, 0.25, 0.2, 0.3, 0, 0.15);
      put(t, box(0.12, 0.09, 0.02), mat(0xa02020, 0.5, 0.6), 0.21, 0.5, 0.3, 0.3, 0, 0.15);
      for (const l of this.legs) put(l.knee, box(0.14, 0.06, 0.12), refl, 0, -0.3, 0.0);
    } else {
      const cream = mat(0xece0c8, 0.95), pastel = mat(0x7ab8d8, 0.8), blk = mat(0x1a1a1e, 0.7);
      // parka à capuche, écharpe, sac à dos, casque audio autour du cou
      put(t, box(0.04, 0.4, 0.07), blk, 0, 0.3, -0.115); // fermeture
      put(t, capsule(0.12, 0.1), mat(0xa02034, 0.9), 0, 0.58, 0.07, 0.4, 0, 0, 1.3, 1, 0.9); // capuche rabattue
      put(t, torus(0.095, 0.034), cream, 0, 0.56, 0, Math.PI / 2 + 0.15, 0, 0);
      put(t, box(0.07, 0.2, 0.04), cream, 0.05, 0.45, -0.14, 0.1);
      put(t, torus(0.1, 0.012), blk, 0, 0.56, 0.01, Math.PI / 2 - 0.2, 0, 0);
      put(t, box(0.26, 0.3, 0.13), pastel, 0, 0.38, 0.19);
      put(t, box(0.2, 0.12, 0.05), mat(0x5a98b8, 0.8), 0, 0.3, 0.27);
      for (const sx of [-1, 1]) put(t, box(0.04, 0.34, 0.012), pastel, sx * 0.09, 0.4, -0.1);
      put(t, sphere(0.024), mat(0xffd24a, 0.5), 0.1, 0.25, 0.27); // porte-clés
      for (const l of this.legs) put(l.knee, box(0.1, 0.05, 0.012), mat(0x2f4a7a, 0.9), 0, -0.1, -0.065); // genoux usés
    }
  }

  // -------------------------------------------------------------- arme tenue à deux mains
  setWeapon(id, pap = false) {
    const key = id + (pap ? '+' : '');
    if (this.weaponId === key) return;
    this.weaponId = key;
    if (this.weapon) this.pitchG.remove(this.weapon);
    const kit = weaponKit();
    const w = cloneWeapon(kit.models[id] ? id : 'rifle', pap);
    this.scaleW = 1.15;
    this.weapon = new THREE.Group();
    w.scale.setScalar(this.scaleW);
    this.weapon.add(w);
    this.pitchG.add(this.weapon);
    const hd = kit.hands[id] || kit.hands.rifle;
    this.hands = hd;
    // la main arrière sert de repère : elle se pose sur un point fixe devant l'épaule droite
    this.grip = new THREE.Vector3(0.1, -0.19, -0.12);
    this.weapon.position.copy(this.grip).addScaledVector(hd.back, -this.scaleW);
    this.muzzleZ = (kit.muzzles[id] ?? -0.5) * this.scaleW;
    if (this.flash) this.weapon.add(this.flash);
    if (!this.flash) {
      this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
      this.flash.visible = false;
      this.weapon.add(this.flash);
    }
    this.flash.position.set(0, 0.015, this.muzzleZ - 0.05);
  }

  // Coup de couteau : le bras droit part en avant pendant CONFIG.knife.stab s, l'arme tenue plonge (jouée chez les coéquipiers : p_state.mc)
  stab() { this.stabT = 0.35; }

  // Résout un bras : épaule (repère pitchG) -> cible, coude placé vers `pole`
  solveArm(arm, target) {
    const S = arm.sh.position;
    const d = new THREE.Vector3().subVectors(target, S);
    let dist = d.length();
    const reach = L1 + L2 - 0.01;
    if (dist > reach) { d.multiplyScalar(reach / dist); dist = reach; }
    const dir = d.clone().normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = this.pole[arm.side > 0 ? 1 : 0].clone();
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = new THREE.Vector3().copy(dir).multiplyScalar(a).addScaledVector(pole, h); // relatif à l'épaule
    arm.sh.quaternion.setFromUnitVectors(DOWN, elbow.clone().normalize());
    const wr = new THREE.Vector3().copy(d).sub(elbow); // coude -> poignet, dans le repère du pitchG
    wr.applyQuaternion(arm.sh.quaternion.clone().invert());
    arm.el.quaternion.setFromUnitVectors(DOWN, wr.normalize());
  }

  // -------------------------------------------------------------- animation
  // s : { dt, speed, fwd (vitesse avant/arrière locale), pitch, reloading, aiming, downed, fire }
  update(s) {
    const dt = s.dt;
    if (s.seat) {
      // assis sur une moto : cuisses vers l'avant, genoux pliés, buste penché (plus pour le conducteur)
      for (const L of this.legs) { L.hip.rotation.set(1.2, 0, L.side * 0.12); L.knee.rotation.set(-1.4, 0, 0); }
      this.hips.position.y = 0.92; this.torsoG.position.y = 0.93;
      this.torsoG.rotation.x = s.seat === 1 ? -0.36 : -0.18;
    } else {
      // marche : balancement des jambes selon la vitesse réelle
      const sp = Math.min(8, s.speed);
      this.walk += dt * (sp > 0.2 ? 3 + sp * 1.25 : 0);
      const amp = Math.min(1, sp / 4) * 0.65;
      const sw = Math.sin(this.walk) * amp * (s.fwd < -0.5 ? -1 : 1);
      this.legs[0].hip.rotation.x = sw; this.legs[1].hip.rotation.x = -sw;
      this.legs[0].knee.rotation.x = -Math.max(0, -Math.sin(this.walk + 0.9)) * amp * 1.1;
      this.legs[1].knee.rotation.x = -Math.max(0, Math.sin(this.walk + 0.9)) * amp * 1.1;
      // buste : léger rebond, penché en sprint
      const bob = Math.abs(Math.sin(this.walk)) * 0.025 * (amp > 0.05 ? 1 : 0);
      this.torsoG.position.y = 0.93 + bob;
      this.hips.position.y = 0.92 + bob;
      this.torsoG.rotation.x = -Math.min(0.2, sp * 0.02);
    }
    // visée : épaules, tête
    const pitch = s.pitch || 0;
    this.pitchG.rotation.x = pitch * 0.8 - this.torsoG.rotation.x;
    this.headG.rotation.x = pitch * 0.5 - this.torsoG.rotation.x;
    // conducteur : les deux mains sur le guidon (pas d'arme), le buste ne suit pas la visée
    if (s.seat === 1) {
      this.weapon.visible = false;
      this.flash.visible = false;
      this.pitchG.rotation.x = -this.torsoG.rotation.x;
      for (const a of this.arms) this.solveArm(a, new THREE.Vector3(a.side * 0.3, -0.32, -0.52));
      return;
    }
    this.weapon.visible = true;
    // arme : recul, rechargement (elle se baisse et s'incline), visée
    this.kick = Math.max(0, this.kick - dt * 7);
    this.sway += dt;
    const w = this.weapon, g = this.grip;
    const rl = s.reloading ? 1 : 0;
    this.rl = (this.rl || 0) + (rl - (this.rl || 0)) * Math.min(1, dt * 8);
    const ads = s.aiming ? 1 : 0;
    this.ads = (this.ads || 0) + (ads - (this.ads || 0)) * Math.min(1, dt * 10);
    const breathe = Math.sin(this.sway * 1.6) * 0.004;
    const back = this.hands.back, front = this.hands.front;
    const sc = this.scaleW;
    w.position.set(g.x - back.x * sc - this.ads * 0.04, g.y - back.y * sc + breathe - this.rl * 0.1 + this.ads * 0.02, g.z - back.z * sc + this.kick * 0.05 - this.ads * 0.06);
    let sb = 0;
    if (this.stabT > 0) { this.stabT -= dt; const u = Math.max(0, this.stabT) / 0.35; sb = Math.sin(Math.min(1, 1 - u) * Math.PI); }
    w.position.y -= sb * 0.18;
    w.rotation.set(this.kick * 0.18 + this.rl * 0.6 + sb * 0.5, 0, this.rl * -0.25);
    // cibles des mains, dans le repère du pivot
    w.updateMatrix();
    const tr = new THREE.Vector3().copy(back).multiplyScalar(sc).applyMatrix4(w.matrix);
    const tl = front ? new THREE.Vector3().copy(front).multiplyScalar(sc).applyMatrix4(w.matrix) : new THREE.Vector3().copy(back).multiplyScalar(sc).add(new THREE.Vector3(-0.045, -0.035, -0.02)).applyMatrix4(w.matrix);
    if (sb > 0) { tr.z -= sb * 0.34; tr.x -= sb * 0.1; tr.y += sb * 0.04; } // main droite : coup vers l'avant
    this.solveArm(this.arms[1], tr);
    this.solveArm(this.arms[0], tl);
    // éclair de bouche
    if (s.fire) this.kick = 1;
    this.flash.visible = this.kick > 0.6;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * 3;
  }

  dispose() { this.root.parent?.remove(this.root); } // géométries et matériaux sont partagés : rien à libérer
}

// ---------------------------------------------------------------- Personnage assis sur une moto (coéquipier ou joueur local)
// Le personnage devient un enfant de la moto (il en suit cap, inclinaison et position), assis sur la selle `seat`.
// `holder` : le groupe qui porte l'avatar (avatar.root dedans, plus l'étiquette de nom pour un coéquipier). Il ne doit pas être
// repeint en noir quand la moto devient une épave (userData.noWreck).
export function mountAvatar(holder, v, seat, avatar) {
  v.group.add(holder);
  holder.userData.noWreck = true;
  const h = v.model.seats[seat].hip;
  holder.position.set(h[0], h[1] - 0.92 * avatar.ch.scale[1], h[2]);
  holder.rotation.set(0, 0, 0);
}
export function dismountAvatar(holder) { holder.parent?.remove(holder); }
// Pose et animation assis : s = { dt, aimYaw (cap visé), pitch, weapon, pap, reloading, aiming, fire }. Le conducteur a les deux mains
// sur le guidon ; le buste du passager suit la visée (±1,3 rad autour de l'axe de la moto) pour pouvoir tirer.
export function seatedUpdate(holder, v, seat, avatar, s) {
  const d = Math.atan2(Math.sin(s.aimYaw - v.yaw), Math.cos(s.aimYaw - v.yaw));
  holder.rotation.y = seat === 1 ? Math.max(-1.3, Math.min(1.3, d)) : 0;
  avatar.setWeapon(s.weapon, s.pap);
  avatar.update({ dt: s.dt, speed: 0, fwd: 0, pitch: s.pitch, reloading: s.reloading, aiming: s.aiming, fire: s.fire, seat: seat === 0 ? 1 : 2 });
}

// Portrait pour le menu : rendu une fois dans un petit contexte WebGL à part
export function renderPortraits(size = 220) {
  const out = [];
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return CHARACTERS.map(() => ''); }
  r.setSize(size, size * 1.25, false);
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x4a3a2a, 1.4));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6); key.position.set(-2, 3, -3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.4); rim.position.set(3, 2, 3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(31, 1 / 1.25, 0.1, 20);
  cam.position.set(-1.5, 1.25, -4.1); cam.lookAt(0, 0.93, 0);
  for (const ch of CHARACTERS) {
    const av = new Avatar(ch);
    av.root.rotation.y = -0.25;
    av.setWeapon('rifle');
    av.update({ dt: 0.016, speed: 0, fwd: 0, pitch: 0.05 });
    scene.add(av.root);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    out.push(r.domElement.toDataURL('image/png'));
    scene.remove(av.root);
  }
  r.dispose(); r.forceContextLoss?.();
  return out;
}
