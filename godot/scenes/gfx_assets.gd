extends RefCounted
## J9 : chargement des assets graphiques cuits par tools/bake-graphics.mjs (godot/assets/graphics/, ignoré par git, lu par Image.load_from_file : jamais importé).
## Textures en cache (mipmaps), géométries des zombies (ZGE1), métadonnées du champ de distance du sol.

const DIR := "res://assets/graphics/"
static var _tex: Dictionary = {}
static var _geo: Dictionary = {}
static var _meta: Dictionary = {}

static func available() -> bool:
	return FileAccess.file_exists(DIR + "graphics.json")

static func meta() -> Dictionary:
	if _meta.is_empty() and available():
		_meta = JSON.parse_string(FileAccess.get_file_as_string(DIR + "graphics.json"))
	return _meta

## Texture d'un PNG cuit (null si absent). mipmaps : pour tout ce qui est échantillonné en perspective.
static func texture(name: String, mipmaps := true) -> Texture2D:
	if _tex.has(name):
		return _tex[name]
	var path := ProjectSettings.globalize_path(DIR + name)
	var img := Image.load_from_file(path)
	var t: Texture2D = null
	if img != null and not img.is_empty():
		if mipmaps:
			img.generate_mipmaps()
		t = ImageTexture.create_from_image(img)
	_tex[name] = t
	return t

## Géométries des zombies : nom -> ArrayMesh (tête, mâchoire, buste, bassin, cuisse, tibia + chaussure, bras, avant-bras + main, œil). Les sommets sont déjà en sens horaire.
static func zombie_mesh(name: String) -> ArrayMesh:
	if _geo.is_empty():
		_load_geo()
	return _geo.get(name)

static func _load_geo() -> void:
	var bytes := FileAccess.get_file_as_bytes(DIR + "zombie_geo.bin")
	if bytes.size() < 8 or bytes.slice(0, 4).get_string_from_ascii() != "ZGE1":
		_geo["_"] = null
		return
	var hlen := bytes.decode_u32(4)
	var head: Dictionary = JSON.parse_string(bytes.slice(8, 8 + hlen).get_string_from_utf8())
	var base := 8 + hlen
	for name: String in head["parts"]:
		var p: Dictionary = head["parts"][name]
		var n := int(p["n"])
		var pos := bytes.slice(base + int(p["pos"]), base + int(p["pos"]) + n * 12).to_float32_array()
		var nor := bytes.slice(base + int(p["nor"]), base + int(p["nor"]) + n * 12).to_float32_array()
		var uv := bytes.slice(base + int(p["uv"]), base + int(p["uv"]) + n * 8).to_float32_array()
		var pv := PackedVector3Array()
		var nv := PackedVector3Array()
		var uvs := PackedVector2Array()
		pv.resize(n)
		nv.resize(n)
		uvs.resize(n)
		for i in n:
			pv[i] = Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
			nv[i] = Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2])
			uvs[i] = Vector2(uv[i * 2], uv[i * 2 + 1])
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pv
		arrays[Mesh.ARRAY_NORMAL] = nv
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		_geo[name] = mesh
