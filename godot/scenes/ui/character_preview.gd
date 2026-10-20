class_name CharacterPreview
extends SubViewportContainer
## v0.21.1 : aperçu 3D tournant du personnage choisi (menu SURVIVANT). Un SubViewport à monde propre (le monde du jeu n'est pas touché), fond transparent, deux lumières,
## un socle à la couleur d'accent. N'affiche que le modèle choisi (CharacterModel.create : chargement paresseux, les autres modèles sont libérés) ; ne rend que quand le
## panneau est visible. Sans modèle (fichier absent) : le conteneur reste vide et masqué, le menu garde les portraits PNG.

const SPIN := 0.9                  ## rad/s

var _vp: SubViewport
var _pivot: Node3D
var _model: CharacterModel
var _id := ""
var _ring: MeshInstance3D
var _ring_mat: StandardMaterial3D
var _rim: DirectionalLight3D

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
	key.rotation = Vector3(deg_to_rad(-35), deg_to_rad(25), 0)
	key.light_energy = 1.7
	key.light_color = Color("fff0dc")
	_vp.add_child(key)
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
	set_process(false)

## Affiche le personnage `cid` (le modèle précédent est libéré, ainsi que les autres modèles chargés). False : modèle absent.
func show_character(cid: String, accent: Color) -> bool:
	if _model != null:
		_model.queue_free()
		_model = null
	_id = cid
	CharacterModel.purge_except(cid)
	_model = CharacterModel.create(cid)
	if _model == null:
		visible = false
		set_process(false)
		return false
	visible = true
	_pivot.add_child(_model)
	_model.play("Idle")
	_ring_mat.emission = accent.darkened(0.25)
	_rim.light_color = accent.lightened(0.3)
	_pivot.rotation.y = deg_to_rad(-20)
	set_process(true)
	return true

func _process(dt: float) -> void:
	if is_visible_in_tree():
		_pivot.rotation.y += SPIN * dt

func current_id() -> String:
	return _id

func model() -> CharacterModel:
	return _model

## Libère le modèle (menu fermé) : le jeu recharge celui qui est choisi quand il en a besoin.
func clear() -> void:
	if _model != null:
		_model.queue_free()
		_model = null
	set_process(false)
