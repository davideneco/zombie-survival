extends RefCounted
## v0.17.2 : ouvrir une porte ne doit plus geler le jeu. Pour chaque porte de la carte : coût de `Game.use_door` (collision, grille de navigation,
## zones, bonus) puis pire pas de `Game.step` dans la seconde qui suit (composantes connexes du « se débloquer », champ de flux, vue).
## `-- --report` imprime le tableau.

const DT := 1.0 / 60.0
const USE_MAX_MS := 8.0       ## use_door seul
const STEP_MAX_MS := 20.0     ## pire pas de simulation après l'ouverture

func run(t: Node) -> void:
	var report := OS.get_cmdline_user_args().has("--report")
	Game.new_game(7, "strasbourg")
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	for f in 90:
		Game.step(DT, {})
	var n: int = Game.world.doors.size()
	var worst_use := 0.0
	var worst_step := 0.0
	var sum_use := 0.0
	var sum_step := 0.0
	var order: Array = range(n)
	for k in n:
		var id: int = order[k]
		var d: Dictionary = Game.world.doors[id]
		var pt: Array = d["points"][0]
		Game.player.pos = Vector3(pt[0], 0.0, pt[1])
		Game.points = 100000
		Game.free_doors = false
		var t0 := Time.get_ticks_usec()
		var got := Game.use_door()
		var use_ms := (Time.get_ticks_usec() - t0) / 1000.0
		if got != id:   # deux portes voisines : la plus proche d'abord ; on ouvre celle-ci directement
			t0 = Time.get_ticks_usec()
			Game.world.open_door(id)
			Game.door_opened.emit(id)
			use_ms = (Time.get_ticks_usec() - t0) / 1000.0
		var wstep := 0.0
		for f in 70:   # > 0,5 s : passe par le contrôle de poche du « se débloquer »
			var s0 := Time.get_ticks_usec()
			Game.step(DT, {})
			wstep = maxf(wstep, (Time.get_ticks_usec() - s0) / 1000.0)
		worst_use = maxf(worst_use, use_ms)
		worst_step = maxf(worst_step, wstep)
		sum_use += use_ms
		sum_step += wstep
		if report:
			print("porte %2d : use %.2f ms, pire pas %.2f ms" % [id, use_ms, wstep])
	print("portes : %d, use_door moyenne %.2f / pire %.2f ms ; pire pas après ouverture moyenne %.2f / pire %.2f ms" % [n, sum_use / n, worst_use, sum_step / n, worst_step])
	_same_partition(t)
	t.check(n >= 20, "portes de la carte : %d" % n)
	t.check(worst_use < USE_MAX_MS, "ouvrir une porte : %.2f ms au pire (< %.0f)" % [worst_use, USE_MAX_MS])
	t.check(worst_step < STEP_MAX_MS, "pas de simulation après ouverture : %.2f ms au pire (< %.0f)" % [worst_step, STEP_MAX_MS])

## Les composantes mises à jour porte par porte (union-find local) découpent la grille exactement comme un recalcul complet.
func _same_partition(t: Node) -> void:
	var nav: NavGrid = Game.world.nav
	var inc := PackedInt32Array()
	inc.resize(nav.nx * nav.nz)
	for i in inc.size():
		inc[i] = nav.label_of(i)
	var main_inc := nav.label_of(nav.idx(nav.cx(Game.world.start_pos.x), nav.cz(Game.world.start_pos.z)))
	var main_size := nav.comp_size(main_inc)
	var full := nav.components()   # _merged : recalcul complet
	var labels: PackedInt32Array = full["labels"]
	var sizes: Array = full["sizes"]
	var map := {}
	var back := {}
	var bad := 0
	for i in inc.size():
		var a := inc[i]
		var b := labels[i]
		if (a == 0) != (b == 0):
			bad += 1
			continue
		if a == 0:
			continue
		if map.get(a, b) != b or back.get(b, a) != a:
			bad += 1
		map[a] = b
		back[b] = a
	t.check(bad == 0, "composantes après %d portes : mêmes que le recalcul complet (%d cases en désaccord)" % [Game.world.doors.size(), bad])
	t.check(int(sizes[map[main_inc]]) == main_size, "composantes : taille de la principale %d (recalcul %d)" % [main_size, int(sizes[map[main_inc]])])
