extends Node3D
## L'Ange du Jugement (src/angel.js _buildBody / _pose) en primitives : robe, buste, tête et cheveux d'or, auréole, bras dont le droit tient la trompette,
## deux ailes de neuf plumes, halo dans le dos. Piloté par un AngelSim (angles de pose calculés par la simulation). Mêmes noms de membres que le JS.

var sim: AngelSim
var _prev_pos := Vector3.ZERO
var _rig: Node3D
var _sh: Array[Node3D] = []
var _el: Array[Node3D] = []
var _wings: Array[Node3D] = []
var _halo: MeshInstance3D
var _bell_glow: MeshInstance3D
var _back_glow: MeshInstance3D
var _mats: Array[StandardMaterial3D] = []
var _flash := 0.0
var _last_hp := 0.0

func setup(a: AngelSim) -> void:
	sim = a
	_prev_pos = a.pos
	position = a.pos
	_last_hp = a.health
	scale = Vector3.ONE * a.scale_override
	_rig = Node3D.new()
	add_child(_rig)
	var white := _mat(Color("f4f0e6"), 0.55, Color("7a6e50"))
	var gold := _mat(Color("f0c040"), 0.3, Color("7a5410"))
	gold.metallic = 0.8
	var skin := _mat(Color("f2d2b0"), 0.6, Color("3a2a1a"))
	var glow := StandardMaterial3D.new()
	glow.albedo_color = Color(1.0, 0.91, 0.63, 0.55)
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glow.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	glow.cull_mode = BaseMaterial3D.CULL_DISABLED
	glow.no_depth_test = false
	# robe, taille, torse
	var robe := CylinderMesh.new()
	robe.top_radius = 0.21
	robe.bottom_radius = 0.48
	robe.height = 1.15
	robe.cap_top = false
	robe.cap_bottom = false
	_add(robe, white, _rig, Vector3(0, 0.58, 0))
	var belt := TorusMesh.new()
	belt.inner_radius = 0.445
	belt.outer_radius = 0.495
	_add(belt, gold, _rig, Vector3(0, 0.04, 0))
	var torso := CylinderMesh.new()
	torso.top_radius = 0.2
	torso.bottom_radius = 0.23
	torso.height = 0.55
	_add(torso, white, _rig, Vector3(0, 1.38, 0))
	var head := Node3D.new()
	head.position = Vector3(0, 1.74, 0.01)
	_rig.add_child(head)
	var hs := SphereMesh.new()
	hs.radius = 0.15
	hs.height = 0.3
	_add(hs, skin, head, Vector3.ZERO)
	var hair := SphereMesh.new()
	hair.radius = 0.162
	hair.height = 0.324
	hair.is_hemisphere = false
	_add(hair, gold, head, Vector3(0, 0.03, -0.015), Vector3(1, 0.8, 1.05))
	for sx in [-1.0, 1.0]:
		var eye := SphereMesh.new()
		eye.radius = 0.018
		eye.height = 0.036
		var em := StandardMaterial3D.new()
		em.albedo_color = Color("bfe6ff")
		em.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_add(eye, em, head, Vector3(sx * 0.055, 0.02, 0.135))
	var ht := TorusMesh.new()
	ht.inner_radius = 0.208
	ht.outer_radius = 0.252
	_halo = _add(ht, glow, head, Vector3(0, 0.3, 0))
	# bras : épaule -> avant-bras -> main ; le droit tient la trompette
	for side in [1.0, -1.0]:
		var sh := Node3D.new()
		sh.position = Vector3(side * 0.27, 1.55, 0)
		_rig.add_child(sh)
		var up := CylinderMesh.new()
		up.top_radius = 0.055
		up.bottom_radius = 0.045
		up.height = 0.3
		_add(up, white, sh, Vector3(0, -0.15, 0))
		var el := Node3D.new()
		el.position.y = -0.3
		sh.add_child(el)
		var fo := CylinderMesh.new()
		fo.top_radius = 0.045
		fo.bottom_radius = 0.04
		fo.height = 0.3
		_add(fo, white, el, Vector3(0, -0.15, 0))
		var hand := Node3D.new()
		hand.position.y = -0.31
		el.add_child(hand)
		var hm := SphereMesh.new()
		hm.radius = 0.05
		hm.height = 0.1
		_add(hm, white, hand, Vector3.ZERO)
		_sh.append(sh)
		_el.append(el)
		if side > 0.0:
			var tr := Node3D.new()
			tr.rotation.x = 0.1
			hand.add_child(tr)
			var tube := CylinderMesh.new()
			tube.top_radius = 0.026
			tube.bottom_radius = 0.026
			tube.height = 0.66
			_add(tube, gold, tr, Vector3(0, -0.33, 0))
			var bell := CylinderMesh.new()
			bell.top_radius = 0.03
			bell.bottom_radius = 0.2
			bell.height = 0.3
			bell.cap_top = false
			bell.cap_bottom = false
			var bm := gold.duplicate() as StandardMaterial3D
			bm.cull_mode = BaseMaterial3D.CULL_DISABLED
			_add(bell, bm, tr, Vector3(0, -0.77, 0))
			var bg := QuadMesh.new()
			bg.size = Vector2(0.38, 0.38)
			_bell_glow = _add(bg, glow.duplicate(), tr, Vector3(0, -0.93, 0))
			_bell_glow.rotation.x = PI / 2.0
			_bell_glow.visible = false
	# ailes : neuf plumes en éventail par aile
	for sx in [1.0, -1.0]:
		var w := Node3D.new()
		w.position = Vector3(sx * 0.1, 1.55, -0.1)
		_rig.add_child(w)
		var inner := Node3D.new()
		inner.scale.x = sx
		w.add_child(inner)
		for i in 9:
			var ang := -0.3 + (i / 8.0) * 1.7
			var L := 1.35 - i * 0.075 - (0.1 if i > 6 else 0.0)
			var q := QuadMesh.new()
			q.size = Vector2(0.2, L)
			var m := white if i % 2 == 0 else gold.duplicate()
			var f := _add(q, m, inner, Vector3(cos(ang) * L / 2.0, sin(ang) * L / 2.0, -0.004 * i))
			f.rotation.z = ang - PI / 2.0
			(f.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
		_wings.append(w)
	var bgm := QuadMesh.new()
	bgm.size = Vector2(1.8, 1.8)
	_back_glow = _add(bgm, glow.duplicate(), _rig, Vector3(0, 1.5, -0.32))

func _mat(c: Color, rough: float, emis: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.emission_enabled = true
	m.emission = emis
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mats.append(m)
	return m

func _add(mesh: Mesh, mat: Material, parent: Node3D, p: Vector3, sc := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = p
	mi.scale = sc
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi

func remember() -> void:
	_prev_pos = sim.pos

func _process(dt: float) -> void:
	var a := sim
	var f := Engine.get_physics_interpolation_fraction()
	position = _prev_pos.lerp(a.pos, f)
	rotation = Vector3(0.0, a.yaw, 0.0)
	if a.dead:   # il retombe en poussière d'or : monte et rétrécit en tournant
		position.y += a.death_rise * 1.2
		_rig.scale = Vector3.ONE * maxf(0.01, 1.0 - a.death_rise * 0.25)
		rotation.y += a.death_rise * 1.5
		visible = a.death_rise < 2.5
		return
	if a.health < _last_hp:
		_flash = 0.1
	_last_hp = a.health
	_flash = maxf(0.0, _flash - dt)
	for m in _mats:
		m.emission = Color("884400") if _flash > 0.0 else m.emission
	_sh[0].rotation = Vector3(a.arm_r_x, 0, a.arm_r_z)
	_sh[1].rotation = Vector3(a.arm_l_x, 0, a.arm_l_z)
	_el[0].rotation.x = a.el_r_x
	_el[1].rotation.x = a.el_l_x
	for i in 2:
		var s := 1.0 if i == 0 else -1.0
		_wings[i].rotation = Vector3(0, s * (0.35 + a.spread * 0.7 + a.flap * 0.25), s * (0.2 + a.flap))
	_halo.scale = Vector3.ONE * a.halo_k
	_halo.rotation.z = a.t_life * 1.5
	_bell_glow.visible = a.trumpet_glow > 0.0
	(_bell_glow.material_override as StandardMaterial3D).albedo_color.a = a.trumpet_glow * 0.7
	(_back_glow.material_override as StandardMaterial3D).albedo_color.a = 0.16 + (0.18 if (a.bs >= 20 and a.bs < 25) else 0.0) + 0.05 * sin(a.t_life * 2.2)
	_rig.position.y = a.rig_y
