// Télécharge les données OpenStreetMap autour d'un point et les convertit en JSON
// local (mètres) utilisable par le jeu.
//
// Usage :  node tools/fetch-osm.mjs <lat> <lon> [demi-taille en mètres]
// Exemple : node tools/fetch-osm.mjs 48.5825207 7.7485590 110
import fs from 'node:fs';

const [lat0, lon0, halfArg] = process.argv.slice(2);
if (!lat0 || !lon0) {
  console.error('Usage: node tools/fetch-osm.mjs <lat> <lon> [demi-taille en m]');
  process.exit(1);
}
const LAT = parseFloat(lat0), LON = parseFloat(lon0), HALF = parseFloat(halfArg || 110);

const mPerDegLat = 111320;
const mPerDegLon = 111320 * Math.cos((LAT * Math.PI) / 180);
const dLat = HALF / mPerDegLat, dLon = HALF / mPerDegLon;
const bbox = `${LAT - dLat},${LON - dLon},${LAT + dLat},${LON + dLon}`;

const query = `[out:json][timeout:60];(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["man_made"="bridge"](${bbox});
  way["leisure"](${bbox});
  way["landuse"](${bbox});
  way["barrier"](${bbox});
  node["natural"="tree"](${bbox});
  node["amenity"~"bench|waste_basket"](${bbox});
  node["highway"="street_lamp"](${bbox});
);out geom;`;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass() {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of SERVERS) {
      try {
        console.log('→', url);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'zombie-game-dev/0.1' },
          body: 'data=' + encodeURIComponent(query),
        });
        const text = await res.text();
        if (!res.ok || !text.startsWith('{')) { console.log('  échec', res.status); continue; }
        return JSON.parse(text);
      } catch (e) { console.log('  erreur', e.message); }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Tous les serveurs Overpass ont échoué');
}

// lat/lon -> mètres locaux. x = est, z = sud (convention Three.js : -z = nord)
const toLocal = (p) => [
  +((p.lon - LON) * mPerDegLon).toFixed(2),
  +(-(p.lat - LAT) * mPerDegLat).toFixed(2),
];
const ring = (geom) => geom.map(toLocal);

const raw = await fetchOverpass();
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/osm_raw.json', JSON.stringify(raw));

const out = { center: { lat: LAT, lon: LON }, half: HALF, buildings: [], roads: [], water: [], trees: [], lamps: [], benches: [], parks: [], barriers: [] };

const heightOf = (t = {}) => {
  if (t.height) { const h = parseFloat(t.height); if (!isNaN(h)) return h; }
  if (t['building:levels']) { const l = parseFloat(t['building:levels']); if (!isNaN(l)) return l * 3.2 + 1.5; }
  return 12 + Math.random() * 6; // centre historique de Strasbourg : ~4-5 étages
};

for (const el of raw.elements) {
  const t = el.tags || {};
  if (el.type === 'node') {
    const p = toLocal(el);
    if (t.natural === 'tree') out.trees.push(p);
    else if (t.highway === 'street_lamp') out.lamps.push(p);
    else if (t.amenity) out.benches.push(p);
    continue;
  }
  if (el.type === 'way' && el.geometry) {
    const pts = ring(el.geometry);
    if (t.building) out.buildings.push({ pts, h: heightOf(t), name: t.name || null });
    else if (t.highway) out.roads.push({ pts, type: t.highway, width: parseFloat(t.width) || null, bridge: !!t.bridge, area: t.area === 'yes' });
    else if (t.waterway || t.natural === 'water') out.water.push({ pts, line: !!t.waterway, width: parseFloat(t.width) || null });
    else if (t.barrier) out.barriers.push({ pts, type: t.barrier });
    else if (t.leisure || t.landuse) out.parks.push({ pts, kind: t.leisure || t.landuse });
  } else if (el.type === 'relation' && el.members) {
    // multipolygones : on garde les anneaux extérieurs comme polygones séparés
    for (const m of el.members) {
      if (m.role !== 'outer' || !m.geometry) continue;
      const pts = ring(m.geometry);
      if (t.building) out.buildings.push({ pts, h: heightOf(t), name: t.name || null });
      else if (t.natural === 'water') out.water.push({ pts, line: false, width: null });
    }
  }
}

fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/area.json', JSON.stringify(out));
console.log(`OK : ${out.buildings.length} bâtiments, ${out.roads.length} routes, ${out.water.length} eau, ${out.trees.length} arbres, ${out.lamps.length} lampadaires, ${out.parks.length} zones vertes, ${out.barriers.length} barrières`);
