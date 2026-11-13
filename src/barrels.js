import * as THREE from 'three';
import { CONFIG } from './config.js';
import { patchMaterial } from './terrain.js';

// =====================================================================
//  Explosive barrels (step D): CONFIG.barrels.perKeyBuilding red barrels next to the windows of every key building. A barrel is a solid collision
//  circle (not vaultable: zombies path around it), one shot sets it off: blast of `radius` m (zombies: `damage`, players: `playerDamage`, both falling off
//  with distance, through game.explode), barrels in range follow `chainDelay` s later. They are back at every round.
//  Host authoritative: a client sends `brl_hit {id}`, the host explodes and tells everybody `brl_boom {id, o}` (the join snapshot lists the dead ones).
//  Presentation: two InstancedMeshes (lathe body, emissive hazard band), a hidden barrel is a zero-scale matrix.
// =====================================================================
export function installBarrels(game, { scene, world, sfx }) {
  const C = () => CONFIG.barrels;
  const coll = world.collision, nav = world.nav, list = [];
  const api = { list };
  game.barrels = api;

  // ------------------------------------------------------------- placement (after the world is final: collision grid and nav are built)
  const probe = { x: 0, y: 0.1, z: 0 }, out = { kind: null, push: 0, nx: 0, nz: 0 };
  const free = (x, z) => {
    if (nav.isBlockedAt(x, z)) return false;
    probe.x = x; probe.z = z; probe.y = 0.1; out.push = 0;
    world.collide(probe, C().r + 0.3, out);
    if (out.push > 0.02) return false;
    for (const d of world.doors || []) for (const pt of d.points.length ? d.points : d.hit || []) if (Math.hypot(pt.x - x, pt.z - z) < 2.2) return false;
    return !list.some((b) => Math.hypot(b.x - x, b.z - z) < 1.5);
  };
  for (const kb of world.keyBuildings || []) {
    if (kb.demoted) continue;
    let n = 0;
    for (const w of kb.windows || []) {
      if (w.kind !== 'window' || n >= C().perKeyBuilding) continue;
      for (const [a, d] of [[1.6, 1.5], [-1.6, 1.5], [2.4, 1.9], [-2.4, 1.9], [0, 2.2], [3.2, 1.5], [-3.2, 1.5], [3.2, 2.4], [-3.2, 2.4], [1.6, 2.6], [-1.6, 2.6], [4, 1.5], [-4, 1.5]]) {
        const x = w.x + w.ux * a + w.nx * d, z = w.z + w.uz * a + w.nz * d;
        if (!free(x, z)) continue;
        const b = { id: list.length, x, z, alive: true, kb: kb.id, circle: coll.addCircle(x, z, C().r, C().h, -Infinity, 'prop', false), cells: [], idx: list.length };
        coll._insert(b.circle, x - C().r, z - C().r, x + C().r, z + C().r);
        const rr = C().r + nav.margin;
        for (let iz = Math.max(0, nav.cz(z - rr)); iz <= Math.min(nav.nz - 1, nav.cz(z + rr)); iz++) for (let ix = Math.max(0, nav.cx(x - rr)); ix <= Math.min(nav.nx - 1, nav.cx(x + rr)); ix++) {
          const i = nav.idx(ix, iz);
          if (nav.blocked[i] === 0 && (nav.worldX(ix) - x) ** 2 + (nav.worldZ(iz) - z) ** 2 < rr * rr) { nav.blocked[i] = 1; b.cells.push(i); }
        }
        list.push(b); n++;
        break;
      }
    }
  }
  nav.invalidate();

  // ------------------------------------------------------------- presentation
  const R = C().r, H = C().h;
  const prof = [[0, 0], [R * 0.86, 0], [R * 0.95, 0.03], [R, 0.09], [R * 1.03, 0.14], [R, 0.19], [R, 0.45], [R * 1.03, 0.5], [R, 0.55], [R, 0.78], [R * 1.03, 0.83], [R, 0.88], [R * 0.95, H - 0.03], [R * 0.86, H], [R * 0.7, H + 0.015], [R * 0.7, H - 0.02], [0, H - 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(prof, 10);
  const bandGeo = new THREE.LatheGeometry([[R * 1.015, 0.52], [R * 1.015, 0.76]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a1f16, roughness: 0.55, metalness: 0.4 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2a2200, emissive: 0xffb000, emissiveIntensity: 0.7, roughness: 0.6 });
  patchMaterial(bodyMat); patchMaterial(bandMat);
  const body = new THREE.InstancedMesh(bodyGeo, bodyMat, Math.max(1, list.length)), band = new THREE.InstancedMesh(bandGeo, bandMat, Math.max(1, list.length));
  const M4 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const m of [body, band]) { m.name = 'barrels'; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.userData.lod = true; m.count = list.length; scene.add(m); }
  const paint = (b) => { const m = b.alive ? M4.makeTranslation(b.x, 0, b.z) : ZERO; body.setMatrixAt(b.idx, m); band.setMatrixAt(b.idx, m); body.instanceMatrix.needsUpdate = band.instanceMatrix.needsUpdate = true; };
  list.forEach(paint);

  // ------------------------------------------------------------- state
  const setAlive = (b, alive) => {
    b.alive = alive; b.circle.off = !alive;
    for (const i of b.cells) nav.blocked[i] = alive ? 1 : 0;
    nav.invalidate(); paint(b);
  };
  const timers = []; // chain reaction: { b, t, owner }
  const blast = (b, owner) => { // effects + damage (everybody runs the effects, the host the damage: game.explode)
    const K = C(), y = world.terrainY(b.x, b.z) + 0.5;
    game.explode({ x: b.x, y, z: b.z }, K.radius, K.damage, owner, 0xff7a2a, K.playerDamage);
  };
  api.explode = (b, owner = null) => { // host / solo
    if (!b || !b.alive) return;
    setAlive(b, false);
    blast(b, owner);
    if (game.isMultiplayer && !game.isClient) game.net?.send({ t: 'brl_boom', id: b.id, o: owner });
    if (C().chain) for (const o of list) if (o.alive && Math.hypot(o.x - b.x, o.z - b.z) < C().radius && !timers.some((t) => t.b === o)) timers.push({ b: o, t: C().chainDelay, owner });
  };
  api.reset = () => { for (const b of list) if (!b.alive) setAlive(b, true); timers.length = 0; };
  api.flush = (dt) => {
    for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) { const { b, owner } = timers[i]; timers.splice(i, 1); api.explode(b, owner); }
  };
  api.snapshot = () => list.filter((b) => !b.alive).map((b) => b.id);
  api.restore = (ids) => { for (const id of ids || []) { const b = list[id]; if (b && b.alive) setAlive(b, false); } };

  // A bullet along (ro, rd) that travelled `maxT` before something solid : did it hit a barrel ? (the barrel itself is solid for rayHit, so maxT ends on it)
  const hz = Math.hypot;
  game.shootBarrels = (ro, rd, maxT) => {
    const h2 = hz(rd.x, rd.z);
    if (h2 < 1e-6) return;
    const ux = rd.x / h2, uz = rd.z / h2;
    let best = null, bt = Infinity;
    for (const b of list) {
      if (!b.alive) continue;
      const fx = b.x - ro.x, fz = b.z - ro.z, proj = fx * ux + fz * uz;
      if (proj < 0 || proj > (maxT + 0.3) * h2 + R) continue;
      const d2 = fx * fx + fz * fz - proj * proj;
      if (d2 > R * R) continue;
      const t2 = proj - Math.sqrt(R * R - d2), y = ro.y + (rd.y / h2) * t2 - world.terrainY(b.x, b.z);
      if (y < -0.1 || y > H + 0.1 || t2 >= bt) continue;
      bt = t2; best = b;
    }
    if (!best) return;
    if (game.isClient) game.net?.send({ t: 'brl_hit', id: best.id });
    else api.explode(best, null);
  };
  game.onBarrelNet = (net) => {
    net.on('brl_hit', (m) => { if (!game.isClient) api.explode(list[m.id], m.from); }); // host: a client shot it
    net.onHost('brl_boom', (m) => { const b = list[m.id]; if (b && b.alive) { setAlive(b, false); blast(b, null); } }); // clients: effects (and the damage to this player)
  };
  return api;
}
