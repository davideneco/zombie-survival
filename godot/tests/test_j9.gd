extends RefCounted
## J9 : graphismes. Golden calculés par le JS (data/golden/j9.json : niveaux de qualité, pickN et table de couleurs de src/graphics.js exécutés tels quels, zones,
## conditions de la passe finale et du halo, exposition, particules), puis : assets cuits par tools/bake-graphics.mjs (tailles, géométries des zombies, champ de
## distance du sol), reconnaissance des matériaux du monde cuit, GraphicsView (environnement, qualité, exposition par zone), FxView (particules, taches, plafonds
## de qualité, signaux), peau et sang des zombies, signal d'impact des armes. Le rendu lui-même (shaders compilés, captures, FPS) se vérifie sur l'écran réel.

const GfxAssets := preload("res://scenes/gfx_assets.gd")
const Surfaces := preload("res://scenes/world/surfaces.gd")
const ZombieSkin := preload("res://scenes/zombie_skin.gd")
const GraphicsView := preload("res://scenes/graphics_view.gd")
const FxView := preload("res://scenes/fx_view.gd")
const ZombieView := preload("res://scenes/zombie_view.gd")
const DT := 1.0 / 60.0

var _g: Dictionary

func run(t: Node) -> void:
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j9.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j9.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	_rules(t)
	_lut(t)
	_assets(t)
	_surfaces(t)
	_graphics_view(t)
	_fx_view(t)
	_zombie_skin(t)
	_impact(t)

# ------------------------------------------------------------------ règles pures
func _rules(t: Node) -> void:
	for e: Dictionary in _g["levels"]:
		var L := GraphicsRules.level(int(e["q"]))
		var tag := "niveau %d" % e["q"]
		t.check(L["name"] == e["name"], "%s : nom" % tag)
		for k: String in ["shadows", "softShadows", "clouds", "post"]:
			t.check(bool(L[k]) == bool(e[k]), "%s : %s" % [tag, k])
		for k: String in ["shadowSize", "facade", "particles", "decals"]:
			t.near(L[k], e[k], "%s : %s" % [tag, k])
		t.check(String(L["trees"]) == String(e["trees"]), "%s : arbres" % tag)
		t.near(GraphicsRules.pixel_ratio(int(e["q"])), e["pixelRatio"], "%s : résolution de rendu" % tag)
		t.check(GraphicsRules.decal_max(int(e["q"])) == int(e["decalMax"]), "%s : taches gardées" % tag)
	t.check(GraphicsRules.level(-3)["name"] == "Rapide" and GraphicsRules.level(9)["name"] == "Haute", "niveau borné comme applyQuality")
	for c: Dictionary in _g["pick"]:
		t.near(GraphicsRules.pick_n(c["arr"], float(c["k"])), c["v"], "pickN %s k=%s" % [c["arr"], c["k"]], 1e-9)
	for c: Dictionary in _g["zones"]["steps"]:
		t.near(GraphicsRules.zone_blend(float(c["dt"])), c["k"], "pas de zone dt=%s" % c["dt"], 1e-9)
	t.near(float(Config.at("graphics.zoneBlend")), _g["zones"]["blend"], "zoneBlend")
	for name: String in _g["zones"]["names"]:
		var Z := GraphicsRules.zone(name)
		t.check(Z == Config.at("graphics.zones")[name], "zone %s" % name)
	t.check(GraphicsRules.zone("Marché-Neuf") == Config.at("graphics.zones.default"), "zone inconnue : réglages par défaut")
	for c: Dictionary in _g["post"]:
		var tag := "passe finale q=%d cinéma=%s halo=%s %dx%d" % [c["q"], c["cinema"], c["halo"], c["w"], c["h"]]
		t.check(GraphicsRules.want_post(int(c["q"]), bool(c["cinema"]), int(c["w"]), int(c["h"])) == bool(c["post"]), tag)
		t.check(GraphicsRules.want_halo(int(c["q"]), bool(c["cinema"]), bool(c["halo"]), int(c["w"]), int(c["h"])) == bool(c["wantHalo"]), "halo : " + tag)
		t.check(GraphicsRules.msaa_samples(int(c["w"]), int(c["h"])) == int(c["samples"]), "échantillons : " + tag)
	for c: Dictionary in _g["exposure"]:
		var k := float(c["k"])
		var Z := GraphicsRules.zone(String(c["zone"]))
		t.near(GraphicsRules.exposure(float(c["brightness"]), float(Z["exposure"])), c["exposure"], "exposition %s b=%s" % [c["zone"], c["brightness"]], 1e-9)
		t.near(GraphicsRules.env_intensity(k, float(Z["env"])), c["env"], "reflets %s k=%s" % [c["zone"], c["k"]], 1e-9)
	for c: Dictionary in _g["haloDawn"]:
		t.near(GraphicsRules.halo_dawn_gain(float(c["k"])), c["v"], "halo à l'aube k=%s" % c["k"], 1e-9)
	for c: Dictionary in _g["emit"]:
		t.check(GraphicsRules.emit_count(int(c["count"]), float(c["partK"])) == int(c["n"]), "émission %d x %s" % [c["count"], c["partK"]])

func _lut(t: Node) -> void:
	var bytes := GraphicsRules.lut_bytes()
	t.check(bytes.size() == 32 * 32 * 32 * 4, "table de couleurs : 32^3 entrées RVBA")
	var sum := 0
	for b in bytes:
		sum += b
	t.check(sum == int(_g["lut"]["sum"]), "table de couleurs : somme des octets %d (JS %d)" % [sum, int(_g["lut"]["sum"])])
	for c: Dictionary in _g["lut"]["samples"]:
		var o := ((int(c["g"]) * 1024) + int(c["b"]) * 32 + int(c["r"])) * 4
		var rgb: Array = c["rgb"]
		# arrondi : Math.round (JS) = roundi (Godot) sauf sur .5 négatif : aucun ici ; tolérance d'un cran pour l'accumulation en double précision
		t.check(absi(bytes[o] - int(rgb[0])) <= 1 and absi(bytes[o + 1] - int(rgb[1])) <= 1 and absi(bytes[o + 2] - int(rgb[2])) <= 1, "table (%d,%d,%d) = %s" % [c["r"], c["g"], c["b"], rgb])
	var tex := GraphicsRules.lut_texture()
	t.check(tex.get_width() == 32 and tex.get_height() == 32 and tex.get_depth() == 32, "table en Texture3D 32^3")
	var o := ((31 * 1024) + 31 * 32 + 31) * 4
	t.check(bytes[o] > 240 and bytes[o + 1] > 240 and bytes[o + 2] > 235, "coin blanc de la table : %d %d %d" % [bytes[o], bytes[o + 1], bytes[o + 2]])

# ------------------------------------------------------------------ assets cuits
func _assets(t: Node) -> void:
	t.check(GfxAssets.available(), "assets cuits présents (node tools/bake-graphics.mjs)")
	if not GfxAssets.available():
		return
	var sizes := {"zombie_flesh.png": Vector2i(1024, 768), "zombie_cloth.png": Vector2i(1024, 768), "zombie_blood.png": Vector2i(256, 256), "fx_atlas.png": Vector2i(512, 256),
		"fx_splat.png": Vector2i(256, 256), "ground_noise.png": Vector2i(256, 256), "arch_detail.png": Vector2i(256, 256)}
	for f: String in sizes:
		var tex := GfxAssets.texture(f)
		t.check(tex != null and Vector2i(tex.get_width(), tex.get_height()) == sizes[f], "%s : %s" % [f, sizes[f]])
	var meta := GfxAssets.meta()
	var sdf := GfxAssets.texture("ground_sdf.png", false)
	t.check(sdf != null and sdf.get_width() == int(meta["sdf_nx"]) and sdf.get_height() == int(meta["sdf_nz"]), "champ de distance : taille du manifeste")
	t.check(float(meta["sdf_size"][0]) == float(meta["sdf_nx"]) * float(meta["cell"]) and float(Config.at("graphics.ground.cell")) == float(meta["cell"]), "champ de distance : 1 pixel = CONFIG.graphics.ground.cell")
	var img := sdf.get_image()
	# bord d'un bâtiment : valeur 0 m = (0 + 3) / 16 x 255 = 48 ; hors d'un bâtiment (loin des façades) : 255 ; le champ contient les deux
	var lo := 255
	var hi := 0
	for i in 200:
		var v := int(img.get_pixel((i * 7919) % img.get_width(), (i * 104729) % img.get_height()).r8)
		lo = mini(lo, v)
		hi = maxi(hi, v)
	t.check(lo < 60 and hi > 200, "champ de distance : plage des valeurs (%d..%d)" % [lo, hi])
	# géométries des zombies : triangles complets, sommets dans la boîte d'un zombie
	for part: String in ["torso", "pelvis", "head", "jaw", "eye", "thigh", "shinFoot", "upperArm", "foreHand"]:
		var mesh := GfxAssets.zombie_mesh(part)
		t.check(mesh != null, "géométrie cuite : %s" % part)
		if mesh == null:
			continue
		var arr := mesh.surface_get_arrays(0)
		var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		t.check(verts.size() > 0 and verts.size() % 3 == 0, "%s : %d sommets, triangles entiers" % [part, verts.size()])
		var bb := mesh.get_aabb()
		t.check(bb.size.x < 0.6 and bb.size.y < 0.9 and bb.size.z < 0.6, "%s : boîte plausible %s" % [part, bb.size])
		var uvs: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
		var ok := true
		for u in uvs:
			if u.x < -0.01 or u.x > 1.01 or u.y < -0.01 or u.y > 1.01:
				ok = false
		t.check(ok, "%s : UV dans la cellule" % part)
	# tête : triangles dans le sens horaire vu de l'extérieur (normale de la surface inverse du sens trigonométrique) : normale géométrique opposée à celle stockée
	var head := GfxAssets.zombie_mesh("head").surface_get_arrays(0)
	var hv: PackedVector3Array = head[Mesh.ARRAY_VERTEX]
	var hn: PackedVector3Array = head[Mesh.ARRAY_NORMAL]
	var agree := 0
	var total := 0
	for i in range(0, hv.size(), 3):
		var geo := (hv[i + 2] - hv[i]).cross(hv[i + 1] - hv[i])   # Godot : sens horaire = face avant, normale = (v2 - v0) x (v1 - v0)
		if geo.length() < 1e-9:
			continue
		total += 1
		if geo.dot(hn[i]) > 0.0:
			agree += 1
	t.check(total > 100 and float(agree) / total > 0.97, "tête : sens horaire (face avant de Godot) cohérent avec les normales (%d/%d)" % [agree, total])
	# lumières cuites : le JS en allume 8 parmi elles
	var L: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/graphics/lights.json"))
	t.check(L["lights"].size() > 300, "sources de lumière cuites : %d" % L["lights"].size())
	var lamps := 0
	for l: Array in L["lights"]:
		t.check(l.size() == 6 and float(l[4]) > 0.0 and float(l[5]) > 0.0, "source de lumière complète")
		if float(l[4]) == 60.0 and int(l[3]) == 0xffc77a:
			lamps += 1
	t.check(lamps > 40, "lampadaires (60, 0xffc77a) : %d" % lamps)

# ------------------------------------------------------------------ matériaux du monde cuit
func _surfaces(t: Node) -> void:
	var files: Array = []
	for tx: Dictionary in JSON.parse_string(FileAccess.get_file_as_string("res://data/world/textures.json")):
		files.append(String(tx["file"]))
	var count := {"": 0, "ground": 0, "water": 0, "facade": 0, "foliage": 0}
	var mats: Array = JSON.parse_string(FileAccess.get_file_as_string("res://data/world/materials.json"))
	for i in mats.size():
		count[Surfaces.kind(mats[i], files)] += 1
	t.check(count["ground"] == 1, "un seul matériau de sol (%d)" % count["ground"])
	t.check(count["water"] == 1, "un seul matériau d'eau (%d)" % count["water"])
	t.check(count["facade"] == 20, "20 matériaux de façade (%d)" % count["facade"])
	t.check(count["foliage"] >= 1, "feuillage (%d)" % count["foliage"])
	var tex := func(_i: int) -> Texture2D: return null
	for i in mats.size():
		var k := Surfaces.kind(mats[i], files)
		if k == "":
			continue
		var sm := Surfaces.make(k, mats[i], tex)
		t.check(sm.shader != null, "ShaderMaterial %s" % k)
		if k == "ground":
			var P: Dictionary = Config.at("graphics.ground.puddle")
			var pv: Vector4 = sm.get_shader_parameter("puddle")
			t.near(pv.x, P["from"], "sol : seuil bas des flaques")
			t.near(pv.z, P["reflect"], "sol : gain des reflets")
			t.near(float(sm.get_shader_parameter("apron_total")), float(Config.at("graphics.ground.apron")) + float(Config.at("graphics.ground.kerb")) + float(Config.at("graphics.ground.gutter")), "sol : largeur du trottoir")
			t.near((sm.get_shader_parameter("sdf_origin") as Vector2).x, GfxAssets.meta()["sdf_origin"][0], "sol : origine du champ de distance")
		elif k == "foliage":
			t.near(float(sm.get_shader_parameter("sway")), Config.at("graphics.trees.sway"), "feuillage : amplitude du vent")
			t.near(float(sm.get_shader_parameter("alpha_cut")), 0.46, "feuillage : seuil alpha")

# ------------------------------------------------------------------ GraphicsView
func _graphics_view(t: Node) -> void:
	var s := Game.settings
	var old_auto := s.autosave
	s.autosave = false
	var old := {"quality": s.get_value("quality"), "cinema": s.get_value("cinema"), "halo": s.get_value("halo"), "brightness": s.get_value("brightness")}
	var gv: Node = GraphicsView.new()
	var gcam := Camera3D.new()
	t.add_child(gcam)
	t.add_child(gv)
	gv.setup(gcam, false)
	var env: Environment = gv.env
	var vp: Viewport = gv.get_viewport()
	# Rapide
	s.set_value("cinema", true)
	s.set_value("halo", true)
	s.set_value("quality", 0)
	t.near(vp.scaling_3d_scale, 0.75, "Rapide : résolution de rendu 0,75")
	t.check(vp.msaa_3d == Viewport.MSAA_DISABLED, "Rapide : sans MSAA")
	t.check(not gv.moon.shadow_enabled, "Rapide : sans ombres de la lune")
	t.check(not env.glow_enabled and not env.adjustment_enabled, "Rapide : sans halo ni table de couleurs")
	t.near(float(gv.sky_mat.get_shader_parameter("cloud_cover")), 0.0, "Rapide : sans nuages")
	t.check(gv._cinema_layer.visible, "effets cinéma : vignette et grain (tous niveaux)")
	# Normale
	s.set_value("quality", 1)
	t.near(vp.scaling_3d_scale, 1.0, "Normale : résolution 1")
	t.check(gv.moon.shadow_enabled, "Normale : ombres de la lune")
	t.check(not env.glow_enabled and not env.adjustment_enabled, "Normale : sans halo ni table de couleurs")
	t.near(float(gv.sky_mat.get_shader_parameter("cloud_cover")), float(Config.at("graphics.sky.cloudCover")), "Normale : nuages")
	# Haute
	s.set_value("quality", 2)
	t.check(vp.msaa_3d == Viewport.MSAA_4X, "Haute : MSAA 4x")
	t.check(gv.moon.shadow_enabled and env.adjustment_enabled and env.adjustment_color_correction != null, "Haute : ombres et table de couleurs")
	t.check(env.glow_enabled, "Haute : halo")
	s.set_value("halo", false)
	t.check(not env.glow_enabled and env.adjustment_enabled, "Haute, halo décoché : pas de halo, table gardée")
	s.set_value("halo", true)
	s.set_value("cinema", false)
	t.check(not env.glow_enabled and not env.adjustment_enabled and not gv._cinema_layer.visible, "Haute sans effets cinéma : ni halo, ni table, ni vignette")
	s.set_value("cinema", true)
	# réglages fixes de main.js / graphics.js
	t.check(env.tonemap_mode == Environment.TONE_MAPPER_ACES, "tone mapping ACES (CONFIG.graphics.tone.type)")
	t.check(String(Config.at("graphics.tone.type")) == "aces", "CONFIG : ACES")
	t.near(env.fog_depth_end, 1.65 / GraphicsView.FOG_DENSITY, "brouillard : fin de profondeur = 1,65 / densité (0,019)")
	t.near(gv.moon.light_energy, 1.4 / PI, "lune : 1,4 / pi")
	# exposition : base x luminosité x zone
	for b in [0.6, 1.4, 3.0]:
		s.set_value("brightness", b)
		t.near(env.tonemap_exposure, float(Config.at("graphics.tone.exposure")) * b * GraphicsView.TONE_K, "exposition à la luminosité %s" % b, 1e-6)
		t.near(float(gv.sky_mat.get_shader_parameter("ambient_scale")), GraphicsView.HEMI_INTENSITY * b / PI, "ambiance (hémisphère) à la luminosité %s" % b, 1e-9)
	# exposition par zone : la nef garde sa pénombre (lissée)
	Game.new_game(5, "strasbourg", [])
	var zi: int = Game.world.zone_names.find("Intérieur de la Cathédrale")
	t.check(zi >= 0, "zone « Intérieur de la Cathédrale » connue")
	var c: Vector3 = Vector3(179.375, 0.0, 39.625)
	Game.player.pos = c
	s.set_value("brightness", 1.4)
	t.check(Game.world.zone_of(c.x, c.z) == zi, "le point de la nef est dans la zone de la nef")
	for _i in 40:
		gv._process(0.1)
	t.check(gv.zone_name == "Intérieur de la Cathédrale", "zone suivie : %s" % gv.zone_name)
	t.near(gv.zone_k["exposure"], 0.92, "exposition de la nef (0,92)", 1e-3)
	t.near(env.tonemap_exposure, 1.3 * 1.4 * 0.92, "exposition de la nef x luminosité", 1e-3)
	Game.player.pos = Vector3(-0.625, 0.0, -30.875)
	for _i in 40:
		gv._process(0.1)
	t.near(gv.zone_k["exposure"], 1.0, "retour à la place : exposition 1", 1e-3)
	# lampe torche (player.js : SpotLight(couleur, 9, 40, 0,5, 0,9, 1,1))
	var T: Dictionary = Config.at("graphics.torch")
	var torch: SpotLight3D = gv.torch
	t.check(torch.get_parent() == gcam, "torche accrochée à la caméra")
	t.near(torch.spot_range, T["distance"], "torche : portée 40 m")
	t.near(torch.spot_angle, rad_to_deg(float(T["angle"])), "torche : demi-ouverture 0,5 rad")
	t.near(torch.spot_attenuation, T["decay"], "torche : décroissance 1,1")
	t.near(torch.light_energy, float(T["intensity"]) / PI, "torche : intensité 9 / pi", 1e-6)
	t.check(torch.light_color.is_equal_approx(Config.color(int(T["color"]))), "torche : teinte chaude")
	gv.set_torch(false)
	t.near(torch.light_energy, 0.0, "torche éteinte")
	gv.set_torch(true)
	t.near(torch.light_energy, float(T["intensity"]) / PI, "torche rallumée", 1e-6)
	gv.queue_free()
	gcam.queue_free()
	for k: String in old:
		s.set_value(k, old[k])
	s.autosave = old_auto

# ------------------------------------------------------------------ FxView
func _fx_view(t: Node) -> void:
	var s := Game.settings
	var old_auto := s.autosave
	s.autosave = false
	var old_q: Variant = s.get_value("quality")
	var cam := Camera3D.new()
	var fx: Node3D = FxView.new()
	t.add_child(cam)
	t.add_child(fx)
	fx.setup(cam)
	for q in [2, 0]:
		s.set_value("quality", q)
		var k := float(GraphicsRules.level(q)["particles"])
		var before: int = fx.emitted
		fx.blood(Vector3(1, 1, 1), true)
		var want := GraphicsRules.emit_count(22, k) + GraphicsRules.emit_count(4, k)
		t.check(fx.emitted - before == want, "sang abondant à la qualité %d : %d particules (attendu %d)" % [q, fx.emitted - before, want])
		before = fx.emitted
		fx.dust(Vector3(0, 1, 0))
		t.check(fx.emitted - before == GraphicsRules.emit_count(4, k) + GraphicsRules.emit_count(3, k), "poussière à la qualité %d" % q)
		t.check(fx.decal_max == GraphicsRules.decal_max(q), "taches gardées à la qualité %d : %d" % [q, fx.decal_max])
	s.set_value("quality", 2)
	# plafond de la réserve : 1000 particules demandées, jamais plus de N vivantes
	for _i in 60:
		fx.blood(Vector3(0, 1, 0), true)
	var live := 0
	for p: Dictionary in fx._pools[0]["parts"]:
		if float(p["life"]) > 0.0:
			live += 1
	t.check(live <= FxView.N and live == int(fx._pools[0]["active"]), "réserve éclairée : %d vivantes <= %d, compteur cohérent" % [live, FxView.N])
	# vie et mort : au bout de 3 s plus aucune particule
	for _i in 200:
		fx._process(0.05)
	t.check(int(fx._pools[0]["active"]) == 0 and int(fx._pools[1]["active"]) == 0, "toutes les particules ont fini (10 s)")
	# gravité et rebond : une goutte lancée vers le haut retombe et reste au sol (y >= 0,03)
	fx.emit(Vector3(0, 0.5, 0), {"count": 1, "color": Color.RED, "speed": 0.0, "up": 5.0, "size": 0.05, "life": 3.0})
	var p0: Dictionary = fx._pools[0]["parts"][(int(fx._pools[0]["cursor"]) - 1 + FxView.N) % FxView.N]
	var ymax := 0.0
	for _i in 100:
		fx._process(0.03)
		ymax = maxf(ymax, float(p0["y"]))
	t.check(ymax > 0.6 and float(p0["y"]) >= 0.03 - 1e-6, "goutte : monte (%.2f m) puis reste au sol" % ymax)
	# taches : plafond de la qualité, une même case n'est pas réutilisée avant d'avoir fait le tour
	s.set_value("quality", 0)
	for i in 100:
		fx.decal(float(i), 0.0)
	var alive := 0
	for d: Dictionary in fx._decals:
		if float(d["life"]) > 0.0:
			alive += 1
	t.check(alive == 16, "Rapide : 16 taches au plus (%d)" % alive)
	s.set_value("quality", 2)
	t.check(true, "retour à la qualité Haute")
	for i in 100:
		fx.decal(float(i), 1.0)
	alive = 0
	for d: Dictionary in fx._decals:
		if float(d["life"]) > 0.0:
			alive += 1
	t.check(alive <= 64 and alive > 16, "Haute : jusqu'à 64 taches (%d)" % alive)
	fx.wall_decal(Vector3(1, 1, 1), 1.0, 0.0)
	fx.clear()
	alive = 0
	for d: Dictionary in fx._decals:
		if float(d["life"]) > 0.0:
			alive += 1
	t.check(alive == 0, "clear : plus de tache")
	# signaux de Game
	var e0: int = fx.emitted
	Game.impact.emit(Vector3(0, 1, 0), false, false)
	t.check(fx.emitted > e0, "signal impact (mur) : de la poussière")
	e0 = fx.emitted
	Game.impact.emit(Vector3(0, 1, 0), true, true)
	t.check(fx.emitted - e0 >= 26, "signal impact (chair, mortel) : du sang")
	e0 = fx.emitted
	Game.explosion.emit(Vector3(3, 0, 3), 5.0, 0xff8a2a)
	t.check(fx.emitted - e0 >= 56 and fx._boom_t > 0.0, "explosion : fumée, débris, étincelles et éclair (%d)" % (fx.emitted - e0))
	t.near(fx._boom_energy, 140.0 / PI, "éclair : 140 / pi (PointLight(…, 140, 18, 2) du JS)")
	var z := ZombieSim.new()
	z.spawn_center = Vector3(0, 1, 0)
	z.spawn_normal = Vector2(0, 1)
	z.spawn_pos = Vector3(2, 0, 2)
	e0 = fx.emitted
	Game.zombie_event.emit(z, "glass")
	t.check(fx.emitted - e0 == 36, "vitre brisée : 36 éclats")
	e0 = fx.emitted
	Game.zombie_event.emit(z, "emerge")
	t.check(fx.emitted - e0 == 26, "sortie de terre : 26 mottes")
	e0 = fx.emitted
	Game.zombie_killed.emit(z, true)
	t.check(fx.emitted - e0 >= 26, "tête explosée : sang abondant")
	fx.queue_free()
	cam.queue_free()
	s.set_value("quality", old_q)
	s.autosave = old_auto

# ------------------------------------------------------------------ peau des zombies
func _zombie_skin(t: Node) -> void:
	# cellVec de zombieSkin.js
	t.check(ZombieSkin.cell_vec(0) == Vector4(0.0, 1.0 - 1.0 / 3.0, 0.25, 1.0 / 3.0), "cellule 0 : coin haut gauche")
	t.near(ZombieSkin.cell_vec(5).x, 0.25, "cellule 5 : colonne 1")
	t.near(ZombieSkin.cell_vec(5).y, 1.0 - 2.0 / 3.0, "cellule 5 : rangée 1")
	t.near(ZombieSkin.cell_vec(11).x, 0.75, "cellule 11 : colonne 3")
	t.near(ZombieSkin.cell_vec(11).y, 0.0, "cellule 11 : rangée du bas")
	t.check(ZombieSkin.FACE == [0, 1, 2, 3] and ZombieSkin.SKIN == [4, 5, 6, 7] and ZombieSkin.PLAGUE_SKIN == 9 and ZombieSkin.BURLAP == 11, "CELLS de zombieSkin.js")
	# un zombie à la peau cuite, sang initial 0,04 + 0,2 x hash(9), +0,16 au visage pour un tir à la tête, etc.
	Game.new_game(8, "arena", [])
	var z := ZombieSim.new()
	z.id = 4242
	z.pos = Vector3(3, 0, 3)
	z.health = 100.0
	z.max_health = 100.0
	z.rng = Game.rng
	var v := Node3D.new()
	v.set_script(ZombieView)
	t.add_child(v)
	v.setup(z)
	t.check(v._baked, "zombie : géométries et atlas cuits utilisés")
	t.check(v._skin_mats.size() == 4 and v._skin_mats[0] is ShaderMaterial, "zombie : quatre matériaux de peau (visage, peau, haut, pantalon)")
	var blood0 := 0.04 + 0.2 * ZombieSim.hash_id(z.id, 9)
	t.near(float(v._skin_mats[0].get_shader_parameter("blood")), blood0, "sang d'origine : 0,04 + 0,2 x hash(9)", 1e-9)
	t.near(float(v._skin_mats[3].get_shader_parameter("blood")), blood0 * 0.6, "pantalon : 60 % du sang d'origine", 1e-9)
	var tone := int(floor(ZombieSim.hash_id(z.id, 1) * 4.0)) % 4
	t.check((v._skin_mats[0].get_shader_parameter("cell") as Vector4) == ZombieSkin.cell_vec(ZombieSkin.FACE[tone]), "visage : cellule %d" % ZombieSkin.FACE[tone])
	t.check((v._skin_mats[1].get_shader_parameter("cell") as Vector4) == ZombieSkin.cell_vec(ZombieSkin.SKIN[tone]), "peau : même teinte que le visage")
	var shirt := int(floor(ZombieSim.hash_id(z.id, 3) * 6.0)) % 6
	t.check((v._skin_mats[2].get_shader_parameter("cell") as Vector4) == ZombieSkin.cell_vec(ZombieSkin.SHIRT[shirt]), "haut : cellule %d" % shirt)
	# teinte : THREE.Color.setHSL(0,2 + 0,12 h5, 0,04 + 0,1 h6, 0,8 + 0,18 h7) (linéaire)
	var tint: Color = v._skin_mats[1].get_shader_parameter("tint")
	var hh := 0.2 + 0.12 * ZombieSim.hash_id(z.id, 5)
	var ss := 0.04 + 0.1 * ZombieSim.hash_id(z.id, 6)
	var ll := 0.8 + 0.18 * ZombieSim.hash_id(z.id, 7)
	var ref := _hsl(hh, ss, ll)
	t.check(absf(tint.r - ref.r) < 1e-4 and absf(tint.g - ref.g) < 1e-4 and absf(tint.b - ref.b) < 1e-4, "teinte de la peau : setHSL(%.3f, %.3f, %.3f)" % [hh, ss, ll])
	# le sang gagne du terrain à chaque touche (zombie.js _bleed)
	var face0 := float(v._skin_mats[0].get_shader_parameter("blood"))
	var shirt0 := float(v._skin_mats[2].get_shader_parameter("blood"))
	z.damage(1.0, true)
	v._process(DT)
	t.near(float(v._skin_mats[0].get_shader_parameter("blood")), face0 + 0.16, "tir à la tête : +0,16 au visage", 1e-9)
	t.near(float(v._skin_mats[2].get_shader_parameter("blood")), shirt0, "tir à la tête : le haut ne change pas", 1e-9)
	z.damage(1.0, false)
	z.damage(1.0, false)
	v._process(DT)
	t.near(float(v._skin_mats[2].get_shader_parameter("blood")), shirt0 + 0.18, "deux tirs au corps : +0,09 x 2 au haut", 1e-9)
	for _i in 30:
		z.damage(0.01, false)
	v._process(DT)
	t.check(float(v._skin_mats[0].get_shader_parameter("blood")) <= 1.0 and float(v._skin_mats[2].get_shader_parameter("blood")) <= 1.0, "sang borné à 1")
	t.check(v._blob != null and v._blob.mesh is QuadMesh, "ombre de contact sous le zombie")
	# pestiféré : peau, visage et toile de la peste
	var zb := ZombieSim.new()
	zb.id = 17
	zb.kind = "bloat"
	zb.rng = Game.rng
	var vb := Node3D.new()
	vb.set_script(ZombieView)
	t.add_child(vb)
	vb.setup(zb)
	t.check((vb._skin_mats[1].get_shader_parameter("cell") as Vector4) == ZombieSkin.cell_vec(ZombieSkin.PLAGUE_SKIN), "pestiféré : peau de la peste")
	t.check((vb._skin_mats[2].get_shader_parameter("cell") as Vector4) == ZombieSkin.cell_vec(ZombieSkin.BURLAP), "pestiféré : toile")
	t.check((vb._skin_mats[1].get_shader_parameter("tint") as Color).is_equal_approx(Color(0.78, 0.95, 0.5)), "pestiféré : teinte (0,78 ; 0,95 ; 0,5)")
	v.queue_free()
	vb.queue_free()

static func _hsl(h: float, s: float, l: float) -> Color:
	return ZombieView._hsl(h, s, l)

# ------------------------------------------------------------------ signal d'impact des armes
func _impact(t: Node) -> void:
	Game.new_game(120, "arena", ["m1911"])
	Game.player.pos = Vector3(25, 0, 26)
	Game.zombies.clear()
	Game.arms = WeaponArms.new(["rifle"])
	Game.arms.current.cfg["spread"] = 0.0
	Game.arms.current.ammo = 30
	Game.player.yaw = 0.0
	Game.player.pitch = 0.0
	var log: Array = []
	var cb := func(pos: Vector3, flesh: bool, big: bool) -> void: log.append([pos, flesh, big])
	Game.impact.connect(cb)
	for _i in 8:   # dans le vide ou un mur : poussière
		Game.time += DT
		Game.arms.step(Game, DT, {"fire": true})
	t.check(log.size() >= 1 and not bool(log[0][1]), "tir sans cible : impact de mur (poussière), %d" % log.size())
	log.clear()
	# un zombie en face : impact de chair ; mortel au corps => big
	var z := ZombieSim.new()
	z.pos = Game.player.pos + Vector3(0, 0, -6)
	z.health = 1.0
	z.max_health = 1.0
	z.speed = 0.0
	z.rng = Game.rng
	Game.zombies.append(z)
	Game.player.pitch = atan2(0.9 - Game.player.eye().y, 6.0)   # vers le torse
	Game.arms.current.ammo = 30
	for _i in 30:
		Game.time += DT
		Game.arms.step(Game, DT, {"fire": true})
		if z.dead:
			break
	t.check(z.dead, "zombie abattu")
	var flesh := false
	var big := false
	for e in log:
		if bool(e[1]):
			flesh = true
			big = big or bool(e[2])
	t.check(flesh, "impact de chair signalé")
	t.check(big or z.headless, "coup mortel au corps : sang abondant (ou tête)")
	Game.impact.disconnect(cb)
