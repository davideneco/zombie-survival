extends Node3D
## Halos (billboards) et flaques de lumière (quads horizontaux) pour toutes les sources de lumière fixes de la ville (v0.22.2), en deux MultiMesh : 2 appels de dessin au total,
## sans lumière dynamique. Les 8 vraies lumières les plus proches (world_view.gd) éclairent seules le décor ; ceci montre les autres, au loin et de près. Voir shaders/lamp_glow.gdshader.

static var SHADER: Shader:
	get: return load("res://shaders/lamp_glow.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
const DOOR_PANEL := 0xff8844   ## panneaux de porte : déjà émissifs, trop nombreux (239), pas de halo

var _halo_mat: ShaderMaterial
var _pool_mat: ShaderMaterial
var _halo: MultiMeshInstance3D
var _pool: MultiMeshInstance3D

## lights : tableau de [x, y, z, couleur 0xRRGGBB, intensité, portée] (data/graphics/lights.json).
func setup(lights: Array) -> void:
	var halos: Array = []
	var pools: Array = []
	for l: Array in lights:
		if int(l[3]) == DOOR_PANEL:
			continue
		halos.append(l)
		if float(l[4]) >= 9.0 and float(l[1]) >= 2.8:   # lampadaires, appliques et lampes hautes : flaque au sol ; les petites sources (4-7 cd) et les bas objets non
			pools.append(l)
	_halo_mat = ShaderMaterial.new()
	_halo_mat.shader = SHADER
	_pool_mat = ShaderMaterial.new()
	_pool_mat.shader = SHADER
	_pool_mat.set_shader_parameter("billboard", false)
	_halo = _make(halos, true, _halo_mat)
	_pool = _make(pools, false, _pool_mat)
	if not halos.is_empty():
		add_child(_halo)
	if not pools.is_empty():
		add_child(_pool)

func _make(src: Array, halo: bool, mat: ShaderMaterial) -> MultiMeshInstance3D:
	var qm := QuadMesh.new()
	qm.size = Vector2(2.0, 2.0)   # rayon 1 : l'échelle de l'instance est le rayon en mètres
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = qm
	mm.instance_count = src.size()
	for i in src.size():
		var l: Array = src[i]
		var inten := float(l[4])
		var col := Config.color(int(l[3]))
		var pos := Vector3(float(l[0]), float(l[1]), float(l[2]))
		var t := Transform3D()
		if halo:
			var s := clampf(0.25 * sqrt(inten), 0.5, 2.2)
			t = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * s), pos)
			mm.set_instance_color(i, Color(col.r, col.g, col.b, clampf(inten / 22.0, 0.35, 1.0)))
		else:
			var r := clampf(float(l[5]) * 0.5, 3.5, 10.0)
			t = Transform3D(Basis(Vector3.RIGHT, -PI * 0.5).scaled_local(Vector3.ONE * r), Vector3(pos.x, 0.2, pos.z))
			mm.set_instance_color(i, Color(col.r, col.g, col.b, clampf(inten / 60.0, 0.12, 1.0) * 0.28))
		mm.set_instance_transform(i, t)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	mmi.layers = 1
	mmi.extra_cull_margin = 20.0
	return mmi

## gain : 1 la nuit, 0 le jour ; pools : flaques de lumière au sol (coupées en Rapide).
func set_state(gain: float, pools_on: bool) -> void:
	_halo_mat.set_shader_parameter("gain", gain)
	_pool_mat.set_shader_parameter("gain", gain)
	if _pool != null:
		_pool.visible = pools_on
