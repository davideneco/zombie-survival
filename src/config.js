// Tous les réglages du jeu au même endroit : modifie-les pour équilibrer la difficulté.
export const CONFIG = {
  map: 'strasbourg', // 'strasbourg' (lieu réel OpenStreetMap) ou 'arena' (arène de test)
  // Strasbourg : toute la Grande Île (données dans public/data/area.json, voir tools/fetch-osm.mjs)
  startHint: { x: 4.3, z: -35.7 }, // point de départ (place du Marché-Neuf, centre de l'ancienne carte), en mètres depuis le centre des données
  cityHint: { x: -221, z: -156 }, // un point du réseau de rues principal (place Kléber)
  breaches: 3,                     // secours : bâtiments à effondrer si aucun passage sous immeuble ne relie la place à la ville
  zones: {
    cutsX: [-420, 170],   // lignes de coupe est-ouest entre les 3 colonnes de zones
    cutZ: 0,              // ligne de coupe nord-sud entre les 2 rangées (au sud de la place du Marché-Neuf et de ses passages)
    basePrice: 750,       // prix de la première porte
    priceStep: 500,       // supplément par zone plus éloignée
  },
  arenaHalf: 30,    // arène de test : 60 x 60 m

  player: {
    radius: 0.4,
    eye: 1.7,
    walkSpeed: 5,
    sprintSpeed: 8,
    jumpSpeed: 6.5,
    gravity: 20,
    maxHealth: 100,
    regenDelay: 5,   // secondes sans dégâts avant de se soigner
    regenRate: 25,   // PV / seconde
    startPoints: 500,
  },

  weapons: {
    rifle: {
      id: 'rifle',
      name: "FUSIL D'ASSAUT",
      type: 'auto',
      damage: 36,
      headMult: 2.5,
      magSize: 30,
      startReserve: 120,
      maxReserve: 180,
      fireRate: 9.5,
      reloadTime: 1.8,
      spread: 0.012,
      range: 90,
      price: 0,
      ammoPrice: 300,
    },
    shotgun: {
      id: 'shotgun',
      name: "FUSIL À POMPE",
      type: 'shotgun',
      pellets: 8,
      damage: 26,
      headMult: 1.8,
      magSize: 6,
      startReserve: 30,
      maxReserve: 48,
      fireRate: 1.3,
      reloadTime: 2.4,
      spread: 0.046,
      range: 35,
      price: 750,
      ammoPrice: 350,
    },
    smg: {
      id: 'smg',
      name: "PISTOLET-MITRAILLEUR",
      type: 'auto',
      damage: 24,
      headMult: 2.2,
      magSize: 32,
      startReserve: 128,
      maxReserve: 224,
      fireRate: 13.5,
      reloadTime: 1.5,
      spread: 0.022,
      range: 65,
      price: 1000,
      ammoPrice: 500,
    },
    lmg: {
      id: 'lmg',
      name: 'MITRAILLEUSE RPK',
      type: 'auto',
      damage: 44,
      headMult: 2,
      magSize: 75,
      startReserve: 300,
      maxReserve: 450,
      fireRate: 10.5,
      reloadTime: 3.6,
      spread: 0.028,
      range: 90,
      price: 2500,
      ammoPrice: 1000,
    },
    sniper: {
      id: 'sniper',
      name: 'FUSIL DE PRÉCISION',
      type: 'semi',
      damage: 340,
      headMult: 3.5,
      magSize: 5,
      startReserve: 30,
      maxReserve: 45,
      fireRate: 1.1,
      reloadTime: 2.8,
      spread: 0.0015,
      range: 200,
      pierce: 4,          // traverse jusqu'à 4 zombies
      adsFov: 25,         // lunette
      price: 1750,
      ammoPrice: 700,
    },
    magnum: {
      id: 'magnum',
      name: 'REVOLVER .357',
      type: 'semi',
      damage: 190,
      headMult: 3,
      magSize: 6,
      startReserve: 48,
      maxReserve: 72,
      fireRate: 3.2,
      reloadTime: 2.2,
      spread: 0.006,
      range: 80,
      pierce: 2,
      boxOnly: true,
      ammoPrice: 500,
    },
    raygun: {
      id: 'raygun',
      name: 'PISTOLET À RAYONS',
      type: 'semi',
      damage: 700,
      headMult: 1.5,
      magSize: 20,
      startReserve: 160,
      maxReserve: 200,
      fireRate: 4.2,
      reloadTime: 2.6,
      spread: 0.008,
      range: 100,
      splash: { radius: 2.8, damage: 500 }, // explosion à l'impact
      tracer: 0x33ff55,
      boxOnly: true,
      ammoPrice: 1500,
    },
  },

  // Noms des armes améliorées au Pack-a-Punch
  papNames: {
    rifle: 'M4 ÉCLIPSE', shotgun: 'LE BROYEUR', smg: 'PM INFERNAL', lmg: 'RPK DÉVASTATEUR',
    sniper: 'ŒIL DU DÉMON', magnum: 'LE VENGEUR', raygun: 'PORTE-TONNERRE',
  },

  // Boîte mystère : arme au hasard (poids = chance relative)
  box: { price: 950, spin: 2.6, pool: { shotgun: 3, smg: 3, lmg: 2, sniper: 2, magnum: 2, raygun: 1 } },

  // Atouts (machines) : prix et effet décrit dans le jeu
  perks: {
    juggernog: { name: 'MASTODONTE', desc: 'Santé max 250', price: 2500, color: '#d0242c', letter: 'M' },
    speedcola: { name: 'SPEED COLA', desc: 'Rechargement 2x plus rapide', price: 3000, color: '#2db34a', letter: 'S' },
    doubletap: { name: 'DOUBLE TAP', desc: 'Cadence +33 %, dégâts +25 %', price: 2000, color: '#e0a21a', letter: 'D' },
    quickrevive: { name: 'RÉANIMATION RAPIDE', desc: 'Solo : se relève seul · Co-op : réanime 2x plus vite', price: 1500, soloPrice: 500, color: '#3aa6ff', letter: 'R' },
    mulekick: { name: 'MULE KICK', desc: 'Porter 3 armes', price: 4000, color: '#3f7d3a', letter: 'K' },
    staminup: { name: 'STAMIN-UP', desc: 'Course plus rapide', price: 2000, color: '#e8d24a', letter: 'E' },
  },
  papPrice: 5000,

  grenade: { start: 2, max: 4, perRound: 2, fuse: 2.2, radius: 6.5, damage: 900, selfDamage: 60 },

  powerups: {
    dropChance: 0.05,
    duration: 25,     // durée d'activité sur le sol avant disparition
    buffDuration: 30, // durée de l'effet temporaire (Insta-Kill, Points Doubles)
  },

  zombie: {
    radius: 0.4,
    attackRange: 1.3,
    damage: 20,
    attackCooldown: 1.0,
    maxAlive: 22,
    crawlerChance: 0.12,   // à partir de la manche 4 : part de zombies rampants (sans jambes)
    crawlerRound: 4,
    legBlowChance: 0.5,    // un zombie qui survit à une explosion perd ses jambes
  },
};
