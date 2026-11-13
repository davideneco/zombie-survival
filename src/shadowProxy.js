import * as THREE from 'three';
import { gpuOnly } from './gpuOnly.js';

// =====================================================================
//  Shadow proxies: the shadow pass draws one merged, position-only mesh per world tile instead of every material mesh of the tile
//  (the city tiles have ~30 materials each, which cost ~75 draw calls in the shadow pass alone). A proxy is hidden from the main
//  pass (visible = false) and only switched on while the shadow map renders (see installShadowProxies). The caster meshes it
//  replaces set castShadow = false. Same triangles, a fraction of the draw calls.
// =====================================================================

const proxies = [];
const MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false }); // double sided like the facade materials it replaces

// pos: flat xyz array, idx: triangle indices (plain arrays or typed arrays). area: 'island' | 'gare' (which local area draws it)
export function addShadowProxy(parent, pos, idx, area = 'island') {
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, MAT);
  gpuOnly(m); m.name = 'shadowProxy'; m.castShadow = true; m.receiveShadow = false; m.visible = false; m.matrixAutoUpdate = false;
  m.userData.lod = true; m.userData.noTerrain = true; m.userData.shadowProxy = area; // lod : the shader precompile keeps it hidden
  parent.add(m); proxies.push(m);
  return m;
}

// Accumulates the triangles of several buckets (per tile) into one proxy
export function proxyBucket() {
  return { pos: [], idx: [], add(pos, idx) { const o = this.pos.length / 3; for (let i = 0; i < pos.length; i++) this.pos.push(pos[i]); for (let i = 0; i < idx.length; i++) this.idx.push(idx[i] + o); } };
}

// Wraps renderer.shadowMap.render: the proxies of the local area are visible for the shadow pass only
export function installShadowProxies(renderer, getArea) {
  const sm = renderer.shadowMap, orig = sm.render;
  sm.render = function (lights, scene, camera) {
    const area = getArea();
    for (let i = 0; i < proxies.length; i++) proxies[i].visible = proxies[i].userData.shadowProxy === area;
    orig.call(this, lights, scene, camera);
    for (let i = 0; i < proxies.length; i++) proxies[i].visible = false;
  };
}
