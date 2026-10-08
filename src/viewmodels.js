import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Modèles 3D des armes (vue à la première personne). Chaque arme a sa silhouette :
//  canon, garde-main, chargeur, crosse, lunette… construite avec des pièces simples.
//  Axe : -z vers l'avant, y vers le haut. muzzle = position de la bouche du canon.
// =====================================================================

const COLORS = {
  black: [0x1b1c1e, 0.45, 0.75], gun: [0x2c2e33, 0.5, 0.7], parker: [0x3a3c40, 0.6, 0.6], poly: [0x222326, 0.85, 0.1],
  wood: [0x5a3820, 0.75, 0.05], lwood: [0x7a4f2c, 0.7, 0.05], tan: [0xb59e78, 0.8, 0.1], od: [0x4a5536, 0.8, 0.15],
  silver: [0xc4c8cc, 0.25, 0.95], brass: [0xc89a40, 0.3, 0.9], bakelite: [0x3a2618, 0.6, 0.1], skin: [0xc9a07a, 0.8, 0],
  lens: [0x203850, 0.1, 0.6], smoke: [0x2a3036, 0.3, 0.2], red: [0x9a2a1e, 0.4, 0.6], green: [0x2e3a2e, 0.85, 0.1],
  gold: [0xe0b040, 0.35, 0.3, 0x7a5a14, 1.2], // doré : garde sa couleur sous le reflet du Pack-a-Punch (userData.glow)
  // matériaux qui brillent d'eux-mêmes (point rouge, bulbe, cellule d'Éther, laser…) : [couleur, rugosité, métal, émissive, intensité] ; ils gardent leur
  // couleur sous le reflet du Pack-a-Punch (userData.glow)
  glow: [0x55ff77, 0.5, 0, 0x33ff55, 2], dot: [0xff2a2a, 0.4, 0, 0xff2020, 2.5], cyan: [0x66ccff, 0.3, 0, 0x33aaff, 2], orange: [0xff7a20, 0.4, 0, 0xff6a10, 2.5],
  ether: [0x40e0c0, 0.3, 0, 0x20c0a0, 1.1],
};
const GLOW = new Set(['gold', 'glow', 'dot', 'cyan', 'orange', 'ether', 'beam']);

// Chaque arme a ses propres matériaux (pour le reflet du Pack-a-Punch)
function mats() {
  const m = {};
  for (const [k, [color, roughness, metalness, em, emI]] of Object.entries(COLORS)) {
    m[k] = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (em != null) { m[k].emissive = new THREE.Color(em); m[k].emissiveIntensity = emI; }
  }
  m.beam = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.5, depthWrite: false }); // faisceau du laser (joueur local seulement)
  m.smoke.transparent = true; m.smoke.opacity = 0.7;
  m.lens.emissive = new THREE.Color(0x0a1830);
  return m;
}

// Pièces : B = boîte, C = cylindre le long de z, Y = cylindre vertical
function build(grp, M, parts) {
  for (const p of parts) {
    const [kind, ...a] = p;
    let mesh;
    if (kind === 'B') {
      const [w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0] = a;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M[mat]);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    } else if (kind === 'C') {
      const [r, len, x, y, z, mat, seg = 10, r2 = r] = a;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), M[mat]);
      mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z);
    } else if (kind === 'Y') {
      const [r, len, x, y, z, mat, rz = 0, rx = 0, seg = 8] = a;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), M[mat]);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz);
    } else if (kind === 'S') {
      const [r, x, y, z, mat] = a;
      mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), M[mat]);
      mesh.position.set(x, y, z);
    }
    if (p[0] && mesh) {
      if (a.includes('skin')) mesh.userData.skin = true;
      if (a.includes('bolt')) mesh.userData.bolt = true; // carreau d'arbalète : caché quand le chargeur est vide
      if (a.includes('mag')) mesh.userData.mag = true;   // chargeur : caché quand un tambour le remplace (accessoire)
      if (a.includes('optic')) mesh.userData.optic = true; // viseur d'origine : caché quand une lunette le remplace
      if (a.includes('stock')) mesh.userData.stock = true; // crosse : cachée quand l'accessoire la remplace (crosse sciée du M79)
      if (GLOW.has(kind === 'S' ? a[4] : kind === 'B' ? a[6] : a[5])) mesh.userData.glow = true; // matière lumineuse
      grp.add(mesh);
    }
  }
}
// mains : avant (garde-main) et arrière (poignée)
const hands = (front, back) => [
  ...(front ? [['B', 0.09, 0.09, 0.14, front[0], front[1], front[2], 'skin']] : []),
  ['B', 0.09, 0.09, 0.1, back[0], back[1], back[2], 'skin'],
];
// pièces communes
const grip = (z, mat = 'poly', y = -0.08) => ['B', 0.036, 0.1, 0.046, 0, y, z, mat, -0.3];
const curvedMag = (z, mat = 'gun', len = 1) => [['B', 0.034, 0.09 * len, 0.06, 0, -0.08, z, mat, 0.18, 0, 0, 'mag'], ['B', 0.034, 0.09 * len, 0.058, 0, -0.08 - 0.08 * len, z - 0.035 * len, mat, 0.45, 0, 0, 'mag']];
const bipod = (z) => [['Y', 0.008, 0.2, 0.03, -0.09, z, 'black', 0.25, 0.2], ['Y', 0.008, 0.2, -0.03, -0.09, z, 'black', -0.25, 0.2]];
const scope = (y, z, len = 0.3, r = 0.02, bell = 0.03) => [
  ['C', r, len, 0, y, z, 'black', 14], ['C', bell, 0.07, 0, y, z - len / 2 - 0.02, 'black', 14, r], ['C', r * 1.25, 0.06, 0, y, z + len / 2, 'black', 14],
  ['C', bell * 0.85, 0.005, 0, y, z - len / 2 - 0.058, 'lens', 14], ['B', 0.012, 0.035, 0.03, 0, y - 0.035, z - 0.06, 'black'], ['B', 0.012, 0.035, 0.03, 0, y - 0.035, z + 0.08, 'black'],
];

// Définitions : { parts, muzzle (z), offset (position du modèle), hands }
const DEFS = {
  // ------------------------------------------------ pistolets
  m1911: { anchors: { top: [0, 0.019, -0.01], muz: [0, 0.002, -0.156], under: [0, -0.043, -0.08], mag: [0, -0.139, 0.062], magRx: -0.22, side: [0.017, 0, -0.04], k: 0.85 }, muzzle: -0.17, offset: [0, -0.02, -0.12], parts: [
    ['B', 0.034, 0.038, 0.21, 0, 0.0, -0.04, 'gun'], ['B', 0.031, 0.026, 0.16, 0, -0.03, -0.03, 'gun'],
    ...[0, 1, 2, 3, 4].map((i) => ['B', 0.036, 0.03, 0.004, 0, 0.002, 0.03 + i * 0.008, 'black']), // stries de culasse
    ['C', 0.009, 0.012, 0, 0.002, -0.15, 'silver'], ['B', 0.006, 0.01, 0.006, 0, 0.024, -0.13, 'black'], ['B', 0.014, 0.012, 0.01, 0, 0.024, 0.05, 'black'],
    ['B', 0.034, 0.11, 0.05, 0, -0.085, 0.05, 'gun', -0.22], ['B', 0.037, 0.08, 0.036, 0, -0.085, 0.052, 'lwood', -0.22],
    ['B', 0.008, 0.03, 0.05, 0, -0.05, -0.01, 'gun'], ['B', 0.012, 0.022, 0.014, 0, 0.018, 0.075, 'gun', 0.4],
    ...hands(null, [0, -0.11, 0.06])] },
  arex: { anchors: { top: [0, 0.026, -0.01], muz: [0, 0, -0.14], under: [0, -0.046, -0.08], mag: [0, -0.147, 0.055], magRx: -0.18, side: [0.017, 0, -0.04], k: 0.85 }, muzzle: -0.17, offset: [0, -0.02, -0.12], parts: [
    ['B', 0.034, 0.042, 0.2, 0, 0.0, -0.04, 'black'], ['B', 0.036, 0.008, 0.2, 0, 0.022, -0.04, 'black'], ['B', 0.032, 0.028, 0.15, 0, -0.032, -0.04, 'green'],
    ['B', 0.03, 0.012, 0.06, 0, -0.048, -0.09, 'green'], ...[0, 1, 2, 3].map((i) => ['B', 0.037, 0.034, 0.004, 0, 0.0, 0.025 + i * 0.01, 'poly']),
    ['B', 0.035, 0.115, 0.055, 0, -0.09, 0.045, 'green', -0.18], ['B', 0.008, 0.012, 0.008, 0, 0.026, -0.13, 'brass'],
    ...hands(null, [0, -0.11, 0.055])] },
  deagle: { anchors: { top: [0, 0.045, -0.06], muz: [0, 0.002, -0.2], under: [0, -0.05, -0.1], mag: [0, -0.164, 0.0615], magRx: -0.18, side: [0.023, 0, -0.06], k: 1 }, muzzle: -0.22, offset: [0, -0.01, -0.1], parts: [
    ['B', 0.046, 0.05, 0.27, 0, 0.002, -0.06, 'silver'], ['B', 0.032, 0.022, 0.2, 0, 0.034, -0.09, 'silver'], ['B', 0.044, 0.03, 0.17, 0, -0.035, -0.04, 'silver'],
    ...[0, 1, 2, 3, 4, 5].map((i) => ['B', 0.048, 0.04, 0.004, 0, 0.0, 0.02 + i * 0.01, 'parker']),
    ['B', 0.042, 0.13, 0.065, 0, -0.1, 0.05, 'poly', -0.18], ['B', 0.01, 0.034, 0.06, 0, -0.06, -0.015, 'silver'], ['C', 0.006, 0.01, 0, 0.004, -0.2, 'black'],
    ...hands(null, [0, -0.12, 0.055])] },
  magnum: { anchors: { top: [0, 0.038, -0.1], muz: [0, 0.012, -0.23], under: [0, -0.002, -0.13], mag: [0, -0.13, 0.085], magRx: -0.3, side: [0.016, 0.01, -0.13], k: 0.9 }, muzzle: -0.21, offset: [0, -0.02, -0.1], parts: [
    ['C', 0.034, 0.06, 0, -0.005, -0.03, 'silver', 6], ['C', 0.014, 0.2, 0, 0.012, -0.13, 'silver'], ['B', 0.012, 0.016, 0.2, 0, 0.03, -0.13, 'silver'],
    ['B', 0.03, 0.03, 0.1, 0, -0.005, 0.03, 'silver'], ['B', 0.012, 0.03, 0.022, 0, 0.012, -0.22, 'silver'],
    ['B', 0.034, 0.1, 0.046, 0, -0.08, 0.07, 'lwood', -0.3], ['B', 0.008, 0.03, 0.05, 0, -0.045, 0.02, 'silver'],
    ...hands(null, [0, -0.11, 0.08])] },
  // ------------------------------------------------ fusils d'assaut
  rifle: { anchors: { top: [0, 0.052, -0.02], muz: [0, 0.004, -0.605], under: [0, -0.025, -0.26], fg: [0, -0.025, -0.34], side: [0.028, 0, -0.26], drum: [0, -0.115, -0.06, 0.07], k: 1 }, muzzle: -0.62, parts: [ // M4A1
    ['B', 0.05, 0.07, 0.3, 0, 0, 0.0, 'black'], ['B', 0.056, 0.058, 0.22, 0, 0.004, -0.26, 'gun'], ['B', 0.026, 0.012, 0.52, 0, 0.046, -0.12, 'black'],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ['B', 0.03, 0.006, 0.012, 0, 0.055, -0.33 + i * 0.07, 'black']),
    ['C', 0.011, 0.2, 0, 0.004, -0.46, 'black'], ['C', 0.015, 0.05, 0, 0.004, -0.58, 'black', 6], ['B', 0.012, 0.05, 0.014, 0, 0.04, -0.37, 'black'],
    ...curvedMag(-0.05, 'parker', 0.85), grip(0.1), ['C', 0.016, 0.16, 0, 0.0, 0.24, 'black'], ['B', 0.046, 0.085, 0.09, 0, -0.02, 0.33, 'poly'],
    ['B', 0.025, 0.03, 0.03, 0, 0.068, 0.11, 'black'],
    ...hands([0.02, -0.05, -0.24], [0, -0.12, 0.15])] },
  ak47: { anchors: { top: [0, 0.055, -0.12], muz: [0, 0.002, -0.575], under: [0, -0.034, -0.24], fg: [0, -0.034, -0.31], side: [0.028, 0, -0.24], drum: [0, -0.115, -0.06, 0.075], k: 1 }, muzzle: -0.58, parts: [
    ['B', 0.05, 0.07, 0.3, 0, 0, 0.0, 'gun'], ['B', 0.056, 0.06, 0.18, 0, -0.004, -0.24, 'wood'], ['C', 0.013, 0.2, 0, 0.036, -0.24, 'gun'],
    ['B', 0.05, 0.022, 0.12, 0, 0.044, -0.13, 'wood'], ['C', 0.01, 0.22, 0, 0.002, -0.44, 'black'], ['B', 0.012, 0.05, 0.015, 0, 0.032, -0.53, 'black'],
    ['C', 0.012, 0.03, 0, 0.002, -0.56, 'black'], ['B', 0.04, 0.03, 0.05, 0, 0.045, 0.02, 'gun'],
    ...curvedMag(-0.04, 'lwood', 1.05), ['B', 0.036, 0.1, 0.045, 0, -0.08, 0.1, 'wood', -0.35], ['B', 0.045, 0.075, 0.26, 0, -0.035, 0.28, 'wood', 0.09],
    ...hands([0.02, -0.05, -0.23], [0, -0.12, 0.15])] },
  famas: { anchors: { top: [0, 0.105, -0.02], muz: [0, 0, -0.42], under: [0, -0.055, -0.14], fg: [0, -0.055, -0.15], side: [0.031, -0.01, -0.08], drum: [0, -0.125, 0.2, 0.07], k: 1 }, muzzle: -0.42, parts: [ // bullpup avec poignée de transport ("clairon")
    ['B', 0.06, 0.09, 0.52, 0, -0.01, 0.06, 'poly'], ['B', 0.022, 0.06, 0.44, 0, 0.075, -0.02, 'poly'], ['B', 0.022, 0.04, 0.04, 0, 0.04, -0.22, 'poly'],
    ['B', 0.022, 0.04, 0.04, 0, 0.04, 0.18, 'poly'], ['C', 0.011, 0.16, 0, 0.0, -0.32, 'black'], ['C', 0.016, 0.04, 0, 0.0, -0.4, 'black', 6],
    ['B', 0.034, 0.11, 0.06, 0, -0.1, 0.2, 'parker', 0, 0, 0, 'mag'], ['B', 0.036, 0.1, 0.046, 0, -0.085, -0.06, 'poly', -0.3], ['B', 0.06, 0.03, 0.18, 0, -0.06, 0.0, 'poly'],
    ...hands([0.02, -0.1, -0.06], [0, -0.13, -0.02])] },
  scar: { anchors: { top: [0, 0.05, -0.02], muz: [0, 0, -0.595], under: [0, -0.03, -0.27], fg: [0, -0.03, -0.35], side: [0.029, 0, -0.27], drum: [0, -0.12, -0.06, 0.075], k: 1 }, muzzle: -0.62, parts: [
    ['B', 0.054, 0.075, 0.34, 0, 0, -0.02, 'tan'], ['B', 0.058, 0.06, 0.2, 0, 0.0, -0.27, 'tan'], ['B', 0.026, 0.012, 0.56, 0, 0.044, -0.12, 'black'],
    ['C', 0.012, 0.16, 0, 0.0, -0.44, 'black'], ['C', 0.018, 0.07, 0, 0.0, -0.56, 'black', 6], ['B', 0.034, 0.12, 0.062, 0, -0.1, -0.05, 'black'],
    grip(0.1, 'black'), ['B', 0.045, 0.08, 0.2, 0, -0.015, 0.27, 'tan'], ['B', 0.05, 0.1, 0.03, 0, -0.03, 0.38, 'poly'], ['B', 0.02, 0.03, 0.04, 0, 0.064, 0.1, 'black'],
    ...hands([0.02, -0.05, -0.25], [0, -0.12, 0.15])] },
  // ------------------------------------------------ pistolets-mitrailleurs
  smg: { anchors: { top: [0, 0.026, -0.03], muz: [0, 0, -0.29], under: [0, -0.055, -0.14], fg: [0, -0.055, -0.15], side: [0.026, 0, -0.05], drum: [0, -0.11, -0.06, 0.07], k: 0.9 }, muzzle: -0.34, parts: [ // MP40
    ['C', 0.026, 0.3, 0, 0.0, 0.0, 'black', 12], ['C', 0.012, 0.14, 0, 0.0, -0.22, 'black'], ['B', 0.014, 0.03, 0.06, 0, -0.028, -0.3, 'black'],
    ['B', 0.03, 0.2, 0.042, 0, -0.13, -0.06, 'black', 0, 0, 0, 'mag'], ['B', 0.036, 0.1, 0.046, 0, -0.08, 0.1, 'bakelite', -0.25], ['B', 0.04, 0.05, 0.12, 0, -0.03, -0.1, 'bakelite'],
    ['Y', 0.008, 0.2, 0.02, -0.04, 0.24, 'black', 0, 1.3], ['Y', 0.008, 0.2, -0.02, -0.04, 0.24, 'black', 0, 1.3], ['B', 0.05, 0.06, 0.012, 0, -0.07, 0.33, 'black'],
    ...hands([0.01, -0.1, -0.06], [0, -0.11, 0.13])] },
  mp5: { anchors: { top: [0, 0.046, -0.1], muz: [0, 0, -0.35], under: [0, -0.035, -0.2], fg: [0, -0.035, -0.26], side: [0.027, 0, -0.2], drum: [0, -0.11, -0.065, 0.07], k: 0.95 }, muzzle: -0.36, parts: [
    ['B', 0.046, 0.07, 0.3, 0, 0, 0.0, 'black'], ['B', 0.054, 0.062, 0.13, 0, -0.004, -0.2, 'poly'], ['C', 0.011, 0.08, 0, 0.0, -0.31, 'black'],
    ['C', 0.02, 0.025, 0, 0.055, 0.12, 'black'], ['B', 0.01, 0.04, 0.012, 0, 0.04, -0.27, 'black'], ['C', 0.012, 0.18, 0, 0.034, -0.12, 'black'],
    ...curvedMag(-0.05, 'black', 0.95), grip(0.1), ['B', 0.042, 0.08, 0.2, 0, -0.02, 0.27, 'poly'],
    ...hands([0.02, -0.05, -0.2], [0, -0.12, 0.15])] },
  p90: { anchors: { top: [0, 0.07, 0.06], muz: [0, 0, -0.245], under: [0, -0.1, -0.08], fg: [0, -0.1, -0.12], side: [0.031, 0, 0.0], drum: [0, -0.15, 0.1, 0.06], k: 0.95 }, muzzle: -0.27, parts: [
    ['B', 0.06, 0.1, 0.44, 0, -0.01, 0.04, 'poly'], ['B', 0.048, 0.03, 0.32, 0, 0.055, 0.04, 'smoke'], ['B', 0.03, 0.02, 0.28, 0, 0.055, 0.04, 'brass'],
    ['C', 0.011, 0.07, 0, 0.0, -0.21, 'black'], ['B', 0.062, 0.04, 0.12, 0, -0.08, -0.08, 'poly'], ['B', 0.062, 0.06, 0.06, 0, -0.08, 0.05, 'poly'],
    ['B', 0.02, 0.025, 0.06, 0, 0.08, -0.12, 'black'],
    ...hands([0.02, -0.1, -0.09], [0, -0.12, 0.04])] },
  // ------------------------------------------------ mitrailleuses
  lmg: { anchors: { top: [0, 0.036, -0.02], muz: [0, 0, -0.745], under: [0, -0.036, -0.25], fg: [0, -0.036, -0.34], side: [0.029, 0, -0.25], drum: [0, -0.17, -0.02, 0.085], k: 1 }, muzzle: -0.74, parts: [ // RPK
    ['B', 0.052, 0.072, 0.32, 0, 0, 0.0, 'gun'], ['B', 0.058, 0.062, 0.2, 0, -0.005, -0.25, 'lwood'], ['C', 0.013, 0.42, 0, 0.0, -0.52, 'black'],
    ['C', 0.012, 0.18, 0, 0.036, -0.24, 'gun'], ['B', 0.012, 0.05, 0.015, 0, 0.03, -0.7, 'black'], ['C', 0.075, 0.06, 0, -0.1, -0.02, 'gun', 16, 0.075, 'mag'],
    ['B', 0.038, 0.1, 0.046, 0, -0.08, 0.1, 'lwood', -0.35], ['B', 0.046, 0.085, 0.28, 0, -0.035, 0.29, 'lwood', 0.12], ...bipod(-0.6),
    ...hands([0.02, -0.05, -0.25], [0, -0.12, 0.15])] },
  m249: { anchors: { top: [0, 0.045, 0.06], muz: [0, 0.004, -0.665], under: [0, -0.045, -0.26], fg: [0, -0.045, -0.34], side: [0.036, 0, -0.05], belt: [-0.075, -0.08, -0.02], k: 1 }, muzzle: -0.68, parts: [
    ['B', 0.07, 0.09, 0.32, 0, 0, 0.0, 'black'], ['B', 0.052, 0.05, 0.2, 0, 0.006, -0.26, 'parker'], ['C', 0.014, 0.3, 0, 0.004, -0.48, 'black'],
    ['C', 0.018, 0.05, 0, 0.004, -0.64, 'black', 6], ['B', 0.022, 0.045, 0.14, 0, 0.075, -0.16, 'black'], ['B', 0.022, 0.02, 0.06, 0, 0.05, -0.2, 'black'],
    ['B', 0.09, 0.12, 0.11, -0.03, -0.11, -0.02, 'od'], ['B', 0.03, 0.02, 0.08, 0.045, -0.02, -0.04, 'brass'], grip(0.1), ['B', 0.05, 0.09, 0.26, 0, -0.025, 0.29, 'poly'],
    ...bipod(-0.5),
    ...hands([0.02, -0.04, -0.26], [0, -0.12, 0.15])] },
  mg42: { anchors: { top: [0, 0.0425, 0.06], muz: [0, 0.012, -0.6], under: [0, -0.018, -0.3], fg: [0, -0.018, -0.22], side: [0.03, 0, 0.04], belt: [-0.05, -0.17, 0.02], k: 1 }, muzzle: -0.6, parts: [
    ['C', 0.03, 0.36, 0, 0.012, -0.32, 'black', 12], ...[0, 1, 2, 3, 4, 5].map((i) => ['C', 0.032, 0.012, 0, 0.012, -0.18 - i * 0.055, 'parker', 12]),
    ['C', 0.016, 0.06, 0, 0.012, -0.53, 'black'], ['C', 0.024, 0.04, 0, 0.012, -0.58, 'black', 8], ['B', 0.06, 0.085, 0.3, 0, 0.0, 0.04, 'black'],
    ...[0, 1, 2, 3, 4].map((i) => ['B', 0.012, 0.05, 0.016, -0.045, -0.04 - i * 0.03, 0.0 + i * 0.012, 'brass', 0, 0, 0.2]),
    ['B', 0.038, 0.1, 0.046, 0, -0.08, 0.12, 'wood', -0.3], ['B', 0.05, 0.09, 0.26, 0, -0.03, 0.33, 'wood', 0.08], ...bipod(-0.36),
    ...hands([0.02, -0.04, -0.12], [0, -0.12, 0.16])] },
  pkm: { anchors: { top: [0, 0.04, 0], muz: [0, 0.004, -0.69], under: [0, -0.03, -0.3], fg: [0, -0.03, -0.39], side: [0.03, 0, 0], belt: [-0.06, -0.1, -0.03], k: 1 }, muzzle: -0.74, parts: [
    ['B', 0.06, 0.08, 0.32, 0, 0, 0.0, 'gun'], ['C', 0.014, 0.44, 0, 0.004, -0.4, 'black'], ['C', 0.02, 0.06, 0, 0.004, -0.66, 'black', 6],
    ['C', 0.01, 0.3, 0, -0.024, -0.3, 'gun'], ['B', 0.08, 0.11, 0.12, -0.02, -0.11, -0.03, 'od'], ['B', 0.04, 0.012, 0.25, 0, -0.01, 0.27, 'wood'],
    ['B', 0.04, 0.012, 0.25, 0, -0.08, 0.27, 'wood'], ['B', 0.045, 0.1, 0.03, 0, -0.045, 0.4, 'wood'], ['B', 0.038, 0.1, 0.046, 0, -0.08, 0.11, 'wood', -0.3],
    ...bipod(-0.56),
    ...hands([0.02, -0.04, -0.2], [0, -0.12, 0.15])] },
  // ------------------------------------------------ fusils de précision
  sniper: { anchors: { sf: [0, 0.085, -0.235], muz: [0, 0.012, -0.78], mag: [0, -0.15, -0.06], magW: 0.036, magD: 0.064, shells: [0.03, -0.03, 0.2], k: 1, acc: { suppressor: { len: 0.22, r: 0.026 } } }, muzzle: -0.78, parts: [ // L96A1
    ['B', 0.056, 0.085, 0.7, 0, -0.035, 0.02, 'od'], ['B', 0.056, 0.05, 0.12, 0, -0.1, 0.25, 'od'], ['B', 0.03, 0.06, 0.12, 0, -0.07, 0.12, 'od'],
    ['C', 0.013, 0.42, 0, 0.012, -0.55, 'black'], ['C', 0.018, 0.04, 0, 0.012, -0.76, 'black', 6], ...scope(0.085, -0.02, 0.32),
    ['Y', 0.008, 0.06, 0.04, 0.02, 0.1, 'black', 1.2], ['B', 0.032, 0.1, 0.06, 0, -0.1, -0.06, 'black'],
    ...hands([0.02, -0.06, -0.22], [0, -0.12, 0.14])] },
  svd: { anchors: { sf: [0, 0.075, -0.185], muz: [0, 0.004, -0.805], mag: [0, -0.168, -0.05], magRx: 0.3, shells: [0.028, -0.03, 0.26], k: 1, acc: { suppressor: { len: 0.22, r: 0.025 } } }, muzzle: -0.82, parts: [
    ['B', 0.048, 0.065, 0.28, 0, 0.0, 0.0, 'gun'], ['B', 0.054, 0.06, 0.22, 0, -0.004, -0.25, 'lwood'], ['C', 0.012, 0.36, 0, 0.004, -0.56, 'black'],
    ['C', 0.016, 0.07, 0, 0.004, -0.77, 'black', 8], ['B', 0.045, 0.012, 0.26, 0, -0.005, 0.28, 'lwood', 0.06], ['B', 0.045, 0.012, 0.24, 0, -0.09, 0.27, 'lwood', -0.1],
    ['B', 0.045, 0.11, 0.03, 0, -0.05, 0.4, 'lwood'], ...scope(0.075, -0.0, 0.26, 0.019, 0.026), ...curvedMag(-0.02, 'gun', 0.7),
    ['B', 0.036, 0.1, 0.046, 0, -0.08, 0.1, 'lwood', -0.3],
    ...hands([0.02, -0.05, -0.24], [0, -0.12, 0.15])] },
  barrett: { anchors: { sf: [0, 0.12, -0.285], muz: [0, 0.01, -0.82], mag: [0, -0.165, 0], magW: 0.054, magD: 0.094, shells: [0.036, -0.02, 0.22], k: 1, acc: { suppressor: { len: 0.26, r: 0.034 }, muzzleBrake: { len: 0.06 } } }, muzzle: -0.86, parts: [
    ['B', 0.07, 0.11, 0.5, 0, 0.0, 0.0, 'parker'], ['B', 0.074, 0.04, 0.5, 0, 0.065, -0.02, 'black'], ['C', 0.02, 0.44, 0, 0.01, -0.5, 'black'],
    ['B', 0.065, 0.045, 0.1, 0, 0.01, -0.77, 'black'], ['B', 0.07, 0.012, 0.06, 0, 0.01, -0.77, 'parker'], ...scope(0.12, -0.05, 0.36, 0.025, 0.036),
    ['B', 0.05, 0.11, 0.09, 0, -0.11, 0.0, 'black'], grip(0.15, 'poly', -0.1), ['B', 0.05, 0.11, 0.2, 0, -0.03, 0.34, 'parker'], ['B', 0.05, 0.12, 0.03, 0, -0.04, 0.45, 'poly'],
    ...bipod(-0.36),
    ...hands([0.02, -0.06, -0.2], [0, -0.14, 0.2])] },
  // ------------------------------------------------ fusil à pompe
  shotgun: { anchors: { muz: [0, 0.018, -0.61], tubeEnd: [0, -0.018, -0.5], tubeR: 0.014, lamp: [0, -0.052, -0.4], shells: [0.03, -0.01, 0.26], k: 1 }, muzzle: -0.66, parts: [ // Remington 870
    ['B', 0.055, 0.075, 0.26, 0, 0.0, 0.02, 'black'], ['C', 0.016, 0.5, 0, 0.018, -0.36, 'black'], ['C', 0.014, 0.4, 0, -0.018, -0.3, 'black'],
    ['B', 0.06, 0.06, 0.16, 0, -0.012, -0.27, 'wood'], ...[0, 1, 2, 3, 4].map((i) => ['B', 0.062, 0.004, 0.012, 0, -0.012 + 0.0, -0.33 + i * 0.03, 'bakelite']),
    ['B', 0.008, 0.012, 0.008, 0, 0.037, -0.6, 'silver'], ['B', 0.038, 0.1, 0.05, 0, -0.07, 0.15, 'wood', -0.45], ['B', 0.05, 0.1, 0.28, 0, -0.04, 0.33, 'wood', 0.1],
    ['B', 0.008, 0.03, 0.05, 0, -0.05, 0.08, 'black'],
    ...hands([0.02, -0.04, -0.27], [0, -0.12, 0.16])] },
  // ------------------------------------------------ armes de la zone de l'Homme de Fer
  saiga: { anchors: { muz: [0, 0.012, -0.6], drum: [0, -0.12, -0.06, 0.085], lamp: [0, -0.052, -0.3], shells: [0.03, -0.02, 0.26], k: 1 }, muzzle: -0.6, parts: [ // Saiga-12 : boîte de culasse type AK en polymère noir, chargeur droit large, crosse squelette
    ['B', 0.05, 0.07, 0.3, 0, 0, 0.0, 'black'], ['B', 0.044, 0.016, 0.28, 0, 0.042, -0.01, 'gun'], ['B', 0.054, 0.058, 0.18, 0, -0.006, -0.25, 'poly'], ['B', 0.046, 0.018, 0.12, 0, 0.04, -0.24, 'poly'],
    ['C', 0.017, 0.3, 0, 0.012, -0.4, 'black'], ['C', 0.012, 0.22, 0, 0.04, -0.34, 'gun'], ['C', 0.022, 0.05, 0, 0.012, -0.575, 'black', 8], ['B', 0.01, 0.04, 0.012, 0, 0.045, -0.54, 'black'],
    ['B', 0.016, 0.03, 0.04, 0, 0.056, 0.1, 'black'], ['B', 0.048, 0.12, 0.075, 0, -0.1, -0.05, 'gun', 0.1, 0, 0, 'mag'], ['B', 0.048, 0.1, 0.075, 0, -0.2, -0.07, 'gun', 0.2, 0, 0, 'mag'],
    ['B', 0.036, 0.1, 0.046, 0, -0.08, 0.1, 'poly', -0.35], ['B', 0.008, 0.03, 0.05, 0, -0.05, 0.03, 'black'],
    ['B', 0.02, 0.02, 0.26, 0, 0.0, 0.27, 'black', 0.05], ['B', 0.02, 0.02, 0.24, 0, -0.07, 0.28, 'black', -0.15], ['B', 0.02, 0.075, 0.02, 0, -0.035, 0.17, 'black'], ['B', 0.02, 0.075, 0.02, 0, -0.04, 0.37, 'black'],
    ['B', 0.05, 0.09, 0.022, 0, -0.04, 0.41, 'poly'],
    ...hands([0.02, -0.05, -0.25], [0, -0.12, 0.15])] },
  crossbow: { anchors: { top: [0, 0.047, -0.06], tip: [0, 0.052, -0.34], side: [0.03, -0.02, 0.12], k: 1 }, muzzle: -0.3, parts: [ // arbalète à poulies : fût polymère de 0,6 m, rail, branches en flèche, deux cordes, carreau, point rouge
    ['B', 0.05, 0.06, 0.6, 0, -0.02, 0.0, 'poly'], ['B', 0.046, 0.09, 0.12, 0, -0.03, 0.36, 'poly', 0.1], ['B', 0.028, 0.014, 0.42, 0, 0.04, -0.06, 'black'],
    ['B', 0.034, 0.05, 0.05, 0, 0.0, -0.3, 'black'],
    ['B', 0.34, 0.016, 0.032, 0.17, 0.005, -0.33, 'black', 0, -0.25], ['B', 0.34, 0.016, 0.032, -0.17, 0.005, -0.33, 'black', 0, 0.25], // branches balayées vers l'arrière
    ['Y', 0.017, 0.03, 0.335, 0.005, -0.285, 'gun'], ['Y', 0.017, 0.03, -0.335, 0.005, -0.285, 'gun'], // poulies
    ['B', 0.004, 0.004, 0.43, 0.165, 0.005, -0.13, 'black', 0, -0.83], ['B', 0.004, 0.004, 0.43, -0.165, 0.005, -0.13, 'black', 0, 0.83], // cordes
    ['C', 0.007, 0.34, 0, 0.052, -0.14, 'black', 8, 0.007, 'bolt'], ['C', 0.0025, 0.03, 0, 0.052, -0.325, 'silver', 6, 0.0025, 'bolt'], // carreau carbone et sa pointe
    ['B', 0.002, 0.03, 0.045, 0, 0.052, 0.02, 'red', 0, 0, 0, 'bolt'], ['B', 0.03, 0.002, 0.045, 0, 0.052, 0.02, 'red', 0, 0, 0, 'bolt'], // empennage
    ['B', 0.032, 0.03, 0.06, 0, 0.07, -0.01, 'black', 0, 0, 0, 'optic'], ['B', 0.024, 0.02, 0.004, 0, 0.07, -0.042, 'red', 0, 0, 0, 'optic'], // point rouge
    ['B', 0.036, 0.1, 0.046, 0, -0.08, 0.17, 'poly', -0.3], ['B', 0.008, 0.03, 0.05, 0, -0.06, 0.11, 'black'],
    ...hands([0.0, -0.07, -0.1], [0, -0.12, 0.18])] },
  m79: { anchors: { muz: [0, 0.02, -0.51], k: 1 }, muzzle: -0.5, parts: [ // M79 : un canon, boîte de culasse en acier, hausse relevée, garde-main et crosse en bois
    ['C', 0.034, 0.36, 0, 0.02, -0.32, 'black', 14], ['C', 0.037, 0.02, 0, 0.02, -0.5, 'gun', 14], ['B', 0.01, 0.03, 0.01, 0, 0.056, -0.47, 'black'],
    ['B', 0.054, 0.07, 0.17, 0, 0.0, -0.06, 'gun'], ['B', 0.014, 0.014, 0.08, 0, 0.04, -0.01, 'black'], ['Y', 0.014, 0.07, 0, 0.0, -0.14, 'gun', 1.5708],
    ['B', 0.03, 0.012, 0.04, 0, 0.046, -0.07, 'black'], ['B', 0.014, 0.06, 0.008, 0, 0.078, -0.07, 'black'], ['B', 0.004, 0.02, 0.006, 0, 0.1, -0.07, 'silver'], // hausse relevée
    ['B', 0.052, 0.05, 0.16, 0, -0.012, -0.24, 'wood'], ['B', 0.052, 0.012, 0.16, 0, -0.04, -0.24, 'bakelite'],
    ['B', 0.036, 0.1, 0.046, 0, -0.08, 0.06, 'wood', -0.35], ['B', 0.008, 0.03, 0.05, 0, -0.05, 0.0, 'black'],
    ['B', 0.046, 0.085, 0.27, 0, -0.03, 0.17, 'wood', 0.09, 0, 0, 'stock'], ['B', 0.05, 0.1, 0.02, 0, -0.04, 0.315, 'poly', 0, 0, 0, 'stock'], // crosse et plaque de couche
    ...hands([0.02, -0.04, -0.24], [0, -0.12, 0.09])] },
  // ------------------------------------------------ pistolet à rayons : corps rouge, ailettes, bulbe vert lumineux
  raygun: { anchors: { muz: [0, 0, -0.235], top: [0, 0.04, -0.05], k: 1 }, muzzle: -0.22, parts: [
    ['B', 0.07, 0.08, 0.22, 0, 0, -0.05, 'red'], ...[0, 1, 2].map((i) => ['B', 0.12, 0.012, 0.03, 0, 0, -0.08 - i * 0.05, 'parker']), ['S', 0.035, 0, 0, -0.2, 'glow'],
    ['B', 0.035, 0.11, 0.05, 0, -0.08, 0.05, 'black', -0.25],
    ...hands([0, -0.09, 0.05], [0, -0.11, 0.09])] },
};

// =====================================================================
//  Accessoires du Pack-a-Punch. Chaque arme a des points d'ancrage (DEFS[id].anchors : sommet du rail, bouche, dessous du garde-main,
//  bas du chargeur, tambour…) et chaque niveau une liste d'accessoires (LOADOUT, cumulative sauf remplacement). ACC est la bibliothèque,
//  partagée par toutes les armes : chaque fonction renvoie des pièces (même format que DEFS) placées d'après les ancres.
//  Les accessoires d'un niveau sont construits UNE fois par arme (première amélioration), puis clonés (géométries partagées).
// =====================================================================
const B = (w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) => ['B', w, h, d, x, y, z, mat, rx, ry, rz];
const CZ = (r, len, x, y, z, mat, seg = 12, r2 = r) => ['C', r, len, x, y, z, mat, seg, r2];              // cylindre le long de z (r2 : rayon côté bouche)
const CX = (r, len, x, y, z, mat, seg = 16) => ['Y', r, len, x, y, z, mat, Math.PI / 2, 0, seg];            // cylindre le long de x (tambour)
const SP = (r, x, y, z, mat) => ['S', r, x, y, z, mat];

const ACC = {
  // ---- viseurs
  redDot: (a) => { // point rouge : socle, boîtier, fenêtre, point lumineux
    const [, y, z] = a.top, k = a.k;
    return [B(0.028 * k, 0.006, 0.07 * k, 0, y + 0.003, z, 'black'), B(0.026 * k, 0.022, 0.045 * k, 0, y + 0.017, z, 'black'), B(0.026 * k, 0.005, 0.024 * k, 0, y + 0.0295, z - 0.03 * k, 'black'),
      B(0.017 * k, 0.015, 0.002, 0, y + 0.019, z - 0.0235 * k, 'lens'), SP(0.0028 * k, 0, y + 0.019, z + 0.0225 * k, 'dot')];
  },
  holo: (a) => { // viseur holographique : cadre ouvert, vitre, réticule
    const [, y, z] = a.top, k = a.k;
    return [B(0.034 * k, 0.008, 0.09 * k, 0, y + 0.004, z, 'black'), B(0.006, 0.034, 0.07 * k, 0.0155 * k, y + 0.025, z, 'black'), B(0.006, 0.034, 0.07 * k, -0.0155 * k, y + 0.025, z, 'black'),
      B(0.037 * k, 0.008, 0.09 * k, 0, y + 0.046, z, 'black'), B(0.025 * k, 0.03, 0.003, 0, y + 0.026, z - 0.034 * k, 'lens'), SP(0.0028 * k, 0, y + 0.026, z + 0.03 * k, 'dot')];
  },
  // ---- bouche
  compensator: (a) => { // compensateur : bloc fendu
    const [, y, z] = a.muz;
    return [B(0.026, 0.026, 0.045, 0, y, z - 0.012, 'gun'), ...[0, 1, 2].map((i) => B(0.028, 0.004, 0.006, 0, y + 0.0135, z - 0.004 - i * 0.012, 'black'))];
  },
  suppressor: (a, c) => { // silencieux : tube noir, bague et embout (dorés au niveau III)
    const [, y, z] = a.muz, len = c.len ?? 0.17, r = (c.r ?? 0.021) * (a.k > 0.9 ? 1 : 0.95);
    return [CZ(r, len, 0, y, z - len / 2 + 0.01, 'black', 14), CZ(r * 1.07, 0.012, 0, y, z - 0.012, 'gold', 14), CZ(r * 1.07, 0.012, 0, y, z - len + 0.005, 'gold', 14)];
  },
  goldBarrel: (a) => { // canon doré : manchon à la bouche et filets d'or sur le dessus
    const [, y, z] = a.muz, k = a.k;
    return [CZ(0.0115 * (k > 0.9 ? 1.25 : 1), 0.06, 0, y, z + 0.02, 'gold', 12), B(0.006, 0.003, 0.18, 0, a.top[1] + 0.001, a.top[2] - 0.04, 'gold')];
  },
  // ---- dessous et flancs
  foregrip: (a) => { // poignée verticale
    const [, y, z] = a.fg;
    return [B(0.036, 0.012, 0.05, 0, y - 0.006, z, 'black'), B(0.028, 0.075, 0.034, 0, y - 0.047, z, 'poly'), B(0.03, 0.01, 0.036, 0, y - 0.088, z, 'black')];
  },
  laser: (a, c) => { // module laser : boîtier sous le canon ; le faisceau n'existe que pour le joueur local
    const [, y, z] = c.at || a.under, k = a.k, zf = z - 0.045 * k;
    const parts = [B(0.026 * k, 0.024 * k, 0.055 * k, 0, y - 0.012 * k, z - 0.02 * k, 'black'), B(0.016 * k, 0.016 * k, 0.004, 0, y - 0.012 * k, zf - 0.012 * k, 'dot')];
    if (c.local) parts.push(B(0.0025, 0.0025, 40, 0, y - 0.012 * k, zf - 20.012, 'beam'));
    return parts;
  },
  extMag: (a) => { // chargeur allongé : prolongement dans l'axe du chargeur
    const [, y, z] = a.mag, t = a.magRx, dy = -Math.cos(t), dz = -Math.sin(t), w = a.magW ?? 0.036, d = a.magD ?? 0.052;
    return [B(w, 0.065, d, 0, y + dy * 0.0325, z + dz * 0.0325, 'gun', t), B(w + 0.006, 0.01, d + 0.008, 0, y + dy * 0.07, z + dz * 0.07, 'black', t)];
  },
  drum: (a) => { // tambour à la place du chargeur : disque, moyeu, nervures
    const [, y, z, r] = a.drum;
    return [CX(r, 0.075, 0, y, z, 'gun', 18), CX(r * 0.6, 0.086, 0, y, z, 'black', 12), CX(r * 0.85, 0.082, 0, y, z, 'parker', 18),
      B(0.034, 0.03, 0.05, 0, y + r - 0.012, z, 'black')];
  },
  // ================= v0.35 : mitrailleuses, précision, pompes, spéciales, lance-grenades sous canon, Éther =================
  acog: (a) => { // lunette ACOG : tube, objectif évasé, oculaire, fibre lumineuse
    const [, y, z] = a.top, k = a.k;
    return [B(0.03, 0.02, 0.07, 0, y + 0.01, z, 'black'), CZ(0.019, 0.12, 0, y + 0.03, z, 'black', 14), CZ(0.019, 0.035, 0, y + 0.03, z - 0.0775, 'black', 14, 0.027 * k), CZ(0.022, 0.03, 0, y + 0.03, z + 0.075, 'black', 14),
      CZ(0.024, 0.004, 0, y + 0.03, z - 0.097, 'lens', 14), B(0.005, 0.004, 0.06, 0, y + 0.052, z, 'orange')];
  },
  thermal: (a) => { // lunette thermique additionnelle, devant la lunette du fusil de précision
    const [, y, z] = a.sf;
    return [B(0.062, 0.062, 0.13, 0, y, z - 0.075, 'gun'), B(0.03, 0.012, 0.2, 0, y - 0.04, z - 0.05, 'black'), CZ(0.023, 0.01, 0, y, z - 0.143, 'cyan', 14), B(0.014, 0.022, 0.02, 0.037, y + 0.01, z - 0.05, 'black'),
      B(0.05, 0.008, 0.1, 0, y + 0.035, z - 0.075, 'black')];
  },
  muzzleBrake: (a, c) => { // frein de bouche : bloc à évents
    const [, y, z] = a.muz, len = c.len ?? 0.07;
    return [B(0.034, 0.034, len, 0, y, z - len / 2 + 0.01, 'gun'), ...[0, 1, 2].flatMap((i) => [B(0.038, 0.005, 0.01, 0, y + 0.0175, z - 0.012 - i * (len / 4), 'black'), B(0.005, 0.022, 0.01, 0.0175, y, z - 0.012 - i * (len / 4), 'black'), B(0.005, 0.022, 0.01, -0.0175, y, z - 0.012 - i * (len / 4), 'black')])];
  },
  heavyBarrel: (a) => { // canon lourd : manchon épais à ailettes et bague dorée
    const [, y, z] = a.muz;
    return [CZ(0.024, 0.26, 0, y, z + 0.16, 'gun', 14), ...[0, 1, 2, 3, 4].map((i) => CZ(0.03, 0.01, 0, y, z + 0.05 + i * 0.045, 'black', 14)), CZ(0.028, 0.014, 0, y, z + 0.035, 'gold', 14)];
  },
  belt: (a) => { // bande de cartouches qui pend du boîtier
    const [bx, by, bz] = a.belt;
    return [0, 1, 2, 3, 4, 5, 6].map((i) => { const t = i / 6; return B(0.02, 0.036, 0.03, bx - 0.012 - 0.04 * Math.sin(t * Math.PI), by - 0.12 * t, bz, 'gold', 0, 0, -0.5 * Math.cos(t * Math.PI)); });
  },
  choke: (a) => { // choke : bague de bouche resserrée
    const [, y, z] = a.muz;
    return [CZ(0.021, 0.045, 0, y, z + 0.0, 'black', 12), CZ(0.0235, 0.008, 0, y, z - 0.015, 'gun', 12)];
  },
  tubeExt: (a) => { // tube-magasin allongé
    const [, y, z] = a.tubeEnd, r = a.tubeR;
    return [CZ(r, 0.1, 0, y, z - 0.045, 'black', 10), CZ(r * 1.25, 0.012, 0, y, z - 0.098, 'gun', 10)];
  },
  flashlight: (a) => { // lampe sous le canon (le faisceau n'existe pas : aucune lumière en plus)
    const [, y, z] = a.lamp;
    return [B(0.024, 0.012, 0.05, 0, y + 0.014, z, 'black'), CZ(0.018, 0.1, 0, y, z, 'black', 12), CZ(0.016, 0.004, 0, y, z - 0.052, 'cyan', 12)];
  },
  dragon: (a) => { // souffle du dragon : bouche évasée à l'incandescence orange
    const [, y, z] = a.muz;
    return [CZ(0.02, 0.07, 0, y, z - 0.02, 'black', 12, 0.034), CZ(0.031, 0.006, 0, y, z - 0.056, 'orange', 14), CZ(0.024, 0.002, 0, y, z - 0.0595, 'orange', 14)];
  },
  shells: (a) => { // cartouches orange rangées sur le flanc de la crosse
    const [x, y, z] = a.shells;
    return [B(0.01, 0.014, 0.1, x, y - 0.024, z + 0.033, 'poly'), ...[0, 1, 2, 3].map((i) => ['Y', 0.0085, 0.044, x + 0.005, y, z + i * 0.022, 'orange', 0, 0, 8])];
  },
  explosiveRounds: (a) => { // balles explosives : cartouches à pointe orange sur le flanc de la crosse
    const [x, y, z] = a.shells;
    return [B(0.01, 0.014, 0.1, x, y - 0.024, z + 0.033, 'poly'), ...[0, 1, 2, 3].flatMap((i) => [['Y', 0.0075, 0.04, x + 0.005, y, z + i * 0.022, 'gold', 0, 0, 8], SP(0.0078, x + 0.005, y + 0.022, z + i * 0.022, 'orange')])];
  },
  warhead: (a) => { // carreau explosif : ogive rouge à bague orange (se cache avec le carreau quand l'arme est vide)
    const [, y, z] = a.tip;
    return [[...CZ(0.015, 0.05, 0, y, z + 0.035, 'red', 10, 0.007), 'bolt'], [...CZ(0.0158, 0.008, 0, y, z + 0.05, 'orange', 10), 'bolt']];
  },
  fragWarhead: (a) => { // carreau à fragmentation : tête sphérique cloutée
    const [, y, z] = a.tip;
    return [[...SP(0.02, 0, y, z + 0.04, 'gold'), 'bolt'], ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sy]) => [...B(0.012, 0.012, 0.012, sx * 0.02, y + sy * 0.02, z + 0.04, 'black', 0.5, 0.5, 0), 'bolt']),
      [...CZ(0.022, 0.008, 0, y, z + 0.06, 'orange', 12), 'bolt']];
  },
  quiver: (a) => { // carquois de trois carreaux sur le flanc
    const [x, y, z] = a.side;
    return [B(0.04, 0.05, 0.16, x + 0.02, y, z, 'poly'), ...[-1, 0, 1].flatMap((i) => [CZ(0.006, 0.12, x + 0.02 + i * 0.012, y + 0.008, z - 0.1, 'black', 8), CZ(0.007, 0.02, x + 0.02 + i * 0.012, y + 0.008, z - 0.165, 'red', 8, 0.003)])];
  },
  shortStock: () => [B(0.044, 0.08, 0.05, 0, -0.03, 0.095, 'wood', 0.15), B(0.05, 0.09, 0.012, 0, -0.035, 0.125, 'poly', 0.15)], // crosse sciée (la crosse d'origine est cachée)
  m79Drum: () => [CZ(0.05, 0.075, 0, 0.008, -0.205, 'gun', 14), ...[0, 1, 2].map((j) => { const t = Math.PI / 2 + j * Math.PI * 2 / 3; return CZ(0.011, 0.004, Math.cos(t) * 0.03, 0.008 + Math.sin(t) * 0.03, -0.2435, 'black', 8); })], // tambour de trois obus
  bigMuzzle: (a) => { // canon renforcé pour l'explosion x4,5 : manchon, bande orange
    const [, y, z] = a.muz;
    return [CZ(0.046, 0.07, 0, y, z + 0.02, 'gun', 14), CZ(0.0475, 0.012, 0, y, z + 0.02, 'orange', 14), CZ(0.05, 0.01, 0, y, z - 0.012, 'black', 14)];
  },
  goldFins: () => [...[0, 1, 2].map((i) => B(0.15, 0.016, 0.036, 0, 0, -0.08 - i * 0.05, 'gold')), B(0.012, 0.045, 0.12, 0, 0.055, -0.11, 'gold')], // ailettes dorées
  twinBulb: () => [SP(0.028, 0, 0.06, -0.15, 'glow'), B(0.012, 0.03, 0.012, 0, 0.045, -0.15, 'gold')],                                           // second bulbe
  coil: () => [B(0.01, 0.01, 0.15, 0.04, 0, -0.3, 'gold'), B(0.01, 0.01, 0.15, -0.04, 0, -0.3, 'gold'), SP(0.014, 0.04, 0, -0.38, 'cyan'), SP(0.014, -0.04, 0, -0.38, 'cyan'), B(0.08, 0.004, 0.004, 0, 0, -0.372, 'cyan')], // Porte-Tonnerre : bobine
  glauncher: (a) => { // lance-grenades sous canon : tube, bague, boîtier, pontet, hausse
    const [, y, z] = a.under;
    return [CZ(0.027, 0.22, 0, y - 0.028, z - 0.02, 'black', 12), CZ(0.03, 0.012, 0, y - 0.028, z - 0.128, 'gun', 12), B(0.05, 0.034, 0.1, 0, y - 0.016, z + 0.06, 'gun'), B(0.006, 0.03, 0.04, 0, y - 0.045, z + 0.1, 'black'), B(0.006, 0.035, 0.012, 0.03, y, z, 'black')];
  },
  etherCell: (a) => { // cellule d'Éther : fiole lumineuse sur le flanc
    const [x, y, z] = a.side;
    return [CZ(0.011, 0.09, x + 0.011, y + 0.012, z, 'ether', 8), B(0.008, 0.026, 0.016, x + 0.004, y + 0.012, z - 0.03, 'black'), B(0.008, 0.026, 0.016, x + 0.004, y + 0.012, z + 0.03, 'black')];
  },
};

// Accessoires par niveau (cumulatifs, sauf remplacement) et par catégorie ; surcharges par arme dans LOADOUT_ID
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

const MATS = new WeakMap();  // groupe de base -> ses matériaux
const CACHE = new WeakMap(); // groupe de base -> { 'niveau[L]': groupe d'accessoires }

// Pose les accessoires du niveau `level` (0 : aucun) sur `target`, un modèle de l'arme `id`. base : le modèle d'origine dont viennent les matériaux et le
// cache (target lui-même pour la vue à la première personne, le modèle du kit pour une copie). opts.local : vue du joueur local (faisceau du laser).
// Sans effet si le niveau n'a pas changé.
export function attachAccessories(target, id, level, base = target, opts = {}) {
  const key = level + (opts.local ? 'L' : '');
  if (target.userData.accKey === key) return;
  target.userData.accKey = key;
  const old = target.getObjectByName('acc');
  if (old) target.remove(old);
  target.traverse((o) => { if (o.userData.mag || o.userData.stock || o.userData.optic) o.visible = true; });
  const list = level > 0 ? loadoutOf(id, level) : null;
  if (!list) return;
  let c = CACHE.get(base);
  if (!c) CACHE.set(base, c = {});
  let proto = c[key];
  if (!proto) {
    const def = DEFS[id], a = { k: 1, magRx: 0, ...def.anchors };
    proto = new THREE.Group();
    proto.name = 'acc';
    const parts = [];
    for (const name of list) parts.push(...ACC[name](a, { level, local: !!opts.local, ...(a.acc?.[name]) }));
    build(proto, MATS.get(base), parts);
    c[key] = proto;
  }
  target.add(proto.clone(true));
  if (list.includes('drum')) target.traverse((o) => { if (o.userData.mag) o.visible = false; });
  if (list.includes('shortStock')) target.traverse((o) => { if (o.userData.stock) o.visible = false; });
  if (list.includes('acog')) target.traverse((o) => { if (o.userData.optic) o.visible = false; });
}

export function buildWeaponModels(parentGroup) {
  const vms = {}, info = {};
  for (const [id, def] of Object.entries(DEFS)) {
    const grp = new THREE.Group();
    const M = mats();
    MATS.set(grp, M);
    build(grp, M, def.parts);
    if (def.offset) grp.position.set(...def.offset);
    grp.visible = false;
    parentGroup.add(grp);
    vms[id] = grp;
    info[id] = { muzzle: def.muzzle + (def.offset ? def.offset[2] : 0), muzzleY: def.offset ? def.offset[1] + 0.005 : 0.015 };
  }
  return { vms, info };
}
