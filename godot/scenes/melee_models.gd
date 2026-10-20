class_name MeleeModels
extends RefCounted
## v0.20.7 : couteau de combat et Hache du Bourreau tenus en vue à la première personne. Maillages procéduraux (lames extrudées par sections, garde, manche, pommeau :
## aucun asset externe, aucune licence), même couche de rendu que les armes (VIEW_LAYER) et même émission douce. Repère local : l'origine est le centre de la prise
## (le poing de HandsRig.make_fist y est posé), la lame part vers -Z, le fil vers -Y (le couteau), le tranchant de la hache vers -Y.
## Les poses sont des fonctions pures du temps du coup : `pose(axe, t, hit, anim)` ; l'impact visuel tombe à t = hit (hitDelay de la simulation, qui frappe à cet instant).

const WeaponModels := preload("res://scenes/weapon_models.gd")
const HandsRig := preload("res://scenes/hands_rig.gd")

static var _mats: Dictionary = {}

static func _mat(kind: String) -> StandardMaterial3D:
	if _mats.has(kind):
		return _mats[kind]
	var table: Dictionary = {
		"steel": [Color("c9ced3"), 0.75, 0.32, 0.20], "dark_steel": [Color("5d6268"), 0.7, 0.4, 0.2],
		"brass": [Color("a8873a"), 0.6, 0.4, 0.2], "grip": [Color("2b2622"), 0.0, 0.85, 0.15], "wood": [Color("5a3f28"), 0.0, 0.8, 0.2],
	}
	var spec: Array = table[kind]
	var m := StandardMaterial3D.new()
	m.albedo_color = spec[0]
	m.metallic = spec[1]
	m.roughness = spec[2]
	m.emission_enabled = true   # la nuit le monde éclaire peu la vue : l'émission garde la forme lisible (comme les armes)
	m.emission = spec[0]
	m.emission_energy_multiplier = spec[3]
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mats[kind] = m
	return m

## Solide par sections : `rings` = liste de boucles (PackedVector3Array de même taille) ; quadrilatères entre sections voisines, extrémités bouchées en éventail.
static func _loft(rings: Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1)   # facettes plates : style low-poly des armes
	var n: int = rings[0].size()
	for r in rings.size() - 1:
		var a: PackedVector3Array = rings[r]
		var b: PackedVector3Array = rings[r + 1]
		for i in n:
			var j := (i + 1) % n
			st.add_vertex(a[i]); st.add_vertex(b[i]); st.add_vertex(b[j])
			st.add_vertex(a[i]); st.add_vertex(b[j]); st.add_vertex(a[j])
	for end: PackedVector3Array in [rings[0], rings[rings.size() - 1]]:
		var c := Vector3.ZERO
		for p in end:
			c += p
		c /= float(n)
		for i in n:
			st.add_vertex(c); st.add_vertex(end[i]); st.add_vertex(end[(i + 1) % n])
	st.generate_normals()
	return st.commit()

static func _inst(parent: Node3D, mesh: Mesh, mat: String, pos := Vector3.ZERO, rot := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _mat(mat)
	mi.layers = WeaponModels.VIEW_LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = pos
	mi.rotation = rot
	mi.scale = scl
	parent.add_child(mi)
	return mi

static func _cyl(r_top: float, r_bot: float, h: float, seg := 10) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r_top
	c.bottom_radius = r_bot
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	return c

static func _box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(x, y, z)
	return b

## Lame de couteau : dos plat (épais), fil en bas (mince), pointe « drop point » ; sections [z, dos y, fil y, demi-épaisseur du dos].
static func _blade() -> ArrayMesh:
	var s: Array = [[-0.055, 0.0135, -0.0135, 0.0042], [-0.12, 0.0135, -0.0145, 0.0040], [-0.18, 0.0125, -0.0135, 0.0036],
		[-0.222, 0.0095, -0.0095, 0.0030], [-0.255, 0.0045, -0.0030, 0.0018], [-0.272, 0.0, 0.0, 0.0]]
	var rings: Array = []
	for k: Array in s:
		rings.append(PackedVector3Array([Vector3(k[3], k[1], k[0]), Vector3(-k[3], k[1], k[0]), Vector3(0.0, k[2], k[0])]))
	return _loft(rings)

## Couteau : lame, garde laiton, manche cranté, pommeau. Origine = centre du manche.
static func build_knife() -> Node3D:
	var k := Node3D.new()
	k.name = "Knife"
	_inst(k, _blade(), "steel")
	_inst(k, _box(0.0075, 0.006, 0.150), "dark_steel", Vector3(0.0, 0.0105, -0.13))   # gouttière sombre sur le dos de la lame
	_inst(k, _box(0.012, 0.050, 0.016), "brass", Vector3(0.0, 0.0, -0.058))             # garde
	_inst(k, _cyl(0.0155, 0.0145, 0.116, 8), "grip", Vector3(0.0, 0.0, 0.003), Vector3(PI / 2.0, 0.0, 0.0))   # manche
	for i in 3:
		_inst(k, _cyl(0.0172, 0.0172, 0.008, 8), "dark_steel", Vector3(0.0, 0.0, -0.026 + 0.026 * i), Vector3(PI / 2.0, 0.0, 0.0))   # bagues
	var pm := SphereMesh.new()
	pm.radius = 0.5
	pm.height = 1.0
	pm.radial_segments = 8
	pm.rings = 4
	_inst(k, pm, "brass", Vector3(0.0, 0.0, 0.066), Vector3.ZERO, Vector3(0.034, 0.034, 0.026))   # pommeau
	return k

## Tête de hache : sections de haut en bas [y, z min, z max, demi-épaisseur], le fil (y le plus bas) très mince.
static func _axe_head() -> ArrayMesh:
	var z0 := -0.08   # décalage de la tête le long du manche
	var s: Array = [[0.040, -0.322 + z0, -0.258 + z0, 0.018], [0.006, -0.340 + z0, -0.240 + z0, 0.0135],
		[-0.060, -0.372 + z0, -0.228 + z0, 0.0075], [-0.118, -0.392 + z0, -0.215 + z0, 0.0015]]
	var rings: Array = []
	for k: Array in s:
		rings.append(PackedVector3Array([Vector3(k[3], k[0], k[1]), Vector3(k[3], k[0], k[2]), Vector3(-k[3], k[0], k[2]), Vector3(-k[3], k[0], k[1])]))
	return _loft(rings)

## Hache du Bourreau : long manche de bois, tête lourde sombre à tranchant vers le bas, barbe. Origine = centre de la prise (le poing).
static func build_axe() -> Node3D:
	var a := Node3D.new()
	a.name = "Axe"
	_inst(a, _cyl(0.0145, 0.0165, 0.49, 8), "wood", Vector3(0.0, 0.0, -0.145), Vector3(PI / 2.0, 0.0, 0.0))   # manche
	_inst(a, _axe_head(), "dark_steel")
	_inst(a, _box(0.020, 0.030, 0.064), "steel", Vector3(0.0, 0.052, -0.38 + 0.0), Vector3.ZERO)   # dos de la tête (poll)
	_inst(a, _box(0.030, 0.050, 0.030), "dark_steel", Vector3(0.0, 0.0, -0.385))               # douille de l'œil
	var kn := SphereMesh.new()
	kn.radius = 0.5
	kn.height = 1.0
	kn.radial_segments = 8
	kn.rings = 4
	_inst(a, kn, "wood", Vector3(0.0, 0.0, 0.103), Vector3.ZERO, Vector3(0.036, 0.036, 0.030))   # talon
	return a

# ------------------------------------------------------------------ poses
## Clés [temps, position (repère caméra), rotation (euler)] : armement (haut, derrière, lame levée), IMPACT à t = hit, suite du geste, retrait. Temps relatifs : 0, hit, ~0,5 anim, 1.
const KNIFE_KEYS: Array = [
	[Vector3(0.30, -0.08, -0.38), Vector3(0.90, -0.60, -0.30)],
	[Vector3(0.05, -0.14, -0.55), Vector3(0.45, 0.35, 0.10)],
	[Vector3(-0.18, -0.24, -0.50), Vector3(0.10, 0.90, 0.30)],
	[Vector3(0.30, -0.55, -0.25), Vector3(0.20, -0.20, 0.0)],
]
const AXE_KEYS: Array = [
	[Vector3(0.30, -0.12, -0.34), Vector3(1.05, -0.45, -0.55)],
	[Vector3(0.08, -0.22, -0.52), Vector3(0.05, 0.55, 0.45)],
	[Vector3(-0.14, -0.30, -0.46), Vector3(-0.35, 0.95, 0.55)],
	[Vector3(0.34, -0.60, -0.25), Vector3(0.10, -0.10, 0.0)],
]

## Pose de l'arme de mêlée à l'instant t du coup (t = melee_t de la simulation). t < hit : armement -> coup, accélère (impact en pleine vitesse) ; après : ralentit sur
## la suite du geste (jusqu'à `follow` s après l'impact), puis retour hors champ jusqu'à anim.
static func pose(axe: bool, t: float, hit: float, anim: float) -> Transform3D:
	var K: Array = AXE_KEYS if axe else KNIFE_KEYS
	var follow := hit + (0.16 if axe else 0.12)
	var p: Vector3
	var r: Vector3
	if t < hit:
		var s := clampf(t / hit, 0.0, 1.0)
		s *= s
		p = K[0][0].lerp(K[1][0], s)
		r = K[0][1].lerp(K[1][1], s)
	elif t < follow:
		var s2 := clampf((t - hit) / (follow - hit), 0.0, 1.0)
		s2 = 1.0 - (1.0 - s2) * (1.0 - s2)
		p = K[1][0].lerp(K[2][0], s2)
		r = K[1][1].lerp(K[2][1], s2)
	else:
		var s3 := smoothstep(0.0, 1.0, clampf((t - follow) / maxf(0.001, anim - follow), 0.0, 1.0))
		p = K[2][0].lerp(K[3][0], s3)
		r = K[2][1].lerp(K[3][1], s3)
	return Transform3D(Basis.from_euler(r), p)
