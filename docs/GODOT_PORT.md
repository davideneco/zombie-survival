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
| J3 | **Fait** (53 414 contrôles headless j0 à j3, 0 échec ; champ de flux égal au JS ; banc d'essai 22 zombies : 1,4 ms moyenne sur fil de travail, 2,4 ms par tranches ; capture réelle) | v0.4.0 |
| J4 | **Fait** (37 230 contrôles headless j0+j1+j2+j4 avant fusion, 0 échec ; capture réelle de l'arme et du HUD) | v0.5.0 |
| J5 | **Fait** (126 132 contrôles headless j0 à j5, 0 échec ; golden JS des voies, de la physique des motos et de la rame ; parties sur la carte ; captures réelles) | v0.6.0 |
| J6 | **Fait** (129 825 contrôles headless j0 à j6, 0 échec ; golden JS des prix, des tirages de la boîte et du Flopper ; tirages statistiques ; parties sur la carte ; captures réelles) | v0.7.0 |
| J7 | **Fait** (HUD complet, menus, carte, touches ; golden JS du radar, de la boussole, de la carte et des liaisons ; 138 563 contrôles headless j0 à j7, 0 échec ; captures réelles de chaque écran) | v0.8.0 |
| J8 | **Fait** (audio : 86 sons synthétisés par le JS pré-rendus en WAV, 3 boucles de moteur, 4 boucles de musique ; 140 059 contrôles headless j0 à j8, 0 échec ; **écoute non vérifiée**) | v0.9.0 |
| J9 | **Fait** (graphismes : ciel et étoiles, ombres, brouillard, shaders de sol / façades / eau / feuillage / peau des zombies, sang, particules, halo, table de couleurs, torche, qualité Rapide / Normale / Haute ; 141 380 contrôles headless j0 à j9, 0 échec ; captures réelles aux 5 lieux et dans la nef comparées au JS ; 144 images/s plafonnées par l'écran, GPU 1,7 à 3,1 ms) | v0.10.0 |
| J10 | **Fait** (fin de partie : Bourreau en 4 phases, Maître Tanneur, Acte V avec gargouilles, Ange, rampe, Fanal, Aube, Bénédiction, Nuit éternelle, victoire ; golden JS des trois boss rejoués sur scénarios ; partie complète jouée en headless ; 157 347 contrôles headless j0 à j10, 0 échec ; captures réelles ; voir les limites ci-dessous) | v0.11.0 |
| J11 à J12 | À faire | |

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

J3 livré (zombies et IA, champ de flux) :
- **Champ de flux** (`sim/nav_grid.gd`, port de `nav.js`) : Dijkstra à seaux (anneau de 64, coûts 10 / 14 et 40 / 56 sur un obstacle enjambable), sans test de bornes dans la boucle (le bord de la grille est toujours bloqué), incrémental avec double tampon (`update_field(targets, budget, max_cost)`), complet pour les grilles d'étage (`compute_field`), `steer`, `los`, `clear`, `walk_distance`, `nearest_free`, `components`, `bfs` de test. **Deux modes pour la carte** : par tranches de `Rules.FLOW_BUDGET_MAX` = 2 000 cases par pas (le `budget` de CONFIG, 25 000, est réglé pour V8 : 22 ms ici), ou sur un fil de travail (`update_field_threaded`, `Game.flow_threaded`, activé par `main.gd` ; échange des tampons sur le fil de jeu, résultat identique, contrôlé). Les tests utilisent les tranches (échange reproductible).
- **Étages** : `levels.gd` gagne `point_on`, `project`, `end_region`, `next_hop`, `hop_distance` (BFS), `nav_of(region)` (grille de chaque étage plat construite à la demande avec `NavGrid.build_region`, comme `levels.buildNavs` : 7 grilles, ~575 ms au total, donc pas au chargement : le monde se charge toujours en ~250 ms).
- **Zombie** (`sim/zombie_sim.gd`, `zombie_env.gd`, `zombie_pose.gd`) : apparition par fenêtre (ça cogne 0,9 s, enjambement de 1,5 s) et depuis le sol (1,1 s + 2,2 s), poursuite (ligne droite si `los`, sinon `steer`), séparation, pas de côté, `no_progress`, attaque en deux temps, enjambement (`_try_vault`, `vault_step`), escaliers (`_on_link`, choix de la cible par `hop_distance`), boiteux, coureurs, rampants (boîtes de touche couchées), chevalier de fer (armure x0,5, vitesse x0,8, x1,12), pestiféré (explose : 38 x (1 - d / 5) à moins de 4,2 m). `Game` : `field_targets`, champs de la carte et des étages, `_relocate` (coincé ou trop loin), `spawn_target` / `spawn_weights` (`spawnBalance`), `_pick_spawn` (fenêtre 65 %, sol 18-50 m, repli), `pick_ground` (dans `World`), tirage des variantes, `debug_spawn`. Hitscan : zombies pas encore sortis non touchables, échelle du modèle (`hash_id`), rampants.
- **Rendu** : `scenes/zombie_view.gd` remplace la silhouette de J1 : modèle articulé en primitives (bassin, buste, tête, mâchoire, bras et jambes à deux segments, casque et cuirasse du chevalier, ventre gonflé du pestiféré, tertre de l'apparition au sol), pose de `ZombiePose`, mort (chute, tête explosée, enfoncement), flash rouge. Options de `main.gd` : `--horde=N`, `--sync-flow`.
- **Outils** : `tools/export-golden-j3.mjs` (écrit `data/golden/j3.json`, 1,1 Mo) exécute le vrai `nav.js` / `levels.js` / `collision.js` en Node sur les données cuites ; `godot-check.sh` l'appelle.
- **Vérifications** : sur les mêmes cibles, distances de 3 156 cases (portes fermées) et 3 184 (ouvertes) égales au JS à l'entier, nombre de cases atteintes et somme des distances égaux (12 champs, dont deux à deux cibles), 3 600 `steer` à 1e-9, 3 600 `walkDistance`, 3 600 `los` et autant de `clear`, 120 `nearestFree`, composantes de la grille entière (969 / 930, tailles et signature) ; 7 grilles d'étage (taille, origine, empreinte des cases, champ complet, `steer`) ; 400 `nextHop`, 400 `hopDistance`, `project`, `endRegion`, `pointOn` ; poids de `spawnBalance`. Scénarios : 12 zombies à 60-140 m de marche derrière des immeubles rejoignent tous le joueur (détour moyen x0,87 de la marche idéale à vitesse égale, aucun `no_progress` > 0,4 s) ; enjambement (2 sauts sur 3 obstacles pris par le champ) ; un zombie monte au Triforium par l'escalier et redescend ; chronologie des apparitions (fenêtre : touchable à 2,18 s ; sol : 2,64 s) ; variantes ; relocalisation ; 200 bots de marche du `stuck-scan` (60 s simulées, 0 bloqué, 0 sous la carte). Banc d'essai (22 zombies, place Kléber, portes ouvertes, joueur en marche, 2 400 pas) : `Game.step` moyenne / 99e centile / pire = **1,39 / 2,37 / 3,14 ms sur fil de travail** et **2,43 / 4,10 / 7,15 ms par tranches de 2 000 cases** ; un champ complet de 44 645 cases coûte 36 ms d'un coup (~0,85 µs par case). La cible de 4 ms est tenue en moyenne dans les deux modes et au 99e centile sur fil de travail ; par tranches le 99e centile est à la limite. Le repli GDExtension (D6) n'est donc pas nécessaire pour l'instant.
- **Écarts connus** : modèle en primitives (pas de `.glb`, pas de peau : atlas et sang au J9) ; pas de gargouilles (Acte V, J10), de gong du tram ni de rame comme cible (J5), de jambes arrachées par une explosion (J4 / J6), de vitre qui se brise ni de sons d'apparition (les évènements `zombie_event` sont émis, rien ne les écoute : J8/J9) ; les grilles d'étage n'ont pas d'équivalent cuit (construites à l'exécution, égales au JS par l'empreinte) ; `reach` de `pickGround` approché par « case de zone » (même ensemble) ; la boîte de tête des rampants est une approximation (le JS tire sur le vrai maillage animé) ; deux escaliers jumeaux de même longueur à 1 ulp (liens 0 et 2) peuvent se départager autrement que dans le JS (le JSON est relu par Godot avec un dernier chiffre parfois différent) ; l'arène de J1 garde l'apparition instantanée ; les temps du bot de J1 ont changé (zombies boiteux, tirages différents) : bot immobile mort en 32,9 s, bot tireur 7 tués en 35,0 s.
- **À remonter dans `src/config.js`** (en plus de la liste de J1) : durées d'apparition (0,9 / 1,5 / 1,1 / 2,2 s), part de boiteux, vitesses des variantes, explosion du pestiféré, rayon de relocalisation, probabilité de fenêtre, portées d'apparition (18-50 m).
J4 livré (armes) :
- **Sim pure** (`godot/sim/`) : `weapon_state.gd` (`WeaponState`, étend `WeaponSim` : une arme de l'inventaire, `cfg` = `statsOf` de player.js = base + `Pap.pap_stats` + Double Tap / Speed Cola, cadence semi / auto avec `FIRE_RESUME_GAP`), `weapon_arms.gd` (`WeaponArms` : inventaire 2 armes (3 avec Mule Kick), `give_weapon`, `upgrade_current`, molette et touches 1-3, tir à la détente (auto, semi, plombs, perforation, chute des dégâts par zombie touché, Éther, balles explosives, éclaboussure du pistolet à rayons et de l'arbalète PaP), visée ADS (dispersion x0,4 / x0,05 avec lunette, FOV), rechargement (auto pour l'arbalète et le M79), clic à vide = couteau, M79 et lance-grenades sous canon, grenades à main), `weapon_blast.gd` (obus du M79 de `launcher.js` en sous-pas de 20 ms, grenades à rebonds de `updateGrenades`, `explode` / `area_damage` / `splash` de `main.js`), `weapon_melee.gd` (couteau : rayon central puis cône, dos x1,5, tête x1,5, fente, Hache du Bourreau), `weapon_shop.gd` (armes murales : achat puis munitions au prix x `papAmmoMult` ; bornes de munitions, y compris la borne de l'arène).
- **Hôte** : `Game.arms` remplace l'ancien `Game.weapon` (qui reste, en lecture, sur l'arme en main) ; `new_game(seed, map, weapons)` (par défaut le M1911 de J1, la scène principale passe `startWeapons`) ; `Game.interact()` (borne, arme murale, puis porte) ; `Game.hurt_player(amount, src)` (immunité PHD Flopper aux explosions) ; `hit_zombie(..., mel)` (couteau : pas de bonus de tête, points `knife.points`) ; signaux `explosion`, `weapon_acquired`, `purchase_denied`.
- **Rendu** : `scenes/weapon_view.gd` (arme à la première personne en primitives par catégorie et niveau du PaP, recul, rechargement, visée, coup de couteau, obus et grenades en vol, flash des explosions) ; commandes : clic droit viser, V couteau, G grenade, 1-3 et molette changer d'arme, clic molette obus sous canon, E acheter.
- **Vérification** (`tools/export-golden-j4.mjs`, `tests/test_j4.gd`) : golden JS de 368 jeux de statistiques effectives (23 armes x 4 niveaux x 4 combinaisons d'atouts), 736 dégâts (arme x niveau x distance x tête), 126 scénarios « tirs pour tuer un zombie de la manche 10 à 8 m » rejoués par la vraie chaîne de tir (126 / 126 égaux), 72 dégâts de zone, 160 dégâts de couteau, trajectoires de 4 obus (contre `Collision` JS, sol compris) et de 3 grenades ; scénarios : cadence, semi, plombs, rechargement, perforation, mur, points, ADS, M79 (armé, direct, auto-dégâts), pistolet à rayons, grenades (mèche, plafond), inventaire, PaP, atouts, couteau (corps, tête, dos, cône, délai, hache, arme vide), achats au mur et à la borne sur la carte de Strasbourg, et un bot qui tue la manche 1 avec chacune des 23 armes.
- **Écarts connus** : viewmodels `.glb` et accessoires du PaP non faits (primitives) ; pas de son ni d'éclair de tir / de douille ; les cibles spéciales (Bourreau, Maître Tanneur, Ange, zombies cuirassés, rampants) attendent J3 / J10 : `area_damage` appelle `make_crawler()` et `hit_zombie` lit `armor` seulement si `ZombieSim` les définit ; bonus Mort instantanée / Points doubles (J6) absents des dégâts et des points ; la bouche de l'arme est une constante (`WeaponArms.MUZZLE`) au lieu des mesures de `viewmodels.js` ; dispersion avec l'ouverture de J1 (voir J1) ; explosions et tracés non vérifiés visuellement (seule l'arme et le HUD l'ont été) ; vitesses de grenade et de mèche dans `WeaponBlast` (constantes de main.js / player.js à remonter dans `CONFIG`).

J5 livré (véhicules : motos, vélos, tram) :
- **Sim pure** (`godot/sim/`) : `vehicle_sim.gd` (`VehicleSim` : port de la classe `Vehicle` de `vehicles.js`, cinématique arcade maison : accélération qui faiblit près du maximum, freinage, marche arrière, résistance, modèle « bicyclette » avec braquage décroissant, frein à main, limite d'adhérence, inclinaison ; essence, réserve, ratés, panne sèche ; collision murs / mobilier / marches avec perte de vitesse selon l'angle d'impact, deux cercles par moto et chocs moto contre moto, écrasement des zombies avec seuil `vmin` et ralentissement, arrêt net au contact d'un zombie lent ; positions en doubles, le `Vector3` en simple précision dérivait de plus d'un centimètre), `tram_track.gd` (`TramTrack` : port de `tramTrack.js`, voies échantillonnées en `PackedFloat32Array` comme les `Float32Array` du JS, projection, aiguillages : `crossing_of`, `make_route`, `build_junction`), `tram_sim.gd` (`TramSim` : 5 modules articulés sur la voie, accélération et frein de service / d'urgence, plafond de vitesse en virage et devant un obstacle, freinage automatique devant une porte de zone fermée, un heurtoir ou une rame de décor, aiguillage et verrou, courant, portes, zombies fauchés ou bloquants, joueur à pied heurté), `tram_interior.gd` (intérieur praticable : boîtes de sièges, pupitres, parois ouvertes devant les portes, `push_out`), `ride_cam.gd` (`RideCam` : vue à la troisième personne, bras, trois rayons, pivot lissé, recentrage), `rides.gd` (`Rides` : l'hôte des véhicules en solo : places, monter / descendre, PV, feu 2 s puis explosion (5 m, 1000 aux zombies, 50 au joueur sans jamais le tuer), épave, retour au parking deux manches plus tard (un vélo : une manche, sans incendie), borne du parking « plein + réparation » (2 pts / PV, 50 pts / L), sous-station du tram (2000 pts une fois), gong (appât de 8 s qui suit la rame, recharge 3 s), portes de la rame, aiguillage, marche dans la rame, monter à pied en poussant contre une porte ouverte, s'asseoir, la rame comme cible : porte visée par les zombies (`tram_goal`) et caisse qui encaisse les coups (`tram_shield`)).
- **Hôte** : `Game.rides` (null dans l'arène), `Rides.step` avant le pas du joueur (le joueur suit la selle ou marche dans la rame : `PlayerSim.attached`, `eye_override` pour la caméra externe), signaux `announced` et `ride_event`, `Game.shake`, `damage_vehicle`, `hurt_occupants`, `hit_zombie` renvoie maintenant `true` si le coup tue, explosions (`WeaponBlast.explode`) : les motos proches perdent 10 % des dégâts ; le conducteur ne tire ni ne recharge, le passager tire ; `ZombieSim` suit le gong (`lure`) et la porte de la rame (`tram_goal`) ; le champ de flux a le gong comme cible de plus.
- **Données** : `tools/bake-vehicles.mjs` (jeu JS lancé dans Chrome : `npm run dev` puis `node tools/bake-vehicles.mjs`) écrit `godot/data/world/vehicles.json` (26 machines avec cap, variante de couleur et station, sièges `hip` / `eye`, parkings et bornes, stations de vélos, sièges, portes et arrêts de la rame, 10 portes de zone sur les voies, sous-station, rame de décor). Les voies, les aiguillages et les itinéraires se recalculent depuis `CONFIG.tram` (rien de cuit).
- **Rendu** : `scenes/vehicle_view.gd` (`VehicleView` : moto, grosse moto, vélo en primitives d'après `vehicleModels.js`, fourche et roues qui tournent, inclinaison, épave noire couchée, fumée grise puis noire et flammes selon les PV), `scenes/tram_view.gd` (rame creuse : plancher, parois à baies vitrées, huit vantaux qui coulissent, nez, sièges, pupitres), `scenes/world/rides_view.gd` (bornes de service, arceaux des stations de vélos, feux des portes de zone sur les voies (rouge porte fermée, vert porte ouverte : un cube plus grand recouvre le feu cuit dans le monde) et voyant de la sous-station, cavalier en primitives en vue externe, machines garées non dessinées au-delà de `cullDist`), HUD : invite d'interaction, tableau de bord (vitesse, essence ou énergie, PV, aiguillage). Commandes : E monter / descendre, Z/Q/S/D conduire, Espace frein à main (rame : frein d'urgence), V vue (assis), H gong, O portes, B aiguillage ; options de lancement `--mount=moto|grosseMoto|velo|tram`, `--auto-fwd`, `--power`, `--tram-doors`.
- **Vérification** (`tools/export-golden-j5.mjs`, `tests/test_j5.gd`, doublure `tests/j5_stub.gd`) : golden calculé par le JS exécutant les VRAIES méthodes (`Vehicle.prototype.drive`, `Tram.prototype.drive / limit / ahead / integrate / freewheel / approach / junctionStep`, sur des objets de test) : 4 voies (échantillons de position, cap, tangente, rayon à 1e-6 ; 600 projections ; rayon minimal ; arrêts), croisement et 2 itinéraires d'aiguillage, 400 `pushOut` et 200 `doorIndexAt`, boîtes de l'intérieur ; 16 scénarios de moto / vélo (ligne droite, marche arrière, virages, frein à main, mur de face et de biais, caisse, arbre, barrière, panne sèche, réserve, moto garée, moto conduite, écrasement rapide, vélo bloqué par un zombie) rejoués pas à pas à 1e-5 avec les mêmes dégâts, blessures et zombies touchés ; 14 scénarios de rame (départ, hors tension, cabine arrière, marche arrière, frein d'urgence, portes ouvertes, aiguillage dévié et droit, feu rouge, porte de zone ouverte, heurtoir, roue libre, zombie fauché, zombie lent) et 120 plafonds de vitesse. Parties sur la carte de Strasbourg : 26 machines posées, monter / conduire / descendre, panne sèche, vélo, passager qui tire, écrasement, feu, explosion qui n'est jamais mortelle, épave, retour au parking, borne payante, sous-station, rame jusqu'à la porte de zone fermée puis ouverte, gong, portes, descente et montée à pied, siège, zombies qui visent la porte, caisse qui encaisse (2 PV par coup, joueur intact), hors service et retour au dépôt.
- **Écarts connus** : pas de son (moteur, klaxon, carillon, gong : J8) ; pas de personnage animé sur la moto (un cavalier en primitives) ni d'Avatar des coéquipiers ; vue externe sans plafond (`World` n'a pas de `ceiling_at` : passage sous un porche) et tirs depuis la caméra (le JS les fait partir d'un point avancé du bras) ; modèles en primitives (pas de `.glb`, ni réflexions d'ambiance ni ombres : J9), livrée de la rame sans atlas ni sang, nez simplifié ; bidons d'essence lâchés par les zombies : faits en J6 ; les quatre signaux d'aiguillage restent figés « tout droit » (cuits dans le monde ; le réglage et le verrou, eux, fonctionnent et s'affichent dans le tableau de bord) ; pas de carte (J7) ; aucune synchro réseau (`v_state`, `t_state`, places arbitrées : J12) ; constantes de règle à remonter dans `CONFIG` : durée de pose sur la voie, 0,6 m devant la moto pour l'écrasement, cooldown de 0,5 s des chocs, coefficients de rebond (voir `vehicles.js`) ; la tolérance des golden est de 1e-5 (positions de la rame en `Vector3`) ; la rame de décor de l'Homme de Fer ne sert que de butée (un obstacle à chaque bout de sa voie) : le monde cuit n'en contient qu'une, comme le JS.

J6 livré (bonus, atouts, boîte mystère, Pack-a-Punch, essence) :
- **Sim pure** (`godot/sim/`) : `powerups.gd` (`Powerups` : bonus au sol, port de `spawnPowerup` / `collectPowerup` / ramassage de `main.js` : tirage uniforme des 4 bonus, `dropChance` 5 %, durée au sol 25 s, ramassage à 1,7 m sur le même étage, Munitions max (réserves, obus et grenades), Mort instantanée (dégâts 999 999 sauf boss, 30 s), Bombe (+400, tue tout sauf les boss, sans compter de tués ni de points, comme le JS), Points doubles (x2 sur touches, morts, couteau et explosions, 30 s) ; bidons d'essence `maybeDropFuel` / `hostFuelPickup` de `vehicles.js` (3 % par mort, seulement si une moto en état est sous 50 %, un seul au sol, +2,5 L à la moto du ramasseur sinon à la plus vide, plafonné au réservoir) ; bonus d'ouverture de zone extérieure (`openingBonus`, 3-9 m du milieu de la porte, un par zone), `mystery_box.gd` (`MysteryBox` : tirage pondéré sans les armes déjà portées, compteur et limite avant le nounours, remboursement, déplacement vers une autre zone ouverte, phases roll / teddy / offer / sink au chronométrage du JS), `pack_a_punch.gd` (`PackAPunch` : trois niveaux payés séparément, arme confisquée, phases in / work / out / offer, reprise automatique à `offerTime`), `machines.gd` (`Machines` : machine à portée 2,6 m, invites, achat des 7 atouts, prix solo de la Réanimation rapide : 500).
- **Hôte** : `Game.powerups`, `Game.machines`, `Game.rng_loot` (générateur séparé : activer les bonus ne change pas les apparitions des tests précédents), `Game.add_perk` (Mastodonte : 250 PV, Stamin-Up : marche x1,1 et sprint x1,3, PHD Flopper, Réanimation rapide), `Game.flop` (onde `phd.base + perRound x max(1, manche)`), `on_zombie_killed` (bonus et essence à chaque mort : coup, explosion, véhicule), `is_boss` ; `PlayerSim` gagne l'état à terre (Réanimation rapide : à terre au lieu de mourir, tous les atouts perdus, rampe à 1,2 m/s, ne tire pas, les zombies l'ignorent, se relève seul après 4 s avec 50 PV ; sans l'atout la mort reste immédiate ; saigne 45 s si aucun secours) et le plongeon du Flopper ; `WeaponArms.locked` (arme dans le Pack-a-Punch) et `max_ammo`. E : station, machine, arme murale, puis porte (l'ordre de `interact` du JS).
- **Rendu** : `scenes/world/machines_view.gd` (coffre de la boîte mystère en primitives aux 19 emplacements avec couvercle, écriteau, faisceau de 30 m, tirage : armes qui défilent puis arme proposée, nounours, envol ; arme qui entre dans le Pack-a-Punch, étincelles, arme proposée ; bonus au sol : dodécaèdre lumineux et halo, bidon rouge) ; HUD : invite des machines, pastilles d'atouts, bonus actifs avec secondes restantes, « À TERRE », éclair de la Bombe. Les distributeurs d'atouts, le Pack-a-Punch et les armes murales restent ceux du monde cuit. **Le coffre de la boîte n'est plus cuit** : `tools/bake-world.page.js` l'exclut des tuiles (il se déplace) ; il faut refaire `node tools/bake-world.mjs` pour les tuiles locales (`tiles/`, ignorées par git) et `vehicles.json` doit être restauré (`git checkout godot/data/world/vehicles.json`) car la cuisson vide le dossier. Options de lancement : `--do=a,b` avec `money`, `perks`, `powerup:TYPE`, `collect:TYPE`, `to-box`, `to-pap`, `to-perk:ID`, `box`, `pap`, `teddy`, `open-doors`, `down`.
- **Vérification** (`tools/export-golden-j6.mjs`, `tests/test_j6.gd`) : golden JS des prix et noms des 7 atouts, des prix du Pack-a-Punch, 400 tirages de la boîte pour (armes portées, nombre aléatoire) donnés, 41 ondes du Flopper (une par manche) ; les formules de `hostBoxRoll` et de `flop` (non importables sans Three.js) sont recopiées dans l'outil. Statistiques à graine fixe : 100 000 tirages de la boîte (écart maximal à CONFIG 0,0018), 100 000 morts (5,08 % de bonus, quatre types à ~25 %), 100 000 essais d'essence (3,02 % contre 3 %, aucun bidon motos pleines), 4 000 morts réelles. Scénarios sur la carte : achat des 7 atouts (prix, invite, pas de second débit, refus à 2 499 points), statistiques `statsOf` avec Double Tap / Speed Cola, Mule Kick (3 armes), vitesses Stamin-Up, à terre / relevé / mort, immunité du Flopper et plongeon en sprint, boîte (achat, refus, occupation, offre, prise, arme non prise, nounours remboursé, déplacement vers une zone ouverte, reproductibilité à graine égale), Pack-a-Punch (3 niveaux, prix, statistiques égales à `papStats`, arme verrouillée, reprise automatique, niveau maximum), chaque bonus, portée, étage, expiration, essence, bonus d'ouverture de la porte de la Petite France.
- **Écarts connus** : modèles en primitives (pas de `.glb`, le coffre n'a pas la texture de bois ni les ferrures du JS) ; la machine du Pack-a-Punch est cuite : elle ne tremble pas et ses engrenages ne tournent pas pendant l'amélioration (seuls l'arme, les étincelles et l'invite sont animés) ; pas de son (jingle, tic de la boîte, nounours, Pack-a-Punch : J8) ; pas de popups de points (J7) ; co-op : réanimation par un coéquipier, `checkTeamWipe`, Bénédiction de l'Aube (`blessed`) et synchro réseau des bonus / de la boîte / du Pack-a-Punch (J12) non portés ; `Powerups.on_kill` lit `is_boss` / `is_angel` de `ZombieSim` (le Bourreau et l'Ange arrivent en J10) ; la boîte mystère n'a pas de bonus d'ouverture ni d'horloge (`clock` : J10) ; les durées de l'état à terre, la vitesse à terre, Stamin-Up (1,1 / 1,3), Mastodonte (250) et les durées du nounours sont dans `Rules` (non remontées dans `CONFIG`).

J7 livré (HUD et menus) :
- **Sim pure** : `keybinds.gd` (`Keybinds` : port de `keybinds.js`, liaisons `code:` physique / `key:` lettre tapée, conflits, échange, flèches de secours, sauvegarde, recopie dans l'InputMap : AZERTY / QWERTY), `settings.gd` (`Settings` : `user://settings.cfg`, défauts et bornes de `DEFAULT_SETTINGS`, `Game.settings`, `--settings=chemin`), `ui_stack.gd` (`UiStack` : pile des couches et Échap), `hud_calc.gd` (radar, boussole, cadrage de la carte, textes), `prompts.gd` (invite contextuelle), `map_image.gd` (plan de la carte), `characters.gd`.
- **Scènes** (`scenes/ui/`) : `hud.gd` (réécrit sur la disposition de `index.html` : radar, boussole et zone, manche, points, atouts, arme / inventaire / munitions / santé / grenades, bonus actifs, tableau de bord du véhicule avec aiguillage, invite, annonces, popups de points, marqueur de touche, voile des dégâts, éclair de la Bombe, vue à terre, message discret, effets cinéma ; API `set_boss_bar`, `set_banner`, `set_mark`, `set_fanal` prête pour J10), `menus.gd` (titre, choix du survivant et pseudo, pause, options, Options > Touches avec capture / conflit / échange / réinitialisation, équipe éliminée, victoire), `map_view.gd` (carte plein écran, touche M, plan construit sur un fil de travail), `radar.gd`, `compass.gd`, `ui_theme.gd`. `main.gd` : écran titre sans argument (ou `--menu`), `--ui=title|menu|options|keys|capture|conflict|pause|map|over|victory`, `--hud-demo`, luminosité / FOV / sensibilité / volume appliqués, vue du véhicule mémorisée.
- **Hôte** : signaux `points_gained` (popups) et `hit_confirmed` (marqueur de touche).
- **Vérification** : `tools/export-golden-j7.mjs` exécute le vrai `Hud.drawRadar / drawCompass / drawMap` (faux contexte 2D) et le vrai `keybinds.js` : 300 radars, 200 boussoles, 40 cadrages de carte, 483 liaisons, 8 opérations d'échange / réinitialisation, flèches de secours ; `tests/test_j7.gd` (8 738 contrôles) : golden, `UiStack`, réglages (bornes, relecture, fichier incohérent), AZERTY / QWERTY par `InputEventKey`, plan (~0,6 s), invites, scènes du HUD et des menus (touches simulées). Captures réelles : titre, survivant, options, touches (attente, conflit), pause, carte, équipe éliminée, victoire, HUD en jeu, HUD sur moto.
- **Écarts connus** : plan de la carte tiré de la grille de navigation (pas d'eau ni de passages dorés ; légende du JS conservée) ; pas de cartes des coéquipiers, de badge de salon ni de chat (J12 : boutons Co-op désactivés) ; pas de portrait des survivants (J9) ; invite « Enjamber », « se débloquer » et lampe torche non portées (touches listées, sans effet) ; qualité, halo et musique enregistrés mais sans effet avant J8 / J9 ; pas de pause sur perte de focus ; l'étalement de la dispersion des armes garde `Rules.FOV_DEG` ; le plein écran n'a pas été essayé sur l'écran réel ; l'invite des machines / véhicules garde les lettres de leur texte (remplacées par la liaison pour E et V seulement).

J8 livré (audio) :
- **Cuisson** : `tools/bake-audio.mjs` (+ `tools/bake-audio.page.html`, liste partagée `tools/audio-list.mjs`) charge le VRAI `src/audio.js` et `src/music.js` dans Chrome (petit serveur statique local, CDP comme `bake-vehicles.mjs`) et les rend avec un `OfflineAudioContext` : la classe `Sfx` du jeu tourne telle quelle sur un contexte hors ligne, avec une chaîne « sèche » (bus -> canal 0, envoi vers la réverbération -> canal 1). Sortie : `godot/assets/audio/sfx/<nom>_<n>.wav` (mono 16 bits 44,1 kHz, fin silencieuse rognée sous -54 dB, jamais d'écrêtage : le gain perdu est rendu par `gain_db` du manifeste) et `<nom>_<n>_send.wav` (la part envoyée à la réverbération, si audible) ; 23 armes x 3 variantes, 23 rechargements (un par couple catégorie / durée, car les claquements sont placés en fraction de la durée), couteau, impacts, véhicules, tram, interface, bonus, machines, ambiance (86 sons, 241 WAV, 15 Mo). Boucles de moteur (`engine_moto`, `engine_grosseMoto`, `engine_tram` : 2,7 s, régime stable, fondu enchaîné de 0,3 s) ; musique : 4 boucles Ogg de 16 mesures (calme 37,6 s / rythmé 34,2 s / dur 31,4 s / à fond 28,2 s, 1,8 Mo en tout), la chaîne du jeu (réverbération, bus 0,6) incluse, la queue de réverbération repliée sur le début (ffmpeg + libvorbis). Le manifeste `godot/data/audio.json` liste fichiers, durées, gains, armes -> rechargement, moteurs, musique. Le rendu est aléatoire comme dans le jeu (bruit, hauteur) : deux cuissons ne donnent pas les mêmes octets ; `node tools/bake-audio.mjs [préfixe]` refait un sous-ensemble.
- **Sim pure** : `sim/audio_rules.gd` (`AudioRules` : niveau et tempo de la musique, intensité selon la manche, fréquence et gain des moteurs, régime d'une moto, volumes de distance, hauteur des tics, frein de la rame, noms des sons ; chaque constante qui n'est pas dans `CONFIG` avec sa source JS).
- **Autoload `Sfx`** (`autoload/sfx.gd`) : bus créés en code (Master + limiteur dur à -3 dB ; `Effects` : gain 0,6 puis compresseur 5:1 à -14 dB ; `Reverb` : réverbération 100 % humide, gain 0,55, vers `Effects` ; `Music` : compresseur à chaîne latérale sur `Effects` (la musique baisse sous les gros bruits), passe-bas d'étouffement 650 Hz, baisse de 0,55 en menu / pause) ; Options > Volume -> Master, Options > Musique -> `Music`. Lecture : `Sfx.play(nom, vol, pos, pitch)` ; deux lecteurs par voix (sec sur `Effects`, envoi sur `Reverb`), `AudioStreamPlayer3D` sans atténuation propre pour les sons positionnés (le niveau suit les règles du JS, seule la direction vient de la 3D), plafond de 24 voix 3D + 16 voix à plat, la plus ancienne est reprise ; variante au hasard. Musique : un lecteur par niveau, fondu enchaîné de 1,5 s en gardant la place dans la boucle, accalmie entre deux manches (niveau 0), étouffée hors partie ou en pause (`Sfx.set_mood`, appelé par `main.gd`), morceau personnalisé facultatif `theme.mp3|ogg|wav` dans `user://music/` ou `res://assets/audio/music/` (ignoré par git, jamais commité ; `godot/assets/audio/music/LISEZMOI.txt`).
- **Sons câblés sur les signaux** : `shot_fired` (un son par pas : le fusil à pompe émet un signal par plomb ; arme en main, `m79` pour le sous-canon), `hit_confirmed` (+ `Game.last_hit_head` : tink à la tête, choc mou au corps), `zombie_killed`, `player_hurt`, `explosion` (volume `max(0,1, 1 - d/60)` à la position), `zombie_event` (knock, glass + râle, rumble, emerge = terre + râle ; volume `1 - d/45` à la position du zombie), `round_started` / `round_ended` (cor, accalmie), `weapon_acquired` / `perk_acquired` / `door_opened` (achat), `purchase_denied` / `door_denied` (refus), `powerup_collected` (fanfare, + souffle de la Bombe), `box_event` (jingle, nounours, proposition) et tics du défilement, `pap_event` (+ grondement et bouffées selon la phase), `ride_event` (mount, chime, crash, cough / dry, beep, alarm, service, gong, knock), et par scrutation dans `_physics_process` : râle des zombies (2..8 puis 4..10 s), alarme des motos en feu (0,42 s), aiguillage de la rame, grincement de frein (au plus 10 par seconde ; le drapeau `squeal` de `TramSim`, que la simulation ne relit pas, est consommé ici). Moteur : boucle lue en continu, `pitch_scale` = rapport des fréquences du JS (`base + rpm x span`) et gain = rapport des gains du JS, montée / descente lissées ; moto, grosse moto, rame (propulsée, conducteur, `state` ok), coupé en panne sèche. Nouveau côté sim (présentation seulement) : signal `Game.weapon_event` (`reload`, `knife_swing`, `knife_hit`, `empty`) émis par `WeaponArms`, et `Game.last_hit_head`.
- **Vérification** : `tools/export-golden-j8.mjs` exécute le vrai `Sfx` / `Music` avec un faux contexte WebAudio qui enregistre ce qui est programmé : pour 86 sons les tons et bruits (type, fréquences, durée, volume, retard) et la durée attendue ; 26 cas de niveau / tempo de `Music._beginBar` ; l'intensité de `updateMusicMood` ; fréquence et gain des moteurs sur une grille de régimes ; réglages de la chaîne (`_build`, `setMuffled`). `tests/test_j8.gd` (1 496 contrôles) : règles pures contre ce golden ; les 241 WAV relus (mono 16 bits 44,1 kHz, ni silencieux ni écrêtés, durée <= durée programmée par le JS et >= 60 %, flux importé de même durée) ; **13 tons purs du JS retrouvés par Goertzel dans les WAV** (puissance à f > 3 x puissance à f x 1,4 et f / 1,4) ; les 23 armes ont leur coup et leur rechargement ; boucles de musique (tempo, durée de boucle égale à 16 mesures du JS) ; bus, effets, volumes des Options ; chaque signal ci-dessus déclenche le bon son avec le bon volume (parties d'arène et de Strasbourg) ; 300 + 300 lectures simultanées restent dans le plafond de voix ; moteur d'une moto réelle (pitch_scale égal au rapport JS à 10 m/s, redescente, coupure en panne sèche) ; morceau personnalisé (WAV d'essai) ; niveaux de musique et fondu enchaîné. Parties réelles (`godot --headless`, bot 40 s : 138 sons lus, 11 voix créées, aucune erreur ; moto, rame, boîte) ; **le tempo des boucles cuites a été relu à l'autocorrélation (niveaux 1 à 3 : période = 1 ou 2 temps du tempo JS ; niveau 0 sans batterie : non concluant)**.
- **Écarts connus / non vérifié** : **aucune écoute** (pas de sortie audio vérifiable ici : le mixage, l'équilibre entre sons et musique, la réverbération `AudioEffectReverb` (réglée à l'estime : room 0,8, damping 0,6, pas la réponse impulsionnelle de 1,8 s du JS), le genou du compresseur (non reproductible), le passe-bas d'étouffement et les raccords des boucles Ogg n'ont été ni écoutés ni mesurés) ; poste sans `xvfb-run` : parties lancées en `--headless` (pilote audio Dummy), pas sur une vraie sortie son ; le moteur est une boucle figée à un régime (seuls la hauteur et le volume suivent, pas le filtre ni la modulation d'amplitude du JS qui varient avec le régime) ; la musique n'est plus générée en direct : 4 boucles de 16 mesures (verse, verse, chorus, chorus), pas de pont, tempo fixé par niveau (le JS varie en continu avec l'intensité), changement de niveau par fondu et non à la mesure ; le compresseur de la musique est à chaîne latérale (le JS comprime la somme) ; pas de filtre de distance sur les tirs lointains (`_far` : inutile en solo) ; sons du coéquipier (`down`, `chat`), de l'enjambement (`vault` : pas porté) et du jeu en ligne cuits mais non câblés (J12) ; `points_gained` est branché mais ne joue rien : le JS n'a aucun son propre au gain de points (les sons de coup et de mort viennent de `hit_confirmed` / `zombie_killed`) ; pas de son pour `bloat_burst` (le JS n'en joue pas non plus) ; le gémissement d'apparition `groan` dépend de `volume` (<= 0,01 ignoré) ; le Bourreau, l'Ange, la finale (J10) ont des sons dans le JS (`boss_*`, cloche, roulement) : `bell` / `rumble` / `nuke` sont cuits, le câblage vient avec J10 ; morceau personnalisé : pas de normalisation automatique du niveau (Godot ne donne pas les échantillons d'un MP3) ; `.m4a` non lu ; les fichiers `.import` des 241 WAV et 4 Ogg sont versionnés (import QOA par défaut des WAV) ; formule du régime d'une moto (`moto_rpm`) recopiée de `vehicles.js` sans golden (la classe `Vehicle` demande Three.js).

J9 livré (graphismes) :
- **Cuisson** : `tools/bake-graphics.mjs` (jeu JS dans Chrome, `?debug`, comme `bake-world`) écrit `godot/assets/graphics/` (ignoré par git, 4,5 Mo) : atlas de chair et de tissus des zombies, masque de sang, `zombie_geo.bin` (les VRAIES géométries de `zombieGeometries()` : tête sculptée, mâchoire, buste, membres, main à griffes, remplaçant les primitives ; sens horaire), atlas des particules et des taches, champ de distance du sol et bruit de `ground.js`, texture de détail des façades ; et `godot/data/graphics/lights.json` (versionné) : les 506 sources de lumière du JS (la liste est fermée dans `realworld.js` : retrouvées en balayant le monde au pas de 10 m et en lisant les 8 `PointLight` redistribuées). La cuisson du monde n'a PAS été relancée. `tools/j9-js-shots.js` (avec `tools/cdp.mjs`) prend les captures du jeu JS aux lieux repères.
- **Sim pure** : `sim/graphics_rules.gd` (niveaux, `pickN`, zones et lissage, exposition, reflets, conditions de la passe finale et du halo, plafonds de particules et de taches, table de couleurs 32^3 de `buildLut`). `Game.impact(pos, flesh, big)` (tir qui touche chair ou mur) et `ZombieSim.hit_count / last_hit_head` : présentation seulement.
- **Rendu** : `scenes/graphics_view.gd` (environnement, ciel, lune et ombres, brouillard, exposition par zone, qualité, halo, table de couleurs, vignette et grain, lampe torche), `shaders/sky.gdshader` (dégradé, nuages fractals, lune, étoiles ; la passe du cube de rayonnement rend l'hémisphère ambiant de `main.js`), `ground.gdshader` (variations, mousse, taches, flaques à partir du champ de distance), `facade.gdshader` (détail des façades), `water.gdshader` (deux couches de ridules, reflet), `foliage.gdshader` (vent), `zombie_skin.gdshader` (atlas, relief, sang progressif), `fx_particle.gdshader` / `fx_decal.gdshader`, `cinema.gdshader`, `env_reflect.gdshaderinc` ; `scenes/fx_view.gd` (280 + 220 particules et 64 taches en MultiMesh), `scenes/world/surfaces.gd` (reconnaît sol / eau / façades / feuillage par leurs propriétés), `scenes/zombie_skin.gd`. `world_view.gd` : instances rangées par mailles de 160 m (corrige les rails et colonnes de l'Homme de Fer, cachés par la portée de visibilité mesurée à l'origine du monde), lumières = 8 sources les plus proches de `lights.json` (énergie = intensité / pi, atténuation 2). `main.gd` : `--quality=N --no-cinema --no-halo --no-hud --pitch= --horde-near --fps=S --spin` et options `--dbg-*` de mise au point.
- **Mesures qui ont guidé le réglage** : une lumière Three.js vaut E / pi dans Godot (mesuré : 1,0 -> 0,32 chez Three, 1,0 chez Godot) ; `ambient_light_energy` est ignorée quand l'ambiant vient du ciel (le facteur 1,1 x luminosité / pi est donc dans le shader du ciel) ; le brouillard de profondeur de Godot vaut `smoothstep(début, fin, d) x densité` : fin = 1,65 / 0,019 donne le brouillard exponentiel carré du JS à 0,08 près ; les façades doubles faces demandent `cull_disabled` (sinon normales inversées) ; le `sin` d'un hachage 1-D perd sa précision sur GPU (nuages en plaques) : hachage sans sinus ; ACES de Godot ~ ACES de Three (ciel égal à 10 % près, `TONE_K = 1`).
- **Vérification** : golden JS (`export-golden-j9.mjs` : `pickN` et `buildLut` de `graphics.js` exécutés tels quels) ; `tests/test_j9.gd` (1 321 contrôles : règles, table de couleurs, assets, géométries, reconnaissance des matériaux, environnement et qualité (Rapide / Normale / Haute, cinéma, halo), exposition de la nef, torche, particules, taches, signaux, peau et sang des zombies, impact des armes). Captures sur l'écran réel (fenêtre hors écran) à Marché-Neuf, place Kléber, parvis, Gutenberg, Homme de Fer, nef et Petite-France, qualités 0 et 2, côte à côte avec le JS : ciel, étoiles, ombres, éclairage, flaques, halo et lieux comparables. FPS (1920x1080, caméra qui tourne, 10 s) : Marché-Neuf Rapide 500 appels / 166 k triangles / GPU 1,7 ms, Haute 843 / 249 k / 2,7 ms ; nef Rapide 358 / 176 k / 2,4 ms, Haute 561 / 294 k / 3,1 ms ; **144 images/s = rafraîchissement de l'écran** (le vsync n'a pas pu être levé) : seul le temps GPU est discriminant ; pires images 24 à 30 images/s (à-coups ponctuels, cause non cherchée).
- **Écarts connus / non vérifié** : pas de `.glb` (le plan en prévoyait pour les modèles ; les géométries des zombies sont cuites en format maison, les armes, véhicules et machines restent en primitives) ; nuages à un autre endroit que dans le JS (hachage différent) ; pas de reflets d'ambiance sur les métaux (coupés : l'ambiant et les reflets partagent le même ciel ; seuls l'eau et les flaques reflètent) ; halo réglé à l'oeil (le JS seuille l'image déjà tone-mappée) ; vignette et grain en shader, grain non comparé ; l'arrivée des vitres brisées et le tertre d'apparition gardent leurs primitives ; relief des façades (`relief.js`) : celui déjà cuit, la portée 30 / 60 / 110 m selon la qualité n'est pas appliquée ; arbres : le mode cuit (cartes) est le seul, Rapide ne fait que raccourcir la portée et couper le vent (pas de boules lissées, pas de branches de la Haute) ; sources de lumière liées à une boîte mystère inactive toujours allumées ; **les rails du tram sont blancs** (la cuisson du monde n'a pas gardé leurs couleurs de sommet : défaut de J2, visible à l'Homme de Fer, à corriger par une nouvelle cuisson) ; la torche (allumée au départ ; le JS aussi par accident, son premier appui la laisse allumée) ; sans le vsync levé, les FPS sont plafonnés ; fenêtre hors écran : le rendu se fige parfois au démarrage (relancer) ; shaders non essayés sous Compatibility / web ; qualité Rapide : MSAA coupé (le JS garde l'anticrénelage du canevas) ; l'Aube (`sky_k`, J10) : paramètres du ciel prêts, pas branchés.

J10 livré (fin de partie) :
- **Sim pure** (`godot/sim/`) : `boss_sim.gd` (`BossSim` : le Bourreau, port ligne à ligne de `boss.js` : poursuite par l'IA des zombies, ruée et étourdissement contre un mur, onde de choc, Chaînes, Sentence, Couperet, Bûcher, Glas, phases aux seuils de santé, saut, arrivée ; dégâts face / dos / zone / rayon / étourdi ; l'IA des zombies de `ZombieSim.step` sert la poursuite), `tanner_sim.gd` (Maître Tanneur : vomi en cône, appel de pestiférés), `angel_sim.gd` (Ange du Jugement : cercle, trompette, plumes, Jugement, arrêt des plumes et du rayon par la flèche, position de la trompette), `boss_ctx.gd` (ce que les boss demandent à la partie), `finale_sim.gd` (`FinaleSim` : horloge, intro, trois vagues, Bourreau acte II à IV, victoire, Acte V : faisceau, gargouilles de la terrasse, Ange, rampe (rafales, gargouilles qui montent), Fanal à tenir, Aube (cendres, Bénédiction, ciel, vue orbitale), Nuit éternelle, trophée ; Maître Tanneur aux manches 15, 20, 25… ; barres de vie), `cathedral.gd` (repère `P(s, t)` de la cathédrale lu dans `data/cathedral.json`, axe de la flèche, Fanal, `spire_radius`), `finale_rules.gd` (trophée dans `user://trophy.cfg`). `ZombieSim` gagne la gargouille (`make_kind("gargoyle")`, apparition qui gonfle), `become_ash`, `scale_override`, `attack_damage`, `weak_mult`, `damage(amount, head, hit)`. `Game` : `finale`, `finale_done`, `eternal`, `blessed`, `free_doors`, signaux `boss_event`, `finale_sfx`, `victory_screen`, `liberated_screen`, `hurt_player_by` (projection, attirance des Chaînes, PHD Flopper), manches en pause pendant la finale, atouts gardés à terre sous la Bénédiction, +30 % de vie des zombies en Nuit éternelle, portes gratuites. `PlayerSim` : rafales (`gust_by`) et Chaînes (`pull_by`). Armes : le couteau et la Hache ont les dégâts fixes du Bourreau ; trompette de l'Ange (point faible x2), boîtes de touche de l'Ange (`Hitscan._ray_angel`).
- **Vue** : `zombie_view.gd` (Bourreau : cagoule, tablier, ceinture, lanterne-cœur, hache géante ; Maître Tanneur : ventre de gaz, tablier, masque ; gargouille de pierre à cornes et ailes ; cendres de l'Aube ; poses d'attaque de `pose_overrides`), `angel_view.gd` (robe, ailes de 9 plumes, trompette, auréole), `finale_view.gd` (anneaux de choc, trait de la ruée, Chaînes, Couperet, Bûcher, cône de vomi, cône doré de la trompette, plumes, rayon du Jugement, rafales, faisceau de la flèche homothétique de la caméra, Fanal et sa flamme, sons des évènements), `graphics_view.gd` (`set_sky_k` : dôme, brouillard, ambiance, soleil qui remplace la lune, étoiles, halo, selon `SKY` de `summit.js`), `sky.gdshader` (soleil), HUD (bandeau, barre de boss, marque, jauge du Fanal, vue de cinéma de l'Aube), `main.gd` (touche d'interaction maintenue pour le Fanal, caméra orbitale, Échap passe la vue, écrans « VICTOIRE ! » et « STRASBOURG LIBÉRÉE », `--finale=clock|boss1|boss2|tanner|summit|angel|ramp|fanal|dawn` pour les captures).
- **Outils** : `tools/export-golden-j10.mjs` (lance vite et Chrome, rejoue le VRAI `Boss`, `Tanner`, `Angel` de `src/` sur 4 scénarios scriptés avec `Math.random` remplacé par mulberry32 : `data/golden/j10.json`, ~340 Ko ; écrit aussi `data/cathedral.json`), `tools/j10-golden.page.js` (le script exécuté dans la page), `tools/cdp.mjs` (variable `EVALOUT`) ; `godot-check.sh` ne recalcule ce golden que si le JS concerné est plus récent.
- **Vérifications** : suite `j10` : golden (états, phases, santé, position, cap, recharges, évènements, dégâts aux joueurs, coups de poursuite, ondes de choc / feux / hache, position de la trompette, table des dégâts du Bourreau, `spireRadius`, `blocked`, repère de la cathédrale) puis **une partie complète** sur la carte (manche 12, tous les quartiers) : horloge, trois vagues, Bourreau (Glas, saut, ascension, plateforme, rugissement, mort, Max Munitions, 10 000 points, Hache), faisceau, 24 gargouilles, Ange (trompette x2, attaques, mort), rampe (rafales, gargouilles), Fanal (jauge, retombée), Aube (atouts, ciel, vue orbitale, écran de victoire, trophée), reprise des manches en Nuit éternelle ; Maître Tanneur (apparition, barre, vomi, explosion protégée par le PHD Flopper, récompense) ; captures réelles : horloge, Bourreau et sa barre, Tanneur, terrasse et gargouilles, Ange à la trompette, Fanal et sa jauge, Aube (vue orbitale, faisceau, ciel du matin).
- **Écarts connus / non vérifié** : modèles en primitives (pas de texture de visage de l'Ange, pas de `.glb`) ; le golden compare les boss isolés (monde fictif sans nav) : l'enchaînement avec le monde réel (nav des étages, apparitions) n'est contrôlé que par la partie complète ; le cap du Bourreau n'est pas comparé pendant un demi-tour exact (le sens dépend du dernier bit : Vector3 simple précision contre double du JS) ; le cadavre du Bourreau s'enfonce dans la vue, pas dans la sim ; pas de couronne au-dessus des coéquipiers, de messages réseau (`boss_fx`, `finale_info`, synchro d'un joueur qui arrive en Acte V) ni de co-op (J12) ; lampadaires non atténués à l'Aube (`setLampScale`) ; `trophée` dans `user://trophy.cfg` ; le soleil est dans le shader du ciel (pas de sprite) ; le faisceau n'est pas comparé pixel à pixel au JS ; les sons des attaques sont ceux déjà cuits (cloche, grondement, nuke, groan, explosion) mappés comme dans `showBossEvent` : **aucune écoute vérifiée** ; la fenêtre hors écran fige parfois au démarrage (relancer) ; `_bloat_burst` passe maintenant par `hurt_player` (le PHD Flopper protège, comme dans `finale.js`). `--finale=` place le joueur et saute les étapes (outil de capture, pas du jeu).

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

### J5. Véhicules (L) — fait, v0.6.0
- J5a : motos et vélos (conduite arcade de `vehicles.js`, places, essence, PV, feu, épave, retour, écrasement au-dessus d'une vitesse, chute à vélo),
  borne de service, `ride_cam.gd`.
- J5b : tram (voie, 5 modules articulés, courant, portes, gong, aiguillages, intérieur praticable, feux des portes de zone).
- **Vérification** : golden `Track` (position et cap à des abscisses données, aiguillages) ; scénario headless « moto à pleine vitesse sur une
  ligne droite : distance parcourue en 5 s » comparé au JS ; « tram de quai à quai » ; vidéo.

### J6. Power-ups, atouts et machines (M) — fait, v0.7.0
- Bonus lâchés (Max Munitions, Mort instantanée, Bombe, Points doubles, bidons d'essence), bonus d'ouverture de zone ; 7 atouts (Mastodonte,
  Speed Cola, Double Tap, Réanimation rapide, Mule Kick, Stamin-Up, PHD Flopper) ; boîte mystère (tirage, nounours, déplacement) ;
  Pack-a-Punch à 3 niveaux.
- **Vérification** : golden des probabilités (tirage sur 100 000 essais à graine fixe côté Godot, comparé aux proportions attendues de la config) ;
  scénario headless « acheter chaque atout, vérifier les stats de `statsOf` ».

### J7. HUD complet et menus (L) — fait, v0.8.0
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
