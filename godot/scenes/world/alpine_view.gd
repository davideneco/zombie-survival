extends Node3D
## v0.34.0 : rendu de la Station des Aiguilles (station de ski alpine abandonnée en hiver). Tout est construit par code au chargement depuis le plan
## data/alpine.json (AlpineMap.layout()) et l'état de Game.world (fenêtres, portes) : aucune géométrie cuite. Maillages GeoBuilder (normales plates)
## regroupés par matériau, matériau shaders/alpine.gdshader (textures PBR du port, neige sur les faces tournées vers le haut), glace
## (shaders/ice.gdshader), sapins et forêt en MultiMesh, voitures garées de cars_view.gd sous la neige, relief et sommets autour du plateau,
## neige qui tombe (particules arrêtées par les toits : champ de hauteur qui suit la caméra), tempête périodique (brouillard, vent : Sfx.set_wind),
## lampadaires et fenêtres éclairés la nuit (groupe « sky_listener »). Aucune règle ici.

signal progress(frac: float)

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const CarsView := preload("res://scenes/world/cars_view.gd")
static var SHADER: Shader:
	get: return load("res://shaders/alpine.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
static var ICE: Shader:
	get: return load("res://shaders/ice.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
const PBR := "res://assets/pbr/%s/%s.png"
const LAMP_LIGHTS := 8
const LAMP_RANGE := 22.0
const LAMP_ENERGY := 3.2
const STORM_PERIOD := 300.0      ## s : une tempête toutes les 5 minutes de jeu (et pendant la Nuit blanche)
const FAR := 480.0               ## m : bord du relief dessiné

## Matériaux : texture PBR (ou ""), teinte, répétitions par mètre, neige ; options : snow_lo, patch, metal, rough, emit.
const MATS := {
	"snow": ["ground_snow", Color(0.86, 0.88, 0.92), 0.25, 1.0],
	"rock": ["rock_cliff", Color(0.5, 0.5, 0.53), 0.1, 1.0, {"snow_lo": 0.55}],
	"stone": ["wall_fieldstone", Color(0.78, 0.76, 0.73), 0.45, 1.0],
	"stone_in": ["wall_fieldstone", Color(0.7, 0.68, 0.65), 0.45, 0.0],
	"wood": ["wood_door", Color(0.66, 0.44, 0.26), 0.45, 1.0],
	"wood_in": ["wood_door", Color(0.6, 0.42, 0.27), 0.5, 0.0],
	"wood_dark": ["wood_beam", Color(0.36, 0.25, 0.17), 0.5, 1.0],
	"logs": ["wood_beam", Color(0.52, 0.37, 0.24), 0.55, 1.0],
	"plaster": ["wall_plaster", Color(0.93, 0.89, 0.8), 0.35, 1.0],
	"plaster_in": ["wall_plaster", Color(0.86, 0.8, 0.7), 0.35, 0.0],
	"church": ["wall_stucco", Color(0.95, 0.94, 0.9), 0.35, 1.0],
	"concrete": ["wall_plaster", Color(0.62, 0.62, 0.63), 0.3, 1.0],
	"concrete_in": ["wall_plaster", Color(0.55, 0.55, 0.56), 0.3, 0.0],
	"slate": ["roof_slate", Color(0.42, 0.44, 0.48), 0.5, 1.0],
	"roof_under": ["wood_beam", Color(0.4, 0.29, 0.2), 0.5, 0.0],
	"paving": ["ground_paving", Color(0.62, 0.62, 0.63), 0.4, 0.95, {"patch": 1.0}],
	"asphalt": ["rock_cliff", Color(0.34, 0.34, 0.36), 0.25, 1.0, {"patch": 0.6}],
	"floor_wood": ["wood_door", Color(0.55, 0.38, 0.24), 0.6, 0.0],
	"floor_stone": ["ground_paving", Color(0.55, 0.52, 0.5), 0.5, 0.0],
	"fir": ["", Color(0.08, 0.19, 0.11), 1.0, 1.0, {"snow_lo": 0.2}],
	"bark": ["wood_beam", Color(0.3, 0.22, 0.16), 1.0, 0.6],
	"metal": ["", Color(0.2, 0.21, 0.23), 1.0, 0.6, {"metal": 0.7, "rough": 0.45}],
	"metal_in": ["", Color(0.2, 0.21, 0.23), 1.0, 0.0, {"metal": 0.7, "rough": 0.45}],
	"red": ["", Color(0.62, 0.1, 0.07), 1.0, 0.8, {"rough": 0.5}],
	"orange": ["", Color(0.85, 0.36, 0.06), 1.0, 0.8, {"rough": 0.5}],
	"shutter": ["wood_beam", Color(0.25, 0.38, 0.26), 0.6, 0.6],
	"shutter_red": ["wood_beam", Color(0.55, 0.16, 0.12), 0.6, 0.6],
	"fabric": ["", Color(0.45, 0.08, 0.08), 1.0, 0.0, {"rough": 0.95}],
	"gold": ["", Color(0.75, 0.58, 0.22), 1.0, 0.0, {"metal": 0.8, "rough": 0.35}],
	"glass_dark": ["", Color(0.05, 0.07, 0.09), 1.0, 0.0, {"rough": 0.08, "metal": 0.3}],
	"glass_lit": ["", Color(0.06, 0.05, 0.04), 1.0, 0.0, {"rough": 0.1, "emit": Color(1.0, 0.68, 0.34)}],
	"stained": ["", Color(0.08, 0.05, 0.1), 1.0, 0.0, {"rough": 0.1, "emit": Color(0.55, 0.3, 0.9), "always": true}],
	"glass_in": ["", Color(0.05, 0.06, 0.07), 1.0, 0.0, {"rough": 0.1, "emit": Color(0.72, 0.8, 0.9)}],
	"bulb": ["", Color(0.2, 0.18, 0.12), 1.0, 0.0, {"emit": Color(1.0, 0.8, 0.5)}],
	"fire": ["", Color(0.1, 0.03, 0.0), 1.0, 0.0, {"emit": Color(1.0, 0.45, 0.12)}],
	"xmas": ["", Color(0.1, 0.05, 0.05), 1.0, 0.0, {"emit": Color(1.0, 0.25, 0.2)}],
	"xmas2": ["", Color(0.05, 0.05, 0.1), 1.0, 0.0, {"emit": Color(0.35, 0.6, 1.0)}],
	"purple": ["", Color(0.2, 0.06, 0.3), 1.0, 0.0, {"emit": Color(0.7, 0.3, 1.0), "emit_k": 1.4, "always": true}],
}
## Matériaux dont l'émission suit la nuit (multipliée par DayNight.lamps) ; "always" : allumés de jour aussi.
const EMIT_BASE := {"glass_in": 1.6, "glass_lit": 2.4, "stained": 1.6, "bulb": 5.0, "fire": 4.0, "xmas": 3.0, "xmas2": 3.0, "purple": 2.2}

var _L: Dictionary
var _g: Dictionary = {}           ## clé de matériau -> GeoBuilder
var _mats: Dictionary = {}        ## clé -> ShaderMaterial
var _door_nodes: Dictionary = {}  ## id de porte -> Node3D (barricade)
var _lamp_pos: Array[Vector3] = []
var _lamp_lights: Array[OmniLight3D] = []
var _lamp_t := 0.0
var _lit := 1.0
var _noise := FastNoiseLite.new()
var _snow: GPUParticles3D
var _snow_mat: ParticleProcessMaterial
var _snow_col: GPUParticlesCollisionHeightField3D
var _fires: Array[OmniLight3D] = []
var _gv: Node
var storm := 0.0
var _storm_arg := -1.0            ## --storm=K : tempête imposée (captures)
var triangle_count := 0
var built := false
var _slice_t := 0

func _slice() -> void:
	if Time.get_ticks_usec() - _slice_t > 10000:
		await get_tree().process_frame
		_slice_t = Time.get_ticks_usec()

# ------------------------------------------------------------------ matériaux
func _tex(name: String, kind: String) -> Texture2D:
	var p := PBR % [name, kind]
	return load(p) as Texture2D if ResourceLoader.exists(p) else null

func mat(key: String) -> ShaderMaterial:
	if _mats.has(key):
		return _mats[key]
	var d: Array = MATS[key]
	var opt: Dictionary = d[4] if d.size() > 4 else {}
	var m := ShaderMaterial.new()
	m.shader = SHADER
	var a := _tex(String(d[0]), "a") if String(d[0]) != "" else null
	m.set_shader_parameter("use_tex", 1.0 if a != null else 0.0)
	if a != null:
		m.set_shader_parameter("albedo_tex", a)
		m.set_shader_parameter("mat_tex", _tex(String(d[0]), "m"))
	var sa := _tex("ground_snow", "a")
	m.set_shader_parameter("use_snow_tex", 1.0 if sa != null else 0.0)
	if sa != null:
		m.set_shader_parameter("snow_tex", sa)
		m.set_shader_parameter("snow_mat", _tex("ground_snow", "m"))
	m.set_shader_parameter("tint", d[1])
	m.set_shader_parameter("scale", float(d[2]))
	m.set_shader_parameter("snow", float(d[3]))
	m.set_shader_parameter("snow_lo", float(opt.get("snow_lo", 0.45)))
	m.set_shader_parameter("snow_patch", float(opt.get("patch", 0.0)))
	m.set_shader_parameter("metal", float(opt.get("metal", 0.0)))
	m.set_shader_parameter("rough_mul", float(opt.get("rough", 1.0)) / (0.75 if a == null else 1.0))
	if opt.has("emit"):
		m.set_shader_parameter("emit_color", opt["emit"])
	_mats[key] = m
	return m

func g(key: String) -> GeoBuilder:
	if not _g.has(key):
		_g[key] = GeoBuilder.new()
	return _g[key]

## Pavé orienté : centre c, taille s (x le long de `yaw` = rotation.y).
func obox(key: String, c: Vector3, s: Vector3, yaw := 0.0, faces := 63) -> void:
	if yaw == 0.0:
		g(key).box(c, s, faces)
		return
	var b := GeoBuilder.new()
	b.box(Vector3.ZERO, s, faces)
	g(key).append_xf(b, Transform3D(Basis(Vector3.UP, yaw), c))

## Pavé le long d'un segment du plan (a -> b), épaisseur t, de y0 à y1.
func wall_box(key: String, a: Vector2, b: Vector2, t: float, y0: float, y1: float) -> void:
	var d := b - a
	var m := (a + b) / 2.0
	obox(key, Vector3(m.x, (y0 + y1) / 2.0, m.y), Vector3(d.length(), y1 - y0, t), -atan2(d.y, d.x))

## Pièces construites dans un repère local (x : le long de la façade, y : haut, z : vers l'extérieur) : transformée de ce repère.
static func face_xf(c: Vector3, n: Vector3) -> Transform3D:
	var tg := Vector3.UP.cross(n).normalized()
	return Transform3D(Basis(tg, Vector3.UP, n), c)

func local_box(key: String, xf: Transform3D, c: Vector3, s: Vector3) -> void:
	var b := GeoBuilder.new()
	b.box(c, s)
	g(key).append_xf(b, xf)

# ------------------------------------------------------------------ construction
func build() -> void:
	var t0 := Time.get_ticks_msec()
	_slice_t = Time.get_ticks_usec()
	_L = AlpineMap.layout()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--storm="):
			_storm_arg = clampf(float(arg.substr(8)), 0.0, 1.0)
	_noise.seed = 3407
	_noise.frequency = 0.006
	_noise.fractal_octaves = 4
	_gv = get_tree().get_first_node_in_group("graphics_view")
	_ground()
	progress.emit(0.1)
	await _slice()
	_terrain()
	progress.emit(0.3)
	await _slice()
	_walls()
	_solids()
	progress.emit(0.45)
	await _slice()
	_buildings()
	_props()
	progress.emit(0.6)
	await _slice()
	_windows()
	_doors()
	_machines_extra()
	_lift()
	_lamps()
	progress.emit(0.7)
	await _slice()
	_trees()
	_cars()
	progress.emit(0.85)
	await _slice()
	for key: String in _g:
		var gb: GeoBuilder = _g[key]
		if gb.verts.is_empty():
			continue
		var mi := MeshInstance3D.new()
		mi.name = "alpin_%s" % key
		mi.mesh = gb.build()
		mi.material_override = mat(key)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(mi)
		triangle_count += gb.triangle_count()
	_g.clear()
	_snowfall()
	add_to_group("sky_listener")
	on_sky_k(Game.daynight.sky_k if Game.daynight != null else 0.0)
	Game.door_opened.connect(_on_door_opened)
	for d: Dictionary in Game.world.doors:
		if d["open"]:
			_on_door_opened(int(d["id"]))
	built = true
	progress.emit(1.0)
	print("STATION DES AIGUILLES : vue construite en %d ms, %d triangles (hors sapins et voitures)" % [Time.get_ticks_msec() - t0, triangle_count])

# ------------------------------------------------------------------ sol, relief, falaises
func height_at(x: float, z: float) -> float:
	var e := 150.0
	var d := maxf(absf(x), absf(z)) - e
	if d <= 0.0:
		return 0.0
	var north := clampf(-z / 420.0, 0.0, 1.0)
	var piste := smoothstep(25.0, 70.0, absf(x - 3.0)) if z < 0.0 and absf(z) > absf(x) else 1.0   # la piste sous le télésiège est plus lisse
	var base := 4.6 + d * 0.22 + d * d * 0.0009 * (1.0 + 1.6 * north)
	return base + _noise.get_noise_2d(x, z) * (3.0 * smoothstep(0.0, 24.0, d) + d * 0.35) * (0.35 + 0.65 * piste)

func _ground() -> void:
	var e := 150.0
	g("snow").quad(Vector3(-e, 0, -e), Vector3(e, 0, -e), Vector3(e, 0, e), Vector3(-e, 0, e), Vector3.UP)
	for dc: Dictionary in _L["decor"]:
		match String(dc["k"]):
			"plaza":
				_disk("paving", Vector2(dc["x"], dc["z"]), float(dc["r"]), float(dc["r"]), 0.012, 40)
			"lot":
				g("asphalt").quad(Vector3(dc["x0"], 0.012, dc["z0"]), Vector3(dc["x1"], 0.012, dc["z0"]), Vector3(dc["x1"], 0.012, dc["z1"]), Vector3(dc["x0"], 0.012, dc["z1"]), Vector3.UP)
			"road":
				var pts: Array = dc["pts"]
				for i in pts.size() - 1:
					var a := Vector2(pts[i][0], pts[i][1])
					var b := Vector2(pts[i + 1][0], pts[i + 1][1])
					var n := (b - a).normalized().orthogonal() * float(dc["w"]) / 2.0
					var y := 0.014 + i * 0.001
					g("asphalt").quad(Vector3(a.x + n.x, y, a.y + n.y), Vector3(b.x + n.x, y, b.y + n.y), Vector3(b.x - n.x, y, b.y - n.y), Vector3(a.x - n.x, y, a.y - n.y), Vector3.UP)
			"lake":
				_ice_disk(Vector2(dc["x"], dc["z"]), float(dc["rx"]), float(dc["rz"]))
			"pool":
				var x0: float = float(dc["x"]) - float(dc["w"]) / 2.0
				var x1: float = float(dc["x"]) + float(dc["w"]) / 2.0
				var z0: float = float(dc["z"]) - float(dc["d"]) / 2.0
				var z1: float = float(dc["z"]) + float(dc["d"]) / 2.0
				_ice_rect(x0, z0, x1, z1)
				for r: Array in [[x0 - 0.3, z0 - 0.3, x1 + 0.3, z0], [x0 - 0.3, z1, x1 + 0.3, z1 + 0.3], [x0 - 0.3, z0, x0, z1], [x1, z0, x1 + 0.3, z1]]:
					g("stone").box(Vector3((r[0] + r[2]) / 2.0, 0.12, (r[1] + r[3]) / 2.0), Vector3(r[2] - r[0], 0.24, r[3] - r[1]))
			"pier":
				g("wood").box(Vector3(dc["x"], 0.2, dc["z"]), Vector3(dc["w"], 0.1, dc["d"]))
			"cemetery":
				for k in 7:   # croix de fer forgé alignées au bord du cimetière (décor, au-dessus du sol)
					var x: float = lerpf(float(dc["x0"]), float(dc["x1"]), (k + 0.5) / 7.0)
					g("metal").box(Vector3(x, 0.5, float(dc["z1"]) + 1.2), Vector3(0.06, 1.0, 0.06))
					g("metal").box(Vector3(x, 0.72, float(dc["z1"]) + 1.2), Vector3(0.4, 0.06, 0.06))

func _disk(key: String, c: Vector2, rx: float, rz: float, y: float, n: int) -> void:
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		g(key).tri(Vector3(c.x, y, c.y), Vector3(c.x + cos(a0) * rx, y, c.y + sin(a0) * rz), Vector3(c.x + cos(a1) * rx, y, c.y + sin(a1) * rz), Vector3.UP)

func _ice_material() -> ShaderMaterial:
	if _mats.has("ice"):
		return _mats["ice"]
	var m := ShaderMaterial.new()
	m.shader = ICE
	var sa := _tex("ground_snow", "a")
	if sa != null:
		m.set_shader_parameter("snow_tex", sa)
	_mats["ice"] = m
	return m

func _ice_disk(c: Vector2, rx: float, rz: float) -> void:
	var b := GeoBuilder.new()
	var n := 64
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var w0 := 1.0 + 0.08 * sin(a0 * 5.0) + 0.05 * sin(a0 * 9.0 + 1.0)
		var w1 := 1.0 + 0.08 * sin(a1 * 5.0) + 0.05 * sin(a1 * 9.0 + 1.0)
		b.tri(Vector3(c.x, 0.012, c.y), Vector3(c.x + cos(a0) * rx * w0, 0.012, c.y + sin(a0) * rz * w0), Vector3(c.x + cos(a1) * rx * w1, 0.012, c.y + sin(a1) * rz * w1), Vector3.UP)
	_add_mesh(b, _ice_material(), false)

func _ice_rect(x0: float, z0: float, x1: float, z1: float) -> void:
	var b := GeoBuilder.new()
	b.quad(Vector3(x0, 0.02, z0), Vector3(x1, 0.02, z0), Vector3(x1, 0.02, z1), Vector3(x0, 0.02, z1), Vector3.UP)
	_add_mesh(b, _ice_material(), false)

func _add_mesh(b: GeoBuilder, m: Material, shadows := true, nm := "") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = b.build()
	mi.material_override = m
	if nm != "":
		mi.name = nm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	triangle_count += b.triangle_count()
	return mi

func _terrain() -> void:
	var b := GeoBuilder.new()
	var step := 8.0
	var e := 150.0
	var n := int(FAR / step)
	for iz in range(-n, n):
		for ix in range(-n, n):
			var x0 := ix * step
			var z0 := iz * step
			var x1 := x0 + step
			var z1 := z0 + step
			if x0 >= -e and x1 <= e and z0 >= -e and z1 <= e:
				continue
			var p00 := Vector3(x0, height_at(x0, z0), z0)
			var p10 := Vector3(x1, height_at(x1, z0), z0)
			var p11 := Vector3(x1, height_at(x1, z1), z1)
			var p01 := Vector3(x0, height_at(x0, z1), z1)
			b.ao = 0.85 + 0.15 * clampf(_noise.get_noise_2d(x0 * 3.0, z0 * 3.0) + 0.5, 0.0, 1.0)
			b.tri(p00, p10, p11, Vector3.UP)
			b.tri(p00, p11, p01, Vector3.UP)
	# sommets lointains (silhouettes dans la brume)
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	for i in 16:
		var a := TAU * i / 16.0 + rng.randf_range(-0.12, 0.12)
		var r := rng.randf_range(560.0, 820.0)
		var c := Vector2(cos(a), sin(a)) * r
		var hgt := rng.randf_range(150.0, 250.0) * (1.25 if c.y < 0.0 else 0.9)   # sous ~20 degrés : la brume du ciel les fond à l'horizon
		var r0 := rng.randf_range(260.0, 380.0)
		b.ao = 1.0
		b.prism(c.x, c.y, r0, r0 * 0.42, 30.0, hgt * 0.55, 7, rng.randf() * TAU, false)
		b.spire(c.x, c.y, r0 * 0.42, hgt * 0.55, hgt, 7, rng.randf() * TAU)
	var mi := _add_mesh(b, mat("rock"), true, "relief")
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# falaises du pourtour (face intérieure sur la collision à +-148 m)
	var edge := float(_L["edge"])
	for s in [-1.0, 1.0]:
		g("rock").box(Vector3(s * (edge + 1.5), 2.3, 0), Vector3(3.0, 4.8, 2.0 * edge + 6.0), 1 | 2 | 4)
		g("rock").box(Vector3(0, 2.3, s * (edge + 1.5)), Vector3(2.0 * edge + 6.0, 4.8, 3.0), 4 | 16 | 32)
	for k in 90:   # blocs éboulés au sommet des falaises
		var side := k % 4
		var u := rng.randf_range(-edge, edge)
		var off := edge + rng.randf_range(0.4, 2.6)
		var p := Vector2(u, -off) if side == 0 else (Vector2(u, off) if side == 1 else (Vector2(-off, u) if side == 2 else Vector2(off, u)))
		var rr := rng.randf_range(0.8, 2.2)
		g("rock").prism(p.x, p.y, rr, rr * 0.5, 4.4, 4.4 + rr * 1.2, 6, rng.randf() * TAU)

# ------------------------------------------------------------------ murs de zones et bâtiments
const WALL_MAT := {"palisade": "logs", "stone": "stone", "hotel": "plaster", "church": "church", "station": "concrete", "log": "logs", "shed": "wood"}
const WALL_IN := {"hotel": "plaster_in", "church": "plaster_in", "station": "concrete_in", "log": "wood_in", "shed": "wood_in"}

func _walls() -> void:
	for wl: Dictionary in _L["walls"]:
		var k := String(wl["k"])
		if not (k in ["palisade", "stone"]):
			continue   # murs des bâtiments visitables : _buildings
		var a := Vector2(wl["a"][0], wl["a"][1])
		var b := Vector2(wl["b"][0], wl["b"][1])
		var h := float(wl["h"])
		var t := float(wl["t"])
		wall_box(WALL_MAT[k], a, b, t, 0.0, h)
		if k == "palisade":   # rondins pointus et poteaux tous les 2,5 m
			var n := int(a.distance_to(b) / 2.5)
			for i in n + 1:
				var p := a.lerp(b, float(i) / maxf(1.0, n))
				g("logs").prism(p.x, p.y, 0.26, 0.24, 0.0, h + 0.35, 6)
				g("logs").spire(p.x, p.y, 0.24, h + 0.35, h + 0.7, 6)
		else:   # couvertine de pierre
			wall_box("stone", a, b, t + 0.16, h, h + 0.12)

func _solids() -> void:
	var rng := RandomNumberGenerator.new()
	for i in (_L["solids"] as Array).size():
		var so: Dictionary = _L["solids"][i]
		rng.seed = 900 + i
		var x := float(so["x"])
		var z := float(so["z"])
		var w := float(so["w"])
		var d := float(so["d"])
		var h := float(so["h"])
		var eave := float(so["eave"])
		var k := String(so["k"])
		if k == "tower":
			g("stone").box(Vector3(x, 0.6, z), Vector3(w + 0.1, 1.2, d + 0.1))
			g("church").box(Vector3(x, (1.2 + eave) / 2.0, z), Vector3(w, eave - 1.2, d))
			for nn: Vector3 in [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]:   # abat-sons du clocher
				var xf := face_xf(Vector3(x, 0, z) + nn * (w / 2.0), nn)
				local_box("wood_dark", xf, Vector3(0, eave - 3.4, 0.03), Vector3(1.6, 3.0, 0.08))
				local_box("church", xf, Vector3(0, eave - 3.4 + 1.7, 0.02), Vector3(2.0, 0.4, 0.1))
			g("stone").box(Vector3(x, eave + 0.2, z), Vector3(w + 0.5, 0.4, d + 0.5))
			g("slate").spire(x, z, w * 0.6, eave + 0.4, h + 12.0, 8, PI / 8.0)
			g("gold").box(Vector3(x, h + 13.0, z), Vector3(0.12, 2.0, 0.12))
			g("gold").box(Vector3(x, h + 13.4, z), Vector3(1.0, 0.12, 0.12))
			continue
		var wall_key := "plaster" if k in ["cafe", "shop"] else "wood"
		var base_h := 1.0 if k != "shop" else 0.6
		g("stone").box(Vector3(x, base_h / 2.0, z), Vector3(w, base_h, d))
		g(wall_key).box(Vector3(x, (base_h + eave) / 2.0, z), Vector3(w, eave - base_h, d), 1 | 2 | 16 | 32)
		var along_x := bool(so["rx"])
		_roof(Rect2(x - w / 2.0, z - d / 2.0, w, d), eave, h, along_x, 0.9, wall_key)
		# cheminée
		var cx := x + rng.randf_range(-w * 0.25, w * 0.25)
		var cz := z + rng.randf_range(-d * 0.15, d * 0.15)
		g("stone").box(Vector3(cx, h - 0.5, cz), Vector3(0.8, 2.6, 0.8))
		g("stone").box(Vector3(cx, h + 0.85, cz), Vector3(1.0, 0.15, 1.0))
		# balcon sur une longue façade, à l'étage
		if eave > 5.0 and k == "chalet":
			var sgn := 1.0 if rng.randf() < 0.5 else -1.0
			var bx := Vector3(x, 3.1, z + sgn * (d / 2.0 + 0.55)) if along_x else Vector3(x + sgn * (w / 2.0 + 0.55), 3.1, z)
			var bs := Vector3(w * 0.7, 0.16, 1.1) if along_x else Vector3(1.1, 0.16, d * 0.7)
			g("wood_dark").box(bx, bs)
			var rail_c := bx + (Vector3(0, 0.55, sgn * 0.5) if along_x else Vector3(sgn * 0.5, 0.55, 0))
			g("wood_dark").box(rail_c, Vector3(bs.x, 0.1, 0.08) if along_x else Vector3(0.08, 0.1, bs.z))
			var nb := int((bs.x if along_x else bs.z) / 0.25)
			for j in nb:
				var f := (j + 0.5) / nb - 0.5
				var pp := rail_c + (Vector3(f * bs.x, -0.25, 0) if along_x else Vector3(0, -0.25, f * bs.z))
				g("wood").box(pp, Vector3(0.12, 0.5, 0.05) if along_x else Vector3(0.05, 0.5, 0.12))
		# fenêtres de l'étage (décor), parfois éclairées
		if eave > 4.6:
			for nn: Vector3 in [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]:
				var length := d if nn.x != 0.0 else w
				for f: float in [-0.27, 0.27]:
					var c: Vector3 = Vector3(x + nn.x * w / 2.0, eave - 1.3, z + nn.z * d / 2.0) + Vector3(nn.z, 0, nn.x).abs() * f * length
					_window(c, nn, 0.9, 1.0, rng.randf() < 0.4)
		# enseignes
		if k == "cafe" or k == "shop":
			var lbl := Label3D.new()
			lbl.text = "CAFÉ DU COL" if k == "cafe" else "LOCATION DE SKIS"
			lbl.font_size = 64
			lbl.pixel_size = 0.01
			lbl.modulate = Color(0.95, 0.85, 0.6)
			lbl.outline_size = 8
			var nn := Vector3(1, 0, 0) if k == "cafe" else Vector3(-1, 0, 0)
			lbl.position = Vector3(x + nn.x * (w / 2.0 + 0.05), eave - 0.4, z)
			lbl.rotation.y = atan2(nn.x, nn.z)
			add_child(lbl)

## Toit à deux pans au-dessus du rectangle r (plan x, z) : égout à `eave`, faîtage à `ridge`, débord ov ; pans couverts de neige (épaisseur 0,3 m),
## sous-face en bois, pignons fermés dans le matériau `gable`.
func _roof(r: Rect2, eave: float, ridge: float, along_x: bool, ov: float, gable: String) -> void:
	var P := func(u: float, y: float, v: float) -> Vector3:
		return Vector3(u, y, v) if along_x else Vector3(v, y, u)
	var u0 := (r.position.x if along_x else r.position.y) - ov
	var u1 := (r.end.x if along_x else r.end.y) + ov
	var v0 := r.position.y if along_x else r.position.x
	var v1 := r.end.y if along_x else r.end.x
	var vc := (v0 + v1) / 2.0
	var s := (v1 - v0) / 2.0
	var slope := (ridge - eave) / maxf(0.1, s)
	var ye := eave - ov * slope
	var th := 0.32
	var top := g("snow")
	var under := g("roof_under")
	var edge := g("slate")
	for side: float in [-1.0, 1.0]:
		var ve: float = vc + side * (s + ov)
		var hint_up: Vector3 = P.call(0.0, 1.0, side * 0.6)
		top.quad(P.call(u0, ye + th, ve), P.call(u1, ye + th, ve), P.call(u1, ridge + th, vc), P.call(u0, ridge + th, vc), hint_up)
		under.quad(P.call(u0, ye, ve), P.call(u1, ye, ve), P.call(u1, ridge, vc), P.call(u0, ridge, vc), -hint_up)
		edge.quad(P.call(u0, ye, ve), P.call(u1, ye, ve), P.call(u1, ye + th, ve), P.call(u0, ye + th, ve), P.call(0.0, 0.0, side))
		for ue: float in [u0, u1]:
			var hint: Vector3 = P.call(signf(ue - (u0 + u1) / 2.0), 0.0, 0.0)
			edge.quad(P.call(ue, ye, ve), P.call(ue, ridge, vc), P.call(ue, ridge + th, vc), P.call(ue, ye + th, ve), hint)
	for ue: float in [u0 + ov, u1 - ov]:   # pignons
		var hint: Vector3 = P.call(signf(ue - (u0 + u1) / 2.0), 0.0, 0.0)
		g(gable).tri(P.call(ue, eave, v0), P.call(ue, eave, v1), P.call(ue, ridge, vc), hint)

func _sides_of(b: Dictionary) -> Array:
	return [[Vector2(b["x0"], b["z0"]), Vector2(b["x1"], b["z0"]), Vector3(0, 0, -1)], [Vector2(b["x0"], b["z1"]), Vector2(b["x1"], b["z1"]), Vector3(0, 0, 1)],
		[Vector2(b["x0"], b["z0"]), Vector2(b["x0"], b["z1"]), Vector3(-1, 0, 0)], [Vector2(b["x1"], b["z0"]), Vector2(b["x1"], b["z1"]), Vector3(1, 0, 0)]]

func _buildings() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	for bd: Dictionary in _L["buildings"]:
		var k := String(bd["k"])
		var wk: String = WALL_MAT[k if k != "refuge" else "log"]
		var wk_in: String = WALL_IN[k if k != "refuge" else "log"]
		var t := float(bd["t"])
		var fl := float(bd["floor"])
		var top := float(bd["top"])
		var ridge := float(bd["ridge"])
		var gap_top := 5.0 if k == "station" else (3.0 if k != "church" else 3.6)
		var x0 := float(bd["x0"])
		var x1 := float(bd["x1"])
		var z0 := float(bd["z0"])
		var z1 := float(bd["z1"])
		var kind_wall := "log" if k == "refuge" else k
		# pans de mur du rez-de-chaussée (avec leurs ouvertures) : face extérieure et face intérieure de matériaux différents
		for wl: Dictionary in _L["walls"]:
			if String(wl["k"]) != kind_wall:
				continue
			var a := Vector2(wl["a"][0], wl["a"][1])
			var b := Vector2(wl["b"][0], wl["b"][1])
			if not (Rect2(x0 - 0.1, z0 - 0.1, x1 - x0 + 0.2, z1 - z0 + 0.2).has_point(a) and Rect2(x0 - 0.1, z0 - 0.1, x1 - x0 + 0.2, z1 - z0 + 0.2).has_point(b)):
				continue
			_two_tone_wall(a, b, t, 0.0, gap_top, wk, wk_in, Vector2((x0 + x1) / 2.0, (z0 + z1) / 2.0))
		# bandeau au-dessus des ouvertures, jusqu'au haut des murs
		for sd: Array in _sides_of(bd):
			var a2: Vector2 = sd[0]
			var b2: Vector2 = sd[1]
			var ext := (b2 - a2).normalized() * t / 2.0
			_two_tone_wall(a2 - ext, b2 + ext, t, gap_top, top, wk, wk_in, Vector2((x0 + x1) / 2.0, (z0 + z1) / 2.0))
		# sol et plafond intérieurs
		var fk := "floor_stone" if k in ["church", "station"] else "floor_wood"
		g(fk).quad(Vector3(x0, 0.02, z0), Vector3(x1, 0.02, z0), Vector3(x1, 0.02, z1), Vector3(x0, 0.02, z1), Vector3.UP)
		g("concrete_in" if k == "station" else "roof_under").quad(Vector3(x0, fl, z0), Vector3(x1, fl, z0), Vector3(x1, fl, z1), Vector3(x0, fl, z1), Vector3.DOWN)
		if fl < top:   # étages fermés (hôtel) : plancher de l'étage vu de dessous seulement ; dessus du volume à `top`
			g(wk).quad(Vector3(x0, top, z0), Vector3(x1, top, z0), Vector3(x1, top, z1), Vector3(x0, top, z1), Vector3.UP)
		var along_x := (x1 - x0) >= (z1 - z0)
		if k == "station":
			g("concrete").box(Vector3((x0 + x1) / 2.0, top + 0.25, (z0 + z1) / 2.0), Vector3(x1 - x0 + 1.2, 0.5, z1 - z0 + 1.2))
			g("snow").box(Vector3((x0 + x1) / 2.0, top + 0.6, (z0 + z1) / 2.0), Vector3(x1 - x0 + 1.0, 0.2, z1 - z0 + 1.0), 4 | 1 | 2 | 16 | 32)
			_sign(String(bd["name"]), Vector3((x0 + x1) / 2.0, gap_top + 0.9, z1 + t / 2.0 + 0.05), Vector3(0, 0, 1), 0.012)
		elif k == "shed":
			g("wood_dark").box(Vector3((x0 + x1) / 2.0, top + 0.2, (z0 + z1) / 2.0 + 0.4), Vector3(x1 - x0 + 0.8, 0.25, z1 - z0 + 1.6))
			g("snow").box(Vector3((x0 + x1) / 2.0, top + 0.45, (z0 + z1) / 2.0 + 0.4), Vector3(x1 - x0 + 0.7, 0.25, z1 - z0 + 1.5), 4 | 1 | 2 | 16 | 32)
		else:
			_roof(Rect2(x0 - t / 2.0, z0 - t / 2.0, x1 - x0 + t, z1 - z0 + t), top, ridge, along_x, 1.0 if k != "church" else 0.6, wk)
		if k == "hotel":   # étages : fenêtres éclairées, balcons, enseigne
			for sd: Array in _sides_of(bd):
				var a3: Vector2 = sd[0]
				var b3: Vector2 = sd[1]
				var nn: Vector3 = sd[2]
				var n_win := int(a3.distance_to(b3) / 3.6)
				for lv: float in [5.4, 8.8]:
					for j in n_win:
						var p := a3.lerp(b3, (j + 0.5) / n_win)
						var c := Vector3(p.x, lv, p.y) + nn * t / 2.0
						_window(c, nn, 1.1, 1.5, rng.randf() < 0.35)
						if lv < 6.0 and j % 2 == 0:
							local_box("wood_dark", face_xf(c, nn), Vector3(0, -1.0, 0.5), Vector3(1.8, 0.14, 1.0))
			_sign(String(bd["name"]), Vector3(x0 - t / 2.0 - 0.06, 3.7, -14.0), Vector3(-1, 0, 0), 0.014)
		elif k == "church":   # vitraux éclairés de l'intérieur, croix du faîtage
			for sd: Array in _sides_of(bd):
				var nn2: Vector3 = sd[2]
				if nn2.z == 0.0:
					continue
				var a4: Vector2 = sd[0]
				var b4: Vector2 = sd[1]
				for j in 4:
					var p2 := a4.lerp(b4, (j + 0.5) / 4.0)
					for side: float in [1.0, -1.0]:
						var c2: Vector3 = Vector3(p2.x, 5.6, p2.y) + nn2 * side * (t / 2.0)
						var xf2 := face_xf(c2, nn2 * side)
						local_box("stained", xf2, Vector3(0, 0, 0.02), Vector3(1.1, 2.6, 0.04))
						local_box("stone", xf2, Vector3(0, 1.4, 0.05), Vector3(1.4, 0.2, 0.12))
			g("gold").box(Vector3(x0 - 0.3, ridge + 1.0, (z0 + z1) / 2.0), Vector3(0.14, 2.0, 0.14))
			g("gold").box(Vector3(x0 - 0.3, ridge + 1.4, (z0 + z1) / 2.0), Vector3(0.14, 0.14, 1.0))
		elif k == "refuge":
			_sign(String(bd["name"]), Vector3((x0 + x1) / 2.0, 2.7, z0 - t / 2.0 - 0.05), Vector3(0, 0, -1), 0.009)

## Mur à deux faces : extérieure (vers le dehors du bâtiment de centre `inside`) en `ko`, intérieure en `ki`.
func _two_tone_wall(a: Vector2, b: Vector2, t: float, y0: float, y1: float, ko: String, ki: String, inside: Vector2) -> void:
	var d := b - a
	var len := d.length()
	if len < 0.01:
		return
	var tg := d / len
	var n := tg.orthogonal()
	if n.dot(inside - (a + b) / 2.0) > 0.0:
		n = -n   # n : vers l'extérieur
	var m := (a + b) / 2.0
	var t3 := Vector3(tg.x, 0, tg.y)
	var n3 := Vector3(n.x, 0, n.y)
	if t3.cross(Vector3.UP).dot(n3) < 0.0:   # repère direct (pas de symétrie : l'ordre des sommets reste juste)
		t3 = -t3
	var xf := Transform3D(Basis(t3, Vector3.UP, n3), Vector3(m.x, 0, m.y))
	var bo := GeoBuilder.new()
	bo.box(Vector3(0, (y0 + y1) / 2.0, 0), Vector3(len, y1 - y0, t), 1 | 2 | 4 | 8 | 16)
	g(ko).append_xf(bo, xf)
	var bi := GeoBuilder.new()
	bi.box(Vector3(0, (y0 + y1) / 2.0, 0), Vector3(len, y1 - y0, t), 32)
	g(ki).append_xf(bi, xf)

func _sign(text: String, pos: Vector3, n: Vector3, px: float) -> void:
	var lbl := Label3D.new()
	lbl.text = text
	lbl.font_size = 72
	lbl.pixel_size = px
	lbl.modulate = Color(1.0, 0.88, 0.62)
	lbl.outline_size = 10
	lbl.outline_modulate = Color(0.1, 0.06, 0.03)
	lbl.position = pos
	lbl.rotation.y = atan2(n.x, n.z)
	add_child(lbl)

# ------------------------------------------------------------------ fenêtres
## Fenêtre posée sur une façade : centre c (sur le plan de la façade), normale n vers l'extérieur ; cadre, vitre (éclairée ou non), volets, appui enneigé.
func _window(c: Vector3, n: Vector3, w: float, h: float, lit: bool, shutters := true, glass := "") -> void:
	var xf := face_xf(c, n)
	local_box(glass if glass != "" else ("glass_lit" if lit else "glass_dark"), xf, Vector3(0, 0, 0.02), Vector3(w - 0.08, h - 0.08, 0.04))
	local_box("wood_dark", xf, Vector3(0, h / 2.0, 0.05), Vector3(w + 0.1, 0.08, 0.1))
	local_box("wood_dark", xf, Vector3(-w / 2.0, 0, 0.05), Vector3(0.08, h, 0.1))
	local_box("wood_dark", xf, Vector3(w / 2.0, 0, 0.05), Vector3(0.08, h, 0.1))
	local_box("wood_dark", xf, Vector3(0, 0, 0.05), Vector3(0.05, h, 0.06))
	local_box("wood", xf, Vector3(0, -h / 2.0 - 0.04, 0.12), Vector3(w + 0.25, 0.08, 0.26))
	if shutters:
		var key := "shutter" if int(absf(c.x * 7.0 + c.z * 3.0)) % 2 == 0 else "shutter_red"
		local_box(key, xf, Vector3(-w * 0.78, 0, 0.04), Vector3(w * 0.5, h, 0.05))
		local_box(key, xf, Vector3(w * 0.78, 0, 0.04), Vector3(w * 0.5, h, 0.05))

## Mur de bâtiment visitable qui porte la fenêtre (centre sur son axe ou sur une de ses faces) : [épaisseur, point de l'axe], [] sinon.
func _on_building_wall(c: Vector2) -> Array:
	for wl: Dictionary in _L["walls"]:
		if String(wl["k"]) in ["palisade", "stone"]:
			continue
		var a := Vector2(wl["a"][0], wl["a"][1])
		var b := Vector2(wl["b"][0], wl["b"][1])
		var q := Geometry2D.get_closest_point_to_segment(c, a, b)
		if q.distance_to(c) < float(wl["t"]) / 2.0 + 0.02:
			return [float(wl["t"]), q]
	return []

func _windows() -> void:
	var w: World = Game.world
	for i in w.window_count():
		var c3 := w.window_center(i)
		var n2 := w.window_normal(i)
		var n := Vector3(n2.x, 0, n2.y)
		var c := Vector3(c3.x, 1.55, c3.z)
		var bw := _on_building_wall(Vector2(c.x, c.z))
		if not bw.is_empty():   # bâtiment visitable : les zombies entrent ; une fenêtre de chaque côté du mur
			var t: float = bw[0]
			c = Vector3(bw[1].x, c.y, bw[1].y)
			_window(c - n * t / 2.0, -n, 1.0, 1.2, false, true)
			_window(c + n * t / 2.0, n, 1.0, 1.2, false, false, "glass_in")
		else:
			_window(c, n, 1.0, 1.2, (i * 37) % 5 == 0)

# ------------------------------------------------------------------ portes payantes
func _doors() -> void:
	for d: Dictionary in Game.world.doors:
		var src: Dictionary = _L["doors"][int(d["id"])]
		var a := Vector2(src["a"][0], src["a"][1])
		var b := Vector2(src["b"][0], src["b"][1])
		var node := Node3D.new()
		node.name = "porte_%d" % int(d["id"])
		var tg := (b - a).normalized()
		var m := (a + b) / 2.0
		node.position = Vector3(m.x, 0, m.y)
		node.rotation.y = -atan2(tg.y, tg.x)
		add_child(node)
		var len := a.distance_to(b)
		var kind := String(src.get("k", "gate"))
		var bb := GeoBuilder.new()
		var key := "wood"
		match kind:
			"stone":   # grille de fer forgé entre deux piliers
				key = "metal"
				for j in 13:
					bb.box(Vector3(-len / 2.0 + (j + 0.5) * len / 13.0, 1.3, 0), Vector3(0.05, 2.6, 0.05))
				for y: float in [0.25, 1.4, 2.55]:
					bb.box(Vector3(0, y, 0), Vector3(len, 0.07, 0.07))
			"hotel":   # porte double barricadée
				key = "wood_dark"
				bb.box(Vector3(-len / 4.0, 1.4, 0), Vector3(len / 2.0 - 0.04, 2.8, 0.12))
				bb.box(Vector3(len / 4.0, 1.4, 0), Vector3(len / 2.0 - 0.04, 2.8, 0.12))
				for y: float in [0.7, 1.6, 2.4]:
					bb.box(Vector3(0, y, 0.12), Vector3(len + 0.3, 0.22, 0.06))
			_:   # barricade de planches
				for y: float in [0.45, 1.05, 1.65, 2.25]:
					bb.box(Vector3(0, y, 0), Vector3(len + 0.2, 0.3, 0.08))
				var diag := GeoBuilder.new()
				diag.box(Vector3.ZERO, Vector3(sqrt(len * len + 4.0), 0.22, 0.08))
				bb.append_xf(diag, Transform3D(Basis(Vector3.BACK, atan2(2.0, len)), Vector3(0, 1.35, 0.09)))
				bb.append_xf(diag, Transform3D(Basis(Vector3.BACK, -atan2(2.0, len)), Vector3(0, 1.35, -0.09)))
		var mi := MeshInstance3D.new()
		mi.mesh = bb.build()
		mi.material_override = mat(key)
		node.add_child(mi)
		for side: float in [1.0, -1.0]:
			var lbl := Label3D.new()
			lbl.text = "%s\n%d POINTS" % [String(d["name"]).to_upper(), int(d["price"])]
			lbl.font_size = 48
			lbl.pixel_size = 0.006
			lbl.modulate = Color(1.0, 0.82, 0.4)
			lbl.outline_size = 8
			lbl.position = Vector3(0, 1.95, side * 0.2)
			lbl.rotation.y = 0.0 if side > 0.0 else PI
			node.add_child(lbl)
		_door_nodes[int(d["id"])] = node

func _on_door_opened(id: int) -> void:
	if _door_nodes.has(id):
		(_door_nodes[id] as Node3D).visible = false

# ------------------------------------------------------------------ mobilier et décor des bâtiments
func _props() -> void:
	for p: Dictionary in _L["props"]:
		var c := Vector3(p["x"], 0, p["z"])
		var s := Vector3(p["w"], p["h"], p["d"])
		var yaw := -float(p["rot"])
		var k := String(p["k"])
		match k:
			"desk", "bar":
				obox("wood_in", c + Vector3(0, s.y / 2.0 - 0.04, 0), Vector3(s.x, s.y - 0.08, s.z), yaw)
				obox("wood_dark", c + Vector3(0, s.y - 0.03, 0), Vector3(s.x + 0.1, 0.06, s.z + 0.12), yaw)
				if k == "bar":
					for j in 6:
						obox("glass_lit", c + Vector3(-s.x / 2.0 + 0.5 + j * 1.0, s.y + 0.15, 0), Vector3(0.08, 0.3, 0.08), yaw)
			"fireplace":
				obox("stone_in", c + Vector3(0, s.y / 2.0, 0), s, yaw)
				var front := Vector3(0, 0, 1) if s.x > s.z else Vector3(1, 0, 0)   # foyer tourné vers la pièce (cheminées contre un mur nord ou ouest)
				obox("fire", c + front * (minf(s.x, s.z) / 2.0 + 0.01) + Vector3(0, 0.5, 0), Vector3(1.1, 0.7, 0.04) if s.x > s.z else Vector3(0.04, 0.7, 1.1), yaw)
				var l := OmniLight3D.new()
				l.light_color = Color(1.0, 0.55, 0.25)
				l.omni_range = 7.0
				l.light_energy = 1.6
				l.position = c + front * 1.2 + Vector3(0, 0.8, 0)
				add_child(l)
				_fires.append(l)
			"sofa":
				obox("fabric", c + Vector3(0, 0.25, 0), Vector3(s.x, 0.5, s.z), yaw)
				obox("fabric", c + Vector3(0, 0.6, -s.z / 2.0 + 0.12), Vector3(s.x, 0.6, 0.24), yaw)
			"pew", "table":
				obox("wood_in", c + Vector3(0, s.y * 0.5, 0), Vector3(s.x, 0.08, s.z), yaw)
				obox("wood_in", c + Vector3(0, s.y * 0.25, 0), Vector3(s.x * 0.15, s.y * 0.5, s.z * 0.9), yaw)
				if k == "pew":
					obox("wood_in", c + Vector3(-s.x / 2.0 + 0.05, s.y * 0.75, 0), Vector3(0.08, s.y * 0.5, s.z), yaw)
			"altar":
				obox("stone_in", c + Vector3(0, s.y / 2.0, 0), s, yaw)
				obox("gold", c + Vector3(0, s.y + 0.01, 0), Vector3(s.x + 0.05, 0.02, s.z * 0.8), yaw)
				obox("gold", c + Vector3(0, s.y + 0.45, 0), Vector3(0.06, 0.9, 0.06), yaw)
				obox("gold", c + Vector3(0, s.y + 0.65, 0), Vector3(0.06, 0.06, 0.5), yaw)
			"grave":
				obox("stone", c + Vector3(0, s.y / 2.0, 0), s, yaw)
				obox("stone", c + Vector3(0, s.y + 0.12, 0), Vector3(0.1, 0.3, 0.1), yaw)
			"lounger":
				obox("wood", c + Vector3(0, s.y - 0.05, 0), Vector3(s.x, 0.08, s.z), yaw)
				obox("wood", c + Vector3(0, s.y / 2.0, s.z / 2.0 - 0.1), Vector3(s.x, s.y, 0.1), yaw)
				obox("wood", c + Vector3(0, s.y / 2.0, -s.z / 2.0 + 0.1), Vector3(s.x, s.y, 0.1), yaw)
			"skis":
				var key: String = ["red", "orange", "metal"][int(absf(c.z * 3.0)) % 3]
				obox(key, c + Vector3(-0.12, s.y / 2.0, 0), Vector3(0.08, s.y, 0.1), yaw - 0.08)
				obox(key, c + Vector3(0.12, s.y / 2.0, 0), Vector3(0.08, s.y, 0.1), yaw + 0.08)
			"bullwheel":
				obox("concrete_in", c + Vector3(0, s.y / 2.0, 0), s, yaw)
				g("metal_in").prism(c.x, c.z, 0.5, 0.5, s.y, 4.3, 10)
				g("metal_in").prism(c.x, c.z, 1.75, 1.75, 4.3, 4.6, 24)
				g("red").prism(c.x, c.z, 1.2, 0.9, 4.6, 5.6, 12)
			"booth":
				obox("wood_in", c + Vector3(0, s.y / 2.0, 0), s, yaw)
				obox("glass_lit", c + Vector3(0, 1.5, s.z / 2.0 + 0.01), Vector3(s.x * 0.7, 0.8, 0.03), yaw)
				obox("wood_dark", c + Vector3(0, s.y + 0.1, 0), Vector3(s.x + 0.3, 0.2, s.z + 0.3), yaw)
			"snowcat":
				_snowcat(c, s, yaw)
			"shelter":   # paroi du fond (la collision), toit en auvent au-dessus des têtes
				obox("metal", c + Vector3(0, s.y - 0.08, 0.65), Vector3(s.x + 0.2, 0.16, 1.7), yaw)
				obox("glass_dark", c + Vector3(0, s.y / 2.0, 0), Vector3(s.x, s.y - 0.2, s.z), yaw)
				for sx: float in [-1.0, 1.0]:
					obox("metal", c + Vector3(sx * s.x / 2.0, s.y / 2.0, 0), Vector3(0.08, s.y, s.z + 0.02), yaw)
			_:
				obox("wood_in", c + Vector3(0, s.y / 2.0, 0), s, yaw)
	for c: Dictionary in _L["circles"]:
		var x := float(c["x"])
		var z := float(c["z"])
		var r := float(c["r"])
		var h := float(c["h"])
		match String(c["k"]):
			"fountain":
				g("stone").prism(x, z, r, r, 0.0, h * 0.7, 16)
				_disk("snow", Vector2(x, z), r * 0.9, r * 0.9, h * 0.7 + 0.01, 16)
				g("stone").prism(x, z, 0.3, 0.25, h * 0.7, 2.2, 8)
				g("stone").prism(x, z, 0.8, 0.7, 2.2, 2.4, 12)
			"pillar":
				g("plaster_in").prism(x, z, r, r, 0.0, h, 12)
			"pylon":
				_pylon(Vector3(x, 0, z), h)
			"rock":
				var rng := RandomNumberGenerator.new()
				rng.seed = int(absf(x * 13.0 + z * 7.0))
				var rot := rng.randf() * TAU
				g("rock").prism(x, z, r * 1.08, r * 1.0, -0.1, h * 0.8, 10, rot, false)
				g("rock").prism(x, z, r * 1.0, r * 0.45, h * 0.8, h + r * 0.3, 10, rot)
			"avalanche":
				for j in 5:
					var f := j / 5.0
					g("snow").prism(x, z, r * (1.0 - f * 0.85) + 1.5, r * (1.0 - (f + 0.2) * 0.85) + 1.2, h * f, h * (f + 0.2), 14, j * 0.4)
			"xmas_tree":
				pass   # dessiné avec les sapins (plus grand, guirlandes)

func _snowcat(c: Vector3, s: Vector3, yaw: float) -> void:
	var b := GeoBuilder.new()
	var w := s.x
	var l := s.z
	b.box(Vector3(0, 1.2, 0), Vector3(w * 0.9, 0.9, l * 0.82))
	b.box(Vector3(0, 0.75, l / 2.0 - 0.2), Vector3(w * 0.9, 1.1, 0.4))   # arrière (fraise à neige)
	var cab := GeoBuilder.new()
	cab.box(Vector3(0, 2.15, -0.3), Vector3(w * 0.75, 1.1, l * 0.38))
	var tracks := GeoBuilder.new()
	for sx: float in [-1.0, 1.0]:
		tracks.box(Vector3(sx * (w / 2.0 - 0.3), 0.45, 0.05), Vector3(0.6, 0.9, l - 0.1))
	var blade := GeoBuilder.new()
	blade.box(Vector3(0, 0.7, -l / 2.0 + 0.1), Vector3(w + 0.6, 1.1, 0.18))
	var xf := Transform3D(Basis(Vector3.UP, yaw), c)
	g("red").append_xf(b, xf)
	g("red").append_xf(cab, xf)
	g("metal").append_xf(tracks, xf)
	g("metal").append_xf(blade, xf)
	var glass := GeoBuilder.new()
	glass.box(Vector3(0, 2.25, -0.3), Vector3(w * 0.77, 0.6, l * 0.4))
	g("glass_dark").append_xf(glass, xf)

func _pylon(p: Vector3, h: float) -> void:
	g("metal").prism(p.x, p.z, 0.45, 0.3, p.y, p.y + h, 8)
	g("metal").box(Vector3(p.x, p.y + h, p.z), Vector3(4.2, 0.35, 0.5))
	for sx: float in [-1.6, 1.6]:
		g("metal").box(Vector3(p.x + sx, p.y + h - 0.35, p.z), Vector3(0.2, 0.5, 1.6))

# ------------------------------------------------------------------ télésiège (câble, sièges, pylônes sur la pente)
func _lift() -> void:
	var lift: Dictionary = {}
	for dc: Dictionary in _L["decor"]:
		if dc["k"] == "lift":
			lift = dc
	if lift.is_empty():
		return
	var x := float(lift["x"])
	var pts: Array[Vector3] = [Vector3(x, 4.45, float(lift["z0"]))]
	for c: Dictionary in _L["circles"]:
		if c["k"] == "pylon":
			pts.append(Vector3(x, float(c["h"]) - 0.35, float(c["z"])))
	var z := -165.0
	while z > float(lift["z1"]):
		var y := height_at(x, z)
		_pylon(Vector3(x, y - 0.5, z), 12.0)
		pts.append(Vector3(x, y + 11.15, z))
		z -= 38.0
	pts.sort_custom(func(a: Vector3, b: Vector3) -> bool: return a.z > b.z)
	var chair_i := 0
	for i in pts.size() - 1:
		for sx: float in [-1.6, 1.6]:
			var a := pts[i] + Vector3(sx, 0, 0)
			var b := pts[i + 1] + Vector3(sx, 0, 0)
			var d := b - a
			var mid := (a + b) / 2.0 - Vector3(0, 0.3, 0)
			var cb := GeoBuilder.new()
			cb.box(Vector3.ZERO, Vector3(0.05, 0.05, d.length()))
			g("metal").append_xf(cb, Transform3D(Basis.looking_at(d.normalized(), Vector3.UP), mid))
			var n_ch := int(d.length() / 14.0)
			for j in n_ch:
				chair_i += 1
				var q := a.lerp(b, (j + 0.5) / n_ch)
				if q.z > -112.0:
					continue
				var ch := q - Vector3(0, 2.4, 0)
				g("metal").box(q - Vector3(0, 1.2, 0), Vector3(0.05, 2.4, 0.05))
				g("red" if chair_i % 3 != 0 else "orange").box(ch, Vector3(1.6, 0.12, 0.6))
				g("red" if chair_i % 3 != 0 else "orange").box(ch + Vector3(0, 0.35, 0.28), Vector3(1.6, 0.6, 0.08))
				g("metal").box(ch + Vector3(0, 0.4, -0.35), Vector3(1.6, 0.05, 0.05))

# ------------------------------------------------------------------ machines dessinées ici (Pack-a-Punch, cloche)
func _machines_extra() -> void:
	for m: Dictionary in Game.world.objects["machines"]:
		var t := String(m["type"])
		if t != "pap" and t != "clock":
			continue
		var xf := Transform3D(Basis(Vector3.UP, float(m["yaw"])), Vector3(float(m["pos"]["x"]), 0, float(m["pos"]["z"])))
		var b := GeoBuilder.new()
		if t == "pap":
			b.box(Vector3(0, 0.45, 0), Vector3(1.55, 0.9, 1.2))
			b.box(Vector3(0, 1.45, -0.15), Vector3(1.35, 1.1, 0.85))
			b.box(Vector3(0, 2.1, -0.15), Vector3(1.55, 0.2, 1.0))
			g("metal_in").append_xf(b, xf)
			var gl := GeoBuilder.new()
			gl.box(Vector3(0, 0.95, 0.61), Vector3(1.2, 0.08, 0.04))
			gl.box(Vector3(0, 1.55, 0.29), Vector3(1.0, 0.5, 0.04))
			gl.box(Vector3(-0.72, 1.45, -0.15), Vector3(0.04, 0.9, 0.7))
			gl.box(Vector3(0.72, 1.45, -0.15), Vector3(0.04, 0.9, 0.7))
			g("purple").append_xf(gl, xf)
			var lbl := Label3D.new()
			lbl.text = "PACK-A-PUNCH"
			lbl.font_size = 48
			lbl.pixel_size = 0.005
			lbl.modulate = Color(0.85, 0.6, 1.0)
			lbl.transform = xf * Transform3D(Basis(), Vector3(0, 2.32, 0.36))
			add_child(lbl)
			var l := OmniLight3D.new()
			l.light_color = Color(0.7, 0.35, 1.0)
			l.omni_range = 5.0
			l.light_energy = 1.2
			l.transform = xf * Transform3D(Basis(), Vector3(0, 1.6, 1.0))
			add_child(l)
		else:   # cloche de Saint-Bernard sur son portique de bois
			for sx: float in [-0.45, 0.45]:
				b.box(Vector3(sx, 0.85, 0), Vector3(0.12, 1.7, 0.12))
			b.box(Vector3(0, 1.72, 0), Vector3(1.1, 0.14, 0.16))
			g("wood_in").append_xf(b, xf)
			var bell := GeoBuilder.new()
			bell.prism(0, 0, 0.36, 0.2, 1.05, 1.55, 14)
			bell.prism(0, 0, 0.2, 0.08, 1.55, 1.65, 10)
			g("gold").append_xf(bell, xf)
			var rope := GeoBuilder.new()
			rope.box(Vector3(0, 0.75, 0.0), Vector3(0.03, 0.6, 0.03))
			g("wood_dark").append_xf(rope, xf)

# ------------------------------------------------------------------ lampadaires
func _lamps() -> void:
	for l: Array in _L["lamps"]:
		var p := Vector3(float(l[0]), 0, float(l[1]))
		g("metal").prism(p.x, p.z, 0.12, 0.09, 0.0, 4.0, 8)
		g("metal").box(p + Vector3(0, 4.05, 0), Vector3(0.5, 0.1, 0.5))
		g("bulb").box(p + Vector3(0, 4.35, 0), Vector3(0.34, 0.5, 0.34))
		g("metal").spire(p.x, p.z, 0.36, 4.6, 4.95, 4, PI / 4.0)
		_lamp_pos.append(p + Vector3(0, 4.3, 0))
	for i in LAMP_LIGHTS:
		var ol := OmniLight3D.new()
		ol.light_color = Color(1.0, 0.8, 0.52)
		ol.omni_range = LAMP_RANGE
		ol.omni_attenuation = 1.4
		ol.light_energy = 0.0
		ol.shadow_enabled = false   # (ombres des lampadaires : tout le décor redessiné par lampe, -50 % d images la nuit)
		ol.visible = false
		add_child(ol)
		_lamp_lights.append(ol)

# ------------------------------------------------------------------ sapins (zone de jeu et forêt autour)
func fir_mesh() -> ArrayMesh:
	var trunk := GeoBuilder.new()
	trunk.prism(0, 0, 0.28, 0.2, -0.1, 2.2, 7)
	var fol := GeoBuilder.new()
	var layers := [[1.0, 3.9, 2.1], [2.4, 5.2, 1.75], [3.7, 6.4, 1.4], [4.9, 7.6, 1.05], [6.1, 8.6, 0.72], [7.3, 9.6, 0.42]]
	for i in layers.size():
		var ly: Array = layers[i]
		fol.ao = 0.55 + 0.08 * i
		fol.prism(0, 0, float(ly[2]), 0.06, float(ly[0]), float(ly[1]), 9, i * 0.6)
		fol.ao = 0.45
		for j in 9:   # dessous des étages : sombre
			var a0 := i * 0.6 + TAU * j / 9.0
			var a1 := i * 0.6 + TAU * (j + 1) / 9.0
			fol.tri(Vector3(0, float(ly[0]) + 0.5, 0), Vector3(cos(a0) * float(ly[2]), float(ly[0]), sin(a0) * float(ly[2])), Vector3(cos(a1) * float(ly[2]), float(ly[0]), sin(a1) * float(ly[2])), Vector3.DOWN)
	var mesh := trunk.build()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = fol.verts
	arr[Mesh.ARRAY_NORMAL] = fol.norms
	arr[Mesh.ARRAY_COLOR] = fol.cols
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	mesh.surface_set_material(0, mat("bark"))
	mesh.surface_set_material(1, mat("fir"))
	return mesh

func _trees() -> void:
	var mesh := fir_mesh()
	var xfs: Array[Transform3D] = []
	var rng := RandomNumberGenerator.new()
	rng.seed = 515
	for t: Array in _L["trees"]:
		var s := float(t[2])
		xfs.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.92, 1.1), s)), Vector3(float(t[0]), 0, float(t[1]))))
	for c: Dictionary in _L["circles"]:
		if c["k"] == "xmas_tree":
			var p := Vector3(float(c["x"]), 0, float(c["z"]))
			xfs.append(Transform3D(Basis().scaled(Vector3(1.3, 1.25, 1.3)), p))
			for k in 40:   # guirlandes
				var y := 1.4 + k * 0.24
				var rr := (2.1 - y * 0.18) * 1.3 + 0.1
				var a := k * 2.4
				g("xmas" if k % 2 == 0 else "xmas2").box(p + Vector3(cos(a) * rr, y * 1.25 - 0.4, sin(a) * rr), Vector3(0.14, 0.14, 0.14))
			g("gold").box(p + Vector3(0, 12.3, 0), Vector3(0.5, 0.5, 0.12))
	var n_in := xfs.size()
	var edge := 152.0
	var tries := 0
	while xfs.size() < n_in + 1400 and tries < 20000:   # forêt sur les pentes, hors d'atteinte
		tries += 1
		var x := rng.randf_range(-330.0, 330.0)
		var z := rng.randf_range(-330.0, 330.0)
		var d := maxf(absf(x), absf(z))
		if d < edge or (absf(x - 3.0) < 14.0 and z < -150.0):
			continue
		if rng.randf() < clampf((d - 260.0) / 80.0, 0.0, 0.9):
			continue
		var s := rng.randf_range(0.8, 1.6)
		xfs.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s, s)), Vector3(x, height_at(x, z) - 0.3, z)))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "sapins"
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mmi)

# ------------------------------------------------------------------ voitures garées sous la neige
func _cars() -> void:
	var xfs: Array = []
	var cols: Array = []
	for c: Array in _L["cars"]:
		var xf := Transform3D(Basis(Vector3.UP, float(c[2])), Vector3(float(c[0]), 0, float(c[1])))
		xfs.append(xf)
		cols.append(Color(String(c[3])))
		var M: Dictionary = CarsView.MODELS[CarsView.kind_at(xf.origin)]
		var roof := float(M["roof"])
		var cap := GeoBuilder.new()
		cap.box(Vector3((float(M["wx"]) + float(M["rx"])) / 2.0, roof + 0.07, 0), Vector3(float(M["wx"]) - float(M["rx"]) + 0.2, 0.16, 1.3))
		cap.box(Vector3((CarsView.L1 + float(M["hx"])) / 2.0, float(M["hood1"]) - 0.02, 0), Vector3(CarsView.L1 - float(M["hx"]), 0.1, 1.5))
		g("snow").append_xf(cap, xf)
	var cv := CarsView.new()
	add_child(cv)
	cv.build(xfs, cols)

# ------------------------------------------------------------------ neige qui tombe, tempête, vent
func _snowfall() -> void:
	_snow = GPUParticles3D.new()
	_snow.name = "neige"
	var q := int(Game.settings.get_value("quality"))
	_snow.amount = [2500, 5000, 9000][clampi(q, 0, 2)]
	_snow.lifetime = 7.0
	_snow.preprocess = 7.0
	_snow.visibility_aabb = AABB(Vector3(-40, -30, -40), Vector3(80, 60, 80))
	_snow.local_coords = false
	_snow_mat = ParticleProcessMaterial.new()
	_snow_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	_snow_mat.emission_box_extents = Vector3(32, 1, 32)
	_snow_mat.direction = Vector3(0, -1, 0)
	_snow_mat.spread = 12.0
	_snow_mat.initial_velocity_min = 1.0
	_snow_mat.initial_velocity_max = 2.0
	_snow_mat.gravity = Vector3(1.0, -1.6, 0.4)
	_snow_mat.turbulence_enabled = true
	_snow_mat.turbulence_noise_strength = 1.4
	_snow_mat.turbulence_noise_scale = 6.0
	_snow_mat.scale_min = 0.6
	_snow_mat.scale_max = 1.4
	_snow_mat.collision_mode = ParticleProcessMaterial.COLLISION_HIDE_ON_CONTACT
	_snow.process_material = _snow_mat
	var qm := QuadMesh.new()
	qm.size = Vector2(0.1, 0.1)
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.albedo_color = Color(0.92, 0.95, 1.0, 0.85)
	var gt := GradientTexture2D.new()
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(0.5, 0.0)
	var gr := Gradient.new()
	gr.set_color(0, Color(1, 1, 1, 1))
	gr.set_color(1, Color(1, 1, 1, 0))
	gt.gradient = gr
	sm.albedo_texture = gt
	qm.material = sm
	_snow.draw_pass_1 = qm
	_snow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_snow)
	_snow_col = GPUParticlesCollisionHeightField3D.new()   # les toits arrêtent la neige : pas de flocons dans les bâtiments
	_snow_col.size = Vector3(72, 40, 72)
	_snow_col.resolution = GPUParticlesCollisionHeightField3D.RESOLUTION_512
	_snow_col.update_mode = GPUParticlesCollisionHeightField3D.UPDATE_MODE_WHEN_MOVED
	_snow_col.follow_camera_enabled = true
	add_child(_snow_col)

## Tempête : 0 calme, 1 blizzard. Une tempête toutes les STORM_PERIOD s de jeu (montée, plateau, retombée), et pendant la Nuit blanche.
static func storm_at(t: float, finale_on: bool) -> float:
	if finale_on:
		return 1.0
	var u := fposmod(t + 60.0, STORM_PERIOD) / STORM_PERIOD
	var s := smoothstep(0.55, 0.68, u) * (1.0 - smoothstep(0.88, 0.98, u))
	return 0.18 + 0.82 * s

func _process(dt: float) -> void:
	if not built:
		return
	var cam := get_viewport().get_camera_3d()
	var fin: bool = Game.finale != null and Game.finale.active()
	var target := storm_at(Game.time, fin) if _storm_arg < 0.0 else _storm_arg
	storm += (target - storm) * minf(1.0, dt * 0.5) if _storm_arg < 0.0 else target - storm
	if _gv != null:
		_gv.storm = storm
	if cam != null and _snow != null:
		var cp := cam.global_position
		_snow.global_position = Vector3(cp.x, cp.y + 14.0, cp.z)
		_snow.amount_ratio = 0.3 + 0.7 * storm
		var wind := 1.0 + 9.0 * storm
		_snow_mat.gravity = Vector3(wind * 0.8, -1.6 - storm * 0.8, wind * 0.35)
		_snow.speed_scale = 1.0 + storm * 0.6
	var playing: bool = Game.playing and not Game.over and not get_tree().paused
	Sfx.set_wind((0.22 + 0.78 * storm) if playing else 0.0)
	for f in _fires:
		f.light_energy = 1.4 + 0.35 * sin(Game.time * 11.0 + f.position.x) + 0.2 * sin(Game.time * 23.0)
	_lamp_t -= dt
	if _lamp_t <= 0.0 and cam != null:
		_lamp_t = 0.5
		_place_lamp_lights(cam.global_position)

func _place_lamp_lights(at: Vector3) -> void:
	var order := range(_lamp_pos.size())
	order.sort_custom(func(a: int, b: int) -> bool: return _lamp_pos[a].distance_squared_to(at) < _lamp_pos[b].distance_squared_to(at))
	for i in _lamp_lights.size():
		var l := _lamp_lights[i]
		if i < order.size() and _lit > 0.01:
			l.position = _lamp_pos[order[i]]
			l.light_energy = LAMP_ENERGY * _lit
			l.visible = true
		else:
			l.visible = false

func on_sky_k(k: float) -> void:
	_lit = DayNight.lamps_of(k)
	for key: String in EMIT_BASE:
		if not _mats.has(key):
			continue
		var always: bool = (MATS[key] as Array).size() > 4 and bool((MATS[key][4] as Dictionary).get("always", false))
		var k_lit := 1.0 if always or key == "fire" else (_lit if key != "glass_in" else 0.08 + 0.92 * (1.0 - _lit))   # glass_in : le jour vu de l'intérieur
		(_mats[key] as ShaderMaterial).set_shader_parameter("emit", float(EMIT_BASE[key]) * k_lit)
	_lamp_t = 0.0

func _exit_tree() -> void:
	Sfx.set_wind(0.0)

# ------------------------------------------------------------------ export pour les outils de diagnostic (tools/collision-scan.py, walkthrough-scan.py)
## --export-geom=DIR : écrit la géométrie dessinée (sens trigonométrique, comme le monde cuit), la collision, la grille de navigation et les objets
## au format de data/world/ (geom_lib.py), pour lancer les scans sur la station : ZS_WORLD_DIR=DIR python3 tools/collision-scan.py.
func export_geometry(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir + "/tiles")
	DirAccess.make_dir_recursive_absolute(dir + "/collision")
	DirAccess.make_dir_recursive_absolute(dir + "/nav")
	var mats: Array = []
	var mat_ids: Dictionary = {}
	var surfaces: Array = []   # [PackedVector3Array (triangles, monde, sens trigo), indice de matériau]
	var add_mesh := func(mesh: Mesh, xf: Transform3D, override: Material) -> void:
		for si in mesh.get_surface_count():
			var m: Material = override if override != null else mesh.surface_get_material(si)
			if m == null:
				continue
			if not mat_ids.has(m):
				var foliage: bool = m == _mats.get("fir", null) or m == _mats.get("bark", null)
				mat_ids[m] = mats.size()
				mats.append({"side": 0, "tr": foliage, "op": 1.0, "at": 0.5 if foliage else 0.0, "name": str(m.resource_name)})
			var arr := mesh.surface_get_arrays(si)
			var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var out := PackedVector3Array()
			var n := idx.size() if not idx.is_empty() else v.size()
			for i in range(0, n, 3):
				var a := v[idx[i] if not idx.is_empty() else i]
				var b := v[idx[i + 1] if not idx.is_empty() else i + 1]
				var c := v[idx[i + 2] if not idx.is_empty() else i + 2]
				out.append_array([xf * a, xf * c, xf * b])
			surfaces.append([out, mat_ids[m]])
	var stack: Array[Node] = [self]
	while not stack.is_empty():
		var nd: Node = stack.pop_back()
		for ch in nd.get_children():
			stack.append(ch)
		if nd is MeshInstance3D and (nd as MeshInstance3D).visible and (nd as MeshInstance3D).is_visible_in_tree() and (nd as MeshInstance3D).mesh != null:
			var mi := nd as MeshInstance3D
			if mi.name == "relief":
				continue   # relief hors de la zone jouable
			add_mesh.call(mi.mesh, mi.global_transform, mi.material_override)
		elif nd is MultiMeshInstance3D:
			var mmi := nd as MultiMeshInstance3D
			var mm := mmi.multimesh
			for i in mm.instance_count:
				var xf := mmi.global_transform * mm.get_instance_transform(i)
				if absf(xf.origin.x) > 152.0 or absf(xf.origin.z) > 152.0:
					continue
				add_mesh.call(mm.mesh, xf, mmi.material_override)
	var head := {"surfaces": []}
	var body := PackedByteArray()
	var ntri := 0
	for s: Array in surfaces:
		var tris: PackedVector3Array = s[0]
		var pos := PackedFloat32Array()
		for p in tris:
			pos.append_array([p.x, p.y, p.z])
		var ids := PackedInt32Array()
		for i in tris.size():
			ids.append(i)
		head["surfaces"].append({"nv": tris.size(), "ni": ids.size(), "pos": body.size(), "idx": body.size() + pos.size() * 4, "mat": s[1]})
		body.append_array(pos.to_byte_array())
		body.append_array(ids.to_byte_array())
		ntri += tris.size() / 3
	var hj := JSON.stringify(head).to_utf8_buffer()
	var f := FileAccess.open(dir + "/tiles/t0_0.bin", FileAccess.WRITE)
	f.store_buffer("ZMP1".to_ascii_buffer())
	f.store_32(hj.size())
	f.store_buffer(hj)
	f.store_buffer(body)
	f.close()
	_write_json(dir + "/tiles.json", {"x0": -150, "z0": -150, "tile": 300, "tiles": [{"key": "0_0", "tri": ntri}]})
	_write_json(dir + "/materials.json", mats)
	# collision (indices de porte : segments des portes)
	var w: World = Game.world
	var door_of := {}
	for d: Dictionary in w.doors:
		for k: float in d["segs"]:
			door_of[int(k)] = int(d["id"])
	var sd := PackedFloat64Array()
	for i in w.seg_list.size():
		var s: Dictionary = w.seg_list[i]
		sd.append_array([s["ax"], s["az"], s["bx"], s["bz"], s["h"], s["y0"], 1.0 if s["kind"] == "prop" else 0.0, float(s["vid"]), float(door_of.get(i, -1)), 1.0 if s["off"] else 0.0])
	var fs := FileAccess.open(dir + "/collision/segs.f64", FileAccess.WRITE)
	fs.store_buffer(sd.to_byte_array())
	fs.close()
	var cd := PackedFloat64Array()
	for c: Dictionary in w.collision.circles:
		cd.append_array([c["x"], c["z"], c["r"], c["h"], c["y0"], 1.0 if c["kind"] == "prop" else 0.0, float(c["vid"]), 1.0 if c["off"] else 0.0])
	var fc := FileAccess.open(dir + "/collision/circles.f64", FileAccess.WRITE)
	fc.store_buffer(cd.to_byte_array())
	fc.close()
	var nav := w.nav
	_write_json(dir + "/nav/meta.json", {"nx": nav.nx, "nz": nav.nz, "cell": nav.cell, "ox": nav.ox, "oz": nav.oz, "margin": nav.margin})
	for pair: Array in [["blocked.u8.gz", nav.blocked], ["zone.i8.gz", nav.zone]]:
		var fz := FileAccess.open(dir + "/nav/" + String(pair[0]), FileAccess.WRITE)
		fz.store_buffer((pair[1] as PackedByteArray).compress(FileAccess.COMPRESSION_GZIP))
		fz.close()
	var objs := w.objects.duplicate()
	var doors: Array = []
	for d: Dictionary in w.doors:
		var dd := d.duplicate()
		dd["cells"] = Array(d["cells"])
		doors.append(dd)
	objs["doors"] = doors
	_write_json(dir + "/objects.json", objs)
	print("export de la géométrie : %s (%d triangles, %d matériaux, %d segments, %d cercles)" % [dir, ntri, mats.size(), w.seg_list.size(), w.collision.circles.size()])

static func _write_json(path: String, v: Variant) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(JSON.stringify(v))
	f.close()
