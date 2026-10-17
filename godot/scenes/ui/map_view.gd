extends Control
## Carte plein écran (touche M, HUD.drawMap du JS) : plan de la ville, zones (nom proportionnel à la surface), portes fermées avec leur prix,
## lignes et arrêts du tram, bornes de munitions, armes murales, machines, parkings, stations de vélos, véhicules, rame, joueur. Le jeu
## continue pendant que la carte est ouverte. L'image du plan se construit sur un fil de travail dès le début de la partie (MapImage).

const SCALE_KEY := "scale"
const LEGEND := "▲ vous   ● vert : munitions   ● orange : arme murale   ● bleu ? : boîte mystère   P : Pack-a-Punch   ● couleurs : atouts   ■ rouge : porte verrouillée (prix)   P bleu : motos   V turquoise : vélos   ━ lignes de tram   N ↑"
const BIKE := Color("1fa89a")

var _tex: ImageTexture
var _thread: Thread
var _building := false
var _world: World
var player_color := Color("66ff99")

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	UiTheme.fill_rect(self)
	visible = false

## Lance la construction du plan (fil de travail) pour le monde courant.
func prepare() -> void:
	_tex = null
	_world = Game.world
	if _world == null or _building:
		return
	_building = true
	_thread = Thread.new()
	var w := _world
	_thread.start(func() -> Image: return MapImage.build(w))

func ready_image() -> bool:
	return _tex != null

func _process(_dt: float) -> void:
	if _thread != null and not _thread.is_alive():
		var img: Image = _thread.wait_to_finish()
		_thread = null
		_building = false
		if img != null:
			_tex = ImageTexture.create_from_image(img)
	if visible:
		queue_redraw()

func _exit_tree() -> void:
	if _thread != null:
		_thread.wait_to_finish()
		_thread = null

func _track_color(t: TramTrack) -> Color:
	var c: Variant = t.def.get("color", "#dddddd")
	return Color(String(c)) if typeof(c) == TYPE_STRING else Config.color(int(c))

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.82))
	var w: World = Game.world
	if w == null or Game.player == null:
		UiTheme.draw_outlined(self, UiTheme.heading(), Vector2(30, 36), "CARTE INDISPONIBLE (arène de test)", 26, UiTheme.GOLD)
		return
	var crop: Dictionary = w.objects["mapCrop"]
	var scale := float(w.objects["mapView"]["scale"])
	var lay := HudCalc.map_layout(size.x, size.y, crop, scale)
	var k: float = lay["k"]
	if _tex != null:
		draw_texture_rect(_tex, Rect2(float(lay["ox"]), float(lay["oy"]), float(lay["sw"]) * k, float(lay["sh"]) * k), false)
	else:
		UiTheme.draw_outlined(self, UiTheme.body(), size / 2.0, "Chargement du plan…", 20, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, 0)
	var P := func(x: float, z: float) -> Vector2: return HudCalc.map_point(lay, crop, scale, x, z)
	var font := UiTheme.heading()
	var body := UiTheme.body()
	# zones
	var here: int = w.zone_of(Game.player.pos.x, Game.player.pos.z)
	var zones: Array = w.objects["zones"]
	for z: Dictionary in zones:
		var c: Dictionary = z.get("center", {})
		if c.is_empty():
			continue
		var i: int = z["i"]
		var p: Vector2 = P.call(float(c["x"]), float(c["z"]))
		var fs := HudCalc.zone_font_size(float(z.get("area", 0.0)), i == here)
		var col := UiTheme.GOLD if i == here else (Color(1, 1, 1, 0.92) if w.is_zone_open(i) else Color(1, 1, 1, 0.62))
		UiTheme.draw_outlined(self, font, p, String(c["name"]).to_upper(), fs, col, HORIZONTAL_ALIGNMENT_CENTER, 400)
	# portes
	for d: Dictionary in w.doors:
		var open: bool = d["open"]
		var pts: Array = d["points"]
		for pt: Array in pts:
			var q: Vector2 = P.call(float(pt[0]), float(pt[1]))
			draw_rect(Rect2(q - Vector2(2, 2), Vector2(4, 4)), Color(0.31, 0.86, 0.47, 0.6) if open else Color("ff4433"))
		if not open and not pts.is_empty():
			var m: Array = pts[pts.size() / 2]
			var q: Vector2 = P.call(float(m[0]), float(m[1]))
			_padlock(q + Vector2(-22, -14))
			UiTheme.draw_outlined(self, body, q + Vector2(0, -7), str(int(d["price"])), 12, Color("ffb0a0"), HORIZONTAL_ALIGNMENT_CENTER, 80)
	# tram
	if Game.rides != null:
		var tracks: Array = Game.rides.net.get("tracks", [])
		var o := {}
		for t: TramTrack in tracks:
			var line := PackedVector2Array()
			var s := 0.0
			while s <= t.L + 6.0:
				t.at(minf(s, t.L), o)
				line.append(P.call(o["x"], o["z"]))
				s += 6.0
			if line.size() > 1:
				draw_polyline(line, Color(0, 0, 0, 0.75), 5.0, true)
				draw_polyline(line, _track_color(t), 3.0, true)
		for t: TramTrack in tracks:
			for st: Dictionary in t.stops:
				t.at(float(st["s"]), o)
				var q: Vector2 = P.call(o["x"], o["z"])
				draw_rect(Rect2(q - Vector2(3.5, 3.5), Vector2(7, 7)), Color.WHITE)
				draw_rect(Rect2(q - Vector2(3.5, 3.5), Vector2(7, 7)), Color.BLACK, false, 1.5)
				UiTheme.draw_outlined(self, body, q + Vector2(0, 19), String(st["name"]), 11, Color("e6edf5"), HORIZONTAL_ALIGNMENT_CENTER, 140)
	# bornes, armes murales
	for s: Dictionary in w.objects.get("stations", []):
		_icon(P.call(float(s["x"]), float(s["z"])), Color("2a9d4a"), "")
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		_icon(P.call(float(ww["pos"]["x"]), float(ww["pos"]["z"])), Color("d98a2b"), "")
	# parkings et stations de vélos
	for pk: Dictionary in w.objects.get("parkings", []):
		var q: Vector2 = P.call(float(pk["x"]), float(pk["z"]))
		draw_rect(Rect2(q - Vector2(12, 12), Vector2(24, 24)), Color("2a6fd8"))
		draw_rect(Rect2(q - Vector2(12, 12), Vector2(24, 24)), Color.WHITE, false, 2.0)
		draw_string(body, q + Vector2(-12, 6), "P", HORIZONTAL_ALIGNMENT_CENTER, 24, 17, Color.WHITE)
	var vehicles: Array = Game.rides.vehicles if Game.rides != null else []
	for st: Dictionary in w.objects.get("bikeStations", []):
		var n := 0
		for v: VehicleSim in vehicles:
			if v.station == int(st["index"]) and v.state == "ok" and Vector2(v.x - v.spawn["x"], v.z - v.spawn["z"]).length() < 6.0:
				n += 1
		var q: Vector2 = P.call(float(st["x"]), float(st["z"]))
		var a := 1.0 if n > 0 else 0.4
		draw_circle(q, 9, Color(BIKE, a))
		draw_arc(q, 9, 0, TAU, 20, Color(1, 1, 1, a), 2.0, true)
		draw_string(body, q + Vector2(-9, 4.5), "V", HORIZONTAL_ALIGNMENT_CENTER, 18, 13, Color(1, 1, 1, a))
		if int(st["size"]) > 1:
			draw_circle(q + Vector2(9, 8), 5.5, Color("10201e"))
			draw_string(body, q + Vector2(5, 11.2), str(n), HORIZONTAL_ALIGNMENT_CENTER, 8, 9, Color.WHITE)
	for v: VehicleSim in vehicles:
		if v.station >= 0:
			if v.state == "gone" or Vector2(v.x - v.spawn["x"], v.z - v.spawn["z"]).length() < 6.0:
				continue
		var q: Vector2 = P.call(v.x, v.z)
		if v.state == "wreck" or v.state == "gone":
			draw_line(q + Vector2(-6, -6), q + Vector2(6, 6), Color("9aa0a6"), 3.0)
			draw_line(q + Vector2(6, -6), q + Vector2(-6, 6), Color("9aa0a6"), 3.0)
			continue
		var f := v.hp / v.max_hp()
		var col := Color("d83a2e") if f < 0.25 else (Color("e8892b") if f < 0.5 else (BIKE if v.station >= 0 else Color("e0c22e")))
		_icon(q, col, "V" if v.type == "velo" else ("M" if v.type == "moto" else "G"))
	if Game.rides != null:
		for t: TramSim in Game.rides.trams:
			var q: Vector2 = P.call(t.pos.x, t.pos.z)
			var f := t.hp / t.max_hp()
			var col := Color("d83a2e") if f < 0.25 else (Color("e8892b") if f < 0.5 else Color("4aa3ff"))
			if t.state == "wreck":
				draw_line(q + Vector2(-7, -7), q + Vector2(7, 7), Color("9aa0a6"), 3.0)
				draw_line(q + Vector2(7, -7), q + Vector2(-7, 7), Color("9aa0a6"), 3.0)
			else:
				draw_rect(Rect2(q - Vector2(9, 9), Vector2(18, 18)), col)
				draw_rect(Rect2(q - Vector2(9, 9), Vector2(18, 18)), Color.WHITE, false, 2.0)
				draw_string(body, q + Vector2(-9, 4.5), "T", HORIZONTAL_ALIGNMENT_CENTER, 18, 13, Color.WHITE)
		var sub: Dictionary = Game.rides.substation
		if not sub.is_empty():
			_icon(P.call(float(sub["x"]), float(sub["z"])), Color("e8c04a"), "")
	# machines
	if Game.machines != null:
		var active = Game.machines.box.active_box()
		for m: Dictionary in Game.machines.list:
			var type := String(m["type"])
			if type == "box" and m != active:
				continue
			var letter: Variant = m.get("letter")
			var label := "?" if type == "box" else ("P" if type == "pap" else (String(letter) if letter != null else String(m["name"]).substr(0, 1)))
			var cv: Variant = m.get("color")
			var col := Color("3f8fd8") if type == "box" else (Color(String(cv)) if typeof(cv) == TYPE_STRING else (Config.color(int(cv)) if cv != null else Color.WHITE))
			_icon(P.call(float(m["pos"]["x"]), float(m["pos"]["z"])), col, label)
	# joueur : flèche orientée
	var pp: Vector2 = P.call(Game.player.pos.x, Game.player.pos.z)
	var rot := -Game.player.yaw
	var pts := PackedVector2Array([Vector2(0, -12), Vector2(-8, 9), Vector2(0, 4), Vector2(8, 9)])
	for i in pts.size():
		pts[i] = pp + pts[i].rotated(rot)
	draw_colored_polygon(pts, player_color)
	draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2], pts[3], pts[0]]), Color.BLACK, 2.0)
	# titre et légende
	UiTheme.draw_outlined(self, font, Vector2(30, 36), String(w.objects.get("mapTitle", "CARTE")), 26, UiTheme.GOLD)
	draw_string(body, Vector2(30, size.y - 18), LEGEND, HORIZONTAL_ALIGNMENT_LEFT, size.x - 60, 13, Color("cccccc"))

func _icon(p: Vector2, color: Color, label: String) -> void:
	draw_circle(p, 7, color)
	draw_arc(p, 7, 0, TAU, 20, Color.BLACK, 1.5, true)
	if label != "":
		draw_string(UiTheme.body(), p + Vector2(-7, 3.5), label, HORIZONTAL_ALIGNMENT_CENTER, 14, 10, Color.WHITE)

func _padlock(p: Vector2) -> void:
	draw_rect(Rect2(p + Vector2(0, 4), Vector2(9, 7)), Color("ffb0a0"))
	draw_arc(p + Vector2(4.5, 4), 3, PI, TAU, 8, Color("ffb0a0"), 1.5)
