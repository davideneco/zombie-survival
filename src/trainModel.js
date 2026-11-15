import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  SNCF TGV M / Avelia Horizon & Euroduplex InOui (2 Decks, 10-car consist) :
//  Geometry, canvas textures, and collision layouts (no game state).
//  Full 10-vehicle double-decker consist (2 Motrices + 8 Remorques Duplex, 177.76 m total, 3.64 m wide, 5.28 m high):
//    0: M1     (Lead Motrice, 18.20 m, walkable glazed engine-room corridor + TGV M driver's cockpit with crimson pillars & ETCS screens)
//    1..3: R1..R3 (1re Classe TGV M, 17.20 m, Lower & Upper saloons, 2+1 burgundy/terracotta seats with grey shells & taupe headrests, oak tables)
//    4: R4     (Voiture Bar TGV M "Le Bistro", 17.20 m, Lower Deck Bistro counter & self-service fridges + Upper Deck Lounge alcoves, oak bar & yellow lamps)
//    5..8: R5..R8 (2nde Classe TGV M, 17.20 m, Lower & Upper saloons, 2+2 navy/petrol-blue seats with grey shells & light-grey headrests)
//    9: M2     (Tail Motrice, 18.20 m, mirrored 180°, walkable rear TGV M driver's cockpit + engine-room corridor, red tail markers)
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
    tables: (Q.tables || []).map((t) => ({ ...t, u: -t.u, w0: -t.w1, w1: -t.w0, lamp: t.lamp ? -t.lamp : 0 })),
    tablesUpper: (Q.tablesUpper || []).map((t) => ({ ...t, u: -t.u, w0: -t.w1, w1: -t.w0, lamp: t.lamp ? -t.lamp : 0 })),
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
  const T = CONFIG.train, W = T.walk, F0 = T.floor, F1 = T.floorHigh, FL = T.floorLow ?? 0.30, FU = T.floorUpper ?? 2.76, wall = W.wall;
  const winW = 1.22, [winY0, winY1] = T.winY, [winYU0, winYU1] = T.winYUpper || [3.44, 4.40];

  // M1 / M2 : walkable power cars with glazed engine-room corridor (u in [-9.1, 2.05], w in [-0.58, 0.58]) + elevated TGV M driver's cockpit (u in [2.95, 5.65], w in [-1.28, 1.28])
  const makeMotrice = (len) => {
    const h = len / 2, Q = {
      kind: 'motrice', geoKind: 'motrice', walkable: true, duplex: false, mirrored: false,
      len, h, doors: [], win: [], winUpper: [], legroom: [{ u: 0 }], seats: [], seatsUpper: [], tables: [], tablesUpper: [],
      blocks: [], blocksUpper: [], parts: [], zones: [], openEnds: [-h], ledU: [-5.5, -2.0, 1.0, 4.2],
      saloon: [-8.6, 5.65],
      cab: { u: 2.05, dir: 1, open: true, y: 1.06, text: 'Cabine de pilotage — TGV M InOui' },
    };
    // Engine-room service corridor walls (1.16 m central glazed corridor w in [-0.58, +0.58] from rear gangway to cab doorway)
    Q.blocks.push({ u0: -h + 0.35, u1: 2.12, w0: -wall, w1: -0.58 });
    Q.blocks.push({ u0: -h + 0.35, u1: 2.12, w0: 0.58, w1: wall });
    // Cab doorway jambs at u = 2.05 (doorway opening w in [-0.48, +0.48])
    Q.blocks.push({ u0: 1.98, u1: 2.14, w0: -wall, w1: -0.48 });
    Q.blocks.push({ u0: 1.98, u1: 2.14, w0: 0.48, w1: wall });
    // Tapered cockpit side consoles & crimson side pillars (leaves w in [-1.24, +1.24] inside the driver's cab)
    Q.blocks.push({ u0: 2.85, u1: 5.72, w0: -wall, w1: -1.24 });
    Q.blocks.push({ u0: 2.85, u1: 5.72, w0: 1.24, w1: wall });
    // Central leather driver's armchair block (walkable around both left and right sides!)
    Q.blocks.push({ u0: 4.10, u1: 4.62, w0: -0.28, w1: 0.28 });
    // Wrap-around TGV M front control desk & nose cone boundary
    Q.blocks.push({ u0: 5.66, u1: h + 0.6, w0: -wall - 0.2, w1: wall + 0.2 });
    return Q;
  };

  // Shared TGV M Duplex coach base (17.20 m, h = 8.60 m, 2 plug doors per side at +-6.35, 2 staircases at |u| in [3.85, 5.55] on w < -0.06, lower ramp on w > +0.06)
  const initDuplex = (kind, len, nBay, bay, bayU0) => {
    const h = len / 2, Q = {
      kind, geoKind: kind, walkable: true, duplex: true, mirrored: false,
      len, h, doors: [-6.35, 6.35], win: [], winUpper: [], legroom: [],
      seats: [], seatsUpper: [], tables: [], tablesUpper: [],
      blocks: [], blocksUpper: [], parts: [], zones: [], openEnds: [-h, h],
      ledU: [-6.35, 6.35], saloon: [-3.85, 3.85], bay, bayU0, nBay, cab: null,
    };
    for (const sDir of [-1, 1]) {
      // 1. Stairwell central divider wall + fluted glass balustrade at w in [-0.08, +0.08], |u| in [3.85, 5.55] (on both decks!)
      const u0 = sDir > 0 ? 3.85 : -5.55, u1 = sDir > 0 ? 5.55 : -3.85;
      Q.blocks.push({ u0, u1, w0: -0.08, w1: 0.08 });
      Q.blocksUpper.push({ u0, u1, w0: -0.08, w1: 0.08 });

      // 2. Lower-deck under-stair bulkhead at |u| in [3.78, 3.88], w in [-wall, 0.08] closing the space under the left stairs from the lower saloon
      const us0 = sDir > 0 ? 3.78 : -3.88, us1 = sDir > 0 ? 3.88 : -3.78;
      Q.blocks.push({ u0: us0, u1: us1, w0: -wall - 0.1, w1: 0.08 });

      // 3. Upper-deck right stairwell balustrade at |u| >= 3.78, w in [-0.08, wall] (leaves |u| in [2.90, 3.78] as a full-width 0.88 m upper landing!)
      const ub0 = sDir > 0 ? 3.78 : -h - 0.5, ub1 = sDir > 0 ? h + 0.5 : -3.78;
      Q.blocksUpper.push({ u0: ub0, u1: ub1, w0: -0.08, w1: wall + 0.2 });

      // 4. Vestibule 3-tier aluminum luggage shelves near the gangways (|u| in [7.25, 8.20], leaves 1.64 m central aisle w in [-0.82, +0.82])
      const ul0 = sDir > 0 ? 7.25 : -8.20, ul1 = sDir > 0 ? 8.20 : -7.25;
      for (const blk of [Q.blocks, Q.blocksUpper]) {
        blk.push({ u0: ul0, u1: ul1, w0: -wall, w1: -0.82 });
        blk.push({ u0: ul0, u1: ul1, w0: 0.82, w1: wall });
      }
    }
    return Q;
  };

  // R1..R3 : 1re Classe TGV M (17.20 m, 3 spacious bays @ 1.98 m on BOTH Lower and Upper decks, 2+1 burgundy/terracotta seats, wide 1.24 m aisle, 0.95 m stair landings)
  const makeR1 = (len) => {
    const bay = 1.98, u0 = -2.97, Q = initDuplex('coachR1', len, 3, bay, u0);
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
          for (const [ub, dir] of [[a + 0.28, 1], [a + bay - 0.28, -1]]) {
            seats.push({ u: ub, dir, w: -1.18, width: 0.56, arm: 1 });
            seats.push({ u: ub, dir, w: 0.88, width: 0.46, arm: -1 });
            seats.push({ u: ub, dir, w: 1.38, width: 0.46, arm: 0 });
            const lo = Math.min(ub - dir * 0.14, ub + dir * 0.44), hi = Math.max(ub - dir * 0.14, ub + dir * 0.44);
            blocks.push({ u0: lo, u1: hi, w0: -wall, w1: -0.66 });
            blocks.push({ u0: lo, u1: hi, w0: 0.58, w1: wall });
          }
          tables.push({ u: uc, w0: -1.62, w1: -0.82, y: fy + 0.72, len: 0.48, lamp: -1.48 });
          tables.push({ u: uc, w0: 0.72, w1: 1.62, y: fy + 0.72, len: 0.48, lamp: 1.48 });
          blocks.push({ u0: uc - 0.22, u1: uc + 0.22, w0: -wall, w1: -0.78 });
          blocks.push({ u0: uc - 0.22, u1: uc + 0.22, w0: 0.68, w1: wall });
        } else {
          for (const ub of [a + 0.34, a + 1.38]) {
            seats.push({ u: ub, dir: 1, w: -1.18, width: 0.56, arm: 1, tablette: true });
            seats.push({ u: ub, dir: 1, w: 0.88, width: 0.46, arm: -1, tablette: true });
            seats.push({ u: ub, dir: 1, w: 1.38, width: 0.46, arm: 0, tablette: true });
            blocks.push({ u0: ub - 0.14, u1: ub + 0.42, w0: -wall, w1: -0.66 });
            blocks.push({ u0: ub - 0.14, u1: ub + 0.42, w0: 0.58, w1: wall });
          }
        }
      }
    }
    return Q;
  };

  // R4 : Voiture Bar TGV M "Le Bistro" (17.20 m : Lower Deck Bistro counter & self-service fridges + Upper Deck Lounge alcoves, oak bar & yellow TGV M lamps)
  const makeR2 = (len) => {
    const bay = 2.36, u0 = -3.54, Q = initDuplex('coachR2', len, 3, bay, u0);
    Q.bar = {
      u0: -2.85, u1: 2.85,
      alcovesU: [-2.20, 0.00, 2.20],
      stoolsU: [-2.50, -1.50, -0.50, 0.50, 1.50, 2.50],
      lowerU: [-2.20, 0.00, 2.20],
    };
    // Lower deck (wagonbarbas.jpg) : burgundy & light-oak Bistro counter on -w (w in [-wall, -0.68]), refrigerated drink fridges & oak counter on +w (w in [0.82, wall])
    for (const u of [0.60, 2.20]) Q.win.push({ u, dy: 0, side: 1 });
    for (const u of Q.bar.lowerU) {
      Q.legroom.push({ u });
      Q.ledU.push(u);
    }
    Q.blocks.push({ u0: -2.85, u1: 2.85, w0: -wall, w1: -0.68 });
    Q.blocks.push({ u0: -2.85, u1: 2.85, w0: 0.82, w1: wall });

    // Upper deck (wagonbarhaut.jpg & wagonbarhaut2.jpg) :
    // Panoramic windows on BOTH sides (-w above the oak high table & turquoise poufs, +w above the curved lounge alcoves)
    for (const u of [-2.36, 0.00, 2.36]) {
      Q.winUpper.push({ u, dy: 0, side: 0 });
    }
    // Left side (-w) : long light-oak high bar table + turquoise poufs + yellow lamps (w in [-wall, -0.58])
    Q.blocksUpper.push({ u0: -2.90, u1: 2.90, w0: -wall, w1: -0.58 });
    // Right side (+w) : 3 sculpted lounge banquettes/alcoves + rounded oak tables + burgundy sorting bins (w in [0.58, wall])
    Q.blocksUpper.push({ u0: -2.90, u1: 2.90, w0: 0.58, w1: wall });
    return Q;
  };

  // R5..R8 : 2nde Classe TGV M (17.20 m, 4 bays @ 1.48 m on BOTH Lower and Upper decks, 2+2 navy/petrol-blue seats, wide 1.16 m central aisle, 0.95 m stair landings)
  const makeR3 = (len) => {
    const bay = 1.48, u0 = -2.96, Q = initDuplex('coachR3', len, 4, bay, u0);
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
              seats.push({ u: ub, dir, w: sd * 0.86, width: 0.43, arm: -sd });
              seats.push({ u: ub, dir, w: sd * 1.36, width: 0.43, arm: 0 });
              const lo = Math.min(ub - dir * 0.12, ub + dir * 0.38), hi = Math.max(ub - dir * 0.12, ub + dir * 0.38);
              blocks.push({ u0: lo, u1: hi, w0: sd > 0 ? 0.58 : -wall, w1: sd > 0 ? wall : -0.58 });
            }
          }
          for (const sd of [-1, 1]) {
            tables.push({ u: uc, w0: sd > 0 ? 0.72 : -1.62, w1: sd > 0 ? 1.62 : -0.72, y: fy + 0.72, len: 0.38, lamp: 0 });
            blocks.push({ u0: uc - 0.18, u1: uc + 0.18, w0: sd > 0 ? 0.72 : -wall, w1: sd > 0 ? wall : -0.72 });
          }
        } else {
          for (const ub of [a + 0.18, a + 0.94]) {
            for (const sd of [-1, 1]) {
              seats.push({ u: ub, dir: 1, w: sd * 0.86, width: 0.43, arm: -sd, tablette: true });
              seats.push({ u: ub, dir: 1, w: sd * 1.36, width: 0.43, arm: 0, tablette: true });
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
//  - motrice : gangway (0.88 m) -> engine corridor (1.06 m) -> steps (1.06..1.32 m) -> driver's cockpit (1.32 m)
//  - duplex coach : gangways (0.88 m) -> vestibule (0.80 m) -> left staircase (0.80..2.76 m on w < 0) / right lower ramp (0.80..0.30 m on w >= 0) -> Lower Saloon (0.30 m) or Upper Saloon (2.76 m)
export function floorOfCar(Q, u, w = 0, relY = null) {
  const T = CONFIG.train;
  if (Q.kind === 'motrice' || Q.kind === 'motriceT') {
    const um = Q.mirrored ? -u : u;
    if (um < -7.5) return T.floorHigh + clamp((um + 9.1) / 1.6, 0, 1) * (1.06 - T.floorHigh);
    if (um < 2.05) return 1.06;
    if (um < 2.95) return 1.06 + ((um - 2.05) / 0.90) * (1.32 - 1.06);
    return 1.32;
  }
  if (Q.duplex) {
    const a = Math.abs(u), F0 = T.floor, F1 = T.floorHigh, FL = T.floorLow ?? 0.30, FU = T.floorUpper ?? 2.76;
    if (a >= 7.15) return F1;
    if (a > 6.70) return F0 + ((a - 6.70) / 0.45) * (F1 - F0);
    if (a >= 5.55) return F0;
    if (a >= 3.85) {
      // The central divider wall at w in [-0.08, +0.08] separates the left staircase (w < 0) from the right lower ramp (w >= 0).
      // Guard against corner grazing from the lower saloon (relY < 0.70) or upper saloon (relY > 1.85):
      if (w >= -0.08 && a < 4.50 && relY != null && relY > 1.85) return FU;
      if (w < 0 && !(a < 4.50 && relY != null && relY < 0.70)) {
        const t = (5.55 - a) / 1.70; // 0 at vestibule (5.55), 1 at upper landing (3.85)
        return F0 + clamp(t, 0, 1) * (FU - F0);
      }
      const tLow = (5.55 - a) / 1.70; // 0 at vestibule (5.55), 1 at lower saloon (3.85)
      return F0 + clamp(tLow, 0, 1) * (FL - F0);
    }
    return (relY != null && relY > 1.55) ? FU : FL;
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

// body atlas 1024 x 1024 (y 0.30..4.68 for Duplex double-decker side bands)
export const ATLAS = {
  sideMotrice: [0, 180, 0.30, 4.68],
  sideR1:      [180, 360, 0.30, 4.68],
  sideR2:      [360, 540, 0.30, 4.68],
  sideR3:      [540, 720, 0.30, 4.68],
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
      // Satin pearl-silver / French Berry Grey TGV M InOui skin
      const g = x.createLinearGradient(0, r0, 0, r1);
      g.addColorStop(0, '#d8dce0'); g.addColorStop(0.50, '#c5c9ce'); g.addColorStop(1, '#989da3');
      x.fillStyle = g; x.fillRect(0, r0, W, H);

      // Dark anthracite solebar skirt (y 0.30..0.88)
      x.fillStyle = '#22262b'; x.fillRect(0, py(0.88), W, r1 - py(0.88));

      const carm = x.createLinearGradient(0, r0, W, r1);
      carm.addColorStop(0, '#b81d5b'); carm.addColorStop(1, '#7a1b54');

      if (kind === 'motrice') {
        // Motrice upper equipment band & louvers
        x.fillStyle = '#24282d'; x.fillRect(0, py(4.05), W, py(2.15) - py(4.05));
        // Diagonal Carmillon / InOui flash behind cab
        x.fillStyle = carm;
        x.beginPath(); x.moveTo(600, r1); x.lineTo(670, r1); x.lineTo(750, r0); x.lineTo(685, r0); x.closePath(); x.fill();
        // Charcoal cab mask across the nose
        x.fillStyle = '#1b1e22';
        x.beginPath(); x.moveTo(670, r1); x.lineTo(W, r1); x.lineTo(W, r0); x.lineTo(750, r0); x.closePath(); x.fill();
      } else {
        // Double-decker TGV M lower window ribbon (y 0.96..1.96) & upper window ribbon (y 3.40..4.42)
        x.fillStyle = '#1d2126';
        x.fillRect(140, py(1.96), W - 280, py(0.96) - py(1.96));
        x.fillRect(120, py(4.42), W - 240, py(3.40) - py(4.42));
        // Structural belt between lower & upper decks (y 1.96..3.40) with longitudinal crease
        x.fillStyle = 'rgba(255,255,255,0.28)'; x.fillRect(0, py(2.74), W, 2);
        x.fillStyle = 'rgba(25,28,32,0.28)'; x.fillRect(0, py(2.70), W, 2);

        if (kind === 'R1') {
          // 1re Classe burgundy-carmine stripe above upper windows + Carmillon door surrounds
          x.fillStyle = '#a4194c'; x.fillRect(0, py(4.54), W, py(4.42) - py(4.54));
          x.fillStyle = carm;
          x.fillRect(0, r0, 88, H); x.fillRect(W - 88, r0, 88, H);
        } else if (kind === 'R2') {
          // Voiture Bar TGV M "Le Bistro" : sweeping Carmillon / burgundy graphic across the central Bistro zone
          const wave = x.createLinearGradient(220, 0, 804, 0);
          wave.addColorStop(0, 'rgba(184,29,91,0)'); wave.addColorStop(0.2, '#b81d5b'); wave.addColorStop(0.8, '#8e1b52'); wave.addColorStop(1, 'rgba(104,25,74,0)');
          x.fillStyle = wave; x.fillRect(220, py(4.50), 584, py(0.92) - py(4.50));
        } else if (kind === 'R3') {
          // 2nde Classe petrol-blue stripe above upper windows + Carmillon door surrounds
          x.fillStyle = '#1f5a82'; x.fillRect(0, py(4.54), W, py(4.42) - py(4.54));
          x.fillStyle = carm;
          x.fillRect(0, r0, 72, H); x.fillRect(W - 72, r0, 72, H);
        }
      }

      // Panel seams & subtle lower road grime
      for (let k = 0; k < 18; k += 1.5) { x.fillStyle = 'rgba(24,26,28,0.22)'; x.fillRect((k / 18) * W, r0, 1, H); }
      const gd = x.createLinearGradient(0, py(1.05), 0, r1);
      gd.addColorStop(0, 'rgba(20,18,16,0)'); gd.addColorStop(1, 'rgba(20,18,16,0.48)');
      x.fillStyle = gd; x.fillRect(0, py(1.05), W, r1 - py(1.05));
    };

    drawSideBand(ATLAS.sideMotrice, 'motrice');
    drawSideBand(ATLAS.sideR1, 'R1');
    drawSideBand(ATLAS.sideR2, 'R2');
    drawSideBand(ATLAS.sideR3, 'R3');

    // ---- Logos band [720..816]
    x.fillStyle = '#c5c9ce'; x.fillRect(0, 720, W, 96);
    {
      const g = x.createLinearGradient(14, 728, 226, 808);
      g.addColorStop(0, '#b81d5b'); g.addColorStop(1, '#7a1b54');
      x.fillStyle = g; x.beginPath(); x.roundRect(14, 730, 212, 76, 14); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'bold italic 46px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('SNCF', 120, 770);
    }
    {
      x.fillStyle = '#c5c9ce'; x.fillRect(240, 720, 400, 96);
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
      x.fillStyle = '#1f5a82'; x.fillRect(736, 720, 96, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('2', 784, 758);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('2nde', 784, 798);
    }
    {
      x.fillStyle = '#821c24'; x.fillRect(832, 720, 192, 96);
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
        x.fillStyle = `rgba(${22 + hash(k, 1) * 26},${20 + hash(k, 2) * 18},16,0.24)`;
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
    x.fillStyle = '#fff8eb'; x.fillRect(0, 0, 128, 32); // warm white TGV M LED coves
    x.fillStyle = '#0b130c'; x.fillRect(128, 0, 64, 32); x.fillStyle = '#4dff7a'; x.beginPath(); x.arc(160, 16, 11, 0, TAU); x.fill();
    x.fillStyle = '#ff2a1a'; x.fillRect(192, 0, 64, 32);
    x.fillStyle = '#fff2d8'; x.fillRect(256, 0, 64, 32);
    x.fillStyle = '#1c1e20'; x.fillRect(320, 0, 64, 32);
    x.fillStyle = '#ffcf48'; x.fillRect(384, 0, 64, 32); // warm yellow TGV M Bistro lamp glow
    x.fillStyle = '#ffe8bf'; x.fillRect(448, 0, 64, 32);

    // TGV M ETCS L2 / KVB dark-mode cab display (cabinepilotage.jpg) [0, 32, 256, 64]
    x.fillStyle = '#080d14'; x.fillRect(0, 32, 256, 32);
    x.fillStyle = '#102236'; x.fillRect(4, 35, 84, 26);
    x.fillStyle = '#4de88a'; x.font = 'bold 13px monospace'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText('320 km/h', 8, 48);
    x.fillStyle = '#2563eb'; x.fillRect(92, 35, 76, 26);
    x.fillStyle = '#ffffff'; x.font = 'bold 12px monospace'; x.fillText('ETCS L2', 98, 48);
    x.fillStyle = '#18344e'; x.fillRect(174, 35, 78, 26);
    x.fillStyle = '#7ec8ff'; x.fillText('25kV AC', 180, 48);

    // Exterior LED board + Staircase seat direction pill sign (couloir.jpg: 240-287 ↑ / 200-235 ↘) [256, 32, 512, 64]
    x.fillStyle = '#1e2229'; x.fillRect(256, 32, 256, 32);
    x.fillStyle = '#ffffff'; x.font = 'bold 13px Arial, sans-serif'; x.textAlign = 'center';
    x.fillText('↑ 240 - 287  ·  ↘ 200 - 235', 384, 49);

    // Cab secondary diagnostic display [0, 64, 512, 128]
    x.fillStyle = '#070b10'; x.fillRect(0, 64, 512, 64);
    x.fillStyle = '#38bdf8'; x.font = 'bold 20px Arial, sans-serif'; x.fillText('TGV M INOUI 9572 · PARIS → STRASBOURG', 256, 86);
    x.fillStyle = '#94a3b8'; x.font = '15px Arial, sans-serif'; x.fillText('Rame 10 caisses · 2 Étages · Voiture 4 Le Bistro', 256, 112);

    // R1..R3 1re Classe TGV M white-background passenger screen (premiereclasse.jpg: "TGV INOUI / BIENVENUE À BORD") [0, 128, 256, 192]
    x.fillStyle = '#f4f6f9'; x.fillRect(0, 128, 256, 64);
    x.fillStyle = '#8e1b3e'; x.fillRect(0, 128, 256, 8);
    x.fillStyle = '#1e242b'; x.font = 'bold 15px Arial, sans-serif'; x.fillText('TGV INOUI · 1re', 128, 152);
    x.fillStyle = '#7a1c38'; x.font = 'bold 13px Arial, sans-serif'; x.fillText('BIENVENUE À BORD', 128, 174);

    // R5..R8 2nde Classe TGV M white-background passenger screen (secondclasse.jpeg) [256, 128, 512, 192]
    x.fillStyle = '#f4f6f9'; x.fillRect(256, 128, 256, 64);
    x.fillStyle = '#1b4b78'; x.fillRect(256, 128, 256, 8);
    x.fillStyle = '#1e242b'; x.font = 'bold 15px Arial, sans-serif'; x.fillText('TGV INOUI · 2nde', 384, 152);
    x.fillStyle = '#1b4b78'; x.font = 'bold 13px Arial, sans-serif'; x.fillText('BIENVENUE À BORD', 384, 174);

    // Bar Menu "LE BISTRO" (wagonbarbas.jpg) [0, 192, 256, 256]
    x.fillStyle = '#58181f'; x.fillRect(0, 192, 256, 64);
    x.fillStyle = '#f5b82e'; x.fillRect(0, 192, 256, 6);
    x.fillStyle = '#ffffff'; x.font = 'bold 16px Arial, sans-serif'; x.fillText('VOITURE 4 · LE BISTRO', 128, 216);
    x.fillStyle = '#ffd88a'; x.font = '13px Arial, sans-serif'; x.fillText('Comptoir Bas · Salon Haut', 128, 238);

    // Self-service Refrigerated Fridges (wagonbarbas.jpg) [256, 192, 512, 256]
    x.fillStyle = '#162836'; x.fillRect(256, 192, 256, 64);
    for (const sy of [210, 230, 248]) { x.fillStyle = '#d8f0ff'; x.fillRect(262, sy, 244, 3); }
    for (let k = 0; k < 10; k++) {
      x.fillStyle = k % 3 === 0 ? '#d94862' : k % 3 === 1 ? '#58c47a' : '#68b5e8';
      x.fillRect(270 + k * 23, 197, 11, 12);
      x.fillRect(270 + k * 23, 216, 11, 13);
      x.fillRect(270 + k * 23, 235, 11, 12);
    }
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
    body:     new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.44, metalness: 0.42 }),
    dark:     new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.70, metalness: 0.45 }),
    inside:   new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08, emissive: 0x16181c }),
    glass:    new THREE.MeshStandardMaterial({ color: 0x4a687a, roughness: 0.14, metalness: 0.04, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.22 }),
    screen:   new THREE.MeshStandardMaterial({ color: 0x162430, roughness: 0.10, metalness: 0.12, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.35 }),
    panel:    new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.38 }),
    flicker:  new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.38 }),
    decal:    new THREE.MeshStandardMaterial({ map: bloodTex(), transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x20201c, emissive: 0xfff0d0, emissiveIntensity: 3.2, roughness: 0.3 }),
    lampTail: new THREE.MeshStandardMaterial({ color: 0x300806, emissive: 0xff2412, emissiveIntensity: 2.6, roughness: 0.3 }),
    crack:    new THREE.MeshStandardMaterial({ map: crackTex(), color: 0xdfe6ea, roughness: 0.2, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    shards:   new THREE.MeshStandardMaterial({ color: 0x7c8e96, roughness: 0.14, metalness: 0.15, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.35 }),
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

// Authentic SNCF TGV M (Avelia Horizon) interior & exterior palette matched to reference photos
const C = {
  steel: 0x45494e, black: 0x16181b, rubber: 0x1c1e22, rust: 0x4a3326, axle: 0x2c2b29, wheel: 0x3a3632, disc: 0x55524d, yellow: 0xd4a428,
  insulator: 0x5a2e22, grey: 0x62666b, rack: 0x9aa0a6, pedestal: 0x24282e,
  // Bright pearl-white TGV M interior shell & bulkheads (premiereclasse.jpg, secondclasse.jpeg, couloir.jpg)
  lining: 0xe6e8ec, liningLow: 0xbec3ca, ceiling: 0xedeff2, partition: 0xdcdfe4,
  // 1st Class TGV M (premiereclasse.jpg & IMG_tgv-ng_2classe.jpg): light-grey rear shell, burgundy & coral-terracotta cushions, heather-taupe headrest, terracotta carpet, light-oak table
  seatShell: 0xd0d3d8,
  seatR1: 0x6e1b22, seatR1Accent: 0xb84a4e, headR1: 0x9a7d7d, floorR1: 0x7d3b40, aisleR1: 0x5e282d,
  woodOak: 0xd4bc9a, brass: 0x9a7b42,
  // Voiture 4 "Le Bistro" TGV M (wagonbarbas.jpg, wagonbarhaut.jpg, wagonbarhaut2.jpg): terracotta floor, burgundy & oak counters, turquoise & terracotta alcoves, yellow lamps
  floorR2: 0x88383b, aisleR2: 0x722d30,
  barBurgundy: 0x6e2024, barOak: 0xd4bc9a, barTurquoise: 0x12749a, barCoral: 0xa84442, barYellowLamp: 0xf5b82e, barChrome: 0xa8aeb5,
  // 2nd Class TGV M (secondclasse.jpeg): light-grey rear shell, navy & petrol-blue cushions, light-grey headrest, blue-slate carpet
  seatR3: 0x1b3554, seatR3Accent: 0x3e7396, headR3: 0xb6b8bc, floorR3: 0x2c394b, aisleR3: 0x232e3d, tablette: 0xc8ccd2,
  // Cabine de pilotage TGV M (cabinepilotage.jpg): crimson-red inner pillars, dark anthracite console, dark leather central seat
  cabCrimson: 0xb01e26, cabSilver: 0xa4aab2, cabDesk: 0x1d2128, cabSeat: 0x221f20, cabFloor: 0x282c32,
  stairStep: 0x32363c,
};

// ------------------------------------------------------------------ TGV Y230 / Y266 bogies ('motor' | 'trailer')
export function buildBogieGeometry(kind = 'motor') {
  const B = buckets(), motor = kind === 'motor';
  const r = motor ? 0.36 : 0.34, wb = CONFIG.train.bogieWb ?? 2.35, yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036, u = 0;
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 14), C.wheel);
      B.add('dark', cyl(u + a, yAx, s * (g + 0.072), r * 0.82, 0.03, 'w', 14), C.rust);
      B.add('dark', cbox(u + a, yAx, s * 1.12, 0.34, 0.24, 0.20, 0.025), C.steel);
      for (const dw of [0.35, 0.48]) B.add('dark', cyl(u + a, yAx, s * dw, r * 0.68, 0.045, 'w', 12), C.disc);
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.08, 2 * g, 'w', 8), C.axle);
  }
  const fs = new THREE.Shape(), L = wb / 2 + 0.22, y0 = yAx + 0.06;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.18); fs.lineTo(-0.62, y0 + 0.23); fs.lineTo(-0.42, y0 + 0.07);
  fs.lineTo(0.42, y0 + 0.07); fs.lineTo(0.62, y0 + 0.23); fs.lineTo(L, y0 + 0.18); fs.lineTo(L, y0);
  fs.lineTo(0.48, y0 - 0.04); fs.lineTo(-0.48, y0 - 0.04); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) {
    const gf = extr(fs, 0.12, 0.012, 2); gf.translate(0, 0, -0.06); onSide(gf, s * 1.12, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel);
    B.add('dark', cyl(u, yAx + 0.26, s * 0.98, 0.25, 0.14, 'y', 10), C.rubber);
  }
  B.add('dark', cbox(u, yAx + 0.18, 0, 0.46, 0.18, 2.12, 0.03), C.steel);
  if (motor) {
    for (const s of [-1, 1]) for (const du of [-0.52, 0.52]) B.add('dark', cyl(u + du, yAx + 0.04, s * 0.38, 0.14, 0.46, 'u', 8), C.axle);
  } else {
    B.add('dark', cyl(u, yAx + 0.29, 0, 0.22, 0.09, 'y', 10), C.steel);
  }
  return B.merge().dark;
}

// ------------------------------------------------------------------ aerodynamic TGV M nose (uF = +3.70 -> tip +9.10)
const NOSE_T = [0, 0.08, 0.16, 0.24, 0.30, 0.38, 0.46, 0.54, 0.60, 0.68, 0.76, 0.84, 0.90, 0.95, 0.985, 1.0];
const NOSE_TOP = [[0, 1.00], [0.16, 0.94], [0.28, 0.80], [0.38, 0.70], [0.48, 0.60], [0.58, 0.50], [0.70, 0.42], [0.82, 0.35], [0.92, 0.29], [0.97, 0.25], [1.0, 0.22]];
const NOSE_FW = [[0, 1.00], [0.28, 0.95], [0.58, 0.82], [0.82, 0.62], [0.94, 0.42], [1.0, 0.24]];
const NOSE_YBOT = [[0, 0.36], [0.58, 0.42], [0.85, 0.44], [0.95, 0.50], [1.0, 0.62]];
const lerpKeys = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; } return K[K.length - 1][1]; };

export function noseSection(t) {
  const T = CONFIG.train;
  return { fw: lerpKeys(NOSE_FW, t), yBot: lerpKeys(NOSE_YBOT, t), yTop: T.height * lerpKeys(NOSE_TOP, t), round: 0.58 * Math.pow(t, 1.15) };
}

function roofProfile() {
  const T = CONFIG.train, Wd = T.width / 2, yc = 4.68, Ht = T.height;
  return [[1.00, 0.00], [0.99, 0.28], [0.96, 0.54], [0.90, 0.76], [0.80, 0.90], [0.62, 0.97], [0.32, 1.00], [-0.32, 1.00], [-0.62, 0.97], [-0.80, 0.90], [-0.90, 0.76], [-0.96, 0.54], [-0.99, 0.28], [-1.00, 0.00]]
    .map(([wf, yf]) => [wf * Wd, yc + yf * (Ht - yc)]);
}

function buildNose(B, u0, Ln, yb, yc) {
  const T = CONFIG.train, Wd = T.width / 2, Ht = T.height, prof = roofProfile();
  const base = [[Wd, yb], [Wd, yb + (yc - yb) / 3], [Wd, yb + (2 * (yc - yb)) / 3], ...prof, [-Wd, yb + (2 * (yc - yb)) / 3], [-Wd, yb + (yc - yb) / 3], [-Wd, yb]];
  const n = base.length, isTop = base.map(([w, y]) => y >= yc + 0.04 && Math.abs(w) < Wd * 0.82);
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
  const sets = { body: [], frame: [], screen: [], mask: [], inCrimson: [], inDark: [] };
  const add = (set, i, j) => {
    const j1 = (j + 1) % n, a = i * n + j, b = i * n + j1, c = (i + 1) * n + j1, d = (i + 1) * n + j;
    const cx = cen[i];
    const px = (P[a * 3] + P[b * 3] + P[c * 3] + P[d * 3]) / 4, py = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] + P[d * 3 + 1]) / 4, pz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] + P[d * 3 + 2]) / 4;
    const e1x = P[c * 3] - P[a * 3], e1y = P[c * 3 + 1] - P[a * 3 + 1], e1z = P[c * 3 + 2] - P[a * 3 + 2];
    const e2x = P[d * 3] - P[b * 3], e2y = P[d * 3 + 1] - P[b * 3 + 1], e2z = P[d * 3 + 2] - P[b * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const out = nx * (px - cx[0]) + ny * (py - cx[1]) + nz * (pz - cx[2]) > 0;
    sets[set].push(...(out ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    // Water-tight interior cockpit lining on the inside of the nose shell (u in [3.70, 6.80]) around the panoramic windshield
    if (i <= 8 && set !== 'screen') {
      const inSet = (i <= 2 && !isTop[j]) ? 'inCrimson' : 'inDark';
      sets[inSet].push(...(out ? [a, c, b, a, d, c] : [a, b, c, a, c, d]));
    }
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
  if (sets.inCrimson.length) B.add('inside', mk(sets.inCrimson), C.cabCrimson);
  if (sets.inDark.length) B.add('inside', mk(sets.inDark), C.cabDesk);
  // Front tip cap
  { const i = ns - 1, idx = []; for (let j = 1; j < n - 1; j++) { const a = i * n, b = i * n + j, d = i * n + j + 1; const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], fx = P[d * 3] - P[a * 3], fy = P[d * 3 + 1] - P[a * 3 + 1]; idx.push(...((ex * fy - ey * fx) * -1 > 0 ? [a, b, d] : [a, d, b])); } B.add('dark', mk(idx), C.black); }
  // Nose wipers, headlight bezels, coupler hatch, snowplow skirt
  B.add('dark', tube([5.15, 3.85, 0], [6.85, 2.45, 0], 0.026, 6), C.black);
  for (const s of [-1, 1]) {
    B.add('dark', tube([6.78, 2.52, s * 0.16], [5.95, 3.18, s * 0.66], 0.014, 5), C.black);
    const bz = cbox(0, 0, 0, 0.24, 0.18, 0.30, 0.02); bz.rotateY(-s * 0.34); bz.translate(s * 0.50, 0.98, -8.56);
    B.add('dark', bz, C.black);
  }
  B.add('dark', cbox(8.75, 0.88, 0, 0.36, 0.40, 0.76, 0.04), C.black);
  B.add('dark', cbox(5.05, 3.98, 0, 0.20, 0.13, 0.24, 0.02), C.black);
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

function addWallWithDoor(B, u0, face, wMax, yBot, yTop, pdw, doorTop, colWall) {
  const addRect = (x0, x1, y0, y1) => {
    if (x1 <= x0 + 1e-4 || y1 <= y0 + 1e-4) return;
    const g = cbox(u0, (y0 + y1) / 2, (x0 + x1) / 2, 0.055, y1 - y0, x1 - x0, 0.008);
    B.add('inside', g, colWall);
  };
  addRect(-pdw, pdw, doorTop, yTop);
  addRect(-wMax, -pdw, yBot, yTop);
  addRect(pdw, wMax, yBot, yTop);
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, -pdw - 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, pdw + 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
}

// Helper for 3-tier brushed aluminum TGV M luggage rack (couloir.jpg)
function addLuggageRackTGVM(B, u0, u1, w0, w1, yFloor, yTop) {
  const uMid = (u0 + u1) / 2, uLen = Math.abs(u1 - u0) - 0.06, wMid = (w0 + w1) / 2, wLen = Math.abs(w1 - w0) - 0.04;
  // 3 brushed-aluminum shelves
  for (const sy of [yFloor + 0.14, yFloor + 0.78, yFloor + 1.38]) {
    if (sy < yTop - 0.15) B.add('inside', cbox(uMid, sy, wMid, uLen, 0.045, wLen, 0.008), C.rack);
  }
  // Black tubular retaining arches at front & ends (couloir.jpg)
  const wFront = Math.abs(w0) < Math.abs(w1) ? w0 : w1;
  for (const up of [u0 + 0.06, uMid, u1 - 0.06]) {
    B.add('dark', tube([up, yFloor + 0.02, wFront], [up, yTop - 0.06, wFront], 0.020, 6), C.black);
  }
  B.add('dark', tube([u0 + 0.06, yFloor + 0.92, wFront], [u1 - 0.06, yFloor + 0.92, wFront], 0.016, 6), C.black);
  B.add('dark', tube([u0 + 0.06, yFloor + 1.52, wFront], [u1 - 0.06, yFloor + 1.52, wFront], 0.016, 6), C.black);
}

// Helper for iconic yellow retro-modern TGV M Bistro table lamp (wagonbarhaut.jpg & wagonbarhaut2.jpg)
function addYellowBistroLamp(B, u, yBase, w) {
  B.add('inside', cyl(u, yBase + 0.015, w, 0.065, 0.03, 'y', 10), C.barYellowLamp);
  B.add('inside', cyl(u, yBase + 0.12, w, 0.018, 0.20, 'y', 8), C.barYellowLamp);
  B.add('panel', uvRect(cyl(u, yBase + 0.22, w, 0.068, 0.08, 'y', 10), PANEL.lampBar));
  B.add('inside', cyl(u, yBase + 0.25, w, 0.095, 0.07, 'y', 12, 0.055), C.barYellowLamp);
}

// ------------------------------------------------------------------ car body builder
// kind : 'motrice' | 'coachR1' | 'coachR2' | 'coachR3'
export function buildCarGeometry(kind) {
  const T = CONFIG.train, W = T.walk, Lay = carLayouts(), Q = Lay[kind] || Lay.coachR3;
  const L = Q.len, h = Q.h, Wd = T.width / 2, F0 = T.floor, F1 = T.floorHigh, FL = Lay.FL, FU = Lay.FU, B = buckets();
  const isMotrice = kind === 'motrice', Ln = T.layout.taper, uF = isMotrice ? h - Ln : h, uA = -h;
  const yb = 0.26, yc = 4.68, lin = W.wall + 0.01, ceil = T.ceil ?? 5.10, ceilLow = FU - 0.10, ceilVest = 3.56;
  const { winW, winY0, winY1, winYU0, winYU1 } = Lay, dw = T.doorWidth / 2, dTop = F0 + T.doorH;
  const sideRegion = isMotrice ? ATLAS.sideMotrice : kind === 'coachR1' ? ATLAS.sideR1 : kind === 'coachR2' ? ATLAS.sideR2 : ATLAS.sideR3;

  // ---- exterior sides & double-decker window / door cutouts
  const cabWin = isMotrice ? { u: 3.10, w: 0.96, y0: 2.32, y1: 3.48 } : null;
  for (const side of [-1, 1]) {
    const X = (u) => sx(side, u);
    const x0 = Math.min(X(uA), X(uF)), x1 = Math.max(X(uA), X(uF));
    const s = new THREE.Shape([new THREE.Vector2(x0, yb), new THREE.Vector2(x1, yb), new THREE.Vector2(x1, yc), new THREE.Vector2(x0, yc)]);
    const sideWins = Q.win.filter((q) => !q.side || q.side === side);
    const sideWinsU = (Q.winUpper || []).filter((q) => !q.side || q.side === side);
    for (const q of sideWins) s.holes.push(rrect(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, true));
    for (const q of sideWinsU) s.holes.push(rrect(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.12, true));
    for (const u of Q.doors) s.holes.push(rrect(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.08, true));
    if (cabWin) s.holes.push(rrect(X(cabWin.u) - cabWin.w / 2, cabWin.y0, X(cabWin.u) + cabWin.w / 2, cabWin.y1, 0.08, true));
    const g = extr(s, Wd - lin - 0.02, 0, 3); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, sideRegion, L));

    // Lower window gaskets (panes are instanced in train.js winMeshes)
    for (const q of sideWins) {
      const gk = extr(ring(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, 0.045), 0.02, 0, 3);
      onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
    }
    // Upper-deck panoramic window gaskets + glass panes
    for (const q of sideWinsU) {
      const gk = extr(ring(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.12, 0.045), 0.02, 0, 3);
      onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(q.u) - winW / 2, winYU0 + q.dy, X(q.u) + winW / 2, winYU1 + q.dy, 0.12), 3), side * (Wd - 0.03), side));
    }
    for (const u of Q.doors) {
      const fr = extr(ring(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.08, 0.065), 0.025, 0, 3);
      onSide(fr, side * Wd, side); B.add('dark', fr, C.black);
      for (const e of [-1, 1]) B.add('dark', tube([u + e * (dw + 0.15), F0 + 0.45, side * (Wd + 0.06)], [u + e * (dw + 0.15), F0 + 2.02, side * (Wd + 0.06)], 0.018, 5), C.steel);
      B.add('dark', cbox(u, F0 - 0.03, side * (Wd - 0.04), T.doorWidth + 0.1, 0.05, 0.2, 0.01), C.steel);
      B.add('dark', cbox(u, F0 - 0.012, side * (Wd + 0.02), T.doorWidth, 0.014, 0.05, 0.004), C.yellow);
      const dirIn = u > 0 ? -1 : 1;
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.042, 10).translate(X(u + dirIn * (dw + 0.26)), 1.82, 0), side * (Wd + 0.012), side), PANEL.button));
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.038, 10).translate(X(u + dirIn * (dw + 0.22)), 1.90, 0), side * (lin - 0.012), -side), PANEL.button));
    }
    if (cabWin) {
      const fr = extr(ring(X(cabWin.u) - cabWin.w / 2, cabWin.y0, X(cabWin.u) + cabWin.w / 2, cabWin.y1, 0.08, 0.045), 0.02, 0, 3);
      onSide(fr, side * Wd, side); B.add('dark', fr, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(cabWin.u) - cabWin.w / 2, cabWin.y0, X(cabWin.u) + cabWin.w / 2, cabWin.y1, 0.08), 3), side * (Wd - 0.04), side));
      B.add('dark', cbox(cabWin.u + 0.56, 3.24, side * (Wd + 0.08), 0.16, 0.10, 0.16, 0.02), C.black);
    }
    B.add('dark', cbox((uA + uF) / 2, yc + 0.02, side * (Wd - 0.02), uF - uA, 0.06, 0.08, 0.02), C.steel);
    B.add('dark', cbox((uA + uF) / 2, yb + 0.03, side * (Wd - 0.03), uF - uA - 0.2, 0.07, 0.07, 0.02), C.black);

    // Exterior un-mirrored Carmillon / InOui decals & LED boards
    if (isMotrice) {
      addLogo(B, ATLAS.logos.sncf, 2.15, 1.74, 0.90, 0.36, side, Wd);
      addLogo(B, ATLAS.logos.tgv, -1.80, 2.74, 1.55, 0.38, side, Wd);
      for (const [lu0, lu1] of [[-6.2, -3.2], [-0.8, 1.6]]) {
        B.add('dark', cbox((lu0 + lu1) / 2, 3.05, side * (Wd - 0.02), lu1 - lu0, 1.25, 0.05, 0.01), C.black);
        for (let k = 0; k < 7; k++) B.add('dark', cbox((lu0 + lu1) / 2, 2.52 + k * 0.17, side * (Wd + 0.005), lu1 - lu0 - 0.12, 0.04, 0.04, 0.005), C.steel);
      }
    } else if (kind === 'coachR1') {
      addLogo(B, ATLAS.logos.num1, 5.10, 2.72, 0.44, 0.44, side, Wd);
      addExtLed(B, 5.10, 2.28, 0.76, 0.12, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -5.10, 2.72, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 0.00, 2.72, 1.25, 0.30, side, Wd);
    } else if (kind === 'coachR2') {
      addLogo(B, ATLAS.logos.bar, 0.00, 2.72, 1.15, 0.50, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -5.10, 2.72, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 5.10, 2.72, 1.25, 0.30, side, Wd);
    } else if (kind === 'coachR3') {
      addLogo(B, ATLAS.logos.num2, -5.10, 2.72, 0.44, 0.44, side, Wd);
      addExtLed(B, -5.10, 2.28, 0.76, 0.12, side, Wd);
      addLogo(B, ATLAS.logos.sncf, 5.10, 2.72, 0.85, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 0.00, 2.72, 1.25, 0.30, side, Wd);
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

  // ---- open inter-car gangway ends (gh = 2.28 m so standing eye 2.58 m has +48 cm clearance!)
  const gw = W.gangway / 2, gh = 2.28;
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
    const yT = isMotrice ? 3.62 : ceilVest, yO = F1 + gh, sideW = lin - gw;
    for (const [w, hh, cx, cy] of [[sideW, yT - F1, -(lin + gw) / 2, (F1 + yT) / 2], [sideW, yT - F1, (lin + gw) / 2, (F1 + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) {
      B.add('inside', onEnd(plane(w, hh), uE - dir * 0.07, -dir).translate(cx, cy, 0), C.lining);
    }
  }

  // ================================================================ MOTRICE : Walkable Engine-Room Corridor + TGV M Driver's Cockpit (cabinepilotage.jpg)
  if (isMotrice) {
    buildNose(B, uF, Ln, yb, yc);
    const fCab = 1.32, fCor = 1.06;
    // Engine-room central corridor floor (-h..2.05) + 3 steps (2.05..2.95) + elevated Driver's Cockpit floor (2.95..6.80)
    B.add('inside', cbox((-h + 2.05) / 2, (F1 + fCor) / 2, 0, 2.05 + h, fCor - F1 + 0.04, 1.32, 0.01), C.cabFloor);
    for (let st = 0; st < 3; st++) {
      const us = 2.20 + st * 0.28, ys = fCor + ((st + 1) / 3) * (fCab - fCor);
      B.add('inside', cbox(us, (F1 + ys) / 2, 0, 0.30, ys - F1 + 0.04, 1.28, 0.01), C.cabFloor);
      B.add('dark', cbox(us - 0.14, ys + 0.005, 0, 0.03, 0.01, 1.20, 0.003), C.yellow);
    }
    B.add('inside', cbox(4.85, (F1 + fCab) / 2, 0, 3.90, fCab - F1 + 0.04, 2 * lin - 0.12, 0.01), C.cabFloor);
    // High corridor ceiling (3.62 m) & cockpit rear ceiling (4.35 m from u = 2.05 to u = 3.72, above the panoramic windshield!)
    B.add('inside', new THREE.PlaneGeometry(1.40, 2.05 + h).rotateX(Math.PI / 2).translate(0, 3.62, -(-h + 2.05) / 2), C.ceiling);
    B.add('inside', new THREE.PlaneGeometry(2 * lin - 0.08, 1.70).rotateX(Math.PI / 2).translate(0, 4.35, -2.88), C.ceiling);
    for (let u = -7.5; u <= 3.2; u += 2.4) {
      B.add('panel', uvRect(new THREE.PlaneGeometry(0.18, 0.90).rotateX(Math.PI / 2).translate(0, u < 2.1 ? 3.61 : 4.34, -u), PANEL.led));
    }

    // Glazed engine-room corridor walls (w = +-0.60) + visible high-voltage traction transformer & inverter blocks behind the glass
    for (const sd of [-1, 1]) {
      const wc = sd * 0.60;
      B.add('inside', cbox(-3.50, 1.48, wc, 11.10, 0.84, 0.05, 0.008), C.partition);
      B.add('inside', cbox(-3.50, 3.36, wc, 11.10, 0.52, 0.05, 0.008), C.partition);
      for (const up of [-8.8, -5.4, -1.8, 1.8]) B.add('inside', cbox(up, 2.50, wc, 0.24, 1.20, 0.06, 0.008), C.steel);
      // Properly oriented corridor glass (onSide first, then translate along Z!)
      B.add('glass', onSide(plane(10.4, 1.20), sd * 0.59, -sd).translate(0, 2.50, 3.50));
      // Visible internal machinery blocks (traction inverters, cooling towers, HV cabling)
      B.add('dark', cbox(-6.2, 2.25, sd * 1.18, 2.6, 1.85, 0.72, 0.04), C.steel);
      B.add('dark', cbox(-2.4, 2.30, sd * 1.18, 2.8, 1.95, 0.74, 0.04), C.axle);
      B.add('dark', cbox(0.6, 2.20, sd * 1.14, 1.8, 1.75, 0.68, 0.04), C.rust);
      B.add('dark', tube([-7.8, 2.95, sd * 0.98], [1.6, 2.95, sd * 0.98], 0.045, 6), C.yellow);
    }

    // Cab rear bulkhead wall with open doorway at u = 2.05 (doorTop = 3.38 m so standing eye 2.76 m has +62 cm clearance)
    addWallWithDoor(B, 2.05, -1, lin, fCor, 4.35, 0.48, 3.38, C.partition);
    B.add('panel', uvRect(onEnd(plane(0.66, 0.14), 2.01, -1).translate(0, 3.56, 0), PANEL.screen));

    // ---- Authentic TGV M Driver's Cockpit (cabinepilotage.jpg, u in [2.95, 7.20], floor at fCab = 1.32 m)
    // Sculpted crimson-red inner side pillars (#b01e26) framing the cab side windows + silver-grey angled front A-pillars
    for (const sd of [-1, 1]) {
      // Crimson vertical pillars before & after the side window + crimson header & lower wall (cabinepilotage.jpg)
      B.add('inside', cbox(2.34, fCab + 1.48, sd * 1.56, 0.56, 2.96, 0.22, 0.03), C.cabCrimson);
      B.add('inside', cbox(3.86, fCab + 1.48, sd * 1.54, 0.56, 2.96, 0.22, 0.03), C.cabCrimson);
      B.add('inside', cbox(3.10, fCab + 2.58, sd * 1.56, 1.65, 0.78, 0.20, 0.03), C.cabCrimson);
      B.add('inside', cbox(3.10, fCab + 0.50, sd * 1.56, 1.65, 1.00, 0.20, 0.02), C.cabCrimson);
      // Silver-grey angled front A-pillars framing the central windshield
      B.add('inside', tube([4.95, 3.92, sd * 0.96], [6.45, 2.42, sd * 0.78], 0.065, 8), C.cabSilver);
      // Wrap-around dark anthracite side console wings
      B.add('inside', cbox(5.10, fCab + 0.42, sd * 1.12, 1.40, 0.84, 0.56, 0.03), C.cabDesk);
    }
    // Wrap-around dark anthracite front control console (u in [5.66, 7.05])
    B.add('inside', cbox(6.25, fCab + 0.44, 0, 1.18, 0.88, 2.48, 0.04), C.cabDesk);
    // 3 dark-mode ETCS / TVM-430 / diagnostic LCD screens angled toward the central driver's seat (cabinepilotage.jpg)
    B.add('panel', uvRect(onEnd(plane(0.76, 0.25).rotateX(-0.46), 5.80, -1).translate(0, fCab + 0.98, 0), PANEL.cab));
    B.add('panel', uvRect(onEnd(plane(0.54, 0.22).rotateX(-0.44), 5.74, -1).translate(-0.66, fCab + 0.96, 0), PANEL.screen));
    B.add('panel', uvRect(onEnd(plane(0.54, 0.22).rotateX(-0.44), 5.74, -1).translate(0.66, fCab + 0.96, 0), PANEL.screen));
    // Traction/brake master controller lever, GSM-R handset on left wing, illuminated pushbuttons on right wing, red mushroom emergency button
    B.add('dark', tube([5.62, fCab + 0.88, 0.34], [5.48, fCab + 1.08, 0.34], 0.020, 6), C.steel);
    B.add('dark', cyl(5.48, fCab + 1.09, 0.34, 0.028, 0.14, 'w', 8), C.black);
    B.add('panel', uvPanel(cyl(5.64, fCab + 0.90, -0.34, 0.045, 0.04, 'y', 10), PANEL.red));
    B.add('panel', uvPanel(cbox(5.25, fCab + 0.86, 0.98, 0.42, 0.03, 0.18, 0.005), PANEL.button));
    // Central dark-brown/black leather driver's armchair with wide headrest & foldable armrests (cabinepilotage.jpg)
    B.add('dark', cyl(4.36, fCab + 0.20, 0, 0.11, 0.40, 'y', 10), C.steel);
    B.add('inside', cbox(4.36, fCab + 0.46, 0, 0.54, 0.13, 0.56, 0.03), C.cabSeat);
    B.add('inside', cbox(4.14, fCab + 0.88, 0, 0.11, 0.76, 0.52, 0.03), C.cabSeat);
    B.add('inside', cbox(4.12, fCab + 1.34, 0, 0.09, 0.24, 0.42, 0.02), C.cabSeat);
    for (const sd of [-1, 1]) B.add('inside', cbox(4.38, fCab + 0.68, sd * 0.30, 0.40, 0.05, 0.06, 0.01), C.black);

    // Underframe transformer
    B.add('dark', cbox(-1.0, yb - 0.10, 0, 5.4, 0.30, 2.10, 0.05), C.axle);
    return B.merge();
  }

  // ================================================================ TGV M DOUBLE-DECKER PASSENGER & BISTRO COACHES (R1..R8)
  const fCol = kind === 'coachR1' ? C.floorR1 : kind === 'coachR2' ? C.floorR2 : C.floorR3;
  const aCol = kind === 'coachR1' ? C.aisleR1 : kind === 'coachR2' ? C.aisleR2 : C.aisleR3;

  // 1. Lower Saloon Floor (FL = 0.30 m, u in [-3.85, +3.85]) + Vestibule Floors (F0 = 0.80 m, |u| in [5.55, 6.80]) + Gangway Ramps (F1 = 0.88 m)
  B.add('inside', cbox(0, FL - 0.02, 0, 7.80, 0.05, 2 * lin - 0.02, 0.01), fCol);
  B.add('inside', new THREE.PlaneGeometry(1.14, 7.70).rotateX(-Math.PI / 2).translate(0, FL + 0.004, 0), aCol);
  for (const sDir of [-1, 1]) {
    // Vestibule floor slab at F0 = 0.80 m
    B.add('inside', cbox(sDir * 6.20, (FL + F0) / 2, 0, 1.50, F0 - FL, 2 * lin - 0.02, 0.01), C.stairStep);
    // Gangway raised floor slab at F1 = 0.88 m
    B.add('inside', cbox(sDir * 7.77, (FL + F1) / 2, 0, 1.66, F1 - FL, 2 * lin - 0.02, 0.01), C.stairStep);
    // Vestibule high ceiling at ceilVest = 3.56 m across |u| in [5.55, 8.55] (+1.06 m above standing eye 2.50 m!)
    B.add('inside', new THREE.PlaneGeometry(2 * lin - 0.04, 3.00).rotateX(Math.PI / 2).translate(0, ceilVest, -sDir * 7.05), C.ceiling);
    B.add('panel', uvRect(new THREE.PlaneGeometry(0.22, 1.10).rotateX(Math.PI / 2).translate(0, ceilVest - 0.008, -sDir * 6.35), PANEL.led));
    // Vestibule 3-tier brushed-aluminum TGV M luggage racks (couloir.jpg: |u| in [7.25, 8.20], w in [-lin, -0.82] & [0.82, lin])
    addLuggageRackTGVM(B, sDir > 0 ? 7.25 : -8.20, sDir > 0 ? 8.20 : -7.25, -lin + 0.04, -0.84, F1, ceilVest);
    addLuggageRackTGVM(B, sDir > 0 ? 7.25 : -8.20, sDir > 0 ? 8.20 : -7.25, 0.84, lin - 0.04, F1, ceilVest);

    // Right-hand lower stairs down from vestibule (0.80 m at |u|=5.55) to Lower Saloon (0.30 m at |u|=3.85) on w in [0.06, +lin]
    const wRampMid = (lin + 0.06) / 2, wRampW = lin - 0.06;
    for (let st = 0; st < 4; st++) {
      const uSt = sDir * (5.34 - st * 0.42), ySt = F0 - ((st + 1) / 4) * (F0 - FL);
      B.add('inside', cbox(uSt, (FL + ySt) / 2, wRampMid, 0.42, Math.max(0.04, ySt - FL), wRampW - 0.02, 0.008), C.stairStep);
      B.add('dark', cbox(uSt - sDir * 0.19, ySt + 0.004, wRampMid, 0.03, 0.01, wRampW - 0.04, 0.003), C.yellow);
    }

    // 2. Left-hand TGV M Staircase (couloir2.jpeg: 9 dark ribbed steps climbing from F0 = 0.80 m at |u|=5.55 up to FU = 2.76 m at |u|=3.85, on w in [-lin, -0.06])
    const wStMid = (-lin - 0.06) / 2, wStW = lin - 0.06;
    for (let st = 0; st < 9; st++) {
      const uSt = sDir * (5.45 - st * 0.188), ySt = F0 + ((st + 1) / 9) * (FU - F0);
      B.add('inside', cbox(uSt, (FL + ySt) / 2, wStMid, 0.21, ySt - FL, wStW - 0.02, 0.008), C.stairStep);
      B.add('dark', cbox(uSt + sDir * 0.09, ySt + 0.003, wStMid, 0.03, 0.01, wStW - 0.04, 0.003), C.yellow);
    }
    // Under-stair vertical bulkhead at |u| = 3.85, w in [-lin, -0.06], y in [FL, FU] closing the space under the stairs from the lower saloon
    B.add('inside', cbox(sDir * 3.85, (FL + FU) / 2, wStMid, 0.06, FU - FL, wStW, 0.01), C.partition);
    // Pill-shaped TGV M seat-direction sign mounted high on the upper stairwell header (y = 3.88 m, completely above the walkable staircase!)
    B.add('panel', uvRect(onEnd(plane(0.56, 0.14), sDir * 5.53, -sDir).translate(-0.82, 3.88, 0), PANEL.extLed));

    // Stairwell central divider wall at w = 0, |u| in [3.85, 5.55] : pearl-white lower wall + fluted glass upper balustrade + black tubular handrails (wagonbarhaut.jpg, couloir2.jpeg)
    B.add('inside', cbox(sDir * 4.70, (FL + FU) / 2, 0, 1.70, FU - FL, 0.08, 0.01), C.partition);
    // Properly oriented side glass panel along w = 0 (onSide first, then translate along Y and Z!)
    B.add('glass', onSide(plane(1.66, 0.96), 0, 1).translate(0, FU + 0.48, -sDir * 4.70));
    B.add('dark', tube([sDir * 5.52, FU + 0.96, 0], [sDir * 3.86, FU + 0.96, 0], 0.022, 6), C.black);
    B.add('dark', tube([sDir * 5.52, F0 + 0.92, -0.06], [sDir * 3.86, FU + 0.92, -0.06], 0.020, 6), C.black);
    B.add('dark', tube([sDir * 5.52, F0 + 0.92, -lin + 0.05], [sDir * 3.86, FU + 0.92, -lin + 0.05], 0.020, 6), C.black);
  }

  // 3. Intermediate Structural Deck Slab (separating Lower Saloon y <= 2.66 m from Upper Saloon y >= 2.76 m across u in [-3.85, +3.85])
  B.add('inside', cbox(0, (ceilLow + FU) / 2, 0, 7.70, FU - ceilLow, 2 * lin - 0.02, 0.01), C.ceiling);
  B.add('inside', new THREE.PlaneGeometry(1.14, 7.68).rotateX(-Math.PI / 2).translate(0, FU + 0.004, 0), aCol);
  for (const sDir of [-1, 1]) {
    const wRightMid = lin / 2, wRightW = lin;
    // Upper-deck right bulkhead & fluted glass balustrade at |u| = 3.85, w in [0, +lin] (matching Q.blocksUpper |u| >= 3.78, w >= -0.08 1:1!)
    B.add('inside', cbox(sDir * 3.85, FU + 0.52, wRightMid, 0.06, 1.04, wRightW - 0.02, 0.01), C.partition);
    B.add('glass', onEnd(plane(wRightW - 0.08, 0.88), sDir * 3.85, -sDir).translate(wRightMid, FU + 1.48, 0));
    B.add('dark', tube([sDir * 3.85, FU + 1.04, 0.02], [sDir * 3.85, FU + 1.04, lin - 0.04], 0.022, 6), C.black);
    // Upper-deck end bulkhead at |u| = 5.58 closing the upper level above the vestibule (starts at ceilVest = 3.56 m across full width so the stairs have 100% head clearance!)
    B.add('inside', cbox(sDir * 5.58, (ceilVest + ceil) / 2, 0, 0.07, ceil - ceilVest, 2 * lin, 0.01), C.partition);

    // 16:9 TGV INOUI passenger information screens flush-mounted on the solid left under-stair wall (w = -0.82, y = 2.22 m) and upper saloon header (w = -0.82, y = 4.78 m)
    const scr = kind === 'coachR1' ? PANEL.screenR1 : kind === 'coachR2' ? PANEL.screenBar : PANEL.screenR3;
    B.add('inside', cbox(sDir * 3.81, 2.22, -0.82, 0.04, 0.22, 0.70, 0.008), C.black);
    B.add('panel', uvRect(onEnd(plane(0.64, 0.18), sDir * 3.78, -sDir).translate(-0.82, 2.22, 0), scr));
    B.add('inside', cbox(sDir * 5.54, 4.78, -0.82, 0.05, 0.24, 0.72, 0.008), C.black);
    B.add('panel', uvRect(onEnd(plane(0.66, 0.20), sDir * 5.51, -sDir).translate(-0.82, 4.78, 0), scr));
  }

  // 4. Vaulted Pearl-White Upper-Deck Ceiling (y = ceil = 5.10 m) & Continuous Warm TGV M LED Coves (premiereclasse.jpg, secondclasse.jpeg)
  {
    const cv = [[lin + 0.02, ceil - 0.16], [1.12, ceil], [-1.12, ceil], [-lin - 0.02, ceil - 0.16]];
    const pi = [];
    for (let i = 1; i < cv.length; i++) {
      const [w0, y0] = cv[i - 1], [w1, y1] = cv[i];
      pi.push(w0, y0, -5.58, w1, y1, 5.58, w1, y1, -5.58, w0, y0, -5.58, w0, y0, 5.58, w1, y1, 5.58);
    }
    const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pi, 3)); gi.computeVertexNormals();
    B.add('inside', gi, C.ceiling);

    // Continuous warm white LED coves on both Lower Saloon (y = 2.65 m) and Upper Saloon (y = 5.08 m)
    for (const side of [-1, 1]) {
      let k = 0;
      for (let u = -3.3; u <= 3.3; u += 1.10, k++) {
        const dead = hash(k, side + (kind === 'coachR2' ? 7 : 0), 4) > 0.93, flick = !dead && hash(k, side, 5) > 0.94;
        const gLow = new THREE.PlaneGeometry(0.08, 0.98).rotateX(Math.PI / 2).translate(side * 0.98, ceilLow - 0.006, -u);
        const gUp = new THREE.PlaneGeometry(0.08, 0.98).rotateX(Math.PI / 2).rotateZ(-side * 0.22).translate(side * 1.16, ceil - 0.008, -u);
        B.add(dead ? 'panel' : flick ? 'flicker' : 'panel', uvRect(gLow, dead ? PANEL.dead : PANEL.led));
        B.add('panel', uvRect(gUp, PANEL.led));
      }
    }
  }

  // 5. Interior Pearl-White Side Wall Linings with both Lower and Upper Window Cutouts & Overhead Luggage Racks
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
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, FL, winY0 - 0.10)), side * lin, -side), C.liningLow);
        const sh = rangeShape(p, q, winY0 - 0.10, ceil);
        for (const w of sideWins) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winY0 + w.dy, X(w.u) + winW / 2, winY1 + w.dy, 0.12, true));
        for (const w of sideWinsU) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winYU0 + w.dy, X(w.u) + winW / 2, winYU1 + w.dy, 0.12, true));
        B.add('inside', onSide(new THREE.ShapeGeometry(sh, 3), side * lin, -side), C.lining);
      }
      for (const u of doors) B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(u - dw, u + dw, dTop, ceil)), side * lin, -side), C.lining);
      for (const [wList, y0, y1] of [[sideWins, winY0, winY1], [sideWinsU, winYU0, winYU1]]) {
        for (const w of wList) {
          const fr = extr(ring(X(w.u) - winW / 2, y0 + w.dy, X(w.u) + winW / 2, y1 + w.dy, 0.12, 0.045), 0.025, 0, 3);
          onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition);
        }
      }
      // Upper-deck overhead transparent glass & aluminum luggage racks in R1..R3 & R5..R8 at y = 4.74 m above the seat bays u in [-3.10, +3.10]
      if (kind === 'coachR1' || kind === 'coachR3') {
        const rw = side * 1.12;
        B.add('inside', cyl(0, 4.74, rw, 0.020, 6.20, 'u', 6), C.rack);
        B.add('glass', new THREE.PlaneGeometry(lin - 1.14, 6.20).rotateX(-Math.PI / 2).translate(side * (lin + 1.12) / 2, 4.73, 0));
      }
    }
  }

  // 6. Authentic TGV M Contoured Seats & Bay Tables on BOTH Lower Saloon (FL = 0.30 m) and Upper Saloon (FU = 2.76 m)
  //    Matched to premiereclasse.jpg, IMG_tgv-ng_2classe.jpg & secondclasse.jpeg :
  //    Light pearl-grey rear shell, colored seat-number badge on top corner, two-tone seat cushions, wide rounded winged headrest, oak tables with cupholders
  if (Q.seats.length || (Q.seatsUpper && Q.seatsUpper.length)) {
    const prof = new THREE.Shape();
    prof.moveTo(0.0, 0.36); prof.lineTo(0.45, 0.37); prof.quadraticCurveTo(0.50, 0.39, 0.47, 0.47); prof.lineTo(0.12, 0.50);
    prof.lineTo(0.09, 0.58); prof.lineTo(0.02, 1.08); prof.quadraticCurveTo(0.01, 1.20, -0.07, 1.19); prof.lineTo(-0.10, 1.12);
    prof.lineTo(-0.06, 0.46); prof.lineTo(0.0, 0.36);
    const isR1 = kind === 'coachR1';
    const sCol = isR1 ? C.seatR1 : C.seatR3;
    const sAcc = isR1 ? C.seatR1Accent : C.seatR3Accent;
    const hCol = isR1 ? C.headR1 : C.headR3;
    for (const [seatList, tabList, fy] of [[Q.seats, Q.tables, FL], [Q.seatsUpper || [], Q.tablesUpper || [], FU]]) {
      for (const st of seatList) {
        const sw = st.width || 0.43;
        // Main two-tone upholstered seat cushion & backrest
        const g = extr(prof, sw, 0, 2); g.translate(0, 0, -sw / 2);
        g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, fy, -st.u);
        B.add('inside', g, sCol);
        // Upper backrest coral-terracotta (1st class) or petrol-blue (2nd class) two-tone accent cushion
        B.add('inside', cbox(st.u + st.dir * 0.04, fy + 0.84, st.w, 0.05, 0.30, sw * 0.90, 0.012), sAcc);
        // Molded light-grey rear shell (premiereclasse.jpg / secondclasse.jpeg)
        B.add('inside', cbox(st.u - st.dir * 0.06, fy + 0.78, st.w, 0.035, 0.68, sw * 0.96, 0.012), C.seatShell);
        // Wide rounded TGV M headrest with side wings
        B.add('inside', cbox(st.u + st.dir * 0.04, fy + 1.08, st.w, 0.065, 0.21, sw * 0.88, 0.022), hCol);
        // Small colored seat-number badge on top aisle corner of the shell
        const wBadge = st.w + (st.w < 0 ? 1 : -1) * (sw * 0.38);
        B.add('inside', cbox(st.u - st.dir * 0.04, fy + 1.18, wBadge, 0.04, 0.04, 0.07, 0.006), sAcc);
        // Pedestal leg, armrest & rear fold-down tray table
        B.add('inside', cyl(st.u + st.dir * 0.12, fy + 0.18, st.w, 0.035, 0.36, 'y', 6), C.pedestal);
        if (st.arm) B.add('inside', cbox(st.u + st.dir * 0.22, fy + 0.60, st.w + st.arm * (sw / 2 + 0.02), 0.36, 0.045, 0.045, 0.01), C.pedestal);
        if (st.tablette) B.add('inside', cbox(st.u - st.dir * 0.09, fy + 0.72, st.w, 0.025, 0.25, sw * 0.80, 0.005), isR1 ? C.woodOak : C.tablette);
      }
      for (const tb of tabList) {
        const tw = tb.w1 - tb.w0, wc = (tb.w0 + tb.w1) / 2;
        B.add('inside', cbox(tb.u, tb.y, wc, tb.len, 0.04, tw, 0.01), C.woodOak);
        B.add('inside', tube([tb.u, fy, wc], [tb.u, tb.y - 0.02, wc], 0.032, 6), C.pedestal);
        if (tb.lamp) {
          B.add('inside', tube([tb.u, tb.y + 0.02, tb.lamp], [tb.u, tb.y + 0.22, tb.lamp], 0.012, 6), C.brass);
          B.add('panel', uvRect(cyl(tb.u, tb.y + 0.26, tb.lamp, 0.055, 0.08, 'y', 8, 0.040), PANEL.lampBar));
        }
      }
    }
  }

  // 7. R4 Voiture Bar TGV M "Le Bistro" on 2 Decks (matched to wagonbarbas.jpg, wagonbarhaut.jpg & wagonbarhaut2.jpg)
  if (kind === 'coachR2') {
    const { u0: bu0, u1: bu1, alcovesU, stoolsU } = Q.bar, bLen = bu1 - bu0, bMid = (bu0 + bu1) / 2;

    // ---- A. LOWER DECK "LE BISTRO" COMPTOIR & LIBRE-SERVICE (wagonbarbas.jpg, FL = 0.30 m)
    // Left side (-w, w in [-lin, -0.68]) : Burgundy (#6e2024) & Light-Oak (#d4bc9a) Bistro Counter + POS Terminal + Snack Baskets
    B.add('inside', cbox(bMid, FL + 0.50, -1.16, bLen, 1.00, 0.92, 0.02), C.barBurgundy);
    B.add('inside', cbox(bMid, FL + 1.03, -1.14, bLen + 0.04, 0.06, 0.96, 0.015), C.barOak);
    // Back-wall oak shelving & illuminated Le Bistro menu board on -w
    B.add('inside', cbox(bMid, FL + 1.45, -1.56, bLen - 0.2, 1.70, 0.24, 0.015), C.barOak);
    B.add('panel', uvRect(onSide(plane(1.50, 0.42), -1.42, 1).translate(0, FL + 1.68, 0), PANEL.screenBar));
    // Burgundy dual-screen POS cash register terminal & snack baskets on the counter (wagonbarbas.jpg)
    B.add('inside', cbox(-0.85, FL + 1.24, -0.88, 0.42, 0.36, 0.32, 0.015), C.barBurgundy);
    B.add('panel', uvRect(onSide(plane(0.32, 0.22), -0.71, 1).translate(0, FL + 1.26, 0.85), PANEL.screenBar));
    B.add('inside', cbox(0.95, FL + 1.14, -0.92, 0.55, 0.16, 0.38, 0.015), C.barOak);

    // Right side (+w, w in [0.82, lin]) : Self-service tall glass-door refrigerated fridges (u in [-2.65, -0.45]) + low oak service counter under the two Bistro windows (u = 0.60 & 2.20)
    B.add('inside', cbox(-1.55, FL + 1.08, 1.26, 2.20, 2.12, 0.82, 0.02), C.steel);
    B.add('panel', uvRect(onSide(plane(2.00, 1.68), 0.84, -1).translate(0, FL + 1.14, 1.55), PANEL.vitrine));
    B.add('inside', cbox(1.20, FL + 0.41, 1.26, 2.95, 0.82, 0.82, 0.02), C.barBurgundy);
    B.add('inside', cbox(1.20, FL + 0.85, 1.24, 3.00, 0.06, 0.86, 0.015), C.barOak);
    B.add('inside', cbox(1.40, FL + 1.07, 1.36, 0.34, 0.38, 0.38, 0.02), C.barChrome); // Espresso station on the pillar between u=0.60 and u=2.20 windows

    // ---- B. UPPER DECK "LE BISTRO" SALON DETENTE (wagonbarhaut.jpg & wagonbarhaut2.jpg, FU = 2.76 m)
    // Left side (-w, w in [-lin, -0.58]) : Long Light-Oak high bar table along panoramic windows + Turquoise square pouf stools + Yellow TGV M lamps
    B.add('inside', cbox(0, FU + 0.88, -1.32, 5.76, 0.06, 0.68, 0.015), C.barOak);
    for (const uLeg of [-2.75, -0.92, 0.92, 2.75]) {
      B.add('dark', tube([uLeg, FU, -1.04], [uLeg, FU + 0.86, -1.04], 0.026, 6), C.black);
      B.add('dark', tube([uLeg, FU, -1.58], [uLeg, FU + 0.86, -1.58], 0.026, 6), C.black);
    }
    for (const uSt of stoolsU) {
      // Turquoise-blue square pouf stool (#12749a) with black steel frame & black vertical grab-loop on the back (wagonbarhaut.jpg)
      B.add('dark', cbox(uSt, FU + 0.28, -0.84, 0.34, 0.54, 0.34, 0.01), C.black);
      B.add('inside', cbox(uSt, FU + 0.58, -0.84, 0.38, 0.12, 0.38, 0.025), C.barTurquoise);
      B.add('dark', cbox(uSt, FU + 0.70, -0.66, 0.14, 0.14, 0.03, 0.006), C.black);
    }
    for (const uLamp of [-2.10, 0.00, 2.10]) {
      addYellowBistroLamp(B, uLamp, FU + 0.91, -1.46);
    }

    // Right side (+w, w in [0.58, lin]) : 3 Sculpted Curved Lounge Alcoves / Banquettes in Turquoise & Terracotta-Coral + Rounded Oak Tables + Yellow TGV M Lamps (wagonbarhaut2.jpg)
    alcovesU.forEach((ua, idx) => {
      const colAlc = idx === 1 ? C.barCoral : C.barTurquoise;
      // Curved alcove privacy shell & upholstered bench seat + backrest
      B.add('inside', cbox(ua - 0.58, FU + 0.72, 1.16, 0.10, 1.42, 0.98, 0.02), colAlc);
      B.add('inside', cbox(ua + 0.58, FU + 0.72, 1.16, 0.10, 1.42, 0.98, 0.02), colAlc);
      B.add('inside', cbox(ua, FU + 0.45, 1.56, 1.16, 0.88, 0.18, 0.02), colAlc);
      for (const du of [-0.38, 0.38]) {
        B.add('inside', cbox(ua + du, FU + 0.44, 1.14, 0.36, 0.12, 0.88, 0.025), colAlc);
      }
      // Rounded light-oak alcove table + black pedestal + iconic yellow TGV M lamp
      B.add('inside', cbox(ua, FU + 0.72, 1.12, 0.46, 0.045, 0.76, 0.015), C.barOak);
      B.add('dark', cyl(ua, FU + 0.36, 1.12, 0.035, 0.70, 'y', 8), C.black);
      addYellowBistroLamp(B, ua, FU + 0.74, 1.38);
    });
    // 3 Burgundy waste-sorting bins at u = +3.02 on +w (wagonbarhaut.jpg)
    for (let b = 0; b < 3; b++) {
      B.add('inside', cbox(2.96, FU + 0.42, 0.78 + b * 0.34, 0.28, 0.82, 0.28, 0.02), C.barBurgundy);
    }
  }

  // 8. Underframe equipment skirts
  for (const u of [-3.2, 0.0, 3.2]) B.add('dark', cbox(u, yb - 0.08, 0, 2.1, 0.22, 1.95, 0.04), C.axle);

  // 9. Subtle survival decals inside passenger coaches
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  if (Q.legroom.length) {
    const c = Q.legroom[Math.min(1, Q.legroom.length - 1)].u;
    B.add('decal', quarter(new THREE.PlaneGeometry(0.65, 1.15).rotateX(-Math.PI / 2).translate(0.04, FL + 0.006, -c), 1, 0));
    B.add('decal', quarter(new THREE.PlaneGeometry(0.55, 1.00).rotateX(-Math.PI / 2).translate(-0.04, FU + 0.006, c), 0, 1));
  }
  return B.merge();
}

// door leaf (Carmillon plug door) : X across, Y up, Z along
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floor, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.08);
  s.holes.push(rrect(-0.30, F + 0.95, 0.30, F + 1.88, 0.07, true));
  const g = extr(s, 0.05, 0.008, 3); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  { const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = ATLAS.door; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, 1 - (r0 + (1 - (p.getY(i) - F) / T.doorH) * (r1 - r0)) / 1024); }
  B.add('body', g);
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.30, F + 0.95, 0.30, F + 1.88, 0.07), 3), 0, 1));
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
  topM.rotateY(Math.PI); topM.rotateX(-0.45); topM.translate(0, 3.98, -5.18);
  B.add('lamp', topM);
  return B.merge().lamp;
}

// ------------------------------------------------------------------ motrice cab interior (merged into buildCarGeometry('motrice') for 0 extra draw calls)
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
