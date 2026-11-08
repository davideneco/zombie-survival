import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Scenery of the line C branch ridden by the transfer tram (v0.83.0) : the stretch between the rails drawn by the station (Place de la Gare)
//  and the island's B / C / F track. Neither area models it : grooved rails in a concrete bed, catenary poles and wire, the bridge deck over the
//  Ill (sandstone, parapets with a chamfered coping), the platform of the passed stop (Faubourg de Saverne : slab, shelter, lit name totem).
//  Heights come from the route (route.heightAt : terrain, bridge deck) ; nothing here is displaced by the terrain shader (userData.noTerrain).
//  Two groups : `near` (the part seen from the station's forecourt) and `far` (seen only from the island side) : transfer.js shows the one(s)
//  of the drawn area. About 12 draw calls in all, no shadows cast, no collision (nobody walks there : it lies outside every zone).
// =====================================================================

const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// route : buildTransferRoute() ; collision : world collision (poles keep off walls) ; passStop : { name, s } ; split : s of the near / far border
export function buildTransferScene({ route, collision, passStop, split }) {
  const S = CONFIG.transfer.scene, tr = route.track, H = route.heightAt, o = {}, o2 = {};
  const near = new THREE.Group(), far = new THREE.Group();
  near.name = 'transfer:sceneNear'; far.name = 'transfer:sceneFar';
  near.userData.noTerrain = far.userData.noTerrain = true;
  const s0 = route.sRailsEnd, s1 = route.sBcf;
  const groupOf = (s) => (s < split ? near : far);
  const meshes = [];
  const put = (geo, mat, group, name) => { const m = new THREE.Mesh(geo, mat); m.name = 'transfer:' + name; m.castShadow = false; m.receiveShadow = true; m.userData.noTerrain = true; group.add(m); meshes.push(m); return m; };

  // ---------------------------------------------------------------- materials (PBR, gritty)
  const concTex = canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#77746c'; x.fillRect(0, 0, w, h); for (let k = 0; k < 900; k++) { const g = 95 + Math.random() * 40; x.fillStyle = `rgba(${g},${g - 3},${g - 9},0.35)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  const stoneTex = canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#8a7c68'; x.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const g = 120 + Math.random() * 30; x.fillStyle = `rgb(${g},${g - 14},${g - 32})`; x.fillRect(c * 43 + (r % 2) * 20 + 1, r * 32 + 1, 41, 30); }
    for (let k = 0; k < 120; k++) { x.fillStyle = `rgba(40,36,30,${0.1 + Math.random() * 0.2})`; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 4 + Math.random() * 18); }
  });
  const concrete = new THREE.MeshStandardMaterial({ map: concTex, color: 0x9a978f, roughness: 0.88, metalness: 0.02 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xa4abb2, roughness: 0.4, metalness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.6, metalness: 0.55 });
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xb0a690, roughness: 0.84, metalness: 0.02 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.5, metalness: 0.6 });

  // ---------------------------------------------------------------- rails : concrete bed + two grooved rails, one InstancedMesh per group (2 m elements)
  {
    const EL = 2, G = 1.435;
    const bed = new RoundedBoxGeometry(EL, 0.06, 2.9, 1, 0.025); bed.translate(0, 0.0, 0);
    const rails = merge([-1, 1].map((sg) => { const g = new THREE.BoxGeometry(EL, 0.05, 0.07); g.translate(0, 0.045, sg * G / 2); return g; }));
    const lists = { near: [], far: [] };
    for (let s = s0; s + 1e-6 < s1; s += EL) lists[groupOf(s) === near ? 'near' : 'far'].push(s);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [key, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const g = key === 'near' ? near : far;
      const ims = [new THREE.InstancedMesh(bed, concrete, list.length), new THREE.InstancedMesh(rails, railMat, list.length)];
      list.forEach((s, k) => {
        const e = Math.min(s1, s + EL);
        tr.at(s, o); tr.at(e, o2);
        const dx = o2.x - o.x, dz = o2.z - o.z, l = Math.hypot(dx, dz) || 1;
        q.setFromAxisAngle(up, Math.atan2(-dz, dx));
        m4.compose(p.set((o.x + o2.x) / 2, (H(s) + H(e)) / 2 + 0.012, (o.z + o2.z) / 2), q, sc.set(l / EL + 0.02, 1, 1));
        for (const im of ims) im.setMatrixAt(k, m4);
      });
      for (const im of ims) { im.name = 'transfer:rails'; im.castShadow = false; im.receiveShadow = true; im.userData.noTerrain = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im); meshes.push(im); }
    }
  }

  // ---------------------------------------------------------------- catenary : poles (alternating sides, kept off the walls) and the contact wire
  {
    const arm = S.poleOffset, ph = S.poleHeight;
    const pole = merge([
      new THREE.CylinderGeometry(0.08, 0.11, ph, 10).translate(0, ph / 2, 0),
      new THREE.CylinderGeometry(0.16, 0.19, 0.5, 10).translate(0, 0.25, 0),
      new THREE.CylinderGeometry(0.045, 0.045, arm, 6).rotateZ(Math.PI / 2).translate(arm / 2, ph - 0.3, 0),
      new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6).rotateZ(Math.PI / 2 - 0.5).translate(arm * 0.28, ph - 0.62, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 0.28, 8).translate(arm, ph - 0.45, 0),
    ]);
    const spots = { near: [], far: [] };
    let k = 0;
    for (let s = s0 + 6; s < s1 - 4; s += S.poleEvery, k++) {
      tr.at(s, o);
      if (route.bridges.some((b) => s > b.s0 - 2 && s < b.s1 + 2)) continue; // (none on the bridge : the wire hangs from its parapets)
      for (const side of [k % 2 ? 1 : -1, k % 2 ? -1 : 1]) {
        const nx = -o.tz * side, nz = o.tx * side, x = o.x + nx * arm, z = o.z + nz * arm;
        if (collision && collision.rayHit(o.x, 1, o.z, nx, 0, nz, arm + 0.6) < arm + 0.5) continue; // a wall before the pole spot : try the other side
        spots[groupOf(s) === near ? 'near' : 'far'].push({ x, y: H(s), z, a: Math.atan2(-(o.z - z), o.x - x) });
        break;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const [key, list] of Object.entries(spots)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(pole, steel, list.length); im.name = 'transfer:poles'; im.castShadow = false; im.userData.noTerrain = true;
      list.forEach((sp, i) => { q.setFromAxisAngle(up, sp.a); m4.compose(p.set(sp.x, sp.y, sp.z), q, one); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      (key === 'near' ? near : far).add(im); meshes.push(im);
    }
    // contact wire : thin square tube every 6 m
    const wires = { near: [], far: [] };
    let prev = null;
    for (let s = s0; s <= s1 + 1e-6; s += 6) {
      tr.at(Math.min(s, s1), o);
      const cur = new THREE.Vector3(o.x, H(s) + S.wire, o.z);
      if (prev) {
        const d = cur.clone().sub(prev), len = d.length(), g = new THREE.BoxGeometry(len, 0.035, 0.035);
        g.applyMatrix4(new THREE.Matrix4().compose(prev.clone().add(cur).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
        wires[groupOf(s) === near ? 'near' : 'far'].push(g);
      }
      prev = cur;
    }
    for (const [key, list] of Object.entries(wires)) if (list.length) put(merge(list), wireMat, key === 'near' ? near : far, 'wire').receiveShadow = false;
  }

  // ---------------------------------------------------------------- bridge over the Ill : a sandstone deck swept along the route, parapets with a coping
  for (const br of route.bridges) {
    const W = S.bridgeWidth / 2;
    // cross-section (w across, y up, relative to the rail top) : deck edge, parapet with a chamfered coping, the arch spandrel under it
    const prof = [[-W, -1.1], [-W, 0.95], [-W + 0.08, 1.05], [-W + 0.42, 1.05], [-W + 0.5, 0.95], [-W + 0.5, 0.05], [W - 0.5, 0.05], [W - 0.5, 0.95], [W - 0.42, 1.05], [W - 0.08, 1.05], [W, 0.95], [W, -1.1]];
    const sA = br.s0 - 3, sB = br.s1 + 3, steps = Math.max(2, Math.ceil((sB - sA) / 1.5));
    const pos = [], uv = [], idx = [];
    const rings = [];
    for (let i = 0; i <= steps; i++) {
      const s = sA + ((sB - sA) * i) / steps; tr.at(s, o);
      const sag = 0.9 * Math.sin(Math.PI * i / steps); // the spandrel under the deck deepens toward mid-span
      rings.push(prof.map(([w, y]) => [o.x - o.tz * w, H(s) + (y < -1 ? y - sag : y) - 0.02, o.z + o.tx * w, s - sA]));
    }
    // faces between consecutive rings (one quad per profile edge) ; uv : m along the bridge, m along the profile
    for (let i = 0; i < steps; i++) {
      const A = rings[i], B = rings[i + 1];
      let acc = 0;
      for (let k = 0; k < prof.length - 1; k++) {
        const l = Math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1]), b0 = pos.length / 3;
        for (const [P, v] of [[A[k], acc], [A[k + 1], acc + l], [B[k + 1], acc + l], [B[k], acc]]) { pos.push(P[0], P[1], P[2]); uv.push(P[3] / 2.2, v / 1.1); }
        idx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
        acc += l;
      }
    }
    // end caps (abutments) : close the profile at both ends
    for (const [R, flip] of [[rings[0], false], [rings[rings.length - 1], true]]) {
      const b0 = pos.length / 3;
      for (const P of R) { pos.push(P[0], P[1], P[2]); uv.push(0, 0); }
      const shape = THREE.ShapeUtils.triangulateShape(prof.map(([w, y]) => new THREE.Vector2(w, y)), []);
      for (const [a, b, c] of shape) idx.push(...(flip ? [b0 + a, b0 + b, b0 + c] : [b0 + a, b0 + c, b0 + b]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    const m = put(g, stone, groupOf((br.s0 + br.s1) / 2), 'bridge');
    m.material.side = THREE.DoubleSide; // (the winding of the swept faces follows the direction of the route)
  }

  // ---------------------------------------------------------------- the passed stop : platform slab (chamfered), shelter, lit name totem
  if (passStop) {
    const P = S.platform, sm = passStop.s;
    tr.at(sm, o);
    // platform on the side with room (walls further away)
    let side = 1;
    if (collision) { const r = collision.rayHit(o.x, 1, o.z, o.tz, 0, -o.tx, 8), l = collision.rayHit(o.x, 1, o.z, -o.tz, 0, o.tx, 8); side = l >= r ? 1 : -1; }
    const lat = 1.45 + P.width / 2, nx = -o.tz * side, nz = o.tx * side, yaw = Math.atan2(-o.tx, -o.tz);
    const grp = groupOf(sm), y0 = H(sm);
    const slabShape = new THREE.Shape(); slabShape.moveTo(-P.width / 2, 0); slabShape.lineTo(P.width / 2, 0); slabShape.lineTo(P.width / 2, 0.22); slabShape.lineTo(-P.width / 2 + 0.06, 0.22); slabShape.lineTo(-P.width / 2, 0.16);
    const slab = new THREE.ExtrudeGeometry(slabShape, { depth: P.len, bevelEnabled: false }); slab.translate(0, 0, -P.len / 2);
    // (local frame : x across toward the platform side, z along the track ; rotated below)
    const parts = [slab];
    const edge = new THREE.BoxGeometry(0.4, 0.012, P.len); edge.translate(-P.width / 2 + 0.25, 0.226, 0);
    const shelter = [
      new RoundedBoxGeometry(1.9, 0.12, 6.0, 2, 0.04).translate(0.25, 2.62, 0),
      ...[-2.8, 2.8].map((dz) => new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8).translate(0.95, 1.42, dz)),
      new RoundedBoxGeometry(0.4, 0.06, 2.6, 1, 0.02).translate(0.7, 0.68, 0),
      new THREE.CylinderGeometry(0.11, 0.11, 3.2, 10).translate(-0.7, 1.82, P.len / 2 - 3),
    ];
    const glass = new THREE.BoxGeometry(0.03, 2.2, 5.6); glass.translate(1.0, 1.42, 0);
    const local = new THREE.Matrix4().compose(new THREE.Vector3(o.x + nx * lat, y0, o.z + nz * lat), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + (side > 0 ? 0 : Math.PI)), new THREE.Vector3(side > 0 ? 1 : 1, 1, 1));
    // (x of the local frame points to the right of the track for side 1 : the yaw of the track ; for side -1 the frame is turned half a turn)
    const ctsGreen = new THREE.MeshStandardMaterial({ color: 0x3f6e46, roughness: 0.55, metalness: 0.45 });
    const verre = new THREE.MeshStandardMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0.1, depthWrite: false });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc9a93a, roughness: 0.6 });
    for (const [list, mat, name] of [[parts, concrete, 'platform'], [[edge], yellow, 'platformEdge'], [shelter, ctsGreen, 'shelter'], [[glass], verre, 'shelterGlass']]) {
      const g = merge(list); g.applyMatrix4(local); put(g, mat, grp, name);
    }
    // name totem (emissive sign, both faces)
    const sign = canvasTex(512, 128, (x, w, h) => {
      x.fillStyle = '#1d2a22'; x.fillRect(0, 0, w, h); x.fillStyle = '#2b6fd8'; x.fillRect(0, 0, 18, h);
      x.fillStyle = '#f2efe6'; x.font = 'bold 52px Arial'; x.fillText((passStop.name || '').replace(/ Les Halles$/, ''), 34, 64, w - 50);
      x.fillStyle = '#ffd24a'; x.font = '30px Arial'; x.fillText('Tram C', 34, 108);
    });
    sign.wrapS = sign.wrapT = THREE.ClampToEdgeWrapping;
    const smat = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.6, roughness: 0.5 });
    const sg = merge([0, Math.PI].map((r) => new THREE.PlaneGeometry(1.7, 0.42).rotateY(Math.PI / 2 + r).translate(-0.7 + (r ? -0.12 : 0.12), 3.0, P.len / 2 - 3)));
    sg.applyMatrix4(local); put(sg, smat, grp, 'totem');
  }

  return { near, far, meshes };
}
