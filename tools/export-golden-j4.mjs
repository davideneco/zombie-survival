// J4 : valeurs de référence des armes calculées par le JS (src/config.js) pour les tests headless du port Godot : godot/data/golden/j4.json.
//   stats    : statistiques effectives (statsOf de player.js : base + papStats + Double Tap / Speed Cola) de chaque arme à chaque niveau
//   damage   : dégâts d'un projectile selon la distance, au corps et à la tête
//   kills    : nombre de tirs pour tuer un zombie de la manche 10 à 8 m (armes sans explosion ni tirage au sort)
//   area     : dégâts de zone (areaDamage de main.js) selon la distance
//   melee    : dégâts du couteau (meleeDamage de main.js) par manche
//   shell    : trajectoire d'un obus de M79 (launcher.js updateShells) dans le vide
//   nade     : trajectoire d'une grenade à main (main.js updateGrenades) dans le vide, avec rebonds sur le sol
// Les fonctions de main.js / player.js / launcher.js dépendent de Three.js (non importable ici) : leurs formules sont recopiées dans ce
// fichier avec leur source en commentaire. Si elles changent dans le JS, mettre à jour ce fichier.
// Usage : node tools/export-golden-j4.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG, PAP_LEVELS, papStats, falloffMult } = await import(path.join(ROOT, 'src/config.js'));
const { Collision } = await import(path.join(ROOT, 'src/collision.js'));

// player.js statsOf : { ...base, ...papStats(base, lv) }, puis les atouts
function statsOf(id, lv, perks) {
  const base = CONFIG.weapons[id];
  const s = { ...base, ...papStats(base, lv) };
  if (perks.doubletap) { s.fireRate *= 1.33; s.damage *= 1.25; }
  if (perks.speedcola) s.reloadTime *= 0.5;
  return s;
}
const FIELDS = ['damage', 'headMult', 'pierce', 'magSize', 'maxReserve', 'reloadTime', 'spread', 'fireRate', 'pellets', 'range', 'falloffStart', 'falloffEnd', 'minMult', 'splash', 'blast', 'boom', 'ether', 'gl', 'zoom', 'adsFov', 'type', 'cat'];
const pick = (s) => { const o = {}; for (const k of FIELDS) if (s[k] !== undefined) o[k] = s[k]; return o; };
const PERK_SETS = [{}, { doubletap: true }, { speedcola: true }, { doubletap: true, speedcola: true }];

const stats = [];
for (const id of Object.keys(CONFIG.weapons)) {
  for (let lv = 0; lv < PAP_LEVELS.length; lv++) {
    for (const perks of PERK_SETS) stats.push({ id, lv, perks, s: pick(statsOf(id, lv, perks)) });
  }
}

// dégâts d'un projectile (player.js shoot : cfg.damage x falloffMult, tête x headMult)
const DISTS = [0, 3, 10, 20, 35, 60, 100, 150];
const damage = [];
for (const id of Object.keys(CONFIG.weapons)) {
  for (let lv = 0; lv < PAP_LEVELS.length; lv++) {
    const s = statsOf(id, lv, {});
    for (const d of DISTS) damage.push({ id, lv, d, body: s.damage * falloffMult(s, d), head: s.damage * falloffMult(s, d) * s.headMult });
  }
}

// santé d'un zombie ordinaire (main.js zombieHealthAt, recopiée)
const H = CONFIG.zombie.health;
const zombieHealthAt = (r) => (r < H.softRound ? H.base + r * H.perRound : Math.round(H.hardBase * Math.pow(H.hardGrowth, r - H.softRound + 1)));

// tirs pour tuer un zombie de la manche 10 à 8 m, plombs tous au but ; on exclut ce qui explose ou tire au sort (splash, boom, ether, lanceur)
const KILL_ROUND = 10, KILL_DIST = 8;
const kills = [];
for (const id of Object.keys(CONFIG.weapons)) {
  for (let lv = 0; lv < PAP_LEVELS.length; lv++) {
    const s = statsOf(id, lv, {});
    if (s.type === 'launcher' || s.splash || s.boom || s.ether) continue;
    const per = s.damage * falloffMult(s, KILL_DIST) * (s.pellets || 1);
    for (const head of [false, true]) {
      let h = zombieHealthAt(KILL_ROUND), n = 0;
      while (h > 0) { h -= head ? per * s.headMult : per; n++; }
      kills.push({ id, lv, head, n });
    }
  }
}

// main.js areaDamage : damage x (1 - d / radius)^0.6
const area = [];
for (const [damageV, radius] of [[900, 6.5], [1200, 5], [2400, 6.5], [700, 2.5], [1000, 3.5], [3600, 4.55]]) {
  for (let i = 0; i <= 11; i++) { const d = (radius * i) / 11; area.push({ damage: damageV, radius, d, v: damageV * Math.pow(1 - d / radius, 0.6) }); }
}

// main.js meleeDamage
const K = CONFIG.knife;
const melee = [];
for (let r = 1; r <= 40; r++) for (const weak of [false, true]) for (const axe of [false, true]) {
  melee.push({ round: r, weak, axe, v: Math.max(K.minDamage, K.healthFrac * zombieHealthAt(r)) * (weak ? K.weakMult : 1) * (axe ? K.axe.dmgMult : 1) });
}

// launcher.js updateShells, sans mur ni zombie : sous-pas de 20 ms au plus, gravité, fusée
function simShell(o, v0, dt) {
  const C = CONFIG.weapons.m79.proj;
  const col = new Collision(400, 400, 4);
  col.build?.();
  const p = { ...o }, v = { ...v0 };
  let age = 0, dist = 0;
  for (let step = 0; step < 1000; step++) {
    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (let k = 0; k < n; k++) {
      v.y -= C.gravity * h;
      const sp = Math.hypot(v.x, v.y, v.z), len = sp * h;
      const d = { x: v.x / sp, y: v.y / sp, z: v.z / sp };
      const t = col.rayHit(p.x, p.y, p.z, d.x, d.y, d.z, len); // le sol (y = 0) arrête l'obus comme dans le jeu
      age += h;
      if (t < len - 1e-6) { dist += t; return { x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t, dist, age }; }
      p.x += d.x * len; p.y += d.y * len; p.z += d.z * len;
      dist += len;
      if (age >= C.fuse) return { x: p.x, y: p.y, z: p.z, dist, age };
    }
  }
}
const shell = [];
for (const [yaw, pitch] of [[0, 0.1], [0.7, 0.3], [-1.2, -0.05], [2.5, 0.5]]) {
  const sp = CONFIG.weapons.m79.proj.speed;
  const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const o = { x: 3, y: 1.6, z: -4 }, v = { x: dir.x * sp, y: dir.y * sp, z: dir.z * sp };
  const dt = 1 / 60;
  shell.push({ o, v, dt, end: simShell(o, v, dt) });
}

// main.js updateGrenades, sans mur : gravité 18, sol à 0,09 (rebond y x0,35, frottement 0,6), explose quand la mèche arrive à 0
function simNade(o, v0, dt) {
  const G = 18, p = { ...o }, v = { ...v0 };
  let t = CONFIG.grenade.fuse;
  while (true) {
    t -= dt;
    v.y -= G * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    const gy = 0.09;
    if (p.y < gy) { p.y = gy; v.y = Math.abs(v.y) * 0.35; v.x *= 0.6; v.z *= 0.6; if (v.y < 0.6) v.y = 0; }
    if (t <= 0) return { x: p.x, y: p.y, z: p.z };
  }
}
const nade = [];
for (const [yaw, pitch, vx, vz] of [[0, 0.2, 0, 0], [1, -0.1, 2, -1], [-2, 0.6, 0, 3]]) {
  const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const o = { x: 0, y: 1.6, z: 0 };
  const v = { x: dir.x * 15 + vx, y: dir.y * 15 + 3, z: dir.z * 15 + vz };
  nade.push({ o, v, dt: 1 / 60, end: simNade(o, v, 1 / 60) });
}

const out = path.join(ROOT, 'godot/data/golden/j4.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ stats, damage, kills, killRound: KILL_ROUND, killDist: KILL_DIST, area, melee, shell, nade }) + '\n');
console.log(`${path.relative(ROOT, out)} : ${stats.length} stats, ${damage.length} dégâts, ${kills.length} tirs pour tuer, ${area.length} zone, ${melee.length} couteau, ${shell.length} obus, ${nade.length} grenades`);
