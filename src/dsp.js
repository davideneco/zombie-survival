// Petits utilitaires de synthèse partagés par les effets sonores (audio.js) et la musique (music.js).
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12); // numéro de note MIDI -> Hz

// Courbe de saturation (tanh) pour un WaveShaper : plus k est grand, plus le son est écrasé
export function satCurve(k, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  return c;
}

// Bruit blanc (mono) ; lu en boucle pour les sons plus longs que le buffer
export function noiseBuffer(ctx, sec = 2) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Réponse impulsionnelle de réverbération : bruit stéréo qui s'éteint et s'assombrit (rues / pierre)
export function reverbBuffer(ctx, sec = 1.8, decay = 3) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (1 - 0.9 * t) * (Math.random() * 2 - 1 - lp); // passe-bas de plus en plus fermé
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
