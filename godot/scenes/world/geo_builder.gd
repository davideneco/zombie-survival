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
		n = -n
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
