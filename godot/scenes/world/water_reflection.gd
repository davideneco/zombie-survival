extends Node
## v0.32.5 : reflet plan de l'eau (Haute). Toute l'eau de la carte est au même niveau (y = 0,04) : une caméra miroir (position et orientation réfléchies
## par le plan de l'eau, axe x retourné : l'image est relue en miroir par shaders/water.gdshader) rend la ville dans un SubViewport en basse résolution
## (1/4 de la fenêtre), sans ombres de projecteurs, à 120 m au plus, et seulement quand une maille d'eau à moins de 140 m est dans le champ de la caméra.

const WATER_Y := 0.04
const SCALE := 4
const NEAR_WATER := 140.0

var water_cells: PackedVector2Array = []   ## centres des mailles d'eau (world_view.gd)
var materials: Array = []                  ## ShaderMaterial de l'eau
var enabled := false
var vp: SubViewport
var cam: Camera3D
var _check := 0.0
var _near := false

func setup(cells: PackedVector2Array, mats: Array) -> void:
	name = "ReflexionEau"
	water_cells = cells
	materials = mats
	vp = SubViewport.new()
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.positional_shadow_atlas_size = 0
	vp.msaa_3d = Viewport.MSAA_DISABLED
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	vp.use_hdr_2d = false
	add_child(vp)
	cam = Camera3D.new()
	cam.cull_mask = 0xFFFFF & ~(1 << 19)
	cam.far = 120.0
	vp.add_child(cam)
	for m: ShaderMaterial in materials:
		m.set_shader_parameter("refl_tex", vp.get_texture())

func set_enabled(on: bool) -> void:
	enabled = on and not "--dbg-norefl" in OS.get_cmdline_user_args()
	_apply()

func _apply() -> void:
	var on := enabled and _near
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
	for m: ShaderMaterial in materials:
		m.set_shader_parameter("refl_on", 1.0 if on else 0.0)

func _process(dt: float) -> void:
	if not enabled:
		return
	var main := get_viewport().get_camera_3d()
	if main == null:
		return
	_check -= dt
	if _check <= 0.0:
		_check = 0.25
		var p := Vector2(main.global_position.x, main.global_position.z)
		var near := false
		for c in water_cells:
			if c.distance_squared_to(p) < NEAR_WATER * NEAR_WATER:
				# une maille d'eau (48 m) dans le champ de la caméra : centre ou un des quatre coins
				for o in [Vector2.ZERO, Vector2(-24, -24), Vector2(24, -24), Vector2(-24, 24), Vector2(24, 24)]:
					if main.is_position_in_frustum(Vector3(c.x + o.x, WATER_Y, c.y + o.y)):
						near = true
						break
			if near:
				break
		if near != _near:
			_near = near
			_apply()
	if not _near:
		return
	var size := get_viewport().get_visible_rect().size
	var want := Vector2i(maxi(64, int(size.x) / SCALE), maxi(64, int(size.y) / SCALE))
	if vp.size != want:
		vp.size = want
	var t := main.global_transform
	var M := Basis(Vector3(1, 0, 0), Vector3(0, -1, 0), Vector3(0, 0, 1))
	var b := M * t.basis
	b.x = -b.x   # orientation propre (déterminant positif) : l'image sort en miroir horizontal, relue en 1 - x par le shader
	var o := t.origin
	cam.global_transform = Transform3D(b, Vector3(o.x, 2.0 * WATER_Y - o.y, o.z))
	cam.fov = main.fov
	cam.near = maxf(0.05, main.near)
