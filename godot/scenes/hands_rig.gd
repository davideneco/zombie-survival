class_name HandsRig
extends RefCounted
## v0.20.2 : bras et mains de la vue à la première personne, en maillages procéduraux low-poly (ellipsoïdes et capsules, gants sombres, manches kaki : même ton
## cartoon sobre que les zombies). Aucun asset externe, aucune licence. Les positions des mains de chaque arme viennent de data/weapon_models.json (clé "hands",
## produite par tools/gen-weapon-hands.py d'après le maillage de l'arme) :
##  - main arrière (droite) sur la poignée, main avant (gauche) sur le garde-main (ou, pour un pistolet, en soutien sous la poignée) ;
##  - les mains sont ENFANTS du modèle d'arme : elles suivent donc la pose à la hanche / en visée, le recul, le lever de l'arme au sprint et à l'enjambement ;
##  - rechargement : la main avant va chercher le chargeur (descend, remonte, claque, revient) ; coup de couteau : la main arrière quitte l'arme et tient le couteau ;
##    grenade : une main tend la grenade puis se retire.
## Les manches (avant-bras) vont du poignet à une épaule fixe dans le repère de la caméra : elles s'étirent à chaque image. Même couche de rendu que les armes (VIEW_LAYER :
## seule la lumière de vue les éclaire). Purement visuel : aucune lecture de la simulation sauf par weapon_view.gd.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const GLOVE := Color("201d1a")
const SLEEVE := Color("2a3022")
const CUFF := Color("141210")
## Épaules dans le repère de la caméra (x droite, y haut, z vers l'arrière) : hors champ, en bas de l'écran.
const SHOULDER_R := Vector3(0.36, -0.58, 0.10)
const SHOULDER_L := Vector3(-0.34, -0.52, 0.08)

static var _mats: Dictionary = {}
static var _meshes: Dictionary = {}

var root: Node3D
var rear: Node3D                    ## main arrière (droite), enfant de l'arme
var front: Node3D                   ## main avant (gauche)
var sleeve_r: MeshInstance3D
var sleeve_l: MeshInstance3D
var cuff_r: MeshInstance3D
var cuff_l: MeshInstance3D
var data: Dictionary = {}
var style := "rifle"
var _rear_home := Vector3.ZERO
var _front_home := Vector3.ZERO
var _mag := Vector3.ZERO
var _wrist_r := Vector3.ZERO        ## décalage du poignet par rapport à la main (repère de la main)
var _wrist_l := Vector3.ZERO
var rear_hidden := false            ## coup de couteau : la main arrière a quitté l'arme

# ------------------------------------------------------------------ matériaux et maillages partagés
static func material(kind: String) -> StandardMaterial3D:
	if _mats.has(kind):
		return _mats[kind]
	var c: Color = {"glove": GLOVE, "sleeve": SLEEVE, "cuff": CUFF, "nade": Color("2f3b1f")}[kind]
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.8
	m.metallic = 0.0
	m.emission_enabled = true   # comme les armes (weapon_models.gd) : la nuit, le monde éclaire peu la vue
	m.emission = c
	m.emission_energy_multiplier = 0.12
	_mats[kind] = m
	return m

static func _mesh(kind: String) -> Mesh:
	if _meshes.has(kind):
		return _meshes[kind]
	var m: Mesh
	match kind:
		"ball":
			var s := SphereMesh.new()
			s.radius = 0.5
			s.height = 1.0
			s.radial_segments = 10
			s.rings = 5
			m = s
		"finger":
			var c := CapsuleMesh.new()
			c.radius = 0.0105
			c.height = 0.05
			c.radial_segments = 8
			c.rings = 2
			m = c
		"thumb":
			var c2 := CapsuleMesh.new()
			c2.radius = 0.0118
			c2.height = 0.052
			c2.radial_segments = 8
			c2.rings = 2
			m = c2
		"sleeve":
			var cy := CylinderMesh.new()
			cy.top_radius = 0.034
			cy.bottom_radius = 0.030
			cy.height = 1.0
			cy.radial_segments = 10
			cy.rings = 1
			cy.cap_top = false
			cy.cap_bottom = false
			m = cy
		"cuff":
			var cf := CylinderMesh.new()
			cf.top_radius = 0.034
			cf.bottom_radius = 0.034
			cf.height = 0.034
			cf.radial_segments = 10
			cf.rings = 1
			m = cf
	_meshes[kind] = m
	return m

static func _part(parent: Node3D, kind: String, mat: String, pos: Vector3, scale := Vector3.ONE, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = _mesh(kind)
	mi.material_override = material(mat)
	mi.layers = WeaponModels.VIEW_LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = pos
	mi.scale = scale
	mi.rotation = rot
	parent.add_child(mi)
	return mi

# ------------------------------------------------------------------ mains
## Main droite sur une poignée verticale : origine = centre de la poignée ; paume derrière et à droite, quatre doigts qui l'entourent par devant, pouce à gauche, vers l'avant.
static func make_grip_hand() -> Node3D:
	var h := Node3D.new()
	_part(h, "ball", "glove", Vector3(0.020, 0.0, 0.030), Vector3(0.046, 0.072, 0.058))
	for i in 4:
		var y := 0.027 - 0.018 * i
		_part(h, "finger", "glove", Vector3(0.012, y, -0.017), Vector3(1.0, 1.0 - 0.06 * absf(i - 1.5), 1.0), Vector3(0, 0, PI / 2.0))
	_part(h, "thumb", "glove", Vector3(-0.024, 0.022, 0.004), Vector3.ONE, Vector3(PI / 2.0 + 0.15, 0, 0))
	_part(h, "ball", "glove", Vector3(-0.012, 0.016, 0.026), Vector3(0.03, 0.03, 0.034))   # base du pouce
	return h

## Main gauche sous un garde-main horizontal : origine = axe du garde-main, r = demi-épaisseur ; paume dessous, doigts remontant le côté droit, pouce à gauche.
static func make_cup_hand(r: float) -> Node3D:
	var h := Node3D.new()
	_part(h, "ball", "glove", Vector3(0.0, -(r + 0.012), 0.012), Vector3(0.064, 0.032, 0.080))
	for i in 4:
		var z := -0.014 + 0.019 * i
		_part(h, "finger", "glove", Vector3(r + 0.018, -r * 0.4, z), Vector3(1.0, 1.0 - 0.05 * absf(i - 1.5), 1.0), Vector3(0, 0, -0.18))
	_part(h, "thumb", "glove", Vector3(-(r + 0.016), 0.004, 0.012), Vector3.ONE, Vector3(PI / 2.0, 0, 0.1))
	return h

## Poing fermé sur un manche dirigé vers -Z (couteau, grenade) : origine = centre du manche.
static func make_fist() -> Node3D:
	var h := Node3D.new()
	_part(h, "ball", "glove", Vector3(0.0, 0.020, 0.0), Vector3(0.056, 0.036, 0.074))
	for i in 4:
		var z := -0.027 + 0.018 * i
		_part(h, "finger", "glove", Vector3(0.0, -0.010, z), Vector3(1.0, 1.0 - 0.05 * absf(i - 1.5), 1.0), Vector3(0, 0, PI / 2.0))
	_part(h, "thumb", "glove", Vector3(-0.026, 0.012, -0.010), Vector3.ONE, Vector3(PI / 2.0, 0, 0))
	return h

## Une manche (cylindre unitaire étiré poignet -> épaule) et son poignet-bracelet ; renvoie [manche, bracelet].
static func make_sleeve(parent: Node3D) -> Array:
	var s := _part(parent, "sleeve", "sleeve", Vector3.ZERO)
	var c := _part(parent, "cuff", "cuff", Vector3.ZERO)
	return [s, c]

## Place une manche entre deux points (repère du parent) ; le petit rayon est au poignet.
static func place_sleeve(sleeve: MeshInstance3D, cuff: MeshInstance3D, wrist: Vector3, shoulder: Vector3) -> void:
	var d := shoulder - wrist
	var len := d.length()
	if len < 0.01:
		return
	var y := d / len
	var xa := Vector3.UP.cross(y)
	if xa.length() < 0.05:
		xa = Vector3.RIGHT.cross(y)
	xa = xa.normalized()
	var za := xa.cross(y)
	# le cylindre a le grand rayon en haut (+Y) : +Y pointe vers l'épaule
	sleeve.transform = Transform3D(Basis(xa, y * len, za), (wrist + shoulder) * 0.5)
	cuff.transform = Transform3D(Basis(xa, y, za), wrist + y * 0.012)

# ------------------------------------------------------------------ montage sur une arme
## Construit les mains de l'arme `id` en enfants de `gun` (le modèle de l'arme). Sans entrée "hands" : rien.
func build(gun: Node3D, id: String) -> void:
	data = WeaponModels.hands(id)
	root = Node3D.new()
	root.name = "Hands"
	gun.add_child(root)
	if data.is_empty():
		return
	style = String(data["style"])
	var rp := _v(data["rear"]["pos"])
	var fp := _v(data["front"]["pos"])
	var fr := float(data["front"]["r"])
	_mag = _v(data["mag"])
	rear = make_grip_hand()
	rear.position = rp
	root.add_child(rear)
	front = make_cup_hand(fr)
	front.position = fp
	root.add_child(front)
	_rear_home = rp
	_front_home = fp
	_wrist_r = Vector3(0.034, -0.016, 0.066)
	_wrist_l = Vector3(-0.012, -(fr + 0.024), 0.082)
	var sr := make_sleeve(root)
	sleeve_r = sr[0]
	cuff_r = sr[1]
	var sl := make_sleeve(root)
	sleeve_l = sl[0]
	cuff_l = sl[1]

static func _v(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

## Une image : `gun_xf` = pose de l'arme dans la caméra (position + rotation de l'arme) ; reload_p : avancement du rechargement (0..1) ou -1 ; knife : le coup de couteau
## est en cours (la main arrière a quitté l'arme).
func update(gun_xf: Transform3D, reload_p: float, knife: bool) -> void:
	if root == null or data.is_empty():
		return
	rear_hidden = knife
	rear.visible = not knife
	sleeve_r.visible = not knife
	cuff_r.visible = not knife
	front.position = _front_home + reload_offset(reload_p, _front_home, _mag, style)
	front.rotation = Vector3(0.35 * _reload_bump(reload_p), 0.0, 0.0)
	var inv := gun_xf.affine_inverse()
	if not knife:
		place_sleeve(sleeve_r, cuff_r, rear.position + _wrist_r, inv * SHOULDER_R)
	place_sleeve(sleeve_l, cuff_l, front.position + front.basis * _wrist_l, inv * SHOULDER_L)

## 0..1 : à quel point la main avant est « en action » pendant le rechargement (inclinaison).
static func _reload_bump(p: float) -> float:
	if p < 0.0:
		return 0.0
	return smoothstep(0.0, 0.18, p) * (1.0 - smoothstep(0.78, 1.0, p))

## Décalage de la main avant (repère de l'arme) à l'avancement p du rechargement : va au chargeur, le retire (descend hors de l'écran), le remet, claque, revient.
static func reload_offset(p: float, home: Vector3, mag: Vector3, st: String) -> Vector3:
	if p < 0.0:
		return Vector3.ZERO
	var at_mag := mag + Vector3(0.0, 0.035, 0.0) - home
	var away := mag + Vector3(0.02, -0.16, 0.06) - home
	if st == "pistol":   # la main de soutien reste proche : elle claque seulement le chargeur
		away = mag + Vector3(0.0, -0.09, 0.03) - home
	if p < 0.16:
		return Vector3.ZERO.lerp(at_mag, smoothstep(0.0, 0.16, p))
	if p < 0.38:
		return at_mag.lerp(away, smoothstep(0.16, 0.38, p))
	if p < 0.60:
		return away
	if p < 0.76:
		return away.lerp(at_mag, smoothstep(0.60, 0.76, p))
	if p < 0.82:
		return at_mag + Vector3(0.0, 0.012 * sin((p - 0.76) / 0.06 * PI), 0.0)   # claque
	return at_mag.lerp(Vector3.ZERO, smoothstep(0.82, 1.0, p))
