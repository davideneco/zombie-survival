extends RefCounted
## v0.32.1 : intérieur de la cathédrale, habillage réaliste (repère « nef », voir cathedral_nave.gd). L'intérieur jouable du JS reste (murs, piliers, galeries
## du triforium à 14,5 m et du clair-étage à 22,5 m, tribune, escaliers, crypte) ; on ajoute du décor qui ne touche aucune surface praticable :
##  - voûtes d'ogives quadripartites sur les 8 travées de la nef (naissance à 26 m, au-dessus des galeries ; clé à 32 m, sous l'ancien plafond plat)
##    et des deux bas-côtés (naissance 10,5 m, clé 14,4 m), nervures diagonales, doubleaux, formerets et clés pendantes ;
##  - piliers fasciculés : colonnettes autour des 18 piles (r 1,3 m au rez-de-chaussée, 0,62 m au-dessus), bases moulurées, chapiteaux à feuillages ;
##  - au-dessus des grandes arcades : arcs brisés moulurés entre les piles.
## Le dallage (shaders/cath_floor.gdshader) et la face intérieure des murs (vitraux du JS + pierre) sont réglés par world_view.gd (CathedralZone).

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")

const NAVE_S0 := -37.0
const NAVE_S1 := 28.0
const BAYS := 8
const NAVE_T := 9.0
const V_SPRING := 26.0
const V_TOP := 31.9
const AISLE_T := [[-18.5, -9.0], [9.0, 19.0]]
const A_SPRING := 10.6
const A_TOP := 14.4
const PIER_R := 1.3
const PIER_H := 14.45      ## haut du chapiteau : sous le sol des galeries du triforium (14,5 m) qui passent contre les piles
const SHAFT_R := 0.62

var stone := GeoBuilder.new()
var floor := GeoBuilder.new()   ## dallage posé à 1,2 cm au-dessus du sol (le pavé de la ville passait sous la cathédrale et l'emportait sur le damier du JS)

## Volumes de plain-pied (src/cath/plan2.js BLOCKS ; le chœur est au niveau 0 dans le jeu, la crypte dessous) et trémies des escaliers de la crypte.
const FLOOR_RECTS := [[-46.0, -23.5, -37.0, 23.5], [-37.0, -18.5, 28.0, 19.0], [9.0, -29.8, 28.0, -18.5], [9.0, 19.0, 28.0, 27.4], [28.0, -29.3, 46.0, 28.3], [46.0, -19.3, 57.6, 19.3]]
const FLOOR_HOLES := [[35.5, -7.9, 44.2, -5.5], [35.5, 5.5, 44.2, 7.9]]

func build() -> void:
	_floor()
	var step := (NAVE_S1 - NAVE_S0) / BAYS
	for i in BAYS:
		var s0 := NAVE_S0 + step * i
		var s1 := s0 + step
		_vault(s0, s1, -NAVE_T, NAVE_T, V_SPRING, V_TOP, 14)
		for a: Array in AISLE_T:
			_vault(s0, s1, float(a[0]), float(a[1]), A_SPRING, A_TOP, 10)
	for k in range(BAYS + 1):
		var s := NAVE_S0 + step * k
		for sd in [-1.0, 1.0]:
			_pier(s, NAVE_T * sd)
	for i in BAYS:
		var s0 := NAVE_S0 + step * i
		var s1 := s0 + step
		for sd in [-1.0, 1.0]:
			_arcade(s0, s1, NAVE_T * sd)

## Voûte d'arêtes (intersection de deux berceaux) sur le rectangle [s0, s1] x [t0, t1] : y = naissance + h x sqrt(1 - min(u², v²)) (u, v dans [-1, 1]),
## vue d'en dessous (normales vers le bas) ; nervures sur les diagonales, doubleaux et formerets sur les bords, clé pendante.
func _vault(s0: float, s1: float, t0: float, t1: float, y0: float, y1: float, n: int) -> void:
	var sc := (s0 + s1) * 0.5
	var tc := (t0 + t1) * 0.5
	var hs := (s1 - s0) * 0.5
	var ht := (t1 - t0) * 0.5
	var h := y1 - y0
	var P := func(u: float, v: float) -> Vector3:
		var m := minf(u * u, v * v)
		var k := sqrt(maxf(0.0, 1.0 - m))
		k = pow(k, 0.8)   # profil un peu brisé (gothique)
		return Vector3(sc + u * hs, y0 + h * k, tc + v * ht)
	stone.ao = 0.92
	for i in n:
		for j in n:
			var u0 := -1.0 + 2.0 * i / n
			var u1 := -1.0 + 2.0 * (i + 1) / n
			var v0 := -1.0 + 2.0 * j / n
			var v1 := -1.0 + 2.0 * (j + 1) / n
			# on coupe chaque case le long de la diagonale qui suit l'arête (pas de facette en travers des nervures)
			var a: Vector3 = P.call(u0, v0)
			var b: Vector3 = P.call(u1, v0)
			var c: Vector3 = P.call(u1, v1)
			var d: Vector3 = P.call(u0, v1)
			if (u0 + u1) * (v0 + v1) >= 0.0:
				stone.tri(a, b, c, Vector3.DOWN)
				stone.tri(a, c, d, Vector3.DOWN)
			else:
				stone.tri(a, b, d, Vector3.DOWN)
				stone.tri(b, c, d, Vector3.DOWN)
	# nervures diagonales : petits blocs le long des arêtes (u = +-v), sous la surface
	stone.ao = 0.8
	var m := n * 2
	for sgn in [-1.0, 1.0]:
		for i in range(m):
			var f0 := -1.0 + 2.0 * i / m
			var f1 := -1.0 + 2.0 * (i + 1) / m
			var p0: Vector3 = P.call(f0, f0 * sgn)
			var p1: Vector3 = P.call(f1, f1 * sgn)
			_rib(p0 - Vector3(0, 0.12, 0), p1 - Vector3(0, 0.12, 0), 0.32, 0.3)
	# doubleaux (bords s0 / s1) et formerets (bords t0 / t1)
	for e in [[-1.0, true], [1.0, true], [-1.0, false], [1.0, false]]:
		var fixed: float = e[0]
		var along_v: bool = e[1]
		for i in range(m):
			var f0 := -1.0 + 2.0 * i / m
			var f1 := -1.0 + 2.0 * (i + 1) / m
			var p0: Vector3 = P.call(fixed, f0) if along_v else P.call(f0, fixed)
			var p1: Vector3 = P.call(fixed, f1) if along_v else P.call(f1, fixed)
			_rib(p0 - Vector3(0, 0.15, 0), p1 - Vector3(0, 0.15, 0), 0.42 if along_v else 0.26, 0.36)
	# clé pendante
	stone.ao = 0.75
	stone.prism(sc, tc, 0.55, 0.35, y1 - 0.75, y1 - 0.05, 8, PI / 8.0, false)
	stone.prism(sc, tc, 0.18, 0.55, y1 - 0.95, y1 - 0.75, 8, PI / 8.0, false)

## Nervure : barre de section (w x d) entre deux points (d vers le haut).
func _rib(a: Vector3, b: Vector3, w: float, d: float) -> void:
	var ax := (b - a)
	if ax.length() < 1e-4:
		return
	var dir := ax.normalized()
	var side := dir.cross(Vector3.UP)
	if side.length() < 1e-3:
		side = Vector3.RIGHT
	side = side.normalized() * (w * 0.5)
	var up := side.cross(dir).normalized() * d
	if up.y < 0.0:
		up = -up
	var lo := -up * 0.5
	var c := [a + side + lo, a - side + lo, a - side + up * 0.5, a + side + up * 0.5]
	var e := [b + side + lo, b - side + lo, b - side + up * 0.5, b + side + up * 0.5]
	for i in 4:
		var j := (i + 1) % 4
		var mid: Vector3 = (c[i] + c[j]) * 0.5 - a
		stone.quad(c[i], c[j], e[j], e[i], mid)

## Pile fasciculée : 8 colonnettes engagées, base moulurée, chapiteau à feuillages ; fût supérieur à 4 colonnettes jusqu'à la naissance des voûtes.
func _pier(s: float, t: float) -> void:
	stone.ao = 0.85
	stone.prism(s, t, PIER_R + 0.2, PIER_R + 0.18, 0.0, 0.45, 8, PI / 8.0, true)    # socle (dans les 0,25 m de la collision du pilier)
	stone.prism(s, t, PIER_R + 0.16, PIER_R + 0.1, 0.45, 0.8, 16, 0.0, true)      # tore
	for i in 8:
		var a := TAU * i / 8.0
		var r := PIER_R - 0.05
		stone.ao = 0.9
		stone.prism(s + cos(a) * r, t + sin(a) * r, 0.24 if i % 2 == 0 else 0.17, 0.24 if i % 2 == 0 else 0.17, 0.8, PIER_H - 1.0, 8, 0.0, false)
	# chapiteau : corbeille évasée et feuilles (blocs inclinés), tailloir octogonal
	stone.ao = 0.8
	stone.prism(s, t, PIER_R + 0.05, PIER_R + 0.22, PIER_H - 1.0, PIER_H - 0.25, 16, 0.0, false)
	for i in 16:
		var a := TAU * (i + 0.5) / 16.0
		stone.box(Vector3(s + cos(a) * (PIER_R + 0.14), PIER_H - 0.5, t + sin(a) * (PIER_R + 0.14)), Vector3(0.24, 0.4, 0.24), 63)
	stone.ao = 0.9
	stone.prism(s, t, PIER_R + 0.25, PIER_R + 0.25, PIER_H - 0.25, PIER_H, 8, PI / 8.0, true)
	# fût supérieur : 4 colonnettes jusqu'aux voûtes, bagues aux galeries
	for i in 4:
		var a := TAU * (i + 0.5) / 4.0
		stone.ao = 0.9
		stone.prism(s + cos(a) * SHAFT_R, t + sin(a) * SHAFT_R, 0.13, 0.13, PIER_H, V_SPRING, 6, 0.0, false)
	for y in [16.6, 24.6, V_SPRING - 0.6]:   # bagues au-dessus de la tête des joueurs des galeries
		stone.ao = 0.8
		stone.prism(s, t, SHAFT_R + 0.2, SHAFT_R + 0.2, y, y + 0.3, 8, PI / 8.0, true)

## Grande arcade entre deux piles : arc brisé mouluré (deux rouleaux) au-dessus du passage nef / bas-côté.
func _arcade(s0: float, s1: float, t: float) -> void:
	var sc := (s0 + s1) * 0.5
	var hw := (s1 - s0) * 0.5 - PIER_R - 0.1
	var b := GeoBuilder.new()
	b.ao = 0.85
	b.arch_ring(0.0, 10.0, hw, 3.6, 0.0, 0.45, -0.4, 0.4, 10)
	b.ao = 0.7
	b.arch_ring(0.0, 10.0, hw, 3.6, 0.45, 0.72, -0.25, 0.25, 10)   # sommet à 14,4 m : sous la galerie du triforium (14,5 m)
	# repère : x local = t (épaisseur), z local = s ; arc dans le plan (z, y)
	stone.append_xf(b, Transform3D(Basis(Vector3(0, 0, 1), Vector3.UP, Vector3(-1, 0, 0)), Vector3(sc, 0.0, t)))


func _floor() -> void:
	floor.ao = 1.0
	var y := 0.012
	for r: Array in FLOOR_RECTS:
		# découpe en bandes le long de s, en sautant les trémies
		var s0: float = r[0]
		var t0: float = r[1]
		var s1: float = r[2]
		var t1: float = r[3]
		var cuts_s: Array = [s0, s1]
		var cuts_t: Array = [t0, t1]
		for h: Array in FLOOR_HOLES:
			for v in [h[0], h[2]]:
				if float(v) > s0 and float(v) < s1:
					cuts_s.append(float(v))
			for v in [h[1], h[3]]:
				if float(v) > t0 and float(v) < t1:
					cuts_t.append(float(v))
		cuts_s.sort()
		cuts_t.sort()
		for i in range(cuts_s.size() - 1):
			for j in range(cuts_t.size() - 1):
				var a: float = cuts_s[i]
				var b: float = cuts_s[i + 1]
				var c: float = cuts_t[j]
				var d: float = cuts_t[j + 1]
				var ms := (a + b) * 0.5
				var mt := (c + d) * 0.5
				var hole := false
				for h: Array in FLOOR_HOLES:
					if ms > float(h[0]) and ms < float(h[2]) and mt > float(h[1]) and mt < float(h[3]):
						hole = true
				if not hole:
					floor.quad(Vector3(a, y, c), Vector3(b, y, c), Vector3(b, y, d), Vector3(a, y, d), Vector3.UP)
