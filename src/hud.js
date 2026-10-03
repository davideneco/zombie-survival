const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.cache = {};
    this.el = {
      health: $('healthfill'),
      ammo: $('ammo'),
      points: $('points'),
      round: $('roundNum'),
      prompt: $('prompt'),
      announce: $('announce'),
      vignette: $('vignette'),
      nukeflash: $('nukeflash'),
      hit: $('hitmarker'),
      hud: $('hud'),
      weapon: $('weapon'),
      inv: $('inv'),
      powerupBar: $('powerupBar'),
      radar: $('radarCanvas'),
      overlay: $('overlay'),
      ovTitle: $('ovTitle'),
      ovText: $('ovText'),
      ovBtn: $('ovBtn'),
      roomBadge: $('roomBadge'),
      teammates: $('teammates'),
      menuPanel: $('menuPanel'),
      playerName: $('playerName'),
      btnSolo: $('btnSolo'),
      btnHost: $('btnHost'),
      joinCode: $('joinCode'),
      btnJoin: $('btnJoin'),
      lobbyBox: $('lobbyBox'),
      lobbyStatus: $('lobbyStatus'),
      lobbyPlayers: $('lobbyPlayers'),
      btnStartGame: $('btnStartGame'),
    };
    this.radarCtx = this.el.radar ? this.el.radar.getContext('2d') : null;
    this.damageFlash = 0;
    this.nukeFlash = 0;
    this.announceTimer = null;
  }

  _set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  setHealth(h, max) {
    this._set('health', Math.round(h), () => {
      this.el.health.style.width = `${(h / max) * 100}%`;
    });
    this.lowHealth = 1 - h / max;
  }

  setAmmo(mag, reserve, reloading) {
    this._set('ammo', `${mag}/${reserve}/${reloading}`, () => {
      this.el.ammo.innerHTML = reloading ? `<span>RECHARGEMENT…</span>` : `${mag} <span>/ ${reserve}</span>`;
    });
  }

  setPoints(p) {
    this._set('points', p, () => {
      this.el.points.textContent = p;
    });
  }

  setRound(r) {
    this._set('round', r, () => {
      this.el.round.textContent = r;
    });
  }

  setWeapon(name) {
    this._set('weapon', name, () => {
      this.el.weapon.textContent = name;
    });
  }

  setInventory(inventory, activeIdx) {
    const key = inventory.map((w, i) => `${i === activeIdx ? '*' : ''}${w.id}`).join(',');
    this._set('inv', key, () => {
      this.el.inv.innerHTML = inventory
        .map((w, i) => {
          const name = w.id === 'rifle' ? 'FUSIL' : w.id === 'shotgun' ? 'POMPE' : 'PM';
          const isAct = i === activeIdx;
          return `<span style="color:${isAct ? '#ffd24a' : '#777'};font-weight:${isAct ? 'bold' : 'normal'}">${i + 1}: ${name}</span>`;
        })
        .join(' &nbsp;·&nbsp; ');
    });
  }

  setPowerups(buffs) {
    const key = `${Math.ceil(buffs.instaKill || 0)}_${Math.ceil(buffs.doublePoints || 0)}`;
    this._set('powerups', key, () => {
      let html = '';
      if (buffs.instaKill > 0) {
        html += `<div class="buff insta">💀 MORT INSTANTANÉE (${Math.ceil(buffs.instaKill)}s)</div>`;
      }
      if (buffs.doublePoints > 0) {
        html += `<div class="buff double">⚡ POINTS DOUBLES (${Math.ceil(buffs.doublePoints)}s)</div>`;
      }
      this.el.powerupBar.innerHTML = html;
    });
  }

  prompt(text) {
    this._set('prompt', text || '', () => {
      this.el.prompt.style.display = text ? 'block' : 'none';
      this.el.prompt.textContent = text || '';
    });
  }

  announce(title, sub = '', duration = 3000) {
    const a = this.el.announce;
    a.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    a.classList.add('show');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => a.classList.remove('show'), duration);
  }

  hitMarker(kill) {
    const h = this.el.hit;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    if (kill) h.classList.add('kill');
    h.classList.add('show');
  }

  popup(text, cls = '') {
    const p = document.createElement('div');
    p.className = `popup ${cls}`;
    p.textContent = text;
    p.style.marginTop = `${Math.random() * 30 - 15}px`;
    p.addEventListener('animationend', () => p.remove());
    this.el.hud.appendChild(p);
  }

  damage() {
    this.damageFlash = 1;
  }

  flashNuke() {
    this.nukeFlash = 1.0;
  }

  // Radar tactique : orienté selon la vue du joueur
  drawRadar(player, zombies, pois = [], teammates = []) {
    const ctx = this.radarCtx;
    if (!ctx) return;
    const w = 120, h = 120;
    const cx = w / 2, cy = h / 2, r = w / 2 - 3;
    const maxRange = 36; // mètres affichés sur le radar

    ctx.clearRect(0, 0, w, h);

    // Cercles concentriques
    ctx.strokeStyle = 'rgba(70, 130, 90, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2); ctx.stroke();

    // Lignes de visée
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.stroke();

    const cosY = Math.cos(-player.yaw);
    const sinY = Math.sin(-player.yaw);

    // Points d'intérêt (stations d'achat, etc.)
    for (const poi of pois) {
      const dx = poi.x - player.pos.x;
      const dz = poi.z - player.pos.z;
      // Rotation relative au joueur
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;
      const d = Math.hypot(rx, rz);
      if (d > maxRange) continue;
      const px = cx + (rx / maxRange) * r;
      const py = cy + (rz / maxRange) * r;
      ctx.fillStyle = poi.color || '#33ff77';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Coéquipiers
    for (const tm of teammates) {
      if (!tm) continue;
      const dx = tm.pos.x - player.pos.x;
      const dz = tm.pos.z - player.pos.z;
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;
      const d = Math.hypot(rx, rz);
      if (d > maxRange) continue;
      const px = cx + (rx / maxRange) * r;
      const py = cy + (rz / maxRange) * r;
      ctx.fillStyle = tm.dead ? '#ff3333' : (tm.color || '#3a7bd5');
      ctx.beginPath();
      ctx.arc(px, py, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Zombies
    ctx.fillStyle = '#ff2a2a';
    for (const z of zombies) {
      if (z.dead || z.spawnT > 0.5) continue;
      const dx = z.pos.x - player.pos.x;
      const dz = z.pos.z - player.pos.z;
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;
      const d = Math.hypot(rx, rz);
      if (d > maxRange) continue;
      const px = cx + (rx / maxRange) * r;
      const py = cy + (rz / maxRange) * r;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Joueur au centre (triangle vert pointant vers le haut)
    ctx.fillStyle = '#66ff99';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx - 3.5, cy + 4);
    ctx.lineTo(cx + 3.5, cy + 4);
    ctx.closePath();
    ctx.fill();
  }

  setRoomBadge(code) {
    if (!this.el.roomBadge) return;
    this.el.roomBadge.style.display = code ? 'block' : 'none';
    this.el.roomBadge.textContent = code ? `SALON : ${code}` : '';
  }

  setTeammates(list) {
    if (!this.el.teammates) return;
    if (!list || list.length === 0) {
      this.el.teammates.innerHTML = '';
      return;
    }
    this.el.teammates.innerHTML = list.map((p) => {
      const isDown = p.dead || p.health <= 0;
      const pct = Math.max(0, Math.min(100, p.health));
      const col = p.color || '#3a7bd5';
      return `
        <div class="tm-card ${isDown ? 'tm-down' : ''}">
          <div class="tm-header">
            <span class="tm-name" style="color:${col}">● ${p.name}</span>
            <span class="tm-pts">${p.points || 0} pts</span>
          </div>
          <div class="tm-bar"><div class="tm-fill" style="width:${isDown ? 100 : pct}%; background:${isDown ? '#f33' : col}"></div></div>
        </div>
      `;
    }).join('');
  }

  update(dt) {
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    const low = Math.max(0, (this.lowHealth ?? 0) - 0.3) * 1.2;
    this.el.vignette.style.opacity = Math.min(1, this.damageFlash * 0.9 + low);

    if (this.nukeFlash > 0) {
      this.nukeFlash = Math.max(0, this.nukeFlash - dt * 1.6);
      this.el.nukeflash.style.opacity = this.nukeFlash;
    }
  }

  showMenu(title, text) {
    this.el.ovTitle.textContent = title;
    this.el.ovText.innerHTML = text;
    this.el.ovBtn.classList.add('hidden');
    this.el.menuPanel.classList.remove('hidden');
    this.el.overlay.classList.remove('hidden');
  }

  showOverlay(title, text, btn) {
    this.el.ovTitle.textContent = title;
    this.el.ovText.innerHTML = text;
    this.el.menuPanel.classList.add('hidden');
    if (btn) {
      this.el.ovBtn.textContent = btn;
      this.el.ovBtn.classList.remove('hidden');
    } else {
      this.el.ovBtn.classList.add('hidden');
    }
    this.el.overlay.classList.remove('hidden');
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }
}
