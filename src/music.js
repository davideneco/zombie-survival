// Musique d'ambiance rock, synthétisée en direct avec WebAudio : batterie, basse, deux guitares saturées (jouées en
// double piste, une à gauche une à droite), guitare lead avec écho, nappe sombre. Aucun fichier audio.
// Le morceau (mi mineur) suit le jeu : calme entre les manches, plus dur et plus rapide quand les manches avancent,
// à fond pendant le finale. Menu et pause : même morceau, étouffé.
import { rnd, mtof, satCurve } from './dsp.js';

const LOOKAHEAD = 1.0; // secondes programmées d'avance (les minuteurs d'un onglet en arrière-plan sont ralentis)
const TICK = 100;      // ms entre deux passages du séquenceur

// ---------------------------------------------------------------- Partition
// Accords : r = fondamentale (MIDI, grave), m = mineur
const CH = {
  Em: { r: 40, m: true }, Am: { r: 45, m: true },
  C: { r: 36, m: false }, D: { r: 38, m: false }, G: { r: 43, m: false },
};
// Sections de 4 mesures. lead : notes de la guitare lead par mesure [pas (sur 16), note MIDI, durée en pas]
// (gamme pentatonique mi mineur : elle passe sur tous ces accords)
const SECTIONS = {
  verse: { prog: [CH.Em, CH.Em, CH.C, CH.D] },
  chorus: {
    prog: [CH.Em, CH.C, CH.G, CH.D],
    lead: [
      [[0, 71, 4], [4, 74, 4], [8, 76, 6], [14, 74, 2]],
      [[0, 76, 4], [4, 74, 2], [6, 71, 2], [8, 67, 8]],
      [[0, 74, 4], [4, 71, 4], [8, 74, 4], [12, 76, 4]],
      [[0, 79, 6], [6, 76, 2], [8, 74, 4], [12, 71, 2], [14, 69, 2]],
    ],
  },
  bridge: {
    prog: [CH.C, CH.G, CH.D, CH.Em],
    lead: [
      [[0, 76, 16]],
      [[0, 74, 12], [12, 71, 4]],
      [[0, 79, 8], [8, 76, 8]],
      [[0, 71, 8], [8, 76, 8]],
    ],
  },
};
const SONG = ['verse', 'verse', 'chorus', 'chorus', 'verse', 'bridge', 'chorus', 'chorus']; // 32 mesures, en boucle

// Rythmes : 16 pas par mesure, indexés par niveau (0 calme, 1 rythmé, 2 dur, 3 à fond). x = coup, o = charleston ouvert
const DRUMS = [
  { k: 'x-------x-------', s: '------------x---', h: 'x---x---x---x---' },
  { k: 'x-----x-x-------', s: '----x-------x---', h: 'x-x-x-x-x-x-x-x-' },
  { k: 'x--x--x-x-x---x-', s: '----x-------x---', h: 'x-x-x-x-x-x-x-o-' },
  { k: 'x-x-x-x-x-x-x-xx', s: '----x-------x---', h: 'xxxxxxxxxxxxxxxx' },
];
const DRUMS_HALF = [ // pont : rythme au demi-tempo
  { k: 'x-------x-------', s: '--------x-------', h: 'x---x---x---x---' },
  { k: 'x-------x-------', s: '--------x-------', h: 'x-x-x-x-x-x-x-x-' },
  { k: 'x-------x-----x-', s: '--------x-------', h: 'x-x-x-x-x-x-x-o-' },
  { k: 'x-----x-x-x---x-', s: '--------x-------', h: 'x-x-x-x-x-x-x-x-' },
];
const DRUM_VEL = [0.55, 0.8, 0.95, 1];
// Guitare rythmique : X = accord ouvert qui sonne, x = accord étouffé (« palm mute »), - = silence
const GTR = {
  verse: ['', 'X-x-x-x-X-x-x-x-', 'Xxx-xxx-Xxx-xx--', 'XxxxxxxxXxxxxxxx'],
  chorus: ['', 'X---X---X---X---', 'X-X-X-X-X-X-X-X-', 'X-X-X-XxX-X-X-xx'],
  bridge: ['', 'X-------X-------', 'X-------X-------', 'X---X---X---X---'],
};
const RUN = [55, 52, 50, 47]; // dernière mesure d'une section : petite descente (sol mi ré si)
const PLUCK = [0, 1, 2, 3, 2, 1, 2, 1]; // arpège de guitare claire (niveau calme)

export class Music {
  // noise : buffer de bruit partagé ; reverb : entrée du convolueur partagé (facultatif) ; master : sortie principale
  constructor(ctx, dest, { noise, reverb = null, master = null } = {}) {
    this.ctx = ctx;
    this.noise = noise;
    this.reverb = reverb;
    this.masterDest = master;
    this.intensity = 0.3; // 0..1, fixé par le jeu
    this.lull = false;    // accalmie (entre deux manches)
    this.level = 1;
    this.bpm = 110;
    this.stepDur = 60 / this.bpm / 4;
    this.barIdx = 0;
    this.step = 0;
    this.nextTime = 0;
    this.sec = SECTIONS.verse;
    this.secName = 'verse';
    this.barInSec = 0;
    this.chord = CH.Em;
    this.timer = null;

    // Morceaux personnalisés & Playlist
    this.playlist = [];
    this.trackIndex = 0;
    this.currentTrack = null;
    this.currentSource = null;
    this.currentGain = null;
    this.onTrackChange = null;
    this.isCustom = false;

    const c = ctx;
    const gain = (v, to) => { const g = c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    // sortie rock synthétisé : bus -> filtre d'étouffement -> baisse (menu / pause) -> volume réglé par le joueur
    this.vol = gain(0.5, dest);
    this.duck = gain(1, this.vol);
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.lp.connect(this.duck);
    this.out = gain(0.5, this.lp);

    // Sortie dédiée pour morceaux personnalisés pré-masterisés (Jeaux Davide, Midnight Lurch) :
    // connecte directement au master (ou dest) pour un son stéréo riche, puissant et non écrasé par les tirs
    this.customMaster = master || dest;
    this.customVol = gain(0.85, this.customMaster);
    this.customDuck = gain(1, this.customVol);
    this.customLp = c.createBiquadFilter();
    this.customLp.type = 'lowpass';
    this.customLp.frequency.value = 20000;
    this.customLp.connect(this.customDuck);
    this.customBus = this.customLp;

    this.drums = gain(0.85, this.out);
    this.bassBus = gain(0.5, null);
    const bassSat = c.createWaveShaper();
    bassSat.curve = satCurve(2.5);
    this.bassBus.connect(bassSat).connect(this.out);
    this.padBus = gain(1, this.out);
    this.pluckBus = gain(1, this.out);

    // amplis de guitare (saturation, haut-parleur) : un à gauche, un à droite pour la double piste
    this.ampL = this._amp(-0.75);
    this.ampR = this._amp(0.75);
    // lead : saturation douce + écho à la croche pointée
    this.leadIn = c.createGain();
    const leadSat = c.createWaveShaper();
    leadSat.curve = satCurve(4);
    const leadLp = c.createBiquadFilter();
    leadLp.type = 'lowpass';
    leadLp.frequency.value = 4200;
    this.leadIn.connect(leadSat).connect(leadLp);
    const leadOut = gain(0.2, this.out);
    leadLp.connect(leadOut);
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = this.stepDur * 3;
    const fb = gain(0.38, this.delay);
    const fbLp = c.createBiquadFilter();
    fbLp.type = 'lowpass';
    fbLp.frequency.value = 2800;
    this.delay.connect(fbLp).connect(fb);
    this.delayIn = c.createGain();
    this.delayIn.connect(this.delay);
    this.delay.connect(gain(0.45, this.out));
    leadOut.connect(this.delayIn); // l'écho part APRÈS le réglage de niveau de la lead
    this.pluckBus.connect(this.delayIn);
    // vibrato de la lead
    this.vib = c.createOscillator();
    this.vib.frequency.value = 5.4;
    this.vibDepth = gain(14, null);
    this.vib.connect(this.vibDepth);
    this.vib.start();
  }

  _amp(pan) {
    const c = this.ctx;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const sh = c.createWaveShaper();
    sh.curve = satCurve(14);
    sh.oversample = '2x';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.9;
    const pk = c.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1100;
    pk.gain.value = 4;
    const pn = c.createStereoPanner();
    pn.pan.value = pan;
    const g = c.createGain();
    g.gain.value = 0.25;
    hp.connect(sh).connect(lp).connect(pk).connect(pn).connect(g).connect(this.out);
    return hp;
  }

  // ---------------------------------------------------------------- Contrôle
  setVolume(v) {
    const t = this.ctx.currentTime;
    this.vol.gain.setTargetAtTime(v, t, 0.05);
    if (this.customVol) this.customVol.gain.setTargetAtTime(v * 0.9, t, 0.05);
  }
  setIntensity(x) { this.intensity = x; }
  setLull(on) { this.lull = on; }
  setMuffled(on) { // pause active : adoucissement musical
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(on ? 650 : 20000, t, 0.15);
    this.duck.gain.setTargetAtTime(on ? 0.55 : 1, t, 0.2);
    if (this.customLp) {
      this.customLp.frequency.setTargetAtTime(on ? 1800 : 20000, t, 0.15);
      this.customDuck.gain.setTargetAtTime(on ? 0.75 : 1, t, 0.2);
    }
  }

  // ---------------------------------------------------------------- Morceaux personnalisés & Playlist
  setPlaylist(tracks, autoStart = true) {
    this.playlist = Array.isArray(tracks) ? [...tracks] : [];
    this.trackIndex = 0;
    if (this.playlist.length > 0) {
      this.isCustom = true;
      if (autoStart) this.playTrackIndex(0);
    } else {
      this.isCustom = false;
      this.start();
    }
  }

  addTrack(track) {
    if (!track) return;
    this.playlist.push(track);
    this.isCustom = true;
    if (this.currentSource) {
      // Si la première piste tournait en boucle seule, on l'autorise à enchaîner
      if (this.playlist.length > 1) {
        this.currentSource.loop = false;
        const src = this.currentSource;
        this.currentSource.onended = () => {
          if (this.currentSource === src) this.nextTrack();
        };
      }
    } else if (!this.timer) {
      this.playTrackIndex(this.playlist.length - 1);
    }
  }

  playTrackIndex(index) {
    if (!this.playlist.length) return;
    this.stopSynth();
    this.trackIndex = ((index % this.playlist.length) + this.playlist.length) % this.playlist.length;
    const track = this.playlist[this.trackIndex];
    if (!track) return;

    const c = this.ctx;
    if (c.state === 'suspended') {
      c.resume();
    }
    const t = c.currentTime;

    // Fondu sortant propre de la piste précédente
    if (this.currentGain && this.currentSource) {
      const oldGain = this.currentGain;
      const oldSrc = this.currentSource;
      oldSrc.onended = null;
      try {
        oldGain.gain.setValueAtTime(oldGain.gain.value, t);
        oldGain.gain.linearRampToValueAtTime(0.0001, t + 0.8);
        setTimeout(() => {
          try {
            oldSrc.stop();
            oldSrc.disconnect();
            oldGain.disconnect();
          } catch {}
        }, 900);
      } catch {
        try { oldSrc.stop(); } catch {}
      }
    }

    const buf = track.buffer || track.buf;
    if (!buf) return;

    // Normalisation RMS pour un volume riche et bien audible
    const d = buf.getChannelData(0);
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { sum += d[i] * d[i]; n++; }
    const rms = Math.sqrt(sum / Math.max(1, n));
    // Niveau sonore optimal avant passage par le filtre et le contrôle de volume
    const targetGain = rms > 1e-4 ? Math.min(4, Math.max(0.6, 0.75 / rms)) : 1.2;

    const g = c.createGain();
    g.gain.setValueAtTime(0.01, t);
    g.gain.setTargetAtTime(targetGain, t, 0.35);

    const src = c.createBufferSource();
    src.buffer = buf;
    if (this.playlist.length === 1) {
      src.loop = true;
    } else {
      src.loop = false;
      src.onended = () => {
        if (this.currentSource === src) {
          this.nextTrack();
        }
      };
    }

    // Connecte directement au bus dédié musique personnalisée pour une clarté et un volume parfaits
    src.connect(g).connect(this.customBus || this.lp);
    src.start();

    this.currentSource = src;
    this.currentGain = g;
    this.track = src; // compatibilité
    this.currentTrack = track;
    console.log(`[AUDIO] Lecture démarrée : ${track.name} (volume x${targetGain.toFixed(2)}, état audio: ${c.state})`);

    if (typeof this.onTrackChange === 'function') {
      try {
        this.onTrackChange(this.getCurrentTrack());
      } catch (err) {
        console.warn('[AUDIO] Erreur callback onTrackChange :', err);
      }
    }
  }

  playOriginalRock() {
    // Stoppe la piste personnalisée actuelle et relance le rock synthétisé d'origine
    if (this.currentGain && this.currentSource) {
      try {
        const t = this.ctx.currentTime;
        this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, t);
        this.currentGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
        setTimeout(() => {
          try {
            this.currentSource?.stop();
            this.currentSource?.disconnect();
            this.currentGain?.disconnect();
          } catch {}
        }, 450);
      } catch {}
      this.currentSource = null;
      this.currentGain = null;
    }
    this.isCustom = false;
    this.currentTrack = { name: 'Rock synthétisé', isCustom: false };
    this.start();
    if (typeof this.onTrackChange === 'function') {
      this.onTrackChange(this.getCurrentTrack());
    }
  }

  playTrackNamed(name) {
    if (!name) return;
    if (/rock/i.test(name)) {
      this.playOriginalRock();
      return;
    }
    const idx = this.playlist.findIndex((t) => t.name.toLowerCase().includes(name.toLowerCase()));
    if (idx !== -1) {
      this.playTrackIndex(idx);
    }
  }

  nextTrack() {
    if (!this.playlist.length) return;
    this.playTrackIndex(this.trackIndex + 1);
  }

  prevTrack() {
    if (!this.playlist.length) return;
    this.playTrackIndex(this.trackIndex - 1);
  }

  getCurrentTrack() {
    if (!this.isCustom || !this.playlist.length) {
      return { name: 'Rock synthétisé', index: 0, total: 1, isCustom: false };
    }
    const track = this.playlist[this.trackIndex];
    return {
      name: track?.name || `Morceau ${this.trackIndex + 1}`,
      index: this.trackIndex,
      total: this.playlist.length,
      isCustom: true,
    };
  }

  // Joue un morceau fourni (AudioBuffer) en boucle (compatibilité)
  playTrack(buf, name = 'Morceau personnalisé') {
    this.setPlaylist([{ name, buffer: buf }], true);
  }

  stopSynth() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  start() {
    if (this.isCustom && this.playlist.length > 0) {
      if (!this.currentSource) this.playTrackIndex(this.trackIndex);
      return;
    }
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._tick(), TICK);
  }

  stop() {
    this.stopSynth();
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }
    if (this.currentGain) {
      try { this.currentGain.disconnect(); } catch {}
      this.currentGain = null;
    }
  }
  _tick() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05; // contexte resté suspendu : on repart d'ici
    this._pump(now + LOOKAHEAD);
  }

  // ---------------------------------------------------------------- Séquenceur
  _pump(until) {
    while (this.nextTime < until) {
      if (this.step === 0) this._beginBar();
      this._step(this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % 16;
    }
  }

  _beginBar() {
    const i = this.barIdx++;
    this.secName = SONG[Math.floor(i / 4) % SONG.length];
    this.sec = SECTIONS[this.secName];
    this.barInSec = i % 4;
    this.chord = this.sec.prog[this.barInSec];
    const x = this.lull ? 0 : this.intensity;
    this.level = this.lull || x < 0.12 ? 0 : x < 0.45 ? 1 : x < 0.75 ? 2 : 3;
    this.bpm = 102 + 34 * x;
    this.stepDur = 60 / this.bpm / 4;
    this.delay.delayTime.setValueAtTime(this.stepDur * 3, this.nextTime);
  }

  _step(t) {
    const L = this.level, sd = this.stepDur, st = this.step, ch = this.chord;
    const half = this.secName === 'bridge';
    const last = this.barInSec === 3;
    const P = (half ? DRUMS_HALF : DRUMS)[L];
    const dv = DRUM_VEL[L];
    const fill = last && L >= 1 && st >= 12; // roulement de caisse claire en fin de section
    const j = () => t + rnd(0, 0.004);       // légère imperfection humaine

    // --- batterie
    if (P.k[st] === 'x' && !(fill && st > 12)) this._kick(j(), dv);
    if (fill) this._snare(j(), dv * (0.45 + 0.14 * (st - 12)));
    else if (P.s[st] === 'x') this._snare(j(), dv);
    if (!fill && P.h[st] !== '-') this._hat(j(), dv * (st % 4 === 0 ? 1 : st % 2 === 0 ? 0.75 : 0.5), P.h[st] === 'o');
    if (st === 0 && this.barInSec === 0 && L >= 1 && (this.secName === 'chorus' || L >= 2)) this._crash(t, 0.55 + 0.1 * L);

    // --- nappe sombre et basse tenue (toute la mesure)
    if (st === 0) this._pad(t, ch, sd * 16 + 0.4, [0.16, 0.07, 0.06, 0.05][L]);
    if (L === 0) {
      if (st === 0) this._bass(t, ch.r, sd * 15, 0.5, true);
      if (st % 2 === 0) this._pluck(t, ch, PLUCK[st / 2], 0.2);
    } else {
      // --- guitare rythmique + basse qui la double
      const gp = GTR[this.secName][L];
      const gr = ch.r < 40 ? ch.r + 12 : ch.r;
      const hit = gp[st];
      if (last && L >= 2 && st >= 12) {
        this._gtr(t, RUN[st - 12], [0], sd * 1.6, 0.9, true);
        this._bass(t, ch.r, sd, 0.8, false);
      } else if (hit !== '-') {
        let n = 1;
        while (n < 6 && gp[(st + n) % 16] === '-') n++;
        if (hit === 'X') this._gtr(t, gr, [0, 7, 12], sd * n * 0.95, 1, false);
        else this._gtr(t, gr, [0, 7], Math.min(0.15, sd * 0.85), 1, true);
        if (L < 3 || st % 2 === 0) this._bass(t, ch.r, hit === 'X' ? sd * Math.min(n, 4) * 0.9 : sd * 0.9, hit === 'X' ? 0.9 : 0.75, false);
      }
      // --- guitare lead (refrain à partir du niveau 2, pont à partir du niveau 1)
      if (st === 0 && this.sec.lead && ((this.secName === 'chorus' && L >= 2) || (this.secName === 'bridge' && L >= 1))) {
        for (const [s, note, len] of this.sec.lead[this.barInSec]) this._lead(t + s * sd, note, len * sd * 0.95);
      }
    }
  }

  // ---------------------------------------------------------------- Instruments
  _n(t, dur, vol, type, freq, dest, { q = 0.7, f1 = 0, send = 0, atk = 0.002 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    this._send(g, send);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  _send(node, amount) {
    if (!this.reverb || amount <= 0) return;
    const s = this.ctx.createGain();
    s.gain.value = amount;
    node.connect(s).connect(this.reverb);
  }

  _kick(t, v) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.95 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.34);
    this._n(t, 0.03, 0.3 * v, 'bandpass', 3200, this.drums); // claque de la pédale
  }

  _snare(t, v) {
    const c = this.ctx;
    this._n(t, 0.2, 0.6 * v, 'bandpass', 1900, this.drums, { q: 0.8, send: 0.25 });
    this._n(t, 0.09, 0.3 * v, 'highpass', 5000, this.drums);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.15);
  }

  _hat(t, v, open) {
    this._n(t, open ? 0.24 : 0.045, 0.17 * v, 'highpass', 7200, this.drums, { atk: 0.001 });
  }

  _crash(t, v) {
    this._n(t, 1.7, 0.3 * v, 'highpass', 4200, this.drums, { send: 0.3, atk: 0.003 });
    this._n(t, 0.9, 0.18 * v, 'bandpass', 8500, this.drums, { q: 1.2 });
  }

  // Guitare rythmique : accord de dents de scie (désaccordées) dans l'ampli gauche et droit, la droite avec un
  // léger retard : c'est ce qui donne le son « large » d'une double piste
  _gtr(t, root, offs, len, vel, palm) {
    const c = this.ctx;
    for (let side = 0; side < 2; side++) {
      const t0 = t + side * 0.007;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.5 * vel, t0 + 0.004);
      if (palm) { // « chug » : tenu puis coupé net par la paume (une décroissance lente sonnerait trop mou)
        g.gain.setValueAtTime(0.5 * vel, t0 + len * 0.55);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      }
      else {
        g.gain.exponentialRampToValueAtTime(0.28 * vel, t0 + len * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + len + 0.06);
      }
      for (const off of offs) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(root + off);
        o.detune.value = (side ? 9 : -9) + rnd(-3, 3);
        o.connect(g);
        o.start(t0);
        o.stop(t0 + len + 0.1);
      }
      g.connect(side ? this.ampR : this.ampL);
    }
  }

  _bass(t, midi, len, vel, soft) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = soft ? 'triangle' : 'sawtooth';
    o.frequency.value = mtof(midi);
    const sub = c.createOscillator();
    sub.frequency.value = mtof(midi - 12);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(soft ? 400 : 1000, t);
    f.frequency.exponentialRampToValueAtTime(soft ? 200 : 260, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + (soft ? 0.03 : 0.006));
    g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.05);
    o.connect(f).connect(g);
    const sg = c.createGain();
    sg.gain.value = 0.7;
    sub.connect(sg).connect(g);
    g.connect(this.bassBus);
    o.start(t);
    sub.start(t);
    o.stop(t + len + 0.08);
    sub.stop(t + len + 0.08);
  }

  // Nappe : triade (dents de scie désaccordées, filtrée), attaque lente
  _pad(t, ch, len, vol) {
    const c = this.ctx;
    const notes = [ch.r + 12, ch.r + 12 + (ch.m ? 3 : 4), ch.r + 19, ch.r + 24];
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 850;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.6);
    g.gain.setValueAtTime(vol, t + len - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.6);
    for (const n of notes) for (const d of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = d;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.7);
    }
    f.connect(g).connect(this.padBus);
    this._send(g, 0.5);
  }

  // Arpège de guitare claire (niveau calme)
  _pluck(t, ch, idx, vel) {
    const c = this.ctx;
    const note = [ch.r + 12, ch.r + 19, ch.r + 24, ch.r + 24 + (ch.m ? 3 : 4)][idx];
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(note);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.pluckBus);
    this._send(g, 0.3);
    o.start(t);
    o.stop(t + 0.75);
  }

  // Guitare lead : dents de scie + carré, glissando montant sur l'attaque, vibrato
  _lead(t, note, len) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.3, t + Math.max(0.05, len * 0.8));
    g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.12);
    for (const type of ['sawtooth', 'square']) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = mtof(note);
      o.detune.setValueAtTime(-120, t);
      o.detune.linearRampToValueAtTime(0, t + 0.07);
      this.vibDepth.connect(o.detune);
      o.connect(g);
      o.start(t);
      o.stop(t + len + 0.15);
      o.onended = () => this.vibDepth.disconnect(o.detune);
    }
    g.connect(this.leadIn);
  }
}
