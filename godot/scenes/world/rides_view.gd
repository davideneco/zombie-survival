extends Node3D
## Présentation des motos, des vélos et de la rame (J5) : un VehicleView par machine, un TramView, le décor des parkings (borne de service, panneau « P »)
## et des stations de vélos (arceaux, panneau « VÉLOS »), et le cavalier en primitives quand la caméra regarde de l'extérieur. Ne fait que lire Game.rides.

const TramView := preload("res://scenes/tram_view.gd")

var _vehicle_views: Array = []
var _tram_view: Node3D
var _rider: Node3D              ## repli : cavalier en primitives
var _char: CharacterModel       ## le personnage choisi (null : pas de modèle 3D)
var _holder: Node3D
var _mount_key := ""
var _cull_t := 0.0
var _cam: Camera3D
var _signal_lamps: Array = []   ## [{ straight, diverge, sw }] feux blancs des têtes de signal de l'aiguillage
var _gate_lamps: Array = []     ## [{ gate, red, green, state }] feux des portes de zone sur les voies
var _sub_lamp: MeshInstance3D   ## voyant de la sous-station
var _lamp_mats: Dictionary = {}
var _lamp_t := 0.0
var _sub_on := false

func setup(cam: Camera3D) -> void:
	_cam = cam
	var r: Rides = Game.rides
	if r == null:
		return
	for v in r.vehicles:
		var vv := Node3D.new()
		vv.set_script(VehicleView)
		add_child(vv)
		vv.setup(v)
		_vehicle_views.append(vv)
	await get_tree().process_frame   # v0.34.6 : une image de l'écran de chargement entre les véhicules et la rame (setup est attendu par main.gd)
	for t in r.trams:
		_tram_view = Node3D.new()
		_tram_view.set_script(TramView)
		add_child(_tram_view)
		await _tram_view.setup(t, true)
	for i in r.parkings.size():
		_make_parking(r.parkings[i], i)
	_make_stations(r)
	_make_gate_lamps(r)
	_make_signal_lamps(r)
	_make_rider()
	_built = true

func remember() -> void:
	for vv in _vehicle_views:
		vv.remember()
	if _tram_view != null:
		_tram_view.remember()

# ------------------------------------------------------------------ décor
func _box(parent: Node3D, size: Vector3, m: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = m
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi

func _cyl(parent: Node3D, r: float, h: float, m: Material, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = h
	c.radial_segments = 8
	mi.mesh = c
	mi.material_override = m
	mi.position = pos
	parent.add_child(mi)
	return mi

func _label(parent: Node3D, text: String, size: float, pos: Vector3, rot_y := 0.0) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font_size = 96
	l.pixel_size = size / 96.0
	l.modulate = Color("f4f6f8")
	l.outline_size = 0
	l.position = pos
	l.rotation.y = rot_y
	l.shaded = false
	parent.add_child(l)
	return l

## Borne de service (la borne est exclue de la cuisson du monde ; le panneau « P » et les places peintes en font partie).
func _make_parking(pk: Dictionary, _idx: int) -> void:
	var g := Node3D.new()
	add_child(g)
	var steel := VehicleView.mat(Color("3a3d42"), 0.7, 0.4)
	var pp: Dictionary = pk["pump"]
	var yaw := atan2(pk["x"] - pp["x"], pk["z"] - pp["z"])
	var pump := Node3D.new()
	pump.position = Vector3(pp["x"], 0.0, pp["z"])
	pump.rotation.y = yaw
	g.add_child(pump)
	_box(pump, Vector3(0.75, 1.6, 0.6), VehicleView.mat(Color("c23a2e"), 0.45, 0.3), Vector3(0, 0.8, 0))
	_box(pump, Vector3(0.5, 0.3, 0.04), VehicleView.mat(Color("ffb040"), 0.3, 0.0, 1.5), Vector3(0, 1.3, 0.31))
	_box(pump, Vector3(0.8, 0.12, 0.65), steel, Vector3(0, 1.65, 0))
	_label(pump, "PLEIN", 0.2, Vector3(0, 1.0, 0.31))

## Couleur d'un feu (sans éclairage) ; les feux cuits dans le monde sont recouverts d'un cube un peu plus grand, qui change avec l'état de la porte.
func _lamp_mat(hex: int) -> StandardMaterial3D:
	if not _lamp_mats.has(hex):
		var m := StandardMaterial3D.new()
		m.albedo_color = Config.color(hex)
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_lamp_mats[hex] = m
	return _lamp_mats[hex]

func _lamp_box(pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(0.36, 0.36, 0.36)
	mi.mesh = b
	mi.position = pos
	add_child(mi)
	return mi

## Feux des portes de zone (un mât de chaque côté de la porte, à droite du sens de marche qui l'approche) et voyant de la sous-station : tramNet.js.
func _make_gate_lamps(r: Rides) -> void:
	if r.trams.is_empty():
		return
	var by_id: Dictionary = r.net["by_id"]
	var sig := float(Config.at("tram.gate.signalDist"))
	var o := {}
	for lid: String in r.gates_by:
		if not by_id.has(lid) or by_id[lid].meta.size() > 0:
			continue   # (les itinéraires d'aiguillage reprennent les mêmes portes)
		for gt: Dictionary in r.gates_by[lid]:
			if bool(gt.get("decor", false)):
				continue
			for dir in [-1.0, 1.0]:
				var rs := 1.0 if dir < 0.0 else -1.0
				(by_id[lid] as TramTrack).at(float(gt["s"]) + dir * (sig - 1.0), o)
				var x: float = o["x"] + (-o["tz"] * rs) * 2.7
				var z: float = o["z"] + (o["tx"] * rs) * 2.7
				_gate_lamps.append({"gate": gt, "red": _lamp_box(Vector3(x, 3.25, z)), "green": _lamp_box(Vector3(x, 2.8, z)), "state": null})
	if not r.substation.is_empty():
		var line: TramTrack = r.trams[0].line0
		var p := line.project(r.substation["x"], r.substation["z"], 20.0, {})
		line.at(p["s"], o)
		var ox: float = r.substation["x"] - o["x"]
		var oz: float = r.substation["z"] - o["z"]
		var l := sqrt(ox * ox + oz * oz)
		var nx := -ox / l
		var nz := -oz / l   # vers la voie
		_sub_lamp = _lamp_box(Vector3(r.substation["x"] + o["tx"] * 0.7 + nx * 0.35, 3.7, r.substation["z"] + o["tz"] * 0.7 + nz * 0.35))
		_sub_lamp.material_override = _lamp_mat(0xff2a1a)
		_sub_on = false
	_update_lamps(r, true)

## Têtes de signal de l'aiguillage (tramNet.js) : le monde cuit les montre « tout droit » ; deux cubes un peu plus grands recouvrent leurs feux blancs
## et suivent le réglage (feu « tout droit » en haut au centre, feu « dévié » en haut du côté du virage).
func _make_signal_lamps(r: Rides) -> void:
	for sg: Dictionary in r.signals:
		var rx := -float(sg["tz"])
		var rz := float(sg["tx"])
		var rec := {}
		for k in ["straight", "diverge"]:
			var right := 0.0 if k == "straight" else 0.34 * float(sg["side"])
			var mi := MeshInstance3D.new()
			var b := BoxMesh.new()
			b.size = Vector3(0.31, 0.31, 0.31)
			mi.mesh = b
			mi.position = Vector3(float(sg["x"]) - float(sg["tx"]) * 0.22 + rx * right, 3.42, float(sg["z"]) - float(sg["tz"]) * 0.22 + rz * right)
			add_child(mi)
			rec[k] = mi
		rec["sw"] = -1
		_signal_lamps.append(rec)

func _update_signals(r: Rides) -> void:
	if _signal_lamps.is_empty() or r.trams.is_empty():
		return
	var sw: int = r.trams[0].sw
	for rec: Dictionary in _signal_lamps:
		if int(rec["sw"]) == sw:
			continue
		rec["sw"] = sw
		(rec["straight"] as MeshInstance3D).material_override = _lamp_mat(0x15181c if sw != 0 else 0xf4f4e8)
		(rec["diverge"] as MeshInstance3D).material_override = _lamp_mat(0xf4f4e8 if sw != 0 else 0x15181c)

func _update_lamps(r: Rides, force := false) -> void:
	for e: Dictionary in _gate_lamps:
		var open := r.gate_open(e["gate"])
		if e["state"] == open and not force:
			continue
		e["state"] = open
		(e["red"] as MeshInstance3D).material_override = _lamp_mat(0x2a0a08 if open else 0xff2a1a)
		(e["green"] as MeshInstance3D).material_override = _lamp_mat(0x30ff60 if open else 0x0a2a0f)
	if _sub_lamp != null and (force or _sub_on != r.tram_powered):
		_sub_on = r.tram_powered
		_sub_lamp.material_override = _lamp_mat(0x30ff60 if _sub_on else 0xff2a1a)

func _make_stations(r: Rides) -> void:
	var steel := VehicleView.mat(Color("2a2d33"), 0.6, 0.5)
	var blue := VehicleView.mat(Color("1d5fb4"), 0.5, 0.1, 0.4)
	var by_station := {}
	for v in r.vehicles:
		if v.station >= 0:
			if not by_station.has(v.station):
				by_station[v.station] = []
			by_station[v.station].append(v)
	for st: Dictionary in r.bike_stations:
		var g := Node3D.new()
		g.position = Vector3(st["x"], 0.0, st["z"])
		g.rotation.y = st["yaw"]
		add_child(g)
		var list: Array = by_station.get(int(st["index"]), [])
		var minx := 0.0
		var maxx := 0.0
		for v: VehicleSim in list:   # un arceau (U renversé) par vélo
			var lx := (v.x - float(st["x"])) * cos(float(st["yaw"])) - (v.z - float(st["z"])) * sin(float(st["yaw"]))
			minx = minf(minx, lx)
			maxx = maxf(maxx, lx)
			_cyl(g, 0.02, 0.8, steel, Vector3(lx - 0.28, 0.4, 0.0))
			_cyl(g, 0.02, 0.8, steel, Vector3(lx + 0.28, 0.4, 0.0))
			_box(g, Vector3(0.58, 0.04, 0.04), steel, Vector3(lx, 0.8, 0.0))
		var px := maxx + 0.9
		_cyl(g, 0.04, 2.5, steel, Vector3(px, 1.25, 0.0))
		_box(g, Vector3(0.8, 0.5, 0.05), blue, Vector3(px, 2.3, 0.0))
		_label(g, "VÉLOS", 0.55, Vector3(px, 2.3, 0.04))
		_label(g, "VÉLOS", 0.55, Vector3(px, 2.3, -0.04), PI)

func _make_rider() -> void:
	_rider = Node3D.new()
	_rider.visible = false
	add_child(_rider)
	var shirt := VehicleView.mat(Color("5a6b4a"), 0.9, 0.0)
	var skin := VehicleView.mat(Color("c9a07a"), 0.8, 0.0)
	var pants := VehicleView.mat(Color("2f3640"), 0.9, 0.0)
	_box(_rider, Vector3(0.42, 0.55, 0.26), shirt, Vector3(0, 0.45, 0))
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.12
	sm.height = 0.24
	head.mesh = sm
	head.material_override = skin
	head.position = Vector3(0, 0.88, 0)
	_rider.add_child(head)
	_box(_rider, Vector3(0.16, 0.5, 0.18), pants, Vector3(-0.13, 0.0, -0.18), Vector3(-0.9, 0, 0))
	_box(_rider, Vector3(0.16, 0.5, 0.18), pants, Vector3(0.13, 0.0, -0.18), Vector3(-0.9, 0, 0))
	_box(_rider, Vector3(0.12, 0.45, 0.12), shirt, Vector3(-0.3, 0.45, -0.2), Vector3(-1.1, 0, 0))
	_box(_rider, Vector3(0.12, 0.45, 0.12), shirt, Vector3(0.3, 0.45, -0.2), Vector3(-1.1, 0, 0))

func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"rames", _pt)

var _built := false   ## v0.34.6 : setup attend des images (rame) : rien n'est mis à jour avant la fin
func _tick(dt: float) -> void:
	var r: Rides = Game.rides
	if r == null or not _built:
		return
	_lamp_t -= dt
	if _lamp_t <= 0.0:
		_lamp_t = 0.25
		_update_lamps(r)
		_update_signals(r)
	# machines garées loin : non dessinées (CONFIG.vehicles.*.cullDist) ; une machine conduite reste visible
	_cull_t -= dt
	if _cull_t <= 0.0 and _cam != null:
		_cull_t = 0.25
		var c := _cam.global_position
		for vv in _vehicle_views:
			var v: VehicleSim = vv.sim
			var cd := float(v.def.get("cullDist", 0.0))
			if cd > 0.0 and v.state != "gone":
				vv.visible = v.has_driver() or Vector2(v.x - c.x, v.z - c.z).length() < cd
	# le cavalier : visible si la caméra est assez loin (bras > avatarMin)
	_update_rider(r)

## v0.21.2 : le joueur vu de l'extérieur sur sa machine ou sur sa place de la rame : le modèle 3D du personnage choisi (CharacterModel), assis, enfant de la machine (il
## en suit cap et inclinaison) ou du module de la rame qui porte la place. Repli : le cavalier en primitives si le modèle manque.
func _update_rider(r: Rides) -> void:
	var show_rider: bool = r.ride != null and r.cam.dist > float(Config.at("vehicles.cam.avatarMin"))
	if not show_rider:
		_rider.visible = false
		_unmount_rider()
		return
	var v: Object = r.ride["v"]
	var seat: int = int(r.ride["seat"])
	var cid := String(CharacterDefs.of_slot(int(Game.settings.get_value("char")))["id"])
	if _char != null and _char.id != cid:
		_unmount_rider()
		_char.queue_free()
		_char = null
	if _char == null:
		_char = CharacterModel.create(cid)
	if _char == null:   # modèle absent : cavalier en primitives
		_rider.visible = not v.is_tram()
		if _rider.visible:
			var hip0: Vector3 = v.hip_world(seat)
			_rider.global_position = hip0
			_rider.rotation = Vector3(0, v.yaw, v.lean * 0.6)
		return
	_rider.visible = false
	var parent: Node3D = null
	if v.is_tram():
		parent = _tram_view.module_node(int(v.model_seats[seat]["module"])) if _tram_view != null else null
	else:
		for vv in _vehicle_views:
			if vv.sim == v:
				parent = vv
	if parent == null:
		_unmount_rider()
		return
	var key := "%d:%d" % [v.get_instance_id(), seat]
	if key != _mount_key or _holder == null or _holder.get_parent() != parent:
		_unmount_rider()
		_mount_key = key
		_holder = Node3D.new()
		_holder.name = "Rider"
		parent.add_child(_holder)
		var hp: Array = v.model_seats[seat]["hip"]
		_holder.add_child(_char)
		_char.rotation.y = PI   # le modèle regarde vers +Z, la machine vers -Z
		_char.play(CharacterModel.seat_anim(v.is_tram(), v.type if not v.is_tram() else "tram", v.is_driver(seat)))
		_holder.position = Vector3(float(hp[0]), float(hp[1]) - _char.hip_height(), float(hp[2]))
		_holder.rotation.y = float(v.model_seats[seat].get("ry", 0.0))

func _unmount_rider() -> void:
	if _holder != null:
		if _char != null and _char.get_parent() == _holder:
			_holder.remove_child(_char)
		_holder.queue_free()
		_holder = null
	_mount_key = ""
