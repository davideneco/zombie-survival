// Tous les réglages du jeu au même endroit : modifie-les pour équilibrer la difficulté.
export const CONFIG = {
  map: 'strasbourg', // 'strasbourg' (lieu réel OpenStreetMap) ou 'arena' (arène de test)
  // Strasbourg : toute la Grande Île (données dans public/data/area.json, voir tools/fetch-osm.mjs)
  startHint: { x: 4.3, z: -35.7 }, // point de départ (place du Marché-Neuf, centre de l'ancienne carte), en mètres depuis le centre des données
  cityHint: { x: -199, z: -145 }, // un point du réseau de rues principal (place Kléber)
  breaches: 3,                     // secours : bâtiments à effondrer si aucun passage sous immeuble ne relie la place à la ville
  // Secteur jouable : autour de la place du Marché-Neuf. Le reste de l'île est visible mais fermé.
  // Chaque zone part d'un vrai lieu (seed, en mètres : x vers l'est, z vers le sud) ; les cases sont attribuées
  // à la zone la plus proche en distance de marche, jusqu'à maxDist. Les portes tombent entre deux zones.
  // items : ce qu'on trouve dans la zone ('station' = borne de munitions, 'wall:<arme>', 'perk:<atout>', 'pap',
  //         'box' = un emplacement possible de la boîte mystère : il n'y a qu'une boîte, qui se déplace).
  sector: {
    maxDist: 95,        // rayon d'une zone (m, en distance de marche)
    basePrice: 750,     // prix d'une porte vers une zone voisine de la place de départ
    priceStep: 250,     // supplément par zone plus éloignée
    zones: [
      { name: 'Marché-Neuf', start: true, items: ['station', 'wall:m1911', 'wall:shotgun', 'wall:smg', 'perk:quickrevive', 'box'] },
      { name: 'Temple-Neuf', seed: { x: -35, z: -95 }, items: ['station', 'wall:arex', 'wall:mp5', 'perk:staminup', 'box'] },
      { name: 'Rue des Orfèvres', seed: { x: 40, z: -70 }, items: ['wall:famas', 'perk:speedcola', 'box'] },
      { name: 'Rue du Dôme', seed: { x: 110, z: -111 }, items: ['station', 'wall:sniper', 'wall:svd', 'box'] },
      { name: 'Grandes Arcades', seed: { x: -110, z: -45 }, items: ['station', 'wall:ak47', 'wall:p90', 'perk:mulekick', 'box'] },
      { name: 'Place Kléber', seed: { x: -199, z: -145 }, items: ['station', 'perk:juggernog', 'wall:lmg', 'wall:m249', 'box'] },
      { name: 'Place Gutenberg', seed: { x: -20, z: 90 }, items: ['station', 'perk:doubletap', 'wall:scar', 'wall:pkm', 'box'] },
      { name: 'Cathédrale', seed: { x: 103, z: 33 }, items: ['station', 'wall:deagle', 'wall:rifle', 'box'] },
      // fin de partie : l'intérieur de la cathédrale, derrière le grand portail (porte la plus chère)
      { name: 'Intérieur de la Cathédrale', seed: 'cathedral', portal: true, doorPrice: 5000, items: ['pap', 'clock', 'station', 'box'] },
    ],
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

  // Armes. type : 'auto' (rafale tant qu'on tire), 'semi' (une balle par clic), 'shotgun' (plombs).
  // cat : catégorie (pistol, ar, smg, mg, sniper, shotgun, special). pierce : zombies traversés. adsFov : lunette.
  weapons: {
    // ---- pistolets
    m1911: { id: 'm1911', cat: 'pistol', name: 'COLT M1911', caliber: '.45 ACP', type: 'semi', damage: 48, headMult: 2.6, magSize: 7, startReserve: 42, maxReserve: 84, fireRate: 5.5, reloadTime: 1.5, spread: 0.01, range: 50, price: 400, ammoPrice: 150 },
    arex: { id: 'arex', cat: 'pistol', name: 'AREX ZERO 1', caliber: '9 mm', type: 'semi', damage: 34, headMult: 2.4, magSize: 17, startReserve: 68, maxReserve: 136, fireRate: 7.5, reloadTime: 1.4, spread: 0.009, range: 55, price: 700, ammoPrice: 250 },
    deagle: { id: 'deagle', cat: 'pistol', name: 'DESERT EAGLE', caliber: '.50 AE', type: 'semi', damage: 165, headMult: 3, magSize: 7, startReserve: 35, maxReserve: 56, fireRate: 2.4, reloadTime: 1.9, spread: 0.011, range: 70, pierce: 2, price: 1500, ammoPrice: 600 },
    magnum: { id: 'magnum', cat: 'pistol', name: 'COLT PYTHON .357', caliber: '.357 Magnum', type: 'semi', damage: 190, headMult: 3, magSize: 6, startReserve: 48, maxReserve: 72, fireRate: 3.2, reloadTime: 2.2, spread: 0.006, range: 80, pierce: 2, boxOnly: true, ammoPrice: 500 },
    // ---- fusils d'assaut
    rifle: { id: 'rifle', cat: 'ar', name: 'M4A1', caliber: '5,56 mm', type: 'auto', damage: 36, headMult: 2.5, magSize: 30, startReserve: 120, maxReserve: 180, fireRate: 9.5, reloadTime: 1.8, spread: 0.012, range: 90, price: 1200, ammoPrice: 300 },
    ak47: { id: 'ak47', cat: 'ar', name: 'AK-47', caliber: '7,62×39 mm', type: 'auto', damage: 46, headMult: 2.3, magSize: 30, startReserve: 120, maxReserve: 210, fireRate: 8.5, reloadTime: 2.4, spread: 0.017, range: 90, price: 1600, ammoPrice: 600 },
    famas: { id: 'famas', cat: 'ar', name: 'FAMAS F1', caliber: '5,56 mm', type: 'auto', damage: 34, headMult: 2.4, magSize: 25, startReserve: 125, maxReserve: 225, fireRate: 15, reloadTime: 2.2, spread: 0.014, range: 85, price: 1300, ammoPrice: 500 },
    scar: { id: 'scar', cat: 'ar', name: 'SCAR-H', caliber: '7,62×51 mm', type: 'auto', damage: 58, headMult: 2.4, magSize: 20, startReserve: 100, maxReserve: 180, fireRate: 7.5, reloadTime: 2.3, spread: 0.012, range: 100, pierce: 2, price: 2200, ammoPrice: 800 },
    // ---- pistolets-mitrailleurs
    smg: { id: 'smg', cat: 'smg', name: 'MP40', caliber: '9 mm', type: 'auto', damage: 24, headMult: 2.2, magSize: 32, startReserve: 128, maxReserve: 224, fireRate: 9.5, reloadTime: 1.5, spread: 0.022, range: 65, price: 1000, ammoPrice: 500 },
    mp5: { id: 'mp5', cat: 'smg', name: 'MP5', caliber: '9 mm', type: 'auto', damage: 26, headMult: 2.2, magSize: 30, startReserve: 150, maxReserve: 270, fireRate: 13, reloadTime: 1.8, spread: 0.017, range: 65, price: 1200, ammoPrice: 500 },
    p90: { id: 'p90', cat: 'smg', name: 'FN P90', caliber: '5,7×28 mm', type: 'auto', damage: 22, headMult: 2, magSize: 50, startReserve: 200, maxReserve: 350, fireRate: 15, reloadTime: 2.6, spread: 0.02, range: 70, pierce: 2, price: 1800, ammoPrice: 700 },
    // ---- mitrailleuses
    lmg: { id: 'lmg', cat: 'mg', name: 'RPK', caliber: '7,62×39 mm', type: 'auto', damage: 44, headMult: 2, magSize: 75, startReserve: 300, maxReserve: 450, fireRate: 10.5, reloadTime: 3.6, spread: 0.028, range: 90, price: 2500, ammoPrice: 1000 },
    m249: { id: 'm249', cat: 'mg', name: 'M249 SAW', caliber: '5,56 mm', type: 'auto', damage: 40, headMult: 2, magSize: 100, startReserve: 300, maxReserve: 500, fireRate: 12.5, reloadTime: 4.2, spread: 0.032, range: 90, price: 3000, ammoPrice: 1200 },
    mg42: { id: 'mg42', cat: 'mg', name: 'MG42', caliber: '7,92×57 mm', type: 'auto', damage: 46, headMult: 2, magSize: 50, startReserve: 250, maxReserve: 450, fireRate: 19, reloadTime: 4.0, spread: 0.04, range: 90, boxOnly: true, ammoPrice: 1200 },
    pkm: { id: 'pkm', cat: 'mg', name: 'PKM', caliber: '7,62×54R', type: 'auto', damage: 55, headMult: 2, magSize: 100, startReserve: 300, maxReserve: 500, fireRate: 10.5, reloadTime: 4.8, spread: 0.03, range: 100, pierce: 2, price: 3200, ammoPrice: 1300 },
    // ---- fusils de précision
    sniper: { id: 'sniper', cat: 'sniper', name: 'L96A1', caliber: '7,62×51 mm', type: 'semi', damage: 340, headMult: 3.5, magSize: 5, startReserve: 30, maxReserve: 45, fireRate: 1.1, reloadTime: 2.8, spread: 0.0015, range: 200, pierce: 4, adsFov: 25, price: 1750, ammoPrice: 700 },
    svd: { id: 'svd', cat: 'sniper', name: 'DRAGUNOV SVD', caliber: '7,62×54R', type: 'semi', damage: 230, headMult: 3, magSize: 10, startReserve: 40, maxReserve: 70, fireRate: 3, reloadTime: 2.6, spread: 0.004, range: 180, pierce: 3, adsFov: 28, price: 2000, ammoPrice: 800 },
    barrett: { id: 'barrett', cat: 'sniper', name: 'BARRETT M82', caliber: '.50 BMG', type: 'semi', damage: 700, headMult: 3, magSize: 10, startReserve: 30, maxReserve: 50, fireRate: 1.6, reloadTime: 3.4, spread: 0.002, range: 220, pierce: 6, adsFov: 20, boxOnly: true, ammoPrice: 1500 },
    // ---- fusil à pompe et arme spéciale
    shotgun: { id: 'shotgun', cat: 'shotgun', name: 'REMINGTON 870', caliber: '12 ga', type: 'shotgun', pellets: 8, damage: 26, headMult: 1.8, magSize: 6, startReserve: 30, maxReserve: 48, fireRate: 1.3, reloadTime: 2.4, spread: 0.046, range: 35, price: 750, ammoPrice: 350 },
    raygun: { id: 'raygun', cat: 'special', name: 'PISTOLET À RAYONS', caliber: 'énergie', type: 'semi', damage: 700, headMult: 1.5, magSize: 20, startReserve: 160, maxReserve: 200, fireRate: 4.2, reloadTime: 2.6, spread: 0.008, range: 100, splash: { radius: 2.8, damage: 500 }, tracer: 0x33ff55, boxOnly: true, ammoPrice: 1500 },
  },
  // Armes au départ (la première est en main)
  startWeapons: ['rifle', 'm1911'],

  // Noms des armes améliorées au Pack-a-Punch
  papNames: {
    m1911: 'MUSTANG & SALLY', arex: 'ZÉRO ABSOLU', deagle: 'L\'AIGLE NOIR', magnum: 'LE VENGEUR', rifle: 'M4 ÉCLIPSE', ak47: 'AK-ENFER', famas: 'LE CLAIRON MAUDIT',
    scar: 'LE BALAFRÉ', smg: 'PM INFERNAL', mp5: 'MP-115', p90: 'LE FRELON', lmg: 'RPK DÉVASTATEUR', m249: 'LA FAUCHEUSE', mg42: 'LA SCIE D\'HITLER… BRISÉE',
    pkm: 'LE BULLDOZER', sniper: 'ŒIL DU DÉMON', svd: 'LA TSARINE', barrett: 'LE MARTEAU DE THOR', shotgun: 'LE BROYEUR', raygun: 'PORTE-TONNERRE',
  },

  // Pack-a-Punch : durées de l'animation (s) ; l'arme améliorée attend offerTime secondes avant d'être rendue d'office
  pap: { inTime: 0.9, workTime: 4.4, outTime: 0.9, offerTime: 15 },

  // Boîte mystère : une seule boîte, qui change d'emplacement après un nombre aléatoire de tirages (1 à maxUses)
  box: {
    price: 950, spin: 4.4, offerTime: 10, maxUses: 30, // spin : durée du défilement des armes ; offerTime : temps pour prendre l'arme proposée
    pool: { m1911: 2, arex: 3, deagle: 2, magnum: 2, rifle: 2, ak47: 3, famas: 3, scar: 2, smg: 2, mp5: 3, p90: 2, lmg: 2, m249: 2, mg42: 2, pkm: 2, sniper: 2, svd: 2, barrett: 1, shotgun: 3, raygun: 1 },
  },

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

  // Fin de partie : « L'Heure du Jugement », déclenchée à l'horloge astronomique de la cathédrale.
  // Quatre actes : trois vagues (crypte, galeries, portes) -> le Bourreau dans la nef -> ascension de la tour sud
  // (330 marches) -> combat final sur la plateforme à 67 m. Les zombies n'apparaissent pas comme dans une manche
  // classique : ils sortent de la crypte, des galeries du triforium, des portes du parvis.
  finale: {
    price: 0,             // prix pour lancer l'événement
    minRound: 8,          // manche minimale
    maxAlive: 28,         // zombies simultanés pendant une vague
    bossHealth: 60000,    // santé du Bourreau (joueur seul) ; +70 % par joueur supplémentaire
    bossDamage: 45,       // coup de hache
    chargeDamage: 55,     // ruée
    slamDamage: 40,       // onde de choc (on l'évite en sautant)
    breather: 8,          // secondes de répit entre deux vagues
    waves: [
      { name: 'La crypte s\'ouvre', where: 'crypt', count: 16, perPlayer: 4, kinds: { normal: 0.75, bloat: 0.15, crawler: 0.1 } },
      { name: 'Les galeries', where: 'galleries', count: 20, perPlayer: 5, kinds: { normal: 0.4, runner: 0.3, crawler: 0.1, armored: 0.2 } },
      { name: 'Les portes de la ville', where: 'portal', count: 24, perPlayer: 6, kinds: { normal: 0.3, runner: 0.25, armored: 0.25, bloat: 0.2 } },
    ],
    kindHealth: { normal: 1, runner: 0.8, crawler: 0.8, armored: 3, bloat: 1.6 },
  },

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
    // vitesse de marche : speedStart + manche × speedPerRound, plafonnée à speedMax (m/s ; le joueur marche à 5 et sprinte à 8).
    // À partir de runnerRound, une part (runnerChance) des zombies sont des coureurs : vitesse × runnerMult.
    speedStart: 1.6,
    speedPerRound: 0.12,
    speedMax: 3.8,
    runnerRound: 4,
    runnerChance: 0.25,
    runnerMult: 1.35,
    crawlerChance: 0.12,   // à partir de la manche 4 : part de zombies rampants (sans jambes)
    crawlerRound: 4,
    legBlowChance: 0.5,    // un zombie qui survit à une explosion perd ses jambes
  },
};
