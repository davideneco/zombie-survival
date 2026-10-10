// Chat écrit (v0.42.0) : en multijoueur, la touche « Chat » (Entrée par défaut, Options > Touches) ouvre une ligne de saisie en bas à gauche ;
// Entrée envoie, Échap ferme sans envoyer. Les derniers messages s'affichent au-dessus, le nom du joueur dans la couleur de son emplacement.
//
// Réseau : message `chat {text}` ; le relais (server/rooms.mjs) nettoie le texte, applique le débit, écrase `from` et diffuse à TOUS les
// membres, expéditeur compris : on n'affiche donc jamais son propre message en local (pas de doublon). Le NOM affiché vient de la liste des
// membres du salon (game.remotes, ou game.playerName pour soi), jamais d'un champ envoyé. Le texte n'est affiché que par textContent.
//
// Saisie : la couche 'chat' s'ajoute à la pile game.ui.stack (ui.js) et Échap la ferme avant tout le reste, sans ouvrir la pause. Le champ prend
// le focus et arrête la propagation de TOUTES les touches : aucun écouteur du jeu (déplacement, armes, F9, carte, conduite…) ne les voit. Les
// touches déjà enfoncées sont relâchées à l'ouverture. Le pointer lock est LIBÉRÉ à l'ouverture (Échap n'est alors pas avalé par le navigateur et la
// souris ne tourne plus la caméra) puis redemandé à l'envoi / l'annulation ; si le navigateur refuse, le bandeau « Cliquez pour reprendre »
// habituel apparaît. ui.onPointerUnlocked() demande à absorbUnlock() si la libération vient de nous (alors ce n'est pas un appui d'Échap).
import { CONFIG } from './config.js';
import { slotColor } from './characters.js';
import { cleanChat } from './chatText.js';

const $ = (id) => document.getElementById(id);

export function installChat(game, { hud, sfx, canvas }) {
  const C = CONFIG.chat;
  const root = $('chat'), log = $('chatLog'), input = $('chatInput'), btnShow = $('btnChatShow');
  const lines = [];                     // { el, age, op, name, text, sys } : du plus ancien au plus récent
  const S = { open: false, wasLocked: false, unlockPending: false, relockPending: false, relockT: 0, unlockT: 0, dirty: true, stick: true, sent: [], shown: false };
  root.style.setProperty('--chat-lines', C.visibleLines);
  input.maxLength = C.maxLen;
  input.placeholder = 'Message…  Entrée : envoyer · Échap : annuler';

  const visible = () => game.settings.chat !== false;
  const overlayUp = () => !hud.el.overlay.classList.contains('hidden');
  const inGame = () => game.started && !game.over && game.playing && !overlayUp();

  const chat = game.chat = {
    get open() { return S.open; },
    lines, // lecture seule (outils de test)

    // ---------------------------------------------------------------- journal
    add(name, color, text, sys = false) {
      const el = document.createElement('div');
      el.className = sys ? 'chat-line sys' : 'chat-line';
      if (!sys) {
        const b = document.createElement('b');
        b.textContent = name;                                   // textContent : jamais de HTML venu d'un autre joueur
        b.style.color = color;
        el.append(b, document.createTextNode(': '));
      }
      const span = document.createElement('span');
      span.textContent = text;
      el.appendChild(span);
      log.appendChild(el);
      lines.push({ el, age: 0, op: 1, name, text, sys });
      while (lines.length > C.history) lines.shift().el.remove();
      S.dirty = true;
    },
    system(text) { chat.add('', '', text, true); },

    // Message `chat` du relais : { from, text }
    receive(m) {
      const text = cleanChat(m.text, C.maxLen);
      if (!text) return;
      const mine = m.from === game.net?.id, rp = game.remotes.get(m.from);
      const name = cleanChat(mine ? game.playerName : rp ? rp.name : 'Joueur', 24) || 'Joueur';
      chat.add(name, slotColor(mine ? game.mySlot : rp ? rp.slot : 0), text);
      if (!mine && visible()) sfx.chat?.();
    },
    limited() { chat.system('Vous écrivez trop vite : message ignoré.'); },

    // ---------------------------------------------------------------- saisie
    openInput() {
      if (S.open) return;
      if (!game.isMultiplayer || !game.net) { hud.toast('Le chat est disponible en multijoueur'); return; }
      if (!visible()) { hud.toast('Chat masqué : Options > Afficher le chat'); return; }
      if (!inGame()) return;
      S.open = true;
      S.wasLocked = document.pointerLockElement === canvas;
      game.player.releaseInputs(); // plus aucune touche ni aucun bouton « enfoncé » : le joueur ne bouge pas tout seul
      if (S.wasLocked) {
        S.unlockPending = true; document.exitPointerLock();
        clearTimeout(S.unlockT); // si l'événement n'arrive jamais, on ne garde pas un « Échap » à avaler
        S.unlockT = setTimeout(() => { if (S.unlockPending) { S.unlockPending = false; if (S.relockPending) { S.relockPending = false; relockPointer(); } } }, 1000);
      }
      root.classList.add('typing');
      input.value = '';
      S.stick = true; S.dirty = true;
      input.focus({ preventScroll: true });
      chat.update(0); // les lignes estompées reviennent tout de suite (sans attendre l'image suivante)
    },
    // send : envoyer le texte saisi ; relock : redemander la souris
    close({ send = false, relock = true } = {}) {
      if (!S.open) return;
      S.open = false;
      const text = input.value;
      input.value = '';
      root.classList.remove('typing');
      if (document.activeElement === input) input.blur();
      for (const l of lines) l.age = Math.min(l.age, C.fadeAfter - 2); // les lignes restent encore un instant après la saisie
      S.dirty = true;
      game.player.releaseInputs();
      if (send && text.trim()) chat.send(text);
      if (relock && S.wasLocked) relockPointer();
      S.wasLocked = false;
      chat.update(0);
    },
    send(raw) {
      const text = cleanChat(raw, C.maxLen);
      if (!text || !game.net?.connected) return;
      const now = performance.now(), keep = S.sent.filter((t) => now - t < C.rateWindow * 1000);
      if (keep.length >= C.rateCount) { S.sent = keep; chat.limited(); return; } // même limite que le relais, pour le dire tout de suite
      keep.push(now); S.sent = keep;
      game.net.send({ t: 'chat', text });
    },

    // La souris vient d'être libérée (pointerlockchange) : est-ce nous qui l'avons demandé ? Alors ce n'est pas un appui d'Échap.
    absorbUnlock() {
      if (S.unlockPending) {
        S.unlockPending = false;
        if (S.relockPending) { S.relockPending = false; relockPointer(); }
        return true;
      }
      return S.open;
    },

    setVisible(on) {
      game.settings.chat = on;
      game.saveSettings();
      if (!on) chat.close({ send: false });
      syncButton();
      S.dirty = true;
    },

    // ---------------------------------------------------------------- affichage (appelé à chaque image, dt en secondes)
    update(dt) {
      const show = visible() && game.isMultiplayer && game.started && !overlayUp();
      if (show !== S.shown) { S.shown = show; root.classList.toggle('on', show); S.dirty = true; }
      if (S.open && (!game.playing || game.over || !game.started)) chat.close({ send: false, relock: false }); // pause, fin de partie : la saisie se ferme
      if (!show) return;
      for (const l of lines) {
        if (!S.open) l.age += dt;
        const op = S.open ? 1 : l.age < C.fadeAfter ? 1 : Math.max(0, 1 - (l.age - C.fadeAfter) / C.fadeTime);
        if (Math.abs(op - l.op) > 0.01 || (op === 0) !== (l.op === 0)) {
          l.op = op; S.dirty = true;
          l.el.style.opacity = op.toFixed(2);
          l.el.style.display = op <= 0.01 ? 'none' : '';
        }
      }
      if (S.dirty) {
        S.dirty = false;
        if (S.stick || !S.open) log.scrollTop = log.scrollHeight;
      }
    },
  };

  // ---------------------------------------------------------------- pointer lock
  function relockPointer() {
    if (document.pointerLockElement === canvas || !game.started || game.over) return;
    if (S.unlockPending) { S.relockPending = true; return; } // la libération n'est pas encore arrivée : on attend son événement
    let req;
    try { req = canvas.requestPointerLock(); } catch { req = null; }
    const refused = () => { // le navigateur refuse (pas de geste récent) : bandeau « Cliquez pour reprendre », comme après un Échap
      if (S.open || document.pointerLockElement === canvas || !game.playing || game.over) return;
      game.playing = false; game.player.releaseInputs();
      game.ui.showBanner(true);
    };
    if (req && req.then) req.then(() => {}, refused);
    clearTimeout(S.relockT);
    S.relockT = setTimeout(refused, 700);
  }

  // ---------------------------------------------------------------- clavier
  // Ouverture : la liaison « Chat » (window, après le Player : il a déjà vu la touche, releaseInputs la rend)
  window.addEventListener('keydown', (e) => {
    if (e.repeat || S.open || !game.binds.is('chat', e) || e.ctrlKey || e.altKey || e.metaKey) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if (!game.started || game.over || !game.playing || overlayUp()) return; // menus, pause : la touche ne fait rien
    e.preventDefault(); // la touche ne doit pas s'écrire dans le champ qu'on ouvre (liaison sur une lettre)
    chat.openInput();
  });
  // Dans le champ : le jeu ne voit AUCUNE touche (propagation arrêtée ici, avant les écouteurs de la fenêtre)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat && !e.isComposing) chat.close({ send: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); if (!e.repeat) game.ui.escape(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('keypress', (e) => e.stopPropagation());
  input.addEventListener('blur', () => { if (S.open) chat.close({ send: false }); });
  log.addEventListener('mousedown', (e) => e.preventDefault()); // faire défiler le journal ne retire pas le focus du champ
  // Molette pendant la saisie : historique (et jamais changement d'arme)
  window.addEventListener('wheel', (e) => {
    if (!S.open) return;
    e.stopImmediatePropagation(); e.preventDefault();
    log.scrollTop += e.deltaY;
    S.stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  }, { capture: true, passive: false });
  // Un clic sur la scène pendant la saisie la ferme (le clic redonne aussi la souris au jeu : main.js)
  canvas.addEventListener('click', () => { if (S.open) chat.close({ send: false, relock: false }); });

  // ---------------------------------------------------------------- option « Afficher le chat »
  function syncButton() { if (btnShow) btnShow.textContent = `AFFICHER LE CHAT : ${visible() ? 'OUI' : 'NON'}`; }
  if (btnShow) btnShow.addEventListener('click', (e) => { e.stopPropagation(); chat.setVisible(!visible()); });
  syncButton();
  return chat;
}
