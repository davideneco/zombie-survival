import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';
import { reflective } from './envmap.js';
import { PARTS } from './weaponParts.js';
import { bakeGroup } from './bake.js';

// =====================================================================
//  Modèles 3D des armes (vue à la première personne et coéquipiers).
//  Textures PBR procédurales (acier brossé, polymère granulé, veinage bois),
//  pièces mobiles (culasse/glissière, chargeur, pompe), accessoires aléatoires
//  et Pack-a-Punch. Axe : -z vers l'avant, y vers le haut.
// =====================================================================

const COLORS = {
  black: [0x1c1e21, 0.4, 0.82], gun: [0x2e3138, 0.44, 0.78], parker: [0x3d4148, 0.54, 0.68], poly: [0x24262b, 0.82, 0.12],
  wood: [0x684024, 0.72, 0.05], lwood: [0x885832, 0.66, 0.06], tan: [0xb8a17a, 0.78, 0.12], od: [0x4b5738, 0.78, 0.14],
  silver: [0xcad0d6, 0.22, 0.96], brass: [0xd0a042, 0.26, 0.92], bakelite: [0x482a18, 0.56, 0.12], skin: [0xc9a07a, 0.8, 0],
  lens: [0x1b3c58, 0.08, 0.72], smoke: [0x2a3036, 0.28, 0.22], red: [0xa62a1e, 0.36, 0.65], green: [0x303e30, 0.82, 0.12],
  gold: [0xe4b444, 0.32, 0.4, 0x7a5a14, 1.2],
  // matériaux lumineux (gardent leur couleur sous le reflet Pack-a-Punch : userData.glow)
  glow: [0x55ff77, 0.45, 0, 0x33ff55, 2], dot: [0xff2a2a, 0.35, 0, 0xff2020, 2.8], cyan: [0x66ccff, 0.3, 0, 0x33aaff, 2.2],
  orange: [0xff7a20, 0.38, 0, 0xff6a10, 2.6], ether: [0x40e0c0, 0.3, 0, 0x20c0a0, 1.1],
  tritium: [0x66ff88, 0.3, 0, 0x38ff66, 2.4],
};
const GLOW = new Set(['gold', 'glow', 'dot', 'cyan', 'orange', 'ether', 'beam', 'tritium']);

const REFLECT = { black: 1.0, gun: 1.15, parker: 1.05, silver: 1.65, brass: 1.35, gold: 1.15, bakelite: 0.4, lwood: 0.28, wood: 0.28, lens: 1.8, smoke: 1.1 };
const WORN = new Set(['black', 'gun', 'parker']);

// ------------------------------------------------------------------ Textures PBR procédurales partagées (0 shader supplémentaire)
let W_TEX = null;
function weaponTextures() {
  if (W_TEX) return W_TEX;
  const make = (size, draw, rep = 2) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 4219;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Brushed gunmetal micro-streaks & subtle edge wear
  const metal = make(128, (x, s) => {
    x.fillStyle = '#dcdedf'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const a = 0.03 + rnd() * 0.08;
      x.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      x.fillRect(0, y, s, 1);
    }
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.08})`;
      x.fillRect(rnd() * s, rnd() * s, 6 + rnd() * 24, 1);
    }
  }, 2.5);
  // Fine stippled polymer grip texture
  const poly = make(128, (x, s) => {
    x.fillStyle = '#dadce0'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) for (let px = 0; px < s; px += 2) {
      const v = rnd();
      x.fillStyle = v < 0.45 ? 'rgba(0,0,0,0.12)' : v > 0.72 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';
      x.fillRect(px, y, 2, 2);
    }
  }, 4);
  // Natural walnut/birch wood grain
  const wood = make(128, (x, s) => {
    x.fillStyle = '#e2ccb4'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const w = Math.sin(y * 0.28 + Math.sin(y * 0.07) * 2.2) * 0.5 + 0.5;
      x.fillStyle = `rgba(48,22,8,${0.06 + w * 0.22})`;
      x.fillRect(0, y, s, 1.3);
    }
    for (let i = 0; i < 320; i++) {
      x.fillStyle = 'rgba(30,12,4,0.12)';
      x.fillRect(rnd() * s, rnd() * s, 8 + rnd() * 22, 1);
    }
  }, 2);
  W_TEX = { metal, poly, wood };
  return W_TEX;
}

const TEX_KIND = {
  black: 'metal', gun: 'metal', parker: 'metal', silver: 'metal', brass: 'metal',
  poly: 'poly', tan: 'poly', od: 'poly', green: 'poly',
  wood: 'wood', lwood: 'wood', bakelite: 'wood',
};

// Chaque arme a ses propres matériaux (pour le reflet du Pack-a-Punch)
function mats() {
  const m = {};
  const tx = weaponTextures();
  for (const [k, [color, roughness, metalness, em, emI]] of Object.entries(COLORS)) {
    const map = TEX_KIND[k] ? tx[TEX_KIND[k]] : null;
    m[k] = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true, map });
    if (em != null) { m[k].emissive = new THREE.Color(em); m[k].emissiveIntensity = emI; }
    if (REFLECT[k]) reflective(m[k], REFLECT[k] * CONFIG.graphics.weapons.env);
  }
  m.beam = new THREE.MeshBasicMaterial({ color: 0xff2828, transparent: true, opacity: 0.45, depthWrite: false });
  m.smoke.transparent = true; m.smoke.opacity = 0.72;
  m.lens.emissive = new THREE.Color(0x0b2c4a);
  m.lens.transparent = true; m.lens.opacity = 0.24; m.lens.depthWrite = false;
  return m;
}

// Boîte biseautée (arêtes arrondies, CONFIG.graphics.weapons) : géométries mises en cache par dimensions.
const BOX_CACHE = new Map();
function boxGeo(w, h, d, worn) {
  const key = `${w}|${h}|${d}|${worn ? 1 : 0}`;
  let g = BOX_CACHE.get(key);
  if (g) return g;
  const W = CONFIG.graphics.weapons, r = Math.min(W.bevel, Math.min(w, h, d) * 0.4);
  g = r >= 0.0005 ? new RoundedBoxGeometry(w, h, d, W.bevelSegments, r) : new THREE.BoxGeometry(w, h, d);
  const n = g.attributes.normal, col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    let k = 1;
    if (worn && r >= 0.0005) { const e = 1 - Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))); k = 1 + W.wear * THREE.MathUtils.smoothstep(e, W.wearFrom, W.wearFrom + 0.2); }
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  BOX_CACHE.set(key, g);
  return g;
}

function whiteColors(g) {
  const c = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

const PROF_CACHE = new Map();
function profileGeo(pts, th, rd, hole) {
  const key = JSON.stringify([pts, th, rd, hole]);
  let g = PROF_CACHE.get(key);
  if (g) return g;
  const n = pts.length, sh = new THREE.Shape(), V = (p) => new THREE.Vector2(-p[0], p[1]);
  const A = [], Bq = [];
  for (let i = 0; i < n; i++) {
    const c = V(pts[i]), pr = V(pts[(i + n - 1) % n]), nx = V(pts[(i + 1) % n]), r = pts[i][2] ?? rd;
    A.push(c.clone().lerp(pr, r)); Bq.push(c.clone().lerp(nx, r));
  }
  sh.moveTo(Bq[0].x, Bq[0].y);
  for (let i = 1; i <= n; i++) { const k = i % n; sh.lineTo(A[k].x, A[k].y); sh.quadraticCurveTo(V(pts[k]).x, V(pts[k]).y, Bq[k].x, Bq[k].y); }
  if (hole) { const h = new THREE.Path(); hole.forEach((p, i) => (i ? h.lineTo(-p[0], p[1]) : h.moveTo(-p[0], p[1]))); h.closePath(); sh.holes.push(h); }
  const bt = Math.min(0.0032, th * 0.22), depth = Math.max(0.0005, th - 2 * bt);
  g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bt * 0.85, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  whiteColors(g);
  PROF_CACHE.set(key, g);
  return g;
}

const LATHE_CACHE = new Map();
function latheGeo(prof, seg) {
  const key = JSON.stringify([prof, seg]);
  let g = LATHE_CACHE.get(key);
  if (g) return g;
  g = new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  whiteColors(g);
  LATHE_CACHE.set(key, g);
  return g;
}

// Pièces : B = boîte, C = cylindre le long de z, Y = cylindre vertical, P = profil extrudé, L = solide de révolution (axe z), S = sphère
function build(grp, M, parts) {
  const slidePiv = new THREE.Group(); slidePiv.name = 'slidePivot';
  const pumpPiv = new THREE.Group(); pumpPiv.name = 'pumpPivot';
  const magPiv = new THREE.Group(); magPiv.name = 'magPivot';
  for (const p of parts) {
    const [kind, ...a] = p;
    let mesh;
    if (kind === 'B') {
      const [w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0] = a;
      mesh = new THREE.Mesh(boxGeo(w, h, d, WORN.has(mat)), M[mat]);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    } else if (kind === 'C') {
      const [r, len, x, y, z, mat, seg = 12, r2 = r] = a;
      mesh = new THREE.Mesh(whiteColors(new THREE.CylinderGeometry(r, r2, len, seg)), M[mat]);
      mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z);
    } else if (kind === 'Y') {
      const [r, len, x, y, z, mat, rz = 0, rx = 0, seg = 10] = a;
      mesh = new THREE.Mesh(whiteColors(new THREE.CylinderGeometry(r, r, len, seg)), M[mat]);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz);
    } else if (kind === 'P') {
      const [pts, th, x, mat, rd = 0.25] = a;
      const opt = a.find((t) => t && typeof t === 'object' && !Array.isArray(t));
      mesh = new THREE.Mesh(profileGeo(pts, th, rd, opt?.hole), M[mat]);
      mesh.position.x = x;
    } else if (kind === 'L') {
      const [prof, x, y, mat, seg = 16, sx = 1, sy = 1] = a;
      mesh = new THREE.Mesh(latheGeo(prof, seg), M[mat]);
      mesh.position.set(x, y, 0); mesh.scale.set(sx, sy, 1);
    } else if (kind === 'S') {
      const [r, x, y, z, mat] = a;
      mesh = new THREE.Mesh(whiteColors(new THREE.SphereGeometry(r, 10, 8)), M[mat]);
      mesh.position.set(x, y, z);
    }
    if (p[0] && mesh) {
      if (a.includes('skin')) mesh.userData.skin = true;
      if (a.includes('bolt')) mesh.userData.bolt = true;
      if (a.includes('mag')) mesh.userData.mag = true;
      if (a.includes('optic')) mesh.userData.optic = true;
      if (a.includes('stock')) mesh.userData.stock = true;
      if (a.includes('slide')) mesh.userData.slide = true;
      if (a.includes('pump')) mesh.userData.pump = true;
      const matName = kind === 'S' ? a[4] : kind === 'B' ? a[6] : kind === 'P' || kind === 'L' ? a[3] : a[5];
      if (GLOW.has(matName)) mesh.userData.glow = true;
      if (mesh.userData.slide) slidePiv.add(mesh);
      else if (mesh.userData.pump) pumpPiv.add(mesh);
      else if (mesh.userData.mag) magPiv.add(mesh);
      else grp.add(mesh);
    }
  }
  bakeGroup(grp, grp.children.filter((o) => o.userData.skin || o.userData.bolt || o.userData.optic || o.userData.stock), false);
  if (slidePiv.children.length) { bakeGroup(slidePiv, slidePiv.children.filter((o) => o.userData.glow), false); grp.add(slidePiv); }
  if (pumpPiv.children.length) { bakeGroup(pumpPiv, [], false); grp.add(pumpPiv); }
  if (magPiv.children.length) { bakeGroup(magPiv, [], false); grp.add(magPiv); }
}

// Définitions des 23 armes : ancres d'accessoires, bouche, décalage, poses des mains (back, front, fg, mag, bolt, style)
const DEFS = {
  // ------------------------------------------------ pistolets
  m1911: {
    anchors: { top: [0, 0.026, -0.01], muz: [0, 0.008, -0.156], under: [0, -0.04, -0.08], mag: [0, -0.135, 0.056], magRx: -0.22, side: [0.017, 0, -0.04], k: 0.85 },
    muzzle: -0.17, offset: [0, -0.02, -0.12],
    hands: { back: [0, -0.085, 0.055], front: null, mag: [0, -0.135, 0.055], bolt: [0, 0.012, 0.02], style: 'pistol' },
    parts: PARTS.m1911,
  },
  arex: {
    anchors: { top: [0, 0.03, -0.01], muz: [0, 0.008, -0.148], under: [0, -0.044, -0.08], mag: [0, -0.142, 0.052], magRx: -0.18, side: [0.017, 0, -0.04], k: 0.85 },
    muzzle: -0.17, offset: [0, -0.02, -0.12],
    hands: { back: [0, -0.088, 0.052], front: null, mag: [0, -0.14, 0.052], bolt: [0, 0.014, 0.02], style: 'pistol' },
    parts: PARTS.arex,
  },
  deagle: {
    anchors: { top: [0, 0.045, -0.06], muz: [0, 0.012, -0.205], under: [0, -0.05, -0.1], mag: [0, -0.162, 0.058], magRx: -0.18, side: [0.023, 0, -0.06], k: 1 },
    muzzle: -0.22, offset: [0, -0.01, -0.1],
    hands: { back: [0, -0.095, 0.054], front: null, mag: [0, -0.16, 0.055], bolt: [0, 0.02, 0.02], style: 'pistol' },
    parts: PARTS.deagle,
  },
  magnum: {
    anchors: { top: [0, 0.038, -0.1], muz: [0, 0.019, -0.236], under: [0, -0.002, -0.13], mag: [0, -0.13, 0.085], magRx: -0.3, side: [0.016, 0.01, -0.13], k: 0.9 },
    muzzle: -0.21, offset: [0, -0.02, -0.1],
    hands: { back: [0, -0.082, 0.072], front: null, mag: [-0.03, 0.0, -0.02], bolt: [0, 0.02, 0.07], style: 'revolver' },
    parts: PARTS.magnum,
  },

  // ------------------------------------------------ fusils d'assaut
  rifle: {
    anchors: { top: [0, 0.064, -0.02], muz: [0, 0.004, -0.585], under: [0, -0.025, -0.26], fg: [0, -0.025, -0.32], side: [0.028, 0, -0.26], mag: [0, -0.145, -0.052], magRx: 0.22, drum: [0, -0.115, -0.055, 0.07], k: 1 },
    muzzle: -0.62,
    hands: { back: [0, -0.088, 0.078], front: [-0.015, -0.024, -0.27], fg: [0, -0.072, -0.32], mag: [0, -0.12, -0.052], bolt: [0, 0.052, 0.11], style: 'rifle' },
    parts: PARTS.rifle,
  },
  ak47: {
    anchors: { top: [0, 0.054, -0.06], muz: [0, 0.004, -0.545], under: [0, -0.032, -0.24], fg: [0, -0.032, -0.29], side: [0.028, 0, -0.24], mag: [0, -0.18, -0.055], magRx: 0.36, drum: [0, -0.115, -0.055, 0.075], k: 1 },
    muzzle: -0.58,
    hands: { back: [0, -0.088, 0.11], front: [-0.015, -0.028, -0.25], fg: [0, -0.078, -0.29], mag: [0, -0.13, -0.05], bolt: [0.03, 0.03, -0.04], style: 'rifle' },
    parts: PARTS.ak47,
  },
  famas: {
    anchors: { top: [0, 0.112, -0.01], muz: [0, 0, -0.42], under: [0, -0.054, -0.15], fg: [0, -0.054, -0.16], side: [0.031, -0.01, -0.08], mag: [0, -0.145, 0.145], magRx: 0.05, drum: [0, -0.125, 0.15, 0.068], k: 1 },
    muzzle: -0.42,
    hands: { back: [0, -0.105, -0.062], front: [-0.015, -0.054, -0.16], fg: [0, -0.095, -0.16], mag: [0, -0.125, 0.145], bolt: [0, 0.075, -0.02], style: 'bullpup' },
    parts: PARTS.famas,
  },
  scar: {
    anchors: { top: [0, 0.062, -0.02], muz: [0, 0, -0.605], under: [0, -0.034, -0.28], fg: [0, -0.034, -0.34], side: [0.03, 0, -0.28], mag: [0, -0.145, -0.05], magRx: 0.1, drum: [0, -0.12, -0.05, 0.075], k: 1 },
    muzzle: -0.62,
    hands: { back: [0, -0.09, 0.082], front: [-0.015, -0.032, -0.29], fg: [0, -0.08, -0.34], mag: [0, -0.125, -0.05], bolt: [-0.032, 0.028, -0.08], style: 'rifle' },
    parts: PARTS.scar,
  },

  // ------------------------------------------------ pistolets-mitrailleurs
  smg: {
    anchors: { top: [0, 0.038, 0.02], muz: [0, 0, -0.315], under: [0, -0.048, -0.13], fg: [0, -0.048, -0.14], side: [0.026, 0, -0.05], mag: [0, -0.21, -0.022], magRx: 0, drum: [0, -0.11, -0.025, 0.068], k: 0.9 },
    muzzle: -0.34,
    hands: { back: [0, -0.072, 0.115], front: [-0.012, -0.05, -0.12], fg: [0, -0.09, -0.14], mag: [0, -0.14, -0.022], bolt: [-0.03, 0.01, -0.02], style: 'rifle' },
    parts: PARTS.smg,
  },
  mp5: {
    anchors: { top: [0, 0.05, -0.02], muz: [0, 0.004, -0.36], under: [0, -0.034, -0.2], fg: [0, -0.034, -0.23], side: [0.027, 0, -0.2], mag: [0, -0.145, -0.05], magRx: 0.28, drum: [0, -0.11, -0.055, 0.068], k: 0.95 },
    muzzle: -0.36,
    hands: { back: [0, -0.085, 0.078], front: [-0.014, -0.03, -0.2], fg: [0, -0.078, -0.23], mag: [0, -0.12, -0.05], bolt: [-0.03, 0.038, -0.24], style: 'rifle' },
    parts: PARTS.mp5,
  },
  p90: {
    anchors: { top: [0, 0.064, -0.05], muz: [0, -0.002, -0.255], under: [0, -0.105, -0.06], fg: [0, -0.105, -0.07], side: [0.03, 0, 0.0], mag: [0, 0.055, 0.08], magRx: 0, drum: [0, -0.15, 0.1, 0.06], k: 0.95 },
    muzzle: -0.27,
    hands: { back: [0, -0.065, 0.08], front: [-0.012, -0.085, -0.06], fg: [0, -0.11, -0.07], mag: [0, 0.06, 0.08], bolt: [-0.028, 0.01, -0.08], style: 'bullpup' },
    parts: PARTS.p90,
  },

  // ------------------------------------------------ mitrailleuses
  lmg: {
    anchors: { top: [0, 0.052, -0.04], muz: [0, 0.004, -0.745], under: [0, -0.034, -0.25], fg: [0, -0.034, -0.31], side: [0.029, 0, -0.25], drum: [0, -0.11, -0.02, 0.082], k: 1 },
    muzzle: -0.74,
    hands: { back: [0, -0.088, 0.11], front: [-0.018, -0.032, -0.26], fg: [0, -0.08, -0.31], mag: [0, -0.12, -0.02], bolt: [0.03, 0.028, -0.04], style: 'mg' },
    parts: PARTS.lmg,
  },
  m249: {
    anchors: { top: [0, 0.068, 0.02], muz: [0, 0.006, -0.67], under: [0, -0.045, -0.26], fg: [0, -0.045, -0.32], side: [0.036, 0, -0.05], belt: [-0.075, -0.08, -0.02], k: 1 },
    muzzle: -0.68,
    hands: { back: [0, -0.095, 0.105], front: [-0.02, -0.036, -0.28], fg: [0, -0.09, -0.32], mag: [0, -0.13, -0.04], bolt: [0.04, 0.02, 0.06], style: 'mg' },
    parts: PARTS.m249,
  },
  mg42: {
    anchors: { top: [0, 0.076, 0.02], muz: [0, 0.012, -0.602], under: [0, -0.024, -0.28], fg: [0, -0.024, -0.22], side: [0.032, 0, 0.04], belt: [-0.05, -0.15, 0.02], k: 1 },
    muzzle: -0.6,
    hands: { back: [0, -0.088, 0.105], front: [-0.02, -0.025, -0.18], fg: [0, -0.075, -0.22], mag: [0, -0.12, 0.0], bolt: [0.04, 0.02, 0.08], style: 'mg' },
    parts: PARTS.mg42,
  },
  pkm: {
    anchors: { top: [0, 0.072, 0.0], muz: [0, 0.004, -0.692], under: [0, -0.06, -0.28], fg: [0, -0.06, -0.34], side: [0.032, 0, 0], belt: [-0.06, -0.1, -0.03], k: 1 },
    muzzle: -0.74,
    hands: { back: [0, -0.088, 0.108], front: [-0.02, -0.048, -0.26], fg: [0, -0.1, -0.34], mag: [0, -0.12, -0.04], bolt: [0.038, 0.02, 0.06], style: 'mg' },
    parts: PARTS.pkm,
  },

  // ------------------------------------------------ fusils de précision
  sniper: {
    anchors: { sf: [0, 0.085, -0.235], muz: [0, 0.012, -0.764], side: [0.028, -0.01, -0.28], mag: [0, -0.155, -0.06], magRx: 0, magW: 0.036, magD: 0.064, shells: [0.03, -0.03, 0.2], k: 1, acc: { suppressor: { len: 0.22, r: 0.026 } } },
    muzzle: -0.78,
    hands: { back: [0, -0.065, 0.055], front: [-0.015, -0.032, -0.22], mag: [0, -0.12, -0.06], bolt: [0.04, 0.032, 0.05], style: 'bolt' },
    parts: PARTS.sniper,
  },
  svd: {
    anchors: { sf: [0, 0.075, -0.185], muz: [0, 0.004, -0.815], side: [0.026, -0.01, -0.26], mag: [0, -0.165, -0.05], magRx: 0.3, shells: [0.028, -0.03, 0.26], k: 1, acc: { suppressor: { len: 0.22, r: 0.025 } } },
    muzzle: -0.82,
    hands: { back: [0, -0.088, 0.108], front: [-0.015, -0.028, -0.25], mag: [0, -0.13, -0.05], bolt: [0.03, 0.024, 0.02], style: 'rifle' },
    parts: PARTS.svd,
  },
  barrett: {
    anchors: { sf: [0, 0.12, -0.285], muz: [0, 0.01, -0.86], side: [0.036, 0, -0.32], mag: [0, -0.175, -0.06], magRx: 0, magW: 0.054, magD: 0.094, shells: [0.036, -0.02, 0.22], k: 1, acc: { suppressor: { len: 0.26, r: 0.034 }, muzzleBrake: { len: 0.06 } } },
    muzzle: -0.86,
    hands: { back: [0, -0.11, 0.06], front: [-0.02, -0.045, -0.22], mag: [0, -0.14, -0.06], bolt: [0.04, 0.025, 0.04], style: 'rifle' },
    parts: PARTS.barrett,
  },

  // ------------------------------------------------ fusils à pompe
  shotgun: {
    anchors: { top: [0, 0.044, -0.04], muz: [0, 0.018, -0.635], side: [0.024, 0, -0.24], tubeEnd: [0, -0.018, -0.52], tubeR: 0.0145, lamp: [0, -0.05, -0.44], shells: [0.03, -0.01, 0.26], k: 1 },
    muzzle: -0.66,
    hands: { back: [0, -0.055, 0.16], front: [-0.012, -0.034, -0.32], mag: [0, -0.045, -0.02], bolt: [0, -0.034, -0.24], style: 'pump' },
    parts: PARTS.shotgun,
  },
  saiga: {
    anchors: { top: [0, 0.052, -0.05], muz: [0, 0.012, -0.602], side: [0.028, 0, -0.24], drum: [0, -0.12, -0.06, 0.085], mag: [0, -0.19, -0.06], magRx: 0.28, lamp: [0, -0.052, -0.3], shells: [0.03, -0.02, 0.26], k: 1 },
    muzzle: -0.6,
    hands: { back: [0, -0.088, 0.108], front: [-0.016, -0.028, -0.25], mag: [0, -0.14, -0.06], bolt: [0.03, 0.028, -0.04], style: 'rifle' },
    parts: PARTS.saiga,
  },

  // ------------------------------------------------ armes spéciales
  crossbow: {
    anchors: { top: [0, 0.048, -0.04], tip: [0, 0.052, -0.34], side: [0.03, -0.02, 0.12], under: [0, -0.032, -0.16], k: 1 },
    muzzle: -0.3,
    hands: { back: [0, -0.082, 0.165], front: [0, -0.045, -0.12], mag: [0, 0.04, -0.14], bolt: [0, 0.02, -0.04], style: 'crossbow' },
    parts: PARTS.crossbow,
  },
  m79: {
    anchors: { top: [0, 0.058, -0.08], muz: [0, 0.02, -0.51], under: [0, -0.034, -0.22], side: [0.036, 0.01, -0.18], k: 1 },
    muzzle: -0.5,
    hands: { back: [0, -0.085, 0.045], front: [-0.012, -0.028, -0.24], mag: [0, 0.01, -0.15], bolt: [0, 0.03, 0.04], style: 'break' },
    parts: PARTS.m79,
  },
  raygun: {
    anchors: { muz: [0, 0.002, -0.235], top: [0, 0.056, -0.05], under: [0, -0.044, -0.1], side: [0.032, 0.005, -0.08], k: 0.9 },
    muzzle: -0.22,
    hands: { back: [0, -0.088, 0.042], front: null, mag: [0, 0.02, -0.02], bolt: [0, 0.04, -0.06], style: 'raygun' },
    parts: PARTS.raygun,
  },
};

// =====================================================================
//  Bibliothèque d'accessoires (aléatoires + Pack-a-Punch)
// =====================================================================
const B = (w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0, ...tags) => ['B', w, h, d, x, y, z, mat, rx, ry, rz, ...tags];
const CZ = (r, len, x, y, z, mat, seg = 14, r2 = r, ...tags) => ['C', r, len, x, y, z, mat, seg, r2, ...tags];
const CX = (r, len, x, y, z, mat, seg = 18, ...tags) => ['Y', r, len, x, y, z, mat, Math.PI / 2, 0, seg, ...tags];
const SP = (r, x, y, z, mat, ...tags) => ['S', r, x, y, z, mat, ...tags];

const ACC = {
  // ---- viseurs (châssis ouverts pour voir à travers en vue FPS)
  redDot: (a) => {
    const [, y, z] = a.top, k = a.k;
    return [
      B(0.032 * k, 0.008, 0.068 * k, 0, y + 0.004, z, 'black'),         // rail de fixation bas
      B(0.026 * k, 0.005, 0.022 * k, 0, y + 0.009, z + 0.018 * k, 'gun'), // boîtier diode arrière bas
      B(0.032 * k, 0.0045, 0.018 * k, 0, y + 0.034, z - 0.014 * k, 'black'), // arche supérieure fine
      B(0.0045, 0.028, 0.018 * k, 0.0145 * k, y + 0.02, z - 0.014 * k, 'black'), // montant droit
      B(0.0045, 0.028, 0.018 * k, -0.0145 * k, y + 0.02, z - 0.014 * k, 'black'), // montant gauche
      B(0.024 * k, 0.023, 0.002, 0, y + 0.021, z - 0.014 * k, 'lens'),   // vitre transparente antireflet
      SP(0.0022 * k, 0, y + 0.021, z - 0.012 * k, 'dot'),                // point rouge flottant
    ];
  },
  holo: (a) => {
    const [, y, z] = a.top, k = a.k;
    return [
      B(0.036 * k, 0.009, 0.094 * k, 0, y + 0.0045, z, 'black'),
      B(0.034 * k, 0.011, 0.032 * k, 0, y + 0.012, z - 0.028 * k, 'gun'), // compartiment pile avant bas
      B(0.005, 0.036, 0.068 * k, 0.017 * k, y + 0.026, z, 'black'),
      B(0.005, 0.036, 0.068 * k, -0.017 * k, y + 0.026, z, 'black'),
      B(0.04 * k, 0.006, 0.078 * k, 0, y + 0.045, z, 'black'),
      B(0.028 * k, 0.030, 0.0025, 0, y + 0.027, z - 0.024 * k, 'lens'),
      SP(0.0022 * k, 0, y + 0.027, z + 0.014 * k, 'dot'),
      B(0.009 * k, 0.0018, 0.0018, 0, y + 0.027, z + 0.014 * k, 'dot'),
      B(0.0018, 0.009 * k, 0.0018, 0, y + 0.027, z + 0.014 * k, 'dot'),
    ];
  },
  acog: (a) => {
    const [, y, z] = a.top, k = a.k;
    return [
      B(0.03, 0.02, 0.075, 0, y + 0.01, z, 'black'),
      CZ(0.019, 0.125, 0, y + 0.031, z, 'gun', 16),
      CZ(0.019, 0.038, 0, y + 0.031, z - 0.08, 'black', 16, 0.028 * k),
      CZ(0.023, 0.032, 0, y + 0.031, z + 0.078, 'black', 16),
      CZ(0.025, 0.003, 0, y + 0.031, z - 0.1, 'lens', 14),
      CZ(0.018, 0.003, 0, y + 0.031, z + 0.095, 'lens', 14),
      B(0.006, 0.005, 0.064, 0, y + 0.053, z, 'orange'), // fibre lumineuse
      B(0.012, 0.014, 0.012, 0.022, y + 0.031, z, 'black'), // tourelle de réglage
    ];
  },
  scope4x: (a) => {
    const [, y, z] = a.top, k = a.k;
    return [
      B(0.026, 0.022, 0.016, 0, y + 0.012, z - 0.038, 'black'),         // collier avant
      B(0.026, 0.022, 0.016, 0, y + 0.012, z + 0.042, 'black'),         // collier arrière
      CZ(0.0165, 0.175, 0, y + 0.034, z - 0.006, 'parker', 16),         // tube principal long
      CZ(0.018, 0.052, 0, y + 0.034, z - 0.112, 'black', 16, 0.027 * k), // cloche objectif + pare-soleil
      CZ(0.022, 0.044, 0, y + 0.034, z + 0.096, 'black', 16),           // oculaire
      CZ(0.024 * k, 0.003, 0, y + 0.034, z - 0.138, 'lens', 14),
      CZ(0.018, 0.003, 0, y + 0.034, z + 0.118, 'lens', 14),
      B(0.013, 0.016, 0.013, 0, y + 0.055, z + 0.002, 'black'),         // tourelle élévation
      B(0.014, 0.013, 0.013, 0.021, y + 0.034, z + 0.002, 'black'),     // tourelle dérive
      CZ(0.0195, 0.012, 0, y + 0.034, z + 0.068, 'tritium', 14),        // bague zoom verte
    ];
  },
  // ---- bouche
  compensator: (a) => {
    const [, y, z] = a.muz;
    return [
      B(0.026, 0.026, 0.048, 0, y, z - 0.014, 'gun'),
      ...[0, 1, 2].map((i) => B(0.029, 0.0045, 0.006, 0, y + 0.0135, z - 0.005 - i * 0.012, 'black')),
    ];
  },
  suppressor: (a, c) => {
    const [, y, z] = a.muz, len = c.len ?? 0.175, r = (c.r ?? 0.02) * (a.k > 0.9 ? 1 : 0.92);
    const ringMat = (c.level || 0) >= 3 ? 'gold' : 'parker';
    return [
      CZ(r, len, 0, y, z - len / 2 + 0.008, 'black', 16),
      CZ(r * 1.07, 0.014, 0, y, z - 0.012, ringMat, 16),
      CZ(r * 1.05, 0.055, 0, y, z - len * 0.48, 'gun', 16), // manchon thermique
      CZ(r * 1.07, 0.012, 0, y, z - len + 0.006, ringMat, 16),
    ];
  },
  goldBarrel: (a) => {
    const [, y, z] = a.muz, k = a.k;
    return [CZ(0.0115 * (k > 0.9 ? 1.25 : 1), 0.06, 0, y, z + 0.02, 'gold', 12), B(0.006, 0.003, 0.18, 0, a.top[1] + 0.001, a.top[2] - 0.04, 'gold')];
  },
  // ---- dessous et flancs
  foregrip: (a) => {
    const [, y, z] = a.fg;
    return [
      B(0.036, 0.012, 0.052, 0, y - 0.006, z, 'black'),
      CZ(0.016, 0.082, 0, y - 0.05, z, 'poly', 12, 0.014),
      B(0.032, 0.01, 0.038, 0, y - 0.092, z, 'black'),
    ];
  },
  laser: (a, c) => {
    const [, y, z] = c.at || a.under || a.side, k = a.k, zf = z - 0.045 * k;
    const parts = [
      B(0.026 * k, 0.024 * k, 0.058 * k, 0, y - 0.012 * k, z - 0.02 * k, 'black'),
      B(0.014 * k, 0.014 * k, 0.006, 0, y - 0.012 * k, zf - 0.012 * k, 'dot'),
    ];
    if (c.local) parts.push(B(0.0022, 0.0022, 36, 0, y - 0.012 * k, zf - 18.012, 'beam'));
    return parts;
  },
  tacLight: (a) => {
    const src = a.lamp || a.under;
    const [x0, y, z] = src;
    const x = a.lamp ? x0 : (a.side ? a.side[0] + 0.014 : 0.028);
    const yy = a.lamp ? y : y + 0.012;
    return [
      B(0.02, 0.014, 0.046, x * 0.65, yy, z, 'black'),
      CZ(0.015, 0.095, x, yy, z - 0.01, 'gun', 14),
      CZ(0.018, 0.022, x, yy, z - 0.062, 'black', 14, 0.015),
      CZ(0.014, 0.004, x, yy, z - 0.074, 'cyan', 12),
    ];
  },
  extMag: (a) => {
    if (!a.mag) return [];
    const [, y, z] = a.mag, t = a.magRx || 0, dy = -Math.cos(t), dz = -Math.sin(t), w = a.magW ?? 0.034, d = a.magD ?? 0.054;
    return [
      B(w, 0.072, d, 0, y + dy * 0.036, z + dz * 0.036, 'gun', t, 0, 0, 'mag'),
      B(w + 0.008, 0.012, d + 0.01, 0, y + dy * 0.076, z + dz * 0.076, 'black', t, 0, 0, 'mag'),
    ];
  },
  fastMag: (a) => {
    if (!a.mag) return [];
    const [, y, z] = a.mag, t = a.magRx || 0, dy = -Math.cos(t), dz = -Math.sin(t), w = a.magW ?? 0.034, d = a.magD ?? 0.054;
    // Chargeur jumelé / sangle tactique d'extraction rapide (bande bleue/tan + boucle Magpul)
    return [
      B(w * 0.9, 0.09, d * 0.92, w + 0.008, y - dy * 0.025, z - dz * 0.025, 'parker', t, 0, 0, 'mag'),
      B(w * 2.2, 0.026, d + 0.008, w * 0.48, y - dy * 0.02, z - dz * 0.02, 'tan', t, 0, 0, 'mag'), // ruban de couplage
      B(w + 0.006, 0.016, d * 0.7, 0, y + dy * 0.014, z + dz * 0.014, 'poly', t, 0, 0, 'mag'),   // boucle d'extraction
    ];
  },
  drum: (a) => {
    if (!a.drum) return [];
    const [, y, z, r] = a.drum;
    return [
      CX(r, 0.076, 0, y, z, 'gun', 20, 'mag'),
      CX(r * 0.6, 0.088, 0, y, z, 'black', 14, 'mag'),
      CX(r * 0.85, 0.084, 0, y, z, 'parker', 20, 'mag'),
      B(0.034, 0.032, 0.05, 0, y + r - 0.012, z, 'black', 0, 0, 0, 'mag'),
    ];
  },
  // ---- accessoires spéciaux / Pack-a-Punch
  thermal: (a) => {
    const [, y, z] = a.sf;
    return [B(0.062, 0.062, 0.13, 0, y, z - 0.075, 'gun'), B(0.03, 0.012, 0.2, 0, y - 0.04, z - 0.05, 'black'), CZ(0.023, 0.01, 0, y, z - 0.143, 'cyan', 14), B(0.014, 0.022, 0.02, 0.037, y + 0.01, z - 0.05, 'black'),
      B(0.05, 0.008, 0.1, 0, y + 0.035, z - 0.075, 'black')];
  },
  muzzleBrake: (a, c) => {
    const [, y, z] = a.muz, len = c.len ?? 0.07;
    return [B(0.034, 0.034, len, 0, y, z - len / 2 + 0.01, 'gun'), ...[0, 1, 2].flatMap((i) => [B(0.038, 0.005, 0.01, 0, y + 0.0175, z - 0.012 - i * (len / 4), 'black'), B(0.005, 0.022, 0.01, 0.0175, y, z - 0.012 - i * (len / 4), 'black'), B(0.005, 0.022, 0.01, -0.0175, y, z - 0.012 - i * (len / 4), 'black')])];
  },
  heavyBarrel: (a) => {
    const [, y, z] = a.muz, k = a.k ?? 1;
    const isShort = k < 0.96 || z > -0.25;
    const len = isShort ? 0.11 : 0.24, r = isShort ? 0.017 : 0.024;
    const ribs = isShort ? [0, 1, 2] : [0, 1, 2, 3, 4];
    return [
      CZ(r, len, 0, y, z + len * 0.52, 'gun', 14),
      ...ribs.map((i) => CZ(r * 1.24, 0.009, 0, y, z + 0.025 + i * (len / (ribs.length + 0.5)), 'black', 14)),
      CZ(r * 1.18, 0.013, 0, y, z + 0.012, 'gold', 14),
    ];
  },
  speedloader: (a) => {
    // Barillet renforcé + anneau d'extraction rapide laiton sur le Colt Python
    return [
      CZ(0.031, 0.056, 0, 0.004, -0.024, 'parker', 14),
      CZ(0.0325, 0.01, 0, 0.004, -0.052, 'gold', 14),
      CZ(0.0325, 0.01, 0, 0.004, 0.004, 'gold', 14),
      B(0.014, 0.026, 0.034, -0.028, 0.002, 0.02, 'gun'),
    ];
  },
  belt: (a) => {
    const [bx, by, bz] = a.belt;
    return [0, 1, 2, 3, 4, 5, 6].map((i) => { const t = i / 6; return B(0.02, 0.036, 0.03, bx - 0.012 - 0.04 * Math.sin(t * Math.PI), by - 0.12 * t, bz, 'gold', 0, 0, -0.5 * Math.cos(t * Math.PI)); });
  },
  choke: (a) => {
    const [, y, z] = a.muz;
    return [CZ(0.021, 0.045, 0, y, z + 0.0, 'black', 12), CZ(0.0235, 0.008, 0, y, z - 0.015, 'gun', 12)];
  },
  tubeExt: (a) => {
    const [, y, z] = a.tubeEnd, r = a.tubeR;
    return [CZ(r, 0.1, 0, y, z - 0.045, 'black', 10), CZ(r * 1.25, 0.012, 0, y, z - 0.098, 'gun', 10)];
  },
  flashlight: (a) => {
    const [, y, z] = a.lamp;
    return [B(0.024, 0.012, 0.05, 0, y + 0.014, z, 'black'), CZ(0.018, 0.1, 0, y, z, 'black', 12), CZ(0.016, 0.004, 0, y, z - 0.052, 'cyan', 12)];
  },
  dragon: (a) => {
    const [, y, z] = a.muz;
    return [CZ(0.02, 0.07, 0, y, z - 0.02, 'black', 12, 0.034), CZ(0.031, 0.006, 0, y, z - 0.056, 'orange', 14), CZ(0.024, 0.002, 0, y, z - 0.0595, 'orange', 14)];
  },
  shells: (a) => {
    const [x, y, z] = a.shells;
    return [B(0.01, 0.014, 0.1, x, y - 0.024, z + 0.033, 'poly'), ...[0, 1, 2, 3].map((i) => ['Y', 0.0085, 0.044, x + 0.005, y, z + i * 0.022, 'orange', 0, 0, 8])];
  },
  explosiveRounds: (a) => {
    const [x, y, z] = a.shells;
    return [B(0.01, 0.014, 0.1, x, y - 0.024, z + 0.033, 'poly'), ...[0, 1, 2, 3].flatMap((i) => [['Y', 0.0075, 0.04, x + 0.005, y, z + i * 0.022, 'gold', 0, 0, 8], SP(0.0078, x + 0.005, y + 0.022, z + i * 0.022, 'orange')])];
  },
  warhead: (a) => {
    const [, y, z] = a.tip;
    return [[...CZ(0.015, 0.05, 0, y, z + 0.035, 'red', 10, 0.007), 'bolt'], [...CZ(0.0158, 0.008, 0, y, z + 0.05, 'orange', 10), 'bolt']];
  },
  fragWarhead: (a) => {
    const [, y, z] = a.tip;
    return [[...SP(0.02, 0, y, z + 0.04, 'gold'), 'bolt'], ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sy]) => [...B(0.012, 0.012, 0.012, sx * 0.02, y + sy * 0.02, z + 0.04, 'black', 0.5, 0.5, 0), 'bolt']),
      [...CZ(0.022, 0.008, 0, y, z + 0.06, 'orange', 12), 'bolt']];
  },
  quiver: (a) => {
    const [x, y, z] = a.side;
    return [B(0.04, 0.05, 0.16, x + 0.02, y, z, 'poly'), ...[-1, 0, 1].flatMap((i) => [CZ(0.006, 0.12, x + 0.02 + i * 0.012, y + 0.008, z - 0.1, 'black', 8), CZ(0.007, 0.02, x + 0.02 + i * 0.012, y + 0.008, z - 0.165, 'red', 8, 0.003)])];
  },
  shortStock: () => [B(0.044, 0.08, 0.05, 0, -0.03, 0.095, 'wood', 0.15), B(0.05, 0.09, 0.012, 0, -0.035, 0.125, 'poly', 0.15)],
  m79Drum: () => [CZ(0.05, 0.075, 0, 0.008, -0.205, 'gun', 14), ...[0, 1, 2].map((j) => { const t = Math.PI / 2 + j * Math.PI * 2 / 3; return CZ(0.011, 0.004, Math.cos(t) * 0.03, 0.008 + Math.sin(t) * 0.03, -0.2435, 'black', 8); })],
  bigMuzzle: (a) => {
    const [, y, z] = a.muz;
    return [CZ(0.046, 0.07, 0, y, z + 0.02, 'gun', 14), CZ(0.0475, 0.012, 0, y, z + 0.02, 'orange', 14), CZ(0.05, 0.01, 0, y, z - 0.012, 'black', 14)];
  },
  goldFins: () => [...[0, 1, 2].map((i) => B(0.15, 0.016, 0.036, 0, 0, -0.08 - i * 0.05, 'gold')), B(0.012, 0.045, 0.12, 0, 0.055, -0.11, 'gold')],
  twinBulb: () => [SP(0.028, 0, 0.06, -0.15, 'glow'), B(0.012, 0.03, 0.012, 0, 0.045, -0.15, 'gold')],
  coil: () => [B(0.01, 0.01, 0.15, 0.04, 0, -0.3, 'gold'), B(0.01, 0.01, 0.15, -0.04, 0, -0.3, 'gold'), SP(0.014, 0.04, 0, -0.38, 'cyan'), SP(0.014, -0.04, 0, -0.38, 'cyan'), B(0.08, 0.004, 0.004, 0, 0, -0.372, 'cyan')],
  glauncher: (a) => {
    const [, y, z] = a.under;
    return [CZ(0.027, 0.22, 0, y - 0.028, z - 0.02, 'black', 12), CZ(0.03, 0.012, 0, y - 0.028, z - 0.128, 'gun', 12), B(0.05, 0.034, 0.1, 0, y - 0.016, z + 0.06, 'gun'), B(0.006, 0.03, 0.04, 0, y - 0.045, z + 0.1, 'black'), B(0.006, 0.035, 0.012, 0.03, y, z, 'black')];
  },
  etherCell: (a) => {
    const [x, y, z] = a.side;
    return [CZ(0.011, 0.09, x + 0.011, y + 0.012, z, 'ether', 8), B(0.008, 0.026, 0.016, x + 0.004, y + 0.012, z - 0.03, 'black'), B(0.008, 0.026, 0.016, x + 0.004, y + 0.012, z + 0.03, 'black')];
  },
  // Détente FRT (Forced Reset Trigger) : queue de détente rouge anodisée + barre de réarmement forcé et sélecteur auto à l'arrière
  frt: (a) => {
    const sx = (a.side?.[0] || 0.018) + 0.0025;
    const sy = (a.side?.[1] || 0) - 0.01;
    const k = a.k || 1;
    return [
      B(0.007, 0.026 * k, 0.012 * k, 0, -0.034 * k, 0.006, 'red', 0.28),
      B(0.009, 0.008 * k, 0.014 * k, 0, -0.044 * k, 0.002, 'gold', 0.2),
      B(0.004, 0.010, 0.056 * k, sx, sy, 0.012, 'gun'),
      B(0.005, 0.012, 0.014, sx + 0.001, sy + 0.006, 0.038 * k, 'red'),
      B(0.005, 0.006, 0.012, -sx, sy + 0.006, 0.038 * k, 'gold'),
      CZ(0.004, 0.010, sx + 0.003, sy + 0.006, 0.038 * k, 'gold', 8),
    ];
  },
};

// Slot mapping so attachments & Pack-a-Punch accessories never overlap on the same mount (1 max par emplacement)
const ACC_SLOT = {
  redDot: 'optic', holo: 'optic', acog: 'optic', scope4x: 'optic', thermal: 'optic',
  suppressor: 'muzzle', compensator: 'muzzle', muzzleBrake: 'muzzle', heavyBarrel: 'muzzle', choke: 'muzzle', dragon: 'muzzle', bigMuzzle: 'muzzle', warhead: 'muzzle', fragWarhead: 'muzzle', coil: 'muzzle',
  extMag: 'mag', fastMag: 'mag', drum: 'mag', tubeExt: 'mag', speedloader: 'mag', belt: 'mag', quiver: 'mag', m79Drum: 'mag', twinBulb: 'mag',
  foregrip: 'under', glauncher: 'under', shells: 'under', laser: 'under', tacLight: 'under', flashlight: 'under',
  frt: 'trigger',
};

// Vérifie qu'un accessoire dispose bien de ses ancres sur cette arme
function canMount(id, accName) {
  const def = DEFS[id], a = def?.anchors;
  if (!a || !ACC[accName]) return false;
  if (accName === 'frt') return CONFIG.weapons[id]?.cat === 'pistol';
  if ((accName === 'redDot' || accName === 'holo' || accName === 'acog' || accName === 'scope4x') && !a.top) return false;
  if (accName === 'thermal' && !a.sf) return false;
  if ((accName === 'suppressor' || accName === 'compensator' || accName === 'muzzleBrake' || accName === 'heavyBarrel' || accName === 'choke' || accName === 'bigMuzzle') && !a.muz) return false;
  if (accName === 'warhead' && !a.tip) return false;
  if ((accName === 'extMag' || accName === 'fastMag') && !a.mag) return false;
  if (accName === 'drum' && !a.drum) return false;
  if (accName === 'tubeExt' && !a.tubeEnd) return false;
  if (accName === 'belt' && !a.belt) return false;
  if (accName === 'quiver' && !a.side) return false;
  if (accName === 'shells' && !a.shells) return false;
  if (accName === 'foregrip' && !a.fg) return false;
  if (accName === 'laser' && !a.under && !a.side) return false;
  if (accName === 'tacLight' && !a.lamp && !a.under) return false;
  return true;
}

// Retourne la liste des accessoires compatibles groupés par emplacement (triés par niveau de déblocage croissant)
export function compatibleAttachments(id) {
  const A = CONFIG.attachments, W = CONFIG.weapons[id];
  const bySlot = {};
  if (!A || !W || !DEFS[id]) return bySlot;
  for (const s of A.slots) bySlot[s] = [];
  for (const [accId, d] of Object.entries(A.defs)) {
    if (d.exclude?.includes(id)) continue;
    const match = d.ids ? d.ids.includes(id) : d.cats?.includes(W.cat);
    if (!match || !canMount(id, accId)) continue;
    (bySlot[d.slot] ||= []).push(accId);
  }
  for (const s of A.slots) {
    bySlot[s].sort((a, b) => ((A.defs[a]?.unlockLevel ?? 1) - (A.defs[b]?.unlockLevel ?? 1)) || ((A.defs[a]?.price ?? 0) - (A.defs[b]?.price ?? 0)));
  }
  return bySlot;
}

// Retourne [] par défaut (plus d'accessoires aléatoires gratuits au départ : déblocage par niveau + achat en points dans l'Atelier [T]).
// L'option { force: true } reste utilisable par le menu Mods (F9) pour tester des configurations aléatoires.
export function rollAttachments(id, source = 'wall', { force = false } = {}) {
  const A = CONFIG.attachments;
  if (!A) return [];
  if (!force && !A.roll?.enabled) return [];
  const profile = force ? { min: 1, max: 3, slotChance: 0.75 } : (A.roll[source] || A.roll.wall);
  const bySlot = compatibleAttachments(id);
  const availSlots = A.slots.filter((s) => bySlot[s]?.length);
  if (!availSlots.length) return [];
  const shuffled = availSlots.slice().sort(() => Math.random() - 0.5);
  const out = [];
  for (const slot of shuffled) {
    if (out.length >= profile.max) break;
    if (Math.random() < profile.slotChance) {
      const pool = bySlot[slot];
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  while (out.length < Math.min(profile.min, shuffled.length)) {
    const slot = shuffled.find((s) => !out.some((o) => A.defs[o].slot === s));
    if (!slot) break;
    const pool = bySlot[slot];
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

// Accessoires Pack-a-Punch par niveau (cumulatifs, sauf remplacement)
const LOADOUT = {
  pistol: [['redDot', 'compensator'], ['redDot', 'compensator', 'extMag', 'laser'], ['redDot', 'extMag', 'laser', 'suppressor', 'goldBarrel', 'etherCell']],
  ar: [['holo'], ['holo', 'foregrip', 'drum'], ['holo', 'drum', 'glauncher', 'etherCell']],
  smg: [['redDot'], ['redDot', 'drum', 'foregrip'], ['redDot', 'drum', 'foregrip', 'suppressor', 'laser', 'etherCell']],
  mg: [['acog'], ['acog', 'foregrip', 'belt'], ['acog', 'foregrip', 'belt', 'heavyBarrel', 'etherCell']],
  sniper: [['muzzleBrake'], ['muzzleBrake', 'thermal', 'extMag'], ['thermal', 'extMag', 'suppressor', 'explosiveRounds']],
  shotgun: [['choke'], ['choke', 'tubeExt', 'flashlight'], ['dragon', 'tubeExt', 'flashlight', 'shells']],
};
const LOADOUT_ID = {
  saiga: [['choke'], ['choke', 'drum', 'flashlight'], ['dragon', 'drum', 'flashlight', 'shells']],
  lmg: [['acog'], ['acog', 'foregrip', 'drum'], ['acog', 'foregrip', 'drum', 'heavyBarrel', 'etherCell']],
  crossbow: [['warhead'], ['warhead', 'acog', 'quiver'], ['fragWarhead', 'acog', 'quiver']],
  m79: [[], ['shortStock', 'm79Drum'], ['shortStock', 'm79Drum', 'bigMuzzle']],
  raygun: [[], ['goldFins', 'twinBulb'], ['goldFins', 'twinBulb', 'coil']],
};
const loadoutOf = (id, level) => {
  const l = LOADOUT_ID[id] || LOADOUT[CONFIG.weapons[id]?.cat];
  return l?.[level - 1] || null;
};

// Fusionne accessoires du joueur et accessoires Pack-a-Punch sans chevauchement sur un même rail/emplacement.
// Les accessoires équipés par le joueur dans l'atelier [T] ont priorité sur les emplacements cosmétiques du PaP (sauf lance-grenades/ogives PaP III).
const PAP_PRIORITY = new Set(['glauncher', 'fragWarhead', 'dragon']);
function mergeAccessoryList(id, level, atts) {
  const papList = level > 0 ? (loadoutOf(id, level) || []) : [];
  const playerList = Array.isArray(atts) ? atts.filter((n) => canMount(id, n)) : [];
  if (!papList.length && !playerList.length) return null;
  const out = [];
  const usedSlots = new Set();
  for (const name of papList) {
    if (!PAP_PRIORITY.has(name)) continue;
    out.push(name);
    if (ACC_SLOT[name]) usedSlots.add(ACC_SLOT[name]);
  }
  for (const name of playerList) {
    if (out.includes(name)) continue;
    const sl = ACC_SLOT[name];
    if (sl && usedSlots.has(sl)) continue;
    out.push(name);
    if (sl) usedSlots.add(sl);
  }
  for (const name of papList) {
    if (out.includes(name)) continue;
    const sl = ACC_SLOT[name];
    if (sl && usedSlots.has(sl)) continue;
    out.push(name);
    if (sl) usedSlots.add(sl);
  }
  return out;
}

const MATS = new WeakMap();
const CACHE = new WeakMap();

// Pose les accessoires du niveau `level` et les accessoires aléatoires `opts.atts` sur `target`.
export function attachAccessories(target, id, level, base = target, opts = {}) {
  const atts = Array.isArray(opts.atts) ? opts.atts.slice().sort() : [];
  const key = `${level | 0}${opts.local ? 'L' : ''}|${atts.join(',')}`;
  if (target.userData.accKey === key) return;
  target.userData.accKey = key;
  const old = target.getObjectByName('acc');
  if (old) target.remove(old);
  const oldMagAcc = target.getObjectByName('magAcc');
  if (oldMagAcc) oldMagAcc.parent.remove(oldMagAcc);

  // Restore base visibility of replaceable parts
  target.traverse((o) => { if (o.userData.mag || o.userData.stock || o.userData.optic) o.visible = true; });
  const magPiv = target.getObjectByName('magPivot');
  if (magPiv) magPiv.visible = true;

  const list = mergeAccessoryList(id, level | 0, atts);
  target.userData.activeAcc = list || [];
  if (!list || !list.length) return;

  let c = CACHE.get(base);
  if (!c) CACHE.set(base, c = {});
  let entry = c[key];
  if (!entry) {
    const def = DEFS[id], a = { k: 1, magRx: 0, ...def.anchors };
    const staticParts = [], opticParts = [], magParts = [];
    for (const name of list) {
      if (!ACC[name]) continue;
      const built = ACC[name](a, { level: level | 0, local: !!opts.local, ...(a.acc?.[name]) });
      const isOpt = ACC_SLOT[name] === 'optic';
      for (const p of built) {
        if (p.includes('mag')) magParts.push(p);
        else if (isOpt) opticParts.push(p);
        else staticParts.push(p);
      }
    }
    const proto = new THREE.Group(); proto.name = 'acc';
    if (staticParts.length) build(proto, MATS.get(base), staticParts);
    if (opticParts.length) {
      const optGrp = new THREE.Group(); optGrp.name = 'opticAcc';
      build(optGrp, MATS.get(base), opticParts);
      proto.add(optGrp);
    }
    const magProto = magParts.length ? new THREE.Group() : null;
    if (magProto) { magProto.name = 'magAcc'; build(magProto, MATS.get(base), magParts); }
    entry = { proto, magProto };
    c[key] = entry;
  }

  if (entry.proto.children.length) target.add(entry.proto.clone(true));
  if (entry.magProto) {
    const mp = entry.magProto.clone(true);
    if (magPiv) magPiv.add(mp);
    else target.add(mp);
  }
  if (list.includes('drum')) {
    // Hide base magazine meshes but keep the newly attached drum inside magAcc visible!
    if (magPiv) for (const ch of magPiv.children) if (ch.name !== 'magAcc') ch.visible = false;
  }
  if (list.includes('shortStock')) target.traverse((o) => { if (o.userData.stock) o.visible = false; });
  if (list.includes('acog') || list.includes('scope4x') || list.includes('redDot') || list.includes('holo')) target.traverse((o) => { if (o.userData.optic) o.visible = false; });
}

export function buildWeaponModels(parentGroup) {
  const vms = {}, info = {}, hands = {};
  for (const [id, def] of Object.entries(DEFS)) {
    const grp = new THREE.Group();
    const M = mats();
    MATS.set(grp, M);
    build(grp, M, def.parts);
    const off = def.offset || [0, 0, 0];
    if (def.offset) grp.position.set(...def.offset);
    grp.visible = false;
    parentGroup.add(grp);
    vms[id] = grp;
    info[id] = { muzzle: def.muzzle + off[2], muzzleY: off[1] + 0.008 };
    const h = def.hands;
    const addOff = (v) => (v ? new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]) : null);
    hands[id] = {
      back: addOff(h.back),
      front: addOff(h.front),
      fg: addOff(h.fg),
      mag: addOff(h.mag),
      bolt: addOff(h.bolt),
      style: h.style || 'rifle',
    };
  }
  return { vms, info, hands };
}
