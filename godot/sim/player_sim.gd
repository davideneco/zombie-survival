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
var tregion := 0             ## étage « utile » pour les zombies (un joueur sur un escalier compte pour l'extrémité la plus proche)
var region := 0              ## région d'étage sous les pieds (0 = sol de la ville), voir Levels
var attached := false         ## J5 : assis sur un véhicule ou debout dans la rame (Rides pose pos et yaw)
var eye_override := Vector3.INF   ## J5 : œil imposé (caméra externe d'un véhicule) ; INF : œil du joueur
var last_mouse := 0.0         ## temps de jeu du dernier mouvement de souris (recentrage de la vue du conducteur)
var _floor := {"y": 0.0, "region": 0}
var _was_grounded := true
# --- J6 : atouts et état « à terre » (player.js : perks, down, revive, onLand)
var downed := false           ## à terre : rampe (1,2 m/s), ne tire pas, les zombies l'ignorent
var bleedout := 0.0           ## secondes avant la mort à terre
var self_revive := 0.0        ## solo avec Réanimation rapide : secondes avant de se relever
var quick_revive := false     ## atout Réanimation rapide : tomber à 0 PV met à terre au lieu de tuer
var stamin := false           ## Stamin-Up : marche x1,1, sprint x1,3
var phd := false              ## PHD Flopper : onde explosive à l'atterrissage d'un saut en sprint ou d'une chute
var down_event := false       ## posés au pas où l'évènement a lieu, lus et effacés par Game
var revive_event := false
var flop_request := false
var flop_cd := 0.0
var air_t := 0.0
var peak_y := 0.0
var jump_sprint := false
var gust_q: Dictionary = {}    ## J10 : rafale de la rampe de la flèche : vitesse imposée { x, z, t }
var pull_q: Dictionary = {}    ## J10 : attiré par les Chaînes du Bourreau : déplacement imposé { x, z, t, T }

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
	region = 0
	tregion = 0
	_was_grounded = true
	attached = false
	eye_override = Vector3.INF
	max_health = float(Config.at("player.maxHealth"))
	health = max_health
	downed = false
	bleedout = 0.0
	self_revive = 0.0
	quick_revive = false
	stamin = false
	phd = false
	down_event = false
	revive_event = false
	flop_request = false
	flop_cd = 0.0
	air_t = 0.0
	peak_y = 0.0
	jump_sprint = false
	gust_q = {}
	pull_q = {}

func gust_by(vx: float, vz: float, dur: float) -> void:
	gust_q = {"x": vx, "z": vz, "t": dur}

func pull_by(dx: float, dz: float) -> void:
	pull_q = {"x": dx, "z": dz, "t": 0.3, "T": 0.3}
	vel.x *= 0.3
	vel.z *= 0.3

func eye() -> Vector3:
	if eye_override != Vector3.INF:
		return eye_override
	return pos + Vector3(0, float(Config.at("player.eye")), 0)

## Direction de visée (unitaire) pour yaw et pitch courants.
func forward() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))

## input : { mx: -1..1 (droite +), mz: -1..1 (avant +), sprint: bool, jump: bool }
func step(dt: float, time: float, input: Dictionary, col: Collision, levels: Levels = null) -> void:
	if dead:
		return
	flop_cd = maxf(0.0, flop_cd - dt)
	if downed:
		_down_step(dt, time)
		if dead:
			return
	if attached:   # sur un véhicule ou dans la rame : Rides déplace le joueur ; la santé se régénère quand même
		_regen(dt, time)
		return
	var mx: float = input.get("mx", 0.0)
	var mz: float = input.get("mz", 0.0)
	moving = mx != 0.0 or mz != 0.0
	sprinting = bool(input.get("sprint", false)) and mz > 0.0 and not downed
	var speed: float = float(Config.at("player.sprintSpeed")) * (Rules.PERK_STAMIN_SPRINT if stamin else 1.0) if sprinting else float(Config.at("player.walkSpeed")) * (Rules.PERK_STAMIN_WALK if stamin else 1.0)
	if downed:
		speed = Rules.DOWN_SPEED
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
	if not gust_q.is_empty():   # rafale : vitesse imposée pendant gust_q.t s (la collision, donc les garde-corps, la borne)
		pos.x += float(gust_q["x"]) * minf(dt, float(gust_q["t"]))
		pos.z += float(gust_q["z"]) * minf(dt, float(gust_q["t"]))
		gust_q["t"] = float(gust_q["t"]) - dt
		if float(gust_q["t"]) <= 0.0:
			gust_q = {}
	if not pull_q.is_empty():   # Chaînes : déplacement imposé sur pull_q.T s
		var kk := minf(dt, float(pull_q["t"])) / float(pull_q["T"])
		pos.x += float(pull_q["x"]) * kk
		pos.z += float(pull_q["z"]) * kk
		pull_q["t"] = float(pull_q["t"]) - dt
		if float(pull_q["t"]) <= 0.0:
			pull_q = {}
	# saut et gravité : le sol est celui de la ville (y = 0) ou un étage sous les pieds (player.js : floorAt)
	var ground := 0.0
	if levels != null:
		levels.floor_at(pos.x, pos.z, pos.y, _floor)
		ground = _floor["y"]
		region = _floor["region"]
	on_ground = pos.y <= ground + Rules.SPAWN_ON_GROUND_EPS and vy <= 0.5
	if bool(input.get("jump", false)) and on_ground and not downed:
		vy = float(Config.at("player.jumpSpeed"))
		jump_sprint = sprinting
	vy -= float(Config.at("player.gravity")) * dt
	pos.y += vy * dt
	if pos.y <= ground:
		pos.y = ground
		vy = 0.0
	elif _was_grounded and vy <= 0.0 and pos.y - ground < Rules.STICK_TO_SLOPE:
		pos.y = ground   # on colle à la pente en descendant
		vy = 0.0
	_was_grounded = pos.y <= ground + Rules.SPAWN_ON_GROUND_EPS
	# PHD Flopper : temps en l'air et hauteur de chute ; à l'atterrissage, onde explosive (player.js onLand)
	if not _was_grounded:
		air_t += dt
		peak_y = maxf(peak_y, pos.y)
	else:
		if air_t > 0.0:
			_on_land(air_t, peak_y - ground)
		air_t = 0.0
		peak_y = ground
		jump_sprint = false
	pos = col.resolve(pos, float(Config.at("player.radius")))
	_regen(dt, time)

func _regen(dt: float, time: float) -> void:
	if not downed and health < max_health and time - last_hurt > float(Config.at("player.regenDelay")):
		health = minf(max_health, health + float(Config.at("player.regenRate")) * dt)

## Renvoie true si ce coup tue le joueur.
func hurt(amount: float, time: float) -> bool:
	if dead:
		return false
	if downed:
		return false
	health -= amount
	last_hurt = time
	if health <= 0.0:
		health = 0.0
		if quick_revive:
			down()
			return false
		dead = true
		return true
	return false

## Atterrissage après `air` s en l'air et une chute de `drop` m (player.js onLand) : le saut est parti d'un sprint ou la chute dépasse fallHeight.
func _on_land(air: float, drop: float) -> void:
	var F: Dictionary = Config.at("phd")
	if not phd or attached or downed or dead or flop_cd > 0.0 or air < float(F["minAir"]):
		return
	if not jump_sprint and drop < float(F["fallHeight"]):
		return
	flop_cd = float(F["cooldown"])
	flop_request = true

## À terre (player.js down, solo avec Réanimation rapide) : se relève seul après DOWN_SELF_REVIVE s ; sinon saigne DOWN_BLEEDOUT s.
func down() -> void:
	downed = true
	bleedout = Rules.DOWN_BLEEDOUT
	health = 0.0
	self_revive = Rules.DOWN_SELF_REVIVE if quick_revive else 0.0
	down_event = true

func revive(time: float) -> void:
	downed = false
	dead = false
	self_revive = 0.0
	health = minf(Rules.DOWN_REVIVE_HEALTH, max_health)
	last_hurt = time
	revive_event = true

func _down_step(dt: float, time: float) -> void:
	if self_revive > 0.0:
		self_revive -= dt
		if self_revive <= 0.0:
			revive(time)
	else:
		bleedout = maxf(0.0, bleedout - dt)
		if bleedout <= 0.0:
			dead = true
