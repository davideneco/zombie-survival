import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Ombres de contact « cuites » (v0.44.0) : une tache sombre et douce sous chaque objet, arbre, véhicule et zombie.
//  Aucune lumière, aucune ombre portée : de simples images posées au sol, en deux appels de rendu au total :
//   - le décor fixe (props.js, arbres) : un seul InstancedMesh, rempli pendant la construction du monde (build) ;
//   - les mobiles (zombies, coéquipiers, véhicules) : un second InstancedMesh réécrit à chaque image (updateDynamic).
//  La force d'une tache est portée par le gris de l'instance (noir = très sombre) ; l'opacité du matériau est commune.
// =====================================================================

// Emprise [largeur, profondeur] (m) de la tache de chaque type d'objet de props.js, et sa force (0..1)
const PROP_BLOB = {
  car: [5.4, 2.6, 0.8], bench: [2.4, 1.0, 0.6], bin: [1.0, 1.0, 0.6], bollard: [0.55, 0.55, 0.5], bike: [1.8, 0.7, 0.5], statue: [3.4, 3.4, 0.65],
  planter: [2.1, 1.3, 0.55], crate: [1.7, 1.7, 0.65], pallet: [1.6, 1.5, 0.5], jersey: [3.0, 1.2, 0.6], crowd: [2.6, 0.8, 0.45], sandbags: [2.7, 1.0, 0.6],
  chalet: [4.2, 3.2, 0.6], pew: [4.9, 1.0, 0.5],
};

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

class Contact {
  constructor() {
    this.list = [];       // décor fixe : { x, z, w, d, rot, k, y }
    this.mesh = null;     // décor fixe (créé par build)
    this.dyn = null;      // mobiles
    this.dynN = 0;
    this.enabled = true;
    this.geo = null; this.mat = null;
  }

  // Géométrie et matériau communs (créés à la première demande)
  shared() {
    if (!this.geo) {
      const C = CONFIG.graphics.contact;
      this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.mat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0xffffff, transparent: true, opacity: C.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    }
  }

  // Une tache sous un objet : (x, z) centre, w x d emprise (m), rot : cap (rad), k : force 0..1, y : hauteur du sol
  add(x, z, w, d, rot = 0, k = 0.6, y = 0) {
    this.list.push({ x, z, w, d, rot, k, y });
  }

  // Un objet de props.js (voir PROP_BLOB) ; scale : échelle de l'instance
  addProp(type, x, z, rot, scale = 1, y = 0) {
    const b = PROP_BLOB[type];
    if (!b || y > 0.2) return; // posé sur autre chose (caisse empilée) : pas de tache au sol
    this.add(x, z, b[0] * scale, b[1] * scale, rot, b[2], y);
  }

  // Crée le maillage du décor fixe (appelé une fois, en fin de construction du monde) et celui des mobiles
  build(scene) {
    this.shared();
    const n = this.list.length;
    if (n && !this.mesh) {
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
      mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.name = 'contact:static';
      this.list.forEach((b, i) => {
        _q.setFromAxisAngle(UP, b.rot);
        mesh.setMatrixAt(i, _m.compose(_p.set(b.x, b.y + 0.025, b.z), _q, _s.set(b.w, 1, b.d)));
        const g = 1 - b.k; mesh.setColorAt(i, _c.setRGB(g, g, g));
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      this.mesh = mesh;
    }
    if (!this.dyn) {
      const N = CONFIG.graphics.contact.dynamicMax;
      const dyn = new THREE.InstancedMesh(this.geo, this.mat, N);
      dyn.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dyn.frustumCulled = false; dyn.renderOrder = 1; dyn.name = 'contact:dynamic';
      for (let i = 0; i < N; i++) dyn.setColorAt(i, _c.setRGB(0.25, 0.25, 0.25));
      dyn.count = 0;
      scene.add(dyn);
      this.dyn = dyn;
    }
    this.list = [];
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.mesh) this.mesh.visible = on;
    if (this.dyn) this.dyn.visible = on;
  }

  // Taches des mobiles, une fois par image : lists = [{ pos, w, d, rot, k }] (rempli par graphics.js)
  beginDynamic() { this.dynN = 0; }
  pushDynamic(x, y, z, w, d, rot = 0, k = 0.6) {
    if (!this.dyn || this.dynN >= this.dyn.instanceMatrix.count) return;
    const i = this.dynN++;
    _q.setFromAxisAngle(UP, rot);
    this.dyn.setMatrixAt(i, _m.compose(_p.set(x, y + 0.03, z), _q, _s.set(w, 1, d)));
    const g = 1 - k; this.dyn.setColorAt(i, _c.setRGB(g, g, g));
  }
  endDynamic() {
    if (!this.dyn) return;
    this.dyn.count = this.dynN;
    this.dyn.instanceMatrix.needsUpdate = true;
    if (this.dyn.instanceColor) this.dyn.instanceColor.needsUpdate = true;
  }
}

export const contact = new Contact();
