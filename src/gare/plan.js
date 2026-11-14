import { CONFIG } from '../config.js';
import { obb } from '../architecture.js';

// =====================================================================
//  Gare de Strasbourg (v0.79.0) : pure geometry, no Three.js. Everything is derived from the real outlines in public/data/gare.json and
//  public/data/rail.json (same frame as area.json), then laid out in a local station frame:
//    u : along the tracks (toward the north-north-east), v : across, toward Place de la Gare ; origin : centre of the 1883 building
//  Outputs world-space polygons (walkable floor, zones), wall segments (collision), doors, fixed item spots, spawn points, light spots,
//  the tram stop, and the local frame for the mesh builder (build.js).
// =====================================================================

const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; } return a / 2; };

// v crossings of polygon `poly` ([[u, v]…]) with the line u = c : [min, max] or null
function scanV(poly, c) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length];
    if ((u0 - c) * (u1 - c) > 0 || u0 === u1) continue;
    const v = v0 + ((v1 - v0) * (c - u0)) / (u1 - u0);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return lo <= hi ? [lo, hi] : null;
}

export function planGare(gare, rail) {
  const G = CONFIG.gare;
  // ---------------------------------------------------------------- frame : main body of the historic building (largest stone part)
  const parts = (gare.parts || []).map((p) => ({ pts: p.pts, tags: p.tags || {} }));
  const stone = parts.filter((p) => p.tags['building:material'] === 'stone').sort((a, b) => Math.abs(area(b.pts)) - Math.abs(area(a.pts)));
  if (!stone.length) return null;
  const o = obb(stone[0].pts);
  let ux = o.ux, uz = o.uz;
  if (uz > 0) { ux = -ux; uz = -uz; } // u toward the north
  const vx = -uz, vz = ux;           // v toward the forecourt (east-south-east)
  const ox = o.cx, oz = o.cz;
  const W = (u, v) => [ox + ux * u + vx * v, oz + uz * u + vz * v];
  const L = (x, z) => [(x - ox) * ux + (z - oz) * uz, (x - ox) * vx + (z - oz) * vz];
  const loc = (pts) => pts.map(([x, z]) => L(x, z));
  const yaw = Math.atan2(ux, uz); // rotation.y that maps local +z to +u  (a mesh built with x = v, z = u : rotation.y = yaw - PI/2 … see build.js)
  const body = { u0: -o.hl, u1: o.hl, v0: -o.hw, v1: o.hw }; // track-side wall at v0, facade at v1

  // ---------------------------------------------------------------- the other parts, in the local frame
  const box = (pts) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const [u, v] of pts) a = [Math.min(a[0], u), Math.min(a[1], v), Math.max(a[2], u), Math.max(a[3], v)]; return { u0: a[0], v0: a[1], u1: a[2], v1: a[3] }; };
  const partsL = parts.map((p) => ({ ...p, loc: loc(p.pts), box: box(loc(p.pts)) }));
  const isPav = (b) => Math.abs(b.u0 + b.u1) / 2 > body.u1 + 5 && b.v1 > body.v0 && b.v0 < body.v1;
  // stone pavilions beyond the main body (north, south) and the rear annexes
  const pavilions = partsL.filter((p) => p !== partsL.find((q) => q.pts === stone[0].pts) && p.tags['building:material'] === 'stone' && isPav(p.box)).map((p) => p.box);
  const annexes = partsL.filter((p) => !p.tags['building:material'] && p.tags['building:part'] === 'yes' && Math.abs(p.box.u0 + p.box.u1) / 2 > body.u1 - 2 && p.box.v1 < body.v1 + 1 && p.box.v0 > body.v0 - 12).map((p) => p.box);
  const shedParts = partsL.filter((p) => p.tags['building:part'] === 'roof' && p.tags['roof:shape'] === 'round').map((p) => p.box).sort((a, b) => b.v1 - a.v1);
  const verPart = partsL.find((p) => /verri/i.test(p.tags.name || ''));

  // ---------------------------------------------------------------- verrière (2007) : front curve = upper envelope of the OSM outline
  const front = [];
  if (verPart) {
    const vb = verPart.box;
    for (let u = Math.ceil(vb.u0 + 0.5); u <= Math.floor(vb.u1 - 0.5); u += 2) {
      const s = scanV(verPart.loc, u);
      if (s && s[1] > body.v1 + 0.4) front.push([u, s[1]]);
    }
  }
  // smooth (3-tap) : the OSM outline has small steps where glass doors stick out
  const frontS = front.map((p, i) => (i === 0 || i === front.length - 1 ? p : [p[0], (front[i - 1][1] + 2 * p[1] + front[i + 1][1]) / 4]));
  const verU0 = frontS.length ? frontS[0][0] : -70, verU1 = frontS.length ? frontS[frontS.length - 1][0] : 70;
  // close the curve on the facade
  const verFront = [[verU0, body.v1], ...frontS, [verU1, body.v1]];
  const vFront = (u) => { for (let i = 1; i < verFront.length; i++) { const [a, va] = verFront[i - 1], [b, vb] = verFront[i]; if (u >= a && u <= b) return va + ((vb - va) * (u - a)) / (b - a || 1); } return body.v1; };

  // ---------------------------------------------------------------- platforms 1 and 2/3, tracks between them
  const plat = (ref) => (gare.platforms || []).find((p) => p.ref === ref);
  const q1 = plat('1'), q23 = plat('2;3');
  const [pu0, pu1] = G.playU;
  const edge = (poly, side) => { // [[u, v]…] every 4 m over the playable range ; side 0 : min v (west), 1 : max v (east)
    const out = [], P = loc(poly.pts);
    for (let u = pu0; u <= pu1 + 1e-6; u += 4) { const s = scanV(P, Math.min(u, pu1)); if (s) out.push([Math.min(u, pu1), s[side]]); }
    return out;
  };
  const q1W = q1 ? edge(q1, 0) : [[pu0, -21.5], [pu1, -22.5]];
  const q23E = q23 ? edge(q23, 1) : [[pu0, -30], [pu1, -30]];
  const q23W = q23 ? edge(q23, 0) : [[pu0, -42.5], [pu1, -42.5]];
  const at = (line, u) => { for (let i = 1; i < line.length; i++) { const [a, va] = line[i - 1], [b, vb] = line[i]; if (u >= a - 1e-6 && u <= b + 1e-6) return va + ((vb - va) * (u - a)) / (b - a || 1); } return line[u < line[0][0] ? 0 : line.length - 1][1]; };
  const cUs = [].concat(G.crossingU), cW = G.crossingW, cGaps = cUs.map((c) => [c - cW / 2, c + cW / 2]);

  // ---------------------------------------------------------------- hall, verrière floor, Place de la Gare (local polygons)
  const H = G.hall;
  const hall = [[H.u0, body.v0], [H.u1, body.v0], [H.u1, body.v1], [H.u0, body.v1]];
  const verFloor = [...verFront.slice().reverse()]; // facade line from verU1 to verU0 closes the ring
  const pavFront = pavilions.length ? Math.max(...pavilions.map((b) => b.v1)) : body.v1 - 5;
  const stop = (rail?.stops || []).find((s) => /gare centrale/i.test(s.name || ''));
  const stopL = stop ? L(stop.at[0], stop.at[1]) : [115, 30];
  const northEdge = stopL[0] + 7; // past the far tram platform : the regional SNCF building
  // outer ring of the forecourt (traced on the boulevard that surrounds it), then back along the station front and the verrière
  const place = [
    [northEdge, pavFront - 1.5], [northEdge, 76], [104, 80], [90, 96], [42, 122], [-46, 124], [-66, 116], [-112, 56], [-110, pavFront],
    [verU0, pavFront], ...verFront.slice(1, -1), [verU1, pavFront],
  ];
  const vBack = (u) => (u < -64.6 ? -17.1 : u > 63.0 ? -16.6 : body.v0);
  const q1Back = pu0 < -64.6 && pu1 > 63.0
    ? [[pu0, -17.1], [-64.6, -17.1], [-64.6, body.v0], [63.0, body.v0], [63.0, -16.6], [pu1, -16.6]]
    : [[pu0, body.v0], [pu1, body.v0]];
  const q1Poly = [...q1W.map(([u, v]) => [u, v]), ...q1Back.slice().reverse()];
  const q23Poly = [...q23W, ...q23E.slice().reverse()];
  const crossings = cUs.map((cU) => [[cU - cW / 2, at(q1W, cU - cW / 2) + 0.05], [cU - cW / 2, at(q23E, cU - cW / 2) - 0.05], [cU + cW / 2, at(q23E, cU + cW / 2) - 0.05], [cU + cW / 2, at(q1W, cU + cW / 2) + 0.05]]);

  // ---------------------------------------------------------------- walls (local segments) : the boundary of the walkable floor, openings excepted
  const walls = [];  // { a: [u, v], b: [u, v], h, kind }  kind : 'wall' (building), 'edge' (platform edge), 'barrier' (crowd barriers), 'glass'
  const seg = (a, b, h, kind) => walls.push({ a, b, h, kind });
  const polyline = (pts, h, kind, gaps = []) => { // gaps : [[u0, u1]] along u where no wall is laid
    for (let i = 1; i < pts.length; i++) {
      let [a, b] = [pts[i - 1], pts[i]];
      const pieces = [[a, b]];
      for (const [g0, g1] of gaps) {
        for (let k = pieces.length - 1; k >= 0; k--) {
          const [p, q] = pieces[k], lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]);
          if (g1 <= lo || g0 >= hi) continue;
          const lerp = (u) => [u, p[1] + ((q[1] - p[1]) * (u - p[0])) / (q[0] - p[0] || 1)];
          const repl = [];
          if (g0 > lo) repl.push(p[0] < q[0] ? [p, lerp(g0)] : [lerp(g0), q]);
          if (g1 < hi) repl.push(p[0] < q[0] ? [lerp(g1), q] : [p, lerp(g1)]);
          pieces.splice(k, 1, ...repl);
        }
      }
      for (const [p, q] of pieces) if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05) seg(p, q, h, kind);
    }
  };
  // hall <-> quai 1 : two doorways in the track-side wall ; hall <-> verrière : three arches of the central pavilion
  const cMid = (H.u0 + H.u1) / 2;
  const rearDoors = [[cMid - 13, cMid - 8.5], [cMid + 8.5, cMid + 13]];
  const arches = [[cMid - 9.5, cMid - 4.5], [cMid - 2.5, cMid + 2.5], [cMid + 4.5, cMid + 9.5]];
  const EDGE_H = 0.4, WALL_H = Infinity;
  polyline(q1Back, WALL_H, 'wall', rearDoors);                                             // building & annex wall along quai 1
  polyline(q1W, EDGE_H, 'edge', cGaps);                                                    // quai 1 edge (track bed beyond)
  polyline(q23E, EDGE_H, 'edge', cGaps);                                                   // quai 2/3, east edge
  polyline(q23W, EDGE_H, 'edge');                                                          // quai 2/3, west edge
  for (const cU of cUs) for (const s of [-1, 1]) seg([cU + s * cW / 2, at(q1W, cU + s * cW / 2)], [cU + s * cW / 2, at(q23E, cU + s * cW / 2)], 1.1, 'edge'); // railings of the plank footbridges
  for (const u of [pu0, pu1]) { // platform ends : barricades
    seg([u, vBack(u)], [u, at(q1W, u)], 1.3, 'barrier');
    seg([u, at(q23E, u)], [u, at(q23W, u)], 1.3, 'barrier');
  }
  seg([H.u0, body.v0], [H.u0, body.v1], WALL_H, 'wall');   // hall partitions (the wings are closed)
  seg([H.u1, body.v0], [H.u1, body.v1], WALL_H, 'wall');
  polyline([[verU0, body.v1], [verU1, body.v1]], WALL_H, 'wall', arches);                 // facade inside the verrière
  // verrière front : glass to the ground, one entrance on the forecourt (paid door)
  const entr = [-G.verriere.entranceW / 2 + cMid, G.verriere.entranceW / 2 + cMid];
  polyline(verFront.slice(1, -1), WALL_H, 'glass', [entr]);
  seg(verFront[0], verFront[1], WALL_H, 'glass'); seg(verFront[verFront.length - 2], verFront[verFront.length - 1], WALL_H, 'glass');
  // forecourt : station fronts beside the verrière, then barriers along the boulevard
  seg([verU0, pavFront], [verU0, verFront[1][1]], WALL_H, 'wall');
  seg([verU1, pavFront], [verU1, verFront[verFront.length - 2][1]], WALL_H, 'wall');
  seg([-110, pavFront], [verU0, pavFront], WALL_H, 'wall');
  seg([verU1, pavFront], [northEdge, pavFront - 1.5], WALL_H, 'wall');
  const outer = place.slice(0, 9);
  for (let i = 1; i < outer.length; i++) seg(outer[i - 1], outer[i], i === 1 ? WALL_H : 1.3, i === 1 ? 'wall' : 'barrier');

  // ---------------------------------------------------------------- doors (paid) : Quais <-> Hall (rear doorways), Hall <-> Place (verrière entrance)
  const doors = [
    { a: 'Quais', b: 'Hall de la Gare', to: 'Hall de la Gare', segs: rearDoors.map(([a, b]) => [[a, body.v0], [b, body.v0]]) },
    { a: 'Hall de la Gare', b: 'Place de la Gare', to: 'Place de la Gare', segs: [[[entr[0], vFront(entr[0])], [entr[1], vFront(entr[1])]]] },
  ];

  // ---------------------------------------------------------------- fixed items (CONFIG.sector.zones[].items of the station zones)
  // [type, id, u, v, facing φ : direction v·cos φ + u·sin φ (0 : toward the forecourt)]
  const items = {
    'Quais': [['station', null, 34, body.v0 - 0.9, Math.PI], ['wall', 'm1911', -36, body.v0 - 1.2, Math.PI], ['wall', 'shotgun', 50, body.v0 - 1.2, Math.PI]],
    'Hall de la Gare': [['station', null, H.u0 + 1.4, body.v0 + 6, Math.PI / 2], ['wall', 'mp5', H.u1 - 1.2, 2, -Math.PI / 2], ['perk', 'quickrevive', H.u1 - 2.2, body.v1 - 3.4, -Math.PI / 2], ['box', null, H.u0 + 2.4, body.v1 - 3.6, Math.PI / 2]],
    'Place de la Gare': [['station', null, stopL[0] - 9, 46, -Math.PI / 2], ['wall', 'famas', 96, pavFront + 1.2, 0], ['perk', 'staminup', -92, pavFront + 1.9, 0]],
  };

  // ---------------------------------------------------------------- spawn points : platform edges (zombies climb out of the track bed), barriers
  const spawns = [];
  const E = G.spawnEvery;
  for (let u = pu0 + 4; u <= pu1 - 4; u += E) {
    if (cUs.some((cU) => Math.abs(u - cU) < cW)) continue;
    spawns.push({ zone: 'Quais', l: [u, at(q1W, u) + 0.9] }, { zone: 'Quais', l: [u + E / 2, at(q23E, u + E / 2) - 0.9] }, { zone: 'Quais', l: [u, at(q23W, u) + 0.9] });
  }
  spawns.push({ zone: 'Hall de la Gare', l: [cMid - 6, body.v0 + 3.2] }, { zone: 'Hall de la Gare', l: [cMid + 6, body.v0 + 3.2] }); // underpass stairs (rubble)
  for (let u = verU0 + 8; u <= verU1 - 8; u += 14) if (Math.abs(u - cMid) > 12) spawns.push({ zone: 'Hall de la Gare', l: [u, body.v1 + 2.2] }); // boarded-up shops of the wings
  for (let i = 2; i < outer.length; i++) { // inside the forecourt barriers
    const [a, b] = [outer[i - 1], outer[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(len / E));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, nu = -(b[1] - a[1]) / len, nv = (b[0] - a[0]) / len; // inward normal (ring order : clockwise in u, v)
      spawns.push({ zone: 'Place de la Gare', l: [a[0] + (b[0] - a[0]) * t + nu * 1.6, a[1] + (b[1] - a[1]) * t + nv * 1.6] });
    }
  }

  // ---------------------------------------------------------------- lights (pooled point lights : realworld.js keeps the nearest ones)
  const lights = [];
  const sp = G.shed;
  for (let u = pu0 + 6; u <= pu1 - 4; u += 16) { lights.push({ l: [u, (vBack(u) + at(q1W, u)) / 2], y: 5.2, color: 0xffb060, intensity: 10, dist: 16 }); lights.push({ l: [u + 8, (at(q23E, u + 8) + at(q23W, u + 8)) / 2], y: 5.2, color: 0xffa858, intensity: 9, dist: 16 }); }
  lights.push({ l: [cMid - 12, 0], y: 9, color: 0xffc27a, intensity: 14, dist: 22 }, { l: [cMid + 12, 0], y: 9, color: 0xffc27a, intensity: 14, dist: 22 });
  for (let u = verU0 + 12; u <= verU1 - 12; u += 24) lights.push({ l: [u, body.v1 + 3], y: 1.2, color: 0x9ec8ff, intensity: 7, dist: 14 }); // cold LED uplights
  for (const [u, v] of [[-60, 70], [-20, 100], [30, 104], [70, 80], [100, 40], [60, 45], [-40, 50], [-90, 30]]) lights.push({ l: [u, v], y: 6.5, color: 0xffa040, intensity: 9, dist: 20, post: true }); // street lamps
  lights.push({ l: [stopL[0], stopL[1] + 6], y: 3, color: 0xdfe8ff, intensity: 6, dist: 10 });

  // ---------------------------------------------------------------- tram stop « Gare Centrale » (line C) and the start spot
  const stopTrack = stop ? stop.track : [W(stopL[0], stopL[1] - 22), W(stopL[0], stopL[1] + 40)];
  const start = { l: [cMid + 6, at(q1W, cMid + 6) + 4.2], yaw: 0 };

  // ---------------------------------------------------------------- world space
  const wp = (pts) => pts.map(([u, v]) => W(u, v));
  const walk = { q1: wp(q1Poly), q23: wp(q23Poly), hall: wp(hall), verriere: wp(verFloor), place: wp(place) };
  crossings.forEach((c, i) => { walk['crossing' + i] = wp(c); });
  const zones = { 'Quais': [walk.q1, walk.q23, ...crossings.map((c, i) => walk['crossing' + i])], 'Hall de la Gare': [walk.hall, walk.verriere], 'Place de la Gare': [walk.place] };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const poly of Object.values(walk)) for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const m = G.margin;
  const startW = W(...start.l);
  return {
    frame: { ox, oz, ux, uz, vx, vz, yaw }, W, L,
    body, pavilions, annexes, shed: shedParts, verFront, vFront, pavFront, northEdge,
    q1W, q23E, q23W, at, crossings, cW, hall: H, cMid, rearDoors, arches, entrance: entr,
    placeL: place, outer, walk, zones, walls, doors, items, spawns, lights,
    stop: { at: stop ? stop.at : W(...stopL), l: stopL, buffer: stop ? stop.buffer : W(stopL[0], stopL[1] - 22), track: stopTrack },
    start: { x: startW[0], z: startW[1], yaw: Math.atan2(-vx, -vz), l: start.l }, // facing the hall wall (toward +v)
    bounds: { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m },
  };
}
