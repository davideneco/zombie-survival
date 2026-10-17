extends RefCounted
## J13 : modèles d'armes. Chaque entrée de data/weapon_models.json existe (OBJ + MTL), est une vraie arme de la config, a une taille plausible
## (longueur, hauteur, épaisseur en mètres), une bouche cohérente avec le bout du modèle, et les armes sans modèle sont celles attendues.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const NO_MODEL := ["barrett", "m79", "crossbow", "raygun"]

func run(t: Node) -> void:
	var tab := WeaponModels.table()
	t.check(tab.size() == 19, "19 armes avec modèle (%d)" % tab.size())
	for id: String in tab:
		t.check(not Config.weapon(id).is_empty(), "%s : arme de la config" % id)
		var e: Dictionary = tab[id]
		for acc: Variant in [e["file"]] + (e["accessories"] as Array).map(func(a: Dictionary) -> String: return a["file"]):
			var f := String(acc)
			t.check(FileAccess.file_exists(WeaponModels.DIR + f), "%s : %s existe" % [id, f])
			t.check(FileAccess.file_exists(WeaponModels.DIR + f.get_basename() + ".mtl"), "%s : %s a son .mtl" % [id, f])
			t.check(WeaponModels.mesh_of(f) != null, "%s : %s se charge" % [id, f])
		var gun := WeaponModels.build(id, null)
		var bb := _bounds(gun)
		var cat := String(Config.weapon(id).get("cat", ""))
		var len_ok := bb.size.z > 0.2 and bb.size.z < 1.2
		t.check(len_ok, "%s : longueur plausible (%.2f m)" % [id, bb.size.z])
		t.check(bb.size.y > 0.05 and bb.size.y < 0.5, "%s : hauteur plausible (%.2f m)" % [id, bb.size.y])
		t.check(bb.size.x > 0.01 and bb.size.x < 0.2, "%s : épaisseur plausible (%.2f m)" % [id, bb.size.x])
		var m := WeaponModels.muzzle(id)
		t.check(absf(bb.position.z - m.z) < 0.03, "%s : la bouche est au bout du modèle (%.3f / %.3f)" % [id, bb.position.z, m.z])
		t.check(absf(m.y) < 0.05, "%s : bouche sur la ligne de canon (%.3f)" % [id, m.y])
		t.check(bb.position.z + bb.size.z > 0.0 and bb.position.z < -0.1, "%s : la poignée est entre l'arrière et la bouche (%s)" % [id, cat])
		gun.free()
	for id in NO_MODEL:
		t.check(not WeaponModels.has_model(id) and not Config.weapon(id).is_empty(), "%s : reste en primitives" % id)
	# toutes les armes de la config sont soit dans la table, soit dans la liste des primitives
	for id: String in Config.at("weapons"):
		t.check(WeaponModels.has_model(id) or id in NO_MODEL, "%s : modèle ou primitive déclarée" % id)

## Boîte englobante (repère de l'arme) de tous les MeshInstance3D d'un modèle.
func _bounds(n: Node3D) -> AABB:
	var out := AABB()
	var first := true
	for c in n.get_children():
		var mi := c as MeshInstance3D
		var b: AABB = mi.transform * mi.mesh.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out
