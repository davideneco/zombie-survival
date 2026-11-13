import * as THREE from 'three';
import { gpuOnly } from './gpuOnly.js';
import { CONFIG } from './config.js';
import { createRelief, nullRelief, hash2 } from './relief.js';
import { addShadowProxy, proxyBucket } from './shadowProxy.js';
import { detailCull } from './detailCull.js';
import { FLOOR_H, BAY_W, GF_H, texSet, CW, CH, GH, prng } from './facadeDraw.js';
import { drawPlaster, drawTimber, drawSandstone, drawModern, drawShop, drawDormer, NEW_LAYERS } from './facadeLayers.js';
import { createFacadeAtlas } from './facadeAtlas.js';
import { classify, buildingRng } from './archStyle.js';

// =====================================================================
//  Architecture strasbourgeoise : façades dessinées (crépi + grès, colombages, grès rose,
//  gothique, moderne, boutiques), toits pentus avec lucarnes, et bâtiments en 3D
//  détaillé (building:part d'OpenStreetMap : cathédrale, églises).
//  v0.91.0 (step C): the style of each building comes from archStyle.js (district mixes), each style has its own storey height, roof pitch,
//  dormers and facade layers (facadeLayers.js); all layers live in one texture array (facadeAtlas.js). The world `rnd` stream is replayed
//  exactly by legacyDraws(), so items, machines and perks never move.
// =====================================================================

export { FLOOR_H, BAY_W, GF_H }; // (the dimensions moved to facadeDraw.js with the painting helpers)

// ------------------------------------------------------------------ Matériaux (anciens canevas : voir facadeLayers.js)
// Palettes de teintes (multipliées par la texture)
const PALETTES = {
  plaster: ['#f3e7cf', '#ecd2a8', '#e3b4a2', '#d3dde0', '#f0d2d2', '#dde4c8', '#d8c2a2', '#f0e2b2', '#cf9580', '#e8e2d6', '#c8d7c0', '#e8c890'],
  timber: ['#f2e8d4', '#efdcb4', '#ecd0c4', '#e4e8d0', '#f4ecd8', '#e8d0a0'],
  sandstone: ['#ffffff', '#f4e8e4', '#ead8d0'],
  gothic: ['#ffffff'],
  modern: ['#ffffff', '#e8eaee', '#f2eee6'],
  shop: ['#ffffff', '#f0e8e0', '#e8e0d0'],
};
// New styles (step C): render colours of the Strasbourg houses
const STYLE_TINTS = {
  timber: ['#bfae86', '#bf9a92', '#a2aa94', '#99a2a8', '#c6bea8'],
  classical0: ['#e6cf9c', '#dcbf86', '#ecdcb4', '#d9c8a6'],
  classical1: ['#ffffff', '#f4e8e4', '#ead8d0'],
  civic: ['#ffffff', '#f4e8e4', '#ead8d0'],
  neustadt: ['#f4efe2', '#e8dcc0', '#ffffff', '#f0e0d4'],
};
const ROOF_TINTS = { tiles: ['#b8644a', '#a85a40', '#8f4e3a', '#c07050', '#9a5a48'], slate: ['#5a5d66', '#4a4e57'], copper: ['#5f7a68'], stone: ['#b07a68'], metal: ['#6a6e74'] };
// roofs per style when the data gives no material
const STYLE_ROOF = {
  timber: ['#7e4636', '#6e4232', '#5e4a3e'], // beaver-tail tiles
  classical: ['#464c55', '#3e444d', '#50565f'], // slate
  neustadt: ['#464c55', '#50565f', '#3e444d'],
  civic: ['#8f4e3a', '#464c55', '#7e4636'],
};

// ------------------------------------------------------------------ Géométrie
// Rectangle orienté de surface minimale d'un polygone (axe long u, axe court v)
export function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 0.5) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l, vx = -uz, vz = ux;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of pts) { const s = x * ux + z * uz, t = x * vx + z * vz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, vx, vz, s0, s1, t0, t1 };
  }
  if (!best) return null;
  let { ux, uz, vx, vz, s0, s1, t0, t1 } = best;
  if (s1 - s0 < t1 - t0) { [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; [s0, s1, t0, t1] = [t0, t1, -s1, -s0]; } // u = axe long
  const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
  return { ux, uz, vx, vz, cx: ux * sc + vx * tc, cz: uz * sc + vz * tc, hl: (s1 - s0) / 2, hw: (t1 - t0) / 2, area: best.area };
}

// Découpe d'un polygone par le demi-plan f(p) >= 0 (Sutherland-Hodgman)
function clipHalf(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; s += x1 * z2 - x2 * z1; }
  return s / 2;
}

const lerp = (a, b, t) => a + (b - a) * t;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const HIPPED = ['hipped', 'half-hipped', 'gambrel', 'mansard', 'side_hipped', 'quadruple_saltbox', 'saltbox', 'round'];

// ------------------------------------------------------------------ Constructeur
// stream (step B, tiles.js): the kit of the core instance (`streamKit()`, after its finish) makes this a STREAMED instance: no canvas is drawn, no atlas, no
// relief, no new material: walls use the core texture array and its material, a layer the core atlas does not hold falls back to the nearest one that it does.
// Its buildings are flushed one tile at a time (flushTile). Its `rnd` is the tile's own generator (opts.rnd per building overrides it).
export function createArchitecture({ renderer, plasterImg, plaster2Img, roofP, rnd: rndWorld, stream = null }) {
  let rnd = rndWorld; // the generator of the building being built (building() swaps it when opts.rnd is given)
  const CFG = CONFIG.architecture;
  // plaster2 (« painted_plaster_wall » : crépi taché et coulé, CC0 Poly Haven) sert de fond à la moitié des crépis et à une variante de colombage
  const p2 = plaster2Img || plasterImg;
  // anciens styles : nombre de variantes et fonction de dessin (le tirage `rnd` du monde est consommé exactement comme avant : legacyDraws)
  const LEGACY = { plaster: [4, (c, i, r, v) => drawPlaster(c, v >= 2 ? p2 : i, r, v)], timber: [3, (c, i, r, v) => drawTimber(c, v === 1 ? p2 : i, r, v)], sandstone: [3, drawSandstone], gothic: [1, (c, i, r, v) => drawSandstone(c, i, r, v, true)], modern: [1, drawModern] };
  // texture de détail fine (mêmes pixels que plaster2, 256 px, niveaux de gris) : multipliée à la couleur des façades par le shader du matériau en tableau
  const detailTex = stream ? null : (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const x = cv.getContext('2d'); x.filter = 'grayscale(1) contrast(1.7) brightness(1.1)'; x.drawImage(p2, 0, 0, 256, 256);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.userData.detail = true;
    return t;
  })();
  const atlas = stream ? null : createFacadeAtlas({ renderer, detailTex, depthBias: CFG.depthBias });

  const bucket = () => ({ pos: [], nor: [], uv: [], col: [], fac: [], idx: [] });
  const wallB = bucket(), roofB = bucket();
  // Depth rank of each layer (atlas `aFac.y`, 2 steps per rank: the half step separates two neighbouring city tiles, see finish): two coplanar faces of two layers
  // (overlapping OSM footprints, shop bands against a wall...) get different depth biases and never fight for a pixel (tools/stuck-scan.mjs, zfight step).
  const RANK = { plaster: 0, timber: 4, sandstone: 7, modern: 10, gothic: 11, shop: 12, dormer: 18, flood: 22 };
  const recs = new Map(); // atlas layer id -> record { b, L, rank, style, variant } handed to quad / tri
  const record = (L, style, variant) => { let r = recs.get(L.id); if (!r) recs.set(L.id, r = { b: wallB, L, rank: L.rank, style, variant }); return r; };
  const roofR = { b: roofB, L: { id: 0 }, rank: 0 };
  // Legacy layer: drawn on first use with the WORLD rnd, exactly as the old lazy materials did (the canvases are reused as atlas layers)
  // Streamed instance: the layer of the core atlas with this key, else CONFIG.world.layerFallback, else the same style family, else the first layer there is
  const streamLayer = (key) => {
    const sl = stream.layers;
    let L = sl.get(key) || sl.get(CONFIG.world.layerFallback[key]);
    if (!L) { const fam = key.split(':')[0]; for (const [k, v] of sl) if (k === fam || k.startsWith(fam + ':')) { L = v; break; } }
    if (!L) L = sl.get('plasterP:0') || sl.values().next().value;
    return record(L, key.split(':')[0], +(key.split(':')[1] || 0));
  };
  const legacyLayer = (style, variant) => {
    const key = `${style}:${variant}`;
    if (stream) return streamLayer(key);
    if (!atlas.has(key)) {
      let set;
      if (style === 'shop') set = texSet(CW * 2, GH, (ctx) => drawShop(ctx, plasterImg, rnd, variant));
      else if (style === 'dormer') set = texSet(256, 256, (ctx) => drawDormer(ctx, plasterImg, rnd));
      else set = texSet(CW * 2, CH * 2, (ctx) => LEGACY[style][1](ctx, plasterImg, rnd, variant));
      atlas.add(key, 2 * ((RANK[style] ?? 0) + variant + 1), set);
    }
    return record(atlas.get(key), style, variant);
  };
  const matFor = legacyLayer;
  // New layer (local prng, never the world rnd)
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const newLayer = (key) => {
    if (stream) return streamLayer(key);
    if (!atlas.has(key)) {
      const def = NEW_LAYERS[key], R = prng(hashStr(key) ^ CFG.seed);
      atlas.add(key, def.rank * 2, texSet(def.W, def.H, (ctx) => def.draw(ctx, plasterImg, R, p2)));
    }
    return record(atlas.get(key), key.split(':')[0], +(key.split(':')[1] || 0));
  };
  // Monuments éclairés la nuit (cathédrale) : le grès lui-même émet une lumière chaude
  let floodRec = null;
  const floodlit = () => {
    if (stream) return streamLayer('gothic:0');
    if (!floodRec) {
      const base = matFor('gothic', 0);
      floodRec = record(atlas.add('gothic:flood', 2 * (RANK.flood + 1), base.L.sets, true), 'gothic', 0);
    }
    return floodRec;
  };
  // toits : tuiles PBR teintées par sommet
  const roofMat = stream ? stream.roofMat : atlas.patchDepth(new THREE.MeshStandardMaterial({ map: roofP.map, normalMap: roofP.normalMap, roughnessMap: roofP.roughnessMap, vertexColors: true, side: THREE.DoubleSide }));
  const tmp = new THREE.Color();
  let kit = null; // set by finish() (core instance): see streamKit

  // ---------- relief des façades (relief.js) : fenêtres, balcons, corniches, tuyaux, cheminées ; AUCUN tirage `rnd`
  const relief = stream ? nullRelief : createRelief();
  // ouverture dessinée dans la texture (m) : n fenêtres par travée, largeur, hauteur, hauteur au-dessus du plancher ; encadrement
  const WIN_LEGACY = {
    plaster: { n: 1, w: 1.25, h: 1.85, b: 0.85, trim: (v) => (v % 2 ? '#c99a84' : '#e2d9c6'), cornice: '#d8cdb8' },
    timber: { n: 1, w: 1.1, h: 1.35, b: 1.15, trim: () => '#6a4a30', cornice: '#8a6a4a', timber: true },
    sandstone: { n: 1, w: 1.3, h: 2.05, b: 0.7, trim: () => '#d6a48c', cornice: '#cf9c84' },
  };
  const WIN_NEW = {
    timber: { n: 2, w: 0.75, h: 1.1, b: 1.0, trim: () => '#4a3220', cornice: '#4a2a20', timber: true, noGF: true },
    classical: { n: 1, w: 1.3, h: 2.4, b: 0.55, trim: () => '#dccfb4', cornice: '#d8cdb8', cornSy: 1.6 },
    civic: { n: 0, w: 1.6, h: 3.0, b: 0.7, trim: () => '#d6a48c', cornice: '#d6a48c' }, // arched windows are painted only (the flat relief frame would not fit): cornices, bands and quoins only
    neustadt: { n: 1, w: 1.3, h: 2.2, b: 0.7, trim: (v) => (v % 2 ? '#dcb49c' : '#cfc4a6'), cornice: '#c9bea0' },
  };
  const hexC = (h) => new THREE.Color(h);
  const pushFac = (b, m, k) => { for (let i = 0; i < k; i++) b.fac.push(m.L.id, m.rank); };
  const quad = (m, p0, p1, p2, p3, uv, c0, c1) => {
    const b = m.b, base = b.pos.length / 3;
    b.pos.push(...p0, ...p1, ...p2, ...p3);
    // normale de la face
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2], fx = p3[0] - p0[0], fy = p3[1] - p0[1], fz = p3[2] - p0[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 4; k++) b.nor.push(nx / l, ny / l, nz / l);
    b.uv.push(...uv);
    for (const c of [c0, c0, c1, c1]) b.col.push(c.r, c.g, c.b);
    pushFac(b, m, 4);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (m, p0, p1, p2, uv, c) => {
    const b = m.b, base = b.pos.length / 3;
    b.pos.push(...p0, ...p1, ...p2);
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2], fx = p2[0] - p0[0], fy = p2[1] - p0[1], fz = p2[2] - p0[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1;
    // normale toujours vers le haut (toits) ; l'ordre des sommets doit la suivre (v0.47.3 : avant, seule la normale etait retournee, ~60 000 triangles
    // de toit avaient un enroulement contraire a leur normale : toits noirs hors du rendu double face)
    const flip = ny < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    for (let k = 0; k < 3; k++) b.nor.push(nx / l, ny / l, nz / l);
    b.uv.push(...uv);
    for (let k = 0; k < 3; k++) b.col.push(c.r, c.g, c.b);
    pushFac(b, m, 3);
    if (flip) b.idx.push(base, base + 2, base + 1); else b.idx.push(base, base + 1, base + 2);
  };

  // Mur vertical de a à b (tranche [t0, t1] du segment, hauteurs y0..y1), découpé au niveau du rez-de-chaussée.
  // st : { main, shop, gf (rez-de-chaussée), gal / galY (étage-galerie), W (fenêtres), fh, bay, uoff, variant, scale }
  // ovr : décalage (m) de chaque étage supérieur vers l'extérieur (encorbellement), car : { t0, t1 } porte cochère, street : mur de rue (oriels)
  function wall(ax, az, bx, bz, t0, t1, y0, y1, st, tint, dirt, base = 0, ovr = null, car = null, street = false) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05 || y1 - y0 < 0.02) return;
    const dx = bx - ax, dz = bz - az, nx = dz / len, nz = -dx / len, ux = dx / len, uz = dz / len; // sortant (voir facadeSegs de realworld.js)
    const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
    const sc = st.scale || 1; // monuments : motifs plus grands
    const fh = st.fh, bay = st.bay, P = bay * 2 * sc;
    // vu de la rue, la droite du spectateur va de b vers a : u croît dans ce sens (sinon les enseignes sont en miroir)
    const uAt = (t) => st.uoff - (len * t) / P;
    // pied de mur assombri (v0.44.0, CONFIG.graphics.footAO : [hauteur au-dessus de la base, facteur] par morceaux) : le mur « s'ancre » au sol
    const AO = CONFIG.graphics.footAO;
    const ao = (h) => { if (h <= AO[0][0]) return AO[0][1]; for (let i = 1; i < AO.length; i++) if (h <= AO[i][0]) return AO[i - 1][1] + (AO[i][1] - AO[i - 1][1]) * ((h - AO[i - 1][0]) / (AO[i][0] - AO[i - 1][0])); return AO[AO.length - 1][1]; };
    const col = (y) => tmp.copy(tint).multiplyScalar(dirt * ao(y - base)).clone();
    const gf = base + GF_H;
    const offAt = (y) => (ovr && y > gf ? ovr[Math.min(ovr.length - 1, Math.floor((y - gf) / fh))] : 0);
    const capUV = [0, 0, 0.05, 0, 0.05, 0.03, 0, 0.03];
    const piece = (ya, yb, m, vmap, ta = t0, tb = t1, ua = uAt(ta), ub = uAt(tb)) => {
      if (yb - ya < 0.02) return;
      const xa = ax + dx * ta, za = az + dz * ta, xb = ax + dx * tb, zb = az + dz * tb;
      const ys = [ya];
      for (const [h] of AO) { const y = base + h; if (y > ya + 0.05 && y < yb - 0.05) ys.push(y); }
      if (ovr) for (let n = 0; n <= ovr.length; n++) { const y = gf + n * fh; if (y > ya + 0.05 && y < yb - 0.05) ys.push(y); }
      ys.push(yb); ys.sort((p, q) => p - q);
      for (let i = 0; i + 1 < ys.length; i++) {
        const a = ys[i], b = ys[i + 1], off = offAt((a + b) / 2), Xa = xa + nx * off, Za = za + nz * off, Xb = xb + nx * off, Zb = zb + nz * off;
        quad(m, [Xa, a, Za], [Xb, a, Zb], [Xb, b, Zb], [Xa, b, Za], [ua, vmap(a), ub, vmap(a), ub, vmap(b), ua, vmap(b)], col(a), col(b));
        if (off > 0.001) { // return faces at the two ends of the edge (the storey juts out of the wall)
          if (ta === 0) quad(st.main, [xa, a, za], [Xa, a, Za], [Xa, b, Za], [xa, b, za], capUV, col(a), col(b));
          if (tb === 1) quad(st.main, [Xb, a, Zb], [xb, a, zb], [xb, b, zb], [Xb, b, Zb], capUV, col(a), col(b));
        }
      }
    };
    const upper = (ya, yb) => { // above the ground floor: the main layer, or the open loft of the top storey
      if (st.gal && st.galY < yb) { piece(ya, Math.min(yb, st.galY), st.main, (y) => (y - gf) / (fh * 2 * sc)); piece(Math.max(ya, st.galY), yb, st.gal, (y) => (y - gf) / (fh * 2 * sc)); }
      else piece(ya, yb, st.main, (y) => (y - gf) / (fh * 2 * sc));
    };
    const gfRec = base === 0 ? (st.shop || st.gf) : null;
    if (gfRec && y0 < gf) {
      const top = Math.min(y1, gf), gv = (y) => y / GF_H;
      if (car && !st.shop && y0 < 0.01 && car.t1 > t0 && car.t0 < t1) { // porte cochère : un morceau de rez-de-chaussée peint (3,4 m), les deux côtés en pierre
        const ca = Math.max(t0, car.t0), cb = Math.min(t1, car.t1);
        piece(y0, top, gfRec, gv, t0, ca); piece(y0, top, newLayer('carriage'), gv, ca, cb, 1, 0); piece(y0, top, gfRec, gv, cb, t1);
      } else piece(y0, top, gfRec, gv);
      upper(Math.max(y0, gf), y1);
    } else upper(y0, y1);
    if (ovr) { // soffits under each jutting storey: the dark underside of the oak sill beam
      for (let n = 1; n <= ovr.length; n++) {
        const yB = gf + (n - 1) * fh;
        if (yB <= y0 + 0.05 || yB >= y1 - 0.05) continue;
        const o0 = n === 1 ? 0 : ovr[n - 2], o1 = ovr[n - 1];
        if (o1 - o0 < 0.01) continue;
        const c = col(yB).multiplyScalar(0.7);
        quad(st.main, [x0 + nx * o0, yB, z0 + nz * o0], [x1 + nx * o0, yB, z1 + nz * o0], [x1 + nx * o1, yB, z1 + nz * o1], [x0 + nx * o1, yB, z0 + nz * o1], [0, 0, 0.3, 0, 0.3, 0.03, 0, 0.03], c, c);
        // oak corbels under the jutting storey (static relief, merged per tile)
        const cb = hexC('#3a2418').multiplyScalar(dirt).multiply(tint), step = CFG.timber.corbel;
        for (let sC = step / 2; sC < len * (t1 - t0); sC += step) relief.box(x0 + ux * sC + nx * o0, yB - 0.32, z0 + uz * sC + nz * o0, nx, nz, 0.14, 0.32, o1 - o0 + 0.02, cb, 'fs');
      }
    }
    // shop front (static relief): stone pilasters on the piers and a cornice above the sign
    if (st.shop && base === 0 && y0 < 0.01 && y1 > GF_H - 0.1) {
      const pc = hexC('#9a8a74').multiplyScalar(dirt).multiply(tint), lenP = len * (t1 - t0);
      relief.box(x0 + ux * lenP / 2, GF_H - 0.18, z0 + uz * lenP / 2, nx, nz, lenP - 0.05, 0.18, 0.16, pc, 'fts');
      for (let k = Math.ceil((st.uoff * 8 - t1 * len) / 4); k <= Math.floor((st.uoff * 8 - t0 * len) / 4); k++) { // pier centres: u = uoff - s / 8 = k / 2
        const sP = st.uoff * 8 - 4 * k - t0 * len;
        if (sP < 0.25 || sP > lenP - 0.25) continue;
        relief.box(x0 + ux * sP, 0, z0 + uz * sP, nx, nz, 0.36, GF_H - 0.18, 0.09, pc, 'fs');
      }
    }
    if (car && !st.shop && y0 < 0.01 && car.t1 > t0 && car.t0 < t1) { // carriage door: stone jambs and keystone proud of the painted arch
      const sd = len * (car.t0 + car.t1) / 2, kc = hexC('#d6b89c').multiplyScalar(dirt).multiply(tint);
      for (const dxs of [-1.375, 1.375]) relief.box(ax + ux * (sd + dxs), 0, az + uz * (sd + dxs), nx, nz, 0.28, 2.6, 0.12, kc, 'fts');
      relief.box(ax + ux * sd, GF_H - 0.7, az + uz * sd, nx, nz, 0.34, 0.5, 0.14, kc, 'fts');
    }
    // oriels (neustadt): three-sided bay windows from floor 1 to 3, one every 12 m on long street walls
    const ori = st.ori, oriS = [];
    if (ori && street && t0 === 0 && t1 === 1 && len >= ori.minWall) {
      const y0o = gf + (ori.floors[0] - 1) * fh, y1o = Math.min(gf + ori.floors[1] * fh, y1 - 0.5), s00o = P * (st.uoff - 0.25), cnt = Math.floor(len / ori.every);
      if (y1o - y0o >= fh * 1.5) {
        for (let j = 0; j < cnt; j++) {
          const sC = s00o - bay * Math.round((s00o - (len * (j + 0.5)) / cnt) / bay);
          if (sC < ori.w / 2 + 1 || sC > len - ori.w / 2 - 1 || oriS.some((q) => Math.abs(q - sC) < ori.w)) continue;
          oriS.push(sC);
          const pt = (s, o, y) => [ax + ux * s + nx * o, y, az + uz * s + nz * o], dw = (ori.w - 1.4) / 2, v = (y) => (y - gf) / (fh * 2), uS = (s) => st.uoff - s / P;
          const sl = [sC - ori.w / 2, sC - ori.w / 2 + dw, sC + ori.w / 2 - dw, sC + ori.w / 2], ol = [0, ori.d, ori.d, 0];
          for (let q = 0; q < 3; q++) {
            const ca = col(y0o), cb2 = col(y1o);
            quad(st.main, pt(sl[q], ol[q], y0o), pt(sl[q + 1], ol[q + 1], y0o), pt(sl[q + 1], ol[q + 1], y1o), pt(sl[q], ol[q], y1o), [uS(sl[q]), v(y0o), uS(sl[q + 1]), v(y0o), uS(sl[q + 1]), v(y1o), uS(sl[q]), v(y1o)], ca, cb2);
          }
          const dk = col(y0o).multiplyScalar(0.6);
          quad(st.main, pt(sl[0], 0, y0o), pt(sl[1], ori.d, y0o), pt(sl[2], ori.d, y0o), pt(sl[3], 0, y0o), [0, 0, 0.2, 0, 0.2, 0.03, 0, 0.03], dk, dk);
          const apex = pt(sC, ori.d * 0.45, y1o + 0.9), rc = st.roofCol;
          for (let q = 0; q < 3; q++) tri(roofR, pt(sl[q], ol[q], y1o), pt(sl[q + 1], ol[q + 1], y1o), apex, [0, 0, 1, 0, 0.5, 1], rc);
        }
      }
    }

    // ---- relief : mêmes positions que les fenêtres dessinées (une fenêtre par travée de `bay` m, par étage de `fh` m)
    const W = st.W;
    if (W && sc === 1) {
      const s0 = len * t0, s1 = len * t1, shopGF = !!st.shop && base === 0;
      const s00 = P * (st.uoff - 0.25);
      const lo = Math.ceil((s00 - (s1 - W.w / 2 - 0.35)) / bay), hi = Math.floor((s00 - (s0 + W.w / 2 + 0.35)) / bay);
      const trimC = hexC(W.trim(st.variant));
      const doorS = car ? len * (car.t0 + car.t1) / 2 : null;
      for (let k = lo; k <= hi; k++) {
        for (let j = 0; j < W.n; j++) {
          const sk = s00 - bay * k - (j - (W.n - 1) / 2) * (bay / W.n);
          if (sk < s0 + W.w / 2 + 0.2 || sk > s1 - W.w / 2 - 0.2) continue;
          for (let n = -1; n < 60; n++) {
            const wy = gf + n * fh + W.b;
            if (wy + W.h > y1 - 0.2 || wy >= (st.galY ?? Infinity) - 0.01) break;
            if (wy < y0 - 1e-3 || (shopGF ? wy < gf : wy < base + 0.3)) continue;
            if (n === -1 && (W.noGF || (st.gf && !st.W.gfWin))) continue; // ground floor with its own painted layer: no frame unless it matches
            if (n === -1 && doorS !== null && Math.abs(sk - doorS) < 2.4) continue;
            if (oriS.length && n >= 1 && oriS.some((q) => Math.abs(q - sk) < st.ori.w / 2 + 0.3) && wy + W.h / 2 < gf + st.ori.floors[1] * fh) continue; // hidden inside an oriel
            const off = offAt(wy + W.h / 2), px = ax + ux * sk + nx * off, pz = az + uz * sk + nz * off, h = hash2(px * 1.7, pz * 1.3 + wy);
            const c = tmp.copy(trimC).multiplyScalar(dirt * ao(wy + W.h / 2 - base) * (0.92 + 0.16 * h)).clone().multiply(tint);
            relief.window(px, wy, pz, nx, nz, W.w / 1.25, W.h / 1.85, c, n === 0 && h < 0.16 && !W.timber);
          }
        }
      }
      if (y1 - y0 > 2.5 && (t1 - t0) * len >= 2.2) { // corniche en haut du mur (pas sur les petits morceaux)
        const offTop = offAt(y1 - 0.05);
        relief.cornice(x0 + nx * offTop, z0 + nz * offTop, x1 + nx * offTop, z1 + nz * offTop, nx, nz, y1, hexC(W.cornice).multiplyScalar(dirt).multiply(tint), W.cornSy || 1);
        if (W.timber) { // oak sill beams at every floor line (they carry the overhang)
          const beamC = hexC(W.cornice).multiplyScalar(dirt * 0.9).multiply(tint);
          for (let n = 1; n < 60; n++) {
            const fy = gf + (n - 1) * fh + 0.2;
            if (fy > y1 - 0.8) break;
            if (fy < y0 + 0.3) continue;
            const o = offAt(fy + 0.1);
            relief.cornice(x0 + nx * o, z0 + nz * o, x1 + nx * o, z1 + nz * o, nx, nz, fy, beamC, 1.4);
          }
        } else {
          // bandeaux d'étage (v0.72.0) : un cordon de pierre saillant à chaque plancher, sous les appuis de fenêtre
          const bandC = hexC(W.cornice).multiplyScalar(dirt * 0.95).multiply(tint);
          for (let n = 1; n < 60; n++) {
            const fy = gf + n * fh + 0.35;
            if (fy > y1 - 0.6) break;
            if (fy < y0 + 0.3) continue;
            relief.cornice(x0, z0, x1, z1, nx, nz, fy, bandC, 0.75);
          }
        }
        // chaînage d'angle (v0.73.0) : à l'angle de départ de chaque mur entier, de la base au toit (pas pour les colombages)
        if (!W.timber && t0 === 0 && y0 <= base + 0.01 && y1 - base > 4) {
          relief.quoin(ax + nx * 0.005, az + nz * 0.005, base + 0.1, y1 - 0.2, nx, nz, hexC(W.cornice).multiplyScalar(dirt * 0.88).multiply(tint));
        }
        // soubassement de pierre au pied des murs hors boutiques (v0.72.0)
        if (base === 0 && y0 <= 0.01 && !shopGF && y1 > 3.5) relief.plinth(x0, z0, x1, z1, nx, nz, 0.88, hexC(W.cornice).multiplyScalar(dirt * 0.78).multiply(tint));
      }
      if (t0 === 0 && y0 <= base + 0.01 && y1 - base > 5 && hash2(ax * 0.9, az * 1.1) < 0.45) { // descente de gouttière au coin de départ
        relief.pipe(ax + ux * 0.2 + nx * 0.06, az + uz * 0.2 + nz * 0.06, base + 0.05, y1 - 0.3);
      }
    }
  }

  // ---------- toits
  function roofColorLegacy(tags, kind) { // (parts) same draws as before
    const c = tags && tags['roof:colour'];
    if (c && /^#|^[a-z]+$/i.test(c)) { try { return new THREE.Color(c === 'black' ? '#3a3a3e' : c === 'white' ? '#cfcfcf' : c); } catch { /* couleur inconnue */ } }
    const pal = ROOF_TINTS[kind] || ROOF_TINTS.tiles;
    return new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
  }
  const roofTagColour = (tags) => {
    const c = tags && tags['roof:colour'];
    if (c && /^#|^[a-z]+$/i.test(c)) { try { return new THREE.Color(c === 'black' ? '#3a3a3e' : c === 'white' ? '#cfcfcf' : c); } catch { /* couleur inconnue */ } }
    return null;
  };
  function roofKind(tags) {
    const m = (tags && (tags['roof:material'] || '')) || '';
    if (m === 'copper') return 'copper';
    if (m === 'slate') return 'slate';
    if (m === 'metal' || m === 'glass' || m === 'concrete') return 'metal';
    if (m === 'stone' || ((tags && tags['building:material']) || '').includes('stone')) return 'stone';
    return 'tiles';
  }

  // Dormer standing on a slope: front rectangle (+ pediment) on `face`, cheeks and roof in the roof colour. (fx, fy, fz): centre of the sill ON the roof surface,
  // (ox, oz): outward unit vector of the slope, (ux, uz): unit vector along the eave, sl: slope (rise per metre run). 6 to 9 triangles.
  function dormer(d) {
    const { fx, fy, fz, ox, oz, ux, uz, w, h, sl, shed, face, roofCol, tint } = d;
    const ap = shed ? 0 : w * 0.85, rise = shed ? 0.3 : 0, D = h / sl, Dr = (h + ap + rise) / sl;
    const FL = [fx - ux * w, fy, fz - uz * w], FR = [fx + ux * w, fy, fz + uz * w], FLT = [FL[0], fy + h, FL[2]], FRT = [FR[0], fy + h, FR[2]];
    const back = (p, dist, y) => [p[0] - ox * dist, y, p[2] - oz * dist];
    quad(face, FL, FR, FRT, FLT, [0, 0, 1, 0, 1, 0.78, 0, 0.78], tint, tint);
    const Db = shed ? (h + rise) / sl : D, yb = fy + h + rise;
    tri(roofR, FL, FLT, back(FLT, Db, yb), [0, 0, 0, 0.4, 0.4, 0.4], roofCol);
    tri(roofR, FR, FRT, back(FRT, Db, yb), [0, 0, 0, 0.4, 0.4, 0.4], roofCol);
    if (shed) {
      quad(roofR, FLT, FRT, back(FRT, Db, yb), back(FLT, Db, yb), [0, 0, 0.7, 0, 0.7, 0.7, 0, 0.7], roofCol, roofCol);
    } else {
      const apex = [fx, fy + h + ap, fz], rb = back(apex, Dr, fy + h + ap);
      tri(face, FLT, FRT, apex, [0, 0.78, 1, 0.78, 0.5, 1], tint);
      quad(roofR, FLT, apex, rb, back(FLT, D, fy + h), [0, 0, 0.4, 0, 0.4, 0.7, 0, 0.7], roofCol, roofCol);
      quad(roofR, FRT, apex, rb, back(FRT, D, fy + h), [0, 0, 0.4, 0, 0.4, 0.7, 0, 0.7], roofCol, roofCol);
    }
  }

  // Toit à deux pans (pignons) : le polygone est coupé le long du faîtage, hauteurs linéaires de chaque côté
  // dm : { rows, face(), shedP, maxN } lucarnes ; gm : calque du triangle de pignon
  function gabled(pts, top, rh, ob, st, tint, dirt, roofCol, across, dm, gm, xs = {}) {
    let { ux, uz, vx, vz, hw, hl } = ob;
    if (across) { [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; [hl, hw] = [hw, hl]; }
    const tOf = ([x, z]) => (x - ob.cx) * vx + (z - ob.cz) * vz;
    const sOf = ([x, z]) => (x - ob.cx) * ux + (z - ob.cz) * uz;
    const hOf = (p) => top + rh * Math.max(0, 1 - Math.abs(tOf(p)) / hw);
    const slopeLen = Math.hypot(hw, rh);
    for (const side of [1, -1]) {
      const half = clipHalf(pts, (p) => side * tOf(p));
      if (half.length < 3) continue;
      try {
        const tris = THREE.ShapeUtils.triangulateShape(half.map(([x, z]) => new THREE.Vector2(x, z)), []);
        for (const [a, b, c] of tris) {
          const P = [half[a], half[b], half[c]];
          const v3 = P.map((p) => [p[0], hOf(p), p[1]]);
          const uv = P.flatMap((p) => [sOf(p) / 3, ((hw - Math.abs(tOf(p))) / hw) * slopeLen / 3]);
          tri(roofR, v3[0], v3[1], v3[2], uv, roofCol);
        }
      } catch { /* polygone dégénéré */ }
    }
    // cheminée de brique sur le faîtage (relief.js), sur un peu plus d'un toit sur deux
    if (rh > 2.5 && hl > 3.5) {
      const hh = hash2(ob.cx * 0.37, ob.cz * 0.53);
      if (hh < 0.6) {
        const sOff = (hash2(ob.cx, ob.cz * 1.9) - 0.5) * hl * 1.1, cxp = ob.cx + ux * sOff, czp = ob.cz + uz * sOff;
        if (pointIn(pts, cxp, czp)) relief.chimney(cxp, czp, top + rh - 1.2, top + rh + 0.9 + hh * 0.8, 0.42, Math.atan2(uz, ux), hexC('#9a5a48').multiplyScalar(dirt));
      }
    }
    // pignons : on comble entre l'égout et le toit au-dessus de chaque façade
    const gRec = gm || st.main, gP = gm ? 6.8 : st.bay * 2, gH = gm ? 4.4 : st.fh * 2, gO = gm ? top : GF_H;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ta = tOf(a), tb = tOf(b);
      const segs = (ta > 0) !== (tb > 0) && ta !== 0 && tb !== 0 ? (() => { const t = ta / (ta - tb); const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; return [[a, m], [m, b]]; })() : [[a, b]];
      for (const [p, q] of segs) {
        const hp = hOf(p), hq = hOf(q);
        if (hp - top < 0.05 && hq - top < 0.05) continue;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const u0 = st.uoff, u1 = st.uoff - len / gP;
        const v = (y) => (y - gO) / gH;
        const c = tmp.copy(tint).multiplyScalar(dirt).clone(), gnx = (q[1] - p[1]) / len, gnz = -(q[0] - p[0]) / len;
        if (xs.stepped) { // Renaissance stepped gable: rectangular steps standing above the slope, with a tread on each
          const k = Math.max(3, Math.min(6, Math.round(Math.abs(hq - hp) / 0.9))), tc = c.clone().multiplyScalar(0.8);
          for (let j = 0; j < k; j++) {
            const f0 = j / k, f1 = (j + 1) / k, H = hp + (hq - hp) * (hp < hq ? f1 : f0);
            const A = [p[0] + (q[0] - p[0]) * f0, p[1] + (q[1] - p[1]) * f0], B = [p[0] + (q[0] - p[0]) * f1, p[1] + (q[1] - p[1]) * f1];
            quad(gRec, [A[0], top, A[1]], [B[0], top, B[1]], [B[0], H, B[1]], [A[0], H, A[1]], [u0 + (u1 - u0) * f0, v(top), u0 + (u1 - u0) * f1, v(top), u0 + (u1 - u0) * f1, v(H), u0 + (u1 - u0) * f0, v(H)], c, c);
            quad(gRec, [A[0], H, A[1]], [B[0], H, B[1]], [B[0] - gnx * 0.3, H, B[1] - gnz * 0.3], [A[0] - gnx * 0.3, H, A[1] - gnz * 0.3], [0, 0, 0.1, 0, 0.1, 0.02, 0, 0.02], tc, tc);
          }
        } else quad(gRec, [p[0], top, p[1]], [q[0], top, q[1]], [q[0], hq, q[1]], [p[0], hp, p[1]], [u0, v(top), u1, v(top), u1, v(hq), u0, v(hp)], c, c);
        if (xs.barge && Math.abs(hq - hp) > 1) relief.ribbon([p[0], hp, p[1]], [q[0], hq, q[1]], gnx, gnz, 0.3, 0.09, hexC('#3a2418').multiplyScalar(dirt).multiply(tint)); // barge board along the gable edge
      }
    }
    // lucarnes (rows of dormers up the two slopes, each row 18 % smaller; shed dormers on timber houses)
    if (dm && dm.rows > 0 && rh > 2.6 && hl > 2.2) {
      const sl = rh / hw, step = dm.step, n = Math.max(1, Math.floor((hl * 2 - 1.4) / step));
      let count = 0;
      for (let r = 0; r < dm.rows; r++) {
        const sc = Math.pow(dm.shrink, r), w = 0.5 * sc, h = 1.2 * sc, yR = 0.9 + r * 2.3;
        if (yR + h + (dm.shed ? 0.3 : w * 0.85) > rh - 0.25) break;
        const tpos = hw * (1 - yR / rh);
        for (const side of [1, -1]) {
          for (let k = 0; k < n; k++) {
            if (count >= dm.maxN) return;
            const s = (k - (n - 1) / 2) * step, cx = ob.cx + ux * s + vx * side * tpos, cz = ob.cz + uz * s + vz * side * tpos;
            if (!pointIn(pts, cx + vx * side * 0.6, cz + vz * side * 0.6)) continue;
            dormer({ fx: cx, fy: top + yR, fz: cz, ox: vx * side, oz: vz * side, ux, uz, w, h, sl, shed: dm.shed, face: dm.face(), roofCol, tint });
            count++;
          }
        }
      }
    }
  }

  // Toit à la Mansart : pente raide sur le pourtour (inset d), terrasse au centre ; lucarnes alignées sur les fenêtres des murs de rue (dm)
  function mansard(pts, top, rh, roofCol, dIn = null, dm = null) {
    const d = dIn ?? Math.min(2.4, rh * 0.6);
    const n = pts.length, inner = [];
    for (let i = 0; i < n; i++) {
      const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
      const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
      const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
      // normales intérieures (polygone orienté positivement : l'intérieur est à gauche)
      const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
      let bx = n1[0] + n2[0], bz = n1[1] + n2[1]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const cos = Math.max(0.35, bx * n1[0] + bz * n1[1]);
      inner.push([c[0] + (bx * d) / cos, c[1] + (bz * d) / cos]);
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], ia = inner[i], ib = inner[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // deux triangles (tri oriente toujours vers le haut) : sur une arete courte le decalage interieur peut retourner l'arete du haut, le quad se vrille et son enroulement contredit sa normale
      const pa = [a[0], top, a[1]], pb = [b[0], top, b[1]], pib = [ib[0], top + rh, ib[1]], pia = [ia[0], top + rh, ia[1]];
      tri(roofR, pa, pb, pib, [0, 0, len / 3, 0, len / 3, rh / 2.5], roofCol);
      tri(roofR, pa, pib, pia, [0, 0, len / 3, rh / 2.5, 0, rh / 2.5], roofCol);
    }
    flat(polyArea(inner) > 1 ? inner : pts, top + rh, roofCol);
    if (dm) { // one dormer per bay on the street walls, aligned with the windows below
      let count = 0;
      for (let i = 0; i < n && count < dm.maxN; i++) {
        if (!dm.streetEdges || !dm.streetEdges[i]) continue;
        const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < dm.bay + 1.2) continue;
        const ux = dx / len, uz = dz / len, nx = dz / len, nz = -dx / len, P = dm.bay * 2, s00 = P * (dm.uoff - 0.25), f = 0.3, sl = rh / d;
        for (let k = Math.ceil((s00 - (len - 0.9)) / dm.bay); k <= Math.floor((s00 - 0.9) / dm.bay); k++) {
          if (count >= dm.maxN) break;
          const sk = s00 - dm.bay * k, fx = a[0] + ux * sk - nx * d * f, fz = a[1] + uz * sk - nz * d * f;
          if (!pointIn(pts, fx - nx * 0.3, fz - nz * 0.3)) continue;
          dormer({ fx, fy: top + rh * f, fz, ox: nx, oz: nz, ux, uz, w: 0.55 * dm.w, h: 1.25, sl, shed: false, face: dm.face(), roofCol, tint: dm.tint });
          count++;
        }
      }
    }
  }
  function flat(pts, y, roofCol) {
    try {
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of tris) tri(roofR, [pts[a][0], y, pts[a][1]], [pts[b][0], y, pts[b][1]], [pts[c][0], y, pts[c][1]], [pts[a][0] / 4, pts[a][1] / 4, pts[b][0] / 4, pts[b][1] / 4, pts[c][0] / 4, pts[c][1] / 4], roofCol);
    } catch { /* polygone dégénéré */ }
  }
  function pyramidal(pts, top, rh, roofCol) {
    let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      tri(roofR, [a[0], top, a[1]], [b[0], top, b[1]], [cx, top + rh, cz], [0, 0, len / 3, 0, len / 6, rh / 2.5], roofCol);
    }
  }
  function skillion(pts, top, rh, ob, roofCol, st, tint, dirt) {
    const tOf = ([x, z]) => (x - ob.cx) * ob.vx + (z - ob.cz) * ob.vz;
    const hOf = (p) => top + rh * ((tOf(p) + ob.hw) / (2 * ob.hw));
    try {
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of tris) { const P = [pts[a], pts[b], pts[c]]; tri(roofR, ...P.map((p) => [p[0], hOf(p), p[1]]), P.flatMap((p) => [p[0] / 3, p[1] / 3]), roofCol); }
    } catch { /* polygone dégénéré */ }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], hp = hOf(p), hq = hOf(q);
      if (hp - top < 0.05 && hq - top < 0.05) continue;
      const c = tmp.copy(tint).multiplyScalar(dirt).clone();
      quad(st.main, [p[0], top, p[1]], [q[0], top, q[1]], [q[0], hq, q[1]], [p[0], hp, p[1]], [0, 0, 1, 0, 1, 0.3, 0, 0.3], c, c);
    }
  }

  // x : { mansardD, dm (dormers), gm (gable layer) }
  function roof(pts, top, shape, rh, ob, st, tint, dirt, roofCol, tags, x = {}) {
    if (!ob || rh < 0.2 || shape === 'flat') return flat(pts, top, roofCol);
    if (shape === 'pyramidal' || shape === 'dome' || shape === 'onion' || shape === 'cone') return pyramidal(pts, top, rh, roofCol);
    if (shape === 'skillion') return skillion(pts, top, rh, ob, roofCol, st, tint, dirt);
    if (shape === 'mansard_ring') return mansard(pts, top, rh, roofCol, x.mansardD, x.dmM);
    return gabled(pts, top, rh, ob, st, tint, dirt, roofCol, tags && tags['roof:orientation'] === 'across', x.dm, x.gm, x);
  }

  // Corner turrets of the Neustadt blocks: a corbelled 10-sided tower on convex street corners of 60-120 degrees (at most 2 per building), with a cone roof
  function turrets(pts, streetEdges, wallTop, st, tint, dirt, roofCol, T, R) {
    const n = pts.length, gf = GF_H;
    let made = 0;
    for (let i = 0; i < n && made < 2; i++) {
      if (!streetEdges[(i - 1 + n) % n] || !streetEdges[i]) continue;
      const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
      const v1 = [p[0] - c[0], p[1] - c[1]], v2 = [q[0] - c[0], q[1] - c[1]], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
      if (l1 < 4 || l2 < 4) continue;
      const cosA = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2), ang = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
      const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
      if (e1[0] * e2[1] - e1[1] * e2[0] <= 0 || ang < 60 || ang > 120) continue; // convex corners only
      if (R() >= T.chance) continue;
      let bx = -(v1[0] / l1 + v2[0] / l2), bz = -(v1[1] / l1 + v2[1] / l2); const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const cx = c[0] + bx * T.r * 0.5, cz = c[1] + bz * T.r * 0.5, y0 = gf, y1 = wallTop + 1.2, ns = T.sides, P2 = st.bay * 2, fh = st.fh;
      const ring = (r, y, k) => [cx + Math.cos((k / ns) * Math.PI * 2) * r, y, cz + Math.sin((k / ns) * Math.PI * 2) * r];
      const circ = (Math.PI * 2 * T.r) / ns, col = tmp.copy(tint).multiplyScalar(dirt).clone(), dk = col.clone().multiplyScalar(0.6);
      for (let k = 0; k < ns; k++) {
        const u0 = st.uoff + (k * circ) / P2, u1 = st.uoff + ((k + 1) * circ) / P2, v = (y) => (y - gf) / (fh * 2);
        quad(st.main, ring(T.r, y0, k), ring(T.r, y0, k + 1), ring(T.r, y1, k + 1), ring(T.r, y1, k), [u0, v(y0), u1, v(y0), u1, v(y1), u0, v(y1)], col, col);
        tri(st.main, ring(T.r, y0, k), ring(T.r, y0, k + 1), [cx, y0 - 1.2, cz], [u0, 0, u1, 0, (u0 + u1) / 2, 0.02], dk); // corbel under the tower
        tri(roofR, ring(T.r * 1.08, y1, k), ring(T.r * 1.08, y1, k + 1), [cx, y1 + 3.6, cz], [0, 0, 1, 0, 0.5, 1.4], roofCol);
      }
      made++;
    }
  }

  // ---------- anciens tirages : l'ancien choix de style, rejoué à l'identique
  function legacyStyleFor(tags, area, levels) {
    const b = tags.building || 'yes', m = tags['building:material'] || '';
    if (b === 'cathedral' || b === 'church' || b === 'chapel' || tags.religion) return 'gothic';
    if (m === 'glass' || b === 'office' && area > 800) return 'modern';
    if (m === 'timber_framing') return 'timber';
    if (m === 'sandstone' || m === 'stone') return 'sandstone';
    if (m === 'plaster') return 'plaster';
    const r = rnd();
    if (['civic', 'government', 'public', 'school', 'university', 'hotel', 'bank'].includes(b)) return r < 0.65 ? 'sandstone' : 'plaster';
    if (area < 260 && levels <= 5) return r < 0.42 ? 'timber' : r < 0.9 ? 'plaster' : 'sandstone';
    return r < 0.62 ? 'plaster' : r < 0.94 ? 'sandstone' : 'modern';
  }
  // Replays, in the same order, every draw of the world `rnd` that building() used to make: style, variant, shop, lazy legacy textures, offset, tint,
  // dirt, roof colour, dormers (2 per candidate, count from the OLD roof). The values are kept (raw floats) and reused by the new look.
  function legacyDraws(tags, area, levels, ob, opts) {
    const L = { style: legacyStyleFor(tags, area, levels), shopL: null };
    L.variant = Math.floor(rnd() * LEGACY[L.style][0]);
    // (old roof, only to know how many dormer draws follow)
    let shape = tags['roof:shape'] || null;
    if (!shape) shape = L.style === 'modern' ? 'flat' : ob && ob.hw <= 9.5 ? 'gabled' : 'mansard_ring';
    if (HIPPED.includes(shape)) shape = ob && ob.hw <= 9.5 ? 'gabled' : 'mansard_ring';
    let rh = num(tags['roof:height']);
    if (rh == null) {
      const roofLevels = num(tags['roof:levels']);
      if (shape === 'gabled') rh = ob ? Math.min(11, Math.max(3, ob.hw * (roofLevels ? 1.1 + roofLevels * 0.15 : 1.25))) : 4;
      else if (shape === 'mansard_ring') rh = roofLevels ? roofLevels * 2.8 : 4;
      else if (shape === 'pyramidal') rh = ob ? ob.hw * 1.4 : 4;
      else if (shape === 'skillion') rh = 2.5;
      else rh = 0;
    }
    if (opts.shop && L.style !== 'gothic' && L.style !== 'modern' && levels >= 2) { L.s1 = rnd(); L.s2 = rnd(); L.shopL = matFor('shop', Math.floor(L.s1 * 6) % 3 + 3 * Math.floor(L.s2 * 2)); }
    L.main = matFor(L.style, L.variant);
    L.uoff = rnd();
    const bc = tags['building:colour'];
    L.rt = bc && /^#/.test(bc) ? null : rnd();
    L.dirt = 0.82 + rnd() * 0.18;
    L.rr = roofTagColour(tags) ? null : rnd();
    if (opts.inSector && shape === 'gabled' && ob && rh >= 0.2) {
      let hl = ob.hl;
      if (tags['roof:orientation'] === 'across') hl = ob.hw;
      if (rh > 3.5 && hl > 3.5) { matFor('dormer', 0); const n = Math.floor((hl * 2 - 2) / 3.2); for (let i = 0; i < 2 * n; i++) rnd(); }
    }
    return L;
  }

  // Construit un bâtiment sans rien en garder : tire exactement les mêmes nombres aléatoires (textures, styles, teintes) mais
  // efface la géométrie produite. Sert à retirer un bâtiment du rendu sans décaler la suite du tirage `rnd`, donc sans changer
  // l'aspect des autres façades ni l'emplacement des objets placés ensuite (machines, armes murales…).
  function ghost(fn) {
    const all = () => [roofB, wallB];
    const before = new Map(all().map((b) => [b, [b.pos.length, b.nor.length, b.uv.length, b.col.length, b.fac.length, b.idx.length]]));
    const rm = relief.mark();
    const r = fn();
    relief.rollback(rm);
    for (const b of all()) {
      const [p, n, u, c, f, i] = before.get(b) || [0, 0, 0, 0, 0, 0];
      b.pos.length = p; b.nor.length = n; b.uv.length = u; b.col.length = c; b.fac.length = f; b.idx.length = i;
    }
    return r;
  }

  const desat = (c, k) => { const g = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; c.r = lerp(c.r, g, k); c.g = lerp(c.g, g, k); c.b = lerp(c.b, g, k); return c; };

  return {
    // Bâtiment complet. cutsOf(i) : ouvertures (passages) du mur i. Retourne { wallTop, roofTop }.
    // opts.ghost : le construire « pour rien » (voir ghost) ; opts.island : sur l'île ; opts.streetEdges[i] : le mur i donne sur la rue
    building(pts, tags, hGuess, cutsOf, opts = {}) {
      if (opts.rnd && opts.rnd !== rnd) { // a streamed tile draws from its own generator
        const prev = rnd; rnd = opts.rnd;
        try { return this.building(pts, tags, hGuess, cutsOf, { ...opts, rnd: null }); } finally { rnd = prev; }
      }
      if (opts.ghost) return ghost(() => this.building(pts, tags, hGuess, cutsOf, { ...opts, ghost: false }));
      const area = Math.abs(polyArea(pts));
      const levelsTag = num(tags['building:levels']);
      const levels = levelsTag != null ? Math.max(1, levelsTag) : Math.max(2, Math.round((hGuess - GF_H) / FLOOR_H) + 1);
      const ob = obb(pts);
      const ignH = num(opts.ignH ?? tags['ign:h']);
      const L = legacyDraws(tags, area, levels, ob, opts); // world rnd: nothing else in this function may touch it
      let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
      const streetEdges = opts.streetEdges || null;
      let frontage = 0, frontI = -1;
      if (streetEdges) for (let i = 0; i < pts.length; i++) { if (!streetEdges[i]) continue; const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], l = Math.hypot(bx - ax, bz - az); if (l > frontage) { frontage = l; frontI = i; } }
      const cls = classify({ tags, area, levels, ignH, frontage, island: !!opts.island, cx, cz }, CFG);
      const style = opts.style || cls.style;
      const R = buildingRng(CFG, cx, cz); R(); // (the first draw is the classifier's)
      const S = CFG[style] || null, fh = S && S.floorH ? S.floorH : FLOOR_H, bay = S && S.bay ? S.bay : BAY_W;
      const legacyStyle = style === 'gothic';
      // hauteurs
      let wallTop = GF_H + (levels - 1) * FLOOR_H;
      let shape = tags['roof:shape'] || null;
      const roofLevels = num(tags['roof:levels']);
      const hw = ob ? ob.hw : 0;
      if (!shape) shape = style === 'modern' ? 'flat' : style === 'classical' ? 'mansard_ring' : ob && hw <= 9.5 ? 'gabled' : 'mansard_ring';
      if (HIPPED.includes(shape)) shape = style === 'classical' ? 'mansard_ring' : ob && hw <= 9.5 ? 'gabled' : 'mansard_ring';
      let rh = num(tags['roof:height']);
      const pitch = S && S.pitch ? lerp(S.pitch[0], S.pitch[1], R()) : 0;
      let mD = null;
      if (rh == null) {
        if (shape === 'gabled') rh = ob ? (pitch ? Math.min(12.5, Math.max(3, hw * Math.tan(pitch * Math.PI / 180))) : Math.min(11, Math.max(3, hw * (roofLevels ? 1.1 + roofLevels * 0.15 : 1.25)))) : 4;
        else if (shape === 'mansard_ring') rh = style === 'classical' ? S.mansardH * fh : roofLevels ? roofLevels * 2.8 : 4;
        else if (shape === 'pyramidal') rh = ob ? hw * 1.4 : 4;
        else if (shape === 'skillion') rh = 2.5;
        else rh = 0;
      }
      if (shape === 'mansard_ring' && style === 'classical' && S) mD = rh / Math.tan(S.brisis * Math.PI / 180);
      const height = num(tags.height);
      if (height != null) wallTop = Math.max(3, height - rh);
      else if (levelsTag == null && ignH != null) {
        const ignLevels = Math.max(1, Math.min(8, Math.round((ignH - GF_H) / FLOOR_H) + 1));
        wallTop = GF_H + (ignLevels - 1) * FLOOR_H;
      }
      if (style === 'gothic' && height == null) wallTop = Math.max(wallTop, 14);
      if (!legacyStyle && fh !== FLOOR_H && wallTop >= GF_H - 0.3) { // keep the building height (or its storey count when the data gives it) with this style's storeys
        const up = levelsTag != null && height == null ? levels - 1 : Math.max(0, Math.round((wallTop - GF_H) / fh));
        wallTop = GF_H + up * fh;
      }
      const nUp = Math.max(0, Math.round((wallTop - GF_H) / fh));
      // ---- calques
      const pal = (arr) => arr[Math.floor((L.rt ?? 0.5) * arr.length)];
      let main, gfRec = null, tintHex, W = null, gable = null, gal = null, variantN = 0;
      const nv = (n) => Math.floor(R() * n);
      if (style === 'gothic') { main = L.main; tintHex = PALETTES.gothic[Math.floor((L.rt ?? 0) * PALETTES.gothic.length)]; W = null; }
      else if (style === 'timber') { variantN = nv(3); main = newLayer(`timberN:${variantN}`); gfRec = newLayer('rustic:timber'); gable = newLayer('gable'); tintHex = pal(STYLE_TINTS.timber); W = WIN_NEW.timber; }
      else if (style === 'plaster') { variantN = L.variant % 4; main = newLayer(`plasterP:${variantN}`); tintHex = pal(PALETTES.plaster); W = (() => { const f = fh / FLOOR_H, o = WIN_LEGACY.plaster; return { ...o, h: o.h * f, b: o.b * f, gfWin: true }; })(); }
      else if (style === 'classical') { variantN = nv(2); main = newLayer(`classical:${variantN}`); gfRec = newLayer('rustic:classical'); tintHex = pal(variantN ? STYLE_TINTS.classical1 : STYLE_TINTS.classical0); W = { ...WIN_NEW.classical, gfWin: true }; }
      else if (style === 'civic') { variantN = 0; main = newLayer('civic'); gfRec = newLayer('arcade'); tintHex = pal(STYLE_TINTS.civic); W = WIN_NEW.civic; }
      else if (style === 'neustadt') { variantN = nv(2); main = newLayer(`neustadt:${variantN}`); gfRec = newLayer('rustic:neustadt'); tintHex = pal(STYLE_TINTS.neustadt); W = { ...WIN_NEW.neustadt, gfWin: true }; }
      else { variantN = 0; main = R() < 0.5 ? newLayer('modernStrip') : newLayer('modernP'); tintHex = pal(PALETTES.modern); W = null; } // modern
      const shopOK = opts.shop && cls.shop && style !== 'gothic' && style !== 'modern' && levels >= 2;
      let shop = null;
      if (shopOK) shop = L.shopL && R() < 0.6 ? L.shopL : newLayer(`shopN:${nv(4)}`);
      const st = { main, shop, gf: gfRec, gal: null, galY: Infinity, W, fh, bay, uoff: L.uoff, variant: variantN, scale: 1 };
      const bc = tags['building:colour'];
      const tint = new THREE.Color(bc && /^#/.test(bc) ? bc : tintHex);
      if (bc && /^#/.test(bc)) tint.lerp(new THREE.Color('#ffffff'), 0.4);
      else if (style === 'plaster' && S) desat(tint, S.desaturate);
      const dirt = L.dirt;
      let roofCol = roofTagColour(tags);
      if (!roofCol) {
        const kind = roofKind(tags), sp = STYLE_ROOF[style];
        const arr = kind === 'tiles' && sp ? sp : ROOF_TINTS[kind] || ROOF_TINTS.tiles;
        roofCol = new THREE.Color(arr[Math.floor((L.rr ?? 0.5) * arr.length)]);
      }
      st.roofCol = roofCol;
      if (style === 'neustadt') st.ori = S.oriel;
      // upper-storey gallery of the old tanners' lofts (Petite France, top storey of a gabled timber house)
      if (style === 'timber' && cls.district === 'petiteFrance' && nUp >= 2 && shape === 'gabled' && R() < S.gallery) { st.gal = newLayer('gallery'); st.galY = wallTop - fh; }
      // overhang (encorbellement) of the upper storeys on the street walls
      const ovrFor = (i, cuts) => {
        if (style !== 'timber' || !streetEdges || !streetEdges[i] || cuts.length || nUp < 2) return null;
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length]; if (Math.hypot(bx - ax, bz - az) < 3) return null;
        const o = []; for (let n = 1; n <= nUp; n++) o.push(Math.min(n, S.overhangMax) * S.overhang); return o;
      };
      // carriage door of the classical hôtels: centred on the longest street edge that has no cut (no passage, no interior door)
      let car = null, carI = -1;
      if (style === 'classical' && !shop && frontI >= 0 && R() < S.cochere && frontage >= S.cochereW + 2 && !(cutsOf ? cutsOf(frontI) : []).length) { car = { t0: 0.5 - 1.7 / frontage, t1: 0.5 + 1.7 / frontage }; carI = frontI; }
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
        const cuts = cutsOf ? cutsOf(i) : [];
        const ovr = ovrFor(i, cuts), cr = i === carI ? car : null;
        let t = 0;
        for (const [t0, t1, yLo, yHi] of cuts) {
          if (t0 > t) wall(ax, az, bx, bz, t, t0, 0, wallTop, st, tint, dirt);
          if (yLo != null) { wall(ax, az, bx, bz, t0, t1, 0, yLo, st, tint, dirt); wall(ax, az, bx, bz, t0, t1, yHi, wallTop, st, tint, dirt); } // window: [t0, t1, sill, lintel]
          else wall(ax, az, bx, bz, t0, t1, opts.passageH || 3.6, wallTop, st, tint, dirt);
          t = t1;
        }
        if (t < 1) wall(ax, az, bx, bz, t, 1, 0, wallTop, st, tint, dirt, 0, ovr, cr, !!(streetEdges && streetEdges[i] && !cuts.length));
      }
      // ---- toit
      const x = {};
      const DM = CFG.dormers;
      const faceFn = () => { // front layer of a dormer
        if (style === 'timber' && cls.district === 'petiteFrance' && R() < S.slats) return newLayer('dormerSlat');
        return R() < DM.lit ? newLayer('dormerLit') : newLayer('dormerDark');
      };
      if (shape === 'gabled' && ob) {
        if (style === 'timber') x.gm = gable;
        const lim = S && S.dormerRows;
        if (lim && rh > 3) {
          const cap = Math.max(lim[0], Math.min(lim[1], Math.floor((rh - 1.6) / 2.4)));
          const rows = style === 'timber' ? cap : lim[0] + Math.floor(R() * (cap - lim[0] + 1));
          x.dm = { rows, step: S.dormerStep || 2.6, shrink: S.dormerShrink || 0.82, shed: style === 'timber', maxN: DM.maxPerRoof, face: faceFn };
        }
      } else if (shape === 'mansard_ring' && style === 'classical') {
        x.mansardD = mD;
        x.dmM = { maxN: DM.maxPerRoof, streetEdges, bay, uoff: L.uoff, w: DM.mansardW, face: faceFn, tint: tmp.copy(tint).multiplyScalar(dirt).clone() };
      }
      if (style === 'civic' && shape === 'gabled' && R() < S.steppedGable) x.stepped = true;
      if (shape === 'gabled' && style === 'timber') x.barge = true;
      roof(pts, wallTop, shape, rh, ob, st, tint, dirt, roofCol, tags, x);
      if (style === 'neustadt' && streetEdges && nUp + 1 >= S.turret.minLevels) turrets(pts, streetEdges, wallTop, st, tint, dirt, roofCol, S.turret, R);
      return { wallTop, roofTop: wallTop + rh, style };
    },

    // Partie de bâtiment en 3D (OSM building:part) : murs de min_height à height, toit selon roof:shape
    // opts.keepEdge(ax, az, bx, bz) : garder ce mur ? (murs intérieurs de la cathédrale masqués)
    // opts.cutsOf(i) : ouvertures dans le mur i (portail) ; opts.skipRoof : pas de toit (sous la voûte intérieure)
    part(pts, tags, opts = {}) {
      const height = num(tags.height), minH = num(tags.min_height) || 0;
      if (height == null || height - minH < 0.4) return;
      const ob = obb(pts);
      const shape = tags['roof:shape'] || 'flat';
      let rh = num(tags['roof:height']);
      if (rh == null) rh = shape === 'flat' ? 0 : shape === 'pyramidal' || shape === 'dome' || shape === 'cone' ? Math.min(height - minH, ob ? ob.hw * 2 : 3) : ob ? Math.min(height - minH, ob.hw * 1.2) : 2;
      rh = Math.min(rh, height - minH);
      const wallTop = height - rh;
      const m = tags['building:material'] || '';
      const style = m.includes('stone') ? 'gothic' : m === 'glass' ? 'modern' : m === 'timber_framing' ? 'timber' : 'plaster';
      const uoff = rnd();
      const st = { main: style === 'gothic' ? floodlit() : matFor(style, 0), shop: null, gf: null, gal: null, galY: Infinity, W: WIN_LEGACY[style] || null, fh: FLOOR_H, bay: BAY_W, uoff, variant: 0, scale: style === 'gothic' ? 2.4 : 1 };
      const tint = new THREE.Color(PALETTES[style][0]);
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
        // keepEdge : false = mur masqué, true = mur entier, nombre = mur seulement au-dessus de cette hauteur
        const keep = opts.keepEdge ? opts.keepEdge(ax, az, bx, bz, wallTop) : true;
        if (keep === false) continue;
        const lo = typeof keep === 'number' ? Math.max(minH, keep) : minH;
        if (lo >= wallTop) continue;
        const cuts = opts.cutsOf ? opts.cutsOf(ax, az, bx, bz) : [];
        let t = 0;
        for (const [t0, t1] of cuts) { if (t0 > t) wall(ax, az, bx, bz, t, t0, lo, wallTop, st, tint, 1, minH); wall(ax, az, bx, bz, t0, t1, Math.max(lo, opts.portalH || 8), wallTop, st, tint, 1, minH); t = t1; }
        if (t < 1) wall(ax, az, bx, bz, t, 1, lo, wallTop, st, tint, 1, minH);
      }
      if (opts.skipRoof) return;
      const roofCol = roofColorLegacy(tags, roofKind(tags));
      if (rh < 0.2) { flat(pts, wallTop, roofCol); return; }
      // les petits toits à deux pans très étroits deviennent des pyramides (pinacles)
      roof(pts, wallTop, ob && ob.hl < 1.5 && shape === 'gabled' ? 'pyramidal' : shape, rh, ob, st, tint, 1, roofCol, tags, {});
    },

    relief, // relief des façades (relief.js) : portée réglée par la qualité, mis à jour par le monde

    // What a streamed instance needs from this (core) one: the finished wall material, its layer -> array slice map and the layers it holds. Null before finish().
    streamKit: () => kit,

    // STREAMED instance only: turns the buildings built since the last flush into the tile's meshes (not added to any scene) and empties the builders.
    // Returns { walls, roof, proxy: { pos, idx }, digest: { verts, tris, sum } } ; a mesh is null when the tile has no such geometry. The depth parity of the
    // tile (see finish) keeps two neighbouring tiles from fighting for a pixel. The caller owns the meshes (dispose their geometry when the tile goes away).
    // flushTileSteps is the same as a generator that yields between its heavy steps (the streamer runs it in time slices); flushTile runs it to the end.
    *flushTileSteps(ix, iz) {
      const out = { walls: null, roof: null, proxy: { pos: null, idx: null }, digest: { verts: 0, tris: 0, sum: 0 } };
      const parts = [];
      const mk = (b, mat, name, walls) => {
        if (!b.pos.length) return null;
        const n = b.pos.length / 3, par = walls ? (ix + iz) & 1 : (ix & 1) | ((iz & 1) << 1), fac = new Uint8Array(n * 2);
        for (let v = 0; v < n; v++) { fac[v * 2] = walls ? stream.slot.get(b.fac[v * 2]) ?? 0 : 0; fac[v * 2 + 1] = b.fac[v * 2 + 1] + par; }
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(b.pos);
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
        g.setAttribute('aFac', new THREE.BufferAttribute(fac, 2));
        const idx = n > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx);
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeBoundingSphere(); g.computeBoundingBox();
        const m = new THREE.Mesh(g, mat);
        gpuOnly(m);
        m.name = name; m.castShadow = false; m.receiveShadow = true;
        let s = 0; for (let i = 0; i < pos.length; i++) s += pos[i];
        out.digest.verts += n; out.digest.tris += idx.length / 3; out.digest.sum += s;
        parts.push({ pos: new Float32Array(pos), idx }); // (the proxy gets its own copy: the mesh arrays are dropped after their upload)
        return m;
      };
      out.walls = mk(wallB, stream.wallMat, 'tile:walls', true);
      yield;
      out.roof = mk(roofB, roofMat, 'tile:roof', false);
      for (const b of [roofB, wallB]) { b.pos = []; b.nor = []; b.uv = []; b.col = []; b.fac = []; b.idx = []; }
      yield;
      let np = 0, ni = 0; for (const q of parts) { np += q.pos.length; ni += q.idx.length; }
      const pp = new Float32Array(np), pi = new Uint32Array(ni); np = 0; ni = 0;
      for (const q of parts) { for (let i = 0; i < q.idx.length; i++) pi[ni + i] = q.idx[i] + np / 3; pp.set(q.pos, np); np += q.pos.length; ni += q.idx.length; }
      out.proxy.pos = pp; out.proxy.idx = pi;
      return out;
    },
    flushTile(ix, iz) { const g = this.flushTileSteps(ix, iz); let r; while (!(r = g.next()).done); return r.value; },

    // Construit les maillages (un par tuile : murs en tableau de textures, toits) et les ajoute à la scène
    finish(scene, area = 'island') {
      const T = CONFIG.graphics.cityTile; // tile size (m): with the texture array a tile is one wall mesh + one roof mesh
      // layers really used -> array slices
      const used = new Set();
      for (let i = 0; i < wallB.fac.length; i += 2) used.add(wallB.fac[i]);
      const { mat: wallMat, slot } = atlas.build(used);
      kit = { wallMat, roofMat, slot, layers: new Map([...used].map((id) => { const L = atlas.byId(id); return [L.key, { id, rank: L.rank }]; })) };
      const proxyTiles = new Map();
      const toMesh = (b, mat, name) => {
        if (!b.pos.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
        g.setAttribute('aFac', new THREE.Uint8BufferAttribute(b.fac, 2));
        g.setIndex(b.idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        gpuOnly(m);
        m.name = name;
        m.castShadow = false; m.receiveShadow = true; // the tile's shadow is cast by its merged proxy (shadowProxy.js): one draw call instead of one per material
        scene.add(m);
        if (area === 'island') detailCull.addMesh(m); // hidden beyond the fog distance (the station keeps its own LOD)
        const pk = `${b.ix},${b.iz}`; // (b = a split tile)
        (proxyTiles.get(pk) || proxyTiles.set(pk, proxyBucket()).get(pk)).add(b.pos, b.idx);
        return m;
      };
      // Découpe en tuiles (T) : la caméra ne dessine que les morceaux de ville devant elle et à portée du brouillard.
      // Deux triangles coplanaires dans deux tuiles voisines (bâtiments OSM aux emprises qui se chevauchent : toits, façades) se disputaient le
      // pixel : chaque tuile ajoute au rang de profondeur de ses sommets un petit décalage propre à sa parité, donc deux tuiles voisines ne rendent
      // jamais à la même profondeur (v0.35.2). Murs : 2 rangs (un demi-pas entre deux calques), toits : 4 rangs (aussi en diagonale).
      const split = (b, walls) => {
        const tiles = new Map();
        const P = b.pos, N = b.nor, U = b.uv, C = b.col, F = b.fac, I = b.idx;
        for (let i = 0; i < I.length; i += 3) {
          const a = I[i], bb = I[i + 1], c = I[i + 2];
          const cx = (P[a * 3] + P[bb * 3] + P[c * 3]) / 3, cz = (P[a * 3 + 2] + P[bb * 3 + 2] + P[c * 3 + 2]) / 3;
          const ix = Math.floor(cx / T), iz = Math.floor(cz / T), k = ix * 4096 + iz;
          let t = tiles.get(k);
          if (!t) { t = { pos: [], nor: [], uv: [], col: [], fac: [], idx: [], map: new Map(), ix, iz }; tiles.set(k, t); }
          const par = walls ? (ix + iz) & 1 : (ix & 1) | ((iz & 1) << 1);
          for (const v of [a, bb, c]) {
            let j = t.map.get(v);
            if (j === undefined) {
              j = t.pos.length / 3; t.map.set(v, j);
              t.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); t.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
              t.uv.push(U[v * 2], U[v * 2 + 1]); t.col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
              t.fac.push(walls ? slot.get(F[v * 2]) : 0, F[v * 2 + 1] + par);
            }
            t.idx.push(j);
          }
        }
        return [...tiles.values()];
      };
      for (const t of split(wallB, true)) toMesh(t, wallMat, 'arch:walls');
      for (const t of split(roofB, false)) toMesh(t, roofMat, 'arch:roof');
      for (const pb of proxyTiles.values()) addShadowProxy(scene, pb.pos, pb.idx, area);
      relief.finish(scene);
      for (const b of [roofB, wallB]) { b.pos = []; b.nor = []; b.uv = []; b.col = []; b.fac = []; b.idx = []; } // the builders are no longer needed: free the build-time arrays (tens of MB)
    },
  };
}

function pointIn(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
