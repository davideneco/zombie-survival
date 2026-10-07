// Menu debug de l'HÔTE (touche F9). La souris reste capturée, tout se fait au clavier :
//   1-4 choisir un joueur · T deux fois (1,5 s) amener ce joueur près de l'hôte · Y aller près de lui · N le réanimer
//   U débloquer les zombies coincés · P bascule FPS / appels de rendu / triangles / zombies · Échap ou F9 ferme.
// Pas de points, d'armes ni de saut de manche. Messages : dbg_tp {x,y,z,region} (hôte -> client), dbg_ack {ok,reason} (client -> hôte),
// dbg_note {text} (hôte -> tous). Le client n'accepte dbg_tp que de l'hôte (net.onHost) et le relais rejette tout dbg_* d'un autre expéditeur.

const RINGS = [1.5, 2.5, 3.5];       // distances autour du point de référence (m)
const ANGLES = 12;
const COOLDOWN = 5;                   // s entre deux téléportations de la même cible
const DOUBLE = 1.5;                   // s pour confirmer T
const LOG_MAX = 50;
const now = () => performance.now() / 1000; // secondes réelles (saisie au clavier : indépendant de la fréquence d'images)

// Case valide pour un joueur dans SA propre grille : libre, sans poussée de collision, étage et hauteur cohérents.
// region 0 = sol de la ville ; sinon grille de l'étage. Renvoie { ok, y } ou { ok:false, reason }.
export function spotValid(world, x, y, z, region) {
  const lv = world.levels;
  const nav = region === 0 || !lv ? world.nav : lv.regions[region]?.nav;
  if (!nav) return { ok: false, reason: 'région sans grille' };
  if (nav.isBlockedAt(x, z)) return { ok: false, reason: 'case bloquée' };
  const q = { x, y, z };
  world.collide(q, 0.4);
  if (Math.hypot(q.x - x, q.z - z) > 0.05) return { ok: false, reason: 'collision' };
  const fl = { y: 0, region: 0 };
  world.floorAt(x, z, y + 0.1, fl);
  if (fl.region !== region) return { ok: false, reason: 'autre étage' };
  if (Math.abs(fl.y - y) > 0.6) return { ok: false, reason: 'hauteur incohérente' };
  return { ok: true, y: fl.y };
}

// Points sûrs autour de c = { x, y, z } (pieds), dans la région `region` : anneaux de 1,5 / 2,5 / 3,5 m, 12 angles ; case libre, sans
// poussée de collision (< 5 cm), même étage à ±0,6 m, rayon dégagé depuis l'œil de c ; à plus de 1,2 m des points `avoid`.
export function findSafeSpot(world, c, region, avoid = []) {
  const eye = { x: c.x, y: c.y + 1.6, z: c.z };
  for (const r of RINGS) {
    for (let k = 0; k < ANGLES; k++) {
      const a = (k / ANGLES) * Math.PI * 2 + r;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 1.2 && Math.abs(p.y - c.y) < 1.5)) continue;
      const v = spotValid(world, x, c.y, z, region);
      if (!v.ok) continue;
      if (world.rayHit) {
        const dx = x - eye.x, dy = v.y + 1 - eye.y, dz = z - eye.z, d = Math.hypot(dx, dy, dz);
        if (world.rayHit(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d) < d - 0.05) continue;
      }
      return { x, y: v.y, z, region };
    }
  }
  return null;
}

export function installDebugMenu(game, { world, hud, sfx }) {
  const box = document.getElementById('dbgMenu');
  const net = () => game.net;
  const dbg = {
    open: false,
    sel: 0,               // indice dans la liste triée des coéquipiers
    perf: false,
    log: [],
    known: new Map(),     // pid -> nom (pour afficher « déconnecté »)
    armed: null,          // { pid, until } : T pressé une première fois
    cool: new Map(),      // pid -> game.time de fin de recharge
    pending: new Map(),   // pid -> { name } : dbg_tp envoyé, ack attendu
    recent: [],           // [{ x, y, z, t }] points récemment utilisés (cibles réparties sur des points différents)
    fps: { n: 0, t: 0, v: 0 },
  };
  game.debugMenu = dbg;
  dbg.findSafeSpot = findSafeSpot; dbg.spotValid = spotValid; // accès aux outils de test (Playwright)

  const say = (text, bad = false) => {
    const line = `${(game.time || 0).toFixed(0).padStart(4, ' ')} s  ${text}`;
    dbg.log.push({ line, bad });
    if (dbg.log.length > LOG_MAX) dbg.log.shift();
    console.info('[DBG]', text);
    dbg.render();
  };
  dbg.say = say;

  const regionOf = (p) => p.region || 0;
  const zoneName = (x, z) => (world.zoneOf ? (world.zoneNames[world.zoneOf(x, z)] ?? 'hors zone') : '');
  const regionName = (r) => (r && world.levels ? ` (${world.levels.regions[r]?.name || 'étage'})` : '');
  const list = () => {
    for (const r of game.remotes.values()) dbg.known.set(r.id, r.name);
    return [...dbg.known.entries()].sort((a, b) => a[0] - b[0]).map(([id, name]) => ({ id, name, rp: game.remotes.get(id) || null }));
  };
  dbg.list = list;
  const selected = () => list()[dbg.sel] || null;
  const stateOf = (rp) => (!rp ? 'déconnecté' : rp.dead ? 'mort' : rp.downed ? 'À TERRE' : 'vivant');

  // ------------------------------------------------------------------ ouverture / fermeture
  dbg.show = function show() {
    if (!game.isHost || !game.started || game.over || !game.playing) return false;
    dbg.open = true; game.ui?.open('debug');
    box.classList.remove('hidden');
    dbg.render();
    return true;
  };
  dbg.close = function close() {
    if (!dbg.open) return;
    dbg.open = false; game.ui?.close('debug');
    box.classList.add('hidden');
  };
  dbg.toggle = () => (dbg.open ? dbg.close() : dbg.show());

  // ------------------------------------------------------------------ affichage
  dbg.render = function render() {
    if (!dbg.open) return;
    const p = game.player, esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let h = '<b>MENU DEBUG HÔTE</b> (F9/Échap : fermer)\n';
    h += '1-4 joueur · T×2 amener · Y aller · N réanimer\nU débloquer les zombies · P perfs\n\n';
    const L = list();
    if (!L.length) h += '  (aucun coéquipier)\n';
    L.forEach((e, i) => {
      const rp = e.rp;
      const d = rp ? Math.round(Math.hypot(rp.pos.x - p.pos.x, rp.pos.z - p.pos.z)) : '-';
      const where = rp ? `${zoneName(rp.pos.x, rp.pos.z)}${regionName(rp.region)}${rp.ride ? ` [${rp.ride.v.def.name.toLowerCase()}]` : ''}` : '';
      const cd = dbg.cool.get(e.id) > now() ? ` (recharge ${Math.ceil(dbg.cool.get(e.id) - now())} s)` : '';
      const armed = dbg.armed && dbg.armed.pid === e.id && dbg.armed.until > now() ? ' <b>[T encore pour amener]</b>' : '';
      const row = `${i === dbg.sel ? '>' : ' '}${i + 1} ${esc(e.name).padEnd(12)} ${stateOf(rp).padEnd(10)} ${String(d).padStart(4)} m  ${esc(where)}${cd}${armed}`;
      h += i === dbg.sel ? `<span class="sel">${row}</span>\n` : `${row}\n`;
    });
    if (dbg.perf) {
      const r = game.renderer?.info?.render;
      h += `\nFPS ${dbg.fps.v} · appels ${r ? r.calls : '?'} · triangles ${r ? r.triangles : '?'} · zombies ${game.zombies.filter((z) => !z.dead).length}\n`;
    }
    h += '\n<b>Journal</b>\n';
    h += dbg.log.slice(-12).map((l) => (l.bad ? `<span class="bad">${esc(l.line)}</span>` : esc(l.line))).join('\n') || '  -';
    box.innerHTML = h;
  };

  // FPS : mesuré par la boucle de rendu quand le menu est ouvert
  let raf = 0, last = performance.now(), acc = 0, frames = 0;
  const tick = (t) => {
    raf = requestAnimationFrame(tick);
    if (!dbg.open) { last = t; acc = 0; frames = 0; return; }
    frames++; acc += t - last; last = t;
    if (acc >= 500) { dbg.fps.v = Math.round((frames * 1000) / acc); acc = 0; frames = 0; dbg.render(); }
  };
  raf = requestAnimationFrame(tick);

  // ------------------------------------------------------------------ téléportation d'un joueur près de l'hôte (T×2)
  dbg.recentAvoid = () => {
    dbg.recent = dbg.recent.filter((r) => now() - r.t < 10);
    return dbg.recent;
  };
  dbg.teleportToHost = function teleportToHost(pid) {
    const e = list().find((q) => q.id === pid);
    if (!e) return say('joueur inconnu', true);
    const rp = e.rp;
    if (!rp) return say(`${e.name} est déconnecté`, true);
    if (dbg.cool.get(pid) > now()) return say(`${e.name} : recharge ${Math.ceil(dbg.cool.get(pid) - now())} s`, true);
    const p = game.player;
    if (p.downed || p.dead) say('hôte à terre : amener quand même');
    const region = regionOf(p);
    const avoid = [...dbg.recentAvoid(), ...[...game.remotes.values()].map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z }))];
    const spot = findSafeSpot(world, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, region, avoid);
    if (!spot) return say(`aucune case sûre près de l'hôte${region ? ' (étage ' + region + ')' : ''}`, true);
    dbg.cool.set(pid, now() + COOLDOWN);
    dbg.recent.push({ x: spot.x, y: spot.y, z: spot.z, t: now() });
    dbg.pending.set(pid, { name: e.name });
    net()?.send({ t: 'dbg_tp', x: +spot.x.toFixed(2), y: +spot.y.toFixed(2), z: +spot.z.toFixed(2), region: spot.region }, pid);
    say(`${e.name} : téléportation demandée (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)})`);
  };
  // réponse du client
  dbg.onAck = function onAck(m) {
    const e = dbg.pending.get(m.from);
    dbg.pending.delete(m.from);
    const name = e?.name || dbg.known.get(m.from) || `Joueur ${m.from}`;
    if (m.ok) {
      say(`${name} téléporté près de l'hôte`);
      const text = `${name} a été téléporté près de l'hôte`;
      net()?.send({ t: 'dbg_note', text });
      hud.toast(text);
    } else say(`${name} a refusé : ${m.reason || '?'}`, true);
  };
  // client : réception de dbg_tp (déjà filtré par net.onHost)
  dbg.receive = function receive(m) {
    const p = game.player, ack = (ok, reason = '') => net()?.send({ t: 'dbg_ack', ok, reason }, net().hostId);
    const x = +m.x, y = +m.y, z = +m.z, region = m.region | 0;
    if (![x, y, z].every(Number.isFinite)) return ack(false, 'coordonnées invalides');
    if (!game.started || game.over) return ack(false, 'partie non lancée');
    const v = spotValid(world, x, y, z, region);
    if (!v.ok) { say(`téléportation refusée : ${v.reason}`, true); return ack(false, v.reason); }
    if (p.vehicle) game.leaveVehicle();   // en moto : on descend d'abord (v_leave)
    dbg.place(x, v.y, z, region);
    hud.announce('TÉLÉPORTÉ PAR L’HÔTE', '', 2500);
    say(`téléporté par l'hôte (${x.toFixed(1)} ; ${z.toFixed(1)})`);
    ack(true);
  };
  // pose le joueur local (vitesse et saut remis à zéro, p_state envoyé tout de suite)
  dbg.place = function place(x, y, z, region = 0) {
    const p = game.player;
    p.pos.set(x, y, z);
    p.vel.set(0, 0, 0); p.vy = 0; p.wasGrounded = true; p.region = region;
    p.airT = 0; p.jumpSprint = false;
    game.sendPlayerState?.();
  };

  // ------------------------------------------------------------------ l'hôte va près d'un joueur (Y)
  dbg.teleportHostTo = function teleportHostTo(pid) {
    const e = list().find((q) => q.id === pid);
    const rp = e?.rp;
    if (!rp) return say(e ? `${e.name} est déconnecté` : 'joueur inconnu', true);
    const p = game.player;
    const c = { x: rp.tpos.x, y: rp.tpos.y, z: rp.tpos.z }, region = rp.ride ? 0 : (rp.region || 0);
    const spot = findSafeSpot(world, c, region, [...dbg.recentAvoid(), ...[...game.remotes.values()].filter((q) => q !== rp).map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z }))]);
    if (!spot) return say(`aucune case sûre près de ${e.name}`, true);
    if (p.vehicle) game.leaveVehicle();
    dbg.place(spot.x, spot.y, spot.z, spot.region);
    say(`hôte téléporté près de ${e.name} (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)})`);
    net()?.send({ t: 'dbg_note', text: `L'hôte a rejoint ${e.name}` });
    hud.toast(`Vous avez rejoint ${e.name}`);
  };

  dbg.revive = function revive(pid) {
    const e = list().find((q) => q.id === pid), rp = e?.rp;
    if (!rp) return say(e ? `${e.name} est déconnecté` : 'joueur inconnu', true);
    if (!rp.downed && !rp.dead) return say(`${e.name} est debout`, true);
    rp.dead = false; rp.downed = false; rp.health = 50;
    net()?.send({ t: 'revive', id: pid });
    say(`${e.name} réanimé`);
  };

  dbg.unstick = function unstick() {
    const targets = [game.player, ...game.remotes.values()].filter((t) => !t.dead && !t.downed);
    const n = game.relocateZombies(0, targets, true);
    say(`zombies débloqués : ${n}`);
  };

  // ------------------------------------------------------------------ clavier
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F9') {
      e.preventDefault();
      if (!e.repeat) dbg.toggle();
      return;
    }
    if (!dbg.open || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (/^[1-4]$/.test(k)) {
      const i = +k - 1;
      if (list()[i]) { dbg.sel = i; dbg.armed = null; }
    } else if (k === 't') {
      const s = selected();
      if (!s) { say('aucun joueur sélectionné', true); return; }
      if (dbg.armed && dbg.armed.pid === s.id && dbg.armed.until > now()) { dbg.armed = null; dbg.teleportToHost(s.id); }
      else { dbg.armed = { pid: s.id, until: now() + DOUBLE }; say(`T encore (1,5 s) pour amener ${s.name}`); }
    } else if (k === 'y') { const s = selected(); if (s) dbg.teleportHostTo(s.id); }
    else if (k === 'n') { const s = selected(); if (s) dbg.revive(s.id); }
    else if (k === 'u') dbg.unstick();
    else if (k === 'p') dbg.perf = !dbg.perf;
    else return;
    dbg.render();
  });

  return dbg;
}
