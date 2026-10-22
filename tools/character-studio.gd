extends SceneTree
## v0.31.0 : planche de contrôle d'un ou plusieurs personnages en éclairage de studio (captures réelles, besoin d'un affichage) :
##   godot --path godot --script ../tools/character-studio.gd -- out.png id[,id...] [anim] [t] [blink]
## Par personnage, une rangée : de face, trois quarts, profil, dos (corps entier), puis le visage de face et de trois quarts, en gros plan.
## Lumières : clé chaude avec ombres, débouchage froid, contre-jour, ambiance grise ; MSAA 4x, sans TAA ni flou.
const CW := 360
const CH := 560

func _init() -> void:
	var a := OS.get_cmdline_user_args()
	var out: String = a[0] if a.size() > 0 else "studio.png"
	var ids: Array = String(a[1]).split(",") if a.size() > 1 else ["marc"]
	var anim: String = a[2] if a.size() > 2 else "Idle"
	var t := float(a[3]) if a.size() > 3 else 0.3
	var blink := float(a[4]) if a.size() > 4 else -1.0
	await process_frame
	var vp := SubViewport.new()
	vp.size = Vector2i(CW, CH)
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.own_world_3d = true
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("4a5058")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("8f9bb0")
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.05
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var key := DirectionalLight3D.new()
	key.rotation = Vector3(deg_to_rad(-32), deg_to_rad(28), 0)
	key.light_energy = 2.0
	key.light_color = Color("fff1e0")
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 8.0
	vp.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.rotation = Vector3(deg_to_rad(-12), deg_to_rad(-55), 0)
	fill.light_energy = 0.45
	fill.light_color = Color("c8d8ff")
	vp.add_child(fill)
	var rim := DirectionalLight3D.new()
	rim.rotation = Vector3(deg_to_rad(-20), deg_to_rad(165), 0)
	rim.light_energy = 1.1
	vp.add_child(rim)
	var floor_m := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(20, 20)
	floor_m.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color("3a3e44")
	fm.roughness = 0.9
	floor_m.material_override = fm
	vp.add_child(floor_m)
	var cam := Camera3D.new()
	vp.add_child(cam)
	cam.current = true
	var views := [[0.0, 3.6, 0.92, 0.92, 30.0], [35.0, 3.6, 0.92, 0.92, 30.0], [90.0, 3.6, 0.92, 0.92, 30.0], [180.0, 3.6, 0.92, 0.92, 30.0],
		[0.0, 0.85, -1.0, -1.0, 24.0], [38.0, 0.85, -1.0, -1.0, 24.0]]
	var sheet := Image.create(CW * views.size(), CH * ids.size(), false, Image.FORMAT_RGBA8)
	for r in ids.size():
		var m := CharacterModel.create(String(ids[r]))
		if m == null:
			printerr("modèle absent : ", ids[r])
			continue
		vp.add_child(m)
		if anim.begins_with("ARMED:"):
			# arme tenue (posture de la 3e personne : AvatarPose, cinématique inverse et doigts sur l'arme)
			var wid := anim.substr(6)
			m.play("Idle")
			var ap := AvatarPose.new()
			m.skeleton.add_child(ap)
			var gun: Node3D = load("res://scenes/weapon_models.gd").build(wid, null)
			m.add_child(gun)
			ap.gun = gun
			ap.hands = load("res://scenes/weapon_models.gd").hands(wid)
			ap.posed = true
			ap.aim_pitch = 0.0
			m.player.speed_scale = 0.0
		else:
			m.pose(anim, t)
		if blink >= 0.0 and m.face != null:
			m.face.force_blink(blink)
		var st := m.stats()
		print("%s : %d triangles, %d surfaces" % [ids[r], st["tris"], st["surfaces"]])
		var hb := m.skeleton.find_bone("Head")
		for c in views.size():
			var v: Array = views[c]
			var tgt := Vector3(0, float(v[2]), 0)
			if float(v[2]) < 0.0:
				var hp := m.skeleton.global_transform * m.skeleton.get_bone_global_pose(hb).origin
				tgt = hp + Vector3(0, 0.1, 0.0)
			var yaw := deg_to_rad(float(v[0]))
			var pos := tgt + Vector3(sin(yaw), 0.04 if float(v[2]) < 0.0 else 0.08, cos(yaw)) * float(v[1])
			cam.fov = float(v[4])
			cam.look_at_from_position(pos, tgt)
			if m.face != null:
				m.face.look_at_world = cam.global_position if float(v[2]) < 0.0 else Vector3.INF
			for i in 4:
				await process_frame
			RenderingServer.force_draw()
			var img := vp.get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			sheet.blit_rect(img, Rect2i(0, 0, CW, CH), Vector2i(c * CW, r * CH))
		m.queue_free()
		await process_frame
	sheet.save_png(out)
	quit(0)
