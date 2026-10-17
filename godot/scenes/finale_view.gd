extends Node3D
## Rendu et sons de la fin de partie (src/finale.js : effets des attaques du Bourreau, du Maître Tanneur et de l'Ange, rafales ; src/summit.js : faisceau de la
## flèche, Fanal d'Erwin, soleil de l'Aube). La simulation (FinaleSim, BossSim…) dit quoi arrive par les signaux de Game (boss_event, finale_sfx) ; ici tout est
## en matériaux additifs sans ombre. Aucune règle de jeu.

var camera: Camera3D
var fx: Node3D                     ## FxView : particules
var _fx_list: Array[Dictionary] = []
var _beam: Node3D
var _beam_in: MeshInstance3D
var _beam_out: MeshInstance3D
var _fanal: Node3D
var _flame: Node3D
var _flame_parts: Array[MeshInstance3D] = []
var _fanal_glow: MeshInstance3D
var _fanal_t := 0.0
var _fanal_lit := false
var _feathers: Array[Dictionary] = []
var _gusts: Array[Dictionary] = []
var _iron: StandardMaterial3D

const GOLD := Color("ffd870")
const RED := Color("ff3a20")

func setup(cam: Camera3D, fx_: Node3D) -> void:
	camera = cam
	fx = fx_
	_iron = StandardMaterial3D.new()
	_iron.albedo_color = Color("6a6e76")
	_iron.metallic = 0.9
	_iron.roughness = 0.4
	Game.boss_event.connect(_on_event)
	Game.finale_sfx.connect(_on_sfx)

func clear() -> void:
	for e in _fx_list:
		(e["node"] as Node).queue_free()
	_fx_list.clear()
	for f in _feathers:
		(f["node"] as Node).queue_free()
	_feathers.clear()
	_gusts.clear()
	for n in [_beam, _fanal]:
		if n != null:
			(n as Node).queue_free()
	_beam = null
	_fanal = null
	_fanal_lit = false

# ---------------------------------------------------------------- matériaux et maillages
func _add_mat(c: Color, opacity: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(c.r, c.g, c.b, opacity)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = false
	m.disable_receive_shadows = true
	return m

func _mesh(parent: Node3D, mesh: Mesh, mat: Material, p := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = p
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi

func _alpha(mi: MeshInstance3D, a: float) -> void:
	var m := mi.material_override as StandardMaterial3D
	m.albedo_color.a = a

## Secteur plat (rayon r, demi-angle en degrés) dans le plan XZ, centré sur +Z.
func _sector(r: float, half_deg: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var a := deg_to_rad(half_deg)
	var steps := 20
	for i in steps:
		var a0 := -a + 2.0 * a * i / steps
		var a1 := -a + 2.0 * a * (i + 1) / steps
		st.add_vertex(Vector3.ZERO)
		st.add_vertex(Vector3(sin(a0) * r, 0, cos(a0) * r))
		st.add_vertex(Vector3(sin(a1) * r, 0, cos(a1) * r))
	return st.commit()

func _flat_ring(r0: float, r1: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 40
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var p0 := Vector3(cos(a0), 0, sin(a0))
		var p1 := Vector3(cos(a1), 0, sin(a1))
		st.add_vertex(p0 * r0)
		st.add_vertex(p0 * r1)
		st.add_vertex(p1 * r1)
		st.add_vertex(p0 * r0)
		st.add_vertex(p1 * r1)
		st.add_vertex(p1 * r0)
	return st.commit()

func _flat_quad(w: float, len: float) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(w, len)
	q.orientation = PlaneMesh.FACE_Y
	return q

func _track(kind: String, node: Node3D, life: float, data := {}) -> Dictionary:
	var e := {"kind": kind, "node": node, "t": 0.0, "life": life, "d": data}
	_fx_list.append(e)
	return e

# ---------------------------------------------------------------- évènements
func _near_vol(d: Dictionary) -> float:
	var p := Game.player.pos
	return maxf(0.15, 1.0 - Vector2(float(d.get("x", p.x)) - p.x, float(d.get("z", p.z)) - p.z).length() / 60.0)

func _dust(x: float, y: float, z: float, n: int) -> void:
	fx.emit(Vector3(x, y, z), {"count": n, "color": [Color("9a9a96"), Color("77746f"), Color("5a5650")], "speed": 2.4, "up": 1.6, "size": 0.12, "life": 1.0, "grav": 3.0, "spread": 0.8})

func _on_event(name: String, d: Dictionary) -> void:
	var v := _near_vol(d)
	var x := float(d.get("x", 0.0))
	var y := float(d.get("y", 0.0))
	var z := float(d.get("z", 0.0))
	match name:
		"dust":
			_dust(x, y, z, int(d.get("n", 6)))
		"boss_shock":
			var n := Node3D.new()
			n.position = Vector3(x, y + 0.12, z)
			add_child(n)
			var ring := _mesh(n, _flat_ring(0.9, 1.0), _add_mat(RED, 0.6))
			_track("ring", n, 0.85, {"mi": ring})
			_dust(x, y + 0.2, z, 24)
			_sfx("explosion", v)
			if d.get("toll", 0) != 0:
				_sfx("bell", 1.0)
		"boss_tele":
			var n2 := Node3D.new()
			n2.position = Vector3(x, y + 0.12, z)
			n2.rotation.y = atan2(float(d["dx"]), float(d["dz"]))
			add_child(n2)
			var q := _mesh(n2, _flat_quad(1.8, 22.0), _add_mat(RED, 0.5), Vector3(0, 0, 11.0))
			_track("tele", n2, 1.2, {"mi": q})
			_sfx("rumble", v)
		"boss_roar":
			_sfx("nuke", 1.0)
			_sfx("groan", 1.0)
		"boss_stun":
			_sfx("hit_flesh", 1.0)
			_dust(x, y + 1.0, z, 16)
		"boss_rise":
			_dust(x, y + 0.2, z, 30)
			_sfx("rumble", 1.0)
			_sfx("rumble", 1.0)
		"tanner_vomit":
			var n3 := Node3D.new()
			n3.position = Vector3(x, y + 0.12, z)
			n3.rotation.y = atan2(float(d["dx"]), float(d["dz"]))
			add_child(n3)
			var cone := _mesh(n3, _sector(float(d["range"]), float(d["ang"])), _add_mat(Color("9be022"), 0.4))
			_track("vomit", n3, float(d["tel"]) + float(d["dur"]), {"mi": cone, "d": d})
			_sfx("groan", 1.0)
		"boss_chain":
			var n4 := Node3D.new()
			n4.position = Vector3(x, y + 0.12, z)
			n4.rotation.y = atan2(float(d["dx"]), float(d["dz"]))
			add_child(n4)
			var tel := _mesh(n4, _flat_quad(float(d["w"]), float(d["len"])), _add_mat(RED, 0.5), Vector3(0, 0, float(d["len"]) / 2.0))
			var cyl := CylinderMesh.new()
			cyl.top_radius = 0.07
			cyl.bottom_radius = 0.07
			cyl.height = 1.0
			var link := _mesh(n4, cyl, _iron, Vector3(0, 1.1, 0))
			link.rotation.x = PI / 2.0
			link.visible = false
			var hk := SphereMesh.new()
			hk.radius = 0.22
			hk.height = 0.44
			hk.radial_segments = 4
			hk.rings = 2
			var hook := _mesh(n4, hk, _iron)
			hook.visible = false
			_track("chain", n4, float(d["tel"]) + 0.55, {"tel": tel, "link": link, "hook": hook, "T": float(d["tel"]), "len": float(d["len"])})
			_sfx("rumble", v)
		"boss_mark":
			if float(d.get("dur", 0.0)) > 0.0:
				_sfx("bell", 1.0)
		"boss_axe":
			var n5 := Node3D.new()
			n5.position = Vector3(x, y + 0.12, z)
			n5.rotation.y = atan2(float(d["dx"]), float(d["dz"]))
			add_child(n5)
			var tel5 := _mesh(n5, _flat_quad(float(d["w"]), float(d["len"])), _add_mat(RED, 0.5), Vector3(0, 0, float(d["len"]) / 2.0))
			var spin := Node3D.new()
			n5.add_child(spin)
			var ax := Node3D.new()
			ax.position.y = 1.2
			ax.visible = false
			spin.add_child(ax)
			var hc := CylinderMesh.new()
			hc.top_radius = 0.05
			hc.bottom_radius = 0.06
			hc.height = 1.7
			var h := _mesh(ax, hc, _wood())
			h.rotation.z = PI / 2.0
			var bb := BoxMesh.new()
			bb.size = Vector3(0.14, 0.9, 0.06)
			_mesh(ax, bb, _iron, Vector3(0.7, 0, 0))
			_track("axe", n5, float(d["tel"]) + float(d["flight"]) * 2.0, {"tel": tel5, "spin": spin, "ax": ax, "T": float(d["tel"]), "F": float(d["flight"]), "len": float(d["len"])})
			_sfx("rumble", v)
		"boss_fire":
			for pt: Array in d["pts"]:
				var n6 := Node3D.new()
				n6.position = Vector3(float(pt[0]), y + 0.1, float(pt[1]))
				add_child(n6)
				var rg := _mesh(n6, _flat_ring(float(d["r"]) - 0.18, float(d["r"])), _add_mat(RED, 0.5))
				var dc := CylinderMesh.new()
				dc.top_radius = float(d["r"])
				dc.bottom_radius = float(d["r"])
				dc.height = 0.01
				var disc := _mesh(n6, dc, _add_mat(Color("ff6a18"), 0.0), Vector3(0, -0.08, 0))
				_track("pyre", n6, float(d["tel"]) + float(d["dur"]), {"ring": rg, "disc": disc, "tel": float(d["tel"]), "dur": float(d["dur"]), "r": float(d["r"])})
			_sfx("rumble", maxf(0.3, v))
		"angel_trumpet":
			var n7 := Node3D.new()
			n7.position = Vector3(x, float(d.get("fy", y)) + 0.12, z)
			n7.rotation.y = atan2(float(d["dx"]), float(d["dz"]))
			add_child(n7)
			var sc := _mesh(n7, _sector(float(d["range"]), float(d["ang"])), _add_mat(GOLD, 0.4))
			_track("blast", n7, float(d["tel"]) + float(d["dur"]), {"mi": sc, "d": d, "y": y})
			_sfx("bell", 1.0)
		"angel_plumes":
			for dir: Array in d["dirs"]:
				var q2 := QuadMesh.new()
				q2.size = Vector2(0.16, 0.7)
				var m := MeshInstance3D.new()
				m.mesh = q2
				m.material_override = _add_mat(GOLD, 0.9)
				m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				add_child(m)
				m.position = Vector3(x, y, z)
				_feathers.append({"node": m, "dir": Vector3(dir[0], dir[1], dir[2]), "t": 0.0, "speed": float(d["speed"]), "life": float(d["life"])})
			_sfx("rumble", 0.4)
		"angel_judge":
			var a := Vector3(x, y, z)
			var b := Vector3(float(d["tx"]), float(d["ty"]), float(d["tz"]))
			var len := a.distance_to(b)
			if len > 0.1:
				var cm := CylinderMesh.new()
				cm.top_radius = 0.35
				cm.bottom_radius = 0.35
				cm.height = len
				cm.cap_top = false
				cm.cap_bottom = false
				var n8 := Node3D.new()
				add_child(n8)
				n8.global_position = (a + b) / 2.0
				var ray := _mesh(n8, cm, _add_mat(GOLD, 0.85))
				ray.look_at_from_position(n8.global_position, b, Vector3.UP)
				ray.rotate_object_local(Vector3.RIGHT, PI / 2.0)
				_track("ray", n8, 0.6, {"mi": ray})
				fx.emit(b, {"count": 24, "color": [Color("fff0b0"), Color("ffd060"), Color.WHITE], "speed": 3.0, "up": 2.0, "size": 0.14, "life": 0.9, "grav": 1.0, "spread": 0.7, "glow": true})
				_sfx("explosion", maxf(0.3, 1.0 - Vector2(b.x - Game.player.pos.x, b.z - Game.player.pos.z).length() / 50.0))
		"angel_death":
			fx.emit(Vector3(x, y + 1.0, z), {"count": 60, "color": [Color("fff0b0"), Color("ffd060"), Color.WHITE], "speed": 4.0, "up": 3.0, "size": 0.2, "life": 1.8, "grav": -0.3, "spread": 0.9, "glow": true})
			_sfx("powerup", 1.0)
		"summit_gust":
			_gusts.append({"dx": float(d["dx"]), "dz": float(d["dz"]), "tel": float(d["tel"]), "t": 0.0})
			_sfx("rumble", 0.5)
		"burst":
			fx.emit(Vector3(x, y + 1.0, z), {"count": 26, "color": [Color("7aff3a"), Color("4a9a1a"), Color("b8ff6a")], "speed": 3.4, "up": 2.5, "size": 0.13, "life": 1.1, "grav": 2.0, "spread": 0.5})
			_sfx("explosion", v * 0.6)
		"summit_show":
			show_summit()
		"dawn":
			if _fanal != null:
				_fanal_lit = true

var _wood_mat: StandardMaterial3D
func _wood() -> StandardMaterial3D:
	if _wood_mat == null:
		_wood_mat = StandardMaterial3D.new()
		_wood_mat.albedo_color = Color("4a3220")
		_wood_mat.roughness = 0.85
	return _wood_mat

# ---------------------------------------------------------------- sons
func _sfx(name: String, vol: float, delay := 0.0) -> void:
	if delay > 0.0:
		get_tree().create_timer(delay).timeout.connect(func() -> void: Sfx.play(name, vol))
		return
	Sfx.play(name, vol)

func _on_sfx(name: String, vol: float) -> void:
	match name:
		"bell_x6":
			for k in 6:
				_sfx("bell", vol, k * 0.7)
		"bell_x4":
			for k in 4:
				_sfx("bell", vol, k * 0.9)
		_:
			_sfx(name, vol)

# ---------------------------------------------------------------- sommet : faisceau et Fanal
func show_summit() -> void:
	if _beam == null:
		_beam = Node3D.new()
		add_child(_beam)
		var grad := Gradient.new()
		grad.colors = PackedColorArray([Color(1, 1, 1, 1), Color(0.29, 0.29, 0.29, 1)])
		var inner := CylinderMesh.new()
		inner.top_radius = 0.4
		inner.bottom_radius = 2.4
		inner.height = 260.0
		inner.cap_top = false
		inner.cap_bottom = false
		var outer := CylinderMesh.new()
		outer.top_radius = 1.3
		outer.bottom_radius = 7.5
		outer.height = 260.0
		outer.cap_top = false
		outer.cap_bottom = false
		_beam_in = _mesh(_beam, inner, _add_mat(Color("ffe4a0"), 0.7), Vector3(0, 130, 0))
		_beam_out = _mesh(_beam, outer, _add_mat(Color("ffb860"), 0.32), Vector3(0, 130, 0))
		_beam_in.extra_cull_margin = 16384.0
		_beam_out.extra_cull_margin = 16384.0
	if _fanal == null:
		_build_fanal()

func _build_fanal() -> void:
	var fp := Game.finale.fanal_pos()
	_fanal = Node3D.new()
	_fanal.position = fp
	_fanal.scale = Vector3.ONE * 1.8
	add_child(_fanal)
	var iron := StandardMaterial3D.new()
	iron.albedo_color = Color("3a3d44")
	iron.metallic = 0.9
	iron.roughness = 0.45
	var base := CylinderMesh.new()
	base.top_radius = 0.24
	base.bottom_radius = 0.3
	base.height = 0.09
	_mesh(_fanal, base, iron, Vector3(0, 0.045, 0))
	var neck := CylinderMesh.new()
	neck.top_radius = 0.15
	neck.bottom_radius = 0.06
	neck.height = 0.16
	_mesh(_fanal, neck, iron, Vector3(0, 0.17, 0))
	for i in 6:
		var a := float(i) / 6.0 * TAU
		var bar := CylinderMesh.new()
		bar.top_radius = 0.012
		bar.bottom_radius = 0.012
		bar.height = 0.62
		_mesh(_fanal, bar, iron, Vector3(cos(a) * 0.2, 0.4, sin(a) * 0.2))
	for yy in [0.12, 0.38, 0.64]:
		var tor := TorusMesh.new()
		tor.inner_radius = 0.188
		tor.outer_radius = 0.212
		_mesh(_fanal, tor, iron, Vector3(0, yy, 0))
	var roof := CylinderMesh.new()
	roof.top_radius = 0.0
	roof.bottom_radius = 0.25
	roof.height = 0.2
	_mesh(_fanal, roof, iron, Vector3(0, 0.8, 0))
	_flame = Node3D.new()
	_flame.position.y = 0.2
	_fanal.add_child(_flame)
	_flame_parts.clear()
	for spec in [[0.16, 0.62, "ff6a18", 0.55], [0.1, 0.46, "ffc050", 0.7], [0.05, 0.3, "fff4d0", 0.9]]:
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = float(spec[0])
		cm.height = float(spec[1])
		_flame_parts.append(_mesh(_flame, cm, _add_mat(Color(String(spec[2])), float(spec[3])), Vector3(0, float(spec[1]) / 2.0, 0)))
	var gs := SphereMesh.new()
	gs.radius = 0.5
	gs.height = 1.0
	_fanal_glow = _mesh(_flame, gs, _add_mat(Color("ffa040"), 0.0), Vector3(0, 0.4, 0))

static func _sm(x: float) -> float:
	return x * x * (3.0 - 2.0 * x)

# ---------------------------------------------------------------- chaque image
func _process(dt: float) -> void:
	_update_fx(dt)
	_update_feathers(dt)
	_update_gusts(dt)
	_update_summit(dt)

func _update_fx(dt: float) -> void:
	for i in range(_fx_list.size() - 1, -1, -1):
		var e: Dictionary = _fx_list[i]
		e["t"] = float(e["t"]) + dt
		var t := float(e["t"])
		var d: Dictionary = e["d"]
		var n := e["node"] as Node3D
		var done := t > float(e["life"])
		match String(e["kind"]):
			"ring":
				var k := minf(1.0, t / 0.85)
				n.scale = Vector3.ONE * (1.0 + k * 13.0)
				_alpha(d["mi"], 0.6 * (1.0 - k))
				done = k >= 1.0
			"tele":
				_alpha(d["mi"], 0.25 + 0.45 * absf(sin(t * 12.0)))
			"vomit":
				var vd: Dictionary = d["d"]
				if t < float(vd["tel"]):
					_alpha(d["mi"], 0.3 + 0.4 * absf(sin(t * 12.0)))
				else:
					_alpha(d["mi"], 0.18)
					fx.emit(n.position + Vector3(float(vd["dx"]) * 1.3, 2.0, float(vd["dz"]) * 1.3), {"count": 3, "color": [Color("9cff3a"), Color("6ab81a"), Color("c8ff70")], "speed": 1.8, "up": 0.6, "size": 0.09, "life": 0.9, "grav": 5.0, "normal": Vector2(float(vd["dx"]), float(vd["dz"])), "push": float(vd["range"]) * 0.9, "spread": 0.3})
			"chain":
				var tel := d["tel"] as MeshInstance3D
				if t < float(d["T"]):
					_alpha(tel, 0.25 + 0.45 * absf(sin(t * 14.0)))
				else:
					tel.visible = false
					var u := minf(1.0, (t - float(d["T"])) / 0.18)
					var L := maxf(0.01, float(d["len"]) * u)
					var link := d["link"] as MeshInstance3D
					var hook := d["hook"] as MeshInstance3D
					link.visible = true
					hook.visible = true
					link.scale = Vector3(1.0, L, 1.0)
					link.position = Vector3(0, 1.1, L / 2.0)
					hook.position = Vector3(0, 1.1, L)
			"axe":
				var tel2 := d["tel"] as MeshInstance3D
				if t < float(d["T"]):
					_alpha(tel2, 0.25 + 0.45 * absf(sin(t * 12.0)))
				else:
					tel2.visible = false
					(d["ax"] as Node3D).visible = true
					var f := t - float(d["T"])
					var total := float(d["F"]) * 2.0
					var u2 := f / float(d["F"]) if f < float(d["F"]) else (total - f) / float(d["F"])
					var sp := d["spin"] as Node3D
					sp.position.z = clampf(u2, 0.0, 1.0) * float(d["len"])
					sp.rotation.z = f * 22.0
			"pyre":
				if t < float(d["tel"]):
					_alpha(d["ring"], 0.2 + 0.5 * absf(sin(t * 10.0)))
				else:
					var live := t - float(d["tel"])
					_alpha(d["ring"], 0.8)
					var fade := (float(d["dur"]) - live) / 0.8 if live > float(d["dur"]) - 0.8 else 1.0
					_alpha(d["disc"], minf(0.55, live * 2.0) * fade * (0.85 + 0.15 * sin(live * 13.0)))
					if randf() < dt * 24.0:
						var r := float(d["r"])
						fx.emit(n.position + Vector3((randf() - 0.5) * r * 1.5, 0.2, (randf() - 0.5) * r * 1.5), {"count": 1, "color": [Color("ff8a20"), Color("ff4a10"), Color("ffc060")], "speed": 0.5, "up": 2.6, "size": 0.2, "life": 0.8, "grav": -1.0, "spread": 0.2})
			"blast":
				var bd: Dictionary = d["d"]
				if t < float(bd["tel"]):
					_alpha(d["mi"], 0.25 + 0.4 * absf(sin(t * 12.0)))
				else:
					var live2 := t - float(bd["tel"])
					_alpha(d["mi"], 0.55 * (1.0 - live2 / float(bd["dur"])))
					fx.emit(Vector3(n.position.x + float(bd["dx"]) * 1.2, float(d["y"]) - 0.6, n.position.z + float(bd["dz"]) * 1.2), {"count": 4, "color": [Color("fff0b0"), Color("ffd060"), Color.WHITE], "speed": 1.5, "up": 0.1, "size": 0.16, "life": 0.7, "grav": 0.0, "normal": Vector2(float(bd["dx"]), float(bd["dz"])), "push": float(bd["range"]) * 1.3, "spread": 0.25, "glow": true})
			"ray":
				var mi := d["mi"] as MeshInstance3D
				_alpha(mi, 0.85 * maxf(0.0, 1.0 - t / 0.6))
				mi.scale = Vector3(1.0 + t * 1.5, 1.0, 1.0 + t * 1.5)
		if done:
			n.queue_free()
			_fx_list.remove_at(i)

func _update_feathers(dt: float) -> void:
	for i in range(_feathers.size() - 1, -1, -1):
		var f: Dictionary = _feathers[i]
		f["t"] = float(f["t"]) + dt
		var m := f["node"] as MeshInstance3D
		var np := m.position + (f["dir"] as Vector3) * float(f["speed"]) * dt
		var gone := float(f["t"]) > float(f["life"]) or np.y < 0.0
		var ax := Cathedral.tower_axis()
		var mid := (m.position + np) / 2.0
		if not gone and mid.y >= Cathedral.TOWER_TOP - 0.3 and Vector2(mid.x - ax.x, mid.z - ax.y).length() < Cathedral.spire_radius(mid.y) - 0.15:
			gone = true   # arrêtée par la flèche
		m.position = np
		if (f["dir"] as Vector3).length() > 0.0:
			m.look_at(np + f["dir"], Vector3.UP)
		if gone:
			m.queue_free()
			_feathers.remove_at(i)

func _update_gusts(dt: float) -> void:
	for i in range(_gusts.size() - 1, -1, -1):
		var gu: Dictionary = _gusts[i]
		gu["t"] = float(gu["t"]) + dt
		var p := Game.player
		if float(gu["t"]) < float(gu["tel"]):
			if Game.finale != null and p.region == int(Game.finale.R.get("RAMP", -1)) and randf() < dt * 40.0:   # traînées blanches de l'annonce
				for _k in 3:
					fx.emit(p.pos + Vector3(-float(gu["dx"]) * 3.0 + (randf() - 0.5) * 6.0, 0.5 + randf() * 2.2, -float(gu["dz"]) * 3.0 + (randf() - 0.5) * 6.0), {"count": 1, "color": [Color("e8f0ff"), Color("c8d8f0")], "speed": 0.4, "up": 0.2, "size": 0.07, "life": 0.9, "grav": 0.0, "normal": Vector2(float(gu["dx"]), float(gu["dz"])), "push": 9.0, "spread": 0.5, "glow": true})
		else:
			_gusts.remove_at(i)

func _update_summit(dt: float) -> void:
	if _beam != null:
		var k := Game.finale.sky_k if Game.finale != null else 0.0
		var pulse := 0.9 + 0.1 * sin(Time.get_ticks_msec() / 1000.0 * 2.4)
		var fade := 1.0 - 0.55 * _sm(maxf(0.0, k - 0.3) / 0.7)
		var w := 1.7 if Game.finale != null and Game.finale.dawn_on else 1.0   # ignition : plus large et plus clair
		_alpha(_beam_in, 0.7 * pulse * fade * minf(1.3, w))
		_alpha(_beam_out, 0.32 * pulse * fade * w)
		# visible de toute la ville sans reculer le plan de coupe : le faisceau est homothétique de la caméra, de rapport f <= 1 (summit.js step)
		var ax := Cathedral.tower_axis()
		var c := camera.global_position
		var y0 := Cathedral.TOWER_NEEDLE + 0.5
		var dx := ax.x - c.x
		var dz := ax.y - c.z
		var f := minf(1.0, float(Config.at("summit.beamFit")) / sqrt(dx * dx + dz * dz + (y0 + 260.0 - c.y) * (y0 + 260.0 - c.y)))
		_beam.global_position = Vector3(c.x + dx * f, c.y + (y0 - c.y) * f, c.z + dz * f)
		_beam.scale = Vector3(w * f, f, w * f)
	if _fanal != null and Game.finale != null:
		_fanal_t += dt
		var p := clampf(float(Game.finale.f.get("fan", 0.0)) if Game.finale.active() else 1.0, 0.0, 1.0)
		var lit := _fanal_lit or Game.finale.dawn_on
		var target := 1.0 if lit else 0.18 + 0.82 * p
		var flick := 0.9 + 0.1 * sin(_fanal_t * 17.0) + 0.05 * sin(_fanal_t * 29.0)
		var s := 2.2 if lit else target * 1.25
		_flame.scale = Vector3(s, s * flick * (1.5 if lit else 1.0), s)
		_alpha(_flame_parts[0], 0.75 if lit else 0.25 + 0.35 * p)
		_alpha(_flame_parts[1], 0.9 if lit else 0.35 + 0.4 * p)
		_alpha(_flame_parts[2], 1.0 if lit else 0.4 + 0.5 * p)
		_alpha(_fanal_glow, 0.22 if lit else 0.2 * p)
		_fanal_glow.scale = Vector3.ONE * (1.5 if lit else 0.7 + 0.6 * p)
		if lit and randf() < dt * 30.0:
			fx.emit(_fanal.position + Vector3(0, 1.6, 0), {"count": 1, "color": [Color("ffc060"), Color("fff0c0"), Color("ff8a20")], "speed": 0.5, "up": 2.6, "size": 0.1, "life": 1.2, "grav": -1.0, "spread": 0.3, "glow": true})
