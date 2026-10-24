import * as THREE from 'three';
import { merge } from './props.js';
import { reflective } from './envmap.js';

// Modèles 3D des motos, construits à la main avec des formes simples. Repère local : l'origine est au sol, au milieu de
// l'empattement ; l'avant de la moto est vers -z, la droite vers +x. Chaque constructeur renvoie
//   { group, steer (la fourche : tourne avec le guidon), wheels: [avant, arrière], seats: [{ hip, eye }], tail, lamp }
// hip : le bassin du pilote (là où s'assoit un personnage), eye : ses yeux (la caméra du joueur local).

const std = (color, rough = 0.6, metal = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
let MAT = null;
const mats = () => MAT || (MAT = {
  black: reflective(std(0x181a1d, 0.65, 0.45), 0.8), // reflets d'ambiance (envmap.js)
  steel: reflective(std(0x22262b, 0.62, 0.55), 0.9),
  chrome: reflective(std(0x9da3aa, 0.32, 0.85), 1.3),
  rubber: std(0x121214, 0.92, 0),
  seat: std(0x241a12, 0.82, 0.05),
  lamp: std(0xfff1c9, 0.3, 0, { emissive: 0xffd070, emissiveIntensity: 2.6 }),
  tail: std(0x4a0a0a, 0.4, 0, { emissive: 0xcc1515, emissiveIntensity: 1.8 }),
  screen: std(0x7a8e9e, 0.12, 0.1, { transparent: true, opacity: 0.35 }),
});

// Matériau noir partagé de toutes les épaves (compilé au préchauffage : voir precompileShaders dans main.js)
let WRECK = null;
export const wreckMaterial = () => WRECK || (WRECK = std(0x0d0d0f, 0.95, 0.1));

const SHARED_UP = new THREE.Vector3(0, 1, 0);
function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function ball(parent, sx, sy, sz, mat, x = 0, y = 0, z = 0) { // sphère aplatie : réservoir, phare, cylindres
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// Tube entre deux points (cadre, fourche, échappement)
function tube(parent, a, b, r, mat, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(SHARED_UP, B.clone().sub(A).normalize());
  parent.add(m);
  return m;
}

// Roue : pneu, jante, rayons (on voit qu'elle tourne), moyeu et disque de frein. Axe de rotation : x.
function wheel(R, tireR, width, rimMat) {
  const M = mats(), g = new THREE.Group();
  const tire = new THREE.TorusGeometry(R - tireR, tireR, 10, 28).rotateY(Math.PI / 2);
  tire.scale(width / (tireR * 2), 1, 1);
  g.add(new THREE.Mesh(tire, M.rubber));
  const rimR = R - tireR * 1.7;
  g.add(new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.014, 6, 24).rotateY(Math.PI / 2), rimMat));
  for (let k = 0; k < 6; k++) box(g, 0.022 - k * 0.0006, rimR * 2, 0.026 - k * 0.0006, rimMat, 0, 0, 0, (k * Math.PI) / 6); // épaisseurs différentes : les faces des rayons ne sont jamais coplanaires (z-fighting au croisement)
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width * 0.7, 10).rotateZ(Math.PI / 2), M.steel));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.62, rimR * 0.62, 0.008, 18).rotateZ(Math.PI / 2), M.steel)).position.x = width * 0.32;
  box(g, 0.05, 0.03, 0.03, M.tail, 0, rimR, 0); // une valve rouge : repère visuel de la rotation
  return g;
}

function finish(group) {
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// ---------------------------------------------------------------- MOTO : sportive monoplace, rouge et noire
export function buildMoto() {
  const M = mats(), paint = std(0xb3261e, 0.32, 0.45);
  const root = new THREE.Group();
  const R = 0.31, wb = 1.35;

  const rear = wheel(R, 0.078, 0.17, M.steel); rear.position.set(0, R, wb / 2); root.add(rear);
  for (const sx of [-1, 1]) tube(root, [sx * 0.09, 0.4, 0.1], [sx * 0.1, R, wb / 2], 0.024, M.steel);
  // moteur, cylindre, échappement
  box(root, 0.3, 0.3, 0.44, M.steel, 0, 0.42, 0.04);
  box(root, 0.24, 0.17, 0.22, M.black, 0, 0.6, -0.1, -0.35);
  for (let k = 0; k < 4; k++) box(root, 0.27, 0.012, 0.2, M.steel, 0, 0.55 + k * 0.03, -0.1, -0.35);
  tube(root, [0.15, 0.3, -0.22], [0.18, 0.28, 0.45], 0.036, M.chrome);
  tube(root, [0.18, 0.3, 0.3], [0.2, 0.42, 0.86], 0.055, M.steel);
  // cadre
  for (const sx of [-1, 1]) {
    tube(root, [sx * 0.1, 0.84, -0.36], [sx * 0.1, 0.44, 0.16], 0.024, M.steel);
    tube(root, [sx * 0.09, 0.84, -0.3], [sx * 0.09, 0.3, -0.1], 0.02, M.steel);
    tube(root, [sx * 0.09, 0.62, 0.16], [sx * 0.09, 0.74, 0.62], 0.02, M.steel);
    box(root, 0.04, 0.025, 0.12, M.steel, sx * 0.24, 0.3, 0.12); // repose-pieds
  }
  // réservoir, selle, coque arrière, feu
  ball(root, 0.2, 0.15, 0.34, paint, 0, 0.8, -0.14);
  box(root, 0.21, 0.07, 0.5, M.seat, 0, 0.76, 0.3);
  box(root, 0.18, 0.09, 0.36, paint, 0, 0.82, 0.72, -0.2);
  const tail = box(root, 0.14, 0.05, 0.04, M.tail, 0, 0.84, 0.92);
  box(root, 0.16, 0.02, 0.4, M.black, 0, 0.58, 0.82, 0.18); // garde-boue arrière

  // fourche + guidon + roue avant (tournent ensemble)
  const rake = 0.46, L = 0.62;
  const steerG = new THREE.Group();
  steerG.position.set(0, R + L * Math.cos(rake), -wb / 2 + L * Math.sin(rake));
  steerG.rotation.x = rake;
  root.add(steerG);
  const fork = new THREE.Group(); steerG.add(fork);
  for (const sx of [-1, 1]) {
    tube(fork, [sx * 0.1, 0.04, 0], [sx * 0.1, -L, 0], 0.024, M.chrome);
    tube(fork, [sx * 0.1, 0.0, 0], [sx * 0.1, -0.28, 0], 0.032, M.steel);
  }
  const front = wheel(R, 0.074, 0.14, M.steel); front.position.set(0, -L, 0); fork.add(front);
  box(fork, 0.15, 0.02, 0.42, paint, 0, -L + R + 0.07, -0.02, 0.1); // garde-boue avant
  tube(fork, [-0.34, 0.12, 0.06], [0.34, 0.12, 0.06], 0.016, M.black);
  for (const sx of [-1, 1]) { tube(fork, [sx * 0.34, 0.12, 0.06], [sx * 0.38, 0.12, 0.06], 0.022, M.rubber); tube(fork, [sx * 0.3, 0.12, 0.04], [sx * 0.34, 0.26, -0.06], 0.008, M.black); box(fork, 0.07, 0.05, 0.01, M.chrome, sx * 0.36, 0.3, -0.06); }
  ball(fork, 0.12, 0.12, 0.1, M.black, 0, 0.02, -0.12);
  const lamp = ball(fork, 0.085, 0.085, 0.05, M.lamp, 0, 0.02, -0.2);
  box(fork, 0.2, 0.2, 0.03, paint, 0, 0.2, -0.1, -0.5); // petit carénage

  return {
    group: finish(root), steer: fork, wheels: [front, rear], tail, lamp, wheelRadius: R, length: 2.0,
    seats: [{ hip: [0, 0.78, 0.3], eye: [0, 1.42, 0.2] }],
  };
}

// ---------------------------------------------------------------- GROSSE MOTO : routière chromée à deux places, kaki
export function buildGrosseMoto() {
  const M = mats(), paint = std(0x3b4a2c, 0.5, 0.35), bagMat = std(0x1c1d19, 0.7, 0.2);
  const root = new THREE.Group();
  const R = 0.36, wb = 1.75;

  const rear = wheel(R, 0.1, 0.24, M.chrome); rear.position.set(0, R, wb / 2); root.add(rear);
  for (const sx of [-1, 1]) tube(root, [sx * 0.13, 0.42, 0.12], [sx * 0.14, R, wb / 2], 0.03, M.chrome);
  // moteur bicylindre en V, tuyaux chromés
  box(root, 0.36, 0.34, 0.5, M.steel, 0, 0.44, 0.1);
  for (const [sz, rx] of [[-0.06, -0.62], [0.2, 0.62]]) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.3, 14), M.chrome);
    cyl.position.set(0, 0.68, sz); cyl.rotation.x = rx; root.add(cyl);
    for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.012, 14), M.steel); fin.position.set(0, 0.62 + k * 0.05, sz - Math.sign(rx) * 0.02 * k); fin.rotation.x = rx; root.add(fin); }
  }
  for (const [y, z0, z1] of [[0.3, -0.25, 0.95], [0.4, -0.18, 0.98]]) { tube(root, [0.27, y, z0], [0.3, y, z1], 0.046, M.chrome); tube(root, [0.3, y, z1 - 0.2], [0.3, y, z1 + 0.02], 0.06, M.chrome); }
  // cadre, réservoir en goutte, selle double, dosseret
  for (const sx of [-1, 1]) {
    tube(root, [sx * 0.12, 0.92, -0.42], [sx * 0.12, 0.46, 0.2], 0.03, M.steel);
    tube(root, [sx * 0.11, 0.7, 0.2], [sx * 0.11, 0.78, 0.9], 0.026, M.steel);
    box(root, 0.5, 0.03, 0.2, M.black, sx * 0.3, 0.26, 0.16); // planchers
  }
  ball(root, 0.24, 0.19, 0.4, paint, 0, 0.9, -0.2);
  box(root, 0.34, 0.08, 0.5, M.seat, 0, 0.8, 0.12);
  box(root, 0.3, 0.07, 0.42, M.seat, 0, 0.86, 0.7, -0.06);
  for (const sx of [-1, 1]) tube(root, [sx * 0.15, 0.88, 0.95], [sx * 0.15, 1.22, 1.02], 0.016, M.chrome);
  box(root, 0.34, 0.16, 0.05, M.seat, 0, 1.2, 1.04); // dossier du passager
  // sacoches, garde-boue, feu
  for (const sx of [-1, 1]) box(root, 0.16, 0.28, 0.58, bagMat, sx * 0.31, 0.6, 0.88);
  box(root, 0.26, 0.025, 0.7, paint, 0, 0.7, 0.9, 0.1);
  const tail = box(root, 0.2, 0.06, 0.04, M.tail, 0, 0.78, 1.28);

  // fourche inclinée (chopper léger), guidon haut et large, grand phare chromé
  const rake = 0.6, L = 0.8;
  const steerG = new THREE.Group();
  steerG.position.set(0, R + L * Math.cos(rake), -wb / 2 + L * Math.sin(rake));
  steerG.rotation.x = rake;
  root.add(steerG);
  const fork = new THREE.Group(); steerG.add(fork);
  for (const sx of [-1, 1]) { tube(fork, [sx * 0.12, 0.05, 0], [sx * 0.12, -L, 0], 0.03, M.chrome); tube(fork, [sx * 0.12, 0.0, 0], [sx * 0.12, -0.36, 0], 0.042, M.chrome); }
  const front = wheel(R, 0.09, 0.19, M.chrome); front.position.set(0, -L, 0); fork.add(front);
  box(fork, 0.2, 0.025, 0.5, paint, 0, -L + R + 0.09, 0, 0.1);
  for (const sx of [-1, 1]) { // guidon type « ape hanger »
    tube(fork, [sx * 0.06, 0.1, 0.02], [sx * 0.34, 0.22, 0.12], 0.018, M.chrome);
    tube(fork, [sx * 0.34, 0.22, 0.12], [sx * 0.44, 0.46, 0.2], 0.018, M.chrome);
    tube(fork, [sx * 0.44, 0.46, 0.2], [sx * 0.46, 0.46, 0.28], 0.024, M.rubber);
  }
  ball(fork, 0.16, 0.16, 0.12, M.chrome, 0, 0.06, -0.15);
  const lamp = ball(fork, 0.11, 0.11, 0.05, M.lamp, 0, 0.06, -0.25);
  box(fork, 0.3, 0.26, 0.02, M.screen, 0, 0.34, -0.12, -0.35); // pare-brise

  return {
    group: finish(root), steer: fork, wheels: [front, rear], tail, lamp, wheelRadius: R, length: 2.6,
    seats: [{ hip: [0, 0.82, 0.12], eye: [0, 1.46, 0.0] }, { hip: [0, 0.88, 0.72], eye: [0, 1.52, 0.66] }],
  };
}

// ---------------------------------------------------------------- VÉLO : cadre diamant, roues à rayons, couleurs variées (v0.43.0)
// Géométries FUSIONNÉES à couleurs par sommet (merge de props.js) et un seul matériau partagé : 5 maillages par vélo (cadre, roue arrière, fourche
// avec guidon, roue avant, pédalier), donc 5 appels de dessin ; aucune lumière (le vélo n'a ni phare ni sonnette). La fourche tourne avec le guidon ;
// les roues tournent avec `wheelRot` (vehicles.js) et le pédalier à `crankRatio` fois leur vitesse. Les géométries sont partagées entre vélos
// de même variante.
export const VELO_COLORS = [0x2f6fb3, 0xb3392f, 0x2f9a6a, 0xe0a82e, 0x7b4fa8, 0xd9dbe0, 0xe0742e, 0x2a8fa8];
let VELO_MAT = null;
const veloMat = () => VELO_MAT || (VELO_MAT = reflective(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 }), 0.9));
const veloGeo = {};
function colored(g, hex) { // couleur par sommet
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const vBox = (w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return colored(g.translate(x, y, z), hex);
};
function vTube(a, b, r, hex, seg = 6) { // cylindre entre deux points
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(SHARED_UP, B.clone().sub(A).normalize()));
  const m = A.clone().add(B).multiplyScalar(0.5);
  return colored(g.translate(m.x, m.y, m.z), hex);
}
function veloParts(variant) {
  const paint = VELO_COLORS[variant % VELO_COLORS.length], dark = 0x24262a, chrome = 0xc4c9d1, rubber = 0x111214, seatC = 0x1a1a1c;
  const R = 0.34, tr = 0.028, rimR = R - tr * 2 - 0.008;
  if (!veloGeo.wheel) { // roue : pneu, jante, 16 rayons, moyeu, deux catadioptres orange (on voit qu'elle tourne)
    const parts = [colored(new THREE.TorusGeometry(R - tr, tr, 8, 28).rotateY(Math.PI / 2), rubber), colored(new THREE.TorusGeometry(rimR, 0.009, 6, 28).rotateY(Math.PI / 2), 0xb8bec6),
      colored(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 8).rotateZ(Math.PI / 2), 0x8e949c)];
    for (let k = 0; k < 8; k++) parts.push(colored(new THREE.BoxGeometry(0.005 + k * 0.0002, rimR * 2, 0.005 + k * 0.0002).rotateX((k * Math.PI) / 8), 0xcfd3d8)); // épaisseurs différentes : pas de z-fighting
    parts.push(vBox(0.05, 0.03, 0.012, 0xe08a1c, 0, rimR * 0.92, 0), vBox(0.05, 0.03, 0.012, 0xe08a1c, 0, -rimR * 0.92, 0));
    veloGeo.wheel = merge(parts);
  }
  if (!veloGeo.crank) veloGeo.crank = merge([ // plateau, deux manivelles, pédales
    colored(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 16).rotateZ(Math.PI / 2).translate(0.045, 0, 0), dark),
    vBox(0.012, 0.17, 0.025, 0x9aa0a8, 0.07, -0.085, 0), vBox(0.012, 0.17, 0.025, 0x9aa0a8, -0.07, 0.085, 0),
    vBox(0.09, 0.015, 0.07, rubber, 0.105, -0.17, 0), vBox(0.09, 0.015, 0.07, rubber, -0.105, 0.17, 0)]);
  if (!veloGeo.fork) {
    const f = [];
    for (const sx of [-1, 1]) {
      f.push(vTube([sx * 0.045, -0.02, 0], [sx * 0.045, -0.4, 0], 0.013, dark, 6));
      f.push(vTube([sx * 0.31, 0.29, -0.12], [sx * 0.4, 0.29, -0.17], 0.017, rubber, 7)); // poignées
      f.push(vBox(0.012, 0.012, 0.07, dark, sx * 0.26, 0.3, -0.15)); // leviers de frein
    }
    f.push(vBox(0.12, 0.022, 0.03, dark, 0, -0.01, 0), vTube([0, -0.01, 0], [0, 0.3, 0], 0.012, chrome), vTube([0, 0.28, 0], [0, 0.29, -0.1], 0.014, chrome), vTube([-0.31, 0.29, -0.12], [0.31, 0.29, -0.12], 0.011, chrome));
    veloGeo.fork = merge(f);
  }
  const key = 'body' + (variant % VELO_COLORS.length);
  if (!veloGeo[key]) {
    const BB = [0, 0.3, 0.1], RA = [0, 0.34, 0.525], ST = [0, 0.79, 0.225], b = [
      vTube([0, 0.722, -0.407], [0, 0.865, -0.363], 0.024, paint, 8), // tube de direction
      vTube([0, 0.835, -0.368], ST, 0.018, paint), vTube([0, 0.75, -0.4], BB, 0.022, paint), vTube(BB, ST, 0.018, paint), // tube supérieur, diagonal, de selle
      vTube(ST, [0, 0.88, 0.248], 0.014, chrome), // tige de selle
      vBox(0.13, 0.045, 0.25, seatC, 0, 0.905, 0.265), vBox(0.07, 0.04, 0.12, seatC, 0, 0.905, 0.15), // selle
      vBox(0.045, 0.045, 0.015, 0xd02828, 0, 0.62, 0.575), // catadioptre arrière
      vTube([0.045, 0.39, 0.1], [0.045, 0.37, 0.525], 0.004, dark, 4), // chaîne
    ];
    for (const sx of [-1, 1]) { b.push(vTube([sx * 0.03, 0.77, 0.225], [sx * 0.055, 0.34, 0.525], 0.011, paint), vTube([sx * 0.035, 0.3, 0.1], [sx * 0.055, 0.34, 0.525], 0.012, paint)); }
    veloGeo[key] = merge(b);
  }
  return { body: veloGeo[key], fork: veloGeo.fork, wheel: veloGeo.wheel, crank: veloGeo.crank, R };
}
export function buildVelo(variant = 0) {
  const P = veloParts(Math.abs(variant | 0)), mat = veloMat(), rake = 0.3, wb = 1.05;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(P.body, mat));
  const rear = new THREE.Mesh(P.wheel, mat); rear.position.set(0, P.R, wb / 2); root.add(rear);
  const crank = new THREE.Mesh(P.crank, mat); crank.position.set(0, 0.3, 0.1); root.add(crank);
  const steerG = new THREE.Group(); // axe de direction : incliné de `rake`, la fourche tourne autour
  steerG.position.set(0, 0.722, -0.407); steerG.rotation.x = rake; root.add(steerG);
  const fork = new THREE.Group(); steerG.add(fork);
  fork.add(new THREE.Mesh(P.fork, mat));
  const front = new THREE.Mesh(P.wheel, mat); front.position.set(0, -0.4, 0); fork.add(front);
  return {
    group: finish(root), steer: fork, wheels: [front, rear], crank, crankRatio: 0.5, wheelRadius: P.R, length: 1.75,
    seats: [{ hip: [0, 0.915, 0.23], eye: [0, 1.54, 0.13] }],
  };
}

// ---------------------------------------------------------------- VOITURE : coupé GT sport 4 roues, 2 places, carrosserie sculptée
export const CAR_PAINTS = [
  0xc62828, // Rouge Corsa / GTI
  0x1565c0, // Bleu Alpine métallisé
  0x1c1e22, // Noir Onyx fantôme
  0xf2f4f7, // Blanc Glacier nacré
  0x546e7a, // Gris Nardo
  0xf9a825, // Jaune Racing
];

// Roue spécifique de voiture : pneu taille basse large, jante alliage 10 branches en Y, disque de frein ventilé
function carWheel(R, width, rimMat) {
  const M = mats(), g = new THREE.Group();
  const tireR = 0.072;
  const tire = new THREE.TorusGeometry(R - tireR * 0.85, tireR, 14, 32).rotateY(Math.PI / 2);
  tire.scale(width / (tireR * 2), 1, 1);
  g.add(new THREE.Mesh(tire, M.rubber));

  // Flanc du pneu pour éviter le trou entre le tore et la jante
  const sideR = R - tireR * 0.45;
  const innerR = R - tireR * 1.55;
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(innerR, sideR, 28), M.rubber);
    ring.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    ring.position.x = sx * (width * 0.46);
    g.add(ring);
  }

  // Jante aluminium sport à 10 branches (5 paires en Y)
  const rimR = innerR;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.86, 24, 1, true).rotateZ(Math.PI / 2), rimMat);
  g.add(barrel);
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    box(g, 0.022, rimR * 1.9, 0.024, rimMat, width * 0.36 - k * 0.0005, 0, 0, a + 0.12);
    box(g, 0.022, rimR * 1.9, 0.024, rimMat, width * 0.35 - k * 0.0005, 0, 0, a - 0.12);
  }
  // Moyeu central avec écrou central rouge
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, width * 0.82, 14).rotateZ(Math.PI / 2), M.black);
  g.add(hub);
  const centerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, width * 0.85, 12).rotateZ(Math.PI / 2), M.tail);
  g.add(centerCap);

  // Disque de frein acier ventilé
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.018, 24).rotateZ(Math.PI / 2), M.steel);
  disc.position.x = width * 0.15;
  g.add(disc);

  return g;
}

export function buildVoiture(variant = 0) {
  const M = mats();
  const cHex = CAR_PAINTS[Math.abs(variant | 0) % CAR_PAINTS.length];
  const paint = reflective(std(cHex, 0.26, 0.62), 1.35);
  const carbon = reflective(std(0x141619, 0.42, 0.45), 0.9);
  const darkTrim = std(0x101215, 0.75, 0.2);
  const glassMat = reflective(std(0x1b2631, 0.08, 0.15, { transparent: true, opacity: 0.48 }), 1.4);
  const drlMat = std(0xffffff, 0.2, 0, { emissive: 0xdff4ff, emissiveIntensity: 3.2 });
  const brakeMat = std(0x550808, 0.3, 0, { emissive: 0xd91414, emissiveIntensity: 1.8 });
  const revMat = std(0xcccccc, 0.3, 0, { emissive: 0xffffff, emissiveIntensity: 0 });
  const calMat = std(0xd32f2f, 0.3, 0.5);

  const root = new THREE.Group();
  // Masse suspendue (carrosserie + habitacle) qui oscille sur la suspension (tangage, roulis, rebond vertical)
  const body = new THREE.Group();
  root.add(body);

  const R = 0.35, wb = 2.68, tw = 1.64; // Empattement 2.68 m, voie 1.64 m
  const halfWb = wb / 2, halfTw = tw / 2;

  // 1. Profil aérodynamique central extrudé (coque de coupé GT basse et élancée avec passages de roues intégrés)
  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-2.22, 0.20);
  lowerShape.lineTo(-2.28, 0.38);
  lowerShape.quadraticCurveTo(-2.18, 0.58, -1.82, 0.65);
  lowerShape.lineTo(-0.85, 0.74);
  lowerShape.lineTo(0.95, 0.74);
  lowerShape.lineTo(1.72, 0.77);
  lowerShape.lineTo(2.16, 0.72);
  lowerShape.lineTo(2.22, 0.34);
  lowerShape.lineTo(2.02, 0.20);
  // Découpe de l'arche de roue arrière (+halfWb)
  lowerShape.lineTo(halfWb + R + 0.07, 0.20);
  lowerShape.absarc(halfWb, R + 0.02, R + 0.06, 0, Math.PI, false);
  // Bas de caisse entre les deux roues
  lowerShape.lineTo(-halfWb + R + 0.07, 0.20);
  // Découpe de l'arche de roue avant (-halfWb)
  lowerShape.absarc(-halfWb, R + 0.02, R + 0.06, 0, Math.PI, false);
  lowerShape.lineTo(-2.22, 0.20);
  lowerShape.closePath();

  const lowerGeo = new THREE.ExtrudeGeometry(lowerShape, {
    depth: 1.66,
    bevelEnabled: true,
    bevelThickness: 0.075,
    bevelSize: 0.04,
    bevelSegments: 4,
    curveSegments: 14,
  });
  // rotateY(-PI/2) envoie X -> +Z (donc -2.28 reste à l'avant z = -2.28) et Z [0..1.66] -> X [-1.66..0]
  lowerGeo.rotateY(-Math.PI / 2);
  lowerGeo.translate(0.83, 0, 0);
  body.add(new THREE.Mesh(lowerGeo, paint));

  // Fond plat & Jupes latérales carbone
  box(body, 1.78, 0.08, 4.30, carbon, 0, 0.17, 0);
  for (const sx of [-1, 1]) {
    box(body, 0.08, 0.09, 1.82, carbon, sx * 0.90, 0.19, 0.0); // Bas de caisse sport
    box(body, 0.04, 0.15, 0.18, carbon, sx * 0.92, 0.23, 0.82); // Ailette de bas de caisse
  }

  // 2. Épaulements d'ailes (Widebody) et passages de roues creusés
  const archWellMat = std(0x08090b, 0.95, 0.05);
  for (const sx of [-1, 1]) {
    // Épaulements d'ailes avant et arrière biseautés
    box(body, 0.07, 0.15, 0.82, paint, sx * 0.88, 0.59, -halfWb, 0.03, 0, sx * -0.14);
    box(body, 0.08, 0.17, 0.92, paint, sx * 0.89, 0.62, halfWb + 0.05, -0.02, 0, sx * -0.14);
    // Prise d'air latérale derrière la porte
    box(body, 0.05, 0.22, 0.28, darkTrim, sx * 0.88, 0.52, 0.68, 0, sx * 0.12, 0);

    // Arches de roues et doublures intérieures noires
    for (const wz of [-halfWb, halfWb]) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(R + 0.055, 0.042, 10, 22, Math.PI).rotateY(Math.PI / 2),
        paint
      );
      arch.position.set(sx * 0.86, R + 0.02, wz);
      body.add(arch);

      const liner = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.34, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2),
        archWellMat
      );
      liner.position.set(sx * 0.74, R + 0.02, wz);
      body.add(liner);
    }
  }

  // 3. Capot moteur bombé (Power Dome) & Bouclier avant agressif
  box(body, 0.72, 0.05, 1.12, paint, 0, 0.72, -1.42, -0.085, 0, 0);
  // Doubles extracteurs d'air noirs sur le capot
  for (const sx of [-1, 1]) {
    box(body, 0.22, 0.025, 0.36, carbon, sx * 0.24, 0.74, -1.48, -0.085, 0, sx * -0.05);
  }
  // Lame splitter avant carbone + canards aérodynamiques
  box(body, 1.84, 0.045, 0.38, carbon, 0, 0.15, -2.18);
  // Calandre trapézoïdale noire + grille + logo chromé
  box(body, 1.12, 0.22, 0.08, darkTrim, 0, 0.35, -2.27);
  for (let i = -2; i <= 2; i++) {
    box(body, 1.08, 0.014, 0.09, M.steel, 0, 0.35 + i * 0.038, -2.28);
  }
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.01, 8, 18), M.chrome);
  emblem.position.set(0, 0.38, -2.32);
  body.add(emblem);
  // Écopes latérales du bouclier avant
  for (const sx of [-1, 1]) {
    box(body, 0.32, 0.18, 0.08, darkTrim, sx * 0.72, 0.33, -2.24, 0, sx * 0.18, 0);
    box(body, 0.30, 0.018, 0.10, carbon, sx * 0.72, 0.33, -2.26, 0, sx * 0.18, 0);
    box(body, 0.08, 0.03, 0.22, carbon, sx * 0.91, 0.25, -2.14, -0.15, sx * 0.25, 0); // Canards
  }

  // 4. Verrière / Habitacle coupé, Piliers A/B/C et Rétroviseurs
  // Toit profilé avec double bossage (Double-bubble roof)
  box(body, 1.26, 0.055, 1.22, paint, 0, 1.28, 0.12);
  for (const sx of [-1, 1]) {
    ball(body, 0.24, 0.032, 0.50, paint, sx * 0.28, 1.30, 0.10);
  }
  // Pare-brise avant incliné (rx = -0.58 : bas à l'avant z=-1.02, haut à l'arrière z=-0.35)
  box(body, 1.30, 0.03, 0.88, glassMat, 0, 1.03, -0.68, -0.58, 0, 0);
  box(body, 1.28, 0.032, 0.14, carbon, 0, 1.24, -0.40, -0.58, 0, 0);
  // Essuie-glaces plaqués au bas du pare-brise
  for (const sx of [-0.30, 0.16]) {
    box(body, 0.44, 0.015, 0.02, M.black, sx, 0.79, -0.96, -0.58, 0, -0.08);
  }
  // Lunette arrière fastback (rx = +0.46 : haut à l'avant z=+0.72, bas à l'arrière z=+1.55)
  box(body, 1.26, 0.03, 1.02, glassMat, 0, 1.04, 1.14, 0.46, 0, 0);
  // Vitres latérales et montants profilés
  for (const sx of [-1, 1]) {
    box(body, 0.025, 0.36, 1.44, glassMat, sx * 0.67, 1.02, 0.15, 0, 0, sx * -0.15);
    // Montant A (pare-brise)
    tube(body, [sx * 0.73, 0.76, -1.02], [sx * 0.62, 1.27, -0.35], 0.032, paint);
    // Montant B (central noir brillant)
    tube(body, [sx * 0.72, 0.76, 0.22], [sx * 0.63, 1.26, 0.28], 0.035, M.black);
    // Montant C (custode fastback)
    tube(body, [sx * 0.74, 0.78, 1.55], [sx * 0.62, 1.26, 0.72], 0.046, paint);
    // Rétroviseurs sport sur tige aérodynamique
    tube(body, [sx * 0.78, 0.78, -0.65], [sx * 0.92, 0.86, -0.62], 0.018, carbon);
    ball(body, 0.09, 0.055, 0.07, paint, sx * 0.95, 0.87, -0.62);
    box(body, 0.12, 0.07, 0.015, M.chrome, sx * 0.95, 0.87, -0.56);
    // Poignées affleurantes
    box(body, 0.02, 0.028, 0.15, M.chrome, sx * 0.85, 0.66, 0.05);
  }

  // 5. Poupe arrière, Diffuseur à ailettes, Quadruple échappement & Aileron GT col-de-cygne
  box(body, 1.56, 0.24, 0.32, darkTrim, 0, 0.26, 2.12); // Diffuseur arrière
  for (const dx of [-0.52, -0.26, 0, 0.26, 0.52]) {
    box(body, 0.025, 0.18, 0.28, carbon, dx, 0.23, 2.16); // Dérives de diffuseur
  }
  // 4 sorties d'échappement sport chromées (2 de chaque côté)
  for (const sx of [-1, 1]) {
    for (const off of [-0.07, 0.07]) {
      tube(body, [sx * 0.52 + off, 0.24, 1.98], [sx * 0.52 + off, 0.24, 2.29], 0.042, M.chrome, 12);
      tube(body, [sx * 0.52 + off, 0.24, 2.02], [sx * 0.52 + off, 0.24, 2.30], 0.032, M.black, 10);
    }
  }
  // Aileron GT en carbone sur mâts col-de-cygne (bord d'attaque plongeant vers l'avant : rx = -0.14)
  box(body, 1.62, 0.038, 0.28, carbon, 0, 1.00, 2.06, -0.14, 0, 0);
  for (const sx of [-1, 1]) {
    box(body, 0.025, 0.16, 0.34, carbon, sx * 0.81, 1.00, 2.06, 0.08, 0, 0); // Dérives latérales d'aileron
    tube(body, [sx * 0.44, 0.76, 1.92], [sx * 0.44, 1.00, 2.02], 0.022, M.black);
  }
  // Plaques d'immatriculation (avant et arrière)
  const plateMat = std(0xf5f7fa, 0.4, 0.1);
  const blueBand = std(0x003399, 0.4, 0.1);
  for (const [pz, ry] of [[-2.31, 0], [2.23, Math.PI]]) {
    const pl = new THREE.Group();
    pl.position.set(0, 0.30, pz);
    pl.rotation.y = ry;
    box(pl, 0.42, 0.095, 0.012, darkTrim, 0, 0, 0);
    box(pl, 0.40, 0.08, 0.015, plateMat, 0, 0, 0.002);
    box(pl, 0.045, 0.08, 0.017, blueBand, -0.175, 0, 0.003);
    box(pl, 0.045, 0.08, 0.017, blueBand, 0.175, 0, 0.003);
    body.add(pl);
  }

  // 6. Habitacle détaillé (sièges baquets, tableau de bord numérique, console, volant sport)
  box(body, 1.38, 0.26, 0.52, darkTrim, 0, 0.78, -0.58); // Planche de bord
  // Casquette de compteurs et écran numérique illuminé
  box(body, 0.42, 0.14, 0.24, M.black, -0.38, 0.90, -0.52);
  const dashScreen = std(0x0a192f, 0.2, 0, { emissive: 0x00bcd4, emissiveIntensity: 1.6 });
  box(body, 0.36, 0.10, 0.02, dashScreen, -0.38, 0.89, -0.41);
  // Écran multimédia central incliné
  box(body, 0.24, 0.15, 0.03, dashScreen, 0.02, 0.86, -0.36, -0.2, -0.15, 0);
  // Tunnel central carbone + levier de vitesse + frein à main
  box(body, 0.24, 0.24, 1.15, carbon, 0, 0.44, 0.08);
  tube(body, [0, 0.56, -0.08], [0, 0.70, -0.06], 0.016, M.chrome);
  ball(body, 0.034, 0.034, 0.034, calMat, 0, 0.71, -0.06);
  tube(body, [0.05, 0.56, 0.22], [0.05, 0.64, 0.08], 0.014, M.rubber); // Levier de frein à main
  // Rétroviseur intérieur central
  box(body, 0.20, 0.055, 0.03, M.black, 0, 1.28, -0.35);

  // Sièges baquets sport (conducteur à gauche, passager à droite)
  for (const sx of [-0.38, 0.38]) {
    box(body, 0.48, 0.12, 0.52, M.seat, sx, 0.38, 0.12); // Assise
    // Bourrelets latéraux d'assise
    box(body, 0.08, 0.16, 0.50, darkTrim, sx - 0.22, 0.42, 0.12);
    box(body, 0.08, 0.16, 0.50, darkTrim, sx + 0.22, 0.42, 0.12);
    // Dossier baquet incliné + maintien d'épaules + appuie-tête intégré
    box(body, 0.44, 0.62, 0.11, M.seat, sx, 0.74, 0.38, -0.18, 0, 0);
    box(body, 0.52, 0.22, 0.12, darkTrim, sx, 0.88, 0.41, -0.18, 0, 0);
    box(body, 0.26, 0.20, 0.10, M.seat, sx, 1.12, 0.46, -0.12, 0, 0);
    box(body, 0.18, 0.04, 0.12, calMat, sx, 0.98, 0.43, -0.18, 0, 0); // Passe-harnais rouge
  }

  // Volant sport à méplat (tourne avec la direction)
  const volantG = new THREE.Group();
  volantG.position.set(-0.38, 0.82, -0.28);
  volantG.rotation.x = -0.38;
  body.add(volantG);
  volantG.add(new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.022, 10, 24), M.rubber));
  for (const ang of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    box(volantG, 0.024, 0.15, 0.016, M.chrome, 0, 0, 0, 0, 0, ang);
  }
  ball(volantG, 0.052, 0.052, 0.025, darkTrim, 0, 0, 0.01);
  box(volantG, 0.025, 0.028, 0.028, calMat, 0, 0.165, 0); // Repère point milieu rouge à 12h

  // 7. Optiques : Phares LED avant, bandeau arrière, feux stop et feux de recul
  let lampL = null;
  for (const sx of [-1, 1]) {
    // Bloc optique avant sombre + projecteur + signature LED en croc
    box(body, 0.34, 0.12, 0.16, darkTrim, sx * 0.64, 0.62, -2.14, 0.1, sx * -0.18, 0);
    const l = ball(body, 0.09, 0.055, 0.06, M.lamp, sx * 0.62, 0.62, -2.19);
    if (sx < 0) lampL = l;
    box(body, 0.32, 0.022, 0.05, drlMat, sx * 0.64, 0.67, -2.18, 0, sx * -0.18, sx * -0.12);
    box(body, 0.025, 0.09, 0.05, drlMat, sx * 0.78, 0.62, -2.15, 0, sx * -0.18, 0);
  }

  // Bandeau lumineux arrière continu + blocs feux stop
  const tailStrip = box(body, 1.54, 0.035, 0.05, M.tail, 0, 0.70, 2.20);
  const brakeL = box(body, 0.38, 0.085, 0.06, brakeMat, -0.62, 0.66, 2.20, 0, -0.12, 0);
  const brakeR = box(body, 0.38, 0.085, 0.06, brakeMat, 0.62, 0.66, 2.20, 0, 0.12, 0);
  const brakeCenter = box(body, 0.42, 0.022, 0.04, brakeMat, 0, 1.01, 2.18); // 3e feu stop sous l'aileron
  const revL = box(body, 0.14, 0.035, 0.05, revMat, -0.52, 0.60, 2.21);
  const revR = box(body, 0.14, 0.035, 0.05, revMat, 0.52, 0.60, 2.21);

  // Faisceaux lumineux avant (SpotLights attachés à la carrosserie)
  const spotL = new THREE.SpotLight(0xfff6dd, 28, 60, 0.58, 0.55, 1.2);
  spotL.position.set(-0.62, 0.64, -2.25);
  spotL.target.position.set(-0.62, 0.15, -28);
  body.add(spotL, spotL.target);

  const spotR = new THREE.SpotLight(0xfff6dd, 28, 60, 0.58, 0.55, 1.2);
  spotR.position.set(0.62, 0.64, -2.25);
  spotR.target.position.set(0.62, 0.15, -28);
  body.add(spotR, spotR.target);

  // 8. Train roulant (4 roues non suspendues + pivots de direction + étriers fixes)
  const wRL = carWheel(R, 0.25, M.chrome);
  wRL.position.set(-halfTw, R, halfWb);
  root.add(wRL);
  const wRR = carWheel(R, 0.25, M.chrome);
  wRR.position.set(halfTw, R, halfWb);
  root.add(wRR);

  // Pivots de direction avant (Ackermann) : l'étrier est sur le pivot (tourne au braquage mais ne tourne pas avec la roue)
  const steerLeft = new THREE.Group();
  steerLeft.position.set(-halfTw, R, -halfWb);
  root.add(steerLeft);
  const wFL = carWheel(R, 0.23, M.chrome);
  steerLeft.add(wFL);

  const steerRight = new THREE.Group();
  steerRight.position.set(halfTw, R, -halfWb);
  root.add(steerRight);
  const wFR = carWheel(R, 0.23, M.chrome);
  steerRight.add(wFR);

  // Étriers de frein Brembo rouges fixes
  box(steerLeft, 0.065, 0.13, 0.09, calMat, -0.04, 0.04, 0.14);
  box(steerRight, 0.065, 0.13, 0.09, calMat, 0.04, 0.04, 0.14);
  box(root, 0.065, 0.13, 0.09, calMat, -halfTw - 0.04, R + 0.04, halfWb - 0.14);
  box(root, 0.065, 0.13, 0.09, calMat, halfTw + 0.04, R + 0.04, halfWb - 0.14);

  return {
    group: finish(root),
    body,
    steerLeft,
    steerRight,
    volant: volantG,
    steer: steerLeft,
    wheels: [wFL, wFR, wRL, wRR],
    wheelRadius: R,
    length: 4.45,
    width: 1.88,
    tail: tailStrip,
    lamp: lampL,
    brakeMat,
    revMat,
    brakeLights: [brakeL, brakeR, brakeCenter],
    reverseLights: [revL, revR],
    headlights: [spotL, spotR],
    exhaustPoints: [[-0.52, 0.24, 2.30], [0.52, 0.24, 2.30]],
    seats: [
      { hip: [-0.38, 0.48, 0.12], eye: [-0.38, 1.12, 0.12] }, // Conducteur (gauche)
      { hip: [0.38, 0.48, 0.12], eye: [0.38, 1.12, 0.12] },  // Passager (droite)
    ],
  };
}

export const BUILDERS = { moto: buildMoto, grosseMoto: buildGrosseMoto, velo: buildVelo, voiture: buildVoiture };
