class_name RideCam
extends RefCounted
## Vue à la troisième personne sur une moto, un vélo ou dans la rame (port de src/rideCam.js, CONFIG.vehicles.cam). Une seule caméra : celle du joueur.
## Le pivot suit l'œil du pilote (+ 0,35 m ; épaule droite pour le passager), lissé ; la caméra recule sur un bras derrière le pivot, dans la direction
## de visée. Collision : trois rayons pivot -> caméra, on garde la médiane moins 0,3 m ; le sol borne sa hauteur. Transitions : montée 0,35 s,
## descente 0,25 s, visée du passager 0,15 s. Pur : la scène lit `placed`, `cam_pos` et `dist`. Écarts : pas de plafond (World n'a pas de ceiling_at),
## pas de personnage Avatar (un cavalier en primitives dans la vue).

var k := 0.0              ## 0 = première personne, 1 = bras tendu
var dist := 0.0           ## distance réelle caméra - pivot (m)
var cl := INF             ## longueur autorisée par les obstacles (lissée)
var arm_len := 0.0        ## longueur du bras de la dernière machine
var pivot := Vector3.ZERO
var has_pivot := false
var rate_up := 1.0
var was_veh := false
var was_want := false
var placed := false       ## la caméra a été posée ici (sinon vue à la première personne)
var cam_pos := Vector3.ZERO
var third_person := true  ## réglage tpVehicle (touche V)
## v0.25.1 : vue à la troisième personne À PIED (Options > « Vue », touche T). Même caméra que sur une machine : pivot à l'épaule droite du joueur, bras avec collision
## (trois rayons, médiane), sol, lissage. Le tir part du pivot, dans l'axe de la caméra : il passe donc par le réticule (le centre de l'écran).
const FOOT := {
	"arm": 2.7,           ## m : longueur du bras à la hanche
	"armAds": 1.5,        ## m : en visée, la caméra se rapproche
	"pivotUp": 0.10,      ## m au-dessus de l'oeil
	"pivotRight": 0.55,   ## m à droite : le personnage est à gauche du réticule
	"downArm": 0.55,      ## regard vers le bas : le bras raccourcit (jusqu'à -55 % à -1,2 rad) pour que la caméra ne passe pas au-dessus des toits
	"aimTime": 0.15,
}
var foot_third := false   ## réglage « Vue » : à pied, la caméra est à la troisième personne
var _aim_k := 0.0
var dbg_arm := 0.0        ## --tp-arm=M : longueur du bras imposée (captures de près)
var dbg_orbit := 0.0      ## --tp-orbit=DEG : la caméra tourne autour du personnage (captures de côté, de face) ; la visée n'est pas touchée
var _fl := {"y": 0.0, "region": 0}

func reset() -> void:
	k = 0.0
	dist = 0.0
	cl = INF
	has_pivot = false
	was_veh = false
	was_want = false
	placed = false

## le joueur regarde de l'extérieur (les tirs partent de plus loin que l'œil, l'arme de la vue est cachée)
func external() -> bool:
	return dist >= float(Config.at("vehicles.cam.viewmodelMax"))

func want_third(ride: Variant, aiming: bool) -> bool:
	if ride == null:
		return foot_third
	return third_person and not (not ride["v"].is_driver(ride["seat"]) and aiming)

static func _ease(t: float) -> float:
	return 1.0 - pow(1.0 - t, 3.0)

## Un pas. ride : { v, seat } ou null ; foot : œil à pied (sortie de moto) ; p : PlayerSim (yaw, pitch) ; g : hôte (collision, world).
func update(dt: float, ride: Variant, foot: Vector3, p: PlayerSim, aiming: bool, g: Object) -> bool:
	var C: Dictionary = Config.at("vehicles.cam")
	var want := want_third(ride, aiming)
	if ride != null and not was_veh:
		rate_up = 1.0 / float(C["mountTime"])
	elif ride != null and want and not was_want:
		rate_up = 1.0 / float(C["aimTime"])   # retour après la visée, ou touche V
	elif ride == null and want and not was_want:
		rate_up = 1.0 / float(C["mountTime"])   # vue à pied : même fondu que la montée
	was_veh = ride != null
	was_want = want
	if want:
		k = minf(1.0, k + dt * rate_up)
	else:
		k = maxf(0.0, k - dt / (float(C["aimTime"]) if ride != null else float(C["leaveTime"])))
	_aim_k = move_toward(_aim_k, 1.0 if aiming else 0.0, dt / float(FOOT["aimTime"]))
	if ride != null:
		arm_len = float(ride["v"].def["camArm"])
	elif foot_third:
		var target := lerpf(float(FOOT["arm"]), float(FOOT["armAds"]), _aim_k) * (1.0 - float(FOOT["downArm"]) * clampf(-p.pitch / 1.2, 0.0, 1.0))
		if dbg_arm > 0.0:
			target = dbg_arm
		arm_len = target if arm_len < 0.01 else move_toward(arm_len, target, 8.0 * dt)
	if k <= 0.0:
		dist = 0.0
		cl = INF
		has_pivot = false
		placed = false
		return false
	var arm := arm_len * _ease(k)
	var yaw := p.yaw + dbg_orbit
	var pitch := p.pitch
	var sy := sin(yaw)
	var cy := cos(yaw)
	var d := Vector3(-sy * cos(pitch), sin(pitch), -cy * cos(pitch))
	var t: Vector3
	if ride != null:
		var car: bool = ride["v"] is CarSim   # v0.36.0 : voiture : pivot au milieu du toit, quelle que soit la place
		t = ride["v"].cam_pivot(ride["seat"]) if car else ride["v"].eye_world(ride["seat"])
		t.y += float(C["pivotUp"])
		if not car and not ride["v"].is_driver(ride["seat"]):
			t.x += cy * float(C["pivotRight"])
			t.z -= sy * float(C["pivotRight"])   # passager : épaule droite
	elif foot_third:
		t = foot + Vector3(0.0, float(FOOT["pivotUp"]), 0.0)
		t.x += cy * float(FOOT["pivotRight"])
		t.z -= sy * float(FOOT["pivotRight"])   # épaule droite : le personnage est à gauche du réticule
	else:
		t = foot   # sortie de moto : le pivot rejoint l'œil du joueur à pied
	if not has_pivot:
		pivot = t
		has_pivot = true
	else:
		pivot = pivot.lerp(t, 1.0 - exp(-float(C["follow"]) * dt))
	var pv := pivot
	# collision : trois rayons parallèles pivot -> caméra (au centre, puis +- rayOffset), médiane
	var lim := arm_len
	var off_r := float(C["rayOffset"])
	var hits: Array = []
	for off in [0.0, off_r, -off_r]:
		hits.append(g.collision.ray_hit(pv.x + cy * off, pv.y, pv.z - sy * off, -d.x, -d.y, -d.z, arm_len))
	hits.sort()
	lim = arm_len if hits[1] >= arm_len else minf(arm_len, maxf(float(C["minArm"]), hits[1] - float(C["margin"])))
	if lim < cl:
		cl = lim   # proche d'un coup, loin à 4 m/s
	else:
		cl = minf(lim, cl + float(C["retreat"]) * dt)
	var dd := minf(arm, cl)
	dist = dd
	var x := pv.x - d.x * dd
	var z := pv.z - d.z * dd
	var y := pv.y - d.y * dd
	if g.world != null:
		g.world.floor_at(x, z, pv.y, _fl)
		y = maxf(y, float(_fl["y"]) + float(C["floorMargin"]))
	cam_pos = Vector3(x, y, z)
	placed = true
	return true

## Recentrage de la vue du conducteur derrière sa moto, et tangage borné en vue externe (RideCam.steer).
func steer(dt: float, ride: Dictionary, since_mouse: float, p: PlayerSim) -> void:
	var C: Dictionary = Config.at("vehicles.cam")
	if k < 0.5:
		return
	p.pitch = clampf(p.pitch, float(C["pitchMin"]), float(C["pitchMax"]))
	if ride["v"].is_driver(ride["seat"]) and since_mouse > float(C["recenterAfter"]):   # regard libre ; sans souris depuis 1,5 s : la vue revient derrière
		var seat_ry: float = float(ride["v"].model_seats[ride["seat"]].get("ry", 0.0))
		var dy: float = VehicleSim.ang_diff(ride["v"].seat_yaw(ride["seat"]) + seat_ry, p.yaw)
		p.yaw += signf(dy) * minf(absf(dy), float(C["recenterRate"]) * dt)
		var dp: float = float(C["recenterPitch"]) - p.pitch
		p.pitch += signf(dp) * minf(absf(dp), float(C["recenterRate"]) * 0.4 * dt)
