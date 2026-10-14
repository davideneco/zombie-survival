import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Sol (v0.46.0) : VISUEL SEULEMENT (aucune collision, aucune navigation ne change ; les rails, quais, parkings et stations de vélos sont des
//  maillages à eux, posés au-dessus de ce sol et restent tels quels).
//  Le sol de pavés est un seul plan : on lui ajoute, dans son SHADER (aucun appel de rendu de plus) :
//   - un champ de distance aux façades (texture 1 canal, 1 m par pixel, calculée au chargement à partir des empreintes des bâtiments) :
//     trottoir de dalles le long des murs, bordure claire, caniveau sombre ;
//   - de la variation à grande échelle (teinte, mousse au pied des murs, taches d'huile et de saleté, rupture de la répétition des pavés)
//     à partir d'une petite texture de bruit périodique ;
//   - des flaques : zones où le pavé est sombre, lisse (rugosité ~0) et réfléchit le ciel d'ambiance de graphics.js ;
//  et, en un seul InstancedMesh, des plaques d'égout posées sur les chaussées ouvertes (placées par hachage : aucun tirage `rnd`).
// =====================================================================

const fract = (x) => x - Math.floor(x);
const hash2 = (x, z, k = 0) => fract(Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453);

// ---- bruit périodique 4 canaux (rrapide, lisse) : R grandes taches, V moyennes, B fines, A grain
function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4), lat = [5, 11, 29, 83];
  const rnd = (() => { let s = 90210; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (let c = 0; c < 4; c++) {
    const L = lat[c], g = new Float32Array(L * L).map(() => rnd());
    const g2 = new Float32Array(L * 2 * L * 2).map(() => rnd()); // seconde octave (réseau double)
    const samp = (arr, n, u, v) => {
      const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = arr[(y0 % n) * n + (x0 % n)], b = arr[(y0 % n) * n + ((x0 + 1) % n)], cc = arr[((y0 + 1) % n) * n + (x0 % n)], d = arr[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      data[(j * N + i) * 4 + c] = Math.round(255 * (0.65 * samp(g, L, u, v) + 0.35 * samp(g2, L * 2, u, v)));
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---- champ de distance signée aux empreintes (m, > 0 dehors), 1 canal 8 bits : (d + 3) / 16 sur [-3, 13] m
const SDF_MIN = -3, SDF_RANGE = 16;
function buildSdf(polys, x0, z0, W, H, cell) {
  const nx = Math.ceil(W / cell), nz = Math.ceil(H / cell);
  const cv = document.createElement('canvas'); cv.width = nx; cv.height = nz;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#000'; cx.fillRect(0, 0, nx, nz); cx.fillStyle = '#fff';
  for (const pts of polys) {
    cx.beginPath();
    for (let i = 0; i < pts.length; i++) { const px = (pts[i][0] - x0) / cell, pz = (pts[i][1] - z0) / cell; if (i) cx.lineTo(px, pz); else cx.moveTo(px, pz); }
    cx.closePath(); cx.fill();
  }
  const img = cx.getImageData(0, 0, nx, nz).data, n = nx * nz, INF = 1e9;
  const dOut = new Float32Array(n).fill(INF), dIn = new Float32Array(n).fill(INF);
  for (let i = 0; i < n; i++) { // graines : pixels de bord (couverture partielle), distance sous-pixel
    const c = img[i * 4] / 255;
    if (c >= 0.5) { if (c < 0.998) dIn[i] = c - 0.5; } else if (c > 0.002) dOut[i] = 0.5 - c;
  }
  const S2 = Math.SQRT2;
  const chamfer = (d, skipInside, inside) => {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = d[k];
      if (i > 0 && d[k - 1] + 1 < v) v = d[k - 1] + 1;
      if (j > 0) { const u = k - nx; if (d[u] + 1 < v) v = d[u] + 1; if (i > 0 && d[u - 1] + S2 < v) v = d[u - 1] + S2; if (i < nx - 1 && d[u + 1] + S2 < v) v = d[u + 1] + S2; }
      d[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = d[k];
      if (i < nx - 1 && d[k + 1] + 1 < v) v = d[k + 1] + 1;
      if (j < nz - 1) { const u = k + nx; if (d[u] + 1 < v) v = d[u] + 1; if (i < nx - 1 && d[u + 1] + S2 < v) v = d[u + 1] + S2; if (i > 0 && d[u - 1] + S2 < v) v = d[u - 1] + S2; }
      d[k] = v;
    }
  };
  chamfer(dOut); chamfer(dIn);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = img[i * 4] / 255;
    const sd = (c >= 0.5 ? -Math.min(dIn[i], 99) : Math.min(dOut[i], 99)) * cell;
    out[i] = Math.max(0, Math.min(255, Math.round(((sd - SDF_MIN) / SDF_RANGE) * 255)));
  }
  const t = new THREE.DataTexture(out, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return { tex: t, data: out, nx, nz };
}

// ---- plaque d'égout (fonte, motif en croisillons, nom de la ville) 128 x 128
function manholeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), r = 62;
  x.translate(64, 64);
  x.fillStyle = '#2a2a2a'; x.beginPath(); x.arc(0, 0, 64, 0, 7); x.fill(); // joint sombre
  x.fillStyle = '#4a4a48'; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
  x.strokeStyle = '#6a6a66'; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, r - 4, 0, 7); x.stroke();
  x.strokeStyle = '#2c2c2c'; x.lineWidth = 4;
  x.beginPath(); x.arc(0, 0, r - 12, 0, 7); x.stroke();
  x.lineWidth = 5; for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(-r + 14, i * 14); x.lineTo(r - 14, i * 14); x.stroke(); }
  x.save(); x.beginPath(); x.arc(0, 0, r - 13, 0, 7); x.clip(); x.restore();
  x.fillStyle = '#585854'; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (Math.hypot(i, j) < 3.4) { x.fillRect(i * 14 - 6, j * 14 - 5, 12, 10); }
  x.fillStyle = '#2c2c2c'; x.font = 'bold 15px sans-serif'; x.textAlign = 'center'; x.fillText('CUS', 0, 6);
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '160,140,110'},0.12)`; x.fillRect(Math.random() * 128 - 64, Math.random() * 128 - 64, 2, 2); } // rouille, poussière
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---- trottoir : bandes le long des façades (dalles, bordure claire, caniveau), un seul maillage plat posé sur le sol (polygonOffset)
function apronTexture() {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), G = CONFIG.graphics.ground, tot = G.apron + G.kerb + G.gutter, y1 = (G.apron / tot) * H, y2 = ((G.apron + G.kerb) / tot) * H;
  let seed = 555; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // dalles : 4 par période (0,72 m), 2 rangées (0,475 m) avec joints décalés
  const rows = 2, rh = y1 / rows, cw = W / 4;
  for (let r = 0; r < rows; r++) for (let i = -1; i < 5; i++) {
    const ox = i * cw + (r % 2) * cw / 2, oy = r * rh, t = 0.82 + R() * 0.36;
    x.fillStyle = `rgb(${Math.round(104 * t)},${Math.round(100 * t)},${Math.round(94 * t)})`; x.fillRect(ox, oy, cw, rh);
    for (let k = 0; k < 6; k++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,250,240'},${0.04 + R() * 0.06})`; const bx = ox + R() * cw, by = oy + R() * rh, br = 8 + R() * 22; const g = x.createRadialGradient(bx, by, 0, bx, by, br); g.addColorStop(0, x.fillStyle); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(bx - br, by - br, br * 2, br * 2); }
  }
  for (let k = 0; k < 2500; k++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.1})`; x.fillRect(R() * W, R() * y1, 1 + R() * 2, 1 + R() * 2); }
  x.strokeStyle = 'rgba(14,12,10,0.9)'; x.lineWidth = 3; // joints
  for (let r = 0; r <= rows; r++) { x.beginPath(); x.moveTo(0, r * rh); x.lineTo(W, r * rh); x.stroke(); }
  for (let r = 0; r < rows; r++) for (let i = -1; i < 5; i++) { const ox = i * cw + (r % 2) * cw / 2; x.beginPath(); x.moveTo(ox, r * rh); x.lineTo(ox, (r + 1) * rh); x.stroke(); }
  // bordure : granit clair, arête éclairée côté mur, ombre côté rue, joints rares
  x.fillStyle = '#7a776f'; x.fillRect(0, y1, W, y2 - y1);
  for (let k = 0; k < 800; k++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.12})`; x.fillRect(R() * W, y1 + R() * (y2 - y1), 1 + R() * 3, 1 + R() * 2); }
  x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(0, y1, W, 2.5);
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, y2 - 3, W, 3);
  x.strokeStyle = 'rgba(14,12,10,0.8)'; x.lineWidth = 2; for (const jx of [0, W / 2 + 9]) { x.beginPath(); x.moveTo(jx, y1); x.lineTo(jx, y2); x.stroke(); }
  // caniveau : pavés sombres mouillés, trait d'eau au milieu
  x.fillStyle = '#2a2a28'; x.fillRect(0, y2, W, H - y2);
  for (let k = 0; k < 120; k++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,120,115'},${0.1 + R() * 0.15})`; x.fillRect(R() * W, y2 + R() * (H - y2), 8 + R() * 14, 4 + R() * 8); }
  const g = x.createLinearGradient(0, y2, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.4, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.0)'); x.fillStyle = g; x.fillRect(0, y2, W, H - y2);
  x.fillStyle = 'rgba(150,170,190,0.15)'; x.fillRect(0, y2 + (H - y2) * 0.45, W, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
  return t;
}

function buildApron(scene, polys, api, onIsland) {
  const G = CONFIG.graphics.ground, tot = G.apron + G.kerb + G.gutter, rowsD = [0, G.apron, G.apron + G.kerb, tot], rowsV = [0, G.apron / tot, (G.apron + G.kerb) / tot, 1];
  const pos = [], uv = [], idx = [];
  const PERIOD = 2.88;
  for (const ring of polys) {
    const n = ring.length; if (n < 3) continue;
    // normales extérieures des arêtes (anneau orienté positivement dans le plan (x, z) : l'extérieur est à (dz, -dx))
    const nrm = [], len = [];
    for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; nrm.push([dz / l, -dx / l]); len.push(l); }
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, pi = ring[i], pj = ring[j], n0 = nrm[(i + n - 1) % n], n1 = nrm[i], n2 = nrm[j];
      const keep = len[i] > 0.6 && (() => {
        const mx = (pi[0] + pj[0]) / 2, mz = (pi[1] + pj[1]) / 2;
        return onIsland(mx + n1[0] * 0.6, mz + n1[1] * 0.6) && api.dist(mx + n1[0] * 0.6, mz + n1[1] * 0.6) > 0.35 && api.dist(mx + n1[0] * 1.5, mz + n1[1] * 1.5) > 1.25; // les ruelles de moins de ~2,8 m restent pavées : deux trottoirs s'y chevaucheraient
      })();
      // décalage aux sommets : bissectrice des normales (onglet limité)
      const off = (nA, nB) => { let bx = nA[0] + nB[0], bz = nA[1] + nB[1]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl; const c = Math.max(0.45, bx * nB[0] + bz * nB[1]); return [bx / c, bz / c]; };
      if (keep) {
        const mi = off(n0, n1), mj = off(n1, n2), base = pos.length / 3, u0 = u / PERIOD, u1 = (u + len[i]) / PERIOD;
        for (let k = 0; k < 4; k++) { pos.push(pi[0] + mi[0] * rowsD[k], 0.012, pi[1] + mi[1] * rowsD[k]); uv.push(u0, rowsV[k]); }
        for (let k = 0; k < 4; k++) { pos.push(pj[0] + mj[0] * rowsD[k], 0.012, pj[1] + mj[1] * rowsD[k]); uv.push(u1, rowsV[k]); }
        for (let k = 0; k < 3; k++) { const a = base + k, b = base + k + 1, c = base + 4 + k, d = base + 4 + k + 1; idx.push(a, c, b, b, c, d); }
      }
      u += len[i];
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: apronTexture(), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.frustumCulled = false; m.receiveShadow = true; m.name = 'apron';
  scene.add(m);
  return m;
}

// ------------------------------------------------------------------ API
// opts : { mesh : plan du sol (son matériau est modifié), polys : empreintes [[x, z]…] des bâtiments pleins, bounds : { x0, z0, w, h }, onIsland(x, z), tramDist(x, z) }
export function createGround(scene, { mesh, polys, bounds, onIsland, tramDist }) {
  const G = CONFIG.graphics.ground;
  const sdf = buildSdf(polys, bounds.x0, bounds.z0, bounds.w, bounds.h, G.cell);
  const noise = noiseTexture();
  const api = { sdf, noise, manholes: null, uniforms: null, apron: null };
  // distance signée (m) en un point (côté JS) : placement des plaques
  api.dist = (x, z) => {
    const i = Math.floor((x - bounds.x0) / G.cell), j = Math.floor((z - bounds.z0) / G.cell);
    if (i < 0 || j < 0 || i >= sdf.nx || j >= sdf.nz) return 99;
    return (sdf.data[j * sdf.nx + i] / 255) * SDF_RANGE + SDF_MIN;
  };

  api.apron = buildApron(scene, polys, api, onIsland);
  const mat = mesh.material;
  mat.userData.groundUniforms = {};
  mat.onBeforeCompile = (sh) => {
    const U = {
      tSdf: { value: sdf.tex }, tNoise: { value: noise }, uOrigin: { value: new THREE.Vector2(bounds.x0, bounds.z0) }, uSize: { value: new THREE.Vector2(sdf.nx * G.cell, sdf.nz * G.cell) },
      uTexel: { value: 1 / sdf.nx }, uCell: { value: G.cell },
      uApron: { value: new THREE.Vector4(G.apron, G.kerb, G.gutter, G.apron + G.kerb + G.gutter) }, // .w : largeur totale du trottoir (pas de flaque dessus)
      uPuddle: { value: new THREE.Vector4(G.puddle.from, G.puddle.to, G.puddle.reflect, G.puddle.darken) },
    };
    Object.assign(sh.uniforms, U); api.uniforms = U;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGPos;
        uniform sampler2D tSdf; uniform sampler2D tNoise; uniform vec2 uOrigin; uniform vec2 uSize; uniform float uTexel; uniform float uCell;
        uniform vec4 uApron; uniform vec4 uPuddle;
        float gSd; float gApron; float gKerb; float gGutter; float gPud; float gWet;
        float sdfAt(vec2 p) { return texture2D(tSdf, (p - uOrigin) / uSize).r * ${SDF_RANGE.toFixed(1)} + (${SDF_MIN.toFixed(1)}); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 gp = vGPos.xz;
          vec2 suv = (gp - uOrigin) / uSize;
          bool inside = suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0;
          gSd = inside ? sdfAt(gp) : 99.0;
          // bruit : grandes taches (90 m), moyennes (23 m), fines (5,5 m), grain (1,3 m)
          float nL = texture2D(tNoise, gp / 90.0).r, nM = texture2D(tNoise, gp / 23.0 + 0.37).g, nF = texture2D(tNoise, gp / 5.5 + 0.61).b, nG = texture2D(tNoise, gp / 1.3).a;
          // rupture de la répétition des pavés : luminosité d'une seconde échelle, désalignée
          float l2 = dot(texture2D(map, vMapUv * 0.31 + vec2(0.17, 0.43)).rgb, vec3(0.333));
          diffuseColor.rgb *= 0.78 + 0.5 * clamp(l2 * 1.6, 0.0, 1.0) * 0.8;
          // variation à grande échelle : plus clair / plus sombre, un peu plus chaud ou plus froid
          diffuseColor.rgb *= vec3(0.80 + 0.40 * nL) * mix(vec3(0.96, 1.0, 1.06), vec3(1.07, 1.0, 0.92), smoothstep(0.3, 0.7, nM));
          // mousse au pied des murs
          float nearWall = 1.0 - smoothstep(0.4, 4.0, gSd);
          float moss = smoothstep(0.6, 0.8, nM * 0.6 + nF * 0.4) * nearWall * step(0.0, gSd);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.8, 0.46) + vec3(0.01, 0.02, 0.0), moss * 0.7);
          // taches (huile, saleté)
          float stain = smoothstep(0.7, 0.88, nF * 0.65 + nG * 0.35) * smoothstep(0.35, 0.6, nM);
          diffuseColor.rgb *= 1.0 - 0.5 * stain;
          gApron = 0.0; gKerb = 0.0; gGutter = 0.0; // (le trottoir est un maillage à part : buildApron)
          // flaques : bruit seuillé (bord irrégulier), seulement en terrain dégagé ; anneau humide autour
          float pn = nL * 0.45 + nM * 0.4 + nF * 0.15;
          float openG = smoothstep(uApron.w, uApron.w + 0.6, gSd);
          float pd = smoothstep(uPuddle.x, uPuddle.y, pn + (nG - 0.5) * 0.04) * openG * (1.0 - gKerb);
          gPud = pd;
          gWet = smoothstep(uPuddle.x - 0.07, uPuddle.y, pn) * openG;
          diffuseColor.rgb *= 1.0 - 0.28 * gWet;           // pavé mouillé : plus sombre
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uPuddle.w, pd);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, gApron * 0.7);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, gWet);
        roughnessFactor = mix(roughnessFactor, 0.045, gPud);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, clamp(gApron * 0.85 + gKerb * 0.5 + gPud, 0.0, 1.0)));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular *= 1.0 + gPud * uPuddle.z;`);
  };
  mat.customProgramCacheKey = () => 'ground-v1';
  mat.needsUpdate = true;

  // ---- plaques d'égout : une grille de 34 m, un point par cellule (hachage), seulement sur chaussée ouverte de l'île, loin des rails
  {
    const list = [], S = G.manholeGrid;
    for (let gx = Math.floor(bounds.x0 / S); gx <= Math.floor((bounds.x0 + bounds.w) / S); gx++) for (let gz = Math.floor(bounds.z0 / S); gz <= Math.floor((bounds.z0 + bounds.h) / S); gz++) {
      if (hash2(gx, gz, 1) > G.manholeChance) continue;
      const x = (gx + 0.15 + 0.7 * hash2(gx, gz, 2)) * S, z = (gz + 0.15 + 0.7 * hash2(gx, gz, 3)) * S;
      if (!onIsland(x, z) || api.dist(x, z) < G.apron + G.kerb + G.gutter + 0.5 || (tramDist && tramDist(x, z) < 5)) continue;
      list.push([x, z, hash2(gx, gz, 4) * 6.28318]);
    }
    if (list.length) {
      const geo = new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: manholeTexture(), roughness: 0.55, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), list.length);
      const d = new THREE.Object3D();
      list.forEach(([x, z, a], i) => { d.position.set(x, 0.012, z); d.rotation.set(0, a, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
      m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.receiveShadow = true; m.name = 'manholes';
      scene.add(m); api.manholes = m;
    }
  }
  return api;
}
