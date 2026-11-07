import * as THREE from 'three';
import { CONFIG } from './config.js';
import { carGeometries, atlas, HDF } from './hommedefer.js';
import { Track } from './tramTrack.js';
import { patchMaterial } from './terrain.js';
import { findSafeSpot } from './debugMenu.js';

// =====================================================================
//  Tram transfer (v0.79.0) between the CTS stop « Gare Centrale » on Place de la Gare (real line C track) and the B / C / F platform of
//  Homme de Fer on the Grande Île. The streets between them are not modelled : a short ride animation, a fade, then a teleport.
//  - A CTS ticket terminal at each stop : [E] calls the tram. Host decides (clients send xf_req) and broadcasts xf_call (countdown), then
//    xf_go with the ids of every standing player within boardRadius of the tram : they ride, fade out and appear at the other stop, whose
//    zone opens. The tram is a decor : a CTS car (shared geometries of hommedefer.js), no collision, simulated locally from the messages.
//  - When the last player leaves an area, the host moves its zombies to the arrival stop (z_reloc with their new floor region).
//  Local only : the tram animation, the camera ride, the fade, the titles.
// =====================================================================

const STATE = { idle: 0, call: 1, go: 2 };

export function installTransfer(game, { world, hud, sfx, scene }) {
  const X = CONFIG.transfer, gare = world.gare;
  if (!gare || !X) return;
  const _o = {}, _p = {};

  // ---------------------------------------------------------------- stops
  // track : Track ; sStop : s of the tram centre at the stop ; from : the tram comes from s + from * approach ; dir : departure direction (+1 : s grows)
  const resample = (pts) => {
    const xs = [pts[0][0]], zs = [pts[0][1]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az);
      let s = 1 - acc;
      while (s <= d) { xs.push(ax + ((bx - ax) * s) / d); zs.push(az + ((bz - az) * s) / d); s += 1; }
      acc = (acc + d) % 1;
    }
    return { x: xs, z: zs };
  };
  const gTrack = new Track({ id: 'C-gare', samples: resample(gare.stop.track) });
  const gS = gTrack.project(gare.stop.at[0], gare.stop.at[1], 10, {}).s;
  const hTrack = world.tram?.net?.byId?.[X.hdf.line];
  const hStop = hTrack?.stops?.find((s) => s.name === X.hdf.stop);
  const zi = (name) => world.zoneNames.indexOf(name);
  const stops = {
    gare: { id: 'gare', name: 'Gare Centrale', dest: 'hdf', track: gTrack, sStop: gS, from: 1, dir: 1, zone: zi('Place de la Gare'), title: 'GARE CENTRALE', sub: 'Place de la Gare — tram C' },
  };
  if (hTrack && hStop) stops.hdf = { id: 'hdf', name: 'Homme de Fer', dest: 'gare', track: hTrack, sStop: hStop.s, from: 1, dir: -1, zone: zi('Homme de Fer'), title: 'HOMME DE FER', sub: 'Quai B · C · F' };
  else console.warn('[transfer] Homme de Fer stop not found : one-way station');

  // terminal spots : gare (east CTS platform, beside the stop), Homme de Fer (platform beside the stop, checked free)
  const P = gare.plan;
  {
    const [x, z] = P.W(P.stop.l[0] + 3.6, P.stop.l[1] - 3.2), yaw = Math.atan2(-P.frame.ux, -P.frame.uz);
    stops.gare.terminal = { x, z, yaw };
    const [ax, az] = P.W(P.stop.l[0] - 0.2, P.stop.l[1] + 16);
    stops.gare.arrive = { x: ax, z: az };
  }
  if (stops.hdf) {
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
    stops.hdf.arrive = { x: stops.hdf.terminal.x, z: stops.hdf.terminal.z };
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
    st.screen = scr;
  };
  for (const st of Object.values(stops)) makeTerminal(st);

  // ---------------------------------------------------------------- the decor tram (a CTS car : 5 modules, shared geometries)
  let car = null;
  const buildCar = () => {
    const C = carGeometries(), A = atlas('car');
    const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6, emissive: 0x2a2620 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8d0ea, transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.12, depthWrite: false, side: THREE.DoubleSide });
    patchMaterial(dark); patchMaterial(glass); patchMaterial(A.mat);
    const mods = C.modules.map((m) => {
      const g = new THREE.Group(), inner = new THREE.Group(); inner.rotation.y = Math.PI / 2; g.add(inner);
      const meshes = [new THREE.Mesh(m.body, A.mat), new THREE.Mesh(m.dark.clone(), dark), new THREE.Mesh(m.glass, glass)];
      for (const o of meshes) { o.frustumCulled = false; o.receiveShadow = true; inner.add(o); }
      const pos = meshes[1].geometry.attributes.position, base = new Float32Array(m.leaves.reduce((a, l) => a + l.n, 0));
      let k = 0; for (const l of m.leaves) for (let v = 0; v < l.n; v++) base[k++] = pos.getX(l.v0 + v);
      return { g, dark: meshes[1], leaves: m.leaves, base, f: 0 };
    });
    const group = new THREE.Group(); group.visible = false; group.name = 'transfer:tram';
    for (const m of mods) group.add(m.g);
    scene.add(group);
    car = { group, mods, L: C.L, M: HDF.tram.module, n: mods.length, s: 0, track: null, doors: 0, light: { x: 0, y: 2.6, z: 0, color: 0xffe6c0, intensity: 0, dist: 12, off: true } };
    world.lightSources?.push?.(car.light);
  };
  const placeCar = (track, s, doors) => {
    if (!car) buildCar();
    car.track = track; car.s = s;
    for (let i = 0; i < car.n; i++) {
      const m = car.mods[i], si = s + (-car.L / 2 + car.M / 2 + i * car.M);
      track.at(Math.max(0, Math.min(track.L, si)), _o);
      m.g.position.set(_o.x, 0, _o.z); m.g.rotation.set(0, _o.yaw, 0);
      if (Math.abs(m.f - doors) > 1e-3) {
        m.f = doors;
        const pos = m.dark.geometry.attributes.position; let k = 0;
        for (const l of m.leaves) for (let v = 0; v < l.n; v++) pos.setX(l.v0 + v, m.base[k++] + l.dir * doors * 0.62);
        pos.needsUpdate = true;
      }
    }
    track.at(s, _o); car.light.x = _o.x; car.light.z = _o.z; car.light.off = false;
    car.group.visible = true;
  };
  const hideCar = () => { if (car) { car.group.visible = false; car.light.intensity = 0; car.light.off = true; } };

  // ---------------------------------------------------------------- fade overlay
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40';
  document.body.appendChild(fadeEl);

  // ---------------------------------------------------------------- state (same on every client : driven by xf_call / xf_go)
  const S = { stop: null, state: STATE.idle, t: 0, cool: {}, riders: [], leaving: new Set() }; // leaving : ids of the riders of the last departure
  const motionS = (st, t) => { // s of the tram centre : arrival (decelerating) during the countdown, then departure (accelerating)
    const T = Math.max(1, X.countdown - 2.2);
    if (S.state === STATE.call) { const k = Math.min(1, t / T), e = 1 - (1 - k) * (1 - k); return st.sStop + st.from * X.approach * (1 - e); }
    const d = Math.min(0.5 * X.accel * t * t, 14 * t); return st.sStop + st.dir * d;
  };
  const doorsAt = (t) => (S.state === STATE.call ? Math.max(0, Math.min(1, (t - (X.countdown - 2.2)) / 1.0)) : Math.max(0, 1 - t / 0.8));

  const myId = () => game.net?.id ?? 0;
  const stopNear = (x, z, r) => { for (const st of Object.values(stops)) if (Math.hypot(x - st.terminal.x, z - st.terminal.z) < r) return st; return null; };
  const aboard = (st, pos) => { // within boardRadius of the tram axis, along its length
    const r = st.track.project(pos.x, pos.z, X.boardRadius + 2, _p);
    return r.d <= X.boardRadius && Math.abs(r.s - st.sStop) <= car.L / 2 + 2;
  };

  function startCall(stopId) {
    const st = stops[stopId]; if (!st) return;
    S.stop = st; S.state = STATE.call; S.t = 0;
    const p = game.player;
    if (Math.hypot(p.pos.x - st.terminal.x, p.pos.z - st.terminal.z) < 40) { hud.announce('TRAM', `Direction ${stops[st.dest]?.name || '—'} — départ dans ${X.countdown} s, montez à bord`, 3200); sfx.buy?.(); }
  }
  function startGo(stopId, pids) {
    const st = stops[stopId]; if (!st) return;
    if (!car) buildCar();
    S.stop = st; S.state = STATE.go; S.t = 0; S.leaving = new Set(pids);
    const me = myId(), p = game.player;
    if (pids.includes(me) && !p.downed && !p.dead) {
      if (p.vehicle) game.leaveVehicle?.();
      const slot = pids.indexOf(me), n = pids.length;
      st.track.project(p.pos.x, p.pos.z, 20, _p);
      game.xfRide = { st, slot, n, u: Math.max(-car.L / 2 + 2, Math.min(car.L / 2 - 2, (slot - (n - 1) / 2) * 2.4)), w: 0, yawPrev: null, fade: 0, done: false, carry };
      p.vel.set(0, 0, 0);
    }
  }

  // carries the local rider (called by Player.update instead of walking)
  function carry(p) {
    const R = game.xfRide, st = R.st, s = car.s + R.u;
    st.track.at(Math.max(0, Math.min(st.track.L, s)), _o);
    const f = st.track === gTrack ? 0 : world.terrainY(_o.x, _o.z);
    p.pos.set(_o.x - _o.tz * R.w, CONFIG.tram.car.floor + f, _o.z + _o.tx * R.w);
    if (R.yawPrev != null) p.yaw += Math.atan2(Math.sin(_o.yaw - R.yawPrev), Math.cos(_o.yaw - R.yawPrev)); // the view turns with the car
    R.yawPrev = _o.yaw;
  }

  // arrival : safe spot near the destination stop, zone opened, title
  function arrive(R) {
    const dest = stops[R.st.dest], p = game.player;
    const a = dest.arrive, fl = world.floorAt(a.x, a.z, 3, { y: 0, region: 0 });
    const c = { x: a.x + (R.slot % 2 ? 1.6 : -1.6) * Math.ceil(R.slot / 2), y: fl.y, z: a.z };
    const spot = findSafeSpot(world, c, fl.region) || findSafeSpot(world, { x: a.x, y: fl.y, z: a.z }, fl.region) || { x: a.x, y: fl.y, z: a.z };
    p.pos.set(spot.x, spot.y, spot.z); p.vel.set(0, 0, 0); p.vy = 0;
    if (dest.zone >= 0) world.setZoneOpen?.(dest.zone, true);
    world.setLocalArea?.(world.areaOf(spot.x, spot.z));
    game.sendPlayerState?.();
    hud.announce(dest.title, dest.sub, 3500);
  }

  // host : when nobody is left in an area, its zombies follow the players (relocated near the arrival stop, with their new floor region)
  function hostFollow(fromArea, destId) {
    if (game.isClient) return;
    // players still in the area (the riders of the last departure are leaving it : their position may not have arrived yet)
    const players = [[myId(), game.player], ...game.remotes.entries()];
    if (players.some(([id, pl]) => !pl.dead && !S.leaving.has(id) && world.areaOf(pl.pos.x, pl.pos.z) === fromArea)) return;
    const dest = stops[destId], reg = world.regionAt(dest.arrive.x, dest.arrive.z);
    for (const z of game.zombies) {
      if (z.dead || z.isBoss || world.areaOf(z.pos.x, z.pos.z) !== fromArea) continue;
      const g = world.pickGround(dest.arrive.x, dest.arrive.z, 14, 40);
      if (!g) continue;
      z.startSpawn({ type: 'ground', pos: g }); z.region = reg; z.link = null;
      game.net?.send({ t: 'z_reloc', id: z.id, x: g.x, z: g.z, region: reg });
    }
  }

  Object.assign(game, {
    transfer: { stops, S, aboard: (pos) => S.stop && aboard(S.stop, pos) },
    nearTransfer() {
      const p = this.player;
      if (p.vehicle || p.downed || p.dead || this.xfRide) return null;
      return stopNear(p.pos.x, p.pos.z, X.reach);
    },
    transferPrompt() {
      const st = this.nearTransfer(), dest = stops[st.dest];
      if (!dest) return 'Tram hors service';
      if (S.stop === st && S.state !== STATE.idle) return S.state === STATE.call ? `Départ dans ${Math.max(0, Math.ceil(X.countdown - S.t))} s — montez à bord` : 'Le tram part…';
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
      this.net?.send({ t: 'xf_call', stop: stopId });
      startCall(stopId);
    },
    // per frame, before the player moves (main.js)
    updateTransfer(dt) {
      for (const st of Object.values(stops)) if (st.cool > 0) st.cool -= dt;
      const st = S.stop;
      if (S.state !== STATE.idle && st) {
        S.t += dt;
        placeCar(st.track, motionS(st, S.t), doorsAt(S.t));
        car.light.intensity = 8;
        if (S.state === STATE.call && S.t >= X.countdown && !this.isClient) { // host : who boards
          const players = [[myId(), this.player], ...[...this.remotes.entries()]];
          const pids = players.filter(([, pl]) => pl && !pl.dead && !pl.downed && aboard(st, pl.pos)).map(([id]) => id);
          this.net?.send({ t: 'xf_go', stop: st.id, pids });
          startGo(st.id, pids);
          st.cool = X.cooldown;
        }
        if (S.state === STATE.go && S.t > X.ride + X.fade + 0.5 && !this.xfRide) { S.state = STATE.idle; S.stop = null; hideCar(); }
      }
      // local rider : ride, fade out, teleport, fade in
      const R = this.xfRide;
      if (R) {
        const tf = S.t - X.ride;
        fadeEl.style.opacity = String(Math.max(0, Math.min(1, tf / X.fade)));
        if (!R.done && tf >= X.fade) {
          R.done = true;
          const from = world.areaOf(this.player.pos.x, this.player.pos.z);
          this.xfRide = null;
          arrive(R);
          R.fadeIn = X.fade;
          S.fadeIn = X.fade;
          if (!this.isClient) hostFollow(from, R.st.dest);
          else this.net?.send({ t: 'xf_left', area: from, dest: R.st.dest });
          if (S.state === STATE.go) { S.state = STATE.idle; S.stop = null; hideCar(); }
        }
      } else if (S.fadeIn > 0) { S.fadeIn -= dt; fadeEl.style.opacity = String(Math.max(0, S.fadeIn / X.fade)); }
      else if (fadeEl.style.opacity !== '0') fadeEl.style.opacity = '0';
    },
    resetTransfer() {
      S.state = STATE.idle; S.stop = null; S.t = 0; S.fadeIn = 0; this.xfRide = null; hideCar(); fadeEl.style.opacity = '0';
      for (const st of Object.values(stops)) st.cool = 0;
    },
    // debug / tests : depart now from a stop, with the local player aboard
    debugTransfer(stopId) { startCall(stopId); S.t = X.countdown; const p = this.player; const st = stops[stopId]; st.track.at(st.sStop, _o); p.pos.set(_o.x, p.pos.y, _o.z); startGo(stopId, [myId()]); },
  });

  // ---------------------------------------------------------------- network
  game.onTransferNet = (net) => {
    net.on('xf_req', (m) => { if (game.isHost) game.hostCallTransfer(m.stop); });
    net.onHost('xf_call', (m) => startCall(m.stop));
    net.onHost('xf_go', (m) => { startGo(m.stop, m.pids || []); if (stops[m.stop]) stops[m.stop].cool = X.cooldown; });
    net.on('xf_left', (m) => { if (game.isHost && (m.area === 'gare' || m.area === 'island') && stops[m.dest]) hostFollow(m.area, m.dest); });
  };
}
