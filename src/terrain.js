import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Relief du terrain (v0.74.0). Une seule carte de hauteur (en mètres, grille de 2 m) sert à la fois :
//   - à l'AFFICHAGE : le vertex shader de tout le décor statique (sol, bâtiments, mobilier, arbres, rails, rame…) décale chaque sommet de
//     T(x, z) : rien n'est à replacer, les objets suivent le terrain ; les murs s'étirent de quelques centimètres sur les pentes ;
//   - à la LOGIQUE : sol des joueurs et des véhicules (floorAt), collisions et rayons (hauteurs relatives au terrain), zombies, taches de sang.
//  Les corps dynamiques (zombies, véhicules, joueurs, projectiles, particules) ne sont PAS décalés par le shader : leur hauteur est absolue.
//  Relief : ondulation douce des rues et places (loin des murs) ; berges qui descendent vers l'eau (le niveau de l'eau est fixe, plus bas) ;
//  parvis de la cathédrale surélevé. Réglages : CONFIG.terrain. Désactivé (T = 0 partout) sur les autres cartes.
// =====================================================================

const hash = (ix, iz) => { const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t) => t * t * (3 - 2 * t);
const vnoise = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
};
const sstep = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

let data = null; // { h: Float32Array, nx, nz, hx, hz, cell, water: number, tex, uniforms }

// Hauteur du terrain en (x, z) : interpolation bilinéaire de la grille (0 si le relief n'est pas installé)
// Outside the grid (v0.79.0 : the station area) the relief fades to 0 over FADE m ; the vertex shader applies the same fade.
const FADE = 20;
export function terrainY(x, z) {
  if (!data) return 0;
  const { h, nx, nz, hx, hz, cell } = data;
  const out = Math.max(Math.abs(x) - hx, Math.abs(z) - hz, 0);
  if (out >= FADE) return 0;
  let u = (x + hx) / cell - 0.5, v = (z + hz) / cell - 0.5;
  u = Math.min(nx - 1.001, Math.max(0, u)); v = Math.min(nz - 1.001, Math.max(0, v));
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, k = j * nx + i;
  return (h[k] * (1 - fx) * (1 - fz) + h[k + 1] * fx * (1 - fz) + h[k + nx] * (1 - fx) * fz + h[k + nx + 1] * fx * fz) * (1 - out / FADE);
}
export const terrainWaterY = () => (data ? data.water : 0);
export const terrainOn = () => !!data;

// Construit la carte de hauteur d'après la grille de l'île (isl : { nx, nz, hx, hz, cell, rawWater }) ; renvoie false si désactivé
export function installTerrain(isl) {
  const T = CONFIG.terrain;
  data = null;
  if (!T?.enabled) return false;
  const { nx, nz, hx, hz, cell } = isl;
  // distance à l'eau (m, chamfer en deux passes, plafonnée)
  const CAP = 40, dist = new Float32Array(nx * nz);
  for (let i = 0; i < dist.length; i++) dist[i] = isl.rawWater[i] === 1 ? 0 : CAP;
  const D = cell, DD = cell * 1.4142;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let d = dist[k];
    if (i > 0) d = Math.min(d, dist[k - 1] + D);
    if (j > 0) { d = Math.min(d, dist[k - nx] + D); if (i > 0) d = Math.min(d, dist[k - nx - 1] + DD); if (i < nx - 1) d = Math.min(d, dist[k - nx + 1] + DD); }
    dist[k] = d;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let d = dist[k];
    if (i < nx - 1) d = Math.min(d, dist[k + 1] + D);
    if (j < nz - 1) { d = Math.min(d, dist[k + nx] + D); if (i < nx - 1) d = Math.min(d, dist[k + nx + 1] + DD); if (i > 0) d = Math.min(d, dist[k + nx - 1] + DD); }
    dist[k] = d;
  }
  const h = new Float32Array(nx * nz), P = T.parvis;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * cell - hx, z = (j + 0.5) * cell - hz, d = dist[j * nx + i];
    // ondulation : deux échelles (≈ 90 m et ≈ 35 m), centrée ; amortie près de l'eau où la berge prend le relais
    const und = ((vnoise(x / T.wave1, z / T.wave1) - 0.5) * 1.3 + (vnoise(x / T.wave2 + 17, z / T.wave2 + 5) - 0.5) * 0.7) * T.undulation;
    const bank = -T.bank * (1 - sstep(0, T.bankReach, d)); // berge : descend de `bank` m jusqu'à l'eau
    const dp = Math.hypot(x - P.x, z - P.z);
    const parvis = P.h * (1 - sstep(P.r, P.r + P.edge, dp)); // parvis surélevé de la cathédrale
    h[j * nx + i] = und * sstep(0, T.bankReach, d) + bank + parvis * (1 - 0.6 * (1 - sstep(0, T.bankReach, d)));
  }
  // texture demi-flottante (filtrage linéaire sans extension) pour le vertex shader
  const half = new Uint16Array(nx * nz);
  for (let i = 0; i < h.length; i++) half[i] = THREE.DataUtils.toHalfFloat(h[i]);
  const tex = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  // uv = (xz + (hx, hz)) / (taille) ; le texel 0 est centré en cell / 2
  // Shared uniform objects: every terrain-aware shader (patched or not) reads the same ones.
  U.tTerrain.value = tex; U.uTerrain.value.set(hx, hz, nx * cell, nz * cell);
  data = { h, nx, nz, hx, hz, cell, water: -T.bank + 0.04, tex, uniforms: U };
  return true;
}

// Program sharing (A4): EVERY standard / basic material carries the same terrain code in its vertex shader, switched per material by the
// `uTerrainK` uniform (1 = scenery that follows the relief, 0 = dynamic bodies at absolute heights). Patched and unpatched twins therefore
// share one program instead of two (the cache key is the same prototype function for both).
const DUMMY_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); DUMMY_TEX.needsUpdate = true;
const U = { tTerrain: { value: DUMMY_TEX }, uTerrain: { value: new THREE.Vector4(0, 0, 1, 1) } };
const PATCHED = new WeakSet(); // materials that follow the relief (clones do not inherit it, unlike userData)

const VERT_CHUNK = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    mvPosition = batchingMatrix * mvPosition;
  #endif
  vec4 tWorld = mvPosition;
  #ifdef USE_INSTANCING
    tWorld = instanceMatrix * tWorld;
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  if ( uTerrainK > 0.5 ) {
    tWorld = modelMatrix * tWorld;
    float tOff = texture2D( tTerrain, (tWorld.xz + uTerrain.xy) / uTerrain.zw ).r;
    tOff *= 1.0 - clamp( max( max( abs( tWorld.x ) - uTerrain.x, abs( tWorld.z ) - uTerrain.y ), 0.0 ) / 20.0, 0.0, 1.0 ); // fade outside the grid (terrainY)
    mvPosition.xyz += ( viewMatrix * vec4( 0.0, tOff, 0.0, 0.0 ) ).xyz;
  }
  gl_Position = projectionMatrix * mvPosition;
`;

const isSurface = (m) => m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial;
function applyTerrain(shader, k) {
  if (!shader.vertexShader.includes('#include <project_vertex>')) return;
  shader.uniforms.tTerrain = U.tTerrain; shader.uniforms.uTerrain = U.uTerrain; shader.uniforms.uTerrainK = { value: k };
  shader.vertexShader = 'uniform sampler2D tTerrain;\nuniform vec4 uTerrain;\nuniform float uTerrainK;\n' + shader.vertexShader.replace('#include <project_vertex>', VERT_CHUNK);
}
// Default for every material without its own onBeforeCompile: terrain code with K from PATCHED (see above)
THREE.Material.prototype.onBeforeCompile = function (shader) {
  if (isSurface(this)) applyTerrain(shader, PATCHED.has(this) ? 1 : 0);
};

// Décale les sommets d'un matériau du décor (MeshStandard / Physical / Basic…) de T(x, z), sans toucher à ses autres modifications du shader
export function patchMaterial(mat) {
  if (!data || !mat || mat.userData.terrainPatched || PATCHED.has(mat) || !isSurface(mat)) return;
  mat.userData.terrainPatched = true; PATCHED.add(mat);
  if (Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile')) { // custom shader: wrap it (its own cache key, plus the terrain suffix)
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
    mat.onBeforeCompile = function (shader, renderer) {
      prev.call(this, shader, renderer);
      applyTerrain(shader, 1);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey() : prev.toString()) + '|terrain';
  }
  mat.needsUpdate = true;
}

// Applique le relief à tout un sous-arbre (maillages ordinaires, instanciés ou fusionnés) ; `skip(mesh)` écarte l'eau, le ciel…
export function patchObject(root, skip = null) {
  if (!data) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || (skip && skip(o))) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { patchMaterial(m); n++; }
  });
  return n;
}

// Subdivise une géométrie non indexée ou indexée (position, uv, normal) jusqu'à ce qu'aucune arête ne dépasse maxEdge : le sol doit avoir des sommets pour épouser le relief
export function tessellate(geo, maxEdge) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const P = src.attributes.position, U = src.attributes.uv, N = src.attributes.normal;
  const pos = [], uv = [], nor = [];
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const max2 = maxEdge * maxEdge;
  const stack = [];
  for (let t = 0; t < P.count; t += 3) {
    const tri = [0, 1, 2].map((k) => ({ p: [P.getX(t + k), P.getY(t + k), P.getZ(t + k)], u: U ? [U.getX(t + k), U.getY(t + k)] : [0, 0] }));
    stack.push(tri);
    while (stack.length) {
      const [a, b, c] = stack.pop();
      const e = [[a, b], [b, c], [c, a]].map(([p, q]) => (p.p[0] - q.p[0]) ** 2 + (p.p[1] - q.p[1]) ** 2 + (p.p[2] - q.p[2]) ** 2);
      const m = e.indexOf(Math.max(...e));
      if (e[m] <= max2) { for (const v of [a, b, c]) { pos.push(...v.p); uv.push(...v.u); if (N) nor.push(N.getX(t), N.getY(t), N.getZ(t)); } continue; }
      const [p, q, r] = m === 0 ? [a, b, c] : m === 1 ? [b, c, a] : [c, a, b]; // arête la plus longue p-q, sommet opposé r
      const mp = { p: mid(p.p, q.p), u: mid(p.u, q.u) };
      stack.push([p, mp, r], [mp, q, r]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (U) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (N) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else g.computeVertexNormals();
  return g;
}
