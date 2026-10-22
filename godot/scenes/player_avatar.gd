class_name PlayerAvatar
extends Node3D
## v0.25.1 : le joueur vu de l'extérieur, à pied, quand la vue est à la 3e personne (Options > « Vue », touche T) : le modèle 3D du personnage choisi (CharacterModel), son arme
## en main (les modèles de la vue à la première personne, WeaponModels) et son couteau. Les mains et bras de la première personne sont cachés (weapon_view.hide_gun) pendant ce temps.
## Sur une machine ou dans la rame, le cavalier est celui de rides_view.gd : cet avatar ne s'y montre pas.
## Mouvement : le corps regarde dans le sens de la marche (jambes), le buste se tord vers la visée (AvatarPose) ; en marche arrière, jambes à l'envers.
## Animations du modèle : Idle, Walk, Run, Sprint (v0.31.0), Jump, Death (à terre) ; visée, tir, rechargement, coup de couteau : posés par AvatarPose. Aucune lecture de la simulation sauf Game.player / Game.arms.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const MeleeModels := preload("res://scenes/melee_models.gd")
const BACKWARD := deg_to_rad(105.0)   ## au-delà, le corps recule (jambes à l'envers)
const TWIST_MAX := deg_to_rad(110.0)
const SPRINT_EASE := 7.0
const ADS_EASE := 12.0

var _cam: Camera3D
var _char: CharacterModel
var _cid := ""
var _pose: AvatarPose
var _gun: Node3D
var _gun_id := ""
var _gun_pap := -1
var _knife: Node3D
var _axe: Node3D
var _flash: MeshInstance3D
var _flash_light: OmniLight3D
var _flash_t := 0.0
var _fill: OmniLight3D          ## lueur très douce autour du personnage la nuit (sans elle il se réduit à une silhouette noire)
var _body_yaw := 0.0
var _prev := Vector3.ZERO
var _cur := Vector3.ZERO
var _sprint_k := 0.0
var _ads_k := 0.0
var _placed := false
var dbg_pose := ""          ## --avatar-pose=Idle|Walk|Run|Jump : fige l'animation (captures)

func setup(cam: Camera3D) -> void:
	_cam = cam
	visible = false
	Game.shot_fired.connect(_on_shot)
	# v0.31.0 : le personnage (30 k triangles, 57 os, matériaux) est créé dès le chargement, caché : son instanciation (~20 ms) ne tombe pas
	# sur la première image de la vue à la troisième personne
	if Game.settings != null:
		_make_char(String(CharacterDefs.of_slot(int(Game.settings.get_value("char")))["id"]))

func _physics_process(_dt: float) -> void:
	if Game.player == null:
		return
	_prev = _cur
	_cur = Game.player.pos
	if not _placed:
		_prev = _cur
		_placed = true

func _want_visible() -> bool:
	var p := Game.player
	if p == null or Game.arms == null:
		return false
	var c := Game.view_cam()
	if not c.placed or c.dist <= float(Config.at("vehicles.cam.avatarMin")):
		return false
	if Game.rides != null and (Game.rides.ride != null or Game.rides.on_tram != null):
		return false
	if Game.finale != null and Game.finale.orbit_on:
		return false
	return true

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"avatar", _pt)

func _tick(dt: float) -> void:
	var show := _want_visible()
	if not show:
		if visible:
			visible = false
			if _flash != null:
				_flash.visible = false
				_flash_light.visible = false
		return
	var p := Game.player
	var cid := String(CharacterDefs.of_slot(int(Game.settings.get_value("char")))["id"])
	if _char == null or cid != _cid:
		_make_char(cid)
	if _char == null:
		return   # modèle absent : rien (la caméra reste à la 3e personne)
	if not visible:
		visible = true
		_body_yaw = p.yaw
	var arms := Game.arms
	var w: WeaponState = arms.current
	if w.id != _gun_id or w.pap != _gun_pap or _gun == null:
		_build_gun(w)
	# position (interpolée comme la caméra) et cap du corps
	var f := Engine.get_physics_interpolation_fraction()
	global_position = _prev.lerp(_cur, f)
	var vel := Vector2(p.vel.x, p.vel.z)
	var spd := vel.length()
	var back := false
	if p.dead or p.downed:
		_body_yaw = lerp_angle(_body_yaw, p.yaw, 1.0 - exp(-8.0 * dt))
	elif spd > 0.4:
		var rel := wrapf(atan2(-vel.x, -vel.y) - p.yaw, -PI, PI)
		if absf(rel) > BACKWARD:
			rel = wrapf(rel + PI, -PI, PI)
			back = true
		_body_yaw = lerp_angle(_body_yaw, p.yaw + rel, 1.0 - exp(-10.0 * dt))
	elif absf(wrapf(p.yaw - _body_yaw, -PI, PI)) > deg_to_rad(55.0):
		_body_yaw = lerp_angle(_body_yaw, p.yaw, 1.0 - exp(-7.0 * dt))   # demi-tour sur place quand la visée s'éloigne trop
	var twist := clampf(wrapf(p.yaw - _body_yaw, -PI, PI), -TWIST_MAX, TWIST_MAX)
	_body_yaw = p.yaw - twist
	_char.rotation.y = _body_yaw + PI
	# animation
	var anim := "Idle"
	var scale := 1.0
	if p.dead or p.downed:
		anim = "Death"
	elif not p.on_ground or not p.vault.is_empty():
		anim = "Jump"
	elif spd >= 4.3:
		anim = "Sprint" if p.sprinting and _char.player.has_animation("Sprint") else "Run"
		scale = clampf(spd / (7.0 if anim == "Sprint" else 6.0), 0.8, 1.6)
	elif spd > 0.4:
		anim = "Walk"
		scale = clampf(spd / 1.7, 0.6, 2.2)
	if dbg_pose != "":
		anim = dbg_pose
	_char.play(anim, -scale if back else scale)
	# posture armée
	var armed := not (p.dead or p.downed)
	_sprint_k = move_toward(_sprint_k, 1.0 if (p.sprinting and arms.aim < 0.05 and not w.reloading and arms.melee_t < 0.0) else 0.0, dt * SPRINT_EASE)
	_ads_k = move_toward(_ads_k, arms.aim, dt * ADS_EASE)
	_pose.posed = armed
	_pose.twist = twist
	_pose.aim_pitch = clampf(p.pitch, -1.2, 1.2)
	_pose.sprint_k = _sprint_k
	_pose.ads_k = _ads_k
	_pose.reload_p = clampf(w.reload_t / float(w.cfg["reloadTime"]), 0.0, 1.0) if w.reloading else -1.0
	var K: Dictionary = Config.at("knife")
	_pose.melee_u = clampf(arms.melee_t / float(K["anim"]), 0.0, 1.0) if arms.melee_t >= 0.0 else -1.0
	_pose.hands = WeaponModels.hands(w.id)
	var melee := armed and arms.melee_t >= 0.0
	_gun.visible = armed and not melee
	_pose.knife = _axe if arms.has_axe else _knife
	_knife.visible = melee and not arms.has_axe
	_axe.visible = melee and arms.has_axe
	var night := 1.0 - clampf(Game.daynight.sky_k * 1.6, 0.0, 1.0)
	_fill.visible = night > 0.02
	_fill.light_energy = 0.55 * night
	if _flash_t > 0.0:
		_flash_t -= dt
		if _flash_t <= 0.0:
			_flash.visible = false
			_flash_light.visible = false

## Bouche de l'arme dans le monde (traçants) ; INF si l'arme n'est pas montrée.
func muzzle_world() -> Vector3:
	if _gun == null or not is_instance_valid(_gun) or not _gun.is_inside_tree() or not _gun.visible or _gun_id == "":
		return Vector3.INF
	return _gun.to_global(WeaponModels.muzzle(_gun_id))

func _on_shot(_o: Vector3, _e: Vector3) -> void:
	if not visible or _flash == null or not _gun.visible:
		return
	var w: WeaponState = Game.arms.current
	if w.cfg.get("flash", true) == false:
		return
	var t := String(w.cfg["type"])
	var heavy := t == "shotgun" or t == "semi" or t == "launcher"
	var sc := 1.4 if heavy else 0.8 + randf() * 0.5
	_flash.scale = Vector3(sc, sc, sc)
	_flash.rotation.z = randf() * PI
	_flash.visible = true
	_flash_light.visible = true
	_flash_t = 0.045

# ---------------------------------------------------------------- construction
func _make_char(cid: String) -> void:
	if _char != null:
		_char.queue_free()
		_char = null
		_gun = null
		_gun_id = ""
	_cid = cid
	_char = CharacterModel.create(cid)
	if _char == null:
		return
	add_child(_char)
	_char.set_props_visible(false)   # canne, baguette : les mains tiennent l'arme
	_pose = AvatarPose.new()
	_pose.name = "AvatarPose"
	_char.skeleton.add_child(_pose)
	_knife = MeleeModels.build_knife()
	_axe = MeleeModels.build_axe()
	for n: Node3D in [_knife, _axe]:
		_world(n, 0.0)
		n.visible = false
		_char.add_child(n)
	_pose.knife = _knife
	_build_flash()
	_fill = OmniLight3D.new()
	_fill.light_color = Color(0.75, 0.82, 1.0)
	_fill.omni_range = 4.0
	_fill.omni_attenuation = 1.5
	_fill.shadow_enabled = false
	_fill.position = Vector3(0.0, 2.1, -0.9)   # (repère du modèle : derrière et au-dessus : le dos éclairé)
	_fill.visible = false
	_char.add_child(_fill)

func _build_gun(w: WeaponState) -> void:
	if _gun != null:
		_gun.queue_free()
	var lvl: Variant = Pap.level(w.pap)
	var tint: Variant = Config.color(int(lvl["color"])) if lvl != null else null
	_gun = WeaponModels.build(w.id, tint)
	_world(_gun, 0.10)
	_char.add_child(_gun)
	_pose.gun = _gun
	_gun_id = w.id
	_gun_pap = w.pap
	if _flash != null:
		_flash.get_parent().remove_child(_flash)
		_flash_light.get_parent().remove_child(_flash_light)
		_gun.add_child(_flash)
		_gun.add_child(_flash_light)
		var m := WeaponModels.muzzle(w.id)
		_flash.position = m + Vector3(0, 0, -0.04)
		_flash_light.position = m + Vector3(0, 0.04, -0.1)

## Un modèle de la vue à la première personne devient un objet du monde : couche 1 (éclairé par la lune, le soleil et les lampadaires), ombres, émission réduite.
static func _world(n: Node, emission: float) -> void:
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		mi.layers = 1
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		if mi.mesh != null:
			for i in mi.mesh.get_surface_count():
				var m := mi.get_surface_override_material(i)
				if m is StandardMaterial3D:
					(m as StandardMaterial3D).emission_energy_multiplier = minf((m as StandardMaterial3D).emission_energy_multiplier, emission) if emission > 0.0 else (m as StandardMaterial3D).emission_energy_multiplier * 0.3
		var o := mi.material_override
		if o is StandardMaterial3D:
			(o as StandardMaterial3D).emission_energy_multiplier = 0.08
	for c in n.get_children():
		_world(c, emission)

func _build_flash() -> void:
	var tex := GradientTexture2D.new()
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var gr := Gradient.new()
	gr.set_color(0, Color(1, 1, 1, 1))
	gr.set_color(1, Color(1, 1, 1, 0))
	tex.gradient = gr
	tex.width = 64
	tex.height = 64
	_flash = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.34, 0.34)
	_flash.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_texture = tex
	m.albedo_color = Color("ffcc66")
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	_flash.material_override = m
	_flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_flash.visible = false
	add_child(_flash)
	_flash_light = OmniLight3D.new()
	_flash_light.light_color = Color("ffaa44")
	_flash_light.omni_range = 7.0
	_flash_light.omni_attenuation = 2.0
	_flash_light.light_energy = 0.9
	_flash_light.shadow_enabled = false
	_flash_light.visible = false
	add_child(_flash_light)
