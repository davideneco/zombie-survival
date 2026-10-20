class_name FpsOverlay
extends CanvasLayer
## v0.20.5 compteur de FPS en haut à droite : « FPS 143  moy 140  min 61  max 165 » (fenêtre glissante de 10 s, FpsWindow). Option « Compteur FPS » (Options,
## réglage `fps`, défaut NON) ou touche F3 (non modifiable, comme F9). Le texte n'est refait que 4 fois par seconde, et seulement s'il est visible.
## Ligne du bas : min / max depuis le début de la partie. Les chargements et la pause ne comptent pas.

const REFRESH := 0.25

var window := FpsWindow.new()
var _label: Label
var _acc := 0.0
var live := false   ## posé par main.gd : la partie est chargée et affichée (faux pendant le chargement et dans les menus)

func _ready() -> void:
	layer = 21
	_label = UiTheme.label("", 16, Color("ffe9a8"), UiTheme.body(), 4)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_label.position.x -= 14
	_label.position.y += 10
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_label)
	visible = false
	apply()
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "fps":
			apply())

func apply() -> void:
	visible = bool(Game.settings.get_value("fps"))
	_acc = REFRESH

func _unhandled_key_input(event: InputEvent) -> void:
	var e := event as InputEventKey
	if e != null and e.pressed and not e.echo and e.keycode == KEY_F3:
		Game.settings.set_value("fps", not bool(Game.settings.get_value("fps")))
		get_viewport().set_input_as_handled()

func _process(dt: float) -> void:
	var active: bool = live and Game.playing and not Game.over and Game.player != null
	if Game.player == null:
		window.reset()
	window.feed(dt, active)
	if not visible:
		return
	_acc += dt
	if _acc < REFRESH:
		return
	_acc = 0.0
	window.refresh()
	if window.frames == 0:
		_label.text = "FPS --"
	else:
		_label.text = "FPS %d  moy %d  min %d  max %d\nparti : min %d  max %d" % [roundi(window.current), roundi(window.average), roundi(window.win_min), roundi(window.win_max), roundi(window.all_min), roundi(window.all_max)]
