extends RefCounted
## v0.21.0 : modèles 3D des 8 personnages jouables (assets/characters/*.glb, tools/build-characters.py) : fichier présent, squelette commun, animations requises,
## budget de triangles, accessoires « Prop_* », couleurs de la vue à la première personne égales aux matériaux du modèle, chargement paresseux.

func _skel(m: CharacterModel) -> Skeleton3D:
	return m.skeleton

func _mat_color(m: CharacterModel, mat: String) -> Variant:
	for mi in m._meshes():
		for s in (mi as MeshInstance3D).mesh.get_surface_count():
			var mt := (mi as MeshInstance3D).mesh.surface_get_material(s)
			if mt is StandardMaterial3D and mt.resource_name == "%s_%s" % [m.id, mat]:
				return (mt as StandardMaterial3D).albedo_color
	return null

func run(t: Node) -> void:
	t.check(CharacterModel.IDS == CharacterDefs.LIST.map(func(c): return c["id"]), "les 8 identifiants de CharacterModel sont ceux de CharacterDefs")
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
			for b in CharacterModel.BONES:
				t.check(sk.find_bone(b) >= 0, "%s : os %s" % [cid, b])
		t.check(m.player != null, "%s : lecteur d'animations" % cid)
		if m.player != null:
			for a in CharacterModel.ANIMS:
				t.check(m.player.has_animation(a), "%s : animation %s" % [cid, a])
				if m.player.has_animation(a):
					var an := m.player.get_animation(a)
					t.check(an.length > 0.2 and an.get_track_count() >= 14, "%s : %s a une durée et des pistes (%.2f s, %d pistes)" % [cid, a, an.length, an.get_track_count()])
					t.check((an.loop_mode == Animation.LOOP_NONE) == (a in CharacterModel.ONE_SHOT), "%s : %s boucle selon son type" % [cid, a])
		var st := m.stats()
		t.check(st["tris"] >= 2500 and st["tris"] <= 8000, "%s : %d triangles (budget 2,5 à 8 k)" % [cid, st["tris"]])
		t.check(st["surfaces"] <= 30, "%s : %d surfaces (appels de dessin)" % [cid, st["surfaces"]])
		var aabb := AABB()
		for mi: MeshInstance3D in m._meshes():
			if mi.name.begins_with("Prop_"):
				continue
			aabb = aabb.merge(mi.get_aabb()) if aabb.has_surface() else mi.get_aabb()
		t.check(aabb.size.y > 1.2 and aabb.size.y < 2.1, "%s : taille %.2f m" % [cid, aabb.size.y])
		t.check(m.stats()["meshes"] >= 1, "%s : maillages" % cid)
		# couleurs de la vue à la première personne = matériaux du modèle (gant, manche)
		var o := CharacterModel.outfit(cid)
		for k in ["glove", "sleeve"]:
			var c: Variant = _mat_color(m, k)
			t.check(c != null and (c as Color).is_equal_approx((o[k] as Color)) or (c != null and absf((c as Color).r - (o[k] as Color).r) < 0.02 and absf((c as Color).g - (o[k] as Color).g) < 0.02 and absf((c as Color).b - (o[k] as Color).b) < 0.02), "%s : couleur %s de la 1re personne = matériau du modèle" % [cid, k])
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
