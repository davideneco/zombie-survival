// Valeurs de référence calculées par le JS (src/config.js) pour les tests headless du port Godot : godot/data/golden/j0.json.
// Usage : node tools/export-golden.mjs   (puis godot --headless --path godot res://tests/runner.tscn)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG, PAP_LEVELS, papStats, papAmmoMult, papPulse, falloffMult } = await import(path.join(ROOT, 'src/config.js'));

// papStats de chaque arme à chaque niveau du Pack-a-Punch
const pap = [];
for (const w of Object.values(CONFIG.weapons)) for (let lv = 1; lv < PAP_LEVELS.length; lv++) pap.push({ weapon: w.id, lv, stats: papStats(w, lv) });

// coefficient du prix des munitions et pulsation du niveau III
const ammo = [0, 1, 2, 3].map((lv) => ({ lv, v: papAmmoMult(lv) }));
const pulse = [];
for (const lv of [0, 1, 2, 3]) for (let i = 0; i <= 40; i++) pulse.push({ lv, t: i * 0.05, v: papPulse(lv, i * 0.05) });

// chute des dégâts : grille de distances (dont les bornes exactes) pour chaque arme, plus une arme sans chute
const falloff = [];
for (const w of Object.values(CONFIG.weapons)) {
  const ds = new Set();
  for (let d = 0; d <= (w.range || 100) * 1.5; d += 2.5) ds.add(d);
  for (const b of [w.falloffStart, w.falloffEnd]) if (b != null) { ds.add(b); ds.add(b - 0.01); ds.add(b + 0.01); }
  for (const d of [...ds].sort((a, b) => a - b)) falloff.push({ weapon: w.id, d, v: falloffMult(w, d) });
}

// santé d'un zombie ordinaire par manche : la formule vit dans game.zombieHealthAt (src/main.js, non importable sans Three.js) ; recopiée ici
const H = CONFIG.zombie.health;
const zombieHealth = [];
for (let r = 0; r <= 60; r++) zombieHealth.push({ round: r, v: r < H.softRound ? H.base + r * H.perRound : Math.round(H.hardBase * Math.pow(H.hardGrowth, r - H.softRound + 1)) });

const out = path.join(ROOT, 'godot/data/golden/j0.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ pap, ammo, pulse, falloff, zombieHealth }) + '\n');
console.log(`${path.relative(ROOT, out)} : ${pap.length} papStats, ${falloff.length} falloff, ${pulse.length} pulse, ${zombieHealth.length} manches`);
