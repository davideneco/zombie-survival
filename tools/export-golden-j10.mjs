// J10 : valeurs de référence du JS pour la fin de partie du port Godot : godot/data/golden/j10.json (+ godot/data/cathedral.json).
//   scenarios : le VRAI Boss, Tanner et Angel de src/ rejoués dans le jeu (Chrome headless via vite) sur des scénarios scriptés, tirages mulberry32
//   mult      : dégâts reçus par le Bourreau (face, dos, zone, rayon, étourdi, Sentence)
//   spire / blocked : angel.js spireRadius et blocked ; cath : repère de la cathédrale (P) et Fanal
// Usage : node tools/export-golden-j10.mjs   (démarre vite sur le port 5197 et Chrome : ~1 min)
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 5197;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
try {
  await new Promise((r) => setTimeout(r, 4000));
  const run = (expr) => {
    const tmp = path.join(os.tmpdir(), 'j10-eval.txt');
    execFileSync('node', ['tools/cdp.mjs', os.tmpdir(), `http://localhost:${port}/?debug`, expr], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, SHOT: path.join(os.tmpdir(), 'j10-golden.png'), EVALOUT: tmp } });
    return fs.readFileSync(tmp, 'utf8');
  };
  const cath = JSON.parse(run("(()=>{const c=game.player.world.cathedral;const o=c.P(0,0),u=c.P(1,0),v=c.P(0,1);return JSON.stringify({o,u:[u[0]-o[0],u[1]-o[1]],v:[v[0]-o[0],v[1]-o[1]],clock:c.clock.p});})()"));
  fs.writeFileSync(path.join(ROOT, 'godot/data/cathedral.json'), JSON.stringify(cath) + '\n');
  const page = `(async()=>{try{return await (${fs.readFileSync(path.join(ROOT, 'tools/j10-golden.page.js'), 'utf8')})}catch(e){return 'ERR '+e.stack}})()`;
  const res = run(page);
  if (String(res).startsWith('ERR')) throw new Error(res);
  const golden = JSON.parse(res);
  fs.writeFileSync(path.join(ROOT, 'godot/data/golden/j10.json'), JSON.stringify(golden));
  console.log('j10.json écrit :', golden.scenarios.map((s) => `${s.name} ${s.samples.length} échantillons ${s.log.length} évènements`).join(' · '));
} finally { vite.kill(); }
