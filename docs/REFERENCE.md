# Zombie Survival — fiche de référence

Version du jeu : **v0.96.0** (package 0.96.0). Générée automatiquement par `node tools/make-docs.mjs` à partir de `src/config.js` et du jeu.
Carte annotée : [carte.png](carte.png). Armes de profil : [armes.png](armes.png). Les mêmes tableaux en tableur : dossier [csv/](csv/).

Pour demander une modification, citez la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts », « mettre la boîte mystère dans la zone Temple-Neuf »).

## Grande Île

Toute la Grande Île de Strasbourg est jouable : on commence place du Marché-Neuf et on ouvre les zones l'une après l'autre en payant les portes.
Elle est découpée en 34 zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à 95 m pour les 10 zones d'origine, sans limite pour les 17 zones extérieures), et les portes se trouvent entre deux zones voisines (une porte ouvre toute la limite entre les deux zones). Les 7 zones de la Gare de Strasbourg (quais, hall, place) forment une aire séparée, reliée à l'île par le tram (arrêt « Gare Centrale » ↔ Homme de Fer).
Prix d'une porte : le plus cher des deux prix de zone (colonne « Prix de la porte ») ; zones extérieures : palier A 1500, B 2000, C 2500 pts. Le contenu de chaque zone se règle dans `src/config.js` → `sector.zones[].items`.
À la première ouverture d'une zone extérieure, un bonus apparaît. La boîte mystère ne se déplace que dans une zone déjà ouverte. « Grand'Rue » et « Quai Schoepflin » sont des noms déduits du plan (à confirmer).

## Armes

| id | Arme | Catégorie | Calibre | Type | Dégâts par balle | Plombs par tir | Multiplicateur tête | Cadence (tirs/s) | DPS approx. | Chargeur | Réserve départ | Réserve max | Rechargement (s) | Dispersion | Portée (m) | Zombies traversés | Explosion rayon (m) | Explosion dégâts | Prix au mur (pts) | Prix munitions (pts) | Où l'obtenir |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| m1911 | COLT M1911 | pistolet | .45 ACP | coup par coup | 50 | 1 | 2,6 | 5,5 | 275 | 7 | 42 | 84 | 1,5 | 0,01 | 50 | 1 |  |  | 400 | 150 | mur Marché-Neuf, mur Quais, boîte mystère, arme de départ (au hasard) |
| arex | AREX ZERO 1 | pistolet | 9 mm | coup par coup | 29 | 1 | 2,2 | 7,5 | 217,5 | 17 | 68 | 136 | 1,4 | 0,009 | 55 | 1 |  |  | 700 | 250 | mur Temple-Neuf, mur Rue du Dôme, mur Palais Rohan, mur Musée historique, boîte mystère, arme de départ (au hasard) |
| deagle | DESERT EAGLE | pistolet | .50 AE | coup par coup | 160 | 1 | 3 | 2,4 | 384 | 7 | 35 | 56 | 1,9 | 0,011 | 70 | 2 |  |  | 1500 | 600 | mur Cathédrale, mur Opéra, mur Saint-Pierre-le-Vieux, boîte mystère |
| magnum | COLT PYTHON .357 | pistolet | .357 Magnum | coup par coup | 143 | 1 | 3 | 3,2 | 457,6 | 6 | 48 | 72 | 2,2 | 0,006 | 80 | 2 |  |  | 2000 | 500 | mur Cathédrale, mur Saint-Pierre-le-Jeune, boîte mystère |
| rifle | M4A1 | fusil d'assaut | 5,56 mm | automatique | 36 | 1 | 2,4 | 12,5 | 450 | 30 | 120 | 180 | 1,8 | 0,012 | 90 | 1 |  |  | 1200 | 300 | mur Place Kléber, mur Cathédrale, mur Grand Séminaire, mur Saint-Thomas, mur Préfecture, boîte mystère |
| ak47 | AK-47 | fusil d'assaut | 7,62×39 mm | automatique | 54 | 1 | 2,3 | 10 | 540 | 30 | 120 | 210 | 2,4 | 0,017 | 90 | 1 |  |  | 1600 | 600 | mur Grandes Arcades, mur Palais Rohan, mur Église Réformée, mur Quai des Bateliers, boîte mystère |
| famas | FAMAS F1 | fusil d'assaut | 5,56 mm | automatique | 40 | 1 | 2,4 | 15 | 600 | 25 | 125 | 225 | 2,2 | 0,014 | 85 | 1 |  |  | 1300 | 500 | mur Temple-Neuf, mur Rue des Orfèvres, mur Place Broglie, mur Hôtel de Neuwiller, mur Place de la Gare, mur Place de Zurich, boîte mystère |
| scar | SCAR-H | fusil d'assaut | 7,62×51 mm | automatique | 78 | 1 | 2,5 | 10 | 780 | 20 | 100 | 180 | 2,3 | 0,018 | 100 | 2 |  |  | 2500 | 800 | mur Place Gutenberg, mur Musée historique, mur Monument Stoeber, mur Saint-Étienne, mur Saint-Guillaume, boîte mystère |
| smg | MP40 | pistolet-mitrailleur | 9 mm | automatique | 30 | 1 | 2,2 | 8,3 | 249 | 32 | 128 | 224 | 1,5 | 0,022 | 65 | 1 |  |  | 800 | 500 | mur Marché-Neuf, mur Rue des Orfèvres, mur Musée historique, mur Place Broglie, mur Église Réformée, boîte mystère |
| mp5 | MP5 | pistolet-mitrailleur | 9 mm | automatique | 26 | 1 | 2,2 | 13 | 338 | 30 | 150 | 270 | 1,8 | 0,017 | 65 | 1 |  |  | 1200 | 500 | mur Temple-Neuf, mur Saint-Pierre-le-Jeune, mur Grand'Rue, mur Quai Schoepflin, mur Petite France, mur Hall de la Gare, mur Quai des Bateliers, boîte mystère |
| p90 | FN P90 | pistolet-mitrailleur | 5,7×28 mm | automatique | 22 | 1 | 2 | 15 | 330 | 50 | 200 | 350 | 2,6 | 0,02 | 70 | 2 |  |  | 1800 | 700 | mur Grandes Arcades, mur Homme de Fer, mur Monument Stoeber, boîte mystère |
| lmg | RPK | mitrailleuse | 7,62×39 mm | automatique | 51 | 1 | 2 | 10 | 510 | 75 | 300 | 450 | 3,6 | 0,028 | 90 | 1 |  |  | 2500 | 1000 | mur Place Kléber, mur Place Broglie, boîte mystère |
| m249 | M249 SAW | mitrailleuse | 5,56 mm | automatique | 40 | 1 | 2 | 12,5 | 500 | 100 | 300 | 500 | 4,2 | 0,032 | 90 | 1 |  |  | 3000 | 1200 | mur Place Kléber, mur Saint-Étienne, boîte mystère |
| mg42 | MG42 | mitrailleuse | 7,92×57 mm | automatique | 64 | 1 | 2 | 20 | 1280 | 50 | 250 | 450 | 5 | 0,04 | 90 | 2 |  |  | 4000 | 1200 | mur Opéra, mur Manufacture des Tabacs, boîte mystère |
| pkm | PKM | mitrailleuse | 7,62×54R | automatique | 64 | 1 | 2 | 10,5 | 672 | 100 | 300 | 500 | 4,8 | 0,03 | 100 | 2 |  |  | 3200 | 1300 | mur Place Gutenberg, mur Préfecture, boîte mystère |
| sniper | L96A1 | fusil de précision | 7,62×51 mm Match | coup par coup | 340 | 1 | 3,5 | 1,1 | 374 | 5 | 30 | 45 | 2,8 | 0,0015 | 200 | 4 |  |  | 1750 | 700 | mur Rue du Dôme, mur Ancienne Douane, boîte mystère |
| svd | DRAGUNOV SVD | fusil de précision | 7,62×54R 7N1 | coup par coup | 230 | 1 | 3 | 3 | 690 | 10 | 40 | 70 | 2,6 | 0,004 | 180 | 3 |  |  | 2000 | 800 | mur Rue du Dôme, mur Quai Schoepflin, boîte mystère |
| barrett | BARRETT M82 | fusil de précision | .50 BMG | coup par coup | 700 | 1 | 3 | 1,2 | 840 | 10 | 30 | 50 | 3,4 | 0,002 | 220 | 6 |  |  | 5000 | 1500 | mur Intérieur de la Cathédrale, mur Petite France, boîte mystère |
| shotgun | REMINGTON 870 | fusil à pompe | 12 ga | pompe | 30 | 8 | 1,8 | 1,3 | 312 | 6 | 30 | 48 | 2,4 | 0,046 | 35 | 1 |  |  | 750 | 350 | mur Marché-Neuf, mur Grandes Arcades, mur Place Gutenberg, mur Grand'Rue, mur Grand Séminaire, mur Ancienne Douane, mur Saint-Pierre-le-Vieux, mur Quais, boîte mystère |
| saiga | SAIGA-12 | fusil à pompe | 12 ga | coup par coup | 27 | 8 | 1,8 | 3,5 | 756 | 8 | 32 | 64 | 2,6 | 0,05 | 35 | 1 |  |  | 3000 | 700 | mur Hôtel de Neuwiller, mur Saint-Thomas, mur Petite France, mur Place de Zurich, boîte mystère |
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
| juggernog | MASTODONTE | M | Santé max 250 | 2500 | 2500 | Place Kléber, Place Broglie, Petite France, Manufacture des Tabacs |
| speedcola | SPEED COLA | S | Rechargement 2x plus rapide | 3000 | 3000 | Rue des Orfèvres, Grand'Rue, Opéra |
| doubletap | DOUBLE TAP | D | Cadence +33 %, dégâts +25 % | 2000 | 2000 | Place Gutenberg, Palais Rohan, Saint-Guillaume |
| quickrevive | RÉANIMATION RAPIDE | R | Solo : se relève seul · Co-op : réanime 2x plus vite | 1500 | 500 | Marché-Neuf, Grand Séminaire, Saint-Pierre-le-Vieux, Hall de la Gare |
| mulekick | MULE KICK | K | Porter 3 armes | 4000 | 4000 | Grandes Arcades, Saint-Thomas |
| staminup | STAMIN-UP | E | Course plus rapide | 2000 | 2000 | Temple-Neuf, Saint-Pierre-le-Jeune, Saint-Étienne, Place de la Gare |
| phdflopper | PHD FLOPPER | P | Immunisé aux explosions et aux chocs · saut en sprint : onde explosive | 2000 | 2000 | Homme de Fer, Ancienne Douane |
| deadshot | ŒIL-DE-LYNX | L | Tirs à la tête +50 % · dispersion -35 % | 1500 | 1500 | Rue des Orfèvres |
| electriccherry | CERISE-FOUDRE | F | Recharger libère une décharge électrique (chargeur vide : plus forte) | 2000 | 2000 | Place Gutenberg |
| widowswine | VEUVE NOIRE | N | Frappé : une toile englue les zombies proches · couteau collant | 4000 | 4000 | Ancienne Douane |
| vultureaid | VAUTOUR | V | Les zombies lâchent parfois des munitions ou des points | 3000 | 3000 | Saint-Pierre-le-Jeune |
| tombstone | PIERRE TOMBALE | T | À terre : vos atouts restent dans une tombe à récupérer | 2000 | 2000 | Palais Rohan |
| dyingwish | ULTIME VOLONTÉ | U | Un coup fatal vous laisse debout, invulnérable 4 s (recharge 150 s) | 4000 | 4000 | Opéra |
| stronghold | BASTION | B | Immobile (3 m) : -30 % de dégâts reçus | 2500 | 2500 | Place Kléber |
| deathperception | SIXIÈME SENS | 6 | Radar élargi · 10 % de coups critiques (dégâts x2) | 2000 | 2000 | Grandes Arcades |
| bandolier | CARTOUCHIÈRE | C | Réserve de munitions +50 % | 1500 | 1500 | Temple-Neuf |

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
| Marché-Neuf | oui | secteur d'origine | 2296 | 0 | -1 ; -31 | P29, P32 | station, wall:m1911, wall:shotgun, wall:smg, perk:quickrevive, box | 1 | COLT M1911, REMINGTON 870, MP40 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Temple-Neuf |  | secteur d'origine | 4251 | 750 | -35 ; -95 | P24, P25, P27, P29, P31, P33, P60 | station, wall:arex, wall:mp5, wall:famas, perk:staminup, perk:bandolier, box | 1 | AREX ZERO 1, MP5, FAMAS F1 | STAMIN-UP, CARTOUCHIÈRE, BOÎTE MYSTÈRE |
| Rue des Orfèvres |  | secteur d'origine | 705 | 750 | 27 ; -58 | P31, P32, P36, P39, P59 | station, wall:famas, wall:smg, perk:speedcola, perk:deadshot, box | 1 | FAMAS F1, MP40 | SPEED COLA, ŒIL-DE-LYNX, BOÎTE MYSTÈRE |
| Rue du Dôme |  | secteur d'origine | 4710 | 1000 | 104 ; -118 | P33, P39, P40, P43, P48, P62, P63 | station, wall:sniper, wall:svd, wall:arex, box | 1 | L96A1, DRAGUNOV SVD, AREX ZERO 1 | BOÎTE MYSTÈRE |
| Grandes Arcades |  | secteur d'origine | 5232 | 1000 | -110 ; -45 | P17, P20, P24, P26, P61, P65 | station, wall:ak47, wall:p90, wall:shotgun, perk:mulekick, perk:deathperception, box | 1 | AK-47, FN P90, REMINGTON 870 | MULE KICK, SIXIÈME SENS, BOÎTE MYSTÈRE |
| Place Kléber |  | secteur d'origine | 11768 | 1250 | -199 ; -145 | P14, P15, P19, P20, P25 | station, wall:rifle, wall:lmg, wall:m249, perk:juggernog, perk:stronghold, box | 1 | M4A1, RPK, M249 SAW | MASTODONTE, BASTION, BOÎTE MYSTÈRE |
| Place Gutenberg |  | secteur d'origine | 8658 | 1250 | -20 ; 90 | P22, P23, P26, P28, P34, P37, P67, P68 | station, wall:shotgun, wall:scar, wall:pkm, perk:doubletap, perk:electriccherry, box | 1 | REMINGTON 870, SCAR-H, PKM | DOUBLE TAP, CERISE-FOUDRE, BOÎTE MYSTÈRE |
| Cathédrale |  | secteur d'origine | 6705 | 1000 | 103 ; 33 | P34, P36, P41, P43, P45, P46, P47, P69 | station, wall:deagle, wall:rifle, wall:magnum, box | 1 | DESERT EAGLE, M4A1, COLT PYTHON .357 | BOÎTE MYSTÈRE |
| Intérieur de la Cathédrale |  | secteur d'origine | 3593 | 5000 | 179 ; 40 | P45 | pap, clock, station, box, wall:barrett | 1 | BARRETT M82 | PACK-A-PUNCH, HORLOGE ASTRONOMIQUE, BOÎTE MYSTÈRE |
| Homme de Fer |  | secteur d'origine | 10097 | 1500 | -290 ; -203 | P8, P9, P11, P12, P15, P66, P70 | station, wall:p90, wall:crossbow, wall:m79, perk:phdflopper, box | 1 | FN P90, ARBALÈTE, M79 | PHD FLOPPER, BOÎTE MYSTÈRE |
| Saint-Pierre-le-Jeune |  | extérieure | 21062 | 1500 | -140 ; -340 | P12, P13, P18, P19, P27, P30, P71 | station, wall:magnum, wall:mp5, perk:staminup, perk:vultureaid, box | 1 | COLT PYTHON .357, MP5 | STAMIN-UP, VAUTOUR, BOÎTE MYSTÈRE |
| Grand'Rue |  | extérieure | 19172 | 1500 | -400 ; 10 | P4, P5, P6, P7, P11, P14, P16, P17, P23, P64, P72, P73 | station, wall:mp5, wall:shotgun, perk:speedcola, box | 1 | MP5, REMINGTON 870 | SPEED COLA, BOÎTE MYSTÈRE |
| Grand Séminaire |  | extérieure | 18569 | 1500 | 300 ; -60 | P46, P48, P51, P53, P54, P55, P74 | station, wall:shotgun, wall:rifle, perk:quickrevive, box | 1 | REMINGTON 870, M4A1 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Palais Rohan |  | extérieure | 10267 | 1500 | 261 ; 139 | P47, P49, P53 | station, wall:ak47, wall:arex, perk:doubletap, perk:tombstone, box | 1 | AK-47, AREX ZERO 1 | DOUBLE TAP, PIERRE TOMBALE, BOÎTE MYSTÈRE |
| Musée historique |  | extérieure | 14644 | 1500 | 200 ; 215 | P35, P37, P41, P49, P75 | station, wall:arex, wall:scar, wall:smg, box | 1 | AREX ZERO 1, SCAR-H, MP40 | BOÎTE MYSTÈRE |
| Place Broglie |  | extérieure | 26173 | 2000 | 150 ; -345 | P30, P38, P40, P44, P50, P51, P76 | station, wall:smg, wall:famas, wall:lmg, perk:juggernog, box | 1 | MP40, FAMAS F1, RPK | MASTODONTE, BOÎTE MYSTÈRE |
| Quai Schoepflin |  | extérieure | 12324 | 2000 | -20 ; -470 | P18, P38, P42, P77 | station, wall:svd, wall:mp5, box | 1 | DRAGUNOV SVD, MP5 | BOÎTE MYSTÈRE |
| Hôtel de Neuwiller |  | extérieure | 7303 | 2000 | -466 ; -266 | P3, P9, P13, P78 | station, wall:famas, wall:saiga, box | 1 | FAMAS F1, SAIGA-12 | BOÎTE MYSTÈRE |
| Monument Stoeber |  | extérieure | 16044 | 2000 | -490 ; -150 | P2, P3, P6, P8, P79 | station, wall:scar, wall:p90, box | 1 | SCAR-H, FN P90 | BOÎTE MYSTÈRE |
| Ancienne Douane |  | extérieure | 14108 | 2000 | 30 ; 330 | P21, P28, P35, P80, P81 | station, wall:sniper, wall:shotgun, perk:phdflopper, perk:widowswine, box | 1 | L96A1, REMINGTON 870 | PHD FLOPPER, VEUVE NOIRE, BOÎTE MYSTÈRE |
| Saint-Thomas |  | extérieure | 23453 | 2000 | -230 ; 250 | P10, P16, P21, P22 | station, wall:saiga, wall:rifle, perk:mulekick, box | 1 | SAIGA-12, M4A1 | MULE KICK, BOÎTE MYSTÈRE |
| Église Réformée |  | extérieure | 6329 | 2000 | -331 ; 167 | P7, P10, P83 | station, wall:smg, wall:ak47, box | 1 | MP40, AK-47 | BOÎTE MYSTÈRE |
| Opéra |  | extérieure | 18281 | 2500 | 250 ; -450 | P42, P44, P52, P84 | station, wall:deagle, wall:mg42, perk:speedcola, perk:dyingwish, box | 1 | DESERT EAGLE, MG42 | SPEED COLA, ULTIME VOLONTÉ, BOÎTE MYSTÈRE |
| Préfecture |  | extérieure | 15778 | 2500 | 395 ; -335 | P50, P52, P54, P56, P85 | station, wall:pkm, wall:rifle, box | 1 | PKM, M4A1 | BOÎTE MYSTÈRE |
| Saint-Étienne |  | extérieure | 14384 | 2500 | 544 ; -86 | P55, P56, P86 | station, wall:m249, wall:scar, perk:staminup, box | 1 | M249 SAW, SCAR-H | STAMIN-UP, BOÎTE MYSTÈRE |
| Saint-Pierre-le-Vieux |  | extérieure | 10497 | 2500 | -615 ; -55 | P1, P2, P5, P87 | station, wall:deagle, wall:shotgun, perk:quickrevive, box | 1 | DESERT EAGLE, REMINGTON 870 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Petite France |  | extérieure | 8275 | 2500 | -673 ; 136 | P1, P4 | station, wall:barrett, wall:saiga, wall:mp5, perk:juggernog, box | 1 | BARRETT M82, SAIGA-12, MP5 | MASTODONTE, BOÎTE MYSTÈRE |
| Quais |  | gare (aire séparée, tram) | 3132 | 750 | -1059 ; -333 | P57 | station, wall:m1911, wall:shotgun | 1 | COLT M1911, REMINGTON 870 |  |
| Hall de la Gare |  | gare (aire séparée, tram) | 3315 | 750 | -1011 ; -306 | P57, P58 | station, wall:mp5, perk:quickrevive, box | 1 | MP5 | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Place de la Gare |  | gare (aire séparée, tram) | 20818 | 1000 | -969 ; -289 | P58 | station, wall:famas, perk:staminup | 1 | FAMAS F1 | STAMIN-UP |
| Quai des Bateliers |  | gare (aire séparée, tram) | 4245 |  | 932 ; 155 | P89 | station, wall:mp5, wall:ak47 | 1 | MP5, AK-47 |  |
| Saint-Guillaume |  | gare (aire séparée, tram) | 7800 |  | 1052 ; 168 |  | station, wall:scar, perk:doubletap | 1 | SCAR-H | DOUBLE TAP |
| Place de Zurich |  | gare (aire séparée, tram) | 7590 |  | 927 ; 327 |  | station, wall:famas, wall:saiga | 1 | FAMAS F1, SAIGA-12 |  |
| Manufacture des Tabacs |  | gare (aire séparée, tram) | 14794 |  | 1032 ; 336 |  | station, wall:mg42, perk:juggernog | 1 | MG42 | MASTODONTE |

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
| P57 | 750 | Quais | Hall de la Gare |
| P58 | 1000 | Hall de la Gare | Place de la Gare |
| P59 | 500 | Rue des Orfèvres | Rue des Orfèvres |
| P60 | 500 | Temple-Neuf | Temple-Neuf |
| P61 | 500 | Grandes Arcades | Grandes Arcades |
| P62 | 500 | Rue du Dôme | Rue du Dôme |
| P63 | 500 | Rue du Dôme | Rue du Dôme |
| P64 | 750 | Grand'Rue | Grand'Rue |
| P65 | 500 | Grandes Arcades | Grandes Arcades |
| P66 | 750 | Homme de Fer | Homme de Fer |
| P67 | 750 | Place Gutenberg | Place Gutenberg |
| P68 | 750 | Place Gutenberg | Place Gutenberg |
| P69 | 500 | Cathédrale | Cathédrale |
| P70 | 750 | Homme de Fer | Homme de Fer |
| P71 | 750 | Saint-Pierre-le-Jeune | Saint-Pierre-le-Jeune |
| P72 | 750 | Grand'Rue | Grand'Rue |
| P73 | 750 | Grand'Rue | Grand'Rue |
| P74 | 750 | Grand Séminaire | Grand Séminaire |
| P75 | 750 | Musée historique | Musée historique |
| P76 | 1000 | Place Broglie | Place Broglie |
| P77 | 1000 | Quai Schoepflin | Quai Schoepflin |
| P78 | 1000 | Hôtel de Neuwiller | Hôtel de Neuwiller |
| P79 | 1000 | Monument Stoeber | Monument Stoeber |
| P80 | 1000 | Ancienne Douane | Ancienne Douane |
| P81 | 1000 | Ancienne Douane | Ancienne Douane |
| P82 | 500 | hors secteur | hors secteur |
| P83 | 1000 | Église Réformée | Église Réformée |
| P84 | 1250 | Opéra | Opéra |
| P85 | 1250 | Préfecture | Préfecture |
| P86 | 1250 | Saint-Étienne | Saint-Étienne |
| P87 | 1250 | Saint-Pierre-le-Vieux | Saint-Pierre-le-Vieux |
| P88 | 500 | hors secteur | hors secteur |
| P89 | 3000 | Quai des Bateliers | Quai des Bateliers |

## Emplacements

| N° sur la carte | Type | Nom | Zone | Prix (pts) | x (m, vers l'est) | z (m, vers le sud) |
|---|---|---|---|---|---|---|
| 1 | Borne de munitions | Borne de munitions | Marché-Neuf |  | -10 | -32 |
| 2 | Arme au mur | COLT M1911 | Marché-Neuf | 400 | 6 | -46 |
| 3 | Arme au mur | REMINGTON 870 | Marché-Neuf | 750 | 2 | -21 |
| 4 | Arme au mur | MP40 | Marché-Neuf | 800 | 2 | -43 |
| 5 | Atout | RÉANIMATION RAPIDE | Marché-Neuf | 1500 | -25 | -31 |
| 6 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Marché-Neuf | 950 | -25 | -38 |
| 7 | Borne de munitions | Borne de munitions | Temple-Neuf |  | -53 | -117 |
| 8 | Arme au mur | AREX ZERO 1 | Temple-Neuf | 700 | -53 | -104 |
| 9 | Arme au mur | MP5 | Temple-Neuf | 1200 | -32 | -107 |
| 10 | Arme au mur | FAMAS F1 | Temple-Neuf | 1300 | -23 | -97 |
| 11 | Atout | STAMIN-UP | Temple-Neuf | 2000 | -40 | -109 |
| 12 | Atout | CARTOUCHIÈRE | Temple-Neuf | 1500 | -39 | -124 |
| 13 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Temple-Neuf | 950 | -33 | -86 |
| 14 | Borne de munitions | Borne de munitions | Rue des Orfèvres |  | 50 | -5 |
| 15 | Arme au mur | FAMAS F1 | Rue des Orfèvres | 1300 | 17 | -68 |
| 16 | Arme au mur | MP40 | Rue des Orfèvres | 800 | 33 | -46 |
| 17 | Atout | SPEED COLA | Rue des Orfèvres | 3000 | 19 | -11 |
| 18 | Atout | ŒIL-DE-LYNX | Rue des Orfèvres | 1500 | 22 | -63 |
| 19 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue des Orfèvres | 950 | 37 | -35 |
| 20 | Borne de munitions | Borne de munitions | Rue du Dôme |  | 86 | -115 |
| 21 | Arme au mur | L96A1 | Rue du Dôme | 1750 | 126 | -132 |
| 22 | Arme au mur | DRAGUNOV SVD | Rue du Dôme | 2000 | 79 | -120 |
| 23 | Arme au mur | AREX ZERO 1 | Rue du Dôme | 700 | 78 | -129 |
| 24 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Rue du Dôme | 950 | 106 | -134 |
| 25 | Borne de munitions | Borne de munitions | Grandes Arcades |  | -104 | -59 |
| 26 | Arme au mur | AK-47 | Grandes Arcades | 1600 | -107 | -53 |
| 27 | Arme au mur | FN P90 | Grandes Arcades | 1800 | -96 | -59 |
| 28 | Arme au mur | REMINGTON 870 | Grandes Arcades | 750 | -95 | -67 |
| 29 | Atout | MULE KICK | Grandes Arcades | 4000 | -108 | -68 |
| 30 | Atout | SIXIÈME SENS | Grandes Arcades | 2000 | -109 | -62 |
| 31 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grandes Arcades | 950 | -100 | -22 |
| 32 | Borne de munitions | Borne de munitions | Place Kléber |  | -215 | -161 |
| 33 | Arme au mur | M4A1 | Place Kléber | 1200 | -223 | -132 |
| 34 | Arme au mur | RPK | Place Kléber | 2500 | -176 | -127 |
| 35 | Arme au mur | M249 SAW | Place Kléber | 3000 | -204 | -115 |
| 36 | Atout | MASTODONTE | Place Kléber | 2500 | -198 | -140 |
| 37 | Atout | BASTION | Place Kléber | 2500 | -217 | -132 |
| 38 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Kléber | 950 | -198 | -117 |
| 39 | Borne de munitions | Borne de munitions | Place Gutenberg |  | -34 | 90 |
| 40 | Arme au mur | REMINGTON 870 | Place Gutenberg | 750 | 4 | 83 |
| 41 | Arme au mur | SCAR-H | Place Gutenberg | 2500 | -3 | 99 |
| 42 | Arme au mur | PKM | Place Gutenberg | 3200 | -31 | 73 |
| 43 | Atout | DOUBLE TAP | Place Gutenberg | 2000 | -25 | 113 |
| 44 | Atout | CERISE-FOUDRE | Place Gutenberg | 2000 | -6 | 116 |
| 45 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Gutenberg | 950 | -12 | 59 |
| 46 | Borne de munitions | Borne de munitions | Cathédrale |  | 110 | 52 |
| 47 | Arme au mur | DESERT EAGLE | Cathédrale | 1500 | 114 | 29 |
| 48 | Arme au mur | M4A1 | Cathédrale | 1200 | 124 | 26 |
| 49 | Arme au mur | COLT PYTHON .357 | Cathédrale | 2000 | 102 | 39 |
| 50 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Cathédrale | 950 | 102 | 59 |
| 51 | Borne de munitions | Borne de munitions | Intérieur de la Cathédrale |  | 179 | 10 |
| 52 | Arme au mur | BARRETT M82 | Intérieur de la Cathédrale | 5000 | 207 | 37 |
| 53 | PACK-A-PUNCH | PACK-A-PUNCH | Intérieur de la Cathédrale | 5000 | 223 | 14 |
| 54 | HORLOGE ASTRONOMIQUE | HORLOGE ASTRONOMIQUE | Intérieur de la Cathédrale | 0 | 228 | 35 |
| 55 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Intérieur de la Cathédrale | 950 | 192 | 46 |
| 56 | Borne de munitions | Borne de munitions | Homme de Fer |  | -289 | -188 |
| 57 | Arme au mur | FN P90 | Homme de Fer | 1800 | -272 | -196 |
| 58 | Arme au mur | ARBALÈTE | Homme de Fer | 2000 | -295 | -176 |
| 59 | Arme au mur | M79 | Homme de Fer | 2500 | -298 | -201 |
| 60 | Atout | PHD FLOPPER | Homme de Fer | 2000 | -303 | -214 |
| 61 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Homme de Fer | 950 | -319 | -202 |
| 62 | Borne de munitions | Borne de munitions | Saint-Pierre-le-Jeune |  | -155 | -326 |
| 63 | Arme au mur | COLT PYTHON .357 | Saint-Pierre-le-Jeune | 2000 | -131 | -338 |
| 64 | Arme au mur | MP5 | Saint-Pierre-le-Jeune | 1200 | -151 | -345 |
| 65 | Atout | STAMIN-UP | Saint-Pierre-le-Jeune | 2000 | -117 | -347 |
| 66 | Atout | VAUTOUR | Saint-Pierre-le-Jeune | 3000 | -145 | -345 |
| 67 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Pierre-le-Jeune | 950 | -168 | -338 |
| 68 | Borne de munitions | Borne de munitions | Grand'Rue |  | -386 | -8 |
| 69 | Arme au mur | MP5 | Grand'Rue | 1200 | -412 | 24 |
| 70 | Arme au mur | REMINGTON 870 | Grand'Rue | 750 | -381 | 9 |
| 71 | Atout | SPEED COLA | Grand'Rue | 3000 | -388 | -13 |
| 72 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grand'Rue | 950 | -405 | 17 |
| 73 | Borne de munitions | Borne de munitions | Grand Séminaire |  | 300 | -57 |
| 74 | Arme au mur | REMINGTON 870 | Grand Séminaire | 750 | 270 | -49 |
| 75 | Arme au mur | M4A1 | Grand Séminaire | 1200 | 305 | -59 |
| 76 | Atout | RÉANIMATION RAPIDE | Grand Séminaire | 1500 | 332 | -55 |
| 77 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Grand Séminaire | 950 | 325 | -55 |
| 78 | Borne de munitions | Borne de munitions | Palais Rohan |  | 267 | 115 |
| 79 | Arme au mur | AK-47 | Palais Rohan | 1600 | 277 | 118 |
| 80 | Arme au mur | AREX ZERO 1 | Palais Rohan | 700 | 255 | 121 |
| 81 | Atout | DOUBLE TAP | Palais Rohan | 2000 | 266 | 139 |
| 82 | Atout | PIERRE TOMBALE | Palais Rohan | 2000 | 271 | 109 |
| 83 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Palais Rohan | 950 | 260 | 134 |
| 84 | Borne de munitions | Borne de munitions | Musée historique |  | 203 | 208 |
| 85 | Arme au mur | AREX ZERO 1 | Musée historique | 700 | 185 | 208 |
| 86 | Arme au mur | SCAR-H | Musée historique | 2500 | 180 | 233 |
| 87 | Arme au mur | MP40 | Musée historique | 800 | 204 | 213 |
| 88 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Musée historique | 950 | 191 | 216 |
| 89 | Borne de munitions | Borne de munitions | Place Broglie |  | 165 | -342 |
| 90 | Arme au mur | MP40 | Place Broglie | 800 | 151 | -318 |
| 91 | Arme au mur | FAMAS F1 | Place Broglie | 1300 | 133 | -324 |
| 92 | Arme au mur | RPK | Place Broglie | 2500 | 148 | -365 |
| 93 | Atout | MASTODONTE | Place Broglie | 2500 | 142 | -355 |
| 94 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Place Broglie | 950 | 163 | -313 |
| 95 | Borne de munitions | Borne de munitions | Quai Schoepflin |  | -10 | -450 |
| 96 | Arme au mur | DRAGUNOV SVD | Quai Schoepflin | 2000 | -8 | -459 |
| 97 | Arme au mur | MP5 | Quai Schoepflin | 1200 | -31 | -466 |
| 98 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Quai Schoepflin | 950 | -10 | -463 |
| 99 | Borne de munitions | Borne de munitions | Hôtel de Neuwiller |  | -491 | -263 |
| 100 | Arme au mur | FAMAS F1 | Hôtel de Neuwiller | 1300 | -465 | -275 |
| 101 | Arme au mur | SAIGA-12 | Hôtel de Neuwiller | 3000 | -453 | -284 |
| 102 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Hôtel de Neuwiller | 950 | -457 | -287 |
| 103 | Borne de munitions | Borne de munitions | Monument Stoeber |  | -505 | -168 |
| 104 | Arme au mur | SCAR-H | Monument Stoeber | 2500 | -509 | -139 |
| 105 | Arme au mur | FN P90 | Monument Stoeber | 1800 | -489 | -171 |
| 106 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Monument Stoeber | 950 | -463 | -154 |
| 107 | Borne de munitions | Borne de munitions | Ancienne Douane |  | 30 | 349 |
| 108 | Arme au mur | L96A1 | Ancienne Douane | 1750 | 10 | 339 |
| 109 | Arme au mur | REMINGTON 870 | Ancienne Douane | 750 | 13 | 345 |
| 110 | Atout | PHD FLOPPER | Ancienne Douane | 2000 | 40 | 319 |
| 111 | Atout | VEUVE NOIRE | Ancienne Douane | 4000 | 46 | 317 |
| 112 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Ancienne Douane | 950 | 2 | 335 |
| 113 | Borne de munitions | Borne de munitions | Saint-Thomas |  | -242 | 250 |
| 114 | Arme au mur | SAIGA-12 | Saint-Thomas | 3000 | -251 | 248 |
| 115 | Arme au mur | M4A1 | Saint-Thomas | 1200 | -222 | 243 |
| 116 | Atout | MULE KICK | Saint-Thomas | 4000 | -240 | 242 |
| 117 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Thomas | 950 | -264 | 247 |
| 118 | Borne de munitions | Borne de munitions | Église Réformée |  | -317 | 164 |
| 119 | Arme au mur | MP40 | Église Réformée | 800 | -322 | 172 |
| 120 | Arme au mur | AK-47 | Église Réformée | 1600 | -309 | 190 |
| 121 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Église Réformée | 950 | -327 | 159 |
| 122 | Borne de munitions | Borne de munitions | Opéra |  | 247 | -423 |
| 123 | Arme au mur | DESERT EAGLE | Opéra | 1500 | 259 | -444 |
| 124 | Arme au mur | MG42 | Opéra | 4000 | 241 | -454 |
| 125 | Atout | SPEED COLA | Opéra | 3000 | 275 | -463 |
| 126 | Atout | ULTIME VOLONTÉ | Opéra | 4000 | 279 | -446 |
| 127 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Opéra | 950 | 266 | -442 |
| 128 | Borne de munitions | Borne de munitions | Préfecture |  | 407 | -357 |
| 129 | Arme au mur | PKM | Préfecture | 3200 | 422 | -350 |
| 130 | Arme au mur | M4A1 | Préfecture | 1200 | 420 | -343 |
| 131 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Préfecture | 950 | 415 | -356 |
| 132 | Borne de munitions | Borne de munitions | Saint-Étienne |  | 544 | -109 |
| 133 | Arme au mur | M249 SAW | Saint-Étienne | 3000 | 534 | -120 |
| 134 | Arme au mur | SCAR-H | Saint-Étienne | 2500 | 538 | -82 |
| 135 | Atout | STAMIN-UP | Saint-Étienne | 2000 | 518 | -99 |
| 136 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Étienne | 950 | 527 | -59 |
| 137 | Borne de munitions | Borne de munitions | Saint-Pierre-le-Vieux |  | -610 | -32 |
| 138 | Arme au mur | DESERT EAGLE | Saint-Pierre-le-Vieux | 1500 | -593 | -34 |
| 139 | Arme au mur | REMINGTON 870 | Saint-Pierre-le-Vieux | 750 | -626 | -40 |
| 140 | Atout | RÉANIMATION RAPIDE | Saint-Pierre-le-Vieux | 1500 | -620 | -39 |
| 141 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Saint-Pierre-le-Vieux | 950 | -640 | -44 |
| 142 | Borne de munitions | Borne de munitions | Petite France |  | -696 | 148 |
| 143 | Arme au mur | BARRETT M82 | Petite France | 5000 | -702 | 146 |
| 144 | Arme au mur | SAIGA-12 | Petite France | 3000 | -683 | 137 |
| 145 | Arme au mur | MP5 | Petite France | 1200 | -689 | 141 |
| 146 | Atout | MASTODONTE | Petite France | 2500 | -674 | 116 |
| 147 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Petite France | 950 | -671 | 128 |
| 148 | Borne de munitions | Borne de munitions | Quais |  | -1020 | -351 |
| 149 | Arme au mur | COLT M1911 | Quais | 400 | -1055 | -290 |
| 150 | Arme au mur | REMINGTON 870 | Quais | 750 | -1012 | -364 |
| 151 | Borne de munitions | Borne de munitions | Hall de la Gare |  | -1044 | -295 |
| 152 | Arme au mur | MP5 | Hall de la Gare | 1200 | -1013 | -337 |
| 153 | Atout | RÉANIMATION RAPIDE | Hall de la Gare | 1500 | -1009 | -333 |
| 154 | BOÎTE MYSTÈRE (emplacement possible) | BOÎTE MYSTÈRE (emplacement possible) | Hall de la Gare | 950 | -1034 | -290 |
| 155 | Borne de munitions | Borne de munitions | Place de la Gare |  | -935 | -385 |
| 156 | Arme au mur | FAMAS F1 | Place de la Gare | 1300 | -975 | -396 |
| 157 | Atout | STAMIN-UP | Place de la Gare | 2000 | -1066 | -232 |
| 158 | Borne de munitions | Borne de munitions | Quai des Bateliers |  | 931 | 155 |
| 159 | Arme au mur | MP5 | Quai des Bateliers | 1200 | 937 | 160 |
| 160 | Arme au mur | AK-47 | Quai des Bateliers | 1600 | 934 | 148 |
| 161 | Borne de munitions | Borne de munitions | Saint-Guillaume |  | 1052 | 168 |
| 162 | Arme au mur | SCAR-H | Saint-Guillaume | 2500 | 1055 | 157 |
| 163 | Atout | DOUBLE TAP | Saint-Guillaume | 2000 | 1047 | 163 |
| 164 | Borne de munitions | Borne de munitions | Place de Zurich |  | 929 | 327 |
| 165 | Arme au mur | FAMAS F1 | Place de Zurich | 1300 | 924 | 331 |
| 166 | Arme au mur | SAIGA-12 | Place de Zurich | 3000 | 929 | 320 |
| 167 | Borne de munitions | Borne de munitions | Manufacture des Tabacs |  | 1032 | 336 |
| 168 | Arme au mur | MG42 | Manufacture des Tabacs | 4000 | 1038 | 334 |
| 169 | Atout | MASTODONTE | Manufacture des Tabacs | 2500 | 1031 | 329 |

## Fin de partie : L'Heure du Jugement (horloge astronomique, intérieur de la cathédrale)

| Réglage | Valeur | Unité |
|---|---|---|
| Manche minimale | 12 |  |
| Zones ouvertes au moins | 18 | (les 10 zones d'origine + 8 zones extérieures ou de la gare) : l'horloge affiche « n/18 quartiers ouverts » |
| Prix | 0 | pts |
| Santé du Bourreau (1 joueur) | 350000 | (+70 % par joueur en plus) |
| Zombies simultanés (vague) | 28 |  |
| Répit entre deux vagues | 8 | s |

## Le Bourreau : phases, attaques et sensibilités

| Réglage | Valeur | Remarque |
|---|---|---|
| Phases | I (100 -> 70 %) LE BOURREAU · II (70 % -> 45 %) LA SENTENCE · III (45 % -> 20 %) SUR LE TOIT · IV (20 % -> 0) LE JUGEMENT | barre de vie coupée à chaque seuil ; invulnérable pendant les transitions (barre grise « INVULNÉRABLE ») |
| Vitesse par phase | 2,2 / 2,4 / 2,7 / 3,3 | m/s |
| Coups de base | hache 45, ruée 55, onde de choc 40 | ruée annoncée 1,15 s ; on évite l'onde en sautant |
| Sensibilités | face (tête comprise) x0,75 · dos (lanterne-cœur) x2 (x2,5 pour les joueurs que la Sentence ne vise pas) · zone x0,25 · pistolet à rayons (tir direct) x0,35 · étourdi x1,5 | le dos : produit scalaire (direction du boss vers le point d'impact, cap du boss) < -0,3 |
| Chaînes (toutes phases) | annoncées 0,9 s, 25 dégâts, attirent de 5 m | recharge 10 s ; portée 8 à 24 m |
| Le Glas (transition 70 %) | 10 s d'invulnérabilité, 3 ondes à 1,2 s, 35 dégâts chacune | 2 chevaliers de fer + 4 zombies (+2 par joueur en plus) ; phase IV : Glas toutes les 25 s, sans invulnérabilité |
| La Sentence (phase II) | joueur marqué 8 s (couronne rouge), dégâts reçus x1,5 | le Bourreau ne poursuit que lui, à 3 m/s ; renforts toutes les 20 s ; bond vers la tour à 45 % |
| Le Couperet (phase III) | hache lancée aller-retour, annoncée 1,2 s, 50 dégâts, couloir 1,5 x 18 m | ruée toutes les 5 s |
| Le Bûcher (phase IV) | 3 cercles de feu (+1 par joueur en plus), rayon 2,5 m, annoncés 1,5 s, 15 dégâts/s pendant 6 s | rage : vitesse 3,3 m/s ; après 10 min de combat, tous ses coups x1,5 |
| Récompense | 10000 points + Hache du Bourreau (remplace le couteau : dégâts x3, touche 2 zombies) | Max Munitions lâché à sa mort |

## Maître Tanneur (mini-boss : Petite France ou Saint-Pierre-le-Vieux)

| Réglage | Valeur | Remarque |
|---|---|---|
| Apparition | manches 15, 20, 25… (toutes les 5) | si l'une des zones Petite France / Saint-Pierre-le-Vieux est ouverte |
| Santé | 30 x la santé d'un zombie de la manche (18060 à la manche 15) | +50 % par joueur en plus |
| Vitesse / coup | 2 m/s / 30 |  |
| Vomi | cône de 8 m (demi-angle 32°), annoncé 0,8 s : 20 dégâts puis 5/s pendant 4 s | le PHD Flopper ne protège pas ; recharge 8 s |
| Appel | 3 pestiférés | recharge 20 s |
| À sa mort | explosion de rayon 6 m : 60 dégâts | le PHD Flopper protège |
| Récompense | Max Munitions + 1500 points par joueur |  |

## Acte V « L'Aube » (après la victoire sur le Bourreau : montée de la flèche, Fanal d'Erwin)

| Étape | Valeur | Remarque |
|---|---|---|
| Ascension | faisceau de lumière depuis la pointe : plateforme 67,5 m -> escalier 3 tours -> terrasse 104 m -> rampe 6 tours -> pointe 128 m | texte : « La flèche s'illumine : montez allumer le Fanal d'Erwin » ; les manches sont suspendues pendant tout l'acte |
| 1. Gargouilles (terrasse) | 24 zombies de pierre (+6 par joueur en plus), 10 simultanées, une toutes les 1,1 s | coureurs (vitesse x1,5, vie x1,2, armure x0,8) qui surgissent des parapets à plus de 5 m des joueurs (0,7 s d'apparition) |
| 2. L'Ange du Jugement | 40000 PV (+70 % par joueur en plus) ; tourne hors de la tour, cercle de 14 m à 106 m, 10°/s | point faible : la trompette (x2, quelle que soit l'arme) ; récompense 5000 points par joueur |
| Trompette | cône de 10 m (demi-angle 20°), annoncé 1 s, 40 dégâts | recharge 7 s ; la flèche protège |
| Plumes | éventail de 5 plumes (12° d'écart), annoncé 0,7 s, 15 dégâts chacune | recharge 5 s ; arrêtées par la flèche |
| Jugement | un joueur est marqué 3 s puis frappé d'un rayon : 70 dégâts | dès 60 % de vie ; recharge 16 s ; on se cache derrière la flèche |
| 3. La rampe | rafale toutes les 6 s : poussée de 2,5 m/s pendant 1 s (annoncée 0,8 s) | les garde-corps et la paroi retiennent ; 2 gargouilles montent toutes les 7 s (6 au plus) |
| 4. Le Fanal d'Erwin | chaque joueur debout maintient la touche d'interaction 6 s à moins de 3,2 m | jauge commune : avance de (joueurs qui tiennent / joueurs debout) x 1/6 par seconde, retombe quand personne ne tient |
| 5. L'Aube | ciel : nuit -> jour en 30 s (fond, brouillard, lumières) ; tous les zombies en cendres ; vue orbitale 12 s (Échap la passe) ; écran « STRASBOURG LIBÉRÉE » et statistiques | aucun nouveau shader |
| Récompenses | Bénédiction de l'Aube : les 7 atouts, gardés même à terre ; toutes les portes restantes gratuites ; trophée enregistré localement (localStorage) | les joueurs à terre sont relevés |
| Nuit éternelle | le jour dure 60 s, puis la nuit retombe en 20 s ; zombies x1,3 de vie dès la manche suivante | les manches reprennent sans fin |

## Tram : réseau de voies (rails, quais, poteaux de caténaire, heurtoirs ; tracés à la main dans CONFIG.tram.lines)

| Ligne | Longueur | Arrêts (abscisse depuis le heurtoir de départ) | Remarque |
|---|---|---|---|
| A / D (AD) | 802 m | Place Kléber (238 m) · Langstross Grand'Rue (471 m) · Saint-Nicolas (718 m) | rayon de courbure minimal 40 m ; un heurtoir à chaque bout |
| B / C / F (BCF) | 1119 m | Alt Winmärik (133 m) · Homme de Fer (421 m) · Broglie (833 m) · Opéra (1088 m) | rayon de courbure minimal 28 m ; un heurtoir à chaque bout |
| Largeur libre | 6,5 m | de part et d'autre de l'axe, vérifiée sur la grille de navigation | décor (voitures, barricades) à 5 m de l'axe au moins ; arbres et lampadaires écartés du couloir |
| Portes de zone | feu rouge | une porte fermée qui coupe une voie est un heurtoir signalé par un feu (vert une fois ouverte) | la rame freine d'elle-même à 15 m ; l'ouvrir libère le tronçon |
| Rendu | rails : 1 appel (InstancedMesh) | quais + heurtoirs + mâts : 1 appel ; poteaux : 1 appel ; fils + feux : 1 appel | 12 m entre deux poteaux, côtés alternés |

## Tram : la rame conduisible (une seule, garée au quai « Homme de Fer » de la ligne B / C / F ; les rames de décor ne roulent pas)

| Réglage | Valeur | Remarque |
|---|---|---|
| Rame | 5 modules de 4,7 m (23,5 m), 2,4 x 3,4 m, plancher à 0,32 m | articulés : chaque module suit la voie ; cabine à chaque bout ; 4 portes de 1,3 m par côté |
| Places | 16 : 2 de conducteur (une par cabine) + 14 de passagers assis | les passagers tirent normalement (comme sur la grosse moto) ; portes fermées, la place de conducteur se prend près d'un bout de la rame, les autres près de la caisse (voir l'intérieur praticable ci-dessous) |
| Montée / descente | E ou marcher contre une porte ouverte (rame à moins de 1,5 m/s) | à pied par les portes ouvertes ; assis, on se lève dans la rame ; descendre en marche est refusé |
| Conduite | W accélérer · S frein de service (puis marche arrière) · Espace frein d'urgence | touches modifiables dans Options > Touches ; conducteur de la cabine arrière : la rame roule dans l'autre sens |
| Vitesse max | 14 m/s (50 km/h) ; marche arrière 4 m/s | accélération 1,3 m/s² (qui faiblit près du maximum), résistance 0,2 m/s² |
| Freinage | service 1,8 m/s² · urgence 3 m/s² |  |
| Virages | vitesse plafonnée à racine(1 x R) m/s (R = 25 m : 18 km/h) avec une alarme | la rame freine d'elle-même (2,5 m/s²) en regardant 70 m devant ; pas de déraillement |
| Portes de zone fermées, heurtoirs | freinage automatique à 15 m ou plus tôt si la vitesse l'exige (urgence 3 m/s²), arrêt à 2,5 m de la porte | ouvrir la porte libère le tronçon ; le nez s'arrête à 1,2 m du heurtoir |
| Portes de la rame | O (conducteur) à moins de 1,2 m/s, 1,2 s, carillon | pas de traction portes ouvertes ; elles se referment si la rame roule |
| Énergie | sous-station de l'Homme de Fer : 2000 pts, une seule fois pour toute l'équipe | E près du kiosque jaune ; ensuite la conduite est gratuite ; sans courant, la rame ne démarre pas |
| Gong | H (tout occupant) : zombies à moins de 50 m attirés pendant 8 s | recharge 3 s ; ils prennent la rame pour cible du champ de flux (sauf s'ils sont déjà sur un joueur) |
| Caméra | V : 3e personne (bras 12 m) / 1re personne dans la cabine | même vue que pour les motos |
| PV | 3000 | coup de zombie sur la caisse : 2 PV ; passagers touchés seulement devant une porte ouverte ; à 0 PV : hors service, retour au dépôt 2 manches plus tard |
| Joueur à pied heurté | repoussé ; 10 dégâts au-dessus de 5 m/s | jamais mortel (il reste 1 PV) |
| Zombie heurté | au-dessus de 3 m/s : 40 x vitesse (560 à la vitesse max) ; en dessous : aucun dégât, il bloque la rame | la rame ne ralentit pas ; un coup toutes les 0.5 s au même zombie |
| Obstacles | une boîte orientée par module, obstacles dynamiques de Collision (setDynamic) | les joueurs à pied, les zombies et les motos sont repoussés ; les balles traversent |

## Tram : l'intérieur praticable (on marche dans la rame, même quand elle roule)

| Réglage | Valeur | Remarque |
|---|---|---|
| Repère de la rame | u le long de la rame (+ vers l'avant), w à droite, y hauteur des pieds | le joueur debout est un point (u, w) de la voie à l'abscisse s + u : il suit la rame sans glisser, modules articulés compris ; réseau : p_state porte vh (identifiant de la rame), lx = w, ly = y, lz = -u, lyw (cap relatif) |
| Collision locale | cercle de 0,3 m contre des boîtes (sièges, pupitres, bouts, parois à 1,15 m de l'axe) | allée entre les banquettes étroite ; plancher à 0,32 m ; pas de saut ni d'enjambement dans la rame |
| Monter à pied | rame à moins de 1,5 m/s, portes ouvertes à plus de 60 % | pousser contre une porte ouverte (à moins de 1,78 m de l'axe) ou E à moins de 2,4 m d'une porte |
| Descendre à pied | dépasser 1,45 m de l'axe dans une ouverture | refusé tant que la rame roule (message « TRAM EN MARCHE ») ; les portes ne s'ouvrent qu'à l'arrêt |
| S'asseoir / se lever | E à moins de 1,35 m d'un siège libre ; E assis : on se lève dans la rame | conducteur ou passager ; les coéquipiers voient l'avatar assis ou debout |
| Portes (touche) | O : conducteur ; sinon, quand personne ne conduit, n'importe quel occupant (via l'hôte) | H : gong depuis l'intérieur aussi |
| Zombies | ne rentrent pas dans la rame et ne la traversent pas | une porte ouverte les attire (ils se massent devant, à 0,55 m de la caisse) ; ils frappent le joueur à moins de 1,3 m ; ailleurs la caisse encaisse (2 PV) |
| Tir, grenades, couteau, réanimation | comme à pied | la grenade garde la vitesse de la rame, ignore la caisse et rebondit sur le plancher ; pas de fente du couteau |
| Menu mods / triche (F9) | F9 : menu mods et téléportation (coéquipiers, zones, armes, atouts, déblocage) | accessible en jeu et depuis le menu pause |

## Gare : le train régional à quai (quai 1, portes ouvertes) et les voies SNCF

| Réglage | Valeur | Remarque |
|---|---|---|
| Composition | locomotive undefined m + undefined voitures de undefined m (NaN m), 2,9 m de large, plancher à 0,78 m au-dessus du rail | numéro « 17412 », sans marque ; nez de la locomotive à u = 47,5 m (repère de la gare), entre les passerelles |
| Repère | une position s sur l'itinéraire ; chaque voiture est rigide entre ses pivots de bogies (undefined m, locomotive undefined m) | u le long du train (continu d'une voiture à l'autre), w à droite ; mêmes messages réseau que le tram (p_state vh, lx, ly, lz, lyw) |
| Intérieur | sièges 2+2 en carrés, cloisons de vestibule (porte 1 m), intercirculations de 1,3 m, WC, porte de cabine verrouillée | cercle de 0,3 m contre des boîtes ; seules la voiture courante et ses voisines sont testées |
| Monter / descendre | pousser contre une porte ouverte côté quai (à moins de 2,35 m de l'axe) ou E ; descendre : dépasser 1,55 m dans une porte | posé sur le quai à 2,25 m de l'axe ; les portes côté voie restent fermées |
| Zombies | ceux de la gare montent par la porte la plus proche (à 0,75 m de la caisse), puis suivent l'allée jusqu'au joueur | vitesse x 0,9 dans le train ; ils redescendent quand leur cible est sortie ; de l'extérieur, la caisse encaisse sauf devant une porte ouverte |
| Tir, grenades | les balles traversent les fenêtres (et la caisse) ; la grenade rebondit sur les parois, le plafond et les bouts du train | elle se pose sur le plancher de la voiture |
| Voies | profil de rail extrudé (0,15 m), traverses tous les 0,6 m, prisme de ballast 3,1 / 4,9 m | itinéraire du sud-ouest lissé ; la voie du quai 1 est décalée pour laisser 0,2 m entre la caisse et le bord du quai |
| Caténaire | poteaux tous les 55 m à 3,1 m de l'axe, fil de contact à 5,6 m, porteur à 6,9 m | hors de la gare, en tronçons de 200 m (une maille par matériau et par tronçon, sans ombres) |
| Débogage | ?debug&gare&train : debout dans l'allée de la voiture du milieu |  |

## Départ : l'intro en train (arrivée en gare de Strasbourg)

| Réglage | Valeur | Remarque |
|---|---|---|
| Départ par défaut | intro en train | menu « Départ » : intro en train / Gare Centrale / Classique (Grande Île) ; le choix est retenu ; ?debug seul garde le départ classique, ?debug&intro lance l'intro |
| Trajet | 5965 m en 267 s depuis le sud-ouest, arrêt au quai 1 | vitesses (s : km/h) 0 : 100 · 160 : 100 · 172 : 80 · 198 : 80 · 208 : 15 · 224 : 15 · 232 : 50 · 250 : 50 · 267 : 0 ; la position du train ne dépend que de l'horloge de l'intro |
| Ouverture | carton noir « TRAIN RÉGIONAL 17412 — DIRECTION STRASBOURG » (4 s, fondu 2,5 s) | nuit : l'horloge reste à 4.9 h pendant le trajet (le cycle jour / nuit reprend ensuite) |
| Annonces | 6 s : Mesdames et messieurs, bienvenue à bord de ce train régional à destination de Strasbourg. · 78 s : Prochain arrêt : Strasbourg-Ville, terminus. Ce train ne dessert ni Lingolsheim ni Koenigshoffen. · 138 s : Mesdames et messieurs, dans quelques minutes notre train arrivera en gare de Strasbourg, son terminus… · 146 s : … (grésillements — des cris dans le haut-parleur) … · 198 s : RALENTISSEMENT — Obstacle sur la voie · 205 s : ILS S'ACCROCHENT AUX FENÊTRES ! — Abattez-les avant qu'ils ne montent · 227.6 s : (des pas sur le toit…) · 251 s : Strasbourg. Strasbourg, terminus de ce train. | à l'arrivée : « STRASBOURG — Terminus. Tout le monde descend. » |
| Dans le train | debout en voiture 2 et 3 (arrivants en cours de route : voiture 2), portes verrouillées | on marche dans l'allée et les intercirculations en roulant ; balancement de la caméra 0,4° / 0,015 m, secousse à chaque joint de rail (25 m) |
| Arrivée | portes ouvertes en 1,6 s ; manche 1 5 s après l'arrêt (zone Quais) | 2 zombies sortent du ballast sur le quai (hors décompte ; la manche 1 finit quand ils sont morts aussi) ; les zombies encore à bord poursuivent les joueurs ou descendent par une porte ouverte |
| Zombies du trajet | 4 le long de la voie (2 sur la voie), 6 au bord de la voie au ralentissement, 6 aux fenêtres, 3 par l'intercirculation | solo ; x (1 + 0,75 par joueur en plus) comme une manche ; vie de la manche 1 (100 PV) ; points habituels par zombie tué |
| Le long de la voie | 184 à 199 s (80 km/h), à 3,8-9 m de l'axe | ceux qui sont sur la voie sont percutés par la locomotive (choc, sang sur la cabine, 0 pt) au-dessus de 3 m/s |
| Fenêtres | ils s'accrochent 3 s (la vitre se fend), la brisent (elle reste cassée, vent) puis entrent en 1,2 s | au plus 4 accrochés à la fois (8 à 4 joueurs) ; ils courent le long du train à 6 m/s au plus : un train plus rapide les sème ; on peut les abattre ou les poignarder à la fenêtre |
| Toit et intercirculation | pas sur le toit de la dernière voiture à 227 s, porte arrière forcée à 235.5 s | puis un zombie toutes les 1,6 s par l'intercirculation |
| Passer l'intro | maintenir Espace 1,5 s | solo : le joueur ; coop : l'hôte seulement ; le train arrive à quai, portes ouvertes ; les zombies du trajet disparaissent |
| Grenades dans le train | simulées dans le repère de la voiture | elles gardent la vitesse du train, rebondissent sur les parois, les sièges et le plafond, et restent posées au freinage |
| Décor du trajet | clôtures, 520 arbres, 700 buissons, 90 bâtiments, 90 lampadaires, signaux, wagons déraillés à 216 s | instanciés, en tronçons de 300 m dessinés à moins de 190 m ; sol sombre de 460 m autour de la caméra |
| Réseau | l'hôte envoie tn_sync (τ, phase) toutes les 0,5 s ; intro_skip | le client avance τ lui-même et rattrape l'hôte (+ demi-ping, plafonné à 0,5 s) ; arrivant : sync.intro ; zombies du trajet : z_spawn + tn, positions dans le repère du train (z_tick), tn_win, tn_rk, tn_rm |

## Tram : l'aiguillage du nœud de Homme de Fer (croisement des lignes A / D et B / C / F)

| Réglage | Valeur | Remarque |
|---|---|---|
| Nœud | croisement de AD et BCF (-308 ; -238) | 4 bras : Pont de Paris (A / D) · Langstross / St-Nicolas (A / D) · Alt Winmärik (B / C / F) · Broglie / Opéra (B / C / F) |
| Raccord Alt Winmärik (B / C / F) <-> Langstross / St-Nicolas (A / D) | arc de rayon 25 m, virage de 71° (31 m) | vitesse plafonnée à 18 km/h comme tout virage ; se parcourt dans les deux sens |
| Raccord Pont de Paris (A / D) <-> Broglie / Opéra (B / C / F) | arc de rayon 30 m, virage de 65° (34 m) | vitesse plafonnée à 20 km/h comme tout virage ; se parcourt dans les deux sens |
| Sorties de chaque bras | tout droit, ou le raccord de ce bras | les deux autres virages (plus de 100°) sont impossibles : quai de l'Homme de Fer, rotonde |
| Choix | B (conducteur assis) : tout droit / dévié | réglage unique pour toute l'équipe, effectif tant que le nez est à plus de 3 m du point de divergence (verrouillé ensuite) ; une rame entièrement sur un bras prend la voie choisie, sans saut |
| Indications | à l'écran : « AIGUILLAGE > TOUT DROIT / DÉVIÉ : direction », verrou et distance ; sur la voie : un signal à trois feux par bras | feu ambre fixe, feu blanc en haut au centre (tout droit) ou du côté du virage (dévié) ; raccords gris sur la carte |
| Itinéraires | chaque virage est une voie complète (ligne d'arrivée, arc, ligne de départ) qui suit exactement les lignes hors de l'arc | la rame change de voie par reprojection de son centre (même géométrie) ; portes de zone et rames de décor sont des butées sur chaque voie |
| Réseau | t_state : k (voie) et sw (réglage) ; instantané des arrivants : idem | chaque machine suit la voie du conducteur sans saut visuel |
| Quai de l'Homme de Fer | déplacé de 13 m vers l'ouest et raccourci (22 m) pour laisser la place au raccord | la rame y est garée, le nez à 8 m du point de divergence |

## Motos (deux parkings au panneau bleu « P », avec chacun une borne plein + réparation : place Gutenberg, 2 motos ; place Broglie, 1 moto)

| Réglage | MOTO | GROSSE MOTO | VOITURE GT | 4X4 TOUT-TERRAIN | Unité |
|---|---|---|---|---|---|
| Places | 1 | 2 | 2 | 4 |  |
| Points de vie | 300 | 500 | 1400 | 2400 | PV |
| Vitesse max | 110 | 95 | 140 | 105 | km/h |
| Réservoir | 6 | 10 | 40 | 55 | L |
| Autonomie à fond | 3 | 4 | 13,3 | 15,8 | min |
| Seuil d'écrasement | 32 | 25 | 14 | 13 | km/h (en dessous : aucun dégât, un zombie arrête la moto) |
| Dégâts d'écrasement au seuil / à la vitesse max | 58 / 488 | 67 / 636 | 83 / 2028 | 101 / 2102 | PV de zombie |
| Usure par écrasement | 5 (zombie tué) / 12 (survivant) | idem | idem | idem | PV de la moto |
| Choc contre un objet physique (voiture, mobilier, arbre, machine…) | (vitesse perdue - 6) x 5 | idem | idem | idem | PV de la moto |
| Choc contre un mur (façade, quai, parapet, porte, marche, bord de l'île) | aucun dégât pour la moto | idem | idem | idem | le pilote se blesse comme pour un objet |
| Choc contre une autre moto | (vitesse d'approche - 4) x 4, pour chacune ; rebond 1.3 x la vitesse vers l'autre | idem | idem | idem | PV de la moto (la moto garée est un obstacle fixe) |
| Coup de zombie sur un occupant | 10 | idem | idem | idem | PV de la moto (le joueur perd 20) |
| Explosion proche (grenade, M79…) | 10 % des dégâts infligés aux zombies | idem | idem | idem |  |
| À 0 PV | feu 2 s, explosion (rayon 5 m, 1000 aux zombies, jusqu'à 50 aux joueurs sans jamais les tuer), épave 20 s | idem | idem | idem |  |
| Retour au parking | 2 manches après la destruction, PV pleins, 40 % d'essence | idem | idem | idem |  |
| Borne du parking (à pied, moto à moins de 8 m) | 50 pts par litre + 2 pts par PV | idem | idem | idem | plein + réparation |
| Bidon d'essence (bonus) | +2,5 L, 3 % par zombie tué si une moto est sous 50 % | idem | idem | idem |  |
| Panne sèche | réserve < 15 % : bip, ratés < 5 %, à 0 : poussée 3 m/s | idem | idem | idem |  |

## Vélos (gratuits, 14 stations et 16 vélos : arceaux et panneau « VÉLOS » turquoise, pastille « V » sur la carte)

| Réglage | Valeur | Unité / remarque |
|---|---|---|
| Places | 1 | le cycliste ne tire pas (comme le conducteur d'une moto) ; pas de sonnette, pas de nouvelle touche |
| Points de vie | 150 | PV |
| Vitesse max | 43 | km/h (accélération 4,5 m/s², frein 10 m/s², marche arrière 1,2 m/s) |
| Conduite | WASD accélérer, freiner / reculer, tourner ; Espace frein ; V vue ; E monter / descendre | les mêmes touches que les motos ; la touche du gong du tram (H) ne fait rien à vélo |
| Réservoir | aucun | ni jauge, ni panne sèche, ni borne, ni bidon |
| Écrasement | jamais | un zombie au contact arrête le vélo net, sans dégât pour lui |
| Chute du cycliste | (vitesse perdue - 6) x 4, au plus 25 | PV du cycliste (jamais mortel ; le PHD Flopper protège) |
| Choc contre un objet physique (voiture, mobilier, arbre, machine…) | (vitesse perdue - 6) x 5 | PV du vélo |
| Choc contre un mur (façade, quai, parapet, porte, marche, bord de l'île) | aucun dégât pour le vélo | le cycliste se blesse pareil (chute ci-dessus) |
| Choc contre une moto ou un autre vélo | (vitesse d'approche - 4) x 4, pour chacun | PV (un vélo ou une moto garés sont des obstacles fixes) |
| Coup de zombie sur un occupant | 10 | PV du vélo (le joueur perd 20) |
| Explosion proche (grenade, M79…) | 10 % des dégâts infligés aux zombies |  |
| À 0 PV | vélo CASSÉ : ni incendie ni explosion, le cycliste chute sans dégât ; épave 10 s |  |
| Retour à la station | 1 manche après la casse, PV pleins, gratuit | si personne n'est à moins de 1,5 m de l'emplacement |
| Station | 1 à 2 vélos, arceaux tous les 1 m, panneau « VÉLOS » ; posée après tout le décor | contrôles : dans sa zone, accessible et dégagée, à 8 m au moins d'une porte, à 5 m d'un rail, à 6 m d'une borne, d'un atout ou d'une arme murale (leur invite masquerait « monter ») |
| Rendu | 5 maillages par vélo, aucune lumière ; vélos et stations non dessinés au-delà de 90 m | les ~100 vélos de décor (mobilier OpenStreetMap) restent du décor : on ne peut pas les enfourcher |

## Stations de vélos (14 stations, 16 vélos)

| N° | Zone | x (m) | z (m) | Vélos |
|---|---|---|---|---|
| 1 | Temple-Neuf | -41 | -88 | 1 |
| 2 | Rue des Orfèvres | 27 | -55 | 1 |
| 3 | Rue du Dôme | 102 | -148 | 1 |
| 4 | Grandes Arcades | -128 | -10 | 1 |
| 5 | Place Kléber | -246 | -145 | 1 |
| 6 | Place Gutenberg | -27 | 93 | 2 |
| 7 | Saint-Pierre-le-Jeune | -144 | -336 | 1 |
| 8 | Grand'Rue | -382 | 16 | 1 |
| 9 | Place Broglie | 146 | -350 | 2 |
| 10 | Quai Schoepflin | -13 | -469 | 1 |
| 11 | Ancienne Douane | 32 | 330 | 1 |
| 12 | Saint-Thomas | -195 | 227 | 1 |
| 13 | Opéra | 281 | -464 | 1 |
| 14 | Préfecture | 419 | -297 | 1 |

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
| Bourreau | 150 fixes | x 0,75 de face, x 2 dans le dos (les mêmes sensibilités que les balles) |
| Hache du Bourreau | dégâts x3, touche 2 zombies | récompense de la finale : remplace le couteau |
| Points | 10 par touche, 100 par mort |  |

## Enjambement

| Réglage | Valeur | Unité / remarque |
|---|---|---|
| Enjambement | Espace face à un obstacle enjambable | à moins de 0,9 m, de face (moins de 45°), profondeur traversée 1,3 m au plus, case d'arrivée libre à ±0,3 m, dans une zone OUVERTE (jamais de contournement d'une porte payante) |
| Durée | 0,5 | s (caméra +0,6 m, arme baissée, pas de tir) |
| Enjambables (hauteur <= 1,15 m) | banc, poubelle, jardinière, caisse seule, borne, vélos (profondeur <= 1,3 m), sacs de sable, barrière de foule, bloc béton |  |
| On marche dessus | palette (0,2 m) |  |
| Non enjambables | voiture, fontaine, chalet, caisses empilées, porte payante, barricade scellée, parapet de quai, machines, bornes de munitions, garde-corps de la cathédrale |  |

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
| E | Acheter, ouvrir une porte, utiliser une machine ou la borne des motos, réanimer (maintenir), monter / descendre d'une moto ou d'un vélo |
| ZQSD / WASD (en moto ou à vélo) | Accélérer, freiner / reculer, tourner |
| Espace (en moto ou à vélo) | Frein à main (frein à vélo) |
| V (en moto ou à vélo) | Vue à la 3e personne / à la 1re personne |
| WS / Espace (en tram, conducteur) | Accélérer / frein de service puis marche arrière ; frein d'urgence |
| O / H (en tram) | Ouvrir ou fermer les portes (conducteur, à l'arrêt) ; gong qui attire les zombies |
| B (en tram, conducteur) | Aiguillage : tout droit / dévié au nœud de l'Homme de Fer |
| F | Lampe torche |
| Espace (devant un obstacle bas) | Enjamber |
| V (à pied) | Coup de couteau (aussi : clic gauche quand le chargeur et la réserve sont vides) |
| M | Carte |
| Clic molette | Lance-grenades sous le canon (fusil d'assaut Pack-a-Punch niveau III) |
| Entrée | Chat écrit (multijoueur) : ouvre la saisie en bas à gauche ; Entrée envoie, Échap annule ; aucune autre touche n'agit pendant la saisie (200 caractères, 5 messages par 4 s ; option « Afficher le chat » dans Options) |
| Échap | Ferme la saisie du chat, la carte ou le menu mods ; sinon menu pause (reprise : Échap, ou clic si le navigateur refuse) ; ferme aussi la capture d'une touche dans Options > Touches |
| F9 | Menu Mods & Triche : godmode, munitions infinies, téléportation, armes (PaP 0-III), atouts, points, portes, zombies |

### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : trois niveaux, chacun payé par le joueur avec ses propres points et améliorant l'arme déjà améliorée (le niveau III est refusé au-delà). Dégâts ×2,5 / ×3,5 / ×5 (pistolet à rayons ×1,6 / ×2,2 / ×3), tête ×1,2 / ×1,3 / ×1,4, zombies traversés +2 / +3 / +4, chargeur ×1,5 (puis ×1,33 avec l'accessoire aux niveaux II et III), réserve ×1,5 / ×2 / ×2,5, rechargement ×0,85 (II) / ×0,75 (III), dispersion ×0,85 / ×0,7, prix des munitions au mur ×3 / ×4 / ×5. Reflet de l'arme : violet, bleu, or-rouge pulsant (III) ; des accessoires s'ajoutent à chaque niveau.
- **Atouts** : on les perd tous quand on tombe à terre.
