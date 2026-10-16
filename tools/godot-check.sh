#!/usr/bin/env bash
# Vérification du port Godot : (re)génère config et golden depuis le JS, importe le projet, lance les tests headless.
# Usage : tools/godot-check.sh [suite]     (suite : j0 par défaut)
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/export-config.mjs
node tools/export-golden.mjs
godot --headless --path godot --import >/dev/null 2>&1
godot --headless --path godot res://tests/runner.tscn -- --suite="${1:-j0}"
