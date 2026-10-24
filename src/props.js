import * as THREE from 'three';
import { contact } from './contact.js';
import { reflective } from './envmap.js';

// =====================================================================
//  Mobilier urbain et décors : modèles low-poly arrondis, affichés par instanciation
//  (un appel de dessin par type d'objet et par matériau, quel que soit leur nombre).
// =====================================================================

// ------------------------------------------------------------------ Textures procédurales
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const plankTex = () => canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#7a5434'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const y = (i * h) / 4;
    x.fillStyle = `hsl(28, ${30 + i * 4}%, ${26 + (i % 2) * 6}%)`; x.fillRect(0, y + 2, w, h / 4 - 4);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
    for (let k = 0; k < 10; k++) { x.beginPath(); x.moveTo(0, y + 6 + k * 5); x.bezierCurveTo(w * 0.3, y + 4 + k * 5, w * 0.6, y + 9 + k * 5, w, y + 6 + k * 5); x.stroke(); }
    x.fillStyle = '#2a1a10'; x.fillRect(0, y, w, 2);
    x.fillStyle = '#1c1c1c'; for (const nx of [12, w - 16]) { x.beginPath(); x.arc(nx, y + h / 8, 3, 0, 7); x.fill(); }
  }
});
const oakTex = () => canvasTex(256, 256, (x, w, h) => { // chêne sombre ciré : fibres longues, nœuds, patine
  x.fillStyle = '#4e301c'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { const y = Math.random() * h; x.strokeStyle = `rgba(${Math.random() < 0.5 ? '20,10,4' : '120,80,46'},${0.1 + Math.random() * 0.25})`; x.lineWidth = 0.6 + Math.random() * 1.6; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 10, w * 0.65, y + (Math.random() - 0.5) * 10, w, y + (Math.random() - 0.5) * 6); x.stroke(); }
  for (let i = 0; i < 3; i++) { const px = Math.random() * w, py = Math.random() * h, g = x.createRadialGradient(px, py, 1, px, py, 12); g.addColorStop(0, 'rgba(20,10,5,0.8)'); g.addColorStop(1, 'rgba(20,10,5,0)'); x.fillStyle = g; x.fillRect(px - 12, py - 12, 24, 24); }
  const v = x.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(255,220,170,0.08)'); v.addColorStop(1, 'rgba(0,0,0,0.12)'); x.fillStyle = v; x.fillRect(0, 0, w, h);
});
const awningTex = () => canvasTex(128, 64, (x, w, h) => { // auvent rayé rouge et blanc (chalets du marché de Noël)
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#e8e2d4' : '#a8222a'; x.fillRect(i * 16, 0, 16, h); }
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 400; i++) x.fillRect(Math.random() * w, Math.random() * h, 1, 1);
});
const sandbagTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#8a7a58'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,30,10' : '220,200,160'},0.15)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.strokeStyle = 'rgba(40,30,15,0.35)'; for (let y = 0; y < h; y += 8) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + 3); x.stroke(); }
});
const hazardTex = () => canvasTex(256, 64, (x, w, h) => {
  for (let i = -2; i < 12; i++) { x.fillStyle = i % 2 ? '#141414' : '#e8b818'; x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + 32, 0); x.lineTo(i * 32 + 64, h); x.lineTo(i * 32 + 32, h); x.fill(); }
});
const posterTex = () => canvasTex(256, 256, (x, w, h) => { // affiches de spectacles et plan de ville (colonnes Morris, kiosques, panneaux)
  x.fillStyle = '#1d2d22'; x.fillRect(0, 0, w, h);
  const cards = [
    [6, 8, 114, 114, '#c84b31', '#f3e5ab', 'OPÉRA DU RHIN'],
    [132, 8, 116, 114, '#244d6a', '#e8eef2', 'STRASBOURG'],
    [6, 132, 114, 116, '#d99b26', '#1e1a16', 'THÉÂTRE'],
    [132, 132, 116, 116, '#ebe4d4', '#2a362e', 'GRANDE ÎLE'],
  ];
  for (const [px, py, pw, ph, bg, fg, title] of cards) {
    x.fillStyle = bg; x.fillRect(px, py, pw, ph);
    x.strokeStyle = fg; x.lineWidth = 2; x.strokeRect(px + 4, py + 4, pw - 8, ph - 8);
    x.fillStyle = fg; x.font = 'bold 12px Arial, sans-serif'; x.textAlign = 'center';
    x.fillText(title, px + pw / 2, py + 24, pw - 14);
    x.fillRect(px + 14, py + 34, pw - 28, 3);
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(px + 14, py + 46, pw - 28, 38);
    x.fillStyle = fg; x.fillRect(px + 18, py + 92, pw - 36, 4); x.fillRect(px + 24, py + 100, pw - 48, 3);
  }
});

// ------------------------------------------------------------------ Géométries utilitaires
const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  return g;
};
const lathe = (profile, seg = 16, y = 0) => { const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg); g.translate(0, y, 0); return g; };
// profil 2D (dans le plan x/y) extrudé sur z, centré
const extrude = (shapePts, depth, bevel = 0.04) => {
  const s = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
};
// Fusionne des géométries en une seule (un seul appel de dessin). Si TOUTES ont un attribut `color`, il est conservé (couleurs par sommet :
// matériau à vertexColors, voir les vélos de vehicleModels.js).
export function merge(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const withColor = geos.every((g) => g.attributes.color);
  const pos = [], nor = [], uv = [], col = [];
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array);
    else uv.push(...new Array((g.attributes.position.count) * 2).fill(0));
    if (withColor) col.push(...g.attributes.color.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (withColor) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// ------------------------------------------------------------------ Bibliothèque
export function createProps() {
  const M = {
    iron: reflective(new THREE.MeshStandardMaterial({ color: 0x222629, roughness: 0.65, metalness: 0.75 }), 0.7),
    darkGreen: reflective(new THREE.MeshStandardMaterial({ color: 0x1e2e24, roughness: 0.68, metalness: 0.45 }), 0.6),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: plankTex(), roughness: 0.85 }),
    woodPlain: new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.82 }),
    pewWood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: oakTex(), roughness: 0.6 }),
    carPaint: reflective(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.52, metalness: 0.48 }), 0.8),
    glass: reflective(new THREE.MeshStandardMaterial({ color: 0x090e14, roughness: 0.12, metalness: 0.88 }), 1.4),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 }),
    chrome: reflective(new THREE.MeshStandardMaterial({ color: 0x9da3aa, roughness: 0.32, metalness: 0.85 }), 1.3),
    lightsF: new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc866, emissiveIntensity: 1.8, roughness: 0.35 }),
    lightsR: new THREE.MeshStandardMaterial({ color: 0x6e0e0e, emissive: 0x4a0000, emissiveIntensity: 1.2, roughness: 0.35 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x78756e, roughness: 0.92, metalness: 0.05 }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0x8e6e62, roughness: 0.88 }),
    bronze: reflective(new THREE.MeshStandardMaterial({ color: 0x36483c, roughness: 0.52, metalness: 0.72 }), 0.9),
    water: reflective(new THREE.MeshStandardMaterial({ color: 0x14283c, roughness: 0.06, metalness: 0.55 }), 1.2),
    leaf: new THREE.MeshStandardMaterial({ color: 0x2e4624, roughness: 0.95, flatShading: true }),
    flower: new THREE.MeshStandardMaterial({ color: 0x8e1a22, roughness: 0.8 }),
    sandbag: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sandbagTex(), roughness: 0.98 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hazardTex(), roughness: 0.65 }),
    redWhite: reflective(new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.48, metalness: 0.55 }), 0.7),
    roofRed: new THREE.MeshStandardMaterial({ color: 0x68221c, roughness: 0.82 }),
    awning: new THREE.MeshStandardMaterial({ color: 0xffffff, map: awningTex(), roughness: 0.9, side: THREE.DoubleSide }),
    warm: new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xff9933, emissiveIntensity: 1.6 }),
    poster: new THREE.MeshStandardMaterial({ color: 0xffffff, map: posterTex(), roughness: 0.75 }),
    postYellow: reflective(new THREE.MeshStandardMaterial({ color: 0xba8c22, roughness: 0.68, metalness: 0.3 }), 0.6),
  };
  M.wood.map.repeat.set(1, 1);

  // ---- prototypes : liste de [géométrie, matériau]
  const P = {};
  // Voiture : profil latéral arrondi extrudé, vitres, roues avec jantes, phares
  {
    const L = 4.2, W = 1.72;
    const body = extrude([[-2.1, 0.32], [2.1, 0.32], [2.12, 0.62], [2.0, 0.86], [1.15, 0.94], [0.55, 1.42], [-0.95, 1.46], [-1.6, 0.98], [-2.08, 0.9], [-2.14, 0.6]], W - 0.1, 0.05);
    const win = extrude([[0.5, 0.96], [0.98, 0.96], [0.5, 1.36], [-0.9, 1.4], [-1.45, 0.98]], W - 0.02, 0);
    const wheels = [], rims = [];
    for (const [x, z] of [[1.32, 0.78], [1.32, -0.78], [-1.3, 0.78], [-1.3, -0.78]]) {
      wheels.push(cyl(0.33, 0.33, 0.24, 14, x, 0.33, z, Math.PI / 2));
      rims.push(cyl(0.18, 0.18, 0.26, 10, x, 0.33, z, Math.PI / 2));
    }
    P.car = [[body, M.carPaint], [win, M.glass], [merge(wheels), M.tyre], [merge(rims), M.chrome],
      [merge([box(0.05, 0.12, 0.3, 2.13, 0.72, 0.55), box(0.05, 0.12, 0.3, 2.13, 0.72, -0.55)]), M.lightsF],
      [merge([box(0.05, 0.12, 0.28, -2.15, 0.76, 0.6), box(0.05, 0.12, 0.28, -2.15, 0.76, -0.6)]), M.lightsR]];
    P.car.size = [L, W];
  }
  // Banc : lattes en bois, pieds en fonte
  {
    const slats = [], legs = [];
    for (let i = 0; i < 3; i++) slats.push(box(1.8, 0.04, 0.11, 0, 0.456, -0.18 + i * 0.13)); // 0,456 : le dessous (0,436) n'est plus coplanaire avec l'assise des pieds (0,43), qui scintillait
    for (let i = 0; i < 3; i++) slats.push(box(1.8, 0.11, 0.035, 0, 0.62 + i * 0.13, -0.27, -0.18));
    for (const x of [-0.75, 0.75]) legs.push(extrude([[-0.25, 0], [-0.18, 0], [-0.1, 0.43], [0.22, 0.43], [0.25, 0], [0.32, 0], [0.26, 0.48], [-0.02, 0.48], [-0.08, 0.95], [-0.15, 0.95], [-0.2, 0.47]], 0.05, 0).rotateY(Math.PI / 2).translate(x, 0, 0));
    P.bench = [[merge(slats), M.wood], [merge(legs), M.iron]];
    P.bench.size = [1.9, 0.6];
  }
  // Poubelle (vert foncé), potelet, borne
  // corps nervuré, couvercle bombé à poignée, deux roulettes : 22 segments, profil arrondi (plus de facettes)
  P.bin = [[merge([lathe([[0.001, 0.06], [0.2, 0.06], [0.225, 0.1], [0.232, 0.45], [0.226, 0.47], [0.236, 0.5], [0.24, 0.62], [0.234, 0.64], [0.244, 0.67], [0.256, 0.84], [0.272, 0.865], [0.262, 0.885], [0.001, 0.885]], 22),
    lathe([[0.001, 0.885], [0.274, 0.885], [0.268, 0.915], [0.23, 0.95], [0.14, 0.99], [0.05, 1.0], [0.001, 1.0]], 22), cyl(0.012, 0.012, 0.16, 6, 0, 0.99, 0, 0, Math.PI / 2),
    cyl(0.05, 0.05, 0.04, 10, -0.15, 0.06, -0.22, 0, Math.PI / 2), cyl(0.05, 0.05, 0.04, 10, 0.15, 0.06, -0.22, 0, Math.PI / 2)]), M.darkGreen]];
  P.bollard = [[lathe([[0.001, 0], [0.09, 0], [0.09, 0.75], [0.07, 0.86], [0.001, 0.92]], 10), M.iron]];
  // Vélo : deux roues (tores) + cadre
  {
    const wheels = [new THREE.TorusGeometry(0.33, 0.025, 6, 16).translate(0.52, 0.34, 0), new THREE.TorusGeometry(0.33, 0.025, 6, 16).translate(-0.52, 0.34, 0)];
    const frame = [cyl(0.02, 0.02, 0.62, 5, 0, 0.6, 0, 0, Math.PI / 2), cyl(0.02, 0.02, 0.5, 5, -0.22, 0.48, 0, 0, -0.9), cyl(0.02, 0.02, 0.5, 5, 0.26, 0.48, 0, 0, 0.9),
      cyl(0.018, 0.018, 0.3, 5, 0.52, 0.5, 0, 0, 0.3), box(0.22, 0.04, 0.08, -0.3, 0.78, 0), box(0.04, 0.04, 0.45, 0.48, 0.86, 0)];
    P.bike = [[merge(wheels), M.tyre], [merge(frame), M.redWhite]];
  }
  // Statue sur socle en grès
  P.statue = [[merge([box(2.2, 0.4, 2.2, 0, 0.2, 0), box(1.6, 1.6, 1.6, 0, 1.2, 0), box(1.9, 0.25, 1.9, 0, 2.1, 0)]), M.sandstone],
    [merge([lathe([[0.001, 0], [0.42, 0], [0.38, 0.9], [0.3, 1.5], [0.36, 1.85], [0.12, 2.0], [0.001, 2.05]], 12, 2.22), new THREE.SphereGeometry(0.2, 10, 8).translate(0, 4.45, 0),
      cyl(0.07, 0.07, 0.9, 6, 0.42, 3.75, 0, 0, -0.6)]), M.bronze]];
  // Fontaine : vasque et colonne
  P.fountain = [[merge([lathe([[1.5, 0], [1.6, 0.55], [1.45, 0.6], [1.35, 0.15], [0.001, 0.15]], 20), lathe([[0.18, 0], [0.18, 1.3], [0.6, 1.45], [0.55, 1.6], [0.001, 1.55]], 14)]), M.sandstone],
    [cyl(1.36, 1.36, 0.06, 20, 0, 0.45, 0), M.water]];
  // Jardinière avec buissons : bac à rebord mouluré et pieds
  {
    const planP = [
      box(1.56, 0.54, 0.76, 0, 0.31, 0),
      box(1.68, 0.08, 0.88, 0, 0.6, 0), // rebord supérieur mouluré
      box(1.64, 0.06, 0.84, 0, 0.03, 0), // socle
    ];
    for (const sx of [-0.65, 0.65]) for (const sz of [-0.3, 0.3]) {
      planP.push(box(0.12, 0.58, 0.12, sx, 0.31, sz)); // montants d'angles
    }
    P.planter = [[merge(planP), M.woodPlain], [merge([new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.8, 1).translate(-0.4, 0.82, 0), new THREE.IcosahedronGeometry(0.46, 0).scale(1, 0.85, 1).translate(0.35, 0.86, 0.05)]), M.leaf],
      [merge([new THREE.SphereGeometry(0.08, 6, 5).translate(-0.2, 1.05, 0.25), new THREE.SphereGeometry(0.08, 6, 5).translate(0.4, 1.12, -0.2), new THREE.SphereGeometry(0.08, 6, 5).translate(0.1, 1.15, 0.3)]), M.flower]];
  }
  // Caisse en planches renforcée : cornières d'angle en fer, traverses et diagonales
  {
    const W = 1.1, H = 1.0, D = 1.1;
    const core = box(W - 0.04, H - 0.04, D - 0.04, 0, H / 2, 0);
    const trims = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      trims.push(box(0.06, H, 0.06, sx * (W / 2 - 0.025), H / 2, sz * (D / 2 - 0.025)));
    }
    for (const sy of [0.035, H - 0.035]) {
      trims.push(box(W, 0.07, 0.05, 0, sy, D / 2 - 0.025));
      trims.push(box(W, 0.07, 0.05, 0, sy, -D / 2 + 0.025));
      trims.push(box(0.05, 0.07, D - 0.1, W / 2 - 0.025, sy, 0));
      trims.push(box(0.05, 0.07, D - 0.1, -W / 2 + 0.025, sy, 0));
    }
    // Traverses diagonales qui accrochent la lumière
    trims.push(box(Math.hypot(W, H) * 0.88, 0.05, 0.03, 0, H / 2, D / 2 - 0.012, 0, 0, Math.atan2(H, W)));
    trims.push(box(Math.hypot(W, H) * 0.88, 0.05, 0.03, 0, H / 2, -D / 2 + 0.012, 0, 0, -Math.atan2(H, W)));
    P.crate = [[core, M.wood], [merge(trims), M.iron]];
  }
  P.pallet = [[merge([box(1.2, 0.04, 0.12, 0, 0.13, -0.42), box(1.2, 0.04, 0.12, 0, 0.13, -0.14), box(1.2, 0.04, 0.12, 0, 0.13, 0.14), box(1.2, 0.04, 0.12, 0, 0.13, 0.42),
    box(0.1, 0.1, 1.0, -0.5, 0.06, 0), box(0.1, 0.1, 1.0, 0, 0.06, 0), box(0.1, 0.1, 1.0, 0.5, 0.06, 0)]), M.woodPlain]];
  // Bloc béton de chantier (profil "New Jersey")
  P.jersey = [[extrude([[-0.3, 0], [0.3, 0], [0.24, 0.08], [0.1, 0.32], [0.08, 0.82], [-0.08, 0.82], [-0.1, 0.32], [-0.24, 0.08]], 2.4, 0.02).rotateY(Math.PI / 2), M.concrete]];
  // Barrière de police (métal) : 2 m
  P.crowd = [[merge([cyl(0.025, 0.025, 2, 6, 0, 1.0, 0, 0, Math.PI / 2), cyl(0.025, 0.025, 2, 6, 0, 0.25, 0, 0, Math.PI / 2), cyl(0.025, 0.025, 1.0, 6, -0.98, 0.6, 0), cyl(0.025, 0.025, 1.0, 6, 0.98, 0.6, 0),
    ...Array.from({ length: 12 }, (_, i) => cyl(0.012, 0.012, 0.75, 4, -0.85 + i * 0.155, 0.62, 0)), box(0.5, 0.03, 0.06, -0.98, 0.02, 0), box(0.5, 0.03, 0.06, 0.98, 0.02, 0)]), M.redWhite]];
  // Mur de sacs de sable (2 m)
  {
    const bags = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
      const g = new THREE.CapsuleGeometry(0.16, 0.38, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.75, 1.15);
      g.translate(-0.75 + i * 0.5 + (row % 2) * 0.25, 0.13 + row * 0.24, (row % 2 ? 0.04 : -0.04));
      bags.push(g);
    }
    P.sandbags = [[merge(bags), M.sandbag]];
  }
  // Chalet du marché de Noël : base bois, comptoir éclairé, toit à deux pans
  {
    const wb = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    // gable : triangle plein sur le pignon (deux côtés)
    const gable = (sx) => { const sh = new THREE.Shape([new THREE.Vector2(-1.1, 0), new THREE.Vector2(1.1, 0), new THREE.Vector2(0, 0.9)]); const g = new THREE.ShapeGeometry(sh); g.rotateY(Math.PI / 2); g.translate(sx * 1.74, 2.2, 0); return g; };
    const lights = []; for (let i = 0; i < 12; i++) { const t = i / 11; lights.push(new THREE.SphereGeometry(0.035, 6, 5).translate(-1.55 + t * 3.1, 2.42 - Math.sin(t * Math.PI) * 0.12 * -1 - 0.1 * Math.abs(Math.sin(t * Math.PI * 3)), 1.38)); }
    P.chalet = [[merge([wb(3, 2.2, 2, 0, 1.1, 0), wb(0.14, 2.7, 0.14, -1.5, 1.35, 1.0), wb(0.14, 2.7, 0.14, 1.5, 1.35, 1.0), wb(3.2, 0.12, 0.12, 0, 2.28, 1.0), wb(3.1, 0.08, 0.6, 0, 1.0, 1.25), wb(3.1, 0.5, 0.05, 0, 0.55, 1.05)]), M.wood],
      [merge([box(3.5, 0.08, 1.45, 0, 2.62, 0.5, 0.55), box(3.5, 0.08, 1.45, 0, 2.62, -0.5, -0.55), wb(3.6, 0.1, 0.1, 0, 3.0, 0), gable(-1), gable(1)]), M.roofRed],
      [merge([box(3.0, 0.03, 0.62, 0, 2.18, 1.3, 0.62)]), M.awning],
      [merge([box(2.6, 0.7, 0.05, 0, 1.55, 1.01), ...lights]), M.warm], [box(2.8, 0.08, 0.5, 0, 0.98, 1.2), M.woodPlain]];
  }

  // Banc d'église (4,4 m) : assise, dossier à lisse arrondie et lattes, pupitre, joues sculptées (profil à volute extrudé), chêne ciré
  {
    const wbox = (w, h, d, x, y, z, rx = 0) => { // boîte dont les UV suivent les dimensions (la veine ne s'étire pas sur 4,4 m)
      const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] * 0.8, uv.getY(i) * dims[f][1] * 0.8); }
      if (rx) g.rotateX(rx);
      return g.translate(x, y, z);
    };
    const cheek = (sx) => extrude([[-0.27, 0], [0.27, 0], [0.27, 0.34], [0.22, 0.4], [0.2, 0.55], [0.16, 0.86], [0.08, 0.98], [-0.02, 1.02], [-0.12, 0.98], [-0.18, 0.86], [-0.2, 0.6], [-0.27, 0.42]], 0.07, 0.012).rotateY(Math.PI / 2).translate(sx, 0, 0);
    const parts = [wbox(4.3, 0.05, 0.44, 0, 0.45, 0.02), wbox(4.3, 0.4, 0.035, 0, 0.7, -0.24, -0.1), wbox(4.3, 0.06, 0.07, 0, 0.93, -0.28),
      wbox(4.3, 0.3, 0.035, 0, 0.74, 0.5), wbox(4.3, 0.035, 0.17, 0, 0.9, 0.43), wbox(4.3, 0.1, 0.1, 0, 0.09, 0.4), cheek(-2.17), cheek(2.17)];
    const rail = new THREE.CylinderGeometry(0.032, 0.032, 4.3, 8).rotateZ(Math.PI / 2).translate(0, 1.0, -0.3);
    parts.push(rail);
    P.pew = [[merge(parts), M.pewWood]];
  }
  // Colonne Morris : socle mouluré et dôme à écailles vert wagon, fût d'affiches, épi de faîtage en bronze
  {
    const green = [
      lathe([[0.001, 0], [0.68, 0], [0.68, 0.14], [0.62, 0.18], [0.60, 0.50], [0.64, 0.54], [0.57, 0.58], [0.001, 0.58]], 16),
      lathe([[0.57, 2.78], [0.65, 2.83], [0.76, 2.92], [0.74, 3.02], [0.64, 3.06], [0.58, 3.24], [0.42, 3.48], [0.20, 3.66], [0.06, 3.74], [0.001, 3.75]], 16),
    ];
    const finial = [lathe([[0.001, 3.74], [0.08, 3.78], [0.04, 3.92], [0.09, 4.02], [0.02, 4.22], [0.001, 4.28]], 10)];
    P.column = [[merge(green), M.darkGreen], [cyl(0.565, 0.565, 2.2, 18, 0, 1.68, 0), M.poster], [merge(finial), M.bronze]];
  }
  // Kiosque à journaux octogonal : soubassement et structure vert sombre, comptoir bois, vitrines et affiches, dôme à lanterneau
  {
    const green = [
      cyl(1.38, 1.42, 0.14, 8, 0, 0.07, 0),
      cyl(1.28, 1.32, 0.86, 8, 0, 0.50, 0),
      cyl(1.35, 1.35, 0.08, 8, 0, 0.95, 0),
      cyl(1.36, 1.32, 0.34, 8, 0, 2.42, 0),
      cyl(1.58, 1.62, 0.09, 8, 0, 2.62, 0),
      cyl(0.45, 1.54, 0.65, 8, 0, 2.99, 0),
      cyl(0.38, 0.42, 0.32, 8, 0, 3.46, 0),
      cyl(0.04, 0.48, 0.34, 8, 0, 3.78, 0),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * (Math.PI / 4);
      green.push(cyl(0.045, 0.045, 1.32, 6, Math.cos(a) * 1.22, 1.62, Math.sin(a) * 1.22));
    }
    const glass = [cyl(1.18, 1.18, 1.26, 8, 0, 1.62, 0)];
    const posters = [
      box(0.75, 1.05, 0.04, 0, 1.60, -1.23),
      box(0.04, 1.05, 0.75, -1.23, 1.60, 0),
      box(0.04, 1.05, 0.75, 1.23, 1.60, 0),
    ];
    P.kiosk = [[merge(green), M.darkGreen], [merge(glass), M.glass], [merge(posters), M.poster], [box(1.15, 0.07, 0.38, 0, 0.99, 1.22), M.woodPlain], [box(0.95, 0.58, 0.05, 0, 1.48, 1.19), M.warm]];
  }
  // Boîte aux lettres jaune sur piètement fonte
  {
    const stand = [cyl(0.16, 0.22, 0.08, 10, 0, 0.04, 0), cyl(0.07, 0.085, 0.68, 10, 0, 0.38, 0), box(0.36, 0.04, 0.30, 0, 0.94, 0.02)];
    const body = [box(0.44, 0.54, 0.36, 0, 0.98, 0), box(0.46, 0.06, 0.39, 0, 1.26, 0.01, 0.08)];
    P.postbox = [[merge(stand), M.iron], [merge(body), M.postYellow]];
  }
  // Panneau d'information / plan de ville double face (« sucette »)
  {
    const frame = [
      cyl(0.045, 0.055, 2.25, 8, -0.58, 1.125, 0),
      cyl(0.045, 0.055, 2.25, 8, 0.58, 1.125, 0),
      box(1.28, 1.56, 0.12, 0, 1.46, 0),
      box(1.36, 0.09, 0.18, 0, 2.27, 0),
      box(0.22, 0.05, 0.26, -0.58, 0.025, 0),
      box(0.22, 0.05, 0.26, 0.58, 0.025, 0),
    ];
    P.board = [[merge(frame), M.iron], [box(1.12, 1.38, 0.14, 0, 1.46, 0), M.poster]];
  }

  // ---- instances
  const inst = {}; // type -> [{ m: Matrix4, c: Color|null }]
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function place(type, x, z, rotY = 0, scale = 1, color = null, y = 0, tilt = 0) {
    contact.addProp(type, x, z, rotY, scale, y); // ombre de contact sous l'objet (contact.js)
    (inst[type] ||= []).push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(new THREE.Euler(tilt, rotY, 0, 'YXZ')).clone(), new THREE.Vector3(scale, scale, scale)), c: color });
  }
  function finish(scene) {
    const meshes = [];
    for (const [type, list] of Object.entries(inst)) {
      for (const [geo, mat] of P[type]) {
        const useColor = mat === M.carPaint;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.name = 'prop:' + type;
        list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (useColor) im.setColorAt(i, it.c || new THREE.Color(0x777777)); });
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
        meshes.push(im);
      }
    }
    return meshes;
  }

  // ---- barricade de porte (planches clouées sur poteaux), longueur variable, construite à la demande
  function gate(len, h = 3.1) {
    const g = new THREE.Group();
    const posts = Math.max(2, Math.ceil(len / 2.6) + 1);
    const parts = [];
    for (let i = 0; i < posts; i++) parts.push(box(0.16, h + 0.2, 0.16, -len / 2 + (len * i) / (posts - 1), (h + 0.2) / 2, -0.12));
    const boards = [];
    const n = Math.max(5, Math.round(h / 0.42));
    for (let i = 0; i < n; i++) {
      const y = 0.35 + (i * (h - 0.5)) / (n - 1);
      boards.push(box(len + 0.3, 0.3, 0.05, (Math.random() - 0.5) * 0.15, y, 0, 0, 0, (Math.random() - 0.5) * 0.06));
    }
    boards.push(box(Math.hypot(len, h * 0.8) * 0.98, 0.26, 0.05, 0, h / 2, 0.06, 0, 0, Math.atan2(h * 0.8, len)));
    g.add(new THREE.Mesh(merge(parts), M.iron), new THREE.Mesh(merge(boards), M.wood));
    g.add(new THREE.Mesh(box(len + 0.3, 0.14, 0.06, 0, 0.12, 0.05), M.hazard));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }
  // ---- clôture de zone fermée : blocs béton + palissade en tôle
  function sealWall(len, sheetMat) {
    const g = new THREE.Group();
    const blocks = [];
    const n = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i < n; i++) {
      const b = P.jersey[0][0].clone();
      b.scale((len / n) / 2.4, 1, 1);
      b.translate(-len / 2 + (len / n) * (i + 0.5), 0, 0.25);
      blocks.push(b);
    }
    g.add(new THREE.Mesh(merge(blocks), M.concrete));
    const sheet = new THREE.Mesh(box(len, 2.6, 0.06, 0, 2.05, -0.05), sheetMat);
    g.add(sheet);
    const posts = [];
    for (let i = 0; i <= Math.ceil(len / 3); i++) posts.push(box(0.1, 3.5, 0.1, -len / 2 + Math.min(len, i * 3), 1.75, -0.12));
    g.add(new THREE.Mesh(merge(posts), M.iron));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }

  // ---- grand portail gothique : deux battants cloutés qui pivotent sur leurs gonds
  function portalDoors(len, h = 8.2) {
    const g = new THREE.Group();
    const studs = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.8 });
    const oak = new THREE.MeshStandardMaterial({ color: 0x4a2a16, map: M.wood.map, roughness: 0.8 });
    const leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * len / 2, 0, 0);
      const w = len / 2;
      const leaf = new THREE.Mesh(box(w, h, 0.18, -side * w / 2, h / 2, 0), oak);
      const bands = [];
      for (const y of [1, h * 0.35, h * 0.65, h - 1]) bands.push(box(w * 0.92, 0.12, 0.05, -side * w / 2, y, 0.11));
      for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) bands.push(new THREE.SphereGeometry(0.035, 6, 4).translate(-side * (0.2 + (i * (w - 0.4)) / 5), 0.6 + (j * (h - 1.2)) / 9, 0.1));
      pivot.add(leaf, new THREE.Mesh(merge(bands), studs));
      g.add(pivot);
      leaves.push(pivot);
    }
    // arc brisé en pierre au-dessus
    const arch = new THREE.Mesh(box(len + 0.8, 0.6, 0.5, 0, h + 0.3, 0), new THREE.MeshStandardMaterial({ color: 0xa87c6a, roughness: 0.85 }));
    g.add(arch);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.userData.leaves = leaves;
    return g;
  }

  return { place, finish, gate, sealWall, portalDoors, sizes: { car: P.car.size, bench: P.bench.size }, M };
}
