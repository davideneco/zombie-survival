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

  // ---------- Sol ----------
  const floorTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4a4d48';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 3000, 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
  }, half / 2, half / 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  blockers.push(floor);

  // ---------- Murs d'enceinte ----------
  const wallTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5a5550';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    for (let y = 0; y < s; y += s / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      const off = (y / (s / 4)) % 2 ? s / 4 : 0;
      for (let x = off; x < s; x += s / 2) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s / 4); ctx.stroke();
      }
    }
    speckle(ctx, s, 2500, 0.1);
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
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
    );
    m.position.set(x, wallH / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
  }

  // ---------- Obstacles (couverts) ----------
  const crateTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#573a20';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * (s / 4) + 2, s, 3);
    speckle(ctx, s, 2500, 0.1);
    ctx.strokeStyle = '#3a2512';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  });
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
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
    );
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  // ---------- Borne d'achat de munitions (contre le mur ouest) ----------
  const stationPos = new THREE.Vector3(-half + 0.6, 0, 0);
  const station = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.8, 3),
    new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.6 })
  );
  station.position.set(stationPos.x, 0.9, 0);
  station.castShadow = station.receiveShadow = true;
  scene.add(station);
  blockers.push(station);
  colliders.push({ minX: stationPos.x - 0.6, maxX: stationPos.x + 0.6, minZ: -1.5, maxZ: 1.5 });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.9, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x11cc44, emissiveIntensity: 1.5 })
  );
  panel.position.set(stationPos.x + 0.62, 1.1, 0);
  scene.add(panel);
  const stationLight = new THREE.PointLight(0x33ff77, 25, 8, 2);
  stationLight.position.set(stationPos.x + 1.5, 1.5, 0);
  scene.add(stationLight);

  // ---------- Lampadaires aux quatre coins ----------
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (half - 6), z = sz * (half - 6);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    pole.position.set(x, 2.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0 })
    );
    bulb.position.set(x, 5.1, z);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffd9a0, 140, 28, 2);
    light.position.set(x, 4.9, z);
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
