import * as THREE from 'three';
import { merge } from './props.js';

// Stations de vélos (CONFIG.vehicles.bikeStations, v0.43.0). Emplacements fixes (aucun tirage : identiques chez tous les joueurs), posés APRÈS tout le décor
// (voir realworld.js) pour ne jamais changer ce que le tirage commun a placé.
//  - bikeStationLayout : positions pures des vélos, des arceaux, du panneau et de l'emprise vérifiée
//  - buildBikeStationDecor : arceaux (U inversés) et petit panneau « VÉLOS » sur poteau, deux maillages, aucune lumière
// Repère de la station : comme le parking (parking.js) : dx vers la droite des vélos, dz vers l'arrière ; yaw 0 = les vélos regardent le nord (-z).

export function bikeStationLayout(ST, G) {
  const c = Math.cos(ST.yaw), s = Math.sin(ST.yaw), n = ST.bikes;
  const at = (dx, dz) => ({ x: ST.x + c * dx + s * dz, z: ST.z - s * dx + c * dz });
  const bikes = Array.from({ length: n }, (_, i) => ({ ...at((i - (n - 1) / 2) * G.spacing, 0), yaw: ST.yaw }));
  const hoops = Array.from({ length: n + 1 }, (_, k) => at((k - n / 2) * G.spacing, 0));
  const sign = at(n / 2 * G.spacing + G.signOffset, 0);
  // emprise vérifiée : rectangle (repère de la station) de la rangée de vélos au poteau du panneau, G.rect.d de profondeur
  const x0 = -(n / 2) * G.spacing - 0.7, x1 = (n / 2) * G.spacing + G.signOffset + 0.7, hd = G.rect.d / 2;
  const samples = [];
  for (let dx = x0; dx <= x1 + 1e-6; dx += G.rect.step) for (let dz = -hd; dz <= hd + 1e-6; dz += G.rect.step) samples.push(at(dx, dz));
  const points = [{ x: ST.x, z: ST.z }, ...bikes, ...hoops, sign];
  return { center: { x: ST.x, z: ST.z, yaw: ST.yaw }, bikes, hoops, sign, samples, points, at };
}

const sharedMat = {};
const stdMat = (key, make) => sharedMat[key] || (sharedMat[key] = make());

// Panneau : carré turquoise avec un vélo stylisé et « VÉLOS » (texte générique, aucun logo)
function signTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 300;
  const x = cv.getContext('2d');
  x.fillStyle = '#1fa89a'; x.fillRect(0, 0, 256, 300);
  x.strokeStyle = '#fff'; x.lineWidth = 9; x.strokeRect(11, 11, 234, 278);
  x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
  // vélo : deux roues, cadre en diamant, selle, guidon
  x.beginPath(); x.arc(76, 160, 38, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(180, 160, 38, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(76, 160); x.lineTo(112, 100); x.lineTo(160, 100); x.lineTo(180, 160); x.moveTo(76, 160); x.lineTo(130, 160); x.lineTo(112, 100); x.moveTo(130, 160); x.lineTo(160, 100); x.stroke();
  x.beginPath(); x.moveTo(100, 88); x.lineTo(124, 88); x.moveTo(160, 100); x.lineTo(166, 80); x.lineTo(188, 80); x.stroke();
  x.textAlign = 'center'; x.font = 'bold 58px Arial, sans-serif'; x.fillText('VÉLOS', 128, 262);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function colored(g, hex) {
  const col = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// Décor : { group }. Ajoute les collisions (arceaux : bas, enjambables ; poteau). Aucune source de lumière.
export function buildBikeStationDecor(scene, collision, ST, L, G) {
  const group = new THREE.Group();
  const metal = [];
  const hoopW = 0.7, hoopH = 0.8, r = 0.018, arcR = hoopW / 2, legH = hoopH - arcR;
  for (const h of L.hoops) { // arceau en U inversé dans le plan du vélo (le long de son axe), posé sur une petite platine
    const parts = [
      colored(new THREE.TorusGeometry(arcR, r, 6, 14, Math.PI).rotateY(Math.PI / 2).translate(0, legH, 0), 0x9aa0a8),
      colored(new THREE.CylinderGeometry(r, r, legH, 6).translate(0, legH / 2, -arcR), 0x9aa0a8),
      colored(new THREE.CylinderGeometry(r, r, legH, 6).translate(0, legH / 2, arcR), 0x9aa0a8),
      colored(new THREE.BoxGeometry(0.06, 0.012, 0.1).translate(0, 0.006, -arcR), 0x55595f),
      colored(new THREE.BoxGeometry(0.06, 0.012, 0.1).translate(0, 0.006, arcR), 0x55595f),
    ];
    const g = merge(parts);
    g.rotateY(L.center.yaw).translate(h.x, 0, h.z);
    metal.push(g);
  }
  const pw = 0.62, ph = 0.76, py = 1.95;
  metal.push(colored(new THREE.CylinderGeometry(0.04, 0.05, 2.5, 8).translate(L.sign.x, 1.25, L.sign.z), 0x2a2d33));
  const back = colored(new THREE.BoxGeometry(pw + 0.04, ph + 0.04, 0.04).rotateY(L.center.yaw), 0x1a1d22);
  metal.push(back.translate(L.sign.x, py, L.sign.z));
  const metalMesh = new THREE.Mesh(merge(metal), stdMat('stationMetal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 })));
  metalMesh.castShadow = metalMesh.receiveShadow = true;
  // les deux faces du panneau : un seul maillage
  const faces = [];
  for (const side of [1, -1]) {
    const f = new THREE.PlaneGeometry(pw, ph);
    f.rotateY((side > 0 ? 0 : Math.PI) + L.center.yaw);
    const off = new THREE.Vector3(0, 0, side * 0.025).applyAxisAngle(new THREE.Vector3(0, 1, 0), L.center.yaw);
    faces.push(f.translate(L.sign.x + off.x, py, L.sign.z + off.z));
  }
  const faceMesh = new THREE.Mesh(merge(faces), stdMat('stationSign', () => new THREE.MeshStandardMaterial({ map: signTexture(), color: 0xdde4ee, roughness: 0.65, metalness: 0.1 })));
  group.add(metalMesh, faceMesh);
  scene.add(group);
  for (const h of L.hoops) collision.addBox(h.x, h.z, 0.08, hoopW, -L.center.yaw, hoopH, undefined, 'prop', true);
  collision.addCircle(L.sign.x, L.sign.z, 0.12, 2.5);
  return { group };
}
