// Script évalué dans la page du jeu (tools/export-golden-j10.mjs) : rejoue le VRAI Boss / Tanner / Angel de src/ sur des scénarios scriptés, avec le tirage
// Math.random remplacé par mulberry32, et renvoie les journaux (évènements, dégâts aux joueurs) et des échantillons d'état.
(async () => {
  const V3 = game.player.pos.constructor;
  const { Boss } = await import('/src/boss.js');
  const { Tanner } = await import('/src/tanner.js');
  const { Angel, spireRadius } = await import('/src/angel.js');
  const { Collision } = await import('/src/collision.js');
  const { CONFIG } = await import('/src/config.js');
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const scene = { add() {}, remove() {} };
  const realRandom = Math.random;
  const num = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : null) : v);
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  const col = new Collision(60); col.addSegment(14, -20, 14, 20); col.build();
  const world = { levels: null, nav: null, collide: (pos, r) => col.resolve(pos, r) };
  const out = { scenarios: [] };

  function run(sc) {
    const players = sc.players.map((p, i) => ({ pos: new V3(p[0], p[1], p[2]), dead: false, downed: false, tregion: 0, region: 0, pid: i + 10, hurt(a) { log.push({ f: frame, k: 'strike', pi: i, dmg: a }); } }));
    const log = [];
    let frame = 0;
    const ctx = {
      wantLeap: true,
      event: (n, d) => log.push({ f: frame, k: 'event', n, d: clean(d) }),
      hurtPlayer: (p, dmg, kx, kz, src) => log.push({ f: frame, k: 'hurt', pi: players.indexOf(p), dmg, kx, kz, src: src || '' }),
      pidOf: (p) => p.pid,
      dust: () => {},
      summon: () => log.push({ f: frame, k: 'summon' }),
      glasAdds: () => log.push({ f: frame, k: 'glas' }),
      summonPest: () => log.push({ f: frame, k: 'pest' }),
      onLeap: () => log.push({ f: frame, k: 'leap' }),
    };
    const spawn = { type: 'ground', pos: new V3(sc.pos[0], sc.pos[1], sc.pos[2]) };
    let b;
    if (sc.cls === 'boss') b = new Boss(scene, spawn, sc.hp, () => {}, 1, { ctx });
    else if (sc.cls === 'tanner') b = new Tanner(scene, spawn, sc.hp, () => {}, 1, { ctx });
    else b = new Angel(scene, spawn, sc.hp, () => {}, 1, { ctx });
    b.skipSpawn(); b.ctx = ctx; b.pos.set(sc.pos[0], sc.pos[1], sc.pos[2]);
    if (sc.yaw != null) { b.yaw = sc.yaw; b.group.rotation.set(0, sc.yaw, 0); }
    if (sc.cls === 'angel') { b.center = { x: sc.center[0], z: sc.center[1] }; b.region = sc.region; b.az = 200; b._setState('arrive'); }
    Math.random = mulberry(sc.seed);
    const samples = [], dt = 1 / 60;
    const acts = sc.actions.slice();
    for (frame = 0; frame < sc.frames; frame++) {
      for (const a of acts.filter((x) => x.f === frame)) {
        if (a.op === 'move') { const p = players[a.i]; p.pos.set(a.x, a.y, a.z); p.tregion = a.tregion || 0; }
        else if (a.op === 'down') players[a.i].downed = a.v;
        else if (a.op === 'damage') { const r = b.damage(a.amount, !!a.head, a.hit ? { ...a.hit } : null); log.push({ f: frame, k: 'dmg', died: !!r, hp: b.health }); }
        else if (a.op === 'arrive') b.arrive(a.region, a.x, a.z, a.y);
      }
      b.update(dt, players, [], world);
      if (frame % sc.every === 0 || frame === sc.frames - 1) {
        const s = { f: frame, state: b.state, phase: b.phase, hp: b.health, inv: b.invuln, bs: b.bs, x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, st: b.stateT, aw: b.attackWindup, walk: b.walkT, mark: b.mark ? b.mark.pid : null, cool: {} };
        for (const k of Object.keys(b.cool)) s.cool[k] = Number.isFinite(b.cool[k]) ? b.cool[k] : null;
        if (sc.cls === 'angel') { const w = b.trumpetWorld(new V3()); s.tw = [w.x, w.y, w.z]; s.feathers = b.feathers.length; }
        s.shocks = b.shocks ? b.shocks.length : 0; s.fires = b.fires ? b.fires.length : 0; s.axe = b.axeFlight ? 1 : 0;
        samples.push(clean(s));
      }
    }
    Math.random = realRandom;
    return { name: sc.name, sc, log, samples };
  }

  const P = (x, y, z) => [x, y, z];
  const boss = (name, extra) => ({ cls: 'boss', name, hp: 10000, pos: P(0, 0, 0), yaw: 0, seed: 7, frames: 2400, every: 20, players: [P(10, 0, 0)], actions: [], ...extra });
  // 1. phase I : un joueur à 10 m, le mur à x = 14 (la ruée s'y écrase)
  out.scenarios.push(run(boss('phase1', {})));
  // 2. deux joueurs, la santé franchit les seuils : Glas (70 %), Sentence, saut (45 %), arrivée, rugissement (20 %), Bûcher
  out.scenarios.push(run(boss('phases', { seed: 11, frames: 7200, every: 30, players: [P(8, 0, 3), P(-9, 0, -6)], actions: [
    { f: 300, op: 'damage', amount: 3500, hit: { x: 4, z: 0 } },
    { f: 1500, op: 'damage', amount: 2600, hit: { x: 0, z: -5, ray: true } },
    { f: 3200, op: 'damage', amount: 2800, hit: { x: 3, z: 3, zone: true } },
    { f: 3300, op: 'arrive', region: 0, x: -20, y: 0, z: 10 },
    { f: 4800, op: 'damage', amount: 3000, hit: { x: 5, z: 5, back: true, pid: 11 } },
  ] })));
  // 3. dégâts : table de multiplicateurs (face, dos, zone, rayon, étourdi) sur un boss neuf à chaque fois, cap = +z
  const mult = [];
  for (const hit of [null, { x: 0, z: 5 }, { x: 0, z: -5 }, { zone: true }, { x: 0, z: 5, ray: true }, { x: 0, z: -5, ray: true }, { x: 0, z: 5, back: true }, { x: 1, z: -2, back: false }, { x: 0, z: -5, pid: 99 }]) {
    for (const stun of [false, true]) {
      const b = new Boss(scene, { type: 'ground', pos: new V3(0, 0, 0) }, 10000, () => {}, 1, { ctx: null });
      b.skipSpawn(); b.yaw = 0; if (stun) b.state = 'stun';
      const mk = { target: {}, pid: 10, t: 5 };
      for (const mark of [false, true]) { b.health = 10000; b.mark = mark ? mk : null; b.damage(100, false, hit ? { ...hit } : null); mult.push({ hit, stun, mark, lost: 10000 - b.health }); }
    }
  }
  out.mult = clean(mult);
  // 4. Tanner : cône de vomi, appel
  out.scenarios.push(run({ cls: 'tanner', name: 'tanner', hp: 30000, pos: P(0, 0, 0), yaw: 0, seed: 5, frames: 2400, every: 20, players: [P(6, 0, 1), P(-7, 0, 2)], actions: [] }));
  // 5. Ange : le cercle, trompette, plumes ; jugement après 40 % de dégâts
  const cx = 50, cz = -30;
  out.scenarios.push(run({ cls: 'angel', name: 'angel', hp: 40000, pos: P(cx + 20, 126, cz), yaw: 0, seed: 3, frames: 3600, every: 20, center: [cx, cz], region: 13, players: [P(cx + 7, 104, cz + 2), P(cx - 6, 104, cz - 3)], actions: [
    { f: 1000, op: 'damage', amount: 18000 },
  ] }));
  // 6. fonctions pures de l'Ange
  const a = new Angel(scene, { type: 'ground', pos: new V3(0, 0, 0) }, 1000, () => {}, 1, { ctx: null });
  a.center = { x: 3, z: -2 };
  const spire = [], block = [];
  for (let y = 90; y <= 145; y += 0.5) spire.push([y, spireRadius(y)]);
  const rnd = mulberry(99);
  for (let i = 0; i < 400; i++) {
    const A = [rnd() * 30 - 15, 100 + rnd() * 40, rnd() * 30 - 15], B = [rnd() * 30 - 15, 100 + rnd() * 40, rnd() * 30 - 15];
    block.push([...A, ...B, a.blocked(...A, ...B) ? 1 : 0]);
  }
  out.spire = spire; out.blocked = block;
  out.cath = { fanal: game.tower.fanal, tower: [game.tower.x, game.tower.z], P: [[37, 0], [-33, 0], [-62, 9], [-70, -4]].map(([s, t]) => game.player.world.cathedral.P(s, t)) };
  return JSON.stringify(out);
})()
