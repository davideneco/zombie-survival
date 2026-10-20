extends RefCounted
## v0.19.1 : option « Mise à l'échelle » (Settings, GraphicsRules) : modes natif / FSR 1.0 / FSR 2.2, résolutions 100 / 85 / 75 / 67 / 50 %, netteté, préréglages par qualité.

func run(t: Node) -> void:
	_scaling(t)

# ---------------------------------------------------------------- mise à l'échelle
func _scaling(t: Node) -> void:
	var path := "user://settings_j22.cfg"
	var s := Settings.new(path)
	s.autosave = false
	t.check(Settings.RES_SCALES == [1.0, 0.85, 0.75, 0.67, 0.5], "échelles : 100 / 85 / 75 / 67 / 50 %")
	t.check(Settings.UPSCALER_NAMES.size() == 3, "trois modes : natif, FSR 1.0, FSR 2.2")
	for q in 3:
		var pre := GraphicsRules.upscale_preset(q)
		t.check(int(pre["upscaler"]) in [0, 1, 2] and int(pre["res_scale"]) >= 0 and int(pre["res_scale"]) < Settings.RES_SCALES.size(), "préréglage qualité %d valide" % q)
	t.check(GraphicsRules.upscale_preset(0) == {"upscaler": 1, "res_scale": 2}, "Rapide : FSR 1.0 à 75 %")
	t.check(GraphicsRules.upscale_preset(1) == {"upscaler": 0, "res_scale": 0}, "Normale : natif à 100 %")
	t.check(GraphicsRules.upscale_preset(2) == {"upscaler": 0, "res_scale": 0}, "Haute : natif à 100 %")
	t.check(GraphicsRules.scaling_mode(0) == Viewport.SCALING_3D_MODE_BILINEAR and GraphicsRules.scaling_mode(1) == Viewport.SCALING_3D_MODE_FSR and GraphicsRules.scaling_mode(2) == Viewport.SCALING_3D_MODE_FSR2, "modes du moteur")
	t.check(GraphicsRules.scaling_mode(9) == Viewport.SCALING_3D_MODE_FSR2 and GraphicsRules.scaling_mode(-3) == Viewport.SCALING_3D_MODE_BILINEAR, "mode borné")
	t.near(GraphicsRules.fsr_sharpness(0.9), 0.2, "netteté 90 % = défaut du moteur (0,2)")
	t.near(GraphicsRules.fsr_sharpness(1.0), 0.0, "netteté max = 0")
	t.near(GraphicsRules.fsr_sharpness(0.0), 2.0, "netteté min = 2")
	t.check(GraphicsRules.mipmap_bias(1.0, 1) == 0.0 and GraphicsRules.mipmap_bias(0.5, 0) == 0.0 and GraphicsRules.mipmap_bias(0.5, 1) < -0.99, "biais de mipmap : seulement sous 100 % avec FSR")
	# réglages : bornes, arrondis, préréglage au changement de qualité, relecture
	s.set_value("res_scale", 9)
	t.check(int(s.get_value("res_scale")) == 4, "res_scale borné à 4")
	s.set_value("upscaler", 1.4)
	t.check(int(s.get_value("upscaler")) == 1 and typeof(s.get_value("upscaler")) == TYPE_INT or typeof(s.get_value("upscaler")) == TYPE_FLOAT, "upscaler arrondi")
	var seen := []
	s.changed.connect(func(k: String) -> void: seen.append(k))
	s.set_value("quality", 0)
	t.check(int(s.get_value("upscaler")) == 1 and int(s.get_value("res_scale")) == 2 and "res_scale" in seen, "qualité Rapide : préréglage appliqué et signalé")
	s.set_value("quality", 2)
	t.check(int(s.get_value("upscaler")) == 0 and int(s.get_value("res_scale")) == 0, "qualité Haute : natif 100 %")
	s.set_value("sharp", 5.0)
	t.near(s.get_value("sharp"), 1.0, "netteté bornée à 1")
	for key in ["upscaler", "res_scale", "sharp"]:
		var txt := Settings.format(key, float(s.get_value(key)))
		t.check(txt != "" and txt != str(s.get_value(key)) or key == "sharp", "libellé de %s : %s" % [key, txt])
	s.autosave = true
	s.set_value("res_scale", 3)
	s.set_value("upscaler", 2)
	var s2 := Settings.new(path)
	t.check(int(s2.get_value("res_scale")) == 3 and int(s2.get_value("upscaler")) == 1, "mise à l'échelle sauvegardée et relue ; FSR 2.2 (temporel, flou en rotation) n'est jamais relu : repasse en FSR 1.0")
	s.set_value("res_scale", 0)
	s.set_value("upscaler", 2)
	t.check(int(Settings.new(path).get_value("upscaler")) == 0, "FSR 2.2 à 100 % relu en natif")
	s.set_value("aa", 3)
	s.set_value("aniso", 3)
	var s2b := Settings.new(path)
	t.check(int(s2b.get_value("aa")) == 3 and int(s2b.get_value("aniso")) == 3 and Settings.format("aa", 4) == "FXAA" and Settings.format("aniso", 2) == "x4", "anticrénelage et filtrage sauvegardés, libellés")
	t.check(GraphicsRules.msaa_mode(1, 0, 0) == Viewport.MSAA_2X and GraphicsRules.msaa_mode(2, 0, 0) == Viewport.MSAA_4X and GraphicsRules.msaa_mode(0, 0, 0) == Viewport.MSAA_DISABLED and GraphicsRules.msaa_mode(1, 1, 0) == Viewport.MSAA_DISABLED and GraphicsRules.msaa_mode(1, 3, 0) == Viewport.MSAA_4X and GraphicsRules.msaa_mode(1, 3, 2) == Viewport.MSAA_DISABLED, "MSAA : auto par qualité, forcé, coupé avec FSR 2.2")
	t.near(GraphicsRules.fov_for_aspect(80.0, 16.0 / 9.0), 80.0, "champ de vision inchangé en 16:9")
	t.near(GraphicsRules.fov_for_aspect(80.0, 4.0 / 3.0), 80.0, "champ de vision inchangé en 4:3")
	var hf := func(v: float, a: float) -> float: return rad_to_deg(2.0 * atan(tan(deg_to_rad(v) * 0.5) * a))
	t.near(hf.call(GraphicsRules.fov_for_aspect(80.0, 3440.0 / 1440.0), 3440.0 / 1440.0), hf.call(80.0, 16.0 / 9.0), "21:9 : le champ horizontal ne dépasse pas celui du 16:9", 1e-4)
	t.check(GraphicsRules.fov_for_aspect(80.0, 3440.0 / 1440.0) < 80.0 and GraphicsRules.fov_for_aspect(80.0, 32.0 / 9.0) < GraphicsRules.fov_for_aspect(80.0, 21.0 / 9.0), "champ vertical réduit, d'autant plus que l'écran est large")
	# réglages d'avant v0.19.1 : pas de clé « upscaler » -> préréglage de la qualité enregistrée
	var cf := ConfigFile.new()
	cf.set_value("settings", "quality", 0)
	cf.save(path)
	var s3 := Settings.new(path)
	t.check(int(s3.get_value("upscaler")) == 1 and int(s3.get_value("res_scale")) == 2, "ancien fichier en Rapide : FSR 1.0 75 %")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	# vue : l'application règle bien le viewport (HUD non concerné : c'est un CanvasLayer, hors 3D)
	var vp := SubViewport.new()
	t.add_child(vp)
	vp.scaling_3d_mode = GraphicsRules.scaling_mode(2)
	vp.scaling_3d_scale = float(Settings.RES_SCALES[3])
	vp.fsr_sharpness = GraphicsRules.fsr_sharpness(0.5)
	t.check(vp.scaling_3d_mode == Viewport.SCALING_3D_MODE_FSR2 and is_equal_approx(vp.scaling_3d_scale, 0.67) and is_equal_approx(vp.fsr_sharpness, 1.0), "viewport : mode, échelle et netteté appliqués")
	vp.queue_free()

