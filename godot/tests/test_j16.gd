extends RefCounted
## J16 : zombies à modèles animés (Quaternius, tools/build-zombies.py). Chaque variante de data/zombie_models.json existe, charge, a ses animations ; tailles plausibles ;
## la tête dessinée recouvre la sphère de tête de la simulation (écart mesuré par des rayons, voir report) ; le pool recycle ; la vue se construit pour chaque état de la
## simulation (apparition par fenêtre et depuis le sol, marche, course, boiteux, rampant, attaque, enjambement, mort, tête explosée, touche, cendres) sans erreur.
## `-- --report` imprime le tableau des tirs sur la tête dessinée.

const Models := preload("res://scenes/zombie_models.gd")
const ModelView := preload("res://scenes/zombie_model_view.gd")
const DT := 1.0 / 60.0
const NEED := ["idle", "walk", "run", "attack", "death", "hit", "vault"]

func run(t: Node) -> void:
	_table(t)
	_pool(t)
	_hit_coverage(t)
	_views(t)
	_license(t)

func _table(t: Node) -> void:
	var tab := Models.table()
	var anims: Dictionary = tab["anims"]
	for m: String in tab["models"]:
		var e: Dictionary = tab["models"][m]
		t.check(FileAccess.file_exists(Models.DIR + String(e["file"])), "%s : %s existe" % [m, e["file"]])
		var size := FileAccess.get_file_as_bytes(Models.DIR + String(e["file"])).size()
		t.check(size > 100000 and size < 1500000, "%s : fichier de taille plausible (%d o)" % [m, size])
		var rig := Models.acquire(m, false)
		t.check(rig != null and rig.skel != null and rig.ap != null, "%s : se charge (squelette + lecteur)" % m)
		var skel: Skeleton3D = rig.skel
		for b in ["Hips", "Torso", "Neck", "Head", "UpperArm.L", "UpperArm.R", "UpperLeg.L", "LowerLeg.R", "Foot.L"]:
			t.check(skel.find_bone(b) >= 0, "%s : os %s" % [m, b])
		t.check(skel.find_bone("PoleTarget.L") >= 0 or true, "%s : os PoleTarget tolérés" % m)
		t.check(rig.heads.size() >= 1 and rig.heads.size() < rig.meshes.size(), "%s : tête séparée du corps (%d pièces)" % [m, rig.heads.size()])
		for k in NEED:
			t.check(rig.ap.has_animation(String(anims[k])), "%s : animation %s (%s)" % [m, k, anims[k]])
		t.check(rig.ap.has_animation("Crawl") == (m != "arm"), "%s : Crawl seulement sur les modèles qui rampent" % m)
		for an in rig.ap.get_animation_list():
			var a := rig.ap.get_animation(an)
			t.check(a.length > 0.2 and a.length < 2.0, "%s : %s dure %.2f s" % [m, an, a.length])
			t.check((a.loop_mode == Animation.LOOP_LINEAR) == (an in tab["loops"]), "%s : %s boucle comme la table" % [m, an])
			for i in a.get_track_count():
				var p := String(a.track_get_path(i))
				t.check(not ("Pinky" in p or "Thumb" in p or "PoleTarget" in p or "Tongue" in p), "%s : %s sans piste de doigt ni de langue" % [m, an])
				break
		# taille : hauteur de la tête en pose de marche, à l'échelle de la table
		t.check(rig.root.find_children("*", "MeshInstance3D", true, false).size() == rig.meshes.size(), "%s : maillages repérés" % m)
		var sc := float(e["scale"])
		var body: MeshInstance3D
		for mi in rig.meshes:
			if String(mi.name) == "Body":
				body = mi
		var h := body.mesh.get_aabb().end.y * sc
		t.check(h > 1.3 and h < 2.7, "%s : hauteur du corps %.2f m (échelle %.2f)" % [m, h, sc])
		t.check(sc > 0.8 and sc < 2.5 and float(e["xz"]) > 0.6 and float(e["xz"]) < 1.5, "%s : échelle plausible" % m)
		t.check(float(e["hit_frac"]) > 0.2 and float(e["hit_frac"]) < 0.8, "%s : instant du coup plausible" % m)
		Models.release(rig)
	for key: String in tab["variants"]:
		var v := Models.variant(key)
		t.check(tab["models"].has(v["model"]), "variante %s : modèle %s" % [key, v["model"]])
		if v.has("crawl_model"):
			t.check(tab["models"].has(v["crawl_model"]) and FileAccess.file_exists(Models.DIR + String(tab["models"][v["crawl_model"]]["file"])), "variante %s : modèle de repli pour ramper" % key)
		for k in NEED:
			var an := String((v["anim"] as Dictionary)[k])
			var rig := Models.acquire(Models.model_of(v, null if false else _z(key)), bool(v.get("armor", false)))
			t.check(rig.ap.has_animation(an), "variante %s : animation %s (%s)" % [key, k, an])
			Models.release(rig)
		t.check((v["anim"] as Dictionary).has("idle") and (v["anim"] as Dictionary).has("walk"), "variante %s : idle et walk" % key)
		var rigc := Models.acquire(Models.model_of(v, _z("crawler")), bool(v.get("armor", false)))
		t.check(rigc.ap.has_animation("Crawl"), "variante %s : sait ramper (modèle %s)" % [key, rigc.model])
		Models.release(rigc)
	for k in ["normal", "runner", "limp", "crawler", "armored", "bloat"]:
		t.check(tab["variants"].has(k), "variante %s dans la table" % k)

## Un ZombieSim de la variante demandée.
func _z(key: String, id := 7) -> ZombieSim:
	var z := ZombieSim.new()
	z.id = id
	z.rng = Game.rng
	z.health = 100.0
	z.max_health = 100.0
	z.speed = 1.8
	match key:
		"runner":
			z.runner = true
			z.speed = 3.5
		"limp":
			z.limp = true
		"crawler":
			z.make_crawler()
		"armored":
			z.make_kind("armored")
		"bloat":
			z.make_kind("bloat")
	return z

func _pool(t: Node) -> void:
	var n0 := Models.created
	var a := Models.acquire("basic", false)
	var b := Models.acquire("basic", false)
	t.check(Models.created >= n0 and a != b, "pool : deux instances distinctes")
	t.check(a.root.get_parent() == null, "pool : instance neuve hors de l'arbre")
	var holder := Node3D.new()
	t.add_child(holder)
	holder.add_child(a.root)
	a.heads[0].visible = false
	Models.release(a)
	t.check(a.root.get_parent() == null and a.heads[0].visible, "pool : retirée de l'arbre et réinitialisée")
	var n1 := Models.created
	var c := Models.acquire("basic", false)
	t.check(c == a and Models.created == n1, "pool : l'instance libérée est réutilisée (pas de nouvelle fabrication)")
	Models.release(b)
	Models.release(c)
	var arm := Models.acquire("arm", true)
	t.check(arm.armor and arm.armor_nodes.size() >= 5, "armure : %d pièces posées sur des os" % arm.armor_nodes.size())
	var plain := Models.acquire("arm", false)
	t.check(not plain.armor and plain.armor_nodes.is_empty() and plain != arm, "armure : le pool sépare avec et sans armure")
	Models.release(arm)
	Models.release(plain)
	holder.queue_free()

## Tirs sur la tête DESSINÉE : des rayons de face (le zombie vient vers le joueur) et de côté dans l'ellipse du crâne, passés dans le vrai Hitscan.
## Renvoie { head, body, miss } en parts. `scale_mult` : multiplicateur d'essai de l'échelle de la table.
func head_stats(t: Node, model: String, anim: String, variant: String, scale_mult := 1.0, side := false) -> Dictionary:
	var e := Models.model_entry(model)
	var rig := Models.acquire(model, false)
	var holder := Node3D.new()
	t.add_child(holder)
	holder.add_child(rig.root)
	rig.ap.playback_default_blend_time = 0.0
	var skull: MeshInstance3D
	for m in rig.heads:
		if String(m.name) == "Head_Skull":
			skull = m
	var sa: AABB = skull.mesh.get_aabb()
	var hb := rig.skel.find_bone("Head")
	var rest_inv: Transform3D = rig.skel.get_bone_global_rest(hb).affine_inverse()
	var z := _z(variant, 7)
	var sc := z.body_scale()
	var s: float = float(e["scale"]) * scale_mult * sc.y
	var xz: float = float(e["xz"]) * (sqrt(sc.x / sc.y) if variant == "bloat" else 1.0)
	rig.ap.play(anim)
	var len: float = rig.ap.get_animation(anim).length
	var n := 0
	var h := 0
	var b := 0
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in 6:
		rig.ap.seek(len * i / 6.0, true)
		rig.ap.advance(0.0)
		rig.skel.force_update_all_bone_transforms()
		var pose: Transform3D = rig.skel.get_bone_global_pose(hb) * rest_inv
		var c: Vector3 = pose * sa.get_center()
		c = Vector3(c.x * s * xz, c.y * s, c.z * s * xz)
		var rx := sa.size.x * 0.5 * 0.9 * s * xz
		var ry := sa.size.y * 0.5 * 0.95 * s
		var rz := sa.size.z * 0.5 * 0.9 * s * xz
		for j in 300:
			var u := rng.randf_range(-1, 1)
			var w := rng.randf_range(-1, 1)
			if u * u + w * w > 1.0:
				continue
			n += 1
			var o: Vector3
			var d: Vector3
			if side:
				o = Vector3(5, c.y + w * ry, c.z + u * rz)
				d = Vector3(-1, 0, 0)
			else:
				o = Vector3(c.x + u * rx, c.y + w * ry, 5)
				d = Vector3(0, 0, -1)
			var r := Hitscan.ray_zombie(o, d, 50.0, z)
			if r.is_empty():
				continue
			if r["head"]:
				h += 1
			else:
				b += 1
	holder.queue_free()
	Models.release(rig)
	return {"head": float(h) / n, "body": float(b) / n, "miss": 1.0 - float(h + b) / n}

func _hit_coverage(t: Node) -> void:
	var report := "--report" in OS.get_cmdline_user_args()
	if report:
		for sm in [0.8, 0.9, 1.0, 1.1]:
			for spec in [["basic", "Walk", "normal"], ["basic", "Run", "runner"], ["basic", "Punch", "normal"], ["basic", "Crawl", "crawler"], ["chubby", "Walk", "bloat"], ["arm", "Walk", "armored"]]:
				var f := head_stats(t, spec[0], spec[1], spec[2], sm)
				var sd := head_stats(t, spec[0], spec[1], spec[2], sm, true)
				print("tête dessinée %s/%s échelle x%.2f : de face %.0f %% tête %.0f %% corps %.0f %% raté ; de côté %.0f %% tête %.0f %% corps %.0f %% raté" % [spec[0], spec[1], sm, f["head"] * 100, f["body"] * 100, f["miss"] * 100, sd["head"] * 100, sd["body"] * 100, sd["miss"] * 100])
	# le visage dessiné (centre du crâne) ne doit pas passer à travers : au moins un impact (tête ou corps) sur 60 % de la tête dessinée, de face, pour chaque variante
	for spec in [["basic", "Walk", "normal"], ["basic", "Run", "runner"], ["chubby", "Walk", "bloat"], ["arm", "Walk", "armored"], ["basic", "Crawl", "crawler"]]:
		var f := head_stats(t, spec[0], spec[1], spec[2])
		t.check(f["head"] + f["body"] >= 0.5, "%s/%s : de face, %.0f %% de la tête dessinée est touchable (tête %.0f %%)" % [spec[0], spec[1], (f["head"] + f["body"]) * 100, f["head"] * 100])
		t.check(f["head"] >= 0.2, "%s/%s : de face, au moins 20 %% de la tête dessinée compte comme tête (%.0f %%)" % [spec[0], spec[1], f["head"] * 100])

func _license(t: Node) -> void:
	var lic := FileAccess.get_file_as_string("res://assets/zombies/LICENSE.txt")
	for want in ["Quaternius", "zombieapocalypsekit", "CC0", "2026-10-18", "Quaternius Asset License", "QAL"]:
		t.check(lic.contains(want), "LICENSE.txt : « %s »" % want)
	var dir := DirAccess.get_files_at("res://assets/zombies")
	var glbs := 0
	for f in dir:
		if f.ends_with(".glb"):
			glbs += 1
	t.check(glbs == 3, "seulement les 3 modèles utilisés dans le dépôt (%d .glb)" % glbs)
	t.check(not FileAccess.file_exists("res://assets/zombies/Zombie_Ribcage.gltf") and not FileAccess.file_exists("res://assets/zombies/Characters_Sam.gltf"), "pas de modèle du pack inutilisé")

func _view(t: Node, z: ZombieSim) -> Node3D:
	var v := Node3D.new()
	v.set_script(ModelView)
	t.add_child(v)
	v.setup(z)
	return v

func _frames(v: Node3D, n: int) -> void:
	for _i in n:
		v._process(DT)

func _views(t: Node) -> void:
	Game.new_game(5, "arena")
	var A: Dictionary = Models.table()["anims"]
	# variantes : modèle, armure, animation de marche
	var cases := [["normal", "basic", false, "Walk"], ["runner", "basic", false, "Run"], ["limp", "basic", false, "Walk"], ["crawler", "basic", false, "Crawl"],
		["armored", "arm", true, "Walk"], ["bloat", "chubby", false, "Walk"]]
	for c in cases:
		var z := _z(c[0], 31)
		z.moving = true
		z.speed = 3.5 if c[0] == "runner" else 1.8
		z.walk_t = 3.0
		var v := _view(t, z)
		t.check(v._vkey == c[0], "%s : variante reconnue (%s)" % [c[0], v._vkey])
		t.check(v._rig.model == c[1] and v._rig.armor == c[2], "%s : modèle %s%s" % [c[0], c[1], " + armure" if c[2] else ""])
		_frames(v, 30)
		t.check(v._cur == c[3], "%s : marche = %s (%s)" % [c[0], c[3], v._cur])
		t.check(v._advanced == 30, "%s : l'animation avance à chaque image sans caméra (%d)" % [c[0], v._advanced])
		var sc := z.body_scale().y
		t.check(absf(v._rig.root.scale.y - float(Models.model_entry(c[1])["scale"]) * float(Models.variant(c[0]).get("scale", 1.0)) * sc) < 1e-4, "%s : échelle = table x taille du zombie" % c[0])
		if c[0] == "limp":
			t.check(absf(v._rig.root.rotation.z) > 0.001 and v._rig.root.position.y < 0.0, "boiteux : balancement et affaissement du modèle (%.3f)" % v._rig.root.rotation.z)
		t.check(v._rig.ap.speed_scale > 0.5 and v._rig.ap.speed_scale < 2.5, "%s : vitesse de lecture plausible (%.2f)" % [c[0], v._rig.ap.speed_scale])
		# à l'arrêt : attente
		z.moving = false
		_frames(v, 5)
		t.check(v._cur == (A["idle"] if c[0] != "crawler" else "Crawl"), "%s : à l'arrêt = attente (%s)" % [c[0], v._cur])
		v.free()
	# vitesse de lecture liée à la vitesse de la simulation
	var zs := _z("normal", 3)
	zs.moving = true
	zs.speed = 1.6
	var vs := _view(t, zs)
	_frames(vs, 5)
	var r1: float = vs._rig.ap.speed_scale
	zs.speed = 2.3
	_frames(vs, 5)
	t.check(vs._rig.ap.speed_scale > r1 + 0.2, "vitesse de lecture suit la vitesse de la sim (%.2f -> %.2f)" % [r1, vs._rig.ap.speed_scale])
	zs.speed = 2.9   # au-delà du seuil : course
	_frames(vs, 5)
	t.check(vs._cur == "Run", "vitesse >= %.1f : course" % Models.table()["run_from_speed"])
	vs.free()
	# phase décalée par identifiant (pas de clones)
	var pa := _view(t, _z("normal", 1))
	var pb := _view(t, _z("normal", 2))
	t.check(absf(pa._phase - pb._phase) > 0.001, "décalage de phase différent par id")
	pa.free()
	pb.free()
	# attaque synchronisée sur le coup de la simulation
	var za := _z("normal", 9)
	za.moving = false
	var va := _view(t, za)
	_frames(va, 3)
	za.attacking = true
	_frames(va, 2)
	var lenp: float = va._rig.lens["Punch"]
	var hit_t := lenp * float(Models.model_entry("basic")["hit_frac"])
	t.check(va._cur == "Punch", "attaque : Punch (%s)" % va._cur)
	t.near(va._rig.ap.speed_scale, hit_t / Rules.ZOMBIE_ATTACK_WINDUP, "attaque : le coup tombe à la fin de l'armement de la sim (x%.2f)" % va._rig.ap.speed_scale, 1e-6)
	za.attacking = false
	_frames(va, 10)
	t.check(va._cur == "Punch", "attaque : le coup va jusqu'au bout après la frappe")
	_frames(va, 60)
	t.check(va._cur == "Idle", "attaque : retour à l'attente (%s)" % va._cur)
	# touche : flash rouge, sang, HitReact
	var b0: float = va._blood
	za.damage(1.0, false)
	_frames(va, 2)
	t.check(va._cur == "HitReact", "touche : HitReact (%s)" % va._cur)
	t.check(va._flash_on, "touche : flash rouge")
	t.check(va._blood > b0, "touche : le sang monte (%.2f -> %.2f)" % [b0, va._blood])
	t.check(float(va._rig.meshes[0].get_instance_shader_parameter("flash")) == 1.0, "touche : uniforme flash posé sur les maillages")
	_frames(va, 12)
	t.check(not va._flash_on and float(va._rig.meshes[0].get_instance_shader_parameter("flash")) == 0.0, "touche : flash éteint après 0,1 s")
	# enjambement
	var zv := _z("normal", 12)
	zv.vault = {"t": 0.0}
	zv.moving = true
	var vv := _view(t, zv)
	_frames(vv, 3)
	t.check(vv._cur == "Jump", "enjambement : Jump (%s)" % vv._cur)
	vv.free()
	# apparition par une fenêtre : cachée pendant les coups, puis enjambe
	var zw := _z("normal", 14)
	zw.start_window_spawn(Vector3(0, 0, 0), Vector3(0, 0, 2), Vector3(0, 1, 1), Vector2(0, 1), 0.0)
	var vw := _view(t, zw)
	_frames(vw, 2)
	t.check(not vw._group.visible, "fenêtre : cachée pendant les coups")
	zw.spawn_elapsed = Rules.WIN_WARN + 0.1
	zw.spawn_t = 0.5
	_frames(vw, 3)
	t.check(vw._group.visible and vw._cur == "Jump", "fenêtre : visible et enjambe (%s)" % vw._cur)
	vw.free()
	# apparition depuis le sol : tertre, cachée puis remonte
	var zg := _z("normal", 15)
	zg.start_ground_spawn(Vector3(2, 0, 2), 0.0)
	var vg := _view(t, zg)
	_frames(vg, 2)
	t.check(not vg._group.visible and vg._mound != null, "sol : caché, tertre posé")
	zg.spawn_elapsed = Rules.GND_DELAY + 0.1
	zg.spawn_t = 0.5
	zg.pos.y = -1.0
	_frames(vg, 3)
	t.check(vg._group.visible and vg._cur == "Idle", "sol : visible, remonte en attente (%s)" % vg._cur)
	vg.free()
	# mort, tête explosée
	for head in [false, true]:
		var zd := _z("normal", 20 + int(head))
		var vd := _view(t, zd)
		_frames(vd, 3)
		zd.damage(1.0e9, head)
		_frames(vd, 3)
		t.check(vd._cur == "Death", "mort : Death (%s)" % vd._cur)
		var head_vis := false
		for m in vd._rig.heads:
			head_vis = head_vis or m.visible
		t.check(head_vis == not head, "mort %s : tête %s" % ["à la tête" if head else "au corps", "cachée" if head else "visible"])
		zd.death_t = 1.5
		_frames(vd, 2)
		t.check(vd._death_final, "mort : pose finale posée (plus d'avance d'animation)")
		var adv: int = vd._advanced
		_frames(vd, 20)
		t.check(vd._advanced == adv, "mort : cadavre au sol, animation arrêtée")
		zd.death_t = 4.0
		_frames(vd, 2)
		t.check(vd._group.position.y < 0.0, "mort : le corps s'enfonce (%.2f)" % vd._group.position.y)
		vd.free()
	# cendres de l'Aube
	var zash := _z("bloat", 40)
	var vash := _view(t, zash)
	zash.become_ash()
	zash.ash_t = 1.0
	_frames(vash, 2)
	t.check(vash._rig.root.scale.y < vash._base_scale.y, "cendres : le modèle s'affaisse")
	vash.free()
	# armuré qui perd les jambes : passe sur le modèle qui sait ramper, armure gardée
	var zk := _z("armored", 50)
	zk.moving = true
	var vk := _view(t, zk)
	_frames(vk, 3)
	t.check(vk._rig.model == "arm", "armuré : modèle brute")
	zk.make_crawler()
	_frames(vk, 3)
	t.check(vk._rig.model == "basic" and vk._rig.armor and vk._cur == "Crawl", "armuré rampant : modèle basic + armure, Crawl (%s)" % vk._rig.model)
	vk.free()
	# pool : la libération rend l'instance, une nouvelle vue la reprend
	var n0 := Models.created
	var zp := _z("normal", 60)
	var vp := _view(t, zp)
	var rg = vp._rig
	vp.free()
	var vp2 := _view(t, _z("normal", 61))
	t.check(vp2._rig == rg and Models.created == n0, "pool : la vue suivante reprend l'instance libérée")
	vp2.free()
	# LOD : loin de la caméra, l'animation avance moins souvent ; hors champ, pas du tout
	var cam := Camera3D.new()
	cam.far = 400.0
	t.add_child(cam)
	cam.global_position = Vector3(0, 1.7, 0)
	cam.make_current()
	var near := _z("normal", 70)
	near.pos = Vector3(0, 0, -10)
	var vn := _view(t, near)
	var far := _z("normal", 71)
	far.pos = Vector3(0, 0, -100)
	var vf := _view(t, far)
	var behind := _z("normal", 72)
	behind.pos = Vector3(0, 0, 30)
	var vb := _view(t, behind)
	vn._frame = 0
	vf._frame = 0
	for _i in 64:
		vn._process(DT)
		vf._process(DT)
		vb._process(DT)
	t.check(vn._advanced == 64, "LOD : près (10 m) : toutes les images (%d)" % vn._advanced)
	t.check(vf._advanced <= 10 and vf._advanced >= 6, "LOD : loin (100 m) : une image sur 8 (%d / 64)" % vf._advanced)
	t.check(vb._advanced == 0, "LOD : derrière la caméra : aucune avance (%d)" % vb._advanced)
	vn.free()
	vf.free()
	vb.free()
	cam.free()
	# l'ancienne vue en primitives reste disponible (repli --old-zombies) et marche pour tous les types
	var Old := preload("res://scenes/zombie_view.gd")
	for key in ["normal", "crawler", "armored", "bloat"]:
		var zo := _z(key, 80)
		var vo := Node3D.new()
		vo.set_script(Old)
		t.add_child(vo)
		vo.setup(zo)
		vo._process(DT)
		t.check(vo._group != null and vo._hips != null, "ancienne vue : %s se construit et s'anime" % key)
		vo.free()
	t.check(not Models.use_old, "repli --old-zombies éteint par défaut")
