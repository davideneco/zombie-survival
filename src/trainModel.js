import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  SNCF TGV Euroduplex / Duplex 2N2 (Carmillon / TGV inOui, v0.97.0) : geometry and materials, no game state.
//  Full 10-vehicle double-decker consist (2 Motrices + 8 Remorques Duplex, 177.76 m total, 3.48 m wide, 4.38 m high):
//    0: M1     (Lead Motrice, 18.20 m, walkable engine-room corridor + elevated Euroduplex driver's cockpit, transparent windscreen)
//    1..3: R1..R3 (1re Classe Duplex, 17.20 m, walkable Lower & Upper saloons, 2+1 carmine/plum seats, bay tables & lamps, 2 staircases)
//    4: R4     (Voiture Bar Duplex "Le Bistro", 17.20 m, Lower service passage + Upper Deck Le Bistro counter, vitrine, espresso, mange-debout)
//    5..8: R5..R8 (2nde Classe Duplex, 17.20 m, walkable Lower & Upper saloons, 2+2 teal/slate seats, tablettes, 2 staircases)
//    9: M2     (Tail Motrice, 18.20 m, mirrored 180°, walkable rear driver's cockpit + engine-room corridor, red tail markers)
//  Vehicle-local axes : X = w (right of travel), Y = height above rail head, Z = -u (+u forward).
//  carLayouts() is pure (no Three.js) : walkable interior geometry and collision boxes shared with train.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ interior layout (car-local u, w ; heights above rail head)
function mirrorLayout(Q) {
  const m = (v) => -v;
  return {
    ...Q, kind: Q.kind + 'T', mirrored: true,
    doors: Q.doors.map(m),
    win: Q.win.map((q) => ({ ...q, u: -q.u, side: q.side ? -q.side : 0 })),
    winUpper: (Q.winUpper || []).map((q) => ({ ...q, u: -q.u, side: q.side ? -q.side : 0 })),
    legroom: Q.legroom.map((q) => ({ ...q, u: -q.u })),
    seats: Q.seats.map((s) => ({ ...s, u: -s.u, dir: -s.dir, w: -s.w })),
    seatsUpper: (Q.seatsUpper || []).map((s) => ({ ...s, u: -s.u, dir: -s.dir, w: -s.w })),
    tables: (Q.tables || []).map((t) => ({ ...t, u: -t.u, w0: -t.w1, w1: -t.w0 })),
    tablesUpper: (Q.tablesUpper || []).map((t) => ({ ...t, u: -t.u, w0: -t.w1, w1: -t.w0 })),
    blocks: Q.blocks.map((b) => ({ u0: -b.u1, u1: -b.u0, w0: -b.w1, w1: -b.w0 })),
    blocksUpper: (Q.blocksUpper || []).map((b) => ({ u0: -b.u1, u1: -b.u0, w0: -b.w1, w1: -b.w0 })),
    parts: Q.parts.map(m),
    zones: Q.zones.map((z) => [-z[0], -z[1], -z[2]]),
    openEnds: Q.openEnds.map(m),
    saloon: [-Q.saloon[1], -Q.saloon[0]],
    cab: Q.cab ? { ...Q.cab, u: -Q.cab.u, dir: -Q.cab.dir } : null,
    ledU: Q.ledU.map(m),
  };
}

export function carLayouts() {
  const T = CONFIG.train, W = T.walk, F0 = T.floor, F1 = T.floorHigh, FL = T.floorLow ?? 0.36, FU = T.floorUpper ?? 2.26, wall = W.wall;
  const winW = 1.44, [winY0, winY1] = T.winY, [winYU0, winYU1] = T.winYUpper || [2.92, 3.68];

  // M1 / M2 : walkable power cars with engine-room service corridor (u in [-9.1, 2.05], w in [-0.58, 0.58]) + elevated driver's cockpit (u in [2.95, 5.65], w in [-1.28, 1.28])
  const makeMotrice = (len) => {
    const h = len / 2, Q = {
      kind: 'motrice', geoKind: 'motrice', walkable: true, duplex: false, mirrored: false,
      len, h, doors: [], win: [], winUpper: [], legroom: [{ u: 0 }], seats: [], seatsUpper: [], tables: [], tablesUpper: [],
      blocks: [], blocksUpper: [], parts: [], zones: [], openEnds: [-h], ledU: [-5.5, -2.0, 1.0, 4.2],
      saloon: [-8.6, 5.65],
      cab: { u: 2.05, dir: 1, open: true, y: 1.06, text: 'Cabine de conduite — TGV Euroduplex' },
    };
    // Engine-room service corridor walls (leaves a 1.16 m central glazed corridor w in [-0.58, +0.58] from rear gangway to cab door)
    Q.blocks.push({ u0: -h + 0.35, u1: 2.10, w0: -wall, w1: -0.58 });
    Q.blocks.push({ u0: -h + 0.35, u1: 2.10, w0: 0.58, w1: wall });
    // Tapered cockpit side consoles (leaves w in [-1.24, +1.24] inside the driver's cab)
    Q.blocks.push({ u0: 2.85, u1: 5.75, w0: -wall, w1: -1.24 });
    Q.blocks.push({ u0: 2.85, u1: 5.75, w0: 1.24, w1: wall });
    // Central driver's armchair block (walkable around both sides of the seat!)
    Q.blocks.push({ u0: 4.15, u1: 4.65, w0: -0.26, w1: 0.26 });
    // Wrap-around Euroduplex front control desk & nose cone boundary
    Q.blocks.push({ u0: 5.68, u1: h + 0.6, w0: -wall - 0.2, w1: wall + 0.2 });
    return Q;
  };

  // Shared Duplex coach base (17.20 m, h = 8.60 m, 2 plug doors per side at +-6.35, 2 staircases at |u| in [3.75, 5.55] on w < -0.14, lower passage on w > -0.06)
  const initDuplex = (kind, len, nBay, bay, bayU0) => {
    const h = len / 2, Q = {
      kind, geoKind: kind, walkable: true, duplex: true, mirrored: false,
      len, h, doors: [-6.35, 6.35], win: [], winUpper: [], legroom: [],
      seats: [], seatsUpper: [], tables: [], tablesUpper: [],
      blocks: [], blocksUpper: [], parts: [-5.58, 5.58], zones: [], openEnds: [-h, h],
      ledU: [-6.35, 6.35], saloon: [-3.75, 3.75], bay, bayU0, nBay, cab: null,
    };
    // Lower/vestibule blocks:
    // 1. Stairwell glass/steel divider wall at w in [-0.14, -0.06] separating left stairs (w in [-1.62, -0.14]) from right lower ramp (w in [-0.06, +1.62])
    for (const sDir of [-1, 1]) {
      const u0 = sDir > 0 ? 3.70 : -5.52, u1 = sDir > 0 ? 5.52 : -3.70;
      Q.blocks.push({ u0, u1, w0: -0.15, w1: -0.05 });
      // Under-stair soffit bulkhead at |u| in [3.58, 3.74], w in [-wall, -0.14] so lower-deck players don't walk under the stairs from the lower saloon
      const us0 = sDir > 0 ? 3.58 : -3.74, us1 = sDir > 0 ? 3.74 : -3.58;
      Q.blocks.push({ u0: us0, u1: us1, w0: -wall, w1: -0.14 });
      // Vestibule luggage/service modules near the gangways (|u| in [7.25, 8.15])
      const ul0 = sDir > 0 ? 7.25 : -8.15, ul1 = sDir > 0 ? 8.15 : -7.25;
      Q.blocks.push({ u0: ul0, u1: ul1, w0: -wall, w1: -0.82 });
      Q.blocks.push({ u0: ul0, u1: ul1, w0: 0.82, w1: wall });
    }
    // Upper-deck blocks:
    // At |u| > 4.15 on the upper deck, w > -0.14 is blocked by the stairwell balustrade, leaving a >0.77 m landing before the first seat row.
    // And at |u| > 5.58 on the upper deck, the end bulkhead closes the stairwell above the vestibule.
    for (const sDir of [-1, 1]) {
      const u0 = sDir > 0 ? 4.15 : -h - 0.5, u1 = sDir > 0 ? h + 0.5 : -4.15;
      Q.blocksUpper.push({ u0, u1, w0: -0.14, w1: wall + 0.2 });
      const ue0 = sDir > 0 ? 5.60 : -h - 0.5, ue1 = sDir > 0 ? h + 0.5 : -5.60;
      Q.blocksUpper.push({ u0: ue0, u1: ue1, w0: -wall - 0.2, w1: wall + 0.2 });
    }
    return Q;
  };

  // R1..R3 : 1re Classe Duplex (17.20 m, 3 spacious bays @ 2.16 m on BOTH Lower and Upper decks, 2+1 carmine/plum seating, wide 1.24 m aisle)
  const makeR1 = (len) => {
    const bay = 2.16, u0 = -3.24, Q = initDuplex('coachR1', len, 3, bay, u0);
    for (let b = 0; b < 3; b++) {
      const a = u0 + b * bay, uc = a + bay / 2;
      Q.win.push({ u: uc, dy: 0, side: 0 });
      Q.winUpper.push({ u: uc, dy: 0, side: 0 });
      Q.legroom.push({ u: uc });
      Q.ledU.push(uc);
      const carre = b !== 1;
      for (const upper of [false, true]) {
        const seats = upper ? Q.seatsUpper : Q.seats;
        const tables = upper ? Q.tablesUpper : Q.tables;
        const blocks = upper ? Q.blocksUpper : Q.blocks;
        const fy = upper ? FU : FL;
        if (carre) {
          for (const [ub, dir] of [[a + 0.30, 1], [a + bay - 0.30, -1]]) {
            seats.push({ u: ub, dir, w: -1.16, width: 0.56, arm: 1 });
            seats.push({ u: ub, dir, w: 0.88, width: 0.44, arm: -1 });
            seats.push({ u: ub, dir, w: 1.36, width: 0.44, arm: 0 });
            const lo = Math.min(ub - dir * 0.14, ub + dir * 0.44), hi = Math.max(ub - dir * 0.14, ub + dir * 0.44);
            blocks.push({ u0: lo, u1: hi, w0: -wall, w1: -0.66 });
            blocks.push({ u0: lo, u1: hi, w0: 0.58, w1: wall });
          }
          tables.push({ u: uc, w0: -1.56, w1: -0.82, y: fy + 0.72, len: 0.48, lamp: -1.42 });
          tables.push({ u: uc, w0: 0.72, w1: 1.56, y: fy + 0.72, len: 0.48, lamp: 1.42 });
          blocks.push({ u0: uc - 0.24, u1: uc + 0.24, w0: -wall, w1: -0.78 });
          blocks.push({ u0: uc - 0.24, u1: uc + 0.24, w0: 0.68, w1: wall });
        } else {
          for (const ub of [a + 0.36, a + 1.52]) {
            seats.push({ u: ub, dir: 1, w: -1.16, width: 0.56, arm: 1, tablette: true });
            seats.push({ u: ub, dir: 1, w: 0.88, width: 0.44, arm: -1, tablette: true });
            seats.push({ u: ub, dir: 1, w: 1.36, width: 0.44, arm: 0, tablette: true });
            blocks.push({ u0: ub - 0.14, u1: ub + 0.42, w0: -wall, w1: -0.66 });
            blocks.push({ u0: ub - 0.14, u1: ub + 0.42, w0: 0.58, w1: wall });
          }
        }
      }
    }
    return Q;
  };

  // R4 : Voiture Bar Duplex "Le Bistro" (17.20 m : Lower deck service/lounge passage + Upper deck Le Bistro bar counter & mange-debout)
  const makeR2 = (len) => {
    const bay = 2.36, u0 = -3.54, Q = initDuplex('coachR2', len, 3, bay, u0);
    Q.bar = { u0: -2.45, u1: 2.45, mangeU: [-2.20, 0.00, 2.20], lowerU: [-2.20, 0.00, 2.20] };
    // Lower deck : 3 breakable windows on +w, technical catering bay on -w (w in [-wall, -0.62]), standing perches on +w (w in [0.88, wall])
    for (const u of Q.bar.lowerU) {
      Q.win.push({ u, dy: 0, side: 1 });
      Q.legroom.push({ u });
      Q.ledU.push(u);
      Q.blocks.push({ u0: u - 0.55, u1: u + 0.55, w0: 0.88, w1: wall });
    }
    Q.blocks.push({ u0: -3.20, u1: 3.20, w0: -wall, w1: -0.62 });
    // Upper deck : panoramic windows on both sides at ends and +w along the bar, Le Bistro counter on -w (w in [-wall, -0.38]), mange-debout on +w (w in [0.84, wall])
    for (const u of [-2.36, 0.00, 2.36]) {
      Q.winUpper.push({ u, dy: 0, side: 1 });
      if (Math.abs(u) > 2.0) Q.winUpper.push({ u, dy: 0, side: -1 });
    }
    Q.blocksUpper.push({ u0: -2.45, u1: 2.45, w0: -wall, w1: -0.38 });
    for (const ut of Q.bar.mangeU) {
      Q.blocksUpper.push({ u0: ut - 0.62, u1: ut + 0.62, w0: 0.84, w1: wall });
    }
    return Q;
  };

  // R5..R8 : 2nde Classe Duplex (17.20 m, 4 bays @ 1.62 m on BOTH Lower and Upper decks, 2+2 teal/slate seating, wide 1.16 m central aisle)
  const makeR3 = (len) => {
    const bay = 1.62, u0 = -3.24, Q = initDuplex('coachR3', len, 4, bay, u0);
    for (let b = 0; b < 4; b++) {
      const a = u0 + b * bay, uc = a + bay / 2;
      Q.win.push({ u: uc, dy: 0, side: 0 });
      Q.winUpper.push({ u: uc, dy: 0, side: 0 });
      Q.legroom.push({ u: uc });
      Q.ledU.push(uc);
      const carre = b === 1 || b === 2;
      for (const upper of [false, true]) {
        const seats = upper ? Q.seatsUpper : Q.seats;
        const tables = upper ? Q.tablesUpper : Q.tables;
        const blocks = upper ? Q.blocksUpper : Q.blocks;
        const fy = upper ? FU : FL;
        if (carre) {
          for (const [ub, dir] of [[a + 0.16, 1], [a + bay - 0.16, -1]]) {
            for (const sd of [-1, 1]) {
              seats.push({ u: ub, dir, w: sd * 0.86, width: 0.42, arm: -sd });
              seats.push({ u: ub, dir, w: sd * 1.34, width: 0.42, arm: 0 });
              const lo = Math.min(ub - dir * 0.12, ub + dir * 0.38), hi = Math.max(ub - dir * 0.12, ub + dir * 0.38);
              blocks.push({ u0: lo, u1: hi, w0: sd > 0 ? 0.58 : -wall, w1: sd > 0 ? wall : -0.58 });
            }
          }
          for (const sd of [-1, 1]) {
            tables.push({ u: uc, w0: sd > 0 ? 0.72 : -1.56, w1: sd > 0 ? 1.56 : -0.72, y: fy + 0.72, len: 0.38, lamp: 0 });
            blocks.push({ u0: uc - 0.18, u1: uc + 0.18, w0: sd > 0 ? 0.72 : -wall, w1: sd > 0 ? wall : -0.72 });
          }
        } else {
          for (const ub of [a + 0.22, a + 1.10]) {
            for (const sd of [-1, 1]) {
              seats.push({ u: ub, dir: 1, w: sd * 0.86, width: 0.42, arm: -sd, tablette: true });
              seats.push({ u: ub, dir: 1, w: sd * 1.34, width: 0.42, arm: 0, tablette: true });
              blocks.push({ u0: ub - 0.12, u1: ub + 0.38, w0: sd > 0 ? 0.58 : -wall, w1: sd > 0 ? wall : -0.58 });
            }
          }
        }
      }
    }
    return Q;
  };

  const motrice = makeMotrice(T.cars[0]);
  const coachR1 = makeR1(T.cars[1]);
  const coachR2 = makeR2(T.cars[4] || T.cars[2]);
  const coachR3 = makeR3(T.cars[5] || T.cars[3]);
  const motriceTail = mirrorLayout(makeMotrice(T.cars[T.cars.length - 1]));

  const byKind = { motrice, coachR1, coachR2, coachR3 };
  const cars = T.cars.map((len, i) => {
    if (i === 0) return motrice;
    if (i === T.cars.length - 1) return motriceTail;
    const k = T.kinds?.[i];
    return byKind[k] || coachR3;
  });
  return { motrice, coachR1, coachR2, coachR3, cars, winW, winY0, winY1, winYU0, winYU1, F0, F1, FL, FU };
}

// floor height (above rail head) at (u, w, relY) of a car :
//  - motrice : gangway (0.94 m) -> engine corridor (1.06 m) -> steps (1.06..1.24 m) -> driver's cockpit (1.24 m)
//  - duplex coach : gangways (0.94 m) -> vestibule (0.80 m) -> left staircase (0.80..2.26 m) / right lower ramp (0.80..0.36 m) -> Lower Saloon (0.36 m) or Upper Saloon (2.26 m)
export function floorOfCar(Q, u, w = 0, relY = null) {
  const T = CONFIG.train;
  if (Q.kind === 'motrice' || Q.kind === 'motriceT') {
    const um = Q.mirrored ? -u : u;
    if (um < -7.5) return T.floorHigh + clamp((um + 9.1) / 1.6, 0, 1) * (1.06 - T.floorHigh);
    if (um < 2.05) return 1.06;
    if (um < 2.95) return 1.06 + ((um - 2.05) / 0.90) * (1.24 - 1.06);
    return 1.24;
  }
  if (Q.duplex) {
    const a = Math.abs(u), F0 = T.floor, F1 = T.floorHigh, FL = T.floorLow ?? 0.36, FU = T.floorUpper ?? 2.26;
    if (a >= 7.15) return F1;
    if (a > 6.70) return F0 + ((a - 6.70) / 0.45) * (F1 - F0);
    if (a >= 5.55) return F0;
    if (a >= 3.75) {
      const t = (5.55 - a) / 1.80; // 0 at vestibule (5.55), 1 at saloon (3.75)
      const onStairs = w < -0.10 || (relY != null && relY > 1.35);
      if (onStairs) return F0 + t * (FU - F0);
      return F0 + Math.min(1, t * 1.6) * (FL - F0);
    }
    return (relY != null && relY > 1.35) ? FU : FL;
  }
  let t = 0;
  for (const z of Q.zones) {
    const d = z[1] - z[0], k = d !== 0 ? (u - z[0]) / d : 0;
    if (k <= 0) continue;
    if ((z[2] - z[0]) * (u - z[2]) > 0) continue;
    t = Math.max(t, Math.min(1, k));
  }
  return T.floor + (T.floorHigh - T.floor) * t;
}

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// body atlas 1024 x 1024 (y 0.30..4.05 for Duplex double-decker side bands)
export const ATLAS = {
  sideMotrice: [0, 180, 0.30, 4.05],
  sideR1:      [180, 360, 0.30, 4.05],
  sideR2:      [360, 540, 0.30, 4.05],
  sideR3:      [540, 720, 0.30, 4.05],
  logos: {
    sncf: [0, 720, 240, 816],
    tgv:  [240, 720, 640, 816],
    num1: [640, 720, 736, 816],
    num2: [736, 720, 832, 816],
    bar:  [832, 720, 1024, 816],
  },
  roof: [816, 920],
  door: [920, 1024],
};

function bodyTex() {
  return canvasTex(1024, 1024, (x, W) => {
    const drawSideBand = (region, kind) => {
      const [r0, r1, y0m, y1m] = region, H = r1 - r0, py = (y) => r0 + (1 - clamp((y - y0m) / (y1m - y0m), 0, 1)) * H;
      // Metallic silver-grey aluminum TGV Euroduplex skin
      const g = x.createLinearGradient(0, r0, 0, r1);
      g.addColorStop(0, '#c6cacf'); g.addColorStop(0.50, '#b5b9be'); g.addColorStop(1, '#8c9196');
      x.fillStyle = g; x.fillRect(0, r0, W, H);

      // Dark anthracite solebar skirt (y 0.30..0.86)
      x.fillStyle = '#25292e'; x.fillRect(0, py(0.86), W, r1 - py(0.86));

      const carm = x.createLinearGradient(0, r0, W, r1);
      carm.addColorStop(0, '#b81d5b'); carm.addColorStop(1, '#7a1b54');

      if (kind === 'motrice') {
        // Motrice upper equipment band & louvers
        x.fillStyle = '#24282d'; x.fillRect(0, py(3.45), W, py(1.85) - py(3.45));
        // Diagonal Carmillon flash behind cab door
        x.fillStyle = carm;
        x.beginPath(); x.moveTo(600, r1); x.lineTo(670, r1); x.lineTo(750, r0); x.lineTo(685, r0); x.closePath(); x.fill();
        // Charcoal cab mask across the nose
        x.fillStyle = '#1b1e22';
        x.beginPath(); x.moveTo(670, r1); x.lineTo(W, r1); x.lineTo(W, r0); x.lineTo(750, r0); x.closePath(); x.fill();
      } else {
        // Double-decker Duplex lower window ribbon (y 0.98..1.84) & upper window ribbon (y 2.86..3.74)
        x.fillStyle = '#202429';
        x.fillRect(140, py(1.84), W - 280, py(0.98) - py(1.84));
        x.fillRect(120, py(3.74), W - 240, py(2.86) - py(3.74));
        // Silver structural belt between lower & upper decks (y 1.84..2.86) with subtle longitudinal crease
        x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(0, py(2.38), W, 2);
        x.fillStyle = 'rgba(25,28,32,0.28)'; x.fillRect(0, py(2.35), W, 2);

        if (kind === 'R1') {
          // 1re Classe carmine stripe above upper windows + Carmillon end slashes
          x.fillStyle = '#a4194c'; x.fillRect(0, py(3.84), W, py(3.74) - py(3.84));
          x.fillStyle = carm;
          x.fillRect(0, r0, 88, H); x.fillRect(W - 88, r0, 88, H);
        } else if (kind === 'R2') {
          // Voiture Bar Duplex : sweeping Carmillon wave across the central Bistro zone
          const wave = x.createLinearGradient(220, 0, 804, 0);
          wave.addColorStop(0, 'rgba(184,29,91,0)'); wave.addColorStop(0.2, '#b81d5b'); wave.addColorStop(0.8, '#8e1b52'); wave.addColorStop(1, 'rgba(104,25,74,0)');
          x.fillStyle = wave; x.fillRect(220, py(3.82), 584, py(0.92) - py(3.82));
        } else if (kind === 'R3') {
          // 2nde Classe teal-slate stripe above upper windows + Carmillon door surrounds
          x.fillStyle = '#2d6875'; x.fillRect(0, py(3.84), W, py(3.74) - py(3.84));
          x.fillStyle = carm;
          x.fillRect(0, r0, 72, H); x.fillRect(W - 72, r0, 72, H);
        }
      }

      // Panel seams & weathered road grime
      for (let k = 0; k < 18; k += 1.5) { x.fillStyle = 'rgba(24,26,28,0.24)'; x.fillRect((k / 18) * W, r0, 1, H); }
      const gd = x.createLinearGradient(0, py(1.05), 0, r1);
      gd.addColorStop(0, 'rgba(20,18,16,0)'); gd.addColorStop(1, 'rgba(20,18,16,0.58)');
      x.fillStyle = gd; x.fillRect(0, py(1.05), W, r1 - py(1.05));
    };

    drawSideBand(ATLAS.sideMotrice, 'motrice');
    drawSideBand(ATLAS.sideR1, 'R1');
    drawSideBand(ATLAS.sideR2, 'R2');
    drawSideBand(ATLAS.sideR3, 'R3');

    // ---- Logos band [720..816]
    x.fillStyle = '#b5b9be'; x.fillRect(0, 720, W, 96);
    {
      const g = x.createLinearGradient(14, 728, 226, 808);
      g.addColorStop(0, '#b81d5b'); g.addColorStop(1, '#7a1b54');
      x.fillStyle = g; x.beginPath(); x.roundRect(14, 730, 212, 76, 14); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'bold italic 46px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('SNCF', 120, 770);
    }
    {
      x.fillStyle = '#b5b9be'; x.fillRect(240, 720, 400, 96);
      x.fillStyle = '#24282d'; x.font = 'bold italic 50px Arial, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText('TGV', 255, 770);
      const gc = x.createLinearGradient(385, 735, 625, 800);
      gc.addColorStop(0, '#b81d5b'); gc.addColorStop(1, '#7a1b54');
      x.fillStyle = gc; x.beginPath(); x.roundRect(385, 736, 240, 64, 10); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'italic bold 40px Arial, sans-serif'; x.textAlign = 'center';
      x.fillText('inOui', 505, 770);
    }
    {
      x.fillStyle = '#9e1a4a'; x.fillRect(640, 720, 96, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('1', 688, 758);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('1re', 688, 798);
    }
    {
      x.fillStyle = '#28525e'; x.fillRect(736, 720, 96, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('2', 784, 758);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('2nde', 784, 798);
    }
    {
      x.fillStyle = '#9e1a4a'; x.fillRect(832, 720, 192, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 40px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('BAR', 928, 756);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('LE BISTRO', 928, 794);
    }

    // ---- Roof band [816..920]
    {
      const g2 = x.createLinearGradient(0, 816, 0, 920);
      g2.addColorStop(0, '#686c70'); g2.addColorStop(1, '#4c4f52');
      x.fillStyle = g2; x.fillRect(0, 816, W, 104);
      for (let k = 0; k < 140; k++) {
        x.fillStyle = `rgba(${22 + hash(k, 1) * 26},${20 + hash(k, 2) * 18},16,0.26)`;
        x.fillRect(hash(k, 3) * W, 816 + hash(k, 4) * 104, 2 + hash(k, 5) * 18, 1 + hash(k, 6) * 3);
      }
    }

    // ---- Door band [920..1024] : Carmillon plug door
    {
      const g3 = x.createLinearGradient(0, 920, 0, 1024);
      g3.addColorStop(0, '#b01b56'); g3.addColorStop(0.55, '#8e1849'); g3.addColorStop(1, '#292c30');
      x.fillStyle = g3; x.fillRect(0, 920, W, 104);
      x.fillStyle = '#24282d'; x.fillRect(190, 932, 644, 46);
      x.fillStyle = '#e5e7eb'; x.fillRect(60, 982, 904, 4);
    }
  });
}

// emissive panel atlas 512 x 256
export const PANEL = {
  led:       [0, 0, 128, 32],
  button:    [128, 0, 192, 32],
  red:       [192, 0, 256, 32],
  head:      [256, 0, 320, 32],
  dead:      [320, 0, 384, 32],
  lampBar:   [384, 0, 448, 32],
  barSign:   [448, 0, 512, 32],
  cab:       [0, 32, 256, 64],
  extLed:    [256, 32, 512, 64],
  screen:    [0, 64, 512, 128],
  screenR1:  [0, 128, 256, 192],
  screenR3:  [256, 128, 512, 192],
  screenBar: [0, 192, 256, 256],
  vitrine:   [256, 192, 512, 256],
};

function panelTex() {
  return canvasTex(512, 256, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 256);
    x.fillStyle = '#e8f0ff'; x.fillRect(0, 0, 128, 32);
    x.fillStyle = '#0b130c'; x.fillRect(128, 0, 64, 32); x.fillStyle = '#4dff7a'; x.beginPath(); x.arc(160, 16, 11, 0, TAU); x.fill();
    x.fillStyle = '#ff2a1a'; x.fillRect(192, 0, 64, 32);
    x.fillStyle = '#fff2d8'; x.fillRect(256, 0, 64, 32);
    x.fillStyle = '#1c1e20'; x.fillRect(320, 0, 64, 32);
    x.fillStyle = '#ffd99a'; x.fillRect(384, 0, 64, 32);
    x.fillStyle = '#ffe4b5'; x.fillRect(448, 0, 64, 32);

    // TVM-430 / ETCS L2 / KVB Euroduplex cab display [0, 32, 256, 64]
    x.fillStyle = '#060c14'; x.fillRect(0, 32, 256, 32);
    x.fillStyle = '#122840'; x.fillRect(4, 35, 82, 26);
    x.fillStyle = '#4de88a'; x.font = 'bold 13px monospace'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText('320 km/h', 8, 48);
    x.fillStyle = '#ffb02a'; x.fillRect(92, 35, 76, 26);
    x.fillStyle = '#05070a'; x.font = 'bold 12px monospace'; x.fillText('ETCS L2', 98, 48);
    x.fillStyle = '#18344e'; x.fillRect(174, 35, 78, 26);
    x.fillStyle = '#7ec8ff'; x.fillText('25kV AC', 180, 48);

    // Exterior amber LED board [256, 32, 512, 64]
    x.fillStyle = '#05070a'; x.fillRect(256, 32, 256, 32);
    x.fillStyle = '#ffb02a'; x.font = 'bold 14px Arial, sans-serif'; x.textAlign = 'center';
    x.fillText('TGV INOUI 9572 · DUPLEX', 384, 49);

    // Main screen [0, 64, 512, 128]
    x.fillStyle = '#05070a'; x.fillRect(0, 64, 512, 64);
    x.fillStyle = '#ffb02a'; x.font = 'bold 22px Arial, sans-serif'; x.fillText('TGV Euroduplex 9572 · Paris-Est → Strasbourg', 256, 86);
    x.fillStyle = '#8ec8ff'; x.font = '15px Arial, sans-serif'; x.fillText('Rame 10 caisses · Salles Haute & Basse · Bar Voiture 4', 256, 112);

    // R1..R3 1re Classe Duplex [0, 128, 256, 192]
    x.fillStyle = '#05070a'; x.fillRect(0, 128, 256, 64);
    x.fillStyle = '#ff4d88'; x.fillRect(0, 128, 256, 6);
    x.fillStyle = '#ffb02a'; x.font = 'bold 17px Arial, sans-serif'; x.fillText('1re Classe · Duplex', 128, 152);
    x.fillStyle = '#8ec8ff'; x.font = '13px Arial, sans-serif'; x.fillText('Salle Basse & Salle Haute', 128, 174);

    // R5..R8 2nde Classe Duplex [256, 128, 512, 192]
    x.fillStyle = '#05070a'; x.fillRect(256, 128, 256, 64);
    x.fillStyle = '#368a9c'; x.fillRect(256, 128, 256, 6);
    x.fillStyle = '#ffb02a'; x.font = 'bold 17px Arial, sans-serif'; x.fillText('2nde Classe · Duplex', 384, 152);
    x.fillStyle = '#8ec8ff'; x.font = '13px Arial, sans-serif'; x.fillText('Salle Basse & Salle Haute', 384, 174);

    // Bar Menu [0, 192, 256, 256]
    x.fillStyle = '#090608'; x.fillRect(0, 192, 256, 64);
    x.fillStyle = '#ff4d88'; x.fillRect(0, 192, 256, 6);
    x.fillStyle = '#ffe4b5'; x.font = 'bold 16px Arial, sans-serif'; x.fillText('VOITURE 4 · LE BISTRO', 128, 216);
    x.fillStyle = '#ffb02a'; x.font = '13px Arial, sans-serif'; x.fillText('Bar Salle Haute · Café · Snack', 128, 238);

    // Chilled Drinks Vitrine [256, 192, 512, 256]
    x.fillStyle = '#0c1c28'; x.fillRect(256, 192, 256, 64);
    for (const sy of [210, 232, 250]) { x.fillStyle = '#bfe6ff'; x.fillRect(264, sy, 240, 2); }
    for (let k = 0; k < 10; k++) {
      x.fillStyle = k % 3 === 0 ? '#d94862' : k % 3 === 1 ? '#58c47a' : '#7cb8e8';
      x.fillRect(272 + k * 23, 198, 10, 12);
      x.fillRect(272 + k * 23, 218, 10, 14);
      x.fillRect(272 + k * 23, 237, 10, 13);
    }

    x.fillStyle = 'rgba(0,0,0,0.40)';
    for (let y = 32; y < 256; y += 3) x.fillRect(0, y, 512, 1);
  });
}

function bloodTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const blot = (cx, cy, r, n, a) => { for (let k = 0; k < n; k++) { const t = hash(cx + k, cy, r), rr = r * (0.2 + hash(k, cx) * 0.8); x.fillStyle = `rgba(${70 + t * 40},6,5,${a})`; x.beginPath(); x.arc(cx + (hash(k, 1, cy) - 0.5) * r * 2, cy + (hash(k, 2, cx) - 0.5) * r * 2, rr * 0.4, 0, TAU); x.fill(); } };
  blot(64, 64, 40, 30, 0.85);
  x.fillStyle = 'rgba(80,8,6,0.8)'; x.fillRect(150, 10, 40, 110); for (let k = 0; k < 8; k++) x.fillRect(148 + k * 6, 110, 3, 20 + hash(k, 9) * 60);
  for (let f = 0; f < 5; f++) { x.fillStyle = 'rgba(90,8,6,0.85)'; x.beginPath(); x.ellipse(40 + f * 12, 160 - Math.abs(f - 2) * 6, 4, 14, (f - 2) * 0.15, 0, TAU); x.fill(); } x.beginPath(); x.ellipse(64, 205, 26, 30, 0, 0, TAU); x.fill();
  blot(192, 192, 50, 50, 0.7);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ materials (exact 12 keys, 0 new shaders)
let MATS = null;
export function trainMaterials(envMap = null) {
  if (MATS) return MATS;
  const panel = panelTex();
  MATS = {
    body:     new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.46, metalness: 0.45 }),
    dark:     new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.45 }),
    inside:   new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.80, metalness: 0.08, emissive: 0x0d1014 }),
    glass:    new THREE.MeshStandardMaterial({ color: 0x8fa8b6, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    screen:   new THREE.MeshStandardMaterial({ color: 0x162430, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
    panel:    new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    flicker:  new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    decal:    new THREE.MeshStandardMaterial({ map: bloodTex(), transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x20201c, emissive: 0xfff0d0, emissiveIntensity: 3.2, roughness: 0.3 }),
    lampTail: new THREE.MeshStandardMaterial({ color: 0x300806, emissive: 0xff2412, emissiveIntensity: 2.6, roughness: 0.3 }),
    crack:    new THREE.MeshStandardMaterial({ map: crackTex(), color: 0xdfe6ea, roughness: 0.2, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    shards:   new THREE.MeshStandardMaterial({ color: 0x7c8e96, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
  };
  if (envMap) { MATS.glass.envMap = envMap; MATS.shards.envMap = envMap; MATS.screen.envMap = envMap; }
  return MATS;
}

function crackTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d'), cx = 128, cy = 120;
  x.clearRect(0, 0, 256, 160); x.lineCap = 'round';
  for (let k = 0; k < 15; k++) {
    let a = (k / 15) * TAU + hash(k, 1) * 0.3, px = cx, py = cy;
    x.strokeStyle = `rgba(235,242,246,${0.55 + hash(k, 2) * 0.35})`; x.lineWidth = 1 + hash(k, 3) * 1.4;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 9; s++) { a += (hash(k, s, 4) - 0.5) * 0.5; const l = 9 + hash(k, s, 5) * 16; px += Math.cos(a) * l; py += Math.sin(a) * l * 0.8; x.lineTo(px, py); }
    x.stroke();
  }
  for (const r of [10, 24, 40]) { x.strokeStyle = 'rgba(230,238,242,0.45)'; x.lineWidth = 1; x.beginPath(); for (let k = 0; k <= 24; k++) { const a = (k / 24) * TAU, rr = r * (0.8 + hash(k, r) * 0.4); const X = cx + Math.cos(a) * rr, Y = cy + Math.sin(a) * rr * 0.8; if (k) x.lineTo(X, Y); else x.moveTo(X, Y); } x.stroke(); }
  x.fillStyle = 'rgba(240,245,248,0.5)'; x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ lower-deck saloon window pane, cracks, shards
export function buildWindowGeometry() {
  const L = carLayouts(), w = L.winW, y0 = L.winY0, y1 = L.winY1;
  const pane = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.10), 4), 0, 1);
  const crack = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.10), 4), 0.004, 1);
  { const p = crack.attributes.position, uv = crack.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, (p.getY(i) - y0) / (y1 - y0)); }
  const s = rrect(-w / 2, y0, w / 2, y1, 0.10), hole = new THREE.Path(), n = 34, pts = [];
  for (let k = 0; k < n; k++) {
    const f = k / n, per = 2 * (w + (y1 - y0)), d = f * per; let px, py;
    if (d < w) { px = -w / 2 + d; py = y0; } else if (d < w + (y1 - y0)) { px = w / 2; py = y0 + d - w; } else if (d < 2 * w + (y1 - y0)) { px = w / 2 - (d - w - (y1 - y0)); py = y1; } else { px = -w / 2; py = y1 - (d - 2 * w - (y1 - y0)); }
    const depth = 0.05 + hash(k, 77) * 0.22 * (k % 3 === 0 ? 1 : 0.45), cxp = 0, cyp = (y0 + y1) / 2, dx = cxp - px, dy = cyp - py, l = Math.hypot(dx, dy) || 1;
    pts.push([px + (dx / l) * depth, py + (dy / l) * depth]);
  }
  pts.forEach(([px, py], i) => (i ? hole.lineTo(px, py) : hole.moveTo(px, py))); hole.closePath();
  s.holes.push(hole);
  const shards = onSide(new THREE.ShapeGeometry(s, 4), 0, 1);
  return { pane, crack, shards };
}

// ------------------------------------------------------------------ geometry kit
const COL = new THREE.Color();
function buckets() {
  const map = new Map();
  return {
    add(name, g, color = null) {
      if (!g) return;
      let q = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
      if (!q.attributes.normal) q.computeVertexNormals();
      if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
      if (color != null) {
        COL.set(color);
        const n = q.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = COL.r; c[i * 3 + 1] = COL.g; c[i * 3 + 2] = COL.b; }
        q.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      }
      let l = map.get(name); if (!l) map.set(name, l = []); l.push(q);
    },
    merge() {
      const out = {};
      for (const [name, list] of map) { out[name] = mergeGeometries(list, false); list.forEach((q) => q.dispose()); out[name].computeBoundingSphere(); out[name].computeBoundingBox(); }
      map.clear();
      return out;
    },
  };
}
const rrect = (x0, y0, x1, y1, r, path = false) => {
  const s = path ? new THREE.Path() : new THREE.Shape(); r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
};
const ring = (x0, y0, x1, y1, r, b) => { const s = rrect(x0 - b, y0 - b, x1 + b, y1 + b, r + b); s.holes.push(rrect(x0, y0, x1, y1, r, true)); return s; };
const extr = (shape, depth, bevel = 0, curve = 4) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: curve });

function cbox(u, y, w, su, sy, sw, c = 0.02) {
  c = Math.min(c, su / 3, sy / 3, sw / 3);
  const g = extr(new THREE.Shape([new THREE.Vector2(-sw / 2 + c, -sy / 2 + c), new THREE.Vector2(sw / 2 - c, -sy / 2 + c), new THREE.Vector2(sw / 2 - c, sy / 2 - c), new THREE.Vector2(-sw / 2 + c, sy / 2 - c)]), Math.max(0.001, su - 2 * c), c, 2);
  g.translate(0, 0, -(su - 2 * c) / 2);
  g.translate(w, y, -u);
  return g;
}
function cyl(u, y, w, r, len, axis = 'y', seg = 10, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'w') g.rotateZ(Math.PI / 2); else if (axis === 'u') g.rotateX(Math.PI / 2);
  g.translate(w, y, -u);
  return g;
}
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vq = new THREE.Quaternion(), _vy = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, seg = 6) {
  _va.set(a[2], a[1], -a[0]); _vb.set(b[2], b[1], -b[0]);
  const len = _va.distanceTo(_vb), g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_vq.setFromUnitVectors(_vy, _vb.clone().sub(_va).normalize()));
  g.translate(_va.x, _va.y, _va.z);
  return g;
}
function onSide(g, w0, face) { g.rotateY(face > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(w0, 0, 0); return g; }
const sx = (face, u) => (face > 0 ? u : -u);
function onEnd(g, u0, face) { if (face > 0) g.rotateY(Math.PI); g.translate(0, 0, -u0); return g; }
function uvSide(g, region, L) {
  const [r0, r1, y0, y1] = region, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const u = -p.getZ(i), y = p.getY(i); uv.setXY(i, clamp((u + L / 2) / L, 0, 1), 1 - (r0 + (1 - clamp((y - y0) / (y1 - y0), 0, 1)) * (r1 - r0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvRegion(g, rows, fx, fy) {
  const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = rows;
  for (let i = 0; i < p.count; i++) { const a = clamp(fx(p.getX(i), p.getY(i), p.getZ(i)), 0, 1), b = clamp(fy(p.getX(i), p.getY(i), p.getZ(i)), 0, 1); uv.setXY(i, a, 1 - (r0 + (1 - b) * (r1 - r0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvAtlasRect(g, rect) {
  const [x0, y0, x1, y1] = rect, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, (x0 + a * (x1 - x0)) / 1024, 1 - (y0 + (1 - b) * (y1 - y0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvPanel(g, cell) {
  const [x0, y0, x1, y1] = cell, p = g.attributes.position, uv = g.attributes.uv;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  const ax = (i) => p.getX(i) - p.getZ(i), ay = (i) => p.getY(i);
  for (let i = 0; i < p.count; i++) { a0 = Math.min(a0, ax(i)); a1 = Math.max(a1, ax(i)); b0 = Math.min(b0, ay(i)); b1 = Math.max(b1, ay(i)); }
  for (let i = 0; i < p.count; i++) {
    const fa = a1 > a0 ? (ax(i) - a0) / (a1 - a0) : 0.5, fb = b1 > b0 ? (ay(i) - b0) / (b1 - b0) : 0.5;
    uv.setXY(i, (x0 + 1 + fa * (x1 - x0 - 2)) / 512, 1 - (y0 + 1 + (1 - fb) * (y1 - y0 - 2)) / 256);
  }
  uv.needsUpdate = true; return g;
}
function uvRect(g, cell, flip = false) {
  const [x0, y0, x1, y1] = cell, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const a = flip ? 1 - uv.getX(i) : uv.getX(i), b = uv.getY(i); uv.setXY(i, (x0 + a * (x1 - x0)) / 512, 1 - (y0 + (1 - b) * (y1 - y0)) / 256); }
  uv.needsUpdate = true; return g;
}
const plane = (sx_, sy) => new THREE.PlaneGeometry(sx_, sy);

// TGV Euroduplex palette
const C = {
  steel: 0x3d4145, black: 0x161717, rubber: 0x1b1b1c, rust: 0x4a3326, axle: 0x2c2b29, wheel: 0x3a3632, disc: 0x55524d, yellow: 0x826a24,
  insulator: 0x5a2e22, grey: 0x55585b, rack: 0x6a6e72, pedestal: 0x22252a, partition: 0x52565c,
  seatR1: 0x641e34, headR1: 0xc8c3ba, curtain: 0x521d2b, floorR1: 0x2d242a, aisleR1: 0x3a363c, wood: 0x5e4534, brass: 0x8a6f3d,
  barWood: 0x3b2c26, barFront: 0x282a2e, barCarmine: 0x8a1c44, barChrome: 0x767c82, floorR2: 0x26262a, aisleR2: 0x323338,
  seatR3: 0x264d59, headR3: 0x72828a, blind: 0x3e444a, floorR3: 0x292d32, aisleR3: 0x363a40, tablette: 0x464a4f,
  lining: 0x92938f, liningLow: 0x4d5055, ceiling: 0xa0a19d, slate: 0x3a4550, cabDesk: 0x25282e, cabSeat: 0x1e3848,
};

// ------------------------------------------------------------------ TGV Y230 / Y266 bogies ('motor' | 'trailer')
export function buildBogieGeometry(kind = 'motor') {
  const B = buckets(), motor = kind === 'motor';
  const r = motor ? 0.46 : 0.44, wb = CONFIG.train.bogieWb ?? 3.0, yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036, u = 0;
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 14), C.wheel);
      B.add('dark', cyl(u + a, yAx, s * (g + 0.072), r * 0.82, 0.03, 'w', 14), C.rust);
      B.add('dark', cbox(u + a, yAx, s * 1.12, 0.38, 0.30, 0.22, 0.03), C.steel);
      for (const dw of [0.35, 0.48]) B.add('dark', cyl(u + a, yAx, s * dw, r * 0.68, 0.045, 'w', 12), C.disc);
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.085, 2 * g, 'w', 8), C.axle);
  }
  const fs = new THREE.Shape(), L = wb / 2 + 0.55, y0 = yAx + 0.14;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.27); fs.lineTo(-0.78, y0 + 0.36); fs.lineTo(-0.52, y0 + 0.12);
  fs.lineTo(0.52, y0 + 0.12); fs.lineTo(0.78, y0 + 0.36); fs.lineTo(L, y0 + 0.27); fs.lineTo(L, y0);
  fs.lineTo(0.62, y0 - 0.05); fs.lineTo(-0.62, y0 - 0.05); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) {
    const gf = extr(fs, 0.14, 0.015, 2); gf.translate(0, 0, -0.07); onSide(gf, s * 1.12, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel);
    B.add('dark', cyl(u, yAx + 0.54, s * 0.98, 0.27, 0.25, 'y', 10), C.rubber);
  }
  B.add('dark', cbox(u, yAx + 0.27, 0, 0.54, 0.24, 2.16, 0.04), C.steel);
  if (motor) {
    for (const s of [-1, 1]) for (const du of [-0.62, 0.62]) B.add('dark', cyl(u + du, yAx + 0.06, s * 0.38, 0.17, 0.52, 'u', 8), C.axle);
  } else {
    B.add('dark', cyl(u, yAx + 0.45, 0, 0.24, 0.12, 'y', 10), C.steel);
  }
  return B.merge().dark;
}

// ------------------------------------------------------------------ aerodynamic TGV Euroduplex nose (uF = +3.70 -> tip +9.10)
const NOSE_T = [0, 0.08, 0.16, 0.24, 0.30, 0.38, 0.46, 0.54, 0.60, 0.68, 0.76, 0.84, 0.90, 0.95, 0.985, 1.0];
const NOSE_TOP = [[0, 1.00], [0.16, 0.96], [0.28, 0.84], [0.38, 0.75], [0.48, 0.64], [0.58, 0.54], [0.70, 0.47], [0.82, 0.40], [0.92, 0.33], [0.97, 0.29], [1.0, 0.26]];
const NOSE_FW = [[0, 1.00], [0.28, 0.95], [0.58, 0.82], [0.82, 0.62], [0.94, 0.42], [1.0, 0.24]];
const NOSE_YBOT = [[0, 0.36], [0.58, 0.42], [0.85, 0.44], [0.95, 0.50], [1.0, 0.62]];
const lerpKeys = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; } return K[K.length - 1][1]; };

export function noseSection(t) {
  const T = CONFIG.train;
  return { fw: lerpKeys(NOSE_FW, t), yBot: lerpKeys(NOSE_YBOT, t), yTop: T.height * lerpKeys(NOSE_TOP, t), round: 0.58 * Math.pow(t, 1.15) };
}

function roofProfile() {
  const T = CONFIG.train, Wd = T.width / 2, yc = 3.82, Ht = T.height;
  return [[1.00, 0.00], [0.99, 0.28], [0.96, 0.54], [0.90, 0.76], [0.80, 0.90], [0.62, 0.97], [0.32, 1.00], [-0.32, 1.00], [-0.62, 0.97], [-0.80, 0.90], [-0.90, 0.76], [-0.96, 0.54], [-0.99, 0.28], [-1.00, 0.00]]
    .map(([wf, yf]) => [wf * Wd, yc + yf * (Ht - yc)]);
}

function buildNose(B, u0, Ln, yb, yc) {
  const T = CONFIG.train, Wd = T.width / 2, Ht = T.height, prof = roofProfile();
  const base = [[Wd, yb], [Wd, yb + (yc - yb) / 3], [Wd, yb + (2 * (yc - yb)) / 3], ...prof, [-Wd, yb + (2 * (yc - yb)) / 3], [-Wd, yb + (yc - yb) / 3], [-Wd, yb]];
  const n = base.length, isTop = base.map(([w, y]) => y >= yc + 0.06 && Math.abs(w) < Wd * 0.82);
  const ns = NOSE_T.length, P = new Float32Array(ns * n * 3), cen = [], LnBase = Ln - 0.26;
  for (let i = 0; i < ns; i++) {
    const t = NOSE_T[i], S = noseSection(t), cy = (S.yBot + S.yTop) / 2, a = Wd * S.fw, b = (S.yTop - S.yBot) / 2;
    const uSlice = u0 + LnBase * t;
    cen.push([0, cy, -uSlice]);
    for (let j = 0; j < n; j++) {
      let w = base[j][0] * S.fw, y = S.yBot + ((base[j][1] - yb) / (Ht - yb)) * (S.yTop - S.yBot);
      if (S.round > 0) {
        const qx = w / a, qy = (y - cy) / b, r = Math.hypot(qx, qy) || 1;
        w += (a * (qx / r) - w) * S.round; y += (cy + b * (qy / r) - y) * S.round;
      }
      const duBow = 0.26 * (1 - Math.pow(clamp(Math.abs(w) / (a || 1), 0, 1), 2)) * Math.pow(t, 1.6);
      P[(i * n + j) * 3] = w; P[(i * n + j) * 3 + 1] = y; P[(i * n + j) * 3 + 2] = -(uSlice + duBow);
    }
  }
  const sets = { body: [], frame: [], screen: [], mask: [] };
  const add = (set, i, j) => {
    const j1 = (j + 1) % n, a = i * n + j, b = i * n + j1, c = (i + 1) * n + j1, d = (i + 1) * n + j;
    const cx = cen[i];
    const px = (P[a * 3] + P[b * 3] + P[c * 3] + P[d * 3]) / 4, py = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] + P[d * 3 + 1]) / 4, pz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] + P[d * 3 + 2]) / 4;
    const e1x = P[c * 3] - P[a * 3], e1y = P[c * 3 + 1] - P[a * 3 + 1], e1z = P[c * 3 + 2] - P[a * 3 + 2];
    const e2x = P[d * 3] - P[b * 3], e2y = P[d * 3 + 1] - P[b * 3 + 1], e2z = P[d * 3 + 2] - P[b * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const out = nx * (px - cx[0]) + ny * (py - cx[1]) + nz * (pz - cx[2]) > 0;
    sets[set].push(...(out ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  };
  for (let i = 0; i < ns - 1; i++) for (let j = 0; j < n; j++) {
    const top = isTop[j] && isTop[(j + 1) % n], near = isTop[(j + n - 1) % n] || isTop[(j + 2) % n] || isTop[j] || isTop[(j + 1) % n];
    let set = 'body';
    if (i >= ns - 3) set = 'mask';
    else if (i >= 3 && i <= 7 && top) set = 'screen';
    else if (i >= 2 && i <= 8 && near) set = 'frame';
    add(set, i, j);
  }
  const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ns * n * 2), 2)); return g; };
  if (sets.body.length) B.add('body', uvSide(mk(sets.body), ATLAS.sideMotrice, T.cars[0]));
  if (sets.frame.length) B.add('dark', mk(sets.frame), C.rubber);
  if (sets.screen.length) B.add('glass', mk(sets.screen)); // transparent panoramic cab windshield!
  if (sets.mask.length) B.add('dark', mk(sets.mask), C.black);
  // Front tip cap
  { const i = ns - 1, idx = []; for (let j = 1; j < n - 1; j++) { const a = i * n, b = i * n + j, d = i * n + j + 1; const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], fx = P[d * 3] - P[a * 3], fy = P[d * 3 + 1] - P[a * 3 + 1]; idx.push(...((ex * fy - ey * fx) * -1 > 0 ? [a, b, d] : [a, d, b])); } B.add('dark', mk(idx), C.black); }
  // Nose wipers, headlight bezels, coupler hatch, snowplow skirt
  B.add('dark', tube([5.15, 3.62, 0], [6.85, 2.32, 0], 0.028, 6), C.black);
  for (const s of [-1, 1]) {
    B.add('dark', tube([6.78, 2.40, s * 0.16], [5.95, 3.00, s * 0.66], 0.014, 5), C.black);
    const bz = cbox(0, 0, 0, 0.24, 0.18, 0.30, 0.02); bz.rotateY(-s * 0.34); bz.translate(s * 0.50, 0.98, -8.56);
    B.add('dark', bz, C.black);
  }
  B.add('dark', cbox(8.75, 0.88, 0, 0.36, 0.40, 0.76, 0.04), C.black);
  B.add('dark', cbox(5.05, 3.74, 0, 0.20, 0.13, 0.24, 0.02), C.black);
  B.add('dark', cbox(8.70, 0.44, 0, 0.42, 0.18, 1.05, 0.03), C.black);
}

function addLogo(B, rect, u, y, w, h, side, Wd) {
  const g = uvAtlasRect(plane(w, h), rect);
  onSide(g, side * (Wd + 0.008), side);
  g.translate(0, y, -u);
  B.add('body', g);
}

function addExtLed(B, u, y, w, h, side, Wd) {
  const g = uvRect(plane(w, h), PANEL.extLed);
  onSide(g, side * (Wd + 0.008), side);
  g.translate(0, y, -u);
  B.add('panel', g);
}

function addWallWithDoor(B, u0, face, wMax, yBot, yTop, pdw, doorTop, colWall, wins = null) {
  const addRect = (x0, x1, y0, y1) => {
    if (x1 <= x0 + 1e-4 || y1 <= y0 + 1e-4) return;
    const g = cbox(u0, (y0 + y1) / 2, (x0 + x1) / 2, 0.055, y1 - y0, x1 - x0, 0.008);
    B.add('inside', g, colWall);
  };
  addRect(-pdw, pdw, doorTop, yTop);
  if (!wins) {
    addRect(-wMax, -pdw, yBot, yTop);
    addRect(pdw, wMax, yBot, yTop);
  } else {
    const [wy0, wy1] = wins;
    for (const sd of [-1, 1]) {
      const a = sd > 0 ? pdw : -wMax, b = sd > 0 ? wMax : -pdw;
      const gLo = sd > 0 ? pdw + 0.12 : -wMax + 0.08, gHi = sd > 0 ? wMax - 0.08 : -pdw - 0.12;
      addRect(a, b, yBot, wy0);
      addRect(a, b, wy1, yTop);
      addRect(a, gLo, wy0, wy1);
      addRect(gHi, b, wy0, wy1);
      B.add('glass', onEnd(plane(gHi - gLo, wy1 - wy0).translate((gLo + gHi) / 2, (wy0 + wy1) / 2, 0), u0, face));
    }
  }
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, -pdw - 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, pdw + 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
}

// ------------------------------------------------------------------ car body builder
// kind : 'motrice' | 'coachR1' | 'coachR2' | 'coachR3'
export function buildCarGeometry(kind) {
  const T = CONFIG.train, W = T.walk, Lay = carLayouts(), Q = Lay[kind] || Lay.coachR3;
  const L = Q.len, h = Q.h, Wd = T.width / 2, F0 = T.floor, F1 = T.floorHigh, FL = Lay.FL, FU = Lay.FU, B = buckets();
  const isMotrice = kind === 'motrice', Ln = T.layout.taper, uF = isMotrice ? h - Ln : h, uA = -h;
  const yb = 0.30, yc = 3.82, lin = W.wall + 0.01, ceil = T.ceil ?? 4.18, ceilLow = FU - 0.08;
  const { winW, winY0, winY1, winYU0, winYU1 } = Lay, dw = T.doorWidth / 2, dTop = F0 + T.doorH;
  const sideRegion = isMotrice ? ATLAS.sideMotrice : kind === 'coachR1' ? ATLAS.sideR1 : kind === 'coachR2' ? ATLAS.sideR2 : ATLAS.sideR3;

  // ---- exterior sides & double-decker window / door cutouts
  const cabWin = isMotrice ? { u: 3.10, w: 0.92 } : null;
  for (const side of [-1, 1]) {
    const X = (u) => sx(side, u);
    const x0 = Math.min(X(uA), X(uF)), x1 = Math.max(X(uA), X(uF));
    const s = new THREE.Shape([new THREE.Vector2(x0, yb), new THREE.Vector2(x1, yb), new THREE.Vector2(x1, yc), new THREE.Vector2(x0, yc)]);
    const sideWins = Q.win.filter((q) => !q.side || q.side === side);
    const sideWinsU = (Q.winUpper || []).filter((q) => !q.side || q.side === side);
    for (const q of sideWins) s.holes.push(rrect(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.10, true));
    for (const q of sideWinsU) s.holes.push(rrect(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.10, true));
    for (const u of Q.doors) s.holes.push(rrect(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.08, true));
    if (cabWin) s.holes.push(rrect(X(cabWin.u) - cabWin.w / 2, 2.04, X(cabWin.u) + cabWin.w / 2, 3.04, 0.08, true));
    const g = extr(s, Wd - lin - 0.02, 0, 3); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, sideRegion, L));

    // Lower window gaskets (panes are instanced in train.js winMeshes)
    for (const q of sideWins) {
      const gk = extr(ring(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.10, 0.045), 0.02, 0, 3);
      onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
    }
    // Upper-deck panoramic window gaskets + glass panes
    for (const q of sideWinsU) {
      const gk = extr(ring(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.10, 0.045), 0.02, 0, 3);
      onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.10), 3), side * (Wd - 0.03), side));
    }
    for (const u of Q.doors) {
      const fr = extr(ring(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.08, 0.065), 0.025, 0, 3);
      onSide(fr, side * Wd, side); B.add('dark', fr, C.black);
      for (const e of [-1, 1]) B.add('dark', tube([u + e * (dw + 0.15), F0 + 0.45, side * (Wd + 0.06)], [u + e * (dw + 0.15), F0 + 1.92, side * (Wd + 0.06)], 0.018, 5), C.steel);
      B.add('dark', cbox(u, F0 - 0.03, side * (Wd - 0.04), T.doorWidth + 0.1, 0.05, 0.2, 0.01), C.steel);
      B.add('dark', cbox(u, F0 - 0.012, side * (Wd + 0.02), T.doorWidth, 0.014, 0.05, 0.004), C.yellow);
      const dirIn = u > 0 ? -1 : 1;
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.042, 10).translate(X(u + dirIn * (dw + 0.26)), 1.72, 0), side * (Wd + 0.012), side), PANEL.button));
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.038, 10).translate(X(u + dirIn * (dw + 0.22)), 1.80, 0), side * (lin - 0.012), -side), PANEL.button));
    }
    if (cabWin) {
      const fr = extr(ring(X(cabWin.u) - cabWin.w / 2, 2.04, X(cabWin.u) + cabWin.w / 2, 3.04, 0.08, 0.04), 0.02, 0, 3);
      onSide(fr, side * Wd, side); B.add('dark', fr, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(cabWin.u) - cabWin.w / 2, 2.04, X(cabWin.u) + cabWin.w / 2, 3.04, 0.08), 3), side * (Wd - 0.04), side));
      B.add('dark', cbox(cabWin.u + 0.64, 2.86, side * (Wd + 0.08), 0.16, 0.10, 0.16, 0.02), C.black);
    }
    B.add('dark', cbox((uA + uF) / 2, yc + 0.02, side * (Wd - 0.02), uF - uA, 0.06, 0.08, 0.02), C.steel);
    B.add('dark', cbox((uA + uF) / 2, yb + 0.03, side * (Wd - 0.03), uF - uA - 0.2, 0.07, 0.07, 0.02), C.black);

    // Exterior un-mirrored Carmillon / inOui decals & LED boards
    if (isMotrice) {
      addLogo(B, ATLAS.logos.sncf, 2.15, 1.54, 0.90, 0.36, side, Wd);
      addLogo(B, ATLAS.logos.tgv, -1.80, 2.34, 1.55, 0.38, side, Wd);
      for (const [lu0, lu1] of [[-6.2, -3.2], [-0.8, 1.6]]) {
        B.add('dark', cbox((lu0 + lu1) / 2, 2.56, side * (Wd - 0.02), lu1 - lu0, 1.12, 0.05, 0.01), C.black);
        for (let k = 0; k < 7; k++) B.add('dark', cbox((lu0 + lu1) / 2, 2.10 + k * 0.15, side * (Wd + 0.005), lu1 - lu0 - 0.12, 0.04, 0.04, 0.005), C.steel);
      }
    } else if (kind === 'coachR1') {
      addLogo(B, ATLAS.logos.num1, 5.10, 2.34, 0.44, 0.44, side, Wd);
      addExtLed(B, 5.10, 1.98, 0.76, 0.12, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -5.10, 2.34, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 0.00, 2.34, 1.25, 0.30, side, Wd);
    } else if (kind === 'coachR2') {
      addLogo(B, ATLAS.logos.bar, 0.00, 2.34, 1.15, 0.50, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -5.10, 2.34, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 5.10, 2.34, 1.25, 0.30, side, Wd);
    } else if (kind === 'coachR3') {
      addLogo(B, ATLAS.logos.num2, -5.10, 2.34, 0.44, 0.44, side, Wd);
      addExtLed(B, -5.10, 1.98, 0.76, 0.12, side, Wd);
      addLogo(B, ATLAS.logos.sncf, 5.10, 2.34, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 0.00, 2.34, 1.25, 0.30, side, Wd);
    }
  }

  // ---- roof shell + TGV roof equipment
  {
    const prof = roofProfile(), pos = [];
    for (let i = 1; i < prof.length; i++) {
      const [w0, y0] = prof[i - 1], [w1, y1] = prof[i];
      pos.push(w0, y0, -uF, w1, y1, -uF, w1, y1, -uA, w0, y0, -uF, w1, y1, -uA, w0, y0, -uA);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    B.add('body', uvRegion(g, ATLAS.roof, (x, y, z) => (-z + h) / L, (x) => (x + Wd) / (2 * Wd)));

    if (isMotrice) {
      for (const s of [-1, 1]) {
        B.add('dark', cbox(1.60, T.height + 0.08, s * 1.12, 2.40, 0.16, 0.24, 0.02), C.grey);
        B.add('dark', cbox(-6.40, T.height + 0.08, s * 1.12, 2.80, 0.16, 0.24, 0.02), C.grey);
      }
      B.add('dark', cbox(-2.60, T.height + 0.06, 0, 3.20, 0.14, 1.60, 0.04), C.grey);
      B.add('dark', tube([-6.4, T.height + 0.16, 0.48], [1.6, T.height + 0.16, 0.48], 0.02, 6), C.rust);
    } else {
      B.add('dark', cbox(0, T.height + 0.05, 0, 2.8, 0.14, 1.65, 0.04), C.grey);
    }
  }

  // ---- open inter-car gangway ends
  const gw = W.gangway / 2, gh = 2.06;
  for (const uE of Q.openEnds) {
    const dir = Math.sign(uE);
    const s = new THREE.Shape(); s.moveTo(-Wd, yb); s.lineTo(Wd, yb); s.lineTo(Wd, yc); s.quadraticCurveTo(Wd, T.height, 0, T.height); s.quadraticCurveTo(-Wd, T.height, -Wd, yc); s.lineTo(-Wd, yb);
    s.holes.push(rrect(-gw, F1 + 0.01, gw, F1 + gh, 0.08, true));
    const g = extr(s, 0.06, 0, 6); g.translate(0, 0, -0.03); onEnd(g, uE - dir * 0.03, dir);
    B.add('body', uvRegion(g, ATLAS.roof, (x) => (x + Wd) / (2 * Wd), (x, y) => (y - yb) / (T.height - yb)));
    for (let k = 0; k < 4; k++) {
      const o = 0.06 + (k % 2) * 0.04, b0 = uE + dir * (0.03 + k * 0.052);
      const r = extr(ring(-gw - 0.05, F1 - 0.02, gw + 0.05, F1 + gh + 0.08, 0.10, o + 0.10), 0.05, 0, 3); r.translate(0, 0, -0.025); onEnd(r, b0 + dir * 0.025, dir); B.add('dark', r, C.rubber);
    }
    B.add('dark', cbox(uE + dir * 0.18, F1 - 0.015, 0, 0.36, 0.03, W.gangway + 0.12, 0.01), C.steel);
    const yT = ceil - 0.08, yO = F1 + gh, sideW = lin - gw;
    for (const [w, hh, cx, cy] of [[sideW, yT - F1, -(lin + gw) / 2, (F1 + yT) / 2], [sideW, yT - F1, (lin + gw) / 2, (F1 + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) {
      B.add('inside', onEnd(plane(w, hh).translate(cx, cy, 0), uE - dir * 0.07, -dir), C.partition);
    }
  }

  // ================================================================ MOTRICE : Walkable Engine-Room Corridor + Euroduplex Driver's Cockpit
  if (isMotrice) {
    buildNose(B, uF, Ln, yb, yc);
    const fCab = 1.24, fCor = 1.06;
    // Engine-room central corridor floor (-h..2.05) + 3 steps (2.05..2.95) + elevated Driver's Cockpit floor (2.95..6.80)
    B.add('inside', cbox((-h + 2.05) / 2, (F1 + fCor) / 2, 0, 2.05 + h, fCor - F1 + 0.04, 1.32, 0.01), C.aisleR3);
    for (let st = 0; st < 3; st++) {
      const us = 2.20 + st * 0.28, ys = fCor + ((st + 1) / 3) * (fCab - fCor);
      B.add('inside', cbox(us, (F1 + ys) / 2, 0, 0.30, ys - F1 + 0.04, 1.28, 0.01), C.aisleR3);
      B.add('dark', cbox(us - 0.14, ys + 0.005, 0, 0.03, 0.01, 1.20, 0.003), C.yellow);
    }
    B.add('inside', cbox(4.85, (F1 + fCab) / 2, 0, 3.90, fCab - F1 + 0.04, 2 * lin - 0.12, 0.01), C.floorR3);
    // Corridor & cockpit ceiling
    B.add('inside', new THREE.PlaneGeometry(1.40, 2.05 + h).rotateX(Math.PI / 2).translate(0, 3.22, -(-h + 2.05) / 2), C.ceiling);
    B.add('inside', new THREE.PlaneGeometry(2 * lin - 0.2, 3.80).rotateX(Math.PI / 2).translate(0, 3.46, -4.40), C.ceiling);
    for (let u = -7.5; u <= 4.5; u += 2.4) {
      B.add('panel', uvRect(new THREE.PlaneGeometry(0.18, 0.90).rotateX(Math.PI / 2).translate(0, u < 2.2 ? 3.21 : 3.45, -u), PANEL.led));
    }

    // Glazed engine-room corridor walls (w = +-0.58) + visible high-voltage traction transformer & inverter blocks behind the glass!
    for (const sd of [-1, 1]) {
      const wc = sd * 0.60;
      B.add('inside', cbox(-3.50, 1.42, wc, 11.10, 0.72, 0.05, 0.008), C.partition);
      B.add('inside', cbox(-3.50, 3.00, wc, 11.10, 0.44, 0.05, 0.008), C.partition);
      for (const up of [-8.8, -5.4, -1.8, 1.8]) B.add('inside', cbox(up, 2.28, wc, 0.24, 1.04, 0.06, 0.008), C.steel);
      B.add('glass', onSide(plane(10.4, 1.00).translate(0, 2.28, 3.50 * sd), sd * 0.59, -sd));
      // Visible internal machinery blocks (traction inverters, cooling towers, HV cabling)
      B.add('dark', cbox(-6.2, 2.05, sd * 1.15, 2.6, 1.65, 0.72, 0.04), C.steel);
      B.add('dark', cbox(-2.4, 2.10, sd * 1.15, 2.8, 1.75, 0.74, 0.04), C.axle);
      B.add('dark', cbox(0.6, 2.00, sd * 1.12, 1.8, 1.55, 0.68, 0.04), C.rust);
      B.add('dark', tube([-7.8, 2.65, sd * 0.95], [1.6, 2.65, sd * 0.95], 0.045, 6), C.yellow);
    }

    // Cab rear bulkhead wall with open doorway at u = 2.05
    addWallWithDoor(B, 2.05, -1, lin, fCor, 3.46, 0.48, fCor + 2.04, C.partition);
    B.add('panel', uvRect(onEnd(plane(0.66, 0.12).translate(0, fCor + 2.14, 0), 2.01, -1), PANEL.screen));

    // ---- Euroduplex Driver's Cockpit (u in [2.95, 7.20], floor at fCab = 1.24 m)
    // Wrap-around ergonomic control console (u in [5.68, 7.10])
    B.add('inside', cbox(6.28, fCab + 0.42, 0, 1.20, 0.84, 2.56, 0.04), C.cabDesk);
    for (const sd of [-1, 1]) {
      B.add('inside', cbox(5.32, fCab + 0.40, sd * 1.18, 1.10, 0.80, 0.56, 0.03), C.cabDesk);
      B.add('inside', cbox(4.20, fCab + 0.95, sd * 1.46, 2.40, 1.90, 0.08, 0.01), C.liningLow);
    }
    // 3 glowing driver displays : center TVM-430 / ETCS L2 speed & signaling, left diagnostic screen, right GSM-R / CCTV screen
    B.add('panel', uvRect(onEnd(plane(0.78, 0.24).rotateX(-0.48).translate(0, fCab + 0.94, 0), 5.82, -1), PANEL.cab));
    B.add('panel', uvRect(onEnd(plane(0.52, 0.22).rotateX(-0.45).translate(-0.68, fCab + 0.92, 0), 5.76, -1), PANEL.screen));
    B.add('panel', uvRect(onEnd(plane(0.52, 0.22).rotateX(-0.45).translate(0.68, fCab + 0.92, 0), 5.76, -1), PANEL.screenR1));
    // Traction/brake master controller lever (manipulateur de traction), brake valve, and red emergency mushroom button (coup-de-poing)
    B.add('dark', tube([5.65, fCab + 0.84, 0.34], [5.52, fCab + 1.04, 0.34], 0.020, 6), C.steel);
    B.add('dark', cyl(5.52, fCab + 1.05, 0.34, 0.028, 0.14, 'w', 8), C.black);
    B.add('panel', uvPanel(cyl(5.68, fCab + 0.87, -0.32, 0.045, 0.04, 'y', 10), PANEL.red));
    // Central pneumatic driver's armchair (siège conducteur central) + armrests + headrest + foldable jump seat (strapontin)
    B.add('dark', cyl(4.40, fCab + 0.18, 0, 0.10, 0.36, 'y', 10), C.steel);
    B.add('inside', cbox(4.40, fCab + 0.42, 0, 0.52, 0.12, 0.54, 0.03), C.cabSeat);
    B.add('inside', cbox(4.18, fCab + 0.82, 0, 0.10, 0.72, 0.50, 0.03), C.cabSeat);
    B.add('inside', cbox(4.16, fCab + 1.24, 0, 0.08, 0.22, 0.34, 0.02), C.headR1);
    for (const sd of [-1, 1]) B.add('inside', cbox(4.42, fCab + 0.62, sd * 0.29, 0.38, 0.05, 0.06, 0.01), C.black);
    // Accompanist jump seat (strapontin) on left cab wall
    B.add('inside', cbox(3.55, fCab + 0.44, -1.02, 0.42, 0.08, 0.40, 0.02), C.seatR3);
    B.add('inside', cbox(3.55, fCab + 0.78, -1.20, 0.42, 0.52, 0.06, 0.02), C.seatR3);

    // Underframe transformer
    B.add('dark', cbox(-1.0, yb - 0.12, 0, 5.4, 0.32, 2.10, 0.05), C.axle);
    return B.merge();
  }

  // ================================================================ DUPLEX PASSENGER COACHES (R1..R8 : Salle Basse + Escaliers + Salle Haute)
  const fCol = kind === 'coachR1' ? C.floorR1 : kind === 'coachR2' ? C.floorR2 : C.floorR3;
  const aCol = kind === 'coachR1' ? C.aisleR1 : kind === 'coachR2' ? C.aisleR2 : C.aisleR3;

  // 1. Lower Saloon Floor (FL = 0.36 m, u in [-3.75, +3.75]) + Vestibule Floors (F0 = 0.80 m, |u| in [5.55, 6.80]) + Gangway Ramps (F1 = 0.94 m)
  B.add('inside', cbox(0, FL - 0.02, 0, 7.60, 0.05, 2 * lin - 0.02, 0.01), fCol);
  B.add('inside', new THREE.PlaneGeometry(1.12, 7.50).rotateX(-Math.PI / 2).translate(0, FL + 0.004, 0), aCol);
  for (const sDir of [-1, 1]) {
    // Vestibule floor slab at F0 = 0.80 m
    B.add('inside', cbox(sDir * 6.20, (FL + F0) / 2, 0, 1.50, F0 - FL, 2 * lin - 0.02, 0.01), fCol);
    // Gangway raised floor slab at F1 = 0.94 m
    B.add('inside', cbox(sDir * 7.75, (FL + F1) / 2, 0, 1.65, F1 - FL, 2 * lin - 0.02, 0.01), fCol);
    // Right-hand ramp/steps down from vestibule (0.80 m at |u|=5.55) to Lower Saloon (0.36 m at |u|=3.75) on w in [-0.06, +lin]
    for (let st = 0; st < 4; st++) {
      const uSt = sDir * (5.32 - st * 0.44), ySt = F0 - ((st + 0.5) / 4) * (F0 - FL);
      B.add('inside', cbox(uSt, (FL + ySt) / 2, (lin - 0.06) / 2, 0.46, Math.max(0.04, ySt - FL), lin + 0.06, 0.008), aCol);
      B.add('dark', cbox(uSt - sDir * 0.21, ySt + 0.004, (lin - 0.06) / 2, 0.03, 0.01, lin + 0.02, 0.003), C.yellow);
    }

    // 2. Left-hand Duplex Staircase (8 steps climbing from F0 = 0.80 m at |u|=5.55 up to FU = 2.26 m at |u|=3.75, on w in [-lin, -0.14])
    const wStMid = (-lin - 0.14) / 2, wStW = lin - 0.14;
    for (let st = 0; st < 8; st++) {
      const uSt = sDir * (5.44 - st * 0.225), ySt = F0 + ((st + 1) / 8) * (FU - F0);
      B.add('inside', cbox(uSt, ySt - 0.09, wStMid, 0.25, 0.18, wStW - 0.02, 0.008), aCol);
      B.add('dark', cbox(uSt + sDir * 0.11, ySt + 0.003, wStMid, 0.03, 0.01, wStW - 0.04, 0.003), C.yellow);
    }
    // Under-stair angled soffit + vertical end bulkhead closing the space under the stairs from the lower saloon
    B.add('inside', cbox(sDir * 3.68, (FL + FU) / 2, wStMid, 0.08, FU - FL, wStW, 0.01), C.partition);
    // Stairwell divider wall at w = -0.10 (lower solid panel + upper glass panel + brushed steel handrails)
    B.add('inside', cbox(sDir * 4.65, 1.35, -0.10, 1.86, 2.00, 0.06, 0.01), C.partition);
    B.add('glass', onSide(plane(1.76, 0.95).translate(0, 2.82, -sDir * 4.65), -0.10, 1));
    B.add('inside', tube([sDir * 5.52, F0 + 0.92, -0.16], [sDir * 3.76, FU + 0.92, -0.16], 0.020, 6), C.steel);
    B.add('inside', tube([sDir * 5.52, F0 + 0.92, -lin + 0.05], [sDir * 3.76, FU + 0.92, -lin + 0.05], 0.020, 6), C.steel);
  }

  // 3. Intermediate Structural Deck Slab (separating Lower Saloon y <= 2.18 m from Upper Saloon y >= 2.26 m)
  // Full width across u in [-3.75, +3.75], plus right half w in [-0.10, +lin] across |u| in [3.75, 5.58] (leaving stairwell opening on w < -0.10!)
  B.add('inside', cbox(0, (ceilLow + FU) / 2, 0, 7.52, FU - ceilLow, 2 * lin - 0.02, 0.01), C.ceiling);
  B.add('inside', new THREE.PlaneGeometry(1.12, 7.50).rotateX(-Math.PI / 2).translate(0, FU + 0.004, 0), aCol);
  for (const sDir of [-1, 1]) {
    const wRightMid = (lin - 0.10) / 2, wRightW = lin + 0.10;
    B.add('inside', cbox(sDir * 4.66, (ceilLow + FU) / 2, wRightMid, 1.84, FU - ceilLow, wRightW, 0.01), C.ceiling);
    // Upper-deck glass balustrade & steel handrail along w > -0.14 at u = +-3.75 overlooking the right-hand lower passage
    B.add('inside', cbox(sDir * 3.72, FU + 0.52, (lin - 0.10) / 2, 0.06, 1.04, lin + 0.06, 0.01), C.partition);
    B.add('glass', onEnd(plane(lin - 0.10, 0.72).translate((lin + 0.06) / 2, FU + 1.38, 0), sDir * 3.72, -sDir));
    // Upper-deck end bulkhead at u = +-5.58 closing the upper level above the vestibule
    B.add('inside', cbox(sDir * 5.58, (FU + ceil) / 2, 0, 0.07, ceil - FU, 2 * lin - 0.02, 0.01), C.partition);
    const scr = kind === 'coachR1' ? PANEL.screenR1 : kind === 'coachR2' ? PANEL.screenBar : PANEL.screenR3;
    B.add('panel', uvRect(onEnd(plane(0.72, 0.14).translate(-0.85, FU + 1.92, 0), sDir * 5.53, -sDir), scr));
    B.add('panel', uvRect(onEnd(plane(0.68, 0.13).translate(0.65, ceilLow - 0.24, 0), sDir * 3.70, -sDir), scr));
  }

  // 4. Vaulted Upper-Deck Ceiling (y = ceil = 4.18 m) & Lower/Upper LED lighting strips
  {
    const cv = [[lin + 0.02, ceil - 0.14], [1.05, ceil], [-1.05, ceil], [-lin - 0.02, ceil - 0.14]];
    const pi = [];
    for (let i = 1; i < cv.length; i++) {
      const [w0, y0] = cv[i - 1], [w1, y1] = cv[i];
      pi.push(w0, y0, -h + 0.05, w1, y1, h - 0.05, w1, y1, -h + 0.05, w0, y0, -h + 0.05, w0, y0, h - 0.05, w1, y1, h - 0.05);
    }
    const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pi, 3)); gi.computeVertexNormals();
    B.add('inside', gi, C.ceiling);

    // Lower Saloon & Upper Saloon LED ceiling strips
    for (const side of [-1, 1]) {
      let k = 0;
      for (let u = -3.2; u <= 3.2; u += 1.25, k++) {
        const dead = hash(k, side + (kind === 'coachR2' ? 7 : 0), 4) > 0.90, flick = !dead && hash(k, side, 5) > 0.92;
        const gLow = new THREE.PlaneGeometry(0.06, 0.95).rotateX(Math.PI / 2).translate(side * 0.92, ceilLow - 0.006, -u);
        const gUp = new THREE.PlaneGeometry(0.06, 0.95).rotateX(Math.PI / 2).rotateZ(-side * 0.25).translate(side * 1.12, ceil - 0.008, -u);
        B.add(dead ? 'panel' : flick ? 'flicker' : 'panel', uvRect(gLow, dead ? PANEL.dead : PANEL.led));
        B.add('panel', uvRect(gUp, PANEL.led));
      }
    }
  }

  // 5. Interior side wall linings with both Lower and Upper window cutouts
  {
    const uLo = -h + 0.04, uHi = h - 0.04, doors = [...Q.doors].sort((p, q) => p - q);
    for (const side of [-1, 1]) {
      const X = (u) => sx(-side, u);
      const rangeShape = (p, q, y0, y1) => new THREE.Shape([new THREE.Vector2(Math.min(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y1), new THREE.Vector2(Math.min(X(p), X(q)), y1)]);
      const sideWins = Q.win.filter((w) => !w.side || w.side === side);
      const sideWinsU = (Q.winUpper || []).filter((w) => !w.side || w.side === side);
      let a = uLo; const pieces = [];
      for (const u of doors) { pieces.push([a, u - dw]); a = u + dw; } pieces.push([a, uHi]);
      for (const [p, q] of pieces) {
        if (q - p < 0.05) continue;
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, FL, winY0)), side * lin, -side), C.liningLow);
        const sh = rangeShape(p, q, winY0, ceil);
        for (const w of sideWins) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winY0 + w.dy + 0.001, X(w.u) + winW / 2, winY1 + w.dy - 0.001, 0.10, true));
        for (const w of sideWinsU) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winYU0 + w.dy + 0.001, X(w.u) + winW / 2, winYU1 + w.dy - 0.001, 0.10, true));
        B.add('inside', onSide(new THREE.ShapeGeometry(sh, 3), side * lin, -side), C.lining);
      }
      for (const u of doors) B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(u - dw, u + dw, dTop, ceil)), side * lin, -side), C.lining);
      for (const [wList, y0, y1] of [[sideWins, winY0, winY1], [sideWinsU, winYU0, winYU1]]) {
        for (const w of wList) {
          const fr = extr(ring(X(w.u) - winW / 2, y0 + w.dy, X(w.u) + winW / 2, y1 + w.dy, 0.10, 0.04), 0.025, 0, 3);
          onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition);
          if (kind === 'coachR1') {
            for (const e of [-1, 1]) B.add('inside', cbox(w.u + e * (winW / 2 + 0.04), (y0 + y1) / 2, side * (lin - 0.04), 0.14, y1 - y0 + 0.04, 0.04, 0.008), C.curtain);
          }
        }
      }
      // Upper-deck overhead luggage racks in R1 & R3
      if (kind === 'coachR1' || kind === 'coachR3') {
        const [r0, r1] = Q.saloon, rw = side * 1.02;
        B.add('inside', cyl((r0 + r1) / 2, 3.74, rw, 0.020, r1 - r0 - 0.2, 'u', 6), C.rack);
        B.add('glass', new THREE.PlaneGeometry(lin - 1.04, r1 - r0 - 0.2).rotateX(-Math.PI / 2).translate(side * (lin + 1.02) / 2, 3.73, -(r0 + r1) / 2));
      }
    }
  }

  // 6. Contoured Seats & Bay Tables on BOTH Lower Saloon (FL = 0.36 m) and Upper Saloon (FU = 2.26 m)
  if (Q.seats.length || (Q.seatsUpper && Q.seatsUpper.length)) {
    const prof = new THREE.Shape();
    prof.moveTo(0.0, 0.36); prof.lineTo(0.44, 0.37); prof.quadraticCurveTo(0.49, 0.39, 0.46, 0.46); prof.lineTo(0.12, 0.49);
    prof.lineTo(0.09, 0.56); prof.lineTo(0.02, 1.06); prof.quadraticCurveTo(0.01, 1.18, -0.07, 1.17); prof.lineTo(-0.10, 1.10);
    prof.lineTo(-0.06, 0.46); prof.lineTo(0.0, 0.36);
    const sCol = kind === 'coachR1' ? C.seatR1 : C.seatR3;
    const hCol = kind === 'coachR1' ? C.headR1 : C.headR3;
    for (const [seatList, tabList, fy] of [[Q.seats, Q.tables, FL], [Q.seatsUpper || [], Q.tablesUpper || [], FU]]) {
      for (const st of seatList) {
        const sw = st.width || 0.42;
        const g = extr(prof, sw, 0, 2); g.translate(0, 0, -sw / 2);
        g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, fy, -st.u);
        B.add('inside', g, sCol);
        B.add('inside', cbox(st.u + st.dir * 0.05, fy + 1.00, st.w, 0.04, 0.18, sw * 0.72, 0.012), hCol);
        if (st.arm) B.add('inside', cbox(st.u + st.dir * 0.22, fy + 0.60, st.w + st.arm * (sw / 2 + 0.02), 0.36, 0.045, 0.045, 0.01), C.pedestal);
        if (st.tablette) B.add('inside', cbox(st.u - st.dir * 0.09, fy + 0.70, st.w, 0.025, 0.24, sw * 0.78, 0.005), C.tablette);
      }
      for (const tb of tabList) {
        const tw = tb.w1 - tb.w0, wc = (tb.w0 + tb.w1) / 2;
        B.add('inside', cbox(tb.u, tb.y, wc, tb.len, 0.04, tw, 0.01), kind === 'coachR1' ? C.wood : C.lining);
        B.add('inside', tube([tb.u, fy, wc], [tb.u, tb.y - 0.02, wc], 0.032, 6), C.pedestal);
        if (tb.lamp) {
          B.add('inside', tube([tb.u, tb.y + 0.02, tb.lamp], [tb.u, tb.y + 0.22, tb.lamp], 0.012, 6), C.brass);
          B.add('panel', uvRect(cyl(tb.u, tb.y + 0.26, tb.lamp, 0.06, 0.09, 'y', 8, 0.042), PANEL.lampBar));
        }
      }
    }
  }

  // 7. R4 Voiture Bar Duplex ("Le Bistro" on Upper Deck FU = 2.26 m + Service & Perch Lounge on Lower Deck FL = 0.36 m)
  if (kind === 'coachR2') {
    const { u0: bu0, u1: bu1, mangeU, lowerU } = Q.bar, bLen = bu1 - bu0, bMid = (bu0 + bu1) / 2;
    // Lower deck service modules (-w) & standing bar tables (+w)
    B.add('inside', cbox(0, FL + 0.88, -1.12, 6.20, 1.72, 0.96, 0.02), C.partition);
    B.add('panel', uvRect(onSide(plane(1.40, 0.38), -0.63, 1).translate(0, FL + 1.25, 0), PANEL.screenBar));
    for (const ul of lowerU) {
      B.add('inside', cbox(ul, FL + 0.96, 1.26, 1.05, 0.05, 0.56, 0.015), C.barWood);
      B.add('inside', tube([ul, FL, 1.22], [ul, FL + 0.94, 1.22], 0.035, 6), C.barChrome);
    }

    // Upper Deck "Le Bistro" Bar Counter (-w, u in [-2.45, +2.45])
    B.add('inside', cbox(bMid, FU + 0.48, -1.36, bLen - 0.1, 0.96, 0.46, 0.015), C.barWood);
    B.add('inside', cbox(bMid, FU + 1.56, -1.40, bLen - 0.1, 0.36, 0.38, 0.015), C.barWood);
    B.add('panel', uvRect(onSide(plane(bLen - 0.4, 0.05), -1.18, 1).translate(0, FU + 1.38, -bMid), PANEL.barSign));
    // Chilled drinks vitrine & Espresso machine & Menu Board on Upper Deck
    B.add('inside', cbox(-0.90, FU + 1.18, -1.36, 1.65, 0.72, 0.24, 0.015), C.barFront);
    B.add('panel', uvRect(onSide(plane(1.52, 0.64), -1.23, 1).translate(0, FU + 1.18, 0.90), PANEL.vitrine));
    B.add('inside', cbox(1.15, FU + 1.12, -1.32, 0.68, 0.38, 0.32, 0.02), C.barChrome);
    B.add('panel', uvRect(onSide(plane(1.15, 0.40), -1.20, 1).translate(0, FU + 1.50, -1.15), PANEL.screenBar));

    // Curved front counter on Upper Deck (w in [-0.76, -0.40])
    B.add('inside', cbox(bMid, FU + 0.52, -0.58, bLen, 1.04, 0.34, 0.02), C.barFront);
    B.add('inside', cbox(bMid, FU + 1.06, -0.56, bLen + 0.04, 0.05, 0.40, 0.01), C.barChrome);
    B.add('inside', cbox(bMid, FU + 0.95, -0.40, bLen, 0.06, 0.03, 0.005), C.barCarmine);
    B.add('inside', cyl(bMid, FU + 0.16, -0.34, 0.018, bLen - 0.2, 'u', 6), C.barChrome);

    // Upper-deck panoramic mange-debout high tables + carmine bar stools on +w
    for (const ut of mangeU) {
      B.add('inside', cbox(ut, FU + 0.98, 1.24, 1.16, 0.05, 0.58, 0.015), C.barWood);
      B.add('inside', tube([ut, FU, 1.22], [ut, FU + 0.96, 1.22], 0.035, 6), C.barChrome);
      B.add('panel', uvRect(cyl(ut, FU + 1.24, 1.38, 0.06, 0.09, 'y', 8, 0.045), PANEL.lampBar));
      for (const du of [-0.40, 0.40]) {
        B.add('inside', cyl(ut + du, FU + 0.35, 1.06, 0.024, 0.70, 'y', 6), C.barChrome);
        B.add('inside', cyl(ut + du, FU + 0.72, 1.06, 0.16, 0.07, 'y', 8), C.barCarmine);
      }
    }
  }

  // 8. Vestibule glass partitions (at u = +-5.58, F0 = 0.80 m)
  for (const u0 of Q.parts) {
    const pd = W.partitionDoor / 2, dir = u0 > 0 ? 1 : -1;
    addWallWithDoor(B, u0, dir, lin, F0, FU, pd, F0 + 1.98, C.partition, [F0 + 0.88, F0 + 1.72, lin]);
  }

  // 9. Underframe equipment skirts
  for (const u of [-3.2, 0.0, 3.2]) B.add('dark', cbox(u, yb - 0.10, 0, 2.1, 0.24, 1.95, 0.04), C.axle);

  // 10. Blood decals inside passenger coaches
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  if (Q.legroom.length) {
    const c = Q.legroom[Math.min(1, Q.legroom.length - 1)].u;
    B.add('decal', quarter(new THREE.PlaneGeometry(0.75, 1.35).rotateX(-Math.PI / 2).translate(0.04, FL + 0.006, -c), 1, 0));
    B.add('decal', quarter(new THREE.PlaneGeometry(0.65, 1.15).rotateX(-Math.PI / 2).translate(-0.04, FU + 0.006, c), 0, 1));
  }
  return B.merge();
}

// door leaf (Carmillon plug door) : X across, Y up, Z along
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floor, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.08);
  s.holes.push(rrect(-0.30, F + 0.95, 0.30, F + 1.78, 0.07, true));
  const g = extr(s, 0.05, 0.008, 3); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  { const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = ATLAS.door; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, 1 - (r0 + (1 - (p.getY(i) - F) / T.doorH) * (r1 - r0)) / 1024); }
  B.add('body', g);
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.30, F + 0.95, 0.30, F + 1.78, 0.07), 3), 0, 1));
  const out = B.merge();
  return { leaf: out.body, glass: out.glass };
}

// ------------------------------------------------------------------ lamps (twin cheek headlights + 3rd top marker)
export function buildLampGeometry() {
  const B = buckets();
  for (const sw of [-1, 1]) {
    const main = new THREE.ShapeGeometry(rrect(-0.11, -0.06, 0.11, 0.06, 0.025), 3);
    main.rotateY(Math.PI - sw * 0.34); main.translate(sw * 0.55, 0.98, -8.685);
    B.add('lamp', main);
    const mark = new THREE.ShapeGeometry(rrect(-0.045, -0.038, 0.045, 0.038, 0.015), 2);
    mark.rotateY(Math.PI - sw * 0.34); mark.translate(sw * 0.41, 0.98, -8.73);
    B.add('lamp', mark);
  }
  const topM = new THREE.CircleGeometry(0.06, 10);
  topM.rotateY(Math.PI); topM.rotateX(-0.45); topM.translate(0, 3.75, -5.18);
  B.add('lamp', topM);
  return B.merge().lamp;
}

// ------------------------------------------------------------------ motrice cab interior (now merged into buildCarGeometry('motrice') for 0 extra draw calls)
export function buildCabGeometry() {
  return {};
}

// ------------------------------------------------------------------ TGV Faiveley pantographs
export function buildPantograph(up) {
  const B = buckets(), yBase = CONFIG.train.height - 0.10, wire = CONFIG.railNet.wire.contact, u = 0;
  B.add('dark', cbox(u, yBase + 0.14, 0, 1.25, 0.06, 1.25, 0.015), C.steel);
  for (const s of [-1, 1]) for (const du of [-0.48, 0.48]) B.add('dark', cyl(u + du, yBase + 0.06, s * 0.50, 0.062, 0.13, 'y', 8), C.insulator);
  const knee = up ? [u - 1.15, (yBase + wire) / 2 + 0.08] : [u - 1.10, yBase + 0.28];
  const head = up ? [u + 0.05, wire - 0.05] : [u + 0.12, yBase + 0.36];
  for (const s of [-1, 1]) {
    B.add('dark', tube([u + 0.45, yBase + 0.16, s * 0.28], [knee[0], knee[1], s * 0.24], 0.028, 6), C.steel);
    B.add('dark', tube([knee[0], knee[1], s * 0.24], [head[0], head[1], s * 0.10], 0.020, 6), C.steel);
  }
  const bowW = up ? 1.60 : 1.76;
  B.add('dark', cyl(head[0], head[1], 0, 0.030, bowW, 'w', 8), C.steel);
  for (const s of [-1, 1]) B.add('dark', tube([head[0], head[1], s * (bowW / 2)], [head[0], head[1] - 0.15, s * (bowW / 2 + 0.15)], 0.018, 5), C.steel);
  return B.merge().dark;
}

// ------------------------------------------------------------------ cab blood decals (aligned to TGV nose loft + bow)
export function buildCabBlood(n = 4) {
  const T = CONFIG.train, h = T.cars[0] / 2, Wd = T.width / 2, LnBase = T.layout.taper - 0.26, u0 = h - T.layout.taper, out = [];
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  const at = (t, w) => {
    const S = noseSection(t), a = Wd * S.fw;
    const duBow = 0.26 * (1 - Math.pow(clamp(Math.abs(w) / (a || 1), 0, 1), 2)) * Math.pow(t, 1.6);
    return [u0 + LnBase * t + duBow, S.yTop];
  };
  for (let k = 0; k < n; k++) {
    let g;
    if (k < 3) {
      const sw = k === 1 ? 1 : -1, w = sw * (0.38 + hash(k, 7) * 0.24);
      const t = 0.37 + 0.07 * k, [u, y] = at(t, w), [u2, y2] = at(t + 0.06, w), slope = Math.atan2(y - y2, u2 - u);
      const d = 0.045 + k * 0.004;
      g = quarter(new THREE.PlaneGeometry(k === 2 ? 0.95 : 0.72, k === 2 ? 0.75 : 0.56), k === 2 ? 1 : 0, 0);
      g.rotateZ(hash(k, 5) * TAU * 0.3); g.rotateX(-Math.PI / 2 + slope); g.rotateY(Math.PI);
      g.translate(w, y + d, -u);
    } else {
      const w = 0.08, t = 0.58, [u, y] = at(t, w), [u2, y2] = at(t + 0.06, w), slope = Math.atan2(y - y2, u2 - u);
      g = quarter(new THREE.PlaneGeometry(1.05, 0.65), 1, 1);
      g.rotateZ(0.2); g.rotateX(-Math.PI / 2 + slope); g.rotateY(Math.PI);
      g.translate(w, y + 0.055, -u);
    }
    out.push(g);
  }
  return out;
}
