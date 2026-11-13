import * as THREE from 'three';
import { gpuOnly } from './gpuOnly.js';

// =====================================================================
//  Ground chunks: the tessellated ground plane (~450 k triangles for the whole island) used to be ONE mesh, drawn in full every
//  frame. It is split into square chunks (CONFIG.graphics.groundChunk metres), indexed (a tessellated non-indexed plane stores every
//  vertex ~6 times), each with its own bounding sphere, so the frustum test and the fog distance keep only the few chunks around
//  the camera. All chunks share the ground material (the ground shader patch and the terrain displacement apply to it unchanged).
// =====================================================================

// geo: non-indexed (position xyz, uv, normal) in the ground's local frame (x, y), size: chunk edge in metres.
// Returns a Group holding the chunk meshes; it copies the transform of `mesh`, which the caller removes from the scene.
export function chunkGround(mesh, size, pad = 3) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, P = g.attributes.position, U = g.attributes.uv, N = g.attributes.normal;
  const bins = new Map();
  const n = P.count;
  for (let t = 0; t < n; t += 3) {
    const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3, cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3;
    const key = Math.floor(cx / size) * 4096 + Math.floor(cy / size);
    let b = bins.get(key); if (!b) bins.set(key, b = []);
    b.push(t);
  }
  const group = new THREE.Group();
  group.name = 'groundChunks';
  group.position.copy(mesh.position); group.rotation.copy(mesh.rotation); group.scale.copy(mesh.scale);
  const q = 32; // quantisation of the vertex key (1/32 m)
  for (const tris of bins.values()) {
    const vid = new Map(), pos = [], uv = [], nor = [], idx = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const x = P.getX(t + k), y = P.getY(t + k), z = P.getZ(t + k);
        const key = Math.round((x + 4096) * q) * 524288 + Math.round((y + 4096) * q);
        let i = vid.get(key);
        if (i === undefined) {
          i = pos.length / 3; vid.set(key, i);
          pos.push(x, y, z);
          if (U) uv.push(U.getX(t + k), U.getY(t + k));
          if (N) nor.push(N.getX(t + k), N.getY(t + k), N.getZ(t + k));
        }
        idx.push(i);
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (U) cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (N) cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else cg.computeVertexNormals();
    cg.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    cg.computeBoundingSphere();
    cg.boundingSphere.radius += pad; // the terrain shader lifts the vertices (relief of a few decimetres)
    const m = new THREE.Mesh(cg, mesh.material);
    gpuOnly(m); m.receiveShadow = true; m.name = 'groundChunk';
    group.add(m);
  }
  return group;
}
