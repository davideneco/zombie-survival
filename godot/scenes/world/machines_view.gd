extends Node3D
## Présentation de J6 : boîte mystère (v0.29.0 : modèle box_model.gd, animation BoxAnim.pose appliquée ici ; coffre, couvercle, tirage avec les vrais
## modèles des 23 armes, faisceau, étincelles, fumée, nounours, envol et arrivée : les 19 emplacements sont dessinés ici, le monde cuit n'en contient plus), Pack-a-Punch (l'arme qui entre, les étincelles et l'arme proposée : la machine, elle, est dans le monde cuit) et bonus au sol
## (dodécaèdre lumineux, bidon d'essence). Les distributeurs d'atouts sont entièrement dans le monde cuit. Ne fait que lire Game.machines et Game.powerups.

const WeaponModels := preload("res://scenes/weapon_models.gd")
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
var _pool_ids: Array = []
var _gallery: Dictionary = {}     ## v0.29.0 : weapon id -> world model (BoxModel.weapon_model), shown by the active box
var _gallery_id := ""
var _gallery_parent: Node3D
var _arrive_t := 1.0e9            ## v0.29.0 : seconds since the box arrived at its new place (view-only drop animation)
var _last_active := -1

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
			"perk":   # v0.26.0 : distributeurs absents du monde cuit (jeu de base de la Zone unique ; v0.27.0 : nouveaux atouts)
				if m.get("added", false) or m.get("proc", false):
					n.add_child(PerkMachineModel.build_perk(m))
				else:
					n.queue_free()
			"exit":   # v0.26.0 : porte de sortie du mode Zone unique
				n.add_child(PerkMachineModel.build_exit(m))
			_:
				n.queue_free()

# ------------------------------------------------------------------ boîte mystère
## v0.29.0 : model in box_model.gd, animation = BoxAnim.pose (pure function of the sim, sim/box_anim.gd) applied here.
func _build_box(n: Node3D) -> Dictionary:
	return BoxModel.build(n)

func _make_teddy() -> Node3D:
	return BoxModel.teddy()

## The 23 weapons of the pool as world models, built once; parented to the display of the box that shows them.
func _gallery_of(id: String) -> Node3D:
	if not _gallery.has(id):
		var g := BoxModel.weapon_model(id)
		g.visible = false
		_gallery[id] = g
	return _gallery[id]

func _show_weapon(P: Dictionary, id: String) -> void:
	var disp: Node3D = P["disp"]
	if _gallery_id == id and _gallery_parent == disp:
		return
	if _gallery_id != "" and _gallery.has(_gallery_id):
		(_gallery[_gallery_id] as Node3D).visible = false
	var g := _gallery_of(id)
	if g.get_parent() != disp:
		if g.get_parent() != null:
			g.get_parent().remove_child(g)
		disp.add_child(g)
	g.visible = true
	_gallery_id = id
	_gallery_parent = disp

## Arme affichée au-dessus de la boîte : le vrai modèle (WeaponModels), centré sur sa longueur, teinté selon le niveau du Pack-a-Punch.
func _fill_gun(gun: Node3D, id: String, pap_lv: int) -> void:
	for c in gun.get_children():
		c.queue_free()
	if id == "":
		return
	var tint: Variant = Config.color(int(Config.pap_levels[pap_lv]["color"])) if pap_lv > 0 else null
	var model := WeaponModels.build(id, tint)
	var e: Dictionary = WeaponModels.table()[id]
	var k := 1.8
	model.scale = Vector3.ONE * k
	model.rotation.y = PI / 2.0
	model.position = Vector3(0, 0, 0)
	var center := Node3D.new()
	center.position = Vector3(0, 0, 0)
	gun.add_child(center)
	center.add_child(model)
	model.position = Basis(Vector3.UP, PI / 2.0) * Vector3(0, 0, (float(e["length"]) / 2.0 - float(e["grip"])) * k)   # milieu du modèle à l'origine

func _update_box(i: int, _active: bool, _dt: float) -> void:
	var P: Dictionary = _box_parts[i]
	var n: Node3D = P["node"]
	var box: MysteryBox = Game.machines.box
	var arrive := _arrive_t if i == box.active else 1.0e9
	var A := BoxAnim.pose(box, i, _time, arrive, _pool_ids.size())
	n.visible = bool(A["shown"]) or (P["poof"] as GPUParticles3D).emitting
	(P["far"] as Node3D).visible = i == box.active and box.move.is_empty() and box.roll.is_empty() and arrive > BoxAnim.ARRIVE_TIME * 0.5
	if not n.visible:
		return
	var body: Node3D = P["body"]
	body.visible = bool(A["shown"]) and float(A["scale"]) > 0.001
	var sh := float(A["shake"])
	body.position = Vector3(sin(_time * 53.0) * sh, float(A["lift"]) + absf(sin(_time * 41.0)) * sh * 0.5, cos(_time * 47.0) * sh)
	body.rotation = Vector3(sin(_time * 31.0) * sh * 0.6, float(A["box_yaw"]), cos(_time * 37.0) * sh * 0.6)
	body.scale = Vector3.ONE * maxf(0.001, float(A["scale"]))
	(P["lid"] as Node3D).rotation.x = -float(A["lid"])
	var glow := float(A["glow"])
	var red := float(A["beam_red"])
	var col := BoxModel.GLOW.lerp(BoxModel.RED, red)
	(P["inner"] as StandardMaterial3D).albedo_color = col * (0.25 + 2.2 * glow) if glow > 0.0 else Color(0.02, 0.03, 0.05)
	(P["leak"] as StandardMaterial3D).albedo_color = col * clampf(glow * 3.0, 0.0, 2.0) if float(A["lid"]) < 0.05 else Color(0.03, 0.03, 0.03)
	var beam: MeshInstance3D = P["beam"]
	beam.visible = float(A["beam"]) > 0.01
	(P["bmat"] as StandardMaterial3D).albedo_color = Color(col.r, col.g, col.b, 0.07 * float(A["beam"]))
	P["sign"].visible = box.roll.is_empty() and box.move.is_empty()
	for q: Label3D in P["marks"]:
		q.modulate = col.lerp(Color(0.75, 0.9, 1.0), 0.4 * glow)
	var disp: Node3D = P["disp"]
	disp.visible = bool(A["gun"])
	if disp.visible:
		var k := int(A["gun_k"])
		var id: String = String(box.roll["result"]) if k < 0 or box.roll.is_empty() else String(_pool_ids[k])
		if box.roll.is_empty():
			id = _gallery_id
		_show_weapon(P, id)
		disp.position = Vector3(0, float(A["gun_y"]), 0)
		disp.rotation.y = float(A["gun_yaw"])
		disp.scale = Vector3.ONE * float(A["gun_scale"])
	var lbl: Label3D = P["name"]
	lbl.visible = bool(A["name"]) and bool(A["blink"]) and not box.roll.is_empty()
	if lbl.visible:
		lbl.text = String(Config.weapon(String(box.roll["result"]))["name"])
		disp.visible = bool(A["blink"])
	var td: Node3D = P["teddy"]
	td.visible = bool(A["teddy"])
	if td.visible:
		td.position = Vector3(0, float(A["teddy_y"]), 0)
		td.rotation = Vector3(0, float(A["teddy_yaw"]), float(A["teddy_shake"]))
	(P["sparks"] as GPUParticles3D).emitting = float(A["sparks"]) > 0.0
	(P["sparks"] as GPUParticles3D).amount_ratio = clampf(float(A["sparks"]), 0.05, 1.0)
	(P["sparks"] as GPUParticles3D).position.y = BoxModel.TOP + float(A["lift"])
	(P["smoke"] as GPUParticles3D).emitting = float(A["smoke"]) > 0.0
	var poof := float(A["poof"]) > 0.0
	if poof and not bool(P.get("poofed", false)):
		var pp: GPUParticles3D = P["poof"]
		pp.position.y = BoxModel.TOP + float(A["lift"])
		pp.restart()
		pp.emitting = true
		Sfx.play("dirt", 0.8, n.global_position + Vector3(0, 1.0, 0))
	P["poofed"] = poof

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

## v0.19.0 (préchauffage, warmup.gd) : montre d'un coup tout ce que la boîte mystère et le Pack-a-Punch affichent par moments (faisceau, nounours, arme et son nom, étincelles)
## pour que leurs pipelines soient compilés sous le voile du chargement. on = vrai : la vue ne se met plus à jour d'elle-même et tout est visible ; faux : elle reprend (le prochain
## _tick remet la visibilité en ordre).
func warm_show(on: bool) -> void:
	set_process(not on)
	if not on:
		for g: Node3D in _gallery.values():
			g.visible = false
			g.position = Vector3.ZERO
		_gallery_id = ""
		for P: Dictionary in _box_parts:
			for k in ["sparks", "smoke", "poof"]:
				(P[k] as GPUParticles3D).emitting = false
		return
	for P: Dictionary in _box_parts:   # v0.29.0 : chest, open lid, inside light, beam, teddy, sparks, smoke, the 23 weapons at once
		(P["node"] as Node3D).visible = true
		(P["body"] as Node3D).visible = true
		(P["lid"] as Node3D).rotation.x = -BoxAnim.LID_OPEN
		(P["beam"] as Node3D).visible = true
		(P["teddy"] as Node3D).visible = true
		(P["disp"] as Node3D).visible = true
		(P["name"] as Label3D).text = "ARME"
		(P["name"] as Label3D).visible = true
		for k in ["sparks", "smoke", "poof"]:
			(P[k] as GPUParticles3D).emitting = true
	if not _box_parts.is_empty():
		var P0: Dictionary = _box_parts[Game.machines.box.active]
		for j in _pool_ids.size():
			var g := _gallery_of(String(_pool_ids[j]))
			if g.get_parent() == null:
				P0["disp"].add_child(g)
			g.position = Vector3((float(j % 6) - 2.5) * 0.4, float(j / 6) * 0.35, 0)
			g.visible = true
	if _pap != null:
		(_pap_parts["gun"] as Node3D).visible = true
		_fill_gun(_pap_parts["gun"], String(_pool_ids[0]), 1)
		_pap_parts["gun_key"] = ""
		for s: MeshInstance3D in _pap_parts["sparks"]:
			s.visible = true

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"machines", _pt)

func _tick(dt: float) -> void:
	_time += dt
	if Game.machines != null:
		var box: MysteryBox = Game.machines.box
		_arrive_t += dt
		if box.active != _last_active:   # v0.29.0 : arrival at a new place (not at the start of the game)
			_arrive_t = 0.0 if _last_active >= 0 else 1.0e9
			_last_active = box.active
			if _arrive_t == 0.0 and box.active < _box_parts.size():
				Sfx.play("knock", 0.9, (_box_parts[box.active]["node"] as Node3D).global_position)
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
