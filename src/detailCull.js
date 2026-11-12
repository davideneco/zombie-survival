import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Detail culling: objects registered here are hidden once they are further than the fog lets them be seen
//  (CONFIG.graphics.detailCull: fog / density metres). Checked by the world every 0.25 s, island area only.
//  Points (machines, stations, wall boards) and axis-aligned XZ boxes (merged city tiles, gate chunks) are supported.
// =====================================================================

const items = []; // { obj, x0, z0, x1, z1, y1, box } ; a point is a degenerate box grown by its radius
const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), tmpBox = new THREE.Box3();

export const detailCull = {
  // maxDist: optional own limit (m) below the fog distance, for small parts
  addPoint(obj, radius = 3, maxDist = Infinity, at = obj) { const p = at.position; // at: object whose position locates it (a merged child sits at its group's origin)
    items.push({ obj, x0: p.x - radius, z0: p.z - radius, x1: p.x + radius, z1: p.z + radius, box: false, max: maxDist }); },
  // mesh whose geometry is already in world space (merged tiles)
  addMesh(mesh) {
    const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    mesh.frustumCulled = false; // tested here against the tight box (three.js would use the much larger bounding sphere)
    items.push({ obj: mesh, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, y0: b.min.y - 4, y1: b.max.y + 4, box: true, max: Infinity });
  },
  remove(obj) { const i = items.findIndex((it) => it.obj === obj); if (i >= 0) { items.splice(i, 1); } },
  distance(density) {
    const C = CONFIG.graphics.detailCull;
    return Math.min(C.max, Math.max(C.min, C.fog / Math.max(density, 0.001)));
  },
  // camera: when given, the box entries are also tested against its frustum (every frame, 1-2 µs per entry)
  update(px, pz, density, camera = null) {
    const d = detailCull.distance(density), d2 = d * d;
    if (camera) { camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dx = px < it.x0 ? it.x0 - px : px > it.x1 ? px - it.x1 : 0, dz = pz < it.z0 ? it.z0 - pz : pz > it.z1 ? pz - it.z1 : 0;
      const dd = dx * dx + dz * dz;
      let vis = dd < d2 && dd < it.max * it.max;
      if (vis && camera && it.box) { tmpBox.min.set(it.x0 - 6, it.y0, it.z0 - 6); tmpBox.max.set(it.x1 + 6, it.y1, it.z1 + 6); vis = frustum.intersectsBox(tmpBox); } // (6 m margin: the camera may move after this call)
      if (it.obj.visible !== vis) it.obj.visible = vis;
    }
  },
  count: () => items.length,
};
