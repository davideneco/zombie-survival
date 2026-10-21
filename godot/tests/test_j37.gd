extends RefCounted
## v0.30.0 : body of the drivable tram built by code (scenes/tram_body.gd, Citadis 405 of the CTS in spirit). Port only. The simulation keeps the
## dimensions of the JS (5 modules of 4.7 m = 23.5 m, doors, seats): the new body must fit them.
##   - nose: inside the module (tip <= 2.2 m from its middle, the JS nose length), raked windscreen (top behind the bottom), rounded corners;
##   - every module shell within 2.2 m of its middle along the tram and 1.2 m aside, nothing below 0.18 m (rails), roof at 3.38 m (+ pantograph);
##   - door openings where the baked doors are (car.json doorsAt), windows never over a door;
##   - the driver's eye (car.json seats) sees out through the windscreen: the glass is ahead of it, between its eye height and the desk.

func run(t: Node) -> void:
	if not FileAccess.file_exists("res://assets/tram/car.json"):
		t.check(true, "j37 : rame cuite absente, suite sautée")
		return
	var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/tram/car.json"))
	t.near(float(meta["L"]), 23.5, "longueur de la rame inchangée")
	var xs := TramBody.HALF - TramBody.NOSE
	var tip := 0.0
	for j in 33:
		var y := lerpf(TramBody.BOT, 3.38, float(j) / 32.0)
		for k in 21:
			var s := lerpf(-1.0, 1.0, float(k) / 20.0)
			var p := TramBody.nose_p(xs, y, s)
			tip = maxf(tip, p.x)
			if k % 10 == 0 and j % 8 == 0:
				t.check(absf(p.z) <= 1.2 + 1e-4, "nez : dans la largeur (%.2f, %.2f)" % [y, s])
	t.check(tip <= TramBody.HALF + 1e-4 and tip > TramBody.HALF - 0.05, "nez : pointe à %.3f m du milieu du module (<= 2,2, comme le JS)" % tip)
	t.check(TramBody.nose_f(2.42, 0.0) < TramBody.nose_f(1.15, 0.0) - 0.3, "pare-brise incliné : le haut est en retrait de plus de 30 cm")
	t.check(TramBody.nose_f(1.6, 0.95) < TramBody.nose_f(1.6, 0.0) - 0.15, "nez : coins arrondis en plan")
	var n := int(meta["modules"].size())
	for i in n:
		var doors: Array = []
		for d: Dictionary in meta["doorsAt"]:
			if int(d["module"]) == i and int(d["side"]) == 1:
				doors.append(float(d["x"]))
		var B: Dictionary = TramBody.build_module(i, n, doors, [-1.3, 1.3])
		var root: Node3D = B["node"]
		var mi: MeshInstance3D = null
		for c in root.get_children():
			if c is MeshInstance3D and (c as MeshInstance3D).mesh is ArrayMesh and (c as MeshInstance3D).mesh.get_surface_count() >= 2:
				mi = c
				break
		t.check(mi != null, "module %d : coque construite" % i)
		if mi == null:
			continue
		var bb := mi.mesh.get_aabb()
		t.check(bb.position.x >= -TramBody.HALF - 1e-3 and bb.end.x <= TramBody.HALF + 1e-3, "module %d : coque dans les 4,4 m du module (%.2f .. %.2f)" % [i, bb.position.x, bb.end.x])
		t.check(bb.position.y >= TramBody.BOT - 1e-3 and bb.end.y <= 3.381, "module %d : du bas de jupe au toit" % i)
		t.check(absf(bb.position.z) <= 1.2 + 1e-3 and bb.end.z <= 1.2 + 1e-3, "module %d : 2,4 m de large" % i)
		# door openings: no shell triangle of the side wall in the middle of a door
		var arr := mi.mesh.surface_get_arrays(mi.mesh.get_surface_count() - 2)
		var pv: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		for dc: float in doors:
			var blocked := false
			for v in range(0, pv.size(), 3):
				var c3 := (pv[v] + pv[v + 1] + pv[v + 2]) / 3.0
				if absf(c3.x - dc) < 0.5 and c3.y > 0.5 and c3.y < 2.2 and absf(c3.z) > 1.1:
					blocked = true
			t.check(not blocked, "module %d : porte ouverte dans la coque en x = %.2f" % [i, dc])
		root.free()
	# the driver sees the windscreen: eye in front of nothing, glass between 1.15 and 2.42 m, ahead of the eye
	for s: Dictionary in meta["seats"]:
		if bool(s["driver"]) and int(s["module"]) == n - 1:
			var eye_x := -float(s["eye"][2])   # seats: group frame (z backward) -> module x
			var eye_y := float(s["eye"][1])
			var wx := xs + TramBody.nose_f(eye_y, 0.0)
			t.check(wx - eye_x > 1.0 and wx - eye_x < 3.0, "cabine : pare-brise à %.2f m devant l'œil du conducteur" % (wx - eye_x))
			t.check(eye_y > 1.15 and eye_y < 2.42, "cabine : l'œil (%.2f m) est à hauteur du pare-brise" % eye_y)
