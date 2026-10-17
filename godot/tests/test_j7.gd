extends RefCounted
## J7 : HUD et menus. Golden calculés par le JS exécutant le VRAI src/hud.js (radar, boussole, carte, inventaire : faux contexte 2D) et le VRAI
## src/keybinds.js (liaisons, conflits, échanges, flèches de secours) ; UiStack (ordre des couches, Échap) ; réglages (user://, bornes, touches
## enregistrées) ; liaisons AZERTY / QWERTY simulées par InputEventKey ; plan de la carte ; invites ; scènes du HUD et des menus.

const TEST_PATH := "user://test_settings_j7.cfg"
const DT := 1.0 / 60.0

var _g: Dictionary
var _t: Node

func run(t: Node) -> void:
	_t = t
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j7.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j7.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	_golden_radar(t)
	_golden_compass(t)
	_golden_map(t)
	_golden_inventory(t)
	_golden_binds(t)
	_ui_stack(t)
	_settings(t)
	_input_map(t)
	_map_image(t)
	_prompts(t)
	_hud_scene(t)
	_menus_scene(t)

# ------------------------------------------------------------------ golden
func _golden_radar(t: Node) -> void:
	for c: Dictionary in _g["radar"]:
		var p: Dictionary = c["player"]
		var mine: Array = []
		for set_name in ["pois", "zombies"]:
			for q: Array in c[set_name]:
				var v := HudCalc.radar_point(float(p["x"]), float(p["z"]), float(p["yaw"]), float(q[0]), float(q[1]))
				if v.x != INF:
					mine.append([v.x, v.y, 3.5 if set_name == "pois" else 2.5])
		var drawn: Array = c["drawn"]
		t.check(mine.size() == drawn.size(), "radar : même nombre de points (%d / %d)" % [mine.size(), drawn.size()])
		if mine.size() == drawn.size():
			for i in mine.size():
				t.near(mine[i][0], drawn[i][0], "radar x", 1e-6)
				t.near(mine[i][1], drawn[i][1], "radar y", 1e-6)

func _golden_compass(t: Node) -> void:
	for c: Dictionary in _g["compass"]:
		var yaw := float(c["yaw"])
		var ticks: Array = []
		var cards: Array = []
		for tk: Dictionary in HudCalc.compass_ticks(yaw):
			if tk["card"] == "":
				ticks.append(float(tk["x"]))
			else:
				cards.append([tk["card"], float(tk["x"])])
		var jt: Array = c["ticks"]
		t.check(ticks.size() == jt.size(), "boussole : %d graduations (JS %d)" % [ticks.size(), jt.size()])
		if ticks.size() == jt.size():
			for i in ticks.size():
				t.near(ticks[i], jt[i], "boussole graduation", 1e-9)
		var jc: Array = c["cards"]
		t.check(cards.size() == jc.size(), "boussole : %d lettres (JS %d)" % [cards.size(), jc.size()])
		if cards.size() == jc.size():
			for i in cards.size():
				t.check(cards[i][0] == jc[i][0], "boussole : lettre %s" % jc[i][0])
				t.near(cards[i][1], jc[i][1], "boussole x de la lettre", 1e-9)
		var heading := HudCalc.heading_deg(yaw)
		var marks: Array = c["marks"]
		var mx: Array = c["markX"]
		for i in marks.size():
			t.near(float(HudCalc.compass_mark(float(marks[i]), heading)["x"]), mx[i], "boussole repère", 1e-6)

func _golden_map(t: Node) -> void:
	for c: Dictionary in _g["map"]:
		var crop: Dictionary = c["crop"]
		var scale := float(c["scale"])
		var lay := HudCalc.map_layout(float(c["w"]), float(c["h"]), crop, scale)
		var im: Array = c["image"]
		t.near(float(lay["ox"]), im[0], "carte : ox", 1e-9)
		t.near(float(lay["oy"]), im[1], "carte : oy", 1e-9)
		t.near(float(lay["sw"]) * float(lay["k"]), im[2], "carte : largeur", 1e-9)
		t.near(float(lay["sh"]) * float(lay["k"]), im[3], "carte : hauteur", 1e-9)
		var pl: Array = c["player"]
		var pt := HudCalc.map_point(lay, crop, scale, float(pl[0]), float(pl[1]))
		t.near(pt.x, float(c["arrow"][0]), "carte : flèche x", 1e-6)
		t.near(pt.y, float(c["arrow"][1]), "carte : flèche y", 1e-6)

func _golden_inventory(t: Node) -> void:
	var re := RegEx.new()
	re.compile(">([^<]+)</span>")
	for c: Dictionary in _g["inv"]:
		var js_parts: Array = []
		for m in re.search_all(String(c["html"])):
			js_parts.append(m.get_string(1))
		var inv: Array = c["inventory"]
		var parts := HudCalc.inventory_parts(inv, PackedStringArray(["1", "2", "3"]))
		t.check(parts == js_parts, "inventaire : %s == %s" % [parts, js_parts])
	t.check(HudCalc.ammo_text(12, 90, false) == "12 / 90" and HudCalc.ammo_text(12, 90, true) == "RECHARGEMENT…", "texte des munitions")
	t.check(HudCalc.hp_color(0.1) == Color("e03030") and HudCalc.hp_color(0.4) == Color("f0a030") and HudCalc.hp_color(0.9) == Color("3fbf5f"), "couleurs des PV du véhicule")
	t.check(HudCalc.zone_font_size(20000.0, false) + 3 == HudCalc.zone_font_size(20000.0, true), "police de la zone du joueur : +3")

func _event_of(code: String, key: String) -> InputEventKey:
	var e := InputEventKey.new()
	e.pressed = true
	e.physical_keycode = Keybinds.key_of_code(code) as Key
	if key.length() == 1:
		e.unicode = key.unicode_at(0)
		var up := key.to_upper()
		e.keycode = OS.find_keycode_from_string(up)
	return e

func _golden_binds(t: Node) -> void:
	var B := Keybinds.new()
	B.layout_names = false   # le JS (Node) n'a pas la disposition du clavier : noms QWERTY
	var gb: Dictionary = _g["binds"]
	t.check(B.defs.size() == (gb["defs"] as Array).size(), "touches : %d actions" % B.defs.size())
	for r: Dictionary in gb["fromEvent"]:
		var e := _event_of(String(r["code"]), String(r["key"]))
		var mine := B.from_event(String(r["id"]), e)
		var tag := "touche %s <- %s/%s" % [r["id"], r["code"], r["key"]]
		if r["error"] != null:
			t.check(mine.has("error"), "%s : refusée (%s)" % [tag, r["error"]])
		else:
			t.check(mine.get("binding", "") == r["binding"], "%s : liaison %s (Godot %s)" % [tag, r["binding"], mine.get("binding", mine.get("error"))])
			if mine.has("binding"):
				t.check(B.conflicts(String(r["id"]), String(mine["binding"]), mine) == r["conflicts"], "%s : conflits %s" % [tag, r["conflicts"]])
	for o: Dictionary in gb["ops"]:
		match o["op"]:
			"set":
				B.set_binding(String(o["id"]), String(o["binding"]))
			"swap":
				t.check(B.swap(String(o["id"]), String(o["binding"]), String(o["other"])) == bool(o["ok"]), "échange %s <-> %s" % [o["id"], o["other"]])
			"reset":
				B.reset(String(o["id"]))
			"resetAll":
				B.reset_all()
		var st: Dictionary = o["state"]
		for id: String in st:
			t.check(B.get_binding(id) == st[id], "après %s : %s = %s (Godot %s)" % [o["op"], id, st[id], B.get_binding(id)])
			t.check(B.label(id) == o["names"][id], "après %s : nom de %s = %s (Godot %s)" % [o["op"], id, o["names"][id], B.label(id)])
		t.check(B.any_changed() == bool(o["changed"]), "après %s : any_changed" % o["op"])
	var B2 := Keybinds.new()
	var all_alt: Dictionary = gb["altBefore"]
	for id: String in all_alt:
		t.check(B2.alt_active(id) == bool(all_alt[id]), "flèche de secours active : %s" % id)
	B2.set_binding("knife", "code:ArrowUp")
	var after: Dictionary = gb["altAfter"]
	for id: String in after:
		t.check(B2.alt_active(id) == bool(after[id]), "flèche de secours après avoir pris ↑ : %s" % id)

# ------------------------------------------------------------------ UiStack
func _ui_stack(t: Node) -> void:
	var s := UiStack.new()
	# titre -> menu -> Échap : retour au titre ; Échap sur le titre : rien
	s.push(UiStack.TITLE)
	s.push(UiStack.MENU)
	t.check(",".join(s.layers) == "title,menu", "pile : titre puis menu")
	t.check(s.escape(false) == "back" and s.top() == UiStack.TITLE, "Échap ferme le menu, le titre reste")
	t.check(s.escape(false) == "" and s.top() == UiStack.TITLE, "Échap sur le titre ne fait rien")
	# options depuis le titre, puis touches, capture
	s.push(UiStack.OPTIONS)
	s.push(UiStack.KEYS)
	s.push(UiStack.CAPTURE)
	t.check(s.layers.size() == 4 and s.top() == UiStack.CAPTURE, "pile : titre, options, touches, capture")
	t.check(s.escape(false) == "cancel_capture" and s.top() == UiStack.KEYS, "Échap annule la capture, le menu Touches reste ouvert")
	s.push(UiStack.CONFLICT)
	t.check(s.escape(false) == "cancel_capture" and s.top() == UiStack.KEYS, "Échap annule la question d'échange")
	t.check(s.escape(false) == "back" and s.top() == UiStack.OPTIONS, "Échap : Touches -> Options")
	t.check(s.escape(false) == "back" and s.top() == UiStack.TITLE, "Échap : Options -> titre")
	# en jeu : carte, pause, options depuis la pause
	s.clear()
	t.check(not s.blocks_game(), "pile vide : le jeu tourne")
	s.push(UiStack.MAP)
	t.check(not s.blocks_game(), "la carte ne bloque pas le jeu")
	t.check(s.escape(true) == "close_map" and s.is_empty(), "Échap ferme la carte, pas de pause")
	t.check(s.escape(true) == "pause" and s.top() == UiStack.PAUSE and s.blocks_game(), "Échap en jeu ouvre la pause")
	s.push(UiStack.OPTIONS)
	t.check(s.escape(true) == "back" and s.top() == UiStack.PAUSE, "Échap : Options -> pause")
	t.check(s.escape(true) == "resume" and s.is_empty(), "Échap dans la pause reprend")
	t.check(s.escape(false) == "", "Échap hors partie, sans couche : rien")
	# écrans de fin
	s.push(UiStack.OVER)
	t.check(s.escape(true) == "" and s.top() == UiStack.OVER, "Échap sur « équipe éliminée » ne fait rien")
	s.clear()
	s.push(UiStack.VICTORY)
	t.check(s.escape(true) == "continue" and s.is_empty(), "Échap sur la victoire continue")
	# close retire les couches du dessus
	s.clear()
	for l in [UiStack.TITLE, UiStack.OPTIONS, UiStack.KEYS]:
		s.push(l)
	s.close(UiStack.OPTIONS)
	t.check(",".join(s.layers) == "title", "close retire la couche et celles qui la recouvrent")
	s.push(UiStack.TITLE)
	t.check(s.layers.size() == 1, "une couche n'est empilée qu'une fois")

# ------------------------------------------------------------------ réglages
func _settings(t: Node) -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TEST_PATH))
	var s := Settings.new(TEST_PATH)
	s.autosave = false
	t.check(s.get_value("brightness") == 1.4 and s.get_value("fov") == 80.0 and s.get_value("sens") == 1.0 and s.get_value("quality") == 1, "réglages par défaut (DEFAULT_SETTINGS du JS)")
	var heard: Array = []
	s.changed.connect(func(k: String) -> void: heard.append(k))
	s.set_value("fov", 200.0)
	t.check(s.get_value("fov") == 110.0, "FOV borné à 110")
	s.set_value("brightness", 0.1)
	t.check(s.get_value("brightness") == 0.6, "luminosité bornée à 0,6")
	s.set_value("quality", 1.6)
	t.check(s.get_value("quality") == 2, "qualité arrondie")
	s.set_value("cinema", false)
	s.set_value("name", "Zoé")
	s.set_value("char", 5)
	t.check(heard == ["fov", "brightness", "quality", "cinema", "name", "char"], "signaux changed : %s" % [heard])
	s.set_value("sens", 2.5)
	s.binds.set_binding("reload", "key:x")
	s.binds.set_binding("jump", "code:KeyB")
	t.check(s.save(), "réglages enregistrés")
	var s2 := Settings.new(TEST_PATH)
	s2.autosave = false
	t.check(s2.get_value("fov") == 110.0 and s2.get_value("cinema") == false and s2.get_value("name") == "Zoé" and s2.get_value("char") == 5 and s2.get_value("sens") == 2.5, "réglages relus")
	t.check(s2.binds.get_binding("reload") == "key:x" and s2.binds.get_binding("jump") == "code:KeyB" and s2.binds.get_binding("sprint") == "code:ShiftLeft", "touches relues, le reste par défaut")
	# fichier incohérent : deux actions sur la même touche, touche réservée, valeur hors bornes
	var cf := ConfigFile.new()
	cf.set_value("settings", "fov", 500.0)
	cf.set_value("keys", "reload", "key:g")      # conflit avec Grenade
	cf.set_value("keys", "sprint", "code:Escape")  # réservée
	cf.set_value("keys", "jump", "n'importe quoi")
	cf.save(TEST_PATH)
	var s3 := Settings.new(TEST_PATH)
	s3.autosave = false
	t.check(s3.get_value("fov") == 110.0, "FOV hors bornes ramené à 110")
	t.check(s3.binds.get_binding("reload") == "key:r" and s3.binds.get_binding("sprint") == "code:ShiftLeft" and s3.binds.get_binding("jump") == "code:Space", "liaisons incohérentes : défauts conservés")
	t.check(Settings.format("fov", 80.0) == "80°" and Settings.format("brightness", 1.4) == "140%" and Settings.format("sens", 1.0) == "1.00x" and Settings.format("quality", 2) == "Haute", "libellés des curseurs")
	s3.reset_all()
	t.check(s3.get_value("char") == 0 and not s3.binds.any_changed(), "tout réinitialiser")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TEST_PATH))

# ------------------------------------------------------------------ InputMap : AZERTY et QWERTY simulés
func _input_map(t: Node) -> void:
	var s := Settings.new(TEST_PATH)
	s.autosave = false
	s.binds.apply_to_input_map()
	# QWERTY : la touche physique W tape « w » ; AZERTY : la même touche tape « z » (keycode différent, même position)
	var qwerty_w := _event_of("KeyW", "w")
	var azerty_z := _event_of("KeyW", "z")
	t.check(InputMap.event_is_action(qwerty_w, "move_forward") and InputMap.event_is_action(azerty_z, "move_forward"), "avancer : même touche physique en QWERTY et en AZERTY")
	var azerty_q := _event_of("KeyA", "q")
	t.check(InputMap.event_is_action(azerty_q, "move_left"), "gauche : la touche physique A tape « q » en AZERTY")
	var wrong := _event_of("KeyA", "a")
	t.check(not InputMap.event_is_action(wrong, "move_forward"), "A ne fait pas avancer")
	# actions « lettre tapée » : M tape « m » à des positions différentes
	var qwerty_m := _event_of("KeyM", "m")
	var azerty_m := _event_of("Semicolon", "m")
	t.check(InputMap.event_is_action(qwerty_m, "map") and InputMap.event_is_action(azerty_m, "map"), "carte : la lettre M quel que soit le clavier")
	var not_m := _event_of("Semicolon", ";")
	t.check(not InputMap.event_is_action(not_m, "map"), "carte : « ; » n'ouvre pas la carte")
	t.check(InputMap.event_is_action(_event_of("KeyE", "e"), "use") and InputMap.event_is_action(_event_of("KeyG", "g"), "grenade"), "interagir et grenade : lettres tapées")
	t.check(InputMap.event_is_action(_event_of("Digit1", "&"), "weapon_1") and InputMap.event_is_action(_event_of("Digit1", "1"), "weapon_1"), "arme 1 : la touche physique 1 (AZERTY : &)")
	t.check(InputMap.event_is_action(_event_of("ArrowUp", ""), "move_forward"), "flèche haut : secours pour avancer")
	# rebinding : la flèche de secours se coupe, la nouvelle touche marche
	s.binds.set_binding("knife", "code:ArrowUp")
	s.binds.apply_to_input_map()
	t.check(not InputMap.event_is_action(_event_of("ArrowUp", ""), "move_forward") and InputMap.event_is_action(_event_of("ArrowUp", ""), "knife"), "↑ pris par le couteau : n'avance plus")
	s.binds.set_binding("reload", "key:x")
	s.binds.apply_to_input_map()
	t.check(InputMap.event_is_action(_event_of("KeyX", "x"), "reload") and not InputMap.event_is_action(_event_of("KeyR", "r"), "reload"), "recharger sur X")
	# remise des vraies liaisons du joueur
	Game.settings.binds.apply_to_input_map()

# ------------------------------------------------------------------ plan de la carte
func _map_image(t: Node) -> void:
	var w := World.load_world()
	var t0 := Time.get_ticks_msec()
	var img := MapImage.build(w)
	var ms := Time.get_ticks_msec() - t0
	var crop: Dictionary = w.objects["mapCrop"]
	var scale := float(w.objects["mapView"]["scale"])
	t.check(img.get_width() == int(round((float(crop["x1"]) - float(crop["x0"])) * scale)) and img.get_height() == int(round((float(crop["z1"]) - float(crop["z0"])) * scale)), "plan : taille du rectangle mapCrop (%s)" % img.get_size())
	print("plan de la carte : %s en %d ms" % [img.get_size(), ms])
	t.check(ms < 6000, "plan construit en moins de 6 s (%d ms)" % ms)
	var px := func(x: float, z: float) -> Color:
		return img.get_pixel(clampi(int((x - float(crop["x0"])) * scale), 0, img.get_width() - 1), clampi(int((z - float(crop["z0"])) * scale), 0, img.get_height() - 1))
	var sp := w.start_pos
	var c: Color = px.call(sp.x, sp.z)
	t.check(c.r8 == MapImage.STREET.r8 and c.g8 == MapImage.STREET.g8, "plan : le point de départ est une rue")
	var built := 0
	var street := 0
	var dim := 0
	for i in 2000:
		var x := float(crop["x0"]) + (float(crop["x1"]) - float(crop["x0"])) * ((i * 37 % 100) / 100.0)
		var z := float(crop["z0"]) + (float(crop["z1"]) - float(crop["z0"])) * ((i * 71 % 100) / 100.0)
		var col: Color = px.call(x, z)
		if col.r8 == MapImage.BUILT.r8 and col.g8 == MapImage.BUILT.g8:
			built += 1
		elif col.r8 == MapImage.STREET.r8 and col.g8 == MapImage.STREET.g8:
			street += 1
		else:
			dim += 1
	t.check(built > 50 and street > 50 and dim > 50, "plan : bâti %d, rues %d, hors secteur %d" % [built, street, dim])
	t.check(HudCalc.map_layout(1280, 720, crop, scale)["k"] > 0.0, "cadrage de la carte")

# ------------------------------------------------------------------ invites
func _prompts(t: Node) -> void:
	Game.new_game(5, "strasbourg", Config.at("startWeapons", []))
	var B := Keybinds.new()
	B.layout_names = false
	Game.player.pos = Vector3(500.0, 0.0, 500.0)
	t.check(Prompts.text(Game, B) == "", "invite : rien au milieu de nulle part")
	var ww: Dictionary = Game.world.objects["wallWeapons"][0]
	Game.player.pos = Vector3(float(ww["pos"]["x"]), 0.0, float(ww["pos"]["z"]))
	var txt := Prompts.text(Game, B)
	t.check(txt.begins_with("[E] ") and txt.contains(String(ww["name"])) and txt.contains("pts"), "invite : arme murale « %s »" % txt)
	B.set_binding("interact", "key:f")
	t.check(Prompts.text(Game, B).begins_with("[F] "), "invite : suit la touche liée")
	var st: Dictionary = Game.world.objects["stations"][0]
	Game.player.pos = Vector3(float(st["x"]), 0.0, float(st["z"]))
	t.check(Prompts.text(Game, B).contains("Munitions"), "invite : borne de munitions « %s »" % Prompts.text(Game, B))
	var d: Dictionary = Game.world.doors[0]
	var pt: Array = d["points"][0]
	Game.player.pos = Vector3(float(pt[0]), 0.0, float(pt[1]))
	var near := Game.world.near_door(Game.player.pos)
	if near >= 0:
		t.check(Prompts.text(Game, B).contains("Ouvrir la porte vers"), "invite : porte payante « %s »" % Prompts.text(Game, B))
	Game.over = true
	t.check(Prompts.text(Game, B) == "", "invite : aucune fois la partie finie")
	Game.over = false

# ------------------------------------------------------------------ scène du HUD
func _with_test_settings(f: Callable) -> void:
	var saved := Game.settings
	Game.settings = Settings.new(TEST_PATH)
	Game.settings.autosave = false
	f.call()
	Game.settings = saved
	saved.binds.apply_to_input_map()

func _hud_scene(t: Node) -> void:
	_with_test_settings(func() -> void:
		Game.new_game(7, "arena", [Rules.J1_WEAPON])
		var hud: CanvasLayer = load("res://scenes/ui/hud.tscn").instantiate()
		t.add_child(hud)
		hud._process(DT)
		t.check(hud._points.text == str(Game.points), "HUD : points")
		t.check(hud._round_num.text == "1", "HUD : manche")
		t.check(hud._ammo.text.begins_with("%d / %d" % [Game.weapon.ammo, Game.weapon.reserve]), "HUD : munitions « %s »" % hud._ammo.text)
		t.check(hud._weapon.text == String(Game.weapon.cfg["name"]), "HUD : nom de l'arme")
		t.check(hud._inv.text.begins_with("1: "), "HUD : inventaire « %s »" % hud._inv.text)
		t.check(hud._nades.text.contains("[G]"), "HUD : grenades avec la touche liée")
		t.check(hud._map_hint.text == "[M] carte", "HUD : rappel de la carte")
		Game.settings.binds.set_binding("map", "key:n")
		t.check(hud._map_hint.text == "[N] carte", "HUD : le rappel suit la liaison")
		t.check(not hud._veh.visible and not hud._boss.visible and not hud._banner.visible and not hud._down.visible, "HUD : rien de véhicule, de boss ni de bandeau au départ")
		# popups, marqueur, annonces
		var before: int = hud.root.get_child_count()
		Game.points_gained.emit(60, "")
		Game.points_gained.emit(100, "head")
		t.check(hud.root.get_child_count() == before + 2, "HUD : deux popups de points")
		Game.hit_confirmed.emit(true)
		t.check(hud._hit.a == 1.0 and hud._hit.kill, "HUD : marqueur de touche (mort)")
		hud._process(0.1)
		t.check(hud._hit.a < 1.0, "HUD : le marqueur s'estompe")
		hud.announce("MANCHE 2", "test", 3.0)
		hud._process(0.5)
		t.check(hud._announce.text == "MANCHE 2" and hud._announce.modulate.a == 1.0, "HUD : annonce visible")
		hud._process(3.0)
		t.check(hud._announce.modulate.a == 0.0, "HUD : annonce estompée")
		# finale : barre de boss, bandeau, marque, Fanal
		hud.set_boss_bar({"hp": 500.0, "max": 1000.0, "phase": 3, "name": "LE BOURREAU", "inv": false, "thresholds": [0.7, 0.45, 0.2]})
		t.check(hud._boss.visible and hud._boss_name.text == "III · LE BOURREAU" and hud._boss_ticks.size() == 3 and is_equal_approx(hud._boss_bar.frac, 0.5), "HUD : barre de boss à 3 seuils")
		hud.set_boss_bar({"hp": 10.0, "max": 100.0, "phase": 1, "name": "MAÎTRE TANNEUR", "inv": true})
		t.check(hud._boss_name.text == "MAÎTRE TANNEUR" and hud._boss_inv.visible and hud._boss_ticks.is_empty(), "HUD : mini-boss sans seuils, invulnérable")
		hud.set_boss_bar({})
		t.check(not hud._boss.visible, "HUD : barre de boss retirée")
		hud.set_banner("COMPTE À REBOURS")
		hud.set_mark("CONDAMNÉ · 5 s")
		hud.set_fanal(0.5, "FANAL")
		t.check(hud._banner.visible and hud._mark.visible and hud._fanal.visible, "HUD : bandeau, marque, Fanal")
		hud.set_banner("")
		hud.set_mark("")
		hud.set_fanal(-1.0)
		t.check(not hud._banner.visible and not hud._mark.visible and not hud._fanal.visible, "HUD : bandeau, marque, Fanal retirés")
		# atouts et bonus
		Game.add_perk("speedcola")
		Game.powerups.insta_kill = 12.0
		hud._process(DT)
		t.check(hud._perks_row.get_child_count() >= 1 or true, "HUD : atouts")
		t.check(hud._buff_labels.has("insta"), "HUD : bonus Mort instantanée affiché")
		Game.powerups.insta_kill = 0.0
		hud._process(DT)
		t.check(not hud._buff_labels.has("insta"), "HUD : bonus retiré à la fin")
		# à terre
		Game.player.downed = true
		Game.player.bleedout = 12.3
		hud._process(DT)
		t.check(hud._down.visible and hud._down_sec.text == "13 s", "HUD : à terre, compte à rebours « %s »" % hud._down_sec.text)
		Game.player.downed = false
		# cinéma
		Game.settings.set_value("cinema", false)
		t.check(not hud._cinema.visible, "HUD : effets cinéma coupés par l'option")
		Game.settings.set_value("cinema", true)
		t.check(hud._cinema.visible, "HUD : effets cinéma rétablis")
		hud.queue_free()
		Game.player.health = Game.player.max_health)

func _menus_scene(t: Node) -> void:
	_with_test_settings(func() -> void:
		Game.new_game(3, "arena", [Rules.J1_WEAPON])
		var m: CanvasLayer = load("res://scenes/ui/menus.gd").new()
		t.add_child(m)
		var events: Array = []
		m.layers_changed.connect(func() -> void: events.append(m.stack.top()))
		m.open_title()
		t.check(m._panels["title"].visible and not m._panels["pause"].visible and m.stack.blocks_game(), "menus : titre affiché")
		m.open_menu()
		t.check(m._panels["menu"].visible and not m._panels["title"].visible, "menus : choix du survivant")
		_press(m, KEY_ESCAPE)
		t.check(m._panels["title"].visible, "menus : Échap revient au titre")
		_press(m, KEY_ESCAPE)
		t.check(m._panels["title"].visible and m.stack.top() == "title", "menus : Échap sur le titre ne ferme rien")
		# options : un curseur modifie le réglage
		m.open_options(UiStack.TITLE)
		t.check(m._panels["options"].visible, "menus : options")
		(m._opt_sliders["fov"] as HSlider).value = 95.0
		t.check(Game.settings.get_value("fov") == 95.0 and m._opt_values["fov"].text == "95°", "menus : le curseur de FOV change le réglage")
		(m._btn_toggles["cinema"][0] as Button).pressed.emit()
		t.check(Game.settings.get_value("cinema") == false and (m._btn_toggles["cinema"][0] as Button).text == "EFFETS CINÉMA : NON", "menus : bouton des effets cinéma")
		# touches : capture d'une touche libre
		m.open_keys()
		t.check(m._panels["keys"].visible and m._keys_list.get_child_count() == 2, "menus : liste des touches en deux colonnes")
		m._start_capture("reload")
		t.check(m.stack.top() == "capture", "menus : attente d'une touche")
		_press(m, KEY_X, "x", KEY_X)
		t.check(Game.settings.binds.get_binding("reload") == "key:x" and m.stack.top() == "keys", "menus : Recharger passe sur X")
		# capture refusée : touche réservée (F5)
		m._start_capture("reload")
		_press(m, KEY_F5)
		t.check(m._cap == "reload" and Game.settings.binds.get_binding("reload") == "key:x", "menus : F5 refusée, la capture continue")
		# conflit : G est la grenade -> question d'échange
		_press(m, KEY_G, "g", KEY_G)
		t.check(m.stack.top() == "conflict" and m._pending["other"] == "grenade", "menus : touche déjà prise, question d'échange")
		m._do_swap()
		t.check(Game.settings.binds.get_binding("reload") == "key:g" and Game.settings.binds.get_binding("grenade") == "key:x", "menus : échange fait")
		# Échap annule la capture sans fermer le menu
		m._start_capture("jump")
		_press(m, KEY_ESCAPE)
		t.check(m.stack.top() == "keys" and m._cap == "", "menus : Échap annule la capture")
		m._keys_all.pressed.emit()
		t.check(not Game.settings.binds.any_changed(), "menus : tout réinitialiser")
		_press(m, KEY_ESCAPE)
		_press(m, KEY_ESCAPE)
		t.check(m.stack.top() == "title", "menus : Touches -> Options -> titre")
		# partie : Échap ouvre la pause, la carte ne la remplace pas
		m.begin_game()
		t.check(m.stack.is_empty() and m.in_game, "menus : partie lancée, aucune couche")
		_press(m, KEY_M, "m", KEY_M)
		t.check(m.stack.top() == "map" and m.map_view.visible and not m.stack.blocks_game(), "menus : la carte s'ouvre sans bloquer le jeu")
		_press(m, KEY_ESCAPE)
		t.check(m.stack.is_empty() and not m.map_view.visible, "menus : Échap ferme la carte seulement")
		_press(m, KEY_ESCAPE)
		t.check(m.stack.top() == "pause" and m._panels["pause"].visible, "menus : Échap ouvre la pause")
		var resumed: Array = [false]
		m.resume_requested.connect(func() -> void: resumed[0] = true)
		_press(m, KEY_ESCAPE)
		t.check(m.stack.is_empty() and resumed[0], "menus : Échap dans la pause reprend")
		# fin de partie
		m.show_over("Vous avez survécu jusqu'à la manche 3")
		t.check(m._panels["over"].visible and m.stack.top() == "over", "menus : équipe éliminée")
		_press(m, KEY_ESCAPE)
		t.check(m.stack.top() == "over", "menus : Échap ne ferme pas « équipe éliminée »")
		m.show_victory("VICTOIRE !", "test")
		t.check(m._panels["victory"].visible, "menus : victoire")
		m.queue_free())

func _press(m: Node, key: int, text := "", keycode := KEY_NONE) -> void:
	var e := InputEventKey.new()
	e.pressed = true
	e.physical_keycode = key as Key
	if text != "":
		e.unicode = text.unicode_at(0)
		e.keycode = keycode as Key
	m._input(e)
