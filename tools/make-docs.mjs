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
const { CONFIG: C, PAP_LEVELS, papStats, papAmmoMult } = await import(path.join(ROOT, 'src/config.js'));
const { createKeybinds } = await import(path.join(ROOT, 'src/keybinds.js'));
const KB0 = createKeybinds(), kn0 = (id) => KB0.nameOf(KB0.byId[id].def); // touches par défaut (CONFIG.keybinds)
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
    zones: zn.map((name, i) => ({ i, name, area: Math.round(w.zoneArea[i]), seed: w.zoneCenters[i] && { x: Math.round(w.zoneCenters[i].x), z: Math.round(w.zoneCenters[i].z) } })),
    stations: w.stations.map((s) => ({ zone: Z(s.x, s.z), x: Math.round(s.x), z: Math.round(s.z) })),
    walls: w.wallWeapons.map((v) => ({ id: v.id, price: v.price, ammo: v.ammoPrice, zone: Z(v.pos.x, v.pos.z), x: Math.round(v.pos.x), z: Math.round(v.pos.z) })),
    machines: w.machines.map((m) => ({ type: m.type, id: m.id || null, name: m.name, price: m.price, zone: m.zone, x: Math.round(m.pos.x), z: Math.round(m.pos.z) })),
    doors: w.doors.map((d) => ({ n: d.id + 1, price: d.price, a: d.a, b: d.b })),
  };
  // ---- image
  // toute la Grande Île : échelle réduite pour que la carte reste à ~2000 px ; le panneau de droite a deux colonnes (emplacements | portes)
  const cr = w.mapCrop, K = Math.min(2.6, 2000 / (cr.x1 - cr.x0)), pad = 40, top = 90, colW = 560, panelW = colW * 2 + 20;
  const mapW = Math.round((cr.x1 - cr.x0) * K), mapH = Math.round((cr.z1 - cr.z0) * K);
  const cv = document.createElement('canvas');
  const nItems = data.stations.length + data.walls.length + data.machines.length;
  const doorRows = Math.ceil(w.doors.length / 3);
  cv.width = pad + mapW + 30 + panelW + pad; cv.height = Math.max(top + mapH + 50 + 40 + doorRows * 20 + 120, top + 80 + (zn.length * 32 + nItems * 21) / 2 + 260);
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
    w.zoneCenters.forEach((c, i) => { if (!c) return; const [a, b] = P(c.x, c.z); txt(c.name.toUpperCase(), a, b - 26, COLS[i % COLS.length], 18); });
    { const [a, b] = P(w.startPos.x, w.startPos.z); x.fillStyle = '#ffd24a'; x.beginPath(); for (let k = 0; k < 10; k++) { const ang = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 6 : 14; x.lineTo(a + Math.cos(ang) * r, b + Math.sin(ang) * r); } x.closePath(); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke(); }
    // titre, nord, échelle
    txt(w.mapTitle || 'ZOMBIE SURVIVAL', pad, 48, '#ffd24a', 32, 'left');
    txt('Version ' + data.version + ' — carte générée depuis le jeu (node tools/make-docs.mjs)', pad, 74, '#999', 14, 'left', false, false);
    { const ax = pad + mapW - 30, ay = top + 40; x.fillStyle = '#fff'; x.beginPath(); x.moveTo(ax, ay - 26); x.lineTo(ax - 10, ay); x.lineTo(ax + 10, ay); x.fill(); txt('N', ax, ay + 20, '#fff', 18); }
    { const len = 50 * K, sx = pad + mapW - 30 - len, sy = top + mapH - 24; x.fillStyle = '#fff'; x.fillRect(sx, sy, len, 4); txt('50 m', sx + len / 2, sy - 8, '#fff', 13); }
    // panneau de droite : les emplacements, en deux colonnes (la moitié des zones chacune)
    let px = pad + mapW + 30, py = top + 4;
    txt('EMPLACEMENTS', px, py + 14, '#ffd24a', 22, 'left'); py += 40;
    const colTop = py;
    zn.forEach((name, zi) => {
      if (zi === Math.ceil(zn.length / 2)) { px += colW + 20; py = colTop; }
      const list = items.filter((i) => i.zone === zi);
      txt(name.toUpperCase() + (zi === w.startZone ? '  (départ)' : ''), px, py, COLS[zi % COLS.length], 17, 'left'); py += 22;
      for (const it of list) { x.fillStyle = it.color; x.beginPath(); x.arc(px + 11, py - 4, 10, 0, 7); x.fill(); txt(String(it.n), px + 11, py, '#fff', 11, 'center', true, false); txt(it.label, px + 28, py + 1, '#ddd', 13, 'left', false, false); py += 21; }
      py += 10;
    });
    // les portes sous la carte, en trois colonnes, puis la légende
    px = pad; py = top + mapH + 50;
    txt('PORTES', px, py, '#ffd24a', 22, 'left'); py += 28;
    const rows = Math.ceil(w.doors.length / 3), py0 = py;
    w.doors.forEach((d, k) => { txt('P' + (d.id + 1) + '   ' + d.price + ' pts   ' + zn[d.a] + ' ↔ ' + zn[d.b], px + Math.floor(k / rows) * 640, py0 + (k % rows) * 20, '#ffb3a8', 14, 'left', false, false); });
    py = py0 + rows * 20 + 30;
    const leg = [['#ffd24a', '★', 'Départ'], ['#ff2a2a', '■', 'Porte payante (P = numéro)'], ['#c9a65a', '—', 'Passage sous immeuble']];
    leg.forEach((l, k) => { txt(l[1], px + k * 360, py, l[0], 18, 'left', true, false); txt(l[2], px + k * 360 + 28, py, '#ddd', 14, 'left', false, false); });
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

// Effets propres à une arme améliorée (colonne « Particularités »)
const papExtras = (w, s) => [
  s.zoom && `viseur ACOG (zoom ${s.zoom}°)`, w.cat === 'mg' && s.pap === 3 && 'canon lourd : cadence x1,15', s.ether && `Éther : ${s.ether.chance * 100} % des touches, explosion ${s.ether.radius} m à ${s.ether.frac * 100} % des dégâts`,
  s.gl && `lance-grenades sous canon : ${s.gl.shells} obus 40 mm (clic molette)`, s.boom && `balles explosives : explosion ${s.boom.radius} m à ${s.boom.frac * 100} % des dégâts`,
  w.cat === 'shotgun' && `choke (dispersion x0,8)${s.pellets !== w.pellets ? ' ; souffle du dragon : ' + s.pellets + ' plombs' : ''}`,
  w.type === 'launcher' && `explosion rayon ${fr(s.blast.radius)} m, ${fr(s.blast.damage, 0)} dégâts`, w.splash && `explosion à l'impact rayon ${fr(s.splash.radius)} m, ${fr(s.splash.damage, 0)} dégâts`,
  w.papSplash && `carreau ${s.pap === 3 ? 'à fragmentation' : 'explosif'} : rayon ${fr(s.splash.radius)} m, ${fr(s.splash.damage, 0)} dégâts`,
].filter(Boolean).join(' ; ');
const T = {}; // nom -> { title, header, rows }
const table = (key, title, header, rows) => { T[key] = { title, header, rows }; };
table('01_armes', 'Armes', ['id', 'Arme', 'Catégorie', 'Calibre', 'Type', 'Dégâts par balle', 'Plombs par tir', 'Multiplicateur tête', 'Cadence (tirs/s)', 'DPS approx.', 'Chargeur', 'Réserve départ', 'Réserve max', 'Rechargement (s)', 'Dispersion', 'Portée (m)', 'Zombies traversés', 'Explosion rayon (m)', 'Explosion dégâts', 'Prix au mur (pts)', 'Prix munitions (pts)', 'Où l\'obtenir'],
  Object.values(W).map((w) => [w.id, w.name, ({ pistol: 'pistolet', ar: 'fusil d\'assaut', smg: 'pistolet-mitrailleur', mg: 'mitrailleuse', sniper: 'fusil de précision', shotgun: 'fusil à pompe', special: 'spéciale' })[w.cat] || '', w.caliber || '', typeName[w.type] || w.type, w.damage, w.pellets || 1, w.headMult, w.fireRate, w.damage * (w.pellets || 1) * w.fireRate, w.magSize, w.startReserve, w.maxReserve, w.reloadTime, fr(w.spread, 4), w.range, w.pierce || 1, w.splash?.radius ?? '', w.splash?.damage ?? '', w.price || (w.boxOnly ? 'boîte' : ''), w.ammoPrice, [...(where[w.id] || [])].join(', ')]));
table('02_pack_a_punch', 'Pack-a-Punch (3 niveaux : ' + PAP_LEVELS.slice(1).map((l) => l.roman + ' ' + l.price + ' pts').join(', ') + ')', ['id', 'Arme', 'Niveau', 'Nom amélioré', 'Prix du niveau (pts)', 'Dégâts', 'Multiplicateur tête', 'Chargeur', 'Réserve max', 'Zombies traversés', 'Rechargement (s)', 'Dispersion', 'Prix munitions au mur (pts)', 'Particularités'],
  Object.values(W).flatMap((w) => [1, 2, 3].map((lv) => {
    const s = { ...w, ...papStats(w, lv) };
    return [w.id, w.name, PAP_LEVELS[lv].roman, s.name, PAP_LEVELS[lv].price, s.damage, s.headMult, s.magSize, s.maxReserve, s.pierce, s.reloadTime, fr(s.spread, 4), w.ammoPrice * papAmmoMult(lv), papExtras(w, s)];
  })));
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
  ['Apparition par une fenêtre', 65, '%'], ['Réapparition si coincé depuis', 5, 's'], ['Réapparition si plus loin que', 90, 'm'],
  [`Chevaliers de fer (zone ${Zc.ironKnight.zone}, à partir de la manche ${Zc.ironKnight.fromRound})`, Zc.ironKnight.chance * 100, `% (${Zc.ironKnight.maxAlive} en vie au plus, santé x${String(Zc.ironKnight.healthMult).replace('.', ',')}, armure)`],
  [`Pestiférés (zones ${Zc.pestilent.zones.join(', ')}, à partir de la manche ${Zc.pestilent.fromRound})`, Zc.pestilent.chance * 100, `% (${Zc.pestilent.maxAlive} en vie au plus, santé x${String(Zc.pestilent.healthMult).replace('.', ',')}, explosent à leur mort : 38 PV au plus à moins de 4,2 m, le PHD Flopper les ignore)`],
  ['Poursuite : champ de chemin calculé jusqu\'à', Zc.flow.range, 'm de marche autour des joueurs (au-delà : tout droit)'],
  ['Coop : joueur ciblé par l\'apparition', `poids 1 / (1 + n), n = zombies à moins de ${Zc.spawnBalance.radius} m`, ''], ['Coop : un client dessine les zombies à moins de', Zc.drawRange, 'm']]);
const rounds = [];
for (let r = 1; r <= 30; r++) rounds.push([r, Math.round(4 + r * 3), Math.round((4 + r * 3) * 1.75), Math.round((4 + r * 3) * 2.5), Math.round((4 + r * 3) * 3.25), r < 10 ? 70 + r * 30 : Math.round(340 * Math.pow(1.1, r - 9)), Math.min(1.6 + r * 0.2, 4.2), Math.max(0.4, 2 - r * 0.1)]);
table('09_manches', 'Manches', ['Manche', 'Zombies solo', 'Zombies 2 joueurs', 'Zombies 3 joueurs', 'Zombies 4 joueurs', 'Santé d\'un zombie', 'Vitesse de base (m/s)', 'Intervalle d\'apparition (s)'], rounds);
table('10_bonus', 'Bonus', ['Bonus', 'Effet', 'Durée (s)'], [['Munitions max', 'Réserves pleines + grenades au maximum', ''], ['Mort instantanée', 'Tout zombie touché meurt', C.powerups.buffDuration], ['Bombe', 'Tue tous les zombies, +400 pts', ''], ['Points doubles', 'Points x2', C.powerups.buffDuration], ['Bidon d\'essence', `+${String(C.vehicles.fuel.jerrican).replace('.', ',')} L pour une moto (rare : seulement si une moto est à moitié vide, voir Motos)`, ''], ['(règle) Chance de lâcher un bonus', `${C.powerups.dropChance * 100} % par zombie tué`, ''], ['(règle) Bonus d\'ouverture', `${C.powerups.openingBonus.map((t) => ({ max_ammo: 'Munitions max', double_points: 'Points doubles' })[t] || t).join(' ou ')} à la première ouverture d'une zone extérieure`, ''], ['(règle) Durée au sol', '', C.powerups.duration]]);
table('11_zones', 'Zones de la Grande Île', ['Zone', 'Départ', 'Type', 'Surface (m²)', 'Prix de la porte (pts)', 'Lieu (x ; z en m)', 'Portes', 'Contenu prévu (config)', 'Bornes', 'Armes au mur', 'Machines'],
  D.zones.map((z) => [z.name, z.i === D.zones.findIndex((q) => S.zones[q.i]?.start) ? 'oui' : '', S.zones[z.i].outer ? 'extérieure' : 'secteur d\'origine', z.area, S.zones[z.i].start ? 0 : S.zones[z.i].doorPrice ?? '', z.seed ? `${z.seed.x} ; ${z.seed.z}` : '',
    D.doors.filter((d) => d.a === z.i || d.b === z.i).map((d) => `P${d.n}`).join(', '), (S.zones[z.i].items || []).join(', '),
    D.stations.filter((s) => s.zone === z.i).length, D.walls.filter((v) => v.zone === z.i).map((v) => W[v.id].name).join(', '),
    D.machines.filter((m) => m.zone === z.i).map((m) => m.name).join(', ')]));
table('12_portes', 'Portes', ['Porte', 'Prix (pts)', 'Zone A', 'Zone B'], D.doors.map((d) => [`P${d.n}`, d.price, zname(d.a), zname(d.b)]));
table('13_emplacements', 'Emplacements', ['N° sur la carte', 'Type', 'Nom', 'Zone', 'Prix (pts)', 'x (m, vers l\'est)', 'z (m, vers le sud)'],
  D.items.map((it) => [it.n, it.label.split(' : ')[0].split(' — ')[0], (it.id ? W[it.id].name : it.label.replace(/^Atout : /, '').split(' — ')[0]), zname(it.zone), it.price ?? (it.label.match(/(\d+) pts/)?.[1] ?? ''), it.x, it.z]));
const Fn = C.finale;
table('16_finale', 'Fin de partie : L\'Heure du Jugement (horloge astronomique, intérieur de la cathédrale)', ['Réglage', 'Valeur', 'Unité'], [
  ['Manche minimale', Fn.minRound, ''], ['Zones ouvertes au moins', Fn.minZones, `(les ${D.zones.filter((z) => !S.zones[z.i].outer).length} zones d'origine + ${Fn.minZones - D.zones.filter((z) => !S.zones[z.i].outer).length} zones extérieures) : l'horloge affiche « n/${Fn.minZones} quartiers ouverts »`],
  ['Prix', Fn.price, 'pts'], ['Santé du Bourreau (1 joueur)', Fn.bossHealth, '(+70 % par joueur en plus)'], ['Zombies simultanés (vague)', Fn.maxAlive, ''], ['Répit entre deux vagues', Fn.breather, 's']]);
const zhp = (r) => (r < C.zombie.health.softRound ? C.zombie.health.base + r * C.zombie.health.perRound : Math.round(C.zombie.health.hardBase * Math.pow(C.zombie.health.hardGrowth, r - C.zombie.health.softRound + 1)));
const FB = Fn.boss, pc = (x) => `${Math.round(x * 100)} %`, f1 = (x) => String(x).replace('.', ',');
table('16b_bourreau', 'Le Bourreau : phases, attaques et sensibilités', ['Réglage', 'Valeur', 'Remarque'], [
  ['Phases', `I (100 -> ${pc(FB.thresholds[0])}) ${FB.names[0]} · II (${pc(FB.thresholds[0])} -> ${pc(FB.thresholds[1])}) ${FB.names[1]} · III (${pc(FB.thresholds[1])} -> ${pc(FB.thresholds[2])}) ${FB.names[2]} · IV (${pc(FB.thresholds[2])} -> 0) ${FB.names[3]}`, 'barre de vie coupée à chaque seuil ; invulnérable pendant les transitions (barre grise « INVULNÉRABLE »)'],
  ['Vitesse par phase', FB.speed.map((v) => f1(v)).join(' / '), 'm/s'],
  ['Coups de base', `hache ${Fn.bossDamage}, ruée ${Fn.chargeDamage}, onde de choc ${Fn.slamDamage}`, 'ruée annoncée 1,15 s ; on évite l\'onde en sautant'],
  ['Sensibilités', `face (tête comprise) x${f1(FB.sens.front)} · dos (lanterne-cœur) x${FB.sens.back} (x${f1(FB.sens.backSentence)} pour les joueurs que la Sentence ne vise pas) · zone x${f1(FB.sens.zone)} · pistolet à rayons (tir direct) x${f1(FB.sens.ray)} · étourdi x${f1(FB.sens.stun)}`, `le dos : produit scalaire (direction du boss vers le point d'impact, cap du boss) < ${f1(FB.sens.backCos)}`],
  ['Chaînes (toutes phases)', `annoncées ${f1(FB.chain.tel)} s, ${FB.chain.damage} dégâts, attirent de ${FB.chain.pull} m`, `recharge ${FB.cd.chain[0]} s ; portée ${FB.chain.minDist} à ${FB.chain.maxDist} m`],
  ['Le Glas (transition 70 %)', `${FB.glas.invuln} s d'invulnérabilité, ${FB.glas.waves} ondes à ${f1(FB.glas.interval)} s, ${FB.glas.damage} dégâts chacune`, `${FB.glas.knights} chevaliers de fer + ${FB.glas.zombies} zombies (+${FB.glas.perPlayer} par joueur en plus) ; phase IV : Glas toutes les ${FB.cd.toll[3]} s, sans invulnérabilité`],
  ['La Sentence (phase II)', `joueur marqué ${FB.sentence.duration} s (couronne rouge), dégâts reçus x${f1(FB.sentence.mult)}`, `le Bourreau ne poursuit que lui, à ${f1(FB.sentence.speed)} m/s ; renforts toutes les ${FB.cd.summon[1]} s ; bond vers la tour à ${pc(FB.thresholds[1])}`],
  ['Le Couperet (phase III)', `hache lancée aller-retour, annoncée ${f1(FB.couperet.tel)} s, ${FB.couperet.damage} dégâts, couloir ${f1(FB.couperet.width)} x ${FB.couperet.length} m`, `ruée toutes les ${FB.cd.charge[2]} s`],
  ['Le Bûcher (phase IV)', `${FB.pyre.circles} cercles de feu (+${FB.pyre.perPlayer} par joueur en plus), rayon ${f1(FB.pyre.radius)} m, annoncés ${f1(FB.pyre.tel)} s, ${FB.pyre.dps} dégâts/s pendant ${FB.pyre.duration} s`, `rage : vitesse ${f1(FB.speed[3])} m/s ; après ${FB.enrageAfter / 60} min de combat, tous ses coups x${f1(FB.enrageMult)}`],
  ['Récompense', `${FB.reward.points} points + Hache du Bourreau (remplace le couteau : dégâts x${C.knife.axe.dmgMult}, touche ${1 + C.knife.axe.extra} zombies)`, 'Max Munitions lâché à sa mort']]);
const TN = C.tanner;
table('19_maitre_tanneur', 'Maître Tanneur (mini-boss : Petite France ou Saint-Pierre-le-Vieux)', ['Réglage', 'Valeur', 'Remarque'], [
  ['Apparition', `manches ${TN.fromRound}, ${TN.fromRound + TN.every}, ${TN.fromRound + 2 * TN.every}… (toutes les ${TN.every})`, `si l'une des zones ${TN.zones.join(' / ')} est ouverte`],
  ['Santé', `${TN.healthMult} x la santé d'un zombie de la manche (${Math.round(TN.healthMult * zhp(TN.fromRound))} à la manche ${TN.fromRound})`, `+${pc(TN.perPlayer)} par joueur en plus`],
  ['Vitesse / coup', `${f1(TN.speed)} m/s / ${TN.damage}`, ''],
  ['Vomi', `cône de ${TN.vomit.range} m (demi-angle ${TN.vomit.angle}°), annoncé ${f1(TN.vomit.tel)} s : ${TN.vomit.initial} dégâts puis ${TN.vomit.dps}/s pendant ${TN.vomit.duration} s`, 'le PHD Flopper ne protège pas ; recharge ' + TN.vomit.cooldown + ' s'],
  ['Appel', `${TN.summon.count} pestiférés`, `recharge ${TN.summon.cooldown} s`],
  ['À sa mort', `explosion de rayon ${TN.explosion.radius} m : ${TN.explosion.damage} dégâts`, 'le PHD Flopper protège'],
  ['Récompense', `Max Munitions + ${TN.reward.points} points par joueur`, '']]);
const SM = C.summit, SA = SM.angel, SG = SM.gargoyles, SR = SM.ramp;
table('20_acte_v_aube', 'Acte V « L\'Aube » (après la victoire sur le Bourreau : montée de la flèche, Fanal d\'Erwin)', ['Étape', 'Valeur', 'Remarque'], [
  ['Ascension', 'faisceau de lumière depuis la pointe : plateforme 67,5 m -> escalier 3 tours -> terrasse 104 m -> rampe 6 tours -> pointe 128 m', 'texte : « La flèche s\'illumine : montez allumer le Fanal d\'Erwin » ; les manches sont suspendues pendant tout l\'acte'],
  ['1. Gargouilles (terrasse)', `${SG.count} zombies de pierre (+${SG.perPlayer} par joueur en plus), ${SG.maxAlive} simultanées, une toutes les ${f1(SG.interval)} s`, `coureurs (vitesse x${f1(SG.speed)}, vie x${f1(C.finale.kindHealth.gargoyle)}, armure x0,8) qui surgissent des parapets à plus de ${SG.minDist} m des joueurs (${f1(SG.appear)} s d'apparition)`],
  ['2. L\'Ange du Jugement', `${SA.health} PV (+${pc(SA.perPlayer)} par joueur en plus) ; tourne hors de la tour, cercle de ${SA.radius} m à ${SA.height} m, ${SA.omega}°/s`, `point faible : la trompette (x${SA.weak}, quelle que soit l'arme) ; récompense ${SA.reward} points par joueur`],
  ['Trompette', `cône de ${SA.trumpet.range} m (demi-angle ${SA.trumpet.angle}°), annoncé ${f1(SA.trumpet.tel)} s, ${SA.trumpet.damage} dégâts`, `recharge ${SA.trumpet.cooldown} s ; la flèche protège`],
  ['Plumes', `éventail de ${SA.plumes.count} plumes (${SA.plumes.spread}° d'écart), annoncé ${f1(SA.plumes.tel)} s, ${SA.plumes.damage} dégâts chacune`, `recharge ${SA.plumes.cooldown} s ; arrêtées par la flèche`],
  ['Jugement', `un joueur est marqué ${SA.judgment.tel} s puis frappé d'un rayon : ${SA.judgment.damage} dégâts`, `dès ${pc(SA.judgment.fromHealth)} de vie ; recharge ${SA.judgment.cooldown} s ; on se cache derrière la flèche`],
  ['3. La rampe', `rafale toutes les ${SR.interval} s : poussée de ${f1(SR.push)} m/s pendant ${SR.duration} s (annoncée 0,8 s)`, `les garde-corps et la paroi retiennent ; ${SR.gargoyles.count} gargouilles montent toutes les ${SR.gargoyles.every} s (${SR.gargoyles.maxAlive} au plus)`],
  ['4. Le Fanal d\'Erwin', `chaque joueur debout maintient la touche d'interaction ${SM.fanal.hold} s à moins de ${f1(SM.fanal.range)} m`, `jauge commune : avance de (joueurs qui tiennent / joueurs debout) x 1/${SM.fanal.hold} par seconde, retombe quand personne ne tient`],
  ['5. L\'Aube', `ciel : nuit -> jour en ${SM.dawn.sky} s (fond, brouillard, lumières) ; tous les zombies en cendres ; vue orbitale ${SM.dawn.orbit} s (Échap la passe) ; écran « STRASBOURG LIBÉRÉE » et statistiques`, 'aucun nouveau shader'],
  ['Récompenses', 'Bénédiction de l\'Aube : les 7 atouts, gardés même à terre ; toutes les portes restantes gratuites ; trophée enregistré localement (localStorage)', 'les joueurs à terre sont relevés'],
  ['Nuit éternelle', `le jour dure ${SM.eternal.day} s, puis la nuit retombe en ${SM.eternal.dusk} s ; zombies x${f1(SM.eternal.healthMult)} de vie dès la manche suivante`, 'les manches reprennent sans fin']]);
// ---- tram (v0.38.0 : réseau de voies ; la rame conduisible est décrite plus bas)
const { buildTracks } = await import(path.join(ROOT, 'src/tramTrack.js'));
const TR = C.tram, TNET = buildTracks(TR);
const stopS = (t) => t.def.stops.map((st) => `${st.name} (${Math.round(t.project(st.at[0], st.at[1], 80, {}).s)} m)`).join(' · ');
table('21_tram', 'Tram : réseau de voies (rails, quais, poteaux de caténaire, heurtoirs ; tracés à la main dans CONFIG.tram.lines)', ['Ligne', 'Longueur', 'Arrêts (abscisse depuis le heurtoir de départ)', 'Remarque'], [
  ...TNET.tracks.map((t) => [`${t.name} (${t.id})`, `${Math.round(t.L)} m`, stopS(t), `rayon de courbure minimal ${Math.round(t.minRadius(0, t.L))} m ; un heurtoir à chaque bout`]),
  ['Largeur libre', `${fr(TR.clearHalf * 2)} m`, 'de part et d\'autre de l\'axe, vérifiée sur la grille de navigation', `décor (voitures, barricades) à ${TR.decorGap} m de l'axe au moins ; arbres et lampadaires écartés du couloir`],
  ['Portes de zone', 'feu rouge', 'une porte fermée qui coupe une voie est un heurtoir signalé par un feu (vert une fois ouverte)', `la rame freine d'elle-même à ${TR.gate.signalDist} m ; l'ouvrir libère le tronçon`],
  ['Rendu', 'rails : 1 appel (InstancedMesh)', 'quais + heurtoirs + mâts : 1 appel ; poteaux : 1 appel ; fils + feux : 1 appel', `${TR.pole.every} m entre deux poteaux, côtés alternés`]]);
// ---- tram : la rame conduisible (v0.39.0)
const TC = TR.car, TD = TR.drive, TH = TR.hit, kmh = (v) => Math.round(v * 3.6), fr2 = (n) => String(n).replace('.', ',');
table('22_tram_rame', 'Tram : la rame conduisible (une seule, garée au quai « Homme de Fer » de la ligne B / C / F ; les rames de décor ne roulent pas)', ['Réglage', 'Valeur', 'Remarque'], [
  ['Rame', `${TC.modules} modules de ${fr2(TC.module)} m (${fr2(TC.modules * TC.module)} m), ${fr2(TC.width)} x ${fr2(TC.height)} m, plancher à ${fr2(TC.floor)} m`, `articulés : chaque module suit la voie ; cabine à chaque bout ; ${TC.doors} portes de ${fr2(TC.doorWidth)} m par côté`],
  ['Places', `16 : 2 de conducteur (une par cabine) + ${2 * TC.perSide} de passagers assis`, 'les passagers tirent normalement (comme sur la grosse moto) ; portes fermées, la place de conducteur se prend près d\'un bout de la rame, les autres près de la caisse (voir l\'intérieur praticable ci-dessous)'],
  ['Montée / descente', `${kn0('interact')} ou marcher contre une porte ouverte (rame à moins de ${fr2(TD.boardSpeed)} m/s)`, 'à pied par les portes ouvertes ; assis, on se lève dans la rame ; descendre en marche est refusé'],
  ['Conduite', `${kn0('forward')} accélérer · ${kn0('back')} frein de service (puis marche arrière) · ${kn0('jump')} frein d'urgence`, `touches modifiables dans Options > Touches ; conducteur de la cabine arrière : la rame roule dans l'autre sens`],
  ['Vitesse max', `${TD.maxSpeed} m/s (${kmh(TD.maxSpeed)} km/h) ; marche arrière ${TD.reverse} m/s`, `accélération ${fr2(TD.accel)} m/s² (qui faiblit près du maximum), résistance ${fr2(TD.drag)} m/s²`],
  ['Freinage', `service ${fr2(TD.brake)} m/s² · urgence ${TD.emergency} m/s²`, ''],
  ['Virages', `vitesse plafonnée à racine(${fr2(TD.grip)} x R) m/s (R = 25 m : ${kmh(Math.sqrt(TD.grip * 25))} km/h) avec une alarme`, `la rame freine d'elle-même (${fr2(TD.autoBrake)} m/s²) en regardant ${TD.lookAhead} m devant ; pas de déraillement`],
  ['Portes de zone fermées, heurtoirs', `freinage automatique à ${TR.gate.signalDist} m ou plus tôt si la vitesse l'exige (urgence ${TD.emergency} m/s²), arrêt à ${fr2(TR.gate.stopGap)} m de la porte`, 'ouvrir la porte libère le tronçon ; le nez s\'arrête à 1,2 m du heurtoir'],
  ['Portes de la rame', `${kn0('tramDoors')} (conducteur) à moins de ${fr2(TD.doorSpeed)} m/s, ${fr2(TD.doorTime)} s, carillon`, 'pas de traction portes ouvertes ; elles se referment si la rame roule'],
  ['Énergie', `sous-station de l'Homme de Fer : ${TR.power.price} pts, une seule fois pour toute l'équipe`, `${kn0('interact')} près du kiosque jaune ; ensuite la conduite est gratuite ; sans courant, la rame ne démarre pas`],
  ['Gong', `${kn0('tramGong')} (tout occupant) : zombies à moins de ${TR.gong.range} m attirés pendant ${TR.gong.duration} s`, `recharge ${TR.gong.cooldown} s ; ils prennent la rame pour cible du champ de flux (sauf s'ils sont déjà sur un joueur)`],
  ['Caméra', `${kn0('vehicleView')} : 3e personne (bras ${TC.camArm} m) / 1re personne dans la cabine`, 'même vue que pour les motos'],
  ['PV', `${TR.hp}`, `coup de zombie sur la caisse : ${TR.zombieHit} PV ; passagers touchés seulement devant une porte ouverte ; à 0 PV : hors service, retour au dépôt ${TR.power.respawnRounds} manches plus tard`],
  ['Joueur à pied heurté', `repoussé ; ${TH.playerDamage} dégâts au-dessus de ${TH.playerSpeed} m/s`, 'jamais mortel (il reste 1 PV)'],
  ['Zombie heurté', `au-dessus de ${TH.zombieSpeed} m/s : ${TH.zombieK} x vitesse (${TH.zombieK * TD.maxSpeed} à la vitesse max) ; en dessous : aucun dégât, il bloque la rame`, `la rame ne ralentit pas ; un coup toutes les ${TH.zombieCooldown} s au même zombie`],
  ['Obstacles', 'une boîte orientée par module, obstacles dynamiques de Collision (setDynamic)', 'les joueurs à pied, les zombies et les motos sont repoussés ; les balles traversent']]);
// ---- tram : l'intérieur praticable (v0.40.0)
const TW = TR.walk;
table('23_tram_interieur', 'Tram : l\'intérieur praticable (on marche dans la rame, même quand elle roule)', ['Réglage', 'Valeur', 'Remarque'], [
  ['Repère de la rame', 'u le long de la rame (+ vers l\'avant), w à droite, y hauteur des pieds', `le joueur debout est un point (u, w) de la voie à l'abscisse s + u : il suit la rame sans glisser, modules articulés compris ; réseau : p_state porte vh (identifiant de la rame), lx = w, ly = y, lz = -u, lyw (cap relatif)`],
  ['Collision locale', `cercle de ${fr2(TW.radius)} m contre des boîtes (sièges, pupitres, bouts, parois à ${fr2(TW.wall)} m de l'axe)`, `allée entre les banquettes étroite ; plancher à ${fr2(TC.floor)} m ; pas de saut ni d'enjambement dans la rame`],
  ['Monter à pied', `rame à moins de ${fr2(TD.boardSpeed)} m/s, portes ouvertes à plus de ${Math.round(TW.doorOpen * 100)} %`, `pousser contre une porte ouverte (à moins de ${fr2(TW.boardW)} m de l'axe) ou ${kn0('interact')} à moins de ${fr2(TW.boardReach)} m d'une porte`],
  ['Descendre à pied', `dépasser ${fr2(TW.exitW)} m de l'axe dans une ouverture`, 'refusé tant que la rame roule (message « TRAM EN MARCHE ») ; les portes ne s\'ouvrent qu\'à l\'arrêt'],
  ['S\'asseoir / se lever', `${kn0('interact')} à moins de ${fr2(TW.seatReach)} m d'un siège libre ; ${kn0('interact')} assis : on se lève dans la rame`, 'conducteur ou passager ; les coéquipiers voient l\'avatar assis ou debout'],
  ['Portes (touche)', `${kn0('tramDoors')} : conducteur ; sinon, quand personne ne conduit, n'importe quel occupant (via l'hôte)`, `${kn0('tramGong')} : gong depuis l'intérieur aussi`],
  ['Zombies', 'ne rentrent pas dans la rame et ne la traversent pas', `une porte ouverte les attire (ils se massent devant, à ${fr2(TW.doorSpot)} m de la caisse) ; ils frappent le joueur à moins de 1,3 m ; ailleurs la caisse encaisse (${TR.zombieHit} PV)`],
  ['Tir, grenades, couteau, réanimation', 'comme à pied', 'la grenade garde la vitesse de la rame, ignore la caisse et rebondit sur le plancher ; pas de fente du couteau'],
  ['Menu debug (F9), déblocage', `F9 : l'hôte rejoint un coéquipier debout dans la rame (repère local) ; ${kn0('unstick')} : replace dans l'allée`, 'un joueur téléporté sort de la rame']]);
const VT = C.vehicles.types, VD = C.vehicles.damage, VF = C.vehicles.fuel, VR = C.vehicles.roadkill;
const rk = (t, v) => t.roadkill.K * v * Math.min(1, 0.4 + 0.6 * (v - t.roadkill.vmin) / VR.rampSpeed);
const vcol = (f) => Object.values(VT).map(f);
const same = (x) => Object.values(VT).map((_, i) => (i ? 'idem' : x)); // règle commune aux deux motos
table('15_motos', 'Motos (deux parkings au panneau bleu « P », avec chacun une borne plein + réparation : place Gutenberg, 2 motos ; place Broglie, 1 moto)', ['Réglage', ...Object.values(VT).map((t) => t.name), 'Unité'], [
  ['Places', ...vcol((t) => t.seats), ''], ['Points de vie', ...vcol((t) => t.hp), 'PV'], ['Vitesse max', ...vcol((t) => Math.round(t.maxSpeed * 3.6)), 'km/h'],
  ['Réservoir', ...vcol((t) => t.tank), 'L'], ['Autonomie à fond', ...vcol((t) => +(t.tank / (t.idle + t.gas + t.perSpeed) / 60).toFixed(1)), 'min'],
  ['Seuil d\'écrasement', ...vcol((t) => Math.round(t.roadkill.vmin * 3.6)), 'km/h (en dessous : aucun dégât, un zombie arrête la moto)'],
  ['Dégâts d\'écrasement au seuil / à la vitesse max', ...vcol((t) => `${Math.round(rk(t, t.roadkill.vmin))} / ${Math.round(rk(t, t.maxSpeed))}`), 'PV de zombie'],
  ['Usure par écrasement', ...same(`${VD.roadkillKill} (zombie tué) / ${VD.roadkillHurt} (survivant)`), 'PV de la moto'],
  ['Choc contre un objet physique (voiture, mobilier, arbre, machine…)', ...same(`(vitesse perdue - ${VD.crashFree}) x ${VD.crashPerMs}`), 'PV de la moto'],
  ['Choc contre un mur (façade, quai, parapet, porte, marche, bord de l\'île)', ...same(VD.wall ? `${VD.wall * 100} % du choc contre un objet` : 'aucun dégât pour la moto'), 'le pilote se blesse comme pour un objet'],
  ['Choc contre une autre moto', ...same(`(vitesse d'approche - ${VD.motoHit.free}) x ${VD.motoHit.perMs}, pour chacune ; rebond ${VD.motoHit.bounce} x la vitesse vers l'autre`), 'PV de la moto (la moto garée est un obstacle fixe)'],
  ['Coup de zombie sur un occupant', ...same(VD.zombieHit), 'PV de la moto (le joueur perd 20)'],
  ['Explosion proche (grenade, M79…)', ...same(`${VD.explosion * 100} % des dégâts infligés aux zombies`), ''],
  ['À 0 PV', ...same(`feu ${VD.burnTime} s, explosion (rayon ${VD.blast.radius} m, ${VD.blast.zombies} aux zombies, jusqu'à ${VD.blast.players} aux joueurs sans jamais les tuer), épave ${VD.wreckTime} s`), ''],
  ['Retour au parking', ...same(`${VD.respawnRounds} manches après la destruction, PV pleins, ${VF.respawn * 100} % d'essence`), ''],
  ['Borne du parking (à pied, moto à moins de ' + C.vehicles.pumpReach + ' m)', ...same(`${VF.pricePerL} pts par litre + ${VD.repairPrice} pts par PV`), 'plein + réparation'],
  ['Bidon d\'essence (bonus)', ...same(`+${String(VF.jerrican).replace('.', ',')} L, ${VF.dropChance * 100} % par zombie tué si une moto est sous ${VF.dropBelow * 100} %`), ''],
  ['Panne sèche', ...same(`réserve < ${VF.lowBelow * 100} % : bip, ratés < ${VF.missBelow * 100} %, à 0 : poussée ${VF.pushSpeed} m/s`), ''],
]);
const KN = C.knife;
const kdmg = (r) => Math.max(KN.minDamage, KN.healthFrac * zhp(r));
table('17_couteau', 'Couteau (toujours disponible, hors inventaire)', ['Réglage', 'Valeur', 'Unité / remarque'], [
  ['Touches', `${kn0('knife')} à pied ; clic gauche quand le chargeur ET la réserve sont vides`, `${kn0('vehicleView')} reste la vue 3e / 1re personne en moto (touches par défaut, modifiables dans Options > Touches)`],
  ['Portée / cône', `${String(KN.range).replace('.', ',')} / ${KN.cone}`, 'm / degrés de part et d\'autre de la visée ; fente de ' + String(KN.lunge).replace('.', ',') + ' m si un zombie est à moins de ' + String(KN.lungeNear).replace('.', ',') + ' m et qu\'on avance'],
  ['Cadence', `1 coup / ${String(KN.cooldown).replace('.', ',')} s`, `touche à ${String(KN.hitDelay).replace('.', ',')} s, animation ${String(KN.anim).replace('.', ',')} s`],
  ['Dégâts', `max(${KN.minDamage}, ${String(KN.healthFrac).replace('.', ',')} x santé des zombies de la manche)`, 'dos ou tête x ' + String(KN.weakMult).replace('.', ',') + ' (non cumulés) ; l\'armure du chevalier de fer est ignorée'],
  ...[1, 5, 10, 15, 20].map((r) => [`Manche ${r}`, `${Math.round(kdmg(r))} par coup (${zhp(r)} PV)`, `${Math.ceil(zhp(r) / kdmg(r))} coup(s) de face, ${Math.ceil(zhp(r) / (kdmg(r) * KN.weakMult))} dans le dos ou à la tête`]),
  ['Bourreau', `${KN.boss.dmg} fixes`, `x ${String(Fn.boss.sens.front).replace('.', ',')} de face, x ${Fn.boss.sens.back} dans le dos (les mêmes sensibilités que les balles)`],
  ['Hache du Bourreau', `dégâts x${KN.axe.dmgMult}, touche ${1 + KN.axe.extra} zombies`, 'récompense de la finale : remplace le couteau'],
  ['Points', `${KN.points.hit} par touche, ${KN.points.kill} par mort`, '']]);
const VA = C.vault, US = C.unstick, fr1 = (n) => String(n).replace('.', ',');
table('18_enjambement_deblocage', 'Enjambement et déblocage', ['Réglage', 'Valeur', 'Unité / remarque'], [
  ['Enjambement', `${kn0('jump')} face à un obstacle enjambable`, `à moins de ${fr1(VA.reach)} m, de face (moins de ${VA.maxAngle}°), profondeur traversée ${fr1(VA.maxDepth)} m au plus, case d'arrivée libre à ±${fr1(VA.heightTol)} m, dans une zone OUVERTE (jamais de contournement d'une porte payante)`],
  ['Durée', fr1(VA.time), `s (caméra +${fr1(VA.camLift)} m, arme baissée, pas de tir)`],
  ['Enjambables (hauteur <= 1,15 m)', 'banc, poubelle, jardinière, caisse seule, borne, vélos (profondeur <= 1,3 m), sacs de sable, barrière de foule, bloc béton', ''],
  ['On marche dessus', 'palette (0,2 m)', ''],
  ['Non enjambables', 'voiture, fontaine, chalet, caisses empilées, porte payante, barricade scellée, parapet de quai, machines, bornes de munitions, garde-corps de la cathédrale', ''],
  [`Se débloquer (${kn0('unstick')})`, `maintenir ${US.holdTime} s`, `l'invite apparaît si une touche de déplacement est maintenue ${US.stuckAfter} s sans avancer de ${fr1(US.moveMin)} m, ou après ${US.trapAfter} s dans une poche fermée ; arrivée à moins de ${US.maxDist} m dans une zone ouverte (sinon centre de zone) ; recharge ${US.cooldown} s ; impossible en moto, à terre, à l'étage`]]);
const kn = kn0;
table('14_commandes', 'Commandes (touches par défaut, modifiables dans Options > Touches)', ['Touche par défaut', 'Action'], [
  ['Options > Touches', 'Change toutes les touches ci-dessous, sauf souris, molette, Échap et F9 (réglage local, gardé sur l\'appareil ; échange proposé si une touche est déjà prise)'],
  [`ZQSD / ${kn('forward')}${kn('left')}${kn('back')}${kn('right')} / flèches`, 'Se déplacer'], ['Souris', 'Viser'], ['Clic gauche', 'Tirer'], ['Clic droit', 'Viser à la mire'],
  [kn('sprint'), 'Sprint'], [kn('jump'), 'Sauter'], [kn('reload'), 'Recharger'], [`${kn('weapon1')} / ${kn('weapon2')} / ${kn('weapon3')} / molette`, 'Changer d\'arme'], [kn('grenade'), 'Grenade'],
  [kn('interact'), 'Acheter, ouvrir une porte, utiliser une machine ou la borne des motos, réanimer (maintenir), monter / descendre d\'une moto'],
  [`ZQSD / ${kn('forward')}${kn('left')}${kn('back')}${kn('right')} (en moto)`, 'Accélérer, freiner / reculer, tourner'], [`${kn('jump')} (en moto)`, 'Frein à main'], [`${kn('vehicleView')} (en moto)`, 'Vue à la 3e personne / à la 1re personne'],
  [`${kn('forward')}${kn('back')} / ${kn('jump')} (en tram, conducteur)`, 'Accélérer / frein de service puis marche arrière ; frein d\'urgence'], [`${kn('tramDoors')} / ${kn('tramGong')} (en tram)`, 'Ouvrir ou fermer les portes (conducteur, à l\'arrêt) ; gong qui attire les zombies'],
  [kn('torch'), 'Lampe torche'], [`${kn('jump')} (devant un obstacle bas)`, 'Enjamber'], [`${kn('unstick')} (maintenir 2 s, si coincé)`, 'Se débloquer'],
  [`${kn('knife')} (à pied)`, 'Coup de couteau (aussi : clic gauche quand le chargeur et la réserve sont vides)'], [kn('map'), 'Carte'],
  ['Clic molette', 'Lance-grenades sous le canon (fusil d\'assaut Pack-a-Punch niveau III)'],
  ['Échap', 'Ferme la carte ou le menu debug ; sinon menu pause (reprise : Échap, ou clic si le navigateur refuse) ; ferme aussi la capture d\'une touche dans Options > Touches'],
  ['F9 (hôte)', 'Menu debug de l\'hôte : 1-4 joueur, T deux fois amener, Y rejoindre, N réanimer, U débloquer les zombies, P perfs']]);

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

## Grande Île

Toute la Grande Île de Strasbourg est jouable : on commence place du Marché-Neuf et on ouvre les zones l'une après l'autre en payant les portes.
Elle est découpée en ${D.zones.length} zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à ${S.maxDist} m pour les ${D.zones.filter((z) => !S.zones[z.i].outer).length} zones d'origine, sans limite pour les ${D.zones.filter((z) => S.zones[z.i].outer).length} zones extérieures), et les portes se trouvent entre deux zones voisines (une porte ouvre toute la limite entre les deux zones).
Prix d'une porte : le plus cher des deux prix de zone (colonne « Prix de la porte ») ; zones extérieures : palier A 1500, B 2000, C 2500 pts. Le contenu de chaque zone se règle dans \`src/config.js\` → \`sector.zones[].items\`.
À la première ouverture d'une zone extérieure, un bonus apparaît. La boîte mystère ne se déplace que dans une zone déjà ouverte. « Grand'Rue » et « Quai Schoepflin » sont des noms déduits du plan (à confirmer).

`;
for (const [key, t] of Object.entries(T)) md += `## ${t.title}\n\n${mdTable(t)}\n`;
md += `### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : trois niveaux, chacun payé par le joueur avec ses propres points et améliorant l'arme déjà améliorée (le niveau III est refusé au-delà). Dégâts ×2,5 / ×3,5 / ×5 (pistolet à rayons ×1,6 / ×2,2 / ×3), tête ×1,2 / ×1,3 / ×1,4, zombies traversés +2 / +3 / +4, chargeur ×1,5 (puis ×1,33 avec l'accessoire aux niveaux II et III), réserve ×1,5 / ×2 / ×2,5, rechargement ×0,85 (II) / ×0,75 (III), dispersion ×0,85 / ×0,7, prix des munitions au mur ×3 / ×4 / ×5. Reflet de l'arme : violet, bleu, or-rouge pulsant (III) ; des accessoires s'ajoutent à chaque niveau.
- **Atouts** : on les perd tous quand on tombe à terre.
`;
fs.writeFileSync(path.join(DOCS, 'REFERENCE.md'), md);
await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome écrit encore : sans importance */ }
console.log(`OK : docs/carte.png, docs/armes.png, docs/REFERENCE.md, ${Object.keys(T).length} fichiers dans docs/csv/`);
