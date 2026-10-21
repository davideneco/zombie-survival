extends RefCounted
## v0.27.0 : nouveaux atouts (sim/perk_fx.gd) et limite d'atouts portés. Propre au port (pas de golden JS) :
##   - fiches (nom, prix, couleur, lettre uniques), distributeurs placés sur la carte (data/perk_machines.json) : dans leur zone, libres,
##     adossés, avec une collision ; limite de 4 atouts au distributeur, levée par la Bénédiction ; tous perdus à terre ;
##   - effet de chacun, avec des scénarios déterministes et des tirages statistiques (critiques, gouttes du Vautour) ;
##   - Classique inchangé quand le joueur n'a aucun nouvel atout (même partie, mêmes zombies, mêmes points).

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}
const NEW := ["deadshot", "electriccherry", "widowswine", "vultureaid", "tombstone", "dyingwish", "stronghold", "deathperception", "bandolier"]

func run(t: Node) -> void:
	if not FileAccess.file_exists("res://data/world/objects.json"):
		t.check(true, "j34 : monde cuit absent, suite sautée")
		return
	_sheets(t)
	_machines(t)
	_limit(t)
	_deadshot_bandolier(t)
	_cherry(t)
	_widow(t)
	_vulture(t)
	_tombstone(t)
	_dying_wish(t)
	_stronghold(t)
	_death_perception(t)
	_unchanged_without_perks(t)
	Game.mode = GameMode.CLASSIC

func _new(seed_value := 11) -> void:
	Game.mode = GameMode.CLASSIC
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9
	Game.points = 100000

func _steps(n: int, input := IDLE) -> void:
	for _i in n:
		Game.step(DT, input)

func _zombie(pos: Vector3, hp: float, spd := 0.0) -> ZombieSim:
	var z := ZombieSim.new()
	z.id = Game.next_zombie_id()
	z.pos = pos
	z.health = hp
	z.max_health = hp
	z.speed = spd
	z.rng = Game.rng
	Game.zombies.append(z)
	return z

func _machine(id: String) -> Dictionary:
	for m: Dictionary in Game.machines.list:
		if m["type"] == "perk" and m.get("id") == id:
			return m
	return {}

func _goto(m: Dictionary) -> void:
	Game.player.pos = Vector3(float(m["pos"]["x"]) + sin(float(m["yaw"])) * 1.6, 0, float(m["pos"]["z"]) + cos(float(m["yaw"])) * 1.6)
	Game.player.vel = Vector3.ZERO

# ------------------------------------------------------------------ fiches
func _sheets(t: Node) -> void:
	var perks: Dictionary = Config.at("perks")
	t.check(perks.size() == 16, "16 atouts (7 du JS + 9 nouveaux) : %d" % perks.size())
	var letters := {}
	var colors := {}
	for id: String in perks:
		var P: Dictionary = perks[id]
		t.check(not letters.has(P["letter"]), "lettre unique : %s (%s)" % [P["letter"], id])
		t.check(not colors.has(P["color"]), "couleur unique : %s (%s)" % [P["color"], id])
		letters[P["letter"]] = true
		colors[P["color"]] = true
		t.check(int(P["price"]) >= 500 and int(P["price"]) <= 5000 and String(P["desc"]) != "", "%s : prix %d et description" % [id, int(P["price"])])
	for id: String in NEW:
		t.check(perks.has(id) and PerkFx.is_new(id), "nouvel atout %s dans Config.perks" % id)
	t.check(PerkFx.slots() == 4, "limite d'atouts : 4")

# ------------------------------------------------------------------ distributeurs
func _machines(t: Node) -> void:
	_new()
	var w: World = Game.world
	var places := PerkPlaces.list()
	t.check(places.size() == NEW.size(), "%d distributeurs placés (data/perk_machines.json)" % places.size())
	var zones := {}
	for m: Dictionary in places:
		var id := String(m["id"])
		var zi := int(m["zone"])
		var x := float(m["pos"]["x"])
		var z := float(m["pos"]["z"])
		t.check(w.zone_of(x, z) == zi and not w.nav.is_blocked_at(x, z), "%s : dans sa zone %d, sur une case libre" % [id, zi])
		t.check(not zones.has(zi), "%s : seul nouvel atout de sa zone" % id)
		zones[zi] = true
		var old := 0
		for o: Dictionary in w.objects["machines"]:
			if o["type"] == "perk" and int(o["zone"]) == zi and not o.get("proc", false):
				old += 1
		t.check(old == 0, "%s : zone %d sans atout d'origine" % [id, zi])
		t.check(not _machine(id).is_empty(), "%s : machine de la partie" % id)
		# la collision : on ne traverse pas le distributeur
		var fwd := Vector2(sin(float(m["yaw"])), cos(float(m["yaw"])))
		var probe := Vector3(x + fwd.x * 0.6, 0, z + fwd.y * 0.6)   # un joueur collé à la façade (0,15 m dans la caisse)
		var p := Game.collision.resolve(probe, 0.4)
		var dd := Vector2(p.x - x, p.z - z).dot(fwd)
		t.check(dd > 0.8, "%s : collision (repoussé à %.2f m du centre)" % [id, dd])
		# devant, à 1,6 m : l'invite d'achat
		_goto(m)
		var pr: String = Game.machines.prompt()
		t.check(pr.contains(String(m["name"])) and pr.contains(str(Machines.perk_price(id))), "%s : invite « %s »" % [id, pr])
		t.check(not w.nav.is_blocked_at(Game.player.pos.x, Game.player.pos.z), "%s : on peut se tenir devant" % id)
		var _f := fwd
	t.check(Game.machines.list.size() == w.objects["machines"].size(), "machines de la partie = machines de la carte + distributeurs")

# ------------------------------------------------------------------ limite
func _limit(t: Node) -> void:
	_new()
	var bought: Array[String] = []
	for id in ["juggernog", "staminup", "doubletap", "speedcola", "deadshot"]:
		var m := _machine(id)
		_goto(m)
		var pts := Game.points
		Game.interact()
		if Game.arms.perks.get(id, false):
			bought.append(id)
		elif bought.size() == 4:
			t.check(Game.points == pts, "5e atout refusé sans débit (%s)" % id)
			t.check(Game.machines.prompt().contains("LIMITE"), "invite : limite (« %s »)" % Game.machines.prompt())
	t.check(bought.size() == 4, "4 atouts achetés au plus (%s)" % [bought])
	Game.blessed = true   # Bénédiction de l'Aube : plus de limite
	var m5 := _machine("deadshot")
	_goto(m5)
	Game.interact()
	t.check(Game.arms.perks.get("deadshot", false) and Game.arms.perks.size() == 5, "Bénédiction : 5e atout possible")
	Game.blessed = false
	# à terre sans Pierre tombale : tout est perdu
	Game.add_perk("quickrevive")
	Game.player.health = 1.0
	Game.hurt_player(50.0)
	_steps(1)
	t.check(Game.player.downed and Game.arms.perks.is_empty(), "à terre : tous les atouts perdus (nouveaux compris)")

# ------------------------------------------------------------------ Œil-de-lynx et Cartouchière
func _deadshot_bandolier(t: Node) -> void:
	_new()
	var w: WeaponState = Game.arms.current
	var base := Config.weapon(w.id)
	Game.add_perk("deadshot")
	t.near(w.cfg["headMult"], float(base["headMult"]) * 1.5, "Œil-de-lynx : bonus de tête x1,5")
	t.near(w.cfg["spread"], float(base["spread"]) * 0.65, "Œil-de-lynx : dispersion x0,65")
	Game.add_perk("bandolier")
	t.check(int(w.cfg["maxReserve"]) == roundi(float(base["maxReserve"]) * 1.5), "Cartouchière : réserve max %d (x1,5 de %d)" % [int(w.cfg["maxReserve"]), int(base["maxReserve"])])
	Game.arms.max_ammo()
	t.check(w.reserve == int(w.cfg["maxReserve"]), "Cartouchière : Munitions max remplit la réserve agrandie (%d)" % w.reserve)
	Game.arms.clear_perks()
	t.check(w.reserve <= int(base["maxReserve"]) and is_equal_approx(float(w.cfg["headMult"]), float(base["headMult"])), "atouts perdus : réserve ramenée à %d, tête x1" % w.reserve)
	# Œil-de-lynx en partie : un tir à la tête fait 1,5 fois plus
	_new()
	var z := _zombie(Game.player.pos + Vector3(0, 0, -6), 1.0e6)
	Game.hit_zombie(z, true, 100.0, float(Game.arms.current.cfg["headMult"]))
	var d0 := 1.0e6 - z.health
	Game.add_perk("deadshot")
	z.health = 1.0e6
	Game.hit_zombie(z, true, 100.0, float(Game.arms.current.cfg["headMult"]))
	t.near((1.0e6 - z.health) / d0, 1.5, "Œil-de-lynx : dégâts à la tête x1,5 en partie", 1e-6)

# ------------------------------------------------------------------ Cerise-foudre
func _cherry(t: Node) -> void:
	_new()
	Game.director.round_number = 5
	Game.add_perk("electriccherry")
	var w: WeaponState = Game.arms.current
	var p := Game.player.pos
	var near := _zombie(p + Vector3(1.5, 0, 0), float(Game.zombie_health_at(5)))
	var far := _zombie(p + Vector3(9.0, 0, 0), float(Game.zombie_health_at(5)))
	var ev := []
	var cb := func(n: String, d: Dictionary) -> void: ev.append([n, d])
	Game.perk_event.connect(cb)
	w.ammo = int(w.cfg["magSize"]) - 1   # presque plein : pas de décharge
	_steps(1, {"mx": 0.0, "mz": 0.0, "reload": true})
	t.check(ev.is_empty() and not near.dead, "Cerise-foudre : chargeur presque plein, pas de décharge")
	_steps(int(float(w.cfg["reloadTime"]) / DT) + 5)
	w.ammo = 0   # vide : décharge pleine
	Game.pfx.cherry_cd = 0.0
	_steps(1, {"mx": 0.0, "mz": 0.0, "reload": true})
	Game.perk_event.disconnect(cb)
	t.check(not ev.is_empty() and ev[0][0] == "cherry", "Cerise-foudre : décharge au rechargement (chargeur vide)")
	t.check(near.dead and not far.dead, "Cerise-foudre : tue le zombie à 1,5 m (vie de manche), épargne celui à 9 m")
	t.check(Game.pfx.cherry_cd > 0.0, "Cerise-foudre : recharge de %.1f s" % Game.pfx.cherry_cd)
	# moitié vide : la moitié des dégâts (vie de manche x 1,25 x 0,5)
	var z2 := _zombie(p + Vector3(-1.5, 0, 0), 1.0e6)
	_steps(int(float(w.cfg["reloadTime"]) / DT) + 5)
	Game.pfx.cherry_cd = 0.0
	w.ammo = int(w.cfg["magSize"]) / 2
	var empty := 1.0 - float(w.ammo) / float(w.cfg["magSize"])
	_steps(1, {"mx": 0.0, "mz": 0.0, "reload": true})
	t.near(1.0e6 - z2.health, float(Game.zombie_health_at(5)) * 1.25 * empty, "Cerise-foudre : dégâts proportionnels au chargeur vidé", 1e-6)

# ------------------------------------------------------------------ Veuve noire
func _widow(t: Node) -> void:
	_new()
	Game.add_perk("widowswine")
	Game.add_perk("juggernog")
	var p := Game.player.pos
	var a := _zombie(p + Vector3(0.7, 0, 0), 1.0e6, 2.0)
	var b := _zombie(p + Vector3(-3.5, 0, 0), 1.0e6, 2.0)
	var c := _zombie(p + Vector3(12.0, 0, 0), 1.0e6, 2.0)
	for z in [a, b, c]:
		z.skip_spawn()
	var hp0 := Game.player.health
	var n := 0
	while Game.player.health >= hp0 and n < 600:
		_steps(1)
		n += 1
	t.check(Game.player.health < hp0, "Veuve noire : le zombie frappe")
	t.check(a.slow_t > 0.0 and b.slow_t > 0.0 and c.slow_t <= 0.0, "Veuve noire : toile sur les zombies à moins de 5 m (a %.1f, b %.1f, c %.1f)" % [a.slow_t, b.slow_t, c.slow_t])
	t.check(Game.pfx.web_cd > 19.0, "Veuve noire : recharge de 20 s")
	# un zombie englué avance à 35 % de sa vitesse
	Game.mode = GameMode.CLASSIC
	Game.new_game(3, "arena", [])   # arène plate : ils marchent droit sur le joueur
	Game.director.intermission = 1.0e9
	var z1 := _zombie(Game.player.pos + Vector3(12, 0, 0), 1.0e6, 2.0)
	var z2 := _zombie(Game.player.pos + Vector3(-12, 0, 0), 1.0e6, 2.0)
	z1.skip_spawn()
	z2.skip_spawn()
	z1.slow(0.35, 6.0)
	var a1 := z1.pos
	var a2 := z2.pos
	_steps(60)
	var r := a1.distance_to(z1.pos) / maxf(0.001, a2.distance_to(z2.pos))
	t.check(absf(r - 0.35) < 0.08, "Veuve noire : vitesse englué / libre = %.2f (0,35)" % r)
	# couteau collant
	_new()
	Game.add_perk("widowswine")
	var z3 := _zombie(Game.player.pos + Vector3(0, 0, -1.0), 1.0e6, 0.0)
	Game.hit_zombie(z3, false, 10.0, 1.0, true)
	t.check(z3.slow_t > 2.5, "Veuve noire : le couteau englue (%.1f s)" % z3.slow_t)

# ------------------------------------------------------------------ Vautour (statistique)
func _vulture(t: Node) -> void:
	_new(5)
	Game.add_perk("vultureaid")
	var n := 20000
	var dummy := _zombie(Game.player.pos + Vector3(50, 0, 0), 1.0)
	Game.zombies.clear()
	for _i in n:
		Game.pfx.on_kill(Game, dummy)
	var drops: Array = Game.pfx.drops
	var ammo := 0
	for d: Dictionary in drops:
		ammo += 1 if d["type"] == "ammo" else 0
	var rate := float(drops.size()) / n
	t.check(absf(rate - 0.12) < 0.008, "Vautour : %.4f des morts lâchent une goutte (0,12)" % rate)
	t.check(absf(float(ammo) / drops.size() - 0.6) < 0.03, "Vautour : %.3f de munitions (0,6)" % (float(ammo) / drops.size()))
	print("j34 : Vautour sur %d morts : %.2f %% de gouttes, %.1f %% de munitions" % [n, rate * 100.0, float(ammo) * 100.0 / drops.size()])
	# ramassage : munitions puis points
	Game.pfx.drops = [{"id": 1, "pos": Game.player.pos, "type": "ammo", "life": 20.0}]
	var w: WeaponState = Game.arms.current
	w.reserve = 0
	_steps(1)
	t.check(w.reserve == ceili(int(w.cfg["maxReserve"]) * 0.2) and Game.pfx.drops.is_empty(), "Vautour : munitions ramassées (+20 %% de la réserve : %d)" % w.reserve)
	var pts := Game.points
	Game.pfx.drops = [{"id": 2, "pos": Game.player.pos, "type": "points", "life": 20.0}]
	_steps(1)
	t.check(Game.points == pts + 50, "Vautour : +50 points (%d)" % (Game.points - pts))
	Game.pfx.drops = [{"id": 3, "pos": Game.player.pos + Vector3(10, 0, 0), "type": "points", "life": 0.5}]
	_steps(40)
	t.check(Game.pfx.drops.is_empty(), "Vautour : la goutte disparaît")
	# un boss ne lâche rien
	var boss := _zombie(Game.player.pos + Vector3(5, 0, 0), 1.0)
	boss.is_boss = true
	Game.pfx.drops.clear()
	for _i in 500:
		Game.pfx.on_kill(Game, boss)
	t.check(Game.pfx.drops.is_empty(), "Vautour : rien sur les boss")

# ------------------------------------------------------------------ Pierre tombale
func _tombstone(t: Node) -> void:
	_new()
	for id in ["quickrevive", "tombstone", "juggernog", "staminup"]:
		Game.add_perk(id)
	var down_at := Game.player.pos
	Game.player.health = 1.0
	Game.hurt_player(100.0)
	_steps(1)
	t.check(Game.player.downed and Game.arms.perks.is_empty(), "Pierre tombale : à terre, atouts perdus")
	t.check(not Game.pfx.tomb.is_empty() and (Game.pfx.tomb["perks"] as Array).size() == 2, "Pierre tombale : la tombe garde Mastodonte et Stamin-Up (%s)" % [Game.pfx.tomb.get("perks", [])])
	t.check(not (Game.pfx.tomb["perks"] as Array).has("quickrevive") and not (Game.pfx.tomb["perks"] as Array).has("tombstone"), "Pierre tombale : ni la Réanimation rapide ni elle-même")
	_steps(int(4.5 / DT))   # relevé sur la tombe, mais elle n'est prête qu'après 5 s
	t.check(not Game.player.downed and Game.arms.perks.is_empty(), "Pierre tombale : pas encore ramassable")
	Game.player.pos = down_at + Vector3(6, 0, 0)
	_steps(int(1.0 / DT))
	Game.player.pos = down_at
	_steps(2)
	t.check(Game.arms.perks.get("juggernog", false) and Game.arms.perks.get("staminup", false) and Game.pfx.tomb.is_empty(), "Pierre tombale : atouts récupérés")
	t.near(Game.player.max_health, 250.0, "Pierre tombale : Mastodonte de nouveau actif")
	# sans y retourner, elle disparaît
	_new()
	for id in ["quickrevive", "tombstone", "juggernog"]:
		Game.add_perk(id)
	Game.player.health = 1.0
	Game.hurt_player(100.0)
	_steps(1)
	Game.player.pos += Vector3(20, 0, 0)
	_steps(int(92.0 / DT))
	t.check(Game.pfx.tomb.is_empty() and not Game.arms.perks.get("juggernog", false), "Pierre tombale : disparue après 90 s")

# ------------------------------------------------------------------ Ultime Volonté
func _dying_wish(t: Node) -> void:
	_new()
	Game.add_perk("dyingwish")
	Game.player.health = 30.0
	Game.hurt_player(80.0)
	t.check(not Game.player.dead and not Game.player.downed and Game.player.health == 1.0, "Ultime Volonté : coup fatal, debout à 1 PV")
	t.check(Game.pfx.invuln > 3.9 and Game.pfx.wish_cd > 149.0, "Ultime Volonté : invulnérable 4 s, recharge 150 s")
	Game.hurt_player(500.0)
	t.check(Game.player.health == 1.0 and not Game.over, "Ultime Volonté : invulnérable")
	_steps(int(4.2 / DT))
	Game.player.health = 1.0
	Game.hurt_player(500.0)
	t.check(Game.player.dead and Game.over, "Ultime Volonté : en recharge, le coup suivant tue (sans Réanimation rapide)")
	# frappe de zombie : même règle
	_new()
	Game.add_perk("dyingwish")
	Game.player.health = 5.0
	var z := _zombie(Game.player.pos + Vector3(0.7, 0, 0), 1.0e6, 2.0)
	z.skip_spawn()
	var n := 0
	while Game.pfx.wish_cd <= 0.0 and n < 600 and not Game.over:
		_steps(1)
		n += 1
	t.check(not Game.over and Game.pfx.invuln > 0.0, "Ultime Volonté : sauve d'une frappe de zombie")

# ------------------------------------------------------------------ Bastion
func _stronghold(t: Node) -> void:
	_new()
	Game.add_perk("stronghold")
	Game.add_perk("juggernog")
	_steps(int(0.5 / DT))
	var h0 := Game.player.health
	Game.hurt_player(20.0)
	t.near(h0 - Game.player.health, 20.0, "Bastion : pas encore installé (0,5 s) : dégâts pleins")
	_steps(int(1.2 / DT))
	t.check(Game.pfx.anchored(Game), "Bastion : installé après 1,5 s immobile")
	h0 = Game.player.health
	Game.hurt_player(20.0)
	t.near(h0 - Game.player.health, 14.0, "Bastion : dégâts x0,7")
	Game.player.pos += Vector3(4, 0, 0)
	_steps(1)
	t.check(not Game.pfx.anchored(Game), "Bastion : perdu en s'éloignant de 4 m")

# ------------------------------------------------------------------ Sixième sens (statistique)
func _death_perception(t: Node) -> void:
	_new(9)
	Game.add_perk("deathperception")
	var n := 20000
	var crit := 0
	var z := _zombie(Game.player.pos + Vector3(0, 0, -8), 1.0e12)
	for _i in n:
		var h := z.health
		Game.hit_zombie(z, false, 10.0, 1.0)
		if is_equal_approx(h - z.health, 20.0):
			crit += 1
	var rate := float(crit) / n
	t.check(absf(rate - 0.10) < 0.008, "Sixième sens : %.4f de critiques (0,10)" % rate)
	z.health = 1.0e12
	var h2 := z.health
	Game.hit_zombie(z, false, 10.0, 1.0, true)
	t.near(h2 - z.health, 10.0, "Sixième sens : pas de critique au couteau")
	print("j34 : Sixième sens sur %d balles : %.2f %% de critiques" % [n, rate * 100.0])

# ------------------------------------------------------------------ Classique inchangé
## Sans nouvel atout, le code des atouts ne tire aucun nombre au hasard et ne touche à rien : la graine propre aux atouts est intacte après
## 90 s de partie et ses compteurs sont nuls (les golden du JS des autres suites vérifient le reste de la partie).
func _unchanged_without_perks(t: Node) -> void:
	_new(31)
	Game.director.intermission = 0.05
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	var st0 := Game.pfx.rng.state
	for i in int(90.0 / DT):
		Game.step(DT, {"mx": 0.0, "mz": 0.0, "fire": i % 20 < 10})
		Game.player.yaw += 0.01
		for z in Game.zombies:   # morts et touches par le chemin ordinaire (hit_zombie, on_kill)
			if not z.dead and z.spawn_t <= 0.0:
				Game.hit_zombie(z, i % 2 == 0, 30.0, 2.0)
	var used := 0
	for k: String in Game.pfx.stats:
		used += 1 if float(Game.pfx.stats[k]) != 0.0 else 0
	t.check(Game.kills > 0 and Game.pfx.rng.state == st0 and used == 0, "sans nouvel atout : aucun tirage ni effet des atouts (%d tués)" % Game.kills)
	for z in Game.zombies:
		t.check(z.slow_t == 0.0, "sans nouvel atout : aucun zombie ralenti")
