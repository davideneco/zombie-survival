import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Zombie } from './zombie.js';
import { Boss } from './boss.js';
import { Angel, spireRadius } from './angel.js';
import { TOWER } from './cath/spire.js';

// =====================================================================
//  « L'Heure du Jugement » : la fin de partie, jouée par l'hôte et suivie par tous les joueurs.
//   intro -> 3 vagues (crypte, galeries, portes) -> le Bourreau dans la nef -> il fuit : ascension de la tour sud ->
//   combat final sur la plateforme à 67,5 m -> victoire (puis mode infini).
//  Les zombies de la fin de partie n'apparaissent pas comme dans une manche : ils surgissent de la crypte, des galeries
//  du triforium et des portes du parvis, puis poursuivent les joueurs d'étage en étage.
// =====================================================================
export function installFinale(game, { world, scene, hud, sfx, fx }) {
  const F = () => CONFIG.finale;
  const S = () => CONFIG.summit;
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
    else if (r.name === 'Terrasse de la flèche') R.TOP = r.id;
    else if (r.name === 'Rampe de la flèche') R.RAMP = r.id;
    else if (r.name === 'Pointe de la flèche') R.TIP = r.id;
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
  const bossObj = () => (game.finale && game.finale.boss) || game.zombies.find((z) => z.isBoss && (!z.mini || z.isAngel) && !z.dead) || null;
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
  const setCrown = (pid, t, text = null) => {
    for (const [k, c] of crowns) { dispose(c.g); crowns.delete(k); }
    const p = t > 0 ? playerOf(pid) : null;
    if (!p) { game.markT = 0; hud.setMark?.(null); return; }
    if (p === game.player) {
      game.markT = t; game.markText = text ? 'JUGEMENT' : 'CONDAMNÉ'; hud.setMark?.(`${game.markText} · ${Math.ceil(t)} s`);
      if (text) hud.announce('LE JUGEMENT', text, 2800); else hud.announce('LA SENTENCE', 'Le Bourreau vous a marqué : il ne vous lâchera pas !', 2800);
      return;
    }
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
  // ---- Acte V : attaques de l'Ange (cône de la Trompette, plumes, rayon du Jugement), rafales de la rampe
  const gold = (o = 0.5) => new THREE.MeshBasicMaterial({ color: 0xffd870, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const blasts = [], feathers = [], rays = [], gusts = [];
  const blastFx = (d) => { // Trompette : secteur doré annoncé `tel` s au niveau de la terrasse, puis souffle (particules) pendant `dur` s
    const g = new THREE.Group(); g.position.set(d.x, (d.fy ?? d.y) + 0.12, d.z); g.rotation.y = Math.atan2(d.dx, d.dz);
    const a = (d.ang * Math.PI) / 180;
    const cone = new THREE.Mesh(new THREE.CircleGeometry(d.range, 20, Math.PI / 2 - a, a * 2), gold(0.4)); cone.rotation.x = Math.PI / 2; g.add(cone);
    const col = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(a) * d.range, d.range, 18, 1, true), gold(0.1)); // volume du souffle : visible aussi depuis la rampe
    col.rotation.x = -Math.PI / 2; col.position.set(0, 1.2, d.range / 2); g.add(col);
    scene.add(g); blasts.push({ g, cone, col, d, t: 0 });
  };
  const featherGeo = new THREE.PlaneGeometry(0.16, 0.7);
  const featherFx = (d) => {
    for (const [dx, dy, dz] of d.dirs) {
      const m = new THREE.Mesh(featherGeo, gold(0.9)); m.position.set(d.x, d.y, d.z);
      m.lookAt(d.x + dx, d.y + dy, d.z + dz); m.rotateX(Math.PI / 2); scene.add(m);
      feathers.push({ m, dx, dy, dz, t: 0, d, x: d.x, y: d.y, z: d.z });
    }
    sfx.rumble?.(0.4);
  };
  const rayFx = (d) => { // Jugement : colonne de lumière de l'Ange jusqu'à la cible (arrêtée par la flèche si elle est entre eux)
    let ex = d.tx, ey = d.ty, ez = d.tz;
    if (!d.hit && game.tower) { // premier point où la flèche coupe le rayon
      for (let i = 1; i <= 40; i++) { const u = i / 40, x = d.x + (d.tx - d.x) * u, y = d.y + (d.ty - d.y) * u, z = d.z + (d.tz - d.z) * u; if (y >= TOWER.top - 0.3 && Math.hypot(x - game.tower.x, z - game.tower.z) < spireRadius(y) - 0.15) { ex = x; ey = y; ez = z; break; } }
    }
    const len = Math.hypot(ex - d.x, ey - d.y, ez - d.z) || 1;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 10, 1, true), gold(0.85));
    m.position.set((d.x + ex) / 2, (d.y + ey) / 2, (d.z + ez) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3((ex - d.x) / len, (ey - d.y) / len, (ez - d.z) / len));
    scene.add(m); rays.push({ m, t: 0 });
    fx.emit(ex, ey, ez, { count: 24, color: [0xfff0b0, 0xffd060, 0xffffff], speed: 3, up: 2, size: 0.14, life: 0.9, grav: 1, spread: 0.7, glow: true });
    sfx.explosion?.(Math.max(0.3, 1 - Math.hypot(ex - game.player.pos.x, ez - game.player.pos.z) / 50)); game.shake = Math.max(game.shake || 0, d.hit ? 0.5 : 0.2);
  };
  // rafale : annonce (traînées blanches), puis le joueur local sur la rampe est poussé `dur` s ; la collision (garde-corps, paroi) le retient
  const gustFx = (d) => { gusts.push({ ...d, t: 0, done: false }); };
  const updateSummitFx = (dt) => {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i], d = b.d; b.t += dt;
      if (b.t < d.tel) { b.cone.material.opacity = 0.25 + 0.4 * Math.abs(Math.sin(b.t * 12)); b.col.material.opacity = 0.05 + 0.08 * Math.abs(Math.sin(b.t * 12)); }
      else {
        const live = b.t - d.tel;
        if (live > d.dur) { dispose(b.g); blasts.splice(i, 1); continue; }
        b.cone.material.opacity = 0.55 * (1 - live / d.dur); b.col.material.opacity = 0.3 * (1 - live / d.dur);
        fx.emit(d.x + d.dx * 1.2, d.y - 0.6, d.z + d.dz * 1.2, { count: 4, color: [0xfff0b0, 0xffd060, 0xffffff], speed: 1.5, up: 0.1, size: 0.16, life: 0.7, grav: 0, nx: d.dx, nz: d.dz, push: d.range * 1.3, spread: 0.25, glow: true });
      }
    }
    for (let i = feathers.length - 1; i >= 0; i--) {
      const f = feathers[i]; f.t += dt;
      const ox = f.x, oy = f.y, oz = f.z;
      f.x += f.dx * f.d.speed * dt; f.y += f.dy * f.d.speed * dt; f.z += f.dz * f.d.speed * dt;
      f.m.position.set(f.x, f.y, f.z);
      let gone = f.t > f.d.life || f.y < 0;
      if (!gone && game.tower) { const mx = (f.x + ox) / 2, my = (f.y + oy) / 2, mz = (f.z + oz) / 2; if (my >= TOWER.top - 0.3 && Math.hypot(mx - game.tower.x, mz - game.tower.z) < spireRadius(my) - 0.15) gone = true; }
      if (gone) { scene.remove(f.m); f.m.material.dispose(); feathers.splice(i, 1); }
    }
    for (let i = rays.length - 1; i >= 0; i--) {
      const r = rays[i]; r.t += dt;
      r.m.material.opacity = 0.85 * Math.max(0, 1 - r.t / 0.6); r.m.scale.x = r.m.scale.z = 1 + r.t * 1.5;
      if (r.t > 0.6) { dispose(r.m); rays.splice(i, 1); }
    }
    for (let i = gusts.length - 1; i >= 0; i--) {
      const g = gusts[i], p = game.player; g.t += dt;
      const onRamp = p.region === R.RAMP;
      if (g.t < g.tel) { if (onRamp && Math.random() < dt * 40) summitFx().gust(p.pos.x, p.pos.y, p.pos.z, g.dx, g.dz); continue; }
      if (!g.done) { // la rafale frappe : poussée mélangée de la direction du vent et de la direction vers l'extérieur de la flèche
        g.done = true;
        if (onRamp && !p.downed && !p.dead && !p.vehicle && game.tower) {
          let ox = p.pos.x - game.tower.x, oz = p.pos.z - game.tower.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
          const W = S().ramp, k = W.outward;
          let vx = g.dx * (1 - k) + ox * k, vz = g.dz * (1 - k) + oz * k; const vl = Math.hypot(vx, vz) || 1;
          p.gustBy((vx / vl) * W.push, (vz / vl) * W.push, W.duration);
          game.shake = Math.max(game.shake || 0, 0.25);
          game.gustLog?.push({ t: game.time, x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: (vx / vl) * W.push, vz: (vz / vl) * W.push });
        }
      }
      if (g.t > g.tel + g.dur) gusts.splice(i, 1);
    }
  };
  const summitFx = () => game.summitFx;

  const updateAttackFx = (dt) => {
    updateSummitFx(dt);
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
    if (game.markT > 0) { game.markT -= dt; hud.setMark?.(game.markT > 0 ? `${game.markText || 'CONDAMNÉ'} · ${Math.ceil(game.markT)} s` : null); }
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
    else if (name === 'boss_mark') { setCrown(d.pid, d.dur || 0, d.text || null); if (d.dur > 0) sfx.bell?.(); }
    else if (name === 'boss_axe') { axeFx(d); if (game.finale?.remote) { const b = bossObj(); if (b) setTimeout(() => { b.axeHideT = d.flight * 2 + 0.25; }, d.tel * 1000); } sfx.rumble?.(v); }
    else if (name === 'boss_fire') { pyreFx(d); sfx.rumble?.(Math.max(0.3, v)); }
    else if (name === 'angel_trumpet') { blastFx(d); sfx.bell?.(); }
    else if (name === 'angel_plumes') { featherFx(d); }
    else if (name === 'angel_judge') { rayFx(d); }
    else if (name === 'angel_death') { fx.emit(d.x, d.y + 1, d.z, { count: 60, color: [0xfff0b0, 0xffd060, 0xffffff], speed: 4, up: 3, size: 0.2, life: 1.8, grav: -0.3, spread: 0.9, glow: true }); sfx.powerup?.(); game.shake = Math.max(game.shake || 0, 0.6); }
    else if (name === 'summit_gust') { gustFx(d); sfx.rumble?.(0.5); }
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

  game.onDusk = () => hud.announce('LA NUIT RETOMBE', 'Nuit éternelle : les zombies ont 30 % de vie en plus', 4500); // fin du jour (summit.js)
  game.bossCtx = bossCtx;
  game.clearBossFx = () => { // nouvelle partie : plus de chaînes, de couronnes, de haches ni de cercles de feu
    for (const list of [chains, axes, pyres, vomits, blasts]) { for (const o of list) dispose(o.g); list.length = 0; }
    for (const o of feathers) { scene.remove(o.m); o.m.material.dispose(); } feathers.length = 0;
    for (const o of rays) dispose(o.m); rays.length = 0;
    gusts.length = 0;
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
    const y = extra.y ?? (region ? lv().regions[region].y : 0);
    const base = game.zombieHealth * (F().kindHealth[kind] ?? 1);
    let speed = game.zombieSpeed * (0.9 + Math.random() * 0.3);
    if (kind === 'runner') speed *= 1.55;
    if (kind === 'gargoyle') speed *= S().gargoyles.speed;
    const onEvent = () => {};
    const crawl = kind === 'crawler';
    const zk = kind === 'armored' || kind === 'bloat' || kind === 'gargoyle' ? kind : null;
    const zb = new Zombie(scene, { type: 'ground', pos: new THREE.Vector3(x, 0, z) }, base, speed, onEvent, null, { crawler: crawl, kind: zk });
    if (kind === 'runner' || kind === 'gargoyle') zb.runner = true;
    zb.skipSpawn();
    zb.region = region; zb.pos.set(x, y, z);
    game.zombies.push(zb);
    fx.emit(x, y + 0.4, z, { count: 10, color: [0x4a3a2a, 0x2a2018], speed: 1.8, up: 2, size: 0.1, life: 0.9, grav: 4, spread: 0.6 });
    if (game.isHost) game.net?.send({ t: 'z_spawn', id: zb.id, st: 'ground', fin: 1, wi: -1, x, z, y, hp: base, spd: zb.speed / (crawl ? 0.45 : zk === 'armored' ? 0.8 : zk === 'bloat' ? 0.7 : 1), crawl: crawl ? 1 : 0, kind: zk, run: kind === 'runner' || kind === 'gargoyle' ? 1 : 0, region });
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

  const bossBarOf = (b) => (b ? (b[4] ? { hp: b[0], max: b[1], phase: 1, inv: false, name: 'L\'ANGE DU JUGEMENT', thresholds: [] } : { hp: b[0], max: b[1], phase: b[2], inv: !!b[3], name: F().boss.names[Math.max(0, Math.min(3, b[2] - 1))], thresholds: F().boss.thresholds }) : null);
  const alive = () => game.zombies.filter((z) => !z.dead && !z.isBoss).length;
  const announce = (title, sub, ms) => { hud.announce(title, sub, ms); if (game.isHost) game.net?.send({ t: 'finale_say', title, sub, ms }); };
  const info = (force = false) => {
    const f = game.finale;
    if (!f || f.remote) return;
    // boss : [santé, santé max, phase 1-4, invulnérable 0/1]
    const b = f.boss && !f.boss.dead ? [Math.max(0, Math.round(f.boss.health)), f.boss.maxHealth, f.boss.phase, f.boss.invulnerable ? 1 : 0, f.boss.isAngel ? 1 : 0] : null;
    const msg = { t: 'finale_info', b: f.banner, boss: b };
    if (f.state && f.state.startsWith('summit_')) { msg.st = f.state; msg.fan = Math.round((f.fan || 0) * 1000) / 1000; msg.fh = f.fh || 0; msg.fs = f.fs || 0; } // Acte V : état, jauge du Fanal, joueurs qui le tiennent
    f.infoT = (f.infoT || 0);
    if (force || f.infoT <= 0) { f.infoT = 0.25; game.net?.send(msg); }
    hud.setBanner(f.banner); hud.setBossBar?.(bossBarOf(b));
  };

  // -------------------------------------------------------------- Acte V « L'Aube » (hôte) : états summit_*
  //   summit_beam -> summit_garg (gargouilles sur la terrasse) -> summit_angel (l'Ange du Jugement) -> summit_angel_dead -> summit_ramp (rafales
  //   et gargouilles qui montent) -> summit_fanal (maintenir la touche d'interaction) -> summit_dawn (le ciel, les cendres, la vue orbitale)
  const regionOf = (p) => (p.region != null ? p.region : 0);
  const onTower = (p) => regionOf(p) === R.TOP || regionOf(p) === R.RAMP || regionOf(p) === R.TIP;
  const towerPt = (r, deg) => C.P(TOWER.c[0] + Math.cos((deg * Math.PI) / 180) * r, TOWER.c[1] + Math.sin((deg * Math.PI) / 180) * r);
  const gargAlive = () => game.zombies.filter((z) => !z.dead && z.kind === 'gargoyle').length;
  const summitState = () => { const f = game.finale; return f ? (f.remote ? f.st : f.state) || null : null; };
  game.summitState = summitState;

  // une gargouille surgit d'un parapet de la terrasse, à plus de minDist m des joueurs
  const spawnTerraceGargoyle = (ps) => {
    const G = S().gargoyles;
    for (let k = 0; k < 14; k++) {
      const [x, z] = towerPt(8.55, Math.random() * 360);
      if (!lv().inRegion(R.TOP, x, z) || !freeAt(R.TOP, x, z)) continue;
      if (ps.some((p) => regionOf(p) === R.TOP && Math.hypot(p.pos.x - x, p.pos.z - z) < G.minDist)) continue;
      const zb = spawnAt('gargoyle', R.TOP, x, z);
      if (zb) { dust(x, lv().regions[R.TOP].y + 1, z, 10); sfx.rumble?.(0.3); }
      return zb;
    }
    return null;
  };
  // une gargouille grimpe la rampe : elle apparaît sur la rampe à `behind` m sous le joueur le plus haut
  const spawnRampGargoyle = (ps) => {
    const link = lv().regions[R.RAMP]?.link, W = S().ramp.gargoyles;
    if (!link) return null;
    let smax = -1;
    for (const p of ps) {
      if (regionOf(p) === R.RAMP) smax = Math.max(smax, lv().project(link, p.pos.x, p.pos.z, p.pos.y));
      else if (regionOf(p) === R.TIP) smax = Math.max(smax, link.length);
    }
    if (smax < 0) return null;
    const s0 = Math.max(0.5, Math.min(link.length - 3, smax - W.behind - Math.random() * 5));
    const o = lv().pointOn(link, s0, {});
    const zb = spawnAt('gargoyle', R.TOP, o.x, o.z, { y: o.y });
    if (!zb) return null;
    zb.link = { link, dir: 1, s: s0 };
    return zb;
  };

  const nearFanal = (p, extra = 0) => { const T = game.tower; return !!(T && T.fanal) && regionOf(p) === R.TIP && Math.hypot(p.pos.x - T.fanal.x, p.pos.z - T.fanal.z) < S().fanal.range + extra && Math.abs(p.pos.y - T.fanal.y) < 3; };
  game.nearFanal = nearFanal;

  // l'Ange arrive du ciel et se met à tourner autour de la flèche
  const spawnAngel = (f) => {
    const A = S().angel, np = Math.max(1, standing().length), hp = Math.round(A.health * (1 + A.perPlayer * (np - 1)));
    const T = game.tower, az = (200 * Math.PI) / 180, r = A.radius + 10, x = T.x + Math.cos(az) * r, z = T.z + Math.sin(az) * r, y = A.height + 22;
    const a = new Angel(scene, { type: 'ground', pos: new THREE.Vector3(x, 0, z) }, hp, () => {}, null, { ctx: bossCtx });
    a.skipSpawn(); a.ctx = bossCtx; a.center = { x: T.x, z: T.z }; a.region = R.TOP; a.az = 200;
    a.pos.set(x, y, z); a._setState('arrive');
    game.zombies.push(a);
    f.boss = a;
    game.net?.send({ t: 'z_spawn', id: a.id, st: 'ground', fin: 1, boss: 1, angel: 1, wi: -1, x, z, y, hp, spd: 0, crawl: 0, region: R.TOP });
    sfx.bell?.();
    return a;
  };

  const summitStep = (f, dt) => {
    const Sc = S(), ps = standing();
    f.fh = 0; f.fs = ps.length;
    switch (f.state) {
      case 'summit_beam': {
        f.banner = 'La flèche s\'illumine : montez allumer le Fanal d\'Erwin';
        if (!f.said && f.t > 1.5 && (game.playing || game.isMultiplayer)) { f.said = true; announce('ACTE V — L\'AUBE', 'La flèche s\'illumine : montez allumer le Fanal d\'Erwin', 5500); }
        f.upT = ps.some(onTower) ? (f.upT || 0) + dt : 0;
        if (f.upT > 1.2) {
          const np = Math.max(1, ps.length), G = Sc.gargoyles;
          f.state = 'summit_garg'; f.t = 0; f.gQueue = Math.round(G.count + G.perPlayer * (np - 1)); f.gTotal = f.gQueue; f.gT = 1;
          announce('LES GARGOUILLES', 'La pierre s\'éveille sur les parapets !', 4200);
          sfx.roundStart?.();
        }
        break;
      }
      case 'summit_garg': {
        const G = Sc.gargoyles;
        f.gT -= dt;
        if (f.gQueue > 0 && f.gT <= 0 && gargAlive() < G.maxAlive) {
          f.gT = G.interval;
          if (spawnTerraceGargoyle(ps)) f.gQueue--;
        }
        { const n = f.gQueue + gargAlive(); f.banner = `ACTE V — LES GARGOUILLES · ${n} restante${n > 1 ? 's' : ''}`; }
        if (!f.gQueue && gargAlive() === 0) {
          f.state = 'summit_angel'; f.t = 0;
          announce('L\'ANGE DU JUGEMENT', 'Un chant s\'élève autour de la flèche… visez la trompette !', 5200);
          spawnAngel(f);
        }
        break;
      }
      case 'summit_angel':
        f.banner = 'ACTE V — SUR LA FLÈCHE';
        break;
      case 'summit_angel_dead':
        f.banner = 'L\'Ange est tombé';
        if (f.t > 3.2) {
          f.state = 'summit_ramp'; f.t = 0; f.gustT = 2.5; f.rT = 3; f.boss = null;
          announce('LA RAMPE', 'Des rafales balaient la flèche : accrochez-vous et grimpez jusqu\'à la pointe !', 5200);
        }
        break;
      case 'summit_ramp': case 'summit_fanal': {
        const ramp = f.state === 'summit_ramp';
        f.banner = ramp ? 'ACTE V — LA RAMPE · gagnez la pointe de la flèche' : `ACTE V — LE FANAL · ${Math.round((f.fan || 0) * 100)} %`;
        // rafales : toutes les `interval` s tant qu'un joueur est sur la rampe
        f.gustT = (f.gustT ?? Sc.ramp.interval) - dt;
        if (f.gustT <= 0) {
          if (ps.some((p) => regionOf(p) === R.RAMP)) {
            f.gustT = Sc.ramp.interval;
            const a = Math.random() * Math.PI * 2;
            bossEvent('summit_gust', { dx: Math.round(Math.cos(a) * 100) / 100, dz: Math.round(Math.sin(a) * 100) / 100, tel: 0.8, dur: Sc.ramp.duration });
          } else f.gustT = 0.5;
        }
        // gargouilles qui montent
        f.rT = (f.rT ?? Sc.ramp.gargoyles.every) - dt;
        if (f.rT <= 0) {
          f.rT = Sc.ramp.gargoyles.every;
          if (ps.some((p) => regionOf(p) === R.RAMP || regionOf(p) === R.TIP)) {
            for (let i = 0; i < Sc.ramp.gargoyles.count && gargAlive() < Sc.ramp.gargoyles.maxAlive; i++) spawnRampGargoyle(ps);
          }
        }
        if (ramp) {
          if (ps.some((p) => regionOf(p) === R.TIP)) {
            f.state = 'summit_fanal'; f.t = 0; f.fan = 0;
            announce('LE FANAL D\'ERWIN', `Tous ensemble : maintenez ${game.binds.tag('interact')} près du Fanal !`, 5200);
          }
        } else {
          const Fn = Sc.fanal, hold = ps.filter((p) => (p === game.player ? game.fanalHold : !!p.fh && nearFanal(p, 1.2)));
          f.fh = hold.length;
          const rate = hold.length ? (hold.length / Math.max(1, ps.length)) / Fn.hold : -Fn.decay / Fn.hold;
          f.fan = Math.max(0, Math.min(1, (f.fan || 0) + rate * dt));
          if (f.fan >= 1) game.dawnBegin(0);
        }
        break;
      }
      case 'summit_dawn':
        f.banner = 'L\'AUBE';
        if (f.t > Sc.dawn.orbit + 2) game.endSummit();
        break;
      default: break;
    }
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
      if (this.finaleDone) return 'L\'horloge s\'est tue. Strasbourg tient encore…';
      if (this.finale) return 'L\'Heure du Jugement a sonné : tenez bon !';
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
      this.updateFanal(f);
      if (!f) { hud.setBanner?.(null); hud.setBossBar?.(this.miniBar || null); return; } // (barre du Maître Tanneur : main.js, updateMiniBar)
      if (this.isClient || f.remote) {
        if (this.dawnOn && this.time - this.dawnT0 > S().dawn.orbit + 2) { this.finale = null; hud.setBanner?.(null); hud.setBossBar?.(null); return; } // fin de l'Acte V chez un client
        hud.setBanner(f.banner || ''); return;
      }
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
        default: if (f.state.startsWith('summit_')) summitStep(f, dt); break;
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
      if (z.isAngel) { // l'Ange du Jugement : 5000 points à chaque joueur ; la rampe s'ouvre au bout de quelques secondes
        const A = S().angel, f = this.finale;
        bossEvent('angel_death', { x: z.pos.x, y: z.pos.y, z: z.pos.z });
        bossEvent('boss_mark', { pid: null, dur: 0 });
        this.addPoints(A.reward, 'bonus');
        for (const r of this.remotes.values()) this.net?.send({ t: 'pts', pts: A.reward }, r.id);
        announce('L\'ANGE DU JUGEMENT', `Il retombe en poussière d'or : +${A.reward} points chacun`, 4000);
        for (const o of this.zombies) if (!o.dead && o !== z && o.kind === 'gargoyle') o.damage(1e9, false);
        if (f && !f.remote && f.state === 'summit_angel') { f.state = 'summit_angel_dead'; f.t = 0; f.boss = z; }
        return;
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
      this.finaleDone = true;
      // Acte V : la flèche s'illumine ; la machine à états summit_* prend le relais (l'hôte la joue, les clients la suivent par finale_info)
      const T = C && this.tower;
      if (T) {
        const banner = 'La flèche s\'illumine : montez allumer le Fanal d\'Erwin';
        this.finale = this.isClient ? { remote: true, st: 'summit_beam', banner } : { state: 'summit_beam', t: 0, np: Math.max(1, standing().length), banner, boss: null, infoT: 0, fan: 0 };
        this.summitFx?.show();
      } else this.finale = null;
      hud.setBanner?.(null); hud.setBossBar?.(null);
      for (const z of this.zombies) if (!z.dead) z.damage(1e9, false);
      if (this.player.downed || this.player.dead) this.player.revive();
      if (!this.isClient) { this.toSpawn = 0; this.intermission = T ? 0 : 12; }
      sfx.powerup();
      this.addPoints(F().boss.reward.points, 'bonus');
      for (const w of this.player.inventory) this.player.refill(w);
      this.player.hasAxe = true; // la Hache du Bourreau remplace le couteau (dégâts x3, touche deux zombies)
      this.player.releaseInputs();
      if (document.pointerLockElement) this._victory = true;
      document.exitPointerLock();
      hud.showOverlay('VICTOIRE !', `Le Bourreau est vaincu : vous avez sauvé la cathédrale.<br>Manche <b style="color:#fff">${this.round}</b> · ${this.kills} zombies tués · +${F().boss.reward.points.toLocaleString('fr-FR')} points · munitions pleines<br><span style="color:#ffd24a">Vous ramassez la <b>Hache du Bourreau</b> : elle remplace votre couteau (dégâts x${CONFIG.knife.axe.dmgMult}, touche deux zombies).</span><br><span style="color:#ffd24a">La flèche de la cathédrale s'illumine : montez allumer le Fanal d'Erwin.</span>`, 'CONTINUER');
    },

    // ----- Acte V : le Fanal (chaque joueur debout maintient la touche d'interaction près de lui ; la jauge est commune, voir summitStep)
    updateFanal(f) {
      const st = summitState(), p = this.player;
      const can = st === 'summit_fanal' && this.playing && !p.downed && !p.dead && !p.vehicle && !this.camLock && nearFanal(p);
      this.fanalNear = can;
      this.fanalHold = can && this.binds.down('interact', p.keys);
      if (f && st && st.startsWith('summit_')) {
        const fan = f.fan || 0;
        this.summitFx?.setFanal(fan, this.dawnOn);
        hud.setFanal(st === 'summit_fanal' ? fan : null, `LE FANAL D'ERWIN · ${f.fh || 0}/${f.fs || 0} joueur${(f.fs || 0) > 1 ? 's' : ''}`);
      } else hud.setFanal(null);
    },
    fanalPrompt() {
      if (!this.fanalNear) return null;
      const f = this.finale;
      return `${this.binds.tag('interact')} Maintenir : allumer le Fanal d'Erwin${f && f.fs > 1 ? ` (${f.fh || 0}/${f.fs} tiennent le Fanal)` : ''}`;
    },

    // joueur qui arrive en cours d'Acte V (message sync)
    applySummitSync(m) {
      this.summitFx?.show();
      this.eternal = !!m.eternal;
      if (m.dawn != null) { this.blessed = true; this.freeDoors = true; this.dawnRun(Math.max(0.1, m.dawn)); }
    },

    // L'Aube (tous les joueurs, à la réception de `dawn`) : le ciel passe au jour en `dawn.sky` s, les zombies tombent en cendres, la Bénédiction de
    // l'Aube donne les sept atouts (gardés à terre) et rend les portes gratuites, vue orbitale de `dawn.orbit` s, puis l'écran « STRASBOURG LIBÉRÉE »
    dawnBegin(k = 0) {
      if (this.dawnOn) return;
      const f = this.finale;
      if (f && !f.remote) { f.state = 'summit_dawn'; f.t = 0; f.fan = 1; f.boss = null; }
      if (this.isHost) this.net?.send({ t: 'dawn', k });
      this.dawnRun(k);
    },
    dawnRun(k = 0) {
      if (this.dawnOn) return;
      this.dawnOn = true; this.dawnT0 = this.time - k;
      if (this.finale?.remote) this.finale.st = 'summit_dawn';
      this.eternal = true; this.blessed = true; this.freeDoors = true; // Nuit éternelle dès la manche suivante ; Bénédiction ; portes gratuites
      const p = this.player;
      for (const z of this.zombies) if (!z.dead) z.becomeAsh();
      if (p.downed || p.dead) p.revive();
      for (const id of Object.keys(CONFIG.perks)) if (!p.perks[id]) p.addPerk(id);
      p.health = Math.max(p.health, p.maxHealth * 0.6);
      sfx.powerup?.(); for (let i = 0; i < 4; i++) setTimeout(() => sfx.bell?.(), i * 900);
      hud.setFanal(null); hud.setBanner?.(null); hud.setBossBar?.(null);
      this.summitFx?.setFanal(1, true); this.summitFx?.boost(1.7);
      this.summitFx?.startDawn(k);
      hud.announce('L\'AUBE', `Le Fanal d'Erwin est allumé : les ténèbres reculent…${k ? '' : ' (Échap : passer la vue)'}`, 6000);
      if (this.summitFx && !k) this.summitFx.startOrbit(() => this.showLiberated());
    },
    // fin de l'Acte V (hôte) : plus de machine à états, les manches reprennent en Nuit éternelle
    endSummit() {
      this.finale = null; this.toSpawn = 0; this.intermission = 10;
      hud.setBanner?.(null); hud.setBossBar?.(null);
      hud.announce('NUIT ÉTERNELLE', 'La nuit retombera… et les zombies seront plus coriaces dès la manche suivante', 5500);
      if (this.isHost) this.net?.send({ t: 'finale_say', title: 'NUIT ÉTERNELLE', sub: 'La nuit retombera… et les zombies seront plus coriaces dès la manche suivante', ms: 5500 });
    },
    // écran « STRASBOURG LIBÉRÉE » (chaque joueur voit ses propres statistiques) + trophée local
    showLiberated() {
      const t = Math.round(this.time), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
      const zones = this.openZones(), np = 1 + this.remotes.size;
      let trophies = 0;
      try {
        const o = JSON.parse(localStorage.getItem('zombie_trophy') || '{"n":0}');
        o.n = (o.n | 0) + 1; o.last = { round: this.round, kills: this.kills, time: t, players: np, date: new Date().toISOString().slice(0, 10) };
        localStorage.setItem('zombie_trophy', JSON.stringify(o)); trophies = o.n;
      } catch {}
      this.trophy = trophies || this.trophy || 0;
      this.player.releaseInputs();
      if (document.pointerLockElement) this._victory = true;
      document.exitPointerLock();
      hud.showOverlay('STRASBOURG LIBÉRÉE', `Le Fanal d'Erwin brûle au sommet de la cathédrale : l'aube se lève sur la ville.<br>`
        + `<span style="color:#fff">Manche <b>${this.round}</b> · <b>${this.kills}</b> zombies tués · <b>${this.points.toLocaleString('fr-FR')}</b> points · ${zones} quartiers ouverts · ${np} joueur${np > 1 ? 's' : ''} · ${mm} min ${ss} s</span><br>`
        + `<span style="color:#ffd24a">Bénédiction de l'Aube : les sept atouts, même à terre · toutes les portes sont gratuites.${trophies ? `<br>Trophée « Strasbourg libérée » n° ${trophies} enregistré sur cet appareil.` : ''}</span><br>`
        + `<span style="color:#9fb4ff">La nuit reviendra : la Nuit éternelle commence, les zombies auront 30 % de vie en plus.</span>`, 'CONTINUER');
    },

    // réseau : événements reçus par les clients
    bossEvent: showBossEvent,
    finaleInfo(m) {
      if (!this.finale) this.finale = { remote: true };
      this.finale.banner = m.b;
      if (m.st) { const f = this.finale; f.st = m.st; f.fan = m.fan || 0; f.fh = m.fh | 0; f.fs = m.fs | 0; if (!this.summitFx?.shown) this.summitFx?.show(); }
      hud.setBanner(m.b);
      hud.setBossBar?.(bossBarOf(m.boss));
      const b = bossObj();
      if (b && m.boss) { b._netPhase = m.boss[2]; b._netInv = !!m.boss[3]; b.health = m.boss[0]; b.phase = m.boss[2]; }
    },
  });
}
