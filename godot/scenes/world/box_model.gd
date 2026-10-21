class_name BoxModel
extends RefCounted
## v0.29.0 : the mystery box model (was primitives of machines_view.gd): an old iron-bound chest of dark planks (shop_pbr.gdshader, Poly Haven planks),
## iron straps, brass corners and studs, side handles, brass lock plate and padlock, feet, glowing question marks, a light leaking under the lid and
## the light inside, a domed lid on hinges (half cylinder, banded), an enamel sign on two rods, the light beam and the far blue marker, sparks and
## smoke (GPUParticles3D), the vanishing puff, a plush teddy, and the 23 weapons of the pool as their real models (built once, shown one at a time).
## Size of the JS (machines.js makeMysteryBox: 1.7 x 0.72 x 0.85, the collision box of the map). Local frame: the front looks along +Z.
## Parts are returned in a Dictionary used by machines_view.gd (which only applies BoxAnim.pose).

const WeaponModels := preload("res://scenes/weapon_models.gd")
const W := 1.7
const H := 0.72
const D := 0.85
const BASE := 0.05           ## body bottom (feet below)
const TOP := BASE + H
const GLOW := Color(0.45, 0.75, 1.0)
const RED := Color(1.0, 0.25, 0.18)

static var _mesh: Dictionary = {}
static var _mats: Dictionary = {}

static func _m(key: String) -> Material:
	if _mats.is_empty():
		var wood := ShaderMaterial.new()
		wood.shader = ShopModels.SHADER
		wood.set_shader_parameter("use_maps", true)
		wood.set_shader_parameter("a_tex", ShopModels.WOOD_A)
		wood.set_shader_parameter("m_tex", ShopModels.WOOD_M)
		wood.set_shader_parameter("noise_tex", ShopModels.noise())
		wood.set_shader_parameter("tint", Color(0.36, 0.23, 0.14))
		wood.set_shader_parameter("roughness", 1.0)
		wood.set_shader_parameter("scale", 0.9)
		wood.set_shader_parameter("grime", 0.25)
		wood.set_shader_parameter("grime_color", Color(0.12, 0.09, 0.07))
		_mats["wood"] = wood
		var iron: ShaderMaterial = ShopModels.mat("steel").duplicate()
		iron.set_shader_parameter("tint", Color(0.17, 0.17, 0.18))
		iron.set_shader_parameter("grime", 0.45)
		_mats["iron"] = iron
		_mats["brass"] = ShopModels.mat("brass")
		var inner := StandardMaterial3D.new()
		inner.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		inner.albedo_color = GLOW
		_mats["inner"] = inner
		var leak := StandardMaterial3D.new()
		leak.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		leak.albedo_color = GLOW
		_mats["leak"] = leak
		var dark := StandardMaterial3D.new()
		dark.albedo_color = Color(0.02, 0.02, 0.025)
		_mats["dark"] = dark
		_mats["enamel"] = ShopModels.mat("enamel")
	return _mats[key]

## Half cylinder along X (length len, radius r, height scaled by ys), flat side down at y = 0, open bottom closed by a plate.
static func half_cyl(r: float, len: float, ys: float, seg := 18) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in seg:
		var a0 := PI * float(j) / float(seg)
		var a1 := PI * float(j + 1) / float(seg)
		var p0 := Vector3(0, sin(a0) * r * ys, cos(a0) * r)
		var p1 := Vector3(0, sin(a1) * r * ys, cos(a1) * r)
		var n0 := Vector3(0, sin(a0) / ys, cos(a0)).normalized()
		var n1 := Vector3(0, sin(a1) / ys, cos(a1)).normalized()
		var hx := len / 2.0
		for v in [[p0, n0, -hx], [p1, n1, -hx], [p1, n1, hx], [p0, n0, -hx], [p1, n1, hx], [p0, n0, hx]]:
			st.set_normal(v[1])
			st.add_vertex(Vector3(v[2], v[0].y, v[0].z))
		# end caps
		for sx in [-1.0, 1.0]:
			var c := Vector3(sx * hx, 0, 0)
			var tri: Array = [c, Vector3(sx * hx, p0.y, p0.z), Vector3(sx * hx, p1.y, p1.z)]
			if sx > 0.0:
				tri = [c, tri[2], tri[1]]
			for q: Vector3 in tri:
				st.set_normal(Vector3(sx, 0, 0))
				st.add_vertex(q)
	# bottom plate (seen when the lid is open)
	var hx2 := len / 2.0
	for q in [Vector3(-hx2, 0, -r), Vector3(hx2, 0, r), Vector3(-hx2, 0, r), Vector3(-hx2, 0, -r), Vector3(hx2, 0, -r), Vector3(hx2, 0, r)]:
		st.set_normal(Vector3.DOWN)
		st.add_vertex(q)
	st.index()
	var arr := st.commit_to_arrays()
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	for t in range(0, idx.size(), 3):   # front faces outward (Godot: clockwise seen from the front)
		var tmp := idx[t + 1]
		idx[t + 1] = idx[t + 2]
		idx[t + 2] = tmp
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh

## Static body of the chest (one ArrayMesh, shared by the 19 places).
static func body_mesh() -> ArrayMesh:
	if _mesh.has("body"):
		return _mesh["body"]
	var k := ShopModels.Kit.new()
	k.box("wood", Vector3(W, H, D), Vector3(0, BASE + H / 2.0, 0))
	# iron bands: two straps around the body, a band along the bottom and the top edge
	for sx in [-0.56, 0.56]:
		k.box("iron", Vector3(0.075, H + 0.012, D + 0.02), Vector3(sx, BASE + H / 2.0, 0))
	k.box("iron", Vector3(W + 0.02, 0.06, D + 0.02), Vector3(0, BASE + 0.03, 0))
	k.box("iron", Vector3(W + 0.02, 0.05, D + 0.02), Vector3(0, TOP - 0.025, 0))
	# brass corners and studs
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			for sy in [BASE + 0.045, TOP - 0.045]:
				k.box("brass", Vector3(0.1, 0.1, 0.1), Vector3(sx * (W / 2.0 - 0.04), sy, sz * (D / 2.0 - 0.04)))
			k.box("brass", Vector3(0.045, H - 0.12, 0.045), Vector3(sx * (W / 2.0 - 0.012), BASE + H / 2.0, sz * (D / 2.0 - 0.012)))
	for sx in [-0.56, 0.56]:
		for sz in [-1.0, 1.0]:
			for y in [BASE + 0.16, BASE + 0.36, BASE + 0.56]:
				k.cyl("brass", 0.013, 0.013, 0.012, Vector3(sx, y, sz * (D / 2.0 + 0.014)), Basis(Vector3.RIGHT, PI / 2.0), 8)
	# side handles (iron rings in brackets)
	for sx in [-1.0, 1.0]:
		var hx: float = sx * (W / 2.0 + 0.03)
		k.box("iron", Vector3(0.02, 0.08, 0.26), Vector3(sx * (W / 2.0 + 0.01), BASE + H * 0.62, 0))
		var tor := TorusMesh.new()
		tor.inner_radius = 0.075
		tor.outer_radius = 0.095
		tor.rings = 16
		tor.ring_segments = 8
		k.add("iron", tor, Transform3D(Basis(Vector3.BACK, PI / 2.0), Vector3(hx, BASE + H * 0.62 - 0.07, 0)))
	# lock plate, keyhole and padlock on the front
	k.box("brass", Vector3(0.2, 0.24, 0.015), Vector3(0, TOP - 0.15, D / 2.0 + 0.008))
	k.box("dark", Vector3(0.02, 0.05, 0.004), Vector3(0, TOP - 0.17, D / 2.0 + 0.017))
	k.box("brass", Vector3(0.09, 0.08, 0.035), Vector3(0, TOP - 0.06, D / 2.0 + 0.04))
	var shackle := TorusMesh.new()
	shackle.inner_radius = 0.02
	shackle.outer_radius = 0.03
	shackle.rings = 12
	shackle.ring_segments = 6
	k.add("iron", shackle, Transform3D(Basis(Vector3.RIGHT, PI / 2.0), Vector3(0, TOP - 0.015, D / 2.0 + 0.04)))
	# feet
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			k.box("iron", Vector3(0.14, BASE + 0.01, 0.14), Vector3(sx * (W / 2.0 - 0.1), (BASE + 0.01) / 2.0, sz * (D / 2.0 - 0.1)))
	# inside: dark walls, light at the bottom (seen when the lid is up), light leaking along the seam
	k.box("dark", Vector3(W - 0.08, 0.01, D - 0.08), Vector3(0, TOP - 0.3, 0))
	k.quad("inner", Vector2(W - 0.1, D - 0.1), Vector3(0, TOP - 0.29, 0), Basis(Vector3.RIGHT, -PI / 2.0))
	k.box("leak", Vector3(W + 0.004, 0.008, D + 0.004), Vector3(0, TOP + 0.002, 0))
	var mesh := ArrayMesh.new()
	for key: String in k.st:
		(k.st[key] as SurfaceTool).commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, _m(key))
	_mesh["body"] = mesh
	return mesh

## Lid (hinged at the back top edge: its origin is the hinge line, it closes along +Z).
static func lid_mesh() -> ArrayMesh:
	if _mesh.has("lid"):
		return _mesh["lid"]
	var k := ShopModels.Kit.new()
	var r := D / 2.0
	k.add("wood", half_cyl(r, W, 0.42), Transform3D(Basis.IDENTITY, Vector3(0, 0, r)))
	for sx in [-0.56, 0.0, 0.56]:
		k.add("iron", half_cyl(r + 0.012, 0.075, 0.45, 18), Transform3D(Basis.IDENTITY, Vector3(sx, -0.002, r)))
	for sx in [-1.0, 1.0]:
		k.add("brass", half_cyl(r + 0.016, 0.06, 0.46, 18), Transform3D(Basis.IDENTITY, Vector3(sx * (W / 2.0 - 0.03), -0.003, r)))
	k.box("iron", Vector3(W + 0.02, 0.03, 0.05), Vector3(0, 0.015, 0.02))   # hinge rail
	for sx in [-0.6, 0.6]:
		k.cyl("iron", 0.022, 0.022, 0.16, Vector3(sx, 0.0, -0.005), Basis(Vector3.BACK, PI / 2.0), 10)
	k.box("brass", Vector3(0.08, 0.1, 0.012), Vector3(0, 0.02, D + 0.012))   # hasp
	var mesh := ArrayMesh.new()
	for key: String in k.st:
		(k.st[key] as SurfaceTool).commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, _m(key))
	_mesh["lid"] = mesh
	return mesh

static func teddy() -> Node3D:
	var t := Node3D.new()
	var fur := StandardMaterial3D.new()
	fur.albedo_color = Color(0.62, 0.42, 0.24)
	fur.roughness = 1.0
	fur.rim_enabled = true   # soft plush look
	fur.rim = 0.6
	fur.rim_tint = 0.8
	var light := StandardMaterial3D.new()
	light.albedo_color = Color(0.86, 0.72, 0.52)
	light.roughness = 1.0
	var eye := StandardMaterial3D.new()
	eye.albedo_color = Color(0.02, 0.02, 0.02)
	eye.roughness = 0.1
	var bow := StandardMaterial3D.new()
	bow.albedo_color = Color(0.7, 0.05, 0.06)
	bow.roughness = 0.6
	var parts := [[Vector3(0, 0.0, 0), Vector3(0.24, 0.28, 0.2), fur], [Vector3(0, 0.02, 0.1), Vector3(0.15, 0.18, 0.12), light],
		[Vector3(0, 0.36, 0), Vector3(0.19, 0.18, 0.18), fur], [Vector3(0, 0.33, 0.14), Vector3(0.085, 0.07, 0.07), light],
		[Vector3(-0.14, 0.52, 0), Vector3(0.07, 0.07, 0.04), fur], [Vector3(0.14, 0.52, 0), Vector3(0.07, 0.07, 0.04), fur],
		[Vector3(-0.14, 0.52, 0.025), Vector3(0.04, 0.04, 0.02), light], [Vector3(0.14, 0.52, 0.025), Vector3(0.04, 0.04, 0.02), light],
		[Vector3(-0.07, 0.4, 0.155), Vector3(0.025, 0.025, 0.02), eye], [Vector3(0.07, 0.4, 0.155), Vector3(0.025, 0.025, 0.02), eye],
		[Vector3(0, 0.35, 0.205), Vector3(0.03, 0.022, 0.02), eye],
		[Vector3(-0.25, 0.08, 0.02), Vector3(0.08, 0.15, 0.08), fur], [Vector3(0.25, 0.08, 0.02), Vector3(0.08, 0.15, 0.08), fur],
		[Vector3(-0.13, -0.24, 0.06), Vector3(0.09, 0.1, 0.12), fur], [Vector3(0.13, -0.24, 0.06), Vector3(0.09, 0.1, 0.12), fur],
		[Vector3(-0.13, -0.26, 0.15), Vector3(0.06, 0.06, 0.03), light], [Vector3(0.13, -0.26, 0.15), Vector3(0.06, 0.06, 0.03), light],
		[Vector3(-0.06, 0.2, 0.14), Vector3(0.06, 0.04, 0.03), bow], [Vector3(0.06, 0.2, 0.14), Vector3(0.06, 0.04, 0.03), bow]]
	for p: Array in parts:
		var mi := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = 1.0
		s.height = 2.0
		s.radial_segments = 14
		s.rings = 7
		mi.mesh = s
		mi.material_override = p[2]
		mi.position = p[0]
		mi.scale = p[1]
		t.add_child(mi)
	t.scale = Vector3.ONE * 1.5
	return t

static func _additive(col: Color, a: float, tex: Texture2D = null) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(col.r, col.g, col.b, a)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	if tex != null:
		m.albedo_texture = tex
	return m

static var _soft: GradientTexture2D

## Soft round dot (particles).
static func soft_dot() -> GradientTexture2D:
	if _soft == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		_soft = GradientTexture2D.new()
		_soft.gradient = g
		_soft.fill = GradientTexture2D.FILL_RADIAL
		_soft.fill_from = Vector2(0.5, 0.5)
		_soft.fill_to = Vector2(1.0, 0.5)
		_soft.width = 64
		_soft.height = 64
	return _soft

static func _particles(amount: int, life: float, spark: bool) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.emitting = false
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 7, 6))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(W * 0.42, 0.05, D * 0.4)
	pm.direction = Vector3.UP
	var q := QuadMesh.new()
	var mat: StandardMaterial3D
	if spark:
		pm.spread = 40.0
		pm.initial_velocity_min = 1.6
		pm.initial_velocity_max = 3.6
		pm.gravity = Vector3(0, -5.0, 0)
		pm.scale_min = 0.6
		pm.scale_max = 1.2
		var cr := Gradient.new()
		cr.set_color(0, Color(1.0, 0.95, 0.7, 1.0))
		cr.set_color(1, Color(1.0, 0.45, 0.1, 0.0))
		var ct := GradientTexture1D.new()
		ct.gradient = cr
		pm.color_ramp = ct
		q.size = Vector2(0.045, 0.045)
		mat = _additive(Color(1, 0.85, 0.5), 1.0, soft_dot())
		mat.vertex_color_use_as_albedo = true
	else:
		pm.spread = 25.0
		pm.initial_velocity_min = 0.4
		pm.initial_velocity_max = 1.1
		pm.gravity = Vector3(0, 0.35, 0)
		pm.damping_min = 0.4
		pm.damping_max = 0.8
		pm.scale_min = 0.7
		pm.scale_max = 1.3
		var sc := Curve.new()
		sc.add_point(Vector2(0, 0.35))
		sc.add_point(Vector2(1, 1.0))
		var st := CurveTexture.new()
		st.curve = sc
		pm.scale_curve = st
		var cr2 := Gradient.new()
		cr2.set_color(0, Color(0.42, 0.4, 0.38, 0.0))
		cr2.add_point(0.15, Color(0.42, 0.4, 0.38, 0.55))
		cr2.set_color(cr2.get_point_count() - 1, Color(0.3, 0.3, 0.3, 0.0))
		var ct2 := GradientTexture1D.new()
		ct2.gradient = cr2
		pm.color_ramp = ct2
		pm.angle_min = 0.0
		pm.angle_max = 360.0
		q.size = Vector2(0.9, 0.9)
		mat = StandardMaterial3D.new()
		mat.albedo_texture = soft_dot()
		mat.vertex_color_use_as_albedo = true
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.disable_receive_shadows = true
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	q.material = mat
	p.process_material = pm
	p.draw_pass_1 = q
	return p

## Every node of one box place. Returned keys: node (root, at the place), body (lift / shake / turn / scale), lid (hinge pivot), sign, disp (weapon
## display root), name (Label3D), beam, bmat, far, fmat, teddy, sparks, smoke, poof, marks (question mark labels).
static func build(n: Node3D) -> Dictionary:
	var body := Node3D.new()
	n.add_child(body)
	var bm := MeshInstance3D.new()
	bm.mesh = body_mesh()
	body.add_child(bm)
	var lid := Node3D.new()
	lid.position = Vector3(0, TOP, -D / 2.0)
	body.add_child(lid)
	var lm := MeshInstance3D.new()
	lm.mesh = lid_mesh()
	lid.add_child(lm)
	var marks: Array[Label3D] = []
	for fz in [1.0, -1.0]:
		for x in [-0.3, 0.0, 0.3]:
			var q := ShopModels.label(body, "?", 0.36 if x == 0.0 else 0.3, Vector3(x * fz, BASE + H * 0.38, fz * (D / 2.0 + 0.012)), GLOW)
			q.outline_size = 10
			q.outline_modulate = Color(0.02, 0.05, 0.12, 1)
			q.visibility_range_end = 80.0
			if fz < 0.0:
				q.rotation.y = PI
			marks.append(q)
	# sign on two rods behind the box: « BOÎTE MYSTÈRE / 950 PTS »
	var sign := Node3D.new()
	sign.position = Vector3(0, 1.5, -D / 2.0 + 0.06)
	body.add_child(sign)
	var sk := ShopModels.Kit.new()
	sk.box("brass", Vector3(1.32, 0.42, 0.02), Vector3.ZERO)
	sk.box("enamel", Vector3(1.26, 0.36, 0.02), Vector3(0, 0, 0.006))
	for sx in [-0.5, 0.5]:
		sk.cyl("steel", 0.012, 0.012, 1.5 - TOP + 0.05, Vector3(sx, -(1.5 - TOP) / 2.0 - 0.12, -0.02), Basis.IDENTITY, 8)
	var smi := MeshInstance3D.new()
	smi.mesh = sk.commit()
	sign.add_child(smi)
	var t1 := ShopModels.label(sign, "BOÎTE MYSTÈRE", 0.13, Vector3(0, 0.07, 0.018), Color(0.55, 0.82, 1.0))
	t1.visibility_range_end = 60.0
	var t2 := ShopModels.label(sign, "%d PTS" % int(Config.at("box.price")), 0.1, Vector3(0, -0.09, 0.018), Color(1.0, 0.85, 0.42))
	t2.visibility_range_end = 60.0
	# weapon display and its name
	var disp := Node3D.new()
	disp.visible = false
	body.add_child(disp)
	var name_lbl := ShopModels.label(n, "", 0.16, Vector3(0, 2.25, 0), Color(1.0, 0.88, 0.45), false, 12)
	name_lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	name_lbl.no_depth_test = false
	name_lbl.visibility_range_end = 50.0
	name_lbl.visible = false
	# beam of the draw (cone of light) and the far blue marker (30 m)
	var beam := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.75
	cm.bottom_radius = 0.5
	cm.height = 3.4
	cm.radial_segments = 20
	cm.cap_top = false
	cm.cap_bottom = false
	beam.mesh = cm
	var bmat := _additive(GLOW, 0.1, null)
	var bg := Gradient.new()
	bg.set_color(0, Color(1, 1, 1, 0))
	bg.set_color(1, Color(1, 1, 1, 1))
	var bgt := GradientTexture2D.new()
	bgt.gradient = bg
	bgt.fill_from = Vector2(0.5, 0.0)
	bgt.fill_to = Vector2(0.5, 1.0)
	bgt.width = 4
	bgt.height = 64
	bmat.albedo_texture = bgt
	beam.material_override = bmat
	beam.position = Vector3(0, TOP + 1.7, 0)
	beam.visible = false
	beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(beam)
	var far := MeshInstance3D.new()
	var fc := CylinderMesh.new()
	fc.top_radius = 0.22
	fc.bottom_radius = 0.32
	fc.height = 30.0
	fc.radial_segments = 14
	far.mesh = fc
	var fmat := _additive(Color(0.37, 0.72, 1.0), 0.1)
	far.material_override = fmat
	far.position = Vector3(0, 15.0, 0)
	far.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(far)
	var td := teddy()
	td.visible = false
	body.add_child(td)
	var sparks := _particles(48, 0.9, true)
	sparks.position = Vector3(0, TOP, 0)
	n.add_child(sparks)
	var smoke := _particles(28, 1.7, false)
	smoke.position = Vector3(0, BASE + 0.1, 0)
	n.add_child(smoke)
	var poof := _particles(40, 1.4, false)
	poof.one_shot = true
	poof.explosiveness = 0.95
	(poof.process_material as ParticleProcessMaterial).initial_velocity_min = 1.2
	(poof.process_material as ParticleProcessMaterial).initial_velocity_max = 2.6
	(poof.process_material as ParticleProcessMaterial).spread = 180.0
	poof.position = Vector3(0, TOP, 0)
	n.add_child(poof)
	return {"node": n, "body": body, "lid": lid, "sign": sign, "disp": disp, "name": name_lbl, "beam": beam, "bmat": bmat, "far": far, "fmat": fmat,
		"teddy": td, "sparks": sparks, "smoke": smoke, "poof": poof, "marks": marks, "inner": _m("inner"), "leak": _m("leak")}

## The weapons of the pool as world models (layer 1, lit by the world, no view emission), centred on their middle, scaled to about 1.1 m (pistols
## bigger). Built once (BoxModel.gallery), shown one at a time by machines_view.gd.
static func weapon_model(id: String) -> Node3D:
	var root := Node3D.new()
	if not WeaponModels.has_model(id):
		return root
	var model := WeaponModels.build(id, null)
	var aabb := ShopModels._aabb_of(model, Transform3D.IDENTITY)
	var k := clampf(1.15 / maxf(0.1, aabb.size.z), 1.2, 2.6)
	var holder := Node3D.new()
	holder.rotation.y = -PI / 2.0
	holder.scale = Vector3.ONE * k
	var c := aabb.get_center()
	holder.position = Vector3(c.z * k, -c.y * k, c.x * k)
	holder.add_child(model)
	root.add_child(holder)
	for mi in ShopModels._meshes_in(model):
		mi.layers = 1
		mi.visibility_range_end = 70.0
		for i in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(i) as StandardMaterial3D
			if m != null:
				m.emission_energy_multiplier = 0.12   # a little of the box light on it
				m.metallic = 0.45
				m.roughness = 0.42
	return root
