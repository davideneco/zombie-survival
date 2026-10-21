extends Node3D
## Rendu de l'arène de test (port visuel de src/world.js buildWorld) : sol, murs, caisses, borne d'achat, lampadaires, ambiance de nuit.
## Lit le plan dans Game.arena (sim/arena.gd) ; aucune règle ici.

const FLOOR_COLOR := Color("4a4d48")
const WALL_COLOR := Color("5a5550")
const CRATE_COLOR := Color("6b4a2b")
const POLE_COLOR := Color("222222")
const BULB_COLOR := Color("ffe9b0")
const LAMP_LIGHT_COLOR := Color("ffd9a0")
const LAMP_RANGE := 28.0
const LAMP_ENERGY := 4.0

func _ready() -> void:
	var a: Arena = Game.arena
	var half := a.half
	# sol : dalles de 4 m avec un joint sombre (texture générée)
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(half * 2.0, half * 2.0)
	floor_mesh.mesh = plane
	floor_mesh.material_override = _tile_material(FLOOR_COLOR, Vector3(half / 2.0, half / 2.0, 1.0), 0.95)
	add_child(floor_mesh)
	# murs d'enceinte
	var wall_t := 1.0
	for w in [[0.0, -half - wall_t / 2.0, half * 2.0 + wall_t * 2.0, wall_t], [0.0, half + wall_t / 2.0, half * 2.0 + wall_t * 2.0, wall_t], [-half - wall_t / 2.0, 0.0, wall_t, half * 2.0], [half + wall_t / 2.0, 0.0, wall_t, half * 2.0]]:
		_box(Vector3(w[0], Arena.WALL_H / 2.0, w[1]), Vector3(w[2], Arena.WALL_H, w[3]), _tile_material(WALL_COLOR, Vector3(maxf(w[2], w[3]) / 4.0, 1.0, 1.0), 0.9))
	# caisses
	for o in a.obstacles:
		_box(Vector3(o[0], o[4] / 2.0, o[1]), Vector3(o[2], o[4], o[3]), _tile_material(CRATE_COLOR, Vector3(maxf(o[2], o[3]) / 2.0, o[4] / 2.0, 1.0), 0.85))
	# borne d'achat de munitions : v0.28.0, the locker itself is drawn by ShopView (shop_models.gd); here, two stacks of ammo crates fill the rest of its
	# 3 m collision box on each side
	var sp := a.station_pos
	var side_len := (Arena.STATION_SIZE.z - 1.3) / 2.0
	for sz in [-1.0, 1.0]:
		for lv in 2:
			_box(Vector3(sp.x, 0.45 + lv * 0.9, sz * (0.65 + side_len / 2.0)), Vector3(Arena.STATION_SIZE.x - 0.05 * lv, 0.88, side_len - 0.04 * lv), ShopModels.mat("pine"))
	var sl := OmniLight3D.new()
	sl.light_color = Color("33ff77")
	sl.omni_range = 8.0
	sl.light_energy = 1.2
	sl.position = Vector3(sp.x + 1.5, 1.5, 0)
	add_child(sl)
	# lampadaires
	for p in a.lamps:
		var pole := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.1
		cyl.bottom_radius = 0.12
		cyl.height = Arena.LAMP_H
		pole.mesh = cyl
		pole.material_override = _flat(POLE_COLOR, 0.7)
		pole.position = Vector3(p.x, Arena.LAMP_H / 2.0, p.z)
		add_child(pole)
		var bulb := MeshInstance3D.new()
		var sph := SphereMesh.new()
		sph.radius = 0.25
		sph.height = 0.5
		bulb.mesh = sph
		var bm := StandardMaterial3D.new()
		bm.albedo_color = BULB_COLOR
		bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		bulb.material_override = bm
		bulb.position = Vector3(p.x, 5.1, p.z)
		add_child(bulb)
		var l := OmniLight3D.new()
		l.light_color = LAMP_LIGHT_COLOR
		l.omni_range = LAMP_RANGE
		l.light_energy = LAMP_ENERGY
		l.shadow_enabled = true
		l.position = Vector3(p.x, 4.9, p.z)
		add_child(l)

func _box(center: Vector3, size: Vector3, mat: Material) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	m.mesh = b
	m.material_override = mat
	m.position = center
	add_child(m)

func _flat(c: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m

## Matériau à joint sombre et grain, répété (rend l'échelle lisible sans fichier de texture).
func _tile_material(c: Color, repeat: Vector3, rough: float) -> StandardMaterial3D:
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 20240611
	for y in 64:
		for x in 64:
			var v := 1.0 + (rng.randf() - 0.5) * 0.16
			if x == 0 or y == 0:
				v = 0.55
			img.set_pixel(x, y, Color(c.r * v, c.g * v, c.b * v))
	img.generate_mipmaps()
	var m := StandardMaterial3D.new()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.uv1_scale = repeat
	m.roughness = rough
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m
