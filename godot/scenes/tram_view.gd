extends Node3D
## Rame de tram conduisible. v0.30.0 : la caisse extérieure est construite par code (scenes/tram_body.gd : Citadis 405 de la CTS) ; le reste vient
## toujours des géométries du jeu JS (src/hommedefer.js carGeometries), cuites par tools/bake-tram.mjs dans assets/tram/ (car.bin, car.json ; la caisse
## cuite et l'atlas car_map.png / car_emissive.png ne servent plus). Un nœud par module articulé : caisse (TramBody),
## pièces sombres (soufflets, bogies, pantographes, intérieur praticable : plancher, plafond, parois, montants, mains courantes, sièges, pupitres de
## cabine), vantaux de portes qui coulissent (pièces séparées), vitres (verre transparent dans les baies, vu de l'intérieur), éclairage intérieur.
## Repère d'un module comme dans le JS : le maillage est cuit avec x le long de la rame (nez avant en +x), y vers le haut, z de côté ; le nœud « inner »
## tourne de PI/2 autour de y (avant du modèle vers -Z, droite vers +X, comme les motos). Pose de chaque module : celle du TramSim.
## La caisse n'a qu'UNE face (comme dans le JS) : vue de l'intérieur elle disparaît et l'on voit dehors par les baies, le pare-brise et les parois ;
## de l'extérieur les baies sont peintes en sombre sur la livrée.
## Repli : si les fichiers cuits manquent, une caisse en boîtes (rien d'autre) pour que le jeu reste jouable.

const DIR := "res://assets/tram/"
const DOOR_SLIDE := 0.62        ## course d'un vantail (m) à porte ouverte (tram.js)

var sim: TramSim
var _meta: Dictionary = {}
var _mods: Array[Node3D] = []
var _leaves: Array = []         ## [{ node, dir }] vantaux coulissants (repère du maillage : x le long de la rame)
var _lights: Array[OmniLight3D] = []
var _heads: Array = []          ## [{ light, seat }] phare de la cabine de chaque bout (allumé quand la rame est alimentée et qu'on la conduit de ce côté)
var _screens: Array[MeshInstance3D] = []
var _screen_mat: StandardMaterial3D
var _prev: Array = []
var _cur: Array = []
var _powered := -1
var _dark_mat: StandardMaterial3D
var _cab_lamps: Array = []      ## v0.30.0 : [{ lamps: TramBody lamp materials, seat }] of each cab (seat 0 : front cab, module n - 1)
var _bin: PackedByteArray
var _base := 0

static func available() -> bool:
	return FileAccess.file_exists(DIR + "car.bin") and FileAccess.file_exists(DIR + "car.json")

func setup(s: TramSim) -> void:
	sim = s
	if not available():
		push_warning("tram_view : assets/tram absent (node tools/bake-tram.mjs) : rame de repli")
		_fallback()
		return
	_meta = JSON.parse_string(FileAccess.get_file_as_string(DIR + "car.json"))
	_bin = FileAccess.get_file_as_bytes(DIR + "car.bin")
	_base = 8 + _bin.decode_u32(4)
	_make_materials()
	var mods: Array = _meta["modules"]
	for i in mods.size():
		var g := Node3D.new()
		add_child(g)
		_mods.append(g)
		_build_module(g, i, mods[i])
	for i in s.n:
		var m: Dictionary = s.mods[i]
		_cur.append(Vector3(m["x"], m["z"], m["yaw"]))
		_prev.append(Vector3(m["x"], m["z"], m["yaw"]))
	apply(1.0)

func _tex(name: String) -> Texture2D:
	var img := Image.load_from_file(DIR + name)   # res:// direct : lisible depuis le .pck exporté
	if img == null or img.is_empty():
		return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func _make_materials() -> void:
	_dark_mat = StandardMaterial3D.new()
	_dark_mat.vertex_color_use_as_albedo = true
	_dark_mat.roughness = float(_meta["mat"]["dark"]["roughness"])
	_dark_mat.metallic = float(_meta["mat"]["dark"]["metalness"])
	_dark_mat.emission_enabled = true   # un peu d'émission : l'intérieur n'a aucune lumière propre (JS : emissive 0x16191d)
	_dark_mat.emission = Color.html("16191d")
	_screen_mat = StandardMaterial3D.new()
	_screen_mat.albedo_color = Color(0.03, 0.12, 0.1)
	_screen_mat.emission_enabled = true
	_screen_mat.emission = Color(0.25, 0.95, 0.75)
	_screen_mat.emission_energy_multiplier = 0.0

func _floats(off: int, count: int) -> PackedFloat32Array:
	return _bin.slice(_base + off, _base + off + count * 4).to_float32_array()

## Sommets [from, from + n) d'un bloc cuit (position, normale, uv ou couleur) -> ArrayMesh à une surface.
## v0.30.0 : colours of the bake replaced or dropped. Door leaves: grey frame -> white of the new body. Dropped: the old windscreen pillars (the cab is now
## inside the new nose) and the old pantographs (above the roof; TramBody has its own).
const LEAF_GREY := Color(0.209, 0.238, 0.27)
const PILLAR := Color(0.045, 0.054, 0.068)

static func _same(a: Color, b: Color) -> bool:
	return absf(a.r - b.r) < 0.004 and absf(a.g - b.g) < 0.004 and absf(a.b - b.b) < 0.004

func _mesh(blk: Dictionary, from: int, n: int, colored: bool, leaf := false) -> ArrayMesh:
	var pos := _floats(int(blk["pos"]) + from * 12, n * 3)
	var nor := _floats(int(blk["nor"]) + from * 12, n * 3)
	var col := _floats(int(blk["col"]) + from * 12, n * 3) if colored else PackedFloat32Array()
	var pv := PackedVector3Array()
	var nv := PackedVector3Array()
	var cv := PackedColorArray()
	for t in range(0, n - 2, 3):   # triangles (the bake is not indexed)
		if colored and not leaf:
			var c0 := Color(col[t * 3], col[t * 3 + 1], col[t * 3 + 2])
			if _same(c0, PILLAR) or minf(pos[t * 3 + 1], minf(pos[t * 3 + 4], pos[t * 3 + 7])) >= 3.39:
				continue
		for i in range(t, t + 3):
			pv.append(Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
			nv.append(Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]))
			if colored:
				var c := Color(col[i * 3], col[i * 3 + 1], col[i * 3 + 2], 1.0)
				if leaf and _same(c, LEAF_GREY):
					c = Color(0.82, 0.84, 0.86)
				cv.append(c)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pv
	arrays[Mesh.ARRAY_NORMAL] = nv
	if colored:
		arrays[Mesh.ARRAY_COLOR] = cv
	else:
		var uv := _floats(int(blk["uv"]) + from * 8, n * 2)
		var uvs := PackedVector2Array()
		uvs.resize(n)
		for i in n:
			uvs[i] = Vector2(uv[i * 2], uv[i * 2 + 1])
		arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

func _inst(parent: Node3D, mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi

func _build_module(g: Node3D, i: int, md: Dictionary) -> void:
	var inner := Node3D.new()
	inner.rotation.y = PI / 2.0
	g.add_child(inner)
	# v0.30.0 : outer body built by code (TramBody, Citadis 405 of the CTS in spirit) instead of the baked JS shell
	var doors: Array = []
	for d: Dictionary in _meta["doorsAt"]:
		if int(d["module"]) == i and int(d["side"]) == 1:
			doors.append(float(d["x"]))
	var body := TramBody.build_module(i, int(_meta["modules"].size()), doors, [-1.3, 1.3])
	inner.add_child(body["node"])
	if not (body["lamps"] as Dictionary).is_empty():
		_cab_lamps.append({"lamps": body["lamps"], "seat": 0 if i == int(_meta["modules"].size()) - 1 else 1})
	# pièces sombres : tout sauf les vantaux (pièces séparées, qui coulissent)
	var dn := int(md["dark"]["n"])
	var leaves: Array = md["leaves"]
	var cuts: Array = []
	for lf: Dictionary in leaves:
		cuts.append([int(lf["v0"]), int(lf["n"]), float(lf["dir"])])
	cuts.sort_custom(func(a, b): return a[0] < b[0])
	var at := 0
	for c: Array in cuts:
		if c[0] > at:
			_inst(inner, _mesh(md["dark"], at, c[0] - at, true), _dark_mat)
		var holder := Node3D.new()
		inner.add_child(holder)
		_inst(holder, _mesh(md["dark"], c[0], c[1], true, true), _dark_mat)
		_leaves.append({"node": holder, "dir": c[2]})
		at = c[0] + c[1]
	if at < dn:
		_inst(inner, _mesh(md["dark"], at, dn - at, true), _dark_mat)
	var L: float = float(_meta["L"])
	var cx: float = float(md["c"])
	# cabines (module 0 : arrière, module n - 1 : avant) : écrans lumineux du pupitre (posés à plat, lisibles depuis l'œil du conducteur) et phare
	if i == 0 or i == int(_meta["modules"].size()) - 1:
		var dir := -1.0 if i == 0 else 1.0
		var xd := dir * (L / 2.0 - 1.95) - cx           # pupitre (carGeometries : Xd)
		for k in 3:
			var scr := BoxMesh.new()
			scr.size = Vector3(0.24, 0.006, 0.34 if k != 1 else 0.5)
			var mi := _inst(inner, scr, _screen_mat)
			mi.position = Vector3(xd - dir * 0.1, 1.288, (k - 1) * 0.56)
			_screens.append(mi)
		var head := SpotLight3D.new()
		head.light_color = Color(1.0, 0.95, 0.82)
		head.spot_range = 55.0
		head.spot_angle = 24.0
		head.spot_attenuation = 0.8
		head.light_energy = 0.0
		head.shadow_enabled = false
		g.add_child(head)
		head.position = Vector3(0, 0.95, -dir * 2.3)     # repère « groupe » : l'avant est -Z
		head.rotation = Vector3(deg_to_rad(-2.0), 0.0 if dir > 0.0 else PI, 0.0)
		_heads.append({"light": head, "seat": 0 if dir > 0.0 else 1})
	# éclairage intérieur : une lumière chaude au plafond de chaque module
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.92, 0.78)
	lamp.omni_range = 5.5
	lamp.omni_attenuation = 1.2
	lamp.shadow_enabled = false
	lamp.light_energy = 0.0
	g.add_child(lamp)
	lamp.position = Vector3(0, 2.7, 0)
	_lights.append(lamp)

# ------------------------------------------------------------------ repli (fichiers cuits absents)
func _fallback() -> void:
	for i in sim.n:
		var g := Node3D.new()
		add_child(g)
		_mods.append(g)
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(sim.width, 3.0, sim.body_len)
		mi.mesh = b
		mi.position = Vector3(0, 1.8, 0)
		g.add_child(mi)
		_cur.append(Vector3(sim.mods[i]["x"], sim.mods[i]["z"], sim.mods[i]["yaw"]))
		_prev.append(_cur[i])
	apply(1.0)

# ------------------------------------------------------------------ pose
## Noeud d'un module de la rame (porte les places : un cavalier s'y ajoute en enfant, positions de `model_seats` dans son repère).
func module_node(i: int) -> Node3D:
	return _mods[i] if i >= 0 and i < _mods.size() else null

func remember() -> void:
	for i in sim.n:
		_prev[i] = _cur[i]
		var m: Dictionary = sim.mods[i]
		_cur[i] = Vector3(m["x"], m["z"], m["yaw"])

func _process(_dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(_dt)
	PerfLog.add(&"tram", _pt)

func _tick(_dt: float) -> void:
	if sim != null:
		apply(Engine.get_physics_interpolation_fraction())

func apply(f: float) -> void:
	visible = sim.state != "gone"
	for i in sim.n:
		var a: Vector3 = _prev[i]
		var b: Vector3 = _cur[i]
		_mods[i].position = Vector3(lerpf(a.x, b.x, f), 0.0, lerpf(a.y, b.y, f))
		_mods[i].rotation = Vector3(0, a.z + VehicleSim.ang_diff(b.z, a.z) * f, 0)
	# vantaux : coulissent le long de la caisse (mètres du maillage : x le long de la rame)
	var d := sim.door_f * DOOR_SLIDE
	for L: Dictionary in _leaves:
		(L["node"] as Node3D).position = Vector3(float(L["dir"]) * d, 0.0, 0.0)
	# lumières intérieures : allumées quand la rame est alimentée
	var on: int = 1 if (Game.rides != null and Game.rides.tram_powered) else 0
	if on != _powered:
		_powered = on
		for l in _lights:
			l.light_energy = 0.55 if on == 1 else 0.1
		_screen_mat.emission_energy_multiplier = 1.4 if on == 1 else 0.0
	for h: Dictionary in _heads:
		(h["light"] as SpotLight3D).light_energy = 6.0 if on == 1 and sim.seats.size() > int(h["seat"]) and sim.seats[int(h["seat"])] != null else 0.0
	# v0.30.0 : lamps of the new noses: the driven end shows white headlights, the other end red tail lights; powered: position lights and the destination
	# display are lit; nobody driving: the front cab (seat 0) leads
	var lead := 0
	if sim.seats.size() > 1 and sim.seats[1] != null and (sim.seats[0] == null):
		lead = 1
	for c: Dictionary in _cab_lamps:
		var L: Dictionary = c["lamps"]
		var front: bool = int(c["seat"]) == lead
		(L["head"] as StandardMaterial3D).emission_energy_multiplier = (6.0 if front else 0.0) * on
		(L["tail"] as StandardMaterial3D).emission_energy_multiplier = (0.0 if front else 0.8) * on
		(L["pos"] as StandardMaterial3D).emission_energy_multiplier = 3.0 * on
		(L["dest_label"] as Label3D).modulate = Color(1.0, 0.64, 0.16) if on == 1 else Color(0.25, 0.17, 0.08)
