class_name TramBody
extends RefCounted
## v0.30.0 : outer body of the drivable tram, built by code, after the Alstom Citadis 405 of the CTS (Strasbourg) without copying any trade mark: white
## body, gloss-black window band with large glazed bays, CTS red and blue stripes, grey skirt; at each end a cab with a large panoramic windscreen, raked
## and curved (it follows the nose surface), a rounded « snout » with its bumper skirt, double LED headlights under the windscreen, red tail lights,
## position lights, a lit destination display at the top, two wipers, a coupler cover, thin mirror arms; on the roof air-conditioning units and a
## single-arm pantograph; skirts and visible wheels of the bogies. Replaces the JS shell (body of assets/tram/car.bin, a swept rounded rectangle with a
## half-ellipsoid nose); the interior, the doors and the seats stay those of the JS bake (dimensions used by the simulation: 5 x 4.7 m = 23.5 m,
## doors, seats, cab desk).
## Frame of a module (as the bake): x along the tram (front nose toward +x), y up, z to the side (+z right), origin at the middle of the module.
## Shell: one surface with the paint shader (shaders/tram_paint.gdshader, region per cell in COLOR.r), glass apart (transparent).

const PAINT := preload("res://shaders/tram_paint.gdshader")
const HALF := 2.2                ## half length of a module shell (JS: module / 2 - 0.15)
const NOSE := 1.7                ## nose length (JS)
const BOT := 0.18                ## bottom of the skirt
const WIN_Y0 := 1.06
const WIN_Y1 := 2.38
const DOOR_Y1 := 2.42
const DOOR_W := 1.3
## profile of the +z side, bottom to roof top: [y, z]
const PROFILE := [[0.18, 1.1], [0.32, 1.19], [0.55, 1.2], [0.86, 1.2], [0.92, 1.2], [0.97, 1.2], [1.02, 1.2], [1.06, 1.2], [1.6, 1.2], [2.0, 1.2],
	[2.38, 1.2], [2.45, 1.2], [2.95, 1.2], [3.1, 1.12], [3.22, 0.98], [3.31, 0.72], [3.36, 0.4], [3.38, 0.0]]
## nose: forward extent of the centre line above the nose start (m) by height
const TIP := [[0.18, 1.42], [0.32, 1.58], [0.5, 1.67], [0.75, 1.7], [1.0, 1.66], [1.15, 1.6], [1.8, 1.37], [2.45, 1.12], [2.8, 1.0], [3.05, 0.84],
	[3.25, 0.6], [3.38, 0.32]]
const DEST_TEXT := "C   HOMME DE FER"

static var _paint: ShaderMaterial
static var _glass: StandardMaterial3D
static var _mats: Dictionary = {}

static func paint() -> ShaderMaterial:
	if _paint == null:
		_paint = ShaderMaterial.new()
		_paint.shader = PAINT
		_paint.set_shader_parameter("noise_tex", ShopModels.noise())
	return _paint

static func glass() -> StandardMaterial3D:
	if _glass == null:
		_glass = StandardMaterial3D.new()
		_glass.albedo_color = Color(0.06, 0.09, 0.11, 0.62)
		_glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_glass.roughness = 0.04
		_glass.metallic = 0.25
		_glass.metallic_specular = 0.9
		_glass.cull_mode = BaseMaterial3D.CULL_DISABLED
		_glass.disable_receive_shadows = true
	return _glass

static func mat(key: String) -> StandardMaterial3D:
	if _mats.is_empty():
		var defs := {"steel": [Color(0.16, 0.17, 0.18), 0.45, 0.7], "rubber": [Color(0.03, 0.03, 0.03), 0.85, 0.0], "ceramic": [Color(0.75, 0.73, 0.68), 0.3, 0.0],
			"copper": [Color(0.55, 0.32, 0.18), 0.35, 0.8], "roofbox": [Color(0.82, 0.84, 0.86), 0.4, 0.2], "grille": [Color(0.05, 0.055, 0.06), 0.6, 0.4],
			"cab": [Color(0.12, 0.13, 0.15), 0.7, 0.1], "wheel": [Color(0.22, 0.21, 0.2), 0.4, 0.8]}
		for k: String in defs:
			var m := StandardMaterial3D.new()
			m.albedo_color = defs[k][0]
			m.roughness = defs[k][1]
			m.metallic = defs[k][2]
			_mats[k] = m
		for k in ["head", "tail", "pos", "dest"]:
			var e := StandardMaterial3D.new()
			e.emission_enabled = true
			match k:
				"head":
					e.albedo_color = Color(0.85, 0.88, 0.9)
					e.emission = Color(1.0, 0.97, 0.9)
				"tail":
					e.albedo_color = Color(0.35, 0.02, 0.02)
					e.emission = Color(0.9, 0.0, 0.0)
				"pos":
					e.albedo_color = Color(0.8, 0.8, 0.75)
					e.emission = Color(1.0, 0.92, 0.75)
				"dest":
					e.albedo_color = Color(0.02, 0.02, 0.02)
					e.emission = Color(1.0, 0.62, 0.12)
			e.emission_energy_multiplier = 0.0
			e.roughness = 0.1
			_mats[k] = e
	return _mats[key]

# ------------------------------------------------------------------ helpers
static func hw(y: float) -> float:
	return _interp(PROFILE, y)

static func _interp(t: Array, y: float) -> float:
	if y <= float(t[0][0]):
		return float(t[0][1])
	for k in range(1, t.size()):
		if y <= float(t[k][0]):
			var a: Array = t[k - 1]
			var b: Array = t[k]
			var u := (y - float(a[0])) / maxf(1e-6, float(b[0]) - float(a[0]))
			return lerpf(float(a[1]), float(b[1]), u)
	return float(t[t.size() - 1][1])

## Smooth version of a table (Catmull-Rom between the points).
static func _smooth(t: Array, y: float) -> float:
	var k := 1
	while k < t.size() - 1 and y > float(t[k][0]):
		k += 1
	var i1 := k - 1
	var i2 := k
	var i0 := maxi(0, i1 - 1)
	var i3 := mini(t.size() - 1, i2 + 1)
	var y1 := float(t[i1][0])
	var y2 := float(t[i2][0])
	var u := clampf((y - y1) / maxf(1e-6, y2 - y1), 0.0, 1.0)
	var p0 := float(t[i0][1])
	var p1 := float(t[i1][1])
	var p2 := float(t[i2][1])
	var p3 := float(t[i3][1])
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u * u + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u * u * u)

## Depth of the rounded corners of the nose in plan (how far back the side edge is from the centre line).
static func _corner(y: float) -> float:
	return lerpf(0.5, 0.75, smoothstep(2.4, 3.38, y))

## Nose surface: forward extent above the nose start at height y and lateral fraction s (-1..1 of the half width).
static func nose_f(y: float, s: float) -> float:
	var a := minf(1.0, absf(s))
	return _smooth(TIP, y) - _corner(y) * (1.0 - sqrt(maxf(0.0, 1.0 - pow(a, 4.0))))

static func nose_p(xs: float, y: float, s: float) -> Vector3:
	return Vector3(xs + nose_f(y, s), y, s * hw(y))

static func nose_n(xs: float, y: float, s: float) -> Vector3:
	var e := 0.004
	var ds := nose_p(xs, y, clampf(s + e, -1.0, 1.0)) - nose_p(xs, y, clampf(s - e, -1.0, 1.0))
	var dy := nose_p(xs, y + e, s) - nose_p(xs, y - e, s)
	var n := ds.cross(dy).normalized()
	if n.x < 0.0 and absf(s) < 0.95:
		n = -n
	if absf(s) >= 0.95:   # side edge: outward along z
		n = (n if n.z * s > 0.0 else -n)
	return n

class Builder:
	var st := SurfaceTool.new()
	var mirror := false
	var count := 0

	func _init() -> void:
		st.begin(Mesh.PRIMITIVE_TRIANGLES)

	func _v(p: Vector3, n: Vector3, reg: int) -> void:
		if mirror:
			p.x = -p.x
			n.x = -n.x
		st.set_color(Color(float(reg) / 16.0, 0, 0, 1))
		st.set_normal(n)
		st.add_vertex(p)

	## Quad a b c d (a ring around it), outward normal no (orientation), per-corner normals na..nd; region reg.
	func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, na: Vector3, nb: Vector3, nc: Vector3, nd: Vector3, no: Vector3, reg: int) -> void:
		var ccw := (b - a).cross(c - a).dot(no) > 0.0
		if mirror:
			ccw = not ccw
		count += 1
		if ccw:   # Godot: front face = clockwise seen from outside
			_v(a, na, reg); _v(c, nc, reg); _v(b, nb, reg)
			_v(a, na, reg); _v(d, nd, reg); _v(c, nc, reg)
		else:
			_v(a, na, reg); _v(b, nb, reg); _v(c, nc, reg)
			_v(a, na, reg); _v(c, nc, reg); _v(d, nd, reg)

	func commit(mesh: ArrayMesh, m: Material) -> void:
		if count == 0:
			return
		st.commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, m)

static func _band(y: float) -> int:
	if y < 0.55:
		return 2
	if y < 0.86:
		return 0
	if y < 0.92:
		return 3
	if y < 0.97:
		return 4
	if y < 1.02:
		return 0
	if y < 2.45:
		return 1
	if y < 2.95:
		return 0
	return 5

## Profile normal (outward, side +z) at height y.
static func _pn(y: float, side: float) -> Vector3:
	var e := 0.01
	var dz := hw(y + e) - hw(y - e)
	return Vector3(0.0, -dz, 2.0 * e * side).normalized() if absf(dz) > 1e-6 else Vector3(0, 0, side)

# ------------------------------------------------------------------ one module
## i : module index (0 : rear cab, n - 1 : front cab); doors : door centres in the module frame (x) ; bogies : bogie centres (x).
## Returns { node, lamps: { head, tail, pos, dest } (materials of this module's cab, or {}) }.
static func build_module(i: int, n: int, doors: Array, bogies: Array) -> Dictionary:
	var root := Node3D.new()
	var x0 := -HALF
	var x1 := HALF
	var cab := i == 0 or i == n - 1
	var xs := HALF - NOSE
	if i == n - 1:
		x1 = xs
	if i == 0:
		x0 = -xs
	# windows: the free spans between the ends, the doors and the cab
	var spans: Array = []   # [a, b]
	var free: Array = [[x0 + 0.22, x1 - 0.22]]
	for dc: float in doors:
		var out: Array = []
		for f: Array in free:
			var a := dc - DOOR_W / 2.0 - 0.2
			var b := dc + DOOR_W / 2.0 + 0.2
			if b <= f[0] or a >= f[1]:
				out.append(f)
				continue
			if a > f[0]:
				out.append([f[0], a])
			if b < f[1]:
				out.append([b, f[1]])
		free = out
	for f: Array in free:
		var lf: float = f[1] - f[0]
		if lf < 0.55:
			continue
		var k := int(ceil(lf / 1.3))
		var w := (lf - float(k - 1) * 0.1) / float(k)
		for j in k:
			var a2: float = f[0] + float(j) * (w + 0.1)
			spans.append([a2, a2 + w])
	var arches: Array = []
	for b: float in bogies:
		var clash := false
		for dc: float in doors:
			if absf(b - dc) < DOOR_W / 2.0 + 0.7:
				clash = true
		if not clash and b - 0.62 > x0 and b + 0.62 < x1:
			arches.append(b)
	# x stops
	var xstops: Array = [x0, x1]
	var k2 := int(ceil((x1 - x0) / 0.45))
	for j in range(1, k2):
		xstops.append(lerpf(x0, x1, float(j) / float(k2)))
	for sp: Array in spans:
		xstops.append(sp[0])
		xstops.append(sp[1])
	for dc: float in doors:
		for e in [-DOOR_W / 2.0 - 0.05, -DOOR_W / 2.0, DOOR_W / 2.0, DOOR_W / 2.0 + 0.05]:
			xstops.append(dc + e)
	for b: float in arches:
		xstops.append(b - 0.62)
		xstops.append(b + 0.62)
	xstops = xstops.filter(func(x: float) -> bool: return x >= x0 - 1e-6 and x <= x1 + 1e-6)
	xstops.sort()
	var xs2: Array = []
	for x: float in xstops:
		if xs2.is_empty() or x - float(xs2[-1]) > 0.004:
			xs2.append(x)
	var B := Builder.new()
	var G := Builder.new()
	# side shell, both sides, over the roof
	for side in [1.0, -1.0]:
		for r in PROFILE.size() - 1:
			var ya := float(PROFILE[r][0])
			var yb := float(PROFILE[r + 1][0])
			var za: float = float(PROFILE[r][1]) * side
			var zb: float = float(PROFILE[r + 1][1]) * side
			var ym := (ya + yb) / 2.0
			var na := _pn(ya, side)
			var nb := _pn(yb, side)
			for c in xs2.size() - 1:
				var xa := float(xs2[c])
				var xb := float(xs2[c + 1])
				var xm := (xa + xb) / 2.0
				var reg := _band(ym)
				var hole := false
				for sp: Array in spans:
					if xm > sp[0] and xm < sp[1] and ym > WIN_Y0 and ym < WIN_Y1:
						hole = true
						G.quad(Vector3(xa, ya, za * 0.992), Vector3(xb, ya, za * 0.992), Vector3(xb, yb, zb * 0.992), Vector3(xa, yb, zb * 0.992), na, na, nb, nb, na, 1)
				for dc: float in doors:
					if absf(xm - dc) < DOOR_W / 2.0 and ym > 0.32 and ym < DOOR_Y1:
						hole = true
					elif absf(xm - dc) < DOOR_W / 2.0 + 0.05 and ym > 0.32 and ym < DOOR_Y1 + 0.03:
						reg = 1
				for b: float in arches:
					if absf(xm - b) < 0.62 and ym < 0.55:
						hole = true
				if hole:
					continue
				B.quad(Vector3(xa, ya, za), Vector3(xb, ya, za), Vector3(xb, yb, zb), Vector3(xa, yb, zb), na, na, nb, nb, na, reg)
	# ends of a middle module: nothing (the bellows of the bake close the gap); bottom plate under the floor is in the bake
	var lamps := {}
	var mesh := ArrayMesh.new()
	if cab:
		var NB := Builder.new()
		var NG := Builder.new()
		NB.mirror = i == 0
		NG.mirror = i == 0
		_nose(NB, NG, xs)
		NB.commit(mesh, paint())
		NG.commit(mesh, glass())
	B.commit(mesh, paint())
	G.commit(mesh, glass())
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	root.add_child(mi)
	if cab:
		var dirx := -1.0 if i == 0 else 1.0
		lamps = _nose_details(root, xs, dirx)
		_cab_inside(root, xs, dirx)
	_roof(root, i, n)
	_bogies(root, bogies)
	if cab:
		_logo(root, i == 0, xs)
	return {"node": root, "lamps": lamps}

# ------------------------------------------------------------------ nose
const NY := 44
const NS := 30

static func _nose_reg(y: float, s: float) -> int:
	var a := absf(s)
	if y > 1.15 and y < 2.42 and a < 0.9:
		return -1   # windscreen
	if y > 1.07 and y < 2.5 and a < 0.96:
		return 1
	if y > 2.56 and y < 2.84 and a < 0.62:
		return 7
	if y > 2.52 and y < 2.88 and a < 0.67:
		return 1
	if y > 0.62 and y < 0.8 and a > 0.48 and a < 0.88:
		return 8
	if y < 0.55:
		return 6 if y > 0.25 else 2
	return _band(y)

static func _nose(B: Builder, G: Builder, xs: float) -> void:
	var ys: Array = []
	for j in NY + 1:
		ys.append(lerpf(BOT, 3.38, float(j) / float(NY)))
	for extra in [0.25, 0.32, 0.55, 0.62, 0.8, 0.86, 0.92, 0.97, 1.02, 1.07, 1.15, 2.42, 2.5, 2.52, 2.56, 2.84, 2.88, 2.95, WIN_Y0, WIN_Y1]:
		ys.append(extra)
	ys.sort()
	var ss: Array = []
	for j in NS + 1:
		var u := lerpf(-1.0, 1.0, float(j) / float(NS))
		ss.append(sign(u) * pow(absf(u), 0.8))
	for extra in [-0.96, -0.9, -0.88, -0.67, -0.62, -0.48, 0.48, 0.62, 0.67, 0.88, 0.9, 0.96]:
		ss.append(extra)
	ss.sort()
	# front face
	for r in ys.size() - 1:
		var ya: float = ys[r]
		var yb: float = ys[r + 1]
		if yb - ya < 1e-4:
			continue
		for c in ss.size() - 1:
			var sa: float = ss[c]
			var sb: float = ss[c + 1]
			if sb - sa < 1e-4:
				continue
			var reg := _nose_reg((ya + yb) / 2.0, (sa + sb) / 2.0)
			var pa := nose_p(xs, ya, sa)
			var pb := nose_p(xs, ya, sb)
			var pc := nose_p(xs, yb, sb)
			var pd := nose_p(xs, yb, sa)
			var na := nose_n(xs, ya, sa)
			var nb := nose_n(xs, ya, sb)
			var nc := nose_n(xs, yb, sb)
			var nd := nose_n(xs, yb, sa)
			var no := (na + nb + nc + nd).normalized()
			if reg < 0:
				var k := -0.012
				G.quad(pa + na * k, pb + nb * k, pc + nc * k, pd + nd * k, na, nb, nc, nd, no, 1)
			else:
				B.quad(pa, pb, pc, pd, na, nb, nc, nd, no, reg)
	# sides of the nose: from the nose start to the edge of the front face, cab side window in the window band
	for side in [1.0, -1.0]:
		for r in ys.size() - 1:
			var ya: float = ys[r]
			var yb: float = ys[r + 1]
			if yb - ya < 1e-4:
				continue
			var ym := (ya + yb) / 2.0
			var ea := xs + nose_f(ya, side)
			var eb := xs + nose_f(yb, side)
			var za: float = hw(ya) * side
			var zb: float = hw(yb) * side
			var na := _pn(ya, side)
			var nb := _pn(yb, side)
			var segs := 6
			for c in segs:
				var ua := float(c) / float(segs)
				var ub := float(c + 1) / float(segs)
				var a1 := Vector3(lerpf(xs, ea, ua), ya, za)
				var b1 := Vector3(lerpf(xs, ea, ub), ya, za)
				var c1 := Vector3(lerpf(xs, eb, ub), yb, zb)
				var d1 := Vector3(lerpf(xs, eb, ua), yb, zb)
				var reg := _band(ym)
				var xm := (a1.x + c1.x) / 2.0
				if ym > WIN_Y0 + 0.04 and ym < WIN_Y1 - 0.06 and xm > xs + 0.08 and xm < minf(ea, eb) - 0.18:
					G.quad(a1 - na * 0.008, b1 - na * 0.008, c1 - nb * 0.008, d1 - nb * 0.008, na, na, nb, nb, na, 1)
					continue
				B.quad(a1, b1, c1, d1, na, na, nb, nb, na, reg)
	# underside of the nose
	for c in ss.size() - 1:
		var sa: float = ss[c]
		var sb: float = ss[c + 1]
		var pa := Vector3(xs, BOT, sa * hw(BOT))
		var pb := Vector3(xs, BOT, sb * hw(BOT))
		B.quad(pa, pb, nose_p(xs, BOT, sb), nose_p(xs, BOT, sa), Vector3.DOWN, Vector3.DOWN, Vector3.DOWN, Vector3.DOWN, Vector3.DOWN, 2)

## Lamps, destination display, wipers, coupler cover, mirrors of a cab. dirx : +1 front cab, -1 rear cab (mirrored). Returns its lamp materials.
static func _nose_details(root: Node3D, xs: float, dirx: float) -> Dictionary:
	var head := mat("head").duplicate() as StandardMaterial3D
	var tail := mat("tail").duplicate() as StandardMaterial3D
	var posm := mat("pos").duplicate() as StandardMaterial3D
	var dest := mat("dest").duplicate() as StandardMaterial3D
	var place := func(y: float, s: float, out: float) -> Transform3D:
		var p := nose_p(xs, y, s)
		var nn := nose_n(xs, y, s)
		p += nn * out
		var xax := Vector3(0, 0, -1) if absf(nn.z) < 0.9 else Vector3(1, 0, 0)
		var yax := nn.cross(xax).normalized()
		xax = yax.cross(nn).normalized()
		var b := Basis(xax, yax, nn)
		var t := Transform3D(b, p)
		if dirx < 0.0:
			t = Transform3D(Basis.FLIP_X, Vector3.ZERO) * t * Transform3D(Basis.FLIP_X, Vector3.ZERO)
		return t
	var disc := func(m: Material, r: float, y: float, s: float) -> void:
		var c := CylinderMesh.new()
		c.top_radius = r
		c.bottom_radius = r
		c.height = 0.02
		c.radial_segments = 16
		var mi := MeshInstance3D.new()
		mi.mesh = c
		mi.material_override = m
		mi.transform = place.call(y, s, 0.011) * Transform3D(Basis(Vector3.RIGHT, PI / 2.0), Vector3.ZERO)
		root.add_child(mi)
	for sgn in [-1.0, 1.0]:
		disc.call(head, 0.05, 0.71, sgn * 0.58)          # double LED headlights
		disc.call(head, 0.05, 0.71, sgn * 0.7)
		disc.call(tail, 0.045, 0.71, sgn * 0.82)          # tail lights
		disc.call(posm, 0.025, 2.7, sgn * 0.78)           # position lights, up on the corners
		# wipers: arm from a pivot under the windscreen
		var p0 := nose_p(xs, 1.2, sgn * 0.3 - 0.05)
		var p1 := nose_p(xs, 1.85, sgn * 0.3 + 0.12)
		var w := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.018, (p1 - p0).length(), 0.012)
		w.mesh = bm
		w.material_override = mat("rubber")
		var mid := (p0 + p1) / 2.0 + nose_n(xs, 1.5, sgn * 0.3) * 0.012
		var up := (p1 - p0).normalized()
		var nn := nose_n(xs, 1.5, sgn * 0.3)
		var xa := up.cross(nn).normalized()
		var t := Transform3D(Basis(xa, up, xa.cross(up)), mid)
		if dirx < 0.0:
			t = Transform3D(Basis.FLIP_X, Vector3.ZERO) * t * Transform3D(Basis.FLIP_X, Vector3.ZERO)
		w.transform = t
		root.add_child(w)
		# thin mirror arm and housing, beside the windscreen
		var arm := MeshInstance3D.new()
		var am := BoxMesh.new()
		am.size = Vector3(0.05, 0.035, 0.32)
		arm.mesh = am
		arm.material_override = mat("rubber")
		var ep := nose_p(xs, 2.28, sgn)
		arm.position = Vector3(ep.x * dirx - 0.12 * dirx, 2.28, sgn * (hw(2.28) + 0.14))
		root.add_child(arm)
		var hs := MeshInstance3D.new()
		var hm := BoxMesh.new()
		hm.size = Vector3(0.09, 0.3, 0.07)
		hs.mesh = hm
		hs.material_override = mat("rubber")
		hs.position = Vector3(ep.x * dirx - 0.12 * dirx, 2.18, sgn * (hw(2.28) + 0.3))
		root.add_child(hs)
	# coupler cover under the bumper
	var cc := MeshInstance3D.new()
	var cm := BoxMesh.new()
	cm.size = Vector3(0.1, 0.18, 0.42)
	cc.mesh = cm
	cc.material_override = mat("rubber")
	var cp := nose_p(xs, 0.4, 0.0)
	cc.position = Vector3((cp.x - 0.02) * dirx, 0.4, 0.0)
	root.add_child(cc)
	# destination display: amber LED text on dark glass
	var lbl := ShopModels.label(root, DEST_TEXT, 0.15, Vector3.ZERO, Color(1.0, 0.64, 0.16))
	lbl.transform = place.call(2.70, 0.0, 0.008)
	lbl.visibility_range_end = 120.0
	lbl.modulate = Color(1.0, 0.64, 0.16)
	lbl.set_meta("dest", true)
	return {"head": head, "tail": tail, "pos": posm, "dest": dest, "dest_label": lbl}

## Cab inside the nose: floor, dashboard up to the windscreen, a short ceiling (the bake stops at the desk).
static func _cab_inside(root: Node3D, xs: float, dirx: float) -> void:
	var add := func(size: Vector3, pos: Vector3, m: Material) -> void:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = size
		mi.mesh = b
		mi.material_override = m
		mi.position = Vector3(pos.x * dirx, pos.y, pos.z)
		root.add_child(mi)
	var front := xs + nose_f(1.12, 0.0) - 0.05
	add.call(Vector3(front - 0.78, 0.03, 2.2), Vector3((front + 0.78) / 2.0, 0.335, 0), mat("cab"))
	add.call(Vector3(front - 0.62, 0.05, 1.9), Vector3((front + 0.62) / 2.0, 1.1, 0), mat("cab"))
	add.call(Vector3(0.6, 0.04, 2.1), Vector3(1.1, 2.96, 0), mat("cab"))

# ------------------------------------------------------------------ roof, bogies, logo
static func _strut(root: Node3D, a: Vector3, b: Vector3, r: float, m: Material) -> void:
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = (b - a).length()
	c.radial_segments = 8
	var mi := MeshInstance3D.new()
	mi.mesh = c
	mi.material_override = m
	var up := (b - a).normalized()
	var side := up.cross(Vector3.FORWARD if absf(up.z) < 0.9 else Vector3.RIGHT).normalized()
	mi.transform = Transform3D(Basis(side, up, side.cross(up)), (a + b) / 2.0)
	root.add_child(mi)

static func _box(root: Node3D, size: Vector3, pos: Vector3, m: Material, rot := Basis.IDENTITY) -> void:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = m
	mi.transform = Transform3D(rot, pos)
	root.add_child(mi)

static func _roof(root: Node3D, i: int, n: int) -> void:
	var top := 3.38
	if i == n / 2:   # single-arm pantograph on the middle module
		_box(root, Vector3(1.3, 0.07, 0.95), Vector3(0, top + 0.12, 0), mat("steel"))
		for sx in [-0.55, 0.55]:
			for sz in [-0.38, 0.38]:
				_strut(root, Vector3(sx, top - 0.02, sz), Vector3(sx, top + 0.1, sz), 0.045, mat("ceramic"))
		var hinge := Vector3(-0.5, top + 0.18, 0)
		var knee := Vector3(0.8, top + 1.05, 0)
		var head := Vector3(-0.2, top + 2.08, 0)   # collector strip at the contact wire (realworld config tram.pole.wire: 5.5 m)
		for sz in [-0.2, 0.2]:
			_strut(root, hinge + Vector3(0, 0, sz), knee + Vector3(0, 0, sz * 0.4), 0.03, mat("steel"))
		_strut(root, knee, head, 0.022, mat("steel"))
		_strut(root, hinge + Vector3(0.1, 0.02, 0), knee + Vector3(-0.15, -0.05, 0), 0.012, mat("steel"))   # tie rod
		_strut(root, head + Vector3(0, 0, -0.75), head + Vector3(0, 0, 0.75), 0.03, mat("copper"))           # collector strip
		for sz in [-1.0, 1.0]:
			_strut(root, head + Vector3(0, 0, sz * 0.75), head + Vector3(0, -0.12, sz * 0.95), 0.018, mat("steel"))   # horns
		_box(root, Vector3(0.5, 0.18, 0.5), Vector3(1.4, top + 0.09, 0), mat("roofbox"))   # breaker housing
	else:   # air-conditioning unit with grilles
		var len := 1.6 if i == 0 or i == n - 1 else 2.6
		var x := 0.6 if i == 0 else (-0.6 if i == n - 1 else 0.0)   # cabs: behind the curve of the nose roof
		_box(root, Vector3(len, 0.26, 1.5), Vector3(x, top + 0.1, 0), mat("roofbox"))
		_box(root, Vector3(len - 0.1, 0.06, 1.4), Vector3(x, top + 0.24, 0), mat("roofbox"))
		for k in 6:
			_box(root, Vector3(0.05, 0.012, 1.1), Vector3(x - len / 2.0 + 0.3 + float(k) * (len - 0.6) / 5.0, top + 0.275, 0), mat("grille"))
		for sz in [-1.0, 1.0]:
			_box(root, Vector3(len - 0.4, 0.14, 0.01), Vector3(x, top + 0.1, sz * 0.755), mat("grille"))

static func _bogies(root: Node3D, bogies: Array) -> void:
	for b: float in bogies:
		for sz in [-1.0, 1.0]:
			_box(root, Vector3(1.6, 0.2, 0.08), Vector3(b, 0.42, sz * 0.98), mat("steel"))
			for wx in [-0.55, 0.55]:
				var w := MeshInstance3D.new()
				var c := CylinderMesh.new()
				c.top_radius = 0.3
				c.bottom_radius = 0.3
				c.height = 0.12
				c.radial_segments = 18
				w.mesh = c
				w.material_override = mat("wheel")
				w.transform = Transform3D(Basis(Vector3.RIGHT, PI / 2.0), Vector3(b + wx, 0.3, sz * 0.8))
				root.add_child(w)

## « CTS » (plain text, not the real logo) and the fleet number on both sides, near the cab.
static func _logo(root: Node3D, rear: bool, xs: float) -> void:
	var x := (-xs + 0.2) if rear else (xs - 0.2)
	for side in [1.0, -1.0]:
		var l := ShopModels.label(root, "CTS", 0.24, Vector3(x - (0.25 if not rear else -0.25), 0.71, side * 1.205), Color(0.82, 0.05, 0.1), true)
		l.rotation.y = 0.0 if side > 0.0 else PI
		l.visibility_range_end = 80.0
		var nb := ShopModels.label(root, "4071", 0.07, Vector3(x + (0.35 if not rear else -0.35) * side * side, 0.6, side * 1.205), Color(0.2, 0.22, 0.25), true)
		nb.rotation.y = l.rotation.y
		nb.visibility_range_end = 40.0
