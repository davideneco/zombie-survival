class_name BossIntro
extends Node
## v0.20.1 : courte intro animée à la première apparition de chaque boss (Bourreau, Maître Tanneur, Ange) : la caméra se tourne vers lui, l'écran s'assombrit
## (bandes de cinéma, vignette), rugissement, titre. Elle MASQUE le chargement de la première apparition : pendant ce temps (2,6 s), la simulation est en pause
## (main.gd saute Game.step : joueur protégé, zombies figés, minuterie du jeu arrêtée) et les vues, matériaux, textures et effets du boss sont créés / dessinés
## UNE petite tâche par image (au lieu d'un gel de 80 à 110 ms à l'apparition : mesure dans docs/GODOT_PORT.md, section v0.20.1).
## Purement cosmétique : aucune écriture dans la simulation (la pause est une absence de pas ; le joueur n'est pas déplacé, seule la caméra est surchargée).
## Une seule fois par type de boss et par processus (ensuite tout est chaud). `--no-boss-intro` la coupe ; les bots (--bot, --soak, --perf-soak) la sautent.

const GfxAssets := preload("res://scenes/gfx_assets.gd")
const DURATION := 2.6            ## durée de l'intro (s), temps réel
const HARD_CAP := 4.5            ## pause bornée : au-delà, l'intro se termine quoi qu'il arrive (tâches de préchauffage en retard)
const TASK_START := 0.5          ## les tâches commencent quand l'écran est déjà bien sombre
const WARM_SCALE := 0.02
const TURN_MAX := deg_to_rad(80.0)
const TITLES := {
	"boss": ["LE BOURREAU", "Acte II — le sol de la croisée se fend…"],
	"tanner": ["MAÎTRE TANNEUR", "L'odeur le précède…"],
	"angel": ["L'ANGE DU JUGEMENT", "Acte V — le dernier jugement"],
}

static var enabled := true       ## --no-boss-intro : faux
static var played: Dictionary = {}   ## type -> true : déjà jouée dans ce processus (vues et shaders chauds)

var active := false
var t := 0.0
var kind := ""
var frames := 0
var tasks_done := 0
var tasks_total := 0
var max_task_ms := 0.0
var boss: ZombieSim
var _cam: Camera3D
var _hud: CanvasLayer
var _finale_view: Node3D
var _make_view: Callable
var _tasks: Array[Callable] = []
var _layer: CanvasLayer
var _bar_top: ColorRect
var _bar_bot: ColorRect
var _vignette: TextureRect
var _title: Label
var _sub: Label
var _warm_holder: Node3D
var _warm_sim: ZombieSim
var _warm_view: Node3D
var _warm_meshes: Array[MeshInstance3D] = []
var _sounds: Dictionary = {}
var _cam_basis := Basis.IDENTITY
var _base_fov := 75.0
var _done_cb: Callable
var _real_done := false
var _rng := RandomNumberGenerator.new()

## Type de boss d'une simulation : "boss" (Bourreau), "tanner", "angel" ; "" pour un zombie ordinaire.
static func kind_of(z: ZombieSim) -> String:
	if z is AngelSim:
		return "angel"
	if z is TannerSim:
		return "tanner"
	if z is BossSim:
		return "boss"
	return ""

## L'intro doit-elle se jouer pour ce zombie ? (boss d'un type jamais joué, intro permise)
static func wants(z: ZombieSim) -> bool:
	var k := kind_of(z)
	return enabled and k != "" and not played.has(k)

## Courbes de l'intro à l'instant t (s) : dark (assombrissement 0..0,8), bars (bandes 0..1), turn (la caméra se tourne vers le boss, 0..1), title (0..1), shake (0..1), fov (réduction en degrés).
static func shape(tt: float, dur := DURATION) -> Dictionary:
	var rise := smoothstep(0.0, 0.4, tt)
	var fall := 1.0 - smoothstep(dur - 0.6, dur, tt)
	var turn := smoothstep(0.3, 1.1, tt) * (1.0 - smoothstep(dur - 0.8, dur - 0.1, tt))
	var title := smoothstep(0.5, 0.95, tt) * (1.0 - smoothstep(dur - 0.7, dur - 0.2, tt))
	var shake := 0.25 * rise * fall + 0.75 * smoothstep(0.8, 1.1, tt) * (1.0 - smoothstep(1.7, 2.3, tt))
	return {"dark": 0.8 * rise * fall, "bars": smoothstep(0.0, 0.45, tt) * (1.0 - smoothstep(dur - 0.35, dur, tt)), "turn": turn, "title": title, "shake": shake, "fov": 12.0 * turn}

func setup(cam: Camera3D, hud: CanvasLayer, finale_view: Node3D, make_view: Callable) -> void:
	_cam = cam
	_hud = hud
	_finale_view = finale_view
	_make_view = make_view
	_rng.seed = 4242

## Lance l'intro pour ce boss (qui vient d'apparaître : sa vue n'est PAS encore créée, l'intro la crée au bon moment).
func begin(z: ZombieSim, done: Callable = Callable()) -> void:
	kind = kind_of(z)
	boss = z
	_done_cb = done
	played[kind] = true
	active = true
	t = 0.0
	frames = 0
	tasks_done = 0
	max_task_ms = 0.0
	_real_done = false
	_base_fov = _cam.fov
	_build_overlay()
	_plan_tasks()
	tasks_total = _tasks.size()
	if _hud != null and _hud.has_method("set_cinema"):
		_hud.set_cinema(true)
		_hud.intro_hold = true
	PerfLog.event("intro de boss (%s) : début, %d tâches de préchauffage" % [kind, tasks_total])

func _build_overlay() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 30
	add_child(_layer)
	var g := Gradient.new()
	g.colors = PackedColorArray([Color(0, 0, 0, 0.0), Color(0, 0, 0, 0.0), Color(0.02, 0.0, 0.0, 1.0)])
	g.offsets = PackedFloat32Array([0.0, 0.35, 1.0])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.8)
	tex.width = 256
	tex.height = 256
	_vignette = TextureRect.new()
	_vignette.texture = tex
	_vignette.stretch_mode = TextureRect.STRETCH_SCALE
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_vignette)
	var dim := ColorRect.new()   # fond sombre uniforme sous la vignette
	dim.color = Color(0.02, 0.0, 0.0, 1.0)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.name = "Dim"
	_layer.add_child(dim)
	_layer.move_child(dim, 0)
	_bar_top = ColorRect.new()
	_bar_bot = ColorRect.new()
	for b in [_bar_top, _bar_bot]:
		b.color = Color.BLACK
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_layer.add_child(b)
	var info: Array = TITLES[kind]
	_title = _label(String(info[0]), 72, Color("ff4a2a") if kind != "angel" else Color("ffe08a"))
	_sub = _label(String(info[1]), 28, Color("e8e0d0"))

func _label(text: String, size: int, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", maxi(6, size / 6))
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("shadow_offset_x", 4)
	l.add_theme_constant_override("shadow_offset_y", 6)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.modulate.a = 0.0
	_layer.add_child(l)
	return l

# ------------------------------------------------------------------ tâches de préchauffage (une par image)
func _plan_tasks() -> void:
	_tasks.clear()
	# 1. ressources de peau des boss en primitives (textures de chair et de tissu : 11 et 12 ms chacune, jamais chargées par les zombies à modèle animé)
	_tasks.append(func() -> void: GfxAssets.texture("zombie_flesh.png"))
	_tasks.append(func() -> void: GfxAssets.texture("zombie_cloth.png"))
	_tasks.append(func() -> void: GfxAssets.texture("zombie_blood.png"))
	_tasks.append(func() -> void: GfxAssets.zombie_mesh("head"))
	# 2. une vue jetable du même type de boss, devant la caméra, dont les pièces sont montrées deux par deux (chaque matériau compile ses pipelines à son premier dessin)
	_tasks.append(_warm_build)
	for i in 40:
		_tasks.append(_warm_reveal)
	_tasks.append(_warm_free)
	# 3. effets de la fin de partie propres à ce boss (anneaux, cônes, chaînes, plumes, rayon : matériaux additifs)
	for ev: Array in _effects():
		_tasks.append(func() -> void: _warm_effect(String(ev[0]), ev[1] as Dictionary))
	_tasks.append(func() -> void: _finale_view.clear())
	# 4. la vraie vue du boss (matériaux et textures déjà chauds : il ne reste que la construction des noeuds)
	_tasks.append(_real_view)

func _anchor() -> Vector3:
	return _warm_holder.global_position if _warm_holder != null else Vector3.ZERO

func _warm_build() -> void:
	_warm_holder = Node3D.new()
	_warm_holder.top_level = true
	_warm_holder.scale = Vector3.ONE * WARM_SCALE   # minuscule : dessinée (donc ses pipelines compilés) mais invisible sous l'assombrissement
	add_child(_warm_holder)
	var s: ZombieSim
	match kind:
		"angel":
			s = AngelSim.new(1.0, null)
			(s as AngelSim)._set_state("orbit")
		"tanner":
			s = TannerSim.new(1000.0, null)
		_:
			s = BossSim.new(1000.0, null)
			(s as BossSim).state = "chase"
	s.id = 910000 + absi(hash(kind)) % 1000
	s.rng = _rng
	s.health = s.max_health
	_warm_sim = s
	s.pos = Vector3.ZERO
	_place_warm()
	_warm_view = _make_view.call(s, _warm_holder)
	if _warm_view != null:
		_warm_meshes.clear()
		for n in _warm_view.find_children("*", "MeshInstance3D", true, false):
			var mi := n as MeshInstance3D
			if mi.visible:
				mi.visible = false
				_warm_meshes.append(mi)

func _place_warm() -> void:
	if _warm_sim == null or _warm_holder == null:
		return
	# dans la bande noire du bas (32 degrés sous l'axe, à 0,9 m) : dessiné, donc ses pipelines compilés, mais couvert par la bande de cinéma
	var b := _cam.global_transform.basis
	_warm_holder.global_position = _cam.global_position + b * (Vector3(0.0, -sin(deg_to_rad(33.0)), -cos(deg_to_rad(33.0))) * 0.9)
	_warm_holder.global_basis = Basis.IDENTITY.scaled(Vector3.ONE * WARM_SCALE)
	_warm_sim.yaw = 0.0
	if _warm_view != null and _warm_view.has_method("remember"):
		_warm_view.remember()

func _warm_reveal() -> void:
	for _k in 2:
		if _warm_meshes.is_empty():
			return
		var mi: MeshInstance3D = _warm_meshes.pop_front()
		if is_instance_valid(mi):
			mi.visible = true

func _warm_free() -> void:
	for mi in _warm_meshes:
		if is_instance_valid(mi):
			mi.visible = true
	_warm_meshes.clear()
	if _warm_view != null and is_instance_valid(_warm_view):
		_warm_view.queue_free()
	_warm_view = null
	_warm_sim = null

## [évènement du FinaleView, données] pour chaque effet du boss (positions relatives à l'ancre devant la caméra).
func _effects() -> Array:
	match kind:
		"tanner":
			return [["tanner_vomit", {"dx": 0.0, "dz": 1.0, "range": 8.0, "ang": 30.0, "tel": 1.0, "dur": 0.8}], ["burst", {}], ["dust", {"n": 10}]]
		"angel":
			return [["angel_trumpet", {"dx": 0.0, "dz": 1.0, "range": 12.0, "ang": 25.0, "tel": 0.7, "dur": 0.6, "fy": 0.0}],
				["angel_plumes", {"dirs": [[0.0, 0.0, 1.0], [0.3, 0.0, 1.0]], "speed": 16.0, "life": 2.0}],
				["angel_judge", {"tx": 0.0, "ty": 0.0, "tz": 3.0}], ["angel_death", {}]]
		_:
			return [["boss_shock", {}], ["boss_tele", {"dx": 0.0, "dz": 1.0}], ["boss_chain", {"dx": 0.0, "dz": 1.0, "w": 0.6, "len": 10.0, "tel": 0.8}],
				["boss_axe", {"dx": 0.0, "dz": 1.0, "w": 1.0, "len": 10.0, "tel": 0.8, "flight": 0.6}],
				["boss_fire", {"pts": [[0.0, 3.0]], "r": 2.0, "tel": 1.0, "dur": 1.0}], ["boss_rise", {}], ["dust", {"n": 10}]]

func _warm_effect(name: String, d: Dictionary) -> void:
	var a := _anchor()
	if a == Vector3.ZERO:
		a = _cam.global_position - _cam.global_transform.basis.z * 6.0
	var dd := d.duplicate()
	dd["x"] = a.x + float(d.get("x", 0.0))
	dd["y"] = a.y
	dd["z"] = a.z + float(d.get("z", 0.0))
	if name == "boss_fire":
		var pts: Array = []
		for pt: Array in d["pts"]:
			pts.append([a.x + float(pt[0]), a.z + float(pt[1])])
		dd["pts"] = pts
	if name == "angel_judge":
		dd["tx"] = a.x + float(d["tx"])
		dd["ty"] = a.y
		dd["tz"] = a.z + float(d["tz"])
	_finale_view.silent = true
	_finale_view._on_event(name, dd)
	_finale_view.silent = false

func _real_view() -> void:
	if _real_done:
		return
	_real_done = true
	if boss != null and _make_view.is_valid():
		_make_view.call(boss, null)

# ------------------------------------------------------------------ image par image (appelé par main.gd après la mise à jour de la caméra)
## Une image de l'intro : exécute UNE tâche, anime l'overlay, surcharge la caméra. Renvoie true tant que l'intro dure.
func tick(dt: float, p_yaw: float, p_pitch: float) -> bool:
	if not active:
		return false
	t += dt
	frames += 1
	var sh := shape(t)
	if t >= TASK_START and not _tasks.is_empty():
		var t0 := Time.get_ticks_usec()
		(_tasks.pop_front() as Callable).call()
		tasks_done += 1
		max_task_ms = maxf(max_task_ms, (Time.get_ticks_usec() - t0) / 1000.0)
	_animate(sh)
	_camera(sh, p_yaw, p_pitch)
	_place_warm()
	_sound_cues()
	if (t >= DURATION and _tasks.is_empty()) or t >= HARD_CAP:
		_finish()
		return false
	return true

func _animate(sh: Dictionary) -> void:
	var size := _layer.get_viewport().get_visible_rect().size
	_vignette.size = size
	_layer.get_node("Dim").size = size
	(_layer.get_node("Dim") as ColorRect).modulate.a = float(sh["dark"]) * 0.55
	_vignette.modulate.a = minf(1.0, float(sh["dark"]) / 0.8)
	var bh := size.y * 0.13 * float(sh["bars"])
	_bar_top.position = Vector2(0, 0)
	_bar_top.size = Vector2(size.x, bh)
	_bar_bot.position = Vector2(0, size.y - bh)
	_bar_bot.size = Vector2(size.x, bh)
	_title.size = Vector2(size.x, 100.0)
	_title.position = Vector2(0, size.y * 0.40)
	_title.modulate.a = float(sh["title"])
	_sub.size = Vector2(size.x, 40.0)
	_sub.position = Vector2(0, size.y * 0.40 + 96.0)
	_sub.modulate.a = float(sh["title"]) * 0.9

func _camera(sh: Dictionary, p_yaw: float, p_pitch: float) -> void:
	var from := Basis.from_euler(Vector3(p_pitch, p_yaw, 0.0), EULER_ORDER_YXZ)
	var target := (boss.pos + Vector3(0, 1.1 * boss.scale_override if kind != "angel" else 1.0, 0)) if boss != null else _cam.global_position + from * Vector3.FORWARD
	var dir := target - _cam.global_position
	var want := from
	if dir.length() > 0.5:
		want = Basis.looking_at(dir.normalized(), Vector3.UP)
	var ang := from.get_rotation_quaternion().angle_to(want.get_rotation_quaternion())
	var k := float(sh["turn"]) * (minf(1.0, TURN_MAX / ang) if ang > 0.001 else 1.0)
	_cam_basis = from.slerp(want, k)
	_cam.basis = _cam_basis
	_cam.fov = _base_fov - float(sh["fov"])
	var sk := float(sh["shake"])
	if sk > 0.0:
		_cam.position += Vector3(_rng.randf() - 0.5, _rng.randf() - 0.5, _rng.randf() - 0.5) * sk * 0.12

func _sound_cues() -> void:
	# rugissement : grondement dès l'assombrissement, puis cri et choc au moment du titre
	for cue: Array in [[0.15, "rumble", 0.8], [0.95, "groan", 1.0], [1.0, "nuke", 0.55]]:
		var key := String(cue[1]) + str(cue[0])
		if t >= float(cue[0]) and not _sounds.has(key):
			_sounds[key] = true
			Sfx.play(String(cue[1]), float(cue[2]))

func _finish() -> void:
	active = false
	_real_view()   # (pause bornée atteinte avant la dernière tâche : la vue du boss doit exister)
	_warm_free()
	if _warm_holder != null:
		_warm_holder.queue_free()
		_warm_holder = null
	_tasks.clear()
	_sounds.clear()
	_cam.fov = _base_fov
	if _layer != null:
		_layer.queue_free()
		_layer = null
	if _hud != null and _hud.has_method("set_cinema"):
		_hud.set_cinema(false)
		_hud.intro_hold = false
	PerfLog.event("intro de boss (%s) : fin après %.2f s, %d images, %d tâches, tâche la plus longue %.1f ms" % [kind, t, frames, tasks_done, max_task_ms])
	if _done_cb.is_valid():
		_done_cb.call()
