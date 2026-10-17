#!/usr/bin/env bash
# Vérification du port Godot : (re)génère config et golden depuis le JS, importe le projet, lance les tests headless.
# Usage : tools/godot-check.sh [suite]     (toutes les suites par défaut ; une seule : j0, j1…)
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/export-config.mjs
node tools/export-golden.mjs
node tools/export-golden-j1.mjs
node tools/export-golden-j3.mjs
godot --headless --path godot --import >/dev/null 2>&1
godot --headless --path godot res://tests/runner.tscn -- ${1:+--suite="$1"}
