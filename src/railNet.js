import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { Track } from './tramTrack.js';

// =====================================================================
//  SNCF tracks (v0.80.0) : the intro route and the track meshes.
//    buildIntroRoute(rail, plan)   pure : the south-west approach of rail.json (routes.intro) as ONE continuous centreline (a tramTrack.js
//                                  Track, 1 m samples), smoothed, moved sideways beside quai 1 (see CONFIG.railNet.route), continued north
//                                  along the platform track. `parkHeadS` : abscissa of the locomotive nose when parked.
//    trackGeometry(pts, y0, out)   ballast prism, sleepers, two extruded rails along a polyline [[x, z]…] of any horizontal frame
//                                  (the station builds its tracks with it in its local frame : gare/build.js)
//    buildRailNet({...})           the approach outside the station : route + neighbouring tracks, catenary masts and wires, a ground strip,
//                                  in chunks of CONFIG.railNet.chunk m (one mesh per material per chunk, frustum culled, no shadows)
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// station clip : tracks inside are drawn by gare/build.js with the station meshes
export function inStationClip(plan, u, v) {
  const C = CONFIG.railNet.stationClip;
  return Math.abs(u) < C.u && v > C.v0 && v < plan.body.v0 - 1;
}

// ------------------------------------------------------------------ route (pure)
export function buildIntroRoute(rail, plan) {
  const R = CONFIG.railNet, RT = R.route, TR = CONFIG.train;
  const src = rail?.routes?.intro;
  if (!src?.samples?.length || !plan) return null;
  let pts = src.samples.map((p) => [p[0], p[1]]);
  // continue north along the platform track (the SNCF piece that starts at the stop and runs past the platform)
  const [sx, sz] = src.stopAt;
  let cont = null;
  for (const t of rail.tracks || []) {
    if (t.type === 'OSM' || t.id === src.platformTrack) continue;
    if (!t.pts.some(([x, z]) => Math.hypot(x - sx, z - sz) < 1.5)) continue;
    const loc = t.pts.map(([x, z]) => ({ p: [x, z], u: plan.L(x, z)[0] })).filter((q) => q.u > plan.L(sx, sz)[0] + 0.5).sort((a, b) => a.u - b.u);
    if (loc.length && (!cont || loc.length > cont.length)) cont = loc;
  }
  if (cont) {
    let [px, pz] = pts[pts.length - 1];
    for (const q of cont) {
      const [qx, qz] = q.p, d = Math.hypot(qx - px, qz - pz);
      for (let s = 1; s <= d; s += 1) pts.push([px + ((qx - px) * s) / d, pz + ((qz - pz) * s) / d]);
      px = qx; pz = qz;
      if (q.u > RT.extendTo) break;
    }
  }
  pts = pts.filter((p) => plan.L(p[0], p[1])[0] <= RT.extendTo);
  // smoothing : moving average, ends pinned (the SNCF pieces join with small angles at the switches)
  for (let pass = 0; pass < R.smooth.passes; pass++) {
    const k = R.smooth.radius, n = pts.length, out = pts.map((p) => p.slice());
    for (let i = k; i < n - k; i++) { let x = 0, z = 0; for (let j = -k; j <= k; j++) { x += pts[i + j][0]; z += pts[i + j][1]; } out[i] = [x / (2 * k + 1), z / (2 * k + 1)]; }
    pts = out;
  }
  // sideways correction : the platform track of the SNCF shapes, compared with the OSM quai 1 edge
  const platT = (rail.tracks || []).find((t) => t.id === src.platformTrack);
  const platV = (u) => { // v of the SNCF platform track at u (station frame), extrapolated flat
    if (!platT) return null;
    const L = platT.pts.map(([x, z]) => plan.L(x, z)).sort((a, b) => a[0] - b[0]);
    if (u <= L[0][0]) return L[0][1];
    for (let i = 1; i < L.length; i++) if (u <= L[i][0]) return L[i - 1][1] + ((L[i][1] - L[i - 1][1]) * (u - L[i - 1][0])) / (L[i][0] - L[i - 1][0] || 1);
    return L[L.length - 1][1];
  };
  const [pu0, pu1] = CONFIG.gare.playU, half = TR.width / 2 + RT.gap;
  const xs = [], zs = [];
  for (const [x, z] of pts) {
    const [u, v] = plan.L(x, z);
    const wgt = smoothstep(RT.blendIn[0], RT.blendIn[1], u) * (1 - smoothstep(RT.blendOut[0], RT.blendOut[1], u));
    let dv = 0;
    if (wgt > 0) { const pv = platV(clamp(u, pu0, pu1)); if (pv != null) dv = wgt * (plan.at(plan.q1W, clamp(u, pu0, pu1)) - half - pv); }
    const F = plan.frame;
    xs.push(x + F.vx * dv); zs.push(z + F.vz * dv);
  }
  const track = new Track({ id: 'intro', name: 'Itinéraire du train', samples: { x: xs, z: zs } }, 1, 25);
  // park : the nose at u = park.headU (first abscissa past it)
  let parkHeadS = track.L;
  for (let i = 0; i < track.n; i++) if (plan.L(track.x[i], track.z[i])[0] >= TR.park.headU) { parkHeadS = track.s[i]; break; }
  const o = track.at(parkHeadS, {}), q1c = plan.W((pu0 + pu1) / 2, plan.at(plan.q1W, 0) + 2);
  const platformSide = Math.sign(-(q1c[0] - o.x) * o.tz + (q1c[1] - o.z) * o.tx) || 1; // +1 : the platform is on the right of the direction of travel
  return { track, parkHeadS, platformSide, stopAt: src.stopAt, length: track.L };
}

// ------------------------------------------------------------------ polyline helpers
function simplify(pts, tol) { // Douglas-Peucker, keeps the ends
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  // cap the segment length (wire sag, chunking, ballast UVs)
  const res = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const [ax, az] = out[i - 1], [bx, bz] = out[i], d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 12);
    for (let k = 1; k <= n; k++) res.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return res;
}
// vertex frames : tangent (averaged at the joints), right = (-tz, tx) ; returns [{ x, z, tx, tz, s }]
function frames(pts) {
  const n = pts.length, out = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    if (i) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    out.push({ x: pts[i][0], z: pts[i][1], tx: dx / l, tz: dz / l, s });
  }
  return out;
}

// sweeps a 2D profile [[across, y]…] (an open strip) along the frames ; uvAcross : true -> u = across (m), v = along (m) ; scale k
function sweep(F, prof, { closed = false, k = 0.5, offset = 0 } = {}) {
  const pos = [], uv = [], m = prof.length, segs = closed ? m : m - 1;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i];
    for (let j = 0; j < segs; j++) {
      const p0 = prof[j], p1 = prof[(j + 1) % m];
      const P = (f, p) => [f.x - f.tz * (p[0] + offset), p[1], f.z + f.tx * (p[0] + offset)];
      const A = P(a, p0), B = P(a, p1), C = P(b, p1), D = P(b, p0);
      const ua = (p0[0] + offset) * k, ub = (p1[0] + offset) * k, va = a.s * k, vb = b.s * k;
      pos.push(...A, ...C, ...D, ...A, ...B, ...C); uv.push(ua, va, ub, vb, ua, vb, ua, va, ub, va, ub, vb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// rail profile (60E1-like, simplified) : across offset, height above the rail foot ; open at the bottom
function railProfile(H) {
  const k = H / 0.172;
  return [[0.075, 0], [0.075, 0.012 * k], [0.009, 0.03 * k], [0.009, 0.105 * k], [0.036, 0.116 * k], [0.036, 0.142 * k], [0.027, 0.15 * k], [0.012, H],
    [-0.012, H], [-0.027, 0.15 * k], [-0.036, 0.142 * k], [-0.036, 0.116 * k], [-0.009, 0.105 * k], [-0.009, 0.03 * k], [-0.075, 0.012 * k], [-0.075, 0]].reverse();
}

// sleeper : chamfered prism (bottom len x w, top slightly smaller), centred, along X = across, Z = along the track
let SLEEPER = null;
function sleeperGeo() {
  if (SLEEPER) return SLEEPER;
  const S = CONFIG.railNet.sleeper, L = S.len / 2, W = S.w / 2, l = L - 0.05, w = W - 0.04, H = S.h;
  const b = [[-L, 0, -W], [L, 0, -W], [L, 0, W], [-L, 0, W]], t = [[-l, H, -w], [l, H, -w], [l, H, w], [-l, H, w]];
  const pos = [];
  const quad = (A, B, C, D) => pos.push(...A, ...B, ...C, ...A, ...C, ...D);
  quad(t[0], t[3], t[2], t[1]); // top (facing up)
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], t[i], t[j], b[j]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 0.5, pos[i + 2] * 0.5 + pos[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return (SLEEPER = g);
}

// ------------------------------------------------------------------ one track : ballast prism, sleepers, rails (out : { ballast: [], sleeper: [], rail: [] })
// pts : [[x, z]…] in the target frame ; y0 : ballast top. Sleepers are merged (no instancing : they go into the per-material buckets).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
export function trackGeometry(pts, y0, out, opts = {}) {
  const R = CONFIG.railNet;
  if (pts.length < 2) return out;
  const P = simplify(pts, R.simplify);
  const F = frames(P);
  if (F[F.length - 1].s < 0.5) return out;
  const B = R.ballast;
  (out.ballast ||= []).push(sweep(F, [[-B.foot / 2, y0 - B.h], [-B.top / 2, y0], [B.top / 2, y0], [B.foot / 2, y0 - B.h]], { k: 0.5 }));
  const rh = R.railH, foot = y0 + R.railTop - rh, prof = railProfile(rh).map(([a, y]) => [a, foot + y]), off = (R.gauge + 0.072) / 2;
  for (const s of [-1, 1]) (out.rail ||= []).push(sweep(F, prof, { offset: s * off, k: 1 }));
  // sleepers every sleeperEvery m (arc length), perpendicular to the local tangent
  const sg = sleeperGeo(), list = [], total = F[F.length - 1].s, sTop = foot - 0.004 - R.sleeper.h;
  let i = 1;
  for (let s = (opts.phase ?? 0.3); s < total; s += R.sleeperEvery) {
    while (i < F.length - 1 && F[i].s < s) i++;
    const a = F[i - 1], b = F[i], t = (s - a.s) / (b.s - a.s || 1), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    _e.set(0, Math.atan2(-(a.tz + b.tz), a.tx + b.tx) - Math.PI / 2, 0); _q.setFromEuler(_e);
    _m.compose(_p.set(x, sTop, z), _q, _s);
    list.push(sg.clone().applyMatrix4(_m));
  }
  if (list.length) { const g = mergeGeometries(list, false); list.forEach((q) => q.dispose()); (out.sleeper ||= []).push(g); }
  return out;
}

// ------------------------------------------------------------------ canvas textures (ballast : colour + normal map ; trackside ground)
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
function canvas(n, draw) { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); return c; }
// normal map from the luminance of a canvas (Sobel)
export function normalFromCanvas(src, strength = 2.5) {
  const n = src.width, d = src.getContext('2d').getImageData(0, 0, n, n).data, out = document.createElement('canvas'); out.width = out.height = n;
  const o = out.getContext('2d'), img = o.createImageData(n, n), L = (x, y) => d[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1)) * strength;
    const dy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * n + x) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function groundTex() { // trackside : cinder path, dry weeds, mud ; 256 px = 8 m
  return canvas(256, (x, n) => {
    x.fillStyle = '#34322c'; x.fillRect(0, 0, n, n);
    for (let k = 0; k < 900; k++) { const g = 30 + hash(k, 1) * 26, h = hash(k, 2); x.fillStyle = h > 0.6 ? `rgb(${g + 6},${g + 10},${g - 4})` : `rgb(${g + 8},${g + 4},${g})`; const s = 3 + hash(k, 3) * 12; x.fillRect(hash(k, 4) * n, hash(k, 5) * n, s, s * (0.4 + hash(k, 6))); }
    for (let k = 0; k < 260; k++) { x.strokeStyle = `rgba(${70 + hash(k, 7) * 30},${74 + hash(k, 8) * 30},${50},0.5)`; const px = hash(k, 9) * n, py = hash(k, 10) * n; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (hash(k, 11) - 0.5) * 6, py - 4 - hash(k, 12) * 8); x.stroke(); }
  });
}

// trackside ground (cinder, weeds, mud ; 8 m texture tile) : the strip along the route, and the far ground of the ride (rideScenery.js)
let GROUND = null;
export function trackGroundMaterial() {
  if (GROUND) return GROUND;
  const gc = groundTex();
  GROUND = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(gc), normalMap: normalFromCanvas(gc, 1.5), roughness: 0.95, metalness: 0, color: 0x9a968c });
  GROUND.map.colorSpace = THREE.SRGBColorSpace; GROUND.map.wrapS = GROUND.map.wrapT = THREE.RepeatWrapping; GROUND.map.anisotropy = 4;
  return GROUND;
}

// ------------------------------------------------------------------ the approach (outside the station clip)
// mats : { ballast, sleeper, rail, steel, iron } (the station's materials : same shaders) ; returns { root, chunks }
export function buildRailNet({ rail, plan, route, mats }) {
  const R = CONFIG.railNet, G = CONFIG.gare;
  const root = new THREE.Group(); root.name = 'railNet';
  root.userData.noTerrain = true;
  if (!route) return { root, chunks: 0 };
  const y0 = G.railY, top = y0 + R.railTop;
  const tr = route.track;
  const inClip = (x, z) => { const [u, v] = plan.L(x, z); return inStationClip(plan, u, v); };
  const _pr = {};
  const groundMat = trackGroundMaterial();
  const chunks = new Map(); // key -> { mat -> [geometry] }
  const key = (x, z) => `${Math.floor(x / R.chunk)},${Math.floor(z / R.chunk)}`;
  const put = (k, mat, g) => { let c = chunks.get(k); if (!c) chunks.set(k, c = new Map()); let l = c.get(mat); if (!l) c.set(mat, l = []); l.push(g); };
  // runs of a polyline outside the clip, cut at chunk borders (each run lands in one chunk)
  const runs = (pts, keep) => {
    const out = []; let cur = [], ck = null;
    for (const p of pts) {
      const ok = keep(p[0], p[1]), k = key(p[0], p[1]);
      if (!ok) { if (cur.length > 1) out.push({ k: ck, pts: cur }); cur = []; ck = null; continue; }
      if (ck != null && k !== ck) { cur.push(p); if (cur.length > 1) out.push({ k: ck, pts: cur }); cur = [p]; }
      else cur.push(p);
      ck = k;
    }
    if (cur.length > 1) out.push({ k: ck, pts: cur });
    return out;
  };
  // 1) the route (its own centreline)
  const routePts = []; for (let i = 0; i < tr.n; i++) routePts.push([tr.x[i], tr.z[i]]);
  const lines = [{ pts: routePts, electrified: true, route: true }];
  // 2) neighbouring SNCF tracks (not the pieces the route already follows), within the corridor
  for (const t of rail.tracks || []) {
    if (t.type === 'OSM') continue;
    const dense = [];
    for (let i = 1; i < t.pts.length; i++) { const [ax, az] = t.pts[i - 1], [bx, bz] = t.pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 2)); for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
    let cur = [];
    const flush = () => { if (cur.length > 2) lines.push({ pts: cur, electrified: t.type === 'VPL' }); cur = []; };
    for (const p of dense) { const p0 = tr.project(p[0], p[1], R.corridor + 1, _pr); if (p0.d > 1.6 && p0.d <= R.corridor) cur.push(p); else flush(); }
    flush();
  }
  let phase = 0;
  for (const ln of lines) {
    for (const run of runs(ln.pts, (x, z) => !inClip(x, z))) {
      const o = trackGeometry(run.pts, y0, {}, { phase: (phase += 0.17) % R.sleeperEvery });
      for (const [k, mat] of [['ballast', mats.ballast], ['sleeper', mats.sleeper], ['rail', mats.rail]]) for (const g of o[k] || []) put(run.k, mat, g);
      if (!ln.electrified) continue;
      // contact and messenger wires, droppers ; masts every mast.every m on the outer side (away from the other tracks)
      const F = frames(simplify(run.pts, R.simplify)), wires = [];
      const W = R.wire, sq = (h, s) => [[-s, h - s], [-s, h + s], [s, h + s], [s, h - s]];
      wires.push(sweep(F, sq(top + W.contact, 0.012), { closed: true }), sweep(F, sq(top + W.messenger, 0.01), { closed: true }));
      const total = F[F.length - 1].s;
      let fi = 1;
      const at = (s) => { while (fi < F.length - 1 && F[fi].s < s) fi++; const a = F[fi - 1], b = F[fi], t = (s - a.s) / (b.s - a.s || 1); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz }; };
      for (let s = W.dropper / 2; s < total; s += W.dropper) { const q = at(s); const g = new THREE.CylinderGeometry(0.006, 0.006, W.messenger - W.contact, 4); g.translate(q.x, top + (W.contact + W.messenger) / 2, q.z); wires.push(g); }
      fi = 1;
      const M = R.mast;
      for (let s = (ln.route ? 7 : 31) % M.every; s < total; s += M.every) {
        const q = at(s);
        let side = 1;
        for (const sd of [1, -1]) { const mx = q.x - q.tz * sd * M.offset, mz = q.z + q.tx * sd * M.offset; if (!lines.some((l2) => l2 !== ln && l2.pts.some((p) => Math.abs(p[0] - mx) < 2.6 && Math.abs(p[1] - mz) < 2.6))) { side = sd; break; } }
        const mx = q.x - q.tz * side * M.offset, mz = q.z + q.tx * side * M.offset;
        if (inClip(mx, mz)) continue;
        const yaw = Math.atan2(-q.tz * side, q.tx * side); // mast web across the track
        // H-section mast (extruded I profile), concrete foundation, cantilever (tube, stay, insulators), registration arm
        const I = new THREE.Shape(); const fw = 0.11, ft = 0.018, wt = 0.012, d = 0.11;
        I.moveTo(-fw, -d); I.lineTo(fw, -d); I.lineTo(fw, -d + ft); I.lineTo(wt, -d + ft); I.lineTo(wt, d - ft); I.lineTo(fw, d - ft); I.lineTo(fw, d); I.lineTo(-fw, d); I.lineTo(-fw, d - ft); I.lineTo(-wt, d - ft); I.lineTo(-wt, -d + ft); I.lineTo(-fw, -d + ft); I.lineTo(-fw, -d);
        const mast = new THREE.ExtrudeGeometry(I, { depth: M.height, bevelEnabled: false }); mast.rotateX(-Math.PI / 2); mast.rotateY(yaw); mast.translate(mx, y0 - 0.2, mz);
        put(run.k, mats.steel, mast);
        const base = new THREE.CylinderGeometry(0.42, 0.5, 0.7, 10); base.translate(mx, y0 - 0.05, mz); put(run.k, mats.sleeper, base);
        const tip = [q.x, top + W.contact + 0.35, q.z], root2 = [mx, top + W.contact + 0.6, mz], stayA = [mx, top + W.messenger + 0.45, mz], stayB = [q.x - q.tz * side * 0.4, top + W.messenger + 0.05, q.z + q.tx * side * 0.4];
        for (const [a, b, r] of [[root2, tip, 0.03], [stayA, stayB, 0.022], [[tip[0], tip[1], tip[2]], [q.x, top + W.contact, q.z], 0.012]]) put(run.k, mats.steel, tube(a, b, r));
        for (const p of [[mx - (mx - q.x) * 0.12, root2[1] - 0.01 * 0, mz - (mz - q.z) * 0.12], [mx - (mx - stayB[0]) * 0.12, stayA[1] - (stayA[1] - stayB[1]) * 0.12, mz - (mz - stayB[2]) * 0.12]]) {
          const ins = new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8); ins.rotateZ(Math.PI / 2); ins.rotateY(yaw); ins.translate(p[0], p[1], p[2]); put(run.k, mats.iron, ins);
        }
      }
      for (const g of wires) put(run.k, mats.iron, g);
    }
  }
  // 3) ground strip along the route (embankment verges ; fog does the rest)
  {
    const gy = y0 - R.ballast.h - 0.02, wd = R.corridor;
    for (const run of runs(routePts, (x, z) => !inClip(x, z))) {
      const F = frames(simplify(run.pts, 0.2));
      // (v0.81.0 : a skirt past the edges dips under the far ground of the ride, rideScenery.js : a clean seam, no coplanar faces)
      put(run.k, groundMat, sweep(F, [[-wd - 2, gy - 1.3], [-wd, gy - 0.4], [-R.ballast.foot / 2 - 0.4, gy], [R.ballast.foot / 2 + 0.4, gy], [wd, gy - 0.4], [wd + 2, gy - 1.3]], { k: 1 / 8 }));
    }
  }
  // 4) one mesh per material per chunk
  let n = 0;
  for (const [k, byMat] of chunks) {
    const grp = new THREE.Group(); grp.name = 'railNet:' + k;
    for (const [mat, list] of byMat) {
      const g = mergeGeometries(list.map(keepStd), false); list.forEach((q) => q.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = mat === groundMat || mat === mats.ballast; m.name = 'railNet:mesh';
      grp.add(m); n++;
    }
    root.add(grp);
  }
  return { root, chunks: chunks.size, meshes: n, groundMat, groundY: y0 - R.ballast.h - 0.02 };
}

// position / normal / uv only, non-indexed
function keepStd(g) {
  let q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
  if (!q.attributes.normal) q.computeVertexNormals();
  if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
  return q;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function tube(a, b, r) {
  _a.set(...a); _b.set(...b);
  const len = _a.distanceTo(_b), g = new THREE.CylinderGeometry(r, r, len, 6);
  g.translate(0, len / 2, 0);
  const dir = _b.clone().sub(_a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(_a.x, _a.y, _a.z);
  return g;
}
