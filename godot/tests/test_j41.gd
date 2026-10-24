extends RefCounted
## v0.34.6 / v0.34.7 : game loading work moved to threads (same results as the main-thread code it replaces) and UI scaling.

const WorldView := preload("res://scenes/world/world_view.gd")
const CityDetails := preload("res://scenes/world/city_details_view.gd")

func run(t: Node) -> void:
	_prefetch(t)
	_navs(t)
	_city(t)
	_ui_scale(t)

func _prefetch(t: Node) -> void:
	t.check(LoadPrefetch.paths_for("arena").is_empty(), "prefetch: nothing for the arena")
	var s := LoadPrefetch.paths_for("strasbourg")
	var a := LoadPrefetch.paths_for("alpine")
	t.check(s.has("res://assets/zombies/zombie_basic.glb") and s.has("res://shaders/ground.gdshader") and s.has("res://assets/pbr/wall_stone/a.png"),
		"prefetch: zombies, shaders and PBR textures of Strasbourg (%d paths)" % s.size())
	t.check(not s.has("res://assets/pbr/ground_snow/a.png") and a.has("res://assets/pbr/ground_snow/a.png"), "prefetch: snow textures only for the alpine map")
	var missing: Array[String] = []
	for p in s:
		if not ResourceLoader.exists(p):
			missing.append(p)
	t.check(missing.is_empty(), "prefetch: every path exists (missing: %s)" % ", ".join(missing))

## Floor grids built on a worker thread = the grids nav_of builds on the main thread.
func _navs(t: Node) -> void:
	Game.new_game(3, "strasbourg")
	var lv: Levels = Game.world.levels
	lv.navs.clear()
	lv.start_warm_navs()
	var waited := 0
	while not lv.warm_navs_done() and waited < 20000:
		OS.delay_msec(5)
		waited += 5
	lv.finish_warm_navs()
	var n := 0
	var same := 0
	for r: int in lv.navs:
		n += 1
		var g: NavGrid = NavGrid.build_region(lv, r, lv.nav_collision)
		var h: NavGrid = lv.navs[r]
		if g.blocked == h.blocked and g.nx == h.nx and g.nz == h.nz and is_equal_approx(g.ox, h.ox) and is_equal_approx(g.oz, h.oz):
			same += 1
	t.check(n > 0 and same == n, "floor grids from the worker thread: %d of %d identical to the main-thread build" % [same, n])
	var before := lv.navs.size()
	for r in lv.regions.size():
		lv.nav_of(r)
	t.check(lv.navs.size() == before, "floor grids: nav_of builds nothing more after the worker (%d)" % before)

func _city(t: Node) -> void:
	var trees := WorldView.tree_positions(WorldView.DIR + "instances.bin")
	if trees.is_empty():
		t.check(true, "city: baked instances absent, skipped")
		return
	t.check(trees.size() > 100 and trees.size() < 10000, "city: tree trunks read by the grass worker (%d)" % trees.size())
	var m1 := WorldView.grass_mask_data(trees, 64, 48, Vector2(trees[0].x - 32.0, trees[0].y - 24.0))
	t.check(m1.size() == 64 * 48 * 2 and m1[(24 * 64 + 32) * 2 + 1] > 0, "city: grass mask (pit under the first tree)")
	if CityDetails.exists():
		var b: Dictionary = CityDetails._compute()
		var frames := 0
		for k: String in b:
			if k.begins_with("frame|"):
				frames += (b[k] as PackedFloat32Array).size() / 16
		t.check(b.size() > 100 and frames > 1000, "city details computed off the main thread: %d buckets, %d window frames" % [b.size(), frames])

func _ui_scale(t: Node) -> void:
	for c: Array in [[Vector2i(1280, 720), Vector2(1280, 720)], [Vector2i(1920, 1080), Vector2(1280, 720)], [Vector2i(2560, 1440), Vector2(1280, 720)],
			[Vector2i(3440, 1440), Vector2(1720, 720)], [Vector2i(1920, 1200), Vector2(1280, 800)], [Vector2i(2560, 1080), Vector2(2560.0 / 1.5, 720)]]:
		var got := UiTheme.ui_size(c[0])
		t.check(got.is_equal_approx(c[1]), "UI scale: %s window -> %s UI units (got %s)" % [c[0], c[1], got])
	var w := Window.new()
	UiTheme.apply_ui_scale(w)
	t.check(w.content_scale_mode == Window.CONTENT_SCALE_MODE_CANVAS_ITEMS and w.content_scale_aspect == Window.CONTENT_SCALE_ASPECT_EXPAND and w.content_scale_size == Vector2i(1280, 720),
		"UI scale: canvas items, expand, 1280 x 720 base")
	w.free()
