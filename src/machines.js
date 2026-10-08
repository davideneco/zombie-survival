import * as THREE from 'three';

// =====================================================================
//  Modèles des machines du jeu : distributeurs d'atouts, borne de munitions, armes murales
//  (dessin à la craie), boîte mystère, Pack-a-Punch. Textures dessinées sur canvas.
// =====================================================================

const cache = new Map();
function tex(key, w, h, draw, emissive = false) {
  const k = key + (emissive ? ':e' : '');
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (emissive) { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
  draw(x, w, h, emissive);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(k, t);
  return t;
}
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); };

// usure : rayures et taches
function grime(x, w, h, n = 260, a = 0.18) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a * Math.random()})` : `rgba(255,255,255,${a * 0.5 * Math.random()})`;
    x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 12);
  }
}
function rivets(x, x0, y0, x1, y1, step) {
  for (let px = x0; px <= x1; px += step) for (const py of [y0, y1]) { x.fillStyle = '#1a1a1c'; x.beginPath(); x.arc(px, py, 5, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(px - 1.5, py - 1.5, 2, 0, 7); x.fill(); }
}
function roundRect(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py); x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r); x.lineTo(px + w, py + h - r);
  x.quadraticCurveTo(px + w, py + h, px + w - r, py + h); x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r); x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py); x.closePath();
}
// texte néon : halo + trait clair
function neonText(x, text, px, py, size, color, emis, font = 'Impact, Arial Black, sans-serif') {
  x.font = `${size}px ${font}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (!emis) { x.lineWidth = size * 0.14; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, px, py); }
  x.shadowColor = color; x.shadowBlur = size * 0.35;
  x.fillStyle = emis ? color : '#ffffff'; x.fillText(text, px, py);
  x.shadowBlur = 0;
  x.fillStyle = emis ? '#ffffff' : color; x.globalAlpha = emis ? 0.55 : 0.55; x.fillText(text, px, py); x.globalAlpha = 1;
}

// ------------------------------------------------------------------ Emblèmes des atouts
function emblem(x, id, cx, cy, r, col) {
  x.save(); x.translate(cx, cy);
  x.fillStyle = col; x.strokeStyle = col; x.lineWidth = r * 0.12; x.lineJoin = 'round'; x.lineCap = 'round';
  const P = (pts) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a * r, b * r) : x.moveTo(a * r, b * r))); x.closePath(); };
  if (id === 'juggernog') { // casque / bouclier
    P([[-0.8, -0.7], [0.8, -0.7], [0.75, 0.15], [0, 0.9], [-0.75, 0.15]]); x.fill();
    x.fillStyle = '#ffffff'; P([[-0.12, -0.5], [0.12, -0.5], [0.12, 0.5], [-0.12, 0.5]]); x.fill(); P([[-0.5, -0.12], [0.5, -0.12], [0.5, 0.12], [-0.5, 0.12]]); x.fill();
  } else if (id === 'speedcola') { // éclair
    P([[0.15, -1], [-0.55, 0.12], [-0.05, 0.12], [-0.2, 1], [0.6, -0.2], [0.08, -0.2], [0.35, -1]]); x.fill();
  } else if (id === 'doubletap') { // deux balles
    for (const dx of [-0.35, 0.35]) { P([[dx - 0.2, 0.9], [dx + 0.2, 0.9], [dx + 0.2, -0.3], [dx, -0.9], [dx - 0.2, -0.3]]); x.fill(); x.fillStyle = '#ffffff'; x.fillRect((dx - 0.2) * r, 0.55 * r, 0.4 * r, 0.12 * r); x.fillStyle = col; }
  } else if (id === 'quickrevive') { // cœur avec croix
    x.beginPath(); x.moveTo(0, 0.85 * r); x.bezierCurveTo(-1.1 * r, 0, -0.8 * r, -0.95 * r, 0, -0.4 * r); x.bezierCurveTo(0.8 * r, -0.95 * r, 1.1 * r, 0, 0, 0.85 * r); x.fill();
    x.fillStyle = '#ffffff'; x.fillRect(-0.09 * r, -0.35 * r, 0.18 * r, 0.6 * r); x.fillRect(-0.3 * r, -0.14 * r, 0.6 * r, 0.18 * r);
  } else if (id === 'mulekick') { // fer à cheval
    x.lineWidth = r * 0.32; x.beginPath(); x.arc(0, -0.1 * r, 0.6 * r, Math.PI * 0.15, Math.PI * 0.85, true); x.stroke();
    x.fillStyle = '#ffffff'; for (const a of [0.35, 0.6, 0.85, 1.15, 1.4, 1.65].map((k) => k * Math.PI)) { x.beginPath(); x.arc(Math.cos(a) * 0.6 * r, -0.1 * r - Math.sin(a) * 0.6 * r, 0.05 * r, 0, 7); x.fill(); }
  } else if (id === 'staminup') { // aile + chaussure
    P([[-0.9, 0.5], [0.7, 0.5], [0.9, 0.25], [0.3, 0.1], [0.1, -0.5], [-0.5, -0.5], [-0.6, 0.1]]); x.fill();
    x.fillStyle = '#ffffff'; for (let k = 0; k < 3; k++) { P([[-0.95, -0.2 + k * 0.22], [-0.55, -0.32 + k * 0.22], [-0.55, -0.22 + k * 0.22], [-0.95, -0.1 + k * 0.22]]); x.fill(); }
  } else if (id === 'phdflopper') { // morion devant une étoile d'explosion à 8 branches
    x.beginPath();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? 0.52 : 1.05; (k ? x.lineTo : x.moveTo).call(x, Math.cos(a) * rr * r, Math.sin(a) * rr * r); }
    x.closePath(); x.fill();
    x.fillStyle = '#140822'; // silhouette sombre : elle se détache de l'étoile claire (diffus comme émissif)
    P([[-0.62, -0.05], [-0.5, 0.12], [-0.3, 0.18], [0.3, 0.18], [0.5, 0.12], [0.62, -0.05], [0.4, 0.04], [0.38, 0.0], [0.34, -0.2], [0.2, -0.36], [0.05, -0.44], [0.0, -0.54], [-0.06, -0.44], [-0.2, -0.36], [-0.34, -0.2], [-0.38, 0.0], [-0.4, 0.04]]); x.fill();
  }
  x.restore();
}

// ------------------------------------------------------------------ Distributeur d'atout
function perkFront(id, perk, price) {
  const W = 512, H = 1024;
  const draw = (x, w, h, emis) => {
    const col = perk.color;
    if (!emis) {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, shade(col, 0.9)); g.addColorStop(1, shade(col, 0.45)); x.fillStyle = g; x.fillRect(0, 0, w, h);
      grime(x, w, h, 400, 0.25);
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 10; x.strokeRect(14, 14, w - 28, h - 28);
    }
    // enseigne lumineuse : nom + emblème
    if (!emis) { x.fillStyle = '#121214'; roundRect(x, 34, 40, w - 68, 300, 26); x.fill(); }
    if (emis) { x.globalAlpha = 0.5; x.fillStyle = col; roundRect(x, 34, 40, w - 68, 300, 26); x.fill(); x.globalAlpha = 1; }
    emblem(x, id, w / 2, 150, 70, emis ? '#ffffff' : col);
    const words = perk.name.split(' ');
    const big = perk.name.length > 11 ? 50 : 66;
    if (words.length > 1 && perk.name.length > 11) { neonText(x, words[0], w / 2, 262, big, col, emis); neonText(x, words.slice(1).join(' '), w / 2, 312, big * 0.8, col, emis); }
    else neonText(x, perk.name, w / 2, 280, big, col, emis);
    // vitrine : bouteilles alignées
    if (!emis) { x.fillStyle = '#0c0d10'; roundRect(x, 50, 370, w - 100, 380, 18); x.fill(); }
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
      const bx = 90 + i * 100, by = 400 + row * 180;
      if (!emis) { x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(64, by + 150, w - 128, 6); }
      // bouteille : goulot + corps + étiquette
      x.fillStyle = emis ? shade(col, 1.6) : col;
      x.fillRect(bx + 22, by, 16, 34); x.beginPath(); x.moveTo(bx + 14, by + 34); x.lineTo(bx + 46, by + 34); x.lineTo(bx + 54, by + 60); x.lineTo(bx + 54, by + 148); x.lineTo(bx + 6, by + 148); x.lineTo(bx + 6, by + 60); x.closePath(); x.fill();
      if (!emis) { x.fillStyle = '#f2ead0'; x.fillRect(bx + 8, by + 82, 44, 36); emblem(x, id, bx + 30, by + 100, 13, col); x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(bx + 12, by + 62, 6, 80); }
    }
    if (!emis) { x.fillStyle = 'rgba(180,220,255,0.10)'; x.beginPath(); x.moveTo(50, 700); x.lineTo(300, 370); x.lineTo(380, 370); x.lineTo(120, 750); x.lineTo(50, 750); x.fill(); }
    // plaque de prix + monnayeur + trappe
    if (!emis) {
      x.fillStyle = '#d8c48a'; roundRect(x, 70, 780, 250, 90, 10); x.fill(); x.strokeStyle = '#6a5a2a'; x.lineWidth = 4; x.stroke();
      x.fillStyle = '#2a2414'; x.font = 'bold 54px Impact, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(`${price}`, 195, 828);
      x.font = 'bold 22px Arial'; x.fillText('POINTS', 195, 862);
      x.fillStyle = '#1a1a1a'; roundRect(x, 360, 790, 80, 70, 8); x.fill(); x.fillStyle = '#888'; x.fillRect(395, 800, 10, 40);
      x.fillStyle = '#0a0a0a'; roundRect(x, 90, 900, w - 180, 90, 14); x.fill(); x.fillStyle = '#2a2a2a'; x.fillRect(100, 910, w - 200, 10);
    } else {
      x.fillStyle = '#ff6a2a'; x.fillRect(372, 800, 56, 8);
    }
  };
  return [tex(`perk:${id}:${price}`, W, H, draw, false), tex(`perk:${id}:${price}`, W, H, draw, true)];
}

export function makePerkMachine(id, perk, price) {
  const g = new THREE.Group();
  const W = 1.2, H = 2.45, D = 0.9;
  const col = new THREE.Color(perk.color);
  const paint = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.6), roughness: 0.6, metalness: 0.25 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.6, metalness: 0.5 });
  const [map, emap] = perkFront(id, perk, price);
  const front = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.8, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), paint); body.position.y = H / 2 + 0.08; g.add(body);
  // fronton arrondi
  const top = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, D, 20, 1, false, 0, Math.PI), paint);
  top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2; top.position.y = H + 0.08; g.add(top);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, H - 0.1), front); face.position.set(0, H / 2 + 0.1, D / 2 + 0.005); g.add(face);
  // socle, bandes chromées, néons latéraux
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.12, D + 0.1), dark); base.position.y = 0.06; g.add(base);
  for (const sx of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, 0.05), chrome); trim.position.set(sx * (W / 2 + 0.01), H / 2 + 0.08, D / 2); g.add(trim);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.04, H * 0.8, 0.04), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6 }));
    neon.position.set(sx * (W / 2 + 0.03), H / 2 + 0.1, 0); g.add(neon);
  }
  g.userData.size = [W + 0.1, D + 0.1, H + 0.6];
  return g;
}

// ------------------------------------------------------------------ Borne de munitions
function ammoFront() {
  const draw = (x, w, h, emis) => {
    if (!emis) {
      x.fillStyle = '#4b5232'; x.fillRect(0, 0, w, h); grime(x, w, h, 900, 0.3);
      // panneaux emboutis
      for (const [px, py, pw, ph] of [[24, 250, w - 48, 300], [24, 580, w - 48, 300]]) { x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 6; x.strokeRect(px, py, pw, ph); x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2; x.strokeRect(px + 4, py + 4, pw, ph); }
      rivets(x, 30, 236, w - 30, 896, 60);
      // pochoir
      x.fillStyle = 'rgba(230,220,180,0.85)'; x.font = 'bold 74px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('MUNITIONS', w / 2, 330);
      x.font = 'bold 40px "Courier New", monospace'; x.fillText('CAL. 7,62 / 9 / 12', w / 2, 400);
      // cartouches dessinées
      for (let i = 0; i < 6; i++) { const bx = 70 + i * 66; x.fillStyle = '#c8a040'; x.fillRect(bx, 650, 30, 120); x.fillStyle = '#b06a30'; x.beginPath(); x.moveTo(bx, 650); x.lineTo(bx + 15, 600); x.lineTo(bx + 30, 650); x.fill(); x.fillStyle = '#7a5a20'; x.fillRect(bx - 3, 765, 36, 10); }
      // bande de danger
      for (let i = -2; i < 14; i++) { x.fillStyle = i % 2 ? '#111' : '#e0b020'; x.beginPath(); x.moveTo(i * 44, 900); x.lineTo(i * 44 + 44, 900); x.lineTo(i * 44 + 88, 960); x.lineTo(i * 44 + 44, 960); x.fill(); }
    }
    // écran : "RECHARGER [E]"
    if (!emis) { x.fillStyle = '#0a120a'; roundRect(x, 60, 40, w - 120, 170, 14); x.fill(); x.strokeStyle = '#222'; x.lineWidth = 8; x.stroke(); }
    neonText(x, 'MUNITIONS', w / 2, 100, 58, '#4dff7a', emis);
    neonText(x, 'RECHARGER', w / 2, 165, 36, '#4dff7a', emis, 'Arial, sans-serif');
  };
  return [tex('ammo', 512, 1024, draw, false), tex('ammo', 512, 1024, draw, true)];
}
export function makeAmmoStation() {
  const g = new THREE.Group();
  const W = 1.25, H = 1.75, D = 0.7;
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5232, roughness: 0.7, metalness: 0.5 });
  const [map, emap] = ammoFront();
  const front = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.85, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), olive); body.position.y = H / 2; g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, H - 0.04), front); face.position.set(0, H / 2, D / 2 + 0.005); g.add(face);
  // caisse ouverte posée dessus, pleine de cartouches
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x3e4428, roughness: 0.8, metalness: 0.4 });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), crateMat); crate.position.set(0, H + 0.14, 0); g.add(crate);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.3, metalness: 0.9 });
  const shells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), brass, 60);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) { m.makeTranslation(-0.38 + (i % 12) * 0.068, H + 0.3, -0.18 + Math.floor(i / 12) * 0.09); shells.setMatrixAt(i, m); }
  g.add(shells);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4dff7a, emissive: 0x4dff7a, emissiveIntensity: 2 }));
  lamp.position.set(W / 2 - 0.12, H + 0.06, D / 2 - 0.1); g.add(lamp);
  g.userData.size = [W, D, H + 0.3];
  return g;
}

// ------------------------------------------------------------------ Arme murale : dessin à la craie sur planche
const SILHOUETTES = {
  rifle: [[0, 60], [70, 52], [120, 50], [125, 40], [250, 40], [255, 36], [360, 36], [360, 46], [300, 48], [300, 58], [230, 60], [215, 100], [195, 100], [205, 62], [150, 64], [140, 92], [125, 92], [128, 66], [70, 78], [10, 92], [0, 80]],
  shotgun: [[0, 66], [80, 54], [120, 52], [130, 46], [370, 44], [370, 54], [300, 56], [295, 64], [190, 66], [180, 62], [130, 64], [125, 86], [110, 86], [112, 68], [60, 82], [0, 90]],
  smg: [[30, 56], [90, 50], [260, 50], [260, 58], [300, 58], [300, 64], [230, 66], [220, 118], [200, 118], [205, 68], [150, 68], [140, 96], [125, 96], [128, 70], [90, 70], [40, 74]],
  lmg: [[0, 62], [70, 54], [110, 50], [270, 48], [280, 44], [380, 44], [380, 52], [290, 56], [282, 64], [200, 66], [195, 108], [150, 108], [150, 70], [125, 72], [118, 96], [104, 96], [106, 74], [60, 82], [0, 92]],
  sniper: [[0, 64], [80, 56], [130, 56], [140, 50], [390, 50], [390, 56], [230, 60], [220, 66], [150, 68], [140, 92], [126, 92], [128, 70], [70, 80], [0, 92]],
  m1911: [[110, 40], [290, 40], [290, 64], [205, 64], [200, 80], [185, 82], [180, 70], [168, 70], [178, 128], [140, 132], [128, 72], [110, 64]],
  arex: [[110, 38], [292, 38], [292, 66], [210, 66], [205, 84], [186, 86], [180, 72], [170, 72], [180, 130], [138, 134], [126, 74], [110, 66]],
  deagle: [[95, 34], [305, 34], [305, 70], [215, 70], [210, 88], [190, 90], [184, 76], [172, 76], [184, 138], [136, 142], [122, 78], [95, 70]],
  magnum: [[120, 46], [300, 46], [300, 56], [220, 56], [215, 70], [190, 74], [185, 66], [170, 66], [180, 124], [140, 128], [132, 70], [120, 64]],
  ak47: [[0, 64], [60, 56], [110, 52], [115, 44], [250, 44], [262, 40], [330, 40], [340, 46], [365, 46], [365, 52], [300, 54], [255, 60], [220, 62], [205, 70], [215, 112], [200, 118], [180, 72], [150, 68], [140, 96], [124, 96], [128, 70], [70, 80], [8, 96], [0, 84]],
  famas: [[40, 60], [60, 40], [260, 40], [275, 52], [340, 52], [340, 58], [275, 60], [260, 70], [230, 72], [220, 96], [205, 96], [210, 72], [150, 72], [140, 112], [118, 112], [122, 74], [60, 78], [40, 76]],
  scar: [[10, 58], [80, 52], [120, 48], [124, 40], [300, 40], [305, 46], [370, 46], [370, 54], [300, 56], [230, 60], [226, 104], [204, 104], [208, 64], [150, 66], [142, 94], [126, 94], [130, 68], [80, 72], [14, 80]],
  mp5: [[30, 58], [90, 52], [250, 50], [255, 56], [300, 56], [300, 62], [240, 64], [220, 70], [226, 110], [205, 116], [198, 70], [150, 68], [142, 94], [126, 94], [130, 70], [90, 72], [34, 76]],
  p90: [[60, 50], [90, 40], [290, 40], [300, 52], [330, 54], [330, 60], [300, 62], [290, 80], [230, 82], [220, 96], [180, 96], [170, 82], [90, 82], [60, 70]],
  m249: [[0, 62], [70, 54], [110, 50], [120, 40], [240, 40], [250, 48], [380, 48], [380, 56], [280, 58], [260, 64], [200, 66], [200, 110], [150, 110], [150, 70], [128, 72], [120, 96], [106, 96], [108, 74], [60, 82], [0, 92]],
  mg42: [[0, 66], [80, 52], [130, 50], [140, 44], [330, 44], [340, 50], [390, 50], [390, 58], [300, 60], [200, 62], [160, 64], [150, 92], [134, 92], [138, 70], [80, 80], [0, 94]],
  pkm: [[0, 56], [20, 56], [60, 60], [110, 50], [290, 50], [300, 46], [385, 46], [385, 54], [290, 58], [200, 62], [195, 104], [150, 104], [150, 66], [128, 68], [122, 92], [108, 92], [110, 70], [60, 72], [20, 80], [0, 80]],
  svd: [[0, 62], [60, 54], [120, 52], [128, 40], [230, 40], [236, 50], [395, 50], [395, 56], [260, 58], [210, 60], [205, 90], [190, 94], [184, 64], [150, 66], [140, 90], [126, 90], [130, 68], [70, 76], [0, 88]],
  barrett: [[0, 60], [70, 50], [120, 46], [130, 30], [260, 30], [270, 44], [360, 44], [360, 40], [392, 40], [392, 58], [360, 58], [240, 60], [230, 100], [200, 100], [205, 64], [160, 66], [150, 96], [132, 96], [136, 68], [70, 78], [0, 88]],
  // Saiga-12 : fusil semi-automatique à chargeur droit (au mur de Saint-Thomas)
  saiga: [[0, 66], [80, 56], [120, 52], [130, 44], [300, 44], [310, 40], [375, 40], [375, 50], [300, 54], [240, 60], [215, 68], [225, 112], [200, 118], [185, 72], [150, 70], [142, 98], [126, 98], [130, 72], [80, 82], [0, 92]],
  // armes de la zone de l'Homme de Fer
  m79: [[0, 62], [20, 56], [110, 52], [140, 46], [200, 44], [205, 38], [360, 38], [360, 74], [205, 74], [195, 80], [170, 82], [160, 106], [142, 106], [146, 82], [110, 80], [20, 92], [0, 86]],
  crossbow: [[0, 64], [90, 58], [180, 56], [250, 54], [262, 18], [272, 18], [268, 54], [360, 52], [360, 60], [268, 62], [272, 110], [262, 110], [250, 64], [190, 66], [175, 96], [160, 96], [164, 70], [90, 76], [0, 84]],
};
function chalkBoard(id, name, price) {
  const draw = (x, w, h, emis) => {
    if (emis) { x.globalAlpha = 0.25; }
    // planches sombres
    for (let i = 0; i < 5; i++) {
      x.fillStyle = emis ? '#000' : `hsl(25, 25%, ${12 + (i % 2) * 3}%)`; x.fillRect(0, (i * h) / 5, w, h / 5 - 2);
      if (!emis) { x.strokeStyle = 'rgba(255,255,255,0.04)'; for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(0, (i * h) / 5 + 6 + k * 7); x.bezierCurveTo(w * 0.3, (i * h) / 5 + 3 + k * 7, w * 0.7, (i * h) / 5 + 9 + k * 7, w, (i * h) / 5 + 5 + k * 7); x.stroke(); } }
    }
    x.globalAlpha = 1;
    // craie : contour de l'arme (trait irrégulier)
    const sil = SILHOUETTES[id] || SILHOUETTES.rifle;
    const ox = (w - 390) / 2, oy = 30;
    for (let pass = 0; pass < 3; pass++) {
      x.strokeStyle = emis ? 'rgba(255,240,220,0.5)' : `rgba(240,236,226,${0.55 + pass * 0.12})`;
      x.lineWidth = 4 - pass; x.lineJoin = 'round';
      x.beginPath();
      sil.forEach(([px, py], i) => { const jx = ox + px + (Math.random() - 0.5) * 2.5, jy = oy + py + (Math.random() - 0.5) * 2.5; if (i) x.lineTo(jx, jy); else x.moveTo(jx, jy); });
      x.closePath(); x.stroke();
    }
    if (!emis) { x.fillStyle = 'rgba(240,236,226,0.06)'; x.beginPath(); sil.forEach(([px, py], i) => (i ? x.lineTo(ox + px, oy + py) : x.moveTo(ox + px, oy + py))); x.fill(); }
    // texte à la craie
    x.fillStyle = emis ? 'rgba(255,240,220,0.4)' : 'rgba(242,238,228,0.92)';
    x.font = 'bold 34px "Comic Sans MS", "Segoe Print", cursive'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, w / 2, 190);
    x.fillStyle = emis ? 'rgba(255,210,90,0.6)' : '#f6d36a';
    x.font = 'bold 40px "Comic Sans MS", "Segoe Print", cursive';
    x.fillText(`${price} PTS`, w / 2, 240);
    if (!emis) { x.fillStyle = 'rgba(242,238,228,0.25)'; for (let i = 0; i < 40; i++) x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  };
  return [tex(`wall:${id}:${price}`, 512, 288, draw, false), tex(`wall:${id}:${price}`, 512, 288, draw, true)];
}
export function makeWallBuy(id, name, price, lightHex) {
  const g = new THREE.Group();
  const W = 1.6, H = 0.9;
  const [map, emap] = chalkBoard(id, name, price);
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.06), [
    new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }),
  ]);
  board.position.set(0, 1.55, 0.03); g.add(board);
  // applique lumineuse au-dessus
  const metal = new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.5, metalness: 0.7 });
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), metal); arm.position.set(0, 2.1, 0.17); g.add(arm);
  const shadeM = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 12, 1, true), metal); shadeM.position.set(0, 2.08, 0.34); g.add(shadeM);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 2 })); bulb.position.set(0, 2.03, 0.34); g.add(bulb);
  g.userData.size = [W, 0.15, 2.2];
  return g;
}
// panneau autoportant (si aucun mur à proximité) : deux poteaux
export function addPosts(g) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.5, metalness: 0.7 });
  for (const sx of [-0.7, 0.7]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), metal); p.position.set(sx, 1.05, -0.04); g.add(p); }
}

// ------------------------------------------------------------------ Boîte mystère
function boxSide() {
  const draw = (x, w, h, emis) => {
    if (!emis) {
      for (let i = 0; i < 4; i++) { x.fillStyle = `hsl(24, 32%, ${16 + (i % 2) * 4}%)`; x.fillRect(0, (i * h) / 4, w, h / 4 - 3); x.fillStyle = '#0c0805'; x.fillRect(0, (i * h) / 4 + h / 4 - 3, w, 3); }
      grime(x, w, h, 300, 0.25);
      // ferrures
      x.fillStyle = '#3a3b3e'; x.fillRect(0, 0, w, 22); x.fillRect(0, h - 22, w, 22); x.fillRect(0, 0, 24, h); x.fillRect(w - 24, 0, 24, h);
      rivets(x, 12, 11, w - 12, h - 11, 48);
    }
    // points d'interrogation lumineux
    for (const [px, size] of [[w * 0.25, 120], [w * 0.5, 150], [w * 0.75, 120]]) neonText(x, '?', px, h / 2 + 6, size, '#6ac8ff', emis, 'Georgia, serif');
  };
  return [tex('box', 512, 256, draw, false), tex('box', 512, 256, draw, true)];
}
export function makeMysteryBox() {
  const g = new THREE.Group();
  const W = 1.7, H = 0.72, D = 0.85;
  const [map, emap] = boxSide();
  const side = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.45, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [side, side, wood, wood, side, side]); body.position.y = H / 2 + 0.05; g.add(body);
  for (const sx of [-1, 1]) { const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, D + 0.04), iron); foot.position.set(sx * (W / 2 - 0.12), 0.04, 0); g.add(foot); }
  // couvercle bombé sur charnières
  const lid = new THREE.Group(); lid.position.set(0, H + 0.05, -D / 2); g.add(lid);
  const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 16, 1, false, 0, Math.PI), wood);
  lidMesh.rotation.z = Math.PI / 2; lidMesh.scale.set(1, 1, 0.45); lidMesh.position.set(0, 0, D / 2); lid.add(lidMesh);
  for (const sx of [-0.55, 0, 0.55]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.01, D / 2 + 0.01, 0.07, 16, 1, false, 0, Math.PI), iron); band.rotation.z = Math.PI / 2; band.scale.set(1, 1, 0.45); band.position.set(sx, 0, D / 2); lid.add(band); }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), iron); lock.position.set(0, H - 0.02, D / 2 + 0.03); g.add(lock);
  // faisceau de lumière bleue (repère de loin)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 30, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 15; g.add(beam);
  g.userData.lid = lid;
  g.userData.size = [W, D, H + 0.4];
  return g;
}

// ------------------------------------------------------------------ Pack-a-Punch
function papFront() {
  const draw = (x, w, h, emis) => {
    if (!emis) {
      x.fillStyle = '#2b2a30'; x.fillRect(0, 0, w, h); grime(x, w, h, 700, 0.3);
      for (const [px, py, pw, ph] of [[16, 16, w - 32, 110], [16, h - 130, w - 32, 114]]) { x.fillStyle = '#34333a'; x.fillRect(px, py, pw, ph); rivets(x, px + 14, py + 14, px + pw - 14, py + ph - 14, 56); }
    }
    neonText(x, 'PACK-A-PUNCH', w / 2, 72, 72, '#c060ff', emis);
    // cœur : vortex violet
    const cx = w / 2, cy = h / 2 + 10;
    if (!emis) { x.fillStyle = '#0a0410'; roundRect(x, 70, 150, w - 140, 230, 20); x.fill(); }
    for (let r = 100; r > 4; r -= 6) { x.strokeStyle = `hsla(${280 + (r % 30)}, 90%, ${emis ? 40 + (100 - r) / 2 : 30 + (100 - r) / 3}%, ${emis ? 0.9 : 0.8})`; x.lineWidth = 3; x.beginPath(); x.ellipse(cx, cy, r * 1.6, r * 0.9, r * 0.05, 0, Math.PI * 2); x.stroke(); }
    if (!emis) { x.fillStyle = '#e0e0e0'; x.font = 'bold 30px Impact, Arial'; x.textAlign = 'center'; x.fillText('5000 POINTS', cx, h - 72); }
  };
  return [tex('pap', 768, 512, draw, false), tex('pap', 768, 512, draw, true)];
}
export function makePackAPunch() {
  const g = new THREE.Group();
  const W = 1.9, H = 1.7, D = 1.25;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2a30, roughness: 0.45, metalness: 0.85 });
  const [map, emap] = papFront();
  const front = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.75, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), metal); body.position.y = H / 2; g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.06), front); face.position.set(0, H / 2, D / 2 + 0.005); g.add(face);
  // rouleaux et tuyaux sur le dessus
  const roller = new THREE.MeshStandardMaterial({ color: 0x55525c, roughness: 0.35, metalness: 0.9 });
  for (const z of [-0.3, 0.1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, W - 0.2, 16), roller); r.rotation.z = Math.PI / 2; r.position.set(0, H + 0.12, z); g.add(r); }
  const pipe = new THREE.MeshStandardMaterial({ color: 0x6a3a8a, roughness: 0.4, metalness: 0.7, emissive: 0x3a0a5a, emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 16, Math.PI), pipe); p.position.set(sx * (W / 2 - 0.2), H, -0.2); p.rotation.y = Math.PI / 2; g.add(p); }
  // fente d'introduction de l'arme, fermée par une porte coulissante
  const rim = new THREE.MeshStandardMaterial({ color: 0xb8742a, roughness: 0.4, metalness: 0.9 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x07030c, roughness: 0.6, metalness: 0.3, emissive: 0x2a0850, emissiveIntensity: 0.5 });
  const SY = 0.58;
  const put = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  put(new THREE.BoxGeometry(1.3, 0.3, 0.05), rim, 0, SY, D / 2 + 0.03);
  put(new THREE.BoxGeometry(1.14, 0.2, 0.06), hole, 0, SY, D / 2 + 0.035);
  const slotDoor = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.22, 0.05), metal); slotDoor.position.set(0, SY, D / 2 + 0.07); g.add(slotDoor);
  // engrenages sur les flancs (tournent pendant l'amélioration)
  const gears = [];
  for (const sx of [-1, 1]) {
    const gear = new THREE.Group();
    gear.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 16), rim));
    for (let k = 0; k < 10; k++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.12), rim); const a = (k / 10) * Math.PI * 2; t.position.set(Math.cos(a) * 0.33, 0, Math.sin(a) * 0.33); t.rotation.y = -a; gear.add(t); }
    gear.rotation.z = Math.PI / 2; gear.position.set(sx * (W / 2 + 0.04), H * 0.62, 0.1);
    g.add(gear); gears.push(gear);
  }
  g.userData.rollers = g.children.filter((o) => o.geometry && o.geometry.type === 'CylinderGeometry' && o.position.y > H);
  g.userData.slotDoor = slotDoor; g.userData.slotY = SY; g.userData.gears = gears; g.userData.front = front;
  g.userData.anchor = [0, 1.0, D / 2 + 0.7];
  g.userData.size = [W, D, H + 0.4];
  return g;
}

// ------------------------------------------------------------------ Nounours (la boîte s'en va)
export function makeTeddy() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 1 });
  const light = new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.4 });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  const S = (r) => new THREE.SphereGeometry(r, 12, 10);
  add(S(0.16), fur, 0, 0.18, 0, 1, 1.15, 0.9);            // corps
  add(S(0.08), light, 0, 0.16, 0.12, 1, 1.2, 0.6);        // ventre
  add(S(0.12), fur, 0, 0.42, 0);                          // tête
  add(S(0.05), light, 0, 0.4, 0.1, 1.2, 0.9, 1);          // museau
  add(S(0.018), dark, 0, 0.42, 0.15);                     // truffe
  for (const sx of [-1, 1]) {
    add(S(0.045), fur, sx * 0.09, 0.53, 0);               // oreilles
    add(S(0.016), dark, sx * 0.045, 0.46, 0.105);         // yeux
    add(S(0.06), fur, sx * 0.16, 0.22, 0.04, 0.8, 1.4, 0.8); // bras
    add(S(0.07), fur, sx * 0.09, 0.04, 0.06, 0.9, 0.8, 1.2); // jambes
  }
  return g;
}

// ------------------------------------------------------------------ Horloge astronomique (fin de partie)
function clockFace() {
  const draw = (x, w, h, emis) => {
    const c = w / 2;
    if (!emis) { x.fillStyle = '#2a1f3a'; x.fillRect(0, 0, w, h); }
    x.translate(c, c);
    // cadran : anneau des heures, zodiaque, soleil et lune
    x.fillStyle = emis ? '#3a2a10' : '#1a2a5a'; x.beginPath(); x.arc(0, 0, c * 0.95, 0, 7); x.fill();
    x.strokeStyle = emis ? '#ffcc66' : '#d4a640'; x.lineWidth = 14; x.beginPath(); x.arc(0, 0, c * 0.92, 0, 7); x.stroke();
    x.lineWidth = 6; x.beginPath(); x.arc(0, 0, c * 0.62, 0, 7); x.stroke();
    x.fillStyle = emis ? '#ffd27a' : '#e8c060'; x.font = `bold ${Math.round(c * 0.11)}px Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    R.forEach((t, k) => { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; x.fillText(t, Math.cos(a) * c * 0.78, Math.sin(a) * c * 0.78); });
    const Z = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
    x.font = `${Math.round(c * 0.08)}px serif`;
    Z.forEach((t, k) => { const a = (k / 12) * Math.PI * 2; x.fillText(t, Math.cos(a) * c * 0.48, Math.sin(a) * c * 0.48); });
    x.fillStyle = emis ? '#fff2b0' : '#f0d070'; x.beginPath(); x.arc(c * 0.25, -c * 0.12, c * 0.08, 0, 7); x.fill();
    x.fillStyle = emis ? '#b0c8ff' : '#c8d0e0'; x.beginPath(); x.arc(-c * 0.22, c * 0.15, c * 0.07, 0, 7); x.fill();
    x.strokeStyle = emis ? '#ffcc66' : '#d4a640'; x.lineWidth = 10; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -c * 0.7); x.moveTo(0, 0); x.lineTo(c * 0.45, c * 0.2); x.stroke();
  };
  return [tex('clock', 512, 512, draw, false), tex('clock', 512, 512, draw, true)];
}
export function makeAstronomicalClock() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a7466, roughness: 0.85 });
  const paint = new THREE.MeshStandardMaterial({ color: 0x5a2a2a, roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a640, roughness: 0.3, metalness: 0.9, emissive: 0x2a1a04 });
  const [map, emap] = clockFace();
  const face = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(4.2, 3, 1.8), stone, 0, 1.5, 0);              // socle
  add(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 32), gold, 0, 1.6, 0.92).rotation.x = Math.PI / 2; // globe céleste (cadran bas)
  add(new THREE.BoxGeometry(3.4, 6, 1.4), paint, 0, 6, 0);                // corps peint
  const dial = add(new THREE.CircleGeometry(1.45, 48), face, 0, 6.2, 0.72);
  dial.userData.dial = true;
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.5, 9, 0.5), stone, sx * 1.95, 4.5 + 3, 0.2); // tours latérales
    add(new THREE.ConeGeometry(0.4, 1.8, 8), stone, sx * 1.95, 12.9, 0.2);
  }
  add(new THREE.BoxGeometry(2.6, 3.5, 1.2), paint, 0, 10.75, 0);          // étage des automates
  for (let k = 0; k < 4; k++) add(new THREE.CapsuleGeometry(0.16, 0.6, 3, 6), gold, -0.9 + k * 0.6, 10.6, 0.68); // apôtres
  add(new THREE.ConeGeometry(1.4, 3.2, 4), stone, 0, 14.1, 0).rotation.y = Math.PI / 4; // flèche
  add(new THREE.SphereGeometry(0.25, 10, 8), gold, 0, 15.9, 0);           // coq
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.userData.size = [4.4, 2, 16];
  return g;
}
