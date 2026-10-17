class_name ZombiePose
extends RefCounted
## Poses articulées des zombies (port de Zombie._pose et Zombie._poseCrawl de src/zombie.js) : des angles (rad) et une hauteur de hanches
## calculés à partir de la phase de marche. Pur : la vue (scenes/zombie_view.gd) pose ces valeurs sur ses articulations.
## Jambes et bras : indice 0 = côté -1 (gauche du modèle), 1 = côté +1.

var hip_x := [0.0, 0.0]
var knee_x := [0.0, 0.0]
var shoulder_x := [0.0, 0.0]
var shoulder_z := [0.0, 0.0]
var elbow_x := [0.0, 0.0]
var spine_x := 0.0
var spine_z := 0.0
var hips_y := 0.95
var head_x := 0.0
var head_y := 0.0
var head_z := 0.0
var jaw_x := 0.0

const SIDES := [-1.0, 1.0]

## walk : phase de marche ; amp : amplitude des jambes ; reach : bras tendus (0 ballants, 1,5 en attaque) ; lean : inclinaison du buste ; nod : tête.
func walking(walk: float, amp: float, reach: float, lean: float, nod: float, limp: bool) -> void:
	var s := sin(walk)
	var c := cos(walk)
	for i in 2:
		var ph := 1.0 if i == 0 else -1.0
		var a := amp
		var drag := 0.0
		if limp and i == 0:
			a *= 0.45
			drag = 0.25
		hip_x[i] = -s * ph * 0.55 * a + drag * 0.5
		var fwd := maxf(0.0, c * ph)
		knee_x[i] = 0.1 + fwd * 0.85 * a + drag
		var sway := sin(walk * 0.5 + i * 1.7) * 0.12
		shoulder_x[i] = -0.25 - reach * 1.25 + sway
		shoulder_z[i] = SIDES[i] * (0.12 - reach * 0.06)
		elbow_x[i] = -0.35 - reach * 0.55 + sin(walk * 0.7 + ph) * 0.08
	spine_x = lean + sin(walk * 2.0) * 0.03
	spine_z = sin(walk) * (0.12 if limp else 0.05)
	hips_y = 0.95 - absf(sin(walk)) * 0.025 * amp - (0.04 if limp else 0.0)
	head_x = nod
	head_z = sin(walk * 0.8) * 0.16
	head_y = cos(walk * 0.4) * 0.14
	jaw_x = 0.22 + (sin(walk * 1.3) * 0.5 + 0.5) * 0.28

## Rampant : jambes arrachées, il se traîne sur les bras.
func crawling(walk: float, attacking: bool) -> void:
	var s := sin(walk)
	hips_y = 0.2 + absf(s) * 0.04
	spine_x = 1.42 + s * 0.04
	spine_z = s * 0.1
	head_x = -0.9 if attacking else -1.15
	head_z = sin(walk * 0.8) * 0.15
	head_y = cos(walk * 0.4) * 0.14
	jaw_x = 0.22 + (sin(walk * 1.3) * 0.5 + 0.5) * 0.28
	for i in 2:
		var ph := 0.0 if i == 0 else PI
		var pull := sin(walk + ph)
		shoulder_x[i] = (-2.5 if attacking else -2.15) + pull * 0.55
		shoulder_z[i] = SIDES[i] * 0.25
		elbow_x[i] = -0.25 - maxf(0.0, -pull) * 0.7

## Pose d'un zombie vivant d'après son état de simulation.
func of(z: ZombieSim) -> void:
	if z.crawler:
		crawling(z.walk_t, z.attacking)
	else:
		walking(z.walk_t, z.pose_amp, z.pose_reach, z.pose_lean, z.pose_nod, z.limp)
