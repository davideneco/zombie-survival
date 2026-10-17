class_name PackAPunch
extends RefCounted
## Pack-a-Punch : l'arme en main entre dans la machine, qui l'améliore d'un niveau (0 -> I -> II -> III, chacun avec son prix).
## Port de buyPap / startPapAnim / updatePap / takePap / papPrompt de src/machineFx.js. L'arme est confisquée pendant l'amélioration
## (WeaponArms.locked) ; si on ne vient pas la reprendre dans CONFIG.pap.offerTime, elle est rendue automatiquement.

var machine: Dictionary = {}   ## la machine « pap » de la carte (objects.json), vide dans l'arène
var anim: Dictionary = {}      ## { phase "in"|"work"|"out"|"offer", t, age, w, lv, idx }

func _init(machines: Array) -> void:
	for m: Dictionary in machines:
		if m["type"] == "pap":
			machine = m

func busy() -> bool:
	return not anim.is_empty()

func max_level() -> int:
	return Config.pap_levels.size() - 1

## Niveau visé pour l'arme en main (0 : déjà au maximum).
func next_level(g: Node) -> int:
	var lv: int = g.arms.current.pap + 1
	return lv if lv <= max_level() else 0

func price_of(lv: int) -> int:
	return int(Config.pap_levels[lv]["price"])

func buy(g: Node) -> bool:
	var lv := next_level(g)
	if busy() or lv == 0:
		return false
	var price := price_of(lv)
	if g.points < price:
		g.purchase_denied.emit(price)
		return false
	g.points -= price
	g.arms.locked = true
	anim = {"phase": "in", "t": 0.0, "age": 0.0, "w": g.arms.current.id, "lv": lv, "idx": g.arms.idx}
	g.pap_event.emit("start", anim)
	return true

## E pendant la proposition (ou temps écoulé : auto) : l'arme améliorée est rendue.
func take(g: Node, auto := false) -> bool:
	if anim.is_empty() or anim["phase"] != "offer":
		return false
	var arms: WeaponArms = g.arms
	var idx: int = anim["idx"]
	arms.locked = false
	if idx < arms.inventory.size():
		arms.switch_weapon(idx)
	arms.upgrade_current()
	var lv_name := "niveau %s" % String(Config.pap_levels[arms.current.pap]["roman"])
	anim = {}
	g.announce(String(arms.current.cfg.get("name", "")), ("Arme améliorée (%s) : reprise automatiquement" if auto else "Arme améliorée au Pack-a-Punch ! (%s)") % lv_name)
	g.pap_event.emit("taken", {"auto": auto})
	return true

func prompt(g: Node) -> String:
	if busy():
		if anim["phase"] == "offer":
			var pn: Dictionary = Config.at("papNames")
			var nm := String(pn.get(anim["w"], "l’arme améliorée"))
			if pn.has(anim["w"]) and int(anim["lv"]) > 1:
				nm += " " + String(Config.pap_levels[int(anim["lv"])]["roman"])
			return "E Récupérer %s" % nm
		return "Amélioration en cours…"
	var lv := next_level(g)
	if lv == 0:
		return "%s est au niveau maximum" % String(g.arms.current.cfg.get("name", ""))
	return "E Pack-a-Punch : %s %s au niveau %s (%d pts)" % ["passer" if lv > 1 else "améliorer", g.arms.current.cfg.get("name", ""), Config.pap_levels[lv]["roman"], price_of(lv)]

func step(g: Node, dt: float) -> void:
	if anim.is_empty():
		return
	var a := anim
	var C: Dictionary = Config.at("pap")
	a["age"] = float(a["age"]) + dt
	a["t"] = float(a["t"]) + dt
	match String(a["phase"]):
		"in":
			if float(a["t"]) >= float(C["inTime"]):
				a["phase"] = "work"
				a["t"] = 0.0
		"work":
			if float(a["t"]) >= float(C["workTime"]):
				a["phase"] = "out"
				a["t"] = 0.0
		"out":
			if float(a["t"]) >= float(C["outTime"]):
				a["phase"] = "offer"
				a["t"] = 0.0
		"offer":
			if float(a["t"]) >= float(C["offerTime"]):
				take(g, true)

## Nouvelle partie / mort : l'arme est rendue telle quelle.
func reset(g: Node) -> void:
	anim = {}
	g.arms.locked = false
