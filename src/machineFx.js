import * as THREE from 'three';
import { CONFIG, PAP_LEVELS } from './config.js';
import { makeDisplay } from './weaponDisplay.js';
import { makeTeddy } from './machines.js';

// Boîte mystère et Pack-a-Punch : animations et logique partagée entre tous les joueurs.
//  - Boîte : l'hôte tire l'arme (et le nounours), tout le monde voit défiler les armes ; l'arme proposée reste
//    OFFER_TIME secondes au-dessus de la boîte et n'importe quel joueur peut la prendre (touche E), le premier gagne.
//  - Pack-a-Punch : l'arme du joueur entre dans la machine, qui s'agite quelques secondes ; elle ressort améliorée
//    et il faut la reprendre à la main. Tout le monde assiste à l'animation.
export function installMachineFx(game, { world, hud, sfx, fx }) {
  let display = null;
  const getDisplay = () => display || (display = makeDisplay(2.5));
  const myId = () => game.net?.id ?? null;
  const isMe = (pid) => pid == null || pid === myId();
  const nameOf = (pid) => (isMe(pid) ? 'Vous' : game.remotes.get(pid)?.name || 'Un joueur');
  const P = () => CONFIG.pap;
  const tmp = new THREE.Vector3();
  const SPARKS = [null, [0xc060ff, 0xff9aff, 0x8a3aff], [0x5aa0ff, 0x9ac8ff, 0x1a6cff], [0xff8a30, 0xffc070, 0xff6a10]]; // étincelles du Pack-a-Punch selon le niveau visé

  // Faisceau de lumière au-dessus de la boîte pendant le tirage
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.7, 3.2, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 2.1;

  const detach = (d) => { d.root.parent?.remove(d.root); d.root.rotation.set(0, 0, 0); d.root.scale.setScalar(1); d.root.visible = true; d.show(null); };

  Object.assign(game, {
    boxRoll: null,
    papAnim: null,

    // =============================================================== Boîte mystère
    // Hôte / solo : tire l'arme (sans celles que l'acheteur possède déjà) et lance le tirage chez tout le monde.
    hostBoxRoll(buyer, owned = []) {
      if (this.boxRoll || this.boxMove || !world.boxes?.some((b) => b.active)) return false;
      const pool = Object.entries(CONFIG.box.pool).filter(([id]) => !owned.includes(id));
      const total = pool.reduce((s, [, w]) => s + w, 0);
      let r = Math.random() * total, pick = pool[0]?.[0] || 'smg';
      for (const [id, w] of pool) { if ((r -= w) <= 0) { pick = id; break; } }
      const teddy = this.countBoxUse();
      const msg = { t: 'box_roll', buyer, result: pick, teddy };
      this.net?.send(msg);
      this.startBoxRoll(msg);
      return true;
    },

    startBoxRoll({ buyer, result, teddy }) {
      const m = (world.boxes || []).find((b) => b.active);
      if (!m || this.boxRoll) return;
      const d = getDisplay();
      m.group.add(d.root);
      d.root.position.set(0, 0.7, 0);
      d.root.scale.setScalar(1);
      m.group.add(beam);
      if (m.group.userData.sign) m.group.userData.sign.visible = false; // l'écriteau cacherait les armes
      const ids = d.poolIds().filter((id) => id !== result);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      this.boxRoll = { machine: m, buyer, result, teddy, disp: d, phase: 'roll', t: 0, age: 0, dur: CONFIG.box.spin, tickT: 0, k: 0, order: ids, offerT: 0, teddyObj: null };
      sfx.jingle();
    },

    updateBoxRoll(dt) {
      const r = this.boxRoll;
      if (!r) return;
      const lid = r.machine.group.userData.lid, D = r.disp;
      r.age += dt;
      beam.material.opacity = r.phase === 'roll' ? 0.1 + 0.05 * Math.sin(r.age * 18) : r.phase === 'offer' ? 0.07 : Math.max(0, beam.material.opacity - dt);
      if (r.phase === 'roll') {
        r.t += dt;
        const p = Math.min(1, r.t / r.dur);
        if (lid) lid.rotation.x = -Math.min(1.25, r.t * 2.5);
        D.root.position.y = 0.7 + 1.0 * (1 - Math.pow(1 - Math.min(1, r.t / 0.9), 2)) + Math.sin(r.age * 5) * 0.04;
        D.root.rotation.y += dt * (5 - 3.5 * p);
        r.tickT -= dt;
        if (r.tickT <= 0) { // les armes défilent de plus en plus lentement
          r.tickT = 0.055 + 0.42 * p * p * p;
          D.show(r.order[r.k++ % r.order.length]);
          sfx.tick?.(p);
        }
        if (r.t >= r.dur) {
          if (r.teddy) {
            D.show(null);
            const t = makeTeddy();
            t.scale.setScalar(2.4);
            r.machine.group.add(t);
            r.teddyObj = t;
            r.phase = 'teddy'; r.t = 0;
            sfx.nuke?.();
          } else {
            D.show(r.result);
            D.root.rotation.y = Math.PI * 0.5;
            r.phase = 'offer'; r.offerT = CONFIG.box.offerTime;
            sfx.powerup();
          }
        }
        return;
      }
      if (r.phase === 'teddy') {
        r.t += dt;
        r.teddyObj.position.set(0, 1.0 + Math.min(1, r.t) * 0.5 + Math.abs(Math.sin(r.t * 7)) * 0.12, 0);
        r.teddyObj.rotation.y += dt * 4;
        if (r.t >= 2.2) {
          r.machine.group.remove(r.teddyObj);
          if (isMe(r.buyer)) { this.addPoints(CONFIG.box.price, 'bonus'); hud.announce('NOUNOURS !', 'La boîte mystère s’en va… (remboursé)', 3000); }
          else hud.announce('NOUNOURS !', 'La boîte mystère s’en va…', 2500);
          if (!this.isClient) this.hostMoveBox();
          this.endBoxRoll();
        }
        return;
      }
      if (r.phase === 'offer') {
        r.offerT -= dt;
        D.root.rotation.y += dt * 1.4;
        D.root.position.y = 1.7 + Math.sin(r.age * 3) * 0.07;
        D.root.visible = r.offerT > 3 || Math.floor(r.age * 8) % 2 === 0; // clignote avant de disparaître
        if (r.offerT <= 0) {
          if (!this.isClient) this.net?.send({ t: 'box_expire' });
          r.phase = 'sink'; r.t = 0; D.root.visible = true;
        }
        return;
      }
      if (r.phase === 'sink') { // l'arme n'a pas été prise : elle retombe dans la boîte, le couvercle se ferme
        r.t += dt;
        D.root.position.y -= dt * 3;
        D.root.scale.setScalar(Math.max(0.05, 1 - r.t * 1.6));
        if (lid) lid.rotation.x = -Math.max(0, 1.25 - r.t * 3);
        if (r.t >= 0.6) this.endBoxRoll();
      }
    },

    endBoxRoll() {
      const r = this.boxRoll;
      if (!r) return;
      detach(r.disp);
      r.machine.group.remove(beam);
      if (r.machine.group.userData.sign) r.machine.group.userData.sign.visible = true;
      if (r.teddyObj) r.machine.group.remove(r.teddyObj);
      const lid = r.machine.group.userData.lid;
      if (lid) lid.rotation.x = 0;
      this.boxRoll = null;
    },

    // L'arme proposée est prise par le premier joueur qui appuie sur E
    takeBoxWeapon() {
      const r = this.boxRoll;
      if (!r || r.phase !== 'offer' || r.taken) return;
      if (this.isClient) this.net?.send({ t: 'box_take' });
      else this.hostBoxTake(myId());
    },
    hostBoxTake(pid) {
      const r = this.boxRoll;
      if (!r || r.phase !== 'offer' || r.taken || r.offerT <= 0) return;
      r.taken = true;
      this.net?.send({ t: 'box_taken', pid });
      this.onBoxTaken(pid);
    },
    onBoxTaken(pid) {
      const r = this.boxRoll;
      if (!r) return;
      r.taken = true;
      const id = r.result;
      this.endBoxRoll();
      if (isMe(pid)) {
        this.player.giveWeapon(id);
        sfx.buy();
        hud.announce(CONFIG.weapons[id].name, 'Boîte mystère', 2500);
      } else {
        hud.announce(`${nameOf(pid)} a pris ${CONFIG.weapons[id].name}`, 'Boîte mystère', 2000);
      }
    },

    // Achat d'un tirage (le joueur paie tout de suite ; l'hôte peut refuser si la boîte est déjà occupée)
    buyBox() {
      const p = this.player;
      if (this.boxRoll || this.boxMove) return;
      if (this.points < CONFIG.box.price) { sfx.deny(); return; }
      this.points -= CONFIG.box.price;
      const owned = p.inventory.map((w) => w.id);
      if (this.isClient) this.net?.send({ t: 'box_req', owned });
      else if (!this.hostBoxRoll(myId(), owned)) { this.points += CONFIG.box.price; sfx.deny(); }
    },

    boxPrompt(m) {
      const p = this.player, r = this.boxRoll;
      if (r && r.machine === m) {
        if (r.phase === 'offer') {
          const cfg = CONFIG.weapons[r.result];
          const swap = p.inventory.length >= p.maxWeapons && !p.hasWeapon(r.result);
          return `${game.binds.tag('interact')} Prendre ${cfg.name} — ${Math.ceil(r.offerT)} s${swap ? ' (remplace l’arme en main)' : ''}`;
        }
        return 'La boîte mystère tourne…';
      }
      if (r) return 'Une boîte mystère est déjà en cours';
      const full = p.inventory.length >= p.maxWeapons;
      return `${game.binds.tag('interact')} Boîte mystère : arme au hasard (${CONFIG.box.price} pts)${full ? ' — remplace l’arme en main' : ''}`;
    },

    resetBoxRoll() { this.endBoxRoll(); },

    // =============================================================== Pack-a-Punch
    // Amélioration d'un niveau (0 -> I -> II -> III) : chaque niveau a son prix (PAP_LEVELS), payé avec ses propres points ; refusé au niveau III
    buyPap() {
      const p = this.player;
      const lv = (p.curW.pap | 0) + 1;
      if (this.papAnim || lv >= PAP_LEVELS.length) return;
      const price = PAP_LEVELS[lv].price;
      if (this.points < price) { sfx.deny(); return; }
      this.points -= price;
      this._papPaid = price; // remboursé si l'hôte refuse (pap_deny)
      p.locked = true; // l'arme est dans la machine : on ne peut ni tirer ni la changer
      this._papIdx = p.weaponIdx;
      const w = p.curW.id;
      if (this.isClient) this.net?.send({ t: 'pap_req', w, lv });
      else if (!this.hostPapStart(myId(), w, lv)) { this.points += price; this._papPaid = 0; p.locked = false; sfx.deny(); }
    },
    hostPapStart(owner, w, lv = 1) {
      if (this.papAnim) return false;
      lv = Math.max(1, Math.min(PAP_LEVELS.length - 1, lv | 0)); // niveau visé
      const msg = { t: 'pap_start', owner, w, lv };
      this.net?.send(msg);
      this.startPapAnim(msg);
      return true;
    },
    startPapAnim({ owner, w, lv = 1 }) {
      const m = (world.machines || []).find((x) => x.type === 'pap');
      if (!m || this.papAnim) return;
      lv = Math.max(1, Math.min(PAP_LEVELS.length - 1, lv | 0));
      const d = getDisplay();
      m.group.add(d.root);
      const U = m.group.userData;
      d.root.position.set(U.anchor[0], U.anchor[1], U.anchor[2]);
      d.root.rotation.set(0, Math.PI / 2, 0);
      d.root.scale.setScalar(1);
      d.show(w, lv - 1); // l'arme entre dans la machine avec son niveau actuel
      this.papAnim = { machine: m, owner, w, lv, disp: d, phase: 'in', t: 0, age: 0, base: m.group.position.clone(), puffT: 0 };
      sfx.pap();
    },
    updatePap(dt) {
      const a = this.papAnim;
      if (!a) return;
      const m = a.machine, U = m.group.userData, D = a.disp, cfg = P();
      a.age += dt; a.t += dt;
      const slotUp = (v) => { U.slotDoor.position.y = U.slotY + v * 0.2; };
      const spark = (n) => {
        tmp.set((Math.random() - 0.5) * 0.9, 0.55 + Math.random() * 0.5, 1.0);
        m.group.localToWorld(tmp);
        fx.emit(tmp.x, tmp.y, tmp.z, { count: n, color: SPARKS[a.lv] || SPARKS[1], speed: 1.6, up: 1.4, size: 0.045, life: 0.7, grav: 1 });
      };
      if (a.phase === 'in') { // l'arme glisse dans la fente
        const k = Math.min(1, a.t / cfg.inTime), e = k * k * (3 - 2 * k);
        slotUp(Math.min(1, a.t / 0.3));
        D.root.position.z = U.anchor[2] + (0.55 - U.anchor[2]) * e;
        D.root.position.y = U.anchor[1] + (U.slotY + 0.1 - U.anchor[1]) * e;
        D.root.scale.setScalar(1 - 0.55 * e);
        if (k >= 1) { a.phase = 'work'; a.t = 0; D.root.visible = false; slotUp(0); sfx.papWork?.(); }
        return;
      }
      if (a.phase === 'work') { // la machine s'agite
        const k = a.t / cfg.workTime;
        const amp = 0.006 + 0.014 * k;
        m.group.position.set(a.base.x + (Math.random() - 0.5) * amp * 2, a.base.y, a.base.z + (Math.random() - 0.5) * amp * 2);
        for (const r of U.rollers || []) r.rotation.x += dt * (8 + 22 * k);
        for (const g of U.gears || []) g.rotation.x += dt * (4 + 14 * k);
        U.front.emissiveIntensity = 1.2 + 1.3 * Math.abs(Math.sin(a.age * (6 + 10 * k)));
        if (Math.random() < dt * (10 + 40 * k)) spark(1 + Math.floor(Math.random() * 3));
        a.puffT -= dt;
        if (a.puffT <= 0) { a.puffT = 0.45 - 0.3 * k; sfx.tick?.(0.9); }
        if (a.t >= cfg.workTime) {
          a.phase = 'out'; a.t = 0;
          m.group.position.copy(a.base);
          D.showPap(a.w, a.lv);
          D.root.visible = true;
          sfx.pap();
          spark(30);
        }
        return;
      }
      if (a.phase === 'out') { // elle ressort, améliorée
        const k = Math.min(1, a.t / cfg.outTime), e = 1 - Math.pow(1 - k, 3);
        slotUp(Math.min(1, a.t / 0.2));
        U.front.emissiveIntensity = 1.0 + 1.5 * (1 - k);
        D.root.position.z = 0.55 + (U.anchor[2] - 0.55) * e;
        D.root.position.y = U.slotY + 0.1 + (U.anchor[1] - U.slotY - 0.1) * e;
        D.root.scale.setScalar(0.45 + 0.55 * e);
        for (const g of U.gears || []) g.rotation.x += dt * 4 * (1 - k);
        if (k >= 1) { a.phase = 'offer'; a.t = 0; slotUp(0); U.front.emissiveIntensity = 1.0; }
        return;
      }
      // proposée au joueur : il doit venir la prendre
      D.root.rotation.y += dt * 1.2;
      D.root.position.y = U.anchor[1] + Math.sin(a.age * 3) * 0.05;
      D.pulse(a.age); // niveau III : le reflet pulse
      if (Math.random() < dt * 8) spark(1);
      if (a.t >= cfg.offerTime) {
        if (isMe(a.owner)) this.takePap(true); // trop tard : on la lui rend automatiquement
        else if (a.t >= cfg.offerTime + 2) this.endPap(); // filet de sécurité si le propriétaire est parti
      }
    },
    takePap(auto = false) {
      const a = this.papAnim, p = this.player;
      if (!a || a.phase !== 'offer' || !isMe(a.owner)) return;
      const idx = this._papIdx ?? p.weaponIdx;
      p.locked = false;
      if (p.inventory[idx]) p.switchWeapon(idx);
      p.upgradeCurrent();
      sfx.powerup();
      const lvName = `niveau ${PAP_LEVELS[p.curW.pap | 0].roman}`;
      hud.announce(p.curCfg.name, auto ? `Arme améliorée (${lvName}) : reprise automatiquement` : `Arme améliorée au Pack-a-Punch ! (${lvName})`, 2800);
      this.net?.send({ t: 'pap_taken' });
      this.endPap();
    },
    endPap() {
      const a = this.papAnim;
      if (!a) return;
      detach(a.disp);
      a.machine.group.position.copy(a.base);
      const U = a.machine.group.userData;
      U.slotDoor.position.y = U.slotY; U.front.emissiveIntensity = 1.0;
      this.papAnim = null;
    },
    papPrompt(m) {
      const a = this.papAnim, p = this.player;
      if (a && a.machine === m) {
        if (a.phase === 'offer') return isMe(a.owner) ? `${game.binds.tag('interact')} Récupérer ${CONFIG.papNames[a.w] ? CONFIG.papNames[a.w] + (a.lv > 1 ? ' ' + PAP_LEVELS[a.lv].roman : '') : 'l’arme améliorée'}` : `${nameOf(a.owner)} récupère son arme…`;
        return isMe(a.owner) ? 'Amélioration en cours…' : `Amélioration de ${nameOf(a.owner)} en cours…`;
      }
      if (a) return 'Le Pack-a-Punch est occupé';
      const lv = (p.curW.pap | 0) + 1;
      if (lv >= PAP_LEVELS.length) return `${p.curCfg.name} est au niveau maximum`;
      return `${game.binds.tag('interact')} Pack-a-Punch : ${lv > 1 ? 'passer' : 'améliorer'} ${p.curCfg.name} au niveau ${PAP_LEVELS[lv].roman} (${PAP_LEVELS[lv].price} pts)`;
    },
    resetPap() {
      this.endPap();
      this.player.locked = false;
    },
  });
}
