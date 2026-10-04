import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildWeaponModels } from './viewmodels.js';

const ADS_DELTA = 20; // réduction du FOV en visée
const PAP_TINT = 0x6a1fa8; // reflet violet des armes améliorées

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
    this.perks = {};
    this.statsVersion = 0; // incrémenté quand les atouts changent (invalide le cache des stats d'arme)

    camera.rotation.order = 'YXZ';
    scene.add(camera);
    this.buildViewmodels();
    this.bindInput();

    // Lampe torche tactique
    this.flashlight = new THREE.SpotLight(0xfff2d0, 55, 40, 0.5, 0.6, 1.6);
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -1);
    camera.add(this.flashlight, this.flashlight.target);

    this.reset();
  }

  get curW() { return this.inventory[this.weaponIdx]; }
  get curCfg() { return this.statsOf(this.curW); }
  get maxHealth() { return this.perks.juggernog ? 250 : CONFIG.player.maxHealth; }
  get maxWeapons() { return this.perks.mulekick ? 3 : 2; }

  // Statistiques effectives d'une arme : base + Pack-a-Punch + atouts
  statsOf(w) {
    const key = `${w.pap ? 1 : 0}|${this.statsVersion}`;
    if (w._statsKey === key) return w._stats;
    const base = CONFIG.weapons[w.id];
    const s = { ...base };
    if (w.pap) {
      s.pap = true;
      s.name = CONFIG.papNames[w.id] || `${base.name} +`;
      s.damage = base.damage * (w.id === 'raygun' ? 1.6 : 2.5);
      s.magSize = Math.round(base.magSize * 1.5);
      s.maxReserve = Math.round(base.maxReserve * 1.5);
      s.headMult = base.headMult * 1.2;
      s.tracer = 0xc070ff;
      if (base.splash) s.splash = { radius: base.splash.radius * 1.3, damage: base.splash.damage * 2 };
      if (base.pierce) s.pierce = base.pierce + 2;
      else s.pierce = 2;
    }
    if (this.perks.doubletap) { s.fireRate *= 1.33; s.damage *= 1.25; }
    if (this.perks.speedcola) s.reloadTime *= 0.5;
    w._statsKey = key;
    w._stats = s;
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
    this.bleedout = 0;
    this.selfRevive = 0;
    this.grenades = CONFIG.grenade.start;

    // Inventaire d'armes
    this.inventory = CONFIG.startWeapons.map((id) => this.newWeapon(id));
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

  newWeapon(id) {
    const cfg = CONFIG.weapons[id];
    return { id, ammo: cfg.magSize, reserve: cfg.startReserve, reloading: false, reloadT: 0, pap: false };
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
    if (this.inventory.length > this.maxWeapons) { // Mule Kick perdu : on perd la 3e arme
      this.inventory.length = this.maxWeapons;
      if (this.weaponIdx >= this.inventory.length) this.weaponIdx = 0;
      this.switchWeapon(this.weaponIdx);
    }
  }

  // ---------------------------------------------------------------- Inventaire
  hasWeapon(id) {
    return this.inventory.some((w) => w.id === id);
  }

  // Nouvelle arme : prend un emplacement libre, sinon remplace l'arme en main
  giveWeapon(id) {
    const cfg = CONFIG.weapons[id];
    if (!cfg) return;
    const existing = this.inventory.findIndex((w) => w.id === id);
    if (existing >= 0) {
      const w = this.inventory[existing];
      w.reserve = this.statsOf(w).maxReserve;
      this.switchWeapon(existing);
      return;
    }
    const w = this.newWeapon(id);
    if (this.inventory.length < this.maxWeapons) {
      this.inventory.push(w);
      this.switchWeapon(this.inventory.length - 1);
    } else {
      this.inventory[this.weaponIdx] = w;
      this.switchWeapon(this.weaponIdx);
    }
  }

  // Pack-a-Punch : améliore l'arme en main (chargeur et réserve pleins)
  upgradeCurrent() {
    const w = this.curW;
    if (w.pap) return false;
    w.pap = true;
    const s = this.statsOf(w);
    w.ammo = s.magSize;
    w.reserve = s.maxReserve;
    w.reloading = false;
    this.switchWeapon(this.weaponIdx);
    return true;
  }

  switchWeapon(idx) {
    if (idx < 0 || idx >= this.inventory.length) return;
    if (this.curW) this.curW.reloading = false;
    this.weaponIdx = idx;
    const w = this.curW;
    // bouche du canon (éclair de tir, départ des traçantes) selon la longueur de l'arme
    const mi = this.vmInfo && this.vmInfo[w.id];
    this.muzzle.position.set(0, mi ? mi.muzzleY : 0.015, mi ? mi.muzzle : -0.6);
    this.flash.position.set(0, mi ? mi.muzzleY : 0.015, (mi ? mi.muzzle : -0.6) - 0.04);
    this.flashLight.position.set(0, 0.05, (mi ? mi.muzzle : -0.6) - 0.1);
    for (const [id, grp] of Object.entries(this.vms)) {
      grp.visible = id === w.id;
      if (grp.visible) {
        grp.traverse((o) => {
          if (o.isMesh && !o.userData.skin && !o.userData.glow) { o.material.emissive.setHex(w.pap ? PAP_TINT : 0x000000); o.material.emissiveIntensity = w.pap ? 0.35 : 1; }
        });
      }
    }
    this.game.hud.setWeapon(this.curCfg.name);
  }

  nextWeapon() {
    this.switchWeapon((this.weaponIdx + 1) % this.inventory.length);
  }
  prevWeapon() {
    this.switchWeapon((this.weaponIdx - 1 + this.inventory.length) % this.inventory.length);
  }

  // ---------------------------------------------------------------- Input
  bindInput() {
    // Déplacements : position physique de la touche (e.code), donc ZQSD en AZERTY = WASD en QWERTY.
    // Actions : lettre réellement tapée (e.key), pour que R, E, F, G, M marchent quel que soit le clavier.
    const letter = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : '');
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      const k = letter(e);
      if (k) this.keys['letter:' + k] = true;
      if (!this.game.playing || e.repeat) return;
      if (k === 'r') this.reload();
      if (k === 'e') this.game.interact();
      if (k === 'f') this.setTorch(!this.torchOn);
      if (k === 'g') this.throwGrenade();
      if (e.code === 'Digit1') this.switchWeapon(0);
      if (e.code === 'Digit2') this.switchWeapon(1);
      if (e.code === 'Digit3') this.switchWeapon(2);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      const k = letter(e);
      if (k) this.keys['letter:' + k] = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.game.playing) return;
      if (e.deltaY > 0) this.nextWeapon();
      else if (e.deltaY < 0) this.prevWeapon();
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.game.playing) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aiming = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.game.playing) return;
      const zoom = this.aim > 0.5 ? (this.curCfg.adsFov ? 0.3 : 0.6) : 1;
      const sens = 0.0022 * this.game.settings.sens * zoom;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    });
    this.aiming = false;
  }

  // Allumer / éteindre la torche en changeant l'intensité : changer le nombre de lumières visibles
  // obligerait three.js à recompiler tous les shaders (gros ralentissement).
  setTorch(on) {
    this.torchOn = on;
    this.flashlight.intensity = on ? 55 : 0;
  }

  releaseInputs() {
    this.keys = {};
    this.mouseDown = false;
    this.aiming = false;
  }

  // ------------------------------------------------------------ Viewmodels
  buildViewmodels() {
    const mats = () => ({
      dark: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.7 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.8 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.8 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5, metalness: 0.6 }),
    });

    this.vm = new THREE.Group();
    this.vms = {};

    const addBox = (parent, w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const hands = (grp, M, front, back) => {
      addBox(grp, 0.09, 0.09, 0.14, front[0], front[1], front[2], M.skin).userData.skin = true;
      addBox(grp, 0.09, 0.09, 0.1, back[0], back[1], back[2], M.skin).userData.skin = true;
    };
    const weapon = (id, build) => {
      const grp = new THREE.Group();
      build(grp, mats());
      grp.visible = false;
      this.vm.add(grp);
      this.vms[id] = grp;
    };

    // Toutes les armes classiques : modèles détaillés (viewmodels.js)
    const built = buildWeaponModels(this.vm);
    Object.assign(this.vms, built.vms);
    this.vmInfo = built.info;
    // PISTOLET À RAYONS : corps rouge, ailettes, bulbe vert lumineux
    weapon('raygun', (grp, M) => {
      const red = new THREE.MeshStandardMaterial({ color: 0x9a2a1e, roughness: 0.4, metalness: 0.6 });
      const glow = new THREE.MeshStandardMaterial({ color: 0x55ff77, emissive: 0x33ff55, emissiveIntensity: 2 });
      addBox(grp, 0.07, 0.08, 0.22, 0, 0, -0.05, red);
      for (let i = 0; i < 3; i++) addBox(grp, 0.12, 0.012, 0.03, 0, 0.0, -0.08 - i * 0.05, M.grey);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glow);
      bulb.position.set(0, 0, -0.2); bulb.userData.glow = true;
      grp.add(bulb);
      addBox(grp, 0.035, 0.11, 0.05, 0, -0.08, 0.05, M.dark).rotation.x = -0.25;
      hands(grp, M, [0.0, -0.09, 0.05], [0, -0.11, 0.09]);
    });

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.015, -0.6);
    this.vm.add(this.muzzle);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, depthWrite: false })
    );
    this.flash.position.set(0, 0.015, -0.64);
    this.flash.visible = false;
    this.vm.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffaa44, 0, 8, 2);
    this.flashLight.position.set(0, 0.05, -0.7);
    this.vm.add(this.flashLight);
    this.flashT = 0;

    this.vm.scale.setScalar(0.85);
    this.camera.add(this.vm);
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
    let mx = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let mz = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    const moving = (mx !== 0 || mz !== 0) && !this.dead;
    const sprinting = !this.downed && !!K.ShiftLeft && mz > 0 && !this.aiming;
    const stamin = this.perks.staminup ? 1.3 : 1;
    let speed = this.downed ? 1.2 : (sprinting ? P.sprintSpeed * stamin : P.walkSpeed * (this.perks.staminup ? 1.1 : 1));
    if (this.aiming && !this.downed) speed *= 0.6;
    if (moving) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (cos * mx - sin * mz) * speed;
    const wz = (-sin * mx - cos * mz) * speed;
    const k = Math.min(1, dt * 12);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ---- saut / gravité ----
    const onGround = this.pos.y <= 0.001;
    if (K.Space && onGround && !this.downed) this.vy = P.jumpSpeed;
    this.vy -= P.gravity * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y < 0) { this.pos.y = 0; this.vy = 0; }

    this.world.collide(this.pos, P.radius);

    // ---- régénération ----
    if (!this.downed && this.health < this.maxHealth && now - this.lastHurt > P.regenDelay) {
      this.health = Math.min(this.maxHealth, this.health + P.regenRate * dt);
    }

    // ---- visée (ADS) ----
    this.aim += ((this.aiming && !this.downed ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    const base = this.game.settings.fov;
    const fov = base - (cfg.adsFov ? base - cfg.adsFov : ADS_DELTA) * this.aim;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // lunette : on cache l'arme quand on vise au fusil de précision
    // (on cache le modèle de l'arme, pas le groupe entier qui contient la lumière de tir)
    this.vms[w.id].visible = !(cfg.adsFov && this.aim > 0.8);

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
    } else if (this.mouseDown && now >= this.nextShot) {
      if (w.ammo > 0) this.shoot(now, moving);
      else if (w.reserve > 0) this.reload();
      else { this.nextShot = now + 0.3; this.game.sfx.empty(); }
      if (cfg.type === 'semi') this.mouseDown = false; // une balle par clic
    }

    // ---- caméra ----
    this.recoil *= Math.max(0, 1 - dt * 8);
    this.bobT += dt * (sprinting ? 12 : 8) * (moving && onGround ? 1 : 0);
    const bob = moving && onGround ? Math.sin(this.bobT) * (sprinting ? 0.06 : 0.035) : 0;
    const eyeH = this.downed ? 0.55 : P.eye;
    this.camera.position.set(this.pos.x, this.pos.y + eyeH + bob, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoil, this.yaw, 0);

    // ---- animation de l'arme ----
    this.kick *= Math.max(0, 1 - dt * 14);
    const a = this.aim;
    let x = 0.22 * (1 - a), y = -0.22 + 0.06 * a, z = -0.45 + 0.05 * a;
    let rx = this.kick * (cfg.type === 'shotgun' || cfg.type === 'semi' ? 0.22 : 0.12);
    if (w.reloading) {
      const p = w.reloadT / cfg.reloadTime;
      const dip = Math.sin(Math.min(1, p) * Math.PI);
      y -= dip * 0.25;
      rx += dip * 0.7;
      x -= dip * 0.05;
    }
    if (sprinting) { rx += 0.25; x -= 0.05; y -= 0.05; }
    this.vm.position.set(x + (moving ? Math.sin(this.bobT * 0.5) * 0.008 : 0), y, z + this.kick * 0.07);
    this.vm.rotation.set(rx, sprinting ? 0.35 : 0, 0);

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }
  }

  // ------------------------------------------------------------- Tir
  shoot(now, moving) {
    const cfg = this.curCfg;
    const w = this.curW;
    w.ammo--;
    this.nextShot = now + 1 / cfg.fireRate;
    this.kick = 1;

    // Recul
    const heavy = cfg.type === 'shotgun' || cfg.type === 'semi';
    this.recoil += (heavy ? 0.016 : 0.005) + Math.random() * 0.004;
    this.yaw += (Math.random() - 0.5) * 0.002;

    // Sons
    this.game.weaponSound(cfg.id);

    // Muzzle flash
    this.flash.visible = true;
    this.flash.material.color.setHex(cfg.id === 'raygun' ? 0x66ff88 : cfg.pap ? 0xd28cff : 0xffcc66);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(heavy ? 1.4 : 0.8 + Math.random() * 0.5);
    this.flashLight.intensity = heavy ? 40 : 25;
    this.flashT = 0.045;

    // Raycast(s)
    this.camera.updateMatrixWorld(true);
    const mul = (this.aiming ? (cfg.adsFov ? 0.05 : 0.4) : 1) * (moving ? 1.8 : 1);
    const origin = this.muzzle.getWorldPosition(this._v.set(0, 0, 0)).clone();
    const pellets = cfg.pellets || 1;

    for (let p = 0; p < pellets; p++) {
      const sx = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      const sy = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      this.rc.setFromCamera({ x: sx, y: sy }, this.camera);
      this.rc.far = cfg.range;
      // Grande carte : les murs sont testés par la grille de collision (rapide), seuls les zombies par maillage.
      const fast = !!this.world.rayHit;
      const hits = this.rc.intersectObjects(fast ? this.game.zombieTargets() : this.game.hitTargets(), false);
      const ro = this.rc.ray.origin, rd = this.rc.ray.direction;
      const wallT = fast ? this.world.rayHit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, cfg.range) : cfg.range;

      // les balles perforantes traversent plusieurs zombies (une seule touche par zombie)
      let end = null, budget = cfg.pierce || 1, stopped = false;
      const seen = new Set();
      for (const h of hits) {
        if (fast && h.distance > wallT) break;
        const z = h.object.userData.zombie;
        if (!z) { end = h.point; this.game.impact(h.point); stopped = true; break; }
        if (seen.has(z)) continue;
        seen.add(z);
        this.game.hitZombie(z, h.object.userData.head, h.point, cfg.damage, cfg.headMult);
        end = h.point;
        if (--budget <= 0) { stopped = true; break; }
      }
      if (!stopped) {
        end = ro.clone().addScaledVector(rd, wallT);
        if (fast && wallT < cfg.range) this.game.impact(end);
      }
      if (cfg.splash) this.game.splash(end, cfg.splash.radius, cfg.splash.damage);
      this.game.tracer(origin, end, cfg.tracer);
      this.game.onPlayerShot?.(origin, end, cfg.id);
    }
  }

  reload() {
    const cfg = this.curCfg;
    const w = this.curW;
    if (w.reloading || w.ammo >= cfg.magSize || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadT = 0;
    this.game.sfx.reload();
  }

  throwGrenade() {
    if (this.downed || this.dead || this.grenades <= 0) return;
    this.grenades--;
    this.camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const o = this.camera.position.clone().addScaledVector(dir, 0.6);
    const v = dir.multiplyScalar(15).add(new THREE.Vector3(0, 3, 0)).add(new THREE.Vector3(this.vel.x, 0, this.vel.z));
    this.game.throwGrenade(o, v, true);
  }

  // -------------------------------------------------------------- Dégâts
  hurt(amount) {
    if (this.downed || this.dead) return;
    this.health -= amount;
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
    const solo = !this.game.isMultiplayer;
    const hadQR = !!this.perks.quickrevive;
    this.downed = true;
    this.bleedout = 45;
    this.health = 0;
    this.clearPerks(); // à terre : on perd tous ses atouts
    if (solo && hadQR) {
      this.selfRevive = 4;
      this.game.hud.announce('À TERRE !', 'Réanimation rapide : vous vous relevez…', 3500);
      return;
    }
    this.game.hud.announce('VOUS ÊTES À TERRE !', 'Attendez un coéquipier…', 4000);
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
