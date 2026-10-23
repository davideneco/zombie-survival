class_name GameStats
extends RefCounted
## Statistiques de parties, sauvegardées en JSON dans user://stats.json (ou un autre chemin : tests). Une entrée par difficulté (Strasbourg
## seulement : l'arène de test n'est pas une vraie partie). Mise à jour en fin de partie (mort, victoire, ou retour au menu en cours de partie).
## Champs par difficulté : games (parties), wins (victoires : le Bourreau est tombé), best_round, best_kills, best_points, best_time (s),
## total_time (s), total_kills.
## v0.26.0 : le mode Zone unique est compté À PART (`by_zone`, une entrée par zone, toutes difficultés confondues) : games, escapes (évasions),
## best_round, best_kills, best_points (points GAGNÉS : la porte de sortie vide le compteur), best_time (plus longue survie), fastest (évasion
## la plus rapide, s ; 0 : aucune), best_diff (difficulté de la meilleure manche). Les parties Zone unique ne touchent pas `by_diff`.
## v0.33.0 : Contre la montre et Arsenal aléatoire sont aussi comptés À PART (`by_mode`, une entrée par mode, toutes difficultés confondues) :
## games, best_round, best_kills, best_points (points GAGNÉS), best_time (plus longue partie), total_time, best_diff. Fichier version 3 (lit 1 et 2).

const DEFAULT_PATH := "user://stats.json"
const VERSION := 3
const FIELDS := ["games", "wins", "best_round", "best_kills", "best_points", "best_time", "total_time", "total_kills"]
const ZONE_FIELDS := ["games", "escapes", "best_round", "best_kills", "best_points", "best_time", "fastest"]
const MODE_FIELDS := ["games", "best_round", "best_kills", "best_points", "best_time", "total_time"]
const MODES := ["timed", "arsenal"]   ## GameMode.TIMED, GameMode.ARSENAL

var path := DEFAULT_PATH
var by_diff: Dictionary = {}
var by_zone: Dictionary = {}     ## nom de zone -> entrée (le nom, pas l'indice : stable si la carte change d'ordre)
var by_mode: Dictionary = {}     ## v0.33.0 : "timed" | "arsenal" -> entrée

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
	by_zone = {}
	by_mode = {}
	save()

static func empty_zone_entry() -> Dictionary:
	var e := {}
	for f in ZONE_FIELDS:
		e[f] = 0.0 if f in ["best_time", "fastest"] else 0
	e["best_diff"] = ""
	return e

func zone_entry(zone_name: String) -> Dictionary:
	if not by_zone.has(zone_name):
		by_zone[zone_name] = empty_zone_entry()
	return by_zone[zone_name]

## v0.26.0 : enregistre une partie Zone unique. Renvoie les records battus (« best_* », « fastest »).
func record_zone(zone_name: String, diff: String, round_number: int, kills: int, points: int, seconds: float, escaped: bool) -> Array[String]:
	var e := zone_entry(zone_name)
	var broken: Array[String] = []
	e["games"] = int(e["games"]) + 1
	if escaped:
		e["escapes"] = int(e["escapes"]) + 1
		if float(e["fastest"]) <= 0.0 or seconds < float(e["fastest"]):
			e["fastest"] = seconds
			broken.append("fastest")
	for pair in [["best_round", round_number], ["best_kills", kills], ["best_points", points], ["best_time", seconds]]:
		var k: String = pair[0]
		if float(pair[1]) > float(e[k]):
			e[k] = pair[1]
			broken.append(k)
			if k == "best_round":
				e["best_diff"] = Difficulty.valid(diff)
	save()
	return broken

static func empty_mode_entry() -> Dictionary:
	var e := {}
	for f in MODE_FIELDS:
		e[f] = 0.0 if f.ends_with("_time") else 0
	e["best_diff"] = ""
	return e

func mode_entry(mode: String) -> Dictionary:
	if not by_mode.has(mode):
		by_mode[mode] = empty_mode_entry()
	return by_mode[mode]

## v0.33.0 : enregistre une partie Contre la montre ou Arsenal aléatoire (points : points GAGNÉS). Renvoie les records battus (« best_* »).
func record_mode(mode: String, diff: String, round_number: int, kills: int, points: int, seconds: float) -> Array[String]:
	var broken: Array[String] = []
	if mode not in MODES:
		return broken
	var e := mode_entry(mode)
	e["games"] = int(e["games"]) + 1
	e["total_time"] = float(e["total_time"]) + seconds
	for pair in [["best_round", round_number], ["best_kills", kills], ["best_points", points], ["best_time", seconds]]:
		var k: String = pair[0]
		if float(pair[1]) > float(e[k]):
			e[k] = pair[1]
			broken.append(k)
			if k == "best_round":
				e["best_diff"] = Difficulty.valid(diff)
	save()
	return broken

func mode_games() -> int:
	var n := 0
	for m in by_mode:
		n += int(by_mode[m]["games"])
	return n

func zone_games() -> int:
	var n := 0
	for z in by_zone:
		n += int(by_zone[z]["games"])
	return n

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
	return int(overall()["games"]) + zone_games() + mode_games()

func save() -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify({"version": VERSION, "difficulties": by_diff, "zones": by_zone, "modes": by_mode}, "\t"))
	return true

func load_file() -> void:
	by_diff = {}
	by_zone = {}
	by_mode = {}
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
	var zs: Variant = data.get("zones")   # absent dans un fichier v1
	if typeof(zs) == TYPE_DICTIONARY:
		for zn: String in zs:
			if typeof(zs[zn]) != TYPE_DICTIONARY:
				continue
			var e := empty_zone_entry()
			for f in ZONE_FIELDS:
				var v: Variant = zs[zn].get(f, 0)
				if typeof(v) in [TYPE_INT, TYPE_FLOAT]:
					e[f] = float(v) if f in ["best_time", "fastest"] else int(v)
			e["best_diff"] = String(zs[zn].get("best_diff", ""))
			by_zone[zn] = e
	var ms: Variant = data.get("modes")   # absent dans un fichier v1 ou v2
	if typeof(ms) == TYPE_DICTIONARY:
		for mn: String in ms:
			if mn not in MODES or typeof(ms[mn]) != TYPE_DICTIONARY:
				continue
			var e := empty_mode_entry()
			for f in MODE_FIELDS:
				var v: Variant = ms[mn].get(f, 0)
				if typeof(v) in [TYPE_INT, TYPE_FLOAT]:
					e[f] = float(v) if f.ends_with("_time") else int(v)
			e["best_diff"] = String(ms[mn].get("best_diff", ""))
			by_mode[mn] = e

## Texte « 12 min 05 s » / « 48 s ».
static func format_time(s: float) -> String:
	var t := int(s)
	if t >= 3600:
		return "%d h %02d min" % [t / 3600, (t % 3600) / 60]
	if t >= 60:
		return "%d min %02d s" % [t / 60, t % 60]
	return "%d s" % t
