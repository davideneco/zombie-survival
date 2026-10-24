import * as THREE from 'three';

// =====================================================================
//  Gare de Strasbourg : Verrière moderne, Grand Hall historique (1883),
//  Quais avec voies ferrées et train TER régional, et Place de la Gare.
// =====================================================================

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Grand panneau d'affichage des départs SNCF (split-flap jaune & blanc rétro-éclairé)
function makeDeparturesBoardTex() {
  return canvasTex(1024, 512, (ctx, w, h) => {
    // Fond noir d'affichage mécanique
    ctx.fillStyle = '#0c0d12';
    ctx.fillRect(0, 0, w, h);

    // Bordure & cadre
    ctx.strokeStyle = '#1e2330';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // En-tête bleu SNCF
    ctx.fillStyle = '#004494';
    ctx.fillRect(10, 10, w - 20, 60);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.fillText('SNCF VOYAGEURS — DÉPARTS GARE DE STRASBOURG', 30, 48);

    // Logo flèche SNCF stylisé
    ctx.fillStyle = '#ce1126';
    ctx.beginPath();
    ctx.moveTo(w - 110, 20); ctx.lineTo(w - 40, 20); ctx.lineTo(w - 60, 60); ctx.lineTo(w - 130, 60);
    ctx.closePath();
    ctx.fill();

    // Lignes de colonnes
    ctx.fillStyle = '#8ea1b8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('HEURE', 30, 95);
    ctx.fillText('TRAIN', 120, 95);
    ctx.fillText('N°', 230, 95);
    ctx.fillText('DESTINATION', 340, 95);
    ctx.fillText('VOIE', 780, 95);
    ctx.fillText('SITUATION', 870, 95);

    // Ligne de séparation
    ctx.strokeStyle = '#2b3245';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(20, 105); ctx.lineTo(w - 20, 105); ctx.stroke();

    const trains = [
      ['14:22', 'TGV INOUI', '2418', "PARIS GARE DE L'EST", '1', "À L'HEURE", '#ffff33', '#00ff88'],
      ['14:35', 'TER Fluon', '831412', 'COLMAR - MULHOUSE - BÂLE', '2', "À L'HEURE", '#ffff33', '#00ff88'],
      ['14:48', 'TER Alsace', '830105', 'NANCY VILLE', '4', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:02', 'ICE DB', '9568', 'KARLSRUHE - FRANKFURT (M)', '1', 'RETARD 10 MIN', '#ffcc00', '#ffaa00'],
      ['15:15', 'TER Fluon', '832320', 'SÉLESTAT - STRASBOURG', '3', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:30', 'TGV INOUI', '9876', 'LYON PART-DIEU - MARSEILLE', '2', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:42', 'TER Alsace', '834210', 'HAGUENAU - WISSEMBOURG', '5', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:58', 'TGV INOUI', '2430', "PARIS GARE DE L'EST", '1', "À L'HEURE", '#ffff33', '#00ff88']
    ];

    let y = 138;
    for (const [time, type, no, dest, voie, status, col, statCol] of trains) {
      // Fond de volet
      ctx.fillStyle = '#141720';
      ctx.fillRect(20, y - 22, w - 40, 32);
      ctx.strokeStyle = '#1e2433';
      ctx.strokeRect(20, y - 22, w - 40, 32);

      // Rainure centrale de volet
      ctx.strokeStyle = '#000000';
      ctx.beginPath(); ctx.moveTo(20, y - 6); ctx.lineTo(w - 20, y - 6); ctx.stroke();

      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(time, 30, y);

      ctx.fillStyle = col;
      ctx.fillText(type, 120, y);

      ctx.fillStyle = '#cccccc';
      ctx.fillText(no, 230, y);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(dest, 340, y);

      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(voie, 795, y);

      ctx.fillStyle = statCol;
      ctx.font = 'bold 16px monospace';
      ctx.fillText(status, 860, y);

      y += 44;
    }
  });
}

// Horloge de gare ronde rétro-éclairée
function makeClockTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222222'; ctx.lineWidth = 12; ctx.stroke();

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = '#111111';
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r1 = w / 2 - 24, r2 = w / 2 - 40;
      ctx.lineWidth = i % 3 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(Math.sin(ang) * r1, -Math.cos(ang) * r1);
      ctx.lineTo(Math.sin(ang) * r2, -Math.cos(ang) * r2);
      ctx.stroke();
    }

    // Aiguilles (14h22)
    const hAng = (2.36 / 12) * Math.PI * 2;
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hAng) * 55, -Math.cos(hAng) * 55); ctx.stroke();
    const mAng = (22 / 60) * Math.PI * 2;
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(mAng) * 80, -Math.cos(mAng) * 80); ctx.stroke();

    // Trotteuse rouge
    ctx.strokeStyle = '#ce1126'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -90); ctx.stroke();
    ctx.fillStyle = '#ce1126'; ctx.beginPath(); ctx.arc(0, -70, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

// Panneaux de voies bleus émaillés SNCF
function makeTrackSignTex(text) {
  return canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#003399';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  });
}

// Enseigne lumineuse "GARE DE STRASBOURG"
function makeGareSignTex() {
  return canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = '#f5f7fa';
    ctx.font = 'bold 52px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GARE DE STRASBOURG', w / 2, h / 2);
  });
}

// Livrée train TER (argenté, bandeau bleu TER, fenêtres teintées, pictogrammes)
function makeTrainLiveryTex() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#cfd4dc'; // Métal argenté brossé
    ctx.fillRect(0, 0, w, h);

    // Bandeau bleu TER Alsace en partie haute
    ctx.fillStyle = '#004ca8';
    ctx.fillRect(0, 20, w, 60);

    // Bandeau vert pomme régional
    ctx.fillStyle = '#78be20';
    ctx.fillRect(0, 78, w, 8);

    // Fenêtres passagers teintées sombres
    ctx.fillStyle = '#181b24';
    const nWin = 5, winW = 60, winH = 75, gap = 38;
    for (let i = 0; i < nWin; i++) {
      const x = 20 + i * (winW + gap);
      ctx.fillRect(x, 100, winW, winH);
      ctx.strokeStyle = '#2d3345'; ctx.lineWidth = 3; ctx.strokeRect(x, 100, winW, winH);
      // Reflet verre
      ctx.fillStyle = '#3a445c';
      ctx.fillRect(x + 5, 105, winW - 10, 15);
      ctx.fillStyle = '#181b24';
    }

    // Bas de caisse gris anthracite
    ctx.fillStyle = '#2b303c';
    ctx.fillRect(0, 210, w, 46);
  });
}

// Sol dalle granit moderne verrière
function makeVerriereFloorTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c5c9d2';
    ctx.fillRect(0, 0, w, h);
    const n = 4, c = w / n;
    ctx.strokeStyle = '#9ca2af'; ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const ox = i * c, oy = j * c;
        ctx.strokeRect(ox, oy, c, c);
        // Léger bruit de texture
        ctx.fillStyle = (i + j) % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(ox + 4, oy + 4, c - 8, c - 8);
      }
    }
  });
}

// Sol hall historique marbre deux tons
function makeHistoricFloorTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8f887f';
    ctx.fillRect(0, 0, w, h);
    const n = 6, c = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dark = (i + j) % 2 === 0;
        ctx.fillStyle = dark ? '#4a443c' : '#c8c2b7';
        ctx.fillRect(i * c, j * c, c, c);
        ctx.strokeStyle = '#2b2722'; ctx.lineWidth = 2;
        ctx.strokeRect(i * c, j * c, c, c);
      }
    }
  });
}

export function planGare(buildings, parts, rails, platforms) {
  // Limites des espaces de jeu de la Gare :
  // Verrière : X [18, 46], Z [-54, 74]
  // Grand Hall : X [-14, 18], Z [-30, 45]
  // Quais & Voies : X [-75, -14], Z [-58, 58]
  const insideVerriere = (x, z) => x >= 17.5 && x <= 46.5 && z >= -54 && z <= 74;
  const insideHall = (x, z) => x >= -14.5 && x <= 18.5 && z >= -30 && z <= 45;
  const insideQuais = (x, z) => x >= -75 && x <= -14 && z >= -58 && z <= 58;

  const insideInner = (x, z) => insideVerriere(x, z) || insideHall(x, z) || insideQuais(x, z);

  // Hauteurs de plafond
  const ceilAt = (x, z) => {
    if (insideVerriere(x, z)) {
      const u = (x - 32) / 14.5;
      return 6.5 + 10.0 * Math.max(0, 1 - u * u); // Voûte parabolique en verre montant jusqu'à 16,5 m
    }
    if (insideHall(x, z)) return 11.5; // Plafond à caissons du hall historique
    if (insideQuais(x, z)) return 6.5;  // Marquise métallique des quais
    return null; // Ciel ouvert sur le parvis et les voies découvertes
  };

  // Découpe des ouvertures de portes dans les murs existants
  const cutsOf = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return [];
    const cuts = [];
    // Teste si le segment traverse les ouvertures principales
    const testDoor = (px, pz, rw) => {
      const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
      const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / l2));
      const nx = ax + abx * t, nz = az + abz * t;
      if (Math.hypot(nx - px, nz - pz) < 1.8) {
        const dt = (rw / len);
        cuts.push([Math.max(0, t - dt), Math.min(1, t + dt)]);
      }
    };

    // Portes Verrière Est (vers le parvis)
    testDoor(46, -18, 3.5);
    testDoor(46, 10, 4.0);
    testDoor(46, 38, 3.5);

    // Portails Grand Hall (façade historique ouest de la verrière)
    testDoor(18, -8, 3.2);
    testDoor(18, 10, 4.0);
    testDoor(18, 28, 3.2);

    // Portes d'accès aux quais (mur arrière du hall)
    testDoor(-14, -10, 3.5);
    testDoor(-14, 10, 4.0);
    testDoor(-14, 30, 3.5);

    return cuts;
  };

  return {
    insideInner,
    ceilAt,
    cutsOf,
    seed: [2, 12],
    pap: { x: -22, z: -35, yaw: Math.PI },
    clock: { x: 18, z: 10, yaw: Math.PI / 2 },
    finish(scene, collision, lightSources, props) {
      const gGroup = new THREE.Group();
      gGroup.name = 'GareDeStrasbourg';

      // -----------------------------------------------------------------
      // 1. SOLS INTÉRIEURS
      // -----------------------------------------------------------------
      // Sol Verrière moderne (granit clair)
      const vFloorTex = makeVerriereFloorTex();
      vFloorTex.repeat.set(8, 24);
      const vFloorGeo = new THREE.PlaneGeometry(28.5, 128);
      const vFloorMat = new THREE.MeshStandardMaterial({ map: vFloorTex, roughness: 0.4, metalness: 0.1 });
      const vFloor = new THREE.Mesh(vFloorGeo, vFloorMat);
      vFloor.rotation.x = -Math.PI / 2;
      vFloor.position.set(32, 0.02, 10);
      vFloor.receiveShadow = true;
      gGroup.add(vFloor);

      // Sol Grand Hall historique (marbre deux tons)
      const hFloorTex = makeHistoricFloorTex();
      hFloorTex.repeat.set(12, 28);
      const hFloorGeo = new THREE.PlaneGeometry(32, 75);
      const hFloorMat = new THREE.MeshStandardMaterial({ map: hFloorTex, roughness: 0.35, metalness: 0.15 });
      const hFloor = new THREE.Mesh(hFloorGeo, hFloorMat);
      hFloor.rotation.x = -Math.PI / 2;
      hFloor.position.set(2, 0.03, 7.5);
      hFloor.receiveShadow = true;
      gGroup.add(hFloor);

      // -----------------------------------------------------------------
      // 2. LA VERRIÈRE (Grande coupole ovoïde en verre & nervures acier)
      // -----------------------------------------------------------------
      const ribMat = new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.4, metalness: 0.8 });
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x90c4e8,
        roughness: 0.08,
        metalness: 0.15,
        transmission: 0.82,
        transparent: true,
        opacity: 0.42,
        ior: 1.52,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      // Arcs de structure métallique (nervures tubulaires cintrées)
      const nRibs = 22;
      const z0 = -54, z1 = 74;
      for (let i = 0; i <= nRibs; i++) {
        const rz = z0 + (i / nRibs) * (z1 - z0);
        const curvePts = [];
        const nSteps = 30;
        for (let s = 0; s <= nSteps; s++) {
          const t = s / nSteps;
          const theta = Math.PI * (1 - t);
          const rx = 32 + 14.2 * Math.cos(theta);
          const ry = 16.2 * Math.sin(theta);
          curvePts.push(new THREE.Vector3(rx, ry, rz));
        }
        const curve = new THREE.CatmullRomCurve3(curvePts);
        const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.22, 8, false);
        const tubeMesh = new THREE.Mesh(tubeGeo, ribMat);
        tubeMesh.castShadow = true;
        gGroup.add(tubeMesh);

        // Ligne de lumière indirecte au sommet des nervures
        if (i % 3 === 0) {
          lightSources.push({ x: 32, y: 15.5, z: rz, color: 0xffeedd, intensity: 10, dist: 16 });
        }
      }

      // Enveloppe vitrée cintrée
      {
        const vCols = 32, vRows = 40;
        const vPos = [], vUv = [], vIdx = [];
        for (let j = 0; j <= vRows; j++) {
          const rz = z0 + (j / vRows) * (z1 - z0);
          for (let k = 0; k <= vCols; k++) {
            const t = k / vCols;
            const theta = Math.PI * (1 - t);
            const rx = 32 + 14.1 * Math.cos(theta);
            const ry = 16.1 * Math.sin(theta);
            vPos.push(rx, ry, rz);
            vUv.push(t * 8, (j / vRows) * 24);
          }
        }
        for (let j = 0; j < vRows; j++) {
          for (let k = 0; k < vCols; k++) {
            const p1 = j * (vCols + 1) + k;
            const p2 = p1 + 1;
            const p3 = (j + 1) * (vCols + 1) + k;
            const p4 = p3 + 1;
            vIdx.push(p1, p3, p2);
            vIdx.push(p2, p3, p4);
          }
        }
        const glassGeo = new THREE.BufferGeometry();
        glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(vPos, 3));
        glassGeo.setAttribute('uv', new THREE.Float32BufferAttribute(vUv, 2));
        glassGeo.setIndex(vIdx);
        glassGeo.computeVertexNormals();
        const glassMesh = new THREE.Mesh(glassGeo, glassMat);
        gGroup.add(glassMesh);
      }

      // Façade vitrée Est (vers la place de la Gare, X = 46.2)
      // Murs vitrés avec 3 grands accès pour le passage des joueurs et des zombies
      const facadeGlassMat = new THREE.MeshStandardMaterial({ color: 0x1e2838, roughness: 0.3, metalness: 0.7 });
      const addGlassWall = (zStart, zEnd) => {
        const wLen = zEnd - zStart;
        const wGeo = new THREE.BoxGeometry(0.4, 6.0, wLen);
        const wMesh = new THREE.Mesh(wGeo, facadeGlassMat);
        wMesh.position.set(46.2, 3.0, (zStart + zEnd) / 2);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(46.2, (zStart + zEnd) / 2, 0.6, wLen, 0, 6.0);
      };
      // Blocs de façade et entrées (entrées à Z ~ -18, 10, 38)
      addGlassWall(-54, -22);
      addGlassWall(-14, 6);
      addGlassWall(14, 34);
      addGlassWall(42, 74);

      // Pignons d'extrémité Nord et Sud de la verrière
      collision.addBox(32, -54, 28, 0.8, 0, 16);
      collision.addBox(32, 74, 28, 0.8, 0, 16);

      // Enseigne lumineuse "GARE DE STRASBOURG"
      {
        const signTex = makeGareSignTex();
        const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 1.2, roughness: 0.3 });
        const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), signMat);
        signMesh.position.set(46.5, 7.5, 10);
        signMesh.rotation.y = Math.PI / 2;
        gGroup.add(signMesh);
        lightSources.push({ x: 47.5, y: 7.5, z: 10, color: 0xffeedd, intensity: 8, dist: 12 });
      }

      // Trémie d'escalier & escalators vers le tram souterrain (X = 32, Z = 22)
      {
        const wellW = 4.5, wellL = 10;
        const railMat = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.9, roughness: 0.2 });
        // Garde-corps inox autour de la trémie
        const barH = 1.05;
        collision.addBox(32 - wellW / 2, 22, 0.2, wellL, 0, barH);
        collision.addBox(32 + wellW / 2, 22, 0.2, wellL, 0, barH);
        collision.addBox(32, 22 - wellL / 2, wellW, 0.2, 0, barH);

        const railG = new THREE.BoxGeometry(wellW, barH, wellL);
        const railWire = new THREE.LineSegments(new THREE.EdgesGeometry(railG), new THREE.LineBasicMaterial({ color: 0x88bbff }));
        railWire.position.set(32, barH / 2 + 0.05, 22);
        gGroup.add(railWire);

        // Lumière bleue tamisée émanant du tram sous-sol
        lightSources.push({ x: 32, y: -1.0, z: 22, color: 0x2288ff, intensity: 8, dist: 10 });
      }

      // -----------------------------------------------------------------
      // 3. FAÇADE HISTORIQUE (1883) & GRAND HALL CENTRAL
      // -----------------------------------------------------------------
      const sandstoneMat = new THREE.MeshStandardMaterial({ color: 0x9b584a, roughness: 0.85, metalness: 0.05 });
      const oakMat = new THREE.MeshStandardMaterial({ color: 0x3d271d, roughness: 0.7 });

      // Mur mitoyen historique (X = 18) entre la Verrière et le Grand Hall
      const addSandstoneWall = (zStart, zEnd) => {
        const wLen = zEnd - zStart;
        const wGeo = new THREE.BoxGeometry(1.4, 11.5, wLen);
        const wMesh = new THREE.Mesh(wGeo, sandstoneMat);
        wMesh.position.set(18, 5.75, (zStart + zEnd) / 2);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(18, (zStart + zEnd) / 2, 1.4, wLen, 0, 11.5);
      };
      // Portails historiques en arc à Z ~ -8, 10, 28
      addSandstoneWall(-30, -12);
      addSandstoneWall(-4, 6);
      addSandstoneWall(14, 24);
      addSandstoneWall(32, 45);

      // Linteaux moulurés au-dessus des 3 portails (hauteur de passage 5.8 m)
      for (const pz of [-8, 10, 28]) {
        const lintelGeo = new THREE.BoxGeometry(1.6, 5.7, 8.0);
        const lintelMesh = new THREE.Mesh(lintelGeo, sandstoneMat);
        lintelMesh.position.set(18, 5.8 + 2.85, pz);
        lintelMesh.castShadow = true;
        gGroup.add(lintelMesh);
      }

      // Murs pignons intérieurs Nord et Sud du Grand Hall
      const addHallPignon = (pz) => {
        const wGeo = new THREE.BoxGeometry(32, 11.5, 1.2);
        const wMesh = new THREE.Mesh(wGeo, sandstoneMat);
        wMesh.position.set(2, 5.75, pz);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(2, pz, 32, 1.2, 0, 11.5);
      };
      addHallPignon(-30);
      addHallPignon(45);

      // Plafond à caissons du Grand Hall (Y = 11.5)
      {
        const ceilGeo = new THREE.PlaneGeometry(32, 75);
        const ceilMesh = new THREE.Mesh(ceilGeo, oakMat);
        ceilMesh.position.set(2, 11.45, 7.5);
        ceilMesh.rotation.x = Math.PI / 2;
        gGroup.add(ceilMesh);
      }

      // Lustres suspendus du Grand Hall (4 suspensions avec ampoules ambrées chaleureuses)
      for (const [lx, lz] of [[8, -10], [8, 25], [-4, -10], [-4, 25]]) {
        const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.5, 8);
        const rod = new THREE.Mesh(rodGeo, ribMat);
        rod.position.set(lx, 11.5 - 1.75, lz);
        gGroup.add(rod);

        const ringGeo = new THREE.TorusGeometry(1.2, 0.08, 8, 16);
        const ring = new THREE.Mesh(ringGeo, ribMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(lx, 8.0, lz);
        gGroup.add(ring);

        lightSources.push({ x: lx, y: 7.8, z: lz, color: 0xffaa55, intensity: 14, dist: 20 });
      }

      // Grand Tableau d'affichage des départs SNCF (Mur Nord du Grand Hall)
      {
        const boardTex = makeDeparturesBoardTex();
        const boardMat = new THREE.MeshStandardMaterial({
          map: boardTex,
          emissive: 0xffffff,
          emissiveMap: boardTex,
          emissiveIntensity: 0.95,
          roughness: 0.4
        });
        const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(15, 6.5), boardMat);
        boardMesh.position.set(2, 6.2, -29.2);
        gGroup.add(boardMesh);
        lightSources.push({ x: 2, y: 6.2, z: -27.5, color: 0xffeebb, intensity: 8, dist: 12 });
      }

      // Grande horloge centrale suspendue au portail (X = 18, Z = 10)
      {
        const clockTex = makeClockTex();
        const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.3, emissive: 0xffffff, emissiveMap: clockTex, emissiveIntensity: 0.7 });
        const clockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.25, 32), clockMat);
        clockMesh.rotation.z = Math.PI / 2;
        clockMesh.position.set(18, 6.5, 10);
        gGroup.add(clockMesh);
      }

      // Guichets de vente & Espace Vente SNCF (Mur Sud, Z = 42)
      {
        const counterGeo = new THREE.BoxGeometry(16, 1.2, 1.8);
        const counterMat = new THREE.MeshStandardMaterial({ color: 0x4a3224, roughness: 0.5 });
        const counter = new THREE.Mesh(counterGeo, counterMat);
        counter.position.set(2, 0.6, 41);
        counter.castShadow = true;
        gGroup.add(counter);
        collision.addBox(2, 41, 16, 1.8, 0, 2.5);

        // Vitrage de guichet
        const glassPartition = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.6), glassMat);
        glassPartition.position.set(2, 2.0, 41.5);
        gGroup.add(glassPartition);
      }

      // Kiosque Relay (presse / boissons / snacks)
      {
        const kioskGeo = new THREE.BoxGeometry(5.5, 3.2, 5.0);
        const kioskMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, roughness: 0.5 });
        const kiosk = new THREE.Mesh(kioskGeo, kioskMat);
        kiosk.position.set(-8, 1.6, 30);
        kiosk.castShadow = true;
        gGroup.add(kiosk);
        collision.addBox(-8, 30, 5.5, 5.0, 0, 3.2);

        lightSources.push({ x: -8, y: 2.8, z: 27.2, color: 0xffeedd, intensity: 6, dist: 8 });
      }

      // -----------------------------------------------------------------
      // 4. LES QUAIS & LES VOIES FERRÉES
      // -----------------------------------------------------------------
      // Mur ouest arrière du Grand Hall (X = -14) donnant sur les quais
      const addPlatformWall = (zStart, zEnd) => {
        const wLen = zEnd - zStart;
        const wGeo = new THREE.BoxGeometry(1.2, 11.5, wLen);
        const wMesh = new THREE.Mesh(wGeo, sandstoneMat);
        wMesh.position.set(-14, 5.75, (zStart + zEnd) / 2);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(-14, (zStart + zEnd) / 2, 1.2, wLen, 0, 11.5);
      };
      // Accès vers les voies à Z ~ -10, 10, 30
      addPlatformWall(-30, -14);
      addPlatformWall(-6, 6);
      addPlatformWall(14, 26);
      addPlatformWall(34, 45);

      // Dalles surélevées des Quais (Quai 1 : X [-14, -28] ; Quai 2/3 : X [-36, -50])
      const quaiMat = new THREE.MeshStandardMaterial({ color: 0x8a909a, roughness: 0.85 });
      const addQuai = (qx, qw, qz, ql) => {
        const qGeo = new THREE.BoxGeometry(qw, 0.45, ql);
        const qMesh = new THREE.Mesh(qGeo, quaiMat);
        qMesh.position.set(qx, 0.225, qz);
        qMesh.receiveShadow = true;
        gGroup.add(qMesh);

        // Bande podotactile jaune de sécurité le long du quai
        const edgeGeo = new THREE.BoxGeometry(0.35, 0.02, ql);
        const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6b800, roughness: 0.6 });
        const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
        edgeMesh.position.set(qx - qw / 2 + 0.2, 0.46, qz);
        gGroup.add(edgeMesh);
      };
      addQuai(-21, 14, 0, 110);  // Quai 1
      addQuai(-43, 14, 0, 110);  // Quai 2 & 3

      // Voies ferrées (rails d'acier + traverses en bois)
      const railSteelMat = new THREE.MeshStandardMaterial({ color: 0x78808a, metalness: 0.95, roughness: 0.2 });
      const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x2c221a, roughness: 0.9 });
      const addTrack = (trackX, zStart, zEnd) => {
        // Ballast de gravier
        const bGeo = new THREE.BoxGeometry(3.2, 0.1, zEnd - zStart);
        const bMat = new THREE.MeshStandardMaterial({ color: 0x48423d, roughness: 1.0 });
        const bMesh = new THREE.Mesh(bGeo, bMat);
        bMesh.position.set(trackX, 0.05, (zStart + zEnd) / 2);
        bMesh.receiveShadow = true;
        gGroup.add(bMesh);

        // Traverses tous les 0.8 m
        const nSleepers = Math.floor((zEnd - zStart) / 0.8);
        for (let i = 0; i <= nSleepers; i++) {
          const sz = zStart + i * 0.8;
          const sMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.22), sleeperMat);
          sMesh.position.set(trackX, 0.12, sz);
          sMesh.receiveShadow = true;
          gGroup.add(sMesh);
        }

        // 2 rails d'acier parallèles (écartement standard 1,435 m)
        for (const dx of [-0.72, 0.72]) {
          const rGeo = new THREE.BoxGeometry(0.08, 0.15, zEnd - zStart);
          const rMesh = new THREE.Mesh(rGeo, railSteelMat);
          rMesh.position.set(trackX + dx, 0.22, (zStart + zEnd) / 2);
          gGroup.add(rMesh);
        }
      };
      addTrack(-29.5, -55, 55); // Voie 1
      addTrack(-34.5, -55, 55); // Voie 2
      addTrack(-51.5, -55, 55); // Voie 3

      // Marquise métallique des quais (Grande Halle aux trains)
      {
        const canopyMat = new THREE.MeshStandardMaterial({ color: 0x303642, roughness: 0.6, metalness: 0.5 });
        const c1Mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 110), canopyMat);
        c1Mesh.position.set(-21, 6.4, 0);
        gGroup.add(c1Mesh);

        const c2Mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 110), canopyMat);
        c2Mesh.position.set(-43, 6.4, 0);
        gGroup.add(c2Mesh);

        // Colonnes de fonte des quais
        const colMat = new THREE.MeshStandardMaterial({ color: 0x1f242c, metalness: 0.8, roughness: 0.4 });
        for (let cz = -48; cz <= 48; cz += 16) {
          for (const cx of [-21, -43]) {
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 6.4, 12), colMat);
            col.position.set(cx, 3.2, cz);
            col.castShadow = true;
            gGroup.add(col);
            collision.addBox(cx, cz, 0.5, 0.5, 0, 6.4);
            lightSources.push({ x: cx, y: 5.6, z: cz, color: 0xfff0dd, intensity: 6, dist: 12 });
          }
        }
      }

      // Train de voyageurs régional (TER Alsace) à quai sur la Voie 2 (X = -34.5, Z de -18 à 32)
      {
        const trainTex = makeTrainLiveryTex();
        trainTex.repeat.set(4, 1);
        const trainMat = new THREE.MeshStandardMaterial({ map: trainTex, roughness: 0.35, metalness: 0.5 });
        const trainBody = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.6, 50), trainMat);
        trainBody.position.set(-34.5, 2.05, 7);
        trainBody.castShadow = true;
        trainBody.receiveShadow = true;
        gGroup.add(trainBody);

        // Toit arrondi du train
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xdde2ea, roughness: 0.4, metalness: 0.3 });
        const trainRoof = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 50, 16, 1, false, 0, Math.PI), roofMat);
        trainRoof.rotation.x = Math.PI / 2;
        trainRoof.rotation.z = Math.PI / 2;
        trainRoof.position.set(-34.5, 3.85, 7);
        gGroup.add(trainRoof);

        // Pantographe sur le toit
        const pantoMat = new THREE.MeshStandardMaterial({ color: 0xce1126, metalness: 0.9, roughness: 0.2 });
        const panto = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 2.5), pantoMat);
        panto.position.set(-34.5, 4.45, -10);
        gGroup.add(panto);

        // Phares avant du train
        const lightG = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        lightG.position.set(-34.5, 1.6, -18.1);
        gGroup.add(lightG);
        lightSources.push({ x: -34.5, y: 1.6, z: -19.5, color: 0xffffff, intensity: 8, dist: 15 });

        // Collider solide du train (obstacle et couverture tactique)
        collision.addBox(-34.5, 7, 3.1, 50.2, 0, 4.0);
      }

      // Panneaux de voies bleus émaillés "VOIE 1", "VOIE 2"
      {
        const sign1 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: makeTrackSignTex('VOIE 1') }));
        sign1.position.set(-21, 5.0, 0);
        sign1.rotation.y = Math.PI;
        gGroup.add(sign1);

        const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: makeTrackSignTex('VOIE 2') }));
        sign2.position.set(-43, 5.0, 0);
        gGroup.add(sign2);
      }

      // -----------------------------------------------------------------
      // 5. PLACE DE LA GARE (LE PARVIS) & TRAMWAY
      // -----------------------------------------------------------------
      // Arrêt de tramway sur le Parvis (X = 54, Z = 12)
      {
        const tramShelterMat = new THREE.MeshStandardMaterial({ color: 0x242830, metalness: 0.8, roughness: 0.3 });
        const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.2, 14.0), tramShelterMat);
        shelterRoof.position.set(54, 3.4, 12);
        gGroup.add(shelterRoof);

        const shelterGlass = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 2.8), glassMat);
        shelterGlass.position.set(55.9, 1.6, 12);
        shelterGlass.rotation.y = Math.PI / 2;
        gGroup.add(shelterGlass);

        // Poteaux de l'abri
        for (const pz of [6, 12, 18]) {
          const pCol = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), tramShelterMat);
          pCol.position.set(54, 1.7, pz);
          gGroup.add(pCol);
        }
        collision.addBox(54, 12, 4.0, 14.0, 0, 3.4);
        lightSources.push({ x: 54, y: 3.2, z: 12, color: 0xffeedd, intensity: 8, dist: 12 });
      }

      // Lampadaires de la place de la Gare
      const lampGeo = new THREE.CylinderGeometry(0.12, 0.16, 6.0, 8);
      const lampHeadGeo = new THREE.SphereGeometry(0.4, 8, 8);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x1f242d, metalness: 0.7, roughness: 0.3 });
      const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });

      const plazaLamps = [
        [68, -25], [68, 0], [68, 25], [68, 50],
        [90, -25], [90, 0], [90, 25], [90, 50]
      ];
      for (const [lx, lz] of plazaLamps) {
        const lPole = new THREE.Mesh(lampGeo, lampMat);
        lPole.position.set(lx, 3.0, lz);
        gGroup.add(lPole);

        const lHead = new THREE.Mesh(lampHeadGeo, lampHeadMat);
        lHead.position.set(lx, 6.0, lz);
        gGroup.add(lHead);

        collision.addBox(lx, lz, 0.4, 0.4, 0, 6.0);
        lightSources.push({ x: lx, y: 5.8, z: lz, color: 0xffe8c0, intensity: 12, dist: 18 });
      }

      scene.add(gGroup);
    }
  };
}
