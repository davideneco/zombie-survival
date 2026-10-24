class_name DebugOverlay
extends CanvasLayer
## Menu debug solo (F9, port de la part « hôte seul » de src/debugMenu.js) : la souris reste capturée, tout se fait au clavier.
##   U débloquer les zombies coincés (v0.34.11 : ils s'enfoncent dans le sol puis réapparaissent cachés, par une fenêtre ou depuis le sol) · P bascule FPS / appels de rendu / triangles / zombies · Échap ou F9 ferme.
## Les parties qui concernent d'autres joueurs (1-4, T, Y, N : amener / rejoindre / réanimer) attendent le multijoueur (J12).
## `Game.debug_open` dit au menu Échap de fermer ce panneau d'abord.

var _label: Label
var _perf := false
var _log: PackedStringArray = []
var _acc := 0.0
var _frames := 0
var _fps := 0.0

func _ready() -> void:
	layer = 20
	_label = Label.new()
	_label.position = Vector2(12, 150)
	_label.add_theme_font_size_override("font_size", 14)
	_label.add_theme_color_override("font_color", Color("ffe9a8"))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 4)
	add_child(_label)
	visible = false

func toggle() -> void:
	Game.debug_open = not Game.debug_open
	visible = Game.debug_open
	_redraw()

func _unhandled_key_input(event: InputEvent) -> void:
	var e := event as InputEventKey
	if e == null or not e.pressed or e.echo:
		return
	if e.keycode == KEY_F9:
		toggle()
		get_viewport().set_input_as_handled()
	elif Game.debug_open:
		if e.keycode == KEY_U:
			var n := Game._relocate(0.0, true)
			say("zombies débloqués : %d" % n)
		elif e.keycode == KEY_P:
			_perf = not _perf
		else:
			return
		get_viewport().set_input_as_handled()
		_redraw()

func say(text: String) -> void:
	_log.append(text)
	if _log.size() > 6:
		_log.remove_at(0)

func _process(dt: float) -> void:
	if visible != Game.debug_open:   # fermé par Échap (menus.gd)
		visible = Game.debug_open
	if not visible:
		return
	_acc += dt
	_frames += 1
	if _acc >= 0.5:
		_fps = _frames / _acc
		_acc = 0.0
		_frames = 0
		_redraw()

func _redraw() -> void:
	var h := "MENU DEBUG (F9)\nU débloquer les zombies · P perfs · Échap ferme\n"
	for l in _log:
		h += "\n" + l
	if _perf:
		h += "\n\n%.0f images/s · %d appels · %.0f k triangles\nzombies %d · manche %d · pas de jeu %.2f ms" % [
			_fps, int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
			Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0, Game.zombies.size(), Game.round_number,
			Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0]
		# v0.34.10 : suivi des zombies (ZombieWatch) : immobiles, perdus, téléportés, apparitions, relances ; journal --zombie-stuck-log
		h += "\n" + Game.watch.summary().replace("), ", "),\n")
		if Game.watch.log_on:
			h += "\njournal : %s" % ProjectSettings.globalize_path(Game.watch.log_path)
	_label.text = h
