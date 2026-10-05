// Script injecté par tools/cdp.mjs : un bot monte et descend chaque escalier (liens de `levels`) en se collant aux murs
// (côté extérieur puis côté noyau) et signale toute chute (hauteur qui décroche du chemin de plus de 1,2 m).
//   node tools/cdp.mjs <tmp> 'http://localhost:5199/?debug' "$(cat tools/stairs-bot.js)"
(() => {
  const w = game.player.world, lv = w.levels;
  const out = [], fl = { y: 0, region: 0 }, pt = {};
  for (const link of lv.links) {
    for (const bias of [-1, 1]) for (const dir of [1, -1]) for (const dt of [1 / 60, 1 / 25]) {
      let s = dir > 0 ? 0 : link.length;
      lv.pointOn(link, s, pt);
      const pos = { x: pt.x, y: pt.y, z: pt.z }; let vy = 0, grounded = true, fell = null;
      for (let f = 0; f < 6000; f++) {
        s = lv.project(link, pos.x, pos.z, pos.y);
        if ((dir > 0 && s >= link.length - 0.3) || (dir < 0 && s <= 0.3)) break;
        lv.pointOn(link, s + dir * 1.5, pt);
        let dx = pt.x - pos.x, dz = pt.z - pos.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        // poussée latérale vers un mur (perpendiculaire au chemin)
        const mx = dx - dz * bias * 0.9, mz = dz + dx * bias * 0.9, ml = Math.hypot(mx, mz);
        pos.x += (mx / ml) * 7 * dt; pos.z += (mz / ml) * 7 * dt;
        lv.floorAt(pos.x, pos.z, pos.y, fl);
        vy -= 22 * dt; pos.y += vy * dt;
        if (pos.y <= fl.y) { pos.y = fl.y; vy = 0; } else if (grounded && vy <= 0 && pos.y - fl.y < 0.45) { pos.y = fl.y; vy = 0; }
        grounded = pos.y <= fl.y + 0.02;
        w.collide(pos, 0.4);
        lv.pointOn(link, lv.project(link, pos.x, pos.z, pos.y), pt);
        if (pt.y - pos.y > 1.2) { fell = { f, x: +pos.x.toFixed(1), y: +pos.y.toFixed(2), z: +pos.z.toFixed(1), pathY: +pt.y.toFixed(2) }; break; }
      }
      if (fell) out.push({ link: link.name, bias, dir, dt: Math.round(1 / dt), ...fell });
    }
  }
  return out;
})()
