class_name VehicleSim
extends RefCounted
## Moto, grosse moto ou vélo : conduite arcade, collisions, écrasement des zombies, essence, points de vie, feu, épave (port de la classe Vehicle de
## src/vehicles.js, sans modèle, son ni réseau). Cinématique maison, pas de VehicleBody3D (décision D3). Pur : aucun nœud.
## Le contexte `g` est l'hôte (autoload Game ou une doublure de test) : collision, zombies, time, vehicles, world (étages, peut être null),
## hit_zombie(z, head, dmg, mult) -> bool, damage_vehicle(v, amt, src), hurt_occupants(v, dmg), shake.
## États : "ok" | "burning" | "wreck" (épave visible, sans collision) | "gone" (disparu, revient à la manche respawn_round).

var id := 0
var type := ""
var def: Dictionary
var spawn := {"x": 0.0, "z": 0.0, "yaw": 0.0}
var variant := 0
var station := -1
var x := 0.0                   ## position en doubles (le Vector3 est en simple précision : l'écart cumulé dépasserait le centimètre en quelques secondes)
var y := 0.0
var z := 0.0
var pos: Vector3:
	get: return Vector3(x, y, z)
var yaw := 0.0
var dyaw := 0.0
var speed := 0.0
var steer := 0.0
var steer_angle := 0.0
var lean := 0.0
var wheel_rot := 0.0
var wheel_radius := 0.33
var throttle := 0.0
var crash_t := 0.0
var hit_t := 0.0
var hp := 100.0
var state := "ok"
var burn_t := 0.0
var wreck_t := 0.0
var respawn_round := 0
var respawn_pending := false
var respawn_retry := 0.0
var fuel := 0.0
var miss_cd := 1.0
var miss_t := 0.0
var beep_t := 0.0
var dry_noted := false
var seats: Array = []          ## occupant de chaque place (0 : le joueur en solo), null : libre
var model_seats: Array = []    ## [{ hip: [x, y, z], eye: [x, y, z], ry }] (doubles) (cuits dans vehicles.json)
var events: PackedStringArray = PackedStringArray()   ## "cough", "beep", "dry", "crash:<impact>" : vidés par Rides (sons, annonces)
var vy := 0.0                  ## v0.37.0 : relief (World.terrain, carte de test des véhicules) : vitesse verticale (m/s)
var air := false               ## en l'air (au bout d'une rampe, sur une bosse prise vite)
var grade := 0.0               ## pente du sol dans l'axe (m/m, + : ça monte devant) : la vue en tire le tangage
var land_speed := 0.0          ## vitesse verticale du dernier atterrissage (m/s)
var _bike_hit: Dictionary = {}
var _fl := {"y": 0.0, "region": 0}
var _col := {}

func _init(id_: int, type_: String, sp: Dictionary) -> void:
	id = id_
	type = type_
	def = Config.at("vehicles.types.%s" % type_)
	spawn = {"x": float(sp["x"]), "z": float(sp["z"]), "yaw": float(sp["yaw"])}
	variant = int(sp.get("variant", 0))
	station = int(sp.get("station", -1))
	seats.resize(int(def["seats"]))
	reset()

func reset() -> void:
	x = spawn["x"]
	y = 0.0
	z = spawn["z"]
	yaw = spawn["yaw"]
	dyaw = 0.0
	speed = 0.0
	steer = 0.0
	steer_angle = 0.0
	lean = 0.0
	wheel_rot = 0.0
	throttle = 0.0
	crash_t = 0.0
	hit_t = 0.0
	hp = float(def["hp"])
	state = "ok"
	burn_t = 0.0
	wreck_t = 0.0
	respawn_round = 0
	respawn_pending = false
	respawn_retry = 0.0
	fuel = float(def["tank"])
	miss_cd = 1.0
	miss_t = 0.0
	beep_t = 0.0
	dry_noted = false
	_bike_hit.clear()
	seats.fill(null)
	vy = 0.0
	air = false
	grade = 0.0

func max_hp() -> float:
	return float(def["hp"])
func has_tank() -> bool:
	return float(def["tank"]) > 0.0
func fuel_frac() -> float:
	return fuel / float(def["tank"]) if has_tank() else 1.0
func hp_frac() -> float:
	return hp / float(def["hp"])
func usable() -> bool:
	return state == "ok"
func has_driver() -> bool:
	return seats[0] != null
func is_driver(seat: int) -> bool:
	return seat == 0
func free_seat() -> int:
	return seats.find(null)
func is_tram() -> bool:
	return false
func seat_yaw(_seat: int) -> float:
	return yaw
func seat_dyaw(_seat: int) -> float:
	return dyaw

## Point local (x droite, y haut, z arrière) -> monde (sans l'inclinaison, négligeable pour une position).
func to_world(p: Array) -> Vector3:
	var c := cos(yaw)
	var s := sin(yaw)
	return Vector3(x + c * p[0] + s * p[2], y + p[1], z - s * p[0] + c * p[2])

func hip_world(seat: int) -> Vector3:
	return to_world(model_seats[seat]["hip"])
func eye_world(seat: int) -> Vector3:
	return to_world(model_seats[seat]["eye"])

static func ang_diff(a: float, b: float) -> float:
	return atan2(sin(a - b), cos(a - b))

# ------------------------------------------------------------------ boucle
## Un pas. driven : le joueur local conduit (seats[0] occupé). inp : { fwd, back, hb (frein à main), steer (-1 gauche .. 1 droite) }.
func update(dt: float, g: Object, inp: Dictionary, driven: bool) -> void:
	if state == "gone":
		return
	var prev_yaw := yaw
	if crash_t > 0.0:
		crash_t -= dt
	if hit_t > 0.0:
		hit_t -= dt
	if state == "wreck":
		speed = 0.0
		dyaw = 0.0
		throttle = 0.0
		wreck_t -= dt
		if wreck_t <= 0.0:
			state = "gone"
			return
	elif driven and state != "wreck":
		drive(dt, g, inp)
	else:
		throttle = 0.0
		steer_angle = steer * float(def["maxSteer"]) / (1.0 + absf(speed) * 0.12)
		settle(dt, g)
	if state != "wreck":
		dyaw = ang_diff(yaw, prev_yaw)
		wheel_rot += (speed / wheel_radius) * dt

# ------------------------------------------------------------------ conduite
func drive(dt: float, g: Object, inp: Dictionary) -> void:
	var D := def
	var on := state == "ok"   # en feu : moteur coupé, roue libre, direction à plat
	var fwd_key: bool = on and bool(inp.get("fwd", false))
	var back_key: bool = on and bool(inp.get("back", false))
	var hb: bool = on and bool(inp.get("hb", false))
	var steer_in: float = float(inp.get("steer", 0.0)) if on else 0.0
	var sp := speed
	var tk := traction(g)   # v0.37.0 : 1 sur un sol ordinaire (produits exacts : golden JS inchangés)
	# essence : réserve (bips), ratés sous missBelow, panne sèche (poussée au pas) ; un vélo n'a rien de tout cela
	var FU: Dictionary = Config.at("vehicles.fuel")
	var tank := has_tank()
	var frac := fuel_frac()
	var dry := tank and on and fuel <= 0.0
	var miss := false
	if tank and on and not dry and frac < float(FU["missBelow"]):
		miss_cd -= dt
		if miss_t > 0.0:
			miss_t -= dt
		elif miss_cd <= 0.0:
			miss_t = float(FU["missLen"])
			miss_cd = float(FU["missEvery"]) * (0.7 + 0.6 * g.rng.randf())
			events.append("cough")
		miss = miss_t > 0.0
	else:
		miss_t = 0.0
	if tank and on and not dry and frac < float(FU["lowBelow"]):
		beep_t -= dt
		if beep_t <= 0.0:
			beep_t = float(FU["lowBeep"])
			events.append("beep")
	else:
		beep_t = 0.0
	if dry and not dry_noted:
		dry_noted = true
		events.append("dry")
	if not dry and fuel > 0.0:
		dry_noted = false
	# vitesse : accélération qui faiblit près du maximum, freinage, marche arrière, résistance
	throttle = 0.0
	if fwd_key and not back_key:
		throttle = 1.0
		if sp < 0.0:
			sp += float(D["brake"]) * dt * tk
		elif dry:
			if sp < float(FU["pushSpeed"]):
				sp = minf(float(FU["pushSpeed"]), sp + float(FU["pushAccel"]) * dt)
			else:
				sp = _coast(sp, dt)
		elif miss:
			throttle = 0.0
			sp = _coast(sp, dt)
		else:
			sp += float(D["accel"]) * maxf(0.1, 1.0 - sp / float(D["maxSpeed"])) * dt * tk
	elif back_key and not fwd_key:
		throttle = -1.0
		if sp > 0.3:
			sp = sp - float(D["brake"]) * dt * tk
		else:
			var lim := minf(float(D["reverseSpeed"]), float(FU["pushSpeed"])) if dry else float(D["reverseSpeed"])
			var acc := float(FU["pushAccel"]) if dry else float(D["accel"]) * 0.5
			sp = maxf(-lim, sp - acc * dt * tk)
	else:
		sp = _coast(sp, dt)
	if hb:
		var b := float(D["brake"]) * 1.1 * dt * tk
		sp = 0.0 if absf(sp) <= b else sp - signf(sp) * b
	sp = clampf(sp, -float(D["reverseSpeed"]), float(D["maxSpeed"]))
	# consommation : ralenti + gaz (marche arrière x 0,6) ; moteur coupé (en feu) ou réservoir vide : rien
	if tank and on and fuel > 0.0:
		var gas := 0.0 if throttle == 0.0 else (float(D["gas"]) + float(D["perSpeed"]) * absf(sp) / float(D["maxSpeed"])) * (0.6 if throttle < 0.0 else 1.0)
		fuel = maxf(0.0, fuel - (float(D["idle"]) + gas) * dt)
	# direction : angle de braquage qui diminue avec la vitesse, modèle « bicyclette » ; le frein à main donne du dérapage
	steer += (steer_in - steer) * minf(1.0, dt * 7.0)
	steer_angle = steer * float(D["maxSteer"]) / (1.0 + absf(sp) * 0.12)
	var yaw_rate := -(sp / float(D["wheelbase"])) * tan(steer_angle) * (1.5 if hb else 1.0)
	var max_yaw := (float(D["grip"]) * (1.6 if hb else 1.0)) / maxf(3.0, absf(sp)) * tk
	yaw_rate = clampf(yaw_rate, -max_yaw, max_yaw)
	yaw += yaw_rate * dt
	lean += (clampf(yaw_rate * absf(sp) * float(D.get("leanK", 0.035)), -0.55, 0.55) - lean) * minf(1.0, dt * 6.0)
	# déplacement + collisions (murs, voitures, mobilier) ; on ne monte pas d'escalier ni ne descend de trou
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var ox := x
	var oz := z
	var wx := ox + fx * sp * dt
	var wz := oz + fz * sp * dt
	var want := Vector3(wx, y + 0.1, wz)
	_col.clear()
	var p: Vector3 = g.collision.resolve(want, float(D["radius"]), _col, null, true)
	var cx := p.x - want.x   # poussée du décor : différence de deux valeurs simple précision, exacte ; les positions restent en doubles
	var cz := p.z - want.z
	var cl := sqrt(cx * cx + cz * cz)
	var stepped := false
	if g.world != null:
		g.world.floor_at(p.x, p.z, 0.1, _fl)
		stepped = int(_fl["region"]) != 0 or absf(float(_fl["y"])) > 0.25
	if stepped:   # marche, trou : on ne passe pas
		crash(absf(sp), "wall", g)
		sp = -sp * 0.15
	else:
		x = wx + cx
		z = wz + cz
		if cl > 1e-4:   # poussée du mur : plus on fonce dedans de face, plus on perd de vitesse
			var into := clampf(-(fx * cx + fz * cz) / cl * signf(sp), 0.0, 1.0)
			if into > 0.05:
				var kind: Variant = _col.get("kind")
				crash(absf(sp) * into, String(kind) if kind != null else "wall", g)
				sp *= 1.0 - 0.92 * into * into
		sp = follow_terrain(dt, g, ox, oz, sp, float(D["wheelbase"]) / 2.0)
	sp = collide_bikes(sp, dt, g)
	speed = sp
	if roadkill(g):   # arrêtée net par un zombie au contact : on ne le traverse pas
		x = ox
		z = oz

# ------------------------------------------------------------------ v0.37.0 : relief et adhérence (World.terrain)
const GRAVITY := 9.81
const STEP_UP := 0.35   ## m : saut de relief franchi d'un pas ; au-delà (flanc d'une rampe, bord d'un plateau) : un obstacle

static func terrain_of(g: Object) -> Object:
	var w: Object = g.world
	return w.get("terrain") if w != null else null   # (get : une doublure de test sans relief)

## Adhérence du pas : 1 sans relief ; 0 en l'air ; sinon celle du sol (boue, glace).
func traction(g: Object) -> float:
	var T := terrain_of(g)
	if T == null:
		return 1.0
	return 0.0 if air else float(T.grip(x, z))

## Le relief monte d'un coup de plus de STEP_UP sous (px, pz) en venant de (dx, dz) (pas du déplacement, m) ?
func terrain_wall(T: Object, px: float, pz: float, dx: float, dz: float) -> bool:
	var l := sqrt(dx * dx + dz * dz)
	if l < 1e-6:
		return false
	var k := maxf(l, 0.25) / l
	return float(T.height(px, pz)) - float(T.height(px - dx * k, pz - dz * k)) > STEP_UP

## Après le déplacement (depuis ox, oz) : suit le relief (montée, descente, décollage au bout d'une rampe, chute, atterrissage) ; la pente
## freine ou pousse ; un flanc trop haut arrête la machine comme un mur. half : demi-longueur pour la pente (tangage). Renvoie la vitesse.
func follow_terrain(dt: float, g: Object, ox: float, oz: float, sp: float, half: float) -> float:
	var T := terrain_of(g)
	if T == null:
		return sp
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	if not air and (terrain_wall(T, x, z, x - ox, z - oz) or terrain_wall(T, x + fx * half, z + fz * half, x - ox, z - oz)):
		x = ox
		z = oz
		crash(absf(sp), "wall", g)
		return -sp * 0.15
	var h := float(T.height(x, z))
	if air:
		vy -= GRAVITY * dt
		y += vy * dt
		if y <= h:
			land_speed = -vy
			y = h
			vy = 0.0
			air = false
			events.append("land")
			crash(land_speed, "prop", g)
		return sp
	if h < y + vy * dt - GRAVITY * dt * dt - 0.01:   # le sol se dérobe plus vite que la chute libre : on décolle
		air = true
		y += vy * dt
		vy -= GRAVITY * dt
		return sp
	vy = (h - y) / dt
	y = h
	grade = (float(T.height(x + fx * half, z + fz * half)) - float(T.height(x - fx * half, z - fz * half))) / (2.0 * half)
	return sp - GRAVITY * grade / sqrt(1.0 + grade * grade) * dt

## Machine sans conducteur : retombe sur le relief.
func settle(dt: float, g: Object) -> void:
	var T := terrain_of(g)
	if T == null:
		return
	var h := float(T.height(x, z))
	if y > h + 0.01:
		vy -= GRAVITY * dt
		y = maxf(h, y + vy * dt)
		air = y > h
	else:
		y = h
		vy = 0.0
		air = false

func _coast(sp: float, dt: float) -> float:
	var drag := (float(def["drag"]) * absf(sp) + 0.8) * dt
	return 0.0 if absf(sp) <= drag else sp - signf(sp) * drag

## Deux cercles par moto (à +- empattement / 2 le long du cap) : l'avant et l'arrière. Renvoie [x0, z0, x1, z1, rayon].
func bike_circles() -> Array:
	var h := float(def["wheelbase"]) / 2.0
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	return [x + fx * h, z + fz * h, x - fx * h, z - fz * h, float(def["bikeRadius"])]

## Moto contre moto (conducteur local seulement) : voir collideBikes de vehicles.js. Renvoie la vitesse.
func collide_bikes(sp: float, dt: float, g: Object) -> float:
	var M: Dictionary = Config.at("vehicles.damage.motoHit")
	if state != "ok" or g.vehicles == null:
		return sp
	for k in _bike_hit.keys():
		_bike_hit[k] -= dt
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var a := bike_circles()
	var reach := float(def["wheelbase"]) / 2.0 + float(def["bikeRadius"])
	for o: VehicleSim in g.vehicles:
		if o == self or (o.state != "ok" and o.state != "burning"):
			continue
		if sqrt((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z)) > reach + float(o.def["wheelbase"]) / 2.0 + float(o.def["bikeRadius"]):
			continue
		var b := o.bike_circles()
		var pen := 0.0
		var nx := 0.0
		var nz := 0.0
		for i in [0, 2]:
			for j in [0, 2]:
				var dx: float = a[i] - b[j]
				var dz: float = a[i + 1] - b[j + 1]
				var d := sqrt(dx * dx + dz * dz)
				var pp: float = a[4] + b[4] - d
				if pp > pen:
					pen = pp
					if d > 1e-6:
						nx = dx / d
						nz = dz / d
					else:
						nx = -fx
						nz = -fz
		if pen <= 0.0:
			continue
		var driven: bool = o.seats[0] != null
		var k: float = float(M["driven"]) if driven else 1.0
		x += nx * pen * k
		z += nz * pen * k
		var ofx := -sin(o.yaw) * o.speed
		var ofz := -cos(o.yaw) * o.speed
		var vx := fx * sp
		var vz := fz * sp
		var closing := (ofx - vx) * nx + (ofz - vz) * nz
		if closing < 0.3:
			continue
		var into := maxf(0.0, -(vx * nx + vz * nz))
		if into > 0.0 and sp != 0.0:
			sp = clampf(sp - signf(sp) * float(M["bounce"]) * into, -float(def["reverseSpeed"]), float(def["maxSpeed"]))
		if float(_bike_hit.get(o.id, 0.0)) > 0.0:
			continue
		_bike_hit[o.id] = float(M["hitCooldown"])
		var dmg := maxf(0.0, closing - float(M["free"])) * float(M["perMs"])
		if dmg > 0.0:
			g.damage_vehicle(self, dmg, "crash")
			if not driven:
				g.damage_vehicle(o, dmg, "crash")
		crash(closing, "moto", g)
	return sp

## Dégâts d'un écrasement à la vitesse sp (m/s) : 0 sous le seuil vmin de la moto, puis K x v x r (r de 0,4 à 1 sur rampSpeed m/s).
func roadkill_damage(sp: float) -> float:
	var RK: Dictionary = def["roadkill"]
	var v := absf(sp)
	if v < float(RK["vmin"]):
		return 0.0
	return float(RK["K"]) * v * minf(1.0, 0.4 + 0.6 * (v - float(RK["vmin"])) / float(Config.at("vehicles.roadkill.rampSpeed")))

## Zombies écrasés (voir roadkill de vehicles.js). Renvoie true si un zombie au contact bloque la moto.
func roadkill(g: Object) -> bool:
	var R: Dictionary = Config.at("vehicles.roadkill")
	var RK: Dictionary = def["roadkill"]
	if absf(speed) < 0.05:
		return false
	var dir := signf(speed)
	var fx := -sin(yaw) * dir
	var fz := -cos(yaw) * dir
	var cx := x + fx * 0.6
	var cz := z + fz * 0.6
	var reach := float(def["radius"]) + 0.45
	var fast := absf(speed) >= float(RK["vmin"])
	var blocked := false
	for zb: ZombieSim in g.zombies:
		if not zb.targetable():
			continue
		var d := Vector2(zb.pos.x - cx, zb.pos.z - cz).length()
		if d > reach:
			continue
		if fast:
			if float(zb.run_over_until) > g.time:
				continue
			zb.run_over_until = g.time + float(R["cooldown"])
			var dmg := roadkill_damage(speed)
			var killed: bool = g.hit_zombie(zb, false, dmg, 1.0)
			g.damage_vehicle(self, float(Config.at("vehicles.damage.roadkillKill")) if killed else float(Config.at("vehicles.damage.roadkillHurt")), "roadkill")
			speed *= float(RK["slowdown"])
		else:
			if d < float(R["contactStop"]):
				speed = 0.0
				blocked = true
			else:
				speed = signf(speed) * minf(absf(speed), float(R["stopSpeed"]))
	return blocked

## Choc : secousse, bruit ; au-dessus du seuil les occupants se blessent (jamais mortel). kind : "prop", "wall" ou "moto" (voir crash de vehicles.js).
func crash(impact: float, kind: String, g: Object) -> void:
	var C: Dictionary = def["crash"] if def.has("crash") else Config.at("vehicles.crash")
	if impact < 3.0:
		return
	g.shake = maxf(float(g.shake), minf(1.0, impact / 22.0))
	events.append("crash:%.3f" % minf(1.0, impact / 20.0))
	var D: Dictionary = Config.at("vehicles.damage")
	var wear := 0.0 if kind == "moto" else maxf(0.0, impact - float(D["crashFree"])) * float(D["crashPerMs"]) * (float(D["wall"]) if kind == "wall" else 1.0)
	if wear > 0.0 and hit_t <= 0.0:
		hit_t = 0.5
		g.damage_vehicle(self, wear, "crash")
	if impact < float(C["minSpeed"]) or crash_t > 0.0:
		return
	crash_t = 0.8
	var dmg := minf(float(C["maxDamage"]), (impact - float(C["minSpeed"])) * float(C["damagePerMs"]))
	g.hurt_occupants(self, dmg)
