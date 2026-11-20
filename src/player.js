import * as THREE from 'three';
import { CONFIG, PAP_LEVELS, falloffMult, papPulse, papStats } from './config.js';
import { buildWeaponModels, attachAccessories, rollAttachments } from './viewmodels.js';
import { FPHands } from './fpHands.js';
import { RideCam } from './rideCam.js';
import { flashMaterial } from './fx.js';
import { charStatsOf } from './characters.js';

const ADS_DELTA = 20; // réduction du FOV en visée
const PAP_INTENSITY = 0.35; // intensité du reflet des armes améliorées (couleur : PAP_LEVELS[niveau].color)
const MAX_SHOTS_PER_FRAME = 3; // plafond de tirs par image (armes automatiques très rapides ou image longue)
const FIRE_RESUME_GAP = 0.1; // au-delà de ce retard sur nextShot, le tir ne se « rattrape » pas : on repart de l'instant présent

export class Player {
  constructor(camera, scene, world, game) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.mouseDown = false;
    this.rc = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.perks = {};
    this.godMode = false;
    this.infiniteAmmo = false;
    this.superSpeed = false;
    this.statsVersion = 0; // incrémenté quand les atouts changent (invalide le cache des stats d'arme)
    this.lastMouse = -99;  // game.time du dernier mouvement de souris (recentrage de la vue du conducteur)
    this.ride = new RideCam(this); // vue à la troisième personne sur une moto
    this.mc = 0; // compteur de coups de couteau (p_state.mc) : les coéquipiers jouent l'animation à chaque incrément
    this.hasNvg = false;
    this.nvgOn = false;
    this.nvgK = 0;

    camera.rotation.order = 'YXZ';
    scene.add(camera);
    this.buildViewmodels();
    this.bindInput();

    // Lampe torche tactique
    this.flashlight = new THREE.SpotLight(CONFIG.graphics.torch.color, CONFIG.graphics.torch.intensity, CONFIG.graphics.torch.distance, CONFIG.graphics.torch.angle, CONFIG.graphics.torch.penumbra, CONFIG.graphics.torch.decay); // réglée par CONFIG.graphics.torch (intensité par zone : graphics.js)
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -1);
    camera.add(this.flashlight, this.flashlight.target);

    this.reset();
  }

  get driving() { const v = this.vehicle; return !!v && v.v.isDriver(v.seat); } // aux commandes d'une moto ou d'une rame : pas de tir, pas de rechargement
  get curW() { return this.inventory[this.weaponIdx]; }
  get curCfg() { return this.statsOf(this.curW); }
  charStats() { return charStatsOf(this.ch); }
  get maxHealth() {
    const base = this.charStats().maxHealth || CONFIG.player.maxHealth;
    return base + (this.perks.juggernog ? 150 : 0);
  }
  get maxWeapons() { return this.perks.mulekick ? 3 : 2; }

  // Statistiques effectives d'une arme : base + Pack-a-Punch (niveau w.pap, 0 à 3) + accessoires + personnage + atouts
  // overrideAtts (optionnel) : permet à l'atelier [T] de prévisualiser les stats avant achat/équipement sans muter l'arme.
  statsOf(w, overrideAtts = null) {
    const lv = w.pap | 0;
    const atts = Array.isArray(overrideAtts) ? overrideAtts : (Array.isArray(w.atts) ? w.atts : []);
    const useCache = overrideAtts == null;
    const cs = this.charStats();
    const key = `${lv}|${atts.join(',')}|${this.statsVersion}|${this.ch?.id || ''}`;
    if (useCache && w._statsKey === key) return w._stats;
    const base = CONFIG.weapons[w.id];
    const s = { ...base, ...papStats(base, lv) };
    // Accessoires d'arme : dégâts, tête, cadence, chargeur, réserve, rechargement, précision, recul, portée…
    let dmgM = 1, headM = 1, rateM = 1, magM = 1, resM = 1, relM = 1, sprM = 1, hipM = 1, recM = 1, rngM = 1, adsDelta = 0, silenced = false;
    const attLabels = [];
    const defs = CONFIG.attachments?.defs || {};
    for (const aId of atts) {
      const d = defs[aId];
      if (!d) continue;
      attLabels.push(d.short || d.name);
      if (d.damageMult) dmgM *= d.damageMult;
      if (d.headMult) headM *= d.headMult;
      if (d.fireRateMult) rateM *= d.fireRateMult;
      if (d.magMult) magM *= d.magMult;
      if (d.reserveMult) resM *= d.reserveMult;
      if (d.reloadMult) relM *= d.reloadMult;
      if (d.spreadMult) sprM *= d.spreadMult;
      if (d.hipSpreadMult) hipM *= d.hipSpreadMult;
      if (d.recoilMult) recM *= d.recoilMult;
      if (d.rangeMult) rngM *= d.rangeMult;
      if (d.adsFovDelta) adsDelta += d.adsFovDelta;
      if (d.silenced) silenced = true;
    }
    if (dmgM !== 1) {
      s.damage = Math.round(s.damage * dmgM);
      if (s.splash) s.splash = { ...s.splash, damage: Math.round(s.splash.damage * dmgM) };
      if (s.blast) s.blast = { ...s.blast, damage: Math.round(s.blast.damage * dmgM) };
    }
    if (headM !== 1) s.headMult = +((s.headMult || 1) * headM).toFixed(2);
    if (rateM !== 1) s.fireRate = +(s.fireRate * rateM).toFixed(2);
    if (magM !== 1) s.magSize = Math.max(1, Math.round(s.magSize * magM));
    if (resM !== 1) s.maxReserve = Math.max(s.magSize, Math.round(s.maxReserve * resM));
    if (relM !== 1) s.reloadTime = +(s.reloadTime * relM).toFixed(2);
    if (sprM !== 1) s.spread *= sprM;
    if (rngM !== 1) s.range = Math.round(s.range * rngM);
    s.attDamageMult = dmgM;
    s.hipSpreadMult = hipM;
    s.recoilMult = recM;
    s.adsZoomBonus = adsDelta; // zoom optique supplémentaire sans cacher le modèle 3D
    s.silenced = silenced || (lv >= 3 && (base.cat === 'pistol' || base.cat === 'smg' || base.cat === 'sniper'));
    s.attLabels = attLabels;

    // Bonus passifs du personnage sélectionné (CONFIG.characters)
    if (cs.dmgMult && cs.dmgMult !== 1) {
      s.damage = Math.round(s.damage * cs.dmgMult);
      if (s.splash) s.splash = { ...s.splash, damage: Math.round(s.splash.damage * cs.dmgMult) };
      if (s.blast) s.blast = { ...s.blast, damage: Math.round(s.blast.damage * cs.dmgMult) };
    }
    if (cs.headMult && cs.headMult !== 1) s.headMult = +((s.headMult || 1) * cs.headMult).toFixed(2);
    if (cs.fireRateMult && cs.fireRateMult !== 1) s.fireRate = +(s.fireRate * cs.fireRateMult).toFixed(2);
    if (cs.reloadMult && cs.reloadMult !== 1) s.reloadTime = +(s.reloadTime * cs.reloadMult).toFixed(2);
    if (cs.spreadMult && cs.spreadMult !== 1) s.spread *= cs.spreadMult;
    if (cs.reserveMult && cs.reserveMult !== 1) s.maxReserve = Math.max(s.magSize, Math.round(s.maxReserve * cs.reserveMult));

    if (this.perks.doubletap) { s.fireRate *= 1.33; s.damage *= 1.25; }
    if (this.perks.speedcola) s.reloadTime *= 0.5;
    const PF = CONFIG.perkFx;
    if (this.perks.deadshot) { s.headMult = (s.headMult || 1) * PF.deadshot.headMult; s.spread *= PF.deadshot.spreadMult; } // Œil-de-lynx
    if (this.perks.bandolier) s.maxReserve = Math.round(s.maxReserve * PF.bandolier.reserveMult); // Cartouchière
    if (useCache) {
      w._statsKey = key;
      w._stats = s;
    }
    return s;
  }

  reset() {
    this.pos.copy(this.world.startPos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0;
    this.perks = {};
    this.statsVersion++;
    this.health = this.maxHealth;
    this.downed = false;
    this.dead = false;
    this.statDowns = 0;
    this.bleedout = 0;
    this.selfRevive = 0;
    this.grenades = CONFIG.grenade.start + (this.charStats().extraGrenades || 0);
    this.hasNvg = false;
    this.nvgOn = false;
    this.nvgK = 0;
    this.game.hud?.setNvg?.(false, false);
    this.locked = false; // arme confisquée par le Pack-a-Punch
    this.region = 0; this.wasGrounded = true;
    this.airT = 0; this.peakY = 0; this.jumpSprint = false; this.flopCd = 0; // PHD Flopper (plongeon)
    this.vehicle = null; // { v, seat } quand on est sur une moto
    this.onTram = null;  // { v, u, w, y, fy } debout dans une rame (v0.40.0, voir tramInterior.js) : position en repère local de la rame
    this.meleeT = -1; this.meleeHit = true; this.nextMelee = 0; this.lunge = null; // couteau (voir melee)
    this.hasAxe = false; this.pullQ = null; this.gustQ = null; // Hache du Bourreau (récompense de la finale) ; attirance des Chaînes
    this.vault = null; this.vaultCd = 0; this.vaultReady = false; // enjambement (voir tryVault)
    this.crouching = false; this.crouchToggle = false; this.crouchK = 0; this._crouchDownAt = 0;
    this.ride?.reset();

    // Inventaire d'armes (pistolet de départ avec accessoires aléatoires)
    const pistols = CONFIG.startPistols;
    this.inventory = [this.newWeapon(pistols[Math.floor(Math.random() * pistols.length)], 'start')];
    this.weaponIdx = 0;
    this.switchWeapon(0);

    this.nextShot = 0;
    this.lastHurt = -99;
    this.kick = 0;
    this.aim = 0;
    this.bobT = 0;
    this.mouseDown = false;
    this.setTorch(true);
    this.camera.fov = this.game.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  newWeapon(id, source = 'wall', forcedAtts = null) {
    const cfg = CONFIG.weapons[id];
    const atts = Array.isArray(forcedAtts) ? forcedAtts.slice() : rollAttachments(id, source);
    const w = { id, ammo: cfg.magSize, reserve: cfg.startReserve, reloading: false, reloadT: 0, pap: 0, gl: 0, atts, ownedAtts: atts.slice() };
    const s = this.statsOf(w);
    w.ammo = s.magSize;
    w.reserve = Math.min(s.maxReserve, Math.round(cfg.startReserve * (s.maxReserve / Math.max(1, cfg.maxReserve))));
    return w;
  }

  // Met à jour les accessoires équipés sur une arme (utilisé par l'atelier [T])
  setWeaponAttachments(w, nextAtts, { newlyBought = false } = {}) {
    if (!w) return;
    const prevS = this.statsOf(w);
    w.atts = Array.isArray(nextAtts) ? nextAtts.slice() : [];
    if (!Array.isArray(w.ownedAtts)) w.ownedAtts = w.atts.slice();
    for (const a of w.atts) if (!w.ownedAtts.includes(a)) w.ownedAtts.push(a);
    w._statsKey = null;
    const nextS = this.statsOf(w);
    if (newlyBought && nextS.magSize > prevS.magSize) {
      // Bonus d'achat d'un chargeur plus grand : on complète le chargeur en cours
      w.ammo = nextS.magSize;
    } else {
      w.ammo = Math.min(w.ammo, nextS.magSize);
    }
    if (newlyBought && nextS.maxReserve > prevS.maxReserve) {
      w.reserve = Math.min(nextS.maxReserve, w.reserve + (nextS.maxReserve - prevS.maxReserve));
    } else {
      w.reserve = Math.min(w.reserve, nextS.maxReserve);
    }
    w.reloading = false;
    if (w === this.curW) this.switchWeapon(this.weaponIdx);
  }

  // Apparence des bras et mains en vue à la première personne (armes + couteau) + stats du personnage
  setCharacter(ch) {
    this.ch = ch;
    this.statsVersion++;
    if (!this.game?.started) this.health = this.maxHealth;
    this.fpHands?.setCharacter(ch);
    if (this.sleeveMat) this.sleeveMat.color.setHex(ch.fp.sleeve);
    for (const m of new Set(this.handMats || [])) m.color.setHex(ch.fp.hand);
  }

  // ---------------------------------------------------------------- Lunettes de vision nocturne
  grantNvg(activate = true) {
    this.hasNvg = true;
    if (activate) this.toggleNvg(true);
    else this.game.hud?.setNvg?.(true, this.nvgOn);
  }

  toggleNvg(force = null) {
    if (!this.hasNvg) {
      if (force === null) this.game.hud?.popup?.('ACHETEZ DES LUNETTES NVG', '');
      return false;
    }
    const next = force === null ? !this.nvgOn : !!force;
    if (next === this.nvgOn && force !== null) return next;
    this.nvgOn = next;
    this.game.sfx?.nvgToggle?.(next);
    this.game.hud?.setNvg?.(this.hasNvg, this.nvgOn, true);
    return next;
  }

  // ---------------------------------------------------------------- Atouts
  addPerk(id) {
    this.perks[id] = true;
    this.statsVersion++;
    if (id === 'juggernog') this.health = this.maxHealth;
  }

  clearPerks() {
    this.perks = {};
    this.statsVersion++;
    this.health = Math.min(this.health, this.maxHealth);
  }

  // ---------------------------------------------------------------- Inventaire
  hasWeapon(id) {
    return this.inventory.some((w) => w.id === id);
  }

  // Nouvelle arme : prend un emplacement libre, sinon remplace l'arme en main (pap: 0 à 3, source: 'start' | 'wall' | 'box')
  giveWeapon(id, pap = 0, source = 'wall', forcedAtts = null) {
    const cfg = CONFIG.weapons[id];
    if (!cfg) return null;
    let w;
    const existing = this.inventory.findIndex((x) => x.id === id);
    if (existing >= 0) {
      w = this.inventory[existing];
      if (Array.isArray(forcedAtts)) { w.atts = forcedAtts.slice(); w._statsKey = null; }
      this.switchWeapon(existing);
    } else {
      w = this.newWeapon(id, source, forcedAtts);
      if (this.inventory.length < this.maxWeapons) {
        this.inventory.push(w);
        this.switchWeapon(this.inventory.length - 1);
      } else {
        this.inventory[this.weaponIdx] = w;
        this.switchWeapon(this.weaponIdx);
      }
    }
    if (pap >= 0) {
      w.pap = Math.max(0, Math.min(3, pap | 0));
      w._statsKey = null;
      const s = this.statsOf(w);
      w.ammo = s.magSize;
      this.refill(w);
      this.switchWeapon(this.weaponIdx);
    }
    return w;
  }

  // Pack-a-Punch : améliore l'arme en main d'un niveau (0 -> I -> II -> III ; chargeur et réserve pleins)
  upgradeCurrent() {
    const w = this.curW;
    if ((w.pap | 0) >= PAP_LEVELS.length - 1) return false;
    w.pap = (w.pap | 0) + 1;
    const s = this.statsOf(w);
    w.ammo = s.magSize;
    this.refill(w);
    w.reloading = false;
    this.switchWeapon(this.weaponIdx);
    return true;
  }

  // Réserve pleine (borne, mur, munitions max, Pack-a-Punch)
  refill(w) {
    const s = this.statsOf(w);
    w.reserve = s.maxReserve;
    if (s.gl) w.gl = s.gl.shells; // obus du lance-grenades sous canon
  }

  switchWeapon(idx) {
    if (idx < 0 || idx >= this.inventory.length) return;
    if (this.curW) this.curW.reloading = false;
    this.weaponIdx = idx;
    const w = this.curW;
    if (this.fpHands) this.fpHands.shotT = 99;
    // bouche du canon (éclair de tir, départ des traçantes) selon la longueur de l'arme
    const mi = this.vmInfo && this.vmInfo[w.id];
    const extraZ = w.atts?.includes('suppressor') ? -0.16 : 0;
    this.muzzle.position.set(0, mi ? mi.muzzleY : 0.015, (mi ? mi.muzzle : -0.6) + extraZ);
    this.flash.position.set(0, mi ? mi.muzzleY : 0.015, (mi ? mi.muzzle : -0.6) + extraZ - 0.04);
    this.flashLight.position.set(0, 0.05, (mi ? mi.muzzle : -0.6) + extraZ - 0.1);
    for (const [id, grp] of Object.entries(this.vms)) {
      grp.visible = id === w.id;
      if (grp.visible) {
        attachAccessories(grp, w.id, w.pap | 0, grp, { local: true, atts: w.atts });
        const bl = []; grp.traverse((o) => { if (o.userData.bolt) bl.push(o); });
        if (bl.length) this.bolts[w.id] = bl;
        const L = PAP_LEVELS[w.pap | 0];
        this.tintMats = new Set();
        grp.traverse((o) => {
          if (o.isMesh && !o.userData.skin && !o.userData.glow) { o.material.emissive.setHex(L ? L.color : 0x000000); o.material.emissiveIntensity = L ? PAP_INTENSITY : 1; this.tintMats.add(o.material); }
        });
      }
    }
    const cfg = this.curCfg;
    this.game.hud.setWeapon(cfg.name, cfg.caliber, cfg.attLabels);
  }

  nextWeapon() {
    this.switchWeapon((this.weaponIdx + 1) % this.inventory.length);
  }
  prevWeapon() {
    this.switchWeapon((this.weaponIdx - 1 + this.inventory.length) % this.inventory.length);
  }

  // Bascule automatiquement sur une autre arme disposant encore de balles (chargeur non vide d'abord, sinon réserve)
  autoSwitchAmmoWeapon() {
    if (this.inventory.length <= 1 || this.locked || this.downed || this.dead) return false;
    let bestIdx = -1;
    for (let pass = 0; pass < 2 && bestIdx < 0; pass++) {
      for (let off = 1; off < this.inventory.length; off++) {
        const idx = (this.weaponIdx + off) % this.inventory.length;
        const iw = this.inventory[idx];
        if (pass === 0 ? iw.ammo > 0 : iw.reserve > 0) { bestIdx = idx; break; }
      }
    }
    if (bestIdx < 0) return false;
    this.switchWeapon(bestIdx);
    const nw = this.curW;
    if (nw && nw.ammo <= 0 && nw.reserve > 0) this.reload();
    return true;
  }

  // ---------------------------------------------------------------- Input
  bindInput() {
    // Liaisons (game.binds, voir keybinds.js) : par défaut, déplacements, sprint, saut et armes 1-3 sur la position physique de la touche
    // (e.code : ZQSD en AZERTY = WASD en QWERTY), actions sur la lettre réellement tapée (e.key) pour que R, E, F, G, M marchent sur tout clavier.
    const letter = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : '');
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.game.playing && !this.game.chat?.open && !this.game.ui?.paused) {
          this.game.scoreboard?.show();
        }
        return;
      }
      if (this.game.chat?.open) return; // saisie du chat : le jeu ne voit aucune touche (chat.js arrête déjà celles du champ)
      this.keys[e.code] = true;
      const k = letter(e);
      if (k) this.keys['letter:' + k] = true;
      if (!this.game.playing || e.repeat) return;
      if (this.game.debugMenu?.open || this.game.modMenu?.open) return; // menu debug / mods : les touches lui sont réservées
      const B = this.game.binds;
      if (B.is('reload', e) && !this.locked && !this.driving) this.reload();
      if (B.is('interact', e)) this.game.interact();
      if (B.is('torch', e)) this.setTorch(!this.torchOn);
      if (B.is('nvg', e)) this.toggleNvg();
      if (B.is('grenade', e)) this.throwGrenade();
      if (this.vehicle) { // voiture, moto, rame : bascule troisième / première personne, boîte auto/manuelle, rapports +/-, gong et portes
        if (B.is('vehicleView', e)) this.game.toggleVehicleView?.();
        else if (B.is('gearMode', e)) this.game.toggleGearboxMode?.();
        else if (B.is('gearUp', e)) this.game.vehicleShiftUp?.();
        else if (B.is('gearDown', e)) this.game.vehicleShiftDown?.();
        else if (B.is('tramGong', e)) this.game.tramGong?.();
        else if (B.is('tramDoors', e)) this.game.tramDoors?.();
        else if (B.is('tramSwitch', e)) this.game.tramSwitch?.();
      }
      else if (this.onTram?.v.isTram && B.is('tramGong', e)) this.game.tramGong?.(); // debout dans la rame : gong et portes aussi (pas dans le train : v0.80.0)
      else if (this.onTram?.v.isTram && B.is('tramDoors', e)) this.game.tramDoors?.();
      else if (B.is('knife', e)) this.melee(this.game.time); // à pied : couteau
      else if (B.is('deploy', e)) this.game.deployKey?.(); // barricade de fortune : acheter / poser (barricades.js)
      if (!this.vehicle && (B.matches('crouch', e) || e.code === 'ControlRight')) this._crouchDownAt = performance.now();
      if (B.isBound(e)) e.preventDefault(); // Espace (défilement), Tab, flèches : le navigateur ne doit pas réagir à une touche du jeu
      if (this.locked) return; // arme dans le Pack-a-Punch
      if (B.is('weapon1', e)) this.switchWeapon(0);
      if (B.is('weapon2', e)) this.switchWeapon(1);
      if (B.is('weapon3', e)) this.switchWeapon(2);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.game.scoreboard?.hide();
        return;
      }
      this.keys[e.code] = false;
      const k = letter(e);
      if (k) this.keys['letter:' + k] = false;
      const B = this.game.binds;
      if (!this.vehicle && (B?.matches('crouch', e) || e.code === 'ControlRight') && this._crouchDownAt > 0) {
        if (performance.now() - this._crouchDownAt < 220) this.crouchToggle = !this.crouchToggle;
        else this.crouchToggle = false;
        this._crouchDownAt = 0;
      }
    });
    window.addEventListener('wheel', (e) => {
      if (!this.game.playing || this.locked || this.game.chat?.open) return; // pendant la saisie, la molette fait défiler le chat
      if (e.deltaY > 0) this.nextWeapon();
      else if (e.deltaY < 0) this.prevWeapon();
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.game.playing || this.game.debugMenu?.open || this.game.modMenu?.open || this.game.chat?.open) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 1) { e.preventDefault(); this.fireGL(this.game.time); } // clic molette : lance-grenades sous canon (niveau III des fusils d'assaut)
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aiming = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.game.playing || this.game.chat?.open) return; // saisie : la souris est libérée, elle ne tourne plus la caméra
      const zoom = this.aim > 0.5 ? (this.curCfg.adsFov ? 0.3 : this.curCfg.adsZoomBonus <= -12 ? 0.42 : this.curCfg.zoom ? 0.45 : 0.6) : 1;
      const sens = 0.0022 * this.game.settings.sens * zoom;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.lastMouse = this.game.time;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    });
    this.aiming = false;
  }

  // Allumer / éteindre la torche en changeant l'intensité : changer le nombre de lumières visibles
  // obligerait three.js à recompiler tous les shaders (gros ralentissement).
  setTorch(on) {
    this.torchOn = on;
    this.flashlight.intensity = on ? CONFIG.graphics.torch.intensity : 0;
  }

  releaseInputs() {
    this.keys = {};
    this.mouseDown = false;
    this.aiming = false;
  }

  // ------------------------------------------------------------ Viewmodels
  buildViewmodels() {
    this.vm = new THREE.Group();
    this.vms = {};

    // Toutes les armes : modèles détaillés (viewmodels.js)
    const built = buildWeaponModels(this.vm);
    Object.assign(this.vms, built.vms);
    this.vmInfo = built.info;
    this.vmHands = built.hands;
    // pièces cachées quand le chargeur est vide (carreau de l'arbalète)
    this.bolts = {};
    for (const [id, grp] of Object.entries(built.vms)) {
      const list = [];
      grp.traverse((o) => { if (o.userData.bolt) list.push(o); });
      if (list.length) this.bolts[id] = list;
    }
    // Bras et mains articulés adaptés à chaque personnage (fpHands.js) + matériaux du couteau
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x4a5530, roughness: 0.9 });
    this.handMats = [];
    this.fpHands = new FPHands(this.vm);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.015, -0.6);
    this.vm.add(this.muzzle);

    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMaterial()); // éclair étoilé (fx.js)
    this.flash.position.set(0, 0.015, -0.64);
    this.flash.visible = false;
    this.vm.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffaa44, 0, 8, 2);
    this.flashLight.position.set(0, 0.05, -0.7);
    this.vm.add(this.flashLight);
    this.flashT = 0;

    this.vm.scale.setScalar(0.85);
    this.camera.add(this.vm);
    this.buildKnife();
  }

  // --------------------------------------------------------------- Update
  update(dt, now) {
    const P = CONFIG.player, K = this.keys;
    const w = this.curW;
    const cfg = this.curCfg;

    // État à terre (co-op) ; en solo avec Réanimation rapide, on se relève seul
    if (this.downed) {
      if (this.selfRevive > 0) {
        this.selfRevive -= dt;
        if (this.selfRevive <= 0) this.revive();
      } else {
        this.bleedout = Math.max(0, this.bleedout - dt);
        if (this.bleedout <= 0 && !this.dead) {
          this.dead = true;
          this.game.checkTeamWipe?.();
        }
      }
    }

    // ---- déplacement ----
    const veh = this.vehicle; // { v, seat } quand on est sur une moto
    let moving = false, sprinting = false, onGround = true;
    if (veh) {
      // sur une moto : le joueur suit la selle (la moto est simulée par Vehicle) et sa vue tourne avec elle
      this.crouching = false; this.crouchToggle = false;
      veh.v.hipWorld(veh.seat, this._v);
      this.pos.set(this._v.x, veh.v.pos.y, this._v.z);
      this.vel.set(0, 0, 0);
      this.vy = 0; this.wasGrounded = true; this.region = 0; this.airT = 0; this.jumpSprint = false; // en moto : pas de plongeon
      this.yaw += veh.v.seatDyaw(veh.seat);
      this.ride.steer(dt, veh, this.game.time - this.lastMouse); // vue externe : tangage borné, recentrage derrière la moto
    } else {
      const B = this.game.binds;
      let mx = (B.down('right', K) ? 1 : 0) - (B.down('left', K) ? 1 : 0);
      let mz = (B.down('forward', K) ? 1 : 0) - (B.down('back', K) ? 1 : 0);
      if (this.vault || this.game.camLock) { mx = 0; mz = 0; } // enjambement en cours : le chemin est imposé ; vue orbitale de l'Aube : immobile
      moving = (mx !== 0 || mz !== 0) && !this.dead;
      const crouchHeld = B.down('crouch', K) || !!K.ControlRight;
      if (this.downed || this.dead || this.vault || (B.down('sprint', K) && mz > 0 && !crouchHeld) || B.down('jump', K)) this.crouchToggle = false;
      this.crouching = (crouchHeld || this.crouchToggle) && !this.downed && !this.dead && !this.vault && !this.game.camLock;
      sprinting = !this.downed && !this.crouching && B.down('sprint', K) && mz > 0 && !this.aiming;
      const cs = this.charStats();
      const stamin = this.perks.staminup ? 1.3 : 1;
      let speed = this.downed ? 1.2 : this.crouching ? (P.crouchSpeed || 2.8) * (this.perks.staminup ? 1.15 : 1) : (sprinting ? P.sprintSpeed * stamin : P.walkSpeed * (this.perks.staminup ? 1.1 : 1));
      if (!this.downed && cs.speedMult && cs.speedMult !== 1) speed *= cs.speedMult;
      if (this.superSpeed) speed *= 2.2;
      if (this.aiming && !this.downed) speed *= 0.6;
      if (moving) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = (cos * mx - sin * mz) * speed;
      const wz = (-sin * mx - cos * mz) * speed;
      const k = Math.min(1, dt * 12);
      this.vel.x += (wx - this.vel.x) * k;
      this.vel.z += (wz - this.vel.z) * k;
      if (this.onTram) { // debout dans une rame : déplacement, collisions et position monde viennent du repère local de la rame
        this.game.tramWalkStep(this, dt);
        this.region = this.onTram?.v.walkRegion || 0; this.wasGrounded = true; // (le train de la gare : la région de la gare, ses zombies nous voient) this.airT = 0; this.jumpSprint = false; this.vy = 0;
      } else {
        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
        if (this.gustQ) { // rafale de la rampe de la flèche (Acte V) : vitesse imposée pendant gustQ.t s (la collision, donc les garde-corps, la borne)
          const q = this.gustQ;
          this.pos.x += q.x * Math.min(dt, q.t); this.pos.z += q.z * Math.min(dt, q.t); q.t -= dt;
          if (q.t <= 0) this.gustQ = null;
        }
        if (this.pullQ) { // attiré par les Chaînes du Bourreau : déplacement imposé sur pullQ.T s (la collision le borne)
          const q = this.pullQ, k = Math.min(dt, q.t) / q.T;
          this.pos.x += q.x * k; this.pos.z += q.z * k; q.t -= dt;
          if (q.t <= 0) this.pullQ = null;
        }

        // ---- saut / gravité (sol = niveau 0, ou balcon / escalier / plateforme sous les pieds) ----
        const fl = this._fl || (this._fl = { y: 0, region: 0 });
        if (this.world.floorAt) this.world.floorAt(this.pos.x, this.pos.z, this.pos.y, fl); else { fl.y = 0; fl.region = 0; }
        const ground = fl.y;
        onGround = this.pos.y <= ground + 0.02 && this.vy <= 0.5;
        this.vaultCd = Math.max(0, this.vaultCd - dt);
        this.vaultReady = onGround && !this.vault && !this.downed && !this.dead && !this.locked && this.vaultCd <= 0 && !!this.checkVault();
        if (B.down('jump', K) && onGround && !this.downed && !this.vault && !this.game.camLock) {
          if (this.vaultReady && this.startVault()) { /* enjambement : pas de saut */ }
          else { this.vy = P.jumpSpeed; this.jumpSprint = sprinting; } // saut lancé en sprint : plongeon possible (PHD Flopper)
        }
        this.vy -= P.gravity * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; }
        else if (this.wasGrounded && this.vy <= 0 && this.pos.y - ground < 0.45) { this.pos.y = ground; this.vy = 0; } // on colle à la pente en descendant
        this.wasGrounded = this.pos.y <= ground + 0.02;
        this.region = fl.region;

        // ---- PHD Flopper : temps en l'air, hauteur de chute ; à l'atterrissage, onde explosive (voir onLand)
        if (!this.wasGrounded) { this.airT += dt; this.peakY = Math.max(this.peakY, this.pos.y); }
        else {
          if (this.airT > 0) this.onLand(this.airT, this.peakY - ground);
          this.airT = 0; this.peakY = ground; this.jumpSprint = false;
        }

        if (this.vault) this.stepVault(dt); // chemin imposé : pas de collision (on passe par-dessus l'obstacle)
        else this.world.collide(this.pos, P.radius);
      }
    }

    this.flopCd = Math.max(0, this.flopCd - dt);

    // ---- régénération ----
    const rcs = this.charStats();
    const rDelay = Math.max(1.5, P.regenDelay + (rcs.regenDelayDelta || 0));
    const rRate = P.regenRate * (rcs.regenRateMult || 1);
    if (!this.downed && this.health < this.maxHealth && now - this.lastHurt > rDelay) {
      this.health = Math.min(this.maxHealth, this.health + rRate * dt);
    }
    if (this.godMode) {
      this.health = this.maxHealth;
    }
    if (this.infiniteAmmo && w) {
      w.reserve = cfg.maxReserve;
      if (w.gl) w.gl = cfg.gl?.shells || 0;
    }

    // ---- visée (ADS) & vision nocturne ----
    this.nvgK += ((this.nvgOn ? 1 : 0) - this.nvgK) * Math.min(1, dt * 10);
    this.aim += ((this.aiming && !this.downed ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    const base = this.game.settings.fov;
    const adsDelta = cfg.adsFov || cfg.zoom ? base - (cfg.adsFov || cfg.zoom) : ADS_DELTA - (cfg.adsZoomBonus || 0);
    const fov = base - adsDelta * this.aim + (veh ? Math.min(12, Math.abs(veh.v.speed) * 0.55) * (1 - 0.5 * this.ride.k) : 0);
    if (!this.game.camLock && Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // lunette : on cache l'arme quand on vise au fusil de précision
    // (on cache le modèle de l'arme, pas le groupe entier qui contient la lumière de tir)
    // (jamais le groupe entier : il porte la lumière de tir, et masquer une lumière recompile tous les shaders)
    const showVm = !this.locked && !(cfg.adsFov && this.aim > 0.8) && !this.driving && !this.ride.external;
    this.vms[w.id].visible = showVm; // vue externe : c'est le personnage qui tient l'arme
    const pk = papPulse(w.pap | 0, now); // niveau III : le reflet pulse
    if (pk !== 1 && this.tintMats) for (const m of this.tintMats) m.emissiveIntensity = PAP_INTENSITY * pk;
    const bolts = this.bolts[w.id];
    if (bolts) { const show = w.ammo > 0 && (!w.reloading || w.reloadT > cfg.reloadTime * 0.6); for (const b of bolts) b.visible = show; } // le carreau n'est là que si l'arme est chargée

    // ---- tir & rechargement ----
    if (this.downed || this.dead) {
      // Aucun tir quand le joueur est à terre
    } else if (w.reloading) {
      w.reloadT += dt;
      if (w.reloadT >= cfg.reloadTime) {
        const take = Math.min(cfg.magSize - w.ammo, w.reserve);
        w.ammo += take;
        w.reserve -= take;
        w.reloading = false;
      }
    } else if (!this.locked && !this.vault && !this.driving) {
      // Jusqu'à MAX_SHOTS_PER_FRAME tirs par image : le temps restant d'un tir est reporté au suivant (voir shoot),
      // donc la cadence réelle égale fireRate même quand une image dure plus qu'une période de tir.
      for (let n = 0; n < MAX_SHOTS_PER_FRAME && this.mouseDown && now >= this.nextShot; n++) {
        if (w.ammo > 0) {
          this.shoot(now, moving);
          if (!this.infiniteAmmo && w.ammo <= 0 && w.reserve <= 0 && !w.gl && this.autoSwitchAmmoWeapon()) {
            this.nextShot = Math.max(this.nextShot, now + 0.16);
            if (cfg.type === 'semi') this.mouseDown = false;
            break;
          }
          if (cfg.autoReload && w.ammo <= 0) this.reload();
        } // chargeur d'une cartouche : recharge seule
        else if (w.reserve > 0) { this.reload(); break; }
        else if (!w.gl && this.autoSwitchAmmoWeapon()) { this.nextShot = Math.max(this.nextShot, now + 0.16); break; }
        else { // chargeur et réserve vides : coup de couteau à la place du clic à vide (maintenu : un coup toutes les cooldown s)
          this.nextShot = now + 0.1;
          if (this.meleeT < 0 && now >= this.nextMelee && !this.melee(now)) { this.nextShot = now + 0.3; this.game.sfx.empty(); }
          break;
        }
        if (cfg.type === 'semi') { this.mouseDown = false; break; } // une balle par clic
      }
    }

    // ---- couteau : fente, instant de la touche, animation ----
    this.updateMelee(dt, now);

    // ---- caméra ----
    this.recoil *= Math.max(0, 1 - dt * 8);
    this.crouchK = (this.crouchK || 0) + ((this.crouching ? 1 : 0) - (this.crouchK || 0)) * Math.min(1, dt * 12);
    this.bobT += dt * (sprinting ? 12 : this.crouching ? 5.6 : 8) * (moving && onGround ? 1 : 0);
    if (moving && onGround) { const n = Math.floor(this.bobT / Math.PI); if (n !== this._stepN) { this._stepN = n; this.footstep(sprinting); } } // one footfall per half bob cycle
    const bob = moving && onGround ? Math.sin(this.bobT) * (sprinting ? 0.06 : this.crouching ? 0.018 : 0.035) : 0;
    const standEye = P.eye - (P.eye - (P.crouchEye || 1.02)) * this.crouchK;
    const eyeH = (this.downed ? 0.55 : standEye) + (this.vault ? CONFIG.vault.camLift * Math.sin(Math.PI * Math.min(1, this.vault.t / this.vault.dur)) : 0);
    this.eyeH = eyeH;
    let sh = this.game.shake || 0;
    let ex = this.pos.x, ey = this.pos.y + eyeH + bob, ez = this.pos.z;
    const sway = !veh && this.onTram ? this.onTram.v.sway : null; // standing in the moving train (train.js, v0.81.0) : roll and bob, local look
    if (sway) ey += sway.bob;
    if (veh) {
      veh.v.eyeWorld(veh.seat, this._v);
      ex = this._v.x; ey = this._v.y; ez = this._v.z;
      sh += Math.min(1, Math.abs(veh.v.speed) / veh.v.def.maxSpeed) * 0.05; // vibration du moteur
    }
    // vue externe (troisième personne sur une moto, ou sortie de moto en cours) : RideCam pose la caméra ; sinon vue à la première personne
    if (!this.ride.update(dt, veh, { x: this.pos.x, y: this.pos.y + eyeH, z: this.pos.z }, sh)) {
      this.camera.position.set(ex + (sh ? (Math.random() - 0.5) * sh * 0.25 : 0), ey + (sh ? (Math.random() - 0.5) * sh * 0.25 : 0), ez + (sh ? (Math.random() - 0.5) * sh * 0.25 : 0));
      this.camera.rotation.set(this.pitch + this.recoil, this.yaw, veh ? veh.v.lean * 0.5 : sway ? sway.roll : 0);
    }

    // ---- animation de l'arme et des mains articulées (adaptées au personnage) ----
    this.kick *= Math.max(0, 1 - dt * 14);
    const a = this.aim;
    const wGrp = this.vms[w.id];
    const hAnim = this.fpHands ? this.fpHands.update(dt, {
      weaponGrp: wGrp,
      handDef: this.vmHands?.[w.id],
      activeAcc: wGrp?.userData.activeAcc || w.atts || [],
      reloading: !!w.reloading,
      reloadFrac: w.reloading ? w.reloadT / Math.max(0.1, cfg.reloadTime) : 0,
      aiming: a,
      sprinting,
      visible: showVm,
    }) : { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 };

    let x = 0.22 * (1 - a) + hAnim.dx;
    let y = -0.22 + 0.06 * a - 0.018 * this.crouchK * (1 - a) + hAnim.dy;
    let z = -0.45 + 0.05 * a + 0.012 * this.crouchK * (1 - a) + hAnim.dz;
    const recM = cfg.recoilMult ?? 1;
    let rx = this.kick * recM * (cfg.type === 'launcher' ? 0.45 : cfg.type === 'shotgun' || cfg.type === 'semi' ? 0.2 : 0.11) + hAnim.rx;
    let ry = (sprinting ? 0.35 : 0) + hAnim.ry;
    let rz = hAnim.rz;
    if (sprinting) { rx += 0.22; x -= 0.05; y -= 0.05; }
    this.vm.position.set(x + (moving ? Math.sin(this.bobT * 0.5) * 0.008 : 0), y + (moving ? Math.abs(Math.cos(this.bobT * 0.5)) * 0.006 : 0), z + this.kick * 0.065 * recM);
    this.vm.rotation.set(rx, ry, rz);
    if (this.vault) { const lo = Math.sin(Math.PI * Math.min(1, this.vault.t / this.vault.dur)); this.vm.position.y -= 0.16 * lo; this.vm.rotation.x += 0.5 * lo; } // arme baissée
    this.animateKnife(dt);

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }
  }

  // ------------------------------------------------------------- Enjambement (Espace devant un obstacle de moins de 1,15 m)
  // Obstacle enjambable (Collision.findVault) à moins de reach m, de face (moins de maxAngle degrés), profondeur <= maxDepth ; case d'arrivée
  // libre, à la même hauteur (+- heightTol), dans une zone OUVERTE (jamais de contournement d'une porte payante). Renvoie { lx, lz } ou null.
  checkVault() {
    const V = CONFIG.vault, w = this.world, col = w.collision;
    if (!col || !col.findVault) return null;
    const ux = -Math.sin(this.yaw), uz = -Math.cos(this.yaw);
    const h = col.findVault(this.pos.x, this.pos.z, ux, uz, V.reach, this._vh || (this._vh = {}));
    if (!h) return null;
    if (-(ux * h.nx + uz * h.nz) < Math.cos((V.maxAngle * Math.PI) / 180)) return null;
    if (h.tOut - h.tIn > V.maxDepth) return null;
    const oy = this.pos.y + 0.5;
    if (w.rayHit && w.rayHit(this.pos.x, oy, this.pos.z, ux, 0, uz, h.tIn - 0.03) < h.tIn - 0.12) return null; // autre chose avant l'obstacle
    const lx = this.pos.x + ux * (h.tOut + V.clearance), lz = this.pos.z + uz * (h.tOut + V.clearance);
    if (w.rayHit && w.rayHit(this.pos.x + ux * (h.tOut + 0.03), oy, this.pos.z + uz * (h.tOut + 0.03), ux, 0, uz, V.clearance + 0.02) < V.clearance - 0.02) return null; // mur juste derrière
    const q = this._vq || (this._vq = { x: 0, y: 0, z: 0 });
    q.x = lx; q.y = this.pos.y; q.z = lz;
    w.collide(q, CONFIG.player.radius);
    if (Math.hypot(q.x - lx, q.z - lz) > 0.05) return null;               // la case d'arrivée est encombrée
    if (w.nav?.outside?.(lx, lz)) return null;                              // eau, hors île
    const fl = this._vfl || (this._vfl = { y: 0, region: 0 });
    if (w.floorAt) { w.floorAt(lx, lz, this.pos.y + 0.1, fl); if (fl.region !== (this.region || 0) || Math.abs(fl.y - this.pos.y) > V.heightTol) return null; }
    if (w.zoneOf && w.isZoneOpen) { const zi = w.zoneOf(lx, lz); if (zi < 0 || !w.isZoneOpen(zi)) return null; } // zone fermée : refusé
    return { lx, lz, h };
  }

  startVault() {
    const V = CONFIG.vault, t = this.checkVault();
    if (!t) return false;
    this.vault = { t: 0, dur: V.time, x0: this.pos.x, z0: this.pos.z, x1: t.lx, z1: t.lz, y: this.pos.y };
    this.vel.set(0, 0, 0); this.vy = 0; this.jumpSprint = false; this.aiming = false; this.mouseDown = false;
    this.game.sfx.vault?.();
    return true;
  }

  stepVault(dt) {
    const v = this.vault;
    v.t += dt;
    const u = Math.min(1, v.t / v.dur), e = u * u * (3 - 2 * u);
    this.pos.x = v.x0 + (v.x1 - v.x0) * e; this.pos.z = v.z0 + (v.z1 - v.z0) * e; this.pos.y = v.y;
    this.vel.set(0, 0, 0); this.vy = 0; this.airT = 0; this.wasGrounded = true;
    if (u >= 1) { this.vault = null; this.vaultCd = CONFIG.vault.cooldown; this.world.collide(this.pos, CONFIG.player.radius); }
  }

  // Chaînes du Bourreau : le joueur est tiré de (dx, dz) m en 0,3 s
  // rafale (Acte V) : pousse de (vx, vz) m/s pendant dur s
  gustBy(vx, vz, dur) { this.gustQ = { x: vx, z: vz, t: dur }; }
  pullBy(dx, dz) { this.pullQ = { x: dx, z: dz, t: 0.3, T: 0.3 }; this.vel.x *= 0.3; this.vel.z *= 0.3; }

  // Hache du Bourreau (récompense de la finale) : remplace la lame du couteau dans la vue (manche long, large fer) ; le bras reste le même
  buildAxe() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.3, emissive: 0x2c3036 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 });
    const g = new THREE.Group();
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    box(0.03, 0.03, 0.5, 0, 0, -0.08, wood);                // manche
    box(0.036, 0.036, 0.02, 0, 0, 0.17, dark);              // talon
    box(0.05, 0.05, 0.1, 0, 0, -0.26, dark);                // douille du fer
    box(0.27, 0.026, 0.22, -0.135, 0, -0.29, steel);         // fer : plaque à plat (vue de dessus), vers la gauche
    box(0.03, 0.03, 0.27, -0.275, 0, -0.29, steel);         // tranchant
    box(0.12, 0.024, 0.08, 0.06, 0, -0.29, steel);          // contre-fer (le dos de la tête)
    g.rotation.x = 0.05;
    this.knifeBlade.add(g);
    for (const o of this.knifePieces) o.visible = false; // la lame du couteau disparaît ; la main et la manche restent
    this.axeVm = g;
  }

  // ------------------------------------------------------------- Couteau
  // Modèle (vue à la première personne) : lame argentée de 0,2 m avec pointe (cône à 4 faces), garde, manche noir, bras droit séparé
  // (manche + main) ; visible seulement pendant le coup, pendant lequel l'arme tenue plonge de CONFIG.knife.dip m.
  buildKnife() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.4, metalness: 0.3, emissive: 0x2c3036 }); // pas de carte d'environnement : un métal pur resterait noir ou éblouirait
    const dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 });
    const box = (w, h, d, x, y, z, m, par = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); par.add(o); return o; };
    const blade = new THREE.Group(); g.add(blade);
    box(0.034, 0.012, 0.15, 0, 0, -0.075, steel, blade);                                   // lame
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0245, 0.05, 4), steel);            // pointe
    tip.rotation.x = -Math.PI / 2; tip.rotation.z = Math.PI / 4; tip.scale.set(1, 1, 0.5); tip.position.set(0, 0, -0.175); blade.add(tip);
    box(0.07, 0.016, 0.014, 0, 0, 0.005, dark, blade);                                     // garde
    box(0.022, 0.026, 0.1, 0, 0, 0.062, dark, blade);                                      // manche
    for (const z of [0.035, 0.06, 0.085]) box(0.025, 0.029, 0.006, 0, 0, z, steel, blade); // viroles
    this.knifePieces = blade.children.slice();                                             // (la lame et sa garde : remplacées par la hache, voir buildAxe)
    // bras droit séparé : main refermée sur le manche, avant-bras en manche (même tissu que les armes)
    const hand = box(0.085, 0.085, 0.1, 0, -0.005, 0.08, new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.8 }), blade);
    hand.userData.skin = true; this.handMats.push(hand.material);
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.32), this.sleeveMat); sl.position.set(0.03, -0.07, 0.2); sl.rotation.x = 0.5; blade.add(sl); // l'avant-bras descend vers le bas de l'écran
    g.visible = false;
    this.knifeVm = g; this.knifeBlade = blade;
    this.camera.add(g);
  }

  // Lance un coup de couteau (touche V, ou clic gauche chargeur ET réserve vides). Renvoie false si impossible (recharge du coup, à terre…).
  melee(now) {
    const K = CONFIG.knife;
    if (this.downed || this.dead || this.vehicle || this.locked || this.vault || this.meleeT >= 0 || now < this.nextMelee || !this.game.started) return false;
    this.nextMelee = now + K.cooldown;
    this.meleeT = 0; this.meleeHit = false;
    this.mc = (this.mc + 1) & 255;
    this.game.sfx.knife?.('swing');
    // fente : on avance de lunge m vers un zombie proche, si on avance (touche haut)
    this.lunge = null;
    if (this.game.binds.down('forward', this.keys)) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      let best = null, bd = K.lungeNear;
      for (const z of this.game.zombies) {
        if (!z.targetable || z.isBoss) continue;
        const dx = z.pos.x - this.pos.x, dz = z.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.6) { bd = d; best = z; }
      }
      if (best && !this.onTram) this.lunge = { left: Math.min(K.lunge, Math.max(0, bd - 0.9)), fx, fz }; // (pas de fente dans une rame : la position vient du repère local)
    }
    return true;
  }

  updateMelee(dt, now) {
    const K = CONFIG.knife;
    if (this.meleeT < 0) return;
    if (this.downed || this.dead || this.vehicle) { this.meleeT = -1; this.lunge = null; return; }
    this.meleeT += dt;
    if (this.lunge && this.lunge.left > 0) {
      const step = Math.min(this.lunge.left, (K.lunge / K.lungeTime) * dt);
      this.lunge.left -= step;
      this.pos.x += this.lunge.fx * step; this.pos.z += this.lunge.fz * step;
      this.world.collide(this.pos, CONFIG.player.radius);
    }
    if (!this.meleeHit && this.meleeT >= K.hitDelay) { this.meleeHit = true; this.meleeStrike(); }
    if (this.meleeT >= K.anim) this.meleeT = -1;
  }

  // Résolution du coup : rayon central contre les maillages (tête ou corps), sinon le zombie le plus proche dans le cône
  meleeStrike() {
    const K = CONFIG.knife, g = this.game, cam = this.camera;
    cam.updateMatrixWorld(true);
    this.rc.setFromCamera({ x: 0, y: 0 }, cam);
    const ro = this.rc.ray.origin.clone(), rd = this.rc.ray.direction.clone();
    const wallT = this.world.rayHit ? this.world.rayHit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, K.range + 0.5, true) : K.range + 0.5;
    let target = null, head = false, point = null;
    this.rc.far = K.range + 0.4;
    const hits = this.rc.intersectObjects(g.zombieTargets(), false);
    for (const h of hits) {
      if (h.distance > wallT) break;
      const z = h.object.userData.zombie;
      if (!z) continue;
      target = z; head = !!h.object.userData.head; point = h.point; break;
    }
    if (!target) { // cône horizontal de K.cone degrés de part et d'autre de la visée
      const cx = rd.x, cz = rd.z, cl = Math.hypot(cx, cz) || 1, cosMax = Math.cos((K.cone * Math.PI) / 180);
      let bd = Infinity;
      for (const z of g.zombies) {
        if (!z.targetable) continue;
        const dx = z.pos.x - this.pos.x, dz = z.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d > K.range + 0.4 || d >= bd || Math.abs(z.pos.y - this.pos.y) > 1.6) continue;
        if ((dx * cx + dz * cz) / (d * cl || 1) < cosMax) continue;
        if (this.world.rayHit && d > 0.5 && this.world.rayHit(ro.x, ro.y, ro.z, dx / d, (z.pos.y + 1.1 - ro.y) / d, dz / d, d, true) < d - 0.4) continue; // un mur les sépare
        bd = d; target = z; point = new THREE.Vector3(z.pos.x, z.pos.y + 1.1, z.pos.z);
      }
    }
    if (!target) return; // dans le vide : seul le souffle
    const dx = this.pos.x - target.pos.x, dz = this.pos.z - target.pos.z, dl = Math.hypot(dx, dz) || 1;
    const back = (dx * Math.sin(target.yaw) + dz * Math.cos(target.yaw)) / dl < K.backCos; // on est dans son dos (cap du zombie : (sin, cos))
    g.sfx.knife?.(target.kind === 'armored' || target.isBoss ? 'metal' : 'flesh');
    const bossHit = target.isBoss && !target.mini ? { back: target.isBack(this.pos.x, this.pos.z), ax: this.pos.x, az: this.pos.z } : null; // le Bourreau : dos décidé par la position de l'attaquant
    g.hitZombie(target, head, point, g.meleeDamage(target, head, back), 1, null, true, bossHit);
    g.perkFx?.onKnife(target); // Veuve noire : couteau collant
    if (this.hasAxe) { // Hache du Bourreau : touche aussi le zombie le plus proche de la cible (à moins de K.axe.splash m)
      const A = K.axe;
      let extra = 0;
      for (const z of g.zombies) {
        if (extra >= A.extra) break;
        if (z === target || !z.targetable || z.isBoss || Math.abs(z.pos.y - target.pos.y) > 1.6) continue;
        if (Math.hypot(z.pos.x - target.pos.x, z.pos.z - target.pos.z) > A.splash || Math.hypot(z.pos.x - this.pos.x, z.pos.z - this.pos.z) > K.range + A.splash + 0.4) continue;
        extra++;
        g.hitZombie(z, false, new THREE.Vector3(z.pos.x, z.pos.y + 1.1, z.pos.z), g.meleeDamage(z, false, false), 1, null, true);
      }
    }
  }

  // Animation du couteau (tout est dans le repère de la caméra) : l'arme tenue plonge, la lame part de la droite vers le centre à la touche
  // (hitDelay), puis revient ; un léger arc de haut en bas
  animateKnife(dt) {
    const K = CONFIG.knife, g = this.knifeVm;
    if (!g) return;
    if (this.hasAxe && !this.axeVm) this.buildAxe();
    if (this.axeVm) { this.axeVm.visible = this.hasAxe; for (const o of this.knifePieces) o.visible = !this.hasAxe; }
    const on = this.meleeT >= 0 && !this.downed && !this.dead;
    g.visible = on;
    if (!on) return;
    const t = this.meleeT, hit = K.hitDelay;
    const sm = (x) => x * x * (3 - 2 * x);
    const s = t < hit ? sm(t / hit) : 1 - sm(Math.min(1, (t - hit) / (K.anim - hit)));
    const dip = Math.sin(Math.min(1, t / K.anim) * Math.PI);
    this.vm.position.y -= Math.min(1, dip * 1.6) * K.dip;      // l'arme plonge
    g.position.set(0.26 - s * 0.2, -0.3 + s * 0.08, -0.22 - s * 0.32);
    g.rotation.set(-0.15 - s * 0.35, 0.5 - s * 0.55, 0.1);
  }

  // ------------------------------------------------------------- Tir
  shoot(now, moving) {
    const cfg = this.curCfg;
    const w = this.curW;
    if (!this.infiniteAmmo) w.ammo--;
    // Semi-auto : fireRate est un plafond (une balle par clic). Sinon on cumule à partir du tir prévu et non de `now`, pour
    // ne pas arrondir la période à l'image supérieure ; après une pause, on repart de `now` (pas de rafale de rattrapage).
    const period = 1 / cfg.fireRate;
    this.nextShot = cfg.type === 'semi' || now - this.nextShot > FIRE_RESUME_GAP ? now + period : this.nextShot + period;
    this.kick = 1;
    this.fpHands?.onFire();

    // Recul (modulé par les accessoires : poignée, compensateur, frein de bouche, silencieux)
    const heavy = cfg.type === 'shotgun' || cfg.type === 'semi' || cfg.type === 'launcher';
    const recM = cfg.recoilMult ?? 1;
    this.recoil += ((cfg.type === 'launcher' ? 0.05 : heavy ? 0.016 : 0.005) + Math.random() * 0.004) * recM;
    this.yaw += (Math.random() - 0.5) * 0.002 * recM;

    // Sons (silencieux si monté)
    const sil = !!cfg.silenced;
    this.game.weaponSound(cfg.id, 1, 0, sil);

    // Muzzle flash (très discret avec un silencieux ; l'arbalète n'en a pas)
    const ext = this.ride.external;
    if (ext && cfg.flash !== false) this.ride.fire();
    else if (cfg.flash !== false) {
      this.flash.visible = true;
      this.flash.material.color.setHex(cfg.id === 'raygun' ? 0x66ff88 : cfg.pap ? PAP_LEVELS[cfg.pap].flash : sil ? 0x99b8cc : 0xffcc66);
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.scale.setScalar(sil ? 0.28 : heavy ? 1.4 : 0.8 + Math.random() * 0.5);
      this.flashLight.intensity = sil ? 3 : heavy ? 40 : 25;
      this.flashT = sil ? 0.025 : 0.045;
    }

    // Raycast(s)
    this.camera.updateMatrixWorld(true);
    const hipM = this.aiming ? 1 : (cfg.hipSpreadMult ?? 1);
    const mul = (this.aiming ? (cfg.adsFov ? 0.05 : 0.4) : 1) * hipM * (moving ? 1.8 : 1) * (this.crouching ? 0.7 : 1);
    if (cfg.type === 'launcher') { this.fireLauncher(cfg, mul); return; }
    // origine visuelle des traçantes : la bouche de l'arme (de la vue, ou du personnage en vue externe)
    const origin = this.shotOrigin(ext);
    const pellets = cfg.pellets || 1;

    for (let p = 0; p < pellets; p++) {
      const sx = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      const sy = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      this.rc.setFromCamera({ x: sx, y: sy }, this.camera);
      if (ext) this.rc.ray.origin.addScaledVector(this.rc.ray.direction, this.ride.dist); // vue externe : le rayon part du pilote (bras avancé)
      this.rc.far = cfg.range;
      // Grande carte : les murs sont testés par la grille de collision (rapide), seuls les zombies par maillage.
      const fast = !!this.world.rayHit;
      const hits = this.rc.intersectObjects(fast ? this.game.zombieTargets() : this.game.hitTargets(), false);
      const ro = this.rc.ray.origin, rd = this.rc.ray.direction;
      const wallT = fast ? this.world.rayHit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, cfg.range, true) : cfg.range;
      this.game.shootBarrels?.(ro, rd, wallT); // explosive barrels (barrels.js): the barrel is solid, the bullet ends on it

      // les balles perforantes traversent plusieurs zombies (une seule touche par zombie)
      let end = null, budget = cfg.pierce || 1, stopped = false;
      const seen = new Set();
      for (const h of hits) {
        if (fast && h.distance > wallT) break;
        const z = h.object.userData.zombie;
        if (!z) { end = h.point; this.game.impact(h.point); stopped = true; break; }
        if (seen.has(z)) continue;
        seen.add(z);
        // chute des dégâts selon la distance, propre à chaque zombie touché (calcul côté tireur : z_hit inchangé)
        const dmg = cfg.damage * falloffMult(cfg, h.distance) * (this.game.perkFx?.critMult() ?? 1); // Sixième sens : coup critique
        this.game.hitZombie(z, h.object.userData.head, h.point, dmg, cfg.headMult, null, false, cfg.id === 'raygun' ? { ray: true } : null);
        if (cfg.ether && Math.random() < cfg.ether.chance) this.game.splash(h.point, cfg.ether.radius, dmg * cfg.ether.frac, cfg.ether.color); // Éther (niveau III)
        end = h.point;
        if (--budget <= 0) { stopped = true; break; }
      }
      if (!stopped) {
        end = ro.clone().addScaledVector(rd, wallT);
        if (fast && wallT < cfg.range) this.game.impact(end);
      }
      if (cfg.splash) this.game.splash(end, cfg.splash.radius, cfg.splash.damage, cfg.splash.color);
      if (cfg.boom) this.game.splash(end, cfg.boom.radius, cfg.damage * cfg.boom.frac, cfg.boom.color); // balles explosives (fusils de précision, niveau III)
      this.game.tracer(origin, end, cfg.tracer);
      this.game.onPlayerShot?.(origin, end, cfg.id, { tc: cfg.tracer, sil: sil ? 1 : 0 });
    }
  }

  // Bouche de l'arme d'où partent traçantes et projectiles : celle de la vue, ou (vue externe) celle du personnage sur sa moto ; tant que le
  // personnage n'est pas encore visible (début de la montée), le point avancé de la caméra
  shotOrigin(external) {
    if (external) {
      const m = this.ride.muzzleWorld(this._v.set(0, 0, 0));
      if (m) return m.clone();
      this.camera.getWorldDirection(this._v2);
      return this.camera.position.clone().addScaledVector(this._v2, this.ride.dist);
    }
    return this.muzzle.getWorldPosition(this._v.set(0, 0, 0)).clone();
  }

  // Lance-grenades : un vrai projectile (voir launcher.js). Il part de la bouche et vise le point visé par la caméra (au plus 40 m
  // devant) ; si le canon est plaqué contre un mur, il part de l'œil pour ne pas naître dans le mur.
  fireLauncher(cfg, mul) {
    const world = this.world;
    const sx = (Math.random() - 0.5) * 2 * cfg.spread * mul, sy = (Math.random() - 0.5) * 2 * cfg.spread * mul;
    this.rc.setFromCamera({ x: sx, y: sy }, this.camera);
    const ext = this.ride.external;
    if (ext) this.rc.ray.origin.addScaledVector(this.rc.ray.direction, this.ride.dist); // vue externe : le tir part du pilote
    const ro = this.rc.ray.origin.clone(), rd = this.rc.ray.direction.clone();
    const origin = this.shotOrigin(ext);
    const toM = origin.clone().sub(ro), lenM = toM.length();
    if (world.rayHit && lenM > 1e-4) {
      toM.divideScalar(lenM);
      const hit = world.rayHit(ro.x, ro.y, ro.z, toM.x, toM.y, toM.z, lenM);
      if (hit < lenM) origin.copy(ro).addScaledVector(toM, Math.max(0, hit - 0.05));
    }
    const far = Math.min(40, world.rayHit ? world.rayHit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, 40, true) : 40);
    const target = ro.clone().addScaledVector(rd, Math.max(far, 2));
    const dir = target.sub(origin).normalize();
    const vel = dir.clone().multiplyScalar(cfg.proj.speed);
    if (this.onTram) { const t = this.onTram.v, q = t.frame(this.onTram.u, this._tq || (this._tq = {})); vel.x += q.tx * t.v; vel.z += q.tz * t.v; }
    this.game.launchShell(origin, vel, true, null, cfg.pap | 0, cfg.attDamageMult || 1);
    this.game.onPlayerShot?.(origin, origin.clone().addScaledVector(dir, 1), cfg.id, { nt: 1 });
  }

  // Lance-grenades sous canon (clic molette) : un obus de 40 mm, comme celui du M79 ordinaire (niveau 0), cooldown s entre deux coups
  fireGL(now) {
    const w = this.curW, cfg = this.curCfg;
    if (!cfg.gl || w.gl <= 0 || now < (this.nextGL || 0) || this.locked || this.vault || this.downed || this.dead || this.driving) return false;
    w.gl--;
    this.nextGL = now + cfg.gl.cooldown;
    this.kick = 1; this.recoil += 0.04;
    this.game.weaponSound('m79');
    this.camera.updateMatrixWorld(true);
    const M = CONFIG.weapons.m79;
    this.fireLauncher({ id: 'm79', spread: M.spread, proj: M.proj, pap: 0 }, (this.aiming ? 0.4 : 1) * 1);
    return true;
  }

  reload() {
    const cfg = this.curCfg;
    const w = this.curW;
    if (w.ammo <= 0 && w.reserve <= 0 && !w.gl) { this.autoSwitchAmmoWeapon(); return; }
    if (w.reloading || w.ammo >= cfg.magSize || w.reserve <= 0) return;
    this.game.perkFx?.onReload(w, cfg); // Cerise-foudre (munitions restantes avant le rechargement)
    w.reloading = true;
    w.reloadT = 0;
    this.game.sfx.reload(cfg.cat, cfg.reloadTime);
  }

  throwGrenade() {
    if (this.downed || this.dead || this.grenades <= 0 || this.driving) return;
    this.grenades--;
    this.fpHands?.onThrowGrenade();
    this.game.sfx.grenadePin?.();
    this.camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // vue externe : la grenade part de l'œil du pilote (pas de la caméra, 3 m derrière)
    const o = (this.ride.external ? this.ride.eyeOrigin(this.vehicle, { x: this.pos.x, y: this.pos.y + CONFIG.player.eye, z: this.pos.z }, new THREE.Vector3()) : this.camera.position.clone()).addScaledVector(dir, 0.6);
    const v = dir.multiplyScalar(15).add(new THREE.Vector3(0, 3, 0)).add(new THREE.Vector3(this.vel.x, 0, this.vel.z));
    if (this.onTram) { const t = this.onTram.v, q = t.frame(this.onTram.u, this._tq || (this._tq = {})); v.x += q.tx * t.v; v.z += q.tz * t.v; } // lancée depuis une rame ou le train (walkFrame) qui roule : elle garde sa vitesse
    this.game.throwGrenade(o, v, true);
  }

  // Atterrissage après `air` s en l'air et une chute de `drop` m : le PHD Flopper déclenche son onde explosive si le saut est parti
  // d'un sprint ou si la chute dépasse fallHeight. Ni en moto, ni à terre, avec une recharge de cooldown s.
  // surface under the feet (footstep sound) : metal (train / tram floor), concrete (station), wood (ground-floor rooms, floors and stairs of the key buildings), else cobble
  surface() {
    if (this.onTram) return 'metal';
    const w = this.world, r = this.region | 0;
    if (r) {
      if (w.gare && r === w.gare.region) return 'concrete';
      const R = w.levels?.regions[r];
      return R && R.kb !== undefined ? 'wood' : 'stone';
    }
    return w.roomOf && w.roomOf(this.pos.x, this.pos.z) >= 0 ? 'wood' : 'stone';
  }
  footstep(sprinting) {
    const A = CONFIG.audio.step;
    this.game.sfx.step?.(this.surface(), (sprinting ? A.sprintMul : this.crouching ? (A.crouchMul || 0.45) : 1) * (this.downed ? A.downedMul : 1));
  }
  onLand(air, drop) {
    const F = CONFIG.phd;
    if (!this.perks.phdflopper || this.vehicle || this.downed || this.dead || this.flopCd > 0 || air < F.minAir) return;
    if (!this.jumpSprint && drop < F.fallHeight) return;
    this.flopCd = F.cooldown;
    this.game.flop(this.pos);
  }

  // -------------------------------------------------------------- Dégâts
  // src : origine des dégâts ('blast' explosion, 'crash' choc de moto ; absent = coup de zombie, Bourreau…)
  hurt(amount, src = null) {
    if (this.godMode || this.downed || this.dead || this.game.xfRide?.safe) return; // (not during a tram transfer ride : v0.83.0, riders stand in the car, safe)
    if (this.perks.phdflopper && (src === 'blast' || src === 'crash')) return; // PHD Flopper : immunité aux explosions et aux chocs
    if (this.game.perkFx) { amount = this.game.perkFx.filterDamage(amount); if (amount <= 0) return; } // Bastion, Ultime Volonté
    if (!src) this.game.perkFx?.onStruck(); // Veuve noire : coup de zombie
    this.health -= amount;
    // During the long intro ride (and the stop before round 1), zombies wound but never kill: no game over before round 1 (CONFIG.intro.rideMinHealth) ;
    // the floor holds CONFIG.intro.graceAfter s more once round 1 has started (spawn protection, game.introGraceUntil set by intro.js)
    if (this.game.intro?.ph === 'ride' || this.game.intro?.ph === 'stopped' || this.game.time < (this.game.introGraceUntil || 0)) this.health = Math.max(this.health, CONFIG.intro.rideMinHealth ?? 0);
    this.lastHurt = this.game.time;
    this.game.hud.damage();
    this.game.sfx.hurt();
    if (this.health <= 0) {
      this.health = 0;
      if (this.game.isMultiplayer || this.perks.quickrevive) {
        this.down();
      } else {
        this.game.gameOver();
      }
    }
  }

  down() {
    this.statDowns = (this.statDowns || 0) + 1;
    const solo = !this.game.isMultiplayer;
    const hadQR = !!this.perks.quickrevive;
    this.downed = true;
    this.bleedout = 45;
    this.health = 0;
    this.aiming = false;
    this.mouseDown = false;
    this.vault = null;
    if (this.vehicle) this.game.leaveVehicle?.(true);
    this.game.perkFx?.onDown(); // Pierre tombale : la tombe garde les atouts
    if (!this.game.blessed) this.clearPerks(); // à terre : on perd tous ses atouts (sauf sous la Bénédiction de l'Aube)
    if (solo && hadQR) {
      this.selfRevive = 4;
      this.game.hud.announce('À TERRE !', 'Réanimation rapide : vous vous relevez…', 3500);
      return;
    }
    this.game.hud.announce('VOUS ÊTES À TERRE !', 'Rampez vers un coéquipier pour être réanimé…', 4000);
    this.game.onPlayerDowned?.();
  }

  revive() {
    this.downed = false;
    this.dead = false;
    this.selfRevive = 0;
    this.health = Math.min(50, this.maxHealth);
    this.lastHurt = this.game.time;
    this.game.hud.announce('RÉANIMÉ !', 'Reprenez le combat !', 2500);
  }
}
