import { PX, CW, CH, GH, box, poly, line, noise, glass, grime, drawStreak, SHUTTERS } from './facadeDraw.js';

// Facade layer painters: the 19 legacy layers (unchanged, they consume the world rnd) and the new Strasbourg styles (local prng).
// ------------------------------------------------------------------ Styles de façade (2 travées x 2 étages)
export function drawPlaster(ctx, plasterImg, rnd, variant) {
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
    grime(ctx, 'plaster', variant, c, r, ox, oy, wx, wy, ww, wh);
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

export function drawTimber(ctx, plasterImg, rnd, variant) {
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
    grime(ctx, 'timber', variant, c, r, ox, oy, wx, wy, ww, wh);
    if (rnd() < 0.45) { // jardinière
      box(ctx, wx - 6, wy + wh - 4, ww + 12, 16, '#5a3a22');
      for (let k = 0; k < 7; k++) { ctx.map.fillStyle = rnd() < 0.7 ? '#d0202a' : '#f07a2a'; ctx.map.beginPath(); ctx.map.arc(wx + (ww * (k + 0.5)) / 7, wy + wh - 8 - rnd() * 8, 6 + rnd() * 3, 0, 7); ctx.map.fill(); }
    }
  }
}

export function drawSandstone(ctx, plasterImg, rnd, variant, gothic = false) {
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
      grime(ctx, 'sandstone', variant, c, r, ox, oy, wx, wy, ww, wh);
      if (rnd() < 0.35) { // balcon en fer forgé
        box(ctx, wx - 22, wy + wh - 4, ww + 44, 8, '#2a2a2a', '#d0d0d0');
        for (let x = wx - 20; x < wx + ww + 22; x += 9) box(ctx, x, wy + wh - 40, 3, 38, '#262626', '#c0c0c0');
        box(ctx, wx - 22, wy + wh - 42, ww + 44, 5, '#2a2a2a', '#d0d0d0');
      }
    }
    box(ctx, ox, oy + CH - 12, CW, 12, gothic ? '#94594a' : '#cf9c84', '#c8c8c8'); // cordon
  }
}

export function drawModern(ctx, plasterImg, rnd) {
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
export const SHOPS = [
  ['WINSTUB', '#7a1f24'], ['BOULANGERIE', '#6a4a1f'], ['PHARMACIE', '#1f5a3a'], ['BRETZELS', '#7a4a1f'], ['CAFÉ', '#2a3a5a'],
  ['LIBRAIRIE', '#3a2a4a'], ['BRASSERIE', '#5a2a1a'], ['FROMAGERIE', '#4a4a1f'], ['CHOCOLATS', '#3a2214'], ['ÉPICERIE', '#2a4a2a'],
  ['TABAC', '#6a1a1a'], ['OPTICIEN', '#1f3a5a'], ['FLEURISTE', '#2a5a3a'], ['SOUVENIRS', '#5a3a1a'],
];
export function drawShop(ctx, plasterImg, rnd, variant, forced = null) { // forced: [[name, colour], [name, colour]] (the new signs) instead of the random draw
  const W = CW * 2, H = GH;
  box(ctx, 0, 0, W, H, '#b9a58c', '#8a8a8a');
  ctx.map.globalAlpha = 0.35; ctx.map.drawImage(plasterImg, 0, 0, W, H); ctx.map.globalAlpha = 1;
  for (let c = 0; c < 2; c++) {
    const ox = c * CW, sx = ox + 0.35 * PX, sw = CW - 0.7 * PX, sy = 1.05 * PX, sh = 2.75 * PX;
    const [name, col] = forced ? forced[c] : SHOPS[Math.floor(rnd() * SHOPS.length)];
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

export function drawDormer(ctx, plasterImg, rnd) {
  const W = 256, H = 256;
  box(ctx, 0, 0, W, H, '#d9cfbd', '#909090');
  box(ctx, 50, 40, 156, 180, '#e2d9c6', '#d0d0d0');
  glass(ctx, 64, 54, 128, 150, rnd() < 0.3, rnd, [2, 2]);
}

// =====================================================================
//  New layers (v0.91.0, step C): a generic painter of "2 bays x 2 floors" cells driven by a style description, so every Strasbourg style
//  (timber houses, classical hotels, civic sandstone, Neustadt blocks, modern strips, rustic ground floors) is a few numbers.
//  All of them use a LOCAL prng (never the world `rnd`): the world stream is replayed by architecture.js legacyDraws.
//  Canvas conventions: 768 wide = 2 bays, 640 high = 2 floors (ground-floor layers: 768 x 403 = one 4.2 m ground floor); y = 0 is the top.
// =====================================================================
const E = '#e0e0e0'; // bump value of a raised element

function plasterBg(ctx, img, W, H) {
  for (let i = 0; i < 4; i++) ctx.map.drawImage(img, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2);
}
function stoneBg(ctx, img, R, W, H, base, course, joint = 'rgba(60,25,18,0.45)') {
  box(ctx, 0, 0, W, H, base, '#8a8a8a');
  ctx.map.globalAlpha = 0.25; for (let i = 0; i < 4; i++) ctx.map.drawImage(img, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2); ctx.map.globalAlpha = 1;
  for (let y = 0, k = 0; y < H; y += course, k++) {
    box(ctx, 0, y, W, 2, joint, '#606060');
    for (let x = (k % 2) * 0.45 * 96; x < W; x += 0.9 * 96) box(ctx, x, y, 2, course, joint, '#686868');
    ctx.map.fillStyle = `rgba(${R() < 0.5 ? '255,220,200' : '60,20,10'},0.06)`; ctx.map.fillRect(0, y, W, course);
  }
  noise(ctx, 0, 0, W, H, 500, 0.06, R);
}

// rain streaks under a window and a damp patch, local prng
function grimeN(ctx, R, wx, wy, ww, wh, bottom) {
  const n = 2 + Math.floor(R() * 3), sill = wy + wh + 10;
  for (let i = 0; i < n; i++) drawStreak(ctx, wx - 6 + R() * (ww + 12), sill, Math.min(sill + (0.5 + R() * 1.3) * 96, bottom), (0.04 + R() * 0.07) * 96, 0.16 + R() * 0.18);
  const x = wx + R() * ww, y = wy + R() * wh * 2, rad = (0.5 + R() * 1.1) * 96, g = ctx.map.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, `rgba(48,36,26,${0.05 + R() * 0.07})`); g.addColorStop(1, 'rgba(40,30,20,0)');
  ctx.map.fillStyle = g; ctx.map.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

// brace pattern inside a timber panel (a, y0)-(b, y1)
function braces(ctx, a, y0, b, y1, beam, kind, bw) {
  if (b - a < 14 || y1 - y0 < 8) return;
  if (kind === 0) { line(ctx, a, y0, b, y1, bw, beam, E); line(ctx, b, y0, a, y1, bw, beam, E); } // Saint-Andrew cross
  else if (kind === 1) { const my = (y0 + y1) / 2; box(ctx, a, my - bw / 2, b - a, bw, beam, E); line(ctx, a, y1, b, my, bw, beam, E); line(ctx, a, y0, b, my, bw, beam, E); } // K ("Mann") brace
  else { const mx = (a + b) / 2, my = (y0 + y1) / 2; for (const [p, q] of [[[mx, y0], [b, my]], [[b, my], [mx, y1]], [[mx, y1], [a, my]], [[a, my], [mx, y0]]]) line(ctx, p[0], p[1], q[0], q[1], bw * 0.85, beam, E); } // lozenge
}

// Generic cell painter. o: { bay, floorH, bg: 'plaster' | 'stone', stone, course, timber: { beam, kind }, win: { n, w, h, b, frame, lintel, panes, shutters, arch, sill },
// string (colour of a string course under every floor), balcony, box (flower box chance), lit }
function cells(ctx, img, R, o) {
  const W = 768, H = 640, sx = W / (2 * o.bay), sy = H / (2 * o.floorH), cw = o.bay * sx, ch = o.floorH * sy, w = o.win;
  if (o.bg === 'stone') stoneBg(ctx, img, R, W, H, o.stone, o.course || 0.42 * 96); else plasterBg(ctx, img, W, H);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const ox = c * cw, oy = r * ch, ww = w.w * sx, wh = w.h * sy, wy = oy + ch - w.b * sy - wh, wins = [];
    for (let k = 0; k < w.n; k++) wins.push({ x: ox + (cw * (k + 0.5)) / w.n - ww / 2, y: wy, w: ww, h: wh });
    if (o.timber) {
      const bw = 0.15 * sx, bh = 0.15 * sy, beam = o.timber.beam;
      box(ctx, ox, oy, cw, bh, beam, E); box(ctx, ox, oy + ch - bh * 1.5, cw, bh * 1.5, beam, E); box(ctx, ox, oy, bw, ch, beam, E);
      wins.forEach((q, k) => {
        box(ctx, q.x - bw * 1.5, oy, bw, ch, beam, E); box(ctx, q.x + q.w + bw * 0.5, oy, bw, ch, beam, E);
        box(ctx, q.x - bw * 0.7, q.y - bh, q.w + bw * 1.4, bh, beam, E); box(ctx, q.x - bw * 0.7, q.y + q.h, q.w + bw * 1.4, bh, beam, E);
        const kind = (o.timber.kind + r + c + k) % 3 === 0 ? o.timber.kind : o.timber.kind; // one pattern per layer
        braces(ctx, q.x - bw * 0.7, q.y + q.h + bh, q.x + q.w + bw * 0.7, oy + ch - bh * 1.5, beam, kind, bw * 0.8);
        if (k === 0 && w.n > 1) braces(ctx, q.x + q.w + bw * 1.5, oy + bh, ox + cw * 0.5 - bw * 0.5, oy + ch - bh * 1.5, beam, (kind + 1) % 3, bw * 0.8);
      });
      if (w.n > 1) box(ctx, ox + cw * 0.5 - bw / 2, oy, bw, ch, beam, E);
    }
    for (const q of wins) {
      const fr = w.frame, fw = (w.fw || 0.13) * sx;
      if (fr) {
        if (w.arch) { // arched surround
          const pts = [[q.x - fw, q.y + q.h + 4], [q.x - fw, q.y + q.w * 0.6]]; for (let a = 0; a <= 16; a++) { const t = a / 16; pts.push([q.x - fw + (q.w + 2 * fw) * t, q.y + q.w * 0.6 - Math.sin(t * Math.PI) * (q.w * 0.6 + fw)]); } pts.push([q.x + q.w + fw, q.y + q.h + 4]);
          poly(ctx, pts, fr, '#d0d0d0');
        } else {
          box(ctx, q.x - fw, q.y - fw * 1.1, q.w + 2 * fw, q.h + fw * 2.1, fr, '#d0d0d0');
          if (w.lintel === 'seg') { // segmental lintel + keystone
            poly(ctx, [[q.x - fw * 1.5, q.y - fw], [q.x + q.w / 2, q.y - fw * 3.2], [q.x + q.w + fw * 1.5, q.y - fw]], fr, '#e0e0e0');
            box(ctx, q.x + q.w / 2 - 0.07 * sx, q.y - fw * 3.4, 0.14 * sx, fw * 3, fr, E);
          } else if (w.lintel === 'pedim') poly(ctx, [[q.x - fw * 2, q.y - fw], [q.x + q.w / 2, q.y - fw * 4.2], [q.x + q.w + fw * 2, q.y - fw]], fr, '#e0e0e0');
          else box(ctx, q.x - fw * 1.6, q.y - fw * 2.1, q.w + fw * 3.2, fw * 0.9, fr, '#e0e0e0');
        }
      }
      glass(ctx, q.x, q.y, q.w, q.h, R() < (o.lit ?? 0.2), R, w.panes || [2, 3], !!w.arch);
      if (fr) box(ctx, q.x - fw * 1.4, q.y + q.h + 2, q.w + fw * 2.8, Math.max(5, 0.08 * sy), w.sill || fr, '#e8e8e8'); // sill
      grimeN(ctx, R, q.x, q.y, q.w, q.h, oy + ch);
      if (w.shutters && R() < 0.8) {
        const sh = SHUTTERS[Math.floor(R() * SHUTTERS.length)], sw = q.w / 2 - 3;
        for (const s of [q.x - sw - 8, q.x + q.w + 8]) { box(ctx, s, q.y - 3, sw, q.h + 6, sh, '#d0d0d0'); for (let y = q.y; y < q.y + q.h; y += 8) box(ctx, s, y, sw, 2, 'rgba(0,0,0,0.28)', '#909090'); }
      }
      if (R() < (o.box ?? 0.3)) { // flower box
        box(ctx, q.x - 5, q.y + q.h - 6, q.w + 10, 16, '#5a3a22', '#c0c0c0');
        for (let k = 0; k < 7; k++) { ctx.map.fillStyle = R() < 0.7 ? '#c8202a' : '#e85a8a'; ctx.map.beginPath(); ctx.map.arc(q.x + (q.w * (k + 0.5)) / 7, q.y + q.h - 10 - R() * 8, 5 + R() * 3, 0, 7); ctx.map.fill(); }
      }
      if (o.balcony && r === 0 && R() < o.balcony) { // wrought-iron balconette
        box(ctx, q.x - 14, q.y + q.h - 4, q.w + 28, 7, '#2a2a2a', '#d0d0d0');
        for (let x = q.x - 12; x < q.x + q.w + 14; x += 9) box(ctx, x, q.y + q.h - 0.5 * sy, 3, 0.5 * sy - 2, '#262626', '#c0c0c0');
        box(ctx, q.x - 14, q.y + q.h - 0.5 * sy - 3, q.w + 28, 5, '#2a2a2a', '#d0d0d0');
      }
    }
    if (o.string) box(ctx, ox, oy + ch - 9, cw, 9, o.string, '#c0c0c0'); // string course at the floor line
  }
}

// ---- ground-floor layers (768 x 403: one 4.2 m ground floor, repeated every 2 bays)
// Rusticated ground floor (classical / neustadt): deep horizontal joints, a window at the height the relief frame expects
function drawRustic(ctx, img, R, o) {
  const W = 768, H = 403, sx = W / (2 * o.bay), sy = H / 4.2;
  stoneBg(ctx, img, R, W, H, o.stone, 0.62 * 96, 'rgba(40,16,10,0.55)');
  for (let c = 0; c < 2; c++) {
    const cw = o.bay * sx, ox = c * cw, ww = o.win.w * sx, wh = o.win.h * sy, wx = ox + (cw - ww) / 2, wy = H - o.win.gb * sy - wh;
    box(ctx, wx - 0.14 * sx, wy - 0.16 * sy, ww + 0.28 * sx, wh + 0.2 * sy, o.stone, '#d8d8d8');
    glass(ctx, wx, wy, ww, wh, R() < 0.25, R, [2, 3], false);
    box(ctx, wx - 0.2 * sx, wy + wh, ww + 0.4 * sx, 8, '#d6b8a0', '#e8e8e8');
    grimeN(ctx, R, wx, wy, ww, wh, H);
    box(ctx, ox, 0, 6, H, 'rgba(40,16,10,0.4)', '#707070'); // pier joint
  }
}
// Civic arcade: round-arched bays with dark openings
function drawArcade(ctx, img, R) {
  const W = 768, H = 403, bay = 4.5, sx = W / (2 * bay), sy = H / 4.2;
  stoneBg(ctx, img, R, W, H, '#c48a72', 0.62 * 96);
  for (let c = 0; c < 2; c++) {
    const ox = c * bay * sx, ww = 2.4 * sx, wx = ox + (bay * sx - ww) / 2, top = 0.55 * sy, bot = H - 0.1 * sy, g = ctx.map.createLinearGradient(0, top, 0, bot);
    const pts = [[wx, bot], [wx, top + ww / 2]]; for (let a = 0; a <= 20; a++) { const t = a / 20; pts.push([wx + ww * t, top + ww / 2 - Math.sin(t * Math.PI) * ww / 2]); } pts.push([wx + ww, bot]);
    box(ctx, wx - 0.2 * sx, top - 0.2 * sy, ww + 0.4 * sx, bot - top + 0.2 * sy, '#d6a48c', '#d8d8d8'); // surround
    g.addColorStop(0, '#2b2018'); g.addColorStop(1, '#0e0a08'); poly(ctx, pts, g, '#202020');
    const warm = R() < 0.3; if (warm) poly(ctx, pts, 'rgba(255,200,120,0.5)', null, '#7a5428');
    box(ctx, wx + ww / 2 - 3, top + ww / 2, 6, bot - top - ww / 2, '#8a6a58', '#b0b0b0');
  }
}
// Carriage door (porte cochère): a single 3.4 m x 4.2 m painted door, uv 0..1 (not repeated)
function drawCarriage(ctx, img, R) {
  const W = 768, H = 403, sx = W / 3.4, sy = H / 4.2;
  stoneBg(ctx, img, R, W, H, '#c9a48c', 0.5 * 96);
  const dw = 2.5 * sx, dx = (W - dw) / 2, top = 0.35 * sy, g = ctx.map.createLinearGradient(0, top, 0, H);
  const pts = [[dx, H], [dx, top + dw / 2]]; for (let a = 0; a <= 24; a++) { const t = a / 24; pts.push([dx + dw * t, top + dw / 2 - Math.sin(t * Math.PI) * dw / 2]); } pts.push([dx + dw, H]);
  box(ctx, dx - 0.25 * sx, top - 0.25 * sy, dw + 0.5 * sx, H - top + 0.25 * sy, '#dcb89c', '#e0e0e0'); // stone surround
  g.addColorStop(0, '#3b2a1f'); g.addColorStop(1, '#2a1c14'); poly(ctx, pts, g, '#b0b0b0');
  for (let x = dx + 6; x < dx + dw - 4; x += 0.28 * sx) box(ctx, x, top + dw / 2 - 2, 2, H - top - dw / 2, 'rgba(0,0,0,0.35)', '#707070'); // planks
  box(ctx, dx + dw / 2 - 3, top, 6, H - top, '#1a120c', '#909090'); // meeting stile
  for (const y of [H * 0.35, H * 0.7]) box(ctx, dx, y, dw, 8, '#1c1c1c', '#d0d0d0'); // iron straps
  box(ctx, dx + dw / 2 - 0.5 * sx, H * 0.55, 10, 10, '#8a7a50', '#f0f0f0'); box(ctx, dx + dw / 2 + 0.5 * sx - 10, H * 0.55, 10, 10, '#8a7a50', '#f0f0f0'); // ring handles
  box(ctx, dx + dw / 2 - 0.3 * sx, top - 0.05 * sy, 0.6 * sx, 0.3 * sy, '#cfa68c', '#f0f0f0'); // keystone
}
// Modern strip windows
function drawModernStrip(ctx, img, R) {
  const W = 768, H = 640, sy = H / 6;
  box(ctx, 0, 0, W, H, '#c4c2bd', '#8a8a8a'); ctx.map.globalAlpha = 0.3; ctx.map.drawImage(img, 0, 0, W, H); ctx.map.globalAlpha = 1;
  for (let r = 0; r < 2; r++) {
    const oy = r * H / 2, wy = oy + 0.5 * sy, wh = 1.6 * sy;
    box(ctx, 0, wy - 8, W, wh + 16, '#5a5d61', '#d0d0d0');
    for (let x = 0; x < W; x += W / 5) {
      const lit = R() < 0.28, ww = W / 5 - 8;
      if (lit) box(ctx, x + 4, wy, ww, wh, '#f2f4ff', '#202020', '#e8eeff'); else glass(ctx, x + 4, wy, ww, wh, false, R, [2, 1]);
    }
    box(ctx, 0, oy + H / 2 - 8, W, 8, 'rgba(60,60,60,0.5)', '#a0a0a0');
  }
}
// Open drying loft of the old tanners: dark slats, black gaps, oak posts
function drawGallery(ctx, img, R) {
  const W = 768, H = 640, sx = 96;
  plasterBg(ctx, img, W, H); box(ctx, 0, 0, W, H, 'rgba(70,50,32,0.88)', '#707070');
  for (let r = 0; r < 2; r++) {
    const oy = r * H / 2, ch = H / 2;
    for (let x = 0; x < W; x += 0.2 * sx) { box(ctx, x, oy + 0.2 * 112, 0.11 * sx, ch - 0.45 * 112, '#6a4a30', '#c8c8c8'); box(ctx, x + 0.11 * sx, oy + 0.2 * 112, 0.09 * sx, ch - 0.45 * 112, '#120c08', '#303030'); }
    for (let x = 0; x < W; x += 1.4 * sx) box(ctx, x, oy, 0.17 * sx, ch, '#4a2a20', E);
    box(ctx, 0, oy, W, 0.22 * 112, '#4a2a20', E); box(ctx, 0, oy + ch - 0.3 * 112, W, 0.3 * 112, '#3e2a1e', E);
  }
  noise(ctx, 0, 0, W, H, 400, 0.08, R);
}
// Gable triangle: attic windows, two levels of 2.2 m per tile, half-timbered
function drawGable(ctx, img, R) {
  cells(ctx, img, R, { bay: 3.4, floorH: 2.2, bg: 'plaster', timber: { beam: '#4a2a20', kind: 0 }, win: { n: 2, w: 0.55, h: 0.8, b: 0.6, frame: '#6a4a30', fw: 0.08, panes: [1, 2] }, lit: 0.18, box: 0.1 });
}
// Glazed / lit / slatted dormer fronts (256 x 256)
function drawDormerN(ctx, img, R, kind) {
  const W = 256, H = 256;
  box(ctx, 0, 0, W, H, '#d9cfbd', '#909090');
  box(ctx, 40, 36, 176, 190, kind === 'slat' ? '#5a3a24' : '#e2d9c6', '#d0d0d0');
  if (kind === 'slat') { for (let x = 50; x < 206; x += 14) { box(ctx, x, 46, 8, 170, '#6a4a30', '#c8c8c8'); box(ctx, x + 8, 46, 6, 170, '#0e0a06', '#303030'); } box(ctx, 40, 36, 176, 12, '#3e2a1e', E); }
  else glass(ctx, 64, 54, 128, 150, kind === 'lit', R, [2, 2]);
}

const TIMBER_RENDER = { bay: 4, floorH: 2.85, bg: 'plaster', win: { n: 2, w: 0.75, h: 1.1, b: 1.0, frame: '#6a4a30', fw: 0.07, panes: [2, 2], shutters: true }, box: 0.35, lit: 0.22 };
// key -> { rank (depth step, see facadeAtlas), W, H, draw(ctx, img, R) }  (ranks continue the legacy table: walls first, then shop fronts, then details)
export const NEW_LAYERS = {
  // private copies of the legacy plaster / modern painters (local prng): the legacy layers are only drawn by the rnd replay, where the world stream is consumed
  'plasterP:0': { rank: 1, W: 768, H: 624, draw: (c, i, R, i2) => drawPlaster(c, i, R, 0) },
  'plasterP:1': { rank: 2, W: 768, H: 624, draw: (c, i, R, i2) => drawPlaster(c, i, R, 1) },
  'plasterP:2': { rank: 3, W: 768, H: 624, draw: (c, i, R, i2) => drawPlaster(c, i2, R, 2) },
  'plasterP:3': { rank: 4, W: 768, H: 624, draw: (c, i, R, i2) => drawPlaster(c, i2, R, 3) },
  modernP: { rank: 11, W: 768, H: 624, draw: (c, i, R) => drawModern(c, i, R) },
  'timberN:0': { rank: 24, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { ...TIMBER_RENDER, timber: { beam: '#4a2a20', kind: 0 } }) },
  'timberN:1': { rank: 25, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { ...TIMBER_RENDER, timber: { beam: '#3e2a1e', kind: 1 } }) },
  'timberN:2': { rank: 26, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { ...TIMBER_RENDER, timber: { beam: '#4a4038', kind: 2 } }) },
  gable: { rank: 27, W: 768, H: 640, draw: drawGable },
  gallery: { rank: 28, W: 768, H: 640, draw: drawGallery },
  'classical:0': { rank: 29, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { bay: 3.2, floorH: 3.5, bg: 'plaster', string: '#d8c4a4', balcony: 0.6, box: 0.12, win: { n: 1, w: 1.3, h: 2.4, b: 0.55, frame: '#dccfb4', lintel: 'seg', panes: [2, 4], shutters: false } }) },
  'classical:1': { rank: 30, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { bay: 3.2, floorH: 3.5, bg: 'stone', stone: '#c8967e', string: '#ddb89e', balcony: 0.6, box: 0.1, win: { n: 1, w: 1.3, h: 2.4, b: 0.55, frame: '#e0bca4', lintel: 'seg', panes: [2, 4] } }) },
  civic: { rank: 31, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { bay: 4.5, floorH: 4.2, bg: 'stone', stone: '#bd7a66', string: '#d8a890', box: 0, lit: 0.25, win: { n: 1, w: 1.6, h: 3.0, b: 0.7, frame: '#d6a48c', fw: 0.18, arch: true, panes: [2, 4] } }) },
  'neustadt:0': { rank: 32, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { bay: 3.6, floorH: 3.6, bg: 'stone', stone: '#b4a888', string: '#c9bea0', box: 0.08, win: { n: 1, w: 1.3, h: 2.2, b: 0.7, frame: '#cfc4a6', lintel: 'pedim', panes: [2, 3] } }) },
  'neustadt:1': { rank: 33, W: 768, H: 640, draw: (c, i, R) => cells(c, i, R, { bay: 3.6, floorH: 3.6, bg: 'stone', stone: '#b9806c', string: '#d2a28c', box: 0.08, win: { n: 1, w: 1.3, h: 2.2, b: 0.7, frame: '#dcb49c', lintel: 'flat', panes: [2, 3] } }) },
  'rustic:classical': { rank: 34, W: 768, H: 403, draw: (c, i, R) => drawRustic(c, i, R, { bay: 3.2, stone: '#c4a088', win: { w: 1.3, h: 2.4, gb: 1.25 } }) },
  'rustic:neustadt': { rank: 35, W: 768, H: 403, draw: (c, i, R) => drawRustic(c, i, R, { bay: 3.6, stone: '#b6aa8c', win: { w: 1.3, h: 2.2, gb: 1.3 } }) },
  'rustic:timber': { rank: 46, W: 768, H: 403, draw: (c, i, R) => drawRustic(c, i, R, { bay: 4, stone: '#c4a070', win: { w: 1.1, h: 1.5, gb: 1.0 } }) },
  arcade: { rank: 36, W: 768, H: 403, draw: drawArcade },
  carriage: { rank: 37, W: 768, H: 403, draw: drawCarriage },
  modernStrip: { rank: 38, W: 768, H: 640, draw: drawModernStrip },
  'dormerSlat': { rank: 39, W: 256, H: 256, draw: (c, i, R) => drawDormerN(c, i, R, 'slat') },
  'dormerLit': { rank: 40, W: 256, H: 256, draw: (c, i, R) => drawDormerN(c, i, R, 'lit') },
  'dormerDark': { rank: 41, W: 256, H: 256, draw: (c, i, R) => drawDormerN(c, i, R, 'dark') },
  'shopN:0': { rank: 42, W: 768, H: 403, draw: (c, i, R) => drawShop(c, i, R, 3, [['KOUGELHOPF', '#6a3a1f'], ['CHARCUTERIE', '#7a1f24']]) },
  'shopN:1': { rank: 43, W: 768, H: 403, draw: (c, i, R) => drawShop(c, i, R, 0, [['TAVERNE', '#3a2a14'], ['HORLOGERIE', '#1f3a5a']]) },
  'shopN:2': { rank: 44, W: 768, H: 403, draw: (c, i, R) => drawShop(c, i, R, 1, [['CHARCUTERIE', '#5a2a1a'], ['KOUGELHOPF', '#7a4a1f']]) },
  'shopN:3': { rank: 45, W: 768, H: 403, draw: (c, i, R) => drawShop(c, i, R, 3, [['HORLOGERIE', '#2a3a5a'], ['TAVERNE', '#7a1f24']]) },
};
