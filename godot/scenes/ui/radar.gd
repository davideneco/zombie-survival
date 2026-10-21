extends Control
## Radar tactique (HUD.drawRadar du JS) : disque de 120 px orienté selon la vue ; stations d'achat vertes, portes fermées rouges, armes murales
## orange, zombies rouges, joueur au centre. Les calculs sont dans HudCalc.radar_point ; ici on ne fait que dessiner.

const SIZE := HudCalc.RADAR_SIZE
const POI_STATION := Color("33ff77")
const POI_DOOR := Color("ff5533")
const POI_WALL := Color("ffaa33")
const POI_EXIT := Color("3ddc6a")      ## v0.26.0 : porte de sortie (Zone unique)
const POI_SEALED := Color("8a8580")    ## v0.26.0 : porte murée

var pois: Array = []             ## [Vector2 (x, z), Color]
var _doors_version := -1
var _world: World
var player_color := Color("66ff99")

func _ready() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

## Points d'intérêt de la carte (main.js : pois du radar). Les portes ouvertes disparaissent : refait quand une porte change.
func rebuild_pois() -> void:
	pois.clear()
	var w: World = Game.world
	_world = w
	if w == null:
		if Game.arena != null:
			pois.append([Vector2(Game.arena.station_pos.x, Game.arena.station_pos.z), POI_STATION])
		return
	for s: Dictionary in w.objects.get("stations", []):
		pois.append([Vector2(float(s["x"]), float(s["z"])), POI_STATION])
	for d: Dictionary in w.doors:
		if not d["open"]:
			for pt: Array in d["points"]:
				pois.append([Vector2(float(pt[0]), float(pt[1])), POI_SEALED if w.sealed else POI_DOOR])
	if Game.gm != null and not Game.gm.exit.is_empty():
		pois.append([Vector2(float(Game.gm.exit["pos"]["x"]), float(Game.gm.exit["pos"]["z"])), POI_EXIT])
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		pois.append([Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])), POI_WALL])

func _open_doors() -> int:
	var n := 0
	if Game.world != null:
		for d: Dictionary in Game.world.doors:
			if d["open"]:
				n += 1
	return n

func _process(_dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(_dt)
	PerfLog.add(&"radar", _pt)

func _tick(_dt: float) -> void:
	if Game.player == null:
		return
	var open_n := _open_doors()
	if open_n != _doors_version or _world != Game.world:
		_doors_version = open_n
		rebuild_pois()
	queue_redraw()

func _draw() -> void:
	var c := Vector2(SIZE, SIZE) / 2.0
	var r := SIZE / 2.0 - 3.0
	draw_circle(c, SIZE / 2.0, Color(5 / 255.0, 12 / 255.0, 18 / 255.0, 0.7))
	var ring := Color(0.27, 0.51, 0.35, 0.35)
	draw_arc(c, r * 0.5, 0, TAU, 40, ring, 1.0, true)
	draw_arc(c, r * 0.95, 0, TAU, 56, ring, 1.0, true)
	draw_line(Vector2(c.x, c.y - r), Vector2(c.x, c.y + r), ring, 1.0)
	draw_line(Vector2(c.x - r, c.y), Vector2(c.x + r, c.y), ring, 1.0)
	if Game.player != null:
		var p: PlayerSim = Game.player
		for poi: Array in pois:
			var q := HudCalc.radar_point(p.pos.x, p.pos.z, p.yaw, (poi[0] as Vector2).x, (poi[0] as Vector2).y)
			if q.x != INF:
				draw_circle(q, 3.5, poi[1])
		for z: ZombieSim in Game.zombies:
			if z.dead or z.spawn_t > 0.5:
				continue
			var q := HudCalc.radar_point(p.pos.x, p.pos.z, p.yaw, z.pos.x, z.pos.z)
			if q.x != INF:
				draw_circle(q, 2.5, Color("ff2a2a"))
	draw_colored_polygon(PackedVector2Array([Vector2(c.x, c.y - 5), Vector2(c.x - 3.5, c.y + 4), Vector2(c.x + 3.5, c.y + 4)]), player_color)
	draw_arc(c, SIZE / 2.0 - 1.0, 0, TAU, 64, Color(1, 1, 1, 0.25), 2.0, true)
