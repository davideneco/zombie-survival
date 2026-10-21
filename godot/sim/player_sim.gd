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
var eye_override := Vector3.INF   ## J5 : œil imposé (caméra externe d'un véhicule, ou à pied à la troisième personne) ; INF : œil du joueur
var eye_ext := 0.0            ## v0.25.1 : distance caméra - pivot en vue externe : les tirs, le couteau et les grenades partent du pivot (`shot_eye`), pas de la caméra
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
# --- J11 : visée, enjambement, balancement de la vue (player.js : aiming, vault, bobT)
var aiming := false           ## visée maintenue (copie de input.aim) : marche x0,6 et pas de sprint
var locked := false           ## arme confisquée par le Pack-a-Punch (pas d'enjambement)
var vault: Dictionary = {}    ## enjambement en cours : { t, dur, x0, z0, x1, z1, y }
var vault_cd := 0.0
var vault_ready := false      ## un obstacle enjambable est devant (invite « Enjamber »)
var vault_event := false      ## posé au départ d'un enjambement (son), lu et effacé par Game
var bob_t := 0.0
var _vh: Dictionary = {}
var _vq := Vector3.ZERO
var _vfl := {"y": 0.0, "region": 0}

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
	aiming = false
	locked = false
	vault = {}
	vault_cd = 0.0
	vault_ready = false
	vault_event = false
	bob_t = 0.0

func gust_by(vx: float, vz: float, dur: float) -> void:
	gust_q = {"x": vx, "z": vz, "t": dur}

func pull_by(dx: float, dz: float) -> void:
	pull_q = {"x": dx, "z": dz, "t": 0.3, "T": 0.3}
	vel.x *= 0.3
	vel.z *= 0.3

func eye() -> Vector3:
	if eye_override != Vector3.INF:
		return eye_override
	return pos + Vector3(0, eye_height(), 0)

## Point de départ des tirs, du couteau et des grenades : l'œil, avancé dans l'axe de visée de la distance caméra - pivot (vue externe : le rayon part de la tête du joueur
## et suit exactement l'axe de la caméra, donc passe par le réticule).
func shot_eye() -> Vector3:
	return eye() + forward() * eye_ext

## Hauteur de l'œil au-dessus des pieds : 0,55 m à terre, élevée pendant l'enjambement (player.js : eyeH), sans le balancement de la marche.
func eye_height() -> float:
	var h := Rules.DOWN_EYE if downed else float(Config.at("player.eye"))
	if not vault.is_empty():
		h += float(Config.at("vault.camLift")) * sin(PI * minf(1.0, float(vault["t"]) / float(vault["dur"])))
	return h

## Avancement de l'enjambement 0..1 (0 : aucun), pour l'arme baissée de la vue.
func vault_u() -> float:
	return 0.0 if vault.is_empty() else minf(1.0, float(vault["t"]) / float(vault["dur"]))

## Balancement de la vue à la marche (player.js : bob), à ajouter à la hauteur de l'œil de la caméra.
func bob() -> float:
	return sin(bob_t) * (0.06 if sprinting else 0.035) if moving and on_ground and not attached else 0.0

## Direction de visée (unitaire) pour yaw et pitch courants.
func forward() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))

## input : { mx: -1..1 (droite +), mz: -1..1 (avant +), sprint: bool, jump: bool }
func step(dt: float, time: float, input: Dictionary, col: Collision, levels: Levels = null, world: World = null) -> void:
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
	if not vault.is_empty():
		mx = 0.0   # enjambement en cours : le chemin est imposé
		mz = 0.0
	aiming = bool(input.get("aim", false)) and not downed
	moving = mx != 0.0 or mz != 0.0
	sprinting = bool(input.get("sprint", false)) and mz > 0.0 and not downed and not aiming
	var speed: float = float(Config.at("player.sprintSpeed")) * (Rules.PERK_STAMIN_SPRINT if stamin else 1.0) if sprinting else float(Config.at("player.walkSpeed")) * (Rules.PERK_STAMIN_WALK if stamin else 1.0)
	if downed:
		speed = Rules.DOWN_SPEED
	elif aiming:
		speed *= Rules.AIM_SPEED_MULT
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
	vault_cd = maxf(0.0, vault_cd - dt)
	vault_ready = on_ground and vault.is_empty() and not downed and not dead and not locked and vault_cd <= 0.0 and not _check_vault(col, world, levels).is_empty()
	if bool(input.get("jump", false)) and on_ground and not downed and vault.is_empty():
		if vault_ready and _start_vault(col, world, levels):
			pass   # enjambement : pas de saut
		else:
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
	if not vault.is_empty():
		_step_vault(dt, col)   # chemin imposé : pas de collision (on passe par-dessus l'obstacle)
	else:
		pos = col.resolve(pos, float(Config.at("player.radius")))
	bob_t += dt * (12.0 if sprinting else 8.0) * (1.0 if moving and on_ground else 0.0)
	_regen(dt, time)

# ---------------------------------------------------------------- enjambement (player.js checkVault / startVault / stepVault)
## Obstacle enjambable devant : { lx, lz, h } ou {} (voir player.js : à moins de reach m, de face, profondeur <= maxDepth, case d'arrivée libre
## à la même hauteur dans une zone OUVERTE).
func _check_vault(col: Collision, world: World, levels: Levels) -> Dictionary:
	if col.vaults.is_empty():
		return {}
	var reach := float(Config.at("vault.reach"))
	var clearance := float(Config.at("vault.clearance"))
	var ux := -sin(yaw)
	var uz := -cos(yaw)
	var h := col.find_vault(pos.x, pos.z, ux, uz, reach)
	if h.is_empty():
		return {}
	if -(ux * float(h["nx"]) + uz * float(h["nz"])) < cos(deg_to_rad(float(Config.at("vault.maxAngle")))):
		return {}
	var t_in := float(h["tIn"])
	var t_out := float(h["tOut"])
	if t_out - t_in > float(Config.at("vault.maxDepth")):
		return {}
	var oy := pos.y + 0.5
	if col.ray_hit(pos.x, oy, pos.z, ux, 0.0, uz, t_in - 0.03) < t_in - 0.12:
		return {}   # autre chose avant l'obstacle
	var lx := pos.x + ux * (t_out + clearance)
	var lz := pos.z + uz * (t_out + clearance)
	if col.ray_hit(pos.x + ux * (t_out + 0.03), oy, pos.z + uz * (t_out + 0.03), ux, 0.0, uz, clearance + 0.02) < clearance - 0.02:
		return {}   # mur juste derrière
	var q := col.resolve(Vector3(lx, pos.y, lz), float(Config.at("player.radius")))
	if Vector2(q.x - lx, q.z - lz).length() > 0.05:
		return {}   # la case d'arrivée est encombrée
	if levels != null:
		levels.floor_at(lx, lz, pos.y + 0.1, _vfl)
		if int(_vfl["region"]) != region or absf(float(_vfl["y"]) - pos.y) > float(Config.at("vault.heightTol")):
			return {}
	if world != null:
		var zi := world.zone_of(lx, lz)
		if zi < 0 or not world.is_zone_open(zi):
			return {}   # zone fermée ou hors de l'île : refusé
	return {"lx": lx, "lz": lz, "h": h}

func _start_vault(col: Collision, world: World, levels: Levels) -> bool:
	var t := _check_vault(col, world, levels)
	if t.is_empty():
		return false
	vault = {"t": 0.0, "dur": float(Config.at("vault.time")), "x0": pos.x, "z0": pos.z, "x1": t["lx"], "z1": t["lz"], "y": pos.y}
	vel = Vector3.ZERO
	vy = 0.0
	jump_sprint = false
	aiming = false
	vault_event = true
	return true

func _step_vault(dt: float, col: Collision) -> void:
	vault["t"] = float(vault["t"]) + dt
	var u := minf(1.0, float(vault["t"]) / float(vault["dur"]))
	var e := u * u * (3.0 - 2.0 * u)
	pos.x = float(vault["x0"]) + (float(vault["x1"]) - float(vault["x0"])) * e
	pos.z = float(vault["z0"]) + (float(vault["z1"]) - float(vault["z0"])) * e
	pos.y = float(vault["y"])
	vel = Vector3.ZERO
	vy = 0.0
	air_t = 0.0
	_was_grounded = true
	if u >= 1.0:
		vault = {}
		vault_cd = float(Config.at("vault.cooldown"))
		pos = col.resolve(pos, float(Config.at("player.radius")))

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
