import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildWorld } from './world.js';
import { buildRealWorld } from './realworld.js';
import { Player } from './player.js';
import { Zombie } from './zombie.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { fx } from './fx.js';
import { Net } from './net.js';
import { RemotePlayer, slotColor } from './remote.js';

document.getElementById('version').textContent = __GAME_VERSION__;

// ---------------------------------------------------------------- Rendu
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b12);
scene.fog = new THREE.FogExp2(0x0b121c, CONFIG.map === 'arena' ? 0.022 : 0.028);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);

// Ambiance nocturne réaliste
const hemi = new THREE.HemisphereLight(0x6677aa, 0x222018, 1.1);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9fb4ff, 1.4);
moon.position.set(25, 55, 15);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.03;
scene.add(moon, moon.target);
const MOON_OFFSET = new THREE.Vector3(25, 55, 15);

// ------------------------------------------------------- Options (client)
const DEFAULT_SETTINGS = { brightness: 1.4, fov: 80, sens: 1, volume: 1 };
const settings = { ...DEFAULT_SETTINGS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('zombie_settings') || '{}')); } catch {}

function applyVisualSettings() {
  renderer.toneMappingExposure = 1.3 * settings.brightness;
  hemi.intensity = 1.1 * settings.brightness;
}
applyVisualSettings();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----------------------------------------------------------------- Jeu
fx.init(scene);
const hud = new Hud();
const sfx = new Sfx();
const world = CONFIG.map === 'arena' ? buildWorld(scene) : await buildRealWorld(scene, renderer);

let nextPuId = 1;

const game = {
  started: false,
  playing: false,
  over: false,
  time: 0,
  points: 0,
  kills: 0,
  round: 0,
  toSpawn: 0,
  spawnTimer: 0,
  intermission: 0,
  zombieHealth: 100,
  zombieSpeed: 2,
  zombies: [],
  effects: [],
  powerups: [],
  buffs: { instaKill: 0, doublePoints: 0 },
  sfx, hud, world, settings,
  player: null,

  // Multijoueur
  net: null,
  isHost: false,
  isClient: false,
  isMultiplayer: false,
  roomCode: null,
  mySlot: 0,
  playerName: localStorage.getItem('zombie_name') || 'Joueur',
  remotes: new Map(), // pid -> RemotePlayer
  netTimer: 0,
  reviveTimer: 0,
  reviveTarget: null,

  hitTargets() {
    const list = world.blockers.slice();
    for (const z of this.zombies) if (z.targetable) list.push(...z.meshes);
    return list;
  },

  // Zombies seuls (les murs sont gérés par world.rayHit sur la grande carte)
  zombieTargets() {
    const list = [];
    for (const z of this.zombies) if (z.targetable) list.push(...z.meshes);
    return list;
  },

  addPoints(n, cls = '') {
    this.points += n;
    hud.popup(`+${n}`, cls);
  },

  hitZombie(z, head, point, damage, headMult, fromPid = null) {
    if (this.isClient) {
      // Le client envoie l'impact à l'hôte
      fx.blood(point.x, point.y, point.z, false);
      sfx.hit(head);
      hud.hitMarker(false);
      this.net?.send({
        t: 'z_hit',
        zid: z.id,
        head,
        dmg: damage,
        mult: headMult,
        pt: { x: point.x, y: point.y, z: point.z },
      });
      return;
    }

    // Traitement sur l'hôte (ou en solo)
    if (this.buffs.instaKill > 0) damage = 999999;
    const killed = z.damage(damage * (head ? headMult : 1), head);

    fx.blood(point.x, point.y, point.z, killed && !head);
    sfx.hit(head);

    if (fromPid == null) {
      hud.hitMarker(killed);
    }

    const mult = this.buffs.doublePoints > 0 ? 2 : 1;
    const award = (killed ? (head ? 100 : 60) : 10) * mult;

    if (fromPid != null) {
      // Récompense pour un client distant
      this.net?.send({ t: 'pts', pts: award, head: killed && head, kill: killed }, fromPid);
    } else {
      // Récompense pour l'hôte
      if (killed) {
        this.kills++;
        sfx.kill();
        this.addPoints(award, head ? 'head' : '');
      } else {
        this.addPoints(award);
      }
    }

    if (killed) {
      if (this.isMultiplayer) {
        this.net?.send({ t: 'z_dead', id: z.id, head, px: point.x, py: point.y, pz: point.z });
      }
      // Chance d'apparition d'un bonus COD
      if (Math.random() < CONFIG.powerups.dropChance) {
        this.spawnPowerup(z.pos);
      }
    }
  },

  impact(point, color = 0xcccccc) {
    if (color === 0xcccccc) fx.dust(point.x, point.y, point.z);
    else fx.blood(point.x, point.y, point.z, false);
  },

  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.65 }));
    scene.add(line);
    this.effects.push({ obj: line, life: 0.05, max: 0.05 });
  },

  onPlayerShot(origin, end, weaponId) {
    if (!this.isMultiplayer) return;
    this.net?.send({
      t: 'p_shot',
      origin: { x: origin.x, y: origin.y, z: origin.z },
      end: { x: end.x, y: end.y, z: end.z },
      w: weaponId,
    });
  },

  onPlayerDowned() {
    if (!this.isMultiplayer) return;
    this.net?.send({ t: 'p_down' });
    this.checkTeamWipe();
  },

  checkTeamWipe() {
    if (this.isClient) return; // Seul l'hôte arbitre la défaite d'équipe
    const localDown = this.player.downed || this.player.dead;
    if (!localDown) return;
    for (const r of this.remotes.values()) {
      if (!r.dead && !r.downed) return; // Au moins un coéquipier est debout
    }
    this.gameOver();
  },

  // ------------------------------------------------------------- Bonus (Power-ups COD)
  spawnPowerup(pos, customId = null, forcedType = null) {
    const types = ['max_ammo', 'insta_kill', 'nuke', 'double_points'];
    const type = forcedType || types[Math.floor(Math.random() * types.length)];
    const puid = customId || nextPuId++;

    const grp = new THREE.Group();
    let col = 0x22ff66;
    if (type === 'insta_kill') col = 0xff2222;
    if (type === 'nuke') col = 0xffdd22;
    if (type === 'double_points') col = 0xffaa00;

    const baseGeo = new THREE.DodecahedronGeometry(0.35);
    const baseMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const m = new THREE.Mesh(baseGeo, baseMat);
    grp.add(m);

    const light = new THREE.PointLight(col, 15, 6, 2);
    light.position.y = 0.2;
    grp.add(light);

    grp.position.set(pos.x, 0.9, pos.z);
    scene.add(grp);

    const pu = {
      id: puid,
      type,
      grp,
      life: CONFIG.powerups.duration,
      maxLife: CONFIG.powerups.duration,
      baseY: 0.9,
    };
    this.powerups.push(pu);

    if (this.isHost) {
      this.net?.send({ t: 'pu_spawn', id: puid, type, x: pos.x, z: pos.z });
    }
    return pu;
  },

  collectPowerup(p, byRemote = false) {
    sfx.powerup();
    if (p.type === 'max_ammo') {
      for (const w of this.player.inventory) {
        w.reserve = CONFIG.weapons[w.id].maxReserve;
      }
      hud.announce('MUNITIONS MAX !', 'Réserves pleines pour toute l’équipe', 2500);
      hud.popup('MUNITIONS MAX', 'bonus');
    } else if (p.type === 'insta_kill') {
      this.buffs.instaKill = CONFIG.powerups.buffDuration;
      hud.announce('MORT INSTANTANÉE !', '30 secondes', 2500);
      hud.popup('MORT INSTANTANÉE', 'bonus');
    } else if (p.type === 'nuke') {
      sfx.nuke();
      hud.flashNuke();
      hud.announce('BOMBE !', '+400 points', 2500);
      hud.popup('+400 BOMBE', 'bonus');
      this.addPoints(400, 'bonus');
      if (!this.isClient) {
        for (const z of this.zombies) {
          if (z.dead) continue;
          z.damage(999999, false);
          if (this.isMultiplayer) this.net?.send({ t: 'z_dead', id: z.id, head: false });
        }
      }
    } else if (p.type === 'double_points') {
      this.buffs.doublePoints = CONFIG.powerups.buffDuration;
      hud.announce('POINTS DOUBLES !', '30 secondes', 2500);
      hud.popup('POINTS DOUBLES', 'bonus');
    }

    if (this.isHost && !byRemote) {
      this.net?.send({ t: 'pu_collect', id: p.id, type: p.type });
    }
  },

  // ------------------------------------------------------------- Interactions (Touche E)
  interact() {
    const p = this.player;
    if (p.downed || p.dead) return;

    // 1) Réanimation d'un coéquipier (déclenchée en maintenant E dans update)
    if (this.nearDownedTeammate()) return;

    // 2) Borne de munitions
    if (this.nearStation()) {
      const cfg = p.curCfg;
      if (p.curW.reserve >= cfg.maxReserve) return;
      if (this.points < cfg.ammoPrice) { sfx.deny(); return; }
      this.points -= cfg.ammoPrice;
      p.curW.reserve = cfg.maxReserve;
      sfx.buy();
      return;
    }

    // 3) Porte payante
    const door = this.nearDoor();
    if (door && !this.nearWallWeapon()) {
      if (this.points < door.price) { sfx.deny(); return; }
      this.points -= door.price;
      this.openDoor(door.id);
      if (this.isMultiplayer) this.net?.send({ t: 'door_open', id: door.id });
      return;
    }

    // 4) Armes au mur
    const ww = this.nearWallWeapon();
    if (ww) {
      const has = p.hasWeapon(ww.id);
      if (has) {
        const cfg = CONFIG.weapons[ww.id];
        const cur = p.inventory.find((w) => w.id === ww.id);
        if (cur.reserve >= cfg.maxReserve) return;
        if (this.points < ww.ammoPrice) { sfx.deny(); return; }
        this.points -= ww.ammoPrice;
        cur.reserve = cfg.maxReserve;
        sfx.buy();
      } else {
        if (this.points < ww.price) { sfx.deny(); return; }
        this.points -= ww.price;
        p.giveWeapon(ww.id);
        sfx.buy();
        hud.announce(ww.name, 'Arme acquise !', 2000);
      }
    }
  },

  nearStation() {
    const p = this.player.pos;
    for (const s of world.stations || [world.stationPos]) {
      if (Math.hypot(p.x - s.x, p.z - s.z) < 3.2) return true;
    }
    return false;
  },

  // Porte verrouillée à portée (n'importe quel point de la barrière)
  nearDoor() {
    if (!world.doors) return null;
    const p = this.player.pos;
    let best = null, bestD = 3.4;
    for (const d of world.doors) {
      if (d.open) continue;
      for (const pt of d.points) {
        const dist = Math.hypot(p.x - pt.x, p.z - pt.z);
        if (dist < bestD) { bestD = dist; best = d; }
      }
    }
    return best;
  },

  openDoor(id, announce = true) {
    if (!world.openDoor(id)) return;
    const d = world.doors[id];
    sfx.buy();
    if (announce) hud.announce('PORTE OUVERTE', `Accès à ${d.name}`, 2500);
  },

  nearWallWeapon() {
    if (!world.wallWeapons) return null;
    const p = this.player.pos;
    for (const ww of world.wallWeapons) {
      if (Math.hypot(p.x - ww.pos.x, p.z - ww.pos.z) < 2.8) return ww;
    }
    return null;
  },

  nearDownedTeammate() {
    if (!this.isMultiplayer) return null;
    const p = this.player.pos;
    for (const tm of this.remotes.values()) {
      if ((tm.dead || tm.downed) && Math.hypot(p.x - tm.pos.x, p.z - tm.pos.z) < 2.6) return tm;
    }
    return null;
  },

  // ---------------------------------------------------------- Manches
  startRound() {
    this.round++;
    const r = this.round;
    const countMult = this.isMultiplayer ? 1 + this.remotes.size * 0.75 : 1;
    this.toSpawn = Math.round((4 + r * 3) * countMult);
    this.zombieHealth = r < 10 ? 70 + r * 30 : Math.round(340 * Math.pow(1.1, r - 9));
    this.zombieSpeed = Math.min(1.6 + r * 0.2, 4.2);
    this.spawnTimer = 1;
    hud.setRound(r);
    sfx.roundStart();
    hud.announce(`MANCHE ${r}`, `${this.toSpawn} zombies`);

    // Réanime le joueur s'il était à terre lors de la manche précédente
    if (this.player.downed || this.player.dead) this.player.revive();

    if (this.isHost) {
      this.net?.send({ t: 'round_start', r, toSpawn: this.toSpawn });
    }
  },

  pickSpawn() {
    // Les zombies apparaissent autour d'un joueur vivant tiré au hasard (hôte ou coéquipier).
    const alive = [this.player, ...this.remotes.values()].filter((pl) => !pl.dead && !pl.downed);
    const pool = alive.length ? alive : [this.player];
    const pp = pool[Math.floor(Math.random() * pool.length)].pos;
    if (world.pickWindow) {
      if (Math.random() < 0.65) {
        const w = world.pickWindow(pp.x, pp.z, 11, 60, this.time);
        if (w) { w.busyUntil = this.time + 4; return w; }
      }
      const g = world.pickGround(pp.x, pp.z, 18, 50);
      if (g) return { type: 'ground', pos: g };
      const w = world.pickWindow(pp.x, pp.z, 6, 80, this.time);
      if (w) { w.busyUntil = this.time + 4; return w; }
      return { type: 'ground', pos: new THREE.Vector3(pp.x + 15, 0, pp.z) };
    }
    const wins = world.windowSpawns;
    if (wins && wins.length && Math.random() < 0.65) {
      for (let tries = 0; tries < 25; tries++) {
        const w = wins[Math.floor(Math.random() * wins.length)];
        const d = Math.hypot(w.outside.x - pp.x, w.outside.z - pp.z);
        if (d < 11 || d > 70 || w.busyUntil > this.time) continue;
        w.busyUntil = this.time + 4;
        return w;
      }
    }
    let best = null, bestD = -1;
    for (let i = 0; i < 3; i++) {
      const sp = world.spawnPoints[Math.floor(Math.random() * world.spawnPoints.length)];
      const d = sp.distanceTo(pp);
      if (d > bestD) { bestD = d; best = sp; }
    }
    return { type: 'ground', pos: best.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)) };
  },

  spawnZombie() {
    const spawn = this.pickSpawn();
    let speed = this.zombieSpeed * (0.85 + Math.random() * 0.3);
    if (this.round >= 4 && Math.random() < 0.25) speed *= 1.5; // coureur
    const onEvent = (name, z) => {
      const d = Math.hypot(z.pos.x - this.player.pos.x, z.pos.z - this.player.pos.z);
      const v = Math.max(0, 1 - d / 45);
      if (name === 'knock') sfx.knock(v);
      else if (name === 'glass') { sfx.glass(v); sfx.groan(Math.min(1, v * 1.4)); }
      else if (name === 'rumble') sfx.rumble(v);
      else if (name === 'emerge') { sfx.dirt(v); sfx.groan(Math.min(1, v * 1.4)); }
    };
    const z = new Zombie(scene, spawn, this.zombieHealth, speed, onEvent);
    this.zombies.push(z);
    this.toSpawn--;

    if (this.isHost) {
      const wi = spawn.type === 'window' ? (spawn.index ?? world.windowSpawns.indexOf(spawn)) : -1;
      const sx = spawn.type === 'window' ? spawn.outside.x : spawn.pos.x;
      const sz = spawn.type === 'window' ? spawn.outside.z : spawn.pos.z;
      this.net?.send({
        t: 'z_spawn',
        id: z.id,
        st: spawn.type,
        wi,
        x: sx,
        z: sz,
        hp: z.health,
        spd: speed,
      });
    }
  },

  // ------------------------------------------------------------ États
  reset(resetStats = true) {
    for (const z of this.zombies) z.dispose();
    this.zombies = [];
    for (const e of this.effects) scene.remove(e.obj);
    this.effects = [];
    for (const pu of this.powerups) scene.remove(pu.grp);
    this.powerups = [];
    fx.clear();

    this.over = false;
    this.time = 0;
    if (resetStats) {
      this.points = CONFIG.player.startPoints;
      this.kills = 0;
      this.round = 0;
    }
    this.intermission = (this.isHost || !this.isMultiplayer) ? 2 : 0;
    this.toSpawn = 0;
    this.buffs.instaKill = 0;
    this.buffs.doublePoints = 0;
    this.player.reset();
  },

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.player.releaseInputs();
    document.exitPointerLock();
    hud.prompt(null);

    const btnLabel = (this.isHost || !this.isMultiplayer) ? 'REJOUER' : null;
    const subtitle = (this.isHost || !this.isMultiplayer)
      ? `Vous avez survécu jusqu'à la <b style="color:#fff">manche ${this.round}</b><br>${this.kills} zombies tués`
      : `Vous avez survécu jusqu'à la <b style="color:#fff">manche ${this.round}</b><br>En attente que l'hôte relance…`;

    hud.showOverlay('ÉQUIPE ÉLIMINÉE', subtitle, btnLabel);

    if (this.isHost) {
      this.net?.send({ t: 'game_over', round: this.round, kills: this.kills });
    }
  },

  // ----------------------------------------------------- Boucle de jeu
  update(dt) {
    this.time += dt;
    const p = this.player;

    // Le joueur local n'est contrôlable que si le pointer lock est actif
    this.player.active = this.playing;
    p.update(dt, this.time);

    // Mise à jour des coéquipiers
    for (const tm of this.remotes.values()) tm.update(dt);

    // Buffs temporaires
    if (this.buffs.instaKill > 0) this.buffs.instaKill = Math.max(0, this.buffs.instaKill - dt);
    if (this.buffs.doublePoints > 0) this.buffs.doublePoints = Math.max(0, this.buffs.doublePoints - dt);

    world.update?.(p.pos.x, p.pos.z, dt);

    // Lumière de lune suivant le joueur
    moon.target.position.set(Math.round(p.pos.x), 0, Math.round(p.pos.z));
    moon.position.copy(moon.target.position).add(MOON_OFFSET);

    // Pathfinding / champ de flux multi-joueurs (Hôte ou Solo uniquement)
    if (world.nav && (this.isHost || !this.isMultiplayer)) {
      this.navTimer = (this.navTimer ?? 0) - dt;
      if (this.navTimer <= 0) {
        const targets = [p, ...this.remotes.values()].filter((pl) => !pl.dead);
        world.nav.computeField(targets);
        this.navTimer = 0.15;
      }
    }

    // Gestion des manches (Hôte ou Solo UNIQUEMENT)
    if (this.isHost || !this.isMultiplayer) {
      const alive = this.zombies.filter((z) => !z.dead).length;
      if (this.toSpawn > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && alive < CONFIG.zombie.maxAlive) {
          this.spawnZombie();
          this.spawnTimer = Math.max(0.4, 2 - this.round * 0.1);
        }
      } else if (alive === 0 && this.round > 0 && this.intermission <= 0) {
        this.intermission = 6;
        sfx.roundEnd();
        hud.announce('MANCHE TERMINÉE', 'La prochaine arrive…', 4000);
        if (this.isHost) this.net?.send({ t: 'round_end' });
      }
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.startRound();
      }
    }

    // Zombies
    const targets = [p, ...this.remotes.values()];
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      z.update(dt, targets, this.zombies, world);
      if (z.dead && z.deathT > 4) { z.dispose(); this.zombies.splice(i, 1); continue; }
      if (!z.dead && z.spawnT <= 0) {
        z.groanT -= dt;
        if (z.groanT <= 0) {
          z.groanT = 4 + Math.random() * 6;
          const d = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
          sfx.groan(Math.max(0, 1 - d / 30));
        }
      }
    }

    // Power-ups sur le sol
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.life -= dt;
      pu.grp.rotation.y += dt * 2.8;
      pu.grp.position.y = pu.baseY + Math.sin(this.time * 3) * 0.12;

      if (!pu.pending && pu.life < 6) pu.grp.visible = Math.floor(pu.life * 6) % 2 === 0;

      // Ramassage par le joueur local
      const d = Math.hypot(p.pos.x - pu.grp.position.x, p.pos.z - pu.grp.position.z);
      if (d < 1.7) {
        if (this.isClient) {
          if (!pu.pending) { pu.pending = true; this.net?.send({ t: 'pu_pickup', id: pu.id }); }
          pu.grp.visible = false;
          continue;
        }
        this.collectPowerup(pu);
        scene.remove(pu.grp);
        this.powerups.splice(i, 1);
        continue;
      }

      if (pu.life <= 0) {
        scene.remove(pu.grp);
        this.powerups.splice(i, 1);
      }
    }

    fx.update(dt);

    // Effets visuels
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.shrink) e.obj.scale.setScalar(Math.max(0.01, e.life / e.max));
      if (e.life <= 0) {
        scene.remove(e.obj);
        e.obj.geometry.dispose();
        e.obj.material.dispose();
        this.effects.splice(i, 1);
      }
    }

    // Réanimation en continu (touche E maintenue par un joueur vivant)
    const downedTeammate = this.nearDownedTeammate();
    if (downedTeammate && !p.downed && !p.dead && p.keys['KeyE']) {
      this.reviveTarget = downedTeammate;
      this.reviveTimer += dt;
      if (this.reviveTimer >= 2.5) {
        this.reviveTimer = 0;
        this.reviveTarget = null;
        this.addPoints(250, 'bonus');
        hud.announce('RÉANIMATION !', '+250 points', 2000);
        if (this.isHost) {
          downedTeammate.dead = false;
          downedTeammate.downed = false;
          downedTeammate.health = 50;
          this.net?.send({ t: 'revive', id: downedTeammate.id });
        } else {
          this.net?.send({ t: 'revive_req', id: downedTeammate.id });
        }
      }
    } else {
      this.reviveTimer = 0;
      this.reviveTarget = null;
    }

    // ----------------- Synchronisation réseau (20 Hz)
    if (this.isMultiplayer && this.net?.connected) {
      this.netTimer -= dt;
      if (this.netTimer <= 0) {
        this.netTimer = 0.05; // 20 fois par seconde

        // Envoi de la position et de l'état du joueur local
        this.net?.send({
          t: 'p_state',
          x: Math.round(p.pos.x * 100) / 100,
          y: Math.round(p.pos.y * 100) / 100,
          z: Math.round(p.pos.z * 100) / 100,
          yaw: Math.round(p.yaw * 100) / 100,
          pitch: Math.round(p.pitch * 100) / 100,
          hp: Math.round(p.health),
          downed: p.downed,
          dead: p.dead,
          pts: this.points,
          w: p.curW.id,
        });

        // L'hôte envoie la position et l'état de tous les zombies
        if (this.isHost && this.zombies.length > 0) {
          const zdata = [];
          for (const z of this.zombies) {
            zdata.push([
              z.id,
              Math.round(z.pos.x * 100) / 100,
              Math.round(z.pos.z * 100) / 100,
              Math.round(z.yaw * 100) / 100,
              z.attacking ? 1 : 0,
            ]);
          }
          this.net?.send({ t: 'z_tick', z: zdata });
        }
      }
    }

    // Radar tactique
    const pois = (world.stations || [world.stationPos]).map((s) => ({ x: s.x, z: s.z, color: '#33ff77' }));
    if (world.doors) {
      for (const d of world.doors) if (!d.open) for (const pt of d.points) pois.push({ x: pt.x, z: pt.z, color: '#ff5533' });
    }
    if (world.wallWeapons) {
      for (const ww of world.wallWeapons) pois.push({ x: ww.pos.x, z: ww.pos.z, color: '#ffaa33' });
    }
    hud.drawRadar(p, this.zombies, pois, [...this.remotes.values()]);

    // HUD
    const curW = p.curW;
    const curCfg = p.curCfg;
    hud.setHealth(p.health, CONFIG.player.maxHealth);
    hud.setAmmo(curW.ammo, curW.reserve, curW.reloading);
    hud.setPoints(this.points);
    hud.setInventory(p.inventory, p.weaponIdx);
    hud.setPowerups(this.buffs);

    // Liste des coéquipiers
    if (this.isMultiplayer) {
      const teamList = [{ name: this.playerName, points: this.points, health: p.health, dead: p.downed || p.dead, color: slotColor(game.mySlot) }];
      for (const r of this.remotes.values()) {
        teamList.push({ name: r.name, points: r.points, health: r.health, dead: r.dead || r.downed, color: r.color });
      }
      hud.setTeammates(teamList);
    }

    // Prompt contextuel
    let promptText = null;
    if (downedTeammate) {
      const left = Math.max(0, 2.5 - this.reviveTimer).toFixed(1);
      promptText = `[E] Maintenir pour réanimer ${downedTeammate.name} (${left}s)`;
    } else if (this.nearStation()) {
      promptText = curW.reserve >= curCfg.maxReserve
        ? 'Munitions au maximum'
        : `[E] Munitions ${curCfg.name} (${curCfg.ammoPrice} pts)`;
    } else if (this.nearDoor() && !this.nearWallWeapon()) {
      const d = this.nearDoor();
      promptText = `[E] Ouvrir la porte vers ${d.name} (${d.price} pts)`;
    } else {
      const ww = this.nearWallWeapon();
      if (ww) {
        const has = p.hasWeapon(ww.id);
        const wState = has ? p.inventory.find((w) => w.id === ww.id) : null;
        if (has) {
          promptText = wState.reserve >= CONFIG.weapons[ww.id].maxReserve
            ? `${ww.name} (Munitions pleines)`
            : `[E] Munitions ${ww.name} (${ww.ammoPrice} pts)`;
        } else {
          promptText = `[E] Acheter ${ww.name} (${ww.price} pts)`;
        }
      }
    }
    hud.prompt(promptText);
  },
};

sfx.setVolume(settings.volume);
game.player = new Player(camera, scene, world, game);
hud.setWeapon(game.player.curCfg.name);

// --------------------------------------------- Multijoueur / Réseau
function addRemote(id, name, slot) {
  if (game.remotes.has(id)) return game.remotes.get(id);
  const rp = new RemotePlayer(scene, id, name, slot, game.net);
  game.remotes.set(id, rp);
  return rp;
}

function removeRemote(id) {
  const rp = game.remotes.get(id);
  if (rp) {
    rp.dispose();
    game.remotes.delete(id);
  }
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function updateLobbyUI(peers) {
  const box = hud.el.lobbyPlayers;
  if (!box) return;
  box.innerHTML = peers.map((p) => `
    <div>● <b>${esc(p.name)}</b> ${p.id === game.net?.hostId ? '<span style="color:#ffd24a">(Hôte)</span>' : ''}</div>
  `).join('');
}

function refreshLobby() {
  const peers = [{ id: game.net.id, name: game.playerName }];
  for (const r of game.remotes.values()) peers.push({ id: r.id, name: r.name });
  updateLobbyUI(peers);
}

function setupNetworkHandlers(net) {
  // Déconnexion
  net.on('disconnect', () => {
    hud.announce('DÉCONNECTÉ', 'Perte de connexion au serveur', 4000);
    if (game.isMultiplayer) setTimeout(() => { alert('Connexion au serveur perdue.'); location.reload(); }, 1500);
  });
  net.on('closed', () => {
    alert("L'hôte a fermé la partie.");
    location.reload();
  });
  net.on('left', (m) => {
    removeRemote(m.id);
    refreshLobby();
    game.checkTeamWipe();
  });

  // Nouveau joueur
  net.on('peer', (m) => {
    addRemote(m.id, m.name, m.slot);
    refreshLobby();
    sfx.buy();
    hud.announce('COÉQUIPIER', `${m.name} a rejoint !`, 2500);

    // L'hôte synchronise le nouvel arrivant
    if (game.isHost) {
      net.send({
        t: 'sync',
        started: game.started,
        round: game.round,
        toSpawn: game.toSpawn,
        intermission: game.intermission,
        buffs: game.buffs,
        doors: (world.doors || []).filter((d) => d.open).map((d) => d.id),
        zombies: game.zombies.map((z) => ({
          id: z.id,
          st: z.spawnType,
          wi: z.spawnType === 'window' ? (z.spawn.index ?? world.windowSpawns.indexOf(z.spawn)) : -1,
          x: z.pos.x,
          z: z.pos.z,
          hp: z.health,
          spd: z.speed,
          spawnT: z.spawnT,
        })),
      }, m.id);
    }
  });

  // État des autres joueurs
  net.on('p_state', (m) => {
    let rp = game.remotes.get(m.from);
    if (!rp) rp = addRemote(m.from, `Joueur ${m.from}`, m.from);
    const wasOut = rp.dead || rp.downed;
    rp.setState(m);
    if (game.isHost && !wasOut && (rp.dead || rp.downed)) game.checkTeamWipe();
  });

  // Tirs des coéquipiers (traçantes + sons)
  net.on('p_shot', (m) => {
    const o = new THREE.Vector3(m.origin.x, m.origin.y, m.origin.z);
    const e = new THREE.Vector3(m.end.x, m.end.y, m.end.z);
    game.tracer(o, e);
    const d = Math.hypot(m.origin.x - game.player.pos.x, m.origin.z - game.player.pos.z);
    if (d < 50) {
      if (m.w === 'shotgun') sfx.shotgun();
      else if (m.w === 'smg') sfx.smg();
      else sfx.shot();
    }
  });

  // Dégâts reçus
  net.on('hurt', (m) => {
    game.player.hurt(m.amount);
  });

  // Points reçus (client)
  net.on('pts', (m) => {
    game.addPoints(m.pts, m.head ? 'head' : '');
    if (m.kill) { game.kills++; sfx.kill(); }
  });

  // Zombies (spécifique client)
  net.on('z_spawn', (m) => {
    let spawn;
    if (m.st === 'window' && world.windowSpawns && m.wi >= 0) {
      spawn = world.windowSpawns[m.wi];
    } else {
      spawn = { type: 'ground', pos: new THREE.Vector3(m.x, 0, m.z) };
    }
    const onEvent = (name, z) => {
      const d = Math.hypot(z.pos.x - game.player.pos.x, z.pos.z - game.player.pos.z);
      const v = Math.max(0, 1 - d / 45);
      if (name === 'knock') sfx.knock(v);
      else if (name === 'glass') { sfx.glass(v); sfx.groan(Math.min(1, v * 1.4)); }
      else if (name === 'rumble') sfx.rumble(v);
      else if (name === 'emerge') { sfx.dirt(v); sfx.groan(Math.min(1, v * 1.4)); }
    };
    const z = new Zombie(scene, spawn, m.hp, m.spd, onEvent, m.id);
    z.net = { x: m.x, z: m.z, yaw: 0, atk: false };
    game.zombies.push(z);
  });

  net.on('z_tick', (m) => {
    const map = new Map();
    for (const z of game.zombies) map.set(z.id, z);
    for (const [id, x, z, yaw, atk] of m.z) {
      const zombie = map.get(id);
      if (zombie) {
        zombie.net = { x, z, yaw, atk: !!atk };
      }
    }
  });

  net.on('z_dead', (m) => {
    const z = game.zombies.find((zb) => zb.id === m.id);
    if (z) z.damage(999999, m.head);
  });

  net.on('z_hit', (m) => {
    if (!game.isHost) return;
    const z = game.zombies.find((zb) => zb.id === m.zid);
    if (z) {
      game.hitZombie(z, m.head, m.pt, m.dmg, m.mult, m.from);
    }
  });

  // Portes payantes : achetées par un joueur, ouvertes pour tout le monde
  net.on('door_open', (m) => { game.openDoor(m.id); });

  // Bonus
  net.on('pu_spawn', (m) => {
    game.spawnPowerup(new THREE.Vector3(m.x, 0, m.z), m.id, m.type);
  });
  net.on('pu_pickup', (m) => {
    if (!game.isHost) return;
    const idx = game.powerups.findIndex((p) => p.id === m.id);
    if (idx >= 0) {
      const pu = game.powerups[idx];
      game.collectPowerup(pu);
      scene.remove(pu.grp);
      game.powerups.splice(idx, 1);
    }
  });
  net.on('pu_collect', (m) => {
    const idx = game.powerups.findIndex((p) => p.id === m.id);
    if (idx >= 0) {
      const pu = game.powerups[idx];
      game.collectPowerup(pu, true);
      scene.remove(pu.grp);
      game.powerups.splice(idx, 1);
    }
  });

  // Manches
  net.on('round_start', (m) => {
    game.round = m.r;
    game.toSpawn = m.toSpawn;
    hud.setRound(m.r);
    sfx.roundStart();
    hud.announce(`MANCHE ${m.r}`, `${m.toSpawn} zombies`);
    if (game.player.downed || game.player.dead) game.player.revive();
  });
  net.on('round_end', () => {
    sfx.roundEnd();
    hud.announce('MANCHE TERMINÉE', 'La prochaine arrive…', 4000);
  });

  // Réanimation
  net.on('revive_req', (m) => {
    if (!game.isHost) return;
    if (m.id === net.id) {
      game.player.revive();
    } else {
      const r = game.remotes.get(m.id);
      if (r) { r.dead = false; r.downed = false; r.health = 50; }
    }
    net.send({ t: 'revive', id: m.id });
  });

  net.on('revive', (m) => {
    if (m.id === net.id) {
      game.player.revive();
    } else {
      const r = game.remotes.get(m.id);
      if (r) { r.dead = false; r.downed = false; r.health = 50; }
    }
  });

  // Synchronisation globale (pour le nouveau client qui rejoint)
  net.on('sync', (m) => {
    game.round = m.round;
    game.toSpawn = m.toSpawn;
    hud.setRound(m.round);
    game.buffs = m.buffs || game.buffs;
    for (const id of m.doors || []) game.openDoor(id, false);

    // Supprimer d'éventuels zombies locaux existants
    for (const z of game.zombies) z.dispose();
    game.zombies = [];

    for (const zd of m.zombies) {
      let spawn;
      if (zd.st === 'window' && world.windowSpawns && zd.wi >= 0) {
        spawn = world.windowSpawns[zd.wi];
      } else {
        spawn = { type: 'ground', pos: new THREE.Vector3(zd.x, 0, zd.z) };
      }
      const z = new Zombie(scene, spawn, zd.hp, zd.spd, () => {}, zd.id);
      z.pos.set(zd.x, 0, zd.z);
      if (zd.spawnT <= 0) z.skipSpawn();
      z.net = { x: zd.x, z: zd.z, yaw: 0, atk: false };
      game.zombies.push(z);
    }
  });

  // Démarrage par l'hôte
  net.on('start', () => {
    game.started = true;
    game.reset(false);
    hud.showOverlay(
      'PARTIE LANCÉE !',
      "L'hôte a lancé le combat.<br><b style='color:#ffd24a;'>Cliquez sur le bouton pour entrer en jeu !</b>",
      'COMBATTRE'
    );
  });

  net.on('restart', () => {
    game.started = true;
    game.reset(true);
    hud.showOverlay(
      'NOUVELLE PARTIE',
      "L'hôte a relancé la partie.<br><b style='color:#ffd24a;'>Cliquez pour continuer !</b>",
      'REPRENDRE'
    );
  });

  net.on('game_over', (m) => {
    game.over = true;
    game.player.releaseInputs();
    document.exitPointerLock();
    hud.prompt(null);
    hud.showOverlay(
      'ÉQUIPE ÉLIMINÉE',
      `Vous avez survécu jusqu'à la <b style="color:#fff">manche ${m.round || game.round}</b><br>En attente que l'hôte relance…`,
      null
    );
  });
}

// --------------------------------------------- Menu / Pointer lock
const canvas = renderer.domElement;

function lockAndPlay() {
  sfx.init();
  if (game.over) {
    if (game.isHost || !game.isMultiplayer) {
      game.reset(true);
      if (game.isHost) game.net?.send({ t: 'restart' });
    }
  }
  const req = canvas.requestPointerLock();
  if (req && req.catch) req.catch(() => {});
}

// Clic direct sur le canvas en cours de partie pour reprendre le contrôle
canvas.addEventListener('click', () => {
  if (game.started && !game.over && document.pointerLockElement !== canvas) {
    lockAndPlay();
  }
});

// Clics sur le bouton d'overlay (PAUSE / REJOUER / ENTRER EN JEU)
hud.el.ovBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  lockAndPlay();
});

// Nom du joueur
hud.el.playerName.value = game.playerName;
hud.el.playerName.addEventListener('input', (e) => {
  game.playerName = e.target.value.trim() || 'Joueur';
  localStorage.setItem('zombie_name', game.playerName);
});

// Mode Solo
hud.el.btnSolo.addEventListener('click', (e) => {
  e.stopPropagation();
  game.isMultiplayer = false;
  game.isHost = true;
  game.isClient = false;
  game.started = true;
  hud.setRoomBadge(null);
  hud.hideOverlay();
  game.reset(true);
  lockAndPlay();
});

// Créer salon Co-op (Hôte)
hud.el.btnHost.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    const net = new Net();
    await net.connect();
    game.net = net;
    setupNetworkHandlers(net);

    net.on('joined', (m) => {
      net.id = m.id;
      game.mySlot = m.slot || 0;
      net.hostId = m.host;
      game.isHost = true;
      game.isClient = false;
      game.isMultiplayer = true;
      game.roomCode = m.code;

      hud.setRoomBadge(m.code);
      hud.el.lobbyBox.classList.remove('hidden');
      hud.el.lobbyStatus.innerHTML = `SALON CRÉÉ ! CODE : <b style="color:#fff; font-size:24px;">${m.code}</b>`;
      hud.el.btnStartGame.classList.remove('hidden');
      updateLobbyUI(m.peers);
    });

    net.send({ t: 'create', name: game.playerName });
  } catch (err) {
    alert("Impossible d'héberger le salon : " + err.message);
  }
});

// Rejoindre salon (Client)
hud.el.btnJoin.addEventListener('click', async (e) => {
  e.stopPropagation();
  const code = (hud.el.joinCode.value || '').toUpperCase().trim();
  if (code.length < 4) { alert('Veuillez entrer un code de 4 lettres.'); return; }

  try {
    const net = new Net();
    await net.connect();
    game.net = net;
    setupNetworkHandlers(net);

    net.on('error', (m) => { alert(m.msg || 'Erreur salon.'); });

    net.on('joined', (m) => {
      net.id = m.id;
      game.mySlot = m.slot || 0;
      net.hostId = m.host;
      game.isHost = false;
      game.isClient = true;
      game.isMultiplayer = true;
      game.roomCode = m.code;

      // Vide les zombies locaux
      for (const z of game.zombies) z.dispose();
      game.zombies = [];

      hud.setRoomBadge(m.code);
      hud.el.lobbyBox.classList.remove('hidden');
      hud.el.lobbyStatus.innerHTML = `SALON REJOINT : <b style="color:#fff;">${m.code}</b>`;
      hud.el.btnStartGame.classList.add('hidden');
      updateLobbyUI(m.peers);

      // Crée les coéquipiers déjà présents
      for (const p of m.peers) {
        if (p.id !== net.id) addRemote(p.id, p.name, p.slot);
      }

      if (m.started) {
        game.started = true;
        hud.showOverlay(
          'PARTIE EN COURS',
          "Le combat a déjà commencé !<br><b style='color:#ffd24a'>Cliquez pour rejoindre vos coéquipiers !</b>",
          'REJOINDRE LE COMBAT'
        );
      } else {
        hud.el.lobbyStatus.innerHTML += `<div style="font-size:15px; color:#aaa; margin-top:6px;">En attente que l'hôte lance la partie…</div>`;
      }
    });

    net.send({ t: 'join', code, name: game.playerName });
  } catch (err) {
    alert('Impossible de rejoindre : ' + err.message);
  }
});

// Lancer la partie (Hôte)
hud.el.btnStartGame.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!game.isHost) return;
  game.started = true;
  game.net.send({ t: 'start' });
  hud.hideOverlay();
  game.reset(false);
  lockAndPlay();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    game.playing = true;
    hud.hideOverlay();
  } else if (game.started && !game.over) {
    game.playing = false;
    game.player.releaseInputs();
    hud.showOverlay('PAUSE', game.isMultiplayer ? 'La partie continue pour vos coéquipiers.' : 'Jeu en pause.', null);
    hud.showPanel('pausePanel');
  }
});

// --------------------------------------------- Menus : titre / options / pause
let optionsBack = 'titlePanel';

const optInputs = {
  brightness: document.getElementById('optBrightness'),
  fov: document.getElementById('optFov'),
  sens: document.getElementById('optSens'),
  volume: document.getElementById('optVolume'),
};
const optFormat = {
  brightness: (v) => `${Math.round(v * 100)}%`,
  fov: (v) => `${Math.round(v)}°`,
  sens: (v) => `${(+v).toFixed(2)}x`,
  volume: (v) => `${Math.round(v * 100)}%`,
};
for (const [key, input] of Object.entries(optInputs)) {
  input.value = settings[key];
  input.nextElementSibling.textContent = optFormat[key](settings[key]);
  input.addEventListener('input', () => {
    settings[key] = parseFloat(input.value);
    input.nextElementSibling.textContent = optFormat[key](settings[key]);
    applyVisualSettings();
    sfx.setVolume(settings.volume);
    try { localStorage.setItem('zombie_settings', JSON.stringify(settings)); } catch {}
  });
}

function openOptions(back) {
  optionsBack = back;
  hud.showPanel('optionsPanel');
}

hud.el.titlePanel.addEventListener('click', (e) => e.stopPropagation());
hud.el.pausePanel.addEventListener('click', (e) => e.stopPropagation());
hud.el.optionsPanel.addEventListener('click', (e) => e.stopPropagation());
document.getElementById('btnPlay').addEventListener('click', () => hud.showPanel('menuPanel'));
document.getElementById('btnOptions').addEventListener('click', () => openOptions('titlePanel'));
document.getElementById('btnPauseOptions').addEventListener('click', () => openOptions('pausePanel'));
document.getElementById('btnOptBack').addEventListener('click', () => hud.showPanel(optionsBack));
document.getElementById('btnResume').addEventListener('click', () => lockAndPlay());
document.getElementById('btnModeBack').addEventListener('click', (e) => {
  e.stopPropagation();
  // Un salon déjà créé/rejoint doit être quitté avant de revenir au menu principal.
  if (game.net) { game.net.close(); location.reload(); return; }
  hud.showPanel('titlePanel');
});
document.getElementById('btnQuit').addEventListener('click', () => {
  if (confirm('Quitter la partie et revenir au menu principal ?')) location.reload();
});

game.reset(true);
hud.showMenu('ZOMBIE SURVIVAL', `${world.mapName}<br>Survivez seul ou en coopération.`);

// Mode debug : ?debug&x=0&z=0&yaw=0&pitch=0
const q = new URLSearchParams(location.search);
if (q.has('debug')) {
  const pl = game.player;
  if (q.has('x')) pl.pos.x = parseFloat(q.get('x'));
  if (q.has('z')) pl.pos.z = parseFloat(q.get('z'));
  if (q.has('yaw')) pl.yaw = parseFloat(q.get('yaw'));
  if (q.has('pitch')) pl.pitch = parseFloat(q.get('pitch'));
  game.started = true;
  game.playing = true;
  hud.hideOverlay();
  console.log('[DBG] windowSpawns=', world.windowSpawns?.length, 'groundSpawns=', world.spawnPoints.length);

  const adv = (z, t) => { for (let k = 0; k < Math.round(t / 0.05); k++) z.update(0.05, [pl], game.zombies, world); };
  const fwd = (d, side = 0) => ({ x: pl.pos.x - Math.sin(pl.yaw) * d + Math.cos(pl.yaw) * side, z: pl.pos.z - Math.cos(pl.yaw) * d - Math.sin(pl.yaw) * side });
  if (q.has('zw') && world.windowSpawns?.length) {
    const wins = [...world.windowSpawns].sort((a, b) => Math.hypot(a.outside.x - pl.pos.x, a.outside.z - pl.pos.z) - Math.hypot(b.outside.x - pl.pos.x, b.outside.z - pl.pos.z));
    const w = wins[parseInt(q.get('wi') || '0')];
    pl.pos.x = w.outside.x + w.nx * 4.5; pl.pos.z = w.outside.z + w.nz * 4.5;
    pl.yaw = Math.atan2(w.nx, w.nz); pl.pitch = -0.05;
    const z = new Zombie(scene, w, 100, 2, () => {});
    game.zombies.push(z);
    adv(z, parseFloat(q.get('zw')));
  }
  if (q.has('zg')) {
    const f = fwd(4);
    const z = new Zombie(scene, { type: 'ground', pos: new THREE.Vector3(f.x, 0, f.z) }, 100, 2, () => {});
    game.zombies.push(z);
    adv(z, parseFloat(q.get('zg')));
  }
  if (q.has('zn')) {
    const n = parseInt(q.get('zn'));
    for (let i = 0; i < n; i++) {
      const f = fwd(3 + i * 1.6, (i % 2 ? 1 : -1) * (0.8 + i * 0.3));
      const z = new Zombie(scene, { type: 'ground', pos: new THREE.Vector3(f.x, 0, f.z) }, 100, 2, () => {});
      game.zombies.push(z);
      adv(z, 4.5);
    }
  }
}

// ------------------------------------------------------------- Boucle
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  // Solo : le menu pause fige le jeu. En multijoueur la partie continue.
  const frozen = !game.isMultiplayer && !game.playing && game.started && !game.over && !q.has('debug');
  if (game.started && !game.over && !frozen) game.update(dt);
  hud.update(dt);
  renderer.render(scene, camera);
}
frame();

window.game = game;
game.scene = scene; // accès console / outils de test
