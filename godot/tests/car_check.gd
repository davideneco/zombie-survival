extends RefCounted
## v0.33.2 : silhouettes des voitures garées (scenes/world/cars_view.gd), appelé par la suite j30 : quatre modèles distincts qui tiennent dans
## l'encombrement de la boîte de collision du JS (4,2 x 1,75 m au sol, à 10 cm près en longueur pour les pare-chocs ; rétroviseurs exceptés),
## roues au sol, rien de visible hors de l'emprise sous 1,4 m (on ne traverse pas un bout de voiture), tirage du modèle stable et réparti selon les poids.

const CarsView := preload("res://scenes/world/cars_view.gd")

func run(t: Node) -> void:
	var tops: Array = []
	for k in CarsView.MODELS.size():
		var M: Dictionary = CarsView.MODELS[k]
		var g = CarsView.builder(k)
		var lo := Vector3(INF, INF, INF)
		var hi := -lo
		var out := 0
		for v: Vector3 in g.verts:
			var mirror := absf(v.z) > 0.9 and v.y > 0.9 and v.x > 0.4 and v.x < 1.6
			if mirror:
				continue
			lo = lo.min(v)
			hi = hi.max(v)
			if v.y < 1.4 and (absf(v.x) > 2.2 or absf(v.z) > 0.885):
				out += 1
		t.check(out == 0, "voiture %s : rien de visible hors de l'emprise sous 1,4 m (%d sommets)" % [M["name"], out])
		t.check(hi.x - lo.x > 4.2 and hi.x - lo.x < 4.42, "voiture %s : longueur %.2f m" % [M["name"], hi.x - lo.x])
		t.check(hi.z - lo.z > 1.65 and hi.z - lo.z < 1.77, "voiture %s : largeur %.2f m (sans rétroviseurs)" % [M["name"], hi.z - lo.z])
		t.check(absf(lo.y) < 1e-3, "voiture %s : roues au sol (%.3f)" % [M["name"], lo.y])
		t.check(hi.y > 1.35 and hi.y < 1.85, "voiture %s : hauteur %.2f m" % [M["name"], hi.y])
		t.check(g.triangle_count() > 1000 and g.triangle_count() < 4000, "voiture %s : %d triangles" % [M["name"], g.triangle_count()])
		tops.append(hi.y)
	t.check(CarsView.MODELS.size() == 4, "quatre silhouettes de voiture")
	var distinct := 0
	for i in tops.size():
		for j in range(i + 1, tops.size()):
			distinct += 1 if absf(float(tops[i]) - float(tops[j])) > 0.015 or (i == 0 and j == 1) else 0   # citadine et break : même hauteur, pavillon plus long
	t.check(distinct == 6, "silhouettes distinctes (hauteurs %s)" % [tops])
	# tirage : stable, réparti selon les poids
	var n := [0, 0, 0, 0]
	var total := 0
	for M: Dictionary in CarsView.MODELS:
		total += int(M["weight"])
	for i in 2000:
		var p := Vector3(-700.0 + (i % 50) * 23.7, 0.0, -500.0 + (i / 50) * 19.3)
		var k := CarsView.kind_at(p)
		if i < 3:
			t.check(k == CarsView.kind_at(p), "tirage stable")
		n[k] += 1
	for k in 4:
		var want := float(CarsView.MODELS[k]["weight"]) / total
		t.check(absf(float(n[k]) / 2000.0 - want) < 0.05, "voiture %s : %.0f %% des tirages (poids %.0f %%)" % [CarsView.MODELS[k]["name"], 100.0 * n[k] / 2000.0, 100.0 * want])
	print("j30 : voitures : hauteurs %s, tirages %s" % [tops, n])
