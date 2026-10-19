extends Node3D
## Modèle articulé d'un zombie (primitives : bassin, buste, tête et mâchoire, bras à deux segments, jambes à deux segments) piloté par un
## ZombieSim. Suit la hiérarchie de src/zombie.js (hanches, genoux, épaules, coudes, mâchoire) ; la pose vient de ZombiePose. Les proportions,
## la taille et les couleurs dépendent de l'identifiant (ZombieSim.hash_id) : tous les joueurs verraient le même zombie. Peau simple : le
## shader d'atlas complet est du jalon 9.

const GfxAssets := preload("res://scenes/gfx_assets.gd")
const ZombieSkin := preload("res://scenes/zombie_skin.gd")
const SKINS := [Color("a9b88f"), Color("b9b393"), Color("9fae94"), Color("c0b69b")]
const SHIRTS := [Color("5a4a3c"), Color("3e4a5a"), Color("4f5a3c"), Color("6a3b34"), Color("45424a"), Color("5b5240")]
const PANTS := [Color("2f3640"), Color("3a3328"), Color("262c33"), Color("40382f")]
const BLOAT_SKIN := Color("c7f280")
const BLOAT_SHIRT := Color("b3bf80")
const METAL := Color("5a6068")
const EYE := Color("ffc01a")
const DEATH_FALL_TIME := 0.6
const SINK_START := 2.5
const SINK_SPEED := 0.8

var sim: ZombieSim
var _prev_pos := Vector3.ZERO
var _pose := ZombiePose.new()
var _group: Node3D
var _hips: Node3D
var _spine: Node3D
var _head: Node3D
var _jaw: Node3D
var _hip_j: Array[Node3D] = []
var _knee_j: Array[Node3D] = []
var _shoulder_j: Array[Node3D] = []
var _elbow_j: Array[Node3D] = []
var _legs: Array[Node3D] = []
var _head_mesh: MeshInstance3D
var _mound: MeshInstance3D
var _skin_mats: Array = []   ## matériaux qui rougissent quand le zombie est touché (ShaderMaterial de peau, ou StandardMaterial3D sans les assets cuits)
var _baked := false           ## J9 : géométries et atlas cuits (tools/bake-graphics.mjs) disponibles
var _last_hits := 0
var _mound_t := 0.0
var _death_style := 0
var _death_side := 1.0
var _flash := 0.0
var _last_health := 0.0

## Ombre de contact (src/contact.js) : tache sombre et douce sous le zombie, comme dans le JS (dégradé radial 1 / 0,78 / 0,28 / 0), partagée par tous les zombies.
static var _blob_tex: GradientTexture2D
static var _blob_mat: StandardMaterial3D

static func _blob_material() -> StandardMaterial3D:
	if _blob_mat == null:
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 0.35, 0.7, 1.0])
		g.colors = PackedColorArray([Color(0, 0, 0, 1.0), Color(0, 0, 0, 0.78), Color(0, 0, 0, 0.28), Color(0, 0, 0, 0.0)])
		_blob_tex = GradientTexture2D.new()
		_blob_tex.gradient = g
		_blob_tex.fill = GradientTexture2D.FILL_RADIAL
		_blob_tex.fill_from = Vector2(0.5, 0.5)
		_blob_tex.fill_to = Vector2(1.0, 0.5)
		_blob_tex.width = 64
		_blob_tex.height = 64
		_blob_mat = StandardMaterial3D.new()
		_blob_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_blob_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_blob_mat.albedo_texture = _blob_tex
		var c: Dictionary = Config.at("graphics.contact")
		_blob_mat.albedo_color = Color(0, 0, 0, float(c["opacity"]) * float(c["zombie"]))   # opacité commune x force « zombie »
		_blob_mat.render_priority = 1
	return _blob_mat

var _blob: MeshInstance3D

func setup(z: ZombieSim) -> void:
	sim = z
	_prev_pos = z.pos
	position = z.pos
	_last_health = z.health
	_last_hits = z.hit_count
	var hz := func(k: int) -> float: return ZombieSim.hash_id(z.id, k)
	_death_style = int(floor(hz.call(11) * 3.0)) % 3
	_death_side = -1.0 if hz.call(12) < 0.5 else 1.0
	var tone := int(floor(hz.call(1) * 4.0)) % 4
	var shirt_i := int(floor(hz.call(3) * 6.0)) % 6
	var pants_i := int(floor(hz.call(4) * 4.0)) % 4
	_baked = GfxAssets.zombie_mesh("head") != null and GfxAssets.texture("zombie_flesh.png") != null
	var face_m: Material
	var skin_m: Material
	var shirt_m: Material
	var pants_m: Material
	if _baked:
		# peau des zombies (J9) : atlas de chair et de tissus, sang progressif ; la cellule, la teinte et la taille viennent de l'identifiant (zombie.js)
		var blood0: float = 0.04 + 0.2 * float(hz.call(9))
		var tint: Color
		tint = _hsl(0.2 + 0.12 * float(hz.call(5)), 0.04 + 0.1 * float(hz.call(6)), 0.8 + 0.18 * float(hz.call(7)))
		var q: int = int(Game.settings.get_value("quality"))
		face_m = ZombieSkin.make("flesh", ZombieSkin.FACE[tone], blood0, tint, q)
		skin_m = ZombieSkin.make("flesh", ZombieSkin.SKIN[tone], blood0, tint, q)
		shirt_m = ZombieSkin.make("cloth", ZombieSkin.SHIRT[shirt_i], blood0, Color(0.8, 0.8, 0.8), q)
		pants_m = ZombieSkin.make("cloth", ZombieSkin.PANTS[pants_i], blood0 * 0.6, Color(0.8, 0.8, 0.8), q)
		if z.kind == "armored":
			for m: ShaderMaterial in [face_m, skin_m, shirt_m, pants_m]:
				m.set_shader_parameter("tint", (m.get_shader_parameter("tint") as Color) * 0.7)
		elif z.kind == "bloat":
			ZombieSkin.set_cell(skin_m, ZombieSkin.PLAGUE_SKIN)
			ZombieSkin.set_cell(face_m, ZombieSkin.PLAGUE_FACE)
			ZombieSkin.set_cell(shirt_m, ZombieSkin.BURLAP)
			skin_m.set_shader_parameter("tint", Color(0.78, 0.95, 0.5))
			face_m.set_shader_parameter("tint", Color(0.78, 0.95, 0.5))
			shirt_m.set_shader_parameter("tint", Color(0.7, 0.75, 0.5))
		if z.kind == "gargoyle":   # gargouille de pierre : coureur gris fissuré (cellules de pierre de l'atlas)
			ZombieSkin.set_cell(face_m, ZombieSkin.STONE_FACE)
			ZombieSkin.set_cell(skin_m, ZombieSkin.STONE_SKIN)
			ZombieSkin.set_cell(shirt_m, ZombieSkin.STONE_CLOTH)
			ZombieSkin.set_cell(pants_m, ZombieSkin.STONE_CLOTH)
			for m: ShaderMaterial in [face_m, skin_m, shirt_m, pants_m]:
				m.set_shader_parameter("tint", Color(0.5, 0.52, 0.55))
				m.set_shader_parameter("blood", 0.0)
		elif z is BossSim:   # le Bourreau / le Tanneur : peau assombrie (makeBoss : x0,55 ; Tanneur : vert x0,8)
			var k := 0.55 if not (z as BossSim).mini else 0.8
			for m: ShaderMaterial in [face_m, skin_m, shirt_m, pants_m]:
				m.set_shader_parameter("tint", (m.get_shader_parameter("tint") as Color) * k)
		_skin_mats = [face_m, skin_m, shirt_m, pants_m]
	else:
		var skin: Color = BLOAT_SKIN if z.kind == "bloat" else SKINS[tone]
		var shirt: Color = BLOAT_SHIRT if z.kind == "bloat" else SHIRTS[shirt_i]
		var pants: Color = PANTS[pants_i]
		if z.kind == "armored":
			skin = skin.darkened(0.3)
			shirt = shirt.darkened(0.3)
			pants = pants.darkened(0.3)
		skin_m = _mat(skin, 0.85)
		face_m = skin_m
		shirt_m = _mat(shirt, 0.95)
		pants_m = _mat(pants, 0.95)
		_skin_mats = [skin_m, shirt_m, pants_m]
	var eye_m := _mat(EYE, 0.4)
	if z is BossSim:
		eye_m = _mat(Color("b8ff30") if (z as BossSim).mini else Color("ff2010"), 0.4)
	elif z.kind == "gargoyle":
		eye_m = _mat(Color("ff7a24"), 0.4)
	eye_m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var metal_m := _mat(METAL, 0.4)
	metal_m.metallic = 0.85
	_blob = MeshInstance3D.new()
	var bq := QuadMesh.new()
	var big := 1.15 if z.crawler else 0.8
	bq.size = Vector2(big * 1.1, big)
	_blob.mesh = bq
	_blob.material_override = _blob_material()
	_blob.rotation_degrees = Vector3(-90, 0, 0)
	_blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_blob)
	_group = Node3D.new()
	_group.rotation_order = EULER_ORDER_YXZ
	_group.scale = z.body_scale()
	add_child(_group)
	if ZombieModels.show_boxes:
		ZombieModels.add_debug_old(_group, z)
	_hips = Node3D.new()
	_hips.position.y = 0.95
	_group.add_child(_hips)
	_part(_hips, _geo("pelvis", _capsule(0.14, 0.36)), Vector3.ZERO, pants_m, Vector3(1.15, 1.0, 0.75))
	_spine = Node3D.new()
	_spine.position.y = 0.04
	_hips.add_child(_spine)
	_part(_spine, _geo("torso", _capsule(0.16, 0.62)), Vector3(0, 0.3, 0), shirt_m, Vector3(1.05, 1.0, 0.66))
	_head = Node3D.new()
	_head.position = Vector3(0, 0.8, 0.05)
	_spine.add_child(_head)
	var hm := SphereMesh.new()
	hm.radius = 0.115
	hm.height = 0.25
	if _baked:
		_head_mesh = _part(_head, GfxAssets.zombie_mesh("head"), Vector3(0, -0.012, 0), face_m)
	else:
		_head_mesh = _part(_head, hm, Vector3(0, -0.01, 0), skin_m, Vector3(0.9, 1.0, 1.0))
	_jaw = Node3D.new()
	_jaw.position = Vector3(0, -0.0391 if _baked else -0.04, 0)
	_head.add_child(_jaw)
	if _baked:
		_part(_jaw, GfxAssets.zombie_mesh("jaw"), Vector3.ZERO, face_m)
	else:
		var jm := BoxMesh.new()
		jm.size = Vector3(0.12, 0.04, 0.12)
		_part(_jaw, jm, Vector3(0, -0.03, 0.03), skin_m)
	for sx in [-1.0, 1.0]:
		var em := SphereMesh.new()
		em.radius = 0.017
		em.height = 0.034
		_part(_head, em, Vector3(sx * 0.043, 0.051, 0.088), eye_m)
	for sx in [-1.0, 1.0]:
		var sh := Node3D.new()
		sh.position = Vector3(sx * 0.25, 0.52, 0)
		_spine.add_child(sh)
		_part(sh, _geo("upperArm", _capsule(0.052, 0.3)), Vector3(0, -0.16, 0), shirt_m)
		var el := Node3D.new()
		el.position.y = -0.32
		sh.add_child(el)
		if _baked:
			_part(el, GfxAssets.zombie_mesh("foreHand"), Vector3.ZERO, skin_m)
		else:
			_part(el, _capsule(0.045, 0.28), Vector3(0, -0.16, 0), skin_m)
			var hand := SphereMesh.new()
			hand.radius = 0.05
			hand.height = 0.1
			_part(el, hand, Vector3(0, -0.38, 0), skin_m, Vector3(0.9, 1.15, 0.65))
		_shoulder_j.append(sh)
		_elbow_j.append(el)
		if z.kind == "armored":
			var pad := SphereMesh.new()
			pad.radius = 0.09
			pad.height = 0.14
			_part(sh, pad, Vector3(0, 0.0, 0), metal_m)
	for sx in [-1.0, 1.0]:
		var hip := Node3D.new()
		hip.position = Vector3(sx * 0.1, -0.02, 0)
		_hips.add_child(hip)
		_part(hip, _geo("thigh", _capsule(0.08, 0.46)), Vector3(0, -0.22, 0), pants_m)
		var knee := Node3D.new()
		knee.position.y = -0.45
		hip.add_child(knee)
		if _baked:
			_part(knee, GfxAssets.zombie_mesh("shinFoot"), Vector3.ZERO, pants_m)
		else:
			_part(knee, _capsule(0.065, 0.43), Vector3(0, -0.22, 0), pants_m)
			var shoe := BoxMesh.new()
			shoe.size = Vector3(0.1, 0.07, 0.24)
			_part(knee, shoe, Vector3(0, -0.46, 0.07), (shirt_m as StandardMaterial3D).duplicate())
		_hip_j.append(hip)
		_knee_j.append(knee)
		_legs.append(hip)
	if z.kind == "armored":
		var morion := CylinderMesh.new()
		morion.top_radius = 0.07
		morion.bottom_radius = 0.13
		morion.height = 0.14
		_part(_head, morion, Vector3(0, 0.1, 0), metal_m)
		var cuirass := BoxMesh.new()
		cuirass.size = Vector3(0.38, 0.5, 0.26)
		_part(_spine, cuirass, Vector3(0, 0.34, 0), metal_m)
	if z.kind == "bloat":
		var gas := SphereMesh.new()
		gas.radius = 0.2
		gas.height = 0.4
		var gm := _mat(Color("98b04a"), 0.7)
		gm.emission_enabled = true
		gm.emission = Color("1a2800")
		_part(_spine, gas, Vector3(0, 0.25, 0.12), gm, Vector3(1.2, 1.0, 0.9))
	if z.crawler:
		for l in _legs:
			l.visible = false
	if z is BossSim:
		_boss_extras(z as BossSim, metal_m)
	elif z.kind == "gargoyle":
		_gargoyle_extras()
	if z.spawn_type == "ground":
		_mound = MeshInstance3D.new()
		var mm := SphereMesh.new()
		mm.radius = 0.75
		mm.height = 0.75
		mm.is_hemisphere = true
		_mound.mesh = mm
		_mound.material_override = _mat(Color("3a2e23"), 1.0)
		_mound.top_level = true
		add_child(_mound)
		_mound.global_position = Vector3(z.spawn_pos.x, 0.0, z.spawn_pos.z)
		_mound.scale = Vector3(0.2, 0.05, 0.2)

var _axe: Node3D
var _lantern_glow: MeshInstance3D

## Le Bourreau (cagoule, tablier, ceinture, lanterne-cœur dans le dos, hache géante) et le Maître Tanneur (ventre de gaz, tablier de cuir, masque à tubes) :
## primitives posées sur les articulations du zombie (boss.js / tanner.js _buildBody).
func _boss_extras(b: BossSim, iron: StandardMaterial3D) -> void:
	var black := _mat(Color("0e0e10"), 1.0)
	var leather := _mat(Color("2a1a14") if not b.mini else Color("5a3a22"), 0.9)
	if b.mini:
		var gas := _mat(Color("7aa830"), 0.6)
		gas.emission_enabled = true
		gas.emission = Color("233a08")
		var sp := SphereMesh.new()
		sp.radius = 0.27
		sp.height = 0.54
		_part(_spine, sp, Vector3(0, 0.12, 0.13), gas, Vector3(1.15, 1.05, 0.95))
		var ap := BoxMesh.new()
		ap.size = Vector3(0.46, 0.7, 0.05)
		_part(_spine, ap, Vector3(0, 0.15, 0.37), leather)
		var mk := SphereMesh.new()
		mk.radius = 0.13
		mk.height = 0.26
		_part(_head, mk, Vector3(0, 0.05, 0.03), black, Vector3(1, 1.05, 1.05))
		var sn := CylinderMesh.new()
		sn.top_radius = 0.035
		sn.bottom_radius = 0.05
		sn.height = 0.12
		var snm := _part(_head, sn, Vector3(0, -0.02, 0.15), iron)
		snm.rotation.x = PI / 2.0
		return
	var hood := SphereMesh.new()
	hood.radius = 0.15
	hood.height = 0.3
	_part(_head, hood, Vector3(0, 0.04, -0.005), black, Vector3(0.95, 1.18, 1.02))
	var peak := CylinderMesh.new()
	peak.top_radius = 0.0
	peak.bottom_radius = 0.13
	peak.height = 0.3
	_part(_head, peak, Vector3(0, 0.28, -0.02), black)
	var apron := BoxMesh.new()
	apron.size = Vector3(0.4, 0.62, 0.06)
	_part(_spine, apron, Vector3(0, 0.2, 0.17), leather)
	var belt := BoxMesh.new()
	belt.size = Vector3(0.46, 0.07, 0.3)
	_part(_spine, belt, Vector3(0, -0.05, 0.02), iron)
	for i in 2:
		var pad := SphereMesh.new()
		pad.radius = 0.1
		pad.height = 0.2
		_part(_shoulder_j[i], pad, Vector3(0, 0.03, 0), iron)
	# lanterne-cœur dans le dos : son point faible (dégâts x2 de dos)
	var lm := _mat(Color("ffa030"), 0.5)
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var ls := SphereMesh.new()
	ls.radius = 0.075
	ls.height = 0.15
	_part(_spine, ls, Vector3(0, 0.3, -0.2), lm)
	var gm := _mat(Color(1.0, 0.48, 0.09, 0.35), 0.5)
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	var gs := SphereMesh.new()
	gs.radius = 0.16
	gs.height = 0.32
	_lantern_glow = _part(_spine, gs, Vector3(0, 0.3, -0.2), gm)
	# hache géante dans la main droite
	_axe = Node3D.new()
	_axe.position = Vector3(0, -0.34, 0.02)
	_axe.rotation.x = -0.9
	_elbow_j[1].add_child(_axe)
	var wood := _mat(Color("4a3220"), 0.85)
	var hm := CylinderMesh.new()
	hm.top_radius = 0.028
	hm.bottom_radius = 0.034
	hm.height = 1.7
	_part(_axe, hm, Vector3(0, 0.5, 0), wood)
	var bl := BoxMesh.new()
	bl.size = Vector3(0.62, 0.46, 0.05)
	_part(_axe, bl, Vector3(0.31, 1.15, 0), iron)
	var edge := BoxMesh.new()
	edge.size = Vector3(0.05, 0.5, 0.07)
	_part(_axe, edge, Vector3(0.62, 1.15, 0), _mat(Color("c8ccd4"), 0.25))

## Gargouille : cornes et ailes de chauve-souris repliées (zombie.js makeKind('gargoyle')).
func _gargoyle_extras() -> void:
	var stone := _mat(Color("6f7378"), 1.0)
	for sx in [-1.0, 1.0]:
		var horn := CylinderMesh.new()
		horn.top_radius = 0.0
		horn.bottom_radius = 0.03
		horn.height = 0.17
		var h := _part(_head, horn, Vector3(sx * 0.07, 0.17, 0.0), stone)
		h.rotation = Vector3(-0.35, 0, -sx * 0.45)
		var wing := QuadMesh.new()
		wing.size = Vector2(0.8, 0.8)
		var wm := _mat(Color("6b7075"), 1.0)
		wm.cull_mode = BaseMaterial3D.CULL_DISABLED
		var pivot := Node3D.new()
		pivot.position = Vector3(sx * 0.08, 0.5, -0.14)
		pivot.rotation = Vector3(0.1, sx * 0.9, 0)
		_spine.add_child(pivot)
		var w := _part(pivot, wing, Vector3(sx * 0.4, 0.3, 0), wm)
		w.rotation.z = sx * 0.2

## zombie.js _bleed : seuil de sang ajouté par matériau (face, peau, haut, pantalon).
func _bleed(head: bool) -> void:
	if not _baked or _skin_mats.size() < 4:
		return
	var add := [0.16, 0.03, 0.0, 0.0] if head else [0.02, 0.05, 0.09, 0.03]
	for i in 4:
		var m: ShaderMaterial = _skin_mats[i]
		m.set_shader_parameter("blood", minf(1.0, float(m.get_shader_parameter("blood")) + float(add[i])))

## Maillage cuit s'il existe (sinon la primitive de secours).
func _geo(name: String, fallback: Mesh) -> Mesh:
	if _baked:
		return GfxAssets.zombie_mesh(name)
	return fallback

## Couleur depuis teinte / saturation / luminosité HSL (THREE.Color.setHSL).
static func _hsl(h: float, s: float, l: float) -> Color:
	var v := l + s * minf(l, 1.0 - l)
	return Color.from_hsv(h, 0.0 if v <= 0.0 else 2.0 * (1.0 - l / v), v)

func _mat(c: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m

func _capsule(r: float, h: float) -> CapsuleMesh:
	var m := CapsuleMesh.new()
	m.radius = r
	m.height = h
	m.radial_segments = 10
	m.rings = 4
	return m

func _part(parent: Node3D, mesh: Mesh, p: Vector3, mat: Material, sc := Vector3.ONE) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = mat
	m.position = p
	m.scale = sc
	parent.add_child(m)
	return m

## Appelé à chaque pas physique avant la simulation : mémorise la position précédente pour l'interpolation.
func remember() -> void:
	_prev_pos = sim.pos

func _process(dt: float) -> void:
	var t0 := Time.get_ticks_usec()
	_process_view(dt)
	ZombieModels.view_us += Time.get_ticks_usec() - t0   # --fps : coût CPU des vues de zombies
	PerfLog.add(&"zombies", t0)

func _process_view(dt: float) -> void:
	var z := sim
	var f := Engine.get_physics_interpolation_fraction()
	position = _prev_pos.lerp(z.pos, f)
	# apparition : invisible tant qu'il cogne (fenêtre) ou que la terre tremble (sol)
	var hidden := false
	if z.spawn_t > 0.0:
		hidden = z.spawn_elapsed < (Rules.WIN_WARN if z.spawn_type == "window" else Rules.GND_DELAY)
	if z is BossSim and (z as BossSim).hidden_flag:
		hidden = true
	_group.visible = not hidden
	if z.appear_total > 0.0:   # gargouille : elle gonfle sur son parapet avant de bondir
		var kk := clampf(1.0 - z.appear / z.appear_total, 0.0, 1.0) if z.appear > 0.0 else 1.0
		_group.scale = z.body_scale() * (0.15 + 0.85 * kk * kk * (3.0 - 2.0 * kk))
	if _axe != null:
		_axe.visible = not ((z as BossSim).axe_hide_t > 0.0)
	if _lantern_glow != null:
		(_lantern_glow.material_override as StandardMaterial3D).albedo_color.a = 0.3 + 0.15 * sin((z as BossSim).state_t * 6.0)
	_blob.visible = not hidden and z.pos.y > -0.4 and not (z.dead and z.death_t > 2.2)
	_blob.position.y = 0.015 - position.y
	if _mound != null:
		if z.spawn_t > 0.0:
			var k := minf(1.0, z.spawn_elapsed / Rules.GND_DELAY)
			_mound.scale = Vector3(0.3 + k * 0.8, 0.05 + k * 0.32, 0.3 + k * 0.8)
		else:
			_mound_t += dt   # le tertre s'affaisse en 6 s
			var kk := maxf(0.0, 1.0 - _mound_t / 6.0)
			_mound.scale = Vector3(1.1, 0.15 * kk + 0.001, 1.1)
			if kk <= 0.0:
				_mound.queue_free()
				_mound = null
	# flash rouge quand touché
	if z.health < _last_health and not z.dead:
		_flash = 0.1
	_last_health = z.health
	_flash = maxf(0.0, _flash - dt)
	for m in _skin_mats:
		if m is ShaderMaterial:
			m.set_shader_parameter("flash", 1.0 if _flash > 0.0 else 0.0)
		else:
			m.emission_enabled = _flash > 0.0
			m.emission = Color(0.4, 0.0, 0.0)
	if z.hit_count != _last_hits:   # le sang gagne du terrain à chaque touche (zombie.js _bleed) : tête -> visage, corps -> haut et peau
		for _i in z.hit_count - _last_hits:
			_bleed(z.last_hit_head)
		_last_hits = z.hit_count
	_group.rotation = Vector3(z.lean_x, z.yaw, 0.0)
	if z.dead:
		_death(z)
		return
	_pose.of(z)
	_apply()

func _apply() -> void:
	var p := _pose
	for i in 2:
		_hip_j[i].rotation.x = p.hip_x[i]
		_knee_j[i].rotation.x = p.knee_x[i]
		_shoulder_j[i].rotation.x = p.shoulder_x[i]
		_shoulder_j[i].rotation.z = p.shoulder_z[i]
		_elbow_j[i].rotation.x = p.elbow_x[i]
	_spine.rotation = Vector3(p.spine_x, 0.0, p.spine_z)
	_hips.position.y = p.hips_y
	_head.rotation = Vector3(p.head_x, p.head_y, p.head_z)
	_jaw.rotation.x = p.jaw_x
	if sim is BossSim:   # poses propres aux attaques (boss.js _pose)
		var o: Dictionary = (sim as BossSim).pose_overrides()
		if not o.is_empty():
			_spine.rotation = Vector3(o.get("spine_x", _spine.rotation.x), 0.0, o.get("spine_z", _spine.rotation.z))
			_head.rotation = Vector3(o.get("head_x", _head.rotation.x), o.get("head_y", _head.rotation.y), o.get("head_z", _head.rotation.z))
			for i in 2:
				_shoulder_j[i].rotation.x = o.get("sh%d_x" % i, _shoulder_j[i].rotation.x)
				_shoulder_j[i].rotation.z = o.get("sh%d_z" % i, _shoulder_j[i].rotation.z)
				_elbow_j[i].rotation.x = o.get("el%d_x" % i, _elbow_j[i].rotation.x)

func _death(z: ZombieSim) -> void:
	if z.ash_t >= 0.0:   # l'Aube : il pâlit, s'affaisse et s'envole en cendres (zombie.js _ashStep)
		var k := minf(1.0, z.ash_t / float(Config.at("summit.dawn.ash")))
		var sc := z.body_scale()
		_group.scale = Vector3(sc.x, sc.y * (1.0 - 0.94 * k * k), sc.z)
		_group.visible = z.ash_t < float(Config.at("summit.dawn.ash")) + 0.1
		for m in _skin_mats:
			if m is ShaderMaterial:
				m.set_shader_parameter("tint", (m.get_shader_parameter("tint") as Color).lerp(Color(0.8, 0.78, 0.74), minf(1.0, k * 1.6) * 0.1))
		return
	var pr := minf(1.0, z.death_t / DEATH_FALL_TIME)
	var e := 1.0 - (1.0 - pr) * (1.0 - pr)
	var r := _group.rotation
	if _death_style == 0:
		r.x = -e * (PI / 2.0)
	elif _death_style == 1:
		r.x = e * (PI / 2.0)
	else:
		r.z = _death_side * e * (PI / 2.0)
	_group.rotation = r
	_head_mesh.visible = not z.headless   # tête explosée
	for i in 2:   # membres qui s'affalent
		_shoulder_j[i].rotation.x *= 1.0 - get_process_delta_time() * 3.0
		_shoulder_j[i].rotation.z += (SIDE(i) * 1.1 - _shoulder_j[i].rotation.z) * get_process_delta_time() * 4.0
		_elbow_j[i].rotation.x *= 1.0 - get_process_delta_time() * 3.0
		_hip_j[i].rotation.z += ((1.0 if i else -1.0) * 0.25 - _hip_j[i].rotation.z) * get_process_delta_time() * 4.0
		_hip_j[i].rotation.x *= 1.0 - get_process_delta_time() * 3.0
		_knee_j[i].rotation.x *= 1.0 - get_process_delta_time() * 3.0
	if z.death_t > SINK_START:
		_group.position.y = -(z.death_t - SINK_START) * SINK_SPEED

static func SIDE(i: int) -> float:
	return -1.0 if i == 0 else 1.0
