import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Zombie } from './zombie.js';
import { fx } from './fx.js';
import { groundProfile } from './railNet.js';

// =====================================================================
//  Zombies of the train ride (v0.82.0, phase 4 of docs/TRAIN_INTRO_SPEC.md) : the threat during the intro (intro.js) ; the host simulates,
//  clients render. Timeline (CONFIG.intro, events -> game.introHooks) :
//    'track'    (180-210 s, 80 km/h) : trackside zombies the train passes ; the ones standing on the track are run over by the head car
//                (thud, blood on its front, roadkillPoints) ;
//    'breach'   (202-227 s, 15 km/h past the derailed wagons) : side zombies beside the track, and breachers running alongside the train :
//                they grab a window (hang : fists on the glass, it cracks), smash it (it stays broken, wind), climb in, then walk the aisle ;
//                hanging + climbing capped at maxHanging (maxHanging4p with 4 players) ;
//    'roof'     (227-250 s) : footsteps on the roof of the last car, bangs on its rear cab door (train.tailU), the door is forced, gangway zombies come in ;
//    'trackbed' (the stop) : a few zombies climb out of the track bed onto quai 1 ; zombies still on board are released (train.js : they chase
//                players inside, or leave by an open door into the station region) ; round 1 then starts as usual (intro.js).
//  Frames : a trackside zombie is placed by its route abscissa s and lateral offset w (z.rideW) ; a zombie at / in the train lives in the
//  frame of the train (z.onTrain { v, u, w, y, st }) and its world position is recomputed from it every frame : it rides with the coach.
//  Skip : every ride zombie is removed (alive or dead), the trackbed ones still come at the stop.
//  Network (host -> all) : z_spawn + rk (kind), tn [coach, side, win], tu / tw / ty / ts (frame-local position, state) ; z_tick entries + [tu,
//  tw, ty, ryw, st, k] for zombies in the train frame ; tn_win { i, st } (window cracked / broken) ; tn_rk { id, vx, vy, vz } (roadkill) ;
//  tn_rm { ids } (removed : lost, skip) ; sync + tnWin (damage). Roof steps and the tail door follow τ on every peer (no message).
// =====================================================================

export const RIDE_ST = ['', 'run', 'hang', 'climb', 'gang', 'in', 'enter', 'leave'];
const STI = Object.fromEntries(RIDE_ST.map((s, i) => [s, i]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const r2 = (v) => Math.round(v * 100) / 100;

export function installRideZombies(game, { world, scene, sfx }) {
  const t = world.gare?.train, I = CONFIG.intro;
  game.rideZombieStep = null;
  if (!t || !I?.enabled || !game.introAvailable) return;
  const T = CONFIG.train, B = I.breach, Rf = I.roof, Wd = T.width / 2, lay = t.lay, route = t.route, tr = route.track;
  // ground beside the route : the embankment of railNet.js (groundProfile : slope, bridge decks) at the train's middle by default
  const groundAt = (w, sAt = t.s - t.L / 2) => groundProfile(w, sAt, route);
  const roofEvent = (I.events.find((e) => e.id === 'roof') || { at: 55 }).at;
  const R = { plan: [], next: 0, roof: null, hanging: 0, claims: new Map(), bedExtra: 0, removed: [] };
  const o1 = {}, o2 = {}, wo = {}, wp = { x: 0, y: 0, z: 0 }, cv = { x: 0, z: 0 };

  // ---------------------------------------------------------------- helpers
  const players = () => game.isMultiplayer ? 1 + game.remotes.size : 1;
  const scaled = (n) => Math.round(n * (1 + 0.75 * (players() - 1)));
  const cap = () => { const np = clamp(players(), 1, 4); return Math.round(B.maxHanging + ((np - 1) * (B.maxHanging4p - B.maxHanging)) / 3); };
  const frameYaw = (u) => { t.frame(u, o1); return Math.atan2(o1.tx, o1.tz); };
  const inwardYaw = (u, sd) => { t.frame(u, o1); return Math.atan2(sd * o1.tz, -sd * o1.tx); }; // facing the train axis from side sd
  const noseAt = (tau) => game.introNoseAt?.(tau) ?? t.s;
  // u (train frame) of the standing players in the train (local and teammates) ; mean, or the middle coach
  const playerUs = (out) => {
    out.length = 0;
    const p = game.player;
    if (p.onTram?.v === t && !p.downed && !p.dead) out.push(p.onTram.u);
    for (const r of game.remotes.values()) if (r.tr && r.tr.id === t.id && !r.downed && !r.dead) out.push(r.tr.u);
    return out;
  };
  const _pu = [];
  const midU = () => { playerUs(_pu); return _pu.length ? _pu.reduce((a, b) => a + b, 0) / _pu.length : t.veh[Math.min(2, t.n - 1)].uc; };
  const nearestPU = (u) => { playerUs(_pu); let best = midU(), bd = Infinity; for (const q of _pu) { const d = Math.abs(q - u); if (d < bd) { bd = d; best = q; } } return best; };
  // the zombie's sounds (same as main.js spawnZombie : volume by distance to the local player)
  const onEvent = (name, z) => {
    const v = Math.max(0, 1 - Math.hypot(z.pos.x - game.player.pos.x, z.pos.z - game.player.pos.z) / 45);
    if (name === 'knock') sfx.knock(v);
    else if (name === 'glass') { sfx.glass(v); sfx.groan(Math.min(1, v * 1.4)); }
    else if (name === 'rumble') sfx.rumble(v);
    else if (name === 'emerge') { sfx.dirt(v); sfx.groan(Math.min(1, v * 1.4)); }
  };
  const hp1 = () => game.zombieHealthAt(I.healthRound);
  const speed1 = () => Math.min(CONFIG.zombie.speedStart + I.healthRound * CONFIG.zombie.speedPerRound, CONFIG.zombie.speedMax) * (0.85 + Math.random() * 0.3);
  // velocity of the train at u (world, m/s) : effects emitted in the train keep it (fx carry)
  const trainVel = (u, out) => { t.frame(u, o2); out.x = o2.tx * t.v; out.z = o2.tz * t.v; return out; };

  // ---------------------------------------------------------------- windows
  const winOk = (i) => !t.winTable[i].raised; // (not the small windows above the fold-up seats of the raised floors)
  const pickWindow = (sd, u) => {
    let best = -1, bs = Infinity;
    const pu = nearestPU(u);
    for (let i = 0; i < t.winSt.length; i++) {
      if (R.claims.has(i) || !winOk(i)) continue;
      t.winOf(i, wo);
      if (wo.sd !== sd) continue;
      const sc = Math.abs(wo.u - pu) + 0.25 * Math.abs(wo.u - u) + Math.random() * 2;
      if (sc < bs) { bs = sc; best = i; }
    }
    return best;
  };
  const claim = (i, z) => { if (i >= 0) R.claims.set(i, z.id); };
  const release = (z) => { const O = z.onTrain; if (O && O.win >= 0 && R.claims.get(O.win) === z.id) R.claims.delete(O.win); if (O) O.win = -1; };
  // local effects of a window state change (host and clients)
  const winFx = (i, st) => {
    t.winOf(i, wo);
    const p = game.player;
    t.walkToWorld(wo.u, wo.sd * Wd, 0, wp);
    const y = t.railY + (lay.winY0 + lay.winY1) / 2 + wo.dy, v = Math.max(0, 1 - Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z) / 40);
    if (st === 1) { sfx.knock(v); sfx.glass(v * 0.25); return; }
    t.frame(wo.u, o2);
    trainVel(wo.u, cv); fx.setCarry(cv.x, cv.z);
    fx.glass(wp.x, y, wp.z, wo.sd * o2.tz, -wo.sd * o2.tx); // (the shards fly into the coach)
    fx.setCarry(0, 0);
    sfx.glass(v);
  };
  const setWin = (i, st) => {
    if (!t.setWin(i, st)) return;
    winFx(i, st);
    if (game.isHost && game.isMultiplayer) game.net?.send({ t: 'tn_win', i, st });
  };
  // landing spot inside, under window i : walkable landing spot in the aisle clear of furniture blocks
  const landing = (i, out) => {
    t.winOf(i, wo);
    const v = t.veh[wo.ci];
    let best = wo.u, bd = Infinity;
    for (const lg of v.Q.legroom) { const d = Math.abs(v.uc + lg.u - wo.u); if (d < bd) { bd = d; best = v.uc + lg.u; } }
    out.u = best;
    out.w = v.Q.kind === 'coachR2' ? (0.10 + wo.sd * 0.05) : (wo.sd * 0.15);
    return out;
  };

  // ---------------------------------------------------------------- spawns (host)
  const sendSpawn = (z, extra = {}) => {
    if (!game.isHost || !game.isMultiplayer) return;
    const O = z.onTrain;
    game.net?.send({
      t: 'z_spawn', id: z.id, st: 'ground', fin: 1, wi: -1, x: r2(z.pos.x), z: r2(z.pos.z), y: r2(z.pos.y), hp: z.health, spd: z.speed, crawl: 0, region: z.region, rk: z.ride,
      ...(O ? { tu: r2(O.u), tw: r2(O.w), ty: r2(O.y), ts: STI[O.st] } : null), ...extra,
    });
  };
  const make = (kind, x, y, z) => {
    const zb = new Zombie(scene, { type: 'ground', pos: new THREE.Vector3(x, y, z) }, hp1(), speed1(), onEvent, null, {});
    zb.skipSpawn(); zb.dropMound(); zb.pos.set(x, y, z);
    zb.region = t.walkRegion; zb.ride = kind;
    game.zombies.push(zb);
    return zb;
  };
  // a trackside zombie at route abscissa s, offset w ; it walks to `lane` (rail : it stays on the track)
  const spawnTrack = (kind, s, w, lane, rail) => {
    tr.at(s, o1);
    const z = make(kind, o1.x - o1.tz * w, groundAt(w, s), o1.z + o1.tx * w);
    z.rideW = { s, w, lane, rail };
    z.yaw = rail ? Math.atan2(-o1.tx, -o1.tz) : Math.atan2(Math.sign(w) * o1.tz, -Math.sign(w) * o1.tx);
    z.group.rotation.set(0, z.yaw, 0);
    sendSpawn(z);
    return z;
  };
  // a breacher : runs alongside on side sd, toward a free window, from behind it (back) or ahead
  const spawnBreacher = (sd, back) => {
    const wi = pickWindow(sd, midU());
    if (wi < 0) return null;
    t.winOf(wi, wo);
    const u = wo.u + (back ? -1 : 1) * rnd(B.from[0], B.from[1]), w = sd * (Wd + B.out);
    t.walkToWorld(u, w, 0, wp);
    const z = make('brch', wp.x, groundAt(w), wp.z);
    z.onTrain = { v: t, u, w, y: groundAt(w), st: 'run', sd, win: wi, t: 0 };
    claim(wi, z);
    z.yaw = frameYaw(u); z.group.rotation.set(0, z.yaw, 0);
    sendSpawn(z, { tn: [wo.ci, sd, wo.k] });
    return z;
  };
  // a gangway zombie : comes out of the rear cab of the tail car (through its bulkhead door, forced open) and walks in
  const spawnGang = () => {
    const uB = t.tailU, u = uB - 0.6, w = rnd(-0.2, 0.2), fy = t.floorAt(u);
    t.walkToWorld(u, w, fy, wp);
    const z = make('gang', wp.x, fy, wp.z);
    z.onTrain = { v: t, u, w, y: fy, st: 'gang', sd: 1, win: -1, t: 0, gu: uB + 0.9 };
    z.yaw = frameYaw(u); z.group.rotation.set(0, z.yaw, 0);
    sendSpawn(z);
    return z;
  };
  // the trackbed zombies at the stop : a ground spawn (emergence) at the platform edge beside the train ; a normal station zombie
  const spawnBed = () => {
    const v = t.veh[Math.floor(Math.random() * t.n)];
    t.walkToWorld(v.uc + rnd(-6, 6), t.doorSide * (Wd + 2.6), 0, wp);
    const g = world.pickGround?.(wp.x, wp.z, 2, 20);
    if (!g) return null;
    const hp = hp1(), spd = speed1();
    const z = new Zombie(scene, { type: 'ground', pos: g }, hp, spd, onEvent, null, {});
    z.region = world.regionAt?.(g.x, g.z) || 0;
    game.zombies.push(z);
    if (game.isHost && game.isMultiplayer) game.net?.send({ t: 'z_spawn', id: z.id, st: 'ground', wi: -1, x: g.x, z: g.z, hp, spd, crawl: 0, ...(z.region ? { region: z.region } : null) });
    return z;
  };
  const runPlan = (e) => {
    if (e.kind === 'track' || e.kind === 'side') {
      const mid = t.L / 2 - midU(); // nose -> the players' u
      if (e.rail) { const w = rnd(-0.45, 0.45); spawnTrack('track', noseAt(e.tp) + 1.5, w, w, true); return; }
      const sd = e.sd, off = sd < 0 && e.kind === 'side' ? rnd(3.8, 5.2) : rnd(e.off[0], e.off[1]); // (the derailed wagons stand on the left : side zombies stay clear of them)
      spawnTrack(e.kind, noseAt(e.tp) - mid + rnd(-4, 4), sd * off, sd * (Wd + 1.1), false);
    } else if (e.kind === 'brch') spawnBreacher(e.sd, e.back);
  };
  const addPlan = (list) => { R.plan.push(...list); R.plan.sort((a, b) => a.at - b.at); };

  // ---------------------------------------------------------------- timeline hooks (intro.js calls them at τ ; host spawns, everyone runs the roof)
  game.introHooks.track = (tau) => {
    if (game.isClient) return;
    const n = scaled(I.trackZombies), nr = Math.min(n, scaled(I.trackOnRail)), P = I.track, list = [];
    const rails = new Set(); while (rails.size < nr) rails.add(Math.floor(Math.random() * n));
    for (let i = 0; i < n; i++) {
      const tp = P.pass[0] + ((P.pass[1] - P.pass[0]) * (i + 0.5)) / n + rnd(-0.6, 0.6);
      list.push({ at: Math.max(tau, tp - P.lead), kind: 'track', tp, rail: rails.has(i), sd: i % 2 ? 1 : -1, off: P.off });
    }
    addPlan(list);
  };
  game.introHooks.breach = (tau) => {
    if (game.isClient) return;
    const ns = scaled(I.sideZombies), nb = scaled(I.breachers), P = I.side, list = [];
    for (let i = 0; i < ns; i++) { const tp = P.pass[0] + ((P.pass[1] - P.pass[0]) * (i + 0.5)) / ns + rnd(-0.8, 0.8); list.push({ at: Math.max(tau + 0.5, tp - P.lead), kind: 'side', tp, sd: i % 2 ? -1 : 1, off: P.off }); }
    for (let i = 0; i < nb; i++) list.push({ at: B.spawn[0] + ((B.spawn[1] - B.spawn[0]) * (i + 0.3)) / nb, kind: 'brch', sd: i % 2 ? -1 : 1, back: (i >> 1) % 2 === 0 });
    addPlan(list);
  };
  game.introHooks.roof = (tau) => { R.roof = { t0: tau, step: 0, bang: 0, forced: false, gang: 0, ng: game.isClient ? 0 : scaled(I.gangway) }; };
  game.introHooks.trackbed = () => {
    if (game.isClient) return;
    const n = scaled(I.trackbed) + R.bedExtra; R.bedExtra = 0;
    for (let i = 0; i < n; i++) spawnBed();
  };

  // ---------------------------------------------------------------- per-zombie steps (zombie.js -> world hooks)
  // trackside zombie (host) : at (s, w) of the route ; walks to its lane when the train is near ; faces the track
  world.rideWalkStep = (z, dt) => {
    const W = z.rideW, ahead = W.s - t.s;
    let moving = false;
    if (!W.rail && ahead < 70 && Math.abs(W.w - W.lane) > 0.05) { const st = Math.min(Math.abs(W.lane - W.w), z.speed * dt); W.w += Math.sign(W.lane - W.w) * st; moving = st > 1e-4; }
    tr.at(W.s, o1);
    z.pos.set(o1.x - o1.tz * W.w, groundAt(W.w, W.s), o1.z + o1.tx * W.w);
    const sd = Math.sign(W.w) || 1, goal = W.rail || ahead > 4 ? Math.atan2(-o1.tx, -o1.tz) : Math.atan2(sd * o1.tz, -sd * o1.tx); // the oncoming train, then the coaches
    z.yaw += angDiff(goal, z.yaw) * Math.min(1, dt * 5);
    z.group.rotation.set(0, z.yaw, 0);
    return moving;
  };
  // zombie at / coming into the train (host) : 'run', 'hang', 'climb', 'gang' ; returns { pose, k, rate } (zombie.js poses it)
  game.rideZombieStep = (z, target, dt) => {
    const O = z.onTrain;
    let pose = 'walk', k = 0, rate = 0;
    if (O.st === 'run') {
      if (O.win < 0 || (R.claims.has(O.win) && R.claims.get(O.win) !== z.id)) { O.win = pickWindow(O.sd, O.u); claim(O.win, z); }
      const uW = O.win >= 0 ? t.winOf(O.win, wo).u : O.u, lane = O.sd * (Wd + B.hangOut + 0.25);
      const full = R.hanging >= cap(), goal = full ? uW - B.wait : uW;
      let rel = clamp((goal - O.u) * 1.5, -B.run, B.run);
      if (t.v + rel > B.maxRun) rel = B.maxRun - t.v; // it cannot keep up with a faster train
      O.u += rel * dt;
      O.w += (lane - O.w) * Math.min(1, dt * 1.3);
      O.y = groundAt(O.w);
      if (O.win >= 0 && !full && Math.abs(uW - O.u) < 0.35 && Math.abs(O.w - lane) < 0.3) { O.st = t.winSt[O.win] === 2 ? 'climb' : 'hang'; O.t = 0; R.hanging++; if (O.st === 'climb') startClimb(z); }
      if (O.u < -t.L / 2 - B.lose || O.u > t.L / 2 + 40) z.gone = true; // left behind (or far ahead) : removed, not counted
      const fy = frameYaw(O.u), lean = O.win >= 0 ? 0.9 * (1 - clamp(Math.abs(uW - O.u) / 4, 0, 1)) : 0;
      z.yaw = fy + angDiff(inwardYaw(O.u, O.sd), fy) * lean;
      pose = 'run'; rate = Math.abs(t.v + rel);
    } else if (O.st === 'hang') {
      O.t += dt;
      const ws = t.winOf(O.win, wo);
      O.u = ws.u; O.w = O.sd * (Wd + B.hangOut); O.y = t.railY + B.hangY;
      if (t.winSt[O.win] === 0 && O.t >= B.grab * B.crackAt) setWin(O.win, 1);
      if (O.t >= B.grab || t.winSt[O.win] === 2) { if (t.winSt[O.win] !== 2) setWin(O.win, 2); O.st = 'climb'; O.t = 0; startClimb(z); }
      z.yaw = inwardYaw(O.u, O.sd);
      pose = 'hang';
    } else if (O.st === 'climb') {
      O.t += dt;
      k = Math.min(1, O.t / B.climb); const e = k * k * (3 - 2 * k);
      O.u = O.u0 + (O.lu - O.u0) * e; O.w = O.w0 + (O.lw - O.w0) * e; O.y = O.y0 + (t.floorAt(O.lu ?? O.u) - O.y0) * e + B.arc * Math.sin(Math.PI * k);
      z.yaw = inwardYaw(O.u, O.sd);
      pose = 'climb';
      if (k >= 1) { O.st = 'in'; O.y = t.floorAt(O.u); release(z); pose = 'walk'; }
    } else if (O.st === 'gang') {
      O.u += z.speed * T.zombie.speedK * dt; O.w *= Math.max(0, 1 - dt * 2); O.y = t.floorAt(O.u);
      z.yaw = frameYaw(O.u);
      if (O.u >= O.gu) O.st = 'in';
    }
    t.walkToWorld(O.u, O.w, O.y, z.pos);
    z.group.rotation.y = z.yaw; if (pose !== 'climb' && pose !== 'hang') z.group.rotation.x = 0;
    return { pose, k, rate };
  };
  const startClimb = (z) => { const O = z.onTrain, L = landing(O.win, wp); O.u0 = O.u; O.w0 = O.w; O.y0 = O.y; O.lu = L.u; O.lw = L.w; };

  // a corpse of the train frame (host and clients) : outside (run, hang, early climb) -> thrown off with the train's speed ; inside : stays in
  // the frame (it falls, lies, then sinks through the floor like any corpse)
  world.rideCorpse = (z, dt) => {
    const O = z.onTrain;
    if (O.v !== t) { z.onTrain = null; return; }
    if (!O.dead) {
      O.dead = true;
      z._decal = true; // (no ground decal : the ground is not under it)
      const out = O.st === 'run' || O.st === 'hang' || (O.st === 'climb' && (O.t || 0) / B.climb < 0.45);
      if (!game.isClient) release(z);
      if (out) {
        t.frame(O.u, o1);
        const sd = O.sd || Math.sign(O.w) || 1, rx = -o1.tz * sd, rz = o1.tx * sd;
        z.fall = { vx: o1.tx * t.v + rx * 1.6, vy: 0.6, vz: o1.tz * t.v + rz * 1.6, gy: groundAt(Math.abs(O.w) + 1.2) };
        z.onTrain = null;
        return;
      }
      if (O.st === 'climb' && O.lu != null) { O.u = O.lu; O.w = O.lw; }
      O.w = clamp(O.w, -1.0, 1.0); O.y = t.floorAt(O.u); O.sink = 0;
      O.ryw = angDiff(z.yaw, frameYaw(O.u));
    }
    if (z.deathT > 2.5) O.sink += dt * 0.8;
    t.walkToWorld(O.u, O.w, O.y - O.sink, z.pos);
    z.group.rotation.y = frameYaw(O.u) + O.ryw;
  };

  // client : a ride zombie of the host in the train frame (z.net.tu…) : smoothed in the frame, so it never lags behind the coach
  world.rideNetStep = (z, n, dt) => {
    const st = RIDE_ST[n.ts | 0] || 'in';
    let O = z.onTrain;
    if (!O || O.v !== t) O = z.onTrain = { v: t, u: n.tu, w: n.tw, y: n.ty, st, ryw: n.ryw || 0, sd: Math.sign(n.tw) || 1, win: -1, t: 0 };
    const k = Math.min(1, dt * 12), pu = O.u, pw = O.w;
    if (Math.hypot(n.tu - O.u, n.tw - O.w) > 3) { O.u = n.tu; O.w = n.tw; O.y = n.ty; }
    else { O.u += (n.tu - O.u) * k; O.w += (n.tw - O.w) * k; O.y += (n.ty - O.y) * k; }
    O.ryw += angDiff(n.ryw || 0, O.ryw) * k;
    O.st = st; O.t = (n.k || 0) * B.climb; if (Math.abs(O.w) > 0.3) O.sd = Math.sign(O.w);
    t.walkToWorld(O.u, O.w, O.y, z.pos);
    z.yaw = frameYaw(O.u) + O.ryw;
    z.group.rotation.set(0, z.yaw, 0);
    if (st === 'run') { z._ridePose(dt, 'run', 0, Math.abs(t.v)); return; }
    if (st === 'hang' || st === 'climb') { z._ridePose(dt, st, n.k || 0, 0); return; }
    const moving = Math.hypot(O.u - pu, O.w - pw) > z.speed * dt * 0.3;
    z.walkT += dt * (moving ? z.speed * (z.runner ? 2.6 : 3.2) : 1.2);
    z.attacking = !!n.atk;
    const lean = z.runner ? 0.5 : 0.28;
    z._pose(z.walkT, moving ? 1 : 0.15, n.atk ? 1.5 : 0.85, n.atk ? lean + 0.3 : lean, n.atk ? 0.4 : 0.18);
  };

  // ---------------------------------------------------------------- roadkill (host decides ; everyone plays the effect)
  const roadkillFx = (z, vx, vy, vz) => {
    const p = game.player, v = Math.max(0.15, 1 - Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) / 60);
    t.walkToWorld(t.L / 2 + 0.2, 0, 0, wp);
    trainVel(t.L / 2, cv); fx.setCarry(cv.x * 0.6, cv.z * 0.6);
    fx.blood(wp.x, t.railY + 1.6, wp.z, true); fx.blood(wp.x, t.railY + 2.4, wp.z, true);
    fx.setCarry(0, 0);
    sfx.roadkill?.(v);
    t.addCabBlood();
    z.fall = { vx, vy, vz, gy: groundAt(2.5) };
    z._decal = true;
    z.rideW = null;
  };
  const roadkill = (z) => {
    const RK = I.roadkill, W = z.rideW;
    tr.at(W.s, o1);
    const sd = Math.sign(W.w) || (Math.random() < 0.5 ? -1 : 1), lat = rnd(6, 8);
    const vx = o1.tx * t.v * RK.fling - o1.tz * sd * lat, vz = o1.tz * t.v * RK.fling + o1.tx * sd * lat, vy = RK.up;
    z.damage(1e9, false);
    roadkillFx(z, vx, vy, vz);
    R.roadkills = (R.roadkills || 0) + 1;
    if (game.isMultiplayer) { game.net?.send({ t: 'z_dead', id: z.id, head: false }); game.net?.send({ t: 'tn_rk', id: z.id, vx: r2(vx), vy: r2(vy), vz: r2(vz) }); }
    if (I.roadkillPoints > 0) { // (0 by default : nobody drives) : everyone gets them
      game.addPoints(I.roadkillPoints);
      for (const pid of game.remotes.keys()) game.net?.send({ t: 'pts', pts: I.roadkillPoints }, pid);
    }
  };

  // ---------------------------------------------------------------- roof script (every peer, from τ) : footsteps, bangs, the tail door
  const roofStep = (tau) => {
    const Q = R.roof; if (!Q) return;
    const p = game.player, inT = p.onTram?.v === t, pu = inT ? p.onTram.u : 1e9, last = t.veh[t.n - 1], uTail = t.tailU;
    const vol = (u) => (inT ? clamp(1 - (Math.abs(pu - u) + 1.4) / 24, 0, 1) : 0);
    while (Q.step < Rf.steps && tau >= Q.t0 + Q.step * Rf.every) {
      const u = last.uc + last.len / 2 - 2 - ((last.len - 4) * Q.step) / Math.max(1, Rf.steps - 1);
      sfx.roofStep?.(vol(u)); Q.step++;
    }
    while (Q.bang < Rf.bangs && tau >= Rf.bangAt + Q.bang * 0.55) { sfx.knock(Math.min(1, vol(uTail) * 1.4)); Q.bang++; }
    if (tau >= Rf.forceAt) {
      t.setTail((tau - Rf.forceAt) / 0.35);
      if (!Q.forced) { Q.forced = true; const v = vol(uTail); sfx.knock(v); sfx.glass(v * 0.6); sfx.groan(v); }
      while (Q.gang < Q.ng && tau >= Rf.forceAt + 0.5 + Q.gang * Rf.gangEvery) { spawnGang(); Q.gang++; }
    }
  };

  // ---------------------------------------------------------------- per frame (main.js, after the intro clock, before the zombies)
  game.updateRide = (dt) => {
    // removed zombies (lost runners, skip) : out of the game list (host tells the clients)
    for (let i = game.zombies.length - 1; i >= 0; i--) {
      const z = game.zombies[i];
      if (!z.gone) continue;
      if (z.onTrain && !game.isClient) release(z);
      z.dispose(); game.zombies.splice(i, 1);
      if (!game.isClient) R.removed.push(z.id);
    }
    if (R.removed.length) { if (game.isHost && game.isMultiplayer) game.net?.send({ t: 'tn_rm', ids: R.removed.slice() }); R.removed.length = 0; }
    const S = game.intro;
    if (!S?.on) return;
    const tau = S.tau;
    if (S.ph === 'ride') {
      if (!game.isClient) while (R.next < R.plan.length && R.plan[R.next].at <= tau) runPlan(R.plan[R.next++]);
      roofStep(tau);
    }
    if (game.isClient) return;
    // hanging count, roadkills, trackside zombies left behind
    let h = 0;
    for (const z of game.zombies) {
      if (z.dead || !z.ride) continue;
      if (z.onTrain && (z.onTrain.st === 'hang' || z.onTrain.st === 'climb')) h++;
      const W = z.rideW;
      if (!W) continue;
      const d = t.s - W.s;
      if (S.ph === 'ride' && d > -0.3 && d < t.L + 1 && Math.abs(W.w) < Wd + 0.35 && t.speed > I.roadkill.minSpeed) { roadkill(z); continue; }
      if (d - t.L > I.track.lose) z.gone = true;
    }
    R.hanging = h;
    R.maxHangSeen = Math.max(R.maxHangSeen || 0, h);
  };

  // ---------------------------------------------------------------- intro phases (intro.js)
  // a new ride (begin, possibly late at τ) or the intro off : no plan, the train like new ; a late joiner gets the roof state from τ
  game.rideReset = (tau = 0) => {
    R.plan.length = 0; R.next = 0; R.claims.clear(); R.hanging = 0; R.bedExtra = 0; R.maxHangSeen = 0; R.roadkills = 0;
    t.resetDamage();
    R.roof = tau >= roofEvent ? { t0: roofEvent, step: Rf.steps, bang: Rf.bangs, forced: tau >= Rf.forceAt, gang: 1e9, ng: 0 } : null;
    if (tau >= Rf.forceAt) t.setTail(1);
  };
  // the stop at quai 1 (natural arrival, or a skip)
  game.rideOnStop = (skipped) => {
    R.plan.length = 0; R.next = 0;
    if (R.roof) R.roof.ng = 0; // (no more gangway zombies)
    if (skipped) { for (const z of game.zombies) if (z.ride) z.gone = true; R.bedExtra = 0; R.claims.clear(); return; }
    if (game.isClient) return;
    for (const z of game.zombies) {
      if (!z.ride || z.dead) continue;
      if (z.rideW) { z.gone = true; continue; } // trackside zombies stay in the corridor : removed
      const O = z.onTrain;
      if (!O) continue;
      if (O.st === 'run') { z.gone = true; R.bedExtra++; } // still running alongside : it climbs out of the track bed instead
      else if (O.st === 'hang') { if (t.winSt[O.win] !== 2) setWin(O.win, 2); O.st = 'climb'; O.t = 0; startClimb(z); } // in it goes
    }
  };
  // wind at the broken windows (and the forced tail door) for the local player : 0..1 (intro.js : the rolling sound)
  game.rideWind = () => {
    const p = game.player, O = p.onTram;
    if (!O || O.v !== t) return 0;
    let g = 0;
    for (const i of t.winLists[2]) { t.winOf(i, wo); g = Math.max(g, 1 - (Math.abs(wo.u - O.u) + Math.abs(wo.sd * Wd - O.w) * 0.5) / I.wind.reach); }
    if (t.tail > 0.5) g = Math.max(g, 1 - Math.abs(t.tailU - O.u) / I.wind.reach);
    return clamp(g, 0, 1) * I.wind.gain;
  };
  // effects carried by the train (main.js hitZombie : blood of a zombie in the moving train flies with it) ; false : not in the train
  game.rideFxCarry = (z) => { if (!z.onTrain || z.onTrain.v !== t || !t.speed) return false; trainVel(z.onTrain.u, cv); fx.setCarry(cv.x, cv.z); return true; };
  game.rideDebug = { R, cap, groundAt, landing, scaled };

  // ---------------------------------------------------------------- network
  // host : the extra fields of a zombie in the train frame in z_tick (after the 8 existing ones)
  game.rideTick = (z, row) => {
    const O = z.onTrain;
    if (!O || O.v !== t || z.dead) return row;
    row.push(r2(O.u), r2(O.w), r2(O.y), r2(angDiff(z.yaw, frameYaw(O.u))), STI[O.st] || 5, O.st === 'climb' ? r2(Math.min(1, (O.t || 0) / B.climb)) : 0);
    return row;
  };
  game.rideSyncZombie = (z) => (z.ride || z.onTrain ? { rk: z.ride || null, ...(z.onTrain && z.onTrain.v === t && !z.dead ? { tu: r2(z.onTrain.u), tw: r2(z.onTrain.w), ty: r2(z.onTrain.y), ts: STI[z.onTrain.st] || 5 } : null) } : null);
  // client : a ride zombie created from z_spawn / sync
  game.rideNetSpawn = (z, m) => {
    z.ride = m.rk || null; z.dropMound();
    if (m.y != null) z.pos.y = m.y;
    if (m.tu != null) { z.onTrain = { v: t, u: m.tu, w: m.tw, y: m.ty, st: RIDE_ST[m.ts | 0] || 'in', ryw: 0, sd: Math.sign(m.tw) || 1, win: -1, t: 0 }; Object.assign(z.net, { tu: m.tu, tw: m.tw, ty: m.ty, ts: m.ts | 0, ryw: 0 }); }
  };
  game.rideApplyDamage = (d) => t.applyDamage(d);
  game.rideDamageState = () => t.damageState();
  game.onRideNet = (net) => {
    net.onHost('tn_win', (m) => { if (!game.isHost && t.setWin(m.i | 0, m.st | 0)) winFx(m.i | 0, m.st | 0); });
    net.onHost('tn_rk', (m) => { if (game.isHost) return; const z = game.zombies.find((q) => q.id === m.id); if (z) { if (!z.dead) z.damage(1e9, false); roadkillFx(z, +m.vx || 0, +m.vy || 0, +m.vz || 0); } else t.addCabBlood(); });
    net.onHost('tn_rm', (m) => { if (game.isHost) return; const ids = new Set(m.ids || []); for (const z of game.zombies) if (ids.has(z.id)) z.gone = true; });
  };
}
