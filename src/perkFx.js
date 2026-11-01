import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Neuf atouts supplémentaires (v0.71.0), repris du port Godot (sim/perk_fx.gd). Réglages : CONFIG.perkFx ; fiches (nom, prix, couleur) : CONFIG.perks.
//    deadshot ŒIL-DE-LYNX : tête x1,5, dispersion x0,65 (player.js, statsOf)         bandolier CARTOUCHIÈRE : réserve x1,5 (player.js, statsOf)
//    electriccherry : recharger libère une décharge, d'autant plus forte que le chargeur était vide
//    widowswine : frappé par un zombie, une toile ralentit les zombies proches ; le couteau ralentit sa cible
//    vultureaid : une part des zombies tués lâche une goutte (munitions ou points)
//    tombstone : à terre, les autres atouts restent dans une tombe à récupérer (5 s à 90 s)
//    dyingwish : un coup fatal laisse à 1 PV et invulnérable quelques secondes (longue recharge)
//    stronghold : immobile (3 m depuis 1,5 s) : dégâts reçus x0,7
//    deathperception : radar x1,6 (hud.js) ; 10 % de coups critiques (dégâts x2)
//  Tout est local au joueur (comme l'achat des atouts) ; l'hôte ou le solo traite les kills (Vautour).
// =====================================================================
const F = () => CONFIG.perkFx;

export function installPerkFx(game, { scene, fx, hud, sfx }) {
  const st = { cherryCd: 0, webCd: 0, wishCd: 0, invuln: 0, anchor: null, settle: 0, drops: [], tomb: null };
  const has = (id) => !!game.player.perks[id];

  const dropMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x8a8f3a, emissive: 0xb8c040, emissiveIntensity: 1.2, roughness: 0.6, metalness: 0.4 }),
    points: new THREE.MeshStandardMaterial({ color: 0xc9a12a, emissive: 0xffd34a, emissiveIntensity: 1.2, roughness: 0.5, metalness: 0.6 }),
  };
  const dropGeo = new THREE.OctahedronGeometry(0.22, 0);
  const tombMat = new THREE.MeshStandardMaterial({ color: 0x6b6e72, roughness: 0.85, metalness: 0.1, emissive: 0x2a3340, emissiveIntensity: 0.6 });

  const makeTomb = (pos) => {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.18), tombMat);
    slab.position.y = 0.5;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 14, 1, false, 0, Math.PI), tombMat);
    top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = 1.0;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.5), tombMat);
    foot.position.y = 0.06;
    g.add(slab, top, foot);
    g.position.set(pos.x, pos.y, pos.z);
    scene.add(g);
    return g;
  };
  const removeTomb = () => { if (st.tomb) { scene.remove(st.tomb.mesh); st.tomb = null; } };
  const burst = (x, y, z, color, count = 14) => fx.emit(x, y, z, { count, color, speed: 3, up: 2.5, size: 0.08, life: 0.6, grav: 4, spread: 1, glow: true });

  const api = {
    st,
    get invuln() { return st.invuln; },
    get slots() { return F().slots; },
    // plein : plus de place pour un atout (hors Bénédiction de l'Aube)
    full() { return !game.blessed && Object.keys(game.player.perks).filter((k) => game.player.perks[k]).length >= F().slots; },

    reset() {
      st.cherryCd = st.webCd = st.wishCd = st.invuln = st.settle = 0; st.anchor = null;
      for (const d of st.drops) scene.remove(d.mesh);
      st.drops.length = 0;
      removeTomb();
    },

    // ----------------------------------------------------------------- pas
    update(dt) {
      st.cherryCd = Math.max(0, st.cherryCd - dt); st.webCd = Math.max(0, st.webCd - dt);
      st.wishCd = Math.max(0, st.wishCd - dt); st.invuln = Math.max(0, st.invuln - dt);
      const p = game.player;
      if (has('stronghold') && !p.downed && !p.dead) { // Bastion : immobile dans `radius` m depuis `settle` s
        if (!st.anchor || Math.hypot(p.pos.x - st.anchor.x, p.pos.z - st.anchor.z) > F().stronghold.radius) { st.anchor = { x: p.pos.x, z: p.pos.z }; st.settle = 0; } else st.settle += dt;
      } else { st.anchor = null; st.settle = 0; }
      for (let i = st.drops.length - 1; i >= 0; i--) { // gouttes du Vautour
        const d = st.drops[i];
        d.life -= dt; d.mesh.rotation.y += dt * 2.5; d.mesh.position.y = d.y + 0.9 + Math.sin(game.time * 3 + d.id) * 0.1;
        if (!p.downed && !p.dead && Math.hypot(d.x - p.pos.x, d.z - p.pos.z) < F().vultureaid.pickup) { pick(d); scene.remove(d.mesh); st.drops.splice(i, 1); }
        else if (d.life <= 0) { scene.remove(d.mesh); st.drops.splice(i, 1); }
      }
      const t = st.tomb;
      if (t) {
        t.life -= dt; t.arm = Math.max(0, t.arm - dt);
        if (t.arm <= 0 && !p.downed && !p.dead && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < F().tombstone.pickup) {
          let n = 0;
          for (const id of t.perks) if (!p.perks[id] && !api.full()) { p.addPerk(id); n++; }
          hud.announce('PIERRE TOMBALE', `Atouts récupérés : ${n}`, 2500);
          sfx.jingle(); burst(t.x, t.y + 0.8, t.z, [0xbfd0e8, 0xffffff]);
          removeTomb();
        } else if (t.life <= 0) removeTomb();
      }
    },

    // ----------------------------------------------------------------- dégâts reçus : renvoie les dégâts réellement encaissés (0 : annulés)
    filterDamage(amount) {
      const p = game.player;
      if (st.invuln > 0) return 0;
      if (st.anchor && st.settle >= F().stronghold.settle && has('stronghold')) amount *= F().stronghold.damageMult;
      if (has('dyingwish') && st.wishCd <= 0 && amount >= p.health) { // Ultime Volonté : le coup fatal laisse à 1 PV
        p.health = 1; p.lastHurt = game.time;
        st.invuln = F().dyingwish.invuln; st.wishCd = F().dyingwish.cooldown;
        hud.announce('ULTIME VOLONTÉ', `Invulnérable ${Math.round(st.invuln)} s !`, 2500);
        burst(p.pos.x, p.pos.y + 1, p.pos.z, [0xffffff, 0xe8ecff], 24);
        return 0;
      }
      return amount;
    },

    // Veuve noire : un zombie vient de frapper le joueur
    onStruck() {
      if (!has('widowswine') || st.webCd > 0 || game.player.dead) return;
      const W = F().widowswine, p = game.player;
      st.webCd = W.cooldown;
      for (const z of game.zombies) if (!z.dead && Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < W.radius) z.slow(W.slow, W.time);
      fx.emit(p.pos.x, p.pos.y + 0.8, p.pos.z, { count: 40, color: [0xe8e4f0, 0xb8b0c8], speed: W.radius * 0.6, up: 0.3, size: 0.06, life: 0.9, grav: 0.2, spread: 1, glow: false });
    },
    onKnife(z) {
      if (has('widowswine') && !z.dead) z.slow(F().widowswine.knifeSlow, F().widowswine.knifeTime);
    },

    // Cerise-foudre : début d'un rechargement (w.ammo = balles restantes AVANT de recharger)
    onReload(w, cfg) {
      if (!has('electriccherry') || st.cherryCd > 0) return;
      const C = F().electriccherry, empty = 1 - w.ammo / Math.max(1, cfg.magSize);
      if (empty < C.minEmpty) return;
      st.cherryCd = C.cooldown;
      const p = game.player, R = C.radius + C.radiusEmpty * empty, dmg = game.zombieHealthAt(Math.max(1, game.round)) * C.healthFrac * empty;
      for (const z of game.zombies.slice()) {
        if (z.dead || !z.targetable || Math.abs(z.pos.y - p.pos.y) > 2.5 || Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) > R) continue;
        game.hitZombie(z, false, new THREE.Vector3(z.pos.x, z.pos.y + 1.1, z.pos.z), dmg, 1, null, false, null);
        burst(z.pos.x, z.pos.y + 1.2, z.pos.z, [0x9fd0ff, 0xff4f8b], 8);
      }
      fx.emit(p.pos.x, p.pos.y + 1, p.pos.z, { count: 36, color: [0x9fd0ff, 0xffffff, 0xff4f8b], speed: R * 1.6, up: 0.4, size: 0.07, life: 0.45, grav: 0, spread: 1, glow: true });
    },

    // Sixième sens : multiplicateur d'un tir
    critMult() {
      if (!has('deathperception') || Math.random() >= F().deathperception.critChance) return 1;
      return F().deathperception.critMult;
    },
    radarMult() { return has('deathperception') ? F().deathperception.radarMult : 1; },

    // Vautour : un zombie vient d'être tué (hôte / solo)
    onKill(z) {
      if (!has('vultureaid') || z.isBoss) return;
      const V = F().vultureaid;
      if (Math.random() >= V.chance) return;
      const type = Math.random() < V.ammoShare ? 'ammo' : 'points';
      const mesh = new THREE.Mesh(dropGeo, dropMat[type]);
      mesh.position.set(z.pos.x, z.pos.y + 0.9, z.pos.z);
      scene.add(mesh);
      st.drops.push({ id: st.drops.length + game.time, x: z.pos.x, y: z.pos.y, z: z.pos.z, type, life: V.life, mesh });
    },

    // Pierre tombale : le joueur tombe (avant que ses atouts ne soient effacés)
    onDown() {
      if (!has('tombstone')) return;
      const p = game.player, keep = Object.keys(p.perks).filter((id) => p.perks[id] && id !== 'tombstone' && id !== 'quickrevive'); // ni elle-même ni la Réanimation rapide (relevés gratuits à l'infini)
      removeTomb();
      st.tomb = { x: p.pos.x, y: p.pos.y, z: p.pos.z, perks: keep, life: F().tombstone.life, arm: F().tombstone.arm, mesh: makeTomb(p.pos) };
    },
  };

  function pick(d) {
    const V = F().vultureaid;
    sfx.powerup?.();
    if (d.type === 'ammo') {
      for (const w of game.player.inventory) { const mx = game.player.statsOf(w).maxReserve; w.reserve = Math.min(mx, w.reserve + Math.ceil(mx * V.ammoFrac)); }
      hud.popup?.('VAUTOUR : MUNITIONS', 'bonus');
    } else {
      game.addPoints(V.points * (game.buffs.doublePoints > 0 ? 2 : 1));
      hud.popup?.(`VAUTOUR : +${V.points} PTS`, 'bonus');
    }
  }

  game.perkFx = api;
  return api;
}
