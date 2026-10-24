class_name StartupLog
extends RefCounted
## v0.34.3 : startup and menu-reaction diagnostic (`--startup-log=FILE`, or `--startup-log` alone: user://startup-log.txt). Works with the release exe
## (Windows: `Zombie.console.exe -- --startup-log=demarrage.txt`, or the batch file shipped with the export). Costs nothing when absent: every probe
## starts with `if not on: return`.
## The file lists, in milliseconds since the engine started (Time.get_ticks_usec):
##   - MARK lines: engine -> autoloads -> main scene -> menus built -> first frame shown (and the steps of the game loading screen);
##   - the first menu frames (duration, pipeline compilations);
##   - CLICK lines: for each menu button, time spent in the button handler, then when the next frames were presented and how long they took,
##     with pipeline compilations and render times: the "lag on click" the player sees;
##   - SLOW lines: any other menu frame over 25 ms (with the last click and the screen shown).
## Pure helpers (format_click, is_slow) are tested headless (tests/test_j40.gd).

const SLOW_MS := 25.0
const FIRST_FRAMES := 12           ## first menu frames written one by one
const CLICK_FRAMES := 4            ## frames followed after a click
const DEFAULT_PATH := "user://startup-log.txt"

static var on := false
static var path := ""
static var screen := ""            ## menu screen shown (UiStack layer name), set by menus.gd
static var _checked := false
static var _file: FileAccess
static var _inst: StartupLog
static var _vp: RID
static var _last_us := 0
static var _frames := 0
static var _input_us := 0          ## last mouse release / key press seen by the menus (before the GUI handles it)
static var _click: Dictionary = {} ## click being followed: { name, t0, handler_us, frames: [], pipes0 }
static var _last_click := ""
static var _clicks: Array = []     ## [name, handler_ms, first_frame_ms, worst_frame_ms, pipes]
static var _slow := 0
static var _session := false       ## a game is running: menu probes stop (PerfLog covers the game)
static var _finished := false
static var _prev_kinds := PackedInt64Array()   ## pipeline counters at the previous frame (SLOW lines: what this frame compiled)

# ---------------------------------------------------------------- start
## Reads the command line once, at the first probe (an autoload's `mark`, before main.gd exists), and opens the file.
static func _check_args() -> void:
	if _checked:
		return
	_checked = true
	for a in OS.get_cmdline_user_args():
		if a == "--startup-log":
			path = DEFAULT_PATH
		elif a.begins_with("--startup-log="):
			path = a.substr(14)
	if path != "":
		start(path)

## Opens the log file and writes the header (called from the command line check; tests call it directly).
static func start(file_path: String) -> void:
	_checked = true
	path = file_path
	on = true
	_finished = false
	_file = FileAccess.open(path, FileAccess.WRITE)
	if _file == null and path != DEFAULT_PATH:
		printerr("--startup-log : cannot write %s, using %s" % [path, DEFAULT_PATH])
		path = DEFAULT_PATH
		_file = FileAccess.open(path, FileAccess.WRITE)
	if _file == null:
		printerr("--startup-log : cannot write %s" % path)
		on = false
		return
	print("--startup-log : %s" % (ProjectSettings.globalize_path(path) if path.begins_with("user://") or path.begins_with("res://") else path))
	_put("# Zombie Survival : startup log (--startup-log), version %s, Godot %s" % [str(ProjectSettings.get_setting("application/config/version", "?")), Engine.get_version_info()["string"]])
	_put("# System: %s %s, %d cores (%s), memory %d MB" % [OS.get_name(), OS.get_version(), OS.get_processor_count(), OS.get_processor_name(), int(OS.get_memory_info().get("physical", 0)) / 1048576])
	_put("# GPU: %s (%s), driver API %s, renderer %s" % [RenderingServer.get_video_adapter_name(), RenderingServer.get_video_adapter_vendor(), RenderingServer.get_video_adapter_api_version(), RenderingServer.get_current_rendering_driver_name()])
	_put("# Screen %s at %.0f Hz, scale %.2f; executable %s; arguments: %s" % [DisplayServer.screen_get_size(), DisplayServer.screen_get_refresh_rate(), DisplayServer.screen_get_scale(),
		OS.get_executable_path().get_file(), " ".join(OS.get_cmdline_user_args())])
	_put("# Shader cache entries at start: %d (0 = first launch on this machine: shaders compile now)" % _count_files("user://shader_cache"))
	_put("# Times are milliseconds since the engine started. CLICK: handler = time in the button code; frames = when each next frame was presented after the click (ms) and its duration.")

static func _count_files(dir: String) -> int:
	var d := DirAccess.open(dir)
	if d == null:
		return 0
	var n := d.get_files().size()
	for sub in d.get_directories():
		n += _count_files(dir.path_join(sub))
	return n

static func _put(text: String) -> void:
	if _file == null:
		return
	_file.store_line(text)
	_file.flush()

## A named point of the startup (ms since the engine started). `extra`: free text.
static func mark(label: String, extra := "") -> void:
	_check_args()
	if not on:
		return
	_put("MARK %8.1f ms  %s%s" % [Time.get_ticks_usec() / 1000.0, label, ("  (" + extra + ")") if extra != "" else ""])

## Duration of a block that started at t0_us (Time.get_ticks_usec()).
static func span(label: String, t0_us: int) -> void:
	if not on:
		return
	_put("SPAN %8.1f ms  %s : %.1f ms" % [Time.get_ticks_usec() / 1000.0, label, (Time.get_ticks_usec() - t0_us) / 1000.0])

static func t() -> int:
	_check_args()
	return Time.get_ticks_usec() if on else 0

## Called by main.gd once the tree exists: follows the frames from now on.
static func attach(tree: SceneTree) -> void:
	_check_args()
	if not on or _inst != null:
		return
	_inst = StartupLog.new()
	_vp = tree.root.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(_vp, true)
	RenderingServer.frame_post_draw.connect(_inst._on_post_draw)
	_last_us = Time.get_ticks_usec()
	tree.root.tree_exiting.connect(finish)

## The menus saw a mouse release or a key press (Menus._input runs before the GUI): start of a possible click.
static func input_seen() -> void:
	if on:
		_input_us = Time.get_ticks_usec()

## Follows every button under `root`, including the ones created later (lists rebuilt on the fly).
static func watch(root: Node) -> void:
	_check_args()
	if not on:
		return
	_watch_tree(root)
	root.get_tree().node_added.connect(func(n: Node) -> void:
		if n is BaseButton and root.is_ancestor_of(n):
			_watch_button(n as BaseButton))

static func _watch_tree(n: Node) -> void:
	if n is BaseButton:
		_watch_button(n as BaseButton)
	for c in n.get_children():
		_watch_tree(c)

static func _watch_button(b: BaseButton) -> void:
	if b.has_meta(&"startup_log"):
		return
	b.set_meta(&"startup_log", true)
	# `button_up` is emitted after `pressed` and after its handlers (BaseButton::on_action_event): handler time = now - input seen.
	b.button_up.connect(func() -> void: _clicked(b))

static func _clicked(b: BaseButton) -> void:
	if not on or _session:
		return
	var now := Time.get_ticks_usec()
	var t0 := _input_us if _input_us > 0 and now - _input_us < 2000000 else now
	_input_us = 0
	var name := (b as Button).text if b is Button and (b as Button).text != "" else String(b.name)
	name = name.replace("\n", " / ")
	_last_click = name
	_click = {"name": name, "t0": t0, "handler_us": now - t0, "frames": [], "durs": [], "pipes0": _pipes(), "kinds0": _pipe_counts(), "screen": screen}

static func session(live: bool) -> void:
	_session = live

const PIPE_KINDS := ["canvas", "mesh", "surface", "draw", "specialization"]

## Pipelines compiled so far, per source (Godot compiles "mesh" and "surface" ones in the background when an object enters the scene;
## "draw" ones block the frame that needs them: those are the stutters).
static func _pipe_counts() -> PackedInt64Array:
	var a := PackedInt64Array()
	for k in [RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_CANVAS, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_MESH,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SURFACE, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_DRAW,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SPECIALIZATION]:
		a.append(RenderingServer.get_rendering_info(k))
	return a

static func _pipes() -> int:
	var n := 0
	for v in _pipe_counts():
		n += v
	return n

static func pipe_text(before: PackedInt64Array, after: PackedInt64Array) -> String:
	var parts: PackedStringArray = []
	for i in mini(before.size(), after.size()):
		if after[i] != before[i]:
			parts.append("%s %d" % [PIPE_KINDS[i], after[i] - before[i]])
	return " (" + ", ".join(parts) + ")" if not parts.is_empty() else ""

# ---------------------------------------------------------------- pure rules (tested)
static func is_slow(ms: float) -> bool:
	return ms > SLOW_MS

## One CLICK line: handler (ms), frames: presentation times after the click (ms), durs: frame durations (ms), pipelines compiled meanwhile.
static func format_click(name: String, screen_name: String, handler_ms: float, frames: Array, durs: Array, pipes: int, cpu_ms: float, gpu_ms: float) -> String:
	var fr: PackedStringArray = []
	for i in frames.size():
		fr.append("%.1f (%.1f)" % [float(frames[i]), float(durs[i])])
	return "CLICK « %s » on %s : handler %.1f ms, next frames at %s ms, pipelines +%d, last render CPU %.1f / GPU %.1f ms" % [name, screen_name if screen_name != "" else "?",
		handler_ms, ", ".join(fr), pipes, cpu_ms, gpu_ms]

# ---------------------------------------------------------------- frames
func _on_post_draw() -> void:
	if not on:
		return
	var now := Time.get_ticks_usec()
	var ms := (now - _last_us) / 1000.0
	_last_us = now
	_frames += 1
	if _session:
		return
	var kinds := _pipe_counts()
	var frame_pipes := pipe_text(_prev_kinds, kinds) if not _prev_kinds.is_empty() else ""
	_prev_kinds = kinds
	var cpu := RenderingServer.viewport_get_measured_render_time_cpu(_vp) + RenderingServer.get_frame_setup_time_cpu()
	var gpu := RenderingServer.viewport_get_measured_render_time_gpu(_vp)
	if _frames <= FIRST_FRAMES:
		_put("FRAME %3d at %8.1f ms : %.1f ms, render CPU %.1f / GPU %.1f ms, pipelines so far %d" % [_frames, now / 1000.0, ms, cpu, gpu, _pipes()])
	if not _click.is_empty():
		(_click["frames"] as Array).append((now - int(_click["t0"])) / 1000.0)
		(_click["durs"] as Array).append(ms)
		if (_click["frames"] as Array).size() >= CLICK_FRAMES:
			var p := _pipes() - int(_click["pipes0"])
			var worst := 0.0
			for d: float in _click["durs"]:
				worst = maxf(worst, d)
			_put(format_click(String(_click["name"]), String(_click["screen"]), int(_click["handler_us"]) / 1000.0, _click["frames"], _click["durs"], p, cpu, gpu) + pipe_text(_click["kinds0"], _pipe_counts()))
			_clicks.append([String(_click["name"]), int(_click["handler_us"]) / 1000.0, float(_click["frames"][0]), worst, p])
			_click = {}
		return
	if _frames > FIRST_FRAMES and is_slow(ms):
		_slow += 1
		_put("SLOW frame at %8.1f ms : %.1f ms on %s (last click « %s »), render CPU %.1f / GPU %.1f ms, pipelines so far %d%s" % [now / 1000.0, ms, screen, _last_click, cpu, gpu, _pipes(),
			(", this frame" + frame_pipes) if frame_pipes != "" else ""])

## Summary at exit (idempotent).
static func finish() -> void:
	if not on or _finished or _file == null:
		return
	_finished = true
	var out: PackedStringArray = ["", "=== SUMMARY ==="]
	out.append("%d frames, %d slow menu frames (> %.0f ms), %d clicks followed." % [_frames, _slow, SLOW_MS, _clicks.size()])
	if not _clicks.is_empty():
		var hs := PackedFloat32Array()
		var fs := PackedFloat32Array()
		for c: Array in _clicks:
			hs.append(float(c[1]))
			fs.append(float(c[2]))
		hs.sort()
		fs.sort()
		out.append("Click handler: median %.1f ms, worst %.1f ms; first frame after a click: median %.1f ms, worst %.1f ms." % [hs[hs.size() / 2], hs[hs.size() - 1], fs[fs.size() / 2], fs[fs.size() - 1]])
		var worst := _clicks.duplicate()
		worst.sort_custom(func(a: Array, b: Array) -> bool: return float(a[2]) > float(b[2]))
		out.append("Slowest clicks (first frame after the click):")
		for i in mini(5, worst.size()):
			out.append("  %.1f ms  « %s » (handler %.1f ms, pipelines +%d)" % [float(worst[i][2]), worst[i][0], float(worst[i][1]), int(worst[i][4])])
	out.append("Pipelines compiled in total: %d. Memory %.0f MB, video memory %.0f MB." % [_pipes(), Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0])
	_put("\n".join(out))
	_file.close()
	_file = null

## Tests: back to the initial state.
static func reset_for_tests() -> void:
	on = false
	_checked = true
	path = ""
	_file = null
	_inst = null
	_click = {}
	_clicks.clear()
	_frames = 0
	_slow = 0
	_session = false
	_finished = false
