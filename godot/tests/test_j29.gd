extends RefCounted
## v0.21.0, refait en v0.31.0 : modèles 3D des 8 personnages jouables (assets/characters/<id>.gltf + textures, tools/build-characters.py et tools/charlib/) :
## fichiers présents, squelette étendu (18 os historiques + mains, doigts, orteils, mâchoire, yeux, paupières), animations requises (dont Sprint), doigts
## qui se referment dans le bon sens, budget de triangles, niveaux de détail, textures PBR (albedo, normales, ORM), peau avec diffusion, cartes de
## cheveux en test alpha, visage (clignement, regard), accessoires « Prop_* », tenue de la première personne, chargement paresseux.

func _skel(m: CharacterModel) -> Skeleton3D:
	return m.skeleton

func _materials(m: CharacterModel) -> Array:
	var out: Array = []
	for mi in m._meshes():
		for s in (mi as MeshInstance3D).mesh.get_surface_count():
			var mt := (mi as MeshInstance3D).mesh.surface_get_material(s)
			if mt is StandardMaterial3D:
				out.append(mt)
	return out

func _body_mesh(m: CharacterModel) -> MeshInstance3D:
	var best: MeshInstance3D = null
	for mi: MeshInstance3D in m._meshes():
		if mi.name.begins_with("Prop_") or mi.name == "Hair":
			continue
		if best == null or mi.mesh.get_surface_count() > best.mesh.get_surface_count():
			best = mi
	return best

func run(t: Node) -> void:
	t.check(CharacterModel.IDS == CharacterDefs.LIST.map(func(c): return c["id"]), "les 8 identifiants de CharacterModel sont ceux de CharacterDefs")
	CharacterModel.purge_except("")   # d'autres suites (préchauffage) ont pu charger le personnage choisi
	t.check(CharacterModel.loaded_count() == 0, "rien n'est chargé avant la première demande (chargement paresseux)")
	for cid: String in CharacterModel.IDS:
		t.check(CharacterModel.exists(cid), "%s : modèle présent" % cid)
		var m := CharacterModel.create(cid)
		t.check(m != null, "%s : instance créée" % cid)
		if m == null:
			continue
		var sk := _skel(m)
		t.check(sk != null, "%s : squelette" % cid)
		if sk != null:
			for b in CharacterModel.BONES + CharacterModel.EXTRA_BONES + CharacterModel.FACE_BONES + CharacterModel.finger_bones():
				t.check(sk.find_bone(b) >= 0, "%s : os %s" % [cid, b])
			t.check(sk.get_bone_count() == 57, "%s : 57 os (%d)" % [cid, sk.get_bone_count()])
			t.check(sk.get_bone_parent(sk.find_bone("Hand.R")) == sk.find_bone("LowerArm.R") and sk.get_bone_parent(sk.find_bone("Index1.R")) == sk.find_bone("Hand.R"),
				"%s : main enfant de l'avant-bras, doigts enfants de la main" % cid)
		t.check(m.player != null, "%s : lecteur d'animations" % cid)
		if m.player != null:
			for a in CharacterModel.ANIMS:
				t.check(m.player.has_animation(a), "%s : animation %s" % [cid, a])
				if m.player.has_animation(a):
					var an := m.player.get_animation(a)
					t.check(an.length > 0.2 and an.get_track_count() >= 50, "%s : %s a une durée et des pistes (%.2f s, %d pistes)" % [cid, a, an.length, an.get_track_count()])
					t.check((an.loop_mode == Animation.LOOP_NONE) == (a in CharacterModel.ONE_SHOT), "%s : %s boucle selon son type" % [cid, a])
			# doigts : sur le guidon (Sit_Moto), le bout de l'index passe du côté de la paume
			if sk != null:
				# bout de l'index dans le repère de la main (enchaînement des poses locales : ne dépend pas du cache du squelette)
				var chain := ["Index1.L", "Index2.L", "Index3.L"]
				var palm_side := func() -> float:
					var x := Transform3D.IDENTITY
					for n in chain:
						var bi := sk.find_bone(n)
						x = x * Transform3D(Basis(sk.get_bone_pose_rotation(bi)), sk.get_bone_pose_position(bi))
					var tip := x * Vector3(0, 0.02, 0)
					var hrest := sk.get_bone_rest(sk.find_bone("Hand.L"))
					return tip.dot(Vector3(0, 0, 1)) + 0.0 * hrest.origin.x
				var rest_side: float = palm_side.call()
				m.pose("Sit_Moto", 0.2)
				var grip_side: float = palm_side.call()
				t.check(grip_side > rest_side + 0.015, "%s : sur le guidon, l'index se replie vers la paume (%.3f -> %.3f m)" % [cid, rest_side, grip_side])
				var q := sk.get_bone_pose_rotation(sk.find_bone("Middle2.R"))
				t.check(q.get_angle() > deg_to_rad(40.0), "%s : phalange du majeur droit pliée sur le guidon (%.0f°)" % [cid, rad_to_deg(q.get_angle())])
				m.pose("Idle", 0.0)
		var st := m.stats()
		t.check(st["tris"] >= 15000 and st["tris"] <= 36000, "%s : %d triangles (budget 15 à 36 k au plus près)" % [cid, st["tris"]])
		t.check(st["surfaces"] <= 6, "%s : %d surfaces (appels de dessin)" % [cid, st["surfaces"]])
		var aabb := AABB()
		for mi: MeshInstance3D in m._meshes():
			if mi.name.begins_with("Prop_"):
				continue
			aabb = aabb.merge(mi.get_aabb()) if aabb.has_surface() else mi.get_aabb()
		t.check(aabb.size.y > 1.2 and aabb.size.y < 2.1, "%s : taille %.2f m" % [cid, aabb.size.y])
		# niveaux de détail (générés à l'import) sur le corps
		var bm := _body_mesh(m)
		t.check(bm != null, "%s : maillage du corps" % cid)
		if bm != null:
			var surf := RenderingServer.mesh_get_surface(bm.mesh.get_rid(), 0)
			var lods: Array = surf.get("lods", [])
			t.check(lods.size() >= 2, "%s : %d niveaux de détail sur le corps" % [cid, lods.size()])
		# textures PBR, peau, cheveux
		var has_skin := false
		var has_tex := false
		for mt: StandardMaterial3D in _materials(m):
			var nm := String(mt.resource_name)
			if nm.ends_with("_body") or nm.ends_with("_skin"):
				has_tex = mt.albedo_texture != null and mt.normal_enabled and mt.normal_texture != null and mt.roughness_texture != null and mt.ao_enabled
				t.check(has_tex, "%s : %s : albedo, normales, rugosité et occlusion en textures" % [cid, nm])
				if mt.albedo_texture != null:
					t.check(mt.albedo_texture.get_width() >= 1024, "%s : texture de %d px" % [cid, mt.albedo_texture.get_width()])
			if nm.ends_with("_skin"):
				has_skin = true
				t.check(mt.subsurf_scatter_enabled and mt.rim_enabled, "%s : peau avec diffusion sous la surface et liseré" % cid)
			if nm.ends_with("_hair"):
				t.check(mt.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR and mt.cull_mode == BaseMaterial3D.CULL_DISABLED and mt.albedo_texture != null,
					"%s : cartes de cheveux en test alpha, deux faces" % cid)
		t.check(has_skin, "%s : une surface de peau" % cid)
		if cid in ["lea", "chloe", "klukai", "picsou", "harry"]:
			t.check(m.model.find_child("Hair", true, false) != null, "%s : cartes de cheveux" % cid)
		# visage : paupières (clignement), yeux (regard)
		t.check(m.face != null, "%s : FaceRig (clignement, regard)" % cid)
		# tenue de la première personne : couleurs et tissu générés
		for k in ["glove", "sleeve", "cuff"]:
			t.check(ResourceLoader.exists("res://assets/characters/%s_fp_%s.jpg" % [cid, k]), "%s : tissu %s de la première personne" % [cid, k])
		# accessoires à la main cachés assis
		var props := m._meshes().filter(func(n): return n.name.begins_with("Prop_"))
		if cid in ["picsou", "harry"]:
			t.check(props.size() >= 1, "%s : accessoire tenu (canne / baguette) en noeud Prop_*" % cid)
			m.play("Sit_Moto")
			t.check(not (props[0] as Node3D).visible, "%s : accessoire caché assis" % cid)
			m.play("Idle")
			t.check((props[0] as Node3D).visible, "%s : accessoire visible debout" % cid)
		else:
			t.check(props.is_empty(), "%s : pas d'accessoire séparé" % cid)
		m.free()
	t.check(CharacterModel.loaded_count() == 8, "8 modèles chargés après les avoir demandés")
	CharacterModel.purge_except("lea")
	t.check(CharacterModel.loaded_count() == 1 and CharacterModel.is_loaded("lea"), "purge_except ne garde que le modèle demandé")
	CharacterModel.purge_except("")
	t.check(CharacterModel.loaded_count() == 0, "purge totale")
	t.check(CharacterModel.create("inconnu") == null, "modèle inconnu : null (l'appelant garde son repli)")
	run_preview(t)
	run_integration(t)
	run_teammate(t)
	await run_face(t)

## v0.31.0 : le clignement ferme les paupières supérieures, le regard tourne les yeux vers la cible.
func run_face(t: Node) -> void:
	var holder := Node3D.new()
	t.add_child(holder)
	var m := CharacterModel.create("lea")
	holder.add_child(m)
	m.play("Idle")
	var sk := m.skeleton
	var lid := sk.find_bone("Lid.L")
	var eye := sk.find_bone("Eye.L")
	m.face.force_blink(1.0)
	for _f in 3:
		await t.get_tree().process_frame
	sk.advance(0.0)
	# (les poses modifiées ne sont lisibles que pendant la passe des modificateurs : FaceRig garde la dernière valeur appliquée)
	var rest_y := sk.get_bone_rest(lid).basis.y
	var closed_y := (sk.get_bone_rest(lid).basis * Basis(Vector3.RIGHT, m.face.applied_lid)).y
	t.check(rad_to_deg(-m.face.applied_lid) > 25.0 and closed_y.y < rest_y.y, "paupière abaissée au clignement (%.0f°, la pointe descend)" % rad_to_deg(-m.face.applied_lid))
	m.face.force_blink(0.0)
	var head_p := m.to_global(sk.get_bone_global_pose(eye).origin)
	m.face.look_at_world = head_p + Vector3(1.0, 0.0, 1.0)
	for _f in 3:
		await t.get_tree().process_frame
	sk.advance(0.0)
	var dir := (m.global_transform.basis * sk.global_transform.basis * m.face.applied_gaze).normalized()
	t.check(dir.dot(Vector3(1, 0, 1).normalized()) > 0.85, "les yeux regardent la cible (%.2f)" % dir.dot(Vector3(1, 0, 1).normalized()))
	holder.queue_free()
	CharacterModel.purge_except("")

## Aperçu du menu : un SubViewport à monde propre qui ne garde que le modèle choisi.
func run_preview(t: Node) -> void:
	var pv := CharacterPreview.new(Vector2(200, 260))
	t.check(pv.show_character("karim", Color("ff8a3d")), "aperçu : karim affiché")
	t.check(pv.model() != null and pv.model().id == "karim" and pv.model().current == "Idle", "aperçu : modèle karim en Idle")
	t.check(CharacterModel.loaded_count() == 1, "aperçu : un seul modèle chargé")
	t.check(pv.show_character("harry", Color("e0b040")) and CharacterModel.loaded_count() == 1 and CharacterModel.is_loaded("harry"), "aperçu : changer de survivant libère l'ancien modèle")
	t.check(not pv.show_character("inconnu", Color.WHITE) and not pv.visible, "aperçu : modèle absent = conteneur masqué (repli sur les portraits)")
	for cid in CharacterModel.IDS:
		t.check(ResourceLoader.exists("res://assets/characters/portrait_%s.png" % cid) or ResourceLoader.exists("res://assets/portraits/%s.png" % cid), "%s : un portrait pour la carte du menu" % cid)
	pv.free()
	CharacterModel.purge_except("")

## v0.21.2 : intégration (mains en 1re personne, places assises, locomotion d'un personnage affiché).
func run_integration(t: Node) -> void:
	for cid in CharacterModel.IDS:
		HandsRig.set_outfit(cid)
		var o := CharacterModel.outfit(cid)
		var want := (Color(o["glove"]).srgb_to_linear() * HandsRig.FP_TINT).linear_to_srgb()
		t.check(HandsRig.material("glove").albedo_color.is_equal_approx(want) and HandsRig.material("glove").albedo_texture != null, "%s : gants de la 1re personne (teinte et tissu)" % cid)
		t.check(HandsRig.material("sleeve").albedo_texture != null and HandsRig.material("sleeve").uv1_triplanar, "%s : manches de la 1re personne (tissu en triplanaire)" % cid)
	t.check(HandsRig.material("sleeve").albedo_color != HandsRig.material("glove").albedo_color, "gants et manches distincts")
	t.check(CharacterModel.seat_anim(false, "moto", true) == "Sit_Moto" and CharacterModel.seat_anim(false, "grosseMoto", false) == "Sit_Moto", "places de moto : Sit_Moto")
	t.check(CharacterModel.seat_anim(false, "velo", true) == "Sit_Bike", "vélo : Sit_Bike")
	t.check(CharacterModel.seat_anim(true, "tram", true) == "Sit_Tram_Drive" and CharacterModel.seat_anim(true, "tram", false) == "Sit_Tram", "rame : conducteur et passager")
	for cid in CharacterModel.IDS:
		var m := CharacterModel.create(cid)
		var h := m.hip_height()
		t.check(h > 0.6 and h < 1.1, "%s : hauteur de hanche %.2f m" % [cid, h])
		m.set_motion(0.0)
		t.check(m.current == "Idle", "%s : immobile = Idle" % cid)
		m.set_motion(1.5)
		t.check(m.current == "Walk", "%s : 1,5 m/s = Walk" % cid)
		m.set_motion(6.0)
		t.check(m.current == "Run", "%s : 6 m/s = Run" % cid)
		m.play("Sit_Tram")
		m.set_motion(6.0)
		t.check(m.current == "Sit_Tram", "%s : assis, la vitesse ne change pas l'animation" % cid)
		m.free()
	CharacterModel.purge_except("")

func run_teammate(t: Node) -> void:
	var tm := CharacterModel.teammate("marc", "Léa2", Color("4fc3f7"))
	t.check(tm != null and tm.get_node_or_null("NameTag") is Label3D and tm.current == "Idle", "coéquipier : modèle + pseudo, en Idle")
	t.check(CharacterModel.teammate("inconnu", "x", Color.WHITE) == null, "coéquipier sans modèle : null")
	tm.free()
	CharacterModel.purge_except("")
