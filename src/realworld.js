import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Collision } from './collision.js';
import { NavGrid } from './nav.js';
import { computeIsland } from './island.js';

// =====================================================================
//  Monde réel : la Grande Île de Strasbourg (données OpenStreetMap)
//  Données générées par  tools/fetch-osm.mjs  ->  public/data/area.json
// =====================================================================

const FLOOR_H = 3.25;  // hauteur d'un étage (m)
const BAY_W = 4;       // largeur d'une travée de fenêtre (m)

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
//  Façades : crépi (photo) + fenêtres / volets dessinés
// ------------------------------------------------------------------
function makeFacade(plasterImg, variant, renderer) {
  const W = 512, H = Math.round(512 * FLOOR_H / BAY_W);
  const col = document.createElement('canvas'); col.width = W; col.height = H;
  const bmp = document.createElement('canvas'); bmp.width = W; bmp.height = H;
  const c = col.getContext('2d'), b = bmp.getContext('2d');

  // crépi
  c.drawImage(plasterImg, 0, 0, W / 2, H); c.drawImage(plasterImg, W / 2, 0, W / 2, H);
  b.fillStyle = '#808080'; b.fillRect(0, 0, W, H);
  b.filter = 'grayscale(1) contrast(0.6)';
  b.globalAlpha = 0.9;
  b.drawImage(plasterImg, 0, 0, W / 2, H); b.drawImage(plasterImg, W / 2, 0, W / 2, H);
  b.filter = 'none'; b.globalAlpha = 1;

  // corniche / bandeau d'étage (masque la couture verticale)
  c.fillStyle = 'rgba(40,30,20,0.25)'; c.fillRect(0, H - 6, W, 6);
  c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, W, 4);
  b.fillStyle = '#b0b0b0'; b.fillRect(0, 0, W, 6);

  const ww = 166, wh = 243, wx = (W - ww) / 2, wy = 62;
  const SHUTTER = { 0: '#3f5a45', 1: '#7a3b2e', 2: null, 3: '#54616b' }[variant];

  // encadrement en pierre
  c.fillStyle = '#cfc6b4'; c.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
  b.fillStyle = '#d8d8d8'; b.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
  // vitre
  const g = c.createLinearGradient(0, wy, 0, wy + wh);
  g.addColorStop(0, '#26364a'); g.addColorStop(0.5, '#141c27'); g.addColorStop(1, '#0a0e14');
  c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
  // reflet
  c.fillStyle = 'rgba(160,190,230,0.10)';
  c.beginPath(); c.moveTo(wx, wy + wh * 0.55); c.lineTo(wx + ww, wy + wh * 0.1); c.lineTo(wx + ww, wy + wh * 0.35); c.lineTo(wx, wy + wh * 0.85); c.fill();
  b.fillStyle = '#101010'; b.fillRect(wx, wy, ww, wh); // vitre en creux
  // châssis
  c.fillStyle = '#d9d3c6';
  const fr = 7;
  c.fillRect(wx, wy, ww, fr); c.fillRect(wx, wy + wh - fr, ww, fr);
  c.fillRect(wx, wy, fr, wh); c.fillRect(wx + ww - fr, wy, fr, wh);
  c.fillRect(wx + ww / 2 - 3, wy, 6, wh); c.fillRect(wx, wy + wh * 0.38, ww, 6);
  b.fillStyle = '#c8c8c8';
  b.fillRect(wx, wy + wh * 0.38, ww, 6); b.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  // appui de fenêtre
  c.fillStyle = '#b3aa98'; c.fillRect(wx - 18, wy + wh + 12, ww + 36, 10);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(wx - 18, wy + wh + 22, ww + 36, 8);
  b.fillStyle = '#e0e0e0'; b.fillRect(wx - 18, wy + wh + 12, ww + 36, 10);

  if (SHUTTER) {
    // volets : ouverts (variant 0,1,2) ou fermés (variant 3)
    const sw = variant === 3 ? ww / 2 : ww / 2 - 6;
    const lx = variant === 3 ? wx : wx - sw - 14;
    const rx2 = variant === 3 ? wx + ww / 2 : wx + ww + 14;
    for (const x of [lx, rx2]) {
      c.fillStyle = SHUTTER; c.fillRect(x, wy - 8, sw, wh + 16);
      b.fillStyle = '#d0d0d0'; b.fillRect(x, wy - 8, sw, wh + 16);
      c.fillStyle = 'rgba(0,0,0,0.28)'; b.fillStyle = '#909090';
      for (let y = wy; y < wy + wh + 8; y += 9) { c.fillRect(x, y, sw, 2); b.fillRect(x, y, sw, 3); }
    }
  }

  const map = new THREE.CanvasTexture(col);
  const bump = new THREE.CanvasTexture(bmp);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.5, roughness: 0.92, vertexColors: true });
}

const PALETTE = ['#efe4cb', '#e6cfa6', '#dba99a', '#cdd6d8', '#ebcdcd', '#d9dfc4', '#cfba9d', '#e9dcb0', '#c9876f', '#d8d2c8'].map((h) => new THREE.Color(h));

// ------------------------------------------------------------------
function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
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

const ZONE_NAMES = ['Nord-Ouest', 'Place Kléber', 'Nord-Est', 'Petite France', 'Cathédrale', 'Quartier Est'];

export async function buildRealWorld(scene, renderer) {
  const rnd = seeded(20240611);
  const data = await (await fetch('/data/area.json')).json();
  const halfX = data.half, halfZ = data.halfZ || data.half;
  const Z = CONFIG.zones;

  const [cobble, plaster, roofP, metalP, barkP, plasterImg] = await Promise.all([
    loadPBR('cobble', renderer), loadPBR('plaster', renderer), loadPBR('roof', renderer),
    loadPBR('metal', renderer), loadPBR('bark', renderer), loadImg('/textures/plaster/diff.jpg'),
  ]);

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
  {
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0d2233, roughness: 0.12, metalness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const pos = [], idx = [];
    const addTri = (a, b, c) => { const base = pos.length / 3; pos.push(a[0], 0.04, a[1], b[0], 0.04, b[1], c[0], 0.04, c[1]); idx.push(base, base + 2, base + 1); };
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
  const facadeMats = [0, 1, 2, 3].map((v) => makeFacade(plasterImg, v, renderer));
  const buckets = facadeMats.map(() => ({ pos: [], nor: [], uv: [], col: [], idx: [] }));
  const roofBucket = { pos: [], nor: [], uv: [], idx: [] };
  const tmpC = new THREE.Color();

  const facadeSegs = []; // [ax,az,bx,bz,nx,nz,bays,len] : pour placer les fenêtres d'apparition
  for (const bld of data.buildings) {
    let pts = cleanRing(bld.pts);
    if (pts.length < 3) continue;
    let area = polyArea(pts);
    if (Math.abs(area) < 3) continue;
    if (area < 0) { pts.reverse(); area = -area; }

    const floors = Math.max(2, Math.round(bld.h / FLOOR_H));
    const H = floors * FLOOR_H;
    polygons.push({ pts });

    const bk = buckets[Math.floor(rnd() * buckets.length)];
    const tint = PALETTE[Math.floor(rnd() * PALETTE.length)];
    const dirt = 0.85 + rnd() * 0.15;

    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      collision.addSegment(ax, az, bx, bz);
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.3) continue;
      const nx = dz / len, nz = -dx / len;
      const bays = Math.max(1, Math.round(len / BAY_W));
      facadeSegs.push([ax, az, bx, bz, nx, nz, bays, len]);
      const base = bk.pos.length / 3;
      bk.pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, H, az);
      for (let k = 0; k < 4; k++) bk.nor.push(nx, 0, nz);
      bk.uv.push(0, 0, bays, 0, bays, floors, 0, floors);
      tmpC.copy(tint).multiplyScalar(dirt * 0.55); bk.col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
      tmpC.copy(tint).multiplyScalar(dirt); bk.col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
      bk.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    // toit (plat, triangulé)
    try {
      const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = roofBucket.pos.length / 3;
      for (const [x, z] of pts) { roofBucket.pos.push(x, H, z); roofBucket.nor.push(0, 1, 0); roofBucket.uv.push(x / 3, z / 3); }
      for (const [a, b2, c2] of tris) {
        const ny = (pts[b2][0] - pts[a][0]) * (pts[c2][1] - pts[a][1]) - (pts[b2][1] - pts[a][1]) * (pts[c2][0] - pts[a][0]);
        if (ny > 0) roofBucket.idx.push(base + a, base + c2, base + b2);
        else roofBucket.idx.push(base + a, base + b2, base + c2);
      }
    } catch (e) { /* polygone dégénéré : ignoré */ }
  }

  const toGeo = (bk, withCol) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    if (withCol) g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
    g.setIndex(bk.idx);
    g.computeBoundingSphere();
    return g;
  };
  buckets.forEach((bk, i) => {
    if (!bk.pos.length) return;
    const m = new THREE.Mesh(toGeo(bk, true), facadeMats[i]);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  });
  {
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofP.map, normalMap: roofP.normalMap, roughnessMap: roofP.roughnessMap, color: 0x9a8f88,
    });
    const m = new THREE.Mesh(toGeo(roofBucket, false), roofMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // ---------------------------------------------------------------- Limites de l'île (collision + barrières sur les ponts)
  {
    const { cell, nx, nz, hx, hz } = isl;
    const isIsl = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && isl.island[j * nx + i] === 1;
    // Une arête est "pont" si aucune eau d'origine ne se trouve juste derrière : on matérialise alors une barrière.
    const nearWater = (i, j) => {
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < nx && b < nz && isl.rawWater[b * nx + a]) return true;
      }
      return false;
    };
    const fenceMat = tiled(metalP, 1, 1, { color: 0x77776f, metalness: 0.5 });
    const fence = []; // [x, z, w, d]
    const edge = (ax, az, bx, bz, bridge) => {
      collision.addSegment(ax, az, bx, bz);
      if (bridge) fence.push([(ax + bx) / 2, (az + bz) / 2, Math.abs(bx - ax) + 0.4, Math.abs(bz - az) + 0.4]);
    };
    // arêtes horizontales (nord / sud) fusionnées par rangée
    for (let dirN = 0; dirN < 2; dirN++) {
      const d = dirN ? 1 : -1;
      for (let j = 0; j < nz; j++) {
        let start = -1, bridge = false;
        for (let i = 0; i <= nx; i++) {
          const on = i < nx && isIsl(i, j) && !isIsl(i, j + d);
          const br = on && !nearWater(i, j + d);
          if (on && (start < 0 || br !== bridge)) {
            if (start >= 0) { const z0 = (j + (d > 0 ? 1 : 0)) * cell - hz; edge(start * cell - hx, z0, i * cell - hx, z0, bridge); }
            start = i; bridge = br;
          } else if (!on && start >= 0) {
            const z0 = (j + (d > 0 ? 1 : 0)) * cell - hz;
            edge(start * cell - hx, z0, i * cell - hx, z0, bridge);
            start = -1;
          }
        }
      }
    }
    // arêtes verticales (ouest / est)
    for (let dirE = 0; dirE < 2; dirE++) {
      const d = dirE ? 1 : -1;
      for (let i = 0; i < nx; i++) {
        let start = -1, bridge = false;
        for (let j = 0; j <= nz; j++) {
          const on = j < nz && isIsl(i, j) && !isIsl(i + d, j);
          const br = on && !nearWater(i + d, j);
          if (on && (start < 0 || br !== bridge)) {
            if (start >= 0) { const x0 = (i + (d > 0 ? 1 : 0)) * cell - hx; edge(x0, start * cell - hz, x0, j * cell - hz, bridge); }
            start = j; bridge = br;
          } else if (!on && start >= 0) {
            const x0 = (i + (d > 0 ? 1 : 0)) * cell - hx;
            edge(x0, start * cell - hz, x0, j * cell - hz, bridge);
            start = -1;
          }
        }
      }
    }
    // barrières visibles aux endroits sans eau (ponts, extrémités)
    const FH = 3.2;
    const mats = [];
    for (const [x, z, w, d] of fence) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, FH / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, FH, d));
      mats.push(m);
    }
    if (mats.length) {
      const f = instanced(new THREE.BoxGeometry(1, 1, 1), fenceMat, mats);
      f.receiveShadow = true;
      scene.add(f);
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

  // ---------------------------------------------------------------- Navigation de base (pour placer les props)
  collision.build();
  const nav = new NavGrid(halfX, halfZ, collision, polygons, 0.75, 0.4, 1300);
  nav.outside = (x, z) => !onIsland(x, z);
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

  // ---------------------------------------------------------------- Zones
  const zoneOf = (x, z) => {
    const col = x < Z.cutsX[0] ? 0 : x < Z.cutsX[1] ? 1 : 2;
    const row = z < Z.cutZ ? 0 : 1;
    return col + 3 * row;
  };
  const startZone = zoneOf(startPos.x, startPos.z);
  const zoneOpen = new Array(6).fill(false);
  zoneOpen[startZone] = true;
  const zoneCells = Array.from({ length: 6 }, () => ({ n: 0, sx: 0, sz: 0 }));
  for (let iz = 0; iz < nav.nz; iz += 3) for (let ix = 0; ix < nav.nx; ix += 3) {
    if (!reach[nav.idx(ix, iz)]) continue;
    const x = nav.worldX(ix), z = nav.worldZ(iz), zc = zoneCells[zoneOf(x, z)];
    zc.n++; zc.sx += x; zc.sz += z;
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

  // Points aléatoires accessibles sur toute l'île (props)
  const randomSpots = (count, minClear) => {
    const out = [];
    for (let t = 0; t < count * 60 && out.length < count; t++) {
      const x = (rnd() * 2 - 1) * halfX, z = (rnd() * 2 - 1) * halfZ;
      const ix = nav.cx(x), iz = nav.cz(z);
      if (nav.inside(ix, iz) && reach[nav.idx(ix, iz)] && clearance(ix, iz, minClear)) out.push([x, z]);
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
  const zoneAnchor = (zi) => {
    const zc = zoneCells[zi];
    if (!zc.n) return null;
    if (zi === startZone) return [startPos.x, startPos.z];
    const cx = zc.sx / zc.n, cz = zc.sz / zc.n;
    const c = candidatesNear(cx, cz, 3, 0, 120).sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz))[0];
    return c || null;
  };
  const anchors = Array.from({ length: 6 }, (_, zi) => zoneAnchor(zi));

  const addStation = (x, z, faceX, faceZ) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x2c3a2e, roughness: 0.6, metalness: 0.5 }));
    body.position.y = 0.85; body.castShadow = body.receiveShadow = true; g.add(body);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x11cc44, emissiveIntensity: 1.6 }));
    panel.position.set(0, 1.1, 0.42); g.add(panel);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(faceX - x, faceZ - z);
    scene.add(g);
    collision.addBox(x, z, 1.3, 0.8, -g.rotation.y, 1.7);
    lightSources.push({ x, y: 1.6, z, color: 0x33ff77, intensity: 18, dist: 9 });
    stations.push(new THREE.Vector3(x, 0, z));
  };

  const addWallBuy = (id, name, price, ammoPrice, colorHex, spot, faceX, faceZ) => {
    if (!spot) return;
    const [x, z] = spot;
    wallWeapons.push({ id, name, price, ammoPrice, pos: new THREE.Vector3(x, 0, z) });
    const g = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.7 }));
    stand.position.y = 1.2;
    g.add(stand);
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(name, 128, 48);
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText(`${price} PTS`, 128, 92);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
    sign.position.set(0, 1.2, 0.11);
    g.add(sign);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(faceX - x, faceZ - z);
    scene.add(g);
    collision.addBox(x, z, 1.4, 0.4, -g.rotation.y, 2);
    lightSources.push({ x, y: 2.0, z, color: colorHex, intensity: 20, dist: 8 });
  };

  // ---------------------------------------------------------------- Portes payantes entre les zones
  // On cherche, le long de chaque ligne de coupe entre deux zones, les passages libres (rues, ruelles) et on les barre.
  const doors = [];
  let door_depth;
  {
    const cell = nav.cell;
    const groups = new Map(); // "a-b" -> { a, b, runs: [{x0,z0,x1,z1}] }
    const group = (a, b) => {
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!groups.has(k)) groups.set(k, { a: Math.min(a, b), b: Math.max(a, b), runs: [] });
      return groups.get(k);
    };
    const scanVertical = (x, zFrom, zTo) => {
      const ix = nav.cx(x);
      let start = -1;
      const iz0 = Math.max(0, nav.cz(zFrom)), iz1 = Math.min(nav.nz - 1, nav.cz(zTo));
      for (let iz = iz0; iz <= iz1 + 1; iz++) {
        const free = iz <= iz1 && reach[nav.idx(ix, iz)] === 1;
        if (free && start < 0) start = iz;
        if (!free && start >= 0) {
          const wx = nav.worldX(ix), z0 = nav.worldZ(start) - cell, z1 = nav.worldZ(iz - 1) + cell;
          group(zoneOf(x - 2, (z0 + z1) / 2), zoneOf(x + 2, (z0 + z1) / 2)).runs.push({ x0: wx, z0, x1: wx, z1 });
          start = -1;
        }
      }
    };
    const scanHorizontal = (z, xFrom, xTo) => {
      const iz = nav.cz(z);
      let start = -1;
      const ix0 = Math.max(0, nav.cx(xFrom)), ix1 = Math.min(nav.nx - 1, nav.cx(xTo));
      for (let ix = ix0; ix <= ix1 + 1; ix++) {
        const free = ix <= ix1 && reach[nav.idx(ix, iz)] === 1;
        if (free && start < 0) start = ix;
        if (!free && start >= 0) {
          const wz = nav.worldZ(iz), x0 = nav.worldX(start) - cell, x1 = nav.worldX(ix - 1) + cell;
          group(zoneOf((x0 + x1) / 2, z - 2), zoneOf((x0 + x1) / 2, z + 2)).runs.push({ x0, z0: wz, x1, z1: wz });
          start = -1;
        }
      }
    };
    for (const cx of Z.cutsX) { scanVertical(cx, -halfZ, Z.cutZ - 0.01); scanVertical(cx, Z.cutZ + 0.01, halfZ); }
    scanHorizontal(Z.cutZ, -halfX, Z.cutsX[0] - 0.01);
    scanHorizontal(Z.cutZ, Z.cutsX[0] + 0.01, Z.cutsX[1] - 0.01);
    scanHorizontal(Z.cutZ, Z.cutsX[1] + 0.01, halfX);

    // profondeur de chaque zone (nombre de portes depuis le départ) -> prix
    const links = [...groups.values()].filter((g) => g.a !== g.b && g.runs.length);
    const depth = new Array(6).fill(Infinity);
    depth[startZone] = 0;
    for (let changed = true; changed;) {
      changed = false;
      for (const g of links) {
        if (depth[g.a] + 1 < depth[g.b]) { depth[g.b] = depth[g.a] + 1; changed = true; }
        if (depth[g.b] + 1 < depth[g.a]) { depth[g.a] = depth[g.b] + 1; changed = true; }
      }
    }
    zoneCells.forEach((zc, i) => { if (!zc.n) depth[i] = Infinity; });

    const doorMat = tiled(metalP, 2, 1, { color: 0x8a5a44, metalness: 0.6 });
    const FH = 3.4;
    links.forEach((g, di) => {
      const far = depth[g.a] > depth[g.b] ? g.a : g.b;
      const price = Z.basePrice + Z.priceStep * Math.max(0, depth[far] - 1);
      const door = { id: di, price, a: g.a, b: g.b, toZone: far, name: ZONE_NAMES[far], open: false, points: [], segs: [], meshes: [], cells: [] };
      let longest = null;
      for (const r of g.runs) {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        door.segs.push(collision.addSegment(r.x0, r.z0, r.x1, r.z1, FH));
        const m = new THREE.Mesh(new THREE.BoxGeometry(r.x0 === r.x1 ? 0.35 : len, FH, r.z0 === r.z1 ? 0.35 : len), doorMat);
        m.position.set((r.x0 + r.x1) / 2, FH / 2, (r.z0 + r.z1) / 2);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        door.meshes.push(m);
        for (let s = 0; s <= len; s += 3) door.points.push({ x: r.x0 + ((r.x1 - r.x0) * s) / len, z: r.z0 + ((r.z1 - r.z0) * s) / len });
        if (!longest || len > longest.len) longest = { ...r, len };
      }
      // panneau de prix au milieu de la plus grande ouverture (visible des deux côtés)
      if (longest) {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
        const x = cv.getContext('2d');
        x.fillStyle = '#1a0d0a'; x.fillRect(0, 0, 512, 192);
        x.strokeStyle = '#ffd24a'; x.lineWidth = 6; x.strokeRect(8, 8, 496, 176);
        x.textAlign = 'center';
        x.fillStyle = '#fff'; x.font = 'bold 34px Arial, sans-serif'; x.fillText('PORTE VERROUILLÉE', 256, 62);
        x.fillStyle = '#ffd24a'; x.font = 'bold 54px Arial, sans-serif'; x.fillText(`${price} PTS`, 256, 126);
        x.fillStyle = '#aaa'; x.font = '24px Arial, sans-serif'; x.fillText(`vers ${ZONE_NAMES[far]}`, 256, 164);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const cx0 = (longest.x0 + longest.x1) / 2, cz0 = (longest.z0 + longest.z1) / 2;
        const vertical = longest.x0 === longest.x1;
        for (const side of [-1, 1]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), new THREE.MeshBasicMaterial({ map: tex }));
          sign.position.set(cx0 + (vertical ? side * 0.2 : 0), 2.1, cz0 + (vertical ? 0 : side * 0.2));
          sign.rotation.y = vertical ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
          scene.add(sign);
          door.meshes.push(sign);
        }
        lightSources.push({ x: cx0, y: 2.6, z: cz0, color: 0xff7733, intensity: 25, dist: 10 });
      }
      doors.push(door);
    });

    // Cases de navigation bloquées par chaque porte (on ne les marque qu'après la construction finale de la grille)
    door_depth = depth;
  }

  // Stations et armes : la zone de départ vend le fusil à pompe, la suivante le PM, etc.
  const weaponCycle = [
    ['shotgun', 'FUSIL A POMPE', 750, 350, 0xff8833],
    ['smg', 'PM MP40', 1000, 500, 0x3399ff],
  ];
  const zoneOrder = [...Array(6).keys()].filter((zi) => anchors[zi] && Number.isFinite(door_depth[zi])).sort((a, b) => door_depth[a] - door_depth[b]);
  zoneOrder.forEach((zi, k) => {
    const [ax, az] = anchors[zi];
    const zc = zoneCells[zi];
    const fx = zc.sx / zc.n, fz = zc.sz / zc.n;
    const st = shuffle(candidatesNear(ax, az, 3, zi === startZone ? 7 : 3, zi === startZone ? 14 : 20));
    const [sx, sz] = st[0] || [ax + 5, az];
    addStation(sx, sz, fx, fz);
    const [id, name, price, ammoPrice, col] = weaponCycle[k % weaponCycle.length];
    const ww = shuffle(candidatesNear(sx, sz, 2, 6, 18));
    addWallBuy(id, name, price, ammoPrice, col, ww[0], fx, fz);
  });
  if (!stations.length) stations.push(new THREE.Vector3(startPos.x + 6, 0, startPos.z));

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

  // ---------------------------------------------------------------- Props (couverts) : voitures, barrières, caisses
  {
    const carColors = [0x6b2a22, 0x2a3a52, 0x4a4d4f, 0x4b5238, 0x7a7266];
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.15, metalness: 0.8 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8b85, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85 });
    const spots = randomSpots(110, 4);
    const used = [startPos];
    const take = (minGap) => {
      for (let i = 0; i < spots.length; i++) {
        const [x, z] = spots[i];
        if (used.every((u) => Math.hypot((u.x ?? u[0]) - x, (u.z ?? u[1]) - z) > minGap)) { used.push([x, z]); return [x, z]; }
      }
      return null;
    };
    const carBody = new THREE.BoxGeometry(4.2, 0.75, 1.8), carCabin = new THREE.BoxGeometry(2.1, 0.65, 1.65), carRoof = new THREE.BoxGeometry(2.0, 0.08, 1.6);
    const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14);
    for (let i = 0; i < 30; i++) { // voitures abandonnées
      const p = take(14); if (!p) break;
      const rot = rnd() * Math.PI;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.55, metalness: 0.5 });
      const body = new THREE.Mesh(carBody, bodyMat); body.position.y = 0.65; g.add(body);
      const cabin = new THREE.Mesh(carCabin, glass); cabin.position.set(-0.2, 1.3, 0); g.add(cabin);
      const roof = new THREE.Mesh(carRoof, bodyMat); roof.position.set(-0.2, 1.65, 0); g.add(roof);
      for (const [wx, wz] of [[1.3, 0.9], [1.3, -0.9], [-1.3, 0.9], [-1.3, -0.9]]) {
        const w = new THREE.Mesh(wheelGeo, tyre); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.33, wz); g.add(w);
      }
      g.children.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
      g.position.set(p[0], 0, p[1]);
      g.rotation.y = -rot;
      scene.add(g);
      collision.addBox(p[0], p[1], 4.2, 1.8, rot, 1.7);
    }
    const njGeo = new THREE.BoxGeometry(2.4, 0.9, 0.55);
    for (let i = 0; i < 40; i++) { // barrières béton (New Jersey)
      const p = take(8); if (!p) break;
      const rot = rnd() * Math.PI;
      const m = new THREE.Mesh(njGeo, concrete);
      m.position.set(p[0], 0.45, p[1]); m.rotation.y = -rot;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      collision.addBox(p[0], p[1], 2.4, 0.55, rot, 0.9);
    }
    const crateGeo = new THREE.BoxGeometry(1.1, 1.0, 1.1);
    for (let i = 0; i < 40; i++) { // caisses en bois
      const p = take(7); if (!p) break;
      const rot = rnd() * Math.PI;
      const g = new THREE.Group();
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const c = new THREE.Mesh(crateGeo, wood);
        c.position.set(k * 0.15, 0.5 + k * 1.0, k * 0.1); c.rotation.y = k * 0.3;
        c.castShadow = c.receiveShadow = true;
        g.add(c);
      }
      g.position.set(p[0], 0, p[1]); g.rotation.y = -rot;
      scene.add(g);
      collision.addBox(p[0], p[1], 1.2, 1.2, rot, n * 1.0);
    }
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
    scene.add(sky);
  }

  // ---------------------------------------------------------------- Finalisation navigation
  collision.build();
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

  function openDoor(id) {
    const d = doors[id];
    if (!d || d.open) return false;
    d.open = true;
    for (const s of d.segs) s.off = true;
    for (const m of d.meshes) { scene.remove(m); }
    for (const i of d.cells) nav.blocked[i] = 0;
    nav.invalidate();
    zoneOpen[d.a] = zoneOpen[d.b] = true;
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
      .map((s) => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, LIGHTS);
    lightPool.forEach((l, i) => {
      const e = sorted[i];
      if (!e) { l.intensity = 0; return; }
      l.color.setHex(e.s.color); l.intensity = e.s.intensity; l.distance = e.s.dist; l.position.set(e.s.x, e.s.y, e.s.z);
    });
  };
  assignLights(startPos.x, startPos.z);

  const stationPos = stations[0];
  return {
    half: Math.max(halfX, halfZ), blockers, spawnPoints: [], windowSpawns, pickWindow, pickGround,
    stationPos, stations, wallWeapons, doors, openDoor, zoneOf, startPos, nav,
    collide: (pos, r) => collision.resolve(pos, r),
    rayHit: (ox, oy, oz, dx, dy, dz, maxT) => collision.rayHit(ox, oy, oz, dx, dy, dz, maxT),
    update(px, pz, dt) {
      sky.position.set(px, 0, pz);
      lightTimer -= dt;
      if (lightTimer <= 0) { lightTimer = 0.4; assignLights(px, pz); }
    },
    mapName: 'Grande Île, Strasbourg',
  };
}
