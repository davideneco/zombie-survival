extends RefCounted
## v0.27.0 : place les distributeurs des neuf nouveaux atouts (sim/perk_fx.gd) dans des zones qui n'avaient pas d'atout, et écrit
## godot/data/perk_machines.json (versionné : les emplacements ne changent pas d'une partie à l'autre et se relisent à l'œil).
## Usage (outil, pas un test : absent de la liste des suites) : godot --headless --path godot res://tests/runner.tscn -- --suite=place_perks
## Règle (ZoneLayout.wall_spot) : case de la zone jouable à 3 x 3 cases libres, adossée à un mur (anneau à 2 cases bloqué d'un côté), la plus
## proche du milieu de la zone, à 6 m au moins des machines, armes murales, bornes, stations de vélos, parkings et motos de la zone, et à
## 4,5 m au moins des voies du tram ; la machine regarde à l'opposé du mur.

const OUT := "res://data/perk_machines.json"
## atout -> zone (indice de objects.json) : une zone sans atout chacun, réparties sur la carte
const PLAN := [
	["deadshot", 3],          # Rue du Dôme
	["electriccherry", 7],    # Cathédrale (parvis)
	["widowswine", 10],       # Saint-Pierre-le-Jeune
	["vultureaid", 11],       # Grand'Rue
	["dyingwish", 12],        # Grand Séminaire
	["deathperception", 14],  # Musée historique
	["stronghold", 15],       # Place Broglie
	["bandolier", 18],        # Monument Stoeber
	["tombstone", 20],        # Saint-Thomas
]

func run(tr: Node) -> void:
	var w := World.load_world()
	var game: Node = Game
	game.mode = GameMode.CLASSIC
	game.new_game(1, "strasbourg", [], w)
	var o: Dictionary = w.objects
	var keep: Array = []   # tout ce qui occupe déjà le sol
	for m: Dictionary in o["machines"]:
		if not m.get("proc", false):
			keep.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for ww: Dictionary in o["wallWeapons"]:
		keep.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
	for s: Dictionary in o["stations"]:
		keep.append(Vector2(float(s["x"]), float(s["z"])))
	for b: Dictionary in o["bikeStations"]:
		keep.append(Vector2(float(b["x"]), float(b["z"])))
	for pk: Dictionary in o["parkings"]:
		for pt: Dictionary in pk.get("points", []):
			keep.append(Vector2(float(pt["x"]), float(pt["z"])))
	for v: Dictionary in o["vehicleSpawns"]:
		keep.append(Vector2(float(v["x"]), float(v["z"])))
	var tram: Array = []
	if game.rides != null:
		var tmp := {}
		for t: TramTrack in game.rides.net.get("tracks", []):
			var s := 0.0
			while s <= t.L:
				t.at(s, tmp)
				tram.append(Vector2(float(tmp["x"]), float(tmp["z"])))
				s += 2.0
	var out: Array = []
	for e: Array in PLAN:
		var id: String = e[0]
		var zi: int = e[1]
		var L := ZoneLayout.build(w, zi)
		var spot := {}
		for gap in [6.0, 4.5, 3.0]:
			spot = L.wall_spot(w.nav, L.centroid, keep, gap, 4, tram, 4.5)
			if not spot.is_empty():
				break
		if spot.is_empty():
			push_error("place-perks : aucun emplacement pour %s en zone %d" % [id, zi])
			continue
		var q := Vector2(float(spot["x"]), float(spot["z"]))
		keep.append(q)
		out.append({"type": "perk", "id": id, "zone": zi, "pos": {"x": snappedf(q.x, 0.001), "y": 0.0, "z": snappedf(q.y, 0.001)}, "yaw": snappedf(float(spot["yaw"]), 0.0001), "proc": true})
		print("place-perks : %s -> %s (%.1f ; %.1f), cap %.0f°, %.0f m du milieu" % [id, w.zone_names[zi], q.x, q.y, rad_to_deg(float(spot["yaw"])), q.distance_to(L.centroid)])
	var f := FileAccess.open(OUT, FileAccess.WRITE)
	f.store_string(JSON.stringify({"note": "v0.27.0 : distributeurs des nouveaux atouts, écrit par tools/place-perks.gd", "machines": out}, "\t") + "\n")
	f.close()
	print("place-perks : %d distributeurs écrits dans %s" % [out.size(), OUT])
	tr.check(out.size() == PLAN.size(), "place-perks : %d / %d distributeurs placés" % [out.size(), PLAN.size()])
