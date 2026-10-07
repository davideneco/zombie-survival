// Régénère la documentation du jeu à partir du jeu lui-même :
//   docs/carte.png      carte annotée du secteur jouable (zones, portes, objets numérotés)
//   docs/armes.png      planche des armes vues de profil
//   docs/REFERENCE.md   fiche de référence (armes, atouts, zones, portes, manches…)
//   docs/csv/*.csv      les mêmes données en tableur, un fichier par catégorie (séparateur ;)
//
// Usage : lancer le jeu (npm run dev), puis  node tools/make-docs.mjs [url]
//         url par défaut : http://localhost:5173/   (navigateur : google-chrome-stable, ou variable CHROME)
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] || 'http://localhost:5173/';
const { CONFIG: C } = await import(path.join(ROOT, 'src/config.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const DOCS = path.join(ROOT, 'docs'), CSV = path.join(DOCS, 'csv');
fs.mkdirSync(CSV, { recursive: true });

// ------------------------------------------------------------------ Chrome headless
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zombie-docs-'));
const chrome = spawn(process.env.CHROME || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader',
  '--window-size=800,500', '--remote-debugging-port=9339', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://localhost:9339/json')).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; };
await call('Runtime.enable');
await call('Page.navigate', { url: URL });
let ready = false;
for (let i = 0; i < 150 && !ready; i++) { await sleep(1000); ready = (await evaluate('typeof window.game')) === 'object'; }
if (!ready) { chrome.kill(); throw new Error(`Le jeu ne s'est pas chargé sur ${URL} (npm run dev lancé ?)`); }

// ------------------------------------------------------------------ Données + carte (dans la page)
const pageScript = `(() => {
  const g = window.game, w = g.world, mv = w.mapView, img = w.mapImage, zn = w.zoneNames;
  const Z = (x, z) => w.zoneOf(x, z);
  const data = {
    version: document.getElementById('version').textContent,
    start: { x: Math.round(w.startPos.x), z: Math.round(w.startPos.z) },
    zones: zn.map((name, i) => ({ i, name, seed: w.zoneCenters[i] && { x: Math.round(w.zoneCenters[i].x), z: Math.round(w.zoneCenters[i].z) } })),
    stations: w.stations.map((s) => ({ zone: Z(s.x, s.z), x: Math.round(s.x), z: Math.round(s.z) })),
    walls: w.wallWeapons.map((v) => ({ id: v.id, price: v.price, ammo: v.ammoPrice, zone: Z(v.pos.x, v.pos.z), x: Math.round(v.pos.x), z: Math.round(v.pos.z) })),
    machines: w.machines.map((m) => ({ type: m.type, id: m.id || null, name: m.name, price: m.price, zone: m.zone, x: Math.round(m.pos.x), z: Math.round(m.pos.z) })),
    doors: w.doors.map((d) => ({ n: d.id + 1, price: d.price, a: d.a, b: d.b })),
  };
  // ---- image
  const cr = w.mapCrop, K = 2.6, pad = 40, top = 90, panelW = 720;
  const mapW = Math.round((cr.x1 - cr.x0) * K), mapH = Math.round((cr.z1 - cr.z0) * K);
  const cv = document.createElement('canvas');
  cv.width = pad + mapW + 30 + panelW + pad; cv.height = Math.max(top + mapH + 120, 1000);
  const x = cv.getContext('2d');
  x.fillStyle = '#0b0d10'; x.fillRect(0, 0, cv.width, cv.height);
  x.drawImage(img, (cr.x0 + mv.halfX) * mv.scale, (cr.z0 + mv.halfZ) * mv.scale, (cr.x1 - cr.x0) * mv.scale, (cr.z1 - cr.z0) * mv.scale, pad, top, mapW, mapH);
  const COLS = ['#ffd24a', '#3fd06a', '#3aa6ff', '#ff5ad0', '#ff8a2a', '#b26bff', '#5ff0e0', '#ff4545', '#c0ff4a', '#ffffff'];
  const id = x.getImageData(pad, top, mapW, mapH);
  for (let py = 0; py < mapH; py += 2) for (let px = 0; px < mapW; px += 2) {
    const zi = Z(cr.x0 + px / K, cr.z0 + py / K);
    if (zi < 0) continue;
    const c = parseInt(COLS[zi % COLS.length].slice(1), 16);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const o = ((py + dy) * mapW + px + dx) * 4;
      id.data[o] = id.data[o] * 0.5 + ((c >> 16) & 255) * 0.5; id.data[o + 1] = id.data[o + 1] * 0.5 + ((c >> 8) & 255) * 0.5; id.data[o + 2] = id.data[o + 2] * 0.5 + (c & 255) * 0.5;
    }
  }
  x.putImageData(id, pad, top);
  const P = (X, Zz) => [pad + (X - cr.x0) * K, top + (Zz - cr.z0) * K];
  const txt = (t, px, py, col = '#fff', size = 15, align = 'center', bold = true, stroke = true) => { x.font = (bold ? 'bold ' : '') + size + 'px Arial'; x.textAlign = align; if (stroke) { x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.9)'; x.strokeText(t, px, py); } x.fillStyle = col; x.fillText(t, px, py); };
  x.fillStyle = '#c8ccd0'; for (const p of w.sealedPoints) { const [a, b] = P(p.x, p.z); x.fillRect(a - 2, b - 2, 4, 4); }
  for (const d of w.doors) { x.fillStyle = '#ff2a2a'; for (const p of d.points) { const [a, b] = P(p.x, p.z); x.fillRect(a - 3, b - 3, 6, 6); } }
  // objets numérotés
  const items = [];
  for (const s of data.stations) items.push({ zone: s.zone, x: s.x, z: s.z, color: '#2a9d4a', label: 'Borne de munitions' });
  for (const v of data.walls) items.push({ zone: v.zone, x: v.x, z: v.z, color: '#d98a2b', label: 'Arme au mur : ' + v.idName + ' — ' + v.price + ' pts' , id: v.id, price: v.price });
  for (const m of data.machines) items.push({ zone: m.zone, x: m.x, z: m.z, color: m.type === 'box' ? '#3f8fd8' : m.type === 'pap' ? '#9b3fe0' : (w.machines.find((q) => q.name === m.name)?.color || '#888'), label: (m.type === 'perk' ? 'Atout : ' : '') + m.name + (m.type === 'box' ? ' (emplacement possible)' : '') + ' — ' + m.price + ' pts' });
  items.sort((a, b) => a.zone - b.zone);
  items.forEach((it, i) => { it.n = i + 1; });
  data.items = items;
  window.__items = items;
  window.__drawRest = (names) => {
    for (const it of items) if (names[it.n]) it.label = names[it.n];
    const placed = [];
    for (const it of items) {
      let [a, b] = P(it.x, it.z);
      for (let k = 0; k < 12 && placed.some(([c, d]) => Math.hypot(c - a, d - b) < 22); k++) { a += Math.cos(k * 2.1) * 14; b += Math.sin(k * 2.1) * 14; }
      placed.push([a, b]);
      x.fillStyle = it.color; x.beginPath(); x.arc(a, b, 11, 0, 7); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke();
      txt(String(it.n), a, b + 4.5, '#fff', 12, 'center', true, false);
    }
    w.doors.forEach((d) => { const p = d.points[Math.floor(d.points.length / 2)]; const [a, b] = P(p.x, p.z); x.fillStyle = 'rgba(70,0,0,0.9)'; x.fillRect(a - 30, b - 24, 60, 18); txt('P' + (d.id + 1) + ' ' + d.price, a, b - 10, '#ffd2c8', 12, 'center', true, false); });
    w.zoneCenters.forEach((c, i) => { if (!c) return; const [a, b] = P(c.x, c.z); txt(c.name.toUpperCase(), a, b - 26, COLS[i % COLS.length], 22); });
    { const [a, b] = P(w.startPos.x, w.startPos.z); x.fillStyle = '#ffd24a'; x.beginPath(); for (let k = 0; k < 10; k++) { const ang = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 6 : 14; x.lineTo(a + Math.cos(ang) * r, b + Math.sin(ang) * r); } x.closePath(); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke(); }
    // titre, nord, échelle
    txt(w.mapTitle || 'ZOMBIE SURVIVAL', pad, 48, '#ffd24a', 32, 'left');
    txt('Version ' + data.version + ' — carte générée depuis le jeu (node tools/make-docs.mjs)', pad, 74, '#999', 14, 'left', false, false);
    { const ax = pad + mapW - 30, ay = top + 40; x.fillStyle = '#fff'; x.beginPath(); x.moveTo(ax, ay - 26); x.lineTo(ax - 10, ay); x.lineTo(ax + 10, ay); x.fill(); txt('N', ax, ay + 20, '#fff', 18); }
    { const len = 50 * K, sx = pad + mapW - 30 - len, sy = top + mapH - 24; x.fillStyle = '#fff'; x.fillRect(sx, sy, len, 4); txt('50 m', sx + len / 2, sy - 8, '#fff', 13); }
    // panneau de droite
    let px = pad + mapW + 30, py = top + 4;
    txt('EMPLACEMENTS', px, py + 14, '#ffd24a', 22, 'left'); py += 40;
    zn.forEach((name, zi) => {
      const list = items.filter((i) => i.zone === zi);
      const doorsIn = w.doors.filter((d) => d.a === zi || d.b === zi).map((d) => 'P' + (d.id + 1)).join(', ');
      txt(name.toUpperCase() + (zi === w.startZone ? '  (départ)' : ''), px, py, COLS[zi % COLS.length], 17, 'left'); txt('portes : ' + doorsIn, px + 420, py, '#ff9a8a', 13, 'left', false, false); py += 22;
      for (const it of list) { x.fillStyle = it.color; x.beginPath(); x.arc(px + 11, py - 4, 10, 0, 7); x.fill(); txt(String(it.n), px + 11, py, '#fff', 11, 'center', true, false); txt(it.label, px + 28, py + 1, '#ddd', 13, 'left', false, false); py += 21; }
      py += 10;
    });
    txt('PORTES', px, py + 8, '#ffd24a', 22, 'left'); py += 32;
    for (const d of w.doors) { txt('P' + (d.id + 1) + '   ' + d.price + ' pts   ' + zn[d.a] + ' ↔ ' + zn[d.b], px, py, '#ffb3a8', 14, 'left', false, false); py += 20; }
    py += 14;
    const leg = [['#ffd24a', '★', 'Départ'], ['#ff2a2a', '■', 'Porte payante (P = numéro)'], ['#c8ccd0', '■', 'Zone fermée (reste de l’île)'], ['#c9a65a', '—', 'Passage sous immeuble']];
    for (const l of leg) { txt(l[1], px, py, l[0], 18, 'left', true, false); txt(l[2], px + 28, py, '#ddd', 14, 'left', false, false); py += 22; }
    return cv.toDataURL('image/png');
  };
  return JSON.stringify(data);
})()`;
const D = JSON.parse(await evaluate(pageScript));
const W = C.weapons;
const zname = (i) => D.zones[i]?.name ?? 'hors secteur';
// noms lisibles des objets pour le panneau de la carte
const names = {};
for (const it of D.items) if (it.id) names[it.n] = `Arme au mur : ${W[it.id].name} — ${it.price} pts`;
const png = await evaluate(`window.__drawRest(${JSON.stringify(names)})`);
fs.writeFileSync(path.join(DOCS, 'carte.png'), Buffer.from(png.split(',')[1], 'base64'));
// planche des armes vues de profil
const armsPng = await evaluate("(async()=>{try{const g=window.game,T=g.THREE,R=g.renderer,p=g.player; const C=(await import('/src/config.js')).CONFIG;\nconst ids=Object.keys(p.vms);\nconst sc=new T.Scene(); sc.background=new T.Color(0x4a505a);\nsc.add(new T.HemisphereLight(0xffffff,0x404040,2.2)); const dl=new T.DirectionalLight(0xffffff,2.5); dl.position.set(2,3,4); sc.add(dl);\nconst cam=new T.OrthographicCamera(-0.55,0.55,0.22,-0.22,0.1,10); cam.position.set(0,0,3); cam.lookAt(0,0,0);\nconst cols=4, cw=600, ch=240; const out=document.createElement('canvas'); out.width=cols*cw; out.height=Math.ceil(ids.length/cols)*ch+60; const x=out.getContext('2d');\nx.fillStyle='#0b0d10'; x.fillRect(0,0,out.width,out.height); x.font='bold 30px Impact, Arial'; x.fillStyle='#ffd24a'; x.fillText('ARMES — vue de profil',20,42);\nconst oldSize=new T.Vector2(); R.getSize(oldSize); R.setSize(cw,ch,false); R.toneMappingExposure=1.4;\nconst order=['m1911','arex','deagle','magnum','rifle','ak47','famas','scar','smg','mp5','p90','shotgun','lmg','m249','mg42','pkm','sniper','svd','barrett','raygun'].filter(i=>ids.includes(i));\norder.forEach((id,k)=>{ const src=p.vms[id]; const grp=src.clone(true); grp.visible=true; grp.position.set(0,0,0); grp.traverse(o=>{ if(o.userData.skin) o.visible=false; });\n grp.rotation.set(0,-Math.PI/2,0); const box=new T.Box3().setFromObject(grp); const c=box.getCenter(new T.Vector3()); grp.position.sub(c);\n const size=box.getSize(new T.Vector3()); const s=Math.min(0.95/Math.max(size.x,0.3), 0.38/Math.max(size.y,0.1)); grp.scale.setScalar(s); grp.position.multiplyScalar(s);\n sc.add(grp); R.render(sc,cam); sc.remove(grp);\n const ox=(k%cols)*cw, oy=60+Math.floor(k/cols)*ch; x.drawImage(R.domElement,0,0,cw,ch,ox,oy,cw,ch);\n const W=C.weapons[id]; x.font='bold 22px Arial'; x.fillStyle='#fff'; x.fillText(W.name,ox+12,oy+28); x.font='15px Arial'; x.fillStyle='#aaa'; x.fillText(`${W.caliber||''} · ${W.damage}${W.pellets?'×'+W.pellets:''} dégâts · ${W.fireRate} tirs/s · ${W.magSize} coups`,ox+12,oy+50);\n x.fillStyle='rgba(0,0,0,0.45)'; x.fillRect(ox,oy,cw,56); x.font='bold 22px Arial'; x.fillStyle='#fff'; x.fillText(W.name,ox+12,oy+28); x.font='15px Arial'; x.fillStyle='#ddd'; x.fillText(`${W.caliber||''} · ${W.damage}${W.pellets?'×'+W.pellets:''} dégâts · ${W.fireRate} tirs/s · ${W.magSize} coups`,ox+12,oy+50); x.strokeStyle='#2a2e34'; x.strokeRect(ox+0.5,oy+0.5,cw-1,ch-1); });\nR.setSize(oldSize.x,oldSize.y,false);\nreturn out.toDataURL('image/png')}catch(e){return 'ERR '+e.stack}})()\n");
fs.writeFileSync(path.join(DOCS, 'armes.png'), Buffer.from(armsPng.split(',')[1], 'base64'));
chrome.kill();

// ------------------------------------------------------------------ Tableaux
const fr = (n, d = 2) => (typeof n === 'number' ? String(+n.toFixed(d)).replace('.', ',') : n ?? '');
const where = {};
for (const v of D.walls) (where[v.id] ||= new Set()).add(`mur ${zname(v.zone)}`);
for (const id of Object.keys(C.box.pool)) (where[id] ||= new Set()).add('boîte mystère');
for (const id of C.startWeapons) (where[id] ||= new Set()).add('arme de départ');
const typeName = { auto: 'automatique', shotgun: 'pompe', semi: 'coup par coup' };
const totalW = Object.values(C.box.pool).reduce((a, b) => a + b, 0);
const P = C.player, Zc = C.zombie, S = C.sector;
const zoneOfMachine = (id) => D.machines.filter((m) => m.id === id).map((m) => zname(m.zone)).join(', ');

const T = {}; // nom -> { title, header, rows }
const table = (key, title, header, rows) => { T[key] = { title, header, rows }; };
table('01_armes', 'Armes', ['id', 'Arme', 'Catégorie', 'Calibre', 'Type', 'Dégâts par balle', 'Plombs par tir', 'Multiplicateur tête', 'Cadence (tirs/s)', 'DPS approx.', 'Chargeur', 'Réserve départ', 'Réserve max', 'Rechargement (s)', 'Dispersion', 'Portée (m)', 'Zombies traversés', 'Explosion rayon (m)', 'Explosion dégâts', 'Prix au mur (pts)', 'Prix munitions (pts)', 'Où l\'obtenir'],
  Object.values(W).map((w) => [w.id, w.name, ({ pistol: 'pistolet', ar: 'fusil d\'assaut', smg: 'pistolet-mitrailleur', mg: 'mitrailleuse', sniper: 'fusil de précision', shotgun: 'fusil à pompe', special: 'spéciale' })[w.cat] || '', w.caliber || '', typeName[w.type] || w.type, w.damage, w.pellets || 1, w.headMult, w.fireRate, w.damage * (w.pellets || 1) * w.fireRate, w.magSize, w.startReserve, w.maxReserve, w.reloadTime, fr(w.spread, 4), w.range, w.pierce || 1, w.splash?.radius ?? '', w.splash?.damage ?? '', w.price || (w.boxOnly ? 'boîte' : ''), w.ammoPrice, [...(where[w.id] || [])].join(', ')]));
table('02_pack_a_punch', 'Pack-a-Punch (' + C.papPrice + ' pts)', ['id', 'Arme', 'Nom amélioré', 'Dégâts', 'Multiplicateur tête', 'Chargeur', 'Réserve max', 'Zombies traversés', 'Prix munitions au mur (pts)'],
  Object.values(W).map((w) => [w.id, w.name, C.papNames[w.id], w.damage * (w.id === 'raygun' ? 1.6 : 2.5), w.headMult * 1.2, Math.round(w.magSize * 1.5), Math.round(w.maxReserve * 1.5), (w.pierce || 0) + 2, w.ammoPrice * 3]));
table('03_boite_mystere', 'Boîte mystère (' + C.box.price + ' pts, une seule boîte : elle change d\'emplacement après 1 à ' + C.box.maxUses + ' tirages, en donnant un nounours remboursé)', ['id', 'Arme', 'Poids', 'Chance (%)'], Object.entries(C.box.pool).map(([id, p]) => [id, W[id].name, p, (p / totalW) * 100]));
table('04_atouts', 'Atouts', ['id', 'Atout', 'Lettre', 'Effet', 'Prix (pts)', 'Prix solo (pts)', 'Zone'], Object.entries(C.perks).map(([id, p]) => [id, p.name, p.letter, p.desc, p.price, p.soloPrice ?? p.price, zoneOfMachine(id)]));
table('05_grenades', 'Grenades', ['Réglage', 'Valeur', 'Unité'], [
  ['Au départ', C.grenade.start, `(+${C.grenade.perRound} au début de la manche 1)`], ['Maximum', C.grenade.max, ''], ['Gagnées par manche', C.grenade.perRound, ''],
  ['Retardement', C.grenade.fuse, 's'], ['Rayon', C.grenade.radius, 'm'], ['Dégâts au centre', C.grenade.damage, 'PV'], ['Dégâts max aux joueurs proches', C.grenade.selfDamage, 'PV'],
  ['Chance d\'arracher les jambes (zombie survivant)', Zc.legBlowChance * 100, '%']]);
table('06_joueur', 'Joueur', ['Réglage', 'Valeur', 'Unité'], [
  ['Points au départ', P.startPoints, 'pts'], ['Santé max', P.maxHealth, 'PV (250 avec Mastodonte)'], ['Délai avant régénération', P.regenDelay, 's'], ['Régénération', P.regenRate, 'PV/s'],
  ['Vitesse de marche', P.walkSpeed, 'm/s'], ['Vitesse de sprint', P.sprintSpeed, 'm/s'], ['Vitesse de saut', P.jumpSpeed, 'm/s'], ['Temps à terre avant de mourir (coop)', 45, 's'],
  ['Temps de réanimation', 2.5, 's (1,2 avec Réanimation rapide)'], ['Armes portées', 2, '(3 avec Mule Kick)']]);
table('07_points', 'Points', ['Action', 'Points'], [['Toucher un zombie', 10], ['Tuer un zombie', 60], ['Tuer d\'un tir à la tête', 100], ['Réanimer un coéquipier', 250], ['Bonus Bombe', 400], ['Points doubles', 'x2']]);
table('08_zombies', 'Zombies', ['Réglage', 'Valeur', 'Unité'], [
  ['Dégâts par coup', Zc.damage, 'PV'], ['Délai entre deux coups', Zc.attackCooldown, 's'], ['Portée d\'attaque', Zc.attackRange, 'm'], ['Maximum en vie en même temps', Zc.maxAlive, ''],
  ['Coureurs (à partir de la manche 4)', 25, '% (vitesse x1,5)'], [`Rampants (à partir de la manche ${Zc.crawlerRound})`, Zc.crawlerChance * 100, '% (vitesse x0,45)'],
  ['Apparition par une fenêtre', 65, '%'], ['Réapparition si coincé depuis', 5, 's'], ['Réapparition si plus loin que', 90, 'm']]);
const rounds = [];
for (let r = 1; r <= 30; r++) rounds.push([r, Math.round(4 + r * 3), Math.round((4 + r * 3) * 1.75), Math.round((4 + r * 3) * 2.5), Math.round((4 + r * 3) * 3.25), r < 10 ? 70 + r * 30 : Math.round(340 * Math.pow(1.1, r - 9)), Math.min(1.6 + r * 0.2, 4.2), Math.max(0.4, 2 - r * 0.1)]);
table('09_manches', 'Manches', ['Manche', 'Zombies solo', 'Zombies 2 joueurs', 'Zombies 3 joueurs', 'Zombies 4 joueurs', 'Santé d\'un zombie', 'Vitesse de base (m/s)', 'Intervalle d\'apparition (s)'], rounds);
table('10_bonus', 'Bonus', ['Bonus', 'Effet', 'Durée (s)'], [['Munitions max', 'Réserves pleines + grenades au maximum', ''], ['Mort instantanée', 'Tout zombie touché meurt', C.powerups.buffDuration], ['Bombe', 'Tue tous les zombies, +400 pts', ''], ['Points doubles', 'Points x2', C.powerups.buffDuration], ['Bidon d\'essence', `+${String(C.vehicles.fuel.jerrican).replace('.', ',')} L pour une moto (rare : seulement si une moto est à moitié vide, voir Motos)`, ''], ['(règle) Chance de lâcher un bonus', `${C.powerups.dropChance * 100} % par zombie tué`, ''], ['(règle) Durée au sol', '', C.powerups.duration]]);
table('11_zones', 'Zones du secteur', ['Zone', 'Départ', 'Lieu (x ; z en m)', 'Portes', 'Contenu prévu (config)', 'Bornes', 'Armes au mur', 'Machines'],
  D.zones.map((z) => [z.name, z.i === D.zones.findIndex((q) => S.zones[q.i]?.start) ? 'oui' : '', z.seed ? `${z.seed.x} ; ${z.seed.z}` : '',
    D.doors.filter((d) => d.a === z.i || d.b === z.i).map((d) => `P${d.n}`).join(', '), (S.zones[z.i].items || []).join(', '),
    D.stations.filter((s) => s.zone === z.i).length, D.walls.filter((v) => v.zone === z.i).map((v) => W[v.id].name).join(', '),
    D.machines.filter((m) => m.zone === z.i).map((m) => m.name).join(', ')]));
table('12_portes', 'Portes', ['Porte', 'Prix (pts)', 'Zone A', 'Zone B'], D.doors.map((d) => [`P${d.n}`, d.price, zname(d.a), zname(d.b)]));
table('13_emplacements', 'Emplacements', ['N° sur la carte', 'Type', 'Nom', 'Zone', 'Prix (pts)', 'x (m, vers l\'est)', 'z (m, vers le sud)'],
  D.items.map((it) => [it.n, it.label.split(' : ')[0].split(' — ')[0], (it.id ? W[it.id].name : it.label.replace(/^Atout : /, '').split(' — ')[0]), zname(it.zone), it.price ?? (it.label.match(/(\d+) pts/)?.[1] ?? ''), it.x, it.z]));
const VT = C.vehicles.types, VD = C.vehicles.damage, VF = C.vehicles.fuel, VR = C.vehicles.roadkill;
const rk = (t, v) => t.roadkill.K * v * Math.min(1, 0.4 + 0.6 * (v - t.roadkill.vmin) / VR.rampSpeed);
const vcol = (f) => Object.values(VT).map(f);
const same = (x) => Object.values(VT).map((_, i) => (i ? 'idem' : x)); // règle commune aux deux motos
table('15_motos', 'Motos (parking de la place Gutenberg : un panneau bleu « P », 2 motos, une borne plein + réparation)', ['Réglage', ...Object.values(VT).map((t) => t.name), 'Unité'], [
  ['Places', ...vcol((t) => t.seats), ''], ['Points de vie', ...vcol((t) => t.hp), 'PV'], ['Vitesse max', ...vcol((t) => Math.round(t.maxSpeed * 3.6)), 'km/h'],
  ['Réservoir', ...vcol((t) => t.tank), 'L'], ['Autonomie à fond', ...vcol((t) => +(t.tank / (t.idle + t.gas + t.perSpeed) / 60).toFixed(1)), 'min'],
  ['Seuil d\'écrasement', ...vcol((t) => Math.round(t.roadkill.vmin * 3.6)), 'km/h (en dessous : aucun dégât, un zombie arrête la moto)'],
  ['Dégâts d\'écrasement au seuil / à la vitesse max', ...vcol((t) => `${Math.round(rk(t, t.roadkill.vmin))} / ${Math.round(rk(t, t.maxSpeed))}`), 'PV de zombie'],
  ['Usure par écrasement', ...same(`${VD.roadkillKill} (zombie tué) / ${VD.roadkillHurt} (survivant)`), 'PV de la moto'],
  ['Choc contre un mur', ...same(`(vitesse perdue - ${VD.crashFree}) x ${VD.crashPerMs}`), 'PV de la moto'],
  ['Coup de zombie sur un occupant', ...same(VD.zombieHit), 'PV de la moto (le joueur perd 20)'],
  ['Explosion proche (grenade, M79…)', ...same(`${VD.explosion * 100} % des dégâts infligés aux zombies`), ''],
  ['À 0 PV', ...same(`feu ${VD.burnTime} s, explosion (rayon ${VD.blast.radius} m, ${VD.blast.zombies} aux zombies, jusqu'à ${VD.blast.players} aux joueurs sans jamais les tuer), épave ${VD.wreckTime} s`), ''],
  ['Retour au parking', ...same(`${VD.respawnRounds} manches après la destruction, PV pleins, ${VF.respawn * 100} % d'essence`), ''],
  ['Borne du parking (à pied, moto à moins de ' + C.vehicles.pumpReach + ' m)', ...same(`${VF.pricePerL} pts par litre + ${VD.repairPrice} pts par PV`), 'plein + réparation'],
  ['Bidon d\'essence (bonus)', ...same(`+${String(VF.jerrican).replace('.', ',')} L, ${VF.dropChance * 100} % par zombie tué si une moto est sous ${VF.dropBelow * 100} %`), ''],
  ['Panne sèche', ...same(`réserve < ${VF.lowBelow * 100} % : bip, ratés < ${VF.missBelow * 100} %, à 0 : poussée ${VF.pushSpeed} m/s`), ''],
]);
table('14_commandes', 'Commandes', ['Touche', 'Action'], [['ZQSD / WASD', 'Se déplacer'], ['Souris', 'Viser'], ['Clic gauche', 'Tirer'], ['Clic droit', 'Viser à la mire'], ['Shift', 'Sprint'], ['Espace', 'Sauter'], ['R', 'Recharger'], ['1 / 2 / 3 / molette', 'Changer d\'arme'], ['G', 'Grenade'], ['E', 'Acheter, ouvrir une porte, utiliser une machine ou la borne des motos, réanimer (maintenir), monter / descendre d\'une moto'], ['ZQSD / WASD (en moto)', 'Accélérer, freiner / reculer, tourner'], ['Espace (en moto)', 'Frein à main'], ['V (en moto)', 'Vue à la 3e personne / à la 1re personne'], ['F', 'Lampe torche'], ['M', 'Carte'], ['Échap', 'Menu pause']]);

// ------------------------------------------------------------------ CSV (séparateur ; , virgule décimale, UTF-8 avec BOM pour Excel)
for (const f of fs.readdirSync(CSV)) if (f.endsWith('.csv')) fs.rmSync(path.join(CSV, f));
const cell = (v) => { const s = typeof v === 'number' ? fr(v) : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
for (const [key, t] of Object.entries(T)) {
  fs.writeFileSync(path.join(CSV, key + '.csv'), '﻿' + [t.header, ...t.rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n');
}

// ------------------------------------------------------------------ Markdown
const mdCell = (v) => String(typeof v === 'number' ? fr(v) : v ?? '').replace(/\|/g, '\\|');
const mdTable = (t) => `| ${t.header.join(' | ')} |\n|${t.header.map(() => '---').join('|')}|\n${t.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n')}\n`;
let md = `# Zombie Survival — fiche de référence

Version du jeu : **${D.version}** (package ${pkg.version}). Générée automatiquement par \`node tools/make-docs.mjs\` à partir de \`src/config.js\` et du jeu.
Carte annotée : [carte.png](carte.png). Armes de profil : [armes.png](armes.png). Les mêmes tableaux en tableur : dossier [csv/](csv/).

Pour demander une modification, citez la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts », « mettre la boîte mystère dans la zone Temple-Neuf »).

## Secteur jouable

Seul le secteur autour de la place du Marché-Neuf est ouvert ; le reste de la Grande Île est visible mais fermé par des barricades « ZONE FERMÉE ».
Il est découpé en ${D.zones.length} zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à ${S.maxDist} m), et les portes se trouvent entre deux zones.
Prix des portes : ${S.basePrice} pts pour une zone voisine du départ, +${S.priceStep} par zone plus loin. Le contenu de chaque zone se règle dans \`src/config.js\` → \`sector.zones[].items\`.

`;
for (const [key, t] of Object.entries(T)) md += `## ${t.title}\n\n${mdTable(t)}\n`;
md += `### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : dégâts ×2,5 (×1,6 pour le pistolet à rayons), chargeur et réserve ×1,5, tête ×1,2, +2 zombies traversés.
- **Atouts** : on les perd tous quand on tombe à terre.
`;
fs.writeFileSync(path.join(DOCS, 'REFERENCE.md'), md);
await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome écrit encore : sans importance */ }
console.log(`OK : docs/carte.png, docs/armes.png, docs/REFERENCE.md, ${Object.keys(T).length} fichiers dans docs/csv/`);
