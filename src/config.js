// Tous les réglages du jeu au même endroit : modifie-les pour équilibrer la difficulté.
export const CONFIG = {
  map: 'strasbourg', // 'strasbourg' (lieu réel OpenStreetMap) ou 'arena' (arène de test)
  mapHalf: 60,      // Strasbourg : zone de jeu de 120 x 120 m
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
  },

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
  },
};
