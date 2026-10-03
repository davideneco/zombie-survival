import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Collision } from './collision.js';
import { NavGrid } from './nav.js';

// =====================================================================
//  Monde réel : place du Marché-Neuf, Strasbourg (données OpenStreetMap)
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

export async function buildRealWorld(scene, renderer) {
  const rnd = seeded(20240611);
  const data = await (await fetch('/data/area.json')).json();
  const half = CONFIG.mapHalf;
  const extent = data.half; // taille des données (visuel au-delà de la zone de jeu)

  const [cobble, plaster, roofP, metalP, barkP, plasterImg] = await Promise.all([
    loadPBR('cobble', renderer), loadPBR('plaster', renderer), loadPBR('roof', renderer),
    loadPBR('metal', renderer), loadPBR('bark', renderer), loadImg('/textures/plaster/diff.jpg'),
  ]);

  const collision = new Collision(half);
  const blockers = [];
  const polygons = [];

  // ---------------------------------------------------------------- Sol pavé
  {
    const size = extent * 2 + 40;
    const geo = new THREE.PlaneGeometry(size, size);
    const uv = geo.attributes.uv;
    const tile = 2.2; // taille réelle approx. d'une tuile de pavés (m)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * size) / tile, (uv.getY(i) * size) / tile);
    const mat = new THREE.MeshStandardMaterial({
      map: cobble.map, normalMap: cobble.normalMap, roughnessMap: cobble.roughnessMap,
      color: 0xb8b2aa, normalScale: new THREE.Vector2(1.2, 1.2),
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    blockers.push(ground);
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
      // dégradé : bas de façade plus sale / sombre
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
        // winding : garantir une normale vers le haut
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
    blockers.push(m);
  });
  {
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofP.map, normalMap: roofP.normalMap, roughnessMap: roofP.roughnessMap, color: 0x9a8f88,
    });
    const m = new THREE.Mesh(toGeo(roofBucket, false), roofMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
  }

  // ---------------------------------------------------------------- Barrière de quarantaine (limite de la zone)
  {
    const T = 0.3, FH = 3.4, L = half * 2 + T * 2;
    const sides = [[0, -half - T / 2, L, T], [0, half + T / 2, L, T], [-half - T / 2, 0, T, half * 2], [half + T / 2, 0, T, half * 2]];
    for (const [x, z, w, d] of sides) {
      const len = Math.max(w, d);
      const mat = tiled(metalP, len / 2.2, FH / 2.2, { color: 0x9a9a95, metalness: 0.5 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, FH, d), mat);
      m.position.set(x, FH / 2, z);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      blockers.push(m);
    }
  }

  // ---------------------------------------------------------------- Arbres
  const trunkMat = tiled(barkP, 1, 2, { color: 0x8a8076 });
  const leafMats = [0x3c5a2a, 0x4a6230, 0x566a2c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const treeSpots = data.trees.filter(([x, z]) => Math.abs(x) < half - 1 && Math.abs(z) < half - 1);
  for (const [x, z] of treeSpots) {
    const g = new THREE.Group();
    const th = rand(3.2, 4.5);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, th, 10), trunkMat);
    trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
    const lm = pick(leafMats);
    for (let i = 0; i < 5; i++) {
      const r = rand(1.2, 1.9);
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), lm);
      leaf.position.set(rand(-1, 1), th + rand(-0.2, 1.4), rand(-1, 1));
      leaf.scale.y = 0.8;
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    blockers.push(trunk);
    collision.addCircle(x, z, 0.3);
  }

  // ---------------------------------------------------------------- Navigation de base (pour placer les props)
  collision.build();
  const nav = new NavGrid(half, collision, polygons);
  nav.build();

  const INFD = 0x3fffffff;
  const clearance = (ix, iz, r) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (!nav.inside(jx, jz) || nav.blocked[nav.idx(jx, jz)]) return false;
    }
    return true;
  };

  // Départ : case dégagée (>= 3 m de tout obstacle) la plus proche de l'adresse
  let startCell = null, bestD = Infinity;
  for (let iz = 0; iz < nav.n; iz++) for (let ix = 0; ix < nav.n; ix++) {
    const d = Math.hypot(nav.worldX(ix), nav.worldZ(iz));
    if (d < bestD && clearance(ix, iz, 6)) { bestD = d; startCell = [ix, iz]; }
  }
  if (!startCell) startCell = nav.nearestFree(0, 0, 40);
  const startPos = new THREE.Vector3(nav.worldX(startCell[0]), 0, nav.worldZ(startCell[1]));
  nav.computeField(startPos.x, startPos.z);

  const candidates = (minClear, minD, maxD) => {
    const out = [];
    for (let iz = 0; iz < nav.n; iz += 2) for (let ix = 0; ix < nav.n; ix += 2) {
      const i = nav.idx(ix, iz);
      if (nav.blocked[i] || nav.dist[i] >= INFD) continue;
      const wx = nav.worldX(ix), wz = nav.worldZ(iz);
      const d = Math.hypot(wx - startPos.x, wz - startPos.z);
      if (d < minD || d > maxD) continue;
      if (clearance(ix, iz, minClear)) out.push([wx, wz]);
    }
    return out;
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------------------------------------------------------------- Fenêtres d'apparition (rez-de-chaussée)
  const windowSpawns = [];
  {
    // Texture de vitre brisée : ouverture noire + éclats de verre sur les bords
    const c = document.createElement('canvas'); c.width = 128; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.beginPath();
    x.moveTo(6, 14); x.lineTo(40, 4); x.lineTo(70, 16); x.lineTo(102, 6); x.lineTo(122, 18);
    x.lineTo(118, 70); x.lineTo(124, 130); x.lineTo(120, 190); x.lineTo(86, 180); x.lineTo(54, 194);
    x.lineTo(20, 182); x.lineTo(8, 188); x.lineTo(12, 120); x.lineTo(4, 60); x.closePath(); x.fill();
    for (let i = 0; i < 26; i++) { // éclats restés dans le cadre
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

    const makeQuad = (nx, nz, cx, cz) => {
      const g = new THREE.Group();
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshBasicMaterial({
        color: 0xff2a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      }));
      const broken = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshBasicMaterial({
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
      for (let k = 0; k < bays; k++) {
        const u = (k + 0.5) / bays;
        const px = ax + (bx - ax) * u, pz = az + (bz - az) * u;
        const ox = px + nx * 1.2, oz = pz + nz * 1.2;
        if (Math.abs(ox) > half - 4 || Math.abs(oz) > half - 4) continue;
        const ix = nav.cx(ox), iz = nav.cz(oz);
        if (!nav.inside(ix, iz) || !clearance(ix, iz, 0)) continue;
        if (nav.dist[nav.idx(ix, iz)] >= INFD) continue;
        const sp = {
          type: 'window',
          outside: new THREE.Vector3(ox, 0, oz),
          inside: new THREE.Vector3(px - nx * 0.9, 0, pz - nz * 0.9),
          center: new THREE.Vector3(px + nx * 0.1, WY, pz + nz * 0.1),
          nx, nz, yaw: Math.atan2(nx, nz), busyUntil: 0, _q: null,
          getQuad() { return this._q || (this._q = makeQuad(nx, nz, px, pz)); },
        };
        windowSpawns.push(sp);
      }
    }
  }

  // ---------------------------------------------------------------- Points d'apparition des zombies
  const spawnPoints = [];
  {
    let cand = [];
    for (const minPath of [45, 30, 15]) {
      cand = [];
      for (let iz = 0; iz < nav.n; iz += 2) for (let ix = 0; ix < nav.n; ix += 2) {
        const i = nav.idx(ix, iz);
        if (nav.blocked[i] || nav.dist[i] >= INFD) continue;
        if ((nav.dist[i] / 10) * nav.cell >= minPath) cand.push([nav.worldX(ix), nav.worldZ(iz)]);
      }
      if (cand.length > 20) break;
    }
    shuffle(cand);
    for (const [x, z] of cand) {
      if (spawnPoints.every((p) => Math.hypot(p.x - x, p.z - z) > 11)) spawnPoints.push(new THREE.Vector3(x, 0, z));
      if (spawnPoints.length >= 14) break;
    }
  }

  // ---------------------------------------------------------------- Borne de munitions
  const stationPos = new THREE.Vector3();
  {
    const c = shuffle(candidates(3, 7, 14));
    const [x, z] = c[0] || [startPos.x + 6, startPos.z];
    stationPos.set(x, 0, z);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x2c3a2e, roughness: 0.6, metalness: 0.5 }));
    body.position.y = 0.85; body.castShadow = body.receiveShadow = true; g.add(body);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x11cc44, emissiveIntensity: 1.6 }));
    panel.position.set(0, 1.1, 0.42); g.add(panel);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(startPos.x - x, startPos.z - z);
    scene.add(g);
    blockers.push(body);
    const light = new THREE.PointLight(0x33ff77, 18, 9, 2);
    light.position.set(x, 1.6, z);
    scene.add(light);
    collision.addBox(x, z, 1.3, 0.8, -g.rotation.y);
  }

  // ---------------------------------------------------------------- Armes au mur (Wall Buys style COD)
  const wallWeapons = [];
  const wwCand = shuffle(candidates(2, 6, 26));

  const addWallBuy = (id, name, price, ammoPrice, colorHex, spot) => {
    if (!spot) return;
    const [x, z] = spot;
    const pos = new THREE.Vector3(x, 0, z);
    wallWeapons.push({ id, name, price, ammoPrice, pos });

    const g = new THREE.Group();
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.7 })
    );
    stand.position.y = 1.2;
    g.add(stand);

    // Plaque craie blanche & prix
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(name, 128, 48);
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText(`${price} PTS`, 128, 92);
    const tex = new THREE.CanvasTexture(c);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, 1.2, 0.11);
    g.add(sign);

    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(startPos.x - x, startPos.z - z);
    scene.add(g);
    blockers.push(stand);
    collision.addBox(x, z, 1.4, 0.4, -g.rotation.y);

    const light = new THREE.PointLight(colorHex, 20, 8, 2);
    light.position.set(x, 2.0, z);
    scene.add(light);
  };

  addWallBuy('shotgun', 'FUSIL A POMPE', 750, 350, 0xff8833, wwCand[0]);
  addWallBuy('smg', 'PM MP40', 1000, 500, 0x3399ff, wwCand[1]);

  // ---------------------------------------------------------------- Lampadaires
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc566, emissiveIntensity: 2.2 });
    // petites rues : cases proches d'un mur mais libres
    const cand = shuffle(candidates(1, 5, 80)).filter(([x, z]) => {
      const ix = nav.cx(x), iz = nav.cz(z);
      return !clearance(ix, iz, 5); // près d'un obstacle
    });
    const lamps = [];
    for (const [x, z] of cand) {
      if (lamps.every((p) => Math.hypot(p[0] - x, p[1] - z) > 24)) lamps.push([x, z]);
      if (lamps.length >= 10) break;
    }
    lamps.sort((a, b) => Math.hypot(a[0] - startPos.x, a[1] - startPos.z) - Math.hypot(b[0] - startPos.x, b[1] - startPos.z));
    lamps.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8), poleMat);
      pole.position.y = 2.1; pole.castShadow = true; g.add(pole);
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.4, 8), lampMat);
      lantern.position.y = 4.35; g.add(lantern);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 8), poleMat);
      cap.position.y = 4.65; g.add(cap);
      g.position.set(x, 0, z);
      scene.add(g);
      collision.addCircle(x, z, 0.12);
      if (i < 6) { // budget de lumières : seules les 6 plus proches éclairent
        const l = new THREE.PointLight(0xffc77a, 60, 20, 2);
        l.position.set(x, 4.2, z);
        scene.add(l);
      }
    });
  }

  // ---------------------------------------------------------------- Props (couverts) : voitures, barrières, caisses
  {
    const carColors = [0x6b2a22, 0x2a3a52, 0x4a4d4f, 0x4b5238, 0x7a7266];
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.15, metalness: 0.8 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8b85, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85 });

    const spots = shuffle(candidates(4, 6, 80));
    const used = [];
    const take = (minGap) => {
      for (let i = 0; i < spots.length; i++) {
        const [x, z] = spots[i];
        if (used.every((u) => Math.hypot(u[0] - x, u[1] - z) > minGap)) { used.push([x, z]); return [x, z]; }
      }
      return null;
    };

    for (let i = 0; i < 5; i++) { // voitures abandonnées
      const p = take(10); if (!p) break;
      const rot = rnd() * Math.PI;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.55, metalness: 0.5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.75, 1.8), bodyMat);
      body.position.y = 0.65; g.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 1.65), glass);
      cabin.position.set(-0.2, 1.3, 0); g.add(cabin);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.6), bodyMat);
      roof.position.set(-0.2, 1.65, 0); g.add(roof);
      for (const [wx, wz] of [[1.3, 0.9], [1.3, -0.9], [-1.3, 0.9], [-1.3, -0.9]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14), tyre);
        w.rotation.x = Math.PI / 2; w.position.set(wx, 0.33, wz); g.add(w);
      }
      g.children.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
      g.position.set(p[0], 0, p[1]);
      g.rotation.y = -rot;
      scene.add(g);
      blockers.push(body, cabin, roof);
      collision.addBox(p[0], p[1], 4.2, 1.8, rot);
    }
    for (let i = 0; i < 7; i++) { // barrières béton (New Jersey)
      const p = take(6); if (!p) break;
      const rot = rnd() * Math.PI;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.55), concrete);
      m.position.set(p[0], 0.45, p[1]); m.rotation.y = -rot;
      m.castShadow = m.receiveShadow = true;
      scene.add(m); blockers.push(m);
      collision.addBox(p[0], p[1], 2.4, 0.55, rot);
    }
    for (let i = 0; i < 7; i++) { // caisses en bois
      const p = take(5); if (!p) break;
      const rot = rnd() * Math.PI;
      const g = new THREE.Group();
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.1), wood);
        c.position.set(k * 0.15, 0.5 + k * 1.0, k * 0.1); c.rotation.y = k * 0.3;
        c.castShadow = c.receiveShadow = true;
        g.add(c); blockers.push(c);
      }
      g.position.set(p[0], 0, p[1]); g.rotation.y = -rot;
      scene.add(g);
      collision.addBox(p[0], p[1], 1.2, 1.2, rot);
    }
  }

  // ---------------------------------------------------------------- Ciel nocturne
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#04070d'); g.addColorStop(0.55, '#0c1522'); g.addColorStop(1, '#1b2535');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -1;
    scene.add(dome);
    const sp = [];
    for (let i = 0; i < 500; i++) {
      const th = rnd() * Math.PI * 2, ph = rnd() * 1.2;
      sp.push(Math.cos(th) * Math.cos(ph) * 290, Math.sin(ph) * 290 + 10, Math.sin(th) * Math.cos(ph) * 290);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdde6ff, size: 1.4, sizeAttenuation: false, fog: false })));
  }

  // ---------------------------------------------------------------- Finalisation navigation
  collision.build();
  nav.build();

  return {
    half, blockers, spawnPoints, windowSpawns, stationPos, wallWeapons, startPos, nav,
    collide: (pos, r) => collision.resolve(pos, r),
    mapName: 'Place du Marché-Neuf, Strasbourg',
  };
}
