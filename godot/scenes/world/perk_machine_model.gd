class_name PerkMachineModel
extends RefCounted
## v0.26.0 : modèles construits par code (primitives) des machines qui ne sont pas dans le monde cuit :
##   - distributeur d'atout (mode Zone unique : jeu de base ; v0.27.0 : les nouveaux atouts) : caisse à la couleur de l'atout, vitrine
##     lumineuse avec le logo (lettre) et le nom, fronton éclairé, prix, petite lumière de la couleur de l'atout ;
##   - porte de sortie du mode Zone unique : édicule de béton, porte blindée, panneau « SORTIE » vert éclairé, prix, repère vertical vert.
## Repère local : la façade regarde +Z (convention des machines de objects.json : rotation.y = yaw).

const LIGHT_FADE_BEGIN := 45.0
const LIGHT_FADE_LENGTH := 12.0
const VIS_RANGE := 160.0

static func _mat(color: Color, emissive := 0.0, metallic := 0.0, rough := 0.7) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metallic
	m.roughness = rough
	if emissive > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emissive
	return m

static func _box(parent: Node3D, size: Vector3, m: Material, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = m
	mi.position = pos
	mi.visibility_range_end = VIS_RANGE
	parent.add_child(mi)
	return mi

static func _label(parent: Node3D, text: String, height: float, pos: Vector3, color := Color.WHITE, outline := 14) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font_size = 96
	l.pixel_size = height / 96.0
	l.modulate = color
	l.outline_size = outline
	l.outline_modulate = Color(0, 0, 0, 0.9)
	l.position = pos
	l.visibility_range_end = 60.0
	parent.add_child(l)
	return l

static func _light(parent: Node3D, color: Color, pos: Vector3, energy := 0.9, rng := 4.0) -> OmniLight3D:
	var li := OmniLight3D.new()
	li.light_color = color
	li.light_energy = energy
	li.omni_range = rng
	li.shadow_enabled = false
	li.distance_fade_enabled = true
	li.distance_fade_begin = LIGHT_FADE_BEGIN
	li.distance_fade_length = LIGHT_FADE_LENGTH
	li.position = pos
	parent.add_child(li)
	return li

## Distributeur d'atout. m : { id, name, price, color, letter } (le prix affiché est celui de Machines.perk_price).
static func build_perk(m: Dictionary) -> Node3D:
	var n := Node3D.new()
	var col := Color(String(m.get("color", "#888888")))
	var dark := Color("17181b")
	var body := _mat(col.darkened(0.15), 0.0, 0.35, 0.42)
	var trim := _mat(dark, 0.0, 0.6, 0.35)
	var glow := _mat(col.lightened(0.25), 1.6)
	var W := 1.15
	var H := 2.05
	var D := 0.85
	_box(n, Vector3(W + 0.15, 0.12, D + 0.15), trim, Vector3(0, 0.06, 0))                  # socle
	_box(n, Vector3(W, H, D), body, Vector3(0, 0.12 + H / 2.0, 0))                          # caisse
	for sx in [-1.0, 1.0]:                                                                  # montants de façade
		_box(n, Vector3(0.09, H, 0.06), trim, Vector3(sx * (W / 2.0 - 0.02), 0.12 + H / 2.0, D / 2.0 + 0.01))
	var panel := _mat(col.lightened(0.45), 0.9, 0.0, 0.15)                                  # vitrine lumineuse
	_box(n, Vector3(W - 0.3, 1.1, 0.04), panel, Vector3(0, 1.32, D / 2.0 + 0.01))
	_box(n, Vector3(0.62, 0.62, 0.05), _mat(dark, 0.0, 0.2, 0.5), Vector3(0, 1.42, D / 2.0 + 0.03))   # médaillon du logo
	_box(n, Vector3(0.66, 0.04, 0.06), glow, Vector3(0, 1.75, D / 2.0 + 0.04))
	_box(n, Vector3(0.66, 0.04, 0.06), glow, Vector3(0, 1.09, D / 2.0 + 0.04))
	_label(n, String(m.get("letter", "?")), 0.5, Vector3(0, 1.42, D / 2.0 + 0.065), col.lightened(0.55), 20)
	_box(n, Vector3(0.7, 0.16, 0.12), _mat(Color("0b0b0d")), Vector3(0, 0.42, D / 2.0 + 0.02))     # bac de distribution
	_box(n, Vector3(W + 0.1, 0.36, D + 0.1), trim, Vector3(0, 0.12 + H + 0.18, 0))         # fronton
	_box(n, Vector3(W + 0.12, 0.05, 0.05), glow, Vector3(0, 0.12 + H + 0.02, D / 2.0 + 0.06))
	var name := String(m.get("name", ""))
	var nl := _label(n, name, 0.17 if name.length() <= 12 else 0.13, Vector3(0, 0.12 + H + 0.19, D / 2.0 + 0.06), col.lightened(0.6))
	nl.width = 1100.0
	var price := int(m.get("price", 0))
	if String(m.get("type", "perk")) == "perk" and m.get("id") != null:
		price = Machines.perk_price(String(m["id"]))
	_box(n, Vector3(0.62, 0.17, 0.04), _mat(Color("0b0b0d")), Vector3(0, 0.66, D / 2.0 + 0.02))   # plaque du prix
	_label(n, "%d PTS" % price, 0.12, Vector3(0, 0.66, D / 2.0 + 0.045), Color("ffe08a"), 8)
	_light(n, col.lightened(0.2), Vector3(0, 1.6, D / 2.0 + 0.6), 0.8, 3.6)
	return n

## Porte de sortie (mode Zone unique). m : { price }.
static func build_exit(m: Dictionary) -> Node3D:
	var n := Node3D.new()
	var concrete := _mat(Color("8d8f8c"), 0.0, 0.0, 0.92)
	var concrete_dark := _mat(Color("6b6d6a"), 0.0, 0.0, 0.95)
	var steel := _mat(Color("394240"), 0.0, 0.75, 0.38)
	var green := Color("3ddc6a")
	var hazard_y := _mat(Color("e0b81e"), 0.0, 0.0, 0.6)
	var hazard_k := _mat(Color("161616"), 0.0, 0.0, 0.6)
	var W := 3.0
	var H := 3.0
	var D := 2.2
	_box(n, Vector3(W + 0.3, 0.15, D + 0.3), concrete_dark, Vector3(0, 0.075, 0))      # dalle
	_box(n, Vector3(0.7, H, D), concrete, Vector3(-(W / 2.0 - 0.35), 0.15 + H / 2.0, 0))   # piédroits
	_box(n, Vector3(0.7, H, D), concrete, Vector3(W / 2.0 - 0.35, 0.15 + H / 2.0, 0))
	_box(n, Vector3(W - 1.4, 0.55, D), concrete, Vector3(0, 0.15 + H - 0.275, 0))          # linteau
	_box(n, Vector3(W - 1.4, H - 0.55, 0.3), concrete_dark, Vector3(0, 0.15 + (H - 0.55) / 2.0, -D / 2.0 + 0.15))   # fond
	_box(n, Vector3(W + 0.25, 0.22, D + 0.25), concrete_dark, Vector3(0, 0.15 + H + 0.11, 0))   # toit
	var door := Node3D.new()                                                            # porte blindée en retrait
	door.position = Vector3(0, 0.15, D / 2.0 - 0.35)
	n.add_child(door)
	_box(door, Vector3(1.55, 2.35, 0.14), steel, Vector3(0, 1.175, 0))
	for y in [0.45, 1.175, 1.9]:                                                        # renforts
		_box(door, Vector3(1.45, 0.08, 0.05), _mat(Color("2a302f"), 0.0, 0.8, 0.3), Vector3(0, y, 0.09))
	var wheel := MeshInstance3D.new()                                                    # volant de manœuvre
	var tor := TorusMesh.new()
	tor.inner_radius = 0.17
	tor.outer_radius = 0.23
	wheel.mesh = tor
	wheel.material_override = _mat(Color("b8a04a"), 0.0, 0.9, 0.3)
	wheel.rotation.x = PI / 2.0
	wheel.position = Vector3(0, 1.2, 0.13)
	door.add_child(wheel)
	for i in 8:                                                                         # bandes jaune / noir au seuil
		_box(n, Vector3((W - 1.4) / 8.0, 0.04, 0.35), hazard_y if i % 2 == 0 else hazard_k, Vector3(-(W - 1.4) / 2.0 + (i + 0.5) * (W - 1.4) / 8.0, 0.17, D / 2.0 - 0.1))
	var sign := Node3D.new()                                                            # panneau « SORTIE »
	sign.position = Vector3(0, 0.15 + H - 0.28, D / 2.0 + 0.04)
	n.add_child(sign)
	_box(sign, Vector3(1.5, 0.42, 0.06), _mat(green, 2.2), Vector3.ZERO)
	_label(sign, "SORTIE", 0.3, Vector3(0, 0.0, 0.05), Color.WHITE, 10)
	_label(n, "%s PTS" % _thousands(int(m.get("price", 0))), 0.2, Vector3(0, 0.15 + H - 0.62, D / 2.0 + 0.05), Color("ffe08a"))
	_label(n, "PORTE DE SORTIE", 0.18, Vector3(0, 0.15 + H + 0.45, 0), green.lightened(0.3)).billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	_light(n, green, Vector3(0, 0.15 + H - 0.3, D / 2.0 + 0.9), 0.5, 3.5)
	var beam := MeshInstance3D.new()                                                    # repère de loin : faisceau vert de 30 m
	var fc := CylinderMesh.new()
	fc.top_radius = 0.25
	fc.bottom_radius = 0.4
	fc.height = 30.0
	fc.radial_segments = 14
	beam.mesh = fc
	var fmat := StandardMaterial3D.new()
	fmat.albedo_color = Color(0.24, 0.86, 0.42, 0.12)
	fmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	beam.material_override = fmat
	beam.position = Vector3(0, 0.15 + H + 15.2, 0)
	n.add_child(beam)
	return n

static func _thousands(v: int) -> String:
	var s := str(v)
	var out := ""
	while s.length() > 3:
		out = " " + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out
