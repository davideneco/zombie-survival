class_name Cathedral
extends RefCounted
## Repère de la cathédrale et de sa flèche (src/cathedral.js : P(s, t), src/cath/spire.js : TOWER, src/angel.js : spireRadius). Les valeurs du repère
## (origine et axes de la nef dans la carte) viennent de data/cathedral.json, écrit par tools/export-golden-j10.mjs depuis le monde du JS :
## `P(s, t)` = origine + u x s + v x t (u : de la façade ouest vers le chœur, v : vers le transept).

const PATH := "res://data/cathedral.json"
const TOWER_C := Vector2(-39.5, -14.0)   ## axe de la flèche dans le repère de la nef (TOWER.c)
const TOWER_R := 9.6
const TOWER_TOP := 104.0                 ## terrasse (TOWER.top)
const TOWER_TIP := 128.0                 ## pointe, balcon du Fanal (TOWER.tip)
const TOWER_NEEDLE := 142.0
const FANAL_AZIMUTH := 235.0             ## summit.js : le Fanal est sur le balcon, adossé à l'aiguille, à 2,05 m de l'axe
const FANAL_RADIUS := 2.05

## v0.24.2 : peau de la façade ouest (scenes/world/cathedral_view.gd). Les cotes vivent ici pour que la collision (sim pure) et le dessin partagent la même source.
const FACADE_WALL_S := -48.0
const FACADE_SKIN := 2.6                 ## m en avant du plan du mur
const FACADE_HALF_W := 26.5
const FACADE_PIER_OUT := 5.0             ## m en avant du plan du mur : face avant des contreforts
## contreforts : [axe t, largeur à la base]
const FACADE_PIERS := [[-26.0, 3.7], [-20.8, 3.2], [-8.4, 3.8], [8.4, 3.8], [20.8, 3.2], [26.0, 3.7]]
const FACADE_CENTRAL_HW := 3.9           ## demi-largeur du grand portail à la face (la porte du jeu reste libre)

static var _loaded := false
static var _o := Vector2.ZERO
static var _u := Vector2(1, 0)
static var _v := Vector2(0, 1)
static var _clock := Vector2.ZERO

static func _load() -> void:
	if _loaded:
		return
	_loaded = true
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		push_error("Cathedral : %s illisible" % PATH)
		return
	var d: Dictionary = JSON.parse_string(f.get_as_text())
	_o = Vector2(d["o"][0], d["o"][1])
	_u = Vector2(d["u"][0], d["u"][1])
	_v = Vector2(d["v"][0], d["v"][1])
	_clock = Vector2(d["clock"][0], d["clock"][1])

## Point de la carte (x, z) pour l'abscisse s (le long de la nef) et t (en travers).
static func P(s: float, t: float) -> Vector2:
	_load()
	return _o + _u * s + _v * t

static func clock_pos() -> Vector2:
	_load()
	return _clock

## Point à `r` m de l'axe de la flèche, à l'azimut `deg` (degrés, dans le repère de la nef) : finale.js towerPt.
static func tower_pt(r: float, deg: float) -> Vector2:
	return P(TOWER_C.x + cos(deg_to_rad(deg)) * r, TOWER_C.y + sin(deg_to_rad(deg)) * r)

## Axe de la flèche dans la carte.
static func tower_axis() -> Vector2:
	return P(TOWER_C.x, TOWER_C.y)

## Le Fanal d'Erwin (x, z), à TOWER_TIP de hauteur.
static func fanal_pos() -> Vector2:
	return P(TOWER_C.x + cos(deg_to_rad(FANAL_AZIMUTH)) * FANAL_RADIUS, TOWER_C.y + sin(deg_to_rad(FANAL_AZIMUTH)) * FANAL_RADIUS)

## Rayon de la flèche à la hauteur y : pagode (6,35 m à 104 m -> 1,9 m à 128 m), puis aiguille (jusqu'à 141 m) : angel.js spireRadius.
static func spire_radius(y: float) -> float:
	if y < TOWER_TOP:
		return 9.6
	if y <= TOWER_TIP:
		return 6.35 + (1.9 - 6.35) * ((y - TOWER_TOP) / (TOWER_TIP - TOWER_TOP))
	if y < 141.0:
		return 1.7 * ((141.0 - y) / 12.0)
	return 0.0

## Segments de collision de la peau de façade [ax, az, bx, bz] (x, z de la carte) : face avant (les portails latéraux sont bouchés, le grand portail reste ouvert),
## jambages du grand portail et contreforts. Générés, pas stockés : voir World._load.
static func facade_segments() -> Array:
	var segs: Array = []
	var sf := FACADE_WALL_S - FACADE_SKIN
	var so := FACADE_WALL_S - FACADE_PIER_OUT
	var line := func(s0: float, t0: float, s1: float, t1: float) -> void:
		var a := P(s0, t0)
		var b := P(s1, t1)
		segs.append([a.x, a.y, b.x, b.y])
	line.call(sf, -FACADE_HALF_W, sf, -FACADE_CENTRAL_HW)
	line.call(sf, FACADE_CENTRAL_HW, sf, FACADE_HALF_W)
	line.call(sf, -FACADE_HALF_W, FACADE_WALL_S, -FACADE_HALF_W)
	line.call(sf, FACADE_HALF_W, FACADE_WALL_S, FACADE_HALF_W)
	for sd in [-1.0, 1.0]:
		line.call(sf, sd * FACADE_CENTRAL_HW, FACADE_WALL_S, sd * FACADE_CENTRAL_HW)
	for pr: Array in FACADE_PIERS:
		var t0: float = float(pr[0]) - float(pr[1]) * 0.5
		var t1: float = float(pr[0]) + float(pr[1]) * 0.5
		line.call(sf, t0, so, t0)
		line.call(so, t0, so, t1)
		line.call(so, t1, sf, t1)
	return segs
