extends CanvasLayer
## HUD complet de J7 (index.html + src/hud.js) : radar, boussole et zone, manche / points / atouts, arme, inventaire, munitions, santé,
## grenades, bonus actifs, tableau de bord du véhicule, invite, annonce, popups de points, marqueur de touche, voile des dégâts, éclair de la
## Bombe, barre de boss, bandeau, marque de la Sentence, Fanal, vue « à terre », message discret, effets cinéma. Ne fait que lire `Game` :
## les calculs sont dans HudCalc et Prompts. Les cartes des coéquipiers et le badge du salon arrivent avec le réseau (J12).

const Radar := preload("res://scenes/ui/radar.gd")
const Compass := preload("res://scenes/ui/compass.gd")
const HURT_FADE := 1.5
const POPUP_TIME := 0.9
const ANNOUNCE_FADE := 0.6

## Barre horizontale (fond sombre, bordure grise, remplissage, repère facultatif).
class Bar extends Control:
	var frac := 1.0
	var color := Color("c22")
	var tick := -1.0
	var border := Color("555555")
	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.6))
		draw_rect(Rect2(1, 1, maxf(0.0, (size.x - 2) * clampf(frac, 0.0, 1.0)), size.y - 2), color)
		draw_rect(Rect2(0.5, 0.5, size.x - 1, size.y - 1), border, false, 1.0)
		if tick >= 0.0:
			draw_rect(Rect2(size.x * tick - 1, -3, 2, size.y + 6), Color.WHITE)
	func set_bar(f: float, c: Color) -> void:
		frac = f
		color = c
		queue_redraw()

## Marqueur de touche : deux traits en croix de 45 degrés, rouge quand le zombie meurt.
class Hitmarker extends Control:
	var kill := false
	var a := 0.0
	func _draw() -> void:
		var c := Color(1, 0.2, 0.2, a) if kill else Color(1, 1, 1, a)
		var s := 10.0 * (0.9 + 0.5 * a)
		draw_line(Vector2(-s, -s), Vector2(s, s), c, 2.0)
		draw_line(Vector2(-s, s), Vector2(s, -s), c, 2.0)

## Réticule : quatre traits blancs autour du centre.
class Crosshair extends Control:
	func _draw() -> void:
		for r: Rect2 in [Rect2(-1, -14, 2, 8), Rect2(-1, 6, 2, 8), Rect2(-14, -1, 8, 2), Rect2(6, -1, 8, 2)]:
			draw_rect(Rect2(r.position + Vector2(1, 1), r.size), Color(0, 0, 0, 0.7))
			draw_rect(r, Color.WHITE)

var binds: Keybinds
var root: Control
var radar: Control
var compass: Control
var _vignette: ColorRect
var _flash: ColorRect
var _cinema: ColorRect
var _crosshair: Control
var _hit: Hitmarker
var _round_num: Label
var _points: Label
var _perks_row: HBoxContainer
var _weapon: Label
var _caliber: Label
var _inv: Label
var _ammo: Label
var _health: Bar
var _nades: Label
var _zone: Label
var _map_hint: Label
var _prompt: PanelContainer
var _prompt_l: Label
var _prompt_icon: PromptIcon      ## v0.28.0 : icon of the prompt (weapon silhouette, cartridges, machine, door)
var _prompt_price: Label          ## v0.28.0 : price apart, gold or red (not enough points)
var _announce: Label
var _announce_sub: Label
var _buffs: HBoxContainer
var _buff_labels: Dictionary = {}
var _veh: VBoxContainer
var _v_switch: PanelContainer
var _v_switch_l: Label
var _v_speedo: Label
var _v_speed: Bar
var _v_hp_row: HBoxContainer
var _v_hp: Bar
var _v_hp_txt: Label
var _v_hp_name: Label
var _v_fuel_row: HBoxContainer
var _v_fuel: Bar
var _v_fuel_txt: Label
var _v_fuel_name: Label
var _banner: PanelContainer
var _banner_l: Label
var _boss: VBoxContainer
var _boss_name: Label
var _boss_bar: Bar
var _boss_inv: Label
var _mark: PanelContainer
var _mark_l: Label
var _fanal: VBoxContainer
var _fanal_l: Label
var _fanal_bar: Bar
var _down: VBoxContainer
var _down_sec: Label
var _down_sub: Label
var _down_extra: Label
var _clock: Label          ## v0.25.0 : heure du jeu et moment de la journée (sous le radar), en cycle Auto
var _exit_l: Label         ## v0.26.0 : Zone unique : « SORTIE 4 250 / 20 000 » au-dessus des points
var _toast: PanelContainer
var _toast_l: Label
var _announce_t := 0.0
var intro_hold := false     ## intro de boss en cours : bandeau d'annonce et barre de boss masqués (gelés)
var _announce_len := 3.0
var _hurt := 0.0
var _nuke := 0.0
var _toast_t := 0.0
var _perk_key := "?"
var _inv_key := "?"
var _boss_ticks: Array = []
var _low := 0.0

func _ready() -> void:
	layer = 10
	binds = Game.settings.binds
	root = Control.new()
	UiTheme.fill_rect(root)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UiTheme.make_theme()
	add_child(root)
	_build_cinema()
	_build_overlays()
	_build_top()
	_build_left()
	_build_right()
	_build_center()
	_build_vehicle()
	_build_finale()
	Game.points_gained.connect(_on_points)
	Game.hit_confirmed.connect(show_hit)
	Game.powerup_collected.connect(_on_powerup)
	Game.player_hurt.connect(func(_a: float) -> void: hurt_flash())
	Game.settings.changed.connect(func(k: String) -> void:
		if k == "cinema":
			_cinema.visible = bool(Game.settings.get_value("cinema")))
	binds.changed.connect(refresh_keys)
	_cinema.visible = bool(Game.settings.get_value("cinema"))
	refresh_keys()

func _lbl(parent: Node, text: String, size: int, color: Color, align := HORIZONTAL_ALIGNMENT_LEFT, heading := true) -> Label:
	var l := UiTheme.label(text, size, color, UiTheme.heading() if heading else UiTheme.body(), 5)
	l.horizontal_alignment = align as HorizontalAlignment
	parent.add_child(l)
	return l

# ---------------------------------------------------------------- construction
func _build_cinema() -> void:
	_cinema = ColorRect.new()
	UiTheme.fill_rect(_cinema)
	_cinema.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = UiTheme.CINEMA_SHADER
	var m := ShaderMaterial.new()
	m.shader = sh
	_cinema.material = m
	root.add_child(_cinema)

func _build_overlays() -> void:
	_vignette = ColorRect.new()
	UiTheme.fill_rect(_vignette)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = UiTheme.VIGNETTE_SHADER
	var m := ShaderMaterial.new()
	m.shader = sh
	_vignette.material = m
	root.add_child(_vignette)
	_flash = ColorRect.new()
	UiTheme.fill_rect(_flash)
	_flash.color = Color(1, 1, 1, 0)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_flash)

func _build_top() -> void:
	radar = Radar.new()
	UiTheme.place(radar, 0, 0, 24, 24, 120, 120)
	root.add_child(radar)
	compass = Compass.new()
	UiTheme.place(compass, 0.5, 0, -210, 10, 420, 30)
	root.add_child(compass)
	_zone = _lbl(root, "", 16, UiTheme.GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	UiTheme.place(_zone, 0.5, 0, -250, 43, 500, 22)
	_map_hint = _lbl(root, "", 11, Color("999999"), HORIZONTAL_ALIGNMENT_CENTER, false)
	UiTheme.place(_map_hint, 0.5, 0, -250, 66, 500, 16)
	_clock = _lbl(root, "", 15, Color("d8dce8"), HORIZONTAL_ALIGNMENT_CENTER)
	UiTheme.place(_clock, 0, 0, 24, 148, 120, 22)

func _build_left() -> void:
	var small := _lbl(root, "MANCHE", 16, Color("cccccc"))
	UiTheme.place(small, 0, 1, 27, -118, 200, 22)
	_round_num = _lbl(root, "1", 80, Color("a31616"))
	UiTheme.place(_round_num, 0, 1, 24, -112, 240, 100)
	_points = _lbl(root, "0", 34, UiTheme.GOLD)
	UiTheme.place(_points, 0, 1, 24, -166, 300, 44)
	_exit_l = _lbl(root, "", 14, Color("8cffaa"))
	UiTheme.place(_exit_l, 0, 1, 26, -238, 420, 22)
	_perks_row = HBoxContainer.new()
	_perks_row.add_theme_constant_override("separation", 6)
	_perks_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_perks_row, 0, 1, 24, -212, 420, 34)
	root.add_child(_perks_row)

func _build_right() -> void:
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_END
	box.add_theme_constant_override("separation", 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(box, 1, 1, -328, -196, 300, 176)
	root.add_child(box)
	_weapon = _lbl(box, "", 18, Color("bbbbbb"), HORIZONTAL_ALIGNMENT_RIGHT)
	_caliber = _lbl(box, "", 12, Color("888888"), HORIZONTAL_ALIGNMENT_RIGHT, false)
	_inv = _lbl(box, "", 13, Color("888888"), HORIZONTAL_ALIGNMENT_RIGHT, false)
	_inv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ammo = _lbl(box, "", 56, Color.WHITE, HORIZONTAL_ALIGNMENT_RIGHT)
	_health = Bar.new()
	_health.custom_minimum_size = Vector2(260, 12)
	_health.size_flags_horizontal = Control.SIZE_SHRINK_END
	box.add_child(_health)
	_nades = _lbl(box, "", 16, Color("9fd27a"), HORIZONTAL_ALIGNMENT_RIGHT, false)

func _build_center() -> void:
	_crosshair = Crosshair.new()
	UiTheme.place(_crosshair, 0.5, 0.5, 0, 0, 0, 0)
	root.add_child(_crosshair)
	_hit = Hitmarker.new()
	UiTheme.place(_hit, 0.5, 0.5, 0, 0, 0, 0)
	root.add_child(_hit)
	_prompt = PanelContainer.new()
	_prompt.add_theme_stylebox_override("panel", UiTheme.box(Color(0, 0, 0, 0.5), Color(0, 0, 0, 0), 0, 4, 4))
	_prompt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt.anchor_left = 0.5
	_prompt.anchor_right = 0.5
	_prompt.anchor_top = 0.62
	_prompt.anchor_bottom = 0.62
	_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt.add_child(row)
	_prompt_icon = PromptIcon.new()
	row.add_child(_prompt_icon)
	_prompt_l = _lbl(row, "", 22, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	_prompt_l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_prompt_price = _lbl(row, "", 22, UiTheme.GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	_prompt_price.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_prompt.visible = false
	root.add_child(_prompt)
	_announce = _lbl(root, "", 64, Color("b01818"), HORIZONTAL_ALIGNMENT_CENTER)
	UiTheme.place(_announce, 0.5, 0, -560, 196, 1120, 78)
	_announce_sub = _lbl(root, "", 22, Color("dddddd"), HORIZONTAL_ALIGNMENT_CENTER)
	UiTheme.place(_announce_sub, 0.5, 0, -560, 274, 1120, 30)
	_buffs = HBoxContainer.new()
	_buffs.alignment = BoxContainer.ALIGNMENT_CENTER
	_buffs.add_theme_constant_override("separation", 16)
	_buffs.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_buffs, 0.5, 1, -300, -128, 600, 40)
	root.add_child(_buffs)
	_toast = PanelContainer.new()
	_toast.add_theme_stylebox_override("panel", UiTheme.box(Color(5 / 255.0, 12 / 255.0, 18 / 255.0, 0.78), Color(1, 1, 1, 0.25), 1, 4, 3))
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_top = 96
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast_l = _lbl(_toast, "", 14, Color("cfe3ff"), HORIZONTAL_ALIGNMENT_CENTER, false)
	_toast.visible = false
	root.add_child(_toast)

func _build_vehicle() -> void:
	_veh = VBoxContainer.new()
	_veh.alignment = BoxContainer.ALIGNMENT_END
	_veh.add_theme_constant_override("separation", 3)
	_veh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_veh, 0.5, 1, -140, -190, 280, 170)
	_veh.visible = false
	root.add_child(_veh)
	_v_switch = PanelContainer.new()
	_v_switch.add_theme_stylebox_override("panel", UiTheme.box(Color(10 / 255.0, 12 / 255.0, 16 / 255.0, 0.72), Color("5a6068"), 1, 4, 3))
	_v_switch.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_v_switch_l = _lbl(_v_switch, "", 13, Color("f4f4e8"), HORIZONTAL_ALIGNMENT_CENTER, false)
	_v_switch.visible = false
	_veh.add_child(_v_switch)
	_v_speedo = _lbl(_veh, "", 44, Color("9aa0a6"), HORIZONTAL_ALIGNMENT_CENTER)
	_v_speed = Bar.new()
	_v_speed.custom_minimum_size = Vector2(280, 8)
	_v_speed.color = Color("9aa0a6")
	_veh.add_child(_v_speed)
	var r1 := _veh_row("PV MOTO")
	_v_hp_row = r1[0]
	_v_hp_name = r1[1]
	_v_hp = r1[2]
	_v_hp_txt = r1[3]
	var r2 := _veh_row("ESSENCE")
	_v_fuel_row = r2[0]
	_v_fuel_name = r2[1]
	_v_fuel = r2[2]
	_v_fuel_txt = r2[3]

func _veh_row(name: String) -> Array:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_veh.add_child(row)
	var n := _lbl(row, name, 11, Color("cccccc"), HORIZONTAL_ALIGNMENT_RIGHT, false)
	n.custom_minimum_size = Vector2(62, 0)
	var bar := Bar.new()
	bar.custom_minimum_size = Vector2(0, 9)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(bar)
	var t := _lbl(row, "", 11, Color("cccccc"), HORIZONTAL_ALIGNMENT_LEFT, false)
	t.custom_minimum_size = Vector2(38, 0)
	return [row, n, bar, t]

func _build_finale() -> void:
	_banner = PanelContainer.new()
	_banner.add_theme_stylebox_override("panel", UiTheme.box(Color(90 / 255.0, 0, 0, 0.75), Color("ff5040"), 1, 4, 5))
	_banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_banner.anchor_left = 0.5
	_banner.anchor_right = 0.5
	_banner.offset_top = 86
	_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_banner_l = _lbl(_banner, "", 22, Color("ffd8c8"), HORIZONTAL_ALIGNMENT_CENTER)
	_banner.visible = false
	root.add_child(_banner)
	_boss = VBoxContainer.new()
	_boss.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_boss, 0.5, 0, -260, 128, 520, 50)
	_boss.visible = false
	root.add_child(_boss)
	_boss_name = _lbl(_boss, "", 20, Color("ffb0a0"), HORIZONTAL_ALIGNMENT_CENTER)
	_boss_bar = Bar.new()
	_boss_bar.custom_minimum_size = Vector2(520, 14)
	_boss_bar.border = Color("aa3333")
	_boss.add_child(_boss_bar)
	_boss_inv = _lbl(_boss_bar, "INVULNÉRABLE", 11, Color("e8eef8"), HORIZONTAL_ALIGNMENT_CENTER, false)
	UiTheme.place(_boss_inv, 0, 0, 0, -1, 520, 16)
	_boss_inv.visible = false
	_mark = PanelContainer.new()
	_mark.add_theme_stylebox_override("panel", UiTheme.box(Color(120 / 255.0, 0, 0, 0.78), Color("ff3a28"), 2, 4, 5))
	_mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mark.anchor_left = 0.5
	_mark.anchor_right = 0.5
	_mark.anchor_top = 1
	_mark.anchor_bottom = 1
	_mark.offset_top = -200
	_mark.offset_bottom = -200
	_mark.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_mark_l = _lbl(_mark, "", 24, Color("ffd8d0"), HORIZONTAL_ALIGNMENT_CENTER)
	_mark.visible = false
	root.add_child(_mark)
	_fanal = VBoxContainer.new()
	_fanal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_fanal, 0.5, 1, -190, -158, 380, 40)
	_fanal.visible = false
	root.add_child(_fanal)
	_fanal_l = _lbl(_fanal, "", 18, Color("ffe9b0"), HORIZONTAL_ALIGNMENT_CENTER)
	_fanal_bar = Bar.new()
	_fanal_bar.custom_minimum_size = Vector2(380, 12)
	_fanal_bar.border = Color("d9a441")
	_fanal_bar.color = Color("ffb040")
	_fanal.add_child(_fanal_bar)
	_down = VBoxContainer.new()
	_down.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.place(_down, 0.5, 0.34, -300, 0, 600, 150)
	_down.visible = false
	root.add_child(_down)
	_down_sec = _lbl(_down, "", 64, Color("ff4a3a"), HORIZONTAL_ALIGNMENT_CENTER)
	_down_sub = _lbl(_down, "VOUS ÊTES À TERRE", 16, Color("ffb0a0"), HORIZONTAL_ALIGNMENT_CENTER, false)
	_down_extra = _lbl(_down, "", 20, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)

# ---------------------------------------------------------------- touches
## Une touche a changé (Options > Touches) : les textes qui la citent sont refaits.
func refresh_keys() -> void:
	_inv_key = "?"
	_perk_key = "?"
	_map_hint.text = "%s carte" % binds.tag("map")

# ---------------------------------------------------------------- évènements
func announce(title: String, sub := "", duration := 3.0) -> void:
	_announce.text = title
	_announce_sub.text = sub
	_announce_t = duration
	_announce_len = duration

func hurt_flash() -> void:
	_hurt = 1.0

func flash_nuke() -> void:
	_nuke = 1.0

func show_hit(kill: bool) -> void:
	_hit.kill = kill
	_hit.a = 1.0
	_hit.queue_redraw()

## Texte qui monte et s'estompe à côté du réticule (popup du JS) ; cls : "", "head" (rouge, gras), "bonus" (vert).
func popup(text: String, cls := "") -> void:
	var col := Color("ffd24a")
	var size := 22
	if cls == "head":
		col = Color("ff5a3a")
		size = 26
	elif cls == "bonus":
		col = Color("55ff77")
		size = 26
	var l := _lbl(root, text, size, col, HORIZONTAL_ALIGNMENT_LEFT)
	var jitter := randf_range(-15.0, 15.0)
	UiTheme.place(l, 0.5, 0.5, 40, -10 + jitter - size * 0.6, 360, size + 10)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y - 50.0, POPUP_TIME).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, POPUP_TIME).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(l.queue_free)

func toast(text: String, seconds := 4.0) -> void:
	_toast_l.text = text
	_toast.visible = true
	_toast_t = seconds

func _on_points(amount: int, cls: String) -> void:
	popup("+%d" % amount, cls)

func _on_powerup(type: String) -> void:
	match type:
		"fuel":
			popup("+2,5 L ESSENCE", "bonus")
		"max_ammo":
			popup("MUNITIONS MAX", "bonus")
		"insta_kill":
			popup("MORT INSTANTANÉE", "bonus")
		"nuke":
			popup("+400 BOMBE", "bonus")
			flash_nuke()
		"double_points":
			popup("POINTS DOUBLES", "bonus")

## Vue de cinéma (vue orbitale de l'Aube) : ni arme ni interface, sauf l'annonce (summit.js startOrbit : hud.el.hud masqué, l'annonce visible).
var _cine_on := false
var _cine_hidden: Array[Control] = []

func set_cinema(on: bool) -> void:
	if on == _cine_on:
		return
	_cine_on = on
	if on:
		_cine_hidden.clear()
		for c in root.get_children():
			if c is Control and c.visible and c != _announce and c != _announce_sub:
				_cine_hidden.append(c)
				c.visible = false
	else:
		for c in _cine_hidden:
			c.visible = true
		_cine_hidden.clear()

func set_banner(text: String) -> void:
	_banner.visible = text != ""
	_banner_l.text = text

## Barre de boss : { hp, max, phase, name, inv, thresholds } ou {} pour la retirer. Le Bourreau : barre coupée aux seuils de phase et
## « I · LE BOURREAU »… ; le mini-boss (Maître Tanneur) : une seule barre sans coupure.
func set_boss_bar(b: Dictionary) -> void:
	_boss.visible = not b.is_empty()
	if b.is_empty():
		return
	var th: Array = b.get("thresholds", [])
	var inv := bool(b.get("inv", false))
	var phase := int(b.get("phase", 1))
	var roman := ["I", "II", "III", "IV"]
	_boss_name.text = ("%s · %s" % [roman[clampi(phase - 1, 0, 3)], b["name"]]) if not th.is_empty() else String(b["name"])
	_boss_name.add_theme_color_override("font_color", Color("c4ccd8") if inv else Color("ffb0a0"))
	_boss_bar.set_bar(float(b["hp"]) / float(b["max"]), Color("8a909a") if inv else (Color("e8561c") if phase >= 4 else Color("dd2222")))
	_boss_inv.visible = inv
	for t in _boss_ticks:
		t.queue_free()
	_boss_ticks.clear()
	for f: float in th:
		var t := ColorRect.new()
		t.color = Color(0.95, 0.82, 0.78, 0.85)
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		UiTheme.place(t, f, 0, -1, -3, 2, 20)
		_boss_bar.add_child(t)
		_boss_ticks.append(t)

func set_mark(text: String) -> void:
	_mark.visible = text != ""
	_mark_l.text = text

## Jauge du Fanal d'Erwin (Acte V) ; frac < 0 la retire.
func set_fanal(frac: float, text := "") -> void:
	_fanal.visible = frac >= 0.0
	if frac >= 0.0:
		_fanal_l.text = text
		_fanal_bar.set_bar(frac, Color("ffb040"))

# ---------------------------------------------------------------- mise à jour
func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"hud", _pt)

func _tick(dt: float) -> void:
	var p: PlayerSim = Game.player
	if p == null:
		return
	_update_basic(dt, p)
	_update_vehicle()
	_update_perks_buffs(dt)
	_update_downed(p)
	_update_overlays(dt)

func _update_basic(dt: float, p: PlayerSim) -> void:
	var w: WeaponState = Game.arms.current
	_health.set_bar(p.health / p.max_health, Color("cc2222"))
	_low = 1.0 - p.health / p.max_health
	_points.text = HudCalc.points_text(Game.points)
	_exit_l.visible = Game.gm != null
	if _exit_l.visible:
		var price := int(Game.gm.exit["price"])
		_exit_l.text = "SORTIE : %s / %s pts%s" % [HudCalc.points_text(mini(Game.points, price)), HudCalc.points_text(price), "  — achetez-la !" if Game.points >= price else ""]
	_round_num.text = str(maxi(1, Game.round_number))
	var wname := String(w.cfg.get("name", ""))
	_weapon.text = wname
	_caliber.text = String(w.cfg.get("caliber", ""))
	_caliber.visible = _caliber.text != ""
	var ammo := HudCalc.ammo_text(w.ammo, w.reserve, w.reloading)
	if w.cfg.has("gl"):
		ammo += "  [40 mm x%d]" % w.gl
	_ammo.text = ammo
	_ammo.add_theme_font_size_override("font_size", 40 if w.reloading else 56)
	var inv_key := ""
	var parts: Array = []
	var inv: Array = []
	for ws in Game.arms.inventory:
		inv.append({"id": ws.id, "pap": ws.pap})
	var labels := PackedStringArray([binds.label("weapon1"), binds.label("weapon2"), binds.label("weapon3")])
	parts = HudCalc.inventory_parts(inv, labels)
	for i in parts.size():
		inv_key += ("*" if i == Game.arms.idx else "") + parts[i] + "|"
	if inv_key != _inv_key:
		_inv_key = inv_key
		_inv.text = "  ·  ".join(PackedStringArray(parts))
	_nades.text = "GRENADES %s %s" % [binds.tag("grenade"), ("● ".repeat(Game.arms.grenades) if Game.arms.grenades > 0 else "—")]
	var zone := ""
	if Game.world != null:
		var zi: int = Game.world.zone_of(p.pos.x, p.pos.z)
		zone = String(Game.world.zone_names[zi]) if zi >= 0 else ""
	_zone.text = zone.to_upper() if zone != "" else ""
	var dn: DayNight = Game.daynight
	_clock.visible = dn.clock_visible()
	if _clock.visible:
		_clock.text = "%s  %s" % [dn.clock_text(), dn.phase_name()]
	(compass as Control).call("set_yaw", p.yaw)
	var pi: Dictionary = {"text": ""} if Game.over else Prompts.info(Game, binds)
	_prompt.visible = String(pi["text"]) != ""
	if _prompt.visible:
		var priced := int(pi["price"]) >= 0
		_prompt_l.text = String(pi["main"]) if priced else String(pi["text"])
		_prompt_price.visible = priced
		var col := UiTheme.GOLD if bool(pi["afford"]) else Color("ff4a3a")
		if priced:
			var miss := int(pi["price"]) - int(Game.points)
			_prompt_price.text = "%d pts" % int(pi["price"]) if bool(pi["afford"]) else "%d pts (manque %d)" % [int(pi["price"]), miss]
			_prompt_price.add_theme_color_override("font_color", col)
		var icol := Color("8a5cff") if bool(pi["pap"]) else (Color("7fe08a") if String(pi["kind"]) == "wall_buy" else Color("ffcf6a"))
		_prompt_icon.show_for(String(pi["kind"]), String(pi["id"]), icol if bool(pi["afford"]) else Color("ff6a5a"))
	if not intro_hold:   # v0.20.1 : pendant l'intro d'un boss le bandeau et la barre attendent (l'intro a son propre titre)
		_announce_t = maxf(0.0, _announce_t - dt)
	var fade := clampf(_announce_t / ANNOUNCE_FADE, 0.0, 1.0)
	_announce.modulate.a = 0.0 if intro_hold else fade
	_announce_sub.modulate.a = 0.0 if intro_hold else fade
	_boss.modulate.a = 0.0 if intro_hold else 1.0
	if _toast.visible:
		_toast_t -= dt
		if _toast_t <= 0.0:
			_toast.visible = false

func _update_vehicle() -> void:
	var r: Rides = Game.rides
	var gg := r.gauge() if r != null and not Game.over else {}
	_veh.visible = not gg.is_empty()
	if gg.is_empty():
		return
	var spd := absf(float(gg["speed"]))
	var vmax := float(gg["vmax"])
	var vmin := float(gg["vmin"])
	var hot := spd >= vmin
	_v_speedo.text = "%d km/h" % roundi(spd * 3.6)
	_v_speedo.add_theme_color_override("font_color", Color("ff4a3a") if hot else Color("9aa0a6"))
	_v_speed.tick = minf(1.0, vmin / vmax) if vmin < vmax else -1.0
	_v_speed.set_bar(spd / vmax, Color("ff4a3a") if hot else Color("9aa0a6"))
	var f := maxf(0.0, float(gg["hp"]) / float(gg["hp_max"])) if float(gg["hp_max"]) > 0.0 else 0.0
	_v_hp_name.text = "PV %s" % gg["name"]
	_v_hp.set_bar(f, HudCalc.hp_color(f))
	_v_hp_txt.text = "%d %%" % roundi(f * 100.0)
	var has_tank := bool(gg.get("has_tank", true))
	_v_fuel_row.visible = has_tank
	if has_tank:
		var ff := maxf(0.0, float(gg["fuel"]))
		_v_fuel_name.text = String(gg.get("fuel_label", "ESSENCE"))
		_v_fuel.set_bar(ff, HudCalc.fuel_color(ff))
		_v_fuel_txt.text = "%d %%" % roundi(ff * 100.0)
		_v_fuel_row.modulate.a = 0.6 + 0.4 * absf(sin(Time.get_ticks_msec() / 250.0)) if ff < 0.15 else 1.0
	var sw: Dictionary = gg.get("sw", {})
	_v_switch.visible = not sw.is_empty()
	if not sw.is_empty():
		var locked := bool(sw["locked"])
		var div := bool(sw["diverge"])
		_v_switch_l.text = "AIGUILLAGE ▸ %s : %s\n%s · dans %d m" % ["DÉVIÉ" if div else "TOUT DROIT", sw["name"],
			"verrouillé" if locked else ("%s pour changer" % binds.tag("tramSwitch")), int(sw["dist"])]
		_v_switch_l.add_theme_color_override("font_color", Color("ffe08a") if div else Color("f4f4e8"))

func _update_perks_buffs(dt: float) -> void:
	var arms: WeaponArms = Game.arms
	var key := ",".join(arms.perks.keys())
	if key != _perk_key:
		_perk_key = key
		for c in _perks_row.get_children():
			c.queue_free()
		for id: String in arms.perks:
			var pd: Dictionary = Config.at("perks.%s" % id)
			var pc := PanelContainer.new()
			pc.custom_minimum_size = Vector2(30, 30)
			pc.tooltip_text = String(pd["name"])
			pc.add_theme_stylebox_override("panel", UiTheme.box(Color(String(pd["color"])), Color(1, 1, 1, 0.8), 2, 15, 0))
			pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var bgc := Color(String(pd["color"]))
			var l := _lbl(pc, String(pd["letter"]), 17, Color("1a1a1a") if bgc.get_luminance() > 0.6 else Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)   # v0.27.0 : fond clair -> lettre sombre
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_perks_row.add_child(pc)
	var pu: Powerups = Game.powerups
	var want := {}
	if pu != null:
		if pu.insta_kill > 0.0:
			want["insta"] = "MORT INSTANTANÉE (%ds)" % ceili(pu.insta_kill)
		if pu.double_points > 0.0:
			want["double"] = "POINTS DOUBLES (%ds)" % ceili(pu.double_points)
	var pfx: PerkFx = Game.pfx   # v0.27.0 : états des nouveaux atouts
	if pfx != null and Game.player != null:
		if pfx.invuln > 0.0:
			want["wish"] = "ULTIME VOLONTÉ : INVULNÉRABLE (%ds)" % ceili(pfx.invuln)
		if pfx.anchored(Game):
			want["bastion"] = "BASTION : -30 % DE DÉGÂTS"
		if not pfx.tomb.is_empty():
			var tp: Vector3 = pfx.tomb["pos"]
			want["tomb"] = "TOMBE : %d m · %ds%s" % [roundi(Vector2(tp.x - Game.player.pos.x, tp.z - Game.player.pos.z).length()), ceili(float(pfx.tomb["life"])), "" if float(pfx.tomb["arm"]) <= 0.0 else " (pas encore)"]
	for k: String in want:
		if not _buff_labels.has(k):
			var pc := PanelContainer.new()
			var bg := Color(180 / 255.0, 20 / 255.0, 20 / 255.0, 0.65) if k == "insta" else Color(180 / 255.0, 140 / 255.0, 20 / 255.0, 0.65)
			var bd := Color("ff3333") if k == "insta" else Color("ffd24a")
			if k == "bastion":
				bg = Color(0.17, 0.31, 0.49, 0.7)
				bd = Color("7fa8e0")
			elif k == "tomb":
				bg = Color(0.3, 0.3, 0.32, 0.7)
				bd = Color("e6e6e6")
			pc.add_theme_stylebox_override("panel", UiTheme.box(bg, bd, 1, 4, 3))
			pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var l := _lbl(pc, "", 20, Color("ff7777") if k == "insta" else (Color("cfe2ff") if k == "bastion" else (Color("f0f0f0") if k == "tomb" else Color("ffe666"))), HORIZONTAL_ALIGNMENT_CENTER)
			pc.set_meta("label", l)
			_buffs.add_child(pc)
			_buff_labels[k] = pc
		(_buff_labels[k].get_meta("label") as Label).text = want[k]
		_buff_labels[k].modulate.a = 0.85 + 0.15 * sin(Time.get_ticks_msec() / 320.0)
	for k: String in _buff_labels.keys():
		if not want.has(k):
			_buff_labels[k].queue_free()
			_buff_labels.erase(k)

func _update_downed(p: PlayerSim) -> void:
	_down.visible = p.downed and not p.dead
	if not _down.visible:
		return
	var self_rev := p.self_revive > 0.0
	_down_sec.text = "%d s" % ceili(p.self_revive if self_rev else p.bleedout)
	_down_extra.text = "Réanimation rapide : vous vous relevez…" if self_rev else "Aucun coéquipier debout"
	_down_extra.add_theme_color_override("font_color", Color("8cff9a") if self_rev else Color("bbbbbb"))

func _update_overlays(dt: float) -> void:
	_hurt = maxf(0.0, _hurt - dt * HURT_FADE)
	var low := maxf(0.0, _low - 0.3) * 1.2
	((_vignette.material) as ShaderMaterial).set_shader_parameter("amount", minf(1.0, _hurt * 0.9 + low))
	_nuke = maxf(0.0, _nuke - dt * 1.6)
	_flash.color.a = _nuke
	if _hit.a > 0.0:
		_hit.a = maxf(0.0, _hit.a - dt / 0.18)
		_hit.queue_redraw()
