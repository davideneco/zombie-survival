class_name Unstick
extends RefCounted
## Se débloquer (port de src/unstick.js) : si le joueur est coincé (touche de déplacement maintenue `stuckAfter` s sans avancer de `moveMin` m,
## ou position dans une poche fermée depuis `trapAfter` s), l'invite « K Maintenir 2 s : se débloquer » apparaît. Maintenir la touche
## `holdTime` s déplace le joueur sur la case libre la plus proche de la composante principale de la grille de navigation, dans une zone
## OUVERTE et à moins de `maxDist` m ; sinon au centre de sa zone. Recharge `cooldown` s ; impossible en moto, à terre, à l'étage.
## Pure simulation : pas de nœud, `step(g, dt, input)` à chaque pas fixe (input : { mx, mz, unstick }).

signal done(from: Vector2, to: Vector2, distance: float, center: bool)

var t := 0.0                  ## temps de touche maintenue sans progrès
var ref := Vector2.ZERO       ## point de référence du progrès
var trap_t := 0.0             ## temps passé dans une poche
var trap_check := 0.0
var stuck := false
var hold_t := 0.0
var cool := 0.0
var log: PackedStringArray = []
var unstuck_count := 0

## Étiquette de la case de (x, z) : composante de la case libre la plus proche (à moins de 1 m), 0 = aucune.
func label_at(nav: NavGrid, x: float, z: float) -> int:
	var labels: PackedInt32Array = nav.components()["labels"]
	var ix := nav.cx(x)
	var iz := nav.cz(z)
	var r := ceili(1.0 / nav.cell)
	var best := 0
	var bd := INF
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var jx := ix + dx
			var jz := iz + dz
			if not nav.inside(jx, jz):
				continue
			var l := labels[nav.idx(jx, jz)]
			if l == 0:
				continue
			var d := float(dx * dx + dz * dz)
			if d < bd:
				bd = d
				best = l
	return best

## Composante principale : celle de la case de départ (sinon la plus grande).
func main_label(world: World) -> int:
	var nav := world.nav
	var comp := nav.components()
	var labels: PackedInt32Array = comp["labels"]
	var sizes: Array = comp["sizes"]
	var l := labels[nav.idx(nav.cx(world.start_pos.x), nav.cz(world.start_pos.z))]
	if l != 0:
		return l
	var best := 1
	for i in range(2, sizes.size()):
		if int(sizes[i]) > int(sizes[best]):
			best = i
	return best

## Case d'arrivée : libre, de la composante principale, zone ouverte, sans poussée de collision, la plus proche à moins de maxDist m.
## Renvoie { x, z, d, center? } ou {}.
func find_spot(world: World, x: float, z: float) -> Dictionary:
	var nav := world.nav
	var max_dist := float(Config.at("unstick.maxDist"))
	var radius := float(Config.at("player.radius"))
	var labels: PackedInt32Array = nav.components()["labels"]
	var main := main_label(world)
	var ix0 := nav.cx(x)
	var iz0 := nav.cz(z)
	var max_r := ceili(max_dist / nav.cell)
	for r in range(0, max_r + 1):
		var best: Dictionary = {}
		var bd := INF
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dz)) != r:
					continue
				var jx := ix0 + dx
				var jz := iz0 + dz
				if not nav.inside(jx, jz) or labels[nav.idx(jx, jz)] != main:
					continue
				var wx := nav.world_x(jx)
				var wz := nav.world_z(jz)
				var d := Vector2(wx - x, wz - z).length()
				if d > max_dist or d >= bd:
					continue
				var zi := world.zone_of(wx, wz)
				if zi < 0 or not world.is_zone_open(zi):
					continue
				var q := world.collision.resolve(Vector3(wx, 0.0, wz), radius)
				if Vector2(q.x - wx, q.z - wz).length() > 0.05:
					continue
				bd = d
				best = {"x": wx, "z": wz, "d": d}
		if not best.is_empty():
			return best
	# rien d'accessible à moins de maxDist m : centre de la zone (si elle est ouverte), sinon de la zone ouverte la plus proche
	var zi := world.zone_of(x, z)
	var zones: Array = world.objects["zones"]
	var zc: Variant = null
	if zi >= 0 and world.is_zone_open(zi):
		zc = zones[zi]["center"]
	if zc == null:
		var bd2 := INF
		for i in zones.size():
			var c: Variant = zones[i].get("center")
			if c != null and world.is_zone_open(i):
				var d2 := Vector2(float(c["x"]) - x, float(c["z"]) - z).length()
				if d2 < bd2:
					bd2 = d2
					zc = c
	if zc == null:
		return {}
	return {"x": float(zc["x"]), "z": float(zc["z"]), "d": Vector2(float(zc["x"]) - x, float(zc["z"]) - z).length(), "center": true}

## Déplace le joueur (appel après `stuck` et la touche maintenue). Renvoie true si le joueur a été déplacé.
func trigger(g: Node) -> bool:
	var p: PlayerSim = g.player
	if cool > 0.0 or p.downed or p.dead or p.region != 0:
		return false
	var spot: Dictionary = {}
	var from := Vector2(p.pos.x, p.pos.z)
	if g.rides != null and g.rides.on_tram != null:
		# coincé dans une rame : replacé dans l'allée, au plus près (repère local de la rame, jamais hors de la caisse)
		var O: Dictionary = g.rides.on_tram
		g.rides.place_in_tram(O["v"], float(O["u"]), 0.0)
		spot = {"x": p.pos.x, "z": p.pos.z, "d": 0.0, "tram": true}
	else:
		spot = find_spot(g.world, p.pos.x, p.pos.z)
		if spot.is_empty():
			return false
		p.pos = Vector3(float(spot["x"]), 0.0, float(spot["z"]))
		p.vel = Vector3.ZERO
		p.vy = 0.0
	cool = float(Config.at("unstick.cooldown"))
	stuck = false
	t = 0.0
	trap_t = 0.0
	hold_t = 0.0
	ref = Vector2(p.pos.x, p.pos.z)
	unstuck_count += 1
	var line := "%d s : débloqué de (%.2f ; %.2f) vers (%.1f ; %.1f), %.1f m%s" % [int(g.time), from.x, from.y, float(spot["x"]), float(spot["z"]), float(spot["d"]), " (centre de zone)" if spot.has("center") else (" (rame)" if spot.has("tram") else "")]
	log.append(line)
	if log.size() > 50:
		log.remove_at(0)
	done.emit(from, Vector2(p.pos.x, p.pos.z), float(spot["d"]), spot.has("center"))
	return true

func step(g: Node, dt: float, input: Dictionary) -> void:
	var p: PlayerSim = g.player
	cool = maxf(0.0, cool - dt)
	var ok: bool = g.playing and not g.over and not (g.rides != null and g.rides.ride != null) and not p.downed and not p.dead and p.vault.is_empty() and p.region == 0 and g.world != null
	if not ok:
		t = 0.0
		trap_t = 0.0
		stuck = false
		hold_t = 0.0
		return
	var held := float(input.get("mx", 0.0)) != 0.0 or float(input.get("mz", 0.0)) != 0.0
	var here := Vector2(p.pos.x, p.pos.z)
	if not held or here.distance_to(ref) >= float(Config.at("unstick.moveMin")):
		t = 0.0
		ref = here
	else:
		t += dt
	trap_check -= dt
	if trap_check <= 0.0:
		trap_check = 0.5
		var nav: NavGrid = g.world.nav
		var main := main_label(g.world)
		var l := main if g.rides != null and g.rides.on_tram != null else label_at(nav, p.pos.x, p.pos.z)
		# seules les petites poches comptent : l'intérieur de la cathédrale, par exemple, forme de grandes composantes séparées de la ville
		var sizes: Array = nav.components()["sizes"]
		var small := l != main and (l == 0 or float(sizes[l]) * nav.cell * nav.cell < float(Config.at("unstick.pocketMaxArea")))
		trap_t = trap_t + 0.5 if small else 0.0
	stuck = t >= float(Config.at("unstick.stuckAfter")) or trap_t >= float(Config.at("unstick.trapAfter"))
	if stuck and bool(input.get("unstick", false)):
		hold_t += dt
		if hold_t >= float(Config.at("unstick.holdTime")):
			if not trigger(g):
				hold_t = 0.0
	else:
		hold_t = 0.0

## Invite à afficher (ou "") ; `tag` : texte de la touche (« [K] »).
func prompt(tag: String) -> String:
	if not stuck:
		return ""
	if cool > 0.0:
		return "Déblocage disponible dans %d s" % ceili(cool)
	var hold := float(Config.at("unstick.holdTime"))
	if hold_t > 0.0:
		return "%s Maintenir pour se débloquer (%.1f s)" % [tag, maxf(0.0, hold - hold_t)]
	return "%s Maintenir %s s : se débloquer" % [tag, str(int(hold)) if hold == floorf(hold) else str(hold)]
