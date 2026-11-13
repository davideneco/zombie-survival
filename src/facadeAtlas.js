import * as THREE from 'three';

// =====================================================================
//  Facade texture atlas (v0.91.0): every facade layer (map 768x640, bump 384x320 as R8, emissive 192x160) lives in ONE `DataArrayTexture` per
//  channel, and one MeshStandardMaterial draws all of them. Each vertex carries `aFac = (layer, depth step)`:
//   - layer picks the array slice (flat varying: no interpolation),
//   - the depth step replaces the old per-material polygonOffset: `gl_Position.z -= step * uDepthBias * w` (a fixed number of depth-buffer
//     LSBs, like polygonOffset units), so coplanar faces of two layers never fight for a pixel (tools/stuck-scan.mjs, zfight step).
//  Effect: ~20 facade draw calls per city tile (one per style/variant material) become 1.
//  The canvases are drawn at build time, copied into the arrays at finish() and dropped; the array data is freed after the GPU upload.
//  The vertex patch also serves the roof material (`patchDepth`): roofs have no layer, only the depth step.
// =====================================================================

export const LAYER_W = 768, LAYER_H = 640; // one array slice (bump = half, emissive = quarter)
const MAX_FLOOD = 64;

export function createFacadeAtlas({ renderer, detailTex, depthBias }) {
  const layers = []; // { id, key, rank, sets: { cMap, cBump, cEmis } | null, flood }
  const byKey = new Map();
  const uDepthBias = { value: depthBias };

  const api = {
    uDepthBias,
    has: (key) => byKey.has(key),
    get: (key) => byKey.get(key),
    byId: (id) => layers[id], // (key, rank and id stay valid after build(); streamed tiles map their layers through them)
    // sets: the three canvases of the layer (they are freed by build()); flood: lit by the monument floodlight (gothic cathedral)
    add(key, rank, sets, flood = false) {
      const L = { id: layers.length, key, rank, sets, flood };
      layers.push(L); byKey.set(key, L);
      return L;
    },
    // Builds the arrays for the layers in `used` (Set of ids) and the material. Returns { mat, slot: Map id -> array slice }.
    build(used) {
      const ids = layers.filter((L) => used.has(L.id)).map((L) => L.id), n = Math.max(1, ids.length), slot = new Map(ids.map((id, i) => [id, i]));
      const wM = LAYER_W, hM = LAYER_H, wB = wM / 2, hB = hM / 2, wE = wM / 4, hE = hM / 4;
      let dM = new Uint8Array(wM * hM * 4 * n), dB = new Uint8Array(wB * hB * n), dE = new Uint8Array(wE * hE * 4 * n);
      const tmp = document.createElement('canvas'), tctx = tmp.getContext('2d', { willReadFrequently: true });
      // copies a canvas into slice i, rescaled to w x h; rows are flipped (texture arrays ignore flipY: canvas row 0 is the top = v 1)
      const copy = (cv, i, w, h, dst, channels) => {
        tmp.width = w; tmp.height = h; tctx.clearRect(0, 0, w, h); tctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, w, h);
        const px = tctx.getImageData(0, 0, w, h).data, base = i * w * h * channels;
        for (let y = 0; y < h; y++) {
          const so = (h - 1 - y) * w * 4, dO = base + y * w * channels;
          if (channels === 1) for (let x = 0; x < w; x++) dst[dO + x] = px[so + x * 4];
          else dst.set(px.subarray(so, so + w * 4), dO);
        }
      };
      ids.forEach((id, i) => {
        const L = layers[id];
        copy(L.sets.cMap, i, wM, hM, dM, 4); copy(L.sets.cBump, i, wB, hB, dB, 1); copy(L.sets.cEmis, i, wE, hE, dE, 4);
      });
      for (const L of layers) { if (L.sets) { for (const c of Object.values(L.sets)) { c.width = 0; c.height = 0; } L.sets = null; } } // the canvases are no longer needed (CPU memory)
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const arr = (data, w, h, format, srgb) => {
        const t = new THREE.DataArrayTexture(data, w, h, n);
        t.format = format; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true; t.anisotropy = aniso; t.needsUpdate = true;
        t.onUpdate = () => { t.image = { data: null, width: w, height: h, depth: n }; }; // free the CPU copy once uploaded
        return t;
      };
      const tMap = arr(dM, wM, hM, THREE.RGBAFormat, true), tBump = arr(dB, wB, hB, THREE.RedFormat, false), tEmis = arr(dE, wE, hE, THREE.RGBAFormat, true);
      dM = dB = dE = null; // (the closures below share this scope: without this they would keep the ~100 MB of pixel data alive)
      const flood = new Float32Array(MAX_FLOOD);
      for (const [id, i] of slot) if (layers[id].flood && i < MAX_FLOOD) flood[i] = 1;
      const floodCol = new THREE.Color(0xe8b48c).multiplyScalar(0.24); // the lit cathedral: its sandstone emits a warm light
      // 1x1 placeholders keep the material's USE_MAP / USE_BUMPMAP / USE_EMISSIVEMAP defines (uv varyings, uniforms); the shader samples the arrays instead
      const ph = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); ph.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({
        map: ph, bumpMap: ph, bumpScale: 3.2, emissiveMap: ph, emissive: 0xffaa44, emissiveIntensity: 1.5,
        roughness: 0.82, vertexColors: true, side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { tDetail: { value: detailTex }, uFacMap: { value: tMap }, uFacBump: { value: tBump }, uFacEmis: { value: tEmis }, uFlood: { value: flood }, uFloodCol: { value: floodCol }, uDepthBias });
        sh.vertexShader = 'attribute vec2 aFac;\nuniform float uDepthBias;\nflat varying float vLayer;\n' + sh.vertexShader
          .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vLayer = aFac.x;\n  gl_Position.z -= aFac.y * uDepthBias * gl_Position.w;'); // (after project_vertex, which the terrain patch rewrites)
        const bump = THREE.ShaderChunk.bumpmap_pars_fragment
          .replace('uniform sampler2D bumpMap;', '')
          .replace(/texture2D\( bumpMap, ([^)]*?) \)/g, 'texture( uFacBump, vec3( $1, vLayer ) )');
        sh.fragmentShader = 'uniform highp sampler2DArray uFacMap;\nuniform highp sampler2DArray uFacBump;\nuniform highp sampler2DArray uFacEmis;\nuniform sampler2D tDetail;\nuniform float uFlood[' + MAX_FLOOD + '];\nuniform vec3 uFloodCol;\nflat varying float vLayer;\n' + sh.fragmentShader
          .replace('#include <bumpmap_pars_fragment>', bump)
          .replace('#include <map_fragment>', '  vec4 sampledDiffuseColor = texture( uFacMap, vec3( vMapUv, vLayer ) );\n  diffuseColor *= sampledDiffuseColor;\n  diffuseColor.rgb *= 0.74 + 0.56 * texture2D(tDetail, vMapUv * vec2(5.0, 3.7)).r;')
          .replace('#include <emissivemap_fragment>', '  vec3 emTex = texture( uFacEmis, vec3( vEmissiveMapUv, vLayer ) ).rgb;\n  totalEmissiveRadiance = mix( totalEmissiveRadiance * emTex, uFloodCol * sampledDiffuseColor.rgb, uFlood[ int( vLayer + 0.5 ) ] );');
      };
      mat.customProgramCacheKey = () => 'facadeArray';
      return { mat, slot };
    },
    // Depth step only (roofs): same vertex bias, no layer
    patchDepth(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uDepthBias = uDepthBias;
        sh.vertexShader = 'attribute vec2 aFac;\nuniform float uDepthBias;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n  gl_Position.z -= aFac.y * uDepthBias * gl_Position.w;');
      };
      mat.customProgramCacheKey = () => 'facadeRoof';
      return mat;
    },
  };
  return api;
}
