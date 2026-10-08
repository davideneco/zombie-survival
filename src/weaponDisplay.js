import * as THREE from 'three';
import { buildWeaponModels, attachAccessories } from './viewmodels.js';
import { CONFIG, PAP_LEVELS, papPulse } from './config.js';

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
// level : niveau du Pack-a-Punch (0 à 3) : accessoires du niveau (viewmodels.js) et reflet de sa couleur.
export function cloneWeapon(id, level = 0) {
  const kit = weaponKit();
  const mid = kit.models[id] ? id : 'rifle';
  const src = kit.models[mid];
  const g = src.clone(true);
  g.visible = true;
  level = level | 0;
  if (level > 0) {
    attachAccessories(g, mid, level, src); // les accessoires sont construits une fois par arme et niveau, puis clonés (géométries partagées)
    papify(g, level);
  }
  return g;
}

// Reflet de la couleur du niveau : les matériaux sont copiés (la copie partagée par le reste du jeu ne change pas) ; ceux qui brillent
// d'eux-mêmes (point rouge, bulbe, laser) gardent leur couleur. Niveau III : l'intensité pulse (pulseWeapon).
const PULSE = new WeakMap();
const PAP_GLOW = 0.55;
export function papify(g, level = 1) {
  const L = PAP_LEVELS[level] || PAP_LEVELS[1];
  const copies = new Map(), mats = [];
  g.traverse((o) => {
    if (!o.isMesh || o.userData.glow) return;
    let m = copies.get(o.material);
    if (!m) {
      m = o.material.clone();
      copies.set(o.material, m);
      if (m.emissive) { m.emissive.setHex(L.color); m.emissiveIntensity = PAP_GLOW; mats.push(m); }
    }
    o.material = m;
  });
  if (L.pulseHz) PULSE.set(g, { level, mats });
}

// Fait pulser le reflet d'une arme de niveau III (t : secondes) ; sans effet sur les autres
export function pulseWeapon(g, t) {
  const p = PULSE.get(g);
  if (!p) return;
  const k = PAP_GLOW * papPulse(p.level, t);
  for (const m of p.mats) m.emissiveIntensity = k;
}

// Présentoir : toutes les armes empilées au même endroit, une seule visible à la fois (boîte mystère, Pack-a-Punch).
// scale : taille d'affichage ; chaque arme est centrée sur son centre géométrique.
export function makeDisplay(scale = 1.9) {
  const root = new THREE.Group();
  const items = {}, models = {};
  const kit = weaponKit();
  // un élément par arme et par niveau (créé à la demande pour les niveaux 1 à 3)
  const make = (id, level) => {
    const key = level ? `${id}:${level}` : id;
    if (items[key]) return items[key];
    const pivot = new THREE.Group();
    const m = cloneWeapon(id, level);
    const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    m.position.sub(c);
    pivot.add(m);
    pivot.scale.setScalar(scale);
    pivot.visible = false;
    pivot.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    root.add(pivot);
    items[key] = pivot; models[key] = m;
    return pivot;
  };
  for (const id of Object.keys(kit.models)) make(id, 0);
  let shown = null;
  return {
    root,
    // id : arme à montrer (null : rien) ; level : niveau du Pack-a-Punch (0 : arme ordinaire)
    show(id, level = 0) {
      if (shown && items[shown]) items[shown].visible = false;
      shown = null;
      if (!id || !kit.models[id]) return;
      level = level | 0;
      make(id, level).visible = true;
      shown = level ? `${id}:${level}` : id;
    },
    // version Pack-a-Punch d'une arme, au niveau donné
    showPap(id, level = 1) { this.show(id, level); },
    // fait pulser le reflet de l'arme montrée si elle est de niveau III
    pulse(t) { if (shown && models[shown]) pulseWeapon(models[shown], t); },
    get current() { return shown; },
    ids: () => Object.keys(kit.models),
    poolIds: () => Object.keys(CONFIG.box.pool),
  };
}
