#!/usr/bin/env node
// Token meter: sums the real usage Claude Code records in its session transcripts (main conversation + subagents).
//   node tools/token-meter.mjs            one line: since the previous call, since the counter was started, whole session
//   node tools/token-meter.mjs --mark     (re)start the counter now
//   node tools/token-meter.mjs --week     detail of the last 7 days (every session of this project on this machine), by model
//   --session <id>                        another session (default: the most recently modified one)
// Categories (the weekly limit's exact formula is not public; /usage in Claude Code shows the percentage actually used):
//   out = tokens written by the model (thinking included) · in = fresh input · cache write = input stored for reuse · cache read = reused input (cheapest)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const dir = path.join(process.env.CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects'), process.cwd().replace(/[/_.]/g, '-'));
if (!fs.existsSync(dir)) { console.log(`token-meter: no transcript folder at ${dir}`); process.exit(0); }
const sessions = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ id: f.slice(0, -6), t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
const sid = val('--session') || sessions[0]?.id;

const zero = () => ({ out: 0, inp: 0, cw: 0, cr: 0, calls: 0 });
const add = (a, u) => { a.out += u.output_tokens || 0; a.inp += u.input_tokens || 0; a.cw += u.cache_creation_input_tokens || 0; a.cr += u.cache_read_input_tokens || 0; a.calls++; };
// one record per assistant message id (a message is written several times while it streams: the last copy is the final one)
function read(file, into) {
  if (!fs.existsSync(file)) return;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.includes('"usage"')) continue;
    try {
      const o = JSON.parse(l), m = o.message;
      if (!m?.usage || m.role !== 'assistant' || m.model === '<synthetic>') continue;
      into.set(m.id || o.uuid, { model: m.model, ts: o.timestamp, u: m.usage, sub: file.includes('subagents') });
    } catch { /* partial line */ }
  }
}
const records = (id) => {
  const map = new Map(), sub = path.join(dir, id, 'subagents');
  read(path.join(dir, id + '.jsonl'), map);
  if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) read(path.join(sub, f), map);
  return [...map.values()];
};
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const line = (t) => `sortie ${fmt(t.out)} · entrée ${fmt(t.inp)} · cache écrit ${fmt(t.cw)} · cache lu ${fmt(t.cr)} (${t.calls} appels)`;
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Math.max(0, a[k] - (b?.[k] || 0))]));

if (argv.includes('--week')) {
  const since = Date.now() - 7 * 864e5, by = {};
  for (const s of sessions) for (const r of records(s.id)) {
    if (Date.parse(r.ts) < since) continue;
    add((by[r.model] ||= zero()), r.u);
  }
  const all = zero();
  for (const [m, t] of Object.entries(by)) { console.log(`${m.padEnd(22)} ${line(t)}`); for (const k of Object.keys(all)) all[k] += t[k]; }
  console.log(`${'TOTAL 7 jours'.padEnd(22)} ${line(all)}  [sessions de ce projet sur cette machine]`);
  process.exit(0);
}

const tot = zero(), subs = zero();
for (const r of records(sid)) { add(tot, r.u); if (r.sub) add(subs, r.u); }
const stateFile = path.join(os.tmpdir(), `zs-token-meter-${sid}.json`);
let st = {};
try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first call */ }
if (argv.includes('--mark') || !st.mark) st.mark = tot;
const out = `Jetons · depuis le dernier appel : ${line(diff(tot, st.last || st.mark))}\n       · depuis le compteur : ${line(diff(tot, st.mark))}\n       · session entière : ${line(tot)}, dont sous-agents : sortie ${fmt(subs.out)}`;
st.last = tot;
fs.writeFileSync(stateFile, JSON.stringify(st));
console.log(argv.includes('--mark') ? 'Compteur remis à zéro.\n' + out : out);
