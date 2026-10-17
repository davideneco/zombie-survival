extends Node3D
## Rame de tram (primitives) : 5 modules articulés qui suivent la voie, caisse creuse (plancher, parois à baies vitrées, toit), huit vantaux de portes
## qui coulissent, sièges de l'intérieur, pupitres de cabine, nez demi-ellipsoïdes aux deux bouts. Piloté par un TramSim : chaque module a sa pose
## (x, z, cap) ; l'avant du modèle est vers -Z, la droite vers +X (comme les motos). La livrée détaillée (atlas, sang) et le matériau des vitres
## du JS sont du jalon 9.

const BODY := Color("e7eaee")
const STRIPE := Color("2b6fd8")
const SKIRT := Color("3a3f46")
const ROOF := Color("9aa1a9")
const FLOOR := Color("52483c")
const SEAT := Color("2c4a7a")
const GLASS := Color(0.45, 0.62, 0.72, 0.32)
const DOOR := Color("c9ced4")
const FLOOR_Y := 0.32
const LOW_TOP := 1.15      ## haut du soubassement plein
const GLASS_TOP := 2.95    ## haut des baies vitrées
const ROOF_Y := 3.35
const HALF_W := 1.2

var sim: TramSim
var _mods: Array[Node3D] = []
var _leaves: Array = []     ## [{ node, base: Vector3, dir }] vantaux coulissants
var _prev: Array = []
var _cur: Array = []
var _glass_mat: StandardMaterial3D
var _lamp_mat: StandardMaterial3D

static func _m(color: Color, rough := 0.6, metal := 0.15, emissive := 0.0) -> StandardMaterial3D:
	return VehicleView.mat(color, rough, metal, emissive)

func setup(s: TramSim) -> void:
	sim = s
	_glass_mat = StandardMaterial3D.new()
	_glass_mat.albedo_color = GLASS
	_glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_glass_mat.roughness = 0.1
	_glass_mat.metallic = 0.2
	var line_color := STRIPE
	for ln: Dictionary in Config.at("tram.lines"):
		if ln["id"] == s.line0.id:
			line_color = Color(String(ln["color"]))
	for i in s.n:
		var g := Node3D.new()
		add_child(g)
		_mods.append(g)
		_build_module(g, i, line_color)
	for i in s.n:
		var m: Dictionary = s.mods[i]
		_cur.append(Vector3(m["x"], m["z"], m["yaw"]))
		_prev.append(Vector3(m["x"], m["z"], m["yaw"]))
	apply(1.0)

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

func _build_module(g: Node3D, i: int, line_color: Color) -> void:
	var L := sim.body_len
	var W := sim.width
	var uc := sim.module_u(i)
	var body_m := _m(BODY, 0.45, 0.2)
	var skirt_m := _m(SKIRT, 0.7, 0.3)
	var stripe_m := _m(line_color, 0.4, 0.2)
	var roof_m := _m(ROOF, 0.6, 0.3)
	# plancher, toit, soubassement continu entre les portes
	_box(g, Vector3(W - 0.1, 0.1, L), _m(FLOOR, 0.9, 0.0), Vector3(0, FLOOR_Y - 0.05, 0))
	_box(g, Vector3(W - 0.1, 0.12, L), roof_m, Vector3(0, ROOF_Y - 0.06, 0))
	_box(g, Vector3(W * 0.6, 0.18, L * 0.55), roof_m, Vector3(0, ROOF_Y + 0.07, 0))   # le bloc de climatisation
	_box(g, Vector3(W - 0.2, 0.05, L), _m(Color("d8d8c8"), 0.8, 0.0, 0.9), Vector3(0, ROOF_Y - 0.14, 0))   # plafonnier
	# parois côté gauche (-X) et droit (+X), interrompues devant les portes
	var spans: Array = []
	for sp: Array in sim.interior["spans"]:
		var z0: float = -(float(sp[1]) - uc)
		var z1: float = -(float(sp[0]) - uc)
		if z1 > -L / 2.0 and z0 < L / 2.0:
			spans.append([maxf(z0, -L / 2.0), minf(z1, L / 2.0)])
	spans.sort_custom(func(a, b): return a[0] < b[0])
	for side in [-1.0, 1.0]:
		var cursor := -L / 2.0
		var segs: Array = []
		for sp: Array in spans:
			if sp[0] > cursor:
				segs.append([cursor, sp[0]])
			cursor = sp[1]
		if cursor < L / 2.0:
			segs.append([cursor, L / 2.0])
		for sg: Array in segs:
			_wall(g, side, sg[0], sg[1], body_m, skirt_m, stripe_m)
		# portes : deux vantaux par ouverture
		for sp: Array in spans:
			_door(g, side, sp[0], sp[1])
	# bouts : nez demi-ellipsoïde aux deux extrémités de la rame, soufflet noir entre modules
	var is_front := i == sim.n - 1
	var is_rear := i == 0
	for end in [-1.0, 1.0]:   # -1 : avant (-Z), +1 : arrière (+Z)
		var nose: bool = (end < 0.0 and is_front) or (end > 0.0 and is_rear)
		if nose:
			var sp := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 1.0
			sm.height = 2.0
			sm.radial_segments = 20
			sm.rings = 10
			sp.mesh = sm
			sp.material_override = body_m
			sp.scale = Vector3(W / 2.0, (ROOF_Y - FLOOR_Y) / 2.0, 1.7)
			sp.position = Vector3(0, (ROOF_Y + FLOOR_Y) / 2.0, end * (L / 2.0 - 0.1))
			g.add_child(sp)
			_box(g, Vector3(W * 0.78, 1.0, 0.05), _glass_mat, Vector3(0, 2.1, end * (L / 2.0 + 0.95)), Vector3(end * 0.5, 0, 0))   # pare-brise
			_box(g, Vector3(0.3, 0.12, 0.04), _m(Color("fff3cf"), 0.3, 0.0, 2.0), Vector3(-0.8, 0.85, end * (L / 2.0 + 1.55)))
			_box(g, Vector3(0.3, 0.12, 0.04), _m(Color("fff3cf"), 0.3, 0.0, 2.0), Vector3(0.8, 0.85, end * (L / 2.0 + 1.55)))
			# pupitre du conducteur
			_box(g, Vector3(1.9, 0.5, 0.5), _m(Color("2a2d33"), 0.6, 0.3), Vector3(0, 1.05, end * (L / 2.0 - 1.95 + 0.0)))
		else:
			_box(g, Vector3(W - 0.2, ROOF_Y - FLOOR_Y, 0.18), _m(Color("15171a"), 0.9, 0.0), Vector3(0, (ROOF_Y + FLOOR_Y) / 2.0, end * (L / 2.0 + 0.1)))   # soufflet
	# sièges (assis : coussin et dossier côté paroi) et sièges des conducteurs
	var seat_m := _m(SEAT, 0.8, 0.0)
	var spots: Array = sim.interior["seat_spots"]
	for si in spots.size():
		var sp: Dictionary = spots[si]
		if int(sim.model_seats[si]["module"]) != i:
			continue
		var z: float = -(float(sp["u"]) - uc)
		if bool(sp["driver"]):
			_box(g, Vector3(0.48, 0.1, 0.48), seat_m, Vector3(0, 0.77, z))
			_box(g, Vector3(0.48, 0.55, 0.08), seat_m, Vector3(0, 1.05, z + signf(-float(sp["u"])) * 0.26))
		else:
			var sx: float = float(sp["side"])
			_box(g, Vector3(0.44, 0.1, 0.56), seat_m, Vector3(float(sp["w"]), 0.72, z))
			_box(g, Vector3(0.08, 0.5, 0.56), seat_m, Vector3(float(sp["w"]) + sx * 0.2, 1.0, z))

func _wall(g: Node3D, side: float, z0: float, z1: float, body_m: Material, skirt_m: Material, stripe_m: Material) -> void:
	var len := z1 - z0
	var zc := (z0 + z1) / 2.0
	var x := side * (HALF_W - 0.03)
	_box(g, Vector3(0.1, LOW_TOP - FLOOR_Y, len), skirt_m, Vector3(x, (LOW_TOP + FLOOR_Y) / 2.0, zc))
	_box(g, Vector3(0.11, 0.1, len), stripe_m, Vector3(x + side * 0.005, LOW_TOP + 0.02, zc))
	_box(g, Vector3(0.1, ROOF_Y - GLASS_TOP, len), body_m, Vector3(x, (ROOF_Y + GLASS_TOP) / 2.0, zc))
	_box(g, Vector3(0.04, GLASS_TOP - LOW_TOP - 0.1, len), _glass_mat, Vector3(x, (GLASS_TOP + LOW_TOP) / 2.0, zc))
	# montants entre les baies (tous les 1,4 m)
	var n := maxi(0, int(floor(len / 1.4)))
	for k in range(1, n + 1):
		_box(g, Vector3(0.1, GLASS_TOP - LOW_TOP, 0.07), body_m, Vector3(x, (GLASS_TOP + LOW_TOP) / 2.0, z0 + len * k / float(n + 1)))

func _door(g: Node3D, side: float, z0: float, z1: float) -> void:
	var w := (z1 - z0) / 2.0 - 0.02
	var x := side * (HALF_W - 0.0)
	var m := _m(DOOR, 0.5, 0.3)
	for k in 2:
		var dir := -1.0 if k == 0 else 1.0       # vers l'avant (-Z) ou l'arrière
		var zc := (z0 + z1) / 2.0 + dir * ((z1 - z0) / 4.0)
		var leaf := Node3D.new()
		leaf.position = Vector3(x, 0.0, zc)
		g.add_child(leaf)
		_box(leaf, Vector3(0.05, LOW_TOP + 0.9 - FLOOR_Y, w), m, Vector3(0, (LOW_TOP + 0.9 + FLOOR_Y) / 2.0, 0))
		_box(leaf, Vector3(0.03, 1.15, w - 0.2), _glass_mat, Vector3(side * 0.02, 1.75, 0))
		_leaves.append({"node": leaf, "base": leaf.position, "dir": dir})

# ------------------------------------------------------------------ pose
func remember() -> void:
	for i in sim.n:
		_prev[i] = _cur[i]
		var m: Dictionary = sim.mods[i]
		_cur[i] = Vector3(m["x"], m["z"], m["yaw"])

func _process(_dt: float) -> void:
	if sim != null:
		apply(Engine.get_physics_interpolation_fraction())

func apply(f: float) -> void:
	visible = sim.state != "gone"
	for i in sim.n:
		var a: Vector3 = _prev[i]
		var b: Vector3 = _cur[i]
		_mods[i].position = Vector3(lerpf(a.x, b.x, f), 0.0, lerpf(a.y, b.y, f))
		_mods[i].rotation = Vector3(0, a.z + VehicleSim.ang_diff(b.z, a.z) * f, 0)
	# vantaux : coulissent le long de la caisse (vers le milieu de l'ouverture quand elle s'ouvre : l'un vers l'avant, l'autre vers l'arrière)
	var d := sim.door_f * 0.62
	for L: Dictionary in _leaves:
		var n: Node3D = L["node"]
		n.position = Vector3(L["base"].x, 0.0, L["base"].z + float(L["dir"]) * d)
