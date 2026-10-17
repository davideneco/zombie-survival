extends Node3D
## Rendu de la carte de Strasbourg : lit la géométrie cuite par tools/bake-world.mjs (data/world/tiles/*.bin, doors/*.bin, instances.bin,
## materials.json, textures.json) et construit un ArrayMesh par tuile, des MultiMesh pour le décor instancié, et les portes (masquées à l'ouverture).
## Aucune règle ici : l'état des portes vient de Game.world. Formats : voir packSurfaces et le bloc « instances » de tools/bake-world.page.js.
## Les sommets cuits sont en sens trigonométrique (Three.js) : les index sont inversés au chargement (Godot : face avant = sens horaire).

const DIR := "res://data/world/"
const TILE_VIS_RANGE := 420.0     ## m : au-delà, la tuile n'est plus dessinée (le brouillard la cache déjà)
const SKY_COLOR := Color("0b1018")
const AMBIENT_COLOR := Color("4a5578")
const LAMP_COLOR := Color("ffd9a0")
const LAMP_RANGE := 24.0
const LAMP_ENERGY := 3.0
const LAMP_LIGHTS_MAX := 24       ## lampadaires éclairants : les plus proches du joueur (les autres restent des ampoules)
const FOG_DENSITY := 0.004

var load_ms := 0
var tile_count := 0
var triangle_count := 0
var _materials: Array = []
var _textures: Array = []         ## Texture2D ou null, par indice de textures.json
var _door_nodes: Dictionary = {}  ## id -> Node3D
var _lamp_lights: Array[OmniLight3D] = []
var _lamp_pos: Array = []
var _lamp_timer := 0.0

static func _json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))

func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_environment()
	_load_textures()
	_load_materials()
	var tiles: Dictionary = _json(DIR + "tiles.json")
	for t: Dictionary in tiles["tiles"]:
		var mi := _mesh_from_pack(DIR + "tiles/t%s.bin" % t["key"])
		if mi != null:
			mi.visibility_range_end = TILE_VIS_RANGE
			add_child(mi)
			tile_count += 1
			triangle_count += int(t["tri"])
	_load_doors()
	_load_instances()
	_lamps()
	Game.door_opened.connect(_on_door_opened)
	load_ms = Time.get_ticks_msec() - t0
	print("monde affiché : %d tuiles, %d triangles, %d matériaux, %d ms" % [tile_count, triangle_count, _materials.size(), load_ms])

func _process(dt: float) -> void:
	_lamp_timer -= dt
	if _lamp_timer <= 0.0 and Game.player != null:
		_lamp_timer = 0.5
		_assign_lamps(Game.player.pos)

# ---------------------------------------------------------------- environnement
func _environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = SKY_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = AMBIENT_COLOR
	env.ambient_light_energy = 0.5
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_enabled = true
	env.fog_light_color = SKY_COLOR
	env.fog_density = FOG_DENSITY
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var moon := DirectionalLight3D.new()
	moon.light_color = Color("8fa4d0")
	moon.light_energy = 0.35
	moon.rotation_degrees = Vector3(-55, 30, 0)
	add_child(moon)

# ---------------------------------------------------------------- textures et matériaux
func _load_textures() -> void:
	for t: Dictionary in _json(DIR + "textures.json"):
		var path := ProjectSettings.globalize_path(String(t["file"]))
		var img := Image.load_from_file(path)
		if img == null or img.is_empty():
			push_warning("texture absente : %s" % path)
			_textures.append(null)
			continue
		if img.get_format() != Image.FORMAT_RGBA8 and img.get_format() != Image.FORMAT_RGB8:
			img.convert(Image.FORMAT_RGBA8)
		img.generate_mipmaps()
		_textures.append(ImageTexture.create_from_image(img))

func _tex(i: int) -> Texture2D:
	return null if i < 0 or i >= _textures.size() else _textures[i]

func _load_materials() -> void:
	for m: Dictionary in _json(DIR + "materials.json"):
		var sm := StandardMaterial3D.new()
		sm.albedo_color = Config.color(int(m["c"]))
		sm.roughness = float(m["r"])
		sm.metallic = float(m["m"])
		sm.cull_mode = BaseMaterial3D.CULL_DISABLED if int(m["side"]) == 2 else BaseMaterial3D.CULL_BACK
		sm.vertex_color_use_as_albedo = bool(m["vc"])
		sm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		var rep: Array = m["rep"]
		var off: Array = m["off"]
		sm.uv1_scale = Vector3(float(rep[0]), float(rep[1]), 1.0)
		sm.uv1_offset = Vector3(float(off[0]), float(off[1]), 0.0)
		var tx := _tex(int(m["map"]))
		if tx != null:
			sm.albedo_texture = tx
		var tn := _tex(int(m["nmap"]))
		if tn != null:
			sm.normal_enabled = true
			sm.normal_texture = tn
			sm.normal_scale = float(m["ns"])
		var tr := _tex(int(m["rmap"]))
		if tr != null:
			sm.roughness_texture = tr
			sm.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
		var em := int(m["e"])
		if em != 0:
			sm.emission_enabled = true
			sm.emission = Config.color(em)
			sm.emission_energy_multiplier = float(m["ei"])
			var te := _tex(int(m["emap"]))
			if te != null:
				sm.emission_texture = te
				sm.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY   # Three.js : couleur x carte ; Godot ajoute par défaut
		if bool(m["basic"]):
			sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		if bool(m["tr"]) or float(m["op"]) < 1.0:
			sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			sm.albedo_color.a = float(m["op"])
		elif float(m["at"]) > 0.0:
			sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
			sm.alpha_scissor_threshold = float(m["at"])
		if bool(m["add"]):
			sm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		if bool(m["nodw"]):
			sm.no_depth_test = false
			sm.disable_receive_shadows = true
		_materials.append(sm)

# ---------------------------------------------------------------- paquets de surfaces
## Lit l'en-tête d'un paquet : « ZMP1 » ou « ZMI1 », u32 longueur du JSON, JSON, blobs. Renvoie [en-tête, octets, début des blobs].
static func _open_pack(path: String, magic: String) -> Array:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() < 8 or bytes.slice(0, 4).get_string_from_ascii() != magic:
		return []
	var hlen := bytes.decode_u32(4)
	var head: Dictionary = JSON.parse_string(bytes.slice(8, 8 + hlen).get_string_from_utf8())
	return [head, bytes, 8 + hlen]

func _surface_arrays(s: Dictionary, bytes: PackedByteArray, base: int, flip: bool) -> Array:
	var nv := int(s["nv"])
	var ni := int(s["ni"])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	var pos := bytes.slice(base + int(s["pos"]), base + int(s["pos"]) + nv * 12).to_float32_array()
	arrays[Mesh.ARRAY_VERTEX] = _to_v3(pos)
	arrays[Mesh.ARRAY_NORMAL] = _to_v3(bytes.slice(base + int(s["nor"]), base + int(s["nor"]) + nv * 12).to_float32_array())
	if s.has("uv"):
		var uv := bytes.slice(base + int(s["uv"]), base + int(s["uv"]) + nv * 8).to_float32_array()
		var uvs := PackedVector2Array()
		uvs.resize(nv)
		for i in nv:
			uvs[i] = Vector2(uv[i * 2], uv[i * 2 + 1])
		arrays[Mesh.ARRAY_TEX_UV] = uvs
	if s.has("col"):
		var col := bytes.slice(base + int(s["col"]), base + int(s["col"]) + nv * 16).to_float32_array()
		var cols := PackedColorArray()
		cols.resize(nv)
		for i in nv:
			cols[i] = Color(col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3])
		arrays[Mesh.ARRAY_COLOR] = cols
	if s.has("tan"):
		arrays[Mesh.ARRAY_TANGENT] = bytes.slice(base + int(s["tan"]), base + int(s["tan"]) + nv * 16).to_float32_array()
	var idx := bytes.slice(base + int(s["idx"]), base + int(s["idx"]) + ni * 4).to_int32_array()
	if flip:
		var t := 0
		while t + 2 < ni:
			var tmp := idx[t + 1]
			idx[t + 1] = idx[t + 2]
			idx[t + 2] = tmp
			t += 3
	arrays[Mesh.ARRAY_INDEX] = idx
	return arrays

static func _to_v3(f: PackedFloat32Array) -> PackedVector3Array:
	var n := f.size() / 3
	var out := PackedVector3Array()
	out.resize(n)
	for i in n:
		out[i] = Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2])
	return out

func _mesh_from_pack(path: String) -> MeshInstance3D:
	var pk := _open_pack(path, "ZMP1")
	if pk.is_empty():
		return null
	var head: Dictionary = pk[0]
	var mesh := ArrayMesh.new()
	for s: Dictionary in head["surfaces"]:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, _surface_arrays(s, pk[1], pk[2], true))
		mesh.surface_set_material(mesh.get_surface_count() - 1, _materials[int(s["mat"])])
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func _load_doors() -> void:
	for d: Dictionary in Game.world.doors:
		var id := int(d["id"])
		var mi := _mesh_from_pack(DIR + "doors/d%d.bin" % id)
		if mi == null:
			continue
		mi.visible = not bool(d["open"])
		add_child(mi)
		_door_nodes[id] = mi

func _on_door_opened(id: int) -> void:
	if _door_nodes.has(id):
		_door_nodes[id].visible = false

# ---------------------------------------------------------------- décor instancié
func _load_instances() -> void:
	var pk := _open_pack(DIR + "instances.bin", "ZMI1")
	if pk.is_empty():
		return
	var bytes: PackedByteArray = pk[1]
	var base: int = pk[2]
	for m: Dictionary in pk[0]["meshes"]:
		var n := int(m["count"])
		if n <= 0:
			continue
		var xf := bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + n * 48).to_float32_array()
		var cols := PackedFloat32Array()
		var has_col := m["colors"] != null
		if has_col:
			cols = bytes.slice(base + int(m["colors"]), base + int(m["colors"]) + n * 12).to_float32_array()
		for s: Dictionary in m["surfaces"]:
			var mesh := ArrayMesh.new()
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, _surface_arrays(s, bytes, base, true))
			var mat: Material = _materials[int(s["mat"])]
			if has_col:
				mat = mat.duplicate()
				(mat as StandardMaterial3D).vertex_color_use_as_albedo = true
			mesh.surface_set_material(0, mat)
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_colors = has_col
			mm.mesh = mesh
			mm.instance_count = n
			for i in n:
				var o := i * 12
				mm.set_instance_transform(i, Transform3D(
					Basis(Vector3(xf[o], xf[o + 4], xf[o + 8]), Vector3(xf[o + 1], xf[o + 5], xf[o + 9]), Vector3(xf[o + 2], xf[o + 6], xf[o + 10])),
					Vector3(xf[o + 3], xf[o + 7], xf[o + 11])))
				if has_col:
					mm.set_instance_color(i, Color(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]))
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mmi.visibility_range_end = TILE_VIS_RANGE
			add_child(mmi)

# ---------------------------------------------------------------- lampadaires
func _lamps() -> void:
	_lamp_pos = _json(DIR + "lamps.json")
	for _i in LAMP_LIGHTS_MAX:
		var l := OmniLight3D.new()
		l.light_color = LAMP_COLOR
		l.omni_range = LAMP_RANGE
		l.light_energy = LAMP_ENERGY
		l.visible = false
		add_child(l)
		_lamp_lights.append(l)

func _assign_lamps(p: Vector3) -> void:
	var near: Array = []
	for lp: Array in _lamp_pos:
		var d := Vector2(float(lp[0]) - p.x, float(lp[2]) - p.z).length_squared()
		if d < 90.0 * 90.0:
			near.append([d, lp])
	near.sort_custom(func(a, b): return a[0] < b[0])
	for i in _lamp_lights.size():
		var l := _lamp_lights[i]
		if i < near.size():
			var lp: Array = near[i][1]
			l.position = Vector3(float(lp[0]), float(lp[1]), float(lp[2]))
			l.visible = true
		else:
			l.visible = false
