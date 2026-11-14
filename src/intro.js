import { CONFIG } from './config.js';

// =====================================================================
//  Train intro (v0.81.0) : the game starts inside the regional train (train.js) that comes from the south-west and stops at quai 1 of
//  the station ; round 1 starts there CONFIG.intro.roundDelay s after the stop. v0.82.0 : the zombies of the ride (rideZombies.js) :
//  CONFIG.intro.events call game.introHooks[id] at τ ; game.rideReset (begin / off) and game.rideOnStop (the stop, a skip) clean up.
//
//  Clock : τ (s). The train's nose abscissa s(τ) = s0 + dist(τ) is a PURE function of τ and CONFIG.intro.profile (speed keys, linear in
//  between, integrated exactly) ; s0 is chosen so that the stop (τ = T) lands on the parked position. Nothing else is simulated.
//  Phases : 'ride' (doors closed, nobody gets off), 'stopped' (doors open, arrival announcement ; round 1 after roundDelay), 'done'.
//  Skip : hold [jump] skipHold s (solo : the player ; co-op : the host) -> τ jumps to the stop.
//
//  Multiplayer (host authoritative, no server change) : the host owns τ and sends tn_sync { tau, ph } every CONFIG.intro.sync s ; a client
//  advances τ itself and converges toward host τ + ping / 2 ; intro_skip { tau } (host -> all) ; `start` carries sp.intro, `sync` carries
//  intro { tau, ph } (late joiners stand in coach lateCoach). Players stand in the train with p_state vh = TRAIN_ID (remote.js parents them).
//  Local only : title card, subtitles, sounds, camera sway (train.js), the night sky hold, the far ground of the scenery.
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// speed profile (pure) : keys [[τ, v]…] -> { T (stop time), D (distance), dist(τ), speed(τ) } ; before τ = 0 : constant first speed
export function introProfile(keys = CONFIG.intro.profile) {
  const K = keys.map(([t, v]) => ({ t, v })), n = K.length, acc = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + ((K[i].t - K[i - 1].t) * (K[i].v + K[i - 1].v)) / 2);
  const T = K[n - 1].t, D = acc[n - 1];
  const seg = (tau) => { let i = 0; while (i < n - 2 && tau >= K[i + 1].t) i++; return i; };
  return {
    T, D,
    dist(tau) {
      if (tau <= K[0].t) return K[0].v * (tau - K[0].t);
      if (tau >= T) return D;
      const i = seg(tau), a = K[i], b = K[i + 1], h = tau - a.t, ac = (b.v - a.v) / (b.t - a.t);
      return acc[i] + a.v * h + 0.5 * ac * h * h;
    },
    speed(tau) {
      if (tau <= K[0].t) return K[0].v;
      if (tau >= T) return 0;
      const i = seg(tau), a = K[i], b = K[i + 1];
      return a.v + ((b.v - a.v) * (tau - a.t)) / (b.t - a.t);
    },
    // braking now (speed falling) : 0..1 (sounds)
    braking(tau) { if (tau <= K[0].t || tau >= T) return 0; const i = seg(tau), a = K[i], b = K[i + 1]; return b.v < a.v ? clamp((a.v - b.v) / (b.t - a.t) / 1.2, 0, 1) : 0; },
  };
}

export function installIntro(game, { world, hud, sfx }) {
  const I = CONFIG.intro, train = world.gare?.train;
  game.introHooks = game.introHooks || {}; // phase 4 : zombie events by id (track, breach, roof, trackbed)
  if (!I?.enabled || !train) { game.introAvailable = false; return; }
  game.introAvailable = true;
  const P = introProfile(), sEnd = train.route.parkHeadS, s0 = sEnd - P.D;
  const S = { on: false, ph: 'off', tau: 0, stopTau: P.T, ann: 0, ev: 0, hold: 0, syncT: 0, corr: 0, sound: null, sub: 0 };
  game.intro = S;
  // the start spot of the intro : the station's start (zone Quais) ; applySpawnPoint opens it, the player is then put in the train
  game.introSpawn = world.gare.start ? { ...world.gare.start, intro: true, name: 'Train rapide 17412' } : null;

  // ---------------------------------------------------------------- overlays : title card, subtitles, skip gauge (local only)
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:38;display:none;align-items:center;justify-content:center;flex-direction:column;font-family:Georgia,"Times New Roman",serif;color:#d8d2c4;letter-spacing:6px;text-align:center';
  card.innerHTML = `<div style="font-size:clamp(18px,3vw,34px);padding:0 6vw">${I.title}</div><div style="margin-top:18px;width:120px;height:1px;background:#6a6458"></div><div style="margin-top:14px;font-size:clamp(11px,1.3vw,15px);letter-spacing:4px;color:#8a8478">STRASBOURG — NUIT</div>`;
  const sub = document.createElement('div');
  sub.style.cssText = 'position:fixed;left:50%;bottom:21%;transform:translateX(-50%);max-width:min(860px,88vw);padding:8px 18px;background:rgba(0,0,0,0.55);border-left:3px solid #c8b070;color:#efe6cf;font:italic 18px Georgia,serif;letter-spacing:0.5px;line-height:1.35;pointer-events:none;z-index:37;display:none;text-align:left';
  const skipEl = document.createElement('div');
  skipEl.style.cssText = 'position:fixed;right:24px;top:18px;padding:6px 12px;background:rgba(0,0,0,0.5);color:#ddd;font:13px Arial,sans-serif;letter-spacing:1px;pointer-events:none;z-index:37;display:none';
  skipEl.innerHTML = '<span></span><div style="margin-top:5px;height:3px;background:#333"><div style="height:3px;width:0;background:#ffd24a"></div></div>';
  const skipTxt = skipEl.firstChild, skipBar = skipEl.lastChild.firstChild;
  for (const el of [card, sub, skipEl]) document.body.appendChild(el);
  let subText = null, skipShown = null, skipW = -1, cardO = -1;
  const showSub = (text, dur) => { sub.textContent = text; sub.style.display = 'block'; subText = text; S.sub = dur; };
  const hideUi = () => { card.style.display = 'none'; card.style.opacity = '0'; cardO = -1; sub.style.display = 'none'; subText = null; skipEl.style.display = 'none'; skipShown = null; };

  const canSkip = () => !game.isMultiplayer || game.isHost;
  const skipLabel = () => `Maintenir ${game.binds.tag('jump')} : passer l'introduction`;

  // ---------------------------------------------------------------- train pose from τ
  const poseAt = (tau) => {
    if (tau >= S.stopTau) { train.setPose(sEnd, 0); return; }
    train.setPose(s0 + P.dist(tau), P.speed(tau));
  };
  // local player standing in the train : slot -> (vehicle, u)
  const placeLocal = (late) => {
    const p = game.player, slot = game.mySlot || 0;
    const [vi, du] = late ? [I.lateCoach, slot % 2 ? I.slots[1][1] : I.slots[0][1]] : I.slots[slot % I.slots.length];
    const v = train.veh[Math.min(vi, train.n - 1)];
    if (p.vehicle) game.leaveVehicle?.();
    game.xfRide = null;
    game.placeInTram(train, v.uc + du, 0);
    p.yaw = p.onTram.fy - 0.35; p.pitch = -0.02; // along the aisle, a little toward the windows on the right
    p.vel.set(0, 0, 0);
  };

  // ---------------------------------------------------------------- the atmosphere of the ride (local look) : night turning to dawn (a slow ramp of the held hour),
  // thinner fog, a farther camera plane, the distant ridge of the Vosges in the sky dome
  let hourT = -1;
  const rideAtmosphere = (on) => {
    const cam = game.player?.camera;
    if (on) { game.summitFx?.setFogScale(I.fog); if (cam && cam.far < I.far) { cam.far = I.far; cam.updateProjectionMatrix(); } game.gfx?.sky?.setRidge?.(1); }
    else { game.summitFx?.holdNight(null); game.summitFx?.setFogScale(1); if (cam && cam.far === I.far) { cam.far = 170; cam.updateProjectionMatrix(); } game.gfx?.sky?.setRidge?.(0); hourT = -1; }
  };
  const holdHour = (tau) => { game.summitFx?.holdNight(I.hour + ((I.hourEnd ?? I.hour) - I.hour) * clamp(tau / P.T, 0, 1)); hourT = tau; };

  // ---------------------------------------------------------------- sounds of the line (local) : level-crossing bells with doppler, rumble on the bridges
  // The listener is where the local player stands in the train (else car 2) ; s is the abscissa along the route (train.s = the nose).
  const AC = CONFIG.audio, crossS = train.route.crossingS || [], rideBridges = (train.route.bridges || []).filter((b) => b.s1 - b.s0 >= AC.bridge.minLen);
  let lastS = -1, dingT = 0;
  const listenerS = () => { const o = game.player?.onTram, u = o && o.v === train ? o.u : train.veh[Math.min(2, train.n - 1)].uc; return train.s - (train.L / 2 - u); };
  function lineSounds(dt) {
    if (S.ph !== 'ride') { lastS = -1; return; }
    const sp = listenerS(), vel = train.speed;
    if (lastS >= 0) {
      for (let i = 0; i < rideBridges.length; i++) {
        const b = rideBridges[i];
        if (lastS < b.s0 && sp >= b.s0 && sp - lastS < 5) sfx.bridgeRumble?.(AC.bridge.vol * (b.over === 'water' ? AC.bridge.water : 1), (b.s1 - b.s0) / Math.max(vel, 1)); // (entering : rumbles for the crossing time)
      }
    }
    lastS = sp;
    dingT -= dt;
    if (dingT > 0 || !crossS.length) return;
    let best = Infinity, bd = 0;
    for (let i = 0; i < crossS.length; i++) { const d = crossS[i] - sp; if (Math.abs(d) < Math.abs(best)) { best = d; bd = Math.abs(d); } }
    if (bd >= AC.crossing.range) return;
    dingT = AC.crossing.every;
    const fall = 1 - bd / AC.crossing.range; // quiet far away, loud at the crossing
    sfx.crossingDing?.(AC.crossing.vol * fall * fall, (AC.crossing.sound + (best > 0 ? vel : -vel)) / AC.crossing.sound); // doppler : pitch up approaching (best > 0 : ahead), down after
  }

  // ---------------------------------------------------------------- phases
  function begin(tau = 0, { late = false } = {}) {
    game.introGraceUntil = 0;
    S.on = true; S.tau = tau; S.corr = 0; S.hold = 0; S.syncT = 0; S.stopTau = P.T;
    S.ann = 0; while (S.ann < I.announce.length && I.announce[S.ann].at < tau) S.ann++;
    S.ev = 0; while (S.ev < I.events.length && I.events[S.ev].at < tau) S.ev++;
    hideUi();
    game.rideReset?.(tau); // (the windows like new, no ride zombie plan ; a late joiner : the roof state from τ)
    if (tau >= S.stopTau) { // already at the station : doors open
      S.ph = 'stopped'; poseAt(tau); train.setDoors(clamp((tau - S.stopTau) / I.doorTime, 0, 1));
      rideAtmosphere(false);
    } else {
      S.ph = 'ride'; poseAt(tau); train.setDoors(0);
      rideAtmosphere(true); holdHour(tau);
      placeLocal(late);
    }
    if (!S.sound) S.sound = sfx.createTrainSound?.() || null;
    train.onJoint = (sp) => { if (game.player.onTram?.v === train) sfx.trainClack?.(0.9, sp); };
  }
  // the train stops at quai 1 : doors open, arrival announcement, the night hold ends
  function stop(skipped = false) {
    S.ph = 'stopped';
    S.stopTau = Math.min(S.stopTau, S.tau);
    poseAt(S.stopTau);
    S.ann = I.announce.length; // (skipped : the remaining announcements are dropped, and the ride events before the stop)
    while (S.ev < I.events.length && I.events[S.ev].at < S.stopTau) S.ev++;
    sub.style.display = 'none'; subText = null;
    rideAtmosphere(false);
    sfx.airRelease?.(0.8);
    sfx.trainDoors?.(0.9);
    hud.announce(I.arrival.title, I.arrival.sub, 4500);
    game.rideOnStop?.(skipped); // ride zombies : released at the station, or removed (skip)
  }
  function finish() {
    S.on = false; S.ph = 'done';
    game.introGraceUntil = game.time + (I.graceAfter || 0); // (Player.hurt keeps the HP floor until then)
    hideUi();
    train.setDoors(1); train.setPose(sEnd, 0);
    S.sound?.stop(); S.sound = null;
    train.onJoint = null;
    if (!game.isClient) game.intermission = 0.01; // round 1 now (main.js round loop)
  }
  // off (classic or station start, a reset) : the train back to its parked state
  function end() {
    game.introGraceUntil = 0;
    if (S.ph === 'off') return;
    S.on = false; S.ph = 'off';
    hideUi();
    S.sound?.stop(); S.sound = null;
    train.onJoint = null;
    train.park();
    game.rideReset?.(0);
    rideAtmosphere(false);
    if (game.summitFx?.nightHeld) { game.summitFx.holdNight(null); game.summitFx.resetSky(); }
  }
  function skip(tau = S.tau) {
    if (!S.on || S.ph !== 'ride') return;
    S.tau = Math.max(S.tau, tau, P.T);
    if (game.isHost && game.isMultiplayer) game.net?.send({ t: 'intro_skip', tau: S.tau });
    stop(true);
  }

  // ---------------------------------------------------------------- per frame (main.js : before the train and the player)
  function update(dt) {
    if (!S.on) return;
    S.tau += dt;
    if (game.isClient && S.corr) { const k = Math.min(1, dt * I.nudge), c = S.corr * k; S.tau += c; S.corr -= c; }
    const tau = S.tau;
    if (S.ph === 'ride' && (hourT < 0 || tau - hourT > 2)) holdHour(tau); // (every 2 s : the sky is repainted at each step)
    if (S.ph === 'ride' && tau >= P.T) stop();
    if (S.ph === 'ride') poseAt(tau);
    else if (S.ph === 'stopped') {
      train.setDoors((tau - S.stopTau) / I.doorTime);
      if (tau >= S.stopTau + I.roundDelay) { finish(); return; }
    }
    // title card : black, then the picture fades in
    const co = tau < I.card - I.fadeIn ? 1 : clamp((I.card - tau) / I.fadeIn, 0, 1);
    if (Math.abs(co - cardO) > 0.004) { cardO = co; card.style.opacity = String(co); card.style.display = co > 0 ? 'flex' : 'none'; }
    // announcements, phase 4 hooks
    while (S.ann < I.announce.length && tau >= I.announce[S.ann].at) {
      const a = I.announce[S.ann++];
      if (a.chime) sfx.trainChime?.(0.9);
      if (a.static) sfx.radioStatic?.(a.dur, 0.8);
      if (a.big) { hud.announce(a.title, a.sub || '', a.dur * 1000); if (!a.quiet) sfx.tramBrake?.(0.6, 14); }
      else if (a.text) showSub(a.text, a.dur);
    }
    while (S.ev < I.events.length && tau >= I.events[S.ev].at) { const e = I.events[S.ev++]; try { game.introHooks[e.id]?.(tau, e); } catch (err) { console.warn('[intro] hook', e.id, err); } }
    if (subText) { S.sub -= dt; if (S.sub <= 0) { sub.style.display = 'none'; subText = null; } }
    // skip : hold [jump]
    const p = game.player, show = S.ph === 'ride' && canSkip() && tau > 0.5;
    if (show && game.playing && !p.dead && game.binds.down('jump', p.keys) && !game.chat?.open) S.hold += dt; else S.hold = 0;
    if (show !== skipShown) { skipShown = show; skipEl.style.display = show ? 'block' : 'none'; if (show) skipTxt.textContent = skipLabel(); }
    const w = Math.round(clamp(S.hold / I.skipHold, 0, 1) * 100);
    if (w !== skipW) { skipW = w; skipBar.style.width = w + '%'; }
    if (S.hold >= I.skipHold) { S.hold = 0; skip(); }
    lineSounds(dt);
    // rolling sound (local), host clock
    if (S.sound) S.sound.set(train.speed, S.ph === 'ride' ? P.braking(tau) : 0, p.onTram?.v === train ? 0.9 : 0.35, game.rideWind?.() || 0);
    if (game.isHost && game.isMultiplayer) { S.syncT -= dt; if (S.syncT <= 0) { S.syncT = I.sync; game.net?.send({ t: 'tn_sync', tau: Math.round(S.tau * 1000) / 1000, ph: S.ph }); } }
  }

  // ---------------------------------------------------------------- game API
  Object.assign(game, {
    updateIntro: update,
    introSkip: skip,
    // main.js round loop : no round while the intro runs
    introBlocksRound: () => S.on,
    // solo pause (main.js : the game is frozen) : the rolling sound goes quiet until the next update
    introFrozen() { if (S.on && S.sound) S.sound.set(0, 0, 0); },
    // reset() : start the intro when the start spot is the intro's, otherwise make sure it is off
    introReset() { if (this.activeSpawn?.intro) begin(0); else end(); },
    // late joiner (sync from the host)
    introJoin(st) { if (!st || st.ph === 'done' || st.ph === 'off') { end(); return; } begin(st.tau, { late: true }); },
    introState: () => (S.on ? { tau: Math.round(S.tau * 1000) / 1000, ph: S.ph } : null),
    // prompt standing in the moving train : none during the ride (v0.83.1, the skip gauge has its own label) ; null = not riding
    introHint() {
      if (!S.on || S.ph !== 'ride') return null;
      return '';
    },
    introDebug: { P, s0, sEnd, S, poseAt },
    // nose abscissa of the train on the route at τ (rideZombies.js places the trackside zombies the train will pass)
    introNoseAt: (tau) => (tau >= S.stopTau ? sEnd : s0 + P.dist(tau)),
  });

  // ---------------------------------------------------------------- network
  game.onIntroNet = (net) => {
    net.onHost('tn_sync', (m) => {
      if (game.isHost) return;
      if (!S.on) { if (S.ph !== 'done' && (m.ph === 'ride' || m.ph === 'stopped')) begin(m.tau, { late: true }); return; } // (done : a late tn_sync of the host's last stopped second must not restart it ; a new game resets ph)
      if (m.ph === 'done') { finish(); return; }
      const target = m.tau + Math.min(I.maxPing, (game.netPing || 0) / 1000) / 2, err = target - (S.tau + S.corr);
      if (Math.abs(err) > 1) { S.tau = target; S.corr = 0; } else S.corr += err;
    });
    net.onHost('intro_skip', (m) => { if (!game.isHost && S.on) { S.tau = Math.max(S.tau, m.tau || P.T); S.corr = 0; if (S.ph === 'ride') stop(true); } });
  };
}
