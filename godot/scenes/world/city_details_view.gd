extends Node3D
## v0.32.2 : détails 3D des façades et des toits de la ville (données : data/city_details.bin, écrit par tools/build-city-details.py depuis la géométrie cuite).
## Sur chaque fenêtre peinte des façades : encadrement de pierre en saillie (appui, jambages, linteau), volets persiennés en relief là où ils sont peints
## (ouverts contre le mur ou fermés), balcon en fer forgé, jardinière fleurie ; sur les toits : gouttières pendantes en zinc le long des égouts, descentes
## d'eau pluviale, cheminées de brique sur les faîtages (souches, chapeaux, mitrons), tuiles faîtières.
## Rangement : MultiMesh par maille de 64 m et par type (culling par maille), portée réglée par la qualité. Décor seul (aucune collision).

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const PATH := "res://data/city_details.bin"
const SHADER := preload("res://shaders/city_detail.gdshader")
const CELL := 48.0
const F_OPEN := 1
const F_CLOSED := 2
const F_BALCONY := 4
const F_FLOWERS := 8
const F_TIMBER := 16
const F_MODERN := 32
## portée (m) des détails de façade et des détails de toit, par qualité (Rapide, Normale, Haute)
const FACADE_RANGE := [0.0, 40.0, 75.0]     ## Rapide : aucun détail de façade (coût mesuré, voir docs/GODOT_PORT.md v0.32.2)
const ROOF_RANGE := [80.0, 130.0, 180.0]

var counts := {}
var _facade_nodes: Array[MultiMeshInstance3D] = []
var _roof_nodes: Array[MultiMeshInstance3D] = []
var _shadow_nodes: Array[MultiMeshInstance3D] = []

static func exists() -> bool:
	return FileAccess.file_exists(PATH)

func build(slice: Callable) -> void:
	name = "DetailsVille"
	var bytes := FileAccess.get_file_as_bytes(PATH)
	if bytes.size() < 8 or bytes.slice(0, 4).get_string_from_ascii() != "ZCD1":
		return
	var hlen := bytes.decode_u32(4)
	var head: Dictionary = JSON.parse_string(bytes.slice(8, 8 + hlen).get_string_from_utf8())
	var off := 8 + hlen
	var arrs := {}
	for k in [["windows", 10], ["gutters", 7], ["pipes", 6], ["chimneys", 6], ["ridges", 6]]:
		var n := int(head.get(k[0], 0))
		var w: int = k[1]
		arrs[k[0]] = bytes.slice(off, off + n * w * 4).to_float32_array()
		off += n * w * 4
	var meshes := _meshes()
	var mats := _materials()
	# instances par (type, maille) : PackedFloat32Array au format du tampon de MultiMesh (12 flottants de transformation + 4 de couleur)
	var buckets := {}
	var add := func(kind: String, xf: Transform3D, col: Color) -> void:
		var key := Vector2i(floori(xf.origin.x / CELL), floori(xf.origin.z / CELL))
		var bk := "%s|%d|%d" % [kind, key.x, key.y]
		var arr: PackedFloat32Array = buckets.get(bk, PackedFloat32Array())
		var b := xf.basis
		arr.append_array([b.x.x, b.y.x, b.z.x, xf.origin.x, b.x.y, b.y.y, b.z.y, xf.origin.y, b.x.z, b.y.z, b.z.z, xf.origin.z, col.r, col.g, col.b, 1.0])
		buckets[bk] = arr
	var W: PackedFloat32Array = arrs["windows"]
	var nw := W.size() / 10
	for i in nw:
		if i % 4000 == 0:
			await slice.call()
		var o := i * 10
		var p := Vector3(W[o], W[o + 1], W[o + 2])
		var Z := Vector3(W[o + 3], 0.0, W[o + 4]).normalized()
		var X := Vector3(Z.z, 0.0, -Z.x)
		var w := W[o + 5]
		var h := W[o + 6]
		var flags := int(W[o + 7])
		var sc := Color.hex((int(W[o + 8]) << 8) | 0xff)
		var fc := Color.hex((int(W[o + 9]) << 8) | 0xff)
		var sx := w / 1.25
		var sy := h / 1.85
		if flags & F_TIMBER == 0 and flags & F_MODERN == 0:
			add.call("frame", Transform3D(Basis(X * sx, Vector3.UP * sy, Z), p), fc)
		else:
			add.call("sill", Transform3D(Basis(X * sx, Vector3.UP, Z), p), fc if flags & F_MODERN == 0 else Color(0.5, 0.5, 0.52))
		if flags & F_OPEN:
			var pw := w * 0.5
			for sd in [-1.0, 1.0]:
				var hinge: Vector3 = p + X * (sd * (w * 0.5 + 0.12)) + Z * 0.02
				var ang := deg_to_rad(12.0)
				var dirx: Vector3 = X * sd * cos(ang) + Z * sin(ang)
				add.call("shutter", Transform3D(Basis(dirx * pw, Vector3.UP * (h + 0.08), Z.rotated(Vector3.UP, -ang * sd)), hinge - Vector3.UP * 0.04), sc)
		elif flags & F_CLOSED:
			for sd in [-1.0, 1.0]:
				add.call("shutter", Transform3D(Basis(X * sd * (w * 0.5), Vector3.UP * (h + 0.08), Z), p + Z * 0.05 - Vector3.UP * 0.04), sc)
		if flags & F_BALCONY:
			add.call("balcony", Transform3D(Basis(X * sx, Vector3.UP, Z), p + Z * 0.02), Color.WHITE)
			add.call("balcony_slab", Transform3D(Basis(X * sx, Vector3.UP, Z), p + Z * 0.02), fc)
		if flags & F_FLOWERS:
			add.call("flowers", Transform3D(Basis(X * sx, Vector3.UP, Z), p + Z * 0.06), Color.WHITE)
	# toits
	var G: PackedFloat32Array = arrs["gutters"]
	for i in G.size() / 7:
		var o := i * 7
		var a := Vector3(G[o], G[o + 1], G[o + 2])
		var b := Vector3(G[o + 3], G[o + 1], G[o + 4])
		var n := Vector3(G[o + 5], 0.0, G[o + 6]).normalized()
		var L := a.distance_to(b)
		var X := (b - a) / L
		var Zn := X.cross(Vector3.UP).normalized()
		if Zn.dot(n) < 0.0:
			Zn = -Zn
		add.call("gutter", Transform3D(Basis(X * L, Vector3.UP, Zn), a + Zn * 0.1 - Vector3.UP * 0.12), Color.WHITE)
		# corniche moulurée sous l'égout (le haut du mur : le toit cuit n'a pas de débord)
		add.call("cornice", Transform3D(Basis(X * L, Vector3.UP, Zn), a - Vector3.UP * 0.02), Color(0.66, 0.60, 0.52))
	var Pp: PackedFloat32Array = arrs["pipes"]
	for i in Pp.size() / 6:
		var o := i * 6
		add.call("pipe", Transform3D(Basis.IDENTITY.scaled(Vector3(1.0, Pp[o + 3] - Pp[o + 2], 1.0)), Vector3(Pp[o], Pp[o + 2], Pp[o + 1])), Color.WHITE)
	var C: PackedFloat32Array = arrs["chimneys"]
	for i in C.size() / 6:
		var o := i * 6
		var bs := Basis(Vector3.UP, -C[o + 4]).scaled(Vector3(C[o + 5], C[o + 3] - C[o + 2], C[o + 5] * 0.62))
		add.call("chimney", Transform3D(bs, Vector3(C[o], C[o + 2], C[o + 1])), Color(0.46, 0.25, 0.20))
	var R: PackedFloat32Array = arrs["ridges"]
	for i in R.size() / 6:
		var o := i * 6
		var a := Vector3(R[o], R[o + 1], R[o + 2])
		var b := Vector3(R[o + 3], R[o + 4], R[o + 5])
		var X := b - a
		var Zr := X.cross(Vector3.UP).normalized()
		add.call("ridge", Transform3D(Basis(X, Vector3.UP, Zr), a), Color(0.55, 0.33, 0.26))
	# MultiMesh par seau
	var made := 0
	for bk: String in buckets:
		if made % 40 == 0:
			await slice.call()
		made += 1
		var parts := bk.split("|")
		var kind := parts[0]
		var arr: PackedFloat32Array = buckets[bk]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = meshes[kind]
		mm.instance_count = arr.size() / 16
		mm.buffer = arr
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = mats[kind]
		var roof_kind := kind in ["gutter", "pipe", "chimney", "ridge", "cornice"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if kind == "chimney":
			_shadow_nodes.append(mi)
		add_child(mi)
		if roof_kind:
			_roof_nodes.append(mi)
		else:
			_facade_nodes.append(mi)
		counts[kind] = int(counts.get(kind, 0)) + mm.instance_count
	set_quality(int(Game.settings.get_value("quality")))
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "quality":
			set_quality(int(Game.settings.get_value("quality"))))
	print("détails de la ville : %s ; %d nœuds" % [counts, get_child_count()])

## Portée par qualité (distance à la maille : + une demi-diagonale de maille) ; ombres des cheminées en Normale et Haute.
func set_quality(q: int) -> void:
	q = clampi(q, 0, 2)
	for mi in _facade_nodes:
		mi.visible = float(FACADE_RANGE[q]) > 0.0
		mi.visibility_range_end = float(FACADE_RANGE[q]) + CELL * 0.71
		mi.visibility_range_end_margin = 8.0
		mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
	for mi in _roof_nodes:
		mi.visibility_range_end = float(ROOF_RANGE[q]) + CELL * 0.71
	for mi in _shadow_nodes:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if q >= 1 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# ----------------------------------------------------------------- maillages unitaires (repère : x le long du mur, y haut, z sortant ; origine : milieu du bas de la baie)
func _meshes() -> Dictionary:
	var m := {}
	# encadrement de référence 1,25 x 1,85 m (comme relief.js du JS) : jambages, linteau mouluré, appui ; mis à l'échelle de la baie
	var f := GeoBuilder.new()
	f.ao = 0.95
	f.box(Vector3(-0.7, 0.925, 0.075), Vector3(0.15, 1.85, 0.15), 63 & ~8 & ~32)
	f.box(Vector3(0.7, 0.925, 0.075), Vector3(0.15, 1.85, 0.15), 63 & ~8 & ~32)
	f.box(Vector3(0.0, 1.935, 0.1), Vector3(1.81, 0.17, 0.2), 63 & ~32)
	f.box(Vector3(0.0, 2.05, 0.13), Vector3(1.95, 0.07, 0.26), 63 & ~32)
	f.ao = 0.8
	f.box(Vector3(0.0, -0.05, 0.115), Vector3(1.71, 0.1, 0.23), 63 & ~32)
	m["frame"] = f.build()
	var s := GeoBuilder.new()
	s.ao = 0.85
	s.box(Vector3(0.0, -0.05, 0.1), Vector3(1.5, 0.08, 0.2), 63 & ~32)
	m["sill"] = s.build()
	# volet : panneau de 1 x 1 (mis à l'échelle), charnière en x = 0, s'étend vers +x ; cadre en saillie
	var v := GeoBuilder.new()
	v.ao = 1.0
	v.box(Vector3(0.5, 0.5, 0.018), Vector3(1.0, 1.0, 0.036), 63)
	m["shutter"] = v.build()
	# balcon en fer forgé (pour une baie de 1,25 m) : dalle de pierre, lisses, poteaux, barreaux
	var b := GeoBuilder.new()
	b.ao = 0.9
	b.box(Vector3(0.0, -0.13, 0.31), Vector3(2.0, 0.12, 0.62), 63 & ~32)
	var bi := GeoBuilder.new()
	bi.ao = 1.0
	bi.box(Vector3(0.0, 0.98, 0.62), Vector3(2.05, 0.05, 0.05), 63 & ~32)
	bi.box(Vector3(0.0, 0.08, 0.62), Vector3(2.0, 0.04, 0.04), 1 | 2 | 4 | 16)
	for sx in [-1.0, 1.0]:
		bi.box(Vector3(sx * 1.0, 0.98, 0.31), Vector3(0.05, 0.05, 0.62), 4 | 1 | 2)
		bi.box(Vector3(sx * 1.0, 0.45, 0.62), Vector3(0.05, 1.0, 0.05), 16 | 1 | 2)
	# barreaux : bandes plates (un plan, vu des deux côtés : matériau sans élimination des faces arrière)
	for k in range(1, 14):
		var x := -1.0 + 2.0 * k / 14.0
		bi.quad(Vector3(x - 0.012, 0.08, 0.62), Vector3(x + 0.012, 0.08, 0.62), Vector3(x + 0.012, 0.96, 0.62), Vector3(x - 0.012, 0.96, 0.62), Vector3.BACK)
	for sx in [-1.0, 1.0]:
		for k in range(1, 4):
			var z := 0.62 * k / 4.0
			bi.quad(Vector3(sx, 0.08, z - 0.012), Vector3(sx, 0.08, z + 0.012), Vector3(sx, 0.96, z + 0.012), Vector3(sx, 0.96, z - 0.012), Vector3(sx, 0, 0))
	bi.quad(Vector3(-1.0, 0.8, 0.62), Vector3(1.0, 0.8, 0.62), Vector3(1.0, 0.83, 0.62), Vector3(-1.0, 0.83, 0.62), Vector3.BACK)   # frise
	m["balcony"] = bi.build()
	m["balcony_slab"] = b.build()
	# jardinière : caisse de bois, feuillage et géraniums (couleurs de sommet) : pyramides basses, ~70 triangles
	var j := GeoBuilder.new()
	j.paint = Color(0.36, 0.22, 0.13)
	j.box(Vector3(0.0, 0.07, 0.13), Vector3(1.4, 0.16, 0.22), 63 & ~8 & ~32)
	j.paint = Color(0.16, 0.30, 0.12)
	j.box(Vector3(0.0, 0.19, 0.13), Vector3(1.3, 0.08, 0.2), 4 | 16 | 1 | 2)
	for k in 7:
		var x := -0.6 + 1.2 * k / 6.0
		j.paint = Color(0.78, 0.07, 0.10) if k % 3 != 1 else Color(0.90, 0.35, 0.52)
		j.spire(x, 0.13 + 0.03 * sin(k * 1.7), 0.1, 0.2, 0.31 + 0.03 * cos(k * 2.3), 4, k * 0.6)
	j.paint = Color(-1.0, 0.0, 0.0)
	m["flowers"] = j.build()
	# gouttière pendante (demi-ronde, longueur 1) et crochets
	var gt := GeoBuilder.new()
	gt.ao = 1.0
	var n := 6
	for i in n:
		var a0 := PI + PI * i / n
		var a1 := PI + PI * (i + 1) / n
		var p0 := Vector3(0.0, sin(a0) * 0.1, 0.1 + cos(a0) * 0.1)
		var p1 := Vector3(0.0, sin(a1) * 0.1, 0.1 + cos(a1) * 0.1)
		gt.quad(p0, p1, p1 + Vector3(1, 0, 0), p0 + Vector3(1, 0, 0), Vector3(0.0, (sin(a0) + sin(a1)) * 0.5, (cos(a0) + cos(a1)) * 0.5))
		gt.quad(p0, p1, p1 + Vector3(1, 0, 0), p0 + Vector3(1, 0, 0), -Vector3(0.0, (sin(a0) + sin(a1)) * 0.5, (cos(a0) + cos(a1)) * 0.5))
	gt.box(Vector3(0.5, 0.005, 0.0), Vector3(1.0, 0.012, 0.03), 63)
	gt.box(Vector3(0.5, 0.0, 0.2), Vector3(1.0, 0.025, 0.025), 63)   # ourlet
	m["gutter"] = gt.build()
	# corniche (longueur 1, sous l'égout) : bandeau, doucine (trois redents), larmier
	var cn := GeoBuilder.new()
	cn.ao = 0.75
	cn.box(Vector3(0.5, -0.42, 0.05), Vector3(1.0, 0.16, 0.1), 4 | 8 | 16 | 32)
	cn.ao = 0.85
	cn.box(Vector3(0.5, -0.3, 0.1), Vector3(1.0, 0.1, 0.2), 4 | 8 | 16 | 32)
	cn.ao = 0.95
	cn.box(Vector3(0.5, -0.17, 0.16), Vector3(1.0, 0.16, 0.32), 4 | 8 | 16 | 32)
	m["cornice"] = cn.build()
	var pp := GeoBuilder.new()
	pp.ao = 1.0
	pp.prism(0.0, 0.0, 0.05, 0.05, 0.0, 1.0, 8, 0.0, false)
	m["pipe"] = pp.build()
	# cheminée : souche de 1 x 1 x 1 (mise à l'échelle), bandeau, chapeau, deux mitrons
	var c := GeoBuilder.new()
	c.ao = 0.95
	c.box(Vector3(0.0, 0.5, 0.0), Vector3(1.0, 1.0, 1.0), 63 & ~8)
	c.ao = 0.8
	c.box(Vector3(0.0, 0.86, 0.0), Vector3(1.12, 0.06, 1.12), 63)
	c.box(Vector3(0.0, 1.01, 0.0), Vector3(1.14, 0.03, 1.14), 63)
	c.ao = 0.7
	for x in [-0.22, 0.22]:
		c.prism(x, 0.0, 0.11, 0.09, 1.0, 1.16, 8, 0.0, true)
	m["chimney"] = c.build()
	# faîtière : demi-cylindre le long de x (longueur 1)
	var r := GeoBuilder.new()
	r.ao = 1.0
	for i in 6:
		var a0 := PI * i / 6.0
		var a1 := PI * (i + 1) / 6.0
		var p0 := Vector3(0.0, sin(a0) * 0.13 - 0.03, cos(a0) * 0.16)
		var p1 := Vector3(0.0, sin(a1) * 0.13 - 0.03, cos(a1) * 0.16)
		r.quad(p0, p1, p1 + Vector3(1, 0, 0), p0 + Vector3(1, 0, 0), Vector3(0.0, (sin(a0) + sin(a1)) * 0.5, (cos(a0) + cos(a1)) * 0.5))
	m["ridge"] = r.build()
	return m

func _mat(kind: int, a: Texture2D, mm: Texture2D, sc: float, tint: Color, use_inst := true) -> ShaderMaterial:
	var sm := ShaderMaterial.new()
	sm.shader = SHADER
	sm.set_shader_parameter("kind", kind)
	sm.set_shader_parameter("det_a", a)
	sm.set_shader_parameter("det_m", mm)
	sm.set_shader_parameter("det_scale", sc)
	sm.set_shader_parameter("tint", tint)
	sm.set_shader_parameter("use_instance", 1.0 if use_inst else 0.0)
	return sm

func _materials() -> Dictionary:
	var stone_a := preload("res://assets/pbr/wall_stone/a.png")
	var stone_m := preload("res://assets/pbr/wall_stone/m.png")
	var wood_a := preload("res://assets/pbr/wood_door/a.png")
	var wood_m := preload("res://assets/pbr/wood_door/m.png")
	var brick_a := preload("res://assets/pbr/wall_brick/a.png")
	var brick_m := preload("res://assets/pbr/wall_brick/m.png")
	var clay_a := preload("res://assets/pbr/roof_clay/a.png")
	var clay_m := preload("res://assets/pbr/roof_clay/m.png")
	var m := {}
	m["frame"] = _mat(0, stone_a, stone_m, 1.2, Color(1, 1, 1))
	m["sill"] = m["frame"]
	m["shutter"] = _mat(1, wood_a, wood_m, 0.8, Color(1, 1, 1))
	m["balcony"] = _mat(2, stone_a, stone_m, 1.0, Color(1, 1, 1), false)
	m["balcony_slab"] = m["frame"]
	m["flowers"] = _mat(5, stone_a, stone_m, 1.0, Color(1, 1, 1))
	m["gutter"] = _mat(3, stone_a, stone_m, 1.0, Color(1, 1, 1), false)
	m["pipe"] = m["gutter"]
	m["chimney"] = _mat(4, brick_a, brick_m, 0.9, Color(1.0, 1.0, 1.0))
	m["cornice"] = _mat(0, stone_a, stone_m, 1.2, Color(1, 1, 1))
	m["ridge"] = _mat(6, clay_a, clay_m, 0.8, Color(1.2, 1.2, 1.2))
	return m
