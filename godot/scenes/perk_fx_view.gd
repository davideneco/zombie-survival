extends Node3D
## v0.27.0 : présentation des nouveaux atouts (sim/perk_fx.gd) : gouttes du Vautour (bidon vert de munitions, pièce dorée de points), tombe
## de la Pierre tombale (stèle grise et halo, clignote avant de disparaître), décharge de la Cerise-foudre (anneau électrique qui s'étend,
## arcs), toile de la Veuve noire (disque de fils violets au sol), aura de l'Ultime Volonté (colonne dorée autour du joueur). Lit Game.pfx
## et écoute Game.perk_event ; aucun effet sur la partie.

const RING_SHADER := preload("res://shaders/perk_ring.gdshader")

var _drops: Dictionary = {}       ## id -> Node3D
var _tomb: Node3D
var _tomb_key := ""
var _fx: Array = []               ## [{ node, t, life, kind, r }]
var _aura: MeshInstance3D
var _time := 0.0
var hold := false                 ## --hold-perkfx : les anneaux restent figés (captures)

static func _mat(color: Color, emissive := 0.0, alpha := 1.0, add := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color.r, color.g, color.b, alpha)
	if emissive > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emissive
	if alpha < 1.0 or add:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if add:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	return m

func setup() -> void:
	Game.perk_event.connect(_on_event)
	_aura = MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.7
	cm.bottom_radius = 0.9
	cm.height = 2.4
	cm.radial_segments = 20
	cm.cap_top = false
	cm.cap_bottom = false
	_aura.mesh = cm
	_aura.material_override = _mat(Color("ffd36a"), 0.0, 0.18, true)
	_aura.visible = false
	add_child(_aura)
	if Game.player != null:   # préchauffage : une de chaque sorte, sous l'écran de chargement (pipelines compilés avant la partie)
		for kind in ["cherry", "web", "pick"]:
			_ring(Game.player.pos + Vector3(0, -0.5, 0), 0.5, Color.WHITE, 0.3, kind)
		var d := _make_drop({"type": "ammo"})
		d.position = Game.player.pos + Vector3(0, -1.0, 0)
		add_child(d)
		var d2 := _make_drop({"type": "points"})
		d2.position = d.position
		add_child(d2)
		var tb := _make_tomb()
		tb.position = d.position
		add_child(tb)
		get_tree().create_timer(0.4).timeout.connect(func() -> void:
			for x in [d, d2, tb]:
				if is_instance_valid(x):
					x.queue_free())

func _exit_tree() -> void:
	if Game.perk_event.is_connected(_on_event):
		Game.perk_event.disconnect(_on_event)

func _on_event(name: String, data: Dictionary) -> void:
	match name:
		"cherry":
			_ring(data["pos"], float(data["radius"]), Color("8fd8ff"), 0.45, "cherry")
		"web":
			_ring(data["pos"], float(data["radius"]), Color("b07ad8"), 1.6, "web")
		"wish":
			_ring(data["pos"], 2.5, Color("ffd36a"), 0.6, "wish")
		"vulture_pick", "tomb_pick":
			_ring(data["pos"] if data.has("pos") else Game.player.pos, 1.2, Color("9dff7a") if name == "vulture_pick" else Color("e6e6e6"), 0.4, "pick")

## Anneau, décharge ou toile : un quad à plat (shader perk_ring.gdshader), de 2 r de côté.
func _ring(pos: Vector3, r: float, col: Color, life: float, kind: String) -> void:
	var mi := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(2.0 * r, 2.0 * r)
	qm.orientation = PlaneMesh.FACE_Y
	mi.mesh = qm
	var m := ShaderMaterial.new()
	m.shader = RING_SHADER
	m.set_shader_parameter("color", Color(col.r, col.g, col.b, 1.0))
	m.set_shader_parameter("mode", 1 if kind == "cherry" else (2 if kind == "web" else 0))
	m.set_shader_parameter("seed", randf() * 10.0)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(pos.x, pos.y + 0.06, pos.z)
	add_child(mi)
	_fx.append({"node": mi, "t": 0.0, "life": life, "kind": kind, "r": r})

func _make_drop(d: Dictionary) -> Node3D:
	var n := Node3D.new()
	if String(d["type"]) == "ammo":   # petit bidon vert
		var b := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.3, 0.22, 0.18)
		b.mesh = bm
		b.material_override = _mat(Color("4caf50"), 1.2)
		n.add_child(b)
	else:   # pièce dorée
		var c := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.16
		cm.bottom_radius = 0.16
		cm.height = 0.04
		c.mesh = cm
		c.material_override = _mat(Color("ffcf3a"), 1.6)
		c.rotation.x = PI / 2.0
		n.add_child(c)
	var halo := MeshInstance3D.new()
	var hs := SphereMesh.new()
	hs.radius = 0.32
	hs.height = 0.64
	hs.radial_segments = 10
	hs.rings = 5
	halo.mesh = hs
	halo.material_override = _mat(Color("9dff7a") if String(d["type"]) == "ammo" else Color("ffd84a"), 0.0, 0.25, true)
	n.add_child(halo)
	return n

func _make_tomb() -> Node3D:
	var n := Node3D.new()
	var stone := StandardMaterial3D.new()
	stone.albedo_color = Color("8a8f96")
	stone.roughness = 0.9
	stone.emission_enabled = true   # lisible de nuit
	stone.emission = Color("8a8f96")
	stone.emission_energy_multiplier = 0.25
	var b := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.55, 0.8, 0.14)
	b.mesh = bm
	b.material_override = stone
	b.position = Vector3(0, 0.4, 0)
	n.add_child(b)
	var top := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.275
	cm.bottom_radius = 0.275
	cm.height = 0.14
	top.mesh = cm
	top.material_override = stone
	top.rotation.x = PI / 2.0
	top.position = Vector3(0, 0.8, 0)
	n.add_child(top)
	var cross := Label3D.new()
	cross.text = "T"
	cross.font_size = 96
	cross.pixel_size = 0.3 / 96.0
	cross.modulate = Color("e8e8e8")
	cross.position = Vector3(0, 0.55, 0.08)
	n.add_child(cross)
	var halo := MeshInstance3D.new()
	var hc := CylinderMesh.new()
	hc.top_radius = 0.5
	hc.bottom_radius = 0.9
	hc.height = 2.2
	hc.cap_top = false
	hc.cap_bottom = false
	halo.mesh = hc
	halo.material_override = _mat(Color("cfd8e6"), 0.0, 0.05, true)
	halo.position = Vector3(0, 1.1, 0)
	n.add_child(halo)
	var l := Label3D.new()
	l.text = "PIERRE TOMBALE"
	l.font_size = 96
	l.pixel_size = 0.14 / 96.0
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.modulate = Color("e6e6e6")
	l.outline_size = 10
	l.position = Vector3(0, 1.35, 0)
	n.add_child(l)
	return n

func _process(dt: float) -> void:
	_time += dt
	var pfx: PerkFx = Game.pfx
	if pfx == null or Game.player == null:
		return
	var seen := {}
	for d: Dictionary in pfx.drops:
		var id := int(d["id"])
		seen[id] = true
		var n: Node3D = _drops.get(id)
		if n == null:
			n = _make_drop(d)
			add_child(n)
			_drops[id] = n
		var p: Vector3 = d["pos"]
		n.position = Vector3(p.x, p.y + 0.45 + sin(_time * 3.0 + id) * 0.08, p.z)
		n.rotation.y += dt * 2.5
		n.visible = float(d["life"]) > 4.0 or int(_time * 6.0) % 2 == 0
	for id: int in _drops.keys():
		if not seen.has(id):
			_drops[id].queue_free()
			_drops.erase(id)
	var key := "" if pfx.tomb.is_empty() else str(pfx.tomb["pos"])
	if key != _tomb_key:
		_tomb_key = key
		if _tomb != null:
			_tomb.queue_free()
			_tomb = null
		if key != "":
			_tomb = _make_tomb()
			_tomb.position = pfx.tomb["pos"]
			add_child(_tomb)
	if _tomb != null:
		_tomb.visible = float(pfx.tomb["life"]) > 10.0 or int(_time * 5.0) % 2 == 0
	_aura.visible = pfx.invuln > 0.0
	if _aura.visible:
		_aura.position = Game.player.pos + Vector3(0, 1.2, 0)
		_aura.rotation.y += dt * 2.0
		(_aura.material_override as StandardMaterial3D).albedo_color.a = 0.12 + 0.08 * sin(_time * 12.0)
	for i in range(_fx.size() - 1, -1, -1):
		var f: Dictionary = _fx[i]
		if not hold or float(f["t"]) < float(f["life"]) * 0.35:
			f["t"] = float(f["t"]) + dt
		var k := float(f["t"]) / float(f["life"])
		var mi: MeshInstance3D = f["node"]
		if k >= 1.0:
			mi.queue_free()
			_fx.remove_at(i)
			continue
		(mi.material_override as ShaderMaterial).set_shader_parameter("k", k)
