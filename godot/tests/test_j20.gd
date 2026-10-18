extends RefCounted
## v0.17.4 : en visée (ADS) comme à la hanche, l'éclair de bouche, le traçant et l'obus partent de la bouche DU MODÈLE (même transformation que lui).
## Pour chacune des 23 armes, à la hanche (aim = 0) puis en visée (aim = 1) : bouche du monde (weapon_view.muzzle_world, d'où part le traçant) = position
## de la caméra + bouche calculée par la simulation (arms.muzzle_cam, d'où part l'obus) ; éclair de bouche à 5 cm de la bouche ; bouche = bout du canon du
## modèle (boîte englobante) à quelques pixels près ; position PROJETÉE à l'écran de l'éclair proche de celle du bout du canon ; en visée la bouche est au
## centre de l'écran (la mire est sur le réticule), à la hanche elle est en bas à droite. `-- --report` imprime le tableau.

const WeaponViewScript := preload("res://scenes/weapon_view.gd")
const WeaponModels := preload("res://scenes/weapon_models.gd")
const W := 1280.0
const H := 720.0

func run(t: Node) -> void:
	var report := OS.get_cmdline_user_args().has("--report")
	Game.new_game(5, "arena")
	var vp := SubViewport.new()
	vp.size = Vector2i(int(W), int(H))
	t.add_child(vp)
	var cam := Camera3D.new()
	cam.fov = 75.0   # FOV vertical de Godot ; la visée la resserre
	cam.near = 0.05
	vp.add_child(cam)
	cam.current = true
	var view := Node3D.new()
	view.set_script(WeaponViewScript)
	vp.add_child(view)
	view.setup(cam)
	var worst_flash := 0.0
	var worst_tip := 0.0
	for id: String in WeaponModels.table():
		Game.arms.give_weapon(id)
		for aim in [0.0, 1.0]:
			Game.arms.aim = aim
			cam.fov = Game.arms.fov(75.0)
			view._kick = 0.0
			view._process(0.016)
			var mz: Vector3 = view.muzzle_world()
			t.check(mz != Vector3.INF, "%s : bouche du monde disponible" % id)
			var want := cam.to_global(Game.arms.muzzle_cam())
			t.check(mz.distance_to(want) < 2e-3, "%s aim %.0f : bouche de la vue = bouche de la simulation (%.4f m)" % [id, aim, mz.distance_to(want)])
			# bout du canon du modèle : extrémité avant (-z) de la boîte englobante de la pièce principale, sur la ligne de canon
			var tip := _tip(view._gun)
			var tip_world: Vector3 = view._gun.to_global(tip)
			var dtip := cam.unproject_position(mz).distance_to(cam.unproject_position(tip_world))
			worst_tip = maxf(worst_tip, dtip)
			var cfg: Dictionary = Game.arms.current.cfg
			var scoped := cfg.has("adsFov")
			t.check(view.tracer_start(Vector3(9, 9, 9)).distance_to(mz) < 1e-6, "%s : le traçant part de la bouche du modèle" % id)
			view.hide_gun = true
			t.check(view.tracer_start(Vector3(9, 9, 9)) == Vector3(9, 9, 9), "%s : arme cachée : point de repli" % id)
			view.hide_gun = false
			if not (scoped and aim > 0.8):   # lunette : le modèle est caché en visée
				t.check(dtip < 6.0 or id in ["sniper", "svd", "barrett"], "%s aim %.0f : bouche à %.1f px du bout du canon" % [id, aim, dtip])
			if cfg.get("flash", true) != false:
				Game.shot_fired.emit(Vector3.ZERO, Vector3.ZERO)
				var fl: MeshInstance3D = view._flash
				t.check(fl.visible, "%s : éclair affiché" % id)
				var fpos := fl.global_position
				var dflash := cam.unproject_position(fpos).distance_to(cam.unproject_position(tip_world))
				worst_flash = maxf(worst_flash, dflash)
				t.check(fpos.distance_to(mz) < 0.06, "%s aim %.0f : éclair à %.3f m de la bouche" % [id, aim, fpos.distance_to(mz)])
				if not scoped or aim < 0.8:
					t.check(dflash < 0.045 * H, "%s aim %.0f : éclair à %.0f px du bout du canon (< %.0f)" % [id, aim, dflash, 0.045 * H])
				view._flash_t = 0.0
				view._process(0.1)
			var sp := cam.unproject_position(mz)
			if aim == 1.0:
				t.check(absf(sp.x - W / 2.0) < 0.03 * W and sp.y > H / 2.0 - 0.05 * H and sp.y < H / 2.0 + 0.30 * H, "%s : en visée la bouche est près du centre (%.0f, %.0f)" % [id, sp.x, sp.y])
			else:
				t.check(sp.x > W / 2.0 + 0.05 * W and sp.y > H / 2.0, "%s : à la hanche la bouche est en bas à droite (%.0f, %.0f)" % [id, sp.x, sp.y])
			if report:
				print("%-8s aim %.0f : bouche écran (%4.0f, %4.0f), bout du canon %.1f px, éclair %.1f px" % [id, aim, sp.x, sp.y, dtip, cam.unproject_position(view._flash.global_position).distance_to(cam.unproject_position(tip_world))])
	_launcher(t, view, cam)
	print("armes : écart max éclair - bout du canon %.1f px, bouche - bout du canon %.1f px (écran %dx%d)" % [worst_flash, worst_tip, int(W), int(H)])
	vp.queue_free()

## Bout du canon du modèle dans le repère de l'arme : milieu (x, y) de l'extrémité avant de la boîte englobante de la pièce principale (le canon).
func _tip(gun: Node3D) -> Vector3:
	var main := gun.get_child(0) as MeshInstance3D
	var bb: AABB = main.get_aabb()
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for c in 8:
		var p := main.transform * bb.get_endpoint(c)
		lo = lo.min(p)
		hi = hi.max(p)
	return Vector3(0.0, 0.0, lo.z)

## L'obus du M79 part de la bouche vue à l'écran, à la hanche comme en visée (avant : toujours du point fixe de la hanche, décalé en visée).
func _launcher(t: Node, view: Node3D, cam: Camera3D) -> void:
	Game.arms.give_weapon("m79")
	var p: PlayerSim = Game.player
	p.yaw = 0.7
	p.pitch = 0.6   # vers le ciel : pas de mur contre la bouche
	cam.global_transform = Transform3D(Basis.from_euler(Vector3(p.pitch, p.yaw, 0.0)), p.eye())
	for aim in [0.0, 1.0]:
		Game.arms.aim = aim
		Game.arms.blast.shells.clear()
		view._kick = 0.0
		view._process(0.016)
		Game.arms.current.cfg["spread"] = 0.0
		Game.arms.fire_launcher(Game, Game.arms.current.cfg, 1.0)
		t.check(Game.arms.blast.shells.size() == 1, "M79 aim %.0f : un obus" % aim)
		if Game.arms.blast.shells.is_empty():
			continue
		var o: Vector3 = Game.arms.blast.shells[0]["pos"]
		var mz: Vector3 = view.muzzle_world()
		t.check(o.distance_to(mz) < 0.01, "M79 aim %.0f : l'obus part de la bouche du modèle (%.4f m d'écart)" % [aim, o.distance_to(mz)])
		if aim == 1.0:
			t.check(cam.unproject_position(o).distance_to(Vector2(640, 360)) < 130.0, "M79 en visée : l'obus part près du centre de l'écran")
