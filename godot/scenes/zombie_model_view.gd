extends Node3D
## J16 : vue d'un zombie par un VRAI modèle animé (Quaternius, assombri et sali par le shader zombie_model) piloté par un ZombieSim. Remplace la silhouette
## en primitives de zombie_view.gd pour les zombies ordinaires (normal, coureur, boiteux, rampant, chevalier de fer, pestiféré) ; boss, gargouilles et Ange
## gardent l'ancienne vue. La simulation n'est pas touchée : les états (marche, course, attaque, enjambement, apparition, mort, tête explosée) sont lus sur le
## ZombieSim ; l'animation est avancée À LA MAIN (AnimationPlayer en mode manuel) avec une fréquence qui baisse avec la distance et rien hors champ.
## Les instances (squelette, maillages) viennent d'un pool (ZombieModels) et y retournent à la libération de la vue.

const ZombieView := preload("res://scenes/zombie_view.gd")
const Models := preload("res://scenes/zombie_models.gd")
const DEATH_TIME := 0.7        ## durée de la chute (s) : Death est ralentie ou accélérée pour la tenir
const SINK_START := 2.5
const SINK_SPEED := 0.8
const HIT_COOLDOWN := 0.7
const HIT_RATE := 1.5

var sim: ZombieSim
var _prev_pos := Vector3.ZERO
var _group: Node3D
var _rig: ZombieModels.Rig
var _blob: MeshInstance3D
var _mound: MeshInstance3D
var _vkey := ""
var _crawl_flag := false
var _v: Dictionary = {}
var _entry: Dictionary = {}
var _anims: Dictionary = {}
var _tint := Color.WHITE
var _seed := 0.0
var _phase := 0.0
var _blood := 0.0
var _last_hits := 0
var _last_health := 0.0
var _flash := 0.0
var _flash_on := false
var _mound_t := 0.0
var _cur := ""
var _acc := 0.0
var _frame := 0
var _oneshot_t := 0.0
var _hit_cd := 0.0
var _was_attacking := false
var _dead_started := false
var _headless_done := false
var _death_final := false
var _shadow_on := true
var _t := 0.0
var _base_scale := Vector3.ONE   ## échelle du modèle sans la dérive de respiration
var _advanced := 0               ## nombre d'avances de l'animation (tests, bench)

func setup(z: ZombieSim) -> void:
	sim = z
	_prev_pos = z.pos
	position = z.pos
	_last_health = z.health
	_last_hits = z.hit_count
	_seed = ZombieSim.hash_id(z.id, 21) * 40.0
	_phase = ZombieSim.hash_id(z.id, 22)
	_blob = MeshInstance3D.new()
	var bq := QuadMesh.new()
	var big := 1.15 if z.crawler else 0.8
	bq.size = Vector2(big * 1.1, big)
	_blob.mesh = bq
	_blob.material_override = ZombieView._blob_material()
	_blob.rotation_degrees = Vector3(-90, 0, 0)
	_blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_blob)
	_group = Node3D.new()
	_group.rotation_order = EULER_ORDER_YXZ
	add_child(_group)
	_set_variant(true)
	if ZombieModels.show_boxes:
		_debug_boxes()
	if z.spawn_type == "ground":
		_mound = MeshInstance3D.new()
		var mm := SphereMesh.new()
		mm.radius = 0.75
		mm.height = 0.75
		mm.is_hemisphere = true
		_mound.mesh = mm
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color("3a2e23")
		mat.roughness = 1.0
		_mound.material_override = mat
		_mound.top_level = true
		add_child(_mound)
		_mound.global_position = Vector3(z.spawn_pos.x, 0.0, z.spawn_pos.z)
		_mound.scale = Vector3(0.2, 0.05, 0.2)

## --show-boxes : les boîtes de touche de la simulation (tête rouge, corps bleu) en transparence, pour juger de l'écart avec le modèle dessiné.
## v0.20.0 : ce sont les boîtes du modèle (ZombieHit), remises à jour à chaque image selon l'animation.
func _debug_boxes() -> void:
	var hm := SphereMesh.new()
	hm.radius = 1.0
	hm.height = 2.0
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE
	_dbg_head = _box_instance(hm, Color(1, 0, 0, 0.35))
	_dbg_body = _box_instance(bm, Color(0.2, 0.4, 1, 0.22))
	_update_debug_boxes()
	# le crâne dessiné (vert) : centre de la boîte du crâne suivi par l'os de la tête, dans l'échelle du modèle (même calcul que la mesure de test_j16)
	var skull: MeshInstance3D = null
	for m in _rig.heads:
		if String(m.name) == "Head_Skull":
			skull = m
	if skull != null:
		var sa: AABB = skull.mesh.get_aabb()
		var ba := BoneAttachment3D.new()
		ba.bone_name = "Head"
		_rig.skel.add_child(ba)
		var sp := SphereMesh.new()
		sp.radius = 0.5 * minf(sa.size.x, sa.size.y) * 0.95
		sp.height = sp.radius * 2.0
		var mi := MeshInstance3D.new()
		mi.mesh = sp
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0, 1, 0, 0.3)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mi.material_override = m
		mi.transform = _rig.skel.get_bone_global_rest(_rig.skel.find_bone("Head")).affine_inverse() * Transform3D(Basis.IDENTITY, sa.get_center())
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ba.add_child(mi)
		_dbg.append(ba)

var _dbg: Array[Node] = []
var _dbg_head: MeshInstance3D
var _dbg_body: MeshInstance3D

func _box_instance(mesh: Mesh, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_group.add_child(mi)
	return mi

func _update_debug_boxes() -> void:
	var sh := ZombieHit.shapes(sim)
	_dbg_head.position = sh["hc"]
	_dbg_head.scale = Vector3.ONE * float(sh["hr"])
	_dbg_head.visible = not sim.headless
	_dbg_body.position = sh["bc"]
	_dbg_body.scale = (sh["bh"] as Vector3) * 2.0

## (Re)pose la variante d'après l'état de la simulation : change de modèle si besoin (l'armuré qui perd ses jambes passe sur le modèle qui sait ramper).
func _set_variant(first: bool) -> void:
	var key := ZombieModels.variant_key(sim)
	var v := ZombieModels.variant(key)
	var model := ZombieModels.model_of(v, sim)
	var armor := bool(v.get("armor", false))
	var swap := first or _rig == null or _rig.model != model or _rig.armor != armor
	_vkey = key
	_crawl_flag = sim.crawler
	_v = v
	_anims = v["anim"]
	_entry = ZombieModels.model_entry(model)
	if swap:
		if _rig != null:
			ZombieModels.release(_rig)
		_rig = ZombieModels.acquire(model, armor)
		_group.add_child(_rig.root)
		_cur = ""
		var tints: Array = v["tints"] if v.has("tints") else ZombieModels.variant("normal")["tints"]
		var tt: Array = tints[int(floor(ZombieSim.hash_id(sim.id, 1) * tints.size())) % tints.size()]
		var k := float(ZombieModels.table().get("darken", 0.85)) * (0.9 + 0.2 * ZombieSim.hash_id(sim.id, 5))
		_tint = Color(float(tt[0]) * k, float(tt[1]) * k, float(tt[2]) * k)
		var b: Array = v.get("blood0", [0.04, 0.24])
		_blood = float(b[0]) + (float(b[1]) - float(b[0])) * ZombieSim.hash_id(sim.id, 9)
		var col: Array = v.get("colorize", [0.0, 0.0, 0.0, 0.0])
		for m in _rig.meshes:
			m.set_instance_shader_parameter("tint", _tint)
			m.set_instance_shader_parameter("colorize", Color(float(col[0]), float(col[1]), float(col[2]), float(col[3])))
			m.set_instance_shader_parameter("blood", _blood)
			m.set_instance_shader_parameter("flash", 0.0)
			m.set_instance_shader_parameter("seed", _seed)
		_flash_on = false
	_rig.root.position = Vector3.ZERO
	_rig.root.rotation = Vector3.ZERO
	var sc := sim.body_scale()
	var bw := sc.x / sc.y
	var xz := float(_entry["xz"]) * float(v.get("xz", 1.0)) * (sqrt(bw) if key == "bloat" else 1.0)
	var s := float(_entry["scale"]) * float(v.get("scale", 1.0)) * sc.y
	_base_scale = Vector3(s * xz, s, s * xz)
	_rig.root.scale = _base_scale

func _exit_tree() -> void:
	for n in _dbg:
		n.queue_free()
	_dbg.clear()
	if _rig != null:
		ZombieModels.release(_rig)
		_rig = null

func remember() -> void:
	_prev_pos = sim.pos

## Joue (ou règle la vitesse de) l'animation `an` ; phase : décalage de départ des cycles (évite l'effet clone).
func _play(an: String, speed: float, loop_phase := -1.0) -> void:
	_rig.ap.speed_scale = speed
	if _cur != an:
		_cur = an
		_rig.ap.play(an)
		if loop_phase >= 0.0:
			_rig.ap.seek(loop_phase * float(_rig.lens[an]), false)

func _process(dt: float) -> void:
	var t0 := Time.get_ticks_usec()
	_process_view(dt)
	ZombieModels.view_us += Time.get_ticks_usec() - t0   # --fps : coût CPU des vues de zombies
	PerfLog.add(&"zombies", t0)

func _process_view(dt: float) -> void:
	var z := sim
	_t += dt
	var f := Engine.get_physics_interpolation_fraction()
	position = _prev_pos.lerp(z.pos, f)
	if ZombieModels.variant_key(z) != _vkey or z.crawler != _crawl_flag:
		_set_variant(false)
	var hidden := false
	if z.spawn_t > 0.0:
		hidden = z.spawn_elapsed < (Rules.WIN_WARN if z.spawn_type == "window" else Rules.GND_DELAY)
	_group.visible = not hidden
	_blob.visible = not hidden and z.pos.y > -0.4 and not (z.dead and z.death_t > 2.2)
	_blob.position.y = 0.015 - position.y
	_mound_step(dt)
	_hit_cd = maxf(0.0, _hit_cd - dt)
	_oneshot_t = maxf(0.0, _oneshot_t - dt)
	# flash rouge quand touché ; le sang gagne du terrain à chaque touche (zombie.js _bleed)
	if z.health < _last_health and not z.dead:
		_flash = 0.1
		if not z.attacking and _hit_cd <= 0.0 and not z.crawler and z.vault.is_empty() and z.spawn_t <= 0.0:
			_hit_cd = HIT_COOLDOWN
			_oneshot_t = float(_rig.lens[_anims["hit"]]) / HIT_RATE
			_cur = ""
			_play(String(_anims["hit"]), HIT_RATE)
	_last_health = z.health
	_flash = maxf(0.0, _flash - dt)
	var fl := _flash > 0.0
	if fl != _flash_on:
		_flash_on = fl
		for m in _rig.meshes:
			m.set_instance_shader_parameter("flash", 1.0 if fl else 0.0)
	if z.hit_count != _last_hits:
		_blood = minf(1.0, _blood + 0.09 * (z.hit_count - _last_hits) + (0.08 if z.last_hit_head else 0.0))
		_last_hits = z.hit_count
		for m in _rig.meshes:
			m.set_instance_shader_parameter("blood", _blood)
	_group.rotation = Vector3(z.lean_x, z.yaw, 0.0)
	if _dbg_head != null:
		_update_debug_boxes()
	if z.dead:
		_death(z)
	else:
		_alive_state(z, dt)
	_advance(dt, z)

func _mound_step(dt: float) -> void:
	if _mound == null:
		return
	var z := sim
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

## Choix de l'animation d'un zombie vivant d'après l'état de la simulation.
func _alive_state(z: ZombieSim, _dt: float) -> void:
	var attack_started := z.attacking and not _was_attacking
	_was_attacking = z.attacking
	var A := _anims
	var speed_f := z.body_scale().y   # la foulée grandit avec la taille
	var lens := _rig.lens
	var rock := 0.0
	var dip := 0.0
	if attack_started and not z.crawler:
		var an := String(A["attack"])
		var hit_t := float(lens[an]) * float(_entry["hit_frac"])
		_cur = ""
		_play(an, hit_t / Rules.ZOMBIE_ATTACK_WINDUP)
		_oneshot_t = float(lens[an]) / (hit_t / Rules.ZOMBIE_ATTACK_WINDUP)
	if z.spawn_t > 0.0:
		if z.spawn_type == "window":
			var an := String(A["vault"])
			_play(an, float(lens[an]) / Rules.WIN_CLIMB)
		else:
			_play(String(A["idle"]), 1.0, _phase)
	elif _oneshot_t > 0.0:
		pass   # coup donné ou touche encaissée : on laisse finir
	elif not z.vault.is_empty():
		var an := String(A["vault"])
		_play(an, float(lens[an]) / float(Config.at("zombie.vault.time")))
	elif z.crawler:
		var an := String(A["crawl"])
		_play(an, clampf(z.speed / (float(_entry["ref_crawl"]) * _entry["scale"] * speed_f), 0.5, 2.2) if z.moving else 0.7, _phase)
	elif z.moving:
		var sp := z.speed * (Rules.LIMP_SPEED if z.limp else 1.0)
		var run := z.runner or sp >= float(ZombieModels.table()["run_from_speed"])
		var an := String(A["run"] if (run and not z.limp) else A["walk"])
		if String(A["walk"]) == "Run":   # variante coureur : « marche » = course
			run = true
			an = "Run"
		var ref := float(_entry["ref_run"] if run else _entry["ref_walk"]) * float(_entry["scale"]) * speed_f
		var rate := clampf(sp / ref, 0.7, 1.4) if run else clampf(sp / ref, 0.55, 1.7)
		if z.limp and not run:
			rock = sin(z.walk_t * 0.5) * float(_v.get("limp_roll", 0.09))
			dip = float(_v.get("limp_dip", 0.05))
		_play(an, rate, _phase)
	else:
		_play(String(A["idle"]), 1.0, _phase)
	_rig.root.rotation.z = rock
	_rig.root.position.y = -dip
	if _vkey == "bloat":   # le pestiféré respire : ventre qui gonfle et se dégonfle
		var k := 1.0 + 0.035 * sin(_t * 2.3 + _phase * 6.28)
		_rig.root.scale = Vector3(_base_scale.x * k, _base_scale.y, _base_scale.z * k)

func _death(z: ZombieSim) -> void:
	if z.ash_t >= 0.0:   # l'Aube : il s'affaisse et s'envole en cendres
		var dk := minf(1.0, z.ash_t / float(Config.at("summit.dawn.ash")))
		_rig.root.scale = Vector3(_base_scale.x, _base_scale.y * (1.0 - 0.94 * dk * dk), _base_scale.z)
		_group.visible = z.ash_t < float(Config.at("summit.dawn.ash")) + 0.1
		return
	_rig.root.rotation = Vector3.ZERO
	if not _dead_started:
		_dead_started = true
		var an := String(_anims["death"])
		_oneshot_t = 0.0
		_cur = ""
		_play(an, float(_rig.lens[an]) / DEATH_TIME)
		_rig.ap.seek(minf(z.death_t, DEATH_TIME) * float(_rig.lens[an]) / DEATH_TIME, true)
		_rig.ap.advance(0.0)
	if z.headless and not _headless_done:   # tête explosée : on la cache (le cou ouvert est rouge)
		_headless_done = true
		for m in _rig.heads:
			m.visible = false
		_blood = maxf(_blood, 0.75)
		for m in _rig.meshes:
			m.set_instance_shader_parameter("blood", _blood)
	if z.death_t > SINK_START:
		_group.position.y = -(z.death_t - SINK_START) * SINK_SPEED

## Avance l'animation à la main : chaque image près de la caméra, une sur 2 / 4 / 8 plus loin, jamais hors du champ ni une fois la chute finie.
func _advance(dt: float, z: ZombieSim) -> void:
	_acc += dt
	_frame += 1
	if z.dead and z.death_t > DEATH_TIME + 0.4 and _dead_started:
		if not _death_final:   # cadavre au sol : pose finale posée une fois (même hors champ), plus rien à calculer ensuite
			_death_final = true
			var an := String(_anims["death"])
			_rig.ap.seek(float(_rig.lens[an]), true)
			_rig.ap.advance(0.0)
		return
	if z.ash_t >= 0.0:
		return
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		_rig.ap.advance(_acc)
		_acc = 0.0
		_advanced += 1
		return
	var d := cam.global_position.distance_to(global_position)
	var L: Dictionary = Models.table()["lod"]
	var every := 1
	if d > float(L["far"]):
		every = 8
	elif d > float(L["mid"]):
		every = 4
	elif d > float(L["near"]):
		every = 2
	if d > 6.0 and not cam.is_position_in_frustum(global_position + Vector3(0, 1.0, 0)):
		return   # hors champ : le temps ne s'accumule pas (la pose reprend où elle était)
	if (_frame + z.id) % every != 0:
		return
	_rig.ap.advance(_acc)
	_acc = 0.0
	_advanced += 1
	var sh := d < float(L["shadow_max"])
	if sh != _shadow_on:
		_shadow_on = sh
		for m in _rig.meshes:
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if sh else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
