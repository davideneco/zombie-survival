extends Node3D
## v0.32.4 : voitures garées (décor du JS : « voitures abandonnées », 4,36 x 1,72 m, boîte de collision 4,2 x 1,75 x 1,5 inchangée). Le modèle cuit (caisse
## en boîtes) est remplacé par une citadine modélisée par code : caisse en sections lissées (capot, pare-brise incliné, pavillon, lunette, coffre, épaules,
## rétrécissement du vitrage), vitres latérales, passages de roue, roues (pneu, jante à rayons), optiques, calandre, pare-chocs, rétroviseurs, poignées.
## Même repère que le modèle du JS : x vers l'avant, y haut, z largeur, origine au sol au milieu. Une seule MultiMesh (peinture par instance).

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const SHADER := preload("res://shaders/car.gdshader")

const L0 := -2.18
const L1 := 2.17
const HW := 0.86
const AXLE := 1.32
const WHEEL_R := 0.32


## Profils le long de x : (x, bas, ligne d'épaule, haut).
static func _profile(x: float) -> Array:
	var yb := 0.30 + 0.06 * smoothstep(1.7, 2.17, absf(x))
	var ys := lerpf(0.86, 0.96, smoothstep(2.17, 0.9, x)) if x > 0.0 else lerpf(0.96, 0.93, smoothstep(-1.6, -2.18, x))
	var yt: float
	if x > 1.05:
		yt = lerpf(0.94, 0.78, smoothstep(1.05, 2.17, x))      # capot
	elif x > 0.25:
		yt = lerpf(1.46, 0.95, smoothstep(0.25, 1.05, x))      # pare-brise
	elif x > -1.3:
		yt = 1.47 - 0.02 * absf(x + 0.5)                         # pavillon
	elif x > -1.86:
		yt = lerpf(1.45, 1.0, smoothstep(-1.3, -1.86, x))       # lunette
	else:
		yt = lerpf(1.0, 0.9, smoothstep(-1.86, -2.18, x))       # coffre
	ys = minf(ys, yt - 0.02)
	return [yb, ys, yt]

static func _half_width(x: float) -> float:
	var f := clampf((x - (L0 + L1) * 0.5) / ((L1 - L0) * 0.5), -1.0, 1.0)
	return HW * pow(maxf(0.0, 1.0 - pow(absf(f), 7.0)), 0.25)

static func _col(id: int, ao := 1.0) -> Color:
	return Color(1.0, ao, 1.0, (float(id) + 0.25) / 8.0)

static func build_mesh() -> ArrayMesh:
	var g := GeoBuilder.new()
	var N := 30
	var rings: Array = []
	for i in range(N + 1):
		var x := lerpf(L0, L1, float(i) / N)
		var p: Array = _profile(x)
		var yb: float = p[0]
		var ys: float = p[1]
		var yt: float = p[2]
		var w := _half_width(x)
		var cabin := x > -1.86 and x < 1.05
		var wt := w * (0.74 if cabin else 0.9)
		# section (moitié droite, z > 0) : bas, flanc arrondi, épaule, vitrage incliné, pavillon
		var pts := [Vector2(0.0, yb), Vector2(w * 0.82, yb), Vector2(w * 0.97, yb + 0.08), Vector2(w, yb + 0.22), Vector2(w, ys - 0.06), Vector2(w * 0.985, ys),
			Vector2(lerpf(w, wt, 0.25), lerpf(ys, yt, 0.12)), Vector2(lerpf(w, wt, 0.85), lerpf(ys, yt, 0.82)), Vector2(wt * 0.8, yt - 0.01), Vector2(0.0, yt)]
		rings.append([x, pts, cabin])
	for i in range(N):
		var ra: Array = rings[i]
		var rb: Array = rings[i + 1]
		var pa: Array = ra[1]
		var pb: Array = rb[1]
		var cab: bool = ra[2] and rb[2]
		var xm := (float(ra[0]) + float(rb[0])) * 0.5
		for k in range(pa.size() - 1):
			# matière du quadrilatère : vitres latérales (k = 6), pare-brise et lunette (dessus, hors pavillon), sinon peinture
			var id := 0
			if cab and k == 6 and xm > -1.75 and xm < 0.95:
				id = 1
			if k >= 7 and ((xm > 0.27 and xm < 1.03) or (xm < -1.32 and xm > -1.84)):
				id = 1
			var ao := 0.75 if k <= 1 else 1.0
			for sd in [-1.0, 1.0]:
				var a := Vector3(ra[0], pa[k].y, pa[k].x * sd)
				var b := Vector3(rb[0], pb[k].y, pb[k].x * sd)
				var c := Vector3(rb[0], pb[k + 1].y, pb[k + 1].x * sd)
				var d := Vector3(ra[0], pa[k + 1].y, pa[k + 1].x * sd)
				var mid := (a + b + c + d) * 0.25
				g.paint = _col(id, ao)
				g.quad(a, b, c, d, Vector3(0.0, mid.y - 0.8, mid.z * 2.0).normalized() if k <= 2 else Vector3(0.0, mid.y - 0.6, mid.z).normalized())
	# faces d'extrémité (avant / arrière) : éventail
	for e in [0, N]:
		var r: Array = rings[e]
		var pts: Array = r[1]
		var x: float = r[0]
		var hint := Vector3(1, 0, 0) if e == N else Vector3(-1, 0, 0)
		g.paint = _col(0)
		for k in range(pts.size() - 1):
			for sd in [-1.0, 1.0]:
				g.tri(Vector3(x, (pts[0].y + pts[pts.size() - 1].y) * 0.5, 0.0), Vector3(x, pts[k].y, pts[k].x * sd), Vector3(x, pts[k + 1].y, pts[k + 1].x * sd), hint)
	# dessous (noir)
	g.paint = _col(6, 0.4)
	g.quad(Vector3(L0 + 0.1, 0.3, -HW * 0.8), Vector3(L1 - 0.1, 0.3, -HW * 0.8), Vector3(L1 - 0.1, 0.3, HW * 0.8), Vector3(L0 + 0.1, 0.3, HW * 0.8), Vector3.DOWN)
	# passages de roue (demi-disques sombres sur le flanc) et roues
	for ax in [-AXLE, AXLE]:
		for sd in [-1.0, 1.0]:
			var z: float = (HW + 0.004) * sd
			g.paint = _col(7, 0.3)
			var n := 12
			for i in n:
				var a0 := PI * i / n
				var a1 := PI * (i + 1) / n
				g.tri(Vector3(ax, WHEEL_R, z), Vector3(ax + cos(a0) * 0.42, WHEEL_R + sin(a0) * 0.42, z), Vector3(ax + cos(a1) * 0.42, WHEEL_R + sin(a1) * 0.42, z), Vector3(0, 0, sd))
			# pneu : cylindre d'axe z
			var zc: float = 0.76 * sd
			var m := 16
			for i in m:
				var a0 := TAU * i / m
				var a1 := TAU * (i + 1) / m
				var p0 := Vector3(ax + cos(a0) * WHEEL_R, WHEEL_R + sin(a0) * WHEEL_R, 0.0)
				var p1 := Vector3(ax + cos(a1) * WHEEL_R, WHEEL_R + sin(a1) * WHEEL_R, 0.0)
				g.paint = _col(2, 0.8)
				g.quad(p0 + Vector3(0, 0, zc - 0.1), p1 + Vector3(0, 0, zc - 0.1), p1 + Vector3(0, 0, zc + 0.1), p0 + Vector3(0, 0, zc + 0.1), Vector3(cos(a0 + PI / m), sin(a0 + PI / m), 0.0))
				# flanc du pneu et jante (face extérieure)
				var c0 := Vector3(ax, WHEEL_R, zc + 0.1 * sd)
				var q0 := Vector3(ax + cos(a0) * 0.21, WHEEL_R + sin(a0) * 0.21, zc + 0.1 * sd)
				var q1 := Vector3(ax + cos(a1) * 0.21, WHEEL_R + sin(a1) * 0.21, zc + 0.1 * sd)
				g.quad(q0, p0 + Vector3(0, 0, zc + 0.1 * sd), p1 + Vector3(0, 0, zc + 0.1 * sd), q1, Vector3(0, 0, sd))
				g.paint = _col(3 if i % 4 != 0 else 6, 0.9)
				g.tri(c0 + Vector3(0, 0, 0.01 * sd), q0 + Vector3(0, 0, -0.02 * sd), q1 + Vector3(0, 0, -0.02 * sd), Vector3(0, 0, sd))
	# optiques, calandre, pare-chocs
	for sd in [-1.0, 1.0]:
		g.paint = _col(4)
		g.box(Vector3(L1 - 0.02, 0.72, 0.58 * sd), Vector3(0.06, 0.12, 0.3), 63)
		g.paint = _col(5)
		g.box(Vector3(L0 + 0.03, 0.8, 0.6 * sd), Vector3(0.06, 0.14, 0.26), 63)
		g.paint = _col(6)
		g.box(Vector3(0.88, 1.02, (HW + 0.08) * sd), Vector3(0.14, 0.1, 0.14), 63)   # rétroviseur
		for x in [0.15, -0.95]:
			g.paint = _col(6)
			g.box(Vector3(x, 0.86, (HW + 0.006) * sd), Vector3(0.16, 0.03, 0.01), 63)   # poignées
			g.paint = _col(7, 0.4)
			g.box(Vector3(x + 0.36, 0.65, (HW + 0.003) * sd), Vector3(0.008, 0.62, 0.005), 63)   # joint de porte
	g.paint = _col(6)
	g.box(Vector3(L1 - 0.01, 0.6, 0.0), Vector3(0.05, 0.14, 0.62), 63)     # calandre
	g.box(Vector3(L1 - 0.05, 0.38, 0.0), Vector3(0.14, 0.14, HW * 1.9), 63)   # pare-chocs avant
	g.box(Vector3(L0 + 0.06, 0.4, 0.0), Vector3(0.14, 0.14, HW * 1.9), 63)    # pare-chocs arrière
	g.paint = Color(-1.0, 0.0, 0.0)
	return g.build()

const CELL := 160.0

func build(xforms: Array, colors: Array) -> void:
	name = "Voitures"
	var mesh := build_mesh()
	var mat := ShaderMaterial.new()
	mat.shader = SHADER
	# une MultiMesh par maille de 160 m (comme les instances de world_view) : culling et portée par maille
	var cells := {}
	for i in xforms.size():
		var xf: Transform3D = xforms[i]
		var key := Vector2i(floori(xf.origin.x / CELL), floori(xf.origin.z / CELL))
		var lst: Array = cells.get(key, [])
		lst.append(i)
		cells[key] = lst
	for key: Vector2i in cells:
		var ids: Array = cells[key]
		var c0 := Vector3((key.x + 0.5) * CELL, 0.0, (key.y + 0.5) * CELL)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = mesh
		mm.instance_count = ids.size()
		for j in ids.size():
			var xf: Transform3D = xforms[ids[j]]
			mm.set_instance_transform(j, Transform3D(xf.basis, xf.origin - c0))
			var c: Color = colors[ids[j]] if ids[j] < colors.size() else Color(0.4, 0.4, 0.42)
			mm.set_instance_custom_data(j, c)
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		mi.position = c0
		mi.visibility_range_end = 190.0 + CELL * 0.5
		add_child(mi)
