# Journal des versions

Chaque changement est poussé sur `main` (déploiement Render) avec un nouveau numéro de version et sa description ici.

## v0.80.0 (2026-11-07)
- Gare : un train régional (locomotive « 17412 » sans marque + 3 voitures) attend au quai 1, portes ouvertes. On y monte depuis le quai, on parcourt les trois voitures (sièges 2+2, porte-bagages, bandeaux LED dont certains clignotent ou sont morts, écrans « Prochain arrêt : Strasbourg », vestibules, WC, sang) et les intercirculations ; la cabine est verrouillée.
- On tire à travers les fenêtres ; les grenades lancées à l'intérieur rebondissent sur les parois et restent dans la voiture.
- Les zombies de la gare montent par les portes et suivent l'allée jusqu'au joueur ; ils redescendent quand il est sorti.
- Voies SNCF redessinées (rails profilés, traverses, ballast en relief) et voie d'approche du sud-ouest (2,1 km) avec sa caténaire : préparation de l'arrivée en train. Passerelles du quai 1 écartées ; la rame morte de la voie 2 est retirée.
- Moins d'appels de dessin à la gare : machines, armes au mur et grilles à plus de 60 m ne sont plus dessinées (pire vue 395 → 382 avec ombres).
- `?debug&gare&train` démarre debout dans le train.
- Vérifié : build ; partie lancée dans le train et sur l'île sans erreur ; captures regardées (intérieur, train à quai, voie d'approche). Selon le développeur : montée, parcours des 3 voitures et des intercirculations, descente, sans blocage ; 7 zombies montés à bord qui frappent le joueur, sortis en ~8 s ; 5 grenades à l'intérieur ; tir par les fenêtres ; à deux joueurs, l'avatar du coéquipier suit le train ; recherche de pièges dans la gare : 0 ; tram de l'île inchangé.
- Non vérifié : aspect de nuit, test à trois joueurs, vraie carte graphique, partie complète.
- Limites connues : 6 vues de la gare sur 8 dépassent encore 300 appels de dessin ; les balles traversent toute la caisse ; une grenade lancée du quai rebondit sur le train ; les objets de la gare apparaissent d'un coup à 60 m ; au loin, la voie d'approche n'a qu'une bande de sol de ±24 m (vide au-delà, visible de jour) : à compléter pour l'intro en mouvement.

## v0.79.1 (2026-11-07)
- OpenStreetMap recontacté : le serveur Overpass coupe toujours la connexion et ses deux miroirs ne répondent pas, mais l'API officielle d'OSM répond. La zone de la gare y a été retéléchargée (8 388 éléments) et comparée à l'extraction du 24/10 utilisée par le jeu : bâtiments, quais et voies inchangés (seuls des lignes de bus/train, plaques commémoratives et toilettes ont été modifiés). Les données du jeu restent donc à jour.
- L'arrêt de tram « Gare Centrale » du jeu, déduit des rails de l'IGN, est à 2,3 m du vrai arrêt OSM.
- Outil `tools/fetch-rail.mjs --osm` : passe à l'API OSM quand Overpass ne répond pas, et ne sert plus qu'à vérifier la position de l'arrêt (avant, s'il avait réussi, il aurait placé un arrêt sans voie en tête de liste et cassé le tram de la gare).
- Aucun changement de jeu. Vérifié : outil lancé avec `--bdtopo --osm` vers des fichiers d'essai (bascule sur l'API OSM, 4 arrêts trouvés, écart 2,3 m) ; données du jeu non régénérées.

## v0.79.0 (2026-11-07)
- Gare de Strasbourg : nouvelle zone jouable séparée, placée à ses vraies coordonnées et construite d'après les vrais contours (bâtiment de 1883, verrière de 2007 sur sa vraie courbe, halle à deux nefs, hall, quais posés sur les voies SNCF réelles, rame à l'arrêt, passerelles, place de la Gare avec l'arrêt de tram « Gare Centrale »).
- 3 zones à ouvrir : Quais, Hall de la Gare (porte 750 pts), Place de la Gare (1 000 pts), avec leur propre grille de navigation pour les zombies, armes au mur et points d'apparition.
- Tram de transfert : bornes à Gare Centrale et à Homme de Fer (quais B, C, F). [E] appelle le tram (départ dans 8 s), les joueurs à bord partent ensemble : trajet animé de 7 s, fondu au noir, arrivée à l'autre arrêt. En multijoueur, c'est l'hôte qui décide qui monte.
- Menu : nouvelle option « Départ : Gare Centrale » ; `?debug&gare` démarre à la gare.
- Données : outil `tools/fetch-rail.mjs` (voies SNCF Réseau, contours OSM, altitude IGN), fichiers `public/data/gare.json` et `rail.json`.
- Vérifié : build ; partie lancée à la gare sans erreur ; captures regardées (quais, place de la Gare, verrière, intérieur du tram) ; aller gare → Homme de Fer en solo (arrivée sur l'île, zone Homme de Fer, sans erreur). Selon le développeur : aller-retour à deux joueurs testé.
- Limites connues : le serveur Overpass (OSM) n'était pas joignable, les contours OSM viennent d'une extraction déjà présente dans le dépôt ; deux vues de la gare dépassent le budget d'appels de dessin (342 à 392 au lieu de 300) ; un joueur qui rejoint en cours de partie apparaît au départ choisi ; les zombies de la gare n'enjambent pas les fenêtres. Non vérifié : performances sur une vraie carte graphique, partie complète.

## v0.78.3 (2026-11-07)
- Conception de l'intro en train et de la gare de Strasbourg : spécification complète dans `docs/TRAIN_INTRO_SPEC.md` (train qui suit les vraies voies SNCF, gare modélisée fidèlement, liaison gare–ville par le tram avec animation, combat en mouvement, plan en 8 étapes).
- Sources de données identifiées et testées : voies SNCF Réseau (data.gouv.fr / ressources.data.sncf.com), altitude réelle IGN RGE ALTI, maquette 3D et LiDAR de l'Eurométropole de Strasbourg.
- Aucun changement de jeu.

## v0.78.2 (2026-11-07)
- Murs invisibles : nouveau scan « à pied » (4 000 marches avec la vraie collision du joueur, contrôle visuel à 3 hauteurs) puis vérification sur place de chaque cas. Sur 59 cas, 39 étaient du décor simplement chargé de près ; les autres étaient des bancs, barrières, étagères et angles de porte bien visibles, sauf les pièces envahies par du décor de rue (voiture garée, mobilier qui déborde dans la pièce). Ces pièces sont maintenant fermées par une vraie porte : 19 pièces fermées au total, aucune pièce isolée des zombies.
- Intérieurs : correctif des taches noires du parquet (texture mal remplie), plancher découpé pour suivre le relief, pièces plus sombres le jour (la lumière du ciel n'entre que par la porte), plafonniers moins éblouissants.
- Vérifié : build ; 1 135 pièces entièrement reliées à leur rue, aucune isolée ; captures de pièces et des cas suspects. Non vérifié : performances, multijoueur, partie complète.

## v0.78.1 (2026-11-07)
- Une seule carte : la Grande Île de Strasbourg. Le circuit d'essais véhicules et l'arène de test sont supprimés (fichiers, menus, boutons de changement de carte, menu Mod) : jeu plus léger.
- Hélicoptère retiré du jeu (trop instable) : modèle, pilotage, mitrailleuse, tableau de bord, caméra, son et emplacement de la place Kléber. Le 4x4 reste place Kléber.
- Correctif son : depuis la v0.70.0 la pulsation du moteur des motos et voitures était coupée (ligne tombée dans un commentaire) et l'arrêt d'un moteur levait une erreur ; rétabli.
- Vérifié : build ; partie chargée sans erreur (Strasbourg, 1 287 pièces, véhicules moto, voiture, grosse moto, 4x4, vélo) ; voiture et 4x4 conduits en simulation ; place Kléber regardée en capture. Non vérifié : multijoueur, son à l'oreille.

## v0.78.0 (2026-11-06)
- Intérieurs des rez-de-chaussée : 1 287 bâtiments ont maintenant une pièce praticable, ouverte sur la rue par une porte de 2,4 m (sol en parquet ou carrelage, murs avec soubassement, cimaise et plinthe, plafond, plafonnier allumé, étagères garnies). Les ouvertures de façade donnent sur une vraie pièce au lieu du vide.
- Zombies : les pièces font partie de la grille de navigation (les zombies entrent par la porte), aucun zombie n'apparaît au sol à l'intérieur ni par une fenêtre de la pièce où se trouve le joueur, chaque pièce prend la zone de sa rue.
- 12 pièces dont la porte était bouchée côté rue par du décor sont fermées par une vraie porte en bois (pas de cachette hors d'atteinte des zombies).
- Outil : nouvelle étape « walk » de `tools/stuck-scan.mjs` qui cherche les obstacles invisibles en marchant (0,3 / 0,9 / 1,6 m).
- Vérifié : build ; 1 138 pièces entièrement reliées à leur rue, 137 avec des recoins inaccessibles (derrière les étagères), aucune isolée ; un zombie lâché dans la rue a rejoint le joueur au fond d'une pièce en 7,2 s ; captures intérieur et extérieur, aucune erreur. Non vérifié : performances, multijoueur, partie complète.

## v0.77.0 (2026-11-06)
- Outils de développement passés à Claude Code : `CLAUDE.md` (règles et carte du code), 5 sous-agents dans `.claude/agents/` (game-designer et gameplay-coder sur Opus 5.5, explorer, playtest-bug-hunter et gui-test-debugger sur Sonnet 5.5, effort élevé), 4 skills dans `.claude/skills/` (play-test avec un harnais de test réutilisable, map-scan, weapon-sheet, ship), suppression de l'ancien format Gemini (`GEMINI.md`, `.agents/`).
- `.claude/settings.json` : commandes courantes autorisées sans confirmation ; hook de démarrage des sessions cloud qui installe les dépendances npm (sauté si rien n'a changé).
- Règle de travail : chaque changement part sur `main` avec un nouveau numéro de version et une entrée dans ce journal.
- Aucun changement de jeu. Vérifié : build, hook (installation, saut, réinstallation après changement), harnais (partie chargée, aucune erreur).

## v0.76.0 (2026-11-03)
- Collisions réalistes des voitures : carrosserie à trois cercles, rebond, glissement le long des murs, rotation sur un choc excentré ; dégâts selon la vitesse de l'impact (≈ 2 % des PV à 10 m/s, 21 % à 20 m/s, 53 % à 30 m/s de face).
- Dégâts extérieurs : bosses réelles dans la carrosserie, vitres fendues, étincelles, éclats ; voiture qui tire de travers si l'avant est abîmé ; carrosserie remise à neuf à la réparation.
- Correctif du relief : voitures et motos suivent maintenant le terrain.
- Vérifié : simulation contre un mur plan, captures après un choc. Non vérifié : conduite au clavier, multijoueur, visibilité des bosses selon l'angle.

## v0.75.0 (2026-11-03)
- Les 23 armes redessinées : silhouettes profilées (crosses, poignées, chargeurs courbes, pontets creux), canons tournés avec freins de bouche, rails et évents, à la place des blocs.
- Page d'outil `tools/weapon-sheet.html` pour voir toutes les armes.
- Vérifié : planche des 23 armes, M4, AK-47 et M4 Pack-a-Punch III en vue à la première personne.

## v0.74.0 (2026-11-02)
- Relief du terrain : ondulation douce des rues (±0,3 m), berges qui descendent vers l'eau (0,6 m), parvis de la cathédrale surélevé (0,4 m). Tout le décor, le joueur, les zombies et les tirs suivent la même hauteur.
- Vérifié : 80 bots sans blocage, aucune poche piégeante, captures.

## v0.73.0 (2026-11-02)
- Chaînages d'angle en pierre sur les bâtiments (hors colombages), sur toute la carte.

## v0.72.0 (2026-11-02)
- Correctif : deux points de départ du mode aléatoire (Temple-Neuf, Saint-Thomas) étaient dans un mur ; déplacés, plus un garde-fou qui ramène un départ bloqué sur une case libre.
- Façades : bandeaux d'étage, soubassements de pierre, relief des textures renforcé.

## v0.71.0 (2026-11-01)
- Cycle jour / nuit (Auto, Toujours nuit, Toujours jour), horloge sous le radar, zombies +10 % de vie la nuit.
- 9 nouveaux atouts (Œil-de-lynx, Cerise-foudre, Veuve noire, Vautour, Pierre tombale, Ultime Volonté, Bastion, Sixième sens, Cartouchière), 4 atouts portés au plus.
- Suppression de toute mention du portage Godot.
