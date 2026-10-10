import * as THREE from 'three';
import { Boss } from './boss.js';
import { Zombie } from './zombie.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Le Maître Tanneur : mini-boss des quartiers de Petite France et de Saint-Pierre-le-Vieux (manches 15, 20, 25…, CONFIG.tanner).
//  Sous-classe du Bourreau (même relais réseau : le code d'état bs, l'hôte joue l'IA), mais une seule vraie attaque :
//   vomit_tel / vomit   cône de vomi : annoncé `tel` s, `initial` dégâts puis `dps` par seconde pendant `duration` s (le PHD Flopper ne protège pas)
//   summon              appelle `summon.count` pestiférés
//  À sa mort : explosion de rayon `explosion.radius` (le PHD Flopper protège), Max Munitions, points à chaque joueur (finale.js, onFinaleKill).
//  Codes bs : 0 poursuite, 7 appel, 15 vomi (annonce), 16 vomi
// =====================================================================
const BS = { chase: 0, summon: 7, vomit_tel: 15, vomit: 16 };

export class Tanner extends Boss {
  constructor(scene, spawn, health, onEvent, id, opts = {}) {
    super(scene, spawn, health, onEvent, id, { ...opts, name: 'MAÎTRE TANNEUR', speed: CONFIG.tanner.speed, damage: CONFIG.tanner.damage, scale: 2.0 });
    this.mini = true;
    this.state = 'chase';
    this.cool = { vomit: 3, summon: 9 };
    this.vomitDir = new THREE.Vector3(0, 0, 1);
    this.phase = 1;
  }

  // modèle : pestiféré colossal en tablier de tanneur, masque à tubes, ventre gonflé de gaz
  _buildBody() {
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9 });
    const gas = new THREE.MeshStandardMaterial({ color: 0x7aa830, roughness: 0.6, emissive: 0x233a08 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.4, metalness: 0.85 });
    for (const m of this.mats) m.color.setHex(0x6f8a4a).multiplyScalar(0.8);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 9), gas); belly.position.set(0, 0.12, 0.13); belly.scale.set(1.15, 1.05, 0.95); this.spine.add(belly);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.05), leather); apron.position.set(0, 0.15, 0.37); this.spine.add(apron);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.5), leather); strap.position.set(0.12, 0.28, 0); this.spine.add(strap);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), dark); mask.position.set(0, 0.05, 0.03); mask.scale.set(1, 1.05, 1.05); this.headGroup.add(mask);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 8), iron); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.02, 0.15); this.headGroup.add(snout);
    for (const sx of [-1, 1]) {
      const tube = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 5, 14, Math.PI), dark); tube.position.set(sx * 0.07, -0.03, 0.12); tube.rotation.set(0, sx * 0.5, Math.PI); this.headGroup.add(tube);
      const glove = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.3, 8), leather); glove.position.set(0, -0.2, 0); this.arms[sx < 0 ? 0 : 1].elbow.add(glove);
    }
    for (const e of this.eyes) { e.material = e.material.clone(); e.material.color.setHex(0xb8ff30); e.scale.setScalar(1.5); }
    this.axe = null; this.lantern = null; this.lanternGlow = null;
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  _enterPhase() { this.cool = this.cool || {}; this.speed = CONFIG.tanner.speed; }
  get invulnerable() { return false; }

  // un mini-boss prend les dégâts comme un zombie ordinaire (pas de sensibilités du Bourreau)
  damage(amount, isHead = false) { return Zombie.prototype.damage.call(this, amount, isHead); }

  _setState(s) { this.state = s; this.stateT = 0; this.bs = BS[s] ?? 0; }

  update(dt, targets, others, world) {
    if (this.net || this.dead || this.spawnT > 0) {
      if (this.net) { this.glow = 0; }
      Zombie.prototype.update.call(this, dt, targets, others, world);
      if (!this.dead && this.spawnT <= 0) this._pose();
      return;
    }
    const T = CONFIG.tanner;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    const cand = targets.filter((t) => t && !t.dead && !t.downed && (t.tregion || 0) === this.region);
    const hurt = (p, dmg, src) => { if (this.ctx) this.ctx.hurtPlayer(p, dmg, 0, 0, src); };
    const face = (dx, dz, k = 8) => { let d = Math.atan2(dx, dz) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * k); this.group.rotation.set(0, this.yaw, 0); };
    let nearest = null, nd = Infinity;
    for (const t of cand) { const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d < nd) { nd = d; nearest = t; } }
    switch (this.state) {
      case 'chase': {
        if (!nearest) { this.walkT += dt * 1.2; this._pose(); break; }
        Zombie.prototype.update.call(this, dt, cand, others, world);
        this.bs = 0;
        if (this.attackWindup >= 0) break;
        if (this.cool.vomit <= 0 && nd < T.vomit.range - 1.5) {
          this.vomitDir.set(nearest.pos.x - this.pos.x, 0, nearest.pos.z - this.pos.z).normalize();
          this._setState('vomit_tel');
          this.ctx?.event('tanner_vomit', { x: this.pos.x, y: this.pos.y, z: this.pos.z, dx: this.vomitDir.x, dz: this.vomitDir.z, range: T.vomit.range, ang: T.vomit.angle, tel: T.vomit.tel, dur: T.vomit.duration });
        } else if (this.cool.summon <= 0) this._setState('summon');
        break;
      }
      case 'vomit_tel':
        face(this.vomitDir.x, this.vomitDir.z, 10);
        this.walkT += dt * 2;
        if (this.stateT >= T.vomit.tel) { this._setState('vomit'); this._vTick = 0; this._vHit = new Set(); this._inCone(cand, T, (p) => { this._vHit.add(p); hurt(p, T.vomit.initial, 'toxic'); }); }
        break;
      case 'vomit':
        face(this.vomitDir.x, this.vomitDir.z, 1.5);
        this._vTick -= dt;
        if (this._vTick <= 0) { this._vTick = T.vomit.tick; this._inCone(cand, T, (p) => hurt(p, T.vomit.dps * T.vomit.tick, 'toxic')); }
        if (this.stateT >= T.vomit.duration) { this.cool.vomit = T.vomit.cooldown; this._setState('chase'); }
        break;
      case 'summon':
        this.walkT += dt * 1.5;
        if (this.stateT > 0.8 && !this._summoned) { this._summoned = true; this.ctx?.summonPest?.(this); }
        if (this.stateT >= 1.6) { this._summoned = false; this.cool.summon = T.summon.cooldown; this._setState('chase'); }
        break;
      default: this._setState('chase'); break;
    }
    if (this.state !== 'chase') {
      for (const m of this.mats) m.emissive.setHex(this.hitFlash > 0 ? 0x660000 : 0x0a1604);
      this._pose();
    }
  }

  // joueurs dans le cône de vomi (portée, demi-angle, étage)
  _inCone(list, T, f) {
    const cos = Math.cos((T.vomit.angle * Math.PI) / 180);
    for (const p of list) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > T.vomit.range || Math.abs(p.pos.y - this.pos.y) > 2.4) continue;
      if (d > 0.8 && (dx * this.vomitDir.x + dz * this.vomitDir.z) / d < cos) continue;
      f(p);
    }
  }

  _pose(walk, amp, reach, lean, nod) {
    if (arguments.length) { Zombie.prototype._pose.call(this, walk, amp, reach, lean, nod); return; }
    const code = this.net ? (this.net.bs || 0) : this.bs;
    const t = this.stateT + (this.net ? this.walkT : 0), a = this.arms, sp = this.spine, hd = this.headGroup;
    if (code === 0) { Zombie.prototype._pose.call(this, this.walkT, 1, 1.1, 0.3, 0.2); return; }
    Zombie.prototype._pose.call(this, this.walkT, 0.15, 0.5, 0.2, 0.1);
    if (code === 15) { // il prend sa respiration : tête en arrière, ventre en avant
      sp.rotation.x = -0.4; hd.rotation.x = -0.8; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -0.3; hd.rotation.z = Math.sin(t * 20) * 0.08;
    } else if (code === 16) { // il vomit : penché en avant, la tête balaie le cône
      sp.rotation.x = 0.55; hd.rotation.x = 0.7 + Math.sin(t * 9) * 0.1; hd.rotation.y = Math.sin(t * 3) * 0.25; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -0.9;
    } else if (code === 7) { // appel
      sp.rotation.x = -0.15; hd.rotation.x = -0.6; a[0].shoulder.rotation.z = -1.5; a[1].shoulder.rotation.z = 1.5; a[0].shoulder.rotation.x = a[1].shoulder.rotation.x = -1.2;
    }
  }
}
