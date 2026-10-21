extends Node3D
## Surimpression de la collision (--show-collision[=rapport.json], v0.23.0) : les segments et cercles de la simulation (Game.world.collision) autour du joueur,
## en panneaux translucides sans test de profondeur (visibles à travers les murs). Vert : mur ; orange : mobilier (prop) ; bleu : étage (y0 fini) ; rouge : segment
## désactivé (off) ; magenta : candidat « mur invisible » du rapport de tools/collision-scan.py (indices `i` de `items`, genre seg / circle). `--collision-floor=Y`
## ne garde que les éléments de l'étage Y (y0 = Y, ou le sol pour 0). Aucune règle ici : c'est un outil de diagnostic pour les captures.

const RADIUS := 45.0
const PANEL_H := 3.0
var flagged_segs: Dictionary = {}
var flagged_circles: Dictionary = {}
var floor_filter := -1.0e9
var _mi: MeshInstance3D
var _last := Vector2(1.0e9, 1.0e9)

func setup(report_path: String, floor_y: float) -> void:
	floor_filter = floor_y
	if report_path != "" and FileAccess.file_exists(report_path):
		var rep: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(report_path))
		for it: Dictionary in rep["items"]:
			if it["kind"] == "seg":
				flagged_segs[int(it["i"])] = true
			else:
				flagged_circles[int(it["i"])] = true
	_mi = MeshInstance3D.new()
	_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = true
	m.render_priority = 100
	_mi.material_override = m
	add_child(_mi)

func _process(_dt: float) -> void:
	if Game.world == null or Game.player == null:
		return
	var p := Vector2(Game.player.pos.x, Game.player.pos.z)
	if p.distance_to(_last) > 4.0:
		_last = p
		_rebuild(p)

func _col(kind: int, off: bool, y0: float) -> Color:
	if kind == 3:
		return Color(1.0, 0.0, 1.0, 0.55)
	if off:
		return Color(1.0, 0.1, 0.1, 0.3)
	if kind == 2:
		return Color(1.0, 0.6, 0.1, 0.3)
	if y0 > -1.0e20:
		return Color(0.2, 0.5, 1.0, 0.3)
	return Color(0.1, 1.0, 0.2, 0.3)

func _keep(y0: float) -> bool:
	if floor_filter < -1.0e8:
		return true
	if y0 < -1.0e20:
		return absf(floor_filter) < 0.01
	return absf(y0 - floor_filter) < 1.0

func _rebuild(p: Vector2) -> void:
	var vs := PackedVector3Array()
	var cs := PackedColorArray()
	var col: Collision = Game.world.collision
	var segs: Array = Game.world.seg_list
	for i in segs.size():
		var s: Dictionary = segs[i]
		if absf((s["ax"] + s["bx"]) * 0.5 - p.x) > RADIUS or absf((s["az"] + s["bz"]) * 0.5 - p.y) > RADIUS or not _keep(s["y0"]):
			continue
		var k := 3 if flagged_segs.has(i) else (2 if s["kind"] == "prop" else 1)
		_panel(vs, cs, Vector2(s["ax"], s["az"]), Vector2(s["bx"], s["bz"]), s["y0"], s["h"], _col(k, s["off"], s["y0"]))
	for i in col.circles.size():
		var c: Dictionary = col.circles[i]
		if absf(c["x"] - p.x) > RADIUS or absf(c["z"] - p.y) > RADIUS or not _keep(c["y0"]):
			continue
		var k := 3 if flagged_circles.has(i) else (2 if c["kind"] == "prop" else 1)
		var cc := _col(k, c["off"], c["y0"])
		for a in 10:
			var a0 := TAU * a / 10.0
			var a1 := TAU * (a + 1) / 10.0
			_panel(vs, cs, Vector2(c["x"] + c["r"] * cos(a0), c["z"] + c["r"] * sin(a0)), Vector2(c["x"] + c["r"] * cos(a1), c["z"] + c["r"] * sin(a1)), c["y0"], c["h"], cc)
	var mesh := ArrayMesh.new()
	if vs.size() > 0:
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = vs
		arr[Mesh.ARRAY_COLOR] = cs
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	_mi.mesh = mesh

func _panel(vs: PackedVector3Array, cs: PackedColorArray, a: Vector2, b: Vector2, y0: float, h: float, c: Color) -> void:
	var yb := 0.0 if y0 < -1.0e20 else y0
	var yt := yb + PANEL_H
	if h < 1.0e20:
		yt = minf(yt, h)
	var p0 := Vector3(a.x, yb, a.y)
	var p1 := Vector3(b.x, yb, b.y)
	var p2 := Vector3(b.x, yt, b.y)
	var p3 := Vector3(a.x, yt, a.y)
	vs.append_array([p0, p1, p2, p0, p2, p3])
	for _i in 6:
		cs.append(c)
