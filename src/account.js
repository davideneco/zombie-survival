// Système de compte hybride (serveur /api/account/* + miroir localStorage),
// suivi de carrière et progression d'expérience / grades militaires.
import { CONFIG } from './config.js';
import { CHARACTERS, charStatsOf, isCharUnlocked } from './characters.js';

const STORAGE_KEY = 'zombie_account_v1';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaultStats() {
  return {
    xp: 0,
    kills: 0,
    headshots: 0,
    revives: 0,
    games: 0,
    victories: 0,
    bestRound: 0,
    bestPoints: 0,
    timePlayed: 0,
  };
}

function cleanStats(raw) {
  const s = defaultStats();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(s)) s[k] = Math.max(0, Math.floor(Number(raw[k]) || 0));
  s.headshots = Math.min(s.headshots, s.kills);
  s.victories = Math.min(s.victories, s.games);
  return s;
}

export function xpNeededForLevel(lv) {
  const A = CONFIG.account;
  return Math.round(A.xpBase * Math.pow(Math.max(1, lv), A.xpPow));
}

export function totalXpForLevel(targetLevel) {
  let sum = 0;
  const maxLv = Math.min(CONFIG.account.maxLevel, Math.max(1, targetLevel | 0));
  for (let lv = 1; lv < maxLv; lv++) sum += xpNeededForLevel(lv);
  return sum;
}

export function levelInfo(totalXp) {
  const A = CONFIG.account;
  let xp = Math.max(0, Math.floor(totalXp || 0));
  let level = 1;
  while (level < A.maxLevel) {
    const req = xpNeededForLevel(level);
    if (xp < req) break;
    xp -= req;
    level++;
  }
  const isMax = level >= A.maxLevel;
  const reqXp = isMax ? xpNeededForLevel(A.maxLevel) : xpNeededForLevel(level);
  const curXp = isMax ? reqXp : xp;
  const pct = isMax ? 100 : Math.min(100, Math.round((curXp / Math.max(1, reqXp)) * 100));

  let rank = A.ranks[0];
  let nextRank = null;
  for (let i = 0; i < A.ranks.length; i++) {
    if (A.ranks[i].level <= level) {
      rank = A.ranks[i];
      nextRank = A.ranks[i + 1] || null;
    }
  }
  return { level, rank, nextRank, curXp, reqXp, pct, isMax, totalXp: Math.max(0, Math.floor(totalXp || 0)) };
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m} min ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

function mergeLocalAndServer(local, remote) {
  const a = cleanStats(local?.stats);
  const b = cleanStats(remote?.stats);
  const stats = {
    xp: Math.max(a.xp, b.xp),
    kills: Math.max(a.kills, b.kills),
    headshots: Math.max(a.headshots, b.headshots),
    revives: Math.max(a.revives, b.revives),
    games: Math.max(a.games, b.games),
    victories: Math.max(a.victories, b.victories),
    bestRound: Math.max(a.bestRound, b.bestRound),
    bestPoints: Math.max(a.bestPoints, b.bestPoints),
    timePlayed: Math.max(a.timePlayed, b.timePlayed),
  };
  stats.headshots = Math.min(stats.headshots, stats.kills);
  stats.victories = Math.min(stats.victories, stats.games);

  const map = new Map();
  for (const m of [...(local?.history || []), ...(remote?.history || [])]) {
    if (!m || typeof m !== 'object') continue;
    const k = m.id || `${m.date}-${m.round}-${m.kills}`;
    if (!map.has(k)) map.set(k, m);
  }
  const history = [...map.values()]
    .sort((x, y) => String(y.date).localeCompare(String(x.date)))
    .slice(0, CONFIG.account.maxHistory);

  return { stats, history };
}

export function installAccount(game, { hud, sfx, onProfileChange, onLevelChange }) {
  const A = CONFIG.account;
  const state = {
    mode: 'guest', // 'guest' | 'account'
    username: null,
    token: null,
    stats: defaultStats(),
    history: [],
    syncStatus: 'local', // 'synced' | 'syncing' | 'local' | 'reauth'
    lastSync: null,
  };

  // Suivi de la partie en cours (pour bilan de fin de partie & éviter tout double comptage)
  let session = {
    active: false,
    finished: false,
    xpGained: 0,
    startLevel: 1,
    startTime: 0,
    lastRoundAwarded: 0,
  };

  let modalOpen = false;
  let activeTab = 'profile'; // 'profile' | 'auth'
  let authMsg = null; // { kind: 'ok'|'err'|'info', text }
  let saveTimer = null;
  let syncTimer = null;

  const unlockedBetween = (prevLv, nextLv) => CHARACTERS.filter((ch, idx) => {
    const req = charStatsOf(idx).unlockLevel || 1;
    return req > prevLv && req <= nextLv;
  });

  // ------------------------------------------------ Persistance locale
  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        state.mode = raw.mode === 'account' && raw.username ? 'account' : 'guest';
        state.username = raw.username || null;
        state.token = raw.token || null;
        state.stats = cleanStats(raw.stats);
        state.history = Array.isArray(raw.history) ? raw.history.slice(0, A.maxHistory) : [];
        state.lastSync = raw.lastSync || null;
        state.syncStatus = state.mode === 'account' && state.token ? 'local' : 'local';
      }
    } catch {}
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        username: state.username,
        token: state.token,
        stats: state.stats,
        history: state.history,
        charPref: game.charPref || 0,
        lastSync: state.lastSync,
      }));
    } catch {}
  }

  function scheduleSave(withSync = false) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 400);
    if (withSync && state.mode === 'account' && state.token) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { account.syncNow(true); }, 2500);
    }
  }

  // ------------------------------------------------ Requêtes API hybride
  async function api(path, body = null, method = 'POST') {
    const headers = {};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api/account/${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function applyServerUser(user, token = null) {
    if (token) state.token = token;
    state.mode = 'account';
    state.username = user.username;
    const merged = mergeLocalAndServer(state, user);
    state.stats = merged.stats;
    state.history = merged.history;
    state.syncStatus = 'synced';
    state.lastSync = new Date().toISOString();
    saveLocal();
    onProfileChange?.({ username: state.username, charPref: user.charPref });
    onLevelChange?.(levelInfo(state.stats.xp).level);
    renderAll();
  }

  // ------------------------------------------------ Gain d'XP & niveaux
  function grantXp(amount, label = null) {
    const add = Math.max(0, Math.floor(amount || 0));
    if (!add) return;
    const before = levelInfo(state.stats.xp);
    state.stats.xp += add;
    if (session.active) session.xpGained += add;
    const after = levelInfo(state.stats.xp);

    if (after.level > before.level) {
      onLevelChange?.(after.level);
      if (game.started && !game.over) {
        const newly = unlockedBetween(before.level, after.level);
        sfx.powerup?.();
        const extra = newly.length
          ? ` · 🔓 ${newly.map((c) => c.name).join(', ')} DÉBLOQUÉ${newly.length > 1 ? 'S' : ''} !`
          : '';
        hud.announce(`NIVEAU ${after.level} !`, `${after.rank.icon} ${after.rank.name.toUpperCase()}${extra}`, newly.length ? 4400 : 3400);
        const newAtts = Object.values(CONFIG.attachments?.defs || {})
          .filter((d) => (d.unlockLevel ?? 1) > before.level && (d.unlockLevel ?? 1) <= after.level)
          .map((d) => d.short || d.name);
        if (newAtts.length) {
          const shown = newAtts.slice(0, 3).join(', ') + (newAtts.length > 3 ? ` (+${newAtts.length - 3})` : '');
          hud.toast(`🔧 Atelier [T] débloqué : ${shown}`, 3400);
        }
      }
    } else if (label && game.started && !game.over) {
      hud.toast(`+${add} XP · ${label}`, 2200);
    }
    scheduleSave(false);
    renderTitleStrip();
  }

  // ------------------------------------------------ API publique sur game.account
  const account = game.account = {
    get state() { return state; },
    get open() { return modalOpen; },
    levelInfo: () => levelInfo(state.stats.xp),
    xpForLevel: (lv) => totalXpForLevel(lv),
    isCharUnlocked: (idx) => isCharUnlocked(idx, levelInfo(state.stats.xp).level, !!game.unlockAllChars),
    unlockedCharsCount: () => {
      const lv = levelInfo(state.stats.xp).level;
      return CHARACTERS.filter((_, i) => isCharUnlocked(i, lv, !!game.unlockAllChars)).length;
    },
    nextUnlockChar: () => {
      const lv = levelInfo(state.stats.xp).level;
      for (let i = 0; i < CHARACTERS.length; i++) {
        if (!isCharUnlocked(i, lv, !!game.unlockAllChars)) {
          const st = charStatsOf(i);
          const needXp = Math.max(0, totalXpForLevel(st.unlockLevel) - state.stats.xp);
          return { index: i, ch: CHARACTERS[i], stats: st, needXp };
        }
      }
      return null;
    },

    beginSession() {
      const info = levelInfo(state.stats.xp);
      session = {
        active: true,
        finished: false,
        xpGained: 0,
        startLevel: info.level,
        startTime: Date.now(),
        lastRoundAwarded: 0,
      };
    },

    onKill({ count = 1, head = false, boss = false } = {}) {
      if (!session.active) account.beginSession();
      const n = Math.max(1, count | 0);
      state.stats.kills += n;
      if (head) state.stats.headshots += 1;
      const xp = boss
        ? A.xp.bossKill
        : n * A.xp.kill + (head ? A.xp.headshotBonus : 0);
      grantXp(xp, boss ? 'Boss éliminé' : null);
    },

    onRoundReached(roundNum) {
      const r = roundNum | 0;
      if (r <= 0) return;
      if (!session.active) account.beginSession();
      if (r > state.stats.bestRound) state.stats.bestRound = r;
      // On récompense la manche terminée dès l'arrivée à la manche suivante (r >= 2)
      const cleared = r - 1;
      if (cleared > 0 && cleared > session.lastRoundAwarded) {
        session.lastRoundAwarded = cleared;
        const xp = A.xp.roundBase + A.xp.roundStep * cleared;
        grantXp(xp, `Manche ${cleared} terminée`);
      }
      scheduleSave(true);
    },

    onRevive() {
      if (!session.active) account.beginSession();
      state.stats.revives += 1;
      grantXp(A.xp.revive, 'Réanimation');
      scheduleSave(true);
    },

    finishMatch({ victory = false, round = 0, kills = 0, headshots = 0, revives = 0, points = 0, duration = 0, multiplayer = false } = {}) {
      if (session.finished) return account.matchSummaryHtml();
      if (!session.active) account.beginSession();
      session.finished = true;

      if (victory) {
        state.stats.victories += 1;
        grantXp(A.xp.victory);
      }
      state.stats.games += 1;
      state.stats.bestRound = Math.max(state.stats.bestRound, round | 0);
      state.stats.bestPoints = Math.max(state.stats.bestPoints, points | 0);
      const dur = duration > 0 ? Math.floor(duration) : Math.max(1, Math.floor((Date.now() - session.startTime) / 1000));
      state.stats.timePlayed += dur;

      const entry = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        date: new Date().toISOString(),
        mode: multiplayer ? 'coop' : 'solo',
        round: round | 0,
        kills: kills | 0,
        headshots: headshots | 0,
        points: points | 0,
        xpGained: session.xpGained | 0,
        victory: Boolean(victory),
        duration: dur,
      };
      state.history = [entry, ...state.history].slice(0, A.maxHistory);
      saveLocal();
      if (state.mode === 'account' && state.token) account.syncNow(true);
      renderAll();
      return account.matchSummaryHtml();
    },

    matchSummaryHtml() {
      const info = levelInfo(state.stats.xp);
      const lvUp = info.level > session.startLevel
        ? ` <span style="color:#4ade80;font-weight:bold">▲ NIVEAU ${info.level} !</span>`
        : '';
      const newly = unlockedBetween(session.startLevel, info.level);
      const unlockLine = newly.length
        ? `<span style="color:#ffd24a;font-weight:bold">🔓 Débloqué${newly.length > 1 ? 's' : ''} : ${newly.map((c) => esc(c.name)).join(', ')} !</span>`
        : '';
      return `<div class="acc-end-pill">`
        + `<span class="acc-end-xp">+${session.xpGained.toLocaleString('fr-FR')} XP</span>`
        + `<span>${info.rank.icon} Niv. ${info.level} · <b style="color:${info.rank.color}">${esc(info.rank.name)}</b>${lvUp}</span>`
        + unlockLine
        + `<div class="acc-end-bar"><i style="width:${info.pct}%"></i></div>`
        + `</div>`;
    },

    async register(username, password) {
      authMsg = { kind: 'info', text: 'Création du compte…' };
      renderModal();
      try {
        const res = await api('register', {
          username,
          password,
          profile: { stats: state.stats, history: state.history, charPref: game.charPref || 0 },
        });
        if (!res.ok) {
          authMsg = { kind: 'err', text: res.data?.error || 'Impossible de créer le compte.' };
          renderModal();
          return false;
        }
        applyServerUser(res.data.user, res.data.token);
        authMsg = { kind: 'ok', text: `Compte « ${state.username} » créé et progression importée !` };
        activeTab = 'profile';
        renderAll();
        return true;
      } catch {
        authMsg = { kind: 'err', text: 'Serveur inaccessible : votre progression reste sauvegardée localement.' };
        renderModal();
        return false;
      }
    },

    async login(username, password) {
      authMsg = { kind: 'info', text: 'Connexion en cours…' };
      renderModal();
      try {
        const sameLocal = state.username && state.username.toLowerCase() === String(username || '').trim().toLowerCase();
        const res = await api('login', {
          username,
          password,
          restoreIfMissing: Boolean(sameLocal),
          profile: sameLocal ? { stats: state.stats, history: state.history, charPref: game.charPref || 0 } : undefined,
        });
        if (!res.ok) {
          authMsg = { kind: 'err', text: res.data?.error || 'Connexion refusée.' };
          renderModal();
          return false;
        }
        // Si connexion sur un autre compte, on remplace les stats locales par celles du compte serveur
        if (!sameLocal) {
          state.stats = cleanStats(res.data.user.stats);
          state.history = Array.isArray(res.data.user.history) ? res.data.user.history.slice(0, A.maxHistory) : [];
        }
        applyServerUser(res.data.user, res.data.token);
        authMsg = { kind: 'ok', text: res.data.restored ? 'Compte restauré et synchronisé sur le serveur !' : `Bon retour, ${state.username} !` };
        activeTab = 'profile';
        renderAll();
        return true;
      } catch {
        authMsg = { kind: 'err', text: 'Serveur inaccessible pour le moment.' };
        renderModal();
        return false;
      }
    },

    async syncNow(silent = false) {
      if (state.mode !== 'account' || !state.token) {
        saveLocal();
        state.syncStatus = 'local';
        if (!silent) { authMsg = { kind: 'info', text: 'Progression sauvegardée localement sur cet appareil.' }; renderModal(); }
        return false;
      }
      state.syncStatus = 'syncing';
      renderTitleStrip();
      try {
        const res = await api('sync', {
          stats: state.stats,
          history: state.history,
          charPref: game.charPref || 0,
        });
        if (res.status === 401) {
          state.syncStatus = 'reauth';
          saveLocal();
          if (!silent) authMsg = { kind: 'err', text: 'Session expirée (redémarrage serveur). Reconnectez-vous dans l\'onglet Compte pour resynchroniser.' };
          renderAll();
          return false;
        }
        if (!res.ok) {
          state.syncStatus = 'local';
          renderAll();
          return false;
        }
        applyServerUser(res.data.user);
        if (!silent) { authMsg = { kind: 'ok', text: 'Profil synchronisé avec le serveur.' }; renderModal(); }
        return true;
      } catch {
        state.syncStatus = 'local';
        renderAll();
        return false;
      }
    },

    logout() {
      state.mode = 'guest';
      state.token = null;
      state.syncStatus = 'local';
      saveLocal();
      authMsg = { kind: 'info', text: 'Déconnecté : votre progression locale reste conservée en mode Invité.' };
      activeTab = 'auth';
      onLevelChange?.(levelInfo(state.stats.xp).level);
      renderAll();
    },

    exportBackup() {
      const payload = {
        v: 1,
        username: state.username || game.playerName || 'Joueur',
        stats: state.stats,
        history: state.history,
        charPref: game.charPref || 0,
      };
      return 'ZS1:' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    },

    importBackup(code) {
      const s = String(code || '').trim();
      if (!s.startsWith('ZS1:')) {
        authMsg = { kind: 'err', text: 'Code invalide (doit commencer par ZS1:).' };
        renderModal();
        return false;
      }
      try {
        const parsed = JSON.parse(decodeURIComponent(escape(atob(s.slice(4)))));
        const merged = mergeLocalAndServer(state, parsed);
        state.stats = merged.stats;
        state.history = merged.history;
        saveLocal();
        if (state.mode === 'account' && state.token) account.syncNow(true);
        authMsg = { kind: 'ok', text: 'Sauvegarde importée et fusionnée avec succès !' };
        onLevelChange?.(levelInfo(state.stats.xp).level);
        renderAll();
        return true;
      } catch {
        authMsg = { kind: 'err', text: 'Impossible de lire ce code de sauvegarde.' };
        renderModal();
        return false;
      }
    },

    openModal(tab = 'profile') {
      modalOpen = true;
      activeTab = tab;
      authMsg = null;
      const modal = document.getElementById('accountModal');
      if (modal) modal.classList.remove('hidden');
      renderModal();
    },

    closeModal() {
      if (!modalOpen) return;
      modalOpen = false;
      const modal = document.getElementById('accountModal');
      if (modal) modal.classList.add('hidden');
    },
  };

  // ------------------------------------------------ Rendu UI (Hub + Modale)
  function syncBadgeHtml() {
    if (state.mode === 'account' && state.syncStatus === 'synced') return '<span class="acc-sync ok">☁ Synchronisé</span>';
    if (state.mode === 'account' && state.syncStatus === 'syncing') return '<span class="acc-sync">↻ Synchro…</span>';
    if (state.mode === 'account' && state.syncStatus === 'reauth') return '<span class="acc-sync warn">⚠ Reconnexion requise</span>';
    return '<span class="acc-sync local">💾 Local</span>';
  }

  function renderTitleStrip() {
    const info = levelInfo(state.stats.xp);
    const name = state.mode === 'account' && state.username ? state.username : `${game.playerName || 'Joueur'} (Invité)`;
    const iconEl = document.getElementById('accStripIcon');
    const nameEl = document.getElementById('accStripName');
    const rankEl = document.getElementById('accStripRank');
    const xpEl = document.getElementById('accStripXp');
    const fillEl = document.getElementById('accStripFill');
    const syncEl = document.getElementById('accStripSync');
    if (iconEl) iconEl.textContent = info.rank.icon;
    if (nameEl) nameEl.textContent = name;
    if (rankEl) {
      rankEl.textContent = `NIV. ${info.level} · ${info.rank.name.toUpperCase()}`;
      rankEl.style.color = info.rank.color;
    }
    if (xpEl) xpEl.textContent = info.isMax ? `${info.totalXp.toLocaleString('fr-FR')} XP (MAX)` : `${info.curXp.toLocaleString('fr-FR')} / ${info.reqXp.toLocaleString('fr-FR')} XP`;
    if (fillEl) fillEl.style.width = `${info.pct}%`;
    if (syncEl) syncEl.innerHTML = syncBadgeHtml();
  }

  function renderModal() {
    const modal = document.getElementById('accountModal');
    if (!modal || !modalOpen) return;
    const info = levelInfo(state.stats.xp);
    const st = state.stats;
    const hsRate = st.kills > 0 ? Math.round((st.headshots / st.kills) * 100) : 0;
    const displayName = state.mode === 'account' && state.username ? state.username : (game.playerName || 'Joueur');
    const modeTag = state.mode === 'account' ? 'COMPTE ENREGISTRÉ' : 'MODE INVITÉ';

    const msgHtml = authMsg
      ? `<div class="acc-msg ${authMsg.kind}">${esc(authMsg.text)}</div>`
      : '';

    const histHtml = state.history.length
      ? `<table class="acc-hist-table">
          <thead><tr><th>DATE</th><th>MODE</th><th>MANCHE</th><th>ÉLIM.</th><th>XP</th><th>ISSUE</th></tr></thead>
          <tbody>
            ${state.history.slice(0, 6).map((m) => {
              const d = m.date ? m.date.slice(5, 16).replace('T', ' ') : '—';
              const resBadge = m.victory
                ? '<span class="acc-res win">VICTOIRE</span>'
                : '<span class="acc-res loss">ÉLIMINÉ</span>';
              return `<tr>
                <td>${esc(d)}</td>
                <td>${m.mode === 'coop' ? 'Co-op' : 'Solo'}</td>
                <td><b>${m.round}</b></td>
                <td>${m.kills}</td>
                <td class="acc-xp-col">+${m.xpGained}</td>
                <td>${resBadge}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`
      : `<div class="acc-empty">Aucune partie enregistrée pour l'instant. Lancez une partie pour commencer votre carrière !</div>`;

    const unlockedCount = account.unlockedCharsCount();
    const charsLadderHtml = CHARACTERS.map((ch, idx) => {
      const cs = charStatsOf(idx);
      const ok = isCharUnlocked(idx, info.level, !!game.unlockAllChars);
      return `<div class="acc-char-pill ${ok ? 'ok' : 'locked'}" style="--cc:${ch.accent}" title="${esc(cs.trait)}">`
        + `<b>${ok ? '✓' : '🔒'} ${esc(ch.name)}</b>`
        + `<small>${ok ? `⚡ ${cs.power}` : `Niv. ${cs.unlockLevel}`}</small>`
        + `</div>`;
    }).join('');

    const profileTabHtml = `
      <div class="acc-xp-hero">
        <div class="acc-xp-top">
          <div>
            <span class="acc-rank-pill" style="color:${info.rank.color};border-color:${info.rank.color}55">${info.rank.icon} NIVEAU ${info.level} · ${esc(info.rank.name.toUpperCase())}</span>
            ${info.nextRank ? `<small class="acc-next-rank">Prochain grade : ${info.nextRank.icon} ${esc(info.nextRank.name)} (Niv. ${info.nextRank.level})</small>` : '<small class="acc-next-rank">Grade maximal atteint !</small>'}
          </div>
          <div class="acc-xp-nums">
            <b>${info.totalXp.toLocaleString('fr-FR')} XP total</b>
            <span>${info.isMax ? 'NIVEAU MAX' : `${info.curXp.toLocaleString('fr-FR')} / ${info.reqXp.toLocaleString('fr-FR')} XP (${info.pct}%)`}</span>
          </div>
        </div>
        <div class="acc-xp-bar-lg"><i style="width:${info.pct}%"></i></div>
      </div>

      <div class="acc-section">
        <div class="acc-sec-title">👥 SURVIVANTS DÉBLOQUÉS (${unlockedCount} / ${CHARACTERS.length})</div>
        <div class="acc-chars-strip">${charsLadderHtml}</div>
      </div>

      <div class="acc-stats-grid">
        <div class="acc-stat"><span>MEILLEURE MANCHE</span><b>${st.bestRound}</b></div>
        <div class="acc-stat"><span>ZOMBIES ÉLIMINÉS</span><b>${st.kills.toLocaleString('fr-FR')}</b></div>
        <div class="acc-stat"><span>TIRS À LA TÊTE</span><b>${st.headshots.toLocaleString('fr-FR')} <small>(${hsRate}%)</small></b></div>
        <div class="acc-stat"><span>RÉANIMATIONS</span><b>${st.revives}</b></div>
        <div class="acc-stat"><span>PARTIES JOUÉES</span><b>${st.games}</b></div>
        <div class="acc-stat"><span>VICTOIRES</span><b style="color:#4ade80">${st.victories}</b></div>
        <div class="acc-stat"><span>TEMPS SURVÉCU</span><b>${fmtDuration(st.timePlayed)}</b></div>
        <div class="acc-stat"><span>RECORD DE POINTS</span><b style="color:#ffd24a">${st.bestPoints.toLocaleString('fr-FR')}</b></div>
      </div>

      <div class="acc-section">
        <div class="acc-sec-title">📜 DERNIÈRES PARTIES</div>
        ${histHtml}
      </div>
    `;

    const authTabHtml = state.mode === 'account'
      ? `
        <div class="acc-connected-card">
          <div>
            <div class="acc-conn-title">Connecté en tant que <b style="color:#ffd24a">${esc(state.username)}</b></div>
            <div class="acc-conn-sub">Votre XP, vos grades et vos records sont sauvegardés localement et synchronisés avec le serveur.</div>
          </div>
          <div class="acc-conn-actions">
            <button type="button" class="btn acc-btn-primary" id="btnAccSync">☁ SYNCHRONISER</button>
            <button type="button" class="btn acc-btn-danger" id="btnAccLogout">DÉCONNEXION</button>
          </div>
        </div>
        ${state.syncStatus === 'reauth' ? `
          <form class="acc-form-card" id="formAccReauth">
            <div class="acc-sec-title">🔄 RESYNCHRONISER LA SESSION</div>
            <p class="acc-form-note">Le serveur a redémarré : saisissez votre mot de passe pour ré-envoyer automatiquement votre profil local (${st.xp.toLocaleString('fr-FR')} XP).</p>
            <div class="acc-field"><label>Mot de passe</label><input type="password" id="accReauthPass" minlength="4" maxlength="64" required autocomplete="current-password" /></div>
            <button type="submit" class="btn acc-btn-primary">RECONNECTER &amp; RESTAURER</button>
          </form>
        ` : ''}
        <div class="acc-form-card">
          <div class="acc-sec-title">💾 CODE DE SAUVEGARDE PORTABLE</div>
          <p class="acc-form-note">Copiez ce code pour transférer votre carrière vers un autre navigateur ou restaurer votre progression à tout moment.</p>
          <div class="acc-backup-row">
            <button type="button" class="btn acc-btn-sub" id="btnAccExport">COPIER MON CODE</button>
            <input type="text" id="accImportInput" placeholder="Coller un code ZS1:…" autocomplete="off" />
            <button type="button" class="btn acc-btn-sub" id="btnAccImport">IMPORTER</button>
          </div>
        </div>
      `
      : `
        <div class="acc-auth-grid">
          <form class="acc-form-card" id="formAccLogin">
            <div class="acc-sec-title">🔑 SE CONNECTER</div>
            <p class="acc-form-note">Retrouvez votre compte, votre niveau et vos statistiques de carrière.</p>
            <div class="acc-field"><label for="accLoginUser">Pseudo</label><input type="text" id="accLoginUser" maxlength="16" required autocomplete="username" placeholder="Ex: Survivor67" /></div>
            <div class="acc-field"><label for="accLoginPass">Mot de passe</label><input type="password" id="accLoginPass" minlength="4" maxlength="64" required autocomplete="current-password" placeholder="••••" /></div>
            <button type="submit" class="btn acc-btn-primary">CONNEXION</button>
          </form>

          <form class="acc-form-card" id="formAccRegister">
            <div class="acc-sec-title">✨ CRÉER UN COMPTE</div>
            <p class="acc-form-note">Votre progression actuelle (${st.xp.toLocaleString('fr-FR')} XP · Niv. ${info.level}) sera importée automatiquement.</p>
            <div class="acc-field"><label for="accRegUser">Pseudo (3–16 car.)</label><input type="text" id="accRegUser" minlength="3" maxlength="16" required autocomplete="username" value="${esc(game.playerName || '')}" /></div>
            <div class="acc-field"><label for="accRegPass">Mot de passe (4+ car.)</label><input type="password" id="accRegPass" minlength="4" maxlength="64" required autocomplete="new-password" placeholder="Minimum 4 caractères" /></div>
            <button type="submit" class="btn acc-btn-go">CRÉER &amp; LIER MON PROFIL</button>
          </form>
        </div>

        <div class="acc-form-card">
          <div class="acc-sec-title">💾 SAUVEGARDE PORTABLE (SANS SERVEUR)</div>
          <div class="acc-backup-row">
            <button type="button" class="btn acc-btn-sub" id="btnAccExport">COPIER MON CODE</button>
            <input type="text" id="accImportInput" placeholder="Coller un code ZS1:…" autocomplete="off" />
            <button type="button" class="btn acc-btn-sub" id="btnAccImport">IMPORTER</button>
          </div>
        </div>
      `;

    modal.innerHTML = `
      <div class="acc-dialog">
        <div class="acc-header">
          <div class="acc-head-left">
            <div class="acc-emblem" style="border-color:${info.rank.color}88">${info.rank.icon}</div>
            <div>
              <div class="acc-head-name">${esc(displayName)} <span class="acc-mode-tag">${modeTag}</span> ${syncBadgeHtml()}</div>
              <div class="acc-head-sub">Niv. ${info.level} · ${esc(info.rank.name)} · Suivi de carrière Strasbourg</div>
            </div>
          </div>
          <button type="button" class="acc-close" id="btnAccClose" title="Fermer (Échap)">✕</button>
        </div>

        <div class="acc-tabs">
          <button type="button" class="acc-tab ${activeTab === 'profile' ? 'active' : ''}" data-acc-tab="profile">📊 PROFIL &amp; CARRIÈRE</button>
          <button type="button" class="acc-tab ${activeTab === 'auth' ? 'active' : ''}" data-acc-tab="auth">🔐 COMPTE &amp; SYNCHRO</button>
        </div>

        <div class="acc-body">
          ${msgHtml}
          ${activeTab === 'profile' ? profileTabHtml : authTabHtml}
        </div>
      </div>
    `;

    // Événements internes de la modale
    modal.querySelector('#btnAccClose')?.addEventListener('click', () => account.closeModal());
    modal.querySelectorAll('[data-acc-tab]').forEach((b) => {
      b.addEventListener('click', () => { activeTab = b.dataset.accTab; authMsg = null; renderModal(); });
    });
    modal.querySelector('#formAccLogin')?.addEventListener('submit', (e) => {
      e.preventDefault();
      account.login(modal.querySelector('#accLoginUser').value, modal.querySelector('#accLoginPass').value);
    });
    modal.querySelector('#formAccRegister')?.addEventListener('submit', (e) => {
      e.preventDefault();
      account.register(modal.querySelector('#accRegUser').value, modal.querySelector('#accRegPass').value);
    });
    modal.querySelector('#formAccReauth')?.addEventListener('submit', (e) => {
      e.preventDefault();
      account.login(state.username, modal.querySelector('#accReauthPass').value);
    });
    modal.querySelector('#btnAccSync')?.addEventListener('click', () => account.syncNow(false));
    modal.querySelector('#btnAccLogout')?.addEventListener('click', () => account.logout());
    modal.querySelector('#btnAccExport')?.addEventListener('click', async () => {
      const code = account.exportBackup();
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
        authMsg = { kind: 'ok', text: 'Code de sauvegarde copié dans le presse-papiers !' };
      } catch {
        authMsg = { kind: 'info', text: 'Code affiché dans le champ ci-dessous : copiez-le manuellement.' };
      }
      renderModal();
      if (!copied) {
        const inp = modal.querySelector('#accImportInput');
        if (inp) { inp.value = code; inp.select(); }
      }
    });
    modal.querySelector('#btnAccImport')?.addEventListener('click', () => {
      const val = modal.querySelector('#accImportInput')?.value || '';
      account.importBackup(val);
    });
  }

  function renderAll() {
    renderTitleStrip();
    renderModal();
  }

  // ------------------------------------------------ Initialisation & listeners DOM
  loadLocal();

  // Clics sur les boutons d'ouverture du profil
  document.getElementById('btnOpenAccount')?.addEventListener('click', (e) => {
    e.stopPropagation();
    account.openModal('profile');
  });
  document.getElementById('btnOpenAuth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    account.openModal('auth');
  });
  const modalEl = document.getElementById('accountModal');
  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === modalEl) account.closeModal();
    });
    modalEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
  }

  renderAll();
  onLevelChange?.(levelInfo(state.stats.xp).level);

  // Vérification silencieuse de la session serveur au chargement (mode hybride)
  if (state.mode === 'account' && state.token) {
    onProfileChange?.({ username: state.username });
    api('me', null, 'GET').then((res) => {
      if (res.ok && res.data?.user) {
        applyServerUser(res.data.user);
      } else if (res.status === 401) {
        state.syncStatus = 'reauth';
        renderAll();
      }
    }).catch(() => {
      state.syncStatus = 'local';
      renderAll();
    });
  }

  return account;
}
