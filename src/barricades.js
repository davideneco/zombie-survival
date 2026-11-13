import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { patchMaterial } from './terrain.js';

// =====================================================================
//  Barricades (step D). Boarded openings of the key buildings: every ground-floor window ("window" kind, created by keyBuildings.js with its
//  collision and nav cells) holds `n` of `max` planks.
//   - a zombie within reach of a boarded barricade, facing it, stops and tears a plank every tear time (host only: zombies are simulated there);
//   - a player holds F to nail one plank back every repair.time s: +points each, at most capPerRound per round;
//   - while planks remain the opening is a wall for bodies and a cell of cost navCost (value 3) in the flow field; at n = 0 it becomes a vaultable
//     sill (cells 2, collision box h = sill) ; a repair from 0 closes it again;
//   - the host is authoritative: `bar_fix {id}` (client -> host, one per plank), `bar {s: [id, n, by, k, ...]}` (host -> all, batched every
//     CONFIG.barricades.sync s: k planks added by player `by`, who then adds their own points), `bars` in the join snapshot. Debris and sounds are local.
//  Presentation: one InstancedMesh for the window frames and one for the planks (a plank is hidden by a zero-scale matrix), ~2 draw calls.
// =====================================================================
// Beam with chamfered long edges (no bare box): cross-section w x h with corners cut by c, extruded `len` along z, centred
function beam(w, h, len, c) {
  const x = w / 2, y = h / 2, sh = new THREE.Shape();
  sh.moveTo(-x + c, -y); sh.lineTo(x - c, -y); sh.lineTo(x, -y + c); sh.lineTo(x, y - c); sh.lineTo(x - c, y); sh.lineTo(-x + c, y); sh.lineTo(-x, y - c); sh.lineTo(-x, -y + c); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -len / 2);
  return g;
}
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function installBarricades(game, { scene, world, hud, sfx }) {
  const B = () => CONFIG.barricades;
  const bars = world.barricades || [];
  const api = { bars, earned: 0, earnedRound: -1, repairT: 0, target: null };
  world.barApi = api;
  game.barricades = api;

  // ------------------------------------------------------------- presentation
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.86, metalness: 0.02 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8, metalness: 0.02 });
  patchMaterial(wood); patchMaterial(frameMat);
  const W = B().windows, PL = B().planks.window, SP = (W.top - W.sill - 0.3) / (PL - 1);
  const frameGeo = (() => {
    const parts = [];
    const box = (w, h, d, x, y, z) => { const g = beam(w, d, h, 0.02); g.rotateX(-Math.PI / 2); g.translate(x, y, z); parts.push(g); }; // (w across, h tall, d deep)
    box(W.width + 0.5, 0.08, 0.34, 0, W.sill - 0.02, 0.1);           // sill, sticking out
    box(0.11, W.top - W.sill, 0.2, -(W.width / 2 + 0.03), (W.sill + W.top) / 2, 0.06); // jambs
    box(0.11, W.top - W.sill, 0.2, W.width / 2 + 0.03, (W.sill + W.top) / 2, 0.06);
    box(W.width + 0.3, 0.1, 0.2, 0, W.top + 0.03, 0.06);              // header
    return mergeGeometries(parts.map((q) => { const n = q.index ? q.toNonIndexed() : q; if (n !== q) q.dispose(); return n; }));
  })();
  const plankGeo = beam(0.05, 0.2, 1, 0.012); plankGeo.rotateY(Math.PI / 2); // along x, unit length
  const CAP = 1024; // plank instances (windows now ; doors and deployed barricades later)
  const planks = new THREE.InstancedMesh(plankGeo, wood, CAP);
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, Math.max(1, bars.length + 16));
  for (const m of [planks, frames]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.name = 'barricades'; m.userData.lod = true; scene.add(m); }
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P3 = new THREE.Vector3(), S3 = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), AX = new THREE.Vector3(0, 1, 0);
  let nPlanks = 0, nFrames = 0;
  const place = (b) => { // plank instances + frame of a barricade
    b.base = nPlanks; nPlanks += b.max;
    b.fi = nFrames++;
    Q.setFromAxisAngle(AX, b.yaw); P3.set(b.x, 0, b.z); S3.set(1, 1, 1);
    frames.setMatrixAt(b.fi, M4.compose(P3, Q, S3));
    frames.count = nFrames; frames.instanceMatrix.needsUpdate = true;
    paint(b);
  };
  const paint = (b) => { // set the plank matrices of b from b.n
    for (let k = 0; k < b.max; k++) {
      if (k >= b.n) { planks.setMatrixAt(b.base + k, ZERO); continue; }
      const h = hash(b.id * 7.3 + k, k * 1.7), h2 = hash(k * 3.1, b.id * 1.3);
      const lx = (h - 0.5) * 0.12, y = W.sill + 0.15 + k * SP, rz = (h2 - 0.5) * 0.09 + (k % 2 ? 0.03 : -0.03);
      // local frame: x along the window, z outward ; world = rotation about Y by yaw
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), zo = 0.13 + k * 0.003;
      P3.set(b.x + c * lx + s * zo, y, b.z - s * lx + c * zo);
      E.set(0, b.yaw, rz, 'YXZ'); Q.setFromEuler(E);
      S3.set(W.width + 0.28 + h * 0.1, 0.9 + h2 * 0.2, 1);
      planks.setMatrixAt(b.base + k, M4.compose(P3, Q, S3));
    }
    planks.count = nPlanks; planks.instanceMatrix.needsUpdate = true;
  };
  for (const b of bars) place(b);

  // flying plank debris (local only): a few meshes reused, same material program as the instanced planks
  const debris = [];
  const dGeo = beam(0.05, 0.16, 1.2, 0.01); dGeo.rotateY(Math.PI / 2);
  for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(dGeo, wood); m.visible = false; m.frustumCulled = false; scene.add(m); debris.push({ m, t: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0 }); }
  let dNext = 0;
  const throwPlank = (b, dir) => {
    const d = debris[dNext++ % debris.length], s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    d.t = 1.4; d.m.visible = true;
    d.m.position.set(b.x + s * 0.4, W.sill + 0.9, b.z + c * 0.4);
    const sp = 2.2 + Math.random() * 1.6;
    d.vx = s * dir * sp + (Math.random() - 0.5); d.vz = c * dir * sp + (Math.random() - 0.5); d.vy = 2 + Math.random() * 1.5;
    d.rx = (Math.random() - 0.5) * 9; d.rz = (Math.random() - 0.5) * 9;
    d.m.rotation.set(0, b.yaw, 0);
  };

  // ------------------------------------------------------------- state (collision + nav follow the plank count)
  const grid = new Map(); // 4 m cells -> barricades
  const gk = (ix, iz) => ix * 4096 + iz;
  for (const b of bars) { const k = gk(Math.floor(b.x / 4), Math.floor(b.z / 4)); (grid.get(k) || grid.set(k, []).get(k)).push(b); }
  const applyState = (b) => {
    const open = b.n <= 0 && !b.perm;
    if (b.kind === 'window') {
      b.board.off = open;
      for (const s of b.vault) s.off = !open;
      if (b.nav) { for (const c of b.cells) if (c.torn !== 1) b.nav.blocked[c.idx] = b.perm ? 1 : open ? c.torn : 3; b.nav.invalidate(); }
    }
  };
  api.apply = applyState;
  const dirty = new Map(); // id -> [id, n, by, k]
  let syncT = 0;
  const setN = (b, n, by = -1, added = 0) => { // host / solo: the authoritative change
    const old = b.n;
    b.n = Math.max(0, Math.min(b.max, n));
    if (b.n === old) return;
    paint(b); applyState(b);
    if (b.n < old) throwPlank(b, b.tearFrom || 1);
    if (game.isMultiplayer && !game.isClient) {
      let e = dirty.get(b.id);
      if (e && e[2] !== by && e[3] > 0) { game.net?.send({ t: 'bar', s: [e[0], e[1], e[2], e[3]] }); dirty.delete(b.id); e = null; } // another repairer: send the previous one's count first
      if (!e) dirty.set(b.id, e = [b.id, b.n, by, 0]);
      e[1] = b.n; e[2] = by; e[3] += added;
    }
  };
  // client: the host's value
  const remoteN = (id, n, by, k) => {
    const b = bars[id]; if (!b) return;
    const old = b.n;
    b.n = Math.max(0, Math.min(b.max, n));
    if (b.n !== old) { paint(b); applyState(b); if (b.n < old) { b.tearFrom = 1; throwPlank(b, 1); sfx.knock?.(volumeAt(b)); } }
    if (k > 0 && game.net && by === game.net.id) award(k);
  };
  const volumeAt = (b) => Math.max(0, 1 - Math.hypot(b.x - game.player.pos.x, b.z - game.player.pos.z) / 45);

  // ------------------------------------------------------------- zombies (host / solo)
  const tearTime = () => Math.max(B().tear.min, B().tear.base - B().tear.perRound * (game.round || 0));
  const tearers = (b) => { let c = 0; if (b.tearSet) for (const z of b.tearSet) { if (z.dead || z.tearing?.b !== b) b.tearSet.delete(z); else c++; } return c; };
  // A zombie update calls this each frame: true while it is busy tearing a barricade (it then does nothing else)
  api.tear = (z, dt) => {
    const T = z.tearing;
    if (T) {
      const b = T.b;
      if (b.n <= 0 || b.perm || z.dead) { z.tearing = null; return false; }
      z.tearT = (z.tearT || 0) + dt;
      if (z.tearT >= tearTime()) {
        z.tearT = 0;
        b.tearFrom = (z.pos.x - b.x) * b.nx + (z.pos.z - b.z) * b.nz > 0 ? 1 : -1; // debris flies away from the zombie's side
        setN(b, b.n - 1, -1, 0);
        sfx.knock?.(volumeAt(b));
        if (b.n <= 0) z.tearing = null;
      }
      return true;
    }
    z._barT = (z._barT ?? Math.random() * 0.2) - dt;
    if (z._barT > 0) return false;
    z._barT = 0.2 + Math.random() * 0.1;
    const R = B().tear.reach, ix = Math.floor(z.pos.x / 4), iz = Math.floor(z.pos.z / 4), hx = Math.sin(z.yaw), hz = Math.cos(z.yaw);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const arr = grid.get(gk(ix + a, iz + c));
      if (!arr) continue;
      for (const b of arr) {
        if (b.n <= 0 || b.perm || b.kind !== 'window') continue;
        const dx = z.pos.x - b.x, dz = z.pos.z - b.z, along = dx * b.ux + dz * b.uz, across = dx * b.nx + dz * b.nz;
        if (Math.abs(along) > b.w / 2 + 0.4 || Math.abs(across) > R) continue;
        if ((-dx * hx - dz * hz) < 0.2 * Math.hypot(dx, dz)) continue; // not heading for it
        if (tearers(b) >= B().tear.maxPerBarricade) continue;
        (b.tearSet || (b.tearSet = new Set())).add(z);
        z.tearing = { b }; z.tearT = 0;
        return true;
      }
    }
    return false;
  };

  // ------------------------------------------------------------- players: hold F to repair
  api.nearest = (px, pz, reach = B().repair.reach) => {
    let best = null, bd = reach;
    const ix = Math.floor(px / 4), iz = Math.floor(pz / 4);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const arr = grid.get(gk(ix + a, iz + c));
      if (!arr) continue;
      for (const b of arr) {
        if (b.perm) continue;
        const dx = px - b.x, dz = pz - b.z, along = Math.max(0, Math.abs(dx * b.ux + dz * b.uz) - b.w / 2), across = dx * b.nx + dz * b.nz, d = Math.hypot(along, across);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  };
  const capLeft = () => { if (api.earnedRound !== game.round) { api.earnedRound = game.round; api.earned = 0; } return Math.max(0, B().repair.capPerRound - api.earned); };
  const award = (k) => {
    const pts = Math.min(k * B().repair.points, capLeft());
    if (pts > 0) { game.addPoints(pts, 'bonus'); api.earned += pts; }
  };
  api.capReached = () => capLeft() <= 0;
  // `game.repairBarricade(id)`: one plank (what a completed hold does) ; returns the points earned (host / solo) or -1 when sent to the host
  api.repair = (b) => {
    if (!b || b.perm || b.n >= b.max) return 0;
    if (game.isClient) { game.net?.send({ t: 'bar_fix', id: b.id }); return -1; }
    const before = capLeft();
    setN(b, b.n + 1, game.net?.id ?? 0, 1);
    sfx.knock?.(1);
    award(1);
    return Math.min(B().repair.points, before);
  };
  game.repairBarricade = (id) => api.repair(bars[id]);
  // per frame, from the prompt chain: `active` is true while the player holds F in front of a barricade nothing else claims
  api.hold = (dt, active) => {
    const R = B().repair, t = R.time * (game.player.perks?.speedcola ? R.speedColaMult : 1);
    if (!active) { api.repairT = 0; return; }
    api.repairT += dt;
    if (api.repairT >= t) { api.repairT = 0; api.repair(api.target); }
  };

  // ------------------------------------------------------------- network
  api.flush = (dt) => {
    for (const d of debris) if (d.t > 0) {
      d.t -= dt; d.vy -= 14 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y = Math.max(0.05, d.m.position.y + d.vy * dt); d.m.position.z += d.vz * dt;
      d.m.rotation.x += d.rx * dt; d.m.rotation.z += d.rz * dt;
      if (d.m.position.y <= 0.06) { d.vx *= 0.8; d.vz *= 0.8; d.rx = d.rz = 0; }
      if (d.t <= 0) d.m.visible = false;
    }
    if (!dirty.size) { syncT = 0; return; }
    syncT += dt;
    if (syncT < B().sync) return;
    syncT = 0;
    const s = [];
    for (const e of dirty.values()) s.push(e[0], e[1], e[2], e[3]);
    dirty.clear();
    game.net?.send({ t: 'bar', s });
  };
  api.snapshot = () => bars.filter((b) => b.n !== b.max).map((b) => [b.id, b.n]);
  api.restore = (list) => { for (const [id, n] of list || []) { const b = bars[id]; if (b) { b.n = n; paint(b); applyState(b); } } };
  game.onBarricadeNet = (net) => {
    net.on('bar_fix', (m) => { // host: a client nails a plank
      if (game.isClient) return;
      const b = bars[m.id], rp = game.remotes.get(m.from);
      if (!b || b.perm || b.n >= b.max || !rp) return;
      if (Math.hypot(rp.pos.x - b.x, rp.pos.z - b.z) > B().repair.reach + 3) return;
      setN(b, b.n + 1, m.from, 1);
    });
    net.onHost('bar', (m) => { // clients: the host's plank counts
      const s = m.s || [];
      for (let i = 0; i + 3 < s.length; i += 4) remoteN(s[i], s[i + 1], s[i + 2], s[i + 3]);
    });
  };
  return api;
}
