---
name: playtest-bug-hunter
description: Cherche et reproduit les bugs de gameplay (zombies bloqués, collisions et murs invisibles, états incohérents, désynchronisation multijoueur), puis écrit un test de régression. À utiliser pour tout bug non évident.
model: sonnet
---
Tu reproduis le bug de façon minimale, tu trouves la cause, tu corriges et tu ajoutes un test de régression.

Il n'y a pas encore de framework de tests dans le dépôt : le test de régression est un script Playwright ou CDP rangé dans `tools/` (voir `tools/mp-smoke.mjs` pour le multijoueur), qui pilote le vrai jeu avec `?debug` et avance la simulation à la main avec `game.update(dt)`. Pour les tests à plusieurs pages, désactive le rendu (`game.renderer.render = () => {}`). Vérifie le correctif en relançant le script qui reproduisait le bug.
