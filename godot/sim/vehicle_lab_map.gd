class_name VehicleLabMap
extends RefCounted
## v0.37.0 : carte de test des véhicules (map "vehicules", --map=vehicules) : plan écrit en code (VehicleLab : hangar, anneau, ligne droite, mur de
## crash, rampes, bosses, colline, boue, glace, plots, voie du tram), construit par AlpineMap.build comme la Station des Aiguilles (collision,
## navigation, une seule zone, sans porte, fenêtre, machine ni arme). Les machines sont celles du jeu (VehicleSim, CarSim, TramSim) avec leurs
## données (data/world/vehicles.json, CarSim.DEF) : rien n'est dupliqué. Code pur.

const TITLE := "BANC D'ESSAI DES VÉHICULES"
const TRAM_START_S := 40.0

static func plan() -> Dictionary:
	var L := VehicleLab
	var walls: Array = []
	var hx0 := L.HANGAR.position.x
	var hz0 := L.HANGAR.position.y
	var hx1 := L.HANGAR.end.x
	var hz1 := L.HANGAR.end.y
	var south: Array = L.HANGAR_DOORS[0]
	var north: Array = L.HANGAR_DOORS[1]
	for s: Array in [[hx0, hz1, south[0], hz1], [south[1], hz1, hx1, hz1], [hx0, hz0, north[0], hz0], [north[1], hz0, hx1, hz0], [hx0, hz0, hx0, hz1], [hx1, hz0, hx1, hz1]]:
		walls.append({"a": [s[0], s[1]], "b": [s[2], s[3]], "t": 0.4, "h": L.HANGAR_H})
	var C: Dictionary = L.CRASH
	walls.append({"a": [C["x"], float(C["z"]) - float(C["len"]) / 2.0], "b": [C["x"], float(C["z"]) + float(C["len"]) / 2.0], "t": C["t"], "h": C["h"]})
	for e: Array in L.relief_walls():
		walls.append({"a": [e[0], e[1]], "b": [e[2], e[3]], "t": 0.2, "h": e[4]})
	var circles: Array = []
	for p: Vector2 in lamp_posts():
		circles.append({"x": p.x, "z": p.y, "r": 0.18, "h": 6.0})
	var vehicles: Array = []
	for pk: Dictionary in L.PARK:
		if pk["type"] != "voiture":
			vehicles.append({"type": pk["type"], "x": pk["x"], "z": L.PARK_Z, "yaw": PI, "model": pk.get("model", "")})
	return {"title": TITLE, "half": L.HALF, "edge": L.EDGE, "walls": walls, "solids": [], "props": [], "circles": circles, "cars": [], "machines": [],
		"stations": [], "doors": [], "wallWeapons": [], "windows": [], "vehicles": vehicles, "zones": [{"name": "Banc d'essai", "seed": [L.START.x, L.START.z]}],
		"start": [L.START.x, L.START.z], "startZone": 0}

## Lampadaires (pourtour de l'anneau, ligne droite, voie du tram).
static func lamp_posts() -> Array:
	var out: Array = []
	var R: Dictionary = VehicleLab.RING
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			out.append(Vector2(sx * (float(R["hx"]) - float(R["r"]) * 0.3), sz * (float(R["hz"]) + 9.0)))
	for x in [-90.0, 0.0, 90.0]:
		out.append(Vector2(x, float(VehicleLab.DRAG["z"]) - 8.0))
		out.append(Vector2(x, float(VehicleLab.RAIL["z"]) + 6.0))
	return out

static func load_map() -> World:
	var w := AlpineMap.build(plan(), "vehicules")
	w.terrain = VehicleLab.new()
	return w

## Données de Rides (format de data/world/vehicles.json) : les machines du hangar, les voitures (CarSim) et une rame sur la voie d'essai.
static func rides_data() -> Dictionary:
	var base := Rides.load_data()
	var D := plan()
	var vehicles: Array = []
	for i in (D["vehicles"] as Array).size():
		var v: Dictionary = D["vehicles"][i]
		vehicles.append({"id": i, "type": v["type"], "x": v["x"], "z": v["z"], "yaw": v["yaw"], "variant": 0, "station": -1, "model": v["model"]})
	var cars: Array = []
	for pk: Dictionary in VehicleLab.PARK:
		if pk["type"] == "voiture":
			cars.append({"x": pk["x"], "z": VehicleLab.PARK_Z, "yaw": PI, "paint": pk["paint"]})
	var td: Dictionary = (base["tram"] as Dictionary).duplicate()
	td["lines"] = [{"id": "ESSAI", "name": "Voie d'essai", "pts": [[VehicleLab.RAIL["x0"], VehicleLab.RAIL["z"]], [VehicleLab.RAIL["x1"], VehicleLab.RAIL["z"]]]}]
	td["startS"] = TRAM_START_S
	td["gates"] = []
	td["routeGates"] = {}
	td["decor"] = []
	td["signals"] = []
	td["substation"] = null
	return {"vehicles": vehicles, "cars": cars, "models": base["models"], "parkingsFull": [], "bikeStations": [], "tram": td}

## La motoneige : nom, vue et places propres (comme AlpineMap.dress_vehicles) ; le tram est alimenté (pas de sous-station).
static func dress(r: Rides) -> void:
	var D := plan()
	for v: VehicleSim in r.vehicles:
		if v is CarSim or v.id >= (D["vehicles"] as Array).size():
			continue
		if String(D["vehicles"][v.id]["model"]) == "motoneige":
			v.def = v.def.duplicate(true)
			v.def["name"] = "MOTONEIGE"
			v.def["det"] = "la"
			v.def["model"] = "motoneige"
			v.model_seats.clear()
			for st: Dictionary in AlpineMap.SNOWMOBILE_SEATS:
				v.model_seats.append({"hip": st["hip"], "eye": st["eye"], "ry": float(st["ry"])})
			v.wheel_radius = 0.36
	r.set_power(true, true)
