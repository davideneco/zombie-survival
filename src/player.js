import * as THREE from 'three';
import { CONFIG } from './config.js';

const BASE_FOV = 75;
const ADS_FOV = 55;

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

    camera.rotation.order = 'YXZ';
    scene.add(camera);
    this.buildViewmodels();
    this.bindInput();

    // Lampe torche tactique
    this.flashlight = new THREE.SpotLight(0xfff2d0, 110, 40, 0.5, 0.6, 1.6);
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -1);
    camera.add(this.flashlight, this.flashlight.target);

    this.reset();
  }

  get curW() { return this.inventory[this.weaponIdx]; }
  get curCfg() { return CONFIG.weapons[this.curW.id]; }

  reset() {
    const P = CONFIG.player;
    this.pos.copy(this.world.startPos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0;
    this.health = P.maxHealth;
    this.downed = false;
    this.dead = false;
    this.bleedout = 0;

    // Inventaire d'armes
    this.inventory = [
      {
        id: 'rifle',
        ammo: CONFIG.weapons.rifle.magSize,
        reserve: CONFIG.weapons.rifle.startReserve,
        reloading: false,
        reloadT: 0,
      },
    ];
    this.weaponIdx = 0;
    this.switchWeapon(0);

    this.nextShot = 0;
    this.lastHurt = -99;
    this.kick = 0;
    this.aim = 0;
    this.bobT = 0;
    this.mouseDown = false;
    this.flashlight.visible = true;
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- Inventaire
  hasWeapon(id) {
    return this.inventory.some((w) => w.id === id);
  }

  giveWeapon(id) {
    const cfg = CONFIG.weapons[id];
    if (!cfg) return;
    const existing = this.inventory.findIndex((w) => w.id === id);
    if (existing >= 0) {
      // Recharger les munitions au maximum
      this.inventory[existing].reserve = cfg.maxReserve;
      this.switchWeapon(existing);
    } else {
      // Nouvelle arme
      this.inventory.push({
        id,
        ammo: cfg.magSize,
        reserve: cfg.startReserve,
        reloading: false,
        reloadT: 0,
      });
      this.switchWeapon(this.inventory.length - 1);
    }
  }

  switchWeapon(idx) {
    if (idx < 0 || idx >= this.inventory.length) return;
    if (this.curW) this.curW.reloading = false;
    this.weaponIdx = idx;
    const curId = this.curW.id;

    for (const [id, grp] of Object.entries(this.vms)) {
      grp.visible = id === curId;
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
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!this.game.playing) return;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyE') this.game.interact();
      if (e.code === 'KeyF') this.flashlight.visible = !this.flashlight.visible;
      if (e.code === 'Digit1') this.switchWeapon(0);
      if (e.code === 'Digit2') this.switchWeapon(1);
      if (e.code === 'Digit3') this.switchWeapon(2);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
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
      const sens = 0.0022 * (this.aim > 0.5 ? 0.6 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    });
    this.aiming = false;
  }

  releaseInputs() {
    this.keys = {};
    this.mouseDown = false;
    this.aiming = false;
  }

  // ------------------------------------------------------------ Viewmodels
  buildViewmodels() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.8 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5, metalness: 0.6 });

    this.vm = new THREE.Group();
    this.vms = {};

    const addBox = (parent, w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    // 1) FUSIL D'ASSAUT
    {
      const grp = new THREE.Group();
      addBox(grp, 0.06, 0.09, 0.5, 0, 0, 0, dark);
      addBox(grp, 0.025, 0.025, 0.35, 0, 0.015, -0.4, dark);
      addBox(grp, 0.05, 0.12, 0.07, 0, -0.1, 0.02, dark).rotation.x = 0.2;
      addBox(grp, 0.05, 0.1, 0.22, 0, -0.02, 0.35, wood);
      addBox(grp, 0.04, 0.12, 0.05, 0, -0.09, 0.15, dark).rotation.x = -0.2;
      addBox(grp, 0.015, 0.03, 0.015, 0, 0.07, -0.5, dark);
      addBox(grp, 0.09, 0.09, 0.14, 0.02, -0.06, -0.12, skin);
      addBox(grp, 0.09, 0.09, 0.1, 0.0, -0.12, 0.16, skin);
      this.vm.add(grp);
      this.vms.rifle = grp;
    }

    // 2) FUSIL À POMPE
    {
      const grp = new THREE.Group();
      addBox(grp, 0.07, 0.08, 0.45, 0, 0, 0, dark);          // culasse
      addBox(grp, 0.032, 0.032, 0.45, 0, 0.02, -0.42, grey); // double canon lourd
      addBox(grp, 0.028, 0.028, 0.38, 0, -0.018, -0.38, grey); // tube magasin
      addBox(grp, 0.07, 0.07, 0.18, 0, -0.018, -0.26, wood); // pompe bois
      addBox(grp, 0.055, 0.11, 0.26, 0, -0.03, 0.35, wood);  // crosse massive
      addBox(grp, 0.09, 0.09, 0.14, 0.02, -0.03, -0.26, skin); // main pompe
      addBox(grp, 0.09, 0.09, 0.1, 0.0, -0.12, 0.16, skin);    // main détente
      grp.visible = false;
      this.vm.add(grp);
      this.vms.shotgun = grp;
    }

    // 3) PISTOLET-MITRAILLEUR (MP40 / Thompson style)
    {
      const grp = new THREE.Group();
      addBox(grp, 0.05, 0.07, 0.38, 0, 0, 0, dark);
      addBox(grp, 0.022, 0.022, 0.28, 0, 0.01, -0.32, grey); // canon ventilé
      addBox(grp, 0.03, 0.18, 0.045, 0, -0.12, -0.05, dark); // long chargeur droit
      addBox(grp, 0.035, 0.09, 0.045, 0, -0.07, -0.14, wood); // poignée avant
      addBox(grp, 0.04, 0.1, 0.045, 0, -0.08, 0.12, dark).rotation.x = -0.2;
      addBox(grp, 0.04, 0.07, 0.18, 0, -0.02, 0.28, wood); // crosse compacte
      addBox(grp, 0.08, 0.08, 0.12, 0.01, -0.06, -0.14, skin);
      addBox(grp, 0.08, 0.08, 0.1, 0.0, -0.11, 0.13, skin);
      grp.visible = false;
      this.vm.add(grp);
      this.vms.smg = grp;
    }

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

    // État à terre (co-op)
    if (this.downed) {
      this.bleedout = Math.max(0, this.bleedout - dt);
      if (this.bleedout <= 0 && !this.dead) {
        this.dead = true;
        this.game.checkTeamWipe?.();
      }
    }

    // ---- déplacement ----
    let mx = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let mz = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    const moving = (mx !== 0 || mz !== 0) && !this.dead;
    const sprinting = !this.downed && !!K.ShiftLeft && mz > 0 && !this.aiming;
    let speed = this.downed ? 1.2 : (sprinting ? P.sprintSpeed : P.walkSpeed);
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
    if (!this.downed && this.health < P.maxHealth && now - this.lastHurt > P.regenDelay) {
      this.health = Math.min(P.maxHealth, this.health + P.regenRate * dt);
    }

    // ---- visée (ADS) ----
    this.aim += ((this.aiming && !this.downed ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    const fov = BASE_FOV + (ADS_FOV - BASE_FOV) * this.aim;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

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
    let rx = this.kick * (cfg.type === 'shotgun' ? 0.22 : 0.12);
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
    this.recoil += (cfg.type === 'shotgun' ? 0.016 : 0.005) + Math.random() * 0.004;
    this.yaw += (Math.random() - 0.5) * 0.002;

    // Sons
    if (cfg.type === 'shotgun') this.game.sfx.shotgun();
    else if (cfg.id === 'smg') this.game.sfx.smg();
    else this.game.sfx.shot();

    // Muzzle flash
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(cfg.type === 'shotgun' ? 1.4 : 0.8 + Math.random() * 0.5);
    this.flashLight.intensity = cfg.type === 'shotgun' ? 40 : 25;
    this.flashT = 0.045;

    // Raycast(s)
    this.camera.updateMatrixWorld(true);
    const mul = (this.aiming ? 0.4 : 1) * (moving ? 1.8 : 1);
    const origin = this.muzzle.getWorldPosition(this._v.set(0, 0, 0)).clone();
    const pellets = cfg.pellets || 1;

    for (let p = 0; p < pellets; p++) {
      const sx = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      const sy = (Math.random() - 0.5) * 2 * cfg.spread * mul;
      this.rc.setFromCamera({ x: sx, y: sy }, this.camera);
      this.rc.far = cfg.range;
      const hits = this.rc.intersectObjects(this.game.hitTargets(), false);

      let end;
      if (hits.length) {
        const h = hits[0];
        end = h.point;
        const z = h.object.userData.zombie;
        if (z) {
          this.game.hitZombie(z, h.object.userData.head, h.point, cfg.damage, cfg.headMult);
        } else {
          this.game.impact(h.point);
        }
      } else {
        end = this.rc.ray.origin.clone().addScaledVector(this.rc.ray.direction, cfg.range);
      }
      this.game.tracer(origin, end);
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

  // -------------------------------------------------------------- Dégâts
  hurt(amount) {
    if (this.downed || this.dead) return;
    this.health -= amount;
    this.lastHurt = this.game.time;
    this.game.hud.damage();
    this.game.sfx.hurt();
    if (this.health <= 0) {
      this.health = 0;
      if (this.game.isMultiplayer) {
        this.down();
      } else {
        this.game.gameOver();
      }
    }
  }

  down() {
    this.downed = true;
    this.bleedout = 45;
    this.health = 0;
    this.game.hud.announce('VOUS ÊTES À TERRE !', 'Attendez un coéquipier…', 4000);
    this.game.onPlayerDowned?.();
  }

  revive() {
    this.downed = false;
    this.dead = false;
    this.health = 50;
    this.lastHurt = this.game.time;
    this.game.hud.announce('RÉANIMÉ !', 'Reprenez le combat !', 2500);
  }
}
