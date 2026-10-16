class_name PlayerSim
extends RefCounted
## Corps du joueur (port de la partie déplacement / santé de src/player.js). Pas de CharacterBody3D : mouvement et collisions maison
## (Collision.resolve). Sol à y = 0 (l'arène n'a pas d'étage). yaw et pitch sont posés par la visée (hors du pas fixe).

var pos := Vector3.ZERO
var vel := Vector3.ZERO      ## vitesse horizontale (x, z) ; vel.y inutilisé
var vy := 0.0
var yaw := 0.0               ## 0 = regarde vers -Z ; même convention que three.js
var pitch := 0.0
var health := 100.0
var max_health := 100.0
var last_hurt := -1000.0
var on_ground := true
var dead := false
var sprinting := false
var moving := false

func _init() -> void:
	max_health = float(Config.at("player.maxHealth"))
	health = max_health

func reset(start: Vector3) -> void:
	pos = start
	vel = Vector3.ZERO
	vy = 0.0
	yaw = 0.0
	pitch = 0.0
	health = max_health
	last_hurt = -1000.0
	dead = false

func eye() -> Vector3:
	return pos + Vector3(0, float(Config.at("player.eye")), 0)

## Direction de visée (unitaire) pour yaw et pitch courants.
func forward() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))

## input : { mx: -1..1 (droite +), mz: -1..1 (avant +), sprint: bool, jump: bool }
func step(dt: float, time: float, input: Dictionary, col: Collision) -> void:
	if dead:
		return
	var mx: float = input.get("mx", 0.0)
	var mz: float = input.get("mz", 0.0)
	moving = mx != 0.0 or mz != 0.0
	sprinting = bool(input.get("sprint", false)) and mz > 0.0
	var speed: float = float(Config.at("player.sprintSpeed")) if sprinting else float(Config.at("player.walkSpeed"))
	if moving:
		var l := sqrt(mx * mx + mz * mz)
		mx /= l
		mz /= l
	var s := sin(yaw)
	var c := cos(yaw)
	var wx := (c * mx - s * mz) * speed
	var wz := (-s * mx - c * mz) * speed
	var k := minf(1.0, dt * Rules.MOVE_ACCEL)
	vel.x += (wx - vel.x) * k
	vel.z += (wz - vel.z) * k
	pos.x += vel.x * dt
	pos.z += vel.z * dt
	# saut et gravité (sol à y = 0)
	on_ground = pos.y <= Rules.SPAWN_ON_GROUND_EPS and vy <= 0.5
	if bool(input.get("jump", false)) and on_ground:
		vy = float(Config.at("player.jumpSpeed"))
	vy -= float(Config.at("player.gravity")) * dt
	pos.y += vy * dt
	if pos.y <= 0.0:
		pos.y = 0.0
		vy = 0.0
	pos = col.resolve(pos, float(Config.at("player.radius")))
	# régénération
	if health < max_health and time - last_hurt > float(Config.at("player.regenDelay")):
		health = minf(max_health, health + float(Config.at("player.regenRate")) * dt)

## Renvoie true si ce coup tue le joueur.
func hurt(amount: float, time: float) -> bool:
	if dead:
		return false
	health -= amount
	last_hurt = time
	if health <= 0.0:
		health = 0.0
		dead = true
		return true
	return false
