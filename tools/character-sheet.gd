extends SceneTree
## Planche des personnages (captures réelles, besoin d'un affichage) :
##   godot --path godot --script ../tools/character-sheet.gd -- out.png [anim] [t] [id,id,..]
## Une rangée de 8 personnages (ou ceux demandés) dans l'animation `anim` (Idle par défaut) à la date `t` (s), vus de face puis de trois quarts arrière.
func _init() -> void:
	var a := OS.get_cmdline_user_args()
	var out: String = a[0] if a.size() > 0 else "sheet.png"
	var anim: String = a[1] if a.size() > 1 else "Idle"
	var t := float(a[2]) if a.size() > 2 else 0.0
	var ids: Array = String(a[3]).split(",") if a.size() > 3 else CharacterModel.IDS.duplicate()
	await process_frame
	var vp := SubViewport.new()
	vp.size = Vector2i(400 * ids.size(), 700)
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("5a6068")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("aab4c8")
	env.ambient_light_energy = 0.7
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-40), deg_to_rad(150), 0)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	vp.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation = Vector3(deg_to_rad(-20), deg_to_rad(-40), 0)
	fill.light_energy = 0.5
	vp.add_child(fill)
	var floor_m := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 20)
	floor_m.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color("3c4046")
	floor_m.material_override = fm
	vp.add_child(floor_m)
	for i in ids.size():
		var m := CharacterModel.create(ids[i])
		if m == null:
			printerr("modèle absent : ", ids[i])
			continue
		m.position = Vector3((i - (ids.size() - 1) / 2.0) * 1.1, 0, 0)
		vp.add_child(m)
		m.pose(anim, t)
		var st := m.stats()
		print("%s : %d triangles, %d surfaces" % [ids[i], st["tris"], st["surfaces"]])
	var cam := Camera3D.new()
	cam.fov = 28
	cam.position = Vector3(0, 0.95, 3.6 + ids.size() * 0.2)
	vp.add_child(cam)
	cam.look_at(Vector3(0, 0.92, 0))
	cam.current = true
	for i in 8:
		await process_frame
	RenderingServer.force_draw()
	vp.get_texture().get_image().save_png(out)
	quit(0)
