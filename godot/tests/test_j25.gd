extends RefCounted
## v0.20.2 : bras et mains en vue première personne : données de chaque arme (data/weapon_models.json, clé "hands", produite par tools/gen-weapon-hands.py),
## courbe de rechargement de la main avant, montage de HandsRig sans nœud de jeu. Purement visuel : aucune règle de la simulation n'est touchée.

func run(t: Node) -> void:
	var ids: Array = WeaponModels_table().keys()
	t.check(ids.size() == 23, "23 armes dans la table (%d)" % ids.size())
	for id in ids:
		var h: Dictionary = preload("res://scenes/weapon_models.gd").hands(String(id))
		t.check(not h.is_empty(), "%s : mains définies" % id)
		if h.is_empty():
			continue
		t.check(String(h["style"]) in ["pistol", "rifle"], "%s : style connu" % id)
		var ok := true
		for k in [h["rear"]["pos"], h["front"]["pos"], h["mag"]]:
			for c in k:
				ok = ok and is_finite(float(c)) and absf(float(c)) < 0.6
		t.check(ok, "%s : positions finies et proches de l'arme" % id)
		t.check(float(h["rear"]["pos"][1]) <= -0.03 and float(h["rear"]["pos"][1]) >= -0.12, "%s : main arrière sous la ligne de canon" % id)
		t.check(float(h["front"]["r"]) >= 0.012 and float(h["front"]["r"]) <= 0.03, "%s : rayon du garde-main borné" % id)
		t.check(float(h["mag"][1]) < float(h["rear"]["pos"][1]) + 0.05, "%s : chargeur sous la poignée" % id)
		var home := Vector3(float(h["front"]["pos"][0]), float(h["front"]["pos"][1]), float(h["front"]["pos"][2]))
		var mag := Vector3(float(h["mag"][0]), float(h["mag"][1]), float(h["mag"][2]))
		var st := String(h["style"])
		t.check(HandsRig.reload_offset(-1.0, home, mag, st) == Vector3.ZERO, "%s : pas de décalage hors rechargement" % id)
		t.check(HandsRig.reload_offset(0.0, home, mag, st).length() < 1e-5 and HandsRig.reload_offset(1.0, home, mag, st).length() < 1e-5, "%s : la main revient à sa place aux extrémités" % id)
		var far := 0.0
		var p := 0.0
		while p <= 1.0:
			far = maxf(far, HandsRig.reload_offset(p, home, mag, st).length())
			p += 0.01
		t.check(far < 0.6, "%s : excursion de la main bornée (%.2f m)" % [id, far])
	# montage hors scène : construit et met à jour sans erreur
	var gun := Node3D.new()
	var rig := HandsRig.new()
	rig.build(gun, "ak47")
	t.check(rig.root != null and rig.root.get_parent() == gun, "HandsRig monté sous l'arme")
	for p in [-1.0, 0.0, 0.5, 1.0]:
		rig.update(Transform3D(Basis.IDENTITY, Vector3(0.2, -0.2, -0.4)), p, false)
	rig.update(Transform3D.IDENTITY, -1.0, true)
	t.check(not rig.rear.visible, "couteau : la main arrière quitte l'arme")
	gun.free()

func WeaponModels_table() -> Dictionary:
	return preload("res://scenes/weapon_models.gd").table()
