import * as THREE from 'three';
import { buildWeaponModels } from './viewmodels.js';
import { CONFIG } from './config.js';

// Modèles d'armes réutilisés hors de la vue à la première personne : boîte mystère, Pack-a-Punch,
// armes tenues par les autres joueurs. Les prototypes sont construits une seule fois ; les copies partagent
// géométries et matériaux (donc aucun nouveau shader à compiler).

let KIT = null;

function raygunModel() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0x9a2a1e, roughness: 0.4, metalness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x55ff77, emissive: 0x33ff55, emissiveIntensity: 2 });
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
  box(0.07, 0.08, 0.22, 0, 0, -0.05, red);
  for (let i = 0; i < 3; i++) box(0.12, 0.012, 0.03, 0, 0, -0.08 - i * 0.05, grey);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glow);
  bulb.position.set(0, 0, -0.2); g.add(bulb);
  box(0.035, 0.11, 0.05, 0, -0.08, 0.05, dark).rotation.x = -0.25;
  return g;
}

export function weaponKit() {
  if (KIT) return KIT;
  const holder = new THREE.Group();
  const built = buildWeaponModels(holder);
  const models = {}, hands = {}, muzzles = {};
  for (const [id, grp] of Object.entries(built.vms)) {
    const hs = [], skins = [];
    grp.traverse((o) => { if (o.userData.skin) { hs.push(o.position.clone().add(grp.position)); skins.push(o); } });
    for (const o of skins) o.parent.remove(o);
    hs.sort((a, b) => a.z - b.z); // main avant (z le plus négatif) puis main arrière
    holder.remove(grp);
    grp.visible = true;
    models[id] = grp;
    hands[id] = { front: hs.length > 1 ? hs[0] : null, back: hs[hs.length - 1] || new THREE.Vector3(0, -0.11, 0.08) };
    muzzles[id] = built.info[id].muzzle;
  }
  models.raygun = raygunModel();
  hands.raygun = { front: new THREE.Vector3(0, -0.09, 0.05), back: new THREE.Vector3(0, -0.12, 0.09) };
  muzzles.raygun = -0.22;
  KIT = { models, hands, muzzles };
  return KIT;
}

// Copie d'une arme (même orientation que la vue à la première personne : -z vers l'avant).
// pap : reflets violets du Pack-a-Punch.
export function cloneWeapon(id, pap = false) {
  const kit = weaponKit();
  const src = kit.models[id] || kit.models.rifle;
  const g = src.clone(true);
  g.visible = true;
  if (pap) papify(g);
  return g;
}

export function papify(g) {
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.emissive) { o.material.emissive.setHex(0x6a22b8); o.material.emissiveIntensity = 0.75; }
  });
}

// Présentoir : toutes les armes empilées au même endroit, une seule visible à la fois (boîte mystère, Pack-a-Punch).
// scale : taille d'affichage ; chaque arme est centrée sur son centre géométrique.
export function makeDisplay(scale = 1.9) {
  const root = new THREE.Group();
  const items = {};
  const kit = weaponKit();
  for (const id of Object.keys(kit.models)) {
    const pivot = new THREE.Group();
    const m = cloneWeapon(id);
    const b = new THREE.Box3().setFromObject(m);
    const c = b.getCenter(new THREE.Vector3());
    m.position.sub(c);
    pivot.add(m);
    pivot.scale.setScalar(scale);
    pivot.visible = false;
    pivot.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    root.add(pivot);
    items[id] = pivot;
  }
  let shown = null;
  return {
    root,
    show(id) {
      if (shown && items[shown]) items[shown].visible = false;
      shown = items[id] ? id : null;
      if (shown) items[shown].visible = true;
    },
    // version Pack-a-Punch d'une arme (copie à part, créée à la demande)
    showPap(id) {
      this.show(null);
      if (!items['pap:' + id]) {
        const pivot = new THREE.Group();
        const m = cloneWeapon(id, true);
        const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
        m.position.sub(c);
        pivot.add(m);
        pivot.scale.setScalar(scale);
        root.add(pivot);
        items['pap:' + id] = pivot;
      }
      if (shown && items[shown]) items[shown].visible = false;
      shown = 'pap:' + id;
      items[shown].visible = true;
    },
    get current() { return shown; },
    ids: () => Object.keys(kit.models),
    poolIds: () => Object.keys(CONFIG.box.pool),
  };
}
