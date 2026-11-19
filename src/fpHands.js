import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { camoTexture, clothTexture } from './characters.js';

// =====================================================================
//  Mains articulées à la première personne (par personnage), animations
//  de tir / rechargement synchronisées aux pièces mobiles de l'arme
//  (glissière, pompe, chargeur, verrou) et modèle 3D détaillé de grenade.
// =====================================================================

const sm = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ------------------------------------------------------------------ Grenade à fragmentation 3D (M67 / tactique)
let NADE_CACHE = null;
function nadeResources() {
  if (NADE_CACHE) return NADE_CACHE;
  // Texture fragmentée quadrillée + bande jaune tactique
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#3c4a2a'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#28331c';
  for (let y = 20; y < 108; y += 14) x.fillRect(0, y, 128, 3);
  for (let px = 0; px < 128; px += 16) x.fillRect(px, 20, 3, 88);
  // bande jaune militaire d'identification (explosif brisant)
  x.fillStyle = '#d8b42c'; x.fillRect(0, 26, 128, 8);
  // éraflures métalliques légères
  let s = 313; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 180; i++) {
    x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(210,220,190,0.10)';
    x.fillRect(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 1 + rnd() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;

  // Profil tourné du corps de grenade (ovale cranté + collet fileté)
  const pts = [
    [0.001, -0.072], [0.026, -0.07], [0.052, -0.052], [0.064, -0.02],
    [0.066, 0.008], [0.06, 0.036], [0.044, 0.058], [0.024, 0.07], [0.024, 0.088], [0.001, 0.088],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(pts, 16);
  const fuseGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.034, 12);
  const headGeo = new THREE.BoxGeometry(0.038, 0.022, 0.03);
  const spoonTopGeo = new THREE.BoxGeometry(0.022, 0.008, 0.054);
  const spoonSideGeo = new THREE.BoxGeometry(0.02, 0.115, 0.009);
  const ringGeo = new THREE.TorusGeometry(0.022, 0.0038, 8, 16);
  const ledGeo = new THREE.SphereGeometry(0.011, 8, 6);

  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.56, metalness: 0.42 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x626870, roughness: 0.35, metalness: 0.85 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc29b42, roughness: 0.32, metalness: 0.88 });
  const spoonMat = new THREE.MeshStandardMaterial({ color: 0x262c22, roughness: 0.52, metalness: 0.65 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xff5a22, emissive: 0xff4410, emissiveIntensity: 2.6, roughness: 0.25 });

  NADE_CACHE = { bodyGeo, fuseGeo, headGeo, spoonTopGeo, spoonSideGeo, ringGeo, ledGeo, bodyMat, steelMat, brassMat, spoonMat, ledMat };
  return NADE_CACHE;
}

// Construit une grenade 3D détaillée. withPin = true pour la vue en main, withLed = true pour la grenade dégoupillée au sol.
export function makeGrenadeModel({ withPin = false, withLed = true, scale = 1 } = {}) {
  const R = nadeResources();
  const g = new THREE.Group();
  const body = new THREE.Mesh(R.bodyGeo, R.bodyMat);
  body.castShadow = true;
  g.add(body);
  const fuse = new THREE.Mesh(R.fuseGeo, R.brassMat);
  fuse.position.y = 0.098;
  g.add(fuse);
  const head = new THREE.Mesh(R.headGeo, R.steelMat);
  head.position.set(0.004, 0.116, 0);
  g.add(head);
  // Cuillère / levier de sûreté
  const sTop = new THREE.Mesh(R.spoonTopGeo, R.spoonMat);
  sTop.position.set(0.024, 0.125, 0); sTop.rotation.y = Math.PI / 2;
  g.add(sTop);
  const sSide = new THREE.Mesh(R.spoonSideGeo, R.spoonMat);
  sSide.position.set(0.068, 0.056, 0); sSide.rotation.set(0, Math.PI / 2, 0.16);
  g.add(sSide);
  if (withPin) {
    const ring = new THREE.Mesh(R.ringGeo, R.steelMat);
    ring.position.set(-0.028, 0.114, 0.016); ring.rotation.y = 0.4;
    g.add(ring);
  }
  if (withLed) {
    // Indicateur incandescent de mèche allumée (lisible même la nuit)
    const led = new THREE.Mesh(R.ledGeo, R.ledMat.clone());
    led.position.set(0, 0.132, 0);
    led.name = 'fuseLed';
    g.add(led);
  }
  if (scale !== 1) g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------------------ Rig de bras & mains articulés à la première personne
const ARM_GEO = {
  forearm: new THREE.CylinderGeometry(0.046, 0.030, 0.38, 14), // +Y -> +Z (shoulder = wider), -Y -> -Z (wrist = slimmer)
  cuff: new THREE.CylinderGeometry(0.033, 0.031, 0.036, 14),
  wristBand: new THREE.CylinderGeometry(0.0345, 0.0345, 0.016, 14),
  palm: new RoundedBoxGeometry(0.064, 0.040, 0.074, 2, 0.014),
  knuckle: new RoundedBoxGeometry(0.060, 0.013, 0.020, 2, 0.005),
  thumb: new THREE.CapsuleGeometry(0.0105, 0.030, 4, 8),
  finger: new THREE.CapsuleGeometry(0.009, 0.036, 4, 8),
  watchFace: new THREE.CylinderGeometry(0.016, 0.016, 0.008, 12),
  watchDial: new THREE.CylinderGeometry(0.012, 0.012, 0.009, 12),
  button: new THREE.SphereGeometry(0.007, 8, 6),
};

export class FPHands {
  constructor(vmGroup) {
    this.vm = vmGroup;
    this.root = new THREE.Group();
    this.root.name = 'fpHands';
    vmGroup.add(this.root);

    // Matériaux partagés mis à jour selon le personnage choisi (setCharacter)
    this.mats = {
      sleeve: new THREE.MeshStandardMaterial({ color: 0x4a5530, roughness: 0.85, metalness: 0.05, map: clothTexture() }),
      cuff: new THREE.MeshStandardMaterial({ color: 0x262a1e, roughness: 0.72, metalness: 0.12 }),
      hand: new THREE.MeshStandardMaterial({ color: 0x232620, roughness: 0.68, metalness: 0.08 }),
      finger: new THREE.MeshStandardMaterial({ color: 0x1b1e19, roughness: 0.72, metalness: 0.05 }),
      knuckle: new THREE.MeshStandardMaterial({ color: 0x3b4032, roughness: 0.45, metalness: 0.35 }),
      accent: new THREE.MeshStandardMaterial({ color: 0x8ea850, roughness: 0.35, metalness: 0.45 }),
      dial: new THREE.MeshStandardMaterial({ color: 0x182618, emissive: 0x38ff66, emissiveIntensity: 1.4, roughness: 0.2 }),
    };

    this.left = this._buildArm(-1);
    this.right = this._buildArm(1);
    this.root.add(this.left.group, this.right.group);

    // Grenade tenue en main pendant l'animation de lancer
    this.nadeProp = makeGrenadeModel({ withPin: true, withLed: false, scale: 0.78 });
    this.nadeProp.visible = false;
    this.nadeProp.position.set(0, 0.015, -0.055);
    this.right.hand.add(this.nadeProp);

    this.ch = null;
    this.handScale = 1;
    this.stance = 'tactical';
    this.triggerPull = 0;
    this.shotT = 99;     // temps écoulé depuis le dernier tir (pompe / verrou / culasse)
    this.nadeT = -1;     // timer animation de lancer de grenade
    this.nadeDur = 0.42;

    // Vecteurs de travail réutilisés (0 allocation par frame)
    this._tL = new THREE.Vector3();
    this._tR = new THREE.Vector3();
    this._sL = new THREE.Vector3(-0.42, -0.38, 0.34);
    this._sR = new THREE.Vector3(0.34, -0.36, 0.34);
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._mat = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  _buildArm(side) {
    const group = new THREE.Group();
    // Avant-bras (orienté depuis le poignet vers l'épaule)
    const forearm = new THREE.Group();
    const sl = new THREE.Mesh(ARM_GEO.forearm, this.mats.sleeve);
    sl.rotation.x = Math.PI / 2;
    sl.position.z = 0.21;
    forearm.add(sl);
    const cuff = new THREE.Mesh(ARM_GEO.cuff, this.mats.cuff);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.026;
    forearm.add(cuff);
    const band = new THREE.Mesh(ARM_GEO.wristBand, this.mats.accent);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.052;
    forearm.add(band);

    // Accessoires de poignet (affichés sélectivement selon le personnage)
    const wristItems = {};
    if (side === -1) {
      const watch = new THREE.Group();
      const body = new THREE.Mesh(ARM_GEO.watchFace, this.mats.knuckle);
      body.position.set(0, 0.042, 0.05);
      const dial = new THREE.Mesh(ARM_GEO.watchDial, this.mats.dial);
      dial.position.set(0, 0.044, 0.05);
      watch.add(body, dial);
      forearm.add(watch);
      wristItems.watch = watch;
    }
    const cufflink = new THREE.Mesh(ARM_GEO.button, this.mats.accent);
    cufflink.position.set(side * 0.042, 0.0, 0.042);
    forearm.add(cufflink);
    wristItems.cufflink = cufflink;

    group.add(forearm);

    // Main sculptée au point d'ancrage (0, 0, 0)
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(ARM_GEO.palm, this.mats.hand);
    palm.position.set(0, 0, -0.022);
    hand.add(palm);

    const kn = new THREE.Mesh(ARM_GEO.knuckle, this.mats.knuckle);
    kn.position.set(0, 0.022, -0.044);
    hand.add(kn);

    // Pouce
    const thumb = new THREE.Group();
    thumb.position.set(-side * 0.034, 0.008, -0.022);
    const thMesh = new THREE.Mesh(ARM_GEO.thumb, this.mats.finger);
    thMesh.rotation.set(Math.PI / 2 - 0.3, 0, side * 0.45);
    thMesh.position.set(-side * 0.012, 0.008, -0.02);
    thumb.add(thMesh);
    hand.add(thumb);

    // Index (sur la détente pour la main droite)
    const index = new THREE.Group();
    index.position.set(-side * 0.022, 0.002, -0.056);
    const ixMesh = new THREE.Mesh(ARM_GEO.finger, this.mats.finger);
    ixMesh.rotation.x = Math.PI / 2 + 0.5;
    ixMesh.position.set(0, -0.012, -0.018);
    index.add(ixMesh);
    hand.add(index);

    // Majeur, annulaire, auriculaire groupés (s'enroulent sur la crosse / le garde-main)
    const fingers = new THREE.Group();
    fingers.position.set(side * 0.008, -0.002, -0.056);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(ARM_GEO.finger, this.mats.finger);
      f.scale.set(0.95 - i * 0.06, 1 - i * 0.09, 0.95);
      f.rotation.x = Math.PI / 2 + 0.95;
      f.position.set(side * (i - 0.7) * 0.017, -0.016, -0.012);
      fingers.add(f);
    }
    hand.add(fingers);

    group.add(hand);
    return { group, forearm, hand, thumb, index, fingers, band, kn, wristItems };
  }

  // Applique l'apparence complète du personnage choisi (manches, manchettes, gants/peau, accessoires de poignet, gabarit)
  setCharacter(ch) {
    if (!ch || !ch.fp) return;
    this.ch = ch;
    const fp = ch.fp;
    const M = this.mats;
    M.sleeve.map = fp.camo ? camoTexture() : clothTexture();
    M.sleeve.color.setHex(fp.camo ? 0xffffff : fp.sleeve);
    M.sleeve.needsUpdate = true;
    M.cuff.color.setHex(fp.cuff);
    M.hand.color.setHex(fp.hand);
    M.finger.color.setHex(fp.finger);
    M.knuckle.color.setHex(fp.knuckle ?? fp.hand);
    M.accent.color.setHex(fp.accent ?? fp.cuff);
    // Effet lumineux discret sur la bande cyber de Klukai / relique de Lucian / haute visibilité de Karim
    const isGlow = fp.wrist === 'tech' || fp.wrist === 'hivis';
    M.accent.emissive.setHex(fp.wrist === 'tech' ? 0x22b8ff : fp.wrist === 'hivis' ? 0x99a600 : 0x000000);
    M.accent.emissiveIntensity = isGlow ? (fp.wrist === 'tech' ? 1.4 : 0.35) : 0;
    M.hand.roughness = fp.bare || fp.duck ? 0.76 : 0.62;
    M.finger.roughness = fp.bare || fp.fingerless || fp.duck ? 0.76 : 0.64;

    this.handScale = fp.handScale || 1;
    this.stance = fp.stance || 'tactical';
    for (const arm of [this.left, this.right]) {
      arm.hand.scale.setScalar(this.handScale);
      arm.kn.visible = !fp.bare && !fp.duck;
      arm.band.visible = fp.wrist === 'hivis' || fp.wrist === 'tech' || fp.wrist === 'medband' || fp.wrist === 'gryff' || fp.wrist === 'bracelet';
      if (arm.wristItems.watch) arm.wristItems.watch.visible = fp.wrist === 'watch';
      if (arm.wristItems.cufflink) arm.wristItems.cufflink.visible = fp.wrist === 'cufflink' || fp.wrist === 'relic';
    }
  }

  onFire() {
    this.triggerPull = 1;
    this.shotT = 0;
  }

  onThrowGrenade() {
    this.nadeT = 0;
  }

  // Oriente un bras de manière que la main soit en `handPos`, pointée vers le canon, et que l'avant-bras rejoigne l'épaule virtuelle
  _placeArm(arm, handPos, shoulderPos, handRotX, handRotY, handRotZ) {
    arm.group.position.copy(handPos);
    arm.hand.rotation.set(handRotX, handRotY, handRotZ);
    // Oriente l'avant-bras du poignet (0,0,0) vers shoulderPos (dans le repère du groupe)
    this._dir.subVectors(shoulderPos, handPos);
    const len = this._dir.length();
    if (len > 1e-4) {
      this._dir.divideScalar(len);
      // Le cylindre d'avant-bras s'étend le long de +Z local
      this._mat.lookAt(new THREE.Vector3(0, 0, 0), this._dir.clone().negate(), this._up);
      arm.forearm.quaternion.setFromRotationMatrix(this._mat);
    }
  }

  // Met à jour la position des mains, des doigts, et des pièces mobiles de l'arme active (slidePivot, pumpPivot, magPivot)
  // Retourne un décalage d'animation d'arme { dx, dy, dz, rx, ry, rz } à appliquer sur `vm`.
  update(dt, { weaponGrp, handDef, activeAcc = [], reloading = false, reloadFrac = 0, aiming = 0, sprinting = false, visible = true }) {
    this.root.visible = visible;
    this.triggerPull = Math.max(0, this.triggerPull - dt * 11);
    this.shotT = Math.min(5, this.shotT + dt);

    const animOut = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 };
    if (!visible || !weaponGrp || !handDef) return animOut;

    const style = handDef.style || 'rifle';
    const hasFg = activeAcc.includes('foregrip') && !!handDef.fg;

    // Pièces mobiles de l'arme active
    const slidePiv = weaponGrp.getObjectByName('slidePivot');
    const pumpPiv = weaponGrp.getObjectByName('pumpPivot');
    const magPiv = weaponGrp.getObjectByName('magPivot');
    if (slidePiv) { slidePiv.position.set(0, 0, 0); slidePiv.rotation.set(0, 0, 0); }
    if (pumpPiv) pumpPiv.position.set(0, 0, 0);
    if (magPiv) { magPiv.position.set(0, 0, 0); magPiv.rotation.set(0, 0, 0); }

    // ------------------------------------------------------------ Animation de lancer de grenade
    if (this.nadeT >= 0) {
      this.nadeT += dt;
      const u = this.nadeT / this.nadeDur;
      if (u >= 1) {
        this.nadeT = -1;
        this.nadeProp.visible = false;
      } else {
        this.nadeProp.visible = u < 0.72;
        // L'arme plonge brièvement hors champ pendant le lancer
        const hideW = Math.sin(u * Math.PI);
        animOut.dy -= hideW * 0.24;
        animOut.rx += hideW * 0.45;
        // Main droite lève la grenade puis la propulse en avant
        const wind = u < 0.38 ? sm(u / 0.38) : 1;
        const flick = u > 0.38 ? sm((u - 0.38) / 0.36) : 0;
        const ret = u > 0.74 ? sm((u - 0.74) / 0.26) : 0;
        this._tR.set(lerp(0.14, 0.04, flick), lerp(-0.1, 0.08, wind) - flick * 0.05, lerp(0.06, -0.26, flick) + ret * 0.2);
        this._tL.set(-0.08 - flick * 0.14, -0.06 + wind * 0.05 - flick * 0.14, -0.06 + wind * 0.06);
        this._placeArm(this.right, this._tR, this._sR, -0.3 + flick * 0.8, 0.15, 0.1);
        this._placeArm(this.left, this._tL, this._sL, 0.1, -0.2, -0.2);
        this.right.fingers.rotation.x = u > 0.55 ? -0.45 : 0.25;
        return animOut;
      }
    }
    this.nadeProp.visible = false;

    // ------------------------------------------------------------ Positions de base des deux mains (adaptées à l'arme + poignée)
    const back = handDef.back;
    const front = hasFg ? handDef.fg : (handDef.front || new THREE.Vector3(back.x - 0.022, back.y - 0.008, back.z - 0.028));
    this._tR.copy(back).add(new THREE.Vector3(0.012, -0.006, 0.022));
    this._tL.copy(front).add(new THREE.Vector3(hasFg ? -0.018 : -0.012, hasFg ? -0.01 : -0.012, 0.018));

    // Légère adaptation de posture selon le personnage (sans décentrer la visée ADS)
    const hip = 1 - aiming;
    if (this.stance === 'heavy') { animOut.dy -= 0.012 * hip; animOut.rz -= 0.03 * hip; }
    else if (this.stance === 'agile') { animOut.dy += 0.008 * hip; animOut.rz += 0.03 * hip; }
    else if (this.stance === 'tactical') { animOut.rz -= 0.02 * hip; }

    let lRotX = hasFg ? -0.15 : 0.15, lRotY = hasFg ? -0.45 : -0.22, lRotZ = hasFg ? -0.95 : -0.55;
    let rRotX = -0.15, rRotY = 0.1, rRotZ = 0.12;
    let lCurl = hasFg ? 0.35 : 0.1;

    // ------------------------------------------------------------ Animations de tir (glissière, pompe, verrou)
    if (!reloading) {
      // Blowback de culasse / glissière à chaque tir
      if (slidePiv && this.shotT < 0.14) {
        const bk = Math.sin(clamp01(this.shotT / 0.14) * Math.PI);
        slidePiv.position.z = bk * (style === 'pistol' ? 0.042 : 0.032);
      }
      // Fusil à pompe (Remington 870) : la main gauche et la pompe reculent puis reviennent après le coup
      if (style === 'pump' && this.shotT > 0.14 && this.shotT < 0.56) {
        const p = (this.shotT - 0.14) / 0.42;
        const pull = p < 0.48 ? sm(p / 0.48) : 1 - sm((p - 0.48) / 0.52);
        if (pumpPiv) pumpPiv.position.z = pull * 0.095;
        if (slidePiv) slidePiv.position.z = pull * 0.055;
        this._tL.z += pull * 0.095;
        animOut.rx += pull * 0.07;
        animOut.rz -= pull * 0.06;
      }
      // Sniper à verrou (L96A1) : la main droite lâche la poignée et actionne le verrou
      if (style === 'bolt' && this.shotT > 0.16 && this.shotT < 0.72) {
        const p = (this.shotT - 0.16) / 0.56;
        const reach = p < 0.2 ? sm(p / 0.2) : p > 0.8 ? 1 - sm((p - 0.8) / 0.2) : 1;
        const pull = p > 0.22 && p < 0.78 ? Math.sin(((p - 0.22) / 0.56) * Math.PI) : 0;
        const bolt = handDef.bolt;
        if (bolt) {
          this._tR.lerp(new THREE.Vector3(bolt.x + 0.028, bolt.y + 0.015, bolt.z + 0.02 + pull * 0.07), reach);
          rRotZ = lerp(rRotZ, -0.5, reach);
        }
        if (slidePiv) {
          slidePiv.position.z = pull * 0.068;
          slidePiv.rotation.z = reach * 0.45;
        }
        animOut.rz += reach * 0.14;
        animOut.rx += pull * 0.05;
      }
    }

    // ------------------------------------------------------------ Animations de rechargement multi-phases
    if (reloading) {
      const p = clamp01(reloadFrac);
      const magPos = handDef.mag || new THREE.Vector3(0, -0.12, -0.05);
      const boltPos = handDef.bolt || new THREE.Vector3(-0.02, 0.03, 0.0);

      if (style === 'pump') {
        // Rechargement cartouche par cartouche par-dessous, puis coup de pompe final
        const tilt = p < 0.12 ? sm(p / 0.12) : p > 0.88 ? 1 - sm((p - 0.88) / 0.12) : 1;
        animOut.rx += tilt * 0.28;
        animOut.rz -= tilt * 0.48;
        animOut.dy -= tilt * 0.06;
        if (p < 0.74) {
          const cyc = ((p - 0.1) / 0.64) * 3;
          const f = cyc - Math.floor(Math.max(0, cyc));
          const feed = Math.sin(clamp01(f) * Math.PI);
          this._tL.lerp(new THREE.Vector3(magPos.x - 0.03, magPos.y - 0.14 + feed * 0.13, magPos.z + 0.02), tilt);
          lRotZ = -0.2; lCurl = 0.4;
          animOut.dy += feed * 0.012;
        } else {
          // Coup de pompe final
          const q = clamp01((p - 0.74) / 0.22);
          const pull = Math.sin(q * Math.PI);
          if (pumpPiv) pumpPiv.position.z = pull * 0.095;
          if (slidePiv) slidePiv.position.z = pull * 0.055;
          this._tL.z += pull * 0.095;
        }
      } else if (style === 'revolver') {
        const tilt = p < 0.15 ? sm(p / 0.15) : p > 0.85 ? 1 - sm((p - 0.85) / 0.15) : 1;
        animOut.rz += tilt * 0.65;
        animOut.rx += tilt * 0.22;
        animOut.dy -= tilt * 0.08;
        const load = p > 0.25 && p < 0.75 ? Math.sin(((p - 0.25) / 0.5) * Math.PI) : 0;
        this._tL.lerp(new THREE.Vector3(magPos.x - 0.04, magPos.y - 0.12 + load * 0.12, magPos.z + 0.03), tilt);
        if (p > 0.78 && p < 0.92) animOut.rz -= Math.sin(((p - 0.78) / 0.14) * Math.PI) * 0.4; // claquement du barillet
      } else if (style === 'break' || style === 'crossbow') {
        const open = p < 0.18 ? sm(p / 0.18) : p > 0.82 ? 1 - sm((p - 0.82) / 0.18) : 1;
        animOut.rx -= open * 0.35;
        animOut.rz -= open * 0.22;
        animOut.dy -= open * 0.08;
        const insert = p > 0.22 && p < 0.78 ? Math.sin(((p - 0.22) / 0.56) * Math.PI) : 0;
        this._tL.lerp(new THREE.Vector3(magPos.x - 0.02, magPos.y - 0.12 + insert * 0.13, magPos.z + (1 - insert) * 0.08), open);
        lCurl = 0.3;
      } else {
        // Rechargement par chargeur / caisse de munitions :
        // Phase 1 (0..0.18) inclinaison + main gauche sur chargeur
        // Phase 2 (0.18..0.44) extraction du chargeur vers le bas (magPivot suit la main !)
        // Phase 3 (0.44..0.72) insertion du nouveau chargeur + petit choc d'enclenchement
        // Phase 4 (0.72..0.90) armement de la culasse / levier (slidePivot recule)
        // Phase 5 (0.90..1.00) retour sur le garde-main
        const cant = p < 0.14 ? sm(p / 0.14) : p > 0.9 ? 1 - sm((p - 0.9) / 0.1) : 1;
        const isMg = style === 'mg';
        animOut.rz -= cant * (isMg ? 0.22 : 0.36);
        animOut.rx += cant * (isMg ? 0.2 : 0.16);
        animOut.dy -= cant * (isMg ? 0.09 : 0.055);
        animOut.dx -= cant * 0.025;

        if (p < 0.18) {
          const u = sm(p / 0.18);
          this._tL.lerp(new THREE.Vector3(magPos.x - 0.02, magPos.y - 0.02, magPos.z + 0.02), u);
          lRotZ = lerp(lRotZ, -0.2, u);
        } else if (p < 0.44) {
          const u = sm((p - 0.18) / 0.26);
          const drop = u * 0.26;
          this._tL.set(magPos.x - 0.025, magPos.y - 0.02 - drop, magPos.z + 0.03 + u * 0.04);
          if (magPiv) { magPiv.position.y = -drop; magPiv.rotation.x = u * 0.18; }
          lRotZ = -0.15; lCurl = 0.45;
        } else if (p < 0.72) {
          const u = sm((p - 0.44) / 0.28);
          const drop = (1 - u) * 0.28;
          this._tL.set(magPos.x - 0.025, magPos.y - 0.02 - drop, magPos.z + 0.03 + (1 - u) * 0.04);
          if (magPiv) { magPiv.position.y = -drop; magPiv.rotation.x = (1 - u) * 0.15; }
          if (u > 0.85) { const bump = Math.sin(((u - 0.85) / 0.15) * Math.PI); animOut.dy += bump * 0.022; animOut.rx -= bump * 0.05; }
          lRotZ = -0.15; lCurl = 0.45;
        } else if (p < 0.90) {
          const u = (p - 0.72) / 0.18;
          const grab = u < 0.3 ? sm(u / 0.3) : u > 0.75 ? 1 - sm((u - 0.75) / 0.25) : 1;
          const rack = u > 0.28 && u < 0.78 ? Math.sin(((u - 0.28) / 0.5) * Math.PI) : 0;
          this._tL.lerp(new THREE.Vector3(boltPos.x - 0.02, boltPos.y + 0.01, boltPos.z + 0.02 + rack * 0.055), grab);
          if (slidePiv) slidePiv.position.z = rack * (style === 'pistol' ? 0.045 : 0.04);
          animOut.dz += rack * 0.024;
          animOut.rx += rack * 0.04;
          lRotZ = lerp(lRotZ, 0.1, grab);
        } else {
          const u = sm((p - 0.90) / 0.10);
          const from = new THREE.Vector3(boltPos.x - 0.02, boltPos.y + 0.01, boltPos.z + 0.02);
          this._tL.lerpVectors(from, this._tL, u);
        }
      }
    }

    // Main droite : pression réaliste de l'index sur la détente au tir
    this.right.index.rotation.x = this.triggerPull * 0.55;
    this.right.fingers.rotation.x = 0.22;
    this.left.fingers.rotation.x = lCurl;

    // Épaules virtuelles légèrement décalées quand on sprinte ou vise
    const sL = this._sL.set(-0.42 - (sprinting ? 0.04 : 0), -0.38, 0.34);
    const sR = this._sR.set(0.34, -0.36, 0.34);
    this._placeArm(this.left, this._tL, sL, lRotX, lRotY, lRotZ);
    this._placeArm(this.right, this._tR, sR, rRotX, rRotY, rRotZ);

    return animOut;
  }
}
