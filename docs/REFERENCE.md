# Zombie Survival — fiche de référence

Version du jeu : **v0.6.1**. Tous les chiffres viennent de `src/config.js` (et de `src/main.js` pour les manches).
Carte annotée : [carte.png](carte.png).
Les mêmes données en tableur : dossier [csv/](csv/) (un fichier par catégorie, séparateur `;`).

Pour demander une modification, citez simplement la ligne (ex. « Mitrailleuse RPK : chargeur 100 », « Mastodonte à 3000 pts », « porte P3 à 500 pts »).

---

## 1. Armes

| # | Arme | Type | Dégâts / balle | × tête | Cadence (tirs/s) | DPS ≈ | Chargeur | Réserve départ / max | Rechargement | Dispersion | Portée | Perfore | Prix | Munitions | Où |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **FUSIL D'ASSAUT** (`rifle`) | automatique | 36 | ×2,5 | 9,5 | 342 | 30 | 120 / 180 | 1,8 s | 0,012 | 90 m | — | départ | 300 pts | arme de départ |
| 2 | **FUSIL À POMPE** (`shotgun`) | pompe (8 plombs) | 26 × 8 | ×1,8 | 1,3 | 270 | 6 | 30 / 48 | 2,4 s | 0,046 | 35 m | — | 750 pts | 350 pts | mur Marché-Neuf, mur Nord-Ouest, mur Cathédrale, mur Quartier Est, boîte mystère |
| 3 | **PISTOLET-MITRAILLEUR** (`smg`) | automatique | 24 | ×2,2 | 13,5 | 324 | 32 | 128 / 224 | 1,5 s | 0,022 | 65 m | — | 1 000 pts | 500 pts | mur Marché-Neuf, mur Place Kléber, mur Nord-Est, mur Petite France, boîte mystère |
| 4 | **MITRAILLEUSE RPK** (`lmg`) | automatique | 44 | ×2 | 10,5 | 462 | 75 | 300 / 450 | 3,6 s | 0,028 | 90 m | — | 2 500 pts | 1 000 pts | mur Quartier Est, boîte mystère |
| 5 | **FUSIL DE PRÉCISION** (`sniper`) | coup par coup | 340 | ×3,5 | 1,1 | 374 | 5 | 30 / 45 | 2,8 s | 0,0015 | 200 m | 4 zombies | 1 750 pts | 700 pts | mur Nord-Ouest, boîte mystère |
| 6 | **REVOLVER .357** (`magnum`) | coup par coup | 190 | ×3 | 3,2 | 608 | 6 | 48 / 72 | 2,2 s | 0,006 | 80 m | 2 zombies | boîte | 500 pts | boîte mystère |
| 7 | **PISTOLET À RAYONS** (`raygun`) | coup par coup, explosif | 700 | ×1,5 | 4,2 | 2 940 | 20 | 160 / 200 | 2,6 s | 0,008 | 100 m | — | boîte | 1 500 pts | boîte mystère |

- **DPS ≈** : dégâts par seconde en continu, hors rechargement et hors tête.
- **Munitions** : prix pour remplir la réserve, à une borne de munitions (n'importe quelle arme en main) ou au mur de l'arme.
- **Dispersion** : plus c'est petit, plus c'est précis. Elle est divisée par 2,5 en visée (clic droit) et multipliée par 1,8 en mouvement.
- **Fusil de précision** : lunette (zoom à 25°), quasi aucune dispersion en visée.
- **Pistolet à rayons** : en plus du tir direct, explosion à l'impact de rayon 2,8 m et 500 dégâts.
- **Inventaire** : 2 armes (3 avec Mule Kick). Acheter une arme quand on est plein remplace celle en main.
- **Noms en jeu** : les panneaux muraux du fusil à pompe et du PM affichent « FUSIL A POMPE » et « PM MP40 ».

### Boîte mystère — 950 pts

On ne peut pas obtenir une arme qu'on possède déjà. Tirage pondéré :

| Arme | Poids | Chance (si on n'en possède aucune) |
|---|---|---|
| FUSIL À POMPE | 3 | 23 % |
| PISTOLET-MITRAILLEUR | 3 | 23 % |
| MITRAILLEUSE RPK | 2 | 15 % |
| FUSIL DE PRÉCISION | 2 | 15 % |
| REVOLVER .357 | 2 | 15 % |
| PISTOLET À RAYONS | 1 | 8 % |

### Pack-a-Punch — 5 000 pts (Petite France)

Améliore l'arme en main, une seule fois. Elle prend un nouveau nom et un reflet violet. Effets : dégâts ×2,5 (×1,6 pour le pistolet à rayons), chargeur et réserve ×1,5, multiplicateur tête ×1,2, +2 zombies traversés. Pour le pistolet à rayons, explosion plus grande (rayon ×1,3, dégâts ×2). Racheter des munitions au mur coûte 3 fois plus cher.

| Arme | Nom amélioré | Dégâts | Chargeur | Réserve max | Perfore |
|---|---|---|---|---|---|
| FUSIL D'ASSAUT | **M4 ÉCLIPSE** | 90 | 45 | 270 | 2 |
| FUSIL À POMPE | **LE BROYEUR** | 65 | 9 | 72 | 2 |
| PISTOLET-MITRAILLEUR | **PM INFERNAL** | 60 | 48 | 336 | 2 |
| MITRAILLEUSE RPK | **RPK DÉVASTATEUR** | 110 | 113 | 675 | 2 |
| FUSIL DE PRÉCISION | **ŒIL DU DÉMON** | 850 | 8 | 68 | 6 |
| REVOLVER .357 | **LE VENGEUR** | 475 | 9 | 108 | 4 |
| PISTOLET À RAYONS | **PORTE-TONNERRE** | 1 120 | 30 | 300 | 2 |

### Grenades (touche G)

| Réglage | Valeur |
|---|---|
| Au départ | 2 (+2 dès le début de la manche 1) |
| Maximum | 4 |
| Gagnées par manche | +2 (et rechargées par le bonus Munitions max) |
| Retardement | 2,2 s (rebondit sur les murs et le sol) |
| Rayon | 6,5 m |
| Dégâts au centre | 900 (diminuent avec la distance) |
| Dégâts au lanceur / coéquipiers proches | jusqu'à 60 PV |
| Zombie qui survit à une explosion | 50 % de chances de perdre ses jambes (devient rampant) |

---

## 2. Atouts

On les perd tous quand on tombe à terre.

| Atout | Lettre | Effet | Prix | Où |
|---|---|---|---|---|
| **MASTODONTE** | M | Santé max 250 | 2 500 pts | Place Kléber |
| **SPEED COLA** | S | Rechargement 2x plus rapide | 3 000 pts | Place Kléber |
| **DOUBLE TAP** | D | Cadence +33 %, dégâts +25 % | 2 000 pts | Cathédrale |
| **RÉANIMATION RAPIDE** | R | Solo : se relève seul · Co-op : réanime 2x plus vite | 1 500 pts (solo : 500) | Marché-Neuf |
| **MULE KICK** | K | Porter 3 armes | 4 000 pts | Nord-Ouest |
| **STAMIN-UP** | E | Course plus rapide | 2 000 pts | Nord-Est |

Détail des effets :
- **Mastodonte** : santé max 100 → 250.
- **Speed Cola** : temps de rechargement ×0,5.
- **Double Tap** : cadence ×1,33 et dégâts ×1,25.
- **Réanimation rapide** : en solo, on se relève seul 4 s après être tombé, au lieu de perdre (l'atout est alors consommé). En coop, on réanime un coéquipier en 1,2 s au lieu de 2,5 s.
- **Mule Kick** : 3 armes au lieu de 2. On perd la 3e arme si on perd l'atout.
- **Stamin-Up** : course ×1,3 et marche ×1,1.

---

## 3. Joueur

| Réglage | Valeur |
|---|---|
| Points au départ | 500 |
| Santé | 100 (250 avec Mastodonte) |
| Régénération | 25 PV/s après 5 s sans dégâts |
| Vitesse marche / sprint | 5 / 8 m/s (×0,6 en visée) |
| Saut | 6,5 m/s (environ 1 m de haut) |
| À terre (coop) | 45 s avant de mourir, on rampe à 1,2 m/s, réanimation en maintenant E 2,5 s |
| Défaite | solo : à 0 PV (sauf Réanimation rapide) ; coop : quand toute l'équipe est à terre |

### Points gagnés

| Action | Points |
|---|---|
| Toucher un zombie | 10 |
| Tuer un zombie | 60 |
| Tuer d'un tir à la tête | 100 |
| Réanimer un coéquipier | 250 |
| Bonus Bombe | 400 |
| Points doubles (bonus) | tout ×2 pendant 30 s |

---

## 4. Zombies et manches

| Réglage | Valeur |
|---|---|
| Dégâts par coup | 20 PV, un coup par 1 s, portée 1,3 m |
| Maximum en vie en même temps | 22 |
| Coureurs | à partir de la manche 4 : 25 % des zombies vont 1,5× plus vite |
| Rampants (sans jambes) | à partir de la manche 4 : 12 % des zombies, vitesse ×0,45 (+ ceux qui perdent leurs jambes dans une explosion) |
| Apparition | par les fenêtres (65 %) ou en sortant du sol, entre 11 et 60 m d'un joueur, seulement dans les zones ouvertes |
| Intervalle entre deux apparitions | max(0,4 ; 2 − 0,1 × manche) secondes |
| Pause entre deux manches | 6 s |
| Zombie coincé > 5 s ou à plus de 90 m | réapparaît entre 22 et 45 m d'un joueur |

| Manche | Zombies (solo) | Zombies (2 joueurs) | Santé d'un zombie | Vitesse de base (m/s) |
|---|---|---|---|---|
| 1 | 7 | 12 | 100 | 1,8 |
| 2 | 10 | 18 | 130 | 2 |
| 3 | 13 | 23 | 160 | 2,2 |
| 4 | 16 | 28 | 190 | 2,4 |
| 5 | 19 | 33 | 220 | 2,6 |
| 7 | 25 | 44 | 280 | 3 |
| 10 | 34 | 60 | 374 | 3,6 |
| 12 | 40 | 70 | 453 | 4 |
| 15 | 49 | 86 | 602 | 4,2 |
| 20 | 64 | 112 | 970 | 4,2 |
| 25 | 79 | 138 | 1562 | 4,2 |
| 30 | 94 | 165 | 2516 | 4,2 |

Chaque joueur en plus ajoute 75 % de zombies. La vitesse varie de ±15 % d'un zombie à l'autre.

### Bonus (lâchés par les zombies)

5 % de chances par zombie tué. Ils restent 25 s au sol.

| Bonus | Effet |
|---|---|
| Munitions max | réserves pleines pour toutes ses armes + grenades au maximum |
| Mort instantanée | 30 s : tout zombie touché meurt |
| Bombe | tue tous les zombies, +400 pts |
| Points doubles | 30 s : points ×2 |

---

## 5. Carte : zones, portes et emplacements

Départ : place du Marché-Neuf. On en sort par ses 2 vrais passages sous immeubles, fermés par des portes.

### Portes

Prix : 750 pts pour une zone voisine du départ, +500 par zone plus loin. Une porte entre deux zones ouvre toutes les rues de cette limite d'un coup.

| Porte | Prix | Relie |
|---|---|---|
| P1 | 1 250 pts | Nord-Ouest ↔ Place Kléber |
| P2 | 1 750 pts | Petite France ↔ Cathédrale |
| P3 | 750 pts | Place Kléber ↔ Marché-Neuf |
| P4 | 750 pts | Place Kléber ↔ Marché-Neuf |
| P5 | 1 250 pts | Place Kléber ↔ Nord-Est |
| P6 | 1 750 pts | Cathédrale ↔ Quartier Est |
| P7 | 1 750 pts | Nord-Ouest ↔ Petite France |
| P8 | 1 250 pts | Place Kléber ↔ Cathédrale |
| P9 | 1 750 pts | Nord-Est ↔ Quartier Est |

### Contenu de chaque zone

| Zone | Borne de munitions | Armes au mur | Atouts / machines |
|---|---|---|---|
| **Marché-Neuf** | oui | FUSIL À POMPE (750), PISTOLET-MITRAILLEUR (1000) | RÉANIMATION RAPIDE (1500), BOÎTE MYSTÈRE (950) |
| **Place Kléber** | oui | PISTOLET-MITRAILLEUR (1000) | MASTODONTE (2500), SPEED COLA (3000) |
| **Cathédrale** | oui | FUSIL À POMPE (750) | DOUBLE TAP (2000), BOÎTE MYSTÈRE (950) |
| **Nord-Ouest** | oui | FUSIL À POMPE (750), FUSIL DE PRÉCISION (1750) | MULE KICK (4000) |
| **Nord-Est** | oui | PISTOLET-MITRAILLEUR (1000) | STAMIN-UP (2000), BOÎTE MYSTÈRE (950) |
| **Petite France** | oui | PISTOLET-MITRAILLEUR (1000) | PACK-A-PUNCH (5000), BOÎTE MYSTÈRE (950) |
| **Quartier Est** | oui | FUSIL À POMPE (750), MITRAILLEUSE RPK (2500) | BOÎTE MYSTÈRE (950) |

Le découpage des zones se règle dans `src/config.js` → `zones`. Les noms des zones sont dans `src/realworld.js` → `ZONE_NAMES`. La répartition des machines par zone est dans `src/realworld.js` → `LAYOUT`.

---

## 6. Commandes

| Touche | Action |
|---|---|
| ZQSD / WASD | se déplacer |
| Souris / clic gauche / clic droit | viser / tirer / viser à la mire |
| Shift | sprint |
| Espace | sauter |
| R | recharger |
| 1 / 2 / 3 / molette | changer d'arme |
| G | grenade |
| E | acheter, ouvrir une porte, utiliser une machine, réanimer (maintenir) |
| F | lampe torche |
| M | carte plein écran |
| Échap | menu pause (reprendre, options, quitter) |
