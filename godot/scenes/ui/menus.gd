extends CanvasLayer
## Menus (index.html #overlay + src/ui.js + src/keysMenu.js) : menu principal (v0.14.0 : NOUVELLE PARTIE, SURVIVANT, CARTE ET DIFFICULTÉ, MEILLEURS SCORES,
## OPTIONS, TOUCHES, CRÉDITS, QUITTER, salons grisés), écran de chargement, choix du personnage, pause, options, Options > Touches, équipe
## éliminée, victoire, et la carte plein écran. La pile des couches est un UiStack ; Échap ferme la couche du dessus. Cette scène ne touche pas à
## la partie : elle émet des signaux (start_requested, resume_requested, restart_requested, title_requested, layers_changed) que main.gd exécute.

signal start_requested
signal resume_requested
signal restart_requested
signal title_requested
signal layers_changed
signal quit_requested

const MapView := preload("res://scenes/ui/map_view.gd")
const Backdrop := preload("res://scenes/ui/menu_backdrop.gd")
const MAP_NAMES := {"strasbourg": "STRASBOURG", "arena": "ARÈNE DE TEST"}

var stack := UiStack.new()
var settings: Settings
var binds: Keybinds
var map_view: Control
var in_game := false              ## une partie est lancée (Échap ouvre la pause)

var _root: Control
var _dim: ColorRect
var _title: Label
var _text: RichTextLabel
var _version: Label
var _panels: Dictionary = {}      ## nom de couche -> panneau
var backdrop: Control
var _summary: Label
var _loading_bar: ProgressBar
var _loading_text: Label
var _stats_grid: GridContainer
var _stats_note: Label
var _stats_reset: Button
var _map_cards: Dictionary = {}
var _diff_cards: Dictionary = {}
var _opt_sliders: Dictionary = {}
var _opt_values: Dictionary = {}
var _btn_toggles: Dictionary = {}
var _btn_fs: Button
var _name_edit: LineEdit
var _cards: Array = []
var _over_text: RichTextLabel
var _over_title: Label
var _victory_text: RichTextLabel
var _victory_title: Label
var _keys_list: HBoxContainer
var _keys_status: RichTextLabel
var _keys_actions: HBoxContainer
var _keys_all: Button
var _keys_scroll: ScrollContainer
var _cap := ""                    ## action en attente d'une touche
var _pending: Dictionary = {}     ## { id, binding, other, reset } : question d'échange
var _msg := {}                    ## { text, kind }
var _swallow_up := ""
var _options_back := UiStack.TITLE

func _ready() -> void:
	layer = 20
	settings = Game.settings
	binds = settings.binds
	_root = Control.new()
	UiTheme.fill_rect(_root)
	_root.theme = UiTheme.make_theme()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	map_view = MapView.new()
	_root.add_child(map_view)
	backdrop = Backdrop.new()
	_root.add_child(backdrop)
	_dim = ColorRect.new()
	UiTheme.fill_rect(_dim)
	_dim.color = Color(0, 0, 0, 0.76)
	_dim.visible = false
	_root.add_child(_dim)
	_version = UiTheme.label("v%s" % Game.version(), 12, Color(1, 1, 1, 0.7), UiTheme.body(), 3)
	UiTheme.place(_version, 0, 0, 8, 6, 200, 18)
	_root.add_child(_version)
	var center := CenterContainer.new()
	UiTheme.fill_rect(center)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(center)
	var col := VBoxContainer.new()
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 6)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.add_child(col)
	_title = UiTheme.label("ZOMBIE SURVIVAL", 68, UiTheme.RED, UiTheme.heading(), 8)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_title)
	_text = RichTextLabel.new()
	_text.bbcode_enabled = true
	_text.fit_content = true
	_text.custom_minimum_size = Vector2(760, 0)
	_text.scroll_active = false
	_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_text.add_theme_font_size_override("normal_font_size", 18)
	_text.add_theme_color_override("default_color", Color("cccccc"))
	_text.add_theme_font_override("normal_font", UiTheme.body())
	_text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(_text)
	_build_title(col)
	_build_menu(col)
	_build_pause(col)
	_build_options(col)
	_build_keys(col)
	_build_over(col)
	_build_victory(col)
	_build_mapdiff(col)
	_build_stats(col)
	_build_credits(col)
	_build_loading(col)
	settings.changed.connect(_on_setting)
	binds.changed.connect(func() -> void:
		if stack.has(UiStack.KEYS):
			_render_keys())
	_sync()

# ---------------------------------------------------------------- construction
func _panel(name: String, parent: Node, gap := 14) -> VBoxContainer:
	var p := VBoxContainer.new()
	p.add_theme_constant_override("separation", gap)
	p.alignment = BoxContainer.ALIGNMENT_CENTER
	p.visible = false
	parent.add_child(p)
	_panels[name] = p
	return p

func _btn(parent: Node, text: String, cb: Callable, variation := "", width := 300.0) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(width, 0)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	if variation != "":
		b.theme_type_variation = variation
	b.pressed.connect(cb)
	parent.add_child(b)
	return b

func _hint(parent: Node, text: String) -> Label:
	var l := UiTheme.label(text, 13, Color("888888"), UiTheme.body())
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	parent.add_child(l)
	return l

func _build_title(col: Control) -> void:
	var p := _panel(UiStack.TITLE, col, 10)
	_btn(p, "NOUVELLE PARTIE", func() -> void: start_requested.emit(), "GoButton", 420).add_theme_font_size_override("font_size", 30)
	_summary = UiTheme.label("", 14, UiTheme.GOLD, UiTheme.body())
	_summary.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(_summary)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	p.add_child(grid)
	for e in [["SURVIVANT", func() -> void: open_menu()], ["CARTE ET DIFFICULTÉ", func() -> void: open_mapdiff()],
			["MEILLEURS SCORES", func() -> void: open_stats()], ["OPTIONS", func() -> void: open_options(UiStack.TITLE)],
			["TOUCHES", func() -> void: open_keys()], ["CRÉDITS", func() -> void: open_credits()]]:
		var b := _btn(grid, e[0], e[1], "SubButton", 205)
		b.add_theme_font_size_override("font_size", 19)
	var host := _btn(grid, "CRÉER SALON", func() -> void: pass, "SubButton", 205)
	host.disabled = true
	host.tooltip_text = "Le multijoueur arrive au jalon J12 du port."
	host.add_theme_font_size_override("font_size", 19)
	var join := _btn(grid, "REJOINDRE", func() -> void: pass, "SubButton", 205)
	join.disabled = true
	join.tooltip_text = "Le multijoueur arrive au jalon J12 du port."
	join.add_theme_font_size_override("font_size", 19)
	var q := _btn(p, "QUITTER LE JEU", func() -> void: quit_requested.emit(), "SubButton", 420)
	q.add_theme_font_size_override("font_size", 19)
	_hint(p, "Multijoueur : jalon J12 du port (salons non portés) · Échap : retour · Tab / flèches : naviguer")

func _build_menu(col: Control) -> void:
	var p := _panel(UiStack.MENU, col, 12)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 10)
	p.add_child(row)
	row.add_child(UiTheme.label("PSEUDO :", 18, Color("bbbbbb")))
	_name_edit = LineEdit.new()
	_name_edit.max_length = 12
	_name_edit.custom_minimum_size = Vector2(220, 0)
	_name_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_name_edit.text_changed.connect(func(t: String) -> void: settings.set_value("name", t if t != "" else "Joueur"))
	row.add_child(_name_edit)
	var grid := HFlowContainer.new()
	grid.alignment = FlowContainer.ALIGNMENT_CENTER
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.custom_minimum_size = Vector2(920, 0)
	p.add_child(grid)
	for i in CharacterDefs.LIST.size():
		var c: Dictionary = CharacterDefs.LIST[i]
		var card := Button.new()
		card.custom_minimum_size = Vector2(104, 96)
		card.toggle_mode = false
		var portrait := "res://assets/portraits/%s.png" % c["id"]   # cuit par tools/bake-portraits.mjs (renderPortraits du JS)
		if ResourceLoader.exists(portrait):
			card.icon = load(portrait)
			card.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
			card.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
			card.expand_icon = true
			card.add_theme_constant_override("icon_max_width", 96)
			card.custom_minimum_size = Vector2(104, 196)
		card.text = "%s\n%s" % [c["name"], c["role"]]
		card.add_theme_font_size_override("font_size", 13)
		card.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART   # « Le Purificateur » passe à la ligne : toutes les cartes font 104 px (une seule rangée de 8)
		card.add_theme_color_override("font_color", Color(String(c["accent"])))
		card.add_theme_color_override("font_hover_color", Color(String(c["accent"])).lightened(0.3))
		card.pressed.connect(func() -> void: settings.set_value("char", i))
		grid.add_child(card)
		_cards.append(card)
	_hint(p, "Le survivant et le pseudo sont gardés pour les prochaines parties.")
	_btn(p, "VALIDER", func() -> void: _back(), "GoButton", 240)

func _build_pause(col: Control) -> void:
	var p := _panel(UiStack.PAUSE, col)
	_btn(p, "REPRENDRE", func() -> void: _do_resume())
	_btn(p, "OPTIONS", func() -> void: open_options(UiStack.PAUSE), "SubButton")
	_btn(p, "TOUCHES", func() -> void: open_keys(), "SubButton")
	_btn(p, "MENU PRINCIPAL", func() -> void: title_requested.emit(), "SubButton")
	_hint(p, "Touches modifiables dans Options > Touches")

# ---------------------------------------------------------------- v0.14.0 : carte et difficulté, statistiques, crédits, chargement
func _heading(parent: Node, text: String, size := 36, color := UiTheme.GOLD) -> Label:
	var l := UiTheme.label(text, size, color, UiTheme.heading(), 5)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	parent.add_child(l)
	return l

func _card(parent: Node, text: String, w: float, h: float, cb: Callable) -> Button:
	var c := Button.new()
	c.text = text
	c.custom_minimum_size = Vector2(w, h)
	c.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	c.add_theme_font_size_override("font_size", 16)
	c.pressed.connect(cb)
	parent.add_child(c)
	return c

func _style_card(b: Button, on: bool, accent: Color) -> void:
	for st in ["normal", "hover", "pressed", "focus"]:
		var sb := UiTheme.box(Color(0.12, 0.12, 0.12, 0.8) if st == "hover" else Color(0, 0, 0, 0.55), accent if on else Color("444444"), 3 if on else 2, 6, 8)
		if st == "focus":
			sb.border_color = UiTheme.GOLD
			sb.set_border_width_all(3)
		b.add_theme_stylebox_override(st, sb)
	b.add_theme_color_override("font_color", accent if on else Color("cccccc"))
	b.add_theme_color_override("font_hover_color", accent.lightened(0.3) if on else Color.WHITE)
	b.add_theme_color_override("font_focus_color", accent if on else Color.WHITE)

func _build_mapdiff(col: Control) -> void:
	var p := _panel(UiStack.MAPDIFF, col, 12)
	_heading(p, "CARTE ET DIFFICULTÉ")
	_hint(p, "CARTE")
	var mrow := HBoxContainer.new()
	mrow.alignment = BoxContainer.ALIGNMENT_CENTER
	mrow.add_theme_constant_override("separation", 12)
	p.add_child(mrow)
	var descs := {"strasbourg": "La Grande Île au complet : portes, machines, véhicules, tram, cathédrale et fin de partie.", "arena": "Petite arène plate pour essayer les armes : pas de ville, de machines ni de véhicules."}
	for m: String in Settings.MAPS:
		_map_cards[m] = _card(mrow, "%s\n%s" % [MAP_NAMES[m], descs[m]], 340, 100, func() -> void: settings.set_value("map", m))
	_hint(p, "DIFFICULTÉ (vie et vitesse des zombies)")
	var drow := HBoxContainer.new()
	drow.alignment = BoxContainer.ALIGNMENT_CENTER
	drow.add_theme_constant_override("separation", 12)
	p.add_child(drow)
	for d: Dictionary in Difficulty.LIST:
		var id: String = d["id"]
		_diff_cards[id] = _card(drow, "%s\n%s" % [d["name"], d["desc"]], 224, 110, func() -> void: settings.set_value("difficulty", id))
	_hint(p, "Les statistiques sont comptées par difficulté (Strasbourg seulement).")
	_btn(p, "RETOUR", func() -> void: _back(), "GoButton", 240)

func _refresh_mapdiff() -> void:
	for m: String in _map_cards:
		_style_card(_map_cards[m], settings.get_value("map") == m, UiTheme.GOLD)
	for id: String in _diff_cards:
		_style_card(_diff_cards[id], settings.get_value("difficulty") == id, {"easy": Color("7cb342"), "normal": UiTheme.GOLD, "hard": Color("ff5544")}[id])

func _build_stats(col: Control) -> void:
	var p := _panel(UiStack.STATS, col, 10)
	_heading(p, "MEILLEURS SCORES ET STATISTIQUES")
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UiTheme.box(Color(0, 0, 0, 0.6), Color("444444"), 1, 6, 12))
	p.add_child(box)
	_stats_grid = GridContainer.new()
	_stats_grid.columns = 5
	_stats_grid.add_theme_constant_override("h_separation", 26)
	_stats_grid.add_theme_constant_override("v_separation", 6)
	box.add_child(_stats_grid)
	_stats_note = UiTheme.label("", 13, Color("888888"), UiTheme.body())
	_stats_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(_stats_note)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 14)
	p.add_child(row)
	_btn(row, "RETOUR", func() -> void: _back(), "GoButton", 220)
	_stats_reset = _btn(row, "REMETTRE À ZÉRO", func() -> void:
		stack.push(UiStack.CONFIRM)
		_sync(), "SubButton", 280)
	# confirmation (couche au-dessus de STATS)
	var c := _panel(UiStack.CONFIRM, col, 14)
	_heading(c, "TOUT EFFACER ?", 44, UiTheme.RED)
	var t := UiTheme.label("Toutes les statistiques (parties, victoires, records) seront effacées.\nCette action est définitive.", 18, Color("cccccc"), UiTheme.body())
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(t)
	_btn(c, "NON, GARDER", func() -> void: _back(), "GoButton", 320)
	_btn(c, "OUI, EFFACER", func() -> void:
		Game.stats.reset()
		stack.close(UiStack.CONFIRM)
		_render_stats()
		_sync(), "", 320)

func _render_stats() -> void:
	for c in _stats_grid.get_children():
		c.queue_free()
	var st: GameStats = Game.stats
	var tot := st.overall()
	var heads := ["", "FACILE", "NORMALE", "DIFFICILE", "TOTAL"]
	for h in heads:
		var l := UiTheme.label(h, 16, UiTheme.RED, UiTheme.heading())
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if h != "" else HORIZONTAL_ALIGNMENT_LEFT
		l.custom_minimum_size = Vector2(150 if h == "" else 110, 0)
		_stats_grid.add_child(l)
	var rows := [
		["Parties jouées", "games", ""], ["Victoires", "wins", ""], ["Meilleure manche", "best_round", ""], ["Plus de zombies tués", "best_kills", ""],
		["Meilleur score (points)", "best_points", ""], ["Plus longue survie", "best_time", "time"], ["Temps de jeu total", "total_time", "time"], ["Zombies tués (total)", "total_kills", ""],
	]
	for r: Array in rows:
		var name := UiTheme.label(String(r[0]), 16, Color("dddddd"), UiTheme.body())
		_stats_grid.add_child(name)
		var cells: Array = []
		for d in ["easy", "normal", "hard"]:
			cells.append(st.by_diff.get(d, GameStats.empty_entry()))
		cells.append(tot)
		for e: Dictionary in cells:
			var v: Variant = e[r[1]]
			var txt := GameStats.format_time(float(v)) if r[2] == "time" else str(int(v))
			if r[2] == "" and int(v) == 0:
				txt = "-"
			elif r[2] == "time" and float(v) <= 0.0:
				txt = "-"
			var l := UiTheme.label(txt, 16, UiTheme.GOLD if e == tot else Color.WHITE, UiTheme.body())
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			_stats_grid.add_child(l)
	_stats_note.text = "Aucune partie enregistrée pour le moment." if st.total_games() == 0 else "Enregistrées à la fin de chaque partie (mort, victoire, ou retour au menu). Fichier : %s" % ProjectSettings.globalize_path(st.path)
	_stats_reset.disabled = st.total_games() == 0

const CREDITS_TEXT := """[center][b]ZOMBIE SURVIVAL[/b]
Jeu de survie contre des zombies dans la Grande Île de Strasbourg.
Le jeu d'origine est écrit en [b]Three.js[/b] (dans le navigateur) ; cette version est un port vers le moteur Godot.[/center]

[b]Moteur[/b]
Godot Engine, licence MIT : https://godotengine.org
Copyright (c) 2014-present Godot Engine contributors ; (c) 2007-2014 Juan Linietsky, Ariel Manzur.

[b]Modèles d'armes[/b]
« Ultimate Gun Pack » (juillet 2019) par Quaternius, licence CC0 1.0 (domaine public) : 15 armes.
https://opengameart.org/content/low-poly-guns-pack  ·  https://quaternius.com
« Various Small Arms » par Tabasco, licence CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) : AK-47, M4A1, Dragunov SVD, Colt M1911 (couleurs retouchées).
https://opengameart.org/node/3609
« Blaster Kit » de Kenney (www.kenney.nl), licence CC0 : pistolet à rayons.
Barrett M82, M79 et arbalète : modèles construits pour le jeu (tools/build-weapons.py).

[b]Zombies[/b]
« Zombie Apocalypse Kit » par Quaternius : modèles et animations de zombies (normal, trapu, brute), CC0 d'après la page du pack au 18/10/2026 (assombris et salis pour le jeu).
https://quaternius.com/packs/zombieapocalypsekit.html

[b]Textures[/b]
Textures PBR de Poly Haven, licence CC0 : https://polyhaven.com/license

[b]Carte[/b]
Données cartographiques (c) les contributeurs d'OpenStreetMap, licence ODbL : https://www.openstreetmap.org/copyright

[b]Sons et musique[/b]
Sons synthétisés par le jeu d'origine puis pré-rendus ; musique du jeu, boucles par niveau d'intensité.

[b]Version[/b]
Port Godot v%s (Godot %s)"""

func _build_credits(col: Control) -> void:
	var p := _panel(UiStack.CREDITS, col, 10)
	_heading(p, "CRÉDITS")
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UiTheme.box(Color(0, 0, 0, 0.6), Color("444444"), 1, 6, 12))
	p.add_child(box)
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(800, 380)
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.focus_mode = Control.FOCUS_ALL   # flèches haut / bas pour faire défiler
	box.add_child(sc)
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.custom_minimum_size = Vector2(780, 0)
	r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.add_theme_font_size_override("normal_font_size", 16)
	r.add_theme_font_size_override("bold_font_size", 17)
	r.add_theme_color_override("default_color", Color("cccccc"))
	r.add_theme_font_override("normal_font", UiTheme.body())
	r.add_theme_font_override("bold_font", UiTheme.heading())
	r.text = CREDITS_TEXT % [Game.version(), Engine.get_version_info()["string"]]
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sc.add_child(r)
	_btn(p, "RETOUR", func() -> void: _back(), "GoButton", 240)

func _build_loading(col: Control) -> void:
	var p := _panel(UiStack.LOADING, col, 14)
	_heading(p, "CHARGEMENT", 48, UiTheme.RED)
	_loading_text = UiTheme.label("", 20, Color("dddddd"), UiTheme.body())
	_loading_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(_loading_text)
	_loading_bar = ProgressBar.new()
	_loading_bar.custom_minimum_size = Vector2(520, 22)
	_loading_bar.min_value = 0.0
	_loading_bar.max_value = 1.0
	_loading_bar.step = 0.001
	_loading_bar.show_percentage = true
	_loading_bar.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var fill := UiTheme.box(UiTheme.RED, Color(0, 0, 0, 0), 0, 3, 0)
	_loading_bar.add_theme_stylebox_override("fill", fill)
	_loading_bar.add_theme_stylebox_override("background", UiTheme.box(Color(1, 1, 1, 0.12), Color("555555"), 1, 3, 0))
	p.add_child(_loading_bar)
	_hint(p, "Strasbourg se prépare…")


func _slider_row(parent: Node, key: String, label: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	parent.add_child(row)
	var l := UiTheme.label(label, 15, Color("dddddd"), UiTheme.body())
	l.custom_minimum_size = Vector2(130, 0)
	row.add_child(l)
	var s := HSlider.new()
	var r: Array = Settings.RANGES[key]
	s.min_value = float(r[0])
	s.max_value = float(r[1])
	s.step = float(r[2])
	s.custom_minimum_size = Vector2(220, 22)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.value = float(settings.get_value(key))
	s.value_changed.connect(func(v: float) -> void: settings.set_value(key, v))
	row.add_child(s)
	var o := UiTheme.label(Settings.format(key, s.value), 15, UiTheme.GOLD, UiTheme.body())
	o.custom_minimum_size = Vector2(60, 0)
	o.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(o)
	_opt_sliders[key] = s
	_opt_values[key] = o

func _build_options(col: Control) -> void:
	var p := _panel(UiStack.OPTIONS, col, 8)
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UiTheme.box(Color(0, 0, 0, 0.5), Color("444444"), 1, 6, 14))
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 8)
	box.add_child(inner)
	p.add_child(box)
	for pair in [["brightness", "Luminosité"], ["fov", "Champ de vision"], ["sens", "Sensibilité"], ["quality", "Qualité"], ["upscaler", "Mise à l'échelle"], ["res_scale", "Résolution 3D"], ["sharp", "Netteté"], ["volume", "Volume"], ["music", "Musique"]]:
		_slider_row(inner, pair[0], pair[1])
	for pair in [["chat", "AFFICHER LE CHAT"], ["cinema", "EFFETS CINÉMA"], ["halo", "HALO (HAUTE)"]]:
		var key: String = pair[0]
		var b := _btn(inner, "", func() -> void: settings.set_value(key, not bool(settings.get_value(key))), "SubButton")
		b.add_theme_font_size_override("font_size", 18)
		_btn_toggles[key] = [b, pair[1]]
	var kb := _btn(inner, "TOUCHES", func() -> void: open_keys(), "SubButton")
	kb.add_theme_font_size_override("font_size", 18)
	_btn_fs = _btn(inner, "", func() -> void: _toggle_fullscreen(), "SubButton")
	_btn_fs.add_theme_font_size_override("font_size", 18)
	_btn(inner, "RETOUR", func() -> void: _back(), "SubButton")

func _build_keys(col: Control) -> void:
	var p := _panel(UiStack.KEYS, col, 8)
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UiTheme.box(Color(0, 0, 0, 0.88), Color("444444"), 1, 6, 12))
	box.custom_minimum_size = Vector2(960, 0)
	p.add_child(box)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 8)
	box.add_child(inner)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	inner.add_child(head)
	var t := UiTheme.label("TOUCHES", 26, UiTheme.GOLD, UiTheme.heading())
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	_keys_all = _btn(head, "TOUT RÉINITIALISER", func() -> void:
		if binds.any_changed():
			_cap = ""
			_pending = {}
			binds.reset_all()
			_msg = {"text": "Toutes les touches ont été remises par défaut.", "kind": "ok"}
			_render_keys(), "SubButton", 0)
	_keys_all.add_theme_font_size_override("font_size", 14)
	var back := _btn(head, "RETOUR", func() -> void: _back(), "SubButton", 0)
	back.add_theme_font_size_override("font_size", 14)
	_keys_scroll = ScrollContainer.new()
	_keys_scroll.custom_minimum_size = Vector2(0, 430)
	_keys_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	inner.add_child(_keys_scroll)
	_keys_list = HBoxContainer.new()
	_keys_list.add_theme_constant_override("separation", 28)
	_keys_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_keys_scroll.add_child(_keys_list)
	var sp := PanelContainer.new()
	sp.add_theme_stylebox_override("panel", UiTheme.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 0, 4, 6))
	inner.add_child(sp)
	var srow := HBoxContainer.new()
	srow.add_theme_constant_override("separation", 10)
	sp.add_child(srow)
	_keys_status = RichTextLabel.new()
	_keys_status.bbcode_enabled = true
	_keys_status.fit_content = true
	_keys_status.scroll_active = false
	_keys_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_keys_status.custom_minimum_size = Vector2(0, 40)
	_keys_status.add_theme_font_size_override("normal_font_size", 14)
	_keys_status.add_theme_font_override("normal_font", UiTheme.body())
	_keys_status.add_theme_font_override("bold_font", UiTheme.body())
	_keys_status.add_theme_font_size_override("bold_font_size", 14)
	srow.add_child(_keys_status)
	_keys_actions = HBoxContainer.new()
	_keys_actions.add_theme_constant_override("separation", 8)
	srow.add_child(_keys_actions)

func _build_over(col: Control) -> void:
	var p := _panel(UiStack.OVER, col)
	_over_title = UiTheme.label("ÉQUIPE ÉLIMINÉE", 68, UiTheme.RED, UiTheme.heading(), 8)
	_over_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(_over_title)
	_over_text = _rich(p)
	_btn(p, "REJOUER", func() -> void: restart_requested.emit())
	_btn(p, "MENU PRINCIPAL", func() -> void: title_requested.emit(), "SubButton")

func _build_victory(col: Control) -> void:
	var p := _panel(UiStack.VICTORY, col)
	_victory_title = UiTheme.label("VICTOIRE !", 68, UiTheme.GOLD, UiTheme.heading(), 8)
	_victory_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(_victory_title)
	_victory_text = _rich(p)
	_btn(p, "CONTINUER", func() -> void: escape())
	_btn(p, "MENU PRINCIPAL", func() -> void: title_requested.emit(), "SubButton")

func _rich(parent: Node) -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.custom_minimum_size = Vector2(760, 0)
	r.add_theme_font_size_override("normal_font_size", 18)
	r.add_theme_color_override("default_color", Color("cccccc"))
	r.add_theme_font_override("normal_font", UiTheme.body())
	r.add_theme_font_override("bold_font", UiTheme.body())
	r.add_theme_font_size_override("bold_font_size", 18)
	r.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(r)
	return r

# ---------------------------------------------------------------- ouverture des écrans
func open_title() -> void:
	in_game = false
	_cap = ""
	_pending = {}
	stack.clear()
	stack.push(UiStack.TITLE)
	_sync()

func open_menu() -> void:
	stack.push(UiStack.MENU)
	_name_edit.text = String(settings.get_value("name"))
	_refresh_cards()
	_sync()

func open_mapdiff() -> void:
	stack.push(UiStack.MAPDIFF)
	_refresh_mapdiff()
	_sync()

func open_stats() -> void:
	stack.push(UiStack.STATS)
	_render_stats()
	_sync()

func open_credits() -> void:
	stack.push(UiStack.CREDITS)
	_sync()

## Écran de chargement (après NOUVELLE PARTIE) : remplace tout, Échap n'y fait rien. frac : 0..1.
func show_loading(text: String, frac: float) -> void:
	in_game = false
	if not stack.has(UiStack.LOADING):
		_cap = ""
		_pending = {}
		stack.clear()
		stack.push(UiStack.LOADING)
		_sync()
	_loading_text.text = text
	_loading_bar.value = frac

func open_pause() -> void:
	if stack.has(UiStack.PAUSE):
		return
	stack.close(UiStack.MAP)
	stack.push(UiStack.PAUSE)
	_sync()

func open_options(back_to: String) -> void:
	_options_back = back_to
	stack.push(UiStack.OPTIONS)
	_sync()

func open_keys() -> void:
	_cap = ""
	_pending = {}
	_msg = {}
	stack.push(UiStack.KEYS)
	_render_keys()
	_sync()

func show_over(subtitle: String) -> void:
	stack.close(UiStack.MAP)
	_over_text.text = subtitle
	stack.clear()
	stack.push(UiStack.OVER)
	_sync()

func show_victory(title: String, subtitle: String) -> void:
	_victory_title.text = title
	_victory_text.text = subtitle
	stack.close(UiStack.MAP)
	stack.push(UiStack.VICTORY)
	_sync()

func toggle_map() -> void:
	if stack.has(UiStack.MAP):
		stack.close(UiStack.MAP)
	elif not stack.blocks_game():
		stack.push(UiStack.MAP)
	_sync()

func close_all() -> void:
	_cap = ""
	_pending = {}
	stack.clear()
	_sync()

## La partie est lancée (SOLO) ou reprise.
func begin_game() -> void:
	in_game = true
	close_all()

func _do_resume() -> void:
	stack.close(UiStack.PAUSE)
	_sync()
	resume_requested.emit()

func _back() -> void:
	escape()

## La fenêtre perd le focus : en pleine partie (aucune couche ouverte), pause. Renvoie true si la pause vient d'être ouverte.
func focus_lost() -> bool:
	if in_game and Game.playing and not Game.over and stack.layers.is_empty():
		escape()
		return true
	return false

# ---------------------------------------------------------------- Échap
## Renvoie l'action exécutée (voir UiStack.escape).
func escape() -> String:
	if Game.debug_open:   # le menu debug se ferme d'abord (debugMenu.js : Échap)
		Game.debug_open = false
		return "debug"
	if Game.finale != null and Game.finale.orbit_on and not stack.blocks_game():   # vue orbitale de l'Aube : Échap la passe (l'écran « STRASBOURG LIBÉRÉE » suit)
		Game.finale.end_orbit()
		return "orbit"
	var action := stack.escape(in_game and not Game.over)
	match action:
		"cancel_capture":
			var was := _cap != "" or not _pending.is_empty()
			_cap = ""
			_pending = {}
			_msg = {"text": "Annulé : aucune touche modifiée.", "kind": ""} if was else {}
			_render_keys()
		"resume":
			resume_requested.emit()
		"continue":
			resume_requested.emit()
	_sync()
	return action

# ---------------------------------------------------------------- affichage
## Montre le panneau de la couche pleine du dessus ; la carte laisse le jeu visible.
func _sync() -> void:
	var panel_layer := ""
	for l in stack.layers:
		if _panels.has(l):
			panel_layer = l
	if panel_layer in [UiStack.CAPTURE, UiStack.CONFLICT]:
		panel_layer = UiStack.KEYS
	for k: String in _panels:
		_panels[k].visible = (k == panel_layer)
	var full := stack.blocks_game()
	_dim.visible = full
	_dim.color = Color(0, 0, 0, 0.9) if panel_layer == UiStack.KEYS else Color(0, 0, 0, 0.76)
	var show_head := panel_layer in [UiStack.TITLE, UiStack.MENU, UiStack.PAUSE, UiStack.OPTIONS]
	backdrop.set_active(not in_game)   # le fond léger n'existe que tant qu'aucune partie n'est affichée derrière le menu
	if not in_game and full and panel_layer != UiStack.KEYS:
		_dim.color = Color(0, 0, 0, 0.1 if panel_layer in [UiStack.TITLE, UiStack.LOADING] else 0.45)
	_title.visible = show_head
	_text.visible = show_head
	match panel_layer:
		UiStack.TITLE:
			_title.text = "ZOMBIE SURVIVAL"
			_text.text = "Survivez à la nuit de Strasbourg."
			_refresh_summary()
		UiStack.MENU:
			_title.text = "ZOMBIE SURVIVAL"
			_text.text = "Choisissez votre survivant."
		UiStack.PAUSE:
			_title.text = "PAUSE"
			_text.text = "Jeu en pause."
		UiStack.OPTIONS:
			_title.text = "OPTIONS"
			_text.text = ""
	map_view.visible = stack.has(UiStack.MAP)
	if panel_layer == UiStack.OPTIONS:
		_sync_options()
	_focus_first(panel_layer)
	layers_changed.emit()

func _refresh_summary() -> void:
	var m := String(settings.get_value("map"))
	_summary.text = "%s  ·  %s  ·  %s" % [String(CharacterDefs.of_slot(int(settings.get_value("char")))["name"]), MAP_NAMES.get(m, m), Difficulty.name_of(String(settings.get_value("difficulty")))]

## Donne le focus clavier / manette au premier contrôle utile du panneau affiché (sauf Touches : la capture d'une touche ne doit pas déclencher un bouton).
func _focus_first(panel_layer: String) -> void:
	if not _panels.has(panel_layer) or panel_layer == UiStack.KEYS or panel_layer == UiStack.LOADING or not is_inside_tree():
		return
	var fo := get_viewport().gui_get_focus_owner()
	if fo != null and _panels[panel_layer].is_ancestor_of(fo) and fo.is_visible_in_tree():
		return
	var first := _first_focusable(_panels[panel_layer])
	if first != null:
		first.call_deferred("grab_focus")

func _first_focusable(n: Node) -> Control:
	for c in n.get_children():
		if c is Control and not c.visible:
			continue
		if c is BaseButton and not (c as BaseButton).disabled and c.focus_mode != Control.FOCUS_NONE:
			return c
		if c is Slider and c.focus_mode != Control.FOCUS_NONE:
			return c
		var r := _first_focusable(c)
		if r != null:
			return r
	return null

func _sync_options() -> void:
	for key: String in _opt_sliders:
		var v := float(settings.get_value(key))
		_opt_sliders[key].set_value_no_signal(v)
		_opt_values[key].text = Settings.format(key, v)
	for key: String in _btn_toggles:
		var d: Array = _btn_toggles[key]
		(d[0] as Button).text = "%s : %s" % [d[1], "OUI" if bool(settings.get_value(key)) else "NON"]
	_btn_fs.text = "PLEIN ÉCRAN : %s" % ("OUI" if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN else "NON")

func _on_setting(key: String) -> void:
	if _opt_values.has(key):
		_opt_values[key].text = Settings.format(key, float(settings.get_value(key)))
	if _btn_toggles.has(key) or _opt_sliders.has(key):
		_sync_options()
	if key == "char":
		_refresh_cards()
	if key in ["char", "map", "difficulty"]:
		_refresh_summary()
		_refresh_mapdiff()

func _refresh_cards() -> void:
	var sel := int(settings.get_value("char"))
	for i in _cards.size():
		var c: Dictionary = CharacterDefs.LIST[i]
		var accent := Color(String(c["accent"]))
		var on := i == sel
		var b: Button = _cards[i]
		for st in ["normal", "hover", "pressed", "focus"]:
			var sb := UiTheme.box(Color(0, 0, 0, 0.55), accent if on else Color("444444"), 3 if on else 2, 6, 6)
			if st == "hover":
				sb.bg_color = Color(0.12, 0.12, 0.12, 0.8)
			b.add_theme_stylebox_override(st, sb)

func _toggle_fullscreen() -> void:
	var fs := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fs else DisplayServer.WINDOW_MODE_FULLSCREEN)
	_sync_options()

# ---------------------------------------------------------------- Options > Touches
func _nm(id: String) -> String:
	var s := String(binds.by_id[id]["label"])
	var i := s.find(" (")
	return s.substr(0, i) if i >= 0 else s

func _render_keys() -> void:
	if _keys_list == null:
		return
	var top := _keys_scroll.scroll_vertical
	for c in _keys_list.get_children():
		c.queue_free()
	var groups: Array = []
	for d: Dictionary in binds.defs:
		var g: Variant = null
		for x: Dictionary in groups:
			if x["name"] == d["group"]:
				g = x
		if g == null:
			g = {"name": d["group"], "rows": []}
			groups.append(g)
		g["rows"].append(d)
	groups.append({"name": "Fixes (non modifiables)", "rows": [], "fixed": true})
	var cols := [VBoxContainer.new(), VBoxContainer.new()]
	for c: VBoxContainer in cols:
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.add_theme_constant_override("separation", 4)
		_keys_list.add_child(c)
	var total := 0
	for g: Dictionary in groups:
		total += (g["rows"] as Array).size() + 1 if not g.get("fixed", false) else Config.at("fixedKeys", []).size() + 2
	var acc := 0
	for g: Dictionary in groups:
		var n: int = (g["rows"] as Array).size() + 1 if not g.get("fixed", false) else Config.at("fixedKeys", []).size() + 2
		var target: VBoxContainer = cols[0] if acc + n / 2 < total / 2 else cols[1]
		acc += n
		if target.get_child_count() > 0:
			var gap := Control.new()
			gap.custom_minimum_size = Vector2(0, 8)
			target.add_child(gap)
		var h := UiTheme.label(String(g["name"]).to_upper(), 13, UiTheme.RED, UiTheme.heading())
		target.add_child(h)
		if g.get("fixed", false):
			_fixed_row(target, "Déplacement (en plus des touches ci-dessus)", "↑ ↓ ← →")
			for kv: Array in Config.at("fixedKeys", []):
				_fixed_row(target, String(kv[1]), String(kv[0]))
			continue
		for d: Dictionary in g["rows"]:
			var id: String = d["id"]
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)
			target.add_child(row)
			var l := UiTheme.label(String(d["label"]), 14, Color("dddddd"), UiTheme.body())
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l.custom_minimum_size = Vector2(160, 0)
			if _pending.get("other", "") == id:
				l.add_theme_color_override("font_color", Color("ff7a6a"))
			row.add_child(l)
			var kb := Button.new()
			kb.custom_minimum_size = Vector2(150, 0)
			kb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			kb.text = "Appuyez sur une touche…" if _cap == id else binds.label(id)
			kb.add_theme_font_size_override("font_size", 14)
			var changed := not binds.is_default(id)
			var fc := Color.WHITE
			var bg := Color("2a2f36")
			var bd := Color("667766")
			if _cap == id:
				fc = Color("111111")
				bg = UiTheme.GOLD
				bd = Color.WHITE
			elif _pending.get("id", "") == id:
				fc = UiTheme.GOLD
				bd = UiTheme.GOLD
			elif _pending.get("other", "") == id:
				bg = Color("6a1414")
				bd = Color("ff5555")
			elif changed:
				fc = UiTheme.GOLD
				bd = Color("8a6d1a")
			for st in ["normal", "hover", "pressed", "focus"]:
				kb.add_theme_stylebox_override(st, UiTheme.box(bg if st != "hover" else bg.lightened(0.15), bd, 1, 4, 3))
			for cn in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
				kb.add_theme_color_override(cn, fc)
			kb.tooltip_text = "%s fonctionne aussi tant qu'elle ne sert pas à autre chose" % binds.code_name(String(d["alt"])) if d.has("alt") else ""
			kb.pressed.connect(func() -> void: _start_capture(id))
			row.add_child(kb)
			var rb := Button.new()
			rb.text = "Réinitialiser"
			rb.add_theme_font_size_override("font_size", 12)
			rb.disabled = not changed
			rb.custom_minimum_size = Vector2(84, 0)
			rb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			rb.tooltip_text = "Remettre %s" % binds.name_of(String(d["def"]))
			rb.theme_type_variation = "SubButton"
			rb.pressed.connect(func() -> void: _reset_one(id))
			row.add_child(rb)
	_keys_all.disabled = not binds.any_changed()
	_render_status()
	_keys_scroll.set_deferred("scroll_vertical", top)

func _fixed_row(parent: Control, label: String, key: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var l := UiTheme.label(label, 14, Color("aaaaaa"), UiTheme.body())
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(160, 0)
	row.add_child(l)
	var k := UiTheme.label(key, 14, Color("aaaaaa"), UiTheme.body())
	k.custom_minimum_size = Vector2(150, 0)
	k.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	row.add_child(k)
	var sp := Control.new()
	sp.custom_minimum_size = Vector2(84, 0)
	row.add_child(sp)

func _render_status() -> void:
	for c in _keys_actions.get_children():
		c.queue_free()
	var color := "bbbbbb"
	var txt := ""
	if not _pending.is_empty():
		color = "ffd24a"
		var k := binds.name_of(String(_pending["binding"]))
		var take := binds.name_of(binds.get_binding(String(_pending["id"])))
		var o := _nm(String(_pending["other"]))
		var head := ("Par défaut, « %s » est sur [b]%s[/b] par « %s »." % [_nm(String(_pending["id"])), k, o]) if _pending.get("reset", false) else ("La touche [b]%s[/b] est déjà utilisée par « %s »." % [k, o])
		txt = "%s Échanger : « %s » prendrait [b]%s[/b]." % [head, o, take]
		var sw := Button.new()
		sw.text = "ÉCHANGER"
		sw.theme_type_variation = "SubButton"
		sw.add_theme_font_size_override("font_size", 14)
		sw.pressed.connect(_do_swap)
		_keys_actions.add_child(sw)
		var no := Button.new()
		no.text = "ANNULER"
		no.theme_type_variation = "SubButton"
		no.add_theme_font_size_override("font_size", 14)
		no.pressed.connect(func() -> void: escape())
		_keys_actions.add_child(no)
	elif _cap != "":
		color = {"ok": "9fd27a", "err": "ff7a6a"}.get(_msg.get("kind", ""), "ffd24a")
		txt = "%sAppuyez sur la nouvelle touche pour « %s » · Échap : annuler." % [(String(_msg["text"]) + " ") if not _msg.is_empty() else "", _nm(_cap)]
	elif not _msg.is_empty():
		color = {"ok": "9fd27a", "warn": "ffd24a", "err": "ff7a6a"}.get(_msg.get("kind", ""), "bbbbbb")
		txt = String(_msg["text"])
	else:
		txt = "Cliquez sur une touche pour la modifier. Les changements sont immédiats et gardés sur cet appareil."
	_keys_status.text = "[color=#%s]%s[/color]" % [color, txt]

func _start_capture(id: String) -> void:
	if _cap == id:
		_cap = ""
		stack.close(UiStack.CAPTURE)
		_msg = {"text": "Annulé : aucune touche modifiée.", "kind": ""}
	else:
		_cap = id
		_pending = {}
		_msg = {}
		stack.close(UiStack.CONFLICT)
		stack.push(UiStack.CAPTURE)
	_render_keys()

func _reset_one(id: String) -> void:
	if binds.is_default(id):
		return
	_cap = ""
	stack.close(UiStack.CAPTURE)
	_apply_binding(id, String(binds.by_id[id]["def"]), {}, true)

## Applique une liaison ; en cas de conflit, pose la question d'échange (ou refuse s'il y en a plusieurs).
func _apply_binding(id: String, binding: String, ev: Dictionary, reset: bool) -> void:
	if binding == binds.get_binding(id):
		_cap = ""
		stack.close(UiStack.CAPTURE)
		_msg = {"text": "« %s » reste sur %s." % [_nm(id), binds.name_of(binding)], "kind": ""}
		_render_keys()
		return
	var others := binds.conflicts(id, binding, ev)
	if others.size() > 1:
		var names := PackedStringArray()
		for o in others:
			names.append("« %s »" % _nm(o))
		_msg = {"text": "%s est déjà utilisée par %s : libérez-en une d'abord, ou choisissez une autre touche." % [binds.name_of(binding), " et ".join(names)], "kind": "err"}
		_render_keys()
		return
	if others.size() == 1:
		_cap = ""
		stack.close(UiStack.CAPTURE)
		_pending = {"id": id, "binding": binding, "other": others[0], "reset": reset}
		stack.push(UiStack.CONFLICT)
		_msg = {}
		_render_keys()
		return
	_cap = ""
	_pending = {}
	stack.close(UiStack.CAPTURE)
	binds.set_binding(id, binding)
	_msg = {"text": "« %s » : %s." % [_nm(id), binds.name_of(binding)], "kind": "ok"}
	_render_keys()

func _do_swap() -> void:
	if _pending.is_empty():
		return
	var p := _pending
	var other_old := binds.name_of(binds.get_binding(String(p["id"])))
	stack.close(UiStack.CONFLICT)
	_pending = {}
	if not binds.swap(String(p["id"]), String(p["binding"]), String(p["other"])):
		_msg = {"text": "Échange impossible : « %s » créerait un autre doublon." % _nm(String(p["other"])), "kind": "err"}
	else:
		_msg = {"text": "Échangé : « %s » %s · « %s » %s." % [_nm(String(p["id"])), binds.label(String(p["id"])), _nm(String(p["other"])), other_old], "kind": "ok"}
	_render_keys()
	_sync()

# ---------------------------------------------------------------- entrées
func _input(event: InputEvent) -> void:
	if event is InputEventJoypadButton and event.is_action_pressed("ui_cancel") and stack.blocks_game():   # manette : B = retour
		escape()
		get_viewport().set_input_as_handled()
		return
	if not (event is InputEventKey):
		return
	var e := event as InputEventKey
	if not e.pressed:
		if _swallow_up != "" and Keybinds.code_of(e) == _swallow_up:
			_swallow_up = ""
			get_viewport().set_input_as_handled()   # le relâchement de la touche capturée n'arrive pas au jeu
		return
	if e.echo:
		return
	var code := Keybinds.code_of(e)
	if code == "Escape":
		escape()
		get_viewport().set_input_as_handled()
		return
	if _cap != "":   # capture : toutes les autres touches sont consommées ici
		get_viewport().set_input_as_handled()
		_swallow_up = code
		var r := binds.from_event(_cap, e)
		if r.has("error"):
			_msg = {"text": String(r["error"]), "kind": "err"}
			_render_keys()
			return
		_apply_binding(_cap, String(r["binding"]), r, false)
		_sync()
		return
	if binds.is_event("map", e) and in_game and not Game.over and not stack.blocks_game() and not (get_viewport().gui_get_focus_owner() is LineEdit):
		toggle_map()
		get_viewport().set_input_as_handled()
