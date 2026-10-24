class_name LoadPrefetch
extends RefCounted
## v0.34.6 : at the start of a game load, the game's imported resources (zombie models, weapon meshes, shaders, PBR textures of the map) are requested
## from the loader threads (ResourceLoader.load_threaded_request) while the map data is read on its own thread and the loading screen animates.
## The views then `load()` the same paths as before: the engine hands them the resource loaded (or being loaded) by the threads. `finish()` (end of
## the load, or unload) collects the requests so the loader drops its references: resources no view kept are freed, as before.
## Nothing is prefetched for the arena (test map). The menu never prefetches (its own loads stay as they are, v0.34.3).

const WeaponModels := preload("res://scenes/weapon_models.gd")
const PBR_DIR := "res://assets/pbr/"
## PBR folders used by each map (the others stay unloaded); Strasbourg: surfaces.gd, world_view.gd, city_details_view.gd, cathedral_*.gd, shop_models.gd.
const PBR_ALPINE_ONLY := ["ground_snow", "rock_cliff", "wall_fieldstone"]

static var _paths: PackedStringArray = []
static var requested := 0

## Paths requested for a map (pure: tests).
static func paths_for(map: String) -> PackedStringArray:
	var out := PackedStringArray()
	if map == "arena":
		return out
	for m: Dictionary in (ZombieModels.table()["models"] as Dictionary).values():
		out.append(ZombieModels.DIR + String(m["file"]))
	for e: Dictionary in WeaponModels.table().values():
		var p := WeaponModels.DIR + String(e["file"])
		if not out.has(p):
			out.append(p)
	for f in ResourceLoader.list_directory("res://shaders/"):
		if f.ends_with(".gdshader"):
			out.append("res://shaders/" + f)
	for d in ResourceLoader.list_directory(PBR_DIR):
		if not d.ends_with("/") or d.begins_with("."):
			continue
		var name := d.trim_suffix("/")
		if map != "alpine" and name in PBR_ALPINE_ONLY:
			continue
		for f in ["a.png", "m.png"]:
			out.append(PBR_DIR + name + "/" + f)
	return out

## `extra` : autres chemins (v0.34.8 : scripts des vues de jeu de main.gd, compilés sur les fils du chargeur).
static func start(map: String, extra: Array = []) -> void:
	finish()
	var all := PackedStringArray()   # les chemins en plus d'abord (scripts des vues : attendus les premiers)
	for e in extra:
		all.append(String(e))
	for p in paths_for(map):
		if not all.has(p):
			all.append(p)
	for p in all:
		if ResourceLoader.has_cached(p) or not ResourceLoader.exists(p):
			continue
		if ResourceLoader.load_threaded_request(p, "", true) == OK:
			_paths.append(p)
	requested = _paths.size()

## Collects every request (waits for the ones still loading) so the loader releases them.
static func finish() -> void:
	for p in _paths:
		ResourceLoader.load_threaded_get(p)
	_paths.clear()
