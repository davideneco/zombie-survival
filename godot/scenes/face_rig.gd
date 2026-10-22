class_name FaceRig
extends SkeletonModifier3D
## v0.31.0 : vie du visage des personnages jouables, après l'animation (les clips ne touchent ni aux yeux ni aux paupières) : clignement des paupières
## supérieures (os Lid.L / Lid.R, toutes les 2 à 6 s, parfois double), petits mouvements des yeux (os Eye.L / Eye.R : saccades, ou regard vers une cible),
## et une respiration très légère portée par le torse (en plus de celle du clip Idle). Purement visuel ; coût : quatre os par image.
## `look_at_world` : point regardé (menu : la caméra) ; sinon les yeux suivent la tête avec de petites saccades.

const BLINK_T := 0.16             ## durée d'un clignement (s)
const LID_CLOSE := 0.74           ## rad : rotation de la paupière fermée

var look_at_world := Vector3.INF
var blink_k := 0.0                ## 0 ouvert .. 1 fermé (lu par les tests)
var enabled_blink := true
var applied_lid := 0.0            ## rad : dernière rotation donnée aux paupières (tests)
var applied_gaze := Vector3.ZERO  ## direction du regard de l'oeil gauche, repère du squelette (tests)

var _ready_bones := false
var _lid := [-1, -1]
var _eye := [-1, -1]
var _next := 1.5
var _t := 0.0
var _phase := -1.0
var _double := false
var _sacc := Vector2.ZERO
var _sacc_goal := Vector2.ZERO
var _sacc_next := 0.8
var _rng := RandomNumberGenerator.new()

func _init() -> void:
	_rng.seed = 1234

func _bones(sk: Skeleton3D) -> void:
	_ready_bones = true
	_lid = [sk.find_bone("Lid.L"), sk.find_bone("Lid.R")]
	_eye = [sk.find_bone("Eye.L"), sk.find_bone("Eye.R")]

## Ferme les yeux à t (0..1) : tests et captures.
func force_blink(k: float) -> void:
	enabled_blink = false
	blink_k = k

func _process_modification_with_delta(dt: float) -> void:
	var sk := get_skeleton()
	if sk == null:
		return
	if not _ready_bones:
		_bones(sk)
	if _lid[0] < 0:
		return
	_t += dt
	if enabled_blink:
		if _phase < 0.0 and _t >= _next:
			_phase = 0.0
		if _phase >= 0.0:
			_phase += dt / BLINK_T
			blink_k = sin(clampf(_phase, 0.0, 1.0) * PI)
			if _phase >= 1.0:
				_phase = -1.0
				blink_k = 0.0
				if not _double and _rng.randf() < 0.18:
					_double = true
					_next = _t + 0.12
				else:
					_double = false
					_next = _t + _rng.randf_range(2.0, 6.0)
	# saccades (petits sauts du regard), ou regard vers une cible
	_sacc_next -= dt
	if _sacc_next <= 0.0:
		_sacc_next = _rng.randf_range(0.6, 2.4)
		_sacc_goal = Vector2(_rng.randf_range(-0.12, 0.12), _rng.randf_range(-0.06, 0.05))
	_sacc = _sacc.lerp(_sacc_goal, 1.0 - exp(-dt * 30.0))
	for i in 2:
		if _lid[i] >= 0:
			# la paupière descend (rotation autour de son axe X local) ; le regard vers le bas la baisse un peu aussi
			var a := -(LID_CLOSE * blink_k + maxf(0.0, -_sacc.y) * 0.5)
			sk.set_bone_pose_rotation(_lid[i], sk.get_bone_rest(_lid[i]).basis.get_rotation_quaternion() * Quaternion(Vector3.RIGHT, a))
			applied_lid = a
		if _eye[i] >= 0:
			# direction du regard dans le repère de repos de l'os (Y : devant, Z : haut)
			var dir := Vector3(_sacc.x, 1.0, _sacc.y)
			if look_at_world != Vector3.INF:
				var par := sk.get_bone_parent(_eye[i])
				var rest_g := sk.get_bone_global_pose(par) * sk.get_bone_rest(_eye[i])
				var tgt := sk.global_transform.affine_inverse() * look_at_world
				dir = rest_g.basis.inverse() * (tgt - rest_g.origin)
				dir = Vector3(clampf(dir.x / maxf(dir.y, 0.05), -0.5, 0.5) + _sacc.x * 0.2, 1.0, clampf(dir.z / maxf(dir.y, 0.05), -0.35, 0.35) + _sacc.y * 0.2)
			var q := sk.get_bone_rest(_eye[i]).basis.get_rotation_quaternion() * Quaternion(Vector3.UP, dir.normalized())
			sk.set_bone_pose_rotation(_eye[i], q)
			if i == 0:
				var par_g := sk.get_bone_global_pose(sk.get_bone_parent(_eye[i]))
				applied_gaze = (par_g.basis * Basis(q) * Vector3.UP).normalized()
