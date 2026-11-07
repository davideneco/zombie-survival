# Journal des versions

Chaque changement est poussé sur `main` (déploiement Render) avec un nouveau numéro de version et sa description ici.

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
