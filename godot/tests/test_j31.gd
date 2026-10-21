extends RefCounted
## v0.25.0 : cycle jour / nuit (sim/day_night.gd) : astronomie (lever 6 h, coucher 18 h, soleil et lune opposés), sky_k, lampadaires, avance de l'heure (durée du jour réglable),
## modes Auto / Toujours nuit / Toujours jour, finale « L'Aube » qui garde la main sur le ciel, Nuit éternelle, équilibrage (+10 % de vie la nuit en Auto seulement),
## sauvegarde de l'heure dans la partie, réglages (Options) et section Config.at("dayNight").

func run(t: Node) -> void:
	# --- section de Config propre au port
	t.near(Config.at("dayNight.nightZombieHealth"), 1.10, "Config : +10 % de vie la nuit")
	t.near(Config.at("dayNight.dayMinutes"), 14.0, "Config : 14 minutes par jour")
	# --- astronomie
	t.near(DayNight.sun_elevation(6.0), 0.0, "lever du soleil à 6 h", 1e-6)
	t.near(DayNight.sun_elevation(18.0), 0.0, "coucher à 18 h", 1e-6)
	t.near(DayNight.sun_elevation(12.0), 58.0, "midi : 58 degrés", 1e-6)
	t.near(DayNight.sun_elevation(0.0), -58.0, "minuit : -58 degrés", 1e-6)
	for h in [0.0, 3.3, 6.0, 9.5, 12.0, 15.1, 18.0, 21.7]:
		t.near(DayNight.sun_dir(h).length(), 1.0, "direction du soleil unitaire à %.1f h" % h)
		t.check(DayNight.sun_dir(h).dot(DayNight.moon_dir(h)) < -0.999, "la lune est à l'opposé du soleil à %.1f h" % h)
	t.check(DayNight.sun_dir(6.0).x > 0.9 and absf(DayNight.sun_dir(6.0).y) < 1e-6, "le soleil se lève du côté de l'azimut 20 degrés (+x)")
	t.check(DayNight.sun_dir(7.0).y > 0.2 and DayNight.sun_dir(17.0).y > 0.2 and DayNight.sun_dir(20.0).y < 0.0, "le soleil est haut le jour et sous l'horizon le soir")
	# --- sky_k : 0 la nuit, 0,5 doré à 5 degrés, 1 en plein jour ; monotone du lever à midi
	t.near(DayNight.sky_k_at(0.0), 0.0, "sky_k : minuit")
	t.near(DayNight.sky_k_at(12.0), 1.0, "sky_k : midi")
	t.near(DayNight.k_of_elevation(5.0), 0.5, "sky_k : 5 degrés = aube dorée")
	var prev := -1.0
	var mono := true
	for i in 25:
		var k := DayNight.sky_k_at(3.0 + 0.25 * i)   # 3 h .. 9 h
		mono = mono and k >= prev - 1e-9
		prev = k
	t.check(mono, "sky_k croît du petit matin à la fin de la matinée")
	t.near(DayNight.sky_k_at(8.0), DayNight.sky_k_at(16.0), "le ciel est symétrique autour de midi (aube = crépuscule)")
	# --- lampadaires : allumés la nuit, éteints le jour, courbe monotone
	t.near(DayNight.lamps_of(0.0), 1.0, "lampadaires allumés la nuit")
	t.near(DayNight.lamps_of(1.0), 0.0, "lampadaires éteints le jour")
	t.check(DayNight.lamps_of(0.4) < DayNight.lamps_of(0.3) and DayNight.lamps_of(0.5) < DayNight.lamps_of(0.4), "lampadaires : s'éteignent quand le ciel s'éclaire")
	# --- avance de l'heure : 14 minutes réelles pour 24 h
	var d := DayNight.new()
	d.reset(DayNight.MODE_AUTO, 14.0)
	t.near(d.hour, 9.0, "heure de départ : 9 h")
	for _i in 60 * 14 * 10:
		d.update(0.1, -1.0, false)
	t.near(d.hour, 9.0, "14 minutes réelles = un tour de cadran", 1e-3)
	t.check(d.days == 1, "un jour compté")
	var d2 := DayNight.new()
	d2.reset(DayNight.MODE_AUTO, 6.0)
	d2.update(60.0, -1.0, false)
	t.near(d2.hour, 9.0 + 24.0 / 6.0, "durée du jour réglable : 6 minutes -> 4 h de jeu par minute", 1e-6)
	t.check(d2.clock_text() == "13:00", "horloge « 13:00 » (%s)" % d2.clock_text())
	d2.hour = 5.55
	t.check(d2.clock_text() == "05:30", "l'horloge avance par quarts d'heure (%s)" % d2.clock_text())
	t.check(d2.phase_name() != "" and d2.clock_visible(), "phase affichée et horloge visible en Auto")
	# --- modes
	var dn := DayNight.new()
	dn.reset(DayNight.MODE_NIGHT, 14.0)
	for _i in 600:
		dn.update(0.1, -1.0, false)
	t.check(dn.hour == 0.0 and dn.sky_k == 0.0 and dn.is_night() and not dn.clock_visible(), "Toujours nuit : minuit figé, pas d'horloge")
	t.near(dn.zombie_health_mult(), 1.0, "Toujours nuit : l'ancien équilibre (aucun bonus)")
	dn.reset(DayNight.MODE_DAY, 14.0)
	for _i in 600:
		dn.update(0.1, -1.0, false)
	t.check(dn.hour == 10.0 and dn.sky_k == 1.0 and not dn.is_night(), "Toujours jour : 10 h figées")
	t.near(dn.zombie_health_mult(), 1.0, "Toujours jour : aucun bonus")
	# --- équilibrage : Auto, nuit = +10 % de vie
	var a := DayNight.new()
	a.reset(DayNight.MODE_AUTO, 14.0)
	a.hour = 23.0
	a.update(0.0, -1.0, false)
	for _i in 10:
		a.update(1.0, -1.0, false)
	t.check(a.is_night(), "23 h : il fait nuit")
	t.near(a.zombie_health_mult(), 1.10, "Auto, la nuit : +10 % de vie")
	a.hour = 12.0
	for _i in 10:
		a.update(1.0, -1.0, false)
	t.near(a.zombie_health_mult(), 1.0, "Auto, le jour : rien")
	# --- le ciel se rattrape à easeRate par seconde (jamais de saut)
	a.hour = 23.5
	a.frozen = true
	var before := a.sky_k
	a.update(0.5, -1.0, false)
	t.check(absf(a.sky_k - before) <= 0.35 * 0.5 + 1e-9, "changement d'heure brusque : le ciel suit à 0,35 par seconde (%.3f -> %.3f)" % [before, a.sky_k])
	for _i in 20:
		a.update(0.5, -1.0, false)
	t.near(a.sky_k, 0.0, "puis atteint la nuit")
	a.frozen = false
	# --- la finale garde la main sur le ciel, la Nuit éternelle fige la nuit en Auto
	var f := DayNight.new()
	f.reset(DayNight.MODE_AUTO, 14.0)
	f.update(0.1, 0.0, false)
	t.check(f.override and not f.clock_visible(), "finale : le ciel est celui de la finale, pas d'horloge")
	t.near(f.zombie_health_mult(), 1.0, "finale : pas de bonus de nuit")
	for _i in 10:
		f.update(1.0, 0.0, false)
	t.near(f.sky_k, 0.0, "finale : la nuit se refait avant l'Aube (le ciel ne saute pas)")
	var h0 := f.hour
	f.update(1.0, 0.8, false)
	t.near(f.hour, h0, "finale : l'heure du jeu ne bouge pas")
	t.check(f.sky_k > 0.0 and f.sky_k <= 0.35 + 1e-9, "finale : le ciel monte vers k de la finale à easeRate au plus (%.3f)" % f.sky_k)
	for _i in 10:
		f.update(1.0, 0.8, false)
	t.near(f.sky_k, 0.8, "finale : k de la finale atteint")
	f.update(0.1, -1.0, true)
	t.check(not f.override and f.hour == 0.0, "Nuit éternelle : minuit, le cycle ne tourne plus")
	for _i in 20:
		f.update(0.5, -1.0, true)
	t.near(f.sky_k, 0.0, "Nuit éternelle : le ciel retombe à la nuit")
	f.configure(DayNight.MODE_DAY, 14.0)
	f.update(0.1, -1.0, true)
	t.check(f.hour == 10.0, "Toujours jour reste jour même en Nuit éternelle (le joueur a choisi)")
	# --- sauvegarde de l'heure
	var s := DayNight.new()
	s.reset(DayNight.MODE_AUTO, 14.0)
	s.hour = 19.25
	s.days = 3
	var dict := s.to_dict()
	var s2 := DayNight.new()
	s2.reset(DayNight.MODE_AUTO, 14.0)
	s2.from_dict(JSON.parse_string(JSON.stringify(dict)))
	t.check(s2.hour == 19.25 and s2.days == 3 and absf(s2.sky_k - DayNight.sky_k_at(19.25)) < 1e-9, "l'heure et les jours reviennent d'une partie sauvegardée (JSON)")
	# --- dans la partie : Game.daynight, apparition des zombies (arène)
	Game.new_game(5, "arena")
	t.check(Game.daynight.mode == DayNight.MODE_NIGHT and Game.daynight.hour == 0.0, "Game.new_game : la nuit d'avant par défaut (tests, golden)")
	Game.daynight.reset(DayNight.MODE_AUTO, 14.0)
	Game.daynight.hour = 23.0
	Game.daynight.sky_k = 0.0
	Game.daynight.frozen = true
	Game.director.round_number = 3
	Game.director.zombie_health = 200.0
	var n0 := Game.zombies.size()
	Game._spawn_zombie()
	t.check(Game.zombies.size() == n0 + 1, "un zombie apparaît")
	t.near(Game.zombies[Game.zombies.size() - 1].max_health, 220.0, "la nuit en Auto, le zombie apparaît avec 10 % de vie en plus (200 -> 220)")
	Game.daynight.hour = 12.0
	Game.daynight.sky_k = 1.0
	Game._spawn_zombie()
	t.near(Game.zombies[Game.zombies.size() - 1].max_health, 200.0, "le jour en Auto : vie de base")
	Game.step(0.1, {})
	t.near(Game.daynight.hour, 12.0, "Game.step : l'heure gelée (--hold-hour) ne bouge pas")
	Game.daynight.frozen = false
	var hh := Game.daynight.hour
	Game.step(1.0, {})
	t.near(Game.daynight.hour, hh + 24.0 / (14.0 * 60.0), "Game.step : une seconde = 1/35 h de jeu", 1e-6)
	t.near(Game.finale_sky(), -1.0, "arène : pas de finale, le cycle dessine le ciel")
	# --- réglages (Options)
	var st := Settings.new("user://test_j31_settings.cfg")
	st.autosave = false
	t.check(int(st.get_value("daynight")) == 0 and int(st.get_value("day_minutes")) == 14 and int(st.get_value("view")) == 0, "réglages par défaut : cycle Auto, 14 min, première personne")
	st.set_value("daynight", 2)
	st.set_value("day_minutes", 99)
	t.check(int(st.get_value("daynight")) == 2 and int(st.get_value("day_minutes")) == 30, "réglages bornés (durée du jour 4..30 min)")
	t.check(Settings.format("daynight", 1.0) == "Toujours nuit" and Settings.format("daynight", 2.0) == "Toujours jour" and Settings.format("day_minutes", 14.0) == "14 min", "textes des réglages")
	t.check(Settings.format("view", 1.0) == "3e personne" and Settings.format("view", 0.0) == "1re personne", "texte de la vue")
	st.autosave = true
	st.set_value("daynight", 1)
	var st2 := Settings.new("user://test_j31_settings.cfg")
	t.check(int(st2.get_value("daynight")) == 1 and int(st2.get_value("day_minutes")) == 30, "les réglages sont mémorisés")
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://test_j31_settings.cfg"))
	Game.unload()
