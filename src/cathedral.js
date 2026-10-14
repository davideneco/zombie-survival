import * as THREE from 'three';
import { obb } from './architecture.js';
import { preparePassages, cutIntervals } from './passage.js';

// =====================================================================
//  Intérieur jouable de la cathédrale Notre-Dame (zone de fin de partie) :
//  dallage, murs à vitraux, voûte d'ogives, arcades et piliers de la nef, rosace,
//  bancs, maître-autel, horloge astronomique. Accès par le grand portail ouest.
// =====================================================================

export const CEIL = 32;      // hauteur de la voûte (m)
export const PORTAL_H = 8.5; // hauteur du grand portail
const WALL_T = 2.2;          // épaisseur des murs (le contour OSM est l'extérieur)

// ------------------------------------------------------------------ Géométrie 2D
export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const area = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const [a, b] = pts[i], [c, d] = pts[(i + 1) % pts.length]; s += a * d - c * b; } return s / 2; };
// Simplification Ramer-Douglas-Peucker d'un anneau fermé
function simplify(pts, eps) {
  const rdp = (P) => {
    if (P.length < 3) return P;
    const [ax, az] = P[0], [bx, bz] = P[P.length - 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    let dmax = 0, k = 0;
    for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((bx - ax) * (az - P[i][1]) - (ax - P[i][0]) * (bz - az)) / L; if (d > dmax) { dmax = d; k = i; } }
    if (dmax <= eps) return [P[0], P[P.length - 1]];
    return [...rdp(P.slice(0, k + 1)).slice(0, -1), ...rdp(P.slice(k))];
  };
  // on coupe l'anneau au point le plus éloigné du premier
  let far = 0, fd = 0;
  pts.forEach(([x, z], i) => { const d = Math.hypot(x - pts[0][0], z - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = rdp(pts.slice(0, far + 1)), b = rdp([...pts.slice(far), pts[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
// Décalage vers l'intérieur (anneau orienté positivement : l'intérieur est à gauche)
function inset(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
    let bx = n1[0] + n2[0], bz = n1[1] + n2[1]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
    const cos = Math.max(0.4, bx * n1[0] + bz * n1[1]);
    out.push([c[0] + (bx * d) / cos, c[1] + (bz * d) / cos]);
  }
  return out;
}
// Premier croisement d'un rayon avec un polygone : distance, ou Infinity
function rayPoly(ox, oz, dx, dz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
    if (t > 0.01 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// ------------------------------------------------------------------ Plan
export function planCathedral(outline, parts) {
  const inner = inset(simplify(outline, 1.2), WALL_T);
  if (area(inner) <= 0) inner.reverse();
  const inOutline = (p) => pointInPoly(p[0], p[1], outline);
  const mine = parts.filter((p) => p.pts.length >= 3 && inOutline(centroid(p.pts)));
  // nef : grande partie haute (toit de la nef) ; tour : la plus haute
  // nef : la partie haute la plus allongée qui a une vraie épaisseur verticale (pas une fine tranche de la tour)
  const nave = mine.filter((p) => { const h = num(p.tags.height) || 0, m = num(p.tags.min_height) || 0; return h >= 30 && h < 60 && h - m >= 15; })
    .map((p) => ({ p, ob: obb(p.pts) })).filter((e) => e.ob).sort((a, b) => b.ob.hl - a.ob.hl)[0]?.p;
  const tower = mine.slice().sort((a, b) => (num(b.tags.height) || 0) - (num(a.tags.height) || 0))[0];
  const nob = obb(nave ? nave.pts : outline);
  let { ux, uz, vx, vz } = nob;
  const [tx, tz] = centroid(tower.pts);
  if ((nob.cx - tx) * ux + (nob.cz - tz) * uz < 0) { ux = -ux; uz = -uz; vx = -vx; vz = -vz; } // u : de la façade ouest vers le chœur
  const cx = nob.cx, cz = nob.cz;
  const S = (x, z) => (x - cx) * ux + (z - cz) * uz, T = (x, z) => (x - cx) * vx + (z - cz) * vz;
  const P = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  // étendue de la nef (partie OSM) dans le repère (s, t)
  const ns = (nave ? nave.pts : outline).map(([x, z]) => S(x, z));
  const s0 = Math.min(...ns), s1 = Math.max(...ns), hw = nob.hw;
  // grand portail : sur l'axe, côté ouest
  const sIn = Math.min(rayPoly(cx, cz, -ux, -uz, inner), 120), sOut = Math.min(rayPoly(cx, cz, -ux, -uz, outline), 125);
  const pOut = P(-sOut - 4, 0), pIn = P(-sIn + 3, 0);
  const portal = preparePassages([{ pts: [pOut, pIn], width: 5.4 }])[0];
  // chœur : autel au fond, Pack-a-Punch devant
  const sEast = Math.min(rayPoly(cx, cz, ux, uz, inner), 120);
  const face = (dx, dz) => Math.atan2(dx, dz); // rotation.y pour que la face avant (+z) regarde (dx, dz)
  const altar = { p: P(sEast - 6, 0), rot: face(-ux, -uz) };
  const pap = { p: P(sEast - 14, 0), rot: face(-ux, -uz) };
  // horloge astronomique : transept sud (côté où z augmente)
  const side = vz > 0 ? 1 : -1;
  let cross = P(s1 + 7, 0);
  if (!pointInPoly(cross[0], cross[1], inner)) cross = P((s0 + s1) / 2, 0);
  const tw = Math.min(rayPoly(cross[0], cross[1], vx * side, vz * side, inner), 40);
  const clock = { p: [cross[0] + vx * side * (tw - 2.4), cross[1] + vz * side * (tw - 2.4)], rot: face(-vx * side, -vz * side) };
  return {
    outline, inner, axis: { cx, cz, ux, uz, vx, vz }, S, T, P, nave: { s0, s1, hw }, portal, pIn: P(-sIn, 0), sIn, sEast,
    seed: P((s0 + s1) / 2, 0), altar, pap, clock,
    insideInner: (x, z) => pointInPoly(x, z, inner),
    cutsOf: (ax, az, bx, bz) => cutIntervals([portal], ax, az, bx, bz),
  };
}

// ------------------------------------------------------------------ Textures
export function canvasTex(w, h, draw, emissive = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (emissive) { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
  draw(x, w, h, emissive);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
export const GLASS = ['#1a3a9a', '#a01a1a', '#1a7a3a', '#c09a1a', '#6a1a8a', '#1a6aa0', '#c0501a'];
// aléa reproductible : le canevas d'albedo et celui de l'émissif dessinent EXACTEMENT le même vitrail
function seededRnd(seed) {
  let s = (Math.floor(seed) * 2654435761) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Verres : [teinte, saturation, clarté] (bleu et rouge dominants comme à Strasbourg, un peu de vert, d'or et de blanc)
const PANES = [[222, 70, 34], [222, 70, 34], [216, 64, 40], [356, 72, 36], [356, 72, 36], [8, 70, 40], [132, 46, 30], [44, 80, 48], [280, 40, 30], [48, 20, 74]];
// Vitrail en lancette (arc brisé) : bordure, treillis de losanges, médaillons et tête à rosace, le tout serti de plombs. Mêmes dessins en albedo
// (verre sombre + plombs noirs) et en émissif (verre lumineux, plus clair au centre, plombs noirs : ils ne brillent pas).
export function stainedGlass(x, px, py, w, h, emis) {
  const R = seededRnd(px * 31 + py * 17 + w * 7), lead = Math.max(2, w / 38);
  const springY = py + w * 0.87, cx = px + w / 2, bottom = py + h;
  x.save();
  x.beginPath(); x.moveTo(px, bottom); x.lineTo(px, springY);
  x.arc(px + w, springY, w, Math.PI, Math.PI + Math.PI / 3); // arc brisé : deux arcs de rayon w qui se coupent à la clé
  x.arc(px, springY, w, Math.PI * 2 - Math.PI / 3, Math.PI * 2);
  x.lineTo(px + w, bottom); x.closePath(); x.clip();
  const pane = () => PANES[Math.floor(R() * PANES.length)];
  const fillPane = (path, col, k = 1) => { // une pièce de verre : dégradé (plus clair au milieu), grain
    const [hh, ss, ll] = col;
    path();
    const b = path.bbox, g = x.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
    if (emis) { g.addColorStop(0, `hsl(${hh},${Math.min(100, ss + 10)}%,${Math.min(80, ll * 1.35 + 14) * k}%)`); g.addColorStop(1, `hsl(${hh},${ss}%,${Math.min(70, ll * 0.95 + 6) * k}%)`); }
    else { g.addColorStop(0, `hsl(${hh},${ss}%,${ll * 0.7}%)`); g.addColorStop(1, `hsl(${hh},${ss}%,${ll * 0.5}%)`); }
    x.fillStyle = g; x.fill();
    x.strokeStyle = '#0b0b0b'; x.lineWidth = lead; x.lineJoin = 'round'; x.stroke();
  };
  const poly = (pts) => { const f = () => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); }; f.bbox = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, w * 0.25]; return f; };
  const circ = (ox, oy, r) => { const f = () => { x.beginPath(); x.arc(ox, oy, r, 0, 7); }; f.bbox = [ox, oy, r * 1.1]; return f; };
  // fond : verre bleu sombre (toute la lancette) puis treillis de losanges rouge / bleu
  x.fillStyle = emis ? '#0a1030' : '#0d1230'; x.fillRect(px, py, w, h + 2);
  const cw = w / 3.2, ch = cw * 1.5, y0 = py + w * 0.15;
  for (let j = 0, yy = y0; yy < bottom + ch; j++, yy += ch / 2) for (let i = -1; i < 5; i++) {
    const ox = px + i * cw + (j % 2 ? cw / 2 : 0), oy = yy;
    const col = ((i + j) & 1) ? PANES[0] : PANES[3 + ((i + 2 * j) % 3 === 0 ? 3 : 0)];
    fillPane(poly([[ox, oy - ch / 2], [ox + cw / 2, oy], [ox, oy + ch / 2], [ox - cw / 2, oy]]), R() < 0.18 ? pane() : col);
  }
  // médaillons : disque serti, couronne de verres, cœur doré ou blanc
  const n = Math.max(1, Math.floor((h - w * 1.6) / (w * 1.15)));
  for (let k = 0; k < n; k++) {
    const oy = py + w * 1.35 + (k + 0.5) * ((h - w * 1.6) / n), r = w * 0.36;
    fillPane(circ(cx, oy, r), PANES[9]);
    for (let a = 0; a < 8; a++) {
      const a0 = (a / 8) * Math.PI * 2, a1 = ((a + 1) / 8) * Math.PI * 2, r0 = r * 0.42;
      { const f = () => { x.beginPath(); x.arc(cx, oy, r * 0.96, a0, a1); x.arc(cx, oy, r0, a1, a0, true); x.closePath(); }; f.bbox = [cx, oy, r]; fillPane(f, a % 2 ? PANES[3] : PANES[0]); }
    }
    fillPane(circ(cx, oy, r * 0.36), R() < 0.5 ? PANES[7] : PANES[9]);
  }
  // tête : rosace de six lobes dans l'arc, deux petits oculus
  { const oy = py + w * 0.55, r = w * 0.27;
    for (let a = 0; a < 6; a++) { const t = (a / 6) * Math.PI * 2; fillPane(circ(cx + Math.cos(t) * r * 0.72, oy + Math.sin(t) * r * 0.72, r * 0.46), PANES[(a % 2) ? 4 : 7]); }
    fillPane(circ(cx, oy, r * 0.42), PANES[3]);
    for (const sx of [-1, 1]) fillPane(circ(cx + sx * w * 0.3, py + w * 0.98, w * 0.09), PANES[6]); }
  // meneau central fin et cadre de plomb
  x.strokeStyle = '#0b0b0b'; x.lineWidth = lead * 2.2; x.beginPath(); x.moveTo(px, springY); x.lineTo(px, bottom); x.moveTo(px + w, springY); x.lineTo(px + w, bottom); x.stroke();
  // bordure colorée le long des montants
  for (let yy = springY; yy < bottom; yy += w * 0.16) for (const sx of [0, 1]) fillPane(poly([[px + sx * (w - w * 0.1), yy], [px + sx * (w - w * 0.1) + w * 0.1, yy], [px + sx * (w - w * 0.1) + w * 0.1, yy + w * 0.16], [px + sx * (w - w * 0.1), yy + w * 0.16]]), PANES[(Math.floor(yy / (w * 0.16)) + sx) % 2 ? 7 : 3]);
  x.restore();
}
function wallTextures() {
  // 6 m x 32 m : soubassement à arcatures aveugles, deux grandes lancettes, cordon, fenêtres hautes
  const W = 384, H = 2048, M = H / 32;
  const draw = (x, w, h, emis) => {
    if (!emis) {
      x.fillStyle = '#a77866'; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 0.42 * M) { x.fillStyle = 'rgba(50,20,15,0.35)'; x.fillRect(0, y, w, 2); for (let xx = (Math.round(y) % 2) * 20; xx < w; xx += 0.9 * M) x.fillRect(xx, y, 2, 0.42 * M); }
      for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,200'},0.06)`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      // arcatures aveugles (0 à 3 m)
      for (let k = 0; k < 3; k++) { x.strokeStyle = '#7a5040'; x.lineWidth = 6; const ax = k * w / 3 + 10, aw = w / 3 - 20; x.beginPath(); x.moveTo(ax, h); x.lineTo(ax, h - 2 * M); x.quadraticCurveTo(ax + aw / 2, h - 3.2 * M, ax + aw, h - 2 * M); x.lineTo(ax + aw, h); x.stroke(); }
      // cordons
      for (const yy of [h - 4 * M, h - 16.5 * M, h - 17 * M]) { x.fillStyle = '#8a5a48'; x.fillRect(0, yy, w, 0.3 * M); }
    }
    // grandes lancettes (4 à 15 m)
    for (const lx of [0.9, 3.3]) stainedGlass(x, lx * M, h - 15.5 * M, 1.8 * M, 11 * M, emis);
    // fenêtres hautes (19 à 29 m) + petite rosace
    for (const lx of [0.8, 3.6]) stainedGlass(x, lx * M, h - 29 * M, 1.6 * M, 9 * M, emis);
    x.save(); x.translate(3 * M, h - 31 * M);
    for (let r = 0; r < 12; r++) { x.fillStyle = GLASS[r % GLASS.length]; x.globalAlpha = emis ? 0.7 : 1; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 0.8 * M, (r / 12) * Math.PI * 2, ((r + 1) / 12) * Math.PI * 2); x.fill(); }
    x.globalAlpha = 1; x.restore();
  };
  return [canvasTex(W, H, draw, false), canvasTex(W, H, draw, true)];
}
// Tache de lumière colorée au sol (additive) : 2 x 2 variantes (bleu, rouge, or, mixte) d'une lancette étirée (pointe vers le mur : v = 0), bords flous, mosaïque floue, éteinte vers le large
export function lightPoolTex() {
  const rnd = seededRnd(777), cols = [['#2a4cff', '#6a8cff', '#1a2a9a'], ['#ff3030', '#ff7a40', '#9a1a1a'], ['#ffc040', '#ffe090', '#c08020'], ['#4a60ff', '#ff4040', '#40d080']];
  return canvasTex(256, 256, (x, w, h) => {
    const c = w / 2;
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2) * c, oy = Math.floor(k / 2) * c;
      x.save(); x.beginPath(); x.rect(ox, oy, c, c); x.clip(); x.filter = 'blur(5px)';
      for (let i = 0; i < 26; i++) { const px = ox + 14 + rnd() * (c - 28), py = oy + 6 + rnd() * (c - 12), r = 10 + rnd() * 14; x.fillStyle = cols[k][Math.floor(rnd() * 3)]; x.beginPath(); x.moveTo(px, py - r); x.lineTo(px + r * 0.7, py); x.lineTo(px, py + r); x.lineTo(px - r * 0.7, py); x.closePath(); x.fill(); }
      x.filter = 'none';
      // masque : forme de lancette étirée, fondu aux bords et vers le large (v croissant)
      x.globalCompositeOperation = 'destination-in';
      const g = x.createLinearGradient(0, oy, 0, oy + c); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(ox, oy, c, c);
      x.globalCompositeOperation = 'destination-in';
      const gx = x.createLinearGradient(ox, 0, ox + c, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.16, 'rgba(0,0,0,1)'); gx.addColorStop(0.84, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gx; x.fillRect(ox, oy, c, c);
      x.restore();
    }
  });
}
export function floorTex() {
  // dallage de grès et de calcaire, 4 x 4 dalles de 1,2 m sur 1024 px : tons variés d'une dalle à l'autre, veines, taches, éclats, joints encrassés, usure des bords
  const rnd = seededRnd(4242);
  return canvasTex(1024, 1024, (x, w, h) => {
    const n = 4, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const dark = (i + j) % 2, v = (rnd() - 0.5) * 0.16;
      const base = dark ? [112, 92, 86] : [168, 152, 136];
      const col = base.map((q) => Math.max(0, Math.min(255, Math.round(q * (1 + v)))));
      const ox = i * c, oy = j * c;
      x.save(); x.beginPath(); x.rect(ox, oy, c, c); x.clip();
      x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fillRect(ox, oy, c, c);
      // nuages de tons (grandes taches douces)
      for (let k = 0; k < 7; k++) { const px = ox + rnd() * c, py = oy + rnd() * c, r = 30 + rnd() * 90, g = x.createRadialGradient(px, py, 0, px, py, r); const t = rnd() < 0.5 ? '0,0,0' : '255,240,220'; g.addColorStop(0, `rgba(${t},${0.05 + rnd() * 0.07})`); g.addColorStop(1, `rgba(${t},0)`); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
      // veines
      x.lineWidth = 1;
      for (let k = 0; k < 4; k++) { x.strokeStyle = `rgba(${rnd() < 0.6 ? '60,40,30' : '240,230,215'},${0.06 + rnd() * 0.1})`; x.beginPath(); let px = ox + rnd() * c, py = oy; x.moveTo(px, py); for (let s2 = 0; s2 < 6; s2++) { px += (rnd() - 0.45) * 60; py += c / 6; x.lineTo(px, py); } x.stroke(); }
      // grain
      for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,235,215'},${0.03 + rnd() * 0.07})`; x.fillRect(ox + rnd() * c, oy + rnd() * c, 1 + rnd() * 3, 1 + rnd() * 3); }
      // fissure occasionnelle
      if (rnd() < 0.3) { x.strokeStyle = 'rgba(25,15,10,0.55)'; x.lineWidth = 1.5; x.beginPath(); let px = ox + rnd() * c, py = oy + rnd() * c * 0.3; x.moveTo(px, py); for (let s2 = 0; s2 < 5; s2++) { px += (rnd() - 0.5) * 40; py += 24 + rnd() * 30; x.lineTo(px, py); } x.stroke(); }
      // usure et saleté des bords (ombre intérieure)
      for (const [x0, y0, x1, y1] of [[ox, oy, ox + c, oy], [ox, oy + c, ox + c, oy + c], [ox, oy, ox, oy + c], [ox + c, oy, ox + c, oy + c]]) {
        const g = x.createLinearGradient(x0, y0, x0 + (x1 === x0 ? (x0 === ox ? 26 : -26) : 0), y0 + (y1 === y0 ? (y0 === oy ? 26 : -26) : 0));
        g.addColorStop(0, 'rgba(30,20,15,0.38)'); g.addColorStop(1, 'rgba(30,20,15,0)');
        x.fillStyle = g; x.fillRect(ox, oy, c, c);
      }
      x.restore();
    }
    // joints : creux sombre + filet clair (arête de la dalle voisine)
    for (let i = 0; i <= n; i++) {
      for (const [a0, b0, a1, b1] of [[i * c, 0, i * c, h], [0, i * c, w, i * c]]) {
        x.strokeStyle = 'rgba(30,22,18,0.8)'; x.lineWidth = 5; x.beginPath(); x.moveTo(a0, b0); x.lineTo(a1, b1); x.stroke();
        x.strokeStyle = 'rgba(255,235,210,0.12)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(a0 + (a0 === a1 ? 4 : 0), b0 + (b0 === b1 ? 4 : 0)); x.lineTo(a1 + (a0 === a1 ? 4 : 0), b1 + (b0 === b1 ? 4 : 0)); x.stroke();
      }
    }
    // poussière dans les joints
    for (let k = 0; k < 900; k++) { const i = Math.floor(rnd() * (n + 1)), t = rnd() * w; x.fillStyle = 'rgba(40,30,25,0.18)'; if (rnd() < 0.5) x.fillRect(i * c - 3 + rnd() * 6, t, 3, 5 + rnd() * 7); else x.fillRect(t, i * c - 3 + rnd() * 6, 5 + rnd() * 7, 3); }
  });
}
export function vaultTex() {
  // une travée : voûte peinte bleu nuit étoilée, ogives en croix et arcs doubleaux
  return canvasTex(512, 512, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7); g.addColorStop(0, '#2a3458'); g.addColorStop(1, '#141a30');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { x.fillStyle = '#d8b84a'; const sx = Math.random() * w, sy = Math.random() * h; x.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, r = k % 2 ? 2 : 5; x.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); } x.fill(); }
    x.strokeStyle = '#a7806a'; x.lineWidth = 16;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
    x.lineWidth = 22; x.strokeRect(0, 0, w, h);
    x.fillStyle = '#c8a050'; x.beginPath(); x.arc(w / 2, h / 2, 22, 0, 7); x.fill(); // clé de voûte dorée
  });
}
export function roseTex(emissive) {
  return canvasTex(1024, 1024, (x, w, h, emis) => {
    const c = w / 2;
    x.translate(c, c);
    if (!emis) { x.fillStyle = '#5a3a30'; x.beginPath(); x.arc(0, 0, c, 0, 7); x.fill(); }
    for (let ring = 0; ring < 3; ring++) {
      const r0 = 60 + ring * 140, r1 = r0 + 130, n = 12 * (ring + 1);
      for (let k = 0; k < n; k++) {
        x.fillStyle = GLASS[(k + ring * 3) % GLASS.length]; x.globalAlpha = emis ? 0.8 : 1;
        x.beginPath(); x.arc(0, 0, r1, (k / n) * Math.PI * 2, ((k + 0.85) / n) * Math.PI * 2); x.arc(0, 0, r0, ((k + 0.85) / n) * Math.PI * 2, (k / n) * Math.PI * 2, true); x.fill();
      }
    }
    x.globalAlpha = 1;
    x.fillStyle = emis ? '#ffd27a' : '#e0b040'; x.beginPath(); x.arc(0, 0, 55, 0, 7); x.fill();
    if (!emis) { x.strokeStyle = '#3a2620'; x.lineWidth = 10; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; x.beginPath(); x.moveTo(Math.cos(a) * 55, Math.sin(a) * 55); x.lineTo(Math.cos(a) * c, Math.sin(a) * c); x.stroke(); } }
  }, emissive);
}

// ------------------------------------------------------------------ Construction
export function buildInterior(scene, plan, { collision, lightSources, props }) {
  const { inner, P, nave, axis } = plan;
  const stone = new THREE.MeshStandardMaterial({ color: 0xa87c6a, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a640, roughness: 0.3, metalness: 0.9, emissive: 0x3a2808 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.75 });
  const add = (mesh) => { mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh; };
  const local = (s, t) => [s, t];
  const S = plan.S, T = plan.T;

  // dallage
  {
    const tris = THREE.ShapeUtils.triangulateShape(inner.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const pos = [], uv = [];
    for (const tri of tris) for (const k of tri) { const [x, z] = inner[k]; pos.push(x, 0.03, z); uv.push(S(x, z) / 4.8, T(x, z) / 4.8); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 })));
    // voûte (même triangulation, à 32 m)
    const pc = [], uc = [];
    for (const tri of tris) for (const k of tri.slice().reverse()) { const [x, z] = inner[k]; pc.push(x, CEIL, z); uc.push(S(x, z) / 8, T(x, z) / 8); }
    const gc = new THREE.BufferGeometry(); gc.setAttribute('position', new THREE.Float32BufferAttribute(pc, 3)); gc.setAttribute('uv', new THREE.Float32BufferAttribute(uc, 2)); gc.computeVertexNormals();
    add(new THREE.Mesh(gc, new THREE.MeshStandardMaterial({ map: vaultTex(), roughness: 0.9, side: THREE.DoubleSide })));
  }

  // murs intérieurs à vitraux (ouverts au portail)
  const [wmap, wemis] = wallTextures();
  const wallMat = new THREE.MeshStandardMaterial({ map: wmap, emissiveMap: wemis, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.85, side: THREE.DoubleSide });
  {
    const pos = [], uv = [], idx = [];
    const quad = (ax, az, bx, bz, t0, t1, y0, y1, u0) => {
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const l = Math.hypot(x1 - x0, z1 - z0), base = pos.length / 3;
      pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
      uv.push(u0, y0 / CEIL, u0 + l / 6, y0 / CEIL, u0 + l / 6, y1 / CEIL, u0, y1 / CEIL);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 0; i < inner.length; i++) {
      const [ax, az] = inner[i], [bx, bz] = inner[(i + 1) % inner.length];
      const len = Math.hypot(bx - ax, bz - az);
      const cuts = plan.cutsOf(ax, az, bx, bz);
      let t = 0;
      for (const [t0, t1] of cuts) {
        if (t0 > t) { quad(ax, az, bx, bz, t, t0, 0, CEIL, t * len / 6); collision.addSegment(ax + (bx - ax) * t, az + (bz - az) * t, ax + (bx - ax) * t0, az + (bz - az) * t0); }
        quad(ax, az, bx, bz, t0, t1, PORTAL_H, CEIL, t0 * len / 6);
        t = t1;
      }
      if (t < 1) { quad(ax, az, bx, bz, t, 1, 0, CEIL, t * len / 6); collision.addSegment(ax + (bx - ax) * t, az + (bz - az) * t, bx, bz); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    add(new THREE.Mesh(g, wallMat));
  }
  // ébrasement du portail (entre le mur extérieur et le mur intérieur) : deux joues + linteau
  {
    const [ox, oz] = plan.portal.pts[0], [ix, iz] = plan.portal.pts[1], hw = plan.portal.hw;
    for (const side of [-1, 1]) {
      const a = [ox + axis.vx * hw * side, oz + axis.vz * hw * side], b = [ix + axis.vx * hw * side, iz + axis.vz * hw * side];
      collision.addSegment(a[0], a[1], b[0], b[1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(0.6, PORTAL_H + 0.95, len), stone)); // 5 cm sous le linteau : plus de dessus coplanaire
      m.position.set((a[0] + b[0]) / 2 + axis.vx * 0.3 * side, (PORTAL_H + 0.95) / 2, (a[1] + b[1]) / 2 + axis.vz * 0.3 * side);
      m.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    }
    const len = Math.hypot(ix - ox, iz - oz);
    const lintel = add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.2, 1, len), stone));
    lintel.position.set((ox + ix) / 2, PORTAL_H + 0.5, (oz + iz) / 2); lintel.rotation.y = Math.atan2(ix - ox, iz - oz);
  }

  // nef : piliers fasciculés, arcades brisées, murs hauts
  const rotU = Math.atan2(axis.ux, axis.uz) - Math.PI / 2; // objets dont l'axe x local suit l'axe de la nef
  {
    const bays = Math.max(3, Math.round((nave.s1 - nave.s0) / 8)), bw = (nave.s1 - nave.s0) / bays;
    const pillarG = [];
    const archShape = (w) => {
      const pts = [[0, 17], [w, 17], [w, 11], [w - 0.9, 11]];
      for (let k = 1; k < 16; k++) { const a = k / 16; const x = w - 0.9 - (w - 1.8) * a; pts.push([x, 11 + Math.sin(a * Math.PI) * 4.6 + (a > 0.5 ? (1 - a) : a) * 0.4]); }
      pts.push([0.9, 11], [0, 11]);
      return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    };
    for (const side of [-1, 1]) {
      const t = nave.hw * side;
      for (let k = 0; k <= bays; k++) {
        const [x, z] = P(nave.s0 + k * bw, t);
        if (!plan.insideInner(x, z)) continue;
        pillarG.push(new THREE.CylinderGeometry(0.85, 1.0, CEIL, 12).translate(x, CEIL / 2, z));
        for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) pillarG.push(new THREE.CylinderGeometry(0.22, 0.22, CEIL, 8).translate(x + dx, CEIL / 2, z + dz));
        pillarG.push(new THREE.BoxGeometry(2.6, 0.5, 2.6).translate(x, 0.25, z));
        collision.addCircle(x, z, 1.25, CEIL, -Infinity, 'wall');
        if (k < bays) {
          const ge = new THREE.ExtrudeGeometry(archShape(bw), { depth: 0.8, bevelEnabled: false });
          ge.translate(0, 0, -0.4);
          const m = add(new THREE.Mesh(ge, stone));
          m.position.set(x, 0, z); m.rotation.y = rotU;
        }
      }
      // mur haut de la nef (17 à 32 m), percé des fenêtres hautes (même texture que les murs)
      const [ax, az] = P(nave.s0, t), [bx, bz] = P(nave.s1, t);
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([ax, 17, az, bx, 17, bz, bx, CEIL, bz, ax, CEIL, az], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 17 / CEIL, len / 6, 17 / CEIL, len / 6, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      add(new THREE.Mesh(g, wallMat));
    }
    const merged = mergeAll(pillarG);
    add(new THREE.Mesh(merged, stone));
  }

  // grande rosace au-dessus du portail
  {
    const m = add(new THREE.Mesh(new THREE.CircleGeometry(6.5, 48), new THREE.MeshStandardMaterial({ map: roseTex(false), emissiveMap: roseTex(true), emissive: 0xffffff, emissiveIntensity: 1.3, side: THREE.DoubleSide })));
    const [x, z] = plan.pIn;
    m.position.set(x + axis.ux * 0.15, 20, z + axis.uz * 0.15);
    m.rotation.y = Math.atan2(axis.ux, axis.uz);
    m.castShadow = false;
  }

  // bancs de la nef (deux blocs de part et d'autre de l'allée centrale)
  {
    const sA = nave.s0 + 6, sB = nave.s1 - 4, half = nave.hw - 1.4;
    for (const side of [-1, 1]) {
      const tc = side * (1.6 + (half - 1.6) / 2), plen = half - 1.6;
      for (let s = sA; s < sB; s += 1.35) {
        const [x, z] = P(s, tc);
        props.place('pew', x, z, rotU + Math.PI / 2, 1, null, 0, 0);
      }
      const [mx, mz] = P((sA + sB) / 2, tc);
      collision.addBox(mx, mz, sB - sA, plen, -(rotU), 1.1);
    }
    props.setPewLength?.(nave.hw - 3);
  }

  // maître-autel : estrade, autel, croix dorée, cierges
  {
    const { p: [x, z], rot } = plan.altar;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.45, 6), stone).translateY(0.225));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 1.3), stone).translateY(1.0));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 1.5), new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.9 })).translateY(1.59));
    const cross = new THREE.Group(); cross.position.set(0, 1.6, -0.3);
    cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.08), gold).translateY(0.7), new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.08), gold).translateY(1.0));
    g.add(cross);
    const wax = new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.9 }), flame = new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xffa040, emissiveIntensity: 3 });
    for (let k = 0; k < 6; k++) {
      const cxk = -1.3 + k * 0.52;
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), wax).translateX(cxk).translateY(1.88).translateZ(0.3));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), flame).translateX(cxk).translateY(2.18).translateZ(0.3));
    }
    g.position.set(x, 0, z); g.rotation.y = rot;
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    collision.addBox(x, z, 3.4, 1.5, -rot, 1.6);
    lightSources.push({ x, y: 3, z, color: 0xffb060, intensity: 14, dist: 14 });
  }
  // lustres : lumière chaude le long de la nef
  for (let s = nave.s0 + 4; s < plan.sEast - 4; s += 12) {
    const [x, z] = P(s, 0);
    if (!plan.insideInner(x, z)) continue;
    lightSources.push({ x, y: 8, z, color: 0xffc890, intensity: 12, dist: 18 });
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.06, 6, 24), gold));
    ring.position.set(x, 9, z); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
    const chain = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, CEIL - 9, 4), gold)); chain.position.set(x, (CEIL + 9) / 2, z); chain.castShadow = false;
  }
  // lumière des vitraux (teinte bleutée) près du portail
  lightSources.push({ x: plan.pIn[0] + axis.ux * 6, y: 14, z: plan.pIn[1] + axis.uz * 6, color: 0x9a7aff, intensity: 10, dist: 20 });
}

export function mergeAll(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [], nor = [];
  for (const g of geos) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
