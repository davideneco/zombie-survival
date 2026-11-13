import * as THREE from 'three';

// =====================================================================
//  Shader program sharing (step A4). three.js bakes some material flags into the program (a map being present, the two-pass
//  draw of transparent double-sided materials...), so materials that differ only by such a flag compile as separate programs.
//  This module canonicalises them, with no visible change:
//   - a MeshStandard / MeshBasic material with no texture at all gets a shared 1x1 white map (colour x 1.0 = same colour), so it
//     shares the program of its textured twin ("fog + map + env" instead of one program with and one without);
//   - a transparent DoubleSide material is drawn in ONE pass (forceSinglePass) instead of a BackSide then a FrontSide pass,
//     which compiled two programs (FLIP_SIDED + plain) per material kind. Its depth is not written (depthWrite false in practice),
//     so the order of its own faces only changes the blend of already translucent glass very slightly.
//  Applied to the whole scene before the shader precompile (`shareProgramFlags`) and lazily to materials that appear later
//  (Material.prototype.onBeforeRender runs before the program lookup).
// =====================================================================

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.colorSpace = THREE.SRGBColorSpace; WHITE.needsUpdate = true;
const OTHER_MAPS = ['normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'lightMap', 'alphaMap', 'displacementMap'];
const checked = new WeakSet();

function canon(m) {
  if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true; // may be toggled at runtime: checked every call
  if (checked.has(m)) return;
  checked.add(m);
  if (m.map || !(m.isMeshStandardMaterial || m.isMeshBasicMaterial) || m.isMeshPhysicalMaterial) return;
  if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) return; // custom shaders keep their own program
  for (let i = 0; i < OTHER_MAPS.length; i++) if (m[OTHER_MAPS[i]]) return;
  m.map = WHITE; m.needsUpdate = true;
}

THREE.Material.prototype.onBeforeRender = function () { canon(this); };

export function shareProgramFlags(root) {
  root.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) for (const m of o.material) canon(m); else canon(o.material);
  });
}
