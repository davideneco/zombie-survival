extends Node3D
## J9 : effets visuels légers (port de src/fx.js) : particules instanciées (sang en gouttes, fumée douce, poussière, éclats, étincelles, flammes), taches de sang
## persistantes au sol ET sur les murs, lueur d'explosion. Deux réserves de particules (éclairée : 280 ; sans éclairage : 220) en MultiMesh de quadrilatères tournés
## vers la caméra dans le shader (fx_particle.gdshader), et un seul MultiMesh pour les 64 taches (fx_decal.gdshader). Purement visuel : ne lit que les signaux
## de Game (impact, explosion, zombie_event, zombie_killed) et les zombies morts ; son propre générateur aléatoire (la simulation n'est jamais touchée).

const GfxAssets := preload("res://scenes/gfx_assets.gd")
static var PARTICLE: Shader:
	get: return load("res://shaders/fx_particle.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
static var DECAL: Shader:
	get: return load("res://shaders/fx_decal.gdshader")   # v0.34.3: loaded on first use (a preload would load it with the main scene, before the menu)
const N := 280
const NG := 220
const DECALS := 64
const STRIDE := 20      ## floats par instance : transformation 3 x 4, couleur, données personnalisées
## cellules de l'atlas : 0 bouffée, 1 goutte, 2 étoile, 3 éclat, 4 éclaboussure, 5 étincelle, 6 braise, 7 bouffée 2
const PUFF := 0
const DROP := 1
const SHARD := 3
const SPARK := 5
const EMBER := 6
const PUFF2 := 7
const SIZE_K := [4.2, 2.3, 5.0, 2.2, 3.0, 1.8, 3.2, 4.6]   # taille visuelle / `size` des appels

var camera: Camera3D
var part_k := 1.0                  ## part des particules émises (qualité)
var decal_max := 36                ## taches gardées (qualité)
var emitted := 0                   ## total émis (mesures)
var _rng := RandomNumberGenerator.new()
var _pools: Array[Dictionary] = []
var _decal_mm: MultiMesh
var _decal_buf: PackedFloat32Array
var _decals: Array[Dictionary] = []
var _decal_cursor := 0
var _boom_light: OmniLight3D
var _boom_t := 0.0
var _boom_energy := 0.0
var _dead_marked: Dictionary = {}  ## id de zombie -> tache de mort déjà posée
var _rumble: Dictionary = {}       ## id de zombie -> délai avant la prochaine poignée de terre

func setup(cam: Camera3D) -> void:
	camera = cam
	_rng.randomize()
	var atlas := GfxAssets.texture("fx_atlas.png")
	_pools = [_make_pool(N, true, atlas), _make_pool(NG, false, atlas)]
	_make_decals()
	_boom_light = OmniLight3D.new()
	_boom_light.light_color = Color("ffa040")
	_boom_light.omni_range = 18.0
	_boom_light.omni_attenuation = 2.0   # décroissance 2 du PointLight(0xffa040, 0, 18, 2) du JS
	_boom_light.light_energy = 0.0
	_boom_light.shadow_enabled = false
	add_child(_boom_light)
	Game.impact.connect(_on_impact)
	Game.explosion.connect(func(pos: Vector3, radius: float, color: int) -> void: explosion(pos, radius, color))
	Game.zombie_killed.connect(func(z: ZombieSim, head: bool) -> void:
		if head:
			blood(z.pos + Vector3(0, 1.55, 0), true))
	Game.zombie_event.connect(_on_zombie_event)
	Game.settings.changed.connect(func(key: String) -> void:
		if key == "quality":
			set_quality(int(Game.settings.get_value("quality"))))
	set_quality(int(Game.settings.get_value("quality")))

func set_quality(q: int) -> void:
	part_k = float(GraphicsRules.level(q)["particles"])
	decal_max = GraphicsRules.decal_max(q)
	for i in range(decal_max, DECALS):
		_kill_decal(i)
	if _decal_cursor >= decal_max:
		_decal_cursor = 0

func clear() -> void:
	for pool in _pools:
		for p: Dictionary in pool["parts"]:
			p["life"] = 0.0
		pool["active"] = 0
		_write_pool(pool)
	for i in DECALS:
		_kill_decal(i)
	_dead_marked.clear()

# ---------------------------------------------------------------- construction
func _make_pool(n: int, lit: bool, atlas: Texture2D) -> Dictionary:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	mm.mesh = quad
	mm.instance_count = n
	var mat := ShaderMaterial.new()
	mat.shader = PARTICLE
	mat.set_shader_parameter("atlas", atlas)
	mat.set_shader_parameter("lit", lit)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-2000, -50, -2000), Vector3(4000, 400, 4000))
	add_child(mmi)
	var parts: Array[Dictionary] = []
	for i in n:
		parts.append({"life": 0.0, "max": 1.0, "x": 0.0, "y": 0.0, "z": 0.0, "vx": 0.0, "vy": 0.0, "vz": 0.0, "size": 0.05, "rot": 0.0, "spin": 0.0,
			"grav": 12.0, "cell": 0, "grow": 0.0, "color": Color.WHITE})
	var buf := PackedFloat32Array()
	buf.resize(n * STRIDE)
	var pool := {"mm": mm, "parts": parts, "n": n, "cursor": 0, "active": 0, "buf": buf}
	_write_pool(pool)
	return pool

func _make_decals() -> void:
	_decal_mm = MultiMesh.new()
	_decal_mm.transform_format = MultiMesh.TRANSFORM_3D
	_decal_mm.use_colors = true
	_decal_mm.use_custom_data = true
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	_decal_mm.mesh = quad
	_decal_mm.instance_count = DECALS
	var mat := ShaderMaterial.new()
	mat.shader = DECAL
	mat.set_shader_parameter("atlas", GfxAssets.texture("fx_splat.png"))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _decal_mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-2000, -50, -2000), Vector3(4000, 400, 4000))
	add_child(mmi)
	_decal_buf = PackedFloat32Array()
	_decal_buf.resize(DECALS * STRIDE)
	for i in DECALS:
		_decals.append({"life": 0.0, "max": 1.0, "xf": Transform3D.IDENTITY, "color": Color("4a0707"), "cell": 0})
		_put_decal_buf(i, true)
	_decal_mm.buffer = _decal_buf

# ---------------------------------------------------------------- tampons
## Écrit une instance (transformation 3 x 4 par lignes, couleur, données personnalisées) dans un tampon.
static func _put(buf: PackedFloat32Array, i: int, xf: Transform3D, col: Color, custom: Color) -> void:
	var o := i * STRIDE
	var b := xf.basis
	buf[o] = b.x.x
	buf[o + 1] = b.y.x
	buf[o + 2] = b.z.x
	buf[o + 3] = xf.origin.x
	buf[o + 4] = b.x.y
	buf[o + 5] = b.y.y
	buf[o + 6] = b.z.y
	buf[o + 7] = xf.origin.y
	buf[o + 8] = b.x.z
	buf[o + 9] = b.y.z
	buf[o + 10] = b.z.z
	buf[o + 11] = xf.origin.z
	buf[o + 12] = col.r
	buf[o + 13] = col.g
	buf[o + 14] = col.b
	buf[o + 15] = col.a
	buf[o + 16] = custom.r
	buf[o + 17] = custom.g
	buf[o + 18] = custom.b
	buf[o + 19] = custom.a

func _write_pool(pool: Dictionary) -> void:
	var buf: PackedFloat32Array = pool["buf"]
	var parts: Array = pool["parts"]
	var zero := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)
	for i in int(pool["n"]):
		var p: Dictionary = parts[i]
		if float(p["life"]) <= 0.0:
			_put(buf, i, zero, Color.WHITE, Color(0, 0, 0, 0))
	(pool["mm"] as MultiMesh).buffer = buf

func _put_decal_buf(i: int, dead: bool) -> void:
	var d: Dictionary = _decals[i]
	if dead:
		_put(_decal_buf, i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO), Color.WHITE, Color(0, 0, 0, 0))
	else:
		_put(_decal_buf, i, d["xf"], d["color"], Color(float(d["cell"]), 0.85, 0.0, 0.0))

# ---------------------------------------------------------------- émission
## Émet `count` particules autour de pos (fx.js emit). Options : count, color (Color ou Array de Color), speed, up, size, life, normal (Vector2), push, grav, spread, glow, grow, cell.
func emit(pos: Vector3, o: Dictionary) -> void:
	var count: int = o.get("count", 8)
	var colors: Array = o["color"] if o.get("color") is Array else [o.get("color", Color.WHITE)]
	var speed: float = o.get("speed", 3.0)
	var up: float = o.get("up", 2.0)
	var psize: float = o.get("size", 0.06)
	var life: float = o.get("life", 0.8)
	var nrm: Vector2 = o.get("normal", Vector2.ZERO)
	var push: float = o.get("push", 0.0)
	var grav: float = o.get("grav", 12.0)
	var spread: float = o.get("spread", 0.1)
	var glow: bool = o.get("glow", false)
	var grow: float = o.get("grow", 0.0)
	var pool: Dictionary = _pools[1 if glow else 0]
	var n := GraphicsRules.emit_count(count, part_k)
	var cell_o: Variant = o.get("cell", null)
	if cell_o == null:
		var c0: Color = colors[0]
		var warm := c0.r > 0.7 and c0.b < 0.75 and c0.r > c0.b + 0.15
		cell_o = (EMBER if warm else PUFF) if glow else (SHARD if psize < 0.07 else PUFF)
	for _i in n:
		var idx: int = pool["cursor"]
		pool["cursor"] = (idx + 1) % int(pool["n"])
		var p: Dictionary = (pool["parts"] as Array)[idx]
		if float(p["life"]) <= 0.0:
			pool["active"] += 1
		var l := life * (0.6 + _rng.randf() * 0.6)
		p["life"] = l
		p["max"] = l
		p["x"] = pos.x + (_rng.randf() - 0.5) * spread
		p["y"] = pos.y + (_rng.randf() - 0.5) * spread
		p["z"] = pos.z + (_rng.randf() - 0.5) * spread
		var a := _rng.randf() * TAU
		var s := speed * (0.3 + _rng.randf() * 0.7)
		p["vx"] = cos(a) * s + nrm.x * push
		p["vz"] = sin(a) * s + nrm.y * push
		p["vy"] = up * (0.4 + _rng.randf() * 0.9)
		var cc: int = (cell_o[_rng.randi() % (cell_o as Array).size()] if cell_o is Array else int(cell_o))
		p["cell"] = cc
		p["size"] = psize * float(SIZE_K[cc]) * (0.55 + _rng.randf() * 0.9)
		p["grow"] = grow
		p["rot"] = _rng.randf() * TAU
		p["spin"] = (_rng.randf() - 0.5) * (2.0 if cc == PUFF or cc == PUFF2 else 8.0)
		p["grav"] = grav
		p["color"] = (colors[_rng.randi() % colors.size()] as Color).srgb_to_linear()   # couleurs du JS : hexadécimal sRGB converti en linéaire par Three.js
		emitted += 1

func blood(pos: Vector3, big := false) -> void:
	emit(pos, {"count": 22 if big else 8, "color": [Color("7a0a0a"), Color("5c0606"), Color("990d0d")], "speed": 3.2 if big else 1.8, "up": 4.0 if big else 2.0, "size": 0.05, "life": 0.9, "cell": DROP})
	emit(pos, {"count": 4 if big else 2, "color": [Color("5c0606"), Color("7a0a0a")], "speed": 0.5, "up": 0.6, "size": 0.06, "life": 0.7, "grav": 0.5, "grow": 1.2, "cell": PUFF2})

func dust(pos: Vector3) -> void:
	emit(pos, {"count": 4, "color": [Color("9a9a96"), Color("77746f")], "speed": 1.2, "up": 1.2, "size": 0.04, "life": 0.6, "grav": 3.0, "grow": 1.5, "cell": [PUFF, PUFF2]})
	emit(pos, {"count": 3, "color": [Color("9a9a96"), Color("77746f")], "speed": 1.6, "up": 1.4, "size": 0.03, "life": 0.45, "grav": 8.0, "cell": SHARD})

func dirt(pos: Vector3, count := 18) -> void:
	emit(pos, {"count": count, "color": [Color("3b2f24"), Color("2a2119"), Color("4a3b2c")], "speed": 2.4, "up": 4.0, "size": 0.05, "life": 1.1, "spread": 0.7, "cell": [SHARD, PUFF2, SHARD]})

func glass(pos: Vector3, nx: float, nz: float) -> void:
	emit(pos, {"count": 36, "color": [Color("bfd6e6"), Color("8fb0c4"), Color("dbe8f0")], "speed": 1.6, "up": 2.2, "size": 0.06, "life": 1.4, "normal": Vector2(nx, nz), "push": 3.2, "spread": 0.9, "cell": SHARD})

## Explosion : fumée, débris, étincelles, éclair lumineux (une lumière réutilisée), trace au sol. (La boule de feu est celle de weapon_view.gd.)
func explosion(pos: Vector3, radius := 5.0, color := 0xff8a2a) -> void:
	var col := Config.color(color)
	_boom_light.light_color = col
	_boom_light.global_position = pos + Vector3(0, maxf(1.0, 0.8), 0)
	_boom_energy = 140.0 / PI   # intensité 140 du JS, divisée par pi (diffusion de Three.js)
	_boom_t = 0.35
	var p0 := pos + Vector3(0, 0.3, 0)
	emit(p0, {"count": 22, "color": [Color("2b2621"), Color("3d342b"), Color("1a1714")], "speed": 5.0, "up": 5.5, "size": 0.14, "life": 1.7, "spread": 0.8, "grav": 1.5, "grow": 1.4, "cell": PUFF})
	emit(p0, {"count": 16, "color": [Color("2b2621"), Color("3d342b")], "speed": 7.0, "up": 7.0, "size": 0.05, "life": 1.2, "spread": 0.8, "cell": SHARD})
	emit(p0, {"count": 18, "color": [col, Color("ffd27a")], "speed": 5.0, "up": 4.0, "size": 0.05, "life": 0.6, "grav": 4.0, "cell": SPARK, "glow": true})
	decal(pos.x, pos.z, radius * 0.5, Color("0d0b09"))

# ---------------------------------------------------------------- taches
func _put_decal(xf: Transform3D, cell: int, color: Color, life := 30.0) -> void:
	var i := _decal_cursor
	_decal_cursor = (_decal_cursor + 1) % maxi(1, decal_max)
	var d: Dictionary = _decals[i]
	d["life"] = life
	d["max"] = life
	d["xf"] = xf
	d["color"] = color.srgb_to_linear()
	d["cell"] = cell
	_put_decal_buf(i, false)
	_decal_dirty = true

func _kill_decal(i: int) -> void:
	_decals[i]["life"] = 0.0
	_put_decal_buf(i, true)
	_decal_dirty = true

## Tache au sol.
func decal(x: float, z: float, size := 1.6, color := Color("4a0707")) -> void:
	var sc := size * (0.8 + _rng.randf() * 0.5)
	var b := Basis(Vector3.RIGHT, -PI / 2.0) * Basis(Vector3.BACK, _rng.randf() * TAU)
	_put_decal(Transform3D(b.scaled_local(Vector3(sc, sc, 1.0)), Vector3(x, 0.02 + _rng.randf() * 0.004, z)), _rng.randi() % 4, color)

## Tache sur un mur, au point p, tournée vers (nx, nz) (la normale approchée du mur : vers le tireur).
func wall_decal(p: Vector3, nx: float, nz: float, size := 0.9, color := Color("4a0707")) -> void:
	var sc := size * (0.7 + _rng.randf() * 0.6)
	var n := Vector3(nx, 0, nz).normalized()
	var b := Basis(Quaternion(Vector3.BACK, n)) * Basis(Vector3.BACK, _rng.randf() * TAU)
	_put_decal(Transform3D(b.scaled_local(Vector3(sc, sc, 1.0)), p + n * 0.03), _rng.randi() % 4, color, 24.0)

# ---------------------------------------------------------------- signaux
func _on_impact(pos: Vector3, flesh: bool, big: bool) -> void:
	if not flesh:
		dust(pos)
		return
	blood(pos, big)
	# tache sur le mur derrière la cible (zombie.js / main.js _bloodWall) : rayon horizontal dans le sens du tir
	if Game.world == null or camera == null or _rng.randf() > (0.9 if big else 0.4):
		return
	var dx := pos.x - camera.global_position.x
	var dz := pos.z - camera.global_position.z
	var h := sqrt(dx * dx + dz * dz)
	if h < 0.5:
		return
	var ux := dx / h
	var uz := dz / h
	var t: float = Game.world.ray_hit(pos.x, pos.y, pos.z, ux, 0.0, uz, 4.5)
	if t >= 4.4:
		return
	wall_decal(Vector3(pos.x + ux * t, pos.y + (_rng.randf() - 0.5) * 0.5, pos.z + uz * t), -ux, -uz, 0.55 + _rng.randf() * 0.8)

func _on_zombie_event(z: ZombieSim, name: String) -> void:
	match name:
		"glass":
			glass(z.spawn_center, z.spawn_normal.x, z.spawn_normal.y)
		"emerge":
			dirt(Vector3(z.spawn_pos.x, 0.3, z.spawn_pos.z), 26)

# ---------------------------------------------------------------- chaque image
func _process(dt: float) -> void:
	var _pt := PerfLog.t()
	_tick(dt)
	PerfLog.add(&"fx", _pt)

func _tick(dt: float) -> void:
	for pool: Dictionary in _pools:
		if int(pool["active"]) > 0:
			_step_pool(pool, dt)
	if _boom_t > 0.0:
		_boom_t -= dt
		_boom_light.light_energy = maxf(0.0, _boom_t / 0.35) * _boom_energy
	_step_decals(dt)
	_zombie_marks(dt)

func _step_pool(pool: Dictionary, dt: float) -> void:
	var buf: PackedFloat32Array = pool["buf"]
	var parts: Array = pool["parts"]
	var zero := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)
	for i in int(pool["n"]):
		var p: Dictionary = parts[i]
		if float(p["life"]) <= 0.0:
			continue
		p["life"] = float(p["life"]) - dt
		if float(p["life"]) <= 0.0:
			pool["active"] = int(pool["active"]) - 1
			_put(buf, i, zero, Color.WHITE, Color(0, 0, 0, 0))
			continue
		p["vy"] = float(p["vy"]) - float(p["grav"]) * dt
		p["x"] = float(p["x"]) + float(p["vx"]) * dt
		p["y"] = float(p["y"]) + float(p["vy"]) * dt
		p["z"] = float(p["z"]) + float(p["vz"]) * dt
		if float(p["y"]) < 0.03:
			p["y"] = 0.03
			p["vy"] = absf(float(p["vy"])) * 0.2
			p["vx"] = float(p["vx"]) * 0.5
			p["vz"] = float(p["vz"]) * 0.5
			p["spin"] = 0.0
		p["rot"] = float(p["rot"]) + float(p["spin"]) * dt
		var k := 1.0 - float(p["life"]) / float(p["max"])
		var fade := minf(1.0, float(p["life"]) / 0.3) * minf(1.0, 0.4 + k * 6.0)   # apparition rapide, disparition douce
		var sz := float(p["size"]) * (1.0 + float(p["grow"]) * k)
		var cell := int(p["cell"])
		var a := fade * 0.7 if (cell == PUFF or cell == PUFF2) else fade
		_put(buf, i, Transform3D(Basis.from_scale(Vector3(sz, sz, 1.0)), Vector3(p["x"], p["y"], p["z"])), p["color"], Color(float(cell), a, float(p["rot"]), 0.0))
	(pool["mm"] as MultiMesh).buffer = buf

func _step_decals(dt: float) -> void:
	var dirty := false
	for i in DECALS:
		var d: Dictionary = _decals[i]
		if float(d["life"]) <= 0.0:
			continue
		d["life"] = float(d["life"]) - dt
		if float(d["life"]) <= 0.0:
			_kill_decal(i)
			dirty = true
			continue
		if float(d["life"]) < 6.0:   # disparition douce pendant les 6 dernières secondes
			var o := i * STRIDE
			_decal_buf[o + 17] = 0.85 * minf(1.0, float(d["life"]) / 6.0)
			dirty = true
	if dirty or _decal_dirty:
		_decal_mm.buffer = _decal_buf
		_decal_dirty = false

var _decal_dirty := true

## Trace de sang sous un zombie mort (0,4 s après sa chute), poignées de terre pendant l'apparition par le sol.
func _zombie_marks(dt: float) -> void:
	for z: ZombieSim in Game.zombies:
		if z.dead and z.death_t > 0.4 and not _dead_marked.has(z.id):
			_dead_marked[z.id] = true
			decal(z.pos.x, z.pos.z, 1.7)
			_decal_dirty = true
		elif z.spawn_type == "ground" and z.spawn_t > 0.0:
			var left: float = _rumble.get(z.id, 0.0) - dt
			if left <= 0.0:
				_rumble[z.id] = _rng.randf() / 14.0 * 2.0
				dirt(Vector3(z.spawn_pos.x, 0.25, z.spawn_pos.z), 3)
			else:
				_rumble[z.id] = left
