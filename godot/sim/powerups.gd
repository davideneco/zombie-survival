class_name Powerups
extends RefCounted
## Bonus lâchés par les zombies (Munitions max, Mort instantanée, Bombe, Points doubles), bidons d'essence et bonus d'ouverture de zone.
## Port de la section « Bonus (Power-ups COD) » de src/main.js (spawnPowerup, collectPowerup, ramassage dans update, openingBonus) et
## de maybeDropFuel / hostFuelPickup de src/vehicles.js. Code pur : `g` est l'hôte (autoload Game). Le tirage utilise le générateur
## `g.rng_loot`, distinct de celui des apparitions : activer les bonus ne change pas le déroulé des manches.

const TYPES: Array[String] = ["max_ammo", "insta_kill", "nuke", "double_points"]   ## main.js spawnPowerup : tirage uniforme

var items: Array[Dictionary] = []   ## { id, type, pos (Vector3 : x, z ; y = sol de l'étage), base_y, life, max_life }
var insta_kill := 0.0               ## secondes restantes de Mort instantanée
var double_points := 0.0            ## secondes restantes de Points doubles
var bonus_zones := {}               ## zones extérieures dont le bonus d'ouverture a déjà été posé
var collected: Array[String] = []   ## journal des bonus ramassés (tests, statistiques)
var _next_id := 1

func reset() -> void:
	items.clear()
	insta_kill = 0.0
	double_points = 0.0
	bonus_zones.clear()
	collected.clear()
	_next_id = 1

## x2 sous Points doubles.
func points_mult() -> int:
	return 2 if double_points > 0.0 else 1

func has_fuel() -> bool:
	for q in items:
		if q["type"] == "fuel":
			return true
	return false

## Pose un bonus au sol. type vide : tirage uniforme parmi les quatre bonus.
func spawn(g: Node, pos: Vector3, type := "") -> Dictionary:
	var t := type if type != "" else TYPES[g.rng_loot.randi() % TYPES.size()]
	var life := float(Config.at("powerups.duration"))
	var pu := {"id": _next_id, "type": t, "pos": pos, "base_y": maxf(0.0, pos.y) + Rules.POWERUP_HOVER, "life": life, "max_life": life}
	_next_id += 1
	items.append(pu)
	g.powerup_spawned.emit(pu)
	return pu

## Un zombie vient de mourir (hitZombie / areaDamage) : bidon d'essence (rare), puis bonus (le Bourreau lâche toujours Munitions max).
func on_kill(g: Node, z: ZombieSim) -> void:
	maybe_drop_fuel(g, z.pos)
	if z.is_angel:
		return   # l'Ange tourne hors de la tour : ses points suffisent
	if z.is_boss:
		spawn(g, z.pos, "max_ammo")
	elif g.rng_loot.randf() < float(Config.at("powerups.dropChance")):
		spawn(g, z.pos)

## Bidon d'essence : 3 % par zombie tué, seulement si une moto en état est sous 50 % de réservoir, un seul à la fois au sol.
func maybe_drop_fuel(g: Node, pos: Vector3) -> void:
	var F: Dictionary = Config.at("vehicles.fuel")
	if g.rng_loot.randf() >= float(F["dropChance"]):
		return
	if g.rides == null or has_fuel():
		return
	var need := false
	for v: VehicleSim in g.rides.vehicles:
		if v.usable() and v.has_tank() and v.fuel_frac() < float(F["dropBelow"]):
			need = true
			break
	if need:
		spawn(g, pos, "fuel")

## Bidon ramassé : +jerrican L à la moto du ramasseur, sinon à la moto la plus vide. Renvoie la moto.
func fuel_pickup(g: Node) -> VehicleSim:
	if g.rides == null:
		return null
	var F: Dictionary = Config.at("vehicles.fuel")
	var best: VehicleSim = null
	for v: VehicleSim in g.rides.vehicles:
		if v.usable() and v.has_tank() and v.seats.has(0):
			best = v
			break
	if best == null:
		for v: VehicleSim in g.rides.vehicles:
			if v.usable() and v.has_tank() and (best == null or v.fuel_frac() < best.fuel_frac()):
				best = v
	if best != null:
		best.fuel = clampf(best.fuel + float(F["jerrican"]), 0.0, float(best.def["tank"]))
	return best

## Effet du bonus ramassé (collectPowerup).
func collect(g: Node, pu: Dictionary) -> void:
	var t: String = pu["type"]
	collected.append(t)
	match t:
		"fuel":
			fuel_pickup(g)
			g.announce("ESSENCE !", ("Bidon : +%s L" % str(Config.at("vehicles.fuel.jerrican"))).replace(".", ","))
		"max_ammo":
			g.arms.max_ammo()
			g.announce("MUNITIONS MAX !", "Réserves pleines pour toute l’équipe")
		"insta_kill":
			insta_kill = float(Config.at("powerups.buffDuration"))
			g.announce("MORT INSTANTANÉE !", "%d secondes" % int(insta_kill))
		"nuke":
			g.announce("BOMBE !", "+%d points" % Rules.NUKE_POINTS)
			g.points += Rules.NUKE_POINTS
			g.points_gained.emit(Rules.NUKE_POINTS, "bonus")
			for z: ZombieSim in g.zombies:
				if z.dead or g.is_boss(z):
					continue
				z.damage(999999.0, false)
		"double_points":
			double_points = float(Config.at("powerups.buffDuration"))
			g.announce("POINTS DOUBLES !", "%d secondes" % int(double_points))
	g.powerup_collected.emit(t)

## Un pas : minuteries des bonus actifs, flottement, clignotement, ramassage et expiration (main.js update).
func step(g: Node, dt: float) -> void:
	insta_kill = maxf(0.0, insta_kill - dt)
	double_points = maxf(0.0, double_points - dt)
	var p: PlayerSim = g.player
	for i in range(items.size() - 1, -1, -1):
		var pu := items[i]
		pu["life"] = float(pu["life"]) - dt
		var pos: Vector3 = pu["pos"]
		var d := Vector2(p.pos.x - pos.x, p.pos.z - pos.z).length()
		if not p.dead and d < Rules.POWERUP_PICKUP_RANGE and absf(p.pos.y + 0.9 - float(pu["base_y"])) < Rules.POWERUP_PICKUP_DY:
			items.remove_at(i)
			collect(g, pu)
			g.powerup_removed.emit(pu)
		elif float(pu["life"]) <= 0.0:
			items.remove_at(i)
			g.powerup_removed.emit(pu)

## Première ouverture d'une zone extérieure : un bonus (CONFIG.powerups.openingBonus) apparaît à 3-9 m du milieu de la porte, côté nouvelle zone.
func opening_bonus(g: Node, d: Dictionary) -> void:
	if g.world == null:
		return
	var zones: Array = Config.at("sector.zones")
	for zi: int in d["opened"]:
		if zi >= zones.size() or not bool(zones[zi].get("outer", false)):
			continue
		if bonus_zones.has(zi):
			continue
		bonus_zones[zi] = true
		var list: Array = Config.at("powerups.openingBonus")
		var type: String = list[g.rng_loot.randi() % list.size()]
		var pts: Array = d["points"]
		var mid: Array = pts[pts.size() / 2]
		var spot := Vector3.INF
		var r: float = Rules.OPENING_BONUS_R0
		while r <= Rules.OPENING_BONUS_R1 and spot == Vector3.INF:
			var a := 0
			while a < Rules.OPENING_BONUS_ANGLES and spot == Vector3.INF:
				var x := float(mid[0]) + cos(float(a) / Rules.OPENING_BONUS_ANGLES * TAU) * r
				var z := float(mid[1]) + sin(float(a) / Rules.OPENING_BONUS_ANGLES * TAU) * r
				if g.world.zone_of(x, z) == zi and not g.world.nav.is_blocked_at(x, z):
					spot = Vector3(x, 0.0, z)
				a += 1
			r += Rules.OPENING_BONUS_RSTEP
		if spot == Vector3.INF:
			var c: Dictionary = g.world.objects["zones"][zi].get("center", {})
			spot = Vector3(float(c["x"]), 0.0, float(c["z"])) if not c.is_empty() else Vector3(float(mid[0]), 0.0, float(mid[1]))
		spawn(g, spot, type)
