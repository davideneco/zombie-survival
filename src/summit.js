import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TOWER } from './cath/spire.js';
import { Avatar } from './characters.js';

// =====================================================================
//  Acte V « L'Aube » : décor et effets du sommet de la cathédrale, communs à tous les joueurs (la machine à états est dans finale.js).
//   - le faisceau : deux cylindres additifs qui montent de la pointe de la flèche (apparaît après la victoire sur le Bourreau) ;
//   - le Fanal d'Erwin : cage de fer et flamme additive sur le balcon de la pointe ; sa flamme grandit avec la progression commune ;
//   - le ciel : fond, brouillard, lumière de la lune (qui devient le soleil), lampadaires, dégradé et étoiles du dôme : AUCUN nouveau shader ;
//   - l'évacuation par hélicoptère + explosion nucléaire sur Strasbourg ;
//   - les rafales de la rampe et les cendres des zombies.
// =====================================================================
const DEG = Math.PI / 180;
const C3 = (h) => new THREE.Color(h);
const lerpHex = (out, a, b, k) => out.copy(C3(a)).lerp(C3(b), k);
const sm = (x) => x * x * (3 - 2 * x);
const cl01 = (x) => Math.max(0, Math.min(1, x));

// Réglages du ciel à trois instants : nuit (k = 0), aube dorée (k = 0,5), plein jour (k = 1)
const SKY = {
  bg: [0x070b12, 0x6a5058, 0x9ec8f0],
  fog: [0x0b121c, 0xc88a68, 0xbcd4e8],
  density: [0.019, 0.016, 0.011],
  hemiSky: [0x6677aa, 0xd4a888, 0xcfe2ff],
  hemiGround: [0x222018, 0x5a4a3a, 0x6a6458],
  hemi: [1.1, 1.5, 1.9],
  sun: [0x9fb4ff, 0xffb070, 0xfff0d8],
  sunI: [1.4, 1.8, 2.6],
  sunPos: [[25, 55, 15], [70, 22, 10], [35, 60, 15]],
  domeTop: ['#04070d', '#2a2f5a', '#3f78c8'],
  domeMid: ['#0c1522', '#b8706a', '#7fb2e8'],
  domeBot: ['#1b2535', '#f3b074', '#c9e0f4'],
};

export function installSummit(game, { world, scene, hud, sfx, fx, hemi, moon, moonOffset, camera }) {
  const S = () => CONFIG.summit;
  const C = world.cathedral;
  const T = { x: 0, z: 0 }; // axe de la flèche (monde)
  let fanalPos = null;
  if (C && C.P) {
    [T.x, T.z] = C.P(TOWER.c[0], TOWER.c[1]);
    const a = 235 * DEG; // sur le balcon, du côté du garde-corps, adossé à l'aiguille
    const [fx0, fz0] = C.P(TOWER.c[0] + Math.cos(a) * 2.05, TOWER.c[1] + Math.sin(a) * 2.05);
    fanalPos = { x: fx0, z: fz0, y: TOWER.tip };
  }
  game.tower = { x: T.x, z: T.z, top: TOWER.top, tip: TOWER.tip, needle: TOWER.needle, fanal: fanalPos };

  const additive = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, ...extra });
  const dispose = (o) => { if (!o) return; scene.remove(o); o.traverse?.((q) => { if (q.isMesh) { q.geometry?.dispose?.(); const m = q.material; if (m?.map && m.map.userData?.own) m.map.dispose(); m?.dispose?.(); } }); };
  const fall = (c, h) => { const cv = document.createElement('canvas'); cv.width = 4; cv.height = h; const x = cv.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c[0]); g.addColorStop(1, c[1]); x.fillStyle = g; x.fillRect(0, 0, 4, h); const t = new THREE.CanvasTexture(cv); t.userData = { own: true }; return t; };

  // ----------------------------------------------------------------- le faisceau
  let beam = null, fanal = null, sun = null;
  const buildBeam = () => {
    const g = new THREE.Group(); g.position.set(T.x, TOWER.needle + 0.5, T.z);
    const tex = fall(['#4a4a4a', '#ffffff'], 128);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.4, 260, 20, 1, true), additive(0xffe4a0, 0.7, { map: tex, fog: false }));
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 1.3, 260, 20, 1, true), additive(0xffb860, 0.32, { map: tex, fog: false }));
    inner.position.y = outer.position.y = 130; inner.frustumCulled = outer.frustumCulled = false;
    g.add(inner, outer); scene.add(g);
    return { g, inner, outer, k: 1 };
  };

  // ----------------------------------------------------------------- le Fanal d'Erwin
  const buildFanal = () => {
    if (!fanalPos) return null;
    const g = new THREE.Group(); g.position.set(fanalPos.x, fanalPos.y, fanalPos.z); g.scale.setScalar(1.8);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.9, emissive: 0x14161a });
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.24, 0.3, 0.09, 12), iron, 0, 0.045, 0);
    add(new THREE.CylinderGeometry(0.15, 0.06, 0.16, 10), iron, 0, 0.17, 0);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5), iron, Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2); }
    for (const y of [0.12, 0.38, 0.64]) add(new THREE.TorusGeometry(0.2, 0.012, 5, 14), iron, 0, y, 0).rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(0.25, 0.2, 12), iron, 0, 0.8, 0);
    add(new THREE.SphereGeometry(0.03, 6, 6), iron, 0, 0.93, 0);
    const flame = new THREE.Group(); flame.position.y = 0.2; g.add(flame);
    const part = (r, h, c, o) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), additive(c, o)); m.position.y = h / 2; flame.add(m); return m; };
    const f1 = part(0.16, 0.62, 0xff6a18, 0.55), f2 = part(0.1, 0.46, 0xffc050, 0.7), f3 = part(0.05, 0.3, 0xfff4d0, 0.9);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), additive(0xffa040, 0.0)); glow.position.y = 0.4; flame.add(glow);
    scene.add(g);
    return { g, flame, f1, f2, f3, glow, p: 0, lit: 0, t: 0 };
  };

  // soleil : un sprite additif sur le dôme du ciel (qui suit le joueur) ; visible seulement de l'aube au crépuscule
  const buildSun = () => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.18, 'rgba(255,226,160,0.95)'); g.addColorStop(0.5, 'rgba(255,170,90,0.28)'); g.addColorStop(1, 'rgba(255,150,70,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.userData = { own: true };
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(90); s.visible = false; s.renderOrder = -1;
    world.sky?.group.add(s);
    return s;
  };

  // ----------------------------------------------------------------- le ciel
  const sky = { phase: 'night', t: 0, k: 0, apply: null };
  const NIGHT = { bg: scene.background.clone(), fog: scene.fog.color.clone(), density: scene.fog.density, hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), moon: moon.color.clone(), hemiI: 0.28, moonI: 0.42 };
  const dn = { hour: CONFIG.dayNight.startHour, days: 0, cycle: false, lastK: -1, acc: 0, sunEl: -30, sunAz: 0, hold: null, fogScale: 1 };
  const tmpC = new THREE.Color(), tmpD = new THREE.Color();
  const pickC = (arr, k, out, night) => (k < 0.5 ? (night ? out.copy(night).lerp(C3(arr[1]), sm(k * 2)) : lerpHex(out, arr[0], arr[1], sm(k * 2))) : lerpHex(out, arr[1], arr[2], sm((k - 0.5) * 2)));
  const pickN = (arr, k, night = arr[0]) => (k < 0.5 ? night + (arr[1] - night) * sm(k * 2) : arr[1] + (arr[2] - arr[1]) * sm((k - 0.5) * 2));
  const pickS = (arr, k) => { const css = (a, b, u) => `#${tmpC.copy(C3(a)).lerp(C3(b), u).getHexString()}`; return k < 0.5 ? css(arr[0], arr[1], sm(k * 2)) : css(arr[1], arr[2], sm((k - 0.5) * 2)); };
  const applySky = () => {
    const k = sky.k, b = game.settings?.brightness ?? 1.4;
    pickC(SKY.bg, k, scene.background, NIGHT.bg);
    pickC(SKY.fog, k, scene.fog.color, NIGHT.fog); scene.fog.density = pickN(SKY.density, k, NIGHT.density) * dn.fogScale;
    pickC(SKY.hemiSky, k, hemi.color, NIGHT.hemiSky); pickC(SKY.hemiGround, k, hemi.groundColor, NIGHT.hemiGround); hemi.intensity = pickN(SKY.hemi, k, NIGHT.hemiI) * b;
    pickC(SKY.sun, k, moon.color, NIGHT.moon); moon.intensity = pickN(SKY.sunI, k, NIGHT.moonI);
    const i0 = k < 0.5 ? 0 : 1, i1 = k < 0.5 ? 1 : 2, u = k < 0.5 ? sm(k * 2) : sm((k - 0.5) * 2);
    moonOffset.set(SKY.sunPos[i0][0] + (SKY.sunPos[i1][0] - SKY.sunPos[i0][0]) * u, SKY.sunPos[i0][1] + (SKY.sunPos[i1][1] - SKY.sunPos[i0][1]) * u, SKY.sunPos[i0][2] + (SKY.sunPos[i1][2] - SKY.sunPos[i0][2]) * u);
    if (dn.cycle) {
      const el = Math.max(14, dn.sunEl) * DEG, az = dn.sunAz * DEG, uu = sm(Math.min(1, k * 2));
      moonOffset.set(SKY.sunPos[0][0] + (Math.cos(el) * Math.cos(az) * 70 - SKY.sunPos[0][0]) * uu, SKY.sunPos[0][1] + (Math.sin(el) * 70 - SKY.sunPos[0][1]) * uu, SKY.sunPos[0][2] + (Math.cos(el) * Math.sin(az) * 70 - SKY.sunPos[0][2]) * uu);
    }
    world.sky?.setGradient(pickS(SKY.domeTop, k), pickS(SKY.domeMid, k), pickS(SKY.domeBot, k));
    if (world.sky?.stars) world.sky.stars.visible = k < 0.28;
    world.interiors?.setDaylight(k);
    game.gfx?.onSky(k);
    world.setLampScale?.(1 - 0.92 * sm(Math.min(1, k * 1.3)));
    if (sun) {
      sun.visible = dn.cycle ? dn.sunEl > -3 : k > 0.02;
      const el = (dn.cycle ? dn.sunEl : -4 + 42 * sm(k)) * DEG, az = (dn.cycle ? dn.sunAz : 20) * DEG, R = 270;
      sun.position.set(Math.cos(el) * Math.cos(az) * R, Math.sin(el) * R, Math.cos(el) * Math.sin(az) * R);
      sun.material.opacity = Math.min(1, dn.cycle ? Math.max(0, dn.sunEl + 3) / 8 : k * 5) * (1 - 0.35 * sm(Math.max(0, k - 0.6) / 0.4));
    }
    if (beam) { const f = 1 - 0.55 * sm(Math.max(0, k - 0.3) / 0.7); beam.k = f; }
  };
  sky.apply = applySky;
  const startDawn = (from = 0) => { if (!sun) sun = buildSun(); sky.phase = 'dawn'; sky.t = from; };
  const skyStep = (dt, paused) => {
    if (escape.on) return; // le flash / halo nucléaire contrôle le ciel pendant l'évacuation
    if (cycleOn()) { cycleStep(dt, paused); return; }
    if (dn.cycle) cycleStep(dt, paused);
    if (sky.phase === 'night' && sky.k === 0) return;
    const D = S().dawn, E = S().eternal;
    sky.t += dt;
    if (sky.phase === 'dawn') { sky.k = Math.min(1, sky.t / D.sky); if (sky.t >= D.sky) { sky.phase = 'day'; sky.t = 0; } }
    else if (sky.phase === 'day') { sky.k = 1; if (sky.t >= E.day) { sky.phase = 'dusk'; sky.t = 0; game.onDusk?.(); } }
    else if (sky.phase === 'dusk') { sky.k = Math.max(0, 1 - sky.t / E.dusk); if (sky.t >= E.dusk) { sky.phase = 'night'; sky.k = 0; } }
    applySky();
  };
  // ----------------------------------------------------------------- cycle jour / nuit (v0.71.0)
  const DN = () => CONFIG.dayNight;
  const sunElevation = (h) => DN().sunMaxElev * Math.sin(Math.PI * (h - DN().sunrise) / (DN().sunset - DN().sunrise));
  const sunAzimuth = (h) => DN().sunAzimuthRise + 180 * (h - DN().sunrise) / (DN().sunset - DN().sunrise);
  const kOfElevation = (e) => (e <= -8 ? 0 : e < 5 ? 0.5 * (e + 8) / 13 : e < 35 ? 0.5 + 0.5 * (e - 5) / 30 : 1);
  const mode = () => game.settings?.dayCycle || 'auto';
  const startHour = () => (dn.hold != null ? dn.hold : mode() === 'day' ? DN().fixedDayHour : mode() === 'night' ? 0 : DN().startHour);
  const cycleOn = () => !game.dawnOn && !game.heliOn && !game.eternal && sky.phase === 'night';
  const cycleStep = (dt, paused) => {
    if (!cycleOn()) { if (dn.cycle) { dn.cycle = false; if (sun) sun.visible = false; } return; }
    if (!sun) sun = buildSun();
    if (!dn.cycle) { dn.cycle = true; dn.lastK = -1; }
    if (!paused) {
      if (dn.hold != null) dn.hour = dn.hold;
      else if (mode() === 'auto') { dn.hour += 24 * dt / (DN().dayMinutes * 60); if (dn.hour >= 24) { dn.hour -= 24; dn.days++; } }
      else dn.hour = startHour();
    }
    dn.sunEl = sunElevation(dn.hour); dn.sunAz = sunAzimuth(dn.hour);
    const target = kOfElevation(dn.sunEl), step = DN().easeRate * dt;
    sky.k = Math.abs(target - sky.k) <= step ? target : sky.k + Math.sign(target - sky.k) * step;
    dn.acc += dt;
    if (dn.lastK < 0 || (dn.acc > 0.2 && Math.abs(sky.k - dn.lastK) > 0.0004) || (mode() === 'auto' && dn.acc > 0.5)) { dn.acc = 0; dn.lastK = sky.k; applySky(); }
  };
  const resetSky = () => { sky.phase = 'night'; sky.t = 0; dn.hour = startHour(); dn.days = 0; dn.sunEl = sunElevation(dn.hour); dn.sunAz = sunAzimuth(dn.hour); sky.k = kOfElevation(dn.sunEl); dn.cycle = false; dn.lastK = -1; applySky(); if (sun) { sun.visible = false; } };

  // ----------------------------------------------------------------- vue orbitale (historique / secours)
  const orbit = { on: false, t: 0, dur: 12, a0: 0, onEnd: null };
  const startOrbit = (onEnd) => {
    const p = game.player, D = S().dawn;
    orbit.on = true; orbit.t = 0; orbit.dur = D.orbit; orbit.onEnd = onEnd;
    orbit.a0 = Math.atan2(p.pos.z - T.z, p.pos.x - T.x) + Math.PI * 0.35;
    game.camLock = true; p.locked = true; p.releaseInputs?.();
    hud.el.hud.style.visibility = 'hidden'; hud.el.announce.style.visibility = 'visible';
  };
  const endOrbit = () => {
    if (!orbit.on) return;
    orbit.on = false; game.camLock = false; game.player.locked = false;
    hud.el.hud.style.visibility = ''; hud.el.announce.style.visibility = '';
    camera.fov = game.settings.fov; camera.updateProjectionMatrix();
    const f = orbit.onEnd; orbit.onEnd = null; f?.();
  };

  // ----------------------------------------------------------------- évacuation hélicoptère + explosion nucléaire
  const escape = {
    on: false, t: 0, dur: 16.5, onEnd: null,
    heli: null, nuke: null, avatars: [],
    hx0: 0, hy0: 0, hz0: 0, yaw0: 0,
    nukeFired: false, shockHit: false, prevFar: 170, prevFog: 1,
    nukePos: new THREE.Vector3(),
  };

  const buildHeli = () => {
    const root = new THREE.Group();
    const olive = new THREE.MeshStandardMaterial({ color: 0x3b4836, roughness: 0.65, metalness: 0.25 });
    const rescue = new THREE.MeshStandardMaterial({ color: 0xe65a1a, roughness: 0.45, metalness: 0.2, emissive: 0x2e0f04 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.55, metalness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x284058, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.52 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.25, metalness: 0.9 });
    const glowWhite = new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false });
    const add = (geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      parent.add(m); return m;
    };

    // Fuselage avant / nez cockpit
    add(new THREE.BoxGeometry(2.05, 1.45, 2.7), olive, root, 0, 0.92, 0.3);
    add(new THREE.BoxGeometry(1.75, 1.1, 1.35), glass, root, 0, 1.05, 2.15, 0.22, 0, 0);
    add(new THREE.BoxGeometry(1.85, 0.48, 1.45), olive, root, 0, 0.44, 2.1, 0.12, 0, 0);
    // Panneau d'instrumentation cockpit
    add(new THREE.BoxGeometry(1.2, 0.28, 0.4), dark, root, 0, 0.88, 2.05);
    add(new THREE.BoxGeometry(0.9, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0x62e8ff, fog: false }), root, 0, 1.0, 1.9);

    // Cabine arrière / flancs : porte ouverte côté tribord (+x), flanc gauche fermé + banquette
    add(new THREE.BoxGeometry(2.15, 0.18, 3.3), dark, root, 0, 0.2, 0.1); // plancher cabine
    add(new THREE.BoxGeometry(2.1, 0.24, 3.15), olive, root, 0, 1.78, 0.1); // plafond
    add(new THREE.BoxGeometry(0.14, 1.45, 2.8), olive, root, -1.0, 0.95, 0.0); // paroi bâbord (-x)
    add(new THREE.BoxGeometry(0.18, 0.12, 2.3), rescue, root, -1.03, 0.8, 0.0);
    // Pilote + console avant + banquette intérieure
    add(new THREE.BoxGeometry(0.65, 0.14, 2.2), dark, root, -0.55, 0.45, -0.1);
    add(new THREE.BoxGeometry(0.18, 1.45, 0.9), olive, root, 0.98, 0.95, -1.05); // montant arrière droit
    add(new THREE.BoxGeometry(0.18, 1.45, 0.75), olive, root, 0.98, 0.95, 1.25); // montant avant droit
    add(new THREE.BoxGeometry(0.35, 0.08, 1.85), rescue, root, 1.18, 0.16, 0.15); // marchepied tribord
    // Bande orange de secours sur le nez et la turbine
    add(new THREE.BoxGeometry(1.75, 0.42, 1.95), rescue, root, 0, 1.98, 0.15);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 10), dark, root, -0.45, 1.98, -0.95, Math.PI / 2, 0, 0);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 10), dark, root, 0.45, 1.98, -0.95, Math.PI / 2, 0, 0);

    // Patins d'atterrissage
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.055, 0.055, 3.6, 8), dark, root, sx * 1.15, -0.35, 0.2, Math.PI / 2, 0, 0);
      add(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), dark, root, sx * 1.15, -0.25, 2.15, 0.9, 0, 0);
      for (const sz of [-0.6, 1.0]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6), dark, root, sx * 0.98, -0.08, sz, 0, 0, sx * 0.36);
    }

    // Poutre de queue + empennage
    add(new THREE.BoxGeometry(0.46, 0.48, 3.6), olive, root, 0, 1.2, -3.0);
    add(new THREE.BoxGeometry(1.75, 0.08, 0.55), rescue, root, 0, 1.22, -4.1);
    add(new THREE.BoxGeometry(0.14, 1.25, 0.85), rescue, root, 0, 1.68, -4.55, -0.25, 0, 0);

    // Rotor principal (4 pales) + disque de rotation flou
    const rotor = new THREE.Group(); rotor.position.set(0, 2.52, 0.15); root.add(rotor);
    add(new THREE.CylinderGeometry(0.18, 0.22, 0.4, 10), chrome, rotor, 0, -0.05, 0);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.4, metalness: 0.65 });
    for (let i = 0; i < 4; i++) {
      const b = add(new THREE.BoxGeometry(0.24, 0.035, 3.7), bladeMat, rotor, 0, 0.08, 0, 0, (i * Math.PI) / 2, 0);
      b.position.set(Math.sin((i * Math.PI) / 2) * 1.95, 0.08, Math.cos((i * Math.PI) / 2) * 1.95);
      add(new THREE.BoxGeometry(0.25, 0.04, 0.35), rescue, b, 0, 0, 1.72);
    }
    const rotorDisc = add(new THREE.CylinderGeometry(3.85, 3.85, 0.02, 28), new THREE.MeshBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.18, depthWrite: false }), rotor, 0, 0.08, 0);

    // Rotor anti-couple de queue
    const tailRotor = new THREE.Group(); tailRotor.position.set(0.16, 1.98, -4.7); root.add(tailRotor);
    for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(0.03, 1.25, 0.14), bladeMat, tailRotor, 0, 0, 0, (i * Math.PI) / 2, 0, 0);

    // Projecteur avant + cône volumétrique additif (aucune THREE.Light)
    add(new THREE.SphereGeometry(0.14, 10, 8), glowWhite, root, 0, 0.26, 2.65);
    const cone = add(new THREE.ConeGeometry(3.6, 14, 18, 1, true), additive(0xfff0c0, 0.12, { fog: false }), root, 0, -2.5, 8.6, Math.PI / 2 + 0.38, 0, 0);
    cone.renderOrder = 2;

    root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    scene.add(root);
    return { root, rotor, rotorDisc, tailRotor, cone };
  };

  const buildNuke = () => {
    const g = new THREE.Group();
    g.position.copy(escape.nukePos);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 22, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6e18, transparent: true, opacity: 0, fog: false })
    );
    const shockRing = new THREE.Mesh(
      new THREE.RingGeometry(0.84, 1.0, 56),
      new THREE.MeshBasicMaterial({ color: 0xffdfc0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    shockRing.rotation.x = -Math.PI / 2; shockRing.position.y = 4;

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.9, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff8230, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false })
    );
    const stemSmoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 1.15, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5c3624, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false })
    );

    const cap = new THREE.Group();
    const capGlowMat = new THREE.MeshBasicMaterial({ color: 0xff7820, transparent: true, opacity: 0, fog: false });
    const capAshMat = new THREE.MeshBasicMaterial({ color: 0x4b3226, transparent: true, opacity: 0, fog: false });
    const condMat = new THREE.MeshBasicMaterial({ color: 0xfff0dc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

    const capInner = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), capGlowMat);
    capInner.scale.set(1.35, 0.62, 1.35);
    cap.add(capInner);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), i % 2 ? capGlowMat : capAshMat);
      lobe.position.set(Math.cos(a) * 0.95, 0.08 + (i % 3) * 0.12, Math.sin(a) * 0.95);
      lobe.scale.set(1.0, 0.72, 1.0);
      cap.add(lobe);
    }
    const topDome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 12), capAshMat);
    topDome.position.y = 0.28; topDome.scale.set(1.22, 0.58, 1.22);
    cap.add(topDome);

    const condRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.14, 10, 36), condMat);
    condRing.rotation.x = Math.PI / 2;

    g.add(core, fireball, shockRing, stem, stemSmoke, cap, condRing);
    g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 3; } });
    scene.add(g);
    return { g, core, fireball, shockRing, stem, stemSmoke, cap, condRing, capGlowMat, capAshMat, condMat };
  };

  const endEscape = () => {
    if (!escape.on) return;
    escape.on = false;
    for (const a of escape.avatars) dispose(a.av?.root);
    escape.avatars = [];
    dispose(escape.heli?.root); escape.heli = null;
    dispose(escape.nuke?.g); escape.nuke = null;
    dn.fogScale = escape.prevFog ?? 1; dn.lastK = -1;
    camera.far = escape.prevFar || 170;
    camera.fov = game.settings.fov;
    camera.updateProjectionMatrix();
    game.camLock = false; game.player.locked = false;
    hud.el.hud.style.visibility = ''; hud.el.announce.style.visibility = '';
    resetSky();
    const f = escape.onEnd; escape.onEnd = null; f?.();
  };

  const startEscape = (squad, onEnd) => {
    endOrbit();
    if (escape.on) return;
    escape.on = true; escape.t = 0; escape.dur = 16.5; escape.onEnd = onEnd;
    escape.nukeFired = false; escape.shockHit = false;
    escape.prevFar = camera.far || 170;
    escape.prevFog = dn.fogScale ?? 1;
    camera.far = 420; camera.fov = 66; camera.updateProjectionMatrix();
    dn.fogScale = 0.24; dn.lastK = -1; applySky();

    // Point de stationnaire à l'ouest-sud-ouest de l'aiguille (rotor clair de l'aiguille)
    const dirX = 5.4, dirZ = -3.2; // direction vers (T.x, T.z)
    escape.hx0 = T.x - dirX;
    escape.hy0 = TOWER.tip + 0.25;
    escape.hz0 = T.z - dirZ;
    escape.yaw0 = Math.atan2(-dirZ, dirX); // +x (porte ouverte tribord) fait face au balcon
    escape.nukePos.set(T.x + 38, 0, T.z + 22); // cœur de la Grande Île / cathédrale

    escape.heli = buildHeli();
    escape.heli.root.position.set(escape.hx0 - 44, escape.hy0 + 14, escape.hz0 + 24);
    escape.heli.root.rotation.y = escape.yaw0;
    escape.nuke = null;

    // Avatars de tous les joueurs présents sur le balcon de la pointe
    const list = squad && squad.length ? squad : [game.player];
    escape.avatars = list.map((m, idx) => {
      const ch = m.ch || m.avatar?.ch || {
        name: 'Survivant', outfit: 'agent', scale: [1, 1], skin: 0xdcb498, hair: 0x241c16,
        coat: 0x2a2f3a, pants: 0x1e222a, accent: 0xc89a30,
        fp: { sleeve: 0x2a2f3a, hand: 0xdcb498 },
      };
      const av = new Avatar(ch);
      av.setWeapon(m.weapon || m.currentWeapon?.id || 'rifle', m.pap || 0);
      av.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      const ang = (210 + (idx - (list.length - 1) / 2) * 32) * DEG;
      const sx = T.x + Math.cos(ang) * 1.9, sz = T.z + Math.sin(ang) * 1.9;
      av.root.position.set(sx, TOWER.tip, sz);
      scene.add(av.root);
      return {
        av, startPos: new THREE.Vector3(sx, TOWER.tip, sz),
        boardAt: 1.3 + idx * 0.5, boardDur: 1.55,
        seatPos: new THREE.Vector3(-0.35 + (idx % 2) * 0.25, 0.48, -0.75 + Math.floor(idx / 2) * 0.55 + (idx % 2) * 0.35),
        seated: false,
      };
    });

    game.camLock = true; game.player.locked = true; game.player.releaseInputs?.();
    hud.el.hud.style.visibility = 'hidden'; hud.el.announce.style.visibility = 'visible';
    hud.announce('ÉVACUATION EN COURS', 'L\'hélicoptère de secours arrive à la pointe : embarquez !', 4800);
  };

  const escapeStep = (dt) => {
    if (!escape.on || !escape.heli) return;
    escape.t += dt;
    const t = escape.t, H = escape.heli;
    const hx = escape.hx0, hy = escape.hy0, hz = escape.hz0;

    // Rotation des rotors
    const rSpd = t < 6.2 ? 22 : 28;
    H.rotor.rotation.y += rSpd * dt;
    H.tailRotor.rotation.x += rSpd * 1.6 * dt;
    H.rotorDisc.material.opacity = t < 1.2 ? 0.1 + 0.14 * (t / 1.2) : 0.24;

    // Trajectoire de l'hélicoptère
    if (t < 1.5) {
      const e = sm(t / 1.5);
      H.root.position.set(hx - 44 * (1 - e), hy + 14 * (1 - e), hz + 24 * (1 - e));
      H.root.rotation.set(0.08 * (1 - e), escape.yaw0, -0.14 * (1 - e));
    } else if (t < 6.4) {
      const hbob = Math.sin(t * 2.7) * 0.08;
      H.root.position.set(hx, hy + hbob, hz);
      H.root.rotation.set(0, escape.yaw0, Math.sin(t * 1.9) * 0.02);
    } else {
      const k = cl01((t - 6.4) / 10.1), e = k * k * (2 - 0.65 * k);
      const wx = hx - 98 * e, wy = hy + 34 * sm(k) + Math.sin(t * 2.2) * 0.25, wz = hz + 76 * e;
      H.root.position.set(wx, wy, wz);
      const targetYaw = -2.25;
      const dyaw = Math.atan2(Math.sin(targetYaw - escape.yaw0), Math.cos(targetYaw - escape.yaw0));
      const turnK = sm(cl01((t - 6.4) / 3.4));
      let roll = -0.24 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5);
      if (t > 11.15 && t < 12.6) roll += Math.sin((t - 11.15) * 14) * 0.14 * Math.exp(-(t - 11.15) * 2.5);
      H.root.rotation.set(-0.18 * sm(cl01((t - 6.4) / 2.2)), escape.yaw0 + dyaw * turnK, roll);
      H.cone.material.opacity = Math.max(0.03, 0.12 * (1 - k));
    }

    // Animation des survivants : attente -> course vers la cabine -> assis à bord
    for (const a of escape.avatars) {
      if (t < a.boardAt) {
        a.av.root.position.copy(a.startPos);
        a.av.root.lookAt(H.root.position.x, a.startPos.y, H.root.position.z);
        a.av.update({ dt, speed: 0, fwd: 1, pitch: 0, seat: 0 });
      } else if (!a.seated) {
        const u = cl01((t - a.boardAt) / a.boardDur), eu = sm(u);
        const doorWorld = a._tmp || (a._tmp = new THREE.Vector3());
        doorWorld.copy(a.seatPos).applyMatrix4(H.root.matrixWorld);
        a.av.root.position.lerpVectors(a.startPos, doorWorld, eu);
        a.av.root.position.y += Math.sin(u * Math.PI) * 0.34;
        a.av.root.lookAt(doorWorld.x, a.av.root.position.y, doorWorld.z);
        a.av.update({ dt, speed: 4.5, fwd: 1, pitch: 0, seat: 0 });
        if (u >= 1) {
          a.seated = true;
          H.root.add(a.av.root);
          a.av.root.position.copy(a.seatPos);
          a.av.root.rotation.set(0, Math.PI * 0.5, 0);
        }
      } else {
        a.av.root.position.copy(a.seatPos);
        a.av.root.rotation.set(0, Math.PI * 0.5, 0);
        a.av.update({ dt, speed: 0, fwd: 1, pitch: 0, seat: 2 });
      }
    }

    // Étincelles / souffle sous les pales près de la flèche
    if (t > 1.0 && t < 6.8 && Math.random() < dt * 28) {
      fx.emit(T.x + (Math.random() - 0.5) * 5, TOWER.tip + 0.3, T.z + (Math.random() - 0.5) * 5, { count: 1, color: [0xffd080, 0xffe8b0], speed: 3.5, up: 1.5, size: 0.08, life: 0.7, grav: 0.5, spread: 1, glow: true });
    }

    // Détonation nucléaire sur Strasbourg à t = 10.5 s
    if (t >= 10.5 && !escape.nukeFired) {
      escape.nukeFired = true;
      escape.nuke = buildNuke();
      sfx.nuke?.();
      hud.nukeFlash = 1.0;
      game.shake = 2.4;
      hud.announce('FRAPPE NUCLÉAIRE', 'Strasbourg disparaît dans la lumière atomique…', 4500);
    }

    if (escape.nuke) {
      const nt = t - 10.5, N = escape.nuke;
      if (nt > 0.65 && !escape.shockHit) { escape.shockHit = true; sfx.explosion?.(0.95); game.shake = Math.max(game.shake || 0, 1.8); }

      const f1 = cl01(nt / 0.9), f2 = cl01((nt - 0.3) / 4.2);
      const coreR = 6 + 38 * sm(f1);
      N.core.position.y = 14 + 24 * f2;
      N.core.scale.setScalar(coreR * (1 - 0.45 * cl01((nt - 1.2) / 3.0)));
      N.core.material.opacity = nt < 0.7 ? 0.98 : Math.max(0.15, 0.98 * (1 - cl01((nt - 0.7) / 3.4)));

      const fbR = 8 + 26 * sm(cl01(nt / 2.2));
      N.fireball.position.y = 14 + 42 * cl01(nt / 3.5);
      N.fireball.scale.set(fbR * 1.12, fbR * 0.92, fbR * 1.12);
      N.fireball.material.opacity = Math.max(0.25, 0.92 - 0.5 * cl01((nt - 2.0) / 4.0));

      const sk = cl01(nt / 2.6), sr = 4 + 250 * (1 - (1 - sk) ** 2);
      N.shockRing.scale.setScalar(sr);
      N.shockRing.material.opacity = Math.max(0, 0.78 * (1 - sk));

      const stH = 12 + 128 * sm(cl01(nt / 3.4));
      N.stem.position.y = stH * 0.5;
      N.stem.scale.set(16 + 8 * f2, stH, 16 + 8 * f2);
      N.stem.material.opacity = Math.min(0.85, nt * 1.4) * (1 - 0.25 * cl01((nt - 2.5) / 3.5));

      N.stemSmoke.position.y = stH * 0.48;
      N.stemSmoke.scale.set(18 + 10 * f2, stH * 0.95, 18 + 10 * f2);
      N.stemSmoke.material.opacity = cl01((nt - 0.6) / 1.5) * 0.65;

      const capY = Math.max(22, stH - 4);
      const capS = 14 + 34 * sm(cl01((nt - 0.3) / 3.8));
      N.cap.position.y = capY;
      N.cap.scale.setScalar(capS);
      N.cap.rotation.y += dt * 0.18;
      N.capGlowMat.opacity = Math.min(0.92, nt * 1.5) * (1 - 0.3 * cl01((nt - 3.0) / 3.0));
      N.capAshMat.opacity = cl01((nt - 0.7) / 1.6) * 0.88;

      N.condRing.position.y = capY * 0.72;
      N.condRing.scale.setScalar(10 + 38 * sm(cl01((nt - 0.45) / 2.2)));
      N.condRing.material.opacity = Math.max(0, Math.sin(cl01((nt - 0.4) / 3.2) * Math.PI) * 0.65);

      // Lueur apocalyptique dans le ciel & brouillard (+ dôme du ciel sans raccord bleu)
      const flare = Math.exp(-nt * 1.15);
      const glow = cl01(nt / 1.1) * (1 - 0.35 * cl01((nt - 2.5) / 4.0));
      tmpC.copy(NIGHT.bg).lerp(C3(0xc84818), 0.75 * glow).lerp(C3(0xfff4d0), 0.85 * flare);
      scene.background.copy(tmpC);
      tmpD.copy(NIGHT.fog).lerp(C3(0xff7428), 0.8 * glow).lerp(C3(0xffeec8), 0.85 * flare);
      scene.fog.color.copy(tmpD);
      world.sky?.setGradient(`#${tmpC.getHexString()}`, `#${tmpD.getHexString()}`, `#${tmpD.getHexString()}`);
      world.sky?.setK?.(0);
      hemi.color.copy(NIGHT.hemiSky).lerp(C3(0xff9850), 0.75 * glow).lerp(C3(0xffffff), flare);
      hemi.groundColor.copy(NIGHT.hemiGround).lerp(C3(0x6e2a10), 0.7 * glow);
      hemi.intensity = 1.4 + 2.4 * flare + 0.9 * glow;
      moon.color.setHex(0xffb470).lerp(C3(0xffffff), flare);
      moon.intensity = 2.6 + 2.2 * flare;
    }

    if (t >= escape.dur) endEscape();
  };

  const escapeCamera = () => {
    if (!escape.on || !escape.heli) return;
    if (world.sky?.group) world.sky.group.position.set(camera.position.x, 0, camera.position.z);
    const t = escape.t, hp = escape.heli.root.position;
    if (t < 6.4) {
      const u = sm(cl01(t / 6.4));
      const a = 2.6 + u * 0.9, r = 13.5 - u * 1.5;
      camera.position.set(T.x + Math.cos(a) * r, TOWER.tip + 4.5 + u * 3.0, T.z + Math.sin(a) * r);
      camera.lookAt((T.x + hp.x) * 0.5, TOWER.tip + 0.8, (T.z + hp.z) * 0.5);
    } else {
      const k = cl01((t - 6.4) / 10.1), sk = sm(k);
      // Caméra en retrait derrière-gauche de l'hélicoptère : cadre l'hélicoptère qui s'éloigne ET Strasbourg / la flèche derrière
      const cx = hp.x - 16 - 4 * sk;
      const cy = hp.y + 6.2 + 7.5 * sk;
      const cz = hp.z + 12 + 3 * sk;
      const shk = (game.shake || 0) * 0.35;
      camera.position.set(cx + (Math.random() - 0.5) * shk, cy + (Math.random() - 0.5) * shk, cz + (Math.random() - 0.5) * shk);
      const tx = T.x + 18 * sk, ty = escape.nukeFired ? 62 + 34 * cl01((t - 10.5) / 5.5) : 95, tz = T.z + 10 * sk;
      camera.lookAt((hp.x * 0.25 + tx * 0.75), (hp.y * 0.25 + ty * 0.75), (hp.z * 0.25 + tz * 0.75));
    }
  };

  const cameraStep = (dt) => {
    if (escape.on) { escapeCamera(); return; }
    if (!orbit.on) return;
    orbit.t += dt;
    const D = S().dawn, u = Math.min(1, orbit.t / orbit.dur), e = sm(u);
    const a = orbit.a0 + e * Math.PI * 1.5, r = D.orbitRadius[0] + (D.orbitRadius[1] - D.orbitRadius[0]) * e, y = D.orbitHeight[0] + (D.orbitHeight[1] - D.orbitHeight[0]) * e;
    camera.position.set(T.x + Math.cos(a) * r, y, T.z + Math.sin(a) * r);
    camera.lookAt(T.x, TOWER.tip + 6 - 4 * e, T.z);
    if (Math.abs(camera.fov - 68) > 0.1) { camera.fov = 68; camera.updateProjectionMatrix(); }
    if (u >= 1) endOrbit();
  };

  // ----------------------------------------------------------------- mise à jour (toutes les images : jeu normal et pause du solo)
  const step = (dt, paused = false) => {
    if (escape.on) escapeStep(dt);
    if (beam) {
      const t = performance.now() / 1000, pulse = 0.9 + 0.1 * Math.sin(t * 2.4), w = beam.boost || 1;
      beam.inner.material.opacity = 0.7 * pulse * beam.k * Math.min(1.3, w); beam.outer.material.opacity = 0.32 * pulse * beam.k * w;
      const c = camera.position, dx = T.x - c.x, dz = T.z - c.z, y0 = TOWER.needle + 0.5;
      const f = Math.min(1, S().beamFit / Math.hypot(dx, dz, y0 + 260 - c.y));
      beam.g.position.set(c.x + dx * f, c.y + (y0 - c.y) * f, c.z + dz * f);
      beam.g.scale.set(w * f, f, w * f);
    }
    if (fanal) {
      const F = fanal; F.t += dt;
      const target = F.lit ? 1 : 0.18 + 0.82 * F.p, flick = 0.9 + 0.1 * Math.sin(F.t * 17) + 0.05 * Math.sin(F.t * 29);
      const s = F.lit ? 2.2 : target * 1.25, sy = s * flick * (F.lit ? 1.5 : 1);
      F.flame.scale.set(s, sy, s);
      F.f1.material.opacity = (F.lit ? 0.75 : 0.25 + 0.35 * F.p); F.f2.material.opacity = F.lit ? 0.9 : 0.35 + 0.4 * F.p; F.f3.material.opacity = F.lit ? 1 : 0.4 + 0.5 * F.p;
      F.glow.material.opacity = F.lit ? 0.22 : 0.2 * F.p; F.glow.scale.setScalar(F.lit ? 1.5 : 0.7 + 0.6 * F.p);
      if (F.lit && Math.random() < dt * 30) fx.emit(fanalPos.x, fanalPos.y + 1.6, fanalPos.z, { count: 1, color: [0xffc060, 0xfff0c0, 0xff8a20], speed: 0.5, up: 2.6, size: 0.1, life: 1.2, grav: -1, spread: 0.3, glow: true });
    }
    skyStep(dt, paused);
  };

  // ----------------------------------------------------------------- API
  const api = {
    sky, orbit, escape, T, fanalPos,
    get shown() { return !!beam; },
    showBeam() { if (!beam && C && C.P) beam = buildBeam(); },
    showFanal() { if (!fanal && fanalPos) fanal = buildFanal(); },
    show() { api.showBeam(); api.showFanal(); },
    setFanal(p, lit) { api.showFanal(); if (fanal) { fanal.p = Math.max(0, Math.min(1, p || 0)); if (lit) fanal.lit = 1; } },
    boost(w) { if (beam) beam.boost = w; },
    clockText() { const m = Math.floor(dn.hour * 60 / DN().clockMinutes) * DN().clockMinutes; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; },
    clockVisible() { return dn.cycle && mode() === 'auto'; },
    get skyK() { return sky.k; },
    get hour() { return dn.hour; },
    phaseName() { const k = sky.k; return k < 0.12 ? 'NUIT' : k < 0.7 ? (dn.hour < 12 ? 'AUBE' : 'CRÉPUSCULE') : 'JOUR'; },
    holdNight(hour) {
      if (hour == null) { if (dn.hold == null) return; dn.hold = null; if (mode() !== 'auto') dn.hour = startHour(); dn.lastK = -1; return; }
      dn.hold = hour; dn.hour = hour; dn.sunEl = sunElevation(hour); dn.sunAz = sunAzimuth(hour);
      if (cycleOn()) { sky.k = kOfElevation(dn.sunEl); dn.lastK = -1; applySky(); }
    },
    get nightHeld() { return dn.hold != null; },
    setFogScale(v) { if (dn.fogScale === v) return; dn.fogScale = v; dn.lastK = -1; scene.fog.density *= 1; applySky(); },
    nightHealthMult() { return dn.cycle && mode() === 'auto' && sky.k < DN().nightBelowK ? DN().nightZombieHealth : 1; },
    startDawn, startOrbit, endOrbit, startEscape, endEscape, cameraStep, skyStep, resetSky, step,
    get dawnT() { return sky.phase === 'dawn' ? sky.t : sky.phase === 'night' && (sky.k === 0 || dn.cycle) ? 0 : S().dawn.sky; },
    clear() { // nouvelle partie
      endOrbit(); endEscape(); game.camLock = false;
      dispose(beam?.g); dispose(fanal?.g); beam = null; fanal = null;
      resetSky();
    },
    gust(x, y, z, dx, dz) {
      for (let i = 0; i < 26; i++) fx.emit(x - dx * 3 + (Math.random() - 0.5) * 6, y + 0.5 + Math.random() * 2.2, z - dz * 3 + (Math.random() - 0.5) * 6, { count: 1, color: [0xe8f0ff, 0xc8d8f0], speed: 0.4, up: 0.2, size: 0.07, life: 0.9, grav: 0, nx: dx, nz: dz, push: 9, spread: 0.5, glow: true });
    },
  };
  game.summitFx = api;
  game.skyApply = applySky;
  return api;
}
