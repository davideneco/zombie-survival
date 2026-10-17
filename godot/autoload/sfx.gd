extends Node
## J8 : son. Autoload `Sfx` (équivalent de la classe Sfx de src/audio.js et de Music de src/music.js, mais en lisant des sons PRÉ-RENDUS : les sons synthétisés
## du JS sont cuits en WAV par tools/bake-audio.mjs, la musique en boucles Ogg par niveau d'intensité ; manifeste data/audio.json).
##
## Bus (créés ici, aucun fichier de disposition) :  Master (limiteur à -3 dB, volume = Options > Volume)
##   Effects      : gain 0,6 puis compresseur (audio.js : bus -> comp)           -> Master
##   Reverb       : réverbération 100 % humide, gain 0,55 (verbOut)              -> Effects     (reçoit les « envois » cuits à part)
##   Music        : compresseur dont la chaîne latérale est Effects (la musique baisse à chaque gros bruit), filtre passe-bas d'étouffement
##                  (menu, pause), baisse de volume ; le volume du bus = Options > Musique   -> Master
## Chaque son est lu deux fois s'il a un envoi : le rendu sec sur Effects, la part envoyée à la réverbération sur Reverb. Les sons positionnés sont des
## AudioStreamPlayer3D sans atténuation propre (le niveau suit les règles du JS : AudioRules), les autres des AudioStreamPlayer. Le nombre de voix est borné.
##
## Les sons sont déclenchés par les signaux de Game (zombie_event, ride_event, explosion, points_gained, hit_confirmed…) : voir _connect_signals.

signal played(sound: String, volume: float)

const MANIFEST := "res://data/audio.json"
const SFX_DIR := "res://assets/audio/sfx/"
const MUSIC_DIR := "res://assets/audio/music/"
const BUS_EFFECTS := &"Effects"
const BUS_REVERB := &"Reverb"
const BUS_MUSIC := &"Music"
const MAX_VOICES_3D := 24
const MAX_VOICES_FLAT := 16
const CUSTOM_DIRS := ["user://music/", "res://assets/audio/music/"]   ## morceau personnalisé facultatif, jamais commité (théme.* ignoré par git)
const CUSTOM_EXTS := ["mp3", "ogg", "wav"]

class Voice extends RefCounted:
	var dry: Node          ## AudioStreamPlayer ou AudioStreamPlayer3D (sec, bus Effects)
	var send: Node         ## même type, bus Reverb
	var born := 0
	var is_3d := false
	func busy() -> bool:
		return dry.playing or send.playing

var manifest: Dictionary = {}
var enabled := true                 ## faux : plus rien n'est lu (tests de logique)
var stats := {"played": 0, "skipped": 0, "stolen": 0}
var counts: Dictionary = {}         ## nom -> nombre de lectures demandées (tests)
var recent: Array = []              ## dernières lectures : [nom, volume]
var intensity := 0.3
var muffled := true
var lull := false
var music_level := -1
var custom_music: AudioStream = null
var music_started := false

var _streams: Dictionary = {}       ## nom -> { dry: Array, send: Array, gain_db }
var _voices_3d: Array[Voice] = []
var _voices_flat: Array[Voice] = []
var _clock := 0
var _last_step := {"shot": -1.0, "kill": -1.0, "hurt": -1.0}
var _gl_seen := {"id": "", "n": 0}
var _groan_t: Dictionary = {}
var _alarm_t: Dictionary = {}
var _sw_seen: Dictionary = {}
var _squeal_left := 0.0
var _squeal_cd := 0.0
var _box_tick := 0.0
var _box_k := 0
var _pap_phase := ""
var _pap_puff := 0.0
var _engine: AudioStreamPlayer = null
var _engine_kind := ""
var _engine_gain := 0.0
var _engine_pitch := 1.0
var _music_players: Array[AudioStreamPlayer] = []
var _music_cur := 0
var _music_streams: Dictionary = {}
var _mute_fx: Tween
var _lp_index := -1
var _duck_index := -1
var _tween_music: Tween
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rng.randomize()
	_build_buses()
	_load_manifest()
	_connect_signals()
	apply_settings()
	if Game.settings != null:
		Game.settings.changed.connect(func(key: String) -> void:
			if key == "volume" or key == "music":
				apply_settings())

# ---------------------------------------------------------------- bus
func _build_buses() -> void:
	if AudioServer.get_bus_index(BUS_EFFECTS) != -1:
		return
	var limiter := AudioEffectHardLimiter.new()
	limiter.ceiling_db = AudioRules.LIMITER_CEILING_DB
	limiter.release = 0.08
	AudioServer.add_bus_effect(0, limiter)
	var fx := _add_bus(BUS_EFFECTS, &"Master")
	var amp := AudioEffectAmplify.new()
	amp.volume_db = AudioRules.vol_db(AudioRules.BUS_GAIN)
	AudioServer.add_bus_effect(fx, amp)
	AudioServer.add_bus_effect(fx, _compressor())
	var rv := _add_bus(BUS_REVERB, BUS_EFFECTS)
	var reverb := AudioEffectReverb.new()
	reverb.room_size = 0.8
	reverb.damping = 0.6
	reverb.wet = 1.0
	reverb.dry = 0.0
	AudioServer.add_bus_effect(rv, reverb)
	var verb_out := AudioEffectAmplify.new()
	verb_out.volume_db = AudioRules.vol_db(AudioRules.VERB_OUT)
	AudioServer.add_bus_effect(rv, verb_out)
	var mu := _add_bus(BUS_MUSIC, &"Master")
	var duck := _compressor()
	duck.sidechain = BUS_EFFECTS
	AudioServer.add_bus_effect(mu, duck)
	var lp := AudioEffectLowPassFilter.new()
	lp.cutoff_hz = AudioRules.OPEN_FREQ
	AudioServer.add_bus_effect(mu, lp)
	_lp_index = 1
	var dk := AudioEffectAmplify.new()
	dk.volume_db = 0.0
	AudioServer.add_bus_effect(mu, dk)
	_duck_index = 2

func _add_bus(name: StringName, send: StringName) -> int:
	AudioServer.add_bus()
	var i := AudioServer.bus_count - 1
	AudioServer.set_bus_name(i, name)
	AudioServer.set_bus_send(i, send)
	return i

func _compressor() -> AudioEffectCompressor:
	var c := AudioEffectCompressor.new()
	c.threshold = AudioRules.COMP_THRESHOLD_DB
	c.ratio = AudioRules.COMP_RATIO
	c.attack_us = AudioRules.COMP_ATTACK_US
	c.release_ms = AudioRules.COMP_RELEASE_MS
	return c

## Options > Volume (bus Master) et Options > Musique (bus Music), curseurs 0..1 comme dans le JS (gain linéaire).
func apply_settings() -> void:
	if Game.settings == null:
		return
	AudioServer.set_bus_volume_db(0, AudioRules.vol_db(float(Game.settings.get_value("volume"))))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(BUS_MUSIC), AudioRules.vol_db(float(Game.settings.get_value("music"))))

func _load_manifest() -> void:
	var f := FileAccess.open(MANIFEST, FileAccess.READ)
	if f == null:
		push_error("Sfx : %s illisible (tools/bake-audio.mjs)" % MANIFEST)
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) == TYPE_DICTIONARY:
		manifest = parsed

# ---------------------------------------------------------------- sons (rendus cuits)
func has_sound(name: String) -> bool:
	return manifest.has("sounds") and manifest["sounds"].has(name)

## Flux d'un son (chargés à la demande, gardés) : { dry: [AudioStream], send: [AudioStream ou null], gain_db }. {} si inconnu.
func get_sound(name: String) -> Dictionary:
	if _streams.has(name):
		return _streams[name]
	if not has_sound(name):
		return {}
	var e: Dictionary = manifest["sounds"][name]
	var dry: Array = []
	var send: Array = []
	for i in e["files"].size():
		var s: Variant = load(SFX_DIR + String(e["files"][i]))
		if s == null:
			push_error("Sfx : %s illisible" % e["files"][i])
			return {}
		dry.append(s)
		var sf: Variant = e["send"][i]
		send.append(load(SFX_DIR + String(sf)) if sf != null else null)
	_streams[name] = {"dry": dry, "send": send, "gain_db": float(e["gain_db"])}
	return _streams[name]

## Joue un son. vol : volume linéaire du JS (le paramètre `v` des méthodes de Sfx) ; pos : position du monde (INF : non positionné) ; pitch : pitch_scale.
## Renvoie la voix, ou null (son inconnu, trop faible, désactivé).
func play(name: String, vol: float = 1.0, pos: Vector3 = Vector3.INF, pitch: float = 1.0) -> Voice:
	counts[name] = int(counts.get(name, 0)) + 1
	if not enabled:
		return null
	if vol < AudioRules.MIN_VOL and name != "groan":
		stats["skipped"] += 1
		return null
	if name == "groan" and vol <= AudioRules.MIN_GROAN:
		stats["skipped"] += 1
		return null
	var s := get_sound(name)
	if s.is_empty():
		stats["skipped"] += 1
		return null
	recent.append([name, vol])
	if recent.size() > 64:
		recent.pop_front()
	played.emit(name, vol)
	var n: int = s["dry"].size()
	var k := _rng.randi() % n if n > 1 else 0
	var v := _acquire(pos != Vector3.INF)
	var db: float = float(s["gain_db"]) + AudioRules.vol_db(vol)
	_fire(v.dry, s["dry"][k], BUS_EFFECTS, db, pitch, pos)
	var send_stream: Variant = s["send"][k]
	if send_stream != null:
		_fire(v.send, send_stream, BUS_REVERB, db, pitch, pos)
	else:
		v.send.stop()
	stats["played"] += 1
	return v

func _fire(p: Node, stream: AudioStream, bus: StringName, db: float, pitch: float, pos: Vector3) -> void:
	p.stream = stream
	p.bus = bus
	p.volume_db = db
	p.pitch_scale = maxf(pitch, 0.01)
	if p is AudioStreamPlayer3D:
		p.global_position = pos
	p.play()

func _acquire(positional: bool) -> Voice:
	var pool: Array[Voice] = _voices_3d if positional else _voices_flat
	var cap := MAX_VOICES_3D if positional else MAX_VOICES_FLAT
	_clock += 1
	for v in pool:
		if not v.busy():
			v.born = _clock
			return v
	if pool.size() < cap:
		var v := Voice.new()
		v.is_3d = positional
		v.dry = _new_player(positional)
		v.send = _new_player(positional)
		v.born = _clock
		pool.append(v)
		return v
	var oldest: Voice = pool[0]   # pleine : on coupe la plus ancienne
	for v in pool:
		if v.born < oldest.born:
			oldest = v
	oldest.dry.stop()
	oldest.send.stop()
	oldest.born = _clock
	stats["stolen"] += 1
	return oldest

func _new_player(positional: bool) -> Node:
	var p: Node
	if positional:
		var q := AudioStreamPlayer3D.new()
		q.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED   # le niveau suit les règles du JS ; seule la direction vient de la 3D
		q.max_distance = 0.0
		q.attenuation_filter_cutoff_hz = 20500.0
		q.panning_strength = 1.0
		p = q
	else:
		p = AudioStreamPlayer.new()
	add_child(p)
	return p

## Voix qui jouent en ce moment (bornées par MAX_VOICES_*).
func active_voices() -> int:
	var n := 0
	for v in _voices_3d:
		if v.busy():
			n += 1
	for v in _voices_flat:
		if v.busy():
			n += 1
	return n

func voice_count() -> int:
	return _voices_3d.size() + _voices_flat.size()

func stop_all() -> void:
	for pool: Array[Voice] in [_voices_3d, _voices_flat]:
		for v in pool:
			v.dry.stop()
			v.send.stop()

# ---------------------------------------------------------------- signaux de Game -> sons
func _connect_signals() -> void:
	Game.shot_fired.connect(_on_shot)
	Game.hit_confirmed.connect(_on_hit)
	Game.zombie_killed.connect(_on_kill)
	Game.player_hurt.connect(_on_hurt)
	Game.explosion.connect(_on_explosion)
	Game.zombie_event.connect(_on_zombie_event)
	Game.round_started.connect(_on_round_started)
	Game.round_ended.connect(_on_round_ended)
	Game.weapon_acquired.connect(func(_id: String) -> void: play("buy"))
	Game.perk_acquired.connect(func(_id: String) -> void: play("buy"))
	Game.door_opened.connect(func(_id: int) -> void: play("buy"))
	Game.door_denied.connect(func(_id: int) -> void: play("deny"))
	Game.purchase_denied.connect(func(_price: int) -> void: play("deny"))
	Game.powerup_collected.connect(_on_powerup)
	Game.box_event.connect(_on_box_event)
	Game.pap_event.connect(_on_pap_event)
	Game.weapon_event.connect(_on_weapon_event)
	Game.ride_event.connect(_on_ride_event)

## Un tir : une seule fois par pas de simulation (un fusil à pompe émet un signal par plomb).
func _on_shot(_origin: Vector3, _end: Vector3) -> void:
	if Game.arms == null or _last_step["shot"] == Game.time:
		return
	_last_step["shot"] = Game.time
	var w := Game.arms.current
	var id := w.id
	if _gl_seen["id"] == id and w.gl < int(_gl_seen["n"]) and w.cfg.has("gl"):
		id = "m79"   # lance-grenades sous canon
	_gl_seen = {"id": w.id, "n": w.gl}
	play(AudioRules.gun_name(id))

## Marqueur de touche : claque + « tink » à la tête, choc mou ailleurs (audio.js hit).
func _on_hit(_kill: bool) -> void:
	play("hit_head" if Game.last_hit_head else "hit_flesh")

func _on_kill(_z: ZombieSim, _head: bool) -> void:
	if _last_step["kill"] == Game.time:
		return
	_last_step["kill"] = Game.time
	play("kill")

func _on_hurt(_amount: float) -> void:
	if _last_step["hurt"] == Game.time:
		return
	_last_step["hurt"] = Game.time
	play("hurt")

func _on_explosion(pos: Vector3, _radius: float, _color: int) -> void:
	var d := _dist(pos)
	play("explosion", AudioRules.near_vol(d, AudioRules.EXPLOSION_RANGE, 0.1), pos)

func _on_zombie_event(z: ZombieSim, name: String) -> void:
	var v := AudioRules.near_vol(_dist(z.pos), AudioRules.ZOMBIE_EVENT_RANGE)
	v = maxf(v, 0.0)
	match name:
		"knock":
			play("knock", v, z.pos)
		"glass":
			play("glass", v, z.pos)
			play("groan", minf(1.0, v * 1.4), z.pos)
		"rumble":
			play("rumble", v, z.pos)
		"emerge":
			play("dirt", v, z.pos)
			play("groan", minf(1.0, v * 1.4), z.pos)

func _on_round_started(_n: int) -> void:
	lull = false
	_refresh_music()
	play("round_start")

func _on_round_ended() -> void:
	lull = true
	_refresh_music()
	play("round_end")

func _on_powerup(type: String) -> void:
	play("powerup")
	if type == "nuke":
		play("nuke")   # main.js collectPowerup puis nuke()

func _on_box_event(name: String, _data: Dictionary) -> void:
	match name:
		"roll":
			play("jingle")
			_box_tick = 0.0
			_box_k = 0
		"teddy":
			play("nuke")
		"offer":
			play("powerup")

func _on_pap_event(name: String, _data: Dictionary) -> void:
	match name:
		"start":
			play("pap")
			_pap_phase = "in"
			_pap_puff = 0.0
		"taken":
			play("powerup")
			_pap_phase = ""

func _on_weapon_event(name: String, data: Dictionary) -> void:
	match name:
		"reload":
			var wr: Dictionary = manifest.get("weaponReload", {})
			var key := String(wr.get(String(data["id"]), AudioRules.reload_name(String(data["cat"]), float(data["time"]))))
			play(key)
		"knife_swing":
			play("knife_swing")
		"knife_hit":
			play("knife_metal" if bool(data["metal"]) else "knife_flesh")
		"empty":
			play("empty")

func _on_ride_event(name: String, data: Dictionary) -> void:
	var v: Variant = data.get("v")
	var d := _dist(v.pos) if v is Object and "pos" in v else 0.0
	match name:
		"mount":
			play("mount_%s" % String(v.type))
		"chime", "chime_open", "chime_close":
			var open: bool = bool(data.get("open", name != "chime_close"))
			play("tram_chime_open" if open else "tram_chime_close", 0.6 if name == "chime" else AudioRules.far_vol(d, 60.0), v.pos if v is Object else Vector3.INF)
		"crash":
			play("crash", float(data["level"]), v.pos)
		"cough":
			play("cough", 0.8, v.pos)
		"dry":
			play("cough", 1.0, v.pos)
		"beep":
			play("beep")
		"alarm":
			play("alarm", 0.8, v.pos)
		"service":
			play("buy")
		"gong":
			play("tram_gong", 1.0 if _is_local(v) else maxf(0.35, AudioRules.far_vol(d, 120.0)), v.pos if v is Object else Vector3.INF)
		"knock":
			play("knock", 0.5 if _is_local(v) else 0.3, v.pos if v is Object else Vector3.INF)

func _is_local(v: Variant) -> bool:
	return Game.rides != null and Game.rides.ride != null and Game.rides.ride["v"] == v

## Distance horizontale au joueur (le JS mesure souvent depuis la caméra : même ordre de grandeur).
func _dist(p: Vector3) -> float:
	if Game.player == null:
		return 0.0
	return Vector2(p.x - Game.player.pos.x, p.z - Game.player.pos.z).length()

# ---------------------------------------------------------------- minuteries de la partie (gémissements, alarmes, boîte, Pack-a-Punch)
func _physics_process(dt: float) -> void:
	if not Game.playing or Game.over or Game.player == null:
		return
	_groans(dt)
	if Game.rides != null:
		_rides(dt)
	if Game.machines != null:
		_machines(dt)

## Râle des zombies sortis : le premier après 2..8 s, puis toutes les 4..10 s (zombie.js, main.js).
func _groans(dt: float) -> void:
	for z in Game.zombies:
		if z.dead or z.spawn_t > 0.0:
			continue
		if not _groan_t.has(z.id):
			_groan_t[z.id] = _rng.randf_range(AudioRules.GROAN_FIRST.x, AudioRules.GROAN_FIRST.y)
		_groan_t[z.id] -= dt
		if _groan_t[z.id] <= 0.0:
			_groan_t[z.id] = _rng.randf_range(AudioRules.GROAN_NEXT.x, AudioRules.GROAN_NEXT.y)
			play("groan", AudioRules.near_vol(_dist(z.pos), AudioRules.GROAN_RANGE), z.pos)
	if _groan_t.size() > Game.zombies.size() * 2 + 16:
		var alive := {}
		for z in Game.zombies:
			alive[z.id] = true
		for id in _groan_t.keys():
			if not alive.has(id):
				_groan_t.erase(id)

func _rides(dt: float) -> void:
	for v in Game.rides.vehicles:   # moto en feu : deux bips stridents toutes les 0,42 s (vehicles.js)
		if v.state == "burning":
			_alarm_t[v.id] = float(_alarm_t.get(v.id, 0.0)) - dt
			if _alarm_t[v.id] <= 0.0:
				_alarm_t[v.id] = AudioRules.ALARM_PERIOD
				play("alarm", AudioRules.near_vol(_dist(v.pos), AudioRules.BURN_ALARM_RANGE), v.pos)
		else:
			_alarm_t.erase(v.id)
	for t in Game.rides.trams:
		var seen: Variant = _sw_seen.get(t.id)
		if seen != null and int(seen) != t.sw:
			play("tram_switch", AudioRules.far_vol(_dist(t.pos), 60.0), t.pos)
		_sw_seen[t.id] = t.sw
		if t.squeal > 0.0:   # présentation seulement : le drapeau est consommé ici (la simulation ne le relit pas)
			_squeal_left = maxf(_squeal_left, t.squeal)
			t.squeal = 0.0
		if _squeal_left > 0.0:
			_squeal_left -= dt
			_squeal_cd -= dt
			var sp := absf(t.v)
			if _squeal_cd <= 0.0 and sp > 1.5:
				_squeal_cd = AudioRules.BRAKE_PERIOD
				play("tram_brake", AudioRules.far_vol(_dist(t.pos), 60.0) * AudioRules.brake_k(sp), t.pos, AudioRules.brake_pitch(sp))

## Défilement de la boîte mystère (tic de plus en plus lent) et grondement du Pack-a-Punch selon sa phase.
func _machines(dt: float) -> void:
	var box: MysteryBox = Game.machines.box
	if box != null and not box.roll.is_empty() and String(box.roll["phase"]) == "roll":
		var p := minf(1.0, float(box.roll["t"]) / float(Config.at("box.spin")))
		_box_tick -= dt
		if _box_tick <= 0.0:
			_box_tick = AudioRules.box_tick_delay(p)
			play("tick", 1.0, Vector3.INF, AudioRules.tick_pitch(p))
	var pap: PackAPunch = Game.machines.pap
	if pap != null and not pap.anim.is_empty():
		var ph := String(pap.anim["phase"])
		if ph != _pap_phase:
			if ph == "work":
				play("pap_work")
			elif ph == "out":
				play("pap")
			_pap_phase = ph
			_pap_puff = 0.0
		if ph == "work":
			var k := float(pap.anim["t"]) / float(Config.at("pap.workTime"))
			_pap_puff -= dt
			if _pap_puff <= 0.0:
				_pap_puff = AudioRules.pap_puff_delay(k)
				play("tick", 1.0, Vector3.INF, AudioRules.tick_pitch(0.9))
	elif _pap_phase != "":
		_pap_phase = ""

# ---------------------------------------------------------------- moteur (boucle + pitch_scale)
func _process(dt: float) -> void:
	_update_engine(dt)

func _engine_state() -> Dictionary:
	if Game.rides == null or Game.rides.ride == null or not Game.playing or Game.over:
		return {}
	var v: Variant = Game.rides.ride["v"]
	if v.is_tram():
		if v.has_driver() and v.state == "ok" and Game.rides.tram_powered:
			var ratio := clampf(absf(v.v) / float(Config.at("tram.drive.maxSpeed")), 0.0, 1.0)
			return {"kind": "tram", "rpm": ratio, "throttle": maxf(0.0, v.throttle)}
		return {}
	if v.has_tank() and v.seats[0] != null and v.state == "ok" and v.fuel > 0.0:
		return {"kind": String(v.type), "rpm": AudioRules.moto_rpm(v.speed, float(v.def["maxSpeed"]), v.throttle), "throttle": v.throttle}
	return {}

func _update_engine(dt: float) -> void:
	var st := _engine_state()
	if st.is_empty():
		if _engine != null and _engine.playing:
			_engine_gain = maxf(0.0, _engine_gain - dt / 0.15)
			if _engine_gain <= 0.001:
				_engine.stop()
			else:
				_engine.volume_db = AudioRules.vol_db(_engine_gain) + _engine_base_db
		return
	if _engine == null or _engine_kind != st["kind"]:
		_start_engine(String(st["kind"]))
		if _engine == null:
			return
	var kind: String = st["kind"]
	var bake: Dictionary = manifest["engines"]["engine_%s" % kind]
	var bake_rpm: float = float(bake["rpm"]) if bake["rpm"] != null else float(bake["ratio"])
	var f_now := AudioRules.engine_freq(kind, float(st["rpm"]))
	var f_bake := AudioRules.engine_freq(kind, bake_rpm)
	var g_now := AudioRules.engine_gain(kind, float(st["rpm"]), float(st["throttle"]), 1.0)
	var g_bake := AudioRules.engine_gain(kind, bake_rpm, float(bake["throttle"]), 1.0)
	var k := 1.0 - exp(-dt / 0.05)   # setTargetAtTime(…, 0.04..0.05)
	_engine_pitch += (f_now / f_bake - _engine_pitch) * k
	_engine_gain += (g_now / g_bake - _engine_gain) * (1.0 - exp(-dt / 0.08))
	_engine.pitch_scale = maxf(_engine_pitch, 0.05)
	_engine.volume_db = AudioRules.vol_db(_engine_gain) + _engine_base_db
	if not _engine.playing:
		_engine.play()

var _engine_base_db := 0.0

func _start_engine(kind: String) -> void:
	var key := "engine_%s" % kind
	if not manifest.has("engines") or not manifest["engines"].has(key):
		return
	if _engine == null:
		_engine = AudioStreamPlayer.new()
		_engine.bus = BUS_EFFECTS
		add_child(_engine)
	var e: Dictionary = manifest["engines"][key]
	var st: AudioStreamWAV = (load(SFX_DIR + String(e["file"])) as AudioStreamWAV).duplicate()
	st.loop_mode = AudioStreamWAV.LOOP_FORWARD
	st.loop_begin = 0
	st.loop_end = int(round(float(e["dur"]) * float(st.mix_rate)))
	_engine.stream = st
	_engine_kind = kind
	_engine_base_db = float(e["gain_db"])
	_engine_gain = 0.0
	_engine_pitch = 1.0

## Le moteur joue-t-il ? (tests)
func engine_playing() -> bool:
	return _engine != null and _engine.playing

# ---------------------------------------------------------------- musique
## Charge les boucles (une par niveau) ou le morceau personnalisé, puis lance la musique. À appeler une fois (main.gd).
func start_music() -> void:
	if music_started:
		return
	music_started = true
	if _music_players.is_empty():
		for i in 2:
			var p := AudioStreamPlayer.new()
			p.bus = BUS_MUSIC
			p.volume_db = -80.0
			add_child(p)
			_music_players.append(p)
	custom_music = find_custom_track()
	if custom_music != null:
		_music_players[0].stream = custom_music
		_music_players[0].volume_db = -30.0
		_music_players[0].play()
		_tween_vol(_music_players[0], 0.0, 2.0)   # entrée en fondu (music.js playTrack)
		music_level = -1
	else:
		_refresh_music()
	_apply_mood(true)

## Niveau d'intensité de la partie + étouffement (menu, pause) : audio.js setMood.
func set_mood(new_intensity: float, new_muffled: bool) -> void:
	var changed := false
	if not is_equal_approx(intensity, new_intensity):
		intensity = new_intensity
		changed = true
	if changed:
		_refresh_music()
	if muffled != new_muffled:
		muffled = new_muffled
		_apply_mood(false)

func current_level() -> int:
	return AudioRules.music_level(intensity, lull)

func _refresh_music() -> void:
	if not music_started or custom_music != null:
		return
	var level := current_level()
	if level == music_level:
		return
	_switch_music(level)

func _music_stream(level: int) -> AudioStream:
	if _music_streams.has(level):
		return _music_streams[level]
	if not manifest.has("music") or not manifest["music"].has(str(level)):
		return null
	var s := load(MUSIC_DIR + String(manifest["music"][str(level)]["file"])) as AudioStreamOggVorbis
	if s != null:
		s.loop = true
	_music_streams[level] = s
	return s

func _switch_music(level: int) -> void:
	var stream := _music_stream(level)
	if stream == null:
		return
	var old := _music_players[_music_cur]
	var nxt := _music_players[1 - _music_cur]
	var pos := 0.0
	if old.playing and old.stream != null:
		pos = AudioRules.sync_position(old.get_playback_position(), old.stream.get_length(), stream.get_length())
	nxt.stream = stream
	nxt.volume_db = -60.0
	nxt.play(pos)
	_tween_vol(nxt, 0.0, AudioRules.FADE_TIME)
	if old.playing:
		_tween_vol(old, -60.0, AudioRules.FADE_TIME, true)
	_music_cur = 1 - _music_cur
	music_level = level

func _tween_vol(p: AudioStreamPlayer, db: float, time: float, stop_after := false) -> void:
	var tw := create_tween()
	tw.tween_property(p, "volume_db", db, time)
	if stop_after:
		tw.tween_callback(p.stop)

## Étouffement : « à travers un mur » (passe-bas 650 Hz, volume x 0,55) dans les menus et en pause (music.js setMuffled).
func _apply_mood(instant: bool) -> void:
	var bus := AudioServer.get_bus_index(BUS_MUSIC)
	var lp := AudioServer.get_bus_effect(bus, _lp_index) as AudioEffectLowPassFilter
	var dk := AudioServer.get_bus_effect(bus, _duck_index) as AudioEffectAmplify
	var hz := AudioRules.MUFFLE_FREQ if muffled else AudioRules.OPEN_FREQ
	var db := AudioRules.vol_db(AudioRules.MUFFLE_DUCK) if muffled else 0.0
	if _tween_music != null and _tween_music.is_valid():
		_tween_music.kill()
	if instant:
		lp.cutoff_hz = hz
		dk.volume_db = db
		return
	_tween_music = create_tween().set_parallel(true)
	_tween_music.tween_property(lp, "cutoff_hz", hz, AudioRules.MUFFLE_TIME)
	_tween_music.tween_property(dk, "volume_db", db, AudioRules.MUFFLE_TIME)

## Cible actuelle de l'étouffement (tests) : { hz, db }.
func muffle_target() -> Dictionary:
	return {"hz": AudioRules.MUFFLE_FREQ if muffled else AudioRules.OPEN_FREQ, "db": AudioRules.vol_db(AudioRules.MUFFLE_DUCK) if muffled else 0.0}

## Morceau personnalisé facultatif theme.mp3 / .ogg / .wav dans user://music/ ou res://assets/audio/music/ (ignoré par git, jamais commité).
func find_custom_track(dirs: Array = CUSTOM_DIRS) -> AudioStream:
	for d in dirs:
		for ext in CUSTOM_EXTS:
			var path := "%stheme.%s" % [d, ext]
			if FileAccess.file_exists(path):
				var s := load_custom(path)
				if s != null:
					return s
	return null

static func load_custom(path: String) -> AudioStream:
	var s: AudioStream = null
	match path.get_extension().to_lower():
		"mp3":
			s = AudioStreamMP3.load_from_file(path)
			if s != null:
				(s as AudioStreamMP3).loop = true
		"ogg":
			s = AudioStreamOggVorbis.load_from_file(path)
			if s != null:
				(s as AudioStreamOggVorbis).loop = true
		"wav":
			s = AudioStreamWAV.load_from_file(path)
			if s != null:
				var w := s as AudioStreamWAV
				w.loop_mode = AudioStreamWAV.LOOP_FORWARD
				w.loop_begin = 0
				w.loop_end = int(round(w.get_length() * float(w.mix_rate)))
	return s

## Nouvelle partie : remet à zéro les minuteries et l'accalmie.
func reset() -> void:
	lull = false
	_groan_t.clear()
	_alarm_t.clear()
	_sw_seen.clear()
	_squeal_left = 0.0
	_pap_phase = ""
	stop_all()
	if _engine != null:
		_engine.stop()
	_refresh_music()
