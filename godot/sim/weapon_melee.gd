class_name WeaponMelee
extends RefCounted
## Couteau et Hache du Bourreau (CONFIG.knife ; Player.melee / meleeStrike de src/player.js, meleeDamage de src/main.js).
## Fonctions pures : l'état du coup (minuterie, fente) est tenu par WeaponArms.

const LUNGE_STOP := 0.9          ## player.js melee : la fente s'arrête à 0,9 m du zombie
const LUNGE_FRONT_COS := 0.6     ## le zombie doit être devant (produit scalaire > 0,6)
const CONE_VERTICAL := 1.6       ## écart de hauteur maximal d'une cible au corps à corps
const CONE_WALL_SLACK := 0.4
const RAY_EXTRA := 0.4           ## portée du rayon central : range + 0,4
const CHEST_Y := 1.1             ## point visé quand on touche par le cône

## Dégâts d'un coup sur un zombie ordinaire : max(minDamage, healthFrac x santé de la manche), tête ou dos x weakMult (non cumulés), hache x dmgMult.
static func damage(round_number: int, head: bool, back: bool, has_axe: bool) -> float:
	var K: Dictionary = Config.at("knife")
	var ax := float(K["axe"]["dmgMult"]) if has_axe else 1.0
	var base := maxf(float(K["minDamage"]), float(K["healthFrac"]) * float(Game.zombie_health_at(round_number)))
	return base * (float(K["weakMult"]) if head or back else 1.0) * ax

## Zombie visé par le coup : { z, head } ou {}. Rayon central (tête ou corps) d'abord, sinon le plus proche dans le cône horizontal.
static func pick_target(p: PlayerSim, zombies: Array, col: Collision) -> Dictionary:
	var K: Dictionary = Config.at("knife")
	var rng_ := float(K["range"])
	var ro := p.shot_eye()
	var rd := p.forward()
	var wall_t := col.ray_hit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, rng_ + 0.5)
	var best_t := INF
	var best := {}
	for z: ZombieSim in zombies:
		if z.dead:
			continue
		var h := Hitscan.ray_zombie(ro, rd, minf(wall_t, rng_ + RAY_EXTRA), z)
		if not h.is_empty() and h["t"] < best_t:
			best_t = h["t"]
			best = {"z": z, "head": h["head"]}
	if not best.is_empty():
		return best
	var cl := sqrt(rd.x * rd.x + rd.z * rd.z)
	if cl < 1e-9:
		cl = 1.0
	var cos_max := cos(deg_to_rad(float(K["cone"])))
	var bd := INF
	for z: ZombieSim in zombies:
		if z.dead:
			continue
		var dx := z.pos.x - p.pos.x
		var dz := z.pos.z - p.pos.z
		var d := sqrt(dx * dx + dz * dz)
		if d > rng_ + RAY_EXTRA or d >= bd or absf(z.pos.y - p.pos.y) > CONE_VERTICAL:
			continue
		if (dx * rd.x + dz * rd.z) / ((d * cl) if d * cl > 0.0 else 1.0) < cos_max:
			continue
		if d > 0.5 and col.ray_hit(ro.x, ro.y, ro.z, dx / d, (z.pos.y + CHEST_Y - ro.y) / d, dz / d, d) < d - CONE_WALL_SLACK:
			continue   # un mur les sépare
		bd = d
		best = {"z": z, "head": false}
	return best

## Le joueur est-il dans le dos du zombie ? (cap du zombie : (sin yaw, cos yaw))
static func is_back(p: PlayerSim, z: ZombieSim) -> bool:
	var dx := p.pos.x - z.pos.x
	var dz := p.pos.z - z.pos.z
	var dl := sqrt(dx * dx + dz * dz)
	if dl < 1e-9:
		dl = 1.0
	return (dx * sin(z.yaw) + dz * cos(z.yaw)) / dl < float(Config.at("knife.backCos"))

## Zombie le plus proche devant le joueur à moins de lungeNear m : distance, ou -1.
static func lunge_target(p: PlayerSim, zombies: Array) -> float:
	var K: Dictionary = Config.at("knife")
	var fx := -sin(p.yaw)
	var fz := -cos(p.yaw)
	var bd := float(K["lungeNear"])
	var found := -1.0
	for z: ZombieSim in zombies:
		if z.dead:
			continue
		var dx := z.pos.x - p.pos.x
		var dz := z.pos.z - p.pos.z
		var d := sqrt(dx * dx + dz * dz)
		if d < bd and (dx * fx + dz * fz) / (d if d > 0.0 else 1.0) > LUNGE_FRONT_COS:
			bd = d
			found = d
	return found
