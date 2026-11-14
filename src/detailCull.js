import * as THREE from 'three';
import Flatbush from 'flatbush';
import { CONFIG } from './config.js';

// =====================================================================
//  Detail culling: objects registered here are hidden once they are further than the fog lets them be seen
//  (CONFIG.graphics.detailCull: fog / density metres). Checked by the world every frame, island area only.
//  Points (machines, stations, wall boards) and axis-aligned XZ boxes (merged city tiles, gate chunks) are supported.
//  Indexed via Flatbush (packed Hilbert R-tree) so per-frame queries only inspect nearby candidates.
// =====================================================================

const items = []; // { obj, x0, z0, x1, z1, y0, y1, box, max }
const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), tmpBox = new THREE.Box3();
let index = null, dirty = false, seen = new Uint32Array(0), stamp = 0;
const active = []; // indices currently visible

function rebuildIndex() {
  dirty = false;
  active.length = 0;
  if (!items.length) { index = null; return; }
  const tree = new Flatbush(items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    tree.add(it.x0, it.z0, it.x1, it.z1);
    if (it.obj.visible) active.push(i);
  }
  tree.finish();
  index = tree;
  if (seen.length < items.length) seen = new Uint32Array(items.length);
  else seen.fill(0);
  stamp = 0;
}

export const detailCull = {
  // maxDist: optional own limit (m) below the fog distance, for small parts
  addPoint(obj, radius = 3, maxDist = Infinity, at = obj) {
    const p = at.position; // at: object whose position locates it (a merged child sits at its group's origin)
    items.push({ obj, x0: p.x - radius, z0: p.z - radius, x1: p.x + radius, z1: p.z + radius, y0: 0, y1: 0, box: false, max: maxDist });
    dirty = true;
  },
  // mesh whose geometry is already in world space (merged tiles)
  addMesh(mesh) {
    const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    mesh.frustumCulled = false; // tested here against the tight box (three.js would use the much larger bounding sphere)
    items.push({ obj: mesh, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, y0: b.min.y - 4, y1: b.max.y + 4, box: true, max: Infinity });
    dirty = true;
  },
  remove(obj) {
    const i = items.findIndex((it) => it.obj === obj);
    if (i >= 0) { items.splice(i, 1); dirty = true; }
  },
  distance(density) {
    const C = CONFIG.graphics.detailCull;
    return Math.min(C.max, Math.max(C.min, C.fog / Math.max(density, 0.001)));
  },
  // camera: when given, the box entries are also tested against its frustum (every frame, O(log N + k) via Flatbush)
  update(px, pz, density, camera = null) {
    if (!items.length) return;
    if (dirty || !index) rebuildIndex();
    const d = detailCull.distance(density), d2 = d * d;
    if (camera) { camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); }
    stamp = (stamp + 1) >>> 0;
    if (stamp === 0) { seen.fill(0); stamp = 1; }
    const hits = index.search(px - d, pz - d, px + d, pz + d);
    for (let i = 0; i < hits.length; i++) seen[hits[i]] = stamp;
    for (let i = 0; i < active.length; i++) {
      const idx = active[i];
      if (seen[idx] !== stamp && items[idx].obj.visible) items[idx].obj.visible = false;
    }
    active.length = 0;
    for (let i = 0; i < hits.length; i++) {
      const idx = hits[i], it = items[idx];
      const dx = px < it.x0 ? it.x0 - px : px > it.x1 ? px - it.x1 : 0, dz = pz < it.z0 ? it.z0 - pz : pz > it.z1 ? pz - it.z1 : 0;
      const dd = dx * dx + dz * dz;
      let vis = dd < d2 && dd < it.max * it.max;
      if (vis && camera && it.box) { tmpBox.min.set(it.x0 - 6, it.y0, it.z0 - 6); tmpBox.max.set(it.x1 + 6, it.y1, it.z1 + 6); vis = frustum.intersectsBox(tmpBox); } // (6 m margin: the camera may move after this call)
      if (it.obj.visible !== vis) it.obj.visible = vis;
      if (vis) active.push(idx);
    }
  },
  count: () => items.length,
};
