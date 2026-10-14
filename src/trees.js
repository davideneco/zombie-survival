import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Arbres (v0.46.0) : VISUEL SEULEMENT (les collisions et les ombres de contact restent celles de realworld.js).
//  Selon la qualité (CONFIG.graphics.levels[q].trees) :
//   - 'ball'           (Rapide)  : tronc + deux boules lissées (sommets mélangés, normales lissées, dégradé de couleur) ;
//   - 'cards'          (Normale) : tronc + grappes de cartes de feuillage (atlas canvas partagé), un seul InstancedMesh ;
//   - 'cards+branches' (Haute)   : plus de cartes, plus des branches (un InstancedMesh de cylindres effilés).
//  Tout est instancié (1 appel de rendu par couche) ; les cartes ont une normale « de couronne » (vers l'extérieur et le haut) : elles
//  s'éclairent comme un volume, pas comme du papier. Aucun tirage `rnd` : l'apparence d'un arbre vient d'un hachage de sa position.
//  Les maillages d'un mode ne sont créés qu'à sa première utilisation (changer de qualité en jeu reste possible).
// =====================================================================

const fract = (x) => x - Math.floor(x);
const hash = (x, z, k = 0) => fract(Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453);

// aléa reproductible pour l'atlas
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Atlas de feuillage : 2 x 2 grappes de feuilles (disque de feuilles pointues sur fond transparent), de l'ombre (en bas, au centre) à la lumière (en haut)
function foliageAtlas() {
  const S = CONFIG.graphics.trees.atlas, N = 2, cell = S / N;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = rng(7771);
  for (let k = 0; k < N * N; k++) {
    const ox = (k % N) * cell, oy = Math.floor(k / N) * cell, cx = ox + cell / 2, cy = oy + cell / 2, rad = cell / 2 - 6;
    // branchettes sous le feuillage
    x.strokeStyle = '#2a2016'; x.lineWidth = 2.2;
    for (let i = 0; i < 7; i++) { const a = R() * Math.PI * 2, r = rad * (0.35 + R() * 0.45); x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5 + 6, cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke(); }
    const leaves = [];
    for (let i = 0; i < 230; i++) {
      const a = R() * Math.PI * 2, r = rad * Math.sqrt(R()) * (0.96 + R() * 0.04);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.92;
      const up = 1 - (py - (cy - rad)) / (2 * rad); // 0 en bas, 1 en haut
      leaves.push({ px, py, up, rot: R() * Math.PI * 2, len: 13 + R() * 10, wid: 6 + R() * 4, d: R() });
    }
    leaves.sort((p, q) => (p.up * 0.7 + p.d * 0.3) - (q.up * 0.7 + q.d * 0.3)); // l'ombre d'abord, la lumière dessus
    for (const L of leaves) {
      const lit = 0.15 + 0.27 * L.up + 0.1 * L.d, hue = 84 + R() * 26 - L.up * 6, sat = 26 + R() * 18;
      x.save(); x.translate(L.px, L.py); x.rotate(L.rot);
      x.fillStyle = `hsl(${hue},${sat}%,${lit * 100}%)`; x.strokeStyle = `hsl(${hue},${sat}%,${lit * 55}%)`; x.lineWidth = 1;
      x.beginPath(); x.moveTo(-L.len / 2, 0); x.quadraticCurveTo(0, -L.wid, L.len / 2, 0); x.quadraticCurveTo(0, L.wid, -L.len / 2, 0); x.fill(); x.stroke();
      x.strokeStyle = `hsla(${hue + 14},${sat}%,${Math.min(70, lit * 100 + 12)}%,0.55)`; x.beginPath(); x.moveTo(-L.len / 2 + 1, 0); x.lineTo(L.len / 2 - 2, 0); x.stroke(); // nervure
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// texture de feuillage opaque (128 x 128, bords raccordés) pour les boules de la qualité Rapide : masse de feuilles sombres et claires, sans transparence
function leafyTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = rng(5151);
  x.fillStyle = '#1c2c14'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const px = R() * S, py = R() * S, lit = 0.12 + 0.26 * R(), hue = 84 + R() * 26;
    x.fillStyle = `hsl(${hue},${28 + R() * 18}%,${lit * 100}%)`;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { x.save(); x.translate(px + ox, py + oy); x.rotate(R() * 6.28); x.beginPath(); x.ellipse(0, 0, 7 + R() * 5, 3 + R() * 2, 0, 0, 7); x.fill(); x.restore(); R(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// matériau de feuillage : cartes à normale de couronne (attribut d'instance aLocalN), choix de la grappe dans l'atlas (aCell), ondulation légère au vent
function foliageMaterial(atlas) {
  const T = CONFIG.graphics.trees;
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.46, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = m.userData.wind = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLocalN; attribute vec2 aCell; uniform float uWind;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(aLocalN);')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.5 + aCell;\n#endif')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float sway = sin(uWind * 1.7 + mvPosition.x * 0.45 + mvPosition.z * 0.37) * ${T.sway.toFixed(3)} * (0.4 + 0.6 * clamp(mvPosition.y * 0.18, 0.0, 1.0));
        mvPosition.x += sway; mvPosition.z += sway * 0.7;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')); // la normale de couronne vaut des deux côtés de la carte
  };
  m.customProgramCacheKey = () => 'foliage-v1';
  return m;
}

// tronc : section qui s'évase au pied (racines) et s'effile ; hauteur 1 (mise à l'échelle par instance), origine au sol
function trunkGeometry() {
  const pts = [[0.4, 0], [0.31, 0.03], [0.25, 0.11], [0.21, 0.5], [0.17, 1]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 10);
  return g;
}
// branche : cylindre effilé de longueur 1 le long de +y, base à l'origine
function branchGeometry() { return new THREE.CylinderGeometry(0.022, 0.07, 1, 5, 1, true).translate(0, 0.5, 0); }

// boule lissée : icosaèdre subdivisé aux sommets mélangés (bosselée), normales lissées, noir en bas -> clair en haut (couleurs de sommet)
function ballGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const bump = 1 + 0.13 * Math.sin(v.x * 4.1 + v.z * 2.3) * Math.cos(v.y * 3.7 + v.x * 1.9) + 0.07 * Math.sin(v.z * 7.7 + v.y * 5.3);
    p.setXYZ(i, v.x * bump, v.y * bump * 0.85, v.z * bump);
    const k = 0.52 + 0.48 * (v.y * 0.5 + 0.5);
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = new Float32Array(p.count * 2); // projection plane (x + z / 2, y + z / 3) : la masse de feuilles tolère l'étirement
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i) * 0.5) * 1.6; uv[i * 2 + 1] = (p.getY(i) + p.getZ(i) * 0.3) * 1.6; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ API
// list : [{ x, z, th }] (th : hauteur du tronc, m) ; barkMat : matériau d'écorce (realworld.js)
export function createTrees(scene, list, barkMat) {
  const T = CONFIG.graphics.trees, N = list.length;
  const Z = new THREE.Vector3(0, 0, 1), qr = new THREE.Quaternion(), dummy = new THREE.Object3D(), q = new THREE.Quaternion(), qi = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
  const tints = [0xd8e4c0, 0xc4d8a4, 0xe2e8b8, 0xb8d09c, 0xd0e0a8, 0xe8dfa0].map((c) => new THREE.Color(c));
  const api = { mode: null, meshes: {}, group: new THREE.Group(), N };
  api.group.name = 'trees'; scene.add(api.group);
  let atlas = null, foliageMat = null;

  const ensureTrunk = () => {
    if (api.meshes.trunk) return;
    const m = new THREE.InstancedMesh(trunkGeometry(), barkMat, N);
    list.forEach((t, i) => {
      const s = 0.85 + 0.35 * hash(t.x, t.z, 3);
      dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, hash(t.x, t.z, 4) * 6.28, 0); dummy.scale.set(s, t.th + 0.5, s); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true;
    api.meshes.trunk = m; api.group.add(m);
  };

  const ensureBalls = () => {
    if (api.meshes.ball) return;
    const per = 2, m = new THREE.InstancedMesh(ballGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true, map: leafyTexture() }), N * per);
    list.forEach((t, i) => {
      const hc = hash(t.x, t.z, 9), col = tints[Math.floor(hc * tints.length)].clone().multiplyScalar(0.95);
      for (let k = 0; k < per; k++) {
        const a = hash(t.x, t.z, 20 + k) * 6.28, off = k === 0 ? 0.2 : 1.0 + 0.5 * hash(t.x, t.z, 30);
        const r = (k === 0 ? 2.0 : 1.45) * (0.85 + 0.3 * hash(t.x, t.z, 40 + k));
        dummy.position.set(t.x + Math.cos(a) * off, t.th + (k === 0 ? 1.0 : 1.5 + hash(t.x, t.z, 50) * 0.5), t.z + Math.sin(a) * off);
        dummy.rotation.set(0, a, 0); dummy.scale.set(r, r, r); dummy.updateMatrix();
        m.setMatrixAt(i * per + k, dummy.matrix); m.setColorAt(i * per + k, col);
      }
    });
    m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    api.meshes.ball = m; api.group.add(m);
  };

  const ensureCards = () => {
    if (api.meshes.cards) return;
    atlas = foliageAtlas(); foliageMat = foliageMaterial(atlas);
    const nc = T.cards[1], total = N * nc;
    const geo = new THREE.PlaneGeometry(1, 1);
    const aN = new Float32Array(total * 3), aCell = new Float32Array(total * 2);
    const m = new THREE.InstancedMesh(geo, foliageMat, total);
    const col = new THREE.Color();
    // ordre « carte d'abord » : les premières N x cards[0] instances sont les premières cartes de CHAQUE arbre (mesh.count règle la densité de la qualité)
    for (let c = 0; c < nc; c++) for (let i = 0; i < N; i++) {
      const t = list[i], idx = c * N + i, k = c * 7.31;
      const crown = (0.85 + 0.35 * hash(t.x, t.z, 5)) * T.crownRadius, cy = t.th + T.crownHeight;
      // position dans l'ellipsoïde de la couronne (plus dense au bord : on voit des feuilles, pas un trou)
      const u = hash(t.x, t.z, 100 + k) * 2 - 1, a = hash(t.x, t.z, 200 + k) * 6.28318, rr = Math.sqrt(1 - u * u) * (0.45 + 0.55 * Math.sqrt(hash(t.x, t.z, 300 + k)));
      const px = Math.cos(a) * rr * crown, pz = Math.sin(a) * rr * crown, py = u * crown * 0.78;
      // orientation : la carte est tangente à la couronne (normale vers l'extérieur et le haut, un peu perturbée) : vue de face de partout, jamais de tranche
      tmpW.set(px / crown, py / crown * 0.9 + 0.5, pz / crown).normalize();
      tmpV.set(hash(t.x, t.z, 400 + k) - 0.5, hash(t.x, t.z, 500 + k) - 0.5, hash(t.x, t.z, 600 + k) - 0.5).multiplyScalar(1.1).add(tmpW).normalize();
      q.setFromUnitVectors(Z, tmpV).multiply(qr.setFromAxisAngle(Z, hash(t.x, t.z, 700 + k) * 6.28318));
      const size = T.cardSize[0] + (T.cardSize[1] - T.cardSize[0]) * hash(t.x, t.z, 800 + k);
      dummy.position.set(t.x + px, cy + py, t.z + pz); dummy.quaternion.copy(q); dummy.scale.setScalar(size); dummy.updateMatrix();
      m.setMatrixAt(idx, dummy.matrix);
      // normale d'éclairage : celle de la couronne (du centre vers la carte, relevée), exprimée dans le repère local de la carte
      tmpV.copy(tmpW).applyQuaternion(qi.copy(q).invert());
      aN[idx * 3] = tmpV.x; aN[idx * 3 + 1] = tmpV.y; aN[idx * 3 + 2] = tmpV.z;
      const cell = Math.floor(hash(t.x, t.z, 900 + k) * 4);
      aCell[idx * 2] = (cell % 2) * 0.5; aCell[idx * 2 + 1] = Math.floor(cell / 2) * 0.5;
      // teinte : propre à l'arbre, assombrie vers l'intérieur et le bas de la couronne (faux occlusion ambiante)
      const inner = 1 - Math.min(1, rr + Math.max(0, u) * 0.4);
      col.copy(tints[Math.floor(hash(t.x, t.z, 9) * tints.length)]).multiplyScalar(0.6 + 0.42 * (u * 0.5 + 0.5) - 0.26 * inner);
      m.setColorAt(idx, col);
    }
    geo.setAttribute('aLocalN', new THREE.InstancedBufferAttribute(aN, 3));
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 2));
    m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    api.meshes.cards = m; api.group.add(m);
  };

  const ensureBranches = () => {
    if (api.meshes.branches) return;
    const nb = T.branches, m = new THREE.InstancedMesh(branchGeometry(), barkMat, N * nb), up = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => {
      for (let b = 0; b < nb; b++) {
        const a = (b / nb) * 6.28318 + hash(t.x, t.z, 60 + b) * 1.1, lean = 0.55 + 0.6 * hash(t.x, t.z, 70 + b);
        const h0 = t.th * (0.55 + 0.4 * (b / nb)) + hash(t.x, t.z, 80 + b) * 0.3, len = 1.3 + 1.1 * hash(t.x, t.z, 90 + b);
        tmpV.set(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
        q.setFromUnitVectors(up, tmpV);
        const g = 0.8 + 0.5 * hash(t.x, t.z, 95 + b) - 0.35 * (h0 / t.th - 0.55);
        dummy.position.set(t.x, h0, t.z); dummy.quaternion.copy(q); dummy.scale.set(g, len, g); dummy.updateMatrix();
        m.setMatrixAt(i * nb + b, dummy.matrix);
      }
    });
    m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true;
    api.meshes.branches = m; api.group.add(m);
  };

  // mode : 'ball' | 'cards' | 'cards+branches'
  api.setMode = (mode) => {
    if (mode === api.mode) return;
    api.mode = mode;
    ensureTrunk();
    if (mode === 'ball') ensureBalls();
    else { ensureCards(); api.meshes.cards.count = N * (mode === 'cards+branches' ? T.cards[1] : T.cards[0]); }
    if (mode === 'cards+branches') ensureBranches();
    const M = api.meshes;
    if (M.ball) M.ball.visible = mode === 'ball';
    if (M.cards) M.cards.visible = mode !== 'ball';
    if (M.branches) M.branches.visible = mode === 'cards+branches';
    // arbres : un tronc plus haut dans les cartes (les branches n'existent qu'en Haute)
  };
  api.update = (t) => { if (foliageMat?.userData.wind) foliageMat.userData.wind.value = t; };
  return api;
}
