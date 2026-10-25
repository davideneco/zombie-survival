extends Node3D
## v0.37.0 : vue du banc d'essai des véhicules (carte "vehicules") : sol, anneau, ligne droite, mur de crash, hangar, rampes, bosses, colline, boue,
## glace, voie du tram, lampadaires, panneaux et plots (suivis depuis Game.lab). Lit le plan de VehicleLab ; aucune règle ici.

signal progress(frac: float)

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const COLORS := {"grass": Color("4d5a3a"), "asphalt": Color("3a3c3f"), "concrete": Color("8d8a84"), "white": Color("e8e8e0"), "black": Color("161616"),
	"yellow": Color("e0b020"), "mud": Color("4a3522"), "ice": Color("bfe3f2"), "metal": Color("6f7a80"), "roof": Color("4c5358"), "rail": Color("8a8f94"),
	"sleeper": Color("4a3a2c"), "ballast": Color("6b655c"), "red": Color("c0392b"), "floor": Color("6e6c68")}
const LAMP_ENERGY := 3.0

var _g: Dictionary = {}
var _cones: Array = []
var _lamps: Array[OmniLight3D] = []
var _inside: Array[OmniLight3D] = []
var _bulb_mat: StandardMaterial3D
var built := false
var triangle_count := 0

func g(key: String) -> GeoBuilder:
	if not _g.has(key):
		_g[key] = GeoBuilder.new()
	return _g[key]

func _mat(key: String) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = COLORS[key]
	m.roughness = 0.08 if key == "ice" else (0.45 if key in ["metal", "rail"] else 0.9)
	m.metallic = 0.6 if key in ["metal", "rail"] else 0.0
	if key == "ice":
		m.metallic_specular = 0.9
	return m

## Quad horizontal (x0, z0) - (x1, z1) à la hauteur y.
func flat(key: String, x0: float, z0: float, x1: float, z1: float, y := 0.0) -> void:
	g(key).quad(Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z1), Vector3.UP)

func build() -> void:
	var t0 := Time.get_ticks_msec()
	var L := VehicleLab
	flat("grass", -L.HALF, -L.HALF, L.HALF, L.HALF, 0.0)
	_ring()
	var D: Dictionary = L.DRAG
	var dz := float(D["z"])
	var hw := float(D["w"]) / 2.0
	flat("asphalt", float(D["x0"]) - 4.0, dz - hw, float(L.CRASH["x"]), dz + hw, 0.02)
	flat("white", float(D["x0"]), dz - hw, float(D["x0"]) + 0.5, dz + hw, 0.03)   # ligne de départ
	var x := float(D["x0"]) + 50.0
	while x < float(L.CRASH["x"]) - 5.0:   # repères tous les 50 m
		flat("white", x, dz - hw, x + 0.25, dz - hw + 1.2, 0.03)
		flat("white", x, dz + hw - 1.2, x + 0.25, dz + hw, 0.03)
		_sign("%d m" % roundi(x - float(D["x0"])), Vector3(x, 0.05, dz + hw + 1.0), 0.0, 0.03, true)
		x += 50.0
	_sign("LIGNE DROITE  0-100 · FREINAGE", Vector3(float(D["x0"]) + 4.0, 3.2, dz - hw - 1.5), 0.0, 0.03)
	flat("asphalt", -12.0, 12.0, 12.0, 57.0, 0.015)   # accès du hangar à l'anneau (sud et nord)
	flat("asphalt", -26.0, 12.0, 26.0, 30.0, 0.018)
	flat("asphalt", -10.0, -57.0, 10.0, -12.0, 0.015)
	flat("concrete", L.HANGAR.position.x, L.HANGAR.position.y, L.HANGAR.end.x, L.HANGAR.end.y, 0.02)
	flat("mud", L.MUD.position.x, L.MUD.position.y, L.MUD.end.x, L.MUD.end.y, 0.04)
	flat("ice", L.ICE.position.x, L.ICE.position.y, L.ICE.end.x, L.ICE.end.y, 0.03)
	_sign("BOUE", Vector3(L.MUD.position.x - 2.0, 2.6, L.MUD.position.y - 1.0), PI / 2.0, 0.03)
	_sign("GLACE", Vector3(L.ICE.position.x + 4.0, 2.6, L.ICE.position.y - 1.0), 0.0, 0.03)
	progress.emit(0.3)
	await get_tree().process_frame
	_relief()
	_crash_wall()
	_hangar()
	_rails()
	_fence()
	_lamps_build()
	progress.emit(0.7)
	await get_tree().process_frame
	for key: String in _g:
		var mi := MeshInstance3D.new()
		mi.name = "banc_%s" % key
		mi.mesh = (_g[key] as GeoBuilder).build()
		mi.material_override = _mat(key)
		add_child(mi)
		triangle_count += (_g[key] as GeoBuilder).triangle_count()
	_g.clear()
	_cones_build()
	add_to_group("sky_listener")
	on_sky_k(Game.daynight.sky_k if Game.daynight != null else 1.0)
	built = true
	progress.emit(1.0)
	print("BANC D'ESSAI : vue construite en %d ms, %d triangles, %d plots, %d lampadaires" % [Time.get_ticks_msec() - t0, triangle_count, _cones.size(), _lamps.size()])

# ------------------------------------------------------------------ pistes
func _ring() -> void:
	var L := VehicleLab
	var path := PackedVector2Array()
	var raw := L.ring_path(16)
	for i in raw.size():   # lignes droites découpées tous les 4 m (bordures alternées)
		var a := raw[i]
		var b := raw[(i + 1) % raw.size()]
		var n := maxi(1, floori(a.distance_to(b) / 4.0))
		for k in n:
			path.append(a.lerp(b, float(k) / n))
	var hw := float(L.RING["w"]) / 2.0
	for i in path.size():
		var a := path[i]
		var b := path[(i + 1) % path.size()]
		var n := (b - a).normalized().orthogonal()
		var c := path[(i + 2) % path.size()]
		var n2 := (c - b).normalized().orthogonal()
		var nb := (n + n2).normalized()
		var na := n
		if i > 0:
			na = ((a - path[i - 1]).normalized().orthogonal() + n).normalized()
		g("asphalt").quad(Vector3(a.x + na.x * hw, 0.02, a.y + na.y * hw), Vector3(b.x + nb.x * hw, 0.02, b.y + nb.y * hw),
			Vector3(b.x - nb.x * hw, 0.02, b.y - nb.y * hw), Vector3(a.x - na.x * hw, 0.02, a.y - na.y * hw), Vector3.UP)
		if i % 2 == 0:   # bordures rouges et blanches
			for s: float in [1.0, -1.0]:
				var k := "red" if (i / 2) % 2 == 0 else "white"
				var p0: Vector2 = a + na * s * hw
				var p1: Vector2 = b + nb * s * hw
				var q0: Vector2 = a + na * s * (hw - 0.5)
				var q1: Vector2 = b + nb * s * (hw - 0.5)
				g(k).quad(Vector3(p0.x, 0.03, p0.y), Vector3(p1.x, 0.03, p1.y), Vector3(q1.x, 0.03, q1.y), Vector3(q0.x, 0.03, q0.y), Vector3.UP)
	var sz := float(L.RING["hz"])   # ligne de départ et d'arrivée : damier
	for i in 12:
		for j in 2:
			flat("white" if (i + j) % 2 == 0 else "black", -0.5 + j * 0.5, sz - hw + i, 0.0 + j * 0.5, sz - hw + i + 1.0, 0.035)
	_sign("DÉPART / ARRIVÉE", Vector3(0.0, 4.2, sz + hw + 1.5), 0.0, 0.035)
	for p: Vector2 in L.CPS.slice(1):
		_sign("POINT DE PASSAGE", Vector3(p.x, 2.4, p.y), atan2(-p.x, -p.y) if p.x != 0.0 else 0.0, 0.025)

# ------------------------------------------------------------------ relief
func _relief() -> void:
	var L := VehicleLab
	for r: Dictionary in L.RAMPS:
		var x0 := float(r["x0"])
		var x1 := x0 + float(r["len"])
		var z0 := float(r["z"]) - float(r["w"]) / 2.0
		var z1 := float(r["z"]) + float(r["w"]) / 2.0
		var h := float(r["h"])
		g("concrete").quad(Vector3(x0, 0.02, z0), Vector3(x1, h, z0), Vector3(x1, h, z1), Vector3(x0, 0.02, z1), Vector3(-h, float(r["len"]), 0).normalized())
		g("yellow").quad(Vector3(x1 - 0.4, h * (1.0 - 0.4 / float(r["len"])) + 0.01, z0), Vector3(x1, h + 0.01, z0), Vector3(x1, h + 0.01, z1), Vector3(x1 - 0.4, h * (1.0 - 0.4 / float(r["len"])) + 0.01, z1), Vector3.UP)
		g("concrete").quad(Vector3(x1, 0, z0), Vector3(x1, 0, z1), Vector3(x1, h, z1), Vector3(x1, h, z0), Vector3(1, 0, 0))
		for zz: float in [z0, z1]:
			var nz := -1.0 if zz == z0 else 1.0
			g("concrete").tri(Vector3(x0, 0, zz), Vector3(x1, 0, zz), Vector3(x1, h, zz), Vector3(0, 0, nz))
		_sign(String(r["name"]), Vector3(x0 - 2.0, 2.4, z0 - 1.0), -PI / 2.0, 0.025)
	var lane: Dictionary = L.BUMP_LANE
	var bz0 := float(lane["z"]) - float(lane["w"]) / 2.0
	var bz1 := float(lane["z"]) + float(lane["w"]) / 2.0
	flat("asphalt", 30.0, bz0, 86.0, bz1, 0.015)
	for b: Dictionary in L.BUMPS:
		var n := 10
		for i in n:
			var xa := float(b["x"]) - float(b["len"]) / 2.0 + float(b["len"]) * i / n
			var xb := xa + float(b["len"]) / n
			var ya := _bump_h(b, xa)
			var yb := _bump_h(b, xb)
			g("yellow" if i % 2 == 0 else "black").quad(Vector3(xa, ya + 0.02, bz0), Vector3(xb, yb + 0.02, bz0), Vector3(xb, yb + 0.02, bz1), Vector3(xa, ya + 0.02, bz1), Vector3.UP)
	_sign("DOS D'ÂNE · BOSSES", Vector3(32.0, 2.4, bz0 - 1.0), -PI / 2.0, 0.025)
	var H: Dictionary = L.HILL
	var hx0 := float(H["x0"])
	var hx1 := hx0 + float(H["up"])
	var hx2 := hx1 + float(H["flat"])
	var hx3 := hx2 + float(H["down"])
	var hh := float(H["h"])
	var z0 := float(H["z"]) - float(H["w"]) / 2.0
	var z1 := float(H["z"]) + float(H["w"]) / 2.0
	var pr := [Vector2(hx0, 0.02), Vector2(hx1, hh), Vector2(hx2, hh), Vector2(hx3, 0.02)]
	for i in 3:
		var a: Vector2 = pr[i]
		var b: Vector2 = pr[i + 1]
		g("asphalt").quad(Vector3(a.x, a.y, z0), Vector3(b.x, b.y, z0), Vector3(b.x, b.y, z1), Vector3(a.x, a.y, z1), Vector3.UP)
		for zz: float in [z0, z1]:
			g("concrete").quad(Vector3(a.x, 0, zz), Vector3(b.x, 0, zz), Vector3(b.x, b.y, zz), Vector3(a.x, a.y, zz), Vector3(0, 0, -1.0 if zz == z0 else 1.0))
	_sign("PENTE 20 %", Vector3(hx0 - 2.0, 2.4, z0 - 1.0), -PI / 2.0, 0.025)
	_sign("SLALOM", Vector3(float(L.SLALOM["x0"]) - 4.0, 2.4, float(L.SLALOM["z"]) - 6.0), -PI / 2.0, 0.025)
	_sign("CIBLE : 10 PLOTS", Vector3(L.TARGET.x + 6.0, 2.4, L.TARGET.y - 3.0), PI / 2.0, 0.025)

static func _bump_h(b: Dictionary, x: float) -> float:
	var d := x - float(b["x"])
	return float(b["h"]) * 0.5 * (1.0 + cos(TAU * d / float(b["len"]))) if absf(d) <= float(b["len"]) / 2.0 else 0.0

func _crash_wall() -> void:
	var C: Dictionary = VehicleLab.CRASH
	var cx := float(C["x"])
	var z0 := float(C["z"]) - float(C["len"]) / 2.0
	var t := float(C["t"])
	var h := float(C["h"])
	g("concrete").box(Vector3(cx + 0.1, h / 2.0, float(C["z"])), Vector3(t, h, float(C["len"])))
	var n := 14
	for i in n:   # chevrons jaunes et noirs sur la face
		var za := z0 + float(C["len"]) * i / n
		g("yellow" if i % 2 == 0 else "black").quad(Vector3(cx - t / 2.0 + 0.09, 0.3, za), Vector3(cx - t / 2.0 + 0.09, 0.3, za + float(C["len"]) / n),
			Vector3(cx - t / 2.0 + 0.09, h - 0.2, za + float(C["len"]) / n), Vector3(cx - t / 2.0 + 0.09, h - 0.2, za), Vector3(-1, 0, 0))
	_sign("MUR DE CRASH", Vector3(cx - 0.6, h + 0.8, float(C["z"])), PI / 2.0, 0.035)

func _hangar() -> void:
	var L := VehicleLab
	var R := L.HANGAR
	var H := L.HANGAR_H
	var D: Dictionary = VehicleLabMap.plan()
	for i in 6:
		var w: Dictionary = D["walls"][i]
		var a := Vector2(w["a"][0], w["a"][1])
		var b := Vector2(w["b"][0], w["b"][1])
		var m := (a + b) / 2.0
		var sz := Vector3(absf(b.x - a.x) + 0.4, H, absf(b.y - a.y) + 0.4)
		g("metal").box(Vector3(m.x, H / 2.0, m.y), sz)
	for dr: Array in [[L.HANGAR_DOORS[0], R.end.y], [L.HANGAR_DOORS[1], R.position.y]]:   # linteaux au-dessus des portes
		var xs: Array = dr[0]
		g("metal").box(Vector3((xs[0] + xs[1]) / 2.0, H - 0.75, dr[1]), Vector3(xs[1] - xs[0], 1.5, 0.4))
	g("roof").box(Vector3(R.get_center().x, H + 0.15, R.get_center().y), Vector3(R.size.x + 1.0, 0.3, R.size.y + 1.0))
	for pk: Dictionary in L.PARK:   # places du garage : lignes et nom au sol
		var px := float(pk["x"])
		var half := 2.6 if pk["type"] == "voiture" else 1.6
		flat("white", px - half, L.PARK_Z - 3.0, px - half + 0.12, L.PARK_Z + 3.2, 0.03)
		flat("white", px + half - 0.12, L.PARK_Z - 3.0, px + half, L.PARK_Z + 3.2, 0.03)
		var nm := "MOTONEIGE" if pk.get("model", "") == "motoneige" else String(Config.at("vehicles.types.%s.name" % pk["type"], "?"))
		_sign(nm, Vector3(px, 0.05, L.PARK_Z - 3.6), 0.0, 0.012, true)
	_sign("BANC D'ESSAI DES VÉHICULES", Vector3(0.0, H - 0.75, R.end.y + 0.25), 0.0, 0.018)
	for x in [-14.0, 0.0, 14.0]:
		var l := OmniLight3D.new()
		l.position = Vector3(x, H - 0.8, 0.0)
		l.omni_range = 16.0
		l.light_energy = 1.6
		l.light_color = Color("fff1d6")
		add_child(l)
		_inside.append(l)

func _rails() -> void:
	var R: Dictionary = VehicleLab.RAIL
	var z := float(R["z"])
	var x0 := float(R["x0"]) - 3.0
	var x1 := float(R["x1"]) + 3.0
	flat("ballast", x0, z - 1.8, x1, z + 1.8, 0.02)
	var x := x0
	while x < x1:
		g("sleeper").box(Vector3(x, 0.08, z), Vector3(0.24, 0.12, 2.5))
		x += 0.75
	for s in [-0.7175, 0.7175]:
		g("rail").box(Vector3((x0 + x1) / 2.0, 0.21, z + s), Vector3(x1 - x0, 0.15, 0.07))
	for xe in [x0, x1]:   # heurtoirs
		g("red").box(Vector3(xe, 0.6, z), Vector3(0.6, 1.2, 2.6))
	_sign("VOIE D'ESSAI DU TRAM", Vector3(0.0, 3.0, z + 4.0), 0.0, 0.03)

func _fence() -> void:
	var e := VehicleLab.EDGE
	for s: Array in [[0.0, -e, 2.0 * e, 0.3], [0.0, e, 2.0 * e, 0.3], [-e, 0.0, 0.3, 2.0 * e], [e, 0.0, 0.3, 2.0 * e]]:
		g("concrete").box(Vector3(s[0], 0.6, s[1]), Vector3(s[2], 1.2, s[3]))

func _lamps_build() -> void:
	_bulb_mat = StandardMaterial3D.new()
	_bulb_mat.albedo_color = Color("fff0c8")
	_bulb_mat.emission_enabled = true
	_bulb_mat.emission = Color("ffe2a0")
	for p: Vector2 in VehicleLabMap.lamp_posts():
		g("metal").box(Vector3(p.x, 3.0, p.y), Vector3(0.18, 6.0, 0.18))
		var bulb := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.7, 0.18, 0.4)
		bulb.mesh = bm
		bulb.material_override = _bulb_mat
		bulb.position = Vector3(p.x, 6.0, p.y)
		add_child(bulb)
		var l := OmniLight3D.new()
		l.position = Vector3(p.x, 5.6, p.y)
		l.omni_range = 26.0
		l.light_color = Color("ffd9a0")
		add_child(l)
		_lamps.append(l)

## Panneau : texte (Label3D) ; flat : posé au sol.
func _sign(text: String, pos: Vector3, yaw: float, px: float, ground := false) -> void:
	var l := Label3D.new()
	l.text = text
	l.pixel_size = px * 0.55
	l.font_size = 64
	l.outline_size = 12
	l.modulate = Color("f4f4ec")
	l.position = pos
	l.rotation = Vector3(-PI / 2.0 if ground else 0.0, yaw, 0.0)
	if not ground:
		l.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	add_child(l)

# ------------------------------------------------------------------ plots
func _cones_build() -> void:
	var cm := CylinderMesh.new()
	cm.top_radius = 0.03
	cm.bottom_radius = 0.17
	cm.height = 0.7
	cm.radial_segments = 10
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("ff6a14")
	var base := BoxMesh.new()
	base.size = Vector3(0.42, 0.04, 0.42)
	var band := CylinderMesh.new()
	band.top_radius = 0.085
	band.bottom_radius = 0.11
	band.height = 0.12
	band.radial_segments = 10
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color("f2f2f2")
	for c: Dictionary in Game.lab.cones:
		var n := Node3D.new()
		var body := MeshInstance3D.new()
		body.mesh = cm
		body.material_override = mat
		body.position.y = 0.37
		n.add_child(body)
		var b := MeshInstance3D.new()
		b.mesh = base
		b.material_override = mat
		b.position.y = 0.02
		n.add_child(b)
		var w := MeshInstance3D.new()
		w.mesh = band
		w.material_override = wm
		w.position.y = 0.42
		n.add_child(w)
		add_child(n)
		_cones.append(n)

func _process(dt: float) -> void:
	if not built or Game.lab == null:
		return
	var cs: Array = Game.lab.cones
	for i in mini(cs.size(), _cones.size()):
		var c: Dictionary = cs[i]
		var n: Node3D = _cones[i]
		n.position = Vector3(float(c["x"]), 0.0 if not bool(c["down"]) else 0.17, float(c["z"]))
		n.rotation.y += float(c["spin"]) * dt
		n.rotation.x = float(c["tilt"])
		if not bool(c["down"]):
			n.rotation = Vector3.ZERO

func on_sky_k(k: float) -> void:
	var lit := DayNight.lamps_of(k)
	for l in _lamps:
		l.light_energy = LAMP_ENERGY * lit
		l.visible = lit > 0.02
	for l in _inside:
		l.light_energy = 0.6 + 1.4 * lit
	if _bulb_mat != null:
		_bulb_mat.emission_energy_multiplier = 0.2 + 3.0 * lit
