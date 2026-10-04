# Zombie Survival — fiche de référence

Version du jeu : **v0.8.1 · 0eba322 · 2026-10-04** (package 0.8.1). Générée automatiquement par `node tools/make-docs.mjs` à partir de `src/config.js` et du jeu.
Carte annotée : [carte.png](carte.png). Les mêmes tableaux en tableur : dossier [csv/](csv/).

Pour demander une modification, citez la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts », « mettre la boîte mystère dans la zone Temple-Neuf »).

## Secteur jouable

Seul le secteur autour de la place du Marché-Neuf est ouvert ; le reste de la Grande Île est visible mais fermé par des barricades « ZONE FERMÉE ».
Il est découpé en 8 zones, chacune construite autour d'un vrai lieu : chaque rue va à la zone la plus proche à pied (jusqu'à 95 m), et les portes se trouvent entre deux zones.
Prix des portes : 750 pts pour une zone voisine du départ, +250 par zone plus loin. Le contenu de chaque zone se règle dans `src/config.js` → `sector.zones[].items`.

## Armes

| id | Arme | Type | Dégâts par balle | Plombs par tir | Multiplicateur tête | Cadence (tirs/s) | DPS approx. | Chargeur | Réserve départ | Réserve max | Rechargement (s) | Dispersion | Portée (m) | Zombies traversés | Explosion rayon (m) | Explosion dégâts | Prix au mur (pts) | Prix munitions (pts) | Où l'obtenir |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rifle | FUSIL D'ASSAUT | automatique | 36 | 1 | 2,5 | 9,5 | 342 | 30 | 120 | 180 | 1,8 | 0,012 | 90 | 1 |  |  | départ | 300 | arme de départ |
| shotgun | FUSIL À POMPE | pompe | 26 | 8 | 1,8 | 1,3 | 270,4 | 6 | 30 | 48 | 2,4 | 0,046 | 35 | 1 |  |  | 750 | 350 | mur Marché-Neuf, mur Grandes Arcades, boîte mystère |
| smg | PISTOLET-MITRAILLEUR | automatique | 24 | 1 | 2,2 | 13,5 | 324 | 32 | 128 | 224 | 1,5 | 0,022 | 65 | 1 |  |  | 1000 | 500 | mur Marché-Neuf, mur Rue des Orfèvres, boîte mystère |
| lmg | MITRAILLEUSE RPK | automatique | 44 | 1 | 2 | 10,5 | 462 | 75 | 300 | 450 | 3,6 | 0,028 | 90 | 1 |  |  | 2500 | 1000 | mur Place Kléber, boîte mystère |
| sniper | FUSIL DE PRÉCISION | coup par coup | 340 | 1 | 3,5 | 1,1 | 374 | 5 | 30 | 45 | 2,8 | 0,0015 | 200 | 4 |  |  | 1750 | 700 | mur Rue du Dôme, boîte mystère |
| magnum | REVOLVER .357 | coup par coup | 190 | 1 | 3 | 3,2 | 608 | 6 | 48 | 72 | 2,2 | 0,006 | 80 | 2 |  |  | boîte | 500 | boîte mystère |
| raygun | PISTOLET À RAYONS | coup par coup | 700 | 1 | 1,5 | 4,2 | 2940 | 20 | 160 | 200 | 2,6 | 0,008 | 100 | 1 | 2,8 | 500 | boîte | 1500 | boîte mystère |

## Pack-a-Punch (5000 pts)

| id | Arme | Nom amélioré | Dégâts | Multiplicateur tête | Chargeur | Réserve max | Zombies traversés | Prix munitions au mur (pts) |
|---|---|---|---|---|---|---|---|---|
| rifle | FUSIL D'ASSAUT | M4 ÉCLIPSE | 90 | 3 | 45 | 270 | 2 | 900 |
| shotgun | FUSIL À POMPE | LE BROYEUR | 65 | 2,16 | 9 | 72 | 2 | 1050 |
| smg | PISTOLET-MITRAILLEUR | PM INFERNAL | 60 | 2,64 | 48 | 336 | 2 | 1500 |
| lmg | MITRAILLEUSE RPK | RPK DÉVASTATEUR | 110 | 2,4 | 113 | 675 | 2 | 3000 |
| sniper | FUSIL DE PRÉCISION | ŒIL DU DÉMON | 850 | 4,2 | 8 | 68 | 6 | 2100 |
| magnum | REVOLVER .357 | LE VENGEUR | 475 | 3,6 | 9 | 108 | 4 | 1500 |
| raygun | PISTOLET À RAYONS | PORTE-TONNERRE | 1120 | 1,8 | 30 | 300 | 2 | 4500 |

## Boîte mystère (950 pts)

| id | Arme | Poids | Chance (%) |
|---|---|---|---|
| shotgun | FUSIL À POMPE | 3 | 23,08 |
| smg | PISTOLET-MITRAILLEUR | 3 | 23,08 |
| lmg | MITRAILLEUSE RPK | 2 | 15,38 |
| sniper | FUSIL DE PRÉCISION | 2 | 15,38 |
| magnum | REVOLVER .357 | 2 | 15,38 |
| raygun | PISTOLET À RAYONS | 1 | 7,69 |

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
| Marché-Neuf | oui | -1 ; -31 | P4, P6 | station, wall:shotgun, wall:smg, perk:quickrevive, box | 1 | FUSIL À POMPE, PISTOLET-MITRAILLEUR | RÉANIMATION RAPIDE, BOÎTE MYSTÈRE |
| Temple-Neuf |  | -35 ; -95 | P2, P4, P5, P7 | station, perk:staminup | 1 |  | STAMIN-UP |
| Rue des Orfèvres |  | 27 ; -58 | P5, P6, P9, P10 | wall:smg, perk:speedcola | 0 | PISTOLET-MITRAILLEUR | SPEED COLA |
| Rue du Dôme |  | 104 ; -118 | P7, P10 | station, wall:sniper, box | 1 | FUSIL DE PRÉCISION | BOÎTE MYSTÈRE |
| Grandes Arcades |  | -110 ; -45 | P1, P2, P3 | station, wall:shotgun, perk:mulekick | 1 | FUSIL À POMPE | MULE KICK |
| Place Kléber |  | -199 ; -145 | P1 | station, perk:juggernog, wall:lmg, box | 1 | MITRAILLEUSE RPK | MASTODONTE, BOÎTE MYSTÈRE |
| Place Gutenberg |  | -20 ; 90 | P3, P8 | station, perk:doubletap, box | 1 |  | DOUBLE TAP, BOÎTE MYSTÈRE |
| Cathédrale |  | 103 ; 33 | P8, P9 | station, pap, box | 1 |  | PACK-A-PUNCH, BOÎTE MYSTÈRE |

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

## Emplacements

| N° sur la carte | Type | Nom | Zone | Prix (pts) | x (m, vers l'est) | z (m, vers le sud) |
|---|---|---|---|---|---|---|
| 1 | Borne de munitions | Borne de munitions | Marché-Neuf |  | -6 | -20 |
| 2 | Arme au mur | FUSIL À POMPE | Marché-Neuf | 750 | -1 | -37 |
| 3 | Arme au mur | PISTOLET-MITRAILLEUR | Marché-Neuf | 1000 | -4 | -26 |
| 4 | Atout | RÉANIMATION RAPIDE | Marché-Neuf | 1500 | -29 | -40 |
| 5 | BOÎTE MYSTÈRE | BOÎTE MYSTÈRE | Marché-Neuf | 950 | -10 | -32 |
| 6 | Borne de munitions | Borne de munitions | Temple-Neuf |  | -31 | -87 |
| 7 | Atout | STAMIN-UP | Temple-Neuf | 2000 | -46 | -92 |
| 8 | Arme au mur | PISTOLET-MITRAILLEUR | Rue des Orfèvres | 1000 | 23 | -66 |
| 9 | Atout | SPEED COLA | Rue des Orfèvres | 3000 | 17 | -9 |
| 10 | Borne de munitions | Borne de munitions | Rue du Dôme |  | 83 | -118 |
| 11 | Arme au mur | FUSIL DE PRÉCISION | Rue du Dôme | 1750 | 107 | -136 |
| 12 | BOÎTE MYSTÈRE | BOÎTE MYSTÈRE | Rue du Dôme | 950 | 106 | -147 |
| 13 | Borne de munitions | Borne de munitions | Grandes Arcades |  | -104 | -54 |
| 14 | Arme au mur | FUSIL À POMPE | Grandes Arcades | 750 | -95 | -47 |
| 15 | Atout | MULE KICK | Grandes Arcades | 4000 | -105 | -61 |
| 16 | Borne de munitions | Borne de munitions | Place Kléber |  | -202 | -161 |
| 17 | Arme au mur | MITRAILLEUSE RPK | Place Kléber | 2500 | -179 | -140 |
| 18 | Atout | MASTODONTE | Place Kléber | 2500 | -222 | -128 |
| 19 | BOÎTE MYSTÈRE | BOÎTE MYSTÈRE | Place Kléber | 950 | -165 | -144 |
| 20 | Borne de munitions | Borne de munitions | Place Gutenberg |  | -13 | 108 |
| 21 | Atout | DOUBLE TAP | Place Gutenberg | 2000 | -1 | 86 |
| 22 | BOÎTE MYSTÈRE | BOÎTE MYSTÈRE | Place Gutenberg | 950 | -16 | 77 |
| 23 | Borne de munitions | Borne de munitions | Cathédrale |  | 128 | 22 |
| 24 | PACK-A-PUNCH | PACK-A-PUNCH | Cathédrale | 5000 | 84 | 29 |
| 25 | BOÎTE MYSTÈRE | BOÎTE MYSTÈRE | Cathédrale | 950 | 117 | 52 |

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
| E | Acheter, ouvrir une porte, utiliser une machine, réanimer (maintenir) |
| F | Lampe torche |
| M | Carte |
| Échap | Menu pause |

### Notes

- **DPS approx.** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Dispersion** : plus c'est petit, plus c'est précis (÷2,5 en visée, ×1,8 en mouvement).
- **Prix munitions** : à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Pack-a-Punch** : dégâts ×2,5 (×1,6 pour le pistolet à rayons), chargeur et réserve ×1,5, tête ×1,2, +2 zombies traversés.
- **Atouts** : on les perd tous quand on tombe à terre.
