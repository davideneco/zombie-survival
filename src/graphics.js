import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CONFIG } from './config.js';
import { fx } from './fx.js';
import { contact } from './contact.js';
import { env, setEnvTint } from './envmap.js';

// =====================================================================
//  Paquet graphique (v0.44.0) : tout est VISUEL et LOCAL (aucun message réseau, aucune lumière de plus : ajouter une lumière ferait
//  recompiler tous les shaders). Réglé par CONFIG.graphics ; le niveau de qualité (Options) choisit CONFIG.graphics.levels[q].
//   - exposition et tone mapping par zone (la cathédrale garde sa pénombre) ;
//   - reflets d'ambiance : un petit ciel dessiné sur un canevas 256x128 -> PMREM -> scene.environment (une seule texture) ;
//   - ombres de contact (contact.js), ciel (sky.js), particules et taches de sang selon la qualité (fx.js) ;
//   - Haute : rendu dans une cible multi-échantillonnée + une passe finale (tone mapping, table de couleurs) ;
//   - « Effets cinéma » (Options) : vignette et grain en CSS (coût nul) + la table de couleurs de la Haute.
// =====================================================================

const G = () => CONFIG.graphics;
const TONES = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, linear: THREE.LinearToneMapping };
const sm = (x) => x * x * (3 - 2 * x);

// couleur / nombre à l'instant k du ciel (0 nuit, 0,5 aube, 1 jour) à partir d'un tableau [nuit, aube, jour] (comme summit.js)
const pickN = (a, k) => (k < 0.5 ? a[0] + (a[1] - a[0]) * sm(k * 2) : a[1] + (a[2] - a[1]) * sm((k - 0.5) * 2));
const _c0 = new THREE.Color(), _c1 = new THREE.Color();
const pickCss = (a, k) => {
  const i0 = k < 0.5 ? 0 : 1, u = k < 0.5 ? sm(k * 2) : sm((k - 0.5) * 2);
  return `#${_c0.set(a[i0]).lerp(_c1.set(a[i0 + 1]), u).getHexString()}`;
};

// ---------------------------------------------------------------- table de couleurs (32x32x32 en bande 1024x32)
function buildLut() {
  const N = 32, W = N * N, data = new Uint8Array(W * N * 4);
  const Gd = G().grade;
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    let R = r / (N - 1), Gc = g / (N - 1), B = b / (N - 1);
    // contraste en S doux autour du gris moyen
    const curve = (x) => { const s = x * x * (3 - 2 * x); return x + (s - x) * Gd.contrast; };
    R = curve(R); Gc = curve(Gc); B = curve(B);
    // saturation
    const l = lum(R, Gc, B);
    R = l + (R - l) * Gd.saturation; Gc = l + (Gc - l) * Gd.saturation; B = l + (B - l) * Gd.saturation;
    // teintes : ombres froides, hautes lumières chaudes
    const sh = (1 - l) * (1 - l), hi = l * l;
    R += Gd.shadows[0] * sh + Gd.highlights[0] * hi; Gc += Gd.shadows[1] * sh + Gd.highlights[1] * hi; B += Gd.shadows[2] * sh + Gd.highlights[2] * hi;
    const o = ((g * W) + b * N + r) * 4;
    data[o] = Math.round(Math.min(1, Math.max(0, R)) * 255); data[o + 1] = Math.round(Math.min(1, Math.max(0, Gc)) * 255); data[o + 2] = Math.round(Math.min(1, Math.max(0, B)) * 255); data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, N, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

const POST_VERT = /* glsl */`
  precision highp float;
  uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
  attribute vec3 position; attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const POST_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse; uniform sampler2D tLut; uniform float uGrade;
  uniform float uNvg; uniform float uTime;
  uniform vec2 uInvSize; uniform float uSharpen;
  #ifdef USE_AO
  uniform sampler2D tAo; uniform float uAoStrength;
  uniform sampler2D tDepth; uniform vec2 uNearFar; uniform vec3 uHazeCol; uniform float uHaze;
  #endif
  #ifdef HALO
  uniform sampler2D tHalo; uniform float uHalo;
  #endif
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  vec3 lutSample(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    float b = c.b * 31.0; float b0 = floor(b); float b1 = min(b0 + 1.0, 31.0); float f = b - b0;
    float y = (c.g * 31.0 + 0.5) / 32.0;
    vec3 a = texture2D(tLut, vec2((b0 * 32.0 + c.r * 31.0 + 0.5) / 1024.0, y)).rgb;
    vec3 d = texture2D(tLut, vec2((b1 * 32.0 + c.r * 31.0 + 0.5) / 1024.0, y)).rgb;
    return mix(a, d, f);
  }
  void main() {
    // l'image est DÉJÀ tone-mappée (voir makePost) : micro-netteté, SSAO, perspective atmosphérique, halo, sRGB, LUT
    vec4 base = texture2D(tDiffuse, vUv);
    if (uSharpen > 0.001) {
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uInvSize.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uInvSize.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uInvSize.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(uInvSize.x, 0.0)).rgb;
      vec3 blur4 = (n + s + e + w) * 0.25;
      base.rgb = clamp(base.rgb + (base.rgb - blur4) * uSharpen, 0.0, 4.0);
    }
    #ifdef USE_AO
    float ao = texture2D(tAo, vUv).r;
    base.rgb *= mix(1.0, ao, uAoStrength);
    if (uHaze > 0.001) {
      float rawD = texture2D(tDepth, vUv).r;
      if (rawD < 0.9994) {
        float zNdc = rawD * 2.0 - 1.0;
        float linZ = (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - zNdc * (uNearFar.y - uNearFar.x));
        float hf = smoothstep(38.0, 165.0, linZ) * uHaze;
        base.rgb = mix(base.rgb, uHazeCol, hf);
      }
    }
    #endif
    #ifdef HALO
    base.rgb += texture2D(tHalo, vUv).rgb * uHalo;
    #endif
    gl_FragColor = sRGBTransferOETF(base);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, lutSample(gl_FragColor.rgb), uGrade);
    if (uNvg > 0.001) {
      vec3 c = gl_FragColor.rgb;
      float lum = dot(c, vec3(0.24, 0.68, 0.08));
      // Image intensifier curve: strong shadow lift with controlled highlight compression
      float amp = pow(clamp(lum * 1.65 + 0.055, 0.0, 1.0), 0.78);
      float scan = 0.96 + 0.04 * sin(vUv.y * 720.0);
      float grain = (fract(sin(dot(vUv * 420.0 + uTime * 3.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.055;
      vec3 nvg = vec3(0.10, 0.98, 0.34) * clamp(amp * scan + grain, 0.0, 1.0);
      nvg += vec3(0.26, 0.36, 0.22) * pow(clamp(amp, 0.0, 1.0), 3.4);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, nvg, uNvg);
    }
  }`;

// SSAO demi-résolution (Haute) : spirale 10 échantillons à angle tournant, reconstruction de normale par dérivées de profondeur (sans halos sur les silhouettes)
const SSAO_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDepth;
  uniform vec2 uInvSize;
  uniform vec2 uProjScale;
  uniform vec2 uNearFar;
  uniform float uRadius;
  uniform float uBias;
  varying vec2 vUv;
  float linZ(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
  }
  vec3 viewPos(vec2 uv, float d) {
    float z = linZ(d);
    return vec3((uv * 2.0 - 1.0) * uProjScale * z, -z);
  }
  void main() {
    float d0 = texture2D(tDepth, vUv).r;
    if (d0 >= 0.9992) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(vUv, d0);
    float z = -p.z;
    // Atténue l'AO sur l'arme en main (< 1 m) et à très grande distance (> 85 m)
    float fade = smoothstep(0.65, 1.25, z) * (1.0 - smoothstep(65.0, 105.0, z));
    if (fade < 0.01) { gl_FragColor = vec4(1.0); return; }
    vec2 dxUv = vec2(uInvSize.x, 0.0), dyUv = vec2(0.0, uInvSize.y);
    vec3 pL = viewPos(vUv - dxUv, texture2D(tDepth, vUv - dxUv).r);
    vec3 pR = viewPos(vUv + dxUv, texture2D(tDepth, vUv + dxUv).r);
    vec3 pD = viewPos(vUv - dyUv, texture2D(tDepth, vUv - dyUv).r);
    vec3 pU = viewPos(vUv + dyUv, texture2D(tDepth, vUv + dyUv).r);
    vec3 ddx = abs(pR.z - p.z) < abs(p.z - pL.z) ? (pR - p) : (p - pL);
    vec3 ddy = abs(pU.z - p.z) < abs(p.z - pD.z) ? (pU - p) : (p - pD);
    vec3 N = normalize(cross(ddx, ddy) + vec3(0.0, 0.0, 1e-6));
    // Rayon projeté en UV (borné entre 2,5 px et 34 px pour éviter les sauts de cache)
    float radUvY = clamp(uRadius / (z * uProjScale.y * 2.0), uInvSize.y * 2.5, uInvSize.y * 34.0);
    vec2 radUv = vec2(radUvY * (uProjScale.y / uProjScale.x), radUvY);
    float ang0 = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
    float occ = 0.0;
    for (int i = 0; i < 10; i++) {
      float fi = (float(i) + 0.5) / 10.0;
      float ang = ang0 + float(i) * 2.3999632; // angle d'or
      vec2 off = vec2(cos(ang), sin(ang)) * radUv * (0.25 + 0.75 * fi);
      vec2 suv = clamp(vUv + off, vec2(0.002), vec2(0.998));
      float sd = texture2D(tDepth, suv).r;
      if (sd >= 0.9992) continue;
      vec3 sp = viewPos(suv, sd);
      vec3 v = sp - p;
      float dist2 = dot(v, v) + 1e-4;
      float dist = sqrt(dist2);
      float ndv = max(0.0, dot(N, v / dist) - uBias);
      float att = smoothstep(uRadius * 2.1, uRadius * 0.12, dist);
      occ += ndv * att;
    }
    float rawAo = clamp(1.0 - (occ / 10.0) * 4.2 * fade, 0.18, 1.0);
    float ao = pow(rawAo, 1.25);
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }`;

// Flou bilatéral séparable respectant les arêtes de profondeur (nettoyage de la spirale SSAO sans bavures)
const AO_BLUR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tAo;
  uniform sampler2D tDepth;
  uniform vec2 uDir;
  uniform vec2 uNearFar;
  varying vec2 vUv;
  float linZ(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
  }
  void main() {
    float d0 = texture2D(tDepth, vUv).r;
    float ao0 = texture2D(tAo, vUv).r;
    if (d0 >= 0.9992) { gl_FragColor = vec4(1.0); return; }
    float z0 = linZ(d0);
    float invTol = 1.0 / (z0 * 0.045 + 0.08);
    float sum = ao0 * 0.28, wSum = 0.28;
    for (int i = -2; i <= 2; i++) {
      if (i == 0) continue;
      vec2 suv = clamp(vUv + uDir * float(i), vec2(0.001), vec2(0.999));
      float zi = linZ(texture2D(tDepth, suv).r);
      float w = ((i == 1 || i == -1) ? 0.24 : 0.12) * exp(-abs(zi - z0) * invTol);
      sum += texture2D(tAo, suv).r * w;
      wSum += w;
    }
    float ao = sum / wSum;
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }`;

// Halo lumineux (Haute) : passe de seuil à demi-résolution (l'image est déjà tone-mappée : valeurs 0..1), flou gaussien séparable, ajout à l'image finale.
// Cibles en RGBA8 (pas de demi-flottants : aucun format exotique, pas de zone noire en rendu logiciel).
const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse; uniform vec2 uThr; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float k = smoothstep(uThr.x - uThr.y, uThr.x + uThr.y, l);
    gl_FragColor = vec4(c * k * k, 1.0);
  }`;
const BLUR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    s += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    s += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }`;

export function createGraphics({ renderer, scene, camera, hemi, moon, settings }) {
  const api = {
    renderer, scene, camera,
    world: null, player: null, game: null, level: null, q: -1,
    zone: null, zoneK: { exposure: 1, env: 1, torch: 1 }, // valeurs lissées de la zone courante
    sky: null, skyK: 0, envK: -1, envTarget: null, post: null, tone: null,
  };

  // ------------------------------------------------------------ tone mapping
  api.setTone = (name = G().tone.type) => {
    api.tone = name;
    renderer.toneMapping = TONES[name] ?? THREE.AgXToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  };
  // exposition : valeur de base x Luminosité (Options) x zone x amplification vision nocturne
  api.applyExposure = () => {
    const nvgK = api.player?.nvgK || 0;
    renderer.toneMappingExposure = G().tone.exposure * settings.brightness * api.zoneK.exposure * (1 + nvgK * (CONFIG.nvg?.exposureBoost || 0));
  };

  // ------------------------------------------------------------ reflets d'ambiance (PMREM d'un ciel enrichi)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCanvas = document.createElement('canvas'); envCanvas.width = 512; envCanvas.height = 256;
  const buildEnv = (k = 0) => {
    const E = G().env, x = envCanvas.getContext('2d'), W = 512, H = 256;
    const gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, pickCss(E.top, k)); gr.addColorStop(0.38, pickCss(E.mid, k)); gr.addColorStop(0.49, pickCss(E.horizon, k)); gr.addColorStop(0.55, pickCss(E.ground, k)); gr.addColorStop(1, pickCss(E.ground, k));
    x.globalCompositeOperation = 'source-over'; x.fillStyle = gr; x.fillRect(0, 0, W, H);
    const glowK = 1 - sm(Math.min(1, k * 1.4)); // les lampadaires s'éteignent à l'aube
    const blob = (u, v, r, col, a) => { const g = x.createRadialGradient(u, v, 0, u, v, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); x.fillStyle = g; x.fillRect(u - r, v - r, r * 2, r * 2); };
    // Bande nuageuse claire + lobe solaire de jour pour des reflets crédibles dans les vitres et carrosseries
    if (k > 0.15) {
      const dayK = sm(Math.min(1, (k - 0.15) / 0.75));
      for (let i = 0; i < 8; i++) {
        const cu = ((i + 0.35 + Math.sin(i * 4.7) * 0.25) / 8) * W;
        const cv = H * (0.28 + 0.12 * Math.cos(i * 3.1));
        blob(cu, cv, 42 + (i % 3) * 18, 'rgba(255,252,245,A)', 0.42 * dayK);
      }
      blob(W * 0.62, H * (0.46 - 0.18 * dayK), 56, 'rgba(255,244,218,A)', 0.95 * dayK);
    }
    if (glowK > 0.01) for (let i = 0; i < E.lamps; i++) { // lueurs sodium au ras de l'horizon, à des azimuts fixes
      const u = ((i + 0.5 + Math.sin(i * 12.9898) * 0.3) / E.lamps) * W; blob(u, H * (0.5 + 0.02 * Math.sin(i * 7.1)), 30 + (i % 3) * 10, 'rgba(255,175,85,A)', E.lampStrength * glowK);
    }
    const mu = ((G().sky.moonAzimuth / (Math.PI * 2)) + 0.5) * W, mv = H * (0.5 - G().sky.moonElevation / Math.PI);
    const moonK = 1 - sm(Math.min(1, k / 0.35));
    if (moonK > 0.01) blob(mu, mv, 44, 'rgba(170,195,255,A)', E.moonStrength * moonK);
    const tex = new THREE.CanvasTexture(envCanvas); tex.colorSpace = THREE.SRGBColorSpace;
    api.envTarget = pmrem.fromEquirectangular(tex, api.envTarget); // même cible réécrite : env.texture reste valide
    tex.dispose();
    api.envK = k;
    env.texture = api.envTarget.texture;
    scene.environment = env.texture;
  };
  api.rebuildEnv = (k = api.skyK) => { if (G().env.enabled) buildEnv(k); };
  const envIntensity = () => G().env.intensity * pickN(G().env.phaseIntensity, api.skyK) * api.zoneK.env;
  if (G().env.enabled) buildEnv(0); // avant la construction du monde : les matériaux réfléchissants en ont besoin

  // appelé par summit.js à chaque pas du ciel (k : 0 nuit, 0,5 aube, 1 jour) : l'ambiance suit l'Aube (une reconstruction tous les ~0,06 de k)
  api.onSky = (k) => {
    api.skyK = k;
    if (api.sky) api.sky.setK(k);
    if (G().env.enabled && Math.abs(k - api.envK) > 0.06) buildEnv(k);
  };

  // ------------------------------------------------------------ passe finale (Haute)
  const makePost = () => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = Math.min(size.x * size.y > G().post.msaa2Pixels ? 2 : G().post.samples, renderer.capabilities.maxSamples); // écrans très grands : 2 échantillons (mémoire)
    const AO = G().ao;
    const useAo = !!(AO?.enabled && renderer.capabilities.isWebGL2);
    const depthTex = useAo ? new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType) : null;
    if (depthTex) { depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter; }
    // Cible multi-échantillonnée en demi-flottants (précision dans les noirs) + résolution native du DepthTexture en WebGL2 (SSAO sans double géométrie)
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples, depthBuffer: true, depthTexture: depthTex || undefined, colorSpace: THREE.LinearSRGBColorSpace });
    rt.isXRRenderTarget = true;
    const lut = buildLut();
    const H = G().halo, halo = H.enabled && settings.halo !== false && (api.level?.halo ?? true);
    const defines = {};
    if (halo) defines.HALO = 1;
    if (useAo) defines.USE_AO = 1;
    const mat = new THREE.RawShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture }, tLut: { value: lut }, uGrade: { value: 1 }, uNvg: { value: 0 }, uTime: { value: 0 },
        uInvSize: { value: new THREE.Vector2(1 / size.x, 1 / size.y) }, uSharpen: { value: G().post.sharpen ?? 0.14 },
        tHalo: { value: null }, uHalo: { value: H.intensity },
        tAo: { value: null }, uAoStrength: { value: AO?.strength ?? 0.72 },
        tDepth: { value: depthTex }, uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
        uHazeCol: { value: new THREE.Color(0x9ab4cc) }, uHaze: { value: G().post.haze ?? 0.18 },
      },
      defines, vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
    });
    api.post = { rt, depthTex, mat, lut, quad: new FullScreenQuad(mat), w: size.x, h: size.y, halo: null, ao: null };
    const hw = Math.max(2, Math.floor(size.x / 2)), hh = Math.max(2, Math.floor(size.y / 2));
    const mkHalf = () => new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace });
    const raw = (frag, uniforms) => new THREE.RawShaderMaterial({ uniforms, vertexShader: POST_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    if (useAo) {
      const a = mkHalf(), b = mkHalf();
      const ssao = raw(SSAO_FRAG, {
        tDepth: { value: depthTex }, uInvSize: { value: new THREE.Vector2(1 / hw, 1 / hh) },
        uProjScale: { value: new THREE.Vector2(1, 1) }, uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
        uRadius: { value: AO.radius ?? 1.35 }, uBias: { value: AO.bias ?? 0.035 },
      });
      const blur = raw(AO_BLUR_FRAG, {
        tAo: { value: a.texture }, tDepth: { value: depthTex },
        uDir: { value: new THREE.Vector2() }, uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
      });
      api.post.ao = { a, b, ssao, blur, qSsao: new FullScreenQuad(ssao), qBlur: new FullScreenQuad(blur), w: hw, h: hh };
      mat.uniforms.tAo.value = a.texture;
    }
    if (halo) {
      const a = mkHalf(), b = mkHalf();
      const bright = raw(BRIGHT_FRAG, { tDiffuse: { value: rt.texture }, uThr: { value: new THREE.Vector2(H.threshold, H.knee) } });
      const blur = raw(BLUR_FRAG, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
      api.post.halo = { a, b, bright, blur, qBright: new FullScreenQuad(bright), qBlur: new FullScreenQuad(blur), w: hw, h: hh };
      mat.uniforms.tHalo.value = a.texture;
    }
  };
  const killPost = () => {
    if (!api.post) return;
    const h = api.post.halo;
    if (h) { h.a.dispose(); h.b.dispose(); h.bright.dispose(); h.blur.dispose(); h.qBright.dispose(); h.qBlur.dispose(); }
    const ao = api.post.ao;
    if (ao) { ao.a.dispose(); ao.b.dispose(); ao.ssao.dispose(); ao.blur.dispose(); ao.qSsao.dispose(); ao.qBlur.dispose(); }
    api.post.depthTex?.dispose();
    api.post.rt.dispose(); api.post.mat.dispose(); api.post.lut.dispose(); api.post.quad.dispose(); api.post = null;
  };
  const wantPost = () => { // la passe finale ne sert qu'à l'étalonnage (Effets cinéma) ; pas sur les très grands écrans (mémoire de la cible MSAA)
    if (!(api.level && api.level.post && G().post.enabled && settings.cinema !== false)) return false;
    const d = renderer.getDrawingBufferSize(new THREE.Vector2());
    return d.x * d.y <= G().post.maxPixels;
  };

  // ------------------------------------------------------------ qualité
  api.applyQuality = (q) => {
    const L = G().levels[Math.max(0, Math.min(G().levels.length - 1, q | 0))];
    const changed = api.q !== q;
    api.q = q; api.level = L;
    renderer.setPixelRatio(L.pixelRatio === 'device' ? Math.min(window.devicePixelRatio, 1.5) : L.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (moon.shadow.mapSize.x !== L.shadowSize) { moon.shadow.mapSize.set(L.shadowSize, L.shadowSize); moon.shadow.map?.dispose(); moon.shadow.map = null; }
    renderer.shadowMap.enabled = L.shadows;
    renderer.shadowMap.type = L.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // mise à jour pilotée par la boucle (shadowEvery)
    fx.setQuality(L.particles, L.decals);
    if (api.sky) api.sky.setCloud(L.clouds ? G().sky.cloudCover : 0);
    api.world?.relief?.setRange(L.facade); // détail des façades : 30 / 60 / 110 m
    api.world?.trees?.setMode(L.trees); // arbres : boules lissées / cartes de feuillage / cartes + branches
    if (wantPost()) { killPost(); makePost(); } else killPost();
    contact.setEnabled(G().contact.enabled);
    if (changed) scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); // les shaders changent avec les ombres
    api.applyCinema();
    api.applyExposure();
  };

  api.applyHalo = () => { if (api.post) { killPost(); if (wantPost()) makePost(); } };
  api.applyCinema = () => {
    const on = settings.cinema !== false;
    document.body.classList.toggle('no-cinema', !on);
    if (wantPost() !== !!api.post) { killPost(); if (wantPost()) makePost(); }
  };

  api.resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (api.post) {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      api.post.rt.setSize(s.x, s.y); api.post.w = s.x; api.post.h = s.y;
      api.post.mat.uniforms.uInvSize.value.set(1 / s.x, 1 / s.y);
      const hw = Math.max(2, s.x >> 1), hh = Math.max(2, s.y >> 1);
      const ao = api.post.ao;
      if (ao) { ao.w = hw; ao.h = hh; ao.a.setSize(hw, hh); ao.b.setSize(hw, hh); ao.ssao.uniforms.uInvSize.value.set(1 / hw, 1 / hh); }
      const h = api.post.halo;
      if (h) { h.w = hw; h.h = hh; h.a.setSize(hw, hh); h.b.setSize(hw, hh); }
    }
  };

  // ------------------------------------------------------------ monde (après sa construction)
  api.attach = (game, { world, sky }) => {
    api.game = game; api.world = world; api.player = game.player; api.sky = sky || world.sky;
    if (api.sky?.setCloud) api.sky.setCloud(api.level?.clouds ? G().sky.cloudCover : 0);
    world.relief?.setRange(api.level?.facade ?? 60);
    world.trees?.setMode(api.level?.trees ?? 'cards');
    const T = G().torch, f = game.player.flashlight;
    Object.assign(f, { angle: T.angle, penumbra: T.penumbra, decay: T.decay, distance: T.distance });
    world.relief?.update(world.startPos.x, world.startPos.z); // les tuiles proches du départ sont visibles : leurs shaders sont compilés au préchauffage
    contact.build(scene);
    contact.setEnabled(G().contact.enabled);
    scene.environmentIntensity = envIntensity();
  };

  // ------------------------------------------------------------ chaque image
  const _v = new THREE.Vector3();
  const _nvgSky = new THREE.Color(0x52cc72), _nvgGnd = new THREE.Color(0x28663a), _nvgFog = new THREE.Color(0x0c2816);
  let _nvgApplied = false;
  api.update = (dt) => {
    const game = api.game; if (!game || !api.world) return;
    const p = game.player;
    const nvgK = p.nvgK || 0;
    const NV = CONFIG.nvg;
    // zone courante : exposition, intensité des reflets et de la torche (lissées : pas de saut en franchissant une porte)
    let name = null;
    if (api.world.zoneOf) { const zi = api.world.zoneOf(p.pos.x, p.pos.z); name = zi >= 0 ? api.world.zoneNames[zi] : null; }
    const Z = G().zones[name] || G().zones.default, k = 1 - Math.exp(-dt * G().zoneBlend);
    const zk = api.zoneK;
    zk.exposure += (Z.exposure - zk.exposure) * k; zk.env += (Z.env - zk.env) * k; zk.torch += (Z.torch - zk.torch) * k;
    api.zone = name;
    api.applyExposure();
    scene.environmentIntensity = G().env.enabled ? envIntensity() * (1 + nvgK * 0.55) : 0;
    setEnvTint(G().env.enabled ? pickN(G().env.phaseIntensity, api.skyK) * zk.env : 0);
    // Night vision light & fog amplification (non-destructive using skyBase saved by summit.js)
    const sb = scene.userData.skyBase;
    if (sb && (nvgK > 0.001 || _nvgApplied)) {
      _nvgApplied = nvgK > 0.001;
      const nightFactor = 1 - Math.min(1, api.skyK * 0.65);
      hemi.intensity = sb.hemiI + nvgK * (NV?.hemiBoost || 1.55) * nightFactor;
      hemi.color.copy(sb.hemiSky).lerp(_nvgSky, nvgK * 0.65);
      hemi.groundColor.copy(sb.hemiGround).lerp(_nvgGnd, nvgK * 0.72);
      if (scene.fog) {
        scene.fog.density = sb.fogD * (1 - nvgK * (1 - (NV?.fogScale ?? 0.42)));
        scene.fog.color.copy(sb.fogColor).lerp(_nvgFog, nvgK * 0.7);
      }
    }
    if (p.torchOn) {
      const nvgScale = 1 - nvgK * (1 - (NV?.torchScale ?? 0.55));
      p.flashlight.intensity = G().torch.intensity * zk.torch * nvgScale;
    }
    if (api.post) {
      api.post.mat.uniforms.uNvg.value = nvgK;
      api.post.mat.uniforms.uTime.value = performance.now() * 0.001;
    }
    const nvgVis = nvgK > 0.01;
    document.body.classList.toggle('nvg-active', nvgVis);
    document.body.classList.toggle('nvg-nopost', nvgVis && !api.post);
    if (nvgVis) document.documentElement.style.setProperty('--nvg', nvgK.toFixed(3));
    // ciel
    api.sky?.update?.(dt);
    api.world?.trees?.update(performance.now() / 1000, camera.position);
    // ombres de contact des mobiles : zombies, coéquipiers, véhicules (à moins de maxDist de la caméra)
    if (contact.enabled && contact.dyn) {
      const C = G().contact, cx = camera.position.x, cz = camera.position.z, R2 = C.maxDist * C.maxDist;
      contact.beginDynamic();
      for (const z of game.zombies) {
        if (!z.group.visible || z.pos.y < -0.4 || z.dead && z.deathT > 2.2) continue;
        const dx = z.pos.x - cx, dz = z.pos.z - cz; if (dx * dx + dz * dz > R2) continue;
        const big = z.isBoss || z.isAngel ? 1.7 : z.crawler ? 1.15 : 0.8;
        contact.pushDynamic(z.pos.x, z.pos.y, z.pos.z, big * 1.1, big, 0, C.zombie);
      }
      for (const r of game.remotes.values()) {
        if (r.dead || !r.pos) continue;
        const dx = r.pos.x - cx, dz = r.pos.z - cz; if (dx * dx + dz * dz > R2) continue;
        contact.pushDynamic(r.pos.x, r.pos.y, r.pos.z, 0.85, 0.8, 0, C.zombie);
      }
      for (const v of game.vehicles || []) {
        if (!v.group.visible || v.state === 'gone') continue;
        const dx = v.pos.x - cx, dz = v.pos.z - cz; if (dx * dx + dz * dz > R2) continue;
        contact.pushDynamic(v.pos.x, v.pos.y, v.pos.z, 1.0, (v.def?.wheelbase || 1.3) + 1.1, v.yaw || 0, C.vehicle);
      }
      contact.endDynamic();
    }
  };

  // précompilation des shaders (main.js) : dans la cible de la passe finale quand elle est active (sinon chaque matériau serait compilé deux fois)
  api.compile = () => {
    if (api.post) { renderer.setRenderTarget(api.post.rt); renderer.compile(scene, camera); renderer.setRenderTarget(null); }
    else renderer.compile(scene, camera);
  };

  // ------------------------------------------------------------ rendu (remplace renderer.render(scene, camera))
  renderer.info.autoReset = false; // les statistiques (appels, triangles) couvrent la scène ET la passe finale
  api.render = () => {
    renderer.info.reset();
    if (!api.post) { renderer.render(scene, camera); return; }
    const P = api.post;
    renderer.setRenderTarget(P.rt);
    renderer.render(scene, camera);
    const AO = P.ao;
    if (AO) {
      const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
      AO.ssao.uniforms.uProjScale.value.set(tanHalfFov * camera.aspect, tanHalfFov);
      AO.ssao.uniforms.uNearFar.value.set(camera.near, camera.far);
      AO.blur.uniforms.uNearFar.value.set(camera.near, camera.far);
      P.mat.uniforms.uNearFar.value.set(camera.near, camera.far);
      if (scene.fog?.color) P.mat.uniforms.uHazeCol.value.copy(scene.fog.color);
      // 1) SSAO demi-résolution depuis le DepthTexture résolu
      renderer.setRenderTarget(AO.a); AO.qSsao.render(renderer);
      // 2) Flou bilatéral séparable (respecte les arêtes de profondeur)
      AO.blur.uniforms.tAo.value = AO.a.texture; AO.blur.uniforms.uDir.value.set(1.5 / AO.w, 0);
      renderer.setRenderTarget(AO.b); AO.qBlur.render(renderer);
      AO.blur.uniforms.tAo.value = AO.b.texture; AO.blur.uniforms.uDir.value.set(0, 1.5 / AO.h);
      renderer.setRenderTarget(AO.a); AO.qBlur.render(renderer);
      P.mat.uniforms.tAo.value = AO.a.texture;
    }
    const H = P.halo;
    if (H) { // halo : seuil -> flou horizontal -> flou vertical (demi-résolution), puis ajouté par la passe finale
      const R = G().halo.radius, au = 1 - G().halo.dawnFade * Math.min(1, api.skyK * 1.6);
      P.mat.uniforms.uHalo.value = G().halo.intensity * au;
      H.bright.uniforms.uThr.value.set(G().halo.threshold, G().halo.knee);
      renderer.setRenderTarget(H.a); H.qBright.render(renderer);
      H.blur.uniforms.tDiffuse.value = H.a.texture; H.blur.uniforms.uDir.value.set(R / H.w, 0);
      renderer.setRenderTarget(H.b); H.qBlur.render(renderer);
      H.blur.uniforms.tDiffuse.value = H.b.texture; H.blur.uniforms.uDir.value.set(0, R / H.h);
      renderer.setRenderTarget(H.a); H.qBlur.render(renderer);
      H.blur.uniforms.tDiffuse.value = H.a.texture; H.blur.uniforms.uDir.value.set(R * 2 / H.w, 0);  // seconde passe plus large : halo doux
      renderer.setRenderTarget(H.b); H.qBlur.render(renderer);
      H.blur.uniforms.tDiffuse.value = H.b.texture; H.blur.uniforms.uDir.value.set(0, R * 2 / H.h);
      renderer.setRenderTarget(H.a); H.qBlur.render(renderer);
    }
    renderer.setRenderTarget(null);
    P.quad.render(renderer);
  };

  return api;
}
