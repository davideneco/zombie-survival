extends RefCounted
## v0.33.1 : contrôles du mobilier urbain ajouté (sim/street_furniture.gd, data/street_furniture.json, scenes/world/furniture_view.gd), appelés par la
## suite j30 (géométrie de la ville) :
##   - le fichier est là, les sortes sont connues, rien dans la cathédrale ni sur son parvis, aucun objet sur un autre ;
##   - collision : chaque objet bloque (sonde poussée hors de l'emprise, joueur qui court dessus arrêté) ; toute la partie VISIBLE à hauteur du corps
##     (sous 2,2 m) est dans l'emprise de collision (rien de traversable) ;
##   - hors des passages : loin des portes, fenêtres d'apparition, machines, armes murales, bornes, voies du tram, escaliers, départ et portes de
##     sortie de la Zone unique ; et AUCUN CHEMIN COUPÉ : composantes connexes de la grille de navigation (portes fermées : le cas le plus strict)
##     avant / après avoir bloqué les cases à moins de 0,5 m d'un objet (marge des murs = rayon du joueur et des zombies + 10 cm) : chaque
##     composante reste d'un seul tenant ;
##   - apparitions : aucun point au sol tiré dans le mobilier ; les golden (set_extras(false)) ne voient pas le mobilier.

const FurnitureView := preload("res://scenes/world/furniture_view.gd")
const MARGIN := 0.5

func run(t: Node) -> void:
	var items := StreetFurniture.list()
	t.check(items.size() >= 200, "mobilier : %d objets (data/street_furniture.json)" % items.size())
	if items.is_empty():
		return
	var w := World.load_world()
	t.check(w.furniture.size() == items.size() and not w.furniture_col.is_empty(), "mobilier : chargé avec sa collision (%d éléments)" % w.furniture_col.size())
	var counts := {}
	var bad_kind := 0
	var in_cath := 0
	for it: Dictionary in items:
		var k := String(it["kind"])
		counts[k] = int(counts.get(k, 0)) + 1
		if not StreetFurniture.KINDS.has(k):
			bad_kind += 1
			continue
		var zi := w.zone_of(float(it["x"]), float(it["z"]))
		if zi == 7 or zi == 8:
			in_cath += 1
	t.check(bad_kind == 0, "mobilier : sortes connues")
	t.check(counts.size() == StreetFurniture.KINDS.size(), "mobilier : les %d sortes sont posées %s" % [StreetFurniture.KINDS.size(), counts])
	t.check(in_cath == 0, "mobilier : rien dans la cathédrale ni sur son parvis (%d)" % in_cath)
	_visual_inside(t)
	_collision(t, w, items)
	_clearances(t, w, items)
	_paths(t, w, items)
	_spawns(t, w, items)
	print("j30 : mobilier urbain %s" % [counts])

## La partie visible sous 2,2 m de chaque modèle tient dans l'emprise de collision (+3 cm).
func _visual_inside(t: Node) -> void:
	for kind: String in StreetFurniture.KINDS:
		var g = FurnitureView.builder(kind)
		var K: Dictionary = StreetFurniture.KINDS[kind]
		var out := 0
		var top := 0.0
		for v: Vector3 in g.verts:
			top = maxf(top, v.y)
			if v.y > 2.2:
				continue
			var d := StreetFurniture.dist_to({"kind": kind, "x": 0.0, "z": 0.0, "yaw": 0.0}, v.x, v.z)
			if d > 0.03:
				out += 1
		t.check(out == 0, "%s : partie visible sous 2,2 m dans la collision (%d sommets dehors)" % [kind, out])
		t.check(g.triangle_count() > 20 and g.triangle_count() < 3000, "%s : %d triangles" % [kind, g.triangle_count()])
		t.check(top <= float(K["h"]) + 0.3 or kind in ["kiosk", "lamp"], "%s : hauteur visible %.2f m pour une collision de %.2f m" % [kind, top, float(K["h"])])

func _collision(t: Node, w: World, items: Array) -> void:
	var col := w.collision
	var miss := 0
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for it: Dictionary in items:   # rayon (à 0,5 m de haut) tiré depuis la rue (avant de l'objet, +z local, à 1,5 m de son emprise, à 25° près) : il touche le bord de l'emprise
		var c := Vector2(float(it["x"]), float(it["z"]))
		var a := float(it["yaw"]) + (rng.randf() - 0.5) * deg_to_rad(50.0)
		var d := -Vector2(sin(a), cos(a))
		var from := c - d * (StreetFurniture.radius(String(it["kind"])) + 1.5)
		var hit := col.ray_hit(from.x, 0.5, from.y, d.x, 0.0, d.y, 6.0)
		var q := from + d * hit
		if hit >= 6.0 or StreetFurniture.dist_to(it, q.x, q.y) > 0.06:
			miss += 1
	t.check(miss == 0, "mobilier : chaque objet a sa collision, au bord de son emprise (%d sans)" % miss)
	# aucun objet sur un autre
	var overlap := 0
	for i in items.size():
		var a: Dictionary = items[i]
		for j in range(i + 1, items.size()):
			var b: Dictionary = items[j]
			var d := Vector2(float(a["x"]) - float(b["x"]), float(a["z"]) - float(b["z"])).length()
			if d < StreetFurniture.radius(String(a["kind"])) + StreetFurniture.radius(String(b["kind"])) - 0.05 and String(a["kind"]) != "bollard":
				overlap += 1
	t.check(overlap == 0, "mobilier : aucun objet sur un autre (%d)" % overlap)
	# un joueur qui court droit sur un banc et sur un kiosque s'arrête devant
	Game.mode = GameMode.CLASSIC
	Game.new_game(2, "strasbourg", [], w)
	for kind in ["bench", "kiosk", "barrier"]:
		var it: Dictionary = {}
		for o: Dictionary in items:
			if o["kind"] == kind:
				it = o
				break
		if it.is_empty():
			continue
		var yaw := float(it["yaw"])
		var fwd := Vector2(sin(yaw), cos(yaw))   # avant de l'objet (+z local) : la rue
		var c := Vector2(float(it["x"]), float(it["z"]))
		var from := c + fwd * 3.5
		Game.player.pos = Vector3(from.x, 0, from.y)
		Game.player.vel = Vector3.ZERO
		var to := c - from
		Game.player.yaw = atan2(-to.x, -to.y)
		for _i in 150:
			Game.step(1.0 / 60.0, {"mx": 0.0, "mz": 1.0, "sprint": true})
		var pp := Vector2(Game.player.pos.x, Game.player.pos.z)
		var dist := StreetFurniture.dist_to(it, pp.x, pp.y)
		t.check(dist > 0.3, "%s (%.1f ; %.1f) : le joueur qui court dessus s'arrête devant (%.2f m)" % [kind, c.x, c.y, dist])
	Game.mode = GameMode.CLASSIC

## Distances aux choses du jeu.
func _clearances(t: Node, w: World, items: Array) -> void:
	var pts: Array = []   # [Vector2, rayon, nom]
	for d: Dictionary in w.doors:
		for pt: Array in d["points"]:
			pts.append([Vector2(float(pt[0]), float(pt[1])), 5.0, "porte %d" % int(d["id"])])
	for i in w.window_count():
		var wo := w.window_outside(i)
		pts.append([Vector2(wo.x, wo.z), 3.5, "fenêtre %d" % i])
	for m: Dictionary in w.objects["machines"]:
		pts.append([Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])), 4.0, "machine %s" % m.get("id", m["type"])])
	for ww: Dictionary in w.objects["wallWeapons"]:
		pts.append([Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])), 4.0, "arme murale %s" % ww["id"]])
	for s: Dictionary in w.objects["stations"]:
		pts.append([Vector2(float(s["x"]), float(s["z"])), 4.0, "borne de munitions"])
	for v: Dictionary in w.objects["vehicleSpawns"]:
		pts.append([Vector2(float(v["x"]), float(v["z"])), 6.0, "véhicule"])
	pts.append([Vector2(w.start_pos.x, w.start_pos.z), 8.0, "départ"])
	for l: Dictionary in w.levels.links:
		for p: Array in l["path"]:
			pts.append([Vector2(float(p[0]), float(p[2])), 5.0, "escalier"])
	if Game.rides != null:
		var tmp := {}
		for tk: TramTrack in Game.rides.net.get("tracks", []):
			var s := 0.0
			while s <= tk.L:
				tk.at(s, tmp)
				pts.append([Vector2(float(tmp["x"]), float(tmp["z"])), 4.5, "voie du tram"])
				s += 1.5
	var w2 := World.load_world()
	for zi in w2.zone_names.size():
		var gm := GameMode.new(GameMode.ZONE, zi)
		if gm.setup(w2):
			pts.append([Vector2(float(gm.exit["pos"]["x"]), float(gm.exit["pos"]["z"])), 7.0, "sortie de la zone %d" % zi])
	var grid := {}
	for i in pts.size():
		var p: Vector2 = pts[i][0]
		var k := int(floor(p.x / 10.0)) * 4096 + int(floor(p.y / 10.0))
		if not grid.has(k):
			grid[k] = []
		grid[k].append(i)
	var bad: Array = []
	for it: Dictionary in items:
		var q := Vector2(float(it["x"]), float(it["z"]))
		var r := StreetFurniture.radius(String(it["kind"]))
		for ix in range(int(floor(q.x / 10.0)) - 1, int(floor(q.x / 10.0)) + 2):
			for iz in range(int(floor(q.y / 10.0)) - 1, int(floor(q.y / 10.0)) + 2):
				for i: int in grid.get(ix * 4096 + iz, []):
					if q.distance_to(pts[i][0]) < float(pts[i][1]) + r - 1e-3:
						bad.append("%s (%.1f ; %.1f) trop près de : %s" % [it["kind"], q.x, q.y, pts[i][2]])
	t.check(bad.is_empty(), "mobilier hors des passages du jeu (%d écarts%s)" % [bad.size(), (" : " + bad[0]) if not bad.is_empty() else ""])

## Aucun chemin coupé : composantes connexes avant / après le mobilier (portes fermées).
func _paths(t: Node, w: World, items: Array) -> void:
	var nav := w.nav
	var t0 := Time.get_ticks_msec()
	var before: PackedInt32Array = nav.components()["labels"].duplicate()
	var marked := nav.blocked.duplicate()
	var n_marked := 0
	for it: Dictionary in items:
		var r := StreetFurniture.radius(String(it["kind"])) + MARGIN
		for iz in range(nav.cz(float(it["z"]) - r), nav.cz(float(it["z"]) + r) + 1):
			for ix in range(nav.cx(float(it["x"]) - r), nav.cx(float(it["x"]) + r) + 1):
				if not nav.inside(ix, iz):
					continue
				var i := nav.idx(ix, iz)
				if marked[i] == 0 and StreetFurniture.dist_to(it, nav.world_x(ix), nav.world_z(iz)) < MARGIN:
					marked[i] = 1
					n_marked += 1
	var g2 := NavGrid.new()
	g2.nx = nav.nx
	g2.nz = nav.nz
	g2.blocked = marked
	var after: PackedInt32Array = g2.components()["labels"]
	var map := {}
	var split := {}
	for i in after.size():
		var la := after[i]
		if la == 0:
			continue
		var lb := before[i]
		if map.has(lb):
			if map[lb] != la:
				split[lb] = i
		else:
			map[lb] = la
	var where := ""
	for lb: int in split:
		var i: int = split[lb]
		where = " ; ex. (%.1f ; %.1f)" % [nav.world_x(i % nav.nx), nav.world_z(i / nav.nx)]
		break
	t.check(split.is_empty(), "mobilier : aucun passage coupé (composantes coupées en deux : %d%s ; %d cases sous le mobilier)" % [split.size(), where, n_marked])
	# composante principale (portes ouvertes) : seules les cases sous le mobilier en sortent
	var w3 := World.load_world()
	w3.open_all_doors()
	var n3 := w3.nav
	var lab3: PackedInt32Array = n3.components()["labels"]
	var s3 := n3.nearest_free(w3.start_pos.x, w3.start_pos.z)
	var main_l := lab3[s3]
	var m3 := n3.blocked.duplicate()
	for i in marked.size():
		if marked[i] != 0 and nav.blocked[i] == 0:
			m3[i] = 1
	var g3 := NavGrid.new()
	g3.nx = n3.nx
	g3.nz = n3.nz
	g3.blocked = m3
	var lab4: PackedInt32Array = g3.components()["labels"]
	var main_after := -1
	var lost := 0
	var n_main := 0
	for i in lab3.size():
		if lab3[i] != main_l or m3[i] != 0:
			continue
		n_main += 1
		if main_after < 0:
			main_after = lab4[i]
		elif lab4[i] != main_after:
			lost += 1
	t.check(lost == 0, "mobilier : toute la ville reste d'un seul tenant, portes ouvertes (%d cases isolées sur %d)" % [lost, n_main])
	print("j30 : mobilier : %d cases bloquées, composantes contrôlées en %d ms" % [n_marked, Time.get_ticks_msec() - t0])

## Les apparitions au sol évitent le mobilier ; les golden (set_extras(false)) ne le voient pas.
func _spawns(t: Node, w: World, items: Array) -> void:
	var it: Dictionary = items[0]
	t.check(StreetFurniture.blocks_spawn(float(it["x"]), float(it["z"])), "apparition refusée au centre d'un objet")
	w.open_all_doors()   # toutes les zones ouvertes : pick_ground tire partout
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	var inside := 0
	var n := 0
	for k in 60:
		var c: Dictionary = items[(k * 7) % items.size()]
		for _j in 20:
			var p := w.pick_ground(float(c["x"]), float(c["z"]), 0.0, 6.0, rng)
			if p == Vector3.INF:
				continue
			n += 1
			for o: Dictionary in items:
				if StreetFurniture.dist_to(o, p.x, p.z) < 0.6:
					inside += 1
					break
	t.check(n > 300 and inside == 0, "apparitions au sol autour du mobilier : %d tirées, %d dedans" % [n, inside])
	w.set_extras(false)
	var off := 0
	for e: Dictionary in w.furniture_col:
		off += 1 if e["off"] else 0
	t.check(off == w.furniture_col.size() and not w.furniture_on, "set_extras(false) coupe le mobilier (golden)")
	w.set_extras(true)
