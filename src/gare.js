import * as THREE from 'three';

// =====================================================================
//  Gare de Strasbourg (Gare Centrale de Strasbourg)
//  Architecture fidèle et détaillée :
//   1. La Verrière ("La Bulle" contemporaine de Jean-Marie Duthilleul, 2007)
//   2. La Façade Monumentale en grès rose des Vosges (Johann Eduard Jacobsthal, 1883)
//   3. Le Bâtiment Historique de 1883 avec ses 3 grands halls :
//      - Hall Central (Vestibule des pas perdus, Piano SNCF, boutique Paul, Relay, Grand Tableau des Départs)
//      - Hall Nord (Espace Vente & Billetterie SNCF, rangée de bornes jaunes TER, banquettes d'attente)
//      - Hall Sud (Consignes automatiques de bagages, distributeurs Selecta, DAB, commodités)
//   4. Les Quais & Voies Ferrées :
//      - Quai 1 de plain-pied avec bande podotactile jaune et Pack-a-Punch
//      - Fosse de ballast et rails (Voie 1)
//      - Quai 2/3 (îlot central surélevé) avec abris vitrés et édicule du souterrain
//      - Rame de train TER Fluo Grand Est complète à l'échelle (32 m) praticable de l'intérieur
//      - Grande Marquise historique en fonte à double verrière zénithale
//   5. Place de la Gare (Parvis) avec arrêt de tramway CTS, voies et éclairage urbain.
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

// ---------------------------------------------------------------------
//  TEXTURES PROCÉDURALES RÉALISTES
// ---------------------------------------------------------------------

// Enseigne lumineuse "GARE DE STRASBOURG"
function makeGareSignTex() {
  return canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 54px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GARE DE STRASBOURG', w / 2, h / 2);
  });
}

// Grand tableau d'affichage des départs SNCF (split-flap jaune & blanc rétro-éclairé)
function makeDeparturesBoardTex() {
  return canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#1a1f2c';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // En-tête bleu SNCF
    ctx.fillStyle = '#004494';
    ctx.fillRect(10, 10, w - 20, 56);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Trebuchet MS", sans-serif';
    ctx.fillText('SNCF VOYAGEURS — DÉPARTS GARE DE STRASBOURG', 30, 46);

    // Logo flèche SNCF stylisé
    ctx.fillStyle = '#ce1126';
    ctx.beginPath();
    ctx.moveTo(w - 110, 18); ctx.lineTo(w - 40, 18); ctx.lineTo(w - 60, 58); ctx.lineTo(w - 130, 58);
    ctx.closePath();
    ctx.fill();

    // Colonnes
    ctx.fillStyle = '#8ea1b8';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('HEURE', 30, 92);
    ctx.fillText('TRAIN', 120, 92);
    ctx.fillText('N°', 230, 92);
    ctx.fillText('DESTINATION', 340, 92);
    ctx.fillText('VOIE', 780, 92);
    ctx.fillText('SITUATION', 870, 92);

    ctx.strokeStyle = '#2b3245';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(20, 102); ctx.lineTo(w - 20, 102); ctx.stroke();

    const trains = [
      ['14:22', 'TGV INOUI', '2418', "PARIS GARE DE L'EST", '1', "À L'HEURE", '#ffff33', '#00ff88'],
      ['14:35', 'TER Fluo', '831412', 'COLMAR - MULHOUSE - BÂLE', '2', "À L'HEURE", '#ffff33', '#00ff88'],
      ['14:48', 'TER Fluo', '830105', 'NANCY VILLE', '4', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:02', 'ICE DB', '9568', 'KARLSRUHE - FRANKFURT (M)', '1', 'RETARD 10 MIN', '#ffcc00', '#ffaa00'],
      ['15:15', 'TER Fluo', '832320', 'SÉLESTAT - STRASBOURG', '3', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:30', 'TGV INOUI', '9876', 'LYON PART-DIEU - MARSEILLE', '2', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:42', 'TER Fluo', '834210', 'HAGUENAU - WISSEMBOURG', '5', "À L'HEURE", '#ffff33', '#00ff88'],
      ['15:58', 'TGV INOUI', '2430', "PARIS GARE DE L'EST", '1', "À L'HEURE", '#ffff33', '#00ff88']
    ];

    let y = 134;
    for (const [time, type, no, dest, voie, status, col, statCol] of trains) {
      ctx.fillStyle = '#12151c';
      ctx.fillRect(20, y - 20, w - 40, 30);
      ctx.strokeStyle = '#1b202c';
      ctx.strokeRect(20, y - 20, w - 40, 30);

      ctx.strokeStyle = '#000000';
      ctx.beginPath(); ctx.moveTo(20, y - 5); ctx.lineTo(w - 20, y - 5); ctx.stroke();

      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(time, 30, y);

      ctx.fillStyle = col;
      ctx.fillText(type, 120, y);

      ctx.fillStyle = '#cccccc';
      ctx.fillText(no, 230, y);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(dest, 340, y);

      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(voie, 795, y);

      ctx.fillStyle = statCol;
      ctx.font = 'bold 15px monospace';
      ctx.fillText(status, 860, y);

      y += 42;
    }
  });
}

// Horloge de gare ronde rétro-éclairée avec trotteuse rouge
function makeClockTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = 12; ctx.stroke();

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = '#111111';
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r1 = w / 2 - 24, r2 = w / 2 - (i % 3 === 0 ? 44 : 34);
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

    ctx.strokeStyle = '#ce1126'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -90); ctx.stroke();
    ctx.fillStyle = '#ce1126'; ctx.beginPath(); ctx.arc(0, -70, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

// Façade Boulangerie Paul (bois laqué noir, lettres dorées, vitrine)
function makePaulBakeryTex() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#151515'; // Boiserie noire laquée
    ctx.fillRect(0, 0, w, h);

    // Moulures dorées
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, w - 20, 60);

    // Enseigne dorée PAUL
    ctx.fillStyle = '#d4af37';
    ctx.font = 'bold 38px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUL', w / 2, 48);

    ctx.font = '12px "Times New Roman", serif';
    ctx.fillText('MAISON DE QUALITÉ FONDÉE EN 1889', w / 2, 64);

    // Vitrine de viennoiseries & pains
    ctx.fillStyle = '#222222';
    ctx.fillRect(20, 80, w - 40, 150);
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 80, w - 40, 150);

    // Étagères avec croissants et baguettes
    ctx.fillStyle = '#d4a359';
    for (let row = 0; row < 3; row++) {
      const y = 110 + row * 45;
      ctx.fillRect(35, y + 15, w - 70, 4); // clayette
      for (let col = 0; col < 8; col++) {
        const x = 50 + col * 52;
        ctx.beginPath();
        ctx.arc(x, y + 6, 12, 0, Math.PI, true);
        ctx.fill();
      }
    }
  });
}

// Kiosque Relay (presse, rouge et blanc officiel)
function makeRelayTex() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d61827'; // Rouge vif Relay
    ctx.fillRect(0, 0, w, h);

    // Bandeau enseigne
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(15, 15, w - 30, 65);

    ctx.fillStyle = '#d61827';
    ctx.font = 'bold 48px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Relay', w / 2, 62);

    // Rayonnages de presse et livres
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(20, 95, w - 40, 145);

    // Magazines colorés
    const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#e11d48'];
    for (let r = 0; r < 3; r++) {
      const y = 105 + r * 46;
      for (let c = 0; c < 12; c++) {
        const x = 32 + c * 38;
        ctx.fillStyle = colors[(r * 5 + c) % colors.length];
        ctx.fillRect(x, y, 28, 38);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 4, y + 6, 20, 4); // titre
      }
    }
  });
}

// Guichets de vente SNCF & Billetterie
function makeTicketCountersTex() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a2b1f'; // Chêne foncé mouluré
    ctx.fillRect(0, 0, w, h);

    // En-tête bleu
    ctx.fillStyle = '#004494';
    ctx.fillRect(10, 10, w - 20, 45);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ESPACE DE VENTE SNCF VOYAGEURS', w / 2, 40);

    // 4 postes de guichet avec passe-monnaie et vitres
    for (let i = 0; i < 4; i++) {
      const x = 25 + i * 120;
      ctx.fillStyle = '#1e2430';
      ctx.fillRect(x, 65, 105, 110);
      ctx.strokeStyle = '#4b5563';
      ctx.strokeRect(x, 65, 105, 110);

      // Micro & voyant
      ctx.fillStyle = '#22c55e';
      ctx.beginPath(); ctx.arc(x + 52, 80, 5, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(`GUICHET ${i + 1}`, x + 52, 100);

      // Passe-monnaie en inox
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(x + 20, 155, 65, 15);
    }
  });
}

// Bornes automatiques SNCF (jaune TER et blanche TGV)
function makeTicketKiosksTex() {
  return canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#262930';
    ctx.fillRect(0, 0, w, h);

    // Moitié gauche : Borne TER Fluo Grand Est (Jaune / Bleue)
    ctx.fillStyle = '#ffd100'; // Jaune TER
    ctx.fillRect(10, 10, 110, h - 20);
    ctx.fillStyle = '#004494';
    ctx.fillRect(20, 30, 90, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TER Fluo', 65, 55);

    // Écran tactile
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(25, 90, 80, 110);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('ACHAT BILLETS', 65, 145);

    // Fente carte et distributeur
    ctx.fillStyle = '#475569';
    ctx.fillRect(35, 230, 60, 8);
    ctx.fillRect(30, 310, 70, 35);

    // Moitié droite : Borne TGV Inoui (Blanche / Rouge)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(135, 10, 110, h - 20);
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(145, 30, 90, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('TGV INOUI', 190, 55);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(150, 90, 80, 110);
    ctx.fillStyle = '#fb7185';
    ctx.fillText('BILLETTERIE', 190, 145);

    ctx.fillStyle = '#475569';
    ctx.fillRect(160, 230, 60, 8);
    ctx.fillRect(155, 310, 70, 35);
  });
}

// Casiers de consigne automatique à bagages (bleu SNCF)
function makeLockersTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1e3a8a'; // Bleu consigne
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#172554';
    ctx.lineWidth = 3;

    // Grille de casiers 4x4
    const cw = w / 4, ch = h / 4;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = c * cw, y = r * ch;
        ctx.strokeRect(x, y, cw, ch);

        // Clavier numérique & voyant
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x + cw - 20, y + ch / 2 - 10, 14, 20);

        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x + cw - 16, y + ch / 2 - 6, 6, 4);

        // Numéro de casier
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${r * 4 + c + 1}`, x + 6, y + 16);
      }
    }
  });
}

// Panneau directionnel émaillé SNCF
function makeSncfSignTex(title, subtitle) {
  return canvasTex(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#003399';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 32px "Trebuchet MS", sans-serif';
    ctx.fillText(title, w / 2, subtitle ? 52 : 72);

    if (subtitle) {
      ctx.font = '18px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(subtitle, w / 2, 92);
    }
  });
}

// Façade historique en grès rose des Vosges (Jacobsthal 1883)
function makeHistoricFacadeTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#a65d50'; // Grès rose des Vosges
    ctx.fillRect(0, 0, w, h);

    // Appareillage de pierres à bossages
    const rows = 12, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      ctx.strokeStyle = '#6e382e';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();

      const cols = 6, cw = w / cols, offset = (r % 2) * (cw / 2);
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + offset;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rh); ctx.stroke();

        // Léger grain pierre naturelle
        ctx.fillStyle = (r + c) % 3 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
        ctx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
      }
    }

    // Corniche néo-renaissance en tête
    ctx.fillStyle = '#8f4a3d';
    ctx.fillRect(0, 0, w, 24);
    ctx.strokeStyle = '#54261d';
    ctx.strokeRect(0, 0, w, 24);
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
        ctx.fillStyle = (i + j) % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(ox + 4, oy + 4, c - 8, c - 8);
      }
    }
  });
}

// Sol hall historique damier marbre deux tons
function makeHistoricFloorTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8f887f';
    ctx.fillRect(0, 0, w, h);
    const n = 8, c = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dark = (i + j) % 2 === 0;
        ctx.fillStyle = dark ? '#2e2b26' : '#d8d2c6';
        ctx.fillRect(i * c, j * c, c, c);
        ctx.strokeStyle = '#1c1915'; ctx.lineWidth = 1.5;
        ctx.strokeRect(i * c, j * c, c, c);
      }
    }
  });
}

// Sol des quais avec bande podotactile jaune fluo
function makePlatformTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6b7280'; // Granit gris de quai
    ctx.fillRect(0, 0, w, h);

    // Dalles de bordure
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 3;
    for (let y = 0; y < h; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = 0; x < w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Bande d'éveil de vigilance podotactile (bande jaune en bord de quai)
    ctx.fillStyle = '#facc15'; // Jaune sécurité SNCF
    ctx.fillRect(0, 0, 80, h);
    ctx.strokeStyle = '#ca8a04';
    ctx.strokeRect(0, 0, 80, h);

    // Clous podotactiles en relief
    ctx.fillStyle = '#ca8a04';
    for (let py = 12; py < h; py += 24) {
      for (let px = 12; px < 70; px += 20) {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// Ballast et traverses de voies ferrées
function makeBallastTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#262930'; // Ballast basalte sombre
    ctx.fillRect(0, 0, w, h);

    // Cailloux de ballast aléatoires
    for (let i = 0; i < 600; i++) {
      const bx = Math.random() * w, by = Math.random() * h;
      ctx.fillStyle = Math.random() < 0.5 ? '#374151' : '#1f2937';
      ctx.beginPath();
      ctx.arc(bx, by, 3 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Traverses de bois
    ctx.fillStyle = '#1c1512';
    for (let y = 0; y < h; y += 72) {
      ctx.fillRect(0, y, w, 32);
      ctx.strokeStyle = '#0f0a08';
      ctx.strokeRect(0, y, w, 32);
      // Platines de fixation en acier
      ctx.fillStyle = '#64748b';
      ctx.fillRect(80, y + 8, 24, 16);
      ctx.fillRect(w - 104, y + 8, 24, 16);
      ctx.fillStyle = '#1c1512';
    }
  });
}

// Livrée extérieure de la rame TER Fluo Grand Est
function makeTerLiveryTex() {
  return canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d1d5db'; // Métal gris clair argenté
    ctx.fillRect(0, 0, w, h);

    // Pavillon & bandeau supérieur bleu TER
    ctx.fillStyle = '#004ca8';
    ctx.fillRect(0, 30, w, 90);

    // Liseré vert pomme Fluo Grand Est
    ctx.fillStyle = '#84cc16';
    ctx.fillRect(0, 120, w, 14);

    // Vitres passagers fumées avec montants noirs
    ctx.fillStyle = '#0f172a';
    const nWin = 8, winW = 85, winH = 135, gap = 40;
    for (let i = 0; i < nWin; i++) {
      const x = 30 + i * (winW + gap);
      ctx.fillRect(x, 155, winW, winH);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 4;
      ctx.strokeRect(x, 155, winW, winH);

      // Reflet zénithal
      ctx.fillStyle = '#38bdf8';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x + 8, 162, winW - 16, 26);
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#0f172a';
    }

    // Bas de caisse gris anthracite
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 420, w, 92);

    // Logos TER Fluo
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.fillText('TER Fluo', 50, 85);
    ctx.font = '20px sans-serif';
    ctx.fillText('Grand Est', 215, 85);
  });
}

// ---------------------------------------------------------------------
//  PLAN & DIMENSIONS DE LA GARE DE STRASBOURG
// ---------------------------------------------------------------------

export function planGare(buildings, parts, rails, platforms) {
  // Délimitation des 3 grands secteurs de la gare :
  //  1. Verrière moderne (La Bulle) : X [18, 44], Z [-65, 65]
  //  2. Bâtiment historique (1883) : X [-14, 18], Z [-58, 58]
  //     - Hall Nord : Z [-58, -20]
  //     - Hall Central : Z [-20, 20]
  //     - Hall Sud : Z [20, 58]
  //  3. Quais & Voies : X [-55, -14], Z [-70, 70]
  const insideVerriere = (x, z) => x >= 17.5 && x <= 44.5 && z >= -65 && z <= 65;
  const insideHistoricBuilding = (x, z) => x >= -14.5 && x <= 18.5 && z >= -58 && z <= 58;
  const insideQuais = (x, z) => x >= -55 && x <= -14 && z >= -70 && z <= 70;

  const insideInner = (x, z) => insideVerriere(x, z) || insideHistoricBuilding(x, z) || insideQuais(x, z);

  // Hauteur sous plafond à l'aplomb de (x, z)
  const ceilAt = (x, z) => {
    if (insideVerriere(x, z)) {
      // Voûte elliptique s'élevant de X=44 (sol parvis) à X=31 (sommet 16,5 m),
      // puis redescendant s'ancrer sur la corniche historique à X=18 (Y=13,5 m).
      const u = (x - 31) / 13.0;
      return 13.5 + 3.0 * Math.max(0, 1 - u * u);
    }
    if (insideHistoricBuilding(x, z)) {
      return 10.5; // Plafond néo-classique monumental du bâtiment historique
    }
    if (insideQuais(x, z)) {
      return 7.2; // Marquise métallique des quais
    }
    return null; // Ciel ouvert à l'extérieur
  };

  const cutsOf = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return [];
    const cuts = [];
    const testDoor = (px, pz, rw) => {
      const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
      const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / l2));
      const nx = ax + abx * t, nz = az + abz * t;
      if (Math.hypot(nx - px, nz - pz) < 1.8) {
        const dt = (rw / len);
        cuts.push([Math.max(0, t - dt), Math.min(1, t + dt)]);
      }
    };

    // Entrées Verrière Est (depuis la place)
    testDoor(44, -25, 4.0);
    testDoor(44, 0, 5.0);
    testDoor(44, 25, 4.0);

    // Portails historiques Verrière -> Halls
    testDoor(18, -38, 4.0); // vers Hall Nord
    testDoor(18, 0, 5.0);   // vers Hall Central
    testDoor(18, 38, 4.0);  // vers Hall Sud

    // Portes Halls -> Quai 1
    testDoor(-14, -38, 4.0);
    testDoor(-14, 0, 5.0);
    testDoor(-14, 38, 4.0);

    return cuts;
  };

  return {
    insideInner,
    ceilAt,
    cutsOf,
    seed: [2, 0],
    pap: { x: -18, z: -35, yaw: Math.PI },
    clock: { x: 18, z: 0, yaw: Math.PI / 2 },

    finish(scene, collision, lightSources, props) {
      const gGroup = new THREE.Group();
      gGroup.name = 'GareDeStrasbourg';

      // Matériaux partagés
      const stoneMat = new THREE.MeshStandardMaterial({
        map: makeHistoricFacadeTex(),
        roughness: 0.82,
        metalness: 0.05
      });
      const steelMat = new THREE.MeshStandardMaterial({
        color: 0x22262e,
        roughness: 0.45,
        metalness: 0.85
      });
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xa4d4f2,
        roughness: 0.08,
        metalness: 0.15,
        transmission: 0.85,
        transparent: true,
        opacity: 0.4,
        ior: 1.52,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      // -----------------------------------------------------------------
      // 1. SOLS INTÉRIEURS DISTINCTS PAR ZONE
      // -----------------------------------------------------------------
      // Sol Verrière moderne (granit clair)
      {
        const vTex = makeVerriereFloorTex();
        vTex.repeat.set(7, 26);
        const vGeo = new THREE.PlaneGeometry(26, 130);
        const vMesh = new THREE.Mesh(vGeo, new THREE.MeshStandardMaterial({ map: vTex, roughness: 0.38 }));
        vMesh.rotation.x = -Math.PI / 2;
        vMesh.position.set(31, 0.02, 0);
        vMesh.receiveShadow = true;
        gGroup.add(vMesh);
      }

      // Sol Bâtiment Historique (damier marbre blanc/ardoise)
      {
        const hTex = makeHistoricFloorTex();
        hTex.repeat.set(10, 32);
        const hGeo = new THREE.PlaneGeometry(32, 116);
        const hMesh = new THREE.Mesh(hGeo, new THREE.MeshStandardMaterial({ map: hTex, roughness: 0.35 }));
        hMesh.rotation.x = -Math.PI / 2;
        hMesh.position.set(2, 0.03, 0);
        hMesh.receiveShadow = true;
        gGroup.add(hMesh);
      }

      // -----------------------------------------------------------------
      // 2. LA VERRIÈRE MODERNE ("LA BULLE" DUTHILLEUL 2007)
      // -----------------------------------------------------------------
      // Structure portante en nervures d'acier cintrées reliant le parvis (X=44)
      // au sommet de la façade historique (X=18, Y=13.5).
      const nRibs = 24;
      const zMin = -64, zMax = 64;
      for (let i = 0; i <= nRibs; i++) {
        const rz = zMin + (i / nRibs) * (zMax - zMin);
        const curvePts = [];
        const nSteps = 24;
        for (let s = 0; s <= nSteps; s++) {
          const t = s / nSteps; // 0 = parvis (X=44), 1 = façade (X=18)
          const rx = 44.0 - 26.0 * t;
          // Hauteur en parabole asymétrique culminant à 16.5m
          const ry = Math.sin(t * Math.PI) * 11.5 + (1 - t) * 0.0 + t * 13.5;
          curvePts.push(new THREE.Vector3(rx, ry, rz));
        }
        const curve = new THREE.CatmullRomCurve3(curvePts);
        const rib = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.18, 8, false), steelMat);
        rib.castShadow = true;
        gGroup.add(rib);
      }

      // Nappe vitrée de la verrière (coque transparente)
      {
        const glassGeo = new THREE.CylinderGeometry(15.5, 15.5, 128, 36, 1, true, -Math.PI * 0.15, Math.PI * 0.85);
        const glassMesh = new THREE.Mesh(glassGeo, glassMat);
        glassMesh.rotation.z = Math.PI / 2;
        glassMesh.position.set(31, 3.5, 0);
        gGroup.add(glassMesh);
      }

      // Façade vitrée extérieure Est (X = 44) avec entrées automatiques
      const addVerriereEntrance = (z0, z1) => {
        const len = z1 - z0;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 6.5), glassMat);
        p.position.set(44, 3.25, (z0 + z1) / 2);
        p.rotation.y = -Math.PI / 2;
        gGroup.add(p);
        collision.addBox(44, (z0 + z1) / 2, 0.4, len, 0, 6.5);
      };
      // Entrées automatiques ouvertes à Z ~ -25, 0, 25
      addVerriereEntrance(-64, -28);
      addVerriereEntrance(-22, -3);
      addVerriereEntrance(3, 22);
      addVerriereEntrance(28, 64);

      // Enseigne lumineuse "GARE DE STRASBOURG" au-dessus du portail central de la verrière
      {
        const signTex = makeGareSignTex();
        const signMat = new THREE.MeshStandardMaterial({
          map: signTex,
          emissive: 0xffffff,
          emissiveMap: signTex,
          emissiveIntensity: 0.95,
          roughness: 0.3
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), signMat);
        sign.position.set(44.2, 5.8, 0);
        sign.rotation.y = Math.PI / 2;
        gGroup.add(sign);
      }

      // Trémie d'escalator & descente vers le tramway souterrain au centre de la verrière
      {
        const wellX = 31, wellZ = 12, wellW = 6, wellL = 14;
        const wellG = new THREE.BoxGeometry(wellW, 1.1, wellL);
        const wellWire = new THREE.LineSegments(new THREE.EdgesGeometry(wellG), new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
        wellWire.position.set(wellX, 0.55, wellZ);
        gGroup.add(wellWire);

        // Garde-corps en verre sécurit
        const railMat = new THREE.MeshStandardMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.5 });
        const railN = new THREE.Mesh(new THREE.BoxGeometry(wellW, 1.1, 0.1), railMat);
        railN.position.set(wellX, 0.55, wellZ - wellL / 2);
        const railS = new THREE.Mesh(new THREE.BoxGeometry(wellW, 1.1, 0.1), railMat);
        railS.position.set(wellX, 0.55, wellZ + wellL / 2);
        const railE = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, wellL), railMat);
        railE.position.set(wellX + wellW / 2, 0.55, wellZ);
        const railW = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, wellL), railMat);
        railW.position.set(wellX - wellW / 2, 0.55, wellZ);
        gGroup.add(railN, railS, railE, railW);

        collision.addBox(wellX + wellW / 2, wellZ, 0.3, wellL, 0, 1.2);
        collision.addBox(wellX - wellW / 2, wellZ, 0.3, wellL, 0, 1.2);
        collision.addBox(wellX, wellZ - wellL / 2, wellW, 0.3, 0, 1.2);
        collision.addBox(wellX, wellZ + wellL / 2, wellW, 0.3, 0, 1.2);

        // Lueur bleue tramway souterrain
        lightSources.push({ x: wellX, y: -0.5, z: wellZ, color: 0x0284c7, intensity: 12, dist: 15 });
      }

      // Totems digitaux & bornes automatiques dans la verrière
      {
        const kioskTex = makeTicketKiosksTex();
        const kioskMat = new THREE.MeshStandardMaterial({ map: kioskTex, roughness: 0.4 });
        for (const [kx, kz] of [[36, -15], [36, -8], [36, 28], [36, 35]]) {
          const kMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.8), kioskMat);
          kMesh.position.set(kx, 1.1, kz);
          kMesh.rotation.y = -Math.PI / 2;
          gGroup.add(kMesh);
          collision.addBox(kx, kz, 1.0, 1.8, 0, 2.2);
        }
      }

      // -----------------------------------------------------------------
      // 3. LA FAÇADE HISTORIQUE (1883) EN GRÈS ROSE DES VOSGES (X = 18)
      // -----------------------------------------------------------------
      // Mur vertical monumental de 13,5 m de haut séparant la Verrière des 3 Halls
      const addHistoricFacadeSection = (z0, z1) => {
        const len = z1 - z0;
        const wGeo = new THREE.BoxGeometry(1.8, 13.5, len);
        const wMesh = new THREE.Mesh(wGeo, stoneMat);
        wMesh.position.set(18, 6.75, (z0 + z1) / 2);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(18, (z0 + z1) / 2, 1.8, len, 0, 13.5);
      };

      // 3 grands portails d'entrée cintrés (Hall Nord à Z=-38, Hall Central à Z=0, Hall Sud à Z=38)
      addHistoricFacadeSection(-58, -42);
      addHistoricFacadeSection(-34, -4);
      addHistoricFacadeSection(4, 34);
      addHistoricFacadeSection(42, 58);

      // Linteaux monumentaux et frontons au-dessus des 3 portails d'accès
      for (const pz of [-38, 0, 38]) {
        // Linteau supérieur au-dessus de l'ouverture
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.5, 8.0), stoneMat);
        lintel.position.set(18, 6.0 + 3.75, pz);
        gGroup.add(lintel);

        // Corniche moulurée
        const cornice = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 9.0), stoneMat);
        cornice.position.set(18, 13.2, pz);
        gGroup.add(cornice);
      }

      // Grande horloge historique centrale au-dessus du portail d'honneur (X = 18, Z = 0)
      {
        const clockTex = makeClockTex();
        const clockMat = new THREE.MeshStandardMaterial({
          map: clockTex,
          roughness: 0.25,
          emissive: 0xffffff,
          emissiveMap: clockTex,
          emissiveIntensity: 0.8
        });
        const clockMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 32), clockMat);
        clockMesh.rotation.z = Math.PI / 2;
        clockMesh.position.set(18.2, 7.5, 0);
        gGroup.add(clockMesh);
      }

      // -----------------------------------------------------------------
      // 4. LE BÂTIMENT HISTORIQUE : LES 3 GRANDS HALLS
      // -----------------------------------------------------------------
      // Plafond à caissons recouvrant l'ensemble des halls (Y = 10.5)
      {
        const ceilGeo = new THREE.PlaneGeometry(32, 116);
        const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdfdad2, roughness: 0.8 });
        const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
        ceilMesh.rotation.x = Math.PI / 2;
        ceilMesh.position.set(2, 10.45, 0);
        gGroup.add(ceilMesh);
      }

      // Murs pignons d'extrémité Nord (Z = -58) et Sud (Z = 58)
      const addEndWall = (pz) => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(32, 10.5, 1.5), stoneMat);
        w.position.set(2, 5.25, pz);
        gGroup.add(w);
        collision.addBox(2, pz, 32, 1.5, 0, 10.5);
      };
      addEndWall(-58);
      addEndWall(58);

      // Arcades de séparation entre les 3 halls (à Z = -20 et Z = 20)
      const addHallDivider = (pz) => {
        // Pilier Est (vers façade)
        const pE = new THREE.Mesh(new THREE.BoxGeometry(10, 10.5, 1.4), stoneMat);
        pE.position.set(13, 5.25, pz);
        // Pilier Ouest (vers quais)
        const pW = new THREE.Mesh(new THREE.BoxGeometry(10, 10.5, 1.4), stoneMat);
        pW.position.set(-9, 5.25, pz);
        // Linteau d'arcade centrale de 12 mètres d'ouverture
        const pArc = new THREE.Mesh(new THREE.BoxGeometry(12, 4.5, 1.4), stoneMat);
        pArc.position.set(2, 8.25, pz);

        gGroup.add(pE, pW, pArc);
        collision.addBox(13, pz, 10, 1.4, 0, 10.5);
        collision.addBox(-9, pz, 10, 1.4, 0, 10.5);
      };
      addHallDivider(-20); // sépare Hall Nord & Hall Central
      addHallDivider(20);  // sépare Hall Central & Hall Sud

      // Colonnes toscanes porteuses dans le Hall Central (X: 8 et -4, Z: -8 et 8)
      for (const cx of [7, -3]) {
        for (const cz of [-9, 9]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10.5, 1.2), stoneMat);
          col.position.set(cx, 5.25, cz);
          col.castShadow = true;
          gGroup.add(col);
          collision.addBox(cx, cz, 1.2, 1.2, 0, 10.5);
        }
      }

      // Lustres suspendus en fer forgé du Hall Central
      for (const [lx, lz] of [[7, -9], [7, 9], [-3, -9], [-3, 9], [2, 0]]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 8), steelMat);
        rod.position.set(lx, 10.5 - 1.75, lz);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 8, 16), steelMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(lx, 7.2, lz);
        gGroup.add(rod, ring);
        lightSources.push({ x: lx, y: 7.0, z: lz, color: 0xffb555, intensity: 14, dist: 18 });
      }

      // =================================================================
      // 4A. AMÉNAGEMENT DU HALL CENTRAL (CŒUR DE GARE)
      // =================================================================

      // LE PIANO À QUEUE NOIR SNCF (Au centre exact du Hall Central, X=2, Z=0)
      {
        const pianoMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.15, metalness: 0.3 });
        const ivoryMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });

        // Tapis circulaire rouge sous le piano
        const carpet = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 }));
        carpet.rotation.x = -Math.PI / 2;
        carpet.position.set(2, 0.04, 0);
        gGroup.add(carpet);

        // Corps du piano à queue
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.2), pianoMat);
        body.position.set(2, 0.85, 0);
        // Couvercle ouvert incliné
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 2.2), pianoMat);
        lid.position.set(2, 1.45, 0.2);
        lid.rotation.x = -0.35;
        // Clavier blanc et noir
        const keys = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.35), ivoryMat);
        keys.position.set(2, 0.95, -0.95);
        // 3 pieds en bois laqué
        const legGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.6, 8);
        const l1 = new THREE.Mesh(legGeo, pianoMat); l1.position.set(2.6, 0.3, -0.8);
        const l2 = new THREE.Mesh(legGeo, pianoMat); l2.position.set(1.4, 0.3, -0.8);
        const l3 = new THREE.Mesh(legGeo, pianoMat); l3.position.set(2.0, 0.3, 0.9);
        // Tabouret de piano
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 12), pianoMat);
        stool.position.set(2, 0.28, -1.45);

        // Panonceau "À vous de jouer — SNCF"
        const signMat = new THREE.MeshStandardMaterial({ map: makeSncfSignTex('À vous de jouer', 'SNCF'), roughness: 0.4 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), signMat);
        sign.position.set(2, 1.5, -0.8);
        sign.rotation.x = -0.2;

        gGroup.add(body, lid, keys, l1, l2, l3, stool, sign);
        collision.addBox(2, 0, 1.8, 2.4, 0, 1.8);
      }

      // BOUTIQUE PAUL (Côté Sud du Hall Central, X: -10 à -2, Z: 6 à 18)
      {
        const paulTex = makePaulBakeryTex();
        const paulMat = new THREE.MeshStandardMaterial({ map: paulTex, roughness: 0.35 });

        // Façade et comptoir Paul
        const facade = new THREE.Mesh(new THREE.BoxGeometry(7.5, 3.8, 0.4), paulMat);
        facade.position.set(-6, 1.9, 8);
        gGroup.add(facade);
        collision.addBox(-6, 8, 7.5, 0.6, 0, 3.8);

        // Auvent noir en tissu au-dessus du comptoir
        const awningMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
        const awning = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.2, 1.6), awningMat);
        awning.position.set(-6, 3.8, 8.8);
        awning.rotation.x = 0.15;
        gGroup.add(awning);

        // Mange-debout et tabourets
        for (const pz of [12, 16]) {
          const table = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.05, 16), steelMat);
          table.position.set(-6, 0.52, pz);
          gGroup.add(table);
          collision.addBox(-6, pz, 0.9, 0.9, 0, 1.1);
        }

        lightSources.push({ x: -6, y: 3.2, z: 10, color: 0xffd580, intensity: 8, dist: 12 });
      }

      // KIOSQUE RELAY (Côté Nord du Hall Central, X: -10 à -2, Z: -18 à -6)
      {
        const relayTex = makeRelayTex();
        const relayMat = new THREE.MeshStandardMaterial({ map: relayTex, roughness: 0.4 });

        const relayBox = new THREE.Mesh(new THREE.BoxGeometry(7.5, 3.8, 0.4), relayMat);
        relayBox.position.set(-6, 1.9, -8);
        gGroup.add(relayBox);
        collision.addBox(-6, -8, 7.5, 0.6, 0, 3.8);

        // Enseigne lumineuse RELAY au fronton
        const signMat = new THREE.MeshStandardMaterial({ color: 0xd61827, emissive: 0xd61827, emissiveIntensity: 0.8 });
        const signMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.9, 0.5), signMat);
        signMesh.position.set(-6, 4.0, -8.1);
        gGroup.add(signMesh);

        lightSources.push({ x: -6, y: 3.2, z: -10, color: 0xffeedd, intensity: 8, dist: 12 });
      }

      // GRAND PANNEAU DES DÉPARTS SNCF (Accroché au mur Ouest au-dessus des portes de quais)
      {
        const boardTex = makeDeparturesBoardTex();
        const boardMat = new THREE.MeshStandardMaterial({
          map: boardTex,
          emissive: 0xffffff,
          emissiveMap: boardTex,
          emissiveIntensity: 0.95,
          roughness: 0.35
        });
        const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.2), boardMat);
        boardMesh.position.set(-13.4, 6.2, 0);
        boardMesh.rotation.y = Math.PI / 2;
        gGroup.add(boardMesh);
        lightSources.push({ x: -11.5, y: 6.2, z: 0, color: 0xfff4d0, intensity: 10, dist: 14 });
      }

      // =================================================================
      // 4B. AMÉNAGEMENT DU HALL NORD (ESPACE VENTE & BILLETTERIE)
      // =================================================================
      {
        // Batterie de guichets de vente en bois
        const counterTex = makeTicketCountersTex();
        const counterMat = new THREE.MeshStandardMaterial({ map: counterTex, roughness: 0.5 });
        const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 20), counterMat);
        counter.position.set(15.5, 1.2, -38);
        gGroup.add(counter);
        collision.addBox(15.5, -38, 1.6, 20, 0, 2.5);

        // Rangée de bornes automatiques jaunes et blanches
        const kTex = makeTicketKiosksTex();
        const kMat = new THREE.MeshStandardMaterial({ map: kTex, roughness: 0.4 });
        for (let bz = -52; bz <= -24; bz += 6) {
          const bMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 1.4), kMat);
          bMesh.position.set(-12, 1.1, bz);
          gGroup.add(bMesh);
          collision.addBox(-12, bz, 0.8, 1.4, 0, 2.2);
        }

        // Banquettes d'attente en bois verni
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x543825, roughness: 0.7 });
        for (const bz of [-44, -32]) {
          const bench = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 4.5), benchMat);
          bench.position.set(2, 0.3, bz);
          gGroup.add(bench);
          collision.addBox(2, bz, 1.2, 4.5, 0, 0.8);
        }

        // Panneau directionnel suspendu
        const signMat = new THREE.MeshStandardMaterial({ map: makeSncfSignTex('ESPACE VENTE SNCF', 'Billetterie & Informations'), roughness: 0.4 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.2), signMat);
        sign.position.set(2, 7.5, -38);
        sign.rotation.y = Math.PI / 2;
        gGroup.add(sign);

        lightSources.push({ x: 2, y: 7.2, z: -38, color: 0xffeedd, intensity: 12, dist: 18 });
      }

      // =================================================================
      // 4C. AMÉNAGEMENT DU HALL SUD (CONSIGNES & COMMODITÉS)
      // =================================================================
      {
        // Casiers de consigne automatique métalliques bleus SNCF
        const lockerTex = makeLockersTex();
        const lockerMat = new THREE.MeshStandardMaterial({ map: lockerTex, roughness: 0.4, metalness: 0.3 });
        const lockers = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 18), lockerMat);
        lockers.position.set(15.5, 1.3, 38);
        gGroup.add(lockers);
        collision.addBox(15.5, 38, 1.4, 18, 0, 2.6);

        // Distributeurs automatiques de boissons et snacks
        const snackMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4 });
        for (const sz of [25, 28, 48, 51]) {
          const snack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.6), snackMat);
          snack.position.set(-12, 1.1, sz);
          gGroup.add(snack);
          collision.addBox(-12, sz, 1.2, 1.6, 0, 2.2);
        }

        // Banquettes d'attente
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x543825, roughness: 0.7 });
        for (const bz of [32, 44]) {
          const bench = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 4.5), benchMat);
          bench.position.set(2, 0.3, bz);
          gGroup.add(bench);
          collision.addBox(2, bz, 1.2, 4.5, 0, 0.8);
        }

        lightSources.push({ x: 2, y: 7.2, z: 38, color: 0xffeedd, intensity: 12, dist: 18 });
      }

      // -----------------------------------------------------------------
      // 5. LES QUAIS & LES VOIES FERRÉES
      // -----------------------------------------------------------------
      // Mur Ouest arrière du bâtiment historique (X = -14) donnant sur le Quai 1
      const addPlatformWallSection = (z0, z1) => {
        const len = z1 - z0;
        const wMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10.5, len), stoneMat);
        wMesh.position.set(-14, 5.25, (z0 + z1) / 2);
        wMesh.castShadow = true;
        gGroup.add(wMesh);
        collision.addBox(-14, (z0 + z1) / 2, 1.6, len, 0, 10.5);
      };
      // 3 grandes doubles portes vitrées automatiques d'accès au Quai 1
      addPlatformWallSection(-58, -42);
      addPlatformWallSection(-34, -4);
      addPlatformWallSection(4, 34);
      addPlatformWallSection(42, 58);

      // Linteaux au-dessus des portes de quai
      for (const pz of [-38, 0, 38]) {
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 5.5, 8.0), stoneMat);
        lintel.position.set(-14, 5.0 + 2.75, pz);
        gGroup.add(lintel);
      }

      // Sol Quai 1 (X de -14 à -22, le long du bâtiment)
      const platTex = makePlatformTex();
      platTex.repeat.set(2, 28);
      const platMat = new THREE.MeshStandardMaterial({ map: platTex, roughness: 0.6 });

      const q1Geo = new THREE.PlaneGeometry(8, 136);
      const q1 = new THREE.Mesh(q1Geo, platMat);
      q1.rotation.x = -Math.PI / 2;
      q1.position.set(-18, 0.04, 0);
      q1.receiveShadow = true;
      gGroup.add(q1);

      // Fosse Voie 1 (X de -22 à -27, ballast et rails)
      const ballastTex = makeBallastTex();
      ballastTex.repeat.set(2, 28);
      const ballastMat = new THREE.MeshStandardMaterial({ map: ballastTex, roughness: 0.9 });

      const v1Geo = new THREE.PlaneGeometry(5, 136);
      const v1 = new THREE.Mesh(v1Geo, ballastMat);
      v1.rotation.x = -Math.PI / 2;
      v1.position.set(-24.5, 0.01, 0);
      gGroup.add(v1);

      // Rails en acier luisant Voie 1
      const railSteelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.95 });
      for (const rx of [-23.5, -25.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 136), railSteelMat);
        rail.position.set(rx, 0.08, 0);
        gGroup.add(rail);
      }

      // Sol Quai 2 / 3 (Îlot central surélevé de X = -27 à -38)
      const q2Geo = new THREE.PlaneGeometry(11, 136);
      const q2 = new THREE.Mesh(q2Geo, platMat);
      q2.rotation.x = -Math.PI / 2;
      q2.position.set(-32.5, 0.04, 0);
      q2.receiveShadow = true;
      gGroup.add(q2);

      // Édicules d'escaliers vitrés émergeant sur le Quai 2 (accès souterrain)
      for (const sz of [-20, 20]) {
        const stairKiosk = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.6, 8.0), glassMat);
        stairKiosk.position.set(-32.5, 1.3, sz);
        const stairFrame = new THREE.LineSegments(new THREE.EdgesGeometry(stairKiosk.geometry), new THREE.LineBasicMaterial({ color: 0x1e293b }));
        stairFrame.position.copy(stairKiosk.position);
        gGroup.add(stairKiosk, stairFrame);
        collision.addBox(-32.5, sz, 3.5, 8.0, 0, 2.6);
      }

      // Fosse Voie 2 (X de -38 à -43, ballast et rails)
      const v2Geo = new THREE.PlaneGeometry(5, 136);
      const v2 = new THREE.Mesh(v2Geo, ballastMat);
      v2.rotation.x = -Math.PI / 2;
      v2.position.set(-40.5, 0.01, 0);
      gGroup.add(v2);

      for (const rx of [-39.5, -41.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 136), railSteelMat);
        rail.position.set(rx, 0.08, 0);
        gGroup.add(rail);
      }

      // RAME DE TRAIN TER FLUO GRAND EST SUR LA VOIE 2 (X = -40.5, Z de -16 à 16, L = 32m)
      {
        const terTex = makeTerLiveryTex();
        const terMat = new THREE.MeshStandardMaterial({ map: terTex, roughness: 0.35, metalness: 0.4 });
        const trainGroup = new THREE.Group();
        trainGroup.position.set(-40.5, 0, 0);

        // Caisse principale de la voiture TER (32 m x 3.2 m x 3.6 m)
        // Côté Ouest plein
        const wWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.6, 32), terMat);
        wWall.position.set(-1.5, 2.0, 0);
        trainGroup.add(wWall);

        // Côté Est (vers le quai 2) : 2 grandes ouvertures de portes voyageur
        const addTrainDoorWall = (z0, z1) => {
          const len = z1 - z0;
          const eWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.6, len), terMat);
          eWall.position.set(1.5, 2.0, (z0 + z1) / 2);
          trainGroup.add(eWall);
        };
        addTrainDoorWall(-16, -11);
        addTrainDoorWall(-7, 7);
        addTrainDoorWall(11, 16);

        // Plafond et plancher de la rame TER
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
        const trainFloor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, 32), floorMat);
        trainFloor.position.set(0, 0.5, 0);
        const trainRoof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 32), terMat);
        trainRoof.position.set(0, 3.8, 0);
        trainGroup.add(trainFloor, trainRoof);

        // Sièges intérieurs en velours bleu
        const seatMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.7 });
        for (let sz = -14; sz <= 14; sz += 2.2) {
          if (Math.abs(sz + 9) < 1.5 || Math.abs(sz - 9) < 1.5) continue; // espace portes
          const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.6), seatMat);
          s1.position.set(-0.9, 0.9, sz);
          const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.6), seatMat);
          s2.position.set(0.9, 0.9, sz);
          trainGroup.add(s1, s2);
        }

        // Nez profilé du TER aux deux extrémités
        const noseMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.3 });
        const noseN = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.5, 4), noseMat);
        noseN.rotation.x = -Math.PI / 2;
        noseN.position.set(0, 2.0, -17.25);
        const noseS = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.5, 4), noseMat);
        noseS.rotation.x = Math.PI / 2;
        noseS.position.set(0, 2.0, 17.25);
        trainGroup.add(noseN, noseS);

        gGroup.add(trainGroup);

        // Collisions de la rame (permettant d'entrer par les portes à Z=-9 et Z=9)
        collision.addBox(-42.0, 0, 0.4, 32, 0, 4.0); // flanc extérieur Ouest
        collision.addBox(-39.0, -13.5, 0.4, 5.0, 0, 4.0); // flanc Est Nord
        collision.addBox(-39.0, 0, 0.4, 14.0, 0, 4.0);   // flanc Est Centre
        collision.addBox(-39.0, 13.5, 0.4, 5.0, 0, 4.0);  // flanc Est Sud
        collision.addBox(-40.5, -16.5, 3.2, 1.0, 0, 4.0); // bout Nord
        collision.addBox(-40.5, 16.5, 3.2, 1.0, 0, 4.0);  // bout Sud

        // Éclairage néon intérieur de la rame
        lightSources.push({ x: -40.5, y: 3.2, z: -6, color: 0xe0f2fe, intensity: 6, dist: 10 });
        lightSources.push({ x: -40.5, y: 3.2, z: 6, color: 0xe0f2fe, intensity: 6, dist: 10 });
      }

      // LA GRANDE MARQUISE HISTORIQUE DES QUAIS (Charpente en fonte à double pente)
      {
        const canopyMat = new THREE.MeshStandardMaterial({ color: 0x243229, roughness: 0.6, metalness: 0.8 }); // Vert fonte
        for (let cz = -60; cz <= 60; cz += 15) {
          // Poteaux en fonte cannelés sur le Quai 1 et Quai 2
          const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7.2, 12), canopyMat);
          p1.position.set(-18, 3.6, cz);
          const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7.2, 12), canopyMat);
          p2.position.set(-32.5, 3.6, cz);
          gGroup.add(p1, p2);
          collision.addBox(-18, cz, 0.5, 0.5, 0, 7.2);
          collision.addBox(-32.5, cz, 0.5, 0.5, 0, 7.2);

          // Poutre treillis transversale reliant les quais
          const beam = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 0.4), canopyMat);
          beam.position.set(-30, 7.0, cz);
          gGroup.add(beam);

          // Suspension d'éclairage de quai
          lightSources.push({ x: -18, y: 5.8, z: cz, color: 0xffe2a0, intensity: 10, dist: 16 });
          lightSources.push({ x: -32.5, y: 5.8, z: cz, color: 0xffe2a0, intensity: 10, dist: 16 });
        }

        // Toit vitré de la marquise
        const roof1 = new THREE.Mesh(new THREE.PlaneGeometry(32, 136), glassMat);
        roof1.rotation.x = Math.PI / 2;
        roof1.position.set(-30, 7.2, 0);
        gGroup.add(roof1);
      }

      // Panneaux de voies bleus émaillés sur les quais
      const pMat1 = new THREE.MeshStandardMaterial({ map: makeSncfSignTex('VOIE 1', 'Strasbourg'), roughness: 0.4 });
      const pSign1 = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.8), pMat1);
      pSign1.position.set(-18, 4.2, 0);
      const pMat2 = new THREE.MeshStandardMaterial({ map: makeSncfSignTex('VOIE 2 / 3', 'Quai Central'), roughness: 0.4 });
      const pSign2 = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.8), pMat2);
      pSign2.position.set(-32.5, 4.2, 0);
      gGroup.add(pSign1, pSign2);

      // -----------------------------------------------------------------
      // 6. PLACE DE LA GARE (PARVIS EXTÉRIEUR)
      // -----------------------------------------------------------------
      // Abri de tramway CTS vitré sur la place (X = 68, Z = 12)
      {
        const tramMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
        const shelter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 16), glassMat);
        shelter.position.set(68, 1.6, 12);
        const sRoof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 16.5), tramMat);
        sRoof.position.set(68, 3.2, 12);
        gGroup.add(shelter, sRoof);
        collision.addBox(68, 12, 0.3, 16, 0, 3.2);

        // Banc de station tram
        const sBench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 }));
        sBench.position.set(68, 0.25, 12);
        gGroup.add(sBench);

        // Éclairage de l'abri tram
        lightSources.push({ x: 68, y: 3.0, z: 12, color: 0xffffff, intensity: 10, dist: 16 });
      }

      // Voies de tramway sur la place
      for (const tx of [65.5, 70.5]) {
        for (const dx of [-0.7, 0.7]) {
          const tramRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 120), railSteelMat);
          tramRail.position.set(tx + dx, 0.03, 12);
          gGroup.add(tramRail);
        }
      }

      scene.add(gGroup);
    }
  };
}
