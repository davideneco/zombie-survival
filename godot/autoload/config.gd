extends Node
## Configuration d'équilibrage, lue dans data/config.json (exporté par tools/export-config.mjs depuis src/config.js).
## Ne jamais modifier le JSON à la main. Les JSON n'ont pas de couleurs : les entiers 0xRRGGBB restent des entiers, color() les convertit.

const PATH := "res://data/config.json"

var data: Dictionary = {}       ## CONFIG
var pap_levels: Array = []      ## PAP_LEVELS (l'indice 0 vaut null)
var loaded := false

func _init() -> void:
	reload()

func reload() -> bool:
	loaded = false
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		push_error("Config : %s illisible (%s)" % [PATH, error_string(FileAccess.get_open_error())])
		return false
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY or not parsed.has("CONFIG") or not parsed.has("PAP_LEVELS"):
		push_error("Config : %s invalide" % PATH)
		return false
	data = parsed["CONFIG"]
	data["dayNight"] = DayNight.CONFIG   # v0.25.0 : section propre au port (cycle jour / nuit), absente du JS
	data["zoneMode"] = GameMode.CONFIG   # v0.26.0 : mode Zone unique (porte de sortie, apparitions), propre au port
	data["timedMode"] = TimedMode.CONFIG       # v0.33.0 : Contre la montre (chrono)
	data["arsenalMode"] = ArsenalMode.CONFIG   # v0.33.0 : Arsenal aléatoire (plafond de prix des armes tirées)
	for id: String in PerkFx.PERKS:      # v0.27.0 : nouveaux atouts du port (fiches des distributeurs) et leur équilibrage
		data["perks"][id] = PerkFx.PERKS[id]
	data["perkFx"] = PerkFx.CONFIG
	pap_levels = parsed["PAP_LEVELS"]
	loaded = true
	return true

## Valeur à un chemin pointé, par exemple at("zombie.health.base") ; default si absente.
func at(path: String, default: Variant = null) -> Variant:
	var cur: Variant = data
	for key in path.split("."):
		if typeof(cur) == TYPE_DICTIONARY and cur.has(key):
			cur = cur[key]
		elif typeof(cur) == TYPE_ARRAY and key.is_valid_int() and int(key) < cur.size():
			cur = cur[int(key)]
		else:
			return default
	return cur

func weapon(id: String) -> Dictionary:
	return data["weapons"].get(id, {})

func color(rgb: int) -> Color:
	return Color.from_rgba8((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
