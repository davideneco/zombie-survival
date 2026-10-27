import * as THREE from 'three';
import { Collision } from './collision.js';
import { NavGrid } from './nav.js';
import { Levels } from './levels.js';
import { parkingLayout, buildParkingDecor } from './parking.js';
import { makeSkyDome } from './sky.js';

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export async function buildCircuitWorld(scene, renderer, gameRef = null) {
  const half = 220;
  const halfX = half, halfZ = half;
  const collision = new Collision(halfX, halfZ);
  const levels = new Levels();
  const blockers = [];
  const lightSources = [];

  // ------------------------------------------------------------------ Ciel & Environnement
  const sky = new THREE.Group();
  const dome = makeSkyDome(300);
  sky.add(dome.mesh);
  const skyApi = {
    group: sky, dome: dome.mesh,
    setGradient: dome.setGradient, setK: dome.setK, setCloud: dome.setCloud,
    update: dome.update, stars: null,
  };
  scene.add(sky);

  // ------------------------------------------------------------------ Sol de base (pelouse du circuit)
  const grassTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#253822';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(55,85,42,0.22)' : 'rgba(18,28,15,0.22)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  }, 55, 55);
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.92, metalness: 0.02 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  blockers.push(groundMesh);

  // ------------------------------------------------------------------ Textures Asphalte, Vibreurs & Damier
  const asphaltTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#24272c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 28 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},0.28)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 24, 24);

  const trackRibbonTex = canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const v = 30 + Math.floor(Math.random() * 25);
      ctx.fillStyle = `rgba(${v},${v},${v + 4},0.25)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // Lignes blanches de bord de piste
    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(0, 8, w, 10);
    ctx.fillRect(0, h - 18, w, 10);
    // Trace de gomme sombre sur la trajectoire idéale
    ctx.fillStyle = 'rgba(10,12,15,0.35)';
    ctx.fillRect(0, h * 0.32, w, h * 0.36);
  }, 80, 1);

  const kerbTex = canvasTex(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#d81e1e' : '#f2f4f8';
      ctx.fillRect(i * (w / 8), 0, w / 8, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillRect(0, h - 6, w, 6);
  }, 1, 1);

  const checkerTex = canvasTex(256, 64, (ctx, w, h) => {
    const sq = 16;
    for (let y = 0; y < h / sq; y++) {
      for (let x = 0; x < w / sq; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f6fa' : '#141619';
        ctx.fillRect(x * sq, y * sq, sq, sq);
      }
    }
  }, 1, 1);

  // ------------------------------------------------------------------ Tracé du Circuit Grand Prix (fermé)
  const trackControlPts = [
    new THREE.Vector3(-115, 0, -115), // Début ligne droite départ/arrivée
    new THREE.Vector3(0, 0, -115),    // Ligne de départ/arrivée
    new THREE.Vector3(115, 0, -115),  // Fin ligne droite principale
    new THREE.Vector3(165, 0, -82),   // Virage 1 (Courbe Rapide Est)
    new THREE.Vector3(168, 0, -15),   // Ligne droite Est
    new THREE.Vector3(130, 0, 32),    // Entrée épingle interne
    new THREE.Vector3(92, 0, 62),     // Sommet épingle
    new THREE.Vector3(148, 0, 105),   // Sortie vers Sud-Est
    new THREE.Vector3(115, 0, 148),   // Courbe Sud-Est
    new THREE.Vector3(45, 0, 138),    // Entrée Chicane S
    new THREE.Vector3(0, 0, 106),     // Chicane S gauche
    new THREE.Vector3(-48, 0, 142),   // Chicane S droite
    new THREE.Vector3(-125, 0, 135),  // Courbe Sud-Ouest
    new THREE.Vector3(-165, 0, 65),   // Grande Parabolique Ouest (entrée)
    new THREE.Vector3(-165, 0, -35),  // Grande Parabolique Ouest (milieu)
    new THREE.Vector3(-150, 0, -95),  // Dernier virage vers ligne droite
  ];
  const trackCurve = new THREE.CatmullRomCurve3(trackControlPts, true, 'catmullrom', 0.45);
  const TRACK_SAMPLES = 360;
  const TRACK_WIDTH = 16.0;
  const TRACK_HALF = TRACK_WIDTH * 0.5;
  const samplePts = trackCurve.getSpacedPoints(TRACK_SAMPLES);
  const trackFrames = [];

  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const p = samplePts[i];
    const next = samplePts[(i + 1) % TRACK_SAMPLES];
    const prev = samplePts[(i - 1 + TRACK_SAMPLES) % TRACK_SAMPLES];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const ux = tx / len, uz = tz / len;
    // Normale vers l'INTÉRIEUR du circuit (droite du sens horaire) : inX = -uz, inZ = ux
    // Normale vers l'EXTÉRIEUR du circuit (gauche du sens horaire) : outX = uz, outZ = -ux
    const inX = -uz, inZ = ux;
    const outX = uz, outZ = -ux;
    const d1x = p.x - prev.x, d1z = p.z - prev.z;
    const d2x = next.x - p.x, d2z = next.z - p.z;
    const curv = (d1x * d2z - d1z * d2x);
    trackFrames.push({ x: p.x, z: p.z, ux, uz, inX, inZ, outX, outZ, curv });
  }

  // Maillage ruban de la piste principale
  {
    const pos = [];
    const uvs = [];
    const idx = [];
    let accLen = 0;
    for (let i = 0; i <= TRACK_SAMPLES; i++) {
      const f = trackFrames[i % TRACK_SAMPLES];
      if (i > 0) {
        const pf = trackFrames[(i - 1) % TRACK_SAMPLES];
        accLen += Math.hypot(f.x - pf.x, f.z - pf.z);
      }
      const lx = f.x + f.outX * TRACK_HALF, lz = f.z + f.outZ * TRACK_HALF;
      const rx = f.x + f.inX * TRACK_HALF, rz = f.z + f.inZ * TRACK_HALF;
      pos.push(lx, 0.025, lz, rx, 0.025, rz);
      const u = accLen / 12;
      uvs.push(u, 0, u, 1);
      if (i < TRACK_SAMPLES) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const trackMat = new THREE.MeshStandardMaterial({
      map: trackRibbonTex, roughness: 0.78, metalness: 0.08,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const trackMesh = new THREE.Mesh(geo, trackMat);
    trackMesh.receiveShadow = true;
    scene.add(trackMesh);
    blockers.push(trackMesh);
  }

  // ------------------------------------------------------------------ Vibreurs (Kerbs) dans les virages + Zone de test de suspension
  const kerbZones = []; // { x, z, r }
  {
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.65, metalness: 0.05 });
    const kerbGeo = new THREE.BoxGeometry(1.15, 0.065, 2.8);
    for (let i = 0; i < TRACK_SAMPLES; i += 1) {
      const f = trackFrames[i];
      if (Math.abs(f.curv) < 0.085) continue;
      const dirX = f.curv > 0 ? f.inX : f.outX;
      const dirZ = f.curv > 0 ? f.inZ : f.outZ;
      const kx = f.x + dirX * (TRACK_HALF + 0.45);
      const kz = f.z + dirZ * (TRACK_HALF + 0.45);
      const m = new THREE.Mesh(kerbGeo, kerbMat);
      m.position.set(kx, 0.038, kz);
      m.rotation.y = Math.atan2(f.ux, f.uz);
      m.receiveShadow = true;
      scene.add(m);
      kerbZones.push({ x: kx, z: kz, r: 1.6 });
    }

    // Banc d'essai de suspension (bandes rugueuses / vibreurs rapprochés au sud du paddock : x = -80..-25, z = 28)
    const bumpMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, metalness: 0.1 });
    for (let bx = -82; bx <= -26; bx += 2.2) {
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.075, 7.0), bumpMat);
      bm.position.set(bx, 0.04, 28);
      bm.castShadow = bm.receiveShadow = true;
      scene.add(bm);
      kerbZones.push({ x: bx, z: 28, r: 3.6 });
    }
  }

  // ------------------------------------------------------------------ Paddock Asphalté, Voies d'Accès au Circuit & Skidpad de Drift
  const asphMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, roughness: 0.80, metalness: 0.08,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });

  // Grande dalle Paddock + Voie des Stands fusionnée directement avec la ligne droite (x: -115..90, z: -115..46)
  const paddockFloor = new THREE.Mesh(new THREE.PlaneGeometry(205, 161), asphMat);
  paddockFloor.rotation.x = -Math.PI / 2;
  paddockFloor.position.set(-12.5, 0.018, -34.5);
  paddockFloor.receiveShadow = true;
  scene.add(paddockFloor);
  blockers.push(paddockFloor);

  // Voie de liaison Sud (relie le Paddock/Skidpad directement à la Chicane Sud : x = -12..12, z = 35..112)
  const southLink = new THREE.Mesh(new THREE.PlaneGeometry(24, 78), asphMat);
  southLink.rotation.x = -Math.PI / 2;
  southLink.position.set(0, 0.02, 74);
  southLink.receiveShadow = true;
  scene.add(southLink);

  // Voie de liaison Est (relie le Skidpad directement à la Ligne Droite Est : x = 68..168, z = -12)
  const eastLink = new THREE.Mesh(new THREE.PlaneGeometry(100, 22), asphMat);
  eastLink.rotation.x = -Math.PI / 2;
  eastLink.position.set(118, 0.02, -12);
  eastLink.receiveShadow = true;
  scene.add(eastLink);

  // Marquages fléchés au sol vers le Circuit Grand Prix (Accès Ouest x = -55 et Accès Est x = 35)
  const arrowTex = canvasTex(256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 20]);
    ctx.strokeRect(12, 0, w - 24, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4ade80';
    for (const y of [110, 250, 390]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, y - 48);
      ctx.lineTo(w / 2 + 58, y + 20);
      ctx.lineTo(w / 2 + 24, y + 20);
      ctx.lineTo(w / 2 + 24, y + 54);
      ctx.lineTo(w / 2 - 24, y + 54);
      ctx.lineTo(w / 2 - 24, y + 20);
      ctx.lineTo(w / 2 - 58, y + 20);
      ctx.closePath();
      ctx.fill();
    }
  });
  const arrowMat = new THREE.MeshBasicMaterial({
    map: arrowTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  for (const ax of [-55, 38]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(10, 24), arrowMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(ax, 0.032, -98);
    scene.add(lane);
  }

  // Skidpad Circulaire de Drift (x = 32, z = -12, R = 42m) avec anneaux peints
  const skidTex = canvasTex(512, 512, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = '#22252a';
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.49, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,12,0.55)';
    ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.39, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e8ecf2'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.47, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ff3828'; ctx.lineWidth = 4;
    ctx.setLineDash([18, 14]);
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.30, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#3898ff';
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.16, 0, Math.PI * 2); ctx.stroke();
  });
  const skidMesh = new THREE.Mesh(
    new THREE.CircleGeometry(42, 48),
    new THREE.MeshStandardMaterial({
      map: skidTex, roughness: 0.72, metalness: 0.1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
  );
  skidMesh.rotation.x = -Math.PI / 2;
  skidMesh.position.set(32, 0.028, -12);
  skidMesh.receiveShadow = true;
  scene.add(skidMesh);

  // ------------------------------------------------------------------ Ligne de Départ / Arrivée, Grille & Portique F1
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, TRACK_WIDTH - 0.4),
    new THREE.MeshStandardMaterial({
      map: checkerTex, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })
  );
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.position.set(0, 0.035, -115);
  scene.add(finishLine);

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.8 });

  // Portique de Départ / Chronométrage au-dessus de x = 0, z = -115
  {
    const gantry = new THREE.Group();
    for (const sz of [-TRACK_HALF - 1.2, TRACK_HALF + 1.2]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.8, 0.7), steelMat);
      pillar.position.set(0, 3.4, sz);
      pillar.castShadow = true;
      gantry.add(pillar);
      collision.addBox(0, -115 + sz, 0.8, 0.8, 0, 6.8);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, TRACK_WIDTH + 3.4), steelMat);
    beam.position.set(0, 6.2, 0);
    beam.castShadow = true;
    gantry.add(beam);

    const bannerTex = canvasTex(1024, 128, (ctx, w, h) => {
      ctx.fillStyle = '#101318'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e62424'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 46px Impact, Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🏁 STRASBOURG RING — DÉPART / CHRONO 🏁', w / 2, 80);
    });
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0x222222, roughness: 0.4 });
    for (const sx of [-0.62, 0.62]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH + 1.5, 1.15), bannerMat);
      b.position.set(sx, 6.2, 0);
      b.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      gantry.add(b);
    }
    // 5 Feux de départ F1
    const redLightMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1818, emissiveIntensity: 3.0 });
    const greenLightMat = new THREE.MeshStandardMaterial({ color: 0x20ff50, emissive: 0x18ff40, emissiveIntensity: 2.8 });
    for (let i = -2; i <= 2; i++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.65, 0.36), steelMat);
      pod.position.set(-0.68, 5.2, i * 1.1);
      gantry.add(pod);
      const rBulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), redLightMat);
      rBulb.position.set(-0.82, 5.34, i * 1.1);
      gantry.add(rBulb);
      const gBulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), greenLightMat);
      gBulb.position.set(-0.82, 5.05, i * 0.0 + i * 1.1);
      gantry.add(gBulb);
    }
    gantry.position.set(0, 0, -115);
    scene.add(gantry);
    lightSources.push({ x: 0, y: 5.5, z: -115, color: 0xffd8a8, intensity: 65, dist: 28 });
  }

  // Portiques lumineux d'indication des accès (Accès Piste Ouest, Accès Piste Est, Accès Drift)
  const addSignArch = (x, z, rotY, width, title, borderHex = '#22c55e') => {
    const g = new THREE.Group();
    for (const sx of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 5.4, 12), steelMat);
      post.position.set(sx, 2.7, 0);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 1.0, 0.4), steelMat);
    bar.position.set(0, 5.0, 0);
    g.add(bar);
    const sTex = canvasTex(1024, 128, (ctx, w, h) => {
      ctx.fillStyle = '#0d1520'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = borderHex; ctx.lineWidth = 10; ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 46px Impact, Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(title, w / 2, 82);
    });
    const sMat = new THREE.MeshStandardMaterial({ map: sTex, emissive: 0x1a2836, roughness: 0.35 });
    for (const sz of [-0.22, 0.22]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.92), sMat);
      pl.position.set(0, 5.0, sz);
      if (sz < 0) pl.rotation.y = Math.PI;
      g.add(pl);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    for (const sx of [-width / 2, width / 2]) {
      collision.addCircle(x + c * sx, z - s * sx, 0.3, 5.4);
    }
    lightSources.push({ x, y: 4.8, z, color: 0x90f0b0, intensity: 42, dist: 24 });
  };

  // Portique d'accès direct au circuit juste devant le spawn du joueur (x = -55, z = -98)
  addSignArch(-55, -98, 0, 13, '⬆️ ACCÈS PISTE GRAND PRIX (ENTRÉE OUEST) ⬆️', '#22c55e');
  // Portique d'accès Est vers le Virage 1 (x = 38, z = -98)
  addSignArch(38, -98, 0, 13, '⬆️ ACCÈS PISTE GRAND PRIX (SORTIE STANDS) ⬆️', '#38bdf8');
  // Portique d'accès Sud vers la Chicane (x = 0, z = 48)
  addSignArch(0, 48, 0, 14, '⬇️ ACCÈS CIRCUIT SUD (CHICANE S) ⬇️', '#f59e0b');

  // ------------------------------------------------------------------ Tribune Principale (face à la ligne de départ, z = -134)
  {
    const stand = new THREE.Group();
    const concMat = new THREE.MeshStandardMaterial({ color: 0x484d54, roughness: 0.82 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.5, metalness: 0.6 });
    const seatColors = [0xd62424, 0x2468d6, 0xf0c420];
    for (let step = 0; step < 5; step++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(64, 0.9, 1.8), concMat);
      tier.position.set(0, 0.45 + step * 0.85, -step * 1.6);
      tier.castShadow = tier.receiveShadow = true;
      stand.add(tier);
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(62, 0.25, 0.6),
        new THREE.MeshStandardMaterial({ color: seatColors[step % 3], roughness: 0.5 })
      );
      bench.position.set(0, 0.98 + step * 0.85, -step * 1.6 + 0.35);
      stand.add(bench);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(66, 0.35, 11.5), roofMat);
    roof.position.set(0, 6.8, -3.2);
    roof.rotation.x = 0.12;
    roof.castShadow = true;
    stand.add(roof);
    stand.position.set(0, 0, -133);
    scene.add(stand);
    collision.addBox(0, -136, 66, 10, 0, 7);
    blockers.push(stand);
  }

  // ------------------------------------------------------------------ Stands / Garages du Paddock (x = -94..-30, z = -66, ouverts vers le Nord / Circuit !)
  {
    const pitBuilding = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.65, metalness: 0.35 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd82222, roughness: 0.4, metalness: 0.3 });
    const neonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8ecff, emissiveIntensity: 2.4 });

    // Toit et mur du fond des garages (situés à z = -64, ouverts vers -Z c'est-à-dire face à la piste !)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(64, 0.5, 12), wallMat);
    roof.position.set(-62, 4.4, -64);
    roof.castShadow = roof.receiveShadow = true;
    pitBuilding.add(roof);

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(64.2, 0.65, 12.2), stripeMat);
    fascia.position.set(-62, 4.75, -64);
    pitBuilding.add(fascia);

    // Mur du fond côté Sud (z = -58.2) pour que les garages s'ouvrent vers le Nord (vers la piste z = -115 !)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(64, 4.4, 0.5), wallMat);
    backWall.position.set(-62, 2.2, -58.2);
    backWall.castShadow = backWall.receiveShadow = true;
    pitBuilding.add(backWall);
    collision.addBox(-62, -58.2, 64, 0.6, 0, 4.5);

    // Cloisons des 6 boxes de stand + néons au plafond
    for (let i = 0; i <= 6; i++) {
      const gx = -94 + i * 10.66;
      const div = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.4, 11.5), wallMat);
      div.position.set(gx, 2.2, -64);
      div.castShadow = true;
      pitBuilding.add(div);
      collision.addBox(gx, -64, 0.4, 11.5, 0, 4.4);
      if (i < 6) {
        const neon = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.08, 0.35), neonMat);
        neon.position.set(gx + 5.33, 4.1, -64.5);
        pitBuilding.add(neon);
        lightSources.push({ x: gx + 5.33, y: 3.9, z: -66, color: 0xd8ecff, intensity: 40, dist: 20 });
      }
    }
    scene.add(pitBuilding);
    blockers.push(pitBuilding);
  }

  // Petit Muret des Commissaires (seulement 26m de long entre x = -28 et x = -2 à z = -105) : laisse d'immenses ouvertures à gauche et à droite !
  {
    const pitWallMat = new THREE.MeshStandardMaterial({ color: 0x3a404a, roughness: 0.75 });
    const pw = new THREE.Mesh(new THREE.BoxGeometry(26, 0.95, 0.55), pitWallMat);
    pw.position.set(-15, 0.475, -105);
    pw.castShadow = pw.receiveShadow = true;
    scene.add(pw);
    collision.addBox(-15, -105, 26, 0.6, 0, 1.0);
    blockers.push(pw);
  }

  // ------------------------------------------------------------------ Cônes de Slalom & Piles de Pneus Racing
  {
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5510, roughness: 0.5 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.4 });
    // Ligne de slalom de x = -82 à x = -10, z = -12 (cônes souples visuels sans collision bloquante)
    for (let i = 0; i < 9; i++) {
      const cx = -82 + i * 9.0, cz = -12;
      const cg = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.68, 12), coneMat);
      c1.position.y = 0.34; cg.add(c1);
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.20, 0.16, 12), bandMat);
      b1.position.y = 0.38; cg.add(b1);
      cg.position.set(cx, 0, cz);
      scene.add(cg);
    }

    // Pilier central de pneus au milieu du Skidpad de Drift (x = 32, z = -12)
    const tireColors = [0xd82020, 0xf2f4f8, 0x2068d8];
    const sg = new THREE.Group();
    for (let h = 0; h < 3; h++) {
      const mat = new THREE.MeshStandardMaterial({ color: tireColors[h % 3], roughness: 0.8 });
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 10, 18), mat);
      t.rotation.x = Math.PI / 2;
      t.position.y = 0.22 + h * 0.40;
      t.castShadow = true;
      sg.add(t);
    }
    sg.position.set(32, 0, -12);
    scene.add(sg);
    collision.addCircle(32, -12, 0.78, 1.3, undefined, 'prop');
  }

  // ------------------------------------------------------------------ Glissières de sécurité EXTÉRIEURES & Éclairage du circuit
  {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8a929e, roughness: 0.45, metalness: 0.78 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.7 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc870, emissiveIntensity: 2.8 });

    // Glissières posées sur le BORD EXTÉRIEUR (outX, outZ) de la piste : l'intérieur reste 100% libre d'accès !
    for (let i = 0; i < TRACK_SAMPLES; i += 4) {
      const f = trackFrames[i];
      const fNext = trackFrames[(i + 4) % TRACK_SAMPLES];
      const ox0 = f.x + f.outX * (TRACK_HALF + 4.0), oz0 = f.z + f.outZ * (TRACK_HALF + 4.0);
      const ox1 = fNext.x + fNext.outX * (TRACK_HALF + 4.0), oz1 = fNext.z + fNext.outZ * (TRACK_HALF + 4.0);
      const mx = (ox0 + ox1) * 0.5, mz = (oz0 + oz1) * 0.5;
      const segLen = Math.hypot(ox1 - ox0, oz1 - oz0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, segLen + 0.15), railMat);
      rail.position.set(mx, 0.45, mz);
      rail.rotation.y = Math.atan2(ox1 - ox0, oz1 - oz0);
      rail.castShadow = true;
      scene.add(rail);
      collision.addSegment(ox0, oz0, ox1, oz1, 1.2, 'wall');

      if (i % 18 === 0) {
        const lx = f.x + f.outX * (TRACK_HALF + 5.2), lz = f.z + f.outZ * (TRACK_HALF + 5.2);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 7.5, 8), poleMat);
        pole.position.set(lx, 3.75, lz);
        scene.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), bulbMat);
        head.position.set(lx - f.outX * 0.8, 7.5, lz - f.outZ * 0.8);
        scene.add(head);
        lightSources.push({ x: lx - f.outX * 2, y: 7.2, z: lz - f.outZ * 2, color: 0xffd699, intensity: 70, dist: 35 });
      }
    }

    // Murs d'enceinte du domaine (half = 220)
    collision.addSegment(-half, -half, half, -half, 5, 'wall');
    collision.addSegment(half, -half, half, half, 5, 'wall');
    collision.addSegment(half, half, -half, half, 5, 'wall');
    collision.addSegment(-half, half, -half, -half, 5, 'wall');
  }

  // ------------------------------------------------------------------ Véhicules d'Essais (Alignés face à la piste !)
  // Le joueur apparaît à (-55, 0, -82), face au Nord (yaw = 0) : juste devant la Voiture GT et le 4x4 Tout-Terrain côte à côte !
  const startPos = new THREE.Vector3(-55, 0, -82);
  const vehicleSpawns = [
    // 1) Duo d'accueil juste devant le joueur : Voiture GT Rouge Corsa (gauche) & 4x4 Tout-Terrain Orange Expédition (droite)
    { type: 'voiture', x: -58.5, z: -88, yaw: 0, variant: 0 },
    { type: 'suv', x: -51.5, z: -88, yaw: 0, variant: 2 },
    // 2) Les 6 boxes des stands (z = -70, face à la piste) : 3 Voitures GT + 3 4x4 Tout-Terrain
    { type: 'voiture', x: -88.7, z: -70, yaw: 0, variant: 0 }, // GT Rouge Corsa
    { type: 'voiture', x: -78.0, z: -70, yaw: 0, variant: 1 }, // GT Bleu Alpine
    { type: 'voiture', x: -67.3, z: -70, yaw: 0, variant: 5 }, // GT Jaune Racing
    { type: 'suv', x: -56.6, z: -70, yaw: 0, variant: 0 },     // 4x4 Vert Kaki Tactique
    { type: 'suv', x: -46.0, z: -70, yaw: 0, variant: 1 },     // 4x4 Sable Désert Dakar
    { type: 'suv', x: -35.3, z: -70, yaw: 0, variant: 3 },     // 4x4 Bleu Arctique
    // 3) Grille de départ (face à l'Est : yaw = -Math.PI / 2) : 1 Voiture GT & 1 4x4 Tout-Terrain
    { type: 'voiture', x: -8, z: -112.5, yaw: -Math.PI / 2, variant: 1 },
    { type: 'suv', x: -16, z: -117.5, yaw: -Math.PI / 2, variant: 0 },
    // 4) Banc d'Essai de Suspension (x = 58, z = -22, face aux vibreurs vers le Sud : yaw = Math.PI)
    { type: 'suv', x: 58, z: -22, yaw: Math.PI, variant: 1 },
    // 5) Motos sportives, Grosses Motos & Vélos d'essai alignés à droite des stands (z = -70, face à la piste)
    { type: 'moto', x: -24, z: -70, yaw: 0 },
    { type: 'moto', x: -20, z: -70, yaw: 0 },
    { type: 'grosseMoto', x: -15, z: -70, yaw: 0 },
    { type: 'grosseMoto', x: -10, z: -70, yaw: 0 },
    { type: 'velo', x: -5, z: -70, yaw: 0 },
    { type: 'velo', x: -2, z: -70, yaw: 0 },
    // 6) Avions de Chasse et Voltige (v0.68.0) : 1 sur la piste de décollage (ligne droite) et 1 au paddock voltige
    { type: 'avion', x: -65, z: -115, yaw: -Math.PI / 2, variant: 0 }, // Face à la ligne droite principale (runway vers l'Est !)
    { type: 'avion', x: 8, z: -70, yaw: 0, variant: 1 },               // Paddock Voltige Sport Jaune Corsa
  ];

  // Station Essence & Réparation Gratuite dans le Paddock
  const parkings = [];
  {
    const PK = {
      zone: 'Paddock & Stands', x: -20, z: -86, yaw: 0,
      rect: { w: 10, d: 5 }, slots: [-2.4, -0.8, 0.8, 2.4],
      bays: [],
      pump: { dx: 4.5, dz: 0 },
      sign: { dx: -4.5, dz: 0 },
    };
    const L = parkingLayout(PK);
    buildParkingDecor(scene, collision, lightSources, PK, L);
    parkings.push({
      zone: 0, name: 'Paddock Circuit', x: PK.x, z: PK.z, yaw: PK.yaw,
      pump: { x: L.pump.x, z: L.pump.z }, sign: { x: L.sign.x, z: L.sign.z },
      inRect: L.inRect, points: L.points, size: 4,
    });
  }

  // ------------------------------------------------------------------ Grille de Navigation & Collisions
  collision.build();
  levels.build();
  levels.buildNavs(NavGrid, collision);
  const nav = new NavGrid(halfX, halfZ, collision, [], 1.5, 0.45);
  nav.build();

  // ------------------------------------------------------------------ Mini-carte 2D du Circuit (mapImage)
  const MAP_SCALE = 1.0;
  const mapImage = document.createElement('canvas');
  {
    const W = Math.round(halfX * 2 * MAP_SCALE), Hh = Math.round(halfZ * 2 * MAP_SCALE);
    mapImage.width = W; mapImage.height = Hh;
    const x = mapImage.getContext('2d');
    x.fillStyle = '#1b2819';
    x.fillRect(0, 0, W, Hh);
    // Paddock & Liaisons
    x.fillStyle = '#2d3138';
    x.fillRect((-115 + halfX) * MAP_SCALE, (-115 + halfZ) * MAP_SCALE, 205 * MAP_SCALE, 161 * MAP_SCALE);
    x.fillRect((-12 + halfX) * MAP_SCALE, (35 + halfZ) * MAP_SCALE, 24 * MAP_SCALE, 78 * MAP_SCALE);
    x.fillRect((68 + halfX) * MAP_SCALE, (-23 + halfZ) * MAP_SCALE, 100 * MAP_SCALE, 22 * MAP_SCALE);
    // Skidpad
    x.fillStyle = '#353a42';
    x.beginPath();
    x.arc((32 + halfX) * MAP_SCALE, (-12 + halfZ) * MAP_SCALE, 42 * MAP_SCALE, 0, Math.PI * 2);
    x.fill();
    // Ruban du circuit Grand Prix
    x.strokeStyle = '#484f5a';
    x.lineWidth = TRACK_WIDTH * MAP_SCALE;
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    trackFrames.forEach((f, i) => {
      const X = (f.x + halfX) * MAP_SCALE, Y = (f.z + halfZ) * MAP_SCALE;
      if (i) x.lineTo(X, Y); else x.moveTo(X, Y);
    });
    x.closePath();
    x.stroke();
    // Ligne départ
    x.strokeStyle = '#ff3828';
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo((0 + halfX) * MAP_SCALE, (-115 - TRACK_HALF + halfZ) * MAP_SCALE);
    x.lineTo((0 + halfX) * MAP_SCALE, (-115 + TRACK_HALF + halfZ) * MAP_SCALE);
    x.stroke();
  }

  // ------------------------------------------------------------------ Pool de Lumières Dynamiques
  const LIGHTS = 8;
  const lightPool = [];
  for (let i = 0; i < LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 10, 2);
    scene.add(l);
    lightPool.push(l);
  }
  let lightTimer = 0, lampScale = 1;
  const assignLights = (px, pz) => {
    const sorted = lightSources
      .map((s) => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, LIGHTS);
    lightPool.forEach((l, i) => {
      const e = sorted[i];
      if (!e) { l.intensity = 0; return; }
      l.color.setHex(e.s.color); l.intensity = e.s.intensity * lampScale; l.distance = e.s.dist; l.position.set(e.s.x, e.s.y, e.s.z);
    });
  };
  assignLights(startPos.x, startPos.z);

  // ------------------------------------------------------------------ Chronomètre de Tour Automatique (Lap Timer)
  let lapActive = false;
  let lapTime = 0;
  let bestLap = Infinity;
  let lastPx = startPos.x;

  // Détection des vibreurs pour la suspension 3D de la voiture
  const kerbAt = (x, z) => {
    for (let i = 0; i < kerbZones.length; i++) {
      const k = kerbZones[i];
      const dx = x - k.x, dz = z - k.z;
      if (dx * dx + dz * dz <= k.r * k.r) return 1;
    }
    return 0;
  };

  // Zones indicatives affichées sous la boussole
  const ZONE_NAMES = [
    'Paddock & Stands',
    'Ligne Droite Départ / Arrivée',
    'Aire de Drift (Skidpad)',
    'Banc d\'Essai Suspension',
    'Courbe Rapide Est & Épingle',
    'Chicane Sud',
    'Grande Parabolique Ouest',
  ];
  const zoneOf = (x, z) => {
    if (z < -102 && x >= -130 && x <= 130) return 1;
    if (Math.hypot(x - 32, z + 12) <= 44) return 2;
    if (x >= -90 && x <= -20 && z >= 15 && z <= 42) return 3;
    if (x > 90) return 4;
    if (z > 80) return 5;
    if (x < -115) return 6;
    return 0;
  };

  return {
    isCircuitTest: true,
    half, blockers, spawnPoints: [], windowSpawns: [],
    pickWindow: () => null,
    pickGround: () => null,
    stationPos: null, stations: [], wallWeapons: [],
    vehicleSpawns, parkings, bikeStations: [], bikeCheck: [],
    doors: [], openDoor: () => false,
    zoneOf, startPos, nav, collision, machines: [], boxes: [], setActiveBox: () => {},
    zoneNames: ZONE_NAMES,
    zoneCenters: [
      { name: 'Paddock & Stands', x: -55, z: -82 },
      { name: 'Ligne Droite Départ / Arrivée', x: -8, z: -115 },
      { name: 'Aire de Drift (Skidpad)', x: 32, z: -12 },
      { name: 'Banc d\'Essai Suspension', x: -55, z: 28 },
      { name: 'Courbe Rapide Est & Épingle', x: 130, z: 32 },
      { name: 'Chicane Sud', x: 0, z: 106 },
      { name: 'Grande Parabolique Ouest', x: -165, z: 0 },
    ],
    startZone: 0, sealedPoints: [],
    mapImage,
    mapView: { halfX, halfZ, scale: MAP_SCALE },
    mapCrop: { x0: -halfX, x1: halfX, z0: -halfZ, z1: halfZ },
    mapTitle: 'STRASBOURG RING — CIRCUIT D\'ESSAIS VÉHICULES',
    isZoneOpen: () => true,
    levels,
    sky: skyApi,
    setLampScale: (k) => { lampScale = k; lightTimer = 0; },
    floorAt: (x, z, y, out) => levels.floorAt(x, z, y, out),
    collide: (pos, r, out, ignore) => collision.resolve(pos, r, out, ignore),
    rayHit: (ox, oy, oz, dx, dy, dz, maxT) => collision.rayHit(ox, oy, oz, dx, dy, dz, maxT),
    ceilingAt: (x, z) => (x >= -94 && x <= -30 && z >= -70 && z <= -58 ? 4.3 : Infinity),
    kerbAt,
    update(px, pz, dt) {
      sky.position.set(px, 0, pz);
      lightTimer -= dt;
      if (lightTimer <= 0) { lightTimer = 0.35; assignLights(px, pz); }

      // Chronomètre de tour : franchissement de la ligne x = 0 sur la ligne droite principale (z entre -125 et -105)
      if (lapActive) lapTime += dt;
      if (pz >= -125 && pz <= -105 && lastPx < 0 && px >= 0) {
        const hud = gameRef?.hud || window.__game?.hud;
        if (lapActive && lapTime > 8) {
          const isBest = lapTime < bestLap;
          if (isBest) bestLap = lapTime;
          const msg = `⏱️ TOUR : ${lapTime.toFixed(2)} s${isBest ? ' — RECORD DU TOUR !' : ` (Meilleur : ${bestLap.toFixed(2)} s)`}`;
          hud?.announce?.('CHRONO CIRCUIT', msg, 3500);
        } else {
          hud?.popup?.('🏁 CHRONO LANCÉ — BON TOUR !', 'bonus');
        }
        lapActive = true;
        lapTime = 0;
      }
      lastPx = px;
    },
    mapName: 'Circuit d\'Essais Véhicules',
  };
}
