class_name PerfLog
extends RefCounted
## v0.19.0 : journal des images lentes (`--perf-log=FICHIER`, utilisable avec l'exe de production : tout est compilé, le coût est nul tant que l'option est absente,
## chaque appel commence par `if not on: return`). Une image est « lente » si elle dépasse 25 ms OU 2,5 x la médiane glissante (réglages : SPIKE_ABS_MS, SPIKE_REL).
## Chaque ligne donne : temps réel, temps de jeu, durée, découpage (sections cumulées par image : `PerfLog.t()` puis `PerfLog.add(nom, t0)`), compteurs du moteur
## (objets, noeuds, orphelins, ressources, appels de rendu, triangles, mémoire, VRAM, compilations de pipelines), évènements récents (`PerfLog.event(texte)`),
## et la cause supposée (`attribute`). Un résumé (percentiles, nombre de pics par seuil et par cause, 10 pires images) clôt le fichier.
## Les règles de décision et de calcul (pics, médiane, percentiles, cause) sont statiques et testées sans moteur de rendu (tests/test_j22.gd).

const SPIKE_ABS_MS := 25.0
const SPIKE_REL := 2.5
const MEDIAN_WINDOW := 120
const EVENT_KEEP := 60
const EVENT_WINDOW_MS := 1500          ## évènements joints à une ligne : ceux des 1,5 dernières secondes réelles
const TREND_EVERY_S := 10.0            ## ligne de tendance (mémoire, objets…) toutes les 10 s
const INTERIM_EVERY_S := 60.0          ## résumé provisoire toutes les 60 s (le fichier reste exploitable si le processus est tué)
const LOAD_MIN_US := 1500              ## un chargement de ressource plus long que ça est noté
const PHASE_MENU := "menu"
const PHASE_LOADING := "chargement"
const PHASE_GAME := "jeu"

static var on := false
static var path := ""
static var phase := PHASE_MENU
static var game_time := 0.0              ## posé par main.gd (Game.time)
static var info_cb: Callable = Callable()   ## () -> Dictionary : zombies, manche, etc. (posé par main.gd)
static var last_spike_ms := 0.0          ## dernier pic noté (tests)

static var _file: FileAccess
static var _inst: PerfLog
static var _sections: Dictionary = {}    ## nom -> microsecondes cumulées sur l'image courante
static var _events: Array = []           ## [ticks_msec, game_time, texte]
static var _last_us := 0
static var _t_start_us := 0
static var _frames_all := PackedFloat32Array()    ## durée de chaque image du jeu (ms)
static var _recent := PackedFloat32Array()        ## fenêtre glissante (ms)
static var _median := 0.0
static var _frame_no := 0
static var _spikes: Array[Dictionary] = []        ## pics notés (durée, cause, phase…)
static var _trend_t := 0.0
static var _interim_t := 0.0
static var _pipe_prev := PackedInt64Array([0, 0, 0, 0, 0])
static var _loads: Array = []
static var _game_frames_since_start := 0
static var _finished := false
static var _vp: RID

# ---------------------------------------------------------------- lancement
## Lit la ligne de commande (arguments après --). Renvoie true si le profilage est actif.
static func setup_from_args(args: PackedStringArray, tree: SceneTree) -> bool:
	var p := ""
	for a in args:
		if a.begins_with("--perf-log="):
			p = a.substr(11)
	if p == "":
		return false
	start(p, tree)
	return true

static func start(file_path: String, tree: SceneTree) -> void:
	if on:
		return
	path = file_path
	_file = FileAccess.open(path, FileAccess.WRITE)
	if _file == null:
		var alt := "user://perf.txt"
		_file = FileAccess.open(alt, FileAccess.WRITE)
		if _file == null:
			printerr("--perf-log : impossible d'écrire %s ni %s" % [path, alt])
			return
		print("--perf-log : %s illisible en écriture, journal dans %s" % [path, ProjectSettings.globalize_path(alt)])
		path = alt
	else:
		print("--perf-log : journal dans %s" % path)
	on = true
	_finished = false
	_inst = PerfLog.new()
	_t_start_us = Time.get_ticks_usec()
	_last_us = _t_start_us
	_vp = tree.root.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(_vp, true)
	RenderingServer.frame_post_draw.connect(_inst._on_post_draw)
	_write_header(tree)

static func _write_header(tree: SceneTree) -> void:
	var vp := tree.root
	var lines: PackedStringArray = []
	lines.append("# Zombie Survival : journal de performance (--perf-log), version %s" % str(ProjectSettings.get_setting("application/config/version", "?")))
	lines.append("# Une ligne SPIKE par image lente (> %.0f ms ou > %.1f x la médiane glissante) ; TREND toutes les %.0f s ; résumé à la fin." % [SPIKE_ABS_MS, SPIKE_REL, TREND_EVERY_S])
	lines.append("# Système : %s %s, %d coeurs, mémoire %d Mo" % [OS.get_name(), OS.get_version(), OS.get_processor_count(), int(OS.get_memory_info().get("physical", 0)) / 1048576])
	lines.append("# Processeur : %s" % OS.get_processor_name())
	lines.append("# Carte graphique : %s (%s), pilote %s, rendu %s (%s)" % [RenderingServer.get_video_adapter_name(), _adapter_type(), RenderingServer.get_video_adapter_api_version(),
		str(ProjectSettings.get_setting("rendering/renderer/rendering_method", "?")), RenderingServer.get_current_rendering_driver_name()])
	lines.append("# Fenêtre : %s, mode %d, échelle 3D %.2f (mode %d), MSAA %d, vsync %d" % [vp.size, DisplayServer.window_get_mode(), vp.scaling_3d_scale, vp.scaling_3d_mode, vp.msaa_3d, DisplayServer.window_get_vsync_mode()])
	lines.append("# Écran : %s, %.0f Hz" % [DisplayServer.screen_get_size(), DisplayServer.screen_get_refresh_rate()])
	lines.append("# Arguments : %s" % " ".join(OS.get_cmdline_user_args()))
	_put("\n".join(lines))

static func _adapter_type() -> String:
	match RenderingServer.get_video_adapter_type():
		RenderingDevice.DEVICE_TYPE_INTEGRATED_GPU: return "intégrée"
		RenderingDevice.DEVICE_TYPE_DISCRETE_GPU: return "dédiée"
		RenderingDevice.DEVICE_TYPE_VIRTUAL_GPU: return "virtuelle"
		RenderingDevice.DEVICE_TYPE_CPU: return "logicielle"
	return "inconnue"

static func _put(text: String) -> void:
	if _file == null:
		return
	_file.store_line(text)
	_file.flush()

# ---------------------------------------------------------------- sondes (coût nul quand éteint)
## Début d'une section : 0 quand le journal est éteint.
static func t() -> int:
	return Time.get_ticks_usec() if on else 0

## Ajoute le temps écoulé depuis t0 à la section `name` de l'image courante.
static func add(name: StringName, t0: int) -> void:
	if not on:
		return
	_sections[name] = int(_sections.get(name, 0)) + Time.get_ticks_usec() - t0

## Évènement de la simulation ou du chargement (joint aux lignes SPIKE des 1,5 s suivantes).
static func event(text: String) -> void:
	if not on:
		return
	_events.append([Time.get_ticks_msec(), game_time, text])
	if _events.size() > EVENT_KEEP:
		_events.pop_front()

## Un chargement de ressource : mesuré par l'appelant (t0 = PerfLog.t() avant), noté s'il dépasse LOAD_MIN_US.
static func note_load(kind: String, what: String, t0: int) -> void:
	if not on:
		return
	var us := Time.get_ticks_usec() - t0
	_sections[&"charge"] = int(_sections.get(&"charge", 0)) + us
	if us >= LOAD_MIN_US:
		event("chargement %s %s : %.1f ms" % [kind, what, us / 1000.0])
		_loads.append([kind, what, us])

# ---------------------------------------------------------------- règles pures (testées)
static func is_spike(ms: float, median_ms: float) -> bool:
	return ms > SPIKE_ABS_MS or (median_ms > 0.0 and ms > SPIKE_REL * median_ms)

static func median_of(a: PackedFloat32Array) -> float:
	if a.is_empty():
		return 0.0
	var s := a.duplicate()
	s.sort()
	return s[s.size() / 2]

## Percentile p (0..1) d'un tableau trié.
static func percentile(sorted_ms: PackedFloat32Array, p: float) -> float:
	if sorted_ms.is_empty():
		return 0.0
	return sorted_ms[clampi(int(ceil(p * sorted_ms.size())) - 1, 0, sorted_ms.size() - 1)]

## Cause supposée d'un pic d'après son découpage (µs par section, durée totale en ms), la variation des compteurs de pipelines et les évènements.
## Renvoie une courte étiquette.
static func attribute(total_ms: float, sections: Dictionary, pipes_added: int, events: Array) -> String:
	var best := ""
	var best_us := 0
	for k: Variant in sections:
		if int(sections[k]) > best_us:
			best_us = int(sections[k])
			best = String(k)
	if best_us >= total_ms * 1000.0 * 0.5:
		return "section:" + best
	if pipes_added > 0:
		return "pipelines:+%d" % pipes_added
	for e: Variant in events:
		if String(e).begins_with("chargement"):
			return "ressource"
	if best_us >= total_ms * 1000.0 * 0.25:
		return "section:" + best + "+rendu"
	return "rendu/système"

# ---------------------------------------------------------------- image
func _on_post_draw() -> void:
	if not on:
		return
	var now := Time.get_ticks_usec()
	var ms := (now - _last_us) / 1000.0
	_last_us = now
	_frame_no += 1
	var sec := _sections
	_sections = {}
	if phase != PHASE_GAME:
		_load_phase_ms = maxf(_load_phase_ms, ms) if phase == PHASE_LOADING else _load_phase_ms
		return
	_game_frames_since_start += 1
	var pipes := _pipes_now()
	var added := 0
	for i in 5:
		added += int(pipes[i] - _pipe_prev[i])
	var pipe_delta := pipes.duplicate()
	for i in 5:
		pipe_delta[i] = pipes[i] - _pipe_prev[i]
	_pipe_prev = pipes
	if added > 0:
		event("pipelines compilés +%d (canvas %d, maillage %d, surface %d, dessin %d, spécialisation %d)" % [added, pipe_delta[0], pipe_delta[1], pipe_delta[2], pipe_delta[3], pipe_delta[4]])
	_frames_all.append(ms)
	_recent.append(ms)
	if _recent.size() > MEDIAN_WINDOW:
		_recent = _recent.slice(_recent.size() - MEDIAN_WINDOW)
	if _recent.size() >= 30 and (_frame_no % 15 == 0 or _median == 0.0):
		_median = median_of(_recent)
	var spike := is_spike(ms, _median) and (_game_frames_since_start > 10 or ms > SPIKE_ABS_MS)
	if spike:
		_note_spike(ms, sec, added, pipes)
	var real_s := (now - _t_start_us) / 1.0e6
	if real_s - _trend_t >= TREND_EVERY_S:
		_trend_t = real_s
		_put(_trend_line(real_s))
	if real_s - _interim_t >= INTERIM_EVERY_S:
		_interim_t = real_s
		_put("# --- point d'étape : " + summary_line())

static var _load_phase_ms := 0.0

static func _pipes_now() -> PackedInt64Array:
	var a := PackedInt64Array()
	for k in [RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_CANVAS, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_MESH,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SURFACE, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_DRAW,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SPECIALIZATION]:
		a.append(RenderingServer.get_rendering_info(k))
	return a

func _note_spike(ms: float, sec: Dictionary, added: int, _pipes: PackedInt64Array) -> void:
	last_spike_ms = ms
	var now_ms := Time.get_ticks_msec()
	var evs: Array = []
	var ev_text: PackedStringArray = []
	for e: Array in _events.slice(maxi(0, _events.size() - 24)):
		if now_ms - int(e[0]) <= EVENT_WINDOW_MS:
			evs.append(e[2])
			ev_text.append("t=%.2f %s" % [float(e[1]), e[2]])
	var cause := attribute(ms, sec, added, evs)
	var known := 0
	var parts: PackedStringArray = []
	var keys := sec.keys()
	keys.sort()
	for k in keys:
		known += int(sec[k])
		parts.append("%s %.1f" % [k, int(sec[k]) / 1000.0])
	var vp := _vp
	var rec := {
		"ms": ms, "cause": cause, "t": game_time, "real": (Time.get_ticks_usec() - _t_start_us) / 1.0e6,
	}
	_spikes.append(rec)
	var info: Dictionary = info_cb.call() if info_cb.is_valid() else {}
	var info_text: PackedStringArray = []
	for k in info:
		info_text.append("%s %s" % [k, str(info[k])])
	_put("SPIKE réel %.1f s | jeu %.2f s | %.1f ms (médiane %.1f) | cause %s\n   sections ms : %s | hors sections %.1f | moteur : traitement %.1f, physique %.1f, rendu CPU %.1f, rendu GPU %.1f\n   compteurs : objets %d, noeuds %d, orphelins %d, ressources %d, appels %d, triangles %.0f k, mém %.0f Mo, VRAM %.0f Mo | %s\n   évènements : %s" % [
		rec["real"], game_time, ms, _median, cause, ", ".join(parts), maxf(0.0, ms - known / 1000.0),
		Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu(), RenderingServer.viewport_get_measured_render_time_gpu(vp),
		int(Performance.get_monitor(Performance.OBJECT_COUNT)), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)), int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0,
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, ", ".join(info_text),
		" ; ".join(ev_text) if not ev_text.is_empty() else "(aucun)"])

func _trend_line(real_s: float) -> String:
	var info: Dictionary = info_cb.call() if info_cb.is_valid() else {}
	var info_text: PackedStringArray = []
	for k in info:
		info_text.append("%s %s" % [k, str(info[k])])
	var s := _frames_all.duplicate()
	return "TREND réel %.0f s | jeu %.0f s | image moy. %.2f ms | objets %d, noeuds %d, orphelins %d, ressources %d, mém %.0f Mo, VRAM %.0f Mo | %s" % [
		real_s, game_time, _mean(s), int(Performance.get_monitor(Performance.OBJECT_COUNT)), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)), int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, ", ".join(info_text)]

static func _mean(a: PackedFloat32Array) -> float:
	if a.is_empty():
		return 0.0
	var t := 0.0
	for v in a:
		t += v
	return t / a.size()

# ---------------------------------------------------------------- résumé
## Statistiques d'une série de durées (ms) : { n, mean, p50, p90, p99, p999, max, over25, over50, over100 }.
static func stats_of(frames: PackedFloat32Array) -> Dictionary:
	var s := frames.duplicate()
	s.sort()
	var o25 := 0
	var o50 := 0
	var o100 := 0
	for v in frames:
		if v > 25.0:
			o25 += 1
		if v > 50.0:
			o50 += 1
		if v > 100.0:
			o100 += 1
	return {"n": frames.size(), "mean": _mean(frames), "p50": percentile(s, 0.5), "p90": percentile(s, 0.9), "p99": percentile(s, 0.99), "p999": percentile(s, 0.999),
		"max": s[s.size() - 1] if not s.is_empty() else 0.0, "over25": o25, "over50": o50, "over100": o100}

static func summary_line() -> String:
	var st := stats_of(_frames_all)
	return "%d images de jeu, moyenne %.2f ms, p50 %.2f, p99 %.2f, p99.9 %.2f, pire %.1f ms ; > 25 ms : %d, > 50 ms : %d, > 100 ms : %d ; pics notés %d" % [
		st["n"], st["mean"], st["p50"], st["p99"], st["p999"], st["max"], st["over25"], st["over50"], st["over100"], _spikes.size()]

## Écrit le résumé final (idempotent).
static func finish() -> void:
	if not on or _finished:
		return
	_finished = true
	var st := stats_of(_frames_all)
	var out: PackedStringArray = []
	out.append("")
	out.append("=== RÉSUMÉ ===")
	out.append("Durée réelle %.0f s, temps de jeu %.0f s, %d images de jeu." % [(Time.get_ticks_usec() - _t_start_us) / 1.0e6, game_time, st["n"]])
	out.append("Durée d'image (ms) : moyenne %.2f, médiane %.2f, p90 %.2f, p99 %.2f, p99.9 %.2f, pire %.1f." % [st["mean"], st["p50"], st["p90"], st["p99"], st["p999"], st["max"]])
	out.append("Images > 25 ms : %d ; > 50 ms : %d ; > 100 ms : %d. Pics notés (> 25 ms ou > %.1f x médiane) : %d." % [st["over25"], st["over50"], st["over100"], SPIKE_REL, _spikes.size()])
	if _load_phase_ms > 0.0:
		out.append("Pire image pendant le chargement : %.0f ms (la barre de progression reste animée)." % _load_phase_ms)
	var by_cause := {}
	for r in _spikes:
		var c := String(r["cause"]).split(":")[0]
		by_cause[c] = int(by_cause.get(c, 0)) + 1
	var causes: PackedStringArray = []
	for k in by_cause:
		causes.append("%s %d" % [k, by_cause[k]])
	out.append("Pics par famille de cause : %s" % (", ".join(causes) if not causes.is_empty() else "(aucun)"))
	var worst := _spikes.duplicate()
	worst.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["ms"]) > float(b["ms"]))
	out.append("Les 10 pires pics :")
	for i in mini(10, worst.size()):
		out.append("  %2d. %.1f ms à %.1f s de jeu (réel %.1f s) : %s" % [i + 1, worst[i]["ms"], worst[i]["t"], worst[i]["real"], worst[i]["cause"]])
	if not _loads.is_empty():
		var big := _loads.duplicate()
		big.sort_custom(func(a: Array, b: Array) -> bool: return int(a[2]) > int(b[2]))
		out.append("Chargements de ressources les plus longs pendant la partie :")
		for i in mini(8, big.size()):
			out.append("  %.1f ms  %s %s" % [int(big[i][2]) / 1000.0, big[i][0], big[i][1]])
	out.append("Mémoire : %.0f Mo, objets %d, noeuds %d, VRAM %.0f Mo." % [Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)), Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0])
	var pipes := _pipes_now()
	out.append("Pipelines compilés au total : canvas %d, maillage %d, surface %d, dessin %d, spécialisation %d." % [pipes[0], pipes[1], pipes[2], pipes[3], pipes[4]])
	_put("\n".join(out))
	print("\n".join(out))
	_file.close()
	_file = null

## Pour les tests : remet l'état statique à zéro.
static func reset_for_tests() -> void:
	on = false
	_sections.clear()
	_events.clear()
	_frames_all = PackedFloat32Array()
	_recent = PackedFloat32Array()
	_spikes.clear()
	_median = 0.0
	_finished = false
	_loads.clear()
	_load_phase_ms = 0.0
	_frame_no = 0
	_game_frames_since_start = 0
	_file = null
	_inst = null
