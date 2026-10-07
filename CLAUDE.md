# Zombie Survival

Jeu coop de survie contre des zombies à Strasbourg (Three.js, serveur de dev Vite avec relais WebSocket intégré). Déployé sur Render depuis `main`.

## Délégation
- Toute recherche large dans le code passe par `Explore` (sous-agent intégré).
- Les décisions de conception et d'équilibrage passent par `game-designer` avant d'écrire du code.
- L'implémentation d'un design arrêté passe par `gameplay-coder`.
- Un bug non évident passe par `playtest-bug-hunter`.

## Conventions
- On travaille directement sur `main` ; pousser sur `main` redéploie Render.
- Version de `package.json` incrémentée à chaque changement de jeu ; sujet de commit en anglais terminé par `(vX.Y.Z)`.
- Valeurs d'équilibrage dans `src/config.js`.
- Ne jamais commiter de musique protégée (`public/music/theme.*` est ignoré).
