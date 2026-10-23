extends RefCounted
## v0.32.0 : extérieur réaliste de la nef, des bas-côtés et des flancs du massif occidental de la cathédrale (généré par code, aucun fichier cuit).
## Repère « nef » (celui de Cathedral.P) : x = s (de la façade ouest vers le chœur), y = haut, z = t (vers le sud). Origine : Cathedral.P(0, 0) au sol.
## Ce qui est construit (les cotes viennent du relevé des tuiles cuites, voir docs/GODOT_PORT.md v0.32.0) :
##  - six culées par côté (contreforts des bas-côtés) avec glacis, niches, pinacles à crochets et gargouilles ;
##  - arcs-boutants à deux volées (intrados courbe, chaperon droit, rigole) de chaque culée au mur haut de la nef ;
##  - peau de pierre du clair-étage (|t| = 9,05 à 9,55) percée de grandes baies à remplage et vitraux, contreforts-colonnes et pinacles ;
##  - peau des murs des bas-côtés (lancettes à trois jours), corniche, balustrade ajourée ;
##  - toits en appentis des bas-côtés, grand comble de la nef (ardoise / cuivre patiné), crête de faîtage, balustrade de la corniche haute ;
##  - flancs nord et sud du massif (contreforts, lancettes, cordons) et face est au-dessus des combles.
## Tout est décor : la collision et les étages ne changent pas (les peaux sont à moins de 0,6 m des murs existants, au-dessus du sol praticable).

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")

const PIERS_S := [-24.1, -15.7, -7.5, 0.9, 9.7, 19.1]   ## s des culées (relevé des contreforts OSM)
const NAVE_S0 := -26.4        ## mur est du massif
const NAVE_S1 := 28.0         ## croisée
const CLER_T := 9.05          ## face extérieure du mur haut (le mur intérieur de la nef est à |t| = 9)
const CLER_D := 0.5
const AISLE_T := [-19.3, 19.62]  ## face extérieure des murs des bas-côtés (nord, sud)
const AISLE_TOP := 14.6
const LEAN_LOW := 15.5        ## pied de l'appentis (bord extérieur)
const LEAN_HIGH := 19.8       ## haut de l'appentis contre le mur haut
const EAVE_Y := 33.6
const EAVE_T := 10.25
const RIDGE_Y := 45.0
const MASSIF_S := [-50.6, -26.4]
const MASSIF_T := 26.35
const MASSIF_TOP := 67.5

var stone := GeoBuilder.new()
var glass := GeoBuilder.new()
var roof := GeoBuilder.new()

## Repère nef -> monde.
static func frame() -> Transform3D:
	var o := Cathedral.P(0.0, 0.0)
	var u := Cathedral.P(1.0, 0.0) - o
	var v := Cathedral.P(0.0, 1.0) - o
	return Transform3D(Basis(Vector3(u.x, 0.0, u.y), Vector3.UP, Vector3(v.x, 0.0, v.y)), Vector3(o.x, 0.0, o.y))

## Repère d'un mur parallèle à l'axe de la nef, face extérieure en t = tf, vers l'extérieur (sd = -1 : nord, +1 : sud). Local : x sortant, z le long du mur.
static func _wall_xf(tf: float, sd: float) -> Transform3D:
	if sd < 0.0:
		return Transform3D(Basis(Vector3(0, 0, -1), Vector3.UP, Vector3(1, 0, 0)), Vector3(0, 0, tf))
	return Transform3D(Basis(Vector3(0, 0, 1), Vector3.UP, Vector3(-1, 0, 0)), Vector3(0, 0, tf))

## z local d'un s donné sur le mur (le mur sud est parcouru à rebours).
static func _wz(s: float, sd: float) -> float:
	return s if sd < 0.0 else -s

func build() -> void:
	for sd in [-1.0, 1.0]:
		_clerestory(sd)
		_aisle_wall(sd)
		_lean_to(sd)
		for i in PIERS_S.size():
			_pier(float(PIERS_S[i]), sd, i >= 4)
			_flyers(float(PIERS_S[i]), sd)
		_massif_side(sd)
	_nave_roof()
	_massif_east()

# ----------------------------------------------------------------- mur haut (clair-étage)
func _bays(s0: float, s1: float) -> Array:
	var cuts: Array = [s0]
	for p in PIERS_S:
		if float(p) > s0 + 1.0 and float(p) < s1 - 1.0:
			cuts.append(float(p))
	cuts.append(s1)
	return cuts

func _clerestory(sd: float) -> void:
	var tf := CLER_T * sd
	var w := GeoBuilder.new()
	var g := GeoBuilder.new()
	var cuts := _bays(NAVE_S0, NAVE_S1)
	var y0 := LEAN_HIGH - 0.6
	var y1 := EAVE_Y
	for i in range(cuts.size() - 1):
		var a: float = cuts[i]
		var b: float = cuts[i + 1]
		var z0 := _wz(a, sd)
		var z1 := _wz(b, sd)
		if z0 > z1:
			var tmp := z0
			z0 = z1
			z1 = tmp
		var zc := (z0 + z1) * 0.5
		var hw := minf(3.1, (z1 - z0) * 0.5 - 1.0)
		w.ao = 0.95
		if hw < 0.8:
			w.box(Vector3(CLER_D * 0.5, (y0 + y1) * 0.5, zc), Vector3(CLER_D, y1 - y0, z1 - z0), 63 & ~2)
			continue
		var wy0 := 21.2
		var spring := 28.6
		var rise := hw * 1.25
		w.wall_bay(z0, z1, y0, y1, zc, hw, wy0, spring, rise, 0.0, CLER_D)
		w.ao = 0.7
		w.tracery(zc, hw, wy0, spring, rise, 0.12, 0.32, 4)
		w.ao = 0.9
		w.arch_ring(zc, spring, hw, rise, 0.0, 0.22, CLER_D, CLER_D + 0.18, 10)   # larmier
		w.box(Vector3(CLER_D + 0.12, wy0 - 0.15, zc), Vector3(0.3, 0.3, hw * 2.0 + 0.6), 63)   # appui
		var gl := PackedVector2Array([Vector2(zc - hw, wy0)])
		gl.append_array(GeoBuilder.pointed_arch(zc, spring, hw, rise, 10))
		gl.append(Vector2(zc + hw, wy0))
		g.extrude(gl, 0.2, 0.22)
	# contreforts-colonnes au droit des culées (là où retombent les arcs-boutants) + pinacles
	for p in PIERS_S:
		var z := _wz(float(p), sd)
		w.ao = 0.92
		w.box(Vector3(CLER_D + 0.4, (y0 + y1) * 0.5, z), Vector3(0.8, y1 - y0, 1.3), 63 & ~2 & ~8)
		w.pinnacle(CLER_D + 0.4, z, 1.0, y1, y1 + 2.6, y1 + 6.4)
	# corniche et cordon sous les baies
	w.ao = 0.85
	w.box(Vector3(CLER_D + 0.18, y1 - 0.2, (_wz(NAVE_S0, sd) + _wz(NAVE_S1, sd)) * 0.5), Vector3(0.36, 0.4, NAVE_S1 - NAVE_S0), 63)
	w.box(Vector3(CLER_D + 0.1, 20.8, (_wz(NAVE_S0, sd) + _wz(NAVE_S1, sd)) * 0.5), Vector3(0.2, 0.25, NAVE_S1 - NAVE_S0), 63)
	var xf := _wall_xf(tf, sd)
	stone.append_xf(w, xf)
	glass.append_xf(g, xf)
	# balustrade de la corniche haute
	stone.ao = 0.9
	stone.balustrade(Vector3(NAVE_S0 + 0.3, EAVE_Y, (CLER_T + 0.25) * sd), Vector3(NAVE_S1 - 0.3, EAVE_Y, (CLER_T + 0.25) * sd), 1.0, 0.5, 0.3)

# ----------------------------------------------------------------- murs des bas-côtés
func _aisle_wall(sd: float) -> void:
	var tf: float = AISLE_T[0] if sd < 0.0 else AISLE_T[1]
	var w := GeoBuilder.new()
	var g := GeoBuilder.new()
	var cuts := _bays(NAVE_S0, 9.0)
	var D := 0.35
	for i in range(cuts.size() - 1):
		var z0 := _wz(float(cuts[i]), sd)
		var z1 := _wz(float(cuts[i + 1]), sd)
		if z0 > z1:
			var tmp := z0
			z0 = z1
			z1 = tmp
		# la travée s'arrête contre les culées (largeur 2,4 m)
		var za := z0 + (1.2 if i > 0 else 0.0)
		var zb := z1 - 1.2
		var zc := (za + zb) * 0.5
		var hw := minf(2.3, (zb - za) * 0.5 - 0.7)
		w.ao = 0.95
		if hw < 0.7:
			w.box(Vector3(D * 0.5, AISLE_TOP * 0.5, zc), Vector3(D, AISLE_TOP, zb - za), 63 & ~2)
			continue
		var wy0 := 3.6
		var spring := 10.2
		var rise := hw * 1.2
		w.wall_bay(za, zb, 0.0, AISLE_TOP, zc, hw, wy0, spring, rise, 0.0, D)
		w.ao = 0.7
		w.tracery(zc, hw, wy0, spring, rise, 0.08, 0.24, 3)
		w.ao = 0.9
		w.arch_ring(zc, spring, hw, rise, 0.0, 0.2, D, D + 0.15, 10)
		w.box(Vector3(D + 0.1, wy0 - 0.15, zc), Vector3(0.26, 0.3, hw * 2.0 + 0.5), 63)
		var gl := PackedVector2Array([Vector2(zc - hw, wy0)])
		gl.append_array(GeoBuilder.pointed_arch(zc, spring, hw, rise, 10))
		gl.append(Vector2(zc + hw, wy0))
		g.extrude(gl, 0.14, 0.16)
	var zA := _wz(NAVE_S0, sd)
	var zB := _wz(9.0, sd)
	var zm := (zA + zB) * 0.5
	var L := absf(zB - zA)
	w.ao = 0.75
	w.box(Vector3(D + 0.15, 0.4, zm), Vector3(0.3, 0.8, L), 63)          # soubassement
	w.ao = 0.9
	w.box(Vector3(D + 0.2, AISLE_TOP - 0.25, zm), Vector3(0.5, 0.5, L), 63)  # corniche
	var xf := _wall_xf(tf, sd)
	stone.append_xf(w, xf)
	glass.append_xf(g, xf)
	# corniche et balustrade sur toute la longueur des bas-côtés (au-dessus des chapelles aussi)
	stone.ao = 0.9
	var tb := tf + sd * 0.3
	stone.balustrade(Vector3(NAVE_S0 + 0.3, AISLE_TOP, tb), Vector3(NAVE_S1 - 0.3, AISLE_TOP, tb), 0.95, 0.5, 0.3)
	stone.box(Vector3((NAVE_S0 + NAVE_S1) * 0.5, AISLE_TOP - 0.1, tb), Vector3(NAVE_S1 - NAVE_S0, 0.25, 0.6), 63)

func _lean_to(sd: float) -> void:
	var t_out: float = (AISLE_T[0] if sd < 0.0 else AISLE_T[1]) + sd * 0.05
	var t_in := (CLER_T - 0.02) * sd
	roof.ao = 1.0
	var a := Vector3(NAVE_S0, LEAN_LOW, t_out)
	var b := Vector3(NAVE_S1, LEAN_LOW, t_out)
	var c := Vector3(NAVE_S1, LEAN_HIGH, t_in)
	var d := Vector3(NAVE_S0, LEAN_HIGH, t_in)
	roof.quad(a, b, c, d, Vector3(0.0, 1.0, sd * 0.4))
	# rives : bandeau de pierre sous le bord de l'appentis
	stone.ao = 0.8
	stone.extrude(PackedVector2Array([Vector2(t_out, LEAN_LOW - 0.9), Vector2(t_out, LEAN_LOW), Vector2(t_in, LEAN_HIGH), Vector2(t_in, LEAN_HIGH - 0.9)]), NAVE_S1 - 0.4, NAVE_S1, true)

# ----------------------------------------------------------------- culées, pinacles, gargouilles, arcs-boutants
func _pier(s: float, sd: float, on_chapel: bool) -> void:
	var t_in := 18.9 * sd
	var y_base := 11.3 if on_chapel else 0.0
	var tiers := [[y_base, 8.0, 3.9], [8.0, 15.2, 3.5], [15.2, 21.5, 3.0]]
	for k in tiers.size():
		var tr: Array = tiers[k]
		var y0: float = tr[0]
		var y1: float = tr[1]
		if y1 <= y_base + 0.1:
			continue
		y0 = maxf(y0, y_base)
		var depth: float = tr[2]
		var t0 := t_in
		var t1 := t_in + depth * sd
		stone.ao = 0.95
		stone.box(Vector3(s, (y0 + y1) * 0.5, (t0 + t1) * 0.5), Vector3(2.3 - 0.15 * k, y1 - y0, absf(t1 - t0)), 63 & ~8)
		# glacis : pente vers l'extérieur au haut de chaque retrait
		if k < tiers.size() - 1:
			var tn := t_in + float(tiers[k + 1][2]) * sd
			var hw := (2.3 - 0.15 * k) * 0.5
			stone.ao = 1.0
			stone.quad(Vector3(s - hw, y1, t1), Vector3(s + hw, y1, t1), Vector3(s + hw, y1 + 0.9, tn), Vector3(s - hw, y1 + 0.9, tn), Vector3(0.0, 1.0, sd))
			stone.tri(Vector3(s - hw, y1, t1), Vector3(s - hw, y1 + 0.9, tn), Vector3(s - hw, y1, tn), Vector3(-1, 0, 0))
			stone.tri(Vector3(s + hw, y1, t1), Vector3(s + hw, y1 + 0.9, tn), Vector3(s + hw, y1, tn), Vector3(1, 0, 0))
	# niche à statue sur la face extérieure du deuxième étage
	var tface := t_in + 3.5 * sd
	stone.ao = 0.5
	stone.box(Vector3(s, 11.4, tface + 0.02 * sd), Vector3(1.2, 2.6, 0.06), 63)
	# pinacle sur la culée
	var tp := t_in + 1.5 * sd
	stone.ao = 0.95
	stone.pinnacle(s, tp, 1.5, 21.5, 24.8, 29.5)
	# pinacles d'angle plus petits
	for dz in [-0.7, 0.7]:
		stone.pinnacle(s + float(dz), t_in + 2.75 * sd, 0.45, 21.5, 22.6, 24.0)
	# gargouille sous la corniche des bas-côtés, sur la face extérieure
	stone.ao = 0.85
	stone.gargoyle(Vector3(s, 14.4, t_in + 3.5 * sd), Vector3(0, 0, sd), 2.1)

func _flyers(s: float, sd: float) -> void:
	# deux volées : de la culée (|t| 18,9) au contrefort du mur haut (|t| 9,95) ; polygone dans le plan (t, y), extrudé le long de s
	var t_a := 18.9 * sd
	var t_b := (CLER_T + CLER_D + 0.75) * sd
	for fl in [[17.6, 22.6, 1.0], [23.0, 30.4, 0.85]]:
		var ya: float = fl[0]
		var yb: float = fl[1]
		var th: float = fl[2]
		var n := 10
		var top := PackedVector2Array()
		var bot := PackedVector2Array()
		for i in range(n + 1):
			var f := float(i) / n
			var t := lerpf(t_a, t_b, f)
			var yl := lerpf(ya, yb, f)
			# intrados : arc qui creuse sous la droite (flèche 1,6 m au milieu)
			var sag := 1.7 * sin(f * PI) * (1.0 - 0.25 * f)
			top.append(Vector2(t, yl + th + 0.35))
			bot.append(Vector2(t, yl - sag))
		var poly := PackedVector2Array()
		poly.append_array(top)
		for i in range(n, -1, -1):
			poly.append(bot[i])
		stone.ao = 0.9
		stone.extrude(poly, s - 0.38, s + 0.38)
		# chaperon (rigole) un peu plus large
		var cap := PackedVector2Array()
		for i in range(n + 1):
			cap.append(top[i])
		for i in range(n, -1, -1):
			cap.append(top[i] - Vector2(0.0, 0.22))
		stone.ao = 0.8
		stone.extrude(cap, s - 0.48, s + 0.48)
		# remplage ajouré entre intrados et chaperon de la volée haute (quatre petits arcs)
		if ya > 20.0:
			for k in range(1, 5):
				var f := float(k) / 5.0
				var t := lerpf(t_a, t_b, f)
				var yl := lerpf(ya, yb, f)
				stone.ao = 0.75
				stone.box(Vector3(s, yl - 0.7 * sin(f * PI) + 0.2, t), Vector3(0.3, 1.2 * sin(f * PI) + 0.4, 0.22), 63)

# ----------------------------------------------------------------- comble de la nef
func _nave_roof() -> void:
	roof.ao = 1.0
	for sd in [-1.0, 1.0]:
		roof.quad(Vector3(NAVE_S0, EAVE_Y, EAVE_T * sd), Vector3(NAVE_S1, EAVE_Y, EAVE_T * sd), Vector3(NAVE_S1, RIDGE_Y, 0.0), Vector3(NAVE_S0, RIDGE_Y, 0.0), Vector3(0.0, 1.0, sd))
		# sous-face de l'égout
		stone.ao = 0.6
		stone.quad(Vector3(NAVE_S0, EAVE_Y - 0.05, EAVE_T * sd), Vector3(NAVE_S1, EAVE_Y - 0.05, EAVE_T * sd), Vector3(NAVE_S1, EAVE_Y - 0.05, (CLER_T - 0.1) * sd), Vector3(NAVE_S0, EAVE_Y - 0.05, (CLER_T - 0.1) * sd), Vector3.DOWN)
	# pignon de pierre côté croisée
	stone.ao = 0.9
	stone.extrude(PackedVector2Array([Vector2(-EAVE_T, EAVE_Y - 0.5), Vector2(EAVE_T, EAVE_Y - 0.5), Vector2(0.0, RIDGE_Y + 0.4)]), NAVE_S1 - 0.6, NAVE_S1, true)
	# crête de faîtage en fer (fleurons)
	roof.ao = 0.7
	roof.box(Vector3((NAVE_S0 + NAVE_S1) * 0.5, RIDGE_Y + 0.08, 0.0), Vector3(NAVE_S1 - NAVE_S0, 0.2, 0.3), 63)
	var n := int((NAVE_S1 - NAVE_S0) / 1.2)
	for k in n:
		var s := NAVE_S0 + 0.6 + k * 1.2
		roof.box(Vector3(s, RIDGE_Y + 0.55, 0.0), Vector3(0.06, 0.8, 0.06), 63)
		roof.box(Vector3(s, RIDGE_Y + 0.62, 0.0), Vector3(0.36, 0.06, 0.06), 63)
		roof.box(Vector3(s, RIDGE_Y + 0.95, 0.0), Vector3(0.16, 0.16, 0.16), 63)
	# lucarnes de comble (petites, deux par versant)
	for sd in [-1.0, 1.0]:
		for s in [-12.0, 14.0]:
			_roof_dormer(s, sd, 37.0)

func _roof_dormer(s: float, sd: float, y: float) -> void:
	var f := (y - EAVE_Y) / (RIDGE_Y - EAVE_Y)
	var t := EAVE_T * (1.0 - f) * sd
	stone.ao = 0.9
	var w := 1.2
	var h := 1.6
	var b := GeoBuilder.new()
	b.ao = 0.9
	# face avant (plan s, y) de la lucarne, extrudée vers l'intérieur du toit
	var poly := PackedVector2Array([Vector2(-w, -0.6), Vector2(w, -0.6), Vector2(w, h), Vector2(0.0, h + 1.1), Vector2(-w, h)])
	b.extrude(poly, -1.6, 0.0, true)
	b.ao = 0.4
	b.box(Vector3(0.02, 0.55, 0.0), Vector3(0.06, 1.5, 1.2), 63)
	var xf := Transform3D(Basis(Vector3(0, 0, sd), Vector3.UP, Vector3(-sd, 0, 0)), Vector3(s, y, t))
	stone.append_xf(b, xf)

# ----------------------------------------------------------------- massif occidental : flancs et face est
func _massif_side(sd: float) -> void:
	var tf := MASSIF_T * sd
	var w := GeoBuilder.new()
	var g := GeoBuilder.new()
	var D := 0.5
	var y0 := 8.0
	var cuts := [-50.6, -44.2, -37.4, -30.6, -26.4]
	for i in range(cuts.size() - 1):
		var z0 := _wz(float(cuts[i]), sd)
		var z1 := _wz(float(cuts[i + 1]), sd)
		if z0 > z1:
			var tmp := z0
			z0 = z1
			z1 = tmp
		var zc := (z0 + z1) * 0.5
		var hw := minf(1.6, (z1 - z0) * 0.5 - 1.2)
		# trois étages de lancettes séparés par les cordons de la façade ouest
		var levels := [[y0, 18.0, 10.2, 15.0], [18.0, 33.5, 22.0, 29.5], [33.5, 47.5, 36.0, 43.0], [47.5, MASSIF_TOP, 50.5, 59.5]]
		for lv: Array in levels:
			var ya: float = lv[0]
			var yb: float = lv[1]
			var wy0: float = lv[2]
			var spring: float = lv[3]
			var rise := hw * 1.4
			if hw < 0.6:
				w.ao = 0.95
				w.box(Vector3(D * 0.5, (ya + yb) * 0.5, zc), Vector3(D, yb - ya, z1 - z0), 63 & ~2)
				continue
			w.ao = 0.95
			w.wall_bay(z0, z1, ya, yb, zc, hw, wy0, spring, rise, 0.0, D)
			w.ao = 0.65
			w.tracery(zc, hw, wy0, spring, rise, 0.12, 0.34, 2)
			w.ao = 0.9
			w.arch_ring(zc, spring, hw, rise, 0.0, 0.2, D, D + 0.16, 10)
			var gl := PackedVector2Array([Vector2(zc - hw, wy0)])
			gl.append_array(GeoBuilder.pointed_arch(zc, spring, hw, rise, 10))
			gl.append(Vector2(zc + hw, wy0))
			g.extrude(gl, 0.2, 0.22)
			# « cordes de harpe » : meneaux libres devant le mur, de part et d'autre de la baie
			w.ao = 0.85
			for dz in [-hw - 0.7, hw + 0.7]:
				w.box(Vector3(D + 0.35, (ya + yb) * 0.5, zc + float(dz)), Vector3(0.24, yb - ya, 0.2), 63 & ~4 & ~8)
	# contreforts (sauf l'angle ouest, déjà dans la peau de la façade)
	for s in [-44.2, -37.4, -30.6]:
		var z := _wz(float(s), sd)
		for k in 4:
			var ya := y0 + k * 14.8
			var yb := minf(MASSIF_TOP, ya + 14.8)
			w.ao = 0.95
			w.box(Vector3(D + 0.7 - 0.15 * k, (ya + yb) * 0.5, z), Vector3(1.4 - 0.3 * k, yb - ya, 1.9 - 0.2 * k), 63 & ~2 & ~8)
		w.pinnacle(D + 0.5, z, 1.0, MASSIF_TOP, MASSIF_TOP + 2.0, MASSIF_TOP + 5.2)
	# cordons d'étage
	for y in [18.0, 33.5, 47.5]:
		w.ao = 0.85
		w.box(Vector3(D + 0.25, y, _wz(-38.5, sd)), Vector3(0.5, 0.5, 24.2), 63)
	w.ao = 0.75
	w.box(Vector3(D + 0.3, y0 + 0.1, _wz(-38.5, sd)), Vector3(0.6, 0.4, 24.2), 63)   # larmier au-dessus du porche
	w.ao = 0.9
	w.box(Vector3(D + 0.3, MASSIF_TOP - 0.3, _wz(-38.5, sd)), Vector3(0.6, 0.6, 24.2), 63)
	var xf := _wall_xf(tf, sd)
	stone.append_xf(w, xf)
	glass.append_xf(g, xf)

func _massif_east() -> void:
	var s0 := MASSIF_S[1] - 0.05
	var poly := PackedVector2Array([
		Vector2(-MASSIF_T, 15.0), Vector2(-20.2, 15.0), Vector2(-9.6, LEAN_HIGH), Vector2(-EAVE_T, EAVE_Y), Vector2(0.0, RIDGE_Y),
		Vector2(EAVE_T, EAVE_Y), Vector2(9.6, LEAN_HIGH), Vector2(20.2, 15.0), Vector2(MASSIF_T, 15.0),
		Vector2(MASSIF_T, MASSIF_TOP), Vector2(-MASSIF_T, MASSIF_TOP)])
	stone.ao = 0.95
	stone.extrude(poly, s0, s0 + 0.45, true)
	# arc aveugle au-dessus du comble et cordons
	stone.ao = 0.55
	stone.arch_fill(0.0, 47.5, 7.5, 9.0, s0 + 0.45, s0 + 0.55, 12)
	stone.ao = 0.9
	stone.arch_ring(0.0, 47.5, 7.5, 9.0, 0.0, 0.5, s0 + 0.45, s0 + 0.85, 12)
	for y in [47.5, 62.0]:
		stone.box(Vector3(s0 + 0.65, y, 0.0), Vector3(0.4, 0.45, MASSIF_T * 2.0), 63)
	stone.box(Vector3(s0 + 0.7, MASSIF_TOP - 0.3, 0.0), Vector3(0.5, 0.6, MASSIF_T * 2.0), 63)
