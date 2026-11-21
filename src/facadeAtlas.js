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
      let dM = new Uint8Array(wM * hM * 4 * n), dPbr = new Uint8Array(wB * hB * 4 * n), dE = new Uint8Array(wE * hE * 4 * n);
      const tmp = document.createElement('canvas'), tctx = tmp.getContext('2d', { willReadFrequently: true });
      const readPx = (cv, w, h) => {
        tmp.width = w; tmp.height = h; tctx.clearRect(0, 0, w, h);
        tctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, w, h);
        return tctx.getImageData(0, 0, w, h).data;
      };
      // copies a canvas into slice i (rows flipped because DataArrayTexture ignores flipY)
      const copyRgba = (cv, i, w, h, dst) => {
        const px = readPx(cv, w, h), base = i * w * h * 4;
        for (let y = 0; y < h; y++) dst.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), base + y * w * 4);
      };
      // Builds slice i of uFacPbr (R=normalX, G=normalY via 3x3 Sobel on cBump, B=roughness, A=metalness) and bakes micro-AO into albedo
      const copyPbr = (L, i) => {
        const bPx = readPx(L.sets.cBump, wB, hB);
        const rPx = L.sets.cRough ? readPx(L.sets.cRough, wB, hB) : null;
        const basePbr = i * wB * hB * 4;
        const baseMap = i * wM * hM * 4;
        const hAt = (x, y) => {
          const xx = (x + wB) % wB, yy = (y + hB) % hB;
          return bPx[(yy * wB + xx) * 4] * (1 / 255);
        };
        for (let y = 0; y < hB; y++) {
          const sy = hB - 1 - y; // flipped row in canvas space
          for (let x = 0; x < wB; x++) {
            const tl = hAt(x - 1, sy - 1), tc = hAt(x, sy - 1), tr = hAt(x + 1, sy - 1);
            const ml = hAt(x - 1, sy),                         mr = hAt(x + 1, sy);
            const bl = hAt(x - 1, sy + 1), bc = hAt(x, sy + 1), br = hAt(x + 1, sy + 1);
            // Sobel gradient in tangent UV space (+u right, +v up = -sy)
            const dx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
            const dy = (tl + 2 * tc + tr) - (bl + 2 * bc + br);
            const nx = Math.max(-1, Math.min(1, -dx * 2.1));
            const ny = Math.max(-1, Math.min(1, -dy * 2.1));
            const o = basePbr + (y * wB + x) * 4;
            dPbr[o] = Math.round((nx * 0.5 + 0.5) * 255);
            dPbr[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            const ro = (sy * wB + x) * 4;
            dPbr[o + 2] = rPx ? rPx[ro] : 222;
            dPbr[o + 3] = rPx ? rPx[ro + 1] : 0;
            // Apply micro-AO (rPx[ro + 2]) to the corresponding 2x2 texels of albedo
            if (rPx) {
              const ao = rPx[ro + 2];
              if (ao < 252) {
                const k = ao * (1 / 255);
                for (let oy = 0; oy < 2; oy++) {
                  const rowOff = baseMap + ((y * 2 + oy) * wM + x * 2) * 4;
                  for (let ox = 0; ox < 2; ox++) {
                    const mo = rowOff + ox * 4;
                    dM[mo] = Math.round(dM[mo] * k);
                    dM[mo + 1] = Math.round(dM[mo + 1] * k);
                    dM[mo + 2] = Math.round(dM[mo + 2] * k);
                  }
                }
              }
            }
          }
        }
      };
      ids.forEach((id, i) => {
        const L = layers[id];
        copyRgba(L.sets.cMap, i, wM, hM, dM);
        copyPbr(L, i);
        copyRgba(L.sets.cEmis, i, wE, hE, dE);
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
      const tMap = arr(dM, wM, hM, THREE.RGBAFormat, true), tPbr = arr(dPbr, wB, hB, THREE.RGBAFormat, false), tEmis = arr(dE, wE, hE, THREE.RGBAFormat, true);
      dM = dPbr = dE = null; // (the closures below share this scope: without this they would keep the ~100 MB of pixel data alive)
      const flood = new Float32Array(MAX_FLOOD);
      for (const [id, i] of slot) if (layers[id].flood && i < MAX_FLOOD) flood[i] = 1;
      const floodCol = new THREE.Color(0xe8b48c).multiplyScalar(0.24); // the lit cathedral: its sandstone emits a warm light
      // 1x1 placeholders keep the material's USE_MAP / USE_EMISSIVEMAP defines (uv varyings, uniforms); the shader samples the arrays instead
      const ph = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); ph.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({
        map: ph, emissiveMap: ph, emissive: 0xffaa44, emissiveIntensity: 1.5,
        roughness: 0.85, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { tDetail: { value: detailTex }, uFacMap: { value: tMap }, uFacPbr: { value: tPbr }, uFacEmis: { value: tEmis }, uFlood: { value: flood }, uFloodCol: { value: floodCol }, uDepthBias });
        sh.vertexShader = 'attribute vec2 aFac;\nuniform float uDepthBias;\nflat varying float vLayer;\n' + sh.vertexShader
          .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vLayer = aFac.x;\n  gl_Position.z -= aFac.y * uDepthBias * gl_Position.w;'); // (after project_vertex, which the terrain patch rewrites)
        sh.fragmentShader = 'uniform highp sampler2DArray uFacMap;\nuniform highp sampler2DArray uFacPbr;\nuniform highp sampler2DArray uFacEmis;\nuniform sampler2D tDetail;\nuniform float uFlood[' + MAX_FLOOD + '];\nuniform vec3 uFloodCol;\nflat varying float vLayer;\n' + sh.fragmentShader
          .replace('#include <map_fragment>', `
            vec4 sampledDiffuseColor = texture( uFacMap, vec3( vMapUv, vLayer ) );
            vec4 facPbr = texture( uFacPbr, vec3( vMapUv, vLayer ) );
            float facDetail = texture2D( tDetail, vMapUv * vec2( 5.0, 3.7 ) ).r;
            float roughMask = smoothstep( 0.20, 0.55, facPbr.b );
            diffuseColor *= sampledDiffuseColor;
            diffuseColor.rgb *= mix( 1.0, 0.78 + 0.48 * facDetail, roughMask );`)
          .replace('#include <roughnessmap_fragment>', `
            float roughnessFactor = clamp( facPbr.b * mix( 1.0, 0.86 + 0.28 * facDetail, roughMask ), 0.045, 0.98 );`)
          .replace('#include <metalnessmap_fragment>', `
            float metalnessFactor = clamp( facPbr.a, 0.0, 0.95 );`)
          .replace('#include <normal_fragment_maps>', `
            {
              vec3 q0 = dFdx( -vViewPosition.xyz );
              vec3 q1 = dFdy( -vViewPosition.xyz );
              vec2 st0 = dFdx( vMapUv.st );
              vec2 st1 = dFdy( vMapUv.st );
              float det = st0.x * st1.y - st1.x * st0.y;
              if ( abs( det ) > 1e-10 ) {
                float sgn = det < 0.0 ? -1.0 : 1.0;
                vec3 S = normalize( ( q0 * st1.y - q1 * st0.y ) * sgn + vec3( 1e-6 ) );
                vec3 T = normalize( ( -q0 * st1.x + q1 * st0.x ) * sgn + vec3( 1e-6 ) );
                vec3 N = normalize( normal );
                vec2 nXY = ( facPbr.rg * 2.0 - 1.0 ) * 1.75;
                if ( roughMask > 0.02 ) {
                  vec2 dUv = vMapUv * vec2( 5.0, 3.7 );
                  float dX = texture2D( tDetail, dUv + vec2( 0.005, 0.0 ) ).r - facDetail;
                  float dY = texture2D( tDetail, dUv + vec2( 0.0, 0.005 ) ).r - facDetail;
                  nXY += vec2( dX, dY ) * ( 2.5 * roughMask );
                }
                normal = normalize( mat3( S, T, N ) * normalize( vec3( nXY, 1.0 ) ) );
              }
            }`)
          .replace('#include <emissivemap_fragment>', '  vec3 emTex = texture( uFacEmis, vec3( vEmissiveMapUv, vLayer ) ).rgb;\n  totalEmissiveRadiance = mix( totalEmissiveRadiance * emTex, uFloodCol * sampledDiffuseColor.rgb, uFlood[ int( vLayer + 0.5 ) ] );')
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            float glassMask = smoothstep( 0.24, 0.06, facPbr.b );
            if ( glassMask > 0.01 ) {
              float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
              float fres = 0.18 + 0.82 * pow( 1.0 - ndv, 3.2 );
              reflectedLight.indirectSpecular *= 1.0 + glassMask * ( 1.4 + 2.6 * fres );
            }`);
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
