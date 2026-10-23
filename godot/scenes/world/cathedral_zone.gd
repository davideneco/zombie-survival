extends RefCounted
## v0.32.0 : emprise de l'extérieur refait de la cathédrale. Les surfaces cuites du contour OSM (façades « éclairées » peintes, autres façades dessinées, toits)
## situées dans l'emprise changent de matériau (pierre PBR, ardoise / cuivre) ou disparaissent là où scenes/world/cathedral_nave.gd les remplace
## (contreforts et arcs-boutants en dalles pleines d'OSM, ancien comble de la nef). La collision n'est pas touchée (elle ne vient pas des tuiles).
## Fonctions pures (aucun nœud), utilisées par world_view.gd au chargement des tuiles et par le test j30.

const RECTS := [   ## [s0, t0, s1, t1] dans le repère de la nef (Cathedral.P)
	[-54.0, -27.6, -26.0, 27.6],
	[-27.0, -31.6, 9.0, 31.6],
	[9.0, -37.0, 28.0, 39.6],
	[28.0, -39.0, 47.6, 39.6],
	[46.0, -30.6, 58.45, 30.6],
]
const PIERS_S := [-24.1, -15.7, -7.5, 0.9, 9.7, 19.1]
const KEEP := 0
const STONE := 1
const ROOF := 2
const DROP := 3
const INWALL := 4   ## mur intérieur du JS vu aussi du dehors : face extérieure en pierre (shaders/cath_inwall.gdshader)

static func inside(st: Vector2) -> bool:
	for r: Array in RECTS:
		if st.x >= float(r[0]) and st.x <= float(r[2]) and st.y >= float(r[1]) and st.y <= float(r[3]):
			return true
	return false

## Boîte (x0, z0, x1, z1) de l'emprise dans la carte.
static func world_rect() -> Rect2:
	var r := Rect2()
	var first := true
	for rr: Array in RECTS:
		for c in [Vector2(rr[0], rr[1]), Vector2(rr[2], rr[1]), Vector2(rr[0], rr[3]), Vector2(rr[2], rr[3])]:
			var p := Cathedral.P(c.x, c.y)
			if first:
				r = Rect2(p, Vector2.ZERO)
				first = false
			else:
				r = r.expand(p)
	return r

## Sort d'un triangle cuit (sommets monde a, b, c) de rôle `role` ("flood", "facade", "roof", "inwall").
static func classify(role: String, a: Vector3, b: Vector3, c: Vector3) -> int:
	var m := (a + b + c) / 3.0
	var st := Cathedral.st_of(m.x, m.z)
	if not inside(st):
		# le matériau « éclairé » (rang 23) sert aussi à d'autres monuments : hors des rectangles, seulement ses murs bas collés au massif et aux bas-côtés
		if role == "flood" and st.x > -54.0 and st.x < 58.5 and absf(st.y) <= 33.0:
			return STONE
		return KEEP
	if role == "inwall":
		return INWALL
	var at := absf(st.y)
	var ymin := minf(a.y, minf(b.y, c.y))
	var in_nave := st.x > -26.6 and st.x < 28.3
	if role == "roof":
		if in_nave and at < 10.4 and m.y > 31.0:
			return DROP   # ancien comble de la nef : remplacé
		var n := (b - a).cross(c - a)
		if n.length_squared() > 1e-12 and absf(n.normalized().y) < 0.45:
			return STONE  # « volets noirs » : pans de toit presque verticaux des pièces OSM décalées -> maçonnerie
		return ROOF
	# façades
	if in_nave and at < 10.4 and m.y > 31.0:
		return DROP
	if ymin >= 11.0 and at >= 8.2 and at <= 22.45:
		for p in PIERS_S:
			if absf(st.x - float(p)) <= 1.35:
				return DROP   # contrefort + arc-boutant d'OSM (dalle pleine) : remplacé par la culée et les volées ajourées
	return STONE
