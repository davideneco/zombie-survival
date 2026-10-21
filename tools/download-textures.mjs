// Télécharge des textures PBR (licence CC0) depuis Poly Haven dans public/textures/<nom>/
// Usage : node tools/download-textures.mjs
import fs from 'node:fs';
import path from 'node:path';

const TEXTURES = {
  cobble: 'square_cobblestone',     // sol des places et rues
  plaster: 'plastered_wall_02',     // façades
  plaster2: 'painted_plaster_wall', // façades (variante)
  roof: 'roof_tiles_14',            // toits
  metal: 'worn_corrugated_iron',    // barrières de quarantaine
  bark: 'tree_bark_03',             // troncs d'arbres
  sandstone: 'sandstone_brick_wall_01', // soubassements / bâtiments en grès
};
const RES = '1k';

// v0.24.1 : matériaux PBR du port Godot (godot/assets/pbr_src/<nom>/{diff,nor,rough,ao}.jpg, 1k, CC0 Poly Haven) :  node tools/download-textures.mjs --godot
// Importés par Godot (compression VRAM, mipmaps : fichiers .import versionnés) ; LICENSE.txt écrit à côté.
const GODOT_TEXTURES = {
  wall_plaster: 'grey_plaster_02',        // crépi patiné des façades
  wall_stucco: 'white_stucco',            // enduit lisse (façades modernes)
  wall_stone: 'red_sandstone_wall',       // grès rose des Vosges (appareil de pierres, teinté par la couleur dessinée)
  wall_stone_big: 'large_sandstone_blocks_01', // grand appareil (cathédrale)
  wall_brick: 'red_brick',                // briques
  wall_timber_plaster: 'rough_plaster_03', // torchis des colombages
  wood_beam: 'dark_wood',                 // pans de bois, volets, portes
  wood_door: 'dark_planks',               // portes
  roof_slate: 'roof_slates_02',           // ardoise
  roof_clay: 'clay_roof_tiles_02',        // tuiles rouges
};
if (process.argv.includes('--godot')) {
  const out = path.join('godot', 'assets', 'pbr_src'); // sources .jpg (ignorées par Godot : .gdignore) ; tools/pack-pbr.py écrit godot/assets/pbr/*/{a,m}.png
  const lic = [];
  for (const [name, id] of Object.entries(GODOT_TEXTURES)) {
    const dir = path.join(out, name);
    fs.mkdirSync(dir, { recursive: true });
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const wanted = { diff: files.Diffuse, nor: files.nor_gl, rough: files.Rough, ao: files.AO };
    for (const [key, entry] of Object.entries(wanted)) {
      const url = entry?.[RES]?.jpg?.url;
      if (!url) { console.log(`  (pas de ${key} pour ${id})`); continue; }
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.writeFileSync(path.join(dir, `${key}.jpg`), buf);
      console.log(`pbr_src/${name}/${key}.jpg  (${(buf.length / 1024) | 0} Ko)  <- ${id}`);
    }
    lic.push(`${name}: Poly Haven "${id}" (https://polyhaven.com/a/${id}), CC0 1.0`);
  }
  fs.mkdirSync(path.join('godot', 'assets', 'pbr'), { recursive: true });
  fs.writeFileSync(path.join('godot', 'assets', 'pbr', 'LICENSE.txt'), `Textures PBR du port Godot (1k).\nToutes sous licence CC0 1.0 (domaine public) de Poly Haven : https://polyhaven.com/license\nAucune attribution requise ; téléchargées par tools/download-textures.mjs --godot.\n\n${lic.join('\n')}\n`);
  console.log('Terminé : godot/assets/pbr_src/ ; puis  python3 tools/pack-pbr.py  et l\'import Godot.');
  process.exit(0);
}

for (const [name, id] of Object.entries(TEXTURES)) {
  const dir = path.join('public', 'textures', name);
  fs.mkdirSync(dir, { recursive: true });
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const wanted = { diff: files.Diffuse, nor: files.nor_gl, rough: files.Rough };
  for (const [key, entry] of Object.entries(wanted)) {
    const url = entry?.[RES]?.jpg?.url;
    if (!url) { console.log(`  (pas de ${key} pour ${id})`); continue; }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(dir, `${key}.jpg`), buf);
    console.log(`${name}/${key}.jpg  (${(buf.length / 1024) | 0} Ko)  <- ${id}`);
  }
}
console.log('Terminé. Textures : Poly Haven (CC0) – https://polyhaven.com/license');
