// Exporte src/config.js vers godot/data/config.json (CONFIG + PAP_LEVELS), lu par l'autoload Config du port Godot.
// La résolution des calibres s'exécute à l'import du module : le JSON contient déjà damage, headMult, pierce et la chute des dégâts.
// Ne jamais modifier le JSON à la main. Usage : node tools/export-config.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CONFIG, PAP_LEVELS } = await import(path.join(ROOT, 'src/config.js'));

// JSON n'a ni fonction, ni Infinity, ni NaN : on refuse plutôt que d'écrire silencieusement null ou d'omettre une valeur
const problems = [];
(function check(v, p) {
  if (typeof v === 'function') problems.push(`${p} : fonction`);
  else if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${p} : ${v}`);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) check(v[k], `${p}.${k}`);
})({ CONFIG, PAP_LEVELS }, '$');
if (problems.length) { console.error('Valeurs non exportables en JSON :\n' + problems.join('\n')); process.exit(1); }

const out = path.join(ROOT, 'godot/data/config.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ CONFIG, PAP_LEVELS }, null, 1) + '\n');
console.log(`${path.relative(ROOT, out)} : ${(fs.statSync(out).size / 1024).toFixed(1)} Ko`);
