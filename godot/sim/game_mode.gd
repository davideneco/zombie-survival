class_name GameMode
extends RefCounted
## v0.26.0 : modes de jeu (menu « Mode de jeu »). Code pur, sans nœud.
##   CLASSIQUE   la partie d'origine : toute la Grande Île, portes payantes, finale. Rien ne change (golden et tests inchangés).
##   ZONE UNIQUE le joueur choisit UNE des 27 zones ; la partie s'y joue enfermée : toutes les portes sont murées (World.sealed), les zombies
##               apparaissent aux fenêtres et au sol de la zone hors du champ de vision, les machines de la zone restent (l'horloge de la
##               finale non : pas de finale dans ce mode), un petit jeu de base est ajouté si la zone n'en a pas (boîte mystère, Mastodonte et
##               Réanimation rapide si la zone n'a aucun atout, MP5 au mur si elle n'a aucune arme murale : l'Intérieur de la Cathédrale) et une
##               PORTE DE SORTIE au milieu de la zone coûte
##               `exitPrice` points : l'acheter termine la partie en victoire (« ÉVASION RÉUSSIE »).
##   v0.33.0 : CONTRE LA MONTRE (sim/timed_mode.gd) et ARSENAL ALÉATOIRE (sim/arsenal_mode.gd) : toute la Grande Île comme le Classique,
##   sans finale (without_finale), avec leurs règles propres (Game.timed, Game.arsenal ; `gm` reste nul : il ne sert qu'à la Zone unique).
## Une entrée de LIST avec `ready` faux serait grisée dans le menu (« BIENTÔT »).

const CLASSIC := "classic"
const ZONE := "zone"
const TIMED := "timed"
const ARSENAL := "arsenal"
const LIST := [
	{"id": "classic", "name": "CLASSIQUE", "ready": true, "desc": "Toute la Grande Île : portes payantes, véhicules, tram, cathédrale et fin de partie."},
	{"id": "zone", "name": "ZONE UNIQUE", "ready": true, "desc": "Enfermé dans une seule zone, portes murées. Achetez la porte de sortie pour vous évader."},
	{"id": "timed", "name": "CONTRE LA MONTRE", "ready": true, "desc": "4 min au chrono, chaque zombie tué rend du temps : le plus de points avant 0:00."},
	{"id": "arsenal", "name": "ARSENAL ALÉATOIRE", "ready": true, "desc": "Une arme tirée au hasard à chaque manche. Aucune arme à acheter : murs et boîte fermés."},
]
## Équilibrage du mode Zone unique (Config.at("zoneMode.*"), section propre au port ajoutée par autoload/config.gd).
## exitPrice : voir docs/GODOT_PORT.md (v0.26.0) : ~ce que rapportent les manches 1 à 11 moins un équipement modeste (deux atouts, une arme).
const CONFIG := {
	"exitPrice": 20000,
	"spawnMin": 9.0,        ## distance minimale d'apparition (m)
	"spawnMax": 70.0,
	"viewDist": 40.0,       ## au-delà, un point d'apparition ne compte pas comme « vu »
	"viewDot": 0.35,        ## cosinus du demi-angle du champ de vision (~70°)
	"machineGap": 6.0,      ## distance minimale entre une machine ajoutée et les autres machines / armes murales
	"exitGap": 8.0,         ## distance minimale entre la porte de sortie et les machines ajoutées
	"startOffset": 5.0,     ## le joueur commence à ~5 m de la porte de sortie, face à elle
	"exitSize": [3.2, 2.4], ## emprise de la porte de sortie (largeur x profondeur, m) : collision
	"baseSet": ["box", "perk:juggernog", "perk:quickrevive", "wall:mp5"],
}

var id := CLASSIC
var zone := -1
var zone_name := ""
var layout: ZoneLayout
var start := Vector3.ZERO
var start_yaw := 0.0
var exit: Dictionary = {}       ## machine « exit » : { type, name, price, zone, pos, yaw }
var extra: Array = []           ## machines ajoutées (base) : mêmes champs que objects.json + "added": true
var added_walls: Array = []     ## armes murales ajoutées (aussi dans world.objects["wallWeapons"])

static func valid(mode: String) -> String:
	for m: Dictionary in LIST:
		if m["id"] == mode and bool(m["ready"]):
			return mode
	return CLASSIC

static func name_of(mode: String) -> String:
	for m: Dictionary in LIST:
		if m["id"] == mode:
			return String(m["name"])
	return "CLASSIQUE"

## v0.33.0 : les modes qui se jouent sur toute la carte avec des règles en plus (pas de choix de zone, pas de finale).
static func full_map_variant(mode: String) -> bool:
	return mode == TIMED or mode == ARSENAL

## v0.33.0 : machines de la carte sans l'horloge astronomique (pas de finale en Contre la montre ni en Arsenal aléatoire).
static func without_finale(objs: Array) -> Array:
	var out: Array = []
	for m: Dictionary in objs:
		if String(m["type"]) != "clock":
			out.append(m)
	return out

static func exit_price() -> int:
	return int(Config.at("zoneMode.exitPrice", CONFIG["exitPrice"]))

func _init(mode := CLASSIC, zi := -1) -> void:
	id = valid(mode)
	zone = zi

func is_zone() -> bool:
	return id == ZONE

## Enferme la partie dans la zone : portes murées, seule la zone est ouverte, départ, porte de sortie, machines de base. false si la zone est invalide.
func setup(w: World) -> bool:
	if not is_zone() or zone < 0 or zone >= w.zone_names.size():
		return false
	layout = ZoneLayout.build(w, zone)
	if layout == null:
		return false
	zone_name = w.zone_names[zone]
	w.sealed = true
	w.zone_open.fill(0)
	w.zone_open[zone] = 1
	var nav := w.nav
	var others: Array = []   # machines et armes murales de la zone : la porte de sortie se tient à 4,5 m au moins
	for m: Dictionary in w.objects["machines"]:
		if int(m.get("zone", -1)) == zone:
			others.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		if int(ww.get("zone", -1)) == zone:
			others.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
	var c := layout.nearest(nav, layout.centroid, 3, others, 4.5)
	if c == Vector2.INF:
		c = layout.center
	layout.center = c
	exit = {"type": "exit", "id": "exit", "name": "PORTE DE SORTIE", "price": exit_price(), "zone": zone, "color": "#3ddc6a", "letter": "S",
		"pos": {"x": c.x, "y": 0.0, "z": c.y}, "yaw": 0.0}
	# départ : à startOffset m de la porte, face à elle (case libre la plus proche d'un point sur le cercle, côté centroïde)
	var off := float(CONFIG["startOffset"])
	var dir := (layout.centroid - c)
	dir = dir.normalized() if dir.length() > 0.5 else Vector2(0, 1)
	var sp := layout.nearest(nav, c + dir * off, 1, [c], off - 1.0)
	if sp == Vector2.INF:
		sp = layout.nearest(nav, c + dir * off, 0, [c], 2.0)
	if sp == Vector2.INF:
		sp = c + Vector2(0, 1.5)
	start = Vector3(sp.x, 0.0, sp.y)
	var to_exit := c - sp
	start_yaw = atan2(-to_exit.x, -to_exit.y)   # PlayerSim : l'avant est (-sin yaw, -cos yaw)
	exit["yaw"] = atan2(sp.x - c.x, sp.y - c.y)  # la façade de la porte (+Z local) regarde le joueur au départ
	_add_base(w)
	# pas d'apparition au sol dans l'emprise de la porte de sortie ni des machines ajoutées
	var busy: Array = [c]
	for m: Dictionary in extra + added_walls:
		busy.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	var g2 := PackedVector2Array()
	for q in layout.ground:
		if ZoneLayout._far_from(q, busy, 2.6):
			g2.append(q)
	layout.ground = g2
	return true

## Machines de la zone (objects.json) gardées dans ce mode (pas l'horloge de la finale), plus les machines ajoutées et la porte de sortie.
func filter_machines(objs: Array) -> Array:
	var out: Array = []
	for m: Dictionary in objs:
		if int(m.get("zone", -1)) == zone and String(m["type"]) != "clock":
			out.append(m)
	out.append_array(extra)
	out.append(exit)
	return out

func _has(w: World, type: String) -> bool:
	for m: Dictionary in w.objects["machines"]:
		if int(m.get("zone", -1)) == zone and String(m["type"]) == type:
			return true
	for m: Dictionary in extra:
		if String(m["type"]) == type:
			return true
	return false

## Jeu de base pour une zone sans boîte ni atout (CONFIG.baseSet) : placé contre un mur, loin de la porte de sortie et des autres machines.
func _add_base(w: World) -> void:
	extra.clear()
	added_walls.clear()
	var nav := w.nav
	var c := layout.center
	var taken: Array = []
	for m: Dictionary in w.objects["machines"]:
		if int(m.get("zone", -1)) == zone:
			taken.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		if int(ww.get("zone", -1)) == zone:
			taken.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
	var had_perk := _has(w, "perk")
	var had_wall := false
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		had_wall = had_wall or int(ww.get("zone", -1)) == zone
	for item: String in CONFIG["baseSet"]:
		var type := item.get_slice(":", 0)
		if type == "box" and _has(w, "box"):
			continue
		if type == "perk" and had_perk:
			continue
		if type == "wall" and had_wall:
			continue
		var spot := {}
		# contre un mur, le plus près du milieu, loin de la sortie et du départ (exitGap) et des autres machines (machineGap) ;
		# les petites zones relâchent ces distances
		var keep: Array = [c, Vector2(start.x, start.z)]
		for pass_ in [[float(CONFIG["machineGap"]), float(CONFIG["exitGap"])], [4.0, 6.0], [3.0, 4.5]]:
			spot = layout.wall_spot(nav, c, taken, float(pass_[0]), 4, keep, float(pass_[1]))
			if not spot.is_empty():
				break
		if spot.is_empty():
			var q := layout.nearest(nav, c, 1, taken + [c, Vector2(start.x, start.z)], 3.0)
			if q == Vector2.INF:
				continue
			spot = {"x": q.x, "z": q.y, "yaw": 0.0}
		var m := {"zone": zone, "pos": {"x": spot["x"], "y": 0.0, "z": spot["z"]}, "yaw": spot["yaw"], "added": true}
		taken.append(Vector2(float(spot["x"]), float(spot["z"])))
		if type == "wall":   # arme murale : ajoutée aux armes murales de la carte (WeaponShop la trouve), dessinée par zone_mode_view.gd
			var wid := item.get_slice(":", 1)
			var W: Dictionary = Config.weapon(wid)
			m.merge({"id": wid, "name": W["name"], "price": int(W["price"]), "ammoPrice": int(W["ammoPrice"])})
			w.objects["wallWeapons"].append(m)
			added_walls.append(m)
			continue
		if type == "box":
			m.merge({"type": "box", "id": null, "name": "BOÎTE MYSTÈRE", "price": int(Config.at("box.price")), "color": "#5fb8ff", "letter": null})
		else:
			var pid := item.get_slice(":", 1)
			var P: Dictionary = Config.at("perks.%s" % pid)
			m.merge({"type": "perk", "id": pid, "name": P["name"], "price": int(P["price"]), "color": P["color"], "letter": P["letter"]})
		extra.append(m)

## Boîtes de collision des machines ajoutées et de la porte de sortie (Collision.set_dynamic).
func collision_boxes() -> Array:
	var out: Array = []
	var es: Array = CONFIG["exitSize"]
	out.append({"key": "zone_exit", "box": {"x": exit["pos"]["x"], "z": exit["pos"]["z"], "w": float(es[0]), "d": float(es[1]), "rot": -float(exit["yaw"]), "h": 3.4}})
	for i in added_walls.size():
		var aw: Dictionary = added_walls[i]
		out.append({"key": "zone_wall%d" % i, "box": {"x": aw["pos"]["x"], "z": aw["pos"]["z"], "w": 1.8, "d": 0.4, "rot": -float(aw["yaw"]), "h": 2.4}})
	for i in extra.size():
		var m: Dictionary = extra[i]
		var w := 1.7 if String(m["type"]) == "box" else 1.2
		var d := 0.85 if String(m["type"]) == "box" else 0.9
		out.append({"key": "zone_machine%d" % i, "box": {"x": m["pos"]["x"], "z": m["pos"]["z"], "w": w, "d": d, "rot": -float(m["yaw"]), "h": 2.4}})
	return out

# ------------------------------------------------------------------ apparitions
## Où apparaît le prochain zombie (remplace Game._pick_spawn en Zone unique) : une fenêtre de la zone ou un point au sol de la zone, à
## [spawnMin, spawnMax] m du joueur et HORS de son champ de vision (derrière lui, ou caché par un mur). Repli : le point le plus lointain.
func pick_spawn(g: Node) -> Dictionary:
	var w: World = g.world
	var p: PlayerSim = g.player
	var rng: RandomNumberGenerator = g.rng
	var lo := float(Config.at("zoneMode.spawnMin", CONFIG["spawnMin"]))
	var hi := float(Config.at("zoneMode.spawnMax", CONFIG["spawnMax"]))
	if rng.randf() < Rules.WINDOW_CHANCE and not layout.windows.is_empty():
		var ok := PackedInt32Array()
		for wi in layout.windows:
			if w.window_busy[wi] > g.time:
				continue
			var o := w.window_outside(wi)
			var d := Vector2(o.x - p.pos.x, o.z - p.pos.z).length()
			if d >= lo and d <= hi and not seen(g, w.window_center(wi)):
				ok.append(wi)
		if not ok.is_empty():
			var wi := ok[rng.randi() % ok.size()]
			w.window_busy[wi] = g.time + Rules.WINDOW_BUSY
			return {"type": "window", "index": wi}
	var n := layout.ground.size()
	if n > 0:
		for _t in 48:
			var q := layout.ground[rng.randi() % n]
			var d := Vector2(q.x - p.pos.x, q.y - p.pos.z).length()
			if d >= lo and d <= hi and not seen(g, Vector3(q.x, 1.0, q.y)):
				return {"type": "ground", "pos": Vector3(q.x, 0.0, q.y)}
	# repli (zone minuscule, joueur au milieu) : le point au sol le plus éloigné du joueur
	var far := Vector2.INF
	var fd := -1.0
	for q in layout.ground:
		var d := Vector2(q.x - p.pos.x, q.y - p.pos.z).length()
		if d > fd:
			fd = d
			far = q
	if far != Vector2.INF:
		return {"type": "ground", "pos": Vector3(far.x, 0.0, far.y)}
	return {"type": "ground", "pos": Vector3(layout.center.x, 0.0, layout.center.y)}

## Le point est-il vu par le joueur : à moins de viewDist m, dans le cône de vision et sans mur entre les deux ?
func seen(g: Node, at: Vector3) -> bool:
	var p: PlayerSim = g.player
	var eye := p.pos + Vector3(0, 1.6, 0)
	var to := at - eye
	var flat := Vector2(to.x, to.z)
	var d := flat.length()
	if d > float(Config.at("zoneMode.viewDist", CONFIG["viewDist"])):
		return false
	if d < 0.5:
		return true
	var fwd := Vector2(-sin(p.yaw), -cos(p.yaw))
	if flat.normalized().dot(fwd) < float(Config.at("zoneMode.viewDot", CONFIG["viewDot"])):
		return false
	var len := to.length()
	var hit: float = g.collision.ray_hit(eye.x, eye.y, eye.z, to.x / len, to.y / len, to.z / len, len)
	return hit >= len - 0.3
