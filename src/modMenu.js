// Menu MODS & TRICHE (touche F9, bouton dans la pause Échap).
// Permet de tricher et d'administrer la partie :
// - Téléportation : vers n'importe laquelle des 27 zones de Strasbourg, points d'intérêt clés,
//   aller sur un joueur, amener un joueur / tous les joueurs sur l'hôte, déblocage d'urgence.
// - Points : boutons rapides (+1 000, +5 000, +10 000, +50 000, +100 000, Max) ou montant personnalisé.
// - Armes : sélecteur de toutes les 23 armes du jeu avec choix du niveau Pack-a-Punch (0 à III),
//   munitions max instantanées, amélioration de l'arme en main, munitions illimitées.
// - Atouts : donner tous les 7 atouts d'un coup, ou boutons individuels (Mastodonte, Speed Cola, etc.).
// - Triche joueur : God Mode (invincibilité totale), Super Vitesse x2.2, soin 100% et réanimation.
// - Monde & Zombies : ouvrir toutes les portes de Strasbourg, nuke / tuer tous les zombies actifs,
//   changer de manche, faire apparaître des bonus (Max Ammo, Insta-kill, Nuke, Double Points).

import { CONFIG, PAP_LEVELS, setMap } from './config.js';

const RINGS = [1.5, 2.5, 3.5, 5.0];
const ANGLES = 12;
const COOLDOWN = 3;
const LOG_MAX = 50;
const now = () => performance.now() / 1000;

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

export function findSafeSpot(world, c, region = 0, avoid = []) {
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

export function installModMenu(game, { world, hud, sfx }) {
  let box = document.getElementById('modMenu');
  if (!box) {
    box = document.createElement('div');
    box.id = 'modMenu';
    box.className = 'hidden';
    document.body.appendChild(box);
  }

  const net = () => game.net;

  const mod = {
    open: false,
    tab: 'player', // 'player', 'weapons', 'perks', 'teleport', 'world', 'team'
    selPlayer: null,
    weaponSelect: 'raygun',
    papSelect: 3,
    zoneSelect: 0,
    customPoints: 50000,
    customRound: 1,
    unlockPending: false,
    perf: false,
    log: [],
    known: new Map(),
    cool: new Map(),
    pending: new Map(),
    recent: [],
    fps: { n: 0, t: 0, v: 0 },
  };

  game.modMenu = mod;
  game.debugMenu = mod; // compatibilité pour handlers net et tests
  mod.findSafeSpot = findSafeSpot;
  mod.spotValid = spotValid;

  const say = (text, bad = false) => {
    const line = `${(game.time || 0).toFixed(0).padStart(4, ' ')} s  ${text}`;
    mod.log.push({ line, bad });
    if (mod.log.length > LOG_MAX) mod.log.shift();
    console.info('[MODS]', text);
    if (mod.open && mod.tab === 'team') mod.render();
  };
  mod.say = say;

  const list = () => {
    for (const r of game.remotes.values()) mod.known.set(r.id, r.name);
    return [...mod.known.entries()].sort((a, b) => a[0] - b[0]).map(([id, name]) => ({
      id,
      name,
      rp: game.remotes.get(id) || null,
    }));
  };
  mod.list = list;

  const isHostOrSolo = () => !game.isMultiplayer || game.isHost;

  // ------------------------------------------------------------------ Ouverture / Fermeture
  mod.show = function show() {
    if (!game.started || game.over) return false;
    if (!isHostOrSolo()) {
      hud?.popup?.("Menu Mods réservé à l'hôte", 'warning');
      return false;
    }
    mod.open = true;
    game.ui?.open('modMenu');
    game.ui?.open('debug'); // assure la compatibilité avec ui.stack
    game.playing = false;
    game.player.releaseInputs();

    if (document.pointerLockElement) {
      mod.unlockPending = true;
      document.exitPointerLock();
      setTimeout(() => { mod.unlockPending = false; }, 800);
    }

    box.classList.remove('hidden');
    mod.render();
    return true;
  };

  mod.close = function close({ relock = true } = {}) {
    if (!mod.open) return;
    mod.open = false;
    game.ui?.close('modMenu');
    game.ui?.close('debug');
    box.classList.add('hidden');
    if (relock && game.started && !game.over) {
      game.ui?.resume();
    }
  };

  mod.toggle = () => {
    if (mod.open) return mod.close();
    if (!isHostOrSolo()) {
      hud?.popup?.("Menu Mods réservé à l'hôte", 'warning');
      return false;
    }
    return mod.show();
  };

  mod.absorbUnlock = function absorbUnlock() {
    if (mod.unlockPending) {
      mod.unlockPending = false;
      return true;
    }
    return mod.open;
  };

  // ------------------------------------------------------------------ Actions Joueur
  mod.toggleGodMode = function toggleGodMode() {
    const p = game.player;
    p.godMode = !p.godMode;
    if (p.godMode) {
      p.health = p.maxHealth;
      hud.announce('INVINCIBILITÉ', 'God Mode activé', 2500);
    } else {
      hud.announce('INVINCIBILITÉ', 'God Mode désactivé', 2000);
    }
    say(`God Mode : ${p.godMode ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`);
    mod.render();
  };

  mod.toggleInfiniteAmmo = function toggleInfiniteAmmo() {
    const p = game.player;
    p.infiniteAmmo = !p.infiniteAmmo;
    if (p.infiniteAmmo) {
      mod.maxAmmo(false);
      hud.announce('MUNITIONS ILLIMITÉES', 'Activées', 2500);
    } else {
      hud.announce('MUNITIONS ILLIMITÉES', 'Désactivées', 2000);
    }
    say(`Munitions illimitées : ${p.infiniteAmmo ? 'ACTIVÉES' : 'DÉSACTIVÉES'}`);
    mod.render();
  };

  mod.toggleSuperSpeed = function toggleSuperSpeed() {
    const p = game.player;
    p.superSpeed = !p.superSpeed;
    hud.announce('SUPER VITESSE', p.superSpeed ? 'Vitesse x2.2 activée' : 'Désactivée', 2200);
    say(`Super Vitesse : ${p.superSpeed ? 'ACTIVÉE' : 'DÉSACTIVÉE'}`);
    mod.render();
  };

  mod.healAndRevive = function healAndRevive() {
    const p = game.player;
    if (p.downed || p.dead) p.revive();
    p.health = p.maxHealth;
    p.grenades = CONFIG.grenade.max;
    hud.announce('SOIN COMPLET', 'Santé & Grenades restaurées', 2200);
    say('Joueur guéri et réanimé');
    mod.render();
  };

  mod.addPoints = function addPoints(amount) {
    game.addPoints(amount, 'bonus');
    hud.toast(`+${amount.toLocaleString()} points`);
    say(`Points ajoutés : +${amount}`);
    mod.render();
  };

  mod.setPoints = function setPoints(amount) {
    game.points = Math.max(0, amount | 0);
    hud.setPoints(game.points);
    hud.toast(`Points définis à ${game.points.toLocaleString()}`);
    say(`Points définis à ${game.points}`);
    mod.render();
  };

  // ------------------------------------------------------------------ Actions Armes
  mod.giveWeapon = function giveWeapon(id, papLevel = 0) {
    const cfg = CONFIG.weapons[id];
    if (!cfg) return say(`Arme inconnue : ${id}`, true);
    const p = game.player;
    p.giveWeapon(id, papLevel);
    const papStr = papLevel > 0 ? ` (Pack-a-Punch ${'I'.repeat(papLevel)})` : '';
    hud.announce(cfg.name, `Arme équipée${papStr}`, 2500);
    say(`Arme reçue : ${cfg.name}${papStr}`);
    mod.render();
  };

  mod.maxAmmo = function maxAmmo(toast = true) {
    const p = game.player;
    for (const w of p.inventory) {
      const s = p.statsOf(w);
      w.ammo = s.magSize;
      p.refill(w);
    }
    p.grenades = CONFIG.grenade.max;
    if (toast) {
      hud.announce('MUNITIONS MAX', 'Toutes les armes rechargées', 2500);
      sfx.ammo?.();
      say('Munitions max conférées');
    }
    mod.render();
  };

  mod.upgradeCurrent = function upgradeCurrent() {
    const p = game.player;
    if (p.upgradeCurrent()) {
      const w = p.curW, s = p.statsOf(w);
      hud.announce(s.name, `Améliorée au Pack-a-Punch ${'I'.repeat(w.pap)}`, 2500);
      say(`Arme améliorée : ${s.name} PaP ${w.pap}`);
    } else {
      hud.toast('Arme déjà au niveau maximum');
    }
    mod.render();
  };

  // ------------------------------------------------------------------ Actions Atouts
  mod.giveAllPerks = function giveAllPerks() {
    const p = game.player;
    for (const id of Object.keys(CONFIG.perks)) {
      p.addPerk(id);
    }
    p.health = p.maxHealth;
    hud.announce('TOUS LES ATOUTS', '7 atouts activés', 3000);
    say('Tous les atouts conférés');
    mod.render();
  };

  mod.clearAllPerks = function clearAllPerks() {
    const p = game.player;
    p.clearPerks();
    hud.announce('ATOUTS RETIRÉS', '', 2000);
    say('Tous les atouts ont été retirés');
    mod.render();
  };

  mod.togglePerk = function togglePerk(id) {
    const p = game.player;
    const cfg = CONFIG.perks[id];
    if (!cfg) return;
    if (p.perks[id]) {
      delete p.perks[id];
      p.statsVersion++;
      if (id === 'juggernog') p.health = Math.min(p.health, p.maxHealth);
      if (id === 'mulekick' && p.inventory.length > p.maxWeapons) {
        p.inventory.length = p.maxWeapons;
        if (p.weaponIdx >= p.inventory.length) p.weaponIdx = 0;
        p.switchWeapon(p.weaponIdx);
      }
      say(`Atout retiré : ${cfg.name}`);
    } else {
      p.addPerk(id);
      say(`Atout activé : ${cfg.name}`);
    }
    mod.render();
  };

  // ------------------------------------------------------------------ Actions Téléportation
  mod.place = function place(x, y, z, region = 0) {
    const p = game.player;
    if (p.vehicle) game.leaveVehicle(true);
    game.tramWalkOff?.();
    p.pos.set(x, y, z);
    p.vel.set(0, 0, 0);
    p.vy = 0;
    p.wasGrounded = true;
    p.region = region;
    p.airT = 0;
    p.jumpSprint = false;
    game.sendPlayerState?.();
  };

  mod.teleportToZone = function teleportToZone(zoneIdx) {
    const zc = world.zoneCenters?.[zoneIdx];
    const zName = world.zoneNames?.[zoneIdx] || `Zone ${zoneIdx}`;
    if (!zc) return say(`Zone ${zoneIdx} inconnue`, true);
    let spot = spotValid(world, zc.x, 0, zc.z, 0).ok
      ? { x: zc.x, y: 0, z: zc.z, region: 0 }
      : findSafeSpot(world, { x: zc.x, y: 0, z: zc.z }, 0);
    if (!spot && world.pickGround) {
      const g = world.pickGround(zc.x, zc.z, 0, 25);
      if (g) spot = { x: g.x, y: 0, z: g.z, region: 0 };
    }
    if (!spot) spot = { x: zc.x, y: 0, z: zc.z, region: 0 };
    mod.place(spot.x, spot.y, spot.z, spot.region || 0);
    say(`Téléporté vers ${zName} (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)})`);
    hud.announce('TÉLÉPORTATION', zName, 2500);
  };

  mod.teleportToPoi = function teleportToPoi(type) {
    let target = null, label = '';
    if (type === 'box') {
      const b = (world.boxes || []).find((x) => x.active) || (world.boxes || [])[0];
      if (b) { target = b.pos; label = 'Boîte Mystère'; }
    } else if (type === 'pap') {
      const m = (world.machines || []).find((x) => x.type === 'pap');
      if (m) { target = m.pos; label = 'Pack-a-Punch'; }
    } else if (type === 'gare_parvis') {
      target = { x: 75, y: 0, z: 12 }; label = 'Place de la Gare';
    } else if (type === 'gare_verriere') {
      target = { x: 31, y: 0, z: 0 }; label = 'Verrière Moderne';
    } else if (type === 'gare_hall') {
      target = { x: 2, y: 0, z: 0 }; label = 'Hall Central (Piano, Paul, Relay)';
    } else if (type === 'gare_hall_nord') {
      target = { x: 2, y: 0, z: -38 }; label = 'Hall Nord (Billetterie & Guichets)';
    } else if (type === 'gare_hall_sud') {
      target = { x: 2, y: 0, z: 38 }; label = 'Hall Sud (Consignes & Services)';
    } else if (type === 'gare_quais') {
      target = { x: -18, y: 0, z: 0 }; label = 'Quai 1 (Voie 1)';
    } else if (type === 'gare_ter') {
      target = { x: -39.5, y: 0.5, z: 0 }; label = 'Intérieur Rame TER';
    } else if (type === 'cathedral_front') {
      const c = world.zoneCenters?.[7];
      if (c) { target = { x: c.x, y: 0, z: c.z }; label = 'Parvis de la Cathédrale'; }
    } else if (type === 'cathedral_inside') {
      const c = world.zoneCenters?.[8];
      if (c) { target = { x: c.x, y: 0, z: c.z }; label = 'Intérieur de la Cathédrale'; }
    } else if (type === 'kleber') {
      const c = world.zoneCenters?.[5];
      if (c) { target = { x: c.x, y: 0, z: c.z }; label = 'Place Kléber'; }
    } else if (type === 'petite_france') {
      const c = world.zoneCenters?.[26];
      if (c) { target = { x: c.x, y: 0, z: c.z }; label = 'Petite France'; }
    } else if (type === 'tram') {
      const tr = game.tramRides?.[0] || game.trams?.[0];
      if (tr) {
        game.placeInTram(tr, 0, 0);
        say('Téléporté dans la rame de tram');
        hud.announce('TÉLÉPORTATION', 'Intérieur du Tramway', 2500);
        return;
      }
    }
    if (!target) return say(`Point d'intérêt indisponible : ${type}`, true);
    const spot = findSafeSpot(world, target, 0) || { x: target.x, y: target.y || 0, z: target.z, region: 0 };
    mod.place(spot.x, spot.y, spot.z, spot.region || 0);
    say(`Téléporté vers ${label}`);
    hud.announce('TÉLÉPORTATION', label, 2500);
  };

  mod.emergencyUnstick = function emergencyUnstick() {
    const p = game.player;
    if (p.vehicle) game.leaveVehicle(true);
    if (p.onTram) game.tramWalkOff?.();
    let spot = findSafeSpot(world, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, 0);
    if (!spot && game.unstick?.findSpot) {
      const s = game.unstick.findSpot(p.pos.x, p.pos.z);
      if (s) spot = { x: s.x, y: 0, z: s.z, region: 0 };
    }
    if (!spot && world.pickGround) {
      const g = world.pickGround(p.pos.x, p.pos.z, 0, 30);
      if (g) spot = { x: g.x, y: 0, z: g.z, region: 0 };
    }
    if (!spot) spot = { x: world.startPos.x, y: 0, z: world.startPos.z, region: 0 };
    mod.place(spot.x, spot.y, spot.z, spot.region || 0);
    hud.announce('DÉBLOQUÉ', 'Replacé en zone dégagée', 2500);
    say(`Déblocage d'urgence réussi (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)})`);
  };

  // Téléportation multijoueur
  mod.teleportHostTo = function teleportHostTo(pid) {
    const e = list().find((q) => q.id === pid);
    const rp = e?.rp;
    if (!rp) return say(e ? `${e.name} est déconnecté` : 'joueur inconnu', true);
    const p = game.player;
    const trm = rp.tr && !rp.ride ? game.rideById(rp.tr.id) : null;
    if (trm?.isTram) {
      if (p.vehicle) game.leaveVehicle(true);
      game.placeInTram(trm, rp.tr.u + 0.8, 0);
      say(`Hôte téléporté dans la rame près de ${e.name}`);
      net()?.send({ t: 'dbg_note', text: `L'hôte a rejoint ${e.name}` });
      hud.toast(`Vous avez rejoint ${e.name}`);
      return;
    }
    const c = { x: rp.tpos.x, y: rp.tpos.y, z: rp.tpos.z }, region = rp.ride ? 0 : (rp.region || 0);
    const spot = findSafeSpot(world, c, region, [...game.remotes.values()].filter((q) => q !== rp).map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z })));
    if (!spot) return say(`Aucune case sûre près de ${e.name}`, true);
    if (p.vehicle) game.leaveVehicle(true);
    mod.place(spot.x, spot.y, spot.z, spot.region);
    say(`Hôte téléporté près de ${e.name}`);
    net()?.send({ t: 'dbg_note', text: `L'hôte a rejoint ${e.name}` });
    hud.toast(`Vous avez rejoint ${e.name}`);
  };

  mod.teleportToHost = function teleportToHost(pid) {
    const e = list().find((q) => q.id === pid);
    if (!e) return say('joueur inconnu', true);
    const rp = e.rp;
    if (!rp) return say(`${e.name} est déconnecté`, true);
    if (mod.cool.get(pid) > now()) return say(`${e.name} : recharge ${Math.ceil(mod.cool.get(pid) - now())} s`, true);
    const p = game.player;
    const region = p.region || 0;
    const avoid = [...game.remotes.values()].map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z }));
    const spot = findSafeSpot(world, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, region, avoid);
    if (!spot) return say(`Aucune case sûre près de l'hôte`, true);
    mod.cool.set(pid, now() + COOLDOWN);
    mod.pending.set(pid, { name: e.name });
    net()?.send({ t: 'dbg_tp', x: +spot.x.toFixed(2), y: +spot.y.toFixed(2), z: +spot.z.toFixed(2), region: spot.region }, pid);
    say(`${e.name} : téléportation demandée (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)})`);
  };

  mod.teleportAllToMe = function teleportAllToMe() {
    const L = list().filter((e) => e.rp);
    if (!L.length) return say('Aucun coéquipier connecté', true);
    for (const e of L) mod.teleportToHost(e.id);
    say(`Téléportation demandée pour ${L.length} coéquipier(s)`);
    hud.announce('AMENER L\'ÉQUIPE', `${L.length} joueur(s) appelés`, 2500);
  };

  mod.reviveRemote = function reviveRemote(pid) {
    const e = list().find((q) => q.id === pid), rp = e?.rp;
    if (!rp) return say(e ? `${e.name} est déconnecté` : 'joueur inconnu', true);
    if (!rp.downed && !rp.dead) return say(`${e.name} est déjà debout`, true);
    rp.dead = false; rp.downed = false; rp.health = 50;
    net()?.send({ t: 'revive', id: pid });
    say(`${e.name} réanimé`);
    hud.toast(`${e.name} réanimé`);
  };

  // Réception réseau client
  mod.onAck = function onAck(m) {
    const e = mod.pending.get(m.from);
    mod.pending.delete(m.from);
    const name = e?.name || mod.known.get(m.from) || `Joueur ${m.from}`;
    if (m.ok) {
      say(`${name} téléporté près de l'hôte`);
      const text = `${name} a été téléporté près de l'hôte`;
      net()?.send({ t: 'dbg_note', text });
      hud.toast(text);
    } else say(`${name} a refusé : ${m.reason || '?'}`, true);
  };

  mod.receive = function receive(m) {
    const p = game.player, ack = (ok, reason = '') => net()?.send({ t: 'dbg_ack', ok, reason }, net().hostId);
    const x = +m.x, y = +m.y, z = +m.z, region = m.region | 0;
    if (![x, y, z].every(Number.isFinite)) return ack(false, 'coordonnées invalides');
    if (!game.started || game.over) return ack(false, 'partie non lancée');
    const v = spotValid(world, x, y, z, region);
    if (!v.ok) { say(`Téléportation refusée : ${v.reason}`, true); return ack(false, v.reason); }
    if (p.vehicle) game.leaveVehicle(true);
    mod.place(x, v.y, z, region);
    hud.announce('TÉLÉPORTÉ PAR L’HÔTE', '', 2500);
    say(`Téléporté par l'hôte (${x.toFixed(1)} ; ${z.toFixed(1)})`);
    ack(true);
  };

  // ------------------------------------------------------------------ Actions Monde & Zombies
  mod.openAllDoors = function openAllDoors() {
    const doors = world.doors || [];
    let count = 0;
    for (const d of doors) {
      if (!d.open) {
        game.openDoor(d.id, false);
        if (game.isMultiplayer) net()?.send({ t: 'door_open', id: d.id });
        count++;
      }
    }
    hud.announce('PORTES DÉVERROUILLÉES', `${count} porte${count > 1 ? 's' : ''} ouverte${count > 1 ? 's' : ''}`, 3000);
    say(`${count} portes ouvertes`);
    mod.render();
  };

  mod.killAllZombies = function killAllZombies() {
    let count = 0;
    for (const z of game.zombies) {
      if (!z.dead) {
        z.damage(999999, false);
        if (game.isMultiplayer) net()?.send({ t: 'z_dead', id: z.id, head: false });
        count++;
      }
    }
    hud.flashNuke?.();
    sfx.nuke?.();
    hud.announce('NUKE ADMIN', `${count} zombie${count > 1 ? 's' : ''} éliminé${count > 1 ? 's' : ''}`, 2500);
    say(`${count} zombies éliminés`);
    mod.render();
  };

  mod.setRound = function setRound(targetRound) {
    const r = Math.max(1, targetRound | 0);
    game.round = r - 1;
    game.toSpawn = 0;
    for (const z of game.zombies) {
      if (!z.dead) {
        z.damage(999999, false);
        if (game.isMultiplayer) net()?.send({ t: 'z_dead', id: z.id, head: false });
      }
    }
    game.intermission = 0.5;
    hud.announce('CHANGEMENT DE MANCHE', `Passage à la manche ${r}`, 3000);
    say(`Manche modifiée vers ${r}`);
    mod.render();
  };

  mod.nextRound = function nextRound() {
    mod.setRound(game.round + 1);
  };

  mod.prevRound = function prevRound() {
    mod.setRound(Math.max(1, game.round - 1));
  };

  mod.spawnPowerup = function spawnPowerup(type) {
    const p = game.player;
    const spot = p.pos.clone().add(new game.THREE.Vector3(-Math.sin(p.yaw) * 2.5, 0, -Math.cos(p.yaw) * 2.5));
    game.spawnPowerup(spot, null, type);
    hud.announce('BONUS APPARU', type.toUpperCase().replace('_', ' '), 2000);
    say(`Bonus généré : ${type}`);
  };

  mod.unstickZombies = function unstickZombies() {
    const targets = [game.player, ...game.remotes.values()].filter((t) => !t.dead && !t.downed);
    const n = game.relocateZombies(0, targets, true);
    hud.announce('ZOMBIES REPOSITIONNÉS', `${n} zombie${n > 1 ? 's' : ''} débloqué${n > 1 ? 's' : ''}`, 2200);
    say(`Zombies débloqués : ${n}`);
  };

  // FPS & Perfs
  let raf = 0, last = performance.now(), acc = 0, frames = 0;
  const tick = (t) => {
    if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);
    if (!mod.open) { last = t; acc = 0; frames = 0; return; }
    frames++; acc += t - last; last = t;
    if (acc >= 500) { mod.fps.v = Math.round((frames * 1000) / acc); acc = 0; frames = 0; }
  };
  if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);

  // ------------------------------------------------------------------ Rendu UI
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  mod.render = function render() {
    if (!mod.open) return;
    const p = game.player;
    const activeZombies = game.zombies.filter((z) => !z.dead).length;

    let h = `
      <div class="mod-header">
        <div class="mod-title-area">
          <div class="mod-title">⚡ MENU MODS & TRICHE</div>
          <div class="mod-sub">Zombie Survival Strasbourg · F9 / Échap pour fermer</div>
        </div>
        <div class="mod-stats-pills">
          <span class="mod-pill ${p.godMode ? 'mod-pill-active' : ''}">GODMODE: ${p.godMode ? 'ON' : 'OFF'}</span>
          <span class="mod-pill ${p.infiniteAmmo ? 'mod-pill-active' : ''}">MUN. INF.: ${p.infiniteAmmo ? 'ON' : 'OFF'}</span>
          <span class="mod-pill">MANCHE: ${game.round}</span>
          <span class="mod-pill mod-pill-gold">PTS: ${game.points.toLocaleString()}</span>
          <button class="mod-btn-close" id="modCloseBtn" title="Fermer le menu">✕</button>
        </div>
      </div>

      <div class="mod-tabs">
        <button class="mod-tab-btn ${mod.tab === 'player' ? 'active' : ''}" data-tab="player">👤 JOUEUR</button>
        <button class="mod-tab-btn ${mod.tab === 'weapons' ? 'active' : ''}" data-tab="weapons">🔫 ARMES</button>
        <button class="mod-tab-btn ${mod.tab === 'perks' ? 'active' : ''}" data-tab="perks">⚡ ATOUTS</button>
        <button class="mod-tab-btn ${mod.tab === 'teleport' ? 'active' : ''}" data-tab="teleport">📍 TÉLÉPORTATION</button>
        <button class="mod-tab-btn ${mod.tab === 'world' ? 'active' : ''}" data-tab="world">🧟 MONDE & ZOMBIES</button>
        <button class="mod-tab-btn ${mod.tab === 'audio' ? 'active' : ''}" data-tab="audio">🎵 MUSIQUE</button>
        <button class="mod-tab-btn ${mod.tab === 'team' ? 'active' : ''}" data-tab="team">📜 JOURNAL & ÉQUIPE</button>
      </div>

      <div class="mod-body">
    `;

    // -------------------------------- TAB : JOUEUR --------------------------------
    if (mod.tab === 'player') {
      h += `
        <div class="mod-card">
          <div class="mod-card-title">🛡️ MODES DE TRICHE PRINCIPAUX</div>
          <div class="mod-grid">
            <button class="mod-btn ${p.godMode ? 'mod-btn-active' : 'mod-btn-primary'}" id="modGodMode">
              <b>${p.godMode ? '✅ INVINCIBILITÉ : ACTIVÉE' : '🛡️ GOD MODE (INVINCIBILITÉ)'}</b>
              <small>${p.godMode ? 'Vous ne subissez aucun dégât' : 'Immunité totale aux zombies, chutes et explosions'}</small>
            </button>
            <button class="mod-btn ${p.infiniteAmmo ? 'mod-btn-active' : 'mod-btn-primary'}" id="modInfAmmo">
              <b>${p.infiniteAmmo ? '✅ MUNITIONS ILLIMITÉES : ACTIVÉES' : '♾️ MUNITIONS ILLIMITÉES'}</b>
              <small>${p.infiniteAmmo ? 'Tir sans consommer de balles' : 'Chargeur et réserve infinis'}</small>
            </button>
            <button class="mod-btn ${p.superSpeed ? 'mod-btn-active' : 'mod-btn-primary'}" id="modSuperSpeed">
              <b>${p.superSpeed ? '✅ SUPER VITESSE : ACTIVÉE' : '⚡ SUPER VITESSE (x2.2)'}</b>
              <small>${p.superSpeed ? 'Vitesse de déplacement doublée' : 'Déplacement et sprint ultra-rapides'}</small>
            </button>
            <button class="mod-btn mod-btn-success" id="modHeal">
              <b>❤️ SOIN 100% & RÉANIMATION</b>
              <small>PV au maximum, relève si à terre, 4 grenades</small>
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">💰 AJOUT DE POINTS</div>
          <div class="mod-btn-row">
            <button class="mod-btn mod-btn-gold" data-pts="1000">+1 000</button>
            <button class="mod-btn mod-btn-gold" data-pts="5000">+5 000</button>
            <button class="mod-btn mod-btn-gold" data-pts="10000">+10 000</button>
            <button class="mod-btn mod-btn-gold" data-pts="50000">+50 000</button>
            <button class="mod-btn mod-btn-gold" data-pts="100000">+100 000</button>
            <button class="mod-btn mod-btn-gold" id="modMaxPts">MAX (999 999)</button>
          </div>
          <div class="mod-input-group" style="margin-top: 10px;">
            <label>Définir montant exact :</label>
            <input type="number" id="modCustomPtsInput" class="mod-input" value="${mod.customPoints}" step="1000" min="0" max="9999999" />
            <button class="mod-btn mod-btn-sub" id="modSetPtsBtn">Appliquer</button>
          </div>
        </div>
      `;
    }

    // -------------------------------- TAB : ARMES --------------------------------
    else if (mod.tab === 'weapons') {
      const curW = p.curW;
      const curCfg = p.curCfg;
      h += `
        <div class="mod-card">
          <div class="mod-card-title">🔫 SÉLECTIONNER ET OBTENIR UNE ARME</div>
          <div class="mod-controls-row">
            <div style="flex: 2;">
              <label>Arme à obtenir :</label>
              <select id="modWeaponSelect" class="mod-select">
                <optgroup label="🌟 Armes Spéciales & Lourdes">
                  <option value="raygun" ${mod.weaponSelect === 'raygun' ? 'selected' : ''}>Pistolet à Rayons (Ray Gun)</option>
                  <option value="m79" ${mod.weaponSelect === 'm79' ? 'selected' : ''}>Lance-grenades M79 (40mm)</option>
                  <option value="crossbow" ${mod.weaponSelect === 'crossbow' ? 'selected' : ''}>Arbalète explosive</option>
                  <option value="barrett" ${mod.weaponSelect === 'barrett' ? 'selected' : ''}>Barrett M82 (.50 BMG)</option>
                  <option value="m249" ${mod.weaponSelect === 'm249' ? 'selected' : ''}>M249 SAW (5,56mm)</option>
                  <option value="pkm" ${mod.weaponSelect === 'pkm' ? 'selected' : ''}>PKM (7,62×54R)</option>
                  <option value="mg42" ${mod.weaponSelect === 'mg42' ? 'selected' : ''}>MG42 (7,92×57mm)</option>
                </optgroup>
                <optgroup label="Fusils d'assaut">
                  <option value="rifle" ${mod.weaponSelect === 'rifle' ? 'selected' : ''}>M4A1 (5,56mm)</option>
                  <option value="ak47" ${mod.weaponSelect === 'ak47' ? 'selected' : ''}>AK-47 (7,62×39mm)</option>
                  <option value="scar" ${mod.weaponSelect === 'scar' ? 'selected' : ''}>SCAR-H (7,62×51mm)</option>
                  <option value="famas" ${mod.weaponSelect === 'famas' ? 'selected' : ''}>FAMAS F1 (5,56mm)</option>
                </optgroup>
                <optgroup label="Fusils de précision">
                  <option value="sniper" ${mod.weaponSelect === 'sniper' ? 'selected' : ''}>L96A1 AWP</option>
                  <option value="svd" ${mod.weaponSelect === 'svd' ? 'selected' : ''}>Dragunov SVD</option>
                </optgroup>
                <optgroup label="Mitraillettes">
                  <option value="mp5" ${mod.weaponSelect === 'mp5' ? 'selected' : ''}>MP5 (9mm)</option>
                  <option value="p90" ${mod.weaponSelect === 'p90' ? 'selected' : ''}>FN P90 (5,7×28mm)</option>
                  <option value="smg" ${mod.weaponSelect === 'smg' ? 'selected' : ''}>MP40 (9mm)</option>
                </optgroup>
                <optgroup label="Fusils à pompe">
                  <option value="shotgun" ${mod.weaponSelect === 'shotgun' ? 'selected' : ''}>Remington 870 (12 ga)</option>
                  <option value="saiga" ${mod.weaponSelect === 'saiga' ? 'selected' : ''}>Saiga-12 automatique</option>
                </optgroup>
                <optgroup label="Pistolets">
                  <option value="deagle" ${mod.weaponSelect === 'deagle' ? 'selected' : ''}>Desert Eagle (.50 AE)</option>
                  <option value="magnum" ${mod.weaponSelect === 'magnum' ? 'selected' : ''}>Colt Python (.357)</option>
                  <option value="arex" ${mod.weaponSelect === 'arex' ? 'selected' : ''}>Arex Zero 1 (9mm)</option>
                  <option value="m1911" ${mod.weaponSelect === 'm1911' ? 'selected' : ''}>Colt M1911 (.45)</option>
                </optgroup>
              </select>
            </div>
            <div style="flex: 1;">
              <label>Niveau Pack-a-Punch :</label>
              <select id="modPapSelect" class="mod-select">
                <option value="0" ${mod.papSelect === 0 ? 'selected' : ''}>Standard (Niveau 0)</option>
                <option value="1" ${mod.papSelect === 1 ? 'selected' : ''}>Pack-a-Punch I</option>
                <option value="2" ${mod.papSelect === 2 ? 'selected' : ''}>Pack-a-Punch II</option>
                <option value="3" ${mod.papSelect === 3 ? 'selected' : ''}>Pack-a-Punch III (Max)</option>
              </select>
            </div>
          </div>
          <div style="margin-top: 14px;">
            <button class="mod-btn mod-btn-success" id="modGiveWeaponBtn" style="font-size: 16px; width: 100%;">
              ✨ S'ÉQUIPER DE L'ARME SÉLECTIONNÉE
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">⚡ ACTIONS RAPIDES SUR L'INVENTAIRE</div>
          <div class="mod-grid">
            <button class="mod-btn mod-btn-gold" id="modMaxAmmoBtn">
              <b>📦 MUNITIONS MAX</b>
              <small>Recharge tous les chargeurs, réserves et 4 grenades</small>
            </button>
            <button class="mod-btn mod-btn-purple" id="modUpgradeCurBtn">
              <b>⭐ AMÉLIORER L'ARME EN MAIN (+1 PaP)</b>
              <small>Niveau actuel : ${curW ? `PaP ${curW.pap || 0}` : '-'}</small>
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🎒 INVENTAIRE ACTUEL (${p.inventory.length}/${p.maxWeapons})</div>
          <div class="mod-inv-list">
            ${p.inventory.map((w, idx) => {
              const s = p.statsOf(w);
              const isHeld = idx === p.weaponIdx;
              return `
                <div class="mod-inv-row ${isHeld ? 'mod-inv-row-held' : ''}">
                  <div>
                    <b>${idx + 1}. ${esc(s.name)}</b>
                    ${w.pap > 0 ? `<span class="mod-badge-pap">PaP ${'I'.repeat(w.pap)}</span>` : ''}
                    ${isHeld ? '<span class="mod-badge-held">EN MAIN</span>' : ''}
                    <div style="font-size: 12px; color: #94a3b8;">${esc(s.caliber)} · Chargeur : ${w.ammo}/${s.magSize} · Réserve : ${w.reserve}</div>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <button class="mod-btn-sm" data-switch-w="${idx}">Équiper</button>
                    <button class="mod-btn-sm mod-btn-gold" data-refill-w="${idx}">Recharger</button>
                    <button class="mod-btn-sm mod-btn-purple" data-maxpap-w="${idx}">PaP III</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // -------------------------------- TAB : ATOUTS --------------------------------
    else if (mod.tab === 'perks') {
      const perksCfg = CONFIG.perks;
      h += `
        <div class="mod-card">
          <div class="mod-card-title">⚡ GESTION GLOBALE DES ATOUTS</div>
          <div class="mod-btn-row">
            <button class="mod-btn mod-btn-success" id="modGiveAllPerks" style="flex: 2;">
              🌟 DONNER TOUS LES 7 ATOUTS
            </button>
            <button class="mod-btn mod-btn-danger" id="modClearPerks" style="flex: 1;">
              ❌ RETIRER TOUS LES ATOUTS
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">📋 ATOUTS INDIVIDUELS</div>
          <div class="mod-grid">
            ${Object.entries(perksCfg).map(([id, cfg]) => {
              const owned = !!p.perks[id];
              return `
                <button class="mod-btn ${owned ? 'mod-btn-active' : 'mod-btn-sub'}" data-toggle-perk="${id}" style="border-left: 5px solid ${cfg.color};">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <b style="color: ${cfg.color};">${esc(cfg.name)}</b>
                    <span class="mod-pill ${owned ? 'mod-pill-active' : ''}">${owned ? 'POSSÉDÉ' : 'NON'}</span>
                  </div>
                  <small>${esc(cfg.desc)}</small>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // -------------------------------- TAB : TÉLÉPORTATION --------------------------------
    else if (mod.tab === 'teleport') {
      const zones = CONFIG.sector.zones;
      const teammates = list().filter((e) => e.rp);
      h += `
        <div class="mod-card">
          <div class="mod-card-title">🆘 DÉBLOCAGE D'URGENCE</div>
          <button class="mod-btn mod-btn-success" id="modEmergencyUnstick" style="width: 100%; font-size: 15px;">
            🚀 DÉBLOCAGE IMMÉDIAT (Replacer le joueur sur une case dégagée)
          </button>
          <small style="color: #94a3b8; display: block; margin-top: 4px;">
            Vous replace instantanément sur le sol sécurisé le plus proche sans risque de collision.
          </small>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🗺️ CHOIX DE LA CARTE DE JEU</div>
          <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">Carte active : <b style="color: #38bdf8;">${CONFIG.map === 'gare' ? 'Gare de Strasbourg' : 'Grande Île de Strasbourg'}</b></div>
          <button class="mod-btn mod-btn-primary" id="modToggleMapBtn" style="width: 100%; border-color: #38bdf8; color: #38bdf8;">
            ${CONFIG.map === 'gare' ? 'PASSER SUR LA GRANDE ÎLE (RECHARGEMENT)' : 'PASSER SUR LA GARE DE STRASBOURG (RECHARGEMENT)'}
          </button>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">📍 TÉLÉPORTATION PAR QUARTIER DE STRASBOURG (${zones.length} ZONES)</div>
          <div class="mod-controls-row">
            <select id="modZoneSelect" class="mod-select" style="flex: 2;">
              ${zones.map((z, i) => `
                <option value="${i}" ${mod.zoneSelect === i ? 'selected' : ''}>
                  ${i + 1}. ${esc(z.name)}
                </option>
              `).join('')}
            </select>
            <button class="mod-btn mod-btn-primary" id="modTeleportZoneBtn" style="flex: 1;">
              TÉLÉPORTER VERS CE QUARTIER
            </button>
          </div>

          <div style="margin-top: 10px;">
            <label style="font-size: 12px; color: #94a3b8; margin-bottom: 6px; display: block;">Accès directs rapides :</label>
            <div class="mod-btn-row">
              ${CONFIG.map === 'gare' ? `
                <button class="mod-btn-sm" data-tp-zone="0">Place de la Gare</button>
                <button class="mod-btn-sm" data-tp-zone="1">Verrière Moderne</button>
                <button class="mod-btn-sm" data-tp-zone="2">Grand Hall</button>
                <button class="mod-btn-sm" data-tp-zone="3">Quais & Voies</button>
                <button class="mod-btn-sm" data-tp-zone="4">Plateforme TGV</button>
              ` : `
                <button class="mod-btn-sm" data-tp-zone="5">Place Kléber</button>
                <button class="mod-btn-sm" data-tp-zone="7">Cathédrale</button>
                <button class="mod-btn-sm" data-tp-zone="9">Homme de Fer</button>
                <button class="mod-btn-sm" data-tp-zone="26">Petite France</button>
                <button class="mod-btn-sm" data-tp-zone="11">Grand'Rue</button>
                <button class="mod-btn-sm" data-tp-zone="13">Palais Rohan</button>
              `}
            </div>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🎯 POINTS D'INTÉRÊT CLÉS</div>
          <div class="mod-grid">
            <button class="mod-btn mod-btn-gold" data-tp-poi="box">
              <b>🎁 BOÎTE MYSTÈRE ACTIVE</b>
              <small>Se téléporter devant la boîte magique</small>
            </button>
            <button class="mod-btn mod-btn-purple" data-tp-poi="pap">
              <b>🔧 MACHINE PACK-A-PUNCH</b>
              <small>${CONFIG.map === 'gare' ? 'Sur le Quai 1 de la Gare' : 'Atelier d\'amélioration'}</small>
            </button>
            ${CONFIG.map === 'gare' ? `
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_verriere">
                <b>🪟 LA VERRIÈRE (BULLE 2007)</b>
                <small>Arche vitrée & façade historique</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_hall">
                <b>🎹 HALL CENTRAL (PIANO & PAUL)</b>
                <small>Piano SNCF, boulangerie Paul, Relay</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_hall_nord">
                <b>🎟️ HALL NORD (BILLETTERIE)</b>
                <small>Espace vente & bornes TER Fluo</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_hall_sud">
                <b>🛅 HALL SUD (CONSIGNES)</b>
                <small>Consignes bagages & commodités</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_quais">
                <b>🚆 QUAI 1 & MARQUISE</b>
                <small>Quai voyageurs & voies ferrées</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_ter">
                <b>🚄 INTÉRIEUR DU TRAIN TER</b>
                <small>Dans la voiture voyageur du train</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="gare_parvis">
                <b>🏙️ PLACE DE LA GARE</b>
                <small>Parvis extérieur & tramway CTS</small>
              </button>
            ` : `
              <button class="mod-btn mod-btn-sub" data-tp-poi="cathedral_inside">
                <b>🏛️ INTÉRIEUR CATHÉDRALE</b>
                <small>Entrer dans la nef de la cathédrale</small>
              </button>
              <button class="mod-btn mod-btn-sub" data-tp-poi="tram">
                <b>🚋 INTÉRIEUR DU TRAMWAY</b>
                <small>Monter dans la rame de tramway en circulation</small>
              </button>
            `}
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">👥 TÉLÉPORTATION MULTIJOUEUR</div>
          ${!game.isMultiplayer || !teammates.length ? `
            <div style="color: #94a3b8; padding: 6px 0;">(Aucun coéquipier connecté en multijoueur)</div>
          ` : `
            <div style="margin-bottom: 10px;">
              <button class="mod-btn mod-btn-primary" id="modBringAllBtn" style="width: 100%;">
                👥 AMENER TOUS LES JOUEURS SUR MOI
              </button>
            </div>
            <div class="mod-inv-list">
              ${teammates.map((e) => {
                const rp = e.rp;
                const d = rp ? Math.round(Math.hypot(rp.pos.x - p.pos.x, rp.pos.z - p.pos.z)) : '-';
                const st = !rp ? 'Déconnecté' : rp.dead ? 'MORT' : rp.downed ? 'À TERRE' : 'Vivant';
                return `
                  <div class="mod-inv-row">
                    <div>
                      <b>${esc(e.name)}</b>
                      <span class="mod-pill ${rp.downed || rp.dead ? 'mod-pill-danger' : 'mod-pill-active'}">${st}</span>
                      <span style="font-size: 12px; color: #94a3b8; margin-left: 8px;">Distance : ${d} m</span>
                    </div>
                    <div style="display: flex; gap: 6px;">
                      <button class="mod-btn-sm mod-btn-primary" data-tp-to-player="${e.id}">Aller sur lui</button>
                      <button class="mod-btn-sm mod-btn-gold" data-bring-player="${e.id}">L'amener sur moi</button>
                      ${rp.downed || rp.dead ? `<button class="mod-btn-sm mod-btn-success" data-revive-player="${e.id}">Réanimer</button>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;
    }

    // -------------------------------- TAB : MONDE & ZOMBIES --------------------------------
    else if (mod.tab === 'world') {
      h += `
        <div class="mod-card">
          <div class="mod-card-title">🎵 AMBIANCE & PISTES AUDIO (${sfx?.getCurrentTrack?.().name || 'Musique'})</div>
          <div class="mod-btn-row">
            <button class="mod-btn mod-btn-sub" id="modPrevTrackBtn">⏮️ Morceau précédent</button>
            <button class="mod-btn mod-btn-primary" id="modNextTrackBtn">⏭️ Morceau suivant</button>
          </div>
          <small style="color: #94a3b8; display: block; margin-top: 4px;">
            Enchaînement automatique des morceaux (Jeaux Davide & Midnight Lurch). Raccourci en jeu : touche <b>N</b>.
          </small>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🚪 PORTES & EXPLORATION</div>
          <button class="mod-btn mod-btn-gold" id="modOpenAllDoorsBtn" style="width: 100%; font-size: 15px;">
            🔓 OUVRIR TOUTES LES PORTES DE STRASBOURG
          </button>
          <small style="color: #94a3b8; display: block; margin-top: 4px;">
            Déverrouille immédiatement toutes les barrières et portes payantes de l'île sans consommer de points.
          </small>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🧟 ZOMBIES & ÉLIMINATION</div>
          <div class="mod-grid">
            <button class="mod-btn mod-btn-danger" id="modKillZombiesBtn">
              <b>💣 TUER TOUS LES ZOMBIES ACTIFS (${activeZombies})</b>
              <small>Élimine instantanément tous les zombies actuellement en vie</small>
            </button>
            <button class="mod-btn mod-btn-sub" id="modUnstickZombiesBtn">
              <b>🔄 DÉBLOQUER LES ZOMBIES COINCÉS</b>
              <small>Repositionne les zombies égarés sur le réseau piéton</small>
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🔢 CONTRÔLE DES MANCHES (MANCHE ACTUELLE : ${game.round})</div>
          <div class="mod-btn-row">
            <button class="mod-btn mod-btn-sub" id="modPrevRoundBtn">⏮️ Manche précédente (-1)</button>
            <button class="mod-btn mod-btn-primary" id="modNextRoundBtn">⏭️ Manche suivante (+1)</button>
          </div>
          <div class="mod-input-group" style="margin-top: 10px;">
            <label>Aller directement à la manche :</label>
            <input type="number" id="modTargetRoundInput" class="mod-input" value="${game.round + 1}" min="1" max="999" />
            <button class="mod-btn mod-btn-gold" id="modSetRoundBtn">Passer à cette manche</button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🎁 APPARITION DE BONUS (POWER-UPS DEVANT SOI)</div>
          <div class="mod-grid">
            <button class="mod-btn mod-btn-gold" data-spawn-pu="max_ammo">
              <b>📦 Munitions Max</b>
              <small>Recharge immédiate de toutes les armes</small>
            </button>
            <button class="mod-btn mod-btn-danger" data-spawn-pu="insta_kill">
              <b>💀 Mort Instantanée</b>
              <small>Tous les zombies meurent en 1 coup (30s)</small>
            </button>
            <button class="mod-btn mod-btn-danger" data-spawn-pu="nuke">
              <b>☢️ Bombe (Nuke)</b>
              <small>Élimine la vague et donne +400 pts</small>
            </button>
            <button class="mod-btn mod-btn-gold" data-spawn-pu="double_points">
              <b>💰 Points Doubles</b>
              <small>Double tous les gains de points (30s)</small>
            </button>
          </div>
        </div>
      `;
    }

    // -------------------------------- TAB : JOURNAL & ÉQUIPE --------------------------------
    else if (mod.tab === 'team') {
      const r = game.renderer?.info?.render;
      h += `
        <div class="mod-card">
          <div class="mod-card-title">📊 STATISTIQUES EN TEMPS RÉEL</div>
          <div class="mod-grid">
            <div class="mod-stat-box"><span>FPS</span><b>${mod.fps.v}</b></div>
            <div class="mod-stat-box"><span>ZOMBIES EN VIE</span><b>${activeZombies}</b></div>
            <div class="mod-stat-box"><span>APPELS RENDU (DRAW)</span><b>${r ? r.calls : '?'}</b></div>
            <div class="mod-stat-box"><span>TRIANGLES AFFICHÉS</span><b>${r ? (r.triangles / 1000).toFixed(0) + 'k' : '?'}</b></div>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">📜 HISTORIQUE DES ACTIONS (JOURNAL MODS)</div>
          <div class="mod-log-box">
            ${mod.log.length ? mod.log.slice(-18).map((l) => `
              <div class="mod-log-line ${l.bad ? 'bad' : ''}">${esc(l.line)}</div>
            `).join('') : '<div style="color: #64748b;">Aucune action enregistrée</div>'}
          </div>
        </div>
      `;
    }

    // -------------------------------- TAB : MUSIQUE --------------------------------
    else if (mod.tab === 'audio') {
      const cur = sfx.getCurrentTrack();
      const volPct = Math.round((sfx.musicVolume || 0.5) * 100);
      const audioState = sfx.ctx ? sfx.ctx.state : 'inactif';

      h += `
        <div class="mod-card">
          <div class="mod-card-title">🎵 LECTEUR AUDIO & PISTES MUSICALES</div>
          <div style="background:#131d27; border:1px solid #1f364d; border-radius:6px; padding:12px; margin-bottom:12px;">
            <div style="font-size:16px; font-weight:bold; color:#4affd2;">♫ EN COURS : ${esc(cur.name.toUpperCase())}</div>
            <div style="font-size:13px; color:#aaa; margin-top:4px;">
              Type : ${cur.isCustom ? 'Morceau personnalisé OGG' : 'Synthétiseur WebAudio'} · Piste : ${cur.index + 1}/${cur.total} · Volume : ${volPct}% · État AudioContext : <b style="color:${audioState === 'running' ? '#4ade80' : '#ffd24a'}">${audioState}</b>
            </div>
          </div>

          <div class="mod-btn-row" style="margin-bottom:12px;">
            <button class="mod-btn primary" id="modMusicNext">▶ PISTE SUIVANTE [N]</button>
            <button class="mod-btn" id="modMusicPrev">◀ PISTE PRÉCÉDENTE</button>
            <button class="mod-btn" id="modMusicRestart">🔄 RELANCER LE MORCEAU</button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">📂 SÉLECTION DIRECTE DES MORCEAUX</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="mod-btn ${cur.name === 'Jeaux Davide' ? 'primary' : ''}" id="modPlayJeaux" style="text-align:left; font-size:15px; padding:10px 14px;">
              ${cur.name === 'Jeaux Davide' ? '▶' : '♫'} <b>Jeaux Davide</b> (Piste personnalisée 1)
            </button>
            <button class="mod-btn ${cur.name === 'Midnight Lurch' ? 'primary' : ''}" id="modPlayMidnight" style="text-align:left; font-size:15px; padding:10px 14px;">
              ${cur.name === 'Midnight Lurch' ? '▶' : '♫'} <b>Midnight Lurch</b> (Piste personnalisée 2)
            </button>
            <button class="mod-btn ${!cur.isCustom ? 'primary' : ''}" id="modPlaySynth" style="text-align:left; font-size:15px; padding:10px 14px;">
              ${!cur.isCustom ? '▶' : '♫'} <b>Rock synthétisé original</b> (Guitare & batterie WebAudio)
            </button>
          </div>
        </div>

        <div class="mod-card">
          <div class="mod-card-title">🔊 RÉGLAGE DU VOLUME MUSIQUE</div>
          <div class="mod-btn-row">
            <button class="mod-btn ${volPct === 25 ? 'primary' : ''}" id="modVol25">25%</button>
            <button class="mod-btn ${volPct === 50 ? 'primary' : ''}" id="modVol50">50%</button>
            <button class="mod-btn ${volPct === 75 ? 'primary' : ''}" id="modVol75">75%</button>
            <button class="mod-btn ${volPct === 100 ? 'primary' : ''}" id="modVol100">100% (Plein volume)</button>
          </div>
        </div>
      `;
    }

    h += `</div>`; // fin mod-body
    box.innerHTML = h;

    // Attacher les écouteurs d'événements du DOM
    attachModEvents();
  };

  // ------------------------------------------------------------------ Événements UI
  function attachModEvents() {
    // Fermer
    document.getElementById('modCloseBtn')?.addEventListener('click', () => mod.close());

    // Onglets
    box.querySelectorAll('.mod-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        mod.tab = btn.dataset.tab;
        mod.render();
      });
    });

    // Joueur
    document.getElementById('modGodMode')?.addEventListener('click', () => mod.toggleGodMode());
    document.getElementById('modInfAmmo')?.addEventListener('click', () => mod.toggleInfiniteAmmo());
    document.getElementById('modSuperSpeed')?.addEventListener('click', () => mod.toggleSuperSpeed());
    document.getElementById('modHeal')?.addEventListener('click', () => mod.healAndRevive());

    box.querySelectorAll('[data-pts]').forEach((btn) => {
      btn.addEventListener('click', () => mod.addPoints(+btn.dataset.pts));
    });
    document.getElementById('modMaxPts')?.addEventListener('click', () => mod.setPoints(999999));
    document.getElementById('modSetPtsBtn')?.addEventListener('click', () => {
      const val = +(document.getElementById('modCustomPtsInput')?.value || 0);
      mod.setPoints(val);
    });

    // Armes
    const wSel = document.getElementById('modWeaponSelect');
    if (wSel) wSel.addEventListener('change', () => { mod.weaponSelect = wSel.value; });
    const papSel = document.getElementById('modPapSelect');
    if (papSel) papSel.addEventListener('change', () => { mod.papSelect = +papSel.value; });

    document.getElementById('modGiveWeaponBtn')?.addEventListener('click', () => {
      mod.giveWeapon(mod.weaponSelect, mod.papSelect);
    });
    document.getElementById('modMaxAmmoBtn')?.addEventListener('click', () => mod.maxAmmo());
    document.getElementById('modUpgradeCurBtn')?.addEventListener('click', () => mod.upgradeCurrent());

    box.querySelectorAll('[data-switch-w]').forEach((btn) => {
      btn.addEventListener('click', () => {
        game.player.switchWeapon(+btn.dataset.switchW);
        mod.render();
      });
    });
    box.querySelectorAll('[data-refill-w]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = game.player.inventory[+btn.dataset.refillW];
        if (w) { game.player.refill(w); w.ammo = game.player.statsOf(w).magSize; mod.render(); }
      });
    });
    box.querySelectorAll('[data-maxpap-w]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.maxpapW;
        const w = game.player.inventory[idx];
        if (w) {
          w.pap = 3;
          w._statsKey = null;
          game.player.refill(w);
          w.ammo = game.player.statsOf(w).magSize;
          game.player.switchWeapon(idx);
          mod.render();
        }
      });
    });

    // Atouts
    document.getElementById('modGiveAllPerks')?.addEventListener('click', () => mod.giveAllPerks());
    document.getElementById('modClearPerks')?.addEventListener('click', () => mod.clearAllPerks());
    box.querySelectorAll('[data-toggle-perk]').forEach((btn) => {
      btn.addEventListener('click', () => mod.togglePerk(btn.dataset.togglePerk));
    });

    // Choix de la carte
    document.getElementById('modToggleMapBtn')?.addEventListener('click', () => {
      const next = CONFIG.map === 'gare' ? 'strasbourg' : 'gare';
      if (confirm(`Changer de carte vers ${next === 'gare' ? 'la Gare de Strasbourg' : 'la Grande Île'} ?\n(La page va se recharger)`)) {
        setMap(next);
      }
    });

    // Téléportation
    document.getElementById('modEmergencyUnstick')?.addEventListener('click', () => mod.emergencyUnstick());
    const zSel = document.getElementById('modZoneSelect');
    if (zSel) zSel.addEventListener('change', () => { mod.zoneSelect = +zSel.value; });
    document.getElementById('modTeleportZoneBtn')?.addEventListener('click', () => {
      mod.teleportToZone(mod.zoneSelect);
    });
    box.querySelectorAll('[data-tp-zone]').forEach((btn) => {
      btn.addEventListener('click', () => mod.teleportToZone(+btn.dataset.tpZone));
    });
    box.querySelectorAll('[data-tp-poi]').forEach((btn) => {
      btn.addEventListener('click', () => mod.teleportToPoi(btn.dataset.tpPoi));
    });

    // Multijoueur
    document.getElementById('modBringAllBtn')?.addEventListener('click', () => mod.teleportAllToMe());
    box.querySelectorAll('[data-tp-to-player]').forEach((btn) => {
      btn.addEventListener('click', () => mod.teleportHostTo(+btn.dataset.tpToPlayer));
    });
    box.querySelectorAll('[data-bring-player]').forEach((btn) => {
      btn.addEventListener('click', () => mod.teleportToHost(+btn.dataset.bringPlayer));
    });
    box.querySelectorAll('[data-revive-player]').forEach((btn) => {
      btn.addEventListener('click', () => mod.reviveRemote(+btn.dataset.revivePlayer));
    });

    // Musique & Ambiance
    document.getElementById('modMusicNext')?.addEventListener('click', () => {
      sfx.init();
      sfx.nextTrack();
      mod.render();
    });
    document.getElementById('modMusicPrev')?.addEventListener('click', () => {
      sfx.init();
      sfx.prevTrack();
      mod.render();
    });
    document.getElementById('modMusicRestart')?.addEventListener('click', () => {
      sfx.init();
      sfx.selectTrack(sfx.getCurrentTrack().index);
      mod.render();
    });
    document.getElementById('modPlayJeaux')?.addEventListener('click', () => {
      sfx.init();
      sfx.playTrackNamed('jeaux');
      mod.render();
    });
    document.getElementById('modPlayMidnight')?.addEventListener('click', () => {
      sfx.init();
      sfx.playTrackNamed('midnight');
      mod.render();
    });
    document.getElementById('modPlaySynth')?.addEventListener('click', () => {
      sfx.init();
      sfx.playTrackNamed('rock');
      mod.render();
    });

    const setModVol = (v) => {
      sfx.init();
      sfx.setMusicVolume(v);
      if (game.settings) {
        game.settings.music = v;
        game.saveSettings();
      }
      const opt = document.getElementById('optMusic');
      if (opt) {
        opt.value = v;
        if (opt.nextElementSibling) opt.nextElementSibling.textContent = `${Math.round(v * 100)}%`;
      }
      mod.render();
    };
    document.getElementById('modVol25')?.addEventListener('click', () => setModVol(0.25));
    document.getElementById('modVol50')?.addEventListener('click', () => setModVol(0.5));
    document.getElementById('modVol75')?.addEventListener('click', () => setModVol(0.75));
    document.getElementById('modVol100')?.addEventListener('click', () => setModVol(1.0));

    // Monde & Zombies
    document.getElementById('modOpenAllDoorsBtn')?.addEventListener('click', () => mod.openAllDoors());
    document.getElementById('modKillZombiesBtn')?.addEventListener('click', () => mod.killAllZombies());
    document.getElementById('modUnstickZombiesBtn')?.addEventListener('click', () => mod.unstickZombies());
    document.getElementById('modPrevRoundBtn')?.addEventListener('click', () => mod.prevRound());
    document.getElementById('modNextRoundBtn')?.addEventListener('click', () => mod.nextRound());
    document.getElementById('modSetRoundBtn')?.addEventListener('click', () => {
      const val = +(document.getElementById('modTargetRoundInput')?.value || 1);
      mod.setRound(val);
    });
    box.querySelectorAll('[data-spawn-pu]').forEach((btn) => {
      btn.addEventListener('click', () => mod.spawnPowerup(btn.dataset.spawnPu));
    });
  }

  // ------------------------------------------------------------------ Clavier F9 / Échap
  window.addEventListener('keydown', (e) => {
    if (game.chat?.open) return;
    if (e.code === 'F9') {
      e.preventDefault();
      if (!e.repeat) {
        if (!isHostOrSolo()) {
          hud?.popup?.("Menu Mods réservé à l'hôte", 'warning');
          return;
        }
        mod.toggle();
      }
      return;
    }
    if (!mod.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      mod.close();
    }
  });

  return mod;
}
