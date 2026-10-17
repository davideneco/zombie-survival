extends Node3D
## Présentation de J6 (primitives) : boîte mystère (coffre, couvercle, tirage, faisceau, nounours, envol : les 19 emplacements sont dessinés ici, le monde
## cuit n'en contient plus), Pack-a-Punch (l'arme qui entre, les étincelles et l'arme proposée : la machine, elle, est dans le monde cuit) et bonus au sol
## (dodécaèdre lumineux, bidon d'essence). Les distributeurs d'atouts sont entièrement dans le monde cuit. Ne fait que lire Game.machines et Game.powerups.

const WeaponView := preload("res://scenes/weapon_view.gd")
const POWERUP_COLORS := {"max_ammo": 0x22ff66, "insta_kill": 0xff2222, "nuke": 0xffdd22, "double_points": 0xffaa00, "fuel": 0xb81208}
const PAP_ANCHOR := Vector3(0, 1.0, 1.325)
const PAP_SLOT := Vector3(0, 0.68, 0.55)       ## machineFx.js : l'arme entre en (z 0,55, y slotY + 0,1)
const PAP_SPARK := {1: Color("a8f0ff"), 2: Color("6fd6ff"), 3: Color("ffb070")}

var _box_nodes: Array = []        ## un groupe par emplacement de boîte
var _box_parts: Array = []        ## { lid, sign, display (Node3D), name (Label3D), beam, teddy }
var _pap: Node3D
var _pap_parts: Dictionary = {}
var _pu_nodes: Dictionary = {}    ## id du bonus -> Node3D
var _time := 0.0
var _spin_t := 0.0
var _spin_k := 0
var _shown_roll := ""
var _pool_ids: Array = []
var _display_id := ""

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
	parent.add_child(mi)
	return mi

static func _label(parent: Node3D, text: String, size: float, pos: Vector3, color := Color.WHITE) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font_size = 96
	l.pixel_size = size / 96.0
	l.modulate = color
	l.outline_size = 14
	l.position = pos
	parent.add_child(l)
	return l

func setup() -> void:
	var ms: Machines = Game.machines
	if ms == null:
		return
	_pool_ids = Config.at("box.pool").keys()
	for m: Dictionary in ms.list:
		var n := Node3D.new()
		n.position = Vector3(float(m["pos"]["x"]), float(m["pos"]["y"]), float(m["pos"]["z"]))
		n.rotation.y = float(m["yaw"])
		add_child(n)
		match String(m["type"]):
			"box":
				_box_nodes.append(n)
				_box_parts.append(_build_box(n))
			"pap":
				_pap = n
				_build_pap(n)
			_:
				n.queue_free()

# ------------------------------------------------------------------ boîte mystère
func _build_box(n: Node3D) -> Dictionary:
	var W := 1.7   # machines.js makeMysteryBox : 1,7 x 0,72 x 0,85
	var H := 0.72
	var D := 0.85
	var wood := _mat(Color("3a2516"), 0.0, 0.0, 0.85)
	var iron := _mat(Color("3a3b3e"), 0.0, 0.8, 0.45)
	var glow := _mat(Color("6ac8ff"), 1.4)
	_box(n, Vector3(W, H, D), wood, Vector3(0, H / 2.0 + 0.05, 0))
	for sx in [-1.0, 1.0]:
		_box(n, Vector3(0.16, 0.08, D + 0.04), iron, Vector3(sx * (W / 2.0 - 0.12), 0.04, 0))
	for fz in [1.0, -1.0]:   # points d'interrogation lumineux sur les grandes faces
		var q := _label(n, "?   ?   ?", 0.42, Vector3(0, H / 2.0 + 0.07, fz * (D / 2.0 + 0.012)), Color("6ac8ff"))
		if fz < 0.0:
			q.rotation.y = PI
	var lid_pivot := Node3D.new()   # couvercle bombé sur charnières
	lid_pivot.position = Vector3(0, H + 0.05, -D / 2.0)
	n.add_child(lid_pivot)
	var lm := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = D / 2.0
	cyl.bottom_radius = D / 2.0
	cyl.height = W
	cyl.radial_segments = 16
	lm.mesh = cyl
	lm.material_override = wood
	lm.rotation.z = PI / 2.0
	lm.scale = Vector3(0.45, 1.0, 1.0)
	lm.position = Vector3(0, 0, D / 2.0)
	lid_pivot.add_child(lm)
	_box(lid_pivot, Vector3(W, 0.03, D), wood, Vector3(0, 0.0, D / 2.0))
	for sx in [-0.55, 0.0, 0.55]:
		_box(lid_pivot, Vector3(0.07, 0.2, D + 0.05), iron, Vector3(sx, 0.08, D / 2.0))
	_box(n, Vector3(0.16, 0.2, 0.05), iron, Vector3(0, H - 0.02, D / 2.0 + 0.03))
	var sign := Node3D.new()   # écriteau : « BOÎTE MYSTÈRE 950 PTS »
	sign.position = Vector3(0, 1.45, 0)
	n.add_child(sign)
	_box(sign, Vector3(1.5, 0.5, 0.04), _mat(Color("0a0e14")), Vector3.ZERO)
	_box(sign, Vector3(1.56, 0.04, 0.05), glow, Vector3(0, 0.27, 0))
	_box(sign, Vector3(1.56, 0.04, 0.05), glow, Vector3(0, -0.27, 0))
	_label(sign, "BOÎTE MYSTÈRE", 0.17, Vector3(0, 0.08, 0.03), Color("6ac8ff"))
	_label(sign, "%d PTS" % int(Config.at("box.price")), 0.15, Vector3(0, -0.12, 0.03), Color("ffe08a"))
	var disp := Node3D.new()
	disp.visible = false
	n.add_child(disp)
	var name_lbl := _label(disp, "", 0.22, Vector3(0, 0.55, 0), Color("ffe08a"))
	name_lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	var gun := Node3D.new()
	disp.add_child(gun)
	var beam := MeshInstance3D.new()   # faisceau du tirage
	var cm := CylinderMesh.new()
	cm.top_radius = 0.35
	cm.bottom_radius = 0.7
	cm.height = 3.2
	beam.mesh = cm
	var bmat := StandardMaterial3D.new()
	bmat.albedo_color = Color(1, 0.88, 0.54, 0.1)
	bmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	bmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	beam.material_override = bmat
	beam.position = Vector3(0, 2.1, 0)
	beam.visible = false
	n.add_child(beam)
	var far := MeshInstance3D.new()    # repère de loin : faisceau bleu de 30 m (makeMysteryBox)
	var fc := CylinderMesh.new()
	fc.top_radius = 0.22
	fc.bottom_radius = 0.32
	fc.height = 30.0
	fc.radial_segments = 14
	far.mesh = fc
	var fmat := StandardMaterial3D.new()
	fmat.albedo_color = Color(0.37, 0.72, 1.0, 0.1)
	fmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	far.material_override = fmat
	far.position = Vector3(0, 15.0, 0)
	n.add_child(far)
	var teddy := _make_teddy()
	teddy.visible = false
	n.add_child(teddy)
	return {"node": n, "lid": lid_pivot, "sign": sign, "disp": disp, "gun": gun, "name": name_lbl, "beam": beam, "bmat": bmat, "teddy": teddy}

func _make_teddy() -> Node3D:
	var t := Node3D.new()
	var fur := _mat(Color("b07a45"), 0.0, 0.0, 0.9)
	for spec in [[Vector3(0, 0.0, 0), 0.3], [Vector3(0, 0.38, 0), 0.22], [Vector3(-0.17, 0.55, 0), 0.08], [Vector3(0.17, 0.55, 0), 0.08], [Vector3(-0.28, 0.05, 0), 0.1], [Vector3(0.28, 0.05, 0), 0.1]]:
		var mi := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = spec[1]
		s.height = spec[1] * 2.0
		mi.mesh = s
		mi.material_override = fur
		mi.position = spec[0]
		t.add_child(mi)
	t.scale = Vector3.ONE * 1.6
	return t

## Silhouette d'arme (primitives par catégorie, comme la vue à la première personne), de couleur selon le niveau du Pack-a-Punch.
func _fill_gun(gun: Node3D, id: String, pap_lv: int) -> void:
	for c in gun.get_children():
		c.queue_free()
	if id == "":
		return
	var cfg := Config.weapon(id)
	var size: Vector3 = WeaponView.BODY.get(String(cfg.get("cat", "pistol")), WeaponView.BODY["pistol"])
	var col := Color("30343a")
	var em := 0.0
	if pap_lv > 0:
		col = Config.color(int(Config.pap_levels[pap_lv]["color"]))
		em = 0.9
	var m := _mat(col, em, 0.6, 0.45)
	var k := 1.8
	var body := _box(gun, size * k, m, Vector3(0, 0, 0))
	body.rotation.y = PI / 2.0
	var grip := _box(gun, Vector3(size.x, size.y * 1.4, size.x * 1.4) * k, m, Vector3(-size.z * k * 0.1, -size.y * k * 0.9, 0))
	grip.rotation.y = PI / 2.0

func _update_box(i: int, active: bool, dt: float) -> void:
	var P: Dictionary = _box_parts[i]
	var n: Node3D = P["node"]
	var box: MysteryBox = Game.machines.box
	n.visible = active or (not box.move.is_empty() and box.move["from"] == i)
	if not n.visible:
		return
	var lid: Node3D = P["lid"]
	var disp: Node3D = P["disp"]
	var beam: MeshInstance3D = P["beam"]
	var teddy: Node3D = P["teddy"]
	var roll := box.roll
	var open := 0.0
	disp.visible = false
	beam.visible = false
	teddy.visible = false
	P["sign"].visible = roll.is_empty() or not active
	if active and not roll.is_empty():
		var ph := String(roll["phase"])
		var r := float(roll["age"])
		beam.visible = ph != "sink"
		(P["bmat"] as StandardMaterial3D).albedo_color.a = 0.1 + 0.05 * sin(r * 18.0) if ph == "roll" else 0.07
		match ph:
			"roll":
				var t := float(roll["t"])
				var p := minf(1.0, t / float(Config.at("box.spin")))
				open = minf(1.25, t * 2.5)
				disp.visible = true
				disp.position.y = 0.7 + 1.0 * (1.0 - pow(1.0 - minf(1.0, t / 0.9), 2.0)) + sin(r * 5.0) * 0.04
				disp.rotation.y += dt * (5.0 - 3.5 * p)
				_spin_t -= dt
				if _spin_t <= 0.0:   # les armes défilent de plus en plus lentement
					_spin_t = 0.055 + 0.42 * p * p * p
					_spin_k += 1
					_set_display(P, _pool_ids[(_spin_k * 7 + hash(String(roll["result"]))) % _pool_ids.size()], false)
			"teddy":
				open = 1.25
				teddy.visible = true
				var t2 := float(roll["t"])
				teddy.position = Vector3(0, 1.0 + minf(1.0, t2) * 0.5 + absf(sin(t2 * 7.0)) * 0.12, 0)
				teddy.rotation.y += dt * 4.0
			"offer":
				open = 1.25
				disp.visible = float(roll["offer_t"]) > Rules.BOX_OFFER_WARN or int(r * 8.0) % 2 == 0
				disp.position.y = 1.7 + sin(r * 3.0) * 0.07
				disp.rotation.y += dt * 1.4
				_set_display(P, String(roll["result"]), true)
			"sink":
				var ts := float(roll["t"])
				open = maxf(0.0, 1.25 - ts * 3.0)
				disp.visible = true
				disp.position.y = maxf(0.6, disp.position.y - dt * 3.0)
				disp.scale = Vector3.ONE * maxf(0.05, 1.0 - ts * 1.6)
		if ph != "sink":
			disp.scale = Vector3.ONE
	elif not box.move.is_empty() and box.move["from"] == i:   # nounours, puis la boîte s'envole
		var mt := float(box.move["t"])
		open = 0.0
		teddy.visible = mt < 2.4
		teddy.position = Vector3(0, 0.9 + minf(1.0, mt) * 0.6, 0)
		teddy.rotation.y += dt * 3.0
		if mt > 1.2:
			n.position.y = (mt - 1.2) * (mt - 1.2) * 6.0
			n.rotation.y += dt * 2.0 * (mt - 1.2)
	else:
		_shown_roll = ""
	lid.rotation.x = -open

func _set_display(P: Dictionary, id: String, final: bool) -> void:
	if _display_id == id and final:
		return
	_display_id = id
	_fill_gun(P["gun"], id, 0)
	var lbl: Label3D = P["name"]
	lbl.text = String(Config.weapon(id)["name"]) if final else ""

# ------------------------------------------------------------------ Pack-a-Punch
func _build_pap(n: Node3D) -> void:
	var anchor := Node3D.new()   # machines.js makePackAPunch : anchor = [0, 1.0, D / 2 + 0.7] avec D = 1,25
	anchor.position = PAP_ANCHOR
	n.add_child(anchor)
	var gun := Node3D.new()
	anchor.add_child(gun)
	gun.visible = false
	var sparks: Array[MeshInstance3D] = []
	var sm := _mat(Color("a8f0ff"), 3.0)
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	for _i in 10:
		var s := MeshInstance3D.new()
		var sp := SphereMesh.new()
		sp.radius = 0.03
		sp.height = 0.06
		s.mesh = sp
		s.material_override = sm
		s.visible = false
		n.add_child(s)
		sparks.append(s)
	_pap_parts = {"anchor": anchor, "gun": gun, "sparks": sparks, "spark_mat": sm, "gun_key": ""}

func _update_pap(dt: float) -> void:
	if _pap == null:
		return
	var a := Game.machines.pap.anim
	var gun: Node3D = _pap_parts["gun"]
	var anchor: Node3D = _pap_parts["anchor"]
	var sparks: Array = _pap_parts["sparks"]
	for s: MeshInstance3D in sparks:
		s.visible = false
	if a.is_empty():
		gun.visible = false
		_pap_parts["gun_key"] = ""
		return
	var C: Dictionary = Config.at("pap")
	var lv := int(a["lv"])
	var upgraded: bool = a["phase"] in ["out", "offer"]
	var key := "%s/%d/%s" % [a["w"], lv, upgraded]
	if key != _pap_parts["gun_key"]:
		_pap_parts["gun_key"] = key
		_fill_gun(gun, String(a["w"]), lv if upgraded else lv - 1)   # l'arme entre avec son niveau actuel, ressort améliorée
	(_pap_parts["spark_mat"] as StandardMaterial3D).albedo_color = PAP_SPARK.get(lv, PAP_SPARK[1])
	var t := float(a["t"])
	var age := float(a["age"])
	match String(a["phase"]):
		"in":   # l'arme glisse dans la fente
			var k := minf(1.0, t / float(C["inTime"]))
			var e := k * k * (3.0 - 2.0 * k)
			gun.visible = true
			anchor.position = PAP_ANCHOR.lerp(PAP_SLOT, e)
			anchor.scale = Vector3.ONE * (1.0 - 0.55 * e)
		"work":   # la machine travaille : étincelles de plus en plus nombreuses
			var k2 := t / float(C["workTime"])
			gun.visible = false
			for s: MeshInstance3D in sparks:
				if randf() < 0.2 + 0.6 * k2:
					s.visible = true
					s.position = Vector3((randf() - 0.5) * 0.9, 0.55 + randf() * 0.5, 1.0)
		"out":   # elle ressort, améliorée
			var k3 := minf(1.0, t / float(C["outTime"]))
			var e3 := 1.0 - pow(1.0 - k3, 3.0)
			gun.visible = true
			anchor.position = PAP_SLOT.lerp(PAP_ANCHOR, e3)
			anchor.scale = Vector3.ONE * (0.45 + 0.55 * e3)
			for s: MeshInstance3D in sparks:
				if randf() < 0.5:
					s.visible = true
					s.position = Vector3((randf() - 0.5) * 0.9, 0.55 + randf() * 0.5, 1.0)
		"offer":   # proposée au joueur
			gun.visible = true
			anchor.position = PAP_ANCHOR + Vector3(0, sin(age * 3.0) * 0.05, 0)
			anchor.scale = Vector3.ONE
			gun.rotation.y += dt * 1.2
			if randf() < 0.3:
				var s0: MeshInstance3D = sparks[0]
				s0.visible = true
				s0.position = Vector3((randf() - 0.5) * 0.9, 0.55 + randf() * 0.5, 1.0)

# ------------------------------------------------------------------ bonus au sol
func _make_powerup(pu: Dictionary) -> Node3D:
	var n := Node3D.new()
	var type := String(pu["type"])
	var col := Config.color(int(POWERUP_COLORS.get(type, 0xffffff)))
	var m := _mat(col, 0.25 if type == "fuel" else 1.2, 0.0, 0.3)
	if type == "fuel":   # jerrican rouge : corps, goulot et poignée
		_box(n, Vector3(0.42, 0.56, 0.2), m, Vector3.ZERO)
		var neck := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.05
		cm.bottom_radius = 0.05
		cm.height = 0.12
		neck.mesh = cm
		neck.material_override = m
		neck.position = Vector3(0.1, 0.34, 0)
		n.add_child(neck)
		_box(n, Vector3(0.14, 0.06, 0.06), m, Vector3(-0.07, 0.31, 0))
	else:
		var body := MeshInstance3D.new()
		var s := SphereMesh.new()   # peu de facettes : un dodécaèdre approximatif
		s.radius = 0.37
		s.height = 0.74
		s.radial_segments = 5
		s.rings = 3
		body.mesh = s
		body.material_override = m
		n.add_child(body)
	var halo := MeshInstance3D.new()
	var hs := SphereMesh.new()
	hs.radius = 0.55
	hs.height = 1.1
	hs.radial_segments = 12
	hs.rings = 6
	halo.mesh = hs
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(col.r, col.g, col.b, 0.16 if type == "fuel" else 0.3)
	hm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	hm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	hm.no_depth_test = false
	halo.material_override = hm
	n.add_child(halo)
	return n

func _update_powerups(dt: float) -> void:
	var seen := {}
	for pu in Game.powerups.items:
		var id := int(pu["id"])
		seen[id] = true
		var n: Node3D = _pu_nodes.get(id)
		if n == null:
			n = _make_powerup(pu)
			add_child(n)
			_pu_nodes[id] = n
		var pos: Vector3 = pu["pos"]
		n.position = Vector3(pos.x, float(pu["base_y"]) + sin(_time * 3.0) * Rules.POWERUP_BOB, pos.z)
		n.rotation.y += dt * 2.8
		n.visible = float(pu["life"]) >= Rules.POWERUP_BLINK_LIFE or int(float(pu["life"]) * 6.0) % 2 == 0
	for id: int in _pu_nodes.keys():
		if not seen.has(id):
			_pu_nodes[id].queue_free()
			_pu_nodes.erase(id)

func _process(dt: float) -> void:
	_time += dt
	if Game.machines != null:
		var box: MysteryBox = Game.machines.box
		for i in _box_parts.size():
			var n: Node3D = _box_parts[i]["node"]
			if box.move.is_empty() and n.position.y != _box_base_y(i):   # revient posée après un envol
				n.position.y = _box_base_y(i)
				n.rotation.y = float(box.boxes[i]["yaw"])
			_update_box(i, i == box.active, dt)
		_update_pap(dt)
	if Game.powerups != null:
		_update_powerups(dt)

func _box_base_y(i: int) -> float:
	return float(Game.machines.box.boxes[i]["pos"]["y"])
