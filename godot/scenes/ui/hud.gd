extends CanvasLayer
## HUD minimal de J1 : santé, munitions, points, manche, annonce, réticule, voile rouge des dégâts, écran de fin (rejouer avec R ou clic).

signal restart_requested

const HEALTH_COLOR := Color("c0392b")
const TEXT_COLOR := Color("e8e8e0")
const HURT_FADE := 2.5
const ANNOUNCE_TIME := 2.5

var _health_bar: ProgressBar
var _ammo: Label
var _points: Label
var _round: Label
var _announce: Label
var _announce_sub: Label
var _prompt: Label
var _gauge: Label
var _fuel_bar: ProgressBar
var _hp_bar: ProgressBar
var _vignette: ColorRect
var _end_panel: PanelContainer
var _end_stats: Label
var _announce_t := 0.0
var _hurt := 0.0

func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_vignette = ColorRect.new()
	_vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	_vignette.color = Color(0.7, 0, 0, 0)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_vignette)
	# réticule
	var cross := Label.new()
	cross.text = "+"
	cross.add_theme_font_size_override("font_size", 28)
	cross.set_anchors_preset(Control.PRESET_CENTER)
	cross.grow_horizontal = Control.GROW_DIRECTION_BOTH
	cross.grow_vertical = Control.GROW_DIRECTION_BOTH
	cross.modulate = Color(1, 1, 1, 0.8)
	root.add_child(cross)
	# bas gauche : santé
	_health_bar = ProgressBar.new()
	_health_bar.custom_minimum_size = Vector2(260, 22)
	_health_bar.show_percentage = false
	_health_bar.position = Vector2(24, 0)
	_health_bar.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_health_bar.offset_left = 24
	_health_bar.offset_top = -50
	_health_bar.offset_right = 284
	_health_bar.offset_bottom = -28
	var fill := StyleBoxFlat.new()
	fill.bg_color = HEALTH_COLOR
	_health_bar.add_theme_stylebox_override("fill", fill)
	root.add_child(_health_bar)
	# bas droite : munitions
	_ammo = _label(root, Control.PRESET_BOTTOM_RIGHT, 34, HORIZONTAL_ALIGNMENT_RIGHT)
	_ammo.offset_left = -480
	_ammo.offset_top = -130
	_ammo.offset_right = -24
	_ammo.offset_bottom = -20
	# haut gauche : manche ; haut droite : points
	_round = _label(root, Control.PRESET_TOP_LEFT, 40, HORIZONTAL_ALIGNMENT_LEFT)
	_round.offset_left = 24
	_round.offset_top = 14
	_round.offset_right = 300
	_round.offset_bottom = 70
	_points = _label(root, Control.PRESET_TOP_RIGHT, 32, HORIZONTAL_ALIGNMENT_RIGHT)
	_points.offset_left = -330
	_points.offset_top = 18
	_points.offset_right = -24
	_points.offset_bottom = 70
	# annonce
	_announce = _label(root, Control.PRESET_CENTER_TOP, 52, HORIZONTAL_ALIGNMENT_CENTER)
	_announce.offset_left = -400
	_announce.offset_right = 400
	_announce.offset_top = 90
	_announce.offset_bottom = 170
	_announce_sub = _label(root, Control.PRESET_CENTER_TOP, 24, HORIZONTAL_ALIGNMENT_CENTER)
	_announce_sub.offset_left = -500
	_announce_sub.offset_right = 500
	_announce_sub.offset_top = 150
	_announce_sub.offset_bottom = 190
	# J5 : invite d'interaction (bas du centre) et tableau de bord du véhicule
	_prompt = _label(root, Control.PRESET_CENTER_BOTTOM, 24, HORIZONTAL_ALIGNMENT_CENTER)
	_prompt.offset_left = -520
	_prompt.offset_right = 520
	_prompt.offset_top = -190
	_prompt.offset_bottom = -150
	_gauge = _label(root, Control.PRESET_CENTER_BOTTOM, 30, HORIZONTAL_ALIGNMENT_CENTER)
	_gauge.offset_left = -260
	_gauge.offset_right = 260
	_gauge.offset_top = -140
	_gauge.offset_bottom = -90
	_fuel_bar = _bar(root, Color("e0a82e"), -260, -84)
	_hp_bar = _bar(root, Color("c0392b"), -260, -62)
	# écran de fin
	_end_panel = PanelContainer.new()
	_end_panel.set_anchors_preset(Control.PRESET_CENTER)
	_end_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_end_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	_end_panel.visible = false
	_end_panel.mouse_filter = Control.MOUSE_FILTER_PASS
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	_end_panel.add_child(box)
	var title := Label.new()
	title.text = "VOUS ÊTES MORT"
	title.add_theme_font_size_override("font_size", 48)
	title.add_theme_color_override("font_color", HEALTH_COLOR)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	_end_stats = Label.new()
	_end_stats.add_theme_font_size_override("font_size", 26)
	_end_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_end_stats)
	var btn := Button.new()
	btn.text = "REJOUER (R)"
	btn.add_theme_font_size_override("font_size", 26)
	btn.pressed.connect(func(): restart_requested.emit())
	box.add_child(btn)
	root.add_child(_end_panel)

func _label(parent: Control, preset: int, size: int, align: int) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", TEXT_COLOR)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 6)
	l.horizontal_alignment = align as HorizontalAlignment
	l.set_anchors_preset(preset)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l

func _bar(parent: Control, color: Color, left: float, top: float) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	b.offset_left = left
	b.offset_right = left + 520
	b.offset_top = top
	b.offset_bottom = top + 14
	b.max_value = 1.0
	var fill := StyleBoxFlat.new()
	fill.bg_color = color
	b.add_theme_stylebox_override("fill", fill)
	b.visible = false
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(b)
	return b

func announce(text: String, sub := "") -> void:
	_announce.text = text
	_announce_sub.text = sub
	_announce_t = ANNOUNCE_TIME

func hurt_flash() -> void:
	_hurt = 1.0

func show_end(stats: String) -> void:
	_end_stats.text = stats
	_end_panel.visible = true

func hide_end() -> void:
	_end_panel.visible = false

func _process(dt: float) -> void:
	if Game.player == null:
		return
	_health_bar.max_value = Game.player.max_health
	_health_bar.value = Game.player.health
	var w := Game.weapon
	_ammo.text = ("RECHARGE…  " if w.reloading else "") + "%d / %d\n%s    G x%d" % [w.ammo, w.reserve, String(w.cfg.get("name", "")), Game.arms.grenades]
	_points.text = "%d" % Game.points
	_round.text = "MANCHE %d" % Game.round_number if Game.round_number > 0 else "PRÉPAREZ-VOUS"
	_announce_t = maxf(0.0, _announce_t - dt)
	_announce.modulate.a = clampf(_announce_t, 0.0, 1.0)
	_announce_sub.modulate.a = clampf(_announce_t, 0.0, 1.0)
	_update_rides()
	_hurt = maxf(0.0, _hurt - dt * HURT_FADE)
	var low := 1.0 - Game.player.health / Game.player.max_health
	_vignette.color.a = clampf(_hurt * 0.45 + low * low * 0.25, 0.0, 0.7)

## J5 : invite d'interaction et tableau de bord (vitesse, essence ou énergie, PV) du véhicule occupé.
func _update_rides() -> void:
	var r: Rides = Game.rides
	if r == null or Game.over:
		_prompt.text = ""
		_gauge.text = ""
		_fuel_bar.visible = false
		_hp_bar.visible = false
		return
	_prompt.text = r.prompt()
	var gg := r.gauge()
	if gg.is_empty():
		_gauge.text = ""
		_fuel_bar.visible = false
		_hp_bar.visible = false
		return
	var kmh := roundi(absf(float(gg["speed"])) * 3.6)
	var extra := ""
	if gg.get("tram", false) and not (gg["sw"] as Dictionary).is_empty():
		var sw: Dictionary = gg["sw"]
		extra = "   AIGUILLAGE %s%s dans %d m" % [("DÉVIÉ " if sw["diverge"] else "DROIT "), "(verrouillé)" if sw["locked"] else "", int(sw["dist"])]
	_gauge.text = "%s   %d km/h%s" % [gg["name"], kmh, extra]
	_fuel_bar.visible = bool(gg.get("has_tank", true))
	_fuel_bar.value = float(gg["fuel"])
	_hp_bar.visible = true
	_hp_bar.value = float(gg["hp"]) / float(gg["hp_max"])
