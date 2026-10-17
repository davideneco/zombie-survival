// Liste des sons du jeu JS (src/audio.js) à cuire pour le port Godot (J8) : partagée par tools/bake-audio.mjs et tools/export-golden-j8.mjs.
// Chaque entrée : name (fichier), call (méthode de Sfx), args, variants (nombre de rendus aléatoires), dur (secondes max rendues ; la fin silencieuse est rognée).
import { CONFIG } from '../src/config.js';

export const GUN_IDS = Object.keys(CONFIG.weapons);

export function soundList() {
  const L = [];
  const add = (name, call, args = [], variants = 1, dur = 4) => L.push({ name, call, args, variants, dur });
  for (const id of GUN_IDS) add(`gun_${id}`, 'gun', [id, 1, 0], 3, 3);
  // rechargement : une cuisson par (catégorie, durée) car les claquements sont placés en fraction de la durée
  const reloads = {};
  for (const [id, w] of Object.entries(CONFIG.weapons)) {
    const cat = w.cat, t = w.reloadTime;
    const name = `reload_${cat}_${String(t).replace('.', 'p')}`;
    if (!reloads[name]) { reloads[name] = id; add(name, 'reload', [cat, t], 1, t + 1); }
  }
  add('empty', 'empty'); add('vault', 'vault');
  add('knife_swing', 'knife', ['swing']); add('knife_flesh', 'knife', ['flesh']); add('knife_metal', 'knife', ['metal']);
  add('hit_head', 'hit', [true], 3, 1); add('hit_flesh', 'hit', [false], 3, 1);
  add('kill', 'kill', [], 3, 1); add('hurt', 'hurt', [], 3, 1);
  add('mount_moto', 'mount', ['moto'], 1, 2); add('mount_grosseMoto', 'mount', ['grosseMoto'], 1, 2); add('mount_velo', 'mount', ['velo'], 1, 1);
  add('beep', 'beep'); add('cough', 'cough', [1]); add('alarm', 'alarm', [1]); add('down', 'down', [1]);
  add('crash', 'crash', [1], 2, 1.5);
  add('tram_gong', 'tramGong', [1], 1, 5); add('tram_chime_open', 'tramChime', [true, 1]); add('tram_chime_close', 'tramChime', [false, 1]);
  add('tram_switch', 'tramSwitch', [1]); add('tram_brake', 'tramBrake', [1, 14], 2);
  add('buy', 'buy'); add('chat', 'chat', [1]); add('deny', 'deny');
  add('round_start', 'roundStart', [], 1, 3); add('round_end', 'roundEnd', [], 1, 3);
  add('powerup', 'powerup'); add('nuke', 'nuke', [], 1, 3); add('tick', 'tick', [0]); add('pap_work', 'papWork', [], 1, 6);
  add('bell', 'bell', [], 1, 5); add('explosion', 'explosion', [1], 3, 3); add('pap', 'pap', [], 1, 3); add('jingle', 'jingle');
  add('knock', 'knock', [1]); add('glass', 'glass', [1], 2, 2); add('rumble', 'rumble', [1], 2, 2); add('dirt', 'dirt', [1], 2, 2);
  add('groan', 'groan', [1], 4, 3);
  return { list: L, reloads };
}

// Boucles de moteur : rendu d'une seconde de régime stable, bouclée par fondu enchaîné. rpm / throttle / ratio : valeurs de set() utilisées pour la cuisson.
export const ENGINES = [
  { name: 'engine_moto', kind: 'moto', create: 'createEngine', rpm: 0.5, throttle: 0.5, ratio: 0.3 },
  { name: 'engine_grosseMoto', kind: 'grosseMoto', create: 'createEngine', rpm: 0.5, throttle: 0.5, ratio: 0.3 },
  { name: 'engine_tram', kind: 'tram', create: 'createTramEngine', ratio: 0.5, throttle: 0.5 },
];

// Musique : niveau (0 calme, 1 rythmé, 2 dur, 3 à fond) -> intensité (CONFIG des seuils : music.js _beginBar), 16 mesures (verse, verse, chorus, chorus)
export const MUSIC_LEVELS = [
  { level: 0, intensity: 0.0, lull: true }, { level: 1, intensity: 0.3 }, { level: 2, intensity: 0.6 }, { level: 3, intensity: 1.0 },
];
export const MUSIC_BARS = 16;
