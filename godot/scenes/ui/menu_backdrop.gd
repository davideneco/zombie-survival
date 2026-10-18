extends Control
## Fond animé LÉGER du menu principal (v0.14.0). Aucun monde 3D : un ciel nocturne en dégradé, des étoiles qui scintillent, la lune et son halo,
## trois plans de toits en silhouette (la flèche asymétrique de la cathédrale au plus loin), des bancs de brume qui dérivent, quelques fenêtres
## allumées et des braises qui montent. Tout est construit une fois (quelques nœuds Polygon2D / TextureRect / CPUParticles2D) ; ensuite seules les
## positions de 3 plans et la transparence des étoiles changent à chaque image : le fond coûte presque rien. La « caméra » dérive doucement
## (parallaxe sinusoïdale). `set_active(false)` coupe tout (partie en cours : le jeu est derrière le menu).

const SKY_TOP := Color("04060d")
const SKY_MID := Color("16203a")
const SKY_LOW := Color("6a2e30")        ## lueur rougeâtre de l'horizon (la ville brûle au loin)
const LAYER_COLORS := [Color("26324f"), Color("141b30"), Color("080b14")]
const LAYER_PARALLAX := [10.0, 22.0, 40.0]   ## px d'amplitude de dérive par plan

var _sky: TextureRect
var _stars: Node2D
var _moon: Node2D
var _layers: Array[Node2D] = []
var _fogs: Array[TextureRect] = []
var _windows: Node2D
var _embers: CPUParticles2D
var _vignette: TextureRect
var _t := 0.0
var _w := 0.0
var _h := 0.0
var _star_pts: PackedVector2Array = []
var _star_ph: PackedFloat32Array = []
var _win_pts: Array = []
var _active := true

func _ready() -> void:
	UiTheme.fill_rect(self)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	resized.connect(_rebuild)
	_rebuild()

func set_active(on: bool) -> void:
	_active = on
	visible = on
	set_process(on)
	if _embers != null:
		_embers.emitting = on

func _grad_tex(colors: PackedColorArray, offsets: PackedFloat32Array, radial := false, size := Vector2i(4, 256)) -> GradientTexture2D:
	var g := Gradient.new()
	g.colors = colors
	g.offsets = offsets
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = size.x
	t.height = size.y
	if radial:
		t.fill = GradientTexture2D.FILL_RADIAL
		t.fill_from = Vector2(0.5, 0.5)
		t.fill_to = Vector2(1.0, 0.5)
	else:
		t.fill_from = Vector2(0, 0)
		t.fill_to = Vector2(0, 1)
	return t

func _rebuild() -> void:
	if size.x < 16.0 or size.y < 16.0:
		return
	if is_equal_approx(size.x, _w) and is_equal_approx(size.y, _h):
		return
	_w = size.x
	_h = size.y
	for c in get_children():
		c.queue_free()
	_layers.clear()
	_fogs.clear()
	_win_pts.clear()
	var rng := RandomNumberGenerator.new()
	rng.seed = 1944
	# ciel
	_sky = TextureRect.new()
	_sky.texture = _grad_tex(PackedColorArray([SKY_TOP, SKY_MID, SKY_LOW]), PackedFloat32Array([0.0, 0.55, 1.0]))
	_sky.stretch_mode = TextureRect.STRETCH_SCALE
	UiTheme.fill_rect(_sky)
	_sky.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_sky)
	# étoiles : points tirés une fois, dessinés par un seul nœud ; scintillement = transparence du nœud, deux jeux en opposition de phase
	_stars = Node2D.new()
	add_child(_stars)
	_star_pts.clear()
	_star_ph.clear()
	for i in 150:
		_star_pts.append(Vector2(rng.randf() * _w, rng.randf() * _h * 0.62))
		_star_ph.append(rng.randf() * TAU)
	_stars.draw.connect(_draw_stars.bind(_stars))
	_stars.queue_redraw()
	# lune : halo (dégradé radial) + disque + quelques cratères
	_moon = Node2D.new()
	_moon.position = Vector2(_w * 0.78, _h * 0.2)
	add_child(_moon)
	var halo := TextureRect.new()
	halo.texture = _grad_tex(PackedColorArray([Color(0.75, 0.82, 1.0, 0.32), Color(0.45, 0.55, 0.85, 0.1), Color(0.3, 0.4, 0.7, 0.0)]), PackedFloat32Array([0.0, 0.35, 1.0]), true, Vector2i(128, 128))
	halo.stretch_mode = TextureRect.STRETCH_SCALE
	var hs := _h * 0.9
	halo.position = Vector2(-hs / 2.0, -hs / 2.0)
	halo.size = Vector2(hs, hs)
	halo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_moon.add_child(halo)
	var r := _h * 0.065
	_moon.add_child(_disc(Vector2.ZERO, r, Color("e8edf7")))
	for cr in [[-0.3, -0.25, 0.22], [0.28, 0.1, 0.16], [-0.1, 0.35, 0.12], [0.1, -0.4, 0.09]]:
		_moon.add_child(_disc(Vector2(cr[0], cr[1]) * r, cr[2] * r, Color("c5cde0")))
	# plans de toits : du plus lointain au plus proche
	var horizon := _h * 0.74
	for li in 3:
		var layer := Node2D.new()
		add_child(layer)
		var poly := Polygon2D.new()
		poly.color = LAYER_COLORS[li]
		poly.polygon = _skyline(rng, li, horizon + li * _h * 0.05)
		layer.add_child(poly)
		_layers.append(layer)
		if li == 0:
			_fogs.append(_fog(horizon - _h * 0.06, 0.20))
		elif li == 1:
			_fogs.append(_fog(horizon + _h * 0.02, 0.26))
	# fenêtres allumées sur le plan du milieu
	_windows = Node2D.new()
	_layers[1].add_child(_windows)
	_windows.draw.connect(_draw_windows.bind(_windows))
	_windows.queue_redraw()
	_fogs.append(_fog(horizon + _h * 0.12, 0.34))
	# braises
	_embers = CPUParticles2D.new()
	_embers.amount = 60
	_embers.lifetime = 7.0
	_embers.preprocess = 7.0
	_embers.position = Vector2(_w * 0.5, _h * 1.02)
	_embers.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	_embers.emission_rect_extents = Vector2(_w * 0.55, 4.0)
	_embers.direction = Vector2(0.15, -1.0)
	_embers.spread = 18.0
	_embers.initial_velocity_min = 40.0
	_embers.initial_velocity_max = 110.0
	_embers.gravity = Vector2(6, -4)
	_embers.scale_amount_min = 1.2
	_embers.scale_amount_max = 3.0
	_embers.angular_velocity_min = -90.0
	_embers.angular_velocity_max = 90.0
	var cg := Gradient.new()
	cg.colors = PackedColorArray([Color(1.0, 0.8, 0.35, 0.0), Color(1.0, 0.55, 0.15, 0.95), Color(0.8, 0.2, 0.05, 0.0)])
	cg.offsets = PackedFloat32Array([0.0, 0.15, 1.0])
	_embers.color_ramp = cg
	_embers.emitting = _active
	add_child(_embers)
	# vignette : bords sombres (le titre reste lisible au centre)
	_vignette = TextureRect.new()
	_vignette.texture = _grad_tex(PackedColorArray([Color(0, 0, 0, 0.0), Color(0, 0, 0, 0.0), Color(0, 0, 0, 0.72)]), PackedFloat32Array([0.0, 0.5, 1.0]), true, Vector2i(256, 256))
	_vignette.stretch_mode = TextureRect.STRETCH_SCALE
	UiTheme.fill_rect(_vignette)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_vignette)

func _disc(c: Vector2, r: float, col: Color) -> Polygon2D:
	var p := Polygon2D.new()
	var pts := PackedVector2Array()
	for i in 28:
		var a := TAU * i / 28.0
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	p.polygon = pts
	p.color = col
	return p

func _fog(y: float, alpha: float) -> TextureRect:
	var f := TextureRect.new()
	f.texture = _grad_tex(PackedColorArray([Color(0.55, 0.6, 0.75, 0.0), Color(0.55, 0.6, 0.75, alpha), Color(0.55, 0.6, 0.75, 0.0)]), PackedFloat32Array([0.0, 0.5, 1.0]))
	f.stretch_mode = TextureRect.STRETCH_SCALE
	f.position = Vector2(-_w * 0.25, y - _h * 0.08)
	f.size = Vector2(_w * 1.5, _h * 0.16)
	f.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(f)
	return f

## Silhouette de toits d'un plan (polygone fermé vers le bas de l'écran). Plan 0 : la flèche de la cathédrale ; les plus proches : toits à pignons, mansardes, cheminées.
func _skyline(rng: RandomNumberGenerator, li: int, base_y: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var k := _h / 720.0
	var x := -60.0
	pts.append(Vector2(x, _h + 40.0))
	pts.append(Vector2(x, base_y))
	var spire_x := _w * 0.3
	while x < _w + 60.0:
		var bw := (rng.randf_range(50.0, 120.0) - li * 8.0) * k
		var bh := (rng.randf_range(24.0, 64.0) + (3 - li) * 8.0) * k
		var top := base_y - bh
		if li == 0 and absf(x + bw * 0.5 - spire_x) < bw:   # flèche de Notre-Dame : haute, fine, asymétrique
			var sw := bw * 1.1
			pts.append(Vector2(x, top))
			pts.append(Vector2(x + sw * 0.12, top - 20 * k))
			pts.append(Vector2(x + sw * 0.4, top - 150 * k))
			pts.append(Vector2(x + sw * 0.46, top - 150 * k))
			pts.append(Vector2(x + sw * 0.52, top - 190 * k))
			pts.append(Vector2(x + sw * 0.58, top - 150 * k))
			pts.append(Vector2(x + sw * 0.7, top - 40 * k))
			pts.append(Vector2(x + sw, top - 40 * k))
			pts.append(Vector2(x + sw, top))
			x += sw
			continue
		match rng.randi() % 4:
			0:   # toit plat avec cheminée
				pts.append(Vector2(x, top))
				var cx := x + bw * rng.randf_range(0.2, 0.7)
				pts.append(Vector2(cx, top))
				pts.append(Vector2(cx, top - 12 * k))
				pts.append(Vector2(cx + 8 * k, top - 12 * k))
				pts.append(Vector2(cx + 8 * k, top))
				pts.append(Vector2(x + bw, top))
			1, 2:   # pignon
				pts.append(Vector2(x, top))
				pts.append(Vector2(x + bw * 0.5, top - bw * rng.randf_range(0.28, 0.5)))
				pts.append(Vector2(x + bw, top))
			_:   # mansarde
				pts.append(Vector2(x, top))
				pts.append(Vector2(x + bw * 0.15, top - 14 * k))
				pts.append(Vector2(x + bw * 0.85, top - 14 * k))
				pts.append(Vector2(x + bw, top))
		if li == 1:
			_win_pts.append([x + bw * 0.5, top + bh * 0.4 + base_y * 0.0, rng.randf(), bw])
		x += bw
	pts.append(Vector2(x, base_y))
	pts.append(Vector2(x, _h + 40.0))
	return pts

# `canvas` : le nœud qui émet « draw » (après un _rebuild, l'ancien nœud peut encore émettre : il ne faut pas dessiner sur le nouveau)
func _draw_stars(canvas: CanvasItem) -> void:
	for i in _star_pts.size():
		var s := 1.0 + float(i % 7 == 0)
		canvas.draw_rect(Rect2(_star_pts[i], Vector2(s, s)), Color(0.85, 0.9, 1.0, 0.35 + 0.45 * fmod(_star_ph[i], 1.0)))

func _draw_windows(canvas: CanvasItem) -> void:
	for w: Array in _win_pts:
		if float(w[2]) < 0.55:
			continue
		canvas.draw_rect(Rect2(float(w[0]) - 3.0, float(w[1]), 5.0, 7.0), Color(1.0, 0.72, 0.3, 0.55 + 0.35 * float(w[2])))

func _process(dt: float) -> void:
	if not is_equal_approx(size.x, _w) or not is_equal_approx(size.y, _h):
		_rebuild()
	if not _active or _layers.is_empty():
		return
	_t += dt
	# dérive de la « caméra » : lente, quasi imperceptible, plus forte sur les plans proches
	var pan := Vector2(sin(_t * 0.11), sin(_t * 0.07 + 1.3) * 0.35)
	for i in _layers.size():
		_layers[i].position = pan * float(LAYER_PARALLAX[i])
	_moon.position = Vector2(_w * 0.78, _h * 0.2) + pan * 4.0
	for i in _fogs.size():
		_fogs[i].position.x = -_w * 0.25 + sin(_t * (0.05 + 0.03 * i) + i * 2.0) * _w * 0.12
	_stars.modulate.a = 0.75 + 0.25 * sin(_t * 0.9)
	_windows.modulate.a = 0.85 + 0.15 * sin(_t * 3.1) * sin(_t * 1.7)
