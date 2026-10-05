import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Le Bourreau : boss de la fin de partie. Colosse encapuchonné armé d'une hache géante.
//  L'hôte joue l'IA (machine à états) ; les autres joueurs reçoivent un code d'état (bs) et animent la même pose.
//   chase     poursuite + coups de hache (IA des zombies, dégâts du boss)
//   charge_tel / dash / stun     charge : trait rouge au sol, puis ruée en ligne droite (étourdi s'il percute un mur)
//   slam_tel / slam     coup de hache au sol : onde de choc circulaire, on l'évite en sautant
//   summon     il hurle et appelle des renforts
//   leap / hidden / rise     changements d'étage (scénarisés par la fin de partie)
//  Codes bs : 0 poursuite, 2 charge (préparation), 3 ruée, 4 étourdi, 5 coup (préparation), 6 coup, 7 appel, 8 saut, 9 absent, 10 surgit
// =====================================================================
const BS = { chase: 0, charge_tel: 2, dash: 3, stun: 4, slam_tel: 5, slam: 6, summon: 7, leap: 8, hidden: 9, rise: 10, recover: 0 };

export class Boss extends Zombie {
  constructor(scene, spawn, health, onEvent, id, opts = {}) {
    super(scene, spawn, health, 2.2, onEvent, id, { boss: true, bossDamage: CONFIG.finale.bossDamage });
    this.isBoss = true;
    this.name = 'LE BOURREAU';
    this.maxHealth = this.health = health;
    this.ctx = opts.ctx || null;
    this.phase = 1;
    this.state = 'chase';
    this.stateT = 0;
    this.cool = { charge: 6, slam: 9, summon: 16 };
    this.invuln = 0;
    this.bs = 0;
    this.dashDir = new THREE.Vector3(0, 0, 1);
    this.hit = new Set();
    this.shock = null;
    this.leaped = false;
    this.group.scale.setScalar(2.25);
    this.limp = false;
    this._buildExecutioner();
  }

  _buildExecutioner() {
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

  // -------------------------------------------------------------- dégâts
  damage(amount, isHead = false) {
    if (this.dead || this.invuln > 0 || this.state === 'hidden' || this.state === 'leap') return false;
    const stunned = this.state === 'stun' ? 2 : 1;
    const f0 = this.health / this.maxHealth;
    const died = super.damage(amount * stunned * (isHead ? 0.7 : 1), false);
    const f = this.health / this.maxHealth;
    if (!died && this.ctx) {
      if (!this.leaped && f0 >= 0.6 && f < 0.6 && this.ctx.wantLeap) this.beginLeap();
      else if (this.phase < 3 && f < 0.3) this.enrage();
    }
    return died;
  }

  get targetable() { return this.state !== 'hidden' && this.state !== 'leap' && super.targetable; }

  enrage() {
    this.phase = 3;
    this.speed = 3.3;
    this.cool.charge = Math.min(this.cool.charge, 2); this.cool.slam = Math.min(this.cool.slam, 3);
    this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z, text: 'LE BOURREAU EST FURIEUX !' });
  }

  beginLeap() {
    this.leaped = true;
    this.phase = 2;
    this.speed = 2.7;
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
    this.cool = { charge: 4, slam: 6, summon: 12 };
    this.ctx?.event('boss_rise', { x, y, z });
    this._riseY = y;
  }

  _setState(s) { this.state = s; this.stateT = 0; this.bs = BS[s] ?? 0; }

  // -------------------------------------------------------------- IA (hôte)
  update(dt, targets, others, world) {
    if (this.net) { super.update(dt, targets, others, world); this._pose(); return; }
    if (this.dead || this.spawnT > 0) { super.update(dt, targets, others, world); return; }
    const lv = world.levels;
    const baseY = this.region && lv ? lv.regions[this.region].y : 0;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const m of this.mats) m.emissive.setHex(this.hitFlash > 0 ? 0x660000 : this.state === 'stun' ? 0x222200 : 0x000000);
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    const cand = targets.filter((t) => t && !t.dead && !t.downed && (t.tregion || 0) === this.region);
    const nearest = () => { let b = null, bd = Infinity; for (const t of cand) { const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d < bd) { bd = d; b = t; } } return [b, bd]; };
    const face = (dx, dz, k = 8) => { let d = Math.atan2(dx, dz) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * k); this.group.rotation.set(0, this.yaw, 0); };
    const hurt = (p, dmg, kx, kz) => { if (this.ctx) this.ctx.hurtPlayer(p, dmg, kx, kz); };
    this.pos.y = this.state === 'rise' ? this.pos.y : baseY;

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
        if (!tg) { this.walkT += dt * 1.2; this._pose(); break; }
        super.update(dt, cand, others, world); // poursuite et coups de hache : IA des zombies
        this.bs = 0;
        if (this.attackWindup >= 0) break;
        if (this.cool.charge <= 0 && d > 4.5 && d < 20) this._startCharge(tg);
        else if (this.cool.slam <= 0 && d < 7.5) this._setState('slam_tel');
        else if (this.phase >= 2 && this.cool.summon <= 0) this._setState('summon');
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
        for (const t of cand) {
          if (this.hit.has(t) || Math.abs(t.pos.y - this.pos.y) > 2.2) continue;
          if (Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 2.0) { this.hit.add(t); hurt(t, CONFIG.finale.chargeDamage, this.dashDir.x * 9, this.dashDir.z * 9); }
        }
        if (this._wall >= 2) { this.ctx?.event('boss_stun', { x: this.pos.x, y: this.pos.y, z: this.pos.z }); this.ctx?.dust(this.pos.x, baseY + 1, this.pos.z, 16); this._setState('stun'); }
        else if (this.stateT > 1.4) this._setState('recover');
        break;
      }
      case 'stun':
        this.walkT += dt * 2;
        if (this.stateT >= 2.4) { this._setState('chase'); this.cool.charge = 8 * Math.pow(0.8, this.phase - 1); }
        break;
      case 'recover':
        this.walkT += dt * 1.5;
        if (this.stateT >= 0.8) { this._setState('chase'); this.cool.charge = 8 * Math.pow(0.8, this.phase - 1); }
        break;
      case 'slam_tel': {
        const [tg] = nearest();
        if (tg) face(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z, 6);
        if (this.stateT >= 1.0) { this.shock = { r: 0.5, hit: new Set() }; this.ctx?.event('boss_shock', { x: this.pos.x, y: baseY, z: this.pos.z }); this._setState('slam'); }
        break;
      }
      case 'slam': {
        const s = this.shock;
        if (s) {
          s.r += 15 * dt;
          for (const t of cand) {
            if (s.hit.has(t)) continue;
            const dd = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
            if (Math.abs(dd - s.r) > 1.1 || Math.abs(t.pos.y - this.pos.y) > 2.6) continue;
            const airborne = t.pos.y > baseY + 0.45; // en l'air : l'onde passe dessous
            s.hit.add(t);
            if (!airborne) hurt(t, CONFIG.finale.slamDamage, ((t.pos.x - this.pos.x) / (dd || 1)) * 7, ((t.pos.z - this.pos.z) / (dd || 1)) * 7);
          }
          if (s.r > 13) this.shock = null;
        }
        if (this.stateT >= 1.1) { this._setState('chase'); this.cool.slam = 9 * Math.pow(0.8, this.phase - 1); }
        break;
      }
      case 'summon':
        if (this.stateT > 0.9 && !this._summoned) { this._summoned = true; this.ctx?.summon(this); this.ctx?.event('boss_roar', { x: this.pos.x, y: this.pos.y, z: this.pos.z }); }
        if (this.stateT >= 1.9) { this._summoned = false; this.cool.summon = 20 * Math.pow(0.8, this.phase - 1); this._setState('chase'); }
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
    }
  }
}
