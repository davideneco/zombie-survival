class_name Settings
extends RefCounted
## Réglages du joueur (Options) dans user://settings.cfg : luminosité, champ de vision, sensibilité, qualité, volumes, effets, personnage,
## pseudo et touches (section [keys], voir Keybinds). Défauts : DEFAULT_SETTINGS de src/main.js. Sans nœud : les scènes lisent `values`
## et écoutent `changed`. Un autre chemin (tests, captures) se donne à `Settings.new(path)` ; `--settings=chemin` dans main.gd.

signal changed(key: String)

const DEFAULT_PATH := "user://settings.cfg"
const DEFAULTS := {
	"brightness": 1.4, "fov": 80.0, "sens": 1.0, "volume": 1.0, "music": 0.5, "quality": 1, "tp_vehicle": true, "chat": true,
	"cinema": true, "halo": true, "char": 0, "name": "Joueur",
	"upscaler": 0, "res_scale": 0, "sharp": 0.9, "aa": 0, "aniso": 0, "fps": false,   ## v0.19.1 « Mise à l'échelle » : 0 natif (bilinéaire), 1 FSR 1.0, 2 FSR 2.2 ; indice de RES_SCALES ; netteté 0..1
	"difficulty": "normal", "map": "strasbourg",   ## menu « Carte et difficulté » (v0.14.0) : voir Difficulty ; carte : "strasbourg" ou "arena"
}
## bornes des curseurs (index.html : optBrightness…)
const RANGES := {
	"brightness": [0.6, 3.0, 0.05], "fov": [60.0, 110.0, 1.0], "sens": [0.3, 3.0, 0.05], "quality": [0, 2, 1], "upscaler": [0, 2, 1], "res_scale": [0, 4, 1], "sharp": [0.0, 1.0, 0.05], "aa": [0, 4, 1], "aniso": [0, 3, 1], "volume": [0.0, 1.0, 0.05], "music": [0.0, 1.0, 0.05],
}
const MAPS := ["strasbourg", "arena"]
const QUALITY_NAMES := ["Rapide", "Normale", "Haute"]
const UPSCALER_NAMES := ["Natif", "FSR 1.0", "FSR 2.2 (expérimental)"]   ## FSR 2.2 : temporel, perd ~40 % de netteté en rotation (mesuré v0.20.4) : jamais choisi automatiquement ni relu d'un fichier de réglages
const AA_NAMES := ["Auto", "Aucun", "MSAA 2x", "MSAA 4x", "FXAA"]   ## v0.20.4 « Anticrénelage » : Auto = selon la qualité (Rapide aucun, Normale 2x, Haute 4x) ; réglage de diagnostic du flou
const ANISO_NAMES := ["Auto", "Aucun", "x4", "x16"]   ## v0.20.4 « Filtrage des textures » : Auto = x4 (défaut du moteur)
const RES_SCALES := [1.0, 0.85, 0.75, 0.67, 0.5]   ## résolution de rendu 3D (le HUD et les menus restent à la résolution de la fenêtre)

var path := DEFAULT_PATH
var values: Dictionary = DEFAULTS.duplicate()
var binds: Keybinds
var autosave := true

func _init(path_ := DEFAULT_PATH) -> void:
	path = path_
	binds = Keybinds.new()
	binds.changed.connect(func() -> void:
		binds.apply_to_input_map()
		if autosave:
			save())
	load_file()

func get_value(key: String) -> Variant:
	return values[key]

## Pose une valeur (bornée pour les curseurs), émet `changed` et sauvegarde.
func set_value(key: String, v: Variant) -> void:
	if RANGES.has(key):
		var r: Array = RANGES[key]
		v = clampf(float(v), float(r[0]), float(r[1]))
		if key in ["quality", "upscaler", "res_scale", "aa", "aniso"]:
			v = roundi(v)
	if values[key] == v:
		return
	values[key] = v
	changed.emit(key)
	if key == "quality":   # un niveau de qualité remet la mise à l'échelle à son préréglage (le joueur peut ensuite la changer)
		apply_scale_preset(int(v), true)
	if autosave:
		save()

## Préréglage de mise à l'échelle du niveau de qualité q (GraphicsRules.upscale_preset). emit : prévient les vues (sinon seulement les valeurs, avant la création de la partie).
func apply_scale_preset(q: int, emit := true) -> void:
	var pre := GraphicsRules.upscale_preset(q)
	for k: String in pre:
		if values[k] != pre[k]:
			values[k] = pre[k]
			if emit:
				changed.emit(k)

func load_file() -> void:
	values = DEFAULTS.duplicate()
	var cf := ConfigFile.new()
	if cf.load(path) == OK:
		for k: String in DEFAULTS:
			if cf.has_section_key("settings", k) and typeof(cf.get_value("settings", k)) == typeof(DEFAULTS[k]):
				values[k] = cf.get_value("settings", k)
			elif cf.has_section_key("settings", k) and typeof(DEFAULTS[k]) == TYPE_FLOAT and typeof(cf.get_value("settings", k)) == TYPE_INT:
				values[k] = float(cf.get_value("settings", k))
		for k: String in RANGES:
			var r: Array = RANGES[k]
			values[k] = clampf(float(values[k]), float(r[0]), float(r[1]))
		values["difficulty"] = Difficulty.valid(String(values["difficulty"]))
		if values["map"] not in MAPS:
			values["map"] = "strasbourg"
		if not cf.has_section_key("settings", "upscaler"):   # réglages d'avant v0.19.1 : la mise à l'échelle suit le préréglage de la qualité enregistrée
			apply_scale_preset(int(values["quality"]), false)
		if int(values["upscaler"]) == 2:   # v0.20.4 : FSR 2.2 (temporel) bave en rotation : un fichier qui l'avait choisi repasse en FSR 1.0 (ou natif à 100 %)
			values["upscaler"] = 1 if int(values["res_scale"]) > 0 else 0
		binds.load_from(cf)
	else:
		binds.reset_all(false)
	binds.apply_to_input_map()

func save() -> bool:
	var cf := ConfigFile.new()
	for k: String in DEFAULTS:
		cf.set_value("settings", k, values[k])
	binds.save_to(cf)
	return cf.save(path) == OK

func reset_all() -> void:
	for k: String in DEFAULTS:
		values[k] = DEFAULTS[k]
		changed.emit(k)
	binds.reset_all(false)
	binds.apply_to_input_map()
	if autosave:
		save()

## Texte d'un curseur (optFormat du JS).
static func format(key: String, v: float) -> String:
	match key:
		"brightness", "volume", "music":
			return "%d%%" % roundi(v * 100.0)
		"fov":
			return "%d°" % roundi(v)
		"sens":
			return "%.2fx" % v
		"quality":
			return QUALITY_NAMES[clampi(roundi(v), 0, 2)]
		"upscaler":
			return UPSCALER_NAMES[clampi(roundi(v), 0, 2)]
		"aa":
			return AA_NAMES[clampi(roundi(v), 0, 4)]
		"aniso":
			return ANISO_NAMES[clampi(roundi(v), 0, 3)]
		"res_scale":
			return "%d%%" % roundi(float(RES_SCALES[clampi(roundi(v), 0, 4)]) * 100.0)
		"sharp":
			return "%d%%" % roundi(v * 100.0)
	return str(v)
