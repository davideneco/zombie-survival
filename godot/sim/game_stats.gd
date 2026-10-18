class_name GameStats
extends RefCounted
## Statistiques de parties, sauvegardées en JSON dans user://stats.json (ou un autre chemin : tests). Une entrée par difficulté (Strasbourg
## seulement : l'arène de test n'est pas une vraie partie). Mise à jour en fin de partie (mort, victoire, ou retour au menu en cours de partie).
## Champs par difficulté : games (parties), wins (victoires : le Bourreau est tombé), best_round, best_kills, best_points, best_time (s),
## total_time (s), total_kills.

const DEFAULT_PATH := "user://stats.json"
const VERSION := 1
const FIELDS := ["games", "wins", "best_round", "best_kills", "best_points", "best_time", "total_time", "total_kills"]

var path := DEFAULT_PATH
var by_diff: Dictionary = {}

func _init(path_ := DEFAULT_PATH) -> void:
	path = path_
	load_file()

static func empty_entry() -> Dictionary:
	var e := {}
	for f in FIELDS:
		e[f] = 0.0 if f.ends_with("_time") else 0
	return e

func entry(diff: String) -> Dictionary:
	diff = Difficulty.valid(diff)
	if not by_diff.has(diff):
		by_diff[diff] = empty_entry()
	return by_diff[diff]

func reset() -> void:
	by_diff = {}
	save()

## Enregistre une partie terminée et sauvegarde. Renvoie les records battus (noms des champs « best_* »).
func record(diff: String, round_number: int, kills: int, points: int, seconds: float, won: bool) -> Array[String]:
	var e := entry(diff)
	var broken: Array[String] = []
	e["games"] = int(e["games"]) + 1
	if won:
		e["wins"] = int(e["wins"]) + 1
	e["total_time"] = float(e["total_time"]) + seconds
	e["total_kills"] = int(e["total_kills"]) + kills
	for pair in [["best_round", round_number], ["best_kills", kills], ["best_points", points], ["best_time", seconds]]:
		var k: String = pair[0]
		if float(pair[1]) > float(e[k]):
			e[k] = pair[1]
			broken.append(k)
	save()
	return broken

## Somme / maximum sur toutes les difficultés.
func overall() -> Dictionary:
	var o := empty_entry()
	for d in by_diff:
		var e: Dictionary = by_diff[d]
		for f in FIELDS:
			if f.begins_with("best_"):
				o[f] = maxf(float(o[f]), float(e[f])) if f == "best_time" else maxi(int(o[f]), int(e[f]))
			else:
				o[f] = float(o[f]) + float(e[f]) if f.ends_with("_time") else int(o[f]) + int(e[f])
	return o

func total_games() -> int:
	return int(overall()["games"])

func save() -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify({"version": VERSION, "difficulties": by_diff}, "\t"))
	return true

func load_file() -> void:
	by_diff = {}
	if not FileAccess.file_exists(path):
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY or typeof(data.get("difficulties")) != TYPE_DICTIONARY:
		return   # fichier illisible : on repart de zéro (il sera réécrit à la prochaine partie)
	for d: String in data["difficulties"]:
		if d not in Difficulty.ids() or typeof(data["difficulties"][d]) != TYPE_DICTIONARY:
			continue
		var e := empty_entry()
		for f in FIELDS:
			var v: Variant = data["difficulties"][d].get(f, 0)
			if typeof(v) in [TYPE_INT, TYPE_FLOAT]:
				e[f] = float(v) if f.ends_with("_time") else int(v)
		by_diff[d] = e

## Texte « 12 min 05 s » / « 48 s ».
static func format_time(s: float) -> String:
	var t := int(s)
	if t >= 3600:
		return "%d h %02d min" % [t / 3600, (t % 3600) / 60]
	if t >= 60:
		return "%d min %02d s" % [t / 60, t % 60]
	return "%d s" % t
