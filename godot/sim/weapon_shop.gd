class_name WeaponShop
extends RefCounted
## Achats d'armes : armes murales (achat, puis munitions au prix x papAmmoMult) et bornes de munitions. Port de la partie armes de
## Game.interact / nearWallWeapon / nearStation de src/main.js. Les données viennent du monde cuit (objects.json) ; l'arène n'en a pas.

const WALL_RANGE := 2.8      ## main.js nearWallWeapon
const STATION_RANGE := 3.2   ## main.js nearStation

static func near_wall_weapon(g: Node) -> Dictionary:
	if g.world == null:
		return {}
	var p: Vector3 = g.player.pos
	for ww: Dictionary in g.world.objects.get("wallWeapons", []):
		if Vector2(p.x - float(ww["pos"]["x"]), p.z - float(ww["pos"]["z"])).length() < WALL_RANGE:
			return ww
	return {}

static func near_station(g: Node) -> bool:
	var p: Vector3 = g.player.pos
	if g.world == null:   # arène : une seule borne (main.js : world.stationPos)
		return Vector2(p.x - g.arena.station_pos.x, p.z - g.arena.station_pos.z).length() < STATION_RANGE
	for s: Dictionary in g.world.objects.get("stations", []):
		if Vector2(p.x - float(s["x"]), p.z - float(s["z"])).length() < STATION_RANGE:
			return true
	return false

## Touche d'interaction : borne de munitions, puis arme murale. Renvoie true si l'appui a été consommé (même sans achat).
static func interact(g: Node) -> bool:
	var arms: WeaponArms = g.arms
	if near_station(g):
		var w := arms.current
		if w.reserve >= int(w.cfg["maxReserve"]):
			return true
		var price := int(w.cfg["ammoPrice"])
		if g.points < price:
			g.purchase_denied.emit(price)
		else:
			g.points -= price
			w.refill()
		return true
	if g.machines != null and g.machines.interact():   # main.js interact, 3 : atouts, Pack-a-Punch, boîte mystère
		return true
	var ww := near_wall_weapon(g)
	if ww.is_empty():
		return false
	var id := String(ww["id"])
	for w in arms.inventory:
		if w.id == id:
			if w.reserve >= int(w.cfg["maxReserve"]):
				return true
			var price := int(round(float(ww["ammoPrice"]) * Pap.pap_ammo_mult(w.pap)))
			if g.points < price:
				g.purchase_denied.emit(price)
			else:
				g.points -= price
				w.refill()
			return true
	var cost := int(ww["price"])
	if g.points < cost:
		g.purchase_denied.emit(cost)
	else:
		g.points -= cost
		arms.give_weapon(id)
		g.weapon_acquired.emit(id)
	return true
