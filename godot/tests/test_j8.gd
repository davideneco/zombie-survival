extends RefCounted
## J8 : audio. Golden calculés par le JS exécutant le VRAI src/audio.js et src/music.js avec un faux contexte WebAudio (tools/export-golden-j8.mjs) :
## sons programmés (durée attendue, tons purs), niveaux et tempos de la musique, fréquences et gains des moteurs, chaîne de mixage. Les WAV cuits
## (tools/bake-audio.mjs, rendus par le VRAI code dans Chrome) sont relus ici : format, durée, silence, écrêtage, fréquences (Goertzel) ; manifeste ;
## bus ; sons déclenchés par les signaux de Game ; nombre de voix borné ; moteur ; musique (boucles, niveaux) ; morceau personnalisé.

var _g: Dictionary
var _t: Node

func run(t: Node) -> void:
	_t = t
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j8.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j8.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	var m: Dictionary = Sfx.manifest
	t.check(not m.is_empty() and m.has("sounds"), "manifeste data/audio.json chargé par Sfx")
	if m.is_empty():
		return
	_rules(t)
	_manifest(t)
	_wavs(t)
	_tones(t)
	_music_files(t)
	_buses(t)
	_signals(t)
	_voice_cap(t)
	_engine(t)
	_custom_track(t)

# ------------------------------------------------------------------ règles pures
func _rules(t: Node) -> void:
	for c: Dictionary in _g["music"]:
		t.check(AudioRules.music_level(float(c["intensity"]), bool(c["lull"])) == int(c["level"]), "niveau de musique x=%s accalmie=%s" % [c["intensity"], c["lull"]])
		t.near(AudioRules.music_bpm(float(c["intensity"]), bool(c["lull"])), c["bpm"], "tempo x=%s" % c["intensity"], 1e-5)
	for c: Dictionary in _g["mood"]:
		t.near(AudioRules.mood_intensity(bool(c["inGame"]), bool(c["finale"]), int(c["round"])), c["intensity"], "intensité manche %d" % int(c["round"]), 1e-9)
	for name: String in _g["engines"]:
		var e: Dictionary = _g["engines"][name]
		for c: Dictionary in e["grid"]:
			var th := float(c["throttle"])
			t.near(AudioRules.engine_freq(String(e["kind"]), float(c["rpm"])), c["freq"], "%s fréquence rpm=%s" % [name, c["rpm"]], 1e-6)
			t.near(AudioRules.engine_gain(String(e["kind"]), float(c["rpm"]), th, 1.0), c["gain"], "%s gain rpm=%s thr=%s" % [name, c["rpm"], c["throttle"]], 1e-6)
	var mix: Dictionary = _g["mix"]
	t.near(AudioRules.BUS_GAIN, mix["bus"], "gain du bus")
	t.near(AudioRules.VERB_OUT, mix["verbOut"], "gain de la réverbération")
	t.near(AudioRules.LIMITER_CEILING_DB, mix["limiter"]["threshold"], "seuil du limiteur")
	t.near(AudioRules.COMP_THRESHOLD_DB, mix["comp"]["threshold"], "seuil du compresseur")
	t.near(AudioRules.COMP_RATIO, mix["comp"]["ratio"], "rapport du compresseur")
	t.near(AudioRules.COMP_ATTACK_US, float(mix["comp"]["attack"]) * 1.0e6, "attaque du compresseur")
	t.near(AudioRules.COMP_RELEASE_MS, float(mix["comp"]["release"]) * 1.0e3, "relâchement du compresseur")
	t.near(AudioRules.MUFFLE_FREQ, mix["muffle"]["freq"], "fréquence d'étouffement")
	t.near(AudioRules.MUFFLE_DUCK, mix["muffle"]["duck"], "baisse de volume en pause")
	t.near(AudioRules.OPEN_FREQ, mix["lowpassOpen"], "filtre ouvert")
	t.near(float(Settings.DEFAULTS["music"]), mix["musicDefault"], "volume de musique par défaut")
	# fonctions de volume
	t.near(AudioRules.near_vol(0.0, 45.0), 1.0, "volume à 0 m")
	t.near(AudioRules.near_vol(22.5, 45.0), 0.5, "volume à mi-portée")
	t.near(AudioRules.near_vol(100.0, 60.0, 0.1), 0.1, "plancher de l'explosion")
	t.near(AudioRules.far_vol(30.0, 60.0), 0.25, "volume lointain au carré")
	t.near(AudioRules.sync_position(5.0, 20.0, 40.0), 10.0, "position synchronisée entre deux niveaux")
	t.near(AudioRules.tick_pitch(1.0), 1200.0 / 700.0, "hauteur du tic")
	t.near(AudioRules.moto_rpm(0.0, 21.0, 0.0), 0.22, "régime au ralenti")
	t.near(AudioRules.moto_rpm(21.0, 21.0, 1.0), 0.98, "régime à pleine vitesse")
	t.check(AudioRules.reload_name("mg", 5.0) == "reload_mg_5" and AudioRules.reload_name("pistol", 1.5) == "reload_pistol_1p5", "nom des sons de rechargement")

# ------------------------------------------------------------------ manifeste et fichiers
func _manifest(t: Node) -> void:
	var m: Dictionary = Sfx.manifest
	for name: String in _g["sounds"]:
		t.check(Sfx.has_sound(name), "son cuit : %s" % name)
	for id: String in Config.at("weapons"):
		var w: Dictionary = Config.weapon(id)
		var want := AudioRules.reload_name(String(w["cat"]), float(w["reloadTime"]))
		t.check(m["weaponReload"].get(id) == want and Sfx.has_sound(want), "rechargement de %s : %s" % [id, want])
		t.check(Sfx.has_sound(AudioRules.gun_name(id)), "coup de feu de %s" % id)
	for name: String in _g["engines"]:
		t.check(m["engines"].has(name), "boucle de moteur : %s" % name)
	for lv in 4:
		t.check(m["music"].has(str(lv)), "musique du niveau %d" % lv)

## Relit le WAV source cuit (l'import Godot le compresse en QOA : le flux importé ne donne plus les échantillons). Renvoie { pcm, rate, channels, bits }.
func _wav_file(file: String) -> Dictionary:
	var b := FileAccess.get_file_as_bytes(Sfx.SFX_DIR + file)
	if b.size() < 44 or b.slice(0, 4).get_string_from_ascii() != "RIFF":
		return {}
	var out := PackedFloat32Array()
	out.resize((b.size() - 44) / 2)
	for i in out.size():
		var v := b[44 + 2 * i] | (b[45 + 2 * i] << 8)
		if v >= 32768:
			v -= 65536
		out[i] = v / 32768.0
	return {"pcm": out, "channels": b.decode_u16(22), "rate": b.decode_u32(24), "bits": b.decode_u16(34)}

func _wavs(t: Node) -> void:
	var total_bytes := 0
	var longest_ratio := 0.0
	for name: String in _g["sounds"]:
		var snd: Dictionary = Sfx.get_sound(name)
		t.check(not snd.is_empty(), "%s : flux chargés" % name)
		if snd.is_empty():
			continue
		var exp: Variant = _g["sounds"][name]["expected"]
		var variants: Array = snd["dry"]
		for i in variants.size():
			var s := variants[i] as AudioStreamWAV
			var file := String(Sfx.manifest["sounds"][name]["files"][i])
			var w := _wav_file(file)
			t.check(s != null and not w.is_empty() and w["channels"] == 1 and w["bits"] == 16 and w["rate"] == 44100 and not s.stereo and s.mix_rate == 44100, "%s[%d] : mono 16 bits 44,1 kHz" % [name, i])
			if s == null or w.is_empty():
				continue
			var pcm: PackedFloat32Array = w["pcm"]
			total_bytes += pcm.size() * 2
			t.check(absf(s.get_length() - pcm.size() / 44100.0) < 0.01, "%s[%d] : flux importé de même durée que le WAV" % [name, i])
			var peak := 0.0
			for x in pcm:
				peak = maxf(peak, absf(x))
			t.check(peak > 0.02, "%s[%d] : pas silencieux (pic %.3f)" % [name, i, peak])
			t.check(peak <= 0.995, "%s[%d] : sans écrêtage (pic %.3f)" % [name, i, peak])
			var dur := pcm.size() / 44100.0
			if exp != null:
				# la fin de l'enveloppe exponentielle est rognée sous -54 dB : jamais plus long que programmé, jamais bien plus court
				t.check(dur <= float(exp) + 0.03, "%s[%d] : durée %.3f <= %.3f s du JS" % [name, i, dur, float(exp)])
				t.check(dur >= 0.6 * float(exp), "%s[%d] : durée %.3f >= 60 %% de %.3f s du JS" % [name, i, dur, float(exp)])
				longest_ratio = maxf(longest_ratio, dur / float(exp))
			elif _g["sounds"][name].has("range"):
				var r: Array = _g["sounds"][name]["range"]
				t.check(dur >= 0.5 * float(r[0]) and dur <= float(r[1]) + 0.2, "%s[%d] : durée %.3f dans la plage du JS" % [name, i, dur])
		var sends: Array = snd["send"]
		for i in sends.size():
			if sends[i] != null:
				var ss := sends[i] as AudioStreamWAV
				t.check(ss != null and ss.get_length() > 0.02, "%s[%d] : envoi réverbération lisible" % [name, i])
	t.check(total_bytes > 1000000, "les rendus pèsent quelque chose (%d octets)" % total_bytes)

# ------------------------------------------------------------------ fréquences (Goertzel) : les tons purs du JS sont dans les WAV
func _power(pcm: PackedFloat32Array, rate: float, f: float, i0: int, i1: int) -> float:
	var w := TAU * f / rate
	var cw := 2.0 * cos(w)
	var s1 := 0.0
	var s2 := 0.0
	for i in range(i0, i1):
		var s := pcm[i] + cw * s1 - s2
		s2 = s1
		s1 = s
	return (s1 * s1 + s2 * s2 - cw * s1 * s2) / float(maxi(1, i1 - i0))

func _tones(t: Node) -> void:
	var checked := 0
	var weak: Array[String] = []
	for name: String in _g["sounds"]:
		var snd: Dictionary = Sfx.get_sound(name)
		if snd.is_empty() or _g["sounds"][name]["direct"]:
			continue
		var w := _wav_file(String(Sfx.manifest["sounds"][name]["files"][0]))
		var pcm: PackedFloat32Array = w["pcm"]
		var len_s := pcm.size() / 44100.0
		for c: Dictionary in _g["sounds"][name]["calls"]:
			if c["k"] != "tone" or float(c["f0"]) != float(c["f1"]) or float(c["dur"]) < 0.1 or float(c["vol"]) < 0.1 or float(c["f0"]) > 5000.0:
				continue
			var i0 := int((float(c["at"]) + 0.02) * 44100.0)
			var i1 := int(minf(float(c["at"]) + float(c["dur"]) * 0.8, len_s) * 44100.0)
			if i1 - i0 < 1500 or i1 > pcm.size():
				continue
			var f := float(c["f0"])
			var p0 := _power(pcm, 44100.0, f, i0, i1)
			var other := maxf(_power(pcm, 44100.0, f * 1.4, i0, i1), _power(pcm, 44100.0, f / 1.4, i0, i1))
			checked += 1
			if not p0 > 3.0 * other:
				weak.append("%s %d Hz (%.2e / %.2e)" % [name, int(f), p0, other])
	t.check(checked >= 12, "assez de tons purs vérifiés (%d)" % checked)
	t.check(weak.is_empty(), "tons purs présents dans les WAV : manquants %s" % str(weak))

# ------------------------------------------------------------------ musique
func _music_files(t: Node) -> void:
	for c: Dictionary in _g["music"]:
		if bool(c["lull"]) or not (float(c["intensity"]) in [0.3, 0.6, 1.0]):
			continue
		var lv := int(c["level"])
		var e: Dictionary = Sfx.manifest["music"][str(lv)]
		t.near(e["bpm"], c["bpm"], "tempo cuit du niveau %d" % lv, 1e-3)
		t.near(e["loop"], float(c["step"]) * 16.0 * float(e["bars"]), "durée de boucle du niveau %d" % lv, 1e-3)
		var s := load(Sfx.MUSIC_DIR + String(e["file"])) as AudioStreamOggVorbis
		t.check(s != null, "musique %d : Ogg importé" % lv)
		if s != null:
			t.check(absf(s.get_length() - float(e["loop"])) < 0.1, "musique %d : durée %.2f s ~ %.2f s" % [lv, s.get_length(), float(e["loop"])])
	var lull: Dictionary = Sfx.manifest["music"]["0"]
	t.near(lull["bpm"], 102.0, "tempo de l'accalmie", 1e-3)

# ------------------------------------------------------------------ bus
func _buses(t: Node) -> void:
	for n in ["Effects", "Reverb", "Music"]:
		t.check(AudioServer.get_bus_index(n) != -1, "bus %s" % n)
	var fx := AudioServer.get_bus_index("Effects")
	t.check(AudioServer.get_bus_send(fx) == &"Master", "Effects -> Master")
	t.check(AudioServer.get_bus_send(AudioServer.get_bus_index("Reverb")) == &"Effects", "Reverb -> Effects")
	t.check(AudioServer.get_bus_send(AudioServer.get_bus_index("Music")) == &"Master", "Music -> Master")
	t.check(AudioServer.get_bus_effect(0, 0) is AudioEffectHardLimiter, "limiteur sur Master")
	t.near((AudioServer.get_bus_effect(0, 0) as AudioEffectHardLimiter).ceiling_db, -3.0, "plafond du limiteur")
	t.near((AudioServer.get_bus_effect(fx, 0) as AudioEffectAmplify).volume_db, linear_to_db(0.6), "gain 0,6 du bus Effects", 1e-6)
	t.check(AudioServer.get_bus_effect(fx, 1) is AudioEffectCompressor, "compresseur sur Effects")
	var rv := AudioServer.get_bus_index("Reverb")
	t.check(AudioServer.get_bus_effect(rv, 0) is AudioEffectReverb and (AudioServer.get_bus_effect(rv, 0) as AudioEffectReverb).dry == 0.0, "réverbération 100 % humide")
	var mu := AudioServer.get_bus_index("Music")
	t.check(AudioServer.get_bus_effect(mu, 0) is AudioEffectCompressor and (AudioServer.get_bus_effect(mu, 0) as AudioEffectCompressor).sidechain == &"Effects", "musique baissée par les effets (chaîne latérale)")
	t.check(AudioServer.get_bus_effect(mu, 1) is AudioEffectLowPassFilter, "passe-bas d'étouffement sur Music")
	# volumes des Options
	var path := "user://test_settings_j8.cfg"
	var st := Settings.new(path)
	st.autosave = false
	var saved: Settings = Game.settings
	Game.settings = st
	st.set_value("volume", 0.5)
	st.set_value("music", 0.25)
	Sfx.apply_settings()
	t.near(AudioServer.get_bus_volume_db(0), linear_to_db(0.5), "volume général -> bus Master", 1e-6)
	t.near(AudioServer.get_bus_volume_db(mu), linear_to_db(0.25), "volume de la musique -> bus Music", 1e-6)
	st.set_value("volume", 0.0)
	Sfx.apply_settings()
	t.check(AudioServer.get_bus_volume_db(0) <= -79.0, "volume 0 -> silence")
	Game.settings = saved
	Sfx.apply_settings()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))

# ------------------------------------------------------------------ signaux -> sons
func _count(name: String) -> int:
	return int(Sfx.counts.get(name, 0))

func _signals(t: Node) -> void:
	Game.new_game(3, "arena", [Rules.J1_WEAPON])
	Game.playing = true
	Sfx.reset()
	var z := ZombieSim.new()
	z.id = 777
	z.rng = Game.rng
	z.pos = Game.player.pos + Vector3(10.0, 0, 0)
	z.health = 1000.0
	Game.zombies.append(z)
	# zombie_event : volume = max(0, 1 - d / 45), position du zombie
	var n0 := _count("knock")
	Game.zombie_event.emit(z, "knock")
	t.check(_count("knock") == n0 + 1, "zombie_event knock -> knock")
	t.near(Sfx.recent[-1][1], 1.0 - 10.0 / 45.0, "volume du knock à 10 m", 1e-6)
	var g0 := _count("groan")
	var gl0 := _count("glass")
	Game.zombie_event.emit(z, "glass")
	t.check(_count("glass") == gl0 + 1 and _count("groan") == g0 + 1, "glass -> vitre + râle")
	var d0 := _count("dirt")
	Game.zombie_event.emit(z, "emerge")
	t.check(_count("dirt") == d0 + 1 and _count("groan") == g0 + 2, "emerge -> terre + râle")
	var r0 := _count("rumble")
	Game.zombie_event.emit(z, "rumble")
	t.check(_count("rumble") == r0 + 1, "rumble -> grondement")
	z.pos = Game.player.pos + Vector3(60.0, 0, 0)
	var sk0 := int(Sfx.stats["skipped"])
	Game.zombie_event.emit(z, "knock")
	t.check(int(Sfx.stats["skipped"]) == sk0 + 1, "knock hors de portée : volume nul ignoré")
	z.pos = Game.player.pos + Vector3(10.0, 0, 0)
	# tir : un son par pas, celui de l'arme en main
	var gun := AudioRules.gun_name(Game.arms.current.id)
	var s0 := _count(gun)
	Game.shot_fired.emit(Vector3.ZERO, Vector3.ONE)
	Game.shot_fired.emit(Vector3.ZERO, Vector3.ONE)   # même pas de simulation : un seul son
	t.check(_count(gun) == s0 + 1, "shot_fired -> %s une seule fois par pas" % gun)
	# touche : tête / corps, mort
	var h0 := _count("hit_head")
	var f0 := _count("hit_flesh")
	var kk0 := _count("kill")
	Game.hit_zombie(z, true, 1.0, 1.0)
	Game.hit_zombie(z, false, 1.0, 1.0)
	t.check(_count("hit_head") == h0 + 1 and _count("hit_flesh") == f0 + 1, "hit_confirmed -> tink à la tête, choc mou au corps")
	Game.hit_zombie(z, true, 1.0e6, 1.0)
	t.check(_count("kill") == kk0 + 1, "zombie_killed -> kill")
	# joueur touché
	var hu0 := _count("hurt")
	Game.player_hurt.emit(5.0)
	t.check(_count("hurt") == hu0 + 1, "player_hurt -> hurt")
	# explosion : volume max(0,1, 1 - d / 60) à la position
	var e0 := _count("explosion")
	Game.explosion.emit(Game.player.pos + Vector3(30.0, 0, 0), 5.0, 0)
	t.check(_count("explosion") == e0 + 1, "explosion -> explosion")
	t.near(Sfx.recent[-1][1], 0.5, "volume de l'explosion à 30 m", 1e-6)
	Game.explosion.emit(Game.player.pos + Vector3(300.0, 0, 0), 5.0, 0)
	t.near(Sfx.recent[-1][1], 0.1, "volume plancher d'une explosion lointaine", 1e-6)
	# manches, achats, bonus, machines
	var rs := _count("round_start")
	Game.round_started.emit(2)
	t.check(_count("round_start") == rs + 1 and not Sfx.lull, "round_started -> cor + fin de l'accalmie")
	Game.round_ended.emit()
	t.check(_count("round_end") >= 1 and Sfx.lull and Sfx.current_level() == 0, "round_ended -> accalmie (niveau 0)")
	Game.round_started.emit(3)
	var b0 := _count("buy")
	Game.perk_acquired.emit("juggernog")
	Game.weapon_acquired.emit("ak47")
	Game.door_opened.emit(0)
	t.check(_count("buy") == b0 + 3, "perk, arme et porte achetés -> buy")
	var dn0 := _count("deny")
	Game.purchase_denied.emit(500)
	Game.door_denied.emit(0)
	t.check(_count("deny") == dn0 + 2, "refus -> deny")
	var pw0 := _count("powerup")
	var nk0 := _count("nuke")
	Game.powerup_collected.emit("max_ammo")
	Game.powerup_collected.emit("nuke")
	t.check(_count("powerup") == pw0 + 2 and _count("nuke") == nk0 + 1, "powerup_collected -> fanfare (+ explosion pour la Bombe)")
	var jg := _count("jingle")
	Game.box_event.emit("roll", {})
	Game.box_event.emit("teddy", {})
	Game.box_event.emit("offer", {})
	t.check(_count("jingle") == jg + 1 and _count("nuke") == nk0 + 2 and _count("powerup") == pw0 + 3, "box_event roll / teddy / offer")
	var pp := _count("pap")
	Game.pap_event.emit("start", {})
	t.check(_count("pap") == pp + 1, "pap_event start -> pap")
	# points : aucun son du JS lié au gain de points lui-même
	var total := 0
	for k in Sfx.counts:
		total += int(Sfx.counts[k])
	Game.points_gained.emit(60, "")
	var total2 := 0
	for k in Sfx.counts:
		total2 += int(Sfx.counts[k])
	t.check(total == total2, "points_gained : pas de son propre (le JS n'en joue pas)")
	# véhicules : évènements de ride_event (v = null admis pour le carillon)
	var ch := _count("tram_chime_open")
	Game.ride_event.emit("chime", {"v": null, "open": true})
	t.check(_count("tram_chime_open") == ch + 1, "ride_event chime -> carillon")
	var bp := _count("beep")
	Game.ride_event.emit("beep", {"v": null})
	t.check(_count("beep") == bp + 1, "ride_event beep -> bip de réserve")
	var sv := _count("buy")
	Game.ride_event.emit("service", {"v": null})
	t.check(_count("buy") == sv + 1, "ride_event service -> buy")
	# armes : rechargement, couteau
	Game.arms.current.ammo = 3
	var rl_name := AudioRules.reload_name(String(Game.arms.current.cfg["cat"]), float(Game.arms.current.cfg["reloadTime"]))
	var rl0 := _count(rl_name)
	Game.step(1.0 / 60.0, {"reload": true})
	t.check(_count(rl_name) == rl0 + 1, "recharger -> %s" % rl_name)
	var ks := _count("knife_swing")
	Game.step(1.0 / 60.0, {"knife": true})
	t.check(_count("knife_swing") == ks + 1, "coup de couteau -> knife_swing")
	# tout est resté dans les bornes de voix
	t.check(Sfx.voice_count() <= Sfx.MAX_VOICES_3D + Sfx.MAX_VOICES_FLAT, "voix bornées après les évènements")
	Game.playing = false

func _voice_cap(t: Node) -> void:
	Sfx.stop_all()
	var stolen0 := int(Sfx.stats["stolen"])
	for i in 300:
		Sfx.play("gun_barrett")
		Sfx.play("explosion", 1.0, Vector3(float(i), 0, 0))
	t.check(Sfx.voice_count() <= Sfx.MAX_VOICES_3D + Sfx.MAX_VOICES_FLAT, "300 + 300 lectures : %d voix au plus" % Sfx.voice_count())
	t.check(Sfx.active_voices() <= Sfx.MAX_VOICES_3D + Sfx.MAX_VOICES_FLAT, "voix actives bornées (%d)" % Sfx.active_voices())
	t.check(int(Sfx.stats["stolen"]) > stolen0, "les plus anciennes voix sont reprises quand le plafond est atteint")
	t.check(Sfx.play("inconnu") == null and Sfx.play("kill", 0.01) == null, "son inconnu ou trop faible ignoré")
	Sfx.stop_all()

# ------------------------------------------------------------------ moteur
func _engine(t: Node) -> void:
	Game.new_game(7, "strasbourg", Config.at("startWeapons", []))
	Game.playing = true
	Sfx.reset()
	t.check(not Sfx.engine_playing(), "pas de moteur à pied")
	var r: Rides = Game.rides
	var moto: VehicleSim = null
	for v in r.vehicles:
		if v.type == "moto":
			moto = v
			break
	t.check(moto != null, "une moto dans le monde")
	if moto == null:
		return
	Game.player.pos = Vector3(moto.x + 1.0, 0.0, moto.z + 0.5)
	r.try_mount(moto, 0)
	t.check(r.ride != null and r.ride["v"] == moto, "monté sur la moto")
	var mount_n := _count("mount_moto")
	moto.speed = 10.0
	moto.throttle = 1.0
	for i in 40:
		Sfx._update_engine(0.05)
	t.check(Sfx.engine_playing(), "moteur en marche une fois assis")
	var bake_rpm := float(Sfx.manifest["engines"]["engine_moto"]["rpm"])
	var want_pitch := AudioRules.engine_freq("moto", AudioRules.moto_rpm(10.0, float(moto.def["maxSpeed"]), 1.0)) / AudioRules.engine_freq("moto", bake_rpm)
	t.near(Sfx._engine.pitch_scale, want_pitch, "hauteur du moteur à 10 m/s (pitch_scale)", 1e-3)
	var p_fast := Sfx._engine.pitch_scale
	moto.speed = 0.5
	moto.throttle = 0.0
	for i in 60:
		Sfx._update_engine(0.05)
	t.check(Sfx._engine.pitch_scale < p_fast, "le moteur redescend au ralenti (pitch %.2f < %.2f)" % [Sfx._engine.pitch_scale, p_fast])
	var loop := Sfx._engine.stream as AudioStreamWAV
	t.check(loop != null and loop.loop_mode == AudioStreamWAV.LOOP_FORWARD and loop.loop_end > 0, "boucle de moteur bouclée")
	moto.fuel = 0.0
	for i in 20:
		Sfx._update_engine(0.05)
	t.check(not Sfx.engine_playing(), "panne sèche : moteur coupé")
	var _unused := mount_n
	Game.playing = false

# ------------------------------------------------------------------ morceau personnalisé facultatif
func _custom_track(t: Node) -> void:
	t.check(Sfx.find_custom_track(["user://inexistant_j8/"]) == null, "sans theme.* : pas de morceau personnalisé")
	var dir := "user://test_music_j8/"
	DirAccess.make_dir_recursive_absolute(dir)
	# un WAV de 0,5 s (La 440 Hz) écrit à la main
	var n := 22050
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		data.encode_s16(2 * i, int(sin(TAU * 440.0 * i / 44100.0) * 12000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = 44100
	w.data = data
	var err := w.save_to_wav(dir + "theme.wav")
	t.check(err == OK, "écriture d'un theme.wav d'essai")
	var s := Sfx.find_custom_track([dir])
	t.check(s is AudioStreamWAV and (s as AudioStreamWAV).loop_mode == AudioStreamWAV.LOOP_FORWARD, "theme.wav trouvé et bouclé")
	if s != null:
		t.near(s.get_length(), 0.5, "durée du morceau personnalisé", 1e-2)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(dir + "theme.wav"))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(dir))
	# jamais commité : le motif est dans .gitignore
	var ig := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://").path_join("../.gitignore"))
	t.check(ig.contains("godot/assets/audio/music/theme.*"), ".gitignore ignore godot/assets/audio/music/theme.*")
	# niveaux : la musique suit l'intensité et l'accalmie
	Sfx.lull = false
	Sfx.intensity = 0.8
	t.check(Sfx.current_level() == 3, "intensité 0,8 -> niveau 3")
	Sfx.intensity = 0.3
	t.check(Sfx.current_level() == 1, "intensité 0,3 -> niveau 1")
	Sfx.lull = true
	t.check(Sfx.current_level() == 0, "accalmie -> niveau 0")
	Sfx.lull = false
	Sfx.set_mood(0.3, true)
	t.check(Sfx.muffled and Sfx.muffle_target()["hz"] == 650.0, "menu : musique étouffée à 650 Hz")
	Sfx.set_mood(0.55, false)
	t.check(not Sfx.muffled and Sfx.muffle_target()["hz"] == 20000.0 and Sfx.intensity == 0.55, "partie : musique ouverte")
	# démarrage réel de la musique : un lecteur par niveau joué, bouclé
	Sfx.start_music()
	t.check(Sfx.music_started and Sfx.custom_music == null and Sfx.music_level == AudioRules.music_level(0.55, false), "musique lancée au niveau %d" % Sfx.music_level)
	var cur: AudioStreamPlayer = Sfx._music_players[Sfx._music_cur]
	t.check(cur.playing and cur.bus == &"Music" and (cur.stream as AudioStreamOggVorbis).loop, "boucle jouée sur le bus Music")
	Sfx.set_mood(1.0, false)
	t.check(Sfx.music_level == 3 and Sfx._music_players[Sfx._music_cur] != cur, "intensité 1 : fondu enchaîné vers le niveau 3")
