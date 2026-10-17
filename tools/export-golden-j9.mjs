// J9 : valeurs de référence calculées par le JS pour les tests headless des graphismes du port Godot : godot/data/golden/j9.json.
//   levels   : CONFIG.graphics.levels, pixelRatio résolu (applyQuality), nombre de taches de sang (fx.js setQuality), part de particules
//   pick     : pickN de src/graphics.js (le VRAI code, extrait du fichier et exécuté) pour les tableaux de CONFIG.graphics.env.phaseIntensity et une grille de k
//   lut      : buildLut de src/graphics.js (le VRAI code) : 128 entrées de la table de couleurs 32^3 et la somme des 98 304 octets
//   zones    : exposition / reflets / torche de chaque zone et du défaut, pas de lissage (1 - exp(-dt x zoneBlend)) pour quelques dt
//   post     : wantPost (qualité x cinéma x taille d'écran) et conditions du halo (makePost) : table de vérité
//   exposure : renderer.toneMappingExposure (applyExposure) et intensité des reflets (envIntensity) pour une grille de luminosité / zone / k
//   emit     : nombre de particules émises (fx.js emit : partK >= 1 ? count : max(1, round(count x partK)))
// Les fonctions de graphics.js sont extraites du fichier (tout ce qui précède POST_VERT) et chargées telles quelles ; les formules qui vivent dans
// des fermetures (wantPost, applyExposure, envIntensity, emit) sont recopiées avec leur référence : le test Godot les confronte à ces transcriptions.
// Usage : node tools/export-golden-j9.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.document = { getElementById: () => null, createElement: () => ({ getContext: () => ({}) }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
const { CONFIG } = await import(path.join(ROOT, 'src/config.js'));

// graphics.js : jusqu'à POST_VERT, imports réécrits vers ../src ; deux exports ajoutés
let src = fs.readFileSync(path.join(ROOT, 'src/graphics.js'), 'utf8');
src = src.slice(0, src.indexOf('const POST_VERT'));
src = src.replace(/from '\.\/([^']+)'/g, "from '../src/$1'") + '\nexport { pickN, buildLut, sm };\n';
const tmp = path.join(ROOT, 'tools/.j9-graphics-extract.mjs');
fs.writeFileSync(tmp, src);
let G;
try { G = await import(tmp); } finally { fs.rmSync(tmp, { force: true }); }
const { pickN, buildLut } = G;

const g = CONFIG.graphics;
const round = (v) => Math.round(v * 1e9) / 1e9;

// ---- niveaux
const levels = g.levels.map((L, q) => ({
  q, name: L.name, pixelRatio: L.pixelRatio === 'device' ? 1 : L.pixelRatio, shadows: L.shadows, softShadows: L.softShadows, shadowSize: L.shadowSize, clouds: L.clouds,
  post: L.post, facade: L.facade, trees: L.trees, particles: L.particles, decals: L.decals, decalMax: Math.min(64, L.decals),
}));

// ---- pickN
const pick = [];
for (const arr of [g.env.phaseIntensity, [0, 1, 4], [3, -2, 0.5]]) for (let i = 0; i <= 40; i++) { const k = i / 40; pick.push({ arr, k, v: round(pickN(arr, k)) }); }

// ---- table de couleurs
const lutTex = buildLut();
const lut = lutTex.image.data;
let sum = 0; for (let i = 0; i < lut.length; i++) sum += lut[i];
const lutSamples = [];
let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
for (let n = 0; n < 128; n++) { const r = Math.floor(rnd() * 32), gg = Math.floor(rnd() * 32), b = Math.floor(rnd() * 32), o = ((gg * 1024) + b * 32 + r) * 4; lutSamples.push({ r, g: gg, b, rgb: [lut[o], lut[o + 1], lut[o + 2]] }); }
for (const [r, gg, b] of [[0, 0, 0], [31, 31, 31], [31, 0, 0], [0, 31, 0], [0, 0, 31], [16, 16, 16]]) { const o = ((gg * 1024) + b * 32 + r) * 4; lutSamples.push({ r, g: gg, b, rgb: [lut[o], lut[o + 1], lut[o + 2]] }); }

// ---- zones
const zoneNames = Object.keys(g.zones);
const zones = { names: zoneNames, blend: g.zoneBlend, steps: [0.016, 0.05, 0.2, 1.0].map((dt) => ({ dt, k: round(1 - Math.exp(-dt * g.zoneBlend)) })) };

// ---- passe finale et halo (graphics.js wantPost / makePost)
const post = [];
for (const q of [0, 1, 2]) for (const cinema of [true, false]) for (const halo of [true, false]) for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
  const L = g.levels[q];
  const want = !!(L && L.post && g.post.enabled && cinema) && w * h <= g.post.maxPixels;     // wantPost
  const wantHalo = want && g.halo.enabled && halo !== false && (L.halo ?? true);              // makePost : const halo = H.enabled && settings.halo !== false && (api.level?.halo ?? true)
  post.push({ q, cinema, halo, w, h, post: want, wantHalo, samples: w * h > g.post.msaa2Pixels ? 2 : g.post.samples });
}

// ---- exposition et reflets
const exposure = [];
for (const b of [0.6, 1.0, 1.4, 2.2, 3.0]) for (const name of [...zoneNames, 'inconnue']) for (const k of [0, 0.3, 0.5, 1]) {
  const Z = g.zones[name] || g.zones.default;
  exposure.push({ brightness: b, zone: name, k, exposure: round(g.tone.exposure * b * Z.exposure), env: round(g.env.intensity * pickN(g.env.phaseIntensity, k) * Z.env) });
}
const haloDawn = [0, 0.2, 0.5, 0.8, 1].map((k) => ({ k, v: round(g.halo.intensity * (1 - g.halo.dawnFade * Math.min(1, k * 1.6))) }));

// ---- particules
const emit = [];
for (const partK of [0.5, 0.75, 1]) for (const count of [1, 2, 3, 4, 8, 16, 18, 22, 26, 36]) emit.push({ partK, count, n: partK >= 1 ? count : Math.max(1, Math.round(count * partK)) });

fs.writeFileSync(path.join(ROOT, 'godot/data/golden/j9.json'), JSON.stringify({ levels, pick, lut: { sum, samples: lutSamples }, zones, post, exposure, haloDawn, emit }) + '\n');
console.log('golden j9 :', levels.length, 'niveaux,', pick.length, 'pickN,', lutSamples.length, 'entrées de table,', post.length, 'cas de passe finale,', exposure.length, 'expositions,', emit.length, 'émissions');
