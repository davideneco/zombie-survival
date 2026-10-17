extends RefCounted
## J13 : modèles d'armes du « Ultimate Gun Pack » de Quaternius (CC0), table dans data/weapon_models.json. Les armes absentes de la table
## (Barrett, M79, arbalète, pistolet à rayons) gardent les primitives de weapon_view.gd.
## Repère des modèles : canon vers +X, haut +Y. Repère de l'arme dans la vue : origine à la poignée, canon vers -Z, ligne de canon à y = 0.

const TABLE_PATH := "res://data/weapon_models.json"
const DIR := "res://assets/weapons/"
const TURN := Basis(Vector3.UP, PI / 2.0)   ## +X (canon du modèle) -> -Z (devant la caméra)

static var _table: Dictionary = {}
static var _meshes: Dictionary = {}

static func table() -> Dictionary:
	if _table.is_empty():
		var f := FileAccess.open(TABLE_PATH, FileAccess.READ)
		_table = (JSON.parse_string(f.get_as_text()) as Dictionary)["models"]
	return _table

static func has_model(id: String) -> bool:
	return table().has(id)

static func mesh_of(file: String) -> Mesh:
	if not _meshes.has(file):
		_meshes[file] = load(DIR + file) as Mesh
	return _meshes[file]

## Facteur d'échelle (m par unité du pack) : la longueur voulue est celle de la boîte englobante du modèle principal.
static func scale_of(id: String) -> float:
	var e: Dictionary = table()[id]
	return float(e["length"]) / mesh_of(String(e["file"])).get_aabb().size.x

## Bouche dans le repère de l'arme (là où part l'éclair de bouche).
static func muzzle(id: String) -> Vector3:
	var e: Dictionary = table()[id]
	var o: Array = e["offset"]
	return Vector3(float(o[0]), float(o[1]), float(o[2]) - float(e["length"]) + float(e["grip"]))

## Arme complète prête à être posée : origine à la poignée, tint = reflet du Pack-a-Punch (ou null).
static func build(id: String, tint: Variant) -> Node3D:
	var e: Dictionary = table()[id]
	var root := Node3D.new()
	var s := scale_of(id)
	var mesh := mesh_of(String(e["file"]))
	var bb := mesh.get_aabb()
	var my := float(e["muzzle_y"])
	var o: Array = e["offset"]
	var pivot := Vector3(bb.position.x + float(e["grip"]) / s, my, 0.0)
	root.add_child(_instance(mesh, TURN * (-pivot * s) + Vector3(float(o[0]), float(o[1]), float(o[2])), s, tint))
	for a: Dictionary in e["accessories"]:
		var am := mesh_of(String(a["file"]))
		var at := Vector3(float(a["x"]), float(a["y"]), 0.0)
		var asc := s * float(a.get("scale", 1.0))
		root.add_child(_instance(am, TURN * ((at - pivot) * s) + Vector3(float(o[0]), float(o[1]), float(o[2])), asc, tint))
	return root

static func _instance(mesh: Mesh, pos: Vector3, s: float, tint: Variant) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.basis = TURN.scaled(Vector3(s, s, s))
	mi.position = pos
	for i in mesh.get_surface_count():
		var src := mesh.surface_get_material(i) as StandardMaterial3D
		var m := StandardMaterial3D.new()
		if src != null:
			m.albedo_color = src.albedo_color.linear_to_srgb()   # les couleurs du .mtl sont linéaires (Blender)
		m.roughness = 0.6
		m.metallic = 0.15
		m.emission_enabled = true   # la nuit, le monde éclaire peu la vue : un peu d'émission garde la couleur lisible
		if tint != null:
			m.emission = tint
			m.emission_energy_multiplier = 0.04
		else:
			m.emission = m.albedo_color
			m.emission_energy_multiplier = 0.3
		mi.set_surface_override_material(i, m)
	return mi
