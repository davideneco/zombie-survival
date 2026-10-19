extends Node3D
## Rame de tram conduisible : les VRAIES géométries du jeu JS (src/hommedefer.js carGeometries / atlas('car')), cuites par tools/bake-tram.mjs dans
## assets/tram/ (car.bin, car.json, car_map.png, car_emissive.png). Un nœud par module articulé : caisse livrée (nez, flancs, atlas de livrée),
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
var _body_mat: StandardMaterial3D
var _dark_mat: StandardMaterial3D
var _glass_mat: StandardMaterial3D
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
	var mb: Dictionary = _meta["mat"]["body"]
	_body_mat = StandardMaterial3D.new()
	_body_mat.albedo_texture = _tex("car_map.png")
	_body_mat.roughness = float(mb["roughness"])
	_body_mat.metallic = float(mb["metalness"])
	_body_mat.emission_enabled = true
	_body_mat.emission = Color.BLACK   # Godot : émission = (couleur + texture) x énergie : la couleur doit rester noire
	_body_mat.emission_texture = _tex("car_emissive.png")
	_body_mat.emission_energy_multiplier = float(mb["emissiveIntensity"])
	_body_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
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
	_glass_mat = StandardMaterial3D.new()
	_glass_mat.albedo_color = Color(0.6, 0.78, 0.88, 0.07)
	_glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_glass_mat.roughness = 0.05
	_glass_mat.metallic = 0.0
	_glass_mat.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	_glass_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_glass_mat.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL

func _floats(off: int, count: int) -> PackedFloat32Array:
	return _bin.slice(_base + off, _base + off + count * 4).to_float32_array()

## Sommets [from, from + n) d'un bloc cuit (position, normale, uv ou couleur) -> ArrayMesh à une surface.
func _mesh(blk: Dictionary, from: int, n: int, colored: bool) -> ArrayMesh:
	var pos := _floats(int(blk["pos"]) + from * 12, n * 3)
	var nor := _floats(int(blk["nor"]) + from * 12, n * 3)
	var pv := PackedVector3Array()
	var nv := PackedVector3Array()
	pv.resize(n)
	nv.resize(n)
	for i in n:
		pv[i] = Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
		nv[i] = Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pv
	arrays[Mesh.ARRAY_NORMAL] = nv
	if colored:
		var col := _floats(int(blk["col"]) + from * 12, n * 3)
		var cv := PackedColorArray()
		cv.resize(n)
		for i in n:
			cv[i] = Color(col[i * 3], col[i * 3 + 1], col[i * 3 + 2], 1.0)
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
	_inst(inner, _mesh(md["body"], 0, int(md["body"]["n"]), false), _body_mat)
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
		_inst(holder, _mesh(md["dark"], c[0], c[1], true), _dark_mat)
		_leaves.append({"node": holder, "dir": c[2]})
		at = c[0] + c[1]
	if at < dn:
		_inst(inner, _mesh(md["dark"], at, dn - at, true), _dark_mat)
	# vitres : une vitre transparente dans chaque baie (livrée : fenêtres entre les portes), vue de l'intérieur
	var L: float = float(_meta["L"])
	var cx: float = float(md["c"])
	var half := float(_meta["car"]["module"]) / 2.0
	for w: float in _meta["windows"]:
		var x: float = w + 0.525 - L / 2.0 - cx
		if absf(x) > half:
			continue
		for side in [-1.0, 1.0]:
			var box := BoxMesh.new()
			box.size = Vector3(1.05, 1.32, 0.02)
			var mi := _inst(inner, box, _glass_mat)
			mi.position = Vector3(x, 1.72, side * 1.17)
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
func remember() -> void:
	for i in sim.n:
		_prev[i] = _cur[i]
		var m: Dictionary = sim.mods[i]
		_cur[i] = Vector3(m["x"], m["z"], m["yaw"])

func _process(_dt: float) -> void:
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
