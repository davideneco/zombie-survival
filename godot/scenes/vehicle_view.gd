class_name VehicleView
extends Node3D
## Modèle d'une moto, d'une grosse moto ou d'un vélo (primitives, d'après src/vehicleModels.js : mêmes dimensions, mêmes sièges). Repère local : l'origine
## est au sol, au milieu de l'empattement ; l'avant est vers -Z, la droite vers +X. Piloté par un VehicleSim : position, cap, inclinaison, guidon, roues,
## épave (matériau noir, couchée sur le flanc), fumée et flammes selon les PV. Les modèles `.glb` et les matériaux réfléchissants sont du jalon 9.

const WRECK_COLOR := Color("0d0d0f")
const VELO_COLORS := [0x2f6fb3, 0xb3392f, 0x2f9a6a, 0xe0a82e, 0x7b4fa8, 0xd9dbe0, 0xe0742e, 0x2a8fa8]

static var _mats: Dictionary = {}

var sim: VehicleSim
var _steer: Node3D
var _wheels: Array[Node3D] = []
var _crank: Node3D
var _crank_ratio := 0.5
var _root: Node3D
var _tail: MeshInstance3D
var _lamp: MeshInstance3D
var _smoke: CPUParticles3D
var _fire: CPUParticles3D
var _wreck_look := false
var _prev := Vector3.ZERO     ## x, z, yaw au pas précédent (interpolation)
var _cur := Vector3.ZERO
var _lean_prev := 0.0

static func mat(color: Color, rough := 0.6, metal := 0.2, emissive := 0.0) -> StandardMaterial3D:
	var key := "%s|%.2f|%.2f|%.2f" % [color.to_html(), rough, metal, emissive]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	if emissive > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emissive
	_mats[key] = m
	return m

func setup(s: VehicleSim) -> void:
	sim = s
	_root = Node3D.new()
	add_child(_root)
	match s.type:
		"moto":
			_build_moto()
		"grosseMoto":
			_build_grosse_moto()
		_:
			_build_velo(s.variant)
	if bool(s.def.get("fx", true)):
		_make_fx()
	remember()
	_cur = _prev
	apply(1.0)

# ------------------------------------------------------------------ primitives
func _box(parent: Node3D, size: Vector3, m: Material, pos := Vector3.ZERO, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = m
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi

func _ball(parent: Node3D, scl: Vector3, m: Material, pos := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var sp := SphereMesh.new()
	sp.radius = 1.0
	sp.height = 2.0
	sp.radial_segments = 14
	sp.rings = 8
	mi.mesh = sp
	mi.scale = scl
	mi.material_override = m
	mi.position = pos
	parent.add_child(mi)
	return mi

func _tube(parent: Node3D, a: Vector3, b: Vector3, r: float, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var c := CylinderMesh.new()
	var d := a.distance_to(b)
	c.top_radius = r
	c.bottom_radius = r
	c.height = d
	c.radial_segments = 8
	c.rings = 1
	mi.mesh = c
	mi.material_override = m
	mi.position = (a + b) / 2.0
	var dir := (b - a).normalized()
	var axis := Vector3.UP.cross(dir)
	if axis.length() > 1e-6:
		mi.basis = Basis(axis.normalized(), Vector3.UP.angle_to(dir))
	elif dir.y < 0.0:
		mi.rotation = Vector3(PI, 0, 0)
	parent.add_child(mi)
	return mi

## Roue : pneu (tore), jante, rayons ; axe de rotation x. Renvoie le nœud qui tourne.
func _wheel(R: float, tire_r: float, width: float, rim: Material, spokes := 6) -> Node3D:
	var w := Node3D.new()
	var tire := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = R - tire_r * 2.0
	tm.outer_radius = R
	tm.rings = 24
	tm.ring_segments = 8
	tire.mesh = tm
	tire.material_override = mat(Color("0c0c0e"), 0.92, 0.0)
	tire.rotation = Vector3(0, 0, PI / 2.0)
	tire.scale = Vector3(1.0, width / (tire_r * 2.0), 1.0)   # (l'axe du tore est Y avant rotation : Y devient X, donc la largeur est l'échelle Y)
	w.add_child(tire)
	var rim_r := R - tire_r * 1.7
	for k in spokes:
		_box(w, Vector3(0.02, rim_r * 2.0, 0.024 - k * 0.0005), rim, Vector3.ZERO, Vector3(k * PI / spokes, 0, 0))
	var hub := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.05
	cm.bottom_radius = 0.05
	cm.height = width * 0.7
	hub.mesh = cm
	hub.material_override = mat(Color("1d2025"), 0.6, 0.4)
	hub.rotation = Vector3(0, 0, PI / 2.0)
	w.add_child(hub)
	_box(w, Vector3(0.05, 0.03, 0.03), mat(Color("ff2020"), 0.4, 0.0, 1.0), Vector3(0, rim_r, 0))   # valve rouge : on voit la roue tourner
	return w

# ------------------------------------------------------------------ modèles
func _build_moto() -> void:
	var steel := mat(Color("1d2025"), 0.6, 0.4)
	var black := mat(Color("15161a"), 0.55, 0.3)
	var chrome := mat(Color("c4c9d1"), 0.2, 0.85)
	var rubber := mat(Color("0c0c0e"), 0.92, 0.0)
	var seat := mat(Color("20170f"), 0.8, 0.05)
	var paint := mat(Color("b3261e"), 0.32, 0.45)
	var R := 0.31
	var wb := 1.35
	var rear := _wheel(R, 0.078, 0.17, steel)
	rear.position = Vector3(0, R, wb / 2.0)
	_root.add_child(rear)
	_wheels.append(rear)
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.09, 0.4, 0.1), Vector3(sx * 0.1, R, wb / 2.0), 0.024, steel)
	_box(_root, Vector3(0.3, 0.3, 0.44), steel, Vector3(0, 0.42, 0.04))
	_box(_root, Vector3(0.24, 0.17, 0.22), black, Vector3(0, 0.6, -0.1), Vector3(-0.35, 0, 0))
	_tube(_root, Vector3(0.15, 0.3, -0.22), Vector3(0.18, 0.28, 0.45), 0.036, chrome)
	_tube(_root, Vector3(0.18, 0.3, 0.3), Vector3(0.2, 0.42, 0.86), 0.055, steel)
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.1, 0.84, -0.36), Vector3(sx * 0.1, 0.44, 0.16), 0.024, steel)
		_tube(_root, Vector3(sx * 0.09, 0.84, -0.3), Vector3(sx * 0.09, 0.3, -0.1), 0.02, steel)
		_tube(_root, Vector3(sx * 0.09, 0.62, 0.16), Vector3(sx * 0.09, 0.74, 0.62), 0.02, steel)
		_box(_root, Vector3(0.04, 0.025, 0.12), steel, Vector3(sx * 0.24, 0.3, 0.12))
	_ball(_root, Vector3(0.2, 0.15, 0.34), paint, Vector3(0, 0.8, -0.14))
	_box(_root, Vector3(0.21, 0.07, 0.5), seat, Vector3(0, 0.76, 0.3))
	_box(_root, Vector3(0.18, 0.09, 0.36), paint, Vector3(0, 0.82, 0.72), Vector3(-0.2, 0, 0))
	_tail = _box(_root, Vector3(0.14, 0.05, 0.04), mat(Color("661111"), 0.4, 0.0, 1.6), Vector3(0, 0.84, 0.92))
	_box(_root, Vector3(0.16, 0.02, 0.4), black, Vector3(0, 0.58, 0.82), Vector3(0.18, 0, 0))
	# fourche + guidon + roue avant (tournent ensemble)
	var rake := 0.46
	var L := 0.62
	var tilt := Node3D.new()
	tilt.position = Vector3(0, R + L * cos(rake), -wb / 2.0 + L * sin(rake))
	tilt.rotation = Vector3(rake, 0, 0)
	_root.add_child(tilt)
	_steer = Node3D.new()
	tilt.add_child(_steer)
	for sx in [-1.0, 1.0]:
		_tube(_steer, Vector3(sx * 0.1, 0.04, 0), Vector3(sx * 0.1, -L, 0), 0.024, chrome)
		_tube(_steer, Vector3(sx * 0.1, 0.0, 0), Vector3(sx * 0.1, -0.28, 0), 0.032, steel)
	var front := _wheel(R, 0.074, 0.14, steel)
	front.position = Vector3(0, -L, 0)
	_steer.add_child(front)
	_wheels.append(front)
	_box(_steer, Vector3(0.15, 0.02, 0.42), paint, Vector3(0, -L + R + 0.07, -0.02), Vector3(0.1, 0, 0))
	_tube(_steer, Vector3(-0.34, 0.12, 0.06), Vector3(0.34, 0.12, 0.06), 0.016, black)
	for sx in [-1.0, 1.0]:
		_tube(_steer, Vector3(sx * 0.34, 0.12, 0.06), Vector3(sx * 0.38, 0.12, 0.06), 0.022, rubber)
	_ball(_steer, Vector3(0.12, 0.12, 0.1), black, Vector3(0, 0.02, -0.12))
	_lamp = _ball(_steer, Vector3(0.085, 0.085, 0.05), mat(Color("fff1c9"), 0.3, 0.0, 2.2), Vector3(0, 0.02, -0.2))
	_box(_steer, Vector3(0.2, 0.2, 0.03), paint, Vector3(0, 0.2, -0.1), Vector3(-0.5, 0, 0))

func _build_grosse_moto() -> void:
	var steel := mat(Color("1d2025"), 0.6, 0.4)
	var black := mat(Color("15161a"), 0.55, 0.3)
	var chrome := mat(Color("c4c9d1"), 0.2, 0.85)
	var rubber := mat(Color("0c0c0e"), 0.92, 0.0)
	var seat := mat(Color("20170f"), 0.8, 0.05)
	var paint := mat(Color("3b4a2c"), 0.5, 0.35)
	var bag := mat(Color("1c1d19"), 0.7, 0.2)
	var R := 0.36
	var wb := 1.75
	var rear := _wheel(R, 0.1, 0.24, chrome)
	rear.position = Vector3(0, R, wb / 2.0)
	_root.add_child(rear)
	_wheels.append(rear)
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.13, 0.42, 0.12), Vector3(sx * 0.14, R, wb / 2.0), 0.03, chrome)
	_box(_root, Vector3(0.36, 0.34, 0.5), steel, Vector3(0, 0.44, 0.1))
	for e in [[-0.06, -0.62], [0.2, 0.62]]:
		var cyl := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.085
		cm.bottom_radius = 0.085
		cm.height = 0.3
		cyl.mesh = cm
		cyl.material_override = chrome
		cyl.position = Vector3(0, 0.68, e[0])
		cyl.rotation = Vector3(e[1], 0, 0)
		_root.add_child(cyl)
	for e in [[0.3, -0.25, 0.95], [0.4, -0.18, 0.98]]:
		_tube(_root, Vector3(0.27, e[0], e[1]), Vector3(0.3, e[0], e[2]), 0.046, chrome)
		_tube(_root, Vector3(0.3, e[0], e[2] - 0.2), Vector3(0.3, e[0], e[2] + 0.02), 0.06, chrome)
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.12, 0.92, -0.42), Vector3(sx * 0.12, 0.46, 0.2), 0.03, steel)
		_tube(_root, Vector3(sx * 0.11, 0.7, 0.2), Vector3(sx * 0.11, 0.78, 0.9), 0.026, steel)
		_box(_root, Vector3(0.5, 0.03, 0.2), black, Vector3(sx * 0.3, 0.26, 0.16))
	_ball(_root, Vector3(0.24, 0.19, 0.4), paint, Vector3(0, 0.9, -0.2))
	_box(_root, Vector3(0.34, 0.08, 0.5), seat, Vector3(0, 0.8, 0.12))
	_box(_root, Vector3(0.3, 0.07, 0.42), seat, Vector3(0, 0.86, 0.7), Vector3(-0.06, 0, 0))
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.15, 0.88, 0.95), Vector3(sx * 0.15, 1.22, 1.02), 0.016, chrome)
		_box(_root, Vector3(0.16, 0.28, 0.58), bag, Vector3(sx * 0.31, 0.6, 0.88))
	_box(_root, Vector3(0.34, 0.16, 0.05), seat, Vector3(0, 1.2, 1.04))
	_box(_root, Vector3(0.26, 0.025, 0.7), paint, Vector3(0, 0.7, 0.9), Vector3(0.1, 0, 0))
	_tail = _box(_root, Vector3(0.2, 0.06, 0.04), mat(Color("661111"), 0.4, 0.0, 1.6), Vector3(0, 0.78, 1.28))
	var rake := 0.6
	var L := 0.8
	var tilt := Node3D.new()
	tilt.position = Vector3(0, R + L * cos(rake), -wb / 2.0 + L * sin(rake))
	tilt.rotation = Vector3(rake, 0, 0)
	_root.add_child(tilt)
	_steer = Node3D.new()
	tilt.add_child(_steer)
	for sx in [-1.0, 1.0]:
		_tube(_steer, Vector3(sx * 0.12, 0.05, 0), Vector3(sx * 0.12, -L, 0), 0.03, chrome)
		_tube(_steer, Vector3(sx * 0.12, 0.0, 0), Vector3(sx * 0.12, -0.36, 0), 0.042, chrome)
	var front := _wheel(R, 0.09, 0.19, chrome)
	front.position = Vector3(0, -L, 0)
	_steer.add_child(front)
	_wheels.append(front)
	_box(_steer, Vector3(0.2, 0.025, 0.5), paint, Vector3(0, -L + R + 0.09, 0), Vector3(0.1, 0, 0))
	for sx in [-1.0, 1.0]:   # guidon « ape hanger »
		_tube(_steer, Vector3(sx * 0.06, 0.1, 0.02), Vector3(sx * 0.34, 0.22, 0.12), 0.018, chrome)
		_tube(_steer, Vector3(sx * 0.34, 0.22, 0.12), Vector3(sx * 0.44, 0.46, 0.2), 0.018, chrome)
		_tube(_steer, Vector3(sx * 0.44, 0.46, 0.2), Vector3(sx * 0.46, 0.46, 0.28), 0.024, rubber)
	_ball(_steer, Vector3(0.16, 0.16, 0.12), chrome, Vector3(0, 0.06, -0.15))
	_lamp = _ball(_steer, Vector3(0.11, 0.11, 0.05), mat(Color("fff1c9"), 0.3, 0.0, 2.2), Vector3(0, 0.06, -0.25))
	var screen := mat(Color(0.62, 0.7, 0.77, 0.35), 0.1, 0.1)
	screen.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_box(_steer, Vector3(0.3, 0.26, 0.02), screen, Vector3(0, 0.34, -0.12), Vector3(-0.35, 0, 0))

func _build_velo(variant: int) -> void:
	var paint := mat(Color.hex((int(VELO_COLORS[absi(variant) % VELO_COLORS.size()]) << 8) | 0xff), 0.5, 0.35)
	var dark := mat(Color("24262a"), 0.5, 0.4)
	var chrome := mat(Color("c4c9d1"), 0.2, 0.85)
	var rubber := mat(Color("111214"), 0.9, 0.0)
	var seat := mat(Color("1a1a1c"), 0.8, 0.05)
	var R := 0.34
	var wb := 1.05
	var bb := Vector3(0, 0.3, 0.1)
	var st := Vector3(0, 0.79, 0.225)
	var rear := _wheel(R, 0.028, 0.045, mat(Color("b8bec6"), 0.3, 0.8), 8)
	rear.position = Vector3(0, R, wb / 2.0)
	_root.add_child(rear)
	_wheels.append(rear)
	_tube(_root, Vector3(0, 0.722, -0.407), Vector3(0, 0.865, -0.363), 0.024, paint)
	_tube(_root, Vector3(0, 0.835, -0.368), st, 0.018, paint)
	_tube(_root, Vector3(0, 0.75, -0.4), bb, 0.022, paint)
	_tube(_root, bb, st, 0.018, paint)
	_tube(_root, st, Vector3(0, 0.88, 0.248), 0.014, chrome)
	_box(_root, Vector3(0.13, 0.045, 0.25), seat, Vector3(0, 0.905, 0.265))
	_box(_root, Vector3(0.07, 0.04, 0.12), seat, Vector3(0, 0.905, 0.15))
	_box(_root, Vector3(0.045, 0.045, 0.015), mat(Color("d02828"), 0.5, 0.0, 0.6), Vector3(0, 0.62, 0.575))
	for sx in [-1.0, 1.0]:
		_tube(_root, Vector3(sx * 0.03, 0.77, 0.225), Vector3(sx * 0.055, 0.34, 0.525), 0.011, paint)
		_tube(_root, Vector3(sx * 0.035, 0.3, 0.1), Vector3(sx * 0.055, 0.34, 0.525), 0.012, paint)
	_crank = Node3D.new()
	_crank.position = Vector3(0, 0.3, 0.1)
	_root.add_child(_crank)
	_box(_crank, Vector3(0.006, 0.17, 0.17), dark, Vector3(0.045, 0, 0))
	_box(_crank, Vector3(0.012, 0.17, 0.025), mat(Color("9aa0a8")), Vector3(0.07, -0.085, 0))
	_box(_crank, Vector3(0.012, 0.17, 0.025), mat(Color("9aa0a8")), Vector3(-0.07, 0.085, 0))
	_box(_crank, Vector3(0.09, 0.015, 0.07), rubber, Vector3(0.105, -0.17, 0))
	_box(_crank, Vector3(0.09, 0.015, 0.07), rubber, Vector3(-0.105, 0.17, 0))
	var tilt := Node3D.new()
	tilt.position = Vector3(0, 0.722, -0.407)
	tilt.rotation = Vector3(0.3, 0, 0)
	_root.add_child(tilt)
	_steer = Node3D.new()
	tilt.add_child(_steer)
	for sx in [-1.0, 1.0]:
		_tube(_steer, Vector3(sx * 0.045, -0.02, 0), Vector3(sx * 0.045, -0.4, 0), 0.013, dark)
		_tube(_steer, Vector3(sx * 0.31, 0.29, -0.12), Vector3(sx * 0.4, 0.29, -0.17), 0.017, rubber)
	_box(_steer, Vector3(0.12, 0.022, 0.03), dark, Vector3(0, -0.01, 0))
	_tube(_steer, Vector3(0, -0.01, 0), Vector3(0, 0.3, 0), 0.012, chrome)
	_tube(_steer, Vector3(-0.31, 0.29, -0.12), Vector3(0.31, 0.29, -0.12), 0.011, chrome)
	var front := _wheel(R, 0.028, 0.045, mat(Color("b8bec6"), 0.3, 0.8), 8)
	front.position = Vector3(0, -0.4, 0)
	_steer.add_child(front)
	_wheels.append(front)

func _make_fx() -> void:
	_smoke = CPUParticles3D.new()
	_smoke.amount = 40
	_smoke.lifetime = 1.8
	_smoke.emitting = false
	_smoke.direction = Vector3.UP
	_smoke.spread = 18.0
	_smoke.initial_velocity_min = 0.6
	_smoke.initial_velocity_max = 1.2
	_smoke.gravity = Vector3(0, 0.25, 0)
	_smoke.scale_amount_min = 0.7
	_smoke.scale_amount_max = 1.4
	var sm := SphereMesh.new()
	sm.radius = 0.16
	sm.height = 0.32
	sm.radial_segments = 8
	sm.rings = 4
	var smat := StandardMaterial3D.new()
	smat.albedo_color = Color(0.25, 0.26, 0.28, 0.55)
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.material = smat
	_smoke.mesh = sm
	_smoke.position = Vector3(0, 0.7, 0.05)
	add_child(_smoke)
	_fire = CPUParticles3D.new()
	_fire.amount = 40
	_fire.lifetime = 0.6
	_fire.emitting = false
	_fire.direction = Vector3.UP
	_fire.spread = 25.0
	_fire.initial_velocity_min = 1.2
	_fire.initial_velocity_max = 2.4
	_fire.gravity = Vector3(0, 1.0, 0)
	var fm := SphereMesh.new()
	fm.radius = 0.1
	fm.height = 0.2
	fm.radial_segments = 6
	fm.rings = 3
	var fmat := StandardMaterial3D.new()
	fmat.albedo_color = Color(1.0, 0.5, 0.1)
	fmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.material = fmat
	_fire.mesh = fm
	_fire.position = Vector3(0, 0.62, 0.05)
	add_child(_fire)

# ------------------------------------------------------------------ pose
## À appeler avant chaque pas de simulation : mémorise la pose pour l'interpolation.
func remember() -> void:
	_prev = _cur
	_cur = Vector3(sim.x, sim.z, sim.yaw)

func _process(_dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(_dt)
	PerfLog.add(&"vehicule", _pt)

func _tick(_dt: float) -> void:
	if sim == null:
		return
	apply(Engine.get_physics_interpolation_fraction())

func apply(f: float) -> void:
	var x := lerpf(_prev.x, _cur.x, f)
	var z := lerpf(_prev.y, _cur.y, f)
	var yaw := _prev.z + VehicleSim.ang_diff(_cur.z, _prev.z) * f
	var d := sim.def
	visible = sim.state != "gone"
	if sim.state == "wreck":
		position = Vector3(x, float(d.get("wreckLift", 0.45)), z)
		rotation = Vector3(0, yaw, (1.5 if sim.id % 2 != 0 else -1.5))
		_wreck(true)
	else:
		_wreck(false)
		position = Vector3(x, 0, z)
		rotation = Vector3(0, yaw, sim.lean)
		if _steer != null:
			_steer.rotation.y = -sim.steer_angle
		for w in _wheels:
			w.rotation.x = -sim.wheel_rot
		if _crank != null:
			_crank.rotation.x = -sim.wheel_rot * _crank_ratio
	_update_fx()

var _orig_mats: Dictionary = {}

func _wreck(on: bool) -> void:
	if on == _wreck_look:
		return
	_wreck_look = on
	var m := mat(WRECK_COLOR, 0.95, 0.1)
	var stack: Array[Node] = [_root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		for c in n.get_children():
			stack.append(c)
		if n is MeshInstance3D:
			var mi := n as MeshInstance3D
			if on:
				_orig_mats[mi] = mi.material_override
				mi.material_override = m
			elif _orig_mats.has(mi):
				mi.material_override = _orig_mats[mi]

## Fumée grise sous 50 % des PV, noire sous 25 %, flammèches sous 10 % ; flammes pendant l'incendie, fumée noire de l'épave.
func _update_fx() -> void:
	if _smoke == null:
		return
	var D: Dictionary = Config.at("vehicles.damage.smoke")
	var grey := false
	var black := false
	var flame := false
	if sim.state == "ok":
		var fr := sim.hp_frac()
		black = fr < float(D["black"]["below"])
		grey = fr < float(D["grey"]["below"]) and not black
		flame = fr < float(D["flames"]["below"])
	elif sim.state == "burning":
		black = true
		flame = true
	elif sim.state == "wreck":
		black = true
		flame = sim.wreck_t > float(Config.at("vehicles.damage.wreckTime")) - 8.0
	_smoke.emitting = (grey or black) and global_position.distance_to(get_viewport().get_camera_3d().global_position) < 70.0 if get_viewport().get_camera_3d() != null else false
	(_smoke.mesh.material as StandardMaterial3D).albedo_color = Color(0.12, 0.12, 0.13, 0.65) if black else Color(0.42, 0.43, 0.45, 0.5)
	_fire.emitting = flame and _smoke.emitting
	if sim.state == "wreck":
		_smoke.position = Vector3(0, 0.4, 0.05)
		_fire.position = Vector3(0, 0.4, 0.05)
