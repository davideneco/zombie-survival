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
    // l'image est DÉJÀ tone-mappée (voir makePost) : conversion sRGB, puis table de couleurs
    vec4 base = texture2D(tDiffuse, vUv);
    #ifdef HALO
    base.rgb += texture2D(tHalo, vUv).rgb * uHalo;
    #endif
    gl_FragColor = sRGBTransferOETF(base);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, lutSample(gl_FragColor.rgb), uGrade);
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
    renderer.toneMapping = TONES[name] ?? THREE.ACESFilmicToneMapping;
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  };
  // exposition : valeur de base x Luminosité (Options) x zone ; hemi suit la Luminosité (inchangé)
  api.applyExposure = () => {
    renderer.toneMappingExposure = G().tone.exposure * settings.brightness * api.zoneK.exposure;
  };

  // ------------------------------------------------------------ reflets d'ambiance (PMREM d'un petit ciel)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCanvas = document.createElement('canvas'); envCanvas.width = 512; envCanvas.height = 256;
  const buildEnv = (k = 0) => {
    const E = G().env, x = envCanvas.getContext('2d'), W = 512, H = 256;
    const gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, pickCss(E.top, k)); gr.addColorStop(0.42, pickCss(E.mid, k)); gr.addColorStop(0.5, pickCss(E.horizon, k)); gr.addColorStop(0.56, pickCss(E.ground, k)); gr.addColorStop(1, pickCss(E.ground, k));
    x.globalCompositeOperation = 'source-over'; x.fillStyle = gr; x.fillRect(0, 0, W, H);
    const glowK = 1 - sm(Math.min(1, k * 1.4)); // les lampadaires s'éteignent à l'aube
    const blob = (u, v, r, col, a) => { const g = x.createRadialGradient(u, v, 0, u, v, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); x.fillStyle = g; x.fillRect(u - r, v - r, r * 2, r * 2); };
    if (glowK > 0.01) for (let i = 0; i < E.lamps; i++) { // lueurs sodium au ras de l'horizon, à des azimuts fixes
      const u = ((i + 0.5 + Math.sin(i * 12.9898) * 0.3) / E.lamps) * W; blob(u, H * (0.5 + 0.02 * Math.sin(i * 7.1)), 28 + (i % 3) * 10, 'rgba(255,170,80,A)', E.lampStrength * glowK);
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
    // Cible multi-échantillonnée en demi-flottants (précision dans les noirs). Astuce : `isXRRenderTarget` fait appliquer à CHAQUE matériau le tone
    // mapping avant l'écriture (comme pour l'écran) : la résolution MSAA moyenne des valeurs déjà ramenées dans [0, 1]. Une cible HDR ordinaire
    // moyennerait des valeurs > 1 AVANT le tone mapping et laisserait des « lucioles » blanches le long des arêtes très contrastées (bords de toits
    // sur le ciel). La conversion sRGB et la table de couleurs viennent ensuite (passe finale).
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    rt.isXRRenderTarget = true;
    const lut = buildLut();
    const H = G().halo, halo = H.enabled && settings.halo !== false && (api.level?.halo ?? true);
    const mat = new THREE.RawShaderMaterial({ uniforms: { tDiffuse: { value: rt.texture }, tLut: { value: lut }, uGrade: { value: 1 }, tHalo: { value: null }, uHalo: { value: H.intensity } }, defines: halo ? { HALO: 1 } : {}, vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false });
    api.post = { rt, mat, lut, quad: new FullScreenQuad(mat), w: size.x, h: size.y, halo: null };
    if (halo) {
      const hw = Math.max(2, Math.floor(size.x / 2)), hh = Math.max(2, Math.floor(size.y / 2));
      const mk = () => new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace });
      const a = mk(), b = mk();
      const raw = (frag, uniforms) => new THREE.RawShaderMaterial({ uniforms, vertexShader: POST_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
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
    renderer.setPixelRatio(L.pixelRatio === 'device' ? Math.min(window.devicePixelRatio, 2) : L.pixelRatio);
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
    if (api.post) { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); api.post.rt.setSize(s.x, s.y); api.post.w = s.x; api.post.h = s.y; const h = api.post.halo; if (h) { h.w = Math.max(2, s.x >> 1); h.h = Math.max(2, s.y >> 1); h.a.setSize(h.w, h.h); h.b.setSize(h.w, h.h); } }
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
  api.update = (dt) => {
    const game = api.game; if (!game || !api.world) return;
    const p = game.player;
    // zone courante : exposition, intensité des reflets et de la torche (lissées : pas de saut en franchissant une porte)
    let name = null;
    if (api.world.zoneOf) { const zi = api.world.zoneOf(p.pos.x, p.pos.z); name = zi >= 0 ? api.world.zoneNames[zi] : null; }
    const Z = G().zones[name] || G().zones.default, k = 1 - Math.exp(-dt * G().zoneBlend);
    const zk = api.zoneK;
    zk.exposure += (Z.exposure - zk.exposure) * k; zk.env += (Z.env - zk.env) * k; zk.torch += (Z.torch - zk.torch) * k;
    api.zone = name;
    api.applyExposure();
    scene.environmentIntensity = G().env.enabled ? envIntensity() : 0;
    setEnvTint(G().env.enabled ? pickN(G().env.phaseIntensity, api.skyK) * zk.env : 0);
    if (p.torchOn) p.flashlight.intensity = G().torch.intensity * zk.torch;
    // ciel
    api.sky?.update?.(dt);
    api.world?.trees?.update(performance.now() / 1000);
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
    const H = P.halo;
    if (H) { // halo : seuil -> flou horizontal -> flou vertical (demi-résolution), puis ajouté par la passe finale
      const R = G().halo.radius, au = 1 - G().halo.dawnFade * Math.min(1, api.skyK * 1.6);
      P.mat.uniforms.uHalo.value = G().halo.intensity * au;
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
