extends RefCounted
## v0.20.6 : lampe torche (touche F). La torche existe, est visible, éclaire le monde (couche 1) et suit la touche F ; la sim ne la connaît pas (c'est un état de vue).

const GraphicsView := preload("res://scenes/graphics_view.gd")

func _key_f() -> InputEventKey:
	var e := InputEventKey.new()
	e.keycode = KEY_F
	e.physical_keycode = KEY_F
	e.pressed = true
	return e

func run(t: Node) -> void:
	var s := Game.settings
	var old_auto := s.autosave
	s.autosave = false
	s.binds.apply_to_input_map()
	for q in [0, 1, 2]:   # Rapide, Normale, Haute
		s.set_value("quality", q)
		var gcam := Camera3D.new()
		t.add_child(gcam)
		var gv: Node = GraphicsView.new()
		t.add_child(gv)
		gv.setup(gcam, false)
		var tl: SpotLight3D = gv.torch
		var lbl := "qualité %d" % q
		t.check(tl != null and tl.is_inside_tree() and tl.get_parent() == gcam, "torche dans l'arbre, sur la caméra (%s)" % lbl)
		for _i in 3:
			gv._process(0.1)
		t.check(tl.visible and tl.is_visible_in_tree(), "torche visible par défaut (%s)" % lbl)
		t.check(tl.light_energy > 0.5 and tl.spot_range >= 20.0 and tl.spot_angle > 10.0, "torche : énergie %.2f, portée %.0f, angle %.0f (%s)" % [tl.light_energy, tl.spot_range, tl.spot_angle, lbl])
		t.check(tl.light_cull_mask & 1 != 0 and tl.light_cull_mask & (1 << 19) == 0, "torche : éclaire la couche 1 du monde, pas la couche des armes (%s)" % lbl)
		t.check(gcam.cull_mask & 1 != 0, "caméra : voit la couche 1 (%s)" % lbl)
		t.check(not tl.shadow_enabled and tl.light_negative == false and tl.light_bake_mode != Light3D.BAKE_STATIC, "torche : sans ombres, ni négative (%s)" % lbl)
		# la touche F (événement réel, keycode et physique) bascule la lampe quand la partie tourne
		var was_playing := Game.playing
		var was_over := Game.over
		Game.playing = true
		Game.over = false
		gv._unhandled_input(_key_f())
		t.check(not gv.torch_on and tl.light_energy == 0.0 and not tl.visible, "F : torche éteinte (%s)" % lbl)
		gv._unhandled_input(_key_f())
		t.check(gv.torch_on and tl.light_energy > 0.5 and tl.visible, "F : torche rallumée, elle éclaire (%s)" % lbl)
		Game.playing = false
		gv._unhandled_input(_key_f())
		t.check(gv.torch_on, "F hors partie : sans effet (%s)" % lbl)
		Game.playing = was_playing
		Game.over = was_over
		gv.queue_free()
		gcam.queue_free()
	# la simulation n'a pas d'état « torche » : la lampe est purement une vue
	t.check(not ("torch" in Game.player) if Game.player != null else true, "aucun état de torche dans la sim")
	s.autosave = old_auto
