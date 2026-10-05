// Script injecté par tools/cdp.mjs : vues à hauteur d'œil le long de chaque escalier (window.__pngs).
//   SAVEPNGS=<prefixe> node tools/cdp.mjs <tmp> 'http://localhost:5199/?debug' "$(cat tools/stairs-shots.js)"
//   STAIRS_FILTER (dans window.__stairsFilter) : sous-chaîne du nom des liens à capturer
(() => {
  const g = game, lv = g.player.world.levels, cam = g.camera, pt = {}, ah = {};
  const want = window.__stairsFilter || '';
  window.__pngs = []; const names = [];
  for (const link of lv.links) {
    if (want && !link.name.includes(want)) continue;
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.92]) {
      const s = link.length * f;
      lv.pointOn(link, s, pt); lv.pointOn(link, s + 2.5, ah);
      cam.position.set(pt.x, pt.y + 1.65, pt.z);
      cam.lookAt(ah.x, ah.y + 1.5, ah.z);
      cam.updateMatrixWorld();
      g.player.world.update?.(pt.x, pt.z, 0.016);
      g.renderer.shadowMap.needsUpdate = true;
      g.renderer.render(g.scene, cam);
      window.__pngs.push(g.renderer.domElement.toDataURL('image/png'));
      names.push(`${window.__pngs.length - 1}: ${link.name} @${f}`);
    }
  }
  return names;
})()
