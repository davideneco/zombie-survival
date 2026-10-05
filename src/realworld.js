import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Collision } from './collision.js';
import { NavGrid } from './nav.js';
import { computeIsland, stitchRings } from './island.js';
import { findBreaches } from './breach.js';
import { preparePassages, cutIntervals, insideRuns, distToPassage } from './passage.js';
import { Levels } from './levels.js';
import { createArchitecture, BAY_W } from './architecture.js';
import { createProps } from './props.js';
import { planCathedral, CEIL, pointInPoly as inPoly } from './cathedral.js';
import { buildCathedral, augmentPlan, PORTAL_H } from './cath/index.js';
import { makePerkMachine, makeAmmoStation, makeWallBuy, addPosts, makeMysteryBox, makePackAPunch, makeAstronomicalClock } from './machines.js';

// =====================================================================
//  Monde réel : la Grande Île de Strasbourg (données OpenStreetMap)
//  Données générées par  tools/fetch-osm.mjs  ->  public/data/area.json
// =====================================================================


const texLoader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res, rej) => texLoader.load(url, res, undefined, rej));
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Mulberry32 : aléatoire reproductible pour que la map soit la même à chaque partie
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadPBR(name, renderer) {
  const base = `/textures/${name}/`;
  const [map, normalMap, roughnessMap] = await Promise.all([
    loadTex(base + 'diff.jpg'),
    loadTex(base + 'nor.jpg').catch(() => null),
    loadTex(base + 'rough.jpg').catch(() => null),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  for (const t of [map, normalMap, roughnessMap]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
  }
  return { map, normalMap, roughnessMap };
}

// Copie des textures PBR avec un répétition (repeat) propre
function tiled(pbr, rx, ry, params = {}) {
  const out = { ...params };
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (!pbr[k]) continue;
    const t = pbr[k].clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    out[k] = t;
  }
  return new THREE.MeshStandardMaterial(out);
}

// ------------------------------------------------------------------
function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function cleanRing(pts) {
  const r = pts.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

// Instanciation : un seul draw call pour N objets identiques (arbres, lampadaires).
function instanced(geo, mat, matrices, colors = null, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = shadow;
  m.frustumCulled = false;
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// Boîte dont les UV suivent les dimensions réelles (1 répétition de texture tous les `tile` mètres)
function worldBox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z (4 sommets chacune)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
  }
  return g;
}

// Fusionne des géométries indexées (position / normal / uv) en une seule
function mergeGeometries(list) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// Normal map procédurale de vaguelettes pour l'eau
function rippleNormalMap() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N);
  const hgt = (u, v) => {
    const a = (u / N) * Math.PI * 2, b = (v / N) * Math.PI * 2;
    return Math.sin(a * 3 + b * 2) * 0.5 + Math.sin(a * 7 - b * 5) * 0.3 + Math.sin(a * 13 + b * 11) * 0.15 + Math.sin(-a * 2 + b * 9) * 0.25;
  };
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const dx = hgt(u + 1, v) - hgt(u - 1, v), dz = hgt(u, v + 1) - hgt(u, v - 1);
    const nx = -dx * 2, nz = -dz * 2, ny = 1, l = Math.hypot(nx, ny, nz);
    const i = (v * N + u) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((nz / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((ny / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const NAV_CELL = 0.75, NAV_MARGIN = 0.5; // marge > rayon des zombies (0,4) : ils ne frôlent plus les murs
const PASSAGE_H = 3.6; // hauteur sous plafond des passages sous immeubles

// Zones du secteur jouable (voir CONFIG.sector)
const ZONE_NAMES = CONFIG.sector.zones.map((z) => z.name);
const NZONES = ZONE_NAMES.length;
const NO_EDGE = -2; // (détection des portes) pas de limite entre deux cases

export async function buildRealWorld(scene, renderer) {
  const rnd = seeded(20240611);
  const data = await (await fetch('/data/area.json')).json();
  const halfX = data.half, halfZ = data.halfZ || data.half;
  const Z = CONFIG.sector;

  const [cobble, plaster, roofP, metalP, barkP, sandP, plasterImg] = await Promise.all([
    loadPBR('cobble', renderer), loadPBR('plaster', renderer), loadPBR('roof', renderer),
    loadPBR('metal', renderer), loadPBR('bark', renderer), loadPBR('sandstone', renderer), loadImg('/textures/plaster/diff.jpg'),
  ]);

  // Anneaux OSM découpés en plusieurs morceaux : on les recolle (sinon murs fantômes / façades à l'envers)
  data.buildings = stitchRings(data.buildings);
  data.water = [...data.water.filter((w) => w.line), ...stitchRings(data.water.filter((w) => !w.line))];

  // ---------------------------------------------------------------- Île jouable (délimitée par l'eau)
  const isl = computeIsland(data, CONFIG.startHint.x, CONFIG.startHint.z);
  const onIsland = (x, z) => {
    const i = Math.floor((x + isl.hx) / isl.cell), j = Math.floor((z + isl.hz) / isl.cell);
    return i >= 0 && j >= 0 && i < isl.nx && j < isl.nz && isl.island[j * isl.nx + i] === 1;
  };

  const collision = new Collision(halfX, halfZ);
  const blockers = [];
  const polygons = [];
  const lightSources = []; // sources de lumière potentielles ; seules les plus proches du joueur sont allumées
  const props = createProps(); // mobilier et décors instanciés

  // ---------------------------------------------------------------- Sol pavé
  {
    const w = halfX * 2 + 60, h = halfZ * 2 + 60;
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    const tile = 2.2; // taille réelle approx. d'une tuile de pavés (m)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    const mat = new THREE.MeshStandardMaterial({
      map: cobble.map, normalMap: cobble.normalMap, roughnessMap: cobble.roughnessMap,
      color: 0xb8b2aa, normalScale: new THREE.Vector2(1.2, 1.2),
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // ---------------------------------------------------------------- Eau (rivière Ill et canaux)
  let waterNormal = null;
  {
    waterNormal = rippleNormalMap();
    waterNormal.repeat.set(1 / 6, 1 / 6);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0f2a3c, roughness: 0.08, metalness: 0.6, normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6),
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const pos = [], idx = [];
    const uvs = [];
    const addTri = (a, b, c) => { const base = pos.length / 3; pos.push(a[0], 0.04, a[1], b[0], 0.04, b[1], c[0], 0.04, c[1]); uvs.push(a[0], a[1], b[0], b[1], c[0], c[1]); idx.push(base, base + 2, base + 1); };
    for (const w of data.water) {
      if (!w.line) {
        const pts = cleanRing(w.pts);
        if (pts.length < 3) continue;
        try {
          const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
          for (const [a, b, c] of tris) addTri(pts[a], pts[b], pts[c]);
        } catch (e) { /* polygone dégénéré */ }
      } else {
        const hw = (w.width || 10) / 2;
        for (let k = 0; k + 1 < w.pts.length; k++) {
          const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1];
          const len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len * hw, nz = (bx - ax) / len * hw;
          const p0 = [ax + nx, az + nz], p1 = [ax - nx, az - nz], p2 = [bx - nx, bz - nz], p3 = [bx + nx, bz + nz];
          addTri(p0, p1, p2); addTri(p0, p2, p3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // normales vers le haut quel que soit l'enroulement
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mesh = new THREE.Mesh(g, waterMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- Bâtiments
  const arch = createArchitecture({ renderer, plasterImg, roofP, rnd });

  const facadeSegs = []; // [ax,az,bx,bz,nx,nz,bays,len] : pour placer les fenêtres d'apparition
  const blds = [];
  for (const bld of data.buildings) {
    const pts = cleanRing(bld.pts);
    if (pts.length < 3) continue;
    const area = polyArea(pts);
    if (Math.abs(area) < 3) continue;
    if (area < 0) pts.reverse();
    blds.push({ pts, h: bld.h, tags: bld.tags || {}, name: bld.name });
  }
  let cathInfo = null;
  const levels = new Levels(); // étages (cathédrale : balcons, escaliers, plateforme, flèche)
  // Cathédrale : intérieur jouable (zone de fin de partie)
  let kCath = blds.findIndex((b) => b.name === 'Cathédrale Notre-Dame');
  if (kCath < 0) kCath = blds.reduce((best, b, k) => (b.tags.building === 'cathedral' && (best < 0 || Math.abs(polyArea(b.pts)) > Math.abs(polyArea(blds[best].pts))) ? k : best), -1);
  const cath = kCath >= 0 ? augmentPlan(planCathedral(blds[kCath].pts, (data.parts || []).map((p) => ({ pts: cleanRing(p.pts), tags: p.tags || {} })))) : null;

  // Passages sous immeubles : on repère les portions d'axe qui passent dans un bâtiment
  const passages = preparePassages(data.passages);
  const BG = 20, bGrid = new Map();
  blds.forEach((b, k) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of b.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    b.box = [minX, minZ, maxX, maxZ];
    for (let gx = Math.floor(minX / BG); gx <= Math.floor(maxX / BG); gx++) for (let gz = Math.floor(minZ / BG); gz <= Math.floor(maxZ / BG); gz++) {
      const key = gx * 4096 + gz;
      if (!bGrid.has(key)) bGrid.set(key, []);
      bGrid.get(key).push(k);
    }
  });
  const insideBuilding = (x, z) => {
    const arr = bGrid.get(Math.floor(x / BG) * 4096 + Math.floor(z / BG));
    return !!arr && arr.some((k) => { const [a, b, c, d] = blds[k].box; return x >= a && x <= c && z >= b && z <= d && pointInPoly(x, z, blds[k].pts); });
  };
  // l'axe d'un passage tracé sur un mur mitoyen n'est "dans" aucun des deux bâtiments : on teste autour
  const axisInside = (x, z) => insideBuilding(x, z) || insideBuilding(x + 0.3, z) || insideBuilding(x - 0.3, z) || insideBuilding(x, z + 0.3) || insideBuilding(x, z - 0.3);
  const passageRuns = insideRuns(passages, axisInside);

  // Bâtiments décrits en 3D par leurs parties : on dessine les parties à la place du contour
  const hasParts = new Set();
  const partsOf = new Map(); // bâtiment -> parties qui touchent le sol (ce qu'on voit réellement : seul cela doit bloquer)
  {
    const covered = new Map();
    for (const prt of data.parts || []) {
      const pts = cleanRing(prt.pts);
      if (pts.length < 3) continue;
      const cx = pts.reduce((s2, q) => s2 + q[0], 0) / pts.length, cz = pts.reduce((s2, q) => s2 + q[1], 0) / pts.length;
      const arr = bGrid.get(Math.floor(cx / BG) * 4096 + Math.floor(cz / BG)) || [];
      const k = arr.find((i) => { const [a, b, c, d] = blds[i].box; return cx >= a && cx <= c && cz >= b && cz <= d && pointInPoly(cx, cz, blds[i].pts); });
      if (k != null) {
        prt._k = k;
        covered.set(k, (covered.get(k) || 0) + Math.abs(polyArea(pts)));
        if ((parseFloat(prt.tags?.min_height) || 0) < 2.5) {
          let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
          for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
          if (!partsOf.has(k)) partsOf.set(k, []);
          partsOf.get(k).push({ pts, minX, minZ, maxX, maxZ });
        }
      }
    }
    for (const [k, a] of covered) if (a >= 0.4 * Math.abs(polyArea(blds[k].pts))) hasParts.add(k);
  }
  for (const r of passageRuns) { // prolonge un peu pour rejoindre la façade
    const ext = (a, b) => { const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1; return [a[0] + (dx / l) * 0.5, a[1] + (dz / l) * 0.5]; };
    r.pts[0] = ext(r.pts[0], r.pts[1]);
    r.pts[r.pts.length - 1] = ext(r.pts[r.pts.length - 1], r.pts[r.pts.length - 2]);
  }

  // Un mur de contour n'existe que là où une partie 3D est dessinée : sinon il resterait un mur invisible (Palais Rohan, cathédrale…)
  const distToRing = (x, z, pts) => {
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j][0], az = pts[j][1], abx = pts[i][0] - ax, abz = pts[i][1] - az, l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(x - ax - abx * t, z - az - abz * t));
    }
    return best;
  };
  const supportedRuns = (k, ax, az, bx, bz) => {
    const parts = partsOf.get(k) || [];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.5));
    const runs = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const ok = i < n + 1 && parts.some((q) => x >= q.minX - 1 && x <= q.maxX + 1 && z >= q.minZ - 1 && z <= q.maxZ + 1 && (pointInPoly(x, z, q.pts) || distToRing(x, z, q.pts) < 1));
      if (ok && start < 0) start = Math.max(0, (i - 1) / n);
      if (!ok && start >= 0) { runs.push([start, Math.min(1, i / n)]); start = -1; }
    }
    if (start >= 0) runs.push([start, 1]);
    return runs;
  };
  // intersection de deux listes d'intervalles triés
  const clipRuns = (runs, cuts) => {
    let out = runs;
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [a, b] of out) {
        if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
      out = next;
    }
    return out;
  };

  // Place de départ ; brèches (bâtiments effondrés) seulement si aucun passage ne la relie à la ville
  const breach = findBreaches(blds.map((b) => b.pts), halfX, halfZ, CONFIG.startHint, CONFIG.cityHint, CONFIG.breaches, NAV_CELL, NAV_MARGIN, passages);
  const rubble = [];
  for (const [k, bld] of blds.entries()) {
    const pts = bld.pts;
    if (breach.removed.has(k)) { rubble.push(pts); continue; }

    // bâtiment annexe cartographié à l'intérieur de la cathédrale (chapelle, sacristie…) : on le retire
    if (cath && k !== kCath) {
      // un seul coin sous la voûte, ou un coin de l'intérieur dans le bâtiment, suffit à le retirer
      if (pts.some(([x, z]) => cath.insideInner(x, z)) || cath.inner.some(([x, z]) => inPoly(x, z, pts))) continue;
    }
    if (k === kCath && cath) {
      // creuse : seul le contour extérieur bloque (ouvert au grand portail) ; l'intérieur est construit à part
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], dx = bx - ax, dz = bz - az;
        for (const [t0, t1] of clipRuns(supportedRuns(k, ax, az, bx, bz), cath.cutsOf(ax, az, bx, bz))) {
          if ((t1 - t0) * Math.hypot(dx, dz) > 0.05) collision.addSegment(ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1);
        }
      }
      continue;
    }
    const partial = hasParts.has(k);
    if (partial) { for (const q of partsOf.get(k) || []) if (Math.abs(polyArea(q.pts)) > 1) polygons.push({ pts: q.pts }); }
    else polygons.push({ pts });
    const edgeCuts = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      // ouvertures des passages sous immeubles : pas de mur en bas, seulement le linteau au-dessus
      const cuts = len >= 0.05 ? cutIntervals(passages, ax, az, bx, bz, axisInside) : [];
      edgeCuts.push(cuts);
      let solid = [];
      let t = 0;
      for (const [t0, t1] of cuts) { if (t0 > t) solid.push([t, t0]); t = t1; }
      if (t < 1) solid.push([t, 1]);
      if (partial) solid = clipRuns(supportedRuns(k, ax, az, bx, bz), cuts);
      for (const [t0, t1] of solid) if ((t1 - t0) * len > 0.05) collision.addSegment(ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1);
      if (len < 0.3 || partial) continue;
      facadeSegs.push([ax, az, bx, bz, dz / len, -dx / len, Math.max(1, Math.round(len / BAY_W)), len]);
    }
    if (hasParts.has(k)) continue; // rendu à partir de ses parties 3D (cathédrale, églises…)
    const cx = pts.reduce((s2, q) => s2 + q[0], 0) / pts.length, cz = pts.reduce((s2, q) => s2 + q[1], 0) / pts.length;
    const near = Math.hypot(cx - CONFIG.startHint.x, cz - CONFIG.startHint.z) < 420; // détails (boutiques, lucarnes) près du secteur
    const commercial = !!bld.tags.amenity || ['retail', 'commercial', 'hotel'].includes(bld.tags.building);
    arch.building(pts, bld.tags, bld.h, (i) => edgeCuts[i], { inSector: near, shop: commercial || (near && rnd() < 0.38), passageH: PASSAGE_H });
  }

  // Parties 3D (OSM building:part) : cathédrale, églises, tours
  for (const prt of data.parts || []) {
    const pts = cleanRing(prt.pts);
    if (pts.length < 3) continue;
    if (polyArea(pts) < 0) pts.reverse();
    let opts = {};
    if (cath) {
      const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
      if (inPoly(c[0], c[1], cath.outline)) {
        const top = parseFloat(prt.tags.height) || 0, minH = parseFloat(prt.tags.min_height) || 0;
        const sc = cath.S(c[0], c[1]), tc = cath.T(c[0], c[1]);
        const inMassif = sc > -53 && sc < -26 && Math.abs(tc) < 27;
        const tw = cath.P(-39.5, -14);
        // remplacés par les étages modélisés (cath/) : planchers du massif, maisonnette de l'escalier, tour nord et flèche
        if (inMassif && top - minH <= 1.6 && polyArea(pts) > 300) continue;
        if (minH >= 65 && sc > -48 && sc < -29 && tc > 6 && tc < 22) continue;
        if (minH >= 60 && Math.hypot(c[0] - tw[0], c[1] - tw[1]) < 13) continue;
        opts = {
          // un mur dont l'extérieur donne sur l'intérieur de l'édifice est une cloison : masqué jusqu'à la hauteur des voûtes
          keepEdge: (ax, az, bx, bz, wallTop) => {
            const len = Math.hypot(bx - ax, bz - az) || 1, n = Math.max(1, Math.ceil(len / 1.5));
            const nx = (bz - az) / len, nz = -(bx - ax) / len;
            const sgn = inPoly((ax + bx) / 2 + nx * 0.3, (az + bz) / 2 + nz * 0.3, pts) ? -1 : 1; // sens vers l'extérieur de la partie
            let ext = 0, hideTo = 0;
            for (let i = 0; i <= n; i++) {
              const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
              const o = cath.ceilAt(x + nx * sgn * 0.7, z + nz * sgn * 0.7), here = cath.ceilAt(x, z);
              if (o == null && here == null) { ext++; continue; }
              hideTo = Math.max(hideTo, o || 0, here || 0, cath.ceilAt(x - nx * sgn * 0.7, z - nz * sgn * 0.7) || 0);
            }
            if (ext > n / 2) return true; // mur extérieur
            return wallTop > hideTo + 0.5 ? hideTo + 0.2 : false;
          },
          cutsOf: cath.cutsOf, portalH: PORTAL_H,
          skipRoof: (cath.ceilAt(c[0], c[1]) != null && top <= cath.ceilAt(c[0], c[1]) + 0.5) || (inMassif && polyArea(pts) > 500),
        };
      }
    }
    let tags = prt.tags || {};
    if (tags.height == null && prt._k != null && !tags['min_height']) { // partie sans hauteur : elle prend celle du bâtiment (Palais Rohan…)
      const bh = blds[prt._k].h || 12;
      tags = { ...tags, height: String(bh) };
      if ((tags['roof:shape'] || 'flat') !== 'flat' && tags['roof:height'] == null) tags['roof:height'] = String(Math.min(5, bh * 0.4));
    }
    arch.part(pts, tags, opts);
  }
  arch.finish(scene);

  // ---------------------------------------------------------------- Intérieur des passages sous immeubles
  {
    const pos = [], nor = [], uv = [], idx = [];
    const quad = (p0, p1, p2, p3, n, u0, u1, v0, v1) => {
      const base = pos.length / 3;
      pos.push(...p0, ...p1, ...p2, ...p3);
      for (let k = 0; k < 4; k++) nor.push(...n);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const r of passageRuns) {
      const P = r.pts, hw = r.hw;
      let dist = 0;
      const sides = { L: [], R: [] };
      for (let k = 0; k < P.length; k++) {
        const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        sides.L.push([P[k][0] + nx * hw, P[k][1] + nz * hw, nx, nz]);
        sides.R.push([P[k][0] - nx * hw, P[k][1] - nz * hw, -nx, -nz]);
      }
      for (let k = 0; k + 1 < P.length; k++) {
        const seg = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
        const u0 = dist / 2, u1 = (dist + seg) / 2;
        dist += seg;
        for (const side of ['L', 'R']) {
          const a = sides[side][k], b = sides[side][k + 1];
          collision.addSegment(a[0], a[1], b[0], b[1]);
          // murs latéraux (normales vers l'axe du passage)
          quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], PASSAGE_H, b[1]], [a[0], PASSAGE_H, a[1]], [-a[2], 0, -a[3]], u0, u1, 0, PASSAGE_H / 2);
        }
        const l0 = sides.L[k], l1 = sides.L[k + 1], r0 = sides.R[k], r1 = sides.R[k + 1];
        quad([l0[0], PASSAGE_H, l0[1]], [l1[0], PASSAGE_H, l1[1]], [r1[0], PASSAGE_H, r1[1]], [r0[0], PASSAGE_H, r0[1]], [0, -1, 0], u0, u1, 0, hw);
      }
      const mid = P[Math.floor(P.length / 2)];
      lightSources.push({ x: mid[0], y: PASSAGE_H - 0.4, z: mid[1], color: 0xffb867, intensity: 10, dist: 8 });
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, tiled(plaster, 1, 1, { color: 0x8a8070, side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ---------------------------------------------------------------- Limites de l'île
  // Contour lissé (marching squares) : parapet de quai en grès côté eau, grille côté terre (ponts).
  // Chaque mur qui bloque le joueur est donc visible.
  {
    const { cell, nx, nz, hx, hz } = isl;
    const val = (i, j) => (i >= 0 && j >= 0 && i < nx && j < nz && isl.island[j * nx + i] === 1 ? 1 : 0);
    const isWater = (i, j) => i < 0 || j < 0 || i >= nx || j >= nz || isl.rawWater[j * nx + i] === 1;
    const PH = 1.1, PT = 0.5, FH = 3.2, FT = 0.25;
    const parapets = [], fences = [];
    const wall = (ax, az, bx, bz, water) => {
      collision.addSegment(ax, az, bx, bz);
      const len = Math.hypot(bx - ax, bz - az);
      const h = water ? PH : FH, t = water ? PT : FT;
      const g = worldBox(len + t * 0.6, h, t, water ? 1.5 : 2.2);
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate((ax + bx) / 2, h / 2, (az + bz) / 2);
      (water ? parapets : fences).push(g);
    };
    // coins = centres des cases ; milieux d'arêtes : haut, droite, bas, gauche
    const SEGS = {
      1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']], 5: [['L', 'T'], ['B', 'R']],
      6: [['T', 'B']], 7: [['L', 'T']], 8: [['L', 'T']], 9: [['T', 'B']], 10: [['T', 'R'], ['L', 'B']],
      11: [['T', 'R']], 12: [['L', 'R']], 13: [['B', 'R']], 14: [['L', 'B']],
    };
    for (let j = -1; j < nz; j++) {
      for (let i = -1; i < nx; i++) {
        const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
        const k = a * 8 + b * 4 + c * 2 + d;
        if (k === 0 || k === 15) continue;
        const x0 = (i + 0.5) * cell - hx, z0 = (j + 0.5) * cell - hz, x1 = x0 + cell, z1 = z0 + cell;
        const P = { T: [(x0 + x1) / 2, z0], R: [x1, (z0 + z1) / 2], B: [(x0 + x1) / 2, z1], L: [x0, (z0 + z1) / 2] };
        // côté extérieur : eau si un des coins hors de l'île est de l'eau
        const water = (!a && isWater(i, j)) || (!b && isWater(i + 1, j)) || (!c && isWater(i + 1, j + 1)) || (!d && isWater(i, j + 1));
        for (const [u, v] of SEGS[k]) wall(P[u][0], P[u][1], P[v][0], P[v][1], water);
      }
    }
    if (parapets.length) {
      const m = new THREE.Mesh(mergeGeometries(parapets), tiled(sandP, 1, 1, { color: 0xb07a6a }));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    if (fences.length) {
      const m = new THREE.Mesh(mergeGeometries(fences), tiled(metalP, 1, 1, { color: 0x77776f, metalness: 0.5 }));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ---------------------------------------------------------------- Gravats des bâtiments effondrés
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f8574, roughness: 1, flatShading: true });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    for (const pts of rubble) {
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        for (let k = 0; k < 2; k++) {
          const r = rand(0.35, 0.8);
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x + rand(-0.6, 0.6), r * 0.4, z + rand(-0.6, 0.6));
          m.scale.set(r, r * 0.7, r * rand(0.8, 1.3));
          m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
          m.castShadow = m.receiveShadow = true;
          scene.add(m);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Arbres (instanciés)
  const treeMatrices = { trunk: [], leaf: [], leafCol: [] };
  {
    const leafCols = [0x3c5a2a, 0x4a6230, 0x566a2c].map((c) => new THREE.Color(c));
    const dummy = new THREE.Object3D();
    for (const [x, z] of data.trees) {
      const th = rand(3.2, 4.5);
      dummy.position.set(x, th / 2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, th, 1); dummy.updateMatrix();
      treeMatrices.trunk.push(dummy.matrix.clone());
      const col = pick(leafCols);
      for (let i = 0; i < 4; i++) {
        const r = rand(1.2, 1.9);
        dummy.position.set(x + rand(-1, 1), th + rand(-0.2, 1.4), z + rand(-1, 1));
        dummy.scale.set(r, r * 0.8, r); dummy.updateMatrix();
        treeMatrices.leaf.push(dummy.matrix.clone());
        treeMatrices.leafCol.push(col);
      }
      if (onIsland(x, z)) collision.addCircle(x, z, 0.3);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1, 8);
    scene.add(instanced(trunkGeo, tiled(barkP, 1, 2, { color: 0x8a8076 }), treeMatrices.trunk));
    scene.add(instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), treeMatrices.leaf, treeMatrices.leafCol));
  }

  // ---------------------------------------------------------------- Intérieur de la cathédrale
  if (cath) cathInfo = buildCathedral({ scene, plan: cath, collision, lightSources, props, levels });

  // ---------------------------------------------------------------- Navigation de base (pour placer les props)
  collision.build();
  const nav = new NavGrid(halfX, halfZ, collision, polygons, NAV_CELL, NAV_MARGIN, 1300);
  nav.segFilter = (it) => collision._blocks(it, 0); // la grille du sol ignore les obstacles d'étage (garde-corps, murs des tours…)
  nav.outside = (x, z) => !onIsland(x, z);
  nav.carve = (b) => {
    for (const r of passageRuns) {
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
        const ix0 = Math.max(0, nav.cx(Math.min(ax, bx) - r.hw)), ix1 = Math.min(nav.nx - 1, nav.cx(Math.max(ax, bx) + r.hw));
        const iz0 = Math.max(0, nav.cz(Math.min(az, bz) - r.hw)), iz1 = Math.min(nav.nz - 1, nav.cz(Math.max(az, bz) + r.hw));
        const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
          const px = nav.worldX(ix), pz = nav.worldZ(iz);
          let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(px - ax - abx * t, pz - az - abz * t) < r.hw) b[iz * nav.nx + ix] = 0;
        }
      }
    }
  };
  nav.build();

  const clearance = (ix, iz, r) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (!nav.inside(jx, jz) || nav.blocked[nav.idx(jx, jz)]) return false;
    }
    return true;
  };

  // Départ : case dégagée (>= 4,5 m de tout obstacle) la plus proche de la place Kléber
  let startCell = null;
  {
    const c0x = nav.cx(CONFIG.startHint.x), c0z = nav.cz(CONFIG.startHint.z);
    for (let r = 0; r < 260 && !startCell; r++) {
      for (let dz = -r; dz <= r && !startCell; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (nav.inside(c0x + dx, c0z + dz) && clearance(c0x + dx, c0z + dz, 6)) { startCell = [c0x + dx, c0z + dz]; break; }
      }
    }
  }
  if (!startCell) startCell = nav.nearestFree(CONFIG.startHint.x, CONFIG.startHint.z, 200);
  const startPos = new THREE.Vector3(nav.worldX(startCell[0]), 0, nav.worldZ(startCell[1]));

  // Cases accessibles à pied depuis le départ (exclut cours intérieures et autres poches isolées)
  const reach = new Uint8Array(nav.nx * nav.nz);
  {
    const stack = new Int32Array(nav.nx * nav.nz);
    let sp = 0;
    const s0 = nav.idx(startCell[0], startCell[1]);
    reach[s0] = 1; stack[sp++] = s0;
    while (sp) {
      const c = stack[--sp], x = c % nav.nx, z = (c / nav.nx) | 0;
      const tryPush = (j) => { if (!reach[j] && !nav.blocked[j]) { reach[j] = 1; stack[sp++] = j; } };
      if (x > 0) tryPush(c - 1);
      if (x < nav.nx - 1) tryPush(c + 1);
      if (z > 0) tryPush(c - nav.nx);
      if (z < nav.nz - 1) tryPush(c + nav.nx);
    }
  }
  const reachAt = (x, z) => { const ix = nav.cx(x), iz = nav.cz(z); return nav.inside(ix, iz) && reach[nav.idx(ix, iz)] === 1; };

  // ---------------------------------------------------------------- Zones du secteur jouable
  // Chaque zone part d'un vrai lieu ; chaque case accessible va à la zone la plus proche en distance de marche
  // (les limites tombent au milieu des rues). Au-delà de maxDist : hors secteur, fermé par des barricades.
  const startZone = Z.zones.findIndex((z) => z.start);
  const zoneLabel = new Int8Array(nav.nx * nav.nz).fill(-1);
  const seeds = new Array(NZONES).fill(null); // [x, z] du lieu de chaque zone
  {
    const N = nav.nx * nav.nz, INFD = 0x3fffffff;
    for (let i = 0; i < N; i++) if (breach.startMask[i] && reach[i]) zoneLabel[i] = startZone;
    seeds[startZone] = [startPos.x, startPos.z];
    const dist = new Int32Array(N).fill(INFD);
    const buckets = [[]];
    Z.zones.forEach((z, zi) => {
      if (z.start) return;
      // case accessible la plus proche du lieu (le point donné peut tomber dans un bâtiment)
      let c = null;
      const sd = z.seed === 'cathedral' ? (cath ? { x: cath.seed[0], z: cath.seed[1] } : null) : z.seed;
      if (!sd) return;
      const c0x = nav.cx(sd.x), c0z = nav.cz(sd.z);
      for (let r = 0; r <= 60 && !c; r++) {
        for (let dz = -r; dz <= r && !c; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !nav.inside(c0x + dx, c0z + dz)) continue;
          const j = nav.idx(c0x + dx, c0z + dz);
          if (reach[j] && zoneLabel[j] < 0 && !breach.startMask[j]) { c = [c0x + dx, c0z + dz]; break; }
        }
      }
      if (!c) { console.warn('[zones] lieu introuvable :', z.name); return; }
      const i = nav.idx(c[0], c[1]);
      dist[i] = 0; zoneLabel[i] = zi; buckets[0].push(i);
      seeds[zi] = [nav.worldX(c[0]), nav.worldZ(c[1])];
    });
    const maxCost = Math.round((Z.maxDist / nav.cell) * 10);
    const NB = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    for (let d = 0; d < buckets.length && d <= maxCost; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (const i of bucket) {
        if (dist[i] !== d) continue;
        const ix = i % nav.nx, iz = (i / nav.nx) | 0;
        for (const [dx, dz, c] of NB) {
          const jx = ix + dx, jz = iz + dz;
          if (!nav.inside(jx, jz)) continue;
          const j = jz * nav.nx + jx;
          if (!reach[j] || breach.startMask[j]) continue;
          if (dx && dz && (!reach[iz * nav.nx + jx] || !reach[jz * nav.nx + ix])) continue;
          const nd = d + c;
          if (nd <= maxCost && nd < dist[j]) { dist[j] = nd; zoneLabel[j] = zoneLabel[i]; (buckets[nd] || (buckets[nd] = [])).push(j); }
        }
      }
      buckets[d] = null;
    }
  }
  // version étendue aux cases bloquées voisines (joueur collé à un mur, machines contre les façades)
  const zoneLabelWide = zoneLabel.slice();
  {
    let front = [];
    for (let i = 0; i < zoneLabel.length; i++) if (zoneLabel[i] >= 0) front.push(i);
    for (let step = 0; step < 6; step++) {
      const next = [];
      for (const i of front) {
        const ix = i % nav.nx, iz = (i / nav.nx) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = ix + dx, jz = iz + dz;
          if (!nav.inside(jx, jz)) continue;
          const j = jz * nav.nx + jx;
          if (zoneLabelWide[j] >= 0 || reach[j]) continue;
          zoneLabelWide[j] = zoneLabelWide[i]; next.push(j);
        }
      }
      front = next;
    }
  }
  const zoneOf = (x, z) => {
    const ix = nav.cx(x), iz = nav.cz(z);
    return nav.inside(ix, iz) ? zoneLabelWide[nav.idx(ix, iz)] : -1;
  };
  const zoneOpen = new Array(NZONES).fill(false);
  zoneOpen[startZone] = true;
  const zoneCells = Array.from({ length: NZONES }, () => ({ n: 0, sx: 0, sz: 0 }));
  let secMinX = Infinity, secMaxX = -Infinity, secMinZ = Infinity, secMaxZ = -Infinity;
  for (let iz = 0; iz < nav.nz; iz += 3) for (let ix = 0; ix < nav.nx; ix += 3) {
    const zl = zoneLabel[nav.idx(ix, iz)];
    if (zl < 0) continue;
    const x = nav.worldX(ix), z = nav.worldZ(iz), zc = zoneCells[zl];
    zc.n++; zc.sx += x; zc.sz += z;
    secMinX = Math.min(secMinX, x); secMaxX = Math.max(secMaxX, x); secMinZ = Math.min(secMinZ, z); secMaxZ = Math.max(secMaxZ, z);
  }

  const candidatesNear = (cx, cz, minClear, minD, maxD) => {
    const out = [];
    const r0 = Math.ceil(maxD / nav.cell);
    const c0x = nav.cx(cx), c0z = nav.cz(cz);
    for (let iz = c0z - r0; iz <= c0z + r0; iz += 2) for (let ix = c0x - r0; ix <= c0x + r0; ix += 2) {
      if (!nav.inside(ix, iz) || !reach[nav.idx(ix, iz)]) continue;
      const wx = nav.worldX(ix), wz = nav.worldZ(iz);
      const d = Math.hypot(wx - cx, wz - cz);
      if (d < minD || d > maxD) continue;
      if (clearance(ix, iz, minClear)) out.push([wx, wz]);
    }
    return out;
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Points aléatoires accessibles dans le secteur jouable (props)
  const randomSpots = (count, minClear) => {
    const out = [];
    for (let t = 0; t < count * 60 && out.length < count; t++) {
      const x = secMinX + rnd() * (secMaxX - secMinX), z = secMinZ + rnd() * (secMaxZ - secMinZ);
      const ix = nav.cx(x), iz = nav.cz(z);
      if (nav.inside(ix, iz) && zoneLabel[nav.idx(ix, iz)] >= 0 && clearance(ix, iz, minClear)) out.push([x, z]);
    }
    return out;
  };

  // ---------------------------------------------------------------- Fenêtres d'apparition (rez-de-chaussée)
  const windowSpawns = [];
  const winGrid = new Map();
  const WIN_CELL = 40;
  const winKey = (cx, cz) => cx * 4096 + cz;
  {
    const c = document.createElement('canvas'); c.width = 128; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.beginPath();
    x.moveTo(6, 14); x.lineTo(40, 4); x.lineTo(70, 16); x.lineTo(102, 6); x.lineTo(122, 18);
    x.lineTo(118, 70); x.lineTo(124, 130); x.lineTo(120, 190); x.lineTo(86, 180); x.lineTo(54, 194);
    x.lineTo(20, 182); x.lineTo(8, 188); x.lineTo(12, 120); x.lineTo(4, 60); x.closePath(); x.fill();
    for (let i = 0; i < 26; i++) {
      const side = Math.floor(Math.random() * 4);
      const px = side < 2 ? Math.random() * 128 : (side === 2 ? 4 : 124);
      const py = side < 2 ? (side === 0 ? 6 : 192) : Math.random() * 200;
      x.fillStyle = `rgba(140,160,175,${0.25 + Math.random() * 0.35})`;
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(px + (Math.random() - 0.3) * 30, py + (Math.random() - 0.5) * 30);
      x.lineTo(px + (Math.random() - 0.7) * 30, py + (Math.random() - 0.5) * 30);
      x.closePath(); x.fill();
    }
    const brokenTex = new THREE.CanvasTexture(c);
    brokenTex.colorSpace = THREE.SRGBColorSpace;
    const WW = 1.3, WH = 2.06, WY = 1.7;
    const quadGeo = new THREE.PlaneGeometry(WW, WH);

    const makeQuad = (nx, nz, cx, cz) => {
      const g = new THREE.Group();
      const glow = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial({
        color: 0xff2a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      }));
      const broken = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial({
        map: brokenTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      }));
      broken.visible = false;
      broken.position.z = 0.012;
      g.add(glow, broken);
      g.position.set(cx + nx * 0.03, WY, cz + nz * 0.03);
      g.rotation.y = Math.atan2(nx, nz);
      g.userData.warn = (t) => { glow.material.opacity = 0.18 + 0.4 * Math.abs(Math.sin(t * 13)); };
      g.userData.broke = () => { glow.material.opacity = 0; broken.visible = true; };
      scene.add(g);
      return g;
    };

    for (const [ax, az, bx, bz, nx, nz, bays, len] of facadeSegs) {
      if (len < 3.2) continue;
      for (let k = 0; k < bays; k += 2) { // une travée sur deux : suffisant et plus léger
        const u = (k + 0.5) / bays;
        const px = ax + (bx - ax) * u, pz = az + (bz - az) * u;
        if (distToPassage(passages, px, pz) < 3.2) continue;
        const ox = px + nx * 1.2, oz = pz + nz * 1.2;
        const ix = nav.cx(ox), iz = nav.cz(oz);
        if (!nav.inside(ix, iz) || nav.blocked[nav.idx(ix, iz)] || !reach[nav.idx(ix, iz)]) continue;
        const sp = {
          type: 'window',
          outside: new THREE.Vector3(ox, 0, oz),
          inside: new THREE.Vector3(px - nx * 0.9, 0, pz - nz * 0.9),
          center: new THREE.Vector3(px + nx * 0.1, WY, pz + nz * 0.1),
          nx, nz, yaw: Math.atan2(nx, nz), busyUntil: 0, _q: null,
          index: windowSpawns.length, zone: zoneOf(ox, oz),
          getQuad() { return this._q || (this._q = makeQuad(nx, nz, px, pz)); },
        };
        windowSpawns.push(sp);
        const key = winKey(Math.floor(ox / WIN_CELL), Math.floor(oz / WIN_CELL));
        let arr = winGrid.get(key);
        if (!arr) { arr = []; winGrid.set(key, arr); }
        arr.push(sp);
      }
    }
  }

  // Fenêtre libre à distance [minD, maxD] du point (px, pz), dans une zone ouverte
  const pickWindow = (px, pz, minD, maxD, now) => {
    const c0x = Math.floor((px - maxD) / WIN_CELL), c1x = Math.floor((px + maxD) / WIN_CELL);
    const c0z = Math.floor((pz - maxD) / WIN_CELL), c1z = Math.floor((pz + maxD) / WIN_CELL);
    const ok = [];
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const arr = winGrid.get(winKey(cx, cz));
      if (!arr) continue;
      for (const w of arr) {
        if (!zoneOpen[w.zone] || w.busyUntil > now) continue;
        const d = Math.hypot(w.outside.x - px, w.outside.z - pz);
        if (d >= minD && d <= maxD) ok.push(w);
      }
    }
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  };

  // Point d'apparition au sol : case accessible, dans une zone ouverte, hors de vue immédiate
  const pickGround = (px, pz, minD, maxD) => {
    for (let t = 0; t < 80; t++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const ix = nav.cx(x), iz = nav.cz(z);
      if (!nav.inside(ix, iz) || !reach[nav.idx(ix, iz)] || !zoneOpen[zoneOf(x, z)]) continue;
      if (!clearance(ix, iz, 1)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  };

  // ---------------------------------------------------------------- Bornes de munitions et armes murales (une série par zone)
  const stations = [];
  const wallWeapons = [];
  const addStation = (x, z, faceX, faceZ) => {
    const g = makeAmmoStation();
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(faceX - x, faceZ - z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    const [w, d, h] = g.userData.size;
    collision.addBox(x, z, w, d, -g.rotation.y, h);
    lightSources.push({ x, y: 2.6, z, color: 0x9fffb0, intensity: 6, dist: 7 });
    stations.push(new THREE.Vector3(x, 0, z));
  };

  // Arme murale : planche avec le dessin à la craie, accrochée sur le mur le plus proche (sinon sur deux poteaux)
  const addWallBuy = (id, name, price, ammoPrice, colorHex, spot, faceX, faceZ) => {
    if (!spot) return;
    let [x, z] = spot;
    let best = 5, ang = null;
    for (let a = 0; a < 36; a++) {
      const t = (a / 36) * Math.PI * 2, cx = Math.cos(t), cz = Math.sin(t);
      const d = collision.rayHit(x, 1.5, z, cx, 0, cz, 5);
      if (d >= best) continue;
      // le panneau (1,6 m) doit tenir sur un pan de mur plat : rayons parallèles à ±0,75 m
      const ok = [-0.75, 0.75].every((o) => Math.abs(collision.rayHit(x - cz * o, 1.5, z + cx * o, cx, 0, cz, 6) - d) < 0.25);
      if (ok) { best = d; ang = t; }
    }
    const g = makeWallBuy(id, name, price, colorHex);
    let rot;
    if (ang != null) {
      x += Math.cos(ang) * (best - 0.06); z += Math.sin(ang) * (best - 0.06);
      rot = Math.atan2(-Math.cos(ang), -Math.sin(ang)); // dos contre le mur
    } else {
      addPosts(g);
      rot = Math.atan2(faceX - x, faceZ - z);
      collision.addBox(x, z, 1.6, 0.2, -rot, 2.2);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    // point d'interaction devant la planche
    const fx = x + Math.sin(rot) * 0.6, fz = z + Math.cos(rot) * 0.6;
    wallWeapons.push({ id, name, price, ammoPrice, pos: new THREE.Vector3(fx, 0, fz) });
    lightSources.push({ x: fx, y: 2.5, z: fz, color: 0xffd8a0, intensity: 4, dist: 5 });
  };

  // ---------------------------------------------------------------- Portes payantes entre les zones
  // Partout où deux cases accessibles voisines appartiennent à deux zones différentes, on pose une barrière ;
  // les barrières d'une même paire de zones forment une seule porte (un seul achat).
  const doors = [];
  const sealedGroups = [];
  const sealedPoints = []; // pour la carte
  let door_depth;
  {
    const cell = nav.cell, ext = cell + 0.3;
    const groups = new Map(); // "a-b" -> { a, b, runs: [{x0,z0,x1,z1}] }
    const addRun = (a, b, r) => {
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!groups.has(k)) groups.set(k, { a: Math.min(a, b), b: Math.max(a, b), runs: [] });
      groups.get(k).runs.push(r);
    };
    // arêtes verticales : entre (ix, iz) et (ix + 1, iz)
    for (let ix = 0; ix < nav.nx - 1; ix++) {
      const ex = nav.worldX(ix) + cell / 2;
      let start = -1, pa = -1, pb = -1;
      for (let iz = 0; iz <= nav.nz; iz++) {
        let a = NO_EDGE, b = NO_EDGE;
        if (iz < nav.nz) {
          const i = nav.idx(ix, iz);
          if (reach[i] && reach[i + 1]) {
            a = zoneLabel[i]; b = zoneLabel[i + 1];
            if (a === b) a = b = NO_EDGE;
          }
        }
        if (start >= 0 && (a !== pa || b !== pb)) { addRun(pa, pb, { x0: ex, z0: nav.worldZ(start) - ext, x1: ex, z1: nav.worldZ(iz - 1) + ext }); start = -1; }
        if (a !== NO_EDGE && start < 0) { start = iz; pa = a; pb = b; }
      }
    }
    // arêtes horizontales : entre (ix, iz) et (ix, iz + 1)
    for (let iz = 0; iz < nav.nz - 1; iz++) {
      const ez = nav.worldZ(iz) + cell / 2;
      let start = -1, pa = -1, pb = -1;
      for (let ix = 0; ix <= nav.nx; ix++) {
        let a = NO_EDGE, b = NO_EDGE;
        if (ix < nav.nx) {
          const i = nav.idx(ix, iz);
          if (reach[i] && reach[i + nav.nx]) {
            a = zoneLabel[i]; b = zoneLabel[i + nav.nx];
            if (a === b) a = b = NO_EDGE;
          }
        }
        if (start >= 0 && (a !== pa || b !== pb)) { addRun(pa, pb, { x0: nav.worldX(start) - ext, z0: ez, x1: nav.worldX(ix - 1) + ext, z1: ez }); start = -1; }
        if (a !== NO_EDGE && start < 0) { start = ix; pa = a; pb = b; }
      }
    }

    // profondeur de chaque zone (nombre de portes depuis le départ) -> prix
    // Depuis la place de départ : une porte par brèche (barrières proches < 12 m).
    // Entre deux autres zones : une seule porte pour toute la limite (un achat ouvre toutes les rues).
    const links = [];
    for (const g of groups.values()) {
      if (g.a < 0) { sealedGroups.push(g); continue; } // limite du secteur : barricade définitive
      if (g.a !== startZone && g.b !== startZone) { links.push(g); continue; }
      const left = g.runs.slice();
      while (left.length) {
        const cluster = [left.pop()];
        for (let grown = true; grown;) {
          grown = false;
          for (let i = left.length - 1; i >= 0; i--) {
            const r = left[i];
            const close = cluster.some((c) => Math.min(
              Math.hypot(c.x0 - r.x0, c.z0 - r.z0), Math.hypot(c.x0 - r.x1, c.z0 - r.z1),
              Math.hypot(c.x1 - r.x0, c.z1 - r.z0), Math.hypot(c.x1 - r.x1, c.z1 - r.z1)) < 12);
            if (close) { cluster.push(r); left.splice(i, 1); grown = true; }
          }
        }
        links.push({ a: g.a, b: g.b, runs: cluster });
      }
    }
    const depth = new Array(NZONES).fill(Infinity);
    depth[startZone] = 0;
    for (let changed = true; changed;) {
      changed = false;
      for (const g of links) {
        if (depth[g.a] + 1 < depth[g.b]) { depth[g.b] = depth[g.a] + 1; changed = true; }
        if (depth[g.b] + 1 < depth[g.a]) { depth[g.a] = depth[g.b] + 1; changed = true; }
      }
    }

    // Les barrières en escalier (cases de 75 cm) qui se touchent forment une ouverture de rue :
    // on la remplace par un segment droit qui suit la rue (si l'escalier est bien rectiligne).
    // ajuste une droite sur un groupe de barrières ; si l'escalier n'est pas rectiligne, on le coupe en deux et on recommence
    const fitInto = (out) => {
      const fit = (cl, depth) => {
        const P = cl.flatMap((r) => [[r.x0, r.z0], [r.x1, r.z1]]);
        let mx = 0, mz = 0;
        for (const [x, z] of P) { mx += x; mz += z; }
        mx /= P.length; mz /= P.length;
        let sxx = 0, sxz = 0, szz = 0;
        for (const [x, z] of P) { const dx = x - mx, dz = z - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
        const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
        let s0 = Infinity, s1 = -Infinity, dev = 0;
        for (const [x, z] of P) { const s = (x - mx) * ux + (z - mz) * uz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); dev = Math.max(dev, Math.abs(-(x - mx) * uz + (z - mz) * ux)); }
        if (cl.length === 1 || dev <= 1.3) { const e = cl.length === 1 ? 0.15 : 0.45; out.push({ x0: mx + ux * (s0 - e), z0: mz + uz * (s0 - e), x1: mx + ux * (s1 + e), z1: mz + uz * (s1 + e) }); return; }
        if (depth >= 6) { out.push(...cl); return; }
        const key = (r) => ((r.x0 + r.x1) / 2 - mx) * ux + ((r.z0 + r.z1) / 2 - mz) * uz;
        const sorted = cl.slice().sort((p, q) => key(p) - key(q));
        const half = Math.ceil(sorted.length / 2);
        fit(sorted.slice(0, half), depth + 1);
        fit(sorted.slice(half), depth + 1);
      };
      return fit;
    };
    const straightPieces = (runs) => {
      const left = runs.slice(), out = [];
      const fit = fitInto(out);
      const near = (c, r) => Math.min(Math.hypot(c.x0 - r.x0, c.z0 - r.z0), Math.hypot(c.x0 - r.x1, c.z0 - r.z1), Math.hypot(c.x1 - r.x0, c.z1 - r.z0), Math.hypot(c.x1 - r.x1, c.z1 - r.z1)) < 2.2;
      while (left.length) {
        const cl = [left.pop()];
        for (let grown = true; grown;) {
          grown = false;
          for (let i = left.length - 1; i >= 0; i--) if (cl.some((c) => near(c, left[i]))) { cl.push(left[i]); left.splice(i, 1); grown = true; }
        }
        fit(cl, 0);
      }
      return out;
    };
    // place un modèle aligné sur un segment (axe x local le long du segment)
    const alignOn = (obj, r, y = 0) => {
      const ang = Math.atan2(r.z1 - r.z0, r.x1 - r.x0);
      obj.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
      obj.rotation.y = -ang;
      scene.add(obj);
      return obj;
    };
    const FH = 3.4;
    links.forEach((g, di) => {
      const far = depth[g.a] > depth[g.b] ? g.a : g.b;
      const price = Z.zones[far].doorPrice || Z.basePrice + Z.priceStep * Math.max(0, depth[far] - 1);
      const door = { id: di, price, a: g.a, b: g.b, toZone: far, name: ZONE_NAMES[far], open: false, points: [], segs: [], meshes: [], cells: [] };
      const pieces = straightPieces(g.runs);
      const longest = pieces.reduce((b, r) => (Math.hypot(r.x1 - r.x0, r.z1 - r.z0) > Math.hypot(b.x1 - b.x0, b.z1 - b.z0) ? r : b), pieces[0]);
      // panneau de prix (une texture par porte)
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
      const x = cv.getContext('2d');
      x.fillStyle = '#1a0d0a'; x.fillRect(0, 0, 512, 192);
      x.strokeStyle = '#ffd24a'; x.lineWidth = 6; x.strokeRect(8, 8, 496, 176);
      x.textAlign = 'center';
      x.fillStyle = '#fff'; x.font = 'bold 34px Arial, sans-serif'; x.fillText('PORTE VERROUILLÉE', 256, 62);
      x.fillStyle = '#ffd24a'; x.font = 'bold 54px Arial, sans-serif'; x.fillText(`${price} PTS`, 256, 126);
      x.fillStyle = '#aaa'; x.font = '24px Arial, sans-serif'; x.fillText(`${ZONE_NAMES[g.a]} ↔ ${ZONE_NAMES[g.b]}`, 256, 164);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const signMat = new THREE.MeshBasicMaterial({ map: tex });
      for (const r of pieces) {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        if (len < 0.2) continue;
        door.segs.push(collision.addSegment(r.x0, r.z0, r.x1, r.z1, FH));
        const isPortal = Z.zones[far].portal;
        const gm = alignOn(isPortal ? props.portalDoors(len) : props.gate(len), r);
        if (isPortal) door.leaves = (door.leaves || []).concat(gm.userData.leaves);
        door.meshes.push(gm);
        for (let s = 0; s <= len; s += 3) door.points.push({ x: r.x0 + ((r.x1 - r.x0) * s) / len, z: r.z0 + ((r.z1 - r.z0) * s) / len });
        if (r !== longest && len < 3.5) continue;
        for (const side of [-1, 1]) { // panneau des deux côtés
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.6, len), Math.min(2.6, len) * 0.375), signMat);
          sign.position.set(0, 2.0, side * 0.16);
          sign.rotation.y = side > 0 ? 0 : Math.PI;
          gm.add(sign);
        }
        lightSources.push({ x: (r.x0 + r.x1) / 2, y: 2.8, z: (r.z0 + r.z1) / 2, color: 0xff8844, intensity: 9, dist: 8, door });
      }
      doors.push(door);
    });
    door_depth = depth;

    // Barricades définitives aux limites du secteur (le reste de l'île n'est pas encore jouable)
    const sealMat = tiled(metalP, 1, 1, { color: 0x5a6066, metalness: 0.5 });
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
    const x = cv.getContext('2d');
    for (let i = -4; i < 20; i++) { x.fillStyle = i % 2 ? '#111' : '#f2c414'; x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40 + 40, 0); x.lineTo(i * 40 + 80, 160); x.lineTo(i * 40 + 40, 160); x.fill(); }
    x.fillStyle = 'rgba(0,0,0,0.82)'; x.fillRect(30, 30, 452, 100);
    x.textAlign = 'center'; x.fillStyle = '#f2c414'; x.font = 'bold 46px Impact, Arial, sans-serif'; x.fillText('ZONE FERMÉE', 256, 84);
    x.fillStyle = '#ddd'; x.font = '22px Arial, sans-serif'; x.fillText('accès interdit — secteur non sécurisé', 256, 116);
    const sealTex = new THREE.CanvasTexture(cv); sealTex.colorSpace = THREE.SRGBColorSpace;
    const sealSignMat = new THREE.MeshBasicMaterial({ map: sealTex });
    const SH = 3.6;
    for (const g of sealedGroups) {
      for (const r of straightPieces(g.runs)) {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        if (len < 0.2) continue;
        collision.addSegment(r.x0, r.z0, r.x1, r.z1, SH);
        const wm = alignOn(props.sealWall(len, sealMat), r);
        for (let t = 0; t <= len; t += 3) sealedPoints.push({ x: r.x0 + ((r.x1 - r.x0) * t) / len, z: r.z0 + ((r.z1 - r.z0) * t) / len });
        if (len < 2.6) continue;
        for (const side of [-1, 1]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), sealSignMat);
          sign.position.set(0, 2.3, -0.05 + side * 0.08);
          sign.rotation.y = side > 0 ? 0 : Math.PI;
          wm.add(sign);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Bornes, armes au mur et machines (CONFIG.sector.zones[].items)
  const WALL_COLORS = { shotgun: 0xff8833, smg: 0x3399ff, sniper: 0x88ccff, lmg: 0xff5533 };
  const machines = [];
  {
    const placed = [];
    // emplacement libre dans la zone, près de son lieu, à plus de 5 m des autres objets
    const spotIn = (zi, minClear, minD, maxD) => {
      const a = seeds[zi];
      if (!a) return null;
      // on élargit la recherche, puis on accepte moins d'espace autour (rues étroites)
      for (const [r, clear] of [[maxD, minClear], [maxD * 1.6, minClear], [maxD * 2.5, minClear], [maxD * 2.5, Math.max(1, minClear - 1)]]) {
        const c = shuffle(candidatesNear(a[0], a[1], clear, minD, r)
          .filter((p) => zoneOf(p[0], p[1]) === zi && placed.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 5)))[0];
        if (c) { placed.push(c); return c; }
      }
      return null;
    };
    const signTex = (title, sub, color) => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
      const x = cv.getContext('2d');
      x.fillStyle = '#0d0d10'; x.fillRect(0, 0, 512, 160);
      x.strokeStyle = color; x.lineWidth = 8; x.strokeRect(6, 6, 500, 148);
      x.textAlign = 'center';
      x.fillStyle = color; x.font = 'bold 50px Impact, Arial, sans-serif'; x.fillText(title, 256, 72);
      x.fillStyle = '#ffd24a'; x.font = 'bold 38px Arial, sans-serif'; x.fillText(sub, 256, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const addMachine = (type, id, spot, zi, spotRot = null) => {
      if (!spot) return;
      const [x, z] = spot;
      const [fx, fz] = seeds[zi];
      let name, price, color, g;
      if (type === 'perk') {
        const P = CONFIG.perks[id];
        name = P.name; price = P.price; color = P.color;
        g = makePerkMachine(id, P, price);
      } else if (type === 'pap') {
        name = 'PACK-A-PUNCH'; price = CONFIG.papPrice; color = '#b24bff';
        g = makePackAPunch();
      } else if (type === 'clock') {
        name = 'HORLOGE ASTRONOMIQUE'; price = CONFIG.finale.price; color = '#d4a640';
        g = makeAstronomicalClock();
      } else {
        name = 'BOÎTE MYSTÈRE'; price = CONFIG.box.price; color = '#5fb8ff';
        g = makeMysteryBox();
        const [, , bh] = g.userData.size;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: signTex(name, `${price} PTS`, color), transparent: true }));
        sign.position.set(0, bh + 0.55, 0.3);
        g.add(sign);
        g.userData.sign = sign;
      }
      const [w, d, h] = g.userData.size;
      g.position.set(x, 0, z);
      g.rotation.y = spotRot != null ? spotRot : Math.atan2(fx - x, fz - z);
      g.traverse((o) => { if (o.isMesh && o.material.blending !== THREE.AdditiveBlending) o.castShadow = o.receiveShadow = true; });
      scene.add(g);
      collision.addBox(x, z, w, d, -g.rotation.y, h);
      const entry = { type, id, name, price, color, letter: type === 'perk' ? CONFIG.perks[id].letter : null, zone: zi, pos: new THREE.Vector3(x, 0, z), group: g, active: true };
      machines.push(entry);
      lightSources.push({ x: x + Math.sin(g.rotation.y) * 1.2, y: h + 0.6, z: z + Math.cos(g.rotation.y) * 1.2, color: new THREE.Color(color).getHex(), intensity: 7, dist: 8, box: type === 'box' ? entry : null });
    };
    Z.zones.forEach((zone, zi) => {
      if (!seeds[zi] || !Number.isFinite(door_depth[zi])) return;
      const [fx, fz] = seeds[zi];
      const start = zi === startZone;
      for (const item of zone.items || []) {
        const [type, id] = item.split(':');
        if (type === 'station') {
          const sp = spotIn(zi, 3, start ? 7 : 3, start ? 14 : 30);
          if (sp) addStation(sp[0], sp[1], fx, fz);
        } else if (type === 'wall') {
          const W = CONFIG.weapons[id];
          addWallBuy(id, W.name, W.price, W.ammoPrice, WALL_COLORS[id] || 0xff8833, spotIn(zi, 2, start ? 6 : 4, start ? 26 : 32), fx, fz);
        } else if (zone.seed === 'cathedral' && cath && (type === 'pap' || type === 'clock')) {
          const fixed = type === 'pap' ? cath.pap : cath.clock;
          addMachine(type, id, fixed.p, zi, fixed.rot);
          placed.push(fixed.p);
        } else {
          addMachine(type, id, spotIn(zi, 3, 4, start ? 30 : 35), zi);
        }
      }
    });
  }
  if (!stations.length) stations.push(new THREE.Vector3(startPos.x + 6, 0, startPos.z));

  // ---------------------------------------------------------------- Plan de la ville (pour la carte plein écran)
  const MAP_SCALE = 0.7; // pixels par mètre
  const mapImage = document.createElement('canvas');
  {
    const W = Math.round(halfX * 2 * MAP_SCALE), Hh = Math.round(halfZ * 2 * MAP_SCALE);
    mapImage.width = W; mapImage.height = Hh;
    const x = mapImage.getContext('2d');
    const img = x.createImageData(W, Hh);
    for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
      const wx = px / MAP_SCALE - halfX, wz = py / MAP_SCALE - halfZ;
      const i = Math.floor((wx + isl.hx) / isl.cell), j = Math.floor((wz + isl.hz) / isl.cell);
      const c = j * isl.nx + i;
      const col = isl.island[c] ? [52, 56, 62] : isl.rawWater[c] ? [16, 52, 82] : [22, 24, 28];
      const o = (py * W + px) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.fillStyle = '#7a6a55';
    x.beginPath();
    for (const b of blds) {
      b.pts.forEach(([bx, bz], k) => { const X = (bx + halfX) * MAP_SCALE, Y = (bz + halfZ) * MAP_SCALE; if (k) x.lineTo(X, Y); else x.moveTo(X, Y); });
      x.closePath();
    }
    x.fill();
    x.strokeStyle = '#c9a65a'; x.lineWidth = 2.2; x.lineCap = 'round';
    for (const r of passageRuns) {
      x.beginPath();
      r.pts.forEach(([px, pz], k) => { const X = (px + halfX) * MAP_SCALE, Y = (pz + halfZ) * MAP_SCALE; if (k) x.lineTo(X, Y); else x.moveTo(X, Y); });
      x.stroke();
    }
    // tout ce qui est hors secteur est assombri (masque grossier de 4 m, élargi pour englober les pâtés de maisons)
    const G = 4, gw = Math.ceil((halfX * 2) / G), gh = Math.ceil((halfZ * 2) / G);
    let mask = new Uint8Array(gw * gh);
    for (let i = 0; i < zoneLabel.length; i++) {
      if (zoneLabel[i] < 0) continue;
      const wx = nav.worldX(i % nav.nx), wz = nav.worldZ((i / nav.nx) | 0);
      mask[Math.floor((wz + halfZ) / G) * gw + Math.floor((wx + halfX) / G)] = 1;
    }
    const grow = (m, r, val) => { // dilatation (val = 1) ou érosion (val = 0) carrée
      const out = m.slice();
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        if (m[j * gw + i] === val) continue;
        search: for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < gw && b < gh && m[b * gw + a] === val) { out[j * gw + i] = val; break search; }
        }
      }
      return out;
    };
    mask = grow(grow(mask, 6, 1), 3, 0);
    const imgAll = x.getImageData(0, 0, W, Hh);
    for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
      const wx = px / MAP_SCALE, wz = py / MAP_SCALE;
      if (mask[Math.floor(wz / G) * gw + Math.floor(wx / G)]) continue;
      const o = (py * W + px) * 4;
      imgAll.data[o] *= 0.42; imgAll.data[o + 1] *= 0.42; imgAll.data[o + 2] *= 0.42;
    }
    x.putImageData(imgAll, 0, 0);
  }
  const zoneCenters = seeds.map((sd, i) => (sd && zoneCells[i].n ? { name: ZONE_NAMES[i], x: sd[0], z: sd[1] } : null));

  // ---------------------------------------------------------------- Lampadaires (instanciés, 6 à 8 vraies lumières mobiles)
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc566, emissiveIntensity: 2.2 });
    const dummy = new THREE.Object3D();
    const poles = [], lanterns = [], caps = [];
    for (const [x, z] of data.lamps) {
      const ix = nav.cx(x), iz = nav.cz(z);
      if (!nav.inside(ix, iz) || !onIsland(x, z)) continue;
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.position.set(x, 2.1, z); dummy.updateMatrix(); poles.push(dummy.matrix.clone());
      dummy.position.set(x, 4.35, z); dummy.updateMatrix(); lanterns.push(dummy.matrix.clone());
      dummy.position.set(x, 4.65, z); dummy.updateMatrix(); caps.push(dummy.matrix.clone());
      collision.addCircle(x, z, 0.12);
      lightSources.push({ x, y: 4.2, z, color: 0xffc77a, intensity: 60, dist: 20 });
    }
    if (poles.length) {
      scene.add(instanced(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8), poleMat, poles));
      scene.add(instanced(new THREE.CylinderGeometry(0.2, 0.14, 0.4, 8), lampMat, lanterns, null, false));
      scene.add(instanced(new THREE.ConeGeometry(0.28, 0.2, 8), poleMat, caps));
    }
  }

  // ---------------------------------------------------------------- Décor : mobilier réel (OSM) et objets de l'apocalypse
  {
    const inSec = (x, z) => zoneOf(x, z) >= 0;
    const used = [startPos, ...stations, ...machines.map((m) => m.pos), ...wallWeapons.map((w) => w.pos)].map((v) => [v.x, v.z]);
    const freeAt = (x, z, gap) => used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > gap);
    // mur le plus proche (orientation des bancs, vélos…) et axe de la rue (voitures)
    const wallDir = (x, z) => { let best = 99, ang = 0; for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; const d = collision.rayHit(x, 1, z, Math.cos(t), 0, Math.sin(t), 6); if (d < best) { best = d; ang = t; } } return { dist: best, ang }; };
    const streetDir = (x, z) => { let best = -1, ang = 0; for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI; const d = collision.rayHit(x, 1, z, Math.cos(t), 0, Math.sin(t), 40) + collision.rayHit(x, 1, z, -Math.cos(t), 0, -Math.sin(t), 40); if (d > best) { best = d; ang = t; } } return ang; };
    // rotation (rotation.y) pour que le dos de l'objet (axe -z local) soit tourné vers la direction t
    const backTo = (t) => Math.atan2(-Math.cos(t), -Math.sin(t));
    let bikes = 0;
    for (const f of data.furniture || []) {
      const [x, z] = f.p;
      if (!inSec(x, z) || insideBuilding(x, z)) continue;
      const wd = wallDir(x, z);
      if (f.kind === 'bench' && freeAt(x, z, 2.5)) {
        const th = wd.dist < 4 ? backTo(wd.ang) : rnd() * Math.PI * 2;
        props.place('bench', x, z, th);
        collision.addBox(x, z, 1.9, 0.6, -th, 1);
        used.push([x, z]);
      } else if (f.kind === 'waste_basket' && freeAt(x, z, 1.5)) {
        props.place('bin', x, z, rnd() * 6);
        collision.addCircle(x, z, 0.26, 1);
      } else if (f.kind === 'bollard') {
        props.place('bollard', x, z);
        collision.addCircle(x, z, 0.1, 0.9);
      } else if (f.kind === 'bicycle_parking' && bikes < 70 && freeAt(x, z, 2) && rnd() < 0.6) {
        const th = wd.dist < 5 ? -wd.ang : rnd() * Math.PI; // vélos perpendiculaires au mur
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 0.65, ox = -Math.sin(wd.ang) * off, oz = Math.cos(wd.ang) * off;
          props.place('bike', x + ox, z + oz, th, 1, null, 0, (rnd() - 0.5) * 0.12);
          bikes++;
        }
        collision.addBox(x, z, 1.7, n * 0.65, -th, 1);
        used.push([x, z]);
      } else if ((f.kind === 'artwork' || f.kind === 'memorial' || f.kind === 'monument') && wd.dist > 3 && freeAt(x, z, 4)) {
        props.place('statue', x, z, rnd() * 6);
        collision.addCircle(x, z, 1.2, 4.5);
        used.push([x, z]);
      } else if (f.kind === 'fountain' && freeAt(x, z, 4)) {
        props.place('fountain', x, z);
        collision.addCircle(x, z, 1.6, 1.6);
        used.push([x, z]);
      }
    }
    // chalets du marché de Noël sur les grandes places
    for (const name of ['Place Kléber', 'Cathédrale', 'Place Gutenberg']) {
      const zi = ZONE_NAMES.indexOf(name);
      if (zi < 0 || !seeds[zi]) continue;
      const [sx, sz] = seeds[zi];
      let placed = 0;
      for (const [x, z] of shuffle(candidatesNear(sx, sz, 4, 6, 32).filter((c) => zoneOf(c[0], c[1]) === zi))) {
        if (placed >= 4 || !freeAt(x, z, 6)) continue;
        const th = Math.atan2(sx - x, sz - z); // comptoir tourné vers le centre de la place
        props.place('chalet', x, z, th);
        collision.addBox(x, z, 3, 2, -th, 2.6);
        lightSources.push({ x, y: 2, z, color: 0xffb860, intensity: 10, dist: 7 });
        used.push([x, z]);
        placed++;
      }
    }
    // voitures abandonnées, dans l'axe de la rue
    const carColors = [0x5a5f66, 0xd8d8d8, 0x1a1c20, 0x22314f, 0x7a1e1e, 0x9aa0a6, 0x3a4a3a, 0x6a5038];
    const spots = [...shuffle(candidatesNear(startPos.x, startPos.z, 3, 8, 50).filter((c) => zoneOf(c[0], c[1]) === startZone)), ...randomSpots(140, 3)];
    let cars = 0;
    for (const [x, z] of spots) {
      if (cars >= 14) break;
      if (!freeAt(x, z, 11)) continue;
      const ang = streetDir(x, z) + (rnd() - 0.5) * 0.5;
      props.place('car', x, z, -ang, 1, new THREE.Color(carColors[Math.floor(rnd() * carColors.length)]));
      collision.addBox(x, z, 4.2, 1.75, ang, 1.5);
      used.push([x, z]);
      cars++;
    }
    // barricades de fortune : sacs de sable, barrières, blocs béton, caisses, palettes, jardinières
    const junk = [['sandbags', 8, [2, 0.5], 0.9], ['crowd', 8, [2, 0.2], 1.1], ['jersey', 6, [2.4, 0.6], 0.82], ['crate', 9, [1.1, 1.1], 1], ['pallet', 6, [1.2, 1], 0.2], ['planter', 10, [1.6, 0.8], 1]];
    for (const [type, count, [w, d], h] of junk) {
      let n = 0;
      for (const [x, z] of shuffle(randomSpots(80, 2))) {
        if (n >= count) break;
        if (!freeAt(x, z, 5)) continue;
        const ang = streetDir(x, z) + (type === 'crate' ? rnd() * 3 : Math.PI / 2 + (rnd() - 0.5) * 0.6);
        props.place(type, x, z, -ang);
        if (type === 'crate' && rnd() < 0.5) props.place('crate', x + 0.1, z + 0.05, -ang + 0.4, 0.9, null, 1.0);
        collision.addBox(x, z, w, d, ang, h);
        used.push([x, z]);
        n++;
      }
    }
    props.finish(scene);
  }

  // ---------------------------------------------------------------- Ciel nocturne (suit le joueur)
  const sky = new THREE.Group();
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#04070d'); g.addColorStop(0.55, '#0c1522'); g.addColorStop(1, '#1b2535');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -1;
    sky.add(dome);
    const sp = [];
    for (let i = 0; i < 500; i++) {
      const th = rnd() * Math.PI * 2, ph = rnd() * 1.2;
      sp.push(Math.cos(th) * Math.cos(ph) * 290, Math.sin(ph) * 290 + 10, Math.sin(th) * Math.cos(ph) * 290);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sky.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdde6ff, size: 1.4, sizeAttenuation: false, fog: false })));
    sky.scale.setScalar(0.5); // ciel à 150 m : dans le champ de la caméra (170 m)
    scene.add(sky);
  }

  // ---------------------------------------------------------------- Finalisation navigation
  collision.build();
  levels.build();
  levels.buildNavs(NavGrid, collision);
  // Les portes sont ouvertes pour construire la grille, puis leurs cases sont bloquées une par une.
  for (const d of doors) for (const s of d.segs) s.off = true;
  nav.build();
  for (const d of doors) {
    for (const s of d.segs) {
      s.off = false;
      const r = nav.margin + nav.cell;
      const ix0 = Math.max(0, nav.cx(Math.min(s.ax, s.bx) - r)), ix1 = Math.min(nav.nx - 1, nav.cx(Math.max(s.ax, s.bx) + r));
      const iz0 = Math.max(0, nav.cz(Math.min(s.az, s.bz) - r)), iz1 = Math.min(nav.nz - 1, nav.cz(Math.max(s.az, s.bz) + r));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const i = nav.idx(ix, iz);
        if (nav.blocked[i]) continue;
        const px = nav.worldX(ix), pz = nav.worldZ(iz);
        const abx = s.bx - s.ax, abz = s.bz - s.az, len2 = abx * abx + abz * abz;
        let t = len2 > 0 ? ((px - s.ax) * abx + (pz - s.az) * abz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (s.ax + abx * t), dz = pz - (s.az + abz * t);
        if (dx * dx + dz * dz < nav.margin * nav.margin + 0.3) { nav.blocked[i] = 1; d.cells.push(i); }
      }
    }
  }
  nav.invalidate();

  const openingDoors = [];
  function openDoor(id) {
    const d = doors[id];
    if (!d || d.open) return false;
    d.open = true;
    for (const s of d.segs) s.off = true;
    if (d.leaves) { d.opening = 0; openingDoors.push(d); for (const m of d.meshes) m.traverse((o) => { if (o.isMesh && o.geometry.type === 'PlaneGeometry') o.visible = false; }); }
    else for (const m of d.meshes) { scene.remove(m); }
    for (const i of d.cells) nav.blocked[i] = 0;
    nav.invalidate();
    zoneOpen[d.a] = zoneOpen[d.b] = true;
    lightTimer = 0;
    return true;
  }

  // Lumières mobiles : un petit nombre de PointLight redistribuées sur les sources les plus proches
  const LIGHTS = 8;
  const lightPool = [];
  for (let i = 0; i < LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 10, 2);
    scene.add(l);
    lightPool.push(l);
  }
  let lightTimer = 0;
  const assignLights = (px, pz) => {
    const sorted = lightSources
      .filter((s) => !(s.door && s.door.open) && !(s.box && !s.box.active))
      .map((s) => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, LIGHTS);
    lightPool.forEach((l, i) => {
      const e = sorted[i];
      if (!e) { l.intensity = 0; return; }
      l.color.setHex(e.s.color); l.intensity = e.s.intensity; l.distance = e.s.dist; l.position.set(e.s.x, e.s.y, e.s.z);
    });
  };
  // Boîte mystère : une seule active parmi tous ses emplacements possibles
  const boxes = machines.filter((m) => m.type === 'box');
  function setActiveBox(i) {
    boxes.forEach((b, k) => { b.active = k === i; b.group.visible = b.active; b.group.position.y = 0; b.group.scale.setScalar(1); });
    lightTimer = 0;
  }
  setActiveBox(Math.max(0, boxes.findIndex((b) => b.zone === startZone)));

  assignLights(startPos.x, startPos.z);

  const stationPos = stations[0];
  return {
    half: Math.max(halfX, halfZ), blockers, spawnPoints: [], windowSpawns, pickWindow, pickGround,
    stationPos, stations, wallWeapons, doors, openDoor, zoneOf, startPos, nav, collision, machines, boxes, setActiveBox,
    zoneNames: ZONE_NAMES, zoneCenters, startZone, sealedPoints, mapImage, mapView: { halfX, halfZ, scale: MAP_SCALE },
    mapCrop: { x0: secMinX - 60, x1: secMaxX + 60, z0: secMinZ - 50, z1: secMaxZ + 50 }, mapTitle: 'SECTEUR DU MARCHÉ-NEUF — STRASBOURG',
    cathedral: cath ? { seed: cath.seed, clock: cath.clock, insideInner: cath.insideInner, inner: cath.inner, P: cath.P, S: cath.S, T: cath.T, ceilAt: cath.ceilAt, info: cathInfo } : null,
    levels,
    floorAt: (x, z, y, out) => levels.floorAt(x, z, y, out),
    collide: (pos, r) => collision.resolve(pos, r),
    rayHit: (ox, oy, oz, dx, dy, dz, maxT) => collision.rayHit(ox, oy, oz, dx, dy, dz, maxT),
    update(px, pz, dt) {
      sky.position.set(px, 0, pz);
      for (let i = openingDoors.length - 1; i >= 0; i--) { // battants du grand portail
        const d = openingDoors[i];
        d.opening = Math.min(1, d.opening + dt * 0.6);
        const a = (1 - Math.pow(1 - d.opening, 3)) * 1.75;
        d.leaves.forEach((lv, k) => { lv.rotation.y = (k % 2 ? 1 : -1) * a; });
        if (d.opening >= 1) openingDoors.splice(i, 1);
      }
      if (waterNormal) { waterNormal.offset.x += dt * 0.004; waterNormal.offset.y += dt * 0.0025; }
      lightTimer -= dt;
      if (lightTimer <= 0) { lightTimer = 0.4; assignLights(px, pz); }
    },
    mapName: 'Grande Île, Strasbourg',
  };
}
