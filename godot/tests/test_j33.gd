extends RefCounted
## v0.26.0 : mode « Zone unique » (sim/game_mode.gd, sim/zone_layout.gd). Propre au port (pas de golden JS) :
##   - disposition des 27 zones : départ et porte de sortie dans la zone jouable, jeu de base ajouté là où il manque, machines espacées ;
##   - confinement : portes murées (ni invite, ni achat, ni ouverture), seule la zone est ouverte, le joueur bute contre chaque passage muré,
##     toutes les apparitions de plusieurs manches sont dans la zone et hors du champ de vision au moment de l'apparition ;
##   - victoire : la porte de sortie refuse sans les points, puis termine la partie (« évasion ») ; statistiques par zone à part ;
##   - Classique inchangé (aucun mode posé : portes payantes, pas de GameMode).

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}
const STATS_PATH := "user://test_j33_stats.json"

func run(t: Node) -> void:
	if not FileAccess.file_exists("res://data/world/objects.json"):
		t.check(true, "j33 : monde cuit absent, suite sautée")
		return
	_layouts(t)
	_classic_unchanged(t)
	_confinement(t, 2)    # Rue des Orfèvres : la plus petite zone (698 m2)
	_confinement(t, 5)    # Place Kléber
	_victory(t)
	_box_alone(t)
	_stats(t)
	Game.mode = GameMode.CLASSIC

# ------------------------------------------------------------------ disposition des 27 zones
func _layouts(t: Node) -> void:
	var w := World.load_world()
	var objs: Dictionary = w.objects
	t.check(w.zone_names.size() == Settings.ZONE_COUNT, "27 zones (%d)" % w.zone_names.size())
	t.check(ZoneCatalog.count() == w.zone_names.size(), "catalogue du menu : %d zones" % ZoneCatalog.count())
	for zi in w.zone_names.size():
		var gm := GameMode.new(GameMode.ZONE, zi)
		var ok := gm.setup(w)
		t.check(ok, "zone %d : mise en place" % zi)
		if not ok:
			continue
		var nw := 0
		for ww: Dictionary in objs["wallWeapons"]:
			if int(ww["zone"]) == zi:
				nw += 1
				if ww.get("added", false):
					t.check(gm.layout.contains(w.nav, float(ww["pos"]["x"]), float(ww["pos"]["z"])), "zone %d : arme murale ajoutée dans la zone" % zi)
		t.check(nw >= 1, "zone %d (%s) : au moins une arme murale (%d, ajoutée : %d)" % [zi, w.zone_names[zi], nw, gm.added_walls.size()])
		t.check(gm.added_walls.size() == (1 if zi == 8 else 0), "zone %d : MP5 ajouté seulement à l'Intérieur de la Cathédrale (%d)" % [zi, gm.added_walls.size()])
		var L := gm.layout
		t.check(w.sealed and w.zone_open.count(1) == 1 and w.is_zone_open(zi), "zone %d : seule la zone est ouverte" % zi)
		t.check(L.area > 300.0, "zone %d : composante jouable %.0f m2" % [zi, L.area])
		var ex := Vector2(float(gm.exit["pos"]["x"]), float(gm.exit["pos"]["z"]))
		t.check(L.contains(w.nav, ex.x, ex.y) and w.zone_of(ex.x, ex.y) == zi, "zone %d : porte de sortie dans la zone (%.1f ; %.1f)" % [zi, ex.x, ex.y])
		t.check(ex.distance_to(L.centroid) < sqrt(L.area) * 0.75, "zone %d : sortie près du milieu (%.1f m du centroïde)" % [zi, ex.distance_to(L.centroid)])
		t.check(L.contains(w.nav, gm.start.x, gm.start.z), "zone %d : départ dans la zone" % zi)
		var ds := Vector2(gm.start.x, gm.start.z).distance_to(ex)
		t.check(ds > 2.2 and ds < 9.0, "zone %d : départ à %.1f m de la sortie" % [zi, ds])
		var f := Vector2(-sin(gm.start_yaw), -cos(gm.start_yaw))
		t.check(f.dot((ex - Vector2(gm.start.x, gm.start.z)).normalized()) > 0.99, "zone %d : le joueur regarde la sortie au départ" % zi)
		t.check(not L.windows.is_empty() or L.ground.size() > 20, "zone %d : points d'apparition (%d fenêtres, %d au sol)" % [zi, L.windows.size(), L.ground.size()])
		var list := gm.filter_machines(objs["machines"])
		var has_box := false
		var has_perk := false
		var n_exit := 0
		var pts: Array[Vector2] = []
		for m: Dictionary in list:
			t.check(String(m["type"]) != "clock", "zone %d : pas d'horloge (pas de finale)" % zi)
			t.check(int(m["zone"]) == zi, "zone %d : machine %s de la zone" % [zi, m["type"]])
			has_box = has_box or m["type"] == "box"
			has_perk = has_perk or m["type"] == "perk"
			n_exit += 1 if m["type"] == "exit" else 0
			var q := Vector2(float(m["pos"]["x"]), float(m["pos"]["z"]))
			if m.get("added", false):
				t.check(L.contains(w.nav, q.x, q.y), "zone %d : machine ajoutée %s dans la zone" % [zi, m.get("id", m["type"])])
				for o: Vector2 in pts:
					t.check(q.distance_to(o) > 2.4, "zone %d : machine ajoutée espacée (%.1f m)" % [zi, q.distance_to(o)])
			pts.append(q)
		t.check(has_box and has_perk and n_exit == 1, "zone %d : boîte, atout et une porte de sortie (boîte %s, atout %s, sorties %d)" % [zi, has_box, has_perk, n_exit])
	print("j33 : 27 zones disposées")

# ------------------------------------------------------------------ Classique
func _classic_unchanged(t: Node) -> void:
	Game.mode = GameMode.CLASSIC
	Game.new_game(3, "strasbourg", Config.at("startWeapons", []))
	t.check(Game.gm == null and not Game.world.sealed, "Classique : aucun mode Zone unique")
	t.check(Game.player.pos.distance_to(Game.world.start_pos) < 0.01, "Classique : départ d'origine")
	var n_clock := 0
	for m: Dictionary in Game.machines.list:
		n_clock += 1 if m["type"] == "clock" else 0
	t.check(n_clock == 1 and Game.machines.list.size() == Game.world.objects["machines"].size(), "Classique : toutes les machines de la carte (%d)" % Game.machines.list.size())
	var d: Dictionary = Game.world.doors[28]
	Game.player.pos = Vector3(float(d["points"][0][0]), 0, float(d["points"][0][1]) + 0.5)
	Game.points = 100000
	t.check(Game.world.near_door(Game.player.pos) == 28 and Game.use_door() == 28, "Classique : la porte 28 s'achète")

# ------------------------------------------------------------------ confinement
func _new_zone(zi: int, seed_value := 7) -> void:
	Game.mode = GameMode.ZONE
	Game.zone_pick = zi
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))

func _confinement(t: Node, zi: int) -> void:
	_new_zone(zi)
	var w: World = Game.world
	var gm: GameMode = Game.gm
	t.check(gm != null and gm.zone == zi and w.sealed, "zone %d : partie Zone unique" % zi)
	if gm == null:
		return
	t.check(w.zone_of(Game.player.pos.x, Game.player.pos.z) == zi, "zone %d : le joueur commence dans la zone" % zi)
	# portes murées : ni invite d'achat, ni achat, ni ouverture
	Game.points = 1000000
	var sealed := 0
	for d: Dictionary in w.doors:
		if int(d["a"]) != zi and int(d["b"]) != zi:
			continue
		sealed += 1
		for k: float in d["segs"]:   # chaque passage fermé par la porte (segments de collision)
			var sg: Dictionary = w.seg_list[int(k)]
			var a0 := Vector2(float(sg["ax"]), float(sg["az"]))
			var a1 := Vector2(float(sg["bx"]), float(sg["bz"]))
			if a0.distance_to(a1) < 1.0:
				continue
			var mid := (a0 + a1) * 0.5
			var nrm := (a1 - a0).normalized().orthogonal()
			if w.zone_of(mid.x + nrm.x * 2.5, mid.y + nrm.y * 2.5) != zi:
				nrm = -nrm
			var inside := mid + nrm * 2.5
			if w.nav.is_blocked_at(inside.x, inside.y) or w.zone_of(inside.x, inside.y) != zi:
				continue
			Game.player.pos = Vector3(inside.x, 0, inside.y)
			Game.player.vel = Vector3.ZERO
			t.check(w.near_door(Game.player.pos) < 0 and w.near_sealed(Game.player.pos) >= 0, "zone %d porte %d : murée (pas d'achat)" % [zi, int(d["id"])])
			var p0 := Game.points
			Game.interact()
			t.check(not d["open"] and Game.points == p0, "zone %d porte %d : E ne l'ouvre pas" % [zi, int(d["id"])])
			t.check(Prompts.text(Game).contains("muré"), "zone %d porte %d : invite « Passage muré » (« %s »)" % [zi, int(d["id"]), Prompts.text(Game)])
			var to := mid - inside
			Game.player.yaw = atan2(-to.x, -to.y)
			for _i in 240:   # 4 s de course droit sur le passage muré
				Game.step(DT, {"mx": 0.0, "mz": 1.0, "sprint": true})
			var side := (Vector2(Game.player.pos.x, Game.player.pos.z) - mid).dot(nrm)
			t.check(side > 0.0, "zone %d porte %d : le joueur bute contre le mur (côté zone, %.2f m)" % [zi, int(d["id"]), side])
	t.check(sealed >= 2, "zone %d : %d portes murées éprouvées" % [zi, sealed])
	t.check(not w.open_door(0), "zone %d : open_door refusé" % zi)
	# apparitions : 3 manches, le joueur immobile près de la sortie
	_new_zone(zi, 21)
	w = Game.world
	gm = Game.gm
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	var spawned := [0, 0, 0]   # total, hors zone, vus
	var cb := func(z: ZombieSim) -> void:
		spawned[0] += 1
		var at: Vector3 = z.spawn_outside if z.spawn_type == "window" else z.pos
		var ok := false
		if z.spawn_type == "window":
			ok = int(w.windows[z.spawn_window * World.WIN_STRIDE + 8]) == zi
		else:
			ok = w.zone_of(at.x, at.z) == zi
		if not ok:
			spawned[1] += 1
		if gm.seen(Game, z.spawn_center if z.spawn_type == "window" else z.pos + Vector3(0, 1.0, 0)):
			spawned[2] += 1
	Game.zombie_spawned.connect(cb)
	var t_end := 0
	while Game.round_number < 3 and t_end < 60 * 300:
		Game.step(DT, IDLE)
		t_end += 1
		if t_end % 30 == 0:   # le joueur tourne sur lui-même : les apparitions doivent éviter son regard
			Game.player.yaw += 0.35
		for z in Game.zombies:   # on les tue pour faire avancer les manches
			if not z.dead and z.spawn_t <= 0.0:
				Game.hit_zombie(z, true, 1.0e6, 1.0)
	Game.zombie_spawned.disconnect(cb)
	t.check(Game.round_number >= 3, "zone %d : 3 manches jouées (%d)" % [zi, Game.round_number])
	t.check(spawned[0] >= 15 and spawned[1] == 0, "zone %d : %d apparitions, %d hors zone" % [zi, spawned[0], spawned[1]])
	t.check(spawned[2] <= spawned[0] / 10, "zone %d : apparitions vues %d / %d (repli des petites zones toléré : 10 %%)" % [zi, spawned[2], spawned[0]])
	for z in Game.zombies:
		t.check(z.dead or w.zone_of(z.pos.x, z.pos.z) == zi or z.spawn_t > 0.0, "zone %d : zombie dans la zone" % zi)
	print("j33 : zone %d (%s) : %d apparitions, %d hors zone, %d vues" % [zi, gm.zone_name, spawned[0], spawned[1], spawned[2]])

# ------------------------------------------------------------------ victoire
func _exit_machine() -> Dictionary:
	for m: Dictionary in Game.machines.list:
		if m["type"] == "exit":
			return m
	return {}

func _victory(t: Node) -> void:
	_new_zone(0, 5)
	var ex := _exit_machine()
	t.check(not ex.is_empty() and int(ex["price"]) == GameMode.exit_price(), "porte de sortie : %s pts" % ex.get("price", "?"))
	var price := GameMode.exit_price()
	t.check(price >= 10000 and price <= 25000, "prix de sortie dans [10 000 ; 25 000] (%d)" % price)
	Game.player.pos = Vector3(float(ex["pos"]["x"]) + sin(float(ex["yaw"])) * 1.8, 0, float(ex["pos"]["z"]) + cos(float(ex["yaw"])) * 1.8)
	t.check(Game.machines.near() == ex and Game.machines.prompt().contains("SORTIE"), "invite de la porte de sortie : « %s »" % Game.machines.prompt())
	Game.points = price - 1
	var denied := [0]
	var cb := func(_p): denied[0] += 1
	Game.purchase_denied.connect(cb)
	Game.interact()
	Game.purchase_denied.disconnect(cb)
	t.check(not Game.over and not Game.escaped and denied[0] == 1 and Game.points == price - 1, "sortie refusée à %d points" % (price - 1))
	var over := [0]
	var cb2 := func() -> void: over[0] += 1
	Game.game_over.connect(cb2)
	Game.points = price + 250
	Game.interact()
	Game.game_over.disconnect(cb2)
	t.check(Game.over and Game.escaped and over[0] == 1 and Game.points == 250, "sortie achetée : victoire (évasion), %d points restants" % Game.points)
	t.check(Game.mode_id() == GameMode.ZONE, "mode de la partie : zone")
	var hp := Game.player.health
	Game.step(DT, {"mx": 0.0, "mz": 1.0})
	t.check(Game.player.health == hp, "après l'évasion la partie est figée")

# ------------------------------------------------------------------ boîte seule
func _box_alone(t: Node) -> void:
	_new_zone(2, 9)   # Rue des Orfèvres : une seule boîte
	var box: MysteryBox = Game.machines.box
	t.check(box.boxes.size() == 1 and box.stay_alone, "zone 2 : une seule boîte (%d)" % box.boxes.size())
	box.uses = 0
	box.limit = 1
	var pts0 := 5000
	Game.points = pts0
	var m := box.active_box()
	Game.player.pos = Vector3(float(m["pos"]["x"]) + sin(float(m["yaw"])) * 1.5, 0, float(m["pos"]["z"]) + cos(float(m["yaw"])) * 1.5)
	box.buy(Game)
	for _i in 60 * 8:
		Game.step(DT, IDLE)
	t.check(box.move.is_empty() and box.active == 0 and box.uses == 0 and box.limit >= 1, "nounours sans autre emplacement : la boîte reste, compteur remis à zéro")
	t.check(Game.points == pts0, "nounours : remboursé (%d)" % Game.points)

# ------------------------------------------------------------------ statistiques à part
func _stats(t: Node) -> void:
	var st := GameStats.new(STATS_PATH)
	st.reset()
	var b := st.record_zone("Place Kléber", "normal", 9, 120, 14000, 600.0, false)
	t.check(b.has("best_round") and st.by_diff.is_empty(), "stats Zone unique : à part du Classique")
	st.record_zone("Place Kléber", "hard", 12, 200, 26000, 900.0, true)
	st.record_zone("Place Kléber", "normal", 13, 220, 27000, 1200.0, true)
	var e := st.zone_entry("Place Kléber")
	t.check(int(e["games"]) == 3 and int(e["escapes"]) == 2 and int(e["best_round"]) == 13 and is_equal_approx(float(e["fastest"]), 900.0), "stats Zone unique : 3 parties, 2 évasions, la plus rapide 900 s")
	var st2 := GameStats.new(STATS_PATH)
	var e2 := st2.zone_entry("Place Kléber")
	t.check(int(e2["escapes"]) == 2 and int(e2["best_points"]) == 27000 and String(e2["best_diff"]) == "normal", "stats Zone unique : relues du fichier")
	t.check(st2.total_games() == 3, "stats : parties comptées (%d)" % st2.total_games())
	st2.reset()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(STATS_PATH))
