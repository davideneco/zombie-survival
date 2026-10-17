class_name WeaponBlast
extends RefCounted
## Projectiles et explosions : obus du M79 (src/launcher.js), grenades à main (main.js : throwGrenade / updateGrenades), explosion de zone
## (explode / areaDamage / splash de main.js). Code pur : `g` est l'hôte (autoload Game), avec zombies, collision, world, player, rng.

const NADE_GRAVITY := 18.0       ## main.js updateGrenades : G
const NADE_BOUNCE_WALL := 1.6    ## rebond sur un mur : v -= 1.6 (v . n) n
const NADE_FLOOR_OFFSET := 0.09
const NADE_FLOOR_RESTITUTION := 0.35
const NADE_FLOOR_FRICTION := 0.6
const NADE_STOP_VY := 0.6
const NADE_RADIUS := 0.12        ## rayon de collision d'une grenade contre les murs
const NADE_THROW_SPEED := 15.0   ## player.js throwGrenade
const NADE_THROW_LIFT := 3.0
const NADE_THROW_FWD := 0.6
const SHELL_STEP := 0.02         ## pas maximal d'intégration d'un obus (launcher.js : 20 ms)
const SHELL_HIT_R2 := 0.25       ## zombie = cylindre de rayon 0,5 m, du sol à 1,9 m (launcher.js zombieHit)
const SHELL_HIT_TOP := 1.9
const SHELL_HIT_BOTTOM := -0.1
const BLAST_VERTICAL := 2.5      ## main.js areaDamage : pas à travers un plafond ou un plancher
const BLAST_FALLOFF_POW := 0.6   ## dégâts de zone x (1 - d / rayon)^0,6

var shells: Array[Dictionary] = []   ## { pos, vel, age, dist, pap, mine }
var nades: Array[Dictionary] = []    ## { pos, vel, t }

func reset() -> void:
	shells.clear()
	nades.clear()

# ---------------------------------------------------------------- obus (launcher.js)
func launch_shell(origin: Vector3, vel: Vector3, pap: int = 0) -> void:
	shells.append({"pos": origin, "vel": vel, "age": 0.0, "dist": 0.0, "pap": clampi(pap, 0, 3), "mine": true})

## Statistiques de l'obus selon le niveau (0 : obus ordinaire du M79).
static func shell_stats(pap: int) -> Dictionary:
	var base := Config.weapon("m79")
	return Pap.pap_stats(base, pap) if pap > 0 else base

static func _shell_hit(g: Node, a: Vector3, d: Vector3, length: float) -> Dictionary:
	var best := {}
	for z: ZombieSim in g.zombies:
		if z.dead:
			continue
		var dx := z.pos.x - a.x
		var dz := z.pos.z - a.z
		var h2 := d.x * d.x + d.z * d.z
		var t := (dx * d.x + dz * d.z) / h2 if h2 > 1e-9 else 0.0
		t = clampf(t, 0.0, length)
		var px := a.x + d.x * t - z.pos.x
		var pz := a.z + d.z * t - z.pos.z
		var py := a.y + d.y * t - z.pos.y
		if px * px + pz * pz > SHELL_HIT_R2 or py < SHELL_HIT_BOTTOM or py > SHELL_HIT_TOP:
			continue
		if best.is_empty() or t < best["t"]:
			best = {"z": z, "t": t}
	return best

func update_shells(g: Node, dt: float) -> void:
	var C: Dictionary = Config.weapon("m79")["proj"]
	for i in range(shells.size() - 1, -1, -1):
		var s := shells[i]
		var done := false
		var n := maxi(1, ceili(dt / SHELL_STEP))
		var h := dt / n
		for _k in n:
			var vel: Vector3 = s["vel"]
			vel.y -= float(C["gravity"]) * h
			s["vel"] = vel
			var length: float = vel.length() * h
			var d: Vector3 = vel.normalized()
			var a: Vector3 = s["pos"]
			var t: float = g.collision.ray_hit(a.x, a.y, a.z, d.x, d.y, d.z, length)
			var victim: ZombieSim = null
			var zh := _shell_hit(g, a, d, minf(t, length))
			if not zh.is_empty() and zh["t"] <= t:
				t = zh["t"]
				victim = zh["z"]
			s["age"] += h
			if t < length - 1e-6 or victim != null:
				s["dist"] += t
				_shell_impact(g, s, a + d * t, victim)
				done = true
				break
			s["pos"] = a + d * length
			s["dist"] += length
			if s["age"] >= float(C["fuse"]):
				_shell_impact(g, s, s["pos"], null)
				done = true
				break
		if done:
			shells.remove_at(i)

## Impact : armé -> explosion ; pas armé -> coup direct sur un zombie touché, sinon rien.
func _shell_impact(g: Node, s: Dictionary, at: Vector3, victim: ZombieSim) -> void:
	var st := shell_stats(int(s["pap"]))
	if float(s["dist"]) >= float(Config.weapon("m79")["proj"]["arm"]):
		var b: Dictionary = st["blast"]
		explode(g, at, float(b["radius"]), float(b["damage"]), int(b["color"]), float(b["self"]) if bool(s["mine"]) else 0.0)
	elif victim != null:
		g.hit_zombie(victim, false, float(st["damage"]), 1.0)

# ---------------------------------------------------------------- grenades à main
func throw_grenade(origin: Vector3, vel: Vector3) -> void:
	nades.append({"pos": origin, "vel": vel, "t": float(Config.at("grenade.fuse"))})

func update_nades(g: Node, dt: float) -> void:
	var G: Dictionary = Config.at("grenade")
	var fl := {"y": 0.0, "region": 0}
	for i in range(nades.size() - 1, -1, -1):
		var n := nades[i]
		n["t"] -= dt
		var v: Vector3 = n["vel"]
		v.y -= NADE_GRAVITY * dt
		var p: Vector3 = n["pos"] + v * dt
		# rebond sur les murs : la normale vient de la poussée de la collision
		var pushed: Vector3 = g.collision.resolve(p, NADE_RADIUS)
		var nx := pushed.x - p.x
		var nz := pushed.z - p.z
		var l := sqrt(nx * nx + nz * nz)
		if l > 1e-4:
			var ux := nx / l
			var uz := nz / l
			var dot: float = v.x * ux + v.z * uz
			if dot < 0.0:
				v.x -= NADE_BOUNCE_WALL * dot * ux
				v.z -= NADE_BOUNCE_WALL * dot * uz
			p.x = pushed.x
			p.z = pushed.z
		var gy := NADE_FLOOR_OFFSET
		if g.world != null:
			gy = g.world.floor_at(p.x, p.z, p.y + 0.3, fl)["y"] + NADE_FLOOR_OFFSET
		if p.y < gy:
			p.y = gy
			v.y = absf(v.y) * NADE_FLOOR_RESTITUTION
			v.x *= NADE_FLOOR_FRICTION
			v.z *= NADE_FLOOR_FRICTION
			if v.y < NADE_STOP_VY:
				v.y = 0.0
		n["vel"] = v
		n["pos"] = p
		if n["t"] <= 0.0:
			nades.remove_at(i)
			explode(g, p, float(G["radius"]), float(G["damage"]), 0xff8a2a, float(G["selfDamage"]))

# ---------------------------------------------------------------- explosions
## Explosion : effet, dégâts au tireur (self = dégâts maximaux, décroissants avec la distance horizontale) puis dégâts de zone aux zombies.
func explode(g: Node, pos: Vector3, radius: float, damage: float, color: int, self_damage: float = 0.0) -> void:
	g.explosion.emit(pos, radius, color)
	var p: PlayerSim = g.player
	var d := Vector2(p.pos.x - pos.x, p.pos.z - pos.z).length()
	if self_damage > 0.0 and d < radius and not p.dead:
		g.hurt_player(self_damage * (1.0 - d / radius), "blast")
	area_damage(g, pos, radius, damage)
	if g.rides != null:   # main.js explode : les motos subissent 10 % des dégâts infligés aux zombies (pas le splash des armes)
		g.rides.damage_in_radius(pos, radius, damage)

## Impact explosif d'une arme (pistolet à rayons, carreau explosif, balles explosives, Éther) : pas de dégâts au tireur.
func splash(g: Node, point: Vector3, radius: float, damage: float, color: int = 0x44ff66) -> void:
	g.explosion.emit(point, radius, color)
	area_damage(g, point, radius, damage)

## Dégâts de zone sur les zombies (areaDamage) ; les survivants peuvent perdre leurs jambes (si le zombie sait ramper : J3).
func area_damage(g: Node, pos: Vector3, radius: float, damage: float) -> void:
	var kills := 0
	var pts := 0
	var leg: float = float(Config.at("zombie.legBlowChance", 0.0))
	for z: ZombieSim in g.zombies:
		if z.dead:
			continue
		var d := Vector2(z.pos.x - pos.x, z.pos.z - pos.z).length()
		if d > radius:
			continue
		if absf(z.pos.y + 1.0 - pos.y) > BLAST_VERTICAL:
			continue
		var dmg := damage * pow(1.0 - d / radius, BLAST_FALLOFF_POW)
		var killed := z.damage(dmg, false)
		if killed:
			kills += 1
			pts += Rules.POINTS_KILL
			g.zombie_killed.emit(z, false)
		else:
			pts += Rules.POINTS_HIT
			if z.has_method("make_crawler") and g.rng.randf() < leg:
				z.make_crawler()
	if pts > 0:
		g.kills += kills
		g.points += pts
