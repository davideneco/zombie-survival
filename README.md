# Zombie Survival — Strasbourg

Jeu de survie coopératif contre des vagues de zombies, dans la **Grande Île de Strasbourg** reconstituée à partir des données OpenStreetMap (bâtiments, quais, places, cathédrale). Il se joue dans le navigateur, seul ou jusqu'à **4 joueurs**.

Technique : [Three.js](https://threejs.org/) pour la 3D, [Vite](https://vite.dev/) pour le serveur de développement, un petit relais WebSocket (Node.js) pour le multijoueur.

## Le principe

Vous démarrez place du Marché-Neuf avec un pistolet, un fusil d'assaut et 500 points. Les zombies arrivent par vagues (manches) de plus en plus nombreuses, rapides et résistantes. Tenez le plus longtemps possible.

- **Gagner des points** : toucher un zombie (10), le tuer (60), le tuer d'une balle dans la tête (100), réanimer un coéquipier (250).
- **Dépenser des points** :
  - **Ouvrir des portes** pour atteindre de nouvelles zones. Toute la Grande Île est jouable : 27 zones construites autour de vrais lieux (place Kléber, place Gutenberg, cathédrale, Petite France, place de l'Homme de Fer, etc.). Chaque porte est plus chère en s'éloignant du départ.
  - **Acheter des armes au mur** (repérables à leur silhouette à la craie) et leurs munitions.
  - **Boire des atouts** (distributeurs) : Mastodonte, Speed Cola, Double Tap, Réanimation rapide, Mule Kick, Stamin-Up, PHD Flopper.
  - **Tenter la boîte mystère** : une arme au hasard, la boîte change de place.
  - **Améliorer une arme au Pack-a-Punch** (3 niveaux, avec accessoires visibles), dans l'intérieur de la cathédrale.
- **Bonus** lâchés par les zombies : munitions max, mort instantanée, bombe, points doubles, bidons d'essence.
- **Motos** : une moto et une grosse moto à deux places, garées à la place Gutenberg (et une autre à la place Broglie). Elles ont des points de vie, un réservoir d'essence, et n'écrasent les zombies qu'au-dessus d'une certaine vitesse.
- **Fin de partie** : à partir de la manche 12, avec 18 quartiers ouverts, la cathédrale accueille la finale **« L'Heure du Jugement »** : un siège de l'horloge astronomique contre le boss, le Bourreau. Ensuite, le mode sans fin continue.
- **À terre** : en coopération, un joueur à terre a 45 secondes pour être réanimé par un coéquipier (touche `E` maintenue).

La fiche de référence complète (armes, atouts, zones, portes, manches, prix) est dans [`docs/REFERENCE.md`](docs/REFERENCE.md), avec la [carte annotée](docs/carte.png) et les mêmes tableaux au format tableur dans [`docs/csv/`](docs/csv/).

## Commandes

| Touche | Action |
|---|---|
| `Z Q S D` / `W A S D` | Se déplacer |
| Souris | Viser |
| Clic gauche | Tirer |
| Clic droit | Viser à la mire |
| `Shift` | Sprint |
| `Espace` | Sauter |
| `Espace` (devant un obstacle bas) | Enjamber |
| `R` | Recharger |
| `1` `2` `3` / molette | Changer d'arme |
| `G` | Grenade |
| `V` | Coup de couteau (aussi : clic gauche quand le chargeur et la réserve sont vides) |
| `F` | Lampe torche |
| `E` | Acheter, ouvrir une porte, utiliser une machine ou la borne des motos, monter / descendre d'une moto ; réanimer un coéquipier (maintenir) |
| `M` | Carte |
| `Échap` | Ferme la carte ou le menu ouvert ; sinon menu pause |
| `K` (maintenir 2 s) | Se débloquer si vous êtes coincé |

**En moto** : `Z Q S D` / `W A S D` accélérer, freiner, tourner ; `Espace` frein à main ; `V` change la vue (3e personne par défaut) ; `E` pour descendre.

**Fusil d'assaut Pack-a-Punch niveau III** : clic molette pour tirer le lance-grenades sous le canon.

**Hôte uniquement** : `F9` ouvre un menu de debug (`1`-`4` choisir un joueur, `T` deux fois pour l'amener sur vous, `Y` pour le rejoindre, `N` pour le réanimer, `U` pour débloquer des zombies coincés, `P` pour les performances).

## Jouer sur son PC

### 1. Prérequis

- [Node.js](https://nodejs.org/) **20 ou plus récent** (la version LTS convient). Il inclut `npm`.
- Un navigateur récent avec WebGL2 : Chrome, Edge ou Firefox (Chrome / Edge recommandés), idéalement avec une carte graphique correcte : la scène est dense.
- [Git](https://git-scm.com/) (ou téléchargez le projet en ZIP depuis GitHub : bouton *Code* > *Download ZIP*).

### 2. Installation

```bash
git clone https://github.com/davideneco/zombie-survival.git
cd zombie-survival
npm install
```

### 3. Lancer le jeu

```bash
npm run dev
```

Ouvrez ensuite **http://localhost:5173** dans votre navigateur et cliquez sur *Jouer*. Le serveur de développement embarque aussi le relais multijoueur.

Pour une version optimisée (comme en ligne) :

```bash
npm run build
npm start
```

Le jeu est alors servi sur **http://localhost:3000** (changez le port avec la variable d'environnement `PORT`).

### 4. Jouer à plusieurs

- Dans le menu, un joueur **crée un salon** : il reçoit un **code de 4 lettres** et devient l'hôte. Les autres **rejoignent** avec ce code (4 joueurs maximum). C'est l'hôte qui simule les zombies : si l'hôte part, la partie se termine.
- **Sur le même réseau local** : lancez `npm run dev -- --host`, puis les autres joueurs ouvrent `http://ADRESSE_IP_DE_VOTRE_PC:5173`. Le pare-feu doit autoriser le port.
- **En ligne** : hébergez-le sur un service qui exécute Node.js (le projet est prévu pour [Render](https://render.com/) : *build* `npm install && npm run build`, *start* `npm start`). Tout le monde doit utiliser la **même version** du jeu : rechargez la page après une mise à jour.

### 5. Musique personnalisée (facultatif)

Posez un fichier `theme.mp3` (ou `.ogg`, `.m4a`, `.wav`) dans `public/music/` : il remplace le rock synthétisé. Ce fichier n'est jamais envoyé sur GitHub (droits d'auteur) ; voir [`public/music/LISEZMOI.txt`](public/music/LISEZMOI.txt).

## Problèmes courants

- **Écran noir ou jeu très lent** : vérifiez que l'accélération matérielle est activée dans le navigateur et que WebGL2 fonctionne (`about:gpu` dans Chrome). Le chargement initial de la carte prend quelques secondes.
- **La souris ne se capture pas / la pause s'affiche** : cliquez sur la fenêtre de jeu. Le navigateur refuse parfois de recapturer la souris juste après `Échap`.
- **Coincé dans le décor** : maintenez `K` 2 secondes ; en multijoueur, l'hôte peut vous téléporter avec `F9`.
- **Impossible de rejoindre un salon** : vérifiez le code, que tout le monde a la même version du jeu, et que le port est joignable (réseau local, pare-feu).

## Structure du projet

| Dossier | Contenu |
|---|---|
| `src/` | Code du jeu (modules ES) ; l'équilibrage est dans `src/config.js` |
| `server/` | Relais multijoueur (`rooms.mjs`) et serveur de production (`prod.mjs`) |
| `public/` | Données de la carte (`data/area.json`), textures, dossier de musique |
| `tools/` | Outils : extraction OSM, génération des docs (`make-docs.mjs`), détection de blocages (`stuck-scan.mjs`), tests |
| `docs/` | Fiche de référence, carte annotée, tableaux CSV |

Vérifier un changement : `npx vite build` puis une partie avec `?debug` dans l'URL (outils de développement).

## Crédits

- Données cartographiques : © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), licence ODbL.
- Moteur 3D : [Three.js](https://threejs.org/).
