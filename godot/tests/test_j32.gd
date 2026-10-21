extends RefCounted
## v0.25.1 : vue à la troisième personne à pied. Caméra (RideCam en mode « à pied » : bras, visée, collision), départ du tir au pivot et dans l'axe de la caméra (donc par le
## réticule), aucun effet sur la simulation (même position, mêmes zombies, hitbox inchangées), touche T sans conflit, réglage « Vue », animation Jump des 8 personnages et
## cinématique inverse des bras armés (AvatarPose : les poignets atteignent les prises de l'arme).

const WeaponModels := preload("res://scenes/weapon_models.gd")
func _settle(n: int, input := {}) -> void:
	for _i in n:
		Game.step(1.0 / 60.0, input)

func _new_arena(view: int) -> void:
	Game.new_game(7, "arena")
	Game.settings.autosave = false
	Game.settings.values["view"] = view
	Game.player.pos = _clear_spot()
	Game.player.yaw = 0.0
	Game.player.pitch = 0.0

## Un point de l'arène à plus de 8 m de tout obstacle dans toutes les directions horizontales (hauteur de la tête).
func _clear_spot() -> Vector3:
	for gx in range(-20, 21, 4):
		for gz in range(-20, 21, 4):
			var ok := true
			for i in 16:
				var a := TAU * i / 16.0
				if Game.collision.ray_hit(gx, 1.6, gz, cos(a), 0.0, sin(a), 8.0) < 8.0:
					ok = false
					break
			if ok:
				return Vector3(gx, 0, gz)
	return Vector3.ZERO

func run(t: Node) -> void:
	# --- clavier : touche T, aucun conflit
	var kb := Keybinds.new()
	t.check(kb.map.get("footView", "") == "key:t", "touche par défaut de la vue à pied : T (%s)" % kb.map.get("footView", ""))
	t.check(Keybinds.ACTIONS.get("footView", "") == "foot_view", "action « foot_view » de l'InputMap")
	var same := 0
	for d: Dictionary in kb.defs:
		if d["id"] != "footView" and kb.map.get(d["id"], "") == "key:t":
			same += 1
	t.check(same == 0, "personne d'autre n'utilise T")
	t.check(kb.map.get("knife", "") == "key:v" and kb.map.get("vehicleView", "") == "key:v", "V reste le couteau (à pied) et la vue des machines")
	# --- vue à la première personne : rien ne change
	_new_arena(0)
	_settle(40)
	t.check(not Game.foot_cam.placed and Game.player.eye_override == Vector3.INF and Game.player.eye_ext == 0.0, "1re personne : pas de caméra externe")
	t.check(Game.player.shot_eye().is_equal_approx(Game.player.eye()), "1re personne : les tirs partent de l'oeil")
	var pos_fp := Game.player.pos
	# --- 3e personne : caméra posée à 2,7 m, tir au pivot
	_new_arena(1)
	_settle(60)
	var C: RideCam = Game.foot_cam
	t.check(C.placed and C.k >= 0.999, "3e personne : la caméra est posée")
	t.near(C.dist, RideCam.FOOT["arm"], "bras de 2,7 m en terrain dégagé", 0.02)
	t.check(Game.player.eye_override.is_equal_approx(C.cam_pos), "l'oeil du joueur est la caméra")
	t.near(Game.player.eye_ext, C.dist, "le tir est avancé de la distance caméra - pivot")
	t.check(C.external(), "la vue est externe (l'arme de la première personne se cache)")
	# le pivot est à droite de la tête, au-dessus
	var head := Game.player.pos + Vector3(0, float(Config.at("player.eye")), 0)
	var piv := Game.player.shot_eye()
	var right := Vector3(cos(Game.player.yaw), 0, -sin(Game.player.yaw))
	t.near((piv - head).dot(right), RideCam.FOOT["pivotRight"], "pivot à l'épaule droite", 0.05)
	# une cible sur l'axe de la caméra est touchée, même derrière l'épaule
	Game.player.yaw = 0.6
	Game.player.pitch = -0.08
	_settle(30)
	var dir := Game.player.forward()
	var cam_o := C.cam_pos
	var target := cam_o + dir * (C.dist + 12.0) - Vector3(0, 0.9, 0)
	var z := Game.debug_spawn(target, 0.0)
	z.pos = target
	var res := Hitscan.cast(Game.player.shot_eye(), dir, 60.0, Game.zombies, Game.collision, 1)
	t.check(res["hits"].size() == 1 and res["hits"][0]["z"] == z, "le rayon du pivot, dans l'axe de la caméra, touche la cible placée sous le réticule")
	t.near(((cam_o + dir * C.dist) - Game.player.shot_eye()).length(), 0.0, "la caméra, le pivot et le tir sont alignés", 0.002)
	# la même cible, vue depuis la caméra : le rayon de la caméra passe par le même point
	var from_cam := Hitscan.cast(cam_o, dir, 60.0, Game.zombies, Game.collision, 1)
	t.check(from_cam["hits"].size() == 1 and absf(from_cam["hits"][0]["t"] - (res["hits"][0]["t"] + C.dist)) < 0.01, "même point touché depuis la caméra (écart %.3f m)" % absf(from_cam["hits"][0]["t"] - (res["hits"][0]["t"] + C.dist)))
	# couteau : part du pivot (1,5 m devant : touché), pas de la caméra (4,2 m : manqué)
	Game.zombies.clear()
	var z2 := Game.debug_spawn(Game.player.shot_eye() + dir * 1.4 - Vector3(0, 0.9, 0), 0.0)
	var pk := WeaponMelee.pick_target(Game.player, Game.zombies, Game.collision)
	t.check(not pk.is_empty() and pk["z"] == z2, "coup de couteau : la cible à 1,4 m du pivot est visée")
	Game.zombies.clear()
	# --- visée : la caméra se rapproche
	_settle(60, {"aim": true})
	t.check(C.dist < 1.7, "visée : la caméra se rapproche (%.2f m)" % C.dist)
	_settle(60, {})
	t.near(C.dist, RideCam.FOOT["arm"], "puis revient", 0.05)
	# --- regard vers le bas : le bras raccourcit (la caméra ne passe pas au-dessus des toits)
	Game.player.pitch = -1.2
	_settle(60)
	t.check(C.dist < 1.4, "regard à -1,2 rad : bras raccourci (%.2f m)" % C.dist)
	Game.player.pitch = 0.0
	# --- collision : le dos au mur, la caméra s'arrête avant (arène : mur à x = +30)
	var half := float(Config.at("arenaHalf"))
	Game.player.pos = Vector3(half - 1.5, 0, 0)
	Game.player.yaw = PI / 2.0   # face à -X : la caméra est derrière, vers le mur
	_settle(90)
	t.check(C.placed and C.cam_pos.x < half, "le dos au mur : la caméra reste dans l'arène (x = %.2f, mur à %.0f)" % [C.cam_pos.x, half])
	t.check(C.dist < 1.6, "le dos au mur : le bras se raccourcit (%.2f m)" % C.dist)
	# --- 3e personne sans effet sur la simulation : mêmes entrées, même position, mêmes zombies
	var inputs := {"mx": 0.0, "mz": 1.0, "sprint": true}
	var ends: Array = []
	for view in [0, 1]:
		_new_arena(view)
		Game.player.yaw = 0.3
		Game.debug_spawn(Vector3(3, 0, -8), 2.0)
		for _i in 180:
			Game.step(1.0 / 60.0, inputs)
		ends.append([Game.player.pos, Game.zombies[0].pos, Game.player.health])
	t.check(ends[0][0].is_equal_approx(ends[1][0]), "mêmes entrées : le joueur est au même endroit en 1re et en 3e personne (%s / %s)" % [ends[0][0], ends[1][0]])
	t.check(ends[0][1].is_equal_approx(ends[1][1]) and ends[0][2] == ends[1][2], "les zombies agissent de même (hitbox du joueur inchangées)")
	t.near(float(Config.at("player.radius")), 0.4, "rayon du joueur inchangé")
	# --- retour à la 1re personne : la caméra se range
	Game.settings.values["view"] = 0
	_settle(40)
	t.check(not Game.foot_cam.placed and Game.player.eye_override == Vector3.INF and Game.player.eye_ext == 0.0, "retour à la 1re personne : la caméra est rangée")
	# --- carte de Strasbourg : c'est la caméra des machines qui sert
	Game.new_game(3, "strasbourg")
	Game.settings.autosave = false
	Game.settings.values["view"] = 1
	t.check(Game.view_cam() == Game.rides.cam, "Strasbourg : view_cam() est rides.cam")
	_settle(60)
	t.check(Game.rides.cam.foot_third and Game.rides.cam.placed and Game.rides.cam.dist > 1.0, "Strasbourg : la caméra à pied est posée (%.2f m)" % Game.rides.cam.dist)
	Game.settings.values["view"] = 0
	Game.unload()
	# --- les 8 personnages ont l'animation Jump
	CharacterModel.purge_except("")
	for cid: String in CharacterModel.IDS:
		var m := CharacterModel.create(cid)
		t.check(m != null and m.player.has_animation("Jump"), "%s : animation Jump" % cid)
		if m != null and m.player.has_animation("Jump"):
			t.check(m.player.get_animation("Jump").loop_mode == Animation.LOOP_LINEAR, "%s : Jump boucle" % cid)
		if m != null:
			m.free()
	CharacterModel.purge_except("")
	# --- cinématique inverse : les poignets atteignent les prises de l'arme (arme tenue en vue de la 3e personne)
	await _check_arms(t)

## Une scène avec le modèle et le modificateur AvatarPose, quelques images, puis mesure.
func _check_arms(t: Node) -> void:
	var holder := Node3D.new()
	t.add_child(holder)
	var m := CharacterModel.create("marc")
	holder.add_child(m)
	var pose := AvatarPose.new()
	m.skeleton.add_child(pose)
	var gun: Node3D = WeaponModels.build("rifle", null)
	m.add_child(gun)
	pose.gun = gun
	pose.hands = WeaponModels.hands("rifle")
	pose.posed = true
	m.play("Idle")
	for yaw_case in [[0.0, 0.0], [0.5, 0.3], [-0.6, -0.4]]:
		pose.twist = yaw_case[0]
		pose.aim_pitch = yaw_case[1]
		for _f in 4:
			await t.get_tree().process_frame
		m.skeleton.advance(0.0)
		var sk := m.skeleton
		var lo := sk.get_bone_global_pose(sk.find_bone("LowerArm.R"))
		var wrist: Vector3 = m.to_global(pose.wrist_r)
		var hs: Dictionary = pose.hands
		var rear: Array = hs["rear"]["pos"]
		var target: Vector3 = m.to_global(pose.gun_xf * (Vector3(rear[0], rear[1], rear[2]) + Vector3(0.034, -0.016, 0.066)))
		t.check(wrist.distance_to(target) < 0.06, "main droite sur la poignée (torsion %.1f, tangage %.1f : écart %.3f m)" % [yaw_case[0], yaw_case[1], wrist.distance_to(target)])
		var up := sk.get_bone_global_pose(sk.find_bone("UpperArm.R"))
		var up_len := up.origin.distance_to(lo.origin)
		t.near(up_len, sk.get_bone_global_rest(sk.find_bone("UpperArm.R")).origin.distance_to(sk.get_bone_global_rest(sk.find_bone("LowerArm.R")).origin), "le bras garde sa longueur", 0.01)
		var dir: Vector3 = (gun.global_transform.basis * Vector3(0, 0, -1)).normalized()
		var want := (Basis(Vector3.UP, yaw_case[0]) * Basis(Vector3.RIGHT, -yaw_case[1]) * Vector3(0, 0, 1)).normalized()
		t.check(dir.dot(want) > 0.999, "le canon suit la visée (torsion %.1f, tangage %.1f)" % [yaw_case[0], yaw_case[1]])
	holder.queue_free()
