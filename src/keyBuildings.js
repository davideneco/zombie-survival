import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mk, box, pointIn } from './interiors.js';

// =====================================================================
//  Key buildings ("Immeuble fortifié", v0.88.0). In every zone one or two buildings get more than their ground-floor room: 1-2 upper floors reached by a
//  dog-leg stair, a central corridor, rooms, and a dead-end "last stand" room on the top floor.
//   - picking is deterministic (no `rnd`: the world stays identical for every player) and happens before the building loop of realworld.js;
//   - the upper floors are Levels regions (levels.js: floors, stair regions, links) with their own nav grids; zombies climb with the existing link code;
//   - the meshes (one merged mesh per material, <= 4 draw calls per building) are drawn only while the camera is inside the footprint, so they cost
//     nothing from the street; they share the interior materials (same daylight patch: no new shader program);
//   - the ground-floor room keeps its interiors.js walls, gets a hole in its ceiling above the stair shaft and the shaft walls.
//  Frame of a building: s runs along the stair axis (s = 0 at the foot of the flights, up to sEnd at the end wall, negative toward the building),
//  v across. The corridor is the strip v in vs +- half running from s = 0 toward the far end; partitions cross it every 4-6.5 m.
// =====================================================================
const K = () => CONFIG.keyBuildings;
const hash = (x, z, k = 0) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const WALL_COLORS = [[0.5, 0.46, 0.38], [0.42, 0.45, 0.41], [0.48, 0.41, 0.35], [0.38, 0.41, 0.44], [0.49, 0.47, 0.42]];
const WAINSCOT = [[0.3, 0.24, 0.18], [0.26, 0.29, 0.28], [0.34, 0.29, 0.23], [0.24, 0.24, 0.26]];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// ---- 2D helpers ----------------------------------------------------------------------------------------------------------------------------------
function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - abx * t, pz - az - abz * t);
}
function edgeDist(poly, x, z) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1])); }
  return d;
}
// Distance along the ray (o + t d) to the first polygon edge, or Infinity
function rayPoly(poly, ox, oz, dx, dz) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - ox) * ez - (a[1] - oz) * ex) / den, w = ((a[0] - ox) * dz - (a[1] - oz) * dx) / den;
    if (t > 1e-4 && w >= 0 && w <= 1 && t < best) best = t;
  }
  return best;
}
// Smallest-area oriented box of a polygon: { cx, cz, ux, uz (long axis), hu, hv (half sizes, hu >= hv) }
function minBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.5) continue;
    const dx = (bx - ax) / l, dz = (bz - az) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) { const u = x * dx + z * dz, v = -x * dz + z * dx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, dx, dz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { dx, dz } = best, cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2;
  const o = { cx: dx * cu - dz * cv, cz: dz * cu + dx * cv, ux: dx, uz: dz, hu: (best.u1 - best.u0) / 2, hv: (best.v1 - best.v0) / 2, area: best.area };
  if (o.hv > o.hu) { [o.ux, o.uz] = [-dz, dx]; [o.hu, o.hv] = [o.hv, o.hu]; }
  return o;
}
// Is the rectangle [u0,u1] x [v0,v1] (local frame) inside the polygon, at least m from its edges ? (boundary + centre samples)
function rectIn(L, u0, u1, v0, v1, m) {
  if (u0 > u1) [u0, u1] = [u1, u0];
  const ok = (u, v) => pointIn(u, v, L) && edgeDist(L, u, v) >= m;
  const nu = Math.max(1, Math.ceil((u1 - u0) / 0.5)), nv = Math.max(1, Math.ceil((v1 - v0) / 0.5));
  for (let i = 0; i <= nu; i++) { const u = u0 + ((u1 - u0) * i) / nu; if (!ok(u, v0) || !ok(u, v1)) return false; }
  for (let j = 0; j <= nv; j++) { const v = v0 + ((v1 - v0) * j) / nv; if (!ok(u0, v) || !ok(u1, v)) return false; }
  return ok((u0 + u1) / 2, (v0 + v1) / 2);
}

// ---- layout (pure geometry) ------------------------------------------------------------------------------------------------------------------------
// inner : inset outline of the building (the room walls) ; box : minBox ; door : { x, z } middle of the street door. Returns null when nothing fits.
function layoutKB(inner, box, door) {
  const C = K(), ST = C.stair, R = C.room;
  const ex = box.ux, ez = box.uz, fx = -ez, fz = ex;
  const L = inner.map(([x, z]) => [(x - box.cx) * ex + (z - box.cz) * ez, (x - box.cx) * fx + (z - box.cz) * fz]);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [u, v] of L) { uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
  const ud = (door.x - box.cx) * ex + (door.z - box.cz) * ez;
  const end = uMax - ud >= ud - uMin ? 1 : -1; // the stair goes at the end farthest from the street door
  const half = ST.lane + ST.divider / 2, sEnd = ST.run + ST.landing, vMid = (vMin + vMax) / 2;
  for (const g of [0.15, 0.5, 1, 1.6, 2.4]) {
    const uf = (end > 0 ? uMax : uMin) - end * g;
    const uAt = (s) => uf + end * (s - sEnd);
    for (const dv of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
      const vs = vMid + dv;
      if (!rectIn(L, uAt(-3), uAt(sEnd), vs - half - ST.clearance, vs + half + ST.clearance, 0.2)) continue;
      let sFar = -3;
      for (let s = -3.5; s > -60; s -= 0.5) { if (!rectIn(L, uAt(s - 0.5), uAt(s), vs - half, vs + half, 0.15)) break; sFar = s; }
      if (-sFar < R.minCorridor) continue;
      const pL = sFar + R.lastDepth, n = Math.max(1, Math.round(-pL / ((R.minLen + R.maxLen) / 2)));
      const parts = []; // partition positions along s : p_1 .. p_n (p_n = pL: the cross wall of the last stand room)
      for (let k = 1; k <= n; k++) parts.push((pL * k) / n);
      // partition rays: from the corridor wall (the doorway edge for the last cross wall) to the outline
      const rays = [];
      let bad = false;
      for (let k = 0; k < n; k++) {
        const s = parts[k], last = k === n - 1, off = last ? R.door / 2 : half, u = uAt(s), r = { t: {}, d: {} }; // t : wall length ; d : room depth from the corridor wall
        for (const sg of [-1, 1]) {
          const t = rayPoly(L, u, vs + sg * off, 0, sg);
          if (!(t < 40) || t + off - half < 1.6) { bad = true; break; }
          r.t[sg] = t; r.d[sg] = t + off - half;
        }
        if (bad) break;
        rays.push(r);
      }
      if (bad) continue;
      const W = (u, v) => [box.cx + ex * u + fx * v, box.cz + ez * u + fz * v];
      return { box, ex, ez, fx, fz, L, end, uf, uAt, vs, half, sEnd, sFar, pL, parts, rays, n, W, P: (s, v) => W(uAt(s), v), sdx: end * ex, sdz: end * ez };
    }
  }
  return null;
}

// ---- windows ---------------------------------------------------------------------------------------------------------------------------------------
// Ground-floor windows of a key building (barricades): spots on the street facade (same free-street test as the door) at least minGap from the door,
// from the passages and from each other, not in front of the stair shaft. Returns [{ i, t0, t1, s, len, x, z, nx, nz, ux, uz }] (i : edge of `pts`).
function pickWindows(pts, door, lay, env) {
  const WC = CONFIG.barricades.windows, hole = [lay.P(0, lay.vs - lay.half), lay.P(lay.sEnd, lay.vs - lay.half), lay.P(lay.sEnd, lay.vs + lay.half), lay.P(0, lay.vs + lay.half)];
  const cand = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < WC.width + 1.6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, mx0 = (a[0] + b[0]) / 2, mz0 = (a[1] + b[1]) / 2;
    let nx = uz, nz = -ux;
    if (pointIn(mx0 + nx * 0.3, mz0 + nz * 0.3, pts)) { nx = -nx; nz = -nz; }
    const cuts = env.cutsAt(a[0], a[1], b[0], b[1]);
    for (let s = 0.8 + WC.width / 2; s <= len - 0.8 - WC.width / 2; s += 0.5) {
      const x = a[0] + ux * s, z = a[1] + uz * s;
      if (door && door.i === i && Math.abs(s - ((door.t0 + door.t1) / 2) * len) < WC.minGap + 1.2 + WC.width / 2) continue;
      if (cuts.some(([c0, c1]) => s + WC.width / 2 + 0.3 > c0 * len && s - WC.width / 2 - 0.3 < c1 * len)) continue;
      if (![[0, 1.5], [0, 4], [-0.65, 1.2], [0.65, 1.2]].every(([o, d]) => env.streetFree(x + ux * o + nx * d, z + uz * o + nz * d))) continue;
      const ix = x - nx, iz = z - nz;
      if (pointIn(ix, iz, hole) || edgeDist(hole, ix, iz) < 1.1) continue; // not behind the stair shaft
      cand.push({ i, s, len, x, z, nx, nz, ux, uz, score: len * 0.05 + hash(x, z, 9) });
    }
  }
  cand.sort((p, q) => q.score - p.score);
  const out = [];
  for (const c of cand) {
    if (out.length >= WC.perBuilding) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < WC.minGap + WC.width)) continue;
    c.t0 = (c.s - WC.width / 2) / c.len; c.t1 = (c.s + WC.width / 2) / c.len;
    out.push(c);
  }
  return out;
}

// ---- picking -----------------------------------------------------------------------------------------------------------------------------------------
// env : { blds, skip(k), chooseDoor(pts, h), interiors, zones (CONFIG.sector.zones), startHint, polyArea }. Returns the picks (see createKeyBuildings).
function pickAll(env) {
  const C = K(), { blds, skip, chooseDoor, interiors, zones, startHint, polyArea } = env;
  const GF = C.groundStorey, FL = C.storey;
  const seeds = [];
  zones.forEach((z, zi) => {
    if (z.pocket || C.exclude.includes(z.name)) return;
    const sd = z.start ? startHint : z.seed;
    if (sd && typeof sd === 'object') seeds.push({ zi, name: z.name, x: sd.x, z: sd.z });
  });
  // candidates: every building that fits, with its layout
  const cands = [], why = {}, rej = (r) => { why[r] = (why[r] || 0) + 1; };
  for (let k = 0; k < blds.length; k++) {
    const bld = blds[k];
    if (skip(k)) continue;
    if (num(bld.tags.height) != null) { rej('height'); continue; } // (a `height` tag makes the facade height depend on the roof shape: unknown here)
    const lvTag = num(bld.tags['building:levels']);
    const storeys = lvTag != null ? Math.max(1, lvTag) : bld.ignH != null ? Math.max(1, Math.min(8, Math.round((bld.ignH - GF) / FL) + 1)) : Math.max(2, Math.round(((bld.h || 0) - GF) / FL) + 1);
    if (storeys < 2) { rej('storeys'); continue; }
    const pts = bld.pts;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    const near = seeds.filter((s) => Math.hypot(cx - s.x, cz - s.z) <= C.pickRadius);
    if (!near.length) continue;
    why.near = (why.near || 0) + 1;
    const a0 = Math.abs(polyArea(pts));
    if (a0 < C.minArea || a0 > C.maxArea * 1.4) { rej('area0'); continue; }
    const ol = interiors.outline(pts);
    if (!ol) { rej('outline'); continue; }
    const area = Math.abs(polyArea(ol.inner));
    if (area < C.minArea || area > C.maxArea) { rej('area'); continue; }
    const box = minBox(ol.inner);
    if (!box || box.hv * 2 < C.minWidth) { rej('width'); continue; }
    if (box.hu * 2 < C.minLength) { rej('length'); continue; }
    if (area / (4 * box.hu * box.hv) < C.minRect) { rej('rect'); continue; }
    const door = chooseDoor(pts, bld.h);
    if (!door) { rej('door'); continue; }
    const a = pts[door.i], b = pts[(door.i + 1) % pts.length], tm = (door.t0 + door.t1) / 2;
    const dp = { x: a[0] + (b[0] - a[0]) * tm, z: a[1] + (b[1] - a[1]) * tm };
    const lay = layoutKB(ol.inner, box, dp);
    if (!lay) { rej('layout'); continue; }
    const windows = pickWindows(pts, door, lay, env);
    if (windows.length < 2) { rej('windows'); continue; }
    cands.push({ k, pts, inner: ol.inner, P: ol.P, box, cx, cz, area, lay, storeys, door: dp, doorCut: door, windows, near, score: -Math.abs(area - C.targetArea) / C.targetArea + 0.35 * hash(cx, cz, 5) });
  }
  cands.sort((p, q) => q.score - p.score);
  const picks = [], stats = [];
  for (const s of seeds) {
    const want = C.twoIn.includes(s.name) ? 2 : 1;
    let got = 0;
    for (const c of cands) {
      if (got >= want) break;
      if (c.taken || !c.near.includes(s)) continue;
      if (picks.some((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) < C.minSpacing)) continue;
      c.taken = true; c.zoneIdx = s.zi; c.zoneName = s.name; picks.push(c); got++;
    }
    stats.push({ zone: s.name, want, got, cands: cands.filter((c) => c.near.includes(s)).length });
  }
  picks.stats = stats; stats.why = why;
  return picks;
}

// ---- the system --------------------------------------------------------------------------------------------------------------------------------------
export function createKeyBuildings(env) {
  const { scene, collision, levels, interiors, lightSources } = env; // env.getDoors() : the world's `doors` array (stair doors are appended to it)
  const list = [], windows = []; // windows : every window barricade of every key building (barricades.js drives them)
  const byBuilding = new Map(); // outline pts array -> kb
  let picks = [];
  const api = {
    list, picks: () => picks,
    // Before the building loop: choose the buildings
    pick(e) { picks = pickAll({ ...e, interiors, zones: CONFIG.sector.zones, startHint: CONFIG.startHint }); api.stats = picks.stats; for (const p of picks) byBuilding.set(p.k, p); return picks; },
    isKey: (k) => byBuilding.has(k),
    // Window cuts of building k for realworld's edgeCuts: [t0, t1, sill, lintel] per window, with the index of the outline edge
    windowsOf: (k) => (byBuilding.get(k)?.windows || []).map((w) => ({ i: w.i, cut: [w.t0, w.t1, CONFIG.barricades.windows.sill, CONFIG.barricades.windows.top] })),
    windows,

    // After interiors.addRoom: the ground room gets its ceiling hole above the stair shaft
    prepare() {
      const kept = [];
      for (const p of picks) {
        const room = interiors.rooms.find((r) => r.src === p.pts);
        if (!room) { byBuilding.delete(p.k); continue; }
        p.room = room;
        const lay = p.lay;
        const hole = [lay.P(0, lay.vs - lay.half), lay.P(lay.sEnd, lay.vs - lay.half), lay.P(lay.sEnd, lay.vs + lay.half), lay.P(0, lay.vs + lay.half)];
        p.hole = hole;
        room.ceilHoles = [hole];
        room.kb = true;
        kept.push(p);
      }
      picks = kept;
    },

    // After interiors.finish (materials exist) and before collision.build / levels.build: levels, collision, meshes
    build() {
      const mats = interiors.mats;
      picks.forEach((p, i) => { const kb = buildOne(p, i, mats); list.push(kb); });
      return list;
    },

    // Key building containing (x, z), or null (inner outline, not demoted)
    at(x, z) {
      for (const kb of list) {
        if (kb.demoted || x < kb.minX || x > kb.maxX || z < kb.minZ || z > kb.maxZ) continue;
        if (pointIn(x, z, kb.inner)) return kb;
      }
      return null;
    },
    // Ceiling height (relative to the terrain) above a body whose feet are at y: the nearest ceiling above y + 0.5 ; null when (x, z) is in no key building
    ceilingAt(x, z, y) {
      const kb = api.at(x, z);
      if (!kb) return null;
      const inShaft = pointIn(x, z, kb.hole);
      let best = Infinity;
      for (const c of kb.ceilings) { if (inShaft && !c.top) continue; if (c.y > y + 0.5 && c.y < best) best = c.y; }
      return best;
    },
    // Called every frame by the world: shows the upper floors and lights their lamps while the camera is inside (+ visiblePad) the footprint
    update(px, pz) {
      const pad = K().visiblePad;
      for (const kb of list) {
        let inside = false;
        if (!kb.demoted && px > kb.minX - pad && px < kb.maxX + pad && pz > kb.minZ - pad && pz < kb.maxZ + pad) inside = pointIn(px, pz, kb.pts) || edgeDist(kb.pts, px, pz) < pad;
        if (inside === kb.shown) continue;
        kb.shown = inside;
        for (const m of kb.meshes) m.visible = inside;
        for (const l of kb.lamps) l.off = !inside;
        env.onLightsChanged?.();
      }
    },
    // Ground nav grid hook (nav.finalize): the cells inside a stair shaft stay free (the lanes are wider than the margin) but are walled in: block them,
    // otherwise the flow field targets such a pocket instead of the street side of the stair foot
    stampNav(nav, blocked) {
      for (const kb of list) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of kb.hole) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        for (let iz = Math.max(0, nav.cz(z0)); iz <= Math.min(nav.nz - 1, nav.cz(z1)); iz++) for (let ix = Math.max(0, nav.cx(x0)); ix <= Math.min(nav.nx - 1, nav.cx(x1)); ix++) {
          if (pointIn(nav.worldX(ix), nav.worldZ(iz), kb.hole)) blocked[nav.idx(ix, iz)] = 1;
        }
      }
      // window barricades : the cells blocked only by the wall around the opening are boarded (3), or the vault sill (2) once torn: see windowCells
      for (const w of windows) {
        if (w.kind !== 'window') continue;
        w.cells = [];
        const hw = w.w / 2;
        for (let iz = Math.max(0, nav.cz(w.z - 1.6)); iz <= Math.min(nav.nz - 1, nav.cz(w.z + 1.6)); iz++) for (let ix = Math.max(0, nav.cx(w.x - 1.6)); ix <= Math.min(nav.nx - 1, nav.cx(w.x + 1.6)); ix++) {
          const idx = nav.idx(ix, iz);
          if (blocked[idx] !== 1) continue;
          const dx = nav.worldX(ix) - w.x, dz = nav.worldZ(iz) - w.z, along = dx * w.ux + dz * w.uz, across = dx * w.nx + dz * w.nz;
          if (Math.abs(along) > hw - 0.1 || across < -0.8 || across > 0.6) continue; // cells inside the opening that only the wall margin blocks (a 1.3 m opening passes a 0.4 m radius body)
          w.cells.push({ idx, torn: Math.abs(across + 0.1) <= 0.4 ? 2 : 0 }); // once torn: the sill is a vaultable cell (2), the cells before and after it are free
        }
        w.nav = nav;
        for (const c of w.cells) if (c.torn !== 1) blocked[c.idx] = w.perm ? 1 : w.n > 0 ? 3 : c.torn;
      }
    },
    // Does a failing building get dropped ? Called after the navs are built (see realworld.js): demotes sealed rooms and broken layouts
    validate(worldNav) {
      const report = [], C = K();
      for (const w of windows) if (w.kind === 'door' && w.nav) { for (const c of w.cells) w.nav.blocked[c.idx] = 0; w.nav.invalidate(); } // the last stand doorway counts as open
      for (const kb of list) kb.links[0].closed = false; // the stair doors are checked as if bought
      levels.invalidateHops();
      for (const kb of list) {
        let why = null;
        if (kb.room.sealed) why = 'sealed';
        else {
          if (levels.hopDistance(0, kb.top) === Infinity) why = 'no stair route';
          for (const r of kb.floors) {
            const nav = levels.regions[r].nav;
            if (!nav) { why = why || 'no nav'; continue; }
            const { sizes } = nav.components();
            const total = sizes.reduce((a, b) => a + b, 0), big = Math.max(0, ...sizes);
            if (!total || big / total < C.minConnected) why = why || `floor nav split ${(big / total).toFixed(2)}`;
          }
          if (!why && worldNav) { // the ground flow field targets the nearest free cell to the foot : it must be within the 1.3 m a zombie needs to start climbing
            let best = Infinity;
            for (let iz = worldNav.cz(kb.foot[1] - 2); iz <= worldNav.cz(kb.foot[1] + 2); iz++) for (let ix = worldNav.cx(kb.foot[0] - 2); ix <= worldNav.cx(kb.foot[0] + 2); ix++) {
              if (!worldNav.inside(ix, iz) || worldNav.blocked[worldNav.idx(ix, iz)]) continue;
              best = Math.min(best, Math.hypot(worldNav.worldX(ix) - kb.foot[0], worldNav.worldZ(iz) - kb.foot[1]));
            }
            if (best > 1.2) why = 'stair foot blocked';
          }
        }
        if (why) { api.demote(kb, why); report.push({ id: kb.id, why }); }
      }
      for (const w of windows) if (w.kind === 'door' && w.nav) { for (const c of w.cells) w.nav.blocked[c.idx] = w.perm ? 1 : w.n > 0 ? 3 : 0; w.nav.invalidate(); }
      for (const kb of list) if (!kb.demoted && kb.door) kb.links[0].closed = !kb.door.open; // back to closed behind their doors
      levels.invalidateHops();
      return report;
    },
    // After levels.buildNavs: the last stand doorway of each building is a boarded cell (3) of its floor nav (a free cell otherwise: it costs navCost while planks remain)
    afterNavs() {
      for (const w of windows) {
        if (w.kind !== 'door') continue;
        const nav = levels.regions[w.region].nav;
        if (!nav) continue;
        nav.barCost = CONFIG.barricades.navCost;
        w.nav = nav; w.cells = [];
        for (let iz = Math.max(0, nav.cz(w.z - 1.2)); iz <= Math.min(nav.nz - 1, nav.cz(w.z + 1.2)); iz++) for (let ix = Math.max(0, nav.cx(w.x - 1.2)); ix <= Math.min(nav.nx - 1, nav.cx(w.x + 1.2)); ix++) {
          const idx = nav.idx(ix, iz);
          const dx = nav.worldX(ix) - w.x, dz = nav.worldZ(iz) - w.z, along = dx * w.ux + dz * w.uz, across = dx * w.nx + dz * w.nz;
          // the cells of the doorway that only the board segment (and nothing beside the opening) blocks: free once the planks are gone
          if (Math.abs(along) > w.w / 2 - nav.margin + 0.02 || Math.abs(across) > nav.margin + nav.cell / 2) continue;
          w.cells.push({ idx, torn: 0 }); nav.blocked[idx] = 3;
        }
        nav.invalidate();
      }
    },
    // After the zones are known: the stair door's zone and price (max(min, k x the zone's door price) rounded to `step`)
    finishDoors(zonePrice) {
      const D = K().stairDoor;
      for (const kb of list) {
        const d = kb.door; if (!d) continue;
        d.a = d.b = d.toZone = kb.zone ?? -1;
        d.price = Math.max(D.min, Math.round((D.k * (zonePrice(kb.zone) || 0)) / D.step) * D.step);
      }
    },
    demote(kb, why) {
      kb.demoted = true; kb.why = why;
      for (const m of kb.meshes) m.visible = false;
      for (const l of kb.lamps) l.off = true;
      for (const lk of kb.links) lk.closed = true;
      for (const s of kb.segs) s.off = true;
      levels.invalidateHops();
      for (const w of windows) if (w.kb === kb.id) { w.perm = true; w.n = w.max; if (w.nav) for (const c of w.cells) if (c.torn !== 1) w.nav.blocked[c.idx] = 1; if (w.nav) w.nav.invalidate(); }
    },
  };

  // ---- construction of one building ------------------------------------------------------------------------------------------------------------
  function buildOne(p, id, mats) {
    const C = K(), ST = C.stair, RM = C.room, lay = p.lay, { vs, half, sEnd, P, parts, n } = lay;
    const nUp = Math.max(1, Math.min(C.maxUpper, p.storeys - 1));
    const ys = [];
    for (let k = 1; k <= nUp; k++) ys.push(C.groundStorey + C.storey * (k - 1));
    const wallC = WALL_COLORS[Math.floor(hash(p.cx, p.cz, 1) * WALL_COLORS.length)], lowC = WAINSCOT[Math.floor(hash(p.cx, p.cz, 2) * WAINSCOT.length)];
    const tint = 0.85 + 0.3 * hash(p.cx, p.cz, 4), floorC = [0.58 * tint, 0.42 * tint, 0.28 * tint];
    const kb = {
      id, name: 'Immeuble fortifié', k: p.k, pts: p.pts, inner: p.inner, room: p.room, hole: p.hole, zoneIdx: p.zoneIdx, zoneName: p.zoneName,
      nUp, ys, floors: [], stairRegions: [], links: [], lamps: [], segs: [], meshes: [], ceilings: [], rooms: [], shown: false, demoted: false, lay,
      minX: Math.min(...p.pts.map((q) => q[0])), maxX: Math.max(...p.pts.map((q) => q[0])), minZ: Math.min(...p.pts.map((q) => q[1])), maxZ: Math.max(...p.pts.map((q) => q[1])),
    };
    const W = mk(), F = mk(), M = mk(), LP = mk();
    const sa = (ax, az, bx, bz, h, y0) => { const s = collision.addSegment(ax, az, bx, bz, h, y0); kb.segs.push(s); return s; };
    const eS = [lay.sdx, lay.sdz]; // world direction of +s
    const vA = vs - (ST.divider / 2 + ST.lane / 2), vB = vs + (ST.divider / 2 + ST.lane / 2); // lane centres (A goes up first, B comes back)

    // oriented geometry helper: quad facing n whatever the order of the corners
    const quadN = (B, a, b, c, d, n, col, uv) => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) [b, d] = [d, b];
      const base = B.pos.length / 3;
      B.pos.push(...a, ...b, ...c, ...d);
      for (let i = 0; i < 4; i++) { B.nor.push(n[0], n[1], n[2]); B.col.push(col[0], col[1], col[2]); }
      B.uv.push(...(uv || [a[0] / 2, a[2] / 2, b[0] / 2, b[2] / 2, c[0] / 2, c[2] / 2, d[0] / 2, d[2] / 2]));
      B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // horizontal polygon with holes, subdivided to <= 2.5 m edges (the terrain shader moves the vertices), facing up or down
    const fill = (B, contour, holes, y, up, col) => {
      const v2 = contour.map(([x, z]) => new THREE.Vector2(x, z));
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(v2, holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)))); } catch { tris = []; }
      const all = [...contour, ...holes.flat()];
      for (const [a, b, c] of tris) {
        const pa = all[a], pb = all[b], pc = all[c], s = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
        const [q1, q2] = (s < 0) === up ? [pb, pc] : [pc, pb];
        const stack = [[pa, q1, q2]];
        while (stack.length) {
          const [u, v, x] = stack.pop();
          const e = [[u, v], [v, x], [x, u]].map(([p0, p1]) => (p0[0] - p1[0]) ** 2 + (p0[1] - p1[1]) ** 2), m = e.indexOf(Math.max(...e));
          if (e[m] > 6.25) {
            const [p0, p1, p2] = m === 0 ? [u, v, x] : m === 1 ? [v, x, u] : [x, u, v], mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
            stack.push([p0, mid, p2], [mid, p1, p2]);
            continue;
          }
          const base = B.pos.length / 3;
          B.pos.push(u[0], y, u[1], v[0], y, v[1], x[0], y, x[1]);
          for (let k = 0; k < 3; k++) { B.nor.push(0, up ? 1 : -1, 0); B.col.push(col[0], col[1], col[2]); }
          B.uv.push(u[0] / 2, u[1] / 2, v[0] / 2, v[1] / 2, x[0] / 2, x[1] / 2);
          B.idx.push(base, base + 1, base + 2);
        }
      }
    };
    // a wall between two (s, v) points of the layout, from y0 to y1: wainscot box + plaster box + cap strip ; collision band if `col`
    const wallSeg = (s0, v0, s1, v1, y0, y1, collide) => {
      const [ax, az] = P(s0, v0), [bx, bz] = P(s1, v1), len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) return;
      const ux = (bx - ax) / len, uz = (bz - az) / len, cx = (ax + bx) / 2, cz = (az + bz) / 2, t = RM.wall;
      box(M, cx, y0, cz, ux, uz, len, 1.05, t + 0.03, lowC);
      box(M, cx, y0 + 1.05, cz, ux, uz, len, 0.07, t + 0.05, [lowC[0] * 0.6, lowC[1] * 0.6, lowC[2] * 0.6]);
      box(M, cx, y0 + 1.12, cz, ux, uz, len, y1 - y0 - 1.12, t, wallC);
      if (collide === 'full') sa(ax, az, bx, bz);
      else if (collide) sa(ax, az, bx, bz, y1, y0 - 0.2);
    };
    // the same, but the wall segment has a doorway : pieces [s0..a] and [b..s1] along the line
    const gapWall = (s0, v0, s1, v1, gaps, y0, y1, lintel = true) => {
      const alongS = Math.abs(s1 - s0) > Math.abs(v1 - v0), a0 = alongS ? s0 : v0, a1 = alongS ? s1 : v1, dir = Math.sign(a1 - a0) || 1;
      const at = (a) => alongS ? [a, v0] : [s0, a];
      let cur = a0;
      const sorted = gaps.slice().sort((p, q) => dir * (p - q));
      for (const c of sorted) {
        const g0 = c - dir * RM.door / 2, g1 = c + dir * RM.door / 2;
        if (dir * (g0 - cur) > 0.05) wallSeg(...at(cur), ...at(g0), y0, y1, true);
        if (lintel) { // lintel over the doorway (no collision: a body passes under, the band y0..2.2 stays open)
          const [ax, az] = P(...at(g0)), [bx, bz] = P(...at(g1)), len = Math.hypot(bx - ax, bz - az);
          box(M, (ax + bx) / 2, y0 + 2.2, (az + bz) / 2, (bx - ax) / len, (bz - az) / len, len, y1 - y0 - 2.2, RM.wall, wallC);
        }
        cur = g1;
      }
      if (dir * (a1 - cur) > 0.05) wallSeg(...at(cur), ...at(a1), y0, y1, true);
    };

    // ---- levels : floor regions, stair regions, links ----
    const regs = [0];
    for (let k = 1; k <= nUp; k++) {
      const y = ys[k - 1], R = levels.addRegion(`${kb.name} — étage ${k}`, y, 'floor', { kb: id, navCell: C.nav.cell, navMargin: C.nav.margin });
      const tris = levels.addPoly(R, p.inner, y, [p.hole]);
      collision.addFloor(y, tris);
      regs.push(R); kb.floors.push(R);
    }
    kb.top = regs[nUp];
    for (let k = 1; k <= nUp; k++) {
      const ya = k === 1 ? 0 : ys[k - 2], yb = ys[k - 1], ym = (ya + yb) / 2;
      const SR = levels.addRegion(`${kb.name} — escalier ${k}`, ym, 'stair', { kb: id });
      kb.stairRegions.push(SR);
      const V = (s, v, y) => { const [x, z] = P(s, v); return [x, y, z]; };
      const q = (s0, v0, y0, s1, v1, y1, s2, v2, y2, s3, v3, y3) => levels.addQuad(SR, V(s0, v0, y0), V(s1, v1, y1), V(s2, v2, y2), V(s3, v3, y3));
      const vA0 = vs - half, vA1 = vs - ST.divider / 2, vB0 = vs + ST.divider / 2, vB1 = vs + half;
      q(0, vA0, ya, ST.run, vA0, ym, ST.run, vA1, ym, 0, vA1, ya);   // flight A
      q(ST.run, vB0, ym, 0, vB0, yb, 0, vB1, yb, ST.run, vB1, ym);    // flight B (comes back)
      q(ST.run, vA0, ym, sEnd, vA0, ym, sEnd, vB1, ym, ST.run, vB1, ym); // landing
      const path = [V(-0.6, vA, ya), V(0, vA, ya), V(ST.run, vA, ym), V(ST.run + 0.6, vA, ym), V(ST.run + 0.6, vB, ym), V(ST.run, vB, ym), V(0, vB, yb), V(-0.6, vB, yb)];
      const link = levels.addLink(`${kb.name} — escalier ${k}`, regs[k - 1], regs[k], path, SR);
      link.kb = id; kb.links.push(link);
      // visual steps (the walkable surface is the smooth ramp through the tread centres)
      const rise = (yb - ya) / 2, steps = Math.max(2, Math.round(rise / ST.tread)), tr = ST.run / steps, dk = [floorC[0] * 0.75, floorC[1] * 0.75, floorC[2] * 0.75], rc = [floorC[0] * 0.55, floorC[1] * 0.55, floorC[2] * 0.55];
      for (const [lane, v0, v1] of [['A', vA0, vA1], ['B', vB0, vB1]]) {
        const y0 = lane === 'A' ? ya : ym, dirS = lane === 'A' ? 1 : -1;
        for (let i = 0; i < steps; i++) {
          const sa0 = lane === 'A' ? i * tr : ST.run - i * tr, sa1 = lane === 'A' ? (i + 1) * tr : ST.run - (i + 1) * tr, top = y0 + (rise * (i + 0.5)) / steps, prev = i === 0 ? y0 : y0 + (rise * (i - 0.5)) / steps;
          quadN(F, V(sa0, v0, top), V(sa1, v0, top), V(sa1, v1, top), V(sa0, v1, top), [0, 1, 0], dk);
          quadN(F, V(sa0, v0, prev), V(sa0, v1, prev), V(sa0, v1, top), V(sa0, v0, top), [-eS[0] * dirS, 0, -eS[1] * dirS], rc, [0, 0, 1, 0, 1, 0.2, 0, 0.2]);
        }
      }
      quadN(F, V(ST.run, vA0, ym + 0.01), V(sEnd, vA0, ym + 0.01), V(sEnd, vB1, ym + 0.01), V(ST.run, vB1, ym + 0.01), [0, 1, 0], floorC);
    }
    // foot of the first flight (street level): where ground zombies gather
    kb.foot = P(-0.6, vA);
    kb.stand = (floor) => { const [x, z] = P(-1.5, vs); return { x, z, y: floor === 0 ? 0 : ys[floor - 1], region: regs[floor] }; };

    // ---- shaft walls (collision at every height) and visuals ----
    const topY = ys[nUp - 1] + C.ceiling;
    for (const sg of [-1, 1]) wallSeg(0, vs + sg * half, sEnd, vs + sg * half, 0, topY, 'full');
    wallSeg(sEnd, vs - half, sEnd, vs + half, 0, topY, 'full');
    wallSeg(0, vs, ST.run, vs, 0, topY, 'full');
    {
      // ground level: the space under flight B is closed by a cross wall at the mouth of lane B (lane A is the way in)
      const [ax, az] = P(0, vs + ST.divider / 2), [bx, bz] = P(0, vs + half), len = Math.hypot(bx - ax, bz - az);
      sa(ax, az, bx, bz, C.groundStorey);
      box(M, (ax + bx) / 2, 0, (az + bz) / 2, (bx - ax) / len, (bz - az) / len, len, C.groundStorey - 0.1, RM.wall, lowC);
      // top floor: lane A is a closed alcove (nothing climbs further)
      const yT = ys[nUp - 1], [cx2, cz2] = P(0, vs - half), [dx2, dz2] = P(0, vs - ST.divider / 2), l2 = Math.hypot(dx2 - cx2, dz2 - cz2);
      sa(cx2, cz2, dx2, dz2, yT + C.ceiling, yT - 0.2);
      box(M, (cx2 + dx2) / 2, yT, (cz2 + dz2) / 2, (dx2 - cx2) / l2, (dz2 - cz2) / l2, l2, C.ceiling, RM.wall, wallC);
      // the street door gap has no collision in the facade (it is cut): close it above head height so nobody walks out of an upper floor
      const rm = p.room, d = rm.door;
      if (d) {
        const a = rm.pts[d.i], b = rm.pts[(rm.pts.length > 0 ? (d.i + 1) % rm.pts.length : 0)];
        sa(a[0] + (b[0] - a[0]) * d.t0, a[1] + (b[1] - a[1]) * d.t0, a[0] + (b[0] - a[0]) * d.t1, a[1] + (b[1] - a[1]) * d.t1, Infinity, 3.0);
      }
    }

    // ---- stair door: closes lane A at ground level until bought (a normal `doors` entry, `interior`: opens no zone) ----
    {
      const doors = env.getDoors(), [ax, az] = P(-0.05, vs - half), [bx, bz] = P(-0.05, vs - ST.divider / 2), len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      const seg = sa(ax, az, bx, bz, C.groundStorey);
      const DB = mk(), wood = [0.3, 0.2, 0.12], dark = [0.17, 0.11, 0.07], metal = [0.35, 0.35, 0.38], red = [0.55, 0.1, 0.08], cx = (ax + bx) / 2, cz = (az + bz) / 2, nx = -uz, nz = ux;
      for (let k = 0; k < 3; k++) box(DB, cx + ux * (k - 1) * 0.36, 0, cz + uz * (k - 1) * 0.36, ux, uz, 0.35, 2.35, 0.09, k % 2 ? dark : wood); // vertical planks
      for (const y of [0.35, 1.8]) box(DB, cx + nx * 0.07, y, cz + nz * 0.07, ux, uz, len, 0.16, 0.05, dark);                                // cross braces
      box(DB, cx + nx * 0.1, 1.05, cz + nz * 0.1, ux, uz, 0.18, 0.2, 0.05, metal);                                                           // lock plate
      box(DB, cx + nx * 0.1, 1.5, cz + nz * 0.1, ux, uz, 0.6, 0.22, 0.03, red);                                                              // red warning plate
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(DB.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(DB.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(DB.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(DB.uv, 2));
      g.setIndex(DB.idx); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats.furn);
      mesh.name = `kb${id}:stairDoor`; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.userData.lod = true; mesh.visible = false;
      scene.add(mesh); kb.meshes.push(mesh);
      kb.door = { id: doors.length, price: C.stairDoor.min, a: -1, b: -1, toZone: -1, name: 'l\'étage', open: false, points: [], hit: [vA - 0.4, vA, vA + 0.4].map((v) => { const [x, z] = P(-0.5, v); return { x, z }; }), segs: [seg], meshes: [mesh], cells: [], portal: false, interior: true, link: kb.links[0], kb: id };
      kb.links[0].closed = true; // zombies do not climb a closed stair
      doors.push(kb.door);
    }

    // ---- window barricades: a boarded opening is a wall (collision h = Infinity at the facade line); once torn it is a vaultable sill ----
    const WC = CONFIG.barricades.windows;
    p.windows.forEach((pw) => {
      const hw = WC.width / 2, ax = pw.x - pw.ux * hw, az = pw.z - pw.uz * hw, bx = pw.x + pw.ux * hw, bz = pw.z + pw.uz * hw;
      const board = sa(ax, az, bx, bz, Infinity);
      const cx = pw.x - pw.nx * 0.1, cz = pw.z - pw.nz * 0.1, vid = collision.vaults.length + 1, vsegs = [];
      const corner = (su, sn) => [cx + pw.ux * hw * su + pw.nx * 0.25 * sn, cz + pw.uz * hw * su + pw.nz * 0.25 * sn];
      const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      for (let q = 0; q < 4; q++) { const a = cs[q], b = cs[(q + 1) % 4], sg = collision.addSegment(a[0], a[1], b[0], b[1], WC.sill, -Infinity, 'wall', vid); sg.off = true; vsegs.push(sg); kb.segs.push(sg); }
      collision.vaults.push({ id: vid, h: WC.sill, segs: vsegs });
      const w = { id: windows.length, kind: 'window', kb: id, x: pw.x, z: pw.z, nx: pw.nx, nz: pw.nz, ux: pw.ux, uz: pw.uz, w: WC.width, yaw: Math.atan2(pw.nx, pw.nz), n: CONFIG.barricades.planks.window, max: CONFIG.barricades.planks.window, perm: false, board, vault: vsegs, cells: [], nav: null, tearers: 0, i: pw.i };
      windows.push(w); (kb.windows ||= []).push(w);
    });

    // ---- floors ----
    const lampsAt = [];
    for (let k = 1; k <= nUp; k++) {
      const y = ys[k - 1], top = k === nUp, yc = y + C.ceiling;
      fill(F, p.inner, [p.hole], y, true, floorC);
      fill(W, p.inner, top ? [] : [p.hole], yc, false, [0.42, 0.4, 0.37]);
      kb.ceilings.push({ y: yc, top });
      // outline walls (inside faces, same bands as interiors.js)
      const inn = p.inner, nn = inn.length;
      for (let i = 0; i < nn; i++) {
        const a = inn[i], b = inn[(i + 1) % nn], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, nx = -uz, nz = ux, u0 = 0, u1 = len / 2;
        const band = (y0, y1, col) => quadN(W, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz], col, [u0, y0, u1, y0, u1, y1, u0, y1]);
        band(y, y + 1.05, lowC); band(y + 1.12, yc, wallC);
        const dk = [lowC[0] * 0.6, lowC[1] * 0.6, lowC[2] * 0.6], e = 0.02, q0 = [a[0] + nx * e, a[1] + nz * e], q1 = [b[0] + nx * e, b[1] + nz * e];
        quadN(W, [q0[0], y + 1.05, q0[1]], [q1[0], y + 1.05, q1[1]], [q1[0], y + 1.12, q1[1]], [q0[0], y + 1.12, q0[1]], [nx, 0, nz], dk);
        quadN(W, [q0[0], y, q0[1]], [q1[0], y, q1[1]], [q1[0], y + 0.12, q1[1]], [q0[0], y + 0.12, q0[1]], [nx, 0, nz], dk);
      }
      // corridor walls (with a doorway per room) from the shaft to the last cross wall
      const centers = [];
      for (let j = 0; j < n; j++) centers.push(((j === 0 ? 0 : parts[j - 1]) + parts[j]) / 2);
      for (const sg of [-1, 1]) gapWall(0, vs + sg * half, lay.pL, vs + sg * half, centers, y, yc);
      // partitions between rooms; the last one (last stand room) has a doorway on the corridor axis
      for (let j = 0; j < n; j++) {
        const s = parts[j], last = j === n - 1, off = last ? RM.door / 2 : half, ray = lay.rays[j];
        for (const sg of [-1, 1]) wallSeg(s, vs + sg * off, s, vs + sg * (off + ray.t[sg]), y, yc, true);
        if (last) { // lintel over the last stand doorway
          const [ax, az] = P(s, vs - off), [bx, bz] = P(s, vs + off), len = Math.hypot(bx - ax, bz - az);
          box(M, (ax + bx) / 2, y + 2.2, (az + bz) / 2, (bx - ax) / len, (bz - az) / len, len, C.ceiling - 2.2, RM.wall, wallC);
        }
      }
      // lamps : one per room, the corridor and the last stand room
      const lampAt = (s, v) => lampsAt.push({ s, v, yc });
      for (let j = 0; j < n; j++) {
        for (const sg of [-1, 1]) lampAt(centers[j], vs + sg * (half + Math.min(lay.rays[j].d[sg], j > 0 ? lay.rays[j - 1].d[sg] : Infinity) / 2));
      }
      lampAt(-1.8, vs); // corridor, near the stairs
      for (let s = -7.8; s > lay.pL + 1.5; s -= 6) lampAt(s, vs);
      lampAt((lay.pL + lay.sFar) / 2 - 0.25, vs); // last stand room
    }
    kb.lastStand = { s0: lay.pL, s1: lay.sFar - 0.5, sMid: (lay.pL + lay.sFar) / 2 - 0.25, v: vs, y: ys[nUp - 1] };

    // ---- last stand room: a plank barricade on its doorway and an ammo crate ----
    {
      const yT = ys[nUp - 1], [x0, z0] = P(lay.pL, vs - RM.door / 2), [x1, z1] = P(lay.pL, vs + RM.door / 2), [cx, cz] = P(lay.pL, vs), len = Math.hypot(x1 - x0, z1 - z0);
      const board = sa(x0, z0, x1, z1, yT + C.ceiling, yT - 0.2);
      const w = { id: windows.length, kind: 'door', kb: id, x: cx, z: cz, nx: lay.sdx, nz: lay.sdz, ux: (x1 - x0) / len, uz: (z1 - z0) / len, w: len, yaw: Math.atan2(lay.sdx, lay.sdz), y0: yT, n: CONFIG.barricades.planks.door, max: CONFIG.barricades.planks.door, perm: false, board, vault: [], cells: [], nav: null, region: kb.top, i: -1 };
      windows.push(w); (kb.windows ||= []).push(w); kb.doorBar = w;
      // ammo crate against the far wall of the room
      const [qx, qz] = P(lay.sFar - 0.5 + 0.8, vs), ux = w.ux, uz = w.uz, wood2 = [0.28, 0.24, 0.12], band = [0.2, 0.2, 0.18];
      box(M, qx, yT, qz, ux, uz, 0.95, 0.5, 0.55, wood2);
      box(M, qx, yT + 0.5, qz, ux, uz, 1.0, 0.07, 0.6, [0.22, 0.2, 0.1]);
      for (const k of [-0.32, 0.32]) box(M, qx + ux * k, yT, qz + uz * k, ux, uz, 0.07, 0.52, 0.58, band);
      box(M, qx, yT + 0.2, qz, ux, uz, 0.3, 0.14, 0.58, [0.5, 0.42, 0.1]); // stencilled plate
      const hx = 0.5, hz = 0.32, cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [qx + ux * hx * a + lay.sdx * hz * b, qz + uz * hx * a + lay.sdz * hz * b]);
      for (let q = 0; q < 4; q++) sa(cs[q][0], cs[q][1], cs[(q + 1) % 4][0], cs[(q + 1) % 4][1], yT + 0.7, yT - 0.2);
      kb.crate = { x: qx, z: qz, y: yT, region: kb.top };
    }
    kb.local = (x, z) => { const [ox, oz] = P(0, 0); return { s: (x - ox) * lay.sdx + (z - oz) * lay.sdz, v: (x - ox) * lay.fx + (z - oz) * lay.fz }; };

    // ---- lamps (light sources, off until the camera is inside) and fixtures ----
    for (const l of lampsAt) {
      const [x, z] = P(l.s, l.v), yc = l.yc;
      box(M, x, yc - 0.06, z, 1, 0, 0.18, 0.06, 0.18, [0.25, 0.22, 0.2]); // rose, stem and shade like the ground-floor lamps
      box(M, x, yc - 0.5, z, 1, 0, 0.03, 0.44, 0.03, [0.15, 0.14, 0.13]);
      box(LP, x, yc - 0.78, z, 1, 0, 0.36, 0.2, 0.36, [1, 0.88, 0.69]);
      const src = { x, y: yc - 0.85, z, color: C.ceilingLamp.color, intensity: C.ceilingLamp.intensity, dist: C.ceilingLamp.dist, off: true, kb: id };
      lightSources.push(src); kb.lamps.push(src);
    }

    // ---- meshes ----
    const mkMesh = (B, mat, name) => {
      if (!B.idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setIndex(B.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = name; m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.userData.lod = true; m.visible = false; m.frustumCulled = true;
      scene.add(m); kb.meshes.push(m);
    };
    mkMesh(W, mats.wall, `kb${id}:walls`); mkMesh(F, mats.wood, `kb${id}:floors`); mkMesh(M, mats.furn, `kb${id}:furniture`); mkMesh(LP, mats.lamp, `kb${id}:lamps`);
    return kb;
  }
  return api;
}
