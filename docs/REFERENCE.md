# Zombie Survival — fiche de référence

Version du jeu : **v0.10.1 · 6794165 · 2026-10-05** (package 0.13.0). Générée automatiquement par `node tools/make-docs.mjs` à partir de `src/config.js` et du jeu.
Carte annotée : [carte.png](carte.png). Armes de profil : [armes.png](armes.png). Les mêmes tableaux en tableur : dossier [csv/](csv/).

Pour demander une modification, citez la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts », « mettre la boîte mystère dans la zone Temple-Neuf »).

## Secteur jouable

Seul le secteur autour de la place du Marché-Neuf est ouvert ; le reste de la Grande Île est visible mais fermé par des barricades « ZONE FERMÉE ».
Il est découpé en 9 zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à 95 m), et les portes se trouvent entre deux zones.
Prix des portes : 750 pts pour une zone voisine du départ, +250 par zone plus loin. Le contenu de chaque zone se règle dans `src/config.js` → `sector.zones[].items`.

## Armes

| id | Arme | Catégorie | Calibre | Type | Dégâts par balle | Plombs par tir | Multiplicateur tête | Cadence (tirs/s) | DPS approx. | Chargeur | Réserve départ | Réserve max | Rechargement (s) | Dispersion | Portée (m) | Zombies traversés | Explosion rayon (m) | Explosion dégâts | Prix au mur (pts) | Prix munitions (pts) | Où l'obtenir |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| m1911 | COLT M1911 | pistolet | .45 ACP | coup par coup | 48 | 1 | 2,6 | 5,5 | 264 | 7 | 42 | 84 | 1,5 | 0,01 | 50 | 1 |  |  | 400 | 150 | mur Marché-Neuf, boîte mystère, arme de départ |
| arex | AREX ZERO 1 | pistolet | 9 mm | coup par coup | 34 | 1 | 2,4 | 7,5 | 255 | 17 | 68 | 136 | 1,4 | 0,009 | 55 | 1 |  |  | 700 | 250 | mur Temple-Neuf, boîte mystère |
| deagle | DESERT EAGLE | pistolet | .50 AE | coup par coup | 165 | 1 | 3 | 2,4 | 396 | 7 | 35 | 56 | 1,9 | 0,011 | 70 | 2 |  |  | 1500 | 600 | mur Cathédrale, boîte mystère |
| magnum | COLT PYTHON .357 | pistolet | .357 Magnum | coup par coup | 190 | 1 | 3 | 3,2 | 608 | 6 | 48 | 72 | 2,2 | 0,006 | 80 | 2 |  |  | boîte | 500 | boîte mystère |
| rifle | M4A1 | fusil d'assaut | 5,56 mm | automatique | 36 | 1 | 2,5 | 9,5 | 342 | 30 | 120 | 180 | 1,8 | 0,012 | 90 | 1 |  |  | 1200 | 300 | mur Cathédrale, boîte mystère, arme de départ |
| ak47 | AK-47 | fusil d'assaut | 7,62×39 mm | automatique | 46 | 1 | 2,3 | 8,5 | 391 | 30 | 120 | 210 | 2,4 | 0,017 | 90 | 1 |  |  | 1600 | 600 | mur Grandes Arcades, boîte mystère |
| famas | FAMAS F1 | fusil d'assaut | 5,56 mm | automatique | 34 | 1 | 2,4 | 15 | 510 | 25 | 125 | 225 | 2,2 | 0,014 | 85 | 1 |  |  | 1300 | 500 | mur Rue des Orfèvres, boîte mystère |
| scar | SCAR-H | fusil d'assaut | 7,62×51 mm | automatique | 58 | 1 | 2,4 | 7,5 | 435 | 20 | 100 | 180 | 2,3 | 0,012 | 100 | 2 |  |  | 2200 | 800 | mur Place Gutenberg, boîte mystère |
| smg | MP40 | pistolet-mitrailleur | 9 mm | automatique | 24 | 1 | 2,2 | 9,5 | 228 | 32 | 128 | 224 | 1,5 | 0,022 | 65 | 1 |  |  | 1000 | 500 | mur Marché-Neuf, boîte mystère |
| mp5 | MP5 | pistolet-mitrailleur | 9 mm | automatique | 26 | 1 | 2,2 | 13 | 338 | 30 | 150 | 270 | 1,8 | 0,017 | 65 | 1 |  |  | 1200 | 500 | mur Temple-Neuf, boîte mystère |
| p90 | FN P90 | pistolet-mitrailleur | 5,7×28 mm | automatique | 22 | 1 | 2 | 15 | 330 | 50 | 200 | 350 | 2,6 | 0,02 | 70 | 2 |  |  | 1800 | 700 | mur Grandes Arcades, boîte mystère |
| lmg | RPK | mitrailleuse | 7,62×39 mm | automatique | 44 | 1 | 2 | 10,5 | 462 | 75 | 300 | 450 | 3,6 | 0,028 | 90 | 1 |  |  | 2500 | 1000 | mur Place Kléber, boîte mystère |
| m249 | M249 SAW | mitrailleuse | 5,56 mm | automatique | 40 | 1 | 2 | 12,5 | 500 | 100 | 300 | 500 | 4,2 | 0,032 | 90 | 1 |  |  | 3000 | 1200 | mur Place Kléber, boîte mystère |
| mg42 | MG42 | mitrailleuse | 7,92×57 mm | automatique | 46 | 1 | 2 | 19 | 874 | 50 | 250 | 450 | 4 | 0,04 | 90 | 1 |  |  | boîte | 1200 | boîte mystère |
| pkm | PKM | mitrailleuse | 7,62×54R | automatique | 55 | 1 | 2 | 10,5 | 577,5 | 100 | 300 | 500 | 4,8 | 0,03 | 100 | 2 |  |  | 3200 | 1300 | mur Place Gutenberg, boîte mystère |
| sniper | L96A1 | fusil de précision | 7,62×51 mm | coup par coup | 340 | 1 | 3,5 | 1,1 | 374 | 5 | 30 | 45 | 2,8 | 0,0015 | 200 | 4 |  |  | 1750 | 700 | mur Rue du Dôme, boîte mystère |
| svd | DRAGUNOV SVD | fusil de précision | 7,62×54R | coup par coup | 230 | 1 | 3 | 3 | 690 | 10 | 40 | 70 | 2,6 | 0,004 | 180 | 3 |  |  | 2000 | 800 | mur Rue du Dôme, boîte mystère |
| barrett | BARRETT M82 | fusil de précision | .50 BMG | coup par coup | 700 | 1 | 3 | 1,6 | 1120 | 10 | 30 | 50 | 3,4 | 0,002 | 220 | 6 |  |  | boîte | 1500 | boîte mystère |
| shotgun | REMINGTON 870 | fusil à pompe | 12 ga | pompe | 26 | 8 | 1,8 | 1,3 | 270,4 | 6 | 30 | 48 | 2,4 | 0,046 | 35 | 1 |  |  | 750 | 350 | mur Marché-Neuf, boîte mystère |
| raygun | PISTOLET À RAYONS | spéciale | énergie | coup par coup | 700 | 1 | 1,5 | 4,2 | 2940 | 20 | 160 | 200 | 2,6 | 0,008 | 100 | 1 | 2,8 | 500 | boîte | 1500 | boîte mystère |

## Pack-a-Punch (5000 pts)

| id | Arme | Nom amélioré | Dégâts | Multiplicateur tête | Chargeur | Réserve max | Zombies traversés | Prix munitions au mur (pts) |
|---|---|---|---|---|---|---|---|---|
| m1911 | COLT M1911 | MUSTANG & SALLY | 120 | 3,12 | 11 | 126 | 2 | 450 |
| arex | AREX ZERO 1 | ZÉRO ABSOLU | 85 | 2,88 | 26 | 204 | 2 | 750 |
| deagle | DESERT EAGLE | L'AIGLE NOIR | 412,5 | 3,6 | 11 | 84 | 4 | 1800 |
| magnum | COLT PYTHON .357 | LE VENGEUR | 475 | 3,6 | 9 | 108 | 4 | 1500 |
| rifle | M4A1 | M4 ÉCLIPSE | 90 | 3 | 45 | 270 | 2 | 900 |
| ak47 | AK-47 | AK-ENFER | 115 | 2,76 | 45 | 315 | 2 | 1800 |
| famas | FAMAS F1 | LE CLAIRON MAUDIT | 85 | 2,88 | 38 | 338 | 2 | 1500 |
| scar | SCAR-H | LE BALAFRÉ | 145 | 2,88 | 30 | 270 | 4 | 2400 |
| smg | MP40 | PM INFERNAL | 60 | 2,64 | 48 | 336 | 2 | 1500 |
| mp5 | MP5 | MP-115 | 65 | 2,64 | 45 | 405 | 2 | 1500 |
| p90 | FN P90 | LE FRELON | 55 | 2,4 | 75 | 525 | 4 | 2100 |
| lmg | RPK | RPK DÉVASTATEUR | 110 | 2,4 | 113 | 675 | 2 | 3000 |
| m249 | M249 SAW | LA FAUCHEUSE | 100 | 2,4 | 150 | 750 | 2 | 3600 |
| mg42 | MG42 | LA SCIE D'HITLER… BRISÉE | 115 | 2,4 | 75 | 675 | 2 | 3600 |
| pkm | PKM | LE BULLDOZER | 137,5 | 2,4 | 150 | 750 | 4 | 3900 |
| sniper | L96A1 | ŒIL DU DÉMON | 850 | 4,2 | 8 | 68 | 6 | 2100 |
| svd | DRAGUNOV SVD | LA TSARINE | 575 | 3,6 | 15 | 105 | 5 | 2400 |
| barrett | BARRETT M82 | LE MARTEAU DE THOR | 1750 | 3,6 | 15 | 75 | 8 | 4500 |
| shotgun | REMINGTON 870 | LE BROYEUR | 65 | 2,16 | 9 | 72 | 2 | 1050 |
| raygun | PISTOLET À RAYONS | PORTE-TONNERRE | 1120 | 1,8 | 30 | 300 | 2 | 4500 |

## Boîte mystère (950 pts, une seule boîte : elle change d'emplacement après 1 à 30 tirages, en donnant un nounours remboursé)

| id | Arme | Poids | Chance (%) |
|---|---|---|---|
| m1911 | COLT M1911 | 2 | 4,65 |
| arex | AREX ZERO 1 | 3 | 6,98 |
| deagle | DESERT EAGLE | 2 | 4,65 |
| magnum | COLT PYTHON .357 | 2 | 4,65 |
| rifle | M4A1 | 2 | 4,65 |
| ak47 | AK-47 | 3 | 6,98 |
| famas | FAMAS F1 | 3 | 6,98 |
| scar | SCAR-H | 2 | 4,65 |
| smg | MP40 | 2 | 4,65 |
| mp5 | MP5 | 3 | 6,98 |
| p90 | FN P90 | 2 | 4,65 |
| lmg | RPK | 2 | 4,65 |
| m249 | M249 SAW | 2 | 4,65 |
| mg42 | MG42 | 2 | 4,65 |
| pkm | PKM | 2 | 4,65 |
| sniper | L96A1 | 2 | 4,65 |
| svd | DRAGUNOV SVD | 2 | 4,65 |
| barrett | BARRETT M82 | 1 | 2,33 |
| shotgun | REMINGTON 870 | 3 | 6,98 |
| raygun | PISTOLET À RAYONS | 1 | 2,33 |

## Atouts

| id | Atout | Lettre | Effet | Prix (pts) | Prix solo (pts) | Zone |
|---|---|---|---|---|---|---|
| juggernog | MASTODONTE | M | Santé max 250 | 2500 | 2500 | Place Kléber |
| speedcola | SPEED COLA | S | Rechargement 2x plus rapide | 3000 | 3000 | Rue des Orfèvres |
| doubletap | DOUBLE TAP | D | Cadence +33 %, dégâts +25 % | 2000 | 2000 | Place Gutenberg |
| quickrevive | RÉANIMATION RAPIDE | R | Solo : se relève seul · Co-op : réanime 2x plus vite | 1500 | 500 | Marché-Neuf |
| mulekick | MULE KICK | K | Porter 3 armes | 4000 | 4000 | Grandes Arcades |
| staminup | STAMIN-UP | E | Course plus rapide | 2000 | 2000 | Temple-Neuf |

## Grenades

| Réglage | Valeur | Unité |
|---|---|---|
| Au départ | 2 | (+2 au début de la manche 1) |
| Maximum | 4 |  |
| Gagnées par manche | 2 |  |
| Retardement | 2,2 | s |
| Rayon | 6,5 | m |
| Dégâts au centre | 900 | PV |
| Dégâts max aux joueurs proches | 60 | PV |
| Chance d'arracher les jambes (zombie survivant) | 50 | % |

## Joueur

| Réglage | Valeur | Unité |
|---|---|---|
| Points au départ | 500 | pts |
| Santé max | 100 | PV (250 avec Mastodonte) |
| Délai avant régénération | 5 | s |
| Régénération | 25 | PV/s |
| Vitesse de marche | 5 | m/s |
| Vitesse de sprint | 8 | m/s |
| Vitesse de saut | 6,5 | m/s |
| Temps à terre avant de mourir (coop) | 45 | s |
| Temps de réanimation | 2,5 | s (1,2 avec Réanimation rapide) |
| Armes portées | 2 | (3 avec Mule Kick) |

## Points

| Action | Points |
|---|---|
| Toucher un zombie | 10 |
| Tuer un zombie | 60 |
| Tuer d'un tir à la tête | 100 |
| Réanimer un coéquipier | 250 |
| Bonus Bombe | 400 |
| Points doubles | x2 |

## Zombies

| Réglage | Valeur | Unité |
|---|---|---|
| Dégâts par coup | 20 | PV |
| Délai entre deux coups | 1 | s |
| Portée d'attaque | 1,3 | m |
| Maximum en vie en même temps | 22 |  |
| Coureurs (à partir de la manche 4) | 25 | % (vitesse x1,5) |
| Rampants (à partir de la manche 4) | 12 | % (vitesse x0,45) |
| Apparition par une fenêtre | 65 | % |
| Réapparition si coincé depuis | 5 | s |
| Réapparition si plus loin que | 90 | m |

## Manches

| Manche | Zombies solo | Zombies 2 joueurs | Zombies 3 joueurs | Zombies 4 joueurs | Santé d'un zombie | Vitesse de base (m/s) | Intervalle d'apparition (s) |
|---|---|---|---|---|---|---|---|
| 1 | 7 | 12 | 18 | 23 | 100 | 1,8 | 1,9 |
| 2 | 10 | 18 | 25 | 33 | 130 | 2 | 1,8 |
| 3 | 13 | 23 | 33 | 42 | 160 | 2,2 | 1,7 |
| 4 | 16 | 28 | 40 | 52 | 190 | 2,4 | 1,6 |
| 5 | 19 | 33 | 48 | 62 | 220 | 2,6 | 1,5 |
| 6 | 22 | 39 | 55 | 72 | 250 | 2,8 | 1,4 |
| 7 | 25 | 44 | 63 | 81 | 280 | 3 | 1,3 |
| 8 | 28 | 49 | 70 | 91 | 310 | 3,2 | 1,2 |
| 9 | 31 | 54 | 78 | 101 | 340 | 3,4 | 1,1 |
| 10 | 34 | 60 | 85 | 111 | 374 | 3,6 | 1 |
| 11 | 37 | 65 | 93 | 120 | 411 | 3,8 | 0,9 |
| 12 | 40 | 70 | 100 | 130 | 453 | 4 | 0,8 |
| 13 | 43 | 75 | 108 | 140 | 498 | 4,2 | 0,7 |
| 14 | 46 | 81 | 115 | 150 | 548 | 4,2 | 0,6 |
| 15 | 49 | 86 | 123 | 159 | 602 | 4,2 | 0,5 |
| 16 | 52 | 91 | 130 | 169 | 663 | 4,2 | 0,4 |
| 17 | 55 | 96 | 138 | 179 | 729 | 4,2 | 0,4 |
| 18 | 58 | 102 | 145 | 189 | 802 | 4,2 | 0,4 |
| 19 | 61 | 107 | 153 | 198 | 882 | 4,2 | 0,4 |
| 20 | 64 | 112 | 160 | 208 | 970 | 4,2 | 0,4 |
| 21 | 67 | 117 | 168 | 218 | 1067 | 4,2 | 0,4 |
| 22 | 70 | 123 | 175 | 228 | 1174 | 4,2 | 0,4 |
| 23 | 73 | 128 | 183 | 237 | 1291 | 4,2 | 0,4 |
| 24 | 76 | 133 | 190 | 247 | 1420 | 4,2 | 0,4 |
| 25 | 79 | 138 | 198 | 257 | 1562 | 4,2 | 0,4 |
| 26 | 82 | 144 | 205 | 267 | 1719 | 4,2 | 0,4 |
| 27 | 85 | 149 | 213 | 276 | 1890 | 4,2 | 0,4 |
| 28 | 88 | 154 | 220 | 286 | 2079 | 4,2 | 0,4 |
| 29 | 91 | 159 | 228 | 296 | 2287 | 4,2 | 0,4 |
| 30 | 94 | 165 | 235 | 306 | 2516 | 4,2 | 0,4 |

## Bonus

| Bonus | Effet | Durée (s) |
|---|---|---|
| Munitions max | Réserves pleines + grenades au maximum |  |
| Mort instantanée | Tout zombie touché meurt | 30 |
| Bombe | Tue tous les zombies, +400 pts |  |
| Points doubles | Points x2 | 30 |
| (règle) Chance de lâcher un bonus | 5 % par zombie tué |  |
| (règle) Durée au sol |  | 25 |

## Zones du secteur

| Zone | Départ | Lieu (x ; z en m) | Portes | Contenu prévu (config) | Bornes | Armes au mur | Machines |
|---|---|---|---|---|---|---|---|
| Marché-Neuf | oui | -1 ; -31 | P4, P6 | station, wall:m1911, wall:shotgun, wall:smg, perk:quickrevive, box | 1 | COLT M1911, REMINGTON 870, MP40 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Temple-Neuf |  | -35 ; -95 | P2, P4, P5, P7 | station, wall:arex, wall:mp5, perk:staminup, box | 1 | AREX ZERO 1, MP5 | STAMIN-UP, BOÎTE MYSTÈRE |
| Rue des Orfèvres |  | 27 ; -58 | P5, P6, P9, P10 | wall:famas, perk:speedcola, box | 0 | FAMAS F1 | SPEED COLA, BOÎTE MYSTÈRE |
| Rue du Dôme |  | 104 ; -118 | P7, P10 | station, wall:sniper, wall:svd, box | 1 | L96A1, DRAGUNOV SVD | BOÎTE MYSTÈRE |
| Grandes Arcades |  | -110 ; -45 | P1, P2, P3 | station, wall:ak47, wall:p90, perk:mulekick, box | 1 | AK-47, FN P90 | MULE KICK, BOÎTE MYSTÈRE |
| Place Kléber |  | -199 ; -145 | P1 | station, perk:juggernog, wall:lmg, wall:m249, box | 1 | RPK, M249 SAW | MASTODONTE, BOÎTE MYSTÈRE |
| Place Gutenberg |  | -20 ; 90 | P3, P8 | station, perk:doubletap, wall:scar, wall:pkm, box | 1 | SCAR-H, PKM | DOUBLE TAP, BOÎTE MYSTÈRE |
| Cathédrale |  | 103 ; 33 | P8, P9, P11 | station, wall:deagle, wall:rifle, box | 1 | DESERT EAGLE, M4A1 | BOÎTE MYSTÈRE |
| Intérieur de la Cathédrale |  | 179 ; 40 | P11 | pap, clock, station, box | 1 |  | PACK-A-PUNCH, HORLOGE ASTRONOMIQUE, BOÎTE MYSTÈRE |

## Portes

| Porte | Prix (pts) | Zone A | Zone B |
|---|---|---|---|
| P1 | 1250 | Grandes Arcades | Place Kléber |
| P2 | 1000 | Temple-Neuf | Grandes Arcades |
| P3 | 1250 | Grandes Arcades | Place Gutenberg |
| P4 | 750 | Marché-Neuf | Temple-Neuf |
| P5 | 750 | Temple-Neuf | Rue des Orfèvres |
| P6 | 750 | Marché-Neuf | Rue des Orfèvres |
| P7 | 1000 | Temple-Neuf | Rue du Dôme |
| P8 | 1250 | Place Gutenberg | Cathédrale |
| P9 | 1000 | Rue des Orfèvres | Cathédrale |
| P10 | 1000 | Rue des Orfèvres | Rue du Dôme |
| P11 | 5000 | Cathédrale | Intérieur de la Cathédrale |

## Emplacements

| N° sur la carte | Type | Nom | Zone | Prix (pts) | x (m, vers l'est) | z (m, vers le sud) |
|---|---|---|---|---|---|---|
| 1 | Borne de munitions | Borne de munitions | Marché-Neuf |  | -10 | -35 |
| 2 | Arme au mur | COLT M1911 | Marché-Neuf | 400 | -20 | -32 |
| 3 | Arme au mur | REMINGTON 870 | Marché-Neuf | 750 | -11 | -18 |
| 4 | Arme au mur | MP40 | Marché-Neuf | 1000 | -4 | -45 |
| 5 | Atout | RÉANIMATION RAPIDE | Marché-Neuf | 1500 | 1 | -59 |
| 6 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Marché-Neuf | 950 | -17 | -37 |
| 7 | Borne de munitions | Borne de munitions | Temple-Neuf |  | -41 | -92 |
| 8 | Arme au mur | AREX ZERO 1 | Temple-Neuf | 700 | -38 | -80 |
| 9 | Arme au mur | MP5 | Temple-Neuf | 1200 | -29 | -100 |
| 10 | Atout | STAMIN-UP | Temple-Neuf | 2000 | -34 | -107 |
| 11 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Temple-Neuf | 950 | -46 | -110 |
| 12 | Arme au mur | FAMAS F1 | Rue des Orfèvres | 1300 | 14 | -74 |
| 13 | Atout | SPEED COLA | Rue des Orfèvres | 3000 | 52 | -2 |
| 14 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue des Orfèvres | 950 | 19 | -69 |
| 15 | Borne de munitions | Borne de munitions | Rue du Dôme |  | 108 | -142 |
| 16 | Arme au mur | L96A1 | Rue du Dôme | 1750 | 73 | -126 |
| 17 | Arme au mur | DRAGUNOV SVD | Rue du Dôme | 2000 | 84 | -130 |
| 18 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue du Dôme | 950 | 88 | -117 |
| 19 | Borne de munitions | Borne de munitions | Grandes Arcades |  | -94 | -44 |
| 20 | Arme au mur | AK-47 | Grandes Arcades | 1600 | -105 | -30 |
| 21 | Arme au mur | FN P90 | Grandes Arcades | 1800 | -104 | -65 |
| 22 | Atout | MULE KICK | Grandes Arcades | 4000 | -108 | -58 |
| 23 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grandes Arcades | 950 | -88 | -43 |
| 24 | Borne de munitions | Borne de munitions | Place Kléber |  | -173 | -134 |
| 25 | Arme au mur | RPK | Place Kléber | 2500 | -207 | -156 |
| 26 | Arme au mur | M249 SAW | Place Kléber | 3000 | -195 | -139 |
| 27 | Atout | MASTODONTE | Place Kléber | 2500 | -169 | -149 |
| 28 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Kléber | 950 | -202 | -116 |
| 29 | Borne de munitions | Borne de munitions | Place Gutenberg |  | -2 | 114 |
| 30 | Arme au mur | SCAR-H | Place Gutenberg | 2200 | -48 | 84 |
| 31 | Arme au mur | PKM | Place Gutenberg | 3200 | 4 | 77 |
| 32 | Atout | DOUBLE TAP | Place Gutenberg | 2000 | -24 | 94 |
| 33 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Gutenberg | 950 | -10 | 110 |
| 34 | Borne de munitions | Borne de munitions | Cathédrale |  | 112 | 48 |
| 35 | Arme au mur | DESERT EAGLE | Cathédrale | 1500 | 109 | 53 |
| 36 | Arme au mur | M4A1 | Cathédrale | 1200 | 121 | 35 |
| 37 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Cathédrale | 950 | 119 | 55 |
| 38 | Borne de munitions | Borne de munitions | Intérieur de la Cathédrale |  | 205 | 29 |
| 39 | PACK-A-PUNCH | PACK-A-PUNCH | Intérieur de la Cathédrale | 5000 | 223 | 14 |
| 40 | HORLOGE ASTRONOMIQUE | HORLOGE ASTRONOMIQUE | Intérieur de la Cathédrale | 0 | 228 | 35 |
| 41 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Intérieur de la Cathédrale | 950 | 185 | 10 |

## Commandes

| Touche | Action |
|---|---|
| ZQSD / WASD | Se déplacer |
| Souris | Viser |
| Clic gauche | Tirer |
| Clic droit | Viser à la mire |
| Shift | Sprint |
| Espace | Sauter |
| R | Recharger |
| 1 / 2 / 3 / molette | Changer d'arme |
| G | Grenade |
| E | Acheter, ouvrir une porte, utiliser une machine, réanimer (maintenir), monter / descendre d'une moto |
| ZQSD / WASD (en moto) | Accélérer, freiner / reculer, tourner |
| Espace (en moto) | Frein à main |
| F | Lampe torche |
| M | Carte |
| Échap | Menu pause |

### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : dégâts ×2,5 (×1,6 pour le pistolet à rayons), chargeur et réserve ×1,5, tête ×1,2, +2 zombies traversés.
- **Atouts** : on les perd tous quand on tombe à terre.
