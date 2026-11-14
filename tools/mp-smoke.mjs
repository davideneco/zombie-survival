// End-to-end multiplayer smoke test: one host + two clients (three Chromium contexts) through the REAL WebSocket relay (server/rooms.mjs).
//   node tools/mp-smoke.mjs [url]
//     url   a running game server whose /mp is the relay (Vite dev: http://localhost:5173/ ; the dev server mounts server/rooms.mjs).
//           Omitted: starts `node server/prod.mjs` on a free local port (serves dist/, run `npx vite build` first).
//   env: CHROME=/path/to/chrome (default: Playwright's Chromium)   MP_SIZE=320x180   MP_KEEP=1 (do not stop the local server)
// Flow: create room -> two joins -> host starts (real train intro) -> host skips the intro -> round 1 -> positions -> z_hit -> door purchase ->
// Krutenau bridge (br_x, z_reloc) -> console errors, round / points consistency. Exit code 1 if any check fails.
// Players are put in god mode (no death during the checks); the renderer is stubbed (software GL is far too slow for three tabs).
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(spec); } catch { /* next */ }
  }
  try { const { createRequire } = await import('module'); const { execSync } = await import('child_process'); return createRequire(import.meta.url)(execSync('npm root -g').toString().trim() + '/playwright'); } catch { /* none */ }
  throw new Error('Playwright not found: install it or set PLAYWRIGHT=/path/to/playwright/index.mjs');
}
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

let server = null, url = process.argv[2];
if (!url) {
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) { console.error('No url given and dist/ is missing: run `npx vite build` or pass the dev-server url.'); process.exit(2); }
  const port = await freePort();
  server = spawn('node', ['server/prod.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 40; i++) { try { await fetch(url); break; } catch { await sleep(250); } }
}

const [W, H] = (process.env.MP_SIZE || '320x180').split('x').map(Number);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  [' + (typeof info === 'string' ? info : JSON.stringify(info)) + ']' : ''}`); return !!ok; };
const errors = [];

async function openTab(label) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/theme\.|404|favicon/.test(m.text())) errors.push(`${label} ${m.text().slice(0, 200)}`); });
  await page.addInitScript(() => { window.alert = (m) => { (window.__alerts ||= []).push(String(m)); }; });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 180000 });
  // software GL: drop the draw calls (the game loop, the network and every update keep running)
  await page.evaluate(() => { const g = window.game; g.renderer.render = () => {}; if (g.gfx) g.gfx.render = () => {};
    // teleport on foot (region 0 = outdoor, leaves the tram / station floor) : same call as the host's debug menu
    window.__tp = (x, z) => { const p = game.player; game.debugMenu.place(x, game.world.terrainY(x, z), z, 0); p.godMode = true; };
  });
  const T = {
    label, page,
    ev: (fn, arg) => page.evaluate(fn, arg),
    until: async (fn, arg, ms = 30000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } },
  };
  return T;
}

let exit = 0;
try {
  const host = await openTab('host'), c1 = await openTab('c1'), c2 = await openTab('c2');
  const all = [host, c1, c2];

  // ---------------------------------------------------------------- lobby
  await host.ev(() => { game.charPref = 2; document.getElementById('btnHost').click(); });
  check('host creates a room', await host.until(() => /^[A-Z]{4}$/.test(game.roomCode || '')), await host.ev(() => game.roomCode));
  const code = await host.ev(() => game.roomCode);
  for (const [t, pref] of [[c1, 2], [c2, 0]]) { // c1 asks for the host's character: the relay must give another one
    await t.ev(([cd, p]) => { game.charPref = p; document.getElementById('joinCode').value = cd; document.getElementById('btnJoin').click(); }, [code, pref]);
  }
  check('both clients joined', await host.until(() => game.remotes.size === 2) && await c1.until(() => game.remotes.size === 2) && await c2.until(() => game.remotes.size === 2));
  const slots = [await host.ev(() => game.mySlot), await c1.ev(() => game.mySlot), await c2.ev(() => game.mySlot)];
  check('three distinct characters', new Set(slots).size === 3, slots);

  // ---------------------------------------------------------------- start + intro
  await host.ev(() => document.getElementById('btnStartGame').click());
  check('clients receive start', await c1.until(() => game.started) && await c2.until(() => game.started));
  for (const t of all) await t.ev(() => { game.playing = true; document.getElementById('ovBtn')?.click(); game.playing = true; for (const p of [game.player]) p.godMode = true; });
  const introOn = await host.ev(() => !!game.intro?.on);
  check('intro running on host', introOn, await host.ev(() => game.intro && { ph: game.intro.ph, tau: +game.intro.tau.toFixed(1) }));
  if (introOn) {
    check('clients follow the intro clock (tn_sync)', await c1.until(() => game.intro?.on && game.intro.tau > 0) && await c2.until(() => game.intro?.on && game.intro.tau > 0),
      [await c1.ev(() => +game.intro.tau.toFixed(1)), await c2.ev(() => +game.intro.tau.toFixed(1))]);
    await host.until(() => game.intro.tau > 1.5);
    await host.ev(() => game.introSkip()); // what holding [jump] does
    check('intro_skip reaches the clients', await c1.until(() => game.intro.ph !== 'ride') && await c2.until(() => game.intro.ph !== 'ride'), await c1.ev(() => game.intro.ph));
    check('intro ends and round 1 starts everywhere', await host.until(() => game.round === 1 && !game.intro.on, null, 40000) && await c1.until(() => game.round === 1 && !game.intro.on, null, 20000) && await c2.until(() => game.round === 1 && !game.intro.on, null, 20000),
      all.length && await Promise.all(all.map((t) => t.ev(() => [game.round, game.intro.ph]))));
  } else {
    check('round 1 starts everywhere', await host.until(() => game.round >= 1, null, 20000) && await c1.until(() => game.round >= 1) && await c2.until(() => game.round >= 1));
  }
  // a late round message must not be missed: same round on all three
  const rounds = await Promise.all(all.map((t) => t.ev(() => game.round)));
  check('same round number on host and clients', new Set(rounds).size === 1, rounds);

  // ---------------------------------------------------------------- positions: everybody on the island, apart
  const place = (t, x, z) => t.ev(([px, pz]) => window.__tp(px, pz), [x, z]);
  // island start of the classic game (open Grande Île streets): three points 6 m apart
  const base = { x: -0.6, z: -28 };
  const P = [[base.x, base.z], [base.x + 6, base.z], [base.x, base.z + 6]];
  await Promise.all(all.map((t, i) => place(t, ...P[i])));
  await sleep(1500);
  const seen = async (viewer, who) => viewer.ev((id) => { const r = game.remotes.get(id); return r ? [+r.pos.x.toFixed(1), +r.pos.z.toFixed(1)] : null; }, who);
  const ids = await Promise.all(all.map((t) => t.ev(() => game.net.id)));
  let posOk = true; const posInfo = [];
  for (let v = 0; v < 3; v++) for (let o = 0; o < 3; o++) {
    if (v === o) continue;
    const s = await seen(all[v], ids[o]);
    const ok = s && Math.hypot(s[0] - P[o][0], s[1] - P[o][1]) < 1.5;
    posInfo.push(`${all[v].label}->${all[o].label}:${JSON.stringify(s)}`);
    if (!ok) posOk = false;
  }
  check('every player sees the two others at their real position', posOk, posInfo.join(' '));

  // ---------------------------------------------------------------- z_hit answered by the host
  // (make sure there are zombies near the island start: the host spawns them; wait for round 1 spawns to reach the clients)
  check('zombies reach the clients (z_spawn)', await c1.until(() => game.zombies.length > 0, null, 60000) && await c2.until(() => game.zombies.length > 0, null, 30000), await Promise.all(all.map((t) => t.ev(() => game.zombies.length))));
  const zid = await c1.ev(() => { const z = game.zombies.find((q) => !q.dead && !q.isBoss); return z ? z.id : null; });
  if (zid == null) check('a zombie to hit', false);
  else {
    const before = await host.ev((id) => { const z = game.zombies.find((q) => q.id === id); return z ? z.health : null; }, zid);
    const pts0 = await c1.ev(() => game.points), kills0 = await c1.ev(() => game.kills);
    await c1.ev((id) => { const z = game.zombies.find((q) => q.id === id); game.hitZombie(z, false, { x: z.pos.x, y: z.pos.y + 1, z: z.pos.z }, 10, 1); }, zid); // client: sends z_hit, applies nothing itself
    const hostHp = await host.until(([id, h]) => { const z = game.zombies.find((q) => q.id === id); return !z || z.dead || z.health < h; }, [zid, before], 8000);
    const after = await host.ev((id) => { const z = game.zombies.find((q) => q.id === id); return z ? z.health : null; }, zid);
    check('host applies the client hit (z_hit)', hostHp && after < before, { before, after });
    check('host pays the shooter (pts)', await c1.until((p) => game.points > p, pts0, 8000), { pts0, pts: await c1.ev(() => game.points) });
    // lethal hit: z_dead + kill credit on every peer
    await c1.ev((id) => { const z = game.zombies.find((q) => q.id === id); if (z) game.hitZombie(z, true, { x: z.pos.x, y: z.pos.y + 1.6, z: z.pos.z }, 99999, 2); }, zid);
    const dead = async (t) => t.until((id) => { const z = game.zombies.find((q) => q.id === id); return !z || z.dead || z.health <= 0; }, zid, 8000);
    check('lethal z_hit: the zombie dies on host, c1 and c2', await dead(host) && await dead(c1) && await dead(c2));
    check('shooter gets the kill', await c1.until((k) => game.kills > k, kills0, 5000), { kills: await c1.ev(() => game.kills) });
  }

  // ---------------------------------------------------------------- door purchase (c2 pays, everybody sees it open)
  const door = await host.ev(() => { // cheapest closed outdoor door of the island (not the Krutenau gate)
    const kr = game.world.kr && game.world.kr.doors[0];
    const d = game.world.doors.filter((q) => !q.open && !q.interior && q !== kr && (q.points?.length || q.hit?.length)).sort((a, b) => a.price - b.price)[0];
    if (!d) return null;
    const pt = (d.points.length ? d.points : d.hit)[0];
    return { id: d.id, price: d.price, x: pt.x, z: pt.z };
  });
  if (!door) check('a closed door to buy', false);
  else {
    await c2.ev((d) => { game.points = d.price + 50; window.__tp(d.x, d.z); }, door);
    await sleep(300);
    const near = await c2.ev((d) => game.nearDoor()?.id === d.id, door);
    await c2.ev(() => game.interact());
    const opened = async (t) => t.until((id) => game.world.doors[id].open, door.id, 8000);
    check('door purchase syncs to host and c1', near && await opened(host) && await opened(c1), { near, price: door.price });
    check('buyer paid exactly the price', (await c2.ev(() => game.points)) === 50, await c2.ev(() => game.points));
  }

  // ---------------------------------------------------------------- Krutenau bridge
  const kr = await host.ev(() => { const k = game.world.kr; return k ? { gate: { x: k.gate.x, z: k.gate.z }, entry: { x: k.entry.x, z: k.entry.z } } : null; });
  if (!kr) check('Krutenau district present', false);
  else {
    for (const t of all) await t.ev(() => { game.world.kr.doors[0].open = true; }); // debug: the gate is open (its purchase uses the same door_open path as above)
    const area = (t) => t.ev(() => game.world.logicAreaOf(game.player.pos.x, game.player.pos.z));
    const gateAt = (t, k) => t.ev(([g, off]) => window.__tp(g.x + off, g.z), [kr.gate, k]);
    // zombies near the gate: put 3 host zombies on the island next to it, so that we can tell whether they follow
    const zids = await host.ev((g) => { const out = []; for (const z of game.zombies) { if (z.dead || z.isBoss || out.length >= 3) continue; z.pos.set(g.x + 6 + out.length, 0, g.z + 6); out.push(z.id); } return out; }, kr.gate);
    check('3 zombies staged near the gate', zids.length === 3, zids);
    const cross = async (t) => { await gateAt(t, 0); await sleep(200); const near = await t.ev(() => !!game.nearBridge()); await t.ev(() => game.useBridge()); return near; };
    const n1 = await cross(c1), n2 = await cross(c2);
    check('c1 and c2 cross to Krutenau', n1 && n2 && await area(c1) === 'krutenau' && await area(c2) === 'krutenau', [n1, n2, await area(c1), await area(c2)]);
    await sleep(800);
    const stillIsland = await host.ev((ids) => ids.every((id) => { const z = game.zombies.find((q) => q.id === id); return z && game.world.logicAreaOf(z.pos.x, z.pos.z) === 'island'; }), zids);
    check('host still on the island: zombies stay (no early relocation)', stillIsland);
    const nh = await cross(host);
    check('host crosses too (nobody left on the island)', nh && await area(host) === 'krutenau');
    await sleep(800);
    const inKr = await host.ev((ids) => ids.map((id) => { const z = game.zombies.find((q) => q.id === id); return z && !z.dead ? game.world.logicAreaOf(z.pos.x, z.pos.z) : 'gone'; }), zids);
    check('zombies followed into Krutenau on the host', inKr.every((a) => a === 'krutenau'), inKr);
    const onClient = async (t) => t.ev(([ids, e]) => ids.map((id) => { const z = game.zombies.find((q) => q.id === id); return z ? Math.hypot((z.net?.x ?? z.pos.x) - e.x, (z.net?.z ?? z.pos.z) - e.z) < 60 : 'missing'; }), [zids, kr.entry]);
    check('z_reloc reaches c1 and c2 (zombies near the Krutenau arrival)', (await onClient(c1)).every((v) => v === true) && (await onClient(c2)).every((v) => v === true), [await onClient(c1), await onClient(c2)]);
    // way back: host first (c1, c2 still in the district: zombies stay), then c1, then c2 = the last client leaving (br_x -> host relocates)
    const back = async (t) => { await t.ev((r) => window.__tp(r.x, r.z), await host.ev(() => ({ x: game.world.kr.ret.x, z: game.world.kr.ret.z }))); await sleep(200); const near = await t.ev(() => !!game.nearBridge()); await t.ev(() => game.useBridge()); return near; };
    await back(host); await back(c1); await sleep(600);
    const stay = await host.ev((ids) => ids.map((id) => { const z = game.zombies.find((q) => q.id === id); return z && !z.dead ? game.world.logicAreaOf(z.pos.x, z.pos.z) : 'gone'; }), zids);
    check('c2 still in Krutenau: zombies stay there', stay.every((a) => a === 'krutenau' || a === 'gone'), stay);
    await host.ev(() => { const f = game.hostBridgeFollow; window.__br = []; game.hostBridgeFollow = (...a) => { window.__br.push(a.slice(0, 4)); return f(...a); }; }); // spy: does br_x reach the host?
    await back(c2);
    const zAreas = (ids) => host.ev((ids2) => ids2.map((id) => { const z = game.zombies.find((q) => q.id === id); return z && !z.dead ? game.world.logicAreaOf(z.pos.x, z.pos.z) : 'gone'; }), ids);
    let home = await zAreas(zids);
    for (let i = 0; i < 20 && !home.every((a) => a === 'island' || a === 'gone'); i++) { await sleep(200); home = await zAreas(zids); }
    const seenAreas = await host.ev(() => [...game.remotes.values()].map((r) => game.world.logicAreaOf(r.pos.x, r.pos.z) + '@' + r.pos.x.toFixed(0) + ',' + r.pos.z.toFixed(0) + '(t ' + r.tpos.x.toFixed(0) + ',' + r.tpos.z.toFixed(0) + ')'));
    check('last client leaves by br_x: zombies come back to the island (host)', home.every((a) => a === 'island' || a === 'gone'), { home, brCalls: await host.ev(() => window.__br), remotesSeenByHost: seenAreas });
    check('players are all back on the island', [await area(host), await area(c1), await area(c2)].every((a) => a === 'island'));
  }

  // ---------------------------------------------------------------- consistency + errors
  await sleep(1500);
  const final = await Promise.all(all.map((t) => t.ev(() => ({ round: game.round, pts: game.points, kills: game.kills, rej: game.net.rejected || 0, alerts: window.__alerts || [], remotes: [...game.remotes.values()].map((r) => ({ id: r.id, pts: r.points, kills: r.kills })) }))));
  check('round number identical on all three', new Set(final.map((f) => f.round)).size === 1, final.map((f) => f.round));
  let ptsOk = true;
  for (let v = 0; v < 3; v++) for (const r of final[v].remotes) { const oi = ids.indexOf(r.id); if (oi >= 0 && (r.pts !== final[oi].pts || r.kills !== final[oi].kills)) ptsOk = false; }
  check('points and kills seen by teammates match each player\'s own', ptsOk, final.map((f) => [f.pts, f.kills]));
  check('no unexpected alert() (version mismatch, closed room...)', final.every((f) => f.alerts.length === 0), final.map((f) => f.alerts));
  check('no console error / page exception', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  console.log('FAIL  script error: ' + (e.stack || e).toString().split('\n').slice(0, 12).join(' | '));
  results.push({ name: 'script', ok: false });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
exit = bad ? 1 : 0;
await browser.close().catch(() => {});
if (server && !process.env.MP_KEEP) server.kill();
process.exit(exit);
