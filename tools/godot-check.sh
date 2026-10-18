#!/usr/bin/env bash
# Vérification du port Godot : (re)génère config et golden depuis le JS, importe le projet, lance les tests headless.
# Usage : tools/godot-check.sh [suite]     (toutes les suites par défaut ; une seule : j0, j1…)
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/export-config.mjs
node tools/export-golden.mjs
node tools/export-golden-j1.mjs
node tools/export-golden-j3.mjs
node tools/export-golden-j4.mjs
node tools/export-golden-j5.mjs
node tools/export-golden-j6.mjs
node tools/export-golden-j7.mjs
node tools/export-golden-j8.mjs
node tools/export-golden-j9.mjs
# J10 : le golden du Bourreau / Tanneur / Ange demande le jeu JS dans Chrome (~1,5 min) : recalculé seulement si le JS concerné a changé
if [ ! -f godot/data/golden/j10.json ] || [ -n "$(find src/boss.js src/angel.js src/tanner.js src/zombie.js src/config.js tools/j10-golden.page.js -newer godot/data/golden/j10.json 2>/dev/null)" ]; then node tools/export-golden-j10.mjs; fi
# Rame conduisible cuite (godot/assets/tram, versionnée) : à refaire seulement si carGeometries / atlas de src/hommedefer.js changent :
#   npm run dev   puis   node tools/bake-tram.mjs      (Chrome ; les autres cuissons : bake-world, bake-vehicles, bake-graphics)
godot --headless --path godot --import >/dev/null 2>&1
godot --headless --path godot res://tests/runner.tscn -- ${1:+--suite="$1"}
