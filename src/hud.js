const $ = (id) => document.getElementById(id);
const SHORT = { m1911: '1911', arex: 'AREX', deagle: 'DEAGLE', magnum: 'PYTHON', rifle: 'M4A1', ak47: 'AK-47', famas: 'FAMAS', scar: 'SCAR', smg: 'MP40', mp5: 'MP5', p90: 'P90', lmg: 'RPK', m249: 'M249', mg42: 'MG42', pkm: 'PKM', sniper: 'L96', svd: 'SVD', barrett: 'M82', shotgun: '870', raygun: 'RAYONS', saiga: 'SAIGA', crossbow: 'ARBALÈTE', m79: 'M79' };
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
      vehHud: $('vehHud'),
      speedo: $('speedo'),
      speedFill: $('vSpeedFill'),
      speedTick: $('vSpeedTick'),
      hpFill: $('vHpFill'),
      hpTxt: $('vHpTxt'),
      fuelRow: $('vFuelRow'),
      fuelFill: $('vFuelFill'),
      fuelTxt: $('vFuelTxt'),
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
      keysPanel: $('keysPanel'),
      mapHint: $('mapHint'),
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

  // Une touche a changé (game.binds) : les textes HUD qui la citent sont refaits à la prochaine mise à jour
  refreshKeys() {
    for (const k of ['inv', 'nades', 'ammo']) delete this.cache[k];
    if (this.el.mapHint && this.binds) this.el.mapHint.textContent = `${this.binds.tag('map')} carte`;
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

  // gl : obus restants du lance-grenades sous canon (niveau III des fusils d'assaut), undefined sinon
  setAmmo(mag, reserve, reloading, gl) {
    this._set('ammo', `${mag}/${reserve}/${reloading}/${gl}`, () => {
      const g = gl == null ? '' : ` <span style="font-size:18px;color:#ffb060">· 40 mm ×${gl} [clic molette]</span>`;
      this.el.ammo.innerHTML = (reloading ? `<span>RECHARGEMENT…</span>` : `${mag} <span>/ ${reserve}</span>`) + g;
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

  // Nom de l'arme, avec le calibre en petit dessous
  setWeapon(name, caliber = '') {
    this._set('weapon', `${name}|${caliber}`, () => {
      this.el.weapon.textContent = name;
      if (caliber) {
        const small = document.createElement('small');
        small.textContent = caliber;
        this.el.weapon.appendChild(small);
      }
    });
  }

  setInventory(inventory, activeIdx) {
    const key = inventory.map((w, i) => `${i === activeIdx ? '*' : ''}${w.id}${'+'.repeat(w.pap | 0)}`).join(',');
    this._set('inv', key, () => {
      this.el.inv.innerHTML = inventory
        .map((w, i) => {
          const name = (SHORT[w.id] || w.id) + '+'.repeat(w.pap | 0);
          const isAct = i === activeIdx;
          return `<span style="color:${isAct ? '#ffd24a' : '#777'};font-weight:${isAct ? 'bold' : 'normal'}">${this.binds ? this.binds.label('weapon' + (i + 1)) : i + 1}: ${name}</span>`;
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

  // Tableau de bord de la moto : info = { speed (m/s), vmax, vmin (seuil d'écrasement) } ou null pour le masquer.
  // Compteur gris sous le seuil d'écrasement, rouge au-dessus ; trait de seuil sur la jauge de vitesse.
  setVehicle(info) {
    this._set('vehOn', !!info, (on) => { this.el.vehHud.style.display = on ? 'block' : 'none'; });
    if (!info) return;
    const kmh = Math.round(Math.abs(info.speed) * 3.6), hot = Math.abs(info.speed) >= info.vmin;
    this._set('speedo', `${kmh}|${hot}`, () => {
      this.el.speedo.innerHTML = `${kmh}<small>km/h</small>`;
      this.el.speedo.classList.toggle('hot', hot);
    });
    this._set('speedbar', `${Math.round(Math.abs(info.speed) / info.vmax * 200)}`, () => { this.el.speedFill.style.width = `${Math.min(100, Math.abs(info.speed) / info.vmax * 100)}%`; });
    this._set('speedtick', `${info.vmin}|${info.vmax}`, () => { this.el.speedTick.style.left = `${Math.min(100, info.vmin / info.vmax * 100)}%`; });
    // points de vie de la moto : verte, orange sous 50 %, rouge sous 25 %
    const f = info.hpMax > 0 ? Math.max(0, info.hp / info.hpMax) : 0, pct = Math.round(f * 100);
    this._set('vhp', pct, () => {
      this.el.hpFill.style.width = `${pct}%`;
      this.el.hpFill.style.background = f < 0.25 ? '#e03030' : f < 0.5 ? '#f0a030' : '#3fbf5f';
      this.el.hpTxt.textContent = `${pct} %`;
    });
    // essence : ambre, rouge clignotant sous 15 %
    const ff = Math.max(0, info.fuel ?? 0), fp = Math.round(ff * 100);
    this._set('vfuel', fp, () => {
      this.el.fuelFill.style.width = `${fp}%`;
      this.el.fuelFill.style.background = ff < 0.15 ? '#e03030' : '#e8b030';
      this.el.fuelTxt.textContent = `${fp} %`;
      this.el.fuelRow.classList.toggle('low', ff < 0.15);
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
      const down = tm.dead || tm.downed;
      if (down && !tm.dead && performance.now() % 700 > 400) continue; // à terre : le point clignote ; mort : fixe
      ctx.fillStyle = down ? '#ff3333' : (tm.color || '#3a7bd5');
      ctx.beginPath();
      ctx.arc(px, py, down ? 4.6 : 3.8, 0, Math.PI * 2);
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

  // Bandeau en haut de l'écran (compte à rebours de la fin de partie)
  setBanner(text) {
    if (!this.banner) {
      this.banner = document.createElement('div');
      Object.assign(this.banner.style, { position: 'absolute', left: '50%', top: '86px', transform: 'translateX(-50%)', width: 'max-content', maxWidth: '92vw', boxSizing: 'border-box', textAlign: 'center', padding: '6px 22px', background: 'rgba(90,0,0,0.75)', border: '1px solid #ff5040', borderRadius: '4px', color: '#ffd8c8', fontSize: '22px', letterSpacing: '3px', textShadow: '0 0 6px #000', display: 'none' });
      this.el.hud.appendChild(this.banner);
    }
    this._set('banner', text || '', () => { this.banner.style.display = text ? 'block' : 'none'; this.banner.textContent = text || ''; });
  }

  // Barre de vie du boss (haut de l'écran) : { hp, max, phase, name, inv, thresholds } ou null.
  // Le Bourreau : barre coupée aux seuils de phase (thresholds : 0,7 / 0,45 / 0,2), « I · LE BOURREAU »… « IV · LE JUGEMENT » ; grise et
  // « INVULNÉRABLE » pendant les transitions. Le mini-boss (Maître Tanneur) : une seule barre sans coupure, sans numéro de phase.
  setBossBar(b) {
    const ROMAN = ['I', 'II', 'III', 'IV'];
    if (!this.bossBar) {
      const w = document.createElement('div');
      Object.assign(w.style, { position: 'absolute', left: '50%', top: '128px', transform: 'translateX(-50%)', width: '520px', display: 'none', textAlign: 'center', textShadow: '0 0 6px #000' });
      w.innerHTML = '<div class="bn" style="font-size:20px;letter-spacing:5px;color:#ffb0a0"></div><div class="bt" style="position:relative;height:14px;border:1px solid #a33;background:rgba(0,0,0,.65)"><div class="bf" style="height:100%;width:100%;background:linear-gradient(#e33,#900)"></div><div class="bi" style="position:absolute;left:0;right:0;top:-1px;font-size:11px;line-height:16px;letter-spacing:6px;color:#e8eef8;display:none">INVULNÉRABLE</div></div>';
      this.el.hud.appendChild(w);
      this.bossBar = { w, n: w.querySelector('.bn'), t: w.querySelector('.bt'), f: w.querySelector('.bf'), i: w.querySelector('.bi'), ticks: [] };
    }
    const bb = this.bossBar, th = b && b.thresholds ? b.thresholds : [];
    const k = b ? `${Math.round((b.hp / b.max) * 400)}|${b.phase}|${b.inv ? 1 : 0}|${b.name}|${th.length}` : '';
    this._set('bossbar', k, () => {
      bb.w.style.display = b ? 'block' : 'none';
      if (!b) return;
      while (bb.ticks.length < th.length) { const t = document.createElement('div'); Object.assign(t.style, { position: 'absolute', top: '-3px', width: '2px', height: '20px', background: '#f2d0c8', opacity: '0.85' }); bb.t.appendChild(t); bb.ticks.push(t); }
      bb.ticks.forEach((t, i) => { t.style.display = i < th.length ? 'block' : 'none'; if (i < th.length) t.style.left = `calc(${th[i] * 100}% - 1px)`; });
      bb.f.style.width = `${Math.max(0, (b.hp / b.max) * 100)}%`;
      bb.f.style.background = b.inv ? 'linear-gradient(#9aa0a8,#5a5f68)' : b.phase >= 4 ? 'linear-gradient(#ff7a2a,#b02000)' : 'linear-gradient(#e33,#900)';
      bb.i.style.display = b.inv ? 'block' : 'none';
      bb.n.textContent = th.length ? `${ROMAN[Math.max(0, Math.min(3, b.phase - 1))]} · ${b.name}` : b.name;
      bb.n.style.color = b.inv ? '#c4ccd8' : '#ffb0a0';
    });
  }

  // Marque de la Sentence : bandeau rouge « CONDAMNÉ · 6 s » (null : retire)
  setMark(text) {
    if (!this.markEl) {
      const e = document.createElement('div');
      Object.assign(e.style, { position: 'absolute', left: '50%', bottom: '160px', transform: 'translateX(-50%)', padding: '6px 26px', background: 'rgba(120,0,0,0.78)', border: '2px solid #ff3a28', borderRadius: '4px', color: '#ffd8d0', fontSize: '24px', letterSpacing: '5px', textShadow: '0 0 8px #000', display: 'none' });
      this.el.hud.appendChild(e); this.markEl = e;
    }
    this._set('mark', text || '', () => { this.markEl.style.display = text ? 'block' : 'none'; this.markEl.textContent = text || ''; });
  }

  // Jauge du Fanal d'Erwin (Acte V) : barre dorée au bas de l'écran, avec un texte ; frac entre 0 et 1, null la retire
  setFanal(frac, text) {
    if (!this.fanalEl) {
      const e = document.createElement('div');
      Object.assign(e.style, { position: 'absolute', left: '50%', bottom: '118px', transform: 'translateX(-50%)', width: '380px', display: 'none', textAlign: 'center', color: '#ffe9b0', fontSize: '18px', letterSpacing: '3px', textShadow: '0 0 8px #000' });
      e.innerHTML = '<div class="ft"></div><div style="height:12px;margin-top:6px;border:1px solid #d9a441;background:rgba(0,0,0,.65)"><div class="ff" style="height:100%;width:0;background:linear-gradient(#ffe08a,#ff8a1c)"></div></div>';
      this.el.hud.appendChild(e); this.fanalEl = { e, t: e.querySelector('.ft'), f: e.querySelector('.ff') };
    }
    const f = this.fanalEl, on = frac != null;
    this._set('fanal', on ? `${Math.round(frac * 200)}|${text}` : '', () => { f.e.style.display = on ? 'block' : 'none'; if (on) { f.t.textContent = text || ''; f.f.style.width = `${Math.round(frac * 100)}%`; } });
  }

  setNades(n) {
    this._set('nades', n, () => { this.el.nades.textContent = `GRENADES ${this.binds ? this.binds.tag('grenade') : '[G]'} ${'● '.repeat(n)}${n ? '' : '—'}`; });
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
  // marks : repères des coéquipiers [{ bearing (degrés, 0 = nord, 90 = est), color, down }] : triangle de la couleur du joueur, croix rouge
  // s'il est à terre ; hors du champ affiché, le repère se colle au bord correspondant.
  drawCompass(yaw, marks = []) {
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
    for (const m of marks) {
      let df = ((m.bearing - heading + 540) % 360) - 180;
      const edge = Math.abs(df) > span / 2;
      df = Math.max(-span / 2 + 6, Math.min(span / 2 - 6, df));
      const x = W / 2 + (df / span) * W;
      ctx.globalAlpha = edge ? 0.55 : 1;
      if (m.down) { // croix rouge
        ctx.fillStyle = '#000'; ctx.fillRect(x - 6, 12, 12, 12); ctx.fillRect(x - 3, 9, 6, 18);
        ctx.fillStyle = '#e02820'; ctx.fillRect(x - 5, 14, 10, 8); ctx.fillRect(x - 2, 11, 4, 14);
      } else {
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(x - 7, 11); ctx.lineTo(x + 7, 11); ctx.lineTo(x, 24); ctx.fill();
        ctx.fillStyle = m.color || '#3a7bd5'; ctx.beginPath(); ctx.moveTo(x - 5, 12); ctx.lineTo(x + 5, 12); ctx.lineTo(x, 21); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.moveTo(W / 2 - 6, 0); ctx.lineTo(W / 2 + 6, 0); ctx.lineTo(W / 2, 7); ctx.fill();
  }

  // Indicateurs fléchés au bord de l'écran vers les coéquipiers à terre hors de vue : list = [{ id, x, y, angle, text, color }]
  setDownMarks(list) {
    if (!this.downBox) {
      this.downBox = document.createElement('div');
      Object.assign(this.downBox.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
      this.el.hud.appendChild(this.downBox);
      this.downPool = [];
    }
    while (this.downPool.length < list.length) {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'absolute', left: '0', top: '0', display: 'none', font: 'bold 15px Arial, sans-serif', color: '#fff', textShadow: '0 0 4px #000, 0 0 2px #000', whiteSpace: 'nowrap', textAlign: 'center' });
      d.innerHTML = '<div class="arr" style="width:0;height:0;margin:0 auto;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:22px solid #e02820;filter:drop-shadow(0 0 3px #000)"></div><div class="txt"></div>';
      this.downBox.appendChild(d); this.downPool.push(d);
    }
    this.downPool.forEach((d, i) => {
      const m = list[i];
      if (!m) { if (d.style.display !== 'none') d.style.display = 'none'; return; }
      d.style.display = 'block';
      d.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px) translate(-50%, -50%)`;
      d.firstChild.style.transform = `rotate(${m.angle}rad)`;
      const t = d.lastChild; if (t.textContent !== m.text) t.textContent = m.text;
      t.style.color = m.color || '#fff';
    });
  }

  // Vue du joueur à terre : compte à rebours au centre, distance au coéquipier debout le plus proche, et qui le réanime
  // info = { sec, nearest: { name, dist } | null, reviver: { name, left } | null } ou null
  setDownedView(info) {
    if (!this.downView) {
      this.downView = document.createElement('div');
      Object.assign(this.downView.style, { position: 'absolute', left: '50%', top: '34%', transform: 'translateX(-50%)', textAlign: 'center', font: 'bold 20px Arial, sans-serif', color: '#fff', textShadow: '0 0 6px #000, 0 0 3px #000', display: 'none', letterSpacing: '2px', pointerEvents: 'none' });
      this.el.hud.appendChild(this.downView);
    }
    const key = info ? `${info.sec}|${info.nearest ? info.nearest.name + Math.round(info.nearest.dist) : ''}|${info.reviver ? info.reviver.name + info.reviver.left.toFixed(1) : ''}` : '';
    this._set('downview', key, () => {
      this.downView.style.display = info ? 'block' : 'none';
      if (!info) return;
      const esc = (t) => String(t).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
      this.downView.innerHTML = `<div style="font-size:64px;color:#ff4a3a;line-height:1">${info.sec} s</div><div style="font-size:16px;color:#ffb0a0">VOUS ÊTES À TERRE</div>`
        + (info.reviver ? `<div style="margin-top:8px;color:#8cff9a">${esc(info.reviver.name)} vous réanime ${info.reviver.left.toFixed(1)} s</div>`
          : info.nearest ? `<div style="margin-top:8px">Coéquipier le plus proche : ${esc(info.nearest.name)}, ${Math.round(info.nearest.dist)} m</div>` : '<div style="margin-top:8px;color:#bbb">Aucun coéquipier debout</div>');
    });
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
    // 27 zones : la police suit la surface de la zone (les petites zones du centre restent lisibles), les zones encore fermées sont
    // plus pâles
    world.zoneCenters.forEach((c, i) => {
      if (!c) return;
      const [x, y] = P(c.x, c.z);
      const size = Math.round(11 + Math.sqrt(world.zoneArea?.[i] || 8000) / 20) + (i === here ? 3 : 0);
      ctx.font = `bold ${size}px Impact, Arial`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(c.name.toUpperCase(), x, y);
      ctx.fillStyle = i === here ? '#ffd24a' : world.isZoneOpen?.(i) ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.62)';
      ctx.fillText(c.name.toUpperCase(), x, y);
    });
    // limites fermées (aucune tant que toute l'île est ouverte)
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
    // lignes de tram (v0.38.0) : trait de la couleur de la ligne, arrêts en carrés blancs avec leur nom
    for (const t of world.tram?.net.tracks || []) {
      const col = t.def.color || '#ddd', o = {};
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [lw, c] of [[5, 'rgba(0,0,0,0.75)'], [3, col]]) {
        ctx.lineWidth = lw; ctx.strokeStyle = c; ctx.beginPath();
        for (let s = 0; s <= t.L + 6; s += 6) { t.at(Math.min(s, t.L), o); const [x, y] = P(o.x, o.z); if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.font = 'bold 11px Arial';
      for (const st of t.stops) {
        t.at(st.s, o); const [x, y] = P(o.x, o.z);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(st.name, x, y + 15); ctx.fillStyle = '#e6edf5'; ctx.fillText(st.name, x, y + 15);
      }
    }
    // machines, armes, munitions
    const icon = (x, z, color, label, fx = null, fy = null) => {
      const [px, py] = fx == null ? P(x, z) : [fx, fy];
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.fillText(label, px, py + 3.5);
    };
    for (const s of world.stations || []) icon(s.x, s.z, '#2a9d4a', '⁍');
    for (const w of world.wallWeapons || []) icon(w.pos.x, w.pos.z, '#d98a2b', '⌐');
    // parking des motos : carré arrondi bleu « P » (forme différente des pastilles rondes) ; les motos garées s'affichent à côté (leurs
    // positions sont à 2 m l'une de l'autre) ; une moto qui roule s'affiche à sa vraie place. M : moto (solo), G : grosse moto (2 places)
    const pks = world.parkings || [];
    for (const pk of pks) {
      const [qx, qy] = P(pk.x, pk.z);
      ctx.fillStyle = '#2a6fd8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(qx - 12, qy - 12, 24, 24, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 17px Arial'; ctx.fillText('P', qx, qy + 6);
    }
    for (const v of world.vehicles || []) {
      const lab = v.type === 'moto' ? 'M' : 'G', f = v.hp / v.maxHp;
      const col = f < 0.25 ? '#d83a2e' : f < 0.5 ? '#e8892b' : '#e0c22e'; // jaune, orange sous 50 % des PV, rouge sous 25 %
      const pk = pks.find((q) => Math.hypot(v.pos.x - q.x, v.pos.z - q.z) < 9) || pks.find((q) => Math.hypot(v.spawn.x - q.x, v.spawn.z - q.z) < 9); // parking de la moto (garée ou d'attache)
      const parked = !!pk && Math.hypot(v.pos.x - pk.x, v.pos.z - pk.z) < 9;
      let qx, qy;
      if (v.state === 'gone' || (pk && v.state === 'wreck' && parked)) [qx, qy] = P(v.spawn.x, v.spawn.z);
      else [qx, qy] = P(v.pos.x, v.pos.z);
      if (pk && (parked || v.state === 'gone')) { const [cx, cy] = P(pk.x, pk.z); qx = cx + (pk.size > 1 ? (v.type === 'moto' ? -17 : 17) : 0); qy = cy + 19; }
      if (v.state === 'wreck' || v.state === 'gone') { // épave : croix grise « M+2 » (revient 2 manches après sa destruction)
        ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(qx - 7, qy - 7); ctx.lineTo(qx + 7, qy + 7); ctx.moveTo(qx + 7, qy - 7); ctx.lineTo(qx - 7, qy + 7); ctx.stroke();
        ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 3; ctx.stroke();
        ctx.font = 'bold 10px Arial'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(`${lab}+2`, qx, qy + 20); ctx.fillStyle = '#ccc'; ctx.fillText(`${lab}+2`, qx, qy + 20);
      } else icon(0, 0, col, lab, qx, qy);
    }
    for (const m of world.machines || []) if (m.type !== 'box' || m.active) icon(m.pos.x, m.pos.z, m.type === 'box' ? '#3f8fd8' : m.color, m.type === 'box' ? '?' : m.type === 'pap' ? 'P' : (m.letter || m.name[0]));
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
    ctx.fillText('▲ vous   ● vert : munitions   ● orange : arme murale   ● bleu ? : boîte mystère   P : Pack-a-Punch   ● couleurs : atouts   ■ rouge : porte verrouillée (prix)   P bleu : motos   — doré : passage sous immeuble   ━ lignes de tram   N ↑', 30, H - 18);
  }

  setRoomBadge(code) {
    if (!this.el.roomBadge) return;
    this.el.roomBadge.style.display = code ? 'block' : 'none';
    this.el.roomBadge.textContent = code ? `SALON : ${code}` : '';
  }

  setTeammates(list) {
    if (!this.el.teammates) return;
    if (!list || list.length === 0) {
      this._set('teammates', '', () => { this.el.teammates.innerHTML = ''; });
      return;
    }
    const key = list.map((p) => `${p.name}|${p.points || 0}|${Math.round(p.health)}|${p.dead ? 1 : 0}|${p.color}`).join(';');
    this._set('teammates', key, () => { this.el.teammates.innerHTML = list.map((p) => {
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
    }).join(''); });
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
    for (const k of ['titlePanel', 'menuPanel', 'pausePanel', 'optionsPanel', 'keysPanel']) {
      this.el[k].classList.toggle('hidden', k !== name);
    }
    this.el.overlay.classList.toggle('keysOpen', name === 'keysPanel'); // le menu Touches prend toute la place (titre masqué)
    this.el.overlay.classList.toggle('optionsOpen', name === 'optionsPanel'); // options : titre masqué sur les petits écrans
  }

  showMenu(title, text) {
    this.screenTitle = '';
    this.el.ovTitle.textContent = title;
    this.el.ovText.innerHTML = text;
    this.el.ovBtn.classList.add('hidden');
    this.showPanel('titlePanel');
    this.el.overlay.classList.remove('hidden');
  }

  showOverlay(title, text, btn) {
    this.screenTitle = title; // écran à bouton en cours (lu par ui.js pour la pile de couches)
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
    this.screenTitle = '';
    this.el.overlay.classList.add('hidden');
  }

  // Petit message temporaire sous la boussole (journal du menu debug, annonces discrètes)
  toast(text, ms = 4000) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      Object.assign(this.toastEl.style, { position: 'absolute', left: '50%', top: '96px', transform: 'translateX(-50%)', padding: '4px 14px', background: 'rgba(5,12,18,0.78)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', color: '#cfe3ff', font: '14px Arial, sans-serif', letterSpacing: '1px', display: 'none', whiteSpace: 'nowrap' });
      this.el.hud.appendChild(this.toastEl);
    }
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { this.toastEl.style.display = 'none'; }, ms);
  }
}
