extends Node
## J9 : paquet graphique (port de src/graphics.js, src/sky.js et des réglages de lumière de src/main.js). Possède l'Environment (ciel nocturne en shader, étoiles,
## brouillard, ambiance, tone mapping ACES, halo, table de couleurs), la lune (lumière directionnelle et ombres), la vignette / le grain, et applique le niveau de
## qualité (Rapide / Normale / Haute) et les options Luminosité, Effets cinéma, Halo lumineux de Game.settings. L'exposition suit la zone du joueur (lissée).
## Les règles et les valeurs viennent de GraphicsRules / CONFIG.graphics ; ici, seulement le branchement sur le moteur. Ne touche pas à la simulation.

const SKY_SHADER := preload("res://shaders/sky.gdshader")
const CINEMA_SHADER := preload("res://shaders/cinema.gdshader")

## Réglages de main.js : fond, brouillard exponentiel (carte / arène), hémisphère, lune.
const FOG_COLOR := Color("0b121c")
const FOG_DENSITY := 0.019
const FOG_DENSITY_ARENA := 0.022
const HEMI_SKY := Color("6677aa")
const HEMI_GROUND := Color("222018")
const HEMI_INTENSITY := 1.1        ## x Luminosité (hemi.intensity = 1.1 * brightness)
## Halo : le JS seuille l'image DÉJÀ tone-mappée (0,62) ; Godot seuille le HDR avant le tone mapping. Facteurs réglés sur les captures de la place Kléber (étal éclairé).
const GLOW_THRESHOLD_K := 2.0
const GLOW_K := 0.6
const MOON_COLOR := Color("9fb4ff")
const MOON_INTENSITY := 1.4
const MOON_OFFSET := Vector3(25, 55, 15)
## Lumière : Three.js divise par pi la diffusion (BRDF_Lambert), Godot non : une énergie Three vaut E / pi ici.
const THREE_TO_GODOT := 1.0 / PI
## Étalonnage du tone mapping : l'ACES de Godot (biais d'exposition 1,8) et celui de Three.js (1 / 0,6) diffèrent d'un facteur constant (mesuré : voir le plan).
const TONE_K := 1.0
## Fond de ciel mesuré contre le JS : facteur appliqué à l'exposition.

var camera: Camera3D
var env: Environment
var world_env: WorldEnvironment
var moon: DirectionalLight3D
var sky_mat: ShaderMaterial
var arena := false
var sky_k := 0.0                    ## 0 nuit, 0,5 aube, 1 jour (J10 : l'Acte V repeint le ciel)
var zone_k := {"exposure": 1.0, "env": 1.0, "torch": 1.0}
var zone_name := ""
var level_index := -1
var _lut: ImageTexture3D
var _cinema_layer: CanvasLayer
var _cinema_rect: ColorRect
var torch: SpotLight3D           ## lampe torche (CONFIG.graphics.torch), accrochée à la caméra
var torch_on := true             ## allumée au départ comme dans le JS (touche « Lampe torche » : bascule)
var _sky_time := 0.0
var dbg_noamb := false
var _last_brightness := -1.0
var _last_noamb := false
var dbg_torch_k := 1.0

signal quality_applied(q: int)

func setup(cam: Camera3D, is_arena: bool) -> void:
	camera = cam
	arena = is_arena
	_build_environment()
	_build_moon()
	_build_cinema()
	_build_torch()
	Game.settings.changed.connect(_on_setting)
	apply_quality(int(Game.settings.get_value("quality")))
	apply_exposure()
	for a in OS.get_cmdline_user_args():   # mise au point : --dbg-nomoon, --dbg-noamb (comparaisons avec le JS, une lumière à la fois)
		if a == "--dbg-nomoon":
			moon.light_energy = 0.0
		elif a == "--dbg-albedo":   # sans lumière ni brouillard ni mappage tonal : une ambiance blanche (rayonnement = albédo)
			env.background_mode = Environment.BG_COLOR
			env.background_color = Color.BLACK
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = Color.WHITE
			env.ambient_light_energy = 1.0
			env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
			env.tonemap_exposure = 1.0
			env.fog_enabled = false
			env.adjustment_enabled = false
			moon.light_energy = 0.0
			set_process(false)
		elif a == "--dbg-colamb":
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = Color(0.3, 0.3, 0.3)
			env.ambient_light_energy = 1.0
			dbg_noamb = true
			set_process(false)
		elif a == "--dbg-quads":   # quatre panneaux blancs tournés vers +x, -x, +z, -z devant le joueur : direction de la lune
			await get_tree().create_timer(0.5).timeout
			var p := Game.player.pos
			for k in 4:
				var q := MeshInstance3D.new()
				var qm := QuadMesh.new()
				qm.size = Vector2(2, 2)
				q.mesh = qm
				var m := StandardMaterial3D.new()
				m.albedo_color = Color(0.5, 0.5, 0.5)
				q.material_override = m
				q.position = p + Vector3(-7.0 + 4.0 * k, 1.5, -12.0)
				q.rotation_degrees.y = [45.0, -45.0, 0.0, 90.0][k]   # normales (+x,+z), (-x,+z), +z, +x
				add_child(q)
		elif a.begins_with("--dbg-torchk="):   # mise au point : multiplie la torche
			dbg_torch_k = float(a.substr(13))
		elif a == "--dbg-noamb":
			dbg_noamb = true
			apply_exposure()

# ---------------------------------------------------------------- construction
func _build_environment() -> void:
	var C: Dictionary = Config.at("graphics")
	var S: Dictionary = C["sky"]
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = SKY_SHADER
	var el := float(S["moonElevation"])
	var az := float(S["moonAzimuth"])
	sky_mat.set_shader_parameter("moon_dir", Vector3(cos(el) * cos(az), sin(el), cos(el) * sin(az)).normalized())
	sky_mat.set_shader_parameter("moon_size", float(S["moonSize"]))
	sky_mat.set_shader_parameter("cloud_night", Color(String(S["cloudNight"])))
	sky_mat.set_shader_parameter("hemi_sky", HEMI_SKY)
	sky_mat.set_shader_parameter("hemi_ground", HEMI_GROUND)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	sky.process_mode = Sky.PROCESS_MODE_REALTIME   # le rayonnement (éclairage ambiant) change avec la luminosité : un ciel « statique » ne se recalcule pas quand un uniforme change
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# l'ambiant vient du ciel (hémisphère) ; les reflets du ciel sont coupés : eau et flaques reflètent par env_reflect.gdshaderinc (intensité 0,16 du JS)
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	# brouillard exponentiel carré du JS (FogExp2 : 1 - exp(-(d x densité)^2)) approché par le brouillard de profondeur de Godot
	env.fog_enabled = true
	env.fog_light_color = FOG_COLOR
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_sky_affect = 0.0
	_set_fog(FOG_DENSITY_ARENA if arena else FOG_DENSITY)
	# halo (Haute) : réglé par _apply_glow
	env.glow_enabled = false
	world_env = WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)

## Le brouillard de profondeur de Godot vaut smoothstep(début, fin, d) x densité (mesuré sur des quads blancs, voir docs/GODOT_PORT.md J9). Avec début 0, fin = 1,65 / densité
## et courbe 1, il suit le brouillard exponentiel carré de Three.js 1 - exp(-(d x densité)^2) à 0,07 près (écart maximal à 70 m ; 0,00 à 0 m et à 100 m).
func _set_fog(density: float) -> void:
	env.fog_density = 1.0
	env.fog_depth_begin = 0.0
	env.fog_depth_end = 1.65 / density
	env.fog_depth_curve = 1.0

func _build_moon() -> void:
	moon = DirectionalLight3D.new()
	moon.light_color = MOON_COLOR
	moon.light_energy = MOON_INTENSITY * THREE_TO_GODOT
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	moon.directional_shadow_max_distance = 90.0
	moon.shadow_bias = 0.04
	moon.shadow_normal_bias = 1.2
	moon.shadow_blur = 1.2
	add_child(moon)
	moon.global_transform = Transform3D(Basis.looking_at(-MOON_OFFSET.normalized(), Vector3.UP), Vector3.ZERO)

## Lampe torche : SpotLight(couleur, 9, 40, 0,5, 0,9, 1,1) de player.js, accrochée à la caméra, visant devant. Three.js : intensité en candelas (divisée par pi ici), angle = demi-ouverture,
## décroissance 1,1 ; l'ouverture adoucie (penumbra 0,9) devient l'atténuation angulaire de Godot.
func _build_torch() -> void:
	var T: Dictionary = Config.at("graphics.torch")
	torch = SpotLight3D.new()
	torch.light_color = Config.color(int(T["color"]))
	torch.spot_range = float(T["distance"])
	torch.spot_angle = rad_to_deg(float(T["angle"]))
	torch.spot_attenuation = float(T["decay"])
	torch.spot_angle_attenuation = 1.0 - 0.5 * float(T["penumbra"])
	torch.light_energy = float(T["intensity"]) * THREE_TO_GODOT
	torch.shadow_enabled = false
	camera.add_child(torch)

func set_torch(on: bool) -> void:
	torch_on = on
	_update_torch()

func _update_torch() -> void:
	torch.light_energy = float(Config.at("graphics.torch.intensity")) * THREE_TO_GODOT * float(zone_k["torch"]) * dbg_torch_k if torch_on else 0.0
	torch.visible = torch_on

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.is_action_pressed("torch") and Game.playing and not Game.over:
		set_torch(not torch_on)

func _build_cinema() -> void:
	_cinema_layer = CanvasLayer.new()
	_cinema_layer.layer = 0   # sous le HUD (1) et les menus (20), comme le calque #cinema du DOM
	add_child(_cinema_layer)
	_cinema_rect = ColorRect.new()
	_cinema_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_cinema_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = CINEMA_SHADER
	_cinema_rect.material = m
	_cinema_layer.add_child(_cinema_rect)

# ---------------------------------------------------------------- réglages
func _on_setting(key: String) -> void:
	match key:
		"quality", "cinema", "halo":
			apply_quality(int(Game.settings.get_value("quality")))
		"brightness":
			apply_exposure()

func _size() -> Vector2i:
	var vp := get_viewport()
	return Vector2i(vp.get_visible_rect().size)

## applyQuality : résolution de rendu, ombres, nuages, anticrénelage, passe finale (table de couleurs, halo), vignette et grain.
func apply_quality(q: int) -> void:
	q = clampi(q, 0, 2)
	level_index = q
	var L := GraphicsRules.level(q)
	var vp := get_viewport()
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = GraphicsRules.pixel_ratio(q)
	var cinema: bool = bool(Game.settings.get_value("cinema"))
	var sz := _size()
	var post := GraphicsRules.want_post(q, cinema, sz.x, sz.y)
	vp.msaa_3d = Viewport.MSAA_4X if q == 2 else (Viewport.MSAA_2X if q == 1 else Viewport.MSAA_DISABLED)
	var shadows := bool(L["shadows"])
	moon.shadow_enabled = shadows
	if shadows:
		var size := int(L["shadowSize"])
		RenderingServer.directional_shadow_atlas_set_size(size, true)
		RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM if bool(L["softShadows"]) else RenderingServer.SHADOW_QUALITY_HARD)
	sky_mat.set_shader_parameter("cloud_cover", float(Config.at("graphics.sky.cloudCover")) if bool(L["clouds"]) else 0.0)
	if post:
		if _lut == null:
			_lut = GraphicsRules.lut_texture()
		env.adjustment_enabled = true
		env.adjustment_color_correction = _lut
	else:
		env.adjustment_enabled = false
		env.adjustment_color_correction = null
	_apply_glow(GraphicsRules.want_halo(q, cinema, bool(Game.settings.get_value("halo")), sz.x, sz.y))
	_cinema_layer.visible = cinema
	apply_exposure()
	quality_applied.emit(q)

## Halo : seuil et adoucissement de la passe de halo du JS (0,62 / 0,15 sur l'image tone-mappée), intensité 0,85 (réduite à l'Aube), flou de 1,8 texel à demi-résolution.
func _apply_glow(on: bool) -> void:
	env.glow_enabled = on
	if not on:
		return
	var H: Dictionary = Config.at("graphics.halo")
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.glow_intensity = GraphicsRules.halo_dawn_gain(sky_k) * GLOW_K
	env.glow_strength = 1.0
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = float(H["threshold"]) * GLOW_THRESHOLD_K
	env.glow_hdr_scale = 1.0
	env.glow_normalized = false
	for i in 7:
		env.set_glow_level(i, 1.0 if i in [1, 2, 3] else 0.0)

## applyExposure : exposition de base x Luminosité x zone ; l'ambiance (hémisphère) suit la Luminosité (hemi.intensity = 1,1 x luminosité).
func apply_exposure() -> void:
	var b := float(Game.settings.get_value("brightness"))
	env.tonemap_exposure = GraphicsRules.exposure(b, float(zone_k["exposure"])) * TONE_K
	env.ambient_light_energy = 1.0
	if not is_equal_approx(b, _last_brightness) or dbg_noamb != _last_noamb:   # (chaque changement relance le calcul du rayonnement du ciel : pas à chaque image)
		_last_brightness = b
		_last_noamb = dbg_noamb
		sky_mat.set_shader_parameter("ambient_scale", 0.0 if dbg_noamb else _hemi_k * b * THREE_TO_GODOT)   # l'énergie ambiante d'Environment est sans effet sur un ambiant venu du ciel

# ---------------------------------------------------------------- ciel de l'Aube (summit.js : SKY, applySky)
## Réglages du ciel à trois instants : nuit (k = 0), aube dorée (k = 0,5), plein jour (k = 1).
const SKY_FOG := ["0b121c", "c88a68", "bcd4e8"]
const SKY_DENSITY := [0.019, 0.016, 0.011]
const SKY_HEMI_SKY := ["6677aa", "d4a888", "cfe2ff"]
const SKY_HEMI_GROUND := ["222018", "5a4a3a", "6a6458"]
const SKY_HEMI := [1.1, 1.5, 1.9]
const SKY_SUN := ["9fb4ff", "ffb070", "fff0d8"]
const SKY_SUN_I := [1.4, 1.8, 2.6]
const SKY_SUN_POS := [Vector3(25, 55, 15), Vector3(70, 22, 10), Vector3(35, 60, 15)]
const SKY_TOP := ["04070d", "2a2f5a", "3f78c8"]
const SKY_MID := ["0c1522", "b8706a", "7fb2e8"]
const SKY_BOT := ["1b2535", "f3b074", "c9e0f4"]
var _hemi_k := HEMI_INTENSITY

static func _sm(x: float) -> float:
	return x * x * (3.0 - 2.0 * x)

## Paramètres (i0, i1, u) du tronçon de k : nuit -> aube pour k < 0,5, aube -> jour ensuite (lissé).
static func _seg(k: float) -> Array:
	return [0, 1, _sm(k * 2.0)] if k < 0.5 else [1, 2, _sm((k - 0.5) * 2.0)]

## Mélange dans l'espace linéaire (Three.js mélange des couleurs linéaires), renvoyé en sRGB pour les uniformes `source_color`.
static func _pick_c(arr: Array, k: float) -> Color:
	var sg := _seg(k)
	var a := Color.html(String(arr[sg[0]])).srgb_to_linear()
	var b := Color.html(String(arr[sg[1]])).srgb_to_linear()
	return a.lerp(b, float(sg[2])).linear_to_srgb()

static func _pick_n(arr: Array, k: float) -> float:
	var sg := _seg(k)
	return lerpf(float(arr[sg[0]]), float(arr[sg[1]]), float(sg[2]))

## L'Aube : le ciel passe de la nuit au jour (k de 0 à 1) : dôme, brouillard, ambiance, lune qui devient le soleil, étoiles, halo (summit.js applySky).
func set_sky_k(k: float) -> void:
	sky_k = k
	var sg := _seg(k)
	sky_mat.set_shader_parameter("top", _pick_c(SKY_TOP, k))
	sky_mat.set_shader_parameter("mid", _pick_c(SKY_MID, k))
	sky_mat.set_shader_parameter("bot", _pick_c(SKY_BOT, k))
	sky_mat.set_shader_parameter("moon_k", 1.0 - _sm(minf(1.0, k / 0.35)))
	sky_mat.set_shader_parameter("day_k", _sm(clampf((k - 0.25) / 0.6, 0.0, 1.0)))
	var el := deg_to_rad(-4.0 + 42.0 * _sm(k))   # le soleil monte à l'est de -4° à 38° d'élévation
	sky_mat.set_shader_parameter("sun_dir", Vector3(cos(el) * cos(deg_to_rad(20.0)), sin(el), cos(el) * sin(deg_to_rad(20.0))))
	sky_mat.set_shader_parameter("sun_k", (minf(1.0, k * 5.0) * (1.0 - 0.35 * _sm(maxf(0.0, k - 0.6) / 0.4))) if k > 0.02 else 0.0)
	sky_mat.set_shader_parameter("hemi_sky", _pick_c(SKY_HEMI_SKY, k))
	sky_mat.set_shader_parameter("hemi_ground", _pick_c(SKY_HEMI_GROUND, k))
	_hemi_k = _pick_n(SKY_HEMI, k)
	_last_brightness = -1.0   # relance le calcul de l'ambiance avec la nouvelle intensité
	env.fog_light_color = _pick_c(SKY_FOG, k)
	_set_fog(_pick_n(SKY_DENSITY, k) * (1.15 if arena else 1.0))
	moon.light_color = _pick_c(SKY_SUN, k)
	moon.light_energy = _pick_n(SKY_SUN_I, k) * THREE_TO_GODOT
	var off: Vector3 = SKY_SUN_POS[sg[0]].lerp(SKY_SUN_POS[sg[1]], float(sg[2]))
	moon.global_transform = Transform3D(Basis.looking_at(-off.normalized(), Vector3.UP), Vector3.ZERO)
	_apply_glow(env.glow_enabled)
	_update_torch()

# ---------------------------------------------------------------- chaque image
func _process(dt: float) -> void:
	_sky_time += dt
	sky_mat.set_shader_parameter("cloud_time", _sky_time)
	sky_mat.set_shader_parameter("stars_k", 1.0 if sky_k < 0.28 else 0.0)
	# zone courante : exposition (lissée : pas de saut en franchissant une porte)
	if Game.world != null and Game.player != null:
		var zi: int = Game.world.zone_of(Game.player.pos.x, Game.player.pos.z)
		zone_name = String(Game.world.zone_names[zi]) if zi >= 0 and zi < Game.world.zone_names.size() else ""
	var Z := GraphicsRules.zone(zone_name)
	var k := GraphicsRules.zone_blend(dt)
	for key: String in ["exposure", "env", "torch"]:
		zone_k[key] += (float(Z[key]) - float(zone_k[key])) * k
	if Game.finale != null and not is_equal_approx(Game.finale.sky_k, sky_k):
		set_sky_k(Game.finale.sky_k)
	apply_exposure()
	_update_torch()
	# l'ombre de la lune suit le joueur (lumière à (25, 55, 15) de la cible) : l'orientation est fixe, seul le volume d'ombre suit la caméra
