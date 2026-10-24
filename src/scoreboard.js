// Tableau des scores et statistiques de partie (v0.50.0).
// Affiché en maintenant la touche [TAB] pendant le jeu, sans interrompre la partie (pointer lock conservé, le jeu continue).
import { CONFIG } from './config.js';
import { slotColor } from './characters.js';

export class Scoreboard {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('scoreboard');
    this.list = document.getElementById('sbList');
    this.mode = document.getElementById('sbMode');
    this.round = document.getElementById('sbRound');
    this.time = document.getElementById('sbTime');
    this.totalKills = document.getElementById('sbTotalKills');
    this.perks = document.getElementById('sbPerks');
    this.visible = false;
    this.lastUpdate = 0;
  }

  show() {
    if (!this.el) return;
    this.visible = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    if (!this.el) return;
    this.visible = false;
    this.el.classList.add('hidden');
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  update(dt) {
    if (!this.visible) return;
    this.lastUpdate += dt;
    if (this.lastUpdate >= 0.1) {
      this.lastUpdate = 0;
      this.render();
    }
  }

  formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  render() {
    const g = this.game;
    if (!g || !this.el) return;
    const p = g.player;

    // En-tête
    if (this.round) this.round.textContent = `MANCHE ${g.round || 1}`;
    if (this.time) this.time.textContent = this.formatTime(g.time || 0);

    const remotes = [...g.remotes.values()];
    const totalKills = (g.kills || 0) + remotes.reduce((acc, r) => acc + (r.kills || 0), 0);
    if (this.totalKills) this.totalKills.textContent = totalKills.toLocaleString('fr-FR');

    if (this.mode) {
      if (g.isMultiplayer) {
        const roomCode = g.roomCode || g.net?.room;
        this.mode.textContent = `CO-OP EN LIGNE · ${1 + remotes.length}/4 JOUEURS${roomCode ? ` · SALON [${roomCode}]` : ''}`;
      } else {
        this.mode.textContent = 'PARTIE SOLO · STRASBOURG';
      }
    }

    // Joueur local
    const myName = g.playerName || 'Vous';
    const mySlot = g.mySlot ?? 0;
    const myColor = slotColor(mySlot);

    const myW = p?.curW;
    const myWepCfg = myW ? CONFIG.weapons[myW.id] : null;
    const myWepName = (myWepCfg?.name || myW?.id?.toUpperCase() || 'ARME') + (myW?.pap > 0 ? ` PaP ${['I', 'II', 'III'][myW.pap - 1]}` : '');

    const myStatus = p?.dead
      ? '<span class="sb-status-dead">🔴 ÉLIMINÉ</span>'
      : p?.downed
      ? `<span class="sb-status-down">🟡 À TERRE (${Math.ceil(p.bleedout || 0)}s)</span>`
      : '<span class="sb-status-alive">🟢 EN VIE</span>';

    const myHpFrac = Math.max(0, Math.min(1, (p?.health || 0) / (p?.maxHealth || 100)));
    const myHpColor = myHpFrac > 0.5 ? '#22c55e' : myHpFrac > 0.25 ? '#eab308' : '#ef4444';
    const myPing = g.isMultiplayer ? (g.net?.isHost ? '0 ms (HÔTE)' : `${g.netPing || 0} ms`) : 'LOCAL';

    let html = `
      <tr class="sb-row sb-row-me">
        <td>
          <div class="sb-player-cell">
            <span class="sb-slot-dot" style="background:${myColor};color:${myColor}"></span>
            <span class="sb-pname">${myName}<span class="sb-badge-me">VOUS</span></span>
          </div>
        </td>
        <td>${myStatus}</td>
        <td class="sb-pts">${(g.points || 0).toLocaleString('fr-FR')}</td>
        <td class="sb-kills">${(g.kills || 0).toLocaleString('fr-FR')}</td>
        <td class="sb-hs">${(g.headshots || 0).toLocaleString('fr-FR')}</td>
        <td class="sb-revs">${(g.statRevives || 0).toLocaleString('fr-FR')}</td>
        <td class="sb-downs">${(p?.statDowns || 0).toLocaleString('fr-FR')}</td>
        <td><span class="sb-wep">${myWepName}</span></td>
        <td>
          <div class="sb-hp-box">
            <div class="sb-hp-bar"><div class="sb-hp-fill" style="width:${Math.round(myHpFrac * 100)}%;background:${myHpColor}"></div></div>
            <span class="sb-hp-txt">${Math.round(p?.health || 0)} / ${Math.round(p?.maxHealth || 100)} PV</span>
          </div>
        </td>
        <td class="sb-ping">${myPing}</td>
      </tr>
    `;

    // Joueurs distants (multijoueur)
    for (const r of remotes) {
      const rColor = slotColor(r.slot ?? 1);
      const rStatus = r.dead
        ? '<span class="sb-status-dead">🔴 ÉLIMINÉ</span>'
        : r.downed
        ? `<span class="sb-status-down">🟡 À TERRE (${Math.ceil(r.bo || 0)}s)</span>`
        : '<span class="sb-status-alive">🟢 EN VIE</span>';

      const rWepCfg = r.weapon ? CONFIG.weapons[r.weapon] : null;
      const rWepName = (rWepCfg?.name || r.weapon?.toUpperCase() || 'ARME') + (r.pap > 0 ? ` PaP ${['I', 'II', 'III'][r.pap - 1]}` : '');

      const rHpFrac = Math.max(0, Math.min(1, (r.health || 0) / 100));
      const rHpColor = rHpFrac > 0.5 ? '#22c55e' : rHpFrac > 0.25 ? '#eab308' : '#ef4444';
      const rPing = r.ping ? `${r.ping} ms` : (r.id === g.net?.hostId ? '0 ms (HÔTE)' : '--');

      html += `
        <tr class="sb-row">
          <td>
            <div class="sb-player-cell">
              <span class="sb-slot-dot" style="background:${rColor};color:${rColor}"></span>
              <span class="sb-pname">${r.name || 'Joueur'}</span>
            </div>
          </td>
          <td>${rStatus}</td>
          <td class="sb-pts">${(r.points || 0).toLocaleString('fr-FR')}</td>
          <td class="sb-kills">${(r.kills || 0).toLocaleString('fr-FR')}</td>
          <td class="sb-hs">${(r.headshots || 0).toLocaleString('fr-FR')}</td>
          <td class="sb-revs">${(r.revs || 0).toLocaleString('fr-FR')}</td>
          <td class="sb-downs">${(r.downs || 0).toLocaleString('fr-FR')}</td>
          <td><span class="sb-wep">${rWepName}</span></td>
          <td>
            <div class="sb-hp-box">
              <div class="sb-hp-bar"><div class="sb-hp-fill" style="width:${Math.round(rHpFrac * 100)}%;background:${rHpColor}"></div></div>
              <span class="sb-hp-txt">${Math.round(r.health || 0)} PV</span>
            </div>
          </td>
          <td class="sb-ping">${rPing}</td>
        </tr>
      `;
    }

    if (this.list) this.list.innerHTML = html;

    // Atouts actifs du joueur local
    if (this.perks) {
      const activePerks = Object.keys(CONFIG.perks).filter((k) => p?.perks?.[k]);
      if (activePerks.length) {
        this.perks.innerHTML = '<span style="font-size:11px;color:#94a3b8;margin-right:6px;">ATOUTS :</span>' +
          activePerks.map((k) => {
            const perk = CONFIG.perks[k];
            return `<span class="sb-perk-pill" style="background:${perk.color}">${perk.name}</span>`;
          }).join('');
      } else {
        this.perks.innerHTML = '<span style="font-size:11px;color:#64748b;">AUCUN ATOUT ACTIF</span>';
      }
    }
  }
}
