class_name CharacterPreview
extends SubViewportContainer
## v0.21.1 : aperçu 3D tournant du personnage choisi (menu SURVIVANT). Un SubViewport à monde propre (le monde du jeu n'est pas touché), fond transparent, deux lumières,
## un socle à la couleur d'accent. N'affiche que le modèle choisi (CharacterModel.create : chargement paresseux, les autres modèles sont libérés) ; ne rend que quand le
## panneau est visible. Sans modèle (fichier absent) : le conteneur reste vide et masqué, le menu garde les portraits PNG.
## v0.31.0 : éclairage de studio (clé chaude avec ombres, débouchage froid, contre-jour à la couleur d'accent), le personnage regarde la caméra
## (FaceRig : yeux, clignement ; respiration du clip Idle) ; glisser à la souris le fait tourner, la rotation automatique reprend après 2,5 s.
## v0.34.4 : chaque clic sur une carte gelait le menu 0,5 à 1 s (le modèle précédent était libéré, le nouveau .gltf relu sur le fil principal, ses pipelines compilés
## au clic). Désormais les modèles affichés restent en mémoire tant que le menu est ouvert (changer de survivant = changer de modèle visible), un modèle pas encore lu
## est demandé à un fil de travail (`show_character(..., false)` : l'ancien reste affiché jusqu'à son arrivée), et `warm` dessine une fois un modèle caché pendant
## que le panneau est fermé (pipelines compilés à l'avance, au titre). `trim` ne garde que le survivant choisi (début de partie).

const SPIN := 0.9                  ## rad/s

var _vp: SubViewport
var _pivot: Node3D
var _model: CharacterModel
var _id := ""
var _models: Dictionary = {}        ## v0.34.4 : id -> CharacterModel gardés (un seul visible)
var _accent := Color.WHITE
var _waiting := ""                  ## survivant demandé, encore en lecture sur un fil
var _warming := ""                  ## survivant dessiné caché à l'image en cours (warm)
var _warmed: Dictionary = {}        ## id -> true : déjà dessiné une fois (préchauffé ou affiché)
var _ring: MeshInstance3D
var _ring_mat: StandardMaterial3D
var _rim: DirectionalLight3D
var _cam: Camera3D
var _drag := false
var _idle_t := 3.0

func _init(size := Vector2(260, 330)) -> void:
	custom_minimum_size = size
	stretch = true
	_vp = SubViewport.new()
	_vp.own_world_3d = true
	_vp.transparent_bg = true
	_vp.msaa_3d = Viewport.MSAA_4X
	_vp.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE
	add_child(_vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("9aa6c0")
	env.ambient_light_energy = 0.8
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	_vp.add_child(we)
	var key := DirectionalLight3D.new()
	key.rotation = Vector3(deg_to_rad(-32), deg_to_rad(28), 0)
	key.light_energy = 1.8
	key.light_color = Color("fff0dc")
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 8.0
	_vp.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.rotation = Vector3(deg_to_rad(-12), deg_to_rad(-55), 0)
	fill.light_energy = 0.4
	fill.light_color = Color("c8d8ff")
	_vp.add_child(fill)
	_rim = DirectionalLight3D.new()
	_rim.rotation = Vector3(deg_to_rad(-15), deg_to_rad(-150), 0)
	_rim.light_energy = 1.0
	_vp.add_child(_rim)
	_pivot = Node3D.new()
	_vp.add_child(_pivot)
	_ring = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.5
	cyl.bottom_radius = 0.53
	cyl.height = 0.04
	cyl.radial_segments = 32
	_ring.mesh = cyl
	_ring_mat = StandardMaterial3D.new()
	_ring_mat.albedo_color = Color(0.08, 0.08, 0.1)
	_ring_mat.emission_enabled = true
	_ring_mat.emission_energy_multiplier = 0.3
	_ring.material_override = _ring_mat
	_ring.position.y = -0.02
	_vp.add_child(_ring)
	var cam := Camera3D.new()
	cam.fov = 26
	cam.position = Vector3(0, 1.0, 5.4)
	_vp.add_child(cam)
	cam.look_at_from_position(cam.position, Vector3(0, 0.88, 0))
	cam.current = true
	_cam = cam
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_process(false)

func _gui_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and (ev as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_drag = (ev as InputEventMouseButton).pressed
		_idle_t = 0.0
	elif ev is InputEventMouseMotion and _drag:
		_pivot.rotation.y += (ev as InputEventMouseMotion).relative.x * 0.012
		_idle_t = 0.0

## Affiche le personnage `cid`. wait : lit le modèle tout de suite s'il n'est pas chargé (tests, outils) ; sinon (menu) il est demandé à un fil de travail et
## l'ancien reste affiché jusqu'à son arrivée. False : modèle absent (conteneur masqué).
func show_character(cid: String, accent: Color, wait := true) -> bool:
	_id = cid
	_accent = accent
	if not CharacterModel.exists(cid):
		_waiting = ""
		_set_current(null)
		visible = false
		set_process(false)
		return false
	visible = true
	if _models.has(cid) or wait or CharacterModel.is_ready(cid):
		_waiting = ""
		_set_current(_instance(cid))
	else:
		_waiting = cid
		CharacterModel.request(cid)
		set_process(true)
	return true

## Le modèle `cid` (créé et gardé caché s'il ne l'était pas). null : absent.
func _instance(cid: String) -> CharacterModel:
	if _models.has(cid):
		return _models[cid]
	var m := CharacterModel.create(cid)
	if m == null:
		return null
	m.visible = false
	m.process_mode = Node.PROCESS_MODE_DISABLED
	_pivot.add_child(m)
	m.play("Idle")
	if m.face != null:
		m.face.look_at_world = _cam.global_position if _cam.is_inside_tree() else Vector3(0, 1.0, 5.4)
	_models[cid] = m
	return m

func _set_current(m: CharacterModel) -> void:
	for k: String in _models:
		var o: CharacterModel = _models[k]
		var on := o == m
		o.visible = on
		o.process_mode = Node.PROCESS_MODE_INHERIT if on else Node.PROCESS_MODE_DISABLED
	_model = m
	if m == null:
		return
	_ring_mat.emission = _accent.darkened(0.25)
	_rim.light_color = _accent.lightened(0.3)
	_pivot.rotation.y = deg_to_rad(-20)
	set_process(true)

## v0.34.4 : dessine une fois le modèle `cid` (déjà lu) dans le SubViewport alors que le panneau est fermé : les pipelines de ses matériaux sont compilés
## maintenant plutôt qu'au clic. Renvoie false si rien n'a été fait (modèle pas prêt, aperçu affiché, autre préchauffage en cours).
func warm(cid: String) -> bool:
	if _warming != "" or is_visible_in_tree() or not CharacterModel.is_ready(cid):
		return false
	var m := _instance(cid)
	if m == null:
		return false
	_warming = cid
	for k: String in _models:
		(_models[k] as CharacterModel).visible = k == cid
	_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await RenderingServer.frame_post_draw
	_warming = ""
	_warmed[cid] = true
	if is_instance_valid(self):
		_vp.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE
		_set_current(_model)
	return true

## Crée (caché) le modèle déjà lu de `cid` : un clic sur sa carte ne fera que le rendre visible.
func preload_instance(cid: String) -> void:
	if CharacterModel.is_ready(cid):
		_instance(cid)

func is_warming() -> bool:
	return _warming != ""

func has_instance(cid: String) -> bool:
	return _models.has(cid)

func is_warmed(cid: String) -> bool:
	return _warmed.has(cid)

func _process(dt: float) -> void:
	if _waiting != "" and CharacterModel.is_ready(_waiting):
		var cid := _waiting
		_waiting = ""
		if cid == _id:
			_set_current(_instance(cid))
	if is_visible_in_tree() and _model != null:
		_warmed[_model.id] = true
		_idle_t += dt
		if not _drag and _idle_t > 2.5:
			_pivot.rotation.y += SPIN * dt

func current_id() -> String:
	return _id

func model() -> CharacterModel:
	return _model

## Libère le modèle (menu fermé) : le jeu recharge celui qui est choisi quand il en a besoin.
func clear() -> void:
	trim("")

## v0.34.4 : ne garde que le modèle `keep` ("" : aucun) et libère les autres modèles lus (début d'une partie : la mémoire du jeu).
func trim(keep: String) -> void:
	for k: String in _models.keys():
		if k != keep:
			var m: CharacterModel = _models[k]
			_models.erase(k)
			_warmed.erase(k)
			if m == _model:
				_model = null
			m.queue_free()
	if _waiting != keep:
		_waiting = ""
	CharacterModel.purge_except(keep)
	if _model == null:
		set_process(false)
