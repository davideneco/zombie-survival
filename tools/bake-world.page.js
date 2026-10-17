// Corps de la cuisson du monde (J2 du port Godot), exécuté DANS la page du jeu (?debug) par tools/bake-world.mjs.
// Une fonction asynchrone : elle lit window.game.world / window.game.scene et remplit window.__bake (nom de fichier -> Uint8Array).
// Rien n'est modifié dans le jeu : seules les portes sont ouvertes à la toute fin (golden « portes ouvertes »), après toutes les extractions.
// Les noms finissant par « .gz » sont compressés côté Node.
(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const g = window.game, w = g.world, scene = g.scene, col = w.collision, nav = w.nav, lev = w.levels;
  const files = (window.__bake = {});
  const enc = new TextEncoder();
  const putJSON = (n, o) => { files[n] = enc.encode(JSON.stringify(o)); };
  const putF64 = (n, a) => { files[n] = new Uint8Array(Float64Array.from(a).buffer); };
  const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });
  const num = (v) => (Number.isFinite(v) ? v : (v > 0 ? 1e30 : -1e30)); // JSON n'a pas Infinity (les .f64 le portent tel quel)
  const stats = {};

  // ------------------------------------------------------------ collision
  const segIdx = new Map();
  col.segs.forEach((s, i) => segIdx.set(s, i));
  const circIdx = new Map();
  col.circles.forEach((c, i) => circIdx.set(c, i));
  const doorOf = new Map();
  w.doors.forEach((d) => d.segs.forEach((s) => doorOf.set(s, d.id)));
  const segs = [];
  for (const s of col.segs) segs.push(s.ax, s.az, s.bx, s.bz, s.h, s.y0, s.kind === 'prop' ? 1 : 0, s.vid, doorOf.has(s) ? doorOf.get(s) : -1, s.off ? 1 : 0); // off : désactivé par le jeu (arbres sur la voie du tram…)
  putF64('collision/segs.f64', segs);
  const circles = [];
  for (const c of col.circles) circles.push(c.x, c.z, c.r, c.h, c.y0, c.kind === 'prop' ? 1 : 0, c.vid, c.off ? 1 : 0);
  putF64('collision/circles.f64', circles);
  putJSON('collision/vaults.json', col.vaults.map((v) => (v.circle ? { id: v.id, h: v.h, circle: circIdx.get(v.circle) } : { id: v.id, h: v.h, segs: v.segs.map((s) => segIdx.get(s)) })));
  putJSON('collision/floors.json', col.floors.map((f) => ({ y: f.y, tris: f.tris })));
  putJSON('collision/meta.json', { halfX: col.halfX, halfZ: col.halfZ, cell: col.cell, segs: col.segs.length, circles: col.circles.length, vaults: col.vaults.length, floors: col.floors.length });
  stats.segsOff = col.segs.filter((s) => s.off).length; stats.circlesOff = col.circles.filter((c) => c.off).length; stats.segs = col.segs.length; stats.circles = col.circles.length; stats.vaults = col.vaults.length; stats.floors = col.floors.length;

  // ------------------------------------------------------------ étages (Levels)
  putJSON('levels.json', {
    tris: lev.tris.map((t) => [t.region, t.x0, t.y0, t.z0, t.x1, t.y1, t.z1, t.x2, t.y2, t.z2]),
    regions: lev.regions.map((r) => ({ id: r.id, name: r.name, y: r.y, kind: r.kind, bbox: r.bbox && r.bbox.map(num), spawns: r.spawns, link: r.link ? r.link.id : null })),
    links: lev.links.map((l) => ({ id: l.id, name: l.name, a: l.a, b: l.b, path: l.path, region: l.region })),
    holePolys: lev.holePolys,
  });
  stats.levelTris = lev.tris.length; stats.regions = lev.regions.length; stats.links = lev.links.length;

  // ------------------------------------------------------------ navigation + zones (grilles de 75 cm)
  const N = nav.nx * nav.nz;
  files['nav/blocked.u8.gz'] = new Uint8Array(nav.blocked);
  const zw = new Int8Array(N), z1 = new Int8Array(N);
  for (let iz = 0; iz < nav.nz; iz++) for (let ix = 0; ix < nav.nx; ix++) {
    const x = nav.worldX(ix), z = nav.worldZ(iz);
    zw[iz * nav.nx + ix] = w.zoneOf(x, z); z1[iz * nav.nx + ix] = w.zoneOf1(x, z);
  }
  files['nav/zone.i8.gz'] = new Uint8Array(zw.buffer);
  files['nav/zone1.i8.gz'] = new Uint8Array(z1.buffer);
  putJSON('nav/meta.json', { nx: nav.nx, nz: nav.nz, cell: nav.cell, ox: nav.ox, oz: nav.oz, margin: nav.margin, halfX: nav.halfX, halfZ: nav.halfZ, blockedCount: nav.blocked.reduce((a, b) => a + b, 0) });
  stats.navCells = N;

  // ------------------------------------------------------------ zones, portes, fenêtres, objets
  const doors = w.doors.map((d) => ({ id: d.id, price: d.price, a: d.a, b: d.b, toZone: d.toZone, name: d.name, points: d.points.map((p) => [p.x, p.z]), segs: d.segs.map((s) => segIdx.get(s)), cells: d.cells }));
  const winArr = [];
  for (const s of w.windowSpawns) winArr.push(s.outside.x, s.outside.z, s.inside.x, s.inside.z, s.center.x, s.center.z, s.nx, s.nz, s.zone);
  putF64('windows.f64', winArr);
  const grp = (o) => (o && o.rotation ? { x: o.position.x, y: o.position.y, z: o.position.z, yaw: o.rotation.y } : null);
  const objects = {
    start: v3(w.startPos), startZone: w.startZone, half: w.half,
    zones: w.zoneNames.map((name, i) => ({ i, name, area: w.zoneArea[i], center: w.zoneCenters[i] })),
    mapCrop: w.mapCrop, mapView: w.mapView, mapTitle: w.mapTitle,
    doors,
    machines: w.machines.map((m) => ({ type: m.type, id: m.id || null, name: m.name, price: m.price, color: m.color, letter: m.letter, zone: m.zone, pos: v3(m.pos), yaw: m.group ? m.group.rotation.y : 0 })),
    wallWeapons: w.wallWeapons.map((v) => ({ id: v.id, name: v.name, price: v.price, ammoPrice: v.ammoPrice, zone: v.zone, pos: v3(v.pos), yaw: v.yaw ?? v.group?.rotation?.y ?? 0 })),
    stations: w.stations.map((s) => ({ x: s.x, y: s.y, z: s.z, zone: s.zone })),
    vehicleSpawns: w.vehicleSpawns.map((s) => ({ type: s.type, x: s.x, z: s.z, yaw: s.yaw })),
    parkings: w.parkings.map((p) => ({ zone: p.zone, name: p.name, x: p.x, z: p.z, yaw: p.yaw, size: p.size, points: p.points })),
    bikeStations: w.bikeStations.map((b) => ({ index: b.index, zone: b.zone, name: b.name, x: b.x, z: b.z, yaw: b.yaw, size: b.size })),
    windowCount: w.windowSpawns.length,
  };
  putJSON('objects.json', objects);
  stats.zones = w.zoneNames.length; stats.doors = doors.length; stats.windows = w.windowSpawns.length; stats.machines = w.machines.length;
  stats.wallWeapons = w.wallWeapons.length; stats.stations = w.stations.length; stats.vehicleSpawns = w.vehicleSpawns.length; stats.parkings = w.parkings.length; stats.bikeStations = w.bikeStations.length;

  // plan de la carte (image du jeu) : PNG
  const blobPng = (cv) => new Promise((res) => cv.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
  files['tex/map.png'] = await blobPng(w.mapImage);

  // ------------------------------------------------------------ géométrie : matériaux, textures
  const textures = [], texIndex = new Map(), fileIndex = new Map(), pngHash = new Map();
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + ':' + s.length; };
  const texId = async (t, srgb) => {
    if (!t) return -1;
    if (texIndex.has(t)) return texIndex.get(t);
    const im = t.image;
    let id;
    if (im instanceof HTMLImageElement) {
      const file = new URL(im.src).pathname.replace(/^\//, '');
      if (fileIndex.has(file + srgb)) id = fileIndex.get(file + srgb);
      else { textures.push({ file, srgb, wrap: t.wrapS === THREE.RepeatWrapping }); id = textures.length - 1; fileIndex.set(file + srgb, id); }
    } else {
      const cv = im instanceof HTMLCanvasElement ? im : (() => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c; })();
      const url = cv.toDataURL('image/png');
      const h = hashStr(url) + srgb + (t.wrapS === THREE.RepeatWrapping);
      if (pngHash.has(h)) id = pngHash.get(h);
      else {
        const name = `tex/c${textures.length}.png`;
        files[name] = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
        textures.push({ file: name, srgb, w: cv.width, h: cv.height, wrap: t.wrapS === THREE.RepeatWrapping });
        id = textures.length - 1; pngHash.set(h, id);
      }
    }
    texIndex.set(t, id);
    return id;
  };
  const materials = [], matIndex = new Map();
  const matId = async (m) => {
    if (matIndex.has(m)) return matIndex.get(m);
    const e = {
      basic: m.isMeshBasicMaterial || m.type === 'MeshBasicMaterial',
      c: m.color ? m.color.getHex() : 0xffffff,
      r: m.roughness ?? 1, m: m.metalness ?? 0,
      e: m.emissive ? m.emissive.getHex() : 0, ei: m.emissiveIntensity ?? 1,
      tr: !!m.transparent, op: m.opacity, side: m.side, vc: !!m.vertexColors, at: m.alphaTest || 0,
      add: m.blending === THREE.AdditiveBlending, nodw: m.depthWrite === false,
      map: await texId(m.map, true), nmap: await texId(m.normalMap, false), rmap: await texId(m.roughnessMap, false), emap: await texId(m.emissiveMap, true),
      rep: m.map ? [m.map.repeat.x, m.map.repeat.y] : m.normalMap ? [m.normalMap.repeat.x, m.normalMap.repeat.y] : [1, 1],
      off: m.map ? [m.map.offset.x, m.map.offset.y] : [0, 0],
      ns: m.normalScale ? m.normalScale.x : 1,
    };
    const key = JSON.stringify(e);
    let id = materials.findIndex((q) => q.__k === key);
    if (id < 0) { e.__k = key; materials.push(e); id = materials.length - 1; }
    matIndex.set(m, id);
    return id;
  };

  // ------------------------------------------------------------ choix des maillages à cuire
  const isEffVisible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const excluded = new Set();
  const markTree = (o) => { if (!o || o === scene || o.isScene) return; if (o.traverse) o.traverse((q) => excluded.add(q)); else if (typeof o === 'object') for (const v of Object.values(o)) if (v && typeof v === 'object' && v !== o && (v.traverse || Array.isArray(v))) (Array.isArray(v) ? v : [v]).forEach(markTree); };
  // portes : cuites à part (elles disparaissent à l'achat)
  const doorMeshes = w.doors.map((d) => { const s = new Set(); for (const m of d.meshes) m.traverse((q) => { if (q.isMesh) s.add(q); }); return s; });
  doorMeshes.forEach((s) => s.forEach((q) => excluded.add(q)));
  scene.children.filter((c) => c.isCamera).forEach(markTree);
  g.zombies?.forEach((z) => markTree(z.group || z.mesh));
  for (const t of g.trams || []) for (const v of Object.values(t)) if (v && v.isObject3D) markTree(v);
  for (const b of w.bikeStations) markTree(b.group);       // vélos : J5
  for (const m of w.machines) if (m.type === 'box') markTree(m.group);   // boîte mystère : dessinée par le jeu (elle se déplace : J6)
  for (const p of w.parkings) { markTree(p.pump); markTree(p.sign); }
  for (const v of g.vehicles || []) markTree(v.group);
  const skipName = (o) => { for (let p = o; p && p !== scene; p = p.parent) if (/^(relief:|contact:)/.test(p.name)) return true; return false; };

  scene.updateMatrixWorld(true);
  const plain = [], inst = [], lampPos = [];
  scene.traverse((o) => {
    if (!o.isMesh || excluded.has(o) || skipName(o) || !isEffVisible(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.type === 'ShaderMaterial')) return;
    if (o.isInstancedMesh) {
      const m = mats[0];
      if (m.emissive && m.emissive.getHex() === 0xffc566 && Math.abs(m.emissiveIntensity - 2.2) < 1e-6) { // lanternes des lampadaires -> positions des lumières
        const mm = new THREE.Matrix4(), p = new THREE.Vector3();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mm); mm.premultiply(o.matrixWorld); p.setFromMatrixPosition(mm); lampPos.push([p.x, p.y, p.z]); }
      }
      inst.push(o);
    } else plain.push(o);
  });
  stats.plainMeshes = plain.length; stats.instMeshes = inst.length; stats.lamps = lampPos.length;
  putJSON('lamps.json', lampPos);

  // ------------------------------------------------------------ cuisson en tuiles
  const TILE = 164, X0 = -820, Z0 = -560;
  const tp = new THREE.Vector3(), tn = new THREE.Vector3(), nmat = new THREE.Matrix3();
  // buckets : clé -> { mat, pos[], nor[], uv[], col[], tan[], idx[], nv }
  function newBakery() { return new Map(); }
  // Grands maillages (sol pavé de 1,7 km, plans d'eau) : découpés en triangles de moins de 120 m de côté, pour que chaque tuile reçoive sa part
  function splitLarge(o, maxEdge = 120) {
    const geo = o.geometry;
    if (Array.isArray(o.material) || !geo.attributes.position) return o;
    geo.computeBoundingBox();
    const bb = geo.boundingBox, sc = new THREE.Vector3().setFromMatrixScale(o.matrixWorld);
    if (Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * Math.max(sc.x, sc.y, sc.z) <= maxEdge) return o;
    { // y a-t-il vraiment un triangle trop long ? (les grands maillages fusionnés de bâtiments n'en ont pas)
      const Pl = geo.attributes.position, ix = geo.index, k = Math.max(sc.x, sc.y, sc.z), n = ix ? ix.count : Pl.count;
      let longest = 0;
      for (let i = 0; i + 2 < n; i += 3) {
        const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, c = ix ? ix.getX(i + 2) : i + 2;
        const e = (u, v) => Math.hypot(Pl.getX(u) - Pl.getX(v), Pl.getY(u) - Pl.getY(v), Pl.getZ(u) - Pl.getZ(v));
        longest = Math.max(longest, e(a, b), e(b, c), e(c, a));
        if (longest * k > maxEdge) break;
      }
      if (longest * k <= maxEdge) return o;
    }
    const g2 = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o.matrixWorld);
    const P = g2.attributes.position, Nn = g2.attributes.normal, UV = g2.attributes.uv, C = g2.attributes.color;
    const st = 3 + 3 + 2 + 3, vert = (i) => [P.getX(i), P.getY(i), P.getZ(i), Nn ? Nn.getX(i) : 0, Nn ? Nn.getY(i) : 1, Nn ? Nn.getZ(i) : 0, UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0, C ? C.getX(i) : 1, C ? C.getY(i) : 1, C ? C.getZ(i) : 1];
    const out = [], stack = [];
    for (let i = 0; i + 2 < P.count; i += 3) stack.push([vert(i), vert(i + 1), vert(i + 2)]);
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), mid = (a, b) => a.map((v, k) => (v + b[k]) / 2);
    while (stack.length) {
      const [a, b, c] = stack.pop();
      const lab = len(a, b), lbc = len(b, c), lca = len(c, a), m = Math.max(lab, lbc, lca);
      if (m <= maxEdge) { out.push(a, b, c); continue; }
      if (m === lab) { const d = mid(a, b); stack.push([a, d, c], [d, b, c]); }
      else if (m === lbc) { const d = mid(b, c); stack.push([a, b, d], [a, d, c]); }
      else { const d = mid(c, a); stack.push([a, b, d], [d, b, c]); }
    }
    const geo2 = new THREE.BufferGeometry();
    const f = (k0, n) => { const arr = new Float32Array(out.length * n); out.forEach((v, i) => { for (let k = 0; k < n; k++) arr[i * n + k] = v[k0 + k]; }); return arr; };
    geo2.setAttribute('position', new THREE.BufferAttribute(f(0, 3), 3));
    if (Nn) geo2.setAttribute('normal', new THREE.BufferAttribute(f(3, 3), 3));
    if (UV) geo2.setAttribute('uv', new THREE.BufferAttribute(f(6, 2), 2));
    if (C) geo2.setAttribute('color', new THREE.BufferAttribute(f(8, 3), 3));
    stats.splitMeshes = (stats.splitMeshes || 0) + 1;
    return { geometry: geo2, material: o.material, matrixWorld: new THREE.Matrix4(), isMesh: true };
  }
  async function bakeInto(bk, o0, tileOf) {
    const o = splitLarge(o0);
    const geo = o.geometry, P = geo.attributes.position, Nn = geo.attributes.normal, UV = geo.attributes.uv, C = geo.attributes.color;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : P.count, materialIndex: 0 }];
    const M = o.matrixWorld;
    nmat.getNormalMatrix(M);
    const index = geo.index ? geo.index.array : null;
    // positions/normales mondiales calculées à la demande
    const wp = new Float32Array(P.count * 3), wn = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      tp.fromBufferAttribute(P, i).applyMatrix4(M); wp[i * 3] = tp.x; wp[i * 3 + 1] = tp.y; wp[i * 3 + 2] = tp.z;
      if (Nn) { tn.fromBufferAttribute(Nn, i).applyMatrix3(nmat).normalize(); wn[i * 3] = tn.x; wn[i * 3 + 1] = tn.y; wn[i * 3 + 2] = tn.z; } else { wn[i * 3 + 1] = 1; }
    }
    const detH = M.determinant() < 0; // miroir : l'ordre des sommets s'inverse
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0];
      if (!m) continue;
      const mid = await matId(m);
      const wantTan = !!m.normalMap && !!UV && !!Nn;
      const remaps = new Map();
      const triCount = Math.floor(Math.min(grp.count, (index ? index.length : P.count) - grp.start) / 3);
      // tangentes par sommet (espace local puis transformées), seulement si carte de normales
      let tanLocal = null;
      if (wantTan) {
        tanLocal = new Float32Array(P.count * 4);
        const acc = new Float32Array(P.count * 6);
        for (let t = 0; t < triCount; t++) {
          const a = index ? index[grp.start + t * 3] : grp.start + t * 3, b = index ? index[grp.start + t * 3 + 1] : a + 1, c = index ? index[grp.start + t * 3 + 2] : a + 2;
          const e1x = P.getX(b) - P.getX(a), e1y = P.getY(b) - P.getY(a), e1z = P.getZ(b) - P.getZ(a);
          const e2x = P.getX(c) - P.getX(a), e2y = P.getY(c) - P.getY(a), e2z = P.getZ(c) - P.getZ(a);
          const du1 = UV.getX(b) - UV.getX(a), dv1 = UV.getY(b) - UV.getY(a), du2 = UV.getX(c) - UV.getX(a), dv2 = UV.getY(c) - UV.getY(a);
          const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
          const r = 1 / det;
          const tx = (e1x * dv2 - e2x * dv1) * r, ty = (e1y * dv2 - e2y * dv1) * r, tz = (e1z * dv2 - e2z * dv1) * r;
          const bx = (e2x * du1 - e1x * du2) * r, by = (e2y * du1 - e1y * du2) * r, bz = (e2z * du1 - e1z * du2) * r;
          for (const v of [a, b, c]) { acc[v * 6] += tx; acc[v * 6 + 1] += ty; acc[v * 6 + 2] += tz; acc[v * 6 + 3] += bx; acc[v * 6 + 4] += by; acc[v * 6 + 5] += bz; }
        }
        for (let i = 0; i < P.count; i++) {
          const nx = Nn.getX(i), ny = Nn.getY(i), nz = Nn.getZ(i);
          let tx = acc[i * 6], ty = acc[i * 6 + 1], tz = acc[i * 6 + 2];
          const d = tx * nx + ty * ny + tz * nz; tx -= nx * d; ty -= ny * d; tz -= nz * d;
          const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
          const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
          const hd = cx * acc[i * 6 + 3] + cy * acc[i * 6 + 4] + cz * acc[i * 6 + 5] < 0 ? -1 : 1;
          tanLocal[i * 4] = tx; tanLocal[i * 4 + 1] = ty; tanLocal[i * 4 + 2] = tz; tanLocal[i * 4 + 3] = hd;
        }
      }
      for (let t = 0; t < triCount; t++) {
        const a = index ? index[grp.start + t * 3] : grp.start + t * 3, b = index ? index[grp.start + t * 3 + 1] : a + 1, c = index ? index[grp.start + t * 3 + 2] : a + 2;
        const cx = (wp[a * 3] + wp[b * 3] + wp[c * 3]) / 3, cz = (wp[a * 3 + 2] + wp[b * 3 + 2] + wp[c * 3 + 2]) / 3;
        const tk = tileOf(cx, cz), key = tk + '|' + mid;
        let B = bk.get(key);
        if (!B) { B = { mat: mid, tile: tk, pos: [], nor: [], uv: [], col: [], tan: [], idx: [], nv: 0, tanOn: false, uvOn: false, colOn: false }; bk.set(key, B); }
        let rm = remaps.get(tk);
        if (!rm) { rm = new Int32Array(P.count).fill(-1); remaps.set(tk, rm); }
        const ids = [a, b, c].map((v) => {
          if (rm[v] >= 0) return rm[v];
          const k = B.nv++;
          rm[v] = k;
          B.pos.push(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]);
          B.nor.push(wn[v * 3], wn[v * 3 + 1], wn[v * 3 + 2]);
          if (UV) { B.uv.push(UV.getX(v) * 1, 1 - UV.getY(v)); B.uvOn = true; } else B.uv.push(0, 0);
          if (m.vertexColors && C) { B.col.push(C.getX(v), C.getY(v), C.getZ(v), 1); B.colOn = true; } else B.col.push(1, 1, 1, 1);
          if (wantTan) {
            tn.set(tanLocal[v * 4], tanLocal[v * 4 + 1], tanLocal[v * 4 + 2]).applyMatrix4(new THREE.Matrix4().extractRotation(M)).normalize();
            B.tan.push(tn.x, tn.y, tn.z, tanLocal[v * 4 + 3] * (detH ? -1 : 1)); B.tanOn = true;
          } else B.tan.push(0, 0, 0, 1);
          return k;
        });
        if (detH) B.idx.push(ids[0], ids[2], ids[1]); else B.idx.push(ids[0], ids[1], ids[2]);
      }
    }
  }
  // sérialisation d'une pile de surfaces : 'ZMP1' | u32 json | json | blobs
  function packSurfaces(list) {
    const surfaces = [], blobs = [];
    let off = 0;
    const add = (arr, Ctor) => { const a = Ctor.from(arr); const bytes = new Uint8Array(a.buffer); const o = off; blobs.push(bytes); off += bytes.length; return o; };
    for (const B of list) {
      const s = { mat: B.mat, nv: B.nv, ni: B.idx.length, pos: add(B.pos, Float32Array), nor: add(B.nor, Float32Array) };
      if (B.uvOn) s.uv = add(B.uv, Float32Array);
      if (B.colOn) s.col = add(B.col, Float32Array);
      if (B.tanOn) s.tan = add(B.tan, Float32Array);
      s.idx = add(B.idx, Uint32Array);
      surfaces.push(s);
    }
    const head = enc.encode(JSON.stringify({ surfaces }));
    const pad = (4 - ((8 + head.length) % 4)) % 4;
    const out = new Uint8Array(8 + head.length + pad + off);
    out.set(enc.encode('ZMP1'), 0);
    new DataView(out.buffer).setUint32(4, head.length + pad, true);
    out.set(head, 8);
    for (let i = 0; i < pad; i++) out[8 + head.length + i] = 32;
    let p = 8 + head.length + pad;
    for (const b of blobs) { out.set(b, p); p += b.length; }
    return out;
  }

  const world = newBakery();
  const tileOf = (x, z) => `${Math.min(9, Math.max(0, Math.floor((x - X0) / TILE)))}_${Math.min(6, Math.max(0, Math.floor((z - Z0) / TILE)))}`;
  for (const o of plain) await bakeInto(world, o, tileOf);
  const tiles = new Map();
  for (const B of world.values()) { if (!tiles.has(B.tile)) tiles.set(B.tile, []); tiles.get(B.tile).push(B); }
  let totalTri = 0;
  const tileList = [];
  for (const [tk, list] of tiles) {
    files[`tiles/t${tk}.bin`] = packSurfaces(list);
    const tri = list.reduce((a, B) => a + B.idx.length / 3, 0); totalTri += tri;
    tileList.push({ key: tk, tri });
  }
  stats.tiles = tiles.size; stats.tileTriangles = totalTri;

  // portes
  const doorPacks = [];
  for (let i = 0; i < w.doors.length; i++) {
    const bk = newBakery();
    for (const o of doorMeshes[i]) { if (o.isMesh) await bakeInto(bk, o, () => 'd'); }
    files[`doors/d${i}.bin`] = packSurfaces([...bk.values()]);
    doorPacks.push([...bk.values()].reduce((a, B) => a + B.idx.length / 3, 0));
  }
  stats.doorTriangles = doorPacks.reduce((a, b) => a + b, 0);

  // ------------------------------------------------------------ instances (arbres, mobilier, rails…)
  const instMeta = [], instBlobs = [];
  let ioff = 0;
  const addBlob = (a, Ctor) => { const arr = Ctor.from(a); const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); const o = ioff; instBlobs.push(bytes); ioff += bytes.length; return o; };
  let instTotal = 0;
  const mm = new THREE.Matrix4();
  for (const o of inst) {
    const geo = o.geometry, P = geo.attributes.position, Nn = geo.attributes.normal, UV = geo.attributes.uv, CA = geo.attributes.color;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : P.count, materialIndex: 0 }];
    const surf = [];
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0]; if (!m) continue;
      const remap = new Map(), pos = [], nor = [], uv = [], col = [], idx = [];
      const index = geo.index ? geo.index.array : null;
      const useCol = !!(m.vertexColors && CA); // couleurs de sommet (rails du tram : lit, rails, traverse) : sans elles les rails sont blancs
      const n = Math.min(grp.count, (index ? index.length : P.count) - grp.start);
      for (let t = 0; t < n; t++) {
        const v = index ? index[grp.start + t] : grp.start + t;
        let k = remap.get(v);
        if (k === undefined) { k = remap.size; remap.set(v, k); pos.push(P.getX(v), P.getY(v), P.getZ(v)); nor.push(Nn ? Nn.getX(v) : 0, Nn ? Nn.getY(v) : 1, Nn ? Nn.getZ(v) : 0); uv.push(UV ? UV.getX(v) : 0, UV ? 1 - UV.getY(v) : 0); if (useCol) col.push(CA.getX(v), CA.getY(v), CA.getZ(v), 1); }
        idx.push(k);
      }
      surf.push({ mat: await matId(m), nv: remap.size, ni: idx.length, pos: addBlob(pos, Float32Array), nor: addBlob(nor, Float32Array), uv: addBlob(uv, Float32Array), idx: addBlob(idx, Uint32Array), ...(useCol ? { col: addBlob(col, Float32Array) } : {}) });
    }
    // transformations monde : 12 flottants par instance, lignes de la matrice 3x4 (format du tampon d'un MultiMesh 3D de Godot)
    const xf = new Float32Array(o.count * 12);
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, mm); mm.premultiply(o.matrixWorld);
      const e = mm.elements;
      xf.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], i * 12);
    }
    let colors = null;
    if (o.instanceColor) colors = addBlob(Array.from(o.instanceColor.array.slice(0, o.count * 3)), Float32Array);
    instMeta.push({ name: o.name || o.parent?.name || '', count: o.count, surfaces: surf, xf: addBlob(xf, Float32Array), colors });
    instTotal += o.count;
  }
  {
    const head = enc.encode(JSON.stringify({ meshes: instMeta }));
    const pad = (4 - ((8 + head.length) % 4)) % 4;
    const out = new Uint8Array(8 + head.length + pad + ioff);
    out.set(enc.encode('ZMI1'), 0);
    new DataView(out.buffer).setUint32(4, head.length + pad, true);
    out.set(head, 8);
    for (let i = 0; i < pad; i++) out[8 + head.length + i] = 32;
    let p = 8 + head.length + pad;
    for (const b of instBlobs) { out.set(b, p); p += b.length; }
    files['instances.bin'] = out;
  }
  stats.instances = instTotal;

  materials.forEach((m) => delete m.__k);
  putJSON('materials.json', materials);
  putJSON('textures.json', textures);
  stats.materials = materials.length; stats.textures = textures.length;
  putJSON('tiles.json', { tile: TILE, x0: X0, z0: Z0, nx: 10, nz: 7, tiles: tileList });

  // ------------------------------------------------------------ golden : floorAt / rayHit / zoneOf (portes fermées puis ouvertes)
  let seed = 20260612;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cr = w.mapCrop;
  const free = [];
  while (free.length < 1200) {
    const x = cr.x0 + rnd() * (cr.x1 - cr.x0), z = cr.z0 + rnd() * (cr.z1 - cr.z0);
    const ix = nav.cx(x), iz = nav.cz(z);
    if (nav.inside(ix, iz) && !nav.blocked[nav.idx(ix, iz)] && w.zoneOf(x, z) >= 0) free.push([x, z]);
  }
  const fl = { y: 0, region: 0 };
  const floorCases = [];
  for (let i = 0; i < 2000; i++) {
    let x, z, y;
    if (i % 2 === 0) { [x, z] = free[i % free.length]; y = [0, 0, 0.2, 0.5][i % 4]; }
    else { const t = lev.tris[Math.floor(rnd() * lev.tris.length)]; const a = rnd() * 0.8, b = rnd() * (1 - a) * 0.9; x = t.x0 + (t.x1 - t.x0) * a + (t.x2 - t.x0) * b; z = t.z0 + (t.z1 - t.z0) * a + (t.z2 - t.z0) * b; y = Math.max(t.y0, t.y1, t.y2) + rnd() * 0.4 - 0.1; }
    w.floorAt(x, z, y, fl);
    floorCases.push([x, z, y, fl.y, fl.region]);
  }
  const rayCases = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = free[Math.floor(rnd() * free.length)];
      w.floorAt(x, z, 0.3, fl);
      const oy = fl.y + 1.0 + rnd() * 0.6, a = rnd() * 6.2832, p = (rnd() - 0.5) * 0.5;
      const dx = Math.cos(a) * Math.cos(p), dy = Math.sin(p), dz = Math.sin(a) * Math.cos(p), maxT = 20 + rnd() * 60;
      out.push([x, oy, z, dx, dy, dz, maxT, w.rayHit(x, oy, z, dx, dy, dz, maxT)]);
    }
    return out;
  };
  const rays = rayCases(2000);
  const zoneCases = free.map(([x, z]) => [x, z, w.zoneOf(x, z), w.zoneOf1(x, z)]);
  // une porte : rayon traversant sa première barrière, avant puis après ouverture
  const doorRays = w.doors.map((d) => {
    const s = d.segs[0], mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2, ex = s.bx - s.ax, ez = s.bz - s.az, l = Math.hypot(ex, ez) || 1, nx = -ez / l, nz = ex / l;
    return [mx - nx * 4, 1.2, mz - nz * 4, nx, 0, nz, 8, w.rayHit(mx - nx * 4, 1.2, mz - nz * 4, nx, 0, nz, 8)];
  });
  const cellsClosed = nav.blocked.reduce((a, b) => a + b, 0);
  // on ouvre tout
  const opened = [];
  const blockedBefore = nav.blocked.slice();
  for (const d of w.doors) { w.openDoor(d.id); opened.push(d.id); }
  const doorRaysOpen = w.doors.map((d, i) => { const r = doorRays[i]; return w.rayHit(r[0], r[1], r[2], r[3], r[4], r[5], r[6]); });
  const raysOpen = rays.map((r) => w.rayHit(r[0], r[1], r[2], r[3], r[4], r[5], r[6]));
  const cellsOpen = nav.blocked.reduce((a, b) => a + b, 0);
  putJSON('golden_j2.json', { floorCases, rays, raysOpen, zoneCases, doorRays, doorRaysOpen, cellsClosed, cellsOpen, counts: stats });
  stats.cellsClosed = cellsClosed; stats.cellsOpen = cellsOpen;
  return { stats, sizes: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])) };
})()
