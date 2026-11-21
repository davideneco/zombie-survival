import * as THREE from 'three';
import { CONFIG, PAP_LEVELS, isAttachmentUnlocked } from './config.js';
import { compatibleAttachments } from './viewmodels.js';
import { cloneWeapon } from './weaponDisplay.js';
import { totalXpForLevel } from './account.js';

// =====================================================================
//  Atelier d'armes interactif (touche [T], v0.104.0+) :
//   - Affiche l'arme en main avec aperçu 3D interactif (rotation souris 360°)
//     et tableau complet de statistiques en temps réel (avec prévisualisation au survol) ;
//   - Déblocage progressif des accessoires selon le niveau XP du joueur, puis achat en points ;
//   - Chaque accessoire acheté reste acquis sur cette arme (ré-équipement gratuit).
// =====================================================================

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (m) => {
  const d = Math.round((m - 1) * 100);
  return `${d > 0 ? '+' : ''}${d}%`;
};
const fmtZoom = (z) => `×${String(z).replace('.', ',')}`;

function describeBonuses(def) {
  const tags = [];
  if (def.zoomMult) tags.push({ txt: `Zoom ${fmtZoom(def.zoomMult)}`, good: true });
  else if (def.adsFovDelta) tags.push({ txt: 'Zoom optique', good: true });
  if (def.damageMult) tags.push({ txt: `${pct(def.damageMult)} Dégâts`, good: def.damageMult > 1 });
  if (def.headMult) tags.push({ txt: `${pct(def.headMult)} Tête`, good: def.headMult > 1 });
  if (def.fireRateMult) tags.push({ txt: `${pct(def.fireRateMult)} Cadence`, good: def.fireRateMult > 1 });
  if (def.magMult) tags.push({ txt: `${pct(def.magMult)} Chargeur`, good: def.magMult > 1 });
  if (def.reserveMult) tags.push({ txt: `${pct(def.reserveMult)} Réserve`, good: def.reserveMult > 1 });
  if (def.reloadMult) {
    const faster = def.reloadMult < 1;
    tags.push({ txt: `${pct(def.reloadMult)} Recharg.`, good: faster });
  }
  if (def.spreadMult) tags.push({ txt: `${Math.round((1 - def.spreadMult) * 100) > 0 ? '+' : ''}${Math.round((1 - def.spreadMult) * 100)}% Précision`, good: def.spreadMult < 1 });
  if (def.hipSpreadMult) tags.push({ txt: `+${Math.round((1 - def.hipSpreadMult) * 100)}% Tir au jugé`, good: def.hipSpreadMult < 1 });
  if (def.recoilMult) tags.push({ txt: `${pct(def.recoilMult)} Recul`, good: def.recoilMult < 1 });
  if (def.rangeMult) tags.push({ txt: `${pct(def.rangeMult)} Portée`, good: def.rangeMult > 1 });
  if (def.silenced) tags.push({ txt: 'Silencieux', good: true });
  return tags;
}

// Compute a hypothetical attachment list if `accId` is mounted in `slot` (or removed if accId === null)
function withSlotAtt(atts, slot, accId) {
  const defs = CONFIG.attachments?.defs || {};
  const next = (atts || []).filter((id) => defs[id]?.slot !== slot);
  if (accId) next.push(accId);
  return next;
}

export function installGunsmith(game, { hud, sfx }) {
  let box = document.getElementById('gunsmith');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gunsmith';
    box.className = 'hidden';
    document.body.appendChild(box);
  }

  // Lazy single 3D preview renderer (created on first open, paused when closed)
  const preview = {
    renderer: null,
    scene: null,
    camera: null,
    pivot: null,
    model: null,
    key: '',
    raf: 0,
    yaw: Math.PI * 0.44,
    pitch: 0.14,
    dragging: false,
    lastX: 0,
    lastY: 0,
    canvas: null,
  };

  function ensurePreview(canvas) {
    if (preview.renderer && preview.canvas === canvas) return;
    if (preview.renderer) {
      preview.canvas = canvas;
    } else {
      preview.canvas = canvas;
      preview.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      preview.renderer.setSize(420, 210, false);
      preview.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      preview.renderer.toneMappingExposure = 1.35;
      preview.renderer.outputColorSpace = THREE.SRGBColorSpace;

      preview.scene = new THREE.Scene();
      preview.camera = new THREE.PerspectiveCamera(32, 420 / 210, 0.05, 20);
      preview.camera.position.set(0, 0.12, 1.32);
      preview.camera.lookAt(0, 0, 0);

      const hemi = new THREE.HemisphereLight(0xd8e8ff, 0x222834, 1.45);
      const key = new THREE.DirectionalLight(0xfff2dc, 2.2);
      key.position.set(2.2, 2.8, 2.4);
      const rim = new THREE.DirectionalLight(0x4cb8ff, 1.35);
      rim.position.set(-2.5, 1.4, -2.0);
      const fill = new THREE.DirectionalLight(0xffbe7a, 0.65);
      fill.position.set(0, -1.8, 1.5);
      preview.scene.add(hemi, key, rim, fill);

      // Subtle holographic ring turntable under weapon
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.385, 48),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.24;
      preview.scene.add(ring);

      preview.pivot = new THREE.Group();
      preview.scene.add(preview.pivot);
    }
  }

  function updatePreviewModel(w, attsOverride = null) {
    if (!preview.pivot || !w) return;
    const atts = Array.isArray(attsOverride) ? attsOverride : (w.atts || []);
    const key = `${w.id}|${w.pap | 0}|${atts.slice().sort().join(',')}`;
    if (preview.key === key) return;
    preview.key = key;
    if (preview.model) {
      preview.pivot.remove(preview.model);
      preview.model = null;
    }
    const clone = cloneWeapon(w.id, w.pap | 0, atts);
    if (!clone) return;
    // Normalize & center weapon inside the preview frame regardless of gun size
    const wrap = new THREE.Group();
    wrap.add(clone);
    const box3 = new THREE.Box3().setFromObject(clone);
    const center = box3.getCenter(new THREE.Vector3());
    const size = box3.getSize(new THREE.Vector3());
    clone.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.25);
    const scale = 0.88 / maxDim;
    wrap.scale.setScalar(scale);
    preview.model = wrap;
    preview.pivot.add(wrap);
  }

  function startPreviewLoop() {
    if (preview.raf) return;
    let last = performance.now();
    const tick = (now) => {
      if (!gs.open) { preview.raf = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!preview.dragging) preview.yaw += dt * 0.42;
      if (preview.pivot) {
        preview.pivot.rotation.y = preview.yaw;
        preview.pivot.rotation.x = preview.pitch;
      }
      preview.renderer?.render(preview.scene, preview.camera);
      preview.raf = requestAnimationFrame(tick);
    };
    preview.raf = requestAnimationFrame(tick);
  }

  function stopPreviewLoop() {
    if (preview.raf) { cancelAnimationFrame(preview.raf); preview.raf = 0; }
  }

  const gs = {
    open: false,
    unlockPending: false,
    hoverAtts: null,
    selectedSlot: null,

    canOpen() {
      const p = game.player;
      return !!(game.started && !game.over && p && !p.downed && !p.dead && !p.vehicle && !p.locked && !game.chat?.open);
    },

    show() {
      if (!this.canOpen()) return false;
      if (game.modMenu?.open) game.modMenu.close({ relock: false });
      this.open = true;
      this.hoverAtts = null;
      game.ui?.open('gunsmith');
      game.playing = false;
      game.player.releaseInputs();
      if (document.pointerLockElement) {
        this.unlockPending = true;
        document.exitPointerLock();
        setTimeout(() => { this.unlockPending = false; }, 800);
      }
      box.classList.remove('hidden');
      this.render();
      return true;
    },

    close({ relock = true } = {}) {
      if (!this.open) return;
      this.open = false;
      this.hoverAtts = null;
      stopPreviewLoop();
      game.ui?.close('gunsmith');
      box.classList.add('hidden');
      if (relock && game.started && !game.over) {
        game.ui?.resume();
      }
    },

    toggle() {
      if (this.open) { this.close({ relock: true }); return false; }
      return this.show();
    },

    absorbUnlock() {
      if (this.unlockPending) { this.unlockPending = false; return true; }
      return this.open;
    },

    buyOrToggle(slot, accId) {
      const p = game.player, w = p?.curW;
      if (!w) return;
      if (!Array.isArray(w.ownedAtts)) w.ownedAtts = (w.atts || []).slice();
      const equipped = (w.atts || []).includes(accId);
      if (!accId || equipped) {
        // Unequip this slot (free)
        const next = withSlotAtt(w.atts, slot, null);
        p.setWeaponAttachments(w, next, { newlyBought: false });
        sfx.tick?.(0.5);
        this.hoverAtts = null;
        this.render();
        return;
      }
      const def = CONFIG.attachments?.defs?.[accId];
      if (!def) return;
      const owned = w.ownedAtts.includes(accId);
      if (!owned) {
        const info = game.account ? game.account.levelInfo() : { level: 1, totalXp: 0 };
        if (!isAttachmentUnlocked(accId, info.level, !!game.unlockAllChars)) {
          const reqLv = def.unlockLevel ?? 1;
          const remXp = Math.max(0, totalXpForLevel(reqLv) - (info.totalXp || 0));
          sfx.deny?.();
          hud.toast(`🔒 ${def.name} : Niveau ${reqLv} requis (encore ${remXp.toLocaleString('fr-FR')} XP)`, 2400);
          return;
        }
        const price = def.price ?? 500;
        if (game.points < price) {
          sfx.deny?.();
          hud.toast(`Points insuffisants (${price} pts requis)`, 2000);
          return;
        }
        game.points -= price;
        hud.setPoints(game.points);
        w.ownedAtts.push(accId);
        const next = withSlotAtt(w.atts, slot, accId);
        p.setWeaponAttachments(w, next, { newlyBought: true });
        sfx.buy?.();
        hud.toast(`${def.name} acheté et monté (-${price} pts)`, 2200);
      } else {
        const next = withSlotAtt(w.atts, slot, accId);
        p.setWeaponAttachments(w, next, { newlyBought: false });
        sfx.tick?.(0.8);
      }
      this.hoverAtts = null;
      this.render();
    },

    stripAll() {
      const p = game.player, w = p?.curW;
      if (!w || !(w.atts || []).length) return;
      p.setWeaponAttachments(w, [], { newlyBought: false });
      sfx.tick?.(0.3);
      this.hoverAtts = null;
      this.render();
    },

    _buildStatsHtml(w, curS, prevS) {
      const effDmg = (s) => (s.blast ? s.blast.damage : Math.round(s.damage * (s.pellets || 1)));
      const accScore = (s) => Math.max(5, Math.min(100, Math.round(100 - s.spread * 950)));
      const recScore = (s) => Math.max(10, Math.min(100, Math.round(62 / (s.recoilMult || 1))));
      const rows = [
        { label: 'DÉGÂTS', cur: effDmg(curS), prev: effDmg(prevS), max: Math.max(220, effDmg(curS), effDmg(prevS)), fmt: (v) => String(v), higherGood: true },
        { label: 'MULTI. TÊTE', cur: +(curS.headMult || 1).toFixed(2), prev: +(prevS.headMult || 1).toFixed(2), max: 5, fmt: (v) => `×${v}`, higherGood: true },
        { label: 'CADENCE', cur: +curS.fireRate.toFixed(1), prev: +prevS.fireRate.toFixed(1), max: 18, fmt: (v) => `${v}/s`, higherGood: true },
        { label: 'PRÉCISION', cur: accScore(curS), prev: accScore(prevS), max: 100, fmt: (v) => `${v}`, higherGood: true },
        { label: 'CONTRÔLE RECUL', cur: recScore(curS), prev: recScore(prevS), max: 100, fmt: (v) => `${v}`, higherGood: true },
        { label: 'CHARGEUR', cur: curS.magSize, prev: prevS.magSize, max: Math.max(60, curS.magSize, prevS.magSize), fmt: (v) => String(v), higherGood: true },
        { label: 'RÉSERVE MAX', cur: curS.maxReserve, prev: prevS.maxReserve, max: Math.max(300, curS.maxReserve, prevS.maxReserve), fmt: (v) => String(v), higherGood: true },
        { label: 'RECHARGEMENT', cur: +curS.reloadTime.toFixed(2), prev: +prevS.reloadTime.toFixed(2), max: 5.5, fmt: (v) => `${v} s`, higherGood: false },
        { label: 'PORTÉE', cur: curS.range, prev: prevS.range, max: 200, fmt: (v) => `${v} m`, higherGood: true },
      ];
      const badges = [];
      if (prevS.silenced) badges.push('<span class="gs-spec on">🔇 SILENCIEUX</span>');
      if (prevS.zoomMult && prevS.zoomMult > 1.25) badges.push(`<span class="gs-spec on">🎯 ZOOM ${fmtZoom(prevS.zoomMult)}${prevS.opticLabel ? ` (${esc(prevS.opticLabel)})` : ''}</span>`);
      if (prevS.hipSpreadMult < 0.99) badges.push(`<span class="gs-spec on">⚡ TIR AU JUGÉ +${Math.round((1 - prevS.hipSpreadMult) * 100)}%</span>`);
      return `
        <div class="gs-stats-list">
          ${rows.map((r) => {
            const curPct = Math.min(100, Math.max(4, (r.cur / r.max) * 100));
            const prevPct = Math.min(100, Math.max(4, (r.prev / r.max) * 100));
            const diff = +(r.prev - r.cur).toFixed(2);
            const hasDiff = Math.abs(diff) > 0.005;
            const good = r.higherGood ? diff > 0 : diff < 0;
            const diffStr = hasDiff ? ` <em class="${good ? 'pos' : 'neg'}">(${diff > 0 ? '+' : ''}${diff})</em>` : '';
            const basePct = Math.min(curPct, prevPct);
            const deltaW = Math.abs(prevPct - curPct);
            return `
              <div class="gs-stat-row">
                <div class="gs-stat-head"><span>${r.label}</span><b>${r.fmt(r.prev)}${diffStr}</b></div>
                <div class="gs-bar">
                  <div class="gs-bar-base" style="width:${basePct.toFixed(1)}%"></div>
                  ${hasDiff ? `<div class="gs-bar-delta ${good ? 'pos' : 'neg'}" style="left:${basePct.toFixed(1)}%;width:${deltaW.toFixed(1)}%"></div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${badges.length ? `<div class="gs-spec-row">${badges.join('')}</div>` : ''}
      `;
    },

    _refreshHoverPreview() {
      const p = game.player, w = p?.curW;
      if (!w) return;
      const curS = p.statsOf(w);
      const prevS = this.hoverAtts ? p.statsOf(w, this.hoverAtts) : curS;
      const statsEl = box.querySelector('#gsStatsHost');
      if (statsEl) statsEl.innerHTML = this._buildStatsHtml(w, curS, prevS);
      updatePreviewModel(w, this.hoverAtts || w.atts || []);
    },

    render() {
      if (!this.open) return;
      const p = game.player, w = p?.curW;
      if (!w) { this.close({ relock: false }); return; }
      if (!Array.isArray(w.ownedAtts)) w.ownedAtts = (w.atts || []).slice();

      const curS = p.statsOf(w);
      const A = CONFIG.attachments;
      const bySlot = compatibleAttachments(w.id);
      const papRoman = w.pap > 0 ? PAP_LEVELS[w.pap]?.roman || '' : '';
      const keyTag = game.binds ? game.binds.tag('gunsmith') : '[T]';
      const accInfo = game.account ? game.account.levelInfo() : { level: 1, totalXp: 0 };

      // Preserve existing preview canvas if already mounted so WebGL context stays intact!
      let prevCanvas = preview.canvas;

      box.innerHTML = `
        <div class="gs-header">
          <div class="gs-title-wrap">
            <div class="gs-title">🔧 ATELIER D'ARMES ${keyTag}</div>
            <div class="gs-sub">${esc(curS.name)}${papRoman ? ` <span class="gs-pap">PaP ${papRoman}</span>` : ''} · ${esc(curS.caliber || '')}</div>
          </div>
          <div class="gs-wep-tabs">
            ${p.inventory.map((iw, idx) => {
              const isAct = idx === p.weaponIdx;
              const nm = CONFIG.weapons[iw.id]?.name || iw.id;
              return `<button class="gs-wtab ${isAct ? 'active' : ''}" data-gs-wep="${idx}">${idx + 1}. ${esc(nm)}</button>`;
            }).join('')}
          </div>
          <div class="gs-right-meta">
            <div class="gs-lvl-pill">🎖 NIV. ${accInfo.level}</div>
            <div class="gs-pts">💰 <b>${game.points.toLocaleString('fr-FR')}</b> pts</div>
            <button class="gs-close" id="gsCloseBtn" title="Fermer (${keyTag} / Échap)">✕</button>
          </div>
        </div>

        <div class="gs-content">
          <div class="gs-left">
            <div class="gs-preview-box" id="gsPreviewBox">
              <div class="gs-preview-hint">Glisser pour pivoter l'arme en 3D</div>
              <button class="gs-strip-btn" id="gsStripBtn" ${(w.atts || []).length ? '' : 'disabled'}>Tout retirer</button>
            </div>
            <div class="gs-stats-card">
              <div class="gs-card-title">📊 STATISTIQUES ACTUELLES <small>(survol = aperçu)</small></div>
              <div id="gsStatsHost">${this._buildStatsHtml(w, curS, curS)}</div>
            </div>
          </div>

          <div class="gs-right">
            ${A.slots.map((slot) => {
              const list = bySlot[slot] || [];
              if (!list.length) return '';
              const equippedId = (w.atts || []).find((a) => A.defs[a]?.slot === slot) || null;
              const eqName = equippedId ? A.defs[equippedId]?.name : 'Aucun (standard)';
              return `
                <div class="gs-slot-section">
                  <div class="gs-slot-head">
                    <span class="gs-slot-name">${esc(A.slotLabels?.[slot] || slot.toUpperCase())}</span>
                    <span class="gs-slot-cur">${equippedId ? `✅ ${esc(eqName)}` : 'Standard'}</span>
                    ${equippedId ? `<button class="gs-unequip-btn" data-gs-unequip="${slot}">Retirer</button>` : ''}
                  </div>
                  <div class="gs-att-grid">
                    ${list.map((accId) => {
                      const d = A.defs[accId];
                      const isEq = equippedId === accId;
                      const isOwned = w.ownedAtts.includes(accId);
                      const reqLv = d.unlockLevel ?? 1;
                      const unlocked = isOwned || isAttachmentUnlocked(accId, accInfo.level, !!game.unlockAllChars);
                      const price = d.price ?? 500;
                      const canAfford = game.points >= price;
                      const bonuses = describeBonuses(d);
                      const cls = isEq ? 'equipped' : isOwned ? 'owned' : !unlocked ? 'level-locked' : canAfford ? 'buyable' : 'locked';
                      const badge = isEq ? 'ÉQUIPÉ' : isOwned ? 'ACQUIS' : !unlocked ? `🔒 NIV. ${reqLv}` : `${price} pts`;
                      const btnText = isEq
                        ? 'RETIRER'
                        : isOwned
                          ? 'ÉQUIPER (GRATUIT)'
                          : !unlocked
                            ? `DÉBLOQUÉ NIV. ${reqLv} · ${price} PTS`
                            : `ACHETER · ${price} PTS`;
                      return `
                        <button class="gs-att-card ${cls}" data-gs-slot="${slot}" data-gs-att="${accId}">
                          <div class="gs-att-top">
                            <b>${esc(d.name)}</b>
                            <span class="gs-att-badge">${badge}</span>
                          </div>
                          <div class="gs-att-tags">
                            ${bonuses.map((b) => `<span class="gs-btag ${b.good ? 'pos' : 'neg'}">${esc(b.txt)}</span>`).join('')}
                          </div>
                          <div class="gs-att-cta">${btnText}</div>
                        </button>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      // Mount / reuse the 3D preview canvas
      const host = box.querySelector('#gsPreviewBox');
      if (!prevCanvas) {
        prevCanvas = document.createElement('canvas');
        prevCanvas.width = 420;
        prevCanvas.height = 210;
        prevCanvas.className = 'gs-preview-canvas';
        prevCanvas.addEventListener('pointerdown', (e) => {
          preview.dragging = true;
          preview.lastX = e.clientX;
          preview.lastY = e.clientY;
          prevCanvas.setPointerCapture?.(e.pointerId);
        });
        prevCanvas.addEventListener('pointermove', (e) => {
          if (!preview.dragging) return;
          preview.yaw += (e.clientX - preview.lastX) * 0.012;
          preview.pitch = Math.max(-0.55, Math.min(0.65, preview.pitch + (e.clientY - preview.lastY) * 0.008));
          preview.lastX = e.clientX;
          preview.lastY = e.clientY;
        });
        const stopDrag = () => { preview.dragging = false; };
        prevCanvas.addEventListener('pointerup', stopDrag);
        prevCanvas.addEventListener('pointercancel', stopDrag);
        prevCanvas.addEventListener('dblclick', () => { preview.yaw = Math.PI * 0.44; preview.pitch = 0.14; });
      }
      host.prepend(prevCanvas);
      ensurePreview(prevCanvas);
      preview.key = '';
      updatePreviewModel(w, w.atts || []);
      startPreviewLoop();

      // Bind interactive controls
      box.querySelector('#gsCloseBtn')?.addEventListener('click', () => this.close({ relock: true }));
      box.querySelector('#gsStripBtn')?.addEventListener('click', () => this.stripAll());

      box.querySelectorAll('[data-gs-wep]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.gsWep;
          if (idx !== p.weaponIdx) {
            p.switchWeapon(idx);
            this.hoverAtts = null;
            this.render();
          }
        });
      });

      box.querySelectorAll('[data-gs-unequip]').forEach((btn) => {
        const slot = btn.dataset.gsUnequip;
        btn.addEventListener('mouseenter', () => {
          this.hoverAtts = withSlotAtt(w.atts, slot, null);
          this._refreshHoverPreview();
        });
        btn.addEventListener('mouseleave', () => {
          this.hoverAtts = null;
          this._refreshHoverPreview();
        });
        btn.addEventListener('click', () => this.buyOrToggle(slot, null));
      });

      box.querySelectorAll('[data-gs-att]').forEach((btn) => {
        const slot = btn.dataset.gsSlot;
        const accId = btn.dataset.gsAtt;
        btn.addEventListener('mouseenter', () => {
          const isEq = (w.atts || []).includes(accId);
          this.hoverAtts = withSlotAtt(w.atts, slot, isEq ? null : accId);
          this._refreshHoverPreview();
        });
        btn.addEventListener('mouseleave', () => {
          this.hoverAtts = null;
          this._refreshHoverPreview();
        });
        btn.addEventListener('click', () => this.buyOrToggle(slot, accId));
      });
    },
  };

  game.gunsmith = gs;

  // Touche [T] : ouvre ou ferme l'atelier d'armes à pied
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (game.chat?.open || (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) return;
    if (!game.binds?.is('gunsmith', e)) return;
    if (gs.open) {
      e.preventDefault();
      gs.close({ relock: true });
    } else if (game.playing && gs.canOpen()) {
      e.preventDefault();
      gs.show();
    }
  });

  return gs;
}
