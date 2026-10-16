extends RefCounted
## J0 : chargement de la config et golden de Pap (papStats, papAmmoMult, papPulse, falloffMult) et de la santé des zombies.

func run(t: Node) -> void:
	t.check(Config.loaded, "Config chargée")
	t.check(Config.data.has("weapons") and Config.pap_levels.size() == 4 and Config.pap_levels[0] == null, "structure de config")
	t.near(Config.color(0xff8a2a).r, 1.0, "Config.color rouge")
	var g: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j0.json"))
	t.check(typeof(g) == TYPE_DICTIONARY, "golden j0.json lisible")
	if typeof(g) != TYPE_DICTIONARY:
		return
	for e in g["pap"]:
		t.same(Pap.pap_stats(Config.weapon(e["weapon"]), int(e["lv"])), e["stats"], "papStats %s PaP%d" % [e["weapon"], e["lv"]])
	t.check(Pap.pap_stats(Config.weapon("m1911"), 0).is_empty(), "papStats niveau 0 vide")
	for e in g["ammo"]:
		t.near(Pap.pap_ammo_mult(int(e["lv"])), e["v"], "papAmmoMult %d" % e["lv"])
	for e in g["pulse"]:
		t.near(Pap.pap_pulse(int(e["lv"]), e["t"]), e["v"], "papPulse lv%d t=%s" % [e["lv"], e["t"]])
	for e in g["falloff"]:
		t.near(Pap.falloff_mult(Config.weapon(e["weapon"]), e["d"]), e["v"], "falloffMult %s d=%s" % [e["weapon"], e["d"]])
	for e in g["zombieHealth"]:
		t.near(Game.zombie_health_at(int(e["round"])), e["v"], "santé manche %d" % e["round"], 0.0)
	print("golden j0 : %d papStats, %d falloff, %d pulse, %d manches" % [g["pap"].size(), g["falloff"].size(), g["pulse"].size(), g["zombieHealth"].size()])
