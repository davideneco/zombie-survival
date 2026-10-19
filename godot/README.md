# Zombie Survival — port Godot

Port du jeu de survie de Strasbourg (version navigateur : [`../README.md`](../README.md)) vers **Godot 4.7.2**, en GDScript, rendu Forward+ (Vulkan). Branche `godot-port`.

**État** : solo complet (carte de Strasbourg, zombies, 23 armes, véhicules dont une rame conduisible, atouts, boss, finale, HUD, menus, audio), export Windows. **Le multijoueur n'est pas porté.** Jamais lancé sous Windows réel par le développeur : voir [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md) pour ce qui est vérifié ou non.

## Lancer

Prérequis : [Godot 4.7.2](https://godotengine.org/download) (version standard, pas .NET). Le monde cuit n'est pas versionné en entier (voir « Régénérer les assets »).

```bash
godot --path godot                 # menu principal ; le monde ne se charge qu'après « Jouer »
godot --path godot -- --map=arena  # petite arène de test
```

Ou ouvrez le dossier `godot/` dans l'éditeur et lancez (F5). Réglages, touches, statistiques et trophée sont dans `user://`.

### Windows
Un zip prêt à l'emploi se construit avec `tools/export-windows.sh` : `Zombie.exe`, `Zombie.console.exe`, `Zombie.pck`, `LISEZMOI.txt`, `LICENCES/`. Le zip n'est pas dans le dépôt (`godot/build/` est ignoré). Il faut les modèles d'export Godot 4.7.2 pour Windows (procédure dans `docs/GODOT_PORT.md`, section J21). L'exe n'est pas signé : SmartScreen peut avertir.

## Particularités

- **Menu** : Jouer, Meilleur score / statistiques, choix de la carte (Strasbourg ou arène) et de la difficulté (Facile / Normale / Difficile), Multijoueur (grisé).
- **Qualité et mise à l'échelle** (Options) : préréglages Rapide / Normale / Haute ; mise à l'échelle 3D **Natif, FSR 1.0 ou FSR 2.2 (essai)**, résolution 3D (100, 85, 75, 67, 50 %) et netteté. Le HUD reste net. Pas de DLSS : le moteur n'en propose pas.
- **Premier lancement sous Windows** : en cas de GPU intégré, la qualité « Rapide » est choisie d'office.
- **Chargement** : une étape de préchauffage (pipelines, sons, grilles de navigation) évite les gels en jeu.
- **Musique** : `theme.*` n'est jamais livré (droits d'auteur). Déposez un fichier mp3, ogg ou wav dans `user://music/` pour l'utiliser.

## Diagnostiquer des gels

```bash
Zombie.console.exe -- --perf-log=perf.txt
```

Jouez 5 à 10 minutes, fermez la fenêtre normalement, puis envoyez `perf.txt` (les lignes `SPIKE` suffisent). Banc automatique : `--perf-soak=5` (un bot joue 5 minutes).

## Options de lancement utiles

Après `--` : `--map=arena` (sinon Strasbourg), `--difficulty=easy|normal|hard`, `--seed=N`, `--bot` (le bot joue), `--no-music`, `--no-warmup`, `--perf-log=F`, `--perf-soak=N`, `--quit-at=S`, `--shot=f.png --at=S` (capture). Les autres (`--do=`, `--horde=`, `--seat=`, `--tram-at=`, `--zoo*`…) servent aux captures de test ; elles sont lues dans `scenes/main.gd`.

## Tests

```bash
tools/godot-check.sh          # tout : export de la config et des golden depuis le JS, import, toutes les suites
tools/godot-check.sh j9       # une suite
```

Plus de 159 000 contrôles, 0 échec à la v0.19.1. Les **golden** sont des sorties du jeu JS (Node ou Chrome) que le GDScript doit retrouver : config, collision, navigation, armes, véhicules, prix, tram, boss. Les tests tournent en headless, sans rendu ; les captures demandent un écran (ou `xvfb-run`).

## Structure

| Dossier | Contenu |
|---|---|
| `sim/` | Simulation pure, sans nœuds : collision, navigation (champ de flux), zombies, manches, armes, véhicules, tram, boss, difficulté, réglages |
| `scenes/` | Vues et interface : monde, zombies, armes, tram, HUD, menus, `main.gd` (entrée et options de test) |
| `autoload/` | `Config` (équilibrage du JS), `Game` (état), `Sfx` (audio) |
| `shaders/` | Ciel, sol, façades, eau, feuillage, zombies |
| `data/` | Config et données exportées du JS ; `golden/` (tests, jamais exporté) |
| `assets/` | Armes (OBJ), zombies (glb), rame, textures, sons ; une partie est régénérée, voir ci-dessous |
| `tests/` | Suites `test_j0` à `test_j23` et `runner.tscn` |

Les licences des modèles : `assets/weapons/LICENSE.txt` (Quaternius, Tabasco) et `assets/zombies/LICENSE.txt` (Quaternius).

## Régénérer les assets

La carte, les textures et l'audio viennent du jeu JS et se « cuisent » avec Chrome. Ils sont ignorés par git (sauf données de jeu et rame). Lancer `npm run dev` à la racine, puis :

```bash
node tools/bake-world.mjs       # géométrie, collision, navigation, portes
node tools/bake-vehicles.mjs    # machines, stations, rame
node tools/bake-graphics.mjs    # atlas, sol
node tools/bake-portraits.mjs   # carte et portraits
node tools/bake-audio.mjs       # sons et boucles de musique
node tools/bake-tram.mjs        # rame (déjà versionnée)
node tools/download-textures.mjs
```

Armes et zombies : `tools/build-weapons.py` et `tools/build-zombies.py` (Blender). Les journaux, décisions et mesures sont dans [`../docs/GODOT_PORT.md`](../docs/GODOT_PORT.md).
