import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Dôme du ciel (v0.44.0) : UN maillage, UN shader, un seul appel de rendu.
//   - dégradé haut / milieu / bas (repeint par l'Acte V : summit.js appelle setGradient puis setK) ;
//   - nuages qui dérivent lentement (bruit fractal, pas de texture), éclairés par la lune la nuit, blancs le jour ;
//   - disque lunaire et halo (visibles seulement la nuit : k = 0 ; ils s'effacent avec l'aube).
//  Le dôme suit le joueur (realworld.js : group.position) et n'est pas touché par le brouillard.
// =====================================================================

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform vec3 uTop, uMid, uBot, uCloudNight, uMoonDir;
  uniform float uTime, uMoon, uCloud, uDay, uMoonSize;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5; // 1 au zénith, 0.5 à l'horizon
    vec3 col = v > 0.45 ? mix(uMid, uTop, (v - 0.45) / 0.55) : mix(uBot, uMid, v / 0.45);

    float md = max(dot(d, uMoonDir), 0.0);
    // nuages : plan projeté, deux couches qui dérivent à des vitesses différentes
    float dens = 0.0;
    if (uCloud > 0.0 && d.y > 0.0) {
      vec2 cp = d.xz / (d.y + 0.3);
      float c1 = fbm(cp * 1.5 + vec2(uTime * 0.010, uTime * 0.004));
      float c2 = fbm(cp * 3.6 + vec2(-uTime * 0.016, uTime * 0.006) + 7.0);
      dens = smoothstep(0.46, 0.80, c1 * 0.78 + c2 * 0.34) * smoothstep(0.03, 0.30, d.y) * uCloud;
      vec3 night = uCloudNight * (1.0 + 3.0 * pow(md, 14.0) * uMoon);
      vec3 day = mix(uMid * 1.25 + 0.1, vec3(1.0), 0.65);
      vec3 cc = mix(night, day, uDay) * (0.75 + 0.5 * c2);
      col = mix(col, cc, dens * 0.82);
    }
    // lune : disque légèrement tacheté + halo (cachés par les nuages épais)
    if (uMoon > 0.0) {
      float cr = cos(uMoonSize);
      float disc = smoothstep(cr, cr + 0.00035, md);
      float maria = vnoise(d.xy * 90.0 + d.z * 40.0) * 0.5 + vnoise(d.zy * 210.0) * 0.25;
      vec3 moonCol = vec3(1.0, 0.96, 0.85) * (2.3 - 0.9 * maria);
      float halo = pow(md, 700.0) * 0.55 + pow(md, 60.0) * 0.18 + pow(md, 9.0) * 0.05;
      col += uMoon * (halo * vec3(0.55, 0.68, 1.0) * (1.0 - 0.6 * dens));
      col = mix(col, moonCol, disc * uMoon * (1.0 - 0.92 * dens));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeSkyDome(radius = 300) {
  const C = CONFIG.graphics.sky;
  const el = C.moonElevation, az = C.moonAzimuth;
  const uniforms = {
    uTop: { value: new THREE.Color('#04070d') }, uMid: { value: new THREE.Color('#0c1522') }, uBot: { value: new THREE.Color('#1b2535') },
    uCloudNight: { value: new THREE.Color(C.cloudNight) }, uMoonDir: { value: new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize() },
    uTime: { value: 0 }, uMoon: { value: 1 }, uCloud: { value: C.cloudCover }, uDay: { value: 0 }, uMoonSize: { value: C.moonSize },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), mat);
  mesh.renderOrder = -1;
  let cloud = C.cloudCover;
  return {
    mesh,
    uniforms,
    setGradient(top, mid, bot) { uniforms.uTop.value.set(top); uniforms.uMid.value.set(mid); uniforms.uBot.value.set(bot); },
    // k : 0 nuit, 0,5 aube, 1 plein jour (summit.js) : la lune s'efface, les nuages passent du bleu nuit au blanc
    setK(k) {
      const s = (x) => x * x * (3 - 2 * x);
      uniforms.uMoon.value = 1 - s(Math.min(1, k / 0.35));
      uniforms.uDay.value = s(Math.min(1, Math.max(0, (k - 0.25) / 0.6)));
    },
    setCloud(v) { cloud = v; uniforms.uCloud.value = v; },
    get cloud() { return cloud; },
    update(dt) { uniforms.uTime.value += dt; },
  };
}
