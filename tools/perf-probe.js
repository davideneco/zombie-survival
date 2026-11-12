// Performance probe, run through the play-test harness at any spot (it measures the CURRENT view):
//   node .claude/skills/play-test/harness.mjs --url "debug&gare" --size 1280x720 --file tools/perf-probe.js
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28&yaw=0" --file tools/perf-probe.js
// Reports what the GPU is asked to do (draw calls, triangles, programs, textures, geometries), the JS heap, the simulation cost
// (game.update, median / p95 over 60 steps) and the page load time. Headless Chromium renders in software: frame times are NOT
// representative of a real GPU, the counts are. Budgets (CLAUDE.md): ≤ 300 draw calls, update ≤ 4 ms, 60 FPS on a mid-range PC.
const r = game.renderer, info = r.info;
const nav = performance.getEntriesByType('navigation')[0];
// a few rendered frames so the counters describe a steady view
await new Promise((res) => { let n = 0; const f = () => (++n >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const render = { calls: info.render.calls, triangles: info.render.triangles, lines: info.render.lines, points: info.render.points };
const memory = { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null };
const t = [];
for (let i = 0; i < 60; i++) { const a = performance.now(); game.update(1 / 60); t.push(performance.now() - a); }
t.sort((a, b) => a - b);
let meshes = 0, instanced = 0, instances = 0, visible = 0;
game.scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.visible) visible++; if (o.isInstancedMesh) { instanced++; instances += o.count; } } });
const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
return {
  where: { area: game.world.areaOf?.(game.player.pos.x, game.player.pos.z), x: Math.round(game.player.pos.x), z: Math.round(game.player.pos.z) },
  render, memory,
  scene: { meshes, visibleMeshes: visible, instancedMeshes: instanced, instances },
  updateMs: { median: +t[30].toFixed(2), p95: +t[57].toFixed(2) },
  heapMB: heap,
  loadMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
  pixelRatio: r.getPixelRatio(), quality: game.settings?.quality ?? game.settings?.graphics ?? null,
};
