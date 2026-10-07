import * as THREE from 'three';

// Modèles 3D des motos, construits à la main avec des formes simples. Repère local : l'origine est au sol, au milieu de
// l'empattement ; l'avant de la moto est vers -z, la droite vers +x. Chaque constructeur renvoie
//   { group, steer (la fourche : tourne avec le guidon), wheels: [avant, arrière], seats: [{ hip, eye }], tail, lamp }
// hip : le bassin du pilote (là où s'assoit un personnage), eye : ses yeux (la caméra du joueur local).

const std = (color, rough = 0.6, metal = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
let MAT = null;
const mats = () => MAT || (MAT = {
  black: std(0x15161a, 0.55, 0.3),
  steel: std(0x1d2025, 0.6, 0.4),
  chrome: std(0xc4c9d1, 0.2, 0.85),
  rubber: std(0x0c0c0e, 0.92, 0),
  seat: std(0x20170f, 0.8, 0.05),
  lamp: std(0xfff1c9, 0.3, 0, { emissive: 0xffe2a0, emissiveIntensity: 2.2 }),
  tail: std(0x661111, 0.4, 0, { emissive: 0xff2020, emissiveIntensity: 1.6 }),
  screen: std(0x9fb4c4, 0.1, 0.1, { transparent: true, opacity: 0.35 }),
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
  for (let k = 0; k < 6; k++) box(g, 0.022, rimR * 2, 0.026, rimMat, 0, 0, 0, (k * Math.PI) / 6);
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

export const BUILDERS = { moto: buildMoto, grosseMoto: buildGrosseMoto };
