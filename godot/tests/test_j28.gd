extends RefCounted
## v0.20.7 : couteau et Hache du Bourreau tenus en main (MeleeModels) : modèles (lame, garde, manche), couche de la vue d'arme, animation dont l'impact visuel tombe à hitDelay
## (l'instant des dégâts de la sim, inchangée). Le rendu lui-même se vérifie sur captures (--melee-pose=T, --axe).

const MeleeModels := preload("res://scenes/melee_models.gd")
const WeaponModels := preload("res://scenes/weapon_models.gd")

func _meshes(n: Node, out: Array) -> void:
	if n is MeshInstance3D:
		out.append(n)
	for c in n.get_children():
		_meshes(c, out)

func run(t: Node) -> void:
	var K: Dictionary = Config.at("knife")
	var hit := float(K["hitDelay"])
	var anim := float(K["anim"])
	for axe in [false, true]:
		var nm := "hache" if axe else "couteau"
		var m: Node3D = MeleeModels.build_axe() if axe else MeleeModels.build_knife()
		var ms: Array = []
		_meshes(m, ms)
		t.check(ms.size() >= (4 if axe else 5), "%s : %d pièces (lame / tête, garde, manche, pommeau)" % [nm, ms.size()])
		var aabb := AABB()
		var layers_ok := true
		for mi: MeshInstance3D in ms:
			layers_ok = layers_ok and mi.layers == WeaponModels.VIEW_LAYER
			aabb = aabb.merge(mi.transform * mi.get_aabb()) if aabb.has_surface() else mi.transform * mi.get_aabb()
		t.check(layers_ok, "%s : couche de la vue d'arme" % nm)
		t.check(aabb.size.z > (0.45 if axe else 0.3), "%s : longueur %.2f m le long de -Z" % [nm, aabb.size.z])
		t.check(aabb.position.z < -0.25, "%s : la lame part vers l'avant (z min %.2f)" % [nm, aabb.position.z])
		m.free()
		# animation : l'impact est à t = hit ; le geste y est le plus rapide et le plus avancé ; pose continue ; retour hors champ à anim
		var at_hit := MeleeModels.pose(axe, hit, hit, anim).origin
		var before := MeleeModels.pose(axe, hit - 0.01, hit, anim).origin
		var after := MeleeModels.pose(axe, hit + 0.01, hit, anim).origin
		t.check(before.distance_to(at_hit) < 0.05 and after.distance_to(at_hit) < 0.05, "%s : pose continue à l'impact" % nm)
		t.check(before.distance_to(at_hit) > 0.8 * after.distance_to(at_hit), "%s : le geste est à pleine vitesse à l'impact" % nm)
		var arm := MeleeModels.pose(axe, 0.0, hit, anim).origin
		var back := MeleeModels.pose(axe, anim, hit, anim).origin
		t.check(arm.y > at_hit.y and arm.x > at_hit.x, "%s : armement en haut à droite, coup vers le centre" % nm)
		t.check(at_hit.z <= arm.z - 0.1, "%s : l'arme part vers l'avant jusqu'à l'impact (%.2f -> %.2f)" % [nm, arm.z, at_hit.z])
		var min_z := 0.0
		for i in 56:
			min_z = minf(min_z, MeleeModels.pose(axe, anim * i / 55.0, hit, anim).origin.z)
		t.check(absf(min_z - at_hit.z) < 0.08, "%s : l'impact est le point le plus avancé du geste" % nm)
		t.check(back.y < -0.5 and back.x > 0.25, "%s : retour hors champ en bas à droite" % nm)
	# la sim n'a pas changé : le coup frappe à hitDelay, dure anim
	t.near(hit, 0.12, "hitDelay de la sim inchangé")
	t.near(anim, 0.55, "durée du coup de la sim inchangée")
