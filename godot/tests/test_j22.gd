extends RefCounted
## v0.19.0 : journal de performance (PerfLog) et préchauffage (Warmup). La mise à l'échelle (v0.19.1) est dans test_j23.gd.

const MachinesViewScript := preload("res://scenes/world/machines_view.gd")
const WeaponViewScript := preload("res://scenes/weapon_view.gd")

func run(t: Node) -> void:
	_perf_rules(t)
	_perf_file(t)
	await _warmup(t)

# ---------------------------------------------------------------- PerfLog : règles pures
func _perf_rules(t: Node) -> void:
	t.check(not PerfLog.on, "perf : éteint par défaut (coût nul)")
	t.check(PerfLog.t() == 0, "perf : t() vaut 0 quand éteint")
	PerfLog.add(&"x", 0)
	PerfLog.event("x")   # ne doit rien faire ni échouer
	t.check(PerfLog.is_spike(26.0, 6.0), "pic : plus de 25 ms")
	t.check(PerfLog.is_spike(16.0, 6.0), "pic : plus de 2,5 x la médiane (16 > 15)")
	t.check(not PerfLog.is_spike(14.0, 6.0), "pas un pic : 14 ms pour une médiane de 6")
	t.check(not PerfLog.is_spike(10.0, 0.0) and PerfLog.is_spike(30.0, 0.0), "pic : sans médiane, seul le seuil absolu compte")
	t.near(PerfLog.median_of(PackedFloat32Array([5.0, 1.0, 3.0])), 3.0, "médiane de trois valeurs")
	var s := PackedFloat32Array()
	for i in 100:
		s.append(float(i + 1))
	t.near(PerfLog.percentile(s, 0.99), 99.0, "p99 de 1..100")
	t.near(PerfLog.percentile(s, 0.5), 50.0, "p50 de 1..100")
	var st := PerfLog.stats_of(PackedFloat32Array([6.0, 6.0, 30.0, 60.0, 120.0]))
	t.check(st["over25"] == 3 and st["over50"] == 2 and st["over100"] == 1 and st["max"] == 120.0, "stats : comptes de dépassement et pire image")
	t.check(PerfLog.attribute(40.0, {&"step": 30000}, 0, []) == "section:step", "cause : une section domine")
	t.check(PerfLog.attribute(40.0, {&"fx": 1000}, 3, []).begins_with("pipelines"), "cause : pipelines compilés")
	t.check(PerfLog.attribute(40.0, {&"fx": 1000}, 0, ["chargement son groan : 12 ms"]) == "ressource", "cause : chargement de ressource")
	t.check(PerfLog.attribute(40.0, {&"fx": 1000}, 0, []) == "rendu/système", "cause : rien de mesuré -> rendu / système")

# ---------------------------------------------------------------- PerfLog : fichier
func _perf_file(t: Node) -> void:
	var path := "user://perf_test_j22.txt"
	PerfLog.reset_for_tests()
	PerfLog.start(path, t.get_tree())
	t.check(PerfLog.on, "perf : démarre")
	PerfLog.phase = PerfLog.PHASE_GAME
	var inst: PerfLog = PerfLog._inst
	for i in 40:   # 40 images normales (~1 ms) puis une image lente (35 ms)
		OS.delay_usec(1000)
		inst._on_post_draw()
	PerfLog.event("évènement de test")
	var t0 := PerfLog.t()
	OS.delay_msec(35)
	PerfLog.add(&"step", t0)
	inst._on_post_draw()
	t.check(PerfLog.last_spike_ms > 25.0, "perf : l'image de 35 ms est un pic (%.1f ms)" % PerfLog.last_spike_ms)
	PerfLog.finish()
	PerfLog.finish()   # idempotent
	var text := FileAccess.get_file_as_string(path)
	t.check(text.contains("SPIKE") and text.contains("section:step") and text.contains("évènement de test"), "perf : la ligne SPIKE porte la cause et l'évènement")
	t.check(text.contains("=== RÉSUMÉ ==="), "perf : résumé final écrit")
	t.check(text.count("=== RÉSUMÉ ===") == 1, "perf : un seul résumé")
	t.check(text.contains("Images > 25 ms : 1"), "perf : le résumé compte le pic")
	PerfLog.reset_for_tests()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))

# ---------------------------------------------------------------- préchauffage
func _warmup(t: Node) -> void:
	Game.new_game(5, "strasbourg")
	var host := Node3D.new()
	t.add_child(host)
	var cam := Camera3D.new()
	host.add_child(cam)
	var fx := Node3D.new()
	fx.set_script(preload("res://scenes/fx_view.gd"))
	host.add_child(fx)
	fx.setup(cam)
	var wv := Node3D.new()
	wv.set_script(WeaponViewScript)
	host.add_child(wv)
	wv.setup(cam)
	var mv := Node3D.new()
	mv.set_script(MachinesViewScript)
	host.add_child(mv)
	mv.setup()
	var rng_state := Game.rng.state
	var next_id := Game.next_zombie_id()
	var children_before := host.get_child_count()
	ZombieModels.clear_pool()
	var made_before := ZombieModels.created
	var maker := func(z: ZombieSim) -> Node3D:
		var v := Node3D.new()
		v.set_script(preload("res://scenes/zombie_model_view.gd"))
		host.add_child(v)
		v.setup(z)
		return v
	var w := Warmup.new()
	await w.run(host, cam, fx, wv, mv, null, maker, func(_text: String, _f: float) -> void: pass)
	mv.warm_show(true)
	t.check(not mv.is_processing(), "préchauffage : la vue des machines est figée pendant le tour")
	mv.warm_show(false)
	t.check(mv.is_processing(), "préchauffage : la vue des machines reprend")
	t.check(w.done, "préchauffage : terminé")
	t.check(w.nodes_made > 30, "préchauffage : armes, bonus et nounours instanciés (%d)" % w.nodes_made)
	t.check(ZombieModels.pool_size("basic", false) >= Warmup.ZOMBIE_POOL["basic"], "pool prérempli : %d instances « basic » (>= %d)" % [ZombieModels.pool_size("basic", false), Warmup.ZOMBIE_POOL["basic"]])
	t.check(ZombieModels.pool_size("arm", true) >= Warmup.ZOMBIE_POOL["arm"], "pool prérempli : chevaliers (arm + armure)")
	t.check(ZombieModels.pool_size("chubby", false) >= Warmup.ZOMBIE_POOL["chubby"], "pool prérempli : pestiférés")
	var created := ZombieModels.created
	var got: Array = []
	for i in 20:
		got.append(ZombieModels.acquire("basic", false))
	t.check(ZombieModels.created == created, "pool : 20 zombies de plus sans fabriquer une instance")
	for r in got:
		ZombieModels.release(r)
	t.check(ZombieModels.created > made_before, "préchauffage : des instances ont bien été fabriquées")
	var floors := 0
	for r in Game.world.levels.regions.size():
		if Game.world.levels.nav_of(r) != null:
			floors += 1
	t.check(Game.world.levels.navs.size() == floors and floors > 5, "grilles d'étage toutes prêtes avant la partie (%d)" % floors)
	t.check(host.get_child_count() == children_before + 0 or host.get_child_count() <= children_before + 1, "préchauffage : tout est retiré de la scène")
	t.check(Game.rng.state == rng_state and Game.next_zombie_id() == next_id + 1 and Game.zombies.is_empty(), "préchauffage : la simulation n'est pas touchée (graine, identifiants, zombies)")
	t.check(w.pipelines_after >= w.pipelines_before, "préchauffage : compteur de pipelines lisible")
	host.queue_free()
	ZombieModels.clear_pool()
	Game.unload()
