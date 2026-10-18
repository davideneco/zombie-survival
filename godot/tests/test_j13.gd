extends RefCounted
## J13 / J15 : modèles d'armes. Chaque arme de la config a une entrée dans data/weapon_models.json (plus aucune primitive) ; chaque fichier existe (OBJ + MTL),
## a une taille plausible (longueur, hauteur, épaisseur en mètres), une bouche cohérente avec le bout du modèle, une position hanche et visée (mire sur le réticule :
## x = 0, mire sous l'axe de la vue de la hauteur de mire), et la vue d'arme se construit, tire, recharge et change d'arme pour chaque arme.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const WeaponView := preload("res://scenes/weapon_view.gd")

func run(t: Node) -> void:
	var tab := WeaponModels.table()
	t.check(tab.size() == Config.at("weapons").size(), "une entrée par arme de la config (%d / %d)" % [tab.size(), Config.at("weapons").size()])
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
		var len_ok := bb.size.z > 0.2 and bb.size.z < 1.25
		t.check(len_ok, "%s : longueur plausible (%.2f m)" % [id, bb.size.z])
		t.check(bb.size.y > 0.05 and bb.size.y < 0.5, "%s : hauteur plausible (%.2f m)" % [id, bb.size.y])
		t.check(bb.size.x > 0.01 and bb.size.x < (0.45 if cat == "special" else 0.2), "%s : épaisseur plausible (%.2f m)" % [id, bb.size.x])
		var m := WeaponModels.muzzle(id)
		t.check(absf(bb.position.z - m.z) < 0.03, "%s : la bouche est au bout du modèle (%.3f / %.3f)" % [id, bb.position.z, m.z])
		t.check(absf(m.y) < 0.05, "%s : bouche sur la ligne de canon (%.3f)" % [id, m.y])
		t.check(bb.position.z + bb.size.z > 0.0 and bb.position.z < -0.1, "%s : la poignée est entre l'arrière et la bouche (%s)" % [id, cat])
		gun.free()
	# toutes les armes de la config ont un modèle ET une position de visée
	for id: String in Config.at("weapons"):
		t.check(WeaponModels.has_model(id), "%s : a un modèle (plus de primitive)" % id)
		var e: Dictionary = tab[id]
		t.check(e.has("hip") and e.has("ads") and e.has("sight"), "%s : hanche, visée et hauteur de mire définies" % id)
		var hip := WeaponModels.hip(id)
		var ads := WeaponModels.ads(id)
		t.check(absf(ads.x) < 0.02, "%s : visée centrée (x = %.3f)" % [id, ads.x])
		t.check(ads.y < 0.0 and ads.y > -0.15, "%s : la mire est sous l'axe de la vue (y = %.3f)" % [id, ads.y])
		t.check(ads.z < -0.2 and ads.z > -0.7, "%s : distance de visée plausible (z = %.2f)" % [id, ads.z])
		t.check(hip.x > 0.1 and hip.x < 0.35 and hip.y < -0.1 and hip.z < -0.3, "%s : position à la hanche plausible" % id)
		t.check(ads.distance_to(hip) > 0.1, "%s : la visée déplace l'arme" % id)
		t.check(absf(float(e["sight"]) + ads.y) < 0.03, "%s : visée = hauteur de mire (%.3f / %.3f)" % [id, e["sight"], ads.y])
	# la vue d'arme : tir (éclair), rechargement et changement d'arme sur toutes les armes, sans erreur, avec la lumière de vue
	var cam := Camera3D.new()
	t.add_child(cam)
	var wv: Node3D = WeaponView.new()
	t.add_child(wv)
	wv.setup(cam)
	Game.new_game(1, "arena")
	for id: String in Config.at("weapons"):
		Game.arms.give_weapon(id)
		wv._build_gun()
		t.check(wv._gun != null and wv._gun.get_child_count() >= 1, "%s : vue d'arme construite" % id)
		t.check(wv._flash != null and wv._flash_light != null, "%s : éclair de bouche prêt" % id)
		var mz := WeaponModels.muzzle(id)
		t.check((wv._flash as Node3D).position.z < mz.z + 0.001 and (wv._flash as Node3D).position.z > mz.z - 0.1, "%s : éclair devant la bouche" % id)
		var lit := false
		for c in wv._gun.get_children():
			if c is DirectionalLight3D and (c as DirectionalLight3D).light_cull_mask == WeaponModels.VIEW_LAYER:
				lit = true
		t.check(lit, "%s : lumière de vue (couche des armes)" % id)
		wv._on_shot(Vector3.ZERO, Vector3.ZERO)
		var cfg: Dictionary = Config.weapon(id)
		t.check(wv._flash.visible == (cfg.get("flash", true) != false), "%s : éclair visible après un tir (sauf arbalète)" % id)
		var w: WeaponState = Game.arms.current
		t.check(w.id == id, "%s : arme en main" % id)
		# rechargement : chargeur vide -> en cours -> plein au bout du temps de rechargement
		w.ammo = 0
		w.reserve = int(w.cfg["maxReserve"])
		w.start_reload()
		t.check(w.reloading, "%s : rechargement lancé" % id)
		w.update(float(w.cfg["reloadTime"]) + 0.01)
		t.check(not w.reloading and w.ammo > 0, "%s : rechargé (%d)" % [id, w.ammo])
		# changement d'arme : un rechargement en cours est annulé, l'arme suivante se construit
		w.ammo = 0
		w.start_reload()
		var before := Game.arms.inventory.size()
		Game.arms.give_weapon("m1911" if id != "m1911" else "ak47")
		t.check(not Game.arms.current.reloading, "%s : changement d'arme : l'arme prise n'est pas en rechargement" % id)
		Game.arms.give_weapon(id)
		wv._process(0.016)
		t.check(wv._gun_id == id, "%s : la vue suit l'arme en main" % id)
		wv._process(0.016)
	t.remove_child(wv)
	wv.free()
	t.remove_child(cam)
	cam.free()

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
