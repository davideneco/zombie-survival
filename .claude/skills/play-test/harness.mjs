// Harnais de test du jeu réel (Playwright, Chromium sans écran, rendu logiciel).
//
//   node .claude/skills/play-test/harness.mjs [options]
//     --url  "<query>"   paramètres de l'URL, ex. "debug&x=-0.6&z=-28&yaw=0&pitch=0.1" (défaut : "debug")
//     --base <url>       serveur du jeu (défaut : http://localhost:5173/)
//     --eval <js>        code exécuté dans la page après le chargement (async autorisé, `game` = window.game) ; sa valeur est affichée en JSON.
//                        Répétable : chaque --eval s'exécute dans l'ordre, et peut être suivi d'un --shot.
//     --file <script.js> comme --eval, mais lu dans un fichier
//     --wait <ms>        attente après chaque --eval (défaut : 1500)
//     --shot <png>       capture d'écran (après l'étape précédente) ; chemins absolus conseillés (scratchpad)
//     --size <WxH>       fenêtre (défaut : 1000x560)
// Sortie : résultats des --eval, puis les erreurs de la console (ou « no errors »). Code de sortie 1 si la page a levé une erreur.
// Exemple :
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-20" \
//     --eval "const p = game.player; p.giveWeapon('ak47', 0); p.switchWeapon(p.inventory.findIndex((w) => w.id === 'ak47')); return p.curW.id" \
//     --shot /tmp/ak.png
async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(spec); } catch { /* suivant */ }
  }
  try { const { createRequire } = await import('module'); const { execSync } = await import('child_process'); const root = execSync('npm root -g').toString().trim(); return createRequire(import.meta.url)(root + '/playwright'); } catch { /* rien */ }
  throw new Error('Playwright introuvable : installer playwright ou définir PLAYWRIGHT=/chemin/vers/playwright/index.mjs');
}

const args = process.argv.slice(2), steps = [];
let url = 'debug', base = 'http://localhost:5173/', wait = 1500, size = [1000, 560];
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1];
  if (a === '--url') { url = v.replace(/^\?/, ''); i++; } else if (a === '--base') { base = v; i++; } else if (a === '--wait') { wait = +v; i++; }
  else if (a === '--size') { size = v.split('x').map(Number); i++; } else if (a === '--eval') { steps.push({ eval: v }); i++; }
  else if (a === '--file') { const fs = await import('fs'); steps.push({ eval: fs.readFileSync(v, 'utf8') }); i++; } else if (a === '--shot') { steps.push({ shot: v }); i++; }
  else { console.error('option inconnue : ' + a); process.exit(2); }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/theme\.|404/.test(m.text())) errors.push(m.text().slice(0, 300)); });
try {
  await page.goto(base + '?' + url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  for (const s of steps) {
    if (s.eval) {
      // expression seule (« game.player.pos.y ») ou bloc d'instructions avec return (« a(); return b »)
      const r = await page.evaluate(async (code) => {
        const game = window.game;
        let f;
        try { f = new Function('game', `return (async () => (${code}))()`); } catch { f = null; }
        try {
          if (!f) f = new Function('game', `return (async () => { ${code} })()`);
          return JSON.stringify(await f(game));
        } catch (e) { return 'EVAL ERROR: ' + e.message; }
      }, s.eval);
      console.log(r === undefined ? 'undefined' : r.slice(0, 4000));
      await page.waitForTimeout(wait);
    } else if (s.shot) {
      await page.screenshot({ path: s.shot, timeout: 180000 });
      console.log('shot: ' + s.shot);
    }
  }
} finally {
  console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no errors');
  await browser.close();
}
process.exit(errors.some((e) => e.startsWith('PAGEERROR')) ? 1 : 0);
