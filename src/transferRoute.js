import { Track } from './tramTrack.js';

// =====================================================================
//  Rendered tram transfer (v0.83.0) : pure geometry and timing, no Three.js (see transfer.js for the game side).
//
//  Route : ONE centreline from the Gare Centrale buffer stop to past Homme de Fer, built from three sources joined by smooth blends :
//    1. the station's line C stop track (BD TOPO, rail.stops : the rails drawn by gare/build.js on Place de la Gare) ;
//    2. the real line C (OSM route relation, rail.routes.tramC : Gare Centrale -> Faubourg de Saverne -> bridge over the Ill -> Homme de Fer) ;
//    3. the island's B / C / F track (CONFIG.tram.lines, the rails drawn by tramNet.js) from the junction with lines B / F to past Homme de Fer.
//  Heights h(s) : the terrain (terrainY), except over water (the Ill) where a bridge deck joins the two banks in a straight line.
//
//  Trip timeline : a pure function of the time t since the departure message (every client computes the same pose) :
//    doors close, leg A (departure, `depart` m), cut (dip to black), leg B (the middle stretch), cut, leg C (the last `arrive` m into the stop),
//    doors open, dwell, doors close, the car drives off (`leave` m) and is hidden. The cuts compress a ~1 km ride into ~30 s ; the first one also
//    hides the switch between the station area and the island (only the local player's area is drawn, see realworld.js setLocalArea).
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

// polyline [[x, z]…] -> points every `step` m (the last point kept)
export function resample(pts, step = 1) {
  const out = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az);
    let s = step - acc;
    while (s <= d) { out.push([ax + ((bx - ax) * s) / d, az + ((bz - az) * s) / d]); s += step; }
    acc = (acc + d) % step;
  }
  const l = pts[pts.length - 1], e = out[out.length - 1];
  if (Math.hypot(l[0] - e[0], l[1] - e[1]) > step * 0.3) out.push([l[0], l[1]]);
  return out;
}

// nearest point of a 1 m polyline to (x, z) : fractional index (= m along it)
function projectPts(P, x, z, i0 = 0, i1 = P.length - 1) {
  let best = Infinity, bi = 0;
  for (let i = Math.max(1, i0); i <= Math.min(P.length - 1, i1); i++) {
    const a = P[i - 1], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    let u = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; u = clamp(u, 0, 1);
    const d = Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u);
    if (d < best) { best = d; bi = i - 1 + u; }
  }
  return bi;
}
const ptAt = (P, f) => { const i = clamp(Math.floor(f), 0, P.length - 2), u = clamp(f - i, 0, 1); return [P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u]; };

// gare : { track: [[x, z]…] (buffer first), at: [x, z] (stop), railsEnd: [x, z] (end of the rails drawn by the station) } ;
// tramC : rail.routes.tramC ; bcf : island Track of line B / C / F ; bcfStopS : s of the Homme de Fer stop on it ; terrainY ; R : CONFIG.transfer.route
export function buildTransferRoute({ gare, tramC, bcf, bcfStopS, terrainY, R }) {
  const A = resample(gare.track, 1), C = tramC.samples, o = {};
  const pts = [];
  // 1) station stop track up to the end of its drawn rails
  const aEnd = Math.min(A.length - 1 - R.gareBlend, Math.round(projectPts(A, gare.railsEnd[0], gare.railsEnd[1])));
  for (let i = 0; i <= aEnd; i++) pts.push(A[i]);
  // 2) blend into line C over gareBlend m
  let cHint = 0;
  for (let k = 1; k <= R.gareBlend; k++) {
    const pa = A[aEnd + k], fc = projectPts(C, pa[0], pa[1], 0, 400), pc = ptAt(C, fc), f = smooth(k / R.gareBlend);
    pts.push([pa[0] + (pc[0] - pa[0]) * f, pa[1] + (pc[1] - pa[1]) * f]);
    cHint = fc;
  }
  // 3) line C up to its junction with B / F
  const J = tramC.junction ? tramC.junction.s : C.length - 1 - R.bcfBlend;
  for (let i = Math.floor(cHint) + 1; i <= J; i++) pts.push(C[i]);
  // 4) blend into the island's B / C / F track over bcfBlend m (the two run side by side there : OSM vs the hand-traced line)
  let bS = 0;
  const iB0 = pts.length;
  for (let k = 1; k <= R.bcfBlend; k++) {
    const pc = C[Math.min(C.length - 1, J + k)], q = bcf.project(pc[0], pc[1], 40, o);
    bcf.at(q.s, o); const f = smooth(k / R.bcfBlend);
    pts.push([pc[0] + (o.x - pc[0]) * f, pc[1] + (o.z - pc[1]) * f]);
    bS = q.s;
  }
  // 5) the island track to past Homme de Fer
  const bFrom = bS + 1;
  for (let s = bFrom; s <= Math.min(bcf.L, bcfStopS + R.extra); s += 1) { bcf.at(s, o); pts.push([o.x, o.z]); }
  // light smoothing of the two blends (moving average) : no kink where the sources meet
  const sm = pts.map((p) => p.slice());
  for (const [i0, i1] of [[aEnd - 4, aEnd + R.gareBlend + 6], [iB0 - 6, iB0 + R.bcfBlend + 2]]) {
    for (let pass = 0; pass < 3; pass++) {
      const src = sm.map((p) => p.slice());
      for (let i = Math.max(2, i0); i <= Math.min(pts.length - 3, i1); i++) for (const c of [0, 1]) sm[i][c] = (src[i - 2][c] + src[i - 1][c] + src[i][c] + src[i + 1][c] + src[i + 2][c]) / 5;
    }
  }
  const track = new Track({ id: 'C-transfer', name: 'Ligne C (transfert)', samples: { x: sm.map((p) => p[0]), z: sm.map((p) => p[1]) } });
  const sOf = (x, z) => track.project(x, z, 30, {}).s;
  // abscissae of the landmarks
  const sGare = sOf(gare.at[0], gare.at[1]);
  bcf.at(bcfStopS, o); const sHdf = sOf(o.x, o.z);
  bcf.at(bFrom + 2, o); const sBcf = sOf(o.x, o.z); // from here the route IS the island track (its rails are drawn by tramNet.js)
  const sRailsEnd = track.s[Math.min(track.n - 1, aEnd)];
  const stops = (tramC.stops || []).map((st) => ({ name: st.name, s: sOf(st.at[0], st.at[1]) }));
  // heights : terrain, bridges over water (runs below bridgeBelow), smoothed
  const n = track.n, h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = terrainY(track.x[i], track.z[i]);
  const bridges = [];
  for (let i = 0; i < n; i++) {
    if (h[i] >= R.bridgeBelow) continue;
    let j = i; while (j + 1 < n && h[j + 1] < R.bridgeBelow) j++;
    const a = Math.max(0, i - R.bridgePad), b = Math.min(n - 1, j + R.bridgePad), ha = terrainY(track.x[Math.max(0, a - 1)], track.z[Math.max(0, a - 1)]), hb = terrainY(track.x[Math.min(n - 1, b + 1)], track.z[Math.min(n - 1, b + 1)]);
    for (let k = a; k <= b; k++) h[k] = Math.max(0, ha + ((hb - ha) * (k - a)) / Math.max(1, b - a)) + 0.02;
    bridges.push({ s0: track.s[a], s1: track.s[b], water: [track.s[i], track.s[j]] });
    i = j;
  }
  let hs = h.slice();
  for (let pass = 0; pass < 2; pass++) { const src = hs.slice(); for (let i = 2; i < n - 2; i++) hs[i] = (src[i - 2] + src[i - 1] + src[i] + src[i + 1] + src[i + 2]) / 5; }
  for (const br of bridges) for (let i = 0; i < n; i++) if (track.s[i] >= br.s0 && track.s[i] <= br.s1) hs[i] = Math.max(hs[i], h[i]); // (the deck never sinks)
  const heightAt = (s) => {
    s = clamp(s, 0, track.L);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track.s[mid] <= s) lo = mid; else hi = mid; }
    const d = track.s[hi] - track.s[lo], f = d > 1e-9 ? (s - track.s[lo]) / d : 0;
    return hs[lo] + (hs[hi] - hs[lo]) * f;
  };
  return { track, sGare, sHdf, sBcf, sRailsEnd, stops, bridges, heightAt, bcfOffset: sHdf - bcfStopS };
}

// ------------------------------------------------------------------ speed profile of one leg (pure)
// from s0 to s1 along the track ; v0 / v1 : speed at the ends (null : free, i.e. the speed limit) ; vlim(s) : speed limit (m/s)
export function legProfile(track, s0, s1, v0, v1, vlim, D) {
  const dir = s1 >= s0 ? 1 : -1, len = Math.abs(s1 - s0), step = D.step, n = Math.max(2, Math.ceil(len / step) + 1);
  const vs = new Float32Array(n), ts = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.min(len, i * step);
    let v = vlim(s0 + dir * d);
    if (v0 != null) v = Math.min(v, Math.sqrt(v0 * v0 + 2 * D.accel * d));
    if (v1 != null) v = Math.min(v, Math.sqrt(v1 * v1 + 2 * D.brake * (len - d)));
    vs[i] = v;
  }
  for (let i = 1; i < n; i++) { const dd = Math.min(len, i * step) - Math.min(len, (i - 1) * step); ts[i] = ts[i - 1] + dd / Math.max(0.05, (vs[i - 1] + vs[i]) / 2); }
  const T = ts[n - 1];
  return {
    s0, s1, dir, len, T, n, step,
    // pose at time t (clamped to the leg) : out.s, out.v (signed : the direction of travel)
    at(t, out) {
      t = clamp(t, 0, T);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
      const dt = ts[hi] - ts[lo], f = dt > 1e-9 ? (t - ts[lo]) / dt : 0;
      const d = Math.min(len, (lo + f) * step);
      out.s = s0 + dir * d; out.v = dir * (vs[lo] + (vs[hi] - vs[lo]) * f);
      return out;
    },
    // time when the leg passes s (or null)
    timeAt(s) { const d = (s - s0) * dir; if (d < 0 || d > len) return null; const i = Math.min(n - 2, Math.floor(d / step)), f = (d - i * step) / step; return ts[i] + (ts[i + 1] - ts[i]) * f; },
  };
}

// speed limit along the route : cruise, curves (sqrt(aLat R)), slow pass at the intermediate stop
export function speedLimit(route, D, passS) {
  const o = {};
  return (s) => {
    let v = D.cruise;
    for (const ds of [-8, 0, 8]) { route.track.at(s + ds, o); if (o.R < Infinity) v = Math.min(v, Math.sqrt(D.aLat * o.R)); }
    if (passS != null && Math.abs(s - passS) < D.passLen) v = Math.min(v, D.pass);
    else if (passS != null && Math.abs(s - passS) < D.passLen + 25) v = Math.min(v, D.pass + (D.cruise - D.pass) * (Math.abs(s - passS) - D.passLen) / 25);
    return Math.max(1.5, v);
  };
}

// ------------------------------------------------------------------ trip timeline (pure)
// legs : [{ s0, s1, v0, v1 }…] (ridden in order, a cut between two legs) ; X : CONFIG.transfer
// Returns { T (end : hidden), tArrive (car stopped at the arrival stop), tOpen, tClose, tLeave, pose(t, out) } ; out : { s, v, doors, fade, ph, leg }
export function buildTrip(route, legs, vlim, X) {
  const D = X.drive, Cu = X.cut, dt = X.doorTime;
  const profs = legs.map((l) => legProfile(route.track, l.s0, l.s1, l.v0, l.v1, vlim, D));
  const seg = []; let t = 0;
  seg.push({ k: 'close', t0: 0, t1: dt, s: profs[0].s0 }); t = dt;
  profs.forEach((p, i) => {
    if (i > 0) { seg.push({ k: 'cut', t0: t, t1: t + Cu.hold, s: p.s0 }); t += Cu.hold; }
    seg.push({ k: 'ride', t0: t, t1: t + p.T, p, leg: i }); t += p.T;
  });
  const tArrive = t, sArr = profs[profs.length - 1].s1;
  seg.push({ k: 'open', t0: t, t1: t + dt, s: sArr }); t += dt;
  const tOpen = t;
  seg.push({ k: 'dwell', t0: t, t1: t + X.dwell, s: sArr }); t += X.dwell;
  const tClose = t;
  seg.push({ k: 'closing', t0: t, t1: t + dt, s: sArr }); t += dt;
  const leave = legProfile(route.track, sArr, sArr + X.leave, 0, null, vlim, D), tLeave = t;
  seg.push({ k: 'leave', t0: t, t1: t + leave.T, p: leave }); t += leave.T;
  const T = t;
  // cut instants (end of a leg) : the screen dips to black around them (riders only)
  const cuts = seg.filter((s) => s.k === 'cut').map((s) => s.t0);
  return {
    T, tArrive, tOpen, tClose, tLeave, profs, cuts, sArr,
    pose(time, out) {
      let sg = seg[seg.length - 1];
      for (const s of seg) if (time < s.t1) { sg = s; break; }
      const lt = time - sg.t0;
      out.ph = sg.k; out.leg = sg.leg ?? -1;
      if (sg.p) sg.p.at(lt, out); else { out.s = sg.s; out.v = 0; }
      out.doors = sg.k === 'close' ? 1 - clamp(lt / dt, 0, 1) : sg.k === 'open' ? clamp(lt / dt, 0, 1) : sg.k === 'dwell' ? 1 : sg.k === 'closing' ? 1 - clamp(lt / dt, 0, 1) : 0;
      let f = 0;
      for (const c of cuts) {
        if (time >= c - Cu.out && time < c) f = Math.max(f, (time - (c - Cu.out)) / Cu.out);
        else if (time >= c && time < c + Cu.hold) f = 1;
        else if (time >= c + Cu.hold && time < c + Cu.hold + Cu.in) f = Math.max(f, 1 - (time - c - Cu.hold) / Cu.in);
      }
      out.fade = f;
      if (time >= T) out.ph = 'gone';
      return out;
    },
  };
}

// arrival at the departure stop during the countdown : the car comes from s + from * approach, stops at s at time tStop, doors open
export function buildCall(route, s, from, approach, tStop, vlim, X) {
  const p = legProfile(route.track, s + from * approach, s, null, 0, vlim, X.drive), dt = X.doorTime;
  return {
    pose(time, out) {
      const lt = time - tStop + p.T;
      p.at(lt, out); out.ph = time < tStop ? 'approach' : 'wait'; out.leg = -1; out.fade = 0;
      out.doors = clamp((time - tStop) / dt, 0, 1);
      return out;
    },
  };
}
