import * as THREE from 'three';

// Parkings des motos (CONFIG.vehicles.parkings : place Gutenberg, place Broglie). Emplacements fixes, sans tirage.
//  - parkingLayout : positions (pures, identiques chez tous les joueurs) des motos, de la borne, du panneau et de l'emprise réservée
//  - buildParkingDecor : panneau « P / MOTOS », marquage des emplacements au sol, borne de service (plein + réparation)
// Repère du parking : dx vers la droite des motos, dz vers l'arrière (comme Vehicle.toWorld) ; yaw 0 = les motos regardent le nord (-z).

export function parkingLayout(PK) {
  const c = Math.cos(PK.yaw), s = Math.sin(PK.yaw);
  const at = (dx, dz) => ({ x: PK.x + c * dx + s * dz, z: PK.z - s * dx + c * dz });
  const R = PK.rect, rx = R.dx || 0;
  // emprise réservée au décor : rectangle R.w x R.d centré sur (rx, 0) dans le repère du parking
  const inRect = (x, z, margin = 0) => {
    const wx = x - PK.x, wz = z - PK.z;
    const lx = c * wx - s * wz, lz = s * wx + c * wz; // monde -> repère du parking
    return Math.abs(lx - rx) <= R.w / 2 + margin && Math.abs(lz) <= R.d / 2 + margin;
  };
  const bays = PK.bays.map((b) => ({ type: b.type, ...at(b.dx, b.dz || 0), yaw: PK.yaw }));
  const pump = at(PK.pump.dx, PK.pump.dz);
  pump.yaw = Math.atan2(PK.x - pump.x, PK.z - pump.z); // la borne regarde le centre des emplacements
  const sign = at(PK.sign.dx, PK.sign.dz);
  // points (x, z) à interdire aux autres objets (décor, voitures…)
  const points = [{ x: PK.x, z: PK.z }, ...bays.map((b) => ({ x: b.x, z: b.z })), { x: pump.x, z: pump.z }, { x: sign.x, z: sign.z }];
  return { center: { x: PK.x, z: PK.z, yaw: PK.yaw }, bays, pump, sign, points, inRect, at };
}

const sharedMat = {};
const stdMat = (key, color, rough = 0.6, metal = 0.2, extra = {}) => sharedMat[key] || (sharedMat[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));

function signTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 320;
  const x = cv.getContext('2d');
  x.fillStyle = '#2a6fd8'; x.fillRect(0, 0, 256, 320);
  x.strokeStyle = '#fff'; x.lineWidth = 10; x.strokeRect(12, 12, 232, 296);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  x.font = 'bold 190px Arial, sans-serif'; x.fillText('P', 128, 190);
  x.font = 'bold 54px Arial, sans-serif'; x.fillText('MOTOS', 128, 270);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function markingTexture(slots, w, d, ppm = 100) {
  const x0 = Math.min(...slots) - w / 2 - 0.3, x1 = Math.max(...slots) + w / 2 + 0.3;
  const W = Math.round((x1 - x0) * ppm), H = Math.round((d + 0.4) * ppm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.92)';
  const lw = 0.1 * ppm; // largeur des lignes : 10 cm
  for (const dx of slots) { // U ouvert vers l'avant (haut de l'image = avant des motos) : deux côtés et le fond
    const l = (dx - w / 2 - x0) * ppm, r = (dx + w / 2 - x0) * ppm, t = 0.2 * ppm, b = H - 0.2 * ppm;
    x.fillRect(l, t, lw, b - t); x.fillRect(r - lw, t, lw, b - t); x.fillRect(l, b - lw, r - l, lw);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { tex: t, w: x1 - x0, h: (d + 0.4), cx: (x0 + x1) / 2 };
}

function pumpTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
  const x = cv.getContext('2d');
  x.fillStyle = '#0d1014'; x.fillRect(0, 0, 256, 160);
  x.strokeStyle = '#ffb02e'; x.lineWidth = 6; x.strokeRect(4, 4, 248, 152);
  x.textAlign = 'center'; x.fillStyle = '#ffb02e';
  x.font = 'bold 44px Impact, Arial, sans-serif'; x.fillText('ESSENCE', 128, 62);
  x.fillStyle = '#9fe6a0'; x.font = 'bold 26px Arial, sans-serif'; x.fillText('PLEIN + RÉPARATION', 128, 104);
  x.fillStyle = '#ddd'; x.font = '20px Arial, sans-serif'; x.fillText('[E] à côté de la moto', 128, 138);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Décor du parking. Renvoie { pump: { x, z, group }, size de collision déjà ajoutée }
export function buildParkingDecor(scene, collision, lightSources, PK, L) {
  const decor = new THREE.Group();

  // ---- marquage au sol : 4 emplacements de 1,6 x 2,6 m
  const mk = markingTexture(PK.slots, 1.6, 2.6);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(mk.w, mk.h), new THREE.MeshBasicMaterial({
    map: mk.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, color: 0xcfd3d8,
  }));
  mark.rotation.x = -Math.PI / 2;
  const markHolder = new THREE.Group(); // le groupe porte le cap du parking, le plan reste à plat dedans
  markHolder.add(mark); mark.position.set(mk.cx, 0.03, 0);
  markHolder.position.set(L.center.x, 0, L.center.z); markHolder.rotation.y = L.center.yaw;
  decor.add(markHolder);

  // ---- panneau « P / MOTOS » sur un poteau de 2,6 m, lisible des deux côtés
  const sg = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.6, 8), stdMat('pole', 0x2a2d33, 0.5, 0.6));
  pole.position.y = 1.3; sg.add(pole);
  const tex = signTexture();
  const bw = 0.9, bh = bw * 320 / 256;
  const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.04, bh + 0.04, 0.04), stdMat('signback', 0x1a1d22, 0.6, 0.4));
  back.position.y = 2.05; sg.add(back);
  for (const side of [1, -1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex, color: 0xdde4ee }));
    face.position.set(0, 2.05, side * 0.025); face.rotation.y = side > 0 ? 0 : Math.PI;
    sg.add(face);
  }
  sg.position.set(L.sign.x, 0, L.sign.z);
  sg.rotation.y = L.center.yaw;
  decor.add(sg);
  collision.addCircle(L.sign.x, L.sign.z, 0.12, 2.6);
  lightSources.push({ x: L.sign.x, y: 3.1, z: L.sign.z, color: 0x7fb0ff, intensity: 9, dist: 11 });

  // ---- borne de service : corps rouge, auvent, afficheur, pistolet et tuyau
  const pg = new THREE.Group();
  const part = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); pg.add(m); return m; };
  part(0.7, 0.12, 0.56, stdMat('pbase', 0x2b2e34, 0.7, 0.3), 0, 0.06, 0);
  part(0.5, 1.3, 0.36, stdMat('pbody', 0xb82e22, 0.45, 0.35), 0, 0.77, 0);
  part(0.58, 0.14, 0.44, stdMat('pcap', 0x1a1c20, 0.5, 0.4), 0, 1.49, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.275), new THREE.MeshBasicMaterial({ map: pumpTexture(), color: 0xe6e6e6 }));
  screen.position.set(0, 1.12, 0.185); pg.add(screen);
  part(0.44, 0.04, 0.2, stdMat('pstripe', 0xf2c230, 0.5, 0.2), 0, 0.62, 0.19);
  part(0.1, 0.22, 0.1, stdMat('pholster', 0x16181c, 0.6, 0.3), 0.3, 0.9, 0);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.3, 0.85, 0.02), new THREE.Vector3(0.42, 0.55, 0.1), new THREE.Vector3(0.38, 0.2, 0.22), new THREE.Vector3(0.2, 0.04, 0.35)]), 14, 0.018, 6), stdMat('phose', 0x0c0c0e, 0.9, 0));
  pg.add(hose);
  pg.position.set(L.pump.x, 0, L.pump.z); pg.rotation.y = L.pump.yaw;
  pg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  decor.add(pg);
  collision.addBox(L.pump.x, L.pump.z, 0.75, 0.6, -pg.rotation.y, 1.6);
  lightSources.push({ x: L.pump.x + Math.sin(pg.rotation.y) * 1.2, y: 1.8, z: L.pump.z + Math.cos(pg.rotation.y) * 1.2, color: 0xffb040, intensity: 7, dist: 7 });

  scene.add(decor);
  return { group: decor };
}
