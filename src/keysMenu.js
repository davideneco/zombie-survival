// Menu Options > Touches (v0.35.1) : liste des actions avec leur touche, clic -> « Appuyez sur une touche… », conflits (échange ou refus),
// « Réinitialiser » par action et « Tout réinitialiser ». Les liaisons vivent dans game.binds (keybinds.js) ; ce module ne fait que l'interface.
//
// Couches de la pile `game.ui.stack` : 'keys' (le panneau), puis 'capture' (attente d'une touche) ou 'conflict' (question d'échange). Échap annule la
// couche du dessus (ui.js -> keysMenu.cancel) sans fermer le menu ; pendant la capture, toutes les autres touches sont consommées ici (phase de
// capture de la fenêtre, stopImmediatePropagation) pour que le jeu ne les voie pas.
import { CONFIG } from './config.js';

export function installKeysMenu(game, { hud }) {
  const B = game.binds, el = hud.el, panel = el.keysPanel;
  const listEl = document.getElementById('keysList'), statusEl = document.getElementById('keysStatus');
  const btnAll = document.getElementById('btnKeysResetAll');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = { cap: null, pending: null, msg: null, up: null }; // cap : action en attente d'une touche ; pending : { id, binding, other, reset } ; msg : { text, kind }
  const nameOf = (id) => B.byId[id].label.replace(/ \(.*$/, '');

  const menu = game.keysMenu = {
    layer() { return S.cap ? ['capture'] : S.pending ? ['conflict'] : []; },
    open() { S.cap = S.pending = S.msg = null; menu.render(); hud.showPanel('keysPanel'); },
    back() { menu.cancel(true); hud.showPanel('optionsPanel'); },
    // Échap : abandonne la capture ou la question d'échange, le menu reste ouvert
    cancel(silent) {
      const was = S.cap || S.pending;
      S.cap = S.pending = null;
      S.msg = was && !silent ? { text: 'Annulé : aucune touche modifiée.', kind: '' } : null;
      menu.render();
    },
    start(id) {
      if (S.cap === id) { menu.cancel(); return; }
      S.cap = id; S.pending = null; S.msg = null;
      menu.render();
    },
    render() {
      const top = listEl.scrollTop;
      const groups = [];
      for (const d of B.defs) {
        let g = groups.find((x) => x.name === d.group);
        if (!g) groups.push(g = { name: d.group, rows: [] });
        g.rows.push(d);
      }
      let h = '';
      for (const g of groups) {
        h += `<div class="k-group"><h3>${esc(g.name)}</h3>`;
        for (const d of g.rows) {
          const cap = S.cap === d.id, bad = S.pending && S.pending.other === d.id, pend = S.pending && S.pending.id === d.id;
          const txt = cap ? 'Appuyez sur une touche…' : esc(B.label(d.id));
          const alt = d.alt && !cap ? ` title="${esc(B.codeName(d.alt))} fonctionne aussi tant qu'elle ne sert pas à autre chose"` : '';
          h += `<div class="k-row${bad ? ' bad' : ''}${pend ? ' pend' : ''}"><span class="k-label">${esc(d.label)}</span>`
            + `<button class="k-key${cap ? ' cap' : ''}${B.isDefault(d.id) ? '' : ' mod'}" data-id="${d.id}"${alt}>${txt}</button>`
            + `<button class="k-reset" data-reset="${d.id}"${B.isDefault(d.id) ? ' disabled' : ''} title="Remettre ${esc(B.nameOf(d.def))}">Réinitialiser</button></div>`;
        }
        h += '</div>';
      }
      h += '<div class="k-group"><h3>Fixes (non modifiables)</h3>';
      h += `<div class="k-row"><span class="k-label">Déplacement (en plus des touches ci-dessus)</span><span class="k-key fixed">↑ ↓ ← →</span><span></span></div>`;
      for (const [k, a] of CONFIG.fixedKeys) h += `<div class="k-row"><span class="k-label">${esc(a)}</span><span class="k-key fixed">${esc(k)}</span><span></span></div>`;
      h += '</div>';
      listEl.innerHTML = h;
      listEl.scrollTop = top;
      const bad = S.pending && listEl.querySelector('.k-row.bad'); // question d'échange : l'autre action doit être visible
      if (bad) { const r = bad.getBoundingClientRect(), l = listEl.getBoundingClientRect(); if (r.top < l.top || r.bottom > l.bottom) listEl.scrollTop += r.top - l.top - (l.height - r.height) / 2; }
      btnAll.disabled = !B.anyChanged();
      btnAll.style.opacity = B.anyChanged() ? '' : '.35';
      menu.renderStatus();
    },
    renderStatus() {
      statusEl.className = '';
      if (S.pending) {
        const { id, binding, other, reset } = S.pending;
        statusEl.className = 'warn';
        const k = esc(B.nameOf(binding)), take = esc(B.nameOf(B.get(id)));
        statusEl.innerHTML = `<span class="grow">${reset ? `Par défaut, « ${esc(nameOf(id))} » est sur ` : 'La touche '}<b>${k}</b>${reset ? '' : ' est déjà utilisée'} par « ${esc(nameOf(other))} ». `
          + `Échanger : « ${esc(nameOf(other))} » prendrait <b>${take}</b>.</span>`
          + '<button class="btn btn-sub" id="btnKeysSwap">ÉCHANGER</button><button class="btn btn-sub" id="btnKeysNo">ANNULER</button>';
      } else if (S.cap) {
        statusEl.className = S.msg?.kind || 'warn';
        statusEl.innerHTML = `<span class="grow">${S.msg ? esc(S.msg.text) + ' ' : ''}Appuyez sur la nouvelle touche pour « ${esc(nameOf(S.cap))} » · Échap : annuler.</span>`;
      } else if (S.msg) {
        statusEl.className = S.msg.kind;
        statusEl.innerHTML = `<span class="grow">${esc(S.msg.text)}</span>`;
      } else {
        statusEl.innerHTML = '<span class="grow">Cliquez sur une touche pour la modifier. Les changements sont immédiats et gardés sur cet appareil.'
          + (B.hasLayout() ? '' : ' Sans l\'API de disposition du clavier (Firefox, Safari), les noms de déplacement suivent un clavier QWERTY jusqu\'à ce que vous appuyiez sur la touche.') + '</span>';
      }
    },
    // tente d'appliquer une liaison ; ev : touche pressée (conflits sur la touche réelle) ou null (remise au défaut)
    apply(id, binding, ev, reset) {
      if (binding === B.get(id)) { S.cap = null; S.msg = { text: `« ${nameOf(id)} » reste sur ${B.nameOf(binding)}.`, kind: '' }; return menu.render(); }
      const others = B.conflicts(id, binding, ev);
      if (others.length > 1) {
        S.msg = { text: `${B.nameOf(binding)} est déjà utilisée par ${others.map((o) => '« ' + nameOf(o) + ' »').join(' et ')} : libérez-en une d'abord, ou choisissez une autre touche.`, kind: 'err' };
        return menu.render(); // la capture continue
      }
      if (others.length === 1) { S.cap = null; S.pending = { id, binding, other: others[0], reset: !!reset }; S.msg = null; return menu.render(); }
      S.cap = null; S.pending = null;
      B.set(id, binding);
      S.msg = { text: `« ${nameOf(id)} » : ${B.nameOf(binding)}.${arrowNote(binding, id)}`, kind: 'ok' };
      menu.render();
    },
    swap() {
      const p = S.pending; if (!p) return;
      const otherOld = B.nameOf(B.get(p.id));
      if (!B.swap(p.id, p.binding, p.other)) { S.pending = null; S.msg = { text: 'Échange impossible : « ' + nameOf(p.other) + ' » créerait un autre doublon.', kind: 'err' }; return menu.render(); }
      S.pending = null;
      S.msg = { text: `Échangé : « ${nameOf(p.id)} » ${B.label(p.id)} · « ${nameOf(p.other)} » ${otherOld}.`, kind: 'ok' };
      menu.render();
    },
    resetOne(id) {
      if (B.isDefault(id)) return;
      S.cap = null;
      menu.apply(id, B.byId[id].def, null, true);
    },
    resetAll() {
      S.cap = S.pending = null;
      B.resetAll();
      S.msg = { text: 'Toutes les touches ont été remises par défaut.', kind: 'ok' };
      menu.render();
    },
  };
  // Les flèches de déplacement de secours se coupent si une action les prend
  function arrowNote(binding, id) {
    const alt = B.defs.find((d) => d.alt && binding === 'code:' + d.alt && d.id !== id);
    return alt ? ` ${B.nameOf(binding)} ne sert plus à se déplacer.` : '';
  }

  // ---------------------------------------------------------------- événements
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.id) menu.start(t.dataset.id);
    else if (t.dataset.reset) menu.resetOne(t.dataset.reset);
    else if (t.id === 'btnKeysSwap') menu.swap();
    else if (t.id === 'btnKeysNo') menu.cancel();
    else if (t.id === 'btnKeysResetAll') { if (B.anyChanged()) menu.resetAll(); }
    else if (t.id === 'btnKeysBack') menu.back();
  });
  document.getElementById('btnKeys').addEventListener('click', () => menu.open());

  // Capture : phase de capture de la fenêtre, avant le jeu et ui.js. Échap passe (ui.js l'annule via la pile), le reste est consommé.
  window.addEventListener('keydown', (e) => {
    if (!S.cap) return;
    if (panel.classList.contains('hidden')) { S.cap = S.pending = null; return; }
    if (e.key === 'Escape' || e.code === 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    S.up = e.code;
    const r = B.fromEvent(S.cap, e);
    if (r.error) { S.msg = { text: r.error, kind: 'err' }; return menu.render(); }
    menu.apply(S.cap, r.binding, r.ev);
  }, true);
  // Le relâchement de la touche capturée ne doit ni « cliquer » un bouton ni arriver au jeu
  window.addEventListener('keyup', (e) => {
    if (S.up && e.code === S.up) { S.up = null; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  B.onChange(() => { if (!panel.classList.contains('hidden')) menu.render(); }); // noms de touches connus plus tard (disposition du clavier)
  hud.refreshKeys();
  return menu;
}
