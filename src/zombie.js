import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fx } from './fx.js';
import { morionGeometry, cuirassGeometry, pauldronGeometry } from './ironArmor.js';

// =====================================================================
//  Zombie : modèle articulé (hanches, genoux, épaules, coudes, mâchoire),
//  textures procédurales, apparition par fenêtre ou depuis le sol.
// =====================================================================

const WIN_WARN = 0.9;     // délai : ça cogne contre la fenêtre
const WIN_CLIMB = 1.5;    // durée de l'enjambement
const GND_DELAY = 1.1;    // délai : la terre tremble
const GND_RISE = 2.2;     // durée de la remontée

const ASH = new THREE.Color(0xb9b5ab); // couleur des cendres (l'Aube)
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------ Textures
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function blobs(x, s, n, colors, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const px = Math.random() * s, py = Math.random() * s, r = rnd(rMin, rMax);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, pick(colors).replace('A', alpha));
    g.addColorStop(1, pick(colors).replace('A', 0));
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
}

function skinTexture(base) {
  return canvasTex(128, (x, s) => {
    x.fillStyle = base; x.fillRect(0, 0, s, s);
    blobs(x, s, 40, ['rgba(70,90,60,A)', 'rgba(120,140,110,A)', 'rgba(60,45,70,A)'], 6, 22, 0.35);
    blobs(x, s, 6, ['rgba(70,10,15,A)'], 5, 14, 0.5);              // plaies
    x.strokeStyle = 'rgba(40,60,90,0.45)'; x.lineWidth = 1;        // veines
    for (let i = 0; i < 9; i++) {
      x.beginPath(); let px = Math.random() * s, py = Math.random() * s; x.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += rnd(-14, 14); py += rnd(-10, 14); x.lineTo(px, py); }
      x.stroke();
    }
    x.fillStyle = 'rgba(100,8,8,0.7)';                              // traînées de sang
    for (let i = 0; i < 7; i++) { const px = Math.random() * s; x.fillRect(px, Math.random() * s * 0.5, rnd(1, 3), rnd(10, 40)); }
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; x.fillRect(Math.random() * s, Math.random() * s, 1, 1); }
  });
}

// Pierre grise fissurée et mousseuse (gargouilles de l'Acte V)
function stoneTexture() {
  return canvasTex(128, (x, s) => {
    x.fillStyle = '#8b8b86'; x.fillRect(0, 0, s, s);
    blobs(x, s, 46, ['rgba(60,60,58,A)', 'rgba(170,170,162,A)', 'rgba(110,112,106,A)'], 6, 24, 0.4);
    blobs(x, s, 7, ['rgba(70,92,52,A)'], 5, 13, 0.45); // mousse
    x.strokeStyle = 'rgba(30,30,30,0.6)'; x.lineWidth = 1.2; // fissures
    for (let i = 0; i < 8; i++) {
      x.beginPath(); let px = Math.random() * s, py = Math.random() * s; x.moveTo(px, py);
      for (let k = 0; k < 6; k++) { px += rnd(-12, 12); py += rnd(-4, 14); x.lineTo(px, py); }
      x.stroke();
    }
    for (let i = 0; i < 1200; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`; x.fillRect(Math.random() * s, Math.random() * s, 1, 1); }
  });
}

function clothTexture(base, skin, tears, bloodAmount) {
  return canvasTex(128, (x, s) => {
    x.fillStyle = base; x.fillRect(0, 0, s, s);
    x.fillStyle = 'rgba(0,0,0,0.07)';                               // trame du tissu
    for (let i = 0; i < s; i += 2) { x.fillRect(i, 0, 1, s); x.fillRect(0, i, s, 1); }
    blobs(x, s, 30, ['rgba(20,15,10,A)', 'rgba(90,80,60,A)'], 8, 26, 0.3); // saleté
    for (let t = 0; t < tears; t++) {                                // déchirures
      const cx = Math.random() * s, cy = Math.random() * s, w = rnd(10, 26), h = rnd(8, 22);
      x.fillStyle = skin; x.beginPath(); x.moveTo(cx, cy);
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; const r = (k % 2 ? 0.5 : 1) * (k % 2 ? w : h) * rnd(0.6, 1); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); }
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(70,5,5,0.8)'; x.lineWidth = 2; x.stroke();
    }
    blobs(x, s, bloodAmount, ['rgba(110,8,8,A)', 'rgba(70,4,4,A)'], 8, 28, 0.75);
    const g = x.createLinearGradient(0, s * 0.6, 0, s);
    g.addColorStop(0, 'rgba(25,18,10,0)'); g.addColorStop(1, 'rgba(25,18,10,0.45)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  });
}

let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  const skins = [
    ['#6a7d5c'], ['#778468'], ['#5f7058'], ['#7d7c6c'],
  ].map(([c]) => skinTexture(c));
  const skinHex = ['#6a7d5c', '#778468', '#5f7058', '#7d7c6c'];
  const shirts = [
    ['#4a2a2a', 3, 12], ['#2c3a4c', 2, 10], ['#4a4a38', 3, 14], ['#2a2a2e', 2, 8], ['#6a6258', 4, 10], ['#3e4a3a', 3, 12],
  ].map(([c, t, b], i) => clothTexture(c, skinHex[i % 4], t, b));
  const pants = [
    ['#23262e', 2, 5], ['#2d2a22', 3, 6], ['#1e2a2a', 2, 5], ['#3a3830', 3, 7],
  ].map(([c, t, b], i) => clothTexture(c, skinHex[i % 4], t, b));

  ASSETS = {
    skins, shirts, pants,
    geo: {
      torso: new THREE.CapsuleGeometry(0.16, 0.3, 4, 10),
      pelvis: new THREE.CapsuleGeometry(0.14, 0.08, 3, 8),
      neck: new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8),
      head: new THREE.SphereGeometry(0.125, 14, 10),
      jaw: new THREE.BoxGeometry(0.1, 0.04, 0.115),
      eye: new THREE.SphereGeometry(0.02, 6, 6),
      thigh: new THREE.CapsuleGeometry(0.08, 0.3, 3, 8),
      shin: new THREE.CapsuleGeometry(0.065, 0.3, 3, 8),
      foot: new THREE.BoxGeometry(0.11, 0.07, 0.26),
      upperArm: new THREE.CapsuleGeometry(0.052, 0.2, 3, 8),
      foreArm: new THREE.CapsuleGeometry(0.045, 0.2, 3, 8),
      hand: new THREE.SphereGeometry(0.055, 8, 6),
      hitHead: new THREE.SphereGeometry(0.3, 8, 6),
      hitBody: new THREE.BoxGeometry(1.0, 1.65, 0.8),
    },
    eyeMat: new THREE.MeshBasicMaterial({ color: 0xffc01a }),
    shoeMat: new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.9 }),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return ASSETS;
}

// Toutes les textures de zombies (pour les envoyer à la carte graphique pendant le chargement)
export function zombieTextures() {
  const A = assets();
  return [...A.skins, ...A.shirts, ...A.pants];
}

let nextZombieId = 1;

// --------------------------------------------------------------- Classe
export class Zombie {
  /**
   * spawn : { type:'ground', pos } ou { type:'window', inside, outside, yaw, nx, nz, center, getQuad() }
   * onEvent(name, zombie) : 'knock' | 'glass' | 'rumble' | 'emerge'
   */
  constructor(scene, spawn, health, speed, onEvent, id = null, opts = {}) {
    const A = assets();
    this.id = id != null ? id : (nextZombieId++);
    this.scene = scene;
    this.spawn = spawn;
    this.onEvent = onEvent || (() => {});
    this.maxHealth = this.health = health;
    this.speed = speed;
    this.dead = false;
    this.deathT = 0;
    this.deathStyle = Math.floor(Math.random() * 3);
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
    this.attackCd = 0.5;
    this.attackWindup = -1;
    this.hitFlash = 0;
    this.walkT = Math.random() * 10;
    this.stuckT = 0;
    this.sidestepT = 0;
    this.sidestepDir = 1;
    this.groanT = 2 + Math.random() * 6;
    this.yaw = 0;
    this._steer = { x: 0, z: 0 };
    this.vault = null; this.vaultCd = 0; // enjambement d'un obstacle bas (voir _tryVault)
    this.limp = Math.random() < 0.3;
    this.runner = speed > 3.2;
    this.crawler = false;
    this.noProgress = 0; // secondes passées sans réussir à avancer (coincé)
    this.region = 0;     // étage (0 = sol de la ville) ; link : escalier en cours d'emprunt
    this.link = null;

    // Matériaux (clonés : le flash de dégâts est propre à chaque zombie)
    const mk = (tex) => new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.85 });
    this.skinMat = mk(pick(A.skins));
    this.shirtMat = mk(pick(A.shirts));
    this.pantsMat = mk(pick(A.pants));
    const tint = new THREE.Color().setHSL(rnd(0.2, 0.3), rnd(0.05, 0.15), rnd(0.5, 0.65));
    this.skinMat.color.copy(tint);
    this.shirtMat.color.setScalar(0.75);
    this.pantsMat.color.setScalar(0.75);
    this.mats = [this.skinMat, this.shirtMat, this.pantsMat];

    this.meshes = []; // cibles du raycast (hitbox invisibles)
    const mesh = (geo, mat, parent, x, y, z, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    const sc = rnd(0.95, 1.08);
    this.group.scale.setScalar(sc);

    // Bassin / hanches
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.group.add(this.hips);
    mesh(A.geo.pelvis, this.pantsMat, this.hips, 0, 0, 0, true).scale.set(1.15, 1, 0.75);

    // Colonne : courbée vers l'avant
    this.spine = new THREE.Group(); this.spine.position.y = 0.04; this.hips.add(this.spine);
    mesh(A.geo.torso, this.shirtMat, this.spine, 0, 0.3, 0, true).scale.set(1.05, 1, 0.66);

    // Cou + tête
    mesh(A.geo.neck, this.skinMat, this.spine, 0, 0.68, 0.02);
    this.headGroup = new THREE.Group(); this.headGroup.position.set(0, 0.8, 0.05); this.spine.add(this.headGroup);
    const head = mesh(A.geo.head, this.skinMat, this.headGroup, 0, 0.04, 0, true);
    head.scale.set(0.9, 1.12, 1);
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.06, 0.0); this.headGroup.add(this.jaw);
    mesh(A.geo.jaw, this.skinMat, this.jaw, 0, -0.03, 0.06);
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = mesh(A.geo.eye, A.eyeMat, this.headGroup, sx * 0.05, 0.06, 0.105);
      this.eyes.push(e);
    }
    const hitHead = mesh(A.geo.hitHead, A.hitMat, this.headGroup, 0, 0.04, 0.02);
    hitHead.userData = { zombie: this, head: true };
    this.meshes.push(hitHead);

    // Bras : épaule -> coude -> main
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(sx * 0.25, 0.52, 0); this.spine.add(shoulder);
      mesh(A.geo.upperArm, this.shirtMat, shoulder, 0, -0.16, 0, true);
      const elbow = new THREE.Group(); elbow.position.y = -0.32; shoulder.add(elbow);
      mesh(A.geo.foreArm, this.skinMat, elbow, 0, -0.16, 0);
      mesh(A.geo.hand, this.skinMat, elbow, 0, -0.34, 0).scale.set(0.9, 1.2, 0.7);
      this.arms.push({ shoulder, elbow, side: sx });
    }

    // Jambes : hanche -> genou -> pied
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.1, -0.02, 0); this.hips.add(hip);
      mesh(A.geo.thigh, this.pantsMat, hip, 0, -0.22, 0, true);
      const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee);
      mesh(A.geo.shin, this.pantsMat, knee, 0, -0.22, 0);
      mesh(A.geo.foot, A.shoeMat, knee, 0, -0.46, 0.05);
      this.legs.push({ hip, knee, side: sx });
    }

    // Hitbox du corps
    const hitBody = mesh(A.geo.hitBody, A.hitMat, this.group, 0, 0.82, 0);
    hitBody.userData = { zombie: this, head: false };
    this.meshes.push(hitBody);
    this.hitBody = hitBody;

    // ---- Apparition ----
    this.pos = this.group.position;
    this.spawnElapsed = 0;
    if (spawn.type === 'window') {
      this.spawnType = 'window';
      this.total = WIN_WARN + WIN_CLIMB;
      this.pos.copy(spawn.inside);
      this.yaw = spawn.yaw;
      this.group.visible = false;
      this.quad = spawn.getQuad();
      this._knocks = 0;
      this._broke = false;
    } else {
      this.spawnType = 'ground';
      this.total = GND_DELAY + GND_RISE;
      this.pos.copy(spawn.pos);
      this.pos.y = -2;
      this.yaw = Math.random() * Math.PI * 2;
      this.group.visible = false;
      this.mound = new THREE.Mesh(
        new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x3a2e23, roughness: 1 })
      );
      this.mound.position.set(spawn.pos.x, 0, spawn.pos.z);
      this.mound.scale.set(0.2, 0.05, 0.2);
      this.mound.receiveShadow = true;
      scene.add(this.mound);
      this.moundT = 0;
      this._rumbled = false; this._emerged = false;
    }
    this.spawnT = this.total;
    this.group.rotation.y = this.yaw;
    scene.add(this.group);
    if (opts.crawler) this.makeCrawler();
    if (opts.boss) this.makeBoss(opts.bossDamage || 45);
    if (opts.kind) this.makeKind(opts.kind);
  }

  // Le Bourreau : géant, yeux rouges, frappe fort (fin de partie)
  makeBoss(damage) {
    this.boss = true;
    this.attackDamage = damage;
    this.group.scale.setScalar(1.75);
    this.runner = false; this.limp = false;
    const A = assets();
    const red = A.bossEye || (A.bossEye = new THREE.MeshBasicMaterial({ color: 0xff2010 }));
    for (const e of this.eyes) { e.material = red; e.scale.setScalar(1.6); }
    for (const m of this.mats) m.color.multiplyScalar(0.55);
  }

  // Variantes de la fin de partie : 'armored' (croisé en armure : encaisse, plus lent), 'bloat' (pestiféré gonflé de gaz : explose à sa mort) et
  // 'gargoyle' (Acte V : coureur de pierre qui surgit d'un parapet)
  makeKind(kind) {
    this.kind = kind;
    const A = assets();
    const metal = A.metalMat || (A.metalMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.45, metalness: 0.85, emissive: 0x15181c })); // un peu d'émission : sans envmap un métal sombre serait noir pur
    if (kind === 'armored') {
      this.armor = 0.5; this.speed *= 0.8; this.runner = false;
      this.group.scale.multiplyScalar(1.12);
      for (const m of this.mats) m.color.multiplyScalar(0.7);
      // chevalier de fer : morion à crête, cuirasse à tassettes et épaulières (ironArmor.js, celles de la statue de l'Homme de Fer)
      const k = A.knight || (A.knight = { morion: morionGeometry(), cuirass: cuirassGeometry(), pauldrons: [pauldronGeometry(-1), pauldronGeometry(1)] });
      const morion = new THREE.Mesh(k.morion, metal);
      morion.position.set(0, 0.03, 0.0); morion.scale.setScalar(0.88); this.headGroup.add(morion);
      const cuirass = new THREE.Mesh(k.cuirass, metal);
      cuirass.position.set(0, 0.1, 0.0); cuirass.scale.set(0.64, 0.92, 0.5); this.spine.add(cuirass);
      this.arms.forEach((a, i) => { const pad = new THREE.Mesh(k.pauldrons[i], metal); pad.scale.setScalar(0.72); a.shoulder.add(pad); });
    } else if (kind === 'gargoyle') {
      // gargouille de pierre (Acte V) : coureur gris fissuré, cornes et ailes de chauve-souris repliées ; elle surgit d'un parapet
      this.armor = 0.8; this.runner = true; this.limp = false;
      const stone = A.stoneTex || (A.stoneTex = stoneTexture());
      for (const m of this.mats) { m.map = stone; m.bumpMap = stone; m.color.setRGB(0.85, 0.86, 0.84); m.bumpScale = 1.1; m.roughness = 0.95; }
      this.group.scale.multiplyScalar(1.1);
      const eye = A.gargEye || (A.gargEye = new THREE.MeshBasicMaterial({ color: 0xff7a24 }));
      for (const e of this.eyes) { e.material = eye; e.scale.setScalar(1.5); }
      const hornGeo = A.hornGeo || (A.hornGeo = new THREE.ConeGeometry(0.03, 0.17, 6));
      for (const sx of [-1, 1]) { const h = new THREE.Mesh(hornGeo, this.skinMat); h.position.set(sx * 0.07, 0.17, 0.0); h.rotation.set(-0.35, 0, -sx * 0.45); this.headGroup.add(h); }
      if (!A.wingGeo) { // aile de chauve-souris : contour festonné dans le plan, doublement visible
        const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.2, 0.55); sh.lineTo(0.55, 0.78); sh.lineTo(0.45, 0.42); sh.lineTo(0.78, 0.5); sh.lineTo(0.62, 0.2); sh.lineTo(0.84, 0.18); sh.lineTo(0.5, -0.1); sh.lineTo(0.1, -0.18); sh.closePath();
        A.wingGeo = new THREE.ShapeGeometry(sh);
        A.wingMat = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 0.95, side: THREE.DoubleSide, map: stone, bumpMap: stone });
      }
      this.wings = [];
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(A.wingGeo, A.wingMat); w.scale.set(sx, 1, 1);
        const pivot = new THREE.Group(); pivot.position.set(sx * 0.08, 0.5, -0.14); pivot.rotation.set(0.1, sx * 0.9, 0); pivot.add(w); w.position.set(0, 0, 0); this.spine.add(pivot);
        this.wings.push(pivot);
      }
      this.appear = this._appearT = CONFIG.summit.gargoyles.appear; this._sc0 = this.group.scale.x; this.group.scale.setScalar(this._sc0 * 0.15);
    } else if (kind === 'bloat') {
      this.explodes = true; this.speed *= 0.7; this.runner = false;
      const sc = this.group.scale.x;
      this.group.scale.set(sc * 1.35, sc, sc * 1.35);
      this.skinMat.color.setRGB(0.55, 0.72, 0.28);
      this.shirtMat.color.setRGB(0.55, 0.6, 0.35);
      this.glow = 0x1a2800;
    }
  }

  // Zombie rampant : jambes arrachées, se traîne au sol sur les bras, plus lent
  makeCrawler() {
    if (this.crawler) return;
    this.crawler = true;
    for (const l of this.legs) l.hip.visible = false;
    this.speed *= 0.45;
    this.runner = false;
    this.limp = false;
    // hitbox couchée
    this.hitBody.position.set(0, 0.3, 0.35);
    this.hitBody.scale.set(1.0, 0.42, 1.5);
  }

  _poseCrawl(walk, attacking) {
    const s = Math.sin(walk);
    this.hips.position.y = 0.2 + Math.abs(s) * 0.04;
    this.spine.rotation.x = 1.42 + s * 0.04;
    this.spine.rotation.z = s * 0.1;
    this.headGroup.rotation.x = attacking ? -0.9 : -1.15;
    this.headGroup.rotation.z = Math.sin(walk * 0.8) * 0.15;
    this.headGroup.rotation.y = 0;
    this.jaw.rotation.x = 0.25 + (Math.sin(walk * 1.3) * 0.5 + 0.5) * 0.3;
    this.arms.forEach((a, i) => {
      const ph = i === 0 ? 0 : Math.PI;
      const pull = Math.sin(walk + ph);
      a.shoulder.rotation.x = (attacking ? -2.5 : -2.15) + pull * 0.55;
      a.shoulder.rotation.z = a.side * 0.25;
      a.elbow.rotation.x = -0.25 - Math.max(0, -pull) * 0.7;
    });
  }

  // L'Aube (Acte V) : le zombie tombe en cendres (pâlit, s'affaisse et s'envole en poussière grise) ; il compte comme mort, sans tache de sang
  becomeAsh() {
    if (this.dead) return;
    this.damage(1e9, false);
    this.ashT = 0; this._decal = true;
    if (this.mound) { this.scene.remove(this.mound); this.mound = null; }
    this.group.visible = true; this.group.rotation.x = 0; this.group.rotation.z = 0;
    this._ashY = this.group.scale.y;
    this._ashCol = this.mats.map((m) => m.color.clone());
    fx.emit(this.pos.x, this.pos.y + 1.1, this.pos.z, { count: 7, color: [0xcfcac0, 0x9a968c, 0xe6e2d6], speed: 1.1, up: 1.8, size: 0.13, life: 1.3, grav: -0.6, spread: 0.55, glow: true });
  }
  _ashStep(dt) {
    this.ashT += dt; this.deathT += dt;
    const D = CONFIG.summit.dawn.ash, k = Math.min(1, this.ashT / D);
    this.mats.forEach((m, i) => { m.color.copy(this._ashCol[i]).lerp(ASH, Math.min(1, k * 1.6)); m.emissive.setRGB(0.16 * k, 0.16 * k, 0.15 * k); });
    this.group.scale.y = this._ashY * (1 - 0.94 * k * k);
    if (this.ashT < D && Math.random() < dt * 22) fx.emit(this.pos.x, this.pos.y + 1.6 * (1 - k), this.pos.z, { count: 2, color: [0xcfcac0, 0x9a968c, 0xe6e2d6], speed: 0.8, up: 1.5, size: 0.1, life: 1.1, grav: -0.5, spread: 0.45, glow: true });
    if (this.ashT > D + 0.1) this.group.visible = false;
  }

  // Peut-on lui tirer dessus ? (visible et pas encore sorti = déjà touchable à moitié)
  get targetable() {
    if (this.dead) return false;
    if (this.spawnT <= 0) return true;
    const e = this.spawnElapsed;
    return this.spawnType === 'window' ? e > WIN_WARN + WIN_CLIMB * 0.85 : e > GND_DELAY + GND_RISE * 0.7;
  }

  // Saute l'animation d'apparition (zombie déjà sorti)
  skipSpawn() {
    this.spawnElapsed = this.total;
    this.spawnT = 0;
    this.group.visible = true;
    this.group.rotation.set(0, this.yaw, 0);
    this.pos.y = 0;
    if (this.spawnType === 'window') {
      this.pos.copy(this.spawn.outside);
      if (this.quad && this.quad.userData && this.quad.userData.broke) this.quad.userData.broke();
    } else {
      this.pos.copy(this.spawn.pos);
    }
    this._broke = this._emerged = this._rumbled = true;
  }

  // Retourne true si le zombie meurt.
  damage(amount, isHead = false) {
    if (this.dead) return false;
    this.health -= amount * (this.armor || 1);
    this.hitFlash = 0.1;
    if (this.health <= 0) {
      this.dead = true;
      this.deathT = 0;
      this._decal = false;
      if (isHead) {
        this.headGroup.visible = false; // tête explosée
        fx.blood(this.pos.x, this.pos.y + 1.55, this.pos.z, true);
      } else {
        for (const e of this.eyes) e.visible = false;
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- Pose
  // walk : phase de marche ; arms : 0 = ballants, 1 = tendus ; lean : inclinaison du buste
  _pose(walk, amp, reach, lean, headNod) {
    const s = Math.sin(walk), c = Math.cos(walk);
    this.legs.forEach((l, i) => {
      const ph = i === 0 ? 1 : -1;
      let a = amp;
      let drag = 0;
      if (this.limp && i === 0) { a *= 0.45; drag = 0.25; }
      l.hip.rotation.x = -s * ph * 0.55 * a + drag * 0.5;
      const fwd = Math.max(0, c * ph);
      l.knee.rotation.x = 0.1 + fwd * 0.85 * a + drag;
    });
    this.arms.forEach((a, i) => {
      const ph = i === 0 ? 1 : -1;
      const sway = Math.sin(walk * 0.5 + i * 1.7) * 0.12;
      a.shoulder.rotation.x = -0.25 - reach * 1.25 + sway;
      a.shoulder.rotation.z = a.side * (0.12 - reach * 0.06);
      a.elbow.rotation.x = -0.35 - reach * 0.55 + Math.sin(walk * 0.7 + ph) * 0.08;
    });
    this.spine.rotation.x = lean + Math.sin(walk * 2) * 0.03;
    this.spine.rotation.z = Math.sin(walk) * (this.limp ? 0.12 : 0.05);
    this.hips.position.y = 0.95 - Math.abs(Math.sin(walk)) * 0.025 * amp - (this.limp ? 0.04 : 0);
    this.headGroup.rotation.x = headNod;
    this.headGroup.rotation.z = Math.sin(walk * 0.8) * 0.16;
    this.headGroup.rotation.y = Math.cos(walk * 0.4) * 0.14;
    this.jaw.rotation.x = 0.22 + (Math.sin(walk * 1.3) * 0.5 + 0.5) * 0.28;
    if (this.wings) { const f = Math.sin(walk * 1.5) * 0.16; this.wings[0].rotation.y = -0.9 - f; this.wings[1].rotation.y = 0.9 + f; } // gargouille : les ailes battent
  }

  // ---------------------------------------------------------- Apparition
  _spawnUpdate(dt) {
    this.spawnElapsed += dt;
    const e = this.spawnElapsed;
    this.spawnT = Math.max(0, this.total - e);
    const sp = this.spawn;

    if (this.spawnType === 'window') {
      if (e < WIN_WARN) {
        this.group.visible = false;
        this.quad.userData.warn(e);
        if (e >= this._knocks * 0.3) { this._knocks++; this.onEvent('knock', this); }
        return;
      }
      if (!this._broke) {
        this._broke = true;
        this.group.visible = true;
        this.quad.userData.broke();
        fx.glass(sp.center.x, sp.center.y, sp.center.z, sp.nx, sp.nz);
        this.onEvent('glass', this);
      }
      const t = Math.min(1, (e - WIN_WARN) / WIN_CLIMB);
      const ease = t * t * (3 - 2 * t);
      this.pos.x = sp.inside.x + (sp.outside.x - sp.inside.x) * ease;
      this.pos.z = sp.inside.z + (sp.outside.z - sp.inside.z) * ease;
      this.pos.y = 0.7 * Math.exp(-(((t - 0.45) / 0.24) ** 2));
      this.yaw = sp.yaw;
      this.group.rotation.set(0.5 * Math.sin(Math.PI * t), this.yaw, 0);
      this.walkT += dt * 2.2;
      this._pose(this.walkT, 0.5, 1, 0.35, 0.2);
      if (this.spawnT <= 0) { this.pos.copy(sp.outside); this.pos.y = 0; this.group.rotation.x = 0; }
      return;
    }

    // ---- sol ----
    const m = this.mound;
    if (e < GND_DELAY) {
      this.group.visible = false;
      const k = e / GND_DELAY;
      m.scale.set(0.3 + k * 0.8, 0.05 + k * 0.32, 0.3 + k * 0.8);
      m.position.x = sp.pos.x + Math.sin(e * 55) * 0.03 * k;
      if (!this._rumbled) { this._rumbled = true; this.onEvent('rumble', this); }
      if (Math.random() < dt * 14) fx.dirt(sp.pos.x, 0.25, sp.pos.z, 3);
      return;
    }
    if (!this._emerged) {
      this._emerged = true;
      this.group.visible = true;
      fx.dirt(sp.pos.x, 0.3, sp.pos.z, 26);
      this.onEvent('emerge', this);
    }
    const t = Math.min(1, (e - GND_DELAY) / GND_RISE);
    const ease = 1 - Math.pow(1 - t, 2.2);
    this.pos.x = sp.pos.x; this.pos.z = sp.pos.z;
    this.pos.y = -1.95 + 1.95 * ease;
    this.group.rotation.set(0.35 * (1 - t), this.yaw, 0);
    if (t < 0.9 && Math.random() < dt * 10) fx.dirt(sp.pos.x, 0.1, sp.pos.z, 2);
    m.scale.set(1.1 + t * 0.2, 0.37 * (1 - t * 0.6), 1.1 + t * 0.2);
    this.walkT += dt * 1.6;
    // les bras sortent en premier, tendus vers le haut puis vers l'avant
    this._pose(this.walkT, 0.15, 1.7 - t * 0.7, 0.2 + 0.25 * (1 - t), 0.3 - t * 0.1);
    if (this.spawnT <= 0) { this.pos.y = 0; this.group.rotation.x = 0; }
  }

  _updateMound(dt) {
    if (!this.mound) return;
    if (this.spawnT > 0) return;
    this.moundT += dt;
    const k = Math.max(0, 1 - this.moundT / 6);
    this.mound.scale.y = 0.15 * k + 0.001;
    if (k <= 0) { this.scene.remove(this.mound); this.mound.geometry.dispose(); this.mound.material.dispose(); this.mound = null; }
  }

  // ----------------------------------------------------------- Update
  update(dt, player, others, world) {
    this._updateMound(dt);

    // ----- Mort : chute + tâche de sang -----
    if (this.dead) {
      if (this.ashT != null) { this._ashStep(dt); return; } // l'Aube : il part en cendres
      this.deathT += dt;
      const p = Math.min(1, this.deathT / 0.6);
      const f = 1 - Math.pow(1 - p, 2);
      const g = this.group;
      if (this.deathStyle === 0) g.rotation.x = -f * (Math.PI / 2);
      else if (this.deathStyle === 1) g.rotation.x = f * (Math.PI / 2);
      else g.rotation.z = this.deathSide * f * (Math.PI / 2);
      // membres qui s'affalent
      this.arms.forEach((a) => { a.shoulder.rotation.x *= 1 - dt * 3; a.shoulder.rotation.z += (a.side * 1.1 - a.shoulder.rotation.z) * dt * 4; a.elbow.rotation.x *= 1 - dt * 3; });
      this.legs.forEach((l, i) => { l.hip.rotation.z += ((i ? 1 : -1) * 0.25 - l.hip.rotation.z) * dt * 4; l.hip.rotation.x *= 1 - dt * 3; l.knee.rotation.x *= 1 - dt * 3; });
      if (!this._decal && this.deathT > 0.4) { this._decal = true; fx.decal(this.pos.x, this.pos.z, 1.7); }
      if (this.deathT > 2.5) this.pos.y -= dt * 0.8;
      return;
    }

    // ----- Gargouille : elle gonfle sur son parapet avant de bondir -----
    if (this.appear > 0) {
      this.appear -= dt;
      const k = Math.max(0, Math.min(1, 1 - this.appear / this._appearT)), e = k * k * (3 - 2 * k);
      this.group.scale.setScalar(this._sc0 * (0.15 + 0.85 * e));
    }

    // ----- Flash rouge quand touché -----
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const flash = this.hitFlash > 0 ? 0x660000 : this.glow || 0x000000;
    for (const m of this.mats) m.emissive.setHex(flash);

    // ----- Apparition en cours -----
    if (this.spawnT > 0) { this._spawnUpdate(dt); return; }

    // ----- Pantin réseau (client) : on suit l'état de l'hôte, sans IA -----
    if (this.net) {
      const n = this.net, k = Math.min(1, dt * 10);
      const bx = this.pos.x, bz = this.pos.z;
      // plus loin que drawRange (m) du joueur local : ni dessiné ni animé (il suit seulement l'hôte) ; le Bourreau garde sa propre visibilité
      if (!this.isBoss && Array.isArray(player) && player[0]) {
        const far = Math.hypot(n.x - player[0].pos.x, n.z - player[0].pos.z) > CONFIG.zombie.drawRange;
        if (far !== !this.group.visible) this.group.visible = !far;
        if (far) { this.pos.x = n.x; this.pos.z = n.z; this.pos.y = n.y || 0; return; }
      }
      this.pos.x += (n.x - this.pos.x) * k;
      this.pos.z += (n.z - this.pos.z) * k;
      this.pos.y += ((n.y || 0) - this.pos.y) * k;
      let d = n.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * k;
      this.group.rotation.set(0, this.yaw, 0);
      if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 8) { this.pos.x = n.x; this.pos.z = n.z; this.pos.y = n.y || 0; } // téléporté par l'hôte
      const moving = Math.hypot(this.pos.x - bx, this.pos.z - bz) > this.speed * dt * 0.3;
      this.walkT += dt * (moving ? this.speed * (this.runner ? 2.6 : 3.2) : 1.2);
      const lean = this.runner ? 0.5 : 0.28;
      const att = n.atk;
      if (this.crawler) { this._poseCrawl(this.walkT, att); return; }
      this._pose(this.walkT, moving ? (this.runner ? 1.25 : 1) : 0.15, att ? 1.5 : 0.85, att ? lean + 0.3 : lean, att ? 0.4 : 0.18);
      return;
    }

    const Z = CONFIG.zombie;
    const lv = world.levels, hasLv = !!lv && lv.links.length > 0;
    if (!this.link) this.pos.y = this.region && lv ? lv.regions[this.region].y : 0; // le zombie reste à la hauteur de son étage
    const zr = this.link ? (this.link.dir > 0 ? this.link.link.b : this.link.link.a) : this.region;

    let target = player;
    if (Array.isArray(player)) {
      let bestCost = Infinity;
      target = null;
      // seulement les joueurs debout, et atteignables (par les escaliers) : on ignore les joueurs à terre ou morts
      for (const pl of player) {
        if (!pl || pl.dead || pl.downed) continue;
        let cost = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        if (hasLv) {
          const pr = pl.tregion || 0;
          if (pr !== zr) { const hd = lv.hopDistance(zr, pr); if (hd === Infinity) continue; cost += hd + 12; }
        }
        if (cost < bestCost) { bestCost = cost; target = pl; }
      }
    }
    if (!target) { // personne à poursuivre : il titube sur place
      this.walkT += dt * 1.2;
      this.attacking = false;
      if (this.crawler) this._poseCrawl(this.walkT, false);
      else this._pose(this.walkT, 0.15, 0.85, this.runner ? 0.5 : 0.28, 0.18);
      return;
    }
    if (this.link) { this._onLink(dt, target, world); return; }
    if (this.vault) { this._vaultStep(dt); return; }
    this.vaultCd -= dt;

    // ----- Objectif : le joueur (même étage), ou le pied de l'escalier qui mène vers lui -----
    let gx = target.pos.x, gz = target.pos.z, chase = true;
    const tr = hasLv ? target.tregion || 0 : 0;
    if (hasLv && this.region !== tr) {
      const hop = lv.nextHop(this.region, tr);
      if (!hop) { this.walkT += dt * 1.2; this._pose(this.walkT, 0.15, 0.85, 0.28, 0.18); return; }
      const L = hop.link, e = hop.dir > 0 ? L.path[0] : L.path[L.path.length - 1];
      gx = e[0]; gz = e[2]; chase = false;
      if (Math.hypot(gx - this.pos.x, gz - this.pos.z) < 1.3) { this.link = { link: L, dir: hop.dir, s: hop.dir > 0 ? 0 : L.length }; return; }
    }
    const dx = gx - this.pos.x;
    const dz = gz - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // ----- Direction : tout droit si l'objectif est visible, sinon via le flow field de l'étage -----
    const nav = this.region && lv ? lv.regions[this.region].nav : world.nav;
    let dirx = dx / (dist || 1), dirz = dz / (dist || 1);
    let visible = true;
    if (nav) {
      visible = dist < 1.5 || nav.los(this.pos.x, this.pos.z, gx, gz);
      if (!visible) {
        const s = nav.steer(this.pos.x, this.pos.z, this._steer);
        if (s) { dirx = s.x; dirz = s.z; }
      }
    }

    // ----- Orientation (lissée) -----
    const targetYaw = Math.atan2(dirx, dirz);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 8);
    this.group.rotation.set(0, this.yaw, 0);

    // ----- Déplacement -----
    this.attackCd -= dt;
    const inRange = chase && dist < Z.attackRange && visible && Math.abs(target.pos.y - this.pos.y) < 2.4;
    let moving = false;
    if (!inRange && this.attackWindup < 0) {
      moving = true;
      if (this.sidestepT > 0) {
        this.sidestepT -= dt;
        const a = this.sidestepDir * 1.2;
        const c = Math.cos(a), s = Math.sin(a);
        [dirx, dirz] = [dirx * c - dirz * s, dirx * s + dirz * c];
      }
      const bx = this.pos.x, bz = this.pos.z;
      const sp = this.limp ? this.speed * 0.8 : this.speed;
      if (!visible && this.vaultCd <= 0 && !this.crawler && !this.region && this._tryVault(dirx, dirz, world, nav)) return; // le champ de flux traverse un obstacle bas : on l'enjambe
      this.pos.x += dirx * sp * dt;
      this.pos.z += dirz * sp * dt;

      for (const o of others) {
        if (o === this || o.dead || o.spawnT > 0) continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const d = Math.hypot(ox, oz);
        if (d > 0 && d < 0.8 && o.region === this.region && !o.link) {
          const push = (0.8 - d) * 0.5;
          this.pos.x += (ox / d) * push;
          this.pos.z += (oz / d) * push;
        }
      }
      world.collide(this.pos, Z.radius);

      const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
      if (moved < sp * dt * 0.25) this.noProgress += dt;
      else this.noProgress = Math.max(0, this.noProgress - dt * 2);
      if (moved < sp * dt * 0.4) {
        this.stuckT += dt;
        if (this.stuckT > 0.4 && this.sidestepT <= 0) {
          this.sidestepT = 1.2;
          this.sidestepDir = Math.random() < 0.5 ? -1 : 1;
          this.stuckT = 0;
        }
      } else {
        this.stuckT = 0;
      }
      this.walkT += dt * sp * (this.runner ? 2.6 : 3.2);
    } else {
      this.walkT += dt * 1.2;
    }

    // ----- Attaque -----
    if (this.attackWindup >= 0) {
      this.attackWindup -= dt;
      if (this.attackWindup < 0) {
        if (Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) < Z.attackRange + 0.5 && Math.abs(target.pos.y - this.pos.y) < 2.6) {
          target.hurt(this.attackDamage || Z.damage);
          world.onStrike?.(target); // crochet des motos : la moto de la victime perd des PV (hôte)
        }
        this.attackCd = Z.attackCooldown;
        this.attackWindup = -1;
      }
    } else if (inRange && this.attackCd <= 0) {
      this.attackWindup = 0.35;
    }

    // ----- Pose -----
    const attacking = this.attackWindup >= 0;
    this.attacking = attacking;
    if (this.crawler) { this._poseCrawl(this.walkT, attacking); return; }
    const lean = this.runner ? 0.5 : 0.28;
    this._pose(this.walkT, moving ? (this.runner ? 1.25 : 1) : 0.15, attacking ? 1.5 : 0.85, attacking ? lean + 0.3 : lean, attacking ? 0.4 : 0.18);
  }

  // Enjambement (zombie) : devant un obstacle enjambable (banc, caisse, barrière…) que le champ de flux traverse, si l'arrivée est libre et
  // plus proche du joueur (walkDistance) : CONFIG.zombie.vault.time s de saut, sans collision, arme tendue comme à une fenêtre.
  _tryVault(dirx, dirz, world, nav) {
    const V = CONFIG.zombie.vault, col = world.collision;
    if (!col?.findVault || !nav?.walkDistance) return false;
    const h = col.findVault(this.pos.x, this.pos.z, dirx, dirz, V.reach, this._vh || (this._vh = {}));
    if (!h || h.tOut - h.tIn > 1.3 || -(dirx * h.nx + dirz * h.nz) < Math.cos((V.maxAngle * Math.PI) / 180)) return false;
    const lx = this.pos.x + dirx * (h.tOut + 0.5), lz = this.pos.z + dirz * (h.tOut + 0.5);
    const q = this._vq || (this._vq = { x: 0, y: 0, z: 0 });
    q.x = lx; q.y = 0; q.z = lz; world.collide(q, CONFIG.zombie.radius);
    if (Math.hypot(q.x - lx, q.z - lz) > 0.05 || nav.isBlockedAt(lx, lz)) return false;
    if (!(nav.walkDistance(lx, lz) < nav.walkDistance(this.pos.x, this.pos.z) - 0.3)) return false; // pas de progrès : inutile
    this.vault = { t: 0, x0: this.pos.x, z0: this.pos.z, x1: lx, z1: lz };
    this.attacking = false;
    return true;
  }

  _vaultStep(dt) {
    const v = this.vault, V = CONFIG.zombie.vault;
    v.t += dt;
    const u = Math.min(1, v.t / V.time), e = u * u * (3 - 2 * u);
    this.pos.x = v.x0 + (v.x1 - v.x0) * e; this.pos.z = v.z0 + (v.z1 - v.z0) * e;
    this.pos.y = V.arc * Math.sin(Math.PI * u);
    this.yaw = Math.atan2(v.x1 - v.x0, v.z1 - v.z0);
    this.group.rotation.set(0, this.yaw, 0);
    this.walkT += dt * 6;
    this.attacking = false;
    if (this.crawler) this._poseCrawl(this.walkT, false);
    else this._pose(this.walkT, 0.8, 1.6, 0.4, 0.2);
    if (u >= 1) { this.vault = null; this.vaultCd = V.cooldown; this.pos.y = 0; this.noProgress = 0; this.stuckT = 0; }
  }

  // Sur un escalier : le zombie suit le chemin 3D du lien (ou va à la rencontre du joueur qui s'y trouve) et frappe sur place
  _onLink(dt, target, world) {
    const lv = world.levels, k = this.link, L = k.link, Z = CONFIG.zombie;
    this.attackCd -= dt;
    const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, dy = target.pos.y - this.pos.y;
    const d3 = Math.hypot(dx, dz, dy);
    let moving = this.attackWindup < 0;
    if (target.region === L.region) { // le joueur est sur la même volée de marches : on va vers lui
      const ps = lv.project(L, target.pos.x, target.pos.z, target.pos.y);
      k.dir = ps >= k.s ? 1 : -1;
      if (Math.abs(ps - k.s) < 1.3) moving = false;
    }
    const inRange = d3 < Z.attackRange + 0.2 && Math.abs(dy) < 2.2;
    if (inRange) moving = false;
    const sp = this.limp ? this.speed * 0.8 : this.speed;
    const tmp = this._lk || (this._lk = { x: 0, y: 0, z: 0, yaw: 0 });
    if (moving) k.s += k.dir * sp * 0.9 * dt;
    lv.pointOn(L, k.s, tmp);
    this.pos.set(tmp.x, tmp.y, tmp.z);
    let diff = (inRange ? Math.atan2(dx, dz) : tmp.yaw + (k.dir < 0 ? Math.PI : 0)) - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 8);
    this.group.rotation.set(0, this.yaw, 0);
    if (moving) this.walkT += dt * sp * (this.runner ? 2.6 : 3.2); else this.walkT += dt * 1.2;
    if (this.attackWindup >= 0) {
      this.attackWindup -= dt;
      if (this.attackWindup < 0) {
        if (d3 < Z.attackRange + 0.7) target.hurt(this.attackDamage || Z.damage);
        this.attackCd = Z.attackCooldown; this.attackWindup = -1;
      }
    } else if (inRange && this.attackCd <= 0) this.attackWindup = 0.35;
    this.attacking = this.attackWindup >= 0;
    if (k.s <= 0 || k.s >= L.length) { // arrivé : on reprend l'IA normale sur l'étage d'arrivée
      this.region = k.dir > 0 ? L.b : L.a;
      this.link = null;
    }
    if (this.crawler) { this._poseCrawl(this.walkT, this.attacking); return; }
    const lean = this.runner ? 0.5 : 0.28;
    this._pose(this.walkT, moving ? (this.runner ? 1.25 : 1) : 0.15, this.attacking ? 1.5 : 0.85, this.attacking ? lean + 0.3 : lean, this.attacking ? 0.4 : 0.18);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
    if (this.mound) { this.scene.remove(this.mound); this.mound.geometry.dispose(); this.mound.material.dispose(); this.mound = null; }
  }
}
