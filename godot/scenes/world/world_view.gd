extends Node3D
## Rendu de la carte de Strasbourg : lit la géométrie cuite par tools/bake-world.mjs (data/world/tiles/*.bin, doors/*.bin, instances.bin,
## materials.json, textures.json) et construit un ArrayMesh par tuile, des MultiMesh pour le décor instancié, et les portes (masquées à l'ouverture).
## Aucune règle ici : l'état des portes vient de Game.world. Formats : voir packSurfaces et le bloc « instances » de tools/bake-world.page.js.
## Les sommets cuits sont en sens trigonométrique (Three.js) : les index sont inversés au chargement (Godot : face avant = sens horaire).

const DIR := "res://data/world/"
const Surfaces := preload("res://scenes/world/surfaces.gd")
const GfxAssets := preload("res://scenes/gfx_assets.gd")
const PatchView := preload("res://scenes/world/patch_view.gd")
const VegetationView := preload("res://scenes/world/vegetation_view.gd")
const INSTANCE_CELL := 160.0      ## m : maille de rangement des instances (MultiMesh)
const TILE_VIS_RANGE := 190.0     ## m : au-delà, la tuile n'est plus dessinée (le brouillard la cache déjà ; la caméra du JS s'arrête à 170 m)
const TREE_CARD_RANGE := [60.0, 190.0, 190.0]   ## portée des cartes de feuillage selon la qualité (Rapide : arbres plus proches seulement)
## Lampadaires (realworld.js : lightSources { color 0xffc77a, intensity 60, dist 20, y 4,2 }) : le JS redistribue 8 PointLight sur les sources les plus proches (LIGHTS = 8,
## décroissance 2) ; Three.js divise la diffusion par pi, pas Godot : énergie = intensité / pi, atténuation en 1 / d^2 comme Three.js.
const LampGlow := preload("res://scenes/world/lamp_glow.gd")
const LAMP_ENERGY_K := 1.0 / PI   ## intensité Three.js -> énergie Godot
const FACADE_GLOW := 1.2         ## halo des fenêtres allumées (facade.gdshader, glow_k)
const LAMP_Y := 4.2
const BUMP_SCALE := 6.0          ## force de Image.bump_map_to_normal_map pour les bosses des façades
const LAMP_LIGHTS_MAX := 8        ## lampadaires éclairants : les plus proches du joueur (les autres restent des ampoules)

var load_ms := 0
var tile_count := 0
var triangle_count := 0
var _materials: Array = []
var _textures: Array = []         ## Texture2D ou null, par indice de textures.json
var _bump_ids: Dictionary = {}    ## indices de textures.json qui sont des cartes de bosses de façade
var _relief: Dictionary = {}      ## indice de bosse -> normale de relief (Texture2D)
var _door_nodes: Dictionary = {}  ## id -> Node3D
var _lamp_lights: Array[OmniLight3D] = []
var _glow: LampGlow
var _glow_gain := 1.0
var _glow_pools := true          ## flaques de lumière au sol : Normale et Haute
var _lamp_pos: Array = []         ## [x, y, z, couleur, intensité, portée]
var _lamp_door: Array[int] = []   ## porte dont dépend la source (-1 : aucune)
var _lamp_timer := 0.0
var _kinds: Dictionary = {}       ## "ground" / "water" / "facade" / "foliage" -> Array de ShaderMaterial (réglés par set_quality)
var _tree_cards: Array[MultiMeshInstance3D] = []
var _emissive: Array = []         ## v0.25.0 : matériaux dont l'émission s'éteint le jour : [matériau, énergie de base] (fenêtres, ampoules, enseignes de la carte)
var _lit := 1.0                   ## 1 : nuit (tout est allumé), 0 : plein jour ; suit DayNight.lamps_of(sky_k)
var _gv: Node
var _shop_mats: Dictionary = {}   ## v0.28.0 : materials of the JS wall boards and ammo stations (ShopView replaces them) -> surfaces dropped
var shop_surfaces_dropped := 0
## v0.32.0 : extérieur refait de la cathédrale (CathedralZone) : rôle des matériaux cuits ("flood", "facade", "roof") et matériaux de remplacement
const CathedralZone := preload("res://scenes/world/cathedral_zone.gd")
const CityDetails := preload("res://scenes/world/city_details_view.gd")
var details: Node3D
var _cath_role: Dictionary = {}
var _cath_stone: ShaderMaterial
var _cath_roof: ShaderMaterial
var _cath_rect := Rect2()
var _cath_inwall: Dictionary = {}   ## indice du matériau cuit -> ShaderMaterial (cath_inwall.gdshader), émission réglée par _apply_lit
var cath_tris := [0, 0, 0, 0, 0, 0, 0]
var _cath_extra: Dictionary = {}    ## v0.32.1 : indice du matériau cuit -> plafond de pierre (cath_vault.gdshader)
var _cath_floor: ShaderMaterial     ## v0.32.1 : dallage (cath_floor.gdshader)     ## triangles cuits : gardés, passés en pierre, en toiture, retirés (dans les tuiles qui touchent l'emprise)

static func _json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))

signal progress(frac: float)   ## v0.14.0 : avancement de build() (0..1), pour la barre de l'écran de chargement

var built := false
var _slice_t := 0

## Cède la main au moteur (une image) quand ~10 ms de travail se sont écoulées : l'écran de chargement reste vivant et sa barre avance.
func _slice() -> void:
	if Time.get_ticks_usec() - _slice_t > 10000:
		var ty := Time.get_ticks_usec()
		await get_tree().process_frame
		_slice_t = Time.get_ticks_usec()
		_yield_us += _slice_t - ty
		_yield_n += 1

## v0.34.6 : étapes de build() dans le journal de démarrage (temps total, dont travail hors des images cédées).
var _yield_us := 0
var _yield_n := 0
var _st_us := 0
var _st_y := 0
var _st_n := 0
func _stage(label: String) -> void:
	if not StartupLog.on:
		return
	var now := Time.get_ticks_usec()
	StartupLog.mark("city: " + label, "%.0f ms, work %.0f ms, %d frames" % [(now - _st_us) / 1000.0, (now - _st_us - (_yield_us - _st_y)) / 1000.0, _yield_n - _st_n])
	_st_us = now
	_st_y = _yield_us
	_st_n = _yield_n

## v0.34.6 : `fn(i)` pour i dans [0, n) sur les fils du WorkerThreadPool (tâche de groupe prioritaire) ; l'écran de chargement continue de s'animer et sa barre
## va de frac0 à frac1. Renvoie les résultats dans l'ordre. `fn` ne doit toucher ni à l'arbre de scène ni à un état partagé modifiable.
var _jobs_mutex := Mutex.new()
var _jobs_done := 0
func _run_jobs(n: int, fn: Callable, frac0: float, frac1: float, label: String) -> Array:
	var out: Array = []
	out.resize(n)
	if n == 0:
		return out
	_jobs_done = 0
	var job := func(i: int) -> void:
		var r: Variant = fn.call(i)
		_jobs_mutex.lock()
		out[i] = r
		_jobs_done += 1
		_jobs_mutex.unlock()
	var gid := WorkerThreadPool.add_group_task(job, n, maxi(1, OS.get_processor_count() - 2), true, label)   # deux fils laissés au moteur (rendu)
	while not WorkerThreadPool.is_group_task_completed(gid):
		progress.emit(frac0 + (frac1 - frac0) * float(_jobs_done) / float(n))
		await _frame()
	WorkerThreadPool.wait_for_group_task_completion(gid)
	progress.emit(frac1)
	return out

## Une image de l'écran de chargement (comptée dans le journal comme les images cédées par _slice).
func _frame() -> void:
	var ty := Time.get_ticks_usec()
	await get_tree().process_frame
	_slice_t = Time.get_ticks_usec()
	_yield_us += _slice_t - ty
	_yield_n += 1

## Construit la carte (v0.14.0 : ce n'est plus fait dans _ready, pour pouvoir le répartir sur plusieurs images). À attendre : `await view.build()`.
var _no_cathedral := OS.get_cmdline_user_args().has("--dbg-nocath")

func build() -> void:
	var t0 := Time.get_ticks_msec()
	_slice_t = Time.get_ticks_usec()
	_st_us = _slice_t
	if CityDetails.exists() and not OS.get_cmdline_user_args().has("--dbg-nodetails"):
		CityDetails.start()   # v0.34.6 : calcul des détails sur un fil de travail, pendant les textures et les tuiles
	_start_grass_job()
	await _load_textures()
	_stage("textures")
	progress.emit(0.25)
	await _load_materials()
	_plank_materials()
	_stage("materials")
	await _slice()
	if not _no_cathedral and not OS.get_cmdline_user_args().has("--dbg-cath031"):   # --dbg-cath031 : extérieur de la v0.31 (comparaisons)
		_cath_rect = CathedralZone.world_rect().grow(2.0)
		_cath_stone = Surfaces.make("stone", {"c": 0xa87c6a, "map": -1}, _tex)
		_cath_stone.set_shader_parameter("flood_energy", 0.7)   # la couleur de sommet du contour cuit (teinte rose ~0,9) sert d'occlusion : lavis un peu moins fort
		_cath_roof = preload("res://scenes/world/cathedral_view.gd").make_roof_mat()
		_cath_roof.set_shader_parameter("use_vc", 0.0)
	# v0.34.6 : tuiles lues et converties en maillages sur les fils du WorkerThreadPool (avant : sur le fil principal, ~1,3 s), assemblées ici dans l'ordre
	var tiles: Dictionary = _json(DIR + "tiles.json")
	_prepare_tile_jobs()
	var jobs: Array = []
	for t: Dictionary in tiles["tiles"]:
		var kk := String(t["key"]).split("_")
		var trect := Rect2(float(tiles["x0"]) + float(kk[0]) * float(tiles["tile"]), float(tiles["z0"]) + float(kk[1]) * float(tiles["tile"]), float(tiles["tile"]), float(tiles["tile"]))
		jobs.append([DIR + "tiles/t%s.bin" % t["key"], _cath_rect.size.x > 0.0 and trect.intersects(_cath_rect)])
	var res: Array = await _run_jobs(jobs.size(), func(i: int) -> Variant: return _mesh_data(jobs[i][0], jobs[i][1]), 0.25, 0.85, "city tiles")
	for i in res.size():
		await _slice()
		var mi := _mesh_instance(res[i])
		if mi != null:
			mi.visibility_range_end = TILE_VIS_RANGE
			add_child(mi)
			tile_count += 1
			triangle_count += int(tiles["tiles"][i]["tri"])
	_stage("tiles")
	await _slice()
	var patches := PatchView.build()   # v0.23.2 : murs de collision sans surface dessinée
	if patches != null:
		add_child(patches)
	_load_doors()
	_stage("patches and doors")
	await _slice()
	if CityDetails.exists() and not OS.get_cmdline_user_args().has("--dbg-nodetails"):   # v0.32.2 : fenêtres, volets, balcons, gouttières, cheminées en 3D
		details = CityDetails.new()
		add_child(details)
		await details.build(_slice)
	_stage("city details")
	if not _no_cathedral:
		var cv := preload("res://scenes/world/cathedral_view.gd").new()
		add_child(cv)
		cv.build()
	_stage("cathedral")
	await _frame()
	_load_instances()
	_stage("instances")
	await _slice()
	await _grass_mask()
	_stage("grass and vegetation")
	if not _water_cells.is_empty():   # v0.32.5 : reflet plan de l'eau (Haute)
		var cells := PackedVector2Array()
		for k: Vector2i in _water_cells:
			cells.append(Vector2((k.x + 0.5) * 48.0, (k.y + 0.5) * 48.0))
		water_reflection = preload("res://scenes/world/water_reflection.gd").new()
		add_child(water_reflection)
		water_reflection.setup(cells, _kinds.get("water", []))
	_lamps()
	_stage("water and lamps")
	progress.emit(1.0)
	built = true
	Game.door_opened.connect(_on_door_opened)
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "quality":
			set_quality(int(Game.settings.get_value("quality"))))
	set_quality(int(Game.settings.get_value("quality")))
	load_ms = Time.get_ticks_msec() - t0
	print("monde affiché : %d tuiles, %d triangles, %d matériaux, %d ms ; cathédrale (tuiles) : %d gardés, %d en pierre, %d en toiture, %d retirés, %d murs intérieurs à deux faces, %d plafonds, %d dallage" % [tile_count, triangle_count, _materials.size(), load_ms, cath_tris[0], cath_tris[1], cath_tris[2], cath_tris[3], cath_tris[4], cath_tris[5], cath_tris[6]])

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"monde", _pt)

func _tick(dt: float) -> void:
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
	if water_reflection != null:
		water_reflection.set_enabled(q >= 2)
	for m: ShaderMaterial in _kinds.get("facade", []):   # v0.22.4 : halo des fenêtres (une lecture de texture de plus par pixel de façade) : Normale et Haute
		m.set_shader_parameter("glow_k", 0.0 if q == 0 or "--dbg-nowinglow" in OS.get_cmdline_user_args() else FACADE_GLOW * _lit)
		if m.get_shader_parameter("bump_tex") != null:   # v0.24.1 : Rapide = ancien rendu ; Normale = PBR + relief ; Haute = + bois PBR des colombages
			m.set_shader_parameter("pbr_k", 0.0 if q == 0 else 1.0)
			m.set_shader_parameter("pbr_hi", 1.0 if q >= 2 else 0.0)
			m.set_shader_parameter("recess", 0.0 if "--dbg-norecess" in OS.get_cmdline_user_args() else 0.16)   # v0.32.2 : vitres en retrait (parallaxe)
	for m: ShaderMaterial in _kinds.get("roof", []):   # v0.24.4 : toits PBR en Normale et Haute
		m.set_shader_parameter("pbr_k", 0.0 if q == 0 else 1.0)
	for m: ShaderMaterial in _kinds.get("foliage", []):
		m.set_shader_parameter("wind_on", 0.0 if q == 0 else 1.0)
		m.set_shader_parameter("vary", 0.0 if q == 0 else 1.0)
	for mm in _tree_cards:
		mm.visibility_range_end = float(TREE_CARD_RANGE[clampi(q, 0, 2)]) + (INSTANCE_CELL * 0.5 if q > 0 else 0.0)
	_glow_pools = q >= 1
	if _glow != null:
		_glow.set_state(_glow_gain, _glow_pools)
	var shadows: bool = bool(L["shadows"])
	for c in get_children():
		if c is MeshInstance3D and c.has_meta("tile"):
			c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# ---------------------------------------------------------------- textures et matériaux
func _load_textures() -> void:
	var list: Array = _json(DIR + "textures.json")
	for m: Dictionary in _json(DIR + "materials.json"):
		if m.has("bmap") and int(m["bmap"]) >= 0 and bool(m["vc"]) and int(m["emap"]) >= 0:
			_bump_ids[int(m["bmap"])] = true
	# v0.34.6 : lecture et mipmaps sur les fils du WorkerThreadPool (avant : une par une sur le fil principal) ; la compression (BC5) et la création des
	# textures restent ici (elles passent par le serveur de rendu : sur un fil de travail, la compression bloquait le jeu)
	var compress := DisplayServer.get_name() != "headless"
	var res: Array = await _run_jobs(list.size(), func(i: int) -> Variant: return _texture_job(String(list[i]["file"]), _bump_ids.has(i)), 0.0, 0.2, "city textures")
	for i in res.size():
		var r: Array = res[i]
		if r[1] != null:
			var nimg: Image = r[1]
			if compress:
				nimg.compress_from_channels(Image.COMPRESS_S3TC, Image.USED_CHANNELS_RG)
			_relief[i] = ImageTexture.create_from_image(nimg)
		_textures.append(ImageTexture.create_from_image(r[0]) if r[0] != null else null)
		if i % 16 == 15:
			progress.emit(0.2 + 0.05 * float(i) / float(res.size()))
			await _slice()

## [image ou null, normale de relief (non compressée) ou null] (fil de travail : aucun état partagé, aucun appel au serveur de rendu).
static func _texture_job(path: String, bump: bool) -> Array:
	var img := Image.load_from_file(path)   # res:// direct : lisible depuis le .pck exporté
	if img == null or img.is_empty():
		push_warning("texture absente : %s" % path)
		return [null, null]
	if img.get_format() != Image.FORMAT_RGBA8 and img.get_format() != Image.FORMAT_RGB8:
		img.convert(Image.FORMAT_RGBA8)
	var relief: Image = null
	if bump:   # v0.24.1 : carte de bosses des façades : la normale de relief est calculée ici (Image.bump_map_to_normal_map, natif) puis compressée (BC5)
		var nimg := img.duplicate() as Image
		nimg.bump_map_to_normal_map(BUMP_SCALE)
		nimg.generate_mipmaps()
		relief = nimg
		img.convert(Image.FORMAT_L8)
	img.generate_mipmaps()
	return [img, relief]

func _relief_tex(i: int) -> Texture2D:
	return _relief.get(i)

func _tex(i: int) -> Texture2D:
	return null if i < 0 or i >= _textures.size() else _textures[i]

func _load_materials() -> void:
	var files: Array = []
	for t: Dictionary in _json(DIR + "textures.json"):
		files.append(String(t["file"]))
	var keep_shops := "--dbg-oldshops" in OS.get_cmdline_user_args()
	for m: Dictionary in _json(DIR + "materials.json"):
		await _slice()   # v0.34.6 : l'écran de chargement s'anime entre deux matériaux (la première compilation de chaque shader coûte des dizaines de ms)
		if not keep_shops and ShopView.baked_shop_material(m):
			_shop_mats[_materials.size()] = true
		var k := Surfaces.kind(m, files)
		if k == "facade":
			_cath_role[_materials.size()] = "flood" if int(m.get("rank", 0)) == 23 else "facade"
		elif k == "roof":
			_cath_role[_materials.size()] = "roof"
		if k != "":
			var shm := Surfaces.make(k, m, _tex, _relief_tex)
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
			_emissive.append([sm, float(m["ei"])])
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
		if int(m["side"]) == 2 and not bool(m["vc"]) and int(m["map"]) >= 0 and int(m["emap"]) >= 0 and em != 0 and not bool(m["tr"]):
			_cath_role[_materials.size()] = "inwall"
		elif int(m["side"]) == 2 and not bool(m["vc"]) and int(m["map"]) >= 0 and em == 0 and not bool(m["tr"]) and not bool(m["basic"]) and int(m["c"]) == 0xffffff \
				and float(m["at"]) == 0.0 and _tex(int(m["map"])) != null:
			# v0.32.1 : plafond peint (fond bleu étoilé) ou dallage de l'intérieur de la cathédrale : reconnus à la couleur moyenne de leur texture
			var avg := (_tex(int(m["map"])).get_image() as Image)
			avg = avg.duplicate() as Image
			avg.clear_mipmaps()
			if avg.is_compressed():
				avg.decompress()
			avg.resize(32, 32, Image.INTERPOLATE_NEAREST)   # 1 024 échantillons répartis (un seul échantillon bilinéaire tombait sur la clé dorée), rapide
			var ac := Color(0, 0, 0, 0)
			for py in 32:
				for px in 32:
					ac += avg.get_pixel(px, py) / 1024.0
			_cath_role[_materials.size()] = "vault" if ac.b > maxf(ac.r, ac.g) + 0.04 else "plain"
			if OS.get_cmdline_user_args().has("--dbg-cathroles"):
				print("matériau %d : %s (moyenne %s)" % [_materials.size(), _cath_role[_materials.size()], ac])
		if bool(m["nodw"]):
			sm.no_depth_test = false
			sm.disable_receive_shadows = true
		_materials.append(sm)

## v0.32.2 : bois PBR « wood_door » sur les planches des portes barricadées : le matériau texturé le plus employé par les portes cuites (et les mêmes
## planches ailleurs : fenêtres condamnées, instances) devient shaders/planks.gdshader.
var planks_material := -1
func _plank_materials() -> void:
	if "--dbg-noplanks" in OS.get_cmdline_user_args() or Game.world == null:
		return
	var use := {}
	for d: Dictionary in Game.world.doors:
		var path := DIR + "doors/d%d.bin" % int(d["id"])
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null or f.get_length() < 8:
			continue
		if f.get_buffer(4).get_string_from_ascii() != "ZMP1":
			continue
		var hlen := f.get_32()
		var head: Dictionary = JSON.parse_string(f.get_buffer(hlen).get_string_from_utf8())
		for sf: Dictionary in head["surfaces"]:
			var mi := int(sf["mat"])
			if _materials[mi] is StandardMaterial3D and (_materials[mi] as StandardMaterial3D).albedo_texture != null:
				use[mi] = int(use.get(mi, 0)) + int(sf["ni"])
	var best := -1
	for mi: int in use:
		if best < 0 or int(use[mi]) > int(use[best]):
			best = mi
	if best < 0:
		return
	var src: StandardMaterial3D = _materials[best]
	var pm := ShaderMaterial.new()
	pm.shader = load("res://shaders/planks.gdshader")
	pm.set_shader_parameter("albedo_tex", src.albedo_texture)
	pm.set_shader_parameter("wood_a", load("res://assets/pbr/wood_door/a.png"))
	pm.set_shader_parameter("wood_m", load("res://assets/pbr/wood_door/m.png"))
	pm.set_shader_parameter("uv_scale", Vector2(src.uv1_scale.x, src.uv1_scale.y))
	_materials[best] = pm
	planks_material = best

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

## v0.34.6 : partie sans état partagé (appelée sur les fils de travail pour les tuiles) : { mesh (ArrayMesh ou null), water (mailles d'eau), cath (triangles par sort),
## dropped (surfaces de panneaux retirées) }. Les matériaux de la cathédrale sont créés avant (_prepare_tile_jobs).
func _mesh_data(path: String, cath := false) -> Dictionary:
	var out := {"surfaces": [], "water": {}, "cath": [0, 0, 0, 0, 0, 0, 0], "dropped": 0}
	var pk := _open_pack(path, "ZMP1")
	if pk.is_empty():
		return out
	var head: Dictionary = pk[0]
	var surfs: Array = out["surfaces"]
	var water: Dictionary = out["water"]
	for s: Dictionary in head["surfaces"]:
		if _shop_mats.has(int(s["mat"])):
			out["dropped"] = int(out["dropped"]) + 1
			continue
		var arr := _surface_arrays(s, pk[1], pk[2], true)
		if _water_mats.has(int(s["mat"])):
			var wv: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			for i in range(0, wv.size(), 3):
				water[Vector2i(floori(wv[i].x / 48.0), floori(wv[i].z / 48.0))] = true
		if cath and _cath_role.has(int(s["mat"])):
			_add_cath_split(surfs, arr, int(s["mat"]), out["cath"])
			continue
		surfs.append([arr, _materials[int(s["mat"])]])
	return out

## Fil principal : compteurs, mailles d'eau, nœud.
func _mesh_instance(d: Dictionary) -> MeshInstance3D:
	shop_surfaces_dropped += int(d["dropped"])
	for k: Vector2i in d["water"]:
		_water_cells[k] = true
	for c in 7:
		cath_tris[c] += int(d["cath"][c])
	if (d["surfaces"] as Array).is_empty():
		return null
	var mesh := ArrayMesh.new()
	for sf: Array in d["surfaces"]:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, sf[0])
		mesh.surface_set_material(mesh.get_surface_count() - 1, sf[1])
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.set_meta("tile", true)   # set_quality règle les ombres portées (la lune)
	return mi

func _mesh_from_pack(path: String, cath := false) -> MeshInstance3D:
	return _mesh_instance(_mesh_data(path, cath))

## v0.34.6 : avant les tâches des tuiles : matériaux d'eau repérés, et matériaux de remplacement de la cathédrale créés pour chaque rôle (avant : à la
## première tuile qui en avait besoin ; les fils de travail ne créent rien).
var _water_mats: Dictionary = {}
func _prepare_tile_jobs() -> void:
	for i in _materials.size():
		if _materials[i] is ShaderMaterial and (_materials[i] as ShaderMaterial).shader == Surfaces.WATER:
			_water_mats[i] = true
	if _cath_rect.size.x <= 0.0:
		return
	for mat: int in _cath_role:
		_cath_material(String(_cath_role[mat]), mat)

## v0.32.0 : répartit les triangles d'une surface cuite entre son matériau, la pierre et la toiture de la cathédrale (ou les retire), voir CathedralZone.
func _add_cath_split(surfs: Array, arr: Array, mat: int, counts: Array) -> void:
	var role: String = _cath_role[mat]
	var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var parts := [PackedInt32Array(), PackedInt32Array(), PackedInt32Array(), PackedInt32Array(), PackedInt32Array(), PackedInt32Array(), PackedInt32Array()]
	var t := 0
	while t + 2 < idx.size():
		var c := CathedralZone.classify(role, v[idx[t]], v[idx[t + 1]], v[idx[t + 2]])
		counts[c] += 1
		if c != CathedralZone.DROP:
			var p: PackedInt32Array = parts[c]
			p.append(idx[t])
			p.append(idx[t + 1])
			p.append(idx[t + 2])
			parts[c] = p
		t += 3
	var mats: Array = [_materials[mat], _cath_stone, _cath_roof, null, _cath_inwall.get(mat), _cath_extra.get(mat), _cath_floor]
	for k in [0, 1, 2, 4, 5, 6]:
		var p: PackedInt32Array = parts[k]
		if p.is_empty():
			continue
		var a2 := arr.duplicate()
		a2[Mesh.ARRAY_INDEX] = p
		surfs.append([a2, mats[k]])

## Matériau de remplacement d'un rôle de la cathédrale (créé une fois, sur le fil principal).
func _cath_material(role: String, mat: int) -> void:
	if role == "inwall" and not _cath_inwall.has(mat):
		var src: StandardMaterial3D = _materials[mat]
		var im := ShaderMaterial.new()
		im.shader = load("res://shaders/cath_inwall.gdshader")
		im.set_shader_parameter("albedo_tex", src.albedo_texture)
		im.set_shader_parameter("emis_tex", src.emission_texture)
		im.set_shader_parameter("emis_color", src.emission)
		im.set_shader_parameter("emis_energy", src.emission_energy_multiplier * (0.5 + 0.8 * (1.0 - _lit)))
		im.set_shader_parameter("roughness", src.roughness)
		im.set_shader_parameter("stone_a", Surfaces.PBR_STONE_BIG_A)
		im.set_shader_parameter("stone_m", Surfaces.PBR_STONE_BIG_M)
		im.set_meta("emis_base", src.emission_energy_multiplier)
		im.set_shader_parameter("night", _lit)
		_cath_inwall[mat] = im
	if role == "vault" and not _cath_extra.has(mat):
		var vm := ShaderMaterial.new()
		vm.shader = load("res://shaders/cath_vault.gdshader")
		vm.set_shader_parameter("albedo_tex", (_materials[mat] as StandardMaterial3D).albedo_texture)
		vm.set_shader_parameter("stone_a", Surfaces.PBR_STONE_BIG_A)
		vm.set_shader_parameter("stone_m", Surfaces.PBR_STONE_BIG_M)
		_cath_extra[mat] = vm
	if role == "plain" and _cath_floor == null:
		_cath_floor = ShaderMaterial.new()
		_cath_floor.shader = load("res://shaders/cath_floor.gdshader")
		_cath_floor.set_shader_parameter("stone_a", Surfaces.PBR_STONE_BIG_A)
		_cath_floor.set_shader_parameter("stone_m", Surfaces.PBR_STONE_BIG_M)
		var o := Cathedral.P(0.0, 0.0)
		var u := Cathedral.P(1.0, 0.0) - o
		_cath_floor.set_shader_parameter("origin", Vector3(o.x, 0.0, o.y))
		_cath_floor.set_shader_parameter("axis_u", Vector3(u.x, 0.0, u.y))

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
	var car_sig := _car_signature(pk[0]["meshes"], bytes, base)   # v0.32.4 : voitures du JS remplacées par CarsView
	for m: Dictionary in pk[0]["meshes"]:
		var n := int(m["count"])
		if n <= 0:
			continue
		if not car_sig.is_empty() and n == int(car_sig["n"]) and bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + 48) == car_sig["sig"]:
			continue
		var xf := bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + n * 48).to_float32_array()
		var cols := PackedFloat32Array()
		var has_col := m["colors"] != null
		if has_col:
			cols = bytes.slice(base + int(m["colors"]), base + int(m["colors"]) + n * 12).to_float32_array()
		# les instances sont rangées par mailles de 160 m (comme les tuiles) : le culling par image et la portée de visibilité (distance au nœud, donc à la maille et
		# non à l'origine du monde) ne valent que par maille ; un seul MultiMesh pour toute la carte serait toujours « à l'écran » et caché à plus de 190 m de l'origine
		if String(m.get("name", "")) == "trees" and n < 10000:   # v0.32.3 : troncs : positions des arbres (pelouses, fosses)
			for i in n:
				_tree_pos.append(Vector2(xf[i * 12 + 3], xf[i * 12 + 11]))
		var buckets: Dictionary = {}
		for i in n:
			var key := Vector2i(floori(xf[i * 12 + 3] / INSTANCE_CELL), floori(xf[i * 12 + 11] / INSTANCE_CELL))
			var ids_k: PackedInt32Array = buckets.get(key, PackedInt32Array())
			ids_k.append(i)
			buckets[key] = ids_k   # (un tableau compact est copié à la lecture : il faut le réécrire)
		for s: Dictionary in m["surfaces"]:
			if _shop_mats.has(int(s["mat"])):
				shop_surfaces_dropped += 1
				continue
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

## v0.32.4 : repère la caisse des voitures garées du JS (instances colorées d'environ 4,4 x 1,2 x 1,7 m) ; construit CarsView avec leurs transformations et couleurs
## et renvoie la signature (nombre, première transformation) qui désigne toutes leurs pièces (caisse, vitres, roues, pare-chocs, feux), écartées du décor cuit.
const CarsView := preload("res://scenes/world/cars_view.gd")
var cars: Node3D
func _car_signature(meshes: Array, bytes: PackedByteArray, base: int) -> Dictionary:
	if "--dbg-oldcars" in OS.get_cmdline_user_args():
		return {}
	for m: Dictionary in meshes:
		var n := int(m["count"])
		if n <= 0 or m["colors"] == null or (m["surfaces"] as Array).is_empty():
			continue
		var sf: Dictionary = m["surfaces"][0]
		var pos := bytes.slice(base + int(sf["pos"]), base + int(sf["pos"]) + int(sf["nv"]) * 12).to_float32_array()
		var lo := Vector3(INF, INF, INF)
		var hi := -lo
		for i in int(sf["nv"]):
			var v := Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
			lo = lo.min(v)
			hi = hi.max(v)
		var e := hi - lo
		if e.x > 4.0 and e.x < 4.8 and e.y > 1.0 and e.y < 1.6 and e.z > 1.5 and e.z < 2.0:
			var xf := bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + n * 48).to_float32_array()
			var cols := bytes.slice(base + int(m["colors"]), base + int(m["colors"]) + n * 12).to_float32_array()
			var xfs: Array = []
			var cc: Array = []
			for i in n:
				var o := i * 12
				xfs.append(Transform3D(Basis(Vector3(xf[o], xf[o + 4], xf[o + 8]), Vector3(xf[o + 1], xf[o + 5], xf[o + 9]), Vector3(xf[o + 2], xf[o + 6], xf[o + 10])), Vector3(xf[o + 3], xf[o + 7], xf[o + 11])))
				cc.append(Color(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]))
			cars = CarsView.new()
			add_child(cars)
			cars.build(xfs, cc)
			return {"n": n, "sig": bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + 48)}
	return {}

## v0.32.3 : masque des pelouses (R : densité d'arbres) et des fosses d'arbres (G), 1 m par texel sur l'emprise du champ de distance du sol ; lu par ground.gdshader.
var _tree_pos: PackedVector2Array = []
var grass_texture: ImageTexture
var vegetation: Node3D
var _water_cells: Dictionary = {}
var water_reflection: Node
## v0.34.6 : masque des pelouses et placement de la végétation sur un fil de travail, lancé au début de build() (avant : ~0,4 s sur le fil principal après les
## instances) : le fil relit lui-même les positions des troncs (instances.bin) et le champ de distance du sol (ground_sdf.png).
var _grass_task := -1
var _grass_res: Array = []
var _grass_args: Array = []
func _start_grass_job() -> void:
	var meta := GfxAssets.meta()
	if meta.is_empty() or "--dbg-nograss" in OS.get_cmdline_user_args():
		return
	var o: Array = meta["sdf_origin"]
	var sz: Array = meta["sdf_size"]
	var w := int(ceil(float(sz[0])))
	var h := int(ceil(float(sz[1])))
	var origin := Vector2(float(o[0]), float(o[1]))
	var vege := not "--dbg-novege" in OS.get_cmdline_user_args()
	var sdf_min := float(meta["sdf_min"])
	var sdf_range := float(meta["sdf_range"])
	_grass_args = [w, h, vege]
	_grass_task = WorkerThreadPool.add_task(func() -> void:
		var trees := tree_positions(DIR + "instances.bin")
		if trees.is_empty():
			return
		var sdf: Image = null
		if vege:
			sdf = Image.load_from_file(GfxAssets.DIR + "ground_sdf.png")
			if sdf != null and sdf.is_empty():
				sdf = null
		var data := grass_mask_data(trees, w, h, origin)
		_grass_res = [trees, data, VegetationView.place(trees, data, w, h, origin, sdf, sdf_min, sdf_range) if vege else []], true, "grass mask")

## Positions (x, z) des troncs d'arbres du décor instancié (maillage « trees » de moins de 10 000 instances), comme _load_instances. Fonction pure.
static func tree_positions(path: String) -> PackedVector2Array:
	var out := PackedVector2Array()
	var pk := _open_pack(path, "ZMI1")
	if pk.is_empty():
		return out
	var bytes: PackedByteArray = pk[1]
	var base: int = pk[2]
	for m: Dictionary in pk[0]["meshes"]:
		var n := int(m["count"])
		if n <= 0 or String(m.get("name", "")) != "trees" or n >= 10000:
			continue
		var xf := bytes.slice(base + int(m["xf"]), base + int(m["xf"]) + n * 48).to_float32_array()
		for i in n:
			out.append(Vector2(xf[i * 12 + 3], xf[i * 12 + 11]))
	return out

func _grass_mask() -> void:
	if _grass_task < 0:
		return
	while not WorkerThreadPool.is_task_completed(_grass_task):
		await _frame()
	WorkerThreadPool.wait_for_task_completion(_grass_task)
	_grass_task = -1
	if _grass_res.is_empty() or _tree_pos.is_empty():
		return
	if _grass_res[0] != _tree_pos:
		push_warning("végétation : positions des arbres différentes de celles du décor")
	var w: int = _grass_args[0]
	var h: int = _grass_args[1]
	var img := Image.create_from_data(w, h, false, Image.FORMAT_RG8, _grass_res[1])
	grass_texture = ImageTexture.create_from_image(img)
	# v0.32.4 : touffes d'herbe et grilles d'arbres (même masque)
	if bool(_grass_args[2]):
		vegetation = VegetationView.new()
		add_child(vegetation)
		vegetation.build_placed(_grass_res[2][0], _grass_res[2][1])
	_grass_res = []
	for m: ShaderMaterial in _kinds.get("ground", []):
		m.set_shader_parameter("grass_mask", grass_texture)
		m.set_shader_parameter("grass_a", load("res://assets/pbr/ground_grass/a.png"))
		m.set_shader_parameter("grass_m", load("res://assets/pbr/ground_grass/m.png"))
		m.set_shader_parameter("grass_on", 1.0)

## Masque des pelouses (R : densité d'arbres) et des fosses d'arbres (G), 1 m par texel (w x h, origine o). Fonction pure.
static func grass_mask_data(trees: PackedVector2Array, w: int, h: int, o: Vector2) -> PackedByteArray:
	var dens := PackedFloat32Array()
	dens.resize(w * h)
	var pit := PackedByteArray()
	pit.resize(w * h)
	var R := 9.0
	for p in trees:
		var cx := p.x - o.x
		var cz := p.y - o.y
		for iz in range(maxi(0, int(cz - R)), mini(h, int(cz + R) + 1)):
			for ix in range(maxi(0, int(cx - R)), mini(w, int(cx + R) + 1)):
				var d := Vector2(ix + 0.5 - cx, iz + 0.5 - cz).length()
				if d < R:
					var k := 1.0 - d / R
					dens[iz * w + ix] += k * k * 0.34
					if d < 1.6:
						pit[iz * w + ix] = maxi(pit[iz * w + ix], int(255.0 * clampf((1.6 - d) / 0.6, 0.0, 1.0)))
	var data := PackedByteArray()
	data.resize(w * h * 2)
	for i in w * h:
		data[i * 2] = int(clampf(dens[i], 0.0, 1.0) * 255.0)
		data[i * 2 + 1] = pit[i]
	return data

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
	_glow = LampGlow.new()   # v0.22.2 : halos et flaques de lumière de toutes les sources fixes (les 8 plus proches éclairent en plus)
	add_child(_glow)
	_glow.setup(_lamp_pos)
	_glow.set_state(1.0, _glow_pools)
	for _i in LAMP_LIGHTS_MAX:
		var l := OmniLight3D.new()
		l.omni_attenuation = 2.0
		l.shadow_enabled = false
		l.visible = false
		add_child(l)
		_lamp_lights.append(l)

## Fenêtres, ampoules et enseignes : l'émission suit `lit` (1 la nuit, 0 le jour) ; le halo des fenêtres aussi.
func _apply_lit(lit: float) -> void:
	if absf(lit - _lit) < 0.01 and not (lit <= 0.0 and _lit > 0.0) and not (lit >= 1.0 and _lit < 1.0):
		return
	_lit = lit
	if _cath_stone != null:   # v0.32.0 : projecteurs de la cathédrale sur la pierre du contour cuit, comme sur la peau procédurale
		_cath_stone.set_shader_parameter("night", lit)
	for im: ShaderMaterial in _cath_inwall.values():
		im.set_shader_parameter("emis_energy", float(im.get_meta("emis_base")) * (0.5 + 0.8 * (1.0 - lit)))   # v0.32.1 : vitraux vus de l'intérieur : vifs de jour (le soleil les traverse), plus sourds la nuit
		im.set_shader_parameter("night", lit)
	for m: ShaderMaterial in _kinds.get("facade", []):
		if m.get_meta("emis_base", -1.0) < 0.0:
			m.set_meta("emis_base", float(m.get_shader_parameter("emission_energy")))
		m.set_shader_parameter("emission_energy", float(m.get_meta("emis_base")) * lit)
		if float(m.get_shader_parameter("glow_k")) > 0.0 or lit > 0.0:
			m.set_shader_parameter("glow_k", 0.0 if int(Game.settings.get_value("quality")) == 0 or "--dbg-nowinglow" in OS.get_cmdline_user_args() else FACADE_GLOW * lit)
	for e: Array in _emissive:
		(e[0] as StandardMaterial3D).emission_energy_multiplier = float(e[1]) * lit

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
	# v0.25.0 : lampadaires et fenêtres suivent le ciel (cycle jour / nuit, ou l'Aube de la finale) : allumés au crépuscule, éteints à l'aube ; il en reste 8 % de jour (summit.js : 1 - 0,92 x lissage)
	if _gv == null:
		_gv = get_tree().get_first_node_in_group("graphics_view")
	var lit := DayNight.lamps_of(float(_gv.sky_k) if _gv != null else 0.0)
	_apply_lit(lit)
	var lamp_scale := 0.08 + 0.92 * lit
	_glow_gain = lamp_scale
	_glow.set_state(lamp_scale, _glow_pools)
	for i in _lamp_lights.size():
		var l := _lamp_lights[i]
		if i < near.size():
			var lp: Array = near[i][1]
			l.position = Vector3(float(lp[0]), float(lp[1]), float(lp[2]))
			l.light_color = Config.color(int(lp[3]))
			l.light_energy = float(lp[4]) * LAMP_ENERGY_K * lamp_scale
			l.omni_range = float(lp[5])
			l.visible = lit > 0.02   # plein jour : les lampadaires éteints n'éclairent plus (aucun coût)
		else:
			l.visible = false
