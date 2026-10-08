# Zombie Survival — fiche de référence

Version du jeu : **v0.35.1 · 2d194f7 · 2026-10-08** (package 0.35.1). Générée automatiquement par `node tools/make-docs.mjs` à partir de `src/config.js` et du jeu.
Carte annotée : [carte.png](carte.png). Armes de profil : [armes.png](armes.png). Les mêmes tableaux en tableur : dossier [csv/](csv/).

Pour demander une modification, citez la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts », « mettre la boîte mystère dans la zone Temple-Neuf »).

## Grande Île

Toute la Grande Île de Strasbourg est jouable : on commence place du Marché-Neuf et on ouvre les zones l'une après l'autre en payant les portes.
Elle est découpée en 27 zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à 95 m pour les 10 zones d'origine, sans limite pour les 17 zones extérieures), et les portes se trouvent entre deux zones voisines (une porte ouvre toute la limite entre les deux zones).
Prix d'une porte : le plus cher des deux prix de zone (colonne « Prix de la porte ») ; zones extérieures : palier A 1500, B 2000, C 2500 pts. Le contenu de chaque zone se règle dans `src/config.js` → `sector.zones[].items`.
À la première ouverture d'une zone extérieure, un bonus apparaît. La boîte mystère ne se déplace que dans une zone déjà ouverte. « Grand'Rue » et « Quai Schoepflin » sont des noms déduits du plan (à confirmer).

## Armes

| id | Arme | Catégorie | Calibre | Type | Dégâts par balle | Plombs par tir | Multiplicateur tête | Cadence (tirs/s) | DPS approx. | Chargeur | Réserve départ | Réserve max | Rechargement (s) | Dispersion | Portée (m) | Zombies traversés | Explosion rayon (m) | Explosion dégâts | Prix au mur (pts) | Prix munitions (pts) | Où l'obtenir |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| m1911 | COLT M1911 | pistolet | .45 ACP | coup par coup | 50 | 1 | 2,6 | 5,5 | 275 | 7 | 42 | 84 | 1,5 | 0,01 | 50 | 1 |  |  | 400 | 150 | mur Marché-Neuf, boîte mystère, arme de départ |
| arex | AREX ZERO 1 | pistolet | 9 mm | coup par coup | 29 | 1 | 2,2 | 7,5 | 217,5 | 17 | 68 | 136 | 1,4 | 0,009 | 55 | 1 |  |  | 700 | 250 | mur Temple-Neuf, mur Musée historique, boîte mystère |
| deagle | DESERT EAGLE | pistolet | .50 AE | coup par coup | 160 | 1 | 3 | 2,4 | 384 | 7 | 35 | 56 | 1,9 | 0,011 | 70 | 2 |  |  | 1500 | 600 | mur Cathédrale, mur Saint-Pierre-le-Vieux, boîte mystère |
| magnum | COLT PYTHON .357 | pistolet | .357 Magnum | coup par coup | 143 | 1 | 3 | 3,2 | 457,6 | 6 | 48 | 72 | 2,2 | 0,006 | 80 | 2 |  |  | 2000 | 500 | mur Saint-Pierre-le-Jeune, boîte mystère |
| rifle | M4A1 | fusil d'assaut | 5,56 mm | automatique | 36 | 1 | 2,4 | 12,5 | 450 | 30 | 120 | 180 | 1,8 | 0,012 | 90 | 1 |  |  | 1200 | 300 | mur Cathédrale, boîte mystère, arme de départ |
| ak47 | AK-47 | fusil d'assaut | 7,62×39 mm | automatique | 54 | 1 | 2,3 | 10 | 540 | 30 | 120 | 210 | 2,4 | 0,017 | 90 | 1 |  |  | 1600 | 600 | mur Grandes Arcades, mur Palais Rohan, boîte mystère |
| famas | FAMAS F1 | fusil d'assaut | 5,56 mm | automatique | 40 | 1 | 2,4 | 15 | 600 | 25 | 125 | 225 | 2,2 | 0,014 | 85 | 1 |  |  | 1300 | 500 | mur Rue des Orfèvres, mur Hôtel de Neuwiller, boîte mystère |
| scar | SCAR-H | fusil d'assaut | 7,62×51 mm | automatique | 78 | 1 | 2,5 | 10 | 780 | 20 | 100 | 180 | 2,3 | 0,018 | 100 | 2 |  |  | 2500 | 800 | mur Place Gutenberg, mur Monument Stoeber, boîte mystère |
| smg | MP40 | pistolet-mitrailleur | 9 mm | automatique | 30 | 1 | 2,2 | 8,3 | 249 | 32 | 128 | 224 | 1,5 | 0,022 | 65 | 1 |  |  | 800 | 500 | mur Marché-Neuf, mur Église Réformée, boîte mystère |
| mp5 | MP5 | pistolet-mitrailleur | 9 mm | automatique | 26 | 1 | 2,2 | 13 | 338 | 30 | 150 | 270 | 1,8 | 0,017 | 65 | 1 |  |  | 1200 | 500 | mur Temple-Neuf, mur Grand'Rue, boîte mystère |
| p90 | FN P90 | pistolet-mitrailleur | 5,7×28 mm | automatique | 22 | 1 | 2 | 15 | 330 | 50 | 200 | 350 | 2,6 | 0,02 | 70 | 2 |  |  | 1800 | 700 | mur Grandes Arcades, boîte mystère |
| lmg | RPK | mitrailleuse | 7,62×39 mm | automatique | 51 | 1 | 2 | 10 | 510 | 75 | 300 | 450 | 3,6 | 0,028 | 90 | 1 |  |  | 2500 | 1000 | mur Place Kléber, mur Place Broglie, boîte mystère |
| m249 | M249 SAW | mitrailleuse | 5,56 mm | automatique | 40 | 1 | 2 | 12,5 | 500 | 100 | 300 | 500 | 4,2 | 0,032 | 90 | 1 |  |  | 3000 | 1200 | mur Place Kléber, mur Saint-Étienne, boîte mystère |
| mg42 | MG42 | mitrailleuse | 7,92×57 mm | automatique | 64 | 1 | 2 | 20 | 1280 | 50 | 250 | 450 | 5 | 0,04 | 90 | 2 |  |  | 4000 | 1200 | mur Opéra, boîte mystère |
| pkm | PKM | mitrailleuse | 7,62×54R | automatique | 64 | 1 | 2 | 10,5 | 672 | 100 | 300 | 500 | 4,8 | 0,03 | 100 | 2 |  |  | 3200 | 1300 | mur Place Gutenberg, mur Préfecture, boîte mystère |
| sniper | L96A1 | fusil de précision | 7,62×51 mm Match | coup par coup | 340 | 1 | 3,5 | 1,1 | 374 | 5 | 30 | 45 | 2,8 | 0,0015 | 200 | 4 |  |  | 1750 | 700 | mur Rue du Dôme, mur Ancienne Douane, boîte mystère |
| svd | DRAGUNOV SVD | fusil de précision | 7,62×54R 7N1 | coup par coup | 230 | 1 | 3 | 3 | 690 | 10 | 40 | 70 | 2,6 | 0,004 | 180 | 3 |  |  | 2000 | 800 | mur Rue du Dôme, mur Quai Schoepflin, boîte mystère |
| barrett | BARRETT M82 | fusil de précision | .50 BMG | coup par coup | 700 | 1 | 3 | 1,2 | 840 | 10 | 30 | 50 | 3,4 | 0,002 | 220 | 6 |  |  | 5000 | 1500 | mur Petite France, boîte mystère |
| shotgun | REMINGTON 870 | fusil à pompe | 12 ga | pompe | 30 | 8 | 1,8 | 1,3 | 312 | 6 | 30 | 48 | 2,4 | 0,046 | 35 | 1 |  |  | 750 | 350 | mur Marché-Neuf, mur Grand Séminaire, boîte mystère |
| saiga | SAIGA-12 | fusil à pompe | 12 ga | coup par coup | 27 | 8 | 1,8 | 3,5 | 756 | 8 | 32 | 64 | 2,6 | 0,05 | 35 | 1 |  |  | 3000 | 700 | mur Saint-Thomas, boîte mystère |
| crossbow | ARBALÈTE | spéciale | carreau 20″ | coup par coup | 420 | 1 | 3 | 1 | 420 | 1 | 20 | 40 | 1,7 | 0,003 | 80 | 6 |  |  | 2000 | 700 | mur Homme de Fer, boîte mystère |
| m79 | M79 | spéciale | 40×46 mm | launcher | 150 | 1 | 1 | 1 | 150 | 1 | 11 | 24 | 2,2 | 0,004 | 150 | 1 |  |  | 2500 | 1500 | mur Homme de Fer, boîte mystère |
| raygun | PISTOLET À RAYONS | spéciale | énergie | coup par coup | 1000 | 1 | 1,5 | 4,2 | 4200 | 24 | 168 | 240 | 2,6 | 0,008 | 100 | 1 | 3,5 | 900 | boîte | 1500 | boîte mystère |

## Pack-a-Punch (3 niveaux : I 5000 pts, II 10000 pts, III 20000 pts)

| id | Arme | Niveau | Nom amélioré | Prix du niveau (pts) | Dégâts | Multiplicateur tête | Chargeur | Réserve max | Zombies traversés | Rechargement (s) | Dispersion | Prix munitions au mur (pts) | Particularités |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| m1911 | COLT M1911 | I | MUSTANG & SALLY | 5000 | 125 | 3,12 | 11 | 126 | 2 | 1,5 | 0,01 | 450 |  |
| m1911 | COLT M1911 | II | MUSTANG & SALLY II | 10000 | 175 | 3,38 | 14 | 168 | 3 | 1,27 | 0,0085 | 600 |  |
| m1911 | COLT M1911 | III | MUSTANG & SALLY III | 20000 | 250 | 3,64 | 14 | 210 | 4 | 1,13 | 0,007 | 750 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| arex | AREX ZERO 1 | I | ZÉRO ABSOLU | 5000 | 72,5 | 2,64 | 26 | 204 | 2 | 1,4 | 0,009 | 750 |  |
| arex | AREX ZERO 1 | II | ZÉRO ABSOLU II | 10000 | 101,5 | 2,86 | 34 | 272 | 3 | 1,19 | 0,0076 | 1000 |  |
| arex | AREX ZERO 1 | III | ZÉRO ABSOLU III | 20000 | 145 | 3,08 | 34 | 340 | 4 | 1,05 | 0,0063 | 1250 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| deagle | DESERT EAGLE | I | L'AIGLE NOIR | 5000 | 400 | 3,6 | 11 | 84 | 4 | 1,9 | 0,011 | 1800 |  |
| deagle | DESERT EAGLE | II | L'AIGLE NOIR II | 10000 | 560 | 3,9 | 14 | 112 | 5 | 1,61 | 0,0093 | 2400 |  |
| deagle | DESERT EAGLE | III | L'AIGLE NOIR III | 20000 | 800 | 4,2 | 14 | 140 | 6 | 1,42 | 0,0077 | 3000 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| magnum | COLT PYTHON .357 | I | LE VENGEUR | 5000 | 357,5 | 3,6 | 9 | 108 | 4 | 2,2 | 0,006 | 1500 |  |
| magnum | COLT PYTHON .357 | II | LE VENGEUR II | 10000 | 500,5 | 3,9 | 12 | 144 | 5 | 1,87 | 0,0051 | 2000 |  |
| magnum | COLT PYTHON .357 | III | LE VENGEUR III | 20000 | 715 | 4,2 | 12 | 180 | 6 | 1,65 | 0,0042 | 2500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| rifle | M4A1 | I | M4 ÉCLIPSE | 5000 | 90 | 2,88 | 45 | 270 | 2 | 1,8 | 0,012 | 900 |  |
| rifle | M4A1 | II | M4 ÉCLIPSE II | 10000 | 126 | 3,12 | 60 | 360 | 3 | 1,53 | 0,0102 | 1200 |  |
| rifle | M4A1 | III | M4 ÉCLIPSE III | 20000 | 180 | 3,36 | 60 | 450 | 4 | 1,35 | 0,0084 | 1500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts ; lance-grenades sous canon : 3 obus 40 mm (clic molette) |
| ak47 | AK-47 | I | AK-ENFER | 5000 | 135 | 2,76 | 45 | 315 | 2 | 2,4 | 0,017 | 1800 |  |
| ak47 | AK-47 | II | AK-ENFER II | 10000 | 189 | 2,99 | 75 | 420 | 3 | 2,04 | 0,0145 | 2400 |  |
| ak47 | AK-47 | III | AK-ENFER III | 20000 | 270 | 3,22 | 75 | 525 | 4 | 1,8 | 0,0119 | 3000 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts ; lance-grenades sous canon : 3 obus 40 mm (clic molette) |
| famas | FAMAS F1 | I | LE CLAIRON MAUDIT | 5000 | 100 | 2,88 | 38 | 338 | 2 | 2,2 | 0,014 | 1500 |  |
| famas | FAMAS F1 | II | LE CLAIRON MAUDIT II | 10000 | 140 | 3,12 | 50 | 450 | 3 | 1,87 | 0,0119 | 2000 |  |
| famas | FAMAS F1 | III | LE CLAIRON MAUDIT III | 20000 | 200 | 3,36 | 50 | 563 | 4 | 1,65 | 0,0098 | 2500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts ; lance-grenades sous canon : 3 obus 40 mm (clic molette) |
| scar | SCAR-H | I | LE BALAFRÉ | 5000 | 195 | 3 | 30 | 270 | 4 | 2,3 | 0,018 | 2400 |  |
| scar | SCAR-H | II | LE BALAFRÉ II | 10000 | 273 | 3,25 | 40 | 360 | 5 | 1,95 | 0,0153 | 3200 |  |
| scar | SCAR-H | III | LE BALAFRÉ III | 20000 | 390 | 3,5 | 40 | 450 | 6 | 1,72 | 0,0126 | 4000 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts ; lance-grenades sous canon : 3 obus 40 mm (clic molette) |
| smg | MP40 | I | PM INFERNAL | 5000 | 75 | 2,64 | 48 | 336 | 2 | 1,5 | 0,022 | 1500 |  |
| smg | MP40 | II | PM INFERNAL II | 10000 | 105 | 2,86 | 64 | 448 | 3 | 1,27 | 0,0187 | 2000 |  |
| smg | MP40 | III | PM INFERNAL III | 20000 | 150 | 3,08 | 64 | 560 | 4 | 1,13 | 0,0154 | 2500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| mp5 | MP5 | I | MP-115 | 5000 | 65 | 2,64 | 45 | 405 | 2 | 1,8 | 0,017 | 1500 |  |
| mp5 | MP5 | II | MP-115 II | 10000 | 91 | 2,86 | 60 | 540 | 3 | 1,53 | 0,0145 | 2000 |  |
| mp5 | MP5 | III | MP-115 III | 20000 | 130 | 3,08 | 60 | 675 | 4 | 1,35 | 0,0119 | 2500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| p90 | FN P90 | I | LE FRELON | 5000 | 55 | 2,4 | 75 | 525 | 4 | 2,6 | 0,02 | 2100 |  |
| p90 | FN P90 | II | LE FRELON II | 10000 | 77 | 2,6 | 100 | 700 | 5 | 2,21 | 0,017 | 2800 |  |
| p90 | FN P90 | III | LE FRELON III | 20000 | 110 | 2,8 | 100 | 875 | 6 | 1,95 | 0,014 | 3500 | Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| lmg | RPK | I | RPK DÉVASTATEUR | 5000 | 127,5 | 2,4 | 113 | 675 | 2 | 3,6 | 0,028 | 3000 | viseur ACOG (zoom 45°) |
| lmg | RPK | II | RPK DÉVASTATEUR II | 10000 | 178,5 | 2,6 | 150 | 900 | 3 | 3,06 | 0,0238 | 4000 | viseur ACOG (zoom 45°) |
| lmg | RPK | III | RPK DÉVASTATEUR III | 20000 | 255 | 2,8 | 150 | 1125 | 4 | 2,7 | 0,0196 | 5000 | viseur ACOG (zoom 45°) ; canon lourd : cadence x1,15 ; Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| m249 | M249 SAW | I | LA FAUCHEUSE | 5000 | 100 | 2,4 | 150 | 750 | 2 | 4,2 | 0,032 | 3600 | viseur ACOG (zoom 45°) |
| m249 | M249 SAW | II | LA FAUCHEUSE II | 10000 | 140 | 2,6 | 200 | 1000 | 3 | 3,57 | 0,0272 | 4800 | viseur ACOG (zoom 45°) |
| m249 | M249 SAW | III | LA FAUCHEUSE III | 20000 | 200 | 2,8 | 200 | 1250 | 4 | 3,15 | 0,0224 | 6000 | viseur ACOG (zoom 45°) ; canon lourd : cadence x1,15 ; Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| mg42 | MG42 | I | LA SCIE D'HITLER… BRISÉE | 5000 | 160 | 2,4 | 75 | 675 | 4 | 5 | 0,04 | 3600 | viseur ACOG (zoom 45°) |
| mg42 | MG42 | II | LA SCIE D'HITLER… BRISÉE II | 10000 | 224 | 2,6 | 100 | 900 | 5 | 4,25 | 0,034 | 4800 | viseur ACOG (zoom 45°) |
| mg42 | MG42 | III | LA SCIE D'HITLER… BRISÉE III | 20000 | 320 | 2,8 | 100 | 1125 | 6 | 3,75 | 0,028 | 6000 | viseur ACOG (zoom 45°) ; canon lourd : cadence x1,15 ; Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| pkm | PKM | I | LE BULLDOZER | 5000 | 160 | 2,4 | 150 | 750 | 4 | 4,8 | 0,03 | 3900 | viseur ACOG (zoom 45°) |
| pkm | PKM | II | LE BULLDOZER II | 10000 | 224 | 2,6 | 200 | 1000 | 5 | 4,08 | 0,0255 | 5200 | viseur ACOG (zoom 45°) |
| pkm | PKM | III | LE BULLDOZER III | 20000 | 320 | 2,8 | 200 | 1250 | 6 | 3,6 | 0,021 | 6500 | viseur ACOG (zoom 45°) ; canon lourd : cadence x1,15 ; Éther : 20 % des touches, explosion 2 m à 50 % des dégâts |
| sniper | L96A1 | I | ŒIL DU DÉMON | 5000 | 850 | 4,2 | 8 | 68 | 6 | 2,8 | 0,0015 | 2100 |  |
| sniper | L96A1 | II | ŒIL DU DÉMON II | 10000 | 1190 | 4,55 | 10 | 90 | 7 | 2,38 | 0,0013 | 2800 |  |
| sniper | L96A1 | III | ŒIL DU DÉMON III | 20000 | 1700 | 4,9 | 10 | 113 | 8 | 2,1 | 0,001 | 3500 | balles explosives : explosion 2 m à 40 % des dégâts |
| svd | DRAGUNOV SVD | I | LA TSARINE | 5000 | 575 | 3,6 | 15 | 105 | 5 | 2,6 | 0,004 | 2400 |  |
| svd | DRAGUNOV SVD | II | LA TSARINE II | 10000 | 805 | 3,9 | 20 | 140 | 6 | 2,21 | 0,0034 | 3200 |  |
| svd | DRAGUNOV SVD | III | LA TSARINE III | 20000 | 1150 | 4,2 | 20 | 175 | 7 | 1,95 | 0,0028 | 4000 | balles explosives : explosion 2 m à 40 % des dégâts |
| barrett | BARRETT M82 | I | LE MARTEAU DE THOR | 5000 | 1750 | 3,6 | 15 | 75 | 8 | 3,4 | 0,002 | 4500 |  |
| barrett | BARRETT M82 | II | LE MARTEAU DE THOR II | 10000 | 2450 | 3,9 | 20 | 100 | 9 | 2,89 | 0,0017 | 6000 |  |
| barrett | BARRETT M82 | III | LE MARTEAU DE THOR III | 20000 | 3500 | 4,2 | 20 | 125 | 10 | 2,55 | 0,0014 | 7500 | balles explosives : explosion 2 m à 40 % des dégâts |
| shotgun | REMINGTON 870 | I | LE BROYEUR | 5000 | 75 | 2,16 | 9 | 72 | 2 | 2,4 | 0,0368 | 1050 | choke (dispersion x0,8) |
| shotgun | REMINGTON 870 | II | LE BROYEUR II | 10000 | 105 | 2,34 | 12 | 96 | 3 | 2,04 | 0,0313 | 1400 | choke (dispersion x0,8) |
| shotgun | REMINGTON 870 | III | LE BROYEUR III | 20000 | 150 | 2,52 | 12 | 120 | 4 | 1,8 | 0,0258 | 1750 | choke (dispersion x0,8) ; souffle du dragon : 12 plombs |
| saiga | SAIGA-12 | I | LE HACHOIR | 5000 | 67,5 | 2,16 | 12 | 96 | 2 | 2,6 | 0,04 | 2100 | choke (dispersion x0,8) |
| saiga | SAIGA-12 | II | LE HACHOIR II | 10000 | 94,5 | 2,34 | 20 | 128 | 3 | 2,21 | 0,034 | 2800 | choke (dispersion x0,8) |
| saiga | SAIGA-12 | III | LE HACHOIR III | 20000 | 135 | 2,52 | 20 | 160 | 4 | 1,95 | 0,028 | 3500 | choke (dispersion x0,8) ; souffle du dragon : 12 plombs |
| crossbow | ARBALÈTE | I | LE CARREAU DE FER | 5000 | 1050 | 3,6 | 2 | 60 | 8 | 1,7 | 0,003 | 2100 | carreau explosif : rayon 2,5 m, 700 dégâts |
| crossbow | ARBALÈTE | II | LE CARREAU DE FER II | 10000 | 1470 | 3,9 | 3 | 80 | 9 | 1,44 | 0,0026 | 2800 | carreau explosif : rayon 2,5 m, 700 dégâts |
| crossbow | ARBALÈTE | III | LE CARREAU DE FER III | 20000 | 2100 | 4,2 | 3 | 100 | 10 | 1,27 | 0,0021 | 3500 | carreau à fragmentation : rayon 3,5 m, 1050 dégâts |
| m79 | M79 | I | LE BOUTEFEU | 5000 | 375 | 1,2 | 2 | 36 | 2 | 2,2 | 0,004 | 4500 | explosion rayon 6,5 m, 2400 dégâts |
| m79 | M79 | II | LE BOUTEFEU II | 10000 | 525 | 1,3 | 3 | 48 | 3 | 1,87 | 0,0034 | 6000 | explosion rayon 7,25 m, 3600 dégâts |
| m79 | M79 | III | LE BOUTEFEU III | 20000 | 750 | 1,4 | 3 | 60 | 4 | 1,65 | 0,0028 | 7500 | explosion rayon 8 m, 5400 dégâts |
| raygun | PISTOLET À RAYONS | I | PORTE-TONNERRE | 5000 | 1600 | 1,8 | 36 | 360 | 2 | 2,6 | 0,008 | 4500 | explosion à l'impact rayon 4,55 m, 1800 dégâts |
| raygun | PISTOLET À RAYONS | II | PORTE-TONNERRE II | 10000 | 2200 | 1,95 | 48 | 480 | 3 | 2,21 | 0,0068 | 6000 | explosion à l'impact rayon 4,55 m, 2520 dégâts |
| raygun | PISTOLET À RAYONS | III | PORTE-TONNERRE III | 20000 | 3000 | 2,1 | 48 | 600 | 6 | 1,95 | 0,0056 | 7500 | explosion à l'impact rayon 4,55 m, 3600 dégâts |

## Boîte mystère (950 pts, une seule boîte : elle change d'emplacement après 1 à 30 tirages, en donnant un nounours remboursé)

| id | Arme | Poids | Chance (%) |
|---|---|---|---|
| m1911 | COLT M1911 | 2 | 4,08 |
| arex | AREX ZERO 1 | 3 | 6,12 |
| deagle | DESERT EAGLE | 2 | 4,08 |
| magnum | COLT PYTHON .357 | 2 | 4,08 |
| rifle | M4A1 | 2 | 4,08 |
| ak47 | AK-47 | 3 | 6,12 |
| famas | FAMAS F1 | 3 | 6,12 |
| scar | SCAR-H | 2 | 4,08 |
| smg | MP40 | 2 | 4,08 |
| mp5 | MP5 | 3 | 6,12 |
| p90 | FN P90 | 2 | 4,08 |
| lmg | RPK | 2 | 4,08 |
| m249 | M249 SAW | 2 | 4,08 |
| mg42 | MG42 | 2 | 4,08 |
| pkm | PKM | 2 | 4,08 |
| sniper | L96A1 | 2 | 4,08 |
| svd | DRAGUNOV SVD | 2 | 4,08 |
| barrett | BARRETT M82 | 1 | 2,04 |
| shotgun | REMINGTON 870 | 3 | 6,12 |
| raygun | PISTOLET À RAYONS | 1 | 2,04 |
| saiga | SAIGA-12 | 3 | 6,12 |
| crossbow | ARBALÈTE | 2 | 4,08 |
| m79 | M79 | 1 | 2,04 |

## Atouts

| id | Atout | Lettre | Effet | Prix (pts) | Prix solo (pts) | Zone |
|---|---|---|---|---|---|---|
| juggernog | MASTODONTE | M | Santé max 250 | 2500 | 2500 | Place Kléber |
| speedcola | SPEED COLA | S | Rechargement 2x plus rapide | 3000 | 3000 | Rue des Orfèvres |
| doubletap | DOUBLE TAP | D | Cadence +33 %, dégâts +25 % | 2000 | 2000 | Place Gutenberg |
| quickrevive | RÉANIMATION RAPIDE | R | Solo : se relève seul · Co-op : réanime 2x plus vite | 1500 | 500 | Marché-Neuf |
| mulekick | MULE KICK | K | Porter 3 armes | 4000 | 4000 | Grandes Arcades |
| staminup | STAMIN-UP | E | Course plus rapide | 2000 | 2000 | Temple-Neuf |
| phdflopper | PHD FLOPPER | P | Immunisé aux explosions et aux chocs · saut en sprint : onde explosive | 2000 | 2000 | Homme de Fer |

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
| Chevaliers de fer (zone Homme de Fer, à partir de la manche 8) | 15 | % (3 en vie au plus, santé x1,5, armure) |
| Pestiférés (zones Petite France, Saint-Pierre-le-Vieux, à partir de la manche 10) | 12 | % (3 en vie au plus, santé x1,6, explosent à leur mort : 38 PV au plus à moins de 4,2 m, le PHD Flopper les ignore) |
| Poursuite : champ de chemin calculé jusqu'à | 160 | m de marche autour des joueurs (au-delà : tout droit) |
| Coop : joueur ciblé par l'apparition | poids 1 / (1 + n), n = zombies à moins de 45 m |  |
| Coop : un client dessine les zombies à moins de | 170 | m |

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
| Bidon d'essence | +2,5 L pour une moto (rare : seulement si une moto est à moitié vide, voir Motos) |  |
| (règle) Chance de lâcher un bonus | 5 % par zombie tué |  |
| (règle) Bonus d'ouverture | Munitions max ou Points doubles à la première ouverture d'une zone extérieure |  |
| (règle) Durée au sol |  | 25 |

## Zones de la Grande Île

| Zone | Départ | Type | Surface (m²) | Prix de la porte (pts) | Lieu (x ; z en m) | Portes | Contenu prévu (config) | Bornes | Armes au mur | Machines |
|---|---|---|---|---|---|---|---|---|---|---|
| Marché-Neuf | oui | secteur d'origine | 2287 | 0 | -1 ; -31 | P29, P32 | station, wall:m1911, wall:shotgun, wall:smg, perk:quickrevive, box | 1 | COLT M1911, REMINGTON 870, MP40 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Temple-Neuf |  | secteur d'origine | 4241 | 750 | -35 ; -95 | P24, P25, P27, P29, P31, P33 | station, wall:arex, wall:mp5, perk:staminup, box | 1 | AREX ZERO 1, MP5 | STAMIN-UP, BOÎTE MYSTÈRE |
| Rue des Orfèvres |  | secteur d'origine | 698 | 750 | 27 ; -58 | P31, P32, P36, P39 | wall:famas, perk:speedcola, box | 0 | FAMAS F1 | SPEED COLA, BOÎTE MYSTÈRE |
| Rue du Dôme |  | secteur d'origine | 4694 | 1000 | 104 ; -118 | P33, P39, P40, P43, P48 | station, wall:sniper, wall:svd, box | 1 | L96A1, DRAGUNOV SVD | BOÎTE MYSTÈRE |
| Grandes Arcades |  | secteur d'origine | 5206 | 1000 | -110 ; -45 | P17, P20, P24, P26 | station, wall:ak47, wall:p90, perk:mulekick, box | 1 | AK-47, FN P90 | MULE KICK, BOÎTE MYSTÈRE |
| Place Kléber |  | secteur d'origine | 11757 | 1250 | -199 ; -145 | P14, P15, P19, P20, P25 | station, perk:juggernog, wall:lmg, wall:m249, box | 1 | RPK, M249 SAW | MASTODONTE, BOÎTE MYSTÈRE |
| Place Gutenberg |  | secteur d'origine | 8624 | 1250 | -20 ; 90 | P22, P23, P26, P28, P34, P37 | station, perk:doubletap, wall:scar, wall:pkm, box | 1 | SCAR-H, PKM | DOUBLE TAP, BOÎTE MYSTÈRE |
| Cathédrale |  | secteur d'origine | 6688 | 1000 | 103 ; 33 | P34, P36, P41, P43, P45, P46, P47 | station, wall:deagle, wall:rifle, box | 1 | DESERT EAGLE, M4A1 | BOÎTE MYSTÈRE |
| Intérieur de la Cathédrale |  | secteur d'origine | 3593 | 5000 | 179 ; 40 | P45 | pap, clock, station, box | 1 |  | PACK-A-PUNCH, HORLOGE ASTRONOMIQUE, BOÎTE MYSTÈRE |
| Homme de Fer |  | secteur d'origine | 10073 | 1500 | -290 ; -203 | P8, P9, P11, P12, P15 | station, wall:crossbow, wall:m79, perk:phdflopper, box | 1 | ARBALÈTE, M79 | PHD FLOPPER, BOÎTE MYSTÈRE |
| Saint-Pierre-le-Jeune |  | extérieure | 21007 | 1500 | -140 ; -340 | P12, P13, P18, P19, P27, P30 | station, wall:magnum, box | 1 | COLT PYTHON .357 | BOÎTE MYSTÈRE |
| Grand'Rue |  | extérieure | 19084 | 1500 | -400 ; 10 | P4, P5, P6, P7, P11, P14, P16, P17, P23 | station, wall:mp5, box | 1 | MP5 | BOÎTE MYSTÈRE |
| Grand Séminaire |  | extérieure | 18479 | 1500 | 300 ; -60 | P46, P48, P51, P53, P54, P55 | station, wall:shotgun, box | 1 | REMINGTON 870 | BOÎTE MYSTÈRE |
| Palais Rohan |  | extérieure | 10259 | 1500 | 261 ; 139 | P47, P49, P53 | wall:ak47 | 0 | AK-47 |  |
| Musée historique |  | extérieure | 14597 | 1500 | 200 ; 215 | P35, P37, P41, P49 | station, wall:arex, box | 1 | AREX ZERO 1 | BOÎTE MYSTÈRE |
| Place Broglie |  | extérieure | 26144 | 2000 | 150 ; -345 | P30, P38, P40, P44, P50, P51 | station, wall:lmg, box | 1 | RPK | BOÎTE MYSTÈRE |
| Quai Schoepflin |  | extérieure | 12302 | 2000 | -20 ; -470 | P18, P38, P42 | wall:svd | 0 | DRAGUNOV SVD |  |
| Hôtel de Neuwiller |  | extérieure | 7283 | 2000 | -466 ; -266 | P3, P9, P13 | wall:famas | 0 | FAMAS F1 |  |
| Monument Stoeber |  | extérieure | 15990 | 2000 | -490 ; -150 | P2, P3, P6, P8 | station, wall:scar, box | 1 | SCAR-H | BOÎTE MYSTÈRE |
| Ancienne Douane |  | extérieure | 14059 | 2000 | 30 ; 330 | P21, P28, P35 | station, wall:sniper | 1 | L96A1 |  |
| Saint-Thomas |  | extérieure | 23394 | 2000 | -230 ; 250 | P10, P16, P21, P22 | station, wall:saiga, box | 1 | SAIGA-12 | BOÎTE MYSTÈRE |
| Église Réformée |  | extérieure | 6297 | 2000 | -329 ; 167 | P7, P10 | wall:smg | 0 | MP40 |  |
| Opéra |  | extérieure | 18274 | 2500 | 250 ; -450 | P42, P44, P52 | station, wall:mg42 | 1 | MG42 |  |
| Préfecture |  | extérieure | 15747 | 2500 | 395 ; -335 | P50, P52, P54, P56 | station, wall:pkm, box | 1 | PKM | BOÎTE MYSTÈRE |
| Saint-Étienne |  | extérieure | 14353 | 2500 | 544 ; -86 | P55, P56 | station, wall:m249, box | 1 | M249 SAW | BOÎTE MYSTÈRE |
| Saint-Pierre-le-Vieux |  | extérieure | 10465 | 2500 | -615 ; -55 | P1, P2, P5 | wall:deagle | 0 | DESERT EAGLE |  |
| Petite France |  | extérieure | 8248 | 2500 | -673 ; 136 | P1, P4 | wall:barrett | 0 | BARRETT M82 |  |

## Portes

| Porte | Prix (pts) | Zone A | Zone B |
|---|---|---|---|
| P1 | 2500 | Saint-Pierre-le-Vieux | Petite France |
| P2 | 2500 | Monument Stoeber | Saint-Pierre-le-Vieux |
| P3 | 2000 | Hôtel de Neuwiller | Monument Stoeber |
| P4 | 2500 | Grand'Rue | Petite France |
| P5 | 2500 | Grand'Rue | Saint-Pierre-le-Vieux |
| P6 | 2000 | Grand'Rue | Monument Stoeber |
| P7 | 2000 | Grand'Rue | Église Réformée |
| P8 | 2000 | Homme de Fer | Monument Stoeber |
| P9 | 2000 | Homme de Fer | Hôtel de Neuwiller |
| P10 | 2000 | Saint-Thomas | Église Réformée |
| P11 | 1500 | Homme de Fer | Grand'Rue |
| P12 | 1500 | Homme de Fer | Saint-Pierre-le-Jeune |
| P13 | 2000 | Saint-Pierre-le-Jeune | Hôtel de Neuwiller |
| P14 | 1500 | Place Kléber | Grand'Rue |
| P15 | 1500 | Place Kléber | Homme de Fer |
| P16 | 2000 | Grand'Rue | Saint-Thomas |
| P17 | 1500 | Grandes Arcades | Grand'Rue |
| P18 | 2000 | Saint-Pierre-le-Jeune | Quai Schoepflin |
| P19 | 1500 | Place Kléber | Saint-Pierre-le-Jeune |
| P20 | 1250 | Grandes Arcades | Place Kléber |
| P21 | 2000 | Ancienne Douane | Saint-Thomas |
| P22 | 2000 | Place Gutenberg | Saint-Thomas |
| P23 | 1500 | Place Gutenberg | Grand'Rue |
| P24 | 1000 | Temple-Neuf | Grandes Arcades |
| P25 | 1250 | Temple-Neuf | Place Kléber |
| P26 | 1250 | Grandes Arcades | Place Gutenberg |
| P27 | 1500 | Temple-Neuf | Saint-Pierre-le-Jeune |
| P28 | 2000 | Place Gutenberg | Ancienne Douane |
| P29 | 750 | Marché-Neuf | Temple-Neuf |
| P30 | 2000 | Saint-Pierre-le-Jeune | Place Broglie |
| P31 | 750 | Temple-Neuf | Rue des Orfèvres |
| P32 | 750 | Marché-Neuf | Rue des Orfèvres |
| P33 | 1000 | Temple-Neuf | Rue du Dôme |
| P34 | 1250 | Place Gutenberg | Cathédrale |
| P35 | 2000 | Musée historique | Ancienne Douane |
| P36 | 1000 | Rue des Orfèvres | Cathédrale |
| P37 | 1500 | Place Gutenberg | Musée historique |
| P38 | 2000 | Place Broglie | Quai Schoepflin |
| P39 | 1000 | Rue des Orfèvres | Rue du Dôme |
| P40 | 2000 | Rue du Dôme | Place Broglie |
| P41 | 1500 | Cathédrale | Musée historique |
| P42 | 2500 | Quai Schoepflin | Opéra |
| P43 | 1000 | Rue du Dôme | Cathédrale |
| P44 | 2500 | Place Broglie | Opéra |
| P45 | 5000 | Cathédrale | Intérieur de la Cathédrale |
| P46 | 1500 | Cathédrale | Grand Séminaire |
| P47 | 1500 | Cathédrale | Palais Rohan |
| P48 | 1500 | Rue du Dôme | Grand Séminaire |
| P49 | 1500 | Palais Rohan | Musée historique |
| P50 | 2500 | Place Broglie | Préfecture |
| P51 | 2000 | Grand Séminaire | Place Broglie |
| P52 | 2500 | Opéra | Préfecture |
| P53 | 1500 | Grand Séminaire | Palais Rohan |
| P54 | 2500 | Grand Séminaire | Préfecture |
| P55 | 2500 | Grand Séminaire | Saint-Étienne |
| P56 | 2500 | Préfecture | Saint-Étienne |

## Emplacements

| N° sur la carte | Type | Nom | Zone | Prix (pts) | x (m, vers l'est) | z (m, vers le sud) |
|---|---|---|---|---|---|---|
| 1 | Borne de munitions | Borne de munitions | Marché-Neuf |  | -10 | -35 |
| 2 | Arme au mur | COLT M1911 | Marché-Neuf | 400 | -20 | -32 |
| 3 | Arme au mur | REMINGTON 870 | Marché-Neuf | 750 | -11 | -18 |
| 4 | Arme au mur | MP40 | Marché-Neuf | 800 | -4 | -45 |
| 5 | Atout | RÉANIMATION RAPIDE | Marché-Neuf | 1500 | -1 | -35 |
| 6 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Marché-Neuf | 950 | 1 | -41 |
| 7 | Borne de munitions | Borne de munitions | Temple-Neuf |  | -50 | -117 |
| 8 | Arme au mur | AREX ZERO 1 | Temple-Neuf | 700 | -58 | -100 |
| 9 | Arme au mur | MP5 | Temple-Neuf | 1200 | -43 | -120 |
| 10 | Atout | STAMIN-UP | Temple-Neuf | 2000 | -43 | -97 |
| 11 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Temple-Neuf | 950 | -16 | -92 |
| 12 | Arme au mur | FAMAS F1 | Rue des Orfèvres | 1300 | 30 | -42 |
| 13 | Atout | SPEED COLA | Rue des Orfèvres | 3000 | 49 | -8 |
| 14 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue des Orfèvres | 950 | 17 | -72 |
| 15 | Borne de munitions | Borne de munitions | Rue du Dôme |  | 116 | -145 |
| 16 | Arme au mur | L96A1 | Rue du Dôme | 1750 | 96 | -151 |
| 17 | Arme au mur | DRAGUNOV SVD | Rue du Dôme | 2000 | 84 | -120 |
| 18 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue du Dôme | 950 | 77 | -123 |
| 19 | Borne de munitions | Borne de munitions | Grandes Arcades |  | -103 | -21 |
| 20 | Arme au mur | AK-47 | Grandes Arcades | 1600 | -99 | -49 |
| 21 | Arme au mur | FN P90 | Grandes Arcades | 1800 | -103 | -41 |
| 22 | Atout | MULE KICK | Grandes Arcades | 4000 | -127 | -16 |
| 23 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grandes Arcades | 950 | -109 | -59 |
| 24 | Borne de munitions | Borne de munitions | Place Kléber |  | -203 | -169 |
| 25 | Arme au mur | RPK | Place Kléber | 2500 | -227 | -134 |
| 26 | Arme au mur | M249 SAW | Place Kléber | 3000 | -179 | -127 |
| 27 | Atout | MASTODONTE | Place Kléber | 2500 | -207 | -113 |
| 28 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Kléber | 950 | -184 | -141 |
| 29 | Borne de munitions | Borne de munitions | Place Gutenberg |  | -1 | 81 |
| 30 | Arme au mur | SCAR-H | Place Gutenberg | 2500 | -6 | 99 |
| 31 | Arme au mur | PKM | Place Gutenberg | 3200 | -14 | 104 |
| 32 | Atout | DOUBLE TAP | Place Gutenberg | 2000 | 2 | 94 |
| 33 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Gutenberg | 950 | -10 | 121 |
| 34 | Borne de munitions | Borne de munitions | Cathédrale |  | 101 | 52 |
| 35 | Arme au mur | DESERT EAGLE | Cathédrale | 1500 | 115 | 34 |
| 36 | Arme au mur | M4A1 | Cathédrale | 1200 | 94 | 36 |
| 37 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Cathédrale | 950 | 108 | 35 |
| 38 | Borne de munitions | Borne de munitions | Intérieur de la Cathédrale |  | 179 | 10 |
| 39 | PACK-A-PUNCH | PACK-A-PUNCH | Intérieur de la Cathédrale | 5000 | 223 | 14 |
| 40 | HORLOGE ASTRONOMIQUE | HORLOGE ASTRONOMIQUE | Intérieur de la Cathédrale | 0 | 228 | 35 |
| 41 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Intérieur de la Cathédrale | 950 | 195 | 34 |
| 42 | Borne de munitions | Borne de munitions | Homme de Fer |  | -296 | -201 |
| 43 | Arme au mur | ARBALÈTE | Homme de Fer | 2000 | -292 | -181 |
| 44 | Arme au mur | M79 | Homme de Fer | 2500 | -269 | -200 |
| 45 | Atout | PHD FLOPPER | Homme de Fer | 2000 | -310 | -218 |
| 46 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Homme de Fer | 950 | -292 | -232 |
| 47 | Borne de munitions | Borne de munitions | Saint-Pierre-le-Jeune |  | -128 | -334 |
| 48 | Arme au mur | COLT PYTHON .357 | Saint-Pierre-le-Jeune | 2000 | -125 | -338 |
| 49 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Pierre-le-Jeune | 950 | -120 | -354 |
| 50 | Borne de munitions | Borne de munitions | Grand'Rue |  | -389 | -12 |
| 51 | Arme au mur | MP5 | Grand'Rue | 1200 | -377 | 12 |
| 52 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grand'Rue | 950 | -391 | -23 |
| 53 | Borne de munitions | Borne de munitions | Grand Séminaire |  | 312 | -35 |
| 54 | Arme au mur | REMINGTON 870 | Grand Séminaire | 750 | 316 | -71 |
| 55 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grand Séminaire | 950 | 304 | -50 |
| 56 | Arme au mur | AK-47 | Palais Rohan | 1600 | 265 | 117 |
| 57 | Borne de munitions | Borne de munitions | Musée historique |  | 182 | 220 |
| 58 | Arme au mur | AREX ZERO 1 | Musée historique | 700 | 201 | 223 |
| 59 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Musée historique | 950 | 195 | 211 |
| 60 | Borne de munitions | Borne de munitions | Place Broglie |  | 155 | -330 |
| 61 | Arme au mur | RPK | Place Broglie | 2500 | 161 | -366 |
| 62 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Broglie | 950 | 149 | -362 |
| 63 | Arme au mur | DRAGUNOV SVD | Quai Schoepflin | 2000 | -35 | -459 |
| 64 | Arme au mur | FAMAS F1 | Hôtel de Neuwiller | 1300 | -479 | -265 |
| 65 | Borne de munitions | Borne de munitions | Monument Stoeber |  | -491 | -176 |
| 66 | Arme au mur | SCAR-H | Monument Stoeber | 2500 | -497 | -142 |
| 67 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Monument Stoeber | 950 | -474 | -122 |
| 68 | Borne de munitions | Borne de munitions | Ancienne Douane |  | 45 | 316 |
| 69 | Arme au mur | L96A1 | Ancienne Douane | 1750 | 25 | 338 |
| 70 | Borne de munitions | Borne de munitions | Saint-Thomas |  | -239 | 256 |
| 71 | Arme au mur | SAIGA-12 | Saint-Thomas | 3000 | -210 | 260 |
| 72 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Thomas | 950 | -249 | 241 |
| 73 | Arme au mur | MP40 | Église Réformée | 800 | -333 | 166 |
| 74 | Borne de munitions | Borne de munitions | Opéra |  | 238 | -456 |
| 75 | Arme au mur | MG42 | Opéra | 4000 | 245 | -426 |
| 76 | Borne de munitions | Borne de munitions | Préfecture |  | 369 | -333 |
| 77 | Arme au mur | PKM | Préfecture | 3200 | 367 | -341 |
| 78 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Préfecture | 950 | 418 | -347 |
| 79 | Borne de munitions | Borne de munitions | Saint-Étienne |  | 536 | -110 |
| 80 | Arme au mur | M249 SAW | Saint-Étienne | 3000 | 542 | -74 |
| 81 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Étienne | 950 | 560 | -84 |
| 82 | Arme au mur | DESERT EAGLE | Saint-Pierre-le-Vieux | 1500 | -624 | -40 |
| 83 | Arme au mur | BARRETT M82 | Petite France | 5000 | -698 | 152 |

## Fin de partie : L'Heure du Jugement (horloge astronomique, intérieur de la cathédrale)

| Réglage | Valeur | Unité |
|---|---|---|
| Manche minimale | 12 |  |
| Zones ouvertes au moins | 18 | (les 10 zones d'origine + 8 zones extérieures) : l'horloge affiche « n/18 quartiers ouverts » |
| Prix | 0 | pts |
| Santé du Bourreau (1 joueur) | 60000 | (+70 % par joueur en plus) |
| Zombies simultanés (vague) | 28 |  |
| Répit entre deux vagues | 8 | s |

## Motos (deux parkings au panneau bleu « P », avec chacun une borne plein + réparation : place Gutenberg, 2 motos ; place Broglie, 1 moto)

| Réglage | MOTO | GROSSE MOTO | Unité |
|---|---|---|---|
| Places | 1 | 2 |  |
| Points de vie | 300 | 500 | PV |
| Vitesse max | 76 | 61 | km/h |
| Réservoir | 6 | 10 | L |
| Autonomie à fond | 3 | 4 | min |
| Seuil d'écrasement | 32 | 25 | km/h (en dessous : aucun dégât, un zombie arrête la moto) |
| Dégâts d'écrasement au seuil / à la vitesse max | 58 / 336 | 67 / 408 | PV de zombie |
| Usure par écrasement | 5 (zombie tué) / 12 (survivant) | idem | PV de la moto |
| Choc contre un objet physique (voiture, mobilier, arbre, machine…) | (vitesse perdue - 6) x 5 | idem | PV de la moto |
| Choc contre un mur (façade, quai, parapet, porte, marche, bord de l'île) | aucun dégât pour la moto | idem | le pilote se blesse comme pour un objet |
| Choc contre une autre moto | (vitesse d'approche - 4) x 4, pour chacune ; rebond 1.3 x la vitesse vers l'autre | idem | PV de la moto (la moto garée est un obstacle fixe) |
| Coup de zombie sur un occupant | 10 | idem | PV de la moto (le joueur perd 20) |
| Explosion proche (grenade, M79…) | 10 % des dégâts infligés aux zombies | idem |  |
| À 0 PV | feu 2 s, explosion (rayon 5 m, 1000 aux zombies, jusqu'à 50 aux joueurs sans jamais les tuer), épave 20 s | idem |  |
| Retour au parking | 2 manches après la destruction, PV pleins, 40 % d'essence | idem |  |
| Borne du parking (à pied, moto à moins de 8 m) | 50 pts par litre + 2 pts par PV | idem | plein + réparation |
| Bidon d'essence (bonus) | +2,5 L, 3 % par zombie tué si une moto est sous 50 % | idem |  |
| Panne sèche | réserve < 15 % : bip, ratés < 5 %, à 0 : poussée 3 m/s | idem |  |

## Couteau (toujours disponible, hors inventaire)

| Réglage | Valeur | Unité / remarque |
|---|---|---|
| Touches | V à pied ; clic gauche quand le chargeur ET la réserve sont vides | V reste la vue 3e / 1re personne en moto (touches par défaut, modifiables dans Options > Touches) |
| Portée / cône | 1,8 / 35 | m / degrés de part et d'autre de la visée ; fente de 0,8 m si un zombie est à moins de 2,6 m et qu'on avance |
| Cadence | 1 coup / 0,6 s | touche à 0,12 s, animation 0,55 s |
| Dégâts | max(150, 0,34 x santé des zombies de la manche) | dos ou tête x 1,5 (non cumulés) ; l'armure du chevalier de fer est ignorée |
| Manche 1 | 150 par coup (100 PV) | 1 coup(s) de face, 1 dans le dos ou à la tête |
| Manche 5 | 150 par coup (220 PV) | 2 coup(s) de face, 1 dans le dos ou à la tête |
| Manche 10 | 150 par coup (374 PV) | 3 coup(s) de face, 2 dans le dos ou à la tête |
| Manche 15 | 205 par coup (602 PV) | 3 coup(s) de face, 2 dans le dos ou à la tête |
| Manche 20 | 330 par coup (970 PV) | 3 coup(s) de face, 2 dans le dos ou à la tête |
| Bourreau | 150 fixes | x 0,75 de face, x 2 dans le dos |
| Points | 10 par touche, 100 par mort |  |

## Enjambement et déblocage

| Réglage | Valeur | Unité / remarque |
|---|---|---|
| Enjambement | Espace face à un obstacle enjambable | à moins de 0,9 m, de face (moins de 45°), profondeur traversée 1,3 m au plus, case d'arrivée libre à ±0,3 m, dans une zone OUVERTE (jamais de contournement d'une porte payante) |
| Durée | 0,5 | s (caméra +0,6 m, arme baissée, pas de tir) |
| Enjambables (hauteur <= 1,15 m) | banc, poubelle, jardinière, caisse seule, borne, vélos (profondeur <= 1,3 m), sacs de sable, barrière de foule, bloc béton |  |
| On marche dessus | palette (0,2 m) |  |
| Non enjambables | voiture, fontaine, chalet, caisses empilées, porte payante, barricade scellée, parapet de quai, machines, bornes de munitions, garde-corps de la cathédrale |  |
| Se débloquer (K) | maintenir 2 s | l'invite apparaît si une touche de déplacement est maintenue 4 s sans avancer de 0,5 m, ou après 3 s dans une poche fermée ; arrivée à moins de 40 m dans une zone ouverte (sinon centre de zone) ; recharge 30 s ; impossible en moto, à terre, à l'étage |

## Commandes (touches par défaut, modifiables dans Options > Touches)

| Touche par défaut | Action |
|---|---|
| Options > Touches | Change toutes les touches ci-dessous, sauf souris, molette, Échap et F9 (réglage local, gardé sur l'appareil ; échange proposé si une touche est déjà prise) |
| ZQSD / WASD / flèches | Se déplacer |
| Souris | Viser |
| Clic gauche | Tirer |
| Clic droit | Viser à la mire |
| Maj gauche | Sprint |
| Espace | Sauter |
| R | Recharger |
| 1 / 2 / 3 / molette | Changer d'arme |
| G | Grenade |
| E | Acheter, ouvrir une porte, utiliser une machine ou la borne des motos, réanimer (maintenir), monter / descendre d'une moto |
| ZQSD / WASD (en moto) | Accélérer, freiner / reculer, tourner |
| Espace (en moto) | Frein à main |
| V (en moto) | Vue à la 3e personne / à la 1re personne |
| F | Lampe torche |
| Espace (devant un obstacle bas) | Enjamber |
| K (maintenir 2 s, si coincé) | Se débloquer |
| V (à pied) | Coup de couteau (aussi : clic gauche quand le chargeur et la réserve sont vides) |
| M | Carte |
| Clic molette | Lance-grenades sous le canon (fusil d'assaut Pack-a-Punch niveau III) |
| Échap | Ferme la carte ou le menu debug ; sinon menu pause (reprise : Échap, ou clic si le navigateur refuse) ; ferme aussi la capture d'une touche dans Options > Touches |
| F9 (hôte) | Menu debug de l'hôte : 1-4 joueur, T deux fois amener, Y rejoindre, N réanimer, U débloquer les zombies, P perfs |

### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : trois niveaux, chacun payé par le joueur avec ses propres points et améliorant l'arme déjà améliorée (le niveau III est refusé au-delà). Dégâts ×2,5 / ×3,5 / ×5 (pistolet à rayons ×1,6 / ×2,2 / ×3), tête ×1,2 / ×1,3 / ×1,4, zombies traversés +2 / +3 / +4, chargeur ×1,5 (puis ×1,33 avec l'accessoire aux niveaux II et III), réserve ×1,5 / ×2 / ×2,5, rechargement ×0,85 (II) / ×0,75 (III), dispersion ×0,85 / ×0,7, prix des munitions au mur ×3 / ×4 / ×5. Reflet de l'arme : violet, bleu, or-rouge pulsant (III) ; des accessoires s'ajoutent à chaque niveau.
- **Atouts** : on les perd tous quand on tombe à terre.
