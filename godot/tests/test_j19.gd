extends RefCounted
## v0.17.3 : la rame conduisible est la VRAIE rame du JS (assets/tram, cuite par tools/bake-tram.mjs) et on y voit clair.
## Fichiers cuits cohérents avec la simulation (modules, sièges, portes, longueur) ; vue construite (5 modules, vantaux, vitres, lumières) ; vantaux qui coulissent ;
## vue de l'intérieur : de l'œil du conducteur (cabine avant) et d'un passager assis, AUCUNE face de la caisse tournée vers l'œil ne se trouve sur la ligne de
## visée (pare-brise, flancs et toit se « retirent » vus de l'intérieur) ; vue de l'extérieur : les mêmes rayons, pris de dehors, touchent bien la caisse
## (le test détecte donc un modèle plein) ; le pupitre reste dans le champ du conducteur ; rien dans les 5 cm devant l'œil (plan proche de la caméra).

const TramViewScript := preload("res://scenes/tram_view.gd")
const DIR := "res://assets/tram/"

func run(t: Node) -> void:
	t.check(TramViewScript.available(), "rame cuite présente (node tools/bake-tram.mjs)")
	if not TramViewScript.available():
		return
	Game.new_game(3, "strasbourg")
	var sim: TramSim = Game.rides.trams[0]
	var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(DIR + "car.json"))
	_files(t, meta, sim)
	var view := Node3D.new()
	view.set_script(TramViewScript)
	Game.add_child(view)
	view.setup(sim)
	_view(t, view, meta, sim)
	_sight(t, view, meta, sim)
	view.queue_free()

func _files(t: Node, meta: Dictionary, sim: TramSim) -> void:
	var mods: Array = meta["modules"]
	t.check(mods.size() == sim.n and mods.size() == 5, "rame cuite : %d modules (sim %d)" % [mods.size(), sim.n])
	t.near(float(meta["L"]), sim.L, "rame cuite : longueur", 1e-6)
	t.check((meta["seats"] as Array).size() == 16 and sim.model_seats.size() == 16, "rame cuite : 16 places")
	var ds: Array = meta["doorStarts"]
	t.check(ds.size() == sim.door_starts.size(), "rame cuite : %d portes" % ds.size())
	for i in ds.size():
		t.near(float(ds[i]), float(sim.door_starts[i]), "porte %d : début" % i, 1e-6)
	var bin := FileAccess.get_file_as_bytes(DIR + "car.bin")
	t.check(bin.slice(0, 4).get_string_from_ascii() == "TRM1", "car.bin : en-tête TRM1")
	var verts := 0
	var leaves := 0
	for m: Dictionary in mods:
		verts += int(m["body"]["n"]) + int(m["dark"]["n"])
		leaves += (m["leaves"] as Array).size()
		t.check(int(m["body"]["n"]) % 3 == 0 and int(m["dark"]["n"]) % 3 == 0, "module : sommets par triangles entiers")
	t.check(verts > 8000, "rame cuite : %d sommets (modèle du JS, pas des boîtes)" % verts)
	t.check(leaves == 16, "rame cuite : 16 vantaux de portes (4 portes x 2 côtés x 2 vantaux : %d)" % leaves)
	t.check(FileAccess.file_exists(DIR + "car_map.png") and FileAccess.file_exists(DIR + "car_emissive.png"), "livrée et émissive présentes")

func _count(n: Node, cls: String) -> int:
	var c := 1 if n.get_class() == cls else 0
	for k in n.get_children():
		c += _count(k, cls)
	return c

func _view(t: Node, view: Node3D, meta: Dictionary, sim: TramSim) -> void:
	t.check(view.get_child_count() == 5, "vue : un nœud par module (%d)" % view.get_child_count())
	t.check(view._leaves.size() == 16, "vue : 16 vantaux coulissants (%d)" % view._leaves.size())
	t.check(view._lights.size() == 5 and view._heads.size() == 2, "vue : 5 lumières intérieures, 2 phares")
	var wins := 0
	for m: Dictionary in meta["modules"]:
		for w: float in meta["windows"]:
			if absf(w + 0.525 - float(meta["L"]) / 2.0 - float(m["c"])) <= 2.35:
				wins += 2
	t.check(_count(view, "MeshInstance3D") >= 5 * 2 + 16 + wins, "vue : caisse, pièces sombres, vantaux et %d vitres" % wins)
	sim.door_f = 0.0
	view.apply(1.0)
	var closed: Vector3 = (view._leaves[0]["node"] as Node3D).position
	sim.door_f = 1.0
	view.apply(1.0)
	var opened: Vector3 = (view._leaves[0]["node"] as Node3D).position
	t.near(absf(opened.x - closed.x), 0.62, "vantail : course de 0,62 m", 1e-6)
	sim.door_f = 0.0
	view.apply(1.0)
	# la caisse est dans son gabarit (largeur 2,4 m, hauteur sous 4,6 m avec pantographe), longueur de la rame
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for mi in _all(view, "MeshInstance3D"):
		var bb: AABB = (mi as MeshInstance3D).get_aabb()
		var tr: Transform3D = (mi as MeshInstance3D).global_transform
		for c in 8:
			var p := tr * bb.get_endpoint(c)
			lo = lo.min(p)
			hi = hi.max(p)
	var ext := hi - lo
	# v0.30.0 : the single-arm pantograph reaches the contact wire (5.5 m)
	t.check(ext.y > 3.3 and ext.y < 5.7 and is_finite(ext.x) and is_finite(ext.z), "vue : hauteur %.2f m" % ext.y)
	t.check(maxf(ext.x, ext.z) > 22.5 and maxf(ext.x, ext.z) < 25.5, "vue : longueur %.1f m (rame de 23,5 m)" % maxf(ext.x, ext.z))

func _all(n: Node, cls: String, out := []) -> Array:
	if n.get_class() == cls:
		out.append(n)
	for k in n.get_children():
		_all(k, cls, out)
	return out

## Triangles de la caisse (livrée) du module i dans le repère « groupe » (x droite, y haut, z arrière) : [[a, b, c], ...] (sens horaire = face avant).
func _body_tris(view: Node3D, i: int) -> Array:
	var tris: Array = []
	var inner: Node3D = view.get_child(i).get_child(0)
	var mi: MeshInstance3D = inner.get_child(0).get_child(0)   # v0.30.0 : shell of TramBody (paint and glass surfaces)
	for sf in mi.mesh.get_surface_count():
		var arr: Array = mi.mesh.surface_get_arrays(sf)
		var pv: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		for k in range(0, pv.size(), 3):
			var tri: Array = []
			for j in 3:
				var q := pv[k + j]
				tri.append(Vector3(q.z, q.y, -q.x))   # inner tourne de PI/2 autour de y
			tris.append(tri)
	return tris

## Premier triangle FACE AVANT (vu de `eye`) touché par le rayon, distance ; INF si aucun.
func _first_front_hit(tris: Array, eye: Vector3, dir: Vector3, max_d: float) -> float:
	var best := INF
	for tri: Array in tris:
		var a: Vector3 = tri[0]
		var e1: Vector3 = tri[1] - a
		var e2: Vector3 = tri[2] - a
		var n := e1.cross(e2)
		if n.dot(eye - a) >= 0.0:   # horaire = face avant : on la voit quand la normale géométrique s'éloigne de l'œil
			continue
		var p := dir.cross(e2)
		var det := e1.dot(p)
		if absf(det) < 1e-9:
			continue
		var inv := 1.0 / det
		var s := eye - a
		var u := s.dot(p) * inv
		if u < 0.0 or u > 1.0:
			continue
		var q := s.cross(e1)
		var v := dir.dot(q) * inv
		if v < 0.0 or u + v > 1.0:
			continue
		var d := e2.dot(q) * inv
		if d > 0.0 and d < best:
			best = d
	return best

func _sight(t: Node, view: Node3D, meta: Dictionary, sim: TramSim) -> void:
	# conducteur de la cabine avant : place 0 (module 4), regard vers l'avant (-Z du repère groupe)
	var seat0: Dictionary = sim.model_seats[0]
	var eye := Vector3(seat0["eye"][0], seat0["eye"][1], seat0["eye"][2])
	var m_front := int(seat0["module"])
	var tris: Array = _body_tris(view, m_front)
	var worst := INF
	for dyaw in [-35.0, -20.0, 0.0, 20.0, 35.0]:
		for pitch in [-15.0, 0.0, 12.0]:
			var d := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(dyaw)).rotated(Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(dyaw)), deg_to_rad(pitch))
			worst = minf(worst, _first_front_hit(tris, eye, d.normalized(), 40.0))
	t.check(worst == INF, "conducteur : aucune face de la caisse sur la ligne de visée (%.2f m)" % worst)
	# test du test : vu de dehors, 6 m devant le nez, le même rayon (en sens inverse) touche la caisse
	var out_eye := Vector3(0, 1.9, -7.0)
	var hit := _first_front_hit(tris, out_eye, Vector3(0, 0, 1), 20.0)
	t.check(hit < 12.0, "de l'extérieur, le pare-brise (verre du nez, v0.30.0) est bien plein (%.2f m)" % hit)
	# passager assis (module 1) : regard vers l'allée, 2 m de visée
	var sp: Dictionary = sim.model_seats[2]
	var peye := Vector3(sp["eye"][0], sp["eye"][1], sp["eye"][2])
	var ptris: Array = _body_tris(view, int(sp["module"]))
	var pw := INF
	for yaw in range(0, 360, 30):
		var d := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(float(yaw)))
		pw = minf(pw, _first_front_hit(ptris, peye, d, 6.0))
	t.check(pw == INF, "passager assis : aucune face de la caisse dans l'habitacle (%.2f m)" % pw)
	# l'œil du conducteur est dans la caisse, au-dessus du pupitre (1,26 m), à plus de 5 cm de toute pièce sombre devant lui
	t.check(eye.y > 1.4 and eye.y < 1.9, "conducteur : œil à %.2f m (au-dessus du pupitre)" % eye.y)
