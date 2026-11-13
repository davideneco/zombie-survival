import { CONFIG } from '../config.js';

// =====================================================================
//  The bridge to Krutenau (step B, chunk 2). Once the gate door is bought (a normal door: `door_open` message, same price rule as the others), standing at
//  the gate on the island and pressing [interact] walks the local player to the district's arrival point; the return point in the district leads back.
//  The crossing itself is local (the player position is broadcast as usual). What is shared is the zombies: the host relocates the zombies of the area a
//  player leaves when nobody is left in it (like the tram transfer): `br_x {fa, to, x, z}` (client -> host, handled in main.js), `z_reloc` (host -> all, existing message).
// =====================================================================
export function installBridge(game, { world, hud, sfx }) {
  const kr = world.kr;
  if (!kr) return;
  const D = CONFIG.districts.krutenau, R2 = D.portalRadius, bridges = kr.bridges;
  // the interaction points: a bridge's gate (island side, only once ITS door is open) and its return point in the district
  const nearBridge = () => {
    const P = game.player;
    if (P.vehicle || P.downed || P.dead || P.onTram || game.xfRide) return null;
    const a = world.logicAreaOf(P.pos.x, P.pos.z);
    for (const b of bridges) {
      if (!b.door.open) continue;
      if (a === 'krutenau' && Math.hypot(P.pos.x - b.ret.x, P.pos.z - b.ret.z) < R2) return { to: 'island', x: b.gate.x, z: b.gate.z, yaw: b.gate.yaw - Math.PI / 2 };
      if (a === 'island' && Math.hypot(P.pos.x - b.gate.x, P.pos.z - b.gate.z) < R2 + 0.8) return { to: 'krutenau', x: b.entry.x, z: b.entry.z, yaw: b.entry.yaw };
    }
    return null;
  };

  // host: nobody is left in the area the player just left -> its zombies follow, relocated near the arrival (with the floor region of the destination)
  function hostFollow(fromArea, toArea, x, z, except) { // except: the player who just crossed (their stored position may be stale)
    if (game.isClient) return;
    const players = [game.player, ...game.remotes.values()];
    if (players.some((pl) => pl !== except && !pl.dead && world.logicAreaOf(pl.pos.x, pl.pos.z) === fromArea)) return;
    const reg = world.regionAt(x, z);
    for (const zb of game.zombies) {
      if (zb.dead || zb.isBoss || zb.onTrain || world.logicAreaOf(zb.pos.x, zb.pos.z) !== fromArea) continue;
      const g = world.pickGround(x, z, 14, 40, true);
      if (!g) continue;
      zb.startSpawn({ type: 'ground', pos: g }); zb.region = reg; zb.link = null;
      game.net?.send({ t: 'z_reloc', id: zb.id, x: g.x, z: g.z, region: reg });
    }
  }

  Object.assign(game, {
    nearBridge,
    bridgePrompt() { const b = nearBridge(); return b ? `${game.binds.tag('interact')} ${b.to === 'krutenau' ? 'Traverser le pont vers Krutenau' : 'Retourner sur la Grande Île'}` : ''; },
    useBridge() {
      const b = nearBridge(); if (!b) return;
      const P = game.player;
      const from = world.logicAreaOf(P.pos.x, P.pos.z);
      P.pos.set(b.x, world.terrainY(b.x, b.z), b.z); P.vel.set(0, 0, 0); P.vy = 0; P.yaw = b.yaw; P.pitch = 0;
      world.collide(P.pos, CONFIG.player.radius);
      sfx.buy?.();
      hud.announce(b.to === 'krutenau' ? 'KRUTENAU' : 'GRANDE ÎLE', b.to === 'krutenau' ? 'Rive est de l\'Ill' : 'De retour sur l\'île', 2500);
      game.sendPlayerState?.();
      game.tiles?.focus(b.x, b.z).then(() => game.tiles?.focus(null)); // the facades of the arrival are built NOW (not over the next frames: a slow frame rate would leave the view empty)
      if (game.isClient) game.net?.send({ t: 'br_x', fa: from, to: b.to, x: b.x, z: b.z });
      else hostFollow(from, b.to, b.x, b.z, P);
    },
    hostBridgeFollow: hostFollow,
  });
}
