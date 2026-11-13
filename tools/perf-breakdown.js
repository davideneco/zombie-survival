// Draw-call breakdown of ONE frame at the current view (play-test harness --file), split into the main pass and the shadow pass:
//   node .claude/skills/play-test/harness.mjs --url "debug&x=-0.6&z=-28&yaw=0" --size 1280x720 --file tools/perf-breakdown.js
// Wraps renderer.renderBufferDirect for one frame and tallies calls and triangles by object name (or parent name, or type).
// The shadow pass is the one rendered with no scene argument. Read with the perf-check skill.
const r = game.renderer, orig = r.renderBufferDirect.bind(r);
const tally = { main: {}, shadow: {} };
const keyOf = (o) => { // nearest named ancestor (2 levels shown) + geometry / material hint
  if (o.name) return o.name;
  const path = []; for (let a = o.parent; a && path.length < 2; a = a.parent) if (a.name) path.push(a.name);
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return `${path.join('<') || '(root)'} ${o.isInstancedMesh ? 'Inst' : o.type}:${geometryHint(o.geometry)}:${m?.name || m?.type || '?'}`;
};
const geometryHint = (g) => (g?.name || g?.type || '?').replace('Geometry', '');
let frames = 0;
r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
  if (frames > 1) return orig(camera, scene, geometry, material, object, group);
  const pass = scene ? 'main' : 'shadow', k = keyOf(object), t = (tally[pass][k] ||= { calls: 0, tris: 0, inst: 0 });
  t.calls++;
  const idx = geometry.index ? geometry.index.count : geometry.attributes.position?.count || 0;
  const n = group ? group.count : idx;
  const inst = object.isInstancedMesh ? object.count : 1;
  t.tris += Math.round((n / 3) * inst); t.inst += object.isInstancedMesh ? inst : 0;
  return orig(camera, scene, geometry, material, object, group);
};
if (game.renderer.shadowMap) game.renderer.shadowMap.needsUpdate = true;
const origRender = r.render.bind(r); r.render = function (sc, cam) { if (sc === game.scene || sc?.isScene) frames++; return origRender(sc, cam); };
await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
r.render = origRender;
r.renderBufferDirect = orig;
const top = (m) => Object.entries(m).sort((a, b) => b[1].tris - a[1].tris); // biggest triangle consumers first
const sum = (m) => Object.values(m).reduce((a, v) => ({ calls: a.calls + v.calls, tris: a.tris + v.tris }), { calls: 0, tris: 0 });
const fmt = (m, n) => top(m).slice(0, n).map(([k, v]) => `${v.calls}× ${k} (${(v.tris / 1e3).toFixed(0)}k tri${v.inst ? `, ${v.inst} inst` : ''})`);
return { main: sum(tally.main), shadow: sum(tally.shadow), topMain: fmt(tally.main, 25), topShadow: fmt(tally.shadow, 15) };
