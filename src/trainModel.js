import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  SNCF TGV POS / Réseau (Carmillon / TGV inOui, v0.95.0) : geometry and materials, no game state.
//  5-vehicle condensed single-deck consist (2M + 3R, 97.60 m total, 2.90 m wide):
//    0: M1 (Lead Motrice, 19.40 m, aerodynamic sloped nose, twin headlights, louvers, 2 pantographs, 2 motor bogies)
//    1: R1 (1re Classe, 19.00 m, walkable, 2+1 carmine/plum seats, bay tables & lamps, curtains, vestibule + front bulkhead)
//    2: R2 (Voiture Bar, 18.70 m, walkable, Bistro bar counter, espresso, vitrine, menu board, mange-debout & lounge)
//    3: R3 (2nde Classe, 19.00 m, walkable, 2+2 teal/slate seats, tablettes, blinds, vestibule + rear gangway recess/tailU)
//    4: M2 (Tail Motrice, 19.40 m, mirrored 180°, red tail markers, 2 pantographs, 2 motor bogies)
//  Vehicle-local axes : X = w (right of travel), Y = height above rail head, Z = -u (+u forward).
//  carLayouts() is pure (no Three.js) : walkable interior geometry and collision boxes shared with train.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ interior layout (car-local u, w ; heights above rail head)
// zone : [z0, z1, z2] ramps from T.floor (z0) to T.floorHigh (z1) and holds T.floorHigh up to z2.
function mirrorLayout(Q) {
  const m = (v) => -v;
  return {
    ...Q, kind: Q.kind + 'T', mirrored: true,
    doors: Q.doors.map(m),
    win: Q.win.map((q) => ({ ...q, u: -q.u, side: q.side ? -q.side : 0 })),
    legroom: Q.legroom.map((q) => ({ ...q, u: -q.u })),
    seats: Q.seats.map((s) => ({ ...s, u: -s.u, dir: -s.dir, w: -s.w })),
    tables: (Q.tables || []).map((t) => ({ ...t, u: -t.u, w0: -t.w1, w1: -t.w0 })),
    blocks: Q.blocks.map((b) => ({ u0: -b.u1, u1: -b.u0, w0: -b.w1, w1: -b.w0 })),
    parts: Q.parts.map(m),
    zones: Q.zones.map((z) => [-z[0], -z[1], -z[2]]),
    openEnds: Q.openEnds.map(m),
    saloon: [-Q.saloon[1], -Q.saloon[0]],
    cab: Q.cab ? { ...Q.cab, u: -Q.cab.u, dir: -Q.cab.dir } : null,
    ledU: Q.ledU.map(m),
  };
}

export function carLayouts() {
  const T = CONFIG.train, W = T.walk, F0 = T.floor, F1 = T.floorHigh, wall = W.wall;
  const winW = 1.48, [winY0, winY1] = T.winY;

  // M1 / M2 : opaque power cars (non-walkable)
  const makeMotrice = (len) => ({
    kind: 'motrice', geoKind: 'motrice', walkable: false, mirrored: false,
    len, h: len / 2, doors: [], win: [], legroom: [], seats: [], tables: [],
    blocks: [], parts: [], zones: [], openEnds: [], ledU: [], saloon: [0, 0], cab: null,
  });

  // R1 : 1re Classe (19.00 m, 6 bays @ 2.35 m, 2+1 carmine/plum seating, front sealed bulkhead at +8.85, Jacobs rear at -9.50)
  const makeR1 = (len) => {
    const h = len / 2, Q = {
      kind: 'coachR1', geoKind: 'coachR1', walkable: true, mirrored: false,
      len, h, doors: [7.55], win: [], legroom: [], seats: [], tables: [], blocks: [],
      parts: [6.05], zones: [[6.95, 6.35, -h - 0.55]], openEnds: [-h], ledU: [],
      saloon: [-9.00, 5.95], bay: 2.35, bayU0: -8.65, nBay: 6,
      cab: { u: 8.85, dir: 1, y: F0, text: 'Accès motrice avant — verrouillé' },
    };
    // Vestibule luggage rack (-w) & trash bin (+w)
    Q.blocks.push({ u0: 8.22, u1: 8.83, w0: -wall, w1: -0.76 });
    Q.blocks.push({ u0: 8.32, u1: 8.78, w0: 0.88, w1: wall });
    Q.ledU.push(7.55);

    const bay = 2.35, u0 = -8.65;
    for (let b = 0; b < 6; b++) {
      const a = u0 + b * bay, uc = a + bay / 2;
      Q.win.push({ u: uc, dy: 0, side: 0 });
      Q.legroom.push({ u: uc });
      Q.ledU.push(uc);
      const carre = b % 2 === 0;
      if (carre) {
        // Facing 2+1 club bay with bay table + lamp (table collision keeps w in [-0.69, +0.51] aisle clear & leaves legroom pushOut toward aisle)
        for (const [ub, dir] of [[a + 0.30, 1], [a + bay - 0.30, -1]]) {
          Q.seats.push({ u: ub, dir, w: -0.96, width: 0.54, arm: 1 });
          Q.seats.push({ u: ub, dir, w: 0.71, width: 0.40, arm: -1 });
          Q.seats.push({ u: ub, dir, w: 1.13, width: 0.40, arm: 0 });
          const lo = Math.min(ub - dir * 0.14, ub + dir * 0.46), hi = Math.max(ub - dir * 0.14, ub + dir * 0.46);
          Q.blocks.push({ u0: lo, u1: hi, w0: -wall, w1: -0.69 });
          Q.blocks.push({ u0: lo, u1: hi, w0: 0.51, w1: wall });
        }
        Q.tables.push({ u: uc, w0: -1.28, w1: -0.76, y: F1 + 0.72, len: 0.46, lamp: -1.20 });
        Q.tables.push({ u: uc, w0: 0.62, w1: 1.28, y: F1 + 0.72, len: 0.46, lamp: 1.20 });
        // Table blocks: ew < eu at w = +-0.85 so climbing zombies push straight into the 1.20 m central aisle
        Q.blocks.push({ u0: uc - 0.25, u1: uc + 0.25, w0: -wall, w1: -0.78 });
        Q.blocks.push({ u0: uc - 0.25, u1: uc + 0.25, w0: 0.66, w1: wall });
      } else {
        // Airline +u rows with folding seatback tablettes
        for (const ub of [a + 0.35, a + 1.48]) {
          Q.seats.push({ u: ub, dir: 1, w: -0.96, width: 0.54, arm: 1, tablette: true });
          Q.seats.push({ u: ub, dir: 1, w: 0.71, width: 0.40, arm: -1, tablette: true });
          Q.seats.push({ u: ub, dir: 1, w: 1.13, width: 0.40, arm: 0, tablette: true });
          Q.blocks.push({ u0: ub - 0.14, u1: ub + 0.44, w0: -wall, w1: -0.69 });
          Q.blocks.push({ u0: ub - 0.14, u1: ub + 0.44, w0: 0.51, w1: wall });
        }
      }
    }
    return Q;
  };

  // R2 : Voiture Bar (18.70 m, flat 1.08 m floor, Jacobs gangways at +-9.35, galley/counter on -w, mange-debout on +w, bistro lounge at -u)
  const makeR2 = (len) => {
    const h = len / 2, Q = {
      kind: 'coachR2', geoKind: 'coachR2', walkable: true, mirrored: false,
      len, h, doors: [], win: [], legroom: [], seats: [], tables: [], blocks: [],
      parts: [-8.45, 8.45], zones: [[-h - 0.55, -h - 0.54, h + 0.55]], openEnds: [-h, h], ledU: [],
      saloon: [-8.45, 8.45], bay: 2.55, bayU0: -7.575, nBay: 6, cab: null,
      bar: { u0: 0.00, u1: 7.60, mangeU: [1.45, 4.00, 6.55], loungeU: [-6.30, -3.70] },
    };
    // Windows: 3 lounge/transition bays on BOTH sides (-6.30, -3.70, -1.10), plus 3 mange-debout bays on +w ONLY (+1.45, +4.00, +6.55)
    for (const u of [-6.30, -3.70, -1.10]) {
      Q.win.push({ u, dy: 0, side: 0 });
      Q.legroom.push({ u });
      Q.ledU.push(u);
    }
    for (const u of [1.45, 4.00, 6.55]) {
      Q.win.push({ u, dy: 0, side: 1 });
      Q.legroom.push({ u });
      Q.ledU.push(u);
    }
    Q.win.sort((a, b) => a.u - b.u);
    // Bar counter & galley block on -w (w in [-1.32, -0.44], leaves [-0.44, +0.78] = 1.22 m aisle)
    Q.blocks.push({ u0: -0.05, u1: 7.65, w0: -wall, w1: -0.44 });
    // Mange-debout high tables & stools on +w (w in [+0.78, +1.32])
    for (const ut of Q.bar.mangeU) {
      Q.blocks.push({ u0: ut - 0.72, u1: ut + 0.72, w0: 0.78, w1: wall });
    }
    // Bistro lounge tables & stools on both sides (leaves [-0.56, +0.56] = 1.12 m aisle)
    for (const ub of Q.bar.loungeU) {
      Q.blocks.push({ u0: ub - 0.75, u1: ub + 0.75, w0: 0.56, w1: wall });
      Q.blocks.push({ u0: ub - 0.75, u1: ub + 0.75, w0: -wall, w1: -0.56 });
    }
    return Q;
  };

  // R3 : 2nde Classe (19.00 m, 7 bays @ 2.04 m, 2+2 teal/slate seating, Jacobs front at +9.50, rear bulkhead tailU at -8.85)
  const makeR3 = (len) => {
    const h = len / 2, Q = {
      kind: 'coachR3', geoKind: 'coachR3', walkable: true, mirrored: false,
      len, h, doors: [-7.55], win: [], legroom: [], seats: [], tables: [], blocks: [],
      parts: [-6.05], zones: [[-6.95, -6.35, h + 0.55]], openEnds: [h], ledU: [],
      saloon: [-5.95, 9.00], bay: 2.04, bayU0: -5.79, nBay: 7,
      cab: { u: -8.85, dir: -1, y: F0, text: 'Accès motrice arrière — verrouillé' },
    };
    // Rear vestibule right luggage rack (+w) & left trash bin (-w)
    Q.blocks.push({ u0: -8.83, u1: -8.22, w0: 0.76, w1: wall });
    Q.blocks.push({ u0: -8.78, u1: -8.32, w0: -wall, w1: -0.88 });
    Q.ledU.push(-7.55);

    const bay = 2.04, u0 = -5.79;
    for (let b = 0; b < 7; b++) {
      const a = u0 + b * bay, uc = a + bay / 2;
      Q.win.push({ u: uc, dy: 0, side: 0 });
      Q.legroom.push({ u: uc });
      Q.ledU.push(uc);
      const carre = b === 1 || b === 4;
      if (carre) {
        for (const [ub, dir] of [[a + 0.14, 1], [a + bay - 0.14, -1]]) {
          for (const sd of [-1, 1]) {
            Q.seats.push({ u: ub, dir, w: sd * 0.71, width: 0.38, arm: -sd });
            Q.seats.push({ u: ub, dir, w: sd * 1.13, width: 0.38, arm: 0 });
            const lo = Math.min(ub - dir * 0.12, ub + dir * 0.44), hi = Math.max(ub - dir * 0.12, ub + dir * 0.44);
            Q.blocks.push({ u0: lo, u1: hi, w0: sd > 0 ? 0.52 : -wall, w1: sd > 0 ? wall : -0.52 });
          }
        }
        for (const sd of [-1, 1]) {
          Q.tables.push({ u: uc, w0: sd > 0 ? 0.64 : -1.28, w1: sd > 0 ? 1.28 : -0.64, y: F1 + 0.72, len: 0.38, lamp: 0 });
          Q.blocks.push({ u0: uc - 0.20, u1: uc + 0.20, w0: sd > 0 ? 0.72 : -wall, w1: sd > 0 ? wall : -0.72 });
        }
      } else {
        for (const ub of [a + 0.22, a + 1.24]) {
          for (const sd of [-1, 1]) {
            Q.seats.push({ u: ub, dir: 1, w: sd * 0.71, width: 0.38, arm: -sd, tablette: true });
            Q.seats.push({ u: ub, dir: 1, w: sd * 1.13, width: 0.38, arm: 0, tablette: true });
            Q.blocks.push({ u0: ub - 0.12, u1: ub + 0.42, w0: sd > 0 ? 0.52 : -wall, w1: sd > 0 ? wall : -0.52 });
          }
        }
      }
    }
    return Q;
  };

  const motrice = makeMotrice(T.cars[0]);
  const coachR1 = makeR1(T.cars[1]);
  const coachR2 = makeR2(T.cars[2]);
  const coachR3 = makeR3(T.cars[3]);
  const motriceTail = mirrorLayout(makeMotrice(T.cars[T.cars.length - 1]));

  const byKind = { motrice, coachR1, coachR2, coachR3 };
  const cars = T.cars.map((len, i) => {
    if (i === 0) return motrice;
    if (i === T.cars.length - 1) return motriceTail;
    const k = T.kinds?.[i];
    return byKind[k] || (i === 1 ? coachR1 : i === 2 ? coachR2 : coachR3);
  });
  return { motrice, coachR1, coachR2, coachR3, cars, winW, winY0, winY1, F0, F1 };
}

// floor height (above rail head) at u of a car : stepwell (0.80 m) ramped up to saloon / gangways (1.08 m)
export function floorOfCar(Q, u) {
  const T = CONFIG.train; let t = 0;
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

// body atlas 1024 x 1024 :
//   0..179   sideMotrice (y 0.55..3.40)
//   180..359 sideR1      (y 0.55..3.40)
//   360..539 sideR2      (y 0.55..3.40)
//   540..719 sideR3      (y 0.55..3.40)
//   720..815 logos       (un-mirrored decal quads: sncf, tgv, num1, num3, bar)
//   816..919 roof        (metallic weathered grey + soot)
//   920..1023 door       (Carmillon plug door leaf)
export const ATLAS = {
  sideMotrice: [0, 180, 0.55, 3.40],
  sideR1:      [180, 360, 0.55, 3.40],
  sideR2:      [360, 540, 0.55, 3.40],
  sideR3:      [540, 720, 0.55, 3.40],
  logos: {
    sncf: [0, 720, 240, 816],
    tgv:  [240, 720, 640, 816],
    num1: [640, 720, 736, 816],
    num3: [736, 720, 832, 816],
    bar:  [832, 720, 1024, 816],
  },
  roof: [816, 920],
  door: [920, 1024],
};

function bodyTex() {
  return canvasTex(1024, 1024, (x, W) => {
    const drawSideBand = (region, kind) => {
      const [r0, r1, y0m, y1m] = region, H = r1 - r0, py = (y) => r0 + (1 - (y - y0m) / (y1m - y0m)) * H;
      // Metallic silver-grey aluminum TGV skin
      const g = x.createLinearGradient(0, r0, 0, r1);
      g.addColorStop(0, '#c2c6ca'); g.addColorStop(0.52, '#b2b6ba'); g.addColorStop(1, '#8e9398');
      x.fillStyle = g; x.fillRect(0, r0, W, H);
      // Dark anthracite window ribbon (y 1.68..2.94) + silver cant highlight
      x.fillStyle = '#24282d'; x.fillRect(0, py(2.94), W, py(1.68) - py(2.94));
      x.fillStyle = 'rgba(210,220,230,0.22)'; x.fillRect(0, py(2.96), W, 2);
      // Dark slate solebar skirt (y 0.55..1.24)
      x.fillStyle = '#2b3035'; x.fillRect(0, py(1.24), W, r1 - py(1.24));
      x.fillStyle = 'rgba(18,20,24,0.6)'; x.fillRect(0, py(1.24), W, 2);

      // Carmillon accents per car
      const carm = x.createLinearGradient(0, r0, W, r1);
      carm.addColorStop(0, '#b81d5b'); carm.addColorStop(1, '#7a1b54');

      if (kind === 'motrice') {
        // Diagonal Carmillon flash behind cab door (x 610..735)
        x.fillStyle = carm;
        x.beginPath(); x.moveTo(605, r1); x.lineTo(668, r1); x.lineTo(745, r0); x.lineTo(690, r0); x.closePath(); x.fill();
        // Charcoal cab mask across the entire nose (x 715..1024)
        x.fillStyle = '#1b1e22';
        x.beginPath(); x.moveTo(668, r1); x.lineTo(W, r1); x.lineTo(W, r0); x.lineTo(745, r0); x.closePath(); x.fill();
        // Louver dark shadow bays on skin
        x.fillStyle = '#1f2328';
        x.fillRect(220, py(2.78), 160, py(1.74) - py(2.78));
        x.fillRect(465, py(2.78), 150, py(1.74) - py(2.78));
      } else if (kind === 'R1') {
        // 1re Classe carmine header stripe + Carmillon vestibule flash at +u end
        x.fillStyle = '#9e1a4a'; x.fillRect(0, py(3.01), W, py(2.91) - py(3.01));
        x.fillStyle = carm;
        x.beginPath(); x.moveTo(820, r1); x.lineTo(W, r1); x.lineTo(W, r0); x.lineTo(875, r0); x.closePath(); x.fill();
      } else if (kind === 'R2') {
        // Voiture Bar : Carmillon wave sweeping across the Bistro / Bar half
        const wave = x.createLinearGradient(460, 0, W, 0);
        wave.addColorStop(0, 'rgba(184,29,91,0)'); wave.addColorStop(0.18, '#b81d5b'); wave.addColorStop(0.7, '#8e1b52'); wave.addColorStop(1, '#68194a');
        x.fillStyle = wave; x.fillRect(450, py(2.95), 540, py(1.26) - py(2.95));
        x.fillStyle = '#9e1a4a'; x.fillRect(490, py(3.02), 480, py(2.94) - py(3.02));
      } else if (kind === 'R3') {
        // 2nde Classe subtle slate-teal hairline + Carmillon vestibule flash at -u end
        x.fillStyle = '#366873'; x.fillRect(0, py(2.99), W, py(2.91) - py(2.99));
        x.fillStyle = carm;
        x.beginPath(); x.moveTo(0, r1); x.lineTo(205, r1); x.lineTo(150, r0); x.lineTo(0, r0); x.closePath(); x.fill();
      }

      // Panel seams & weathered road grime
      for (let k = 0; k < 18; k += 1.25) { x.fillStyle = 'rgba(24,26,28,0.26)'; x.fillRect((k / 18) * W, r0, 1, H); }
      for (let k = 0; k < 140; k++) {
        const sx = hash(k, r0) * W, sy = py(1.72) + hash(r0, k) * (r1 - py(1.72)) * 0.72, sh = 8 + hash(k, 4) * 32;
        const gs = x.createLinearGradient(0, sy, 0, sy + sh);
        gs.addColorStop(0, 'rgba(34,28,22,0.14)'); gs.addColorStop(1, 'rgba(34,28,22,0)');
        x.fillStyle = gs; x.fillRect(sx, sy, 1 + hash(k, 3) * 1.8, sh);
      }
      const gd = x.createLinearGradient(0, py(1.25), 0, r1);
      gd.addColorStop(0, 'rgba(20,18,16,0)'); gd.addColorStop(1, 'rgba(20,18,16,0.62)');
      x.fillStyle = gd; x.fillRect(0, py(1.25), W, r1 - py(1.25));
    };

    drawSideBand(ATLAS.sideMotrice, 'motrice');
    drawSideBand(ATLAS.sideR1, 'R1');
    drawSideBand(ATLAS.sideR2, 'R2');
    drawSideBand(ATLAS.sideR3, 'R3');

    // ---- Logos band [720..816] (un-mirrored decal cells)
    x.fillStyle = '#b2b6ba'; x.fillRect(0, 720, W, 96);
    // 1. SNCF Carmillon pill badge [0..240]
    {
      const g = x.createLinearGradient(14, 728, 226, 808);
      g.addColorStop(0, '#b81d5b'); g.addColorStop(1, '#7a1b54');
      x.fillStyle = g;
      x.beginPath(); x.roundRect(14, 730, 212, 76, 14); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'bold italic 46px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('SNCF', 120, 770);
    }
    // 2. TGV inOui wordmark [240..640]
    {
      x.fillStyle = '#b2b6ba'; x.fillRect(240, 720, 400, 96);
      x.fillStyle = '#24282d'; x.font = 'bold italic 50px Arial, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText('TGV', 260, 770);
      const gc = x.createLinearGradient(390, 735, 620, 800);
      gc.addColorStop(0, '#b81d5b'); gc.addColorStop(1, '#7a1b54');
      x.fillStyle = gc; x.beginPath(); x.roundRect(390, 736, 232, 64, 10); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'italic bold 42px Arial, sans-serif'; x.textAlign = 'center';
      x.fillText('inOui', 506, 770);
    }
    // 3. Class 1 badge [640..736]
    {
      x.fillStyle = '#9e1a4a'; x.fillRect(640, 720, 96, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('1', 688, 760);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('1re', 688, 798);
    }
    // 4. Class 2 (Voiture 3) badge [736..832]
    {
      x.fillStyle = '#2b3035'; x.fillRect(736, 720, 96, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('3', 784, 760);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('2nde', 784, 798);
    }
    // 5. BAR banner [832..1024]
    {
      x.fillStyle = '#9e1a4a'; x.fillRect(832, 720, 192, 96);
      x.fillStyle = '#ffffff'; x.font = 'bold 42px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('BAR', 928, 758);
      x.font = 'bold 16px Arial, sans-serif'; x.fillText('LE BISTRO', 928, 794);
    }

    // ---- Roof band [816..920] : metallic weathered grey + pantograph soot
    {
      const g2 = x.createLinearGradient(0, 816, 0, 920);
      g2.addColorStop(0, '#686c70'); g2.addColorStop(1, '#4c4f52');
      x.fillStyle = g2; x.fillRect(0, 816, W, 104);
      for (let k = 0; k < 160; k++) {
        x.fillStyle = `rgba(${22 + hash(k, 1) * 26},${20 + hash(k, 2) * 18},16,0.28)`;
        x.fillRect(hash(k, 3) * W, 816 + hash(k, 4) * 104, 2 + hash(k, 5) * 18, 1 + hash(k, 6) * 3);
      }
    }

    // ---- Door band [920..1024] : Carmillon carmine-magenta plug door + dark window frame + grime
    {
      const g3 = x.createLinearGradient(0, 920, 0, 1024);
      g3.addColorStop(0, '#b01b56'); g3.addColorStop(0.55, '#8e1849'); g3.addColorStop(1, '#292c30');
      x.fillStyle = g3; x.fillRect(0, 920, W, 104);
      x.fillStyle = '#24282d'; x.fillRect(190, 932, 644, 46);
      x.fillStyle = '#e5e7eb'; x.fillRect(60, 982, 904, 4);
      for (let k = 0; k < 45; k++) {
        x.fillStyle = `rgba(25,20,16,${0.06 + hash(k, 2) * 0.12})`;
        x.fillRect(hash(k, 1) * W, 920 + hash(k, 3) * 104, 2 + hash(k, 4) * 4, 8 + hash(k, 5) * 32);
      }
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

    // TVM-430 / ETCS cab display [0, 32, 256, 64]
    x.fillStyle = '#060c14'; x.fillRect(0, 32, 256, 32);
    x.fillStyle = '#18304a'; x.fillRect(6, 36, 90, 24);
    x.fillStyle = '#4de88a'; x.font = 'bold 14px monospace'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText('TVM 300', 12, 48);
    x.fillStyle = '#ffb02a'; x.fillRect(104, 36, 68, 24);
    x.fillStyle = '#05070a'; x.font = 'bold 13px monospace'; x.fillText('ETCS L2', 110, 48);
    x.fillStyle = '#7ec8ff'; x.fillRect(180, 36, 70, 24);

    // Exterior amber LED board [256, 32, 512, 64]
    x.fillStyle = '#05070a'; x.fillRect(256, 32, 256, 32);
    x.fillStyle = '#ffb02a'; x.font = 'bold 15px Arial, sans-serif'; x.textAlign = 'center';
    x.fillText('TGV 9572 · STRASBOURG', 384, 49);

    // Main screen [0, 64, 512, 128]
    x.fillStyle = '#05070a'; x.fillRect(0, 64, 512, 64);
    x.fillStyle = '#ffb02a'; x.font = 'bold 24px Arial, sans-serif'; x.fillText('TGV 9572 · Paris-Est → Strasbourg', 256, 86);
    x.fillStyle = '#8ec8ff'; x.font = '16px Arial, sans-serif'; x.fillText('Prochain arrêt : Strasbourg-Ville (Terminus)', 256, 112);

    // R1 1re Classe [0, 128, 256, 192]
    x.fillStyle = '#05070a'; x.fillRect(0, 128, 256, 64);
    x.fillStyle = '#ff4d88'; x.fillRect(0, 128, 256, 6);
    x.fillStyle = '#ffb02a'; x.font = 'bold 18px Arial, sans-serif'; x.fillText('1re Classe · Voiture 1', 128, 152);
    x.fillStyle = '#8ec8ff'; x.font = '14px Arial, sans-serif'; x.fillText('TGV 9572 → Strasbourg', 128, 174);

    // R3 2nde Classe [256, 128, 512, 192]
    x.fillStyle = '#05070a'; x.fillRect(256, 128, 256, 64);
    x.fillStyle = '#368a9c'; x.fillRect(256, 128, 256, 6);
    x.fillStyle = '#ffb02a'; x.font = 'bold 18px Arial, sans-serif'; x.fillText('2nde Classe · Voiture 3', 384, 152);
    x.fillStyle = '#8ec8ff'; x.font = '14px Arial, sans-serif'; x.fillText('TGV 9572 → Strasbourg', 384, 174);

    // Bar Menu [0, 192, 256, 256]
    x.fillStyle = '#090608'; x.fillRect(0, 192, 256, 64);
    x.fillStyle = '#ff4d88'; x.fillRect(0, 192, 256, 6);
    x.fillStyle = '#ffe4b5'; x.font = 'bold 17px Arial, sans-serif'; x.fillText('VOITURE BAR · LE BISTRO', 128, 216);
    x.fillStyle = '#ffb02a'; x.font = '13px Arial, sans-serif'; x.fillText('Café · Boissons · Snacking', 128, 238);

    // Chilled Drinks Vitrine [256, 192, 512, 256]
    x.fillStyle = '#0c1c28'; x.fillRect(256, 192, 256, 64);
    for (const sy of [210, 232, 250]) { x.fillStyle = '#bfe6ff'; x.fillRect(264, sy, 240, 2); }
    for (let k = 0; k < 10; k++) {
      x.fillStyle = k % 3 === 0 ? '#d94862' : k % 3 === 1 ? '#58c47a' : '#7cb8e8';
      x.fillRect(272 + k * 23, 198, 10, 12);
      x.fillRect(272 + k * 23, 218, 10, 14);
      x.fillRect(272 + k * 23, 237, 10, 13);
    }

    // Subtle LCD scanlines across all screens
    x.fillStyle = 'rgba(0,0,0,0.42)';
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
    body:     new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.48, metalness: 0.44 }),
    dark:     new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.45 }),
    inside:   new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06, emissive: 0x0b0d10 }),
    glass:    new THREE.MeshStandardMaterial({ color: 0x8fa4b0, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    screen:   new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.82, depthWrite: false, envMapIntensity: 1.6 }),
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

// ------------------------------------------------------------------ saloon window pane, cracks, shards
export function buildWindowGeometry() {
  const L = carLayouts(), w = L.winW, y0 = L.winY0, y1 = L.winY1;
  const pane = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.12), 4), 0, 1);
  const crack = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.12), 4), 0.004, 1);
  { const p = crack.attributes.position, uv = crack.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, (p.getY(i) - y0) / (y1 - y0)); }
  const s = rrect(-w / 2, y0, w / 2, y1, 0.12), hole = new THREE.Path(), n = 34, pts = [];
  for (let k = 0; k < n; k++) {
    const f = k / n, per = 2 * (w + (y1 - y0)), d = f * per; let px, py;
    if (d < w) { px = -w / 2 + d; py = y0; } else if (d < w + (y1 - y0)) { px = w / 2; py = y0 + d - w; } else if (d < 2 * w + (y1 - y0)) { px = w / 2 - (d - w - (y1 - y0)); py = y1; } else { px = -w / 2; py = y1 - (d - 2 * w - (y1 - y0)); }
    const depth = 0.05 + hash(k, 77) * 0.25 * (k % 3 === 0 ? 1 : 0.45), cxp = 0, cyp = (y0 + y1) / 2, dx = cxp - px, dy = cyp - py, l = Math.hypot(dx, dy) || 1;
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

// TGV palette (desaturated for ACESFilmic)
const C = {
  steel: 0x3d4145, black: 0x161717, rubber: 0x1b1b1c, rust: 0x4a3326, axle: 0x2c2b29, wheel: 0x3a3632, disc: 0x55524d, yellow: 0x6e5a22,
  insulator: 0x5a2e22, grey: 0x55585b, rack: 0x6a6e72, pedestal: 0x22252a, partition: 0x52565c,
  // R1 1re Classe
  seatR1: 0x5e1e32, headR1: 0xc8c3ba, curtain: 0x521d2b, floorR1: 0x2d242a, aisleR1: 0x363438, wood: 0x5a4232, brass: 0x8a6f3d,
  // R2 Voiture Bar
  barWood: 0x3b2c26, barFront: 0x282a2e, barCarmine: 0x8a1c44, barChrome: 0x767c82, floorR2: 0x26262a, aisleR2: 0x323338,
  // R3 2nde Classe
  seatR3: 0x284b57, headR3: 0x6c7c84, blind: 0x3e444a, floorR3: 0x292d32, aisleR3: 0x363a40, tablette: 0x464a4f,
  // Shared linings
  lining: 0x8d8e8a, liningLow: 0x4d5055, ceiling: 0x9b9c98, slate: 0x3a4550,
};

// ------------------------------------------------------------------ TGV Y230 / Y237 bogies ('motor' | 'trailer')
export function buildBogieGeometry(kind = 'motor') {
  const B = buckets(), motor = kind === 'motor';
  const r = motor ? 0.46 : 0.44, wb = CONFIG.train.bogieWb ?? 3.0, yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036, u = 0;
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 16), C.wheel);
      B.add('dark', cyl(u + a, yAx, s * (g + 0.072), r * 0.82, 0.03, 'w', 16), C.rust);
      B.add('dark', cbox(u + a, yAx, s * 1.06, 0.38, 0.30, 0.22, 0.03), C.steel);
      for (let k = 0; k < 4; k++) B.add('dark', new THREE.TorusGeometry(0.072, 0.017, 4, 8).rotateX(Math.PI / 2).translate(s * 1.06, yAx + 0.19 + k * 0.048, -(u + a)), C.rust);
      for (const dw of [0.35, 0.48]) B.add('dark', cyl(u + a, yAx, s * dw, r * 0.68, 0.045, 'w', 14), C.disc);
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.085, 2 * g, 'w', 8), C.axle);
  }
  const fs = new THREE.Shape(), L = wb / 2 + 0.55, y0 = yAx + 0.14;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.27); fs.lineTo(-0.78, y0 + 0.36); fs.lineTo(-0.52, y0 + 0.12);
  fs.lineTo(0.52, y0 + 0.12); fs.lineTo(0.78, y0 + 0.36); fs.lineTo(L, y0 + 0.27); fs.lineTo(L, y0);
  fs.lineTo(0.62, y0 - 0.05); fs.lineTo(-0.62, y0 - 0.05); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) {
    const gf = extr(fs, 0.14, 0.015, 2); gf.translate(0, 0, -0.07); onSide(gf, s * 1.06, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel);
    B.add('dark', cyl(u, yAx + 0.54, s * 0.92, 0.27, 0.25, 'y', 12), C.rubber);
    B.add('dark', tube([u - 1.20, yAx + 0.16, s * 1.18], [u, yAx + 0.52, s * 1.18], 0.032, 6), C.black);
  }
  B.add('dark', cbox(u, yAx + 0.27, 0, 0.54, 0.24, 2.04, 0.04), C.steel);
  if (motor) {
    for (const s of [-1, 1]) for (const du of [-0.62, 0.62]) B.add('dark', cyl(u + du, yAx + 0.06, s * 0.38, 0.17, 0.52, 'u', 10), C.axle);
  } else {
    B.add('dark', cyl(u, yAx + 0.45, 0, 0.24, 0.12, 'y', 12), C.steel); // Jacobs pivot collar
  }
  return B.merge().dark;
}

// ------------------------------------------------------------------ aerodynamic TGV POS / Réseau nose (uF = +4.10 -> tip +9.70)
const NOSE_T = [0, 0.08, 0.16, 0.24, 0.30, 0.38, 0.46, 0.54, 0.60, 0.68, 0.76, 0.84, 0.90, 0.95, 0.985, 1.0];
const NOSE_TOP = [[0, 1.00], [0.16, 0.97], [0.28, 0.845], [0.38, 0.76], [0.48, 0.65], [0.58, 0.555], [0.70, 0.49], [0.82, 0.42], [0.92, 0.35], [0.97, 0.31], [1.0, 0.285]];
const NOSE_FW = [[0, 1.00], [0.28, 0.95], [0.58, 0.82], [0.82, 0.62], [0.94, 0.42], [1.0, 0.24]];
const NOSE_YBOT = [[0, 0.55], [0.58, 0.50], [0.85, 0.44], [0.95, 0.50], [1.0, 0.62]];
const lerpKeys = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; } return K[K.length - 1][1]; };

export function noseSection(t) {
  const T = CONFIG.train;
  return { fw: lerpKeys(NOSE_FW, t), yBot: lerpKeys(NOSE_YBOT, t), yTop: T.height * lerpKeys(NOSE_TOP, t), round: 0.58 * Math.pow(t, 1.15) };
}

function roofProfile() {
  const T = CONFIG.train, Wd = T.width / 2;
  return [[1.45, 3.25], [1.44, 3.45], [1.4, 3.62], [1.31, 3.77], [1.17, 3.88], [0.93, 3.97], [0.58, 4.03], [0.2, 4.05], [-0.2, 4.05], [-0.58, 4.03], [-0.93, 3.97], [-1.17, 3.88], [-1.31, 3.77], [-1.4, 3.62], [-1.44, 3.45], [-1.45, 3.25]]
    .map(([w, y]) => [(w * Wd) / 1.45, 3.25 + ((y - 3.25) * (T.height - 3.25)) / 0.8]);
}

function buildNose(B, u0, Ln, yb, yc) {
  const T = CONFIG.train, Wd = T.width / 2, Ht = T.height, prof = roofProfile();
  const base = [[Wd, yb], [Wd, yb + (yc - yb) / 3], [Wd, yb + (2 * (yc - yb)) / 3], ...prof, [-Wd, yb + (2 * (yc - yb)) / 3], [-Wd, yb + (yc - yb) / 3], [-Wd, yb]];
  const n = base.length, isTop = base.map(([w, y]) => y >= yc + 0.08 && Math.abs(w) < 1.28);
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
    else if (i >= 4 && i <= 7 && top) set = 'screen';
    else if (i >= 3 && i <= 8 && near) set = 'frame';
    add(set, i, j);
  }
  const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ns * n * 2), 2)); return g; };
  if (sets.body.length) B.add('body', uvSide(mk(sets.body), ATLAS.sideMotrice, T.cars[0]));
  if (sets.frame.length) B.add('dark', mk(sets.frame), C.rubber);
  if (sets.screen.length) B.add('screen', mk(sets.screen));
  if (sets.mask.length) B.add('dark', mk(sets.mask), C.black);
  // Front tip cap
  { const i = ns - 1, idx = []; for (let j = 1; j < n - 1; j++) { const a = i * n, b = i * n + j, d = i * n + j + 1; const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], fx = P[d * 3] - P[a * 3], fy = P[d * 3 + 1] - P[a * 3 + 1]; idx.push(...((ex * fy - ey * fx) * -1 > 0 ? [a, b, d] : [a, d, b])); } B.add('dark', mk(idx), C.black); }
  // Attached TGV nose details: center mullion, twin wipers, recessed coupler hatch, headlight bezels, top marker, snowplow skirt
  B.add('dark', tube([5.72, 3.38, 0], [7.28, 2.26, 0], 0.030, 6), C.black);
  for (const s of [-1, 1]) {
    B.add('dark', tube([7.22, 2.34, s * 0.14], [6.44, 2.86, s * 0.58], 0.014, 5), C.black);
    const bz = cbox(0, 0, 0, 0.24, 0.18, 0.30, 0.02); bz.rotateY(-s * 0.34); bz.translate(s * 0.45, 0.98, -9.16);
    B.add('dark', bz, C.black);
  }
  B.add('dark', cbox(9.35, 0.88, 0, 0.36, 0.40, 0.72, 0.04), C.black);   // coupler hatch
  B.add('dark', cbox(9.55, 0.88, 0, 0.03, 0.36, 0.03, 0.005), C.steel);  // hatch split seam
  B.add('dark', cbox(5.62, 3.48, 0, 0.20, 0.13, 0.24, 0.02), C.black);   // 3rd top marker housing
  B.add('dark', cbox(9.30, 0.44, 0, 0.42, 0.18, 0.95, 0.03), C.black);   // lower obstacle deflector
}

// Helper for crisp un-mirrored exterior logo/number quads on both side = +1 and side = -1
function addLogo(B, rect, u, y, w, h, side, Wd) {
  const g = uvAtlasRect(plane(w, h), rect);
  onSide(g, side * (Wd + 0.008), side);
  g.translate(0, y, -u);
  B.add('body', g);
}

// Helper for crisp un-mirrored exterior amber LED destination board
function addExtLed(B, u, y, w, h, side, Wd) {
  const g = uvRect(plane(w, h), PANEL.extLed);
  onSide(g, side * (Wd + 0.008), side);
  g.translate(0, y, -u);
  B.add('panel', g);
}

// Helper to build a bulkhead/partition wall with rectangular doorway (+ optional side windows) without Shape-hole glitches
function addWallWithDoor(B, u0, face, wMax, yBot, yTop, pdw, doorTop, colWall, wins = null) {
  const addRect = (x0, x1, y0, y1) => {
    if (x1 <= x0 + 1e-4 || y1 <= y0 + 1e-4) return;
    const g = cbox(u0, (y0 + y1) / 2, (x0 + x1) / 2, 0.055, y1 - y0, x1 - x0, 0.008);
    B.add('inside', g, colWall);
  };
  addRect(-pdw, pdw, doorTop, yTop); // lintel above doorway
  if (!wins) {
    addRect(-wMax, -pdw, yBot, yTop);
    addRect(pdw, wMax, yBot, yTop);
  } else {
    const [wy0, wy1, wIn] = wins;
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
  // Brushed steel doorway frame
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, -pdw - 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
  B.add('inside', cbox(u0, (yBot + doorTop) / 2, pdw + 0.02, 0.07, doorTop - yBot, 0.04, 0.006), C.steel);
}

// ------------------------------------------------------------------ car body builder
// kind : 'motrice' | 'coachR1' | 'coachR2' | 'coachR3'
export function buildCarGeometry(kind) {
  const T = CONFIG.train, W = T.walk, Lay = carLayouts(), Q = Lay[kind] || Lay.coachR2;
  const L = Q.len, h = Q.h, Wd = T.width / 2, F0 = T.floor, F1 = T.floorHigh, B = buckets();
  const isMotrice = kind === 'motrice', Ln = T.layout.taper, uF = isMotrice ? h - Ln : h, uA = -h;
  const yb = 0.55, yc = 3.25, lin = W.wall + 0.01, ceil = T.ceil ?? 3.16;
  const { winW, winY0, winY1 } = Lay, dw = T.doorWidth / 2, dTop = F0 + T.doorH;
  const sideRegion = isMotrice ? ATLAS.sideMotrice : kind === 'coachR1' ? ATLAS.sideR1 : kind === 'coachR2' ? ATLAS.sideR2 : ATLAS.sideR3;

  // ---- exterior sides & window/door cutouts
  const cabWin = isMotrice ? { u: 3.45, w: 0.72 } : null;
  for (const side of [-1, 1]) {
    const X = (u) => sx(side, u);
    const x0 = Math.min(X(uA), X(uF)), x1 = Math.max(X(uA), X(uF));
    const s = new THREE.Shape([new THREE.Vector2(x0, yb), new THREE.Vector2(x1, yb), new THREE.Vector2(x1, yc), new THREE.Vector2(x0, yc)]);
    const sideWins = Q.win.filter((q) => !q.side || q.side === side);
    for (const q of sideWins) s.holes.push(rrect(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, true));
    for (const u of Q.doors) s.holes.push(rrect(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.08, true));
    if (cabWin) s.holes.push(rrect(X(cabWin.u) - cabWin.w / 2, 1.98, X(cabWin.u) + cabWin.w / 2, 2.86, 0.07, true));
    const g = extr(s, Wd - lin - 0.02, 0, 3); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, sideRegion, L));

    for (const q of sideWins) {
      const gk = extr(ring(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, 0.045), 0.02, 0, 3);
      onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
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
      const fr = extr(ring(X(cabWin.u) - cabWin.w / 2, 1.98, X(cabWin.u) + cabWin.w / 2, 2.86, 0.07, 0.04), 0.02, 0, 3);
      onSide(fr, side * Wd, side); B.add('dark', fr, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(cabWin.u) - cabWin.w / 2, 1.98, X(cabWin.u) + cabWin.w / 2, 2.86, 0.07), 3), side * (Wd - 0.04), side));
      B.add('dark', tube([cabWin.u - 0.50, 1.25, side * (Wd + 0.05)], [cabWin.u - 0.50, 2.45, side * (Wd + 0.05)], 0.018, 5), C.steel);
      B.add('dark', cbox(cabWin.u + 0.58, 2.66, side * (Wd + 0.08), 0.16, 0.10, 0.16, 0.02), C.black); // rearview camera pod
    }
    B.add('dark', cbox((uA + uF) / 2, yc + 0.02, side * (Wd - 0.02), uF - uA, 0.06, 0.08, 0.02), C.steel);
    B.add('dark', cbox((uA + uF) / 2, yb + 0.03, side * (Wd - 0.03), uF - uA - 0.2, 0.07, 0.07, 0.02), C.black);

    // Exterior un-mirrored Carmillon / inOui decals & LED boards
    if (isMotrice) {
      addLogo(B, ATLAS.logos.sncf, 2.45, 1.50, 0.90, 0.36, side, Wd);
      addLogo(B, ATLAS.logos.tgv, -1.60, 2.25, 1.45, 0.35, side, Wd);
      // 2 cooling louver bays (persiennes) with horizontal steel slats
      for (const [lu0, lu1] of [[-5.4, -2.4], [-0.8, 2.0]]) {
        B.add('dark', cbox((lu0 + lu1) / 2, 2.26, side * (Wd - 0.02), lu1 - lu0, 1.00, 0.05, 0.01), C.black);
        for (let k = 0; k < 7; k++) B.add('dark', cbox((lu0 + lu1) / 2, 1.84 + k * 0.14, side * (Wd + 0.005), lu1 - lu0 - 0.12, 0.04, 0.04, 0.005), C.steel);
      }
    } else if (kind === 'coachR1') {
      addLogo(B, ATLAS.logos.num1, 6.55, 2.40, 0.40, 0.40, side, Wd);
      addExtLed(B, 6.55, 1.98, 0.72, 0.11, side, Wd);
      addLogo(B, ATLAS.logos.sncf, 6.55, 1.48, 0.80, 0.32, side, Wd);
      addLogo(B, ATLAS.logos.tgv, -8.85, 1.48, 1.15, 0.28, side, Wd);
    } else if (kind === 'coachR2') {
      if (side < 0) addLogo(B, ATLAS.logos.bar, 4.00, 2.26, 0.96, 0.44, side, Wd);
      else addLogo(B, ATLAS.logos.bar, 0.15, 1.46, 0.76, 0.34, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -8.20, 1.48, 0.80, 0.32, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 8.20, 1.48, 1.15, 0.28, side, Wd);
    } else if (kind === 'coachR3') {
      addLogo(B, ATLAS.logos.num3, -6.55, 2.40, 0.40, 0.40, side, Wd);
      addExtLed(B, -6.55, 1.98, 0.72, 0.11, side, Wd);
      addLogo(B, ATLAS.logos.sncf, -6.55, 1.48, 0.80, 0.32, side, Wd);
      addLogo(B, ATLAS.logos.tgv, 8.80, 1.48, 1.15, 0.28, side, Wd);
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
      // Raised pantograph well side fairings, central dynamic brake louvers, HV busbar & insulators
      for (const s of [-1, 1]) {
        B.add('dark', cbox(1.80, T.height + 0.08, s * 1.04, 2.40, 0.16, 0.24, 0.02), C.grey);
        B.add('dark', cbox(-6.80, T.height + 0.08, s * 1.04, 2.80, 0.16, 0.24, 0.02), C.grey);
      }
      B.add('dark', cbox(-2.90, T.height + 0.06, 0, 3.20, 0.14, 1.50, 0.04), C.grey);
      for (let k = 0; k < 8; k++) B.add('dark', cbox(-4.2 + k * 0.38, T.height + 0.14, 0, 0.06, 0.03, 1.25, 0.01), C.black);
      B.add('dark', tube([-6.8, T.height + 0.16, 0.45], [1.8, T.height + 0.16, 0.45], 0.02, 6), C.rust);
      for (const u of [-4.8, -1.0, 0.2]) B.add('dark', cyl(u, T.height + 0.08, 0.45, 0.055, 0.12, 'y', 8), C.insulator);
    } else {
      // Passenger coach low-profile HVAC pod & roof cable conduit
      B.add('dark', cbox(0, T.height + 0.06, 0, 2.6, 0.18, 1.55, 0.05), C.grey);
      for (let k = 0; k < 5; k++) B.add('dark', cbox(-0.9 + k * 0.45, T.height + 0.16, 0, 0.05, 0.025, 1.2, 0.01), C.black);
      B.add('dark', cbox(0, T.height + 0.02, 0.92, L - 1.6, 0.04, 0.26, 0.01), C.grey);
    }
  }

  // ---- Motrice nose, cab rear wall, rear coupler wall & underframe
  if (isMotrice) {
    buildNose(B, uF, Ln, yb, yc);
    // Rear flat bulkhead (u = -9.70) + coupler shroud
    B.add('body', uvRegion(onEnd(plane(T.width, yc - yb).translate(0, (yb + yc) / 2, 0), -h, -1), ATLAS.roof, (x) => (x + Wd) / T.width, (x, y) => (y - yb) / (yc - yb)));
    B.add('dark', cbox(-h - 0.06, 2.0, 0, 0.12, 2.2, 1.4, 0.04), C.rubber);
    B.add('dark', cbox(-h - 0.15, 0.92, 0, 0.30, 0.25, 0.6, 0.03), C.black);
    // Rear cab wall at u = +4.10 sealing nose interior from the dark equipment bay
    B.add('inside', cbox(uF, 2.1, 0, 0.08, 2.2, 2 * lin, 0.01), C.black);
    // Underframe traction transformer & skirting
    B.add('dark', cbox(-1.0, yb - 0.18, 0, 5.4, 0.38, 1.85, 0.05), C.axle);
    for (const s of [-1, 1]) B.add('dark', cbox(-1.0, yb - 0.04, s * (Wd - 0.16), 6.2, 0.14, 0.08, 0.02), C.black);
    return B.merge();
  }

  // ---- Passenger coach underframe
  for (const u of [-3.6, 0.0, 3.6]) B.add('dark', cbox(u, yb - 0.18, 0, 2.2, 0.34, 1.65, 0.04), C.axle);
  for (const s of [-1, 1]) B.add('dark', cbox(0, yb - 0.04, s * (Wd - 0.16), L - 5.0, 0.12, 0.08, 0.02), C.black);

  // ---- inner ceiling & coves (saloon/vestibules) : downward-facing normals (-Y)
  {
    const cv = [[lin + 0.03, ceil - 0.12], [0.95, ceil], [-0.95, ceil], [-lin - 0.03, ceil - 0.12]];
    const uC0 = kind === 'coachR3' ? Q.cab.u : -h, uC1 = kind === 'coachR1' ? Q.cab.u : h, pi = [];
    for (let i = 1; i < cv.length; i++) {
      const [w0, y0] = cv[i - 1], [w1, y1] = cv[i];
      pi.push(w0, y0, -uC1 + 0.05, w1, y1, -uC0 - 0.05, w1, y1, -uC1 + 0.05, w0, y0, -uC1 + 0.05, w0, y0, -uC0 - 0.05, w1, y1, -uC0 - 0.05);
    }
    const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pi, 3)); gi.computeVertexNormals();
    B.add('inside', gi, C.ceiling);
  }

  // ---- open Jacobs gangway ends (R1 -u, R2 +-u, R3 +u)
  const gw = W.gangway / 2, gh = 2.02;
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
    B.add('dark', cbox(uE + dir * 0.18, F1 - 0.015, 0, 0.36, 0.03, W.gangway + 0.08, 0.01), C.steel);
    const yT = ceil - 0.08, yO = F1 + gh, sideW = lin - gw;
    for (const [w, hh, cx, cy] of [[sideW, yT - F1, -(lin + gw) / 2, (F1 + yT) / 2], [sideW, yT - F1, (lin + gw) / 2, (F1 + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) {
      B.add('inside', onEnd(plane(w, hh).translate(cx, cy, 0), uE - dir * 0.07, -dir), C.partition);
    }
    for (const sw of [-1, 1]) B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.06, 8).translate(sw * 1.15, 1.32, 0), uE + dir * 0.005, dir), PANEL.red));
  }

  // ---- sealed end bulkheads (R1 front at +8.85, R3 rear tailU at -8.85 + enclosed dark gangway recess)
  if (Q.cab) {
    const ub = Q.cab.u, dir = Q.cab.dir, pdw = 0.45, doorTop = F0 + 2.00;
    addWallWithDoor(B, ub, -dir, lin, F0, ceil, pdw, doorTop, C.partition);
    B.add('inside', cbox(ub - dir * 0.02, F0 + 0.01, 0, 0.12, 0.02, 2 * pdw + 0.06, 0.004), C.steel);
    B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.045, 10).translate(-dir * 0.72, F0 + 1.30, 0), ub - dir * 0.032, -dir), PANEL.red));
    const scr = kind === 'coachR1' ? PANEL.screenR1 : PANEL.screenR3;
    B.add('panel', uvRect(onEnd(plane(0.62, 0.12).translate(0, doorTop + 0.12, 0), ub - dir * 0.036, -dir), scr));

    // Enclosed dark gangway cavity behind the sealed bulkhead (prevents seeing sky if tailU door opens)
    const uRec0 = dir > 0 ? ub + 0.04 : -h + 0.02, uRec1 = dir > 0 ? h - 0.02 : ub - 0.04;
    const recLen = Math.abs(uRec1 - uRec0), uRecM = (uRec0 + uRec1) / 2;
    B.add('inside', new THREE.PlaneGeometry(2 * lin, recLen).rotateX(-Math.PI / 2).translate(0, F0, -uRecM), C.floorR3);
    B.add('inside', new THREE.PlaneGeometry(2 * lin, recLen).rotateX(Math.PI / 2).translate(0, 3.05, -uRecM), C.black);
    for (const s of [-1, 1]) B.add('inside', cbox(uRecM, 1.9, s * (lin - 0.02), recLen, 2.2, 0.04, 0.005), C.black);
    const uOuter = dir > 0 ? h - 0.02 : -h + 0.02;
    B.add('inside', cbox(uOuter, 1.9, 0, 0.05, 2.3, 2 * lin, 0.005), C.black);
    B.add('body', uvRegion(onEnd(plane(T.width, yc - yb).translate(0, (yb + yc) / 2, 0), dir * h, dir), ATLAS.roof, (x) => (x + Wd) / T.width, (x, y) => (y - yb) / (yc - yb)));
    B.add('dark', cbox(dir * (h + 0.08), 2.0, 0, 0.16, 2.2, 1.4, 0.04), C.rubber);
  }

  // ================================================================ walkable interior
  const fCol = kind === 'coachR1' ? C.floorR1 : kind === 'coachR2' ? C.floorR2 : C.floorR3;
  const aCol = kind === 'coachR1' ? C.aisleR1 : kind === 'coachR2' ? C.aisleR2 : C.aisleR3;
  const uIn0 = kind === 'coachR3' ? Q.cab.u : -h, uIn1 = kind === 'coachR1' ? Q.cab.u : h;

  // Base floor at F0 (stepwells), then raised saloon/gangway floor F1 + 2 steps
  B.add('inside', new THREE.PlaneGeometry(2 * lin, uIn1 - uIn0 - 0.04).rotateX(-Math.PI / 2).translate(0, F0, -(uIn0 + uIn1) / 2), fCol);
  B.add('inside', new THREE.PlaneGeometry(0.84, Q.saloon[1] - Q.saloon[0]).rotateX(-Math.PI / 2).translate(0, F1 + 0.003, -(Q.saloon[0] + Q.saloon[1]) / 2), aCol);

  if (kind === 'coachR2') {
    B.add('inside', cbox(0, (F0 + F1) / 2 - 0.01, 0, L - 0.06, F1 - F0, 2 * lin - 0.02, 0.01), fCol);
  } else {
    for (const z of Q.zones) {
      const a = z[0], m = (z[0] + z[1]) / 2, e = z[2];
      const box = (ua, ub2, top) => { const lo = Math.min(ua, ub2), hi = Math.max(ua, ub2); B.add('inside', cbox((lo + hi) / 2, (F0 + top) / 2 - 0.01, 0, hi - lo, top - F0, 2 * lin - 0.02, 0.01), fCol); };
      box(a, m, F0 + (F1 - F0) / 2);
      box(m, e, F1);
      B.add('inside', cbox((a + m) / 2, F0 + (F1 - F0) / 2 + 0.003, 0, Math.abs(m - a), 0.012, 2 * lin - 0.04, 0.003), aCol);
      B.add('dark', cbox(z[1], F1 + 0.003, 0, 0.04, 0.01, 2 * lin - 0.06, 0.003), C.yellow);
      B.add('dark', cbox(m, F0 + (F1 - F0) / 2 + 0.003, 0, 0.04, 0.01, 2 * lin - 0.06, 0.003), C.yellow);
      // Vertical steel grab stanchions by steps
      for (const sw of [-1, 1]) B.add('inside', tube([(a + m) / 2, F0, sw * 1.15], [(a + m) / 2, ceil - 0.1, sw * 1.15], 0.018, 6), C.steel);
    }
  }

  // ---- interior wall linings (matching asymmetric windows in R2)
  {
    const uLo = uIn0 + 0.04, uHi = uIn1 - 0.04, doors = [...Q.doors].sort((p, q) => p - q);
    for (const side of [-1, 1]) {
      const X = (u) => sx(-side, u);
      const rangeShape = (p, q, y0, y1) => new THREE.Shape([new THREE.Vector2(Math.min(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y1), new THREE.Vector2(Math.min(X(p), X(q)), y1)]);
      const sideWins = Q.win.filter((w) => !w.side || w.side === side);
      let a = uLo; const pieces = [];
      for (const u of doors) { pieces.push([a, u - dw]); a = u + dw; } pieces.push([a, uHi]);
      for (const [p, q] of pieces) {
        if (q - p < 0.05) continue;
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, F0, winY0)), side * lin, -side), C.liningLow);
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, winY0 - 0.04, winY0)), side * (lin - 0.01), -side), C.rack);
        const sh = rangeShape(p, q, winY0, ceil);
        for (const w of sideWins) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winY0 + w.dy + 0.001, X(w.u) + winW / 2, winY1 + w.dy - 0.001, 0.12, true));
        B.add('inside', onSide(new THREE.ShapeGeometry(sh, 3), side * lin, -side), C.lining);
      }
      for (const u of doors) B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(u - dw, u + dw, dTop, ceil)), side * lin, -side), C.lining);
      for (const w of sideWins) {
        const fr = extr(ring(X(w.u) - winW / 2, winY0 + w.dy, X(w.u) + winW / 2, winY1 + w.dy, 0.12, 0.045), 0.025, 0, 3);
        onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition);
        // R1 pleated curtains / R3 roller blinds
        if (kind === 'coachR1') {
          for (const e of [-1, 1]) B.add('inside', cbox(w.u + e * (winW / 2 + 0.04), (winY0 + winY1) / 2, side * (lin - 0.04), 0.14, winY1 - winY0 + 0.04, 0.04, 0.008), C.curtain);
        } else if (kind === 'coachR3') {
          B.add('inside', cbox(w.u, winY1 - 0.11, side * (lin - 0.03), winW - 0.06, 0.22, 0.02, 0.004), C.blind);
          B.add('inside', cbox(w.u, winY1 - 0.22, side * (lin - 0.04), winW - 0.04, 0.02, 0.03, 0.004), C.rack);
        }
      }

      // Overhead luggage racks in R1 & R3
      if (kind === 'coachR1' || kind === 'coachR3') {
        const [r0, r1] = Q.saloon, rw = side * 0.88;
        B.add('inside', cyl((r0 + r1) / 2, 2.66, rw, 0.020, r1 - r0 - 0.2, 'u', 6), C.rack);
        B.add('inside', cyl((r0 + r1) / 2, 2.58, side * (lin - 0.03), 0.016, r1 - r0 - 0.2, 'u', 6), C.rack);
        for (let k = 0; k <= Q.nBay; k++) {
          const u = Q.bayU0 + k * Q.bay;
          if (u < r0 + 0.1 || u > r1 - 0.1) continue;
          B.add('inside', tube([u, 2.58, side * (lin - 0.02)], [u, 2.66, rw], 0.014, 5), C.rack);
          B.add('inside', tube([u, 2.94, side * (lin - 0.02)], [u, 2.66, rw], 0.011, 5), C.rack);
        }
        B.add('glass', new THREE.PlaneGeometry(lin - 0.90, r1 - r0 - 0.2).rotateX(-Math.PI / 2).translate(side * (lin + 0.88) / 2, 2.65, -(r0 + r1) / 2));
      }
    }
  }

  // ---- Vestibule luggage rack & trash bin (R1 & R3)
  if (kind === 'coachR1' || kind === 'coachR3') {
    const swLug = kind === 'coachR1' ? -1 : 1, uLug = kind === 'coachR1' ? 8.52 : -8.52;
    const swBin = -swLug, uBin = kind === 'coachR1' ? 8.55 : -8.55;
    for (const ySh of [F0 + 0.06, F0 + 0.82, F0 + 1.54]) B.add('inside', cbox(uLug, ySh, swLug * 1.05, 0.56, 0.04, 0.52, 0.008), C.steel);
    for (const du of [-0.26, 0.26]) for (const dw2 of [0.80, 1.30]) B.add('inside', tube([uLug + du, F0, swLug * dw2], [uLug + du, F0 + 2.05, swLug * dw2], 0.016, 5), C.steel);
    B.add('inside', cbox(uLug - 0.04, F0 + 0.30, swLug * 1.04, 0.40, 0.42, 0.26, 0.03), C.slate);
    B.add('inside', cbox(uLug + 0.02, F0 + 1.06, swLug * 1.02, 0.42, 0.38, 0.28, 0.03), C.rust);
    B.add('inside', cbox(uBin, F0 + 0.45, swBin * 1.11, 0.38, 0.90, 0.40, 0.02), C.pedestal);
    B.add('inside', cbox(uBin, F0 + 0.91, swBin * 1.11, 0.36, 0.03, 0.38, 0.01), C.rack);
  }

  // ---- R1 & R3 contoured seats & tables
  if (Q.seats.length) {
    const prof = new THREE.Shape();
    prof.moveTo(0.0, 0.38); prof.lineTo(0.46, 0.39); prof.quadraticCurveTo(0.51, 0.41, 0.48, 0.48); prof.lineTo(0.12, 0.51);
    prof.lineTo(0.09, 0.58); prof.lineTo(0.02, 1.12); prof.quadraticCurveTo(0.01, 1.24, -0.07, 1.23); prof.lineTo(-0.10, 1.16);
    prof.lineTo(-0.06, 0.48); prof.lineTo(0.0, 0.38);
    const sCol = kind === 'coachR1' ? C.seatR1 : C.seatR3;
    const hCol = kind === 'coachR1' ? C.headR1 : C.headR3;
    for (const st of Q.seats) {
      const sw = st.width || 0.40;
      const g = extr(prof, sw, 0, 2); g.translate(0, 0, -sw / 2);
      g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, F1, -st.u);
      B.add('inside', g, sCol);
      B.add('inside', cbox(st.u + st.dir * 0.05, F1 + 1.04, st.w, 0.04, 0.18, sw * 0.72, 0.012), hCol);
      if (st.arm) B.add('inside', cbox(st.u + st.dir * 0.24, F1 + 0.62, st.w + st.arm * (sw / 2 + 0.02), 0.38, 0.045, 0.045, 0.01), C.pedestal);
      if (st.tablette) B.add('inside', cbox(st.u - st.dir * 0.09, F1 + 0.72, st.w, 0.025, 0.24, sw * 0.78, 0.005), C.tablette);
    }
    // Seat pedestals along window side
    for (const st of Q.seats) if (Math.abs(st.w) > 0.90) B.add('inside', cbox(st.u + st.dir * 0.20, F1 + 0.18, st.w - Math.sign(st.w) * 0.16, 0.24, 0.36, 0.56, 0.02), C.pedestal);
    // Bay tables (+ warm R1 table lamps)
    for (const tb of Q.tables) {
      const tw = tb.w1 - tb.w0, wc = (tb.w0 + tb.w1) / 2;
      B.add('inside', cbox(tb.u, tb.y, wc, tb.len, 0.04, tw, 0.01), kind === 'coachR1' ? C.wood : C.lining);
      B.add('inside', tube([tb.u, F1, wc], [tb.u, tb.y - 0.02, wc], 0.032, 6), C.pedestal);
      if (tb.lamp) {
        B.add('inside', tube([tb.u, tb.y + 0.02, tb.lamp], [tb.u, tb.y + 0.24, tb.lamp], 0.012, 6), C.brass);
        B.add('panel', uvRect(cyl(tb.u, tb.y + 0.28, tb.lamp, 0.065, 0.10, 'y', 8, 0.045), PANEL.lampBar));
      }
    }
  }

  // ---- R2 Voiture Bar realistic interior (galley counter, espresso machine, vitrine, menu, mange-debout, bistro lounge)
  if (kind === 'coachR2') {
    const { u0: bu0, u1: bu1, mangeU, loungeU } = Q.bar, bLen = bu1 - bu0, bMid = (bu0 + bu1) / 2;
    // Back-bar cabinetry (-w)
    B.add('inside', cbox(bMid + 0.1, F1 + 0.48, -1.18, bLen - 0.2, 0.96, 0.28, 0.015), C.barWood);
    B.add('inside', cbox(bMid + 0.1, F1 + 1.82, -1.21, bLen - 0.2, 0.42, 0.22, 0.015), C.barWood);
    // Under-cabinet amber glow strip
    B.add('panel', uvRect(onSide(plane(bLen - 0.6, 0.05), -1.12, 1).translate(0, F1 + 1.60, -bMid - 0.1), PANEL.barSign));
    // Chilled drinks vitrine (u 2.20..4.20)
    B.add('inside', cbox(3.20, F1 + 1.32, -1.22, 2.04, 0.80, 0.18, 0.015), C.barFront);
    B.add('panel', uvRect(onSide(plane(1.92, 0.72), -1.12, 1).translate(0, F1 + 1.32, -3.20), PANEL.vitrine));
    // Espresso machine (u 5.60) & Bistro Menu Board above
    B.add('inside', cbox(5.60, F1 + 1.18, -1.16, 0.74, 0.42, 0.30, 0.02), C.barChrome);
    B.add('inside', cbox(5.60, F1 + 1.24, -1.03, 0.66, 0.16, 0.06, 0.01), C.barFront);
    B.add('panel', uvRect(onSide(plane(1.20, 0.44), -1.09, 1).translate(0, F1 + 1.72, -5.60), PANEL.screenBar));

    // Front bar counter (w in [-0.74, -0.48], overhanging top to -0.44)
    B.add('inside', cbox(bMid, F1 + 0.52, -0.61, bLen, 1.04, 0.26, 0.02), C.barFront);
    B.add('inside', cbox(bMid, F1 + 1.06, -0.59, bLen + 0.04, 0.05, 0.32, 0.01), C.barChrome);
    B.add('inside', cbox(bMid, F1 + 0.96, -0.47, bLen, 0.06, 0.03, 0.005), C.barCarmine);
    B.add('inside', cyl(bMid, F1 + 0.16, -0.40, 0.018, bLen - 0.2, 'u', 6), C.barChrome); // footrail
    B.add('glass', cbox(2.40, F1 + 1.24, -0.52, 2.40, 0.30, 0.015, 0.003)); // sneeze guard
    B.add('inside', cbox(0.55, F1 + 1.18, -0.58, 0.32, 0.20, 0.24, 0.015), C.pedestal); // POS till

    // 3 wall-mounted mange-debout high tables + stools on +w
    for (const ut of mangeU) {
      B.add('inside', cbox(ut, F1 + 1.00, 1.09, 1.30, 0.05, 0.46, 0.015), C.barWood);
      B.add('inside', tube([ut, F1, 1.06], [ut, F1 + 0.98, 1.06], 0.035, 6), C.barChrome);
      B.add('panel', uvRect(cyl(ut, F1 + 1.26, 1.20, 0.06, 0.09, 'y', 8, 0.045), PANEL.lampBar));
      for (const du of [-0.46, 0.46]) {
        B.add('inside', cyl(ut + du, F1 + 0.35, 0.96, 0.024, 0.70, 'y', 6), C.barChrome);
        B.add('inside', cyl(ut + du, F1 + 0.72, 0.96, 0.16, 0.07, 'y', 8), C.barCarmine);
      }
    }
    // 2 Bistro Lounge bays (both sides, u = -6.30, -3.70)
    for (const ub of loungeU) {
      for (const sd of [-1, 1]) {
        B.add('inside', cbox(ub, F1 + 0.98, sd * 1.00, 1.24, 0.05, 0.56, 0.015), C.barWood);
        B.add('inside', tube([ub, F1, sd * 0.98], [ub, F1 + 0.96, sd * 0.98], 0.036, 6), C.barChrome);
        for (const du of [-0.48, 0.48]) {
          B.add('inside', cyl(ub + du, F1 + 0.35, sd * 0.86, 0.024, 0.70, 'y', 6), C.barChrome);
          B.add('inside', cyl(ub + du, F1 + 0.72, sd * 0.86, 0.16, 0.07, 'y', 8), C.barCarmine);
        }
      }
    }
  }

  // ---- interior glass partitions (at F1 = 1.08 m, doorway 1.05 m wide x 1.94 m tall)
  for (const u0 of Q.parts) {
    const pd = W.partitionDoor / 2, dir = u0 > 0 ? 1 : -1;
    addWallWithDoor(B, u0, dir, lin, F1, ceil, pd, F1 + 1.94, C.partition, [F1 + 0.92, F1 + 1.78, lin]);
    const scr = kind === 'coachR1' ? PANEL.screenR1 : kind === 'coachR2' ? PANEL.screenBar : PANEL.screenR3;
    for (const face of [-1, 1]) B.add('panel', uvRect(onEnd(plane(0.62, 0.10).translate(0, F1 + 2.01, 0), u0 - face * 0.035, -face), scr));
  }

  // ---- LED cove strips (segments along ceil - 0.005, deterministic faulty flicker)
  {
    const lo = uIn0 + 0.55, hi = uIn1 - 0.55;
    for (const side of [-1, 1]) {
      let k = 0;
      for (let u = lo + 0.5; u < hi; u += 1.2, k++) {
        const dead = hash(k, side + (kind === 'coachR2' ? 7 : 0), 4) > 0.88, flick = !dead && hash(k, side, 5) > 0.90;
        const g = new THREE.PlaneGeometry(0.05, 0.95); g.rotateX(Math.PI / 2); g.rotateZ(-side * 0.30); g.translate(side * 1.06, ceil - 0.006, -u);
        if (dead) B.add('panel', uvRect(g, PANEL.dead)); else B.add(flick ? 'flicker' : 'panel', uvRect(g, PANEL.led));
      }
    }
  }

  // ---- blood decals inside passenger coaches (aisle & vestibule grime/conflict)
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  {
    const c = Q.legroom[Math.min(1, Q.legroom.length - 1)].u;
    B.add('decal', quarter(new THREE.PlaneGeometry(0.75, 1.35).rotateX(-Math.PI / 2).translate(0.04, F1 + 0.006, -c), 1, 0));
    B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.45, 0.55).translate(sx(-1, c + 0.6), 1.48, 0), lin - 0.006, -1), 0, 0));
    if (Q.parts.length) {
      const pu = Q.parts[0];
      B.add('decal', quarter(new THREE.PlaneGeometry(0.55, 0.85).rotateX(-Math.PI / 2).translate(-0.18, F1 + 0.006, -pu * 0.92), 1, 1));
    }
  }
  return B.merge();
}

// door leaf (Carmillon plug door) : X across, Y up, Z along
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floor, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.08);
  s.holes.push(rrect(-0.28, F + 0.95, 0.28, F + 1.78, 0.07, true));
  const g = extr(s, 0.05, 0.008, 3); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  { const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = ATLAS.door; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, 1 - (r0 + (1 - (p.getY(i) - F) / T.doorH) * (r1 - r0)) / 1024); }
  B.add('body', g);
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.28, F + 0.95, 0.28, F + 1.78, 0.07), 3), 0, 1));
  const out = B.merge();
  return { leaf: out.body, glass: out.glass };
}

// ------------------------------------------------------------------ lamps (twin cheek headlights + 3rd top marker, proud of bezel faces)
export function buildLampGeometry() {
  const B = buckets();
  for (const sw of [-1, 1]) {
    const main = new THREE.ShapeGeometry(rrect(-0.11, -0.06, 0.11, 0.06, 0.025), 3);
    main.rotateY(Math.PI - sw * 0.34); main.translate(sw * 0.50, 0.98, -9.285);
    B.add('lamp', main);
    const mark = new THREE.ShapeGeometry(rrect(-0.045, -0.038, 0.045, 0.038, 0.015), 2);
    mark.rotateY(Math.PI - sw * 0.34); mark.translate(sw * 0.37, 0.98, -9.33);
    B.add('lamp', mark);
  }
  const topM = new THREE.CircleGeometry(0.06, 10);
  topM.rotateY(Math.PI); topM.rotateX(-0.45); topM.translate(0, 3.49, -5.75);
  B.add('lamp', topM);
  return B.merge().lamp;
}

// ------------------------------------------------------------------ motrice cab interior (dimly visible behind 0.82 opacity windscreen)
export function buildCabGeometry() {
  const T = CONFIG.train, F1 = T.floorHigh, lin = T.walk.wall + 0.01, B = buckets();
  B.add('inside', new THREE.PlaneGeometry(2 * lin, 3.1).rotateX(-Math.PI / 2).translate(0, F1, -5.70), C.floorR3);
  B.add('inside', cbox(6.55, F1 + 0.46, 0, 0.78, 0.86, 1.75, 0.04), C.pedestal); // wrap-around desk
  B.add('panel', uvRect(onEnd(plane(0.95, 0.24).rotateX(-0.55).translate(0, F1 + 0.94, 0), 6.45, -1), PANEL.cab)); // TVM-430 / ETCS
  B.add('inside', cbox(5.65, F1 + 0.26, 0, 0.48, 0.52, 0.48, 0.04), C.seatR3);
  B.add('inside', cbox(5.40, F1 + 0.76, 0, 0.08, 0.58, 0.44, 0.03), C.seatR3);
  return B.merge();
}

// ------------------------------------------------------------------ TGV Faiveley pantographs (25 kV AC raised / 1.5 kV DC lowered)
export function buildPantograph(up) {
  const B = buckets(), yBase = 3.96, wire = CONFIG.railNet.wire.contact, u = 0;
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
