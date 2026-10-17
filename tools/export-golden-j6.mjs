// J6 : valeurs de référence calculées par le JS (src/config.js) pour les tests headless du port Godot : godot/data/golden/j6.json.
//   perks   : prix (solo / co-op), description et couleur de chaque atout (CONFIG.perks)
//   boxPick : tirage de la boîte mystère (machineFx.js hostBoxRoll) pour 400 couples (armes déjà portées, nombre aléatoire r)
//   boxProb : probabilité de chaque arme pour un joueur sans arme de la boîte (poids de CONFIG.box.pool / somme)
//   flop    : dégâts de l'onde du PHD Flopper par manche (main.js flop : base + perRound x max(1, manche))
//   pap     : prix et nom de chaque niveau du Pack-a-Punch
// hostBoxRoll et flop dépendent de Three.js / du DOM (non importables ici) : leurs formules sont recopiées dans ce fichier avec leur source.
// Si elles changent dans le JS, mettre à jour ce fichier.
// Usage : node tools/export-golden-j6.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG, PAP_LEVELS } = await import(path.join(ROOT, 'src/config.js'));

// machineFx.js hostBoxRoll : pool = armes de CONFIG.box.pool que l'acheteur n'a pas ; tirage pondéré avec r = Math.random()
function boxPick(owned, r) {
  const pool = Object.entries(CONFIG.box.pool).filter(([id]) => !owned.includes(id));
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let x = r * total, pick = pool[0]?.[0] || 'smg';
  for (const [id, w] of pool) { if ((x -= w) <= 0) { pick = id; break; } }
  return pick;
}

// générateur déterministe (mulberry32) pour choisir les cas
let seed = 20260917;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const ids = Object.keys(CONFIG.box.pool);
const boxPicks = [];
for (let i = 0; i < 400; i++) {
  const owned = ids.filter(() => rnd() < (i % 4) * 0.15); // 0 à 45 % des armes déjà portées
  const r = i < 40 ? i / 40 : rnd();
  boxPicks.push({ owned, r, pick: boxPick(owned, r) });
}
const total = ids.reduce((s, id) => s + CONFIG.box.pool[id], 0);
const boxProb = Object.fromEntries(ids.map((id) => [id, CONFIG.box.pool[id] / total]));
const flop = [];
for (let r = 0; r <= 40; r++) flop.push({ round: r, damage: CONFIG.phd.base + CONFIG.phd.perRound * Math.max(1, r) });

const out = {
  perks: CONFIG.perks,
  boxPicks, boxProb, flop,
  pap: PAP_LEVELS.map((l, i) => (l ? { lv: i, price: l.price, roman: l.roman } : null)),
  powerups: CONFIG.powerups,
  fuel: CONFIG.vehicles.fuel,
};
const dir = path.join(ROOT, 'godot/data/golden');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'j6.json'), JSON.stringify(out));
console.log(`golden j6 : ${boxPicks.length} tirages de boîte, ${flop.length} ondes de Flopper, ${Object.keys(CONFIG.perks).length} atouts`);
