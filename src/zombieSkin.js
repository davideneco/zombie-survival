import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// =====================================================================
//  Peau, visages et vêtements des zombies (v0.47.0) : VISUEL SEULEMENT.
//  - DEUX atlas partagés de cellules 256 x 256 (créés une fois, au premier zombie) :
//      chair  (4 x 3) : 4 visages, 4 peaux, visage + peau de pestiféré, visage + peau de pierre (gargouille), 2 cellules libres ;
//      tissus (4 x 3) : 6 hauts, 4 pantalons, pierre, toile ;
//    chaque matériau de zombie choisit SA cellule par une uniforme (uCell) : aucune texture par zombie, mémoire constante ;
//  - SANG : un masque de bruit (256 x 256) partagé et un seuil par matériau (uBlood, 0..1) : à chaque touche le seuil baisse et des
//    taches grandissent sur la peau et les vêtements (aucune texture modifiée, aucun message réseau) ;
//  - l'apparence vient de `z.id` (hachage) : tous les joueurs voient le même zombie ;
//  - géométries partagées : tête sculptée (orbites, arcades, nez, joues creuses) avec dents, mâchoire articulée, mains à griffes, pieds.
//  Les zones de tir (hitHead / hitBody) sont celles de zombie.js, inchangées.
// =====================================================================

const CELL = 256, COLS = 4, ROWS = 3;
export const CELLS = { face: [0, 1, 2, 3], skin: [4, 5, 6, 7], plagueFace: 8, plagueSkin: 9, stoneFace: 10, stoneSkin: 11, shirt: [0, 1, 2, 3, 4, 5], pants: [6, 7, 8, 9], stoneCloth: 10, burlap: 11 };

const fract = (x) => x - Math.floor(x);
export const hashId = (id, k = 0) => fract(Math.sin((id + 1) * 12.9898 + k * 78.233) * 43758.5453);

function rng(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- aides de dessin
function blobs(x, R, n, colors, rMin, rMax, alpha, w = CELL, h = CELL) {
  for (let i = 0; i < n; i++) {
    const px = R() * w, py = R() * h, r = rMin + R() * (rMax - rMin), c = colors[Math.floor(R() * colors.length)];
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, c.replace('A', alpha)); g.addColorStop(1, c.replace('A', 0));
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
}
const grain = (x, R, n, w = CELL, h = CELL, a = 0.09) => { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * a})`; x.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1 + R() * 1.5); } };
const veins = (x, R, n, col = 'rgba(46,62,96,0.4)') => {
  x.strokeStyle = col; x.lineWidth = 1;
  for (let i = 0; i < n; i++) { x.beginPath(); let px = R() * CELL, py = R() * CELL; x.moveTo(px, py); for (let k = 0; k < 7; k++) { px += (R() - 0.5) * 30; py += (R() - 0.35) * 26; x.lineTo(px, py); } x.stroke(); }
};

// ---------------------------------------------------------------- peau (4 teintes) : marbrures, veines, hématomes, croûtes, plaies, saleté
const SKIN_BASE = ['#6a7d5c', '#778468', '#5f7058', '#7d7c6c', '#6c7a58', '#566a46', '#74746f', '#807a68'];
function paintSkin(x, k, R, kind) {
  const base = SKIN_BASE[kind === 'plague' ? 4 + (k % 2) : kind === 'stone' ? 6 : k % 4];
  x.fillStyle = base; x.fillRect(0, 0, CELL, CELL);
  if (kind === 'stone') { // pierre grise fissurée et mousseuse
    blobs(x, R, 60, ['rgba(60,60,58,A)', 'rgba(170,170,162,A)', 'rgba(110,112,106,A)'], 8, 40, 0.4);
    blobs(x, R, 10, ['rgba(70,92,52,A)'], 6, 20, 0.45);
    x.strokeStyle = 'rgba(25,25,25,0.6)'; x.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) { x.beginPath(); let px = R() * CELL, py = R() * CELL; x.moveTo(px, py); for (let q = 0; q < 8; q++) { px += (R() - 0.5) * 26; py += (R() - 0.2) * 24; x.lineTo(px, py); } x.stroke(); }
    grain(x, R, 2500);
    return;
  }
  blobs(x, R, 60, ['rgba(70,90,60,A)', 'rgba(120,140,110,A)', 'rgba(60,45,70,A)', 'rgba(150,130,90,A)'], 10, 44, 0.32);
  blobs(x, R, 5, ['rgba(70,40,90,A)'], 14, 32, 0.4);                                // hématomes
  veins(x, R, 12);
  if (kind === 'plague') { // bubons : cloques jaunâtres et plaies suintantes
    for (let i = 0; i < 16; i++) { const px = R() * CELL, py = R() * CELL, r = 4 + R() * 9, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(206,196,110,0.9)'); g.addColorStop(0.7, 'rgba(150,120,60,0.8)'); g.addColorStop(1, 'rgba(60,70,30,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
    blobs(x, R, 10, ['rgba(90,110,30,A)'], 8, 26, 0.45);
  }
  for (let i = 0; i < 6; i++) { const px = R() * CELL, py = R() * CELL; x.fillStyle = 'rgba(60,20,14,0.75)'; x.beginPath(); x.ellipse(px, py, 3 + R() * 7, 2 + R() * 4, R() * 3, 0, 7); x.fill(); } // croûtes
  for (let i = 0; i < 4; i++) { const px = R() * CELL, py = R() * CELL, L = 18 + R() * 30; x.strokeStyle = 'rgba(90,10,14,0.9)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(px, py); x.lineTo(px + L * 0.4, py + (R() - 0.5) * 8); x.lineTo(px + L, py + (R() - 0.5) * 12); x.stroke(); x.strokeStyle = 'rgba(180,60,60,0.5)'; x.lineWidth = 1; x.stroke(); } // plaies
  x.fillStyle = 'rgba(100,8,8,0.7)'; for (let i = 0; i < 9; i++) x.fillRect(R() * CELL, R() * CELL * 0.5, 1.5 + R() * 2.5, 14 + R() * 60); // traînées
  grain(x, R, 3000);
}

// ---------------------------------------------------------------- visage : peint en projection plane sur le disque (u, v) = (0,5 + 0,5 x, 0,5 + 0,5 y) de la sphère unité (voir headGeometry)
// coins : (haut gauche) os des dents, (haut droite) intérieur de la bouche, (bas droite) nuque et cheveux, (bas gauche) peau du cou
function paintFace(x, k, R, kind) {
  paintSkin(x, k, R, kind === 'face' ? 'zombie' : kind);
  const U = (u) => u * CELL, V = (v) => (1 - v) * CELL; // v vers le haut
  const stone = kind === 'stone';
  // cheveux (haut du crâne et tempes), selon le visage
  if (kind === 'face' && (k === 0 || k === 3)) {
    x.fillStyle = k === 0 ? 'rgba(40,30,22,0.95)' : 'rgba(58,46,34,0.95)';
    for (let i = 0; i < 60; i++) { const px = U(0.12 + R() * 0.76), py = V(0.74 + R() * 0.26 - Math.abs(px / CELL - 0.5) * 0.45); if (py < V(0.66)) { x.beginPath(); x.ellipse(px, py, 5 + R() * 8, 3 + R() * 5, (R() - 0.5) * 1.2, 0, 7); x.fill(); } }
    x.fillStyle = 'rgba(40,30,22,0.9)'; x.fillRect(U(0.12), V(1), U(0.76), V(0.8) - V(1));
  }
  // joues creuses, pommettes
  for (const sx of [-1, 1]) {
    const g = x.createRadialGradient(U(0.5 + sx * 0.3), V(0.36), 2, U(0.5 + sx * 0.3), V(0.36), 36); g.addColorStop(0, 'rgba(20,24,16,0.5)'); g.addColorStop(1, 'rgba(20,24,16,0)'); x.fillStyle = g; x.fillRect(0, 0, CELL, CELL);
  }
  // orbites : cernes sombres, creux, yeux (les billes lumineuses sont des maillages posés dans les orbites)
  for (const sx of [-1, 1]) {
    const cx = U(0.5 + sx * 0.2), cy = V(0.6);
    let g = x.createRadialGradient(cx, cy, 2, cx, cy, 34); g.addColorStop(0, stone ? 'rgba(20,20,20,0.95)' : 'rgba(18,8,10,0.97)'); g.addColorStop(0.55, 'rgba(30,14,18,0.8)'); g.addColorStop(1, 'rgba(40,20,30,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, 34, 26, sx * 0.15, 0, 7); x.fill();
    if (kind === 'face' && k === 1 && sx > 0) { g = x.createRadialGradient(cx, cy, 4, cx, cy, 36); g.addColorStop(0, 'rgba(90,40,120,0.7)'); g.addColorStop(1, 'rgba(90,40,120,0)'); x.fillStyle = g; x.fillRect(cx - 40, cy - 40, 80, 80); } // œil au beurre noir
    if (kind === 'face' && k === 2 && sx < 0) { x.fillStyle = 'rgba(214,214,190,0.95)'; x.beginPath(); x.arc(cx, cy, 11, 0, 7); x.fill(); x.fillStyle = 'rgba(50,60,70,0.8)'; x.beginPath(); x.arc(cx + 1, cy, 4, 0, 7); x.fill(); } // cataracte
  }
  // arcades sourcilières
  x.strokeStyle = 'rgba(14,10,8,0.5)'; x.lineWidth = 6; x.lineCap = 'round';
  for (const sx of [-1, 1]) { x.beginPath(); x.moveTo(U(0.5 + sx * 0.08), V(0.71)); x.quadraticCurveTo(U(0.5 + sx * 0.2), V(0.76), U(0.5 + sx * 0.34), V(0.69)); x.stroke(); }
  // nez : arête claire, narines noires
  x.fillStyle = 'rgba(200,210,180,0.12)'; x.fillRect(U(0.485), V(0.62), U(0.03), V(0.38) - V(0.62));
  for (const sx of [-1, 1]) { x.fillStyle = 'rgba(10,4,4,0.9)'; x.beginPath(); x.ellipse(U(0.5 + sx * 0.05), V(0.39), 5, 3.5, sx * 0.5, 0, 7); x.fill(); }
  // bouche : cavité sombre, lèvres, sang aux commissures (la mâchoire est un maillage articulé)
  x.fillStyle = 'rgba(14,4,6,0.98)'; x.beginPath(); x.ellipse(U(0.5), V(0.25), 36, 12, 0, 0, 7); x.fill();
  x.strokeStyle = stone ? 'rgba(30,30,30,0.9)' : 'rgba(80,24,28,0.95)'; x.lineWidth = 3; x.beginPath(); x.ellipse(U(0.5), V(0.25), 37, 12, 0, 0, 7); x.stroke();
  if (kind === 'face' && (k === 0 || k === 3)) { x.fillStyle = 'rgba(100,6,8,0.8)'; for (const sx of [-1, 1]) { x.fillRect(U(0.5 + sx * 0.14), V(0.25), 4, V(0.08) - V(0.25)); x.beginPath(); x.ellipse(U(0.5 + sx * 0.12), V(0.12), 5, 14, 0, 0, 7); x.fill(); } }
  if (kind === 'face' && k === 1) { x.strokeStyle = 'rgba(20,12,12,0.9)'; x.lineWidth = 1.5; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(U(0.78) + i * 6, V(0.42) + i * 1); x.lineTo(U(0.78) + i * 6 + 3, V(0.42) + 14); x.stroke(); } x.strokeStyle = 'rgba(110,20,24,0.9)'; x.lineWidth = 2; x.beginPath(); x.moveTo(U(0.77), V(0.44)); x.lineTo(U(0.9), V(0.4)); x.stroke(); } // joue recousue
  if (kind === 'face' && k === 3) { x.fillStyle = 'rgba(110,8,12,0.85)'; x.beginPath(); x.ellipse(U(0.78), V(0.66), 14, 9, 0.6, 0, 7); x.fill(); x.fillStyle = 'rgba(190,100,90,0.5)'; x.beginPath(); x.ellipse(U(0.78), V(0.66), 8, 4, 0.6, 0, 7); x.fill(); } // morsure à la tempe
  if (kind === 'plague') { for (let i = 0; i < 8; i++) { const px = U(0.25 + R() * 0.5), py = V(0.25 + R() * 0.5); x.fillStyle = 'rgba(210,198,110,0.85)'; x.beginPath(); x.arc(px, py, 3 + R() * 5, 0, 7); x.fill(); } }
  // coins : os, intérieur de bouche, nuque, cou
  const patch = (u0, v0, col) => { x.fillStyle = col; x.fillRect(U(u0), V(v0), 20, 20); };
  patch(0, 1, stone ? '#8a8a84' : '#cdbf96'); patch(0.92, 1, '#1a0608'); patch(0.92, 0.07, kind === 'face' && (k === 0 || k === 3) ? '#2a2018' : (stone ? '#6a6a66' : '#586a4c')); patch(0, 0.07, stone ? '#6a6a66' : '#5a6c4e');
}

// ---------------------------------------------------------------- vêtements : hauts (6), pantalons (4), pierre, toile
const SHIRTS = [['#4a2a2a', 'plaid'], ['#2c3a4c', 'tee'], ['#4a4a38', 'hoodie'], ['#2a2a2e', 'coat'], ['#6a6258', 'shirt'], ['#3e4a3a', 'tee']];
const PANTS = [['#23262e', 'jeans'], ['#2d2a22', 'slacks'], ['#1e2a2a', 'cargo'], ['#3a3830', 'work']];
function paintCloth(x, idx, R) {
  const isShirt = idx < 6, [base, style] = isShirt ? SHIRTS[idx] : PANTS[idx - 6];
  x.fillStyle = base; x.fillRect(0, 0, CELL, CELL);
  // trame du tissu
  x.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < CELL; i += 2) { x.fillRect(i, 0, 1, CELL); x.fillRect(0, i, CELL, 1); }
  if (style === 'plaid') { x.fillStyle = 'rgba(160,50,40,0.28)'; for (let i = 0; i < CELL; i += 32) { x.fillRect(i, 0, 10, CELL); x.fillRect(0, i, CELL, 10); } x.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 16; i < CELL; i += 32) { x.fillRect(i, 0, 3, CELL); x.fillRect(0, i, CELL, 3); } }
  if (style === 'tee') { x.fillStyle = 'rgba(200,200,190,0.22)'; x.fillRect(70, 70, 116, 40); x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(80, 118, 96, 5); }
  if (style === 'hoodie') { x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 3; x.beginPath(); x.moveTo(128, 20); x.lineTo(128, 120); x.stroke(); x.strokeRect(70, 150, 116, 50); }
  if (style === 'coat') { x.fillStyle = 'rgba(200,180,120,0.55)'; for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(128, 40 + i * 34, 4, 0, 7); x.fill(); } x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, CELL); x.stroke(); }
  if (style === 'shirt') { x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, CELL); x.stroke(); x.fillStyle = 'rgba(210,205,190,0.2)'; for (let i = 0; i < 7; i++) x.fillRect(0, i * 36, CELL, 4); }
  if (style === 'jeans') { x.strokeStyle = 'rgba(210,160,70,0.5)'; x.lineWidth = 1.5; x.setLineDash([5, 4]); for (const u of [10, 118, 138, 246]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, CELL); x.stroke(); } x.setLineDash([]); }
  if (style === 'cargo') { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(150, 100, 70, 64); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2; x.strokeRect(150, 100, 70, 64); }
  if (style === 'work') { x.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 4; i++) x.fillRect(0, 20 + i * 62, CELL, 4); }
  blobs(x, R, 36, ['rgba(20,15,10,A)', 'rgba(90,80,60,A)'], 10, 44, 0.3);                  // saleté
  // déchirures : la chair apparaît, bords sanglants et effilochés
  const tears = isShirt ? 3 + (idx % 3) : 2 + (idx % 2);
  for (let t = 0; t < tears; t++) {
    const cx = 30 + R() * 196, cy = 30 + R() * 196, w = 16 + R() * 36, h = 14 + R() * 30;
    x.fillStyle = '#5c6a50'; x.beginPath(); x.moveTo(cx, cy);
    for (let q = 0; q < 9; q++) { const a = (q / 9) * Math.PI * 2, r = (q % 2 ? 0.45 : 1) * (q % 2 ? w : h) * (0.6 + R() * 0.5); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); }
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(20,24,16,0.35)'; x.fill(); // ombre au fond de la déchirure
    x.strokeStyle = 'rgba(70,5,5,0.9)'; x.lineWidth = 2.5; x.stroke();
    x.strokeStyle = 'rgba(210,200,180,0.25)'; x.lineWidth = 1; x.setLineDash([2, 3]); x.stroke(); x.setLineDash([]); // fils
  }
  // ourlet effiloché en bas
  const g = x.createLinearGradient(0, CELL * 0.62, 0, CELL); g.addColorStop(0, 'rgba(25,18,10,0)'); g.addColorStop(1, 'rgba(25,18,10,0.5)'); x.fillStyle = g; x.fillRect(0, 0, CELL, CELL);
  blobs(x, R, 6 + idx, ['rgba(110,8,8,A)', 'rgba(70,4,4,A)'], 10, 34, 0.7);          // taches de sang
  grain(x, R, 1500);
  // coin haut gauche : cuir de chaussure (les pieds sont mappés ici)
  x.fillStyle = '#16130f'; x.fillRect(0, 0, 24, 24);
}
function paintStoneCloth(x, R) { paintSkin(x, 0, R, 'stone'); x.strokeStyle = 'rgba(20,20,20,0.5)'; x.lineWidth = 2; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(0, 40 + i * 60); x.lineTo(CELL, 40 + i * 60 + (R() - 0.5) * 20); x.stroke(); } x.fillStyle = '#16130f'; x.fillRect(0, 0, 24, 24); }
function paintBurlap(x, R) { x.fillStyle = '#6a5a3a'; x.fillRect(0, 0, CELL, CELL); x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < CELL; i += 3) { x.fillRect(i, 0, 1, CELL); x.fillRect(0, i, CELL, 1); } blobs(x, R, 30, ['rgba(20,15,10,A)', 'rgba(110,90,50,A)'], 10, 40, 0.3); grain(x, R, 1500); x.fillStyle = '#16130f'; x.fillRect(0, 0, 24, 24); }

// ---------------------------------------------------------------- masque de sang (256 x 256, bruit périodique : grosses taches + coulures verticales + fines éclaboussures)
function bloodMask() {
  const N = 256, data = new Uint8Array(N * N * 4), R = rng(31337);
  const lattice = (nx, ny) => new Float32Array(nx * ny).map(() => R());
  const s = (a, nx, ny, u, v) => {
    const x = u * nx, y = v * ny, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const q = (i, j) => a[(j % ny) * nx + (i % nx)];
    return q(x0, y0) * (1 - sx) * (1 - sy) + q(x0 + 1, y0) * sx * (1 - sy) + q(x0, y0 + 1) * (1 - sx) * sy + q(x0 + 1, y0 + 1) * sx * sy;
  };
  const A = lattice(6, 6), B = lattice(22, 5), C = lattice(48, 48);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, m = 0.45 * s(A, 6, 6, u, v) + 0.32 * s(B, 22, 5, u, v) + 0.23 * s(C, 48, 48, u, v);
    const k = (j * N + i) * 4; const val = Math.max(0, Math.min(255, Math.round(((m - 0.28) / 0.5) * 255)));
    data[k] = data[k + 1] = data[k + 2] = val; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- atlas
const cellVec = (idx) => new THREE.Vector4((idx % COLS) / COLS, 1 - (Math.floor(idx / COLS) + 1) / ROWS, 1 / COLS, 1 / ROWS);
function makeAtlas(paint, seed) {
  const c = document.createElement('canvas'); c.width = CELL * COLS; c.height = CELL * ROWS;
  const x = c.getContext('2d'), R = rng(seed);
  for (let i = 0; i < COLS * ROWS; i++) {
    x.save(); x.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL); x.beginPath(); x.rect(0, 0, CELL, CELL); x.clip();
    paint(x, i, R); x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}

let SK = null;
export function skinAssets() {
  if (SK) return SK;
  const flesh = makeAtlas((x, i, R) => {
    if (i < 4) paintFace(x, i, R, 'face'); else if (i < 8) paintSkin(x, i - 4, R, 'zombie');
    else if (i === 8) paintFace(x, 0, R, 'plague'); else if (i === 9) paintSkin(x, 0, R, 'plague');
    else if (i === 10) paintFace(x, 0, R, 'stone'); else paintSkin(x, 0, R, 'stone');
  }, 1717);
  const cloth = makeAtlas((x, i, R) => { if (i < 10) paintCloth(x, i, R); else if (i === 10) paintStoneCloth(x, R); else paintBurlap(x, R); }, 2929);
  SK = { flesh, cloth, blood: bloodMask(), geo: null, bloodMat: null };
  return SK;
}

// ---------------------------------------------------------------- matériau de zombie : cellule d'atlas (uCell) + sang (uBlood)
// Tous partagent le même programme (customProgramCacheKey) ; seules les valeurs d'uniformes diffèrent. Le matériau reste un MeshStandardMaterial
// ordinaire (color, emissive, roughness… restent modifiables par boss.js, tanner.js, le flash de dégâts et les cendres de l'Aube).
export function zombieMaterial(atlas, cell, blood0 = 0) {
  const S = skinAssets();
  const m = new THREE.MeshStandardMaterial({ map: atlas, bumpMap: atlas, bumpScale: 0.8, roughness: 0.85 });
  m.userData.uCell = { value: cellVec(cell) };
  m.userData.uBlood = { value: blood0 };
  m.userData.uBSeed = { value: new THREE.Vector2(Math.random(), Math.random()) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCell = m.userData.uCell; sh.uniforms.uBlood = m.userData.uBlood; sh.uniforms.uBSeed = m.userData.uBSeed; sh.uniforms.tBlood = { value: S.blood };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uCell; varying vec2 vLUv; varying vec3 vOP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLUv = uv; vOP = position;\n#ifdef USE_MAP\nvMapUv = uv * uCell.zw + uCell.xy;\n#endif\n#ifdef USE_BUMPMAP\nvBumpMapUv = uv * uCell.zw + uCell.xy;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tBlood; uniform float uBlood; uniform vec2 uBSeed; varying vec2 vLUv; varying vec3 vOP;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bl = 0.0;
        if (uBlood > 0.001) {
          float bm = texture2D(tBlood, vLUv * vec2(1.6, 1.3) + uBSeed + vOP.xy * 5.0 + vOP.zz * vec2(3.1, 4.3)).r;
          float th = 0.97 - 0.52 * uBlood;
          bl = smoothstep(th, th + 0.09, bm);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.008, 0.01) * (0.65 + 0.7 * bm), bl * 0.94);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.4, bl);');
  };
  m.customProgramCacheKey = () => 'zombie-skin-v1';
  return m;
}
export const setCell = (m, cell) => m.userData.uCell.value.copy(cellVec(cell));

// ---------------------------------------------------------------- géométries
// UV plane d'un point de la tête (repère de la tête, avant = +z) : disque de la face dans la cellule ; à l'arrière on glisse vers le coin « nuque »
const HEAD = { cy: 0.04, rx: 0.112, ry: 0.122, rz: 0.12, cut: -0.55 };
function faceUv(x, y, z) {
  const nx = x / HEAD.rx, ny = (y - HEAD.cy) / HEAD.ry;
  const u = 0.5 + 0.5 * nx, v = 0.5 + 0.5 * ny;
  if (z >= 0) return [u, v];
  const k = Math.min(1, -z / 0.07), s = k * k * (3 - 2 * k);
  return [u + (0.955 - u) * s, v + (0.045 - v) * s];
}
const CORNER = { bone: [0.035, 0.965], mouth: [0.5, 0.25], nape: [0.96, 0.04], neck: [0.035, 0.04] }; // mouth : centre de la cavité peinte (sombre)
const gauss = (d2, s) => Math.exp(-d2 / (2 * s * s));

function toGeo(geo, uvFn) { // sphère / cylindre indexé -> non indexé avec UV recalculées (uvFn(x, y, z, i) -> [u, v])
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const r = uvFn(p.getX(i), p.getY(i), p.getZ(i), i); uv.setXY(i, r[0], r[1]); }
  return g;
}
const setUvAll = (g, uv) => { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, uv[0], uv[1]); return g; };

function headGeometry() {
  const s = new THREE.SphereGeometry(1, 30, 22), p = s.attributes.position, n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i);
    let { x, y, z } = n; // direction unité
    const taper = THREE.MathUtils.smoothstep(-y, -0.15, 0.75);
    let rx = HEAD.rx * (1 - 0.14 * taper), rz = HEAD.rz * (1 - 0.1 * taper), ry = HEAD.ry;
    let out = 0;
    // arcades, orbites, nez, joues
    out += 0.012 * gauss((y - 0.34) ** 2 + (Math.abs(x) - 0.38) ** 2 * 0.4, 0.2) * (z > 0.2 ? 1 : 0);
    for (const sx of [-1, 1]) {
      out -= 0.024 * gauss((x - sx * 0.4) ** 2 + (y - 0.17) ** 2 + (z - 0.9) ** 2, 0.2);                 // orbites
      out -= 0.012 * gauss((x - sx * 0.56) ** 2 + (y + 0.22) ** 2 + (z - 0.78) ** 2, 0.2);                // joues creuses
      out += 0.01 * gauss((x - sx * 0.68) ** 2 + (y - 0.0) ** 2 + (z - 0.7) ** 2, 0.17);                  // pommettes
    }
    out += 0.026 * gauss(x ** 2 + (y + 0.08) ** 2 * 0.25 + (z - 1) ** 2, 0.18);                          // arête du nez
    out += 0.03 * gauss(x ** 2 + (y + 0.34) ** 2 + (z - 0.95) ** 2, 0.16);                               // bout du nez
    let X = x * (rx + out), Z = z * (rz + out), Y = HEAD.cy + y * (ry + out * 0.6);
    let uv;
    if (y < HEAD.cut) { Y = HEAD.cy + HEAD.cut * ry; uv = CORNER.mouth; } // dessous plat : le toit de la bouche
    else uv = faceUv(X, Y, Z);
    p.setXYZ(i, X, Y, Z); s.attributes.uv.setXY(i, uv[0], uv[1]);
  }
  s.computeVertexNormals();
  const parts = [s.toNonIndexed()];
  // dents du haut : rangée en arc sous le toit de la bouche
  const tooth = (w, h, d, x, y, z, ry = 0, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); setUvAll(g, CORNER.bone); g.rotateX(rx).rotateY(ry).translate(x, y, z); return g; };
  const yTop = HEAD.cy + HEAD.cut * HEAD.ry;
  for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.0; parts.push(tooth(0.0125, 0.014 + (i % 2) * 0.004, 0.008, Math.sin(a) * 0.062, yTop - 0.006, Math.cos(a) * 0.07 - 0.0, a)); }
  parts.push(tooth(0.011, 0.024, 0.008, -0.03, yTop - 0.011, 0.07, 0, 0.1)); // une canine cassée
  // oreilles
  for (const sx of [-1, 1]) { const g = new THREE.SphereGeometry(1, 8, 6).scale(0.011, 0.028, 0.02).translate(sx * 0.1, 0.03, -0.01).toNonIndexed(); setUvAll(g, CORNER.nape); parts.push(g); }
  // cou
  { const g = new THREE.CylinderGeometry(0.05, 0.064, 0.1, 10, 1, true).translate(0, -0.098, -0.03).toNonIndexed(); setUvAll(g, CORNER.neck); parts.push(g); }
  const out = mergeGeometries(parts); parts.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

// mâchoire articulée : pivot en (0, yTop, 0) du repère de la tête ; auge de peau, rangée de dents, intérieur sombre
function jawGeometry() {
  const yTop = HEAD.cy + HEAD.cut * HEAD.ry, parts = [];
  const bowl = new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.074, 0.047, 0.084).translate(0, 0, 0.004);
  const g = toGeo(bowl, (x, y, z) => faceUv(x, yTop + y, z));
  parts.push(g);
  const cap = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2).scale(0.07, 1, 0.08).translate(0, 0.001, 0.004).toNonIndexed(); setUvAll(cap, CORNER.mouth); parts.push(cap);
  for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.0, t = new THREE.BoxGeometry(0.012, 0.013 + (i % 3 === 1 ? 0.005 : 0), 0.008).toNonIndexed(); setUvAll(t, CORNER.bone); t.rotateY(a).translate(Math.sin(a) * 0.06, 0.006, Math.cos(a) * 0.07); parts.push(t); }
  const out = mergeGeometries(parts); parts.forEach((q) => q.dispose());
  return out;
}

// main : paume aplatie et trois griffes (un seul maillage)
function handGeometry() {
  const parts = [new THREE.SphereGeometry(0.05, 10, 8).scale(0.9, 1.15, 0.65).toNonIndexed()];
  for (let i = 0; i < 3; i++) { const f = new THREE.CapsuleGeometry(0.0095, 0.05, 2, 5); f.rotateZ((i - 1) * 0.22).translate((i - 1) * 0.026, -0.085, 0.004); parts.push(f.index ? f.toNonIndexed() : f); }
  const th = new THREE.CapsuleGeometry(0.01, 0.04, 2, 5); th.rotateZ(-0.9).translate(-0.045, -0.04, 0.008); parts.push(th.index ? th.toNonIndexed() : th);
  const out = mergeGeometries(parts); parts.forEach((q) => q.dispose());
  return out;
}

export function zombieGeometries() {
  const S = skinAssets();
  if (S.geo) return S.geo;
  const nl = (g) => (g.index ? g.toNonIndexed() : g);
  const shoe = nl(new THREE.CapsuleGeometry(0.052, 0.12, 3, 8).rotateX(Math.PI / 2).scale(1, 0.72, 1).translate(0, -0.46, 0.07));
  setUvAll(shoe, [0.02, 0.98]);
  const shin = nl(new THREE.CapsuleGeometry(0.065, 0.3, 3, 9)).translate(0, -0.22, 0);
  const foreArm = nl(new THREE.CapsuleGeometry(0.045, 0.2, 3, 8)).translate(0, -0.16, 0), hand = handGeometry().translate(0, -0.37, 0);
  S.geo = {
    torso: new THREE.CapsuleGeometry(0.16, 0.3, 5, 12),
    pelvis: new THREE.CapsuleGeometry(0.14, 0.08, 3, 9),
    head: headGeometry(), jaw: jawGeometry(),
    eye: new THREE.SphereGeometry(0.017, 8, 6),
    thigh: new THREE.CapsuleGeometry(0.08, 0.3, 3, 9),
    shinFoot: mergeGeometries([shin, shoe]),
    upperArm: new THREE.CapsuleGeometry(0.052, 0.2, 3, 8),
    foreHand: mergeGeometries([foreArm, nl(hand)]),
    hitHead: new THREE.SphereGeometry(0.3, 8, 6),
    hitBody: new THREE.BoxGeometry(1.0, 1.65, 0.8),
  };
  return S.geo;
}

export function skinTextures() { const S = skinAssets(); return [S.flesh, S.cloth, S.blood]; }
