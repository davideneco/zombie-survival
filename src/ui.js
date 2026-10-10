// Couches d'interface et touche Échap.
//
// La pile `game.ui.stack` est DÉDUITE de l'état réel de l'écran (aucune copie à tenir à jour) ; de la plus ancienne à la plus récente :
//   'title' (titre), 'menu' (solo / multijoueur + salon), 'options', 'keys' (Options > Touches) puis 'conflict' (touche déjà prise : échanger ?)
//   ou 'capture' (« Appuyez sur une touche… »), 'pause', écrans à bouton : 'enter' (PARTIE LANCÉE, NOUVELLE PARTIE,
//   PARTIE EN COURS), 'resume' (CLIQUEZ POUR REPRENDRE), 'victory', 'over' (ÉQUIPE ÉLIMINÉE) ; puis, par-dessus le jeu, 'map' / 'debug'
//   dans l'ordre d'ouverture et 'banner' (bandeau léger « Cliquez pour reprendre »).
// Échap ferme la couche du dessus ; en jeu sans couche ouverte, il ouvre la pause. Les fenêtres natives alert / confirm restent au navigateur.
//
// Pointer lock : le navigateur consomme Échap pour rendre la souris, la page ne reçoit alors que `pointerlockchange` : toute libération
// de la souris en jeu est traitée comme un appui d'Échap (voir onPointerUnlocked). Option « plein écran » : navigator.keyboard.lock(['Escape'])
// (Chromium) fait arriver Échap à la page sans libérer la souris.
export function installUi(game, { hud, canvas, lockAndPlay }) {
  const el = hud.el;
  const hidden = (e) => e.classList.contains('hidden');
  const banner = document.getElementById('resumeBanner');
  const btnFs = document.getElementById('btnFullscreen');

  const ui = {
    optionsBack: 'titlePanel',
    over: [],          // couches ouvertes par-dessus le jeu ('map', 'debug'), dans l'ordre d'ouverture
    bannerOn: false,
    blockT: 0,
    log: [],

    get stack() {
      const out = [];
      if (!hidden(el.overlay)) {
        if (!hidden(el.titlePanel)) out.push('title');
        else if (!hidden(el.menuPanel)) out.push('title', 'menu');
        else if (!hidden(el.pausePanel)) out.push('pause');
        else if (!hidden(el.optionsPanel)) out.push(this.optionsBack === 'pausePanel' ? 'pause' : 'title', 'options');
        else if (!hidden(el.keysPanel)) out.push(this.optionsBack === 'pausePanel' ? 'pause' : 'title', 'options', 'keys', ...(game.keysMenu?.layer() || []));
        else {
          const t = hud.screenTitle || '';
          out.push(t.startsWith('VICTOIRE') || t.startsWith('STRASBOURG') ? 'victory' : t.startsWith('ÉQUIPE') ? 'over' : t === 'PAUSE' && !hidden(el.ovBtn) ? 'resume' : 'enter');
        }
      }
      out.push(...this.over);
      if (this.bannerOn) out.push('banner');
      return out;
    },
    top() { const s = this.stack; return s[s.length - 1] || null; },

    // ---------------------------------------------------------------- carte et couches par-dessus le jeu
    open(name) { if (!this.over.includes(name)) this.over.push(name); },
    close(name) { this.over = this.over.filter((n) => n !== name); },
    toggleMap(show) {
      const on = show ?? !hud.mapOpen;
      hud.toggleMap(on);
      if (on) this.open('map'); else this.close('map');
    },
    closeOverlays() { // carte, menu debug
      if (hud.mapOpen) hud.toggleMap(false);
      game.debugMenu?.close();
      this.over = [];
    },
    showBanner(on) {
      this.bannerOn = on;
      banner.classList.toggle('hidden', !on);
    },

    // ---------------------------------------------------------------- pause et reprise
    pause() {
      if (!game.started || game.over) return;
      this.closeOverlays();
      this.showBanner(false);
      game.playing = false;
      game.player.releaseInputs();
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('PAUSE', game.isMultiplayer ? 'La partie continue pour vos coéquipiers.' : 'Jeu en pause.', null);
      hud.showPanel('pausePanel');
    },
    // Reprise au clavier : on tente de reprendre la souris ; Chrome refuse environ 1 s après une sortie par Échap (SecurityError /
    // pointerlockerror, ou aucun pointerlockchange) : écran plein « CLIQUEZ POUR REPRENDRE » (le clic donne l'autorisation)
    resume() {
      if (!game.started || game.over) return;
      if (document.pointerLockElement === canvas) { game.playing = true; hud.hideOverlay(); return; }
      let req;
      try { req = canvas.requestPointerLock(); } catch { req = null; }
      if (req && req.then) req.then(() => {}, () => this.resumeBlocked());
      clearTimeout(this.blockT);
      this.blockT = setTimeout(() => { if (document.pointerLockElement !== canvas) this.resumeBlocked(); }, 600);
    },
    resumeBlocked() {
      if (document.pointerLockElement === canvas || !game.started || game.over || game.playing) return;
      if (hidden(el.overlay) && !this.bannerOn) return; // la partie a repris entre-temps
      this.showBanner(false);
      hud.showOverlay('PAUSE', 'Le navigateur ne rend pas la souris tout de suite.<br><b style="color:#ffd24a">Cliquez pour reprendre la partie.</b>', 'CLIQUEZ POUR REPRENDRE');
    },

    // ---------------------------------------------------------------- événements du pointer lock
    onPointerLocked() {
      clearTimeout(this.blockT);
      game.playing = true;
      hud.hideOverlay();
      this.showBanner(false);
    },
    // La souris vient d'être libérée alors que la partie tournait = Échap (ou perte de focus) : carte / menu debug ouverts -> on les ferme
    // avec le bandeau léger ; sinon pause complète. Si l'écran montre déjà une couche (pause demandée par le jeu), rien à faire.
    onPointerUnlocked() {
      if (!game.started || game.over) return;
      if (!hidden(el.overlay)) return;
      if (game.summitFx?.orbit.on) { // Échap pendant la vue orbitale (souris déjà rendue) : on la passe ; l'écran « STRASBOURG LIBÉRÉE » suit
        game.playing = false; game.player.releaseInputs();
        game.summitFx.endOrbit();
        return;
      }
      const hadOver = this.over.length > 0;
      game.playing = false;
      game.player.releaseInputs();
      if (hadOver) { this.closeOverlays(); this.showBanner(true); }
      else this.pause();
    },

    // ---------------------------------------------------------------- Échap
    escape() {
      if (game.summitFx?.orbit.on) { game.summitFx.endOrbit(); return 'orbit'; } // vue orbitale de l'Aube : Échap la passe
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'range') { ae.blur(); return 'blur'; } // champ de texte : d'abord retirer le focus
      const t = this.top();
      switch (t) {
        case 'debug': game.debugMenu?.close(); break;
        case 'map': this.toggleMap(false); break;
        case 'banner': this.pause(); break;
        case 'options': hud.showPanel(this.optionsBack); break;
        case 'keys': hud.showPanel('optionsPanel'); break;
        case 'capture': case 'conflict': game.keysMenu.cancel(); break; // d'abord la capture / la question d'échange, le menu Touches reste ouvert
        case 'menu':
          if (game.net) { if (confirm('Quitter le salon ?')) { game.net.close(); location.reload(); } }
          else hud.showPanel('titlePanel');
          break;
        case 'pause': case 'resume': this.resume(); break;
        case 'victory': el.ovBtn.click(); break;
        case 'title': case 'enter': case 'over': break;
        default:
          if (game.started && game.playing && !game.over) this.pause();
      }
      return t;
    },

    openOptions(back) {
      this.optionsBack = back;
      hud.showPanel('optionsPanel');
    },

    // ---------------------------------------------------------------- plein écran (Échap sans libérer la souris, Chromium)
    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) { await document.exitFullscreen(); return; }
        await document.documentElement.requestFullscreen();
        if (navigator.keyboard?.lock) await navigator.keyboard.lock(['Escape']);
      } catch (err) { console.warn('plein écran', err); }
      this.syncFullscreenLabel();
    },
    syncFullscreenLabel() {
      if (!btnFs) return;
      const fs = !!document.fullscreenElement, lock = !!navigator.keyboard?.lock;
      btnFs.textContent = fs ? 'PLEIN ÉCRAN : OUI' : 'PLEIN ÉCRAN : NON';
      btnFs.title = lock ? 'En plein écran, Échap ouvre la pause sans libérer la souris (maintenir Échap pour quitter le plein écran)' : 'Ce navigateur ne permet pas de verrouiller Échap : il libérera la souris';
    },
  };

  game.ui = ui;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) ui.escape();
    } else if (!e.repeat && game.binds.is('map', e) && game.started && game.playing && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) ui.toggleMap(); // liaison « carte » : par défaut la lettre tapée (e.key), la touche M n'est pas au même endroit en AZERTY
  });
  document.addEventListener('pointerlockerror', () => { if (!game.playing) ui.resumeBlocked(); });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
    ui.syncFullscreenLabel();
  });
  if (btnFs) { btnFs.addEventListener('click', (e) => { e.stopPropagation(); ui.toggleFullscreen(); }); ui.syncFullscreenLabel(); }
  banner.addEventListener('click', () => lockAndPlay());
  el.overlay.addEventListener('click', () => { if (ui.top() === 'resume') lockAndPlay(); });
  return ui;
}
