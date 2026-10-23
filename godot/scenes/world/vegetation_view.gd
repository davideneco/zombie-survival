extends Node3D
## v0.32.4 : végétation basse et grilles d'arbres. Touffes d'herbe (deux plans croisés, texture de brins dessinée au chargement, vent) sur les pelouses du sol
## (même masque que ground.gdshader : densité d'arbres, loin des façades), grilles de fonte carrées au pied des arbres de rue (hors pelouses).
## Décor sans collision : l'herbe se traverse, les grilles sont au ras du sol. MultiMesh par maille de 48 m ; portée selon la qualité.

const CELL := 48.0
const TUFT_RANGE := [0.0, 32.0, 55.0]
const GRATE_RANGE := [40.0, 70.0, 110.0]
const GRASS_SHADER := preload("res://shaders/grass_tuft.gdshader")

var tuft_count := 0
var grate_count := 0
var _tufts: Array[MultiMeshInstance3D] = []
var _grates: Array[MultiMeshInstance3D] = []

static func _h(x: float, y: float) -> float:
	var v := sin(x * 12.9898 + y * 78.233) * 43758.5453
	return v - floor(v)

## dens : densité (0..1) par texel de 1 m sur la grille (w x h) d'origine o ; sdf : Image du champ de distance aux façades (ground_sdf.png) et ses réglages.
func build(trees: PackedVector2Array, dens: PackedByteArray, w: int, h: int, o: Vector2, sdf: Image, sdf_min: float, sdf_range: float) -> void:
	name = "Vegetation"
	var tufts := {}
	var grates := {}
	var sw := sdf.get_width() if sdf != null else 0
	var sh := sdf.get_height() if sdf != null else 0
	var sd_at := func(x: float, z: float) -> float:
		if sdf == null:
			return 99.0
		var ix := clampi(int((x - o.x) / (float(w) / sw)), 0, sw - 1)
		var iz := clampi(int((z - o.y) / (float(h) / sh)), 0, sh - 1)
		return sdf.get_pixel(ix, iz).r * sdf_range + sdf_min
	for iz in h:
		for ix in w:
			var d := float(dens[(iz * w + ix) * 2]) / 255.0
			if d < 0.55:
				continue
			var x := o.x + ix + _h(ix, iz)
			var z := o.y + iz + _h(iz, ix + 7.0)
			if float(sd_at.call(x, z)) < 3.2:
				continue
			for k in (2 if d > 0.75 else 1):
				var xx := x + (_h(ix + k, iz * 3.0) - 0.5) * 0.9
				var zz := z + (_h(iz + k, ix * 5.0) - 0.5) * 0.9
				var s := 0.55 + 0.6 * _h(xx, zz)
				var xf := Transform3D(Basis(Vector3.UP, _h(zz, xx) * TAU).scaled(Vector3(s, s * (0.8 + 0.5 * _h(xx * 2.0, zz)), s)), Vector3(xx, 0.0, zz))
				_add(tufts, xf)
	for p in trees:
		var ix := int(p.x - o.x)
		var iz := int(p.y - o.y)
		if ix < 0 or iz < 0 or ix >= w or iz >= h:
			continue
		if float(dens[(iz * w + ix) * 2]) / 255.0 > 0.5:
			continue   # arbre de pelouse : pas de grille
		_add(grates, Transform3D(Basis(Vector3.UP, _h(p.x, p.y) * 0.3), Vector3(p.x, 0.03, p.y)))
	var tuft_mesh := _tuft_mesh()
	var tm := ShaderMaterial.new()
	tm.shader = GRASS_SHADER
	tm.set_shader_parameter("blades", _blade_texture())
	tufts_count_set(tufts)
	for key: Vector2i in tufts:
		_tufts.append(_mmi(tufts[key], tuft_mesh, tm, key))
	var gm := _grate_mesh()
	var gmat := StandardMaterial3D.new()
	gmat.albedo_texture = _grate_texture()
	gmat.albedo_color = Color(0.16, 0.16, 0.17)
	gmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	gmat.alpha_scissor_threshold = 0.5
	gmat.metallic = 0.6
	gmat.roughness = 0.55
	gmat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	for key: Vector2i in grates:
		grate_count += (grates[key] as Array).size()
		_grates.append(_mmi(grates[key], gm, gmat, key))
	set_quality(int(Game.settings.get_value("quality")))
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "quality":
			set_quality(int(Game.settings.get_value("quality"))))
	print("végétation : %d touffes d'herbe, %d grilles d'arbres" % [tuft_count, grate_count])

func tufts_count_set(t: Dictionary) -> void:
	tuft_count = 0
	for k: Vector2i in t:
		tuft_count += (t[k] as Array).size()

func _add(d: Dictionary, xf: Transform3D) -> void:
	var key := Vector2i(floori(xf.origin.x / CELL), floori(xf.origin.z / CELL))
	var lst: Array = d.get(key, [])
	lst.append(xf)
	d[key] = lst

func _mmi(list: Array, mesh: Mesh, mat: Material, key: Vector2i) -> MultiMeshInstance3D:
	var c0 := Vector3((key.x + 0.5) * CELL, 0.0, (key.y + 0.5) * CELL)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = list.size()
	for i in list.size():
		var xf: Transform3D = list[i]
		mm.set_instance_transform(i, Transform3D(xf.basis, xf.origin - c0))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = c0
	add_child(mi)
	return mi

func set_quality(q: int) -> void:
	q = clampi(q, 0, 2)
	for mi in _tufts:
		mi.visible = float(TUFT_RANGE[q]) > 0.0
		mi.visibility_range_end = float(TUFT_RANGE[q]) + CELL * 0.71
	for mi in _grates:
		mi.visibility_range_end = float(GRATE_RANGE[q]) + CELL * 0.71

## Touffe : deux plans croisés de 0,8 x 0,45 m (UV : brins dans la texture).
static func _tuft_mesh() -> ArrayMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	for k in 3:
		var a := PI * k / 3.0
		var d := Vector3(cos(a), 0.0, sin(a)) * 0.4
		var nn := Vector3(-sin(a), 0.0, cos(a))
		var p := [-d, d, d + Vector3(0, 0.45, 0), -d + Vector3(0, 0.45, 0)]
		var t := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		for i in [0, 1, 2, 0, 2, 3]:
			v.append(p[i])
			n.append(Vector3.UP * 0.7 + nn * 0.3)
			uv.append(t[i])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_TEX_UV] = uv
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## Brins : 22 lames effilées, légèrement courbées, teintes variées (alpha = forme).
static func _blade_texture() -> ImageTexture:
	var W := 128
	var H := 64
	var img := Image.create(W, H, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.2, 0.3, 0.1, 0.0))
	for b in 22:
		var x0 := 6.0 + _h(b, 1.0) * (W - 12.0)
		var top := 6.0 + _h(b, 2.0) * 24.0
		var bend := (_h(b, 3.0) - 0.5) * 18.0
		var wid := 2.2 + _h(b, 4.0) * 1.6
		var tint := Color(0.22 + 0.1 * _h(b, 5.0), 0.34 + 0.12 * _h(b, 6.0), 0.10 + 0.05 * _h(b, 7.0))
		for y in range(int(top), H):
			var f := (float(y) - top) / (H - top)   # 0 en haut, 1 au pied
			var x := x0 + bend * (1.0 - f) * (1.0 - f)
			var hw := wid * (0.15 + 0.85 * f)
			for xi in range(int(x - hw - 1), int(x + hw + 2)):
				if xi < 0 or xi >= W:
					continue
				var cov := clampf(hw - absf(xi + 0.5 - x) + 0.5, 0.0, 1.0)
				if cov > 0.0:
					var c := tint.darkened(0.35 * f)
					c.a = maxf(img.get_pixel(xi, y).a, cov)
					img.set_pixel(xi, y, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

static func _grate_mesh() -> ArrayMesh:
	var q := QuadMesh.new()
	q.size = Vector2(1.5, 1.5)
	q.orientation = PlaneMesh.FACE_Y
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, q.get_mesh_arrays())
	return m

## Grille d'arbre en fonte : cadre, anneau autour du tronc, barreaux rayonnants (alpha : ajours).
static func _grate_texture() -> ImageTexture:
	var S := 128
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var u := (x + 0.5) / S * 2.0 - 1.0
			var v := (y + 0.5) / S * 2.0 - 1.0
			var r := sqrt(u * u + v * v)
			var a := atan2(v, u)
			var solid := maxf(absf(u), absf(v)) > 0.9 or (r > 0.30 and r < 0.37) or absf(fmod(r * 7.0, 1.0) - 0.5) < 0.08 and r > 0.37
			solid = solid or (absf(sin(a * 12.0)) < 0.12 and r > 0.37)
			var hole := r < 0.30
			img.set_pixel(x, y, Color(1, 1, 1, 0.0 if hole or not solid else 1.0))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)
