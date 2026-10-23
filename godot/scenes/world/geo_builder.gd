extends RefCounted
## v0.24.2 : petit constructeur de maillages procéduraux (cathédrale : tools de génération reproductibles, aucun fichier cuit). Tout est en triangles non indexés, normales plates,
## couleur de sommet = occlusion ambiante peinte à la main (COLOR.r) lue par shaders/stone.gdshader.
## Repère local de l'appelant (voir cathedral_view.gd) : x vers l'extérieur de la façade, y vers le haut, z latéral. Les triangles sont orientés pour Godot (face avant = sens horaire).

var verts := PackedVector3Array()
var norms := PackedVector3Array()
var cols := PackedColorArray()
var ao := 1.0   ## occlusion ambiante des sommets ajoutés ensuite (1 : exposé, 0,3 : creux)

func tri(a: Vector3, b: Vector3, c: Vector3, hint: Vector3) -> void:
	var n := (b - a).cross(c - a)
	if n.length_squared() < 1e-12:
		return
	n = n.normalized()
	if n.dot(hint) > 0.0:   # Godot : face avant = sens horaire ; le produit vectoriel d'un triangle horaire pointe vers l'arrière
		var t := b
		b = c
		c = t
	n = -(b - a).cross(c - a).normalized()   # sortante : le produit vectoriel d'un triangle horaire pointe vers l'arrière
	verts.append_array([a, b, c])
	norms.append_array([n, n, n])
	var col := Color(ao, ao, ao, 1.0)
	cols.append_array([col, col, col])

func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, hint: Vector3) -> void:
	tri(a, b, c, hint)
	tri(a, c, d, hint)

## Boîte alignée sur les axes ; faces : tableau de booléens (+x, -x, +y, -y, +z, -z), toutes par défaut.
func box(c: Vector3, s: Vector3, faces: int = 63) -> void:
	var h := s * 0.5
	var x0 := c.x - h.x
	var x1 := c.x + h.x
	var y0 := c.y - h.y
	var y1 := c.y + h.y
	var z0 := c.z - h.z
	var z1 := c.z + h.z
	if faces & 1:
		quad(Vector3(x1, y0, z0), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x1, y1, z0), Vector3.RIGHT)
	if faces & 2:
		quad(Vector3(x0, y0, z0), Vector3(x0, y0, z1), Vector3(x0, y1, z1), Vector3(x0, y1, z0), Vector3.LEFT)
	if faces & 4:
		quad(Vector3(x0, y1, z0), Vector3(x1, y1, z0), Vector3(x1, y1, z1), Vector3(x0, y1, z1), Vector3.UP)
	if faces & 8:
		quad(Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y0, z1), Vector3(x0, y0, z1), Vector3.DOWN)
	if faces & 16:
		quad(Vector3(x0, y0, z1), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x0, y1, z1), Vector3.BACK)
	if faces & 32:
		quad(Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y1, z0), Vector3(x0, y1, z0), Vector3.FORWARD)

## Polygone du plan (z, y) extrudé le long de x de x0 à x1 ; cap : dessine la face avant (x1) et la face arrière.
func extrude(poly: PackedVector2Array, x0: float, x1: float, cap: bool = true) -> void:
	var n := poly.size()
	if n < 3:
		return
	var area := 0.0
	for i in n:
		var p := poly[i]
		var q := poly[(i + 1) % n]
		area += p.x * q.y - q.x * p.y
	var pts := poly
	if area < 0.0:
		pts = PackedVector2Array()
		for i in n:
			pts.append(poly[n - 1 - i])
	for i in n:
		var p := pts[i]
		var q := pts[(i + 1) % n]
		var e := Vector3(0.0, q.y - p.y, q.x - p.x)   # arête dans le plan (z, y)
		var out := Vector3(0.0, e.z, -e.y)            # normale sortante (polygone anti-horaire dans (z, y))
		quad(Vector3(x0, p.y, p.x), Vector3(x1, p.y, p.x), Vector3(x1, q.y, q.x), Vector3(x0, q.y, q.x), out)
	if cap:
		var idx := Geometry2D.triangulate_polygon(pts)
		for k in range(0, idx.size(), 3):
			var a := pts[idx[k]]
			var b := pts[idx[k + 1]]
			var c := pts[idx[k + 2]]
			tri(Vector3(x1, a.y, a.x), Vector3(x1, b.y, b.x), Vector3(x1, c.y, c.x), Vector3.RIGHT)
			tri(Vector3(x0, a.y, a.x), Vector3(x0, b.y, b.x), Vector3(x0, c.y, c.x), Vector3.LEFT)

## Arc brisé (gothique) : points du contour extérieur d'un arc dont les naissances sont en (zc -/+ hw, y0) et la clé à y0 + rise ; n segments.
## Deux arcs de cercle de rayon r = (hw^2 + rise^2) / (2 hw)... pour un arc brisé : centres décalés ; ici forme « tiers-point » paramétrée par la hauteur de clé.
static func pointed_arch(zc: float, y0: float, hw: float, rise: float, n: int = 10, offset: float = 0.0) -> PackedVector2Array:
	# arc brisé : arc de cercle gauche centré sur la naissance droite et inversement quand rise = hw * sqrt(3) (équilatéral) ; on garde la forme générale pour tout rise.
	var hw2 := hw + offset
	var rise2 := rise + offset * 1.2
	# rayon tel que le cercle centré en (zc + c, y0) passe par la naissance gauche (zc - hw2, y0) et la clé (zc, y0 + rise2)
	# (c + hw2)^2 = c^2 + rise2^2  ->  c = (rise2^2 - hw2^2) / (2 hw2)
	var c := (rise2 * rise2 - hw2 * hw2) / (2.0 * hw2)
	var r := c + hw2
	var pts := PackedVector2Array()
	var a_end := atan2(rise2, -c)           # angle de la clé vu du centre droit (cercle qui forme le flanc gauche)
	var a_start := PI                        # naissance gauche
	for i in range(n + 1):
		var a := lerpf(a_start, a_end, float(i) / n)
		pts.append(Vector2(zc + c + cos(a) * r, y0 + sin(a) * r))
	var a_end2 := atan2(rise2, c)
	for i in range(1, n + 1):
		var a := lerpf(a_end2, 0.0, float(i) / n)
		pts.append(Vector2(zc - c + cos(a) * r, y0 + sin(a) * r))
	return pts

## Anneau d'arc brisé (voussure) : de l'arc d'intrados (offset d0) à l'arc d'extrados (offset d1), extrudé de x0 à x1.
func arch_ring(zc: float, y0: float, hw: float, rise: float, d0: float, d1: float, x0: float, x1: float, n: int = 10) -> void:
	var inner := pointed_arch(zc, y0, hw, rise, n, d0)
	var outer := pointed_arch(zc, y0, hw, rise, n, d1)
	var poly := PackedVector2Array()
	poly.append_array(outer)
	for i in inner.size():
		poly.append(inner[inner.size() - 1 - i])
	extrude(poly, x0, x1)

## Plein d'arc brisé (tympan, vitrail) : l'arc fermé par la base, extrudé.
func arch_fill(zc: float, y0: float, hw: float, rise: float, x0: float, x1: float, n: int = 10, offset: float = 0.0) -> void:
	extrude(pointed_arch(zc, y0, hw, rise, n, offset), x0, x1)

## Prisme octogonal / polygonal vertical (tourelle, fût) : centre (cx, cz), rayon (au sommet), n côtés, de y0 à y1, rayon du haut r1 (r1 < r0 : fût qui s'amincit).
func prism(cx: float, cz: float, r0: float, r1: float, y0: float, y1: float, n: int, rot: float = 0.0, cap_top: bool = true) -> void:
	for i in n:
		var a0 := rot + TAU * i / n
		var a1 := rot + TAU * (i + 1) / n
		var p0 := Vector3(cx + cos(a0) * r0, y0, cz + sin(a0) * r0)
		var p1 := Vector3(cx + cos(a1) * r0, y0, cz + sin(a1) * r0)
		var q1 := Vector3(cx + cos(a1) * r1, y1, cz + sin(a1) * r1)
		var q0 := Vector3(cx + cos(a0) * r1, y1, cz + sin(a0) * r1)
		var am := (a0 + a1) * 0.5
		quad(p0, p1, q1, q0, Vector3(cos(am), 0.0, sin(am)))
		if cap_top and r1 > 0.0:
			tri(Vector3(cx, y1, cz), q0, q1, Vector3.UP)

## Flèche pyramidale à n côtés : de r0 en y0 à la pointe en y1.
func spire(cx: float, cz: float, r0: float, y0: float, y1: float, n: int, rot: float = 0.0) -> void:
	for i in n:
		var a0 := rot + TAU * i / n
		var a1 := rot + TAU * (i + 1) / n
		var p0 := Vector3(cx + cos(a0) * r0, y0, cz + sin(a0) * r0)
		var p1 := Vector3(cx + cos(a1) * r0, y0, cz + sin(a1) * r0)
		var tip := Vector3(cx, y1, cz)
		var am := (a0 + a1) * 0.5
		tri(p0, p1, tip, Vector3(cos(am), 0.4, sin(am)))

## Balayage d'une section rectangulaire (w x h, h dans le plan du chemin) le long d'un chemin dans le plan (x, y) à z fixe : arcs-boutants.
func sweep_xy(path: Array, z: float, w: float, h: float) -> void:
	for i in range(path.size() - 1):
		var a: Vector2 = path[i]
		var b: Vector2 = path[i + 1]
		var d := (b - a).normalized()
		var nrm := Vector2(-d.y, d.x)   # normale dans le plan (x, y)
		var a0 := a - nrm * h * 0.5
		var a1 := a + nrm * h * 0.5
		var b0 := b - nrm * h * 0.5
		var b1 := b + nrm * h * 0.5
		var zl := z - w * 0.5
		var zr := z + w * 0.5
		# dessus / dessous
		quad(Vector3(a1.x, a1.y, zl), Vector3(b1.x, b1.y, zl), Vector3(b1.x, b1.y, zr), Vector3(a1.x, a1.y, zr), Vector3(nrm.x, nrm.y, 0.0))
		quad(Vector3(a0.x, a0.y, zl), Vector3(b0.x, b0.y, zl), Vector3(b0.x, b0.y, zr), Vector3(a0.x, a0.y, zr), Vector3(-nrm.x, -nrm.y, 0.0))
		# côtés
		quad(Vector3(a0.x, a0.y, zr), Vector3(b0.x, b0.y, zr), Vector3(b1.x, b1.y, zr), Vector3(a1.x, a1.y, zr), Vector3.BACK)
		quad(Vector3(a0.x, a0.y, zl), Vector3(b0.x, b0.y, zl), Vector3(b1.x, b1.y, zl), Vector3(a1.x, a1.y, zl), Vector3.FORWARD)

func build() -> ArrayMesh:
	var mesh := ArrayMesh.new()
	if verts.is_empty():
		return mesh
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

func triangle_count() -> int:
	return verts.size() / 3

## Anneau (couronne) dans le plan (z, y), extrudé le long de x : rayon intérieur r0, extérieur r1, n côtés.
func annulus_x(zc: float, yc: float, r0: float, r1: float, x0: float, x1: float, n: int = 24) -> void:
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var c0 := Vector2(cos(a0), sin(a0))
		var c1 := Vector2(cos(a1), sin(a1))
		var am := (a0 + a1) * 0.5
		var nm := Vector3(0.0, sin(am), cos(am))
		# paroi extérieure et intérieure
		quad(Vector3(x0, yc + c0.y * r1, zc + c0.x * r1), Vector3(x1, yc + c0.y * r1, zc + c0.x * r1), Vector3(x1, yc + c1.y * r1, zc + c1.x * r1), Vector3(x0, yc + c1.y * r1, zc + c1.x * r1), nm)
		if r0 > 0.0:
			quad(Vector3(x0, yc + c0.y * r0, zc + c0.x * r0), Vector3(x1, yc + c0.y * r0, zc + c0.x * r0), Vector3(x1, yc + c1.y * r0, zc + c1.x * r0), Vector3(x0, yc + c1.y * r0, zc + c1.x * r0), -nm)
		# faces avant / arrière
		if r0 > 0.0:
			quad(Vector3(x1, yc + c0.y * r0, zc + c0.x * r0), Vector3(x1, yc + c0.y * r1, zc + c0.x * r1), Vector3(x1, yc + c1.y * r1, zc + c1.x * r1), Vector3(x1, yc + c1.y * r0, zc + c1.x * r0), Vector3.RIGHT)
			quad(Vector3(x0, yc + c0.y * r0, zc + c0.x * r0), Vector3(x0, yc + c0.y * r1, zc + c0.x * r1), Vector3(x0, yc + c1.y * r1, zc + c1.x * r1), Vector3(x0, yc + c1.y * r0, zc + c1.x * r0), Vector3.LEFT)
		else:
			tri(Vector3(x1, yc, zc), Vector3(x1, yc + c0.y * r1, zc + c0.x * r1), Vector3(x1, yc + c1.y * r1, zc + c1.x * r1), Vector3.RIGHT)

## Barre (rectangle de largeur w) dans le plan (z, y) de (z0, y0) à (z1, y1), extrudée de x0 à x1 (rayons de rosace, meneaux obliques).
func bar_x(z0: float, y0: float, z1: float, y1: float, w: float, x0: float, x1: float) -> void:
	var d := Vector2(z1 - z0, y1 - y0)
	if d.length() < 1e-4:
		return
	var nrm := Vector2(-d.y, d.x).normalized() * w * 0.5
	extrude(PackedVector2Array([Vector2(z0, y0) - nrm, Vector2(z1, y1) - nrm, Vector2(z1, y1) + nrm, Vector2(z0, y0) + nrm]), x0, x1)

## Ajoute le contenu d'un autre constructeur (même repère).
func append(o: RefCounted) -> void:
	verts.append_array(o.verts)
	norms.append_array(o.norms)
	cols.append_array(o.cols)

## v0.32.0 : ajoute le contenu d'un autre constructeur transformé (repère local d'un mur -> repère de l'appelant).
func append_xf(o: RefCounted, xf: Transform3D) -> void:
	var nb := xf.basis.inverse().transposed()
	for i in o.verts.size():
		verts.append(xf * o.verts[i])
		norms.append((nb * o.norms[i]).normalized())
	cols.append_array(o.cols)

## v0.32.0 : travée de mur percée d'une baie en arc brisé, dans le plan (z, y), extrudée de x0 à x1 (le tableau de la baie est dessiné par l'extrusion).
## Mur de z0 à z1 et de yb à yt ; baie centrée en zc, demi-largeur hw, appui wy0, naissance spring, flèche rise. Deux demi-polygones (gauche / droite) sans trou.
func wall_bay(z0: float, z1: float, yb: float, yt: float, zc: float, hw: float, wy0: float, spring: float, rise: float, x0: float, x1: float, n: int = 8) -> void:
	var arch := pointed_arch(zc, spring, hw, rise, n)
	var left := PackedVector2Array([Vector2(z0, yb), Vector2(zc, yb), Vector2(zc, wy0), Vector2(zc - hw, wy0)])
	for i in range(n + 1):
		left.append(arch[i])
	left.append(Vector2(zc, yt))
	left.append(Vector2(z0, yt))
	var right := PackedVector2Array([Vector2(z1, yb), Vector2(z1, yt), Vector2(zc, yt)])
	for i in range(arch.size() - 1, n - 1, -1):
		right.append(arch[i])
	right.append(Vector2(zc + hw, wy0))
	right.append(Vector2(zc, wy0))
	right.append(Vector2(zc, yb))
	extrude(left, x0, x1)
	extrude(right, x0, x1)

## v0.32.0 : remplage d'une lancette (meneaux, sous-arcs, oculus) dans la baie (zc, hw, wy0, spring, rise), de x0 à x1 ; `lights` jours.
func tracery(zc: float, hw: float, wy0: float, spring: float, rise: float, x0: float, x1: float, lights: int = 2) -> void:
	var w := 0.16 + hw * 0.04
	for k in range(1, lights):
		var z := zc - hw + 2.0 * hw * k / lights
		box(Vector3((x0 + x1) * 0.5, (wy0 + spring) * 0.5 + rise * 0.15, z), Vector3(x1 - x0, spring - wy0 + rise * 0.3, w), 63 & ~4 & ~8)
	if lights >= 2:
		var sub := hw / lights
		for k in lights:
			var z := zc - hw + sub * (2 * k + 1)
			arch_ring(z, spring, sub - w * 0.5, rise * 0.45, 0.0, w, x0, x1, 6)
		var oy := spring + rise * 0.55
		var orad := minf(hw * 0.42, rise * 0.3)
		annulus_x(zc, oy, orad - w, orad, x0, x1, 14)
		for a in 4:
			var ang := TAU * (a + 0.5) / 4.0
			annulus_x(zc + cos(ang) * orad * 0.45, oy + sin(ang) * orad * 0.45, orad * 0.22, orad * 0.22 + w * 0.6, x0, x1, 8)
	# barlotières (traverses de fer)
	for k in range(1, int((spring - wy0) / 1.6) + 1):
		var y := wy0 + k * 1.6
		if y < spring - 0.3:
			box(Vector3((x0 + x1) * 0.5, y, zc), Vector3((x1 - x0) * 0.5, 0.05, hw * 2.0), 63)

## v0.32.0 : pinacle gothique : fût carré (base b, du sol y0 à y1), gâblets, flèche à crochets jusqu'à y2, fleuron.
func pinnacle(cx: float, cz: float, b: float, y0: float, y1: float, y2: float) -> void:
	box(Vector3(cx, (y0 + y1) * 0.5, cz), Vector3(b, y1 - y0, b), 63 & ~8)
	box(Vector3(cx, y1 - 0.15, cz), Vector3(b * 1.18, 0.3, b * 1.18), 63)
	for a in 4:   # gâblets sur les quatre faces
		var d := Vector2(cos(a * PI * 0.5), sin(a * PI * 0.5))
		var px := cx + d.x * b * 0.5
		var pz := cz + d.y * b * 0.5
		var side := Vector2(-d.y, d.x) * b * 0.45
		tri(Vector3(px - side.x, y1, pz - side.y), Vector3(px + side.x, y1, pz + side.y), Vector3(px, y1 + b * 0.9, pz), Vector3(d.x, 0.3, d.y))
	spire(cx, cz, b * 0.5 * 1.3, y1, y2, 4, PI / 4.0)
	var h := y2 - y1
	for k in range(1, 4):
		var f := float(k) / 4.0
		var r := b * 0.5 * 1.3 * (1.0 - f) + 0.08
		for a in 4:
			var ang := PI / 4.0 + a * PI * 0.5
			box(Vector3(cx + cos(ang) * r, y1 + h * f, cz + sin(ang) * r), Vector3(0.16, 0.26, 0.16), 63)
	box(Vector3(cx, y2 + 0.15, cz), Vector3(0.18, 0.4, 0.18), 63)
	box(Vector3(cx, y2 + 0.2, cz), Vector3(0.42, 0.1, 0.1), 63)
	box(Vector3(cx, y2 + 0.2, cz), Vector3(0.1, 0.1, 0.42), 63)

## v0.32.0 : gargouille : corps effilé qui sort du mur selon `d` (unitaire, horizontal), tête, gueule (gouttière), ailes repliées. Origine p au mur.
func gargoyle(p: Vector3, d: Vector3, length: float = 2.2) -> void:
	var side := Vector3(-d.z, 0.0, d.x)
	var n := 6
	var segs := 4
	for k in segs:
		var f0 := float(k) / segs
		var f1 := float(k + 1) / segs
		var r0 := lerpf(0.42, 0.22, f0)
		var r1 := lerpf(0.42, 0.22, f1)
		var c0 := p + d * length * f0 + Vector3.UP * (0.25 * sin(f0 * PI) )
		var c1 := p + d * length * f1 + Vector3.UP * (0.25 * sin(f1 * PI))
		for i in n:
			var a0 := TAU * i / n
			var a1 := TAU * (i + 1) / n
			var o0 := side * cos(a0) + Vector3.UP * sin(a0) * 0.8
			var o1 := side * cos(a1) + Vector3.UP * sin(a1) * 0.8
			quad(c0 + o0 * r0, c0 + o1 * r0, c1 + o1 * r1, c1 + o0 * r1, (o0 + o1) * 0.5)
	var head := p + d * (length + 0.15) + Vector3.UP * 0.05
	box(head, Vector3(0.4, 0.38, 0.4), 63)   # tête (alignée sur les axes : assez proche à distance)
	var jaw := head + d * 0.3 - Vector3.UP * 0.08
	box(jaw, Vector3(0.28, 0.12, 0.28), 63)
	for sd in [-1.0, 1.0]:   # oreilles / cornes
		box(head + side * 0.16 * sd + Vector3.UP * 0.26, Vector3(0.08, 0.2, 0.08), 63)
		# ailes repliées le long du corps
		var w0: Vector3 = p + d * length * 0.25 + side * 0.32 * sd + Vector3.UP * 0.2
		var w1: Vector3 = p + d * length * 0.75 + side * 0.22 * sd + Vector3.UP * 0.35
		tri(w0, w1, p + d * length * 0.4 + side * 0.3 * sd + Vector3.UP * 0.75, side * sd)
		tri(w0, w1, p + d * length * 0.4 + side * 0.3 * sd + Vector3.UP * 0.75, -side * sd)
	# pattes antérieures
	for sd in [-1.0, 1.0]:
		box(p + d * length * 0.7 + side * 0.18 * sd - Vector3.UP * 0.3, Vector3(0.12, 0.35, 0.12), 63)

## v0.32.0 : balustrade ajourée le long d'un segment horizontal (a -> b, mêmes y) : main courante, lisse basse, balustres tous les `step` m.
func balustrade(a: Vector3, b: Vector3, h: float = 1.0, step: float = 0.55, w: float = 0.32) -> void:
	var d := b - a
	var L := d.length()
	if L < 0.1:
		return
	var u := d / L
	var nrm := Vector3(-u.z, 0.0, u.x)
	# lisses haute et basse : prismes rectangulaires le long du segment
	for band in [[h - 0.16, h, w], [0.0, 0.14, w * 1.1]]:
		var y0: float = a.y + float(band[0])
		var y1: float = a.y + float(band[1])
		var ww: float = band[2]
		var p0 := a - nrm * ww * 0.5
		var p1 := a + nrm * ww * 0.5
		var q0 := b - nrm * ww * 0.5
		var q1 := b + nrm * ww * 0.5
		quad(Vector3(p0.x, y1, p0.z), Vector3(q0.x, y1, q0.z), Vector3(q1.x, y1, q1.z), Vector3(p1.x, y1, p1.z), Vector3.UP)
		quad(Vector3(p0.x, y0, p0.z), Vector3(q0.x, y0, q0.z), Vector3(q1.x, y0, q1.z), Vector3(p1.x, y0, p1.z), Vector3.DOWN)
		quad(Vector3(p0.x, y0, p0.z), Vector3(q0.x, y0, q0.z), Vector3(q0.x, y1, q0.z), Vector3(p0.x, y1, p0.z), -nrm)
		quad(Vector3(p1.x, y0, p1.z), Vector3(q1.x, y0, q1.z), Vector3(q1.x, y1, q1.z), Vector3(p1.x, y1, p1.z), nrm)
	var n := maxi(1, int(L / step))
	for k in range(n + 1):
		var p := a + u * (L * k / n)
		var s := w * 0.45
		# balustre à section carrée tournée de 45 degrés (losange) : lit mieux qu'un poteau carré
		var c := Vector3(p.x, a.y + 0.14, p.z)
		var top := a.y + h - 0.16
		var pts := [c + u * s, c + nrm * s, c - u * s, c - nrm * s]
		for i in 4:
			var p0: Vector3 = pts[i]
			var p1: Vector3 = pts[(i + 1) % 4]
			quad(p0, p1, Vector3(p1.x, top, p1.z), Vector3(p0.x, top, p0.z), ((p0 + p1) * 0.5 - c).normalized())
