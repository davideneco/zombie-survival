import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// =====================================================================
//  Mesh optimization wrapper (meshoptimizer WASM simplifier).
//  Welds duplicate vertices on dense procedural geometries, runs error-bounded
//  triangle simplification, compacts unused vertices, and returns an indexed
//  BufferGeometry with reduced vertex & triangle counts.
// =====================================================================

let ready = false;
let initPromise = null;

export function initMeshOpt() {
  if (initPromise) return initPromise;
  if (!MeshoptSimplifier?.supported) {
    initPromise = Promise.resolve(false);
    return initPromise;
  }
  initPromise = MeshoptSimplifier.ready
    .then(() => { ready = true; return true; })
    .catch(() => false);
  return initPromise;
}

export function isMeshOptReady() { return ready; }

// Ensure a BufferGeometry has an index buffer (welds matching vertices if needed).
export function ensureIndexed(geo) {
  if (geo.index) return geo;
  const g = mergeVertices(geo, 1e-4);
  if (g.index) return g;
  const count = g.attributes.position.count;
  const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/**
 * Simplify a BufferGeometry using meshoptimizer if it exceeds `minTris`.
 * Falls back cleanly to the original geometry when WASM is unavailable or gain < 10%.
 */
export function simplifyGeo(geo, ratio = 0.45, error = 0.02, minTris = 200) {
  if (!ready || !geo?.attributes?.position) return geo;
  const rawTris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  if (rawTris < minTris) return geo;

  let work = geo;
  let owned = false;
  if (!work.index) {
    work = mergeVertices(geo, 1e-4);
    owned = true;
  }
  const idxAttr = work.index;
  if (!idxAttr || idxAttr.count < minTris * 3) {
    if (owned) work.dispose();
    return geo;
  }

  const posAttr = work.attributes.position;
  const idx32 = idxAttr.array instanceof Uint32Array ? idxAttr.array : new Uint32Array(idxAttr.array);
  const targetCount = Math.max(24, Math.floor((idx32.length / 3) * ratio) * 3);

  const [simplified] = MeshoptSimplifier.simplify(
    idx32,
    posAttr.array,
    posAttr.itemSize,
    targetCount,
    error,
    ['LockBorder']
  );

  if (!simplified || simplified.length >= idx32.length * 0.9) {
    if (owned) work.dispose();
    return geo;
  }

  const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
  if (unique < 3) {
    if (owned) work.dispose();
    return geo;
  }

  const out = new THREE.BufferGeometry();
  const srcCount = posAttr.count;
  for (const name of Object.keys(work.attributes)) {
    const src = work.attributes[name];
    if (src.isInterleavedBufferAttribute) continue;
    const itemSize = src.itemSize;
    const dst = new src.array.constructor(unique * itemSize);
    for (let i = 0; i < srcCount; i++) {
      const ni = remap[i];
      if (ni === 0xffffffff) continue;
      const sOff = i * itemSize, dOff = ni * itemSize;
      for (let k = 0; k < itemSize; k++) dst[dOff + k] = src.array[sOff + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, itemSize, src.normalized));
  }

  const finalIdx = unique <= 65535 ? new Uint16Array(simplified) : simplified;
  out.setIndex(new THREE.BufferAttribute(finalIdx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();

  if (owned) work.dispose();
  geo.dispose();
  return out;
}
