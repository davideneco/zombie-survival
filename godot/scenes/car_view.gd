class_name CarView
extends Node3D
## v0.36.0 : voiture conduisible (CarSim), modélisée par code : citadine 5 portes française générique (aucune marque, aucun logo). Repère local : origine au
## sol au milieu de la voiture, avant vers -Z, droite vers +X (comme VehicleView et CarSim.to_world).
##   - caisse : sections lissées le long de la voiture (normales lissées) : bouclier, capot bombé, pare-brise incliné, pavillon, lunette de hayon,
##     épaules, ligne de caisse montante, resserrement du vitrage, passages de roue découpés dans le bas de caisse, coques des passages de roue ;
##   - vitrage teinté transparent (shaders/car_glass.gdshader) : on voit l'habitacle de dehors et la rue de dedans ;
##   - habitacle : planche de bord, combiné d'instruments et écran éclairés, volant à trois branches qui tourne avec la direction, colonne, console,
##     levier de vitesses, frein à main, sièges baquets avant et banquette arrière avec appuie-tête, rétroviseur intérieur, pare-soleil,
##     contre-portes (faces intérieures de la caisse) ;
##   - dehors : calandre, entrée d'air, boucliers, phares (verre, projecteur, feux de jour), antibrouillards, feux arrière, feux stop, troisième feu
##     stop, feux de recul, répétiteurs orange, rétroviseurs, poignées, joints de portes, essuie-glaces, antenne requin, plaques d'immatriculation
##     fictives, sortie d'échappement ; jantes alliage à cinq branches, disques et étriers de frein, pneus ;
##   - roues qui tournent, roues avant qui braquent, caisse qui plonge au freinage et prend du roulis en virage ;
##   - lumières : deux projecteurs (SpotLight3D) quand les phares sont allumés, lueur rouge à l'arrière, feux stop et de recul, warnings quand la
##     voiture brûle ou presque ;
##   - peinture vernie métallisée (shaders/drive_car.gdshader), saleté de la route en bas de caisse, ternie avec les dégâts ; fumée puis flammes
##     sous le capot quand les PV baissent ; épave carbonisée (vitres brisées) ;
##   - passagers autres que le joueur (places occupées par un identifiant de survivant : captures) assis en CharacterModel.

static var SHADER: Shader:   # chargés au premier usage (un preload les chargerait avec les vues, sur les fils du chargeur)
	get: return load("res://shaders/drive_car.gdshader")
static var GLASS: Shader:
	get: return load("res://shaders/car_glass.gdshader")
const PAINT_COLORS := {"bleu": Color(0.05, 0.12, 0.27), "rouge": Color(0.40, 0.035, 0.03), "gris": Color(0.30, 0.31, 0.32), "vert": Color(0.09, 0.17, 0.13)}
const PLATES := ["FH-284-KT", "GB-517-RZ", "EM-903-LC", "DV-146-PA"]

const HL := 2.06          ## demi-longueur
const HW := 0.89          ## demi-largeur
const AXLE := 1.28        ## essieux à +- AXLE
const WR := 0.31          ## rayon des roues
const ARCH := 0.40        ## rayon des passages de roue
const TRACK := 0.75       ## demi-voie (milieu des roues)
const ZH := -1.0          ## pied du pare-brise
const ZR0 := -0.24        ## haut du pare-brise
const ZR1 := 1.16         ## fin du pavillon
const ZG := 1.82          ## bas de la lunette
const HEAD_ENERGY := 26.0 ## phares : le faisceau rase la chaussée (incidence de quelques degrés), il faut beaucoup d'énergie pour une flaque visible
const N_ST := 96          ## sections le long de la voiture

var sim: CarSim
var _body: Node3D
var _mat: ShaderMaterial
var _glass_mat: ShaderMaterial
var _wheels: Array[Node3D] = []        ## nœuds qui tournent (axe x)
var _spin_sign: Array[float] = []      ## sens de rotation (roues gauches retournées de 180°)
var _y_prev := 0.0                     ## v0.37.0 : hauteur du relief (banc d'essai)
var _y_cur := 0.0
var _knuckles: Array[Node3D] = []      ## pivots des roues avant (braquage)
var _steering: Node3D
var _spots: Array[SpotLight3D] = []
var _rear_glow: OmniLight3D
var _rev_glow: OmniLight3D
var _lamp_mats := {}                   ## nom -> StandardMaterial3D (phares, feux, stop, recul, clignotants, jour, tableau de bord)
var _tri := 0
var _smoke: CPUParticles3D
var _fire: CPUParticles3D
var _prev := Vector3.ZERO
var _cur := Vector3.ZERO
var _wreck_look := false
var _blink_t := 0.0
var _npc: Dictionary = {}              ## place -> CharacterModel (passagers autres que le joueur)

# ------------------------------------------------------------------ constructeur de maillage (sommets, normales, couleur = partie + occlusion)
class MB:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var part := 0
	var ao := 1.0

	func col() -> Color:
		return Color((float(part) + 0.25) / 16.0, ao, 0.0, 1.0)

	## Triangle avec normales par sommet ; l'ordre est corrigé pour que la face avant regarde du côté des normales (Godot : sens horaire).
	func tri(a: Vector3, na: Vector3, b: Vector3, nb: Vector3, cc: Vector3, nc: Vector3) -> void:
		var fn := (b - a).cross(cc - a)
		if fn.length_squared() < 1e-14:
			return
		if fn.dot(na + nb + nc) > 0.0:
			var t := b
			b = cc
			cc = t
			var tn := nb
			nb = nc
			nc = tn
		v.append_array([a, b, cc])
		n.append_array([na, nb, nc])
		var k := col()
		c.append_array([k, k, k])

	func flat(a: Vector3, b: Vector3, cc: Vector3, hint: Vector3) -> void:
		var fn := (b - a).cross(cc - a)
		if fn.length_squared() < 1e-14:
			return
		fn = fn.normalized()
		if fn.dot(hint) < 0.0:
			fn = -fn
		tri(a, fn, b, fn, cc, fn)

	func quad(a: Vector3, b: Vector3, cc: Vector3, d: Vector3, hint: Vector3) -> void:
		flat(a, b, cc, hint)
		flat(a, cc, d, hint)

	## Boîte orientée (transformée xf appliquée à la boîte centrée de taille s).
	func box(xf: Transform3D, s: Vector3) -> void:
		var h := s * 0.5
		var P := func(x: float, y: float, z: float) -> Vector3: return xf * Vector3(x * h.x, y * h.y, z * h.z)
		var b := xf.basis
		for f in [[Vector3.RIGHT, [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [Vector3.LEFT, [-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]],
				[Vector3.UP, [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [Vector3.DOWN, [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
				[Vector3.BACK, [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [Vector3.FORWARD, [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]]:
			var q: Array = []
			for k in range(1, 5):
				q.append(P.call(float(f[k][0]), float(f[k][1]), float(f[k][2])))
			quad(q[0], q[1], q[2], q[3], (b * (f[0] as Vector3)).normalized())

	func boxc(center: Vector3, s: Vector3, rot := Vector3.ZERO) -> void:
		box(Transform3D(Basis.from_euler(rot), center), s)

	## Cylindre d'axe x (de x0 à x1), centre (y, z), rayon r, n côtés ; caps : faces des bouts.
	func cyl_x(x0: float, x1: float, y: float, z: float, r: float, nseg: int, caps := true) -> void:
		for i in nseg:
			var a0 := TAU * i / nseg
			var a1 := TAU * (i + 1) / nseg
			var n0 := Vector3(0, cos(a0), sin(a0))
			var n1 := Vector3(0, cos(a1), sin(a1))
			var p0 := Vector3(0, y, z) + n0 * r
			var p1 := Vector3(0, y, z) + n1 * r
			tri(Vector3(x0, p0.y, p0.z), n0, Vector3(x1, p0.y, p0.z), n0, Vector3(x1, p1.y, p1.z), n1)
			tri(Vector3(x0, p0.y, p0.z), n0, Vector3(x1, p1.y, p1.z), n1, Vector3(x0, p1.y, p1.z), n1)
			if caps:
				flat(Vector3(x1, y, z), Vector3(x1, p0.y, p0.z), Vector3(x1, p1.y, p1.z), Vector3.RIGHT if x1 > x0 else Vector3.LEFT)
				flat(Vector3(x0, y, z), Vector3(x0, p0.y, p0.z), Vector3(x0, p1.y, p1.z), Vector3.LEFT if x1 > x0 else Vector3.RIGHT)

	## Tube entre deux points (rayon r, n côtés).
	func tube(a: Vector3, b: Vector3, r: float, nseg := 8) -> void:
		var d := (b - a).normalized()
		var u := d.cross(Vector3.UP)
		if u.length() < 0.1:
			u = d.cross(Vector3.RIGHT)
		u = u.normalized()
		var w := d.cross(u).normalized()
		for i in nseg:
			var a0 := TAU * i / nseg
			var a1 := TAU * (i + 1) / nseg
			var n0 := u * cos(a0) + w * sin(a0)
			var n1 := u * cos(a1) + w * sin(a1)
			tri(a + n0 * r, n0, b + n0 * r, n0, b + n1 * r, n1)
			tri(a + n0 * r, n0, b + n1 * r, n1, a + n1 * r, n1)

	## Anneau (tore) d'axe y, rayon R, section r.
	func torus_y(center: Vector3, R: float, r: float, nseg: int, nring: int) -> void:
		for i in nseg:
			for j in nring:
				var pts: Array = []
				var nrm: Array = []
				for e in [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]:
					var a := TAU * float(e[0]) / nseg
					var b := TAU * float(e[1]) / nring
					var dirv := Vector3(cos(a), 0, sin(a))
					var nn := dirv * cos(b) + Vector3.UP * sin(b)
					pts.append(center + dirv * R + nn * r)
					nrm.append(nn)
				tri(pts[0], nrm[0], pts[1], nrm[1], pts[2], nrm[2])
				tri(pts[0], nrm[0], pts[2], nrm[2], pts[3], nrm[3])

	func append_xf(o: MB, xf: Transform3D) -> void:
		var nb := xf.basis.inverse().transposed()
		for i in o.v.size():
			v.append(xf * o.v[i])
			n.append((nb * o.n[i]).normalized())
		c.append_array(o.c)

	func mesh() -> ArrayMesh:
		var m := ArrayMesh.new()
		if v.is_empty():
			return m
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_NORMAL] = n
		arr[Mesh.ARRAY_COLOR] = c
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		return m

# ------------------------------------------------------------------ profils de la caisse
static func top_y(z: float) -> float:
	if z < ZH:
		var t := (z + HL) / (ZH + HL)
		return 0.70 + 0.20 * (1.0 - pow(1.0 - t, 2.2))
	if z < ZR0:
		var t2 := (z - ZH) / (ZR0 - ZH)
		return 0.90 + 0.535 * (1.0 - pow(1.0 - t2, 1.3))
	if z < ZR1:
		var t3 := (z - ZR0) / (ZR1 - ZR0)
		return 1.435 + 0.012 * sin(PI * t3) - 0.02 * t3
	if z < ZG:
		var t4 := (z - ZR1) / (ZG - ZR1)
		return 1.415 - 0.37 * pow(t4, 1.12)
	var t5 := (z - ZG) / (HL - ZG)
	return 1.045 - 0.06 * t5 * t5

static func belt_y(z: float) -> float:
	return minf(0.9 + 0.08 * clampf((z - ZH) / (1.4 - ZH), 0.0, 1.0), top_y(z) - 0.012)

const NOSE := 1.48        ## les bouts s'arrondissent en plan (superellipse) au-delà de |z| = NOSE

static func half_w(z: float) -> float:
	var e := clampf((absf(z) - NOSE) / (HL - NOSE), 0.0, 1.0)
	return HW * pow(maxf(0.0, 1.0 - pow(e, 3.2)), 1.0 / 3.2)

## Bout avant (front) ou arrière de la caisse à l'abscisse latérale x (plan) : z de la surface du flanc.
static func nose_z(x: float, front: bool) -> float:
	var r := clampf(absf(x) / HW, 0.0, 0.9999)
	var e := pow(1.0 - pow(r, 3.2), 1.0 / 3.2)
	var z := NOSE + e * (HL - NOSE)
	return -z if front else z

## Bande posée sur le bout avant ou arrière (suit l'arrondi), de x0 à x1 (x0 < x1), de y0 à y1, décalée de off vers l'extérieur.
static func nose_strip(m: MB, front: bool, x0: float, x1: float, y0: float, y1: float, off: float, n := 12) -> void:
	for i in n:
		var xa := lerpf(x0, x1, float(i) / n)
		var xb := lerpf(x0, x1, float(i + 1) / n)
		var za := nose_z(xa, front)
		var zb := nose_z(xb, front)
		var na := _nose_n(xa, front)
		var nb := _nose_n(xb, front)
		var a := Vector3(xa, y0, za) + na * off
		var b := Vector3(xb, y0, zb) + nb * off
		var c := Vector3(xb, y1, zb) + nb * off
		var d := Vector3(xa, y1, za) + na * off
		m.tri(a, na, b, nb, c, nb)
		m.tri(a, na, c, nb, d, na)

static func _nose_n(x: float, front: bool) -> Vector3:
	var h := 0.004
	var z0 := nose_z(x - h, front)
	var z1 := nose_z(x + h, front)
	var t := Vector3(2.0 * h, 0.0, z1 - z0).normalized()
	var nn := Vector3(-t.z, 0.0, t.x)
	if nn.z * (-1.0 if front else 1.0) < 0.0:
		nn = -nn
	return nn

## Bas de caisse : 0,3 m, relevé en arc au-dessus des roues, un peu relevé aux boucliers.
static func sill_y(z: float) -> float:
	var y := 0.30 + 0.05 * smoothstep(1.8, HL, absf(z))
	for ax: float in [-AXLE, AXLE]:
		var d := absf(z - ax)
		if d < ARCH:
			y = maxf(y, WR + sqrt(ARCH * ARCH - d * d))
	return y

static func roof_w(z: float) -> float:
	if z < ZR0:
		return lerpf(0.8, 0.69, clampf((z - ZH) / (ZR0 - ZH), 0.0, 1.0))
	if z < ZR1:
		return 0.69
	return lerpf(0.69, 0.75, clampf((z - ZR1) / (ZG - ZR1), 0.0, 1.0))

## Section (moitié droite, x >= 0) à l'abscisse z : 15 points du dessous au milieu du toit. gh : vitrage (1 habitacle, 0 capot / hayon).
static func section(z: float) -> PackedVector2Array:
	var w := half_w(z)
	var s := sill_y(z)
	var top := top_y(z)
	var belt := belt_y(z)
	var gh := smoothstep(ZH - 0.04, ZH + 0.04, z) * (1.0 - smoothstep(ZG - 0.04, ZG + 0.04, z))
	var p := PackedVector2Array()
	p.append(Vector2(0.0, 0.25))
	p.append(Vector2(0.52, 0.25))
	p.append(Vector2(0.52, s))
	p.append(Vector2(w * 0.93, s))
	p.append(Vector2(w * 0.99, s + 0.05))
	var low := s + 0.12
	p.append(Vector2(w, low))
	# flanc (cabine) ou capot / hayon
	var cab: Array = []
	var bt := belt
	cab.append(Vector2(w, lerpf(low, bt - 0.12, 0.5)))
	cab.append(Vector2(w * 0.996, bt - 0.12))
	cab.append(Vector2(w * 0.978, bt - 0.03))
	cab.append(Vector2(w * 0.958, bt))
	var rw := minf(roof_w(z), w * 0.94)
	var gtop := maxf(bt, top - 0.06)
	cab.append(Vector2(lerpf(w * 0.958, rw, 0.55), lerpf(bt, gtop, 0.52)))
	cab.append(Vector2(rw, gtop))
	cab.append(Vector2(rw * 0.94, top - 0.012))
	cab.append(Vector2(rw * 0.55, top))
	cab.append(Vector2(0.0, top + 0.004))
	var hood: Array = []
	hood.append(Vector2(w, lerpf(low, top - 0.16, 0.5)))
	hood.append(Vector2(w * 0.997, top - 0.16))
	hood.append(Vector2(w * 0.985, top - 0.075))
	hood.append(Vector2(w * 0.955, top - 0.035))
	hood.append(Vector2(w * 0.88, top - 0.012))
	hood.append(Vector2(w * 0.74, top - 0.004))
	hood.append(Vector2(w * 0.55, top))
	hood.append(Vector2(w * 0.28, top + 0.007))
	hood.append(Vector2(0.0, top + 0.011))
	for i in cab.size():
		var a: Vector2 = hood[i]
		var b: Vector2 = cab[i]
		p.append(a.lerp(b, gh))
	return p

## Partie (matériau) du quadrilatère k (entre les points k et k + 1) d'une section en z ; -1 : vitrage.
static func part_of(k: int, z: float) -> int:
	if k == 0:
		return 1
	if k == 1:
		return 7
	if k == 2:
		return 7 if sill_y(z) > 0.36 else 1
	if k == 3:
		return 1
	var gh := z > ZH + 0.03 and z < ZG - 0.03
	if gh and (k == 9 or k == 10):   # vitres latérales (custode comprise), montant B noir, montant A et C peints
		if z > 0.31 and z < 0.43:
			return 1
		if z > -0.74 and z < 1.5:
			return -1
		return 0
	if gh and k >= 12:
		if (z > ZH + 0.03 and z < ZR0 - 0.03) or (z > ZR1 + 0.04 and z < ZG - 0.04):
			return -1   # pare-brise, lunette
	if gh and k == 11 and ((z > ZH + 0.05 and z < ZR0 - 0.06) or (z > ZR1 + 0.06 and z < ZG - 0.06)):
		return 13   # joint noir autour du pare-brise et de la lunette
	return 0

# ------------------------------------------------------------------ construction
func setup(s: CarSim) -> void:
	sim = s
	name = "Voiture%d" % s.id
	_mat = ShaderMaterial.new()
	_mat.shader = SHADER
	_mat.set_shader_parameter("paint", PAINT_COLORS[CarSim.PAINTS[s.paint % CarSim.PAINTS.size()]])
	_mat.set_shader_parameter("metallic_paint", 0.15 if CarSim.PAINTS[s.paint % CarSim.PAINTS.size()] == "rouge" else 0.45)
	_mat.set_shader_parameter("dirt", 0.22 + 0.08 * (s.id % 3))
	_mat.set_shader_parameter("noise_tex", ShopModels.noise())
	_glass_mat = ShaderMaterial.new()
	_glass_mat.shader = GLASS
	_glass_mat.set_shader_parameter("noise_tex", ShopModels.noise())
	_glass_mat.render_priority = 1
	_body = Node3D.new()
	_body.name = "Caisse"
	add_child(_body)
	_build_body()
	_build_cabin()
	_build_details()
	_build_lamps()
	_build_wheels()
	_build_lights()
	_make_fx()
	remember()
	_cur = _prev
	apply(1.0)

func _add_mesh(parent: Node3D, mb: MB, mat: Material, nm: String, shadows := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = nm
	mi.mesh = mb.mesh()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = 260.0
	parent.add_child(mi)
	_tri += mb.v.size() / 3
	return mi

func _build_body() -> void:
	var paint := MB.new()
	var glass := MB.new()
	var rings: Array = []
	var zs: Array = []
	for i in range(N_ST + 1):
		var t := float(i) / N_ST
		zs.append(-HL + 2.0 * HL * t)
	for z: float in zs:
		var sec := section(z)
		var pts: Array = []
		for q in sec:
			pts.append(Vector3(q.x, q.y, z))
		rings.append(pts)
	var K: int = (rings[0] as Array).size()
	# normales lissées : différences centrées le long de la voiture et le long de la section
	var norms: Array = []
	for i in rings.size():
		var nr: Array = []
		for k in K:
			var pa: Vector3 = rings[maxi(0, i - 1)][k]
			var pb: Vector3 = rings[mini(rings.size() - 1, i + 1)][k]
			var qa: Vector3 = rings[i][maxi(0, k - 1)]
			var qb: Vector3 = rings[i][mini(K - 1, k + 1)]
			var tz := pb - pa
			var ts := qb - qa
			var nn := ts.cross(tz)
			if nn.length_squared() < 1e-12:
				nn = Vector3(1, 0, 0)
			nn = nn.normalized()
			var p: Vector3 = rings[i][k]
			var out := Vector3(p.x, p.y - 0.75, 0.0)
			if nn.dot(out) < 0.0:
				nn = -nn
			nr.append(nn)
		norms.append(nr)
	for i in range(rings.size() - 1):
		var zm := (float(zs[i]) + float(zs[i + 1])) * 0.5
		for k in range(K - 1):
			var pt := part_of(k, zm)
			var mb := glass if pt < 0 else paint
			paint.part = maxi(pt, 0)
			paint.ao = 0.55 if k <= 3 else 1.0
			for sd: float in [-1.0, 1.0]:
				var a := _mx(rings[i][k], sd)
				var b := _mx(rings[i + 1][k], sd)
				var c := _mx(rings[i + 1][k + 1], sd)
				var d := _mx(rings[i][k + 1], sd)
				var na := _mx(norms[i][k], sd)
				var nb := _mx(norms[i + 1][k], sd)
				var nc := _mx(norms[i + 1][k + 1], sd)
				var nd := _mx(norms[i][k + 1], sd)
				if k <= 2:   # dessous et coques : normales plates
					mb.quad(a, b, c, d, Vector3(0, -1, 0) if k == 0 else Vector3(-sd, 0, 0))
				else:
					mb.tri(a, na, b, nb, c, nc)
					mb.tri(a, na, c, nc, d, nd)
	# bouts (avant, arrière) : éventail plat, peint
	paint.part = 0
	for e: float in [0, rings.size() - 1]:
		var r: Array = rings[e]
		var hint := Vector3(0, 0, -1) if e == 0 else Vector3(0, 0, 1)
		var cz: float = (r[0] as Vector3).z
		var cy := ((r[0] as Vector3).y + (r[K - 1] as Vector3).y) * 0.5
		for k in range(K - 1):
			paint.part = 1 if k <= 3 else 0
			for sd: float in [-1.0, 1.0]:
				paint.flat(Vector3(0, cy, cz), _mx(r[k], sd), _mx(r[k + 1], sd), hint)
	# coques des passages de roue (demi-cylindres sombres au-dessus des roues)
	paint.part = 7
	paint.ao = 0.3
	for ax: float in [-AXLE, AXLE]:
		for sd: float in [-1.0, 1.0]:
			var n := 14
			for j in n:
				var a0 := PI * j / n
				var a1 := PI * (j + 1) / n
				var p0 := Vector3(0, WR + sin(a0) * ARCH, ax + cos(a0) * ARCH)
				var p1 := Vector3(0, WR + sin(a1) * ARCH, ax + cos(a1) * ARCH)
				var x0 := 0.52 * sd
				var x1 := (HW - 0.01) * sd
				paint.quad(Vector3(x0, p0.y, p0.z), Vector3(x1, p0.y, p0.z), Vector3(x1, p1.y, p1.z), Vector3(x0, p1.y, p1.z), Vector3(0, WR - p0.y, ax - p0.z))
	_add_mesh(_body, paint, _mat, "Carrosserie")
	var gm := _add_mesh(_body, glass, _glass_mat, "Vitres", false)
	gm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

static func _mx(p: Vector3, sd: float) -> Vector3:
	return Vector3(p.x * sd, p.y, p.z)

## x de la surface de la caisse à (z, y) (flanc) : pour poser les détails à fleur.
static func side_x(z: float, y: float) -> float:
	var sec := section(z)
	for k in range(3, sec.size() - 1):
		var a := sec[k]
		var b := sec[k + 1]
		if (y >= a.y and y <= b.y) or (y <= a.y and y >= b.y):
			var t := 0.0 if absf(b.y - a.y) < 1e-6 else (y - a.y) / (b.y - a.y)
			return lerpf(a.x, b.x, t)
	return half_w(z)

func _build_cabin() -> void:
	var m := MB.new()
	# plancher (moquette)
	m.part = 5
	m.boxc(Vector3(0, 0.29, 0.25), Vector3(1.5, 0.04, 2.5))
	# tablier et planche de bord (section extrudée le long de x)
	var prof := [Vector2(-1.04, 0.52), Vector2(-1.04, 0.84), Vector2(-0.86, 0.9), Vector2(-0.68, 0.885), Vector2(-0.6, 0.83), Vector2(-0.62, 0.7), Vector2(-0.8, 0.58)]
	for i in prof.size():
		var a: Vector2 = prof[i]
		var b: Vector2 = prof[(i + 1) % prof.size()]
		m.part = 6 if a.y > 0.85 and b.y > 0.85 else 5
		var nrm := Vector3(0, b.x - a.x, -(b.y - a.y)).normalized()
		var mid := Vector3(0, (a.y + b.y) * 0.5, (a.x + b.x) * 0.5)
		var ctr := Vector3(0, 0.75, -0.82)
		if nrm.dot(mid - ctr) < 0.0:
			nrm = -nrm
		m.quad(Vector3(-0.8, a.y, a.x), Vector3(0.8, a.y, a.x), Vector3(0.8, b.y, b.x), Vector3(-0.8, b.y, b.x), nrm)
	m.part = 6
	for sd: float in [-1.0, 1.0]:
		m.boxc(Vector3(0.8 * sd, 0.73, -0.82), Vector3(0.02, 0.4, 0.42))
	# combiné d'instruments (casquette) et écran central
	m.part = 6
	m.boxc(Vector3(-0.37, 0.965, -0.7), Vector3(0.4, 0.06, 0.16), Vector3(-0.15, 0, 0))
	m.part = 14
	m.boxc(Vector3(-0.37, 0.905, -0.625), Vector3(0.34, 0.1, 0.01), Vector3(-0.35, 0, 0))
	m.boxc(Vector3(0.0, 0.88, -0.66), Vector3(0.24, 0.15, 0.015), Vector3(-0.3, 0, 0))
	# grilles d'aération
	m.part = 1
	for x: float in [-0.66, -0.12, 0.12, 0.66]:
		m.boxc(Vector3(x, 0.82, -0.6), Vector3(0.12, 0.05, 0.02))
	# console centrale, levier de vitesses, frein à main
	m.part = 6
	m.boxc(Vector3(0, 0.6, -0.68), Vector3(0.26, 0.24, 0.16))
	m.part = 5
	m.boxc(Vector3(0, 0.42, -0.2), Vector3(0.24, 0.24, 0.9))
	m.part = 1
	m.tube(Vector3(0, 0.54, -0.42), Vector3(0, 0.66, -0.38), 0.012)
	m.part = 2
	m.boxc(Vector3(0, 0.675, -0.375), Vector3(0.05, 0.045, 0.06))
	m.part = 1
	m.boxc(Vector3(0, 0.56, -0.05), Vector3(0.04, 0.03, 0.22), Vector3(0.25, 0, 0))
	# sièges avant (baquets) : assise, dossier incliné, bourrelets, appuie-tête
	m.part = 12
	for sx: float in [-0.37, 0.37]:
		m.boxc(Vector3(sx, 0.43, 0.14), Vector3(0.48, 0.12, 0.5))
		for bx: float in [-0.21, 0.21]:
			m.boxc(Vector3(sx + bx, 0.5, 0.14), Vector3(0.07, 0.08, 0.46))
		var back := Transform3D(Basis.from_euler(Vector3(0.22, 0, 0)), Vector3(sx, 0.78, 0.46))
		m.box(back, Vector3(0.48, 0.62, 0.11))
		for bx: float in [-0.21, 0.21]:
			m.box(back * Transform3D(Basis(), Vector3(bx, -0.02, -0.04)), Vector3(0.07, 0.5, 0.08))
		m.box(back * Transform3D(Basis(), Vector3(0, 0.42, 0.01)), Vector3(0.26, 0.16, 0.09))
		m.part = 2
		for bx: float in [-0.07, 0.07]:
			m.box(back * Transform3D(Basis(), Vector3(bx, 0.33, 0.01)), Vector3(0.012, 0.06, 0.012))
		m.part = 12
		m.boxc(Vector3(sx, 0.32, 0.14), Vector3(0.36, 0.08, 0.4))
	# banquette arrière
	m.boxc(Vector3(0, 0.45, 1.06), Vector3(1.26, 0.13, 0.5))
	var rb := Transform3D(Basis.from_euler(Vector3(0.24, 0, 0)), Vector3(0, 0.78, 1.36))
	m.box(rb, Vector3(1.3, 0.6, 0.12))
	for sx: float in [-0.38, 0.38]:
		m.box(rb * Transform3D(Basis(), Vector3(sx, 0.38, 0.01)), Vector3(0.24, 0.13, 0.08))
	m.part = 5
	m.boxc(Vector3(0, 0.34, 1.06), Vector3(1.2, 0.08, 0.44))
	# plage arrière, accoudoirs des contre-portes
	m.part = 6
	m.boxc(Vector3(0, 1.0, 1.66), Vector3(1.3, 0.025, 0.36))
	for sd: float in [-1.0, 1.0]:
		for zc: float in [-0.2, 0.85]:
			m.boxc(Vector3((side_x(zc, 0.72) - 0.1) * sd, 0.72, zc), Vector3(0.07, 0.05, 0.5))
	# rétroviseur intérieur, pare-soleil
	m.part = 1
	m.tube(Vector3(0, 1.42, -0.36), Vector3(0, 1.33, -0.38), 0.01)
	m.boxc(Vector3(0, 1.3, -0.38), Vector3(0.24, 0.07, 0.03), Vector3(0.15, 0, 0))
	m.part = 6
	for sx: float in [-0.37, 0.37]:
		m.boxc(Vector3(sx, 1.39, -0.32), Vector3(0.36, 0.015, 0.16), Vector3(0.12, 0, 0))
	_add_mesh(_body, m, _mat, "Habitacle", false)
	# volant : colonne fixe, couronne et branches qui tournent autour de l'axe de la colonne
	var col := MB.new()
	col.part = 1
	col.tube(Vector3(-0.37, 0.72, -0.82), Vector3(-0.37, 0.86, -0.56), 0.035)
	_add_mesh(_body, col, _mat, "Colonne", false)
	var tilt := Node3D.new()
	tilt.name = "Volant"
	tilt.position = Vector3(-0.37, 0.88, -0.53)
	tilt.rotation = Vector3(deg_to_rad(62.0), 0, 0)
	_body.add_child(tilt)
	_steering = Node3D.new()
	tilt.add_child(_steering)
	var wh := MB.new()
	wh.part = 13
	wh.torus_y(Vector3.ZERO, 0.18, 0.017, 28, 8)
	wh.part = 1
	for a: float in [PI / 2.0, PI * 7.0 / 6.0, PI * 11.0 / 6.0]:
		var dirv := Vector3(cos(a), 0, sin(a))
		wh.tube(dirv * 0.05, dirv * 0.17, 0.014, 6)
	wh.boxc(Vector3(0, -0.01, 0), Vector3(0.11, 0.04, 0.09))
	wh.part = 2
	wh.boxc(Vector3(0, 0.012, 0), Vector3(0.04, 0.005, 0.025))
	_add_mesh(_steering, wh, _mat, "Couronne", false)

func _build_details() -> void:
	var m := MB.new()
	# avant : calandre (lames, jonc chromé, écusson ovale sans marque), entrée d'air basse, lèvre noire ; arrière : diffuseur, baguette ;
	# tout suit l'arrondi des bouts (nose_strip)
	m.part = 11
	nose_strip(m, true, -0.44, 0.44, 0.49, 0.63, 0.006)
	nose_strip(m, true, -0.52, 0.52, 0.3, 0.42, 0.006)
	m.part = 1
	for i in 4:
		nose_strip(m, true, -0.43, 0.43, 0.51 + i * 0.03, 0.518 + i * 0.03, 0.01, 8)
		nose_strip(m, true, -0.5, 0.5, 0.32 + i * 0.026, 0.326 + i * 0.026, 0.01, 8)
	nose_strip(m, true, -0.8, 0.8, 0.255, 0.3, 0.012, 16)
	nose_strip(m, false, -0.8, 0.8, 0.27, 0.37, 0.012, 16)
	m.part = 2
	nose_strip(m, true, -0.44, 0.44, 0.625, 0.638, 0.012, 8)
	m.boxc(Vector3(0, 0.57, nose_z(0.0, true) - 0.012), Vector3(0.1, 0.055, 0.012))
	nose_strip(m, false, -0.45, 0.45, 0.76, 0.772, 0.008, 8)
	# plaques d'immatriculation (fond blanc, bandes bleues : le texte est un Label3D)
	m.part = 8
	nose_strip(m, true, -0.26, 0.26, 0.385, 0.495, 0.014, 6)
	nose_strip(m, false, -0.26, 0.26, 0.6, 0.71, 0.01, 6)
	# joints de portes, poignées
	for sd: float in [-1.0, 1.0]:
		for zc: float in [-0.8, 0.37, 1.3]:
			var y0 := sill_y(zc) + 0.06
			var y1 := belt_y(zc) - 0.01
			m.part = 13
			var xs := side_x(zc, (y0 + y1) * 0.5) + 0.002
			m.boxc(Vector3(xs * sd, (y0 + y1) * 0.5, zc), Vector3(0.006, y1 - y0, 0.006))
		for zc: float in [-0.06, 1.06]:
			var yh := belt_y(zc) - 0.1
			m.part = 1
			m.boxc(Vector3((side_x(zc, yh) + 0.012) * sd, yh, zc), Vector3(0.025, 0.035, 0.17))
			m.part = 2
			m.boxc(Vector3((side_x(zc, yh) + 0.026) * sd, yh, zc), Vector3(0.006, 0.02, 0.15))
		# baguette chromée au bas des vitres
		m.part = 2
		var z := -0.72
		while z < 1.46:
			var z2 := minf(z + 0.12, 1.48)
			var yb := belt_y(z)
			var yb2 := belt_y(z2)
			var xa := side_x(z, yb) + 0.004
			var xb := side_x(z2, yb2) + 0.004
			m.quad(Vector3(xa * sd, yb - 0.012, z), Vector3(xb * sd, yb2 - 0.012, z2), Vector3(xb * sd, yb2 + 0.004, z2), Vector3(xa * sd, yb + 0.004, z), Vector3(sd, 0.2, 0))
			z = z2
		# protections latérales noires
		m.part = 1
		m.boxc(Vector3((side_x(0.2, 0.52) + 0.008) * sd, 0.52, 0.2), Vector3(0.02, 0.06, 1.7))
		# rétroviseurs : bras noir, coque peinte, miroir
		var mz := -0.66
		var my := belt_y(mz) + 0.05
		var mx := side_x(mz, belt_y(mz))
		m.part = 1
		m.boxc(Vector3((mx + 0.05) * sd, my - 0.02, mz), Vector3(0.12, 0.04, 0.08))
		m.part = 0
		m.boxc(Vector3((mx + 0.15) * sd, my + 0.02, mz), Vector3(0.18, 0.12, 0.1))
		m.part = 2
		m.boxc(Vector3((mx + 0.15) * sd, my + 0.02, mz + 0.052), Vector3(0.15, 0.09, 0.006))
	# essuie-glaces, antenne requin, échappement, essuie-glace arrière
	m.part = 13
	for x: float in [-0.42, 0.12]:
		var a := Vector3(x, top_y(ZH + 0.04) + 0.012, ZH + 0.06)
		var b := Vector3(x + 0.48, top_y(ZH + 0.12) + 0.012, ZH + 0.1)
		m.tube(a, b, 0.008, 5)
	m.tube(Vector3(0, top_y(1.7) + 0.01, 1.74), Vector3(0.3, top_y(1.6) + 0.02, 1.62), 0.007, 5)
	m.part = 1
	var fin := Transform3D(Basis(), Vector3(0, top_y(0.95) + 0.03, 0.95))
	m.box(fin, Vector3(0.05, 0.06, 0.16))
	m.box(fin * Transform3D(Basis.from_euler(Vector3(0.5, 0, 0)), Vector3(0, 0.01, -0.07)), Vector3(0.045, 0.05, 0.08))
	m.part = 2
	var ez := nose_z(0.55, false)
	m.tube(Vector3(-0.55, 0.27, ez - 0.25), Vector3(-0.55, 0.27, ez + 0.05), 0.035, 10)
	m.part = 1
	m.tube(Vector3(-0.55, 0.27, ez + 0.045), Vector3(-0.55, 0.27, ez + 0.055), 0.026, 10)
	_add_mesh(_body, m, _mat, "Details")
	# immatriculations fictives
	for front in [true, false]:
		var lb := Label3D.new()
		lb.text = PLATES[sim.id % PLATES.size()]
		lb.font_size = 40
		lb.pixel_size = 0.0019
		lb.modulate = Color(0.05, 0.05, 0.06)
		lb.outline_size = 0
		lb.double_sided = false
		lb.position = Vector3(0, 0.44 if front else 0.655, nose_z(0.0, front) + (-0.02 if front else 0.016))
		lb.rotation.y = PI if front else 0.0
		lb.visibility_range_end = 40.0
		_body.add_child(lb)
		var eu := MB.new()
		eu.part = 1
		var sx := 0.24 if front else -0.24
		nose_strip(eu, front, sx - 0.02, sx + 0.02, 0.39 if front else 0.605, 0.49 if front else 0.705, 0.018 if front else 0.014, 1)
		var mi := _add_mesh(_body, eu, _lamp_mat("eu", Color(0.05, 0.15, 0.6), 0.0), "BandeEU", false)
		mi.visibility_range_end = 60.0

func _lamp_mat(key: String, col: Color, energy: float) -> StandardMaterial3D:
	if _lamp_mats.has(key):
		return _lamp_mats[key]
	var mt := StandardMaterial3D.new()
	mt.albedo_color = col
	mt.roughness = 0.08
	mt.metallic = 0.0
	mt.emission_enabled = true
	mt.emission = col
	mt.emission_energy_multiplier = energy
	_lamp_mats[key] = mt
	return mt

func _lamp(nm: String, mb: MB, col: Color, energy: float) -> void:
	_add_mesh(_body, mb, _lamp_mat(nm, col, energy), nm, false)

func _build_lamps() -> void:
	# phares : boîtier sombre, verre, projecteur ; feux de jour en bandeau sous le phare
	var housing := MB.new()
	housing.part = 1
	var head := MB.new()
	var drl := MB.new()
	var tail := MB.new()
	var brake := MB.new()
	var rev := MB.new()
	var ind := MB.new()
	var fog := MB.new()
	var dash := MB.new()
	for sd: float in [-1.0, 1.0]:
		# phares en amande sur l'arrondi de l'avant : boîtier noir, verre, bandeau de jour dessous ; antibrouillards ; clignotants d'angle
		var a := 0.44 if sd > 0.0 else -0.82
		var b := 0.82 if sd > 0.0 else -0.44
		nose_strip(housing, true, a, b, 0.585, 0.7, 0.004, 8)
		nose_strip(head, true, a + 0.03, b - 0.03, 0.615, 0.69, 0.009, 8)
		nose_strip(drl, true, a + 0.02, b - 0.02, 0.592, 0.607, 0.009, 8)
		var fa := 0.54 if sd > 0.0 else -0.66
		nose_strip(fog, true, fa, fa + 0.12, 0.33, 0.38, 0.013, 3)
		var ia := 0.8 if sd > 0.0 else -0.86
		nose_strip(ind, true, ia, ia + 0.06, 0.62, 0.68, 0.01, 2)
		ind.boxc(Vector3((side_x(-1.62, 0.72) + 0.006) * sd, 0.72, -1.62), Vector3(0.012, 0.025, 0.07))
		# feux arrière : bloc enveloppant (feu, stop, recul, clignotant)
		var ta := 0.46 if sd > 0.0 else -0.86
		var tb := 0.86 if sd > 0.0 else -0.46
		nose_strip(housing, false, ta, tb, 0.8, 0.96, 0.004, 8)
		nose_strip(tail, false, ta + 0.02, tb - 0.02, 0.9, 0.95, 0.009, 8)
		nose_strip(brake, false, ta + 0.02, tb - 0.02, 0.845, 0.895, 0.009, 8)
		var ra := 0.48 if sd > 0.0 else -0.58
		nose_strip(rev, false, ra, ra + 0.1, 0.81, 0.84, 0.01, 3)
		var ca := 0.74 if sd > 0.0 else -0.84
		nose_strip(ind, false, ca, ca + 0.1, 0.81, 0.84, 0.01, 3)
	brake.boxc(Vector3(0, top_y(ZG) + 0.0, ZG + 0.04), Vector3(0.3, 0.025, 0.02))   # troisième feu stop
	# éclairage du tableau de bord (aiguilles et écran)
	dash.boxc(Vector3(-0.37, 0.906, -0.632), Vector3(0.3, 0.075, 0.004), Vector3(-0.35, 0, 0))
	dash.boxc(Vector3(0.0, 0.881, -0.668), Vector3(0.21, 0.12, 0.004), Vector3(-0.3, 0, 0))
	_add_mesh(_body, housing, _mat, "Optiques", false)
	_lamp("phare", head, Color(1.0, 0.95, 0.85), 0.3)
	_lamp("jour", drl, Color(0.92, 0.95, 1.0), 0.2)
	_lamp("feu", tail, Color(0.55, 0.02, 0.02), 0.15)
	_lamp("stop", brake, Color(0.6, 0.02, 0.02), 0.1)
	_lamp("recul", rev, Color(0.85, 0.85, 0.85), 0.05)
	_lamp("cligno", ind, Color(1.0, 0.45, 0.05), 0.1)
	_lamp("antibrouillard", fog, Color(0.95, 0.93, 0.85), 0.1)
	_lamp("tableau", dash, Color(0.25, 0.6, 0.9), 0.0)

## Une roue (repère : axe x, centre à l'origine, extérieur vers +x) : pneu, flancs arrondis, jante à 5 branches, moyeu, disque.
static func _wheel_mesh() -> MB:
	var m := MB.new()
	var w := 0.205
	var n := 28
	m.part = 3
	m.cyl_x(-w * 0.5 + 0.02, w * 0.5 - 0.02, 0.0, 0.0, WR, n, false)
	for sx: float in [-1.0, 1.0]:   # épaulements et flancs
		for i in n:
			var a0 := TAU * i / n
			var a1 := TAU * (i + 1) / n
			var d0 := Vector3(0, cos(a0), sin(a0))
			var d1 := Vector3(0, cos(a1), sin(a1))
			var xo := sx * (w * 0.5 - 0.02)
			var xe := sx * w * 0.5
			m.tri(Vector3(xo, 0, 0) + d0 * WR, (d0 + Vector3(sx, 0, 0)).normalized(), Vector3(xe, 0, 0) + d0 * (WR - 0.03), Vector3(sx, 0.3, 0).normalized(), Vector3(xe, 0, 0) + d1 * (WR - 0.03), Vector3(sx, 0.3, 0).normalized())
			m.tri(Vector3(xo, 0, 0) + d0 * WR, (d0 + Vector3(sx, 0, 0)).normalized(), Vector3(xe, 0, 0) + d1 * (WR - 0.03), Vector3(sx, 0.3, 0).normalized(), Vector3(xo, 0, 0) + d1 * WR, (d1 + Vector3(sx, 0, 0)).normalized())
			m.flat(Vector3(xe, 0, 0) + d0 * (WR - 0.03), Vector3(xe, 0, 0) + d0 * 0.205, Vector3(xe, 0, 0) + d1 * 0.205, Vector3(sx, 0, 0))
			m.flat(Vector3(xe, 0, 0) + d0 * (WR - 0.03), Vector3(xe, 0, 0) + d1 * 0.205, Vector3(xe, 0, 0) + d1 * (WR - 0.03), Vector3(sx, 0, 0))
	# jante : rebord, fond, 5 branches, moyeu, écrous
	m.part = 4
	var xr := w * 0.5 - 0.005
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var d0 := Vector3(0, cos(a0), sin(a0))
		var d1 := Vector3(0, cos(a1), sin(a1))
		m.flat(Vector3(xr, 0, 0) + d0 * 0.205, Vector3(xr - 0.03, 0, 0) + d0 * 0.19, Vector3(xr - 0.03, 0, 0) + d1 * 0.19, Vector3(1, 0, 0))
		m.flat(Vector3(xr, 0, 0) + d0 * 0.205, Vector3(xr - 0.03, 0, 0) + d1 * 0.19, Vector3(xr, 0, 0) + d1 * 0.205, Vector3(1, 0, 0))
	m.part = 7
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		m.flat(Vector3(-0.04, 0, 0), Vector3(-0.04, cos(a0) * 0.19, sin(a0) * 0.19), Vector3(-0.04, cos(a1) * 0.19, sin(a1) * 0.19), Vector3(1, 0, 0))
	m.part = 4
	for k in 5:
		var a := TAU * k / 5.0
		var b := Basis(Vector3.RIGHT, a)
		m.box(Transform3D(b, b * Vector3(xr - 0.035, 0.11, 0.0)), Vector3(0.04, 0.17, 0.045))
		m.box(Transform3D(b * Basis(Vector3.RIGHT, 0.12), b * Vector3(xr - 0.03, 0.17, 0.012)), Vector3(0.03, 0.06, 0.03))
	m.cyl_x(xr - 0.06, xr - 0.005, 0.0, 0.0, 0.055, 14)
	m.part = 2
	m.cyl_x(xr - 0.006, xr + 0.002, 0.0, 0.0, 0.028, 10)
	for k in 4:
		var a2 := TAU * k / 4.0 + 0.4
		m.cyl_x(xr - 0.01, xr + 0.004, cos(a2) * 0.042, sin(a2) * 0.042, 0.008, 6)
	# disque de frein (tourne avec la roue)
	m.part = 9
	m.cyl_x(-0.035, -0.012, 0.0, 0.0, 0.15, 24)
	return m

func _build_wheels() -> void:
	var wm := _wheel_mesh().mesh()
	_tri += wm.get_faces().size() / 3 * 4
	var caliper := MB.new()
	caliper.part = 10
	caliper.boxc(Vector3.ZERO, Vector3(0.05, 0.1, 0.06), Vector3(0.6, 0, 0))
	var cal_mesh := caliper.mesh()
	for ax: float in [-AXLE, AXLE]:
		for sd: float in [-1.0, 1.0]:
			var knuckle := Node3D.new()
			knuckle.position = Vector3(TRACK * sd, WR, ax)
			add_child(knuckle)
			var side := Node3D.new()
			side.rotation.y = 0.0 if sd > 0.0 else PI   # roue gauche : l'extérieur de la jante vers -x
			knuckle.add_child(side)
			var spin := Node3D.new()
			side.add_child(spin)
			var mi := MeshInstance3D.new()
			mi.mesh = wm
			mi.material_override = _mat
			mi.visibility_range_end = 220.0
			spin.add_child(mi)
			var cm := MeshInstance3D.new()
			cm.mesh = cal_mesh
			cm.material_override = _mat
			cm.visibility_range_end = 120.0
			cm.position = Vector3(-0.03 * sd, 0.06, -0.11)   # étrier fixe, côté intérieur du disque, devant
			knuckle.add_child(cm)
			_wheels.append(spin)
			_spin_sign.append(sd)
			if ax < 0.0:
				_knuckles.append(knuckle)

func _build_lights() -> void:
	for sd: float in [-1.0, 1.0]:
		var sp := SpotLight3D.new()
		sp.name = "Phare"
		sp.position = Vector3(0.6 * sd, 0.66, -HL - 0.1)
		sp.rotation = Vector3(-0.09, 0.03 * sd, 0)
		sp.light_color = Color(1.0, 0.93, 0.8)
		sp.spot_range = 55.0
		sp.spot_angle = 30.0
		sp.spot_attenuation = 0.8
		sp.spot_angle_attenuation = 1.4
		sp.light_energy = 0.0
		sp.shadow_enabled = false
		sp.visible = false
		_body.add_child(sp)
		_spots.append(sp)
	_rear_glow = OmniLight3D.new()
	_rear_glow.position = Vector3(0, 0.85, HL + 0.4)
	_rear_glow.light_color = Color(1.0, 0.1, 0.06)
	_rear_glow.omni_range = 3.2
	_rear_glow.light_energy = 0.0
	_rear_glow.visible = false
	_body.add_child(_rear_glow)
	_rev_glow = OmniLight3D.new()
	_rev_glow.position = Vector3(0, 0.6, HL + 0.8)
	_rev_glow.light_color = Color(1, 1, 1)
	_rev_glow.omni_range = 5.0
	_rev_glow.light_energy = 0.0
	_rev_glow.visible = false
	_body.add_child(_rev_glow)

func _make_fx() -> void:
	_smoke = CPUParticles3D.new()
	_smoke.amount = 50
	_smoke.lifetime = 2.2
	_smoke.emitting = false
	_smoke.direction = Vector3.UP
	_smoke.spread = 22.0
	_smoke.initial_velocity_min = 0.7
	_smoke.initial_velocity_max = 1.4
	_smoke.gravity = Vector3(0, 0.3, 0)
	_smoke.scale_amount_min = 1.0
	_smoke.scale_amount_max = 2.2
	_smoke.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_smoke.emission_box_extents = Vector3(0.5, 0.05, 0.4)
	var sm := SphereMesh.new()
	sm.radius = 0.18
	sm.height = 0.36
	sm.radial_segments = 8
	sm.rings = 4
	var smat := StandardMaterial3D.new()
	smat.albedo_color = Color(0.25, 0.26, 0.28, 0.55)
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.material = smat
	_smoke.mesh = sm
	_smoke.position = Vector3(0, 0.95, -1.5)
	add_child(_smoke)
	_fire = CPUParticles3D.new()
	_fire.amount = 60
	_fire.lifetime = 0.7
	_fire.emitting = false
	_fire.direction = Vector3.UP
	_fire.spread = 25.0
	_fire.initial_velocity_min = 1.2
	_fire.initial_velocity_max = 2.6
	_fire.gravity = Vector3(0, 1.0, 0)
	_fire.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_fire.emission_box_extents = Vector3(0.5, 0.05, 0.4)
	var fm := SphereMesh.new()
	fm.radius = 0.12
	fm.height = 0.24
	fm.radial_segments = 6
	fm.rings = 3
	var fmat := StandardMaterial3D.new()
	fmat.albedo_color = Color(1.0, 0.5, 0.1)
	fmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.material = fmat
	_fire.mesh = fm
	_fire.position = Vector3(0, 0.9, -1.5)
	add_child(_fire)

# ------------------------------------------------------------------ pose
func remember() -> void:
	_prev = _cur
	_cur = Vector3(sim.x, sim.z, sim.yaw)
	_y_prev = _y_cur   # v0.37.0 : relief du banc d'essai (0 ailleurs)
	_y_cur = sim.y

## Nœud qui porte les places (la caisse : les passagers suivent tangage et roulis).
func seat_parent() -> Node3D:
	return _body

func _process(dt: float) -> void:
	if sim == null:
		return
	var pt := PerfLog.t()
	_blink_t += dt
	apply(Engine.get_physics_interpolation_fraction())
	_update_npcs()
	PerfLog.add(&"vehicule", pt)

func apply(f: float) -> void:
	var x := lerpf(_prev.x, _cur.x, f)
	var z := lerpf(_prev.y, _cur.y, f)
	var yaw := _prev.z + VehicleSim.ang_diff(_cur.z, _prev.z) * f
	visible = sim.state != "gone"
	var wreck := sim.state == "wreck"
	position = Vector3(x, (-0.1 if wreck else 0.0) + lerpf(_y_prev, _y_cur, f), z)
	rotation = Vector3(atan(sim.grade), yaw, 0)
	_body.rotation = Vector3(-sim.pitch, 0, -sim.roll) if not wreck else Vector3(0.02, 0, 0.03)
	for k in _knuckles:
		k.rotation.y = -sim.steer_angle
	for i in _wheels.size():
		_wheels[i].rotation.x = -sim.wheel_rot * _spin_sign[i]
	if _steering != null:
		_steering.rotation.y = -sim.steer * 2.6   # couronne : ~150° de butée à butée de chaque côté
	if wreck != _wreck_look:
		_wreck_look = wreck
		_mat.set_shader_parameter("burnt", 1.0 if wreck else 0.0)
		_glass_mat.set_shader_parameter("broken", 1.0 if wreck else 0.0)
	_mat.set_shader_parameter("damage", clampf(1.0 - sim.hp_frac(), 0.0, 1.0) if sim.state == "ok" else 1.0)
	_update_lamps()
	_update_fx()

func _set_lamp(key: String, energy: float) -> void:
	var m: StandardMaterial3D = _lamp_mats[key]
	if not is_equal_approx(m.emission_energy_multiplier, energy):
		m.emission_energy_multiplier = energy

func _update_lamps() -> void:
	var alive := sim.state == "ok"
	var running := alive and sim.has_driver() and sim.fuel > 0.0
	var on := alive and sim.lights
	var hazard := sim.state == "burning" or (alive and sim.hp_frac() < 0.25)
	var blink := hazard and fmod(_blink_t, 0.8) < 0.4
	_set_lamp("phare", 5.0 if on else 0.25)
	_set_lamp("antibrouillard", 1.6 if on else 0.1)
	_set_lamp("jour", 3.0 if running else 0.2)
	_set_lamp("feu", 1.4 if on else 0.15)
	_set_lamp("stop", 5.0 if (alive and sim.brake_lamp) else (0.9 if on else 0.1))
	_set_lamp("recul", 3.0 if (alive and sim.reversing) else 0.05)
	_set_lamp("cligno", 4.0 if blink else 0.1)
	_set_lamp("tableau", 1.6 if running else 0.0)
	for sp in _spots:
		sp.visible = on
		sp.light_energy = HEAD_ENERGY if on else 0.0
	_rear_glow.visible = on or (alive and sim.brake_lamp)
	_rear_glow.light_energy = (1.4 if sim.brake_lamp else 0.5) if _rear_glow.visible else 0.0
	_rev_glow.visible = alive and sim.reversing
	_rev_glow.light_energy = 0.9 if _rev_glow.visible else 0.0

func _update_fx() -> void:
	var D: Dictionary = Config.at("vehicles.damage.smoke")
	var grey := false
	var black := false
	var flame := false
	if sim.state == "ok":
		var fr := sim.hp_frac()
		black = fr < float(D["black"]["below"])
		grey = fr < float(D["grey"]["below"]) and not black
		flame = fr < float(D["flames"]["below"])
	elif sim.state == "burning":
		black = true
		flame = true
	elif sim.state == "wreck":
		black = true
		flame = sim.wreck_t > float(Config.at("vehicles.damage.wreckTime")) - 8.0
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var near := cam != null and global_position.distance_to(cam.global_position) < 80.0
	_smoke.emitting = (grey or black) and near
	(_smoke.mesh.material as StandardMaterial3D).albedo_color = Color(0.12, 0.12, 0.13, 0.65) if black else Color(0.42, 0.43, 0.45, 0.5)
	_fire.emitting = flame and near

## Passagers autres que le joueur (place occupée par un identifiant de survivant) : assis, enfants de la caisse.
func _update_npcs() -> void:
	for i in range(1, sim.seats.size()):
		var occ: Variant = sim.seats[i]
		var want := occ is String and CharacterModel.exists(String(occ))
		if want and not _npc.has(i):
			var m := CharacterModel.create(String(occ))
			if m == null:
				continue
			var holder := Node3D.new()
			holder.name = "Passager%d" % i
			_body.add_child(holder)
			holder.add_child(m)
			m.rotation.y = PI
			m.play(CharacterModel.seat_anim(false, "voiture", false))
			var hp: Array = sim.model_seats[i]["hip"]
			holder.position = Vector3(float(hp[0]), float(hp[1]) - m.hip_height(), float(hp[2]))
			_npc[i] = holder
		elif not want and _npc.has(i):
			(_npc[i] as Node3D).queue_free()
			_npc.erase(i)

# ------------------------------------------------------------------ tests
func wheel_count() -> int:
	return _wheels.size()
func has_steering_wheel() -> bool:
	return _steering != null
func headlight_count() -> int:
	return _spots.size()
func headlights_on() -> bool:
	return not _spots.is_empty() and _spots[0].visible and _spots[0].light_energy > 0.0
func triangles() -> int:
	return _tri
