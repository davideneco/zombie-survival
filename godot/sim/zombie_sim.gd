class_name ZombieSim
extends RefCounted
## Zombie simple de J1 : fonce tout droit vers le joueur (pas de champ de flux avant J4), se repousse des autres, attaque au corps à corps.
## Port réduit de src/zombie.js (déplacement, orientation lissée, attaque en deux temps).

var id := 0
var pos := Vector3.ZERO
var yaw := 0.0          ## convention three.js : le modèle regarde vers +Z à yaw = 0
var health := 70.0
var max_health := 70.0
var speed := 2.0
var runner := false
var dead := false
var death_t := 0.0
var headless := false
var attack_cd := Rules.ZOMBIE_FIRST_ATTACK_CD
var attack_windup := -1.0
var walk_t := 0.0
var moving := false
var rng: RandomNumberGenerator   ## posé par Game (graine de la partie)
var stuck_t := 0.0
var sidestep_t := 0.0
var sidestep_dir := 1.0

## Applique des dégâts ; renvoie true si le zombie meurt de ce coup.
func damage(amount: float, head: bool) -> bool:
	if dead:
		return false
	health -= amount
	if health <= 0.0:
		dead = true
		death_t = 0.0
		headless = head
		return true
	return false

## Avance d'un pas. Renvoie les dégâts infligés au joueur ce pas (0 si aucun).
func step(dt: float, target: Vector3, others: Array, col: Collision) -> float:
	if dead:
		death_t += dt
		return 0.0
	var Z: Dictionary = Config.at("zombie")
	var dx := target.x - pos.x
	var dz := target.z - pos.z
	var dist := sqrt(dx * dx + dz * dz)
	var inv := 1.0 / (dist if dist > 0.0 else 1.0)
	var dirx := dx * inv
	var dirz := dz * inv
	# orientation lissée
	var target_yaw := atan2(dirx, dirz)
	var diff := target_yaw - yaw
	diff = atan2(sin(diff), cos(diff))
	yaw += diff * minf(1.0, dt * Rules.ZOMBIE_TURN_RATE)
	attack_cd -= dt
	var in_range := dist < float(Z["attackRange"]) and absf(target.y - pos.y) < 2.4
	moving = false
	if not in_range and attack_windup < 0.0:
		moving = true
		if sidestep_t > 0.0:   # coincé contre un obstacle : pas de côté (sans champ de flux, c'est tout ce qu'il sait faire)
			sidestep_t -= dt
			var a := sidestep_dir * Rules.ZOMBIE_SIDESTEP_ANGLE
			var ca := cos(a)
			var sa := sin(a)
			var nx := dirx * ca - dirz * sa
			dirz = dirx * sa + dirz * ca
			dirx = nx
		var bx := pos.x
		var bz := pos.z
		pos.x += dirx * speed * dt
		pos.z += dirz * speed * dt
		for o: ZombieSim in others:
			if o == self or o.dead:
				continue
			var ox := pos.x - o.pos.x
			var oz := pos.z - o.pos.z
			var d := sqrt(ox * ox + oz * oz)
			if d > 0.0 and d < Rules.ZOMBIE_SEPARATION:
				var push := (Rules.ZOMBIE_SEPARATION - d) * 0.5
				pos.x += ox / d * push
				pos.z += oz / d * push
		pos = col.resolve(pos, float(Z["radius"]))
		var moved := sqrt((pos.x - bx) * (pos.x - bx) + (pos.z - bz) * (pos.z - bz))
		if moved < speed * dt * Rules.ZOMBIE_STUCK_RATIO:
			stuck_t += dt
			if stuck_t > Rules.ZOMBIE_STUCK_TIME and sidestep_t <= 0.0:
				sidestep_t = Rules.ZOMBIE_SIDESTEP_TIME
				sidestep_dir = -1.0 if (rng.randf() if rng != null else 0.0) < 0.5 else 1.0
				stuck_t = 0.0
		else:
			stuck_t = 0.0
		walk_t += dt * speed * (2.6 if runner else 3.2)
	elif in_range and attack_cd <= 0.0 and attack_windup < 0.0:
		attack_windup = Rules.ZOMBIE_ATTACK_WINDUP
	# attaque : le coup part à la fin de l'armement s'il touche encore
	var dealt := 0.0
	if attack_windup >= 0.0:
		attack_windup -= dt
		if attack_windup < 0.0:
			if dist < float(Z["attackRange"]) + 0.5 and absf(target.y - pos.y) < 2.6:
				dealt = float(Z["damage"])
			attack_cd = float(Z["attackCooldown"])
	return dealt
