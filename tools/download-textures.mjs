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
