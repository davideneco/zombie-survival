extends RefCounted
## v0.32.0 : extérieur du transept, de la tour de croisée, du chœur et des chapelles de la cathédrale (repère « nef », voir cathedral_nave.gd).
## Les volumes intérieurs du JS (src/cath/plan2.js BLOCKS) ont des toits plats (dalles de plafond vues du dessus) : on les coiffe de vrais combles
## (transept à deux versants, chœur à pignon, appentis des chapelles), on habille la tour de croisée (octogone à arcatures, flèche octogonale, lanterne)
## et on dresse les pignons des bras du transept (rose, gâble, pinacles). Décor seul : collision et étages inchangés.

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const CathedralNave := preload("res://scenes/world/cathedral_nave.gd")

const TR_S := [28.0, 46.0]
const TR_T := [-30.3, 29.25]   ## faces extérieures des pignons nord et sud du transept
const TR_EAVE := 28.3
const TR_RIDGE := 38.0
const CROSS_C := Vector2(37.0, 0.0)
const CROSS_R := 9.0           ## rayon (aux sommets) du tambour octogonal de la croisée
const CROSS_TOP := 46.5
const CROSS_TIP := 59.0
const CHOIR_S := [46.0, 57.7]
const CHOIR_T := 8.7
const CHOIR_EAVE := 28.3
const CHOIR_RIDGE := 36.5

var stone := GeoBuilder.new()
var glass := GeoBuilder.new()
var roof := GeoBuilder.new()

func build() -> void:
	_transept_roofs()
	_transept_gables()
	_crossing()
	_choir()
	_chapel_roofs()

func _transept_roofs() -> void:
	var sm := (TR_S[0] + TR_S[1]) * 0.5
	for arm in [[TR_T[0], -CROSS_R * 0.92], [CROSS_R * 0.92, TR_T[1]]]:
		var t0: float = arm[0]
		var t1: float = arm[1]
		roof.ao = 1.0
		for side in [[TR_S[0] - 0.4, -1.0], [TR_S[1] + 0.4, 1.0]]:
			var se: float = side[0]
			roof.quad(Vector3(se, TR_EAVE, t0), Vector3(se, TR_EAVE, t1), Vector3(sm, TR_RIDGE, t1), Vector3(sm, TR_RIDGE, t0), Vector3(float(side[1]), 1.0, 0.0))
		roof.ao = 0.7
		roof.box(Vector3(sm, TR_RIDGE + 0.08, (t0 + t1) * 0.5), Vector3(0.3, 0.2, absf(t1 - t0)), 63)
		# balustrade de corniche le long des deux égouts
		stone.ao = 0.9
		for se in [TR_S[0] - 0.2, TR_S[1] + 0.2]:
			stone.balustrade(Vector3(se, TR_EAVE - 0.5, t0), Vector3(se, TR_EAVE - 0.5, t1), 0.9, 0.5, 0.3)

func _transept_gables() -> void:
	var hw := (TR_S[1] - TR_S[0]) * 0.5 + 0.4
	for k in 2:
		var tf: float = TR_T[k]
		var sd := -1.0 if k == 0 else 1.0
		# repère du mur (cathedral_nave.gd _wall_xf) : x sortant, z = s au nord, -s au sud ; tout est symétrique autour du milieu du pignon
		var sm := -sd * (TR_S[0] + TR_S[1]) * 0.5
		var g := GeoBuilder.new()
		var gl := GeoBuilder.new()
		g.ao = 0.95
		g.extrude(PackedVector2Array([Vector2(sm - hw, TR_EAVE - 1.0), Vector2(sm + hw, TR_EAVE - 1.0), Vector2(sm, TR_RIDGE + 1.2)]), -0.5, 0.3, true)
		g.ao = 0.85
		for dz in [-1.0, 1.0]:   # rampants saillants à crochets
			var a := Vector2(sm + hw * dz, TR_EAVE - 0.6)
			var b := Vector2(sm, TR_RIDGE + 1.5)
			g.bar_x(a.x, a.y, b.x, b.y, 0.55, 0.0, 0.55)
			for i in range(1, 7):
				var p := a.lerp(b, float(i) / 7.0)
				g.box(Vector3(0.45, p.y + 0.35, p.x), Vector3(0.3, 0.45, 0.3), 63)
		g.box(Vector3(0.3, TR_RIDGE + 2.2, sm), Vector3(0.5, 1.4, 0.5), 63)   # fleuron
		var yc := TR_EAVE + 3.6   # rose du pignon
		g.annulus_x(sm, yc, 2.4, 2.9, 0.0, 0.5, 24)
		g.ao = 0.7
		for i in 8:
			var a := TAU * i / 8.0
			g.bar_x(sm + cos(a) * 0.5, yc + sin(a) * 0.5, sm + cos(a) * 2.4, yc + sin(a) * 2.4, 0.18, 0.1, 0.4)
		g.annulus_x(sm, yc, 0.35, 0.55, 0.1, 0.4, 12)
		var n := 32
		for i in n:
			var a0 := TAU * i / n
			var a1 := TAU * (i + 1) / n
			gl.tri(Vector3(0.15, yc, sm), Vector3(0.15, yc + sin(a0) * 2.45, sm + cos(a0) * 2.45), Vector3(0.15, yc + sin(a1) * 2.45, sm + cos(a1) * 2.45), Vector3.RIGHT)
		g.ao = 0.95
		for dz in [-1.0, 1.0]:   # pinacles d'angle
			g.pinnacle(0.2, sm + hw * dz, 1.2, TR_EAVE - 1.0, TR_EAVE + 2.2, TR_EAVE + 6.5)
		var xf := CathedralNave._wall_xf(tf, sd)
		stone.append_xf(g, xf)
		glass.append_xf(gl, xf)

func _crossing() -> void:
	var c := CROSS_C
	var n := 8
	var rot := PI / 8.0
	var apo := CROSS_R * cos(PI / n)
	# tambour
	stone.ao = 0.95
	stone.prism(c.x, c.y, CROSS_R, CROSS_R, TR_RIDGE - 4.0, CROSS_TOP, n, rot, false)
	# arcatures aveugles et petites baies sur chaque pan
	for i in n:
		var a := rot + TAU * (i + 0.5) / n
		var d := Vector3(cos(a), 0.0, sin(a))
		var center := Vector3(c.x, 0.0, c.y) + d * apo
		var face_w := 2.0 * CROSS_R * sin(PI / n)
		var b := GeoBuilder.new()
		b.ao = 0.6
		for k in [-1.0, 0.0, 1.0]:
			var z := float(k) * face_w * 0.28
			b.arch_fill(z, 40.0, 0.7, 1.6, 0.02, 0.12, 8)
			b.ao = 0.9
			b.arch_ring(z, 40.0, 0.7, 1.6, 0.0, 0.18, 0.0, 0.25, 8)
			b.box(Vector3(0.12, 38.2, z + 0.85), Vector3(0.25, 3.6, 0.22), 63)
			b.box(Vector3(0.12, 38.2, z - 0.85), Vector3(0.25, 3.6, 0.22), 63)
			b.ao = 0.6
		b.ao = 0.85
		b.box(Vector3(0.2, 36.2, 0.0), Vector3(0.4, 0.35, face_w), 63)   # cordon
		b.box(Vector3(0.25, CROSS_TOP - 0.3, 0.0), Vector3(0.5, 0.6, face_w + 0.2), 63)   # corniche à modillons
		for k in 9:
			b.box(Vector3(0.35, CROSS_TOP - 0.75, -face_w * 0.45 + face_w * 0.9 * k / 8.0), Vector3(0.3, 0.3, 0.22), 63)
		var gl := GeoBuilder.new()
		var poly := PackedVector2Array([Vector2(-0.35, 42.0)])
		poly.append_array(GeoBuilder.pointed_arch(0.0, 43.4, 0.35, 0.5, 4))
		poly.append(Vector2(0.35, 42.0))
		gl.extrude(poly, 0.03, 0.05)
		b.ao = 0.85
		b.arch_ring(0.0, 43.4, 0.35, 0.5, 0.0, 0.15, 0.0, 0.2, 4)
		var xf := Transform3D(Basis(d, Vector3.UP, d.cross(Vector3.UP)), center)
		stone.append_xf(b, xf)
		glass.append_xf(gl, xf)
		# contreforts plats aux angles
		var corner := Vector3(c.x, 0.0, c.y) + Vector3(cos(rot + TAU * i / n), 0.0, sin(rot + TAU * i / n)) * (CROSS_R + 0.15)
		stone.ao = 0.95
		stone.box(Vector3(corner.x, (TR_RIDGE - 4.0 + CROSS_TOP) * 0.5, corner.z), Vector3(0.7, CROSS_TOP - TR_RIDGE + 4.0, 0.7), 63 & ~8)
	# flèche octogonale à lucarnes, lanterne et croix
	roof.ao = 1.0
	roof.spire(c.x, c.y, CROSS_R + 0.5, CROSS_TOP, CROSS_TIP, n, rot)
	for i in n:
		var a := rot + TAU * (i + 0.5) / n
		var d := Vector3(cos(a), 0.0, sin(a))
		var p := Vector3(c.x, 0.0, c.y) + d * (CROSS_R * 0.62)
		var b := GeoBuilder.new()
		b.ao = 0.9
		b.extrude(PackedVector2Array([Vector2(-0.6, 0.0), Vector2(0.6, 0.0), Vector2(0.6, 1.3), Vector2(0.0, 2.1), Vector2(-0.6, 1.3)]), -1.2, 0.0, true)
		b.ao = 0.35
		b.box(Vector3(0.02, 0.7, 0.0), Vector3(0.05, 0.9, 0.6), 63)
		stone.append_xf(b, Transform3D(Basis(d, Vector3.UP, d.cross(Vector3.UP)), p + Vector3(0, CROSS_TOP + 4.6, 0)))
	stone.ao = 0.9
	stone.prism(c.x, c.y, 0.9, 0.9, CROSS_TIP - 3.2, CROSS_TIP - 0.6, 8, rot, true)
	roof.spire(c.x, c.y, 1.1, CROSS_TIP - 0.6, CROSS_TIP + 2.2, 8, rot)
	stone.box(Vector3(c.x, CROSS_TIP + 3.0, c.y), Vector3(0.12, 1.8, 0.12), 63)
	stone.box(Vector3(c.x, CROSS_TIP + 3.3, c.y), Vector3(0.7, 0.12, 0.12), 63)

func _choir() -> void:
	roof.ao = 1.0
	var s0: float = CHOIR_S[0]
	var s1: float = CHOIR_S[1]
	for sd in [-1.0, 1.0]:
		roof.quad(Vector3(s0, CHOIR_EAVE, (CHOIR_T + 0.3) * sd), Vector3(s1, CHOIR_EAVE, (CHOIR_T + 0.3) * sd), Vector3(s1, CHOIR_RIDGE, 0.0), Vector3(s0, CHOIR_RIDGE, 0.0), Vector3(0.0, 1.0, sd))
		stone.ao = 0.9
		stone.balustrade(Vector3(s0, CHOIR_EAVE - 0.5, (CHOIR_T + 0.1) * sd), Vector3(s1, CHOIR_EAVE - 0.5, (CHOIR_T + 0.1) * sd), 0.9, 0.5, 0.3)
	roof.ao = 0.7
	roof.box(Vector3((s0 + s1) * 0.5, CHOIR_RIDGE + 0.08, 0.0), Vector3(s1 - s0, 0.2, 0.3), 63)
	# pignon est : triangle, oculus, croix
	stone.ao = 0.95
	stone.extrude(PackedVector2Array([Vector2(-CHOIR_T - 0.4, CHOIR_EAVE - 1.0), Vector2(CHOIR_T + 0.4, CHOIR_EAVE - 1.0), Vector2(0.0, CHOIR_RIDGE + 0.9)]), s1 - 0.3, s1 + 0.4, true)
	stone.ao = 0.8
	stone.annulus_x(0.0, CHOIR_EAVE + 3.0, 1.2, 1.6, s1 + 0.3, s1 + 0.7, 18)
	stone.box(Vector3(s1 + 0.2, CHOIR_RIDGE + 2.0, 0.0), Vector3(0.15, 2.2, 0.15), 63)
	stone.box(Vector3(s1 + 0.2, CHOIR_RIDGE + 2.4, 0.0), Vector3(0.15, 0.15, 1.0), 63)
	var n := 24
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		glass.tri(Vector3(s1 + 0.5, CHOIR_EAVE + 3.0, 0.0), Vector3(s1 + 0.5, CHOIR_EAVE + 3.0 + sin(a0) * 1.25, cos(a0) * 1.25), Vector3(s1 + 0.5, CHOIR_EAVE + 3.0 + sin(a1) * 1.25, cos(a1) * 1.25), Vector3.RIGHT)

func _chapel_roofs() -> void:
	# appentis : [s0, s1, t extérieur, y bas, t intérieur, y haut]
	var list := [
		[46.0, 57.6, -19.6, 12.3, -CHOIR_T - 0.2, 17.5], [46.0, 57.6, 19.6, 12.3, CHOIR_T + 0.2, 17.5],
		[9.0, 28.0, -30.1, 11.4, -19.4, 13.9], [9.0, 28.0, 27.7, 11.4, 19.7, 13.9],
	]
	for r: Array in list:
		var s0: float = r[0]
		var s1: float = r[1]
		var to: float = r[2]
		var yo: float = r[3]
		var ti: float = r[4]
		var yi: float = r[5]
		var sd := signf(to)
		roof.ao = 1.0
		roof.quad(Vector3(s0, yo, to), Vector3(s1, yo, to), Vector3(s1, yi, ti), Vector3(s0, yi, ti), Vector3(0.0, 1.0, sd * 0.5))
		stone.ao = 0.85
		stone.box(Vector3((s0 + s1) * 0.5, yo - 0.3, to), Vector3(s1 - s0, 0.6, 0.7), 63)   # corniche
		for s in [s0, s1]:   # rives de pierre (triangles des pignons d'appentis)
			stone.extrude(PackedVector2Array([Vector2(to, yo - 0.6), Vector2(ti, yi - 0.6), Vector2(ti, yi), Vector2(to, yo)]), s - 0.25, s + 0.25, true)
