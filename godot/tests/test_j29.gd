extends RefCounted
## v0.21.0 : modèles 3D des 8 personnages jouables (assets/characters/*.glb, tools/build-characters.py) : fichier présent, squelette commun, animations requises,
## budget de triangles, accessoires « Prop_* », couleurs de la vue à la première personne égales aux matériaux du modèle, chargement paresseux.

func _skel(m: CharacterModel) -> Skeleton3D:
	return m.skeleton

## Le modèle contient-il un matériau de cette couleur (les matériaux de même valeur sont fusionnés par tools/build-characters.py : on cherche par valeur) ?
func _has_color(m: CharacterModel, c: Color) -> bool:
	for mi in m._meshes():
		for s in (mi as MeshInstance3D).mesh.get_surface_count():
			var mt := (mi as MeshInstance3D).mesh.surface_get_material(s)
			if mt is StandardMaterial3D:
				var a := (mt as StandardMaterial3D).albedo_color
				if absf(a.r - c.r) < 0.02 and absf(a.g - c.g) < 0.02 and absf(a.b - c.b) < 0.02:
					return true
	return false

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
		for k in ["glove", "sleeve", "cuff"]:
			t.check(_has_color(m, o[k] as Color), "%s : couleur %s de la 1re personne = un matériau du modèle" % [cid, k])
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
		t.check(HandsRig.material("glove").albedo_color.is_equal_approx(o["glove"]), "%s : gants de la 1re personne" % cid)
		t.check(HandsRig.material("sleeve").albedo_color.is_equal_approx(o["sleeve"]), "%s : manches de la 1re personne" % cid)
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
