class_name MysteryBox
extends RefCounted
## Boîte mystère : une seule boîte active parmi les 19 emplacements de la carte, qui se déplace quand le tirage donne le nounours.
## Port de la logique de src/machineFx.js (hostBoxRoll, startBoxRoll, updateBoxRoll, takeBoxWeapon, buyBox, boxPrompt) et de src/main.js
## (countBoxUse, hostMoveBox, startBoxMove, updateBoxMove, resetBox). Le chronométrage est celui du JS (la vue lit `roll` et `move`).
## `g` est l'hôte (autoload Game). Le tirage utilise g.rng_loot.

var boxes: Array = []        ## machines de type « box » (objects.json), dans l'ordre de la carte
var active := 0              ## indice de la boîte active
var uses := 0                ## tirages depuis son arrivée
var limit := 10              ## au tirage numéro `limit`, c'est le nounours
var roll: Dictionary = {}    ## tirage en cours : { phase "roll"|"teddy"|"offer"|"sink", t, age, result, teddy, offer_t, taken, pool: Array }
var move: Dictionary = {}    ## déplacement en cours : { t, from, next }
var stay_alone := false      ## v0.26.0 (Zone unique) : sans autre emplacement ouvert, le nounours remet le compteur à zéro (la boîte reste) ;
                             ## faux en Classique : comportement du JS (le nounours revient à chaque tirage tant qu'aucune porte n'est ouverte)

func _init(machines: Array, start_zone: int, g: Node) -> void:
	for m: Dictionary in machines:
		if m["type"] == "box":
			boxes.append(m)
	reset(start_zone, g)

func reset(start_zone: int, g: Node) -> void:
	active = 0
	for i in boxes.size():
		if int(boxes[i]["zone"]) == start_zone:
			active = i
			break
	uses = 0
	limit = _new_limit(g)
	roll = {}
	move = {}

func _new_limit(g: Node) -> int:
	return 1 + int(floor(g.rng_loot.randf() * float(Config.at("box.maxUses"))))

func active_box() -> Dictionary:
	return boxes[active] if not boxes.is_empty() else {}

func price() -> int:
	return int(Config.at("box.price"))

func busy() -> bool:
	return not roll.is_empty() or not move.is_empty()

## Tirage pondéré (machineFx.js hostBoxRoll) : r dans [0, 1) ; les armes déjà portées sont exclues.
static func pick(owned: Array, r: float) -> String:
	var pool: Dictionary = Config.at("box.pool")
	var ids: Array = []
	var total := 0.0
	for id: String in pool:
		if not owned.has(id):
			ids.append(id)
			total += float(pool[id])
	var res: String = ids[0] if not ids.is_empty() else "smg"
	var x := r * total
	for id: String in ids:
		x -= float(pool[id])
		if x <= 0.0:
			res = id
			break
	return res

## Achat d'un tirage : on paie tout de suite. Renvoie false si la boîte est occupée ou les points manquent.
func buy(g: Node) -> bool:
	if busy() or boxes.is_empty():
		return false
	if g.points < price():
		g.purchase_denied.emit(price())
		return false
	g.points -= price()
	var owned: Array = []
	for w in g.arms.inventory:
		owned.append(w.id)
	var result := pick(owned, g.rng_loot.randf())
	uses += 1
	var teddy := uses >= limit
	roll = {"phase": "roll", "t": 0.0, "age": 0.0, "result": result, "teddy": teddy, "offer_t": 0.0, "taken": false}
	g.box_event.emit("roll", roll)
	return true

## E pendant la proposition : prend l'arme.
func take(g: Node) -> bool:
	if roll.is_empty() or roll["phase"] != "offer" or roll["taken"] or float(roll["offer_t"]) <= 0.0:
		return false
	roll["taken"] = true
	var id: String = roll["result"]
	roll = {}
	g.arms.give_weapon(id)
	g.weapon_acquired.emit(id)
	g.box_event.emit("taken", {"result": id})
	return true

func prompt(g: Node, m: Dictionary) -> String:
	if not roll.is_empty():
		if m == active_box() and roll["phase"] == "offer":
			var cfg := Config.weapon(roll["result"])
			var swap: bool = g.arms.inventory.size() >= g.arms.max_weapons() and not g.arms.has_weapon(roll["result"])
			return "E Prendre %s — %d s%s" % [cfg["name"], ceili(roll["offer_t"]), " (remplace l’arme en main)" if swap else ""]
		return "La boîte mystère tourne…"
	var full: bool = g.arms.inventory.size() >= g.arms.max_weapons()
	return "E Boîte mystère : arme au hasard (%d pts)%s" % [price(), " — remplace l’arme en main" if full else ""]

func step(g: Node, dt: float) -> void:
	if not move.is_empty():
		move["t"] = float(move["t"]) + dt
		if float(move["t"]) >= Rules.BOX_MOVE_TIME:
			active = int(move["next"])
			move = {}
			var nb := active_box()
			g.announce("BOÎTE MYSTÈRE", "Elle est réapparue : %s" % g.world.zone_names[int(nb["zone"])])
			g.box_event.emit("arrived", nb)
	if roll.is_empty():
		return
	var r := roll
	r["age"] = float(r["age"]) + dt
	match String(r["phase"]):
		"roll":
			r["t"] = float(r["t"]) + dt
			if float(r["t"]) >= float(Config.at("box.spin")):
				r["t"] = 0.0
				if r["teddy"]:
					r["phase"] = "teddy"
				else:
					r["phase"] = "offer"
					r["offer_t"] = float(Config.at("box.offerTime"))
				g.box_event.emit(String(r["phase"]), r)
		"teddy":
			r["t"] = float(r["t"]) + dt
			if float(r["t"]) >= Rules.BOX_TEDDY_TIME:
				roll = {}
				g.points += price()   # remboursé
				g.announce("NOUNOURS !", "La boîte mystère s’en va… (remboursé)")
				_host_move(g)
		"offer":
			r["offer_t"] = float(r["offer_t"]) - dt
			if float(r["offer_t"]) <= 0.0:
				r["phase"] = "sink"
				r["t"] = 0.0
		"sink":   # l'arme n'a pas été prise : elle retombe dans la boîte, le couvercle se ferme
			r["t"] = float(r["t"]) + dt
			if float(r["t"]) >= Rules.BOX_SINK_TIME:
				roll = {}

## hostMoveBox : prochaine boîte au hasard parmi les emplacements des zones ouvertes, jamais au même endroit.
func _host_move(g: Node) -> void:
	if boxes.size() < 2:
		if stay_alone:
			uses = 0
			limit = _new_limit(g)
		return
	var open: Array = []
	for i in boxes.size():
		if i != active and (g.world == null or g.world.is_zone_open(int(boxes[i]["zone"]))):
			open.append(i)
	if open.is_empty():
		if stay_alone:
			uses = 0
			limit = _new_limit(g)
		return
	var nxt: int = open[g.rng_loot.randi() % open.size()]
	uses = 0
	limit = _new_limit(g)
	move = {"t": 0.0, "from": active, "next": nxt}
	g.box_event.emit("leaving", move)
