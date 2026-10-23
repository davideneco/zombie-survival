extends RefCounted
## v0.23.2 : « bouchons » visibles des murs de collision sans surface dessinée (data/world_patches.json, écrit par tools/collision-scan.py --patches).
## La collision du jeu JS reste intacte (golden) : plutôt que de la retirer, on dessine le mur qu'elle suppose. Un panneau va de (a) à (b), de y0 à y1 ; une colonne
## (clé `c` = [x, z], `r`) est un prisme à 12 pans.
## Pierre rose pour la cathédrale, enduit beige ailleurs ; double face, sans texture (le décor cuit n'a pas de matériau uni réutilisable).

const PATH := "res://data/world_patches.json"
const Surfaces := preload("res://scenes/world/surfaces.gd")
const STONE := Color(0.80, 0.55, 0.45)
const PLASTER := Color(0.60, 0.57, 0.50)

## Panneaux du fichier : Array de { a: [x, z], b: [x, z], y0, y1, zone, seg }.
static func walls() -> Array:
	if not FileAccess.file_exists(PATH):
		return []
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
	return d["walls"] if d is Dictionary and d.has("walls") else []

## Un MeshInstance3D par couleur (deux surfaces), ou null s'il n'y a rien.
static func build() -> MeshInstance3D:
	var list := walls()
	if list.is_empty():
		return null
	var mesh := ArrayMesh.new()
	for stone in [true, false]:
		var vs := PackedVector3Array()
		var ns := PackedVector3Array()
		for w: Dictionary in list:
			if String(w["zone"]).contains("Cath") != stone:
				continue
			var y0 := float(w["y0"])
			var y1 := float(w["y1"])
			if w.has("c"):
				var c: Array = w["c"]
				var r := float(w["r"])
				for k in 12:
					var a0 := TAU * k / 12.0
					var a1 := TAU * (k + 1) / 12.0
					_quad(vs, ns, Vector2(float(c[0]) + r * cos(a0), float(c[1]) + r * sin(a0)), Vector2(float(c[0]) + r * cos(a1), float(c[1]) + r * sin(a1)), y0, y1)
			else:
				var a: Array = w["a"]
				var b: Array = w["b"]
				_quad(vs, ns, Vector2(float(a[0]), float(a[1])), Vector2(float(b[0]), float(b[1])), y0, y1)
		if vs.is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = vs
		arr[Mesh.ARRAY_NORMAL] = ns
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		# v0.32.0 : pierre PBR de la cathédrale (même grès que la peau procédurale) ; enduit : détail PBR en projection triplanaire
		if stone:
			mesh.surface_set_material(mesh.get_surface_count() - 1, Surfaces.make("stone", {"c": 0xa87c6a, "map": -1}, func(_i: int) -> Texture2D: return null))
		else:
			var m := StandardMaterial3D.new()
			m.albedo_color = PLASTER * 1.6
			m.albedo_texture = preload("res://assets/pbr/wall_plaster/a.png")
			m.uv1_triplanar = true
			m.uv1_world_triplanar = true
			m.uv1_scale = Vector3(0.6, 0.6, 0.6)
			m.roughness = 0.95
			mesh.surface_set_material(mesh.get_surface_count() - 1, m)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.set_meta("tile", true)
	return mi

static func _quad(vs: PackedVector3Array, ns: PackedVector3Array, a: Vector2, b: Vector2, y0: float, y1: float) -> void:
	var p0 := Vector3(a.x, y0, a.y)
	var p1 := Vector3(b.x, y0, b.y)
	var p2 := Vector3(b.x, y1, b.y)
	var p3 := Vector3(a.x, y1, a.y)
	var n := (p1 - p0).cross(p3 - p0).normalized()
	vs.append_array([p0, p1, p2, p0, p2, p3])
	for _i in 6:
		ns.append(n)
	# v0.32.0 : l'autre face (les matériaux PBR coupent les faces arrière)
	vs.append_array([p0, p2, p1, p0, p3, p2])
	for _i in 6:
		ns.append(-n)
