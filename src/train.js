import * as THREE from 'three';
import { CONFIG } from './config.js';
import { carLayouts, floorOfCar, deckAt, trainMaterials, buildCarGeometry, buildBogieGeometry, buildLampGeometry, buildPantograph, buildDoorLeaf, buildWindowGeometry, buildCabBlood } from './trainModel.js';
import { pushOut, doorIndexAt } from './tramInterior.js';

// =====================================================================
//  Train (v0.80.0 ; v0.99.0 : a TGV POS-type double-decker trainset, CONFIG.train.cars : two power cars and eight articulated trailers, about 198 m, trainModel.js) on the
//  intro route (railNet.js) ; the trailers share their bogies at the joints (pivots pf / pb), a power car has two bogies of its own. Floors : the vestibules, the
//  lower saloon, the upper deck and the stairs between them (floorAt(u, w, deck)). Phase 2 : parked at quai 1, doors open on the platform side (only the doors
//  that face the playable platform). Players walk inside with the tram's walk frame (tramInterior.js : p.onTram, `walkFrame: true`, deck = 0 lower / 1 upper).
//
//  Frames : the train is a position `s` (nose abscissa) on the route Track. Each vehicle is RIGID : its axis joins the route points at its
//  bogie pivots, its centre is the chord point (a 19 m trailer in a 190 m curve is up to 0.24 m off the curve).
//  Walk coordinates : u along the train from its middle (+ toward the nose, continuous across the gangways), w to the right of the
//  direction of travel ; (u, w) maps through the frame of the vehicle that holds u. Interior collision : boxes (u0, u1, w0, w1) per trailer
//  (seats, side walls, stair dividers, end walls with the gangway opening) shared by both decks, plus the boxes of one deck ; only the current car and its
//  neighbours are tested. The power cars are not walkable (locked cabs).
//
//  Zombies (host) : a zombie of the station whose target stands in the train goes to the door spot nearest to it (trainGoal), steps in, then
//  walks the aisle in (u, w) (trainZombieStep) : the aisle is a corridor, the stairs are waypoints. It leaves by a door when its target leaves.
//  The parked train sends nothing on the network : it is the same everywhere ; players use p_state (vh = TRAIN_ID, lx, ly, lz, lyw).
//  v0.81.0 (intro.js) : the train also MOVES (setPose(s, v), setDoors(f)) : its pose is a pure function of the intro clock, so it sends
//  nothing either. The two pooled lights follow the car nearest to the camera, the collision boxes are updated in place, passengers get a camera sway.
//  v0.82.0 (rideZombies.js) : damage of the ride : saloon windows intact / cracked / broken (winSt, synced by the host : tn_win), the tail door
//  of the last trailer forced open (tail, a function of the intro clock), blood on the nose of the head power car (roadkills, tn_rk). The panes are their
//  own InstancedMeshes (pane, crack, shards). Zombies in the train always live in its frame (z.onTrain { u, w, y, st, deck }) : they ride with it.
//  v0.99.0 : the body is solid for bullets fired from outside (rayHit).
// =====================================================================

export const TRAIN_ID = 900;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _sc = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _ls = new THREE.Vector3();

export class Train {
  // route : buildIntroRoute() ; opts : { scene / parent, collision, lightSources, region, y0 (rail head height), envMap }
  constructor(route, opts) {
    const T = CONFIG.train;
    this.id = TRAIN_ID; this.type = 'train'; this.isTrain = true; this.walkFrame = true; this.isTram = false;
    this.route = route; this.track = route.track;
    this.walkCfg = T.walk; this.walkRegion = opts.region ?? 0;
    this.railY = opts.y0 ?? 0;
    this.floorY = this.railY + T.floorHigh;  // walk floor at the doors (absolute) : boarding starts from it ; floorAt(u, w, deck) : the saloons, the stairs
    this.ceilY = this.railY + T.ceilLow;     // inner ceiling of the lower saloon (grenades)
    this.doorSide = route.platformSide;   // doors open on this side (+1 : right of the direction of travel)
    this.collision = opts.collision;
    this.state = 'ok'; this.v = 0; this.speed = 0;
    this.doors = { open: true, f: 1 };
    this.seats = []; // (no seats : tramInterior's seat code finds none)
    this.pos = new THREE.Vector3();
    // ---- interior layout of the car kinds, then the cars (nose first) : articulated, the neighbours share the bogie at their joint
    this.lay = carLayouts();
    const lens = T.cars, nCar = lens.length, gapAfter = (i) => (i === 0 || i === nCar - 2 ? T.gapPower : T.gap);
    let acc = 0;
    this.L = lens.reduce((a, b) => a + b, 0) + lens.reduce((a, _, i) => a + (i < nCar - 1 ? gapAfter(i) : 0), 0);
    const [pu0, pu1] = CONFIG.gare.playU;
    this.veh = lens.map((len, i) => {
      const uc = this.L / 2 - acc - len / 2; acc += len + (i < nCar - 1 ? gapAfter(i) : 0);
      const head = i === 0, tail = i === nCar - 1, pwr = head || tail, h = len / 2, gF = i === 0 ? 0 : gapAfter(i - 1), gB = i === nCar - 1 ? 0 : gapAfter(i);
      const kind = pwr ? 'pw' : i === 1 ? 'th' : i === nCar - 2 ? 'tt' : 'tm', Q = this.lay.cars[i];
      // bogie pivots (offsets from the car centre along u) : front, rear ; a power car and the two end trailers have a bogie of their own at the free end
      const pf = pwr ? h - T.noseBogie : i === 1 ? h - T.endBogie : h + gF / 2, pb = pwr ? -(h - T.noseBogie) : i === nCar - 2 ? -(h - T.endBogie) : -(h + gB / 2);
      // doors that face the playable platform when parked (the others stay shut and are walls) : station u of the door, from the parked nose position
      const doorOk = Q.doors.map((d) => { const su = T.park.headU - (this.L / 2 - (uc + d)); return su > pu0 + 1 && su < pu1 - 1; });
      return { i, len, uc, head, tail, pwr, flip: tail, kind, Q, pf, pb, ownF: pwr || i === 1, doorOk, x: 0, z: 0, tx: 1, tz: 0, yaw: 0 };
    });
    this.n = this.veh.length;
    this.tailU = this.veh[this.n - 2].uc + this.lay.cars[this.n - 2].cab.u; // u of the bulkhead door of the tail trailer (the door the gangway zombies force)
    // window table : lower deck saloon windows of every trailer, both sides (sd -1 left, +1 right) ; index = base[car] + (sd > 0 ? nW : 0) + k
    this.winTable = []; this.winBase = [];
    for (const v of this.veh) { this.winBase.push(this.winTable.length); for (const sd of [-1, 1]) v.Q.win.forEach((q, k) => this.winTable.push({ ci: v.i, sd, k, u: v.uc + q.u, dy: q.dy, raised: false })); }
    // ---- interior (walk coordinates) per car
    this.interior = this.buildInterior();
    // ---- meshes
    this.vis = new Uint8Array(this.n).fill(1); // cars drawn (frustum test, update)
    this.buildMeshes(opts);
    // pooled lights : `light.n` cold LED lights follow the car nearest to the camera (a low one for the lower saloon, a high one for the upper deck) ; `dyn` : the light pool follows them every frame (realworld.js)
    const Lc = T.light;
    this.lights = Array.from({ length: Lc.n }, (_, k) => ({ veh: this.veh[Math.min(2, this.n - 1)], x: 0, y: this.railY + (k ? 3.5 : Lc.y), z: 0, color: Lc.color, intensity: Lc.intensity, dist: Lc.dist, dyn: true, lo: k === 0 }));
    for (const l of this.lights) opts.lightSources?.push(l);
    // collision boxes : the body of each vehicle (a power car : the body and a narrower nose box) ; reused every frame
    this._dynBoxes = []; this._boxOwner = [];
    for (const v of this.veh) { this._dynBoxes.push({ x: 0, z: 0, w: v.pwr ? v.len - T.layout.nose : v.len, d: T.width, rot: 0, h: this.railY + T.height, c: 1, s: 0, hx: 1, hz: 1 }); this._boxOwner.push(v); if (v.pwr) { this._dynBoxes.push({ x: 0, z: 0, w: T.layout.nose * 0.8, d: T.width * 0.7, rot: 0, h: this.railY + T.powerHeight, c: 1, s: 0, hx: 1, hz: 1 }); this._boxOwner.push(v); } }
    this.s = route.parkHeadS;
    this.apply();
    this.flickT = 0;
    // camera sway (local look) : roll (rad), bob (m) ; rail joints : distance since the last joint, pending wheel jolts (s)
    this.sway = { roll: 0, bob: 0, curve: 0, t: 0, jointD: 0, jolts: new Float32Array(8).fill(-1), kick: 0 };
    this.onJoint = null; // (speed) => void : rail joint under the train (intro.js plays the clack)
  }

  // ------------------------------------------------------------------ floor height (absolute) at walk coordinate (u, w) on deck 0 / 1 : the saloons, the stairs, the vestibules
  floorAt(u, w = 0, deck = 0) { const v = this.veh[this.moduleAt(u)]; return this.railY + floorOfCar(v.Q, u - v.uc, w, deck); }
  // the deck a walker at (u, w) belongs to (decided on the stairs, kept elsewhere)
  deckAt(u, w, deck = 0) { const v = this.veh[this.moduleAt(u)]; return deckAt(v.Q, u - v.uc, w, deck); }

  // ------------------------------------------------------------------ ride damage (v0.82.0) : windows, tail door, blood on the cab
  // window index : see winTable (car, side, k) ; side -1 left / +1 right
  winIndex(ci, sd, k) { return this.winBase[ci] + (sd > 0 ? this.veh[ci].Q.win.length : 0) + k; }
  winOf(i, out) { const q = this.winTable[i]; out.ci = q.ci; out.sd = q.sd; out.k = q.k; out.u = q.u; out.dy = q.dy; return out; }
  setWin(i, st) { if (this.winSt[i] === st) return false; this.winSt[i] = st; this.winDirty = true; this.applyWindows(); return true; }
  setTail(f) { f = clamp(f, 0, 1); if (f === this.tail) return; this.tail = f; this.applyDoors(); }
  addCabBlood() { const m = this.cabBlood[this.cabBloodN % this.cabBlood.length]; m.visible = true; this.cabBloodN++; }
  // everything back to new (a reset, a new intro)
  resetDamage() { this.winSt.fill(0); this.winDirty = true; this.applyWindows(); this.setTail(0); for (const m of this.cabBlood) m.visible = false; this.cabBloodN = 0; }
  damageState() { const w = []; this.winSt.forEach((st, i) => { if (st) w.push(i, st); }); return { w, cb: this.cabBloodN }; }
  applyDamage(d) { if (!d) return; for (let i = 0; i + 1 < (d.w || []).length; i += 2) this.winSt[d.w[i]] = d.w[i + 1]; this.winDirty = true; this.applyWindows(); for (let k = 0; k < Math.min(d.cb || 0, this.cabBlood.length); k++) this.addCabBlood(); }

  // ------------------------------------------------------------------ moving (intro.js) : nose abscissa s, speed v (m/s), doors 0..1
  setPose(s, v) {
    this.v = v; this.speed = Math.abs(v);
    if (s === this.s && this._posed) return;
    this.s = s; this._posed = true;
    this.apply();
  }
  setDoors(f) {
    f = clamp(f, 0, 1);
    if (f === this.doors.f) return;
    this.doors.f = f; this.doors.open = f >= this.walkCfg.doorOpen;
    this.applyDoors();
  }
  // back to the parked state of v0.80.0 (quai 1, doors open, stopped)
  park() { this.v = 0; this.speed = 0; this.s = this.route.parkHeadS; this.apply(); this.setDoors(1); }

  // ------------------------------------------------------------------ walk API (same as Tram : tramInterior.js, remote.js, main.js)
  get usable() { return this.state === 'ok'; }
  get hpFrac() { return 1; }
  walkOpen() { return this.doors.f >= this.walkCfg.doorOpen && Math.abs(this.v) <= this.walkCfg.boardSpeed; }
  // vehicle index holding u (gaps : nearest end)
  moduleAt(u) {
    let best = 0, bd = Infinity;
    for (const v of this.veh) { const d = Math.max(0, Math.abs(u - v.uc) - v.len / 2); if (d < bd) { bd = d; best = v.i; } }
    return best;
  }
  moduleU(i) { return this.veh[i].uc; }
  frame(u, out) { const v = this.veh[this.moduleAt(u)], d = u - v.uc; out.x = v.x + v.tx * d; out.z = v.z + v.tz * d; out.tx = v.tx; out.tz = v.tz; out.yaw = v.yaw; out.R = Infinity; return out; }
  walkToWorld(u, w, y, out) { const o = this._wf || (this._wf = {}); this.frame(u, o); out.x = o.x - o.tz * w; out.z = o.z + o.tx * w; out.y = y; return out; }
  worldToWalk(x, z, out) {
    let bu = 0, bw = 99, bd = Infinity;
    for (const v of this.veh) {
      const dx = x - v.x, dz = z - v.z, du = dx * v.tx + dz * v.tz, dw = -dx * v.tz + dz * v.tx, d = Math.max(0, Math.abs(du) - v.len / 2 - CONFIG.train.gap / 2);
      if (d < bd) { bd = d; bu = v.uc + du; bw = dw; }
    }
    out.u = bu; out.w = bd > 10 || Math.abs(bw) > 12 ? 99 : bw;
    return out;
  }
  // cheap reach test (boarding, prompts) : within r m of the train body
  walkBounds(x, z, r = 6) { const o = this._wb || (this._wb = {}); this.worldToWalk(x, z, o); return o.w !== 99 && Math.abs(o.w) < r && o.u > -this.L / 2 - r && o.u < this.L / 2 + r; }
  // collision lists around u : the car of u and its neighbours (the boxes shared by the decks, the boxes of `deck`, the walls)
  walkLists(u, pass, deck = 0) {
    const k = this.moduleAt(u), out = this._wl || (this._wl = []);
    out.length = 0;
    for (let i = Math.max(0, k - 1); i <= Math.min(this.n - 1, k + 1); i++) { const c = this.interior.byCoach[i]; if (!c) continue; out.push(c.boxes, deck ? c.d1 : c.d0, pass ? c.wallsOpen : c.wallsClosed); }
    if (!out.length) out.push(this.interior.boxes, this.interior.wallsClosed);
    return out;
  }
  // floor under a world point inside a car (grenades), or null
  walkFloorAt(x, z) { const o = this._wg || (this._wg = {}); this.worldToWalk(x, z, o); return o.w !== 99 && Math.abs(o.w) < this.walkCfg.wall && o.u > this.interior.u0 && o.u < this.interior.u1 ? this.floorAt(o.u, o.w) : null; }
  get dynKey() { return 'train' + this.id; }

  buildInterior() {
    const T = CONFIG.train, W = T.walk;
    const all = { boxes: [], wallsClosed: [], wallsOpen: [], spans: [], seatSpots: [], byCoach: [], cab: [], u0: Infinity, u1: -Infinity, uEnd: 0 };
    const mv = (list, uc, out) => { for (const b of list) out.push({ u0: uc + b.u0, u1: uc + b.u1, w0: b.w0, w1: b.w1 }); return out; };
    const add = (list, u0, u1, w0, w1) => { const b = { u0, u1, w0, w1 }; list.push(b); return b; };
    const wo = W.wall, wt = W.wall + W.thick, dw = T.doorWidth / 2;
    for (const v of this.veh) {
      const Q = v.Q, uc = v.uc, h = Q.h;
      if (!Q.walk) continue; // (a power car : locked)
      const c = { boxes: mv(Q.boxes.common, uc, []), d0: mv(Q.boxes.d0, uc, []), d1: mv(Q.boxes.d1, uc, []), wallsClosed: [], wallsOpen: [] };
      let lo = uc - h + 0.15, hi = uc + h - 0.15;
      if (Q.cab) { const ub = uc + Q.cab.u; all.cab.push({ u: ub - Q.cab.dir * 0.1, text: 'Porte de service — verrouillée' }); if (Q.cab.dir > 0) hi = ub - 0.15; else lo = ub + 0.15; }
      // side walls (closed ; open at the doors of the platform side that face the playable platform)
      const spans = Q.doors.map((d, k) => (v.doorOk[k] ? [uc + d - dw, uc + d + dw] : null)).filter(Boolean).sort((a, b) => a[0] - b[0]);
      const ext0 = uc - h - T.gap / 2, ext1 = uc + h + T.gap / 2;
      for (const sd of [-1, 1]) {
        const w0 = sd > 0 ? wo : -wt, w1 = sd > 0 ? wt : -wo;
        add(c.wallsClosed, ext0, ext1, w0, w1);
        if (sd !== this.doorSide) { add(c.wallsOpen, ext0, ext1, w0, w1); continue; }
        let a = ext0;
        for (const [d0, d1] of spans) { add(c.wallsOpen, a, d0, w0, w1); a = d1; }
        add(c.wallsOpen, a, ext1, w0, w1);
      }
      all.spans.push(...spans);
      all.byCoach[v.i] = c;
      all.boxes.push(...c.boxes); all.wallsClosed.push(...c.wallsClosed); all.wallsOpen.push(...c.wallsOpen);
      all.u0 = Math.min(all.u0, lo); all.u1 = Math.max(all.u1, hi);
    }
    all.spans.sort((a, b) => a[0] - b[0]);
    all.uEnd = Math.max(-all.u0, all.u1);
    return all;
  }

  buildMeshes(opts) {
    const T = CONFIG.train, M = trainMaterials(opts.envMap);
    this.mats = M;
    const root = this.group = new THREE.Group(); root.name = 'train'; root.userData.noTerrain = true;
    (opts.parent || opts.scene).add(root);
    // per-vehicle carriers (avatars of teammates standing in the train are parented to them, see remote.js ; the lamps, pantographs too)
    this.mods = this.veh.map((v) => { const g = new THREE.Group(); g.name = 'train:carrier:' + v.i; root.add(g); return { g }; });
    // car bodies : one InstancedMesh per material per car kind (power car, middle trailer, head trailer, tail trailer) ; the instances are compacted to the visible cars (applyBodies)
    this.kindCars = {}; this.bodyByKind = {};
    for (const v of this.veh) (this.kindCars[v.kind] || (this.kindCars[v.kind] = [])).push(v);
    this.coachMeshes = [];
    for (const [kind, cars] of Object.entries(this.kindCars)) {
      const geo = buildCarGeometry(kind), list = this.bodyByKind[kind] = [];
      for (const [k, mat] of Object.entries({ body: M.body, dark: M.dark, inside: M.inside, glass: M.glass, screen: M.screen, panel: M.panel, flicker: M.flicker, decal: M.decal })) {
        if (!geo[k]) continue;
        const im = new THREE.InstancedMesh(geo[k], mat, cars.length); im.name = `train:${kind}:${k}`; im.userData.kind = kind;
        im.castShadow = false; im.receiveShadow = k !== 'glass' && k !== 'panel' && k !== 'flicker'; // (no shadow pass : the train stands in the shadow of the shed roof)
        im.userData.noTerrain = true; im.frustumCulled = false;
        root.add(im); this.coachMeshes.push(im); list.push(im);
      }
    }
    // bogies : 4 motor bogies (power cars), 9 Jacobs bogies (2 end trailers have their own, 7 at the joints) ; own yaw (along the track at the pivot)
    const mkB = (kind, n) => { const im = new THREE.InstancedMesh(buildBogieGeometry(kind), M.dark, n); im.name = 'train:bogies:' + kind; im.castShadow = false; im.receiveShadow = true; im.userData.noTerrain = true; root.add(im); this.coachMeshes.push(im); return im; };
    this.bogieM = mkB('motor', 4); this.bogieJ = mkB('jacobs', this.n - 1);
    // small parts on the car carriers : lamps (white at the head, red at the tail), pantographs (raised on the head trailer, lowered on the tail one)
    this.extra = [];
    const part = (geo, mat, ci, name, yaw = 0, u = 0) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(0, this.railY, -u); m.rotation.y = yaw; m.castShadow = false; m.receiveShadow = false; m.userData.ci = ci; this.mods[ci].g.add(m); this.extra.push(m); return m; };
    const lamps = buildLampGeometry();
    for (const [ci, yaw] of [[0, 0], [this.n - 1, Math.PI]]) part(lamps, ci === 0 ? M.lampHead : M.lampTail, ci, 'train:lamps', yaw);
    { const h = this.veh[1].len / 2 - 3.4; part(buildPantograph(true), M.dark, 1, 'train:panto', 0, h); part(buildPantograph(false), M.dark, this.n - 2, 'train:pantoDown', Math.PI, -h); }
    // door leaves : 2 per side per door + the two bulkhead doors of the end trailers
    const nDoors = this.veh.reduce((a, v) => a + 2 * v.Q.doors.length, 0);
    const leaf = buildDoorLeaf();
    this.leafN = nDoors + 2;
    this.leafMeshes = [new THREE.InstancedMesh(leaf.leaf, M.body, this.leafN), new THREE.InstancedMesh(leaf.glass, M.glass, this.leafN)];
    for (const im of this.leafMeshes) { im.name = 'train:leaf'; im.castShadow = false; im.receiveShadow = true; root.add(im); }
    // saloon windows (v0.82.0) : intact / cracked panes, cracks, shards of the broken ones ; lists of window indices per mesh (rebuilt on change)
    const wg = buildWindowGeometry(), nWin = this.winTable.length;
    this.winSt = new Uint8Array(nWin); this.winDirty = true; this.winLists = [[], [], []];
    this.winMeshes = [[wg.pane, M.glass], [wg.crack, M.crack], [wg.shards, M.shards]].map(([g, m], i) => {
      const im = new THREE.InstancedMesh(g, m, nWin); im.name = 'train:window:' + ['pane', 'crack', 'shards'][i];
      im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; im.count = 0; im.userData.noTerrain = true; root.add(im); return im;
    });
    this.tail = 0;
    // blood on the nose of the head power car (roadkills) : hidden decals, shown one after the other
    this.cabBlood = buildCabBlood().map((g) => { const m = new THREE.Mesh(g, M.decal); m.visible = false; m.name = 'train:cabBlood'; m.position.y = this.railY; this.mods[0].g.add(m); return m; });
    this.cabBloodN = 0;
  }
  // window instances : pane (state 0 intact, 1 cracked), crack (1), shards (2) ; matrices follow the cars (no allocation)
  applyWindows() {
    if (!this.winMeshes) return;
    const L = this.winLists, Wd = CONFIG.train.width / 2 - 0.025, o = this._wo || (this._wo = {});
    if (this.winDirty) { for (const l of L) l.length = 0; this.winSt.forEach((st, i) => { if (st < 2) L[0].push(i); if (st === 1) L[1].push(i); if (st === 2) L[2].push(i); }); this.winDirty = false; }
    for (let m = 0; m < 3; m++) {
      const im = this.winMeshes[m], list = L[m];
      for (let j = 0; j < list.length; j++) {
        this.winOf(list[j], o);
        const v = this.veh[o.ci], c = Math.cos(v.yaw), s = Math.sin(v.yaw), lx = o.sd * Wd, lz = -(o.u - v.uc);
        _lq.setFromAxisAngle(_up, v.yaw); _lm.compose(_p.set(v.x + c * lx + s * lz, this.railY + o.dy, v.z - s * lx + c * lz), _lq, _sc);
        im.setMatrixAt(j, _lm);
      }
      im.count = list.length; im.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ pose (rigid frames), meshes, collision
  apply() {
    const tr = this.track, a = this._a || (this._a = {}), b = this._b || (this._b = {}), c = this._c || (this._c = {});
    let nm = 0, nj = 0;
    const bogie = (s, motor) => { // a bogie at route abscissa s : along the track there
      tr.at(clamp(s + 1.35, 0, tr.L), a); tr.at(clamp(s - 1.35, 0, tr.L), b); tr.at(clamp(s, 0, tr.L), c);
      _q.setFromAxisAngle(_up, Math.atan2(-(a.x - b.x), -(a.z - b.z))); _m.compose(_p.set(c.x, this.railY, c.z), _q, _sc);
      (motor ? this.bogieM : this.bogieJ).setMatrixAt(motor ? nm++ : nj++, _m);
    };
    for (const v of this.veh) {
      const sc = this.s - (this.L / 2 - v.uc); // abscissa of the car centre ; its axis joins the route points at its bogie pivots
      tr.at(clamp(sc + v.pf, 0, tr.L), a); tr.at(clamp(sc + v.pb, 0, tr.L), b);
      let tx = a.x - b.x, tz = a.z - b.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      v.x = a.x - tx * v.pf; v.z = a.z - tz * v.pf; v.tx = tx; v.tz = tz; v.yaw = Math.atan2(-tx, -tz); // (the centre : pf behind the front pivot, on the chord)
      this.mods[v.i].g.position.set(v.x, 0, v.z); this.mods[v.i].g.rotation.set(0, v.yaw, 0); this.mods[v.i].g.updateMatrixWorld();
      if (v.ownF) bogie(sc + v.pf, v.pwr);
      bogie(sc + v.pb, v.pwr);
    }
    for (const im of [this.bogieM, this.bogieJ]) { im.count = im === this.bogieM ? nm : nj; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    const v0 = this.veh[0];
    this.pos.set(v0.x, this.railY, v0.z); this.yaw = v0.yaw;
    this.applyBodies(); // car bodies (instances)
    this.applyDoors(); // (the leaves ride with the cars)
    this.applyWindows();
    // pooled lights follow their car
    if (this.lights) for (const l of this.lights) { l.x = l.veh.x; l.z = l.veh.z; }
    // world collision : oriented boxes (dynamic : they push walkers and zombies ; bullets : rayHit below) ; no allocation (every frame)
    const D = this._dynBoxes, Tn = CONFIG.train.layout.nose;
    for (let k = 0; k < D.length; k++) {
      const v = this._boxOwner[k], o = D[k], rot = Math.atan2(v.tz, v.tx);
      // (a power car has two boxes : the body, then the nose, shifted along the car toward its nose)
      const off = v.pwr ? (o.w === v.len - Tn ? -Tn / 2 : v.len / 2 - Tn * 0.4) * (v.flip ? -1 : 1) : 0;
      o.x = v.x + v.tx * off; o.z = v.z + v.tz * off; o.rot = rot; o.c = Math.cos(rot); o.s = Math.sin(rot); o.hx = o.w / 2; o.hz = o.d / 2;
    }
    this.collision?.setDynamic(this.dynKey, D);
  }
  // car bodies : the instances of each kind are packed into the first slots (the cars in view only : draw cost follows the view)
  applyBodies() {
    const cnt = this._cnt || (this._cnt = {});
    for (const k in this.kindCars) cnt[k] = 0;
    for (const v of this.veh) {
      if (!this.vis[v.i]) continue;
      const k = cnt[v.kind]++;
      _q.setFromAxisAngle(_up, v.yaw + (v.flip ? Math.PI : 0)); _m.compose(_p.set(v.x, this.railY, v.z), _q, _sc);
      for (const im of this.bodyByKind[v.kind]) im.setMatrixAt(k, _m);
    }
    for (const kind in this.kindCars) for (const im of this.bodyByKind[kind]) { im.count = cnt[kind]; im.instanceMatrix.needsUpdate = true; im.visible = cnt[kind] > 0 && this.drawn !== false; if (cnt[kind]) im.computeBoundingSphere(); }
    for (const m of this.extra) m.visible = !!this.vis[m.userData.ci] && this.drawn !== false;
  }
  applyDoors() {
    const T = CONFIG.train, f = this.doors.f, Wd = T.width / 2;
    let k = 0;
    const put = (v, u, w, rotY, sxx = 1, dy = 0, syy = 1) => {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw); // vehicle local (w, -u) -> world
      const lx = w, lz = -(u - v.uc), wx = v.x + c * lx + s * lz, wz = v.z - s * lx + c * lz;
      _lq.setFromAxisAngle(_up, v.yaw + rotY); _ls.set(1, syy, sxx);
      _lm.compose(_p.set(wx, this.railY + dy, wz), _lq, _ls);
      for (const im of this.leafMeshes) im.setMatrixAt(k, _lm);
      k++;
    };
    for (const v of this.veh) {
      for (const sd of [-1, 1]) v.Q.doors.forEach((d, di) => {
        const open = sd === this.doorSide && v.doorOk[di] ? f : 0, uD = v.uc + d, dir = d > 0 ? 1 : -1;
        // plug door : out of the opening (0.07 m), then slides toward the car centre
        put(v, uD - dir * open * (T.doorWidth + 0.05), sd * (Wd - 0.03 + 0.07 * Math.min(1, open * 4)), sd > 0 ? 0 : Math.PI);
      });
    }
    // the locked bulkhead doors (closed end of the head trailer and of the tail trailer) : scaled to the doorway ; the tail one is forced by the gangway zombies (v0.82.0)
    const sxd = (T.walk.partitionDoor - 0.1) / T.doorWidth, syd = 0.93, F0 = T.floorHigh, dyc = F0 + 0.02 - (F0 + 0.02) * syd;
    for (const v of this.veh) {
      if (!v.Q.cab) continue;
      const ub = v.uc + v.Q.cab.u, tl = v.tail || v.i === this.n - 2 ? this.tail || 0 : 0;
      if (v.kind === 'th') put(v, ub - 0.03, 0, Math.PI / 2, sxd, dyc, syd);
      else put(v, ub + 0.03 + 0.06 * tl, tl * 0.86, -Math.PI / 2 + 0.25 * tl, sxd, dyc, syd);
    }
    for (const im of this.leafMeshes) { im.count = k; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }

  update(dt, game) {
    // test each car against the camera frustum (draw calls and triangles : only the cars in view are drawn) ; the car around the player and its neighbours always
    const cam = game?.player?.camera;
    if (cam) {
      _fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const inT = game.player?.onTram?.v === this, ck = inT ? this.moduleAt(game.player.onTram.u) : -9;
      let any = false, changed = false, near = 0, nd = Infinity;
      const cp = cam.position;
      for (const v of this.veh) {
        _sph.center.set(v.x, this.railY + 2, v.z); _sph.radius = v.len / 2 + 1.5;
        const on = Math.abs(v.i - ck) <= 1 || _fr.intersectsSphere(_sph) ? 1 : 0;
        if (on) any = true;
        if (this.vis[v.i] !== on) { this.vis[v.i] = on; changed = true; }
        const d = Math.hypot(v.x - cp.x, v.z - cp.z); if (d < nd) { nd = d; near = v.i; }
      }
      const drawn = any;
      if (drawn !== this.drawn) { this.drawn = drawn; changed = true; }
      if (changed) this.applyBodies();
      for (const im of this.bogieM ? [this.bogieM, this.bogieJ] : []) im.visible = any;
      for (const im of this.leafMeshes) im.visible = any;
      if (this.winMeshes) for (const im of this.winMeshes) im.visible = any && im.count > 0;
      // the pooled lights follow the car nearest to the camera
      const nv = this.veh[near];
      for (const l of this.lights) { l.veh = nv; l.x = nv.x; l.z = nv.z; }
    }
    // faulty LED strips : random flicker (local look only)
    const F = CONFIG.train.flicker;
    this.flickT -= dt;
    if (this.flickT <= 0) { this.flickT = (0.3 + Math.random()) / F.hz; this.mats.flicker.emissiveIntensity = Math.random() < F.rate ? 0.04 : 0.4 + Math.random() * 0.8; }
    this.updateSway(dt);
  }

  // bullets : a ray (absolute origin, unit direction) against the body boxes ; the shots fired from inside the train pass, the shots from outside stop at the body (windows
  // included). Returns the distance of the first hit, or maxT.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    const y0 = this.railY + 0.2, y1 = this.railY + CONFIG.train.shotH;
    let best = maxT;
    for (const b of this._dynBoxes) {
      const rx = ox - b.x, rz = oz - b.z, rr = b.hx + b.hz + best;
      if (rx * rx + rz * rz > rr * rr) continue;
      const lx = b.c * rx + b.s * rz, lz = -b.s * rx + b.c * rz, ldx = b.c * dx + b.s * dz, ldz = -b.s * dx + b.c * dz;
      let t0 = 0, t1 = best;
      if (Math.abs(ldx) < 1e-9) { if (Math.abs(lx) > b.hx) continue; } else { const a = (-b.hx - lx) / ldx, c = (b.hx - lx) / ldx; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
      if (Math.abs(ldz) < 1e-9) { if (Math.abs(lz) > b.hz) continue; } else { const a = (-b.hz - lz) / ldz, c = (b.hz - lz) / ldz; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
      if (t0 >= t1 || t0 <= 0) continue; // (t0 = 0 : the origin is inside the box, a shot from inside the train)
      const y = oy + dy * t0;
      if (y < y0 || y > y1) continue;
      if (t0 < best) best = t0;
    }
    return best;
  }

  // camera sway of the passengers (local look, no allocation) : a slow roll and bob that grow with speed, a lean in curves (lateral
  // acceleration v² κ, κ the signed curvature at the middle of the train), and a small kick at each wheelset crossing a rail joint
  updateSway(dt) {
    const S = this.sway, W = CONFIG.train.sway, sp = this.speed, k = Math.min(1, sp / W.refSpeed);
    if (!dt) return;
    S.t += dt * (0.6 + 0.4 * k);
    const tr = this.track, a = this._sa || (this._sa = {}), b = this._sb || (this._sb = {}), sm = this.s - this.L / 2;
    tr.at(sm - 6, a); tr.at(sm + 6, b);
    const kappa = (a.tx * b.tz - a.tz * b.tx) / 12, lean = clamp(-kappa * sp * sp * W.curve, -2.5, 2.5) * (Math.PI / 180);
    S.curve += (lean - S.curve) * Math.min(1, dt * 1.5);
    // rail joints : the wheelsets of a car cross a joint at 0, axle, bogie, bogie + axle m
    if (sp > 0.3) {
      S.jointD += sp * dt;
      if (S.jointD >= W.joint) {
        S.jointD -= W.joint;
        const J = S.jolts, B = W.bogie, off = this._joff || (this._joff = [0, W.axle, B, B + W.axle]);
        let n = 0; for (const d of off) { for (; n < J.length; n++) if (J[n] < 0) { J[n] = d / sp; break; } }
        this.onJoint?.(sp);
      }
    }
    for (let i = 0; i < S.jolts.length; i++) if (S.jolts[i] >= 0) { S.jolts[i] -= dt; if (S.jolts[i] < 0) { S.kick = W.jolt * (0.6 + 0.4 * k); S.jolts[i] = -1; } }
    S.kick *= Math.max(0, 1 - dt * 14);
    S.roll = k * W.roll * (Math.PI / 180) * (Math.sin(S.t * 2 * Math.PI * W.hz * 0.5) + 0.35 * Math.sin(S.t * 2 * Math.PI * W.hz * 1.3 + 1.1)) + S.curve;
    S.bob = k * W.bob * Math.sin(S.t * 2 * Math.PI * W.hz) - S.kick;
  }
}

// ======================================================================= game hooks
// game.train : the parked train (world.gare.train) ; walk frames : trams + train ; zombies boarding ; prompts
export function installTrain(game, { world, hud }) {
  const t = world.gare?.train;
  if (world.gare) game.updateTrain = (dt) => { world.gare.cullItems?.(game.player.camera.position, dt); world.gare.scenery?.update(game.player.camera.position); t?.update(dt, game); }; // station items cull, far ground of the ride, LED flicker, sway
  if (!t) return;
  const T = CONFIG.train, W = T.walk, Z = T.zombie;
  game.train = t;
  world.train = t;
  const baseRide = game.rideById.bind(game);
  game.rideById = (id) => (id === TRAIN_ID ? t : baseRide(id));
  game.walkFrames = () => { const a = game._wfl || (game._wfl = []); if (a.length !== game.trams.length + 1) { a.length = 0; a.push(...game.trams, t); } return a; };
  const loc = { u: 0, w: 0 }, loc2 = { u: 0, w: 0 }, pt = { u: 0, w: 0 }, tmp = { x: 0, y: 0, z: 0 };
  // bullets : the body is solid for the shots fired from outside (the world's rayHit takes the nearer of its own hit and the train's)
  if (world.rayHit) { const base = world.rayHit; world.rayHit = (ox, oy, oz, dx, dy, dz, maxT) => { const t0 = base(ox, oy, oz, dx, dy, dz, maxT); return t.speed >= 0 ? Math.min(t0, t.rayHit(ox, oy, oz, dx, dy, dz, t0)) : t0; }; }
  const deckOfY = (y) => (y - t.railY > W.deckMid ? 1 : 0);   // the deck of a body at height y (feet)

  // the train carrying a zombie target (local player or teammate standing in it), and the target's (u, w)
  const trainOf = (target) => {
    if (!target) return null;
    if (target === game.player) return game.player.onTram?.v === t ? t : null;
    return target.tr && target.tr.id === TRAIN_ID ? t : null;
  };
  const localOf = (target, out) => {
    if (target === game.player) { const O = game.player.onTram; out.u = O.u; out.w = O.w; return out; }
    const L = target.trL && target.trL.t === t ? target.trL : target.tr;
    out.u = L.u; out.w = L.w; return out;
  };
  // door spots (outside, on the platform side) : world point of door i
  const doorSpot = (i, out) => { const sp = t.interior.spans[i]; return t.walkToWorld((sp[0] + sp[1]) / 2, t.doorSide * (T.width / 2 + Z.doorSpot), 0, out); };

  Object.assign(game, {
    trainOfTarget: trainOf,
    // zombie of the train's region whose target is in the train : go to the best open door ; close enough : step in
    trainGoal(target, z) {
      if (z.onTrain || z.region !== t.walkRegion || !t.walkOpen()) return null;
      const tt = trainOf(target);
      if (!tt) return null;
      localOf(target, loc2);
      let best = -1, bc = Infinity, bd = Infinity;
      for (let i = 0; i < t.interior.spans.length; i++) {
        doorSpot(i, tmp);
        const sp = t.interior.spans[i], d = Math.hypot(tmp.x - z.pos.x, tmp.z - z.pos.z), cost = d + 1.5 * Math.abs((sp[0] + sp[1]) / 2 - loc2.u);
        if (cost < bc) { bc = cost; bd = d; best = i; }
      }
      if (best < 0) return null;
      doorSpot(best, tmp);
      if (bd < Z.enter) { // step in : the zombie now lives in the train frame
        const sp = t.interior.spans[best];
        t.worldToWalk(z.pos.x, z.pos.z, loc);
        z.onTrain = { v: t, u: clamp(loc.u, sp[0] + Z.radius, sp[1] - Z.radius), w: loc.w, y: z.pos.y, door: (sp[0] + sp[1]) / 2, st: 'enter', deck: 0 };
      }
      return { x: tmp.x, z: tmp.z };
    },
    // one step of a zombie inside the train ; returns { inRange, moving } (zombie.js plays the strike and the pose), or null (left the train).
    // target may be null (nobody standing). v0.82.0 : the moving train (intro) : doors closed, a zombie inside chases its target in the frame,
    // or waits in the aisle ; it leaves only by an open door. The states of the ride (run, hang, climb, gang : outside or coming in) are
    // stepped by rideZombies.js (game.rideZombieStep).
    trainZombieStep(z, target, dt) {
      const O = z.onTrain;
      if (!O || O.v !== t) return null;
      if (O.st !== 'enter' && O.st !== 'in' && O.st !== 'leave') return game.rideZombieStep ? game.rideZombieStep(z, target, dt) : null;
      const open = t.walkOpen(), tgtIn = trainOf(target) === t ? localOf(target, loc2) : null;
      if (!tgtIn && O.st !== 'leave' && open) { // its target left : out by the nearest platform door
        let best = 0, bd = Infinity;
        for (const sp of t.interior.spans) { const d = Math.abs((sp[0] + sp[1]) / 2 - O.u); if (d < bd) { bd = d; best = (sp[0] + sp[1]) / 2; } }
        O.st = 'leave'; O.door = best;
      } else if ((tgtIn || !open) && O.st === 'leave') O.st = 'in';
      // goal in (u, w)
      let gu, gw, aisle = false;
      if (O.st === 'enter') { gu = O.door; gw = 0; if (Math.abs(O.w) < W.wall - 0.2) O.st = 'in'; }
      else if (O.st === 'leave') { gu = O.door; gw = Math.abs(O.u - O.door) > 0.35 ? 0 : t.doorSide * (W.outW + 0.3); aisle = Math.abs(O.u - O.door) > 0.35; }
      else if (!tgtIn) { gu = O.u; gw = 0; aisle = Math.abs(O.w) > 0.12; } // nobody to chase in the train : back to the aisle and wait
      else { gu = loc2.u; gw = loc2.w; aisle = Math.abs(loc2.u - O.u) > 0.9; if (aisle) gw = 0; }
      // the other deck : by the stairs of the nearest end (waypoints : the foot of the up-flight in the vestibule, then its top ; down : its top, then the foot)
      const deckZ = O.deck | 0, deckT = tgtIn && O.st === 'in' ? deckOfY(target.pos.y) : deckZ;
      if (deckT !== deckZ) {
        const v = t.veh[t.moduleAt(O.u)], Q = v.Q;
        if (O.stE === undefined) O.stE = O.u - v.uc >= 0 ? 1 : -1;
        const e = O.stE, up = -e * 0.9, uTop = v.uc + e * (Q.us + 0.4), uFoot = v.uc + e * (Q.h - Q.vest + 0.6);
        const lu = Math.abs(O.u - v.uc), dV = Q.h - Q.vest;
        let toTop;
        if (deckZ === 0) { if (lu >= dV - 0.1) O.stairs = 1; toTop = !!O.stairs; } else toTop = lu < Q.us + 0.1;
        gu = toTop ? uTop : uFoot; gw = up; aisle = deckZ === 0 ? !toTop && lu < dV - 0.1 : lu < Q.us;
      } else { O.stE = undefined; O.stairs = 0; }
      let du = gu - O.u, dw = gw - O.w;
      if (aisle && Math.abs(O.w) > 0.12) { du = Math.sign(du) * Math.min(Math.abs(du), 0.35); dw = -O.w * 3; } // back to the aisle first (seats, partition doors, gangways : all open at w = 0)
      const dl = Math.hypot(du, dw);
      const inRange = !!tgtIn && O.st === 'in' && deckT === deckZ && Math.hypot(target.pos.x - z.pos.x, target.pos.z - z.pos.z) < CONFIG.zombie.attackRange && Math.abs(target.pos.y - z.pos.y) < 2.4;
      if (!inRange && z.attackWindup >= 0 && !target) z.attackWindup = -1; // (its target fell : no blow in the air)
      let moving = false;
      if (!inRange && z.attackWindup < 0 && dl > 0.05) {
        const sp = (z.limp ? z.speed * 0.8 : z.speed) * (z.slowT > 0 ? z.slowK : 1) * Z.speedK, k = Math.min(dl, sp * dt) / dl;
        pt.u = O.u + du * k; pt.w = O.w + dw * k;
        // other zombies in the train : keep apart (in the frame)
        for (const o of game.zombies) {
          if (o === z || o.dead || !o.onTrain || o.onTrain.v !== t) continue;
          const eu = pt.u - o.onTrain.u, ew = pt.w - o.onTrain.w, d = Math.hypot(eu, ew);
          if (d > 0 && d < 0.6) { pt.u += (eu / d) * (0.6 - d) * 0.5; pt.w += (ew / d) * (0.6 - d) * 0.25; }
        }
        pushOut(t.walkLists(pt.u, O.st !== 'in', O.deck | 0), pt, Z.radius);
        moving = Math.hypot(pt.u - O.u, pt.w - O.w) > sp * dt * 0.2;
        if (moving) { // face the way it walks (world)
          t.frame(pt.u, tmp);
          const wu = pt.u - O.u, ww = pt.w - O.w, wx = tmp.tx * wu - tmp.tz * ww, wz = tmp.tz * wu + tmp.tx * ww;
          let d = Math.atan2(wx, wz) - z.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); z.yaw += d * Math.min(1, dt * 8);
        }
        O.u = pt.u; O.w = pt.w;
      } else if (inRange) { // face the target
        let d = Math.atan2(target.pos.x - z.pos.x, target.pos.z - z.pos.z) - z.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); z.yaw += d * Math.min(1, dt * 8);
      }
      const inside = Math.abs(O.w) < T.width / 2;
      if (inside) O.deck = t.deckAt(O.u, O.w, O.deck | 0);
      O.y += ((inside ? t.floorAt(O.u, O.w, O.deck | 0) : 0) - O.y) * Math.min(1, dt * 10);
      t.walkToWorld(O.u, O.w, O.y, z.pos);
      z.group.rotation.set(0, z.yaw, 0);
      if (O.st === 'leave' && Math.abs(O.w) > W.outW) { z.onTrain = null; z.pos.y = 0; } // back on the platform (the station's floor region)
      return { inRange, moving };
    },
    // the coach body takes the blow (true), except a zombie inside or at an open door
    trainShield(target, z) {
      if (!trainOf(target)) return false;
      if (z.onTrain) return false;
      if (t.walkOpen()) { t.worldToWalk(z.pos.x, z.pos.z, loc); if (doorIndexAt(t.interior, loc.u, 0.55) >= 0 && Math.abs(loc.w) < T.width / 2 + Z.doorSpot + 0.6) return false; }
      return true;
    },
    // prompt standing in the train
    trainWalkHint() {
      const O = game.player.onTram;
      for (const c of t.interior.cab) if (Math.abs(O.u - c.u) < W.cabReach) return c.text;
      if (game.introHint?.() != null || t.speed > 0.5) return ''; // no walking hint while the train runs (v0.83.1)
      if (!t.walkOpen()) return `${game.binds.moveLabel()} : marcher · portes fermées`;
      return `${game.binds.moveLabel()} : marcher · train à quai, portes ouvertes : marchez vers une porte pour descendre`;
    },
  });
  world.trainGoal = (target, z) => game.trainGoal(target, z);
  world.trainZombieStep = (z, target, dt) => game.trainZombieStep(z, target, dt);
}
