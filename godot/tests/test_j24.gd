extends RefCounted
## v0.20.1 : intro de boss (BossIntro) : courbes bornées, une fois par type, pause bornée, vue du boss créée UNE fois, préchauffage rangé, simulation du boss intouchée,
## bots et --no-boss-intro la sautent. (La pause elle-même est l'absence d'appel de Game.step dans main.gd : mesurée dans les journaux de performance, voir la doc.)

const FxView := preload("res://scenes/fx_view.gd")
const FinaleView := preload("res://scenes/finale_view.gd")
const DT := 1.0 / 60.0

func run(t: Node) -> void:
	_curves(t)
	_kinds(t)
	_play(t)

func _curves(t: Node) -> void:
	var a := BossIntro.shape(0.0)
	var b := BossIntro.shape(BossIntro.DURATION)
	for k in ["dark", "bars", "turn", "title", "shake", "fov"]:
		t.check(absf(float(a[k])) < 1e-6 and absf(float(b[k])) < 1e-6, "courbe %s : nulle au début et à la fin" % k)
	var peak := 0.0
	var i := 0.0
	var ok := true
	while i <= BossIntro.DURATION:
		var s := BossIntro.shape(i)
		peak = maxf(peak, float(s["dark"]))
		for k in ["dark", "bars", "turn", "title", "shake"]:
			ok = ok and float(s[k]) >= 0.0 and float(s[k]) <= 1.0
		i += DT
	t.check(ok, "courbes : valeurs dans [0, 1]")
	t.check(peak <= 0.8 + 1e-6 and peak > 0.7, "assombrissement : au plus 80 %% (%.2f)" % peak)
	t.check(float(BossIntro.shape(1.4)["title"]) > 0.99 and float(BossIntro.shape(1.4)["turn"]) > 0.99, "à mi-intro : titre plein, caméra tournée vers le boss")
	t.check(BossIntro.HARD_CAP >= BossIntro.DURATION and BossIntro.HARD_CAP <= 5.0 and BossIntro.DURATION <= 3.0, "pause bornée : 2,6 s (au plus 4,5 s)")

func _kinds(t: Node) -> void:
	var z := ZombieSim.new()
	t.check(BossIntro.kind_of(z) == "" and not BossIntro.wants(z), "zombie ordinaire : pas d'intro")
	t.check(BossIntro.kind_of(BossSim.new(100.0, null)) == "boss", "Bourreau : type boss")
	t.check(BossIntro.kind_of(TannerSim.new(100.0, null)) == "tanner", "Tanneur : type tanner")
	t.check(BossIntro.kind_of(AngelSim.new(100.0, null)) == "angel", "Ange : type angel")
	for k in BossIntro.TITLES:
		t.check((BossIntro.TITLES[k] as Array).size() == 2 and String((BossIntro.TITLES[k] as Array)[0]) != "", "titre de %s" % k)

func _play(t: Node) -> void:
	var held := BossIntro.played.duplicate()
	BossIntro.played.clear()
	var host := Node3D.new()
	t.add_child(host)
	var cam := Camera3D.new()
	cam.fov = 75.0
	host.add_child(cam)
	cam.position = Vector3(10, 1.7, 5)
	var hud := CanvasLayer.new()
	host.add_child(hud)
	var fx := FxView.new()
	host.add_child(fx)
	fx.setup(cam)
	var fv := FinaleView.new()
	host.add_child(fv)
	fv.setup(cam, fx)
	var made: Array = []
	var make := func(z: ZombieSim, parent: Node3D) -> Node3D:
		var v := Node3D.new()
		v.set_script(load("res://scenes/zombie_view.gd"))
		(parent if parent != null else host).add_child(v)
		v.setup(z)
		made.append([z, parent == null])
		return v
	for kind_spec in [["boss", BossSim.new(1000.0, null)], ["tanner", TannerSim.new(1000.0, null)], ["angel", AngelSim.new(1000.0, null)]]:
		var kind: String = kind_spec[0]
		var boss: ZombieSim = kind_spec[1]
		boss.id = 777
		boss.pos = Vector3(20, 0, 8)
		var before := [boss.pos, boss.health, boss.state, boss.yaw, Game.time if Game.player != null else 0.0]
		var yaw0 := 0.4
		BossIntro.enabled = true
		t.check(BossIntro.wants(boss), "%s : première apparition : l'intro est voulue" % kind)
		BossIntro.enabled = false
		t.check(not BossIntro.wants(boss), "%s : --no-boss-intro la coupe" % kind)
		BossIntro.enabled = true
		var intro := BossIntro.new()
		host.add_child(intro)
		intro.setup(cam, hud, fv, make)
		made.clear()
		var done := [false]
		intro.begin(boss, func() -> void: done[0] = true)
		t.check(intro.active and BossIntro.played.has(kind), "%s : intro lancée, type noté joué" % kind)
		t.check(not BossIntro.wants(boss), "%s : jamais rejouée dans ce processus" % kind)
		var ticks := 0
		var fov_min := 999.0
		var turned := false
		while intro.tick(DT, yaw0, 0.0) and ticks < 1000:
			ticks += 1
			fov_min = minf(fov_min, cam.fov)
			if ticks == 80:
				var fwd := -cam.global_transform.basis.z
				var to_boss := (boss.pos - cam.global_position).normalized()
				turned = fwd.dot(to_boss) > 0.5   # la caméra s'est tournée vers le boss (en partie)
		t.check(not intro.active and done[0], "%s : l'intro se termine seule (%d images, %.2f s)" % [kind, ticks, intro.t])
		t.check(intro.t <= BossIntro.HARD_CAP + DT and intro.t >= BossIntro.DURATION - DT, "%s : durée bornée entre %.1f et %.1f s" % [kind, BossIntro.DURATION, BossIntro.HARD_CAP])
		t.check(intro.tasks_done == intro.tasks_total and intro.tasks_total > 30, "%s : %d tâches de préchauffage, toutes faites, une par image" % [kind, intro.tasks_done])
		t.check(turned, "%s : la caméra se tourne vers le boss" % kind)
		t.check(fov_min < 75.0 - 5.0 and absf(cam.fov - 75.0) < 1e-6, "%s : champ de vision resserré puis restitué" % kind)
		var real := made.filter(func(m: Array) -> bool: return m[1])
		var warm := made.filter(func(m: Array) -> bool: return not m[1])
		t.check(real.size() == 1 and real[0][0] == boss, "%s : la vraie vue du boss est créée une fois" % kind)
		t.check(warm.size() == 1, "%s : une vue jetable de préchauffage" % kind)
		t.check(intro.max_task_ms < 100.0, "%s : tâche la plus longue %.1f ms" % [kind, intro.max_task_ms])
		var leftovers := 0
		for c in intro.get_children():
			if not c.is_queued_for_deletion():
				leftovers += 1
		t.check(leftovers == 0, "%s : plus rien d'affiché ni de créé par l'intro (%d)" % [kind, leftovers])
		t.check(boss.pos == before[0] and boss.health == before[1] and boss.state == before[2] and boss.yaw == before[3], "%s : simulation du boss intouchée (position, santé, état, cap)" % kind)
		intro.queue_free()
	BossIntro.played = held
	host.queue_free()
