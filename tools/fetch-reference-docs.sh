#!/bin/bash
# Rebuilds the `reference-docs` branch: official docs of the libraries the game uses, pinned to the versions in package.json.
#   tools/fetch-reference-docs.sh <work dir outside the repo>     then commit and push the worktree it prints
# Sparse, shallow clones from github.com (data only, nothing from them is executed). Update the refs below with package.json.
set -e
W=${1:?usage: tools/fetch-reference-docs.sh <empty work dir>}
REPO=$(git rev-parse --show-toplevel)
mkdir -p "$W/dl" && cd "$W/dl"
clone() { # dir url ref sparse-paths...
  local dir=$1 url=$2 ref=$3; shift 3
  [ -d $dir/.git ] || git clone -q --depth 1 --branch $ref --filter=blob:none --sparse $url $dir
  git -C $dir sparse-checkout set --no-cone "$@" '/LICENSE' '/LICENSE.md'
}
clone three https://github.com/mrdoob/three.js r170 '/docs/api/en/' '/docs/manual/en/' '/docs/examples/en/' '/docs/list.json'
clone vite https://github.com/vitejs/vite v6.4.3 '/docs/guide/' '/docs/config/' '/docs/index.md'
clone ws https://github.com/websockets/ws 8.22.0 '/doc/' '/README.md'
clone playwright https://github.com/microsoft/playwright v1.63.0 '/docs/src/api/class-page.md' '/docs/src/api/class-browser.md' '/docs/src/api/class-browsercontext.md' '/docs/src/api/class-browsertype.md' '/docs/src/api/class-locator.md' '/docs/src/api/class-keyboard.md' '/docs/src/api/class-mouse.md' '/docs/src/api/class-consolemessage.md' '/docs/src/screenshots.md' '/docs/src/evaluating.md'
clone mdn https://github.com/mdn/content main $(for p in web_audio_api audiocontext baseaudiocontext audioparam gainnode oscillatornode biquadfilternode audiobuffersourcenode convolvernode dynamicscompressornode pannernode webgl_api/webgl_best_practices webgl_api/by_example websocket window/requestanimationframe performance/now page_visibility_api; do echo "/files/en-us/web/api/$p/"; done)
# lay out the branch content in a worktree
cd "$REPO"; git fetch -q origin reference-docs || true
WT="$W/reference-docs"
if git rev-parse -q --verify origin/reference-docs >/dev/null; then git worktree add -q -B reference-docs "$WT" origin/reference-docs; else git worktree add -q --orphan -b reference-docs "$WT"; fi
D="$W/dl"
rm -rf "$WT"/three-r* "$WT"/vite-* "$WT"/ws-* "$WT"/playwright-* "$WT"/mdn
mkdir -p "$WT/three-r170" "$WT/vite-6.4.3" "$WT/ws-8.22.0" "$WT/playwright-1.63.0" "$WT/mdn"
cp -r $D/three/docs/. $D/three/LICENSE "$WT/three-r170/"
cp -r $D/vite/docs/. $D/vite/LICENSE "$WT/vite-6.4.3/"
cp -r $D/ws/doc $D/ws/README.md $D/ws/LICENSE "$WT/ws-8.22.0/"
cp -r $D/playwright/docs/src/. $D/playwright/LICENSE "$WT/playwright-1.63.0/"
cp -r $D/mdn/files/en-us/web/api/. $D/mdn/LICENSE.md "$WT/mdn/"
for d in three vite ws playwright mdn; do echo "$d $(git -C $D/$d rev-parse HEAD)"; done > "$WT/SOURCES.txt"
echo "Content ready in $WT (README.md is kept). Review, then: git -C $WT add -A && git -C $WT commit && git -C $WT push origin reference-docs"
