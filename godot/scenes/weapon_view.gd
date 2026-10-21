extends Node3D
## Présentation des armes (J4) : arme à la première personne (modèles de data/weapon_models.json, avec la position à la hanche et en visée de chacun), obus et grenades en vol, flash des explosions, coup de couteau. Ne fait que lire Game.arms.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const MeleeModels := preload("res://scenes/melee_models.gd")
const THROW_TIME := 0.45        ## geste de lancer de grenade (v0.20.2 : la main tend la grenade puis se retire ; l'arme se baisse)
const SPRINT_EASE := 7.0

const VIEW_LIGHT := 1.0
const EXPLOSION_TIME := 0.45
const KICK_DECAY := 9.0

signal posed                    ## fin de _process : l'arme est à sa pose de l'image (la caméra est déjà à jour : main passe avant)
var hold_fx := false            ## --hold-fx : l'éclair de bouche reste affiché (captures)
var avatar: Node3D              ## v0.25.1 : le personnage de la vue à la 3e personne : la bouche du traçant est celle de SON arme (PlayerAvatar.muzzle_world)
var hide_gun := false           ## J5 : arme de la vue cachée (on conduit, ou la caméra regarde de l'extérieur d'un véhicule)
var _cam: Camera3D
var _gun: Node3D
var _gun_id := ""
var _gun_pap := -1
var dbg_melee_t := -1.0              ## captures : fige le coup de couteau / de hache à cet instant (--melee-pose=T), sans toucher à la sim
var _knife: Node3D
var _axe: Node3D
var _axe_hand: Node3D
var _axe_sleeve: Array = []
var _kick := 0.0
var _shells: Array[MeshInstance3D] = []
var _nades: Array[MeshInstance3D] = []
var _booms: Array = []          # [mesh, t]
var _shell_mat := StandardMaterial3D.new()
var _nade_mat := StandardMaterial3D.new()
var _flash: MeshInstance3D       ## J11 : éclair de bouche (player.js : flash, 0,045 s) et sa lumière
var _flash_light: OmniLight3D
var _flash_t := 0.0
var _flash_tex: GradientTexture2D
var _hands: HandsRig                ## v0.20.2 : bras et mains de l'arme en main (enfants du modèle)
var _knife_hand: Node3D             ## poing sur le manche du couteau (enfant du couteau)
var _knife_sleeve: Array = []
var _throw: Node3D                  ## main qui lance la grenade (enfant de la caméra)
var _throw_nade: MeshInstance3D
var _throw_sleeve: Array = []
var _throw_t := -1.0
var _nades_prev := 0
var _sprint_k := 0.0

func setup(cam: Camera3D) -> void:
	_cam = cam
	HandsRig.set_outfit(String(CharacterDefs.of_slot(int(Game.settings.get_value("char")))["id"]))   # v0.21.2 : gants et manches de la tenue choisie
	_shell_mat.albedo_color = Color("2f3b1f")
	_nade_mat.albedo_color = Color("2f3b1f")
	_knife = Node3D.new()   # couteau tenu (MeleeModels.build_knife) ; _axe : Hache du Bourreau (remplace le couteau)
	_knife.visible = false
	cam.add_child(_knife)
	_knife.add_child(MeleeModels.build_knife())
	_axe = Node3D.new()
	_axe.visible = false
	cam.add_child(_axe)
	_axe.add_child(MeleeModels.build_axe())
	_knife_hand = HandsRig.make_fist()
	_knife_hand.position = Vector3.ZERO
	_knife.add_child(_knife_hand)
	_knife_sleeve = HandsRig.make_sleeve(_knife)
	_axe_hand = HandsRig.make_fist()
	_axe.add_child(_axe_hand)
	_axe_sleeve = HandsRig.make_sleeve(_axe)
	_throw = HandsRig.make_fist()
	_throw.visible = false
	cam.add_child(_throw)
	_throw_nade = HandsRig._part(_throw, "ball", "nade", Vector3(0.0, 0.046, -0.01), Vector3(0.07, 0.07, 0.07))
	_throw_sleeve = HandsRig.make_sleeve(cam)
	for n in _throw_sleeve:
		n.visible = false
	Game.shot_fired.connect(_on_shot)
	Game.explosion.connect(_on_explosion)

## Éclair de bouche : un disque lumineux à la bouche et une petite lumière, 0,045 s ; couleur du Pack-a-Punch ou du pistolet à rayons ; pas pour l'arbalète
## (cfg.flash == false) ; plus gros pour les armes lourdes (player.js shoot : heavy = fusil à pompe, coup par coup, lance-grenades).
func _on_shot(_o: Vector3, _e: Vector3) -> void:
	_kick = 1.0
	var w: WeaponState = Game.arms.current
	if _flash == null or w.cfg.get("flash", true) == false:
		return
	var t := String(w.cfg["type"])
	var heavy := t == "shotgun" or t == "semi" or t == "launcher"
	var color := Color("66ff88") if w.id == "raygun" else (Config.color(int(Pap.level(w.pap)["flash"])) if w.pap > 0 and Pap.level(w.pap) != null else Color("ffcc66"))
	(_flash.material_override as StandardMaterial3D).albedo_color = color
	var sc := 1.4 if heavy else 0.8 + randf() * 0.5
	_flash.scale = Vector3(sc, sc, sc)
	_flash.rotation.z = randf() * PI
	_flash.visible = true
	_flash_light.light_energy = (40.0 if heavy else 25.0) / PI * 0.45   # Three.js : candelas / pi ; atténuée : la vue est déjà éclairée par le monde
	_flash_light.visible = true
	_flash_t = 0.045

## Bouche de l'arme dans le monde (même transformation que le modèle : pose de visée, recul, caméra interpolée) ; Vector3.INF sans arme.
func muzzle_world() -> Vector3:
	if _gun == null or not is_instance_valid(_gun) or not _gun.is_inside_tree() or _gun_id == "":
		return Vector3.INF
	return _gun.to_global(WeaponModels.muzzle(_gun_id))

## Départ du traçant : la bouche du modèle ; `fallback` si l'arme n'est pas montrée (vue externe d'un véhicule, Aube).
func tracer_start(fallback: Vector3) -> Vector3:
	if hide_gun:
		if avatar != null and avatar.visible:
			var am: Vector3 = avatar.muzzle_world()
			if am != Vector3.INF:
				return am
		return fallback
	var m := muzzle_world()
	return fallback if m == Vector3.INF else m

func _build_flash(parent: Node3D, muzzle: Vector3) -> void:
	if _flash_tex == null:
		_flash_tex = GradientTexture2D.new()
		_flash_tex.fill = GradientTexture2D.FILL_RADIAL
		_flash_tex.fill_from = Vector2(0.5, 0.5)
		_flash_tex.fill_to = Vector2(1.0, 0.5)
		var gr := Gradient.new()
		gr.set_color(0, Color(1, 1, 1, 1))
		gr.set_color(1, Color(1, 1, 1, 0))
		_flash_tex.gradient = gr
		_flash_tex.width = 64
		_flash_tex.height = 64
	_flash = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.34, 0.34)   # PlaneGeometry(0,34) du JS (disque doux à la place de l'étoile de fx.js)
	_flash.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_texture = _flash_tex
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.no_depth_test = true
	_flash.material_override = m
	_flash.position = muzzle + Vector3(0, 0.0, -0.04)
	_flash.visible = false
	parent.add_child(_flash)
	_flash_light = OmniLight3D.new()
	_flash_light.light_color = Color("ffaa44")
	_flash_light.omni_range = 8.0
	_flash_light.omni_attenuation = 2.0
	_flash_light.shadow_enabled = false
	_flash_light.position = muzzle + Vector3(0, 0.04, -0.1)
	_flash_light.visible = false
	parent.add_child(_flash_light)

func _build_gun() -> void:
	if _gun != null:
		_gun.queue_free()
	var w: WeaponState = Game.arms.current
	var lvl: Variant = Pap.level(w.pap)
	_gun = WeaponModels.build(w.id, Config.color(int(lvl["color"])) if lvl != null else null)   # table data/weapon_models.json
	_build_flash(_gun, WeaponModels.muzzle(w.id))
	_build_view_light(_gun)
	_hands = HandsRig.new()
	_hands.build(_gun, w.id)
	_cam.add_child(_gun)
	_gun_id = w.id
	_gun_pap = w.pap

## J15 : lumière de vue (couche des armes seulement : elle n'éclaire ni le monde ni les zombies) pour que le modèle reste lisible la nuit.
## Directionnelle (éclairage égal à toute distance, pas de tache près de la caméra), douce et chaude, sans reflet appuyé.
func _build_view_light(parent: Node3D) -> void:
	var l := DirectionalLight3D.new()
	l.light_cull_mask = WeaponModels.VIEW_LAYER
	l.light_color = Color(1.0, 0.95, 0.88)
	l.light_energy = VIEW_LIGHT
	l.shadow_enabled = false
	l.rotation = Vector3(deg_to_rad(-55.0), deg_to_rad(25.0), 0.0)
	parent.add_child(l)

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"arme", _pt)

func _melee_t(arms: WeaponArms) -> float:
	return dbg_melee_t if dbg_melee_t >= 0.0 else arms.melee_t

func _tick(dt: float) -> void:
	if Game.arms == null or _cam == null:
		return
	var arms: WeaponArms = Game.arms
	var w: WeaponState = arms.current
	if w.id != _gun_id or w.pap != _gun_pap or _gun == null or not is_instance_valid(_gun):
		_build_gun()
	_kick = maxf(0.0, _kick - dt * KICK_DECAY)
	if _flash_t > 0.0 and not hold_fx:
		_flash_t -= dt
		if _flash_t <= 0.0 and _flash != null:
			_flash.visible = false
			_flash_light.visible = false
	var pos := WeaponModels.hip(w.id).lerp(WeaponModels.ads(w.id), arms.aim)
	pos.z += _kick * 0.04
	var reload_dip := 0.0
	if w.reloading:
		var p := w.reload_t / float(w.cfg["reloadTime"])
		reload_dip = sin(clampf(p, 0.0, 1.0) * PI)
	var melee_dip := 0.0
	if _melee_t(arms) >= 0.0:
		melee_dip = sin(clampf(_melee_t(arms) / float(Config.at("knife.anim")), 0.0, 1.0) * PI) * float(Config.at("knife.dip"))
	_sprint_k = move_toward(_sprint_k, 1.0 if (Game.player.sprinting and arms.aim < 0.05 and not w.reloading) else 0.0, dt * SPRINT_EASE)
	_update_throw(arms, dt)
	var throw_dip := sin(clampf(_throw_t / THROW_TIME, 0.0, 1.0) * PI) * 0.12 if _throw_t >= 0.0 else 0.0
	pos += Vector3(0.07, -0.085, 0.02) * _sprint_k   # sprint : l'arme baissée sur le côté
	var lo := sin(PI * Game.player.vault_u())   # enjambement : arme baissée (player.js : vm.position.y -= 0.16 x lo ; rotation.x += 0.5 x lo)
	pos.y -= reload_dip * 0.18 + melee_dip + 0.16 * lo + throw_dip
	_gun.position = pos
	_gun.rotation = Vector3(_kick * 0.06 + reload_dip * 0.5 + 0.5 * lo + 0.22 * _sprint_k, 0.5 * _sprint_k, 0.12 * _sprint_k)
	if _hands != null:
		var rp := -1.0
		if w.reloading:
			rp = clampf(w.reload_t / float(w.cfg["reloadTime"]), 0.0, 1.0)
		_hands.update(_gun.transform, rp, _melee_t(arms) >= 0.0)
	_gun.visible = not hide_gun and not (w.cfg.has("adsFov") and arms.aim > 0.8)
	_update_knife(arms)
	posed.emit()
	_sync_projectiles(arms.blast.shells, _shells, 0.04, _shell_mat)
	_sync_projectiles(arms.blast.nades, _nades, 0.06, _nade_mat)
	for i in range(_booms.size() - 1, -1, -1):
		_booms[i][1] -= dt
		var k: float = 1.0 - _booms[i][1] / EXPLOSION_TIME
		var m: MeshInstance3D = _booms[i][0]
		if k >= 1.0:
			m.queue_free()
			_booms.remove_at(i)
			continue
		var s: float = _booms[i][2] * (0.35 + 0.65 * k)
		m.scale = Vector3(s, s, s)
		(m.material_override as StandardMaterial3D).albedo_color.a = 0.7 * (1.0 - k)

## Grenade à main : à chaque grenade nouvellement lancée (la simulation l'a déjà jetée), la main tend la grenade vers l'avant, la lâche, puis se retire ; l'arme se baisse.
func _update_throw(arms: WeaponArms, dt: float) -> void:
	var n: int = arms.blast.nades.size()
	if n > _nades_prev:
		_throw_t = 0.0
	_nades_prev = n
	if _throw_t < 0.0 or hide_gun:
		_set_throw_visible(false)
		return
	_throw_t += dt
	if _throw_t >= THROW_TIME:
		_throw_t = -1.0
		_set_throw_visible(false)
		return
	var t := _throw_t
	var p := Vector3(0.30, -0.42, -0.22).lerp(Vector3(0.17, -0.14, -0.5), smoothstep(0.0, 0.10, t)) if t < 0.10 else Vector3(0.17, -0.14, -0.5).lerp(Vector3(0.34, -0.52, -0.15), smoothstep(0.10, THROW_TIME, t))
	_throw.position = p
	_throw.rotation = Vector3(-0.25 * (1.0 - smoothstep(0.0, 0.2, t)), 0.0, 0.0)
	_throw_nade.visible = t < 0.10
	_set_throw_visible(true)
	HandsRig.place_sleeve(_throw_sleeve[0], _throw_sleeve[1], p + _throw.basis * Vector3(0.0, 0.03, 0.075), HandsRig.SHOULDER_R)

func _set_throw_visible(on: bool) -> void:
	_throw.visible = on
	for n in _throw_sleeve:
		n.visible = on

func _update_knife(arms: WeaponArms) -> void:
	var on := _melee_t(arms) >= 0.0 and not hide_gun   # (à la 3e personne le personnage porte le couteau : PlayerAvatar)
	var axe := arms.has_axe
	_knife.visible = on and not axe
	_axe.visible = on and axe
	if not on:
		return
	var K: Dictionary = Config.at("knife")
	var holder: Node3D = _axe if axe else _knife
	holder.transform = MeleeModels.pose(axe, _melee_t(arms), float(K["hitDelay"]), float(K["anim"]))   # l'impact visuel est à hitDelay : l'instant des dégâts de la sim
	var sl: Array = _axe_sleeve if axe else _knife_sleeve
	HandsRig.place_sleeve(sl[0], sl[1], Vector3(0.0, 0.03, 0.07), holder.transform.affine_inverse() * HandsRig.SHOULDER_R)

func _sync_projectiles(src: Array, views: Array, radius: float, mat: Material) -> void:
	while views.size() < src.size():
		var m := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = radius
		sm.height = radius * 2.0
		m.mesh = sm
		m.material_override = mat
		add_child(m)
		views.append(m)
	while views.size() > src.size():
		views.pop_back().queue_free()
	for i in src.size():
		views[i].global_position = src[i]["pos"]

func _on_explosion(pos: Vector3, radius: float, color: int) -> void:
	var m := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 1.0
	sm.height = 2.0
	m.mesh = sm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Config.color(color)
	mat.albedo_color.a = 0.7
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.material_override = mat
	add_child(m)
	m.global_position = pos
	_booms.append([m, EXPLOSION_TIME, radius])
