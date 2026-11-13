#!/usr/bin/env node
// One command to ship a change (an agent or a human). Replaces ~10 manual steps (and their tokens).
//
//   node tools/ship.mjs <patch|minor> "<English subject>" --changelog <file> [--body <file>] [--trailer "<line>"]...
//                       [--scope <name>] [--allow-images] [--no-push | --only-push]
//
//   --changelog <file>  French player-facing bullets (what changed, then "Vérifié : … / Non vérifié : …"), WITHOUT the "## vX" heading
//   --body <file>       English commit body (default: the changelog text)
//   --trailer <line>    commit trailer, repeatable (e.g. "Co-Authored-By: Name <noreply@…>" and the "Claude-Session: …" line)
//   --scope <name>      refuse to ship files outside tools/scopes.json[name]
//   --no-push           do everything except pushing (then --only-push); --only-push: just push the current HEAD
//
// What it does: commit the pending work ("wip:"), fetch + rebase onto origin/main (conflict → abort, nothing lost), THEN bump the version
// (from whatever main has, so two agents never collide on the number) and write the CHANGELOG entry, regenerate docs if src/config.js
// changed, build (a failing build restores the files and stops), amend the commit as "<subject> (vX.Y.Z)", push the branch and main.
// Never force-pushes main. The branch is pushed normally, and with --force-with-lease only if the rebase rewrote it.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const vals = (k) => argv.flatMap((x, i) => (x === k ? [argv[i + 1]] : []));
const die = (msg, code = 1) => { console.error('ship: ' + msg); process.exit(code); };
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0 && !opts.soft) die(`${cmd} ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-15).join('\n')}`, 2);
  return r;
};
const git = (...a) => sh('git', a).stdout.trim();
const gitSoft = (...a) => sh('git', a, { soft: true });

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

function push() {
  for (let k = 0, wait = 2000; k < 4; k++, wait *= 2) {
    let r = gitSoft('push', '-q', '-u', 'origin', 'HEAD');
    if (r.status !== 0) r = gitSoft('push', '-q', '--force-with-lease', '-u', 'origin', 'HEAD'); // only needed when the rebase rewrote the branch
    if (r.status === 0) break;
    if (k === 3) die('pushing the branch failed:\n' + r.stderr.trim());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
  git('fetch', '-q', 'origin', 'main');
  if (gitSoft('merge-base', '--is-ancestor', 'origin/main', 'HEAD').status !== 0) die('main moved while shipping: run `git rebase origin/main`, fix package.json / CHANGELOG.md by hand (take the next version), then `node tools/ship.mjs --only-push`.', 4);
  sh('git', ['push', '-q', 'origin', 'HEAD:main']);
  console.log(`ship: pushed ${branch} and main at ${git('rev-parse', '--short', 'HEAD')}`);
}

if (branch === 'main') die('work on a branch, never directly on main');
if (flag('--only-push')) { push(); process.exit(0); }

const kind = argv[0], subject = argv[1], clFile = val('--changelog');
if (!['patch', 'minor'].includes(kind) || !subject || subject.startsWith('--') || !clFile) die('usage: node tools/ship.mjs <patch|minor> "<subject>" --changelog <file> [--body <file>] [--trailer "<line>"]... [--scope name] [--no-push|--only-push]');
const changelog = fs.readFileSync(clFile, 'utf8').trim();
if (!/v[ée]rifi/i.test(changelog)) die('the changelog text must say what was verified and not verified ("Vérifié : … / Non vérifié : …")');
if (/^##\s/m.test(changelog)) die('give the bullets only, the script writes the "## vX.Y.Z" heading');

// ---- 1. what is about to be shipped : hygiene and scope
const pending = sh('git', ['status', '--porcelain']).stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
const bad = pending.filter((f) => /(^|\/)(dist|node_modules)\//.test(f) || /\.log$/.test(f) || /^public\/music\/theme\./.test(f) || (!flag('--allow-images') && /\.(png|jpe?g|webp)$/i.test(f)));
if (bad.length) die('refusing to ship (screenshots, logs, build output or copyrighted theme): ' + bad.join(', ') + '\n(--allow-images if a texture is intended)');
const scope = val('--scope');
if (scope) {
  const allow = JSON.parse(fs.readFileSync('tools/scopes.json', 'utf8'))[scope];
  if (!allow) die(`unknown scope "${scope}" in tools/scopes.json`);
  const out = pending.filter((f) => !allow.some((a) => f.startsWith(a)));
  if (out.length) die(`files outside the "${scope}" scope: ${out.join(', ')}\nLeave a request for the owner in docs/AUDIO.md (or the relevant doc) instead of editing them.`);
}

// ---- 2. commit the work, rebase on main
if (pending.length) { git('add', '-A'); git('commit', '-q', '-m', `wip: ${subject}`); }
git('fetch', '-q', 'origin', 'main');
if (git('rev-list', '--count', 'origin/main..HEAD') === '0') die('nothing to ship (no commit ahead of main)');
const rb = gitSoft('rebase', 'origin/main');
if (rb.status !== 0) {
  const files = gitSoft('diff', '--name-only', '--diff-filter=U').stdout.trim();
  gitSoft('rebase', '--abort');
  die(`rebase on origin/main conflicts in:\n${files}\nNothing lost (your work is committed on ${branch}). Merge origin/main by hand, then rerun.`, 3);
}

// ---- 3. version, changelog, docs
const pkg = fs.readFileSync('package.json', 'utf8');
const cur = pkg.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
if (!cur) die('no version in package.json');
let [M, m, p] = cur.slice(1).map(Number);
if (kind === 'minor') { m++; p = 0; } else p++;
const next = `${M}.${m}.${p}`;
let k = 0;
fs.writeFileSync('package.json', pkg.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`));
fs.writeFileSync('package-lock.json', fs.readFileSync('package-lock.json', 'utf8').replace(/"version":\s*"[^"]+"/g, (s) => (k++ < 2 ? `"version": "${next}"` : s)));
const cl = fs.readFileSync('CHANGELOG.md', 'utf8'), at = cl.indexOf('\n## v') + 1;
fs.writeFileSync('CHANGELOG.md', `${cl.slice(0, at)}## v${next} (${new Date().toISOString().slice(0, 10)})\n${changelog}\n\n${cl.slice(at)}`);
if (git('diff', '--name-only', 'origin/main', 'HEAD').split('\n').includes('src/config.js')) sh('node', ['tools/make-docs.mjs']);

// ---- 4. build must pass
const b = spawnSync('npx', ['vite', 'build'], { encoding: 'utf8', maxBuffer: 64 << 20 });
if (b.status !== 0) {
  gitSoft('checkout', '--', '.');
  die(`build failed:\n${(b.stderr + b.stdout).trim().split('\n').slice(-20).join('\n')}\nFiles restored; your work is committed (wip). Fix, then rerun the same command.`, 5);
}

// ---- 5. final commit (single commit on top of main), push
const body = val('--body') ? fs.readFileSync(val('--body'), 'utf8').trim() : changelog;
const msg = `${subject} (v${next})\n\n${body}\n\n${vals('--trailer').join('\n')}\n`;
git('add', '-A');
const wip = git('log', '-1', '--format=%s').startsWith('wip:');
const c = spawnSync('git', ['commit', '-q', ...(wip ? ['--amend'] : []), '-F', '-'], { input: msg, encoding: 'utf8' });
if (c.status !== 0) die('commit failed:\n' + c.stderr);
console.log(`ship: v${next} committed as ${git('rev-parse', '--short', 'HEAD')} (${git('diff', '--name-only', 'origin/main', 'HEAD').split('\n').length} files)`);
if (flag('--no-push')) console.log('ship: not pushed (--no-push). Run: node tools/ship.mjs --only-push');
else push();
