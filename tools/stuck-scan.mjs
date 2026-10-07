// Détection de blocages et de défauts de collision / d'affichage (v0.33.0), en pilotant le vrai jeu en mode ?debug avec Playwright.
//
//   node tools/stuck-scan.mjs [url] [dossier-sortie]
//     url             jeu déjà lancé (npm run dev, vite preview…) ; défaut http://localhost:5173/
//     dossier-sortie  défaut ./stuck-scan-out (report.json, hotspots.png, liens.txt)
//   variables : ONLY=comp,pockets,bots,rays,zfight (étapes à lancer ; défaut toutes) · SEED=1 · BOTS=200 · BOT_SECONDS=60 · RAYS=2000
//               PLAYWRIGHT=/chemin/vers/playwright/index.mjs (si le module n'est pas résoluble) · CHROME=/chemin/chrome (sinon celui de Playwright)
//
// Étapes (toutes toutes portes ouvertes) :
//   comp     composantes connexes des cases libres de world.nav (NavGrid.components) : la principale contient le départ.
//   pockets  pour chaque poche non principale proche de la principale (moins de 3 m) : un joueur simulé (vrai Player.update, collision de rayon
//            0,4) tente d'y entrer et d'en sortir pendant 3 s depuis 8 directions. Entrée possible mais sortie impossible = POCHE-PIÈGE.
//   bots     200 bots à marche aléatoire déterministe pendant 60 s simulées : positions bloquées plus de 2 s, sous la carte (y < -1), étage incohérent.
//   rays     2000 rayons horizontaux à hauteur d'œil : collision (rayHit) contre maillages (Raycaster). Collision sans maillage à +0,6 m = mur
//            INVISIBLE ; maillage de moins de 2 m d'épaisseur sans collision = mur TRAVERSABLE.
//   zfight   triangles coplanaires (plan quantifié à 1 cm) de deux maillages différents qui se recouvrent : z-fighting.
// La sortie liste, pour chaque problème, ses coordonnées et un lien ?debug&x&z&yaw&pitch qui place le joueur sur place ; hotspots.png les
// marque sur la carte (rouge : poche-piège, orange : bot bloqué, violet : mur invisible, bleu : mur traversable, jaune : z-fighting).
import fs from 'fs';
import path from 'path';

const URL_ = process.argv[2] || 'http://localhost:5173/';
const OUT = path.resolve(process.argv[3] || 'stuck-scan-out');
const ONLY = (process.env.ONLY || 'comp,pockets,bots,rays,zfight').split(',');
const OPTS = { seed: +(process.env.SEED || 1), bots: +(process.env.BOTS || 200), botSeconds: +(process.env.BOT_SECONDS || 60), rays: +(process.env.RAYS || 2000) };
fs.mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(spec); } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable : définir PLAYWRIGHT=/chemin/vers/playwright/index.mjs');
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
page.setDefaultTimeout(0);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/theme|404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
// le rendu logiciel est lent et inutile ici : la boucle d'animation est espacée (les étapes appellent game.update elles-mêmes)
await page.addInitScript(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 4000); try { localStorage.setItem('zombie_settings', JSON.stringify({ quality: 0 })); } catch { /* ignoré */ } });
const sep = URL_.includes('?') ? '&' : '?';
await page.goto(`${URL_}${sep}debug`, { timeout: 600000 });
await page.waitForFunction(() => window.game && window.game.player && window.game.unstick, null, { timeout: 600000 });
await page.waitForTimeout(1500);

await page.evaluate(() => { for (const d of game.world.doors) game.openDoor(d.id); }); // toutes les portes ouvertes pour toutes les étapes
const report = { url: URL_, date: new Date().toISOString(), options: OPTS, steps: {} };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

// ---------------------------------------------------------------------------------------------------------------- étape comp
if (ONLY.includes('comp') || ONLY.includes('pockets')) {
  report.steps.comp = await page.evaluate(() => {
    const w = game.world, nav = w.nav;
    for (const d of w.doors) game.openDoor(d.id); // toutes les portes ouvertes
    const comp = nav.components(), main = game.unstick.main(), { labels, sizes } = comp, { nx, nz } = nav;
    const acc = new Map();
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const l = labels[iz * nx + ix];
      if (!l || l === main) continue;
      let a = acc.get(l); if (!a) acc.set(l, a = { id: l, size: 0, sx: 0, sz: 0, cells: [] });
      a.size++; a.sx += ix; a.sz += iz; if (a.cells.length < 4000) a.cells.push(iz * nx + ix);
    }
    // main la plus proche de chaque poche : distance minimale entre une case de la poche et une case principale (fenêtre de 4 cases)
    const R = 4, pockets = [];
    for (const a of acc.values()) {
      let best = Infinity, pc = null, mc = null;
      for (const i of a.cells) {
        const ix = i % nx, iz = (i / nx) | 0;
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || labels[jz * nx + jx] !== main) continue;
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; pc = [ix, iz]; mc = [jx, jz]; }
        }
      }
      const cx = a.sx / a.size, cz = a.sz / a.size, x = nav.ox + (cx + 0.5) * nav.cell, z = nav.oz + (cz + 0.5) * nav.cell;
      const zi = w.zoneOf(x, z);
      pockets.push({ id: a.id, size: a.size, area: +(a.size * nav.cell * nav.cell).toFixed(1), x: +x.toFixed(1), z: +z.toFixed(1), zone: zi >= 0 ? w.zoneNames[zi] : null,
        gap: pc ? +(Math.sqrt(best) * nav.cell).toFixed(2) : null,
        pc: pc ? [nav.worldX(pc[0]), nav.worldZ(pc[1])] : null, mc: mc ? [nav.worldX(mc[0]), nav.worldZ(mc[1])] : null });
    }
    window.__pockets = pockets;
    // objets du jeu hors de la composante principale (inaccessibles à pied) : bornes, machines, armes au mur, motos, départ, points d'achat des portes
    const unreachable = [];
    const reach = (x, z, r = 3) => { // une case de la composante principale à moins de r m (portée d'interaction)
      const ix = nav.cx(x), iz = nav.cz(z), R = Math.ceil(r / nav.cell);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { const jx = ix + dx, jz = iz + dz; if (nav.inside(jx, jz) && labels[nav.idx(jx, jz)] === main && Math.hypot(dx, dz) * nav.cell <= r) return true; }
      return false;
    };
    const check = (kind, name, x, z) => { if (x == null || z == null) return; if (!reach(x, z)) unreachable.push({ kind, name, x: +x.toFixed(1), z: +z.toFixed(1), zone: w.zoneNames[w.zoneOf(x, z)] ?? null }); };
    check('départ', 'startPos', w.startPos.x, w.startPos.z);
    for (const st of w.stations || []) check('borne de munitions', '', st.x, st.z);
    for (const m of w.machines || []) check('machine', m.type + (m.id ? ':' + m.id : ''), m.pos.x, m.pos.z);
    for (const ww of w.wallWeapons || []) check('arme au mur', ww.id, ww.pos.x, ww.pos.z);
    for (const v of w.vehicleSpawns || []) check('moto', v.type, v.x, v.z);
    for (const d of w.doors || []) for (const pt of d.points || []) check('porte', `${d.id}`, pt.x, pt.z);
    return { unreachable, cell: nav.cell, components: sizes.length - 1, mainSize: sizes[main], mainArea: +(sizes[main] * nav.cell * nav.cell).toFixed(0), pockets: pockets.length,
      pocketsTouching: pockets.filter((p) => p.gap != null && p.gap <= 3).length, pocketsInZone: pockets.filter((p) => p.zone).length,
      biggest: pockets.sort((a, b) => b.size - a.size).slice(0, 12).map(({ pc, mc, ...r }) => r) };
  });
  log('comp', JSON.stringify(report.steps.comp).slice(0, 300));
}

// -------------------------------------------------------------------------------------------------------------- étape pockets
if (ONLY.includes('pockets')) {
  report.steps.pockets = await page.evaluate(() => {
    const w = game.world, nav = w.nav, p = game.player, main = game.unstick.main(), { labels } = nav.components();
    const dt = 0.05, traps = [], stats = { tested: 0, enterable: 0, trapped: 0, unreachable: 0 };
    const labelNear = (x, z) => {
      const ix = nav.cx(x), iz = nav.cz(z);
      let best = 0, bd = 99;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const jx = ix + dx, jz = iz + dz; if (!nav.inside(jx, jz)) continue; const l = labels[nav.idx(jx, jz)]; const d = dx * dx + dz * dz; if (l && d < bd) { bd = d; best = l; } }
      return best;
    };
    const walk = (x0, z0, x1, z1, secs) => { // marche vers (x1, z1) avec le vrai Player.update ; renvoie la position finale
      p.pos.set(x0, 0, z0); p.vel.set(0, 0, 0); p.vy = 0; p.vault = null; p.vaultCd = 9; p.pitch = 0; p.region = 0; p.keys.KeyW = true;
      for (let i = 0; i < secs / dt; i++) {
        const dx = x1 - p.pos.x, dz = z1 - p.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.3) break;
        p.yaw = Math.atan2(-dx, -dz);
        game.time += dt; p.update(dt, game.time);
      }
      p.keys.KeyW = false;
      return { x: p.pos.x, z: p.pos.z };
    };
    for (const k of window.__pockets) {
      if (k.gap == null || k.gap > 3 || !k.pc) continue;
      stats.tested++;
      let entered = null, exited = null;
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4, sx = k.pc[0] + Math.cos(ang) * 3.2, sz = k.pc[1] + Math.sin(ang) * 3.2;
        if (labelNear(sx, sz) !== main) continue;
        const q = { x: sx, y: 0, z: sz }; w.collide(q, 0.4); if (Math.hypot(q.x - sx, q.z - sz) > 0.05) continue; // départ encombré
        const e = walk(sx, sz, k.pc[0], k.pc[1], 3);
        if (Math.hypot(e.x - k.pc[0], e.z - k.pc[1]) > 0.9 && labelNear(e.x, e.z) !== k.id) continue; // n'entre pas
        entered = entered || { dir: a * 45, x: e.x, z: e.z };
        // sortie : vers la case principale la plus proche, puis (si elle échoue) dans 16 directions et vers 16 cases principales alentour
        const isOut = (o) => labelNear(o.x, o.z) === main || Math.hypot(o.x - k.mc[0], o.z - k.mc[1]) < 0.9;
        let o = walk(e.x, e.z, k.mc[0], k.mc[1], 3), ok = isOut(o);
        for (let t = 0; t < 16 && !ok; t++) {
          const ang2 = (t * Math.PI) / 8;
          o = walk(e.x, e.z, e.x + Math.cos(ang2) * 6, e.z + Math.sin(ang2) * 6, 3); ok = isOut(o) || labelNear(o.x, o.z) === main;
        }
        if (!ok) { exited = { ok: false, dir: a * 45, x: o.x, z: o.z }; break; }
        exited = exited || { ok: true };
      }
      if (!entered) { stats.unreachable++; continue; }
      stats.enterable++;
      if (exited && !exited.ok) { stats.trapped++; traps.push({ id: k.id, size: k.size, area: k.area, zone: k.zone, x: +k.pc[0].toFixed(1), z: +k.pc[1].toFixed(1), entry: entered, stuckAt: { x: +exited.x.toFixed(2), z: +exited.z.toFixed(2) }, fromDir: exited.dir }); }
    }
    return { stats, traps };
  });
  log('pockets', JSON.stringify(report.steps.pockets.stats), 'pièges :', report.steps.pockets.traps.length);
}

// ---------------------------------------------------------------------------------------------------------------------- étape bots
if (ONLY.includes('bots')) {
  report.steps.bots = await page.evaluate((o) => {
    const w = game.world, nav = w.nav, main = game.unstick.main(), { labels } = nav.components();
    let s = (o.seed * 2654435761) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const dt = 0.05, steps = Math.round(o.botSeconds / dt), fl = { y: 0, region: 0 };
    // départs : cases libres de la composante principale, en zone ouverte, uniformément sur la carte
    const bots = [];
    for (let tries = 0; bots.length < o.bots && tries < 200000; tries++) {
      const ix = Math.floor(rnd() * nav.nx), iz = Math.floor(rnd() * nav.nz);
      if (labels[nav.idx(ix, iz)] !== main) continue;
      const x = nav.worldX(ix), z = nav.worldZ(iz), zi = w.zoneOf(x, z);
      if (zi < 0 || !w.isZoneOpen(zi)) continue;
      const q = { x, y: 0, z }; w.collide(q, 0.4); if (Math.hypot(q.x - x, q.z - z) > 0.05) continue;
      bots.push({ id: bots.length, x, z, y: 0, region: 0, head: rnd() * 6.283, turnT: 1 + rnd() * 2, win: [], stuckT: 0, flagged: null, dirChanges: 0, badY: 0, bumpT: 0 });
    }
    const found = [];
    for (let k = 0; k < steps; k++) {
      for (const b of bots) {
        b.turnT -= dt;
        if (b.turnT <= 0) { b.head += (rnd() - 0.5) * 2 * 2.4; b.turnT = 0.8 + rnd() * 2.2; b.dirChanges++; }
        const px = b.x, pz = b.z;
        const q = { x: b.x + Math.cos(b.head) * 5 * dt, y: b.y, z: b.z + Math.sin(b.head) * 5 * dt };
        w.collide(q, 0.4);
        w.floorAt(q.x, q.z, b.y, fl);
        if (Math.abs(fl.y - b.y) > 0.62 && fl.y > b.y) { q.x = px; q.z = pz; w.floorAt(px, pz, b.y, fl); } // marche trop haute : mur
        // un joueur qui bute contre un mur change de cap : le bot aussi (dès 0,2 s sans avancer), puis réessaie ; il n'est « bloqué » que s'il n'y arrive pas
        const adv = Math.hypot(q.x - px, q.z - pz);
        if (adv < 0.3 * 5 * dt) { b.bumpT += dt; if (b.bumpT >= 0.2) { b.head += Math.PI * (0.5 + rnd()) * (rnd() < 0.5 ? -1 : 1); b.bumpT = 0; b.turnT = 0.5 + rnd(); b.dirChanges++; } } else b.bumpT = 0;
        b.x = q.x; b.z = q.z; b.y = fl.y; b.region = fl.region;
        if (b.region === 0 && (b.y < -1 || b.y > 0.5)) b.badY += dt; else b.badY = 0;
        if (b.y < -1 && b.region === 0 && !b.flagged) { b.flagged = 'sous la carte'; found.push({ bot: b.id, kind: 'sous la carte', x: b.x, z: b.z, y: b.y }); }
        else if (b.badY > 1 && !b.flagged) { b.flagged = 'étage incohérent'; found.push({ bot: b.id, kind: 'étage incohérent', x: b.x, z: b.z, y: b.y, region: b.region }); }
        // bloqué : moins de 0,5 m parcourus en 3 s (puis encore 2 s) malgré des changements de cap répétés
        b.win.push([b.x, b.z]); if (b.win.length > 60) b.win.shift();
        if (b.win.length === 60 && !b.flagged) {
          const d = Math.hypot(b.x - b.win[0][0], b.z - b.win[0][1]);
          if (d < 0.5) { b.stuckT += dt; if (b.stuckT > 2) { b.flagged = 'bloqué'; found.push({ bot: b.id, kind: 'bloqué', x: b.x, z: b.z, y: b.y }); } } else b.stuckT = 0;
        }
      }
    }
    // regroupe les doublons (3 m)
    const out = [];
    for (const f of found) { const same = out.find((g) => g.kind === f.kind && Math.hypot(g.x - f.x, g.z - f.z) < 3); if (same) same.n++; else out.push({ ...f, x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +f.y.toFixed(2), n: 1, zone: (() => { const zi = w.zoneOf(f.x, f.z); return zi >= 0 ? w.zoneNames[zi] : null; })() }); }
    return { bots: bots.length, seconds: o.botSeconds, flagged: found.length, spots: out };
  }, OPTS);
  log('bots', report.steps.bots.bots, 'bots,', report.steps.bots.flagged, 'signalés');
}

// ---------------------------------------------------------------------------------------------------------------------- étape rays
if (ONLY.includes('rays')) {
  report.steps.rays = await page.evaluate((o) => {
    const w = game.world, nav = w.nav, col = w.collision, THREE = game.THREE, main = game.unstick.main(), { labels } = nav.components();
    for (const d of w.doors) game.openDoor(d.id);
    // maillages pleins : ni invisibles, ni particules, ni avatars / zombies
    const meshes = [];
    game.scene.traverse((m) => {
      const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible || q === game.camera) return false; return true; }; // maillage et tous ses parents visibles, hors armes de la vue (enfants de la caméra)
      if (!m.isMesh || !vis(m) || m.userData.zombie || !m.geometry) return; // les InstancedMesh (mobilier, arbres) comptent aussi
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || (mat.transparent && mat.opacity < 0.2) || mat.depthWrite === false || mat.blending === THREE.AdditiveBlending) return;
      m.updateMatrixWorld(true); if (m.isInstancedMesh && !m.boundingSphere) m.computeBoundingSphere(); meshes.push(m);
    });
    const nameOf = (m) => m.name || m.parent?.name || m.material?.name || '(sans nom)';
    let s = (o.seed * 40503) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const rc = new THREE.Raycaster(), RANGE = 10, EYE = 1.6;
    const invisible = [], passable = [], cats = {};
    let tested = 0;
    for (let tries = 0; tested < o.rays && tries < 100000; tries++) {
      const ix = Math.floor(rnd() * nav.nx), iz = Math.floor(rnd() * nav.nz);
      if (labels[nav.idx(ix, iz)] !== main) continue;
      const x = nav.worldX(ix), z = nav.worldZ(iz), zi = w.zoneOf(x, z);
      if (zi < 0 || !w.isZoneOpen(zi)) continue;
      tested++;
      const a = rnd() * 6.283, dx = Math.cos(a), dz = Math.sin(a);
      const dc = col.rayHit(x, EYE, z, dx, 0, dz, RANGE);
      rc.set(new THREE.Vector3(x, EYE, z), new THREE.Vector3(dx, 0, dz)); rc.far = RANGE;
      const hits = rc.intersectObjects(meshes, false);
      const dm = hits.length ? hits[0].distance : Infinity;
      let side = false; // un maillage tout près de l'impact (rayons décalés de 0,2 et 0,4 m de part et d'autre) : arbre, tram vitré… pas un mur invisible
      if (dc < RANGE && dm > dc + 0.6) {
        for (const off of [-0.4, -0.2, 0.2, 0.4]) {
          const r2 = new THREE.Raycaster(new THREE.Vector3(x - dz * off, EYE, z + dx * off), new THREE.Vector3(dx, 0, dz), 0, dc + 0.6);
          if (r2.intersectObjects(meshes, false).length) { side = true; break; }
        }
      }
      if (dc < RANGE && dm > dc + 0.6 && !side) { // collision sans maillage derrière : mur invisible
        const hx = x + dx * dc, hz = z + dz * dc; let ob = null, bd = 0.35; // l'obstacle de collision touché
        for (const sg of col.segs) { if (sg.off || Math.min(sg.ax, sg.bx) - 0.4 > hx || Math.max(sg.ax, sg.bx) + 0.4 < hx || Math.min(sg.az, sg.bz) - 0.4 > hz || Math.max(sg.az, sg.bz) + 0.4 < hz) continue; const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, l2 = ex * ex + ez * ez; let t = l2 ? ((hx - sg.ax) * ex + (hz - sg.az) * ez) / l2 : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(sg.ax + ex * t - hx, sg.az + ez * t - hz); if (d < bd) { bd = d; ob = { type: 'segment', h: sg.h, y0: sg.y0, kind: sg.kind, len: +Math.sqrt(l2).toFixed(1), vault: !!sg.vid }; } }
        for (const c of col.circles) { if (c.off) continue; const d = Math.abs(Math.hypot(c.x - hx, c.z - hz) - c.r); if (d < bd) { bd = d; ob = { type: 'cercle', h: c.h, y0: c.y0, kind: c.kind, r: c.r, vault: !!c.vid }; } }
        invisible.push({ ob, x: +(x + dx * dc).toFixed(1), z: +(z + dz * dc).toFixed(1), from: [+x.toFixed(1), +z.toFixed(1)], dc: +dc.toFixed(2), dm: dm === Infinity ? null : +dm.toFixed(2), a: +a.toFixed(2), zone: w.zoneNames[w.zoneOf(x + dx * dc, z + dz * dc)] ?? null });
      } else if (dm < RANGE && dm < dc - 0.6 && hits[0].object) { // maillage vu sans collision : traversable si fin
        const ex = rc.intersectObjects([hits[0].object], false);
        const back = new THREE.Raycaster(new THREE.Vector3(x + dx * (dm + 2.1), EYE, z + dz * (dm + 2.1)), new THREE.Vector3(-dx, 0, -dz), 0, 2.1).intersectObject(hits[0].object, false);
        const thick = back.length ? (dm + 2.1 - back[0].distance) - dm : Infinity;
        if (thick < 2) {
          const nm = nameOf(hits[0].object);
          passable.push({ x: +(x + dx * dm).toFixed(1), z: +(z + dz * dm).toFixed(1), from: [+x.toFixed(1), +z.toFixed(1)], dm: +dm.toFixed(2), dc: dc < RANGE ? +dc.toFixed(2) : null, thick: +thick.toFixed(2), mesh: nm, a: +a.toFixed(2) });
          cats[nm] = (cats[nm] || 0) + 1;
        }
      }
    }
    const group = (list, key) => { const out = []; for (const f of list) { const g = out.find((q) => Math.hypot(q.x - f.x, q.z - f.z) < 3); if (g) g.n++; else out.push({ ...f, n: 1 }); } return out.sort((a, b) => b.n - a.n); };
    return { tested, meshes: meshes.length, invisibleRaw: invisible.length, passableRaw: passable.length, invisible: group(invisible).slice(0, 80), passable: group(passable).slice(0, 120), passableByMesh: Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 30) };
  }, OPTS);
  log('rays', report.steps.rays.tested, 'rayons : invisibles', report.steps.rays.invisibleRaw, ', traversables', report.steps.rays.passableRaw);
}

// -------------------------------------------------------------------------------------------------------------------- étape zfight
if (ONLY.includes('zfight')) {
  report.steps.zfight = await page.evaluate(() => {
    const THREE = game.THREE, meshes = [];
    game.scene.traverse((m) => {
      const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible || q === game.camera) return false; return true; };
      if (!m.isMesh || m.isInstancedMesh || !vis(m) || m.userData.zombie || !m.geometry?.attributes.position) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || mat.transparent || mat.depthWrite === false) return; // verres, décalques sans écriture de profondeur : triés autrement
      m.updateMatrixWorld(true); meshes.push(m);
    });
    // tous les triangles dans le repère du monde
    const V = [], owner = [], pl = [], NRM = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    meshes.forEach((m, mi) => {
      const g = m.geometry, pos = g.attributes.position, idx = g.index, cnt = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < cnt; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
        const area2 = n.length(); if (area2 < 1e-4) continue;
        n.divideScalar(area2);
        NRM.push(n.x, n.y, n.z); // normale d'origine (vers l'avant de la face) : sert à placer la caméra du lien
        // orientation canonique de la normale (le recto et le verso d'un même plan sont comparés)
        // (dos à dos, deux faces ne se voient jamais ensemble : seules les faces de MÊME sens, ou de matériau double face, peuvent se disputer)
        let flip = 0;
        if (n.x < -1e-6 || (Math.abs(n.x) <= 1e-6 && (n.y < -1e-6 || (Math.abs(n.y) <= 1e-6 && n.z < 0)))) { n.multiplyScalar(-1); flip = 1; }
        const d = n.dot(a);
        const dbl = (Array.isArray(m.material) ? m.material[0] : m.material).side === THREE.DoubleSide ? 1 : 0;
        const key = ((((Math.round(n.x * 50) + 50) * 101 + (Math.round(n.y * 50) + 50)) * 101 + (Math.round(n.z * 50) + 50)) * 2 + (dbl ? 0 : flip)) * 400001 + Math.round(d * 100) + 200000;
        pl.push(key); owner.push(mi);
        V.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    });
    const N = pl.length, order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
    order.sort((i, j) => pl[i] - pl[j]);
    // chevauchement 2D de deux triangles coplanaires (projection sur le plan des deux axes dominants), recouvrement > 1 cm²
    const proj = (t, ax, bx) => [V[9 * t + ax], V[9 * t + bx], V[9 * t + 3 + ax], V[9 * t + 3 + bx], V[9 * t + 6 + ax], V[9 * t + 6 + bx]];
    const overlap = (A, B) => {
      for (const T of [A, B]) for (let i = 0; i < 3; i++) { // axes : normales des arêtes
        const x1 = T[2 * i], y1 = T[2 * i + 1], x2 = T[2 * ((i + 1) % 3)], y2 = T[2 * ((i + 1) % 3) + 1], ax = y1 - y2, ay = x2 - x1;
        let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
        for (let k = 0; k < 3; k++) { const pa = A[2 * k] * ax + A[2 * k + 1] * ay, pb = B[2 * k] * ax + B[2 * k + 1] * ay; amin = Math.min(amin, pa); amax = Math.max(amax, pa); bmin = Math.min(bmin, pb); bmax = Math.max(bmax, pb); }
        const l = Math.hypot(ax, ay) || 1;
        if (Math.min(amax, bmax) - Math.max(amin, bmin) < 0.02 * l) return false; // recouvrement de moins de 2 cm : séparés ou simplement contigus
      }
      return true;
    };
    // décalage de profondeur de chaque maillage (polygonOffset) : deux matériaux qui en ont de différents ne se disputent plus le pixel
    const po = meshes.map((m) => { const mt = Array.isArray(m.material) ? m.material[0] : m.material; return mt.polygonOffset ? [mt.polygonOffsetFactor, mt.polygonOffsetUnits] : [0, 0]; });
    const found = new Map(), tested = new Set(), CELL = 4;
    const bbox = (t) => { const o = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = V[9 * t + 3 * v + k]; if (x < o[k]) o[k] = x; if (x > o[3 + k]) o[3 + k] = x; } return o; };
    const pair = (t, u) => {
      const key = t < u ? t * N + u : u * N + t;
      if (tested.has(key)) return; tested.add(key);
      const pa = po[owner[t]], pb = po[owner[u]];
      if (Math.abs(pa[1] - pb[1]) >= 1 || Math.abs(pa[0] - pb[0]) >= 1) return; // départagés par polygonOffset
      const A = bbox(t), B = bbox(u);
      for (let k = 0; k < 3; k++) if (A[3 + k] < B[k] || B[3 + k] < A[k]) return;
      const e1x = V[9 * t + 3] - V[9 * t], e1y = V[9 * t + 4] - V[9 * t + 1], e1z = V[9 * t + 5] - V[9 * t + 2], e2x = V[9 * t + 6] - V[9 * t], e2y = V[9 * t + 7] - V[9 * t + 1], e2z = V[9 * t + 8] - V[9 * t + 2];
      const cx = Math.abs(e1y * e2z - e1z * e2y), cy = Math.abs(e1z * e2x - e1x * e2z), cz = Math.abs(e1x * e2y - e1y * e2x);
      const [ax, bx] = cx >= cy && cx >= cz ? [1, 2] : cy >= cz ? [0, 2] : [0, 1]; // on laisse tomber l'axe dominant de la normale
      if (!overlap(proj(t, ax, bx), proj(u, ax, bx))) return;
      const k = owner[t] < owner[u] ? `${owner[t]}|${owner[u]}` : `${owner[u]}|${owner[t]}`;
      const f = found.get(k) || { a: owner[t], b: owner[u], n: 0, x: (A[0] + A[3]) / 2, y: (A[1] + A[4]) / 2, z: (A[2] + A[5]) / 2, nx: NRM[3 * t], ny: NRM[3 * t + 1], nz: NRM[3 * t + 2] };
      f.n++; found.set(k, f);
    };
    // groupes de plans voisins (clés à moins de 1 cm l'une de l'autre) ; chaque groupe est découpé en cases de 4 m
    let i = 0;
    while (i < N) {
      let j = i + 1;
      while (j < N && pl[order[j]] - pl[order[j - 1]] <= 1) j++;
      if (j - i >= 2) {
        const o0 = owner[order[i]]; let two = false;
        for (let k = i + 1; k < j && !two; k++) if (owner[order[k]] !== o0) two = true;
        if (two) {
          const cells = new Map(), big = [];
          for (let k = i; k < j; k++) {
            const t = order[k], B = bbox(t);
            const x0 = Math.floor(B[0] / CELL), x1 = Math.floor(B[3] / CELL), y0 = Math.floor(B[1] / CELL), y1 = Math.floor(B[4] / CELL), z0 = Math.floor(B[2] / CELL), z1 = Math.floor(B[5] / CELL);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) { big.push(t); continue; }
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const ck = (x * 4096 + y) * 4096 + z; const l = cells.get(ck); if (l) l.push(t); else cells.set(ck, [t]); }
          }
          for (const l of cells.values()) for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) if (owner[l[a]] !== owner[l[b]]) pair(l[a], l[b]);
          for (const t of big) for (let k = i; k < j; k++) { const u = order[k]; if (u !== t && owner[u] !== owner[t]) pair(t, u); }
        }
      }
      i = j;
    }
    const nameOf = (m) => m.name || m.parent?.name || m.material?.name || '(sans nom)';
    const matInfo = (m) => { const mt = Array.isArray(m.material) ? m.material[0] : m.material; return `${mt.color ? '#' + mt.color.getHexString() : '-'}${mt.map ? '+map' : ''}${mt.side === 2 ? ' double' : ''}`; };
    const list = [...found.values()].sort((p, q) => q.n - p.n).slice(0, 120).map((f) => ({ x: +f.x.toFixed(1), y: +f.y.toFixed(2), z: +f.z.toFixed(1), nx: +f.nx.toFixed(2), ny: +f.ny.toFixed(2), nz: +f.nz.toFixed(2), n: f.n, a: nameOf(meshes[f.a]), b: nameOf(meshes[f.b]), matA: matInfo(meshes[f.a]) + ' po' + po[f.a], matB: matInfo(meshes[f.b]) + ' po' + po[f.b] }));
    // regroupe par zone de 6 m (un mobilier compte pour une seule entrée)
    const grouped = [];
    for (const f of list) { const g = grouped.find((q) => Math.hypot(q.x - f.x, q.z - f.z) < 6 && Math.abs(q.y - f.y) < 4); if (g) { g.n += f.n; g.pairs++; } else grouped.push({ ...f, pairs: 1 }); }
    return { meshes: meshes.length, triangles: N, pairs: found.size, top: grouped.sort((p, q) => q.n - p.n) };
  });
  log('zfight', report.steps.zfight.triangles, 'triangles,', report.steps.zfight.pairs, 'paires de maillages qui se recouvrent');
}

// ---------------------------------------------------------------------------------------------------------------------- sortie
const link = (x, z, yaw = 0, pitch = -0.1) => `${URL_}${sep}debug&x=${(+x).toFixed(1)}&z=${(+z).toFixed(1)}&yaw=${yaw}&pitch=${pitch}`;
const lines = [];
const add = (title, items, f) => { lines.push(`## ${title} (${items.length})`); for (const it of items) lines.push(f(it)); lines.push(''); };
if (report.steps.comp) add('Objets hors de la composante principale (inaccessibles à pied)', report.steps.comp.unreachable, (t) => `${t.kind} ${t.name} · ${t.zone || '?'} · (${t.x} ; ${t.z}) · ${link(t.x, t.z)}`);
if (report.steps.pockets) add('Poches-pièges', report.steps.pockets.traps, (t) => `${t.zone || '?'} · ${t.area} m² · piège en (${t.x} ; ${t.z}) · ${link(t.x, t.z)}`);
if (report.steps.bots) add('Bots bloqués / hors carte', report.steps.bots.spots, (t) => `${t.kind} · (${t.x} ; ${t.z} ; y=${t.y}) · ${t.zone || '?'} · x${t.n} · ${link(t.x, t.z)}`);
if (report.steps.rays) {
  add('Murs invisibles (collision sans maillage)', report.steps.rays.invisible, (t) => `(${t.x} ; ${t.z}) · ${t.zone || '?'} · x${t.n} · ${link(t.from[0], t.from[1], -t.a - Math.PI / 2 + 0, 0)}`);
  add('Murs traversables (maillage sans collision)', report.steps.rays.passable, (t) => `(${t.x} ; ${t.z}) · ${t.mesh} · épaisseur ${t.thick} m · x${t.n} · ${link(t.from[0], t.from[1], -t.a - Math.PI / 2, 0)}`);
}
if (report.steps.zfight) add('Z-fighting (plans coplanaires de deux maillages, même sens)', report.steps.zfight.top, (t) => {
    const h = Math.hypot(t.nx, t.nz), ux = h > 0.2 ? t.nx / h : 1, uz = h > 0.2 ? t.nz / h : 0; // direction horizontale de la face (sinon : au hasard pour un sol ou un toit)
    const cx = t.x + ux * 9, cz = t.z + uz * 9, yaw = Math.atan2(-(t.x - cx), -(t.z - cz)), pitch = Math.atan2(t.y - 1.7, 9);
    return `(${t.x} ; ${t.z}) y=${t.y} · ${t.a} / ${t.b} · ${t.n} triangles (${t.pairs} paires) · ${link(cx, cz, yaw.toFixed(3), pitch.toFixed(3))}`;
  });
fs.writeFileSync(path.join(OUT, 'liens.txt'), lines.join('\n'));
report.errors = errors;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

// carte des points chauds
const spots = [];
for (const t of report.steps.pockets?.traps || []) spots.push({ x: t.x, z: t.z, c: '#ff2020' });
for (const t of report.steps.bots?.spots || []) spots.push({ x: t.x, z: t.z, c: '#ff9a20' });
for (const t of report.steps.rays?.invisible || []) spots.push({ x: t.x, z: t.z, c: '#b020ff' });
for (const t of report.steps.rays?.passable || []) spots.push({ x: t.x, z: t.z, c: '#2090ff' });
for (const t of report.steps.zfight?.top || []) spots.push({ x: t.x, z: t.z, c: '#ffe020' });
const png = await page.evaluate((spots) => {
  const w = game.world, mv = w.mapView, cr = w.mapCrop, img = w.mapImage;
  const k = 2, sw = (cr.x1 - cr.x0) * mv.scale, sh = (cr.z1 - cr.z0) * mv.scale;
  const cv = document.createElement('canvas'); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, (cr.x0 + mv.halfX) * mv.scale, (cr.z0 + mv.halfZ) * mv.scale, sw, sh, 0, 0, cv.width, cv.height);
  const P = (x, z) => [(x - cr.x0) * mv.scale * k, (z - cr.z0) * mv.scale * k];
  for (const s of spots) { const [px, py] = P(s.x, s.z); ctx.fillStyle = s.c; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 6, 0, 6.283); ctx.fill(); ctx.stroke(); }
  return cv.toDataURL('image/png');
}, spots);
fs.writeFileSync(path.join(OUT, 'hotspots.png'), Buffer.from(png.split(',')[1], 'base64'));
log('terminé :', OUT, '· erreurs console :', errors.length);
console.log(JSON.stringify({ comp: report.steps.comp && { components: report.steps.comp.components, pockets: report.steps.comp.pockets, touching: report.steps.comp.pocketsTouching }, pockets: report.steps.pockets?.stats, pocketTraps: report.steps.pockets?.traps.length, bots: report.steps.bots && { n: report.steps.bots.bots, flagged: report.steps.bots.flagged, spots: report.steps.bots.spots.length }, invisibleWalls: report.steps.rays?.invisible.length, passableWalls: report.steps.rays?.passable.length, zfightPairs: report.steps.zfight?.pairs, errors: errors.length }));
await browser.close();
