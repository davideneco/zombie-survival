import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { hash32 } from '../rng.js';
import { contact } from '../contact.js';
import { lampGeometries } from '../tiles.js';

// =====================================================================
//  Set dressing of the district: wrecks parked at the kerb of the roads, a barricade closing the bridge head at the arrival point.
//  `planDress` is a pure deterministic scan (hash of the road id, no `rnd`): the same list on every peer. `buildDress` makes the district's OWN instanced
//  meshes from the shared prop library (props.lib: same geometries and materials as the island's props, so no new shader program), culled by their
//  bounding sphere, plus the collision shapes. Visual + collision only; nothing here is networked.
// =====================================================================

// footprint of each prop: collision box [w, d, h] (rot 0 = along local x) or circle r
const SHAPE = { car: { box: [4.3, 1.8, 1.5] }, jersey: { box: [2.4, 0.6, 0.85] }, sandbags: { box: [2.0, 0.7, 0.75] }, crate: { box: [1.1, 1.1, 1.0] } };

// D: CONFIG.districts.krutenau; free(x, z, r): is the ground free of footprints / trees within r; entry, keep: [{ x, z, r }] spots to leave alone
export function planDress({ roads, D, free, entry, keep, lamps = [] }) {
  const C = D.dress, list = [];
  const clear = (x, z, r) => keep.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);
  // entry checkpoint: offsets from the arrival point, the player faces +x (rot = mesh heading, radians)
  for (const [type, dx, dz, rot, y = 0] of C.entry) {
    const x = entry.x + dx, z = entry.z + dz;
    if (!free(x, z, 1.1)) continue;
    list.push({ type, x, z, rot, y, color: null });
  }
  // wrecks along the kerb: walk each asphalt road, one candidate every `carEvery` m (phase and side from the road id)
  const cars = [];
  const ok = (r) => !r.bridge && !r.area && C.carRoads.includes(r.hw);
  for (const r of roads.filter(ok).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const w = r.w || CONFIG.world.surf.width[r.hw] || 6, h = hash32(r.id.length, r.id.charCodeAt(r.id.length - 1), r.id.charCodeAt(r.id.length - 2) ^ 77);
    let s = 0, next = (h % 1000) / 1000 * C.carEvery;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      while (next < s + len) {
        const t = next - s; next += C.carEvery;
        const side = (hash32(Math.round(ax * 10), Math.round(az * 10), 5 + Math.round(t)) & 1) ? 1 : -1, off = Math.max(0, w / 2 - C.kerb);
        const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
        const rot = Math.atan2(-dz, dx) + ((h >> 3) & 1 ? Math.PI : 0);
        // the whole body must stand on free ground (5 points along its axis) and away from the entry / items
        let fine = clear(x, z, 3);
        for (let k = -2; k <= 2 && fine; k++) fine = free(x + dx * k * 1.0, z + dz * k * 1.0, 1.15);
        if (fine && cars.every((c) => Math.hypot(c.x - x, c.z - z) > C.carGap)) cars.push({ type: 'car', x, z, rot, y: 0, color: C.wreckColors[hash32(Math.round(x * 10), Math.round(z * 10), 9) % C.wreckColors.length] });
      }
      s += len;
    }
  }
  list.push(...cars.slice(0, C.cars));
  // street lamps: alternate sides along the roads, never within `skip` m of an OSM lamp, `gap` m apart, on free ground
  const L = C.lamps, made = [];
  for (const r of roads.filter((q) => !q.bridge && !q.area && L.roads.includes(q.hw)).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const w = r.w || CONFIG.world.surf.width[r.hw] || 6, h = hash32(r.id.length, r.id.charCodeAt(r.id.length - 1), r.id.charCodeAt(r.id.length - 2) ^ 31);
    let s = 0, next = (h % 1000) / 1000 * L.every, n = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      while (next < s + len) {
        const t = next - s; next += L.every; const side = n++ % 2 ? 1 : -1, off = w / 2 + L.out;
        const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
        if (!free(x, z, 0.5) || lamps.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < L.skip) || made.some((m) => Math.hypot(m.x - x, m.z - z) < L.gap)) continue;
        if (list.some((o) => o.type === 'car' && Math.hypot(o.x - x, o.z - z) < 3)) continue;
        made.push({ type: 'lamp', x, z, rot: 0, y: 0, color: null });
      }
      s += len;
    }
  }
  list.push(...made);
  return list;
}

// footprint in world space for the blocked grid: [{ x, z, w, d, rot }] (rot = collision convention, w along (cos, sin))
export function dressBoxes(list) {
  return list.filter((o) => o.type !== 'lamp').map((o) => { const [w, d] = SHAPE[o.type].box; return { x: o.x, z: o.z, w, d, rot: -o.rot }; });
}

export function buildDress(list, { props, scene, collision, lamps, lightSources }) {
  const meshes = [], byType = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const o of list) {
    if (o.type === 'lamp') continue;
    let arr = byType.get(o.type);
    if (!arr) byType.set(o.type, arr = []);
    arr.push({
      m: new THREE.Matrix4().compose(p.set(o.x, o.y || 0, o.z), q.setFromEuler(e.set(0, o.rot, 0)), s),
      c: o.color != null ? new THREE.Color(o.color) : null,
    });
  }
  meshes.push(...props.emit(byType, scene, 'krutenau:', (_type, pi) => pi === 0, 0x2a2826));
  // lamps: the same two instanced meshes as the tiles' lamps (shared materials: no new program) + a light SOURCE each (the 8-light pool lights the nearest ones only)
  const lampList = list.filter((o) => o.type === 'lamp');
  if (lampList.length && lamps) {
    const G = lampGeometries(), LL = CONFIG.world.lampLight;
    const poles = new THREE.InstancedMesh(G.pole, lamps.poleMat, lampList.length), lanterns = new THREE.InstancedMesh(G.lantern, lamps.lampMat, lampList.length);
    lampList.forEach((o, i) => { m4.makeTranslation(o.x, 0, o.z); poles.setMatrixAt(i, m4); lanterns.setMatrixAt(i, m4); collision.addCircle(o.x, o.z, 0.15, 4.2); lightSources.push({ x: o.x, y: LL.y, z: o.z, color: LL.color, intensity: LL.intensity, dist: LL.dist }); });
    for (const m of [poles, lanterns]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.name = 'krutenau:lamps'; scene.add(m); meshes.push(m); }
  }
  for (const o of list) {
    if (o.type === 'lamp') continue;
    const sh = SHAPE[o.type]; contact.addProp(o.type, o.x, o.z, o.rot, 1, o.y || 0);
    if ((o.y || 0) > 0.2) continue; // stacked on something: no extra collision
    const [w, d, h] = sh.box; collision.addBox(o.x, o.z, w, d, -o.rot, h, -Infinity, 'prop', false);
  }
  return meshes;
}
