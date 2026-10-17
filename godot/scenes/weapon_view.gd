extends Node3D
## Présentation des armes (J4) : arme à la première personne (primitives, par catégorie et niveau du Pack-a-Punch : les viewmodels
## `.glb` viennent plus tard), obus et grenades en vol, flash des explosions, coup de couteau. Ne fait que lire Game.arms.

const EXPLOSION_TIME := 0.45
const KICK_DECAY := 9.0
const HIP_POS := Vector3(0.22, -0.2, -0.45)
const ADS_POS := Vector3(0.0, -0.12, -0.35)
## longueur (m) et épaisseur du corps de l'arme par catégorie
const BODY := {
	"pistol": Vector3(0.05, 0.09, 0.28), "ar": Vector3(0.06, 0.1, 0.62), "smg": Vector3(0.055, 0.1, 0.42), "mg": Vector3(0.08, 0.12, 0.78),
	"sniper": Vector3(0.06, 0.1, 0.95), "shotgun": Vector3(0.06, 0.09, 0.8), "special": Vector3(0.07, 0.11, 0.55),
}

var hide_gun := false           ## J5 : arme de la vue cachée (on conduit, ou la caméra regarde de l'extérieur d'un véhicule)
var _cam: Camera3D
var _gun: Node3D
var _gun_id := ""
var _gun_pap := -1
var _knife: MeshInstance3D
var _kick := 0.0
var _shells: Array[MeshInstance3D] = []
var _nades: Array[MeshInstance3D] = []
var _booms: Array = []          # [mesh, t]
var _shell_mat := StandardMaterial3D.new()
var _nade_mat := StandardMaterial3D.new()

func setup(cam: Camera3D) -> void:
	_cam = cam
	_shell_mat.albedo_color = Color("2f3b1f")
	_nade_mat.albedo_color = Color("2f3b1f")
	_knife = MeshInstance3D.new()
	var kb := BoxMesh.new()
	kb.size = Vector3(0.025, 0.02, 0.28)
	_knife.mesh = kb
	var km := StandardMaterial3D.new()
	km.albedo_color = Color("c8ccd0")
	km.metallic = 0.8
	km.roughness = 0.35
	_knife.material_override = km
	_knife.visible = false
	cam.add_child(_knife)
	Game.shot_fired.connect(func(_o: Vector3, _e: Vector3) -> void: _kick = 1.0)
	Game.explosion.connect(_on_explosion)

func _build_gun() -> void:
	if _gun != null:
		_gun.queue_free()
	var w: WeaponState = Game.arms.current
	var cat := String(w.cfg.get("cat", "pistol"))
	var size: Vector3 = BODY.get(cat, BODY["pistol"])
	_gun = Node3D.new()
	var body := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	body.mesh = bm
	body.position = Vector3(0, 0, -size.z / 2.0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("30343a")
	mat.metallic = 0.6
	mat.roughness = 0.45
	var lvl: Variant = Pap.level(w.pap)
	if lvl != null:   # reflet du Pack-a-Punch
		mat.emission_enabled = true
		mat.emission = Config.color(int(lvl["color"]))
		mat.emission_energy_multiplier = 0.35
	body.material_override = mat
	_gun.add_child(body)
	var grip := MeshInstance3D.new()
	var gm := BoxMesh.new()
	gm.size = Vector3(size.x * 0.9, size.y * 1.4, size.x * 1.4)
	grip.mesh = gm
	grip.position = Vector3(0, -size.y * 0.9, -size.z * 0.15)
	grip.material_override = mat
	_gun.add_child(grip)
	_cam.add_child(_gun)
	_gun_id = w.id
	_gun_pap = w.pap

func _process(dt: float) -> void:
	if Game.arms == null or _cam == null:
		return
	var arms: WeaponArms = Game.arms
	var w: WeaponState = arms.current
	if w.id != _gun_id or w.pap != _gun_pap or _gun == null or not is_instance_valid(_gun):
		_build_gun()
	_kick = maxf(0.0, _kick - dt * KICK_DECAY)
	var pos := HIP_POS.lerp(ADS_POS, arms.aim)
	pos.z += _kick * 0.04
	var reload_dip := 0.0
	if w.reloading:
		var p := w.reload_t / float(w.cfg["reloadTime"])
		reload_dip = sin(clampf(p, 0.0, 1.0) * PI)
	var melee_dip := 0.0
	if arms.melee_t >= 0.0:
		melee_dip = sin(clampf(arms.melee_t / float(Config.at("knife.anim")), 0.0, 1.0) * PI) * float(Config.at("knife.dip"))
	pos.y -= reload_dip * 0.18 + melee_dip
	_gun.position = pos
	_gun.rotation = Vector3(_kick * 0.06 + reload_dip * 0.5, 0, 0)
	_gun.visible = not hide_gun and not (w.cfg.has("adsFov") and arms.aim > 0.8)
	_update_knife(arms)
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

func _update_knife(arms: WeaponArms) -> void:
	var on := arms.melee_t >= 0.0
	_knife.visible = on
	if not on:
		return
	var K: Dictionary = Config.at("knife")
	var hit := float(K["hitDelay"])
	var t := arms.melee_t
	var s := clampf(t / hit, 0.0, 1.0) if t < hit else clampf(1.0 - (t - hit) / (float(K["anim"]) - hit), 0.0, 1.0)
	_knife.position = Vector3(lerpf(0.3, 0.02, s), lerpf(-0.25, -0.05, s), -0.5)
	_knife.rotation = Vector3(0.0, lerpf(0.5, 0.0, s), 0.0)

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
