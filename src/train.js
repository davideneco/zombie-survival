import * as THREE from 'three';
import { CONFIG } from './config.js';
import { coachLayout, trainMaterials, buildCoachGeometry, buildLocoGeometry, buildDoorLeaf, buildWindowGeometry, buildCabBlood } from './trainModel.js';
import { pushOut, doorIndexAt } from './tramInterior.js';

// =====================================================================
//  Regional train (v0.80.0) : a locomotive and CONFIG.train.coaches coaches on the intro route (railNet.js). Phase 2 : parked at quai 1,
//  doors open on the platform side. Players walk inside with the tram's walk frame (tramInterior.js : p.onTram, `walkFrame: true`).
//
//  Frames : the train is a position `s` (nose abscissa) on the route Track. Each vehicle is RIGID : its axis joins the route points at its
//  bogie pivots (s_c ± bogie / 2), its centre is their midpoint (a 24.5 m coach in a 190 m curve is up to 0.39 m off the curve).
//  Walk coordinates : u along the train from its middle (+ toward the nose, continuous across the gangways), w to the right of the
//  direction of travel ; (u, w) maps through the frame of the vehicle that holds u. Interior collision : boxes (u0, u1, w0, w1) per coach
//  (seats, side walls, vestibule partitions, end walls with the gangway opening, WC) ; only the current coach and its neighbours are tested.
//
//  Zombies (host) : a zombie of the station whose target stands in the train goes to the door spot nearest to it (trainGoal), steps in, then
//  walks the aisle in (u, w) (trainZombieStep) : the aisle is a corridor, no flow field needed. It leaves by a door when its target leaves.
//  The parked train sends nothing on the network : it is the same everywhere ; players use p_state (vh = TRAIN_ID, lx, ly, lz, lyw).
//  v0.81.0 (intro.js) : the train also MOVES (setPose(s, v), setDoors(f)) : its pose is a pure function of the intro clock, so it sends
//  nothing either. Coach lights follow it (`dyn` light sources), the collision boxes are updated in place, passengers get a camera sway.
//  v0.82.0 (rideZombies.js) : damage of the ride : saloon windows intact / cracked / broken (winSt, synced by the host : tn_win), the tail door
//  of the last coach forced open (tail, a function of the intro clock), blood on the locomotive's front (roadkills, tn_rk). The panes are their
//  own InstancedMeshes (pane, crack, shards). Zombies in the train always live in its frame (z.onTrain { u, w, y, st }) : they ride with it.
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
    this.floorY = this.railY + T.floor;  // walk floor (absolute)
    this.ceilY = this.railY + 3.0;        // inner ceiling (grenades)
    this.doorSide = route.platformSide;   // doors open on this side (+1 : right of the direction of travel)
    this.collision = opts.collision;
    this.state = 'ok'; this.v = 0; this.speed = 0;
    this.doors = { open: true, f: 1 };
    this.seats = []; // (no seats : tramInterior's seat code finds none)
    this.pos = new THREE.Vector3();
    // ---- vehicles : 0 locomotive, then the coaches (nose first)
    const lens = [T.loco, ...Array(T.coaches).fill(T.coach)];
    this.L = lens.reduce((a, b) => a + b, 0) + T.gap * T.coaches;
    let acc = 0;
    this.veh = lens.map((len, i) => {
      const uc = this.L / 2 - acc - len / 2; acc += len + T.gap;
      return { i, len, uc, loco: i === 0, bog: i === 0 ? T.locoBogie : T.bogie, x: 0, z: 0, tx: 1, tz: 0, yaw: 0 };
    });
    this.n = this.veh.length;
    // ---- interior (walk coordinates) per coach
    this.lay = coachLayout();
    this.interior = this.buildInterior();
    // ---- meshes
    this.buildMeshes(opts);
    // pooled lights : one cold LED light per coach ; `dyn` : the light pool follows them every frame (realworld.js) while the train moves
    const Lc = T.light;
    this.lights = this.veh.filter((v) => !v.loco).map((v) => ({ veh: v, x: 0, y: this.railY + Lc.y, z: 0, color: Lc.color, intensity: Lc.intensity, dist: Lc.dist, dyn: true }));
    for (const l of this.lights) opts.lightSources?.push(l);
    this._dynBoxes = this.veh.map(() => ({ x: 0, z: 0, w: 0, d: T.width, rot: 0, h: this.railY + T.height }));
    this.s = route.parkHeadS;
    this.apply();
    this.flickT = 0;
    // camera sway (local look) : roll (rad), bob (m) ; rail joints : distance since the last joint, pending wheel jolts (s)
    this.sway = { roll: 0, bob: 0, curve: 0, t: 0, jointD: 0, jolts: new Float32Array(8).fill(-1), kick: 0 };
    this.onJoint = null; // (speed) => void : rail joint under the train (intro.js plays the clack)
  }

  // ------------------------------------------------------------------ ride damage (v0.82.0) : windows, tail door, blood on the cab
  // window index : ((coach - 1) * 2 + (side > 0 ? 1 : 0)) * windows + k ; coach 1..n-1 (0 is the locomotive), side -1 left / +1 right
  winIndex(ci, sd, k) { return ((ci - 1) * 2 + (sd > 0 ? 1 : 0)) * this.lay.winU.length + k; }
  winOf(i, out) { const nW = this.lay.winU.length, q = Math.floor(i / nW); out.ci = Math.floor(q / 2) + 1; out.sd = q % 2 ? 1 : -1; out.k = i % nW; out.u = this.veh[out.ci].uc + this.lay.winU[out.k]; return out; }
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
  // collision lists around u : the coach of u and its neighbours
  walkLists(u, pass) {
    const k = this.moduleAt(u), out = this._wl || (this._wl = []);
    out.length = 0;
    for (let i = Math.max(1, k - 1); i <= Math.min(this.n - 1, k + 1); i++) { const c = this.interior.byCoach[i]; if (!c) continue; out.push(c.boxes, pass ? c.wallsOpen : c.wallsClosed); }
    if (!out.length) out.push(this.interior.boxes, this.interior.wallsClosed);
    return out;
  }
  // floor under a world point inside a coach (grenades), or null
  walkFloorAt(x, z) { const o = this._wg || (this._wg = {}); this.worldToWalk(x, z, o); return o.w !== 99 && Math.abs(o.w) < this.walkCfg.wall && o.u > this.interior.u0 && o.u < this.interior.u1 ? this.floorY : null; }
  get dynKey() { return 'train' + this.id; }

  buildInterior() {
    const T = CONFIG.train, W = T.walk, Lay = this.lay, h = Lay.h, side = this.doorSide;
    const all = { boxes: [], wallsClosed: [], wallsOpen: [], spans: [], seatSpots: [], byCoach: [], cab: [], u0: Infinity, u1: -Infinity, uEnd: 0 };
    const add = (list, u0, u1, w0, w1) => { const b = { u0, u1, w0, w1 }; list.push(b); return b; };
    const wo = W.wall, wt = W.wall + W.thick, gw = W.gangway / 2, pd = W.partitionDoor / 2;
    for (const v of this.veh) {
      if (v.loco) continue;
      const c = { boxes: [], wallsClosed: [], wallsOpen: [] }, uc = v.uc, first = v.i === 1, last = v.i === this.n - 1;
      // seats, WC
      for (const b of Lay.blocks) add(c.boxes, uc + b.u0, uc + b.u1, b.w0, b.w1);
      // vestibule partitions (door opening pd)
      for (const d of [-1, 1]) { const u = uc + d * Lay.P; add(c.boxes, u - 0.04, u + 0.04, pd, wo); add(c.boxes, u - 0.04, u + 0.04, -wo, -pd); }
      // ends : gangway opening (to the next coach) ; closed toward the locomotive and at the tail
      const uF = uc + h, uB = uc - h;
      if (first) { add(c.boxes, uF - 0.12, uF + 0.6, -wt, wt); all.cab.push({ u: uF - 0.1, text: 'Cabine de conduite — verrouillée' }); }
      else { add(c.boxes, uF - 0.12, uF + T.gap / 2 + 0.05, gw, wt); add(c.boxes, uF - 0.12, uF + T.gap / 2 + 0.05, -wt, -gw); }
      if (last) { add(c.boxes, uB - 0.6, uB + 0.12, -wt, wt); all.cab.push({ u: uB + 0.1, text: 'Porte d\'intercirculation — condamnée' }); }
      else { add(c.boxes, uB - T.gap / 2 - 0.05, uB + 0.12, gw, wt); add(c.boxes, uB - T.gap / 2 - 0.05, uB + 0.12, -wt, -gw); }
      // side walls (closed ; open at the platform-side doors)
      const spans = [-T.doorAt, T.doorAt].map((d) => [uc + d - T.doorWidth / 2, uc + d + T.doorWidth / 2]);
      const ext0 = uB - T.gap / 2, ext1 = uF + T.gap / 2;
      for (const sd of [-1, 1]) {
        const w0 = sd > 0 ? wo : -wt, w1 = sd > 0 ? wt : -wo;
        add(c.wallsClosed, ext0, ext1, w0, w1);
        if (sd !== side) { add(c.wallsOpen, ext0, ext1, w0, w1); continue; }
        let a = ext0;
        for (const [d0, d1] of spans) { add(c.wallsOpen, a, d0, w0, w1); a = d1; }
        add(c.wallsOpen, a, ext1, w0, w1);
      }
      all.spans.push(...spans);
      all.byCoach[v.i] = c;
      all.boxes.push(...c.boxes); all.wallsClosed.push(...c.wallsClosed); all.wallsOpen.push(...c.wallsOpen);
      all.u0 = Math.min(all.u0, uB + 0.15); all.u1 = Math.max(all.u1, uF - 0.15);
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
    const coach = buildCoachGeometry(), loco = buildLocoGeometry(), leaf = buildDoorLeaf(), nC = T.coaches;
    this.coachMeshes = [];
    for (const [k, mat] of Object.entries({ body: M.body, dark: M.dark, inside: M.inside, glass: M.glass, panel: M.panel, flicker: M.flicker, decal: M.decal })) {
      if (!coach[k]) continue;
      const im = new THREE.InstancedMesh(coach[k], mat, nC); im.name = 'train:coach:' + k;
      im.castShadow = false; im.receiveShadow = k !== 'glass' && k !== 'panel' && k !== 'flicker'; // (no shadow pass : the train stands in the shadow of the shed roof)
      im.userData.noTerrain = true;
      root.add(im); this.coachMeshes.push(im);
    }
    this.locoGroup = new THREE.Group(); this.locoGroup.name = 'train:loco'; root.add(this.locoGroup);
    for (const [k, mat] of Object.entries({ body: M.body, dark: M.dark, glass: M.glass, panel: M.panel })) {
      if (!loco[k]) continue;
      const m = new THREE.Mesh(loco[k], mat); m.castShadow = false; m.receiveShadow = k === 'body' || k === 'dark'; m.name = 'train:loco:' + k;
      this.locoGroup.add(m);
    }
    // door leaves : 2 per side per coach + the two closed end doors
    this.leafN = nC * 4 + 2;
    this.leafMeshes = [new THREE.InstancedMesh(leaf.leaf, M.body, this.leafN), new THREE.InstancedMesh(leaf.glass, M.glass, this.leafN)];
    for (const im of this.leafMeshes) { im.name = 'train:leaf'; im.castShadow = false; im.receiveShadow = true; root.add(im); }
    // per-vehicle carriers (avatars of teammates standing in the train are parented to them, see remote.js)
    this.mods = this.veh.map((v) => { const g = new THREE.Group(); g.name = 'train:carrier:' + v.i; root.add(g); return { g }; });
    // saloon windows (v0.82.0) : intact / cracked panes, cracks, shards of the broken ones ; lists of window indices per mesh (rebuilt on change)
    const wg = buildWindowGeometry(), nWin = (this.n - 1) * 2 * this.lay.winU.length;
    this.winSt = new Uint8Array(nWin); this.winDirty = true; this.winLists = [[], [], []];
    this.winMeshes = [[wg.pane, M.glass], [wg.crack, M.crack], [wg.shards, M.shards]].map(([g, m], i) => {
      const im = new THREE.InstancedMesh(g, m, nWin); im.name = 'train:window:' + ['pane', 'crack', 'shards'][i];
      im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; im.count = 0; im.userData.noTerrain = true; root.add(im); return im;
    });
    this.tail = 0;
    // blood on the locomotive's front (roadkills) : hidden decals, shown one after the other
    this.cabBlood = buildCabBlood().map((g) => { const m = new THREE.Mesh(g, M.decal); m.visible = false; m.name = 'train:cabBlood'; this.locoGroup.add(m); return m; });
    this.cabBloodN = 0;
  }
  // window instances : pane (state 0 intact, 1 cracked), crack (1), shards (2) ; matrices follow the coaches (no allocation)
  applyWindows() {
    if (!this.winMeshes) return;
    const L = this.winLists, Wd = CONFIG.train.width / 2 - 0.025, o = this._wo || (this._wo = {});
    if (this.winDirty) { for (const l of L) l.length = 0; this.winSt.forEach((st, i) => { if (st < 2) L[0].push(i); if (st === 1) L[1].push(i); if (st === 2) L[2].push(i); }); this.winDirty = false; }
    for (let m = 0; m < 3; m++) {
      const im = this.winMeshes[m], list = L[m];
      for (let j = 0; j < list.length; j++) {
        this.winOf(list[j], o);
        const v = this.veh[o.ci], c = Math.cos(v.yaw), s = Math.sin(v.yaw), lx = o.sd * Wd, lz = -(o.u - v.uc);
        _lq.setFromAxisAngle(_up, v.yaw); _lm.compose(_p.set(v.x + c * lx + s * lz, this.railY, v.z - s * lx + c * lz), _lq, _sc);
        im.setMatrixAt(j, _lm);
      }
      im.count = list.length; im.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ pose (rigid frames), meshes, collision
  apply() {
    const T = CONFIG.train, tr = this.track, a = this._a || (this._a = {}), b = this._b || (this._b = {});
    for (const v of this.veh) {
      const sc = this.s - (this.L / 2 - v.uc);
      tr.at(clamp(sc + v.bog / 2, 0, tr.L), a); tr.at(clamp(sc - v.bog / 2, 0, tr.L), b);
      let tx = a.x - b.x, tz = a.z - b.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      v.x = (a.x + b.x) / 2; v.z = (a.z + b.z) / 2; v.tx = tx; v.tz = tz; v.yaw = Math.atan2(-tx, -tz);
      this.mods[v.i].g.position.set(v.x, 0, v.z); this.mods[v.i].g.rotation.set(0, v.yaw, 0); this.mods[v.i].g.updateMatrixWorld();
    }
    const v0 = this.veh[0];
    this.pos.set(v0.x, this.railY, v0.z); this.yaw = v0.yaw;
    // coaches (instances), locomotive
    for (const v of this.veh) {
      _q.setFromAxisAngle(_up, v.yaw); _m.compose(_p.set(v.x, this.railY, v.z), _q, _sc);
      if (v.loco) { this.locoGroup.position.set(v.x, this.railY, v.z); this.locoGroup.rotation.set(0, v.yaw, 0); continue; }
      for (const im of this.coachMeshes) im.setMatrixAt(v.i - 1, _m);
    }
    for (const im of this.coachMeshes) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    this.applyDoors(); // (the leaves ride with the coaches)
    this.applyWindows();
    // coach lights follow their coach
    if (this.lights) for (const l of this.lights) { l.x = l.veh.x; l.z = l.veh.z; }
    // world collision : one oriented box per vehicle (dynamic : bullets and camera rays pass, see collision.js) ; no allocation (every frame)
    const D = this._dynBoxes;
    for (const v of this.veh) { const o = D[v.i]; o.x = v.x; o.z = v.z; o.w = v.len; o.rot = Math.atan2(v.tz, v.tx); }
    this.collision?.setDynamic(this.dynKey, D);
  }
  applyDoors() {
    const T = CONFIG.train, f = this.doors.f, Wd = T.width / 2, Lay = this.lay;
    let k = 0;
    const put = (v, u, w, rotY, sx = 1) => {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw); // vehicle local (w, -u) -> world
      const lx = w, lz = -(u - v.uc), wx = v.x + c * lx + s * lz, wz = v.z - s * lx + c * lz;
      _lq.setFromAxisAngle(_up, v.yaw + rotY); _ls.set(1, 1, sx);
      _lm.compose(_p.set(wx, this.railY, wz), _lq, _ls);
      for (const im of this.leafMeshes) im.setMatrixAt(k, _lm);
      k++;
    };
    for (const v of this.veh) {
      if (v.loco) continue;
      for (const sd of [-1, 1]) for (const d of [-1, 1]) {
        const open = sd === this.doorSide ? f : 0, uD = v.uc + d * T.doorAt;
        // plug door : out of the opening (0.07 m), then slides toward the coach centre
        put(v, uD - d * open * (T.doorWidth + 0.05), sd * (Wd - 0.03 + 0.07 * Math.min(1, open * 4)), sd > 0 ? 0 : Math.PI);
      }
    }
    // closed end doors : toward the locomotive (first coach) and at the tail (last coach), across the gangway opening
    const first = this.veh[1], last = this.veh[this.n - 1], sx = T.walk.gangway / T.doorWidth + 0.06;
    put(first, first.uc + Lay.h - 0.02, 0, Math.PI / 2, sx);
    put(last, last.uc - Lay.h + 0.02 + 0.06 * (this.tail || 0), (this.tail || 0) * 0.86, -Math.PI / 2 + 0.25 * (this.tail || 0), sx); // (forced open by the gangway zombies : shoved aside, v0.82.0)
    for (const im of this.leafMeshes) { im.count = k; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }

  update(dt, game) {
    // the coaches are InstancedMeshes : their bounding sphere spans the three coaches, so three.js frustum culling keeps them almost always ;
    // test each coach against the camera frustum instead (draw calls)
    const cam = game?.player?.camera;
    if (cam) {
      _fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let any = game.player?.onTram?.v === this; // standing inside : always drawn (the frustum is the last frame's : stale after a skip)
      if (!any) for (const v of this.veh) if (!v.loco) { _sph.center.set(v.x, this.railY + 2, v.z); _sph.radius = v.len / 2 + 1.5; if (_fr.intersectsSphere(_sph)) { any = true; break; } }
      for (const im of this.coachMeshes) im.visible = any;
      for (const im of this.leafMeshes) im.visible = any;
      if (this.winMeshes) for (const im of this.winMeshes) im.visible = any && im.count > 0;
    }
    // faulty LED strips : random flicker (local look only)
    const F = CONFIG.train.flicker;
    this.flickT -= dt;
    if (this.flickT <= 0) { this.flickT = (0.3 + Math.random()) / F.hz; this.mats.flicker.emissiveIntensity = Math.random() < F.rate ? 0.04 : 0.4 + Math.random() * 0.8; }
    this.updateSway(dt);
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
    // rail joints : the wheelsets of a coach cross a joint at 0, axle, bogie, bogie + axle m
    if (sp > 0.3) {
      S.jointD += sp * dt;
      if (S.jointD >= W.joint) {
        S.jointD -= W.joint;
        const J = S.jolts, B = CONFIG.train.bogie, off = this._joff || (this._joff = [0, W.axle, B, B + W.axle]);
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
        z.onTrain = { v: t, u: clamp(loc.u, sp[0] + Z.radius, sp[1] - Z.radius), w: loc.w, y: z.pos.y, door: (sp[0] + sp[1]) / 2, st: 'enter' };
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
      let du = gu - O.u, dw = gw - O.w;
      if (aisle && Math.abs(O.w) > 0.12) { du = Math.sign(du) * Math.min(Math.abs(du), 0.35); dw = -O.w * 3; } // back to the aisle first (seats, partition doors, gangways : all open at w = 0)
      const dl = Math.hypot(du, dw);
      const inRange = !!tgtIn && O.st === 'in' && Math.hypot(target.pos.x - z.pos.x, target.pos.z - z.pos.z) < CONFIG.zombie.attackRange && Math.abs(target.pos.y - z.pos.y) < 2.4;
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
        pushOut(t.walkLists(pt.u, O.st !== 'in'), pt, Z.radius);
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
      O.y += ((inside ? t.floorY : 0) - O.y) * Math.min(1, dt * 10);
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
      const intro = game.introHint?.(); // the intro ride : speed, skip (intro.js)
      if (intro) return intro;
      for (const c of t.interior.cab) if (Math.abs(O.u - c.u) < W.cabReach) return c.text;
      if (t.speed > 0.5) return `${game.binds.moveLabel()} : marcher · train en marche (${Math.round(t.speed * 3.6)} km/h)`;
      if (!t.walkOpen()) return `${game.binds.moveLabel()} : marcher · portes fermées`;
      return `${game.binds.moveLabel()} : marcher · train à quai, portes ouvertes : marchez vers une porte pour descendre`;
    },
  });
  world.trainGoal = (target, z) => game.trainGoal(target, z);
  world.trainZombieStep = (z, target, dt) => game.trainZombieStep(z, target, dt);
}
