# Zombie Survival

Jeu coop de survie contre des zombies à Strasbourg, en deux versions :
- **Navigateur** (branche `main`) : Three.js, serveur de dev Vite avec relais WebSocket intégré. Déployé sur Render depuis `main`.
- **Port Godot 4.7** (branche `godot-port`, dossier `godot/`) : GDScript, solo seulement pour l'instant. Plan et journal : `docs/GODOT_PORT.md` ; mode d'emploi : `godot/README.md`.

## Délégation
- Toute recherche dans le code passe par `explorer`.
- Tout nouveau système (vagues, armes, véhicules, power-ups) passe d'abord par `game-designer`.
- L'implémentation passe par `gameplay-coder` (JavaScript ou GDScript).
- Un comportement bizarre ou un bug passe par `playtest-bug-hunter`.
- Un bug visuel ou d'interface (à constater à l'écran, avec captures) passe par `gui-test-debugger`.

## Conventions communes
- Réponses et documentation en français ; sujets de commit en anglais.
- Ne jamais commiter de musique protégée (`public/music/theme.*` et `godot/assets/audio/music/theme.*` sont ignorés).
- Rapporter honnêtement ce qui est vérifié et ce qui ne l'est pas ; ne pas pousser sans demande.

## Version navigateur (`main`)
- Modules ES, équilibrage dans `src/config.js`.
- Pas de suite de tests : vérifier avec `npx vite build` et en pilotant le jeu avec Playwright (`?debug`) avant de conclure.
- On travaille directement sur `main` ; pousser sur `main` redéploie Render.
- Version de `package.json` incrémentée à chaque changement de jeu ; sujet de commit terminé par `(vX.Y.Z)`.
- `docs/REFERENCE.md` et `docs/csv/` se régénèrent avec `tools/make-docs.mjs`.

## Port Godot (`godot-port`)
- La version du port est propre : `config/version` dans `godot/project.godot`, sujets de commit terminés par `(godot vX.Y.Z)`. `package.json` n'est pas touché.
- **Ne jamais réécrire `godot/project.godot` par script** (il a déjà été vidé) : `sed -i` seulement, puis vérifier 28 lignes et `run/main_scene="res://scenes/main.tscn"`.
- Vérifier avec `tools/godot-check.sh` (golden JS, import, tests headless : 0 échec attendu) et, pour le visuel, une vraie capture (écran réel ou `xvfb-run`), jamais seulement le headless.
- La simulation (`godot/sim/`) reste pure, sans nœuds, et comparée au JS par des golden. Les vues sont dans `godot/scenes/`.
- Si le JS change une valeur ou une règle portée, relancer `tools/godot-check.sh` : les golden sont recalculés depuis le JS.
- `godot/data/golden/j8.json` est modifié à chaque export : `git checkout` avant de commiter.
- Les assets cuits (monde, textures, audio) sont ignorés par git ; les régénérer avec les scripts `tools/bake-*.mjs` (voir `godot/README.md`).
- Export Windows : `tools/export-windows.sh` ; le zip n'est jamais commité.
- Ne pas lancer deux processus Godot en parallèle sur `godot/` (cache d'import).
