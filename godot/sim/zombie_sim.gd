class_name ZombieSim
extends RefCounted
## Zombie (port de la logique de src/zombie.js, sans modèle ni rendu) : apparition par fenêtre ou depuis le sol, poursuite par champ de flux
## (ligne droite quand l'objectif est en vue), séparation, pas de côté quand il est coincé, enjambement des obstacles bas, escaliers entre
## étages, attaque en deux temps, variantes (coureur, rampant, boiteux, chevalier de fer, pestiféré). Pur : aucun nœud ; l'état de la
## pose (pose_*) est calculé ici pour que la vue n'ait qu'à l'afficher. Les valeurs d'équilibrage viennent de Config, les constantes de
## règle de Rules.

var id := 0
var pos := Vector3.ZERO
var yaw := 0.0          ## convention three.js : le modèle regarde vers +Z à yaw = 0
var health := 70.0
var max_health := 70.0
var speed := 2.0
var runner := false
var crawler := false    ## jambes arrachées : se traîne, plus lent
var limp := false       ## boite : jambe gauche à 45 %, vitesse x 0,8
var kind := ""          ## "", "armored" (chevalier de fer), "bloat" (pestiféré)
var armor := 1.0        ## dégâts reçus x armor
var explodes := false
var dead := false
var death_t := 0.0
var headless := false
var attack_cd := Rules.ZOMBIE_FIRST_ATTACK_CD
var attack_windup := -1.0
var attacking := false
var walk_t := 0.0
var moving := false
var rng: RandomNumberGenerator   ## posé par Game (graine de la partie)
var stuck_t := 0.0
var sidestep_t := 0.0
var sidestep_dir := 1.0
var no_progress := 0.0   ## secondes passées sans réussir à avancer (relocalisation)
var far_t := 0.0
var region := 0          ## étage (0 = sol de la ville)
var link: Dictionary = {}   ## escalier en cours d'emprunt : { link, dir, s } ; vide si aucun
var vault: Dictionary = {}  ## enjambement en cours : { t, x0, z0, x1, z1 }
var vault_cd := 0.0
var strike_target: PlayerSim   ## joueur touché par le coup de ce pas (null si aucun)
var strike_damage := 0.0
var events: PackedStringArray = PackedStringArray()   ## "knock", "glass", "rumble", "emerge" (sons et effets, vidés par Game)
var target: PlayerSim          ## cible poursuivie ce pas (null : personne)
var run_over_until := 0.0      ## J5 : moto ou rame : pas d'autre coup avant ce temps de jeu (écrasement)

# apparition
var spawn_type := ""            ## "window", "ground" ou "" (déjà sorti)
var spawn_t := 0.0              ## temps restant avant la fin de l'apparition
var spawn_elapsed := 0.0
var spawn_total := 0.0
var spawn_inside := Vector3.ZERO
var spawn_outside := Vector3.ZERO
var spawn_center := Vector3.ZERO
var spawn_normal := Vector2.ZERO
var spawn_pos := Vector3.ZERO
var spawn_window := -1          ## indice de la fenêtre (World.windows)
var lean_x := 0.0               ## inclinaison du modèle pendant l'apparition (rad)
var _knocks := 0
var _broke := false
var _rumbled := false
var _emerged := false

# pose (lue par la vue)
var pose_amp := 0.15
var pose_reach := 0.85
var pose_lean := 0.28
var pose_nod := 0.18
var pose_speed_walk := 1.0      ## 0 : sur place

# interne
var _dir := Vector2.ZERO
var _vh: Dictionary = {}

## zombieSkin.js : hashId — le même nombre pour tous les joueurs (taille, visage, teinte, mort) à partir de l'identifiant.
static func hash_id(zid: int, k := 0) -> float:
	var v := sin((zid + 1) * 12.9898 + k * 78.233) * 43758.5453
	return v - floor(v)

## Échelle du modèle (zombie.js : sc = 0,95 + 0,13 x hash(8) ; chevalier x 1,12 ; pestiféré plus large) ; sert aussi aux boîtes de touche.
func body_scale() -> Vector3:
	var sc := 0.95 + 0.13 * hash_id(id, 8)
	if kind == "armored":
		sc *= Rules.ARMORED_SCALE
	return Vector3(sc * (Rules.BLOAT_WIDTH if kind == "bloat" else 1.0), sc, sc * (Rules.BLOAT_WIDTH if kind == "bloat" else 1.0))

## Zombie ordinaire à partir de la vitesse de manche déjà tirée ; les variantes se posent ensuite (make_crawler, make_kind).
func init_traits(r: RandomNumberGenerator) -> void:
	walk_t = r.randf() * 10.0
	limp = r.randf() < Rules.LIMP_CHANCE
	runner = speed > 3.2

func make_crawler() -> void:
	if crawler:
		return
	crawler = true
	speed *= Rules.CRAWLER_SPEED
	runner = false
	limp = false

func make_kind(k: String) -> void:
	kind = k
	if k == "armored":
		armor = Rules.ARMORED_ARMOR
		speed *= Rules.ARMORED_SPEED
		runner = false
	elif k == "bloat":
		explodes = true
		speed *= Rules.BLOAT_SPEED
		runner = false

## Apparition par une fenêtre : le zombie cogne puis enjambe de `inside` à `outside`.
func start_window_spawn(inside: Vector3, outside: Vector3, center: Vector3, normal: Vector2, win_yaw: float, index := -1) -> void:
	spawn_type = "window"
	spawn_total = Rules.WIN_WARN + Rules.WIN_CLIMB
	spawn_inside = inside
	spawn_outside = outside
	spawn_center = center
	spawn_normal = normal
	spawn_window = index
	pos = inside
	yaw = win_yaw
	spawn_elapsed = 0.0
	spawn_t = spawn_total
	_knocks = 0
	_broke = false

## Apparition depuis le sol : la terre tremble, puis il remonte.
func start_ground_spawn(p: Vector3, start_yaw: float) -> void:
	spawn_type = "ground"
	spawn_total = Rules.GND_DELAY + Rules.GND_RISE
	spawn_pos = p
	pos = Vector3(p.x, -2.0, p.z)
	yaw = start_yaw
	spawn_elapsed = 0.0
	spawn_t = spawn_total
	_rumbled = false
	_emerged = false

## Saute l'animation d'apparition (zombie déjà sorti).
func skip_spawn() -> void:
	if spawn_type == "window":
		pos = spawn_outside
	elif spawn_type == "ground":
		pos = Vector3(spawn_pos.x, 0.0, spawn_pos.z)
	spawn_elapsed = spawn_total
	spawn_t = 0.0
	lean_x = 0.0
	_broke = true
	_emerged = true
	_rumbled = true

## Peut-on lui tirer dessus ? (sorti, ou presque : déjà touchable à moitié)
func targetable() -> bool:
	if dead:
		return false
	if spawn_t <= 0.0:
		return true
	if spawn_type == "window":
		return spawn_elapsed > Rules.WIN_WARN + Rules.WIN_CLIMB * Rules.WIN_HIT_AT
	return spawn_elapsed > Rules.GND_DELAY + Rules.GND_RISE * Rules.GND_HIT_AT

## Applique des dégâts ; renvoie true si le zombie meurt de ce coup.
func damage(amount: float, head: bool) -> bool:
	if dead:
		return false
	health -= amount * armor
	if health <= 0.0:
		dead = true
		death_t = 0.0
		headless = head
		return true
	return false

func _pose(amp: float, reach: float, lean: float, nod: float) -> void:
	pose_amp = amp
	pose_reach = reach
	pose_lean = lean
	pose_nod = nod

func _idle_pose() -> void:
	_pose(0.15, 0.85, 0.5 if runner else 0.28, 0.18)

## Avance d'un pas. Après l'appel : strike_target / strike_damage décrivent le coup porté (strike_damage > 0), events les évènements.
func step(dt: float, env: ZombieEnv) -> void:
	strike_target = null
	strike_damage = 0.0
	if dead:
		death_t += dt
		return
	if spawn_t > 0.0:
		_spawn_update(dt)
		return
	var Z: Dictionary = Config.at("zombie")
	var lv := env.levels
	var has_lv := lv != null and not lv.links.is_empty()
	if link.is_empty():
		pos.y = float(lv.regions[region]["y"]) if (region != 0 and lv != null) else 0.0   # il reste à la hauteur de son étage
	var zr := region
	if not link.is_empty():
		zr = int(link["link"]["b"]) if int(link["dir"]) > 0 else int(link["link"]["a"])
	# cible : le joueur le plus proche (par escaliers si besoin), debout et atteignable
	target = null
	var best_cost := INF
	for pl in env.players:
		if pl == null or pl.dead:
			continue
		var cost := Vector2(pl.pos.x - pos.x, pl.pos.z - pos.z).length()
		if has_lv:
			var pr := pl.tregion
			if pr != zr:
				var hd := lv.hop_distance(zr, pr)
				if hd == INF:
					continue
				cost += hd + Rules.HOP_PENALTY
		if cost < best_cost:
			best_cost = cost
			target = pl
	if target == null:   # personne à poursuivre : il titube sur place
		walk_t += dt * 1.2
		attacking = false
		moving = false
		_idle_pose()
		return
	if not link.is_empty():
		_on_link(dt, Z, env)
		return
	if not vault.is_empty():
		_vault_step(dt)
		return
	vault_cd -= dt
	# objectif : le joueur (même étage), ou le pied de l'escalier qui mène vers lui
	var gx := target.pos.x
	var gz := target.pos.z
	var chase := true
	var tr := target.tregion if has_lv else 0
	if has_lv and region != tr:
		var hop := lv.next_hop(region, tr)
		if hop.is_empty():
			walk_t += dt * 1.2
			moving = false
			_pose(0.15, 0.85, 0.28, 0.18)
			return
		var L: Dictionary = hop["link"]
		var path: Array = L["path"]
		var e: Array = path[0] if int(hop["dir"]) > 0 else path[path.size() - 1]
		gx = e[0]
		gz = e[2]
		chase = false
		if Vector2(gx - pos.x, gz - pos.z).length() < Rules.LINK_ENTER:
			link = {"link": L, "dir": int(hop["dir"]), "s": 0.0 if int(hop["dir"]) > 0 else float(L["length"])}
			return
	# gong du tram (J5) : à moins de `range` m du gong, un zombie qui n'est pas déjà sur un joueur va vers le tram (sa cible du champ de flux)
	if env.rides != null:
		var lure: Dictionary = env.rides.lure
		if not lure.is_empty() and float(lure["t"]) > 0.0 and region == 0 and link.is_empty() \
				and Vector2(lure["x"] - pos.x, lure["z"] - pos.z).length() < float(lure.get("range", 50.0)) and Vector2(gx - pos.x, gz - pos.z).length() > 5.0:
			gx = lure["x"]
			gz = lure["z"]
			chase = false
		# cible dans une rame aux portes ouvertes : le zombie va d'abord devant la porte ouverte la plus proche (il ne peut ni entrer ni traverser la caisse)
		if chase and region == 0 and link.is_empty():
			var tg: Dictionary = env.rides.tram_goal(self)
			if not tg.is_empty():
				gx = tg["x"]
				gz = tg["z"]
				chase = false
	var dx := gx - pos.x
	var dz := gz - pos.z
	var dist := sqrt(dx * dx + dz * dz)
	# direction : tout droit si l'objectif est visible, sinon via le champ de flux de l'étage
	var nav: NavGrid = (lv.nav_of(region) if (region != 0 and lv != null) else env.nav)
	var dirx := dx / (dist if dist > 0.0 else 1.0)
	var dirz := dz / (dist if dist > 0.0 else 1.0)
	var visible := true
	if nav != null:
		visible = dist < Rules.SEE_DIST or nav.los(pos.x, pos.z, gx, gz)
		if not visible and nav.steer(pos.x, pos.z):
			dirx = nav.steer_x
			dirz = nav.steer_z
	# orientation lissée
	var diff := atan2(dirx, dirz) - yaw
	diff = atan2(sin(diff), cos(diff))
	yaw += diff * minf(1.0, dt * Rules.ZOMBIE_TURN_RATE)
	# déplacement
	attack_cd -= dt
	var in_range := chase and dist < float(Z["attackRange"]) and visible and absf(target.pos.y - pos.y) < 2.4
	moving = false
	if not in_range and attack_windup < 0.0:
		moving = true
		if sidestep_t > 0.0:   # coincé contre un obstacle : pas de côté
			sidestep_t -= dt
			var a := sidestep_dir * Rules.ZOMBIE_SIDESTEP_ANGLE
			var ca := cos(a)
			var sa := sin(a)
			var tx := dirx * ca - dirz * sa
			dirz = dirx * sa + dirz * ca
			dirx = tx
		var bx := pos.x
		var bz := pos.z
		var sp := speed * Rules.LIMP_SPEED if limp else speed
		if not visible and vault_cd <= 0.0 and not crawler and region == 0 and nav != null and _try_vault(dirx, dirz, env, nav):
			return   # le champ de flux traverse un obstacle bas : on l'enjambe
		pos.x += dirx * sp * dt
		pos.z += dirz * sp * dt
		for o in env.zombies:
			if o == self or o.dead or o.spawn_t > 0.0:
				continue
			var ox := pos.x - o.pos.x
			var oz := pos.z - o.pos.z
			var d := sqrt(ox * ox + oz * oz)
			if d > 0.0 and d < Rules.ZOMBIE_SEPARATION and o.region == region and o.link.is_empty():
				var push := (Rules.ZOMBIE_SEPARATION - d) * 0.5
				pos.x += ox / d * push
				pos.z += oz / d * push
		pos = env.collision.resolve(pos, float(Z["radius"]))
		var moved := sqrt((pos.x - bx) * (pos.x - bx) + (pos.z - bz) * (pos.z - bz))
		if moved < sp * dt * Rules.ZOMBIE_AUTO_STUCK_RATIO:
			no_progress += dt
		else:
			no_progress = maxf(0.0, no_progress - dt * 2.0)
		if moved < sp * dt * Rules.ZOMBIE_STUCK_RATIO:
			stuck_t += dt
			if stuck_t > Rules.ZOMBIE_STUCK_TIME and sidestep_t <= 0.0:
				sidestep_t = Rules.ZOMBIE_SIDESTEP_TIME
				sidestep_dir = -1.0 if (env.rng.randf() if env.rng != null else 0.0) < 0.5 else 1.0
				stuck_t = 0.0
		else:
			stuck_t = 0.0
		walk_t += dt * sp * (2.6 if runner else 3.2)
	else:
		walk_t += dt * 1.2
	# attaque : le coup part à la fin de l'armement s'il touche encore
	if attack_windup >= 0.0:
		attack_windup -= dt
		if attack_windup < 0.0:
			var tdx := target.pos.x - pos.x
			var tdz := target.pos.z - pos.z
			if sqrt(tdx * tdx + tdz * tdz) < float(Z["attackRange"]) + 0.5 and absf(target.pos.y - pos.y) < 2.6:
				strike_target = target
				strike_damage = float(Z["damage"])
			attack_cd = float(Z["attackCooldown"])
			attack_windup = -1.0
	elif in_range and attack_cd <= 0.0:
		attack_windup = Rules.ZOMBIE_ATTACK_WINDUP
	attacking = attack_windup >= 0.0
	var lean := 0.5 if runner else 0.28
	_pose((1.25 if runner else 1.0) if moving else 0.15, 1.5 if attacking else 0.85, lean + 0.3 if attacking else lean, 0.4 if attacking else 0.18)

# ------------------------------------------------------------------ enjambement
## Devant un obstacle enjambable que le champ de flux traverse, si l'arrivée est libre et plus proche du joueur : saute (vault.time s).
func _try_vault(dirx: float, dirz: float, env: ZombieEnv, nav: NavGrid) -> bool:
	var V: Dictionary = Config.at("zombie.vault")
	var col := env.collision
	var h := col.find_vault(pos.x, pos.z, dirx, dirz, float(V["reach"]))
	if h.is_empty() or float(h["tOut"]) - float(h["tIn"]) > Rules.VAULT_MAX_PASS:
		return false
	if -(dirx * float(h["nx"]) + dirz * float(h["nz"])) < cos(deg_to_rad(float(V["maxAngle"]))):
		return false
	var lx := pos.x + dirx * (float(h["tOut"]) + Rules.VAULT_LAND)
	var lz := pos.z + dirz * (float(h["tOut"]) + Rules.VAULT_LAND)
	var q := col.resolve(Vector3(lx, 0.0, lz), float(Config.at("zombie.radius")))
	if Vector2(q.x - lx, q.z - lz).length() > 0.05 or nav.is_blocked_at(lx, lz):
		return false
	if not (nav.walk_distance(lx, lz) < nav.walk_distance(pos.x, pos.z) - Rules.VAULT_GAIN):
		return false   # pas de progrès : inutile
	vault = {"t": 0.0, "x0": pos.x, "z0": pos.z, "x1": lx, "z1": lz}
	attacking = false
	return true

func _vault_step(dt: float) -> void:
	var V: Dictionary = Config.at("zombie.vault")
	vault["t"] = float(vault["t"]) + dt
	var u := minf(1.0, float(vault["t"]) / float(V["time"]))
	var e := u * u * (3.0 - 2.0 * u)
	pos.x = float(vault["x0"]) + (float(vault["x1"]) - float(vault["x0"])) * e
	pos.z = float(vault["z0"]) + (float(vault["z1"]) - float(vault["z0"])) * e
	pos.y = float(V["arc"]) * sin(PI * u)
	yaw = atan2(float(vault["x1"]) - float(vault["x0"]), float(vault["z1"]) - float(vault["z0"]))
	walk_t += dt * 6.0
	attacking = false
	moving = true
	_pose(0.8, 1.6, 0.4, 0.2)
	if u >= 1.0:
		vault = {}
		vault_cd = float(V["cooldown"])
		pos.y = 0.0
		no_progress = 0.0
		stuck_t = 0.0

# ------------------------------------------------------------------ escaliers
## Sur un escalier : le zombie suit le chemin 3D du lien (ou va à la rencontre du joueur qui s'y trouve) et frappe sur place.
func _on_link(dt: float, Z: Dictionary, env: ZombieEnv) -> void:
	var lv := env.levels
	var L: Dictionary = link["link"]
	attack_cd -= dt
	var dx := target.pos.x - pos.x
	var dz := target.pos.z - pos.z
	var dy := target.pos.y - pos.y
	var d3 := sqrt(dx * dx + dz * dz + dy * dy)
	var mv := attack_windup < 0.0
	if target.region == int(L["region"]):   # le joueur est sur la même volée de marches : on va vers lui
		var ps := lv.project(L, target.pos.x, target.pos.z, target.pos.y)
		link["dir"] = 1 if ps >= float(link["s"]) else -1
		if absf(ps - float(link["s"])) < Rules.LINK_MELEE:
			mv = false
	var in_range := d3 < float(Z["attackRange"]) + 0.2 and absf(dy) < 2.2
	if in_range:
		mv = false
	var sp := speed * Rules.LIMP_SPEED if limp else speed
	var tmp := {}
	if mv:
		link["s"] = float(link["s"]) + float(link["dir"]) * sp * Rules.LINK_SPEED * dt
	lv.point_on(L, float(link["s"]), tmp)
	pos = Vector3(tmp["x"], tmp["y"], tmp["z"])
	var want: float = atan2(dx, dz) if in_range else float(tmp["yaw"]) + (PI if int(link["dir"]) < 0 else 0.0)
	var diff := want - yaw
	diff = atan2(sin(diff), cos(diff))
	yaw += diff * minf(1.0, dt * Rules.ZOMBIE_TURN_RATE)
	moving = mv
	if mv:
		walk_t += dt * sp * (2.6 if runner else 3.2)
	else:
		walk_t += dt * 1.2
	if attack_windup >= 0.0:
		attack_windup -= dt
		if attack_windup < 0.0:
			if d3 < float(Z["attackRange"]) + 0.7:
				strike_target = target
				strike_damage = float(Z["damage"])
			attack_cd = float(Z["attackCooldown"])
			attack_windup = -1.0
	elif in_range and attack_cd <= 0.0:
		attack_windup = Rules.ZOMBIE_ATTACK_WINDUP
	attacking = attack_windup >= 0.0
	if float(link["s"]) <= 0.0 or float(link["s"]) >= float(L["length"]):   # arrivé : on reprend l'IA normale sur l'étage d'arrivée
		region = int(L["b"]) if int(link["dir"]) > 0 else int(L["a"])
		link = {}
	var lean := 0.5 if runner else 0.28
	_pose((1.25 if runner else 1.0) if moving else 0.15, 1.5 if attacking else 0.85, lean + 0.3 if attacking else lean, 0.4 if attacking else 0.18)

# ------------------------------------------------------------------ apparition
func _spawn_update(dt: float) -> void:
	spawn_elapsed += dt
	var e := spawn_elapsed
	spawn_t = maxf(0.0, spawn_total - e)
	moving = false
	if spawn_type == "window":
		if e < Rules.WIN_WARN:
			if e >= _knocks * 0.3:
				_knocks += 1
				events.append("knock")
			return
		if not _broke:
			_broke = true
			events.append("glass")
		var t := minf(1.0, (e - Rules.WIN_WARN) / Rules.WIN_CLIMB)
		var ease := t * t * (3.0 - 2.0 * t)
		pos.x = spawn_inside.x + (spawn_outside.x - spawn_inside.x) * ease
		pos.z = spawn_inside.z + (spawn_outside.z - spawn_inside.z) * ease
		var k := (t - 0.45) / 0.24
		pos.y = 0.7 * exp(-(k * k))
		lean_x = 0.5 * sin(PI * t)
		walk_t += dt * 2.2
		_pose(0.5, 1.0, 0.35, 0.2)
		if spawn_t <= 0.0:
			pos = Vector3(spawn_outside.x, 0.0, spawn_outside.z)
			lean_x = 0.0
		return
	# sol
	if e < Rules.GND_DELAY:
		if not _rumbled:
			_rumbled = true
			events.append("rumble")
		return
	if not _emerged:
		_emerged = true
		events.append("emerge")
	var t2 := minf(1.0, (e - Rules.GND_DELAY) / Rules.GND_RISE)
	var ease2 := 1.0 - pow(1.0 - t2, 2.2)
	pos.x = spawn_pos.x
	pos.z = spawn_pos.z
	pos.y = -1.95 + 1.95 * ease2
	lean_x = 0.35 * (1.0 - t2)
	walk_t += dt * 1.6
	_pose(0.15, 1.7 - t2 * 0.7, 0.2 + 0.25 * (1.0 - t2), 0.3 - t2 * 0.1)
	if spawn_t <= 0.0:
		pos.y = 0.0
		lean_x = 0.0
