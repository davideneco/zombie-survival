import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { hash32 } from '../rng.js';
import { contact } from '../contact.js';

// =====================================================================
//  Set dressing of the district: wrecks parked at the kerb of the roads, a barricade closing the bridge head at the arrival point.
//  `planDress` is a pure deterministic scan (hash of the road id, no `rnd`): the same list on every peer. `buildDress` makes the district's OWN instanced
//  meshes from the shared prop library (props.lib: same geometries and materials as the island's props, so no new shader program), culled by their
//  bounding sphere, plus the collision shapes. Visual + collision only; nothing here is networked.
// =====================================================================

// footprint of each prop: collision box [w, d, h] (rot 0 = along local x) or circle r
const SHAPE = { car: { box: [4.3, 1.8, 1.5] }, jersey: { box: [2.4, 0.6, 0.85] }, sandbags: { box: [2.0, 0.7, 0.75] }, crate: { box: [1.1, 1.1, 1.0] } };

// D: CONFIG.districts.krutenau; free(x, z, r): is the ground free of footprints / trees within r; entry, keep: [{ x, z, r }] spots to leave alone
export function planDress({ roads, D, free, entry, keep }) {
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
  return list;
}

// footprint in world space for the blocked grid: [{ x, z, w, d, rot }] (rot = collision convention, w along (cos, sin))
export function dressBoxes(list) {
  return list.map((o) => { const [w, d] = SHAPE[o.type].box; return { x: o.x, z: o.z, w, d, rot: -o.rot }; });
}

export function buildDress(list, { props, scene, collision }) {
  const P = props.lib, meshes = [], byType = new Map();
  for (const o of list) { (byType.get(o.type) || byType.set(o.type, []).get(o.type)).push(o); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  for (const [type, items] of byType) {
    for (const [pi, [geo, mat]] of P[type].entries()) {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((o, i) => {
        m4.compose(p.set(o.x, o.y || 0, o.z), q.setFromEuler(e.set(0, o.rot, 0)), s); im.setMatrixAt(i, m4);
        if (mat === props.M.carPaint) im.setColorAt(i, col.set(o.color ?? 0x2a2826));
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = pi === 0; im.receiveShadow = true; im.name = 'krutenau:' + type;
      scene.add(im); meshes.push(im);
    }
  }
  for (const o of list) {
    const sh = SHAPE[o.type]; contact.addProp(o.type, o.x, o.z, o.rot, 1, o.y || 0);
    if ((o.y || 0) > 0.2) continue; // stacked on something: no extra collision
    const [w, d, h] = sh.box; collision.addBox(o.x, o.z, w, d, -o.rot, h, -Infinity, 'prop', false);
  }
  return meshes;
}
