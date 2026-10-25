extends RefCounted
## v0.36.0 : planche de la voiture conduisible (outil de capture, pas un test : absent de la liste des suites ; il faut un écran).
## Usage : godot --path godot res://tests/runner.tscn -- --suite=carsheet --out=/chemin/planche.png [--night]
## La voiture (CarView sur un CarSim seul) sur un sol gris, éclairée par un soleil et un ciel simples : 6 vues autour, dessus, habitacle, nuit phares.

func run(t: Node) -> void:
	var out := "user://carsheet.png"
	var night := false
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out = a.substr(6)
		elif a == "--night":
			night = true
	var root: Window = t.get_tree().root
	root.size = Vector2i(640, 400)
	var world := Node3D.new()
	root.add_child.call_deferred(world)
	await t.get_tree().process_frame
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.03, 0.035, 0.05) if night else Color(0.62, 0.7, 0.8)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.1, 0.11, 0.14) if night else Color(0.55, 0.6, 0.68)
	e.ambient_light_energy = 0.6
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	world.add_child(env)
	for nm in ["env_top", "env_mid", "env_horizon", "env_ground", "env_moon_dir"]:
		RenderingServer.global_shader_parameter_add(nm, RenderingServer.GLOBAL_VAR_TYPE_VEC3, Vector3.ZERO)
	for nm in ["env_intensity", "env_moon"]:
		RenderingServer.global_shader_parameter_add(nm, RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 0.0)
	RenderingServer.global_shader_parameter_set("env_top", Vector3(0.25, 0.4, 0.7))
	RenderingServer.global_shader_parameter_set("env_mid", Vector3(0.5, 0.6, 0.75))
	RenderingServer.global_shader_parameter_set("env_horizon", Vector3(0.75, 0.78, 0.8))
	RenderingServer.global_shader_parameter_set("env_ground", Vector3(0.2, 0.19, 0.18))
	RenderingServer.global_shader_parameter_set("env_intensity", 0.05 if night else 0.6)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.8, 0.6, 0)
	sun.light_energy = 0.05 if night else 1.6
	sun.shadow_enabled = true
	world.add_child(sun)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 60)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.36, 0.35, 0.33)
	gm.roughness = 0.9
	ground.material_override = gm
	world.add_child(ground)
	var sim := CarSim.new(0, {"x": 0.0, "z": 0.0, "yaw": 0.0, "paint": int(OS.get_environment("CAR_PAINT")) if OS.get_environment("CAR_PAINT") != "" else 0})
	sim.seats[0] = 0
	sim.lights = night
	sim.steer = 0.6
	sim.steer_angle = 0.35
	var view := CarView.new()
	world.add_child(view)
	view.setup(sim)
	var cam := Camera3D.new()
	cam.fov = 40.0
	world.add_child(cam)
	cam.current = true
	var shots := [
		[Vector3(-5.5, 1.8, -6.0), Vector3(0, 0.6, 0)],
		[Vector3(7.5, 1.4, 0.3), Vector3(0, 0.7, 0)],
		[Vector3(5.0, 2.0, 6.0), Vector3(0, 0.6, 0)],
		[Vector3(0.2, 1.2, -8.0), Vector3(0, 0.7, 0)],
		[Vector3(0.1, 9.0, 0.5), Vector3(0, 0.0, 0)],
		[Vector3(-1.6, 1.6, -1.0), Vector3(-0.2, 0.9, -0.6)],
		[Vector3(-0.37, 1.15, 0.2), Vector3(-0.37, 0.95, -2.0)],
		[Vector3(-3.0, 1.0, -3.2), Vector3(0.4, 0.5, -1.7)],
	]
	var imgs: Array = []
	for s: Array in shots:
		cam.position = s[0]
		cam.look_at(s[1], Vector3.UP if absf((s[0] as Vector3).y - 9.0) > 0.1 else Vector3.FORWARD)
		cam.near = 0.05
		for _i in 6:
			await t.get_tree().process_frame
		await RenderingServer.frame_post_draw
		imgs.append(root.get_texture().get_image())
	var w: int = imgs[0].get_width()
	var h: int = imgs[0].get_height()
	var sheet := Image.create(w * 4, h * 2, false, imgs[0].get_format())
	for i in imgs.size():
		sheet.blit_rect(imgs[i], Rect2i(0, 0, w, h), Vector2i((i % 4) * w, (i / 4) * h))
	sheet.save_png(out)
	print("planche : %s (%d triangles)" % [out, view.triangles()])
	t.check(true, "planche")
