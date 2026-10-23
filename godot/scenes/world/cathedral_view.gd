extends Node3D
## v0.24.2 : extérieur détaillé de la cathédrale Notre-Dame de Strasbourg, généré par code (aucun fichier cuit, reproductible, voir docs/GODOT_PORT.md).
## Façade ouest : une peau de pierre en avant du mur OSM (portails à voussures étagées, gâbles, rosace, vitraux, galeries de statues, contreforts à pinacles, cage de meneaux),
## posée en avant du plan du mur (s = -48 dans le repère de la nef). Les surfaces de collision de la peau viennent de Cathedral.facade_segments() (sim pure).
##
## Repère local de ce nœud : x vers l'extérieur de la façade (ouest), y vers le haut, z = -t (vers le nord) ; origine : milieu de la façade au pied du plan du mur.
## Les triangles et les matériaux (stone.gdshader, cath_glass.gdshader) sont construits avec GeoBuilder ; les statues sont des MultiMesh.

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
const STONE_SHADER := preload("res://shaders/stone.gdshader")
const GLASS_SHADER := preload("res://shaders/cath_glass.gdshader")
const STONE_A := preload("res://assets/pbr/wall_stone_big/a.png")
const STONE_M := preload("res://assets/pbr/wall_stone_big/m.png")

const WALL_S := -48.0           ## plan du mur ouest dans le repère de la nef
const SKIN := 2.6               ## m : épaisseur de la peau devant le mur (couvre les bosses du contour OSM)
const HALF_W := 26.5            ## demi-largeur de la façade
const TOP := 66.0               ## sommet de la peau (le haut des tours OSM est à 66-69 m)

## Portails (z du centre, demi-largeur extérieure, hauteur de naissance, hauteur de l'arc, nombre de ressauts, profondeur de fond) ; le central laisse passer la porte du jeu (5,4 m de large, 8,5 m de haut)
const PORTALS := [
	{"z": 0.0, "hw": 3.9, "spring": 8.8, "rise": 7.5, "steps": 3, "back": 0.0},
	{"z": -14.75, "hw": 2.6, "spring": 6.5, "rise": 5.2, "steps": 2, "back": 1.4},
	{"z": 14.75, "hw": 2.6, "spring": 6.5, "rise": 5.2, "steps": 2, "back": 1.4},
]
const STEP_D := 0.42                      ## largeur d'un ressaut de portail

var stone_mesh: MeshInstance3D
var glass_mesh: MeshInstance3D
var statues: MultiMeshInstance3D
var _stone := GeoBuilder.new()
var _glass := GeoBuilder.new()
var _statue_xf: Array[Transform3D] = []
var _stone_mat: ShaderMaterial
var _glass_mats: Array[ShaderMaterial] = []

## Transformation locale -> monde : origine au milieu de la façade, x = vers l'extérieur (-u), y = haut, z = -v.
static func frame() -> Transform3D:
	var o := Cathedral.P(WALL_S, 0.0)
	var u := Cathedral.P(1.0, 0.0) - Cathedral.P(0.0, 0.0)
	var bx := Vector3(-u.x, 0.0, -u.y)
	var by := Vector3.UP
	return Transform3D(Basis(bx, by, bx.cross(by)), Vector3(o.x, 0.0, o.y))

func build() -> void:
	name = "CathedraleExterieure"
	transform = frame()
	_build_skin()
	_build_portals()
	_build_piers()
	_build_courses()
	_build_rose()
	_build_windows()
	_build_galleries()
	_finish()
	if not OS.get_cmdline_user_args().has("--dbg-cath031"):
		_build_nave()
	add_to_group("sky_listener")
	on_sky_k(0.0)
	print("cathédrale : %d triangles de pierre, %d de verre, %d statues" % [_stone.triangle_count(), _glass.triangle_count(), _statue_xf.size()])

# ----------------------------------------------------------------- peau de façade
func _build_skin() -> void:
	# contour (z, y) : le rectangle moins les notches des trois portails, qui s'ouvrent par le bas
	var poly := PackedVector2Array()
	poly.append(Vector2(-HALF_W, 0.0))
	for p: Dictionary in PORTALS:   # du nord (z < 0 ici : on parcourt par z croissant)
		pass
	var sorted: Array = PORTALS.duplicate()
	sorted.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["z"]) < float(b["z"]))
	for p: Dictionary in sorted:
		var zc: float = p["z"]
		var hw: float = p["hw"]
		poly.append(Vector2(zc - hw, 0.0))
		poly.append(Vector2(zc - hw, float(p["spring"])))
		var arch := GeoBuilder.pointed_arch(zc, float(p["spring"]), hw, float(p["rise"]), 12)
		poly.append_array(arch)
		poly.append(Vector2(zc + hw, float(p["spring"])))
		poly.append(Vector2(zc + hw, 0.0))
	poly.append(Vector2(HALF_W, 0.0))
	poly.append(Vector2(HALF_W, TOP))
	poly.append(Vector2(-HALF_W, TOP))
	_stone.ao = 1.0
	_stone.extrude(poly, -0.2, SKIN)

func _build_portals() -> void:
	for p: Dictionary in PORTALS:
		var zc: float = p["z"]
		var hw0: float = p["hw"]
		var spring: float = p["spring"]
		var rise0: float = p["rise"]
		var steps: int = p["steps"]
		var back: float = p["back"]
		# ressauts : bande de jambage + voussure, chacun s'arrêtant plus en retrait de la face
		for k in range(1, steps + 1):
			var hw := hw0 - STEP_D * k
			var rise := rise0 - STEP_D * 1.2 * k
			var f := SKIN - 0.65 * k
			_stone.ao = 0.78 - 0.08 * k
			_stone.arch_ring(zc, spring, hw, rise, 0.0, STEP_D, 0.0 if back == 0.0 else back, f)
			for sd in [-1.0, 1.0]:
				_stone.box(Vector3((f + (0.0 if back == 0.0 else back)) * 0.5, spring * 0.5, zc + sd * (hw + STEP_D * 0.5)), Vector3(f - (0.0 if back == 0.0 else back), spring, STEP_D), 63 & ~8)
			# statues dans la voussure (sur la face avant du ressaut)
			var pts := GeoBuilder.pointed_arch(zc, spring, hw, rise, 10, STEP_D * 0.5)
			var n := pts.size()
			for i in range(1, n - 1, 2):
				var q := pts[i]
				var q1 := pts[min(n - 1, i + 1)]
				var q0 := pts[max(0, i - 1)]
				var tan := (q1 - q0).normalized()
				var ang := atan2(tan.y, tan.x)   # pente de l'arc dans le plan (z, y)
				var basis := Basis(Vector3.RIGHT, ang)   # le haut de la statue suit la normale de l'arc
				_add_statue(Vector3(f + 0.06, q.y, q.x), 0.62, basis, true)
		# fond de porte des portails latéraux : panneau sombre + tympan
		_stone.ao = 0.55
		if back > 0.0:
			var hwb := hw0 - STEP_D * steps
			_stone.arch_fill(zc, 0.0, hwb, rise0 - STEP_D * 1.2 * steps + spring, back - 0.05, back + 0.02, 12)
		else:
			# tympan du grand portail : panneau en retrait au-dessus de la porte (la porte du jeu s'arrête à 8,5 m)
			var hwt := hw0 - STEP_D * steps
			_stone.ao = 0.6
			_stone.arch_fill(zc, spring - 0.3, hwt, rise0 - STEP_D * 1.2 * steps, 0.15, 0.3, 12)
			# trois registres de statues dans le tympan
			for r in 3:
				var yy := spring + 0.8 + r * 1.9
				var w := hwt * (1.0 - float(r) * 0.28)
				for j in range(-3 + r, 4 - r):
					_add_statue(Vector3(0.45, yy, zc + float(j) * (w / 3.4)), 1.05 - r * 0.12, Basis.IDENTITY, false)
		# gâble : triangle pointu au-dessus de l'arc
		var gy := spring + rise0 + 0.4
		var gw := hw0 + 0.8
		var gh := gw * 2.4
		_stone.ao = 0.95
		_stone.extrude(PackedVector2Array([Vector2(zc - gw, gy - 0.6), Vector2(zc + gw, gy - 0.6), Vector2(zc, gy + gh)]), SKIN, SKIN + 0.5)
		_stone.ao = 0.62
		var inner := gw * 0.62
		_stone.extrude(PackedVector2Array([Vector2(zc - inner, gy), Vector2(zc + inner, gy), Vector2(zc, gy + gh * 0.58)]), SKIN + 0.5, SKIN + 0.62)
		# crochets le long des rampants
		_stone.ao = 0.95
		for sd in [-1.0, 1.0]:
			for k in range(1, 7):
				var f2 := float(k) / 7.0
				var cz: float = zc + sd * gw * (1.0 - f2)
				var cy := gy - 0.6 + (gh + 0.6) * f2
				_stone.box(Vector3(SKIN + 0.4, cy + 0.15, cz), Vector3(0.28, 0.5, 0.2), 63)
		# fleuron au sommet
		_stone.box(Vector3(SKIN + 0.25, gy + gh + 0.4, zc), Vector3(0.45, 1.0, 0.45), 63)

func _build_piers() -> void:
	for pr: Array in Cathedral.FACADE_PIERS:
		var z: float = -float(pr[0])
		var corner := absf(z) > 25.0
		var w0: float = float(pr[1]) - 0.3
		var f_out := Cathedral.FACADE_PIER_OUT
		var levels := [0.0, 18.0, 33.5, 47.5, 62.0]
		for i in range(levels.size() - 1):
			var w := w0 + 0.3 - 0.2 * i
			var d := f_out - 0.3 * i
			var y0: float = levels[i]
			var y1: float = levels[i + 1]
			_stone.ao = 0.95
			_stone.box(Vector3((SKIN + d) * 0.5, (y0 + y1) * 0.5, z), Vector3(d - SKIN, y1 - y0, w), 63 & ~2 & ~8)
			# glacis (talus) de chaque retrait
			_stone.ao = 1.0
			_stone.quad(Vector3(SKIN, y1, z - w * 0.5), Vector3(SKIN + d - 0.3, y1, z - w * 0.5), Vector3(SKIN + d - 0.3, y1 + 0.0, z + w * 0.5), Vector3(SKIN, y1, z + w * 0.5), Vector3.UP)
			# niche à statue dans le fût
			if i < 3 and not corner:
				_add_statue(Vector3(SKIN + d + 0.08, (y0 + y1) * 0.5 - 1.0, z), 2.2, Basis.IDENTITY, false)
		# pinacle : fût carré, puis flèche à quatre pans
		var wt := w0 - 0.2 * 3
		_stone.ao = 0.95
		_stone.box(Vector3(SKIN + (f_out - SKIN - 0.3) * 0.5, 64.0, z), Vector3(wt * 1.1, 4.0, wt * 1.1), 63)
		_stone.spire(SKIN + (f_out - SKIN - 0.3) * 0.5, z, wt * 0.62 * 1.1, 66.0, 71.0 if corner else 69.0, 4, PI / 4.0)
		# crochets du pinacle
		for k in 3:
			for a in 4:
				var ang := PI / 4.0 + a * PI * 0.5
				_stone.box(Vector3(SKIN + (f_out - SKIN - 0.3) * 0.5 + cos(ang) * 0.9, 66.6 + k * 0.9, z + sin(ang) * 0.9), Vector3(0.2, 0.4, 0.2), 63)

func _build_courses() -> void:
	# cordons moulurés d'étage sur toute la largeur
	for y in [18.0, 33.5, 47.5, 62.0]:
		_stone.ao = 0.9
		_stone.box(Vector3(SKIN + 0.28, y, 0.0), Vector3(0.56, 0.55, HALF_W * 2.0), 63)
		_stone.ao = 0.55
		_stone.box(Vector3(SKIN + 0.1, y - 0.5, 0.0), Vector3(0.2, 0.45, HALF_W * 2.0), 63)
	# balustrade ajourée au sommet (petits poteaux)
	_stone.ao = 0.85
	_stone.box(Vector3(SKIN + 0.35, 63.2, 0.0), Vector3(0.5, 0.3, HALF_W * 2.0), 63)
	for k in range(-26, 27):
		_stone.box(Vector3(SKIN + 0.35, 62.55, float(k)), Vector3(0.3, 1.0, 0.3), 63 & ~8)
	_stone.box(Vector3(SKIN + 0.35, 66.0 - 0.0, 0.0), Vector3(0.6, 0.35, HALF_W * 2.0), 63)

func _build_rose() -> void:
	var yc := 32.0
	var R := 7.5
	var f0 := SKIN - 0.1
	_stone.ao = 0.9
	_stone.annulus_x(0.0, yc, R - 1.1, R, f0, SKIN + 0.55)
	_stone.annulus_x(0.0, yc, R + 0.0, R + 0.55, f0, SKIN + 0.25)   # chambranle
	_stone.ao = 0.65
	_stone.annulus_x(0.0, yc, 3.0, 3.4, f0, SKIN + 0.4)
	_stone.annulus_x(0.0, yc, 0.0, 1.05, f0, SKIN + 0.4)
	# rayons
	for i in 16:
		var a := TAU * i / 16.0
		_stone.ao = 0.75
		_stone.bar_x(cos(a) * 1.0, yc + sin(a) * 1.0, cos(a) * (R - 1.1), yc + sin(a) * (R - 1.1), 0.34, f0, SKIN + 0.4)
	# lobes de la couronne : arcs en trèfle entre les rayons
	for i in 16:
		var a := TAU * (i + 0.5) / 16.0
		_stone.ao = 0.7
		_stone.annulus_x(cos(a) * 5.05, yc + sin(a) * 5.05, 0.55, 0.85, f0, SKIN + 0.35, 14)
	for i in 8:
		var a := TAU * (i + 0.5) / 8.0
		_stone.ao = 0.7
		_stone.annulus_x(cos(a) * 2.05, yc + sin(a) * 2.05, 0.3, 0.5, f0, SKIN + 0.35, 10)
	# verre : disque derrière la tracerie
	var gl := GeoBuilder.new()
	var n := 48
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		gl.tri(Vector3(SKIN + 0.12, yc, 0.0), Vector3(SKIN + 0.12, yc + sin(a0) * (R - 0.95), cos(a0) * (R - 0.95)), Vector3(SKIN + 0.12, yc + sin(a1) * (R - 0.95), cos(a1) * (R - 0.95)), Vector3.RIGHT)
	_glass.append(gl)
	_pending_rose = true

var _pending_rose := false

func _build_windows() -> void:
	# lancettes à tracerie dans les travées latérales (deux étages) et au-dessus de la rosace (trois lancettes) ; verre derrière un cadre en saillie
	var tiers := [{"y0": 23.0, "h": 6.5, "rise": 3.8}, {"y0": 36.0, "h": 5.5, "rise": 3.6}, {"y0": 50.0, "h": 7.0, "rise": 4.0}]
	for t: Dictionary in tiers:
		var zs: Array = [-14.75, 14.75]
		if float(t["y0"]) > 48.0:
			zs.append_array([-4.4, 0.0, 4.4])
		for z: float in zs:
			_lancet(z, float(t["y0"]), 1.25, float(t["h"]), float(t["rise"]))

func _lancet(z: float, y0: float, hw: float, h: float, rise: float) -> void:
	var f := SKIN + 0.02
	var spring := y0 + h
	# verre : rectangle + arc
	var gl := GeoBuilder.new()
	var arch := GeoBuilder.pointed_arch(z, spring, hw, rise, 10)
	var poly := PackedVector2Array([Vector2(z - hw, y0)])
	poly.append_array(arch)
	poly.append(Vector2(z + hw, y0))
	gl.extrude(poly, f, f + 0.04, true)
	_glass.append(gl)
	# encadrement en saillie
	_stone.ao = 0.6
	_stone.arch_ring(z, spring, hw, rise, 0.0, 0.3, f, f + 0.45)
	for sd in [-1.0, 1.0]:
		_stone.box(Vector3(f + 0.22, y0 + h * 0.5, z + sd * (hw + 0.15)), Vector3(0.45, h, 0.3), 63 & ~8)
	_stone.ao = 0.85
	_stone.box(Vector3(f + 0.3, y0 - 0.12, z), Vector3(0.6, 0.25, hw * 2.0 + 0.9), 63)    # appui
	# meneau central, traverses et oculus de tracerie
	_stone.ao = 0.7
	_stone.box(Vector3(f + 0.25, y0 + (h + rise * 0.6) * 0.5, z), Vector3(0.28, h + rise * 0.6, 0.18), 63)
	_stone.box(Vector3(f + 0.2, y0 + h * 0.55, z), Vector3(0.22, 0.14, hw * 2.0), 63)
	_stone.annulus_x(z, spring + rise * 0.42, 0.18, 0.36, f, f + 0.4, 10)

func _build_galleries() -> void:
	# galerie des apôtres (y 43-47) : colonnettes, arcatures et statues sur toute la largeur
	var y0 := 43.0
	var n := 27
	var step := (HALF_W * 2.0 - 1.4) / float(n - 1)
	for i in n:
		var z := -HALF_W + 0.7 + i * step
		_stone.ao = 0.8
		_stone.box(Vector3(SKIN + 0.3, y0 + 1.7, z), Vector3(0.3, 3.4, 0.3), 63)
		if i < n - 1:
			_stone.ao = 0.5
			_stone.arch_fill(z + step * 0.5, y0 + 3.0, step * 0.5 - 0.17, 0.8, SKIN + 0.04, SKIN + 0.16, 6)
			if absi(i - n / 2) > 3 or true:
				_add_statue(Vector3(SKIN + 0.42, y0 + 0.1, z + step * 0.5), 2.4, Basis.IDENTITY, false)
	# niches à statues au-dessus des portails latéraux (y 17-21)
	for sd in [-1.0, 1.0]:
		for k in range(-1, 2):
			var z: float = sd * 14.75 + k * 3.0
			_stone.ao = 0.45
			_stone.arch_fill(z, 18.6, 0.8, 1.6, SKIN + 0.04, SKIN + 0.18, 8)
			_stone.ao = 0.8
			_stone.box(Vector3(SKIN + 0.2, 18.5, z), Vector3(0.45, 0.25, 1.8), 63)
			_add_statue(Vector3(SKIN + 0.4, 18.7, z), 2.2, Basis.IDENTITY, false)
	# gargouilles sous la balustrade (têtes qui saillent)
	for k in range(-6, 7):
		var z := k * 4.0
		_stone.ao = 0.7
		_stone.box(Vector3(SKIN + 1.5, 61.4, z), Vector3(2.6, 0.55, 0.5), 63)
		_stone.box(Vector3(SKIN + 2.75, 61.5, z), Vector3(0.5, 0.7, 0.55), 63)

func _build_cage() -> void:
	# meneaux montants en avant de la peau (les « cordes de harpe » de la façade strasbourgeoise) dans les travées latérales
	for sd in [-1.0, 1.0]:
		for i in range(0, 11):
			var z: float = sd * (10.0 + i * 1.55)
			_stone.ao = 0.9
			_stone.box(Vector3(SKIN + 0.2, 40.0, z), Vector3(0.4, 44.0, 0.26), 63 & ~8)
	# lancettes aveugles entre les cordons : fond sombre pour la profondeur
	_stone.ao = 0.5
	for y in [24.5, 41.0]:
		for sd in [-1.0, 1.0]:
			_stone.box(Vector3(SKIN + 0.06, y, sd * 17.5), Vector3(0.1, 0.35, 15.0), 63)

# ----------------------------------------------------------------- statues
var _statue_mesh: ArrayMesh

func _statue_geometry() -> ArrayMesh:
	# silhouette de statue drapée (haute de 1 unité, large 0.3) : socle, corps conique, tête, bras : ~ 90 triangles
	var g := GeoBuilder.new()
	g.ao = 0.9
	g.prism(0.0, 0.0, 0.17, 0.12, 0.0, 0.55, 6, 0.0)
	g.prism(0.0, 0.0, 0.12, 0.08, 0.55, 0.82, 6, 0.0)
	g.prism(0.0, 0.0, 0.065, 0.045, 0.82, 0.95, 6, 0.0)   # cou et tête
	g.prism(0.0, 0.0, 0.07, 0.07, 0.86, 0.98, 6, 0.0)
	g.box(Vector3(0.0, 0.7, 0.14), Vector3(0.08, 0.28, 0.07))   # avant-bras (livre / sceptre)
	g.ao = 0.55
	g.prism(0.0, 0.0, 0.22, 0.22, -0.04, 0.0, 6, 0.0)           # socle
	return g.build()

func _add_statue(p: Vector3, height: float, basis: Basis, along_arch: bool) -> void:
	var b := basis.scaled(Vector3(height, height, height))
	_statue_xf.append(Transform3D(b, p))

# ----------------------------------------------------------------- matériaux et mise en place
func _finish() -> void:
	_stone_mat = ShaderMaterial.new()
	_stone_mat.shader = STONE_SHADER
	_stone_mat.set_shader_parameter("stone_a", STONE_A)
	_stone_mat.set_shader_parameter("stone_m", STONE_M)
	var fx := global_transform.basis.x
	_stone_mat.set_shader_parameter("flood_dir", fx)
	stone_mesh = MeshInstance3D.new()
	stone_mesh.mesh = _stone.build()
	stone_mesh.material_override = _stone_mat
	stone_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	stone_mesh.visibility_range_end = 400.0
	add_child(stone_mesh)
	# verre : une instance pour la rosace (motif radial), une pour les lancettes
	glass_mesh = MeshInstance3D.new()
	glass_mesh.mesh = _glass.build()
	var gm := ShaderMaterial.new()
	gm.shader = GLASS_SHADER
	glass_mesh.material_override = gm
	glass_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	glass_mesh.visibility_range_end = 300.0
	add_child(glass_mesh)
	_glass_mats.append(gm)
	# statues
	_statue_mesh = _statue_geometry()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _statue_mesh
	mm.instance_count = _statue_xf.size()
	for i in _statue_xf.size():
		mm.set_instance_transform(i, _statue_xf[i])
	statues = MultiMeshInstance3D.new()
	statues.multimesh = mm
	statues.material_override = _stone_mat
	statues.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	statues.visibility_range_end = 160.0
	add_child(statues)

## v0.32.0 : nef, bas-côtés, arcs-boutants, flancs du massif (scenes/world/cathedral_nave.gd), dans le repère de la nef (nœuds `top_level`).
const CathedralNave := preload("res://scenes/world/cathedral_nave.gd")
const ROOF_SHADER := preload("res://shaders/cath_roof.gdshader")
const SLATE_A := preload("res://assets/pbr/roof_slate/a.png")
const SLATE_M := preload("res://assets/pbr/roof_slate/m.png")
var roof_mat: ShaderMaterial
var nave_triangles := 0

static func make_roof_mat() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = ROOF_SHADER
	m.set_shader_parameter("slate_a", SLATE_A)
	m.set_shader_parameter("slate_m", SLATE_M)
	return m

func _add_mesh(b: RefCounted, mat: Material, xf: Transform3D, shadows: bool, vis: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = b.build()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = vis
	mi.top_level = true
	add_child(mi)
	mi.global_transform = xf
	return mi

## Pierre de l'intérieur : même grès, sans lavis des projecteurs, plus claire (calcaire des voûtes) ; reçoit les ombres mais n'en projette pas (coût).
func _interior_mat() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = STONE_SHADER
	m.set_shader_parameter("stone_a", STONE_A)
	m.set_shader_parameter("stone_m", STONE_M)
	m.set_shader_parameter("tint", Color(0.70, 0.56, 0.47))
	m.set_shader_parameter("flood_energy", 0.0)
	m.set_shader_parameter("scale", 2.2)
	return m

func _build_nave() -> void:
	var nv := CathedralNave.new()
	nv.build()
	var xf := CathedralNave.frame()
	roof_mat = make_roof_mat()
	var gm := ShaderMaterial.new()
	gm.shader = GLASS_SHADER
	gm.set_shader_parameter("world_map", 1.0)
	gm.set_shader_parameter("cell", 0.42)
	_glass_mats.append(gm)
	_add_mesh(nv.stone, _stone_mat, xf, true, 420.0)
	_add_mesh(nv.glass, gm, xf, false, 300.0)
	_add_mesh(nv.roof, roof_mat, xf, true, 420.0)
	nave_triangles = nv.stone.triangle_count() + nv.glass.triangle_count() + nv.roof.triangle_count()
	var ea := preload("res://scenes/world/cathedral_east.gd").new()
	ea.build()
	_add_mesh(ea.stone, _stone_mat, xf, true, 420.0)
	_add_mesh(ea.glass, gm, xf, false, 300.0)
	_add_mesh(ea.roof, roof_mat, xf, true, 420.0)
	nave_triangles += ea.stone.triangle_count() + ea.glass.triangle_count() + ea.roof.triangle_count()
	var tw := preload("res://scenes/world/cathedral_tower.gd").new()
	tw.build()
	_add_mesh(tw.stone, _stone_mat, xf, true, 900.0)
	_add_mesh(tw.glass, gm, xf, false, 400.0)
	nave_triangles += tw.stone.triangle_count() + tw.glass.triangle_count()
	var it := preload("res://scenes/world/cathedral_interior.gd").new()   # v0.32.1 : voûtes, piliers fasciculés, arcades
	it.build()
	_add_mesh(it.stone, _interior_mat(), xf, false, 140.0)
	var fm := ShaderMaterial.new()
	fm.shader = preload("res://shaders/cath_floor.gdshader")
	fm.set_shader_parameter("stone_a", STONE_A)
	fm.set_shader_parameter("stone_m", STONE_M)
	var o := Cathedral.P(0.0, 0.0)
	var u := Cathedral.P(1.0, 0.0) - o
	fm.set_shader_parameter("origin", Vector3(o.x, 0.0, o.y))
	fm.set_shader_parameter("axis_u", Vector3(u.x, 0.0, u.y))
	_add_mesh(it.floor, fm, xf, false, 140.0)
	nave_triangles += it.stone.triangle_count()
	print("cathédrale (nef, v0.32.0) : %d triangles" % nave_triangles)

## Nuit / jour : projecteurs allumés la nuit, vitraux éclairés de l'intérieur (graphics_view.gd : groupe « sky_listener »).
func on_sky_k(k: float) -> void:
	var night := clampf(1.0 - k * 1.6, 0.0, 1.0)
	_stone_mat.set_shader_parameter("night", night)
	for m in _glass_mats:
		m.set_shader_parameter("night", maxf(night, 0.06))

var _gv: Node
var _last_k := -1.0

## Le ciel est réglé par le graphics_view, qui peut être prêt après la carte : on relit sky_k (un flottant) à chaque image.
func _process(_dt: float) -> void:
	if _gv == null:
		_gv = get_tree().get_first_node_in_group("graphics_view")
		return
	var k: float = _gv.sky_k
	if not is_equal_approx(k, _last_k):
		_last_k = k
		on_sky_k(k)
