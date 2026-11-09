import * as THREE from 'three';
import { CONFIG } from './config.js';
import { carGeometries, atlas, HDF } from './hommedefer.js';
import { patchMaterial } from './terrain.js';
import { findSafeSpot } from './debugMenu.js';
import { interiorOf } from './tramInterior.js';
import { buildTransferRoute, buildTrip, buildCall, speedLimit } from './transferRoute.js';
import { buildTransferScene } from './transferScene.js';

// =====================================================================
//  Tram transfer (v0.79.0) between the CTS stop « Gare Centrale » on Place de la Gare (real line C track) and the B / C / F platform of
//  Homme de Fer on the Grande Île.
//  - A CTS ticket terminal at each stop : [E] calls the tram. Host decides (clients send xf_req) and broadcasts xf_call (countdown), then
//    xf_go with the ids of every standing player near the car (or the terminal) : they ride to the other stop, whose zone opens.
//  - When the last player leaves an area, the host moves its zombies to the arrival stop (z_reloc with their new floor region).
//  v0.83.0 : a RENDERED ride along the real line C (transferRoute.js : station stop track -> OSM line C -> the island's B / C / F track).
//    The car is a walk frame like the trams (tramInterior.js : p.onTram, `walkFrame: true`) : riders stand in it, walk and turn, the doors stay
//    closed until the arrival stop ; teammates' avatars ride with it (p_state vh = XF_ID, remote.js). Its pose is a PURE function of the time since
//    xf_call / xf_go (transferRoute.js buildCall / buildTrip) : every client computes the same ride, nothing else is sent. Two short cuts (dips to
//    black, riders only) compress the ~1 km ; the first one hides the switch between the drawn areas. Riders are safe (xfSafe : no zombie targets
//    them, spawns avoid them, no damage) from the departure to the stop. At Homme de Fer the car stops at the first slot clear of the island's
//    drivable tram (host decides : xf_call / xf_go carry it). Doors open on the platform side ; after `dwell` s the riders still aboard are put on
//    the platform, the car drives off and is hidden.
//  Local only : the camera ride, the fades, the titles and the passenger display, the rolling sound, the sway.
// =====================================================================

export const XF_ID = 950;
const STATE = { idle: 0, call: 1, go: 2 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ the transfer car : a CTS car (shared geometries) on the route, a walk frame
class XfCar {
  constructor(route, { scene, lightSources, collision, world }) {
    const X = CONFIG.transfer, T = CONFIG.tram;
    this.id = XF_ID; this.type = 'xfTram'; this.walkFrame = true; this.isTram = false; this.isTrain = false; this.xfCar = true;
    this.route = route; this.track = route.track; this.world = world; this.collision = collision;
    this.state = 'gone'; this.s = route.sGare; this.v = 0; this.speed = 0; this.seats = [];
    this.doors = { open: false, f: 0 }; this.doorSide = 1;
    this.walkCfg = { ...T.walk, boardSpeed: X.walk.boardSpeed, outW: X.walk.outW };
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.sway = { roll: 0, bob: 0, t: 0 };
    this.hint = null;
    const C = carGeometries(), A = atlas('car');
    this.n = C.modules.length; this.M = HDF.tram.module; this.L = this.n * this.M;
    // interior : seat blocks, cab desks, ends, side walls (tramInterior.js) ; no seat to sit on (the car is not a vehicle)
    const I = this.interior = interiorOf({ L: this.L, M: this.M, n: this.n, model: { seats: C.seats } });
    I.seatSpots = [];
    const sideOf = (b) => Math.sign(b.w0 + b.w1);
    I.openBySide = { 1: [], '-1': [] };
    for (const sd of [1, -1]) I.openBySide[sd] = [...I.wallsOpen.filter((b) => sideOf(b) === sd), ...I.wallsClosed.filter((b) => sideOf(b) !== sd)];
    this._wl = [I.boxes, I.wallsClosed];
    // meshes : own materials (not displaced by the terrain shader : the car carries its own heights, bridge included)
    const body = A.mat.clone(); body.userData.terrainPatched = true;
    const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6, emissive: 0x2a2620 }); dark.userData.terrainPatched = true;
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8d0ea, transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.12, depthWrite: false, side: THREE.DoubleSide }); glass.userData.terrainPatched = true;
    this.mats = { body, dark, glass };
    this.group = new THREE.Group(); this.group.name = 'transfer:tram'; this.group.visible = false; this.group.userData.noTerrain = true;
    this.mods = C.modules.map((m) => {
      const g = new THREE.Group(), inner = new THREE.Group(); inner.rotation.y = Math.PI / 2; g.add(inner);
      const meshes = [new THREE.Mesh(m.body, body), new THREE.Mesh(m.dark.clone(), dark), new THREE.Mesh(m.glass.clone(), glass)];
      for (const o of meshes) { o.frustumCulled = false; o.receiveShadow = true; o.castShadow = false; o.userData.noTerrain = true; inner.add(o); }
      const base = (geo, leaves) => { const p = geo.attributes.position, a = new Float32Array(leaves.reduce((s, l) => s + l.n, 0)); let k = 0; for (const l of leaves) for (let v = 0; v < l.n; v++) a[k++] = p.getX(l.v0 + v); return a; };
      this.group.add(g);
      return { g, dark: meshes[1], glass: meshes[2], leaves: m.leaves, glassLeaves: m.glassLeaves || [], base: base(meshes[1].geometry, m.leaves), baseG: base(meshes[2].geometry, m.glassLeaves || []), f: -1, side: 0 };
    });
    scene.add(this.group);
    const Lc = X.light;
    this.light = { x: 0, y: Lc.y, z: 0, color: Lc.color, intensity: Lc.intensity, dist: Lc.dist, off: true, dyn: true };
    lightSources?.push(this.light);
    this._dyn = this.mods.map(() => ({ x: 0, z: 0, w: HDF.tram.body, d: HDF.tram.width, rot: 0, h: HDF.tram.height }));
    this._o = {}; this._o2 = {}; this._wp = {};
  }

  // ---- walk API (tramInterior.js, remote.js, main.js) : u along the car from its middle (+ : the direction of growing s), w to the right
  get usable() { return this.state === 'ok'; }
  get hpFrac() { return 1; }
  get dynKey() { return 'xf'; }
  get walkRegion() { const g = this.world.gare; return g && this.world.areaOf(this.pos.x, this.pos.z) === 'gare' ? g.region : 0; }
  walkOpen() { return this.doors.f >= this.walkCfg.doorOpen && Math.abs(this.v) <= this.walkCfg.boardSpeed; }
  frame(u, out) { return this.track.at(clamp(this.s + u, 0, this.track.L), out); }
  walkToWorld(u, w, y, out) { const o = this._o2; this.frame(u, o); out.x = o.x - o.tz * w; out.z = o.z + o.tx * w; out.y = y; return out; }
  worldToWalk(x, z, out) { const r = this.track.project(x, z, 10, this._wp); out.u = r.s - this.s; out.w = r.d === Infinity ? 99 : r.side * r.d; return out; }
  walkBounds(x, z) { return this.state === 'ok' && Math.abs(x - this.pos.x) < 20 && Math.abs(z - this.pos.z) < 20; }
  walkLists(u, pass) { this._wl[1] = pass ? this.interior.openBySide[this.doorSide] : this.interior.wallsClosed; return this._wl; }
  walkGround(u) { return this.route.heightAt(this.s + u); }
  walkHint() { return this.hint ? this.hint() : ''; }
  moduleAt(u) { return clamp(Math.floor((u + this.L / 2) / this.M), 0, this.n - 1); }
  moduleU(i) { return -this.L / 2 + this.M / 2 + i * this.M; }

  // pose : centre abscissa s, signed speed v, doors 0..1 (they open on doorSide)
  place(s, v, doors) {
    const o = this._o, tr = this.track, H = this.route.heightAt;
    this.s = s; this.v = v; this.speed = Math.abs(v); this.state = 'ok';
    for (let i = 0; i < this.n; i++) {
      const m = this.mods[i], si = s + this.moduleU(i);
      tr.at(clamp(si, 0, tr.L), o);
      m.g.position.set(o.x, H(si), o.z); m.g.rotation.set(0, o.yaw, 0);
      const d = this._dyn[i]; d.x = o.x; d.z = o.z; d.rot = Math.atan2(o.tz, o.tx);
      if (Math.abs(m.f - doors) > 1e-3 || m.side !== this.doorSide) {
        m.f = doors; m.side = this.doorSide;
        for (const [mesh, leaves, base] of [[m.dark, m.leaves, m.base], [m.glass, m.glassLeaves, m.baseG]]) {
          const p = mesh.geometry.attributes.position; let k = 0;
          for (const l of leaves) { const f = l.side === this.doorSide ? doors : 0; for (let q = 0; q < l.n; q++) p.setX(l.v0 + q, base[k++] + l.dir * f * 0.62); }
          p.needsUpdate = true;
        }
      }
    }
    this.doors.f = doors; this.doors.open = doors >= this.walkCfg.doorOpen;
    tr.at(s, o); this.pos.set(o.x, H(s), o.z); this.yaw = o.yaw;
    this.light.x = o.x; this.light.y = H(s) + CONFIG.transfer.light.y; this.light.z = o.z; this.light.off = false;
    this.group.visible = true;
    this.collision?.setDynamic?.('xf', this._dyn);
  }
  hide() {
    this.state = 'gone'; this.v = 0; this.speed = 0; this.group.visible = false; this.light.off = true;
    this.collision?.setDynamic?.('xf', []);
  }
  // camera sway of a standing rider (local look) : slow roll and bob growing with speed
  updateSway(dt) {
    const W = CONFIG.transfer.sway, S = this.sway, k = Math.min(1, this.speed / W.refSpeed);
    S.t += dt;
    S.roll = k * W.roll * (Math.PI / 180) * (Math.sin(S.t * Math.PI * W.hz) + 0.3 * Math.sin(S.t * 2 * Math.PI * W.hz * 1.3 + 0.7));
    S.bob = k * W.bob * Math.sin(S.t * 2 * Math.PI * W.hz);
  }
}

export function installTransfer(game, { world, hud, sfx, scene }) {
  const X = CONFIG.transfer, gare = world.gare;
  if (!gare || !X) return;
  const _o = {}, _p = {}, tmp = { x: 0, y: 0, z: 0 }, loc = { u: 0, w: 0 };

  // ---------------------------------------------------------------- the route (station stop track -> line C -> island B / C / F)
  const hTrack = world.tram?.net?.byId?.[X.hdf.line];
  const hStop = hTrack?.stops?.find((s) => s.name === X.hdf.stop);
  const tramC = gare.rail?.routes?.tramC;
  const P = gare.plan;
  if (!hTrack || !hStop || !tramC) { console.warn('[transfer] route data missing (rail.routes.tramC, island line B / C / F) : no tram transfer'); return; }
  const gTrackPts = P.stop.track;
  let railsEnd = gTrackPts[gTrackPts.length - 1];
  for (const q of gTrackPts) if (P.L(q[0], q[1])[1] >= 95) { railsEnd = q; break; } // (gare/build.js draws the C rails for v < 95 of its frame)
  const route = buildTransferRoute({ gare: { track: gTrackPts, at: P.stop.at, railsEnd }, tramC, bcf: hTrack, bcfStopS: hStop.s, terrainY: world.terrainY, R: X.route });
  const passStop = route.stops.find((s) => (s.name || '').startsWith(X.middle.pass)) || null;
  const bridge = passStop ? route.bridges.find((b) => b.s0 > passStop.s) : null;
  const vlim = speedLimit(route, X.drive, passStop?.s ?? null);

  // ---------------------------------------------------------------- stops
  const zi = (name) => world.zoneNames.indexOf(name);
  const stops = {
    gare: { id: 'gare', name: 'Gare Centrale', dest: 'hdf', sStop: route.sGare, legs: X.legs.gare, zone: zi('Place de la Gare'), area: 'gare', title: 'GARE CENTRALE', sub: 'Place de la Gare — tram C' },
    hdf: { id: 'hdf', name: 'Homme de Fer', dest: 'gare', sStop: route.sHdf, legs: X.legs.hdf, zone: zi('Homme de Fer'), area: 'island', title: 'HOMME DE FER', sub: 'Quai B · C · F' },
  };
  // terminal spots : gare (east CTS platform, beside the stop), Homme de Fer (platform beside the stop, checked free)
  {
    const [x, z] = P.W(P.stop.l[0] + 3.6, P.stop.l[1] - 3.2), yaw = Math.atan2(-P.frame.ux, -P.frame.uz);
    stops.gare.terminal = { x, z, yaw };
  }
  {
    const t = hTrack, probe = { x: 0, y: 0.1, z: 0 }, out = { push: 0 };
    let best = null;
    for (const ds of [X.hdf.terminal, -X.hdf.terminal, X.hdf.terminal + 4, -X.hdf.terminal - 4, 0]) for (const side of [X.hdf.side, -X.hdf.side]) for (const off of [2.9, 3.4, 4.0]) {
      if (best) break;
      t.at(hStop.s + ds, _o);
      const x = _o.x - _o.tz * off * side, z = _o.z + _o.tx * off * side;
      probe.x = x; probe.y = 0.1; probe.z = z; out.push = 0; world.collision.resolve(probe, 0.5, out);
      if (out.push < 0.02 && !world.nav.isBlockedAt(x, z)) best = { x, z, yaw: Math.atan2(_o.tz * side, -_o.tx * side) };
    }
    t.at(hStop.s, _o);
    stops.hdf.terminal = best || { x: _o.x - _o.tz * 3 * X.hdf.side, z: _o.z + _o.tx * 3 * X.hdf.side, yaw: 0 };
  }

  // ---------------------------------------------------------------- terminal model (CTS ticket machine, emissive screen) + collision
  const screenTex = (dest) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 192;
    const x = c.getContext('2d');
    x.fillStyle = '#05080c'; x.fillRect(0, 0, 256, 192);
    x.fillStyle = '#d8452b'; x.fillRect(0, 0, 256, 34);
    x.fillStyle = '#fff'; x.font = 'bold 22px Arial'; x.fillText('CTS — TRAM', 12, 25);
    x.fillStyle = '#9fd0ff'; x.font = 'bold 20px Arial'; x.fillText('Direction', 12, 70);
    x.fillStyle = '#ffffff'; x.font = 'bold 30px Arial'; x.fillText(dest, 12, 108, 232);
    x.fillStyle = '#ffd24a'; x.font = '18px Arial'; x.fillText('Appuyer pour appeler', 12, 150);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const cab = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.55, metalness: 0.55 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: 0.4, metalness: 0.7 });
  const makeTerminal = (st) => {
    const g = new THREE.Group();
    const body = new THREE.Shape(); body.moveTo(-0.32, 0); body.lineTo(0.32, 0); body.lineTo(0.32, 1.62); body.quadraticCurveTo(0.32, 1.78, 0.16, 1.8); body.lineTo(-0.16, 1.8); body.quadraticCurveTo(-0.32, 1.78, -0.32, 1.62); body.lineTo(-0.32, 0);
    const bg = new THREE.ExtrudeGeometry(body, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 8 }); bg.translate(0, 0, -0.21);
    g.add(new THREE.Mesh(bg, cab));
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.16), trim); hood.position.set(0, 1.5, 0.27); hood.rotation.x = 0.3; g.add(hood);
    const scr = new THREE.MeshStandardMaterial({ map: screenTex(stops[st.dest] ? stops[st.dest].name : '—'), emissive: 0xffffff, roughness: 0.3 }); scr.emissiveMap = scr.map; scr.emissiveIntensity = 0.85;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.34), scr); screen.position.set(0, 1.22, 0.235); screen.rotation.x = -0.12; g.add(screen);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.04), trim); pad.position.set(0, 0.86, 0.23); pad.rotation.x = -0.35; g.add(pad);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 2 })); lamp.position.set(0.22, 1.62, 0.24); g.add(lamp);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(st.terminal.x, 0, st.terminal.z); g.rotation.y = st.terminal.yaw;
    (st.id === 'gare' ? gare.root : scene).add(g);
    if (st.id !== 'gare') for (const m of [cab, trim]) patchMaterial(m); // island : the terrain shader
    world.collision.addBox(st.terminal.x, st.terminal.z, 0.7, 0.5, -st.terminal.yaw, 1.8);
  };
  for (const st of Object.values(stops)) makeTerminal(st);

  // ---------------------------------------------------------------- the car, the line C scenery
  const car = new XfCar(route, { scene, lightSources: world.lightSources, collision: world.collision, world });
  const sceneSplit = route.sGare + 140; // near : seen from the station's forecourt ; far : from the island side
  let sc = null;
  try { sc = buildTransferScene({ route, collision: world.collision, passStop, split: sceneSplit }); scene.add(sc.near, sc.far); }
  catch (e) { console.warn('[transfer] scenery', e); }
  const baseRide = game.rideById.bind(game);
  game.rideById = (id) => (id === XF_ID ? car : baseRide(id));
  const baseFrames = game.walkFrames ? game.walkFrames.bind(game) : () => game.trams;
  const frames = [];
  game.walkFrames = () => { const b = baseFrames(); if (!car.usable) return b; frames.length = 0; for (const t of b) frames.push(t); frames.push(car); return frames; };

  // ---------------------------------------------------------------- overlays : fade (riders, at the cuts), passenger display
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40';
  const subEl = document.createElement('div');
  subEl.style.cssText = 'position:fixed;left:50%;bottom:21%;transform:translateX(-50%);max-width:min(760px,86vw);padding:7px 16px;background:rgba(4,10,18,0.72);border-left:3px solid #2b6fd8;color:#e8f0ff;font:bold 17px Arial,sans-serif;letter-spacing:0.6px;pointer-events:none;z-index:37;display:none';
  document.body.appendChild(fadeEl); document.body.appendChild(subEl);
  let subT = 0, fadeO = 0;
  const showSub = (text, dur) => { subEl.textContent = text; subEl.style.display = 'block'; subT = dur; };
  const setFade = (f) => { if (Math.abs(f - fadeO) > 0.004 || (f === 0 && fadeO !== 0)) { fadeO = f; fadeEl.style.opacity = String(f); } };

  // ---------------------------------------------------------------- state (same on every client : driven by xf_call / xf_go)
  // dep / arr : slots (m along the track from the stop) of the departure and arrival positions
  const S = { stop: null, state: STATE.idle, t: 0, dep: 0, arr: 0, call: null, trip: null, pids: [], leaving: new Set(), ev: {}, sound: null, legs: null };
  const pose = { s: 0, v: 0, doors: 0, fade: 0, ph: '', leg: -1 };
  const myId = () => game.net?.id ?? 0;
  const dirOf = (st) => Math.sign(stops[st.dest].sStop - st.sStop) || 1; // direction of travel from st toward its destination
  const stopNear = (x, z, r) => { for (const st of Object.values(stops)) if (Math.hypot(x - st.terminal.x, z - st.terminal.z) < r) return st; return null; };
  const isRider = () => !!game.xfRide;

  // platform side of a stop position : the side with the most free probe points beside the car
  const probe = { x: 0, y: 0.1, z: 0 }, probeOut = { push: 0 };
  const sideAt = (s, pref = 1) => {
    const score = { 1: 0, '-1': 0 };
    for (const sd of [1, -1]) for (let u = -9; u <= 9; u += 4.5) {
      route.track.at(s + u, _o);
      const x = _o.x - _o.tz * sd * 2.4, z = _o.z + _o.tx * sd * 2.4;
      probe.x = x; probe.y = 0.1; probe.z = z; probeOut.push = 0; world.collision.resolve(probe, 0.4, probeOut);
      if (probeOut.push < 0.05 && !(world.navAt?.(x, z) || world.nav).isBlockedAt(x, z)) score[sd]++;
    }
    if (score[pref] >= 3) return pref; // (the terminal's side when it is a platform : players waiting there walk straight in)
    return score[1] === score[-1] ? pref : score[1] > score[-1] ? 1 : -1;
  };
  // side of the track (+1 : right of growing s) where the terminal of a stop stands
  const termSide = (st) => { const r = route.track.project(st.terminal.x, st.terminal.z, 30, _p); return r.d < Infinity ? r.side : 1; };
  // host : Homme de Fer slot clear of the island's drivable tram(s) (its stop is the drivable tram's parking spot)
  const hdfSlot = () => {
    const L = car.L, hw = L / 2;
    for (const slot of X.hdf.slots) {
      const a = route.sHdf + slot - hw - Math.max(X.legs.hdf.arrive, X.legs.hdf.depart) - X.hdf.clear, b = route.sHdf + slot + hw + X.hdf.clear;
      let ok = true;
      for (const t of game.trams || []) {
        const q = route.track.project(t.pos.x, t.pos.z, 4, _p);
        if (q.d < 3 && q.s + t.L / 2 > a && q.s - t.L / 2 < b) { ok = false; break; }
      }
      if (ok) return slot;
    }
    return X.hdf.slots[X.hdf.slots.length - 1];
  };
  const slotFor = (st) => (st.id === 'hdf' ? hdfSlot() : 0);

  // trip legs from st (departure slot dep) to its destination (slot arr) : departure, middle stretch, arrival
  const tripOf = (st, dep, arr) => {
    const dest = stops[st.dest], dir = dirOf(st), sDep = st.sStop + dep, sArr = dest.sStop + arr;
    const legs = [{ s0: sDep, s1: sDep + dir * st.legs.depart, v0: 0, v1: null }];
    if (passStop && bridge) {
      const a = passStop.s - X.middle.before, b = (bridge.water[0] + bridge.water[1]) / 2 + X.middle.after;
      legs.push(dir > 0 ? { s0: a, s1: b, v0: null, v1: null } : { s0: b, s1: a, v0: null, v1: null });
    }
    legs.push({ s0: sArr - dir * dest.legs.arrive, s1: sArr, v0: null, v1: 0 });
    return buildTrip(route, legs, vlim, X);
  };

  // ---------------------------------------------------------------- local player : board, ride, step off
  const ejectLocal = () => { // put the local player on the platform beside the nearest door (the car leaves, or a non-rider stood in it)
    const p = game.player, O = p.onTram;
    if (!O || O.v !== car) return;
    let best = 0, bd = Infinity;
    for (const sp of car.interior.spans) { const u = (sp[0] + sp[1]) / 2, d = Math.abs(u - O.u); if (d < bd) { bd = d; best = u; } }
    car.walkToWorld(best, car.doorSide * (HDF.tram.width / 2 + 0.8), 0, tmp);
    game.tramWalkOff();
    const fl = world.floorAt(tmp.x, tmp.z, 3, { y: 0, region: 0 });
    const spot = findSafeSpot(world, { x: tmp.x, y: fl.y, z: tmp.z }, fl.region) || { x: tmp.x, y: fl.y, z: tmp.z };
    p.pos.set(spot.x, spot.y, spot.z); p.vel.set(0, 0, 0); p.vy = 0;
    world.collide(p.pos, CONFIG.player.radius);
    game.sendPlayerState?.();
  };

  function startCall(stopId, dep = 0) {
    const st = stops[stopId]; if (!st) return;
    S.stop = st; S.state = STATE.call; S.t = 0; S.dep = dep; S.ev = {};
    car.doorSide = sideAt(st.sStop + dep, termSide(st));
    S.call = buildCall(route, st.sStop + dep, 1, X.approach, X.countdown - X.doorTime - 0.4, vlim, X);
    const p = game.player;
    if (Math.hypot(p.pos.x - st.terminal.x, p.pos.z - st.terminal.z) < 40) { hud.announce('TRAM C', `Direction ${stops[st.dest].name} — départ dans ${X.countdown} s, montez à bord`, 3200); sfx.buy?.(); sfx.tramBell?.(0.55); }
  }
  function startGo(stopId, pids, dep, arr) {
    const st = stops[stopId]; if (!st) return;
    S.stop = st; S.state = STATE.go; S.t = 0; S.dep = dep; S.arr = arr; S.pids = pids.slice(); S.leaving = new Set(pids); S.ev = {};
    S.trip = tripOf(st, dep, arr);
    const me = myId(), p = game.player;
    car.place(st.sStop + dep, 0, 1);
    if (pids.includes(me) && !p.downed && !p.dead) {
      if (p.vehicle) game.leaveVehicle?.();
      if (p.onTram && p.onTram.v !== car) game.tramWalkOff();
      if (!p.onTram) { const slot = pids.indexOf(me), n = pids.length; game.placeInTram(car, clamp((slot - (n - 1) / 2) * 2.4, -car.L / 2 + 3, car.L / 2 - 3), 0); p.yaw = p.onTram.fy + (dirOf(st) > 0 ? 0 : Math.PI); }
      game.xfRide = { stop: st, safe: true };
      p.vel.set(0, 0, 0);
      S.sound?.stop(); S.sound = sfx.createTramEngine?.() || null;
      sfx.tramDoors?.(false, 0.75);
    } else if (p.onTram?.v === car) ejectLocal(); // (not taken : off the car)
  }
  // the car stops at the arrival stop : zone open (every client), riders' title, host : the zombies left behind follow
  function arrive() {
    const st = S.stop, dest = stops[st.dest];
    car.doorSide = sideAt(dest.sStop + S.arr, termSide(dest));
    if (S.pids.length && dest.zone >= 0) world.setZoneOpen?.(dest.zone, true);
    if (game.xfRide) {
      game.xfRide.safe = false;
      hud.announce(dest.title, dest.sub, 3500);
      sfx.tramBell?.(0.6);
      sfx.tramDoors?.(true, 0.85);
      game.sendPlayerState?.();
    }
    if (!game.isClient && S.pids.length) hostFollow(st.area, dest.id);
  }
  function finish() {
    if (car.usable && game.player.onTram?.v === car) ejectLocal();
    S.state = STATE.idle; S.stop = null; S.trip = null; S.call = null; game.xfRide = null;
    S.sound?.stop(); S.sound = null;
    car.hide();
    setFade(0);
  }

  // host : when nobody is left in an area, its zombies follow the players (relocated near the arrival stop, with their new floor region)
  function hostFollow(fromArea, destId) {
    if (game.isClient) return;
    const players = [[myId(), game.player], ...game.remotes.entries()];
    if (players.some(([id, pl]) => !pl.dead && !S.leaving.has(id) && world.areaOf(pl.pos.x, pl.pos.z) === fromArea)) return;
    const dest = stops[destId], a = dest.terminal, reg = world.regionAt(a.x, a.z);
    for (const z of game.zombies) {
      if (z.dead || z.isBoss || z.onTrain || world.areaOf(z.pos.x, z.pos.z) !== fromArea) continue;
      const g = world.pickGround(a.x, a.z, 14, 40);
      if (!g) continue;
      z.startSpawn({ type: 'ground', pos: g }); z.region = reg; z.link = null;
      game.net?.send({ t: 'z_reloc', id: z.id, x: g.x, z: g.z, region: reg });
    }
  }

  // aboard at the departure (host) : standing in the car, beside it, or at the terminal
  const aboard = (st, pl) => {
    if (pl === game.player && pl.onTram?.v === car) return true;
    if (pl.tr?.id === XF_ID) return true;
    if (Math.hypot(pl.pos.x - st.terminal.x, pl.pos.z - st.terminal.z) < X.boardRadius) return true;
    const r = route.track.project(pl.pos.x, pl.pos.z, X.boardRadius + 2, _p);
    return r.d <= X.boardRadius && Math.abs(r.s - car.s) <= car.L / 2 + 2;
  };

  // hint while standing in the car
  car.hint = () => {
    const st = S.stop, dest = st ? stops[st.dest] : null, mv = game.binds.moveLabel();
    if (S.state === STATE.call && st) return `Tram C direction ${dest.name} — départ dans ${Math.max(0, Math.ceil(X.countdown - S.t))} s`;
    if (S.state === STATE.go && S.trip && S.t < S.trip.tArrive) return ''; // no hint during the ride (v0.83.1)
    if (car.walkOpen()) return `${mv} : marcher · ${dest ? dest.name : 'terminus'} — portes ouvertes : marchez vers une porte pour descendre`;
    return `${mv} : marcher · portes fermées`;
  };

  Object.assign(game, {
    transfer: { stops, S, car, route, scene: sc, aboard: (pos) => S.stop && aboard(S.stop, { pos }), tripOf, passStop, bridge },
    nearTransfer() {
      const p = this.player;
      if (p.vehicle || p.downed || p.dead || this.xfRide || p.onTram) return null;
      return stopNear(p.pos.x, p.pos.z, X.reach);
    },
    transferPrompt() {
      const st = this.nearTransfer(), dest = stops[st.dest];
      if (!dest) return 'Tram hors service';
      if (S.stop === st && S.state === STATE.call) return `Départ dans ${Math.max(0, Math.ceil(X.countdown - S.t))} s — montez à bord`;
      if (S.state !== STATE.idle) return S.stop === st && S.state === STATE.go && S.trip && S.t < X.doorTime + 2 ? 'Le tram part…' : 'Tram en service — patientez';
      const cd = st.cool || 0;
      if (cd > 0) return `Prochain tram dans ${Math.ceil(cd)} s`;
      return `${this.binds.tag('interact')} Appeler le tram — Direction ${dest.name}${X.price ? ` (${X.price} pts)` : ''}`;
    },
    useTransfer() {
      const st = this.nearTransfer(); if (!st || !stops[st.dest]) return;
      if (S.state !== STATE.idle || (st.cool || 0) > 0) { sfx.deny(); return; }
      if (X.price) { if (this.points < X.price) { sfx.deny(); return; } this.points -= X.price; }
      if (this.isClient) this.net?.send({ t: 'xf_req', stop: st.id });
      else this.hostCallTransfer(st.id);
    },
    hostCallTransfer(stopId) {
      const st = stops[stopId];
      if (!st || !stops[st.dest] || S.state !== STATE.idle || (st.cool || 0) > 0) return;
      const dep = slotFor(st);
      this.net?.send({ t: 'xf_call', stop: stopId, dep });
      startCall(stopId, dep);
    },
    // per frame, before the player moves (main.js)
    updateTransfer(dt) {
      for (const st of Object.values(stops)) if (st.cool > 0) st.cool -= dt;
      const p = this.player;
      if (S.state === STATE.call) {
        S.t += dt;
        S.call.pose(S.t, pose); car.place(pose.s, pose.v, pose.doors);
        if (!S.ev.callStop && pose.doors > 0.05) {
          S.ev.callStop = 1;
          const d = Math.hypot(p.pos.x - S.stop.terminal.x, p.pos.z - S.stop.terminal.z);
          if (d < 45) { const v = Math.max(0.2, 1 - d / 45); sfx.tramBell?.(0.6 * v); sfx.tramDoors?.(true, 0.75 * v); }
        }
        if (S.t >= X.countdown && !this.isClient) { // host : who boards, where the car stops
          const st = S.stop, players = [[myId(), p], ...this.remotes.entries()];
          const pids = players.filter(([, pl]) => pl && !pl.dead && !pl.downed && aboard(st, pl)).map(([id]) => id);
          const arr = slotFor(stops[st.dest]);
          this.net?.send({ t: 'xf_go', stop: st.id, pids, dep: S.dep, arr });
          startGo(st.id, pids, S.dep, arr);
          st.cool = X.cooldown;
        }
      } else if (S.state === STATE.go) {
        S.t += dt;
        const T = S.trip, st = S.stop, dest = stops[st.dest];
        T.pose(S.t, pose);
        if (pose.ph === 'gone') finish();
        else {
          car.place(pose.s, pose.v, pose.doors);
          const R = this.xfRide;
          // events (once each)
          if (!S.ev.dep && S.t >= X.doorTime) {
            S.ev.dep = 1;
            if (R) {
              showSub(`Tram C — direction ${dest.name}`, 4);
              sfx.tramBell?.(0.65);
              sfx.paAnnounce?.(dest.id === 'gare' ? 'tram_dep_gare' : 'tram_dep_hdf', 0.9, { at: 0.65 });
            }
          }
          if (!S.ev.pass && passStop && pose.leg === 1 && (pose.s - passStop.s) * Math.sign(pose.v || 1) > X.announce.passAfter) {
            S.ev.pass = 1;
            if (R) {
              showSub(`Prochain arrêt : ${dest.name}`, 5);
              sfx.trainChime?.(0.5);
              sfx.paAnnounce?.(dest.id === 'gare' ? 'tram_arr_gare' : 'tram_arr_hdf', 0.9, { at: 0.95 });
            }
          }
          if (!S.ev.brake && pose.leg === T.profs.length - 1 && pose.ph === 'ride') { S.ev.brake = 1; if (R) sfx.tramBrake?.(0.5, Math.abs(pose.v)); }
          if (!S.ev.arr && S.t >= T.tArrive) { S.ev.arr = 1; arrive(); }
          if (!S.ev.close && S.t >= T.tClose) { S.ev.close = 1; if (p.onTram?.v === car) ejectLocal(); this.xfRide = null; S.sound?.stop(); S.sound = null; }
          setFade(R ? pose.fade : 0);
          if (S.sound) S.sound.set(Math.min(1, car.speed / 14), pose.ph === 'ride' && pose.leg === 0 ? 0.8 : 0.2, p.onTram?.v === car ? 0.8 : 0);
        }
      } else if (fadeO) setFade(0);
      if (car.usable) {
        car.updateSway(dt);
        // host : zombies in the car's footprint (on the track ahead, at a door) are shoved aside : the car never carries or crosses one
        if (!this.isClient) {
          const hw = HDF.tram.width / 2 + 0.45;
          for (const z of this.zombies) {
            if (z.dead || z.onTrain || Math.abs(z.pos.x - car.pos.x) > car.L || Math.abs(z.pos.z - car.pos.z) > car.L) continue;
            car.worldToWalk(z.pos.x, z.pos.z, loc);
            if (loc.w === 99 || Math.abs(loc.u) > car.L / 2 + 0.3 || Math.abs(loc.w) >= hw) continue;
            car.walkToWorld(loc.u, (loc.w < 0 ? -1 : 1) * hw, 0, tmp);
            z.pos.x = tmp.x; z.pos.z = tmp.z;
          }
        }
      }
      if (subT > 0) { subT -= dt; if (subT <= 0) subEl.style.display = 'none'; }
      // riders are safe : no zombie targets them (zombie.js, main.js), no damage (player.js)
      p.xfSafe = !!this.xfRide?.safe;
      const riding = S.state === STATE.go && S.trip && S.t < S.trip.tArrive;
      for (const r of this.remotes.values()) r.xfSafe = riding && r.tr?.id === XF_ID;
      // scenery : the part of the drawn area
      if (sc) { const a = world.localArea; sc.near.visible = a === 'gare'; sc.far.visible = a !== 'gare'; }
    },
    resetTransfer() {
      if (this.player.onTram?.v === car) this.tramWalkOff();
      S.state = STATE.idle; S.stop = null; S.t = 0; S.trip = null; S.call = null; this.xfRide = null; this.player.xfSafe = false;
      S.sound?.stop(); S.sound = null; car.hide(); setFade(0); subEl.style.display = 'none'; subT = 0;
      for (const st of Object.values(stops)) st.cool = 0;
    },
    // late joiner (sync) : the same car, the same clock
    transferState: () => (S.state === STATE.idle ? null : { stop: S.stop.id, st: S.state, t: Math.round(S.t * 100) / 100, pids: S.pids, dep: S.dep, arr: S.arr }),
    transferJoin(m) {
      if (!m || !stops[m.stop]) return;
      if (m.st === STATE.call) { startCall(m.stop, m.dep || 0); S.t = m.t || 0; }
      else if (m.st === STATE.go) { startGo(m.stop, (m.pids || []).filter((id) => id !== myId()), m.dep || 0, m.arr || 0); S.t = m.t || 0; if (S.t >= S.trip.tArrive) { S.ev.arr = 1; const d = stops[stops[m.stop].dest]; if (d.zone >= 0) world.setZoneOpen?.(d.zone, true); } }
    },
    // debug / tests : depart now from a stop, with the local player aboard
    debugTransfer(stopId, arr = null) {
      const st = stops[stopId]; if (!st || this.isClient) return;
      const dep = slotFor(st);
      startCall(stopId, dep); S.t = X.countdown;
      startGo(stopId, [myId()], dep, arr ?? slotFor(stops[st.dest]));
    },
  });

  // ---------------------------------------------------------------- network
  game.onTransferNet = (net) => {
    net.on('xf_req', (m) => { if (game.isHost) game.hostCallTransfer(m.stop); });
    net.onHost('xf_call', (m) => { if (!game.isHost) startCall(m.stop, +m.dep || 0); });
    net.onHost('xf_go', (m) => { if (game.isHost) return; startGo(m.stop, m.pids || [], +m.dep || 0, +m.arr || 0); if (stops[m.stop]) stops[m.stop].cool = X.cooldown; });
  };
}
