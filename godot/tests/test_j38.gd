extends RefCounted
## v0.33.0 : modes « Contre la montre » (sim/timed_mode.gd) et « Arsenal aléatoire » (sim/arsenal_mode.gd). Propres au port (pas de golden JS) :
##   - menu : les quatre modes sont jouables, réglage `mode` accepté ;
##   - Contre la montre (pur) : chrono de départ, pas de temps, secondes rendues (mort, tête, manche), plafond, fin à 0 ;
##   - Arsenal (pur) : tirage par manche (plafond de prix, pistolet à rayons tardif, jamais deux fois la même arme, reproductible), équipement
##     (une seule arme, chargeur et réserve pleins, niveau de Pack-a-Punch gardé) ;
##   - parties sur la carte : pas d'horloge (pas de finale), portes payantes, chrono qui monte avec les morts et les manches puis TEMPS ÉCOULÉ ;
##     Arsenal : armes murales et boîte fermées, une arme différente à chaque manche, changement différé pendant le Pack-a-Punch ;
##   - statistiques par mode, à part du Classique et de la Zone unique ; Classique inchangé.

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}
const STATS_PATH := "user://test_j38_stats.json"

func run(t: Node) -> void:
	_menu(t)
	_timed_pure(t)
	_arsenal_pure(t)
	_stats(t)
	if not FileAccess.file_exists("res://data/world/objects.json"):
		t.check(true, "j38 : monde cuit absent, parties sautées")
		return
	_timed_game(t)
	_arsenal_game(t)
	_classic_unchanged(t)
	Game.mode = GameMode.CLASSIC

# ------------------------------------------------------------------ menu
func _menu(t: Node) -> void:
	var ids: Array = []
	for m: Dictionary in GameMode.LIST:
		ids.append(m["id"])
		t.check(bool(m["ready"]), "mode %s jouable (plus grisé)" % m["id"])
		t.check(String(m["desc"]).length() > 20 and not String(m["desc"]).contains("Bientôt"), "mode %s : description" % m["id"])
	t.check(ids == ["classic", "zone", "timed", "arsenal"], "quatre modes dans l'ordre du menu (%s)" % [ids])
	t.check(GameMode.valid("timed") == GameMode.TIMED and GameMode.valid("arsenal") == GameMode.ARSENAL and GameMode.valid("x") == GameMode.CLASSIC, "GameMode.valid")
	t.check(GameMode.full_map_variant("timed") and GameMode.full_map_variant("arsenal") and not GameMode.full_map_variant("zone") and not GameMode.full_map_variant("classic"), "modes sur toute la carte")
	var st := Settings.new("user://test_j38_settings.cfg")
	st.autosave = false
	st.set_value("mode", "timed")
	t.check(st.get_value("mode") == "timed", "réglage mode = timed")
	st.set_value("mode", "arsenal")
	t.check(st.get_value("mode") == "arsenal", "réglage mode = arsenal")
	t.check(Config.at("timedMode.start") != null and Config.at("arsenalMode.capBase") != null, "équilibrage des modes dans Config (timedMode, arsenalMode)")
	var txt: String = load("res://scenes/ui/menus.gd").mode_rules_text("timed", {})
	t.check(txt.contains("4:00") and txt.contains("2 s") and txt.contains("15 s") and txt.contains("Aucune partie"), "règles Contre la montre au menu")
	txt = load("res://scenes/ui/menus.gd").mode_rules_text("arsenal", {"games": 2, "best_points": 12345, "best_round": 9, "best_kills": 80, "best_time": 700.0})
	t.check(txt.contains("fermées") and txt.contains("12 345") and txt.contains("manche 9"), "règles et record Arsenal au menu")

# ------------------------------------------------------------------ Contre la montre (pur)
func _timed_pure(t: Node) -> void:
	var tm := TimedMode.new()
	t.near(tm.left, 240.0, "chrono de départ : 4 min")
	t.check(TimedMode.clock_text(tm.left) == "4:00" and TimedMode.clock_text(7.2) == "0:08" and TimedMode.clock_text(0.0) == "0:00" and TimedMode.clock_text(65.0) == "1:05", "affichage du chrono")
	for i in 60:
		tm.step(DT)
	t.near(tm.left, 239.0, "1 s de jeu : 239 s", 1e-4)
	t.near(tm.on_kill(false), 2.0, "mort : +2 s")
	t.near(tm.on_kill(true), 3.0, "mort à la tête : +3 s")
	t.near(tm.on_round_end(), 15.0, "manche finie : +15 s")
	t.near(tm.left, 259.0, "chrono après bonus", 1e-4)
	t.near(tm.gained, 20.0, "secondes rendues : 20", 1e-4)
	tm.left = 599.0
	t.near(tm.on_kill(false), 1.0, "plafond de 10 min : 1 s seulement", 1e-4)
	t.near(tm.left, 600.0, "chrono au plafond", 1e-4)
	t.near(tm.lost, 1.0, "1 s perdue contre le plafond", 1e-4)
	tm.left = 20.0
	t.check(tm.warning(), "alerte sous 30 s")
	var ends := 0
	for i in 60 * 25:
		if tm.step(DT):
			ends += 1
	t.check(tm.expired and ends == 1 and tm.left == 0.0, "le chrono s'arrête une fois à 0 (%d)" % ends)
	t.near(tm.on_kill(true), 0.0, "plus de bonus après la fin")

# ------------------------------------------------------------------ Arsenal (pur)
func _arsenal_pure(t: Node) -> void:
	var p1 := ArsenalMode.pool(1)
	t.check(p1.size() >= 6, "manche 1 : %d armes possibles (%s)" % [p1.size(), p1.keys()])
	for id: String in p1:
		t.check(ArsenalMode.price_of(id) <= 1500, "manche 1 : %s à %d pts au plus 1 500" % [id, ArsenalMode.price_of(id)])
	t.check(not p1.has("raygun") and not p1.has("barrett") and not p1.has("m249"), "manche 1 : ni pistolet à rayons, ni Barrett, ni M249")
	var prev := 0
	for r in range(1, 16):
		var P := ArsenalMode.pool(r)
		t.check(P.size() >= prev, "manche %d : le choix ne rétrécit pas (%d)" % [r, P.size()])
		prev = P.size()
		t.check(P.has("raygun") == (r >= 10), "manche %d : pistolet à rayons %s" % [r, "possible" if r >= 10 else "exclu"])
	t.check(ArsenalMode.pool(8).has("barrett") and not ArsenalMode.pool(7).has("barrett"), "Barrett à partir de la manche 8")
	t.check(ArsenalMode.pool(10).size() == (Config.at("box.pool") as Dictionary).size(), "manche 10 : toutes les armes de la boîte")
	# jamais deux fois de suite la même, reproductible, toutes tirées
	var a := ArsenalMode.new(5)
	var b := ArsenalMode.new(5)
	var same_twice := 0
	var out_of_pool := 0
	var counts := {}
	var last := ""
	var seq_a: Array = []
	var seq_b: Array = []
	for i in 600:
		var r := 1 + (i % 15)
		var x := a.draw(r)
		a.current = x
		seq_a.append(x)
		var y := b.draw(r)
		b.current = y
		seq_b.append(y)
		if x == last:
			same_twice += 1
		last = x
		counts[x] = int(counts.get(x, 0)) + 1
		if not ArsenalMode.pool(r).has(x):
			out_of_pool += 1
	t.check(out_of_pool == 0, "600 tirages : toujours dans le choix de la manche (%d hors choix)" % out_of_pool)
	t.check(same_twice == 0, "jamais deux fois de suite la même arme (%d)" % same_twice)
	t.check(seq_a == seq_b, "même graine : même suite d'armes")
	t.check(counts.size() == (Config.at("box.pool") as Dictionary).size(), "600 tirages : toutes les armes sortent (%d)" % counts.size())
	var c := ArsenalMode.new(6)
	var diff := 0
	for i in 30:
		var x := c.draw(12)
		c.current = x
		diff += 1 if x != seq_a[i] else 0
	t.check(diff > 5, "autre graine : autre suite (%d différences sur 30)" % diff)
	# équipement
	var arms := WeaponArms.new(["rifle", "m1911"])
	arms.inventory[0].pap = 2
	arms.add_perk("mulekick")
	ArsenalMode.equip(arms, "ak47")
	t.check(arms.inventory.size() == 1 and arms.current.id == "ak47" and arms.idx == 0, "équipement : une seule arme (AK-47)")
	t.check(arms.current.pap == 2, "équipement : niveau de Pack-a-Punch gardé (%d)" % arms.current.pap)
	t.check(arms.current.ammo == int(arms.current.cfg["magSize"]) and arms.current.reserve == int(arms.current.cfg["maxReserve"]), "équipement : chargeur et réserve pleins")
	var ar := ArsenalMode.new(1)
	arms.locked = true
	t.check(ar.roll(arms, 2) == "" and ar.pending and arms.current.id == "ak47", "arme dans le Pack-a-Punch : changement en attente")
	arms.locked = false
	var got := ar.poll(arms, 2)
	t.check(got != "" and not ar.pending and arms.current.id == got and ar.round_drawn == 2, "arme rendue : changement appliqué (%s)" % got)
	t.check(ar.roll(arms, 2) == "", "une seule arme par manche")

# ------------------------------------------------------------------ statistiques à part
func _stats(t: Node) -> void:
	var st := GameStats.new(STATS_PATH)
	st.reset()
	var b := st.record_mode("timed", "normal", 7, 90, 9000, 420.0)
	t.check(b.has("best_points") and st.by_diff.is_empty() and st.by_zone.is_empty(), "stats Contre la montre : à part du Classique et de la Zone unique")
	st.record_mode("timed", "hard", 9, 120, 12000, 500.0)
	st.record_mode("arsenal", "easy", 11, 150, 16000, 900.0)
	t.check(st.record_mode("classic", "normal", 3, 3, 3, 3.0).is_empty() and not st.by_mode.has("classic"), "record_mode refuse un autre mode")
	var st2 := GameStats.new(STATS_PATH)
	var e := st2.mode_entry("timed")
	t.check(int(e["games"]) == 2 and int(e["best_round"]) == 9 and int(e["best_points"]) == 12000 and String(e["best_diff"]) == "hard", "stats Contre la montre relues : 2 parties, manche 9, 12 000 points")
	t.near(float(e["total_time"]), 920.0, "stats Contre la montre : temps total")
	t.check(int(st2.mode_entry("arsenal")["best_kills"]) == 150, "stats Arsenal relues")
	t.check(st2.total_games() == 3, "parties comptées (%d)" % st2.total_games())
	# un fichier v2 (sans « modes ») se relit
	var f := FileAccess.open(STATS_PATH, FileAccess.WRITE)
	f.store_string(JSON.stringify({"version": 2, "difficulties": {"normal": {"games": 4}}, "zones": {}}))
	f.close()
	var st3 := GameStats.new(STATS_PATH)
	t.check(st3.by_mode.is_empty() and int(st3.entry("normal")["games"]) == 4, "fichier v2 relu (pas de modes)")
	st3.reset()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(STATS_PATH))

# ------------------------------------------------------------------ parties
func _new(mode: String, seed_value: int) -> void:
	Game.mode = mode
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9

## Fait avancer la partie jusqu'à la manche `upto` en tuant les zombies (à la tête si `head`). Renvoie le nombre de pas.
func _play_rounds(upto: int, head := true, max_steps := 60 * 400) -> int:
	var n := 0
	while Game.round_number < upto and n < max_steps and not Game.over:
		Game.step(DT, IDLE)
		n += 1
		for z in Game.zombies:
			if not z.dead and z.spawn_t <= 0.0:
				Game.hit_zombie(z, head, 1.0e6, 1.0)
	return n

func _no_clock(t: Node, label: String) -> void:
	var clocks := 0
	for m: Dictionary in Game.machines.list:
		clocks += 1 if m["type"] == "clock" else 0
	t.check(clocks == 0 and Game.machines.list.size() == Game.world.objects["machines"].size() - 1, "%s : toutes les machines sauf l'horloge (pas de finale)" % label)

func _timed_game(t: Node) -> void:
	_new(GameMode.TIMED, 4)
	t.check(Game.timed != null and Game.arsenal == null and Game.gm == null and Game.mode_id() == GameMode.TIMED, "Contre la montre : partie lancée")
	t.check(not Game.world.sealed and Game.player.pos.distance_to(Game.world.start_pos) < 0.01, "Contre la montre : toute la carte, départ d'origine")
	_no_clock(t, "Contre la montre")
	t.check(Game.arms.inventory.size() == 2, "Contre la montre : armes de départ")
	var bonus := [0.0, 0, 0]
	var cb := func(n: String, d: Dictionary) -> void:
		if n == "time_bonus":
			bonus[0] += float(d["seconds"])
			if bool(d["round"]):
				bonus[2] += 1
			else:
				bonus[1] += 1
	Game.mode_event.connect(cb)
	var k0 := Game.kills
	_play_rounds(4, true)
	var kills := Game.kills - k0
	var t_game := Game.time
	t.check(Game.round_number >= 4 and kills > 20, "Contre la montre : 3 manches jouées (%d tués)" % kills)
	t.check(bonus[1] == kills and bonus[2] == 3, "Contre la montre : un bonus par mort (%d / %d) et par manche finie (%d)" % [bonus[1], kills, bonus[2]])
	t.near(float(bonus[0]), kills * 3.0 + 3 * 15.0, "Contre la montre : secondes rendues = 3 x morts à la tête + 15 x manches", 1e-4)
	t.near(Game.timed.left, minf(600.0, 240.0 - t_game + float(bonus[0])), "Contre la montre : chrono = départ - temps de jeu + bonus", 1e-3)
	# une porte payante s'achète (toute la carte)
	var d: Dictionary = Game.world.doors[28]
	Game.player.pos = Vector3(float(d["points"][0][0]), 0, float(d["points"][0][1]) + 0.5)
	Game.points = 100000
	t.check(Game.use_door() == 28, "Contre la montre : la porte 28 s'achète")
	# fin : temps écoulé
	Game.timed.left = 0.5
	var overs := [0]
	var cb2 := func() -> void: overs[0] += 1
	Game.game_over.connect(cb2)
	for i in 60:
		Game.step(DT, IDLE)
	Game.game_over.disconnect(cb2)
	Game.mode_event.disconnect(cb)
	t.check(Game.over and Game.time_up and not Game.escaped and overs[0] == 1, "Contre la montre : TEMPS ÉCOULÉ, fin de partie (une fois)")
	var tt := Game.time
	Game.step(DT, {"mx": 0.0, "mz": 1.0})
	t.check(Game.time == tt, "Contre la montre : partie figée après la fin")

func _arsenal_game(t: Node) -> void:
	_new(GameMode.ARSENAL, 8)
	var ar: ArsenalMode = Game.arsenal
	t.check(ar != null and Game.timed == null and Game.gm == null and Game.mode_id() == GameMode.ARSENAL, "Arsenal : partie lancée")
	_no_clock(t, "Arsenal")
	t.check(Game.arms.inventory.size() == 1 and Game.arms.current.id == ar.current and ArsenalMode.pool(1).has(ar.current), "Arsenal : une arme de la manche 1 au départ (%s)" % ar.current)
	t.check(Game.arms.current.reserve == int(Game.arms.current.cfg["maxReserve"]), "Arsenal : réserve pleine")
	# armes murales fermées
	var ww: Dictionary = Game.world.objects["wallWeapons"][0]
	Game.player.pos = Vector3(float(ww["pos"]["x"]), 0, float(ww["pos"]["z"]))
	Game.points = 50000
	var id0 := Game.arms.current.id
	if not WeaponShop.near_wall_weapon(Game).is_empty() and Game.machines.near().is_empty() and not WeaponShop.near_station(Game):
		t.check(Prompts.text(Game).contains("fermées"), "Arsenal : invite « armes murales fermées » (« %s »)" % Prompts.text(Game))
		Game.interact()
		t.check(Game.points == 50000 and Game.arms.inventory.size() == 1 and Game.arms.current.id == id0, "Arsenal : arme murale ni achetée ni rechargée")
	else:
		t.check(false, "Arsenal : arme murale de test introuvable seule")
	# boîte fermée
	var box: Dictionary = Game.machines.box.active_box()
	Game.player.pos = Vector3(float(box["pos"]["x"]) + sin(float(box["yaw"])) * 1.5, 0, float(box["pos"]["z"]) + cos(float(box["yaw"])) * 1.5)
	t.check(Game.machines.near() == box and Game.machines.prompt().contains("fermée"), "Arsenal : invite « boîte fermée » (« %s »)" % Game.machines.prompt())
	Game.interact()
	t.check(Game.points == 50000 and Game.machines.box.roll.is_empty(), "Arsenal : la boîte ne s'ouvre pas")
	# une arme différente à chaque manche
	var seen: Array = [Game.arms.current.id]
	var events := [0]
	var cb := func(n: String, _d: Dictionary) -> void:
		if n == "arsenal_weapon":
			events[0] += 1
	Game.mode_event.connect(cb)
	for r in range(2, 7):
		_play_rounds(r, false)
		t.check(Game.round_number == r and ar.round_drawn == r, "Arsenal : manche %d tirée" % r)
		t.check(Game.arms.inventory.size() == 1 and Game.arms.current.id == ar.current and ar.current != seen[-1], "Arsenal manche %d : %s remplace %s" % [r, ar.current, seen[-1]])
		t.check(ArsenalMode.pool(r).has(ar.current), "Arsenal manche %d : %s dans le choix de la manche" % [r, ar.current])
		seen.append(ar.current)
	t.check(events[0] == 5, "Arsenal : une annonce par manche (%d)" % events[0])
	# arme dans le Pack-a-Punch au début de la manche : le changement attend
	Game.arms.locked = true
	var before := Game.arms.current.id
	_play_rounds(7, false)
	t.check(Game.round_number == 7 and ar.pending and Game.arms.current.id == before, "Arsenal : changement en attente pendant le Pack-a-Punch")
	Game.arms.locked = false
	Game.step(DT, IDLE)
	t.check(not ar.pending and ar.round_drawn == 7 and Game.arms.current.id != before, "Arsenal : changement appliqué à la sortie du Pack-a-Punch (%s)" % Game.arms.current.id)
	Game.mode_event.disconnect(cb)
	print("j38 : arsenal %s" % [ar.history])

func _classic_unchanged(t: Node) -> void:
	_new(GameMode.CLASSIC, 3)
	t.check(Game.timed == null and Game.arsenal == null and Game.gm == null and Game.mode_id() == GameMode.CLASSIC, "Classique : aucun mode")
	var clocks := 0
	for m: Dictionary in Game.machines.list:
		clocks += 1 if m["type"] == "clock" else 0
	t.check(clocks == 1, "Classique : l'horloge de la finale est là")
	t.check(Game.arms.inventory.size() == 2 and Game.arms.inventory[0].id == "rifle", "Classique : armes de départ")
	var ww: Dictionary = Game.world.objects["wallWeapons"][0]
	Game.player.pos = Vector3(float(ww["pos"]["x"]), 0, float(ww["pos"]["z"]))
	t.check(not Prompts.text(Game).contains("fermées"), "Classique : armes murales ouvertes")
