// Géométrie pure des voies du tram (aucune dépendance à Three.js : le jeu et les outils de mesure s'en servent).
//
// Une ligne de CONFIG.tram.lines est une polyligne [[x, z, r?], ...] (x vers l'est, z vers le sud) : r est le rayon (m) de l'arc de
// raccord posé à ce sommet (30 par défaut, jamais moins de CONFIG.tram.minRadius). La voie est échantillonnée tous les `step` mètres :
// position, cap (tangente) et rayon de courbure local sont connus à chaque abscisse curviligne s (m depuis le premier sommet).
// Le tram est une position 1D `s` sur cette voie : pas de déraillement possible.

const TAU = Math.PI * 2;

export class Track {
  // def : { id, name, pts, stops?, ... } ; step : pas d'échantillonnage (m) ; minR : rayon minimal accepté
  constructor(def, step = 1, minR = 25) {
    this.def = def; this.id = def.id; this.name = def.name || def.id;
    this.step = step;
    let xs = [], zs = [];
    const warn = this.warnings = [];
    if (def.samples) { xs = Array.from(def.samples.x); zs = Array.from(def.samples.z); } // voie déjà échantillonnée (itinéraires des aiguillages, voir buildJunction)
    else {
      const P = def.pts, n = P.length;
      // 1) sommets : arcs de raccord (tangente T = r tan(θ/2)), limités par la moitié des segments voisins
      const segLen = (i) => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      const dirOf = (i) => { const l = segLen(i); return [(P[i + 1][0] - P[i][0]) / l, (P[i + 1][1] - P[i][1]) / l]; };
      const arcs = [];
      for (let i = 1; i < n - 1; i++) {
        const u1 = dirOf(i - 1), u2 = dirOf(i), cross = u1[0] * u2[1] - u1[1] * u2[0], dot = u1[0] * u2[0] + u1[1] * u2[1];
        const th = Math.atan2(Math.abs(cross), dot);
        if (th < 1e-3) { arcs.push(null); continue; }
        const r = Math.max(P[i][2] ?? 30, minR), T = r * Math.tan(th / 2);
        arcs.push({ i, r, T, th, sgn: Math.sign(cross), u1, u2 });
      }
      // une tangente ne doit pas dépasser son segment (la somme des deux tangentes d'un segment non plus)
      for (let i = 0; i < n - 1; i++) {
        const a = arcs[i - 1] || null, b = arcs[i] || null, tt = (a ? a.T : 0) + (b ? b.T : 0);
        if (tt > segLen(i) + 1e-6) warn.push(`${def.id} segment ${i}-${i + 1} : tangentes ${tt.toFixed(1)} m > longueur ${segLen(i).toFixed(1)} m`);
      }
      // 2) points échantillonnés
      const push = (x, z) => { xs.push(x); zs.push(z); };
      for (let i = 0; i < n - 1; i++) {
        const a = arcs[i - 1] || null, b = arcs[i] || null, u = dirOf(i);
        const start = a ? [P[i][0] + u[0] * a.T, P[i][1] + u[1] * a.T] : [P[i][0], P[i][1]];
        const end = b ? [P[i + 1][0] - u[0] * b.T, P[i + 1][1] - u[1] * b.T] : [P[i + 1][0], P[i + 1][1]];
        const len = Math.hypot(end[0] - start[0], end[1] - start[1]), k = Math.max(1, Math.round(len / step));
        for (let j = i === 0 ? 0 : 1; j <= k; j++) push(start[0] + ((end[0] - start[0]) * j) / k, start[1] + ((end[1] - start[1]) * j) / k);
        if (b) { // arc : centre à r du côté du virage
          const nx = -b.u1[1] * b.sgn, nz = b.u1[0] * b.sgn; // normale vers l'intérieur du virage, au point de départ de l'arc
          const cx = end[0] + nx * b.r, cz = end[1] + nz * b.r, a0 = Math.atan2(end[1] - cz, end[0] - cx), arcLen = b.r * b.th, m = Math.max(2, Math.round(arcLen / step));
          for (let j = 1; j <= m; j++) { const a1 = a0 + b.sgn * (b.th * j) / m; push(cx + Math.cos(a1) * b.r, cz + Math.sin(a1) * b.r); }
        }
      }
    }
    // 3) abscisse curviligne, tangente
    const m = xs.length;
    this.n = m; this.x = Float32Array.from(xs); this.z = Float32Array.from(zs);
    this.s = new Float32Array(m);
    for (let i = 1; i < m; i++) this.s[i] = this.s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    this.L = this.s[m - 1];
    this.tx = new Float32Array(m); this.tz = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1), dx = xs[b] - xs[a], dz = zs[b] - zs[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // rayon de courbure local (m) : tiré de la variation de cap entre deux points distants de 6 m ; Infinity en ligne droite
    this.R = new Float32Array(m).fill(Infinity);
    const win = Math.max(1, Math.round(3 / step));
    for (let i = win; i < m - win; i++) {
      const dth = Math.atan2(this.tx[i - win] * this.tz[i + win] - this.tz[i - win] * this.tx[i + win], this.tx[i - win] * this.tx[i + win] + this.tz[i - win] * this.tz[i + win]);
      const ds = this.s[i + win] - this.s[i - win];
      if (Math.abs(dth) > 1e-3) this.R[i] = ds / Math.abs(dth);
    }
    // 4) grille pour projeter un point sur la voie
    this.cell = 8; this.grid = new Map();
    for (let i = 0; i < m - 1; i++) {
      const x0 = Math.min(xs[i], xs[i + 1]), x1 = Math.max(xs[i], xs[i + 1]), z0 = Math.min(zs[i], zs[i + 1]), z1 = Math.max(zs[i], zs[i + 1]);
      for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) for (let gz = Math.floor(z0 / this.cell); gz <= Math.floor(z1 / this.cell); gz++) {
        const k = gx * 8192 + gz; const arr = this.grid.get(k); if (arr) arr.push(i); else this.grid.set(k, [i]);
      }
    }
  }

  clampS(s) { return s < 0 ? 0 : s > this.L ? this.L : s; }

  // Point de la voie à l'abscisse s : out = { x, z, tx, tz, yaw, R } (yaw : cap du tram, comme Vehicle : l'avant est (-sin yaw, -cos yaw))
  at(s, out = {}) {
    s = this.clampS(s);
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.s[mid] <= s) lo = mid; else hi = mid; }
    const d = this.s[hi] - this.s[lo], f = d > 1e-9 ? (s - this.s[lo]) / d : 0;
    out.x = this.x[lo] + (this.x[hi] - this.x[lo]) * f;
    out.z = this.z[lo] + (this.z[hi] - this.z[lo]) * f;
    let tx = this.tx[lo] + (this.tx[hi] - this.tx[lo]) * f, tz = this.tz[lo] + (this.tz[hi] - this.tz[lo]) * f;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.tx = tx; out.tz = tz; out.yaw = Math.atan2(-tx, -tz);
    out.R = Math.min(this.R[lo], this.R[hi]);
    return out;
  }

  // Rayon de courbure minimal sur [s0, s1]
  minRadius(s0, s1) {
    let r = Infinity;
    for (let i = 0; i < this.n; i++) if (this.s[i] >= s0 && this.s[i] <= s1 && this.R[i] < r) r = this.R[i];
    return r;
  }

  // Projection de (x, z) : { s, d (distance à la voie, m), side (+1 à droite de l'avant) } ; d = Infinity au-delà de `max`
  project(x, z, max = 12, out = {}) {
    const c = this.cell, g0x = Math.floor((x - max) / c), g1x = Math.floor((x + max) / c), g0z = Math.floor((z - max) / c), g1z = Math.floor((z + max) / c);
    let best = Infinity, bs = 0, bside = 1;
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
      const arr = this.grid.get(gx * 8192 + gz);
      if (!arr) continue;
      for (const i of arr) {
        const ax = this.x[i], az = this.z[i], bx = this.x[i + 1], bz = this.z[i + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz);
        if (d < best) { best = d; bs = this.s[i] + t * Math.sqrt(l2); bside = (ex * (z - az) - ez * (x - ax)) >= 0 ? 1 : -1; }
      }
    }
    out.s = bs; out.d = best <= max ? best : Infinity; out.side = bside;
    return out;
  }
}

// Toutes les voies d'un réseau : { tracks: Map id -> Track }. Distance d'un point au rail le plus proche (m), Infinity au-delà de `max`.
export function buildTracks(cfg) {
  const tracks = cfg.lines.map((d) => new Track(d, cfg.step ?? 1, cfg.minRadius ?? 25));
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const tmp = {};
  return {
    tracks, byId,
    dist(x, z, max = 40) { let m = Infinity; for (const t of tracks) { const d = t.project(x, z, max, tmp).d; if (d < m) m = d; } return m; },
  };
}

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export { TAU };

// =====================================================================================================================
//  Aiguillages (v0.41.0) : un nœud où deux voies se croisent. Les voies d'origine se croisent sans se raccorder ; pour chaque virage permis
//  (CONFIG.tram.junction.turns) on construit un ITINÉRAIRE : une voie complète (de l'extrémité de la ligne d'arrivée à celle de la ligne de départ)
//  faite de la ligne d'arrivée jusqu'au point de tangence, d'un arc de rayon r, puis de la ligne de départ. L'itinéraire suit exactement les
//  lignes hors de l'arc : la rame peut passer de la ligne à l'itinéraire (ou l'inverse) sans aucun saut, tant qu'elle est entièrement sur une
//  partie commune (voir Tram.junctionStep). Un « bras » est une extrémité d'une ligne vue du nœud : { line, end } (end 0 : côté des s décroissants).
// =====================================================================================================================

const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;

// Point où les polylignes A et B se croisent : { sa, sb, x, z }
export function crossingOf(A, B) {
  const oa = {}, ob = {};
  let best = Infinity, sa = 0, sb = 0;
  for (let s = 0; s < A.L; s += 0.5) { A.at(s, oa); const p = B.project(oa.x, oa.z, 30, ob); if (p.d < best) { best = p.d; sa = s; sb = p.s; } }
  if (best === Infinity) return null;
  for (let it = 0; it < 30; it++) { A.at(sa, oa); sb = B.project(oa.x, oa.z, 30, ob).s; B.at(sb, ob); sa = A.project(ob.x, ob.z, 30, {}).s; }
  A.at(sa, oa); B.at(sb, ob);
  return { sa, sb, x: (oa.x + ob.x) / 2, z: (oa.z + ob.z) / 2, gap: Math.hypot(oa.x - ob.x, oa.z - ob.z) };
}

// Itinéraire du bras `from` vers le bras `to` : { track, connector, meta }
function makeRoute(J, byId, X, from, to, r, step) {
  const af = J.arms[from], at = J.arms[to];
  const A = byId[af.line], B = byId[at.line];
  const da = af.end === 0 ? 1 : -1, db = at.end === 1 ? 1 : -1;
  const nA = {}, nB = {};
  A.at(X.arm[from], nA); B.at(X.arm[to], nB);
  let sa = X.arm[from] - da * r, sb = X.arm[to] + db * r;
  const pa = {}, pb = {};
  let ta, tb, theta, T = r;
  for (let it = 0; it < 12; it++) { // les points de tangence doivent être à T = r tan(|θ|/2) du croisement des tangentes locales
    A.at(sa, pa); B.at(sb, pb);
    ta = [pa.tx * da, pa.tz * da]; tb = [pb.tx * db, pb.tz * db];
    theta = Math.atan2(cross2(ta[0], ta[1], tb[0], tb[1]), ta[0] * tb[0] + ta[1] * tb[1]);
    T = r * Math.tan(Math.abs(theta) / 2);
    const den = cross2(ta[0], ta[1], tb[0], tb[1]), dx = pb.x - pa.x, dz = pb.z - pa.z;
    const lam = cross2(dx, dz, tb[0], tb[1]) / den, mu = cross2(dx, dz, ta[0], ta[1]) / den;
    sa += da * (lam - T); sb -= db * (-mu - T);
  }
  A.at(sa, pa); B.at(sb, pb);
  ta = [pa.tx * da, pa.tz * da]; tb = [pb.tx * db, pb.tz * db];
  theta = Math.atan2(cross2(ta[0], ta[1], tb[0], tb[1]), ta[0] * tb[0] + ta[1] * tb[1]);
  const sgn = Math.sign(theta), arcLen = r * Math.abs(theta), m = Math.max(2, Math.round(arcLen / step));
  const cx = pa.x + -ta[1] * sgn * r, cz = pa.z + ta[0] * sgn * r, a0 = Math.atan2(pa.z - cz, pa.x - cx);
  const arc = [];
  for (let j = 0; j <= m; j++) { const a1 = a0 + sgn * (Math.abs(theta) * j) / m; arc.push([cx + Math.cos(a1) * r, cz + Math.sin(a1) * r]); }
  const gx = pb.x - arc[m][0], gz = pb.z - arc[m][1]; // l'arc finit à quelques millimètres du point de tangence : on referme
  for (let j = 0; j <= m; j++) { arc[j][0] += gx * j / m; arc[j][1] += gz * j / m; }
  // itinéraire : ligne d'arrivée (de son extrémité au point de tangence), arc, ligne de départ (du point de tangence à son extrémité)
  const xs = [], zs = [], o = {};
  const push = (x, z) => { xs.push(x); zs.push(z); };
  const lenA = da > 0 ? sa : A.L - sa;
  for (let k = 0; k < lenA; k += step) { A.at(da > 0 ? k : A.L - k, o); push(o.x, o.z); }
  const iArc0 = xs.length; // le premier point de l'arc est pa
  for (const [x, z] of arc) push(x, z);
  const iArc1 = xs.length - 1;
  const lenB = db > 0 ? B.L - sb : sb;
  for (let k = step; k < lenB; k += step) { B.at(db > 0 ? sb + k : sb - k, o); push(o.x, o.z); }
  B.at(db > 0 ? B.L : 0, o); push(o.x, o.z);
  const id = `${from}>${to}`;
  const track = new Track({ id, name: `${from} > ${to}`, samples: { x: xs, z: zs } }, step);
  const connector = new Track({ id: 'C:' + id, name: 'raccord ' + id, samples: { x: arc.map((p) => p[0]), z: arc.map((p) => p[1]) } }, step);
  track.meta = { id, from, to, aLine: A.id, da, sa, bLine: B.id, db, sb, theta, r, T, a0: track.s[iArc0], a1: track.s[iArc1] };
  return { id, from, to, track, connector, meta: track.meta };
}

// J : CONFIG.tram.junction ; byId : voies par identifiant. Renvoie null si les deux lignes ne se croisent pas.
export function buildJunction(J, byId, step = 1) {
  const A = byId[J.a], B = byId[J.b];
  const c = crossingOf(A, B);
  if (!c || c.gap > 1) return null;
  const sNode = { [J.a]: c.sa, [J.b]: c.sb };
  const X = { arm: {} };
  for (const id of Object.keys(J.arms)) X.arm[id] = sNode[J.arms[id].line];
  const routes = [], connectors = [];
  for (const t of J.turns) {
    const r = makeRoute(J, byId, X, t.from, t.to, t.r, step);
    routes.push(r); connectors.push(r.connector);
  }
  const jn = { name: J.name, x: c.x, z: c.z, sNode, arms: J.arms, routes, connectors, byId: Object.fromEntries(routes.map((r) => [r.id, r.track])) };
  // bras d'arrivée : extrémité de la ligne `line` côté `end`
  jn.armOf = (line, dir) => { const end = dir > 0 ? 0 : 1; for (const id of Object.keys(J.arms)) if (J.arms[id].line === line && J.arms[id].end === end) return id; return null; };
  jn.opposite = (arm) => { const a = J.arms[arm]; for (const id of Object.keys(J.arms)) if (J.arms[id].line === a.line && J.arms[id].end !== a.end) return id; return null; };
  // sorties possibles depuis un bras : tout droit d'abord, puis les virages permis (dans les deux sens de circulation)
  jn.exitsFrom = (arm) => { const out = [jn.opposite(arm)]; for (const t of J.turns) { if (t.from === arm) out.push(t.to); else if (t.to === arm) out.push(t.from); } return out; };
  // itinéraire d'un virage from -> to : { route, rev } (rev : l'itinéraire est parcouru à reculons, vitesse négative)
  jn.routeFor = (from, to) => { for (const r of routes) { if (r.from === from && r.to === to) return { route: r, rev: false }; if (r.from === to && r.to === from) return { route: r, rev: true }; } return null; };
  return jn;
}
