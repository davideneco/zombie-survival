import * as THREE from 'three';

// Shared drawing helpers of the facade textures (moved out of architecture.js): three canvases (colour, bump, emissive) drawn with the same coordinates.
export const FLOOR_H = 3.25; // hauteur d'un étage (m)
export const BAY_W = 4;      // largeur d'une travée de fenêtre (m)
export const GF_H = 4.2;     // rez-de-chaussée (plus haut que les étages)
export const PX = 96;               // pixels par mètre dans les textures de façade
export const CW = BAY_W * PX, CH = Math.round(FLOOR_H * PX); // une cellule = 1 travée x 1 étage
export const GH = Math.round(GF_H * PX);

// ------------------------------------------------------------------ Dessin
// Les quatre canevas (couleur, hauteur/relief, lumière, PBR: R=rugosité V=métal B=micro-AO) sont dessinés ensemble.
export function texSet(W, H, draw) {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cMap = mk(W, H), cBump = mk(W / 2, H / 2), cEmis = mk(W / 4, H / 4), cRough = mk(W / 2, H / 2);
  const ctx = { map: cMap.getContext('2d'), bump: cBump.getContext('2d'), emis: cEmis.getContext('2d'), rough: cRough.getContext('2d') };
  ctx.bump.scale(0.5, 0.5); ctx.emis.scale(0.25, 0.25); ctx.rough.scale(0.5, 0.5);
  ctx.bump.fillStyle = '#808080'; ctx.bump.fillRect(0, 0, W, H);
  ctx.emis.fillStyle = '#000'; ctx.emis.fillRect(0, 0, W, H);
  // Par défaut : pierre / crépi mat (R=222 -> rough ~0.87, G=0 -> metal 0, B=255 -> AO 1.0)
  ctx.rough.fillStyle = 'rgb(222,0,255)'; ctx.rough.fillRect(0, 0, W, H);
  draw(ctx);
  return { cMap, cBump, cEmis, cRough };
}
// remplit un rectangle sur chaque canevas pour lequel une couleur est donnée
export function box(ctx, x, y, w, h, map, bump, emis, rough) {
  if (map) { ctx.map.fillStyle = map; ctx.map.fillRect(x, y, w, h); }
  if (bump) { ctx.bump.fillStyle = bump; ctx.bump.fillRect(x, y, w, h); }
  if (emis) { ctx.emis.fillStyle = emis; ctx.emis.fillRect(x, y, w, h); }
  if (rough && ctx.rough) { ctx.rough.fillStyle = rough; ctx.rough.fillRect(x, y, w, h); }
}
export function poly(ctx, pts, map, bump, emis, rough) {
  for (const [k, col] of [['map', map], ['bump', bump], ['emis', emis], ['rough', rough]]) {
    if (!col || !ctx[k]) continue;
    const c = ctx[k];
    c.fillStyle = col; c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath(); c.fill();
  }
}
export function line(ctx, x0, y0, x1, y1, w, map, bump) {
  for (const [k, col] of [['map', map], ['bump', bump]]) {
    if (!col) continue;
    const c = ctx[k];
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
}
export function noise(ctx, x, y, w, h, n, alpha, rnd) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.map.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.map.fillRect(x + rnd() * w, y + rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
  }
}

// Vitre PBR (éteinte ou allumée) : verre très lisse et réfléchissant (roughness ~0.06), profondeur d'intérieur, embrasure ombrée (AO), petits bois mats
export function glass(ctx, x, y, w, h, lit, rnd, panes = [2, 3], arch = false) {
  const shape = arch
    ? (() => { const pts = [[x, y + h], [x, y + w * 0.6]]; for (let a = 0; a <= 16; a++) { const t = a / 16; pts.push([x + w * t, y + w * 0.6 - Math.sin(t * Math.PI) * w * 0.6]); } pts.push([x + w, y + h]); return pts; })()
    : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  // Ombre d'embrasure (micro-AO) autour de la fenêtre : donne une vraie profondeur au retrait de 15 cm
  if (ctx.rough) {
    ctx.rough.fillStyle = 'rgb(210,0,145)';
    ctx.rough.fillRect(x - 6, y - 6, w + 12, h + 12);
  }
  const glassPbr = 'rgb(15,38,240)'; // R=0.06 (miroir verre), G=0.15 (reflet diélectrique), B=0.94
  const Rl = prng(Math.round(x * 13 + y * 31 + w * 7));
  if (lit) {
    const warm = ['#ffd38a', '#ffc46b', '#ffe2b0', '#ffcf7a'][Math.floor(rnd() * 4)];
    const ig = ctx.map.createLinearGradient(0, y, 0, y + h);
    ig.addColorStop(0, '#c87c32'); ig.addColorStop(0.32, warm); ig.addColorStop(0.82, '#e8a252'); ig.addColorStop(1, '#7a451c');
    poly(ctx, shape, ig, '#1c1c1c', warm, glassPbr);
    // rideaux translucides + plafond d'intérieur
    const cw = w * (0.18 + Rl() * 0.1);
    ctx.map.fillStyle = 'rgba(110,56,22,0.42)';
    ctx.map.fillRect(x, y, cw, h); ctx.map.fillRect(x + w - cw, y, cw, h);
    ctx.map.fillStyle = 'rgba(42,20,8,0.34)';
    ctx.map.fillRect(x, y, w, h * 0.12);
  } else {
    // Profondeur de pièce sombre derrière le verre (plafond, mur du fond, rideau discret)
    const g = ctx.map.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#0f1824'); g.addColorStop(0.45, '#080e16'); g.addColorStop(1, '#04070b');
    poly(ctx, shape, g, '#1c1c1c', null, glassPbr);
    // Silhouette de pièce / rideaux très subtils à travers la vitre
    ctx.map.fillStyle = 'rgba(54,68,86,0.22)';
    const cOff = Rl() * 0.16;
    ctx.map.fillRect(x + w * 0.04, y + h * 0.06, w * (0.18 + cOff), h * 0.88);
    ctx.map.fillRect(x + w * (0.76 - cOff * 0.6), y + h * 0.06, w * 0.2, h * 0.88);
    // Léger reflet diagonal du ciel (complété en temps réel par le PMREM sur roughness=0.06)
    ctx.map.fillStyle = 'rgba(175,205,235,0.12)';
    ctx.map.beginPath(); ctx.map.moveTo(x, y + h * 0.58); ctx.map.lineTo(x + w, y + h * 0.14); ctx.map.lineTo(x + w, y + h * 0.30); ctx.map.lineTo(x, y + h * 0.78); ctx.map.fill();
  }
  // Ombre portée interne sous le linteau et sur les montants (réduit l'effet autocollant plat)
  ctx.map.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.map.fillRect(x, y, w, Math.max(4, h * 0.055));
  ctx.map.fillRect(x, y, Math.max(3, w * 0.04), h);
  // petits bois (bois peint semi-mat, relief marqué)
  const [nx, ny] = panes, bar = Math.max(3, w * 0.036);
  const mullionPbr = 'rgb(168,12,248)';
  for (let i = 1; i < nx; i++) box(ctx, x + (w * i) / nx - bar / 2, y, bar, h, '#dcd4c4', '#c8c8c8', lit ? '#3a2a10' : null, mullionPbr);
  for (let j = 1; j < ny; j++) box(ctx, x, y + (h * j) / ny - bar / 2, w, bar, '#dcd4c4', '#c8c8c8', lit ? '#3a2a10' : null, mullionPbr);
  // Cadre périmétrique fin
  const fr = Math.max(3, w * 0.03);
  box(ctx, x, y, w, fr, '#cfc6b4', '#c4c4c4', null, mullionPbr);
  box(ctx, x, y + h - fr, w, fr, '#bfb5a2', '#c4c4c4', null, mullionPbr);
  box(ctx, x, y, fr, h, '#cbc2b0', '#c4c4c4', null, mullionPbr);
  box(ctx, x + w - fr, y, fr, h, '#cbc2b0', '#c4c4c4', null, mullionPbr);
}

export const SHUTTERS = ['#3f5a45', '#7a3b2e', '#54616b', '#2f4a6b', '#6b5a2f', '#5a3a4a'];

// ------------------------------------------------------------------ Salissures (v0.45.0)
// Coulures sous les appuis, fissures, taches d'humidité : dessinées sur la texture de façade avec un générateur LOCAL par cellule
// (le tirage `rnd` du monde n'est jamais consommé : le décor, les machines et les armes restent exactement où ils étaient).
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const STYLE_SEED = { plaster: 1, timber: 2, sandstone: 3 };
// coulures d'une fenêtre : positions (px), longueurs, largeurs, opacité (déterministes : « départ » sous l'appui et « arrivée » dans la cellule du dessous se raccordent)
function streakSet(style, variant, c, r, wx, ww) {
  const R = prng(STYLE_SEED[style] * 1000 + variant * 37 + c * 11 + r * 5 + 7), n = 2 + Math.floor(R() * 3), out = [];
  for (let i = 0; i < n; i++) out.push({ x: wx - 6 + R() * (ww + 12), len: (0.5 + R() * 1.3) * PX, w: (0.04 + R() * 0.07) * PX, a: 0.16 + R() * 0.18 });
  return out;
}
export function drawStreak(ctx, x, y0, y1, w, a) {
  if (y1 - y0 < 2) return;
  const g = ctx.map.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(38,30,24,${a})`); g.addColorStop(0.7, `rgba(38,30,24,${a * 0.55})`); g.addColorStop(1, 'rgba(38,30,24,0)');
  ctx.map.fillStyle = g; ctx.map.fillRect(x - w / 2, y0, w, y1 - y0);
  ctx.bump.fillStyle = 'rgba(90,90,90,0.35)'; ctx.bump.fillRect(x - w / 2, y0, w, (y1 - y0) * 0.6);
  if (ctx.rough) { ctx.rough.fillStyle = 'rgba(135,0,220,0.45)'; ctx.rough.fillRect(x - w / 2, y0, w, (y1 - y0) * 0.65); }
}
// cellule (c, r) du motif (2 travées x 2 étages) : ox, oy son coin haut-gauche ; fenêtre (wx, wy, ww, wh) ; appui juste sous la fenêtre
export function grime(ctx, style, variant, c, r, ox, oy, wx, wy, ww, wh) {
  const sillY = wy + wh + 11, bottom = oy + CH;
  for (const k of streakSet(style, variant, c, r, wx, ww)) drawStreak(ctx, k.x, sillY, Math.min(sillY + k.len, bottom), k.w, k.a);
  for (const k of streakSet(style, variant, c, 1 - r, wx, ww)) { // l'eau qui vient de la fenêtre de l'étage du dessus : le reste de la coulure
    const rest = k.len - (bottom - sillY); if (rest > 2) drawStreak(ctx, k.x, oy, oy + rest, k.w, k.a * 0.8);
  }
  const R = prng(STYLE_SEED[style] * 7919 + variant * 101 + c * 17 + r * 29 + 3);
  for (let i = 0; i < 3; i++) { // taches d'humidité et de patine : grands halos très doux
    const x = ox + R() * CW, y = oy + R() * CH, rad = (0.5 + R() * 1.1) * PX, a = 0.05 + R() * 0.07;
    const g = ctx.map.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, `rgba(${R() < 0.35 ? '46,58,38' : '48,36,26'},${a})`); g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.map.fillStyle = g; ctx.map.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  if (R() < 0.55) { // fissure partant d'un angle de la fenêtre
    let x = R() < 0.5 ? wx - 8 : wx + ww + 8, y = wy + wh * (R() < 0.5 ? 0 : 1), dir = (x < wx + ww / 2 ? -1 : 1);
    ctx.map.strokeStyle = 'rgba(30,22,18,0.42)'; ctx.map.lineWidth = 1.6; ctx.bump.strokeStyle = '#4a4a4a'; ctx.bump.lineWidth = 2.2;
    for (const cx2 of [ctx.map, ctx.bump]) { cx2.beginPath(); cx2.moveTo(x, y); }
    const n = 4 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) { x += dir * (4 + R() * 12); y += (R() - 0.35) * 16 + (y < wy + wh / 2 ? -5 : 6); ctx.map.lineTo(x, y); ctx.bump.lineTo(x, y); }
    ctx.map.stroke(); ctx.bump.stroke();
  }
}
