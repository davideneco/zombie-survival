import * as THREE from 'three';

// =====================================================================
//  Architecture strasbourgeoise : façades dessinées (crépi + grès, colombages, grès rose,
//  gothique, moderne, boutiques), toits pentus avec lucarnes, et bâtiments en 3D
//  détaillé (building:part d'OpenStreetMap : cathédrale, églises).
// =====================================================================

export const FLOOR_H = 3.25; // hauteur d'un étage (m)
export const BAY_W = 4;      // largeur d'une travée de fenêtre (m)
export const GF_H = 4.2;     // rez-de-chaussée (plus haut que les étages)
const PX = 96;               // pixels par mètre dans les textures de façade
const CW = BAY_W * PX, CH = Math.round(FLOOR_H * PX); // une cellule = 1 travée x 1 étage
const GH = Math.round(GF_H * PX);

// ------------------------------------------------------------------ Dessin
// Les trois canevas (couleur, relief, lumière) sont dessinés en même temps avec les mêmes coordonnées.
function texSet(W, H, draw) {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cMap = mk(W, H), cBump = mk(W / 2, H / 2), cEmis = mk(W / 4, H / 4);
  const ctx = { map: cMap.getContext('2d'), bump: cBump.getContext('2d'), emis: cEmis.getContext('2d') };
  ctx.bump.scale(0.5, 0.5); ctx.emis.scale(0.25, 0.25);
  ctx.bump.fillStyle = '#808080'; ctx.bump.fillRect(0, 0, W, H);
  ctx.emis.fillStyle = '#000'; ctx.emis.fillRect(0, 0, W, H);
  draw(ctx);
  return { cMap, cBump, cEmis };
}
// remplit un rectangle sur chaque canevas pour lequel une couleur est donnée
function box(ctx, x, y, w, h, map, bump, emis) {
  if (map) { ctx.map.fillStyle = map; ctx.map.fillRect(x, y, w, h); }
  if (bump) { ctx.bump.fillStyle = bump; ctx.bump.fillRect(x, y, w, h); }
  if (emis) { ctx.emis.fillStyle = emis; ctx.emis.fillRect(x, y, w, h); }
}
function poly(ctx, pts, map, bump, emis) {
  for (const [k, col] of [['map', map], ['bump', bump], ['emis', emis]]) {
    if (!col) continue;
    const c = ctx[k];
    c.fillStyle = col; c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath(); c.fill();
  }
}
function line(ctx, x0, y0, x1, y1, w, map, bump) {
  for (const [k, col] of [['map', map], ['bump', bump]]) {
    if (!col) continue;
    const c = ctx[k];
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
}
function noise(ctx, x, y, w, h, n, alpha, rnd) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.map.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.map.fillRect(x + rnd() * w, y + rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
  }
}

// Vitre (éteinte ou allumée), petits bois, reflet
function glass(ctx, x, y, w, h, lit, rnd, panes = [2, 3], arch = false) {
  const shape = arch
    ? (() => { const pts = [[x, y + h], [x, y + w * 0.6]]; for (let a = 0; a <= 16; a++) { const t = a / 16; pts.push([x + w * t, y + w * 0.6 - Math.sin(t * Math.PI) * w * 0.6]); } pts.push([x + w, y + h]); return pts; })()
    : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  if (lit) {
    const warm = ['#ffd38a', '#ffc46b', '#ffe2b0', '#ffcf7a'][Math.floor(rnd() * 4)];
    poly(ctx, shape, warm, '#202020', warm);
    // rideaux
    ctx.map.fillStyle = 'rgba(160,90,40,0.35)'; ctx.map.fillRect(x, y, w * 0.22, h); ctx.map.fillRect(x + w * 0.78, y, w * 0.22, h);
  } else {
    const g = ctx.map.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#2b3b50'); g.addColorStop(0.55, '#141c27'); g.addColorStop(1, '#0a0e14');
    poly(ctx, shape, g, '#202020');
    ctx.map.fillStyle = 'rgba(160,190,230,0.10)';
    ctx.map.beginPath(); ctx.map.moveTo(x, y + h * 0.6); ctx.map.lineTo(x + w, y + h * 0.15); ctx.map.lineTo(x + w, y + h * 0.35); ctx.map.lineTo(x, y + h * 0.85); ctx.map.fill();
  }
  // petits bois
  const [nx, ny] = panes, bar = Math.max(3, w * 0.035);
  for (let i = 1; i < nx; i++) box(ctx, x + (w * i) / nx - bar / 2, y, bar, h, '#e4ddcf', '#b0b0b0', lit ? '#3a2a10' : null);
  for (let j = 1; j < ny; j++) box(ctx, x, y + (h * j) / ny - bar / 2, w, bar, '#e4ddcf', '#b0b0b0', lit ? '#3a2a10' : null);
}

const SHUTTERS = ['#3f5a45', '#7a3b2e', '#54616b', '#2f4a6b', '#6b5a2f', '#5a3a4a'];

// ------------------------------------------------------------------ Styles de façade (2 travées x 2 étages)
function drawPlaster(ctx, plasterImg, rnd, variant) {
  const W = CW * 2, H = CH * 2;
  for (let i = 0; i < 4; i++) ctx.map.drawImage(plasterImg, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2);
  ctx.bump.filter = 'grayscale(1) contrast(0.5)'; ctx.bump.globalAlpha = 0.8;
  for (let i = 0; i < 4; i++) ctx.bump.drawImage(plasterImg, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2);
  ctx.bump.filter = 'none'; ctx.bump.globalAlpha = 1;
  const frameCol = variant % 2 ? '#c99a84' : '#e2d9c6'; // encadrement en grès rose ou en pierre claire
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const ox = c * CW, oy = r * CH;
    // bandeau d'étage
    box(ctx, ox, oy + CH - 10, CW, 10, 'rgba(60,45,35,0.28)', '#a8a8a8');
    const ww = 1.25 * PX, wh = 1.85 * PX, wx = ox + (CW - ww) / 2, wy = oy + 0.55 * PX;
    box(ctx, wx - 13, wy - 16, ww + 26, wh + 30, frameCol, '#d0d0d0');
    box(ctx, wx - 20, wy - 22, ww + 40, 10, frameCol, '#e0e0e0'); // linteau mouluré
    const lit = rnd() < 0.2;
    glass(ctx, wx, wy, ww, wh, lit, rnd, [2, 3]);
    box(ctx, wx - 18, wy + wh + 10, ww + 36, 9, '#b8ad9b', '#e8e8e8'); // appui
    const sh = variant >= 2 ? null : SHUTTERS[Math.floor(rnd() * SHUTTERS.length)];
    if (sh && rnd() < 0.85) {
      const closed = rnd() < 0.25;
      const sw = closed ? ww / 2 : ww / 2 - 4;
      for (const sx of closed ? [wx, wx + ww / 2] : [wx - sw - 14, wx + ww + 14]) {
        box(ctx, sx, wy - 4, sw, wh + 8, sh, '#d0d0d0');
        for (let y = wy; y < wy + wh; y += 8) box(ctx, sx, y, sw, 2, 'rgba(0,0,0,0.28)', '#909090');
      }
    }
    if (rnd() < 0.3) { // jardinière de géraniums
      box(ctx, wx - 6, wy + wh - 6, ww + 12, 18, '#5a3a22', '#c0c0c0');
      for (let k = 0; k < 9; k++) {
        const fx = wx + (ww * (k + 0.5)) / 9, fy = wy + wh - 10 - rnd() * 10;
        ctx.map.fillStyle = rnd() < 0.7 ? '#c8202a' : '#e85a8a'; ctx.map.beginPath(); ctx.map.arc(fx, fy, 6 + rnd() * 4, 0, 7); ctx.map.fill();
        ctx.map.fillStyle = '#2f5a24'; ctx.map.fillRect(fx - 5, fy + 4, 10, 6);
      }
    }
  }
}

function drawTimber(ctx, plasterImg, rnd, variant) {
  const W = CW * 2, H = CH * 2;
  for (let i = 0; i < 4; i++) ctx.map.drawImage(plasterImg, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2);
  const beam = ['#6a4128', '#5a3620', '#7a5032'][variant % 3]; // chêne brun (pas noir)
  const bw = 0.16 * PX;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const ox = c * CW, oy = r * CH;
    const ww = 1.1 * PX, wh = 1.35 * PX, wx = ox + (CW - ww) / 2, wy = oy + 0.75 * PX;
    // sablière et poteaux
    box(ctx, ox, oy, CW, bw, beam, '#e0e0e0'); box(ctx, ox, oy + CH - bw * 0.8, CW, bw * 0.8, beam, '#e0e0e0');
    box(ctx, ox, oy, bw, CH, beam, '#e0e0e0');
    box(ctx, wx - bw - 4, oy, bw, CH, beam, '#e0e0e0'); box(ctx, wx + ww + 4, oy, bw, CH, beam, '#e0e0e0');
    box(ctx, wx - 4, wy - bw, ww + 8, bw, beam, '#e0e0e0'); box(ctx, wx - 4, wy + wh, ww + 8, bw, beam, '#e0e0e0');
    // décharges : croix de Saint-André, ou "homme" (K)
    const panels = [[ox + bw, wx - bw - 4], [wx + ww + 4 + bw, ox + CW]];
    for (const [a, b] of panels) {
      if (b - a < 20) continue;
      const kind = (variant + r + c) % 3;
      if (kind === 0) { line(ctx, a, oy + bw, b, oy + CH - bw, bw * 0.8, beam, '#e0e0e0'); line(ctx, b, oy + bw, a, oy + CH - bw, bw * 0.8, beam, '#e0e0e0'); }
      else if (kind === 1) { line(ctx, a, oy + CH * 0.5, b, oy + bw, bw * 0.8, beam, '#e0e0e0'); line(ctx, a, oy + CH * 0.5, b, oy + CH - bw, bw * 0.8, beam, '#e0e0e0'); }
      else { box(ctx, a, oy + CH * 0.5 - bw / 2, b - a, bw, beam, '#e0e0e0'); line(ctx, a, oy + CH - bw, b, oy + CH * 0.5, bw * 0.8, beam, '#e0e0e0'); }
    }
    glass(ctx, wx, wy, ww, wh, rnd() < 0.3, rnd, [2, 3]);
    if (rnd() < 0.45) { // jardinière
      box(ctx, wx - 6, wy + wh - 4, ww + 12, 16, '#5a3a22');
      for (let k = 0; k < 7; k++) { ctx.map.fillStyle = rnd() < 0.7 ? '#d0202a' : '#f07a2a'; ctx.map.beginPath(); ctx.map.arc(wx + (ww * (k + 0.5)) / 7, wy + wh - 8 - rnd() * 8, 6 + rnd() * 3, 0, 7); ctx.map.fill(); }
    }
  }
}

function drawSandstone(ctx, plasterImg, rnd, variant, gothic = false) {
  const W = CW * 2, H = CH * 2;
  const base = gothic ? '#a76a57' : ['#b8735f', '#c48a72', '#a9604f'][variant % 3];
  box(ctx, 0, 0, W, H, base, '#8a8a8a');
  ctx.map.globalAlpha = 0.25; for (let i = 0; i < 4; i++) ctx.map.drawImage(plasterImg, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2); ctx.map.globalAlpha = 1;
  // assises de pierre de taille
  const course = 0.42 * PX;
  for (let y = 0, k = 0; y < H; y += course, k++) {
    box(ctx, 0, y, W, 2, 'rgba(60,25,18,0.45)', '#606060');
    for (let x = (k % 2) * 0.45 * PX; x < W; x += 0.9 * PX) box(ctx, x, y, 2, course, 'rgba(60,25,18,0.35)', '#686868');
    ctx.map.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,200' : '60,20,10'},0.06)`; ctx.map.fillRect(0, y, W, course);
  }
  noise(ctx, 0, 0, W, H, 600, 0.06, rnd);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const ox = c * CW, oy = r * CH;
    if (gothic) {
      const ww = 1.3 * PX, wh = 2.6 * PX, wx = ox + (CW - ww) / 2, wy = oy + 0.3 * PX;
      // ébrasement et lancette avec remplage
      poly(ctx, [[wx - 14, wy + wh + 6], [wx - 14, wy + ww * 0.6], ...Array.from({ length: 17 }, (_, a) => [wx - 14 + (ww + 28) * a / 16, wy + ww * 0.6 - 14 - Math.sin(a / 16 * Math.PI) * (ww * 0.6 + 6)]), [wx + ww + 14, wy + wh + 6]], '#8e5545', '#505050');
      const lit = rnd() < 0.35;
      glass(ctx, wx, wy, ww, wh, false, rnd, [2, 4], true);
      if (lit) poly(ctx, [[wx + 8, wy + wh], [wx + 8, wy + ww * 0.65], [wx + ww / 2, wy + 6], [wx + ww - 8, wy + ww * 0.65], [wx + ww - 8, wy + wh]], null, null, rnd() < 0.5 ? '#6a3a9a' : '#3a5aa8');
      box(ctx, wx + ww / 2 - 3, wy + ww * 0.5, 6, wh - ww * 0.5, '#9a6050', '#b0b0b0');
    } else {
      const ww = 1.3 * PX, wh = 2.05 * PX, wx = ox + (CW - ww) / 2, wy = oy + 0.5 * PX;
      box(ctx, wx - 16, wy - 18, ww + 32, wh + 28, '#d6a48c', '#d8d8d8'); // encadrement mouluré clair
      box(ctx, wx - 26, wy - 30, ww + 52, 14, '#d6a48c', '#e8e8e8');    // corniche de fenêtre
      glass(ctx, wx, wy, ww, wh, rnd() < 0.3, rnd, [2, 3]);
      if (rnd() < 0.35) { // balcon en fer forgé
        box(ctx, wx - 22, wy + wh - 4, ww + 44, 8, '#2a2a2a', '#d0d0d0');
        for (let x = wx - 20; x < wx + ww + 22; x += 9) box(ctx, x, wy + wh - 40, 3, 38, '#262626', '#c0c0c0');
        box(ctx, wx - 22, wy + wh - 42, ww + 44, 5, '#2a2a2a', '#d0d0d0');
      }
    }
    box(ctx, ox, oy + CH - 12, CW, 12, gothic ? '#94594a' : '#cf9c84', '#c8c8c8'); // cordon
  }
}

function drawModern(ctx, plasterImg, rnd) {
  const W = CW * 2, H = CH * 2;
  box(ctx, 0, 0, W, H, '#c9c7c2', '#8a8a8a');
  ctx.map.globalAlpha = 0.3; ctx.map.drawImage(plasterImg, 0, 0, W, H); ctx.map.globalAlpha = 1;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const ox = c * CW, oy = r * CH, ww = 3.1 * PX, wh = 1.9 * PX, wx = ox + (CW - ww) / 2, wy = oy + 0.55 * PX;
    box(ctx, wx - 6, wy - 6, ww + 12, wh + 12, '#5a5d61', '#d0d0d0');
    const lit = rnd() < 0.3;
    if (lit) box(ctx, wx, wy, ww, wh, '#f2f4ff', '#202020', '#e8eeff');
    else glass(ctx, wx, wy, ww, wh, false, rnd, [3, 1]);
  }
}

// Rez-de-chaussée commerçant : vitrine éclairée sous une enseigne, ou rideau métallique tagué
const SHOPS = [
  ['WINSTUB', '#7a1f24'], ['BOULANGERIE', '#6a4a1f'], ['PHARMACIE', '#1f5a3a'], ['BRETZELS', '#7a4a1f'], ['CAFÉ', '#2a3a5a'],
  ['LIBRAIRIE', '#3a2a4a'], ['BRASSERIE', '#5a2a1a'], ['FROMAGERIE', '#4a4a1f'], ['CHOCOLATS', '#3a2214'], ['ÉPICERIE', '#2a4a2a'],
  ['TABAC', '#6a1a1a'], ['OPTICIEN', '#1f3a5a'], ['FLEURISTE', '#2a5a3a'], ['SOUVENIRS', '#5a3a1a'],
];
function drawShop(ctx, plasterImg, rnd, variant) {
  const W = CW * 2, H = GH;
  box(ctx, 0, 0, W, H, '#b9a58c', '#8a8a8a');
  ctx.map.globalAlpha = 0.35; ctx.map.drawImage(plasterImg, 0, 0, W, H); ctx.map.globalAlpha = 1;
  for (let c = 0; c < 2; c++) {
    const ox = c * CW, sx = ox + 0.35 * PX, sw = CW - 0.7 * PX, sy = 1.05 * PX, sh = 2.75 * PX;
    const [name, col] = SHOPS[Math.floor(rnd() * SHOPS.length)];
    box(ctx, ox, 0, 0.35 * PX, H, '#a68d72', '#c0c0c0'); // trumeau en pierre
    // enseigne : bandeau coloré, lettres claires (éclairées si la boutique est ouverte)
    const closed = variant % 3 === 2 || (variant % 3 === 1 && c === 1);
    box(ctx, sx, 0.2 * PX, sw, 0.6 * PX, col, '#a0a0a0');
    box(ctx, sx, 0.2 * PX, sw, 4, '#d8c090', '#c0c0c0'); box(ctx, sx, 0.8 * PX - 4, sw, 4, '#d8c090', '#c0c0c0');
    for (const k of ['map', 'emis']) {
      if (k === 'emis' && closed) continue;
      const g2 = ctx[k];
      g2.fillStyle = k === 'map' ? '#f6e6c0' : '#c8a060';
      g2.font = `bold ${Math.round(0.36 * PX)}px Georgia, serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillText(name, sx + sw / 2, 0.52 * PX, sw - 16);
    }
    if (name === 'PHARMACIE') { // croix verte lumineuse
      const cx = ox + CW - 0.25 * PX, cy = 0.5 * PX, a = 0.12 * PX;
      box(ctx, cx - a, cy - a * 3, a * 2, a * 6, '#20e060', null, '#20ff60'); box(ctx, cx - a * 3, cy - a, a * 6, a * 2, '#20e060', null, '#20ff60');
    }
    if (closed) {
      box(ctx, sx, sy, sw, sh, '#7d8186', '#c0c0c0');
      for (let y = sy; y < sy + sh; y += 10) box(ctx, sx, y, sw, 3, 'rgba(0,0,0,0.25)', '#808080');
      const tags = ['#d02a6a', '#2ad06a', '#2a8ad0', '#e0c020', '#ffffff'];
      for (let t = 0; t < 3; t++) { ctx.map.strokeStyle = tags[Math.floor(rnd() * tags.length)]; ctx.map.lineWidth = 5 + rnd() * 5; ctx.map.beginPath(); let x = sx + rnd() * sw * 0.7, y = sy + sh * (0.35 + rnd() * 0.45); ctx.map.moveTo(x, y); for (let q = 0; q < 6; q++) { x += (rnd() - 0.2) * 40; y += (rnd() - 0.5) * 30; ctx.map.lineTo(x, y); } ctx.map.stroke(); }
    } else {
      // intérieur éclairé (dégradé chaud), silhouettes de présentoirs, reflets
      const warm = ['#ffe3b0', '#ffd79a', '#fff1d6'][Math.floor(rnd() * 3)];
      for (const k of ['map', 'emis']) {
        const g2 = ctx[k], gr = g2.createLinearGradient(0, sy, 0, sy + sh);
        gr.addColorStop(0, k === 'map' ? warm : '#ffd9a0'); gr.addColorStop(1, k === 'map' ? '#b07a40' : '#6a4420');
        g2.fillStyle = gr; g2.fillRect(sx, sy, sw, sh);
      }
      ctx.bump.fillStyle = '#202020'; ctx.bump.fillRect(sx, sy, sw, sh);
      for (let k = 0; k < 3; k++) { // présentoirs
        const px = sx + 18 + (k * (sw - 36)) / 3 + rnd() * 10, pw = (sw - 60) / 3.4, ph = sh * (0.25 + rnd() * 0.25);
        box(ctx, px, sy + sh - ph, pw, ph, 'rgba(70,40,20,0.75)', null, '#3a2410');
        box(ctx, px, sy + sh - ph, pw, 6, 'rgba(255,240,200,0.6)', null, '#a08050');
      }
      ctx.map.fillStyle = 'rgba(255,255,255,0.12)'; ctx.map.beginPath(); ctx.map.moveTo(sx, sy + sh * 0.7); ctx.map.lineTo(sx + sw * 0.5, sy); ctx.map.lineTo(sx + sw * 0.62, sy); ctx.map.lineTo(sx + sw * 0.12, sy + sh); ctx.map.lineTo(sx, sy + sh); ctx.map.fill();
      box(ctx, sx + sw * 0.62, sy, 5, sh, '#2a2a2a', '#b0b0b0', '#1a1408'); // porte vitrée
    }
    box(ctx, sx - 4, sy - 4, sw + 8, 6, '#3a2c20', '#d0d0d0'); box(ctx, sx - 4, sy + sh, sw + 8, 8, '#8a7a66', '#d0d0d0');
  }
}

function drawDormer(ctx, plasterImg, rnd) {
  const W = 256, H = 256;
  box(ctx, 0, 0, W, H, '#d9cfbd', '#909090');
  box(ctx, 50, 40, 156, 180, '#e2d9c6', '#d0d0d0');
  glass(ctx, 64, 54, 128, 150, rnd() < 0.3, rnd, [2, 2]);
}

// ------------------------------------------------------------------ Matériaux
function material(renderer, set, repeatSafe = true, params = {}) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return new THREE.MeshStandardMaterial({
    map: mk(set.cMap, true), bumpMap: mk(set.cBump, false), bumpScale: 2.2,
    emissiveMap: mk(set.cEmis, true), emissive: 0xffe2b8, emissiveIntensity: 0.55,
    roughness: 0.9, vertexColors: true, side: THREE.DoubleSide, ...params,
  });
}

// Palettes de teintes (multipliées par la texture)
const PALETTES = {
  plaster: ['#f3e7cf', '#ecd2a8', '#e3b4a2', '#d3dde0', '#f0d2d2', '#dde4c8', '#d8c2a2', '#f0e2b2', '#cf9580', '#e8e2d6', '#c8d7c0', '#e8c890'],
  timber: ['#f2e8d4', '#efdcb4', '#ecd0c4', '#e4e8d0', '#f4ecd8', '#e8d0a0'],
  sandstone: ['#ffffff', '#f4e8e4', '#ead8d0'],
  gothic: ['#ffffff'],
  modern: ['#ffffff', '#e8eaee', '#f2eee6'],
  shop: ['#ffffff', '#f0e8e0', '#e8e0d0'],
};
const ROOF_TINTS = { tiles: ['#b8644a', '#a85a40', '#8f4e3a', '#c07050', '#9a5a48'], slate: ['#5a5d66', '#4a4e57'], copper: ['#5f7a68'], stone: ['#b07a68'], metal: ['#6a6e74'] };

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

// ------------------------------------------------------------------ Constructeur
export function createArchitecture({ renderer, plasterImg, roofP, rnd }) {
  // styles : [nom, nombre de variantes, fonction de dessin]
  const STYLES = { plaster: [4, drawPlaster], timber: [3, drawTimber], sandstone: [3, drawSandstone], gothic: [1, (c, i, r, v) => drawSandstone(c, i, r, v, true)], modern: [1, drawModern] };
  const mats = {}; // "style:variante" -> { mat, bucket }
  const bucket = () => ({ pos: [], nor: [], uv: [], col: [], idx: [] });
  // Rang fixe de chaque matériau (style + variante) : deux faces coplanaires de deux matériaux (bâtiments aux emprises qui se chevauchent dans
  // OSM, bandeaux de devanture contre un mur…) se disputaient le même pixel (z-fighting). Chaque matériau reçoit un décalage de profondeur
  // propre (polygonOffset, 1 unité par rang) : le plus grand rang gagne toujours, sans scintillement (tools/stuck-scan.mjs, étape zfight).
  const RANK = { plaster: 0, timber: 4, sandstone: 7, modern: 10, gothic: 11, shop: 12, dormer: 18, flood: 22 };
  // (2 unités par rang : l'intervalle intermédiaire sert à départager deux tuiles de 160 m, voir finish)
  const rankMat = (mat, style, variant) => { const r = (RANK[style] ?? 0) + variant + 1; mat.polygonOffset = true; mat.polygonOffsetFactor = -r; mat.polygonOffsetUnits = -2 * r; return mat; };
  const matFor = (style, variant) => {
    const key = `${style}:${variant}`;
    if (!mats[key]) {
      let set;
      if (style === 'shop') set = texSet(CW * 2, GH, (ctx) => drawShop(ctx, plasterImg, rnd, variant));
      else if (style === 'dormer') set = texSet(256, 256, (ctx) => drawDormer(ctx, plasterImg, rnd));
      else set = texSet(CW * 2, CH * 2, (ctx) => STYLES[style][1](ctx, plasterImg, rnd, variant));
      mats[key] = { mat: rankMat(material(renderer, set), style, variant), b: bucket() };
    }
    return mats[key];
  };
  // Monuments éclairés la nuit (cathédrale) : le grès lui-même émet une lumière chaude
  let floodMat = null;
  const floodlit = () => {
    if (!floodMat) {
      const base = matFor('gothic', 0);
      const mat = base.mat.clone();
      mat.emissiveMap = base.mat.map;
      mat.emissive = new THREE.Color(0xe8b48c);
      mat.emissiveIntensity = 0.24;
      rankMat(mat, 'flood', 0);
      floodMat = { mat, b: bucket() };
      mats['gothic:flood'] = floodMat;
    }
    return floodMat;
  };
  // toits : tuiles PBR teintées par sommet
  const roofMat = new THREE.MeshStandardMaterial({ map: roofP.map, normalMap: roofP.normalMap, roughnessMap: roofP.roughnessMap, vertexColors: true, side: THREE.DoubleSide });
  const roofB = bucket();
  const tmp = new THREE.Color();

  const quad = (b, p0, p1, p2, p3, uv, c0, c1) => {
    const base = b.pos.length / 3;
    b.pos.push(...p0, ...p1, ...p2, ...p3);
    // normale de la face
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2], fx = p3[0] - p0[0], fy = p3[1] - p0[1], fz = p3[2] - p0[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 4; k++) b.nor.push(nx / l, ny / l, nz / l);
    b.uv.push(...uv);
    for (const c of [c0, c0, c1, c1]) b.col.push(c.r, c.g, c.b);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (b, p0, p1, p2, uv, c) => {
    const base = b.pos.length / 3;
    b.pos.push(...p0, ...p1, ...p2);
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2], fx = p2[0] - p0[0], fy = p2[1] - p0[1], fz = p2[2] - p0[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (let k = 0; k < 3; k++) b.nor.push(nx / l, ny / l, nz / l);
    b.uv.push(...uv);
    for (let k = 0; k < 3; k++) b.col.push(c.r, c.g, c.b);
    b.idx.push(base, base + 1, base + 2);
  };

  // Mur vertical de a à b (tranche [t0, t1] du segment, hauteurs y0..y1), découpé au niveau du rez-de-chaussée
  function wall(ax, az, bx, bz, t0, t1, y0, y1, st, tint, dirt, base = 0) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05 || y1 - y0 < 0.02) return;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
    const sc = st.scale || 1; // monuments : motifs plus grands
    // vu de la rue, la droite du spectateur va de b vers a : u croît dans ce sens (sinon les enseignes sont en miroir)
    const u0 = st.uoff - (len * t0) / (BAY_W * 2 * sc), u1 = st.uoff - (len * t1) / (BAY_W * 2 * sc);
    const col = (y) => tmp.copy(tint).multiplyScalar(dirt * (y - base < 3 ? 0.6 + 0.4 * ((y - base) / 3) : 1)).clone();
    const piece = (ya, yb, m, vmap) => {
      if (yb - ya < 0.02) return;
      quad(m.b, [x0, ya, z0], [x1, ya, z1], [x1, yb, z1], [x0, yb, z0], [u0, vmap(ya), u1, vmap(ya), u1, vmap(yb), u0, vmap(yb)], col(ya), col(yb));
    };
    const gf = base + GF_H;
    if (st.shop && y0 < gf && base === 0) {
      piece(y0, Math.min(y1, gf), st.shop, (y) => y / GF_H);
      piece(Math.max(y0, gf), y1, st.main, (y) => (y - gf) / (FLOOR_H * 2 * sc));
    } else {
      piece(y0, y1, st.main, (y) => (y - gf) / (FLOOR_H * 2 * sc));
    }
  }

  // ---------- toits
  function roofColor(tags, kind) {
    const c = tags && tags['roof:colour'];
    if (c && /^#|^[a-z]+$/i.test(c)) { try { return new THREE.Color(c === 'black' ? '#3a3a3e' : c === 'white' ? '#cfcfcf' : c); } catch { /* couleur inconnue */ } }
    const pal = ROOF_TINTS[kind] || ROOF_TINTS.tiles;
    return new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
  }
  function roofKind(tags) {
    const m = (tags && (tags['roof:material'] || '')) || '';
    if (m === 'copper') return 'copper';
    if (m === 'slate') return 'slate';
    if (m === 'metal' || m === 'glass' || m === 'concrete') return 'metal';
    if (m === 'stone' || ((tags && tags['building:material']) || '').includes('stone')) return 'stone';
    return 'tiles';
  }

  // Toit à deux pans (pignons) : le polygone est coupé le long du faîtage, hauteurs linéaires de chaque côté
  function gabled(pts, top, rh, ob, st, tint, dirt, roofCol, across, dormers) {
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
          tri(roofB, v3[0], v3[1], v3[2], uv, roofCol);
        }
      } catch { /* polygone dégénéré */ }
    }
    // pignons : on comble entre l'égout et le toit au-dessus de chaque façade
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ta = tOf(a), tb = tOf(b);
      const segs = (ta > 0) !== (tb > 0) && ta !== 0 && tb !== 0 ? (() => { const t = ta / (ta - tb); const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; return [[a, m], [m, b]]; })() : [[a, b]];
      for (const [p, q] of segs) {
        const hp = hOf(p), hq = hOf(q);
        if (hp - top < 0.05 && hq - top < 0.05) continue;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const u0 = st.uoff, u1 = st.uoff - len / (BAY_W * 2), gf = GF_H;
        const v = (y) => (y - gf) / (FLOOR_H * 2);
        quad(st.main.b, [p[0], top, p[1]], [q[0], top, q[1]], [q[0], hq, q[1]], [p[0], hp, p[1]], [u0, v(top), u1, v(top), u1, v(hq), u0, v(hp)], tmp.copy(tint).multiplyScalar(dirt).clone(), tmp.copy(tint).multiplyScalar(dirt).clone());
      }
    }
    // lucarnes sur les grands pans
    if (dormers && rh > 3.5 && hl > 3.5) {
      const dm = matFor('dormer', 0);
      const n = Math.floor((hl * 2 - 2) / 3.2);
      for (const side of [1, -1]) {
        for (let k = 0; k < n; k++) {
          if (rnd() < 0.35) continue;
          const s = -hl + 1.8 + k * 3.2 + 1.2;
          const tpos = side * hw * 0.55; // à mi-pente
          const cx = ob.cx + ux * s + vx * tpos, cz = ob.cz + uz * s + vz * tpos;
          if (!pointIn(pts, cx, cz)) continue;
          const y0 = top + rh * (1 - 0.55), dw = 0.7, dh = 1.4, dd = 1.1;
          // façade de la lucarne (orientée vers l'extérieur du pan)
          const ox = vx * side, oz = vz * side;
          const fx = cx + ox * dd * 0.5, fz = cz + oz * dd * 0.5;
          const lx = ux * dw, lz = uz * dw;
          quad(dm.b, [fx - lx, y0, fz - lz], [fx + lx, y0, fz + lz], [fx + lx, y0 + dh, fz + lz], [fx - lx, y0 + dh, fz - lz], [0, 0, 1, 0, 1, 1, 0, 1], tint, tint);
          // petit toit à deux pans de la lucarne
          const bx = cx - ox * dd, bz = cz - oz * dd, ry = y0 + dh + 0.6;
          tri(roofB, [fx - lx, y0 + dh, fz - lz], [fx, ry, fz], [bx, ry, bz], [0, 0, 0.5, 0.5, 0, 1], roofCol);
          tri(roofB, [fx - lx, y0 + dh, fz - lz], [bx, ry, bz], [bx - lx, y0 + dh, bz - lz], [0, 0, 0, 1, 1, 1], roofCol);
          tri(roofB, [fx + lx, y0 + dh, fz + lz], [bx, ry, bz], [fx, ry, fz], [0, 0, 0.5, 0.5, 0, 1], roofCol);
          tri(roofB, [fx + lx, y0 + dh, fz + lz], [bx + lx, y0 + dh, bz + lz], [bx, ry, bz], [0, 0, 0, 1, 1, 1], roofCol);
          // joues latérales
          quad(st.main.b, [fx - lx, y0, fz - lz], [fx - lx, y0 + dh, fz - lz], [bx - lx, y0 + dh, bz - lz], [bx - lx, y0, bz - lz], [0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0], tint, tint);
          quad(st.main.b, [fx + lx, y0, fz + lz], [bx + lx, y0, bz + lz], [bx + lx, y0 + dh, bz + lz], [fx + lx, y0 + dh, fz + lz], [0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0], tint, tint);
        }
      }
    }
  }

  // Toit à la Mansart pour les grands bâtiments : pente raide sur le pourtour, terrasse au centre
  function mansard(pts, top, rh, roofCol) {
    const d = Math.min(2.4, rh * 0.6);
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
      quad(roofB, [a[0], top, a[1]], [b[0], top, b[1]], [ib[0], top + rh, ib[1]], [ia[0], top + rh, ia[1]], [0, 0, len / 3, 0, len / 3, rh / 2.5, 0, rh / 2.5], roofCol, roofCol);
    }
    flat(polyArea(inner) > 1 ? inner : pts, top + rh, roofCol);
  }
  function flat(pts, y, roofCol) {
    try {
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of tris) tri(roofB, [pts[a][0], y, pts[a][1]], [pts[b][0], y, pts[b][1]], [pts[c][0], y, pts[c][1]], [pts[a][0] / 4, pts[a][1] / 4, pts[b][0] / 4, pts[b][1] / 4, pts[c][0] / 4, pts[c][1] / 4], roofCol);
    } catch { /* polygone dégénéré */ }
  }
  function pyramidal(pts, top, rh, roofCol) {
    let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      tri(roofB, [a[0], top, a[1]], [b[0], top, b[1]], [cx, top + rh, cz], [0, 0, len / 3, 0, len / 6, rh / 2.5], roofCol);
    }
  }
  function skillion(pts, top, rh, ob, roofCol, st, tint, dirt) {
    const tOf = ([x, z]) => (x - ob.cx) * ob.vx + (z - ob.cz) * ob.vz;
    const hOf = (p) => top + rh * ((tOf(p) + ob.hw) / (2 * ob.hw));
    try {
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of tris) { const P = [pts[a], pts[b], pts[c]]; tri(roofB, ...P.map((p) => [p[0], hOf(p), p[1]]), P.flatMap((p) => [p[0] / 3, p[1] / 3]), roofCol); }
    } catch { /* polygone dégénéré */ }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], hp = hOf(p), hq = hOf(q);
      if (hp - top < 0.05 && hq - top < 0.05) continue;
      quad(st.main.b, [p[0], top, p[1]], [q[0], top, q[1]], [q[0], hq, q[1]], [p[0], hp, p[1]], [0, 0, 1, 0, 1, 0.3, 0, 0.3], tmp.copy(tint).multiplyScalar(dirt).clone(), tmp.copy(tint).multiplyScalar(dirt).clone());
    }
  }

  function roof(pts, top, shape, rh, ob, st, tint, dirt, roofCol, tags, dormers) {
    if (!ob || rh < 0.2 || shape === 'flat') return flat(pts, top, roofCol);
    if (shape === 'pyramidal' || shape === 'dome' || shape === 'onion' || shape === 'cone') return pyramidal(pts, top, rh, roofCol);
    if (shape === 'skillion') return skillion(pts, top, rh, ob, roofCol, st, tint, dirt);
    if (shape === 'mansard_ring') return mansard(pts, top, rh, roofCol);
    return gabled(pts, top, rh, ob, st, tint, dirt, roofCol, tags && tags['roof:orientation'] === 'across', dormers);
  }

  // ---------- choix du style d'un bâtiment
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  function styleFor(tags, area, levels, inSector) {
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

  // Construit un bâtiment sans rien en garder : tire exactement les mêmes nombres aléatoires (textures, styles, teintes) mais
  // efface la géométrie produite. Sert à retirer un bâtiment du rendu sans décaler la suite du tirage `rnd`, donc sans changer
  // l'aspect des autres façades ni l'emplacement des objets placés ensuite (machines, armes murales…).
  function ghost(fn) {
    const all = () => [roofB, ...Object.values(mats).map((m) => m.b)];
    const before = new Map(all().map((b) => [b, [b.pos.length, b.nor.length, b.uv.length, b.col.length, b.idx.length]]));
    const r = fn();
    for (const b of all()) {
      const [p, n, u, c, i] = before.get(b) || [0, 0, 0, 0, 0];
      b.pos.length = p; b.nor.length = n; b.uv.length = u; b.col.length = c; b.idx.length = i;
    }
    return r;
  }

  return {
    // Bâtiment complet. cutsOf(i) : ouvertures (passages) du mur i. Retourne { wallTop, roofTop }.
    // opts.ghost : le construire « pour rien » (voir ghost)
    building(pts, tags, hGuess, cutsOf, opts = {}) {
      if (opts.ghost) return ghost(() => this.building(pts, tags, hGuess, cutsOf, { ...opts, ghost: false }));
      const area = Math.abs(polyArea(pts));
      const levelsTag = num(tags['building:levels']);
      const levels = levelsTag != null ? Math.max(1, levelsTag) : Math.max(2, Math.round((hGuess - GF_H) / FLOOR_H) + 1);
      const style = opts.style || styleFor(tags, area, levels, opts.inSector);
      const variant = Math.floor(rnd() * STYLES[style][0]);
      const ob = obb(pts);
      // hauteurs
      let wallTop = GF_H + (levels - 1) * FLOOR_H;
      const roofLevels = num(tags['roof:levels']);
      let shape = tags['roof:shape'] || null;
      if (!shape) shape = style === 'modern' ? 'flat' : ob && ob.hw <= 9.5 ? 'gabled' : 'mansard_ring';
      if (['hipped', 'half-hipped', 'gambrel', 'mansard', 'side_hipped', 'quadruple_saltbox', 'saltbox', 'round'].includes(shape)) shape = ob && ob.hw <= 9.5 ? 'gabled' : 'mansard_ring';
      let rh = num(tags['roof:height']);
      if (rh == null) {
        if (shape === 'gabled') rh = ob ? Math.min(11, Math.max(3, ob.hw * (roofLevels ? 1.1 + roofLevels * 0.15 : 1.25))) : 4;
        else if (shape === 'mansard_ring') rh = roofLevels ? roofLevels * 2.8 : 4;
        else if (shape === 'pyramidal') rh = ob ? ob.hw * 1.4 : 4;
        else if (shape === 'skillion') rh = 2.5;
        else rh = 0;
      }
      const height = num(tags.height);
      if (height != null) wallTop = Math.max(3, height - rh);
      if (style === 'gothic' && height == null) wallTop = Math.max(wallTop, 14);
      const shop = opts.shop && style !== 'gothic' && style !== 'modern' && levels >= 2 ? matFor('shop', Math.floor(rnd() * 6) % 3 + 3 * Math.floor(rnd() * 2)) : null;
      const st = { main: matFor(style, variant), shop, uoff: rnd() };
      const pal = PALETTES[style];
      const tint = new THREE.Color(tags['building:colour'] && /^#/.test(tags['building:colour']) ? tags['building:colour'] : pal[Math.floor(rnd() * pal.length)]);
      if (tags['building:colour'] && /^#/.test(tags['building:colour'])) tint.lerp(new THREE.Color('#ffffff'), 0.4);
      const dirt = 0.82 + rnd() * 0.18;
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
        const cuts = cutsOf ? cutsOf(i) : [];
        let t = 0;
        for (const [t0, t1] of cuts) { if (t0 > t) wall(ax, az, bx, bz, t, t0, 0, wallTop, st, tint, dirt); wall(ax, az, bx, bz, t0, t1, opts.passageH || 3.6, wallTop, st, tint, dirt); t = t1; }
        if (t < 1) wall(ax, az, bx, bz, t, 1, 0, wallTop, st, tint, dirt);
      }
      const roofCol = roofColor(tags, roofKind(tags));
      roof(pts, wallTop, shape, rh, ob, st, tint, dirt, roofCol, tags, opts.inSector && shape === 'gabled');
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
      const st = { main: style === 'gothic' ? floodlit() : matFor(style, 0), shop: null, uoff: rnd(), scale: style === 'gothic' ? 2.4 : 1 };
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
      const roofCol = roofColor(tags, roofKind(tags));
      if (rh < 0.2) { flat(pts, wallTop, roofCol); return; }
      // les petits toits à deux pans très étroits deviennent des pyramides (pinacles)
      roof(pts, wallTop, ob && ob.hl < 1.5 && shape === 'gabled' ? 'pyramidal' : shape, rh, ob, st, tint, 1, roofCol, tags, false);
    },

    // Construit les maillages (un par matériau) et les ajoute à la scène
    finish(scene) {
      const toMesh = (b, mat) => {
        if (!b.pos.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
        g.setIndex(b.idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        return m;
      };
      // Découpe en tuiles de 96 m : la caméra ne dessine que les morceaux de ville devant elle et à portée du brouillard
      // (sinon toute la ville, ~600 000 triangles, était dessinée à chaque image).
      const T = 160;
      // Deux triangles coplanaires de même matériau dans deux tuiles voisines (bâtiments OSM aux emprises qui se chevauchent : toits, façades) se
      // disputaient le pixel : chaque tuile a un rang de décalage de profondeur (polygonOffset) propre à sa parité, donc deux tuiles voisines
      // ne rendent jamais à la même profondeur (v0.35.2). Murs : 2 rangs (un demi-pas entre deux matériaux), toits : 4 rangs (aussi en diagonale).
      const variants = new Map();
      const tileMat = (mat, t, levels) => {
        const rk = levels === 4 ? (t.ix & 1) | ((t.iz & 1) << 1) : (t.ix + t.iz) & 1;
        if (!rk) return mat;
        const key = `${rk}`;
        let per = variants.get(mat); if (!per) variants.set(mat, per = {});
        if (!per[key]) {
          const m = mat.clone();
          m.polygonOffset = true;
          m.polygonOffsetFactor = mat.polygonOffsetFactor - 0.5 * rk;
          m.polygonOffsetUnits = mat.polygonOffsetUnits - rk;
          per[key] = m;
        }
        return per[key];
      };
      const split = (b) => {
        const tiles = new Map();
        const P = b.pos, N = b.nor, U = b.uv, C = b.col, I = b.idx;
        for (let i = 0; i < I.length; i += 3) {
          const a = I[i], bb = I[i + 1], c = I[i + 2];
          const cx = (P[a * 3] + P[bb * 3] + P[c * 3]) / 3, cz = (P[a * 3 + 2] + P[bb * 3 + 2] + P[c * 3 + 2]) / 3;
          const k = Math.floor(cx / T) * 4096 + Math.floor(cz / T);
          let t = tiles.get(k);
          if (!t) { t = { pos: [], nor: [], uv: [], col: [], idx: [], map: new Map(), ix: Math.floor(cx / T), iz: Math.floor(cz / T) }; tiles.set(k, t); }
          for (const v of [a, bb, c]) {
            let j = t.map.get(v);
            if (j === undefined) {
              j = t.pos.length / 3; t.map.set(v, j);
              t.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); t.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
              t.uv.push(U[v * 2], U[v * 2 + 1]); t.col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
            }
            t.idx.push(j);
          }
        }
        return [...tiles.values()];
      };
      for (const [key, { mat, b }] of Object.entries(mats)) for (const t of split(b)) { const m = toMesh(t, tileMat(mat, t, 2)); if (m) m.name = 'arch:' + key; }
      for (const t of split(roofB)) { const r = toMesh(t, tileMat(roofMat, t, 4)); if (r) r.name = 'arch:roof'; }
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
