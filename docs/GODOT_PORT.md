# Portage vers Godot 4.7 (GDScript) : plan

Document de travail, branche `godot-port`. Aucun code de jeu ici : un inventaire, un ordre de portage par jalons vérifiables, la réutilisation
des données, et les risques et décisions à trancher. Le projet Godot sera créé dans `godot/` au jalon J0 ; d'ici là, rien ne change dans le jeu
Three.js, qui reste la référence (et continue d'être déployé sur Render depuis `main`).

- Moteur cible : **Godot 4.7** (4.7.2 stable est installé sur le poste : `godot --version`), **GDScript** typé.
- Périmètre : **le jeu solo d'abord**, jusqu'à la parité. Le **multijoueur est explicitement reporté** après le gameplay solo (jalon J12).
  Mais le code solo est écrit dès J1 avec la frontière « hôte autoritaire » du jeu actuel (voir § 1.3), pour que le réseau se branche plus
  tard sans réécriture.
- État mesuré du projet JS (v0.47.1) : 66 modules, **24 286 lignes** dans `src/`, plus `index.html` (364 lignes de HUD et de menus en HTML/CSS).

---

## 0. État d'avancement

Décisions retenues : D1 (a) bureau d'abord, D2 (a) monde cuit depuis le JS, D3 (a) collision maison portée, D9 version propre au port (départ v0.1.0, commits `sujet en anglais (godot vX.Y.Z)`, `package.json` intact), D10 tout reste sur `godot-port`, sans push. D11 appliquée (agents `gameplay-coder` et `gui-test-debugger`).

| Jalon | État | Version du port |
|---|---|---|
| J0 | **Fait** (2476 contrôles headless, 0 échec) | v0.1.0 |
| J1 | **Fait** (8 195 contrôles headless j1 + 2 476 j0, 0 échec ; captures et vidéo réelles) | v0.2.0 |
| J2 | **Fait** (21 469 contrôles headless j0+j1+j2, 0 échec ; captures réelles de 4 lieux) | v0.3.0 |
| J3 à J12 | À faire | |
| J4 (fait en parallèle de J3, à fusionner) | **Fait** (37 230 contrôles headless j0+j1+j2+j4, 0 échec ; capture réelle de l'arme et du HUD) | v0.5.0 |

J0 livré : `godot/project.godot` (Godot 4.7, Forward+, 60 ticks physiques, autoloads `Config` et `Game`), `godot/autoload/{config,game}.gd`, `godot/sim/pap.gd` (`papStats`, `papAmmoMult`, `papPulse`, `falloffMult`), `godot/tests/` (`runner.tscn`, `test_j0.gd`), `tools/export-config.mjs` (config.json ~49 Ko), `tools/export-golden.mjs` (`godot/data/golden/j0.json` : 69 `papStats`, 1430 `falloffMult`, 164 `papPulse`, 61 santés de zombie), `tools/godot-check.sh` (exports + import + tests). Vérification en une commande : `tools/godot-check.sh`.

J1 livré (squelette solo dans l'arène) :
- **Sim pure** (`godot/sim/`) : `collision.gd` (`Collision`, port intégral de `collision.js` : segments, cercles, boîtes, grille de 4 m, bandes de hauteur, obstacles dynamiques, `findVault`, `resolve`, `ray_hit`), `arena.gd` (plan lu dans `data/arena.json`), `player_sim.gd` (marche, sprint, saut, gravité, régénération, `hurt`), `weapon_sim.gd` (M1911 : chargeur, réserve, rechargement, cadence), `hitscan.gd` (rayon contre sphère de tête et boîte de corps orientées, mur par `ray_hit`, perforation), `zombie_sim.gd` (fonce tout droit, séparation, pas de côté quand il est coincé, attaque en deux temps), `round_director.gd` (`startRound`, cadence d'apparition, pauses), `bot.gd` (pilote de test et de démonstration), `rules.gd` (constantes de règles qui ne sont pas dans CONFIG, chacune avec sa source JS).
- **Hôte** : l'autoload `Game` est maintenant la partie (`new_game`, `step(dt, input)`, `hit_zombie`, points 10 / 60 / 100, signaux de présentation). `step` ne dépend ni d'un nœud ni du temps réel.
- **Scènes** : `scenes/main.tscn` (+ `main.gd` : entrées par touches physiques, souris `CAPTURED` hors du pas fixe, `Game.step` dans `_physics_process`, caméra interpolée), `scenes/world/arena.tscn`, `scenes/zombie_view.gd` (silhouette en primitives), `scenes/ui/hud.tscn` (vie, munitions, points, manche, annonce, voile rouge, écran de fin avec R). Options de lancement après `--` : `--bot`, `--demo`, `--seed=N`, `--shot=f.png --at=S`, `--quit-at=S`.
- **Outils** : `tools/export-golden-j1.mjs` (écrit `data/arena.json`, extrait de `world.js`, et `data/golden/j1.json`), `tools/godot-check.sh` lance toutes les suites (ou une seule : `tools/godot-check.sh j1`).
- **Vérifications** : 1 000 `resolve`, 1 000 `rayHit`, 200 `findVault` égaux au JS à 1 mm (en pratique 1e-6), 600 cas d'arène égaux à `resolveCollisions` de `world.js` ; scénarios : manche 1 (7 zombies, santé, vitesse), blocage par caisse et mur, saut (hauteur), vitesses de marche et de sprint, semi-automatique, rechargement, points 10 / 60 / 100, balle arrêtée par une caisse, bot immobile tué en 28,5 s, bot tireur qui tue les 7 zombies de la manche 1 (25,6 s), mort et `game_over`. Capture et vidéo de 11 s (`--write-movie`) faites sur l'écran réel (pas de `xvfb-run` sur ce poste).
- **Écarts connus** : le bruit de dispersion utilise la même ouverture en largeur et en hauteur (le JS tire en coordonnées normalisées d'écran, donc plus large en 16:9) ; pas d'enjambement, d'étages, de couteau ni de grenades (jalons suivants) ; `Vector3` est en simple précision (positions à ~1e-5 près, bien sous le millimètre) ; l'arène n'a pas de champ de flux : un zombie derrière une caisse se débloque par ses pas de côté, comme dans le JS.
- **À remonter dans `src/config.js`** (valeurs de `main.js` / `player.js` / `zombie.js` hors CONFIG, en attendant dans `sim/rules.gd`) : points par tir, nombre de zombies par manche (4 + 3 r), intervalles d'apparition et de pause, délais d'attaque, dimensions des zones de tir.

J2 livré (carte de Strasbourg) :
- **Cuisson** : `tools/bake-world.mjs` + `tools/bake-world.page.js` (jeu JS lancé dans Chrome via `npm run dev`, puis `node tools/bake-world.mjs`) écrivent `godot/data/world/` (versionné : collision `segs.f64`/`circles.f64`/étages, `levels.json`, navigation `nav/`, `objects.json` zones/portes/machines, `windows.f64`, `lamps.json`, `materials.json`, `textures.json`, `tiles.json`, `manifest.json`, `golden_j2.json`) ; la géométrie (`tiles/`, `doors/`, `instances.bin`) et les textures (`assets/baked`, `assets/textures`) sont régénérables et ignorées par git. `golden_j2.json` est calculé par le JS.
- **Sim** : `sim/world.gd` (chargement ~230 ms, zones, portes payantes `near_door`/`open_door`, fenêtres d'apparition), `sim/levels.gd` (étages, `floor_at`), `sim/nav_grid.gd` (grille de blocage, BFS de test), `Game.new_game(seed, map)` (carte `strasbourg` par défaut, `arena` conservée), `Game.use_door()`, `player_sim` sensible aux étages ; apparition au hasard sur une fenêtre libre (en attendant le champ de flux de J3).
- **Rendu** : `scenes/world/world_view.gd` (70 tuiles en ArrayMesh, ~498 k triangles, 223 matériaux PBR, décor en MultiMesh, portes masquées à l'ouverture, 24 lampadaires éclairants les plus proches, chargement ~1 s), `main.gd` (touche E pour acheter une porte, `--map=`, `--pos=x,z[,yaw]`, `--open-all`).
- **Vérifications** : comptes du manifeste (336 fichiers), golden `floorAt` (2 000), `rayHit` (2 000), `zoneOf` (1 200), rayons de portes (56) portes fermées puis ouvertes ; bot qui traverse de Marché-Neuf à la place Kléber (355 m, 67 s, jamais arrêté) ; captures sur l'écran réel (Marché-Neuf, place Kléber, rue de la cathédrale, parvis avec la porte à 5 000 pts).
- **Écarts connus** : pas de ciel ni d'étoiles, pas de brouillard exponentiel identique (densité Godot réglée à l'œil), pas de ShaderMaterial (eau, sol) ni d'ombres (J9) ; intérieur de la cathédrale non contrôlé visuellement ; zombies encore en ligne droite (J3) ; pas de comparaison pixel à pixel avec le JS ; temps de rendu (FPS) non mesuré.

J4 livré (armes) :
- **Sim pure** (`godot/sim/`) : `weapon_state.gd` (`WeaponState`, étend `WeaponSim` : une arme de l'inventaire, `cfg` = `statsOf` de player.js = base + `Pap.pap_stats` + Double Tap / Speed Cola, cadence semi / auto avec `FIRE_RESUME_GAP`), `weapon_arms.gd` (`WeaponArms` : inventaire 2 armes (3 avec Mule Kick), `give_weapon`, `upgrade_current`, molette et touches 1-3, tir à la détente (auto, semi, plombs, perforation, chute des dégâts par zombie touché, Éther, balles explosives, éclaboussure du pistolet à rayons et de l'arbalète PaP), visée ADS (dispersion x0,4 / x0,05 avec lunette, FOV), rechargement (auto pour l'arbalète et le M79), clic à vide = couteau, M79 et lance-grenades sous canon, grenades à main), `weapon_blast.gd` (obus du M79 de `launcher.js` en sous-pas de 20 ms, grenades à rebonds de `updateGrenades`, `explode` / `area_damage` / `splash` de `main.js`), `weapon_melee.gd` (couteau : rayon central puis cône, dos x1,5, tête x1,5, fente, Hache du Bourreau), `weapon_shop.gd` (armes murales : achat puis munitions au prix x `papAmmoMult` ; bornes de munitions, y compris la borne de l'arène).
- **Hôte** : `Game.arms` remplace l'ancien `Game.weapon` (qui reste, en lecture, sur l'arme en main) ; `new_game(seed, map, weapons)` (par défaut le M1911 de J1, la scène principale passe `startWeapons`) ; `Game.interact()` (borne, arme murale, puis porte) ; `Game.hurt_player(amount, src)` (immunité PHD Flopper aux explosions) ; `hit_zombie(..., mel)` (couteau : pas de bonus de tête, points `knife.points`) ; signaux `explosion`, `weapon_acquired`, `purchase_denied`.
- **Rendu** : `scenes/weapon_view.gd` (arme à la première personne en primitives par catégorie et niveau du PaP, recul, rechargement, visée, coup de couteau, obus et grenades en vol, flash des explosions) ; commandes : clic droit viser, V couteau, G grenade, 1-3 et molette changer d'arme, clic molette obus sous canon, E acheter.
- **Vérification** (`tools/export-golden-j4.mjs`, `tests/test_j4.gd`) : golden JS de 368 jeux de statistiques effectives (23 armes x 4 niveaux x 4 combinaisons d'atouts), 736 dégâts (arme x niveau x distance x tête), 126 scénarios « tirs pour tuer un zombie de la manche 10 à 8 m » rejoués par la vraie chaîne de tir (126 / 126 égaux), 72 dégâts de zone, 160 dégâts de couteau, trajectoires de 4 obus (contre `Collision` JS, sol compris) et de 3 grenades ; scénarios : cadence, semi, plombs, rechargement, perforation, mur, points, ADS, M79 (armé, direct, auto-dégâts), pistolet à rayons, grenades (mèche, plafond), inventaire, PaP, atouts, couteau (corps, tête, dos, cône, délai, hache, arme vide), achats au mur et à la borne sur la carte de Strasbourg, et un bot qui tue la manche 1 avec chacune des 23 armes.
- **Écarts connus** : viewmodels `.glb` et accessoires du PaP non faits (primitives) ; pas de son ni d'éclair de tir / de douille ; les cibles spéciales (Bourreau, Maître Tanneur, Ange, zombies cuirassés, rampants) attendent J3 / J10 : `area_damage` appelle `make_crawler()` et `hit_zombie` lit `armor` seulement si `ZombieSim` les définit ; bonus Mort instantanée / Points doubles (J6) absents des dégâts et des points ; la bouche de l'arme est une constante (`WeaponArms.MUZZLE`) au lieu des mesures de `viewmodels.js` ; dispersion avec l'ouverture de J1 (voir J1) ; explosions et tracés non vérifiés visuellement (seule l'arme et le HUD l'ont été) ; vitesses de grenade et de mèche dans `WeaponBlast` (constantes de main.js / player.js à remonter dans `CONFIG`).

Notes : le JSON ne porte pas de couleurs (entiers 0xRRGGBB, convertis par `Config.color()`) ; la formule de santé par manche (`zombieHealthAt`, dans `main.js`, non importable sans Three.js) est recopiée dans `tools/export-golden.mjs` et dans `Game.zombie_health_at` : si elle change dans `main.js`, mettre à jour les deux.

---

## 1. Inventaire et équivalents Godot

### 1.1 Architecture cible (vue d'ensemble)

```
godot/
  project.godot
  autoload/      Config, Game (état de partie = l'« hôte »), Settings, Keybinds, Sfx, Music, Fx, UiStack   (Net : J12)
  sim/           code pur (RefCounted, sans nœud ni rendu) : collision, levels, nav_grid, tram_track, pap, falloff, rng…
  scenes/        main, world/, player/, zombies/, bosses/, vehicles/, tram/, machines/, ui/, menus/
  shaders/       façade, sol, ciel, peau des zombies, feuillage, particules, taches, post (Compositor)
  data/          config.json, world/ (monde « cuit »), golden/ (valeurs de référence pour les tests)
  assets/        textures/ (PBR copiées de public/textures), models/ (prototypes .glb), baked/ (textures canvas en PNG), audio/ (sons cuits)
  tests/         runner.tscn + test_*.gd (lancés en headless)
```

Principes :
- **Autoloads** pour ce qui est global et unique dans le JS (l'objet `game` de `main.js`, `CONFIG`, `sfx`, `fx`, `settings`, `game.binds`, `game.ui`).
- **Code pur dans `sim/`** pour tout ce qui ne dépend pas de Three.js (21 modules sur 66 sont déjà dans ce cas) : testable en headless, comparable
  au JS valeur par valeur.
- **Scènes** pour ce qui a une présence 3D ou UI ; un script par scène, les modules `installX(game, ctx)` du JS deviennent des nœuds enfants de
  la scène principale (ou des autoloads s'ils sont transverses).
- **Shaders Godot** (`.gdshader`) pour chaque `onBeforeCompile` / `ShaderMaterial` / `RawShaderMaterial` du JS (8 occurrences).

### 1.2 Inventaire des modules (`src/`)

Légende difficulté : **S** simple (traduction directe), **M** moyen (adaptation d'API), **L** lourd (refonte ou outil de cuisson), **XL** très lourd.

#### Noyau, boucle et état

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `main.js` | 2 221 | Renderer, caméra, lumières, objet `game` (manches, apparitions, `hitZombie`, points, bonus, portes, boîte, grenades, explosions), gestionnaires réseau (l. 1462-1860), menus, boucle `frame()` | Éclaté : autoload `Game` (état et règles hôte), `scenes/main.tscn` (WorldEnvironment, lumières, caméra), `RoundDirector`, `Economy`, `Explosions`, `NetHandlers` (J12). Boucle = `_physics_process` | XL |
| `config.js` | 752 | Équilibrage et réglages (`CONFIG`, `PAP_LEVELS`), résolution des calibres, `papStats`, `falloffMult`, `papPulse` | `data/config.json` (exporté) + autoload `Config` ; fonctions pures dans `sim/pap.gd` | S |
| `ui.js` | 185 | Pile des couches d'interface, touche Échap | Autoload `UiStack` | S |
| `debugMenu.js` | 267 | Menu F9 de l'hôte (téléportation, réanimation, déblocage, perfs) | `scenes/ui/debug_menu.tscn` (la partie téléportation de joueurs distants attend J12) | S |
| `unstick.js` | 144 | Se débloquer (K maintenu) | Nœud enfant du joueur, utilise `NavGrid.components()` | S |

#### Monde et carte

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `realworld.js` | 2 044 | Construction de la Grande Île depuis `area.json` : île, sol, eau, bâtiments, passages, limites, gravats, zones, fenêtres d'apparition, portes, objets des zones, plan de la carte, lampadaires, décor, corrections de collision, navigation. Tirage `seeded(20240611)` (mulberry32) | **Cuisson** (voir § 3.2) : `tools/bake-world.mjs` exécute ce code dans Chrome et exporte géométrie (`.glb`) et données de jeu (JSON/binaire). Côté Godot : `scenes/world/strasbourg.tscn` + `world_loader.gd` | XL |
| `world.js` | 215 | Arène de test 60 x 60 m (`CONFIG.map = 'arena'`) | `scenes/world/arena.tscn`, **portée à la main** : c'est le terrain de J1 | S |
| `island.js`, `breach.js`, `passage.js` | 138 / 92 / 127 | Zone jouable, brèches, passages sous immeubles (géométrie 2D pure) | Restent côté JS (cuisson) | — |
| `architecture.js` | 857 | Façades dessinées sur canvas, toits, `building:part` 3D, shader de façade | Géométrie cuite en `.glb` ; textures canvas cuites en PNG ; `shaders/facade.gdshader` | L |
| `relief.js` | 198 | Relief des façades instancié par tuiles, coupé selon la distance | `MultiMeshInstance3D` par tuile (transforms cuites) + `visibility_range_end` selon la qualité | M |
| `ground.js` | 273 | Sol pavé : champ de distance aux façades (trottoirs, caniveaux), mousse, flaques, plaques d'égout | `shaders/ground.gdshader` + texture de distance cuite (PNG 16 bits ou EXR) | M |
| `trees.js` | 242 | Arbres : boules / cartes de feuillage / branches selon la qualité, ondulation | `MultiMeshInstance3D` + `shaders/foliage.gdshader` ; atlas cuit | M |
| `props.js` | 306 | Mobilier urbain instancié, textures procédurales | Prototypes `.glb` + `MultiMeshInstance3D` (transforms cuites) | M |
| `parking.js`, `bikeStation.js` | 124 / 88 | Parkings des motos, stations de vélos (positions pures + décor) | Données cuites + petites scènes de décor | S |
| `hommedefer.js` | 770 | Place de l'Homme de Fer : rotonde, abris, quais, rames de décor, statue | Cuit (`.glb` + collisions) | M |
| `tramNet.js` | 360 | Voies, quais, heurtoirs, feux, caténaire | Cuit ; les feux de porte restent dynamiques (petit script) | M |
| `tramTrack.js` | 226 | Géométrie pure des voies (abscisse `s`, cap, courbure, aiguillages) | `sim/tram_track.gd`, **porté** (le tram en dépend en jeu) | M |
| `sky.js` | 97 | Dôme : dégradé, nuages, lune | `shaders/sky.gdshader` (`shader_type sky`) dans le `WorldEnvironment` | M |
| `cathedral.js` + `cath/*` | 475 + 1 193 | Intérieur jouable de la cathédrale (plan réel, nef, galeries, crypte, tour, flèche jusqu'à 142 m), étages et liens d'escaliers | Cuit (`.glb`, triangles de `Levels`, liens) ; vitraux et taches de lumière dans des shaders | L |
| `ironArmor.js` | 136 | Pièces d'armure partagées (statue, chevaliers) | Prototypes `.glb` | S |
| `contact.js` | 120 | Ombres de contact (2 InstancedMesh) | `MultiMeshInstance3D` statique (cuit) + un dynamique mis à jour à chaque image | S |

#### Simulation spatiale (sans rendu)

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `collision.js` | 293 | Cercles contre segments et cercles (grille de 4 m, bandes de hauteur), boîtes, obstacles dynamiques, enjambement, `rayHit` | `sim/collision.gd` **porté tel quel** (voir décision D3) | M |
| `levels.js` | 241 | Étages : triangles par région, `floorAt`, liens d'escaliers, `nextHop` | `sim/levels.gd` porté | M |
| `nav.js` | 331 | Grille 0,75 m (2 187 x 1 493 cases sur l'île) + champ de flux borné (160 m, 25 000 cases par image, toutes les 0,2 s), composantes connexes | `sim/nav_grid.gd` porté, **point chaud de performance** (voir R2) | L |

#### Joueur, personnages, armes

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `player.js` | 930 | Déplacement, saut, sprint, enjambement, tir (Raycaster sur les zombies + `rayHit` pour les murs), couteau, hache, grenades, rechargement, ADS, dégâts, à terre / réanimation | `scenes/player/player.tscn` (Node3D + Camera3D) + `player.gd` ; mouvement par `sim/collision.gd`, pas de `CharacterBody3D` (D3) | L |
| `characters.js` | 612 | 8 personnages articulés, cinématique inverse à deux segments pour les bras, portraits | Prototypes `.glb` (hiérarchie d'articulations conservée) + `avatar.gd` (IK analytique portée) ; portraits par `SubViewport` | M |
| `viewmodels.js` | 467 | Armes à la première personne, accessoires du Pack-a-Punch | Prototypes `.glb` par arme et par niveau, scène `viewmodel.tscn` (calque de rendu séparé, FOV propre) | M |
| `weaponDisplay.js` | 120 | Copies d'armes (boîte, PaP, coéquipiers) | Instanciation des mêmes `.glb` | S |
| `rideCam.js` | 172 | Vue 3e personne sur moto / tram, collision caméra | `ride_cam.gd` (les 3 rayons passent par `sim/collision.gd`) ; `SpringArm3D` écarté (il interroge la physique Godot) | S |
| `keybinds.js`, `keysMenu.js` | 159 / 159 | Liaisons de touches (`code:` physique / `key:` lettre tapée), menu Options > Touches | Autoload `Keybinds` sur `InputMap` : `physical_keycode` pour `code:`, `key_label` pour `key:` ; sauvegarde `user://keybinds.cfg` | M |
| `launcher.js` | 113 | Projectiles du M79 | `projectile.gd` (simulation au pas de temps) | S |

#### Zombies, boss, fin de partie

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `zombie.js` | 741 | Modèle articulé, apparition (fenêtre, sol), IA (champ de flux, enjambement, liens d'étage), rampants, variantes, mort, cendres, pantin réseau | `scenes/zombies/zombie.tscn` + `zombie.gd` (IA) + `zombie_pose.gd` (animation procédurale) | L |
| `zombieSkin.js` | 329 | Atlas visages / peaux / vêtements, sang progressif (uniformes `uCell`, `uBlood`) | `shaders/zombie_skin.gdshader` avec `instance uniform` (cellule, sang) ; atlas cuits en PNG | M |
| `boss.js` | 525 | Le Bourreau : machine à états en 4 phases (charge, onde, chaînes, Sentence, Couperet, Bûcher) | `bosses/boss.gd` (hérite de `zombie.gd`) | L |
| `tanner.js`, `angel.js` | 133 / 334 | Maître Tanneur, Ange du Jugement (sous-classes du Bourreau) | `bosses/tanner.gd`, `bosses/angel.gd` | M |
| `finale.js` | 840 | « L'Heure du Jugement » : intro, 3 vagues, Bourreau, ascension, Acte V, trophée | `finale_director.gd` (nœud de la scène principale) | L |
| `summit.js` | 212 | Acte V : faisceau, Fanal, ciel nuit -> jour, vue orbitale, rafales | `summit_fx.gd` + animation des paramètres du `WorldEnvironment` et du ciel | M |

#### Machines, véhicules

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `machines.js` | 435 | Modèles des distributeurs d'atouts, borne de munitions, armes murales à la craie, boîte, PaP, horloge | Prototypes `.glb` + textures canvas cuites | S |
| `machineFx.js` | 339 | Animations et logique de la boîte mystère et du Pack-a-Punch | `machines/mystery_box.gd`, `machines/pack_a_punch.gd` | M |
| `vehicles.js` | 836 | Motos et vélos : conduite arcade, places, collisions, écrasement, PV, feu, épave, retour au parking | `vehicles/vehicle.gd` (cinématique maison, pas de `VehicleBody3D` : D3) | L |
| `vehicleModels.js` | 262 | Modèles des motos et vélos (sièges `hip` / `eye`) | Prototypes `.glb` ; les points `hip` / `eye` deviennent des `Marker3D` | S |
| `tram.js` | 719 | Rame de 5 modules articulés sur la voie, courant, portes, gong, aiguillages | `tram/tram.gd` + `tram.tscn` (5 modules) | L |
| `tramInterior.js` | 284 | Intérieur praticable de la rame (collisions locales) | `tram/tram_interior.gd` (code pur, porté) | M |

#### Interface, réseau

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `hud.js` + `index.html` | 726 + 364 | HUD (vie, munitions, points, manche, inventaire, bonus, véhicule, annonces, marqueurs, radar, boussole, carte plein écran, barres de boss), menus en DOM/CSS | `scenes/ui/hud.tscn` (Control + `Theme`), radar / boussole / carte en `_draw()` personnalisés ; menus en scènes `Control` | L |
| `remote.js` | 256 | Coéquipiers distants : étiquettes, losanges, croix | J12 (`Label3D` / `Sprite3D` sans test de profondeur) | M |
| `net.js` | 44 | Client WebSocket du relais | J12 : `WebSocketPeer` (voir D7) | S |
| `chat.js`, `chatText.js` | 214 / 11 | Chat écrit (multijoueur) | J12 | S |

#### Audio et rendu

| Fichier | Lignes | Rôle | Équivalent Godot | Diff. |
|---|---:|---|---|:-:|
| `audio.js` | 619 | Tous les sons **synthétisés** en WebAudio (4 couches par coup de feu, écho des façades, réverbération), moteur des motos, musique personnalisée `theme.*` | **Cuisson** en WAV (§ 3.4) + autoload `Sfx` (`AudioStreamPlayer3D`, `AudioStreamRandomizer`, bus avec `AudioEffectReverb` / `AudioEffectDelay`) | L |
| `music.js` | 461 | Rock synthétisé en direct, intensité selon la manche | Boucles cuites par intensité + `AudioStreamInteractive` ou fondu entre deux lecteurs ; étouffement = `AudioEffectLowPassFilter` sur le bus Musique | M |
| `dsp.js` | 37 | Utilitaires de synthèse | Reste côté JS (outil de cuisson) | — |
| `graphics.js` | 322 | Qualité (Rapide / Normale / Haute), exposition et tone mapping par zone, ombres, PMREM, cible MSAA, table de couleurs | `graphics.gd` + `WorldEnvironment` (tonemap, `adjustment_color_correction` en `Texture3D`, glow), `DirectionalLight3D` (ombres), réglages du `Viewport` (MSAA, échelle 3D) | M |
| `envmap.js` | 22 | Reflets d'ambiance partagés | `Environment.reflected_light_source` = ciel ; intensités par matériau | S |
| `fx.js` | 338 | Particules instanciées (atlas 8 cellules), taches de sang sol et murs, éclair de tir | `MultiMeshInstance3D` + `shaders/particle.gdshader` (billboard) ; taches : quads instanciés (D5) | M |

### 1.3 Autorité : ce que l'hôte simule, ce qui est synchronisé, ce qui reste local

Le relais `server/rooms.mjs` ne simule rien : il crée les salons (code de 4 lettres, 4 joueurs, emplacements 0-7), nettoie et limite le chat,
filtre les `dbg_*`, et relaie le reste (`msg.to` ciblé ou diffusion). **En solo, la machine locale est l'hôte d'une partie à zéro client.** Le portage
garde exactement ce découpage ; en solo, la colonne « Synchronisé » est simplement inactive, mais chaque mutation autoritaire passe déjà par une
méthode de l'autoload `Game` (le futur point d'émission du message).

| Système | L'hôte simule | Synchronisé (messages actuels) | Local à chaque machine |
|---|---|---|---|
| Joueur (déplacement) | Rien : chaque machine simule SON joueur | `p_state` 20 Hz (position, visée, PV, arme, PaP, à terre, tram…) | Caméra, entrées, viewmodel, collisions du joueur |
| Dégâts reçus | Attaques des zombies et des boss, souffle des explosions | `hurt` (hôte -> joueur visé), `p_down`, `revive_req` / `revive`, `game_over` | Application des PV, écran rouge, régénération |
| Tir | Dégâts, morts, points | `z_hit` (tireur -> hôte), `pts` (hôte -> tireur), `p_shot` (visuel chez les autres) | Détection d'impact chez le tireur, recul, traceur, sang de ses propres tirs |
| Zombies | Apparition, IA, champ de flux, PV, variantes, mort | `z_spawn`, `z_tick` 20 Hz (id, x, z, yaw, attaque, y, état de boss), `z_dead`, `z_crawl` | Animation déduite de l'état, skin tiré de l'id (hachage), sang progressif, culling au-delà de 170 m |
| Manches | Compteur, apparitions restantes, intermission, santé et vitesse par manche | `round_start`, `round_end`, `sync` (arrivée en cours de partie) | Annonce, musique |
| Économie | Points accordés (`pts`) ; les points de chacun sont tenus par sa machine | `door_open` (tout acheteur), `pts` | Achat d'armes murales, munitions, atouts (dépense locale) |
| Boîte mystère, PaP | Tirage de l'arme, déplacement de la boîte, file du PaP | `box_req` / `box_roll` / `box_take` / `box_taken` / `box_move`…, `pap_req` / `pap_start` / `pap_taken` | Animations (tout le monde les voit) |
| Bonus (power-ups) | Lâcher, ramassage (premier arrivé), effets d'équipe | `pu_spawn`, `pu_pickup` (client -> hôte), `pu_collect` | Halo, son, HUD des bonus |
| Grenades, M79 | Dégâts de zone uniquement | `nade` (le lanceur diffuse sa trajectoire), `boom`, `splash` | Trajectoire simulée partout (écart purement visuel) |
| Motos, vélos | Places (arbitrage), PV, feu, explosion, retour au parking | `v_state` 20 Hz (par le CONDUCTEUR), `v_req` / `v_seats` / `v_deny`, `v_dmg` -> `v_hp`, `v_burn`, `v_boom`, `v_respawn`, `v_fuel`… | Conduite par le conducteur, interpolation chez les autres, caméra 3e personne |
| Tram | Courant (achat commun), PV, gong | `t_state` (conducteur), `t_power`, `t_doors`, `t_gong`, `t_wreck`, places comme les motos | Marche dans la rame (repère local de la rame) |
| Fin de partie, boss | Machine à états du finale et des boss | `finale_*`, `boss_fx`, code d'état `bs` dans `z_tick`, `mini_info`, `summit_beam`, `dawn` | Chronologie du ciel (secondes réelles), vue orbitale, effets |
| HUD, audio, graphismes, options, touches | — | — | Tout (aucun message réseau) |
| Chat | — (le relais nettoie et limite) | `chat` | Affichage |

---

## 2. Ordre de portage par jalons

Chaque jalon se termine par un **livrable jouable ou testable** et une **vérification** : tests headless (§ 3.5) + une courte session visuelle.
Un jalon n'est validé que si les tests headless des jalons précédents passent toujours. Les tailles sont relatives (S < M < L < XL).

### J0. Fondations et outillage (S)
- Créer `godot/` (projet 4.7, moteur de rendu Forward+ pour le bureau ; voir D1), `.gitignore` (`godot/.godot/`, `godot/build/`, `godot/assets/audio/music/theme.*`).
- `tools/export-config.mjs` : importe `src/config.js` (sa résolution des calibres s'exécute à l'import), écrit `godot/data/config.json`
  (`CONFIG` + `PAP_LEVELS`, ~32 Ko, vérifié : aucune fonction ni valeur infinie dans `CONFIG`).
- Autoload `Config` (lecture du JSON, accès typé) ; `sim/pap.gd` (`papStats`, `papAmmoMult`, `papPulse`, `falloffMult` portés).
- `tools/export-golden.mjs` : valeurs de référence calculées par le JS (`papStats` de chaque arme à chaque niveau, `falloffMult` sur une grille de
  distances, santé des zombies par manche…) dans `godot/data/golden/`.
- Lanceur de tests headless `tests/runner.tscn`.
- **Vérification** : `godot --headless --path godot --import` sans erreur ; `godot --headless --path godot res://tests/runner.tscn` rend 0 ;
  tous les golden de J0 égaux (tolérance 1e-6).

### J1. Squelette jouable solo dans l'arène (M) — fait, v0.2.0
- `scenes/world/arena.tscn` (portage de `world.js`), `sim/collision.gd` porté, `player.gd` (marcher, sprinter, sauter, gravité, visée souris,
  `Input.mouse_mode = CAPTURED` à la place du pointer lock), **une** arme hitscan (M1911), un zombie simple qui fonce vers le joueur (sans champ de
  flux), manches minimales (`startRound`, `zombieHealthAt`), points (10 / 60 / 100), mort et écran de fin, HUD minimal (vie, munitions, points, manche).
- Boucle : simulation dans `_physics_process` à 60 Hz (D4), rendu et souris dans `_process` / `_input`.
- **Vérification** : golden `Collision.resolve` et `rayHit` (1 000 cas tirés côté JS) égaux à 1 mm près ; scénario headless « un bot immobile
  est tué en N secondes à la manche 1 » et « un bot qui tire tue la manche 1 » ; capture vidéo de 10 s (`--write-movie`).
- **Compromis** : boucle à pas fixe = tests reproductibles, mais une sensation de souris à soigner (la visée reste hors du pas fixe) ;
  l'interpolation physique de Godot lisse le rendu.

### J2. Carte de Strasbourg (XL)
- `tools/bake-world.mjs` (Playwright, comme `make-docs.mjs`) : lance le jeu en `?debug`, attend `buildRealWorld`, exporte :
  - **données de jeu** (JSON + binaires) : segments, cercles et boîtes de collision (hauteurs infinies encodées : JSON n'a pas `Infinity`),
    triangles et liens de `Levels`, grille `blocked` de la navigation (binaire 1 octet par case, ~3,3 Mo), zones et leurs cases, portes (prix,
    segments, zones reliées), fenêtres d'apparition, emplacements des machines et armes murales, emplacements possibles de la boîte, parkings,
    stations de vélos, voies du tram, plan de la carte (polygones pour la carte plein écran), lampadaires ;
  - **géométrie** en `.glb` par tuile (GLTFExporter de Three.js) : bâtiments, toits, sol, eau, cathédrale, Homme de Fer, décor ; les InstancedMesh
    exportés en **listes de transforms** (JSON) pour reconstruire des `MultiMeshInstance3D` (ne pas dépendre de l'import de
    `EXT_mesh_gpu_instancing`, à vérifier) ;
  - **textures canvas** en PNG (façades, toits, machines, atlas).
- Côté Godot : `world_loader.gd` (charge les données dans `Collision`, `Levels`, `NavGrid`, crée les portes et les objets), matériaux PBR des
  textures de `public/textures` (copiées), shaders simplifiés (couleur + normale, sans les effets de J9).
- Portes payantes (ouvrir = retirer les segments de collision et débloquer la navigation), étages de la cathédrale praticables.
- **Vérification** : comptes égaux au JS (zones 27, portes, fenêtres, objets) ; golden `floorAt` et `rayHit` sur 2 000 points de l'île ;
  bot headless qui va du Marché-Neuf à la place Kléber après ouverture des portes ; captures de 5 lieux repères (mêmes coordonnées que des
  captures du jeu JS, comparées à l'œil) ; temps de chargement mesuré.

### J3. Zombies et IA (L)
- `sim/nav_grid.gd` (champ de flux borné, budget par image, composantes), `zombie.gd` : apparition par fenêtre et depuis le sol, poursuite, attaque,
  enjambement, liens d'escalier, coureurs, rampants (jambes arrachées), pestiférés, chevaliers de fer, gargouilles ; `relocateZombies` ;
  équilibrage de l'apparition entre joueurs (`spawnBalance`, utile dès qu'il y a plusieurs cibles) ; modèle articulé (`.glb`) + `zombie_pose.gd` ;
  peau simple (le shader d'atlas complet est en J9).
- **Vérification** : golden du champ de flux (distances sur des cases tirées, même cible, même état des portes) ; **banc d'essai headless** :
  22 zombies + champ de flux sur la grande carte, temps moyen et 99e centile de `_physics_process` (cible : < 4 ms sur le poste de dev, voir R2) ;
  portage partiel de `tools/stuck-scan.mjs` (étape `bots` : 200 bots, 60 s simulées, aucun bloqué plus de 2 s).
- **Compromis** : porter le champ de flux tel quel garde le comportement réglé (rues étroites, liens d'étage) ; `NavigationServer3D` serait natif
  et rapide, mais demanderait de cuire un navmesh multi-étages de 1,6 x 1,1 km et changerait le comportement des hordes.

### J4. Armes (L)
- Toutes les armes de `CONFIG.weapons` (auto, semi, fusil à pompe, perforation, chute des dégâts, ADS avec lunette), calibres, rechargement,
  couteau et Hache du Bourreau, grenades, M79 (projectile armé), arbalète (carreau explosif), pistolet à rayons ; viewmodels `.glb` et accessoires
  du PaP ; armes murales et bornes de munitions ; dégâts aux zombies avec tête (sphère) et corps (capsule) (D3).
- **Vérification** : golden des dégâts (arme x niveau x distance x tête) ; scénario headless « chaque arme tue un zombie de manche 10 en
  N tirs » comparé au JS ; captures des viewmodels comparées à `docs/armes.png`.

### J5. Véhicules (L)
- J5a : motos et vélos (conduite arcade de `vehicles.js`, places, essence, PV, feu, épave, retour, écrasement au-dessus d'une vitesse, chute à vélo),
  borne de service, `ride_cam.gd`.
- J5b : tram (voie, 5 modules articulés, courant, portes, gong, aiguillages, intérieur praticable, feux des portes de zone).
- **Vérification** : golden `Track` (position et cap à des abscisses données, aiguillages) ; scénario headless « moto à pleine vitesse sur une
  ligne droite : distance parcourue en 5 s » comparé au JS ; « tram de quai à quai » ; vidéo.

### J6. Power-ups, atouts et machines (M)
- Bonus lâchés (Max Munitions, Mort instantanée, Bombe, Points doubles, bidons d'essence), bonus d'ouverture de zone ; 7 atouts (Mastodonte,
  Speed Cola, Double Tap, Réanimation rapide, Mule Kick, Stamin-Up, PHD Flopper) ; boîte mystère (tirage, nounours, déplacement) ;
  Pack-a-Punch à 3 niveaux.
- **Vérification** : golden des probabilités (tirage sur 100 000 essais à graine fixe côté Godot, comparé aux proportions attendues de la config) ;
  scénario headless « acheter chaque atout, vérifier les stats de `statsOf` ».

### J7. HUD complet et menus (L)
- HUD complet (radar, boussole, inventaire, bonus, atouts, véhicule, barres de boss, annonces, popups de points, marqueur de touche), carte
  plein écran (plan cuit en J2), écran titre, choix du personnage, options (luminosité, FOV, sensibilité, qualité, volumes, effets cinéma, halo),
  Options > Touches (capture, conflits, réinitialisation), pause, game over, victoire ; `UiStack` et Échap ; réglages dans `user://settings.cfg`.
- **Vérification** : tests headless de `UiStack` (ordre des couches, Échap) et des liaisons (AZERTY / QWERTY simulés par `InputEventKey`) ;
  captures de chaque écran comparées au JS.

### J8. Audio (M)
- Sons cuits (§ 3.4), autoload `Sfx`, bus (Maître, Effets, Musique, Réverbération), sons 3D, moteur de moto en boucle avec `pitch_scale`,
  musique adaptative (intensité selon la manche, à fond pendant la finale, étouffée en pause), musique personnalisée `theme.*` facultative.
- **Vérification** : headless (pilote audio Dummy) : aucun lecteur en erreur, nombre de voix simultanées borné ; écoute manuelle.

### J9. Graphismes (L)
- Shaders : façade (salissures, pied de mur), sol (trottoirs, flaques, plaques), ciel (nuages, lune), peau des zombies (atlas, sang progressif),
  feuillage (cartes, vent), particules (billboard, atlas), taches de sang, vitraux. Niveaux de qualité Rapide / Normale / Haute, exposition par zone,
  ombres de la lune, reflets d'ambiance, table de couleurs, halo (glow), vignette et grain, relief des façades par distance.
- **Vérification** : captures aux 5 lieux repères dans les 3 qualités, comparées au JS ; FPS et appels de rendu (moniteurs `Performance`) au
  Marché-Neuf et dans la nef.

### J10. Fin de partie (L)
- Maître Tanneur, intérieur de la cathédrale et horloge, « L'Heure du Jugement » (vagues, Bourreau en 4 phases), Acte V (gargouilles, Ange,
  rafales, Fanal, l'Aube, vue orbitale, écran de fin, trophée dans `user://`), Nuit éternelle et mode sans fin.
- Peut être avancé juste après J7 (il dépend de J3 à J6) ; le ciel de l'Aube a besoin du ciel de J9.
- **Vérification** : scénario headless qui saute à la manche 12 avec 18 quartiers ouverts (raccourcis de debug), déroule le finale avec des
  dégâts forcés et vérifie l'enchaînement des états ; vidéo de l'Aube.

### J11. Parité solo (M)
- Portage du reste de `stuck-scan` (poches-pièges, murs invisibles), du menu debug (sauf ce qui concerne les autres joueurs), de `unstick`.
- Revue de parité avec `docs/REFERENCE.md` ligne par ligne ; test d'export (bureau, puis web si D1 le retient).
- **Vérification** : partie complète en solo jusqu'à l'Aube sans blocage.

### J12. Multijoueur (reporté)
- Autoload `Net` sur le relais existant (D7), `remote_player.tscn`, chat, menu debug complet, arrivée en cours de partie (`sync`).
- **Vérification** : équivalent Godot de `tools/mp-smoke.mjs` (hôte + 2 clients headless sur le relais local).

---

## 3. Réutilisation des données et vérification

### 3.1 Configuration (`src/config.js`)
- **Source unique : `src/config.js`**, tant que le jeu JS vit. `tools/export-config.mjs` produit `godot/data/config.json` ; on ne modifie jamais
  le JSON à la main. Les couleurs `0xRRGGBB` arrivent en entiers : `Config` les convertit en `Color` à la lecture.
- Le post-traitement (résolution des calibres) s'exécute à l'import du module, donc le JSON contient déjà `damage`, `headMult`, `pierce` et
  la chute des dégâts de chaque arme ; seules les **fonctions** (`papStats`, `papAmmoMult`, `papPulse`, `falloffMult`) sont portées en GDScript,
  contrôlées par les golden.
- `server/rooms.mjs` lit aussi `CONFIG.chat` : la config doit rester du JS importable par Node (raison de plus pour qu'elle reste la source).
- Décision D8 : si le port remplace un jour le jeu JS, la source deviendra un fichier Godot (JSON ou `Resource`) et le relais lira ce JSON.

### 3.2 Carte et monde
- `public/data/area.json` (1,37 Mo : 3 186 bâtiments, 764 parties, 62 passages, 61 plans d'eau, 2 127 arbres, 159 lampadaires, 1 496 objets)
  est déjà une extraction d'OSM (par `tools/fetch-osm.mjs` depuis `data/osm_raw.json`). Il n'est **pas** relu par Godot : c'est l'entrée de la cuisson.
- **Cuisson recommandée (D2)** : la construction du monde (`realworld.js` et ses dépendances : ~6 000 lignes) dépend d'un tirage `seeded(20240611)`
  dont l'ORDRE est figé par des contorsions (`ghosts`, `isolatedRnd`, zones `outer` avec leur propre générateur) : la réécrire en GDScript coûterait
  très cher, serait lente au chargement et dériverait. On l'exécute donc dans Chrome et on exporte le résultat (§ J2).
  Avantage pour le multijoueur : tous les pairs chargent les mêmes fichiers, plus besoin d'un tirage identique sur chaque machine.
- Format : JSON pour ce qui est petit et structuré, binaire brut (`PackedByteArray` / `PackedFloat32Array` via `FileAccess`) pour la grille de
  navigation et les gros tableaux de segments ; une **empreinte** (hachage) de chaque fichier est écrite par la cuisson et vérifiée au chargement.
- `docs/carte.png`, `docs/REFERENCE.md`, `docs/csv/` restent produits par `tools/make-docs.mjs` (JS) : ce sont les références de parité.

### 3.3 Assets graphiques
- `public/textures/*` (7 matériaux PBR : diffuse, normale, rugosité ; ~19 Mo de JPEG) : copiés tels quels dans `godot/assets/textures/`.
  Les normales sont au format OpenGL (Y+), celui qu'attend Godot : pas de conversion. Le canal de rugosité est importé en canal R.
- Tous les modèles du jeu sont **construits en code** (personnages, zombies, armes, motos, machines, mobilier, armures) : `tools/bake-models.mjs`
  exporte chaque prototype en `.glb` (hiérarchie d'articulations conservée : hanches, genoux, épaules, coudes, mâchoire ; points `hip` / `eye`,
  `muzzle` en nœuds vides). Les matériaux standard passent ; les `onBeforeCompile` sont perdus et réécrits en `.gdshader`.
- **Textures canvas** (20 modules dessinent sur un canevas 2D : façades, toits, machines, atlas des zombies, feuillage, particules, étiquettes…) :
  cuites en PNG par le même outil. Godot n'a pas d'API canvas 2D équivalente pour produire des textures (l'`Image` ne dessine ni chemins ni texte) ;
  les quelques textures vraiment dynamiques (étiquettes des coéquipiers, J12) passent par un `SubViewport` ou un `Label3D`.

### 3.4 Audio
- `audio.js` et `music.js` synthétisent tout en WebAudio ; une synthèse échantillon par échantillon en GDScript (`AudioStreamGenerator`) serait
  bien trop lente. **`tools/bake-audio.mjs`** rend chaque son dans Chrome avec un `OfflineAudioContext` (le code existant programme déjà tout sur
  l'horloge audio, option `at`) et écrit des WAV : 3 à 4 variantes par son aléatoire (`AudioStreamRandomizer` + variation de hauteur), sons
  « secs » sans l'écho ni la réverbération (refaits par les bus Godot pour qu'ils suivent la position).
- Musique : boucles cuites par intensité (calme, montée, dure, finale), enchaînées par `AudioStreamInteractive` ou par fondu entre deux lecteurs.
- `public/music/theme.*` reste **hors du dépôt** : Godot le cherche dans `user://music/` ou `res://assets/audio/music/` (ignoré par git) et le
  charge à l'exécution (`AudioStreamMP3.load_from_file`, `AudioStreamOggVorbis.load_from_file`, WAV) ; `LISEZMOI.txt` sera adapté.

### 3.5 Vérification en headless (`godot --headless`)
Options vérifiées sur la 4.7.2 installée : `--headless`, `--path`, `--import`, `-s/--script`, `--check-only`, `--quit-after`, `--fixed-fps`,
`--write-movie`, `--export-release`, `--log-file`.

| Besoin | Commande | Remarque |
|---|---|---|
| Importer les ressources (CI, après une cuisson) | `godot --headless --path godot --import` | Échoue si un asset ne s'importe pas |
| Vérifier qu'un script se compile | `godot --headless --path godot --check-only -s res://sim/nav_grid.gd` | Pour les scripts purs |
| Lancer les tests | `godot --headless --path godot res://tests/runner.tscn -- --suite=j3` | Passer par une **scène** : les autoloads (`Config`, `Game`) sont chargés ; le code de sortie vient de `get_tree().quit(code)` |
| Scénario reproductible | `… --fixed-fps 60 -- --scenario=round1 --seed=1` | Avec `--fixed-fps`, le temps simulé ne dépend plus de la machine ; arguments lus par `OS.get_cmdline_user_args()` (remplace `?debug&x&z&yaw`) |
| Banc d'essai | `… -- --bench=zombies` | Mesure `Time.get_ticks_usec()` autour de `_physics_process` ; sortie JSON |
| Visuel (non headless) | `xvfb-run godot --path godot --write-movie out/run.png --fixed-fps 30 --quit-after 300 -- --scenario=tour_kleber` | Le mode headless ne rend rien : les captures demandent un vrai rendu (écran virtuel), une image PNG par frame |
| Export | `godot --headless --path godot --export-release "Linux" build/zombie.x86_64` | Modèles d'export à installer ; web si D1 |

Les **golden** sont le cœur de la vérification : chaque module porté (config, PaP, chute des dégâts, collision, étages, navigation, voies du tram,
intérieur de la rame) est comparé aux sorties du JS (`tools/export-golden.mjs` en Node pour les modules sans Three.js, Playwright pour les autres).
La règle de `CLAUDE.md` (« vérifier avec `npx vite build` et Playwright ») devient, pour `godot/` : import headless + suite de tests headless +
une session visuelle.

---

## 4. Risques et décisions à trancher

### 4.1 Risques

| # | Risque | Gravité | Parade |
|---|---|:-:|---|
| R1 | **Rendu sur mesure de Three.js** : 8 shaders (`onBeforeCompile` sur façades, sol, arbres, particules, taches, peau des zombies ; `ShaderMaterial` du ciel ; `RawShaderMaterial` du post-traitement) écrits contre les chunks de Three.js, sans équivalent direct | Haute | Réécriture en `shader_type spatial` / `sky` ; post-traitement par `Environment` (tonemap ACES / AgX, `adjustment_color_correction` en `Texture3D` pour la table 32³, glow) et, si besoin, un `CompositorEffect` ; un shader par jalon J9, comparé par captures |
| R2 | **Performance de GDScript** dans les boucles serrées : champ de flux (25 000 cases par image, 8 voisins), collisions de ~30 entités, IA de 22 zombies, rendu de particules. V8 compile à la volée, GDScript est interprété (ordre de grandeur : plusieurs fois plus lent) | Haute | GDScript typé + `PackedInt32Array` ; banc d'essai dès J3 ; si la cible n'est pas tenue : baisser le budget par image (le champ est déjà incrémental), puis passer le seul champ de flux en GDExtension C++ (D6) |
| R3 | **Physique** : le jeu repose sur une collision 2,5D maison (cercles contre segments avec bandes de hauteur, triangles d'étage, marche de 0,6 m, enjambement) réglée finement (corrections v0.35.2, `stuck-scan`) | Haute si on change de modèle | Porter la collision maison (D3) ; n'utiliser la physique Godot pour rien de ce qui touche au gameplay |
| R4 | **Volume du monde** : 3 186 bâtiments, cathédrale détaillée, décor instancié ; risque sur le temps de chargement et les appels de rendu | Moyenne | Cuisson en tuiles `.glb`, `MultiMeshInstance3D`, `visibility_range`, occlusion culling (Forward+), mesure dès J2 |
| R5 | **Netcode** : ~90 types de messages JSON, hôte autoritaire, interpolations à 20 Hz ; le multijoueur haut niveau de Godot (`MultiplayerAPI`, RPC) suppose des pairs Godot et un hôte joignable | Moyenne (reporté) | Garder le protocole et le relais tels quels (D7) ; frontière d'autorité tenue dès J1 (§ 1.3) |
| R6 | **Synthèse audio** non portable en temps réel | Moyenne | Cuisson (§ 3.4) ; la musique adaptative perd un peu de finesse (boucles au lieu d'une partition générée) |
| R7 | **Animation procédurale** (IK à deux segments des personnages, poses des zombies, mort, cendres) écrite sur des `Object3D` | Moyenne | Hiérarchies de `Node3D` pilotées par script, à l'identique ; pas de `Skeleton3D` au départ (on pourra y venir pour le skinning) |
| R8 | **Déterminisme de la cuisson** : la cuisson suppose que le JS produit le même monde à chaque exécution (déjà exigé par le multijoueur actuel) | Faible | Empreinte de chaque fichier cuit, comparée entre deux cuissons |
| R9 | **Dette de double maintenance** : tant que le jeu JS évolue sur `main`, chaque changement d'équilibrage ou de carte doit être recuit, chaque changement de logique reporté | Moyenne | Config et carte cuites automatiquement ; geler les nouvelles fonctionnalités JS pendant les jalons J3 à J7, ou les noter dans une liste de report |
| R10 | **Saisie et navigateur** : pointer lock, AZERTY (`code` / `key`), `localStorage`, URL `?debug` | Faible | `Input.mouse_mode`, `physical_keycode` / `key_label`, `ConfigFile` dans `user://`, arguments de ligne de commande |

### 4.2 Décisions à trancher

| # | Décision | Options | Recommandation |
|---|---|---|---|
| D1 | **Plateforme cible** | (a) bureau seulement (Forward+) ; (b) web aussi (export web = moteur **Compatibility** / WebGL2 : moins de fonctions — décals, certains effets — et en-têtes COOP/COEP sur Render pour l'export avec threads, ou export sans threads) | (a) d'abord ; garder les shaders compatibles avec Compatibility (pas de `Decal`, pas de SDFGI) pour ne pas fermer (b) ; trancher avant J9 |
| D2 | **Monde : cuire ou réécrire** | (a) cuire depuis le JS (`bake-world.mjs`) ; (b) réécrire le générateur en GDScript (mulberry32 portable avec des entiers masqués à 32 bits) | (a). (b) seulement si le jeu JS doit disparaître ET que la carte doit encore évoluer |
| D3 | **Collision et touches** | (a) porter `collision.js` / `levels.js` et tester les tirs contre des formes simples (sphère de tête, capsule du corps) ; (b) physique Godot (Jolt), `CharacterBody3D`, `Area3D` de touche, `VehicleBody3D` | (a) : comportement réglé conservé, déterministe, testable en headless, peu coûteux pour ~30 entités. Conséquence : la touche « au triangle près » de `Raycaster` devient une touche par formes (bras exclus) : à valider en jeu |
| D4 | **Boucle** | (a) pas fixe 60 Hz (`_physics_process`) + interpolation physique ; (b) pas variable plafonné à 0,05 s comme le JS | (a) : tests reproductibles avec `--fixed-fps` ; à revoir si la conduite de moto change de sensation |
| D5 | **Taches de sang** | (a) quads instanciés comme le JS ; (b) nœuds `Decal` (plus beaux sur les murs, absents de Compatibility, coût par décal) | (a) tant que D1 n'est pas tranchée |
| D6 | **Code natif** | (a) tout en GDScript ; (b) GDExtension C++ pour le champ de flux (et peut-être la collision) ; (c) C# (écarté : la demande est GDScript, et l'export web de C# n'est pas pris en charge à ce jour, à revérifier) | (a), avec (b) en repli mesuré au banc d'essai de J3 |
| D7 | **Réseau (J12)** | (a) `WebSocketPeer` sur le relais `server/rooms.mjs` inchangé, mêmes messages JSON ; (b) `WebSocketMultiplayerPeer` + RPC Godot (relais à réécrire) ; (c) ENet (pas de web) | (a) : le relais et son nettoyage du chat restent valables, la frontière d'autorité est la même. Pas de jeu croisé JS / Godot visé |
| D8 | **Source de vérité** à terme | (a) le JS reste la référence (config, carte, docs) ; (b) bascule complète vers Godot à la parité | (a) jusqu'à J11, puis décision explicite |
| D9 | **Version et commits** | `package.json` (règle de `CLAUDE.md` : version à chaque changement de jeu, sujet `(vX.Y.Z)`) ; `project.godot` a son propre `application/config/version` | Version propre au port (`0.x` dans `project.godot`), sujet de commit `(godot vX.Y.Z)` ; ne pas toucher `package.json` pour un changement qui ne concerne que `godot/` |
| D10 | **Branche et déploiement** | Render redéploie `main` | Le port reste sur `godot-port` ; aucune fusion dans `main` avant J11 et la décision D8 |
| D11 | **Outils et agents** | `gameplay-coder` est défini « en JavaScript », `gui-test-debugger` pilote Playwright | Ajouter aux définitions des agents la variante Godot (GDScript, tests headless, `--write-movie`) au moment de J0 |
| D12 | **Touche des boss** | Le Bourreau a un point faible (lanterne dans le dos), l'Ange une trompette : aujourd'hui calculés sur l'impact | Formes de touche dédiées (sphère de lanterne, de trompette) dans la même approche que D3 |

### 4.3 Premières actions proposées (J0)
1. Trancher D1, D2, D3, D9 et D10 (les autres peuvent attendre leur jalon).
2. Créer `godot/` et les outils `export-config.mjs` / `export-golden.mjs`.
3. Écrire le lanceur de tests headless et le premier golden (`papStats`).
4. Mettre à jour les définitions des agents (D11).
