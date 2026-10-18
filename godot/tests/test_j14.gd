extends RefCounted
## v0.14.0 : vrai menu principal. Difficulté (Normale = x1 exactement), statistiques persistantes (user://), machine d'états de la session, nouvelles
## couches de l'UiStack, écrans du menu (navigation, carte et difficulté, statistiques avec confirmation, crédits, chargement), et SURTOUT : aucun
## chargement lourd avant NOUVELLE PARTIE (le jeu est lancé à part, en mode titre, et dit ce qu'il a en mémoire : pas de monde, de joueur ni de zombies).

const STATS_PATH := "user://test_j14_stats.json"
const SETTINGS_PATH := "user://test_j14_settings.cfg"

func run(t: Node) -> void:
	_difficulty(t)
	_director(t)
	_spawned_zombies(t)
	_stats(t)
	_flow(t)
	_ui_stack(t)
	_settings(t)
	_menus_scene(t)
	_no_heavy_load(t)
	Game.difficulty = "normal"
	for p in [STATS_PATH, SETTINGS_PATH]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))

# ---------------------------------------------------------------- difficulté
func _difficulty(t: Node) -> void:
	t.check(Difficulty.ids() == ["easy", "normal", "hard"], "difficultés : facile, normale, difficile")
	t.check(Difficulty.health_mult("normal") == 1.0 and Difficulty.speed_mult("normal") == 1.0, "Normale = x1 exactement (vie et vitesse)")
	t.check(Difficulty.health_mult("easy") < 1.0 and Difficulty.speed_mult("easy") < 1.0, "Facile : zombies plus fragiles et plus lents")
	t.check(Difficulty.health_mult("hard") > 1.0 and Difficulty.speed_mult("hard") > 1.0, "Difficile : zombies plus résistants et plus rapides")
	t.check(Difficulty.health_mult("easy") >= 0.5 and Difficulty.health_mult("hard") <= 2.0 and Difficulty.speed_mult("hard") <= 1.3, "multiplicateurs raisonnables")
	t.check(Difficulty.valid("nimporte") == "normal" and Difficulty.valid("hard") == "hard", "difficulté inconnue : Normale")
	t.check(Difficulty.name_of("easy") == "FACILE" and Difficulty.name_of("normal") == "NORMALE" and Difficulty.name_of("hard") == "DIFFICILE", "noms affichés")
	t.check(Game.difficulty == "normal", "la difficulté par défaut de Game est Normale")

func _director(t: Node) -> void:
	for r in [1, 2, 5, 12, 25]:
		var base := RoundDirector.new()
		Game.difficulty = "normal"
		base.round_number = r - 1
		base.start_round()
		var Z: Dictionary = Config.at("zombie")
		t.check(base.zombie_health == float(Game.zombie_health_at(r)), "manche %d Normale : vie inchangée (%s)" % [r, base.zombie_health])
		t.check(base.zombie_speed == minf(float(Z["speedStart"]) + r * float(Z["speedPerRound"]), float(Z["speedMax"])), "manche %d Normale : vitesse inchangée" % r)
		for d in ["easy", "hard"]:
			Game.difficulty = d
			var dr := RoundDirector.new()
			dr.round_number = r - 1
			dr.start_round()
			t.near(dr.zombie_health, base.zombie_health * Difficulty.health_mult(d), "manche %d %s : vie x%s" % [r, d, Difficulty.health_mult(d)], 1e-12)
			t.near(dr.zombie_speed, base.zombie_speed * Difficulty.speed_mult(d), "manche %d %s : vitesse x%s" % [r, d, Difficulty.speed_mult(d)], 1e-12)
			t.check(dr.to_spawn == base.to_spawn, "manche %d %s : même nombre de zombies" % [r, d])
	Game.difficulty = "normal"

## Un vrai zombie apparu dans l'arène porte la vie de la difficulté ; en Normale la partie est identique d'une fois sur l'autre.
func _spawned_zombies(t: Node) -> void:
	var first_hp := {}
	for d in ["easy", "normal", "hard"]:
		Game.difficulty = d
		Game.new_game(5, "arena", [Rules.J1_WEAPON])
		var n := 0
		while Game.zombies.is_empty() and n < 2000:
			Game.step(1.0 / 60.0, {})
			n += 1
		t.check(not Game.zombies.is_empty(), "%s : un zombie apparaît" % d)
		if not Game.zombies.is_empty():
			var z: ZombieSim = Game.zombies[0]
			first_hp[d] = z.max_health
			t.near(z.max_health, Game.director.zombie_health, "%s : vie du zombie = vie de la manche" % d, 1e-12)
	t.near(first_hp["easy"] / first_hp["normal"], Difficulty.health_mult("easy"), "zombie Facile : x0,75 de la vie Normale", 1e-9)
	t.near(first_hp["hard"] / first_hp["normal"], Difficulty.health_mult("hard"), "zombie Difficile : x1,35 de la vie Normale", 1e-9)
	Game.difficulty = "normal"
	var a := _short_game()
	var b := _short_game()
	t.check(a == b, "Normale : deux parties de même graine donnent le même état (%s)" % a)

func _short_game() -> String:
	Game.difficulty = "normal"
	Game.new_game(11, "arena", [Rules.J1_WEAPON])
	for i in 600:
		Game.step(1.0 / 60.0, {"mx": 0.0, "mz": 0.0})
	var hp := 0.0
	for z in Game.zombies:
		hp += z.health + z.pos.x + z.pos.z + z.speed
	return "%d zombies, %.9f" % [Game.zombies.size(), hp]

# ---------------------------------------------------------------- statistiques
func _stats(t: Node) -> void:
	if FileAccess.file_exists(STATS_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(STATS_PATH))
	var s := GameStats.new(STATS_PATH)
	t.check(s.total_games() == 0 and s.by_diff.is_empty(), "stats : départ à zéro")
	var broken := s.record("normal", 7, 120, 5400, 600.0, false)
	t.check("best_round" in broken and "best_kills" in broken and "best_points" in broken and "best_time" in broken, "stats : première partie, tous les records battus")
	broken = s.record("normal", 5, 200, 3000, 300.0, true)
	t.check(broken == ["best_kills"], "stats : seul le record de tués est battu (%s)" % [broken])
	s.record("hard", 3, 10, 800, 90.5, false)
	var n := s.entry("normal")
	t.check(n["games"] == 2 and n["wins"] == 1 and n["best_round"] == 7 and n["best_kills"] == 200 and n["best_points"] == 5400, "stats Normale : parties, victoires, records")
	t.near(n["best_time"], 600.0, "stats Normale : plus longue survie")
	t.near(n["total_time"], 900.0, "stats Normale : temps total")
	t.check(n["total_kills"] == 320, "stats Normale : total de tués")
	t.check(s.entry("hard")["games"] == 1 and s.entry("easy")["games"] == 0, "stats : séparées par difficulté")
	var o := s.overall()
	t.check(o["games"] == 3 and o["wins"] == 1 and o["best_round"] == 7 and o["best_kills"] == 200, "stats : total toutes difficultés")
	t.near(o["total_time"], 990.5, "stats : temps total toutes difficultés")
	# persistance
	var again := GameStats.new(STATS_PATH)
	t.check(again.total_games() == 3, "stats : relues depuis user:// (%d parties)" % again.total_games())
	for d in Difficulty.ids():
		t.same(again.entry(d), s.entry(d), "stats : %s identique après relecture" % d)
	t.check(typeof(again.entry("normal")["games"]) == TYPE_INT and typeof(again.entry("normal")["best_time"]) == TYPE_FLOAT, "stats : types entiers et flottants conservés par le JSON")
	# fichier abîmé ou de valeurs étranges
	var f := FileAccess.open(STATS_PATH, FileAccess.WRITE)
	f.store_string("{pas du json")
	f.close()
	t.check(GameStats.new(STATS_PATH).total_games() == 0, "stats : fichier illisible ignoré")
	f = FileAccess.open(STATS_PATH, FileAccess.WRITE)
	f.store_string('{"version":1,"difficulties":{"normal":{"games":"x","wins":4},"bizarre":{"games":9}}}')
	f.close()
	var w := GameStats.new(STATS_PATH)
	t.check(w.entry("normal")["games"] == 0 and w.entry("normal")["wins"] == 4 and w.total_games() == 0, "stats : valeurs invalides ignorées, difficulté inconnue ignorée")
	# remise à zéro
	again.reset()
	t.check(again.total_games() == 0 and GameStats.new(STATS_PATH).total_games() == 0, "stats : remise à zéro (aussi dans le fichier)")
	t.check(GameStats.format_time(48.0) == "48 s" and GameStats.format_time(725.0) == "12 min 05 s" and GameStats.format_time(9000.0) == "2 h 30 min", "stats : durées lisibles")

# ---------------------------------------------------------------- machine d'états de la session
func _flow(t: Node) -> void:
	var f := SessionFlow.new()
	t.check(f.is_menu() and not f.in_game() and f.can_start() and f.progress() == 0.0, "session : on démarre au menu, rien de chargé")
	t.check(not f.needs_record(), "session : au menu, rien à enregistrer")
	t.check(not f.end_game() and not f.finish_loading(), "session : pas de fin de partie ni de fin de chargement depuis le menu")
	t.check(f.start_loading() and f.state == SessionFlow.LOADING and not f.can_start() and not f.start_loading(), "session : NOUVELLE PARTIE -> chargement (pas deux fois)")
	t.check(not f.to_menu(), "session : on ne quitte pas le chargement")
	var total := 0.0
	for s: Array in SessionFlow.STEPS:
		total += float(s[2])
	t.near(total, 1.0, "session : poids des étapes = 1", 1e-9)
	var last := -1.0
	var texts := {}
	for i in SessionFlow.STEPS.size():
		for k in [0.0, 0.5, 1.0]:
			var p := f.progress(k)
			t.check(p >= last - 1e-9 and p <= 1.0, "session : progression monotone (%d, %.1f : %.3f)" % [i, k, p])
			last = p
		texts[f.step_text()] = true
		f.next_step()
	t.check(texts.size() == SessionFlow.STEPS.size() and last > 0.999, "session : une phrase par étape, la barre finit pleine")
	t.check(f.finish_loading() and f.state == SessionFlow.PLAYING and f.in_game() and f.needs_record(), "session : chargé -> partie, statistiques à enregistrer")
	t.check(not f.start_loading() == false, "session : on peut relancer (rejouer) depuis la partie")
	f = SessionFlow.new()
	f.start_loading()
	f.finish_loading()
	t.check(f.end_game() and f.state == SessionFlow.ENDED and f.in_game() and f.needs_record(), "session : fin de partie, encore à enregistrer")
	f.mark_recorded()
	t.check(not f.needs_record(), "session : une partie n'est comptée qu'une fois")
	t.check(f.to_menu() and f.is_menu() and not f.needs_record(), "session : retour au menu")
	f.start_loading()
	t.check(f.progress(0.0) == 0.0 and not f.recorded, "session : nouvelle partie, nouveau compte")

# ---------------------------------------------------------------- UiStack
func _ui_stack(t: Node) -> void:
	var s := UiStack.new()
	s.push(UiStack.TITLE)
	for l in [UiStack.MENU, UiStack.MAPDIFF, UiStack.STATS, UiStack.CREDITS]:
		s.push(l)
		t.check(s.top() == l and s.blocks_game(), "pile : %s ouvert" % l)
		t.check(s.escape(false) == "back" and s.top() == UiStack.TITLE, "Échap ferme %s et revient au menu principal" % l)
	s.push(UiStack.STATS)
	s.push(UiStack.CONFIRM)
	t.check(s.escape(false) == "back" and s.top() == UiStack.STATS, "Échap annule la confirmation : on reste sur les statistiques")
	t.check(s.escape(false) == "back" and s.top() == UiStack.TITLE, "Échap ferme les statistiques")
	s.clear()
	s.push(UiStack.LOADING)
	t.check(s.escape(true) == "" and s.top() == UiStack.LOADING and s.blocks_game(), "Échap ne fait rien pendant le chargement")
	s.clear()
	s.push(UiStack.TITLE)
	s.push(UiStack.KEYS)
	t.check(s.escape(false) == "back" and s.top() == UiStack.TITLE, "Touches depuis le menu principal : Échap revient au menu")
	s.clear()
	s.push(UiStack.PAUSE)
	s.push(UiStack.KEYS)
	t.check(s.escape(true) == "back" and s.top() == UiStack.PAUSE, "Touches depuis la pause : Échap revient à la pause")

# ---------------------------------------------------------------- réglages
func _settings(t: Node) -> void:
	var s := Settings.new(SETTINGS_PATH)
	t.check(s.get_value("difficulty") == "normal" and s.get_value("map") == "strasbourg", "réglages : Strasbourg en Normale par défaut")
	s.set_value("difficulty", "hard")
	s.set_value("map", "arena")
	var s2 := Settings.new(SETTINGS_PATH)
	t.check(s2.get_value("difficulty") == "hard" and s2.get_value("map") == "arena", "réglages : difficulté et carte gardées d'une session à l'autre")
	s2.values["difficulty"] = "enfer"
	s2.values["map"] = "lune"
	s2.save()
	var s3 := Settings.new(SETTINGS_PATH)
	t.check(s3.get_value("difficulty") == "normal" and s3.get_value("map") == "strasbourg", "réglages : valeurs inconnues ramenées au défaut")

# ---------------------------------------------------------------- écrans du menu
func _buttons(n: Node, out: Array) -> Array:
	for c in n.get_children():
		if c is BaseButton:
			out.append(c)
		_buttons(c, out)
	return out

func _button_texts(n: Node) -> Array:
	return _buttons(n, []).map(func(b: BaseButton) -> String: return b.text)

func _find(n: Node, text: String) -> BaseButton:
	for b: BaseButton in _buttons(n, []):
		if b.text == text:
			return b
	return null

func _menus_scene(t: Node) -> void:
	var saved_settings := Game.settings
	var saved_stats := Game.stats
	Game.settings = Settings.new(SETTINGS_PATH)
	Game.settings.autosave = false
	if FileAccess.file_exists(STATS_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(STATS_PATH))
	Game.stats = GameStats.new(STATS_PATH)
	Game.unload()
	var m: CanvasLayer = load("res://scenes/ui/menus.gd").new()
	t.add_child(m)
	var started := [0]
	m.start_requested.connect(func() -> void: started[0] += 1)
	m.open_title()
	var panel: Control = m._panels["title"]
	var texts := _button_texts(panel)
	for want in ["NOUVELLE PARTIE", "SURVIVANT", "CARTE ET DIFFICULTÉ", "MEILLEURS SCORES", "OPTIONS", "TOUCHES", "CRÉDITS", "QUITTER LE JEU", "CRÉER SALON", "REJOINDRE"]:
		t.check(want in texts, "menu principal : entrée « %s »" % want)
	t.check(_find(panel, "CRÉER SALON").disabled and _find(panel, "REJOINDRE").disabled, "menu principal : salons grisés (J12 non porté)")
	t.check(not _find(panel, "NOUVELLE PARTIE").disabled and not _find(panel, "SURVIVANT").disabled, "menu principal : le reste est actif")
	t.check(m.backdrop.visible, "le fond léger est affiché au menu")
	t.check(Game.world == null and Game.arena == null and Game.player == null, "ouvrir le menu ne charge rien")
	# NOUVELLE PARTIE demande le chargement (main.gd l'exécute)
	_find(panel, "NOUVELLE PARTIE").pressed.emit()
	t.check(started[0] == 1, "NOUVELLE PARTIE émet start_requested")
	t.check(Game.world == null and Game.player == null, "NOUVELLE PARTIE seule ne charge rien (c'est main.gd qui lance les étapes)")
	# survivant
	_find(panel, "SURVIVANT").pressed.emit()
	t.check(m.stack.top() == "menu" and m._panels["menu"].visible, "SURVIVANT ouvre le choix du survivant")
	t.check(_find(m._panels["menu"], "VALIDER") != null and _find(m._panels["menu"], "SOLO") == null, "le choix du survivant est une entrée séparée (VALIDER, plus de SOLO)")
	(m._cards[3] as Button).pressed.emit()
	t.check(Game.settings.get_value("char") == 3 and m._summary.text.begins_with("CHLOÉ"), "choisir un survivant met à jour le résumé")
	_find(m._panels["menu"], "VALIDER").pressed.emit()
	t.check(m.stack.top() == "title", "VALIDER revient au menu principal")
	# carte et difficulté
	_find(panel, "CARTE ET DIFFICULTÉ").pressed.emit()
	t.check(m.stack.top() == "mapdiff" and m._panels["mapdiff"].visible, "CARTE ET DIFFICULTÉ s'ouvre")
	t.check(Game.settings.get_value("map") == "strasbourg" and Game.settings.get_value("difficulty") == "normal", "par défaut : Strasbourg, Normale")
	(m._diff_cards["hard"] as Button).pressed.emit()
	(m._map_cards["arena"] as Button).pressed.emit()
	t.check(Game.settings.get_value("difficulty") == "hard" and Game.settings.get_value("map") == "arena", "choix de la difficulté et de la carte")
	t.check(m._summary.text.contains("ARÈNE DE TEST") and m._summary.text.contains("DIFFICILE"), "le résumé du menu suit (%s)" % m._summary.text)
	m.escape()
	t.check(m.stack.top() == "title", "Échap : retour au menu principal")
	# statistiques
	m.open_stats()
	t.check(m.stack.top() == "stats" and m._stats_reset.disabled, "statistiques vides : remise à zéro grisée")
	t.check(m._stats_note.text.contains("Aucune partie"), "statistiques vides : message")
	m.escape()
	Game.stats.record("normal", 9, 150, 7000, 700.0, true)
	m.open_stats()
	t.check(not m._stats_reset.disabled, "statistiques : remise à zéro disponible")
	var cells := PackedStringArray()
	for c in m._stats_grid.get_children():
		cells.append((c as Label).text)
	t.check("9" in cells and "7000" in cells and "11 min 40 s" in cells, "statistiques : valeurs affichées (%s)" % ", ".join(cells))
	m._stats_reset.pressed.emit()
	t.check(m.stack.top() == "confirm" and m._panels["confirm"].visible, "remise à zéro : confirmation demandée")
	m.escape()
	t.check(m.stack.top() == "stats" and Game.stats.total_games() == 1, "Échap sur la confirmation : rien n'est effacé")
	m._stats_reset.pressed.emit()
	_find(m._panels["confirm"], "NON, GARDER").pressed.emit()
	t.check(Game.stats.total_games() == 1 and m.stack.top() == "stats", "NON, GARDER : rien n'est effacé")
	m._stats_reset.pressed.emit()
	_find(m._panels["confirm"], "OUI, EFFACER").pressed.emit()
	t.check(Game.stats.total_games() == 0 and GameStats.new(STATS_PATH).total_games() == 0 and m.stack.top() == "stats" and m._stats_reset.disabled, "OUI, EFFACER : statistiques effacées (et le fichier)")
	m.escape()
	# crédits
	m.open_credits()
	t.check(m.stack.top() == "credits" and m._panels["credits"].visible, "crédits ouverts")
	var all := ""
	for n in m._panels["credits"].find_children("*", "RichTextLabel", true, false):
		all += (n as RichTextLabel).text
	for want in ["Quaternius", "Ultimate Gun Pack", "CC0", "https://opengameart.org/content/low-poly-guns-pack", "Godot", "MIT", "Three.js"]:
		t.check(all.contains(want), "crédits : « %s »" % want)
	var lic := FileAccess.get_file_as_string("res://assets/weapons/LICENSE.txt")
	t.check(lic.contains("CC0") and lic.contains("Quaternius") and lic.contains("low-poly-guns-pack"), "LICENSE.txt des armes : CC0, Quaternius, URL")
	m.escape()
	# options et touches depuis le menu principal, touches depuis la pause
	m.open_options(UiStack.TITLE)
	t.check(m._panels["options"].visible, "OPTIONS accessible depuis le menu principal")
	m.escape()
	_find(panel, "TOUCHES").pressed.emit()
	t.check(m.stack.top() == "keys" and m._panels["keys"].visible, "TOUCHES accessible depuis le menu principal")
	m.escape()
	t.check(m.stack.top() == "title", "Échap : Touches -> menu principal")
	# chargement
	m.show_loading("Construction de la ville", 0.4)
	t.check(m.stack.top() == "loading" and m._panels["loading"].visible and absf(m._loading_bar.value - 0.4) < 1e-6 and m._loading_text.text == "Construction de la ville", "écran de chargement : texte et barre")
	t.check(m.escape() == "" and m.stack.top() == "loading", "Échap ne quitte pas le chargement")
	m.show_loading("Fin", 1.0)
	t.check(m._loading_bar.value == 1.0 and m.stack.layers.size() == 1, "chargement : la barre avance sans empiler d'écrans")
	# pause : Touches et MENU PRINCIPAL
	m.begin_game()
	t.check(not m.backdrop.visible, "en partie, le fond du menu est coupé")
	Game.new_game(3, "arena", [Rules.J1_WEAPON])
	m.in_game = true
	m.open_pause()
	var pp: Control = m._panels["pause"]
	t.check(_find(pp, "MENU PRINCIPAL") != null and _find(pp, "TOUCHES") != null and _find(pp, "OPTIONS") != null and _find(pp, "REPRENDRE") != null, "pause : REPRENDRE, OPTIONS, TOUCHES, MENU PRINCIPAL")
	var back := [0]
	m.title_requested.connect(func() -> void: back[0] += 1)
	_find(pp, "MENU PRINCIPAL").pressed.emit()
	t.check(back[0] == 1, "MENU PRINCIPAL émet title_requested")
	_find(pp, "TOUCHES").pressed.emit()
	t.check(m.stack.top() == "keys", "TOUCHES accessible depuis la pause")
	m.escape()
	t.check(m.stack.top() == "pause", "Échap : Touches -> pause")
	# libération de la partie
	Game.unload()
	t.check(Game.world == null and Game.arena == null and Game.player == null and Game.director == null and Game.zombies.is_empty() and not Game.playing, "Game.unload libère la partie")
	m.queue_free()
	Game.settings = saved_settings
	saved_settings.binds.apply_to_input_map()
	Game.stats = saved_stats

# ---------------------------------------------------------------- aucun chargement lourd au titre
## Lance le jeu pour de vrai (processus headless, scène principale, mode titre) : il mesure ce qu'il a en mémoire une fois le menu affiché.
func _no_heavy_load(t: Node) -> void:
	var out: Array = []
	var code := OS.execute(OS.get_executable_path(), ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--", "--probe-title",
		"--stats=" + ProjectSettings.globalize_path(STATS_PATH), "--settings=" + ProjectSettings.globalize_path(SETTINGS_PATH), "--no-music"], out, true)
	var text := "\n".join(PackedStringArray(out))
	t.check(code == 0, "titre : le jeu s'ouvre sans monde, arène, joueur, zombies ni directeur de manches (code %d)" % code)
	t.check(text.contains("PROBE title : world=false arena=false player=false director=false zombies=0 flow=0"), "titre : état mesuré dans le jeu lancé")
	t.check(text.contains("MENU : prêt"), "titre : le menu s'est ouvert")
	var ms := 0
	var rx := RegEx.create_from_string("prêt (\\d+) ms")
	var r := rx.search(text)
	if r != null:
		ms = int(r.get_string(1))
	t.check(r != null and ms < 5000, "titre : menu prêt en %d ms après le lancement du moteur (headless)" % ms)
	# le code de main.gd ne charge rien au titre : la seule chaîne de chargement est _start_session
	var src := FileAccess.get_file_as_string("res://scenes/main.gd")
	var ready_body := src.substr(src.find("func _ready()"), src.find("func _connect_game_signals") - src.find("func _ready()"))
	t.check(not ready_body.contains("new_game") and not ready_body.contains("load_world") and not ready_body.contains("WORLD.instantiate"), "main._ready ne charge pas la partie")
