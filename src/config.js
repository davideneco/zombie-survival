// Tous les réglages du jeu au même endroit : modifie-les pour équilibrer la difficulté.
// Pack-a-Punch à 3 niveaux (w.pap = 0 à 3). Chaque niveau coûte son prix, payé par le joueur avec ses propres points, et améliore l'arme
// DÉJÀ améliorée (I -> II -> III). Multiplicateurs sur les stats de base de l'arme (les atouts s'appliquent ensuite) :
//  price : prix du niveau ; color : reflet de l'arme (émissif ; le niveau III pulse à pulseHz) ; tracer / flash : couleurs de tir
//  dmg : dégâts (ray : pistolet à rayons) ; head : multiplicateur de tête ; pierce : zombies traversés en plus ; mag : chargeur ;
//  magX : coefficient de chargeur en plus (accessoire : chargeur allongé, tambour) ; reserve : réserve max ; reload : durée de rechargement ;
//  spread : dispersion ; ammo : coefficient du prix des munitions au mur.
export const PAP_LEVELS = [
  null,
  { roman: 'I', price: 5000, color: 0x6a22b8, tracer: 0xc070ff, flash: 0xd28cff, dmg: 2.5, ray: 1.6, head: 1.2, pierce: 2, mag: 1.5, magX: 1, reserve: 1.5, reload: 1, spread: 1, ammo: 3 },
  { roman: 'II', price: 10000, color: 0x1a6cff, tracer: 0x5aa0ff, flash: 0x8cc0ff, dmg: 3.5, ray: 2.2, head: 1.3, pierce: 3, mag: 1.5, magX: 1.33, reserve: 2, reload: 0.85, spread: 0.85, ammo: 4 },
  { roman: 'III', price: 20000, color: 0xff6a10, tracer: 0xff8a30, flash: 0xffb060, dmg: 5, ray: 3, head: 1.4, pierce: 4, mag: 1.5, magX: 1.33, reserve: 2.5, reload: 0.75, spread: 0.7, ammo: 5, pulseHz: 2 },
];

export const CONFIG = {
  map: 'strasbourg', // 'strasbourg' (lieu réel OpenStreetMap) ou 'arena' (arène de test)
  // Strasbourg : toute la Grande Île (données dans public/data/area.json, voir tools/fetch-osm.mjs)
  startHint: { x: 4.3, z: -35.7 }, // point de départ (place du Marché-Neuf, centre de l'ancienne carte), en mètres depuis le centre des données
  cityHint: { x: -199, z: -145 }, // un point du réseau de rues principal (place Kléber)
  breaches: 3,                     // secours : bâtiments à effondrer si aucun passage sous immeuble ne relie la place à la ville
  // Toute la Grande Île est jouable, découpée en zones qu'on ouvre l'une après l'autre en payant les portes.
  // Chaque zone part d'un vrai lieu (seed, en mètres : x vers l'est, z vers le sud) ; les cases sont attribuées
  // à la zone la plus proche en distance de marche. Trois phases (realworld.js) : 1) les zones d'origine (sans `outer`),
  // limitées à maxDist ; 2) les zones `outer: true`, sans limite de distance, sur les cases restantes ; 3) les poches enclavées
  // sont rattachées en entier à la zone voisine qui les touche le plus. Les portes tombent entre deux zones voisines.
  // Prix d'une porte = le plus cher des `doorPrice` des deux zones qu'elle sépare (Marché-Neuf : 0). Paliers des zones `outer` :
  // A 1500, B 2000, C 2500 (voir les commentaires de chaque zone).
  // items : ce qu'on trouve dans la zone ('station' = borne de munitions, 'wall:<arme>', 'perk:<atout>', 'pap',
  //         'box' = un emplacement possible de la boîte mystère : il n'y a qu'une boîte, qui se déplace).
  sector: {
    maxDist: 95,        // rayon d'une zone d'origine (m, en distance de marche) ; les zones `outer` n'ont pas de limite
    basePrice: 750,     // (repli) prix d'une porte vers une zone sans doorPrice : de la place de départ
    priceStep: 250,     // (repli) supplément par zone plus éloignée
    // Décor des zones `outer`, proportionnel à leur surface (une voiture / un objet de barricade par tant de m²) ; le décor des zones
    // d'origine garde son tirage et ses plafonds propres (14 voitures, 47 objets de barricade)
    outerDecor: { carArea: 6000, junkArea: 2500, bikeMax: 30, chaletRadius: 40 },
    zones: [
      { name: 'Marché-Neuf', start: true, items: ['station', 'wall:m1911', 'wall:shotgun', 'wall:smg', 'perk:quickrevive', 'box'] },
      { name: 'Temple-Neuf', seed: { x: -35, z: -95 }, doorPrice: 750, items: ['station', 'wall:arex', 'wall:mp5', 'perk:staminup', 'box'] },
      { name: 'Rue des Orfèvres', seed: { x: 40, z: -70 }, doorPrice: 750, items: ['wall:famas', 'perk:speedcola', 'box'] },
      { name: 'Rue du Dôme', seed: { x: 110, z: -111 }, doorPrice: 1000, items: ['station', 'wall:sniper', 'wall:svd', 'box'] },
      { name: 'Grandes Arcades', seed: { x: -110, z: -45 }, doorPrice: 1000, items: ['station', 'wall:ak47', 'wall:p90', 'perk:mulekick', 'box'] },
      { name: 'Place Kléber', seed: { x: -199, z: -145 }, doorPrice: 1250, items: ['station', 'perk:juggernog', 'wall:lmg', 'wall:m249', 'box'] },
      { name: 'Place Gutenberg', seed: { x: -20, z: 90 }, doorPrice: 1250, items: ['station', 'perk:doubletap', 'wall:scar', 'wall:pkm', 'box'] },
      { name: 'Cathédrale', seed: { x: 103, z: 33 }, doorPrice: 1000, items: ['station', 'wall:deagle', 'wall:rifle', 'box'] },
      // fin de partie : l'intérieur de la cathédrale, derrière le grand portail (porte la plus chère)
      { name: 'Intérieur de la Cathédrale', seed: 'cathedral', portal: true, doorPrice: 5000, items: ['pap', 'clock', 'station', 'box'] },
      // place de l'Homme de Fer (rotonde du tram), derrière la place Kléber : profondeur 4, donc 1500 pts calculés. Ajoutée en dernier :
      // le tirage des emplacements des autres zones ne change pas.
      // isolatedRnd : ses emplacements (et son décor) ne consomment pas le tirage commun aux autres zones
      { name: 'Homme de Fer', seed: { x: -290, z: -203 }, isolatedRnd: true, doorPrice: 1500, items: ['station', 'wall:crossbow', 'wall:m79', 'perk:phdflopper', 'box'] },
      // ---- le reste de la Grande Île (v0.27.0) : zones `outer`, dans cet ordre (le tirage des zones d'origine ne bouge pas :
      // les zones `outer` ont leur propre générateur). Noms tirés des monuments OpenStreetMap ; « Grand'Rue » et « Quai Schoepflin »
      // sont des noms déduits du plan (à confirmer). Armes premium au mur (v0.28.0) : magnum 2000, saiga 3000, mg42 4000, barrett 5000.
      // palier A : 1500
      { name: 'Saint-Pierre-le-Jeune', outer: true, seed: { x: -140, z: -340 }, doorPrice: 1500, items: ['station', 'wall:magnum', 'box'] },
      { name: "Grand'Rue", outer: true, seed: { x: -400, z: 10 }, doorPrice: 1500, items: ['station', 'wall:mp5', 'box'] },
      { name: 'Grand Séminaire', outer: true, seed: { x: 300, z: -60 }, doorPrice: 1500, items: ['station', 'wall:shotgun', 'box'] },
      { name: 'Palais Rohan', outer: true, seed: { x: 260, z: 140 }, doorPrice: 1500, items: ['wall:ak47'] },
      { name: 'Musée historique', outer: true, seed: { x: 200, z: 215 }, doorPrice: 1500, items: ['station', 'wall:arex', 'box'] },
      // palier B : 2000
      { name: 'Place Broglie', outer: true, seed: { x: 150, z: -345 }, doorPrice: 2000, chalets: 4, items: ['station', 'wall:lmg', 'box'] },
      { name: 'Quai Schoepflin', outer: true, seed: { x: -20, z: -470 }, doorPrice: 2000, items: ['wall:svd'] },
      { name: 'Hôtel de Neuwiller', outer: true, seed: { x: -450, z: -250 }, doorPrice: 2000, items: ['wall:famas'] },
      { name: 'Monument Stoeber', outer: true, seed: { x: -490, z: -150 }, doorPrice: 2000, items: ['station', 'wall:scar', 'box'] },
      { name: 'Ancienne Douane', outer: true, seed: { x: 30, z: 330 }, doorPrice: 2000, items: ['station', 'wall:sniper'] },
      { name: 'Saint-Thomas', outer: true, seed: { x: -230, z: 250 }, doorPrice: 2000, items: ['station', 'wall:saiga', 'box'] },
      { name: 'Église Réformée', outer: true, seed: { x: -330, z: 170 }, doorPrice: 2000, items: ['wall:smg'] },
      // palier C : 2500
      { name: 'Opéra', outer: true, seed: { x: 250, z: -450 }, doorPrice: 2500, items: ['station', 'wall:mg42'] },
      { name: 'Préfecture', outer: true, seed: { x: 400, z: -340 }, doorPrice: 2500, items: ['station', 'wall:pkm', 'box'] },
      { name: 'Saint-Étienne', outer: true, seed: { x: 540, z: -90 }, doorPrice: 2500, items: ['station', 'wall:m249', 'box'] },
      { name: 'Saint-Pierre-le-Vieux', outer: true, seed: { x: -620, z: -60 }, doorPrice: 2500, items: ['wall:deagle'] },
      { name: 'Petite France', outer: true, seed: { x: -660, z: 150 }, doorPrice: 2500, items: ['wall:barrett'] },
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
    magnum: { id: 'magnum', cat: 'pistol', name: 'COLT PYTHON .357', cal: '357', mod: 1.1, type: 'semi', magSize: 6, startReserve: 48, maxReserve: 72, fireRate: 3.2, reloadTime: 2.2, spread: 0.006, range: 80, price: 2000, ammoPrice: 500 },
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
    mg42: { id: 'mg42', cat: 'mg', name: 'MG42', cal: '792x57', mod: 0.8, headMult: 2, type: 'auto', magSize: 50, startReserve: 250, maxReserve: 450, fireRate: 20, reloadTime: 5, spread: 0.04, range: 90, price: 4000, ammoPrice: 1200 },
    pkm: { id: 'pkm', cat: 'mg', name: 'PKM', cal: '762x54r', mod: 0.8, headMult: 2, type: 'auto', magSize: 100, startReserve: 300, maxReserve: 500, fireRate: 10.5, reloadTime: 4.8, spread: 0.03, range: 100, price: 3200, ammoPrice: 1300 },
    // ---- fusils de précision
    sniper: { id: 'sniper', cat: 'sniper', name: 'L96A1', cal: '762match', type: 'semi', magSize: 5, startReserve: 30, maxReserve: 45, fireRate: 1.1, reloadTime: 2.8, spread: 0.0015, range: 200, adsFov: 25, price: 1750, ammoPrice: 700 },
    svd: { id: 'svd', cat: 'sniper', name: 'DRAGUNOV SVD', cal: '762x54r7n1', type: 'semi', magSize: 10, startReserve: 40, maxReserve: 70, fireRate: 3, reloadTime: 2.6, spread: 0.004, range: 180, adsFov: 28, price: 2000, ammoPrice: 800 },
    barrett: { id: 'barrett', cat: 'sniper', name: 'BARRETT M82', cal: '50bmg', type: 'semi', magSize: 10, startReserve: 30, maxReserve: 50, fireRate: 1.2, reloadTime: 3.4, spread: 0.002, range: 220, adsFov: 20, price: 5000, ammoPrice: 1500 },
    // ---- fusil à pompe et arme spéciale
    shotgun: { id: 'shotgun', cat: 'shotgun', name: 'REMINGTON 870', cal: '12ga', type: 'shotgun', pellets: 8, magSize: 6, startReserve: 30, maxReserve: 48, fireRate: 1.3, reloadTime: 2.4, spread: 0.046, range: 35, price: 750, ammoPrice: 350 },
    // fusil semi-automatique à pompe de salon : une salve de 8 plombs par clic ; au mur de Saint-Thomas (3000 pts) et dans la boîte mystère
    saiga: { id: 'saiga', cat: 'shotgun', name: 'SAIGA-12', cal: '12ga', mod: 0.9, type: 'semi', pellets: 8, magSize: 8, startReserve: 32, maxReserve: 64, fireRate: 3.5, reloadTime: 2.6, spread: 0.05, range: 35, price: 3000, ammoPrice: 700 },
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
  papPrice: PAP_LEVELS[1].price, // prix du niveau I ; voir PAP_LEVELS pour II et III
  papLevels: PAP_LEVELS,

  // Fin de partie : « L'Heure du Jugement », déclenchée à l'horloge astronomique de la cathédrale.
  // Quatre actes : trois vagues (crypte, galeries, portes) -> le Bourreau dans la nef -> ascension de la tour sud
  // (330 marches) -> combat final sur la plateforme à 67 m. Les zombies n'apparaissent pas comme dans une manche
  // classique : ils sortent de la crypte, des galeries du triforium, des portes du parvis.
  finale: {
    price: 0,             // prix pour lancer l'événement
    minRound: 12,         // manche minimale
    minZones: 18,         // zones ouvertes au moins (les 10 zones d'origine + 8 zones extérieures) : « 14/18 quartiers »
    maxAlive: 28,         // zombies simultanés pendant une vague
    bossHealth: 350000,   // santé du Bourreau (joueur seul) ; +70 % par joueur supplémentaire (v0.36.1 : 200 000 -> 350 000, combat mesuré trop court)
    bossDamage: 45,       // coup de hache
    chargeDamage: 55,     // ruée
    slamDamage: 40,       // onde de choc (on l'évite en sautant)
    // Le Bourreau en quatre phases (v0.36.0), séparées par les seuils de santé `thresholds` (fractions de la santé maximale) :
    //   I (100 -> 70 %) la nef : hache, ruée, onde de choc et Chaînes ; transition 70 % : le Glas (invulnérable, renforts)
    //   II (70 -> 45 %) la Sentence, renforts réguliers ; à 45 % il bondit vers la tour (acte III, l'escalier), invulnérable
    //   III (45 -> 20 %) la plateforme : Couperet (hache lancée), ruée fréquente ; à 20 %, rugissement invulnérable
    //   IV (20 -> 0 %) le Jugement : rage, Bûcher (cercles de feu), Glas régulier ; après `enrageAfter` s de combat, dégâts x `enrageMult`.
    // sens : multiplicateurs des dégâts reçus (face, tête comprise ; dos = lanterne-cœur, plus fort encore sur les joueurs que la Sentence ne
    // vise pas ; zone = explosions et éclaboussures ; ray = tir direct du pistolet à rayons ; stun = étourdi). Le dos se décide par le produit
    // scalaire (direction du boss vers le point d'impact, cap du boss) < backCos. Le couteau garde ses propres dégâts de base (knife.boss).
    boss: {
      thresholds: [0.7, 0.45, 0.2],
      names: ['LE BOURREAU', 'LA SENTENCE', 'SUR LE TOIT', 'LE JUGEMENT'],
      speed: [2.2, 2.4, 2.7, 3.3],         // vitesse de marche par phase (m/s)
      sens: { front: 0.75, back: 2, backSentence: 2.5, zone: 0.25, ray: 0.35, stun: 1.5, backCos: -0.3 },
      // recharges (s) par phase : [I, II, III, IV] ; 0 = attaque absente de la phase
      cd: { charge: [8, 7, 5, 4], slam: [9, 8, 9, 7], chain: [10, 10, 10, 10], sentence: [0, 20, 0, 0], summon: [0, 20, 0, 0], axe: [0, 0, 9, 8], fire: [0, 0, 0, 14], toll: [0, 0, 0, 25] },
      gap: 1.3,                            // pause minimale entre deux attaques (s)
      chain: { tel: 0.9, damage: 25, pull: 5, minDist: 8, maxDist: 24, width: 1.3 }, // Chaînes : annoncées, lancées vers le joueur le plus loin, l'attirent de `pull` m
      glas: { invuln: 10, waves: 3, interval: 1.2, damage: 35, knights: 2, zombies: 4, perPlayer: 2, wavesLive: 3 }, // Le Glas : transition invulnérable (renforts), puis phase IV sans
      sentence: { tel: 0.9, duration: 8, mult: 1.5, speed: 3.0 }, // Sentence : joueur marqué (couronne), dégâts reçus x mult, seul poursuivi à `speed`
      couperet: { tel: 1.2, damage: 50, length: 18, width: 1.5, flight: 0.45 },  // hache lancée aller-retour, couloir length x width
      pyre: { circles: 3, perPlayer: 1, radius: 2.5, tel: 1.5, dps: 15, duration: 6, tick: 0.25 }, // Bûcher : cercles de feu
      rage: { roar: 2 },                   // rugissement invulnérable à 20 %
      enrageAfter: 600, enrageMult: 1.5,   // après 10 min de combat, tous ses coups x 1,5
      reward: { points: 10000 },           // + la Hache du Bourreau (knife.axe)
    },
    breather: 8,          // secondes de répit entre deux vagues
    waves: [
      { name: 'La crypte s\'ouvre', where: 'crypt', count: 16, perPlayer: 4, kinds: { normal: 0.75, bloat: 0.15, crawler: 0.1 } },
      { name: 'Les galeries', where: 'galleries', count: 20, perPlayer: 5, kinds: { normal: 0.4, runner: 0.3, crawler: 0.1, armored: 0.2 } },
      { name: 'Les portes de la ville', where: 'portal', count: 24, perPlayer: 6, kinds: { normal: 0.3, runner: 0.25, armored: 0.25, bloat: 0.2 } },
    ],
    kindHealth: { normal: 1, runner: 0.8, crawler: 0.8, armored: 3, bloat: 1.6, gargoyle: 1.2 },
  },

  // Acte V « L'Aube » (v0.37.0, summit.js / angel.js / finale.js) : après la victoire sur le Bourreau, la flèche de la cathédrale s'illumine
  // d'un faisceau ; il faut monter (plateforme 67,5 m -> escalier 104 m -> rampe 128 m) et allumer le Fanal d'Erwin à la pointe.
  // Étapes (états `summit_*` de finale.js) : 1 gargouilles sur la terrasse, 2 l'Ange du Jugement, 3 la rampe (rafales + gargouilles qui montent),
  // 4 le Fanal (chaque joueur debout le maintient `fanal.hold` s : progression commune), 5 l'Aube. Ensuite : la « Nuit éternelle ».
  summit: {
    beamFit: 150,                    // distance maximale (m) de la pointe du faisceau à la caméra : au-delà il est réduit vers la caméra (visible de toute la ville)
    // gargouilles : zombies de pierre (variante `gargoyle`, coureurs) qui surgissent des parapets de la terrasse
    gargoyles: {
      count: 24, perPlayer: 6,       // total de l'étape 1 (+ par joueur en plus)
      maxAlive: 10, interval: 1.1,   // simultanées, délai entre deux apparitions (s)
      speed: 1.5,                    // multiple de la vitesse des zombies de la manche
      appear: 0.7,                   // durée de l'apparition sur le parapet (s)
      minDist: 5,                    // distance minimale d'apparition à un joueur (m)
    },
    // L'Ange du Jugement : boss secret qui tourne hors de la tour (cercle de `radius` m autour de l'axe, à `height` m), scripté.
    // Point faible : la trompette (dégâts x weak). Attaques : Trompette (cône annoncé), Plumes (éventail de projectiles), Jugement (marque).
    angel: {
      health: 40000, perPlayer: 0.7, // PV (+70 % par joueur en plus)
      radius: 14, height: 106, omega: 10, bob: 0.4, scale: 2.6, // cercle (m), altitude (m), vitesse angulaire (degrés/s), flottement (m), taille du modèle
      weak: 2,                       // trompette : dégâts x2 (quelle que soit l'arme)
      gap: 2.2, first: 3,            // pause minimale entre deux attaques (s), délai de la première
      trumpet: { tel: 1, damage: 40, range: 10, angle: 20, cooldown: 7, dur: 0.6 },   // cône de `range` m, demi-angle en degrés, annoncé `tel` s
      plumes: { tel: 0.7, count: 5, damage: 15, speed: 16, spread: 12, cooldown: 5, life: 2, radius: 0.75 }, // éventail de `count` plumes, `spread` degrés d'écart
      judgment: { tel: 3, damage: 70, cooldown: 16, fromHealth: 0.6 }, // un joueur est marqué `tel` s puis frappé d'un rayon, sauf s'il se cache derrière la flèche
      reward: 5000,                  // points par joueur
    },
    // rampe : une rafale toute les `interval` s pousse le joueur de `push` m/s pendant `duration` s (les garde-corps le retiennent) ;
    // des gargouilles montent depuis le bas de la rampe
    ramp: { interval: 6, push: 2.5, duration: 1, outward: 0.6, gargoyles: { every: 7, count: 2, maxAlive: 6, behind: 24 } }, // behind : distance (m de rampe) sous le joueur le plus haut où surgissent les gargouilles qui montent
    // Fanal d'Erwin (balcon de la pointe) : chaque joueur debout le maintient `hold` s à moins de `range` m ; progression commune
    // (chaque tenant fait avancer la jauge de 1/hold par seconde, divisé par le nombre de joueurs debout)
    fanal: { hold: 6, range: 3.2, decay: 0.5 }, // decay : la jauge retombe à decay/hold par seconde quand personne ne maintient la touche
    // l'Aube : le ciel passe de la nuit au jour en `sky` s, vue orbitale `orbit` s (Échap la passe), cendres des zombies ; la Bénédiction de l'Aube
    // donne tous les atouts (gardés à terre) et rend les portes gratuites
    dawn: { sky: 30, orbit: 12, ash: 1.6, orbitRadius: [30, 22], orbitHeight: [132, 146] },
    // Nuit éternelle : le jour dure `day` s puis la nuit retombe en `dusk` s ; les zombies ont `healthMult` x plus de vie dès la manche suivante
    eternal: { day: 60, dusk: 20, healthMult: 1.3 },
  },

  // Enjambement (Espace devant un obstacle enjambable de moins de 1,15 m : banc, poubelle, jardinière, caisse, borne, vélos si profondeur <= 1,3 m,
  // sacs de sable, barrière de foule, bloc béton ; voir Collision.findVault) : reach = distance maximale à l'obstacle (m), maxAngle = écart de
  // face (degrés), maxDepth = profondeur traversée maximale (m), clearance = distance d'arrivée derrière l'obstacle (m), heightTol = écart de
  // hauteur toléré au sol d'arrivée (m), time = durée (s), camLift = élévation de la caméra (m), cooldown = délai avant un nouvel enjambement (s)
  vault: { reach: 0.9, maxAngle: 45, maxDepth: 1.3, clearance: 0.5, heightTol: 0.3, time: 0.5, camLift: 0.6, cooldown: 0.25 },
  // Se débloquer (touche K maintenue holdTime s, voir unstick.js) : l'invite apparaît si une touche de déplacement est maintenue stuckAfter s sans
  // avancer de moveMin m, ou si la position est dans une poche fermée (moins de pocketMaxArea m²) depuis trapAfter s ; arrivée à moins de maxDist m ; recharge cooldown s
  unstick: { stuckAfter: 4, moveMin: 0.5, trapAfter: 3, pocketMaxArea: 150, holdTime: 2, maxDist: 40, cooldown: 30 },
  // Couteau (touche V à pied ; clic gauche quand le chargeur ET la réserve sont vides). Toujours disponible, hors inventaire.
  // Dégâts = max(minDamage, healthFrac x santé des zombies de la manche) : 3 coups quelle que soit la manche dès la 10 ; dos ou tête x weakMult
  // (non cumulés). Armure du chevalier de fer ignorée (coup de miséricorde). Bourreau : dégâts fixes, x front de face, x back dans le dos.
  // La touche à hitDelay s ; fente de lunge m vers un zombie à moins de lungeNear m si on avance ; hostRange : portée maximale acceptée par l'hôte.
  knife: {
    range: 1.8, cone: 35, cooldown: 0.6, hitDelay: 0.12, anim: 0.55, dip: 0.3,
    lunge: 0.8, lungeNear: 2.6, lungeTime: 0.12,
    minDamage: 150, healthFrac: 0.34, weakMult: 1.5, backCos: -0.3,
    boss: { dmg: 150 },   // Bourreau : dégâts de base ; face x finale.boss.sens.front, dos x sens.back (les mêmes que pour les balles)
    // Hache du Bourreau (récompense de la finale, remplace le couteau) : dégâts x dmgMult, touche aussi un second zombie à moins de `splash` m du premier
    axe: { dmgMult: 3, extra: 1, splash: 1.8 },
    points: { hit: 10, kill: 100 },
    stab: 0.35, hostRange: 4,
  },
  grenade: { start: 2, max: 4, perRound: 2, fuse: 2.2, radius: 6.5, damage: 900, selfDamage: 60 },

  // Maître Tanneur (v0.36.0, tanner.js) : mini-boss, un pestiféré colossal. Apparaît à l'ouverture des manches fromRound, fromRound + every, …
  // (manches 15, 20, 25…) dans la première des zones `zones` qui est ouverte. Santé = healthMult x santé d'un zombie de la manche, +perPlayer
  // par joueur supplémentaire. Vomi : cône de `range` m (demi-angle `angle` degrés) annoncé `tel` s, `initial` dégâts puis `dps` par seconde
  // pendant `duration` s (le PHD Flopper ne protège pas) ; appelle `summon.count` pestiférés ; à sa mort explose (rayon `explosion.radius`,
  // `explosion.damage` dégâts, le PHD Flopper protège). Récompense : Max Munitions et `reward.points` points par joueur.
  tanner: {
    zones: ['Petite France', 'Saint-Pierre-le-Vieux'], fromRound: 15, every: 5,
    healthMult: 30, perPlayer: 0.5, speed: 2.0, damage: 30,
    vomit: { tel: 0.8, range: 8, angle: 32, initial: 20, dps: 5, duration: 4, tick: 0.5, cooldown: 8 },
    summon: { count: 3, cooldown: 20, healthMult: 1.6 },
    explosion: { radius: 6, damage: 60 },
    reward: { points: 1500 },
  },

  // Véhicules (motos). Touches : ZQSD / flèches pour conduire, Espace = frein à main, E = monter / descendre.
  // Le conducteur ne tire pas (les deux mains sur le guidon) ; le passager de la grosse moto, lui, tire normalement.
  // Vitesses en m/s (le joueur marche à 5 et sprinte à 8 ; les zombies vont de 1,7 à 3,8). grip : accélération latérale maximale
  // (m/s²) : plus elle est faible, plus il faut ralentir pour tourner (rayon minimal = vitesse² / grip).
  vehicles: {
    mountRange: 2.6,   // distance maximale pour monter (m)
    pumpRange: 2.4,    // distance maximale à la borne du parking pour l'utiliser (m) ; pumpReach : distance borne-moto maximale (m)
    pumpReach: 8,
    // Parkings (v0.29.0 : un tableau). Chacun a ses emplacements fixes (aucun tirage : identiques chez tous les joueurs), un panneau
    // « P » et une borne plein + réparation. Les motos sont créées dans l'ordre des parkings puis des `bays` (leur identifiant en dépend).
    // x, z : centre (m) ; yaw : cap des motos (0 = vers le nord, -z) ; dx / dz : décalage dans le repère du parking (dx vers la droite
    // des motos, dz vers l'arrière). rect : emprise réservée au décor (m), entièrement dans la zone `zone`, dégagée et accessible
    // (au moins 8 m des portes : leur invite [E] ne doit pas être masquée). Un parking dont le rectangle est invalide est ignoré
    // (avertissement en ?debug) ; si aucun ne l'est, les motos retombent sur `spawns` (ancien tirage).
    parkings: [
      // place Gutenberg, à côté de l'entrée du parking souterrain : 2 motos
      {
        zone: 'Place Gutenberg', x: -22, z: 70, yaw: 0,
        bays: [{ type: 'moto', dx: -1.2 }, { type: 'grosseMoto', dx: 1.2 }],
        slots: [-3.6, -1.2, 1.2, 3.6], // emplacements peints au sol (dx) ; 1,6 x 2,6 m ; les motos occupent les deux du milieu
        pump: { dx: -6.5, dz: 0 }, sign: { dx: 0, dz: 5.5 },
        rect: { w: 10, d: 12 },
      },
      // place Broglie (v0.29.0) : 1 moto et sa borne, pour la partie nord-est de l'île
      {
        zone: 'Place Broglie', x: 169.5, z: -340.5, yaw: 0,
        bays: [{ type: 'moto', dx: 0 }],
        slots: [0],
        pump: { dx: -3.6, dz: 0.5 }, sign: { dx: 3.6, dz: 3.5 },
        rect: { w: 10, d: 12 },
      },
    ],
    // Repli (voir parkings) : une ligne par moto, posée dans la zone nommée sur un emplacement dégagé
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
    //  - choc contre un objet physique (voiture, mobilier, arbre, machine… : obstacle de nature 'prop') : max(0, impact - crashFree) x crashPerMs
    //    (impact = vitesse perdue, m/s) ; contre un MUR (architecture : façade, quai, parapet, porte, marche, bord de l'île : nature 'wall')
    //    la moto est abîmée de `wall` x ce montant (0 = jamais) ; le pilote, lui, se blesse pareil (crash.minSpeed)
    //  - choc moto contre moto : chacune perd max(0, vitesse relative d'approche - motoHit.free) x motoHit.perMs PV ; rebond : la moto perd
    //    motoHit.bounce x sa vitesse vers l'autre (l'autre moto, si elle est conduite par un autre joueur, calcule ses propres dégâts)
    //  - un coup de zombie sur un occupant : zombieHit
    //  - explosion (grenade, M79, pestiféré, autre moto) : `explosion` x les dégâts infligés aux zombies, même atténuation ; balles et
    //    splash (pistolet à rayons, carreau explosif, onde du PHD) n'abîment pas les motos
    //  - écrasement : roadkillKill par zombie tué, roadkillHurt par zombie qui survit
    //  - à 0 PV : en feu pendant burnTime s (moteur coupé, personne ne peut monter), puis explosion (blast : rayon, dégâts aux zombies avec
    //    atténuation, dégâts maximaux aux joueurs, jamais mortels), épave wreckTime s, puis retour au parking à la manche suivante + respawnRounds
    //  - fumée selon les PV (grey / black : fraction des PV en dessous de laquelle, particules par seconde ; flames : flammèches)
    damage: {
      crashFree: 6, crashPerMs: 5, wall: 0, motoHit: { free: 4, perMs: 4, bounce: 1.3, hitCooldown: 0.5, driven: 0.55 }, zombieHit: 10, explosion: 0.1, roadkillKill: 5, roadkillHurt: 12,
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
        wheelbase: 1.35, maxSteer: 0.62, grip: 15, radius: 0.55, bikeRadius: 0.45, roadkill: { K: 16, vmin: 9, slowdown: 0.85 },
      },
      grosseMoto: {
        name: 'GROSSE MOTO', seats: 2, camArm: 4.0, hp: 500, tank: 10, idle: 0.005, gas: 0.016, perSpeed: 0.021, maxSpeed: 17, accel: 8, brake: 24, reverseSpeed: 3, drag: 0.12,
        wheelbase: 1.75, maxSteer: 0.5, grip: 11, radius: 0.7, bikeRadius: 0.55, roadkill: { K: 24, vmin: 7, slowdown: 0.90 },
      },
    },
  },

  // Tram (v0.38.0 : réseau de voies ; v0.39.0 : rame conduisible). Le plan d'Open Street Map n'a ni rues ni voies : les lignes sont tracées à la main
  // (x vers l'est, z vers le sud, en mètres depuis le centre des données) le long des rues les plus larges, vérifiées par script : une ligne est une
  // polyligne [[x, z, r?], ...], r étant le rayon (m, au moins minRadius) de l'arc de raccord posé au sommet (30 par défaut). Largeur libre exigée
  // de part et d'autre de l'axe : `clearHalf` (6,5 m en tout) sur la grille de navigation.
  //  - A / D : de l'angle nord-ouest de la place (heurtoir) à l'Homme de Fer (axe à 64° sous la rotonde), puis la place Kléber et la place Gutenberg
  //  - B / C / F : de l'ouest (Alt Winmärik) à l'Homme de Fer (rue est-ouest au nord de la place), puis Broglie et le nord-est de l'île
  // stops : arrêts { name, at: [x, z] (projeté sur la voie), len (quai, m) } ; chaque bout de ligne porte un heurtoir. Une porte de zone fermée qui
  // coupe une voie est un heurtoir avec feu rouge (la rame freine d'elle-même) ; l'ouvrir libère le tronçon.
  tram: {
    minRadius: 25, step: 1, clearHalf: 3.25, decorGap: 5, furnitureGap: 4, itemGap: 4.6, lampGap: 3.9, treeGap: 4.1,
    rail: { gauge: 1.435, bed: 3.0, element: 4, curveElement: 2, curveBelow: 300 },
    // quais : largeur maximale (m) de chaque côté, hauteur de la dalle
    platform: { width: 2.6, height: 0.07, edge: 0.4, minWidth: 0.9 },
    // caténaire : un poteau tous les `every` m, côtés alternés, à `offset` m de l'axe ; hauteur du fil
    pole: { every: 12, offset: 2.9, height: 6.0, wire: 5.5 },
    // heurtoirs et feux : distance (m) du premier arrêt automatique (voir tram.js), recul du heurtoir par rapport à la porte
    gate: { signalDist: 15, stopGap: 2.5, lamp: 0xff2a1a },
    // plan de la place de l'Homme de Fer (lu par planHdf) : phase des 12 colonnes de la rotonde (°) : la même que depuis la v0.19.0, car la
    // grille de navigation, donc le tirage des emplacements de toute l'île, en dépend ; columnGap : écart minimal (m) souhaité entre une colonne et
    // l'axe d'une voie (avertissement en ?debug) ; ad : cap (°) de la ligne A / D sous la rotonde ; decor : rames de décor { line, side (-1 vers le
    // début de la ligne, 1 vers la fin), modules } cherchées à moins de maxReach m du point de la ligne le plus proche de la rotonde
    hdf: {
      colPhase: 10, columnGap: 1.2, ad: 64,
      decor: [{ line: 'AD', side: -1, modules: [7, 3] }, { line: 'AD', side: 1, modules: [7, 3] }],
    },
    // ---- rame conduisible (v0.39.0) : une seule, garée au quai « Homme de Fer » de la ligne B / C / F ; les rames de décor ne roulent pas
    // car : 5 modules de `module` m (23,5 m en tout), cabine à chaque bout, `doors` portes de `doorWidth` m par côté, sièges : 2 de conducteur (un par
    // cabine) + `perSide` assis de chaque côté (16 en tout) ; les passagers sont assis (l'intérieur praticable : v0.40.0)
    car: { modules: 5, module: 4.7, width: 2.4, height: 3.4, floor: 0.32, doors: 4, doorWidth: 1.3, perSide: 7, camArm: 12, start: { line: 'BCF', stop: 'Homme de Fer' } },
    // conduite : une position 1D `s` le long de la voie ; vitesses en m/s, accélérations en m/s². Accélération : accel (qui faiblit vers la vitesse
    // maximale) ; frein de service : brake (touche de recul) ; frein d'urgence : emergency (touche de saut, Espace par défaut) ; marche arrière :
    // reverse m/s au plus ; drag : résistance. Virage : la vitesse est plafonnée à sqrt(grip x R) (R : rayon de la voie) avec une alarme, et la rame
    // freine d'elle-même (autoBrake) en regardant lookAhead m devant : pas de déraillement. Portes de zone fermées : même freinage automatique
    // (gate.signalDist). Les portes de la rame ne s'ouvrent et ne se ferment qu'à moins de doorSpeed m/s ; on monte ou descend à moins de boardSpeed m/s.
    drive: { maxSpeed: 14, accel: 1.3, brake: 1.8, emergency: 3, reverse: 4, drag: 0.2, grip: 1.0, lookAhead: 70, autoBrake: 2.5, doorTime: 1.2, doorSpeed: 1.2, boardSpeed: 1.5 },
    // intérieur praticable (v0.40.0, voir tramInterior.js) : on marche dans la rame à `speed` x la vitesse de marche normale, rayon `radius` m (l'allée entre
    // les banquettes est étroite), parois à `wall` m de l'axe (épaisseur `thick`), plancher de la rame à car.floor ; le plancher s'arrête `endGap` m avant
    // le bout du nez. Les portes ne laissent passer que si elles sont ouvertes à plus de `doorOpen` (0 à 1) ET la rame roule à moins de drive.boardSpeed.
    // Monter à pied : appuyer contre une porte ouverte (écart latéral `boardW`, poussée d'au moins `boardPush` m/s) ou interagir à moins de `boardReach` m
    // d'une porte ouverte ; descendre : dépasser `exitW` m de l'axe dans l'ouverture. S'asseoir : siège libre à moins de `seatReach` m. Debout à côté du siège
    // en se levant : `stand` m de l'axe. Zombies : une porte ouverte se tient à `doorSpot` m de la caisse (les zombies s'y massent), frappe à 1,3 m.
    walk: { radius: 0.3, wall: 1.15, thick: 0.15, endGap: 1.55, doorOpen: 0.6, boardW: 1.78, boardPush: 0.8, boardReach: 2.4, exitW: 1.45, seatReach: 1.35, stand: 0.4, doorSpot: 0.55, enterEase: 9 },
    // PV et chocs. Joueur à pied : repoussé, `playerDamage` PV au-dessus de `playerSpeed` m/s (jamais mortel) ; zombie : au-dessus de `zombieSpeed` m/s, dégâts =
    // zombieK x vitesse (et la rame ne ralentit pas), en dessous il bloque la rame (arrêt net) ; heurtoir : au-dessus de bufferFree m/s la rame perd
    // (vitesse - bufferFree) x bufferPerMs PV ; coup de zombie sur la caisse : zombieHit PV (les passagers ne sont atteints que par une porte ouverte)
    hp: 3000, zombieHit: 2,
    hit: { playerSpeed: 5, playerDamage: 10, zombieSpeed: 3, zombieK: 40, zombieCooldown: 0.5, bufferFree: 4, bufferPerMs: 40, crashMin: 8, crashDamagePerMs: 3.5, crashMax: 45 },
    // énergie : la sous-station de l'Homme de Fer coûte `price` pts, payée une fois pour toute l'équipe ; ensuite la conduite est gratuite.
    // À 0 PV la rame est hors service jusqu'au retour au dépôt, `respawnRounds` manches plus tard (PV pleins)
    power: { price: 2000, range: 2.6, respawnRounds: 2 },
    // gong : attire les zombies à moins de `range` m pendant `duration` s (ils le prennent pour cible du champ de flux) ; recharge `cooldown` s
    gong: { range: 50, duration: 8, cooldown: 3 },
    lines: [
      {
        id: 'AD', name: 'A / D', color: '#d8452b',
        pts: [[-343, -326], [-323.4, -270.5, 60], [-290.56, -203], [-270.84, -162.56, 40], [-236, -125, 40], [-124, -125, 45], [-101, -56, 40], [-58, 8, 40], [-22, 52]],
        stops: [{ name: 'Place Kléber', at: [-196, -125], len: 34 }, { name: 'Gutenberg', at: [-34.7, 36.5], len: 30 }],
      },
      {
        id: 'BCF', name: 'B / C / F', color: '#2b6fd8',
        pts: [[-516, -190], [-493, -188, 30], [-366, -231, 40], [-297, -239.8, 40], [-262, -240.6, 30], [-194, -236, 40], [-97, -233, 40], [-37, -237, 30], [8, -257.6, 30], [41.6, -271.2, 40], [127.6, -329.4, 40], [158, -366, 30], [205, -368, 30], [250, -374, 40], [284, -378, 40], [315, -398, 40], [345, -404, 40], [378, -404, 40], [398, -384, 40], [436, -334, 40], [480, -290]],
        stops: [{ name: 'Alt Winmärik', at: [-438, -206.6], len: 34 }, { name: 'Homme de Fer', at: [-332.2, -235.3], len: 40 }, { name: 'Broglie', at: [63.3, -285.9], len: 34 }, { name: 'République', at: [228.8, -371.2], len: 34 }, { name: 'Préfecture', at: [456, -314], len: 30 }],
      },
    ],
  },

  powerups: {
    dropChance: 0.05,
    duration: 25,     // durée d'activité sur le sol avant disparition
    buffDuration: 30, // durée de l'effet temporaire (Insta-Kill, Points Doubles)
    // à la première ouverture d'une zone extérieure : un de ces bonus apparaît dans la zone (tirage de l'hôte)
    openingBonus: ['max_ammo', 'double_points'],
  },

  zombie: {
    // santé de base d'un zombie : health.base + manche x health.perRound avant la manche health.softRound, ensuite
    // health.hardBase x health.hardGrowth ^ (manche - softRound + 1)
    health: { base: 70, perRound: 30, softRound: 10, hardBase: 340, hardGrowth: 1.1 },
    // enjambement des obstacles bas (banc, caisse, barrière de foule…) : le champ de flux les traverse à un coût de `cost` par case (10 = case
    // libre) ; le zombie saute en `time` s (arc de `arc` m) à moins de `reach` m, de face (`maxAngle` degrés), puis attend `cooldown` s
    vault: { cost: 40, time: 0.8, arc: 0.7, reach: 1.0, maxAngle: 60, cooldown: 1.5 },
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
    // champ de flux (chemin vers les joueurs) : calculé seulement jusqu'à `range` m de marche autour de chaque joueur (une grande
    // île coûterait 25 000 cases par image en permanence), par tranches de `budget` cases par image, relancé au plus toutes les
    // `interval` s. Un zombie plus loin va tout droit ; relocateZombies le ramène près des joueurs s'il reste coincé ou trop loin.
    flow: { range: 160, interval: 0.2, budget: 25000 },
    // pestiféré (variante 'bloat' : gonflé de gaz, explose à sa mort : 38 dégâts au plus à moins de 4,2 m, le PHD Flopper les ignore) :
    // dans les zones listées, à partir de la manche fromRound, `chance` par zombie, maxAlive en vie au plus, santé x healthMult
    pestilent: { zones: ['Petite France', 'Saint-Pierre-le-Vieux'], fromRound: 10, chance: 0.12, maxAlive: 3, healthMult: 1.6 },
    // apparition en coop : le joueur ciblé est tiré avec le poids 1 / (1 + n), n = zombies à moins de `radius` m de lui (les joueurs
    // éloignés les uns des autres ne se partagent plus les zombies au hasard) ; un client ne dessine que ce qui est à moins de `drawRange` m
    spawnBalance: { radius: 45 },
    drawRange: 170,
  },
};

// Touches par défaut (modifiables dans Options > Touches, voir keybinds.js). Une liaison s'écrit 'code:KeyW' (touche PHYSIQUE : ZQSD en
// AZERTY = WASD en QWERTY) ou 'key:r' (LETTRE TAPÉE, quel que soit le clavier). kind : comment une nouvelle liaison est lue, 'code' pour
// les déplacements, le sprint, le saut et les armes 1-3 (position de la touche), 'key' pour les actions (lettre tapée si c'est une lettre,
// sinon touche physique). ctx : 'all', 'foot' (à pied) ou 'moto' (en moto) : deux actions de contextes différents peuvent partager une touche.
// alt : touche physique de secours (flèches), active tant qu'aucune action ne l'utilise.
CONFIG.keybinds = [
  { id: 'forward', group: 'Déplacement', label: 'Avancer', def: 'code:KeyW', kind: 'code', ctx: 'all', alt: 'ArrowUp' },
  { id: 'left', group: 'Déplacement', label: 'Aller à gauche', def: 'code:KeyA', kind: 'code', ctx: 'all', alt: 'ArrowLeft' },
  { id: 'back', group: 'Déplacement', label: 'Reculer', def: 'code:KeyS', kind: 'code', ctx: 'all', alt: 'ArrowDown' },
  { id: 'right', group: 'Déplacement', label: 'Aller à droite', def: 'code:KeyD', kind: 'code', ctx: 'all', alt: 'ArrowRight' },
  { id: 'sprint', group: 'Déplacement', label: 'Sprint', def: 'code:ShiftLeft', kind: 'code', ctx: 'all' },
  { id: 'jump', group: 'Déplacement', label: 'Sauter · enjamber · frein à main (moto) · frein d\'urgence (tram)', def: 'code:Space', kind: 'code', ctx: 'all' },
  { id: 'reload', group: 'Combat', label: 'Recharger', def: 'key:r', kind: 'key', ctx: 'all' },
  { id: 'weapon1', group: 'Combat', label: 'Arme 1', def: 'code:Digit1', kind: 'code', ctx: 'all' },
  { id: 'weapon2', group: 'Combat', label: 'Arme 2', def: 'code:Digit2', kind: 'code', ctx: 'all' },
  { id: 'weapon3', group: 'Combat', label: 'Arme 3', def: 'code:Digit3', kind: 'code', ctx: 'all' },
  { id: 'grenade', group: 'Combat', label: 'Grenade', def: 'key:g', kind: 'key', ctx: 'all' },
  { id: 'knife', group: 'Combat', label: 'Coup de couteau (à pied)', def: 'key:v', kind: 'key', ctx: 'foot' },
  { id: 'torch', group: 'Équipement', label: 'Lampe torche', def: 'key:f', kind: 'key', ctx: 'all' },
  { id: 'interact', group: 'Équipement', label: 'Interagir (acheter, porte, machine, réanimer, moto)', def: 'key:e', kind: 'key', ctx: 'all' },
  { id: 'map', group: 'Équipement', label: 'Carte', def: 'key:m', kind: 'key', ctx: 'all' },
  { id: 'vehicleView', group: 'Équipement', label: 'Changer de vue (en moto ou en tram)', def: 'key:v', kind: 'key', ctx: 'moto' },
  { id: 'tramGong', group: 'Équipement', label: 'Gong du tram (attire les zombies)', def: 'key:h', kind: 'key', ctx: 'moto' },
  { id: 'tramDoors', group: 'Équipement', label: 'Portes du tram (ouvrir / fermer)', def: 'key:o', kind: 'key', ctx: 'moto' },
  { id: 'unstick', group: 'Équipement', label: 'Se débloquer (maintenir)', def: 'key:k', kind: 'key', ctx: 'foot' },
];
// Touches fixes, affichées dans le menu mais non modifiables : [touche, action]
CONFIG.fixedKeys = [
  ['Souris', 'Viser'],
  ['Clic gauche', 'Tirer'],
  ['Clic droit', 'Viser à la mire'],
  ['Molette', 'Changer d\'arme'],
  ['Clic molette', 'Lance-grenades (fusil d\'assaut PaP III)'],
  ['Échap', 'Pause · fermer la carte ou un menu'],
  ['F9', 'Menu debug (hôte uniquement)'],
];
// Touches réservées : refusées à la capture (le navigateur ou le jeu s'en sert)
CONFIG.reservedKeys = {
  Escape: 'Échap annule la capture', F9: 'F9 ouvre le menu debug de l\'hôte', F5: 'F5 recharge la page', F11: 'F11 gère le plein écran', F12: 'F12 ouvre les outils du navigateur',
  MetaLeft: 'cette touche appartient au système', MetaRight: 'cette touche appartient au système', ContextMenu: 'cette touche appartient au système',
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

// Chargeur fixé à partir du niveau II par l'accessoire (tambour de 75 coups de l'AK-47…), au lieu du calcul général
const PAP_MAG = { ak47: 75, saiga: 20, crossbow: 3, m79: 3 };

// Statistiques d'une arme au niveau lv (1 à 3) du Pack-a-Punch, à partir de ses stats de base ; {} au niveau 0. Les atouts (Double Tap,
// Speed Cola) s'appliquent ensuite (Player.statsOf). Fonction pure : le jeu et tools/make-docs.mjs s'en servent.
export function papStats(base, lv) {
  const L = PAP_LEVELS[lv];
  if (!L) return {};
  const s = { pap: lv };
  s.name = (CONFIG.papNames[base.id] || `${base.name} +`) + (lv > 1 ? ' ' + L.roman : '');
  s.damage = base.damage * (base.id === 'raygun' ? L.ray : L.dmg);
  s.headMult = base.headMult * L.head;
  s.pierce = (base.pierce || 0) + L.pierce;
  s.magSize = lv > 1 && PAP_MAG[base.id] ? PAP_MAG[base.id] : Math.round(base.magSize * L.mag * L.magX);
  s.maxReserve = Math.round(base.maxReserve * L.reserve);
  s.reloadTime = base.reloadTime * L.reload;
  s.spread = base.spread * L.spread;
  s.tracer = L.tracer;
  if (base.splash) s.splash = { radius: base.splash.radius * 1.3, damage: base.splash.damage * 2 };            // pistolet à rayons
  if (base.papSplash) s.splash = { ...base.papSplash };                                                        // arbalète : carreau explosif
  if (base.blast) s.blast = { ...base.blast, radius: base.blast.radius * 1.3, damage: base.blast.damage * 2 }; // M79 : explosion x2, rayon x1,3
  // ---- particularités par catégorie et par niveau (accessoires, voir viewmodels.js)
  const cat = base.cat, id = base.id;
  if (cat === 'mg') { s.zoom = 45; if (lv === 3) s.fireRate = base.fireRate * 1.15; }  // ACOG (champ de vision de la visée) ; canon lourd au niveau III
  if (cat === 'shotgun') { s.spread *= 0.8; if (lv === 3) { s.pellets = 12; s.tracer = 0xff9a30; } } // choke ; souffle du dragon : 12 plombs orange
  if (cat === 'sniper' && lv === 3) s.boom = { radius: 2, frac: 0.4, color: 0xff8a2a };           // balles explosives : explosion de 2 m à 40 % des dégâts du tir
  if (lv === 3 && ['pistol', 'ar', 'smg', 'mg'].includes(cat)) s.ether = { chance: 0.2, radius: 2, frac: 0.5, color: 0x66ffe0 }; // Éther : 20 % des touches, explosion de 2 m à 50 %
  if (lv === 3 && cat === 'ar') s.gl = { shells: 3, cooldown: 1 };                                   // lance-grenades sous canon (clic molette)
  if (id === 'raygun') { s.pierce = [0, 2, 3, 6][lv]; s.splash = { radius: base.splash.radius * 1.3, damage: base.splash.damage * [0, 2, 2.8, 4][lv] }; }
  if (id === 'crossbow' && lv === 3) s.splash = { ...base.papSplash, radius: base.papSplash.radius + 1, damage: base.papSplash.damage * 1.5 }; // fragmentation
  if (id === 'm79') s.blast = { ...base.blast, radius: base.blast.radius * [0, 1.3, 1.45, 1.6][lv], damage: base.blast.damage * [0, 2, 3, 4.5][lv] };
  return s;
}

// Coefficient du prix des munitions au mur d'une arme de niveau lv (1 sans Pack-a-Punch)
export const papAmmoMult = (lv) => PAP_LEVELS[lv | 0]?.ammo ?? 1;

// Pulsation du reflet du niveau III (coefficient sur l'intensité émissive, autour de 1 ; 1 pour les autres niveaux). t en secondes.
export function papPulse(lv, t) {
  const L = PAP_LEVELS[lv];
  return L && L.pulseHz ? 0.55 + 0.9 * (0.5 + 0.5 * Math.sin(2 * Math.PI * L.pulseHz * t)) : 1;
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
