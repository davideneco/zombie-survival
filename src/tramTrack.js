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
    const xs = [], zs = [], warn = this.warnings = [];
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
