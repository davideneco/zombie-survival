import * as THREE from 'three';
import { canvasTex } from '../cathedral.js';
import { archPoints, mergeGeos } from './ground.js';

// =====================================================================
//  Façade occidentale de la cathédrale Notre-Dame de Strasbourg :
//  triple portail à voussures sculptées, statues-colonnes, tympans à
//  registres, grands gâbles ajourés à crochets, vantaux rouges latéraux
//  et vantaux de bronze ouverts au centre, résille verticale en « harpe »
//  d'Erwin de Steinbach, quatre contreforts à niches équestres/royales
//  et pinacles, grande rosace à 16 rayons avec écoinçons à rosettes,
//  hautes lancettes de beffroi et galerie des Apôtres.
//
//  Repère local M : x = -t (+x = Nord / gauche, -x = Sud / droite),
//                   y = hauteur, z = s (-z = ouest vers le parvis).
// =====================================================================

function makeFacadeMaterials(mats, roseTex) {
  // Grès rose des Vosges clair (dentelle gothique, gâbles, harpe, pinacles, meneaux de la rosace)
  const sandLightTex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d3aa93';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      c.fillStyle = 'rgba(72,38,26,0.20)';
      c.fillRect(0, y, w, 1.5);
      for (let x = ((y / 22) % 2) * 28; x < w; x += 56) c.fillRect(x, y, 1.5, 22);
    }
    for (let i = 0; i < 1400; i++) {
      const s = (i * 1103515245 + 12345) >>> 0;
      const px = (s % w), py = ((s >>> 8) % h);
      c.fillStyle = (s & 1) ? 'rgba(255,238,220,0.09)' : 'rgba(60,30,20,0.08)';
      c.fillRect(px, py, 2, 2);
    }
  });
  const sandLight = new THREE.MeshStandardMaterial({
    map: sandLightTex, color: 0xebd0be, roughness: 0.86, metalness: 0.02, side: THREE.DoubleSide,
  });

  // Grès rose chaud d'appareil (parement continu masquant les fenêtres OSM génériques sur la façade ouest)
  const sandWall = new THREE.MeshStandardMaterial({
    map: sandLightTex, color: 0xb98d78, roughness: 0.90, metalness: 0.02, side: THREE.DoubleSide,
  });

  // Pierre claire sculptée (statues-colonnes, bas-reliefs des tympans, Vierge du gâble, statues royales)
  const statueStone = new THREE.MeshStandardMaterial({
    color: 0xe2cab6, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide,
  });

  // Vantaux en bois rouge des portails Nord et Sud (signature visuelle de la façade)
  const redDoorTex = canvasTex(256, 512, (c, w, h) => {
    c.fillStyle = '#a33a2f';
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 24) {
      c.fillStyle = 'rgba(40,10,8,0.24)';
      c.fillRect(x, 0, 2, h);
    }
    c.strokeStyle = '#651e18';
    c.lineWidth = 8;
    c.strokeRect(10, 12, w / 2 - 16, h - 24);
    c.strokeRect(w / 2 + 6, 12, w / 2 - 16, h - 24);
    c.strokeStyle = '#bc4f43';
    c.lineWidth = 4;
    for (const bx of [22, w / 2 + 18]) {
      for (const [py, ph] of [[28, 120], [168, 160], [348, 136]]) {
        c.strokeRect(bx, py, w / 2 - 40, ph);
      }
    }
    c.fillStyle = '#2a2220';
    for (const y of [80, 240, 410]) {
      c.fillRect(10, y, w / 2 - 42, 7);
      c.fillRect(w / 2 + 32, y, w / 2 - 42, 7);
    }
    c.fillStyle = '#5a1b16';
    c.fillRect(w / 2 - 5, 0, 10, h);
  });
  const redDoor = new THREE.MeshStandardMaterial({
    map: redDoorTex, roughness: 0.78, metalness: 0.05, side: THREE.DoubleSide,
  });

  // Vantaux monumentaux en bronze patiné du grand portail central (repliés ouverts sur les joues)
  const bronzeDoorTex = canvasTex(256, 512, (c, w, h) => {
    c.fillStyle = '#6f6d57';
    c.fillRect(0, 0, w, h);
    const cols = 4, rows = 8, cw = (w - 24) / cols, ch = (h - 24) / rows;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const px = 12 + k * cw, py = 12 + r * ch;
      c.fillStyle = ((r + k) % 2) ? '#7a7860' : '#65644e';
      c.fillRect(px + 3, py + 3, cw - 6, ch - 6);
      c.strokeStyle = '#474638';
      c.lineWidth = 3;
      c.strokeRect(px + 3, py + 3, cw - 6, ch - 6);
      c.strokeStyle = '#8e8d72';
      c.lineWidth = 1.5;
      c.strokeRect(px + 7, py + 7, cw - 14, ch - 14);
    }
    c.strokeStyle = '#3f3e31';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
  });
  const bronzeDoor = new THREE.MeshStandardMaterial({
    map: bronzeDoorTex, roughness: 0.48, metalness: 0.52, side: THREE.DoubleSide,
  });

  // Ombre architecturale profonde uniquement pour les grandes baies ouvertes des beffrois
  const voidDark = new THREE.MeshStandardMaterial({
    color: 0x201614, roughness: 0.96, side: THREE.DoubleSide,
  });

  // Vitrail extérieur de la grande rosace (verre ancien profond vu de l'extérieur le jour, lueur douce la nuit)
  const roseGlass = new THREE.MeshStandardMaterial({
    map: roseTex(false),
    color: 0x5c5358,
    emissiveMap: roseTex(true),
    emissive: 0xffd8b0,
    emissiveIntensity: 0.24,
    roughness: 0.38,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });

  // Verre chaud des lanternes de façade
  const lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffd27a });

  return {
    sandLight,
    sandWall,
    sandMid: mats.stone,
    sandDeep: mats.stoneDark,
    statueStone,
    redDoor,
    bronzeDoor,
    voidDark,
    roseGlass,
    iron: mats.iron,
    gold: mats.gold,
    lanternGlow,
  };
}

// Arc brisé à flèche paramétrable (lancette élancée ou arc gothique large)
function lancetPts(x0, x1, y0, rise, n = 8) {
  const cx = (x0 + x1) / 2;
  const pts = [];
  for (let i = 0; i <= n * 2; i++) {
    const u = i / (n * 2);
    const s = u <= 0.5 ? u * 2 : (1 - u) * 2;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + rise * Math.pow(Math.sin(s * Math.PI * 0.5), 0.78);
    pts.push([x, y]);
  }
  pts[0] = [x0, y0];
  pts[pts.length - 1] = [x1, y0];
  pts[n] = [cx, y0 + rise];
  return pts;
}

export function buildWestFacade(ctx) {
  const { plan, collision, lightSources, mats, mesher, roseTex } = ctx;
  const { P, axis } = plan;
  const W = (s, t) => P(s, t);
  const hw = plan.portal.hw; // 2.7 m (largeur libre jouable du grand portail central)

  const theta = Math.atan2(axis.ux, axis.uz);
  const M = new THREE.Matrix4()
    .makeTranslation(axis.cx, 0, axis.cz)
    .multiply(new THREE.Matrix4().makeRotationY(theta));

  const fm = makeFacadeMaterials(mats, roseTex);
  const B = {
    light: [],
    wall: [],
    mid: [],
    deep: [],
    statue: [],
    redDoor: [],
    bronze: [],
    dark: [],
    iron: [],
    gold: [],
    glow: [],
    rose: [],
  };

  const push = (arr, g, x, y, z, rx = 0, ry = 0, rz = 0) => {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    arr.push(g.translate(x, y, z));
  };
  const box = (arr, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
    push(arr, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cyl = (arr, rt, rb, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) =>
    push(arr, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);
  const cone = (arr, r, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) =>
    push(arr, new THREE.ConeGeometry(r, h, seg), x, y, z, rx, ry, rz);

  // Segment d'arc brisé (série de claveaux/nervures + figurines sculptées en niche dans les voussures)
  const addArchStrip = (arr, pts, thick, depth, z, opts = {}) => {
    const { statuettes = false, statArr = B.statue, zFront = z - depth / 2 } = opts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const segL = Math.hypot(x1 - x0, y1 - y0) + 0.06;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      box(arr, segL, thick, depth, mx, my, z, 0, 0, ang);
      if (statuettes && i > 0 && i < pts.length - 2) {
        // Niche sombre + statuette sculptée + minuscule dais pointu (effet alvéoles des voussures)
        box(B.deep, 0.24, 0.42, 0.14, mx, my, zFront + 0.02, 0, 0, ang * 0.25);
        box(statArr, 0.15, 0.34, 0.15, mx, my - 0.02, zFront - 0.07, 0, 0, ang * 0.25);
        cone(B.light, 0.11, 0.20, 4, mx, my + 0.19, zFront - 0.08, 0, Math.PI / 4, ang * 0.25);
      }
    }
  };

  // Statue-colonne gothique (socle, corps drapé, tête, dais/baldachin pointu)
  const addStatue = (x, y, z, h = 2.6, w = 0.42) => {
    box(B.deep, w * 1.25, 0.28, w * 1.25, x, y + 0.14, z);
    cyl(B.statue, w * 0.34, w * 0.42, h * 0.74, 5, x, y + 0.28 + h * 0.37, z);
    box(B.statue, w * 0.72, h * 0.26, w * 0.45, x, y + 0.28 + h * 0.56, z - w * 0.08);
    push(B.statue, new THREE.OctahedronGeometry(w * 0.28, 0), x, y + 0.28 + h * 0.82, z - 0.02);
    box(B.light, w * 1.15, 0.22, w * 1.15, x, y + h + 0.14, z - 0.04);
    cone(B.light, w * 0.78, 0.85, 4, x, y + h + 0.68, z - 0.04, 0, Math.PI / 4, 0);
  };

  // Pinacle gothique effilé à crochets
  const addPinnacle = (x, yBase, z, w = 0.55, hShaft = 2.4, hSpire = 2.8) => {
    box(B.light, w, hShaft, w, x, yBase + hShaft / 2, z);
    box(B.deep, w * 1.18, 0.22, w * 1.18, x, yBase + hShaft, z);
    cone(B.light, w * 0.72, hSpire, 4, x, yBase + hShaft + hSpire / 2, z, 0, Math.PI / 4, 0);
    for (let k = 1; k <= 3; k++) {
      const f = k / 4, r = w * 0.65 * (1 - f);
      const yy = yBase + hShaft + hSpire * f;
      for (const sx of [-1, 1]) box(B.light, 0.14, 0.22, 0.14, x + sx * (r + 0.06), yy, z - 0.04, 0, 0, -sx * 0.4);
    }
    push(B.light, new THREE.OctahedronGeometry(w * 0.22, 0), x, yBase + hShaft + hSpire + 0.14, z);
  };

  // Rosette / oculus circulaire en pierre ajourée (gâbles latéraux, écoinçons de la grande rosace)
  const addRosette = (cx, cy, z, r, spokes = 8, thick = 0.09, depth = 0.28, backArr = B.deep) => {
    const segs = spokes * 2;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2, segL = 2 * r * Math.sin(Math.PI / segs) + 0.04;
      box(B.light, segL, thick * 1.35, depth, cx + Math.cos(am) * r, cy + Math.sin(am) * r, z, 0, 0, am + Math.PI / 2);
    }
    cyl(B.light, r * 0.24, r * 0.24, depth * 0.9, 8, cx, cy, z, Math.PI / 2);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      box(B.light, r * 1.88, thick * 0.78, depth * 0.85, cx, cy, z, 0, 0, a);
    }
    if (backArr) cyl(backArr, r * 0.94, r * 0.94, 0.08, 14, cx, cy, z + depth * 0.52, Math.PI / 2);
  };

  // Gâble triangulaire gothique à crochets, fleuron et remplage de lancettes
  // backdropY0 permet de ne mettre un fond d'ombre que dans la POINTE du gâble (au-dessus des voussures du portail) !
  const addGable = (cx, yBase, halfW, yPeak, z, opts = {}) => {
    const {
      crockets = 8,
      depth = 0.44,
      slopeThick = 0.40,
      rosetteY = null,
      rosetteR = 1.15,
      lancets = 0,
      lancetY0 = yBase + 1.2,
      backdropY0 = null, // null = aucun fond plein (portails ouverts sur leurs voussures)
      backdropMat = B.deep,
      finialH = 1.8,
    } = opts;
    const rise = yPeak - yBase;
    const ang = Math.atan2(rise, halfW);
    const slope = Math.hypot(halfW, rise);

    // Fond de pierre ombrée uniquement au-dessus de backdropY0 (ne masque JAMAIS les voussures ni les tympans !)
    if (backdropY0 != null && backdropY0 < yPeak - 0.5) {
      const bRise = yPeak - backdropY0;
      const rows = 5;
      for (let i = 0; i < rows; i++) {
        const f = (i + 0.5) / rows;
        const yy = backdropY0 + f * bRise;
        const fracFromPeak = (yPeak - yy) / rise;
        const wRow = Math.max(0.25, halfW * 2 * fracFromPeak - 0.36);
        box(backdropMat, wRow, bRise / rows + 0.06, 0.14, cx, yy, z + depth * 0.48);
      }
    }
    // Rampants moulurés + crochets gothiques
    for (const side of [-1, 1]) {
      box(B.light, slope + 0.25, slopeThick, depth, cx + side * halfW * 0.5, yBase + rise * 0.5, z, 0, 0, -side * ang);
      box(B.deep, slope + 0.15, slopeThick * 0.42, depth + 0.12, cx + side * halfW * 0.5, yBase + rise * 0.5 + slopeThick * 0.44, z, 0, 0, -side * ang);
      for (let k = 1; k <= crockets; k++) {
        const u = k / (crockets + 1);
        const px = cx + side * halfW * (1 - u);
        const py = yBase + u * rise + slopeThick * 0.72;
        box(B.light, 0.22, 0.44, 0.30, px, py, z - 0.04, 0, 0, -side * 0.38);
      }
    }
    // Fleuron sommital
    cyl(B.light, 0.14, 0.26, finialH, 6, cx, yPeak + finialH * 0.5, z);
    cone(B.light, 0.28, 0.72, 4, cx, yPeak + finialH + 0.25, z, 0, Math.PI / 4, 0);
    // Remplage de lancettes verticales ajourées
    if (lancets > 0) {
      for (let k = 0; k < lancets; k++) {
        const u = (k + 0.5) / lancets;
        const lx = cx - halfW * 0.76 + u * halfW * 1.52;
        const topY = yPeak - Math.abs(lx - cx) * (rise / halfW) - 0.55;
        if (topY > lancetY0 + 0.5) {
          const lh = topY - lancetY0;
          box(B.light, 0.11, lh, 0.22, lx, lancetY0 + lh / 2, z + 0.04);
        }
      }
    }
    if (rosetteY != null) {
      addRosette(cx, rosetteY, z - 0.02, rosetteR, 8, 0.10, 0.28, B.deep);
    }
  };

  // Résille verticale en « harpe » (meneaux élancés détachés devant le mur + arcature brisée sommitale)
  const addHarpScreen = (x0, x1, y0, y1, z, spacing = 0.68, archH = 1.45, depth = 0.22) => {
    const w = x1 - x0;
    const count = Math.max(2, Math.round(w / spacing));
    const dx = w / count;
    const ySpring = y1 - archH;
    const hCol = Math.max(0.2, ySpring - y0);
    for (let i = 0; i <= count; i++) {
      const mx = x0 + i * dx;
      box(B.light, 0.12, hCol, depth, mx, y0 + hCol / 2, z);
      box(B.deep, 0.18, 0.14, depth + 0.06, mx, ySpring, z);
      if (i < count) {
        const pts = lancetPts(mx, mx + dx, ySpring, archH, 3);
        addArchStrip(B.light, pts, 0.12, depth, z);
      }
    }
  };

  // ===================================================================
  //  PAREMENT CONTINU EN GRÈS ROSE DES TRAVÉES (masque toute fenêtre OSM générique)
  // ===================================================================
  // Travée centrale au-dessus du grand portail (y = 11..21.8 et y = 36.8..43.8)
  box(B.wall, 13.4, 11.0, 0.24, 0, 16.4, -48.55);
  box(B.wall, 13.4, 7.2, 0.24, 0, 40.3, -48.55);
  // Travées latérales au-dessus des portails Nord/Sud (y = 9.5..21.8 et pourtour des baies hautes)
  for (const side of [-1, 1]) {
    box(B.wall, 9.4, 12.6, 0.24, side * 14.6, 15.6, -48.55);
    box(B.wall, 9.4, 3.0, 0.24, side * 14.6, 42.4, -48.55);
    for (const sgn of [-1, 1]) {
      box(B.wall, 1.35, 21.2, 0.24, side * 14.6 + sgn * 4.15, 33.2, -48.55);
    }
  }

  // ===================================================================
  //  A. GRAND PORTAIL CENTRAL (x = 0, passage jouable libre |x| <= 2.7)
  // ===================================================================
  {
    const sOut = -50.65, sIn = -45.6, sInUp = -46.02;
    const depth = sIn - sOut, sMid = (sOut + sIn) / 2;
    const depthUp = sInUp - sOut, sMidUp = (sOut + sInUp) / 2;

    // 1. Perron progressif à 3 degrés doux (y <= 0.14, sous WALK_OVER = 0.30)
    box(B.deep, hw * 2 + 2.8, 0.14, depth + 1.0, 0, 0.07, sMid);
    box(B.mid, hw * 2 + 4.4, 0.10, 1.1, 0, 0.05, sOut - 0.55);
    box(B.light, hw * 2 + 5.8, 0.06, 0.9, 0, 0.03, sOut - 1.35);

    // 2. Cadre étanche intérieur vers le narthex (reculé à z = -48.45..-45.6 pour dégager les voussures !)
    const inDepth = sIn - (-48.45), inMid = (sIn + (-48.45)) / 2;
    box(B.deep, hw * 2 + 0.5, 0.34, inDepth + 0.3, 0, 5.52, inMid);
    box(B.mid, hw * 2 + 1.0, 0.28, 0.36, 0, 5.54, sIn + 0.06);

    // 3. Joues ébrasées + 5 ressauts à statues-colonnes + vantaux de bronze repliés ouverts + grilles en fer forgé
    const jambOrders = [
      { t: hw + 0.38, z: -48.35 },
      { t: hw + 0.92, z: -48.92 },
      { t: hw + 1.46, z: -49.48 },
      { t: hw + 2.00, z: -50.02 },
      { t: hw + 2.54, z: -50.52 },
    ];
    for (const side of [-1, 1]) {
      // Collision dégagée à la largeur libre du portail (±hw = ±2.7 m)
      const [ax, az] = W(sOut - 0.4, side * hw), [bx, bz] = W(sIn, side * hw);
      collision.addSegment(ax, az, bx, bz, 12, -0.5);

      // Parement intérieur étanche reliant l'ébrasement au narthex (reculé derrière la 1ère statue-colonne)
      box(B.deep, 0.44, 5.6, inDepth + 0.35, side * (hw + 0.22), 2.8, inMid);
      box(B.mid, 0.32, 5.65, 0.38, side * (hw + 0.18), 2.82, sIn + 0.06);
      if (side < 0) box(B.deep, 0.46, 5.6, 0.52, -(hw - 0.15), 2.8, -45.82);

      // Vantail monumental en bronze patiné replié ouvert le long de la joue intérieure (laisse ±2.55 m 100 % libre)
      box(B.bronze, 0.12, 5.32, 2.35, side * (hw - 0.08), 2.68, -47.50, 0, side * 0.05, 0);
      box(B.gold, 0.06, 0.24, 0.24, side * (hw - 0.16), 2.15, -48.35);

      // Soubassement mouluré de l'ébrasement (banc de pierre)
      box(B.deep, 3.0, 1.15, 2.9, side * (hw + 1.55), 0.575, -49.25);
      box(B.light, 3.12, 0.18, 3.0, side * (hw + 1.55), 1.20, -49.25);
      // Corniche d'imposte au sommet des dais
      box(B.deep, 3.15, 0.24, 3.05, side * (hw + 1.55), 5.44, -49.25);

      // 5 statues-colonnes sous dais gothiques + colonnettes fines en arrière-plan
      for (const jo of jambOrders) {
        box(B.deep, 0.44, 4.2, 0.52, side * (jo.t + 0.20), 3.3, jo.z + 0.24);
        cyl(B.mid, 0.09, 0.10, 4.15, 6, side * (jo.t - 0.16), 3.32, jo.z + 0.12);
        addStatue(side * jo.t, 1.28, jo.z, 2.95, 0.44);
      }

      // Grilles basses en fer forgé du parvis (flanquent le perron sans bloquer l'entrée centrale)
      const gX0 = side * (hw + 0.35), gX1 = side * 6.25, gZ = sOut - 0.42;
      box(B.iron, Math.abs(gX1 - gX0), 0.07, 0.07, (gX0 + gX1) / 2, 1.18, gZ);
      box(B.iron, Math.abs(gX1 - gX0), 0.07, 0.07, (gX0 + gX1) / 2, 0.25, gZ);
      for (let k = 0; k <= 12; k++) {
        const px = gX0 + (gX1 - gX0) * (k / 12);
        box(B.iron, 0.045, 1.22, 0.045, px, 0.65, gZ);
      }

      // Lanternes en fer forgé sur les piédroits extérieurs
      const lx = side * (hw + 2.82), ly = 4.45, lz = sOut - 0.32;
      box(B.iron, 0.10, 0.10, 0.65, lx, ly + 0.28, lz);
      cyl(B.iron, 0.18, 0.14, 0.38, 6, lx, ly, lz - 0.24);
      cone(B.deep, 0.24, 0.24, 6, lx, ly + 0.28, lz - 0.24);
      cyl(B.glow, 0.13, 0.10, 0.26, 6, lx, ly, lz - 0.24);
      const [wx, wz] = W(sOut - 1.0, -side * (hw + 1.2));
      lightSources.push({ x: wx, y: 4.1, z: wz, color: 0xffb86c, intensity: 18, dist: 18 });
    }

    // 4. 5 rangs de voussures gothiques en arc brisé garnies de figurines sculptées en niche (PLEINEMENT VISIBLES !)
    const archRings = [
      { tw: hw + 0.16, thick: 0.44, z0: -48.55, z1: sInUp, mat: B.mid, stat: false },
      { tw: hw + 0.72, thick: 0.46, z0: -49.10, z1: -48.46, mat: B.light, stat: true },
      { tw: hw + 1.28, thick: 0.46, z0: -49.64, z1: -49.00, mat: B.mid, stat: true },
      { tw: hw + 1.86, thick: 0.46, z0: -50.18, z1: -49.54, mat: B.light, stat: true },
      { tw: hw + 2.46, thick: 0.48, z0: -50.72, z1: -50.08, mat: B.mid, stat: true },
    ];
    for (const ar of archRings) {
      const lenA = ar.z1 - ar.z0, zAvg = (ar.z0 + ar.z1) / 2;
      const ptsA = archPoints(-ar.tw, ar.tw, 5.45, 10);
      addArchStrip(ar.mat, ptsA, ar.thick, lenA, zAvg, { statuettes: ar.stat, zFront: ar.z0 });
    }

    // 5. Linteau et Tympan sculpté à 4 registres horizontaux de la Passion (étanche jusqu'au narthex sInUp = -46.02)
    box(B.deep, hw * 2 + 0.6, 0.44, inDepth + 0.18, 0, 5.65, inMid);
    box(B.light, hw * 2 + 0.35, 0.20, 0.42, 0, 5.92, -48.52);
    const tympY0 = 5.95, tympH = 4.35;
    const tympDepth = sInUp - (-48.55), tympMid = (sInUp + (-48.55)) / 2;
    for (let r = 0; r < 4; r++) {
      const f = r / 4;
      const yRow = tympY0 + f * (tympH * 0.90);
      const rowH = tympH * 0.22;
      const wRow = hw * 2 * Math.max(0.24, 1 - f * 0.76);
      // Fond plein du tympan jusqu'au narthex (pierre chaude)
      box(B.wall, wRow + 0.35, rowH + 0.12, tympDepth, 0, yRow + rowH / 2, tympMid);
      // Cordon horizontal mouluré séparant les registres
      box(B.deep, wRow + 0.42, 0.12, 0.32, 0, yRow, -48.55);
      // Frise serrée de figurines sculptées en haut-relief (Passion du Christ)
      const nFigs = Math.max(3, Math.floor(wRow / 0.34));
      for (let k = 0; k < nFigs; k++) {
        const fx = -wRow * 0.46 + (k + 0.5) * (wRow * 0.92 / nFigs);
        box(B.statue, 0.18, rowH * 0.72, 0.22, fx, yRow + rowH * 0.45, -48.66);
        box(B.statue, 0.13, 0.14, 0.18, fx, yRow + rowH * 0.88, -48.68);
      }
    }
    // Groupe central du tympan (Crucifixion / Christ au sommet) + pont d'étanchéité reculé derrière le tympan
    box(B.statue, 0.22, 1.5, 0.28, 0, 9.25, -48.68);
    box(B.statue, 0.92, 0.22, 0.26, 0, 9.55, -48.68);
    box(B.wall, hw * 2 + 0.6, 1.6, tympDepth, 0, 10.5, tympMid);

    // 6. Grand Gâble central (Wimperg) élancé montant jusqu'à y = 21.0 m (SANS fond noir sur les voussures !)
    addGable(0, 6.0, 5.75, 21.0, -50.85, {
      crockets: 13,
      depth: 0.52,
      slopeThick: 0.46,
      lancets: 7,
      lancetY0: 14.2,
      backdropY0: 14.8,
      backdropMat: B.deep,
      finialH: 1.9,
    });
    // Niche sculptée centrale dans la pointe du gâble : Vierge à l'Enfant & Trône de Salomon sous dais pointu
    box(B.deep, 1.35, 3.8, 0.56, 0, 15.8, -50.82);
    addStatue(0, 14.1, -51.02, 2.40, 0.52);
    addStatue(0, 17.3, -50.98, 1.85, 0.40);
    // Petits gâbles latéraux aigus encadrant le grand portail entre les voussures et les contreforts internes
    for (const side of [-1, 1]) {
      addGable(side * 5.95, 6.2, 0.95, 14.8, -50.55, {
        crockets: 6, depth: 0.38, slopeThick: 0.28, lancets: 2, lancetY0: 7.2, backdropY0: 7.0, backdropMat: B.deep, finialH: 1.4,
      });
      // Résille verticale en « harpe » de part et d'autre du grand gâble jusqu'à la galerie y = 21.8
      const xA = side < 0 ? -6.55 : 2.1, xB = side < 0 ? -2.1 : 6.55;
      addHarpScreen(xA, xB, 11.2, 21.65, -49.55, 0.66, 1.55, 0.22);
    }
  }

  // ===================================================================
  //  B. PORTAILS LATÉRAUX NORD (+14.6) ET SUD (-14.6) À VANTAUX ROUGES
  // ===================================================================
  for (const side of [-1, 1]) {
    const cx = side * 14.6;
    const zDoor = -48.62;
    const zOuter = -50.55;
    const doorHW = 1.62;

    // Perron à 2 marches en pierre
    box(B.deep, 7.6, 0.22, 1.5, cx, 0.11, -49.25);
    box(B.light, 8.2, 0.11, 0.9, cx, 0.055, -50.35);

    // Grands vantaux en bois rouge peint
    box(B.redDoor, doorHW * 2, 5.38, 0.22, cx, 2.75, zDoor);
    box(B.deep, doorHW * 2 + 0.5, 0.42, 0.48, cx, 5.56, zDoor - 0.12);
    box(B.light, 0.24, 5.4, 0.28, cx, 2.75, zDoor - 0.10);

    // 4 ressauts ébrasés + statues-colonnes
    const sOrders = [
      { d: doorHW + 0.34, z: -48.88 },
      { d: doorHW + 0.86, z: -49.40 },
      { d: doorHW + 1.38, z: -49.92 },
      { d: doorHW + 1.90, z: -50.42 },
    ];
    for (const sgn of [-1, 1]) {
      box(B.deep, 2.4, 1.12, 2.3, cx + sgn * (doorHW + 1.2), 0.56, -49.55);
      box(B.light, 2.5, 0.16, 2.4, cx + sgn * (doorHW + 1.2), 1.18, -49.55);
      box(B.deep, 2.5, 0.22, 2.4, cx + sgn * (doorHW + 1.2), 5.45, -49.55);
      for (const so of sOrders) {
        box(B.deep, 0.38, 4.18, 0.46, cx + sgn * (so.d + 0.16), 3.3, so.z + 0.20);
        addStatue(cx + sgn * so.d, 1.26, so.z, 2.85, 0.40);
      }
    }

    // 4 rangs de voussures en arc brisé à figurines sculptées (PLEINEMENT VISIBLES !)
    const sideRings = [
      { tw: doorHW + 0.22, thick: 0.38, z0: -49.05, z1: -48.55, mat: B.light, stat: true },
      { tw: doorHW + 0.74, thick: 0.40, z0: -49.55, z1: -49.00, mat: B.mid, stat: true },
      { tw: doorHW + 1.28, thick: 0.42, z0: -50.08, z1: -49.50, mat: B.light, stat: true },
      { tw: doorHW + 1.82, thick: 0.44, z0: -50.60, z1: -50.02, mat: B.mid, stat: true },
    ];
    for (const ar of sideRings) {
      const ptsA = archPoints(cx - ar.tw, cx + ar.tw, 5.45, 8);
      addArchStrip(ar.mat, ptsA, ar.thick, ar.z1 - ar.z0, (ar.z0 + ar.z1) / 2, { statuettes: ar.stat, zFront: ar.z0 });
    }

    // Tympan sculpté à 3 registres au-dessus des vantaux rouges
    for (let r = 0; r < 3; r++) {
      const f = r / 3;
      const yRow = 5.82 + f * 2.55;
      const rowH = 0.80;
      const wRow = doorHW * 2 * Math.max(0.28, 1 - f * 0.72);
      box(B.wall, wRow + 0.25, rowH + 0.08, 0.38, cx, yRow + rowH / 2, zDoor - 0.12);
      box(B.deep, wRow + 0.32, 0.10, 0.32, cx, yRow, zDoor - 0.24);
      const nFigs = Math.max(3, Math.floor(wRow / 0.36));
      for (let k = 0; k < nFigs; k++) {
        const fx = cx - wRow * 0.45 + (k + 0.5) * (wRow * 0.90 / nFigs);
        box(B.statue, 0.16, rowH * 0.72, 0.20, fx, yRow + rowH * 0.44, zDoor - 0.32);
        box(B.statue, 0.12, 0.13, 0.16, fx, yRow + rowH * 0.85, zDoor - 0.33);
      }
    }

    // Grand gâble latéral élancé à crochets + rosette circulaire ajourée (fond d'ombre UNIQUEMENT au-dessus des voussures !)
    addGable(cx, 6.0, 3.85, 16.5, zOuter - 0.15, {
      crockets: 10,
      depth: 0.46,
      slopeThick: 0.40,
      rosetteY: 12.6,
      rosetteR: 1.18,
      backdropY0: 11.2,
      backdropMat: B.deep,
      finialH: 1.6,
    });

    // Petits gâbles aigus latéraux flanquant chaque portail
    for (const sgn of [-1, 1]) {
      addGable(cx + sgn * 3.95, 6.2, 0.78, 13.4, zOuter + 0.05, {
        crockets: 5, depth: 0.34, slopeThick: 0.24, lancets: 2, lancetY0: 7.0, backdropY0: 7.0, backdropMat: B.deep, finialH: 1.2,
      });
    }

    // Résille verticale en « harpe » derrière/au-dessus du gâble latéral jusqu'à la galerie y = 21.8 m
    addHarpScreen(cx - 4.35, cx + 4.35, 10.6, 21.65, -49.55, 0.65, 1.55, 0.22);

    const [lx, lz] = W(-51.4, -cx);
    lightSources.push({ x: lx, y: 4.5, z: lz, color: 0xffb878, intensity: 14, dist: 16 });
  }

  // ===================================================================
  //  C. ÉTAGE INTERMÉDIAIRE (y = 22..44) : GRANDE ROSACE & BEFFROIS
  // ===================================================================
  {
    const rCx = 0, rCy = 29.8, rGlass = 6.28, rRim = 6.45;
    const zBack = -48.55, zGlass = -48.68, zTracery = -49.04;

    // Cadre carré profond entourant la rosace
    box(B.deep, 13.3, 13.9, 0.22, rCx, rCy, zBack);
    box(B.light, 13.4, 0.55, 0.95, rCx, rCy + 6.95, zTracery - 0.15);
    box(B.light, 13.4, 0.45, 0.85, rCx, rCy - 6.95, zTracery - 0.10);
    for (const side of [-1, 1]) {
      box(B.light, 0.55, 14.1, 0.95, side * 6.55, rCy, zTracery - 0.15);
    }

    // Disque de vitrail de la grande rosace (verre profond à l'extérieur)
    push(B.rose, new THREE.CircleGeometry(rGlass, 48), rCx, rCy, zGlass, 0, Math.PI, 0);

    // Anneau extérieur mouluré + 3 anneaux concentriques + 16 rayons + 32 pétales en pierre sculptée
    const outerSegs = 48;
    for (let i = 0; i < outerSegs; i++) {
      const a0 = (i / outerSegs) * Math.PI * 2, a1 = ((i + 1) / outerSegs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const segL = 2 * rRim * Math.sin(Math.PI / outerSegs) + 0.08;
      box(B.light, segL, 0.48, 0.68, rCx + Math.cos(am) * rRim, rCy + Math.sin(am) * rRim, zTracery, 0, 0, am + Math.PI / 2);
      box(B.deep, segL, 0.24, 0.45, rCx + Math.cos(am) * (rRim - 0.34), rCy + Math.sin(am) * (rRim - 0.34), zTracery + 0.08, 0, 0, am + Math.PI / 2);
    }
    for (const [rad, th, dp, nSeg] of [[1.05, 0.26, 0.44, 16], [3.55, 0.24, 0.40, 32], [5.38, 0.20, 0.36, 32]]) {
      for (let i = 0; i < nSeg; i++) {
        const a0 = (i / nSeg) * Math.PI * 2, a1 = ((i + 1) / nSeg) * Math.PI * 2, am = (a0 + a1) / 2;
        const segL = 2 * rad * Math.sin(Math.PI / nSeg) + 0.04;
        box(B.light, segL, th, dp, rCx + Math.cos(am) * rad, rCy + Math.sin(am) * rad, zTracery, 0, 0, am + Math.PI / 2);
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const len = rRim - 1.0, rm = 1.0 + len / 2;
      box(B.light, len, 0.20, 0.38, rCx + Math.cos(a) * rm, rCy + Math.sin(a) * rm, zTracery, 0, 0, a);
      // 16 pétales brisés en chevrons dans l'anneau médian + 16 demi-rayons extérieurs (dentelle de grès fidèle)
      const aMid = ((k + 0.5) / 16) * Math.PI * 2;
      const lenOut = rRim - 3.55, rmOut = 3.55 + lenOut / 2;
      box(B.light, lenOut, 0.14, 0.30, rCx + Math.cos(aMid) * rmOut, rCy + Math.sin(aMid) * rmOut, zTracery + 0.02, 0, 0, aMid);
      // petits trèfles / médaillons de pierre dans la couronne extérieure
      const rDot = 5.88;
      cyl(B.light, 0.32, 0.32, 0.26, 6, rCx + Math.cos(aMid) * rDot, rCy + Math.sin(aMid) * rDot, zTracery + 0.02, Math.PI / 2);
      cyl(B.deep, 0.17, 0.17, 0.30, 6, rCx + Math.cos(aMid) * rDot, rCy + Math.sin(aMid) * rDot, zTracery + 0.02, Math.PI / 2);
    }
    cyl(B.light, 0.46, 0.46, 0.48, 12, rCx, rCy, zTracery, Math.PI / 2);

    // 4 écoinçons sculptés à rosettes ajourées dans les 4 coins du cadre carré
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      addRosette(rCx + sx * 5.15, rCy + sy * 5.25, zTracery - 0.06, 1.24, 8, 0.09, 0.32, B.deep);
    }

    // Arcature gothique en harpe au-dessus du cadre de la grande rosace (y = 37.0..43.6)
    addHarpScreen(-6.45, 6.45, 37.0, 43.6, -49.25, 0.72, 1.55, 0.24);

    const [rx, rz] = W(-53.5, 0);
    lightSources.push({ x: rx, y: 24.5, z: rz, color: 0xffc48c, intensity: 18, dist: 24 });

    // 2. GRANDES BAIES EN LANCETTES DES BEFFROIS NORD ET SUD (x = ±14.6, y = 22.8..42.4)
    for (const side of [-1, 1]) {
      const bx = side * 14.6;
      const bw = 7.4, y0 = 22.8, ySpring = 36.8, rise = 4.8;
      box(B.dark, bw, ySpring - y0 + rise * 0.72, 0.24, bx, y0 + (ySpring - y0 + rise * 0.72) / 2, -48.58);
      for (let k = 0; k < 3; k++) {
        const hwB = bw / 2 + k * 0.36;
        const zA = -48.78 - k * 0.28;
        const ptsB = lancetPts(bx - hwB, bx + hwB, ySpring, rise + k * 0.38, 8);
        addArchStrip(k % 2 ? B.deep : B.light, ptsB, 0.36, 0.38, zA);
        for (const sgn of [-1, 1]) {
          box(k % 2 ? B.deep : B.light, 0.34, ySpring - y0, 0.38, bx + sgn * hwB, (y0 + ySpring) / 2, zA);
        }
      }
      for (let m = 1; m <= 3; m++) {
        const mx = bx - bw / 2 + (m / 4) * bw;
        box(B.light, m === 2 ? 0.24 : 0.16, ySpring - y0 + 2.4, 0.32, mx, (y0 + ySpring + 2.4) / 2, -48.95);
      }
      for (const ty of [27.5, 32.5, 36.8]) {
        box(B.deep, bw, 0.18, 0.28, bx, ty, -48.92);
      }
      for (const sgn of [-1, 1]) {
        const sx0 = bx + (sgn < 0 ? -bw / 2 : 0), sx1 = bx + (sgn < 0 ? 0 : bw / 2);
        addArchStrip(B.light, lancetPts(sx0, sx1, ySpring - 0.8, 2.8, 5), 0.18, 0.30, -49.02);
      }
      addRosette(bx, ySpring + 2.55, -49.06, 1.15, 8, 0.08, 0.26, B.dark);
      addHarpScreen(bx - 4.4, bx + 4.4, 41.2, 43.65, -49.45, 0.72, 1.1, 0.20);
    }
  }

  // ===================================================================
  //  D. QUATRE CONTREFORTS MASSIFS (x = +20.75, +8.25, -8.30, -20.75)
  //     Face ouest OSM à z = -51.9 -> parement continu en grès + sculpture
  // ===================================================================
  const buttresses = [
    { x: 20.75, w: 3.3, outer: true },
    { x: 8.25, w: 3.3, outer: false },
    { x: -8.30, w: 3.4, outer: false },
    { x: -20.75, w: 3.3, outer: true },
  ];
  for (const bt of buttresses) {
    const bx = bt.x, bw = bt.w, zF = -52.16;

    // Parement continu de grès rose sur toute la face ouest du contrefort (couvre 100 % du shader OSM)
    box(B.wall, bw + 0.14, 66.0, 0.20, bx, 33.0, -52.06);

    // 1. Soubassement mouluré (y = 0..1.5)
    box(B.deep, bw + 0.36, 1.35, 0.55, bx, 0.675, zF - 0.08);
    box(B.light, bw + 0.44, 0.20, 0.62, bx, 1.42, zF - 0.10);

    // 2. Rez-de-chaussée (y = 1.5..15.8) : double lancette aveugle en pierre ombrée (PAS de noir) + gâble + pinacles
    box(B.deep, bw - 0.68, 8.8, 0.16, bx, 5.9, zF + 0.02);
    addHarpScreen(bx - bw / 2 + 0.32, bx + bw / 2 - 0.32, 1.6, 10.6, zF - 0.12, 0.64, 1.75, 0.24);
    addGable(bx, 9.6, bw * 0.46, 15.6, zF - 0.24, {
      crockets: 6, depth: 0.36, slopeThick: 0.30, lancets: 3, lancetY0: 10.6, backdropY0: 10.4, backdropMat: B.deep, finialH: 1.5,
    });
    for (const sgn of [-1, 1]) {
      box(B.light, 0.26, 21.6, 0.34, bx + sgn * (bw / 2 + 0.04), 10.8, zF - 0.10);
      addPinnacle(bx + sgn * (bw / 2 - 0.18), 15.4, zF - 0.24, 0.48, 2.2, 2.5);
    }
    addHarpScreen(bx - bw / 2 + 0.22, bx + bw / 2 - 0.22, 15.4, 21.7, zF - 0.12, 0.62, 1.35, 0.22);

    // 3. Étage intermédiaire (y = 22.2..43.6) : niches sculptées à statues équestres / royales sous dais pinaclé
    box(B.deep, bw * 0.72, 7.6, 0.46, bx, 26.6, zF + 0.02);
    box(B.dark, bw * 0.56, 6.2, 0.22, bx, 26.4, zF - 0.06);
    box(B.light, 1.35, 1.35, 0.78, bx, 23.4, zF - 0.28);
    box(B.statue, 0.72, 1.15, 1.05, bx, 24.75, zF - 0.28);
    addStatue(bx, 25.15, zF - 0.30, 2.85, 0.56);
    addGable(bx, 28.6, bw * 0.44, 33.4, zF - 0.28, {
      crockets: 5, depth: 0.38, slopeThick: 0.28, lancets: 2, lancetY0: 29.4, backdropY0: 29.0, backdropMat: B.deep, finialH: 1.6,
    });
    addHarpScreen(bx - bw / 2 + 0.25, bx + bw / 2 - 0.25, 33.5, 43.6, zF - 0.12, 0.65, 1.65, 0.22);
    for (const sgn of [-1, 1]) {
      box(B.light, 0.28, 21.8, 0.36, bx + sgn * (bw / 2 + 0.04), 32.9, zF - 0.10);
      addPinnacle(bx + sgn * (bw / 2 - 0.2), 43.8, zF - 0.22, 0.58, 2.8, 3.4);
    }
    addPinnacle(bx, 43.8, zF - 0.20, 0.82, 3.6, 4.4);

    // 4. Niveau supérieur des tours (y = 44..66)
    addHarpScreen(bx - bw / 2 + 0.28, bx + bw / 2 - 0.28, 46.8, 65.8, zF - 0.08, 0.78, 2.0, 0.22);
    addPinnacle(bx, 66.2, zF - 0.18, 0.88, 3.4, 4.8);

    // 5. Flancs internes/externes des contreforts (habillage continu en grès + colonnettes)
    for (const fSide of [-1, 1]) {
      const fx = bx + fSide * (bw / 2 + 0.08);
      box(B.wall, 0.16, 66.0, 3.5, fx - fSide * 0.04, 33.0, -50.35);
      for (let k = 0; k < 4; k++) {
        const fz = -49.0 - k * 0.82;
        box(B.light, 0.14, 20.6, 0.14, fx, 11.2, fz);
        box(B.light, 0.14, 21.0, 0.14, fx, 33.0, fz);
      }
      box(B.deep, 0.22, 0.32, 3.4, fx, 21.85, -50.35);
      box(B.deep, 0.22, 0.32, 3.4, fx, 43.85, -50.35);
    }
  }

  // ===================================================================
  //  E. GALERIES HORIZONTALES AJOURÉES (y = 21.8, y = 43.8, y = 66.0)
  //     ET CONTREFORTS D'ANGLE EXTÉRIEURS (x = ±24.2)
  // ===================================================================
  for (const [xA, xB, zG] of [
    [-22.6, -19.0, -52.28], [-19.0, -9.9, -49.65], [-9.9, -6.5, -52.28],
    [-6.5, 6.6, -49.65], [6.6, 10.0, -52.28], [10.0, 19.1, -49.65], [19.1, 22.6, -52.28],
  ]) {
    const w = xB - xA, xm = (xA + xB) / 2;
    box(B.deep, w + 0.18, 0.42, 0.62, xm, 21.78, zG);
    box(B.light, w + 0.24, 0.20, 0.68, xm, 22.06, zG - 0.04);
    box(B.light, w + 0.16, 0.18, 0.28, xm, 23.08, zG - 0.08);
    const nBal = Math.max(3, Math.round(w / 0.55));
    for (let i = 0; i <= nBal; i++) {
      box(B.light, 0.09, 0.92, 0.16, xA + (i / nBal) * w, 22.58, zG - 0.08);
    }
  }

  for (const [xA, xB, zG] of [
    [-22.6, -19.0, -52.28], [-19.0, -9.9, -49.55], [-9.9, -6.5, -52.28],
    [-6.5, 6.6, -49.55], [6.6, 10.0, -52.28], [10.0, 19.1, -49.55], [19.1, 22.6, -52.28],
  ]) {
    const w = xB - xA, xm = (xA + xB) / 2;
    box(B.deep, w + 0.22, 0.52, 0.72, xm, 43.80, zG);
    box(B.light, w + 0.28, 0.24, 0.78, xm, 44.14, zG - 0.05);
    addHarpScreen(xA + 0.15, xB - 0.15, 44.2, 47.1, zG - 0.10, 0.75, 0.95, 0.22);
    box(B.light, w + 0.24, 0.28, 0.52, xm, 47.22, zG - 0.06);
  }
  for (let a = 0; a < 12; a++) {
    const ax = -5.7 + (a + 0.5) * (11.4 / 12);
    cyl(B.statue, 0.14, 0.17, 1.85, 5, ax, 45.2, -49.68);
    push(B.statue, new THREE.OctahedronGeometry(0.15, 0), ax, 46.28, -49.68);
  }
  for (const [xA, xB] of [[-18.8, -10.1], [-6.3, 6.4], [10.2, 18.9]]) {
    box(B.dark, xB - xA - 0.6, 15.8, 0.18, (xA + xB) / 2, 56.0, -48.55);
    addHarpScreen(xA, xB, 47.4, 65.5, -49.15, 0.85, 2.2, 0.24);
    box(B.light, xB - xA + 0.4, 0.65, 0.68, (xA + xB) / 2, 66.2, -49.35);
  }

  // Flancs extérieurs Nord et Sud (x = ±24.2) : grès ombré au lieu de noir
  for (const side of [-1, 1]) {
    const ex = side * 24.15;
    box(B.wall, 3.2, 44.0, 0.20, ex, 22.0, -48.62);
    box(B.deep, 2.8, 9.6, 0.18, ex, 6.2, -48.78);
    addHarpScreen(ex - 1.45, ex + 1.45, 1.5, 11.4, -49.05, 0.72, 1.8, 0.24);
    addGable(ex, 10.6, 1.55, 16.4, -49.25, {
      crockets: 6, depth: 0.38, slopeThick: 0.30, rosetteY: 13.8, rosetteR: 0.62, backdropY0: 11.2, backdropMat: B.deep, finialH: 1.5,
    });
    addPinnacle(ex + side * 1.55, 11.5, -49.35, 0.54, 3.2, 3.8);
    addHarpScreen(ex - 1.45, ex + 1.45, 22.4, 43.4, -48.95, 0.78, 1.8, 0.22);
  }

  // ===================================================================
  //  Fusion dans le Mesher partagé
  // ===================================================================
  const flush = (mat, arr) => {
    if (arr.length) mesher.geo(mat, mergeGeos(arr), M);
  };
  flush(fm.sandLight, B.light);
  flush(fm.sandWall, B.wall);
  flush(fm.sandMid, B.mid);
  flush(fm.sandDeep, B.deep);
  flush(fm.statueStone, B.statue);
  flush(fm.redDoor, B.redDoor);
  flush(fm.bronzeDoor, B.bronze);
  flush(fm.voidDark, B.dark);
  flush(fm.iron, B.iron);
  flush(fm.gold, B.gold);
  flush(fm.lanternGlow, B.glow);
  flush(fm.roseGlass, B.rose);
}
