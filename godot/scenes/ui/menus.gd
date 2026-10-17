extends CanvasLayer
## Menus (index.html #overlay + src/ui.js + src/keysMenu.js) : titre, choix du personnage (Solo), pause, options, Options > Touches, équipe
## éliminée, victoire, et la carte plein écran. La pile des couches est un UiStack ; Échap ferme la couche du dessus. Cette scène ne touche pas à
## la partie : elle émet des signaux (start_requested, resume_requested, restart_requested, title_requested, layers_changed) que main.gd exécute.

signal start_requested
signal resume_requested
signal restart_requested
signal title_requested
signal layers_changed
signal quit_requested

const MapView := preload("res://scenes/ui/map_view.gd")

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
	var p := _panel(UiStack.TITLE, col)
	_btn(p, "JOUER", func() -> void: open_menu())
	_btn(p, "OPTIONS", func() -> void: open_options(UiStack.TITLE), "SubButton")
	_btn(p, "QUITTER LE JEU", func() -> void: quit_requested.emit(), "SubButton")
	_hint(p, "Touches modifiables dans Options")

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
	var btns := HBoxContainer.new()
	btns.alignment = BoxContainer.ALIGNMENT_CENTER
	btns.add_theme_constant_override("separation", 14)
	p.add_child(btns)
	_btn(btns, "SOLO", func() -> void: start_requested.emit(), "", 220)
	var host := _btn(btns, "CRÉER SALON CO-OP", func() -> void: pass, "SubButton", 280)
	host.disabled = true
	host.tooltip_text = "Le multijoueur arrive au jalon J12 du port."
	var join := HBoxContainer.new()
	join.alignment = BoxContainer.ALIGNMENT_CENTER
	join.add_theme_constant_override("separation", 8)
	p.add_child(join)
	var code := LineEdit.new()
	code.placeholder_text = "CODE (ABCD)"
	code.max_length = 4
	code.editable = false
	code.custom_minimum_size = Vector2(170, 0)
	join.add_child(code)
	var jb := Button.new()
	jb.text = "REJOINDRE"
	jb.theme_type_variation = "SubButton"
	jb.disabled = true
	join.add_child(jb)
	_hint(p, "Multijoueur : jalon J12 du port (les salons ne sont pas encore portés)")
	_btn(p, "RETOUR", func() -> void: _back(), "SubButton", 200)

func _build_pause(col: Control) -> void:
	var p := _panel(UiStack.PAUSE, col)
	_btn(p, "REPRENDRE", func() -> void: _do_resume())
	_btn(p, "OPTIONS", func() -> void: open_options(UiStack.PAUSE), "SubButton")
	_btn(p, "QUITTER", func() -> void: title_requested.emit(), "SubButton")
	_hint(p, "Touches modifiables dans Options > Touches")

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
	for pair in [["brightness", "Luminosité"], ["fov", "Champ de vision"], ["sens", "Sensibilité"], ["quality", "Qualité"], ["volume", "Volume"], ["music", "Musique"]]:
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
	_title.visible = show_head
	_text.visible = show_head
	match panel_layer:
		UiStack.TITLE:
			_title.text = "ZOMBIE SURVIVAL"
			_text.text = "Survivez à la nuit de Strasbourg."
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
	layers_changed.emit()

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
