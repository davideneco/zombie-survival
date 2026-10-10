import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TOWER } from './cath/spire.js';

// =====================================================================
//  Acte V « L'Aube » : décor et effets du sommet de la cathédrale, communs à tous les joueurs (la machine à états est dans finale.js).
//   - le faisceau : deux cylindres additifs qui montent de la pointe de la flèche (apparaît après la victoire sur le Bourreau) ;
//   - le Fanal d'Erwin : cage de fer et flamme additive sur le balcon de la pointe ; sa flamme grandit avec la progression commune ;
//   - le ciel : fond, brouillard, lumière de la lune (qui devient le soleil), lampadaires, dégradé et étoiles du dôme : AUCUN nouveau shader ;
//   - la vue orbitale (12 s) autour de la flèche pendant que le Fanal s'allume ;
//   - les rafales de la rampe et les cendres des zombies.
//  Chronologie du ciel (en secondes réelles, indépendante de la pause du solo) : nuit -> aube (dawn.sky s) -> jour (eternal.day s) -> crépuscule
//  (eternal.dusk s) -> nuit éternelle.
// =====================================================================
const DEG = Math.PI / 180;
const C3 = (h) => new THREE.Color(h);
const lerpHex = (out, a, b, k) => out.copy(C3(a)).lerp(C3(b), k);
const sm = (x) => x * x * (3 - 2 * x);

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
  if (C) {
    [T.x, T.z] = C.P(TOWER.c[0], TOWER.c[1]);
    const a = 235 * DEG; // sur le balcon, du côté du garde-corps, adossé à l'aiguille
    const [fx0, fz0] = C.P(TOWER.c[0] + Math.cos(a) * 2.05, TOWER.c[1] + Math.sin(a) * 2.05);
    fanalPos = { x: fx0, z: fz0, y: TOWER.tip };
  }
  game.tower = { x: T.x, z: T.z, top: TOWER.top, tip: TOWER.tip, needle: TOWER.needle, fanal: fanalPos };

  const additive = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, ...extra });
  const dispose = (o) => { if (!o) return; scene.remove(o); o.traverse?.((q) => { if (q.isMesh) { q.geometry.dispose(); const m = q.material; if (m.map && m.map.userData?.own) m.map.dispose(); m.dispose(); } }); };
  const fall = (c, h) => { const cv = document.createElement('canvas'); cv.width = 4; cv.height = h; const x = cv.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c[0]); g.addColorStop(1, c[1]); x.fillStyle = g; x.fillRect(0, 0, 4, h); const t = new THREE.CanvasTexture(cv); t.userData = { own: true }; return t; };

  // ----------------------------------------------------------------- le faisceau
  let beam = null, fanal = null, sun = null;
  const buildBeam = () => {
    const g = new THREE.Group(); g.position.set(T.x, TOWER.needle + 0.5, T.z); // il part de la pointe de l'aiguille : le balcon (128 m) reste sous la lumière, pas dedans
    const tex = fall(['#4a4a4a', '#ffffff'], 128); // clair à la base, jamais éteint : le faisceau reste visible haut dans le ciel
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.4, 260, 20, 1, true), additive(0xffe4a0, 0.7, { map: tex, fog: false }));
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 1.3, 260, 20, 1, true), additive(0xffb860, 0.32, { map: tex, fog: false }));
    inner.position.y = outer.position.y = 130; inner.frustumCulled = outer.frustumCulled = false;
    g.add(inner, outer); scene.add(g);
    return { g, inner, outer, k: 1 };
  };

  // ----------------------------------------------------------------- le Fanal d'Erwin
  const buildFanal = () => {
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
  const tmpC = new THREE.Color(), tmpD = new THREE.Color();
  const pickC = (arr, k, out) => (k < 0.5 ? lerpHex(out, arr[0], arr[1], sm(k * 2)) : lerpHex(out, arr[1], arr[2], sm((k - 0.5) * 2)));
  const pickN = (arr, k) => (k < 0.5 ? arr[0] + (arr[1] - arr[0]) * sm(k * 2) : arr[1] + (arr[2] - arr[1]) * sm((k - 0.5) * 2));
  const pickS = (arr, k) => { const css = (a, b, u) => `#${tmpC.copy(C3(a)).lerp(C3(b), u).getHexString()}`; return k < 0.5 ? css(arr[0], arr[1], sm(k * 2)) : css(arr[1], arr[2], sm((k - 0.5) * 2)); };
  const applySky = () => {
    const k = sky.k, b = game.settings?.brightness ?? 1.4;
    pickC(SKY.bg, k, scene.background);
    pickC(SKY.fog, k, scene.fog.color); scene.fog.density = pickN(SKY.density, k) * (CONFIG.map === 'arena' ? 1.15 : 1);
    pickC(SKY.hemiSky, k, hemi.color); pickC(SKY.hemiGround, k, hemi.groundColor); hemi.intensity = pickN(SKY.hemi, k) * b;
    pickC(SKY.sun, k, moon.color); moon.intensity = pickN(SKY.sunI, k);
    const e = k < 0.5 ? sm(k * 2) : 1 + sm((k - 0.5) * 2) - 1, i0 = k < 0.5 ? 0 : 1, i1 = k < 0.5 ? 1 : 2, u = k < 0.5 ? sm(k * 2) : sm((k - 0.5) * 2);
    void e;
    moonOffset.set(SKY.sunPos[i0][0] + (SKY.sunPos[i1][0] - SKY.sunPos[i0][0]) * u, SKY.sunPos[i0][1] + (SKY.sunPos[i1][1] - SKY.sunPos[i0][1]) * u, SKY.sunPos[i0][2] + (SKY.sunPos[i1][2] - SKY.sunPos[i0][2]) * u);
    world.sky?.setGradient(pickS(SKY.domeTop, k), pickS(SKY.domeMid, k), pickS(SKY.domeBot, k));
    if (world.sky?.stars) world.sky.stars.visible = k < 0.28;
    world.setLampScale?.(1 - 0.92 * sm(Math.min(1, k * 1.3)));
    if (sun) { // monte à l'est (+x) de -4° à 38° d'élévation
      sun.visible = k > 0.02;
      const el = (-4 + 42 * sm(k)) * DEG, az = 20 * DEG, R = 270;
      sun.position.set(Math.cos(el) * Math.cos(az) * R, Math.sin(el) * R, Math.cos(el) * Math.sin(az) * R);
      sun.material.opacity = Math.min(1, k * 5) * (1 - 0.35 * sm(Math.max(0, k - 0.6) / 0.4));
    }
    if (beam) { const f = 1 - 0.55 * sm(Math.max(0, k - 0.3) / 0.7); beam.k = f; }
  };
  sky.apply = applySky;
  // phase : 'dawn' (k de 0 à 1 en dawn.sky s), 'day' (60 s), 'dusk' (k de 1 à 0), 'night'. `from` : secondes déjà écoulées de l'aube
  const startDawn = (from = 0) => { if (!sun) sun = buildSun(); sky.phase = 'dawn'; sky.t = from; };
  const skyStep = (dt) => {
    if (sky.phase === 'night' && sky.k === 0) return;
    const D = S().dawn, E = S().eternal;
    sky.t += dt;
    if (sky.phase === 'dawn') { sky.k = Math.min(1, sky.t / D.sky); if (sky.t >= D.sky) { sky.phase = 'day'; sky.t = 0; } }
    else if (sky.phase === 'day') { sky.k = 1; if (sky.t >= E.day) { sky.phase = 'dusk'; sky.t = 0; game.onDusk?.(); } }
    else if (sky.phase === 'dusk') { sky.k = Math.max(0, 1 - sky.t / E.dusk); if (sky.t >= E.dusk) { sky.phase = 'night'; sky.k = 0; } }
    applySky();
  };
  const resetSky = () => { sky.phase = 'night'; sky.t = 0; sky.k = 0; applySky(); if (sun) { sun.visible = false; } };

  // ----------------------------------------------------------------- vue orbitale
  const orbit = { on: false, t: 0, dur: 12, a0: 0, onEnd: null };
  const startOrbit = (onEnd) => {
    const p = game.player, D = S().dawn;
    orbit.on = true; orbit.t = 0; orbit.dur = D.orbit; orbit.onEnd = onEnd;
    orbit.a0 = Math.atan2(p.pos.z - T.z, p.pos.x - T.x) + Math.PI * 0.35;
    game.camLock = true; p.locked = true; p.releaseInputs?.();
    hud.el.hud.style.visibility = 'hidden'; hud.el.announce.style.visibility = 'visible'; // vue de cinéma : ni arme ni interface (sauf l'annonce)
  };
  const endOrbit = () => {
    if (!orbit.on) return;
    orbit.on = false; game.camLock = false; game.player.locked = false;
    hud.el.hud.style.visibility = ''; hud.el.announce.style.visibility = '';
    camera.fov = game.settings.fov; camera.updateProjectionMatrix();
    const f = orbit.onEnd; orbit.onEnd = null; f?.();
  };
  const cameraStep = (dt) => {
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
  const step = (dt) => {
    if (beam) { // le faisceau palpite ; ignition : plus large et plus clair
      const t = performance.now() / 1000, pulse = 0.9 + 0.1 * Math.sin(t * 2.4), w = beam.boost || 1;
      beam.inner.material.opacity = 0.7 * pulse * beam.k * Math.min(1.3, w); beam.outer.material.opacity = 0.32 * pulse * beam.k * w;
      // visible de toute la ville sans reculer le plan de coupe de la caméra (170 m, le brouillard cache le reste) : le faisceau est homothétique
      // de la caméra, de rapport f <= 1 tel que sa pointe reste dans le champ ; l'image à l'écran est la même, la profondeur seule change
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
    skyStep(dt);
  };

  // ----------------------------------------------------------------- API
  const api = {
    sky, orbit, T, fanalPos,
    get shown() { return !!beam; },
    showBeam() { if (!beam && C) beam = buildBeam(); },
    showFanal() { if (!fanal && fanalPos) fanal = buildFanal(); },
    show() { api.showBeam(); api.showFanal(); },
    setFanal(p, lit) { api.showFanal(); if (fanal) { fanal.p = Math.max(0, Math.min(1, p || 0)); if (lit) fanal.lit = 1; } },
    boost(w) { if (beam) beam.boost = w; },
    startDawn, startOrbit, endOrbit, cameraStep, skyStep, resetSky, step,
    get dawnT() { return sky.phase === 'dawn' ? sky.t : sky.phase === 'night' && sky.k === 0 ? 0 : S().dawn.sky; },
    clear() { // nouvelle partie
      endOrbit(); game.camLock = false;
      dispose(beam?.g); dispose(fanal?.g); beam = null; fanal = null;
      resetSky();
    },
    // rafale : traînées blanches autour du joueur (le déplacement est appliqué par chacun à son joueur : finale.js)
    gust(x, y, z, dx, dz) {
      for (let i = 0; i < 26; i++) fx.emit(x - dx * 3 + (Math.random() - 0.5) * 6, y + 0.5 + Math.random() * 2.2, z - dz * 3 + (Math.random() - 0.5) * 6, { count: 1, color: [0xe8f0ff, 0xc8d8f0], speed: 0.4, up: 0.2, size: 0.07, life: 0.9, grav: 0, nx: dx, nz: dz, push: 9, spread: 0.5, glow: true });
    },
  };
  game.summitFx = api;
  game.skyApply = applySky;
  return api;
}
