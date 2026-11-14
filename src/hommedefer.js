import * as THREE from 'three';
import { halberdierGeometries, mergeParts } from './ironArmor.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Place de l'Homme de Fer (Strasbourg) : rotonde de verre du tram, abris de quai, rails, quais, rames Eurotram
//  à l'arrêt, totems et statue de l'Homme de Fer.
//  Décor 100 % déterministe : aucun Math.random, toutes les machines construisent exactement le même décor.
//  Trois temps, comme le reste du monde réel (voir realworld.js) :
//    planHdf            : phase des colonnes de la rotonde, d'après les voies de CONFIG.tram (v0.38.0 : plus de recherche par rayons)
//    buildHdfStructures : rotonde et abris (avant la grille de collision définitive : colonnes et abris bloquent)
//    buildHdfDecor      : quais et rames de décor posés sur les voies (les rails sont dessinés par tramNet.js), totems, statue (une fois les zones
//                         et les machines placées)
//  Matériaux nouveaux : verre, fer (statue), laiton (statue), acier (structures, quais, rails, pièces sombres des rames),
//  livrée (rames et totems, un seul atlas). Aucune PointLight : seulement des entrées `lightSources`.
// =====================================================================

export const HDF = {
  zone: 'Homme de Fer',
  rotunda: { height: 9, thickness: 0.35, holeRatio: 0.45, colRadius: 0.22, colCircle: 12.5, columns: 12, ribs: 24 },
  shelterHeight: 3,
  // Statue : angle sud-ouest de la façade ouest d'un immeuble (nœud OSM tourism=artwork), normale extérieure
  statue: { x: -267.7, z: -171.5, nx: -0.98, nz: 0.18, offset: 0.35, scale: 0.9, consoleTop: 2.15 },
  tram: { module: 4.7, body: 4.4, width: 2.4, height: 3.4, floor: 0.32, minReach: 14, maxReach: 60, side: 1.5 },
};

// Un `building=roof` en l'air (min_height >= 2,5 m) : la rotonde du tram. Les verrières posées au sol (sans min_height) restent
// de simples bâtiments.
export const isRotunda = (tags) => tags.building === 'roof' && (parseFloat(tags.min_height) || 0) >= 2.5;

// Abri de quai sans hauteur ni niveaux dans OSM : l'extraction lui a tiré une hauteur d'immeuble au hasard (12 à 18 m).
// v0.33.0 : aussi les abris vitrés de plain-pied (building:levels = 1, building:material = glass : arrêts de bus et de tram de 4,7 m, 51 dans l'île),
// qui étaient rendus et bloqués comme des immeubles pleins.
export const isOpenShelter = (tags) => tags.amenity === 'shelter' && tags.height == null && !isRotunda(tags)
  && (tags['building:levels'] == null || (tags['building:material'] === 'glass' && (parseFloat(tags['building:levels']) || 1) <= 1));

// Aléatoire reproductible (textures et salissures)
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ géométrie : petits outils
const colorize = (g, hex) => {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
// Boîte colorée : dimensions, centre, rotation autour de y
const boxAt = (w, h, d, x, y, z, color, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return colorize(g, color); };
// UV en mètres (le verre est une texture de 8 m de côté) pour un panneau de direction (ux, uz)
const metricUV = (g, ux, uz) => {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * ux + p.getZ(i) * uz, p.getY(i));
  return g;
};

// ------------------------------------------------------------------ matériaux (créés une fois)
let MATS = null;
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function mats() {
  if (MATS) return MATS;
  // verre : carreaux et montants (cellules de 2 m, texture de 8 m)
  const glassTex = canvasTex(512, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const g = x.createLinearGradient(i * 128, j * 128, i * 128 + 128, j * 128 + 128);
      g.addColorStop(0, 'rgba(205,236,244,0.95)'); g.addColorStop(0.5, 'rgba(160,205,220,0.8)'); g.addColorStop(1, 'rgba(190,226,238,0.9)');
      x.fillStyle = g; x.fillRect(i * 128, j * 128, 128, 128);
    }
    x.strokeStyle = 'rgba(32,38,44,1)'; x.lineWidth = 12;
    for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 128, 0); x.lineTo(k * 128, h); x.moveTo(0, k * 128); x.lineTo(w, k * 128); x.stroke(); }
  });
  glassTex.wrapS = glassTex.wrapT = THREE.RepeatWrapping;
  glassTex.repeat.set(1 / 8, 1 / 8);
  MATS = {
    glass: new THREE.MeshStandardMaterial({ map: glassTex, color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.85, roughness: 0.4, emissive: 0x14161a }), // un peu d'émission : sans reflets (pas d'envmap) un métal sombre serait noir pur
    brass: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.8, roughness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6 }),
  };
  return MATS;
}

// ------------------------------------------------------------------ plan : phase des colonnes de la rotonde
function ringInfo(pts) {
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x / n; cz += z / n; }
  let R = 0;
  for (const [x, z] of pts) R += Math.hypot(x - cx, z - cz) / n;
  return { cx, cz, R };
}

export const rotundaInfo = (pts) => ({ pts, ...ringInfo(pts) });

// Plan de la place (v0.38.0) : les voies viennent de CONFIG.tram (réseau tracé à la main : A / D à 64° sous la rotonde, B / C / F dans la rue
// est-ouest au nord de la place) et la phase des colonnes de la rotonde de CONFIG.tram.hdf.colPhase (plus de recherche par lancers de rayons).
// columnGap : distance minimale (m) entre une colonne et l'axe d'une voie, pour les outils de mesure et l'avertissement du mode ?debug.
// net : planTram().
export function planHdf(net, cx, cz) {
  const H = CONFIG.tram.hdf, step = 360 / HDF.rotunda.columns;
  let gap = Infinity;
  for (let k = 0; k < HDF.rotunda.columns; k++) {
    const a = ((H.colPhase + k * step) * Math.PI) / 180;
    gap = Math.min(gap, net.dist(cx + Math.cos(a) * HDF.rotunda.colCircle, cz + Math.sin(a) * HDF.rotunda.colCircle, 30));
  }
  if (gap < H.columnGap && typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) console.warn(`[tram] colonne de la rotonde à ${gap.toFixed(2)} m d'une voie (minimum ${H.columnGap} m)`);
  return { net, colPhase: H.colPhase, columnGap: gap, cx, cz };
}

// Distance d'un point au rail le plus proche du réseau (m), Infinity au-delà de 40 m : les machines, les armes murales, le décor et les
// arbres ne se posent pas sur les rails (v0.38.0 : toutes les polylignes de CONFIG.tram.lines, plus seulement les deux axes de la place)
export function railDist(plan, x, z) { return plan.net.dist(x, z, 40); }

// Distance aux deux anciens axes de rails (60° et 110°, portée 42 m) des versions d'avant la v0.38.0. Elle ne sert plus qu'à garder le tirage
// des emplacements (machines, armes murales, bornes) des zones `outer` et de l'Homme de Fer identique à celui des versions précédentes : le
// filtre d'origine est conservé tel quel, le filtre sur le réseau actuel passe après le tirage (voir spotIn dans realworld.js).
const LEGACY_AXES = [60, 110].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)]);
export function legacyRailDist(plan, x, z) {
  let m = Infinity;
  for (const [ux, uz] of LEGACY_AXES) {
    const s = (x - plan.cx) * ux + (z - plan.cz) * uz, lat = Math.abs(-(x - plan.cx) * uz + (z - plan.cz) * ux);
    if (s > -42 && s < 42) m = Math.min(m, lat);
  }
  return m;
}

// ------------------------------------------------------------------ abris : rectangle orienté, dos du côté extérieur
export function shelterInfo(pts, from) {
  const { cx, cz } = ringInfo(pts);
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l > best) { best = l; ux = (bx - ax) / l; uz = (bz - az) / l; }
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const len = u1 - u0, dep = v1 - v0;
  const mx = cx + (ux * (u0 + u1)) / 2 - (uz * (v0 + v1)) / 2, mz = cz + (uz * (u0 + u1)) / 2 + (ux * (v0 + v1)) / 2;
  const away = (mx - from[0]) * -uz + (mz - from[1]) * ux; // le dos est du côté opposé à la place
  return { x: mx, z: mz, ux, uz, len, dep, back: away >= 0 ? 1 : -1 };
}

// ------------------------------------------------------------------ rotonde et abris
const meshOf = (scene, geo, mat, { shadow = false, receive = false, name = 'hdf' } = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = receive; m.name = 'hdf:' + name;
  scene.add(m);
  return m;
};

// rotundas : [{ pts, cx, cz, R }] ; shelters : [shelterInfo] ; plan : planHdf (phase des colonnes)
export function buildHdfStructures({ scene, collision, lightSources, rotundas, shelters, plan }) {
  const M = mats(), C = HDF.rotunda;
  const out = { columns: [], rotundas: [], shelters: [] };
  const steel = []; // pièces d'acier (sommets colorés)

  for (const r of rotundas) {
    // colonnes (seule la rotonde sauf ses colonnes reste praticable : la place doit rester libre sous le verre)
    const cols = [];
    for (let k = 0; k < C.columns; k++) {
      const a = ((plan.colPhase + (k * 360) / C.columns) * Math.PI) / 180;
      const colX = r.cx + Math.cos(a) * C.colCircle, colZ = r.cz + Math.sin(a) * C.colCircle;
      // Sécurité absolue : aucun pilier ne doit empiéter sur les voies ou aiguillages du tram
      if (plan.net && plan.net.dist(colX, colZ, 30) < 2.6) continue;
      cols.push([colX, colZ, a]);
    }
    for (const [x, z] of cols) collision.addCircle(x, z, C.colRadius, C.height, -Infinity, 'wall'); // colonne : architecture
    out.columns.push(...cols.map(([x, z]) => [x, z]));
    out.rotundas.push({ cx: r.cx, cz: r.cz, R: r.R });

    // anneau de verre : forme extérieure = contour OSM, trou à 0,45 R, entre 8,65 et 9 m
    const shape = new THREE.Shape(r.pts.map(([x, z]) => new THREE.Vector2(x - r.cx, z - r.cz)));
    shape.holes.push(new THREE.Path(r.pts.map(([x, z]) => new THREE.Vector2((x - r.cx) * C.holeRatio, (z - r.cz) * C.holeRatio))));
    const glass = new THREE.ExtrudeGeometry(shape, { depth: C.thickness, bevelEnabled: false });
    glass.rotateX(Math.PI / 2); // (x, y, z) -> (x, -z, y) : l'épaisseur descend de 9 m
    glass.translate(r.cx, C.height, r.cz);
    meshOf(scene, glass, M.glass, { name: 'rotunda-glass' }); // castShadow off : le verre ne fait pas d'ombre

    // nervures radiales sous le verre (24) et colonnes (12) : InstancedMesh
    const rIn = r.R * C.holeRatio, rOut = r.R - 0.35, len = rOut - rIn;
    const ribGeo = colorize(new THREE.BoxGeometry(1, 1, 1), 0x8d969e);
    const ribs = new THREE.InstancedMesh(ribGeo, M.steel, C.ribs);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(len, 0.2, 0.14), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < C.ribs; k++) {
      const a = ((plan.colPhase + (k * 360) / C.ribs) * Math.PI) / 180, rm = (rIn + rOut) / 2;
      q.setFromAxisAngle(up, -a);
      m4.compose(new THREE.Vector3(r.cx + Math.cos(a) * rm, C.height - C.thickness - 0.1, r.cz + Math.sin(a) * rm), q, sc);
      ribs.setMatrixAt(k, m4);
    }
    ribs.frustumCulled = false; ribs.instanceMatrix.needsUpdate = true;
    ribs.name = 'hdf:ribs'; scene.add(ribs);
    const colGeo = mergeParts([
      new THREE.CylinderGeometry(C.colRadius, C.colRadius * 1.15, C.height - C.thickness - 0.2, 10).translate(0, (C.height - C.thickness - 0.2) / 2 + 0.2, 0),
      new THREE.CylinderGeometry(C.colRadius * 1.6, C.colRadius * 1.6, 0.2, 10).translate(0, 0.1, 0),
      new THREE.CylinderGeometry(C.colRadius * 1.5, C.colRadius * 1.5, 0.16, 10).translate(0, C.height - C.thickness - 0.28, 0),
    ], 0x8d969e);
    const colMesh = new THREE.InstancedMesh(colGeo, M.steel, cols.length);
    cols.forEach(([x, z], k) => { m4.makeTranslation(x, 0, z); colMesh.setMatrixAt(k, m4); });
    colMesh.castShadow = true; colMesh.frustumCulled = false; colMesh.instanceMatrix.needsUpdate = true;
    colMesh.name = 'hdf:columns'; scene.add(colMesh);
    // couronne intérieure (autour du trou)
    const crown = new THREE.TorusGeometry(rIn, 0.1, 6, 40); crown.rotateX(Math.PI / 2); crown.translate(r.cx, C.height - C.thickness - 0.1, r.cz);
    steel.push(colorize(crown, 0x8d969e));
    // 6 sources de lumière froide sous le verre (réparties dans `lightSources`, aucune PointLight en plus)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      lightSources.push({ x: r.cx + Math.cos(a) * 10, y: 8.1, z: r.cz + Math.sin(a) * 10, color: 0xcfe6ff, intensity: 20, dist: 16 });
    }
  }

  // abris de quai : panneau vitré au dos, toit, poteaux, banc. Collision : panneau arrière et poteaux
  const glassParts = [];
  const ironShelter = [];
  for (const s of shelters) {
    const H = HDF.shelterHeight, nz = s.back; // z local = côté du dos (le repère local a +z = (-uz, ux))
    const theta = Math.atan2(-s.uz, s.ux);
    const place = (g) => { g.rotateY(theta); g.translate(s.x, 0, s.z); return g; };
    const panel = new THREE.BoxGeometry(s.len - 0.2, 2.4, 0.04); panel.translate(0, 1.3, nz * (s.dep / 2 - 0.08));
    glassParts.push(metricUV(place(panel), s.ux, s.uz));
    const add = (w, h, d, x, y, z, col) => ironShelter.push(place(boxAt(w, h, d, x, y, z, col)));
    add(s.len + 0.5, 0.1, s.dep + 0.4, 0, H - 0.05, 0, 0x4e565e);                     // toit
    add(s.len + 0.5, 0.14, 0.08, 0, H - 0.17, nz * (s.dep / 2 + 0.16), 0x4e565e);    // chéneau
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.1, H, 0.1, sx * (s.len / 2 - 0.15), H / 2, sz * (s.dep / 2 - 0.15), 0x5a636b); // 4 poteaux
    const n = Math.max(1, Math.round(s.len / 3));
    for (let k = 1; k < n; k++) add(0.06, 2.5, 0.06, -s.len / 2 + (s.len * k) / n, 1.3, nz * (s.dep / 2 - 0.08), 0x5a636b); // montants du panneau
    add(s.len, 0.08, 0.08, 0, 0.1, nz * (s.dep / 2 - 0.08), 0x5a636b);                // soubassement
    add(s.len * 0.5, 0.05, 0.4, 0, 0.45, nz * (s.dep / 2 - 0.4), 0x7a5a38);           // banc
    for (const sx of [-1, 1]) add(0.05, 0.42, 0.34, sx * s.len * 0.22, 0.22, nz * (s.dep / 2 - 0.4), 0x4e565e);
    out.shelters.push({ x: s.x, z: s.z });
  }
  if (glassParts.length) meshOf(scene, mergeParts(glassParts), M.glass, { name: 'shelter-glass' });
  steel.push(...ironShelter);
  if (steel.length) meshOf(scene, mergeParts(steel), M.steel, { shadow: true, receive: true, name: 'structures' });

  for (const s of shelters) { // collision : panneau arrière et deux poteaux
    const nx = -s.uz * s.back, nz = s.ux * s.back;
    const bx = s.x + (nx * s.dep) / 2, bz = s.z + (nz * s.dep) / 2;
    collision.addSegment(bx - (s.ux * s.len) / 2, bz - (s.uz * s.len) / 2, bx + (s.ux * s.len) / 2, bz + (s.uz * s.len) / 2, HDF.shelterHeight, -Infinity, 'prop'); // abri vitré : objet
    for (const k of [-1, 1]) collision.addCircle(s.x - (nx * s.dep) / 2 + s.ux * k * (s.len / 2 - 0.15), s.z - (nz * s.dep) / 2 + s.uz * k * (s.len / 2 - 0.15), 0.1, HDF.shelterHeight, -Infinity, 'prop');
  }
  return out;
}

// ====================================================================================================================
//  Rames Eurotram / Citadis CTS Strasbourg : caisse galbée étanche, nez panoramique incliné, cockpit détaillé, soufflets
// ====================================================================================================================
const YC = 1.85;
// Profil du côté +z, du bas (plancher) au sommet du toit, puis symétrique : [y, z]
const HALF = [[0.32, 1.2], [0.65, 1.2], [1.12, 1.2], [1.6, 1.2], [2.1, 1.2], [2.42, 1.2], [2.95, 1.2], [3.14, 1.03], [3.29, 0.62], [3.37, 0.0]];
const RING = [...HALF, ...HALF.slice(0, -1).reverse().map(([y, z]) => [y, -z])];
const ROOF_RING = RING.slice(5, 14); // toiture et bandeau supérieur au-dessus des baies et portes (y >= 2.42)
const LOWER_R = [[0.32, 1.2], [0.65, 1.2], [1.12, 1.2]];
const LOWER_L = [[1.12, -1.2], [0.65, -1.2], [0.32, -1.2]];
const WIN_R = [[1.12, 1.2], [1.6, 1.2], [2.1, 1.2], [2.42, 1.2]];
const WIN_L = [[2.42, -1.2], [2.1, -1.2], [1.6, -1.2], [1.12, -1.2]];
const WALL_TOP = 2.95;
const LIVERY_M = 33; // longueur (m) couverte par la largeur de la livrée

const tClamp = (y) => (y > WALL_TOP + 0.001 ? 0.985 : 0.02 + ((y - 0.32) / (WALL_TOP - 0.32)) * 0.93);
// canvas : ordonnée de la livrée (haut du canvas = toit) pour une hauteur y (m)
const liveryY = (y) => 256 - tClamp(y) * 256;

function sweepProfile(ring, stations, uvFn, colorHex = null, twoSided = false) {
  const pos = [], uv = [], idx = [];
  const n = ring.length;
  for (const st of stations) for (const [y, z] of ring) {
    const yy = st.yScale === false ? y : YC + (y - YC) * st.s, zz = z * st.s;
    pos.push(st.x, yy, zz);
    uv.push(...uvFn(st.x, yy, zz, st));
  }
  for (let i = 0; i + 1 < stations.length; i++) for (let j = 0; j + 1 < n; j++) {
    const a = i * n + j, b = a + 1, c = (i + 1) * n + j + 1, d = (i + 1) * n + j;
    idx.push(a, c, b, a, d, c);
    if (twoSided) idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return colorHex == null ? g : colorize(g, colorHex);
}

function sweep(stations, uvFn, colorHex = null, twoSided = false) {
  return sweepProfile(RING, stations, uvFn, colorHex, twoSided);
}

// Constructeur de maillage surfacique avec orientation automatique des normales suivant une direction cible outDir = [nx, ny, nz]
function makeMeshBuilder(uvFn = () => [0, 0]) {
  const pos = [], uv = [], idx = [];
  const addV = (x, y, z, uOverride = null, vOverride = null) => {
    const k = pos.length / 3;
    pos.push(x, y, z);
    if (uOverride != null && vOverride != null) uv.push(uOverride, vOverride);
    else uv.push(...uvFn(x, y, z));
    return k;
  };
  const quad = (p0, p1, p2, p3, outDir = [0, 1, 0]) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * outDir[0] + ny * outDir[1] + nz * outDir[2];
    const a = addV(...p0), b = addV(...p1), c = addV(...p2), d = addV(...p3);
    if (dot >= 0) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  };
  const quadUV = (p0, p1, p2, p3, uv0, uv1, uv2, uv3, outDir = [0, 1, 0]) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * outDir[0] + ny * outDir[1] + nz * outDir[2];
    const a = addV(p0[0], p0[1], p0[2], uv0[0], uv0[1]);
    const b = addV(p1[0], p1[1], p1[2], uv1[0], uv1[1]);
    const c = addV(p2[0], p2[1], p2[2], uv2[0], uv2[1]);
    const d = addV(p3[0], p3[1], p3[2], uv3[0], uv3[1]);
    if (dot >= 0) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  };
  const build = (colorHex = null) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return colorHex == null ? g : colorize(g, colorHex);
  };
  return { quad, quadUV, build, hasGeom: () => idx.length > 0 };
}

// Un cylindre (ou prisme) entre deux points 3D
function strut(a, b, r, color, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return colorize(g, color);
}

// Soufflet d'intercirculation étanche (double paroi + anneaux de jonction + pont de plancher + plafond)
function buildBellows(xA, xB) {
  const xm = (xA + xB) / 2, dx = (xB - xA) / 4;
  const stOut = [
    { x: xA, s: 0.98, yScale: false },
    { x: xA + dx, s: 0.92, yScale: false },
    { x: xm, s: 0.96, yScale: false },
    { x: xB - dx, s: 0.92, yScale: false },
    { x: xB, s: 0.98, yScale: false },
  ];
  const stIn = [
    { x: xB, s: 0.94, yScale: false },
    { x: xB - dx, s: 0.89, yScale: false },
    { x: xm, s: 0.92, yScale: false },
    { x: xA + dx, s: 0.89, yScale: false },
    { x: xA, s: 0.94, yScale: false },
  ];
  const parts = [
    sweep(stOut, () => [0, 0], 0x16191e, false),
    sweep(stIn, () => [0, 0], 0x1e2228, false),
    // Cadres annulaires d'étanchéité aux extrémités des modules
    boxAt(0.06, 2.75, 0.14, xA + 0.02, 1.70, 1.15, 0x1e2228),
    boxAt(0.06, 2.75, 0.14, xA + 0.02, 1.70, -1.15, 0x1e2228),
    boxAt(0.06, 2.75, 0.14, xB - 0.02, 1.70, 1.15, 0x1e2228),
    boxAt(0.06, 2.75, 0.14, xB - 0.02, 1.70, -1.15, 0x1e2228),
    boxAt(0.08, 0.42, 2.32, xA + 0.02, 3.16, 0, 0x1e2228),
    boxAt(0.08, 0.42, 2.32, xB - 0.02, 3.16, 0, 0x1e2228),
    // Plateau d'intercirculation au sol et arche de plafond
    boxAt(xB - xA + 0.14, 0.035, 2.22, xm, 0.338, 0, 0x262a30),
    boxAt(xB - xA + 0.14, 0.045, 2.06, xm, 2.97, 0, 0x262a30),
  ];
  return parts;
}

// Nez aérodynamique complet Eurotram / Citadis (étanche dedans/dehors, pare-brise panoramique, vitres de cabine, phares et girouette intégrés)
function buildTramNose(dir, xs, NOSE, sideUV, noseUV, isCar) {
  const bodyParts = [], darkParts = [], glassParts = [];
  // On utilise sideUV pour que les bandes de livrée (gris clair, liseré, toit) se prolongent sans raccord sur le nez
  const bodyM = makeMeshBuilder((x, y) => sideUV(x, y));
  const skirtM = makeMeshBuilder();
  const innerM = makeMeshBuilder();
  const dashM = makeMeshBuilder();
  const ceilM = makeMeshBuilder();
  const floorM = makeMeshBuilder();
  const glassM = makeMeshBuilder((x, y, z) => [0.5 + z * 0.4, (y - 0.9) / 1.6]);

  // Courbes maîtresses du nez : t in [0..1] de xs jusqu'à la pointe avant
  const wAt = (t) => 1.20 * (1 - 0.34 * t * t);
  const yBelt = (t) => 1.12 - 0.22 * t;
  const xAt = (t) => xs + dir * NOSE * t;
  // Galbe frontal (à t = 1) pour u in [-1..1]
  const wTip = wAt(1);
  const xTipAt = (u) => xs + dir * (NOSE + 0.16 * (1 - u * u));
  const zTipAt = (u) => u * wTip;

  // 1. Flancs inférieurs du nez (t = 0..1, de y = 0.30 à yBelt(t)) + doublage intérieur étanche
  const N_SIDE = 8;
  for (let k = 0; k < N_SIDE; k++) {
    const t0 = k / N_SIDE, t1 = (k + 1) / N_SIDE;
    const x0 = xAt(t0), x1 = xAt(t1);
    const w0 = wAt(t0), w1 = wAt(t1);
    const yb0 = yBelt(t0), yb1 = yBelt(t1);
    const wi0 = w0 - 0.05, wi1 = w1 - 0.05;

    for (const sd of [-1, 1]) {
      // Jupe basse sombre extérieure (0.30..0.64)
      skirtM.quad([x0, 0.30, sd * w0], [x1, 0.30, sd * w1], [x1, 0.64, sd * w1], [x0, 0.64, sd * w0], [dir * 0.2, 0, sd]);
      // Ceinture de caisse peinte extérieure (0.64..yBelt)
      bodyM.quad([x0, 0.64, sd * w0], [x1, 0.64, sd * w1], [x1, yb1, sd * w1], [x0, yb0, sd * w0], [dir * 0.2, 0, sd]);
      // Paroi intérieure de cabine (0.33..yBelt) + tablette d'appui supérieure
      innerM.quad([x0, 0.33, sd * wi0], [x1, 0.33, sd * wi1], [x1, yb1, sd * wi1], [x0, yb0, sd * wi0], [-dir * 0.2, 0, -sd]);
      innerM.quad([x0, yb0, sd * wi0], [x1, yb1, sd * wi1], [x1, yb1, sd * w1], [x0, yb0, sd * w0], [0, 1, 0]);
    }
    // Dessous étanche (y = 0.30, normale vers le bas), plancher de cabine (y = 0.34) et plage avant continue (y = 0.89..0.90)
    floorM.quad([x0, 0.30, -w0], [x1, 0.30, -w1], [x1, 0.30, w1], [x0, 0.30, w0], [0, -1, 0]);
    innerM.quad([x0, 0.34, -wi0], [x1, 0.34, -wi1], [x1, 0.34, wi1], [x0, 0.34, wi0], [0, 1, 0]);
    dashM.quad([x0, 0.895, -wi0], [x1, 0.895, -wi1], [x1, 0.895, wi1], [x0, 0.895, wi0], [0, 1, 0]);
  }

  // 2. Bouclier frontal galbé (autour de t = 1, u in [-1..1]) : pare-chocs, calandre, phares LED, plage avant
  const N_ARC = 10;
  for (let k = 0; k < N_ARC; k++) {
    const u0 = -1 + (2 * k) / N_ARC, u1 = -1 + (2 * (k + 1)) / N_ARC;
    const x0 = xTipAt(u0), x1 = xTipAt(u1);
    const z0 = zTipAt(u0), z1 = zTipAt(u1);
    const xb0 = x0 + dir * 0.035, xb1 = x1 + dir * 0.035;
    const xi0 = x0 - dir * 0.05, xi1 = x1 - dir * 0.05;

    // Pare-chocs inférieur anti-encastrement (0.30..0.56)
    skirtM.quad([xb0, 0.30, z0], [xb1, 0.30, z1], [xb1, 0.56, z1], [xb0, 0.56, z0], [dir, 0, (u0 + u1) * 0.3]);
    skirtM.quad([x0, 0.56, z0], [x1, 0.56, z1], [xb1, 0.56, z1], [xb0, 0.56, z0], [0, 1, 0]);
    // Tablier frontal sous pare-brise (0.56..0.90) + doublage interne
    bodyM.quad([x0, 0.56, z0], [x1, 0.56, z1], [x1, 0.90, z1], [x0, 0.90, z0], [dir, 0, (u0 + u1) * 0.3]);
    innerM.quad([xi0, 0.34, z0 * 0.95], [xi1, 0.34, z1 * 0.95], [xi1, 0.90, z1 * 0.95], [xi0, 0.90, z0 * 0.95], [-dir, 0, 0]);
    // Fermeture du plancher, du dessous et de la plage avant dans le galbe frontal
    floorM.quad([xAt(1), 0.30, z0], [x0, 0.30, z0], [x1, 0.30, z1], [xAt(1), 0.30, z1], [0, -1, 0]);
    innerM.quad([xAt(1), 0.34, z0], [x0, 0.34, z0], [x1, 0.34, z1], [xAt(1), 0.34, z1], [0, 1, 0]);
    dashM.quad([xAt(1), 0.895, z0], [x0, 0.90, z0], [x1, 0.90, z1], [xAt(1), 0.895, z1], [0, 1, 0]);
  }

  // Blocs optiques LED, calandre et blason CTS suivant exactement le galbe frontal
  for (const sd of [-1, 1]) {
    const uIn = sd * 0.46, uMid = sd * 0.68, uOut = sd * 0.86;
    const pIn = [xTipAt(uIn) + dir * 0.015, zTipAt(uIn)];
    const pMid = [xTipAt(uMid) + dir * 0.015, zTipAt(uMid)];
    const pOut = [xTipAt(uOut) + dir * 0.015, zTipAt(uOut)];
    const ang = Math.atan2(pOut[0] - pIn[0], pOut[1] - pIn[1]);
    const xm = (pIn[0] + pOut[0]) / 2, zm = (pIn[1] + pOut[1]) / 2;
    darkParts.push(boxAt(0.05, 0.16, 0.34, xm, 0.72, zm, 0x14181e, ang)); // Masque de phare noir
    const beamCol = dir === 1 ? 0xf4f9ff : 0xe02424;
    darkParts.push(boxAt(0.06, 0.10, 0.18, (pIn[0] + pMid[0]) / 2 + dir * 0.006, 0.72, (pIn[1] + pMid[1]) / 2, beamCol, ang)); // Feux LED
    darkParts.push(boxAt(0.06, 0.09, 0.09, (pMid[0] + pOut[0]) / 2 + dir * 0.006, 0.72, (pMid[1] + pOut[1]) / 2, 0xf59e0b, ang)); // Clignotant ambre
  }
  // Grille de calandre centrale et blason CTS
  darkParts.push(boxAt(0.06, 0.16, 0.72, xTipAt(0) + dir * 0.025, 0.44, 0, 0x0e1115));
  darkParts.push(boxAt(0.05, 0.035, 1.38, xTipAt(0.35) + dir * 0.03, 0.565, 0, 0x9aa2ac));
  darkParts.push(boxAt(0.04, 0.11, 0.16, xTipAt(0) + dir * 0.015, 0.74, 0, 0x163e6c));

  // 3. Casquette de toit supérieure (t = 0..0.36, ligne de linteau continue à y = 2.42) + Girouette HOMME DE FER + Plafond intérieur
  const T_BROW = 0.36;
  const xBrow = xAt(T_BROW), wBrow = wAt(T_BROW); // ~1.146 m
  const N_ROOF = 5;
  const roofY = (y, r) => 2.42 + (y - 2.42) * (1 - 0.34 * r * r);
  const roofZ = (z, r) => z * (wAt(r * T_BROW) / 1.20);
  for (let k = 0; k < N_ROOF; k++) {
    const r0 = k / N_ROOF, r1 = (k + 1) / N_ROOF;
    const t0 = r0 * T_BROW, t1 = r1 * T_BROW;
    const x0 = xAt(t0), x1 = xAt(t1);
    for (let j = 0; j + 1 < ROOF_RING.length; j++) {
      const [ya, za] = ROOF_RING[j], [yb, zb] = ROOF_RING[j + 1];
      const p00 = [x0, roofY(ya, r0), roofZ(za, r0)];
      const p10 = [x1, roofY(ya, r1), roofZ(za, r1)];
      const p11 = [x1, roofY(yb, r1), roofZ(zb, r1)];
      const p01 = [x0, roofY(yb, r0), roofZ(zb, r0)];
      bodyM.quad(p00, p10, p11, p01, [dir * 0.25, 0.6, (za + zb) * 0.5]);
    }
    // Doublage de plafond intérieur continu de xs jusqu'en haut du pare-brise (y = 2.97 -> 2.42)
    const yc0 = 2.97 - 0.52 * r0 * r0, yc1 = 2.97 - 0.52 * r1 * r1;
    const wc0 = 1.12 * (wAt(t0) / 1.20), wc1 = 1.12 * (wAt(t1) / 1.20);
    ceilM.quad([x0, yc0, -wc0], [x1, yc1, -wc1], [x1, yc1, wc1], [x0, yc0, wc0], [0, -1, 0]);
    for (const sd of [-1, 1]) {
      const zs0 = sd * (wAt(t0) - 0.04), zs1 = sd * (wAt(t1) - 0.04);
      ceilM.quad([x0, 2.42, zs0], [x1, 2.42, zs1], [x1, yc1, sd * wc1], [x0, yc0, sd * wc0], [0, -0.3, -sd]);
    }
  }
  // Fermeture frontale bombée de la casquette de toit au-dessus du pare-brise (à t = T_BROW)
  for (let j = 0; j + 1 < ROOF_RING.length; j++) {
    const [ya, za] = ROOF_RING[j], [yb, zb] = ROOF_RING[j + 1];
    const yA = roofY(ya, 1), zA = roofZ(za, 1);
    const yB = roofY(yb, 1), zB = roofZ(zb, 1);
    const xA = xBrow + dir * 0.14 * (1 - (zA / wBrow) ** 2);
    const xB = xBrow + dir * 0.14 * (1 - (zB / wBrow) ** 2);
    skirtM.quad([xA, 2.42, zA], [xB, 2.42, zB], [xB, yB, zB], [xA, yA, zA], [dir, 0.2, 0]);
  }
  // Girouette frontale lumineuse « HOMME DE FER » intégrée dans la casquette (avec texte de l'atlas v in [0.428..0.472])
  const xGir = xBrow + dir * 0.145;
  darkParts.push(boxAt(0.08, 0.25, 1.18, xGir - dir * 0.02, 2.58, 0, 0x0b0e12));
  const girM = makeMeshBuilder();
  const zGL = dir > 0 ? 0.54 : -0.54, zGR = -zGL;
  girM.quadUV(
    [xGir + dir * 0.022, 2.49, zGL],
    [xGir + dir * 0.022, 2.49, zGR],
    [xGir + dir * 0.022, 2.67, zGR],
    [xGir + dir * 0.022, 2.67, zGL],
    [0.073, 0.428], [0.427, 0.428], [0.427, 0.472], [0.073, 0.472],
    [dir, 0, 0]
  );
  bodyParts.push(girM.build());

  // 4. Montants arrière de cabine (B-pillars à t = 0..0.08) et montants inclinés de pare-brise (A-pillars)
  const T_BP = 0.08, xBp = xAt(T_BP), wBp = wAt(T_BP), ybBp = yBelt(T_BP);
  for (const sd of [-1, 1]) {
    bodyM.quad([xs, 1.12, sd * 1.20], [xBp, ybBp, sd * wBp], [xBp, 2.42, sd * wBp], [xs, 2.42, sd * 1.20], [0, 0, sd]);
    innerM.quad([xs, 1.12, sd * 1.15], [xBp, ybBp, sd * (wBp - 0.05)], [xBp, 2.42, sd * (wBp - 0.05)], [xs, 2.42, sd * 1.15], [0, 0, -sd]);
    innerM.quad([xBp, ybBp, sd * (wBp - 0.05)], [xBp, ybBp, sd * wBp], [xBp, 2.42, sd * wBp], [xBp, 2.42, sd * (wBp - 0.05)], [dir, 0, 0]);
  }

  // Fonction de bordure du pare-brise et des montants A : v in [0..1] de y = yBelt(0.92) à y = 2.42
  const T_AP_BOT = 0.92;
  const apEdge = (v) => {
    const t = T_AP_BOT + (T_BROW - T_AP_BOT) * v;
    const x = xAt(t) + dir * 0.04 * Math.sin(Math.PI * v);
    const y = yBelt(T_AP_BOT) + (2.42 - yBelt(T_AP_BOT)) * v;
    const z = wAt(t);
    return [x, y, z, t];
  };

  // Montants A profilés (gauche et droite) + Vitres latérales de cabine (entre B-pillar et A-pillar)
  const V_SEGS = 6, SIDE_W_SEGS = 4;
  for (let vi = 0; vi < V_SEGS; vi++) {
    const v0 = vi / V_SEGS, v1 = (vi + 1) / V_SEGS;
    const [xa0, ya0, za0] = apEdge(v0);
    const [xa1, ya1, za1] = apEdge(v1);
    for (const sd of [-1, 1]) {
      // Montant A épais
      darkParts.push(strut([xa0, ya0, sd * za0], [xa1, ya1, sd * za1], 0.046, 0x1e2228, 6));
      // Vitre latérale de cabine (grille lisse entre le montant B à t = T_BP et le montant A)
      for (let si = 0; si < SIDE_W_SEGS; si++) {
        const s0 = si / SIDE_W_SEGS, s1 = (si + 1) / SIDE_W_SEGS;
        const yr0 = ybBp + (2.42 - ybBp) * v0, yr1 = ybBp + (2.42 - ybBp) * v1;
        const p00 = [xBp + (xa0 - xBp) * s0, yr0 + (ya0 - yr0) * s0, sd * (wBp + (za0 - wBp) * s0 - 0.01)];
        const p10 = [xBp + (xa0 - xBp) * s1, yr0 + (ya0 - yr0) * s1, sd * (wBp + (za0 - wBp) * s1 - 0.01)];
        const p11 = [xBp + (xa1 - xBp) * s1, yr1 + (ya1 - yr1) * s1, sd * (wBp + (za1 - wBp) * s1 - 0.01)];
        const p01 = [xBp + (xa1 - xBp) * s0, yr1 + (ya1 - yr1) * s0, sd * (wBp + (za1 - wBp) * s0 - 0.01)];
        glassM.quad(p00, p10, p11, p01, [dir * 0.2, 0, sd]);
      }
    }
  }

  // 5. Pare-brise panoramique galbé (normales lisses orientées vers l'extérieur, rendu DoubleSide par MATS.glass)
  const U_SEGS = 10;
  const wsPoint = (u, v) => {
    const [xSide, ySide, zSide] = apEdge(v);
    const bow = (1 - u * u) * (0.20 * (1 - 0.30 * v));
    const x = xSide + dir * bow;
    const y = (0.90 + (ySide - 0.90) * u * u) * (1 - v) + ySide * v;
    const z = u * zSide;
    return [x, y, z];
  };
  for (let vi = 0; vi < V_SEGS; vi++) {
    const v0 = vi / V_SEGS, v1 = (vi + 1) / V_SEGS;
    for (let ui = 0; ui < U_SEGS; ui++) {
      const u0 = -1 + (2 * ui) / U_SEGS, u1 = -1 + (2 * (ui + 1)) / U_SEGS;
      glassM.quad(wsPoint(u0, v0), wsPoint(u1, v0), wsPoint(u1, v1), wsPoint(u0, v1), [dir, 0.35, (u0 + u1) * 0.25]);
    }
  }
  // Essuie-glaces pantographes au bas du pare-brise
  for (const sd of [-1, 1]) {
    const pBase = wsPoint(sd * 0.30, 0.03), pMid = wsPoint(sd * 0.20, 0.34), pTop = wsPoint(sd * 0.20, 0.54), pBot = wsPoint(sd * 0.20, 0.12);
    darkParts.push(strut([pBase[0] + dir * 0.018, pBase[1], pBase[2]], [pMid[0] + dir * 0.018, pMid[1], pMid[2]], 0.013, 0x14171c, 5));
    darkParts.push(strut([pBot[0] + dir * 0.022, pBot[1], pBot[2]], [pTop[0] + dir * 0.022, pTop[1], pTop[2]], 0.011, 0x111317, 5));
  }

  if (bodyM.hasGeom()) bodyParts.push(bodyM.build());
  if (skirtM.hasGeom()) darkParts.push(skirtM.build(0x22262c));
  if (innerM.hasGeom()) darkParts.push(innerM.build(0x363c45));
  if (dashM.hasGeom()) darkParts.push(dashM.build(0x1c2026));
  if (ceilM.hasGeom()) darkParts.push(ceilM.build(0xd5dade));
  if (floorM.hasGeom()) darkParts.push(floorM.build(0x14161a));
  if (glassM.hasGeom()) {
    if (isCar) glassParts.push(glassM.build(0xa8d0ea));
    else darkParts.push(glassM.build(0x1b2836));
  }
  return { bodyParts, darkParts, glassParts };
}

// Géométries d'une rame de décor de n modules, repère local : x le long de la rame (nez avant en +x), y vers le haut, centrée en x = 0.
function tramGeometries(n) {
  const T = HDF.tram, L = n * T.module, body = [], dark = [];
  const sideUV = (x, y) => [(x + L / 2) / LIVERY_M, 0.5 + 0.5 * tClamp(y)];
  const noseUV = (flip) => (x, y, z) => [Math.min(0.49, Math.max(0.01, 0.25 + (flip * z / 2.4) * 0.5)), Math.min(0.49, Math.max(0.01, (y / 3.5) * 0.5))];
  const NOSE = 1.7, half = T.module / 2 - 0.15;
  for (let i = 0; i < n; i++) {
    const c = -L / 2 + T.module / 2 + i * T.module;
    let x0 = c - half, x1 = c + half;
    if (i === 0) {
      const xs = x0 + NOSE;
      const ns = buildTramNose(-1, xs, NOSE, sideUV, noseUV(1), false);
      body.push(...ns.bodyParts); dark.push(...ns.darkParts);
      x0 = xs;
    }
    if (i === n - 1) {
      const xs = x1 - NOSE;
      const ns = buildTramNose(1, xs, NOSE, sideUV, noseUV(-1), false);
      body.push(...ns.bodyParts); dark.push(...ns.darkParts);
      x1 = xs;
    }
    body.push(sweep([{ x: x0, s: 1 }, { x: x1, s: 1 }], sideUV));
    if (i < n - 1) dark.push(...buildBellows(c + half - 0.02, c + T.module - half + 0.02));
    for (const k of [-1, 1]) dark.push(boxAt(1.3, 0.3, 1.9, c + k * 1.3, 0.2, 0, 0x1e2125));
  }
  dark.push(boxAt(L - 3.2, 0.05, 2.3, 0, 0.3, 0, 0x14161a));
  for (const m of n >= 5 ? [1, n - 2] : [Math.floor(n / 2)]) {
    const px = -L / 2 + T.module / 2 + m * T.module;
    dark.push(boxAt(1.4, 0.08, 0.9, px, 3.44, 0, 0x2a2d31));
    for (const sx of [-1, 1]) dark.push(strut([px + sx * 0.7, 3.46, 0], [px, 4.1, 0], 0.03, 0x2a2d31));
    dark.push(boxAt(0.1, 0.06, 1.9, px, 4.12, 0, 0x2a2d31));
  }
  return { body: mergeParts(body), dark: mergeParts(dark) };
}

// ====================================================================================================================
//  Rame conduisible (v0.39.0) : un maillage par module (articulés sur la voie, voir tram.js). Repère d'un module : x le long de la rame (nez avant
//  en +x), y vers le haut, z de côté (+z : droite), origine au milieu du module.
// ====================================================================================================================
export function carGeometries() {
  const C = CONFIG.tram.car, T = HDF.tram, n = C.modules, M = T.module, L = n * M, half = M / 2 - 0.15, NOSE = 1.7;
  const doors = carDoorStarts(), wins = carWindowStarts();
  const sideUV = (x, y) => [(x + L / 2) / LIVERY_M, 0.5 + 0.5 * tClamp(y)];
  const noseUV = (flip) => (x, y, z) => [Math.min(0.49, Math.max(0.01, 0.25 + (flip * z / 2.4) * 0.5)), Math.min(0.49, Math.max(0.01, (y / 3.5) * 0.5))];
  const vc = (g) => (g.index ? g.index.count : g.attributes.position.count);
  const modules = [], seats = [], doorsAt = [];
  const seatXs = [4.9, 5.75, 6.6, 10.4, 11.75, 13.1, 17.55];
  const SIT = 0.77;
  const doorSpans = doors.map((d) => [d - L / 2, d - L / 2 + C.doorWidth]);
  const winSpans = wins.map((w) => [w - L / 2, w - L / 2 + 1.05]);

  for (let i = 0; i < n; i++) {
    const c = -L / 2 + M / 2 + i * M;
    const body = [], dark = [], leafParts = [], glassLeafParts = [], glassParts = [], inter = [], leaves = [], glassLeaves = [];
    const tr = (g) => g.translate(-c, 0, 0);
    let x0 = c - half, x1 = c + half;

    // 1. Nez aérodynamique aux deux extrémités (modules 0 et n - 1)
    if (i === 0) {
      const xs = x0 + NOSE;
      const ns = buildTramNose(-1, xs, NOSE, sideUV, noseUV(1), true);
      for (const g of ns.bodyParts) body.push(tr(g));
      for (const g of ns.darkParts) dark.push(tr(g));
      for (const g of ns.glassParts) glassParts.push(tr(g));
      x0 = xs;
    }
    if (i === n - 1) {
      const xs = x1 - NOSE;
      const ns = buildTramNose(1, xs, NOSE, sideUV, noseUV(-1), true);
      for (const g of ns.bodyParts) body.push(tr(g));
      for (const g of ns.darkParts) dark.push(tr(g));
      for (const g of ns.glassParts) glassParts.push(tr(g));
      x1 = xs;
    }

    // 2. Toiture continue sur toute la longueur droite [x0, x1] du module (y >= 2.42)
    body.push(tr(sweepProfile(ROOF_RING, [{ x: x0, s: 1 }, { x: x1, s: 1 }], sideUV, null, true)));

    // 3. Flancs inférieurs (y = 0.32..1.12) et bande vitrée (y = 1.12..2.42) découpée proprement autour des portes et fenêtres
    const modDoors = doorSpans.filter(([d0, d1]) => d1 > x0 + 0.02 && d0 < x1 - 0.02);
    const modWins = winSpans.filter(([w0, w1]) => w0 >= x0 - 0.02 && w1 <= x1 + 0.02);

    // Bas de caisse (y = 0.32..1.12) : continu sauf dans l'embrasure des portes
    const lowCuts = modDoors.map(([d0, d1]) => [Math.max(x0, d0), Math.min(x1, d1)]).sort((a, b) => a[0] - b[0]);
    let curLow = x0;
    for (const [c0, c1] of [...lowCuts, [x1, x1]]) {
      if (c0 > curLow + 0.01) {
        const len = c0 - curLow, xm = (curLow + c0) / 2;
        body.push(tr(sweepProfile(LOWER_R, [{ x: curLow, s: 1 }, { x: c0, s: 1 }], sideUV)));
        body.push(tr(sweepProfile(LOWER_L, [{ x: curLow, s: 1 }, { x: c0, s: 1 }], sideUV)));
        for (const side of [-1, 1]) {
          inter.push(tr(boxAt(len, 0.78, 0.04, xm, 0.72, side * 1.16, 0x8a9097))); // Paroi basse intérieure
          inter.push(tr(boxAt(len, 0.04, 0.07, xm, 1.11, side * 1.175, 0x50565e))); // Tablette d'appui de fenêtre étanche
        }
      }
      curLow = Math.max(curLow, c1);
    }

    // Seuils et encadrements d'embrasure des portes
    for (const [d0, d1] of modDoors) {
      const dm = (d0 + d1) / 2, dw = d1 - d0;
      for (const side of [-1, 1]) {
        dark.push(tr(boxAt(dw, 0.16, 0.10, dm, 0.39, side * 1.18, 0x383c42)));
        dark.push(tr(boxAt(dw, 0.03, 0.12, dm, 0.48, side * 1.18, 0xe8c04a)));
        // Montants d'embrasure verticaux et linteau supérieur étanches
        inter.push(tr(boxAt(0.07, 2.08, 0.09, d0, 1.44, side * 1.18, 0x50565e)));
        inter.push(tr(boxAt(0.07, 2.08, 0.09, d1, 1.44, side * 1.18, 0x50565e)));
        inter.push(tr(boxAt(dw + 0.10, 0.06, 0.09, dm, 2.42, side * 1.18, 0x50565e)));
      }
    }

    // Bande vitrée (y = 1.12..2.42) : montants pleins entre les ouvertures (portes + fenêtres), vitres transparentes dans les baies
    const winBandCuts = [...modDoors, ...modWins]
      .map(([a0, a1]) => [Math.max(x0, a0), Math.min(x1, a1)])
      .filter(([a0, a1]) => a1 > a0 + 0.01)
      .sort((a, b) => a[0] - b[0]);
    let curWin = x0;
    for (const [c0, c1] of [...winBandCuts, [x1, x1]]) {
      if (c0 > curWin + 0.01) {
        const len = c0 - curWin, xm = (curWin + c0) / 2;
        body.push(tr(sweepProfile(WIN_R, [{ x: curWin, s: 1 }, { x: c0, s: 1 }], sideUV)));
        body.push(tr(sweepProfile(WIN_L, [{ x: curWin, s: 1 }, { x: c0, s: 1 }], sideUV)));
        for (const side of [-1, 1]) {
          inter.push(tr(boxAt(len, 1.30, 0.055, xm, 1.77, side * 1.17, 0xb7bdc3))); // Garnissage intérieur du trumeau/montant
        }
      }
      curWin = Math.max(curWin, c1);
    }

    // Vitres latérales transparentes et leurs joints d'encadrement noirs
    for (const [w0, w1] of modWins) {
      const wm = (w0 + w1) / 2, ww = w1 - w0;
      for (const side of [-1, 1]) {
        glassParts.push(tr(boxAt(ww, 1.28, 0.014, wm, 1.77, side * 1.185, 0xa8d0ea)));
        dark.push(tr(boxAt(0.035, 1.28, 0.06, w0 + 0.01, 1.77, side * 1.18, 0x22262c)));
        dark.push(tr(boxAt(0.035, 1.28, 0.06, w1 - 0.01, 1.77, side * 1.18, 0x22262c)));
      }
    }

    // 4. Soufflets d'intercirculation, bogies, châssis et pantographes
    if (i < n - 1) {
      for (const g of buildBellows(c + half - 0.02, c + M - half + 0.02)) dark.push(tr(g));
    }
    for (const k of [-1, 1]) dark.push(tr(boxAt(1.3, 0.3, 1.9, c + k * 1.3, 0.2, 0, 0x1e2125)));
    dark.push(tr(boxAt(x1 - x0, 0.05, 2.34, (x0 + x1) / 2, 0.30, 0, 0x14161a)));
    if (i === 1 || i === n - 2) {
      dark.push(tr(boxAt(1.4, 0.08, 0.9, c, 3.44, 0, 0x2a2d31)));
      for (const sx of [-1, 1]) dark.push(tr(strut([c + sx * 0.7, 3.46, 0], [c, 4.1, 0], 0.03, 0x2a2d31)));
      dark.push(tr(boxAt(0.1, 0.06, 1.9, c, 4.12, 0, 0x2a2d31)));
    }

    // 5. Intérieur du module : plancher, plafond lumineux, voussoirs hauts, mains courantes et sièges
    const mLen = x1 - x0, mMid = (x0 + x1) / 2;
    inter.push(tr(boxAt(mLen + 0.04, 0.035, 2.32, mMid, 0.335, 0, 0x30343a))); // Plancher continu
    inter.push(tr(boxAt(mLen + 0.04, 0.04, 2.14, mMid, 2.97, 0, 0xd8dde2)));   // Plafond continu
    inter.push(tr(boxAt(mLen - 0.10, 0.015, 0.36, mMid, 2.945, 0, 0xf4f7fa))); // Bandeau lumineux central LED
    for (const side of [-1, 1]) {
      inter.push(tr(boxAt(mLen + 0.02, 0.56, 0.05, mMid, 2.69, side * 1.16, 0xc9ced2))); // Voussoir supérieur
      inter.push(tr(boxAt(mLen + 0.02, 0.04, 0.07, mMid, 2.42, side * 1.175, 0x50565e))); // Linteau continu des baies
    }
    // Mains courantes jaunes au plafond et colonnes près des portes
    inter.push(tr(colorize(new THREE.CylinderGeometry(0.024, 0.024, mLen, 6).rotateZ(Math.PI / 2).translate(mMid, 2.78, 0.42), 0xe8c04a)));
    inter.push(tr(colorize(new THREE.CylinderGeometry(0.024, 0.024, mLen, 6).rotateZ(Math.PI / 2).translate(mMid, 2.78, -0.42), 0xe8c04a)));
    for (const [d0, d1] of modDoors) {
      const dc = (d0 + d1) / 2;
      for (const side of [-1, 1]) inter.push(tr(colorize(new THREE.CylinderGeometry(0.028, 0.028, 2.58, 6).translate(dc + 0.78, 1.62, side * 0.65), 0xe8c04a)));
    }
    // Sièges de passagers CTS (velours bleu, coque ergonomique et coffre sous assise)
    for (const side of [-1, 1]) for (const X of seatXs) {
      const x = X - L / 2;
      if (x <= x0 + 0.15 || x >= x1 - 0.15) continue;
      const zc = side * 0.93;
      inter.push(tr(boxAt(0.52, 0.07, 0.42, x, SIT - 0.035, zc, 0x285698)));
      inter.push(tr(boxAt(0.50, 0.36, 0.34, x, 0.55, zc + side * 0.03, 0x20252b)));
      inter.push(tr(boxAt(0.52, 0.52, 0.055, x, SIT + 0.28, side * 1.10, 0x1e437a)));
      seats.push({ module: i, x: x - c, y: SIT + 0.02, z: zc, eyeUp: 0.62, face: side * Math.PI / 2, driver: false, side });
    }

    // 6. Cockpit de conduite CTS détaillé (module 0 : arrière, module n - 1 : avant)
    if (i === 0 || i === n - 1) {
      const dir = i === 0 ? -1 : 1, Xc = dir * (L / 2 - 2.45), Xd = dir * (L / 2 - 1.72);
      // Plage intermédiaire reliant le pupitre (Xd) à l'entrée du nez (xs)
      const xsCab = dir * (L / 2 - 0.15 - NOSE);
      inter.push(tr(boxAt(Math.abs(xsCab - Xd) + 0.12, 0.04, 2.24, (Xd + xsCab) / 2, 0.89, 0, 0x1c2026)));
      // Cloison de séparation de cabine derrière le conducteur (avec passage central libre de 1,32 m)
      const xPart = Xc - dir * 0.36;
      for (const side of [-1, 1]) {
        inter.push(tr(boxAt(0.05, 1.10, 0.48, xPart, 0.89, side * 0.91, 0x8a9097)));
        inter.push(tr(boxAt(0.05, 0.55, 0.48, xPart, 2.68, side * 0.91, 0xc9ced2)));
        glassParts.push(tr(boxAt(0.016, 0.96, 0.44, xPart, 1.92, side * 0.90, 0xa8d0ea)));
        inter.push(tr(colorize(new THREE.CylinderGeometry(0.026, 0.026, 2.58, 6).translate(xPart, 1.62, side * 0.66), 0xe8c04a)));
      }
      // Console / Pupitre de conduite enveloppant en fer à cheval
      inter.push(tr(boxAt(0.46, 0.56, 1.44, Xd, 0.62, 0, 0x232830)));                        // Base centrale du pupitre
      inter.push(tr(boxAt(0.50, 0.05, 1.56, Xd - dir * 0.02, 0.91, 0, 0x181c22)));           // Plateau supérieur
      for (const side of [-1, 1]) {
        const wingAng = side * dir * 0.34;
        inter.push(tr(boxAt(0.54, 0.56, 0.42, Xd - dir * 0.18, 0.62, side * 0.74, 0x232830, wingAng))); // Ailes latérales
        inter.push(tr(boxAt(0.56, 0.06, 0.44, Xd - dir * 0.18, 0.91, side * 0.74, 0x181c22, wingAng)));
      }
      // Pupitre d'instrumentation incliné vers les yeux du conducteur (culmine à 1,14 m)
      const tilt = dir * 0.48;
      const tiltedBox = (w, h, d, x, y, z, col) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.rotateZ(tilt);
        g.translate(x, y, z);
        return colorize(g, col);
      };
      const xPod = Xd - dir * 0.04, yPod = 1.01;
      inter.push(tr(tiltedBox(0.24, 0.18, 1.22, xPod, yPod, 0, 0x14181f)));
      // 3 Écrans de contrôle illuminés inclinés vers le conducteur (Caméras portes, Tachymètre/Traction, Terminal SAEIV CTS)
      const xScr = xPod - dir * 0.105, yScr = yPod + 0.055;
      inter.push(tr(tiltedBox(0.02, 0.15, 0.24, xScr, yScr, -0.35, 0x0d2b38)));
      inter.push(tr(tiltedBox(0.024, 0.11, 0.20, xScr - dir * 0.005, yScr, -0.35, 0x38bdf8)));
      inter.push(tr(tiltedBox(0.02, 0.16, 0.30, xScr, yScr, 0.0, 0x0b1f32)));
      inter.push(tr(tiltedBox(0.024, 0.12, 0.26, xScr - dir * 0.005, yScr, 0.0, 0x22c55e)));
      inter.push(tr(tiltedBox(0.02, 0.15, 0.24, xScr, yScr, 0.35, 0x1e293b)));
      inter.push(tr(tiltedBox(0.024, 0.11, 0.20, xScr - dir * 0.005, yScr, 0.35, 0xf59e0b)));
      // Manipulateur Traction / Freinage sur l'aile gauche
      const xLev = Xd - dir * 0.18, zLev = -0.64;
      inter.push(tr(boxAt(0.22, 0.03, 0.14, xLev, 0.95, zLev, 0x9aa2ac)));
      inter.push(tr(strut([xLev, 0.95, zLev], [xLev + dir * 0.05, 1.14, zLev], 0.016, 0xd1d5db)));
      inter.push(tr(boxAt(0.045, 0.045, 0.14, xLev + dir * 0.05, 1.15, zLev, 0x111317)));
      // Coup de poing d'arrêt d'urgence et boutons lumineux sur l'aile droite
      inter.push(tr(boxAt(0.07, 0.03, 0.07, xLev, 0.95, 0.58, 0xeab308)));
      inter.push(tr(boxAt(0.05, 0.045, 0.05, xLev, 0.98, 0.58, 0xdc2626)));
      for (let b = 0; b < 4; b++) {
        const bCol = [0x22c55e, 0x38bdf8, 0xf59e0b, 0xef4444][b];
        inter.push(tr(boxAt(0.03, 0.02, 0.03, Xd - dir * 0.20, 0.945, 0.16 + b * 0.08, bCol)));
      }
      // Pare-soleil teinté et rétroviseur intérieur sous la casquette
      inter.push(tr(boxAt(0.04, 0.12, 1.32, Xd + dir * 0.20, 2.38, 0, 0x181c22)));
      inter.push(tr(boxAt(0.04, 0.09, 0.26, Xd + dir * 0.12, 2.30, 0.38, 0x22262c)));
      // Siège conducteur ergonomique suspendu avec appui-tête et accoudoirs
      inter.push(tr(boxAt(0.22, 0.04, 0.28, Xc, 0.36, 0, 0x14171c)));                        // Socle au sol
      inter.push(tr(boxAt(0.14, 0.42, 0.14, Xc, 0.57, 0, 0x181c22)));                        // Colonne hydraulique
      inter.push(tr(boxAt(0.44, 0.09, 0.46, Xc, 0.80, 0, 0x22262c)));                        // Assise baquet
      inter.push(tr(boxAt(0.36, 0.03, 0.36, Xc + dir * 0.02, 0.85, 0, 0x1e437a)));           // Coussin bleu CTS
      inter.push(tr(boxAt(0.08, 0.54, 0.44, Xc - dir * 0.19, 1.10, 0, 0x22262c)));           // Dossier ergonomique
      inter.push(tr(boxAt(0.06, 0.38, 0.32, Xc - dir * 0.15, 1.10, 0, 0x1e437a)));           // Dossier insert bleu
      inter.push(tr(boxAt(0.07, 0.18, 0.26, Xc - dir * 0.20, 1.46, 0, 0x181c22)));           // Appui-tête
      for (const side of [-1, 1]) {
        inter.push(tr(boxAt(0.32, 0.04, 0.06, Xc - dir * 0.03, 1.00, side * 0.25, 0x181c22))); // Accoudoirs
      }
      seats.push({ module: i, x: Xc - c, y: 0.84, z: 0, eyeUp: 0.72, face: i === 0 ? Math.PI : 0, driver: true, side: 0 });
    }

    // 7. Vantaux coulissants des portes : cadre aluminium et vitre transparente
    const wLeaf = C.doorWidth / 2 - 0.02;
    for (let d = 0; d < doors.length; d++) {
      const [d0, d1] = doorSpans[d], dc = (d0 + d1) / 2;
      if (dc < x0 || dc > x1) continue;
      for (const side of [-1, 1]) {
        doorsAt.push({ module: i, x: dc - c, side });
        for (const dir of [-1, 1]) {
          const lx = dc + dir * (C.doorWidth / 4);
          const fBottom = boxAt(wLeaf, 0.38, 0.04, lx, 0.67, side * 1.21, 0x50565e);
          const fTop = boxAt(wLeaf, 0.14, 0.04, lx, 2.35, side * 1.21, 0x50565e);
          const fLeft = boxAt(0.05, 1.54, 0.04, lx - wLeaf / 2 + 0.025, 1.51, side * 1.21, 0x50565e);
          const fRight = boxAt(0.05, 1.54, 0.04, lx + wLeaf / 2 - 0.025, 1.51, side * 1.21, 0x50565e);
          const fSeal = boxAt(0.02, 1.94, 0.045, lx + dir * (wLeaf / 2 - 0.01), 1.45, side * 1.21, 0x14161a);
          const fBar = boxAt(wLeaf - 0.08, 0.03, 0.02, lx, 1.05, side * 1.17, 0xe8c04a);
          const frameGeom = tr(mergeParts([fBottom, fTop, fLeft, fRight, fSeal, fBar]));
          leafParts.push(frameGeom);
          leaves.push({ k: leafParts.length - 1, dir, side });

          const pane = tr(boxAt(wLeaf - 0.08, 1.52, 0.012, lx, 1.51, side * 1.21, 0xa8d0ea));
          glassLeafParts.push(pane);
          glassLeaves.push({ k: glassLeafParts.length - 1, dir, side });
        }
      }
    }

    const parts = [...dark, ...leafParts, ...inter], counts = parts.map(vc);
    const leafFirst = dark.length;
    const leafRanges = leaves.map((lf) => {
      const k = leafFirst + lf.k;
      let v0 = 0;
      for (let j = 0; j < k; j++) v0 += counts[j];
      return { v0, n: counts[k], dir: lf.dir, side: lf.side };
    });

    const allGlass = [...glassLeafParts, ...glassParts];
    const gCounts = allGlass.map(vc);
    const glassLeafRanges = glassLeaves.map((lf) => {
      const k = lf.k;
      let v0 = 0;
      for (let j = 0; j < k; j++) v0 += gCounts[j];
      return { v0, n: gCounts[k], dir: lf.dir, side: lf.side };
    });

    modules.push({
      body: mergeParts(body),
      dark: mergeParts(parts),
      glass: allGlass.length ? mergeParts(allGlass) : new THREE.BufferGeometry(),
      leaves: leafRanges,
      glassLeaves: glassLeafRanges,
      c,
    });
  }
  const seatOut = seats.map((s) => ({ module: s.module, hip: [s.z, s.y, -s.x], eye: [s.z, s.y + s.eyeUp, -s.x], ry: s.face, driver: s.driver, side: s.side }));
  return { modules, seats: seatOut, doorsAt, L };
}

// ------------------------------------------------------------------ atlas de la livrée (1024 x 512) : flanc, nez, totem
// Rame conduisible : début (m depuis le nez arrière) des 4 portes de chaque côté ; elles tombent dans les modules 0, 1, 3 et 4, symétriques par rapport au milieu
export function carDoorStarts() {
  const C = CONFIG.tram.car, M = HDF.tram.module, L = C.modules * M, a = 2.95, b = M + 2.95;
  return [a, b, L - b - C.doorWidth, L - a - C.doorWidth];
}
// et des fenêtres (1,05 m) qui comblent le flanc entre les portes, les jonctions des modules et les cabines
export function carWindowStarts() {
  const C = CONFIG.tram.car, M = HDF.tram.module, L = C.modules * M, doors = carDoorStarts(), out = [];
  for (let x = 1.9; x + 1.05 <= L - 1.9 + 1e-6; x += 1.4) {
    if (doors.some((d) => x < d + C.doorWidth + 0.15 && x + 1.05 > d - 0.15)) continue;
    let joint = false; for (let k = 1; k < C.modules; k++) if (x < k * M + 0.25 && x + 1.05 > k * M - 0.25) joint = true;
    if (!joint) out.push(+x.toFixed(2));
  }
  return out;
}

// variant : 'decor' (rames de décor : 7 modules, deux portes ouvertes par module, sang) ou 'car' (rame conduisible : 5 modules, 4 portes par côté, propre)
const ATLASES = {};
export function atlas(variant = 'decor') {
  if (ATLASES[variant]) return ATLASES[variant];
  const car = variant === 'car', CAR = CONFIG.tram.car;
  // portes de la rame conduisible : repère de la livrée (m depuis le nez arrière), 4 par côté : deux dans les modules 0 et 1, deux (symétriques) dans les modules 3 et 4
  const carDoors = car ? carDoorStarts() : [];
  const draw = (x, emis) => {
    const rnd = mulberry(8128);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 512);
    const M = 1024 / LIVERY_M; // px par mètre le long de la rame
    // ---- flanc (moitié haute) : 7 modules
    if (!emis) {
      x.fillStyle = '#d9dde0'; x.fillRect(0, 0, 1024, 256);
      x.fillStyle = '#7b8189'; x.fillRect(0, 0, 1024, 9);                                         // arête de toit
      x.fillStyle = '#383c42'; x.fillRect(0, liveryY(0.66), 1024, 256 - liveryY(0.66));          // jupe
      x.fillStyle = '#8a9097'; x.fillRect(0, liveryY(0.84), 1024, liveryY(0.66) - liveryY(0.84)); // liseré
      x.fillStyle = '#3c424a'; x.fillRect(0, liveryY(2.52), 1024, liveryY(2.42) - liveryY(2.52)); // bandeau haut
    }
    for (let i = 0; i < (car ? CAR.modules : 7); i++) {
      const X = i * HDF.tram.module;
      // bandeau vitré sombre (entre les portes) : 1,85..2,85 m du module
      if (!emis && !car) {
        const g = x.createLinearGradient(0, liveryY(2.4), 0, liveryY(1.15)); g.addColorStop(0, '#202c38'); g.addColorStop(1, '#10161c');
        x.fillStyle = g; x.fillRect((X + 1.85) * M, liveryY(2.4), 1.0 * M, liveryY(1.15) - liveryY(2.4));
        x.fillStyle = 'rgba(140,170,190,0.14)'; x.beginPath(); x.moveTo((X + 1.95) * M, liveryY(2.4)); x.lineTo((X + 2.4) * M, liveryY(2.4)); x.lineTo((X + 2.1) * M, liveryY(1.15)); x.lineTo((X + 1.85) * M, liveryY(1.15)); x.fill();
      }
      // deux portes ouvertes : encadrement, vide sombre, éclairage intérieur, vantaux repliés (rame conduisible : les portes de carDoorStarts, aucune de plus)
      for (const dx of car ? [] : [0.45, 2.95]) {
        const px = (X + dx) * M, pw = 1.3 * M, py = liveryY(2.35), ph = liveryY(0.45) - liveryY(2.35);
        if (!emis) {
          x.fillStyle = '#6b7279'; x.fillRect(px - 5, py - 5, pw + 10, ph + 5);
          x.fillStyle = '#07090b'; x.fillRect(px, py, pw, ph);
          x.fillStyle = '#c9ced2'; x.fillRect(px, py, 6, ph); x.fillRect(px + pw - 6, py, 6, ph);   // vantaux
          x.fillStyle = '#e8c04a'; x.fillRect(px, liveryY(0.5), pw, liveryY(0.45) - liveryY(0.5)); // marche jaune
        } else {
          const g = x.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(1, 'rgba(255,170,90,0.12)');
          x.fillStyle = g; x.fillRect(px + 8, py + 4, pw - 16, ph - 8);
        }
      }
    }
    if (car && !emis) for (const w0 of carWindowStarts()) { // rame conduisible : fenêtres entre les portes
      const g = x.createLinearGradient(0, liveryY(2.4), 0, liveryY(1.15)); g.addColorStop(0, '#202c38'); g.addColorStop(1, '#10161c');
      x.fillStyle = g; x.fillRect(w0 * M, liveryY(2.4), 1.05 * M, liveryY(1.15) - liveryY(2.4));
      x.fillStyle = 'rgba(140,170,190,0.14)'; x.beginPath(); x.moveTo((w0 + 0.1) * M, liveryY(2.4)); x.lineTo((w0 + 0.55) * M, liveryY(2.4)); x.lineTo((w0 + 0.25) * M, liveryY(1.15)); x.lineTo(w0 * M, liveryY(1.15)); x.fill();
    }
    for (const x0 of carDoors) { // rame conduisible : l'embrasure des portes (le vide sombre, le marchepied) ; les vantaux sont des pièces mobiles (voir carGeometries)
      const px = x0 * M, pw = CAR.doorWidth * M, py = liveryY(2.35), ph = liveryY(0.45) - liveryY(2.35);
      if (!emis) {
        x.fillStyle = '#6b7279'; x.fillRect(px - 5, py - 5, pw + 10, ph + 5);
        x.fillStyle = '#07090b'; x.fillRect(px, py, pw, ph);
        x.fillStyle = '#e8c04a'; x.fillRect(px, liveryY(0.5), pw, liveryY(0.45) - liveryY(0.5));
      } else {
        const g = x.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(1, 'rgba(255,170,90,0.12)');
        x.fillStyle = g; x.fillRect(px + 8, py + 4, pw - 16, ph - 8);
      }
    }
    // sang : coulures et éclaboussures autour des portes et sur le bas de caisse (tirage reproductible)
    if (!emis && !car) {
      for (let k = 0; k < 46; k++) {
        const i = Math.floor(rnd() * 7), dx = rnd() < 0.5 ? 0.45 + rnd() * 1.3 : 2.95 + rnd() * 1.3;
        const px = (i * HDF.tram.module + dx) * M, py = liveryY(2.3 - rnd() * 1.7), a = 0.35 + rnd() * 0.4;
        x.fillStyle = `rgba(${95 + rnd() * 40 | 0},8,10,${a})`;
        x.beginPath(); x.ellipse(px, py, 3 + rnd() * 9, 2 + rnd() * 6, rnd() * 3, 0, 7); x.fill();
        if (rnd() < 0.6) x.fillRect(px - 1, py, 1.5 + rnd() * 2, 8 + rnd() * 36);
      }
      for (let k = 0; k < 220; k++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.07})`; x.fillRect(rnd() * 1024, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 9); } // saleté
    }
    // ---- nez (quart bas gauche) : repère physique en cm, 213,3 px/m en largeur, 73,14 px/m en hauteur
    x.save();
    x.beginPath(); x.rect(0, 256, 512, 256); x.clip();
    x.setTransform(2.133, 0, 0, 0.7314, 256, 512); // (Z cm, -Y cm)
    if (!emis) {
      x.fillStyle = '#d9dde0'; x.fillRect(-120, -350, 240, 350);
      x.fillStyle = '#383c42'; x.fillRect(-120, -60, 240, 60);
      x.fillStyle = '#7b8189'; x.fillRect(-120, -88, 240, 12);
      const g = x.createLinearGradient(0, -295, 0, -130); g.addColorStop(0, '#202b36'); g.addColorStop(1, '#0d1217');
      x.fillStyle = g; x.beginPath(); x.moveTo(-100, -130); x.lineTo(-92, -285); x.lineTo(92, -285); x.lineTo(100, -130); x.closePath(); x.fill();
      x.fillStyle = 'rgba(150,180,200,0.12)'; x.beginPath(); x.moveTo(-70, -285); x.lineTo(-20, -285); x.lineTo(-60, -130); x.lineTo(-100, -130); x.fill();
      x.fillStyle = '#0a0c0e'; x.fillRect(-85, -330, 170, 30);                                  // girouette
      for (const s of [-1, 1]) { x.fillStyle = '#d8d2b0'; x.fillRect(s * 85 - 15, -88 + 18, 30, 12); } // phares
      for (let k = 0; k < 14; k++) { x.fillStyle = `rgba(110,10,12,${0.3 + rnd() * 0.4})`; x.beginPath(); x.ellipse(-90 + rnd() * 180, -60 - rnd() * 200, 3 + rnd() * 10, 2 + rnd() * 8, rnd() * 3, 0, 7); x.fill(); }
    }
    x.font = 'bold 15px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = emis ? '#ffb22e' : '#ff9d1a';
    x.fillText('HOMME DE FER', 0, -315);
    if (emis) { for (const s of [-1, 1]) { x.fillStyle = 'rgba(255,240,200,0.25)'; x.fillRect(s * 85 - 15, -70, 30, 12); } }
    x.restore();
    // ---- totem (quart bas droit) : 40 cm de large, 2,80 m de haut ; la texture est couchée (x = hauteur, y = largeur)
    x.save();
    x.beginPath(); x.rect(512, 256, 512, 256); x.clip();
    x.setTransform(0, -6.4, 1.829, 0, 512, 512); // (X cm de largeur, Y cm de hauteur) -> pixels
    if (!emis) {
      x.fillStyle = '#26323f'; x.fillRect(0, 0, 40, 280);
      x.fillStyle = '#1a232d'; x.fillRect(0, 0, 40, 22);
      x.fillStyle = '#e9eef2'; x.fillRect(18, 22, 4, 130);                                  // liseré clair
    }
    // panneau lumineux du nom ; le repère est « Y vers le haut » : le texte est retourné pour rester à l'endroit
    const tx = (text, px, py) => { x.save(); x.translate(px, py); x.scale(1, -1); x.fillText(text, 0, 0); x.restore(); };
    x.fillStyle = emis ? 'rgba(255,255,255,0.55)' : '#eef2f5'; x.fillRect(3, 208, 34, 66);
    x.fillStyle = '#12161a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 8.6px Arial';
    if (emis) x.fillStyle = '#000'; // le texte ne s'éclaire pas
    tx('HOMME', 20, 258); tx('DE FER', 20, 242); x.fillRect(6, 227, 28, 1.4); x.font = 'bold 6px Arial'; tx('TRAM', 20, 218);
    // pastilles des lignes (couleurs neutres : les teintes officielles ne sont pas reprises)
    [['A', 8, 195], ['B', 20, 195], ['C', 32, 195], ['D', 14, 181], ['F', 26, 181]].forEach(([l, px, py]) => {
      x.fillStyle = emis ? 'rgba(255,255,255,0.2)' : '#39414a'; x.beginPath(); x.arc(px, py, 5.2, 0, 7); x.fill();
      x.fillStyle = emis ? '#000' : '#fff'; x.font = 'bold 6.6px Arial'; tx(l, px, py + 0.4);
    });
    x.restore();
  };
  const mk = (emis) => canvasTex(1024, 512, (x) => draw(x, emis));
  const A = ATLASES[variant] = { map: mk(false), emissive: mk(true) };
  A.mat = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.emissive, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.62, metalness: 0.25 });
  return A;
}

// Totem : boîte 0,4 x 2,8 x 0,15 m ; UV vers la zone « totem » de l'atlas (face avant ET arrière, texte à l'endroit des deux côtés)
function totemGeometry() {
  const g = new THREE.BoxGeometry(0.4, 2.8, 0.15);
  const p = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const nz = nrm.getZ(i), x = p.getX(i), y = p.getY(i);
    if (Math.abs(nz) > 0.5) { const wx = nz > 0 ? x : -x; uv.setXY(i, 0.5 + 0.5 * ((y + 1.4) / 2.8), 0.5 * ((wx + 0.2) / 0.4)); }
    else uv.setXY(i, 0.99, 0.01); // tranches : couleur du fond
  }
  g.translate(0, 1.4, 0);
  return g;
}

// ====================================================================================================================
//  Décor : rails, quais, rames, totems, statue
// ====================================================================================================================
const SIDE_SAMPLE = 1.5; // pas d'échantillonnage le long d'une rame (m)

// ctx : { scene, collision, lightSources, plan, zi (indice de la zone), zoneOf(x, z), doorDist(x, z), used [[x, z]...] (déjà posés),
//         obstacles [[x, z]...] (mobilier OSM à ne pas écraser), columns [[x, z]...] }
// Les rails, les quais d'arrêt et les poteaux sont ceux du réseau (tramNet.js) ; ici : les rames de décor à l'arrêt (et leurs quais), les totems, la statue.
export function buildHdfDecor(ctx) {
  const { scene, collision, lightSources, plan, zi, zoneOf, doorDist } = ctx;
  const { cx, cz } = plan, net = plan.net, T = HDF.tram, M = mats();
  const used = ctx.used, cols = ctx.columns || [];
  const statueX = HDF.statue.x + HDF.statue.nx * HDF.statue.offset, statueZ = HDF.statue.z + HDF.statue.nz * HDF.statue.offset;
  const info = { lines: net.tracks.map((t) => t.id), trams: [], totems: [], statue: null };
  const steel = [];  // pièces d'acier / dallage (sommets colorés)
  const tmp = {}, tmp2 = {};

  // ---- rames : 33 m (7 modules), sinon 14 m (3 modules), sinon abandon ; posées sur une partie droite d'une voie, près du croisement
  const lateralFree = (px, pz, dx, dz) => { // distance libre à partir d'un point, en ignorant les colonnes de la rotonde
    let d0 = 0;
    for (let k = 0; k < 4; k++) {
      const d = collision.rayHit(px + dx * d0, 1, pz + dz * d0, dx, 0, dz, 3.4 - d0);
      if (d0 + d >= 3.4 - 1e-3) return 3.4;
      const hx = px + dx * (d0 + d), hz = pz + dz * (d0 + d);
      if (cols.some(([qx, qz]) => Math.hypot(qx - hx, qz - hz) < 0.6)) { d0 += d + 0.5; continue; }
      return d0 + d;
    }
    return 3.4;
  };
  // t : voie ; sRef : abscisse du point de la voie le plus proche du centre de la rotonde ; sign : côté (-1 vers le début de la ligne) ; d0 : distance
  // du bout proche de la rame au point de référence ; L : longueur
  const tryTram = (t, sRef, sign, d0, L) => {
    const sA = sRef + sign * d0, sB = sA + sign * L, lo = Math.min(sA, sB), hi = Math.max(sA, sB), sMid = (lo + hi) / 2;
    if (lo < 6 || hi > t.L - 6 || t.minRadius(lo - 1, hi + 1) < Infinity) return null; // partie droite seulement
    let minL = 9, minR = 9;
    const steps = Math.ceil(L / SIDE_SAMPLE);
    for (let k = 0; k <= steps; k++) {
      t.at(lo + (L * k) / steps, tmp);
      const x = tmp.x, z = tmp.z, px = -tmp.tz, pz = tmp.tx;
      if (zoneOf(x, z) !== zi || zoneOf(x + px * 1.3, z + pz * 1.3) !== zi || zoneOf(x - px * 1.3, z - pz * 1.3) !== zi) return null;
      if (doorDist(x, z) < 8) return null;
      if (used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < 3.5)) return null;
      if (Math.hypot(x - statueX, z - statueZ) < 9) return null; // la rame ne doit pas masquer la statue
      for (const u of [...net.tracks, ...(net.connectors || [])]) if (u !== t && u.project(x, z, 12, tmp2).d < 5) return null; // ni sur le croisement, ni contre l'autre voie, ni sur un raccord d'aiguillage (v0.41.0)
      const l = lateralFree(x, z, px, pz), r = lateralFree(x, z, -px, -pz);
      if (l < T.width / 2 + T.side || r < T.width / 2 + T.side) return null;
      minL = Math.min(minL, l); minR = Math.min(minR, r);
    }
    t.at(hi, tmp);
    if (collision.rayHit(tmp.x, 1, tmp.z, tmp.tx, 0, tmp.tz, 0.8) < 0.7) return null;
    t.at(lo, tmp);
    if (collision.rayHit(tmp.x, 1, tmp.z, -tmp.tx, 0, -tmp.tz, 0.8) < 0.7) return null;
    t.at(sMid, tmp);
    for (const [ox, oz] of ctx.obstacles || []) { // mobilier OSM (bornes, bancs…) dans l'emprise
      const p = t.project(ox, oz, 6, tmp2);
      if (p.s > lo - 0.5 && p.s < hi + 0.5 && p.d < T.width / 2 + 0.6) return null;
    }
    // orientation : le nez du côté où l'on a cherché (comme avant : vers le point de référence ou à l'opposé)
    const dx = sign * tmp.tx, dz = sign * tmp.tz;
    return { track: t, line: t.id, sign, lo, hi, L, x: tmp.x, z: tmp.z, dx, dz, px: -dz, pz: dx, minL, minR, modules: Math.round(L / T.module) };
  };
  const placements = [];
  for (const dc of CONFIG.tram.hdf.decor) {
    const t = net.byId[dc.line], sRef = t.project(cx, cz, 80, {}).s;
    let found = null;
    for (const mods of dc.modules) {
      const L = mods * T.module;
      for (let d0 = T.minReach; d0 + L <= T.maxReach + 1e-6 && !found; d0 += 1) found = tryTram(t, sRef, dc.side, d0, L);
      if (found) break;
    }
    if (found) { placements.push(found); used.push(...[0, 0.25, 0.5, 0.75, 1].map((f) => { t.at(found.lo + found.L * f, tmp); return [tmp.x, tmp.z]; })); }
  }

  // géométries des rames : une pour chaque longueur ; copies placées dans le monde puis fusionnées (2 maillages en tout)
  const bodies = [], darks = [], geoCache = {};
  for (const t of placements) {
    const g = geoCache[t.modules] || (geoCache[t.modules] = tramGeometries(t.modules));
    const theta = Math.atan2(-t.dz, t.dx);
    const place = (geo) => { const c = geo.clone(); c.rotateY(theta); c.translate(t.x, 0, t.z); return c; };
    bodies.push(place(g.body)); darks.push(place(g.dark));
    // collision : une boîte orientée par module
    for (let i = 0; i < t.modules; i++) {
      const sm = -t.L / 2 + T.module / 2 + i * T.module; // le long de (dx, dz), depuis le milieu de la rame
      collision.addBox(t.x + t.dx * sm, t.z + t.dz * sm, T.body, T.width, Math.atan2(t.dz, t.dx), T.height);
    }
    // quais : dallage clair + ligne podotactile de chaque côté, au ras du sol, aussi larges que la rue le permet
    for (const side of [-1, 1]) {
      const free = side > 0 ? t.minL : t.minR, w = Math.min(2.6, free - 0.2 - (T.width / 2 + 0.25));
      if (w < 0.9) continue;
      const lat = T.width / 2 + 0.25 + w / 2, ang = -Math.atan2(t.dz, t.dx);
      const bx = t.x + t.px * side * lat, bz = t.z + t.pz * side * lat;
      steel.push(boxAt(t.L + 2, 0.05, w, bx, 0.025, bz, 0xa9a8a0, ang));
      const ex = t.x + t.px * side * (T.width / 2 + 0.25 + 0.2);
      const ez = t.z + t.pz * side * (T.width / 2 + 0.25 + 0.2);
      steel.push(boxAt(t.L + 2, 0.058, 0.4, ex, 0.029, ez, 0xc9a93a, ang));
      t['w' + side] = { w, lat };
    }
    info.trams.push({ line: t.line, sign: t.sign, lo: t.lo, hi: t.hi, L: t.L, modules: t.modules, x: t.x, z: t.z });
  }
  if (bodies.length) {
    const a = atlas();
    meshOf(scene, mergeParts(bodies), a.mat, { shadow: true, receive: true, name: 'tram-body' });
    meshOf(scene, mergeParts(darks), M.steel, { shadow: true, receive: true, name: 'tram-dark' });
  }

  // ---- totems « HOMME DE FER » : 2, sur le quai des rames (sinon près des rails)
  {
    const tg = totemGeometry();
    const list = [];
    const spots = placements.map((t) => {
      const side = (t.w1 && (!t['w-1'] || t.w1.w >= t['w-1'].w)) ? 1 : (t['w-1'] ? -1 : 0);
      if (!side) return null;
      const W = t['w' + side], sm = -t.L / 2 + t.L * 0.3, lat = T.width / 2 + 0.25 + W.w - 0.3;
      return { x: t.x + t.dx * sm + t.px * side * lat, z: t.z + t.dz * sm + t.pz * side * lat, dx: t.dx, dz: t.dz };
    }).filter(Boolean);
    for (const t of net.tracks) { // complète avec des totems au bord des rails (côté de la voie le plus dégagé)
      if (spots.length >= 2) break;
      const sRef = t.project(cx, cz, 80, {}).s;
      for (const side of [1, -1]) {
        if (spots.length >= 2) break;
        for (const so of [20, 24, 28, -20, -24, -28]) {
          t.at(sRef + so, tmp);
          const dx = tmp.tx, dz = tmp.tz, px = -dz, pz = dx, x = tmp.x + px * side * 2.6, z = tmp.z + pz * side * 2.6;
          if (zoneOf(x, z) === zi && collision.rayHit(x, 1, z, px * side, 0, pz * side, 1.2) >= 1.2 && collision.rayHit(x, 1, z, dx, 0, dz, 1.2) >= 1.2 && used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > 3)) { spots.push({ x, z, dx, dz }); break; }
        }
      }
    }
    for (const sp of spots.slice(0, 2)) {
      const g = tg.clone();
      g.rotateY(Math.atan2(-sp.dz, sp.dx)); g.translate(sp.x, 0, sp.z);
      list.push(g);
      collision.addBox(sp.x, sp.z, 0.4, 0.15, Math.atan2(sp.dz, sp.dx), 2.8);
      used.push([sp.x, sp.z]);
      info.totems.push({ x: sp.x, z: sp.z });
    }
    if (list.length) meshOf(scene, mergeParts(list), atlas().mat, { shadow: true, name: 'totems' });
  }

  // ---- statue de l'Homme de Fer : hallebardier sur une console, à l'angle sud-ouest de la façade ouest
  {
    const S = HDF.statue, ang = Math.atan2(S.nx, S.nz);
    const px = S.x + S.nx * S.offset, pz = S.z + S.nz * S.offset;
    const { iron, brass } = halberdierGeometries();
    for (const g of [iron, brass]) {
      const mesh = meshOf(scene, g, g === iron ? M.iron : M.brass, { shadow: true, receive: true, name: g === iron ? 'statue-iron' : 'statue-brass' });
      mesh.position.set(px, S.consoleTop, pz); mesh.rotation.y = ang; mesh.scale.setScalar(S.scale);
    }
    // console (0,8 x 0,25 x 0,6 m) et corbeau de pierre en dessous
    const stone = 0x7a6b5b, cons = new THREE.BoxGeometry(0.8, 0.25, 0.6); cons.translate(0, S.consoleTop - 0.125, 0);
    const corbel = new THREE.CylinderGeometry(0.34, 0.12, 0.26, 4); corbel.rotateY(Math.PI / 4); corbel.translate(0, S.consoleTop - 0.38, 0);
    for (const g of [cons, corbel]) { g.rotateY(ang); g.translate(px, 0, pz); steel.push(colorize(g, stone)); }
    lightSources.push({ x: px + S.nx * 1.6, y: 3.4, z: pz + S.nz * 1.6, color: 0xffc890, intensity: 10, dist: 10 });
    info.statue = { x: px, z: pz, top: S.consoleTop + 2.55 * S.scale };
  }

  if (steel.length) meshOf(scene, mergeParts(steel), M.steel, { receive: true, name: 'decor-steel' });

  // zone occupée par le décor (rames et quais, statue) : le mobilier OSM n'y est pas posé (les rails et les quais d'arrêt : tramNet.js)
  info.covers = (x, z) => {
    for (const t of placements) {
      const s = (x - t.x) * t.dx + (z - t.z) * t.dz, lat = (x - t.x) * t.px + (z - t.z) * t.pz;
      if (Math.abs(s) < t.L / 2 + 1.5 && Math.abs(lat) < T.width / 2 + 4.3) return true;
    }
    return Math.hypot(x - info.statue.x, z - info.statue.z) < 3;
  };
  return info;
}
