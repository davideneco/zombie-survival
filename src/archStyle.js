// =====================================================================
//  Facade style classifier (pure, no THREE, no world `rnd`): decides which Strasbourg facade grammar a building gets.
//  The draw is seeded from the building centroid, so a building keeps its style when the data indices change.
//  Rules, first match wins: religious -> gothic; civic / classical hotels; modern; material tags; district mix; downgrades.
// =====================================================================

export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashInt = (a, b) => { let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA77); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); return (h ^ (h >>> 12)) >>> 0; };

// seeded generator of a building: stable for a given centroid (decimetre precision)
export function buildingRng(cfg, cx, cz) { return prng((cfg.seed ^ hashInt(Math.round(cx * 10), Math.round(cz * 10))) >>> 0); }

function distSeg(x, z, [x0, z0, x1, z1]) {
  const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}
// first matching district of cfg.districts
export function districtOf(cfg, cx, cz, island) {
  for (const d of cfg.districts) {
    if (d.island !== undefined && d.island !== !!island) continue;
    if (d.zMax !== undefined && cz > d.zMax) continue;
    if (d.r !== undefined && Math.hypot(cx - d.x, cz - d.z) > d.r) continue;
    if (d.seg && distSeg(cx, cz, d.seg) > (d.w || 30)) continue;
    return d;
  }
  return cfg.districts[cfg.districts.length - 1];
}

const re = (list) => new RegExp(`^(${list})$`);
const CIVIC = re('civic|government|public|university|school'), BIG_HOTEL = re('hotel|bank'), SHEDS = re('shed|garages|garage|roof|service|carport');
const has = (s, k) => String(s || '').split(';').some((v) => v.trim() === k || (k === 'stone' && v.trim() === 'sandstone'));

// b: { tags, area (m2), levels, ignH, frontage (m), island, cx, cz }. Returns { style, shop (false: never a shop front), heimat, district }
export function classify(b, cfg) {
  const tags = b.tags || {}, bt = tags.building || 'yes', mat = tags['building:material'] || '', area = b.area, levels = b.levels || 1, ign = b.ignH || 0;
  const h = buildingRng(cfg, b.cx, b.cz)(); // one draw per building: the district mix reads it
  const dist = districtOf(cfg, b.cx, b.cz, b.island);
  let style, shop = true;
  if (bt === 'cathedral' || bt === 'church' || bt === 'chapel' || tags.religion) style = 'gothic';
  else if (CIVIC.test(bt) || (tags.historic && area > 400)) style = 'civic';
  else if (BIG_HOTEL.test(bt) && area > 600) style = 'classical';
  else if (mat === 'glass' || mat === 'mirror' || (bt === 'office' && area > 800) || levels >= 7 || ign > 24) style = 'modern';
  else if (SHEDS.test(bt)) { style = 'modern'; shop = false; }
  else if (has(mat, 'timber_framing')) style = 'timber';
  else if (has(mat, 'plaster')) style = 'plaster';
  else if (has(mat, 'stone')) style = 'civic';
  else {
    let tot = 0; for (const k in dist.mix) tot += dist.mix[k];
    let r = h * tot; style = 'plaster';
    for (const k in dist.mix) { r -= dist.mix[k]; if (r <= 0) { style = k; break; } }
  }
  // downgrades
  const T = cfg.timber;
  if (style === 'timber' && (area > T.maxArea || levels > T.maxLevels || (b.frontage || 0) > T.maxFront)) style = 'plaster';
  if (style === 'plaster' && area > 1200) style = b.island ? 'classical' : 'neustadt';

  return { style, shop, heimat: !!dist.heimat, district: dist.id, h };
}
