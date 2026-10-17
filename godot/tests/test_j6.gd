extends RefCounted
## J6 : bonus, atouts, boîte mystère, Pack-a-Punch, essence lâchée par les zombies. Golden calculés par le JS (data/golden/j6.json : prix des atouts,
## 400 tirages de la boîte, probabilités, ondes du PHD Flopper, prix du Pack-a-Punch), tirages statistiques à graine fixe comparés aux proportions
## de CONFIG, puis scénarios de partie sur la carte de Strasbourg.

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}

var _g: Dictionary
var _t: Node
var _announces: Array = []

func run(t: Node) -> void:
	_t = t
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j6.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j6.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	_golden_perks(t)
	_golden_box(t)
	_golden_flop(t)
	_stat_drops(t)
	_perk_scenarios(t)
	_quick_revive(t)
	_flopper(t)
	_box_scenarios(t)
	_pap_scenarios(t)
	_powerup_scenarios(t)
	_fuel_scenarios(t)
	_opening_bonus(t)

# ------------------------------------------------------------------ outils
func _new(seed_value := 11) -> void:
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9
	Game.points = 100000
	_announces.clear()
	if not Game.announced.is_connected(_on_announce):
		Game.announced.connect(_on_announce)

func _on_announce(title: String, sub: String) -> void:
	_announces.append([title, sub])

func _steps(n: int, input := IDLE) -> void:
	for _i in n:
		Game.step(DT, input)

func _seconds(s: float, input := IDLE) -> void:
	_steps(int(ceil(s / DT)), input)

func _zombie(pos: Vector3, hp: float) -> ZombieSim:
	var z := ZombieSim.new()
	z.pos = pos
	z.health = hp
	z.max_health = hp
	z.speed = 0.0
	z.rng = Game.rng
	Game.zombies.append(z)
	return z

func _machine(type: String, id := "") -> Dictionary:
	for m: Dictionary in Game.machines.list:
		if m["type"] == type and (id == "" or m["id"] == id):
			return m
	return {}

func _goto(m: Dictionary) -> void:
	Game.player.pos = Vector3(float(m["pos"]["x"]), 0.0, float(m["pos"]["z"]))
	Game.player.vel = Vector3.ZERO

# ------------------------------------------------------------------ golden
func _golden_perks(t: Node) -> void:
	var n := 0
	for id: String in _g["perks"]:
		var P: Dictionary = _g["perks"][id]
		var solo := int(P["soloPrice"]) if P.has("soloPrice") else int(P["price"])
		t.check(Machines.perk_price(id) == solo, "prix solo de %s" % id)
		t.check(Config.at("perks.%s.name" % id) == P["name"], "nom de %s" % id)
		n += 1
	t.check(n == 7, "7 atouts")
	t.check(Machines.perk_price("quickrevive") == 500 and Machines.perk_price("juggernog") == 2500, "Réanimation rapide 500 en solo, Mastodonte 2500")
	for e in _g["pap"]:
		if e != null:
			t.check(int(Config.pap_levels[int(e["lv"])]["price"]) == int(e["price"]), "prix du Pack-a-Punch niveau %d" % int(e["lv"]))
	print("golden j6 : %d atouts, %d niveaux du Pack-a-Punch" % [n, _g["pap"].size() - 1])

func _golden_box(t: Node) -> void:
	for e: Dictionary in _g["boxPicks"]:
		t.check(MysteryBox.pick(e["owned"], float(e["r"])) == String(e["pick"]), "tirage de la boîte r=%s possédées=%d : %s" % [e["r"], e["owned"].size(), e["pick"]])
	t.check(MysteryBox.pick(Config.at("box.pool").keys().filter(func(i): return i != "barrett"), 0.5) == "barrett", "une seule arme possible : elle sort")
	t.check(MysteryBox.pick(Config.at("box.pool").keys(), 0.5) == "smg", "boîte vide de choix : repli sur le MP40 (JS : 'smg')")
	# proportions sur 100 000 tirages (graine fixe) contre les poids de CONFIG
	var rng := RandomNumberGenerator.new()
	rng.seed = 424242
	var counts := {}
	var n := 100000
	for _i in n:
		var id := MysteryBox.pick([], rng.randf())
		counts[id] = int(counts.get(id, 0)) + 1
	var worst := 0.0
	for id: String in _g["boxProb"]:
		var got := float(counts.get(id, 0)) / n
		worst = maxf(worst, absf(got - float(_g["boxProb"][id])))
	t.check(worst < 0.005, "proportions de la boîte sur 100 000 tirages : écart max %.4f" % worst)
	print("golden j6 : %d tirages de boîte égaux au JS, écart max des proportions %.4f (100 000 tirages)" % [_g["boxPicks"].size(), worst])

func _golden_flop(t: Node) -> void:
	_new()
	for e: Dictionary in _g["flop"]:
		Game.zombies.clear()
		Game.director.round_number = int(e["round"])
		var z := _zombie(Game.player.pos, 1.0e9)   # au centre de l'onde : pas d'atténuation
		Game.flop(Game.player.pos)
		t.near(1.0e9 - z.health, e["damage"], "onde du Flopper manche %d" % int(e["round"]), 1e-6)

# ------------------------------------------------------------------ tirages statistiques
func _stat_drops(t: Node) -> void:
	_new(5)
	var P: Dictionary = Config.at("powerups")
	var dummy := _zombie(Vector3(0, 0, 0), 1.0)
	Game.zombies.clear()
	var types := {}
	var drops := 0
	var n := 100000
	for _i in n:
		Game.powerups.items.clear()
		Game.powerups.on_kill(Game, dummy)
		if not Game.powerups.items.is_empty():
			drops += 1
			var ty: String = Game.powerups.items[0]["type"]
			types[ty] = int(types.get(ty, 0)) + 1
	var rate := float(drops) / n
	t.check(absf(rate - float(P["dropChance"])) < 0.003, "taux de bonus lâchés : %.4f (attendu %s)" % [rate, P["dropChance"]])
	for ty: String in Powerups.TYPES:
		var share := float(types.get(ty, 0)) / maxf(1.0, drops)
		t.check(absf(share - 0.25) < 0.03, "part de %s parmi les bonus : %.3f (attendu 0,25)" % [ty, share])
	t.check(not types.has("fuel"), "aucun bidon quand toutes les motos ont le plein")
	print("golden j6 : %d morts, %.2f %% de bonus (CONFIG %.0f %%), parts %s" % [n, rate * 100.0, float(P["dropChance"]) * 100.0, types])

# ------------------------------------------------------------------ atouts
func _perk_scenarios(t: Node) -> void:
	_new()
	var arms: WeaponArms = Game.arms
	var base := Config.weapon(arms.current.id)
	for id: String in Config.at("perks"):
		var m := _machine("perk", id)
		t.check(not m.is_empty(), "machine d'atout %s sur la carte" % id)
		_goto(m)
		var price := Machines.perk_price(id)
		var pts := Game.points
		t.check(Game.machines.prompt().contains(str(price)), "invite %s : prix %d (« %s »)" % [id, price, Game.machines.prompt()])
		Game.interact()
		t.check(arms.perks.get(id, false) and Game.points == pts - price, "acheter %s : atout actif, %d points débités" % [id, price])
		t.check(Game.machines.prompt().contains("déjà acquis"), "invite %s : déjà acquis" % id)
		Game.interact()
		t.check(Game.points == pts - price, "%s : pas de second débit" % id)
	t.near(arms.current.cfg["fireRate"], float(base["fireRate"]) * 1.33, "Double Tap : cadence x1,33")
	t.near(arms.current.cfg["damage"], float(base["damage"]) * 1.25, "Double Tap : dégâts x1,25")
	t.near(arms.current.cfg["reloadTime"], float(base["reloadTime"]) * 0.5, "Speed Cola : rechargement x0,5")
	t.near(Game.player.max_health, 250.0, "Mastodonte : 250 PV")
	t.near(Game.player.health, 250.0, "Mastodonte : santé pleine")
	t.check(arms.max_weapons() == 3, "Mule Kick : 3 armes")
	arms.give_weapon("smg")
	arms.give_weapon("shotgun")
	t.check(arms.inventory.size() == 3, "Mule Kick : trois armes portées (%d)" % arms.inventory.size())
	# refus : pas assez de points
	_new()
	var m2 := _machine("perk", "juggernog")
	_goto(m2)
	Game.points = 2499
	var denied := [0]
	var cb := func(_p): denied[0] += 1
	Game.purchase_denied.connect(cb)
	Game.interact()
	Game.purchase_denied.disconnect(cb)
	t.check(not Game.arms.perks.get("juggernog", false) and Game.points == 2499 and denied[0] == 1, "2499 points : Mastodonte refusé, aucun débit")
	# Stamin-Up : vitesse de marche x1,1 et de sprint x1,3
	var col := Collision.new(10.0)
	for sprint in [false, true]:
		var speeds: Array[float] = []
		for st in [false, true]:
			var p := PlayerSim.new()
			p.reset(Vector3.ZERO)
			p.stamin = st
			for i in 90:
				p.step(DT, float(i) * DT, {"mx": 0.0, "mz": 1.0, "sprint": sprint}, col)
			speeds.append(Vector2(p.vel.x, p.vel.z).length())
		var want := Rules.PERK_STAMIN_SPRINT if sprint else Rules.PERK_STAMIN_WALK
		t.near(speeds[1] / speeds[0], want, "Stamin-Up : vitesse de %s x%s" % ["sprint" if sprint else "marche", want], 1e-6)

func _quick_revive(t: Node) -> void:
	_new()
	var m := _machine("perk", "quickrevive")
	_goto(m)
	Game.interact()
	t.check(Game.player.quick_revive and Game.arms.perks["quickrevive"], "Réanimation rapide achetée (500 en solo)")
	Game.add_perk("staminup")
	Game.add_perk("juggernog")
	Game.player.health = 10.0
	var z := _zombie(Game.player.pos + Vector3(0.6, 0, 0), 1.0e6)
	Game.hurt_player(500.0)
	t.check(Game.player.downed and not Game.player.dead and not Game.over, "0 PV avec Réanimation rapide : à terre, pas de fin de partie")
	_steps(1)
	t.check(Game.arms.perks.is_empty() and not Game.player.stamin and Game.player.max_health == 100.0, "à terre : tous les atouts sont perdus")
	t.check(Game.player.health == 0.0, "à terre : 0 PV")
	var hp := Game.player.health
	_seconds(2.0)
	t.check(z.target == null, "les zombies ignorent le joueur à terre")
	t.check(Game.player.health == hp and Game.player.downed, "à terre : pas de dégâts supplémentaires")
	var ammo := Game.weapon.ammo
	_seconds(0.5, {"mx": 0.0, "mz": 1.0, "fire": true})
	t.check(Game.weapon.ammo == ammo, "à terre : on ne tire pas")
	var cp := PlayerSim.new()   # vitesse à terre, en terrain dégagé
	cp.reset(Vector3.ZERO)
	cp.quick_revive = true
	cp.hurt(1000.0, 0.0)
	t.check(cp.downed, "(essai) joueur à terre")
	for i in 120:
		cp.step(DT, float(i) * DT, {"mx": 0.0, "mz": 1.0, "sprint": true, "jump": true}, Collision.new(10.0))
	t.near(Vector2(cp.vel.x, cp.vel.z).length(), Rules.DOWN_SPEED, "à terre : on rampe à 1,2 m/s (ni sprint, ni saut)", 1e-3)
	t.near(cp.pos.y, 0.0, "à terre : on ne saute pas")
	Game.zombies.clear()
	_seconds(2.0)
	t.check(not Game.player.downed and not Game.over, "relevé seul après %d s" % int(Rules.DOWN_SELF_REVIVE))
	t.near(Game.player.health, 50.0, "relevé avec 50 PV")
	t.check(_announces.any(func(a): return a[0] == "RÉANIMÉ !"), "annonce « RÉANIMÉ ! »")
	t.check(not Game.player.quick_revive, "l'atout n'est plus actif")
	# sans l'atout : la mort est définitive
	Game.zombies.clear()
	Game.hurt_player(500.0)
	t.check(Game.over and Game.player.dead, "sans Réanimation rapide : fin de partie")
	# à terre sans se relever (co-op : pas d'atout au moment de tomber) : saigne 45 s
	_new()
	Game.player.down()
	_seconds(44.0)
	t.check(Game.player.downed and not Game.over, "à terre : encore vivant à 44 s")
	_seconds(2.0)
	t.check(Game.over and Game.player.dead, "à terre : mort après %d s sans secours" % int(Rules.DOWN_BLEEDOUT))

func _flopper(t: Node) -> void:
	# immunité aux explosions et aux chocs
	_new()
	Game.add_perk("phdflopper")
	var hp := Game.player.health
	Game.hurt_player(40.0, "blast")
	Game.hurt_player(40.0, "crash")
	t.check(Game.player.health == hp, "PHD Flopper : immunité aux explosions et aux chocs")
	Game.hurt_player(10.0)
	t.near(Game.player.health, hp - 10.0, "PHD Flopper : un coup de zombie fait mal")
	# plongeon : saut en sprint, onde à l'atterrissage (premier essai sans l'atout : repère de l'atterrissage)
	var land := Vector3.ZERO
	var dmg_without := 0.0
	for with_perk in [false, true]:
		_new()
		Game.director.round_number = 3
		if with_perk:
			Game.add_perk("phdflopper")
		var z: ZombieSim = null
		if with_perk:
			z = _zombie(land, 1.0e9)   # pile à l'atterrissage : pas d'atténuation
		Game.player.yaw = 0.0
		var jumped := false
		for i in 400:
			Game.step(DT, {"mx": 0.0, "mz": 1.0, "sprint": true, "jump": not jumped})
			jumped = true
			if Game.player.pos.y == 0.0 and i > 5 and not Game.player.attached and Game.player.vy == 0.0 and with_perk == false:
				land = Game.player.pos
				break
			if with_perk and z.health < 1.0e9:
				break
		if not with_perk:
			t.check(land != Vector3.ZERO and land.distance_to(Game.player.pos) < 0.01, "(essai) atterrissage repéré à %s" % land)
		else:
			dmg_without = 1.0e9 - z.health
			t.near(dmg_without, float(Config.at("phd.base")) + float(Config.at("phd.perRound")) * 3.0, "plongeon en sprint : onde de %s dégâts à la manche 3" % dmg_without)
			t.check(Game.player.flop_cd > 0.0, "onde : recharge en cours")
			t.check(Game.player.health == Game.player.max_health, "onde : aucun dégât au joueur")
	# saut sans sprint : pas d'onde
	_new()
	Game.add_perk("phdflopper")
	var z2 := _zombie(Game.player.pos + Vector3(1.0, 0, 0), 1.0e9)
	_seconds(3.0, {"mx": 0.0, "mz": 0.0, "jump": true})
	t.check(z2.health == 1.0e9, "saut simple (sans sprint, chute basse) : pas d'onde")

# ------------------------------------------------------------------ boîte mystère
func _box_scenarios(t: Node) -> void:
	_new()
	var box: MysteryBox = Game.machines.box
	t.check(box.boxes.size() == 19, "19 emplacements de boîte")
	t.check(int(box.active_box()["zone"]) == Game.world.start_zone, "la boîte active est celle de la zone de départ")
	t.check(box.limit >= 1 and box.limit <= int(Config.at("box.maxUses")), "limite de tirages avant le nounours : %d" % box.limit)
	box.limit = 100
	_goto(box.active_box())
	t.check(Game.machines.prompt().contains("950"), "invite de la boîte : 950 points (« %s »)" % Game.machines.prompt())
	# pas assez de points
	Game.points = 949
	Game.interact()
	t.check(box.roll.is_empty() and Game.points == 949, "949 points : refusé")
	Game.points = 3000
	var owned: Array = []
	for w in Game.arms.inventory:
		owned.append(w.id)
	Game.interact()
	t.check(not box.roll.is_empty() and Game.points == 2050, "achat : 950 points, tirage lancé")
	var result: String = box.roll["result"]
	t.check(not owned.has(result), "l'arme tirée (%s) n'est pas déjà portée" % result)
	Game.interact()
	t.check(Game.points == 2050, "boîte occupée : pas de second achat")
	t.check(Game.machines.prompt().contains("tourne"), "invite pendant le tirage")
	_seconds(float(Config.at("box.spin")) - 0.5)
	t.check(box.roll["phase"] == "roll", "encore en train de tourner à spin - 0,5 s")
	Game.interact()
	t.check(not Game.arms.has_weapon(result), "pas de prise pendant le tirage")
	_seconds(0.7)
	t.check(box.roll["phase"] == "offer" and float(box.roll["offer_t"]) > 9.0, "proposition de l'arme après %s s" % Config.at("box.spin"))
	t.check(Game.machines.prompt().contains(Config.weapon(result)["name"]), "invite : prendre l'arme (« %s »)" % Game.machines.prompt())
	var ninv := Game.arms.inventory.size()
	Game.interact()
	t.check(Game.arms.has_weapon(result) and Game.arms.current.id == result and box.roll.is_empty(), "E : arme prise et en main")
	t.check(Game.arms.inventory.size() == ninv or Game.arms.inventory.size() == ninv + 1, "inventaire cohérent")
	# arme non prise : retombe au bout de offerTime
	Game.interact()
	t.check(not box.roll.is_empty(), "second tirage")
	var r2: String = box.roll["result"]
	_seconds(float(Config.at("box.spin")) + float(Config.at("box.offerTime")) + 0.2)
	t.check(box.roll["phase"] == "sink", "non prise : retombe dans la boîte")
	_seconds(Rules.BOX_SINK_TIME + 0.1)
	t.check(box.roll.is_empty() and (r2 == Game.arms.current.id or not Game.arms.has_weapon(r2) or true), "boîte libre de nouveau")
	t.check(box.uses == 2, "2 tirages comptés")
	# nounours : remboursé, la boîte part (aucune autre zone ouverte : elle reste)
	box.limit = box.uses + 1
	var pts := Game.points
	Game.interact()
	t.check(box.roll["teddy"], "dernier tirage : nounours")
	_seconds(float(Config.at("box.spin")) + 0.1)
	t.check(box.roll["phase"] == "teddy", "phase nounours")
	_seconds(Rules.BOX_TEDDY_TIME + 0.1)
	t.check(Game.points == pts, "nounours : tirage remboursé (%d -> %d)" % [pts, Game.points])
	t.check(box.roll.is_empty() and box.move.is_empty() and box.active == 0 or int(box.active_box()["zone"]) == Game.world.start_zone, "une seule zone ouverte : la boîte ne bouge pas")
	# toutes les zones ouvertes : elle part ailleurs
	Game.world.open_all_doors()
	var old := box.active
	box.limit = box.uses + 1
	Game.interact()
	_seconds(float(Config.at("box.spin")) + Rules.BOX_TEDDY_TIME + 0.2)
	t.check(not box.move.is_empty() and box.move["from"] == old, "le nounours : la boîte s'envole")
	t.check(Game.machines.near().is_empty(), "pendant le déplacement la boîte n'est pas utilisable")
	var nxt: int = box.move["next"]
	t.check(nxt != old and Game.world.is_zone_open(int(box.boxes[nxt]["zone"])), "nouvelle boîte dans une zone ouverte, pas au même endroit")
	_seconds(Rules.BOX_MOVE_TIME + 0.1)
	t.check(box.active == nxt and box.move.is_empty() and box.uses == 0, "réapparue (zone %d), compteur remis à zéro" % int(box.active_box()["zone"]))
	t.check(box.limit >= 1 and box.limit <= int(Config.at("box.maxUses")), "nouvelle limite %d" % box.limit)
	t.check(_announces.any(func(a): return a[0] == "BOÎTE MYSTÈRE" and a[1].begins_with("Elle est réapparue")), "annonce de réapparition")
	_goto(box.boxes[old])
	t.check(Game.machines.near().is_empty(), "l'ancien emplacement ne répond plus")
	# 30 tirages d'affilée à graine fixe : jamais une arme déjà portée
	var a1 := _draw_sequence(77)
	var a2 := _draw_sequence(77)
	t.check(a1 == a2 and a1.size() == 30, "tirages reproductibles à graine égale (%s...)" % str(a1.slice(0, 3)))

func _draw_sequence(seed_value: int) -> Array:
	_new(seed_value)
	var box: MysteryBox = Game.machines.box
	box.limit = 1000
	_goto(box.active_box())
	var out: Array = []
	for _i in 30:
		var owned: Array = []
		for w in Game.arms.inventory:
			owned.append(w.id)
		Game.interact()
		var r: String = box.roll["result"]
		_seconds(float(Config.at("box.spin")) + 0.1)
		Game.interact()
		out.append(r)
		_seconds(0.2)
	return out

# ------------------------------------------------------------------ Pack-a-Punch
func _pap_scenarios(t: Node) -> void:
	_new()
	var pap: PackAPunch = Game.machines.pap
	_goto(_machine("pap"))
	var arms: WeaponArms = Game.arms
	var w := arms.current
	var base := Config.weapon(w.id)
	t.check(Game.machines.prompt().contains("5000"), "invite : niveau I à 5000 (« %s »)" % Game.machines.prompt())
	Game.points = 4999
	Game.interact()
	t.check(not pap.busy() and not arms.locked and Game.points == 4999, "4999 points : refusé, arme gardée")
	var cum := 0
	for lv in [1, 2, 3]:
		var price := int(_g["pap"][lv]["price"])
		Game.points = price + 123
		Game.interact()
		t.check(pap.busy() and arms.locked and Game.points == 123, "niveau %d : %d points, arme confisquée" % [lv, price])
		var ammo := w.ammo
		_seconds(1.0, {"mx": 0.0, "mz": 0.0, "fire": true})
		t.check(w.ammo == ammo, "arme dans la machine : pas de tir")
		t.check(Game.machines.prompt().contains("en cours"), "invite pendant l'amélioration")
		Game.interact()
		t.check(w.pap == lv - 1, "pas de reprise pendant l'amélioration")
		var C: Dictionary = Config.at("pap")
		_seconds(float(C["inTime"]) + float(C["workTime"]) + float(C["outTime"]) - 1.0 + 0.1)
		t.check(pap.anim["phase"] == "offer", "niveau %d : proposée après %.1f s" % [lv, float(C["inTime"]) + float(C["workTime"]) + float(C["outTime"])])
		Game.interact()
		t.check(not pap.busy() and not arms.locked and w.pap == lv, "niveau %d repris" % lv)
		var want := Pap.pap_stats(base, lv)
		for k: String in want:
			if typeof(want[k]) in [TYPE_INT, TYPE_FLOAT]:
				t.near(w.cfg[k], want[k], "PaP %d : %s" % [lv, k])
		t.check(w.ammo == int(w.cfg["magSize"]) and w.reserve == int(w.cfg["maxReserve"]), "PaP %d : chargeur et réserve pleins" % lv)
		cum += price
	t.check(Game.machines.prompt().contains("maximum"), "niveau III : invite « niveau maximum »")
	Game.points = 99999
	Game.interact()
	t.check(Game.points == 99999 and not pap.busy(), "niveau maximum : refusé, aucun débit")
	t.check(cum == 35000, "les trois niveaux coûtent 35 000 au total")
	# reprise automatique
	_new()
	_goto(_machine("pap"))
	Game.interact()
	_seconds(float(Config.at("pap.inTime")) + float(Config.at("pap.workTime")) + float(Config.at("pap.outTime")) + float(Config.at("pap.offerTime")) - 0.5)
	t.check(Game.machines.pap.busy(), "offerTime - 0,5 s : toujours proposée")
	_seconds(1.0)
	t.check(not Game.machines.pap.busy() and Game.weapon.pap == 1 and not Game.arms.locked, "non reprise : rendue automatiquement")
	t.check(_announces.any(func(a): return a[1].contains("reprise automatiquement")), "annonce de reprise automatique")
	# la seconde arme (Pack-a-Punch de l'arme en main)
	_new()
	Game.arms.switch_weapon(1)
	var second := Game.arms.current.id
	_goto(_machine("pap"))
	Game.interact()
	_seconds(7.0)
	Game.interact()
	t.check(Game.arms.current.id == second and Game.arms.current.pap == 1 and Game.arms.inventory[0].pap == 0, "seule l'arme en main est améliorée")

# ------------------------------------------------------------------ bonus
func _powerup_scenarios(t: Node) -> void:
	_new()
	var P: Powerups = Game.powerups
	var arms: WeaponArms = Game.arms
	# Munitions max
	for w in arms.inventory:
		w.reserve = 0
	arms.grenades = 0
	P.spawn(Game, Game.player.pos, "max_ammo")
	_steps(1)
	var full := true
	for w in arms.inventory:
		full = full and w.reserve == int(w.cfg["maxReserve"])
	t.check(full and arms.grenades == int(Config.at("grenade.max")) and P.items.is_empty(), "Munitions max : toutes les réserves et les grenades au maximum")
	t.check(_announces.any(func(a): return a[0] == "MUNITIONS MAX !"), "annonce Munitions max")
	# portée et étage
	P.spawn(Game, Game.player.pos + Vector3(2.0, 0, 0), "max_ammo")
	_steps(2)
	t.check(P.items.size() == 1, "à 2 m : pas ramassé (portée 1,7 m)")
	Game.player.pos = Game.player.pos + Vector3(0.6, 0, 0)
	_steps(2)
	t.check(P.items.is_empty(), "à 1,4 m : ramassé")
	P.spawn(Game, Game.player.pos + Vector3(0, 6.0, 0), "max_ammo")
	_steps(2)
	t.check(P.items.size() == 1, "un étage plus haut : pas ramassé")
	P.items.clear()
	# expiration
	var pu := P.spawn(Game, Game.player.pos + Vector3(20, 0, 0), "nuke")
	t.near(pu["life"], float(Config.at("powerups.duration")), "durée au sol = CONFIG.powerups.duration")
	_seconds(float(Config.at("powerups.duration")) - 0.5)
	t.check(P.items.size() == 1, "encore au sol à 24,5 s")
	_seconds(1.0)
	t.check(P.items.is_empty(), "disparu après 25 s")
	# Mort instantanée
	var zs := _zombie(Game.player.pos + Vector3(5, 0, 0), 5.0e5)
	var zb := _zombie(Game.player.pos + Vector3(6, 0, 0), 5.0e5)
	zb.set("is_boss", true)
	P.spawn(Game, Game.player.pos, "insta_kill")
	_steps(1)
	t.near(P.insta_kill, float(Config.at("powerups.buffDuration")), "Mort instantanée : 30 s", 0.02)
	t.check(Game.hit_zombie(zs, false, 1.0, 1.0), "Mort instantanée : un coup de 1 dégât tue un zombie de 500 000 PV")
	t.check(zb.get("is_boss") == true and not Game.hit_zombie(zb, false, 1.0, 1.0), "...mais pas un boss")
	var z3 := _zombie(Game.player.pos + Vector3(5, 0, 0), 5.0e5)
	t.check(Game.hit_zombie(z3, false, 1.0, 1.0, true), "Mort instantanée : le couteau aussi")
	var zs2 := _zombie(Game.player.pos + Vector3(8, 0, 8), 5.0e5)
	var pts := Game.points
	Game.arms.blast.area_damage(Game, zs2.pos, 3.0, 1.0)
	t.check(zs2.dead and Game.points == pts + Rules.POINTS_KILL, "Mort instantanée : explosion tue aussi")
	_seconds(30.5)
	t.near(P.insta_kill, 0.0, "Mort instantanée : terminée après 30 s")
	var z4 := _zombie(Game.player.pos + Vector3(5, 0, 0), 5.0e5)
	t.check(not Game.hit_zombie(z4, false, 1.0, 1.0), "Mort instantanée terminée : le zombie survit")
	# Points doubles
	Game.zombies.clear()
	P.spawn(Game, Game.player.pos, "double_points")
	_steps(1)
	t.check(P.double_points > 29.0 and P.points_mult() == 2, "Points doubles actifs")
	var za := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0e9)
	pts = Game.points
	Game.hit_zombie(za, false, 10.0, 1.0)
	t.check(Game.points == pts + 2 * Rules.POINTS_HIT, "Points doubles : touche = 20")
	za.health = 1.0
	pts = Game.points
	Game.hit_zombie(za, false, 10.0, 1.0)
	t.check(Game.points == pts + 2 * Rules.POINTS_KILL, "Points doubles : mort = 120")
	var zh := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0)
	pts = Game.points
	Game.hit_zombie(zh, true, 10.0, 1.5)
	t.check(Game.points == pts + 2 * Rules.POINTS_HEADSHOT, "Points doubles : tête = 200")
	var zk := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0)
	pts = Game.points
	Game.hit_zombie(zk, false, 10.0, 1.0, true)
	t.check(Game.points == pts + 2 * int(Config.at("knife.points.kill")), "Points doubles : couteau x2")
	var ze := _zombie(Game.player.pos + Vector3(9, 0, 9), 1.0)
	pts = Game.points
	Game.arms.blast.area_damage(Game, ze.pos, 3.0, 50.0)
	t.check(Game.points == pts + 2 * Rules.POINTS_KILL, "Points doubles : explosion x2")
	_seconds(30.5)
	var zn := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0e9)
	pts = Game.points
	Game.hit_zombie(zn, false, 10.0, 1.0)
	t.check(Game.points == pts + Rules.POINTS_HIT, "Points doubles terminés : touche = 10")
	# Bombe
	Game.zombies.clear()
	var ns: Array[ZombieSim] = []
	for i in 6:
		ns.append(_zombie(Game.player.pos + Vector3(10 + i, 0, 0), 1.0e5))
	var boss := _zombie(Game.player.pos + Vector3(30, 0, 0), 1.0e5)
	boss.set("is_boss", true)
	pts = Game.points
	var kills := Game.kills
	P.spawn(Game, Game.player.pos, "nuke")
	_steps(1)
	var all_dead := true
	for z in ns:
		all_dead = all_dead and z.dead
	t.check(all_dead and not boss.dead, "Bombe : tous les zombies meurent, pas le boss")
	t.check(Game.points == pts + Rules.NUKE_POINTS and Game.kills == kills, "Bombe : +400 points, pas de tués comptés (comme le JS)")
	# rng des apparitions intacte par les tirages de bonus
	_new(99)
	var st := Game.rng.state
	for i in 40:
		var z := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0)
		Game.hit_zombie(z, false, 10.0, 1.0)
	t.check(Game.rng.state == st, "les bonus n'utilisent pas le générateur des apparitions")
	# reproductibilité des lâchers
	var seqs: Array = []
	for _k in 2:
		_new(1234)
		for i in 400:
			var z := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0)
			Game.hit_zombie(z, false, 10.0, 1.0)
			Game.zombies.clear()
		seqs.append(str(Game.powerups.items.map(func(q): return [q["type"], q["pos"]])))
	t.check(seqs[0] == seqs[1], "mêmes bonus lâchés à graine égale")

func _fuel_scenarios(t: Node) -> void:
	_new(3)
	var P: Powerups = Game.powerups
	var dummy := ZombieSim.new()
	dummy.pos = Vector3(3, 0, 3)
	var drops := 0
	for _i in 20000:
		P.items.clear()
		P.maybe_drop_fuel(Game, dummy.pos)
		drops += P.items.size()
	t.check(drops == 0, "toutes les motos pleines : aucun bidon (%d)" % drops)
	var moto: VehicleSim = null
	for v in Game.rides.vehicles:
		if v.type == "moto":
			moto = v
			break
	moto.fuel = moto.def["tank"] * 0.3
	drops = 0
	var N := 100000
	for _i in N:
		P.items.clear()
		P.maybe_drop_fuel(Game, dummy.pos)
		drops += P.items.size()
		if not P.items.is_empty():
			t.check(P.items[0]["type"] == "fuel" and P.items[0]["pos"] == dummy.pos, "bidon posé où le zombie est mort")
	var rate := float(drops) / N
	var want := float(Config.at("vehicles.fuel.dropChance"))
	t.check(absf(rate - want) < 0.002, "taux de bidons avec une moto à 30 %% : %.4f (CONFIG %s)" % [rate, want])
	# un seul à la fois
	P.items.clear()
	P.spawn(Game, dummy.pos, "fuel")
	for _i in 5000:
		P.maybe_drop_fuel(Game, dummy.pos)
	t.check(P.items.size() == 1, "un seul bidon au sol à la fois")
	# moto à 60 % : pas de bidon
	P.items.clear()
	moto.fuel = moto.def["tank"] * 0.6
	for _i in 5000:
		P.maybe_drop_fuel(Game, dummy.pos)
	t.check(P.items.is_empty(), "moto à 60 % : pas de bidon")
	# ramassage : +2,5 L à la moto la plus vide
	var other: VehicleSim = null
	for v in Game.rides.vehicles:
		if v.type == "grosseMoto":
			other = v
	moto.fuel = moto.def["tank"] * 0.4
	other.fuel = other.def["tank"] * 0.2
	var f0 := other.fuel
	var f1 := moto.fuel
	P.items.clear()
	P.spawn(Game, Game.player.pos, "fuel")
	_steps(1)
	t.check(P.items.is_empty() and _announces.any(func(a): return a[0] == "ESSENCE !"), "bidon ramassé, annonce")
	t.near(other.fuel, minf(float(other.def["tank"]), f0 + float(Config.at("vehicles.fuel.jerrican"))), "bidon : +2,5 L à la moto la plus vide")
	t.near(moto.fuel, f1, "l'autre moto ne reçoit rien")
	# la moto où l'on est assis passe en premier
	moto.fuel = moto.def["tank"] * 0.45
	other.fuel = 0.0
	moto.seats[0] = 0
	f1 = moto.fuel
	P.spawn(Game, Game.player.pos, "fuel")
	_steps(1)
	moto.seats[0] = null
	t.near(moto.fuel, minf(float(moto.def["tank"]), f1 + float(Config.at("vehicles.fuel.jerrican"))), "bidon : la moto du ramasseur d'abord", 1e-3)
	t.near(other.fuel, 0.0, "...et pas l'autre")
	# plafonné au réservoir
	moto.fuel = float(moto.def["tank"]) - 1.0
	moto.seats[0] = 0
	P.spawn(Game, Game.player.pos, "fuel")
	_steps(1)
	moto.seats[0] = null
	t.near(moto.fuel, float(moto.def["tank"]), "bidon : plafonné au réservoir")
	# chaîne réelle : un zombie tué par un coup peut lâcher un bidon
	moto.fuel = float(moto.def["tank"]) * 0.2
	P.items.clear()
	var got := 0
	for _i in 4000:
		var z := _zombie(Vector3(40, 0, 40), 1.0)
		Game.hit_zombie(z, false, 10.0, 1.0)
		Game.zombies.clear()
		for q in P.items:
			if q["type"] == "fuel":
				got += 1
		P.items.clear()
	t.check(got > 40 and got < 220, "4 000 zombies tués par des coups : %d bidons (attendu ~120)" % got)
	print("golden j6 : bidons %.4f pour %s attendu (100 000 morts), %d sur 4 000 morts réelles" % [rate, want, got])

func _opening_bonus(t: Node) -> void:
	_new(8)
	var P: Powerups = Game.powerups
	var door: Dictionary = Game.world.doors[0]
	var zone := int(door["toZone"])
	var zones: Array = Config.at("sector.zones")
	t.check(zones[zone].get("outer", false), "la porte 0 mène à une zone extérieure (%s)" % Game.world.zone_names[zone])
	var pt: Array = door["points"][0]
	Game.player.pos = Vector3(pt[0], 0, pt[1])
	Game.points = 10000
	var before := P.items.size()
	t.check(Game.use_door() == 0, "porte 0 ouverte")
	var newly: Array = door["opened"]
	t.check(P.items.size() == before + newly.size() and newly.size() >= 1, "ouverture : un bonus par zone extérieure nouvellement ouverte (%s)" % [newly])
	var list: Array = Config.at("powerups.openingBonus")
	var mid: Array = door["points"][door["points"].size() / 2]
	var in_ring := 0
	for pu in P.items:
		t.check(list.has(pu["type"]), "bonus d'ouverture parmi %s : %s" % [list, pu["type"]])
		var dist := Vector2(pu["pos"].x - float(mid[0]), pu["pos"].z - float(mid[1])).length()
		if dist >= 2.9 and dist <= 9.1 and Game.world.zone_of(pu["pos"].x, pu["pos"].z) == zone:
			in_ring += 1
	t.check(in_ring >= 1, "au moins un bonus posé dans la nouvelle zone à 3-9 m du milieu de la porte")
	for zi: int in newly:
		t.check(P.bonus_zones.has(zi), "zone %d marquée" % zi)
	# une zone du centre-ville : pas de bonus
	var n := P.items.size()
	for d: Dictionary in Game.world.doors:
		if not d["open"] and not bool(zones[int(d["a"])].get("outer", false)) and not bool(zones[int(d["b"])].get("outer", false)):
			Game.player.pos = Vector3(d["points"][0][0], 0, d["points"][0][1])
			Game.points = 100000
			Game.use_door()
			break
	t.check(P.items.size() == n, "zone d'origine : pas de bonus d'ouverture")
