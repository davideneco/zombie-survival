import * as THREE from 'three';

// =====================================================================
//  Mobilier urbain et décors : modèles low-poly arrondis, affichés par instanciation
//  (un appel de dessin par type d'objet et par matériau, quel que soit leur nombre).
// =====================================================================

// ------------------------------------------------------------------ Textures procédurales
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const plankTex = () => canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#7a5434'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const y = (i * h) / 4;
    x.fillStyle = `hsl(28, ${30 + i * 4}%, ${26 + (i % 2) * 6}%)`; x.fillRect(0, y + 2, w, h / 4 - 4);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
    for (let k = 0; k < 10; k++) { x.beginPath(); x.moveTo(0, y + 6 + k * 5); x.bezierCurveTo(w * 0.3, y + 4 + k * 5, w * 0.6, y + 9 + k * 5, w, y + 6 + k * 5); x.stroke(); }
    x.fillStyle = '#2a1a10'; x.fillRect(0, y, w, 2);
    x.fillStyle = '#1c1c1c'; for (const nx of [12, w - 16]) { x.beginPath(); x.arc(nx, y + h / 8, 3, 0, 7); x.fill(); }
  }
});
const sandbagTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#8a7a58'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,30,10' : '220,200,160'},0.15)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.strokeStyle = 'rgba(40,30,15,0.35)'; for (let y = 0; y < h; y += 8) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + 3); x.stroke(); }
});
const hazardTex = () => canvasTex(256, 64, (x, w, h) => {
  for (let i = -2; i < 12; i++) { x.fillStyle = i % 2 ? '#141414' : '#e8b818'; x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + 32, 0); x.lineTo(i * 32 + 64, h); x.lineTo(i * 32 + 32, h); x.fill(); }
});

// ------------------------------------------------------------------ Géométries utilitaires
const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  return g;
};
const lathe = (profile, seg = 16, y = 0) => { const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg); g.translate(0, y, 0); return g; };
// profil 2D (dans le plan x/y) extrudé sur z, centré
const extrude = (shapePts, depth, bevel = 0.04) => {
  const s = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
};
function merge(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [], nor = [], uv = [];
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array);
    else uv.push(...new Array((g.attributes.position.count) * 2).fill(0));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// ------------------------------------------------------------------ Bibliothèque
export function createProps() {
  const M = {
    iron: new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.55, metalness: 0.7 }),
    darkGreen: new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.5, metalness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: plankTex(), roughness: 0.85 }),
    woodPlain: new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.8 }),
    carPaint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.08, metalness: 0.9 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }),
    lightsF: new THREE.MeshStandardMaterial({ color: 0xfff3d8, emissive: 0x6a5a40, roughness: 0.3 }),
    lightsR: new THREE.MeshStandardMaterial({ color: 0x8a0e0e, emissive: 0x2a0000, roughness: 0.3 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9b9890, roughness: 0.95 }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0xb98270, roughness: 0.9 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x3e5a4a, roughness: 0.45, metalness: 0.75 }),
    water: new THREE.MeshStandardMaterial({ color: 0x18324a, roughness: 0.05, metalness: 0.6 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3b5e2b, roughness: 1, flatShading: true }),
    flower: new THREE.MeshStandardMaterial({ color: 0xb8202a, roughness: 0.8 }),
    sandbag: new THREE.MeshStandardMaterial({ color: 0xffffff, map: sandbagTex(), roughness: 1 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hazardTex(), roughness: 0.6 }),
    redWhite: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.4, metalness: 0.6 }),
    roofRed: new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.8 }),
    warm: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb050, emissiveIntensity: 0.9 }),
  };
  M.wood.map.repeat.set(1, 1);

  // ---- prototypes : liste de [géométrie, matériau]
  const P = {};
  // Voiture : profil latéral arrondi extrudé, vitres, roues avec jantes, phares
  {
    const L = 4.2, W = 1.72;
    const body = extrude([[-2.1, 0.32], [2.1, 0.32], [2.12, 0.62], [2.0, 0.86], [1.15, 0.94], [0.55, 1.42], [-0.95, 1.46], [-1.6, 0.98], [-2.08, 0.9], [-2.14, 0.6]], W - 0.1, 0.05);
    const win = extrude([[0.5, 0.96], [0.98, 0.96], [0.5, 1.36], [-0.9, 1.4], [-1.45, 0.98]], W - 0.02, 0);
    const wheels = [], rims = [];
    for (const [x, z] of [[1.32, 0.78], [1.32, -0.78], [-1.3, 0.78], [-1.3, -0.78]]) {
      wheels.push(cyl(0.33, 0.33, 0.24, 14, x, 0.33, z, Math.PI / 2));
      rims.push(cyl(0.18, 0.18, 0.26, 10, x, 0.33, z, Math.PI / 2));
    }
    P.car = [[body, M.carPaint], [win, M.glass], [merge(wheels), M.tyre], [merge(rims), M.chrome],
      [merge([box(0.05, 0.12, 0.3, 2.13, 0.72, 0.55), box(0.05, 0.12, 0.3, 2.13, 0.72, -0.55)]), M.lightsF],
      [merge([box(0.05, 0.12, 0.28, -2.15, 0.76, 0.6), box(0.05, 0.12, 0.28, -2.15, 0.76, -0.6)]), M.lightsR]];
    P.car.size = [L, W];
  }
  // Banc : lattes en bois, pieds en fonte
  {
    const slats = [], legs = [];
    for (let i = 0; i < 3; i++) slats.push(box(1.8, 0.04, 0.11, 0, 0.45, -0.18 + i * 0.13));
    for (let i = 0; i < 3; i++) slats.push(box(1.8, 0.11, 0.035, 0, 0.62 + i * 0.13, -0.27, -0.18));
    for (const x of [-0.75, 0.75]) legs.push(extrude([[-0.25, 0], [-0.18, 0], [-0.1, 0.43], [0.22, 0.43], [0.25, 0], [0.32, 0], [0.26, 0.48], [-0.02, 0.48], [-0.08, 0.95], [-0.15, 0.95], [-0.2, 0.47]], 0.05, 0).rotateY(Math.PI / 2).translate(x, 0, 0));
    P.bench = [[merge(slats), M.wood], [merge(legs), M.iron]];
    P.bench.size = [1.9, 0.6];
  }
  // Poubelle (vert foncé), potelet, borne
  P.bin = [[merge([lathe([[0.001, 0.05], [0.22, 0.05], [0.24, 0.85], [0.26, 0.9], [0.0, 0.9]], 14), cyl(0.04, 0.04, 0.4, 6, 0, 0.2)]), M.darkGreen]];
  P.bollard = [[lathe([[0.001, 0], [0.09, 0], [0.09, 0.75], [0.07, 0.86], [0.001, 0.92]], 10), M.iron]];
  // Vélo : deux roues (tores) + cadre
  {
    const wheels = [new THREE.TorusGeometry(0.33, 0.025, 6, 16).translate(0.52, 0.34, 0), new THREE.TorusGeometry(0.33, 0.025, 6, 16).translate(-0.52, 0.34, 0)];
    const frame = [cyl(0.02, 0.02, 0.62, 5, 0, 0.6, 0, 0, Math.PI / 2), cyl(0.02, 0.02, 0.5, 5, -0.22, 0.48, 0, 0, -0.9), cyl(0.02, 0.02, 0.5, 5, 0.26, 0.48, 0, 0, 0.9),
      cyl(0.018, 0.018, 0.3, 5, 0.52, 0.5, 0, 0, 0.3), box(0.22, 0.04, 0.08, -0.3, 0.78, 0), box(0.04, 0.04, 0.45, 0.48, 0.86, 0)];
    P.bike = [[merge(wheels), M.tyre], [merge(frame), M.redWhite]];
  }
  // Statue sur socle en grès
  P.statue = [[merge([box(2.2, 0.4, 2.2, 0, 0.2, 0), box(1.6, 1.6, 1.6, 0, 1.2, 0), box(1.9, 0.25, 1.9, 0, 2.1, 0)]), M.sandstone],
    [merge([lathe([[0.001, 0], [0.42, 0], [0.38, 0.9], [0.3, 1.5], [0.36, 1.85], [0.12, 2.0], [0.001, 2.05]], 12, 2.22), new THREE.SphereGeometry(0.2, 10, 8).translate(0, 4.45, 0),
      cyl(0.07, 0.07, 0.9, 6, 0.42, 3.75, 0, 0, -0.6)]), M.bronze]];
  // Fontaine : vasque et colonne
  P.fountain = [[merge([lathe([[1.5, 0], [1.6, 0.55], [1.45, 0.6], [1.35, 0.15], [0.001, 0.15]], 20), lathe([[0.18, 0], [0.18, 1.3], [0.6, 1.45], [0.55, 1.6], [0.001, 1.55]], 14)]), M.sandstone],
    [cyl(1.36, 1.36, 0.06, 20, 0, 0.45, 0), M.water]];
  // Jardinière avec buissons
  P.planter = [[box(1.6, 0.6, 0.8, 0, 0.3, 0), M.woodPlain], [merge([new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.8, 1).translate(-0.4, 0.82, 0), new THREE.IcosahedronGeometry(0.46, 0).scale(1, 0.85, 1).translate(0.35, 0.86, 0.05)]), M.leaf],
    [merge([new THREE.SphereGeometry(0.08, 6, 5).translate(-0.2, 1.05, 0.25), new THREE.SphereGeometry(0.08, 6, 5).translate(0.4, 1.12, -0.2), new THREE.SphereGeometry(0.08, 6, 5).translate(0.1, 1.15, 0.3)]), M.flower]];
  // Caisse en planches et palette
  P.crate = [[box(1.1, 1.0, 1.1, 0, 0.5, 0), M.wood]];
  P.pallet = [[merge([box(1.2, 0.04, 0.12, 0, 0.13, -0.42), box(1.2, 0.04, 0.12, 0, 0.13, -0.14), box(1.2, 0.04, 0.12, 0, 0.13, 0.14), box(1.2, 0.04, 0.12, 0, 0.13, 0.42),
    box(0.1, 0.1, 1.0, -0.5, 0.06, 0), box(0.1, 0.1, 1.0, 0, 0.06, 0), box(0.1, 0.1, 1.0, 0.5, 0.06, 0)]), M.woodPlain]];
  // Bloc béton de chantier (profil "New Jersey")
  P.jersey = [[extrude([[-0.3, 0], [0.3, 0], [0.24, 0.08], [0.1, 0.32], [0.08, 0.82], [-0.08, 0.82], [-0.1, 0.32], [-0.24, 0.08]], 2.4, 0.02).rotateY(Math.PI / 2), M.concrete]];
  // Barrière de police (métal) : 2 m
  P.crowd = [[merge([cyl(0.025, 0.025, 2, 6, 0, 1.0, 0, 0, Math.PI / 2), cyl(0.025, 0.025, 2, 6, 0, 0.25, 0, 0, Math.PI / 2), cyl(0.025, 0.025, 1.0, 6, -0.98, 0.6, 0), cyl(0.025, 0.025, 1.0, 6, 0.98, 0.6, 0),
    ...Array.from({ length: 12 }, (_, i) => cyl(0.012, 0.012, 0.75, 4, -0.85 + i * 0.155, 0.62, 0)), box(0.5, 0.03, 0.06, -0.98, 0.02, 0), box(0.5, 0.03, 0.06, 0.98, 0.02, 0)]), M.redWhite]];
  // Mur de sacs de sable (2 m)
  {
    const bags = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
      const g = new THREE.CapsuleGeometry(0.16, 0.38, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.75, 1.15);
      g.translate(-0.75 + i * 0.5 + (row % 2) * 0.25, 0.13 + row * 0.24, (row % 2 ? 0.04 : -0.04));
      bags.push(g);
    }
    P.sandbags = [[merge(bags), M.sandbag]];
  }
  // Chalet du marché de Noël : base bois, comptoir éclairé, toit à deux pans
  P.chalet = [[merge([box(3, 2.2, 2, 0, 1.1, 0)]), M.wood],
    [merge([box(3.4, 0.08, 1.4, 0, 2.62, 0.48, 0.55), box(3.4, 0.08, 1.4, 0, 2.62, -0.48, -0.55)]), M.roofRed],
    [box(2.6, 0.9, 0.05, 0, 1.45, 1.01), M.warm], [box(2.8, 0.08, 0.5, 0, 0.98, 1.2), M.woodPlain]];

  // ---- instances
  const inst = {}; // type -> [{ m: Matrix4, c: Color|null }]
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function place(type, x, z, rotY = 0, scale = 1, color = null, y = 0, tilt = 0) {
    (inst[type] ||= []).push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(new THREE.Euler(tilt, rotY, 0, 'YXZ')).clone(), new THREE.Vector3(scale, scale, scale)), c: color });
  }
  function finish(scene) {
    const meshes = [];
    for (const [type, list] of Object.entries(inst)) {
      for (const [geo, mat] of P[type]) {
        const useColor = mat === M.carPaint;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (useColor) im.setColorAt(i, it.c || new THREE.Color(0x777777)); });
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
        meshes.push(im);
      }
    }
    return meshes;
  }

  // ---- barricade de porte (planches clouées sur poteaux), longueur variable, construite à la demande
  function gate(len, h = 3.1) {
    const g = new THREE.Group();
    const posts = Math.max(2, Math.ceil(len / 2.6) + 1);
    const parts = [];
    for (let i = 0; i < posts; i++) parts.push(box(0.16, h + 0.2, 0.16, -len / 2 + (len * i) / (posts - 1), (h + 0.2) / 2, -0.12));
    const boards = [];
    const n = Math.max(5, Math.round(h / 0.42));
    for (let i = 0; i < n; i++) {
      const y = 0.35 + (i * (h - 0.5)) / (n - 1);
      boards.push(box(len + 0.3, 0.3, 0.05, (Math.random() - 0.5) * 0.15, y, 0, 0, 0, (Math.random() - 0.5) * 0.06));
    }
    boards.push(box(Math.hypot(len, h * 0.8) * 0.98, 0.26, 0.05, 0, h / 2, 0.06, 0, 0, Math.atan2(h * 0.8, len)));
    g.add(new THREE.Mesh(merge(parts), M.iron), new THREE.Mesh(merge(boards), M.wood));
    g.add(new THREE.Mesh(box(len + 0.3, 0.14, 0.06, 0, 0.12, 0.05), M.hazard));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }
  // ---- clôture de zone fermée : blocs béton + palissade en tôle
  function sealWall(len, sheetMat) {
    const g = new THREE.Group();
    const blocks = [];
    const n = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i < n; i++) {
      const b = P.jersey[0][0].clone();
      b.scale((len / n) / 2.4, 1, 1);
      b.translate(-len / 2 + (len / n) * (i + 0.5), 0, 0.25);
      blocks.push(b);
    }
    g.add(new THREE.Mesh(merge(blocks), M.concrete));
    const sheet = new THREE.Mesh(box(len, 2.6, 0.06, 0, 2.05, -0.05), sheetMat);
    g.add(sheet);
    const posts = [];
    for (let i = 0; i <= Math.ceil(len / 3); i++) posts.push(box(0.1, 3.5, 0.1, -len / 2 + Math.min(len, i * 3), 1.75, -0.12));
    g.add(new THREE.Mesh(merge(posts), M.iron));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }

  return { place, finish, gate, sealWall, sizes: { car: P.car.size, bench: P.bench.size }, M };
}
