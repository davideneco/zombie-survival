import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildWorld } from './world.js';
import { buildRealWorld } from './realworld.js';
import { Player } from './player.js';
import { Zombie, zombieTextures } from './zombie.js';
import { Boss } from './boss.js';
import { installFinale } from './finale.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { fx } from './fx.js';
import { Net } from './net.js';
import { RemotePlayer, slotColor } from './remote.js';
import { CHARACTERS, Avatar, charOf, renderPortraits } from './characters.js';
import { makeTeddy } from './machines.js';
import { installMachineFx } from './machineFx.js';
import { installVehicles } from './vehicles.js';
import { wreckMaterial } from './vehicleModels.js';
import { installLauncher } from './launcher.js';
import { makeDisplay } from './weaponDisplay.js';

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
scene.fog = new THREE.FogExp2(0x0b121c, CONFIG.map === 'arena' ? 0.022 : 0.019);

// au-delà de ~150 m le brouillard cache tout : inutile de dessiner plus loin
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 170);

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
const DEFAULT_SETTINGS = { brightness: 1.4, fov: 80, sens: 1, volume: 1, music: 0.5, quality: 1, tpVehicle: true }; // tpVehicle : vue à la troisième personne sur une moto (touche V)
const settings = { ...DEFAULT_SETTINGS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('zombie_settings') || '{}')); } catch {}

// Qualité : 0 = performances (résolution réduite, pas d'ombres), 1 = équilibrée, 2 = haute (pleine résolution des écrans HD)
let appliedQuality = null;
function applyVisualSettings() {
  renderer.toneMappingExposure = 1.3 * settings.brightness;
  hemi.intensity = 1.1 * settings.brightness;
  const q = settings.quality ?? 1;
  if (q === appliedQuality) return;
  appliedQuality = q;
  renderer.setPixelRatio(q === 0 ? 0.75 : q === 1 ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const size = q === 2 ? 2048 : 1024;
  if (moon.shadow.mapSize.x !== size) { moon.shadow.mapSize.set(size, size); moon.shadow.map?.dispose(); moon.shadow.map = null; }
  renderer.shadowMap.enabled = q > 0;
  renderer.shadowMap.type = q === 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; // ombres douces seulement en qualité haute
  renderer.shadowMap.autoUpdate = false; // mise à jour pilotée par la boucle (une image sur deux hors qualité haute)
  scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); // les shaders changent avec les ombres
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

// Géométries / matériaux partagés (créer un matériau en pleine partie coûte une initialisation de shader)
const HALO_GEO = new THREE.SphereGeometry(0.6, 12, 10);
const JERRY_GEO = new THREE.BoxGeometry(0.34, 0.46, 0.16);
const JERRY_NECK = new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8);
const JERRY_HANDLE = new THREE.BoxGeometry(0.1, 0.06, 0.05);
const NADE_GEO = new THREE.SphereGeometry(0.09, 10, 8);
const NADE_MAT = new THREE.MeshStandardMaterial({ color: 0x2f3b1f, roughness: 0.6, metalness: 0.4 });
const TRACER_MATS = new Map();

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
  grenadesLive: [],
  boxMove: null,
  finale: null,
  finaleDone: false,
  boxUses: 0,
  boxLimit: 10,
  relocateTimer: 0,
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
  charPref: Math.max(0, Math.min(CHARACTERS.length - 1, parseInt(localStorage.getItem('zombie_char') || '0', 10) || 0)), // personnage choisi dans le menu
  remotes: new Map(), // pid -> RemotePlayer
  netTimer: 0,
  reviveTimer: 0,
  reviveTarget: null,

  saveSettings() { try { localStorage.setItem('zombie_settings', JSON.stringify(settings)); } catch {} },

  // Personnage du joueur local (celui des coéquipiers voient) : le choix du menu en solo, l'emplacement attribué en salon
  localCharacter() { return charOf(this.isMultiplayer ? this.mySlot : this.charPref); },

  // Touche V sur une moto : bascule troisième / première personne, mémorisée
  toggleVehicleView() {
    settings.tpVehicle = settings.tpVehicle === false;
    this.saveSettings();
    hud.popup(settings.tpVehicle ? 'VUE : 3E PERSONNE' : 'VUE : 1RE PERSONNE', 'bonus');
  },

  hitTargets() {
    const list = world.blockers.slice();
    for (const z of this.zombies) if (z.targetable) list.push(...z.meshes);
    return list;
  },

  // Bruit de tir (chaque arme a le sien) ; v : volume, dist : distance de la source en mètres
  weaponSound(id, v = 1, dist = 0) {
    sfx.gun(id, v, dist);
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
    if (this.buffs.instaKill > 0 && !z.boss) damage = 999999;
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
      // Chance d'apparition d'un bonus COD ; le Bourreau, lui, lâche toujours des munitions max
      this.onFinaleKill(z);
      this.maybeDropFuel(z.pos); // bidon d'essence (rare, seulement si une moto est à moitié vide)
      if (z.isBoss) this.spawnPowerup(z.pos, null, 'max_ammo');
      else if (Math.random() < CONFIG.powerups.dropChance) this.spawnPowerup(z.pos);
    }
    return killed; // (client : undefined, l'hôte tranche)
  },

  impact(point, color = 0xcccccc) {
    if (color === 0xcccccc) fx.dust(point.x, point.y, point.z);
    else fx.blood(point.x, point.y, point.z, false);
  },

  tracer(from, to, color = 0xffdd88) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    let mat = TRACER_MATS.get(color);
    if (!mat) { mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }); TRACER_MATS.set(color, mat); }
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    this.effects.push({ obj: line, life: 0.05, max: 0.05, sharedMat: true });
  },

  // extra : { tc: couleur de la traînée, nt: 1 = pas de traînée (projectile) }
  onPlayerShot(origin, end, weaponId, extra = {}) {
    if (!this.isMultiplayer) return;
    this.net?.send({
      t: 'p_shot',
      origin: { x: origin.x, y: origin.y, z: origin.z },
      end: { x: end.x, y: end.y, z: end.z },
      w: weaponId,
      ...extra,
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

  // ------------------------------------------------------------- Étages (cathédrale)
  // Région (étage) de chaque joueur : tregion = étage « utile » (un joueur sur un escalier compte pour l'extrémité la plus proche)
  updateLevels() {
    const lv = world.levels;
    if (!lv || !lv.links.length) return;
    const p = this.player;
    p.tregion = lv.endRegion(p.region || 0, p.pos.x, p.pos.z, p.pos.y);
    for (const r of this.remotes.values()) {
      r.region = lv.regionAt(r.pos.x, r.pos.z, r.pos.y);
      r.tregion = lv.endRegion(r.region, r.pos.x, r.pos.z, r.pos.y);
    }
  },
  // Sources du champ de flux d'un étage : les joueurs qui y sont, et le pied de l'escalier qui mène aux autres
  fieldTargets(region, players) {
    const lv = world.levels;
    if (!lv || !lv.links.length) return players;
    const out = [];
    for (const pl of players) {
      const pr = pl.tregion || 0;
      if (pr === region) { out.push(pl); continue; }
      const hop = lv.nextHop(region, pr);
      if (!hop) continue;
      const L = hop.link, e = hop.dir > 0 ? L.path[0] : L.path[L.path.length - 1];
      out.push({ x: e[0], z: e[2] });
    }
    return out;
  },
  // Champs de flux des étages où se trouvent des zombies (grilles petites : calcul complet toutes les 0,3 s)
  updateRegionFields(dt, players) {
    const lv = world.levels;
    if (!lv || !lv.links.length) return;
    this.regionFieldT = (this.regionFieldT || 0) - dt;
    if (this.regionFieldT > 0) return;
    this.regionFieldT = 0.3;
    const used = new Set();
    for (const z of this.zombies) if (!z.dead && z.region) used.add(z.region);
    for (const r of used) {
      const reg = lv.regions[r];
      if (!reg.nav) continue;
      const t = this.fieldTargets(r, players);
      if (t.length) reg.nav.computeField(t);
    }
  },

  // Zombies coincés dans le décor ou partis trop loin : on les fait réapparaître près des joueurs (hôte)
  relocateZombies(dt, targets) {
    this.relocateTimer -= dt;
    if (this.relocateTimer > 0 || !targets.length || !world.pickGround) return;
    this.relocateTimer = 1;
    const groundTargets = targets.filter((t) => !t.tregion);
    if (!groundTargets.length) return;
    targets = groundTargets;
    for (const z of this.zombies) {
      if (z.dead || z.spawnT > 0 || z.region || z.link || z.isBoss) continue;
      let near = Infinity;
      for (const t of targets) near = Math.min(near, Math.hypot(t.pos.x - z.pos.x, t.pos.z - z.pos.z));
      z.farT = near > 90 ? (z.farT || 0) + 1 : 0;
      const stuck = z.noProgress > 5 && near > 12;
      if (!stuck && z.farT < 4) continue;
      const t = targets[Math.floor(Math.random() * targets.length)];
      const g = world.pickGround(t.pos.x, t.pos.z, 22, 45);
      if (!g) continue;
      z.pos.set(g.x, 0, g.z);
      z.noProgress = 0; z.farT = 0;
    }
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
    if (type === 'fuel') col = 0xb81208; // jerrican rouge (bonus d'essence des motos)

    const baseGeo = type === 'fuel' ? JERRY_GEO : new THREE.DodecahedronGeometry(0.35);
    const baseMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: type === 'fuel' ? 0.25 : 1.2, // le bidon reste bien rouge (une forte émission le délave en rose)
      roughness: 0.3,
    });
    const m = new THREE.Mesh(baseGeo, baseMat);
    grp.add(m);
    if (type === 'fuel') { // bidon d'essence : corps, goulot et poignée
      const nz = new THREE.Mesh(JERRY_NECK, baseMat); nz.position.set(0.1, 0.27, 0); grp.add(nz);
      const hd = new THREE.Mesh(JERRY_HANDLE, baseMat); hd.position.set(-0.07, 0.27, 0); grp.add(hd);
    }

    // halo lumineux (pas de PointLight : ajouter/cacher une lumière fait recompiler tous les shaders)
    const halo = new THREE.Mesh(HALO_GEO, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: type === 'fuel' ? 0.16 : 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.9);
    grp.add(halo);

    grp.position.set(pos.x, (pos.y || 0) + 0.9, pos.z);
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

  collectPowerup(p, byRemote = false, pid = null) {
    sfx.powerup();
    if (p.type === 'fuel') {
      // l'hôte répartit l'essence (moto du ramasseur, sinon la plus vide) ; les autres reçoivent v_fuel
      if (!byRemote && !this.isClient) this.hostFuelPickup(pid ?? (this.net?.id ?? 0));
      hud.announce('ESSENCE !', `Bidon : +${CONFIG.vehicles.fuel.jerrican} L`.replace('.', ','), 2200);
      hud.popup('+2,5 L ESSENCE', 'bonus');
    } else if (p.type === 'max_ammo') {
      for (const w of this.player.inventory) {
        w.reserve = this.player.statsOf(w).maxReserve;
      }
      this.player.grenades = CONFIG.grenade.max;
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
          if (z.dead || z.boss) continue;
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

    // 0) Sur une moto : E descend
    if (p.vehicle) { this.leaveVehicle(); return; }

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

    // 3) Machines : atouts, Pack-a-Punch, boîte mystère
    const m = this.nearMachine();
    if (m) { this.useMachine(m); return; }

    // 4) Armes au mur (prioritaires sur une porte toute proche)
    const ww = this.nearWallWeapon();
    if (ww) {
      const cur = p.inventory.find((w) => w.id === ww.id);
      if (cur) {
        const max = p.statsOf(cur).maxReserve;
        if (cur.reserve >= max) return;
        const price = cur.pap ? ww.ammoPrice * 3 : ww.ammoPrice;
        if (this.points < price) { sfx.deny(); return; }
        this.points -= price;
        cur.reserve = max;
        sfx.buy();
      } else {
        if (this.points < ww.price) { sfx.deny(); return; }
        this.points -= ww.price;
        p.giveWeapon(ww.id);
        sfx.buy();
        hud.announce(ww.name, 'Arme acquise !', 2000);
      }
      return;
    }

    // 4b) Borne du parking (à plus de 2,4 m de toute place de moto : jamais en concurrence avec « monter »)
    const np = this.nearPump();
    if (np) { this.usePump(np); return; }

    // 5) Moto : monter (avant la porte : les motos sont posées loin des portes)
    const nv = this.nearVehicle();
    if (nv) { this.tryMount(nv.v, nv.seat); return; }

    // 6) Porte payante
    const door = this.nearDoor();
    if (door) {
      if (this.points < door.price) { sfx.deny(); return; }
      this.points -= door.price;
      this.openDoor(door.id);
      if (this.isMultiplayer) this.net?.send({ t: 'door_open', id: door.id });
    }
  },

  reviveTime() { return this.player.perks.quickrevive ? 1.2 : 2.5; },

  nearMachine() {
    if (!world.machines) return null;
    const p = this.player.pos;
    for (const m of world.machines) {
      if (m.type === 'box' && (!m.active || this.boxMove)) continue; // une seule boîte, et pas pendant son déplacement
      if (Math.hypot(p.x - m.pos.x, p.z - m.pos.z) < 2.6) return m;
    }
    return null;
  },

  perkPrice(id) {
    const P = CONFIG.perks[id];
    return !this.isMultiplayer && P.soloPrice ? P.soloPrice : P.price;
  },

  machinePrompt(m) {
    const p = this.player;
    if (m.type === 'clock') return this.finalePrompt(m);
    if (m.type === 'perk') {
      if (p.perks[m.id]) return `${m.name} (déjà acquis)`;
      return `[E] ${m.name} — ${CONFIG.perks[m.id].desc} (${this.perkPrice(m.id)} pts)`;
    }
    if (m.type === 'pap') return this.papPrompt(m);
    return this.boxPrompt(m);
  },

  useMachine(m) {
    const p = this.player;
    if (m.type === 'clock') {
      const F = CONFIG.finale;
      if (this.finale || this.finaleDone || this.round < F.minRound) { sfx.deny(); return; }
      if (this.points < F.price) { sfx.deny(); return; }
      this.points -= F.price;
      if (this.isClient) this.net?.send({ t: 'finale_req' });
      else this.startFinale();
      return;
    }
    if (m.type === 'perk') {
      if (p.perks[m.id]) return;
      const price = this.perkPrice(m.id);
      if (this.points < price) { sfx.deny(); return; }
      this.points -= price;
      p.addPerk(m.id);
      sfx.jingle();
      hud.announce(m.name, CONFIG.perks[m.id].desc, 2500);
      return;
    }
    if (m.type === 'pap') {
      if (this.papAnim?.machine === m) { this.takePap(); return; }
      this.buyPap();
      return;
    }
    if (this.boxRoll?.machine === m) { this.takeBoxWeapon(); return; }
    this.buyBox();
  },

  // ---------------------------------------------------------- Boîte mystère : une seule, qui se déplace
  // Compte un tirage (hôte / solo). Retourne true si ce tirage donne le nounours (la boîte va partir).
  countBoxUse() {
    this.boxUses++;
    const teddy = this.boxUses >= this.boxLimit;
    if (this.isHost) this.net?.send({ t: 'box_state', uses: this.boxUses });
    return teddy;
  },
  // L'hôte choisit le prochain emplacement et prévient tout le monde
  hostMoveBox() {
    const boxes = world.boxes || [];
    if (boxes.length < 2) return;
    const cur = boxes.findIndex((b) => b.active);
    let next = cur;
    while (next === cur) next = Math.floor(Math.random() * boxes.length);
    this.boxUses = 0;
    this.boxLimit = 1 + Math.floor(Math.random() * CONFIG.box.maxUses);
    this.net?.send({ t: 'box_move', idx: next });
    this.startBoxMove(next);
  },
  // Animation : le nounours apparaît, la boîte s'envole puis réapparaît ailleurs
  startBoxMove(next) {
    const from = (world.boxes || []).find((b) => b.active);
    if (!from) { world.setActiveBox?.(next); return; }
    const teddy = makeTeddy();
    teddy.position.set(0, 0.9, 0);
    from.group.add(teddy);
    this.boxMove = { t: 0, from, next, teddy };
    sfx.nuke?.();
  },
  updateBoxMove(dt) {
    const mv = this.boxMove;
    if (!mv) return;
    mv.t += dt;
    mv.teddy.rotation.y += dt * 3;
    mv.teddy.position.y = 0.9 + Math.min(1, mv.t) * 0.6;
    if (mv.t > 1.2) { mv.from.group.position.y = (mv.t - 1.2) ** 2 * 6; mv.from.group.rotation.y += dt * 2 * (mv.t - 1.2); }
    if (mv.t < 3.4) return;
    mv.from.group.remove(mv.teddy);
    mv.from.group.rotation.y = Math.atan2(world.zoneCenters[mv.from.zone].x - mv.from.pos.x, world.zoneCenters[mv.from.zone].z - mv.from.pos.z);
    world.setActiveBox(mv.next);
    const nb = world.boxes[mv.next];
    hud.announce('BOÎTE MYSTÈRE', `Elle est réapparue : ${world.zoneNames[nb.zone]}`, 3500);
    this.boxMove = null;
  },
  resetBox() {
    if (!world.boxes) return;
    world.setActiveBox(Math.max(0, world.boxes.findIndex((b) => b.zone === world.startZone)));
    this.boxUses = 0;
    this.boxLimit = 1 + Math.floor(Math.random() * CONFIG.box.maxUses);
    if (this.boxMove) { this.boxMove.from.group.remove(this.boxMove.teddy); this.boxMove = null; }
  },

  // ---------------------------------------------------------- Grenades / explosions
  throwGrenade(origin, vel, mine, fromPid = null) {
    const mesh = new THREE.Mesh(NADE_GEO, NADE_MAT);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    this.grenadesLive.push({ mesh, pos: origin.clone(), vel: vel.clone(), t: CONFIG.grenade.fuse, mine, owner: mine ? null : fromPid });
    if (mine && this.isMultiplayer) {
      this.net?.send({ t: 'nade', o: { x: origin.x, y: origin.y, z: origin.z }, v: { x: vel.x, y: vel.y, z: vel.z } });
    }
  },

  updateGrenades(dt) {
    const G = 18;
    for (let i = this.grenadesLive.length - 1; i >= 0; i--) {
      const g = this.grenadesLive[i];
      g.t -= dt;
      g.vel.y -= G * dt;
      const before = g.pos.clone();
      g.pos.addScaledVector(g.vel, dt);
      // rebonds sur les murs : on se sert de la collision du monde pour trouver la normale
      const pushed = g.pos.clone();
      world.collide(pushed, 0.12);
      const nx = pushed.x - g.pos.x, nz = pushed.z - g.pos.z, l = Math.hypot(nx, nz);
      if (l > 1e-4) {
        const ux = nx / l, uz = nz / l, dot = g.vel.x * ux + g.vel.z * uz;
        if (dot < 0) { g.vel.x -= 1.6 * dot * ux; g.vel.z -= 1.6 * dot * uz; }
        g.pos.x = pushed.x; g.pos.z = pushed.z;
      }
      const gy = world.floorAt ? world.floorAt(g.pos.x, g.pos.z, g.pos.y + 0.3, this._gfl || (this._gfl = { y: 0, region: 0 })).y + 0.09 : 0.09;
      if (g.pos.y < gy) { g.pos.y = gy; g.vel.y = Math.abs(g.vel.y) * 0.35; g.vel.x *= 0.6; g.vel.z *= 0.6; if (g.vel.y < 0.6) g.vel.y = 0; }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 8;
      if (Number.isNaN(before.x)) g.t = 0;
      if (g.t <= 0) {
        scene.remove(g.mesh);
        this.grenadesLive.splice(i, 1);
        this.explode(g.pos, CONFIG.grenade.radius, CONFIG.grenade.damage, g.mine ? null : g.owner, 0xff8a2a, true);
      }
    }
  },

  // Explosion : effets pour tout le monde ; dégâts aux zombies calculés par l'hôte (ou en solo).
  // owner : id du joueur distant à récompenser, null = joueur local.
  // self : dégâts maximaux au joueur local (décroissent avec la distance) ; true = ceux des grenades ; faux = aucun
  // (le M79 ne blesse que son tireur, une grenade blesse tout le monde). src : origine des dégâts reçus ('blast').
  explode(pos, radius, damage, owner, color, self = false, src = 'blast') {
    fx.explosion(pos.x, pos.y, pos.z, radius, color);
    const p = this.player;
    const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
    sfx.explosion?.(Math.max(0.1, 1 - d / 60));
    if (d < radius * 1.8) p.recoil += 0.04 * (1 - d / (radius * 1.8));
    if (self && d < radius && !p.downed && !p.dead) p.hurt((self === true ? CONFIG.grenade.selfDamage : self) * (1 - d / radius), src);
    if (this.isClient) return;
    this.areaDamage(pos, radius, damage, owner);
    this.damageVehiclesInRadius?.(pos, radius, damage); // les motos : 10 % des dégâts infligés aux zombies (hôte)
  },

  // Dégâts de zone sur les zombies (hôte / solo) ; les survivants peuvent perdre leurs jambes
  areaDamage(pos, radius, damage, owner) {
    let kills = 0, pts = 0;
    const mult = this.buffs.doublePoints > 0 ? 2 : 1;
    for (const z of this.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const d = Math.hypot(z.pos.x - pos.x, z.pos.z - pos.z);
      if (d > radius) continue;
      if (Math.abs(z.pos.y + 1 - pos.y) > 2.5) continue; // pas à travers le plafond ou le plancher (z.pos.y = pieds, +1 = torse)
      const dmg = this.buffs.instaKill > 0 && !z.boss ? 999999 : damage * Math.pow(1 - d / radius, 0.6);
      const killed = z.damage(dmg, false);
      fx.blood(z.pos.x, 1, z.pos.z, killed);
      if (killed) {
        kills++; pts += 60 * mult;
        if (this.isMultiplayer) this.net?.send({ t: 'z_dead', id: z.id, head: false });
        this.onFinaleKill(z);
        this.maybeDropFuel(z.pos);
        if (z.isBoss) this.spawnPowerup(z.pos, null, 'max_ammo');
        else if (Math.random() < CONFIG.powerups.dropChance) this.spawnPowerup(z.pos);
      } else {
        pts += 10 * mult;
        if (!z.crawler && Math.random() < CONFIG.zombie.legBlowChance) {
          z.makeCrawler();
          if (this.isMultiplayer) this.net?.send({ t: 'z_crawl', id: z.id });
        }
      }
    }
    if (!pts || owner === false) return; // owner === false : personne à récompenser (moto sans conducteur qui explose)
    if (owner != null) this.net?.send({ t: 'pts', pts, kill: kills > 0, kills }, owner);
    else { this.kills += kills; if (kills) sfx.kill(); this.addPoints(pts); }
  },

  // Impact explosif d'une arme (pistolet à rayons, carreau explosif de l'arbalète) : l'effet est vu par tout le monde,
  // les dégâts sont calculés par l'hôte (un client lui envoie `splash`, l'hôte relaie l'effet aux autres par `boom`)
  splash(point, radius, damage, color = 0x44ff66) {
    fx.explosion(point.x, point.y, point.z, radius, color);
    const pt = { x: point.x, y: point.y, z: point.z };
    if (this.isClient) {
      this.net?.send({ t: 'splash', pt, r: radius, dmg: damage, c: color });
      return;
    }
    this.areaDamage(point, radius, damage, null);
    if (this.isMultiplayer) this.net?.send({ t: 'boom', pt, r: radius, c: color });
  },

  // PHD Flopper : onde explosive aux pieds du joueur à l'atterrissage (Player.onLand). Dégâts aux zombies seulement (aucun aux joueurs) :
  // le joueur calcule les dégâts de la manche, l'hôte les applique et attribue les points (splash), les autres machines montrent l'effet.
  flop(pos) {
    const F = CONFIG.phd;
    this.splash(new THREE.Vector3(pos.x, pos.y, pos.z), F.radius, F.base + F.perRound * Math.max(1, this.round), F.color);
    sfx.explosion?.(0.7);
    this.shake = Math.max(this.shake || 0, 0.45);
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
    // première ouverture de la zone du parking des motos : on l'annonce (le « P » bleu de la carte indique l'endroit)
    const pk = world.parking, firstPark = !!pk && !this.parkingSeen && (d.a === pk.zone || d.b === pk.zone);
    if (firstPark) this.parkingSeen = true;
    if (announce) {
      if (firstPark) hud.announce(`PARKING ${pk.name.replace(/^Place /, '').toUpperCase()} — ${pk.size} motos`, 'Repérez le « P » bleu sur la carte [M]', 4500);
      else hud.announce('PORTE OUVERTE', `Accès à ${d.name}`, 2500);
    }
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
    this.zombieSpeed = Math.min(CONFIG.zombie.speedStart + r * CONFIG.zombie.speedPerRound, CONFIG.zombie.speedMax);
    this.spawnTimer = 1;
    hud.setRound(r);
    sfx.roundStart();
    hud.announce(`MANCHE ${r}`, `${this.toSpawn} zombies`);

    // Réanime le joueur s'il était à terre lors de la manche précédente
    if (this.player.downed || this.player.dead) this.player.revive();
    this.player.grenades = Math.min(CONFIG.grenade.max, this.player.grenades + CONFIG.grenade.perRound);

    if (this.isHost) {
      this.net?.send({ t: 'round_start', r, toSpawn: this.toSpawn });
    }
    if (!this.isClient) this.hostRespawnCheck?.(); // motos détruites : retour au parking (hôte)
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

  spawnZombie(extra = false) {
    const spawn = this.pickSpawn();
    const Zc = CONFIG.zombie;
    // chevalier de fer : dans la zone de l'Homme de Fer, à partir de la manche fromRound, `chance` de chance, maxAlive en vie
    // au plus. L'hôte tire au sort (z_spawn porte kind) ; le zombie n'est ni coureur ni rampant.
    const IK = Zc.ironKnight, sx0 = spawn.type === 'window' ? spawn.outside.x : spawn.pos.x, sz0 = spawn.type === 'window' ? spawn.outside.z : spawn.pos.z;
    const knight = !!IK && this.round >= IK.fromRound && !!world.zoneOf && world.zoneNames[world.zoneOf(sx0, sz0)] === IK.zone
      && this.zombies.filter((q) => q.ironKnight && !q.dead).length < IK.maxAlive && Math.random() < IK.chance;
    let speed = this.zombieSpeed * (0.85 + Math.random() * 0.3);
    if (!knight && this.round >= Zc.runnerRound && Math.random() < Zc.runnerChance) speed *= Zc.runnerMult; // coureur
    const onEvent = (name, z) => {
      const d = Math.hypot(z.pos.x - this.player.pos.x, z.pos.z - this.player.pos.z);
      const v = Math.max(0, 1 - d / 45);
      if (name === 'knock') sfx.knock(v);
      else if (name === 'glass') { sfx.glass(v); sfx.groan(Math.min(1, v * 1.4)); }
      else if (name === 'rumble') sfx.rumble(v);
      else if (name === 'emerge') { sfx.dirt(v); sfx.groan(Math.min(1, v * 1.4)); }
    };
    const crawl = !knight && this.round >= Zc.crawlerRound && Math.random() < Zc.crawlerChance;
    const hp = knight ? Math.round(this.zombieHealth * IK.healthMult) : this.zombieHealth;
    const z = new Zombie(scene, spawn, hp, speed, onEvent, null, { crawler: crawl, kind: knight ? 'armored' : null });
    if (knight) z.ironKnight = true;
    this.zombies.push(z);
    if (!extra) this.toSpawn--;

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
        spd: speed, // avant les réductions de vitesse de la variante et du rampant : le client les réapplique dans makeKind / makeCrawler
        crawl: crawl ? 1 : 0,
        kind: knight ? 'armored' : null,
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
    for (const g of this.grenadesLive) scene.remove(g.mesh);
    this.grenadesLive = [];
    this.resetShells();
    this.resetBoxRoll();
    this.resetPap();
    if (resetStats) this.resetBox();
    if (resetStats) { this.finale = null; this.finaleDone = false; hud.setBanner?.(null); hud.setBossBar?.(null); }
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
    this.resetVehicles?.();
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
    this.updateVehicles(dt);
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
    // (calculé par tranches à chaque image sur toute la carte, uniquement vers les joueurs debout)
    this.updateLevels(dt);
    if (world.nav && (this.isHost || !this.isMultiplayer)) {
      const targets = [p, ...this.remotes.values()].filter((pl) => !pl.dead && !pl.downed);
      if (targets.length) {
        const gt = this.fieldTargets(0, targets);
        if (gt.length) {
          if (world.nav.updateField) world.nav.updateField(gt, 25000);
          else {
            this.navTimer = (this.navTimer ?? 0) - dt;
            if (this.navTimer <= 0) { world.nav.computeField(gt); this.navTimer = 0.15; }
          }
        }
        this.updateRegionFields(dt, targets);
      }
      this.relocateZombies(dt, targets);
    }
    this.updateGrenades(dt);
    this.updateShells(dt);
    this.updateBoxRoll(dt);
    this.updatePap(dt);
    this.updateBoxMove(dt);

    this.updateFinale(dt);

    // Gestion des manches (Hôte ou Solo UNIQUEMENT) — en pause pendant l'Heure du Jugement
    if ((this.isHost || !this.isMultiplayer) && !this.finale) {
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
        if (!e.sharedMat) e.obj.material.dispose();
        this.effects.splice(i, 1);
      }
    }

    // Réanimation en continu (touche E maintenue par un joueur vivant)
    const downedTeammate = this.nearDownedTeammate();
    if (downedTeammate && !p.downed && !p.dead && p.keys['letter:e']) {
      this.reviveTarget = downedTeammate;
      this.reviveTimer += dt;
      if (this.reviveTimer >= this.reviveTime()) {
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
          pap: p.curW.pap ? 1 : 0,
          rl: p.curW.reloading ? 1 : 0,
          ads: p.aiming ? 1 : 0,
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
              Math.round(z.pos.y * 100) / 100,
              z.isBoss ? z.bs : 0,
              z.isBoss && z.state === 'hidden' ? 1 : 0,
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
    hud.setHealth(p.health, p.maxHealth);
    hud.setNades(p.grenades);
    hud.setPerks(p.perks, CONFIG.perks);
    hud.drawCompass(p.yaw);
    if (world.zoneOf) hud.setZone(world.zoneNames[world.zoneOf(p.pos.x, p.pos.z)]);
    hud.drawMap(world, p, [...this.remotes.values()], this.isMultiplayer ? slotColor(this.mySlot) : '#66ff99');
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
    hud.setVehicle(p.vehicle ? { speed: p.vehicle.v.speed, vmax: p.vehicle.v.def.maxSpeed, vmin: p.vehicle.v.def.roadkill.vmin, hp: p.vehicle.v.hp, hpMax: p.vehicle.v.maxHp, fuel: p.vehicle.v.fuelFrac } : null);
    if (p.vehicle) {
      promptText = p.vehicle.v.state === 'burning' ? 'SAUTEZ ! [E]' : p.vehicle.seat === 0 ? '[E] Descendre' : '[E] Descendre · clic gauche : tirer';
    } else if (downedTeammate) {
      const left = Math.max(0, this.reviveTime() - this.reviveTimer).toFixed(1);
      promptText = `[E] Maintenir pour réanimer ${downedTeammate.name} (${left}s)`;
    } else if (this.nearStation()) {
      promptText = curW.reserve >= curCfg.maxReserve
        ? 'Munitions au maximum'
        : `[E] Munitions ${curCfg.name} (${curCfg.ammoPrice} pts)`;
    } else if (this.nearMachine()) {
      promptText = this.machinePrompt(this.nearMachine());
    } else if (this.nearWallWeapon()) {
      const ww = this.nearWallWeapon();
      const wState = p.inventory.find((w) => w.id === ww.id);
      if (wState) {
        const price = wState.pap ? ww.ammoPrice * 3 : ww.ammoPrice;
        promptText = wState.reserve >= p.statsOf(wState).maxReserve
          ? `${ww.name} (Munitions pleines)`
          : `[E] Munitions ${ww.name} (${price} pts)`;
      } else {
        const full = p.inventory.length >= p.maxWeapons;
        promptText = `[E] Acheter ${ww.name} (${ww.price} pts)${full ? ' — remplace l’arme en main' : ''}`;
      }
    } else if (this.nearPump()) {
      promptText = this.pumpPrompt(this.nearPump());
    } else if (this.nearVehicle()) {
      promptText = this.vehiclePrompt(this.nearVehicle());
    } else if (this.nearDoor()) {
      const d = this.nearDoor();
      promptText = `[E] Ouvrir la porte vers ${d.name} (${d.price} pts)`;
    }
    hud.prompt(promptText);
  },
};

sfx.setVolume(settings.volume);
sfx.setMusicVolume(settings.music);
game.player = new Player(camera, scene, world, game);
hud.setWeapon(game.player.curCfg.name, game.player.curCfg.caliber);
installMachineFx(game, { world, hud, sfx, fx });
installFinale(game, { world, scene, hud, sfx, fx });
installVehicles(game, { world, scene, hud, sfx });
installLauncher(game, { world, scene, fx });
game.initVehicles();
game.player.setCharacter(charOf(game.charPref));

// Choix du personnage (menu) : cartes avec portrait, rendu une seule fois
{
  const row = document.getElementById('charRow');
  if (row) {
    const cards = CHARACTERS.map((ch, i) => {
      const c = document.createElement('div');
      c.className = 'char-card'; c.style.setProperty('--c', ch.accent);
      c.innerHTML = `<img alt="${ch.name}" /><b>${ch.name}</b><small>${ch.role}</small>`;
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        game.charPref = i; localStorage.setItem('zombie_char', String(i));
        game.player.setCharacter(ch);
        cards.forEach((x, k) => x.classList.toggle('sel', k === i));
      });
      row.appendChild(c);
      return c;
    });
    cards[game.charPref].classList.add('sel');
    // les portraits sont dessinés juste après le premier affichage (un petit contexte WebGL à part)
    setTimeout(() => { try { renderPortraits(200).forEach((u, i) => { cards[i].querySelector('img').src = u; }); } catch (err) { console.warn('portraits', err); } }, 400);
  }
}

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
  game.bindVehicleNet(net);
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
    game.onPeerLeft(m.id); // libère ses places de moto (hôte)
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
        box: (world.boxes || []).findIndex((b) => b.active),
        finale: game.finale ? 1 : null,
        finaleDone: game.finaleDone,
        vehicles: game.vehicleSnapshot(),
        zombies: game.zombies.map((z) => ({
          id: z.id,
          st: z.spawnType,
          wi: z.spawnType === 'window' ? (z.spawn.index ?? world.windowSpawns.indexOf(z.spawn)) : -1,
          x: z.pos.x,
          z: z.pos.z,
          hp: z.health,
          spd: z.speed / (z.crawler ? 0.45 : 1) / (z.kind === 'armored' ? 0.8 : z.kind === 'bloat' ? 0.7 : 1), // vitesse d'avant les réductions (le client les réapplique)
          spawnT: z.spawnT,
          crawl: z.crawler ? 1 : 0,
          boss: z.isBoss ? 1 : 0,
          kind: z.kind || null,
          y: z.pos.y,
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
    if (!m.nt) game.tracer(o, e, m.tc); // pas de traînée pour un projectile (M79) ; couleur propre à l'arme (carreau)
    game.remotes.get(m.from)?.fire();
    const d = Math.hypot(m.origin.x - game.player.pos.x, m.origin.z - game.player.pos.z);
    if (d < 80) game.weaponSound(m.w, Math.max(0.25, 1 - d / 100), d);
  });

  // Dégâts reçus
  net.on('hurt', (m) => {
    game.player.hurt(m.amount, m.src || null); // src absent : coup de zombie
    if (m.kx || m.kz) { game.player.vel.x += m.kx || 0; game.player.vel.z += m.kz || 0; game.player.vy = Math.max(game.player.vy, 3.2); }
  });

  // Points reçus (client)
  net.on('pts', (m) => {
    game.addPoints(m.pts, m.head ? 'head' : '');
    if (m.kill) { game.kills += m.kills || 1; sfx.kill(); }
  });

  // Zombies (spécifique client)
  net.on('z_spawn', (m) => {
    let spawn;
    if (m.st === 'window' && world.windowSpawns && m.wi >= 0) {
      spawn = world.windowSpawns[m.wi];
    } else {
      spawn = { type: 'ground', pos: new THREE.Vector3(m.x, 0, m.z) };
    }
    if (game.zombies.some((q) => q.id === m.id)) return;
    const onEvent = (name, z) => {
      const d = Math.hypot(z.pos.x - game.player.pos.x, z.pos.z - game.player.pos.z);
      const v = Math.max(0, 1 - d / 45);
      if (name === 'knock') sfx.knock(v);
      else if (name === 'glass') { sfx.glass(v); sfx.groan(Math.min(1, v * 1.4)); }
      else if (name === 'rumble') sfx.rumble(v);
      else if (name === 'emerge') { sfx.dirt(v); sfx.groan(Math.min(1, v * 1.4)); }
    };
    const z = m.boss ? new Boss(scene, spawn, m.hp, onEvent, m.id, {}) : new Zombie(scene, spawn, m.hp, m.spd, onEvent, m.id, { crawler: !!m.crawl, kind: m.kind || null });
    if (m.run) z.runner = true;
    if (m.fin) { z.skipSpawn(); z.pos.set(m.x, m.y || 0, m.z); if (m.boss) z.group.visible = false; }
    z.net = { x: m.x, z: m.z, y: m.y || 0, yaw: 0, atk: false, bs: m.boss ? 9 : 0 };
    game.zombies.push(z);
  });

  net.on('z_tick', (m) => {
    const map = new Map();
    for (const z of game.zombies) map.set(z.id, z);
    for (const [id, x, z, yaw, atk, y, bs, hid] of m.z) {
      const zombie = map.get(id);
      if (zombie) {
        zombie.net = { x, z, yaw, atk: !!atk, y: y || 0, bs: bs || 0 };
        if (zombie.isBoss) zombie.group.visible = !hid;
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

  // Grenades lancées par un coéquipier : simulées localement (effets + dégâts côté hôte)
  net.on('nade', (m) => {
    const o = new THREE.Vector3(m.o.x, m.o.y, m.o.z), v = new THREE.Vector3(m.v.x, m.v.y, m.v.z);
    if (m.k === 'm79') game.launchShell(o, v, false, m.from, !!m.pap); // projectile de M79 ; sans k : grenade à main
    else game.throwGrenade(o, v, false, m.from);
  });
  // Fin de partie
  net.on('finale_req', () => { if (game.isHost && !game.finale && !game.finaleDone) game.startFinale(); });
  net.on('finale_start', () => { game.finale = { remote: true }; game.finaleIntro(); });
  net.on('finale_win', () => game.winFinale());
  net.on('finale_info', (m) => game.finaleInfo(m));
  net.on('finale_say', (m) => hud.announce(m.title, m.sub, m.ms));
  net.on('boss_fx', (m) => game.bossEvent(m.name, m));

  // Boîte mystère : l'hôte compte les tirages et décide des déplacements
  net.on('box_req', (m) => { if (game.isHost && !game.hostBoxRoll(m.from, m.owned || [])) net.send({ t: 'box_deny' }, m.from); });
  net.on('box_roll', (m) => game.startBoxRoll(m));
  net.on('box_deny', () => { game.points += CONFIG.box.price; sfx.deny(); });
  net.on('box_take', (m) => { if (game.isHost) game.hostBoxTake(m.from); });
  net.on('box_taken', (m) => game.onBoxTaken(m.pid));
  net.on('box_expire', () => { if (game.boxRoll?.phase === 'offer') { game.boxRoll.offerT = 0; } });
  net.on('pap_req', (m) => { if (game.isHost && !game.hostPapStart(m.from, m.w)) net.send({ t: 'pap_deny' }, m.from); });
  net.on('pap_start', (m) => game.startPapAnim(m));
  net.on('pap_deny', () => { game.points += CONFIG.papPrice; game.player.locked = false; sfx.deny(); });
  net.on('pap_taken', () => game.endPap());
  net.on('box_state', (m) => { game.boxUses = m.uses; });
  net.on('box_move', (m) => { game.startBoxMove(m.idx); });

  // Impact explosif d'un coéquipier (pistolet à rayons) : dégâts appliqués par l'hôte
  net.on('splash', (m) => {
    if (!game.isHost) return;
    const c = m.c ?? 0x44ff66;
    game.areaDamage(m.pt, m.r, m.dmg, m.from);
    fx.explosion(m.pt.x, m.pt.y, m.pt.z, m.r, c); // l'hôte voit l'effet, puis le relaie aux autres clients (pas à l'émetteur : o)
    game.net.send({ t: 'boom', pt: m.pt, r: m.r, c, o: m.from });
  });
  net.on('boom', (m) => {
    if (m.o != null && m.o === net.id) return; // c'est notre propre impact : déjà affiché
    fx.explosion(m.pt.x, m.pt.y, m.pt.z, m.r, m.c ?? 0x44ff66);
  });
  net.on('z_crawl', (m) => {
    const z = game.zombies.find((zb) => zb.id === m.id);
    if (z && !z.dead) z.makeCrawler();
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
      game.collectPowerup(pu, false, m.from);
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
    game.player.grenades = Math.min(CONFIG.grenade.max, game.player.grenades + CONFIG.grenade.perRound);
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
    if (m.box != null && m.box >= 0) world.setActiveBox?.(m.box);
    game.finaleDone = !!m.finaleDone;
    game.finale = m.finale != null ? { remote: true } : null;
    game.applyVehicleSnapshot(m.vehicles);

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
      const z = zd.boss ? new Boss(scene, spawn, zd.hp, () => {}, zd.id, {}) : new Zombie(scene, spawn, zd.hp, zd.spd, () => {}, zd.id, { crawler: !!zd.crawl, kind: zd.kind || null });
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

// Le navigateur n'autorise le son qu'après une interaction : on démarre l'audio (et la musique du menu) au premier clic
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sfx.init(), { once: true });

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

// Carte plein écran (M)
window.addEventListener('keydown', (e) => {
  // lettre tapée (e.key) et non position physique : en AZERTY la touche M n'est pas au même endroit qu'en QWERTY
  if (!e.repeat && e.key && e.key.toLowerCase() === 'm' && game.started) hud.toggleMap();
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
      game.player.setCharacter(charOf(game.mySlot));
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

    net.send({ t: 'create', name: game.playerName, slot: game.charPref });
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
      game.player.setCharacter(charOf(game.mySlot));
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

    net.send({ t: 'join', code, name: game.playerName, slot: game.charPref });
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
  } else if (game._victory) {
    game._victory = false;
    game.playing = false;
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
  music: document.getElementById('optMusic'),
  quality: document.getElementById('optQuality'),
};
const optFormat = {
  brightness: (v) => `${Math.round(v * 100)}%`,
  fov: (v) => `${Math.round(v)}°`,
  sens: (v) => `${(+v).toFixed(2)}x`,
  volume: (v) => `${Math.round(v * 100)}%`,
  music: (v) => `${Math.round(v * 100)}%`,
  quality: (v) => ['Rapide', 'Normale', 'Haute'][Math.round(v)] || 'Normale',
};
for (const [key, input] of Object.entries(optInputs)) {
  input.value = settings[key];
  input.nextElementSibling.textContent = optFormat[key](settings[key]);
  input.addEventListener('input', () => {
    settings[key] = parseFloat(input.value);
    input.nextElementSibling.textContent = optFormat[key](settings[key]);
    applyVisualSettings();
    sfx.setVolume(settings.volume);
    sfx.setMusicVolume(settings.music);
    game.saveSettings();
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

// Précompilation de tous les shaders pendant le chargement : sinon chaque nouvel objet (zombie rampant,
// arme sortie de la boîte, grenade, bonus…) fait compiler son shader en pleine partie et le jeu saccade.
function precompileShaders() {
  const temp = [];
  const add = (o) => { scene.add(o); temp.push(o); };
  const sp = { type: 'ground', pos: world.startPos.clone() };
  const zs = [new Zombie(scene, sp, 100, 1, () => {}), new Zombie(scene, sp, 100, 1, () => {}, null, { crawler: true }), new Zombie(scene, sp, 100, 1, () => {}, null, { boss: true })];
  add(new THREE.Mesh(NADE_GEO, NADE_MAT));
  add(makeTeddy());
  const disp = makeDisplay(); add(disp.root); disp.showPap('rifle');
  for (const k of ['armored', 'bloat']) zs.push(new Zombie(scene, sp, 100, 1, () => {}, null, { kind: k }));
  zs.push(new Boss(scene, sp, 100, () => {}, null, {}));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), wreckMaterial())); // épave de moto (matériau noir partagé)
  for (const ch of [CHARACTERS[0], CHARACTERS[1]]) { const av = new Avatar(ch); av.flash.visible = true; add(av.root); }
  add(new THREE.Mesh(HALO_GEO, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x22ff66, emissiveIntensity: 1.2, roughness: 0.3 })));
  add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ transparent: true })));
  const tagTex = new THREE.CanvasTexture(document.createElement('canvas'));
  add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false, transparent: true })));
  add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false, transparent: true, fog: false }))); // étiquette de nom des coéquipiers
  if (world.windowSpawns?.length) world.windowSpawns[0].getQuad();
  // les objets cachés (autres armes, zombies en attente…) sont rendus visibles le temps de la compilation ;
  // pas les lumières, pour compiler avec le vrai nombre de lumières
  const hidden = [], culled = [];
  scene.traverse((o) => {
    if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }
    if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
  });
  renderer.compile(scene, camera);
  for (const t of zombieTextures()) renderer.initTexture(t);
  // vrai rendu (avec les ombres), à l'écran derrière le menu : envoie textures et géométries à la carte
  // graphique et force le pilote à finir la compilation, sinon c'est le premier affichage en jeu qui saccade.
  // (pas dans une cible hors écran : three.js y utilise d'autres variantes de shaders, sans tone mapping)
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  for (const o of hidden) o.visible = false;
  for (const o of culled) o.frustumCulled = true;
  // on retire les zombies témoins SANS libérer leurs matériaux : un shader dont plus aucun matériau ne se sert
  // est détruit par three.js, et serait recompilé au premier zombie de la manche suivante
  for (const z of zs) { scene.remove(z.group); if (z.mound) scene.remove(z.mound); }
  for (const o of temp) scene.remove(o);
  tagTex.dispose();
}
precompileShaders();

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
// Musique : de plus en plus dure avec les manches, à fond pendant le finale, étouffée dans les menus et en pause
// (en multijoueur la partie continue pendant la pause, donc la musique aussi)
function updateMusicMood() {
  const inGame = game.started && !game.over;
  const intensity = !inGame ? 0.3 : game.finale ? 1 : Math.min(0.85, 0.3 + game.round * 0.05);
  const paused = !game.isMultiplayer && !game.playing;
  sfx.setMood(intensity, !inGame || paused);
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  // Solo : le menu pause fige le jeu. En multijoueur la partie continue.
  const frozen = !game.isMultiplayer && !game.playing && game.started && !game.over && !q.has('debug');
  if (game.started && !game.over && !frozen) game.update(dt);
  hud.update(dt);
  updateMusicMood();
  // ombres de la lune : recalculées une image sur deux (à chaque image en qualité haute) : ~20 % de rendu en moins
  shadowFrame++;
  if (shadowFrame % ((settings.quality ?? 1) >= 2 ? 1 : 2) === 0) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
}
let shadowFrame = 0;
frame();

window.game = game;
game.scene = scene; // accès console / outils de test (tools/make-docs.mjs)
game.fx = fx;
game.THREE = THREE;
game.renderer = renderer;
game.camera = camera;
