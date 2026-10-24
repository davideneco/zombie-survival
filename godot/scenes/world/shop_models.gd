class_name ShopModels
extends RefCounted
## v0.28.0 : models of the wall weapon panels and of the ammo stations (they replace the JS chalk boards and olive boxes, filtered out of the baked tiles by
## world_view.gd). Static parts are merged once into a shared ArrayMesh per variant (scenes/world/shop_view.gd draws every copy through MultiMesh), the
## parts that change per copy (weapon model, its glowing silhouette, texts) are separate nodes. No light per copy: the LED strip, the lamp of the sconce,
## the light wash on the board and the screens are emissive and follow the street lamps (set_lit, DayNight.lamps).
## Local frame: the face looks along +Z; the origin is the JS group origin (wall panel: 6 cm in front of the wall, station: centre of its footprint).

const WeaponModels := preload("res://scenes/weapon_models.gd")
static var SHADER: Shader:
	get: return load("res://shaders/shop_pbr.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
static var GLOW_SHADER: Shader:
	get: return load("res://shaders/shop_glow.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
static var WOOD_A: Texture2D:
	get: return load("res://assets/pbr/wood_door/a.png")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
static var WOOD_M: Texture2D:
	get: return load("res://assets/pbr/wood_door/m.png")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)

## Wall panel (metres)
const PW := 1.78            ## outer width of the frame
const PH := 1.04            ## outer height
const PC := 1.55            ## centre height (realworld.js makeWallBuy: board at 1.55)
const BACK := -0.055        ## back of the panel (the wall is at -0.06)
const BOARD_FRONT := -0.018
const GUN_Z := 0.05         ## weapon depth (centre)
const GUN_MAX_LEN := 1.3
const GUN_MAX_H := 0.34
const GUN_Y := PC + 0.03
const NAME_Y := PC + 0.355
const ROW_Y := PC - 0.37
const TAG_X := -0.36
const PRICE_X := 0.36
## Ammo station (fits the JS collision box 1.25 x 0.7, 2.05 m high)
const SW := 1.12
const SD := 0.6
const SH := 1.46

const STATE_COLORS := {"buy": Color("2f8f4e"), "ammo": Color("2c63a8"), "pap": Color("8a3fc4")}
const STATE_TEXT := {"buy": "ACHETER", "ammo": "MUNITIONS", "pap": "PACK-A-PUNCH"}
## Silhouette colour per weapon (realworld.js WALL_COLORS; gold: premium weapons of the outer zones)
const GLOW_COLORS := {"shotgun": Color("ff8833"), "smg": Color("3399ff"), "sniper": Color("88ccff"), "lmg": Color("ff5533"), "crossbow": Color("c89a50"),
	"m79": Color("ff6a2a"), "magnum": Color("ffc84a"), "saiga": Color("ffc84a"), "mg42": Color("ffc84a"), "barrett": Color("ffc84a")}
const GLOW_DEFAULT := Color("ffb35a")

static var _mats: Dictionary = {}
static var _meshes: Dictionary = {}
static var _font: Font
static var _noise: NoiseTexture2D
static var _lit := -1.0
static var _emissive: Array = []   ## [material, energy at night, energy by day, param] (StandardMaterial3D: emission_energy_multiplier ; ShaderMaterial: param)

# ------------------------------------------------------------------ materials
static func noise() -> NoiseTexture2D:
	if _noise == null:
		var n := FastNoiseLite.new()
		n.seed = 4
		n.frequency = 0.007
		n.fractal_octaves = 4
		_noise = NoiseTexture2D.new()
		_noise.width = 256
		_noise.height = 256
		_noise.seamless = true
		_noise.generate_mipmaps = true
		_noise.noise = n
	return _noise

static func _pbr(tint: Color, rough: float, metal: float, grime := 0.0, grime_col := Color(0.24, 0.18, 0.12), maps := false, scale := 1.0) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = SHADER
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("roughness", rough)
	m.set_shader_parameter("metallic", metal)
	m.set_shader_parameter("grime", grime)
	m.set_shader_parameter("grime_color", grime_col)
	m.set_shader_parameter("noise_tex", noise())
	m.set_shader_parameter("use_maps", maps)
	if maps:
		m.set_shader_parameter("a_tex", WOOD_A)
		m.set_shader_parameter("m_tex", WOOD_M)
		m.set_shader_parameter("scale", scale)
	return m

static func _glow_mat(col: Color, night: float, day: float, add := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col.darkened(0.35)
	m.emission_enabled = true
	m.emission = col
	m.emission_energy_multiplier = night
	m.roughness = 0.4
	if add:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.disable_receive_shadows = true
	_emissive.append([m, night, day, ""])
	return m

## Shared materials, by name.
static func mat(key: String) -> Material:
	if _mats.is_empty():
		_mats["wood"] = _pbr(Color(0.5, 0.37, 0.25), 1.0, 0.0, 0.18, Color(0.3, 0.25, 0.19), true, 1.25)
		_mats["pine"] = _pbr(Color(0.78, 0.62, 0.42), 1.0, 0.0, 0.25, Color(0.3, 0.24, 0.16), true, 0.9)
		_mats["steel"] = _pbr(Color(0.3, 0.3, 0.31), 0.42, 0.55, 0.3, Color(0.36, 0.2, 0.11))
		_mats["chrome"] = _pbr(Color(0.62, 0.62, 0.64), 0.28, 0.9, 0.15, Color(0.3, 0.2, 0.12))
		_mats["brass"] = _pbr(Color(0.8, 0.6, 0.3), 0.33, 0.95, 0.28, Color(0.27, 0.29, 0.2))
		_mats["enamel"] = _pbr(Color(0.045, 0.06, 0.085), 0.22, 0.05, 0.18, Color(0.2, 0.17, 0.13))
		_mats["olive"] = _pbr(Color(0.25, 0.28, 0.16), 0.62, 0.3, 0.25, Color(0.3, 0.24, 0.15))
		_mats["olive_dark"] = _pbr(Color(0.17, 0.19, 0.11), 0.65, 0.3, 0.3, Color(0.2, 0.14, 0.08))
		_mats["dark"] = _pbr(Color(0.035, 0.035, 0.04), 0.78, 0.0)
		_mats["yellow"] = _pbr(Color(0.85, 0.66, 0.08), 0.55, 0.1, 0.4, Color(0.25, 0.2, 0.1))
		_mats["shell"] = _pbr(Color(0.86, 0.66, 0.3), 0.3, 0.95, 0.1)
		_mats["tip"] = _pbr(Color(0.62, 0.36, 0.22), 0.35, 0.9, 0.0)
		_mats["led"] = _glow_mat(Color(1.0, 0.82, 0.58), 4.0, 0.25)
		_mats["bulb"] = _glow_mat(Color(1.0, 0.78, 0.5), 7.0, 0.15)
		_mats["led_green"] = _glow_mat(Color(0.35, 1.0, 0.5), 4.0, 0.6)
		var scr := _glow_mat(Color(0.03, 0.16, 0.07), 0.3, 0.12)
		scr.albedo_color = Color(0.01, 0.025, 0.015)
		scr.roughness = 0.15
		_mats["screen"] = scr
		var wash := _glow_mat(Color(1.0, 0.78, 0.5), 0.0, 0.0, true)   # light of the LED strip on the board, faked (no light)
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 0.0))
		g.set_color(1, Color(1, 1, 1, 1.0))
		g.add_point(0.5, Color(1, 1, 1, 0.12))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill_from = Vector2(0.5, 1.0)
		gt.fill_to = Vector2(0.5, 0.0)
		gt.width = 8
		gt.height = 64
		wash.albedo_texture = gt
		wash.albedo_color = Color(1.0, 0.75, 0.45, 0.08)
		wash.emission_enabled = false
		_emissive.pop_back()
		_emissive.append([wash, 0.08, 0.0, "alpha"])
		_mats["wash"] = wash
		for st: String in STATE_COLORS:
			_mats["state_" + st] = _pbr(STATE_COLORS[st].darkened(0.25), 0.25, 0.1, 0.15, Color(0.2, 0.17, 0.13))
	return _mats[key]

## Day / night: 1 at night (lit), 0 by day.
static func set_lit(lit: float) -> void:
	mat("led")
	if absf(lit - _lit) < 0.01:
		return
	_lit = lit
	for e: Array in _emissive:
		var v := lerpf(float(e[2]), float(e[1]), lit)
		match String(e[3]):
			"alpha":
				(e[0] as StandardMaterial3D).albedo_color.a = v
			"":
				(e[0] as StandardMaterial3D).emission_energy_multiplier = v
			_:
				(e[0] as ShaderMaterial).set_shader_parameter(String(e[3]), v)

## Label font: condensed bold (Impact on Windows), multichannel signed distance field: sharp at any distance and resolution (3440x1440 included).
static func font() -> Font:
	if _font == null:
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Impact", "Anton", "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans Condensed", "Liberation Sans", "DejaVu Sans"])
		f.font_weight = 700
		f.multichannel_signed_distance_field = true
		f.msdf_pixel_range = 14
		f.msdf_size = 64
		f.generate_mipmaps = true
		_font = f
	return _font

static func label(parent: Node3D, text: String, height: float, pos: Vector3, color: Color, shaded := false, outline := 0) -> Label3D:
	var l := Label3D.new()
	l.font = font()
	l.text = text
	l.font_size = 64
	l.pixel_size = height / 64.0
	l.modulate = color
	l.outline_size = outline
	l.outline_modulate = Color(0, 0, 0, 0.85)
	l.shaded = shaded
	l.double_sided = false
	l.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
	l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	l.position = pos
	l.visibility_range_end = 40.0
	parent.add_child(l)
	return l

# ------------------------------------------------------------------ mesh kit (merged primitives)
class Kit:
	var st: Dictionary = {}

	func _tool(key: String) -> SurfaceTool:
		if not st.has(key):
			var s := SurfaceTool.new()
			s.begin(Mesh.PRIMITIVE_TRIANGLES)
			st[key] = s
		return st[key]

	func add(key: String, m: Mesh, xf: Transform3D) -> void:
		_tool(key).append_from(m, 0, xf)

	func box(key: String, size: Vector3, pos: Vector3, basis := Basis.IDENTITY) -> void:
		var b := BoxMesh.new()
		b.size = size
		add(key, b, Transform3D(basis, pos))

	func cyl(key: String, r_top: float, r_bot: float, h: float, pos: Vector3, basis := Basis.IDENTITY, seg := 12) -> void:
		var c := CylinderMesh.new()
		c.top_radius = r_top
		c.bottom_radius = r_bot
		c.height = h
		c.radial_segments = seg
		c.rings = 1
		add(key, c, Transform3D(basis, pos))

	func sphere(key: String, r: float, pos: Vector3, seg := 10) -> void:
		var s := SphereMesh.new()
		s.radius = r
		s.height = r * 2.0
		s.radial_segments = seg
		s.rings = maxi(4, seg / 2)
		add(key, s, Transform3D(Basis.IDENTITY, pos))

	func quad(key: String, size: Vector2, pos: Vector3, basis := Basis.IDENTITY) -> void:
		var q := QuadMesh.new()
		q.size = size
		add(key, q, Transform3D(basis, pos))

	## Bolt head (hexagonal, facing +Z) at pos.
	func bolt(pos: Vector3, r := 0.011) -> void:
		cyl("steel", r, r, 0.008, pos, Basis(Vector3.RIGHT, PI / 2.0), 6)

	func commit() -> ArrayMesh:
		var mesh := ArrayMesh.new()
		for key: String in st:
			var s: SurfaceTool = st[key]
			s.commit(mesh)
			mesh.surface_set_material(mesh.get_surface_count() - 1, ShopModels.mat(key))
		return mesh

# ------------------------------------------------------------------ wall panel
## Static parts of a wall weapon panel. posts: free-standing (two steel posts and braces) instead of hung on a wall.
static func panel_mesh(posts: bool) -> ArrayMesh:
	var key := "panel_posts" if posts else "panel_wall"
	if _meshes.has(key):
		return _meshes[key]
	var k := Kit.new()
	var top := PC + PH / 2.0
	var bot := PC - PH / 2.0
	# weathered plank board
	k.box("wood", Vector3(PW - 0.06, PH - 0.06, BOARD_FRONT - BACK), Vector3(0, PC, (BACK + BOARD_FRONT) / 2.0))
	# steel frame (angle iron): rails proud of the board
	var fd := 0.07
	var fz := BACK + fd / 2.0
	k.box("steel", Vector3(PW, 0.055, fd), Vector3(0, top - 0.0275, fz))
	k.box("steel", Vector3(PW, 0.055, fd), Vector3(0, bot + 0.0275, fz))
	k.box("steel", Vector3(0.055, PH - 0.11, fd), Vector3(-PW / 2.0 + 0.0275, PC, fz))
	k.box("steel", Vector3(0.055, PH - 0.11, fd), Vector3(PW / 2.0 - 0.0275, PC, fz))
	var fr := BACK + fd
	# corner gussets with bolts
	for sx in [-1.0, 1.0]:
		for sy in [-1.0, 1.0]:
			var c := Vector3(sx * (PW / 2.0 - 0.06), PC + sy * (PH / 2.0 - 0.06), fr + 0.003)
			k.box("steel", Vector3(0.12, 0.12, 0.006), c)
			k.bolt(c + Vector3(sx * 0.025, sy * 0.025, 0.006))
			k.bolt(c + Vector3(-sx * 0.02, -sy * 0.02, 0.006))
	# mid bolts of the long rails
	for x in [-0.45, 0.0, 0.45]:
		k.bolt(Vector3(x, top - 0.0275, fr + 0.002))
		k.bolt(Vector3(x, bot + 0.0275, fr + 0.002))
	# name plate: enamel on a brass bezel, four rivets
	k.box("brass", Vector3(1.24, 0.2, 0.008), Vector3(0, NAME_Y, BOARD_FRONT + 0.004))
	k.box("enamel", Vector3(1.2, 0.165, 0.008), Vector3(0, NAME_Y, BOARD_FRONT + 0.009))
	for sx in [-0.58, 0.58]:
		for sy in [-0.06, 0.06]:
			k.cyl("brass", 0.008, 0.008, 0.006, Vector3(sx, NAME_Y + sy, BOARD_FRONT + 0.014), Basis(Vector3.RIGHT, PI / 2.0), 8)
	# price plate on the right (enamel in a brass bezel), bezel of the state tag on the left (the tag itself has its own material per copy)
	k.box("brass", Vector3(0.62, 0.17, 0.008), Vector3(PRICE_X, ROW_Y, BOARD_FRONT + 0.004))
	k.box("enamel", Vector3(0.58, 0.135, 0.008), Vector3(PRICE_X, ROW_Y, BOARD_FRONT + 0.009))
	k.box("brass", Vector3(0.62, 0.17, 0.008), Vector3(TAG_X, ROW_Y, BOARD_FRONT + 0.004))
	for sx in [TAG_X - 0.29, TAG_X + 0.29, PRICE_X - 0.29, PRICE_X + 0.29]:
		k.cyl("brass", 0.007, 0.007, 0.006, Vector3(sx, ROW_Y, BOARD_FRONT + 0.011), Basis(Vector3.RIGHT, PI / 2.0), 8)
	# LED strip under the top rail, and the wash of its light on the board (emissive, no light)
	k.box("steel", Vector3(PW - 0.16, 0.022, 0.03), Vector3(0, top - 0.066, BOARD_FRONT + 0.03))
	k.box("led", Vector3(PW - 0.2, 0.006, 0.016), Vector3(0, top - 0.078, BOARD_FRONT + 0.03))
	k.quad("wash", Vector2(PW - 0.12, PH - 0.14), Vector3(0, PC, BOARD_FRONT + 0.0015))
	# gooseneck sconce above the panel
	var sy0 := top + 0.2
	if not posts:
		k.box("steel", Vector3(0.1, 0.16, 0.012), Vector3(0, sy0, BACK + 0.006))
		k.cyl("steel", 0.014, 0.014, 0.03, Vector3(0, sy0, BACK + 0.025), Basis(Vector3.RIGHT, PI / 2.0), 8)
	else:
		k.box("steel", Vector3(0.05, sy0 - top + 0.02, 0.05), Vector3(0, (sy0 + top) / 2.0, BACK + 0.035))
	var arm_len := 0.32
	var arm_b := Basis(Vector3.RIGHT, PI / 2.0 - 0.18)
	var arm_dir := arm_b * Vector3.UP
	var arm_c := Vector3(0, sy0 + 0.02, BACK + 0.03) + arm_dir * arm_len / 2.0
	k.cyl("steel", 0.011, 0.011, arm_len, arm_c, arm_b, 8)
	var tip := arm_c + arm_dir * arm_len / 2.0
	var tilt := Basis(Vector3.RIGHT, 0.5)   # the open side of the shade looks down onto the board
	var shade := CylinderMesh.new()
	shade.top_radius = 0.035
	shade.bottom_radius = 0.12
	shade.height = 0.11
	shade.radial_segments = 16
	shade.rings = 1
	shade.cap_bottom = false
	k.add("steel", shade, Transform3D(tilt, tip + tilt * Vector3(0, -0.03, 0)))
	k.cyl("bulb", 0.0, 0.112, 0.004, tip + tilt * Vector3(0, -0.08, 0), tilt, 16)
	k.sphere("bulb", 0.03, tip + tilt * Vector3(0, -0.055, 0))
	if posts:
		for sx in [-0.72, 0.72]:
			var ph := top + 0.06
			k.box("steel", Vector3(0.065, ph, 0.065), Vector3(sx, ph / 2.0, BACK - 0.04))
			k.box("steel", Vector3(0.22, 0.012, 0.26), Vector3(sx, 0.006, BACK - 0.04))
			for bx in [-0.07, 0.07]:
				k.bolt(Vector3(sx + bx, 0.012, BACK - 0.04 + 0.08), 0.012)
			# brace to the ground behind
			var a := Vector3(sx, 1.05, BACK - 0.07)
			var b := Vector3(sx, 0.02, BACK - 0.62)
			var mid := (a + b) / 2.0
			var dirv := (a - b).normalized()
			var bas := Basis(Vector3.RIGHT, acos(dirv.dot(Vector3.UP)))
			k.box("steel", Vector3(0.04, (a - b).length(), 0.04), mid, bas)
			k.box("steel", Vector3(0.12, 0.01, 0.14), Vector3(sx, 0.005, BACK - 0.62))
		k.box("steel", Vector3(1.5, 0.05, 0.04), Vector3(0, 0.5, BACK - 0.04))   # cross bar
	var mesh := k.commit()
	_meshes[key] = mesh
	return mesh

## State tag of a panel (left of the bottom row): enamel of the state colour. The text is a label of shop_view.gd.
static func state_tag() -> MeshInstance3D:
	if not _meshes.has("tag"):
		var b := BoxMesh.new()
		b.size = Vector3(0.58, 0.135, 0.008)
		_meshes["tag"] = b
	var mi := MeshInstance3D.new()
	mi.mesh = _meshes["tag"]
	mi.position = Vector3(TAG_X, ROW_Y, BOARD_FRONT + 0.009)
	mi.material_override = mat("state_buy")
	mi.visibility_range_end = 60.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

# ------------------------------------------------------------------ ammo station
## Static parts of an ammo station: olive steel locker on a hazard-striped plinth, stencilled doors, louvres, padlock, lit price screen, open crate of
## cartridges and an ammo can on top, green LED strip and lamp.
static func station_mesh() -> ArrayMesh:
	if _meshes.has("station"):
		return _meshes["station"]
	var k := Kit.new()
	var y0 := 0.08
	var fz := SD / 2.0
	# plinth with hazard stripes
	k.box("dark", Vector3(SW + 0.04, y0, SD + 0.04), Vector3(0, y0 / 2.0, 0))
	for i in 10:
		var x := -SW / 2.0 + 0.05 + float(i) * (SW - 0.1) / 9.0
		k.box("yellow" if i % 2 == 0 else "dark", Vector3((SW - 0.1) / 9.0, y0 - 0.02, 0.006), Vector3(x, y0 / 2.0, fz + 0.023), Basis(Vector3.BACK, 0.0))
	# locker body
	k.box("olive", Vector3(SW, SH, SD), Vector3(0, y0 + SH / 2.0, 0))
	k.box("olive_dark", Vector3(SW + 0.03, 0.04, SD + 0.03), Vector3(0, y0 + SH + 0.02, 0))   # top lip
	# two doors: seams, recessed panels, louvres, handles, hasp and padlock
	k.box("dark", Vector3(0.008, SH - 0.08, 0.004), Vector3(0, y0 + SH / 2.0, fz + 0.002))
	for sx in [-1.0, 1.0]:
		var cx: float = sx * SW / 4.0
		k.box("olive_dark", Vector3(SW / 2.0 - 0.1, SH - 0.16, 0.006), Vector3(cx, y0 + SH / 2.0, fz + 0.003))
		for j in 5:
			k.box("dark", Vector3(SW / 2.0 - 0.2, 0.012, 0.02), Vector3(cx, y0 + SH - 0.16 - float(j) * 0.035, fz + 0.01), Basis(Vector3.RIGHT, -0.5))
		for j in 4:
			k.box("dark", Vector3(SW / 2.0 - 0.2, 0.012, 0.02), Vector3(cx, y0 + 0.2 + float(j) * 0.035, fz + 0.01), Basis(Vector3.RIGHT, -0.5))
		k.box("chrome", Vector3(0.025, 0.26, 0.02), Vector3(sx * 0.07, y0 + SH * 0.52, fz + 0.03))
		k.box("chrome", Vector3(0.02, 0.02, 0.03), Vector3(sx * 0.07, y0 + SH * 0.52 + 0.11, fz + 0.015))
		k.box("chrome", Vector3(0.02, 0.02, 0.03), Vector3(sx * 0.07, y0 + SH * 0.52 - 0.11, fz + 0.015))
		for hy in [0.22, SH - 0.22]:   # hinges
			k.cyl("steel", 0.014, 0.014, 0.1, Vector3(sx * (SW / 2.0 - 0.01), y0 + hy, fz + 0.01), Basis.IDENTITY, 8)
	k.box("brass", Vector3(0.07, 0.08, 0.025), Vector3(0, y0 + SH * 0.4, fz + 0.03))   # padlock
	k.cyl("chrome", 0.022, 0.022, 0.012, Vector3(0, y0 + SH * 0.4 + 0.055, fz + 0.03), Basis(Vector3.BACK, PI / 2.0), 10)
	# stencil band (the texts are labels)
	k.box("olive_dark", Vector3(SW - 0.14, 0.2, 0.004), Vector3(0, y0 + SH * 0.73, fz + 0.007))
	# price screen on top, in a dark housing tilted toward the player
	var sy := y0 + SH + 0.16
	var tilt := Basis(Vector3.RIGHT, -0.2)
	k.box("dark", Vector3(SW - 0.06, 0.28, 0.1), Vector3(0, sy, fz - 0.06), tilt)
	k.box("screen", Vector3(SW - 0.14, 0.2, 0.004), Vector3(0, sy, fz - 0.06) + tilt * Vector3(0, 0, 0.051), tilt)
	k.box("led_green", Vector3(SW - 0.1, 0.008, 0.012), Vector3(0, sy - 0.148, fz - 0.03))
	k.box("dark", Vector3(0.04, 0.12, 0.04), Vector3(-SW / 2.0 + 0.1, y0 + SH + 0.06, fz - 0.08))
	k.box("dark", Vector3(0.04, 0.12, 0.04), Vector3(SW / 2.0 - 0.1, y0 + SH + 0.06, fz - 0.08))
	# open crate of cartridges behind the screen
	var cy := y0 + SH + 0.04
	var cz := -0.1
	k.box("pine", Vector3(0.72, 0.03, 0.36), Vector3(-0.14, cy + 0.015, cz))
	for s in [-1.0, 1.0]:
		k.box("pine", Vector3(0.72, 0.2, 0.025), Vector3(-0.14, cy + 0.1, cz + s * 0.1675))
		k.box("pine", Vector3(0.025, 0.2, 0.36), Vector3(-0.14 + s * 0.3475, cy + 0.1, cz))
	for i in 9:
		for j in 4:
			var p := Vector3(-0.44 + float(i) * 0.075, cy + 0.03 + 0.07, cz - 0.11 + float(j) * 0.073)
			k.cyl("shell", 0.017, 0.017, 0.14, p, Basis.IDENTITY, 8)
			k.cyl("tip", 0.004, 0.017, 0.04, p + Vector3(0, 0.09, 0), Basis.IDENTITY, 8)
	# ammo can (M2A1 style) on the right
	var ax := 0.38
	k.box("olive", Vector3(0.3, 0.19, 0.16), Vector3(ax, cy + 0.095, cz))
	k.box("olive_dark", Vector3(0.31, 0.03, 0.17), Vector3(ax, cy + 0.2, cz))
	k.box("dark", Vector3(0.12, 0.012, 0.02), Vector3(ax, cy + 0.225, cz))
	k.box("chrome", Vector3(0.03, 0.06, 0.02), Vector3(ax + 0.13, cy + 0.15, cz + 0.085))
	# green lamp on the corner
	k.cyl("dark", 0.03, 0.035, 0.03, Vector3(SW / 2.0 - 0.08, y0 + SH + 0.055, fz - 0.07), Basis.IDENTITY, 10)
	k.sphere("led_green", 0.032, Vector3(SW / 2.0 - 0.08, y0 + SH + 0.085, fz - 0.07))
	var mesh := k.commit()
	_meshes["station"] = mesh
	return mesh

## Height of the price screen centre (texts of shop_view.gd)
static func station_screen() -> Transform3D:
	var tilt := Basis(Vector3.RIGHT, -0.2)
	return Transform3D(tilt, Vector3(0, 0.08 + SH + 0.16, SD / 2.0 - 0.06) + tilt * Vector3(0, 0, 0.056))

# ------------------------------------------------------------------ weapon on its panel
## The real weapon model (WeaponModels) laid on the board, barrel to the right, centred and fitted in GUN_MAX_LEN x GUN_MAX_H, lit by the world (layer 1),
## plus its glowing silhouette (same meshes grown and flattened onto the board). Returns the root (local frame of the panel).
static func weapon_on_board(id: String) -> Node3D:
	var root := Node3D.new()
	if not WeaponModels.has_model(id):
		return root
	var e: Dictionary = WeaponModels.table()[id]
	var model := WeaponModels.build(id, null)
	var aabb := _aabb_of(model, Transform3D.IDENTITY)
	var len_m := aabb.size.z
	var h_m := aabb.size.y
	var k := minf(GUN_MAX_LEN / maxf(0.05, len_m), GUN_MAX_H / maxf(0.02, h_m))
	k = minf(k, 2.4)
	var holder := Node3D.new()
	holder.rotation.y = -PI / 2.0   # barrel (-Z of the weapon frame) -> +X of the panel
	holder.scale = Vector3.ONE * k
	var c := aabb.get_center()
	holder.position = Vector3(c.z * k, GUN_Y - c.y * k, GUN_Z)
	holder.add_child(model)
	root.add_child(holder)
	# rack: two steel pegs under the weapon (its lowest point at the pegs), screwed to the board
	var low := GUN_Y - h_m * k / 2.0
	var pegs := MeshInstance3D.new()
	pegs.mesh = peg_mesh()
	pegs.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	pegs.visibility_range_end = 60.0
	for sx in [-1.0, 1.0]:
		var pg: MeshInstance3D = pegs if sx < 0.0 else pegs.duplicate()
		pg.position = Vector3(sx * minf(0.3, len_m * k * 0.28), low, 0.0)
		root.add_child(pg)
	for mi in _meshes_in(model):
		mi.layers = 1
		mi.visibility_range_end = 60.0
		for i in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(i) as StandardMaterial3D
			if m != null:
				m.emission_enabled = false
				m.metallic = 0.45
				m.roughness = 0.42
	# silhouette
	var col: Color = GLOW_COLORS.get(id, GLOW_DEFAULT)
	var flat := Node3D.new()
	flat.position = Vector3(0, 0, BOARD_FRONT + 0.004)
	flat.scale = Vector3(1, 1, 0.02)
	root.add_child(flat)
	var gh := Node3D.new()
	gh.rotation.y = -PI / 2.0
	gh.scale = Vector3.ONE * k
	gh.position = Vector3(c.z * k, GUN_Y - c.y * k, 0.0)
	flat.add_child(gh)
	var glow := glow_mat(col)
	for mi in _meshes_in(model):
		var g := MeshInstance3D.new()
		g.mesh = mi.mesh
		g.transform = model.transform * mi.transform
		g.material_override = glow
		g.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		g.visibility_range_end = 60.0
		gh.add_child(g)
	root.set_meta("len", len_m * k)
	return root

## A peg of the weapon rack: base plate on the board, arm out to the weapon depth, upturned tip (origin: top of the arm at the board plane x = 0).
static func peg_mesh() -> ArrayMesh:
	if not _meshes.has("peg"):
		var k := Kit.new()
		k.box("brass", Vector3(0.05, 0.07, 0.006), Vector3(0, -0.01, BOARD_FRONT + 0.003))
		k.box("brass", Vector3(0.026, 0.026, GUN_Z + 0.035 - BOARD_FRONT), Vector3(0, -0.013, (BOARD_FRONT + GUN_Z + 0.035) / 2.0))
		k.box("brass", Vector3(0.026, 0.05, 0.02), Vector3(0, 0.0, GUN_Z + 0.035))
		k.bolt(Vector3(0, -0.035, BOARD_FRONT + 0.007), 0.008)
		_meshes["peg"] = k.commit()
	return _meshes["peg"]

static var _glow_mats: Dictionary = {}

static func glow_mat(col: Color) -> ShaderMaterial:
	var key := col.to_html()
	if not _glow_mats.has(key):
		var m := ShaderMaterial.new()
		m.shader = GLOW_SHADER
		m.set_shader_parameter("color", col)
		m.set_shader_parameter("energy", 1.0)
		_glow_mats[key] = m
		_emissive.append([m, 2.6, 0.75, "energy"])
		_lit = -1.0
	return _glow_mats[key]

static func _meshes_in(n: Node) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	for c in n.get_children():
		if c is MeshInstance3D:
			out.append(c)
		out.append_array(_meshes_in(c))
	return out

## Bounding box of the meshes under n, in the frame of n's parent.
static func _aabb_of(n: Node3D, xf: Transform3D) -> AABB:
	var t := xf * n.transform
	var box := AABB()
	var first := true
	if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
		box = t * (n as MeshInstance3D).mesh.get_aabb()
		first = false
	for c in n.get_children():
		if c is Node3D:
			var b := _aabb_of(c, t)
			if b.size != Vector3.ZERO:
				box = b if first else box.merge(b)
				first = false
	return box
