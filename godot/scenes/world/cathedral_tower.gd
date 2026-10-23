extends RefCounted
## v0.32.0 : tour nord et flèche de la cathédrale, habillage extérieur (repère « nef », voir cathedral_nave.gd). Les volumes jouables du JS restent
## (src/cath/spire.js : octogone de 67,5 à 104 m avec son escalier, terrasse, quatre tourelles d'angle, pagode de 104 à 128 m entourée de la rampe,
## balcon du Fanal à 128 m, aiguille jusqu'à 142 m) ; on ajoute, sans rien poser sur les surfaces praticables :
##  - sur les huit pans de l'octogone : grandes lancettes à remplage (une par pan libre, deux de part et d'autre des tourelles), contreforts d'angle
##    sur culots (au-dessus de la tête des joueurs de la plateforme), gâbles et corniche ;
##  - autour des tourelles : cages ajourées (colonnettes, bandeaux, hélice de l'escalier) et flèches à crochets ;
##  - sur la pagode : baies aveugles à chaque étage (saillie de 6 cm : la rampe passe à 10 cm du mur) et, au-delà du garde-corps de la rampe,
##    les huit colonnes de tourelles empilées qui montent jusqu'à la couronne ;
##  - sur l'aiguille : crochets, couronne et lanterne.

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")

const C := Vector2(-39.5, -14.0)   ## Cathedral.TOWER_C
const R := 9.6
const PLAT := 67.5
const TOP := 104.0
const TIP := 128.0
const NEEDLE := 142.0
const RB0 := 6.35
const RB1 := 1.9

var stone := GeoBuilder.new()
var glass := GeoBuilder.new()

static func rb(y: float) -> float:
	return RB0 + (RB1 - RB0) * ((y - TOP) / (TIP - TOP))

static func _dir(deg: float) -> Vector3:
	var a := deg_to_rad(deg)
	return Vector3(cos(a), 0.0, sin(a))

static func _pt(r: float, deg: float, y: float) -> Vector3:
	var d := _dir(deg)
	return Vector3(C.x + d.x * r, y, C.y + d.z * r)

func build() -> void:
	_octagon()
	for k in 4:
		_turret(45.0 + 90.0 * k)
	_pagoda()
	_needle()

# ----------------------------------------------------------------- octogone
func _octagon() -> void:
	var apo := R * cos(PI / 8.0)
	var face_w := 2.0 * R * sin(PI / 8.0)
	for k in 8:
		var deg := 45.0 * k
		var d := _dir(deg)
		var b := GeoBuilder.new()
		var g := GeoBuilder.new()
		var turret := k % 2 == 1
		var D := 0.3
		var y0 := PLAT + 3.8
		var y1 := TOP - 0.6
		# baies : une grande au milieu des pans libres, deux étroites de part et d'autre de la tourelle
		var bays: Array = [[-face_w * 0.5, face_w * 0.5, 0.0, 2.0]] if not turret else [[-face_w * 0.5, -1.75, -face_w * 0.25 - 0.85, 0.5], [1.75, face_w * 0.5, face_w * 0.25 + 0.85, 0.5]]
		for bay: Array in bays:
			var z0: float = bay[0]
			var z1: float = bay[1]
			var zc: float = bay[2]
			var hw: float = bay[3]
			var spring := 94.0
			var rise := hw * 1.6 + 0.6
			b.ao = 0.95
			b.wall_bay(z0, z1, y0, y1, zc, hw, 73.5, spring, rise, 0.0, D)
			b.ao = 0.6
			b.tracery(zc, hw, 73.5, spring, rise, 0.05, 0.25, 3 if hw > 1.0 else 1)
			b.ao = 0.9
			b.arch_ring(zc, spring, hw, rise, 0.0, 0.25, D, D + 0.2, 10)
			# gâble au-dessus de la baie
			var gy := spring + rise + 0.4
			b.extrude(PackedVector2Array([Vector2(zc - hw - 0.4, gy), Vector2(zc + hw + 0.4, gy), Vector2(zc, gy + (hw + 0.4) * 2.2)]), D, D + 0.25, true)
			var gl := PackedVector2Array([Vector2(zc - hw, 73.5)])
			gl.append_array(GeoBuilder.pointed_arch(zc, spring, hw, rise, 10))
			gl.append(Vector2(zc + hw, 73.5))
			g.extrude(gl, 0.1, 0.12)
		# soubassement plein du pan (sous les baies), sans saillie au niveau de la plateforme (on y marche)
		b.ao = 0.8
		b.box(Vector3(D + 0.15, y0 - 0.1, 0.0), Vector3(0.3, 0.4, face_w), 63)   # larmier
		b.box(Vector3(D + 0.2, TOP - 0.3, 0.0), Vector3(0.4, 0.6, face_w + 0.3), 63)   # corniche
		var xf := Transform3D(Basis(d, Vector3.UP, d.cross(Vector3.UP)), Vector3(C.x, 0.0, C.y) + d * apo)
		stone.append_xf(b, xf)
		glass.append_xf(g, xf)
	# contreforts d'angle sur culots (à 2,2 m au-dessus de la plateforme) et pinacles sur la terrasse
	for k in 8:
		var deg := 22.5 + 45.0 * k
		var d := _dir(deg)
		var p := Vector3(C.x, 0.0, C.y) + d * (R + 0.35)
		var b := GeoBuilder.new()
		b.ao = 0.9
		b.box(Vector3(0.0, (PLAT + 3.0 + TOP) * 0.5, 0.0), Vector3(0.9, TOP - PLAT - 3.0, 0.7), 63 & ~8)
		b.ao = 0.75
		b.extrude(PackedVector2Array([Vector2(-0.35, PLAT + 3.0), Vector2(0.35, PLAT + 3.0), Vector2(0.0, PLAT + 2.2)]), -0.45, 0.45, true)   # culot
		b.ao = 0.95
		b.pinnacle(0.15, 0.0, 0.7, TOP, TOP + 1.6, TOP + 4.2)
		stone.append_xf(b, Transform3D(Basis(d, Vector3.UP, d.cross(Vector3.UP)), p))

# ----------------------------------------------------------------- tourelles d'escalier
func _turret(deg: float) -> void:
	var c := _pt(R + 0.2, deg, 0.0)
	var r := 1.86
	var y0 := PLAT + 2.4
	var y1 := 112.0
	stone.ao = 0.9
	for i in 8:   # colonnettes de la cage ajourée
		var a := TAU * (i + 0.5) / 8.0
		stone.prism(c.x + cos(a) * r, c.z + sin(a) * r, 0.13, 0.13, y0, y1, 5, 0.0, false)
	var y := y0
	while y < y1:   # bandeaux et arcatures trilobées tous les 5,5 m
		stone.ao = 0.85
		stone.prism(c.x, c.z, r + 0.12, r + 0.12, y, y + 0.35, 8, PI / 8.0, true)
		y += 5.5
	# hélice de l'escalier visible à travers la cage
	var n := int((y1 - y0) / 0.35)
	stone.ao = 0.7
	for i in n:
		var yy := y0 + i * 0.35
		var a := float(i) * 0.42
		stone.box(Vector3(c.x + cos(a) * (r - 0.22), yy, c.z + sin(a) * (r - 0.22)), Vector3(0.36, 0.12, 0.36), 63)
	# couronnement : balustrade, flèche à crochets, fleuron
	stone.ao = 0.9
	stone.prism(c.x, c.z, r + 0.25, r + 0.25, y1, y1 + 0.5, 8, PI / 8.0, true)
	stone.spire(c.x, c.z, r + 0.1, y1 + 0.5, y1 + 11.0, 8, PI / 8.0)
	for k in range(1, 6):
		var f := float(k) / 6.0
		var rr := (r + 0.1) * (1.0 - f) + 0.1
		for i in 8:
			var a := PI / 8.0 + TAU * i / 8.0
			stone.box(Vector3(c.x + cos(a) * rr, y1 + 0.5 + 10.5 * f, c.z + sin(a) * rr), Vector3(0.18, 0.3, 0.18), 63)
	stone.box(Vector3(c.x, y1 + 11.4, c.z), Vector3(0.2, 0.8, 0.2), 63)

# ----------------------------------------------------------------- pagode et colonnes de tourelles
func _pagoda() -> void:
	# baies aveugles de chaque étage (6 étages de 4 m), sur chaque pan
	for i in 6:
		var ya := TOP + 4.0 * i
		var yb := ya + 4.0
		for k in 8:
			if i == 0 and k == 0:
				continue   # porte de la pagode
			var deg := 45.0 * k
			var rm := rb((ya + yb) * 0.5) * cos(PI / 8.0)
			var d := _dir(deg)
			var w := 2.0 * rb((ya + yb) * 0.5) * sin(PI / 8.0)
			var b := GeoBuilder.new()
			var hw := w * 0.22
			b.ao = 0.85
			b.arch_ring(0.0, ya + 2.2, hw, hw * 1.4, 0.0, 0.12, 0.0, 0.06, 6)
			b.box(Vector3(0.03, ya + 1.25, -hw - 0.06), Vector3(0.06, 1.9, 0.12), 63)
			b.box(Vector3(0.03, ya + 1.25, hw + 0.06), Vector3(0.06, 1.9, 0.12), 63)
			var gl := GeoBuilder.new()
			var poly := PackedVector2Array([Vector2(-hw, ya + 0.3)])
			poly.append_array(GeoBuilder.pointed_arch(0.0, ya + 2.2, hw, hw * 1.4, 5))
			poly.append(Vector2(hw, ya + 0.3))
			gl.extrude(poly, 0.01, 0.02)
			# le pan est incliné (le fût se rétrécit) : cisaillement x += (y - ymid) * pente, la face colle au mur sur toute la hauteur de l'étage
			var ym := (ya + yb) * 0.5
			var sl := (rb(yb) - rb(ya)) / 4.0 * cos(PI / 8.0)
			var xf := Transform3D(Basis(d, Vector3.UP + d * sl, d.cross(Vector3.UP)), Vector3(C.x, 0.0, C.y) + d * (rm - sl * ym))
			stone.append_xf(b, xf)
			glass.append_xf(gl, xf)
	# huit colonnes de tourelles empilées : elles partent des clochetons du parapet de la terrasse (r 9,1 m, au-dessus de la tête des joueurs qui
	# marchent sur la terrasse) et montent vers la pointe en restant hors du couloir de la rampe (au-delà de rb + 1,7 m)
	for k in 8:
		var deg := 22.5 + 45.0 * k
		var y := TOP + 4.2
		var j := 0
		while y < TIP + 2.0:
			var r := maxf(lerpf(9.1, rb(TIP) + 1.8, clampf((y - TOP - 4.2) / (TIP - TOP - 4.2), 0.0, 1.0)), rb(minf(y + 2.2, TIP)) + 1.75)
			var p := _pt(r, deg, 0.0)
			var h := 2.2 - 0.04 * j
			stone.ao = 0.9
			stone.prism(p.x, p.z, 0.42, 0.36, y, y + h * 0.7, 6, 0.0, true)
			stone.ao = 0.6
			stone.box(Vector3(p.x, y + h * 0.38, p.z), Vector3(0.5, h * 0.4, 0.14), 63)
			stone.ao = 0.95
			stone.spire(p.x, p.z, 0.46, y + h * 0.7, y + h, 6, 0.0)
			y += h * 0.92
			j += 1

# ----------------------------------------------------------------- aiguille
func _needle() -> void:
	var c := _pt(0.0, 0.0, 0.0)
	# crochets sur les huit arêtes (au-dessus de la tête des joueurs du balcon : à partir de 130,5 m)
	for i in 8:
		var a := deg_to_rad(22.5 + 45.0 * i)
		var y := 130.5
		while y < NEEDLE - 1.5:
			var r := 1.7 * ((NEEDLE - 1.0 - y) / (NEEDLE - 1.0 - (TIP + 1.0))) + 0.1
			stone.ao = 0.9
			stone.box(Vector3(c.x + cos(a) * r, y, c.z + sin(a) * r), Vector3(0.2, 0.3, 0.2), 63)
			y += 1.1
	# couronne et lanterne
	stone.ao = 0.85
	stone.prism(c.x, c.z, 1.25, 1.2, 134.0, 134.5, 8, PI / 8.0, true)
	for i in 8:
		var a := PI / 8.0 + TAU * i / 8.0
		stone.spire(c.x + cos(a) * 1.15, c.z + sin(a) * 1.15, 0.16, 134.5, 135.6, 4, PI / 4.0)
	stone.prism(c.x, c.z, 0.62, 0.6, 138.2, 138.6, 8, PI / 8.0, true)
