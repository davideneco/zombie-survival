const $ = (id) => document.getElementById(id);
const SHORT = { rifle: 'FUSIL', shotgun: 'POMPE', smg: 'PM', lmg: 'RPK', sniper: 'SNIPER', magnum: '.357', raygun: 'RAYONS' };
const CARDINALS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]];

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
      titlePanel: $('titlePanel'),
      pausePanel: $('pausePanel'),
      optionsPanel: $('optionsPanel'),
      playerName: $('playerName'),
      btnSolo: $('btnSolo'),
      btnHost: $('btnHost'),
      joinCode: $('joinCode'),
      btnJoin: $('btnJoin'),
      lobbyBox: $('lobbyBox'),
      lobbyStatus: $('lobbyStatus'),
      lobbyPlayers: $('lobbyPlayers'),
      btnStartGame: $('btnStartGame'),
      nades: $('nades'),
      perks: $('perks'),
      compass: $('compass'),
      zoneName: $('zoneName'),
      mapOverlay: $('mapOverlay'),
      mapCanvas: $('mapCanvas'),
    };
    this.compassCtx = this.el.compass ? this.el.compass.getContext('2d') : null;
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
    const key = inventory.map((w, i) => `${i === activeIdx ? '*' : ''}${w.id}${w.pap ? '+' : ''}`).join(',');
    this._set('inv', key, () => {
      this.el.inv.innerHTML = inventory
        .map((w, i) => {
          const name = (SHORT[w.id] || w.id) + (w.pap ? '+' : '');
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
      const rx = dx * cosY + dz * sinY;
      const rz = -dx * sinY + dz * cosY;
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
      const rx = dx * cosY + dz * sinY;
      const rz = -dx * sinY + dz * cosY;
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
      const rx = dx * cosY + dz * sinY;
      const rz = -dx * sinY + dz * cosY;
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

  setNades(n) {
    this._set('nades', n, () => { this.el.nades.textContent = `GRENADES [G] ${'● '.repeat(n)}${n ? '' : '—'}`; });
  }

  setPerks(perks, defs) {
    const ids = Object.keys(perks).filter((k) => perks[k]);
    this._set('perks', ids.join(','), () => {
      this.el.perks.innerHTML = ids.map((id) => `<div class="perk" title="${defs[id].name}" style="background:${defs[id].color}">${defs[id].letter}</div>`).join('');
    });
  }

  setZone(name) {
    this._set('zone', name, () => { this.el.zoneName.textContent = name || ''; });
  }

  // Boussole : cap 0 = nord (-z), 90 = est (+x)
  drawCompass(yaw) {
    const ctx = this.compassCtx;
    if (!ctx) return;
    const W = 420, H = 30, span = 120; // degrés visibles
    const heading = ((-yaw * 180) / Math.PI % 360 + 360) % 360;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    for (let d = Math.ceil((heading - span / 2) / 15) * 15; d <= heading + span / 2; d += 15) {
      const x = W / 2 + ((d - heading) / span) * W;
      const deg = ((d % 360) + 360) % 360;
      const card = CARDINALS.find((c) => c[1] === deg);
      ctx.fillStyle = card ? (card[0] === 'N' ? '#ff5544' : '#fff') : 'rgba(255,255,255,0.45)';
      if (card) { ctx.font = 'bold 15px Arial'; ctx.fillText(card[0], x, 20); }
      else { ctx.fillRect(x - 0.5, 18, 1, 8); }
    }
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.moveTo(W / 2 - 6, 0); ctx.lineTo(W / 2 + 6, 0); ctx.lineTo(W / 2, 7); ctx.fill();
  }

  toggleMap(show) {
    this.mapOpen = show ?? !this.mapOpen;
    this.el.mapOverlay.classList.toggle('show', this.mapOpen);
  }

  // Carte plein écran : plan de l'île + zones, portes, machines, joueurs
  drawMap(world, player, teammates, myColor) {
    if (!this.mapOpen || !world.mapImage) return;
    const cv = this.el.mapCanvas;
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const img = world.mapImage, mv = world.mapView;
    // cadrage sur le secteur jouable (sinon toute l'île)
    const cr = world.mapCrop || { x0: -mv.halfX, x1: mv.halfX, z0: -mv.halfZ, z1: mv.halfZ };
    const sw = (cr.x1 - cr.x0) * mv.scale, sh = (cr.z1 - cr.z0) * mv.scale;
    const k = Math.min((W - 60) / sw, (H - 110) / sh);
    const ox = (W - sw * k) / 2, oy = 50 + (H - 110 - sh * k) / 2;
    ctx.drawImage(img, (cr.x0 + mv.halfX) * mv.scale, (cr.z0 + mv.halfZ) * mv.scale, sw, sh, ox, oy, sw * k, sh * k);
    const P = (x, z) => [ox + (x - cr.x0) * mv.scale * k, oy + (z - cr.z0) * mv.scale * k];

    // zones
    ctx.textAlign = 'center';
    const here = world.zoneOf(player.pos.x, player.pos.z);
    world.zoneCenters.forEach((c, i) => {
      if (!c) return;
      const [x, y] = P(c.x, c.z);
      ctx.font = `bold ${i === here ? 22 : 18}px Impact, Arial`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(c.name.toUpperCase(), x, y);
      ctx.fillStyle = i === here ? '#ffd24a' : 'rgba(255,255,255,0.8)';
      ctx.fillText(c.name.toUpperCase(), x, y);
    });
    // limites du secteur (barricades définitives)
    ctx.fillStyle = '#9aa0a6';
    for (const pt of world.sealedPoints || []) { const [x, y] = P(pt.x, pt.z); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    // portes
    for (const d of world.doors) {
      ctx.fillStyle = d.open ? 'rgba(80,220,120,0.6)' : '#ff4433';
      for (const pt of d.points) { const [x, y] = P(pt.x, pt.z); ctx.fillRect(x - 2, y - 2, 4, 4); }
      if (!d.open && d.points.length) {
        const pt = d.points[Math.floor(d.points.length / 2)], [x, y] = P(pt.x, pt.z);
        ctx.font = 'bold 12px Arial'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        ctx.strokeText(`🔒 ${d.price}`, x, y - 7); ctx.fillStyle = '#ffb0a0'; ctx.fillText(`🔒 ${d.price}`, x, y - 7);
      }
    }
    // machines, armes, munitions
    const icon = (x, z, color, label) => {
      const [px, py] = P(x, z);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.fillText(label, px, py + 3.5);
    };
    for (const s of world.stations || []) icon(s.x, s.z, '#2a9d4a', '⁍');
    for (const w of world.wallWeapons || []) icon(w.pos.x, w.pos.z, '#d98a2b', '⌐');
    for (const m of world.machines || []) icon(m.pos.x, m.pos.z, m.type === 'box' ? '#3f8fd8' : m.color, m.type === 'box' ? '?' : m.type === 'pap' ? 'P' : (m.letter || m.name[0]));
    // coéquipiers
    for (const tm of teammates) {
      const [x, y] = P(tm.pos.x, tm.pos.z);
      ctx.fillStyle = tm.dead || tm.downed ? '#ff3333' : tm.color;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#fff'; ctx.fillText(tm.name, x, y - 9);
    }
    // joueur : flèche orientée
    const [px, py] = P(player.pos.x, player.pos.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-player.yaw);
    ctx.fillStyle = myColor || '#66ff99'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-8, 9); ctx.lineTo(0, 4); ctx.lineTo(8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    // titre + légende
    ctx.textAlign = 'left';
    ctx.font = 'bold 26px Impact, Arial'; ctx.fillStyle = '#ffd24a';
    ctx.fillText(world.mapTitle || 'GRANDE ÎLE DE STRASBOURG', 30, 36);
    ctx.font = '13px Arial'; ctx.fillStyle = '#ccc';
    ctx.fillText('▲ vous   ● vert : munitions   ● orange : arme murale   ● bleu ? : boîte mystère   P : Pack-a-Punch   ● couleurs : atouts   ■ rouge : porte verrouillée   ■ gris : zone fermée   — doré : passage sous immeuble   N ↑', 30, H - 18);
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
            <span class="tm-name" style="color:${col}">● ${String(p.name).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')}</span>
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

  // Affiche un seul panneau du menu (titlePanel, menuPanel, pausePanel, optionsPanel) ou aucun.
  showPanel(name) {
    for (const k of ['titlePanel', 'menuPanel', 'pausePanel', 'optionsPanel']) {
      this.el[k].classList.toggle('hidden', k !== name);
    }
  }

  showMenu(title, text) {
    this.el.ovTitle.textContent = title;
    this.el.ovText.innerHTML = text;
    this.el.ovBtn.classList.add('hidden');
    this.showPanel('titlePanel');
    this.el.overlay.classList.remove('hidden');
  }

  showOverlay(title, text, btn) {
    this.el.ovTitle.textContent = title;
    this.el.ovText.innerHTML = text;
    this.showPanel(null);
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
