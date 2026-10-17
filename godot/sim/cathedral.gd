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
