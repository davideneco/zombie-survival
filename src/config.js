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
      // place de l'Homme de Fer (rotonde du tram), derrière la place Kléber : profondeur 4, donc 1500 pts calculés. Ajoutée en dernier :
      // le tirage des emplacements des autres zones ne change pas.
      // isolatedRnd : ses emplacements (et son décor) ne consomment pas le tirage commun aux autres zones
      { name: 'Homme de Fer', seed: { x: -290, z: -203 }, isolatedRnd: true, items: ['station', 'wall:crossbow', 'wall:m79', 'perk:phdflopper', 'box'] },
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

  // Armes. type : 'auto' (rafale tant qu'on tire), 'semi' (une balle par clic ; fireRate = plafond), 'shotgun' (plombs).
  // cat : catégorie (pistol, ar, smg, mg, sniper, shotgun, special). pierce : zombies traversés. adsFov : lunette.
  // cal : clé du calibre (voir `calibers` plus bas) ; mod : coefficient sur les dégâts de base du calibre (arme plus ou moins
  // puissante que la moyenne de son calibre). damage / headMult / pierce / falloff* : surcharges facultatives, qui l'emportent
  // sur le calibre. Les dégâts sont ceux d'un tir de près (voir falloffMult) ; pour le fusil à pompe, par plomb.
  weapons: {
    // ---- pistolets
    m1911: { id: 'm1911', cat: 'pistol', name: 'COLT M1911', cal: '45acp', type: 'semi', magSize: 7, startReserve: 42, maxReserve: 84, fireRate: 5.5, reloadTime: 1.5, spread: 0.01, range: 50, price: 400, ammoPrice: 150 },
    arex: { id: 'arex', cat: 'pistol', name: 'AREX ZERO 1', cal: '9mm', mod: 1.1, type: 'semi', magSize: 17, startReserve: 68, maxReserve: 136, fireRate: 7.5, reloadTime: 1.4, spread: 0.009, range: 55, price: 700, ammoPrice: 250 },
    deagle: { id: 'deagle', cat: 'pistol', name: 'DESERT EAGLE', cal: '50ae', type: 'semi', magSize: 7, startReserve: 35, maxReserve: 56, fireRate: 2.4, reloadTime: 1.9, spread: 0.011, range: 70, price: 1500, ammoPrice: 600 },
    magnum: { id: 'magnum', cat: 'pistol', name: 'COLT PYTHON .357', cal: '357', mod: 1.1, type: 'semi', magSize: 6, startReserve: 48, maxReserve: 72, fireRate: 3.2, reloadTime: 2.2, spread: 0.006, range: 80, boxOnly: true, ammoPrice: 500 },
    // ---- fusils d'assaut
    rifle: { id: 'rifle', cat: 'ar', name: 'M4A1', cal: '556', mod: 0.9, type: 'auto', magSize: 30, startReserve: 120, maxReserve: 180, fireRate: 12.5, reloadTime: 1.8, spread: 0.012, range: 90, price: 1200, ammoPrice: 300 },
    ak47: { id: 'ak47', cat: 'ar', name: 'AK-47', cal: '762x39', type: 'auto', magSize: 30, startReserve: 120, maxReserve: 210, fireRate: 10, reloadTime: 2.4, spread: 0.017, range: 90, price: 1600, ammoPrice: 600 },
    famas: { id: 'famas', cat: 'ar', name: 'FAMAS F1', cal: '556', type: 'auto', magSize: 25, startReserve: 125, maxReserve: 225, fireRate: 15, reloadTime: 2.2, spread: 0.014, range: 85, price: 1300, ammoPrice: 500 },
    scar: { id: 'scar', cat: 'ar', name: 'SCAR-H', cal: '762x51', type: 'auto', magSize: 20, startReserve: 100, maxReserve: 180, fireRate: 10, reloadTime: 2.3, spread: 0.018, range: 100, price: 2500, ammoPrice: 800 },
    // ---- pistolets-mitrailleurs
    smg: { id: 'smg', cat: 'smg', name: 'MP40', cal: '9mm', mod: 1.15, type: 'auto', magSize: 32, startReserve: 128, maxReserve: 224, fireRate: 8.3, reloadTime: 1.5, spread: 0.022, range: 65, price: 800, ammoPrice: 500 },
    mp5: { id: 'mp5', cat: 'smg', name: 'MP5', cal: '9mm', type: 'auto', magSize: 30, startReserve: 150, maxReserve: 270, fireRate: 13, reloadTime: 1.8, spread: 0.017, range: 65, price: 1200, ammoPrice: 500 },
    p90: { id: 'p90', cat: 'smg', name: 'FN P90', cal: '57x28', type: 'auto', magSize: 50, startReserve: 200, maxReserve: 350, fireRate: 15, reloadTime: 2.6, spread: 0.02, range: 70, price: 1800, ammoPrice: 700 },
    // ---- mitrailleuses
    lmg: { id: 'lmg', cat: 'mg', name: 'RPK', cal: '762x39', mod: 0.95, headMult: 2, type: 'auto', magSize: 75, startReserve: 300, maxReserve: 450, fireRate: 10, reloadTime: 3.6, spread: 0.028, range: 90, price: 2500, ammoPrice: 1000 },
    m249: { id: 'm249', cat: 'mg', name: 'M249 SAW', cal: '556', headMult: 2, type: 'auto', magSize: 100, startReserve: 300, maxReserve: 500, fireRate: 12.5, reloadTime: 4.2, spread: 0.032, range: 90, price: 3000, ammoPrice: 1200 },
    mg42: { id: 'mg42', cat: 'mg', name: 'MG42', cal: '792x57', mod: 0.8, headMult: 2, type: 'auto', magSize: 50, startReserve: 250, maxReserve: 450, fireRate: 20, reloadTime: 5, spread: 0.04, range: 90, boxOnly: true, ammoPrice: 1200 },
    pkm: { id: 'pkm', cat: 'mg', name: 'PKM', cal: '762x54r', mod: 0.8, headMult: 2, type: 'auto', magSize: 100, startReserve: 300, maxReserve: 500, fireRate: 10.5, reloadTime: 4.8, spread: 0.03, range: 100, price: 3200, ammoPrice: 1300 },
    // ---- fusils de précision
    sniper: { id: 'sniper', cat: 'sniper', name: 'L96A1', cal: '762match', type: 'semi', magSize: 5, startReserve: 30, maxReserve: 45, fireRate: 1.1, reloadTime: 2.8, spread: 0.0015, range: 200, adsFov: 25, price: 1750, ammoPrice: 700 },
    svd: { id: 'svd', cat: 'sniper', name: 'DRAGUNOV SVD', cal: '762x54r7n1', type: 'semi', magSize: 10, startReserve: 40, maxReserve: 70, fireRate: 3, reloadTime: 2.6, spread: 0.004, range: 180, adsFov: 28, price: 2000, ammoPrice: 800 },
    barrett: { id: 'barrett', cat: 'sniper', name: 'BARRETT M82', cal: '50bmg', type: 'semi', magSize: 10, startReserve: 30, maxReserve: 50, fireRate: 1.2, reloadTime: 3.4, spread: 0.002, range: 220, adsFov: 20, boxOnly: true, ammoPrice: 1500 },
    // ---- fusil à pompe et arme spéciale
    shotgun: { id: 'shotgun', cat: 'shotgun', name: 'REMINGTON 870', cal: '12ga', type: 'shotgun', pellets: 8, magSize: 6, startReserve: 30, maxReserve: 48, fireRate: 1.3, reloadTime: 2.4, spread: 0.046, range: 35, price: 750, ammoPrice: 350 },
    // fusil semi-automatique à pompe de salon : une salve de 8 plombs par clic, uniquement dans la boîte mystère
    saiga: { id: 'saiga', cat: 'shotgun', name: 'SAIGA-12', cal: '12ga', mod: 0.9, type: 'semi', pellets: 8, magSize: 8, startReserve: 32, maxReserve: 64, fireRate: 3.5, reloadTime: 2.6, spread: 0.05, range: 35, boxOnly: true, ammoPrice: 700 },
    // arbalète : tir instantané (comme une balle), perce 6 zombies, silencieuse ; recharge seule après chaque tir (autoReload)
    // Pack-a-Punch : carreau explosif (papSplash, copié dans `splash` des stats améliorées)
    crossbow: { id: 'crossbow', cat: 'special', name: 'ARBALÈTE', cal: 'bolt', type: 'semi', magSize: 1, startReserve: 20, maxReserve: 40, fireRate: 1, reloadTime: 1.7, spread: 0.003, range: 80, tracer: 0xb08850, flash: false, autoReload: true, papSplash: { radius: 2.5, damage: 700, color: 0xff9a3a }, price: 2000, ammoPrice: 700 },
    // lance-grenades : vrai projectile (proj : vitesse m/s, gravité m/s², armement en m, durée de vie en s). Explose à l'impact ou en
    // fin de course ; avant l'armement : 150 dégâts directs sans explosion. blast.self : dégâts max au seul tireur.
    m79: { id: 'm79', cat: 'special', name: 'M79', cal: '40mm', type: 'launcher', damage: 150, headMult: 1, magSize: 1, startReserve: 11, maxReserve: 24, fireRate: 1, reloadTime: 2.2, spread: 0.004, range: 150, autoReload: true, proj: { speed: 60, gravity: 6, arm: 4, fuse: 3 }, blast: { radius: 5, damage: 1200, self: 75, color: 0xff8a2a }, price: 2500, ammoPrice: 1500 },
    // énergie : pas de chute des dégâts ; le tir direct et la zone (splash) sont propres à l'arme
    raygun: { id: 'raygun', cat: 'special', name: 'PISTOLET À RAYONS', cal: 'energy', type: 'semi', damage: 1000, headMult: 1.5, magSize: 24, startReserve: 168, maxReserve: 240, fireRate: 4.2, reloadTime: 2.6, spread: 0.008, range: 100, splash: { radius: 3.5, damage: 900 }, tracer: 0x33ff55, boxOnly: true, ammoPrice: 1500 },
  },
  // Calibres : dégâts de base d'un tir de près, multiplicateur de tête, zombies traversés et chute des dégâts avec la distance.
  // Le multiplicateur vaut 1 jusqu'à falloffStart (m), baisse linéairement jusqu'à minMult à falloffEnd (m), puis reste à minMult.
  // base = dégâts d'un projectile (par plomb pour le calibre 12 ga). pierce : seulement s'il dépasse 1.
  // Les clés sont résolues dans chaque arme une seule fois, en bas de ce fichier.
  calibers: {
    '57x28': { name: '5,7×28 mm', base: 22, head: 2.0, pierce: 2, falloffStart: 12, falloffEnd: 40, minMult: 0.55 },
    '9mm': { name: '9 mm', base: 26, head: 2.2, pierce: 1, falloffStart: 12, falloffEnd: 35, minMult: 0.5 },
    '556': { name: '5,56 mm', base: 40, head: 2.4, pierce: 1, falloffStart: 25, falloffEnd: 70, minMult: 0.7 },
    '45acp': { name: '.45 ACP', base: 50, head: 2.6, pierce: 1, falloffStart: 10, falloffEnd: 35, minMult: 0.5 },
    '762x39': { name: '7,62×39 mm', base: 54, head: 2.3, pierce: 1, falloffStart: 22, falloffEnd: 65, minMult: 0.65 },
    '762x51': { name: '7,62×51 mm', base: 78, head: 2.5, pierce: 2, falloffStart: 35, falloffEnd: 90, minMult: 0.8 },
    '762x54r': { name: '7,62×54R', base: 80, head: 2.5, pierce: 2, falloffStart: 35, falloffEnd: 90, minMult: 0.8 },
    '792x57': { name: '7,92×57 mm', base: 80, head: 2.2, pierce: 2, falloffStart: 30, falloffEnd: 90, minMult: 0.75 },
    '357': { name: '.357 Magnum', base: 130, head: 3.0, pierce: 2, falloffStart: 15, falloffEnd: 50, minMult: 0.6 },
    '50ae': { name: '.50 AE', base: 160, head: 3.0, pierce: 2, falloffStart: 18, falloffEnd: 55, minMult: 0.6 },
    '12ga': { name: '12 ga', base: 30, head: 1.8, pierce: 1, falloffStart: 6, falloffEnd: 25, minMult: 0.25 },
    '762match': { name: '7,62×51 mm Match', base: 340, head: 3.5, pierce: 4, falloffStart: 80, falloffEnd: 200, minMult: 0.9 },
    '762x54r7n1': { name: '7,62×54R 7N1', base: 230, head: 3.0, pierce: 3, falloffStart: 80, falloffEnd: 200, minMult: 0.9 },
    '50bmg': { name: '.50 BMG', base: 700, head: 3.0, pierce: 6, falloffStart: 100, falloffEnd: 220, minMult: 0.95 },
    bolt: { name: 'carreau 20″', base: 420, head: 3.0, pierce: 6, falloffStart: 30, falloffEnd: 70, minMult: 0.7 },
    '40mm': { name: '40×46 mm' }, // pas de base : l'arme fixe ses dégâts
    energy: { name: 'énergie' }, // pas de base ni de chute : le pistolet à rayons règle ses propres dégâts
  },
  // Armes au départ (la première est en main)
  startWeapons: ['rifle', 'm1911'],

  // Noms des armes améliorées au Pack-a-Punch
  papNames: {
    m1911: 'MUSTANG & SALLY', arex: 'ZÉRO ABSOLU', deagle: 'L\'AIGLE NOIR', magnum: 'LE VENGEUR', rifle: 'M4 ÉCLIPSE', ak47: 'AK-ENFER', famas: 'LE CLAIRON MAUDIT',
    scar: 'LE BALAFRÉ', smg: 'PM INFERNAL', mp5: 'MP-115', p90: 'LE FRELON', lmg: 'RPK DÉVASTATEUR', m249: 'LA FAUCHEUSE', mg42: 'LA SCIE D\'HITLER… BRISÉE',
    pkm: 'LE BULLDOZER', sniper: 'ŒIL DU DÉMON', svd: 'LA TSARINE', barrett: 'LE MARTEAU DE THOR', shotgun: 'LE BROYEUR', raygun: 'PORTE-TONNERRE',
    saiga: 'LE HACHOIR', crossbow: 'LE CARREAU DE FER', m79: 'LE BOUTEFEU',
  },

  // Pack-a-Punch : durées de l'animation (s) ; l'arme améliorée attend offerTime secondes avant d'être rendue d'office
  pap: { inTime: 0.9, workTime: 4.4, outTime: 0.9, offerTime: 15 },

  // Boîte mystère : une seule boîte, qui change d'emplacement après un nombre aléatoire de tirages (1 à maxUses)
  box: {
    price: 950, spin: 4.4, offerTime: 10, maxUses: 30, // spin : durée du défilement des armes ; offerTime : temps pour prendre l'arme proposée
    pool: { m1911: 2, arex: 3, deagle: 2, magnum: 2, rifle: 2, ak47: 3, famas: 3, scar: 2, smg: 2, mp5: 3, p90: 2, lmg: 2, m249: 2, mg42: 2, pkm: 2, sniper: 2, svd: 2, barrett: 1, shotgun: 3, raygun: 1, saiga: 3, crossbow: 2, m79: 1 },
  },

  // Atouts (machines) : prix et effet décrit dans le jeu
  perks: {
    juggernog: { name: 'MASTODONTE', desc: 'Santé max 250', price: 2500, color: '#d0242c', letter: 'M' },
    speedcola: { name: 'SPEED COLA', desc: 'Rechargement 2x plus rapide', price: 3000, color: '#2db34a', letter: 'S' },
    doubletap: { name: 'DOUBLE TAP', desc: 'Cadence +33 %, dégâts +25 %', price: 2000, color: '#e0a21a', letter: 'D' },
    quickrevive: { name: 'RÉANIMATION RAPIDE', desc: 'Solo : se relève seul · Co-op : réanime 2x plus vite', price: 1500, soloPrice: 500, color: '#3aa6ff', letter: 'R' },
    mulekick: { name: 'MULE KICK', desc: 'Porter 3 armes', price: 4000, color: '#3f7d3a', letter: 'K' },
    staminup: { name: 'STAMIN-UP', desc: 'Course plus rapide', price: 2000, color: '#e8d24a', letter: 'E' },
    phdflopper: { name: 'PHD FLOPPER', desc: 'Immunisé aux explosions et aux chocs · saut en sprint : onde explosive', price: 2000, color: '#8d3fd1', letter: 'P' },
  },
  // PHD Flopper : immunité totale aux dégâts 'blast' (grenades, M79, pestiférés) et 'crash' (choc de moto), pas aux coups de zombie ni
  // du Bourreau. Plongeon : sauter pendant un sprint, ou tomber de fallHeight m ou plus, au moins minAir s en l'air -> à l'atterrissage,
  // onde explosive de rayon `radius` aux pieds (dégâts = base + perRound x manche, aux zombies seulement), puis `cooldown` s de recharge.
  phd: { radius: 4.5, base: 1500, perRound: 100, cooldown: 5, minAir: 0.35, fallHeight: 2.5, color: 0xb06cff },
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

  // Véhicules (motos). Touches : ZQSD / flèches pour conduire, Espace = frein à main, E = monter / descendre.
  // Le conducteur ne tire pas (les deux mains sur le guidon) ; le passager de la grosse moto, lui, tire normalement.
  // Vitesses en m/s (le joueur marche à 5 et sprinte à 8 ; les zombies vont de 1,7 à 3,8). grip : accélération latérale maximale
  // (m/s²) : plus elle est faible, plus il faut ralentir pour tourner (rayon minimal = vitesse² / grip).
  vehicles: {
    mountRange: 2.6,   // distance maximale pour monter (m)
    pumpRange: 2.4,    // distance maximale à la borne du parking pour l'utiliser (m) ; pumpReach : distance borne-moto maximale (m)
    pumpReach: 8,
    // Parking : un seul endroit, sur la place Gutenberg (à côté de l'entrée du parking souterrain). Les emplacements sont fixes
    // (aucun tirage : identiques chez tous les joueurs). x, z : centre (m) ; yaw : cap des motos (0 = vers le nord, -z) ; dx / dz :
    // décalage dans le repère du parking (dx vers la droite des motos, dz vers l'arrière). rect : emprise réservée au décor (m).
    // Si le centre n'est pas dans la zone `zone`, les motos retombent sur `spawns` (ancien tirage, avec un avertissement en ?debug).
    parking: {
      zone: 'Place Gutenberg', x: -22, z: 70, yaw: 0,
      bays: [{ type: 'moto', dx: -1.2 }, { type: 'grosseMoto', dx: 1.2 }],
      slots: [-3.6, -1.2, 1.2, 3.6], // emplacements peints au sol (dx) ; 1,6 x 2,6 m ; les motos occupent les deux du milieu
      pump: { dx: -6.5, dz: 0 }, sign: { dx: 0, dz: 5.5 },
      rect: { w: 10, d: 12 },
    },
    // Repli (voir parking) : une ligne par moto, posée dans la zone nommée sur un emplacement dégagé
    spawns: [
      { type: 'moto', zone: 'Marché-Neuf' },
      { type: 'grosseMoto', zone: 'Marché-Neuf' },
    ],
    // Écraser un zombie (propre à chaque moto, voir `roadkill` des types) : sous la vitesse vmin, aucun dégât et la moto est stoppée
    // par le zombie (vitesse plafonnée à stopSpeed, arrêt net au contact) ; au-dessus, dégâts = K x v x r avec
    // r = min(1, 0,4 + 0,6 x (v - vmin) / rampSpeed) ; chaque zombie écrasé freine la moto (x slowdown) ; cooldown entre deux coups au même zombie.
    roadkill: { cooldown: 0.5, rampSpeed: 6, stopSpeed: 1.5, contactStop: 0.55 },
    // Choc contre un mur : au-dessus de minSpeed (vitesse perdue dans le choc), les occupants perdent damagePerMs PV par m/s en trop
    // (jamais mortel : il leur reste au moins 1 PV)
    crash: { minSpeed: 10, damagePerMs: 3.5, maxDamage: 45 },
    // Points de vie des motos (type.hp) et dégâts qu'elles subissent. Seul l'hôte écrit les PV (v_dmg -> v_hp).
    //  - choc contre un mur : max(0, impact - crashFree) x crashPerMs (impact = vitesse perdue, m/s) ; un coup de zombie sur un occupant : zombieHit
    //  - explosion (grenade, M79, pestiféré, autre moto) : `explosion` x les dégâts infligés aux zombies, même atténuation ; balles et
    //    splash (pistolet à rayons, carreau explosif, onde du PHD) n'abîment pas les motos
    //  - écrasement : roadkillKill par zombie tué, roadkillHurt par zombie qui survit
    //  - à 0 PV : en feu pendant burnTime s (moteur coupé, personne ne peut monter), puis explosion (blast : rayon, dégâts aux zombies avec
    //    atténuation, dégâts maximaux aux joueurs, jamais mortels), épave wreckTime s, puis retour au parking à la manche suivante + respawnRounds
    //  - fumée selon les PV (grey / black : fraction des PV en dessous de laquelle, particules par seconde ; flames : flammèches)
    damage: {
      crashFree: 6, crashPerMs: 5, zombieHit: 10, explosion: 0.1, roadkillKill: 5, roadkillHurt: 12,
      burnTime: 2, wreckTime: 20, respawnRounds: 2, respawnClear: 1.5, respawnRetry: 1,
      blast: { radius: 5, zombies: 1000, players: 50, color: 0xff8a2a },
      smoke: { grey: { below: 0.5, rate: 4 }, black: { below: 0.25, rate: 10 }, flames: { below: 0.1, rate: 10 } },
      repairPrice: 2,     // points par PV réparé à la borne du parking
    },
    // Essence (litres, affichée en %). Le conducteur consomme : ralenti (moteur tournant) + gaz x (base + perSpeed x v / vmax), marche arrière x 0,6 ;
    // moteur arrêté (pas de conducteur) : rien. Sous lowBelow : bip toutes les lowBeep s et jauge rouge clignotante ; sous missBelow : ratés
    // (gaz coupés missLen s toutes les ~missEvery s) ; à sec : « PANNE SÈCHE », la moto n'avance plus qu'en poussée (pushSpeed m/s max,
    // pushAccel m/s², freins et direction normaux). Borne du parking : « plein + réparation » (pricePerL pts par litre, plus les PV).
    // Jerrican : dropChance par zombie tué, seulement si une moto en état a moins de dropBelow de réservoir, un seul au sol ; +jerrican L.
    fuel: { lowBelow: 0.15, lowBeep: 4, missBelow: 0.05, missEvery: 1.5, missLen: 0.15, pushSpeed: 3, pushAccel: 3, pricePerL: 50, jerrican: 2.5, dropChance: 0.03, dropBelow: 0.5, respawn: 0.4 },
    // Vue à la troisième personne (touche V : bascule avec la première personne, réglage `tpVehicle` mémorisé). La longueur du bras est propre
    // à chaque moto (type.camArm). Pivot = œil + pivotUp (passager : + pivotRight à droite), lissé (follow, 1/s). Tangage borné. Caméra :
    // trois rayons (décalés de rayOffset), recul `margin`, bras minimal `minArm`, retour à `retreat` m/s ; plafond - ceilingMargin, sol +
    // floorMargin. Transitions (s) : montée mountTime, descente leaveTime, visée aimTime. Personnage visible si bras > avatarMin ; arme de
    // la vue visible si bras < viewmodelMax. Conducteur : la vue revient derrière la moto après recenterAfter s sans souris (recenterRate rad/s).
    cam: {
      pivotUp: 0.35, pivotRight: 0.35, follow: 14, pitchMin: -0.7, pitchMax: 0.45,
      rayOffset: 0.25, margin: 0.3, minArm: 0.8, retreat: 4, ceilingMargin: 0.35, floorMargin: 0.5,
      mountTime: 0.35, leaveTime: 0.25, aimTime: 0.15, avatarMin: 0.8, viewmodelMax: 0.3,
      recenterAfter: 1.5, recenterRate: 2, recenterPitch: -0.15,
    },
    types: {
      moto: {
        name: 'MOTO', seats: 1, camArm: 3.4, hp: 300, tank: 6, idle: 0.004, gas: 0.012, perSpeed: 0.017, maxSpeed: 21, accel: 11, brake: 28, reverseSpeed: 3.5, drag: 0.12,
        wheelbase: 1.35, maxSteer: 0.62, grip: 15, radius: 0.55, roadkill: { K: 16, vmin: 9, slowdown: 0.85 },
      },
      grosseMoto: {
        name: 'GROSSE MOTO', seats: 2, camArm: 4.0, hp: 500, tank: 10, idle: 0.005, gas: 0.016, perSpeed: 0.021, maxSpeed: 17, accel: 8, brake: 24, reverseSpeed: 3, drag: 0.12,
        wheelbase: 1.75, maxSteer: 0.5, grip: 11, radius: 0.7, roadkill: { K: 24, vmin: 7, slowdown: 0.90 },
      },
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
    // chevalier de fer : variante 'armored' (armure x0,5, vitesse x0,8) qui apparaît dans la zone donnée, à partir de la manche fromRound,
    // avec la probabilité `chance` par zombie ; maxAlive en vie au plus ; santé x healthMult (avec l'armure : x3 de résistance)
    ironKnight: { zone: 'Homme de Fer', fromRound: 8, chance: 0.15, maxAlive: 3, healthMult: 1.5 },
  },
};

// Résolution des calibres : chaque arme reçoit le nom du calibre, ses dégâts (base × mod), son multiplicateur de tête, sa
// pénétration et sa chute des dégâts, sauf si elle les définit elle-même. Fait une seule fois, au chargement du module.
for (const w of Object.values(CONFIG.weapons)) {
  const c = CONFIG.calibers[w.cal];
  if (!c) throw new Error(`Arme ${w.id} : calibre inconnu « ${w.cal} »`);
  w.caliber = c.name;
  if (c.base != null) w.damage ??= Math.round(c.base * (w.mod ?? 1));
  if (c.head != null) w.headMult ??= c.head;
  if (c.pierce > 1) w.pierce ??= c.pierce; // jamais 1 : le Pack-a-Punch ajoute 2 si `pierce` existe, sinon donne 2
  if (c.falloffStart != null) {
    w.falloffStart ??= c.falloffStart;
    w.falloffEnd ??= c.falloffEnd;
    w.minMult ??= c.minMult;
  }
}

// Multiplicateur des dégâts selon la distance du tir (m) : 1 jusqu'à falloffStart, puis décroissance linéaire jusqu'à
// minMult à falloffEnd, puis minMult au-delà. Sans falloffStart (énergie), pas de chute.
export function falloffMult(cfg, dist) {
  if (cfg.falloffStart == null || dist <= cfg.falloffStart) return 1;
  if (dist >= cfg.falloffEnd) return cfg.minMult;
  return 1 - (1 - cfg.minMult) * (dist - cfg.falloffStart) / (cfg.falloffEnd - cfg.falloffStart);
}

// Contrôle de cohérence, en mode ?debug uniquement
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  for (const w of Object.values(CONFIG.weapons)) {
    if (w.falloffStart != null && w.falloffStart > w.range) console.warn(`[config] ${w.id} : falloffStart (${w.falloffStart}) > range (${w.range})`);
    if (w.minMult != null && !(w.minMult >= 0 && w.minMult <= 1)) console.warn(`[config] ${w.id} : minMult (${w.minMult}) hors de [0, 1]`);
  }
}
