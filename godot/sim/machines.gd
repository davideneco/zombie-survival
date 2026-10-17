class_name Machines
extends RefCounted
## Machines de la carte (objects.json « machines ») : distributeurs d'atouts, boîte mystère, Pack-a-Punch (et l'horloge de la finale, J10).
## Port de nearMachine / machinePrompt / useMachine / perkPrice de src/main.js. Le conteneur des états de la boîte et du Pack-a-Punch.

var list: Array = []
var box: MysteryBox
var pap: PackAPunch
var g: Node

func _init(g_: Node, objs: Array) -> void:
	g = g_
	list = objs
	box = MysteryBox.new(objs, g.world.start_zone, g)
	pap = PackAPunch.new(objs)

## Machine à portée (2,6 m) ; seule la boîte active compte, et pas pendant son déplacement.
func near() -> Dictionary:
	var p: Vector3 = g.player.pos
	for m: Dictionary in list:
		if m["type"] == "box" and (m != box.active_box() or not box.move.is_empty()):
			continue
		if Vector2(p.x - float(m["pos"]["x"]), p.z - float(m["pos"]["z"])).length() < Rules.MACHINE_RANGE:
			return m
	return {}

## Prix d'un atout : en solo la Réanimation rapide coûte `soloPrice`.
static func perk_price(id: String) -> int:
	var P: Dictionary = Config.at("perks.%s" % id)
	return int(P["soloPrice"]) if P.has("soloPrice") else int(P["price"])

func prompt() -> String:
	if g.player.downed or g.player.dead:
		return ""
	var m := near()
	if m.is_empty():
		return ""
	match String(m["type"]):
		"perk":
			if g.arms.perks.get(m["id"], false):
				return "%s (déjà acquis)" % m["name"]
			return "E %s — %s (%d pts)" % [m["name"], Config.at("perks.%s.desc" % m["id"]), perk_price(m["id"])]
		"pap":
			return pap.prompt(g)
		"box":
			return box.prompt(g, m)
	return ""

## Touche d'interaction sur une machine. Renvoie true si l'appui est consommé.
func interact() -> bool:
	var m := near()
	if m.is_empty():
		return false
	match String(m["type"]):
		"perk":
			var id: String = m["id"]
			if g.arms.perks.get(id, false):
				return true
			var price := perk_price(id)
			if g.points < price:
				g.purchase_denied.emit(price)
				return true
			g.points -= price
			g.add_perk(id)
			g.announce(String(m["name"]), String(Config.at("perks.%s.desc" % id)))
			return true
		"pap":
			if pap.busy():
				pap.take(g)
			else:
				pap.buy(g)
			return true
		"box":
			if not box.roll.is_empty() and m == box.active_box():
				box.take(g)
			else:
				box.buy(g)
			return true
	return false

func step(dt: float) -> void:
	box.step(g, dt)
	pap.step(g, dt)
