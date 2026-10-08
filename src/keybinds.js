// Liaisons de touches (v0.35.1) : réglage purement LOCAL (localStorage, aucun message réseau). Voir CONFIG.keybinds pour les actions et leurs défauts.
//
// Une liaison est une chaîne : 'code:KeyW' = touche PHYSIQUE (e.code : ZQSD en AZERTY = WASD en QWERTY) ou 'key:r' = LETTRE TAPÉE (e.key en minuscule :
// R, E, F, G, M, V, K marchent quel que soit le clavier). Les défauts gardent exactement le comportement du commit 419ea66 : déplacement, sprint, saut
// et armes 1-3 en touches physiques, actions en lettres tapées. Une nouvelle liaison suit le `kind` de l'action : 'code' -> toujours physique ; 'key' ->
// la lettre tapée si c'est une lettre, sinon la touche physique (chiffres, ponctuation, Espace, flèches...).
//
// game.binds : is(action, event) pour un appui, down(action, keys) pour une touche maintenue (keys = player.keys), label / tag pour les textes à l'écran.
// Les noms de touches viennent de navigator.keyboard.getLayoutMap() (Chromium) quand il est disponible, sinon des lettres déjà tapées, sinon de e.code.
import { CONFIG } from './config.js';

const STORE = 'zombie_keybinds';

// Lettre réellement tapée (minuscule), '' pour une touche non imprimable
export const typedLetter = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : '');

const NAMES = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
  AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', Backspace: 'Retour arrière', Tab: 'Tab', CapsLock: 'Verr. maj',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Inser', Delete: 'Suppr', Home: 'Début', End: 'Fin',
  PageUp: 'Page ↑', PageDown: 'Page ↓', NumLock: 'Verr. num', ScrollLock: 'Arrêt défil', Pause: 'Pause', PrintScreen: 'Impr. écran',
  NumpadAdd: 'Pavé +', NumpadSubtract: 'Pavé -', NumpadMultiply: 'Pavé *', NumpadDivide: 'Pavé /', NumpadDecimal: 'Pavé .', NumpadEnter: 'Pavé Entrée',
};
// Touches de caractère : nom de repli quand la disposition du clavier est inconnue (clavier QWERTY)
const PUNCT = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<' };

export function parseBinding(s) {
  const m = /^(code|key):(.+)$/.exec(String(s));
  return m ? { t: m[1], v: m[2] } : null;
}

export function createKeybinds() {
  const defs = CONFIG.keybinds, byId = Object.fromEntries(defs.map((d) => [d.id, d]));
  const map = {};        // action -> liaison ('code:KeyW')
  const parsed = {};     // action -> { t, v }
  let codes = new Set(); // touches physiques liées (les flèches de secours se désactivent si une action les utilise)
  const listeners = [];
  let layout = null;     // navigator.keyboard.getLayoutMap()
  const learned = {};    // code -> lettre déjà tapée (repli sans getLayoutMap)

  const overlap = (a, b) => a === 'all' || b === 'all' || a === b;
  const refresh = () => {
    codes = new Set();
    for (const d of defs) { parsed[d.id] = parseBinding(map[d.id]); if (parsed[d.id].t === 'code') codes.add(parsed[d.id].v); }
  };
  const emit = () => { for (const f of listeners) { try { f(); } catch (err) { console.warn('keybinds', err); } } };

  const b = {
    defs, byId,
    onChange(f) { listeners.push(f); },
    get(id) { return map[id]; },
    isDefault(id) { return map[id] === byId[id].def; },
    anyChanged() { return defs.some((d) => map[d.id] !== d.def); },

    // ---------------------------------------------------------------- lecture des entrées
    is(id, e) { const p = parsed[id]; return p.t === 'code' ? e.code === p.v : typedLetter(e) === p.v; },
    // touche maintenue : keys = player.keys (e.code et 'letter:x'), flèches de secours comprises tant qu'elles ne servent pas à autre chose
    down(id, K) {
      const p = parsed[id];
      if (K[p.t === 'code' ? p.v : 'letter:' + p.v]) return true;
      const alt = byId[id].alt;
      return !!(alt && K[alt] && !codes.has(alt));
    },
    anyMove(K) { return b.down('forward', K) || b.down('left', K) || b.down('back', K) || b.down('right', K); },
    isBound(e) { return defs.some((d) => b.is(d.id, e)); },
    learn(e) { // nom d'une touche déjà tapée (Firefox / Safari n'ont pas getLayoutMap) ; les noms affichés sont alors rafraîchis
      if (!e.code || !/^Key/.test(e.code)) return;
      const l = typedLetter(e).toUpperCase();
      if (l && learned[e.code] !== l) { learned[e.code] = l; if (!layout) emit(); }
    },

    // ---------------------------------------------------------------- noms de touches
    hasLayout() { return !!layout; },
    setLayout(l) { layout = l; emit(); },
    codeName(code) {
      let m = /^Digit(\d)$/.exec(code); if (m) return m[1];
      m = /^Numpad(\d)$/.exec(code); if (m) return 'Pavé ' + m[1];
      if (NAMES[code]) return NAMES[code];
      const lm = layout?.get?.(code);
      if (lm) return lm.length === 1 ? lm.toUpperCase() : lm;
      if (learned[code]) return learned[code];
      if (PUNCT[code]) return PUNCT[code];
      m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
      return code;
    },
    nameOf(binding) { const p = parseBinding(binding); return !p ? '?' : p.t === 'key' ? p.v.toUpperCase() : b.codeName(p.v); },
    label(id) { return b.nameOf(map[id]); },
    tag(id) { return `[${b.label(id)}]`; },
    // « ZQSD » (ou « WASD ») : les quatre touches de déplacement, séparées par un espace si l'une d'elles a un nom long
    moveLabel() {
      const l = ['forward', 'left', 'back', 'right'].map(b.label);
      return l.every((x) => x.length === 1) ? l.join('') : l.join(' ');
    },

    // ---------------------------------------------------------------- modification
    // Liaison déduite d'un appui, ou { error }. ev : touche pressée (pour détecter les conflits sur la touche réelle)
    fromEvent(id, e) {
      if (!e.code || e.key === 'Dead' || e.key === 'Unidentified') return { error: 'Touche non reconnue.' };
      const why = CONFIG.reservedKeys[e.code];
      if (why) return { error: `Touche refusée : ${why}.` };
      const l = typedLetter(e);
      const binding = byId[id].kind === 'key' && l && /^\p{L}$/u.test(l) ? `key:${l}` : `code:${e.code}`;
      return { binding, ev: { code: e.code, letter: l } };
    },
    // Actions (hors id et ignore) dont le contexte recoupe celui de l'action et qui utilisent déjà cette touche
    conflicts(id, binding, ev, ignore = []) {
      const p = parseBinding(binding), out = [];
      for (const d of defs) {
        if (d.id === id || ignore.includes(d.id) || !overlap(d.ctx, byId[id].ctx)) continue;
        const o = parsed[d.id];
        if ((o.t === p.t && o.v === p.v) || (ev && (o.t === 'code' ? o.v === ev.code : o.v === ev.letter))) out.push(d.id);
      }
      return out;
    },
    set(id, binding) { map[id] = binding; refresh(); b.save(); emit(); },
    // other reçoit l'ancienne liaison de id. Renvoie false si cela créerait un nouveau conflit
    swap(id, binding, other) {
      const old = map[id];
      if (b.conflicts(other, old, null, [id, other]).length) return false;
      map[id] = binding; map[other] = old; refresh(); b.save(); emit();
      return true;
    },
    reset(id) { b.set(id, byId[id].def); },
    resetAll() { for (const d of defs) map[d.id] = d.def; refresh(); b.save(); emit(); },

    // ---------------------------------------------------------------- sauvegarde
    save() {
      const out = {};
      for (const d of defs) if (map[d.id] !== d.def) out[d.id] = map[d.id];
      try { if (Object.keys(out).length) localStorage.setItem(STORE, JSON.stringify(out)); else localStorage.removeItem(STORE); } catch {}
    },
    load() {
      for (const d of defs) map[d.id] = d.def;
      refresh();
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch {}
      for (const d of defs) {
        const s = saved[d.id], p = parseBinding(s);
        if (!p || (p.t === 'code' && CONFIG.reservedKeys[p.v])) continue;
        const prev = map[d.id];
        map[d.id] = s; refresh();
        if (b.conflicts(d.id, s, null).length) { map[d.id] = prev; refresh(); } // sauvegarde incohérente (modifiée à la main) : on garde le défaut
      }
    },
  };
  b.load();
  return b;
}

// Installe game.binds et lit la disposition du clavier ; hud : réaffiche les textes qui citent une touche
export function installKeybinds(game, { hud }) {
  const binds = createKeybinds();
  game.binds = binds;
  hud.binds = binds;
  binds.onChange(() => hud.refreshKeys?.());
  window.addEventListener('keydown', (e) => binds.learn(e), true);
  try { navigator.keyboard?.getLayoutMap?.().then((l) => binds.setLayout(l), () => {}); } catch {}
  return binds;
}
