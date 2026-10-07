// Sons synthétisés avec WebAudio : aucun fichier audio nécessaire.
// Tous les sons sont programmés à l'avance sur l'horloge audio (option `at`, en secondes) : pas de setTimeout.
import { Music } from './music.js';
import { rnd, clamp, satCurve, noiseBuffer, reverbBuffer } from './dsp.js';

// Un coup de feu = quatre couches + l'écho de la rue :
//   claque (bruit aigu : l'onde de choc), corps (bruit qui s'assombrit : l'explosion de la poudre),
//   grave (sinus qui chute : le coup dans la poitrine), mordant (dent de scie saturée : l'agressivité)
// cf/bf/tf/gf = fréquence de départ (Hz), cd/bd/td/gd = durée (s), cv/bv/tv/gv = volume,
// rv = part envoyée à la réverbération, ec/ed = volume et retard (s) de l'écho renvoyé par les façades
const GUNS = {
  // pistolets
  m1911:   { cf: 2600, cd: 0.045, cv: 0.75, bf: 1900, bd: 0.16, bv: 0.6,  tf: 190, td: 0.12, tv: 0.55, gf: 300, gd: 0.07, gv: 0.3,  rv: 0.4,  ec: 0.12, ed: 0.17 },
  arex:    { cf: 3600, cd: 0.04,  cv: 0.7,  bf: 2800, bd: 0.11, bv: 0.5,  tf: 250, td: 0.09, tv: 0.4,  gf: 420, gd: 0.05, gv: 0.22, rv: 0.3,  ec: 0.08, ed: 0.15 },
  deagle:  { cf: 2200, cd: 0.06,  cv: 0.9,  bf: 1500, bd: 0.28, bv: 0.85, tf: 120, td: 0.22, tv: 0.8,  gf: 220, gd: 0.12, gv: 0.4,  rv: 0.65, ec: 0.3,  ed: 0.2 },
  magnum:  { cf: 2000, cd: 0.06,  cv: 0.9,  bf: 1300, bd: 0.3,  bv: 0.9,  tf: 105, td: 0.25, tv: 0.85, gf: 200, gd: 0.14, gv: 0.45, rv: 0.7,  ec: 0.35, ed: 0.22 },
  // fusils d'assaut
  rifle:   { cf: 4200, cd: 0.04,  cv: 0.75, bf: 2200, bd: 0.12, bv: 0.55, tf: 150, td: 0.1,  tv: 0.5,  gf: 330, gd: 0.06, gv: 0.3,  rv: 0.3,  ec: 0.14, ed: 0.18 },
  ak47:    { cf: 3000, cd: 0.05,  cv: 0.85, bf: 1700, bd: 0.16, bv: 0.7,  tf: 125, td: 0.13, tv: 0.65, gf: 260, gd: 0.08, gv: 0.4,  rv: 0.35, ec: 0.18, ed: 0.2 },
  famas:   { cf: 4800, cd: 0.035, cv: 0.7,  bf: 2600, bd: 0.1,  bv: 0.5,  tf: 170, td: 0.08, tv: 0.45, gf: 360, gd: 0.05, gv: 0.25, rv: 0.25, ec: 0.1,  ed: 0.16 },
  scar:    { cf: 2800, cd: 0.05,  cv: 0.85, bf: 1500, bd: 0.2,  bv: 0.75, tf: 110, td: 0.16, tv: 0.7,  gf: 240, gd: 0.09, gv: 0.4,  rv: 0.4,  ec: 0.22, ed: 0.2 },
  // pistolets-mitrailleurs
  smg:     { cf: 3800, cd: 0.035, cv: 0.55, bf: 2400, bd: 0.09, bv: 0.4,  tf: 200, td: 0.07, tv: 0.35, gf: 350, gd: 0.04, gv: 0.2,  rv: 0.2,  ec: 0.06, ed: 0.14 },
  mp5:     { cf: 4400, cd: 0.03,  cv: 0.55, bf: 2900, bd: 0.08, bv: 0.38, tf: 230, td: 0.06, tv: 0.3,  gf: 400, gd: 0.04, gv: 0.18, rv: 0.2,  ec: 0.06, ed: 0.14 },
  p90:     { cf: 5800, cd: 0.025, cv: 0.55, bf: 3600, bd: 0.07, bv: 0.32, tf: 280, td: 0.05, tv: 0.28, gf: 520, gd: 0.03, gv: 0.15, rv: 0.2,  ec: 0.05, ed: 0.13 },
  // mitrailleuses
  lmg:     { cf: 2800, cd: 0.05,  cv: 0.8,  bf: 1500, bd: 0.18, bv: 0.7,  tf: 120, td: 0.14, tv: 0.65, gf: 240, gd: 0.08, gv: 0.38, rv: 0.3,  ec: 0.16, ed: 0.2 },
  m249:    { cf: 3600, cd: 0.04,  cv: 0.75, bf: 2000, bd: 0.14, bv: 0.6,  tf: 140, td: 0.11, tv: 0.55, gf: 300, gd: 0.06, gv: 0.3,  rv: 0.28, ec: 0.14, ed: 0.18 },
  mg42:    { cf: 4000, cd: 0.04,  cv: 0.8,  bf: 2200, bd: 0.1,  bv: 0.55, tf: 150, td: 0.08, tv: 0.45, gf: 330, gd: 0.05, gv: 0.3,  rv: 0.15, ec: 0.08, ed: 0.16 },
  pkm:     { cf: 2600, cd: 0.05,  cv: 0.85, bf: 1400, bd: 0.18, bv: 0.75, tf: 115, td: 0.15, tv: 0.7,  gf: 230, gd: 0.09, gv: 0.4,  rv: 0.3,  ec: 0.18, ed: 0.2 },
  // fusils de précision : gros boum, longue queue
  sniper:  { cf: 3000, cd: 0.08,  cv: 1,    bf: 1200, bd: 0.4,  bv: 0.9,  tf: 85,  td: 0.35, tv: 0.9,  gf: 160, gd: 0.18, gv: 0.45, rv: 0.9,  ec: 0.45, ed: 0.26 },
  svd:     { cf: 3200, cd: 0.07,  cv: 0.95, bf: 1300, bd: 0.34, bv: 0.85, tf: 95,  td: 0.28, tv: 0.85, gf: 180, gd: 0.15, gv: 0.42, rv: 0.8,  ec: 0.4,  ed: 0.24 },
  barrett: { cf: 2400, cd: 0.09,  cv: 1,    bf: 900,  bd: 0.55, bv: 1,    tf: 62,  td: 0.5,  tv: 1,    gf: 120, gd: 0.25, gv: 0.5,  rv: 1,    ec: 0.55, ed: 0.3 },
  // armes de la zone de l'Homme de Fer : saiga (sec et fort), arbalète (presque silencieuse), M79 (« bloop » grave)
  saiga:    { cf: 3300, cd: 0.07,  cv: 0.95, bf: 2200, bd: 0.36, bv: 0.95, tf: 110, td: 0.3,  tv: 0.9,  gf: 190, gd: 0.18, gv: 0.45, rv: 0.75, ec: 0.35, ed: 0.2 },
  crossbow: { cf: 1800, cd: 0.03,  cv: 0.35, bf: 600,  bd: 0.08, bv: 0.25, tf: 160, td: 0.12, tv: 0.45, gf: 90,  gd: 0.06, gv: 0.08, rv: 0.05, ec: 0,    ed: 0 },
  m79:      { cf: 900,  cd: 0.04,  cv: 0.4,  bf: 500,  bd: 0.12, bv: 0.5,  tf: 70,  td: 0.18, tv: 0.9,  gf: 120, gd: 0.06, gv: 0.1,  rv: 0.2,  ec: 0.1,  ed: 0.18 },
};
// Morceau personnalisé : déposer un de ces fichiers dans public/music/ (voir le LISEZMOI de ce dossier)
const CUSTOM_TRACKS = ['/music/theme.mp3', '/music/theme.ogg', '/music/theme.m4a', '/music/theme.wav'];
// Armes sans profil propre
const GUN_FALLBACK = { pistol: 'm1911', ar: 'rifle', smg: 'mp5', mg: 'm249', sniper: 'sniper' };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.noiseBuf = null;
    this.master = null;
    this.music = null;
    this.volume = 1;
    this.musicVolume = 0.5;
    this.mood = { intensity: 0.3, muffled: true };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    this.music?.setVolume(v);
  }

  // L'ambiance musicale suit le jeu : intensité 0..1 (manche, finale), étouffée dans les menus et en pause
  setMood(intensity, muffled) {
    const m = this.mood;
    if (m.intensity !== intensity) { m.intensity = intensity; this.music?.setIntensity(intensity); }
    if (m.muffled !== muffled) { m.muffled = muffled; this.music?.setMuffled(muffled); }
  }

  // À appeler après une interaction utilisateur (clic).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._build(c);
    // un morceau déposé dans public/music/ remplace le rock synthétisé (s'il n'y en a pas, on lance le rock)
    this._loadTrack().then((ok) => { if (!ok) this.music.start(); });
    // onglet en arrière-plan : plus de son (et le séquenceur de la musique s'arrête avec l'horloge audio)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) c.suspend(); else c.resume();
    });
  }

  async _loadTrack() {
    for (const url of CUSTOM_TRACKS) {
      try {
        const res = await fetch(url);
        // un fichier absent renvoie souvent la page d'accueil (SPA) : decodeAudioData la refusera
        if (!res.ok || /text\/html/.test(res.headers.get('content-type') || '')) continue;
        this.music.playTrack(await this.ctx.decodeAudioData(await res.arrayBuffer()));
        return true;
      } catch { /* pas de morceau, ou format illisible : on passe au suivant */ }
    }
    return false;
  }

  // Chaîne audio : sons -> bus -> compresseur -> volume général ; réverbération partagée ; musique sur le même bus
  // (le compresseur baisse naturellement la musique à chaque gros bruit)
  _build(c) {
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    const limiter = c.createDynamicsCompressor(); // empêche tout écrêtage quand tout part en même temps
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    limiter.connect(this.master);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(limiter);
    this.bus = c.createGain();
    this.bus.gain.value = 0.6;
    this.bus.connect(comp);
    this.noiseBuf = noiseBuffer(c, 2);
    const verb = c.createConvolver();
    verb.buffer = reverbBuffer(c);
    const verbOut = c.createGain();
    verbOut.gain.value = 0.55;
    this.verbIn = c.createGain();
    this.verbIn.connect(verb).connect(verbOut).connect(this.bus);
    this.dist = c.createWaveShaper(); // pour les sons « mordants »
    this.dist.curve = satCurve(4);
    this.dist.connect(this.bus);
    this.music = new Music(c, this.bus, { noise: this.noiseBuf, reverb: this.verbIn });
    this.music.setVolume(this.musicVolume);
    this.music.setIntensity(this.mood.intensity);
    this.music.setMuffled(this.mood.muffled);
  }

  // ------------------------------------------------------------ Briques de base
  _route(g, o) {
    g.connect(o.dist ? this.dist : o.out || this.bus);
    if (o.send) {
      const s = this.ctx.createGain();
      s.gain.value = o.send;
      g.connect(s).connect(this.verbIn);
    }
  }

  _env(g, t, atk, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }

  // o : at (retard, s), f1 (fréquence finale du filtre), q, atk (attaque, s), send (réverbération), out (sortie), dist
  _noise(dur, vol, freq, type = 'lowpass', o = {}) {
    if (vol < 0.002) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true; // les sons de plus de 2 s (Pack-a-Punch) bouclent le bruit
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q ?? 0.7;
    const g = c.createGain();
    this._env(g, t, o.atk ?? 0.002, vol, dur);
    src.connect(f).connect(g);
    this._route(g, o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  _tone(type, f0, f1, dur, vol, o = {}) {
    if (vol < 0.002) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    this._env(g, t, o.atk ?? 0.002, vol, dur);
    osc.connect(g);
    this._route(g, o);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Petit « clac » métallique (chargeur, culasse, douille)
  _clack(at, v = 1, f = 2200) {
    this._noise(0.025, 0.4 * v, f, 'bandpass', { at, q: 1.5, atk: 0.001 });
    this._tone('square', f * 0.45, f * 0.2, 0.03, 0.12 * v, { at });
  }

  // ------------------------------------------------------------ Armes
  // id : arme (config) ; v : volume (coéquipier loin = faible) ; dist : distance en mètres (plus loin = plus sourd)
  gun(id, v = 1, dist = 0) {
    if (!this.ctx || v < 0.03) return;
    if (id === 'raygun') return this.ray(v);
    if (id === 'shotgun') return this.shotgun(v, dist);
    const p = GUNS[id] || GUNS[GUN_FALLBACK[id]] || GUNS.rifle;
    const r = rnd(0.95, 1.05);     // chaque coup est un peu différent : sinon on entend la boucle
    const j = v * rnd(0.88, 1);
    const out = this._far(dist);
    const o = { out };
    this._noise(p.cd, p.cv * j, p.cf * r, 'highpass', { ...o, atk: 0.0006, send: p.rv * 0.5 });
    this._noise(p.bd, p.bv * j, p.bf * r, 'lowpass', { ...o, f1: p.bf * 0.2, send: p.rv });
    this._tone('sine', p.tf * r, p.tf * 0.28, p.td, p.tv * j, o);
    this._tone('sawtooth', p.gf * r, p.gf * 0.3, p.gd, p.gv * j, { ...o, dist: !out });
    if (p.ec) this._noise(0.4, p.ec * j, 1500, 'lowpass', { ...o, at: p.ed, f1: 350, send: 0.5, atk: 0.01 }); // écho de la rue
  }

  // Une distance fait perdre les aigus
  _far(dist) {
    if (dist < 8) return null;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = clamp(16000 / (1 + dist / 9), 1400, 16000);
    f.connect(this.bus);
    return f;
  }

  shotgun(v = 1, dist = 0) {
    if (!this.ctx) return;
    const r = rnd(0.95, 1.05), j = v * rnd(0.9, 1);
    const o = { out: this._far(dist) };
    this._noise(0.07, 1.0 * j, 3500 * r, 'highpass', { ...o, atk: 0.0006, send: 0.4 });
    this._noise(0.4, 1.0 * j, 2400 * r, 'lowpass', { ...o, f1: 300, send: 0.8 });
    this._tone('sine', 115 * r, 28, 0.32, 0.9 * j, o);
    this._tone('sawtooth', 190 * r, 50, 0.2, 0.5 * j, { ...o, dist: !o.out });
    this._noise(0.9, 0.3 * j, 800, 'lowpass', { ...o, at: 0.04, f1: 200, send: 1 });
    this._noise(0.5, 0.4 * j, 1400, 'lowpass', { ...o, at: 0.2, f1: 300, send: 0.5, atk: 0.01 }); // écho
    if (dist < 8) { // la pompe : deux claquements
      this._clack(0.42, 1, 1500);
      this._noise(0.12, 0.2, 900, 'bandpass', { at: 0.5 });
      this._clack(0.6, 0.9, 1800);
    }
  }

  ray() { // pistolet à rayons : zap sci-fi
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const car = c.createOscillator();
    car.type = 'sawtooth';
    car.frequency.setValueAtTime(2000, t);
    car.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    const mod = c.createOscillator(); // modulation de fréquence : le « bzzzoum » électrique
    mod.frequency.setValueAtTime(90, t);
    mod.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const md = c.createGain();
    md.gain.setValueAtTime(700, t);
    md.gain.exponentialRampToValueAtTime(40, t + 0.3);
    mod.connect(md).connect(car.frequency);
    const g = c.createGain();
    this._env(g, t, 0.002, 0.3, 0.32);
    car.connect(g);
    this._route(g, { send: 0.6, dist: true });
    car.start(t); mod.start(t);
    car.stop(t + 0.34); mod.stop(t + 0.34);
    this._tone('sine', 3000, 700, 0.18, 0.18, { send: 0.4 });
    this._tone('sine', 240, 60, 0.18, 0.5);
    this._noise(0.25, 0.25, 6000, 'highpass', { send: 0.4 });
  }

  reload(cat = 'ar', time = 2) {
    if (!this.ctx) return;
    const T = time;
    if (cat === 'shotgun') { // cartouches une à une, puis la pompe
      const n = 5;
      for (let i = 0; i < n; i++) {
        this._clack(0.1 * T + i * (0.55 * T / n), 0.55, 1700);
        this._tone('sine', 220, 120, 0.05, 0.25, { at: 0.1 * T + i * (0.55 * T / n) });
      }
      this._clack(0.8 * T, 1, 1500);
      this._clack(0.8 * T + 0.17, 0.9, 1800);
    } else if (cat === 'sniper') { // culasse : lever, reculer, avancer, rabattre
      this._clack(0.12 * T, 0.8, 1400);
      this._noise(0.18, 0.15, 1200, 'bandpass', { at: 0.2 * T });
      this._clack(0.4 * T, 1, 2000);
      this._clack(0.72 * T, 0.9, 1800);
      this._clack(0.82 * T, 1, 1300);
    } else if (cat === 'mg') { // capot, bande de munitions, capot
      this._clack(0.08 * T, 1, 900);
      this._tone('sine', 140, 70, 0.1, 0.4, { at: 0.08 * T });
      this._noise(0.4, 0.12, 2400, 'bandpass', { at: 0.4 * T, q: 2 });
      for (let i = 0; i < 4; i++) this._clack(0.4 * T + i * 0.07, 0.4, 3000);
      this._clack(0.85 * T, 1, 1000);
      this._tone('sine', 150, 70, 0.1, 0.4, { at: 0.85 * T });
    } else { // chargeur : sortie, glissement, mise en place, armement
      this._clack(0.12 * T, 0.7, 2400);
      this._noise(0.12, 0.1, 1500, 'bandpass', { at: 0.15 * T });
      this._clack(0.55 * T, 1, 2000);
      this._tone('sine', 200, 90, 0.08, 0.3, { at: 0.55 * T });
      this._noise(0.05, 0.3, 1800, 'bandpass', { at: 0.86 * T, q: 1 });
      this._clack(0.88 * T, 1, 1600);
      this._clack(0.88 * T + 0.07, 0.8, 2400);
    }
  }

  // Couteau : 'swing' (souffle de la lame), 'flesh' (chair : choc mou et humide), 'metal' (armure : deux notes métalliques)
  knife(kind = 'swing', v = 1) {
    if (!this.ctx || v < 0.03) return;
    if (kind === 'swing') {
      this._noise(0.16, 0.38 * v, 900, 'bandpass', { f1: 3200, q: 1.1, atk: 0.04 });
    } else if (kind === 'metal') {
      this._noise(0.05, 0.5 * v, 3500, 'highpass', { atk: 0.001 });
      this._tone('triangle', 2400, 1900, 0.18, 0.2 * v, { send: 0.25 });
      this._tone('triangle', 3700, 3100, 0.12, 0.12 * v, { send: 0.25 });
    } else {
      this._noise(0.09, 0.55 * v, 700, 'lowpass', { f1: 220, q: 0.8 });
      this._tone('sine', 150, 55, 0.12, 0.5 * v);
      this._noise(0.04, 0.2 * v, 3000, 'bandpass', { atk: 0.001, at: 0.01 });
    }
  }

  empty() { // clic à vide
    if (!this.ctx) return;
    this._clack(0, 0.9, 3200);
    this._tone('sine', 400, 180, 0.04, 0.12);
  }

  // ------------------------------------------------------------ Impacts
  hit(head) {
    if (!this.ctx) return;
    if (head) { // tir à la tête : claque sèche + « tink » aigu qui récompense
      this._noise(0.05, 0.5, 2600, 'bandpass', { atk: 0.001 });
      this._tone('sine', 1700, 1000, 0.07, 0.2);
      this._tone('sine', 260, 100, 0.12, 0.45, { send: 0.2 });
    } else { // chair : choc mou
      this._noise(0.08, 0.4, 900, 'bandpass', { q: 0.9 });
      this._tone('sine', 170, 70, 0.1, 0.4);
    }
  }

  kill() { // le zombie s'effondre : éclaboussure sourde
    if (!this.ctx) return;
    this._noise(0.3, 0.3, 1100, 'bandpass', { f1: 220, q: 0.8, send: 0.2 });
    this._tone('sine', 110, 38, 0.3, 0.35);
  }

  hurt() { // le joueur encaisse
    if (!this.ctx) return;
    this._tone('sine', 95, 40, 0.3, 0.6);
    this._tone('sawtooth', 220, 70, 0.22, 0.25, { dist: true });
    this._noise(0.25, 0.35, 700, 'lowpass', { f1: 200 });
  }

  // ------------------------------------------------------------ Motos
  // Moteur : dents de scie + carré + sous-grave filtrés, à-coups des cylindres (modulation d'amplitude) et bruit du vent.
  // set(rpm 0..1, accélérateur -1..1, vitesse 0..1, volume 0..1) ; stop() l'éteint.
  createEngine(kind) {
    if (!this.ctx) return null;
    const c = this.ctx, big = kind === 'grosseMoto';
    const out = c.createGain(); out.gain.value = 0;
    const am = c.createGain(); am.gain.value = big ? 0.62 : 0.8;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    const osc = (type, gain) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; g.gain.value = gain; o.connect(g).connect(lp); o.start(); return o; };
    const o1 = osc('sawtooth', 0.5), o2 = osc('square', 0.22), sub = osc('sine', big ? 0.7 : 0.4);
    lp.connect(am).connect(out);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 10; lg.gain.value = big ? 0.38 : 0.18; lfo.connect(lg).connect(am.gain); lfo.start();
    const wind = c.createBufferSource(), wf = c.createBiquadFilter(), wg = c.createGain();
    wind.buffer = this.noiseBuf; wind.loop = true; wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.6; wg.gain.value = 0;
    wind.connect(wf).connect(wg).connect(out); wind.start();
    out.connect(this.bus);
    const base = big ? 34 : 52, span = big ? 95 : 175;
    return {
      set: (rpm, throttle, ratio, vol) => {
        const t = c.currentTime, f = base + rpm * span;
        o1.frequency.setTargetAtTime(f, t, 0.04); o2.frequency.setTargetAtTime(f * 1.006, t, 0.04); sub.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        lp.frequency.setTargetAtTime(500 + rpm * 1800 + Math.max(0, throttle) * 600, t, 0.05);
        lfo.frequency.setTargetAtTime(big ? 5 + rpm * 17 : 12 + rpm * 44, t, 0.05);
        wf.frequency.setTargetAtTime(500 + ratio * 1500, t, 0.1); wg.gain.setTargetAtTime(ratio * 0.3, t, 0.1);
        out.gain.setTargetAtTime(vol * (0.16 + 0.1 * rpm + Math.max(0, throttle) * 0.06), t, 0.05);
      },
      stop: () => {
        const t = c.currentTime;
        out.gain.setTargetAtTime(0, t, 0.06);
        for (const n of [o1, o2, sub, lfo, wind]) n.stop(t + 0.35);
      },
    };
  }
  mount(kind) { // démarreur puis un coup d'accélérateur
    if (!this.ctx) return;
    const big = kind === 'grosseMoto';
    this._tone('sawtooth', big ? 45 : 70, big ? 80 : 120, 0.45, 0.25, { dist: true });
    this._noise(0.25, 0.2, 900, 'lowpass', { f1: 300 });
    this._tone('sawtooth', big ? 50 : 80, big ? 140 : 260, 0.4, 0.3, { at: 0.45, dist: true });
    this._tone('sawtooth', big ? 140 : 260, big ? 60 : 100, 0.5, 0.25, { at: 0.85, dist: true });
  }
  beep() { // réserve d'essence : deux petits bips d'alerte
    if (!this.ctx) return;
    this._tone('sine', 1500, 1500, 0.07, 0.12);
    this._tone('sine', 1500, 1500, 0.07, 0.12, { at: 0.13 });
  }
  cough(v = 1) { // moteur qui tousse : raté de gaz
    if (!this.ctx || v < 0.03) return;
    this._noise(0.18, 0.5 * v, 400, 'lowpass', { f1: 120 });
    this._tone('sawtooth', 90, 38, 0.2, 0.22 * v, { dist: true });
  }
  alarm(v = 1) { // moto en feu : deux bips stridents
    if (!this.ctx || v < 0.03) return;
    this._tone('square', 1040, 1040, 0.13, 0.14 * v);
    this._tone('square', 780, 780, 0.13, 0.14 * v, { at: 0.17 });
  }
  down(v = 1) { // un coéquipier est à terre : trois bips d'alarme
    if (!this.ctx || v < 0.03) return;
    for (let i = 0; i < 3; i++) this._tone('square', 960, 760, 0.16, 0.16 * v, { at: i * 0.28 });
  }
  crash(v = 1) { // choc contre un mur : tôle froissée et coup sourd
    if (!this.ctx || v < 0.05) return;
    this._noise(0.35, 0.7 * v, 700, 'lowpass', { f1: 150, send: 0.3 });
    this._tone('sine', 120, 38, 0.3, 0.7 * v);
    this._clack(0.02, 0.8 * v, 900);
    this._noise(0.2, 0.4 * v, 3000, 'bandpass', { at: 0.04, q: 1.2 });
  }

  // ------------------------------------------------------------ Interface et ambiance
  buy() {
    if (!this.ctx) return;
    this._tone('sine', 1320, 1320, 0.1, 0.18);
    this._tone('sine', 1760, 1760, 0.2, 0.18, { at: 0.07 });
  }
  deny() {
    if (!this.ctx) return;
    this._tone('square', 150, 120, 0.2, 0.15);
  }
  roundStart() {
    if (!this.ctx) return;
    // Cor sinistre montant (style manche zombie)
    this.music?.setLull(false);
    this._tone('sawtooth', 65, 82, 1.2, 0.3, { send: 0.4 });
    this._tone('sawtooth', 82, 110, 1.4, 0.35, { at: 0.4, send: 0.4 });
    this._tone('sine', 440, 330, 0.6, 0.2, { at: 0.9 });
  }
  roundEnd() {
    if (!this.ctx) return;
    this.music?.setLull(true);
    this._tone('sine', 520, 390, 0.8, 0.25, { send: 0.3 });
    this._tone('sine', 390, 260, 1.0, 0.2, { at: 0.4, send: 0.3 });
  }
  powerup() {
    if (!this.ctx) return;
    // Fanfare arpeggio
    [392, 523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, f * 1.02, 0.22, 0.25, { at: i * 0.09, send: 0.2 }));
  }
  nuke() {
    if (!this.ctx) return;
    this._noise(1.4, 0.9, 900, 'lowpass', { f1: 150, send: 0.8 });
    this._tone('sine', 150, 25, 1.4, 0.8);
    this._tone('sawtooth', 100, 30, 0.8, 0.3, { dist: true });
  }
  tick(p = 0) { // défilement des armes de la boîte mystère
    if (!this.ctx) return;
    this._tone('triangle', 700 + 500 * p, 500 + 300 * p, 0.05, 0.12);
  }
  papWork() { // grondement mécanique du Pack-a-Punch
    if (!this.ctx) return;
    this._noise(4.2, 0.35, 500, 'lowpass');
    this._tone('sawtooth', 70, 190, 4.2, 0.18);
  }
  bell() { // cloche grave de la cathédrale
    if (!this.ctx) return;
    this._tone('sine', 196, 194, 2.5, 0.45, { send: 0.6 });
    this._tone('sine', 392, 388, 1.8, 0.2, { send: 0.6 });
    this._tone('triangle', 98, 97, 2.8, 0.25, { send: 0.6 });
  }
  explosion(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(1.4, 0.95 * v, 700, 'lowpass', { f1: 120, send: 0.7 });
    this._noise(0.3, 0.6 * v, 3000, 'lowpass', { f1: 500 });
    this._tone('sine', 120, 28, 1.0, 0.8 * v);
    this._tone('sawtooth', 90, 30, 0.4, 0.3 * v, { dist: true });
  }
  pap() {
    if (!this.ctx) return;
    [220, 277, 330, 440, 554, 660].forEach((f, i) => this._tone('sawtooth', f, f * 1.01, 0.3, 0.12, { at: i * 0.11, send: 0.3 }));
  }
  jingle() {
    if (!this.ctx) return;
    [523, 659, 784, 659, 523].forEach((f, i) => this._tone('triangle', f, f, 0.18, 0.18, { at: i * 0.14 }));
  }
  knock(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(0.09, 0.6 * v, 260, 'lowpass');
    this._tone('sine', 150, 55, 0.12, 0.45 * v);
  }
  glass(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(0.4, 0.8 * v, 6500, 'highpass', { send: 0.3 });
    this._noise(0.25, 0.5 * v, 2800, 'bandpass');
    for (let i = 0; i < 4; i++) this._noise(0.06, 0.3 * v, 7000 + i * 500, 'highpass', { at: 0.12 + i * 0.09 });
  }
  rumble(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(1.0, 0.6 * v, 220, 'lowpass');
    this._tone('sine', 62, 34, 1.0, 0.5 * v);
  }
  dirt(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(0.45, 0.6 * v, 900, 'lowpass');
  }

  // Râle de zombie : une voix (dent de scie qui vibre et descend) passée dans deux filtres de voyelle, plus du souffle
  groan(volume) {
    if (!this.ctx || volume <= 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const dur = rnd(0.9, 1.5);
    const base = rnd(70, 115);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.1, t);
    o.frequency.linearRampToValueAtTime(base * 0.55, t + dur);
    const lfo = c.createOscillator();
    lfo.frequency.value = rnd(4.5, 7);
    const lg = c.createGain();
    lg.gain.value = base * 0.05;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume * 0.34, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const vowel = [[520, 330], [1000, 700]]; // « ouuaah » qui se ferme
    for (const [f0, f1] of vowel) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 5;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.linearRampToValueAtTime(f1, t + dur);
      o.connect(f).connect(g);
    }
    g.connect(this.bus);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    this._noise(dur * 0.8, volume * 0.1, 600, 'bandpass', { q: 1.2, atk: 0.2 });
  }
}
