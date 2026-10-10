import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Zombie } from './zombie.js';
import { Boss } from './boss.js';

// =====================================================================
//  « L'Heure du Jugement » : la fin de partie, jouée par l'hôte et suivie par tous les joueurs.
//   intro -> 3 vagues (crypte, galeries, portes) -> le Bourreau dans la nef -> il fuit : ascension de la tour sud ->
//   combat final sur la plateforme à 67,5 m -> victoire (puis mode infini).
//  Les zombies de la fin de partie n'apparaissent pas comme dans une manche : ils surgissent de la crypte, des galeries
//  du triforium et des portes du parvis, puis poursuivent les joueurs d'étage en étage.
// =====================================================================
export function installFinale(game, { world, scene, hud, sfx, fx }) {
  const F = () => CONFIG.finale;
  const lv = () => world.levels;
  const C = world.cathedral;
  const myId = () => game.net?.id ?? null;
  const players = () => [game.player, ...game.remotes.values()];
  const standing = () => players().filter((p) => !p.dead && !p.downed);
  const R = {}; // régions utiles : crypt, R2, R3, W2, PL
  for (const r of lv().regions) {
    if (r.name === 'Crypte romane') R.crypt = r.id;
    else if (r.name === 'Triforium') R.R2 = r.id;
    else if (r.name === 'Galerie haute') R.R3 = r.id;
    else if (r.name === 'Salle des cloches') R.W2 = r.id;
    else if (r.name === 'Plateforme') R.PL = r.id;
  }

  // ---------------------------------------------------------------- effets visuels partagés (matériaux additifs : aucun nouveau shader)
  const fxMat = () => new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rings = [], lines = [];
  const shockRing = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), fxMat());
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.12, z);
    scene.add(m); rings.push({ m, t: 0 });
  };
  const teleLine = (x, z, dx, dz, y) => {
    const len = 22, g = new THREE.Group();
    g.position.set(x, y + 0.12, z); g.rotation.y = Math.atan2(dx, dz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, len), fxMat());
    m.rotation.x = Math.PI / 2; m.position.set(0, 0, len / 2);
    g.add(m); scene.add(g); lines.push({ g, t: 0 });
  };
  const dust = (x, y, z, n = 6) => fx.emit(x, y, z, { count: n, color: [0x9a9a96, 0x77746f, 0x5a5650], speed: 2.4, up: 1.6, size: 0.12, life: 1.0, grav: 3, spread: 0.8 });
  const dispose = (o) => { scene.remove(o); o.traverse?.((q) => { if (q.isMesh) { q.geometry.dispose(); q.material.dispose(); } }); };

  // ---- attaques de la v0.36.0 : Chaînes, couronne de la Sentence, Couperet, Bûcher (matériaux additifs, rien à compiler en plus)
  const chains = [], crowns = new Map(), axes = [], pyres = [];
  const IRON = new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.4, metalness: 0.9, emissive: 0x181a1e });
  const bossObj = () => (game.finale && game.finale.boss) || game.zombies.find((z) => z.isBoss && !z.mini && !z.dead) || null;
  const playerOf = (pid) => (pid == null ? game.player : pid === myId() ? game.player : game.remotes.get(pid) || null);
  const pidOf = (p) => (p === game.player ? myId() : p.id);
  // Chaînes : couloir rouge annoncé pendant `tel` s, puis la chaîne part (cylindre de fer qui s'allonge) et retombe
  const chainFx = (d) => {
    const g = new THREE.Group(); g.position.set(d.x, (d.y || 0) + 0.12, d.z); g.rotation.y = Math.atan2(d.dx, d.dz);
    const tel = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.len), fxMat()); tel.rotation.x = -Math.PI / 2; tel.position.set(0, 0, d.len / 2); g.add(tel);
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), IRON); link.rotation.x = Math.PI / 2; link.position.set(0, 1.1, 0); link.visible = false; g.add(link);
    const hook = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), IRON); hook.visible = false; g.add(hook);
    scene.add(g); chains.push({ g, tel, link, hook, t: 0, T: d.tel, len: d.len });
  };
  // couronne rouge au-dessus d'un joueur marqué
  const crownMesh = () => {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0xff2a18, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), mat); const a = (i / 6) * Math.PI * 2; c.position.set(Math.cos(a) * 0.27, 0.15, Math.sin(a) * 0.27); g.add(c); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 5, 18), mat); ring.rotation.x = Math.PI / 2; g.add(ring);
    return g;
  };
  const setCrown = (pid, t) => {
    for (const [k, c] of crowns) { dispose(c.g); crowns.delete(k); }
    const p = t > 0 ? playerOf(pid) : null;
    if (!p) { game.markT = 0; hud.setMark?.(null); return; }
    if (p === game.player) { game.markT = t; hud.setMark?.(`CONDAMNÉ · ${Math.ceil(t)} s`); hud.announce('LA SENTENCE', 'Le Bourreau vous a marqué : il ne vous lâchera pas !', 2800); return; }
    const g = crownMesh(); scene.add(g); crowns.set(pid, { g, p, t });
  };
  // Couperet : couloir annoncé, puis la hache tourne jusqu'au bout du couloir et revient
  const axeFx = (d) => {
    const g = new THREE.Group(); g.position.set(d.x, (d.y || 0) + 0.12, d.z); g.rotation.y = Math.atan2(d.dx, d.dz);
    const tel = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.len), fxMat()); tel.rotation.x = -Math.PI / 2; tel.position.set(0, 0, d.len / 2); g.add(tel);
    const ax = new THREE.Group(); ax.position.set(0, 1.2, 0); ax.visible = false;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 });
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 6), wood); h.rotation.z = Math.PI / 2; ax.add(h);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.06), IRON); bl.position.set(0.7, 0, 0); ax.add(bl);
    const sp = new THREE.Group(); sp.add(ax); g.add(sp);
    scene.add(g); axes.push({ g, tel, ax, sp, t: 0, T: d.tel, F: d.flight, len: d.len });
  };
  // Bûcher : anneau rouge pendant l'annonce, puis disque de flammes
  const pyreFx = (d) => {
    for (const [x, z] of d.pts) {
      const g = new THREE.Group(); g.position.set(x, (d.y || 0) + 0.1, z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.r - 0.18, d.r, 40), fxMat()); ring.rotation.x = -Math.PI / 2; g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(d.r, 32), new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; g.add(disc);
      scene.add(g); pyres.push({ g, ring, disc, t: 0, tel: d.tel, dur: d.dur, r: d.r, x, z, y: d.y || 0 });
    }
  };
  // Maître Tanneur : secteur de vomi annoncé (vert), puis jet de particules pendant `dur` s
  const vomits = [];
  const vomitFx = (d) => {
    const g = new THREE.Group(); g.position.set(d.x, (d.y || 0) + 0.12, d.z); g.rotation.y = Math.atan2(d.dx, d.dz);
    const a = (d.ang * Math.PI) / 180;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9be022, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(new THREE.CircleGeometry(d.range, 18, Math.PI / 2 - a, a * 2), mat); cone.rotation.x = Math.PI / 2; g.add(cone);
    scene.add(g); vomits.push({ g, cone, d, t: 0 });
  };
  const updateAttackFx = (dt) => {
    for (let i = vomits.length - 1; i >= 0; i--) {
      const v = vomits[i], d = v.d; v.t += dt;
      if (v.t < d.tel) v.cone.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(v.t * 12));
      else {
        const live = v.t - d.tel;
        if (live > d.dur) { dispose(v.g); vomits.splice(i, 1); continue; }
        v.cone.material.opacity = 0.18;
        fx.emit(d.x + d.dx * 1.3, (d.y || 0) + 2.1, d.z + d.dz * 1.3, { count: 3, color: [0x9cff3a, 0x6ab81a, 0xc8ff70], speed: 1.8, up: 0.6, size: 0.09, life: 0.9, grav: 5, nx: d.dx, nz: d.dz, push: d.range * 0.9, spread: 0.3 });
      }
    }
    for (let i = chains.length - 1; i >= 0; i--) {
      const c = chains[i]; c.t += dt;
      if (c.t < c.T) c.tel.material.opacity = 0.25 + 0.45 * Math.abs(Math.sin(c.t * 14));
      else {
        c.tel.visible = false;
        const u = Math.min(1, (c.t - c.T) / 0.18), L = Math.max(0.01, c.len * u);
        c.link.visible = c.hook.visible = true; c.link.scale.y = L; c.link.position.z = L / 2; c.hook.position.set(0, 1.1, L);
        if (c.t > c.T + 0.55) { dispose(c.g); chains.splice(i, 1); }
      }
    }
    for (const [k, c] of crowns) {
      c.t -= dt; c.g.position.set(c.p.pos.x, (c.p.pos.y || 0) + 2.3, c.p.pos.z); c.g.rotation.y += dt * 2; c.g.scale.setScalar(1 + 0.12 * Math.sin(performance.now() / 120));
      if (c.t <= 0 || c.p.dead) { dispose(c.g); crowns.delete(k); }
    }
    if (game.markT > 0) { game.markT -= dt; hud.setMark?.(game.markT > 0 ? `CONDAMNÉ · ${Math.ceil(game.markT)} s` : null); }
    for (let i = axes.length - 1; i >= 0; i--) {
      const a = axes[i]; a.t += dt;
      if (a.t < a.T) a.tel.material.opacity = 0.25 + 0.45 * Math.abs(Math.sin(a.t * 12));
      else {
        a.tel.visible = false; a.ax.visible = true;
        const f = a.t - a.T, total = a.F * 2, u = f < a.F ? f / a.F : (total - f) / a.F;
        a.sp.position.z = Math.max(0, Math.min(1, u)) * a.len; a.sp.rotation.z = f * 22; // elle tourne sur elle-même
        if (f > total) { dispose(a.g); axes.splice(i, 1); }
      }
    }
    for (let i = pyres.length - 1; i >= 0; i--) {
      const f = pyres[i]; f.t += dt;
      if (f.t < f.tel) { f.ring.material.opacity = 0.2 + 0.5 * Math.abs(Math.sin(f.t * 10)); continue; }
      const live = f.t - f.tel;
      if (live > f.dur) { dispose(f.g); pyres.splice(i, 1); continue; }
      f.ring.material.opacity = 0.8; f.disc.material.opacity = Math.min(0.55, live * 2) * (live > f.dur - 0.8 ? (f.dur - live) / 0.8 : 1) * (0.85 + 0.15 * Math.sin(live * 13));
      if (Math.random() < dt * 24) fx.emit(f.x + (Math.random() - 0.5) * f.r * 1.5, f.y + 0.2, f.z + (Math.random() - 0.5) * f.r * 1.5, { count: 1, color: [0xff8a20, 0xff4a10, 0xffc060], speed: 0.5, up: 2.6, size: 0.2, life: 0.8, grav: -1, spread: 0.2 });
    }
  };

  // -------------------------------------------------------------- événements du boss (hôte -> tous)
  const bossEvent = (name, data = {}) => {
    if (game.isHost) game.net?.send({ ...data, t: 'boss_fx', name }); // (t et name en dernier : un champ `t` de `data` ne doit jamais écraser le type du message)
    showBossEvent(name, data);
  };
  const showBossEvent = (name, d) => {
    game.bossLog?.push({ ...d, name, t: game.time }); // journal des tests (tools, ?debug) : hôte et clients
    const near = Math.hypot((d.x ?? 0) - game.player.pos.x, (d.z ?? 0) - game.player.pos.z);
    const v = Math.max(0.15, 1 - near / 60);
    if (name === 'boss_shock') { shockRing(d.x, d.y || 0, d.z); dust(d.x, (d.y || 0) + 0.2, d.z, 24); sfx.explosion?.(v); if (d.toll) sfx.bell?.(); game.shake = Math.max(game.shake || 0, 0.5 * v); }
    else if (name === 'boss_tele') { teleLine(d.x, d.z, d.dx, d.dz, d.y || 0); sfx.rumble?.(v); }
    else if (name === 'boss_roar') { sfx.nuke?.(); sfx.groan?.(1); game.shake = Math.max(game.shake || 0, 0.35 * v); if (d.text) hud.announce('LE BOURREAU', d.text, 3200); }
    else if (name === 'boss_stun') { sfx.hit?.(true); dust(d.x, (d.y || 0) + 1, d.z, 16); }
    else if (name === 'boss_rise') { dust(d.x, (d.y || 0) + 0.2, d.z, 30); sfx.rumble?.(1); sfx.rumble?.(1); game.shake = Math.max(game.shake || 0, 0.6); hud.announce('LE BOURREAU', 'Il surgit !', 3000); }
    else if (name === 'tanner_vomit') { vomitFx(d); sfx.groan?.(1); }
    else if (name === 'boss_chain') { chainFx(d); sfx.rumble?.(v); }
    else if (name === 'boss_mark') { setCrown(d.pid, d.dur || 0); if (d.dur > 0) sfx.bell?.(); }
    else if (name === 'boss_axe') { axeFx(d); if (game.finale?.remote) { const b = bossObj(); if (b) setTimeout(() => { b.axeHideT = d.flight * 2 + 0.25; }, d.tel * 1000); } sfx.rumble?.(v); }
    else if (name === 'boss_fire') { pyreFx(d); sfx.rumble?.(Math.max(0.3, v)); }
    else if (name === 'burst') { fx.emit(d.x, (d.y || 0) + 1, d.z, { count: 26, color: [0x7aff3a, 0x4a9a1a, 0xb8ff6a], speed: 3.4, up: 2.5, size: 0.13, life: 1.1, grav: 2, spread: 0.5 }); sfx.explosion?.(v * 0.6); }
  };

  // src : 'blast' pour l'explosion d'un pestiféré (le PHD Flopper l'ignore), 'chain' (le joueur est attiré de (kx, kz) m), 'fire' et 'toxic'
  // (pas de projection), absent pour les coups du Bourreau
  const hurtPlayer = (p, dmg, kx = 0, kz = 0, src = null) => {
    if (p === game.player) {
      p.hurt(dmg, src);
      if (src === 'chain') p.pullBy?.(kx, kz);
      else if (src !== 'fire' && src !== 'toxic' && !(src === 'blast' && p.perks.phdflopper)) { p.vel.x += kx; p.vel.z += kz; p.vy = Math.max(p.vy, 3.2); } // immunisé : pas de projection non plus
    } else p.hurt(dmg, kx, kz, src); // coéquipier : message réseau
  };
  game.hurtPlayerBy = hurtPlayer; // (le Maître Tanneur s'en sert aussi : tanner.js)

  const bossCtx = {
    wantLeap: true,
    event: bossEvent,
    hurtPlayer,
    pidOf,
    dust,
    // le Maître Tanneur appelle 3 pestiférés
    summonPest: (boss) => {
      const n = CONFIG.tanner.summon.count;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        spawnAt('bloat', boss.region, boss.pos.x + Math.cos(a) * 3.5, boss.pos.z + Math.sin(a) * 3.5);
      }
      bossEvent('boss_roar', { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z });
    },
    // le Glas (transition à 70 %) : 2 chevaliers de fer et 4 zombies (+2 par joueur de plus) surgissent autour du Bourreau
    glasAdds: (boss) => {
      const G = F().boss.glas, np = Math.max(1, standing().length), n = G.knights + G.zombies + G.perPlayer * (np - 1);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const x = boss.pos.x + Math.cos(a) * 7, z = boss.pos.z + Math.sin(a) * 7;
        spawnAt(i < G.knights ? 'armored' : Math.random() < 0.7 ? 'normal' : 'runner', boss.region, x, z);
      }
    },
    summon: (boss) => {
      const np = Math.max(1, standing().length);
      for (let i = 0; i < 4 + 2 * np; i++) {
        const a = (i / (4 + 2 * np)) * Math.PI * 2 + Math.random() * 0.4;
        const x = boss.pos.x + Math.cos(a) * 6, z = boss.pos.z + Math.sin(a) * 6;
        spawnAt(Math.random() < 0.7 ? 'normal' : 'runner', boss.region, x, z);
      }
    },
    onLeap: () => {
      const f = game.finale; if (!f) return;
      f.state = 'ascent'; f.t = 0; f.plT = 0;
      announce('ACTE III — L\'ASCENSION', 'Il fuit vers la plateforme : suivez-le par l\'escalier de la tour sud (330 marches) !', 5200);
    },
  };

  game.bossCtx = bossCtx;
  game.clearBossFx = () => { // nouvelle partie : plus de chaînes, de couronnes, de haches ni de cercles de feu
    for (const list of [chains, axes, pyres, vomits]) { for (const o of list) dispose(o.g); list.length = 0; }
    for (const [k, c] of crowns) { dispose(c.g); crowns.delete(k); }
    game.markT = 0; game.miniBar = null; hud.setMark?.(null);
  };

  // -------------------------------------------------------------- apparition des zombies de la fin de partie
  const freeAt = (region, x, z) => {
    const nav = region ? lv().regions[region]?.nav : world.nav;
    return nav ? !nav.isBlockedAt(x, z) : true;
  };
  function spawnAt(kind, region, x, z, extra = {}) {
    if (!game.isHost && game.isMultiplayer) return null;
    const y = region ? lv().regions[region].y : 0;
    const base = game.zombieHealth * (F().kindHealth[kind] ?? 1);
    let speed = game.zombieSpeed * (0.9 + Math.random() * 0.3);
    if (kind === 'runner') speed *= 1.55;
    const onEvent = () => {};
    const crawl = kind === 'crawler';
    const zk = kind === 'armored' || kind === 'bloat' ? kind : null;
    const zb = new Zombie(scene, { type: 'ground', pos: new THREE.Vector3(x, 0, z) }, base, speed, onEvent, null, { crawler: crawl, kind: zk });
    if (kind === 'runner') zb.runner = true;
    zb.skipSpawn();
    zb.region = region; zb.pos.set(x, y, z);
    game.zombies.push(zb);
    fx.emit(x, y + 0.4, z, { count: 10, color: [0x4a3a2a, 0x2a2018], speed: 1.8, up: 2, size: 0.1, life: 0.9, grav: 4, spread: 0.6 });
    if (game.isHost) game.net?.send({ t: 'z_spawn', id: zb.id, st: 'ground', fin: 1, wi: -1, x, z, y, hp: base, spd: zb.speed / (crawl ? 0.45 : zk === 'armored' ? 0.8 : zk === 'bloat' ? 0.7 : 1), crawl: crawl ? 1 : 0, kind: zk, run: kind === 'runner' ? 1 : 0, region });
    return zb;
  }
  game.spawnFinaleZombie = spawnAt;

  const pick = (kinds) => { let r = Math.random(), last = 'normal'; for (const [k, p] of Object.entries(kinds)) { last = k; if ((r -= p) <= 0) return k; } return last; };
  const spawnPoint = (where) => {
    const sp = (id) => lv().regions[id].spawns;
    if (where === 'crypt') { const l = sp(R.crypt); const p = l[Math.floor(Math.random() * l.length)]; return { region: R.crypt, x: p[0] + (Math.random() - 0.5) * 2, z: p[1] + (Math.random() - 0.5) * 2 }; }
    if (where === 'galleries') {
      const regs = [R.R2, R.R3, R.W2];
      for (let k = 0; k < 6; k++) { const r = regs[Math.floor(Math.random() * regs.length)], l = sp(r), p = l[Math.floor(Math.random() * l.length)]; const x = p[0] + (Math.random() - 0.5) * 2, z = p[1] + (Math.random() - 0.5) * 2; if (freeAt(r, x, z)) return { region: r, x, z }; }
      const l = sp(R.R3); const p = l[0]; return { region: R.R3, x: p[0], z: p[1] };
    }
    // portes : à l'extérieur, devant le grand portail ouest (au sol) ; ils se ruent à l'intérieur
    for (let k = 0; k < 8; k++) { const [x, z] = C.P(-62 - Math.random() * 14, (Math.random() - 0.5) * 18); if (freeAt(0, x, z)) return { region: 0, x, z }; }
    const [x, z] = C.P(-62, 0); return { region: 0, x, z };
  };

  const bossBarOf = (b) => (b ? { hp: b[0], max: b[1], phase: b[2], inv: !!b[3], name: F().boss.names[Math.max(0, Math.min(3, b[2] - 1))], thresholds: F().boss.thresholds } : null);
  const alive = () => game.zombies.filter((z) => !z.dead && !z.isBoss).length;
  const announce = (title, sub, ms) => { hud.announce(title, sub, ms); if (game.isHost) game.net?.send({ t: 'finale_say', title, sub, ms }); };
  const info = (force = false) => {
    const f = game.finale;
    if (!f || f.remote) return;
    // boss : [santé, santé max, phase 1-4, invulnérable 0/1]
    const b = f.boss && !f.boss.dead ? [Math.max(0, Math.round(f.boss.health)), f.boss.maxHealth, f.boss.phase, f.boss.invulnerable ? 1 : 0] : null;
    const msg = { t: 'finale_info', b: f.banner, boss: b };
    f.infoT = (f.infoT || 0);
    if (force || f.infoT <= 0) { f.infoT = 0.25; game.net?.send(msg); }
    hud.setBanner(f.banner); hud.setBossBar?.(bossBarOf(b));
  };

  // -------------------------------------------------------------- déroulement (hôte)
  Object.assign(game, {
    finale: null, finaleDone: false, shake: 0,

    // quartiers (zones) déjà ouverts, et nombre requis : la ville doit être en grande partie libérée avant l'Heure du Jugement
    openZones() { return world.zoneNames.reduce((n, _, i) => n + (world.isZoneOpen(i) ? 1 : 0), 0); },
    // true si l'Heure du Jugement peut sonner : manche minimale et nombre de quartiers ouverts (l'hôte revalide les demandes des clients)
    finaleReady() { const Fc = F(); return this.round >= Fc.minRound && this.openZones() >= (Fc.minZones || 0); },

    finalePrompt(m) {
      const Fc = F();
      if (this.finale) return 'L\'Heure du Jugement a sonné : tenez bon !';
      if (this.finaleDone) return 'L\'horloge s\'est tue. Strasbourg tient encore…';
      if (!this.finaleReady()) {
        const need = [];
        if (this.round < Fc.minRound) need.push(`manche ${Fc.minRound} requise`);
        if (this.openZones() < (Fc.minZones || 0)) need.push(`${this.openZones()}/${Fc.minZones} quartiers ouverts`);
        return `L'horloge astronomique… (${need.join(' · ')} pour l'Heure du Jugement)`;
      }
      return `${game.binds.tag('interact')} Faire sonner l'Heure du Jugement : le Bourreau vous attend${Fc.price ? ` (${Fc.price} pts)` : ''}`;
    },

    startFinale() {
      if (this.finale) return;
      const np = Math.max(1, standing().length);
      this.finale = { state: 'intro', t: 0, wave: -1, queue: [], spawnT: 0, np, banner: 'L\'HEURE DU JUGEMENT', boss: null, infoT: 0 };
      this.net?.send({ t: 'finale_start' });
      this.finaleIntro();
    },
    finaleIntro() {
      if (!this.finale) this.finale = { remote: true, banner: 'L\'HEURE DU JUGEMENT' };
      for (let k = 0; k < 6; k++) setTimeout(() => sfx.bell?.(), k * 700);
      hud.announce('L\'HEURE DU JUGEMENT', 'ACTE I — Les cloches sonnent… la cathédrale s\'éveille', 5200);
    },

    startFinaleWave(n) {
      const f = this.finale, W = F().waves[n];
      f.wave = n; f.state = 'wave'; f.t = 0;
      const np = Math.max(1, standing().length);
      const total = Math.round(W.count + W.perPlayer * (np - 1));
      f.queue = [...Array(total).keys()].map(() => pick(W.kinds));
      f.total = total; f.spawnT = 1.5;
      announce(`VAGUE ${n + 1} / ${F().waves.length}`, W.name.toUpperCase(), 4200);
      sfx.roundStart?.();
    },

    updateFinale(dt) {
      const f = this.finale;
      this.shake = Math.max(0, (this.shake || 0) - dt * 1.5);
      for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; const k = r.t / 0.85; r.m.scale.setScalar(1 + k * 13); r.m.material.opacity = 0.6 * (1 - k); if (k >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); } }
      for (let i = lines.length - 1; i >= 0; i--) { const l = lines[i]; l.t += dt; const m = l.g.children[0]; m.material.opacity = 0.25 + 0.45 * Math.abs(Math.sin(l.t * 12)); if (l.t > 1.2) { scene.remove(l.g); m.geometry.dispose(); m.material.dispose(); lines.splice(i, 1); } }
      updateAttackFx(dt);
      if (!f) { hud.setBanner?.(null); hud.setBossBar?.(this.miniBar || null); return; } // (barre du Maître Tanneur : main.js, updateMiniBar)
      if (this.isClient || f.remote) { hud.setBanner(f.banner || ''); return; }
      f.t += dt; f.infoT -= dt;
      const Fc = F();
      switch (f.state) {
        case 'intro':
          f.banner = 'L\'HEURE DU JUGEMENT';
          if (f.t > 6) this.startFinaleWave(0);
          break;
        case 'wave': {
          const W = Fc.waves[f.wave];
          f.spawnT -= dt;
          if (f.queue.length && f.spawnT <= 0 && alive() < Fc.maxAlive) {
            f.spawnT = 0.55;
            const kind = f.queue.pop(), sp = spawnPoint(W.where);
            spawnAt(kind, sp.region, sp.x, sp.z);
          }
          const left = f.queue.length + alive();
          f.banner = `ACTE I — VAGUE ${f.wave + 1}/${Fc.waves.length} · ${W.name.toUpperCase()} · ${left} restants`;
          if (!f.queue.length && alive() <= 1) { f.state = 'breather'; f.t = 0; announce('VAGUE TERMINÉE', f.wave + 1 < Fc.waves.length ? 'Reprenez votre souffle…' : 'Le Bourreau approche…', 3500); sfx.roundEnd?.(); }
          break;
        }
        case 'breather':
          f.banner = f.wave + 1 < Fc.waves.length ? `Vague suivante dans ${Math.max(0, Math.ceil(Fc.breather - f.t))} s` : 'Le sol tremble…';
          if (f.t > Fc.breather) { if (f.wave + 1 < Fc.waves.length) this.startFinaleWave(f.wave + 1); else this.startBoss1(); }
          break;
        case 'boss1': {
          const b = f.boss;
          f.banner = 'ACTE II — LE BOURREAU';
          if (b && f.bossAt && f.t > 2) { b.arrive(0, f.bossAt[0], f.bossAt[1], 0); f.bossAt = null; }
          if (b && !b.dead && b.state === 'chase') { // renforts épisodiques pendant le combat
            f.addT = (f.addT || 0) - dt;
            if (f.addT <= 0 && alive() < 6) { f.addT = 9; const sp = spawnPoint('crypt'); spawnAt('normal', sp.region, sp.x, sp.z); }
          }
          break;
        }
        case 'ascent': {
          f.banner = 'ACTE III — L\'ASCENSION · rejoignez la plateforme (tour sud)';
          // renforts le long de l'escalade : autour des étages où se trouvent les joueurs
          f.addT = (f.addT || 0) - dt;
          if (f.addT <= 0 && alive() < 12) {
            f.addT = 2.4;
            const ps = standing();
            if (ps.length) {
              const p = ps[Math.floor(Math.random() * ps.length)], reg = p.tregion || 0;
              const l = reg && lv().regions[reg]?.spawns?.length ? lv().regions[reg].spawns : null;
              if (l) { const q = l[Math.floor(Math.random() * l.length)]; if (Math.hypot(q[0] - p.pos.x, q[1] - p.pos.z) > 12) spawnAt(Math.random() < 0.3 ? 'armored' : Math.random() < 0.5 ? 'runner' : 'normal', reg, q[0], q[1]); }
              else if (reg === 0) { const sp = spawnPoint('portal'); spawnAt('normal', 0, sp.x, sp.z); }
            }
          }
          // un joueur debout sur la plateforme depuis 3 s : le Bourreau les attend
          const onPlat = standing().some((p) => (p.tregion || 0) === R.PL);
          f.plT = onPlat ? (f.plT || 0) + dt : 0;
          if (f.plT > 3) this.startBoss2();
          break;
        }
        case 'boss2': {
          f.banner = 'ACTE IV — SUR LE TOIT DE STRASBOURG';
          const b = f.boss;
          if (b && !b.dead && b.state === 'chase') {
            f.addT = (f.addT || 0) - dt;
            if (f.addT <= 0 && alive() < 8) { f.addT = 8; const l = lv().regions[R.PL].spawns; const q = l[Math.floor(Math.random() * l.length)]; if (!standing().every((p) => Math.hypot(q[0] - p.pos.x, q[1] - p.pos.z) < 10)) spawnAt(Math.random() < 0.4 ? 'armored' : 'normal', R.PL, q[0], q[1]); }
          }
          break;
        }
        case 'victory':
          f.banner = 'LE BOURREAU EST TOMBÉ';
          if (f.t > 4) { this.net?.send({ t: 'finale_win' }); this.winFinale(); }
          break;
        default: break;
      }
      if (f.boss) f.boss.ctx = bossCtx;
      info();
    },

    // le Bourreau surgit au centre de la croisée (sol)
    startBoss1() {
      const f = this.finale, np = Math.max(1, standing().length);
      f.state = 'boss1'; f.t = 0;
      const hp = F().bossHealth * (1 + 0.7 * (np - 1));
      const [x, z] = C.P(37, 0);
      const b = new Boss(scene, { type: 'ground', pos: new THREE.Vector3(x, 0, z) }, hp, () => {}, null, { ctx: bossCtx });
      b.skipSpawn(); b.group.visible = false; b.state = 'hidden'; b.bs = 9; // invisible jusqu'à ce qu'il surgisse
      this.zombies.push(b);
      f.boss = b; f.bossAt = [x, z];
      this.net?.send({ t: 'z_spawn', id: b.id, st: 'ground', fin: 1, boss: 1, wi: -1, x, z, y: 0, hp, spd: 2.2, crawl: 0, region: 0 });
      announce('ACTE II — LE BOURREAU', 'Le sol de la croisée se fend…', 4500);
    },
    // il attend les joueurs sur la plateforme
    startBoss2() {
      const f = this.finale, b = f.boss;
      if (!b || b.dead) return;
      f.state = 'boss2'; f.t = 0; f.addT = 6;
      const [x, z] = C.P(-33, 0);
      b.arrive(R.PL, x, z, lv().regions[R.PL].y);
      announce('ACTE IV — SUR LE TOIT', 'Le Bourreau vous attend au sommet de la tour…', 4500);
    },

    // appelé (hôte) quand un zombie meurt : variantes et boss
    onFinaleKill(z) {
      if (z.explodes) {
        bossEvent('burst', { x: z.pos.x, y: z.pos.y, z: z.pos.z });
        for (const p of standing()) {
          const d = Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
          if (d < 4.2 && Math.abs(p.pos.y - z.pos.y) < 2.5) hurtPlayer(p, 38 * (1 - d / 5), 0, 0, 'blast');
        }
      }
      if (z.mini) { // Maître Tanneur : explosion (le PHD Flopper protège), 1500 points à chaque joueur, Max Munitions (main.js)
        const T = CONFIG.tanner;
        bossEvent('burst', { x: z.pos.x, y: z.pos.y, z: z.pos.z });
        bossEvent('boss_shock', { x: z.pos.x, y: z.pos.y, z: z.pos.z });
        for (const p of standing()) {
          const d = Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
          if (d < T.explosion.radius && Math.abs(p.pos.y - z.pos.y) < 2.5) hurtPlayer(p, T.explosion.damage, 0, 0, 'blast');
        }
        this.addPoints(T.reward.points, 'bonus');
        for (const r of this.remotes.values()) this.net?.send({ t: 'pts', pts: T.reward.points }, r.id);
        hud.announce('MAÎTRE TANNEUR', `Terrassé : +${T.reward.points} points chacun · Max Munitions`, 3500);
        if (this.isHost) this.net?.send({ t: 'finale_say', title: 'MAÎTRE TANNEUR', sub: `Terrassé : +${T.reward.points} points chacun · Max Munitions`, ms: 3500 });
        return;
      }
      if (z.isBoss) {
        const f = this.finale;
        if (f) { f.state = 'victory'; f.t = 0; f.boss = z; }
        for (const o of this.zombies) if (!o.dead && o !== z) o.damage(1e9, false);
        bossEvent('boss_shock', { x: z.pos.x, y: z.pos.y, z: z.pos.z });
        announce('LE BOURREAU EST TOMBÉ', 'La cathédrale se tait…', 4000);
        sfx.powerup?.();
      }
    },

    winFinale() {
      this.finale = null;
      this.finaleDone = true;
      hud.setBanner?.(null); hud.setBossBar?.(null);
      for (const z of this.zombies) if (!z.dead) z.damage(1e9, false);
      if (this.player.downed || this.player.dead) this.player.revive();
      if (!this.isClient) { this.toSpawn = 0; this.intermission = 12; }
      sfx.powerup();
      this.addPoints(F().boss.reward.points, 'bonus');
      for (const w of this.player.inventory) this.player.refill(w);
      this.player.hasAxe = true; // la Hache du Bourreau remplace le couteau (dégâts x3, touche deux zombies)
      this.player.releaseInputs();
      if (document.pointerLockElement) this._victory = true;
      document.exitPointerLock();
      hud.showOverlay('VICTOIRE !', `Le Bourreau est vaincu : vous avez sauvé la cathédrale.<br>Manche <b style="color:#fff">${this.round}</b> · ${this.kills} zombies tués · +${F().boss.reward.points.toLocaleString('fr-FR')} points · munitions pleines<br><span style="color:#ffd24a">Vous ramassez la <b>Hache du Bourreau</b> : elle remplace votre couteau (dégâts x${CONFIG.knife.axe.dmgMult}, touche deux zombies).</span><br><span style="color:#ffd24a">Strasbourg vous appartient : montez jusqu'à la pointe de la flèche… et la nuit continue.</span>`, 'CONTINUER');
    },

    // réseau : événements reçus par les clients
    bossEvent: showBossEvent,
    finaleInfo(m) {
      if (!this.finale) this.finale = { remote: true };
      this.finale.banner = m.b;
      hud.setBanner(m.b);
      hud.setBossBar?.(bossBarOf(m.boss));
      const b = bossObj();
      if (b && m.boss) { b._netPhase = m.boss[2]; b._netInv = !!m.boss[3]; b.health = m.boss[0]; b.phase = m.boss[2]; }
    },
  });
}
