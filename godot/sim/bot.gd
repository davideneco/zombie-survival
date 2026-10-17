class_name Bot
extends RefCounted
## Pilote automatique pour les tests et la démonstration visuelle (--bot) : vise le zombie visible le plus proche (centre du buste)
## et tire par clics espacés ; ne bouge pas. Utilise l'état de Game comme un joueur le verrait (ligne de tir dégagée par Collision.ray_hit).

const AIM_HEIGHT := 1.4      ## hauteur visée sur le zombie (m)
const CLICK_PERIOD := 0.2    ## un clic toutes les 0,2 s (5,5 tirs/s au plus pour le M1911)

static func think(g: Node) -> Dictionary:
	var p: PlayerSim = g.player
	var eye := p.eye()
	var best: ZombieSim = null
	var best_d := INF
	for z: ZombieSim in g.zombies:
		if z.dead:
			continue
		var to := z.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		var l := to.length()
		var d := to / l
		if g.collision.ray_hit(eye.x, eye.y, eye.z, d.x, d.y, d.z, l) < l - 0.01:
			continue   # un obstacle masque le zombie
		if l < best_d:
			best_d = l
			best = z
	var input := {}
	if best != null:
		var d := best.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		p.yaw = atan2(-d.x, -d.z)
		p.pitch = atan2(d.y, sqrt(d.x * d.x + d.z * d.z))
		input["fire"] = fmod(g.time, CLICK_PERIOD) < CLICK_PERIOD / 2.0
	if g.weapon.ammo == 0 and g.weapon.reserve > 0:
		input["reload"] = true
	return input
