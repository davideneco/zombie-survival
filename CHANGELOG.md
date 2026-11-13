# Journal des versions

Chaque changement est poussé sur `main` (déploiement Render) avec un nouveau numéro de version et sa description ici.

## v0.94.0 (2026-11-13)
- **Monde par tuiles, étape 1 : infrastructure (B).** L'île reste figée et identique ; tout ce qui est au-delà peut maintenant être construit par tuiles de 480 m, chargées quand le joueur approche et libérées quand il s'éloigne.
  - Nouveaux : `src/rng.js` (graines par tuile), `src/tiles.js` (streamer, construction découpée en tranches, libération complète), `tools/tiles.mjs` (`--fetch`, `--build`, `--verify`), chemin « streamé » dans `src/architecture.js` (réutilise l'atlas de façades du cœur), `addSet`/`removeSet` pour les arbres, `CONFIG.world`.
  - Données : 4 tuiles réelles OpenStreetMap à l'est de l'île (x 480..1440, z -480..480 : 514 bâtiments, 1 057 arbres, 71 lampadaires). Hauteurs : tag `height`, sinon `building:levels`, sinon 5 étages (pas de données IGN ici). L'eau hors cœur n'est pas dessinée.
  - Libération des trois masques de zones après construction : environ -10 Mo de tas.
  - Vérifié : empreinte déterministe du cœur (stations, armes murales, machines, caisses, cellules de portes, point de départ, flux aléatoire) identique avant/après ; balayage de tuiles 5 fois aller-retour : géométries 4072 → 4084 → 4072, +0,1 Mo par cycle, annulation en cours de construction sans résidu ; après fusion avec A4 : 58 programmes, vue sur les tuiles 154 appels / 0,87 M triangles, départ de l'île 238–245 appels, tas 391 Mo ; build OK ; capture de façades streamées OK ; aucune erreur console.
  - Non vérifié / limites : les tuiles sont visuelles seulement (pas de collision, de navigation ni de zones : on ne peut pas encore y marcher) ; une étape de construction peut durer 8–77 ms pour la plus grosse tuile (la tranche de 2,5 ms n'est pas stricte) ; multijoueur non testé. L'étape 2 (Krutenau jouable) est à faire.

## v0.93.1 (2026-11-13)
- **Performance A4 : programmes shader 85 → 58 (budget ≤ 60).**
  - Tout le code de relief du terrain est maintenant porté par tous les matériaux standard/basic, activé par un uniform `uTerrainK` : le décor déformé et ses jumeaux dynamiques partagent le même programme (85 → 71).
  - Nouveau `src/programShare.js` : les matériaux sans texture reçoivent une carte blanche partagée et réutilisent le programme de leur jumeau texturé ; les matériaux transparents double face se dessinent en une seule passe (71 → 58).
  - Le matériau du proxy d'ombre est un MeshStandardMaterial qui réutilise un programme existant.
  - Vérifié : build OK ; au départ de l'île 240 appels, 1,15 M triangles, tas 391 Mo, 58 programmes (identique à l'île, la gare et l'intro, car tout est précompilé au chargement) ; captures 640x360 avant/après (île, cathédrale, gare, train d'intro, nuit) quasi identiques ; après toutes les armes à 2 niveaux d'amélioration, tous les atouts, 12 zombies et bonus : toujours 58 programmes, aucune erreur console ; achat d'un atout, de la boîte et du Pack-a-Punch OK.
  - Non vérifié : véhicules en mouvement, multijoueur, vitres vues de près depuis l'intérieur du train.

## v0.93.0 (2026-11-13)
**Façades de Strasbourg : chaque bâtiment a maintenant un style fidèle à son quartier.**
- **Classement** (`archStyle.js`) : chaque bâtiment reçoit un style, toujours le même, d'après ses données OpenStreetMap et son quartier : colombage, enduit, hôtel classique du XVIIIᵉ, grès rose civil, Neustadt (1871-1918) ou moderne. `tools/arch-stats.mjs` donne le décompte par style et par quartier.
- **Colombages** (Petite France, cathédrale) : étages en encorbellement, poutres, croix de Saint-André, toits à 55-60°, rangées de lucarnes.
- **Hôtels classiques** : toits mansardés, fenêtres alignées avec les lucarnes, portes cochères.
- **Neustadt** : oriels, tourelles d'angle ; grès rose : pignons à gradins.
- **Façades** : toutes les textures de façade sont réunies dans une seule texture à couches (`facadeAtlas.js`, `facadeLayers.js`, `facadeDraw.js`).
- **Rien ne bouge en jeu** : les objets, machines, boîtes et points d'apparition restent exactement à la même place (l'état du tirage aléatoire après les bâtiments est identique). Les collisions et la navigation ne changent pas.
- **Perf** : départ île à 238 appels de rendu (279 avant les façades), 1,18 M triangles, 391 Mo ; gare 177 appels ; intro 122 appels. Shaders : 85, toujours au-dessus du budget de 60.
- **Vérifié** :
  - le build passe aux deux étapes ;
  - 0 paire de faces qui se chevauchent aux 5 endroits scannés ;
  - captures regardées : Petite France (colombages), place Kléber (lucarnes, encadrements), Petite France de nuit (sombre, comme avant) ;
  - aucune erreur console.
- **Non vérifié** :
  - les oriels et les tourelles : aucun des points de vue pris ne les montre clairement (le bord nord est sur l'eau) ;
  - la rue des Juifs avant/après ;
  - le multijoueur ;
  - le scan complet des blocages.
- **Pas fait** : cadres de lucarnes en relief, enduit rugueux Heimatstil, rugosité par couche.
- **Outils** : le scan de chevauchement a besoin de `?keepgeom` dans l'URL (il lit des données que le jeu libère normalement) ; `tools/stuck-scan.mjs` accepte `AT=x,z` et `ZF_PREFIX`.

## v0.92.0 (2026-11-13)
**Défense : immeubles fortifiés, fenêtres barricadées, point de repli.**
- **30 immeubles fortifiés** (1 à 2 par zone, choisis de façon déterministe) ont un ou deux étages avec escalier à demi-paliers, couloir et pièces (`keyBuildings.js`). Les zombies montent les escaliers : un zombie placé à 4 m du pied de l'escalier atteint l'étage en 11 à 25 s dans 10 immeubles sur 10 testés.
- **Fenêtres barricadées** (`barricades.js`) : trois par immeuble. Les zombies arrachent les 6 planches une par une (environ 8 s en manche 5). On les recloue en maintenant **E** (+10 points par planche, plafonné à 500 points par manche). Le serveur de l'hôte décide et les clients reçoivent l'état par lots.
- **Porte de l'escalier payante** (500 à 1 250 points selon la zone) : tant qu'elle est fermée, les zombies ne peuvent pas monter.
- **Point de repli** au dernier étage : une salle avec sa porte barricadée et une caisse de munitions (une recharge par manche et par joueur).
- **Barricade de fortune** : achetée au poste de munitions, une par joueur et quatre au total. Elle ne coupe jamais le chemin des zombies.
- **Tonneaux explosifs** : 2 par immeuble fortifié.
- **Réglages** : `keyBuildings`, `barricades`, `barrels` dans `src/config.js`.
- **Perf** : départ île à 273 appels, 1,14 M triangles, 391 Mo (le budget de mémoire est de 400 Mo) ; gare 200 appels ; intro 123 appels. Dans un immeuble fortifié, l'agent a mesuré 287 appels (budget 300).
- **Vérifié** :
  - le build passe aux 3 étapes ;
  - itinéraires d'escalier finis pour les 30 immeubles ;
  - 12 077 cellules d'étage valides ;
  - marche du joueur sur 28 escaliers sans saut ni blocage ;
  - réparation (+10, plafond 500) et arrachage des planches ;
  - porte d'escalier fermée → chemin infini, ouverte → 25,8 ;
  - barricade de fortune dans un couloir : chemin toujours fini ;
  - un tir fait exploser un tonneau et tue les zombies proches ;
  - l'outil de recherche de blocages (`stuck-scan`) : 0 joueur bloqué ;
  - capture regardée : fenêtres barricadées et porte à 500 points visibles dans la rue.
- **Non vérifié** :
  - multijoueur réel : les messages hôte/client sont testés en appelant les fonctions directement, sans deux navigateurs ;
  - un étage vu de l'intérieur, la caisse de munitions et la porte d'escalier de près ;
  - l'apparition des zombies à l'extérieur quand on est dans un immeuble ;
  - `game.update` : p95 de 3,7 à 5,3 ms mesuré par l'agent sur l'ancienne base, donc possiblement au-dessus du budget de 4 ms, à remesurer sur une machine au calme.
- **Écarts avec le plan** : un immeuble appartient à la zone de sa porte sur la rue ; la barricade de fortune est payée à l'achat et non à la pose ; les dégâts d'un tonneau sont de 1 000 (au lieu de 600) ; la touche de réparation est E (au lieu de F).
- **Piège déjà connu** : le scan des blocages signale une poche à (-414,6 ; 74,9), à 36 m de tout immeuble fortifié ; elle est au même endroit avant et après cette étape.

## v0.91.0 (2026-11-13)
**Nouvelle intro : 4 min 27 s de train sur 6 km de la vraie ligne.**
- **Train** : une rame de type Régiolis à 4 caisses articulées, refaite de zéro : nez arrondi avec pare-brise incliné, plancher bas au milieu et relevé aux extrémités, marches, rangées de sièges, porte-bagages, cloisons, soufflets. Livrée neutre : aucun logo SNCF/TER. L'intérieur suit la hauteur du plancher (`train.floorAt`), et les zombies du trajet, le tram et les grenades l'utilisent.
- **Trajet** : 6 km en arrivant du sud-ouest par la ligne de Molsheim (l'outil `tools/fetch-ride.mjs` complète `rail.json` avec 4,7 km de voie réelle). Le trajet dure 267 s : 100 km/h en rase campagne, 80 km/h aux abords de la ville, puis ralentissement, passage d'un obstacle et arrêt à quai.
- **Paysage** : le vrai paysage le long de la voie (`rideLand.js`) : maisons à colombages, clochers, champs, haies, peupliers, passages à niveau avec feux clignotants, remblai et ponts (décor seulement : la voie reste plate). Passage de la nuit à l'aube, brouillon plus léger, ligne des Vosges dans le ciel.
- **Protection pendant le trajet** : les zombies du train blessent mais ne peuvent plus tuer avant l'arrivée (réglage `intro.rideMinHealth` = 15 PV). Sans elle, un joueur immobile mourait avant la manche 1 sur ce trajet plus long. Passer l'intro reste possible en maintenant Espace.
- **Perf** : intro à 118 appels et 0,60 M triangles ; départ île à 279 appels, 1,10 M triangles, 368 Mo.
- **Vérifié** :
  - le build passe ;
  - trajet complet en headless jusqu'à la manche 1, sans erreur console ;
  - passage de l'intro depuis τ = 230 ;
  - marche d'un wagon à l'autre sans blocage ;
  - captures de l'intérieur, du nez et du paysage à la fenêtre ;
  - une capture à 2 minutes de trajet regardée : le paysage de nuit, le plan de la fenêtre et le faisceau de la lampe sont corrects.
- **Non vérifié** :
  - multijoueur et joueur qui rejoint en cours de trajet ;
  - passages à niveau, ponts et arrivée dans le faisceau de voies de la gare, regardés de près ;
  - le rendu de jour.
- **Sons manquants** : cloche de passage à niveau, grondement de pont (à ajouter côté audio).

## v0.90.0 (2026-11-13)
**Optimisation (étapes A2 + A3) : moitié moins de triangles et de mémoire.**
- Au départ (Marché-Neuf) :
  - triangles : 1,97 M → 0,92 M (budget 1,5 M) ;
  - mémoire JS : environ 800 Mo → 347 Mo (budget 400) ;
  - appels de rendu : 239 (budget 300).
  - La gare (185 appels, 0,64 M triangles) et l'intro (96 appels, 0,51 M triangles) ne changent pas.
- **Sol** : découpé en morceaux que la caméra ne dessine que s'ils sont dans le champ (`groundChunks.js`, réglage `graphics.groundChunk`).
- **Arbres** : seuls ceux à portée de la caméra sont dessinés, ombres comprises (réglage `graphics.trees.range`). La liste est recalculée quand la caméra a bougé.
- **Géométrie statique** (façades, intérieurs, reliefs, gare, rails, sol) : sa copie en mémoire JS est libérée une fois envoyée à la carte graphique (`gpuOnly.js`). Si le navigateur perd le contexte WebGL, la page se recharge.
- **Outils** : `tools/perf-probe.js` mesure maintenant la mémoire après un ramasse-miettes forcé, donc les anciens chiffres de mémoire ne sont pas directement comparables.
- **Pas atteint** : le budget de 60 shaders (85 aujourd'hui). Ce sont tous des combinaisons de matériaux différentes ; il faudra revoir les matériaux, sans doute avec les façades (étape C).
- **Vérifié** :
  - le build passe ;
  - mesures chiffrées au départ, à la gare et dans l'intro ;
  - captures regardées : départ et un intérieur de magasins (rendu correct) ; l'agent a aussi comparé départ, cathédrale et gare avant/après, sans différence ;
  - l'agent a testé en jeu les achats (porte, atout, boîte, Pack-a-Punch) et le passage île ↔ gare, sans erreur console.
- **Non vérifié** :
  - le coût de `game.update` : la mesure est faussée par la machine surchargée pendant le test (trois navigateurs en parallèle) ;
  - la croissance de la mémoire sur 10 minutes ;
  - le multijoueur ;
  - la perte réelle du contexte WebGL.

## v0.89.0 (2026-11-12)
**Optimisation (étape A1) : 3 fois moins d'appels de rendu.**
- Au départ (Marché-Neuf), le jeu passe de 858 à 271 appels de rendu par image le jour, et 253 la nuit. À la gare (quai 1), il passe de 319 à 185. Dans l'intro en train, il passe de 110 à 96. Toutes ces vues sont maintenant sous le budget de 300.
- **Ombres** : seuls les gros objets proches projettent une ombre. Les bâtiments utilisent un modèle simplifié pour l'ombre (`shadowProxy.js`).
- **Machines, accessoires et viewmodel** : les machines (atouts, munitions, boîte mystère, Pack-a-Punch), les accessoires et l'arme en main sont fusionnés par matériau (`bake.js`). Les pièces animées restent séparées (couvercle de la boîte, engrenages du PaP).
- **Barricades des portes payantes** : elles sont regroupées par morceau de carte (`gateBatch.js`). Le morceau est reconstruit quand une porte s'ouvre.
- **Petits détails** : ils sont masqués au-delà d'environ 90 m (`detailCull.js`).
- **Tuiles de façades** : elles passent de 160 à 240 m. Les nouveaux réglages sont `graphics.detailCull`, `cityTile` et `propShadows`.
- **Pas encore fait** : les triangles restent à 1,97 M au départ (budget 1,5 M) et la mémoire à environ 800 Mo (budget 400). Ce seront les étapes A2 (façades lointaines simplifiées) et A3 (mémoire).
- **Vérifié** :
  - le build passe ;
  - mesures chiffrées au départ (jour et nuit), à la gare et dans l'intro ;
  - captures avant/après regardées (départ, machine d'atout, munitions, AK amélioré en main, barricade, gare, départ de nuit) : rendu identique ;
  - achats testés en jeu (atout, munitions, arme murale, boîte mystère, Pack-a-Punch) ;
  - passage île ↔ gare ;
  - ouverture des 58 portes d'un coup, comme pour un joueur qui rejoint en cours de partie : 48 ms, aucune erreur.
- **Non vérifié** :
  - partie multijoueur réelle : l'ancien test `tools/mp-smoke.mjs` ne fonctionne plus depuis l'arrivée de l'intro et du lobby, mais les clients passent par le même code d'ouverture de porte ;
  - portes du portail de la cathédrale ;
  - fluidité sur un vrai GPU.

## v0.88.1 (2026-11-12)
- Retour aux sons d'avant Gemini, à ta demande : les voix françaises (annonces du train et du tram, narrateur, survivant), les cris de zombies, les bruits de pas et les ambiances de la gare et de la ville ajoutés en v0.86.0 et v0.87.0 sont retirés (77 fichiers sons, leur code et leurs appels dans le jeu). Les sons de synthèse d'avant et tes musiques (`public/music/`, inchangées) restent.
- Conservé : le pistolet de départ au hasard, le passage entre les wagons réparé, la documentation et les outils ajoutés depuis.
- Vérifié : build ; intro jouée 30 s et départ sur l'île sans erreur ; les 46 sons d'avant appelés un par un sans erreur. Non vérifié : écoute réelle.

## v0.88.0 (2026-11-12)
- Mémoire technique du projet : nouveau `docs/ARCHITECTURE.md` (conventions de code, chaîne de rendu, mécanismes de performance et budgets, génération des bâtiments et des intérieurs, déterminisme, systèmes de progression, limites pour étendre la carte à toute la ville). README, `AGENTS.md` et `CLAUDE.md` mis à jour et renvoient vers ce document.
- Documentation officielle téléchargée dans la branche `reference-docs` (three.js r170, Vite 6.4.3, ws 8.22.0, Playwright 1.63.0, MDN : Web Audio, WebGL, WebSocket), aux versions utilisées par le jeu ; `tools/fetch-reference-docs.sh` la régénère.
- Nouvel outil de mesure `tools/perf-probe.js` et skill `perf-check` (appels de dessin, triangles, objets, mémoire, coût de la simulation). Premières mesures : départ sur l'île 858 appels de dessin et 2,29 M de triangles (budget 300 et 1,5 M), 756 Mo de mémoire ; gare 319 appels ; intro 110 appels.
- Aucun changement de jeu (un commentaire de code corrigé). Vérifié : build ; outil de mesure lancé sur l'île, la gare et l'intro ; branche de docs poussée (509 fichiers). Non vérifié : performances sur une vraie carte graphique.

## v0.87.1 (2026-11-12)
- Nouveau dossier pour faire l'intro vidéo avec Google AI Studio (`docs/AI_STUDIO_VIDEO.md`) : une vidéo d'environ 56 s en 7 plans de 8 s (train de nuit, couloir, zombie à la vitre, zombie dans l'allée, arrivée à l'aube sous la verrière, quai, façade de la gare), avec pour chaque plan l'image de départ, le texte à donner à Veo, le bloc de style commun, les voix et sons à placer au montage, des plans de remplacement et la marche à suivre pour assembler.
- Les 14 images de référence sont de vraies captures du jeu (sans interface), prises à l'aube, au crépuscule et de nuit ; elles sont fournies à part dans un dossier à télécharger, pas dans le dépôt.
- Aucun changement de jeu. Vérifié : images regardées une à une sur planches ; le test de capture (caméra libre, interface masquée) tourne sans erreur. Non vérifié : le résultat de Veo (pas encore essayé).

## v0.87.0 (2026-11-12)
- **Partie A du brief audio (`docs/AI_STUDIO_BRIEF.md`)** : régénération des 28 voix françaises avec découpage prosodique par proposition, respirations naturelles, chuchotement spectral (`intro_roof`), panique montante (`intro_pa_panic`), grognement de douleur réel (`char_hurt_1`) et résonance grave du narrateur.
- **Partie B du brief audio (20 nouveaux sons)** : génération et intégration en jeu des 6 râles de zombies (`zombie_groan_a..f`), 3 cris d'attaque (`zombie_attack_a..c`), 3 râles d'agonie (`zombie_die_a..c`), prise de fenêtre étouffée par la vitre (`zombie_window_grab`), 4 cris courts de douleur homme/femme (`player_hurt_a..d`), mise à terre (`player_down`), réanimation (`player_revive`) et annonce PA interrompue par les grésillements et les cris (`pa_cut`), accompagnés de `manifest.json`.
- *Vérifié : `npx vite build` OK, 48 fichiers WAV (48 kHz, 16 bits, mono, crête -3,0 dBFS) générés dans `/home/david/Téléchargements/ai_studio_audio/` + 48 fichiers `.ogg` dans `public/sfx/` + `manifest.json`, 57 méthodes `Sfx` testées sans erreur / Non vérifié : sons non écoutés.*

## v0.86.2 (2026-11-10)
- Le dossier de commande pour Google AI Studio (`docs/AI_STUDIO_BRIEF.md`) est refait autour des 28 voix déjà en jeu (annonces du train et du tram, narrateur, voix du survivant) : mêmes noms de fichiers, textes exacts, locuteur et ton de chaque réplique, format demandé. Les fichiers rapportés remplacent les voix de synthèse actuelles sans changer le code. Les nouveaux sons (zombies, joueur) sont en option, en seconde partie.
- Aucun changement de jeu. Vérifié : le jeu fusionné avec le travail de Gemini démarre avec un seul pistolet, les 53 sons passent le test sans erreur ; la liste des 28 fichiers vient du script de génération. Non vérifié : le résultat d'AI Studio (pas encore reçu) et la conversion des fichiers rapportés.

## v0.86.1 (2026-11-10)
- On démarre maintenant avec un seul pistolet de base, tiré au hasard pour chaque joueur parmi le Colt M1911 et l'AREX ZERO 1 (plus de M4A1 au départ) ; les autres armes s'achètent au mur ou se trouvent dans la boîte mystère. La liste est dans `startPistols` (config).
- Train de l'intro : les portes entre les voitures étaient en partie bouchées par une plaque beige à bord diagonal (un habillage mal découpé) ; l'ouverture est maintenant dégagée entre chaque voiture.
- Nouveau dossier de commande pour les voix et les sons (`docs/AI_STUDIO_BRIEF.md`) : un seul fichier à envoyer dans Google AI Studio, avec les annonces (train, tram), les voix de zombies et de joueurs, les ambiances, les pas et les petits bruitages à produire, leur format et le nom de chaque fichier.
- Vérifié : build ; démarrage en jeu avec un seul pistolet (M1911 obtenu), aucune erreur ; lancer de rayons à travers l'ouverture entre deux voitures (la plaque a disparu, seul reste le haut du mur) ; capture de l'ouverture regardée. Non vérifié : tirage de l'AREX au démarrage (même code), les portes dans le train en marche à la nuit tombée, la sauvegarde des voix.

## v0.86.0 (2026-11-09)
- **Bruits de pas selon la surface** : pas distincts sur pierre/asphalte (`stone`), plancher bois (`wood`), grilles/passerelles métalliques (`metal`) et quais de gare/tram (`platform`), avec cadence et impact renforcés au sprint et à l'atterrissage.
- **Audio du tram et du train d'intro** : cloche d'avertissement (`tramBell`), pneumatique et glissement des portes (`tramDoors`), moteur de tramway enrichi (onduleur PWM, harmonique de traction, crissement de bride en courbe, joints de rail) et sifflement d'air dans les vitres brisées du train d'intro.
- **Armes et véhicules améliorés** : sous-basse punchy, claquement mécanique de culasse, queue de réverbération urbaine et tintement de douille/cartouche au sol pour les armes à feu ; formant d'échappement, bruit de roulement des pneus et pétarades à la décélération pour les véhicules.
- **Ambiances sonores de station et de ville** : boucles d'ambiance dédiées pour l'intérieur de la gare/métro (grondement de ventilation, bourdonnement des néons, gouttes d'eau, grondement lointain) et l'extérieur urbain (vent dans les ruelles, bourdonnement électrique, sirène lointaine, tôle au vent), en complément de la musique existante.
- **Voix françaises du narrateur, de l'interphone et des personnages** : annonces vocales de l'intro dans le train (interphone RATP et narrateur), annonces des trams de transfert entre la Gare Centrale et les Hauts-de-France, voix du narrateur pour les manches et bonus, et répliques vocales partagées pour tous les personnages (rechargement, chargeur vide, blessure, mise à terre, réanimation, tir dans la tête, achat d'arme).
- *Vérifié : `npx vite build` OK, 28 fichiers vocaux `.ogg` générés dans `public/sfx/`, 53 méthodes et boucles `Sfx` testées sans erreur / Non vérifié : Playwright absent sur la machine hôte, sons non écoutés.*

## v0.85.0 (2026-11-09)
- Nouvel outil `tools/token-meter.mjs` : compteur de jetons à partir des vraies données enregistrées par Claude Code (conversation principale et sous-agents) : jetons écrits, entrée, cache écrit, cache lu ; depuis le dernier appel, depuis le démarrage du compteur, pour toute la session, et sur 7 jours par modèle (`--week`). Claude l'affiche à la fin de ses réponses.
- Constat du premier relevé sur 7 jours : 1,66 M de jetons écrits, dont 87 % par Opus et 72 % par les sous-agents, d'où le passage de `gameplay-coder` sur Sonnet.
- Aucun changement de jeu. Vérifié : le compteur tourne sur la session en cours (totaux, 7 jours, remise à zéro). Non vérifié : correspondance exacte avec le pourcentage de la limite hebdomadaire (formule non publique ; `/usage` donne le chiffre réel).

## v0.84.1 (2026-11-09)
- L'agent de développement `gameplay-coder` passe de Opus 5.5 à Sonnet 5.5 (effort élevé) pour réduire la consommation hebdomadaire ; seul `game-designer` reste sur Opus 5.5.
- Aucun changement de jeu. Vérifié : réglage de l'agent et des consignes relus. Non vérifié : qualité du code produit par l'agent sur Sonnet à l'usage.

## v0.84.0 (2026-11-09)
- Préparation du travail en parallèle avec Gemini sur tout ce qui est sonore : Gemini est responsable de `src/audio.js`, `src/music.js`, `public/music/`, `public/sfx/` ; Claude du reste. Nouveaux fichiers `GEMINI.md`, `AGENTS.md` (règles communes et répartition), `docs/AUDIO.md` (fonctionnement du son, règles, liste de demandes entre les deux : ambiance de la gare, bruits de pas, cloche du tram, ambiance de la ville) et `.gemini/styleguide.md` (relecture des PR de Gemini).
- Nouvel outil `tools/ship.mjs` : une seule commande pour publier (rebase sur `main`, prochain numéro de version libre, entrée du journal, docs, build, commit, push de la branche et de `main`) ; deux agents peuvent publier chacun de leur côté sans conflit de version. `tools/scopes.json` limite Gemini à ses fichiers sonores.
- Nouvel outil `tools/audio-smoke.js` : appelle chacun des 46 sons du jeu et signale ceux qui plantent (aucun ne plante).
- Économie de jetons : règles dans `CLAUDE.md` (modèle par défaut, ne pas lire les gros fichiers, rapports courts), rapports des sous-agents limités à 200 mots, lecture des données volumineuses interdite dans `.claude/settings.json`, captures plus petites dans la skill play-test, skill ship réduite à une commande.
- Aucun changement de jeu. Vérifié : le script de test sonore tourne sur le jeu (46 sons, 0 erreur) ; la publication elle-même est faite avec le nouveau script. Non vérifié : un vrai travail de Gemini sur la branche `gemini/audio`, le script avec deux agents en même temps.

## v0.83.1 (2026-11-08)
- Plus de texte « ZQSD : marcher · train en marche… » pendant le trajet en train (intro) ni pendant le trajet en tram de transfert : l'écran reste dégagé. Les annonces, l'indication pour passer l'intro, le compte à rebours du tram et le texte de descente à quai restent.
- Vérifié : build ; intro lancée (aucun texte à τ = 10 s, annonce affichée, capture regardée) ; après le passage de l'intro, le texte de descente à quai réapparaît ; aucune erreur. Non vérifié : trajet en tram rejoué (même changement, une ligne).

## v0.83.0 (2026-11-08)
- Le tram de transfert roule vraiment : le trajet Gare Centrale ↔ Homme de Fer suit le vrai tracé de la ligne C (données OpenStreetMap) : départ du parvis, rue du Faubourg de Saverne (l'arrêt est passé au ralenti), pont sur l'Ill, arrivée à l'Homme de Fer. Fini l'écran noir de la v0.79.
- On voyage debout dans la rame : on peut y marcher et tourner, les portes restent verrouillées jusqu'à l'arrêt. Annonces « Tram C — direction … » et « Prochain arrêt : … », titre à l'arrivée.
- Le trajet dure environ 35 s, avec deux courts fondus au noir (~1 s) qui raccourcissent le kilomètre réel et cachent le passage gare ↔ île.
- Pendant le trajet, aucun zombie ne vous poursuit ni ne vous blesse ; à l'arrivée, les portes s'ouvrent côté quai et la zone d'arrivée s'ouvre comme avant.
- Nouveau décor entre la gare et l'île : rails et caténaire de la ligne C, pont en grès sur l'Ill, quai de Faubourg de Saverne.
- En coop, tout le monde voit la même rame avec les coéquipiers debout dedans ; ceux qui restent à quai ne sont pas concernés.
- Note : la vraie ligne C ne passe pas par Alt Winmärik (c'est la ligne B/F) ; le trajet suit le tracé réel.
- Vérifié : build ; trajet gare → Homme de Fer lancé dans le jeu (arrivée sur l'île, zone Homme de Fer, PV restés à 100, aucune erreur) ; captures regardées (pont de jour, rue de nuit, arrivée). Selon le développeur : aller et retour en marchant dans la rame sans en sortir, de jour et de nuit ; aucun zombie dans la rame ; deux onglets (départ groupé, et un passager pendant que l'autre reste) ; intro, départ gare et départ classique sans erreur ; 187 à 249 appels de dessin côté gare.
- Non vérifié : retour de nuit, vraie latence réseau, arrivée en cours de trajet, vraie carte graphique.
- Limites : un joueur resté à quai voit la rame apparaître/disparaître aux coupes ; la rame peut traverser le tram conductible s'il est sur la voie B/C/F ; si le tram conductible occupe le quai, la rame s'arrête 36 m plus loin ; sur l'île, certaines vues du trajet (pont) dépassent déjà le budget d'appels de dessin (coût de l'île, pas du tram).

## v0.82.0 (2026-11-08)
- Les zombies attaquent le train. Pendant le trajet, des zombies longent la voie : abattez-les par les fenêtres. Ceux qui restent sur la voie sont percutés par la locomotive (choc, sang sur le pare-brise, 0 point).
- Au ralentissement près des wagons déraillés : « Ils s'accrochent aux fenêtres ! ». Des zombies courent le long du train, s'agrippent à une fenêtre, la vitre se fend puis vole en éclats (elle reste cassée, le vent s'engouffre), ils grimpent à l'intérieur et vous poursuivent dans l'allée. Au plus 4 accrochés à la fois (8 à quatre joueurs) ; on peut les abattre à la fenêtre.
- Des pas sur le toit, puis la porte arrière de la dernière voiture est forcée : des zombies arrivent par l'intercirculation.
- À l'arrivée, les zombies encore à bord descendent sur le quai et quelques-uns sortent du ballast ; la manche 1 commence comme d'habitude. Passer l'intro fait disparaître les zombies du trajet.
- Coop : l'hôte décide de tout, les zombies du trajet suivent le train chez chacun, chaque joueur reçoit ses propres points.
- Vérifié : build ; intro déroulée jusqu'au ralentissement sans erreur (9 zombies autour du train, 144 appels de dessin) ; captures regardées (zombie accroché à une vitre fendue, zombie dans l'allée, intérieur au ralentissement). Selon le développeur : trajet solo complet pas à pas (21 zombies, 19 éliminés par un tireur automatique, 2 percutés), plafond des zombies accrochés respecté, aucun zombie hors de la caisse en marche ou au freinage, joueur immobile blessé puis à terre, arrivée, saut de l'intro, manche 1 terminée, deux onglets hôte + client (zombies attachés au train chez le client, points du client crédités au client, mêmes fenêtres cassées), départs classique et gare et tram vers Homme de Fer sans erreur.
- Non vérifié : jeu en temps réel à la souris, sons, 3 ou 4 joueurs, arrivée en cours de trajet, coéquipier à terre dans le train en marche, coup de couteau sur un zombie accroché.
- À surveiller : un tireur parfait gagne ~1 560 pts pendant le trajet (objectif ~1 000) ; les balles traversent le bas des parois ; les fenêtres restent cassées après un saut de l'intro ; l'intro démarre toujours avec le M4A1 en main.

## v0.81.0 (2026-11-07)
- L'intro en train : la partie commence désormais dans le train régional 17412 qui arrive de nuit en gare de Strasbourg (~95 s) : carton « TRAIN RÉGIONAL 17412 — DIRECTION STRASBOURG », annonces à bord, 80 km/h, « RALENTISSEMENT — Obstacle sur la voie » à 15 km/h devant des wagons déraillés, 50 km/h, arrêt au quai 1 sous la halle.
- On marche dans les voitures et les intercirculations pendant que le train roule (portes verrouillées), avec un léger roulis et les secousses des joints de rail ; les grenades restent dans la voiture même au freinage ; on peut tirer par les fenêtres.
- À l'arrêt : « STRASBOURG — Terminus. Tout le monde descend. », portes ouvertes, puis la manche 1 commence 5 s plus tard (zone Quais).
- Maintenir [Espace] 1,5 s pour passer l'introduction (en coop : l'hôte seulement).
- Décor le long de la voie : clôtures, arbres, entrepôts, immeubles et maisons aux fenêtres éclairées, lampadaires, signaux ; sol sombre jusqu'à l'horizon.
- Sons : roulement, joints de rail, crissement des freins, carillon, porte-voix qui grésille, portes.
- Menu « Départ » : Train régional (par défaut), Gare Centrale, Classique (Grande Île au hasard). `?debug&intro` lance l'intro ; `?debug` seul garde le départ classique.
- Coop : l'hôte donne le tempo du train, un joueur qui arrive pendant le trajet monte en voiture 3.
- Vérifié : build ; intro lancée et déroulée jusqu'à τ = 50 sans erreur (train en route, nuit, 142 appels de dessin) ; départ classique sur l'île sans erreur ; captures regardées (intérieur en marche, ralentissement, arrivée « Terminus »). Selon le développeur : trajet complet pas à pas en marchant dans les 3 voitures et les intercirculations à 80 km/h et au freinage sans jamais sortir du train, portes fermées infranchissables, arrêt exact, manche 1 en zone Quais, passage de l'intro, recommencer, départs classique et gare, grenades et tirs dans le train qui roule, 147 à 164 appels de dessin pendant le trajet, test à deux onglets (départ du salon, arrivée en cours de route, avatars dans le train, passage synchronisé).
- Non vérifié : le son à l'oreille, le ressenti sur un vrai GPU, le multijoueur sur un vrai réseau (l'écart de position du train entre deux joueurs n'a pas pu être mesuré proprement en dessous de 0,5 m dans le banc de test), le bouton REJOUER cliqué.
- Limites : pas encore de zombies pendant le trajet (phase 4) ; de nuit le décor se lit surtout par les fenêtres éclairées ; le HUD affiche « MANCHE 1 » pendant le trajet ; un joueur qui arrive après l'arrêt apparaît au départ de la gare.

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
