import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Le Bourreau : boss de la fin de partie. Colosse encapuchonné armé d'une hache géante, en quatre phases (CONFIG.finale.boss).
//  L'hôte joue l'IA (machine à états) ; les autres joueurs reçoivent un code d'état (bs) et animent la même pose.
//   chase     poursuite + coups de hache (IA des zombies, dégâts du boss)
//   charge_tel / dash / stun     charge : trait rouge au sol, puis ruée en ligne droite (étourdi s'il percute un mur)
//   slam_tel / slam     coup de hache au sol : onde de choc circulaire, on l'évite en sautant
//   chain_tel / chain   Chaînes : annoncées, elles attirent le joueur visé de quelques mètres
//   mark                la Sentence : un joueur est marqué (couronne), seul poursuivi, dégâts reçus augmentés
//   axe_tel / axe       le Couperet : hache lancée aller-retour dans un couloir annoncé
//   fire                le Bûcher : cercles de feu annoncés
//   toll                le Glas : ondes de choc en série (transition invulnérable de la phase I à la II, puis régulier en phase IV)
//   summon / roar       renforts, rugissement
//   leap / hidden / rise     changements d'étage (scénarisés par la fin de partie)
//  Phases : I (100 -> 70 %) nef, II (70 -> 45 %) la Sentence, III (45 -> 20 %) la plateforme, IV (20 -> 0 %) le Jugement.
//  Codes bs : 0 poursuite, 2 charge (préparation), 3 ruée, 4 étourdi, 5 coup (préparation), 6 coup, 7 appel, 8 saut, 9 absent, 10 surgit,
//             11 chaînes, 12 hache lancée, 13 glas, 14 marque
// =====================================================================
const BS = { chase: 0, charge_tel: 2, dash: 3, stun: 4, slam_tel: 5, slam: 6, summon: 7, leap: 8, hidden: 9, rise: 10, recover: 0, chain_tel: 11, chain: 11, axe_tel: 12, axe: 12, toll: 13, mark: 14, fire: 7, roar: 7 };
const BC = () => CONFIG.finale.boss;

export class Boss extends Zombie {
  constructor(scene, spawn, health, onEvent, id, opts = {}) {
    super(scene, spawn, health, opts.speed ?? BC().speed[0], onEvent, id, { boss: true, bossDamage: opts.damage ?? CONFIG.finale.bossDamage });
    this.isBoss = true;
    this.name = opts.name || 'LE BOURREAU';
    this.maxHealth = this.health = health;
    this.ctx = opts.ctx || null;
    this.phase = 1;
    this.state = 'chase';
    this.stateT = 0;
    this.invuln = 0;
    this.bs = 0;
    this.dashDir = new THREE.Vector3(0, 0, 1);
    this.hit = new Set();
    this.shocks = [];          // ondes de choc en cours : { r, max, dmg, hit }
    this.leaped = false;
    this.mark = null;          // Sentence en cours : { target, t }
    this.fires = [];           // cercles du Bûcher : { x, z, t0, t, y }
    this.axeFlight = null;     // hache lancée : { dx, dz, t, hit: [Set, Set] }
    this.axeHideT = 0;         // la hache est lâchée : cachée dans la main
    this.fightT = 0;           // durée du combat (s) : au-delà de enrageAfter, tous ses coups sont renforcés
    this.group.scale.setScalar(opts.scale ?? 2.25);
    this.limp = false;
    this._enterPhase(1);
    this._buildBody();
  }

  // -------------------------------------------------------------- modèle
  _buildBody() {
    const black = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 1 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.4, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 });
    // cagoule : cône et masque noir autour de la tête
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9), black); hood.position.set(0, 0.04, -0.005); hood.scale.set(0.95, 1.18, 1.02); this.headGroup.add(hood);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 10), black); peak.position.set(0, 0.28, -0.02); this.headGroup.add(peak);
    for (const e of this.eyes) e.position.z += 0.035;
    // tablier de cuir et ceinture à chaînes
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.06), leather); apron.position.set(0, 0.2, 0.17); this.spine.add(apron);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.3), iron); belt.position.set(0, -0.05, 0.02); this.spine.add(belt);
    for (const sx of [-1, 1]) { const pad = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), iron); pad.position.set(0, 0.03, 0); this.arms[sx < 0 ? 0 : 1].shoulder.add(pad); }
    // lanterne-cœur dans le dos : son point faible (dégâts x2 de dos), une cage de fer autour d'une flamme
    const lant = new THREE.Group(); lant.position.set(0, 0.3, -0.2);
    lant.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa030 })));
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.9, wireframe: true }));
    lant.add(cage);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    lant.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glowMat));
    this.spine.add(lant); this.lantern = lant; this.lanternGlow = glowMat;
    // hache géante dans la main droite
    const axe = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 1.7, 8), wood); handle.position.y = 0.5; axe.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.05), iron); blade.position.set(0.31, 1.15, 0); axe.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.07), new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.95 })); edge.position.set(0.62, 1.15, 0); axe.add(edge);
    axe.position.set(0, -0.34, 0.02); axe.rotation.x = -0.9;
    this.arms[1].elbow.add(axe);
    this.axe = axe;
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  // -------------------------------------------------------------- phases
  // Recharges d'une phase (les attaques absentes de la phase : Infinity) ; la première attaque vient assez vite
  _enterPhase(n) {
    this.phase = n;
    const cd = BC().cd, k = n - 1, first = (arr, f = 0.6) => (arr[k] > 0 ? arr[k] * f : Infinity);
    this.cool = { gap: 1.5, charge: first(cd.charge, 0.7), slam: first(cd.slam, 0.8), chain: first(cd.chain, 0.5), sentence: first(cd.sentence, 0.2), summon: first(cd.summon, 0.7), axe: first(cd.axe, 0.4), fire: first(cd.fire, 0.3), toll: first(cd.toll, 0.6) };
    this.speed = BC().speed[k];
  }

  get invulnerable() { return this.invuln > 0 || this.state === 'hidden' || this.state === 'leap'; }

  // sommes-nous derrière le boss, vu depuis (x, z) ? (produit scalaire direction boss -> point, cap du boss < backCos)
  isBack(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    return (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / l < BC().sens.backCos;
  }

  // -------------------------------------------------------------- dégâts
  // hit : { x, z (point d'impact ; pour le couteau, la position de l'attaquant), zone, ray (tir direct du pistolet à rayons), mel, back, pid }
  // face (tête comprise) x front ; dos x back (x backSentence si la Sentence vise un autre joueur) ; zone ; ray ; étourdi
  damage(amount, isHead = false, hit = null) {
    if (this.net) return super.damage(amount, isHead); // pantin d'un client : seule la mort envoyée par l'hôte compte
    if (this.dead || this.invulnerable) return false;
    const S = BC().sens;
    let m;
    if (hit && hit.zone) m = S.zone;
    else {
      const back = hit ? (hit.back ?? (hit.x != null && this.isBack(hit.x, hit.z))) : false;
      m = back ? (this.mark && hit && hit.pid !== this.mark.pid ? S.backSentence : S.back) : S.front;
      if (hit && hit.ray) m = back ? S.ray * S.back : S.ray; // tir direct du pistolet à rayons : x0,35 (le dos compte toujours)
    }
    if (this.state === 'stun') m *= S.stun;
    const died = super.damage(amount * m, false);
    if (died || !this.ctx) return died;
    // seuils de phase : un coup n'en franchit qu'un à la fois (la santé est ramenée au seuil), la transition est invulnérable
    const T = BC().thresholds, max = this.maxHealth;
    if (this.phase === 1 && this.health < T[0] * max) { this.health = T[0] * max; this.beginToll(true); }
    else if (this.phase === 2 && this.health < T[1] * max) { this.health = T[1] * max; if (this.ctx.wantLeap) this.beginLeap(); }
    else if (this.phase === 3 && this.health < T[2] * max) { this.health = T[2] * max; this.enrage(); }
    return false;
  }

  get targetable() { return this.state !== 'hidden' && this.state !== 'leap' && super.targetable; }

  // 20 % : rugissement invulnérable puis le Jugement (phase IV)
  enrage() {
    this._enterPhase(4);
    this._clearTransient();
    this.cool.fire = 3; this.cool.toll = 9;
    this.invuln = BC().rage.roar;
    this._setState('roar');
    this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z, text: 'LE JUGEMENT !' });
  }

  // 70 % : le Glas, 10 s d'invulnérabilité et des renforts ; en phase IV : le Glas ordinaire (sans invulnérabilité ni renforts)
  beginToll(transition) {
    const G = BC().glas;
    this._clearTransient();
    if (transition) { this._enterPhase(2); this.invuln = G.invuln; this.cool.sentence = G.invuln + 3; this.cool.summon = G.invuln + 12; }
    this.tollT = 0; this.tollWaves = 0; this.tollTransition = !!transition; this.tollLen = transition ? G.invuln : G.waves * G.interval + 0.8;
    if (!transition) this.cool.toll = BC().cd.toll[3]; // recharge comptée depuis le début : un Glas toutes les 25 s
    this._setState('toll');
    this.attackWindup = -1;
    this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z, text: transition ? 'LE GLAS SONNE !' : 'LE GLAS !' });
  }

  beginLeap() {
    this.leaped = true;
    this._enterPhase(3);
    this._clearTransient();
    this._setState('leap');
    this.invuln = 99;
    this.attackWindup = -1;
    this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z, text: 'Le Bourreau, blessé, bondit vers la tour !' });
  }

  // Le Bourreau (re)surgit dans un étage donné
  arrive(region, x, z, y) {
    this.region = region; this.link = null;
    this.pos.set(x, y - 3, z);
    this.group.visible = true;
    this._setState('rise');
    this.invuln = 2.6;
    const keep = this.phase;
    this._enterPhase(keep);
    this.cool.charge = Math.min(this.cool.charge, 3); this.cool.axe = Math.min(this.cool.axe, 4); this.cool.chain = Math.min(this.cool.chain, 6);
    this.ctx?.event('boss_rise', { x, y, z });
    this._riseY = y;
  }

  _setState(s) { this.state = s; this.stateT = 0; this.bs = BS[s] ?? 0; }
  _clearTransient() {
    if (this.mark || this._pendingMark) this.ctx?.event('boss_mark', { pid: null, dur: 0 }); // la couronne disparaît chez tout le monde
    this.mark = null; this._pendingMark = null; this.shocks.length = 0; this.axeFlight = null; this.axeHideT = 0; this._chain = null; this._axeAim = null;
  }

  // multiplicateur des dégâts infligés à p : Sentence, puis enragement après enrageAfter s de combat
  dealMult(p) {
    const B = BC();
    let m = this.fightT > B.enrageAfter ? B.enrageMult : 1;
    if (this.mark && this.mark.target === p) m *= B.sentence.mult;
    return m;
  }

  // -------------------------------------------------------------- IA (hôte)
  update(dt, targets, others, world) {
    if (this.net) { // pantin d'un client : suit l'état de l'hôte
      this.axeHideT = Math.max(0, this.axeHideT - dt);
      this.glow = this._netInv ? 0x1c2a44 : (this._netPhase || 1) >= 4 ? 0x2a0c00 : 0;
      super.update(dt, targets, others, world); this._pose(); return;
    }
    if (this.dead || this.spawnT > 0) { super.update(dt, targets, others, world); return; }
    const B = BC(), lv = world.levels;
    const baseY = this.region && lv ? lv.regions[this.region].y : 0;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.axeHideT = Math.max(0, this.axeHideT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.state !== 'hidden' && this.state !== 'leap') this.fightT += dt;
    this.glow = this.invulnerable ? 0x1c2a44 : this.state === 'stun' ? 0x222200 : this.phase >= 4 ? 0x2a0c00 : 0; // (Zombie.update l'applique en poursuite)
    for (const m of this.mats) m.emissive.setHex(this.hitFlash > 0 ? 0x660000 : this.glow);
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    if (this.lanternGlow) this.lanternGlow.opacity = 0.3 + 0.15 * Math.sin(this.stateT * 6 + this.fightT * 2);
    const all = targets.filter((t) => t && !t.dead && !t.downed && (t.tregion || 0) === this.region);
    if (this.mark && (this.mark.t <= 0 || !all.includes(this.mark.target))) this._endMark();
    const cand = this.mark ? [this.mark.target] : all; // la Sentence : seul le joueur marqué est poursuivi et visé
    const nearest = (list = cand) => { let b = null, bd = Infinity; for (const t of list) { const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d < bd) { bd = d; b = t; } } return [b, bd]; };
    const face = (dx, dz, k = 8) => { let d = Math.atan2(dx, dz) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * k); this.group.rotation.set(0, this.yaw, 0); };
    const hurt = (p, dmg, kx, kz, src) => { if (this.ctx) this.ctx.hurtPlayer(p, dmg * this.dealMult(p), kx, kz, src); };
    this.pos.y = this.state === 'rise' ? this.pos.y : baseY;
    this.attackDamage = CONFIG.finale.bossDamage * (this.fightT > B.enrageAfter ? B.enrageMult : 1) * (this.mark ? B.sentence.mult : 1);
    if (this.mark) this.mark.t -= dt;
    this._updateShocks(dt, all, hurt, baseY);
    this._updateFires(dt, all, hurt);
    this._updateAxe(dt, all, hurt);

    switch (this.state) {
      case 'rise': { // surgit du sol
        const k = Math.min(1, this.stateT / 2.4);
        this.pos.y = (this._riseY ?? baseY) - 3 * (1 - k * k * (3 - 2 * k));
        if (Math.random() < dt * 14) this.ctx?.dust(this.pos.x, baseY + 0.2, this.pos.z);
        if (this.stateT >= 2.4) { this.pos.y = this._riseY ?? baseY; this._setState('chase'); }
        break;
      }
      case 'chase': {
        const [tg, d] = nearest();
        this.speed = this.mark ? B.sentence.speed : B.speed[this.phase - 1];
        if (!tg) { this.walkT += dt * 1.2; this._pose(); break; }
        super.update(dt, cand, others, world); // poursuite et coups de hache : IA des zombies
        this.bs = 0;
        if (this.attackWindup >= 0 || this.cool.gap > 0) break;
        const ph = this.phase, far = this._farthest(all);
        if (ph === 4 && this.cool.toll <= 0) this.beginToll(false);
        else if (ph === 4 && this.cool.fire <= 0 && all.length) this._startFire(all);
        else if (ph >= 3 && this.cool.axe <= 0 && d > 5 && d < 20) this._startAxe(tg);
        else if (this.cool.charge <= 0 && d > 4.5 && d < 20) this._startCharge(tg);
        else if (this.cool.chain <= 0 && far && far[1] > B.chain.minDist && far[1] < B.chain.maxDist) this._startChain(this.mark ? tg : far[0]);
        else if (this.cool.slam <= 0 && d < 7.5) this._setState('slam_tel');
        else if (ph === 2 && this.cool.sentence <= 0 && !this.mark && all.length) this._startMark(all);
        else if (ph === 2 && this.cool.summon <= 0) this._setState('summon');
        break;
      }
      case 'charge_tel': {
        const [tg] = nearest();
        if (tg && this.stateT < 0.8) this.dashDir.set(tg.pos.x - this.pos.x, 0, tg.pos.z - this.pos.z).normalize();
        face(this.dashDir.x, this.dashDir.z, 12);
        this.walkT += dt * 14; // il piaffe
        if (this.stateT >= 1.15) { this.hit.clear(); this._setState('dash'); this._wall = 0; }
        break;
      }
      case 'dash': {
        const sp = 15 + this.phase * 1.5;
        const bx = this.pos.x, bz = this.pos.z;
        this.pos.x += this.dashDir.x * sp * dt; this.pos.z += this.dashDir.z * sp * dt;
        world.collide(this.pos, 0.9);
        const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
        if (moved < sp * dt * 0.55) this._wall++; else this._wall = 0;
        face(this.dashDir.x, this.dashDir.z, 20);
        this.walkT += dt * 18;
        for (const t of all) {
          if (this.hit.has(t) || Math.abs(t.pos.y - this.pos.y) > 2.2) continue;
          if (Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 2.0) { this.hit.add(t); hurt(t, CONFIG.finale.chargeDamage, this.dashDir.x * 9, this.dashDir.z * 9); }
        }
        if (this._wall >= 2) { this.ctx?.event('boss_stun', { x: this.pos.x, y: this.pos.y, z: this.pos.z }); this.ctx?.dust(this.pos.x, baseY + 1, this.pos.z, 16); this._setState('stun'); }
        else if (this.stateT > 1.4) this._setState('recover');
        break;
      }
      case 'stun':
        this.walkT += dt * 2;
        if (this.stateT >= 2.4) this._backToChase('charge');
        break;
      case 'recover':
        this.walkT += dt * 1.5;
        if (this.stateT >= 0.8) this._backToChase('charge');
        break;
      case 'slam_tel': {
        const [tg] = nearest();
        if (tg) face(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z, 6);
        if (this.stateT >= 1.0) { this._addShock(CONFIG.finale.slamDamage, 13); this.ctx?.event('boss_shock', { x: this.pos.x, y: baseY, z: this.pos.z }); this._setState('slam'); }
        break;
      }
      case 'slam':
        if (this.stateT >= 1.1) this._backToChase('slam');
        break;
      case 'chain_tel': {
        const c = this._chain;
        if (!c) { this._backToChase(); break; }
        const tg = all.includes(c.target) ? c.target : nearest(all)[0];
        if (tg && this.stateT < B.chain.tel - 0.3) { c.dx = tg.pos.x - this.pos.x; c.dz = tg.pos.z - this.pos.z; const l = Math.hypot(c.dx, c.dz) || 1; c.dx /= l; c.dz /= l; }
        face(c.dx, c.dz, 10);
        if (this.stateT >= B.chain.tel) this._fireChain(all, hurt);
        break;
      }
      case 'chain':
        if (this.stateT >= 0.5) this._backToChase('chain');
        break;
      case 'mark': {
        const mk = this._pendingMark;
        if (mk) face(mk.pos.x - this.pos.x, mk.pos.z - this.pos.z, 8);
        if (this.stateT >= B.sentence.tel) {
          this.mark = mk && all.includes(mk) ? { target: mk, pid: this.ctx?.pidOf(mk), t: B.sentence.duration } : null;
          this._pendingMark = null;
          if (!this.mark) this.cool.sentence = 6;
          this._setState('chase');
        }
        break;
      }
      case 'axe_tel': {
        const a = this._axeAim;
        if (!a) { this._backToChase(); break; }
        const tg = all.includes(a.target) ? a.target : nearest(all)[0];
        if (tg && this.stateT < B.couperet.tel - 0.4) { a.dx = tg.pos.x - this.pos.x; a.dz = tg.pos.z - this.pos.z; const l = Math.hypot(a.dx, a.dz) || 1; a.dx /= l; a.dz /= l; }
        face(a.dx, a.dz, 12);
        if (this.stateT >= B.couperet.tel) {
          this.axeFlight = { dx: a.dx, dz: a.dz, x: this.pos.x, z: this.pos.z, t: 0, hit: [new Set(), new Set()] };
          this.axeHideT = B.couperet.flight * 2 + 0.25;
          this._setState('axe');
        }
        break;
      }
      case 'axe':
        if (this.stateT >= B.couperet.flight * 2 + 0.35) this._backToChase('axe');
        break;
      case 'fire':
        if (this.stateT >= 1.0) this._backToChase('fire');
        break;
      case 'roar':
        this.walkT += dt * 3;
        if (this.stateT >= B.rage.roar) { this._setState('chase'); }
        break;
      case 'toll': {
        const G = B.glas;
        this.tollT += dt;
        this.walkT += dt * 2;
        while (this.tollWaves < G.waves && this.tollT >= G.interval * (this.tollWaves + 1)) {
          this.tollWaves++;
          this._addShock(G.damage, 13);
          this.ctx?.event('boss_shock', { x: this.pos.x, y: baseY, z: this.pos.z, toll: 1 });
        }
        if (this.tollTransition && !this._tollAdds && this.tollT > 0.8) { this._tollAdds = true; this.ctx?.glasAdds?.(this); }
        if (this.tollT >= this.tollLen) {
          this._tollAdds = false;
          this._setState('chase');
          this.cool.gap = 1.5;
        }
        break;
      }
      case 'summon':
        if (this.stateT > 0.9 && !this._summoned) { this._summoned = true; this.ctx?.summon(this); this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z }); }
        if (this.stateT >= 1.9) { this._summoned = false; this._backToChase('summon'); }
        break;
      case 'leap': {
        // un saut puissant : le Bourreau quitte l'étage (il resurgira là-haut)
        const k = this.stateT / 1.4;
        this.pos.y = baseY + Math.sin(Math.min(1, k) * Math.PI) * 5;
        if (this.stateT >= 1.4) { this.group.visible = false; this.state = 'hidden'; this.bs = 9; this.ctx?.onLeap(this); }
        break;
      }
      case 'hidden':
        break;
      default: break;
    }
    if (this.state !== 'chase') this._pose();
  }

  _backToChase(attack) {
    const cd = BC().cd[attack], k = this.phase - 1;
    if (attack && cd && cd[k] > 0) this.cool[attack] = cd[k];
    this.cool.gap = BC().gap;
    this._setState('chase');
  }

  _farthest(list) {
    let b = null, bd = -1;
    for (const t of list) { const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d > bd) { bd = d; b = t; } }
    return b ? [b, bd] : null;
  }

  // ----- onde de choc : anneau qui s'étend ; les joueurs au sol sur l'anneau sont touchés (on saute par-dessus)
  _addShock(dmg, max) { this.shocks.push({ r: 0.5, max, dmg, hit: new Set() }); }
  _updateShocks(dt, all, hurt, baseY) {
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.r += 15 * dt;
      for (const t of all) {
        if (s.hit.has(t)) continue;
        const dd = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (Math.abs(dd - s.r) > 1.1 || Math.abs(t.pos.y - this.pos.y) > 2.6) continue;
        const airborne = t.pos.y > baseY + 0.45; // en l'air : l'onde passe dessous
        s.hit.add(t);
        if (!airborne) hurt(t, s.dmg, ((t.pos.x - this.pos.x) / (dd || 1)) * 7, ((t.pos.z - this.pos.z) / (dd || 1)) * 7);
      }
      if (s.r > s.max) this.shocks.splice(i, 1);
    }
  }

  // ----- Chaînes : annoncées, tirées vers le joueur le plus éloigné ; elles touchent tout joueur dans le couloir et l'attirent de `pull` m
  _startChain(target) {
    const C = BC().chain, dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    this._chain = { target, dx: dx / l, dz: dz / l };
    this._setState('chain_tel');
    this.ctx?.event('boss_chain', { x: this.pos.x, y: this.pos.y, z: this.pos.z, dx: dx / l, dz: dz / l, len: C.maxDist + 2, w: C.width, tel: C.tel });
  }
  _fireChain(all, hurt) {
    const C = BC().chain, c = this._chain;
    for (const t of all) {
      const rx = t.pos.x - this.pos.x, rz = t.pos.z - this.pos.z, along = rx * c.dx + rz * c.dz, side = Math.abs(-rx * c.dz + rz * c.dx);
      if (along < 0.5 || along > C.maxDist + 2 || side > C.width / 2 + 0.4 || Math.abs(t.pos.y - this.pos.y) > 2.4) continue;
      const pull = Math.max(0, Math.min(C.pull, along - 2.4)); // on ne traverse pas le boss
      hurt(t, C.damage, -c.dx * pull, -c.dz * pull, 'chain');
    }
    this._chain = null;
    this._setState('chain');
  }

  // ----- Sentence : la couronne marque un joueur
  _startMark(all) {
    const t = all[Math.floor(Math.random() * all.length)];
    this._pendingMark = t;
    this._setState('mark');
    this.ctx?.event('boss_mark', { pid: this.ctx?.pidOf(t), dur: BC().sentence.duration, tel: BC().sentence.tel, x: t.pos.x, z: t.pos.z });
  }
  _endMark() {
    this.mark = null;
    this.cool.sentence = BC().cd.sentence[1];
    this.ctx?.event('boss_mark', { pid: null, dur: 0 });
  }

  // ----- Couperet : couloir annoncé, puis la hache part et revient
  _startAxe(target) {
    const C = BC().couperet, dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    this._axeAim = { target, dx: dx / l, dz: dz / l };
    this._setState('axe_tel');
    this.ctx?.event('boss_axe', { x: this.pos.x, y: this.pos.y, z: this.pos.z, dx: dx / l, dz: dz / l, len: C.length, w: C.width, tel: C.tel, flight: C.flight });
  }
  _updateAxe(dt, all, hurt) {
    const f = this.axeFlight, C = BC().couperet;
    if (!f) return;
    f.t += dt;
    const total = C.flight * 2;
    if (f.t > total) { this.axeFlight = null; return; }
    const leg = f.t < C.flight ? 0 : 1, u = leg === 0 ? f.t / C.flight : (total - f.t) / C.flight, s = Math.max(0, Math.min(1, u)) * C.length; // distance de la hache au boss
    for (const t of all) {
      if (f.hit[leg].has(t) || Math.abs(t.pos.y - this.pos.y) > 2.4) continue;
      const rx = t.pos.x - f.x, rz = t.pos.z - f.z, along = rx * f.dx + rz * f.dz, side = Math.abs(-rx * f.dz + rz * f.dx);
      if (side > C.width / 2 + 0.3 || Math.abs(along - s) > 1.6) continue;
      f.hit[leg].add(t);
      hurt(t, C.damage, f.dx * 3, f.dz * 3, 'axe');
    }
  }

  // ----- Bûcher : des cercles de feu sous (et autour de) chaque joueur, annoncés puis brûlants
  _startFire(all) {
    const P = BC().pyre, n = P.circles + P.perPlayer * Math.max(0, all.length - 1), pts = [];
    for (let i = 0; i < n; i++) {
      const t = all[i % all.length], a = Math.random() * Math.PI * 2, r = i < all.length ? 0 : 1.5 + Math.random() * 3; // un cercle sur chaque joueur, les autres autour
      const x = t.pos.x + Math.cos(a) * r, z = t.pos.z + Math.sin(a) * r;
      pts.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
      this.fires.push({ x, z, y: t.pos.y, t: -P.tel, dur: P.duration, tick: 0 });
    }
    this._setState('fire');
    this.ctx?.event('boss_fire', { pts, y: this.pos.y, r: P.radius, tel: P.tel, dur: P.duration });
  }
  _updateFires(dt, all, hurt) {
    const P = BC().pyre;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t < 0) continue; // annonce
      if (f.t > f.dur) { this.fires.splice(i, 1); continue; }
      f.tick -= dt;
      if (f.tick > 0) continue;
      f.tick = P.tick;
      for (const t of all) if (Math.hypot(t.pos.x - f.x, t.pos.z - f.z) < P.radius && Math.abs(t.pos.y - f.y) < 2) hurt(t, P.dps * P.tick, 0, 0, 'fire');
    }
  }

  _startCharge(target) {
    this.dashDir.set(target.pos.x - this.pos.x, 0, target.pos.z - this.pos.z).normalize();
    this._setState('charge_tel');
    this.ctx?.event('boss_tele', { x: this.pos.x, z: this.pos.z, dx: this.dashDir.x, dz: this.dashDir.z });
  }

  // -------------------------------------------------------------- pose selon l'état (hôte et clients)
  _pose(walk, amp, reach, lean, nod) {
    if (arguments.length) { super._pose(walk, amp, reach, lean, nod); return; } // appel normal des zombies
    const code = this.net ? (this.net.bs || 0) : this.bs;
    const t = this.stateT + (this.net ? this.walkT : 0);
    const a = this.arms, hips = this.hips, sp = this.spine, hd = this.headGroup;
    const wob = Math.sin(this.walkT * 1.7);
    if (this.axe) this.axe.visible = !(this.axeHideT > 0);
    if (code === 0) { super._pose(this.walkT, 1, 1.1, 0.3, 0.2); return; }
    super._pose(this.walkT, code === 3 ? 1.6 : 0.4, 0.5, 0.2, 0.1);
    if (code === 2) { // charge : tête basse, jambes qui piaffent
      sp.rotation.x = 0.8; hd.rotation.x = 0.5; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -0.4;
    } else if (code === 3) { // ruée
      sp.rotation.x = 1.05; hd.rotation.x = 0.3; a[0].shoulder.rotation.x = 0.5; a[1].shoulder.rotation.x = -0.6;
    } else if (code === 4) { // étourdi : vacille
      sp.rotation.x = 0.2 + wob * 0.15; sp.rotation.z = wob * 0.25; hd.rotation.x = 0.6; hd.rotation.z = wob * 0.4;
      a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = 0.1;
    } else if (code === 5) { // hache au-dessus de la tête
      sp.rotation.x = -0.35; hd.rotation.x = -0.3; a[0].shoulder.rotation.x = -3.0; a[1].shoulder.rotation.x = -3.0;
      a[0].elbow.rotation.x = a[1].elbow.rotation.x = -0.2;
    } else if (code === 6) { // coup
      sp.rotation.x = 0.75; hd.rotation.x = 0.3; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -0.5;
    } else if (code === 7) { // appel : bras écartés, tête levée
      sp.rotation.x = -0.15; hd.rotation.x = -0.6; a[0].shoulder.rotation.z = -1.5; a[1].shoulder.rotation.z = 1.5; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -1.2;
    } else if (code === 8) { // saut
      sp.rotation.x = 0.3; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -2.4;
    } else if (code === 11) { // chaînes : les deux bras tendus vers la cible, secoués
      sp.rotation.x = 0.35; hd.rotation.x = 0.1; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -1.55 + Math.sin(t * 22) * 0.12; a[0].shoulder.rotation.z = -0.25; a[1].shoulder.rotation.z = 0.25;
    } else if (code === 12) { // hache lancée : bras droit levé derrière la tête, l'autre tendu vers la cible
      sp.rotation.x = -0.25; hd.rotation.x = -0.15; a[1].shoulder.rotation.x = -3.1 + Math.sin(t * 10) * 0.08; a[1].elbow.rotation.x = -0.3; a[0].shoulder.rotation.x = -1.4;
    } else if (code === 13) { // glas : bras levés, frappe en cadence
      const hit = Math.abs(Math.sin(t * 2.6));
      sp.rotation.x = -0.2 + hit * 0.5; hd.rotation.x = -0.4 + hit * 0.6; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -2.9 + hit * 2.2; a[0].shoulder.rotation.z = -0.2; a[1].shoulder.rotation.z = 0.2;
    } else if (code === 14) { // marque : il désigne du bras
      sp.rotation.x = 0.15; hd.rotation.x = 0.2; a[1].shoulder.rotation.x = -1.6; a[1].elbow.rotation.x = -0.1; a[0].shoulder.rotation.x = -0.3;
    }
  }
}
