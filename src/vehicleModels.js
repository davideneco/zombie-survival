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

// ---------------------------------------------------------------- VOITURE : berline sportive 4 roues, 2 places, carrosserie peinte
const CAR_PAINTS = [
  0xb71c1c, // Rouge sport (GTI)
  0x1565c0, // Bleu électrique
  0x212121, // Noir onyx
  0xf5f5f5, // Blanc glacier
  0x546e7a, // Gris nardo / acier
  0xf57f17, // Jaune racing
];

export function buildVoiture(variant = 0) {
  const M = mats();
  const cHex = CAR_PAINTS[Math.abs(variant | 0) % CAR_PAINTS.length];
  const paint = reflective(std(cHex, 0.42, 0.52), 1.1);
  const darkPaint = std(0x181a1e, 0.6, 0.3);
  const root = new THREE.Group();

  const R = 0.35, wb = 2.65, tw = 1.62; // Empattement 2.65 m, voie 1.62 m
  const halfWb = wb / 2, halfTw = tw / 2;

  // 1. Châssis & Bas de caisse
  box(root, 1.74, 0.22, 4.2, darkPaint, 0, 0.28, 0);

  // 2. Bouclier avant & Pare-chocs
  box(root, 1.82, 0.44, 0.7, paint, 0, 0.38, -1.95);
  box(root, 1.15, 0.24, 0.06, M.black, 0, 0.36, -2.31); // Calandre centrale
  box(root, 1.76, 0.06, 0.35, M.black, 0, 0.16, -2.12); // Lame splitter avant

  // 3. Capot moteur nervuré
  box(root, 1.68, 0.1, 1.35, paint, 0, 0.74, -1.45, 0.1, 0, 0);
  box(root, 0.5, 0.04, 0.8, darkPaint, 0, 0.81, -1.4, 0.1, 0, 0); // Écope de capot

  // 4. Ailes avant et passages de roues
  for (const sx of [-1, 1]) {
    box(root, 0.12, 0.48, 1.3, paint, sx * 0.85, 0.58, -1.4);
    box(root, 0.14, 0.52, 1.9, paint, sx * 0.84, 0.62, 0.15); // Flancs de portières
    box(root, 0.12, 0.48, 1.1, paint, sx * 0.85, 0.58, 1.65); // Ailes arrière
    // Rétroviseurs extérieurs
    box(root, 0.16, 0.09, 0.12, paint, sx * 0.94, 0.95, -0.72);
    box(root, 0.02, 0.07, 0.09, M.chrome, sx * 1.01, 0.95, -0.72); // Miroir
    // Poignées de portes
    box(root, 0.03, 0.025, 0.14, M.chrome, sx * 0.92, 0.75, -0.15);
  }

  // 5. Pavillon (toit) et montants
  box(root, 1.46, 0.08, 1.95, paint, 0, 1.42, 0.15); // Toit
  // Pare-brise avant incliné
  box(root, 1.42, 0.04, 0.95, M.screen, 0, 1.16, -0.62, 0.62, 0, 0);
  // Lunette arrière inclinée
  box(root, 1.42, 0.04, 0.85, M.screen, 0, 1.18, 0.92, -0.58, 0, 0);
  // Vitres latérales teintées
  for (const sx of [-1, 1]) {
    box(root, 0.03, 0.42, 1.6, M.screen, sx * 0.74, 1.16, 0.15);
    // Piliers A (avant), B (centre), C (arrière)
    tube(root, [sx * 0.72, 0.82, -0.85], [sx * 0.68, 1.4, -0.38], 0.032, M.black);
    tube(root, [sx * 0.75, 0.78, 0.12], [sx * 0.72, 1.4, 0.12], 0.036, M.black);
    tube(root, [sx * 0.72, 0.85, 1.15], [sx * 0.68, 1.4, 0.72], 0.04, M.black);
  }

  // 6. Coffre & Bouclier arrière
  box(root, 1.62, 0.15, 0.75, paint, 0, 0.82, 1.72); // Malle de coffre
  box(root, 1.82, 0.44, 0.65, paint, 0, 0.42, 1.95); // Pare-chocs arrière
  box(root, 1.4, 0.18, 0.25, M.black, 0, 0.22, 2.22); // Diffuseur arrière
  // Double sortie d'échappement inox
  tube(root, [-0.45, 0.2, 2.0], [-0.45, 0.2, 2.32], 0.05, M.chrome);
  tube(root, [0.45, 0.2, 2.0], [0.45, 0.2, 2.32], 0.05, M.chrome);
  // Aileron sport noir
  box(root, 1.52, 0.05, 0.28, M.black, 0, 1.05, 2.08);
  tube(root, [-0.5, 0.88, 2.0], [-0.5, 1.03, 2.05], 0.024, M.black);
  tube(root, [0.5, 0.88, 2.0], [0.5, 1.03, 2.05], 0.024, M.black);

  // 7. Habitacle intérieur & Sièges
  // Planche de bord
  box(root, 1.45, 0.28, 0.55, M.seat, 0, 0.82, -0.58);
  box(root, 0.38, 0.12, 0.02, M.tail, -0.42, 0.9, -0.42); // Compteurs éclairés
  // Console centrale et levier de vitesses
  box(root, 0.22, 0.28, 1.0, M.black, 0, 0.48, 0.15);
  tube(root, [0, 0.58, 0.05], [0, 0.72, 0.02], 0.018, M.chrome);
  ball(root, 0.035, 0.035, 0.035, M.seat, 0, 0.73, 0.02);

  // Sièges baquets avant gauche (conducteur) et droite (passager)
  for (const sx of [-0.42, 0.42]) {
    box(root, 0.52, 0.16, 0.55, M.seat, sx, 0.42, 0.15); // Assise
    box(root, 0.48, 0.65, 0.14, M.seat, sx, 0.8, 0.42, -0.2); // Dossier
    box(root, 0.28, 0.18, 0.12, M.seat, sx, 1.2, 0.5); // Appuie-tête
  }

  // Volant sport (qui tournera avec la direction)
  const volantG = new THREE.Group();
  volantG.position.set(-0.42, 0.86, -0.34);
  volantG.rotation.x = -0.42;
  root.add(volantG);
  const cerceau = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 24), M.rubber);
  volantG.add(cerceau);
  for (let k = 0; k < 3; k++) {
    box(volantG, 0.02, 0.16, 0.015, M.steel, 0, 0, 0, 0, 0, (k * Math.PI * 2) / 3);
  }
  ball(volantG, 0.05, 0.05, 0.02, M.seat, 0, 0, 0);

  // 8. Éclairage : Phares avant et Feux arrière
  const lampL = box(root, 0.32, 0.14, 0.06, M.lamp, -0.65, 0.66, -2.26, 0, 0.12, 0);
  const lampR = box(root, 0.32, 0.14, 0.06, M.lamp, 0.65, 0.66, -2.26, 0, -0.12, 0);
  const tailL = box(root, 0.36, 0.12, 0.05, M.tail, -0.66, 0.76, 2.25, 0, -0.08, 0);
  const tailR = box(root, 0.36, 0.12, 0.05, M.tail, 0.66, 0.76, 2.25, 0, 0.08, 0);

  // Projecteurs lumineux avant réels (SpotLights pointant vers l'avant de la voiture)
  const spotL = new THREE.SpotLight(0xfff6dd, 25, 55, 0.55, 0.6, 1.2);
  spotL.position.set(-0.65, 0.68, -2.3);
  spotL.target.position.set(-0.65, 0.2, -25);
  root.add(spotL, spotL.target);

  const spotR = new THREE.SpotLight(0xfff6dd, 25, 55, 0.55, 0.6, 1.2);
  spotR.position.set(0.65, 0.68, -2.3);
  spotR.target.position.set(0.65, 0.2, -25);
  root.add(spotR, spotR.target);

  // 9. Les 4 roues & Direction
  // Roues arrière fixes
  const wRL = wheel(R, 0.08, 0.24, M.chrome);
  wRL.position.set(-halfTw, R, halfWb);
  root.add(wRL);
  const wRR = wheel(R, 0.08, 0.24, M.chrome);
  wRR.position.set(halfTw, R, halfWb);
  root.add(wRR);

  // Pivots de direction avant gauche et avant droite (tournent autour de Y)
  const steerLeft = new THREE.Group();
  steerLeft.position.set(-halfTw, R, -halfWb);
  root.add(steerLeft);
  const wFL = wheel(R, 0.08, 0.22, M.chrome);
  steerLeft.add(wFL);

  const steerRight = new THREE.Group();
  steerRight.position.set(halfTw, R, -halfWb);
  root.add(steerRight);
  const wFR = wheel(R, 0.08, 0.22, M.chrome);
  steerRight.add(wFR);

  // Étriers de frein rouges sportifs sur chaque roue
  const calMat = std(0xd32f2f, 0.3, 0.6);
  box(steerLeft, 0.06, 0.1, 0.12, calMat, -0.09, 0.08, 0);
  box(steerRight, 0.06, 0.1, 0.12, calMat, 0.09, 0.08, 0);
  box(root, 0.06, 0.1, 0.12, calMat, -halfTw - 0.09, R + 0.08, halfWb);
  box(root, 0.06, 0.1, 0.12, calMat, halfTw + 0.09, R + 0.08, halfWb);

  return {
    group: finish(root),
    steerLeft,
    steerRight,
    volant: volantG,
    steer: steerLeft, // fallback pour les vérifications génériques
    wheels: [wFL, wFR, wRL, wRR],
    wheelRadius: R,
    length: 4.3,
    width: 1.85,
    tail: tailL,
    lamp: lampL,
    headlights: [spotL, spotR],
    exhaustPoints: [[-0.45, 0.2, 2.3], [0.45, 0.2, 2.3]],
    seats: [
      { hip: [-0.42, 0.52, 0.15], eye: [-0.42, 1.15, 0.15] }, // Conducteur (gauche)
      { hip: [0.42, 0.52, 0.15], eye: [0.42, 1.15, 0.15] },  // Passager (droite)
    ],
  };
}

export const BUILDERS = { moto: buildMoto, grosseMoto: buildGrosseMoto, velo: buildVelo, voiture: buildVoiture };
