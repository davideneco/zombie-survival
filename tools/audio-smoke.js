// Audio smoke test, run through the play-test harness (it cannot "hear", it catches exceptions and silent no-ops):
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28" --file tools/audio-smoke.js
// Builds a standalone Sfx, calls every one-shot sound with its default arguments (a few with explicit ones), reports failures.
const { Sfx } = await import('/src/audio.js');
const s = new Sfx();
s.init?.();
const args = { gun: ['rifle'], reload: ['ar', 2], knife: ['swing'], groan: [0.5] }; // sounds that need an argument to mean something
const skip = /^(constructor|init|_|create|set|get|next|prev|select|play[A-Z])/;
const names = Object.getOwnPropertyNames(Sfx.prototype).filter((n) => typeof s[n] === 'function' && !skip.test(n));
const failed = [];
for (const n of names) {
  try { s[n](...(args[n] || [])); } catch (e) { failed.push(`${n}: ${e.message}`); }
}
// engines and loops are objects with start/stop : build them and stop them again
for (const make of ['createTramEngine', 'createTrainSound']) {
  try { const o = s[make](); o?.stop?.(); } catch (e) { failed.push(`${make}: ${e.message}`); }
}
for (const kind of ['car', 'moto', 'bike', '4x4']) {
  try { const o = s.createEngine(kind); o?.stop?.(); } catch (e) { failed.push(`createEngine(${kind}): ${e.message}`); }
}
return { ctx: s.ctx?.state ?? 'none', sounds: names.length, failed };
