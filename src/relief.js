import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// =====================================================================
//  Façades en relief (v0.45.0) : encadrements de fenêtres saillants (la vitre se trouve ~15 cm en retrait), appuis, linteaux, balcons,
//  corniches, descentes de gouttière et cheminées, posés sur les murs dessinés par architecture.js.
//  - AUCUN effet sur le jeu : les collisions, la navigation et les zones de tir restent sur le contour des bâtiments ;
//  - AUCUN tirage `rnd` (les choix viennent d'un hachage de la position : le monde est identique, version après version) ;
//  - regroupé par tuiles : un InstancedMesh de fenêtres par tuile de 32 m ; un de balcons, un de corniches et un maillage fusionné (tuyaux, cheminées) par tuile de 64 m ;
//  - détail coupé au-delà de `range` m du joueur (CONFIG.graphics.levels[q].facade : 30 / 60 / 110 m) : les tuiles lointaines ne sont pas dessinées.
// =====================================================================

const FINE = 32, COARSE = 64; // tuiles (m) : fenêtres (nombreuses : coupure précise) ; balcons, corniches, tuyaux, cheminées
const OW = 1.25, OH = 1.85; // ouverture de référence de la géométrie d'encadrement

// Boîte dont on ne garde que certaines faces (groupes de BoxGeometry : 0 droite, 1 gauche, 2 dessus, 3 dessous, 4 avant, 5 arrière)
function boxFaces(w, h, d, x, y, z, keep = [0, 1, 2, 3, 4]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = [];
  for (const k of keep) { const gr = g.groups[k]; for (let i = 0; i < gr.count; i++) idx.push(g.index.array[gr.start + i]); }
  g.setIndex(idx);
  g.clearGroups();
  g.translate(x, y, z);
  return g;
}
const merge = (parts) => { const g = mergeGeometries(parts.map((p) => p.toNonIndexed())); parts.forEach((p) => p.dispose()); return g; };

// Encadrement : montants (15 cm de saillie), linteau et appui plus saillants (32 triangles). Origine : milieu du bas de l'ouverture, sur le plan du mur ; z vers l'extérieur
function trimGeometry() {
  const J = 0.15, DEPTH = 0.15;
  return merge([
    boxFaces(J, OH, DEPTH, -(OW / 2 + J / 2), OH / 2, DEPTH / 2, [0, 1, 4]),   // montant gauche (dessus et dessous cachés par le linteau et l'appui)
    boxFaces(J, OH, DEPTH, OW / 2 + J / 2, OH / 2, DEPTH / 2, [0, 1, 4]),      // montant droit
    boxFaces(OW + 0.56, 0.17, 0.2, 0, OH + 0.085, 0.1),                        // linteau mouluré
    boxFaces(OW + 0.46, 0.1, 0.23, 0, -0.05, 0.115),                            // appui
  ]);
}

// Balcon : dalle, garde-corps en fer (lisse, poteaux, barreaux en bandes plates). Origine : milieu du bas de l'ouverture
function balconyGeometry() {
  const W = 2.0, D = 0.62, parts = [boxFaces(W, 0.1, D, 0, -0.13, D / 2), boxFaces(W + 0.05, 0.05, 0.05, 0, 0.98, D, [2, 4, 0, 1]), boxFaces(0.05, 0.05, D, -W / 2, 0.98, D / 2, [2, 0, 1]), boxFaces(0.05, 0.05, D, W / 2, 0.98, D / 2, [2, 0, 1])];
  parts.push(boxFaces(0.05, 1.0, 0.05, -W / 2, 0.42, D, [4, 0, 1]), boxFaces(0.05, 1.0, 0.05, W / 2, 0.42, D, [4, 0, 1]));
  const bars = (x0, z0, dx, dz, n) => { // barreaux : bandes verticales plates (un seul plan chacune, rendu des deux côtés)
    for (let i = 1; i < n; i++) {
      const f = i / n, g = new THREE.PlaneGeometry(0.03, 0.88); g.rotateY(dx ? 0 : Math.PI / 2); g.translate(x0 + dx * f, 0.45, z0 + dz * f); parts.push(g);
    }
  };
  bars(-W / 2, D, W, 0, 9); bars(-W / 2, 0, 0, D, 3); bars(W / 2, 0, 0, D, 3);
  return merge(parts);
}


// Corniche d'une longueur de 1 m, à étirer sur la longueur du mur (échelle x) : bandeau et larmier saillant, vus de face et par en dessous.
// Origine : sur le plan du mur, au sommet (y = 0) ; z vers l'extérieur ; centrée sur x
function corniceGeometry() {
  return merge([
    boxFaces(1, 0.16, 0.1, 0, -0.18, 0.05, [4, 3]),   // bandeau
    boxFaces(1, 0.14, 0.26, 0, -0.03, 0.13, [4, 3]),  // larmier
  ]);
}

const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }; // 0..1, déterministe

export function createRelief() {
  const fine = new Map(), coarse = new Map(); // tuiles : clé -> données
  const mk = (cx, cz, half) => ({ cx, cz, half, win: [], bal: [], cor: [], pos: [], nor: [], col: [], idx: [] });
  const getTile = (map, size, x, z) => {
    const ix = Math.floor(x / size), iz = Math.floor(z / size), k = ix * 8192 + iz;
    let t = map.get(k);
    if (!t) map.set(k, t = mk((ix + 0.5) * size, (iz + 0.5) * size, size * 0.7072));
    return t;
  };
  let count = { windows: 0, balconies: 0, cornices: 0, staticTris: 0 };
  const _c = new THREE.Color();

  // ---- géométrie statique (tuyaux, cheminées) : couleurs de sommet
  const quad = (t, a, b, c, d, n, col) => {
    const base = t.pos.length / 3;
    t.pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) { t.nor.push(n[0], n[1], n[2]); t.col.push(col.r, col.g, col.b); }
    t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Prisme vertical (tuyau, cheminée) : n côtés, rayon r, de y0 à y1
  const prism = (t, x, z, r, y0, y1, sides, rot, col, cap = true) => {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [x + Math.cos(a0) * r, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, z + Math.sin(a1) * r];
      quad(t, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [Math.cos(am), 0, Math.sin(am)], col);
    }
    if (cap) { const base = t.pos.length / 3; t.pos.push(x, y1, z); t.nor.push(0, 1, 0); t.col.push(col.r, col.g, col.b); for (let i = 0; i <= sides; i++) { const a = rot + (i / sides) * Math.PI * 2; t.pos.push(x + Math.cos(a) * r, y1, z + Math.sin(a) * r); t.nor.push(0, 1, 0); t.col.push(col.r, col.g, col.b); } for (let i = 0; i < sides; i++) t.idx.push(base, base + 2 + i, base + 1 + i); }
  };

  const snap = (map) => new Map([...map].map(([k, t]) => [k, [t.win.length, t.bal.length, t.cor.length, t.pos.length, t.nor.length, t.col.length, t.idx.length]]));
  const restore = (map, m) => {
    for (const [k, t] of map) { const s = m.get(k) || [0, 0, 0, 0, 0, 0, 0]; t.win.length = s[0]; t.bal.length = s[1]; t.cor.length = s[2]; t.pos.length = s[3]; t.nor.length = s[4]; t.col.length = s[5]; t.idx.length = s[6]; }
  };

  const api = {
    count: () => count,
    // Marque / retour en arrière (architecture.js : un bâtiment « fantôme » est construit puis effacé, sans rien laisser)
    mark: () => ({ fine: snap(fine), coarse: snap(coarse) }),
    rollback(m) { restore(fine, m.fine); restore(coarse, m.coarse); },

    // Fenêtre : (x, z) centre de l'ouverture sur le plan du mur, y bas de l'ouverture, (nx, nz) sortant, sx / sy : échelle par rapport à 1,25 x 1,85 m
    window(x, y, z, nx, nz, sx, sy, color, balcony = false) {
      const yaw = Math.atan2(nx, nz);
      getTile(fine, FINE, x, z).win.push(x, y, z, yaw, sx, sy, color.r, color.g, color.b);
      if (balcony) getTile(coarse, COARSE, x, z).bal.push(x, y, z, yaw, sx, 1, color.r * 0.45, color.g * 0.45, color.b * 0.45);
    },
    // Corniche en haut d'un mur (de A à B) à la hauteur y ; (nx, nz) : sortant
    cornice(ax, az, bx, bz, nx, nz, y, color) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
      getTile(coarse, COARSE, mx, mz).cor.push(mx, y, mz, Math.atan2(nx, nz), len, 1, color.r, color.g, color.b);
    },
    // Descente de gouttière (tuyau gris-vert, section carrée à pans coupés)
    pipe(x, z, y0, y1) {
      prism(getTile(coarse, COARSE, x, z), x, z, 0.045, y0, y1, 5, 0.3, _c.setRGB(0.12, 0.13, 0.12), false);
    },
    // Cheminée de brique (corps + couronnement + conduit)
    chimney(x, z, y0, y1, w, rot, color) {
      const t = getTile(coarse, COARSE, x, z);
      prism(t, x, z, w * 0.72, y0, y1, 4, rot + Math.PI / 4, color, false);
      prism(t, x, z, w * 0.86, y1, y1 + 0.16, 4, rot + Math.PI / 4, _c.copy(color).multiplyScalar(0.8), true);
      prism(t, x, z, w * 0.5, y1 + 0.16, y1 + 0.5, 5, rot, _c.setRGB(0.1, 0.1, 0.1), true);
    },

    // Construit les maillages et les ajoute à la scène ; ils portent userData.lod (le préchauffage des shaders ne les affiche pas tous)
    finish(scene) {
      const trim = trimGeometry(), balc = balconyGeometry(), corn = corniceGeometry();
      const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
      const balMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
      const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
      const inst = (list, geo, mat, name, T) => {
        if (!list.length) return 0;
        const n = list.length / 9;
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        for (let i = 0; i < n; i++) {
          const o = i * 9;
          q.setFromAxisAngle(up, list[o + 3]);
          m4.compose(pos.set(list[o], list[o + 1], list[o + 2]), q, sc.set(list[o + 4], list[o + 5], 1));
          mesh.setMatrixAt(i, m4); mesh.setColorAt(i, col.setRGB(list[o + 6], list[o + 7], list[o + 8]));
        }
        mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true; mesh.castShadow = false;
        mesh.name = name; mesh.matrixAutoUpdate = false; mesh.userData.lod = true;
        scene.add(mesh);
        T.meshes.push(mesh);
        return n;
      };
      count = { windows: 0, balconies: 0, cornices: 0, staticTris: 0 };
      api.tiles = [];
      for (const t of fine.values()) {
        const T = { cx: t.cx, cz: t.cz, half: t.half, meshes: [] };
        count.windows += inst(t.win, trim, trimMat, 'relief:windows', T);
        if (T.meshes.length) api.tiles.push(T);
      }
      for (const t of coarse.values()) {
        const T = { cx: t.cx, cz: t.cz, half: t.half, meshes: [] };
        count.balconies += inst(t.bal, balc, balMat, 'relief:balconies', T);
        count.cornices += inst(t.cor, corn, trimMat, 'relief:cornices', T);
        if (t.idx.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
          g.setIndex(t.idx);
          g.computeBoundingSphere();
          const m = new THREE.Mesh(g, staticMat);
          m.receiveShadow = true; m.name = 'relief:static'; m.matrixAutoUpdate = false; m.userData.lod = true;
          scene.add(m); T.meshes.push(m);
          count.staticTris += t.idx.length / 3;
        }
        if (T.meshes.length) api.tiles.push(T);
      }
      fine.clear(); coarse.clear();
      api.px = 1e9; api.pz = 1e9;
      api.apply();
    },

    range: 60, px: 1e9, pz: 1e9, tiles: [],
    // Distance de coupure (m) : 0 = aucun relief
    setRange(r) { api.range = r; api.apply(); },
    // Les tuiles dont le bord est à plus de `range` m du joueur ne sont pas dessinées
    update(px, pz) { api.px = px; api.pz = pz; api.apply(); },
    apply() {
      const r = api.range;
      for (const T of api.tiles) {
        const vis = r > 0 && Math.hypot(T.cx - api.px, T.cz - api.pz) - T.half < r;
        for (const m of T.meshes) if (m.visible !== vis) m.visible = vis;
      }
    },
  };
  return api;
}

export { hash2 };
