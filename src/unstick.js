// Se débloquer (v0.33.0) : si le joueur est coincé (touche de déplacement maintenue depuis stuckAfter s sans avancer de moveMin m, ou position
// dans une poche fermée / un obstacle depuis trapAfter s), l'invite « [K] Maintenir 2 s : se débloquer » apparaît. Maintenir K holdTime s
// déplace le joueur sur la case libre la plus proche de la composante principale de la grille de navigation, dans une zone OUVERTE et à moins
// de maxDist m ; sinon au centre de sa zone. Recharge `cooldown` s ; impossible en moto, à terre, à l'étage ; la position est consignée
// (console, journal du menu debug, `game.unstick.log`). Les composantes connexes viennent de NavGrid.components().
import { CONFIG } from './config.js';

export function installUnstick(game, { world, hud, sfx }) {
  const U = CONFIG.unstick;
  const st = {
    t: 0, ref: { x: 0, z: 0 },   // temps de touche maintenue sans progrès, point de référence
    trapT: 0, trapCheck: 0,      // temps passé dans une poche, prochaine vérification
    stuck: false, holdT: 0, cool: 0,
    log: [],
  };
  game.unstick = st;

  const nav = () => world.nav;

  // Étiquette de la case de (x, z) : composante de la case libre la plus proche (à moins de 1 m), 0 = aucune
  st.labelAt = (x, z) => {
    const n = nav(); if (!n) return -1;
    const { labels } = n.components();
    const ix = n.cx(x), iz = n.cz(z), R = Math.ceil(1 / n.cell);
    let best = 0, bd = Infinity;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (!n.inside(jx, jz)) continue;
      const l = labels[n.idx(jx, jz)];
      if (!l) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  };
  // Composante principale : celle de la case de départ
  st.main = () => {
    const n = nav(); if (!n) return 0;
    const { labels, sizes } = n.components();
    const s = world.startPos, l = labels[n.idx(n.cx(s.x), n.cz(s.z))];
    if (l) return l;
    let best = 1; for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i; // départ bloqué (ne devrait pas arriver) : la plus grande
    return best;
  };

  // Case d'arrivée : libre, de la composante principale, zone ouverte, sans poussée de collision, la plus proche à moins de maxDist m
  st.findSpot = (x, z) => {
    const n = nav(); if (!n) return null;
    const { labels } = n.components(), main = st.main();
    const ix0 = n.cx(x), iz0 = n.cz(z), maxR = Math.ceil(U.maxDist / n.cell);
    const q = { x: 0, y: 0, z: 0 };
    for (let r = 0; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix0 + dx, jz = iz0 + dz;
        if (!n.inside(jx, jz) || labels[n.idx(jx, jz)] !== main) continue;
        const wx = n.worldX(jx), wz = n.worldZ(jz), d = Math.hypot(wx - x, wz - z);
        if (d > U.maxDist || d >= bd) continue;
        const zi = world.zoneOf(wx, wz);
        if (zi < 0 || !world.isZoneOpen(zi)) continue;
        q.x = wx; q.y = 0; q.z = wz; world.collide(q, CONFIG.player.radius);
        if (Math.hypot(q.x - wx, q.z - wz) > 0.05) continue;
        bd = d; best = { x: wx, z: wz, d };
      }
      if (best) return best;
    }
    // rien d'accessible à moins de maxDist m : centre de la zone (si elle est ouverte), sinon de la zone ouverte la plus proche
    const zi = world.zoneOf(x, z);
    let zc = zi >= 0 && world.isZoneOpen(zi) ? world.zoneCenters?.[zi] : null;
    if (!zc) {
      let bd = Infinity;
      (world.zoneCenters || []).forEach((c, i) => { if (c && world.isZoneOpen(i)) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; zc = c; } } });
    }
    return zc ? { x: zc.x, z: zc.z, d: Math.hypot(zc.x - x, zc.z - z), center: true } : null;
  };

  st.trigger = () => {
    const p = game.player;
    if (st.cool > 0 || p.vehicle || p.downed || p.dead || p.region) return false;
    const spot = st.findSpot(p.pos.x, p.pos.z);
    if (!spot) return false;
    const from = { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) };
    p.pos.set(spot.x, 0, spot.z); p.vel.set(0, 0, 0); p.vy = 0; p.wasGrounded = true;
    st.cool = U.cooldown; st.stuck = false; st.t = 0; st.trapT = 0; st.holdT = 0;
    st.ref.x = spot.x; st.ref.z = spot.z;
    const line = `${game.time.toFixed(0)} s : débloqué de (${from.x} ; ${from.z}) vers (${spot.x.toFixed(1)} ; ${spot.z.toFixed(1)}), ${spot.d.toFixed(1)} m${spot.center ? ' (centre de zone)' : ''}`;
    st.log.push(line); if (st.log.length > 50) st.log.shift();
    console.info('[UNSTICK]', line);
    game.debugMenu?.say?.(line);
    game.sendPlayerState?.();
    hud.announce('DÉBLOQUÉ', `Déplacé de ${spot.d.toFixed(0)} m`, 2200);
    sfx.vault?.();
    return true;
  };

  // Appelé à chaque image (joueur local)
  st.update = (dt) => {
    const p = game.player, K = p.keys;
    st.cool = Math.max(0, st.cool - dt);
    const ok = game.started && game.playing && !game.over && !p.vehicle && !p.downed && !p.dead && !p.vault && !p.region;
    if (!ok) { st.t = 0; st.trapT = 0; st.stuck = false; st.holdT = 0; return; }
    const held = game.binds.anyMove(K);
    if (!held || Math.hypot(p.pos.x - st.ref.x, p.pos.z - st.ref.z) >= U.moveMin) { st.t = 0; st.ref.x = p.pos.x; st.ref.z = p.pos.z; }
    else st.t += dt;
    // poche fermée : vérifiée 2 fois par seconde (étiquette de la composante, calculée une fois par ouverture de porte)
    st.trapCheck -= dt;
    if (st.trapCheck <= 0) {
      st.trapCheck = 0.5;
      const main = st.main(), l = st.labelAt(p.pos.x, p.pos.z), n = nav();
      // seules les petites poches comptent : l'intérieur de la cathédrale, par exemple, forme de grandes composantes séparées de la ville
      const small = l !== main && (l === 0 || n.components().sizes[l] * n.cell * n.cell < U.pocketMaxArea);
      st.trapT = small ? st.trapT + 0.5 : 0;
    }
    const wasStuck = st.stuck;
    st.stuck = st.t >= U.stuckAfter || st.trapT >= U.trapAfter;
    if (st.stuck && !wasStuck) console.info('[UNSTICK] joueur coincé en', p.pos.x.toFixed(1), p.pos.z.toFixed(1), st.t >= U.stuckAfter ? '(touche maintenue sans avancer)' : '(poche fermée)');
    if (st.stuck && game.binds.down('unstick', K)) {
      st.holdT += dt;
      if (st.holdT >= U.holdTime) { if (!st.trigger()) st.holdT = 0; }
    } else st.holdT = 0;
  };

  // Invite à afficher (ou null)
  st.prompt = () => {
    if (!st.stuck) return null;
    if (st.cool > 0) return `Déblocage disponible dans ${Math.ceil(st.cool)} s`;
    if (st.holdT > 0) return `${game.binds.tag('unstick')} Maintenir pour se débloquer (${Math.max(0, U.holdTime - st.holdT).toFixed(1)} s)`;
    return `${game.binds.tag('unstick')} Maintenir ${U.holdTime} s : se débloquer`;
  };
  return st;
}
