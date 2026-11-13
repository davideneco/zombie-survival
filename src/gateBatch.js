import * as THREE from 'three';
import { gpuOnly } from './gpuOnly.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { detailCull } from './detailCull.js';

// =====================================================================
//  Gate batching: the paid-door barricades (props.gate + their price signs) were 5 meshes each, drawn one by one.
//  Their geometry is baked in world space and merged per material and per 160 m chunk: a chunk draws iron, wood and hazard in
//  3 calls whatever the number of gates, plus one call per door sign material. A door that is bought removes its pieces and the
//  chunks it touched are rebuilt (rare event, a few ms).
// =====================================================================

export function createGateBatch(scene, tile = 320) {
  const chunks = new Map(); // key -> { parts: Map(material -> [{ door, geo }]), meshes: [] }
  const chunkOf = (x, z) => {
    const k = `${Math.floor(x / tile)},${Math.floor(z / tile)}`;
    let c = chunks.get(k); if (!c) chunks.set(k, c = { parts: new Map(), meshes: [], dirty: true });
    return c;
  };
  const rebuild = (c) => {
    for (const m of c.meshes) { scene.remove(m); detailCull.remove(m); m.geometry.dispose(); }
    c.meshes.length = 0; c.dirty = false;
    for (const [mat, list] of c.parts) {
      const geos = list.filter((p) => !p.door.open).map((p) => p.geo);
      if (!geos.length) continue;
      const g = geos.length > 1 ? mergeGeometries(geos, false) : geos[0].clone();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      gpuOnly(m); m.name = 'gates'; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      scene.add(m); c.meshes.push(m); detailCull.addMesh(m);
    }
  };
  return {
    // Takes over a gate group (already placed in the scene, with its signs): bakes its meshes into the chunk of its centre
    take(door, group) {
      group.updateMatrixWorld(true);
      const c = chunkOf(group.position.x, group.position.z);
      group.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') geo.deleteAttribute(a); // same attribute set for every merge
        if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
        let l = c.parts.get(o.material); if (!l) c.parts.set(o.material, l = []);
        l.push({ door, geo });
        if (!door.gateChunks) door.gateChunks = new Set();
        door.gateChunks.add(c);
        o.geometry.dispose();
      });
      group.parent?.remove(group);
      door.batched = true;
    },
    build() { for (const c of chunks.values()) if (c.dirty) rebuild(c); },
    // the door was opened: drop its pieces
    open(door) { for (const c of door.gateChunks || []) rebuild(c); },
  };
}
