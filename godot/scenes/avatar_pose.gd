class_name AvatarPose
extends SkeletonModifier3D
## v0.25.1 : posture armée du personnage à la 3e personne. Les animations du modèle (Idle, Walk, Run, Jump) ne donnent que les jambes et le balancement ; ce modificateur de
## squelette, exécuté APRÈS l'animation, tourne le buste vers la visée (torsion + tangage répartis sur l'abdomen et le torse), pose l'arme tenue à l'épaule et amène les deux mains
## sur ses prises par une cinématique inverse à deux os (épaule -> coude -> poignet, coude vers le bas et l'extérieur). Les positions des mains viennent de data/weapon_models.json
## (clé "hands" : celles de la vue à la première personne) ; le rechargement envoie la main avant au chargeur (HandsRig.reload_offset) ; le coup de couteau balaie la main droite.
## Repère : celui du modèle (pieds à y = 0, face vers +Z, la gauche du personnage est +X). Purement visuel.

const HandsRig := preload("res://scenes/hands_rig.gd")

var posed := false             ## posture armée (sinon : animation seule)
var twist := 0.0                ## rad : visée - cap du corps (positif : la visée est à gauche du corps)
var aim_pitch := 0.0            ## rad, positif : la visée monte
var sprint_k := 0.0             ## 0..1 : arme baissée en courant
var ads_k := 0.0                ## 0..1 : visée à la mire (arme remontée contre l'épaule)
var reload_p := -1.0            ## avancement du rechargement (0..1), -1 : aucun
var melee_u := -1.0             ## avancement du coup de couteau (0..1), -1 : aucun
var hands: Dictionary = {}      ## WeaponModels.hands(arme) ; vide : arme tenue à une main (rayons, arbalète : voir PlayerAvatar)
var gun: Node3D                 ## l'arme (enfant du modèle) : placée ici, dans le repère du modèle
var knife: Node3D               ## couteau / hache tenus par la main droite pendant le coup
var wrist_r := Vector3.ZERO     ## poignet droit atteint par la cinématique inverse (repère du modèle ; tests)
var gun_xf := Transform3D.IDENTITY   ## pose de l'arme dans le repère du modèle (lue par PlayerAvatar : bouche, éclair)

var _ready_bones := false
var _b: Dictionary = {}
var _scale := 1.0               ## taille du personnage / taille de référence (1,75 m)
var _l_up := 0.285              ## longueur du bras
var _l_fore := 0.265            ## longueur de l'avant-bras jusqu'au poignet (le bout de l'os)

const GUN_SCALE := 1.18         ## l'arme est un peu agrandie : à 2,7 m de la caméra, un fusil à taille réelle se lit mal
const SPINE_PITCH := 0.7        ## part du tangage de la visée portée par le buste (le reste : la tête)
const GRIP_ORIGIN := Vector3(-0.10, -0.15, 0.22)   ## prise arrière de l'arme par rapport au milieu des épaules, dans le repère de la visée (x : +gauche du personnage)

func _bones(sk: Skeleton3D) -> void:
	_ready_bones = true
	for n: String in ["Hips", "Abdomen", "Torso", "Head", "UpperArm.L", "LowerArm.L", "UpperArm.R", "LowerArm.R"]:
		_b[n] = sk.find_bone(n)
	var hip := sk.get_bone_global_rest(int(_b["Hips"])).origin.y
	_scale = hip / 0.92
	_l_up = sk.get_bone_global_rest(int(_b["UpperArm.R"])).origin.distance_to(sk.get_bone_global_rest(int(_b["LowerArm.R"])).origin)
	_l_fore = 0.26 * _scale

func _process_modification_with_delta(_dt: float) -> void:
	var sk := get_skeleton()
	if sk == null or not posed:
		return
	if not _ready_bones:
		_bones(sk)
	# 1. buste : torsion et tangage vers la visée
	var pitch_body := aim_pitch * SPINE_PITCH * (1.0 - sprint_k)
	_rotate_bone(sk, int(_b["Abdomen"]), Basis(Vector3.UP, twist * 0.45) * Basis(Vector3.RIGHT, -pitch_body * 0.5))
	_rotate_bone(sk, int(_b["Torso"]), Basis(Vector3.UP, twist * 0.55) * Basis(Vector3.RIGHT, -pitch_body * 0.5))
	_rotate_bone(sk, int(_b["Head"]), Basis(Vector3.RIGHT, -(aim_pitch - pitch_body) * 0.9))
	# 2. pose de l'arme
	var s_l := sk.get_bone_global_pose(int(_b["UpperArm.L"])).origin
	var s_r := sk.get_bone_global_pose(int(_b["UpperArm.R"])).origin
	var c := (s_l + s_r) * 0.5
	var pitch_gun := lerpf(aim_pitch, -0.75, sprint_k)
	if reload_p >= 0.0:
		pitch_gun -= 0.35 * sin(clampf(reload_p, 0.0, 1.0) * PI)
	var r := Basis(Vector3.UP, twist) * Basis(Vector3.RIGHT, -pitch_gun)
	var off := GRIP_ORIGIN * _scale
	off += Vector3(0.03, 0.05, -0.05) * ads_k * _scale   # visée : l'arme monte contre l'épaule, la crosse plus près
	off += Vector3(-0.04, -0.10, 0.02) * sprint_k * _scale
	var w := (r * Basis(Vector3.UP, PI)).scaled(Vector3.ONE * GUN_SCALE)
	gun_xf = Transform3D(w, c + r * off)
	if melee_u >= 0.0:
		_melee(sk, c, s_l, s_r)
		return
	if gun != null:
		gun.transform = gun_xf
	if knife != null:
		knife.visible = false
	if hands.is_empty():
		# arme sans positions de mains : main droite sur la crosse, main gauche à l'avant
		_arm(sk, true, gun_xf * Vector3(0.0, -0.06, 0.0), s_r, Vector3(-0.5, -1.0, -0.3))
		_arm(sk, false, gun_xf * Vector3(0.0, -0.03, -0.30), s_l, Vector3(0.5, -1.0, -0.3))
		return
	var rear := _v(hands["rear"]["pos"])
	var front := _v(hands["front"]["pos"])
	var fr := float(hands["front"]["r"])
	front += HandsRig.reload_offset(reload_p, front, _v(hands["mag"]), String(hands["style"]))
	var wrist_r := Vector3(0.034, -0.016, 0.066)
	var wrist_l := Vector3(-0.012, -(fr + 0.024), 0.082)
	_arm(sk, true, gun_xf * (rear + wrist_r), s_r, Vector3(-0.55, -1.0, -0.35))
	_arm(sk, false, gun_xf * (front + wrist_l), s_l, Vector3(0.55, -1.0, -0.35))

## Coup de couteau : la main droite balaie un arc devant le buste, le couteau dans le poing ; la main gauche reste au flanc ; l'arme est rengainée (cachée).
func _melee(sk: Skeleton3D, c: Vector3, s_l: Vector3, s_r: Vector3) -> void:
	if gun != null:
		gun.visible = false
	var u := clampf(melee_u, 0.0, 1.0)
	var r := Basis(Vector3.UP, twist) * Basis(Vector3.RIGHT, -aim_pitch)
	var hand := c + r * (Vector3(lerpf(-0.30, 0.18, u), lerpf(0.12, -0.38, u), 0.20 + 0.30 * sin(u * PI)) * _scale)
	var ang := lerpf(deg_to_rad(65.0), deg_to_rad(-70.0), smoothstep(0.0, 1.0, u))
	if knife != null:
		knife.visible = true
		knife.transform = Transform3D(r * Basis(Vector3.UP, PI) * Basis(Vector3.RIGHT, ang), hand)
	_arm(sk, true, hand, s_r, Vector3(-0.6, -1.0, -0.2))
	_arm(sk, false, c + r * (Vector3(0.28, -0.42, 0.05) * _scale), s_l, Vector3(0.6, -1.0, -0.1))

static func _v(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

## Tourne un os autour de sa propre origine : rot est exprimé dans le repère du modèle (appliqué à la pose globale courante).
func _rotate_bone(sk: Skeleton3D, i: int, rot: Basis) -> void:
	var g := sk.get_bone_global_pose(i)
	g.basis = rot * g.basis
	sk.set_bone_global_pose(i, g)

## Bras à deux os : l'épaule est celle de l'os du haut du bras (sa pose courante), le poignet vise `target`, le coude va du côté de `pole` (dans le repère du modèle).
func _arm(sk: Skeleton3D, right: bool, target: Vector3, shoulder: Vector3, pole: Vector3) -> void:
	var up_i := int(_b["UpperArm.R" if right else "UpperArm.L"])
	var lo_i := int(_b["LowerArm.R" if right else "LowerArm.L"])
	var l1 := _l_up
	var l2 := _l_fore
	var d := target - shoulder
	var dist := clampf(d.length(), 0.08, (l1 + l2) * 0.995)
	var dir := d.normalized() if d.length() > 1e-5 else Vector3.FORWARD
	var a := (l1 * l1 - l2 * l2 + dist * dist) / (2.0 * dist)
	var h := sqrt(maxf(l1 * l1 - a * a, 0.0))
	var perp := pole - dir * pole.dot(dir)
	perp = perp.normalized() if perp.length() > 1e-4 else Vector3.DOWN
	var elbow := shoulder + dir * a + perp * h
	_aim_bone(sk, up_i, (elbow - shoulder).normalized())
	var lo := sk.get_bone_global_pose(lo_i)
	_aim_bone(sk, lo_i, (shoulder + dir * dist - lo.origin).normalized())
	if right:
		var done := sk.get_bone_global_pose(lo_i)
		wrist_r = done.origin + done.basis.y.normalized() * l2

## Fait pointer l'axe Y de l'os (le sens de l'os) vers `want` en tournant sa pose globale par le plus court chemin.
func _aim_bone(sk: Skeleton3D, i: int, want: Vector3) -> void:
	var g := sk.get_bone_global_pose(i)
	var cur := g.basis.y.normalized()
	if cur.dot(want) > 0.99999:
		return
	var q := Quaternion(cur, want)
	g.basis = Basis(q) * g.basis
	sk.set_bone_global_pose(i, g)
