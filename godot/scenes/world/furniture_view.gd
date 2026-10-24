extends Node3D
## v0.33.1 : mobilier urbain ajouté (sim/street_furniture.gd, data/street_furniture.json) : modèles construits par code, une MultiMesh par sorte et
## par maille de 160 m (culling et portée par maille), ombres portées. Les lanternes des lampadaires s'allument la nuit (groupe « sky_listener »,
## comme la cathédrale) : verre émissif seulement, pas de lumière dynamique en plus.
## Repère d'un modèle : origine au sol au milieu de l'emprise, largeur le long de x, profondeur le long de z, face avant (assise, guichet) vers +z.

const GeoBuilder := preload("res://scenes/world/geo_builder.gd")
static var SHADER: Shader:
	get: return load("res://shaders/furniture.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
const CELL := 160.0
const RANGE := {"bench": 120.0, "bin": 90.0, "bollard": 80.0, "lamp": 170.0, "barrier": 100.0, "kiosk": 200.0, "column": 200.0}

var mat: ShaderMaterial
var counts: Dictionary = {}     ## sorte -> nombre d'objets dessinés
var triangles: Dictionary = {}  ## sorte -> triangles du modèle

static func _col(id: int, ao := 1.0) -> Color:
	return Color(1.0, ao, 1.0, (float(id) + 0.25) / 8.0)

## Modèle d'une sorte (GeoBuilder : triangles, couleur de sommet = partie).
static func build_mesh(kind: String) -> ArrayMesh:
	return builder(kind).build()

## Constructeur rempli (sommets lisibles par les tests : la partie visible doit tenir dans la collision).
static func builder(kind: String) -> GeoBuilder:
	var g := GeoBuilder.new()
	match kind:
		"bench":
			_bench(g)
		"bin":
			_bin(g)
		"bollard":
			_bollard(g)
		"lamp":
			_lamp(g)
		"barrier":
			_barrier(g)
		"kiosk":
			_kiosk(g)
		"column":
			_column(g)
	return g

## Banc : deux flasques de fonte, assise de 5 lattes, dossier de 3 lattes incliné vers l'arrière (-z), accoudoirs.
static func _bench(g: GeoBuilder) -> void:
	for sx in [-0.78, 0.78]:
		g.paint = _col(0, 0.8)
		g.box(Vector3(sx, 0.22, 0.17), Vector3(0.06, 0.44, 0.07))     # pied avant
		g.box(Vector3(sx, 0.22, -0.2), Vector3(0.06, 0.44, 0.07))     # pied arrière
		g.box(Vector3(sx, 0.43, -0.01), Vector3(0.06, 0.05, 0.52))     # traverse sous l'assise
		g.box(Vector3(sx, 0.05, -0.01), Vector3(0.07, 0.04, 0.56))     # semelle
		g.box(Vector3(sx, 0.62, 0.12), Vector3(0.06, 0.04, 0.34))      # accoudoir
		g.box(Vector3(sx, 0.53, 0.25), Vector3(0.05, 0.18, 0.04))
		# montant du dossier, incliné
		var a := Vector3(sx, 0.42, -0.19)
		var b := Vector3(sx, 0.88, -0.25)
		g.quad(a + Vector3(-0.03, 0, 0), b + Vector3(-0.03, 0, 0), b + Vector3(-0.03, 0, -0.05), a + Vector3(-0.03, 0, -0.05), Vector3.LEFT)
		g.quad(a + Vector3(0.03, 0, 0), b + Vector3(0.03, 0, 0), b + Vector3(0.03, 0, -0.05), a + Vector3(0.03, 0, -0.05), Vector3.RIGHT)
		g.quad(a + Vector3(-0.03, 0, 0), a + Vector3(0.03, 0, 0), b + Vector3(0.03, 0, 0), b + Vector3(-0.03, 0, 0), Vector3.BACK)
		g.quad(a + Vector3(-0.03, 0, -0.05), a + Vector3(0.03, 0, -0.05), b + Vector3(0.03, 0, -0.05), b + Vector3(-0.03, 0, -0.05), Vector3.FORWARD)
	g.paint = _col(1)
	for i in 5:
		var z := 0.22 - i * 0.1
		g.box(Vector3(0, 0.47, z), Vector3(1.8, 0.035, 0.075))
	for i in 3:
		var y := 0.58 + i * 0.11
		var z := -0.235 - i * 0.02
		g.box(Vector3(0, y, z), Vector3(1.8, 0.085, 0.03))

## Corbeille : poteau anthracite, panier cylindrique vert ajouré (lattes verticales), cerclage galvanisé, couvercle.
static func _bin(g: GeoBuilder) -> void:
	g.paint = _col(6, 0.85)
	g.box(Vector3(0, 0.55, -0.24), Vector3(0.07, 1.1, 0.07))
	g.box(Vector3(0, 0.02, -0.24), Vector3(0.16, 0.04, 0.16))
	g.paint = _col(0)
	g.prism(0, 0, 0.23, 0.25, 0.3, 0.95, 14, 0.0, false)
	g.paint = _col(6, 0.4)
	g.prism(0, 0, 0.2, 0.2, 0.31, 0.32, 14, 0.0, true)   # fond
	g.paint = _col(2)
	g.prism(0, 0, 0.26, 0.26, 0.9, 0.97, 14, 0.0, false)
	g.prism(0, 0, 0.245, 0.245, 0.34, 0.39, 14, 0.0, false)
	g.paint = _col(0, 0.9)
	g.prism(0, 0, 0.27, 0.12, 0.97, 1.04, 14, 0.0, true)  # couvercle bombé (ouverture au centre)

## Borne : fût anthracite qui s'affine, tête galvanisée, bande rouge et blanche.
static func _bollard(g: GeoBuilder) -> void:
	g.paint = _col(6, 0.85)
	g.prism(0, 0, 0.12, 0.1, 0.0, 0.78, 10)
	g.paint = _col(7)
	g.prism(0, 0, 0.102, 0.1, 0.78, 0.86, 10, 0.0, false)
	g.paint = _col(2)
	g.prism(0, 0, 0.11, 0.11, 0.86, 0.9, 10, 0.0, false)
	g.spire(0, 0, 0.11, 0.9, 0.97, 10)

## Lampadaire de style ancien : socle, fût cannelé qui s'affine, crosse, lanterne à verre (allumée la nuit), chapeau.
static func _lamp(g: GeoBuilder) -> void:
	g.paint = _col(6, 0.8)
	g.prism(0, 0, 0.17, 0.14, 0.0, 0.55, 8)
	g.prism(0, 0, 0.15, 0.15, 0.55, 0.62, 8, 0.0, true)
	g.paint = _col(6)
	g.prism(0, 0, 0.075, 0.05, 0.62, 3.9, 8)
	g.prism(0, 0, 0.08, 0.08, 1.8, 1.86, 8, 0.0, false)
	g.prism(0, 0, 0.065, 0.11, 3.9, 4.05, 8)              # chapiteau
	g.paint = _col(6, 0.9)
	g.prism(0, 0, 0.1, 0.16, 4.05, 4.12, 8)               # assise de la lanterne
	g.paint = _col(3)
	g.prism(0, 0, 0.13, 0.21, 4.12, 4.55, 6, PI / 6.0, false)
	g.paint = _col(6)
	for i in 6:   # montants de la lanterne
		var a := PI / 6.0 + TAU * i / 6.0
		g.box(Vector3(cos(a) * 0.17, 4.33, sin(a) * 0.17), Vector3(0.02, 0.44, 0.02))
	g.prism(0, 0, 0.24, 0.24, 4.55, 4.6, 6, PI / 6.0, true)
	g.spire(0, 0, 0.24, 4.6, 4.82, 6, PI / 6.0)
	g.prism(0, 0, 0.02, 0.0, 4.82, 4.92, 6)

## Barrière de ville (type Vauban) : cadre de tubes galvanisés, barreaux verticaux, deux pieds plats perpendiculaires.
static func _barrier(g: GeoBuilder) -> void:
	g.paint = _col(2)
	g.box(Vector3(0, 1.08, 0), Vector3(2.0, 0.04, 0.04))
	g.box(Vector3(0, 0.22, 0), Vector3(2.0, 0.04, 0.04))
	for sx in [-0.98, 0.98]:
		g.box(Vector3(sx, 0.62, 0), Vector3(0.045, 0.98, 0.045))
		g.box(Vector3(sx * 0.93, 0.03, 0), Vector3(0.06, 0.04, 0.56))   # pied
		g.box(Vector3(sx * 0.93, 0.12, 0), Vector3(0.03, 0.18, 0.03))
	var n := 15
	for i in n:
		var x := lerpf(-0.86, 0.86, float(i) / (n - 1))
		g.box(Vector3(x, 0.65, 0), Vector3(0.018, 0.84, 0.018))
	g.paint = _col(7)   # plaque centrale (en bas : bande rouge et blanche)
	g.box(Vector3(0, 0.62, 0.012), Vector3(0.5, 0.22, 0.008))

## Kiosque à journaux octogonal (dans l'emprise du cercle de collision de 1,3 m) : socle de béton, caisse vert sombre, guichet à volets de bois
## et tablette (avant, +z), bandeau d'affiches, toit de zinc débordant (au-dessus de 2,3 m : on passe dessous), épi.
static func _kiosk(g: GeoBuilder) -> void:
	var rot := PI / 8.0
	var ap := cos(PI / 8.0)   # apothème d'un octogone de rayon 1
	g.paint = _col(4, 0.7)
	g.prism(0, 0, 1.3, 1.3, 0.0, 0.16, 8, rot)
	g.paint = _col(0, 0.85)
	g.prism(0, 0, 1.2, 1.2, 0.16, 1.95, 8, rot, false)
	g.paint = _col(1, 0.9)   # volets du guichet sur la face avant (+z)
	g.box(Vector3(0, 1.25, 1.2 * ap + 0.015), Vector3(0.82, 0.9, 0.03))
	g.paint = _col(6)
	g.box(Vector3(0, 0.8, 1.2 * ap + 0.05), Vector3(0.84, 0.05, 0.1))    # tablette
	g.box(Vector3(0, 1.73, 1.2 * ap + 0.025), Vector3(0.9, 0.05, 0.04))
	for i in 8:   # montants aux angles
		var a := rot + TAU * i / 8.0
		g.box(Vector3(cos(a) * 1.2, 1.05, sin(a) * 1.2), Vector3(0.07, 1.8, 0.07))
	g.paint = _col(5)
	g.prism(0, 0, 1.24, 1.24, 1.95, 2.35, 8, rot, false)   # bandeau d'affiches
	g.paint = _col(7)
	g.prism(0, 0, 1.24, 1.62, 2.35, 2.45, 8, rot, false)   # débord du toit
	g.prism(0, 0, 1.62, 1.62, 2.45, 2.5, 8, rot, false)
	g.spire(0, 0, 1.62, 2.5, 3.05, 8, rot)
	g.paint = _col(0)
	g.prism(0, 0, 0.05, 0.0, 3.0, 3.35, 6)

## Colonne d'affichage (type Morris) : socle, fût couvert d'affiches, corniche, dôme à côtes et épi.
static func _column(g: GeoBuilder) -> void:
	g.paint = _col(0, 0.75)
	g.prism(0, 0, 0.62, 0.6, 0.0, 0.32, 16)
	g.paint = _col(5)
	g.prism(0, 0, 0.56, 0.56, 0.32, 2.55, 16, 0.0, false)
	g.paint = _col(0)
	g.prism(0, 0, 0.6, 0.66, 2.55, 2.72, 16, 0.0, false)
	g.prism(0, 0, 0.66, 0.6, 2.72, 2.8, 16, 0.0, false)
	g.prism(0, 0, 0.6, 0.45, 2.8, 3.05, 16, 0.0, false)
	g.prism(0, 0, 0.45, 0.2, 3.05, 3.25, 16, 0.0, false)
	g.spire(0, 0, 0.2, 3.25, 3.36, 16)
	g.prism(0, 0, 0.035, 0.0, 3.36, 3.62, 6)

func setup(items: Array) -> void:
	name = "Mobilier"
	add_to_group("sky_listener")
	mat = ShaderMaterial.new()
	mat.shader = SHADER
	var by_kind := {}
	for it: Dictionary in items:
		var k := String(it["kind"])
		if not by_kind.has(k):
			by_kind[k] = []
		by_kind[k].append(it)
	for kind: String in by_kind:
		var gb := builder(kind)
		var mesh := gb.build()
		triangles[kind] = gb.triangle_count()
		var lst: Array = by_kind[kind]
		counts[kind] = lst.size()
		var cells := {}
		for it: Dictionary in lst:
			var key := Vector2i(floori(float(it["x"]) / CELL), floori(float(it["z"]) / CELL))
			if not cells.has(key):
				cells[key] = []
			cells[key].append(it)
		for key: Vector2i in cells:
			var ids: Array = cells[key]
			var c0 := Vector3((key.x + 0.5) * CELL, 0.0, (key.y + 0.5) * CELL)
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = mesh
			mm.instance_count = ids.size()
			for j in ids.size():
				var it: Dictionary = ids[j]
				var p := Vector3(float(it["x"]), float(it.get("y", 0.0)), float(it["z"]))
				mm.set_instance_transform(j, Transform3D(Basis(Vector3.UP, float(it["yaw"])), p - c0))
				var hsh := absi(hash(Vector2i(roundi(p.x * 10.0), roundi(p.z * 10.0))))
				mm.set_instance_custom_data(j, Color(float(hsh % 1000) / 1000.0, float((hsh / 1000) % 1000) / 1000.0, 0.0, 0.0))
			var mi := MultiMeshInstance3D.new()
			mi.multimesh = mm
			mi.material_override = mat
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			mi.position = c0
			mi.visibility_range_end = float(RANGE.get(kind, 120.0)) + CELL * 0.5
			add_child(mi)

## Ciel (graphics_view.gd) : lanternes allumées la nuit.
func on_sky_k(k: float) -> void:
	_last_k = k
	if mat != null:
		mat.set_shader_parameter("night", clampf(1.0 - k * 1.6, 0.0, 1.0))

var _gv: Node
var _last_k := -1.0

## Le graphics_view peut être prêt après la carte : on relit son sky_k (comme cathedral_view.gd).
func _process(_dt: float) -> void:
	if _gv == null:
		_gv = get_tree().get_first_node_in_group("graphics_view")
		return
	var k: float = _gv.sky_k
	if not is_equal_approx(k, _last_k):
		on_sky_k(k)
