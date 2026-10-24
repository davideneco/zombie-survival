extends Node3D
## v0.26.0 : présentation du mode Zone unique : les portes de la zone sont MURÉES. Pour chaque porte qui touche la zone, la barricade cuite
## (planches + « PORTE VERROUILLÉE / prix ») est cachée et un mur de briques la remplace sur toute la largeur du passage (un pan par
## segment de la barrière, 0,5 m d'épaisseur, 3,6 m de haut, couronnement de béton), avec un écriteau « PASSAGE MURÉ » côté zone.
## La collision n'a pas à changer : les segments de la porte fermée bloquent déjà (World.sealed les garde fermés pour toujours).
## Les pans réutilisent le shader de pierre (stone.gdshader) avec la brique PBR (assets/pbr/wall_brick), sans projecteurs.

static var STONE_SHADER: Shader:
	get: return load("res://shaders/stone.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
const WeaponModels := preload("res://scenes/weapon_models.gd")
const BRICK_A := "res://assets/pbr/wall_brick/a.png"
const BRICK_M := "res://assets/pbr/wall_brick/m.png"
const HEIGHT := 3.6
const THICK := 0.5
const OVERLAP := 0.35       ## le pan dépasse dans les façades voisines (pas de jour sur les côtés)

var walls := 0              ## pans construits (tests, journal)
var doors_sealed: Array[int] = []

func setup(world_view: Node) -> void:
	var gm: GameMode = Game.gm
	var w: World = Game.world
	if gm == null or w == null:
		return
	var brick := ShaderMaterial.new()
	brick.shader = STONE_SHADER
	if ResourceLoader.exists(BRICK_A) and ResourceLoader.exists(BRICK_M):
		brick.set_shader_parameter("stone_a", load(BRICK_A))
		brick.set_shader_parameter("stone_m", load(BRICK_M))
	brick.set_shader_parameter("tint", Color(0.66, 0.36, 0.27))
	brick.set_shader_parameter("scale", 1.6)
	brick.set_shader_parameter("flood_energy", 0.0)
	brick.set_shader_parameter("normal_k", 0.8)
	var cap := StandardMaterial3D.new()
	cap.albedo_color = Color("8a8a86")
	cap.roughness = 0.9
	for aw: Dictionary in gm.added_walls:
		_wall_weapon(aw)
	var door_nodes: Dictionary = world_view.get("_door_nodes") if world_view != null and world_view.get("_door_nodes") != null else {}
	for d: Dictionary in w.doors:
		if int(d["a"]) != gm.zone and int(d["b"]) != gm.zone:
			continue
		var id := int(d["id"])
		doors_sealed.append(id)
		if door_nodes.has(id):
			(door_nodes[id] as Node3D).visible = false
		# un pan par segment de collision de la barrière (une porte peut fermer plusieurs passages disjoints : ses `points` sautent de l'un à l'autre)
		for k: float in d["segs"]:
			var sg: Dictionary = w.seg_list[int(k)]
			var p := Vector2(float(sg["ax"]), float(sg["az"]))
			var q := Vector2(float(sg["bx"]), float(sg["bz"]))
			if p.distance_to(q) < 0.1:
				continue
			_pan(p, q, brick, cap, true, true)
			var mid := (p + q) * 0.5
			var nrm := (q - p).normalized().orthogonal()
			if w.zone_of(mid.x + nrm.x * 2.0, mid.y + nrm.y * 2.0) != gm.zone and w.zone_of(mid.x - nrm.x * 2.0, mid.y - nrm.y * 2.0) == gm.zone:
				nrm = -nrm
			if p.distance_to(q) > 1.9:
				_sign(mid + nrm * (THICK * 0.5 + 0.03), nrm)

## Arme murale ajoutée (zone sans arme murale) : panneau de bois sur deux pieds, l'arme posée dessus, nom et prix.
func _wall_weapon(aw: Dictionary) -> void:
	var n := Node3D.new()
	n.position = Vector3(float(aw["pos"]["x"]), 0.0, float(aw["pos"]["z"]))
	n.rotation.y = float(aw["yaw"])
	add_child(n)
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color("4a3020")
	wood.roughness = 0.85
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color("1d1a17")
	dark.roughness = 0.9
	for spec in [[Vector3(1.7, 0.85, 0.06), Vector3(0, 1.45, 0), wood], [Vector3(0.08, 1.9, 0.08), Vector3(-0.7, 0.95, -0.06), dark], [Vector3(0.08, 1.9, 0.08), Vector3(0.7, 0.95, -0.06), dark]]:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = spec[0]
		mi.mesh = bm
		mi.material_override = spec[2]
		mi.position = spec[1]
		n.add_child(mi)
	var id := String(aw["id"])
	if WeaponModels.table().has(id):
		var model := WeaponModels.build(id, null)
		var e: Dictionary = WeaponModels.table()[id]
		var holder := Node3D.new()
		holder.position = Vector3(0, 1.5, 0.12)
		holder.rotation.y = PI / 2.0   # canon vers +X le long du panneau
		n.add_child(holder)
		model.scale = Vector3.ONE * 1.6
		model.position = Vector3(0, 0, (float(e["length"]) / 2.0 - float(e["grip"])) * 1.6)
		holder.add_child(model)
	var l := Label3D.new()
	l.text = "%s — %d PTS" % [aw["name"], int(aw["price"])]
	l.font_size = 96
	l.pixel_size = 0.12 / 96.0
	l.modulate = Color("ffe08a")
	l.outline_size = 10
	l.position = Vector3(0, 1.12, 0.04)
	l.visibility_range_end = 40.0
	n.add_child(l)

func _pan(p: Vector2, q: Vector2, brick: Material, cap: Material, first: bool, last: bool) -> void:
	var dir := q - p
	var L := dir.length()
	if L < 0.05:
		return
	var u := dir / L
	var a := p - u * (OVERLAP if first else 0.0)
	var b := q + u * (OVERLAP if last else 0.0)
	var c := (a + b) * 0.5
	var len := (b - a).length()
	var n := Node3D.new()
	n.position = Vector3(c.x, 0.0, c.y)
	n.rotation.y = atan2(-u.y, u.x)   # l'axe local X suit le segment
	add_child(n)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(len, HEIGHT, THICK)
	mi.mesh = bm
	mi.material_override = brick
	mi.position = Vector3(0, HEIGHT / 2.0 - 0.05, 0)
	mi.visibility_range_end = 200.0
	n.add_child(mi)
	var cm := MeshInstance3D.new()
	var cb := BoxMesh.new()
	cb.size = Vector3(len + 0.04, 0.16, THICK + 0.12)
	cm.mesh = cb
	cm.material_override = cap
	cm.position = Vector3(0, HEIGHT + 0.03, 0)
	cm.visibility_range_end = 200.0
	n.add_child(cm)
	walls += 1

func _sign(at: Vector2, facing: Vector2) -> void:
	var n := Node3D.new()
	n.position = Vector3(at.x, 1.75, at.y)
	n.rotation.y = atan2(facing.x, facing.y)   # +Z local vers la zone
	add_child(n)
	var board := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.7, 0.62, 0.04)
	board.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color("1c1a17")
	m.roughness = 0.8
	board.material_override = m
	n.add_child(board)
	for y in [0.33, -0.33]:
		var st := MeshInstance3D.new()
		var sb := BoxMesh.new()
		sb.size = Vector3(1.76, 0.05, 0.05)
		st.mesh = sb
		var sm := StandardMaterial3D.new()
		sm.albedo_color = Color("c43a2a")
		sm.emission_enabled = true
		sm.emission = Color("c43a2a")
		sm.emission_energy_multiplier = 0.6
		st.material_override = sm
		st.position = Vector3(0, y, 0.01)
		n.add_child(st)
	for spec in [["PASSAGE MURÉ", 0.17, 0.08, Color("ff6a50")], ["seule la porte de sortie mène dehors", 0.075, -0.13, Color("dddddd")]]:
		var l := Label3D.new()
		l.text = spec[0]
		l.font_size = 96
		l.pixel_size = float(spec[1]) / 96.0
		l.modulate = spec[3]
		l.outline_size = 10
		l.position = Vector3(0, float(spec[2]), 0.03)
		l.visibility_range_end = 50.0
		n.add_child(l)
