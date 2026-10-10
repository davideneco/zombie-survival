import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildTracks, buildJunction } from './tramTrack.js';
import { mergeParts } from './ironArmor.js';

// =====================================================================
//  Réseau de tram (v0.38.0) : voies, quais, heurtoirs, feux des portes, caténaire. Aucune rame ici (voir tram.js).
//  Deux temps, comme l'Homme de Fer :
//    planTram        : géométrie pure des voies (CONFIG.tram.lines) ; sert avant même que la scène existe (distance d'un point au rail :
//                      le décor, les arbres et les lampadaires évitent les voies)
//    buildTramNetwork: maillages (4 appels de rendu en tout), collisions des poteaux, portes-feux
//  Rendu : rails en un InstancedMesh (un élément de 2 m : deux rails, le lit et une traverse), quais + heurtoirs + mâts de feux en un maillage
//  fusionné, poteaux de caténaire en un InstancedMesh, fils + lampes des feux en un maillage (matériau sans éclairage, couleurs de sommets :
//  un feu change de couleur en réécrivant ses sommets). Rien ne projette d'ombre.
//  Décor 100 % déterministe : aucun Math.random.
// =====================================================================

const EL = 2; // longueur d'un élément de voie (m)

export function planTram() {
  const net = buildTracks(CONFIG.tram);
  // aiguillages (v0.41.0) : raccords en arc au croisement de deux lignes ; les itinéraires complets (ligne, arc, ligne) sont des voies pour la rame (voir Tram)
  net.junction = CONFIG.tram.junction ? buildJunction(CONFIG.tram.junction, net.byId, CONFIG.tram.step ?? 1) : null;
  net.connectors = net.junction ? net.junction.connectors : [];
  const lineDist = net.dist, tmpD = {};
  net.dist = (x, z, max = 40) => { let m = lineDist(x, z, max); for (const c of net.connectors) { const d = c.project(x, z, max, tmpD).d; if (d < m) m = d; } return m; }; // décor, arbres, lampadaires évitent aussi les raccords
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) { // contrôle de cohérence des tracés (mode ?debug)
    for (const t of net.tracks) {
      for (const w of t.warnings) console.warn('[tram]', w);
      const r = t.minRadius(0, t.L);
      if (r < CONFIG.tram.minRadius - 0.5) console.warn(`[tram] ${t.id} : rayon de courbure ${r.toFixed(1)} m < ${CONFIG.tram.minRadius} m`);
    }
  }
  for (const c of net.connectors) {
    const r = c.minRadius(2, c.L - 2);
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug') && r < CONFIG.tram.minRadius - 0.5) console.warn(`[tram] raccord ${c.id} : rayon de courbure ${r.toFixed(1)} m < ${CONFIG.tram.minRadius} m`);
  }
  for (const t of net.tracks) {
    t.stops = (t.def.stops || []).map((st) => ({ ...st, line: t.id, s: t.project(st.at[0], st.at[1], 80, {}).s }));
    t.stops.sort((a, b) => a.s - b.s);
  }
  return net;
}

// ------------------------------------------------------------------ petits outils géométriques
const colorize = (g, hex) => {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
// boîte w (x) h (y) d (z) centrée en (x, y, z), tournée de ry autour de y
const boxAt = (w, h, d, x, y, z, color, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return colorize(g, color); };
const cylAt = (r0, r1, h, x, y, z, color, seg = 8) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y, z); return colorize(g, color); };

let MAT = null;
const mats = () => MAT || (MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6 }),
  basic: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
});

// Ruban fin (deux quads croisés) de a à b : fils de la caténaire
function ribbon(out, a, b, w, col) {
  const c = new THREE.Color(col), push = (p, q) => { out.pos.push(...p); out.col.push(c.r, c.g, c.b); out.pos.push(...q); out.col.push(c.r, c.g, c.b); };
  const i0 = out.pos.length / 3;
  push([a[0], a[1] + w, a[2]], [b[0], b[1] + w, b[2]]);
  push([a[0], a[1] - w, a[2]], [b[0], b[1] - w, b[2]]);
  const nx = -(b[2] - a[2]), nz = b[0] - a[0], l = Math.hypot(nx, nz) || 1, ox = (nx / l) * w, oz = (nz / l) * w;
  push([a[0] + ox, a[1], a[2] + oz], [b[0] + ox, b[1], b[2] + oz]);
  push([a[0] - ox, a[1], a[2] - oz], [b[0] - ox, b[1], b[2] - oz]);
  out.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2, i0 + 4, i0 + 5, i0 + 7, i0 + 4, i0 + 7, i0 + 6, i0, i0 + 1, i0 + 3, i0 + 1, i0, i0 + 2);
}

// ------------------------------------------------------------------ construction
// ctx : { scene, collision, lightSources, net (planTram), doors, hdfCenter: { x, z, R } | null, used [[x, z]...] (objets déjà posés : la sous-station les évite) }
export function buildTramNetwork(ctx) {
  const { scene, collision, lightSources, net, doors } = ctx;
  const T = CONFIG.tram, M = mats(), o = {}, o2 = {};
  const info = { net, tracks: net.tracks, stops: [], buffers: [], gates: [], poles: 0, rails: 0, meshes: [] };
  const add = (m, name) => { m.name = 'tram:' + name; m.frustumCulled = false; m.castShadow = false; scene.add(m); info.meshes.push(m); return m; };

  // ---------------------------------------------------------------- rails : un InstancedMesh, éléments de 2 m
  {
    const G = T.rail.gauge, rails = [];
    rails.push(boxAt(EL, 0.03, T.rail.bed, 0, 0.015, 0, 0x303133));                  // lit
    for (const sgn of [-1, 1]) rails.push(boxAt(EL, 0.13, 0.07, 0, 0.095, sgn * G / 2, 0xaab2ba)); // rails
    rails.push(boxAt(0.26, 0.07, 2.5, 0, 0.065, 0, 0x5d5c57));                          // traverse
    const geo = mergeParts(rails);
    const list = [];
    for (const t of net.tracks) for (let s = 0; s + 1e-6 < t.L; s += EL) list.push([t, s]);
    for (const t of net.connectors) for (let s = 0; s + 1e-6 < t.L; s += EL) list.push([t, s, 0.012]); // raccords : un peu plus hauts que les voies qu'ils rejoignent (pas de scintillement)
    const mesh = new THREE.InstancedMesh(geo, M.steel, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), sc = new THREE.Vector3();
    list.forEach(([t, s, dy = 0], k) => {
      const e = Math.min(t.L, s + EL);
      t.at(s, o); t.at(e, o2);
      const dx = o2.x - o.x, dz = o2.z - o.z, l = Math.hypot(dx, dz) || 1;
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      p.set((o.x + o2.x) / 2, dy, (o.z + o2.z) / 2);
      m4.compose(p, q, sc.set(l / EL, 1, 1));
      mesh.setMatrixAt(k, m4);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true;
    add(mesh, 'rails');
    info.rails = list.length;
  }

  // ---------------------------------------------------------------- quais, heurtoirs, mâts de feux : un maillage fusionné
  const fixed = [];
  const lateralFree = (x, z, dx, dz) => collision.rayHit(x, 1, z, dx, 0, dz, 3.4);
  for (const t of net.tracks) {
    // quais : une dalle de chaque côté, aussi large que la rue le permet
    for (const st of t.stops) {
      const half = st.len / 2, tr = {};
      t.at(st.s, tr);
      const free = { 1: 3.4, '-1': 3.4 };
      for (let q = -half; q <= half; q += 3) {
        t.at(st.s + q, o);
        for (const sgn of [1, -1]) free[sgn] = Math.min(free[sgn], lateralFree(o.x, o.z, -o.tz * sgn, o.tx * sgn));
      }
      const ang = Math.atan2(-tr.tz, tr.tx), halfW = 2.4 / 2 + 0.25, rec = { name: st.name, line: t.id, s: st.s, len: st.len, x: tr.x, z: tr.z, w: {} };
      for (const sgn of [1, -1]) {
        const w = Math.min(T.platform.width, free[sgn] - halfW - 0.2);
        if (w < T.platform.minWidth) continue;
        const lat = halfW + w / 2, nx = -tr.tz * sgn, nz = tr.tx * sgn;
        fixed.push(boxAt(st.len + 2, T.platform.height, w, tr.x + nx * lat, T.platform.height / 2, tr.z + nz * lat, 0xa9a8a0, ang));              // dalle
        fixed.push(boxAt(st.len + 2, T.platform.height + 0.012, T.platform.edge, tr.x + nx * (halfW + T.platform.edge / 2), (T.platform.height + 0.012) / 2, tr.z + nz * (halfW + T.platform.edge / 2), 0xc9a93a, ang)); // bande jaune
        // poteau d'arrêt (plaque de la couleur de la ligne), banc
        const sp = [tr.x + tr.tx * (half - 3) + nx * (lat + w / 2 - 0.3), tr.z + tr.tz * (half - 3) + nz * (lat + w / 2 - 0.3)];
        fixed.push(cylAt(0.04, 0.04, 2.7, sp[0], 1.35, sp[1], 0x4e565e, 6));
        fixed.push(boxAt(0.5, 0.5, 0.05, sp[0], 2.5, sp[1], new THREE.Color(T.lines.find((l) => l.id === t.id).color).getHex(), ang));
        const bp = [tr.x + nx * (lat + w / 2 - 0.35), tr.z + nz * (lat + w / 2 - 0.35)];
        if (w > 1.3) {
          fixed.push(boxAt(1.8, 0.06, 0.4, bp[0], 0.46, bp[1], 0x7a5a38, ang));
          for (const k of [-1, 1]) fixed.push(boxAt(0.06, 0.4, 0.34, bp[0] + tr.tx * k * 0.7, 0.24, bp[1] + tr.tz * k * 0.7, 0x4e565e, ang));
        }
        rec.w[sgn] = { w, lat };
      }
      info.stops.push(rec);
    }
    // heurtoirs aux deux bouts de la ligne : poutre à bandes rouges et blanches sur deux montants, bloc de caoutchouc
    for (const end of [0, 1]) {
      const s = end ? t.L : 0;
      t.at(s, o);
      const dir = end ? 1 : -1, ang = Math.atan2(-o.tz, o.tx), bx = o.x + o.tx * dir * 0.3, bz = o.z + o.tz * dir * 0.3, px = -o.tz, pz = o.tx;
      for (const sgn of [-1, 1]) fixed.push(boxAt(0.22, 0.95, 0.22, bx + px * sgn * 0.85, 0.5, bz + pz * sgn * 0.85, 0x3c3f44, ang));
      fixed.push(boxAt(0.34, 0.26, 2.2, bx, 0.82, bz, 0xe9e9e4, ang));
      for (const k of [-0.7, 0, 0.7]) fixed.push(boxAt(0.36, 0.27, 0.34, bx, 0.82, bz + 0, 0xcf2a22, ang).translate(px * k, 0, pz * k));
      fixed.push(boxAt(0.5, 0.35, 0.8, bx - o.tx * dir * 0.35, 0.3, bz - o.tz * dir * 0.35, 0x151618, ang));
      collision.addBox(bx, bz, 0.5, 2.0, Math.atan2(o.tz, o.tx), 1.2); // le heurtoir est un objet : il bloque
      info.buffers.push({ line: t.id, end, s, x: o.x, z: o.z });
    }
  }

  // ---------------------------------------------------------------- feux rouges des portes de zone qui coupent une voie
  const wires = { pos: [], col: [], idx: [] }, lamps = [];
  const segInt = (p, q, a, b) => { const rx = q[0] - p[0], rz = q[1] - p[1], sx = b[0] - a[0], sz = b[1] - a[1], d = rx * sz - rz * sx; if (Math.abs(d) < 1e-9) return null; const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / d, u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; };
  const lampBox = (x, y, z, hex, size = 0.34) => { // petit cube sans éclairage (sommets colorés) : renvoie l'indice du premier sommet
    const g = new THREE.BoxGeometry(size, size, size).toNonIndexed(), i0 = wires.pos.length / 3, c = new THREE.Color(hex);
    for (let i = 0; i < g.attributes.position.count; i++) { wires.pos.push(g.attributes.position.getX(i) + x, g.attributes.position.getY(i) + y, g.attributes.position.getZ(i) + z); wires.col.push(c.r, c.g, c.b); }
    for (let i = 0; i < g.attributes.position.count; i += 3) wires.idx.push(i0 + i, i0 + i + 1, i0 + i + 2);
    return { v0: i0, n: g.attributes.position.count };
  };
  for (const t of net.tracks) {
    let prev = null;
    const found = [];
    for (let s = 0; s <= t.L; s += 1) {
      t.at(s, o); const cur = [o.x, o.z];
      if (prev) for (const d of doors || []) for (const sg of d.segs) { const f = segInt(prev, cur, [sg.ax, sg.az], [sg.bx, sg.bz]); if (f != null) found.push({ s: s - 1 + f, d }); }
      prev = cur;
    }
    for (const d of new Set(found.map((f) => f.d))) {
      const ss = found.filter((f) => f.d === d).map((f) => f.s);
      const sg = ss.reduce((a, b) => a + b, 0) / ss.length;
      const gate = { line: t.id, s: sg, door: d, lamps: [] };
      // un mât de chaque côté de la porte, à droite du sens de marche qui l'approche (feu visible de loin)
      for (const dir of [-1, 1]) {
        const sm = sg + dir * (T.gate.signalDist - 1), rs = dir < 0 ? 1 : -1; // une rame qui vient du côté `dir` roule vers la porte : le mât est à sa droite
        t.at(sm, o);
        const nx = -o.tz * rs, nz = o.tx * rs, x = o.x + nx * 2.7, z = o.z + nz * 2.7;
        fixed.push(cylAt(0.05, 0.06, 3.3, x, 1.65, z, 0x3a3d42, 6));
        fixed.push(boxAt(0.5, 0.95, 0.22, x, 3.0, z, 0x1b1d20, Math.atan2(-o.tz, o.tx)));
        gate.lamps.push(lampBox(x, 3.25, z, 0xff2a1a), lampBox(x, 2.8, z, 0x0a2a0f));
        lightSources.push({ x, y: 3.3, z, color: T.gate.lamp, intensity: 7, dist: 10, door: d });
      }
      gate.state = null;
      info.gates.push(gate);
    }
  }
  info.gates.sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : a.s - b.s));
  // portes de zone vues des itinéraires des aiguillages : la même porte, à l'abscisse de l'itinéraire (les itinéraires suivent les lignes hors des raccords)
  info.routeGates = {};
  if (net.junction) for (const r of net.junction.routes) {
    const list = [];
    for (const g of info.gates) { net.byId[g.line].at(g.s, o); const p = r.track.project(o.x, o.z, 3, o2); if (p.d < 0.8) list.push({ s: p.s, door: g.door, line: g.line, lamps: g.lamps }); }
    info.routeGates[r.id] = list;
  }

  // ---------------------------------------------------------------- sous-station (v0.39.0) : kiosque près du quai de la rame conduisible, voyant rouge puis vert
  {
    const cl = net.byId[T.car.start.line], st = cl.stops.find((q) => q.name === T.car.start.stop) || cl.stops[0], used = ctx.used || [];
    let spot = null;
    for (const so of [0, -9, 9, -16, 16, -23, 23]) {
      if (spot) break;
      cl.at(st.s + so, o);
      for (const sgn of [1, -1]) {
        const x = o.x - o.tz * sgn * 6.4, z = o.z + o.tx * sgn * 6.4;
        let ok = net.dist(x, z, 12) >= 5.5 && used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > 3.5);
        for (let a = 0; ok && a < 8; a++) ok = collision.rayHit(x, 1, z, Math.cos(a * Math.PI / 4), 0, Math.sin(a * Math.PI / 4), 1.8) >= 1.8;
        if (ok) { spot = { x, z, tx: o.tx, tz: o.tz, sgn }; break; }
      }
    }
    if (spot) {
      const ang = Math.atan2(-spot.tz, spot.tx), nx = -spot.tz * -spot.sgn, nz = spot.tx * -spot.sgn; // la face avant regarde la voie
      const at = (w, h, d, x, y, zz, col) => fixed.push(boxAt(w, h, d, spot.x + spot.tx * x + nx * zz, y, spot.z + spot.tz * x + nz * zz, col, ang));
      at(1.7, 2.1, 1.1, 0, 1.05, 0, 0x6b7076);          // armoire
      at(1.9, 0.12, 1.3, 0, 2.16, 0, 0x4a4f55);         // toit
      at(0.7, 1.5, 0.05, -0.3, 1.0, 0.56, 0x3a3f45);    // porte
      at(0.7, 0.12, 0.06, -0.3, 0.3, 0.58, 0xe3b72e);   // bande de danger
      at(0.55, 0.55, 0.04, 0.5, 1.5, 0.56, 0xe8c04a);   // panneau « éclair »
      at(0.18, 0.3, 0.05, 0.5, 1.5, 0.585, 0x14161a);
      fixed.push(cylAt(0.05, 0.05, 1.4, spot.x + spot.tx * 0.7 + nx * 0.35, 2.9, spot.z + spot.tz * 0.7 + nz * 0.35, 0x3a3f45, 6)); // mât du voyant
      const lamp = lampBox(spot.x + spot.tx * 0.7 + nx * 0.35, 3.7, spot.z + spot.tz * 0.7 + nz * 0.35, 0xff2a1a);
      collision.addBox(spot.x, spot.z, 1.7, 1.1, Math.atan2(spot.tz, spot.tx), 2.2); // le kiosque est un objet : il bloque
      lightSources.push({ x: spot.x + nx * 1.4, y: 3.2, z: spot.z + nz * 1.4, color: 0xffd080, intensity: 8, dist: 9 });
      info.substation = { x: spot.x, z: spot.z, lamp };
      used.push([spot.x, spot.z]);
    }
  }

  // ---------------------------------------------------------------- signaux d'aiguillage (v0.41.0) : un mât par bras, vu par la rame qui arrive
  // Tête noire à trois feux : un feu ambre fixe (en bas), un feu blanc « tout droit » (en haut au centre) et un feu blanc « dévié » (en haut, du côté du virage).
  // Les quatre mâts affichent le réglage courant (info.setSwitch) : tout droit ou dévié.
  const jn = net.junction;
  info.junction = jn; info.signals = [];
  info.trackById = { ...net.byId, ...(jn ? jn.byId : {}) }; // lignes et itinéraires des aiguillages, par identifiant (voir Tram.adoptTrack)
  if (jn) {
    const J = T.junction, armIds = Object.keys(J.arms);
    for (const id of armIds) {
      const arm = J.arms[id], t = net.byId[arm.line], dirIn = arm.end === 0 ? 1 : -1; // sens de marche d'une rame qui vient de ce bras
      const turn = jn.routes.find((r) => r.from === id || r.to === id);
      if (!turn) continue;
      const theta = turn.meta.theta * (turn.from === id ? 1 : -1), side = Math.sign(theta) || 1; // + : virage à droite pour la rame qui arrive de ce bras
      const sNode = jn.sNode[arm.line], T0 = turn.meta.T;
      // le mât est à gauche de la voie si le raccord part à droite (côté extérieur), 2,9 m de l'axe, à T + 3 m du nœud (juste avant la divergence), en évitant les poteaux de caténaire
      let sm = sNode - dirIn * (T0 + 3), best = null;
      for (const ds of [0, -2, 2, -4, 4, -6, 6]) {
        const ss = sm + dirIn * ds; t.at(ss, o);
        const sd = -side, x = o.x + -o.tz * sd * 3.4, z = o.z + o.tx * sd * 3.4;
        let ok = collision.rayHit(x, 1, z, 1, 0, 0, 0.6) >= 0.6 && collision.rayHit(x, 1, z, -1, 0, 0, 0.6) >= 0.6 && collision.rayHit(x, 1, z, 0, 0, 1, 0.6) >= 0.6 && collision.rayHit(x, 1, z, 0, 0, -1, 0.6) >= 0.6;
        ok = ok && net.dist(x, z, 4) >= 3.2 && (ctx.used || []).every(([ux, uz]) => Math.hypot(ux - x, uz - z) > 1.2);
        if (ok) { best = { x, z, tx: o.tx * dirIn, tz: o.tz * dirIn, sd }; break; }
      }
      if (!best) continue;
      const { x, z, tx, tz, sd } = best, ang = Math.atan2(-tz, tx), rx = -tz, rz = tx; // (rx, rz) : à droite de la marche
      fixed.push(cylAt(0.05, 0.06, 2.6, x, 1.3, z, 0x3a3d42, 6));
      fixed.push(boxAt(0.18, 1.2, 1.0, x - tx * 0.12, 3.1, z - tz * 0.12, 0x1b1d20, ang)); // tête, tournée vers la rame qui arrive
      const lamp = (right, y, hex) => lampBox(x - tx * 0.22 + rx * right, y, z - tz * 0.22 + rz * right, hex, 0.28);
      const rec = { arm: id, side, x, z, tx, tz, ref: lamp(0, 2.78, 0xffb030), straight: lamp(0, 3.42, 0x15181c), diverge: lamp(0.34 * side, 3.42, 0x15181c) };
      info.signals.push(rec);
      collision.addCircle(x, z, 0.1, 3.4).tram = true;
      if (ctx.used) ctx.used.push([x, z]);
    }
  }

  // ---------------------------------------------------------------- caténaire : poteaux (InstancedMesh) et fils
  {
    const P = T.pole, arm = P.offset;
    const parts = [cylAt(0.08, 0.11, P.height, 0, P.height / 2, 0, 0x4a4f55, 8), boxAt(arm, 0.12, 0.12, arm / 2, P.height - 0.3, 0, 0x4a4f55), boxAt(0.1, 0.26, 0.1, arm, P.height - 0.45, 0, 0xc8c2b0)];
    parts.push(boxAt(0.6, 0.06, 0.06, arm * 0.3, P.height - 0.62, 0, 0x4a4f55)); // jambe de force
    const geo = mergeParts(parts);
    const spots = [];
    const ring = ctx.hdfCenter;
    for (const t of net.tracks) {
      let k = 0;
      for (let s = P.every / 2; s < t.L - 4; s += P.every, k++) {
        t.at(s, o);
        const side = k % 2 ? 1 : -1, nx = -o.tz * side, nz = o.tx * side, x = o.x + nx * P.offset, z = o.z + nz * P.offset;
        if (ring && Math.hypot(x - ring.x, z - ring.z) < ring.R + 1) continue; // sous la verrière de la rotonde : pas de poteau
        let near = Infinity;
        for (const u of [...net.tracks, ...net.connectors]) if (u !== t) near = Math.min(near, u.project(x, z, 12, o2).d);
        if (near < 3.4) continue; // dans l'emprise de l'autre voie
        spots.push({ x, z, s, t });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, M.steel, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach((sp, i) => {
      // le bras (+x du modèle) pointe vers l'axe de la voie
      sp.t.at(sp.s, o);
      q.setFromAxisAngle(up, Math.atan2(-(o.z - sp.z), o.x - sp.x));
      m4.compose(v.set(sp.x, 0, sp.z), q, one);
      mesh.setMatrixAt(i, m4);
      collision.addCircle(sp.x, sp.z, 0.12, P.height).tram = true; // le poteau est solide, mais la grille de navigation l'ignore (voir realworld.js)
    });
    mesh.instanceMatrix.needsUpdate = true;
    add(mesh, 'poles');
    info.poles = spots.length;
    // fils : un ruban tous les 6 m le long de chaque voie (et de chaque raccord)
    for (const t of [...net.tracks, ...net.connectors]) {
      let a = null;
      for (let s = 0; s <= t.L + 1e-6; s += 6) {
        t.at(Math.min(s, t.L), o);
        const p = [o.x, P.wire, o.z];
        if (a) ribbon(wires, a, p, 0.025, 0x23272d);
        a = p;
      }
    }
  }

  // maillage des quais / heurtoirs / mâts
  add(new THREE.Mesh(mergeParts(fixed), M.steel), 'platforms').receiveShadow = true;

  // fils + lampes : un seul maillage (matériau sans éclairage)
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires.pos, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wires.col, 3));
  wg.setIndex(wires.idx);
  const wmesh = add(new THREE.Mesh(wg, M.basic), 'wires');
  info.wireMesh = wmesh;

  // ---------------------------------------------------------------- mises à jour : feux selon l'état des portes
  const setLamp = (l, hex) => { const c = new THREE.Color(hex), a = wg.attributes.color; for (let i = 0; i < l.n; i++) a.setXYZ(l.v0 + i, c.r, c.g, c.b); a.needsUpdate = true; };
  let acc = 0;
  info.update = (dt, force = false) => {
    acc -= dt;
    if (acc > 0 && !force) return;
    acc = 0.25;
    for (const g of info.gates) {
      const open = !!g.door.open;
      if (g.state === open) continue;
      g.state = open;
      for (let i = 0; i < g.lamps.length; i += 2) { setLamp(g.lamps[i], open ? 0x2a0a08 : 0xff2a1a); setLamp(g.lamps[i + 1], open ? 0x30ff60 : 0x0a2a0f); }
    }
  };
  info.update(0, true);
  // voyant de la sous-station : rouge hors tension, vert une fois le courant remis (tram.js : setPower)
  info.setPowered = (on) => { if (info.substation) setLamp(info.substation.lamp, on ? 0x30ff60 : 0xff2a1a); };
  info.setPowered(false);
  // aiguillage (v0.41.0) : 0 tout droit, 1 dévié ; les quatre têtes de signal affichent le réglage
  info.sw = 0;
  info.setSwitch = (v) => {
    info.sw = v ? 1 : 0;
    for (const sg of info.signals) { setLamp(sg.straight, info.sw ? 0x15181c : 0xf4f4e8); setLamp(sg.diverge, info.sw ? 0xf4f4e8 : 0x15181c); }
  };
  info.setSwitch(0);

  // ---------------------------------------------------------------- distance au réseau (m) : décor, arbres, lampadaires
  info.dist = (x, z, max = 40) => net.dist(x, z, max);
  // à l'intérieur de l'emprise : le lit des voies (+0,3 m) ou un quai (la dalle et sa bordure)
  info.covers = (x, z) => {
    for (const t of net.tracks) {
      const p = t.project(x, z, 6, o);
      if (p.d === Infinity) continue;
      if (p.d < T.furnitureGap) return true; // le couloir libre de la voie (3,25 m + marge de navigation + le meuble)
      for (const st of t.stops) if (Math.abs(p.s - st.s) < st.len / 2 + 1.5 && p.d < 2.4 / 2 + 0.25 + T.platform.width + 0.3) return true;
    }
    for (const c of net.connectors) if (c.project(x, z, 6, o).d < T.furnitureGap) return true; // raccords des aiguillages
    return false;
  };
  return info;
}
