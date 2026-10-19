extends Node3D
## Rendu de la carte de Strasbourg : lit la géométrie cuite par tools/bake-world.mjs (data/world/tiles/*.bin, doors/*.bin, instances.bin,
## materials.json, textures.json) et construit un ArrayMesh par tuile, des MultiMesh pour le décor instancié, et les portes (masquées à l'ouverture).
## Aucune règle ici : l'état des portes vient de Game.world. Formats : voir packSurfaces et le bloc « instances » de tools/bake-world.page.js.
## Les sommets cuits sont en sens trigonométrique (Three.js) : les index sont inversés au chargement (Godot : face avant = sens horaire).

const DIR := "res://data/world/"
const Surfaces := preload("res://scenes/world/surfaces.gd")
const INSTANCE_CELL := 160.0      ## m : maille de rangement des instances (MultiMesh)
const TILE_VIS_RANGE := 190.0     ## m : au-delà, la tuile n'est plus dessinée (le brouillard la cache déjà ; la caméra du JS s'arrête à 170 m)
const TREE_CARD_RANGE := [60.0, 190.0, 190.0]   ## portée des cartes de feuillage selon la qualité (Rapide : arbres plus proches seulement)
## Lampadaires (realworld.js : lightSources { color 0xffc77a, intensity 60, dist 20, y 4,2 }) : le JS redistribue 8 PointLight sur les sources les plus proches (LIGHTS = 8,
## décroissance 2) ; Three.js divise la diffusion par pi, pas Godot : énergie = intensité / pi, atténuation en 1 / d^2 comme Three.js.
const LAMP_ENERGY_K := 1.0 / PI   ## intensité Three.js -> énergie Godot
const LAMP_Y := 4.2
const LAMP_LIGHTS_MAX := 8        ## lampadaires éclairants : les plus proches du joueur (les autres restent des ampoules)

var load_ms := 0
var tile_count := 0
var triangle_count := 0
var _materials: Array = []
var _textures: Array = []         ## Texture2D ou null, par indice de textures.json
var _door_nodes: Dictionary = {}  ## id -> Node3D
var _lamp_lights: Array[OmniLight3D] = []
var _lamp_pos: Array = []         ## [x, y, z, couleur, intensité, portée]
var _lamp_door: Array[int] = []   ## porte dont dépend la source (-1 : aucune)
var _lamp_timer := 0.0
var _kinds: Dictionary = {}       ## "ground" / "water" / "facade" / "foliage" -> Array de ShaderMaterial (réglés par set_quality)
var _tree_cards: Array[MultiMeshInstance3D] = []

static func _json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))

signal progress(frac: float)   ## v0.14.0 : avancement de build() (0..1), pour la barre de l'écran de chargement

var built := false
var _slice_t := 0

## Cède la main au moteur (une image) quand ~10 ms de travail se sont écoulées : l'écran de chargement reste vivant et sa barre avance.
func _slice() -> void:
	if Time.get_ticks_usec() - _slice_t > 10000:
		await get_tree().process_frame
		_slice_t = Time.get_ticks_usec()

## Construit la carte (v0.14.0 : ce n'est plus fait dans _ready, pour pouvoir le répartir sur plusieurs images). À attendre : `await view.build()`.
func build() -> void:
	var t0 := Time.get_ticks_msec()
	_slice_t = Time.get_ticks_usec()
	await _load_textures()
	progress.emit(0.25)
	_load_materials()
	await _slice()
	var tiles: Dictionary = _json(DIR + "tiles.json")
	var n_tiles := (tiles["tiles"] as Array).size()
	var ti := 0
	for t: Dictionary in tiles["tiles"]:
		ti += 1
		progress.emit(0.25 + 0.6 * ti / maxf(1.0, n_tiles))
		await _slice()
		var mi := _mesh_from_pack(DIR + "tiles/t%s.bin" % t["key"])
		if mi != null:
			mi.visibility_range_end = TILE_VIS_RANGE
			add_child(mi)
			tile_count += 1
			triangle_count += int(t["tri"])
	await _slice()
	_load_doors()
	await _slice()
	_load_instances()
	await _slice()
	_lamps()
	progress.emit(1.0)
	built = true
	Game.door_opened.connect(_on_door_opened)
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "quality":
			set_quality(int(Game.settings.get_value("quality"))))
	set_quality(int(Game.settings.get_value("quality")))
	load_ms = Time.get_ticks_msec() - t0
	print("monde affiché : %d tuiles, %d triangles, %d matériaux, %d ms" % [tile_count, triangle_count, _materials.size(), load_ms])

func _process(dt: float) -> void:
	if not built:
		return
	_lamp_timer -= dt
	if _lamp_timer <= 0.0 and Game.player != null:
		_lamp_timer = 0.5
		_assign_lamps(Game.player.pos)

# ---------------------------------------------------------------- qualité (J9)
## Niveau de qualité (CONFIG.graphics.levels) : détail des façades, flaques et mousse du sol, couches de l'eau, vent et portée des arbres, ombres de la lune.
func set_quality(q: int) -> void:
	var L := GraphicsRules.level(q)
	# (le sol, ses flaques et le détail des façades sont dans le shader à tous les niveaux : le JS ne les retire pas en Rapide)
	for m: ShaderMaterial in _kinds.get("water", []):
		m.set_shader_parameter("layers", 1.0 if q == 0 else 2.0)
	for m: ShaderMaterial in _kinds.get("foliage", []):
		m.set_shader_parameter("wind_on", 0.0 if q == 0 else 1.0)
	for mm in _tree_cards:
		mm.visibility_range_end = float(TREE_CARD_RANGE[clampi(q, 0, 2)]) + (INSTANCE_CELL * 0.5 if q > 0 else 0.0)
	var shadows: bool = bool(L["shadows"])
	for c in get_children():
		if c is MeshInstance3D and c.has_meta("tile"):
			c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# ---------------------------------------------------------------- textures et matériaux
func _load_textures() -> void:
	var list: Array = _json(DIR + "textures.json")
	var n_tex := 0
	for t: Dictionary in list:
		n_tex += 1
		progress.emit(0.25 * n_tex / maxf(1.0, list.size()))
		await _slice()
		var path := String(t["file"])   # res:// direct : lisible depuis le .pck exporté
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
	var files: Array = []
	for t: Dictionary in _json(DIR + "textures.json"):
		files.append(String(t["file"]))
	for m: Dictionary in _json(DIR + "materials.json"):
		var k := Surfaces.kind(m, files)
		if k != "":
			var shm := Surfaces.make(k, m, _tex)
			if not _kinds.has(k):
				_kinds[k] = []
			_kinds[k].append(shm)
			_materials.append(shm)
			continue
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
	mi.set_meta("tile", true)   # set_quality règle les ombres portées (la lune)
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
		# les instances sont rangées par mailles de 160 m (comme les tuiles) : le culling par image et la portée de visibilité (distance au nœud, donc à la maille et
		# non à l'origine du monde) ne valent que par maille ; un seul MultiMesh pour toute la carte serait toujours « à l'écran » et caché à plus de 190 m de l'origine
		var buckets: Dictionary = {}
		for i in n:
			var key := Vector2i(floori(xf[i * 12 + 3] / INSTANCE_CELL), floori(xf[i * 12 + 11] / INSTANCE_CELL))
			var ids_k: PackedInt32Array = buckets.get(key, PackedInt32Array())
			ids_k.append(i)
			buckets[key] = ids_k   # (un tableau compact est copié à la lecture : il faut le réécrire)
		for s: Dictionary in m["surfaces"]:
			var mesh := ArrayMesh.new()
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, _surface_arrays(s, bytes, base, true))
			var mat: Material = _materials[int(s["mat"])]
			if has_col and mat is StandardMaterial3D:
				mat = mat.duplicate()
				(mat as StandardMaterial3D).vertex_color_use_as_albedo = true
			mesh.surface_set_material(0, mat)
			var foliage: bool = mat is ShaderMaterial and (mat as ShaderMaterial).shader == Surfaces.FOLIAGE
			for key: Vector2i in buckets:
				var ids: PackedInt32Array = buckets[key]
				var mm := MultiMesh.new()
				mm.transform_format = MultiMesh.TRANSFORM_3D
				mm.use_colors = has_col
				mm.mesh = mesh
				mm.instance_count = ids.size()
				var cx := (float(key.x) + 0.5) * INSTANCE_CELL
				var cz := (float(key.y) + 0.5) * INSTANCE_CELL
				for j in ids.size():
					var o := ids[j] * 12
					mm.set_instance_transform(j, Transform3D(
						Basis(Vector3(xf[o], xf[o + 4], xf[o + 8]), Vector3(xf[o + 1], xf[o + 5], xf[o + 9]), Vector3(xf[o + 2], xf[o + 6], xf[o + 10])),
						Vector3(xf[o + 3] - cx, xf[o + 7], xf[o + 11] - cz)))   # relatif au centre de la maille : le nœud y est posé
					if has_col:
						var c := ids[j] * 3
						mm.set_instance_color(j, Color(cols[c], cols[c + 1], cols[c + 2]))
				var mmi := MultiMeshInstance3D.new()
				mmi.multimesh = mm
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				mmi.visibility_range_end = TILE_VIS_RANGE + INSTANCE_CELL * 0.5   # + la moitié de la maille de la maille : la distance se mesure à son centre
				mmi.position = Vector3(cx, 0.0, cz)   # la portée de visibilité se mesure à l'origine du nœud, pas aux instances
				if foliage:
					_tree_cards.append(mmi)
				add_child(mmi)

# ---------------------------------------------------------------- sources de lumière
## Le JS redistribue 8 PointLight (décroissance 2) sur les sources les plus proches du joueur toutes les 0,4 s (realworld.js assignLights) : lampadaires (60, portée 20), panneaux
## de porte (9, 8), machines (7, 8), passages, parkings, rames, cathédrale… Les sources sont celles de data/graphics/lights.json (cuites par tools/bake-graphics.mjs). Three.js divise
## la diffusion par pi, pas Godot : énergie = intensité / pi. Les sources d'une porte s'éteignent quand elle s'ouvre.
func _lamps() -> void:
	var path := "res://data/graphics/lights.json"
	if FileAccess.file_exists(path):
		for l: Array in _json(path)["lights"]:
			_lamp_pos.append(l)
	else:   # sans le fichier de lumières : seulement les lampadaires (lamps.json)
		for lp: Array in _json(DIR + "lamps.json"):
			_lamp_pos.append([lp[0], LAMP_Y, lp[2], 0xffc77a, 60.0, 20.0])
	# une source de panneau de porte (couleur 0xff8844) appartient à la porte la plus proche
	_lamp_door.resize(_lamp_pos.size())
	_lamp_door.fill(-1)
	for i in _lamp_pos.size():
		if int(_lamp_pos[i][3]) != 0xff8844:
			continue
		var best := 1.0e18
		for d: Dictionary in Game.world.doors:
			for p: Array in d["points"]:
				var dd := Vector2(float(p[0]) - float(_lamp_pos[i][0]), float(p[1]) - float(_lamp_pos[i][2])).length_squared()
				if dd < best:
					best = dd
					_lamp_door[i] = int(d["id"])
	for _i in LAMP_LIGHTS_MAX:
		var l := OmniLight3D.new()
		l.omni_attenuation = 2.0
		l.shadow_enabled = false
		l.visible = false
		add_child(l)
		_lamp_lights.append(l)

func _assign_lamps(p: Vector3) -> void:
	if "--dbg-nolamps" in OS.get_cmdline_user_args():   # mise au point : sans lampadaires ni lumières de machines
		return
	var near: Array = []
	for i in _lamp_pos.size():
		var lp: Array = _lamp_pos[i]
		var d := Vector2(float(lp[0]) - p.x, float(lp[2]) - p.z).length_squared()
		if d < 60.0 * 60.0 and not (_lamp_door[i] >= 0 and bool(Game.world.doors[_lamp_door[i]]["open"])):
			near.append([d, lp])
	near.sort_custom(func(a, b): return a[0] < b[0])
	if "--dbg-lights" in OS.get_cmdline_user_args():
		print("lampes : %d proches de %s ; plus proche %s" % [near.size(), p, near[0] if near.size() > 0 else null])
	# l'Aube éteint peu à peu les lampadaires (summit.js : setLampScale(1 - 0,92 x lissage(min(1, k x 1,3))))
	var lk := minf(1.0, (Game.finale.sky_k if Game.finale != null else 0.0) * 1.3)
	var lamp_scale := 1.0 - 0.92 * (lk * lk * (3.0 - 2.0 * lk))
	for i in _lamp_lights.size():
		var l := _lamp_lights[i]
		if i < near.size():
			var lp: Array = near[i][1]
			l.position = Vector3(float(lp[0]), float(lp[1]), float(lp[2]))
			l.light_color = Config.color(int(lp[3]))
			l.light_energy = float(lp[4]) * LAMP_ENERGY_K * lamp_scale
			l.omni_range = float(lp[5])
			l.visible = true
		else:
			l.visible = false
