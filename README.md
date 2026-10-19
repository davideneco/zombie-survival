# Zombie Survival — Strasbourg

Jeu de survie coopératif contre des vagues de zombies, dans la **Grande Île de Strasbourg** reconstituée à partir des données OpenStreetMap (bâtiments, quais, places, cathédrale). Seul ou jusqu'à **4 joueurs**.

Il existe deux versions du même jeu :

| Version | Où | Techno | État |
|---|---|---|---|
| **Navigateur** (cette page) | branche `main` | [Three.js](https://threejs.org/), [Vite](https://vite.dev/), relais WebSocket Node.js | complète, solo et multijoueur, déployée sur Render |
| **Port Godot** | branche `godot-port`, dossier [`godot/`](godot/README.md) | Godot 4.7 (GDScript, Forward+) | solo complet, export Windows ; multijoueur pas encore porté |

## Le principe

Vous démarrez place du Marché-Neuf avec un pistolet, un fusil d'assaut et 500 points. Les zombies arrivent par manches de plus en plus nombreuses, rapides et résistantes. Tenez le plus longtemps possible.

**Gagner des points** : toucher un zombie (10), le tuer (60), le tuer d'une balle dans la tête (100), réanimer un coéquipier (250).

**Les dépenser** :
- **Portes** : 27 zones construites autour de vrais lieux (place Kléber, place Gutenberg, cathédrale, Petite France, Homme de Fer…). Plus on s'éloigne du départ, plus la porte coûte cher.
- **Armes au mur** (silhouettes à la craie) et leurs munitions.
- **Atouts** : Mastodonte, Speed Cola, Double Tap, Réanimation rapide, Mule Kick, Stamin-Up, PHD Flopper.
- **Boîte mystère** : une arme au hasard, la boîte change de place.
- **Pack-a-Punch** : 3 niveaux, dans la cathédrale.

**Bonus** lâchés par les zombies : munitions max, mort instantanée, bombe, points doubles, bidons d'essence.

**À terre**, un joueur a 45 s pour être réanimé (touche d'interaction maintenue).

### Véhicules
- **Motos** : une moto et une grosse moto à deux places (place Gutenberg, place Broglie). Points de vie, essence, n'écrasent qu'au-dessus d'une certaine vitesse.
- **Vélos** : 23 vélos gratuits dans 19 stations (pastille « V » sur la carte). 43 km/h, 150 PV, pas de tir, n'écrasent jamais un zombie ; un choc violent fait chuter le cycliste.
- **Tram** : deux lignes dans les rues les plus larges (A / D et B / C / F), rails, quais, caténaires, feux rouges devant les portes encore fermées. Une **rame conduisible** de 23,5 m (50 km/h, 3 000 PV, fauche les zombies) au quai « Homme de Fer » : remettre le courant à la sous-station (2 000 points, une fois pour l'équipe), puis conduire. On peut monter à pied, marcher et s'asseoir dans la rame en marche, et choisir la voie à l'aiguillage de l'Homme de Fer (`B`). Les zombies n'entrent pas dans la rame.

### Fin de partie
- **Maître Tanneur** : à partir de la manche 15, toutes les 5 manches, un pestiféré colossal rôde à Petite France ou Saint-Pierre-le-Vieux.
- **« L'Heure du Jugement »** : dès la manche 12 avec 18 quartiers ouverts, la cathédrale accueille le boss, **le Bourreau** (350 000 PV, +70 % par joueur en plus), en quatre phases. Son point faible est la lanterne dans son dos. Récompense : 10 000 points et la Hache du Bourreau.
- **Acte V « L'Aube »** : montée de la flèche (gargouilles, puis **l'Ange du Jugement**, boss secret), puis allumage du **Fanal d'Erwin** par tous les joueurs. Le jour se lève, les zombies tombent en cendres, « STRASBOURG LIBÉRÉE ». Récompenses : la Bénédiction de l'Aube, un trophée, puis la **Nuit éternelle** (zombies +30 % de vie).

Toutes les valeurs, les prix, les zones et les manches sont dans [`docs/REFERENCE.md`](docs/REFERENCE.md), avec la [carte annotée](docs/carte.png) et des tableaux CSV dans [`docs/csv/`](docs/csv/).

## Commandes

Toutes les touches se changent dans **Options > Touches** (clic sur l'action, nouvelle touche, `Échap` annule, échange proposé si la touche est prise). Fixes : souris, molette, `Échap`, `F9`. Touches par défaut :

| Touche | Action |
|---|---|
| `Z Q S D` / `W A S D`, flèches | Se déplacer |
| Souris, clic gauche, clic droit | Viser, tirer, viser à la mire |
| `Maj gauche` | Sprint |
| `Espace` | Sauter (enjamber un obstacle bas) |
| `R` | Recharger |
| `1` `2` `3` / molette | Changer d'arme |
| `G` / `V` / `F` | Grenade / couteau / lampe torche |
| `E` | Acheter, ouvrir, utiliser, monter ou descendre d'un véhicule, réanimer (maintenir) |
| `M` | Carte |
| `Échap` | Ferme le chat, la carte ou le menu ; sinon pause |
| `K` (maintenir 2 s) | Se débloquer |
| `Entrée` | Chat écrit (multijoueur) |

- **Moto / vélo** : `Z Q S D` pour conduire, `Espace` frein à main, `V` change la vue, `E` pour descendre.
- **Tram** : `Z`/`W` accélérer, `S` frein puis marche arrière, `Espace` frein d'urgence, `O` portes, `H` gong (attire les zombies à moins de 50 m), `V` vue, `B` aiguillage, `E` monter, s'asseoir, se lever.
- **Fusil d'assaut Pack-a-Punch III** : clic molette pour le lance-grenades.
- **Hôte** : `F9` ouvre le menu de debug.

## Options graphiques

Dans Options : luminosité, champ de vision, sensibilité, **Qualité** (Rapide / Normale / Haute), volumes, effets cinéma, halo, chat, touches, plein écran. Tout est visuel et local : aucun effet sur le réseau, l'équilibrage ou les collisions.

| | Rapide | Normale | Haute |
|---|---|---|---|
| Netteté | x0,75 | x1 | jusqu'à x2 |
| Ombres de la lune | aucune | douces, 1024 px | douces, 2048 px |
| Arbres | boules lissées | cartes de feuillage | cartes + branches |
| Rendu et étalonnage | direct | direct | multi-échantillonné + table de couleurs |
| Halo lumineux | non | non | oui |
| Particules / taches de sang | 50 % / 16 | 100 % / 36 | 100 % / 64 |

Les valeurs sont dans le bloc `graphics` de `src/config.js`.

## Jouer sur son PC (version navigateur)

Prérequis : [Node.js](https://nodejs.org/) 20 ou plus, un navigateur avec WebGL2 (Chrome ou Edge recommandés), [Git](https://git-scm.com/).

```bash
git clone https://github.com/davideneco/zombie-survival.git
cd zombie-survival
npm install
npm run dev
```

Ouvrez **http://localhost:5173** et cliquez sur *Jouer*. Pour la version optimisée : `npm run build` puis `npm start` (port 3000, ou la variable `PORT`).

### Jouer à plusieurs
- Un joueur **crée un salon** et reçoit un **code de 4 lettres** ; les autres le saisissent. L'hôte simule les zombies : s'il part, la partie se termine.
- **Réseau local** : `npm run dev -- --host`, puis `http://ADRESSE_IP:5173` ; le pare-feu doit laisser passer le port.
- **En ligne** : n'importe quel hébergeur Node.js (prévu pour [Render](https://render.com/) : build `npm install && npm run build`, start `npm start`). Tous les joueurs doivent avoir la **même version** : rechargez la page après une mise à jour.

### Musique personnalisée (facultatif)
Posez `theme.mp3` (ou `.ogg`, `.m4a`, `.wav`) dans `public/music/` pour remplacer le rock synthétisé. Le fichier n'est jamais envoyé sur GitHub (droits d'auteur) ; voir [`public/music/LISEZMOI.txt`](public/music/LISEZMOI.txt).

## Problèmes courants

- **Écran noir ou jeu lent** : activez l'accélération matérielle et vérifiez WebGL2 (`about:gpu` dans Chrome). Le premier chargement prend quelques secondes.
- **La souris ne se capture pas** : cliquez sur la fenêtre ; le navigateur refuse parfois juste après `Échap`.
- **Coincé dans le décor** : maintenez `K` 2 secondes ; en multijoueur l'hôte peut vous téléporter avec `F9`.
- **Salon introuvable** : vérifiez le code, la version du jeu et que le port est joignable.

## Structure du dépôt

| Dossier | Contenu |
|---|---|
| `src/` | Jeu (modules ES) ; équilibrage dans `src/config.js` |
| `server/` | Relais multijoueur (`rooms.mjs`) et serveur de production (`prod.mjs`) |
| `public/` | Carte (`data/area.json`), textures, musique |
| `tools/` | Extraction OSM, génération des docs, détection de blocages, cuisson et golden pour le port Godot |
| `docs/` | Référence, carte annotée, CSV ; `GODOT_PORT.md` (plan et journal du port) |
| `godot/` | Port Godot (branche `godot-port`) |

Vérifier un changement : `npx vite build`, puis une partie avec `?debug` dans l'URL.

## Crédits

- Cartographie : © contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), licence ODbL.
- Moteur 3D : [Three.js](https://threejs.org/). Port : [Godot](https://godotengine.org/).
- Armes du port Godot : Quaternius et Tabasco ; zombies : Quaternius ; détails et licences dans `godot/assets/*/LICENSE.txt`.
