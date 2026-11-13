// Audio smoke test, run through the play-test harness (it cannot "hear", it catches exceptions and silent no-ops, and counts audio nodes):
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-smoke.js
// Builds a standalone Sfx, calls every one-shot sound with its default arguments (a few with explicit ones), builds and stops every loop,
// then cycles the city / station ambience start -> update -> stop and reports the audio nodes created per cycle and the sources still
// running afterwards (a leak shows as a count that grows with the cycles, or sources that never end).
// Numbers (RMS, spectrum, clipping) : tools/audio-render.js.
const made = { n: 0 }, live = new Set(), proto = BaseAudioContext.prototype, orig = {};
for (const k of Object.getOwnPropertyNames(proto)) {
  if (!/^create/.test(k) || typeof proto[k] !== 'function') continue;
  orig[k] = proto[k];
  proto[k] = function (...a) {
    const node = orig[k].apply(this, a);
    made.n++;
    if (typeof node?.start === 'function' && !node.__w) { // sources : tracked from start() to the 'ended' event
      node.__w = 1;
      const st = node.start.bind(node);
      node.start = (...b) => { live.add(node); node.addEventListener('ended', () => live.delete(node)); return st(...b); };
    }
    return node;
  };
}
const { Sfx } = await import('/src/audio.js');
const s = new Sfx();
s.init?.();
const args = { gun: ['rifle'], reload: ['ar', 2], knife: ['swing'], groan: [0.5], step: ['wood', 1], tramDoors: [false, 1], crossingDing: [1, 1.05], bridgeRumble: [1, 2] }; // sounds that need an argument to mean something
const skip = /^(constructor|init|_|create|set|get|next|prev|select|play[A-Z])/;
const names = Object.getOwnPropertyNames(Sfx.prototype).filter((n) => typeof s[n] === 'function' && !skip.test(n));
const failed = [];
for (const n of names) {
  try { s[n](...(args[n] || [])); } catch (e) { failed.push(`${n}: ${e.message}`); }
}
for (const surf of ['stone', 'wood', 'metal', 'concrete', 'nope']) { try { s.step(surf, 1); } catch (e) { failed.push(`step(${surf}): ${e.message}`); } }
// engines and loops are objects with start/stop : build them and stop them again
for (const make of ['createTramEngine', 'createTrainSound']) {
  try { const o = s[make](); o?.stop?.(); } catch (e) { failed.push(`${make}: ${e.message}`); }
}
try { const o = s.createTrainSound(); o.set(25, 0, 0.9, 1); o.set(25, 0, 0.9, 1); o.stop(); } catch (e) { failed.push(`createTrainSound.set: ${e.message}`); }
for (const kind of ['car', 'moto', 'bike', '4x4']) {
  try { const o = s.createEngine(kind); o?.stop?.(); } catch (e) { failed.push(`createEngine(${kind}): ${e.message}`); }
}
// wait until the number of running sources stops falling (one-shots and stopped loops have ended ; what remains is the music and the like)
const settle = async () => {
  let prev = -1, still = 0, waited = 0;
  while (s.ctx.state === 'running' && waited < 12000) {
    await new Promise((r) => setTimeout(r, 500)); waited += 500;
    if (live.size === prev) { if (++still >= 3) break; } else { still = 0; prev = live.size; }
  }
  return live.size;
};
const baseline = await settle();
// ambience loops : calls before start / after stop must be harmless, then start / update / stop cycles
const cycles = [];
for (const [name, upd] of [['createCityAmbience', (o, i) => o.update(i % 2, 5, 12 + i * 0.5, 1)], ['createStationAmbience', (o, i) => o.update(i % 2 ? 'Hall de la Gare' : 'Quais', i % 2, 1)]]) {
  try {
    const o = s[name]();
    o.update(0, 0, 0); o.stop();
    for (let i = 0; i < 5; i++) {
      const before = made.n;
      o.start(); o.start(); // (a second start is ignored)
      for (let j = 0; j < 4; j++) upd(o, j);
      const mid = made.n - before, running = live.size;
      o.stop(); o.stop();
      cycles.push(`${name} #${i}: created ${mid} (+${made.n - before - mid} after), running sources ${running}`);
    }
  } catch (e) { failed.push(`${name}: ${e.message}`); }
}
const ctxState = s.ctx?.state ?? 'none';
const peak = live.size, after = await settle(); // (the stopped loops end after a 1.2 s tail : needs a running clock)
return { ctx: ctxState, sounds: names.length, failed, cycles, nodesCreated: made.n, sourcesBaseline: baseline, sourcesPeak: peak, sourcesAfter: after, leaked: after - baseline };
