extends RefCounted
## v0.34.3 : startup and menu-reaction diagnostic (StartupLog, --startup-log=FILE).

func run(t: Node) -> void:
	t.check(not StartupLog.on, "startup log: off without the option (zero cost)")
	t.check(StartupLog.t() == 0, "startup log: t() is 0 when off")
	StartupLog.mark("x")   # must do nothing
	StartupLog.input_seen()
	t.check(StartupLog.is_slow(30.0) and not StartupLog.is_slow(20.0), "startup log: slow frame threshold 25 ms")
	var line := StartupLog.format_click("OPTIONS", "options", 1.25, [12.0, 20.0], [12.0, 8.0], 3, 0.5, 1.5)
	t.check(line.begins_with("CLICK « OPTIONS » on options : handler 1.2") and line.contains("12.0 (12.0), 20.0 (8.0)") and line.contains("pipelines +3"), "startup log: click line (%s)" % line)
	t.check(StartupLog.pipe_text(PackedInt64Array([0, 1, 2, 3, 4]), PackedInt64Array([0, 1, 5, 4, 4])) == " (surface 3, draw 1)", "startup log: pipelines per source")
	t.check(StartupLog.pipe_text(PackedInt64Array([1, 1]), PackedInt64Array([1, 1])) == "", "startup log: no pipeline, no text")
	var path := "user://test_startup_log.txt"
	StartupLog.start(path)
	t.check(StartupLog.on, "startup log: on once started")
	StartupLog.mark("probe point", "extra")
	StartupLog.span("probe span", Time.get_ticks_usec() - 2000)
	StartupLog.finish()
	var text := FileAccess.get_file_as_string(path)
	t.check(text.contains("# Zombie Survival : startup log") and text.contains("# GPU:"), "startup log: header (version, GPU)")
	t.check(text.contains("MARK") and text.contains("probe point  (extra)"), "startup log: MARK line")
	t.check(text.contains("SPAN") and text.contains("probe span : 2."), "startup log: SPAN line")
	t.check(text.contains("=== SUMMARY ==="), "startup log: summary at the end")
	StartupLog.reset_for_tests()
	t.check(not StartupLog.on, "startup log: off again after reset")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
