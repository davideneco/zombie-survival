# Zombie Survival

Jeu coop de survie contre des zombies à Strasbourg (Three.js, serveur de dev Vite avec relais WebSocket intégré). Déployé sur Render depuis `main`.

## Délégation
- Toute recherche dans le code passe par `explorer`.
- Tout nouveau système (vagues, armes, véhicules, power-ups) passe d'abord par `game-designer`.
- L'implémentation passe par `gameplay-coder`.
- Un comportement bizarre ou un bug passe par `playtest-bug-hunter`.
- Un bug visuel ou d'interface (à constater à l'écran, avec captures) passe par `gui-test-debugger`.

## Conventions
- Modules ES, config d'équilibrage dans `src/config.js`.
- Pas de suite de tests : vérifier avec `npx vite build` et en pilotant le jeu avec Playwright (`?debug`) avant de conclure une tâche.
- On travaille directement sur `main` ; pousser sur `main` redéploie Render.
- Version de `package.json` incrémentée à chaque changement de jeu ; sujet de commit en anglais terminé par `(vX.Y.Z)`.
- Ne jamais commiter de musique protégée (`public/music/theme.*` est ignoré).
