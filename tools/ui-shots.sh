#!/usr/bin/env bash
# v0.34.7 : captures of the menus and the HUD at several window sizes, larger than the screen if needed (gamescope headless backend: the window gets
# exactly the asked size; a normal window is clamped to the desktop).
# Usage: tools/ui-shots.sh OUTDIR [TAG] [SIZES...]     (default sizes: 1280x720 1920x1080 2560x1440 3440x1440 1920x1200)
# Writes OUTDIR/TAG_WxH_SCREEN.png for SCREEN in title, menu (survivor), options, mapdiff, hud (a game at 13:00, seed 1).
# Needs gamescope. Do not run while another Godot works on godot/ (import cache).
set -euo pipefail
out=${1:?output directory}; tag=${2:-shot}; shift $(( $# >= 2 ? 2 : $# ))
sizes=("$@"); [ ${#sizes[@]} -eq 0 ] && sizes=(1280x720 1920x1080 2560x1440 3440x1440 1920x1200)
mkdir -p "$out"
cd "$(dirname "$0")/.."
run() {   # WxH args...
	local W=${1%x*} H=${1#*x}; shift
	timeout 150 gamescope --backend headless -W "$W" -H "$H" -w "$W" -h "$H" -- godot --path godot --resolution "${W}x${H}" -- "$@" >/dev/null 2>&1 || true
}
for res in "${sizes[@]}"; do
	for ui in title menu options mapdiff; do
		run "$res" --menu --ui=$ui --shot="$out/${tag}_${res}_$ui.png" --at=1 --no-music
	done
	run "$res" --seed=1 --hour=13 --hold-hour --shot="$out/${tag}_${res}_hud.png" --at=2 --no-music
done
ls "$out" | grep -c "^${tag}_" || true
