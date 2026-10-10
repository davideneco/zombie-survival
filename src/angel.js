import * as THREE from 'three';
import { Boss } from './boss.js';
import { Zombie } from './zombie.js';
import { CONFIG } from './config.js';

// =====================================================================
//  L'Ange du Jugement : boss secret de l'Acte V (CONFIG.summit.angel). Il ne marche pas : il tourne hors de la tour, sur un cercle de `radius` m
//  autour de l'axe de la flèche, à `height` m (scripté). Sous-classe du Bourreau (même relais réseau : code d'état bs, l'hôte joue l'IA), avec la
//  barre de vie d'un mini-boss (`mini` : nom et vie, sans seuils de phase). Son point faible est sa trompette (dégâts x weak, quelle que soit l'arme).
//   trumpet_tel / trumpet    Trompette : cône annoncé 1 s, 40 dégâts à qui s'y trouve (la flèche ne protège pas : il faut sortir du cône)
//   plumes_tel / plumes      Plumes : éventail de 5 plumes (15 dégâts chacune), arrêtées par la flèche
//   judge_tel / judge        Jugement : un joueur est marqué 3 s (couronne), puis un rayon le frappe sauf s'il se cache derrière la flèche
//  Il reste immobile pendant ses attaques : la zone annoncée est exactement celle qui frappe.
//  Codes bs : 0 en orbite, 20 trompette (annonce), 21 trompette, 22 plumes, 23 jugement (annonce), 24 jugement, 25 arrivée
// =====================================================================
const BS = { orbit: 0, trumpet_tel: 20, trumpet: 21, plumes_tel: 22, plumes: 22, judge_tel: 23, judge: 24, arrive: 25 };
const A = () => CONFIG.summit.angel;
const TOWER_TOP = 104, TIP = 128;
// rayon de la flèche à la hauteur y : pagode (6,35 m à 104 m -> 1,9 m à 128 m), puis aiguille (jusqu'à 141 m)
export const spireRadius = (y) => (y < TOWER_TOP ? 9.6 : y <= TIP ? 6.35 + (1.9 - 6.35) * ((y - TOWER_TOP) / (TIP - TOWER_TOP)) : y < 141 ? 1.7 * ((141 - y) / 12) : 0);

export class Angel extends Boss {
  constructor(scene, spawn, health, onEvent, id, opts = {}) {
    super(scene, spawn, health, onEvent, id, { ...opts, name: 'L\'ANGE DU JUGEMENT', speed: 0, damage: 0, scale: A().scale });
    this.mini = true;
    this.isAngel = true;
    this.weakMult = A().weak;           // lu par hitZombie (main.js) : tir sur la trompette
    this.state = 'orbit'; this.stateT = 0; this.bs = 0;
    this.t = 0;
    this.az = 200;                      // azimut sur le cercle (degrés)
    this.center = { x: 0, z: 0 };
    this.feathers = [];
    this.groanT = Infinity;
    this.region = 0;
    this.phase = 1;
    this._enterPhase();
  }

  // ----------------------------------------------------------------- modèle : tout en plans, matériaux standard et additifs
  _buildBody() {
    // le corps de zombie reste pour les hitbox (invisibles) ; tout le reste est caché
    this.group.traverse((o) => { if (o.isMesh && !o.userData.zombie) o.visible = false; });
    this.axe = null; this.lantern = null; this.lanternGlow = null;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.55, emissive: 0x7a6e50, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.3, metalness: 0.8, emissive: 0x7a5410 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.angelMats = [white, gold];
    this.glowMat = glow;
    const rig = this.rig = new THREE.Group(); this.group.add(rig);
    const add = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    // robe, taille, torse, tête et cheveux d'or
    add(new THREE.CylinderGeometry(0.21, 0.48, 1.15, 16, 1, true), white, rig, 0, 0.58, 0);
    add(new THREE.TorusGeometry(0.47, 0.025, 6, 24), gold, rig, 0, 0.04, 0).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.2, 0.23, 0.55, 12), white, rig, 0, 1.38, 0);
    add(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 12), gold, rig, 0, 1.12, 0);
    this.headG = new THREE.Group(); this.headG.position.set(0, 1.74, 0.01); rig.add(this.headG);
    add(new THREE.SphereGeometry(0.15, 14, 10), white, this.headG);
    const hair = add(new THREE.SphereGeometry(0.162, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), gold, this.headG, 0, 0.015, -0.01);
    hair.scale.set(1, 1.05, 1.05);
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.018, 6, 6), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }), this.headG, sx * 0.055, 0.02, 0.135);
    // auréole : tore additif au-dessus de la tête
    this.halo = add(new THREE.TorusGeometry(0.23, 0.022, 8, 28), glow, this.headG, 0, 0.3, 0); this.halo.rotation.x = Math.PI / 2;
    // bras : épaule -> avant-bras ; le droit tient la trompette
    this.armR = this._arm(rig, 1, white, gold);
    this.armL = this._arm(rig, -1, white, gold);
    const hand = this.armR.hand;
    const trumpet = this.trumpet = new THREE.Group(); hand.add(trumpet);
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.66, 8), gold, trumpet, 0, -0.33, 0);
    this.bell = add(new THREE.CylinderGeometry(0.03, 0.2, 0.3, 14, 1, true), gold, trumpet, 0, -0.77, 0);
    this.bell.material = gold.clone(); this.bell.material.side = THREE.DoubleSide; this.angelMats.push(this.bell.material);
    this.bellGlow = add(new THREE.CircleGeometry(0.19, 14), glow.clone(), trumpet, 0, -0.93, 0); this.bellGlow.rotation.x = Math.PI / 2; this.bellGlow.material.opacity = 0; this.bellGlow.visible = false;
    // ailes : 9 plumes-plans par aile en éventail (la gauche est le miroir de la droite)
    this.wings = [];
    for (const sx of [1, -1]) {
      const w = new THREE.Group(); w.position.set(sx * 0.1, 1.55, -0.1); rig.add(w);
      const inner = new THREE.Group(); inner.scale.x = sx; w.add(inner);
      for (let i = 0; i < 9; i++) {
        const a = (-0.3 + (i / 8) * 1.7), L = 1.35 - i * 0.075 - (i > 6 ? 0.1 : 0); // angle dans le plan de l'aile (rad), longueur
        const f = add(new THREE.PlaneGeometry(0.2, L, 1, 1), i % 2 ? white : gold.clone(), inner, Math.cos(a) * L / 2, Math.sin(a) * L / 2, -0.004 * i);
        if (i % 2 === 0) { f.material = white; }
        f.rotation.z = a - Math.PI / 2;
      }
      for (let i = 0; i < 4; i++) { // petites plumes de couverture, plus près de l'épaule
        const a = 0.2 + i * 0.4, L = 0.55;
        const f = add(new THREE.PlaneGeometry(0.17, L), white, inner, Math.cos(a) * L * 0.55, Math.sin(a) * L * 0.55 + 0.03, 0.02); f.rotation.z = a - Math.PI / 2;
      }
      this.wings.push(w);
    }
    // halo large dans le dos (additif)
    const back = add(new THREE.CircleGeometry(0.9, 24), glow.clone(), rig, 0, 1.5, -0.32); back.material.opacity = 0.18; this.backGlow = back;
    // hitbox : trompette (point faible, tête = dégâts fixés par weakMult), ailes (corps) ; la tête de zombie ne compte plus comme tête
    const hit = this.meshes[0].material;
    this.meshes[0].userData.head = false;
    this.trumpetHit = add(new THREE.SphereGeometry(0.3, 8, 6), hit, trumpet, 0, -0.82, 0);
    this.trumpetHit.userData = { zombie: this, head: true };
    const wingHit = add(new THREE.BoxGeometry(3.3, 1.5, 0.35), hit, rig, 0, 1.45, -0.28);
    wingHit.userData = { zombie: this, head: false };
    this.meshes.push(this.trumpetHit, wingHit);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  _arm(rig, sx, white, gold) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.27, 1.55, 0); rig.add(sh);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.3, 8), white); up.position.y = -0.15; sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.3, 8), white); fo.position.y = -0.15; el.add(fo);
    const hand = new THREE.Group(); hand.position.y = -0.31; el.add(hand);
    hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), white));
    return { sh, el, hand };
  }

  _enterPhase() { this.cool = this.cool || { gap: 0, trumpet: 0, plumes: 0, judge: 0 }; this.speed = 0; }
  get invulnerable() { return this.state === 'arrive'; }
  get targetable() { return !this.dead && this.state !== 'arrive'; }
  // arrivée : insensible ; sinon les dégâts comme un mini-boss (le multiplicateur de la trompette est dans hitZombie)
  damage(amount) { if (this.state === 'arrive' && !this.net) return false; return Zombie.prototype.damage.call(this, amount, false); }
  _setState(s) { this.state = s; this.stateT = 0; this.bs = BS[s] ?? 0; }

  // position de la trompette dans le monde (origine des plumes)
  trumpetWorld(out) { this.group.updateMatrixWorld(true); return this.trumpetHit.getWorldPosition(out); }

  // l'axe de la flèche est entre (cx, cz) et le point (x, y, z) ? (la pagode et l'aiguille arrêtent plumes et rayon)
  blocked(ax, ay, az, bx, by, bz) {
    const c = this.center;
    for (let i = 1; i < 40; i++) {
      const u = i / 40, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u;
      if (y < TOWER_TOP - 0.3) continue;
      if (Math.hypot(x - c.x, z - c.z) < spireRadius(y) - 0.15) return true;
    }
    return false;
  }

  // joueur sur la terrasse ou la rampe (pas à l'intérieur de l'escalier)
  exposed(p) { return p.pos.y > TOWER_TOP - 1.2 && Math.hypot(p.pos.x - this.center.x, p.pos.z - this.center.z) < 10.4; }

  // ----------------------------------------------------------------- IA (hôte) ; pantin chez les clients
  update(dt, targets, others, world) {
    const T = A();
    if (this.dead) {
      this.deathT += dt;
      this.group.position.y += dt * 1.2; this.rig.scale.setScalar(Math.max(0.01, 1 - this.deathT * 0.25));
      this.group.rotation.y += dt * 1.5;
      for (const m of this.angelMats) m.emissive.setHex(0xffd060);
      if (this.deathT > 2.5) this.group.visible = false;
      return;
    }
    if (this.net) {
      this.t += dt; this.stateT += dt;
      Zombie.prototype.update.call(this, dt, targets, others, world);
      this._pose();
      return;
    }
    this.t += dt; this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const m of this.angelMats) m.emissive.setHex(this.hitFlash > 0 ? 0x884400 : m === this.angelMats[1] ? 0x7a5410 : 0x7a6e50);
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    const c = this.center, ctx = this.ctx;
    const all = targets.filter((p) => p && !p.dead && !p.downed && this.exposed(p));
    const hurt = (p, dmg, kx, kz, src) => ctx?.hurtPlayer(p, dmg, kx, kz, src);
    const orbit = (k = 1) => { // le cercle : l'azimut avance, l'ange regarde l'axe de la flèche
      this.az += T.omega * dt * k;
      const a = (this.az * Math.PI) / 180;
      this.pos.x = c.x + Math.cos(a) * T.radius; this.pos.z = c.z + Math.sin(a) * T.radius;
      this.pos.y = T.height + Math.sin(this.t * 1.3) * T.bob;
      this.yaw = Math.atan2(c.x - this.pos.x, c.z - this.pos.z);
      this.group.rotation.set(0, this.yaw, 0);
    };
    const faceTo = (x, z, k = 6) => { let d = Math.atan2(x - this.pos.x, z - this.pos.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * k); this.group.rotation.set(0, this.yaw, 0); };
    this._updateFeathers(dt, all, hurt);
    switch (this.state) {
      case 'arrive': { // il descend du ciel en tournant
        const k = Math.min(1, this.stateT / 3.2), e = 1 - (1 - k) ** 3;
        this.az += T.omega * 3 * (1 - e) * dt;
        const a = (this.az * Math.PI) / 180, r = T.radius + 10 * (1 - e);
        this.pos.x = c.x + Math.cos(a) * r; this.pos.z = c.z + Math.sin(a) * r; this.pos.y = T.height + 22 * (1 - e);
        this.yaw = Math.atan2(c.x - this.pos.x, c.z - this.pos.z); this.group.rotation.set(0, this.yaw, 0);
        if (this.stateT >= 3.2) { this._setState('orbit'); this.cool.gap = T.first; }
        break;
      }
      case 'orbit': {
        orbit();
        if (!all.length || this.cool.gap > 0) break;
        const frac = this.health / this.maxHealth;
        let near = null, nd = Infinity;
        for (const p of all) { const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z); if (d < nd) { nd = d; near = p; } }
        if (frac < T.judgment.fromHealth && this.cool.judge <= 0 && !this.mark) this._startJudge(all);
        else if (this.cool.trumpet <= 0 && nd < T.trumpet.range + 2.5) this._startTrumpet(near);
        else if (this.cool.plumes <= 0) this._startPlumes(near);
        else if (this.cool.trumpet <= 0) this._startTrumpet(near);
        break;
      }
      case 'trumpet_tel': {
        const a = this._aim;
        if (this.stateT < T.trumpet.tel - 0.35) { const tg = all.includes(a.target) ? a.target : all[0]; if (tg) { a.dx = tg.pos.x - this.pos.x; a.dz = tg.pos.z - this.pos.z; const l = Math.hypot(a.dx, a.dz) || 1; a.dx /= l; a.dz /= l; } }
        faceTo(this.pos.x + a.dx, this.pos.z + a.dz, 8);
        this.pos.y = T.height + Math.sin(this.t * 1.3) * T.bob;
        if (this.stateT >= T.trumpet.tel) { this._blast(all, hurt); this._setState('trumpet'); }
        break;
      }
      case 'trumpet':
        if (this.stateT >= T.trumpet.dur) this._done('trumpet', T.trumpet.cooldown);
        break;
      case 'plumes_tel': {
        const a = this._aim, tg = all.includes(a.target) ? a.target : all[0];
        if (tg) faceTo(tg.pos.x, tg.pos.z, 8);
        this.pos.y = T.height + Math.sin(this.t * 1.3) * T.bob;
        if (this.stateT >= T.plumes.tel) { this._firePlumes(tg); this._setState('plumes'); }
        break;
      }
      case 'plumes':
        if (this.stateT >= 0.6) this._done('plumes', T.plumes.cooldown);
        break;
      case 'judge_tel': {
        const m = this.mark;
        if (m) faceTo(m.target.pos.x, m.target.pos.z, 4);
        this.pos.y = T.height + 0.8 * Math.min(1, this.stateT) + Math.sin(this.t * 1.3) * T.bob;
        if (this.stateT >= T.judgment.tel) this._fireJudge(all, hurt);
        break;
      }
      case 'judge':
        if (this.stateT >= 0.8) this._done('judge', T.judgment.cooldown);
        break;
      default: this._setState('orbit'); break;
    }
    this._pose();
  }

  _done(attack, cd) { this.cool[attack] = cd; this.cool.gap = A().gap; this._setState('orbit'); }

  // ----- Trompette : cône annoncé (portée, demi-angle) ; à la fin de l'annonce, qui s'y trouve est touché (une seule fois)
  _startTrumpet(target) {
    const T = A().trumpet, dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    this._aim = { target, dx: dx / l, dz: dz / l };
    this._setState('trumpet_tel');
    this.ctx?.event('angel_trumpet', { x: this.pos.x, y: this.pos.y, z: this.pos.z, fy: TOWER_TOP, dx: dx / l, dz: dz / l, range: T.range, ang: T.angle, tel: T.tel, dur: T.dur });
  }
  _blast(all, hurt) {
    const T = A().trumpet, a = this._aim, cos = Math.cos((T.angle * Math.PI) / 180);
    for (const p of all) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > T.range || Math.abs(p.pos.y - TOWER_TOP) > 24) continue;
      if (d > 0.8 && (dx * a.dx + dz * a.dz) / d < cos) continue;
      if (this.blocked(this.pos.x, this.pos.y + 3, this.pos.z, p.pos.x, p.pos.y + 1, p.pos.z)) continue; // la flèche protège
      hurt(p, T.damage, 0, 0, 'holy');
    }
  }

  // ----- Plumes : l'ange ouvre les ailes, puis un éventail de plumes part vers le joueur
  _startPlumes(target) {
    this._aim = { target };
    this._setState('plumes_tel');
  }
  _firePlumes(target) {
    const P = A().plumes, o = this.trumpetWorld(new THREE.Vector3());
    const tx = target ? target.pos.x : this.center.x, ty = target ? target.pos.y + 1.1 : TOWER_TOP + 1.1, tz = target ? target.pos.z : this.center.z;
    let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const base = Math.atan2(dx, dz), hz = Math.hypot(dx, dz), dirs = [];
    for (let i = 0; i < P.count; i++) {
      const a = base + (((i - (P.count - 1) / 2) * P.spread) * Math.PI) / 180;
      const d = [Math.round(Math.sin(a) * hz * 1000) / 1000, Math.round(dy * 1000) / 1000, Math.round(Math.cos(a) * hz * 1000) / 1000];
      dirs.push(d);
      this.feathers.push({ x: o.x, y: o.y, z: o.z, dx: d[0], dy: d[1], dz: d[2], t: 0, used: false });
    }
    this.ctx?.event('angel_plumes', { x: o.x, y: o.y, z: o.z, dirs, speed: P.speed, life: P.life });
  }
  _updateFeathers(dt, all, hurt) {
    const P = A().plumes;
    for (let i = this.feathers.length - 1; i >= 0; i--) {
      const f = this.feathers[i], bx = f.x, by = f.y, bz = f.z;
      f.t += dt;
      f.x += f.dx * P.speed * dt; f.y += f.dy * P.speed * dt; f.z += f.dz * P.speed * dt;
      let gone = f.t > P.life || this.blocked(bx, by, bz, f.x, f.y, f.z);
      if (!gone) for (const p of all) {
        if (Math.hypot(p.pos.x - f.x, p.pos.z - f.z) > P.radius || f.y < p.pos.y - 0.1 || f.y > p.pos.y + 1.9) continue;
        hurt(p, P.damage, 0, 0, 'holy'); gone = true; break;
      }
      if (gone) this.feathers.splice(i, 1);
    }
  }

  // ----- Jugement : un joueur est marqué ; à la fin de l'annonce un rayon le frappe, sauf si la flèche est entre eux
  _startJudge(all) {
    const J = A().judgment, t = all[Math.floor(Math.random() * all.length)];
    this.mark = { target: t, pid: this.ctx?.pidOf(t), t: J.tel };
    this._setState('judge_tel');
    this.ctx?.event('boss_mark', { pid: this.mark.pid, dur: J.tel, tel: J.tel, text: 'JUGEMENT · cachez-vous derrière la flèche', x: t.pos.x, z: t.pos.z });
  }
  _fireJudge(all, hurt) {
    const J = A().judgment, m = this.mark, t = m && m.target;
    this.mark = null;
    this.ctx?.event('boss_mark', { pid: null, dur: 0 });
    let hit = false;
    const o = this.trumpetWorld(new THREE.Vector3());
    if (t && !t.dead && !t.downed && all.includes(t) && !this.blocked(o.x, o.y, o.z, t.pos.x, t.pos.y + 1.1, t.pos.z)) { hurt(t, J.damage, 0, 0, 'holy'); hit = true; }
    const tx = t ? t.pos.x : this.center.x, ty = t ? t.pos.y + 1.1 : TOWER_TOP + 1.1, tz = t ? t.pos.z : this.center.z;
    this.ctx?.event('angel_judge', { x: o.x, y: o.y, z: o.z, tx, ty, tz, hit: hit ? 1 : 0 });
    this._setState('judge');
  }

  // ----------------------------------------------------------------- pose (hôte et clients)
  _pose(walk, amp, reach, lean, nod) {
    if (arguments.length) return; // appels de la pose de zombie : sans objet ici
    const code = this.net ? (this.net.bs || 0) : this.bs, t = this.t, rig = this.rig;
    const R = this.armR, L = this.armL, W = this.wings;
    let flap = Math.sin(t * 1.8) * 0.28, spread = 0.0, raise = 0, armRx = -0.35, armRz = -0.25, armLx = -0.1, armLz = 0.3, trumpetGlow = 0, haloK = 1;
    if (code === 20) { flap = Math.sin(t * 5) * 0.12 + 0.35; armRx = -2.0; armRz = -0.1; trumpetGlow = 0.5 + 0.5 * Math.abs(Math.sin(t * 14)); }
    else if (code === 21) { flap = 0.6; spread = 0.3; armRx = -2.0; armRz = -0.1; trumpetGlow = 1; }
    else if (code === 22) { flap = 0.55 + Math.sin(t * 9) * 0.1; spread = 0.5; armRx = -1.3; armLx = -1.3; armRz = -1.0; armLz = 1.0; }
    else if (code === 23) { flap = 0.2 + Math.sin(t * 4) * 0.08; spread = 0.4; armRx = -3.0; armLx = -3.0; armRz = -0.3; armLz = 0.3; haloK = 1.8 + Math.sin(t * 10) * 0.2; }
    else if (code === 24) { flap = 0.7; spread = 0.5; armRx = -1.5; armLx = -1.5; armRz = -0.1; armLz = 0.1; haloK = 2.4; }
    else if (code === 25) { flap = Math.sin(t * 6) * 0.5; spread = 0.2; }
    R.sh.rotation.set(armRx, 0, armRz); L.sh.rotation.set(armLx, 0, armLz);
    R.el.rotation.x = code === 20 || code === 21 ? -0.15 : -0.45; L.el.rotation.x = -0.35;
    this.trumpet.rotation.x = 0.1;
    W.forEach((w, i) => { const s = i === 0 ? 1 : -1; w.rotation.set(0, s * (0.35 + spread * 0.7 + flap * 0.25), s * (0.2 + flap)); }); // l'éventail se replie sur le dos et bat
    this.halo.scale.setScalar(haloK); this.halo.rotation.z = t * 1.5;
    this.glowMat.opacity = 0.45 + 0.15 * Math.sin(t * 3);
    this.backGlow.material.opacity = 0.16 + (code >= 20 && code < 25 ? 0.18 : 0) + 0.05 * Math.sin(t * 2.2);
    this.bellGlow.visible = trumpetGlow > 0; this.bellGlow.material.opacity = trumpetGlow * 0.7;
    rig.position.y = code === 23 ? 0.15 * Math.sin(t * 6) : 0;
  }
}
