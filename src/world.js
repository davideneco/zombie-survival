import * as THREE from 'three';
import { CONFIG } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx, size, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
}

/**
 * Pousse un cercle (x,z) hors des rectangles et le garde dans la map.
 * Utilisé par le joueur ET les zombies.
 */
function normalTexture(size, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    const nx = Math.round(((Math.sin(x * 0.35) + (Math.random() - 0.5) * 0.4) * 0.3 + 0.5) * 255);
    const ny = Math.round(((Math.cos(y * 0.35) + (Math.random() - 0.5) * 0.4) * 0.3 + 0.5) * 255);
    img.data[o] = nx; img.data[o + 1] = ny; img.data[o + 2] = 235; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

export function resolveCollisions(pos, radius, colliders, half) {
  for (const c of colliders) {
    const cx = clamp(pos.x, c.minX, c.maxX);
    const cz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      } else {
        // le centre est dans la boîte : sortir par le côté le plus proche
        const l = pos.x - c.minX, r = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z;
        const m = Math.min(l, r, t, b);
        if (m === l) pos.x = c.minX - radius;
        else if (m === r) pos.x = c.maxX + radius;
        else if (m === t) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
  const lim = half - radius;
  pos.x = clamp(pos.x, -lim, lim);
  pos.z = clamp(pos.z, -lim, lim);
}

export function buildWorld(scene) {
  const half = CONFIG.arenaHalf;
  const colliders = []; // rectangles 2D pour les déplacements
  const blockers = [];  // meshes qui arrêtent les balles

  // ---------- Sol (avec relief PBR de normales et variations) ----------
  const floorTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#3a3d38';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 3000, 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
  }, half / 2, half / 2);
  const floorNorm = normalTexture(256, half / 2, half / 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      normalMap: floorNorm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.82,
      metalness: 0.15,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  blockers.push(floor);

  // ---------- Murs d'enceinte ----------
  const wallTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4c4844';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    for (let y = 0; y < s; y += s / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      const off = (y / (s / 4)) % 2 ? s / 4 : 0;
      for (let x = off; x < s; x += s / 2) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s / 4); ctx.stroke();
      }
    }
    speckle(ctx, s, 2500, 0.12);
  });
  const wallH = 5, wallT = 1;
  const walls = [
    [0, -half - wallT / 2, half * 2 + wallT * 2, wallT],
    [0,  half + wallT / 2, half * 2 + wallT * 2, wallT],
    [-half - wallT / 2, 0, wallT, half * 2],
    [ half + wallT / 2, 0, wallT, half * 2],
  ];
  for (const [x, z, w, d] of walls) {
    const tex = wallTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(w, d) / 4, 1);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, wallH, d),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.05 })
    );
    m.position.set(x, wallH / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
  }

  // ---------- Obstacles renforcés (élimination de l'effet bloc/Roblox) ----------
  const crateTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4a3622';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#3a2816';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * (s / 4) + 2, s, 3);
    speckle(ctx, s, 2500, 0.12);
    ctx.strokeStyle = '#24170a';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  });
  const braceMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.65, metalness: 0.75 });
  // [x, z, largeur, profondeur, hauteur]
  const obstacles = [
    [8, 8, 3, 3, 2.2],
    [-10, 6, 4, 2, 2.2],
    [0, -12, 8, 1.5, 2.6],
    [-15, -14, 3, 3, 2.2],
    [14, -10, 1.5, 6, 2.6],
    [-6, 15, 2, 2, 2.2],
    [0, 0, 2.5, 2.5, 3.5],
    [18, 16, 3, 2, 2.2],
    [-20, -2, 1.5, 5, 2.6],
  ];
  for (const [x, z, w, d, h] of obstacles) {
    const tex = crateTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(w, d) / 2, h / 2);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.1 })
    );
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

    // Ajout de renforts d'arêtes métalliques pour accrocher les reflets spéculaires
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), braceMat);
      post.position.set(x + sx * (w / 2 - 0.05), h / 2, z + sz * (d / 2 - 0.05));
      post.castShadow = true;
      scene.add(post);
      blockers.push(post);
    }
  }

  // ---------- Borne d'achat de munitions (contre le mur ouest) ----------
  const stationPos = new THREE.Vector3(-half + 0.6, 0, 0);
  const station = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.8, 3),
    new THREE.MeshStandardMaterial({ color: 0x222822, roughness: 0.72, metalness: 0.45 })
  );
  station.position.set(stationPos.x, 0.9, 0);
  station.castShadow = station.receiveShadow = true;
  scene.add(station);
  blockers.push(station);
  colliders.push({ minX: stationPos.x - 0.6, maxX: stationPos.x + 0.6, minZ: -1.5, maxZ: 1.5 });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.9, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x3d664c, emissive: 0x228a42, emissiveIntensity: 1.5, roughness: 0.6 })
  );
  panel.position.set(stationPos.x + 0.62, 1.1, 0);
  scene.add(panel);
  const stationLight = new THREE.PointLight(0x38d96a, 20, 8, 2);
  stationLight.position.set(stationPos.x + 1.5, 1.5, 0);
  scene.add(stationLight);

  // ---------- Lampadaires aux quatre coins ----------
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (half - 6), z = sz * (half - 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.65, metalness: 0.75 });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5, 12),
      poleMat
    );
    pole.position.set(x, 2.5, z);
    pole.castShadow = true;
    scene.add(pole);

    // Lanterne avec chapeau et ampoule émissive PBR
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.28, 8), poleMat);
    cap.position.set(x, 5.35, z);
    scene.add(cap);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffaa44, emissiveIntensity: 2.8, roughness: 0.3 })
    );
    bulb.position.set(x, 5.05, z);
    scene.add(bulb);

    // PointLight locale jaune/orangée avec portée et atténuation réalistes (decay: 2)
    const light = new THREE.PointLight(0xffb555, 95, 24, 2);
    light.position.set(x, 4.85, z);
    scene.add(light);
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15 });
  }

  // ---------- Points d'apparition des zombies (bord de la map) ----------
  const e = half - 3;
  const spawnPoints = [];
  for (const v of [-e, 0, e]) {
    spawnPoints.push(new THREE.Vector3(v, 0, -e), new THREE.Vector3(v, 0, e));
  }
  spawnPoints.push(new THREE.Vector3(-e, 0, 0), new THREE.Vector3(e, 0, 0));

  return {
    colliders, blockers, spawnPoints, stationPos, half,
    wallWeapons: [],
    startPos: new THREE.Vector3(0, 0, 6),
    nav: null, // pas de pathfinding : l'arène est ouverte
    collide: (pos, r) => resolveCollisions(pos, r, colliders, half),
    mapName: 'Arène de test',
  };
}
