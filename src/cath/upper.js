import * as THREE from 'three';
import { NAVE, PILLARS } from './plan2.js';
import { archPoints, TEXV, PORTAL_H } from './ground.js';
import { buildSpire } from './spire.js';

// Étages de la cathédrale : galeries du triforium (14,5 m) et du clair-étage (22,5 m) tout autour de la nef, grande tribune
// de la rose et salle des cloches dans le massif occidental, escaliers en colimaçon (tourelles de la croisée et des tours),
// plateforme à 67,5 m. Chaque étage est une région de `levels` ; les escaliers sont des liens que les zombies empruntent.

export const Y = { R2: 14.5, R3: 22.5, W2: 44, PLAT: 67.5 };
const DEG = Math.PI / 180;

export function buildUpper(ctx) {
  const { scene, plan, collision, lightSources, mats, mesher, levels, ground } = ctx;
  const { P, axis } = plan;
  const W = (s, t) => P(s, t);
  const polar = (c, r, deg) => W(c[0] + Math.cos(deg * DEG) * r, c[1] + Math.sin(deg * DEG) * r);
  const out = { regions: {}, towers: {} };

  const R2 = levels.addRegion('Triforium', Y.R2);
  const R3 = levels.addRegion('Galerie haute', Y.R3);
  const W2 = levels.addRegion('Salle des cloches', Y.W2);
  const PL = levels.addRegion('Plateforme', Y.PLAT);
  out.regions = { R2, R3, W2, PL };

  // ---------------------------------------------------------------- aides
  const circleST = (c, r, n = 28) => [...Array(n).keys()].map((k) => [c[0] + Math.cos((k / n) * Math.PI * 2) * r, c[1] + Math.sin((k / n) * Math.PI * 2) * r]);
  // Dalle d'étage : surface praticable + maillage + plancher qui arrête les balles
  const slab = (region, polyST, y, holesST = [], mat = mats.deck) => {
    const poly = polyST.map(([s, t]) => W(s, t)), holes = holesST.map((h) => h.map(([s, t]) => W(s, t)));
    const tris = levels.addPoly(region, poly, y, holes);
    mesher.flat(mat, poly, y, { holes, uvScale: 4 });
    collision.addFloor(y, tris);
    return tris;
  };
  // Pastille praticable sans plancher plein (palier d'escalier)
  const pad = (region, polyST, y) => {
    const poly = polyST.map(([s, t]) => W(s, t));
    const tris = levels.addPoly(region, poly, y);
    mesher.flat(mats.deck, poly, y, { uvScale: 4 });
    collision.addFloor(y, tris);
  };
  const ironBoxes = [];
  const ironBox = (cx, cy, cz, w, h, d, rotY) => ironBoxes.push({ cx, cy, cz, w, h, d, rotY });
  // Garde-corps : mur de collision + barreaux visibles. closed : relie le dernier point au premier.
  const rail = (ptsST, y, h = 1.15) => {
    const pts = ptsST.map(([s, t]) => W(s, t));
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      collision.addSegment(ax, az, bx, bz, y + h + 0.2, y - 0.2);
      const L = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
      ironBox((ax + bx) / 2, y + h, (az + bz) / 2, 0.07, 0.07, L, rot);       // lisse
      ironBox((ax + bx) / 2, y + h * 0.5, (az + bz) / 2, 0.04, 0.04, L, rot);  // lisse basse
      const n = Math.max(1, Math.round(L / 1.6));
      for (let k = 0; k <= n; k++) ironBox(ax + ((bx - ax) * k) / n, y + h / 2, az + ((bz - az) * k) / n, 0.05, h, 0.05, 0); // montants
    }
  };

  // ---------------------------------------------------------------- escalier en colimaçon
  // c : centre (s, t) ; segs : [{ to, turns }] segments successifs (hauteur d'arrivée, nombre de tours) ; dir : +1 si l'azimut
  // croît en montant ; phi0 : azimut du départ au sol (degrés, 0 = vers +s, 90 = vers +t) ; exits : [{ y, region }] portes de la
  // cage (y = hauteur du palier) ; la cage est ouverte à l'azimut de chaque palier sur 2,6 m de haut.
  const spiral = (o) => {
    const { name, c, rIn, rOut, dir, phi0, segs, exits, y0 = 0, wallMat = mats.plain, capAbove = 1, startRegion = 0 } = o;
    const phiAt = (y) => { // azimut à la hauteur y
      let phi = phi0, ya = y0;
      for (const sg of segs) {
        if (y <= sg.to + 1e-6) return phi + dir * 360 * ((y - ya) / (sg.to - ya)) * sg.turns;
        phi += dir * 360 * sg.turns; ya = sg.to;
      }
      return phi;
    };
    const top = segs[segs.length - 1].to;
    const mid = (rIn + rOut) / 2;
    // région d'escalier par volée (entre deux paliers consécutifs)
    const stops = [y0, ...exits.map((e) => e.y)].sort((a, b) => a - b);
    const stairRegion = new Map();
    const regionOfY = (y) => { for (let i = 0; i + 1 < stops.length; i++) if (y >= stops[i] - 1e-6 && y <= stops[i + 1] + 1e-6) return stairRegion.get(i); return stairRegion.get(stops.length - 2); };
    for (let i = 0; i + 1 < stops.length; i++) stairRegion.set(i, levels.addRegion(`${name} (${stops[i]}-${stops[i + 1]})`, (stops[i] + stops[i + 1]) / 2, 'stair'));
    // marches : visuel en gradins, surface praticable inclinée
    const wedges = [];
    let ya = y0, k0 = 0;
    for (const sg of segs) {
      const n = Math.max(4, Math.round(sg.turns * 24));
      for (let k = 0; k < n; k++) {
        const yA = ya + ((sg.to - ya) * k) / n, yB = ya + ((sg.to - ya) * (k + 1)) / n;
        const pA = phiAt(yA), pB = phiAt(Math.min(yB, sg.to));
        const reg = regionOfY((yA + yB) / 2);
        const q = [[rIn, pA, yA], [rOut, pA, yA], [rOut, pB, yB], [rIn, pB, yB]].map(([r, ph, yy]) => { const [x, z] = polar(c, r, ph); return [x, yy, z]; });
        levels.addQuad(reg, q[0], q[1], q[2], q[3]);
        const yMid = (yA + yB) / 2;
        const shape = new THREE.Shape();
        const pts = [polar(c, rIn, pA), polar(c, rOut, pA), polar(c, rOut, (pA + pB) / 2), polar(c, rOut, pB), polar(c, rIn, pB), polar(c, rIn, (pA + pB) / 2)];
        shape.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false });
        g.rotateX(Math.PI / 2); g.translate(0, yMid, 0);
        wedges.push(g);
        k0++;
      }
      ya = sg.to;
    }
    // vue : toutes les marches en un seul maillage
    mesher.geo(mats.stone, mergeSimple(wedges));
    // noyau central
    {
      const [x, z] = W(c[0], c[1]);
      mesher.geo(mats.stone, new THREE.CylinderGeometry(rIn, rIn, top - y0 + 0.5, 14), new THREE.Matrix4().makeTranslation(x, (top + y0) / 2, z));
      collision.addCircle(x, z, rIn + 0.15, top + 1, y0 - 0.5);
    }
    // cage extérieure en 24 pans, ouverte à l'azimut de chaque palier
    const rw = rOut + 0.25;
    for (let j = 0; j < 24; j++) {
      const a0 = j * 15, a1 = a0 + 15, am = a0 + 7.5;
      const gaps = exits.concat([{ y: y0 }]).filter((e) => { const d = Math.abs((((phiAt(e.y) - am + 540) % 360) + 360) % 360 - 180); return d < 24; }).map((e) => e.y).sort((a, b) => a - b);
      const A = polar(c, rw, a0), B = polar(c, rw, a1);
      let yb = y0 - 0.3;
      const pieces = [];
      for (const g of gaps) { if (g - 0.3 > yb) pieces.push([yb, g - 0.3]); yb = Math.max(yb, g + 2.6); }
      if (top + capAbove > yb) pieces.push([yb, top + capAbove]);
      for (const [p0, p1] of pieces) {
        mesher.strip(wallMat, [A, B], p0, p1, { uScale: 4, vScale: 4 });
        collision.addSegment(A[0], A[1], B[0], B[1], p1, p0);
      }
    }
    // paliers (pastilles devant les portes) et liens
    const links = [];
    const lp = (y) => { const ph = phiAt(y); const [x, z] = polar(c, rOut + 1.1, ph); return [x, y, z]; };
    const helix = (yA, yB) => {
      const pts = [lp(yA)];
      const n = Math.max(6, Math.round(((yB - yA) / (top - y0)) * 90));
      for (let k = 0; k <= n; k++) { const yy = yA + ((yB - yA) * k) / n; const [x, z] = polar(c, mid, phiAt(yy)); pts.push([x, yy, z]); }
      pts.push(lp(yB));
      return pts;
    };
    const stopsAll = [{ y: y0, region: startRegion }, ...exits];
    for (let i = 0; i + 1 < stopsAll.length; i++) {
      const a = stopsAll[i], b = stopsAll[i + 1];
      links.push(levels.addLink(`${name} ${a.y}->${b.y}`, a.region, b.region, helix(a.y, b.y), stairRegion.get(i)));
    }
    // palier : pastille plate de 2,2 x 2,4 m, du seuil de la porte vers l'extérieur
    const padAt = (y, region, extra = []) => {
      const ph = phiAt(y);
      const a = polar(c, rOut - 0.4, ph - 22), b = polar(c, rOut - 0.4, ph + 22), cc = polar(c, rOut + 1.9, ph + 22), d = polar(c, rOut + 1.9, ph - 22);
      const poly = [a, b, cc, d].map(([x, z]) => [x, z]);
      const tris = levels.addPoly(region, poly, y);
      mesher.flat(mats.deck, poly, y, { uvScale: 4 });
      collision.addFloor(y, tris);
    };
    for (const e of exits) padAt(e.y, e.region);
    return { phiAt, links, c, rOut, top, lp };
  };

  // ---------------------------------------------------------------- galeries du triforium (R2) et du clair-étage (R3)
  const NAVE_S0 = NAVE.s0 + 0, NAVE_S1 = NAVE.s1;
  const ringPolys = (y, d0, d1) => [ // [s0, t0, s1, t1] des trois bandes (nord, ouest, sud) ; d0 : mur ; d1 : bord intérieur
    [NAVE_S0, -d0, NAVE_S1, -d1], [NAVE_S0, -d0, NAVE_S0 + 3, d0], [NAVE_S0, d1, NAVE_S1, d0],
  ];
  const stripST = (s0, t0, s1, t1) => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
  const ring = (region, y, tIn) => { // tIn : t du bord intérieur (garde-corps)
    for (const side of [-1, 1]) {
      const ta = side * 9, tb = side * tIn;
      slab(region, stripST(NAVE_S0, Math.min(ta, tb), NAVE_S1, Math.max(ta, tb)), y);
      rail([[NAVE_S0 + 3, tb], [NAVE_S1 + 0.0, tb]], y);
    }
    slab(region, stripST(NAVE_S0, -9, NAVE_S0 + 3, 9), y);
    rail([[NAVE_S0 + 3, -tIn], [NAVE_S0 + 3, tIn]], y);
  };
  ring(R2, Y.R2, 6.0);
  ring(R3, Y.R3, 6.8);

  // ---------------------------------------------------------------- tribune de la rose (W1, région R3) et salle des cloches (W2)
  const HALL = [-46, -23.5, -37, 23.5];
  const NW = { c: [-41.5, -16.5] }, SW = { c: [-41.5, 16.5] }, RO = 3.8, RI = 1.3;
  const hole = (c, r = RO + 0.45) => circleST(c, r);
  slab(R3, stripST(HALL[0], HALL[1], HALL[2], HALL[3]), Y.R3, [hole(NW.c), hole(SW.c)]);
  slab(W2, stripST(HALL[0], HALL[1], HALL[2], HALL[3]), Y.W2, [hole(SW.c)]);
  // murs intérieurs des deux salles
  const hallWalls = (y0, y1, region) => {
    const tv = TEXV.tower;
    const sides = [[[HALL[0], HALL[1]], [HALL[0], HALL[3]]], [[HALL[0], HALL[1]], [HALL[2], HALL[1]]], [[HALL[0], HALL[3]], [HALL[2], HALL[3]]]];
    for (const [a, b] of sides) {
      const A = W(...a), B = W(...b);
      mesher.strip(mats.wall.tower, [A, B], y0, y1, { uScale: 6, vScale: 21.5, vOrigin: 22.5 });
      collision.addSegment(A[0], A[1], B[0], B[1], y1, y0 - 0.3);
    }
  };
  hallWalls(Y.R3, Y.W2, R3);
  hallWalls(Y.W2, Y.PLAT, W2);
  {
    // mur est de la tribune (s = -37) : plein sous le plancher, grand arc brisé ouvert vers la nef au-dessus de 22,5 m
    const A = W(-37, -23.5), B = W(-37, 23.5), L = 47;
    const u0 = 23.5 - 6, u1 = 23.5 + 6;
    ground.vpoly(mats.plain, A, B, [[0, 18], [L, 18], [L, Y.W2], [0, Y.W2]], { uScale: 8, vScale: 8, holes: [archPoints(u0, u1, Y.R3)] });
    collision.addSegment(A[0], A[1], W(-37, -6)[0], W(-37, -6)[1], Y.W2, Y.R3 - 0.3);
    collision.addSegment(W(-37, 6)[0], W(-37, 6)[1], B[0], B[1], Y.W2, Y.R3 - 0.3);
    // salle des cloches : mur est plein
    mesher.strip(mats.wall.tower, [A, B], Y.W2, Y.PLAT, { uScale: 6, vScale: 21.5, vOrigin: 22.5 });
    collision.addSegment(A[0], A[1], B[0], B[1], Y.PLAT, Y.W2 - 0.3);
  }
  // grande rose de la façade, vue de la tribune
  {
    const m = new THREE.Mesh(new THREE.CircleGeometry(6.4, 48), new THREE.MeshStandardMaterial({ map: ctx.roseTex(false), emissiveMap: ctx.roseTex(true), emissive: 0xffffff, emissiveIntensity: 1.4, side: THREE.DoubleSide }));
    const [x, z] = W(-45.9, 0);
    m.position.set(x, 29, z); m.rotation.y = Math.atan2(axis.ux, axis.uz);
    scene.add(m);
  }
  // cloches (décor) dans la salle des cloches
  {
    const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.4, metalness: 0.8 });
    const g = [];
    for (const [s, t, r] of [[-42, 0, 1.5], [-40, -8, 1.1], [-40, 8, 1.1], [-44, -14, 0.9]]) {
      const [x, z] = W(s, t);
      g.push(new THREE.LatheGeometry([[0.25, 0], [r * 0.7, 0.2], [r, 0.2 + r * 0.3], [r * 0.85, 2.6 * r], [r * 0.5, 3.3 * r], [0.12, 3.6 * r]].map(([a, b]) => new THREE.Vector2(a, b)), 14).translate(x, Y.W2 + 4, z));
      g.push(new THREE.BoxGeometry(0.4, 0.4, r * 3).translate(x, Y.W2 + 4 + 3.8 * r, z));
      collision.addCircle(x, z, r * 0.95, Y.W2 + 4 + 3.8 * r, Y.W2 - 0.3);
    }
    mesher.geo(bronze, mergeSimple(g));
  }

  // ---------------------------------------------------------------- escaliers
  // tourelles de la croisée : sol -> triforium (14,5 m) -> galerie haute (22,5 m)
  const piers = [];
  for (const side of [-1, 1]) {
    const c = [31.5, side * 12.5];
    const phiE = side < 0 ? 70 : -70, dir = side < 0 ? 1 : -1;
    const sp = spiral({
      name: side < 0 ? 'Tourelle nord de la croisée' : 'Tourelle sud de la croisée', c, rIn: 0.9, rOut: 3.1, dir,
      phi0: phiE - dir * 225, segs: [{ to: Y.R3, turns: Y.R3 / 4 }], exits: [{ y: Y.R2, region: R2 }, { y: Y.R3, region: R3 }],
    });
    piers.push(sp);
    // passerelle de la galerie jusqu'à la porte de la tourelle (deux niveaux) : enveloppe convexe du bout de la galerie et du seuil
    for (const [region, y, tIn] of [[R2, Y.R2, 6.0], [R3, Y.R3, 6.8]]) {
      const [ex, , ez] = sp.lp(y);
      const e = [plan.S(ex, ez), plan.T(ex, ez)];
      const ph = (sp.phiAt(y) + 90) * DEG, tg = [Math.cos(ph) * 1.1, Math.sin(ph) * 1.1];
      const hull = convexHull([[NAVE_S1 - 0.6, side * 9], [NAVE_S1 - 0.6, side * tIn], [e[0] + tg[0], e[1] + tg[1]], [e[0] - tg[0], e[1] - tg[1]], [e[0], e[1]]]);
      pad(region, hull, y);
    }
  }
  // tourelles des tours de façade : sol -> tribune (22,5 m) [nord] ; sol -> tribune -> salle des cloches -> plateforme [sud]
  const swSp = spiral({
    name: 'Escalier de la tour sud (330 marches)', c: SW.c, rIn: RI, rOut: RO, dir: 1, phi0: -90, wallMat: mats.plain,
    segs: [{ to: Y.R3, turns: 4 }, { to: Y.W2, turns: 5 }, { to: Y.PLAT, turns: 5 }], // tous les paliers s'ouvrent vers le nord (-t)
    exits: [{ y: Y.R3, region: R3 }, { y: Y.W2, region: W2 }, { y: Y.PLAT, region: PL }],
  });
  const nwSp = spiral({
    name: 'Escalier de la tour nord', c: NW.c, rIn: RI, rOut: RO, dir: -1, phi0: 90,
    segs: [{ to: Y.R3, turns: 4 }], exits: [{ y: Y.R3, region: R3 }],
  });
  out.towers.sw = swSp; out.towers.nw = nwSp;

  // ---------------------------------------------------------------- plateforme à 67,5 m
  const TOWER_C = [-39.5, -14], TOWER_R = 9.6;
  const STUB = [-47, 7, -30, 21];
  const platHoles = [hole(SW.c)];
  slab(PL, stripST(-52, -26, -27, 26), Y.PLAT, platHoles, mats.stone);
  // parapet : mur de pierre de 1,2 m autour de la plateforme
  {
    const edges = [[[-52, -26], [-52, 26]], [[-52, -26], [-27, -26]], [[-52, 26], [-27, 26]], [[-27, -26], [-27, 26]]];
    const g = [];
    for (const [a, b] of edges) {
      const A = W(...a), B = W(...b);
      collision.addSegment(A[0], A[1], B[0], B[1], Y.PLAT + 1.3, Y.PLAT - 0.3);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      g.push(new THREE.BoxGeometry(0.5, 1.2, L).rotateY(Math.atan2(B[0] - A[0], B[1] - A[1])).translate((A[0] + B[0]) / 2, Y.PLAT + 0.6, (A[1] + B[1]) / 2));
      // créneaux
      for (let k = 0; k < L / 1.8; k++) { const f = (k * 1.8 + 0.5) / L; g.push(new THREE.BoxGeometry(0.6, 0.45, 0.7).rotateY(Math.atan2(B[0] - A[0], B[1] - A[1])).translate(A[0] + (B[0] - A[0]) * f, Y.PLAT + 1.4, A[1] + (B[1] - A[1]) * f)); }
    }
    mesher.geo(mats.stone, mergeSimple(g));
  }
  // maisonnette de l'escalier (sur la tour sud) : murs, porte vers la plateforme, toit
  {
    const [s0, t0, s1, t1] = STUB, H = 3.6, y = Y.PLAT;
    const wallsST = [[[s0, t0], [s1, t0]], [[s0, t1], [s1, t1]], [[s0, t0], [s0, t1]]];
    for (const [a, b] of wallsST) { const A = W(...a), B = W(...b); mesher.strip(mats.plain, [A, B], y, y + H, { uScale: 8, vScale: 8 }); collision.addSegment(A[0], A[1], B[0], B[1], y + H, y - 0.3); }
    const A = W(s1, t0), B = W(s1, t1), L = t1 - t0, d0 = L / 2 - 1.3, d1 = L / 2 + 1.3;
    const pt = (u, yy) => [A[0] + ((B[0] - A[0]) * u) / L, yy, A[1] + ((B[1] - A[1]) * u) / L];
    // mur est avec porte de 2,6 x 3 m
    mesher.quad(mats.plain, pt(0, y), pt(d0, y), pt(d0, y + H), pt(0, y + H));
    mesher.quad(mats.plain, pt(d1, y), pt(L, y), pt(L, y + H), pt(d1, y + H));
    mesher.quad(mats.plain, pt(d0, y + 3), pt(d1, y + 3), pt(d1, y + H), pt(d0, y + H));
    const m0 = pt(0, 0), m1 = pt(d0, 0), m2 = pt(d1, 0), m3 = pt(L, 0);
    collision.addSegment(m0[0], m0[2], m1[0], m1[2], y + H, y - 0.3); collision.addSegment(m2[0], m2[2], m3[0], m3[2], y + H, y - 0.3);
    // toit en croupe
    const roof = [[s0 - 0.5, t0 - 0.5], [s1 + 0.5, t0 - 0.5], [s1 + 0.5, t1 + 0.5], [s0 - 0.5, t1 + 0.5]].map(([s, t]) => W(s, t));
    const apex = W((s0 + s1) / 2, (t0 + t1) / 2);
    for (let i = 0; i < 4; i++) { const a = roof[i], b = roof[(i + 1) % 4]; mesher.tri(mats.stoneDark, [a[0], y + H, a[1]], [b[0], y + H, b[1]], [apex[0], y + H + 2.2, apex[1]]); }
    mesher.flat(mats.stoneDark, roof, y + H, { up: false });
  }

  // ---------------------------------------------------------------- tour nord et flèche
  out.spire = buildSpire({ scene, collision, lightSources, mats, mesher, levels, W, polar, spiral, slab, pad, rail, circleST, ironBox, Y, regions: { PL } });

  // ---------------------------------------------------------------- balustrades et lumières
  {
    const geo = ironBoxes.map((b) => new THREE.BoxGeometry(b.w, b.h, b.d).rotateY(b.rotY).translate(b.cx, b.cy, b.cz));
    if (geo.length) mesher.geo(mats.iron, mergeSimple(geo));
  }
  for (const [s, t, y, col] of [[-20, 0, 18, 0xffc890], [10, 0, 18, 0xffc890], [-41, 0, 28, 0xffb878], [-41, -14, 30, 0xffb878], [-41, 14, 30, 0xffb878], [-41, 0, 52, 0xffc070], [-35, 0, 56, 0xffc070], [-38, 0, 72, 0xb8c8ff], [-30, 14, 72, 0xb8c8ff]]) {
    const [x, z] = W(s, t);
    lightSources.push({ x, y, z, color: col, intensity: 12, dist: 16 });
  }

  // zones d'apparition par étage
  levels.regions[R2].spawns.push(...[[-30, -7.5], [0, 7.5], [20, -7.5]].map(([s, t]) => W(s, t)));
  levels.regions[R3].spawns.push(...[[-43, -10], [-43, 10], [-30, -8], [-10, 8]].map(([s, t]) => W(s, t)));
  levels.regions[W2].spawns.push(...[[-44, -12], [-44, 12], [-40, 0]].map(([s, t]) => W(s, t)));
  levels.regions[PL].spawns.push(...[[-31, -20], [-31, 20], [-48, 0], [-45, -23]].map(([s, t]) => W(s, t)));
  return out;
}

// Enveloppe convexe (chaîne monotone), points [[x, y], …] -> polygone
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function mergeSimple(list) {
  const pos = [], uv = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
