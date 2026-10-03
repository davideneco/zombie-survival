// Sons synthétisés avec WebAudio : aucun fichier audio nécessaire.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.noiseBuf = null;
    this.master = null;
    this.volume = 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // À appeler après une interaction utilisateur (clic).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _noise(dur, vol, freq, type = 'lowpass') {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(c.currentTime, Math.random() * 0.5);
    src.stop(c.currentTime + dur);
  }

  _tone(type, f0, f1, dur, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur);
  }

  shot() {
    if (!this.ctx) return;
    this._noise(0.18, 0.6, 3500);
    this._tone('square', 160, 40, 0.12, 0.35);
  }
  shotgun() {
    if (!this.ctx) return;
    this._noise(0.28, 0.9, 1800);
    this._tone('sawtooth', 120, 30, 0.22, 0.6);
    setTimeout(() => {
      if (!this.ctx) return;
      this._noise(0.04, 0.25, 4500, 'highpass');
      setTimeout(() => this.ctx && this._noise(0.05, 0.35, 3200, 'highpass'), 280);
    }, 380);
  }
  smg() {
    if (!this.ctx) return;
    this._noise(0.12, 0.45, 4200);
    this._tone('square', 220, 70, 0.08, 0.25);
  }
  hit(head) {
    if (!this.ctx) return;
    this._noise(0.08, 0.3, head ? 2500 : 900, 'bandpass');
    if (head) {
      this._tone('sine', 1100, 600, 0.1, 0.25);
      this._noise(0.12, 0.4, 1800, 'lowpass');
    }
  }
  kill() {
    if (!this.ctx) return;
    this._tone('sawtooth', 120, 40, 0.35, 0.2);
  }
  hurt() {
    if (!this.ctx) return;
    this._tone('sawtooth', 200, 60, 0.25, 0.3);
    this._noise(0.2, 0.3, 500);
  }
  reload() {
    if (!this.ctx) return;
    this._noise(0.05, 0.3, 2500, 'highpass');
    setTimeout(() => this.ctx && this._noise(0.06, 0.4, 3000, 'highpass'), 1100);
  }
  empty() {
    if (!this.ctx) return;
    this._noise(0.03, 0.25, 4000, 'highpass');
  }
  buy() {
    if (!this.ctx) return;
    this._tone('sine', 600, 1200, 0.15, 0.2);
  }
  deny() {
    if (!this.ctx) return;
    this._tone('square', 150, 120, 0.2, 0.15);
  }
  roundStart() {
    if (!this.ctx) return;
    // Cor sinistre montant (style manche zombie)
    this._tone('sawtooth', 65, 82, 1.2, 0.3);
    setTimeout(() => this.ctx && this._tone('sawtooth', 82, 110, 1.4, 0.35), 400);
    setTimeout(() => this.ctx && this._tone('sine', 440, 330, 0.6, 0.2), 900);
  }
  roundEnd() {
    if (!this.ctx) return;
    this._tone('sine', 520, 390, 0.8, 0.25);
    setTimeout(() => this.ctx && this._tone('sine', 390, 260, 1.0, 0.2), 400);
  }
  powerup() {
    if (!this.ctx) return;
    // Fanfare arpeggio
    [392, 523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this.ctx && this._tone('triangle', f, f * 1.02, 0.22, 0.25), i * 90);
    });
  }
  nuke() {
    if (!this.ctx) return;
    this._noise(1.2, 0.9, 800, 'lowpass');
    this._tone('sine', 150, 25, 1.4, 0.7);
  }
  knock(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(0.09, 0.6 * v, 260, 'lowpass');
    this._tone('sine', 150, 55, 0.12, 0.45 * v);
  }
  glass(v = 1) {
    if (!this.ctx || v < 0.03) return;
    this._noise(0.4, 0.8 * v, 6500, 'highpass');
    this._noise(0.25, 0.5 * v, 2800, 'bandpass');
    for (let i = 0; i < 4; i++) setTimeout(() => this.ctx && this._noise(0.06, 0.3 * v, 7000 + i * 500, 'highpass'), 120 + i * 90);
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
  groan(volume) {
    if (!this.ctx || volume <= 0.01) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const base = 70 + Math.random() * 40;
    o.frequency.setValueAtTime(base, c.currentTime);
    o.frequency.linearRampToValueAtTime(base * 0.6, c.currentTime + 0.8);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 350;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(volume * 0.3, c.currentTime + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.8);
    o.connect(f).connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + 0.85);
  }
}
