class_name Arena
extends RefCounted
## Arène de test 60 x 60 m (port de src/world.js buildWorld). Le plan (obstacles, point de départ) est extrait de world.js par
## tools/export-golden-j1.mjs dans data/arena.json ; la demi-largeur vient de Config (arenaHalf). Code pur : les collisions
## passent par Collision (cercle contre segments), pas par la physique de Godot.

const PATH := "res://data/arena.json"
const WALL_H := 5.0         ## world.js : wallH
const STATION_SIZE := Vector3(1.2, 1.8, 3.0)   ## borne d'achat de munitions, contre le mur ouest
const LAMP_INSET := 6.0     ## lampadaires à (+-(half - 6), +-(half - 6))
const LAMP_HALF := 0.15
const LAMP_H := 5.0
const SPAWN_INSET := 3.0    ## points d'apparition au bord : half - 3

var half := 30.0
var obstacles: Array = []        ## [x, z, w, d, h]
var start_pos := Vector3(0, 0, 6)
var station_pos := Vector3.ZERO
var lamps: Array[Vector3] = []
var spawn_points: Array[Vector3] = []
var collision: Collision

static func load_arena() -> Arena:
	var a := Arena.new()
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Arena : %s illisible" % PATH)
		return a
	a.half = float(Config.at("arenaHalf", parsed["half"]))
	a.obstacles = parsed["obstacles"]
	var sp: Array = parsed["startPos"]
	a.start_pos = Vector3(sp[0], sp[1], sp[2])
	a._build()
	return a

func _build() -> void:
	collision = Collision.new(half, half, 4.0)
	# murs d'enceinte (faces intérieures) : les balles s'y arrêtent ; resolve() borne déjà les corps à la zone
	collision.add_segment(-half, -half, half, -half, WALL_H)
	collision.add_segment(half, -half, half, half, WALL_H)
	collision.add_segment(half, half, -half, half, WALL_H)
	collision.add_segment(-half, half, -half, -half, WALL_H)
	for o in obstacles:
		collision.add_box(o[0], o[1], o[2], o[3], 0.0, o[4])
	station_pos = Vector3(-half + 0.6, 0, 0)
	collision.add_box(station_pos.x, 0.0, STATION_SIZE.x, STATION_SIZE.z, 0.0, STATION_SIZE.y)
	for s in [[1, 1], [1, -1], [-1, 1], [-1, -1]]:
		var p := Vector3(s[0] * (half - LAMP_INSET), 0, s[1] * (half - LAMP_INSET))
		lamps.append(p)
		collision.add_box(p.x, p.z, LAMP_HALF * 2.0, LAMP_HALF * 2.0, 0.0, LAMP_H)
	collision.build()
	var e := half - SPAWN_INSET
	for v in [-e, 0.0, e]:
		spawn_points.append(Vector3(v, 0, -e))
		spawn_points.append(Vector3(v, 0, e))
	spawn_points.append(Vector3(-e, 0, 0))
	spawn_points.append(Vector3(e, 0, 0))
