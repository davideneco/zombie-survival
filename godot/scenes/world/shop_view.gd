class_name ShopView
extends Node3D
## v0.28.0 : wall weapon panels and ammo stations (models: shop_models.gd, places: sim/shop_places.gd). The static parts of every copy are drawn through
## MultiMesh (one per variant and per 160 m cell, like the decor of world_view.gd); each panel adds the real weapon model with its glowing silhouette and
## its texts (name, state, price), each station its texts. Near the player (14 m), every 0.25 s, a panel shows what it offers to him: ACHETER (price),
## MUNITIONS (ammo price) or PACK-A-PUNCH (ammo price x papAmmoMult), the price in red when he cannot pay; a station shows the weapon in hand and its
## ammo price. Day / night: ShopModels.set_lit (DayNight.lamps). Reads Game only.

const CELL := 160.0
const NEAR := 14.0
const FAR_RANGE := 190.0

var panels: Array = []     ## { e (ShopPlaces entry), node, tag, state_l, price_l, state }
var stations: Array = []   ## { e, node, line_l, price_l }
var _timer := 0.0
var _lit_t := 0.0

func setup() -> void:
	ShopModels.set_lit(Game.daynight.lamps() if Game.daynight != null else 1.0)
	var cells: Dictionary = {}   # "variant/cx/cz" -> Array[Transform3D]
	if Game.world != null:
		for e: Dictionary in ShopPlaces.walls(Game.world):
			_add_xf(cells, "panel_posts" if e["posts"] else "panel_wall", e["pos"], float(e["yaw"]))
			panels.append(_make_panel(e))
		for s: Dictionary in ShopPlaces.stations(Game.world):
			_add_xf(cells, "station", s["pos"], float(s["yaw"]))
			stations.append(_make_station(s))
	elif Game.arena != null:   # arena: one station against the west wall, facing +X
		var s := {"pos": Game.arena.station_pos, "yaw": PI / 2.0, "zone": -1}
		_add_xf(cells, "station", s["pos"], PI / 2.0)
		stations.append(_make_station(s))
	for key: String in cells:
		var f := key.split("/")
		var mesh: ArrayMesh = ShopModels.station_mesh() if f[0] == "station" else ShopModels.panel_mesh(f[0] == "panel_posts")
		var xfs: Array = cells[key]
		var c := Vector3((float(f[1]) + 0.5) * CELL, 0.0, (float(f[2]) + 0.5) * CELL)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = xfs.size()
		for i in xfs.size():
			var xf: Transform3D = xfs[i]
			xf.origin -= c
			mm.set_instance_transform(i, xf)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.position = c
		mmi.visibility_range_end = FAR_RANGE + CELL * 0.5
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(mmi)

## Materials of the JS wall boards and ammo stations in the baked world (realworld.js makeWallBuy / makeAmmoStation / addPosts, machines.js): world_view.gd
## drops their surfaces (this view replaces them). Recognised by their properties, not their index (a new bake renumbers them); they are only used there
## (checked at v0.27.0: every vertex of these materials lies within 1 m of a wall weapon or a station).
static func baked_shop_material(m: Dictionary) -> bool:
	var c := int(m["c"])
	var r := float(m["r"])
	var mt := float(m["m"])
	var em := int(m["e"])
	var ei := float(m["ei"])
	var has_map := int(m["map"]) >= 0
	if bool(m["vc"]):
		return false
	if c == 0x2a1c12 and is_equal_approx(r, 0.9) and em == 0:
		return true   # board
	if c == 0x222224 and is_equal_approx(r, 0.5) and is_equal_approx(mt, 0.7):
		return true   # sconce, posts
	if c == 0xfff0c0 and em == 0xffd080:
		return true   # bulb
	if c == 0xffffff and has_map and em == 0xffffff and is_equal_approx(ei, 0.35) and is_equal_approx(r, 0.95):
		return true   # chalk drawing
	if c == 0x4b5232 and is_equal_approx(r, 0.7) and is_equal_approx(mt, 0.5):
		return true   # station body
	if c == 0x3e4428 and is_equal_approx(r, 0.8) and is_equal_approx(mt, 0.4):
		return true   # station crate
	if c == 0x4dff7a and em == 0x4dff7a:
		return true   # station lamp
	if c == 0xc8a040 and is_equal_approx(r, 0.3) and is_equal_approx(mt, 0.9):
		return true   # cartridges (instanced)
	if c == 0xffffff and has_map and em == 0xffffff and is_equal_approx(ei, 0.8) and is_equal_approx(r, 0.85) and is_equal_approx(mt, 0.1):
		return true   # station front
	return false

static func _add_xf(cells: Dictionary, variant: String, pos: Vector3, yaw: float) -> void:
	var key := "%s/%d/%d" % [variant, floori(pos.x / CELL), floori(pos.z / CELL)]
	if not cells.has(key):
		cells[key] = []
	cells[key].append(Transform3D(Basis(Vector3.UP, yaw), pos))

static func price_text(p: int) -> String:
	var s := str(absi(p))
	var out := ""
	while s.length() > 3:
		out = " " + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out + " PTS"

## Per-copy nodes of a panel (the static frame is in the MultiMesh).
static func build_panel_parts(e: Dictionary) -> Dictionary:
	var n := Node3D.new()
	n.position = e["pos"]
	n.rotation.y = float(e["yaw"])
	n.add_child(ShopModels.weapon_on_board(String(e["id"])))
	var tag := ShopModels.state_tag()
	n.add_child(tag)
	var z := ShopModels.BOARD_FRONT + 0.0145
	var name_l := ShopModels.label(n, String(e["name"]), 0.105, Vector3(0, ShopModels.NAME_Y, z), Color(0.95, 0.91, 0.82))
	name_l.width = 1100.0
	var state_l := ShopModels.label(n, ShopModels.STATE_TEXT["buy"], 0.07, Vector3(ShopModels.TAG_X, ShopModels.ROW_Y, z), Color(0.97, 0.97, 0.95))
	var price_l := ShopModels.label(n, price_text(int(e["price"])), 0.085, Vector3(ShopModels.PRICE_X, ShopModels.ROW_Y, z), Color(1.0, 0.83, 0.38))
	return {"e": e, "node": n, "tag": tag, "state_l": state_l, "price_l": price_l, "state": "buy", "afford": true, "price": int(e["price"])}

func _make_panel(e: Dictionary) -> Dictionary:
	var P := build_panel_parts(e)
	add_child(P["node"])
	return P

static func build_station_parts(s: Dictionary) -> Dictionary:
	var n := Node3D.new()
	n.position = s["pos"]
	n.rotation.y = float(s["yaw"])
	var fz := ShopModels.SD / 2.0 + 0.0105
	var y0 := 0.08
	ShopModels.label(n, "MUNITIONS", 0.1, Vector3(0, y0 + ShopModels.SH * 0.73 + 0.025, fz), Color(0.78, 0.72, 0.48), true)
	ShopModels.label(n, "CAL. 5,56 · 7,62 · 9 MM · 12", 0.04, Vector3(0, y0 + ShopModels.SH * 0.73 - 0.055, fz), Color(0.74, 0.7, 0.5), true)
	var scr := Node3D.new()
	scr.transform = ShopModels.station_screen()
	scr.position.z += 0.004
	n.add_child(scr)
	var line_l := ShopModels.label(scr, "MUNITIONS", 0.075, Vector3(0, 0.045, 0), Color(0.45, 1.0, 0.6))
	var price_l := ShopModels.label(scr, "ARME EN MAIN", 0.06, Vector3(0, -0.045, 0), Color(1.0, 0.86, 0.4))
	line_l.width = 900.0
	return {"e": s, "node": n, "line_l": line_l, "price_l": price_l, "key": ""}

func _make_station(s: Dictionary) -> Dictionary:
	var S := build_station_parts(s)
	add_child(S["node"])
	return S

## One panel and one station with every material of the shops, for the warm-up ring (pipelines compiled under the loading veil).
static func sample() -> Node3D:
	var root := Node3D.new()
	var ids: Array = WeaponModels_ids()
	var e := {"id": String(ids[0]) if not ids.is_empty() else "m1911", "name": "ARME", "price": 1000, "pos": Vector3.ZERO, "yaw": 0.0}
	for v in [false, true]:
		var mi := MeshInstance3D.new()
		mi.mesh = ShopModels.panel_mesh(v)
		mi.position.x = 2.2 if v else 0.0
		root.add_child(mi)
	root.add_child(build_panel_parts(e)["node"])
	var tag: MeshInstance3D = ShopModels.state_tag()
	tag.material_override = ShopModels.mat("state_pap")
	root.add_child(tag)
	var st := MeshInstance3D.new()
	st.mesh = ShopModels.station_mesh()
	st.position.x = -2.0
	root.add_child(st)
	var sp := build_station_parts({"pos": Vector3(-2.0, 0, 0), "yaw": 0.0})
	root.add_child(sp["node"])
	return root

static func WeaponModels_ids() -> Array:
	return ShopModels.WeaponModels.table().keys()

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"boutiques", _pt)

func _tick(dt: float) -> void:
	_lit_t -= dt
	if _lit_t <= 0.0:
		_lit_t = 0.5
		ShopModels.set_lit(Game.daynight.lamps() if Game.daynight != null else 1.0)
	_timer -= dt
	if _timer > 0.0 or Game.player == null:
		return
	_timer = 0.25
	var p: Vector3 = Game.player.pos
	for P: Dictionary in panels:
		var e: Dictionary = P["e"]
		if (e["pos"] as Vector3).distance_squared_to(p) > NEAR * NEAR:
			continue
		var st := Prompts.wall_state(Game, String(e["id"]))
		var price := int(e["price"])
		if st != "buy":
			price = int(e["ammoPrice"])
			for w: WeaponState in Game.arms.inventory:
				if w.id == String(e["id"]):
					price = roundi(float(e["ammoPrice"]) * Pap.pap_ammo_mult(w.pap))
		var afford: bool = int(Game.points) >= price
		if st != P["state"] or price != int(P["price"]) or afford != bool(P["afford"]):
			P["state"] = st
			P["price"] = price
			P["afford"] = afford
			(P["tag"] as MeshInstance3D).material_override = ShopModels.mat("state_" + st)
			(P["state_l"] as Label3D).text = ShopModels.STATE_TEXT[st]
			(P["state_l"] as Label3D).font_size = 64 if st != "pap" else 52
			var pl: Label3D = P["price_l"]
			pl.text = price_text(price)
			pl.modulate = Color(1.0, 0.83, 0.38) if afford else Color(1.0, 0.32, 0.26)
	for S: Dictionary in stations:
		var near: bool = (S["e"]["pos"] as Vector3).distance_squared_to(p) < NEAR * NEAR
		var w: WeaponState = Game.arms.current if Game.arms != null else null
		var key := ""
		if near and w != null:
			var full := w.reserve >= int(w.cfg["maxReserve"])
			key = "%s/%d/%s/%s" % [w.id, int(w.cfg["ammoPrice"]), full, int(Game.points) >= int(w.cfg["ammoPrice"])]
		if key == String(S["key"]):
			continue
		S["key"] = key
		var ll: Label3D = S["line_l"]
		var pl2: Label3D = S["price_l"]
		if key == "":
			ll.text = "MUNITIONS"
			pl2.text = "ARME EN MAIN"
			pl2.modulate = Color(1.0, 0.86, 0.4)
		else:
			var full2 := w.reserve >= int(w.cfg["maxReserve"])
			ll.text = String(w.cfg["name"])
			pl2.text = "PLEIN" if full2 else price_text(int(w.cfg["ammoPrice"]))
			pl2.modulate = Color(0.55, 1.0, 0.65) if full2 else (Color(1.0, 0.86, 0.4) if int(Game.points) >= int(w.cfg["ammoPrice"]) else Color(1.0, 0.32, 0.26))
