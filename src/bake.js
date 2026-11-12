import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// =====================================================================
//  Build-time batching helpers for hand-built models (machines, gates, weapons): fewer draw calls, same look.
// =====================================================================

// Merges the direct child meshes of `group` that share a material into one mesh per material (local transforms baked in).
// Meshes in `keep` (animated or looked up by code later), instanced meshes, multi-material meshes and materials used by a single
// mesh are left untouched. Returns the new merged meshes.
export function bakeGroup(group, keep = [], dispose = true) { // dispose false: the source geometries are shared (cached) by other meshes
  const skip = new Set(keep), byMat = new Map(), made = [];
  for (const o of group.children) {
    if (!o.isMesh || o.isInstancedMesh || skip.has(o) || Array.isArray(o.material)) continue;
    let l = byMat.get(o.material); if (!l) byMat.set(o.material, l = []); l.push(o);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((o) => { o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); });
    const indexed = geos.every((g) => g.index);
    const merged = mergeGeometries(indexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    for (const g of geos) g.dispose();
    if (!merged) continue; // incompatible attributes: leave the originals
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = list.some((o) => o.castShadow); m.receiveShadow = list.some((o) => o.receiveShadow);
    for (const o of list) { group.remove(o); if (dispose) o.geometry.dispose(); }
    Object.assign(m.userData, list[0].userData); // material-level flags (glow) carry over
    group.add(m); made.push(m);
  }
  return made;
}

// Re-sorts the faces of a BoxGeometry so that faces sharing a material index form ONE contiguous group (one draw call per material
// instead of one per face). faceMat = material index of the faces +x, -x, +y, -y, +z, -z (the BoxGeometry order).
export function boxMaterialGroups(geo, faceMat) {
  const src = geo.index.array, out = new src.constructor(src.length), nMat = Math.max(...faceMat) + 1;
  let w = 0;
  geo.clearGroups();
  for (let m = 0; m < nMat; m++) {
    const start = w;
    for (let f = 0; f < 6; f++) if (faceMat[f] === m) for (let i = 0; i < 6; i++) out[w++] = src[f * 6 + i];
    if (w > start) geo.addGroup(start, w - start, m);
  }
  geo.index.array.set(out);
  geo.index.needsUpdate = true;
  return geo;
}
