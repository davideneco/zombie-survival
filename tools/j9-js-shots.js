// Script injecté par tools/cdp.mjs : captures du jeu JS aux lieux repères de J9, aux niveaux de qualité Rapide (0) et Haute (2).
//   SAVEPNGS=<prefixe> node tools/cdp.mjs <tmp> 'http://localhost:5199/?debug' "$(cat tools/j9-js-shots.js)"
// Fichiers <prefixe><n>.png dans l'ordre de window.__names ; window.__q (niveaux) et window.__places ([nom, x, z, lacet, tangage]) peuvent être posés avant (CDP : script préfixé).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const places = window.__places || [
    ['marche', -0.6, -30.9, 0], ['kleber', -198.6, -144.9, 0.8], ['parvis', 102.9, 32.9, 1.57], ['gutenberg', -20.1, 89.9, 3.14], ['homme', -290.1, -202.6, 0],
  ];
  const pl = game.player; window.__pngs = []; const names = [];
  for (const q of window.__q || [0, 2]) {
    game.gfx.applyQuality(q);
    for (const [name, x, z, yaw, pitch = 0] of places) {
      pl.pos.x = x; pl.pos.z = z; pl.yaw = yaw; pl.pitch = pitch;
      await sleep(2500);
      game.gfx.render();
      window.__pngs.push(game.renderer?.domElement?.toDataURL('image/png') || document.querySelector('canvas').toDataURL('image/png'));
      names.push(`${name}_q${q}`);
    }
  }
  window.__names = names;
  return names;
})()
