extends Node3D
## v0.32.4 : voitures garées (décor du JS : « voitures abandonnées », 4,36 x 1,72 m, boîte de collision 4,2 x 1,75 x 1,5 inchangée). Le modèle cuit (caisse
## en boîtes) est remplacé par des voitures modélisées par code : caisse en sections lissées (capot, pare-brise incliné, pavillon, lunette, coffre, épaules,
## rétrécissement du vitrage), vitres latérales, passages de roue, roues (pneu, jante à rayons), optiques, calandre, pare-chocs, rétroviseurs, poignées.
## v0.33.2 : quatre silhouettes au lieu d'une (MODELS) : citadine (celle de v0.32.4, inchangée), break, ludospace / fourgonnette (flancs arrière
## tôlés, toit haut) et SUV compact (garde au sol haute, protections noires, barres de toit, roues plus grandes). Le modèle d'une voiture est tiré de sa
## position (stable d'une partie à l'autre), la peinture reste celle du JS (les fourgonnettes sont souvent blanches). Même encombrement au sol que la
## collision du JS ; la fourgonnette dépasse la hauteur de la boîte de collision (1,76 m contre 1,5 m : rien ne se cache dessous, les balles passent
## au-dessus de 1,5 m comme avant sur le toit des autres).
## Même repère que le modèle du JS : x vers l'avant, y haut, z largeur, origine au sol au milieu. Une MultiMesh par modèle et par maille (peinture par instance).

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const SHADER := preload("res://shaders/car.gdshader")

const L0 := -2.18
const L1 := 2.17
const HW := 0.86

## Silhouettes : profil du dessus (hx : bas du pare-brise, wx : haut du pare-brise, rx : début de la lunette, gx : bas de la lunette ;
## hood0 / hood1 : hauteur du capot à l'avant / au pied du pare-brise ; roof ; trunk : haut du coffre), bas de caisse yb, ligne d'épaule
## (shoulder), resserrement du vitrage (tumble), vitres latérales de win0 à win1, essieux, rayon des roues, poids du tirage.
const MODELS := [
	{"name": "citadine", "hx": 1.05, "wx": 0.25, "rx": -1.3, "gx": -1.86, "hood0": 0.78, "hood1": 0.94, "roof": 1.47, "trunk": 1.0, "yb": 0.30,
		"shoulder": [0.86, 0.96, 0.93], "tumble": 0.74, "win0": -1.75, "win1": 0.95, "axle": 1.32, "wheel": 0.32, "weight": 4},
	{"name": "break", "hx": 1.12, "wx": 0.32, "rx": -1.86, "gx": -2.06, "hood0": 0.76, "hood1": 0.93, "roof": 1.45, "trunk": 1.02, "yb": 0.29,
		"shoulder": [0.85, 0.94, 0.95], "tumble": 0.78, "win0": -1.95, "win1": 1.0, "axle": 1.38, "wheel": 0.32, "weight": 3},
	{"name": "fourgonnette", "hx": 1.48, "wx": 0.78, "rx": -2.02, "gx": -2.1, "hood0": 0.86, "hood1": 1.06, "roof": 1.76, "trunk": 1.2, "yb": 0.33,
		"shoulder": [1.0, 1.08, 1.1], "tumble": 0.93, "win0": -0.2, "win1": 1.38, "axle": 1.38, "wheel": 0.31, "weight": 2},
	{"name": "suv", "hx": 1.2, "wx": 0.38, "rx": -1.55, "gx": -1.98, "hood0": 0.92, "hood1": 1.08, "roof": 1.63, "trunk": 1.12, "yb": 0.42,
		"shoulder": [1.02, 1.1, 1.1], "tumble": 0.8, "win0": -1.88, "win1": 1.1, "axle": 1.34, "wheel": 0.36, "weight": 3},
]

## Profil le long de x : (bas, ligne d'épaule, haut) pour la silhouette M.
static func _profile(M: Dictionary, x: float) -> Array:
	var yb := float(M["yb"]) + 0.06 * smoothstep(1.7, 2.17, absf(x))
	var sh: Array = M["shoulder"]
	var ys := lerpf(float(sh[0]), float(sh[1]), smoothstep(2.17, 0.9, x)) if x > 0.0 else lerpf(float(sh[1]), float(sh[2]), smoothstep(-1.6, -2.18, x))
	var hx := float(M["hx"])
	var wx := float(M["wx"])
	var rx := float(M["rx"])
	var gx := float(M["gx"])
	var roof := float(M["roof"])
	var yt: float
	if x > hx:
		yt = lerpf(float(M["hood1"]), float(M["hood0"]), smoothstep(hx, L1, x))   # capot
	elif x > wx:
		yt = lerpf(roof - 0.01, float(M["hood1"]) + 0.01, smoothstep(wx, hx, x))  # pare-brise
	elif x > rx:
		yt = roof - 0.02 * absf(x - (wx + rx) * 0.5)                               # pavillon
	elif x > gx:
		yt = lerpf(roof - 0.02, float(M["trunk"]), smoothstep(rx, gx, x))         # lunette (hayon)
	else:
		yt = lerpf(float(M["trunk"]), float(M["trunk"]) - 0.1, smoothstep(gx, L0, x))   # coffre
	ys = minf(ys, yt - 0.02)
	return [yb, ys, yt]

static func _half_width(x: float) -> float:
	var f := clampf((x - (L0 + L1) * 0.5) / ((L1 - L0) * 0.5), -1.0, 1.0)
	return HW * pow(maxf(0.0, 1.0 - pow(absf(f), 7.0)), 0.25)

static func _col(id: int, ao := 1.0) -> Color:
	return Color(1.0, ao, 1.0, (float(id) + 0.25) / 8.0)

## Maillage de la silhouette `kind` (indice de MODELS). Constructeur rempli : tests (encombrement).
static func builder(kind := 0) -> GeoBuilder:
	var M: Dictionary = MODELS[kind]
	var g := GeoBuilder.new()
	var N := 30
	var hx := float(M["hx"])
	var wx := float(M["wx"])
	var rx := float(M["rx"])
	var gx := float(M["gx"])
	var rings: Array = []
	for i in range(N + 1):
		var x := lerpf(L0, L1, float(i) / N)
		var p: Array = _profile(M, x)
		var yb: float = p[0]
		var ys: float = p[1]
		var yt: float = p[2]
		var w := _half_width(x)
		var cabin := x > gx and x < hx
		var wt := w * (float(M["tumble"]) if cabin else 0.9)
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
			if cab and k == 6 and xm > float(M["win0"]) and xm < float(M["win1"]):
				id = 1
			if k >= 7 and ((xm > wx + 0.02 and xm < hx - 0.02) or (xm < rx - 0.02 and xm > gx + 0.02)):
				id = 1
			if kind == 3 and k <= 2:   # SUV : protections noires du bas de caisse
				id = 6
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
	var yb0 := float(M["yb"])
	# dessous (noir)
	g.paint = _col(6, 0.4)
	g.quad(Vector3(L0 + 0.1, yb0, -HW * 0.8), Vector3(L1 - 0.1, yb0, -HW * 0.8), Vector3(L1 - 0.1, yb0, HW * 0.8), Vector3(L0 + 0.1, yb0, HW * 0.8), Vector3.DOWN)
	# passages de roue (demi-disques sombres sur le flanc) et roues
	var wr := float(M["wheel"])
	var arch := wr + 0.1
	for ax: float in [-float(M["axle"]), float(M["axle"])]:
		for sd in [-1.0, 1.0]:
			var z: float = (HW + 0.004) * sd
			g.paint = _col(7, 0.3)
			var n := 12
			for i in n:
				var a0 := PI * i / n
				var a1 := PI * (i + 1) / n
				g.tri(Vector3(ax, wr, z), Vector3(ax + cos(a0) * arch, wr + sin(a0) * arch, z), Vector3(ax + cos(a1) * arch, wr + sin(a1) * arch, z), Vector3(0, 0, sd))
			if kind == 3:   # SUV : élargisseurs d'aile noirs autour du passage de roue
				g.paint = _col(6, 0.8)
				for i in n:
					var a0 := PI * i / n
					var a1 := PI * (i + 1) / n
					g.quad(Vector3(ax + cos(a0) * arch, wr + sin(a0) * arch, z + 0.002 * sd), Vector3(ax + cos(a1) * arch, wr + sin(a1) * arch, z + 0.002 * sd),
						Vector3(ax + cos(a1) * (arch + 0.07), wr + sin(a1) * (arch + 0.07), z + 0.002 * sd), Vector3(ax + cos(a0) * (arch + 0.07), wr + sin(a0) * (arch + 0.07), z + 0.002 * sd), Vector3(0, 0, sd))
			# pneu : cylindre d'axe z
			var zc: float = 0.76 * sd
			var m := 16
			var rim := wr * 0.66
			for i in m:
				var a0 := TAU * i / m
				var a1 := TAU * (i + 1) / m
				var p0 := Vector3(ax + cos(a0) * wr, wr + sin(a0) * wr, 0.0)
				var p1 := Vector3(ax + cos(a1) * wr, wr + sin(a1) * wr, 0.0)
				g.paint = _col(2, 0.8)
				g.quad(p0 + Vector3(0, 0, zc - 0.1), p1 + Vector3(0, 0, zc - 0.1), p1 + Vector3(0, 0, zc + 0.1), p0 + Vector3(0, 0, zc + 0.1), Vector3(cos(a0 + PI / m), sin(a0 + PI / m), 0.0))
				# flanc du pneu et jante (face extérieure)
				var c0 := Vector3(ax, wr, zc + 0.1 * sd)
				var q0 := Vector3(ax + cos(a0) * rim, wr + sin(a0) * rim, zc + 0.1 * sd)
				var q1 := Vector3(ax + cos(a1) * rim, wr + sin(a1) * rim, zc + 0.1 * sd)
				g.quad(q0, p0 + Vector3(0, 0, zc + 0.1 * sd), p1 + Vector3(0, 0, zc + 0.1 * sd), q1, Vector3(0, 0, sd))
				g.paint = _col(3 if i % 4 != 0 else 6, 0.9)
				g.tri(c0 + Vector3(0, 0, 0.01 * sd), q0 + Vector3(0, 0, -0.02 * sd), q1 + Vector3(0, 0, -0.02 * sd), Vector3(0, 0, sd))
	# optiques, calandre, pare-chocs, rétroviseurs, poignées, joints de portes
	var hood0 := float(M["hood0"])
	var trunk := float(M["trunk"])
	var mir_y := float(_profile(M, hx - 0.15)[1]) + 0.06
	for sd in [-1.0, 1.0]:
		g.paint = _col(4)
		g.box(Vector3(L1 - 0.02, hood0 - 0.06, 0.58 * sd), Vector3(0.06, 0.12, 0.3), 63)
		g.paint = _col(5)
		g.box(Vector3(L0 + 0.03, minf(trunk - 0.2, 0.8 + (trunk - 1.0)), 0.6 * sd), Vector3(0.06, 0.14 if kind != 2 else 0.3, 0.26 if kind != 2 else 0.12), 63)
		g.paint = _col(6)
		g.box(Vector3(hx - 0.17, mir_y, (HW + 0.08) * sd), Vector3(0.14, 0.1 if kind != 2 else 0.16, 0.14), 63)   # rétroviseur
		var doors: Array = [0.15, -0.95] if kind != 2 else [0.55]
		for x: float in doors:
			g.paint = _col(6)
			var ysx := float(_profile(M, x)[1])
			g.box(Vector3(x, ysx - 0.1, (HW + 0.006) * sd), Vector3(0.16, 0.03, 0.01), 63)   # poignées
			g.paint = _col(7, 0.4)
			g.box(Vector3(x + 0.36, (yb0 + ysx) * 0.5 + 0.05, (HW + 0.003) * sd), Vector3(0.008, ysx - yb0 - 0.1, 0.005), 63)   # joint de porte
	if kind == 2:   # fourgonnette : porte latérale coulissante (rail et joint), portes arrière battantes (joint vertical, poignée)
		for sd in [-1.0, 1.0]:
			g.paint = _col(7, 0.4)
			g.box(Vector3(-0.55, 1.12, (HW + 0.004) * sd), Vector3(1.3, 0.012, 0.006), 63)
			g.box(Vector3(-1.25, 0.75, (HW + 0.003) * sd), Vector3(0.008, 0.85, 0.005), 63)
		g.paint = _col(7, 0.4)
		g.box(Vector3(L0 - 0.003, 1.0, 0.0), Vector3(0.006, 1.2, 0.008), 63)
		g.paint = _col(6)
		g.box(Vector3(L0 - 0.006, 1.0, 0.12), Vector3(0.012, 0.03, 0.14), 63)   # poignée
		g.paint = _col(1)
		g.box(Vector3(L0 - 0.004, 1.4, 0.0), Vector3(0.008, 0.34, 1.16), 63)   # vitres des portes arrière
	if kind == 3:   # SUV : barres de toit
		for sd in [-1.0, 1.0]:
			g.paint = _col(6, 0.9)
			g.box(Vector3((wx + rx) * 0.5, float(M["roof"]) + 0.04, 0.55 * sd), Vector3(wx - rx - 0.1, 0.04, 0.05), 63)
			for x: float in [wx - 0.1, rx + 0.1]:
				g.box(Vector3(x, float(M["roof"]) + 0.015, 0.55 * sd), Vector3(0.08, 0.04, 0.06), 63)
	g.paint = _col(6)
	g.box(Vector3(L1 - 0.01, hood0 - 0.18, 0.0), Vector3(0.05, 0.14 if kind != 3 else 0.2, 0.62), 63)                  # calandre
	g.box(Vector3(L1 - 0.05, yb0 + 0.08, 0.0), Vector3(0.14, 0.14 if kind != 3 else 0.2, HW * 1.9), 63)                # pare-chocs avant
	g.box(Vector3(L0 + 0.06, yb0 + 0.1, 0.0), Vector3(0.14, 0.14 if kind != 3 else 0.2, HW * 1.9), 63)                 # pare-chocs arrière
	g.paint = Color(-1.0, 0.0, 0.0)
	return g

static func build_mesh(kind := 0) -> ArrayMesh:
	return builder(kind).build()

## Silhouette d'une voiture tirée de sa position (stable), selon les poids de MODELS.
static func kind_at(p: Vector3) -> int:
	var total := 0
	for M: Dictionary in MODELS:
		total += int(M["weight"])
	var h := absi(hash(Vector2i(roundi(p.x * 4.0), roundi(p.z * 4.0)))) % total
	for i in MODELS.size():
		h -= int(MODELS[i]["weight"])
		if h < 0:
			return i
	return 0

const CELL := 160.0

var counts: Array = [0, 0, 0, 0]   ## voitures par silhouette

func build(xforms: Array, colors: Array) -> void:
	name = "Voitures"
	var meshes: Array = []
	for k in MODELS.size():
		meshes.append(build_mesh(k))
	var mat := ShaderMaterial.new()
	mat.shader = SHADER
	# une MultiMesh par silhouette et par maille de 160 m (comme les instances de world_view) : culling et portée par maille
	var cells := {}
	var first: Array = ["", "", "", ""]   # une position par silhouette (journal : captures)
	for i in xforms.size():
		var xf: Transform3D = xforms[i]
		var kind := kind_at(xf.origin)
		counts[kind] += 1
		if first[kind] == "":
			first[kind] = "(%.0f ; %.0f)" % [xf.origin.x, xf.origin.z]
		var key := Vector3i(floori(xf.origin.x / CELL), floori(xf.origin.z / CELL), kind)
		var lst: Array = cells.get(key, [])
		lst.append(i)
		cells[key] = lst
	for key: Vector3i in cells:
		var ids: Array = cells[key]
		var c0 := Vector3((key.x + 0.5) * CELL, 0.0, (key.y + 0.5) * CELL)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = meshes[key.z]
		mm.instance_count = ids.size()
		for j in ids.size():
			var xf: Transform3D = xforms[ids[j]]
			mm.set_instance_transform(j, Transform3D(xf.basis, xf.origin - c0))
			var c: Color = colors[ids[j]] if ids[j] < colors.size() else Color(0.4, 0.4, 0.42)
			if key.z == 2 and absi(hash(xf.origin)) % 3 != 0:   # fourgonnettes : souvent blanches (utilitaires)
				c = Color(0.86, 0.87, 0.85)
			mm.set_instance_custom_data(j, c)
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		mi.position = c0
		mi.visibility_range_end = 190.0 + CELL * 0.5
		add_child(mi)
	print("voitures garées : %d (citadines %d, breaks %d, fourgonnettes %d, SUV %d ; par exemple %s)" % [xforms.size(), counts[0], counts[1], counts[2], counts[3], " ".join(first)])
