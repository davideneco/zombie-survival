#!/usr/bin/env bash
# Export Windows du port Godot (voir docs/GODOT_PORT.md, section « J21 / port Windows ») :
#   tools/export-windows.sh            ->  godot/build/windows/ZombieSurvival/ (Zombie.exe, Zombie.console.exe, Zombie.pck)
#                                          godot/build/windows/ZombieSurvival-windows-vX.Y.Z.zip   (avec LISEZMOI.txt et les licences)
# Prérequis : modèles d'export 4.7.2.stable (godot --version) dans ~/.local/share/godot/export_templates/, et les cuissons présentes
# (fichiers ignorés par git : ils doivent exister sur ce poste au moment de l'export).
# Rien n'est lancé sous Windows : voir les limites dans la doc.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
PROJ="$ROOT/godot"
OUT="$PROJ/build/windows"
APP="$OUT/ZombieSurvival"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { echo "export-windows : $*" >&2; exit 1; }

VERSION="$(sed -n 's/^config\/version="\(.*\)"/\1/p' "$PROJ/project.godot")"
[ -n "$VERSION" ] || fail "application/config/version introuvable dans godot/project.godot"

# --- 1. cuissons (ignorées par git) et modèles d'export -------------------------------------------------------------------------------
missing=0
need() {   # need <chemin relatif à godot/> <commande qui le produit>
	if [ ! -e "$PROJ/$1" ]; then echo "manque godot/$1  ->  $2" >&2; missing=1; fi
}
need data/world/tiles/t0_0.bin        "npm run dev  puis  node tools/bake-world.mjs"
need data/world/doors/d0.bin          "node tools/bake-world.mjs"
need data/world/instances.bin         "node tools/bake-world.mjs"
need assets/baked/c3.png              "node tools/bake-world.mjs"
need assets/textures/cobble/diff.jpg  "node tools/download-textures.mjs"
need assets/graphics/graphics.json    "node tools/bake-graphics.mjs"
need assets/graphics/zombie_geo.bin   "node tools/bake-graphics.mjs"
need assets/graphics/map.png          "node tools/bake-portraits.mjs"
need assets/tram/car.bin              "node tools/bake-tram.mjs"
need data/world/vehicles.json         "node tools/bake-vehicles.mjs"
need assets/audio/sfx/gun_scar_0.wav  "node tools/bake-audio.mjs"
need assets/audio/music/music_0.ogg   "node tools/bake-audio.mjs"
need assets/weapons/LICENSE.txt       "(versionné : git checkout)"
need assets/zombies/LICENSE.txt       "(versionné : git checkout)"
need assets/characters/LICENSE.txt    "(versionné : git checkout)"
[ "$missing" = 0 ] || fail "cuissons absentes : lance les commandes ci-dessus (voir docs/GODOT_PORT.md)"

GODOT_VER="$(godot --version | cut -d. -f1-4)"   # 4.7.2.stable.arch_linux.<hash> -> 4.7.2.stable
TPL="${GODOT_TEMPLATES:-$HOME/.local/share/godot/export_templates/$GODOT_VER}"
[ -f "$TPL/windows_release_x86_64.exe" ] && [ -f "$TPL/version.txt" ] ||
	fail "modèle d'export Windows absent dans $TPL (Godot_v${GODOT_VER%.stable}-stable_export_templates.tpz, voir docs/GODOT_PORT.md § J21)"
[ "$(cat "$TPL/version.txt")" = "$GODOT_VER" ] || fail "version des modèles ($(cat "$TPL/version.txt")) différente du moteur ($GODOT_VER)"

# La version du preset suit celle du port (project.godot reste la seule source).
sed -i "s/^application\/file_version=.*/application\/file_version=\"$VERSION.0\"/; s/^application\/product_version=.*/application\/product_version=\"$VERSION.0\"/" "$PROJ/export_presets.cfg"

# --- 2. données générées, import, export ----------------------------------------------------------------------------------------------
command -v node >/dev/null && node tools/export-config.mjs   # godot/data/config.json à jour (déjà versionné ; sans Node on garde celui du dépôt)
rm -rf "$APP" "$OUT"/ZombieSurvival-windows-v*.zip
mkdir -p "$APP"
godot --headless --path "$PROJ" --import >/dev/null 2>&1
godot --headless --path "$PROJ" --export-release "Windows Desktop" "$APP/Zombie.exe" >"$SCRATCH/export.log" 2>&1 || { tail -20 "$SCRATCH/export.log" >&2; fail "l'export a échoué"; }
grep -E '^(ERROR|SCRIPT ERROR)' "$SCRATCH/export.log" >&2 && fail "erreurs pendant l'export (voir ci-dessus)"
[ -f "$APP/Zombie.exe" ] && [ -f "$APP/Zombie.pck" ] || fail "Zombie.exe / Zombie.pck non produits"

# --- 3. les dossiers .gdignore (PNG/JPG lus en brut) ne sont jamais exportés par Godot : on les ajoute au .pck -----------------------------
mkdir -p "$SCRATCH/empty"
printf 'config_version=5\n[application]\nconfig/name="pck"\n' >"$SCRATCH/empty/project.godot"
python3 -I tools/pck-tool.py stage "$APP/Zombie.pck" "$SCRATCH/stage" "$SCRATCH/manifest.tsv"
python3 -I tools/pck-tool.py add "$PROJ" "$SCRATCH/manifest.tsv" assets/baked assets/textures assets/graphics assets/tram
godot --headless --path "$SCRATCH/empty" --script "$ROOT/tools/pck-pack.gd" -- "$SCRATCH/manifest.tsv" "$SCRATCH/full.pck" >/dev/null
mv "$SCRATCH/full.pck" "$APP/Zombie.pck"

# --- 4. contrôles du contenu ----------------------------------------------------------------------------------------------------------
python3 -I tools/pck-tool.py list "$APP/Zombie.pck" >"$SCRATCH/pck.txt"
if grep -E '	(tests/|data/golden/|data/world/golden_j2|assets/audio/music/theme\.)' "$SCRATCH/pck.txt"; then fail "fichiers de test ou musique protégée dans le .pck"; fi
for f in project.binary data/config.json data/arena.json data/cathedral.json data/audio.json data/weapon_models.json data/zombie_models.json \
	data/graphics/lights.json data/world/vehicles.json data/world/instances.bin data/world/nav/blocked.u8.gz data/world/collision/segs.f64 \
	assets/baked/c3.png assets/textures/cobble/diff.jpg assets/graphics/graphics.json assets/graphics/zombie_geo.bin assets/graphics/map.png \
	assets/tram/car.bin assets/tram/car_map.png assets/audio/music/music_0.ogg.import assets/weapons/LICENSE.txt assets/zombies/LICENSE.txt assets/characters/LICENSE.txt; do
	grep -q "	$f\$" "$SCRATCH/pck.txt" || fail "absent du .pck : $f"
done
[ "$(grep -c '	data/world/tiles/' "$SCRATCH/pck.txt")" = "$(ls "$PROJ/data/world/tiles" | wc -l)" ] || fail "tuiles du monde manquantes dans le .pck"
file "$APP/Zombie.exe" | grep -q 'PE32+ executable.*x86-64' || fail "Zombie.exe n'est pas un PE x86-64"

# --- 5. documentation et licences du paquet ---------------------------------------------------------------------------------------------
mkdir -p "$APP/LICENCES"
cp "$PROJ/assets/weapons/LICENSE.txt" "$APP/LICENCES/armes-LICENSE.txt"
cp "$PROJ/assets/zombies/LICENSE.txt" "$APP/LICENCES/zombies-LICENSE.txt"
cp "$PROJ/assets/characters/LICENSE.txt" "$APP/LICENCES/personnages-LICENSE.txt"
godot --headless --path "$SCRATCH/empty" --script "$ROOT/tools/godot-licenses.gd" -- "$APP/LICENCES/Godot-MIT-et-composants.txt" >/dev/null
[ -s "$APP/LICENCES/Godot-MIT-et-composants.txt" ] || fail "licence de Godot non écrite"
cat >"$APP/LISEZMOI.txt" <<EOF
ZOMBIE SURVIVAL - port Godot - version $VERSION (Windows 64 bits)

LANCER
  Décompresse tout le dossier ZombieSurvival, puis double-clique sur Zombie.exe.
  Garde Zombie.exe et Zombie.pck dans le même dossier (le jeu en a besoin). Rien à installer.
  Zombie.console.exe ouvre en plus une fenêtre de texte avec les messages du jeu : utile pour signaler un problème.

AVERTISSEMENT WINDOWS (SmartScreen)
  Zombie.exe n'est pas signé numériquement : Windows peut afficher « Windows a protégé votre ordinateur ».
  Clique sur « Informations complémentaires » puis « Exécuter quand même ». Un antivirus peut aussi demander une vérification
  au premier lancement (le fichier fait plus de 100 Mo).

CONFIGURATION REQUISE
  Windows 10 ou 11 64 bits, carte graphique compatible Vulkan 1.2 (NVIDIA GTX 900 ou plus récente, AMD RX 400 ou plus récente,
  Intel Arc ou graphique intégré récent), pilotes à jour. 8 Go de mémoire vive conseillés (le jeu en utilise 1 à 2 Go),
  environ 400 Mo d'espace disque. Si Vulkan manque, le moteur essaie DirectX 12 puis OpenGL ; le jeu est écrit pour Vulkan.
  Sur un graphique intégré, la qualité « Rapide » est choisie au premier lancement (Options > Qualité).

TOUCHES PAR DÉFAUT (modifiables : Options > Touches, clavier AZERTY ou QWERTY)
  ZQSD / WASD ou flèches : se déplacer      Maj : sprint        Espace : sauter / enjamber
  Souris : viser ; clic gauche : tirer ; clic droit : viser à l'épaule      R : recharger      1 2 3 : armes
  G : grenade     V : couteau      F : lampe torche      E : interagir (acheter, ouvrir, monter)      M : carte
  K (maintenir) : se débloquer      Échap : pause et menus

DONNÉES ENREGISTRÉES
  Réglages, touches, meilleurs scores et statistiques sont écrits dans :
    %APPDATA%\\Godot\\app_userdata\\Zombie Survival
  (réglages : settings.cfg ; statistiques : stats.json ; trophée : trophy.cfg).
  Remise à zéro des statistiques : menu > MEILLEURS SCORES > REMETTRE À ZÉRO, ou supprime stats.json.
  Tout remettre à zéro : ferme le jeu et supprime ce dossier.
  Musique personnalisée facultative : dépose un fichier theme.mp3, theme.ogg ou theme.wav dans le sous-dossier music\\ du même dossier.

LICENCES ET CRÉDITS
  Le moteur Godot est sous licence MIT (LICENCES\\Godot-MIT-et-composants.txt).
  Modèles d'armes : Quaternius (CC0), Kenney (CC0), Tabasco (CC-BY 3.0) : LICENCES\\armes-LICENSE.txt.
  Modèles de zombies : voir LICENCES\\zombies-LICENSE.txt.
  Modèles des 8 personnages : créations originales du projet : LICENCES\\personnages-LICENSE.txt.
  Plan et bâtiments de Strasbourg : données OpenStreetMap (c) les contributeurs d'OpenStreetMap, licence ODbL.
EOF
sed -i 's/$/\r/' "$APP/LISEZMOI.txt"   # fins de ligne Windows (Bloc-notes)

# --- 6. archive -----------------------------------------------------------------------------------------------------------------------
ZIP="$OUT/ZombieSurvival-windows-v$VERSION.zip"
python3 -I - "$OUT" "$ZIP" <<'EOF'
import os, sys, zipfile
out, zip_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _dirs, files in os.walk(os.path.join(out, "ZombieSurvival")):
        for fn in sorted(files):
            full = os.path.join(root, fn)
            z.write(full, os.path.relpath(full, out))
EOF
ls -l "$APP" "$ZIP"
echo "export-windows : OK -> $ZIP"
