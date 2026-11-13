import * as THREE from 'three';

// =====================================================================
//  GPU-only geometry. A static mesh keeps a CPU copy of every vertex array next to its GPU buffer (three.js never frees it). The city
//  (facades, interiors, relief, station, rails, ground, shadow proxies) is ~400 MB of such copies and nothing reads them after the
//  build. gpuOnly(geometry) computes the bounding volumes (frustum tests, detailCull), then asks three.js to drop each array right after
//  its first upload to the GPU. Use it only for geometry that is never edited, cloned, merged or raycast afterwards.
//  Geometries of hidden LOD meshes upload late: warmUpload() sends them at load time so the memory is released up front.
// =====================================================================

function dropArray() { this.array = null; } // `this` is the attribute (three.js calls onUploadCallback as a method)

export function gpuOnly(mesh) {
  const g = mesh.geometry;
  if (g.userData.gpuOnly) { mesh.userData.gpuOnly = true; return mesh; }
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  if (typeof location !== 'undefined' && /[?&]keepgeom/.test(location.search)) return mesh; // debug (tools/stuck-scan.mjs reads the vertex arrays)
  for (const k in g.attributes) { const a = g.attributes[k]; if (!a.isInterleavedBufferAttribute && !a.isInstancedBufferAttribute) a.onUpload(dropArray); }
  if (g.index) g.index.onUpload(dropArray);
  g.userData.gpuOnly = true; mesh.userData.gpuOnly = true;
  return mesh;
}

// Renders (1 pixel scissor, no shadow pass) every gpuOnly mesh whose arrays are still on the CPU, so that three.js uploads them
// and the callbacks free the arrays. `render` is the game's render function; returns how many meshes were sent.
// `meshes` (optional): only these meshes, shadow proxies included (a streamed tile warms its own meshes once its build is done: the hidden ones
// would otherwise keep their CPU arrays until the camera comes near, and a proxy until the shadow camera sees it).
export function warmUpload(scene, renderer, render, meshes = null) {
  const todo = [], want = (o) => o.isMesh && !o.isInstancedMesh && o.userData.gpuOnly && o.geometry.attributes.position.array;
  if (meshes) { for (const o of meshes) if (want(o)) todo.push([o, o.visible, o.frustumCulled]); }
  else scene.traverse((o) => { if (want(o) && !o.userData.shadowProxy) todo.push([o, o.visible, o.frustumCulled]); });
  if (!todo.length) return 0;
  for (const [o] of todo) { o.visible = true; o.frustumCulled = false; }
  const sm = renderer.shadowMap, auto = sm.autoUpdate, need = sm.needsUpdate;
  sm.autoUpdate = false; sm.needsUpdate = false;
  renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
  render();
  renderer.setScissorTest(false);
  sm.autoUpdate = auto; sm.needsUpdate = need;
  for (const [o, v, f] of todo) { o.visible = v; o.frustumCulled = f; }
  return todo.length;
}
