// Test multijoueur de bout en bout dans Chrome headless : hôte + 2 clients (boîte mystère, Pack-a-Punch, personnages).
//   node tools/mp-smoke.mjs <dossier-temp> <url>
import { spawn } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
const S = process.argv[2], URL = process.argv[3] || 'http://localhost:5199/';
const PORT = process.env.CDP_PORT || 9336;
const chrome = spawn('google-chrome-stable', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--window-size=800,500', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(S, 'mp' + PORT), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:' + PORT + '/json'); break; } catch {} await sleep(500); }
async function tab() {
  const t = await (await fetch('http://localhost:' + PORT + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') console.log('[EXC]', JSON.stringify(m.params.exceptionDetails).slice(0, 600)); });
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await call('Runtime.enable'); await call('Page.navigate', { url: URL });
  for (let i = 0; i < 200; i++) { await sleep(1000); const r = await call('Runtime.evaluate', { expression: 'typeof window.game', returnByValue: true }); if (r.result?.value === 'object') break; }
  return async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value ?? JSON.stringify(r).slice(0, 300); };
}
const host = await tab(), c1 = await tab(), c2 = await tab();
await host(`window.alert=()=>{}; game.charPref=2; document.getElementById('btnHost').click(); 1`); await sleep(1500);
const code = await host(`game.roomCode`);
const join = async (t, pref) => { await t(`window.alert=()=>{}; game.charPref=${pref}; document.getElementById('joinCode').value=${JSON.stringify(code)}; document.getElementById('btnJoin').click(); 1`); await sleep(1500); };
await join(c1, 2); await join(c2, 0);   // c1 veut le même personnage que l'hôte : le serveur doit lui en donner un autre
await host(`document.getElementById('btnStartGame').click(); game.playing=true; 1`); await sleep(800);
for (const t of [c1, c2]) await t(`game.playing=true; game.hud.hideOverlay(); 1`);
const tabs = [host, c1, c2];
const step = async (n, k = 4) => { for (let j = 0; j < n; j++) { for (const t of tabs) await t(`for(let i=0;i<${k};i++) game.update(0.05); 1`); await sleep(30); } };
await step(10);
console.log('personnages (slot) hôte/c1/c2 :', await host('game.mySlot'), await c1('game.mySlot'), await c2('game.mySlot'));
console.log('avatars vus par l\'hôte :', await host(`[...game.remotes.values()].map(r=>r.name+':'+r.slot).join(' ')`));
// --- boîte mystère : c1 la déclenche, c2 prend l'arme
const useBox = `(()=>{const w=game.world,p=game.player; game.points=99999; const b=w.boxes.find(b=>b.active); p.pos.set(b.pos.x+Math.sin(b.group.rotation.y)*1.5,0,b.pos.z+Math.cos(b.group.rotation.y)*1.5); game.boxLimit=99; game.interact(); return 1})()`;
await host(`game.boxLimit=99; 1`);
await c1(useBox); await step(20, 5);
console.log('tirage : phases hôte/c1/c2 =', await host('game.boxRoll&&game.boxRoll.phase'), await c1('game.boxRoll&&game.boxRoll.phase'), await c2('game.boxRoll&&game.boxRoll.phase'));
console.log('après défilement :', await host('game.boxRoll&&game.boxRoll.phase'), await c1('game.boxRoll&&game.boxRoll.phase'), await c2('game.boxRoll&&game.boxRoll.phase'), 'arme', await host('game.boxRoll&&game.boxRoll.result'));
const goBox = `(()=>{const w=game.world,p=game.player; const b=w.boxes.find(b=>b.active); p.pos.set(b.pos.x+Math.sin(b.group.rotation.y)*1.5,0,b.pos.z+Math.cos(b.group.rotation.y)*1.5); return game.machinePrompt(b)})()`;
console.log('prompt c2 :', await c2(goBox));
const before = await c2('game.player.inventory.map(w=>w.id).join()');
await c2('game.interact(); 1'); await step(10, 3);
console.log('c2 inventaire', before, '->', await c2('game.player.inventory.map(w=>w.id).join()'), '| boîte libérée chez tous :', await host('game.boxRoll===null'), await c1('game.boxRoll===null'), await c2('game.boxRoll===null'));
// --- expiration : on relance un tirage sans prendre l'arme
await host(useBox); await step(80, 5);
await step(60, 5); // > 10 s de présentation
console.log('expiration (10 s) : boîte libre partout ?', await host('game.boxRoll===null'), await c1('game.boxRoll===null'), await c2('game.boxRoll===null'));
// --- Pack-a-Punch : c2 améliore, tout le monde voit
const usePap = `(()=>{const w=game.world,p=game.player; for(const d of w.doors) game.openDoor(d.id,false); game.points=99999; const m=w.machines.find(x=>x.type==='pap'); p.pos.set(m.pos.x+Math.sin(m.group.rotation.y)*1.6,0,m.pos.z+Math.cos(m.group.rotation.y)*1.6); game.useMachine(m); return 1})()`;
console.log('c2 près du PaP :', await c2(usePap), await c2('[game.points, game.player.locked, !!game.nearMachine(), game.nearMachine()&&game.nearMachine().type]')); await step(10, 5);
console.log('PaP animation hôte/c1/c2 :', await host('game.papAnim&&game.papAnim.phase'), await c1('game.papAnim&&game.papAnim.phase'), await c2('game.papAnim&&game.papAnim.phase'));
await host(`game.useMachine(game.world.machines.find(x=>x.type==='pap')); 1`); // l'hôte n'est pas le propriétaire : rien ne doit arriver
await step(80, 6);
console.log('PaP offre :', await c2('game.papAnim&&game.papAnim.phase'), '| hôte peut prendre ?', await host(`game.machinePrompt(game.world.machines.find(x=>x.type==='pap'))`));
await c2(`game.useMachine(game.world.machines.find(x=>x.type==='pap')); 1`); await step(6, 3);
console.log('PaP pris : c2 arme améliorée =', await c2('game.player.curW.pap'), '| anim finie partout :', await host('game.papAnim===null'), await c1('game.papAnim===null'), await c2('game.papAnim===null'));
chrome.kill(); process.exit(0);
