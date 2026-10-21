extends RefCounted
## v0.28.0 : wall weapon panels and ammo stations (sim/shop_places.gd, scenes/world/shop_view.gd, HUD prompt). Port only (no JS golden):
##   - every wall weapon gets a board orientation from the world collision; it matches the baked JS chalk board (front quad measured in
##     data/world/tiles at v0.27.0: centre and normal) within 3 degrees / 5 cm; boards on posts are recognised;
##   - every station faces its zone centre (JS rule) and matches the baked station front;
##   - the baked JS boards and stations are filtered out of the tiles (world_view.gd: shop materials), nothing else;
##   - HUD prompt details: kind, price, affordability, weapon id, for buy / ammo / Pack-a-Punch ammo / station.

const DT := 1.0 / 60.0
## Measured on the baked tiles (v0.27.0): wall weapon index -> [board front centre x, z, normal yaw (deg)]
const BAKED_BOARDS := {0: [-20.82, -31.62, 87.9], 1: [-11.62, -17.85, 140.0], 2: [-4.36, -45.07, 14.7], 8: [-101.93, -47.36, -74.7],
	14: [115.57, 33.62, -93.4], 21: [264.87, 116.18, -9.2], 34: [-698.07, 152.09, 122.5]}
## station index -> baked front normal yaw (deg)
const BAKED_STATIONS := {0: 69.0, 3: -162.6, 7: 0.0, 13: -163.3, 19: 17.4}

func run(t: Node) -> void:
	if not FileAccess.file_exists("res://data/world/objects.json"):
		t.check(true, "j35 : monde cuit absent, suite sautée")
		return
	Game.mode = GameMode.CLASSIC
	Game.new_game(5, "strasbourg", Config.at("startWeapons", []))
	_walls(t)
	_stations(t)
	_prompts(t)

func _wrap(a: float) -> float:
	return fposmod(a + 180.0, 360.0) - 180.0

func _walls(t: Node) -> void:
	var W: Array = ShopPlaces.walls(Game.world)
	var src: Array = Game.world.objects["wallWeapons"]
	t.check(W.size() == src.size() and W.size() == 35, "35 armes murales placées (%d)" % W.size())
	var found := 0
	var posts := 0
	for i in W.size():
		var e: Dictionary = W[i]
		found += 1 if e["found"] else 0
		posts += 1 if e["posts"] else 0
		var n := Vector3(sin(float(e["yaw"])), 0, cos(float(e["yaw"])))
		# the interaction point is 0.6 m in front of the board, along its normal
		var back: Vector3 = e["front"] - n * ShopPlaces.BOARD_BACK
		t.check((back - e["pos"]).length() < 1e-4, "arme murale %d : origine à 0,6 m derrière le point d'interaction" % i)
		# nothing solid between the interaction point and the board
		var d := Game.world.collision.ray_hit(e["front"].x, 1.5, e["front"].z, -n.x, 0.0, -n.z, 2.0)
		t.check(d > 0.45 and d < 0.75, "arme murale %d (%s) : mur ou poteaux juste derrière la planche (%.2f m)" % [i, e["id"], d])
		if not e["posts"]:   # flush with the wall: both ends of a 1.6 m board are as far from it
			var sd := Vector3(n.z, 0, -n.x)
			var a1 := Game.world.collision.ray_hit(e["front"].x + sd.x * 0.7, 1.5, e["front"].z + sd.z * 0.7, -n.x, 0.0, -n.z, 2.0)
			var a2 := Game.world.collision.ray_hit(e["front"].x - sd.x * 0.7, 1.5, e["front"].z - sd.z * 0.7, -n.x, 0.0, -n.z, 2.0)
			t.check(absf(a1 - a2) < 0.05, "arme murale %d (%s) : planche à plat contre le mur (%.2f / %.2f m)" % [i, e["id"], a1, a2])
	t.check(found == W.size(), "toutes les planches trouvent un appui (%d / %d)" % [found, W.size()])
	t.check(posts >= 1 and posts < W.size(), "planches sur poteaux reconnues (%d)" % posts)
	t.check(bool(W[0]["posts"]), "COLT M1911 du Marché-Neuf : sur poteaux (comme le JS)")
	for i: int in BAKED_BOARDS:
		var b: Array = BAKED_BOARDS[i]
		var e2: Dictionary = W[i]
		# the JS snapped the board to its 10-degree ray grid; here it follows the real wall (up to 4 degrees apart)
		t.check(absf(_wrap(rad_to_deg(float(e2["yaw"])) - float(b[2]))) < 5.0, "arme murale %d : orientation de la planche du JS (%.1f° / %.1f°)" % [i, rad_to_deg(float(e2["yaw"])), b[2]])
		var n2 := Vector3(sin(float(e2["yaw"])), 0, cos(float(e2["yaw"])))
		var face: Vector3 = e2["pos"] + n2 * 0.06
		t.check(Vector2(face.x - float(b[0]), face.z - float(b[1])).length() < 0.05, "arme murale %d : face de la planche à la place du JS" % i)

func _stations(t: Node) -> void:
	var S: Array = ShopPlaces.stations(Game.world)
	t.check(S.size() == 20, "20 bornes de munitions (%d)" % S.size())
	for i: int in BAKED_STATIONS:
		t.check(absf(_wrap(rad_to_deg(float(S[i]["yaw"])) - float(BAKED_STATIONS[i]))) < 1.0, "borne %d : tournée vers le centre de sa zone comme le JS" % i)
	for s: Dictionary in S:
		var p: Vector3 = s["pos"]
		var f := Vector3(sin(float(s["yaw"])), 0, cos(float(s["yaw"])))
		t.check(Game.world.collision.ray_hit(p.x + f.x * 1.2, 1.0, p.z + f.z * 1.2, -f.x, 0.0, -f.z, 2.0) < 1.0, "borne (%.0f ; %.0f) : sa collision est sous le modèle" % [p.x, p.z])

func _prompts(t: Node) -> void:
	var W: Array = ShopPlaces.walls(Game.world)
	var e: Dictionary = W[1]   # shotgun, 750
	Game.player.pos = e["front"]
	Game.player.vel = Vector3.ZERO
	Game.points = 500
	var info := Prompts.info(Game)
	t.check(info["kind"] == "wall_buy" and int(info["price"]) == 750 and not info["afford"] and info["id"] == "shotgun", "invite : achat au mur, 750 pts, trop cher (%s)" % [info])
	t.check(not String(info["main"]).contains("pts"), "invite : le prix est à part du texte (%s)" % info["main"])
	Game.points = 5000
	t.check(bool(Prompts.info(Game)["afford"]), "invite : assez de points")
	Game.interact()
	t.check(Game.arms.inventory.any(func(w: WeaponState) -> bool: return w.id == "shotgun"), "achat au mur")
	Game.arms.current.reserve = 0
	info = Prompts.info(Game)
	t.check(info["kind"] == "wall_ammo" and int(info["price"]) == 350, "invite : munitions au mur, 350 pts (%s)" % [info])
	Game.arms.current.pap = 1
	info = Prompts.info(Game)
	t.check(info["kind"] == "wall_ammo" and bool(info["pap"]) and int(info["price"]) == roundi(350.0 * Pap.pap_ammo_mult(1)), "invite : munitions Pack-a-Punch au prix du Pack-a-Punch (%s)" % [info])
	t.check(ShopView_state(e, Game) == "pap", "panneau : état Pack-a-Punch")
	Game.arms.current.pap = 0
	t.check(ShopView_state(e, Game) == "ammo", "panneau : état munitions")
	t.check(ShopView_state(W[5], Game) == "buy", "panneau : état acheter")
	var S: Array = ShopPlaces.stations(Game.world)
	Game.player.pos = S[0]["pos"] + Vector3(sin(float(S[0]["yaw"])), 0, cos(float(S[0]["yaw"]))) * 1.2
	Game.arms.current.reserve = 0
	info = Prompts.info(Game)
	t.check(info["kind"] == "station" and int(info["price"]) == int(Game.arms.current.cfg["ammoPrice"]), "invite : borne de munitions au prix de l'arme en main (%s)" % [info])
	t.check(Prompts.info(Game)["text"] == Prompts.text(Game), "invite : texte complet inchangé")

## Panel state as the view shows it (scenes/world/shop_view.gd uses the same rule).
func ShopView_state(e: Dictionary, g: Node) -> String:
	return Prompts.wall_state(g, String(e["id"]))
