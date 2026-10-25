extends RefCounted
## v0.37.0 : carte de test des véhicules (sim/vehicle_lab.gd, sim/vehicle_lab_map.gd, map "vehicules"). Suite j44 :
##   - plan et collision : une zone, ni porte, ni fenêtre, ni machine, ni arme murale, ni borne ; murs du hangar, mur de crash, pourtour ;
##   - partie : ni zombie, ni manche, ni fin de partie, ni arme (tir sans effet, pas de grenade), le joueur ne meurt pas ;
##   - véhicules : moto, grosse moto, vélo, motoneige, deux voitures et le tram, garés dans le hangar, tous montés et conduits ; le tram roule sur la
##     voie d'essai, alimenté ;
##   - relief et adhérence : tremplin (décollage, vol, atterrissage, longueur du saut), bosses, pente (la montée freine), glace et boue ;
##   - télémétrie : vitesse, g latéral, angle de dérapage ; 0-50 / 0-100, distance de freinage, choc sur le mur de crash, chrono de tour (meilleur) ;
##   - plots renversés (slalom, cible), touches (réparer, réinitialiser, hangar, sortir / ranger, jour / nuit), journal --vehicle-log ;
##   - les autres cartes n'ont pas de relief (World.terrain nul).

const DT := 1.0 / 60.0
const EAST := -PI / 2.0   ## cap vers +x
const WEST := PI / 2.0

func run(t: Node) -> void:
	var w := VehicleLabMap.load_map()
	print("j44 : banc d'essai chargé en %d ms" % w.load_ms)
	_plan(t, w)
	_game(t)
	_vehicles(t)
	_tram(t)
	_relief(t)
	_grip(t)
	_measures(t)
	_laps(t)
	_cones(t)
	_keys(t)
	_log(t)
	Game.mode = GameMode.CLASSIC

func _new() -> Rides:
	Game.mode = GameMode.CLASSIC
	Game.new_game(5, "vehicules", Config.at("startWeapons", []))
	return Game.rides

func _steps(n: int, input: Dictionary) -> void:
	for _i in n:
		Game.step(DT, input)

func _find(r: Rides, name: String) -> VehicleSim:
	for v in r.vehicles:
		if String(v.def["name"]) == name:
			return v
	return null

## Monte sur v, le place en (x, z), cap, vitesse (m/s).
func _ride(r: Rides, v: VehicleSim, x: float, z: float, yaw: float, sp := 0.0) -> void:
	if r.ride != null:
		r.leave_vehicle(true)
	Game.player.pos = Vector3(v.x + 1.0, 0.0, v.z)
	r.try_mount(v, 0)
	v.x = x
	v.z = z
	v.yaw = yaw
	v.speed = sp
	v.y = Game.lab.height(x, z)
	if sp == 0.0:
		VehicleLab._stop(v)
	_steps(1, {})

# ------------------------------------------------------------------ plan
func _plan(t: Node, w: World) -> void:
	t.check(w.map_id == "vehicules" and w.terrain is VehicleLab, "carte « vehicules » avec relief (VehicleLab)")
	t.check(w.zone_names.size() == 1 and w.doors.is_empty() and w.window_count() == 0, "une zone, ni porte ni fenêtre")
	t.check((w.objects["machines"] as Array).is_empty() and (w.objects["wallWeapons"] as Array).is_empty() and (w.objects["stations"] as Array).is_empty(), "ni machine, ni arme murale, ni borne")
	t.check(w.zone_of(VehicleLab.START.x, VehicleLab.START.z) == 0 and not w.nav.is_blocked_at(VehicleLab.START.x, VehicleLab.START.z), "départ libre dans la zone")
	t.check(Settings.MAPS.has("vehicules"), "réglage de carte : banc d'essai")
	var view: GDScript = load("res://scenes/world/vehicle_lab_view.gd")
	t.check(view != null and view.can_instantiate(), "vue du banc d'essai compilée")
	t.check(AlpineMap.load_map().terrain == null, "la station alpine reste plate (pas de relief)")
	var c := w.collision
	for probe: Array in [[Vector3(-16, 0.1, -11.9), "mur nord du hangar"], [Vector3(-23.9, 0.1, 0), "mur ouest du hangar"], [Vector3(20, 0.1, 11.9), "mur sud du hangar (hors porte)"],
			[Vector3(VehicleLab.CRASH["x"] - 0.5, 0.1, VehicleLab.CRASH["z"]), "mur de crash"], [Vector3(0, 0.1, VehicleLab.EDGE - 0.1), "pourtour"]]:
		var q: Vector3 = c.resolve(probe[0], 0.45)
		t.check(Vector2(q.x - probe[0].x, q.z - probe[0].z).length() > 0.2, "collision : %s" % probe[1])
	var door: Vector3 = c.resolve(Vector3(0, 0.1, 12.0), 0.45)
	t.check(Vector2(door.x, door.z - 12.0).length() < 0.01, "la grande porte du hangar est ouverte")

# ------------------------------------------------------------------ partie sans zombie ni arme
func _game(t: Node) -> void:
	var r := _new()
	t.check(Game.lab != null and Game.lab == Game.world.terrain, "Game.lab : le relief de la carte")
	t.check(Game.machines == null and Game.finale == null and Game.gm == null and Game.timed == null and Game.arsenal == null, "ni machines, ni finale, ni mode")
	t.check(Game.arms.grenades == 0, "pas de grenade")
	t.check(Game.player.pos.distance_to(VehicleLab.START) < 0.01, "départ dans le hangar")
	var shots := [0]
	var cb := func(_o: Vector3, _e: Vector3) -> void: shots[0] += 1
	Game.shot_fired.connect(cb)
	var ammo := Game.arms.current.ammo
	_steps(60, {"fire": true, "reload": true, "grenade": true, "knife": true})
	Game.shot_fired.disconnect(cb)
	t.check(shots[0] == 0 and Game.arms.current.ammo == ammo and Game.arms.melee_t < 0.0, "le tir, le couteau et les grenades sont sans effet")
	_steps(60 * 40, {})
	t.check(Game.zombies.is_empty() and Game.round_number == 0 and not Game.over, "40 s : aucun zombie, aucune manche, pas de fin de partie")
	Game.player.hurt(1.0e6, Game.time)
	_steps(2, {})
	t.check(not Game.player.dead and not Game.over and Game.player.health == Game.player.max_health, "le joueur ne meurt pas sur le banc d'essai")
	t.check(r.parkings.is_empty() and r.trams.size() == 1, "pas de borne payante ; une rame")

# ------------------------------------------------------------------ véhicules
func _vehicles(t: Node) -> void:
	var r := _new()
	var names: Array = []
	for v in r.vehicles:
		names.append(String(v.def["name"]))
		t.check(VehicleLab.HANGAR.has_point(Vector2(v.x, v.z)), "%s garé dans le hangar" % v.def["name"])
	for n in ["MOTO", "GROSSE MOTO", "VÉLO", "MOTONEIGE", "VOITURE"]:
		t.check(names.has(n), "véhicule présent : %s" % n)
	t.check(names.count("VOITURE") == 2 and r.vehicles.size() == 6, "6 machines au garage (%s)" % [names])
	t.check(_find(r, "MOTONEIGE").def["model"] == "motoneige" and _find(r, "GROSSE MOTO").def.get("model", "") != "motoneige", "motoneige habillée, grosse moto intacte")
	for v in r.vehicles:
		var p0 := Vector2(v.x, v.z)
		Game.player.pos = Vector3(v.x + 1.4, 0.0, v.z)
		r.try_mount(v, 0)
		t.check(r.ride != null and r.ride["v"] == v and r.driving(), "%s : on monte au guidon / au volant" % v.def["name"])
		_steps(120, {"mz": 1.0})
		var moved := Vector2(v.x, v.z).distance_to(p0)
		t.check(moved > 2.0 and v.state == "ok", "%s : démarre et avance (%.1f m en 2 s)" % [v.def["name"], moved])
		t.check(Game.lab.veh == v and Game.lab.speed > 1.0, "%s : télémétrie de la machine conduite (%.1f m/s)" % [v.def["name"], Game.lab.speed])
		r.leave_vehicle(true)
		t.check(r.ride == null, "%s : on descend" % v.def["name"])

func _tram(t: Node) -> void:
	var r := _new()
	var tr: TramSim = r.trams[0]
	t.check(r.tram_powered and tr.track.id == "ESSAI" and absf(tr.track.L - 220.0) < 1.0, "tram : voie d'essai de 220 m, alimentée")
	t.check(absf(tr.pos.z - VehicleLab.RAIL["z"]) < 0.5, "tram sur la voie (z %.1f)" % tr.pos.z)
	r.try_mount(tr, 0)
	t.check(r.ride != null and r.driving(), "tram : en cabine")
	var s0 := tr.s
	_steps(60 * 8, {"mz": 1.0})
	t.check(tr.s > s0 + 5.0 and Game.lab.veh == tr, "tram : roule (%.1f m) et la télémétrie le suit" % (tr.s - s0))
	_steps(60 * 40, {"mz": 1.0})
	t.check(tr.s <= tr.track.L - tr.L / 2.0 and tr.state == "ok", "tram : s'arrête avant le heurtoir (s %.1f / %.1f)" % [tr.s, tr.track.L])
	r.leave_vehicle(true)

# ------------------------------------------------------------------ relief
func _relief(t: Node) -> void:
	var r := _new()
	var lab := Game.lab
	var R: Dictionary = VehicleLab.RAMPS[0]
	t.check(absf(lab.height(float(R["x0"]) + float(R["len"]) - 0.01, R["z"]) - float(R["h"])) < 0.01 and lab.height(float(R["x0"]) - 0.1, R["z"]) == 0.0, "tremplin : 0 à l'entrée, %.1f m au bord" % float(R["h"]))
	var moto := _find(r, "MOTO")
	_ride(r, moto, float(R["x0"]) - 14.0, float(R["z"]), EAST, 17.0)
	var flew := false
	var peak := 0.0
	for i in 60 * 5:
		Game.step(DT, {"mz": 1.0})
		flew = flew or moto.air
		peak = maxf(peak, moto.y)
	var j: Dictionary = lab.last_jump
	print("j44 : saut de la moto : %s, sommet %.2f m" % [j, peak])
	t.check(flew and not moto.air and not j.is_empty() and float(j["d"]) > 6.0 and float(j["t"]) > 0.4, "moto : décolle au bout du tremplin et retombe (%s)" % [j])
	t.check(peak > float(R["h"]) and absf(moto.y) < 0.01, "moto : vole plus haut que le bord (%.2f m) et retombe au sol" % peak)
	# la voiture sur les bosses
	var car := _find(r, "VOITURE")
	_ride(r, car, 32.0, VehicleLab.BUMP_LANE["z"], EAST, 6.0)
	var ymax := 0.0
	for i in 60 * 6:
		Game.step(DT, {"mz": 0.4 if i % 2 == 0 else 0.0})
		ymax = maxf(ymax, car.y)
	t.check(ymax > 0.08 and car.x > 60.0, "voiture : franchit les dos d'âne et bosses (y max %.2f m, x %.0f)" % [ymax, car.x])
	# la pente freine (roue libre), la voiture monte sur le plateau
	var H: Dictionary = VehicleLab.HILL
	_ride(r, car, float(H["x0"]) - 3.0, H["z"], EAST, 14.0)
	_steps(60 * 2, {})
	var on_hill := car.speed
	var top := car.y
	_ride(r, car, float(H["x0"]) - 3.0, -16.0, EAST, 14.0)
	_steps(60 * 2, {})
	t.check(top > 2.0 and on_hill < car.speed - 2.0, "pente : la montée freine (%.1f contre %.1f m/s à plat), hauteur %.1f m" % [on_hill, car.speed, top])
	r.leave_vehicle(true)
	# à pied : le joueur monte la pente
	Game.player.pos = Vector3(float(H["x0"]) + float(H["up"]) + 2.0, 0.0, float(H["z"]))
	_steps(30, {})
	t.check(Game.player.pos.y > float(H["h"]) - 0.1, "à pied : sur le plateau de la colline (y %.2f)" % Game.player.pos.y)

func _grip(t: Node) -> void:
	var r := _new()
	var car := _find(r, "VOITURE")
	var I := VehicleLab.ICE
	t.check(Game.lab.grip(I.get_center().x, I.get_center().y) < 0.3 and Game.lab.grip(VehicleLab.MUD.get_center().x, VehicleLab.MUD.get_center().y) < 0.6 and Game.lab.grip(0, 40) == 1.0, "adhérence : glace, boue, asphalte")
	var d := {}
	for k: String in ["glace", "boue", "asphalte"]:
		var p := I.position + Vector2(1.0, 6.0) if k == "glace" else (Vector2(VehicleLab.MUD.position.x + 6.0, VehicleLab.MUD.position.y + 1.0) if k == "boue" else Vector2(VehicleLab.DRAG["x0"], VehicleLab.DRAG["z"]))
		_ride(r, car, p.x, p.y, EAST if k != "boue" else PI, 0.0)
		_steps(60 * 2, {"mz": 1.0})
		d[k] = Vector2(car.x, car.z).distance_to(p)
		t.check(Game.lab.surface == k, "sol mesuré : %s" % k)
	t.check(float(d["glace"]) < float(d["boue"]) and float(d["boue"]) < float(d["asphalte"]), "accélération sur 2 s : glace %.1f m < boue %.1f m < asphalte %.1f m" % [d["glace"], d["boue"], d["asphalte"]])
	# freinage sur la glace : bien plus long
	_ride(r, car, I.position.x + 0.5, I.position.y + 12.0, EAST, 12.0)
	_steps(4, {"mz": 1.0})
	_steps(60 * 6, {"mz": -1.0})
	var ice_b: Dictionary = Game.lab.last_brake
	_ride(r, car, VehicleLab.DRAG["x0"], VehicleLab.DRAG["z"], EAST, 12.0)
	_steps(4, {"mz": 1.0})
	_steps(60 * 6, {"mz": -1.0})
	var dry_b: Dictionary = Game.lab.last_brake
	t.check(not ice_b.is_empty() and not dry_b.is_empty() and float(ice_b["d"]) > 2.0 * float(dry_b["d"]) and ice_b["surface"] == "glace", "freinage à 43 km/h : glace %s m, asphalte %s m" % [ice_b.get("d"), dry_b.get("d")])

# ------------------------------------------------------------------ mesures
func _measures(t: Node) -> void:
	var r := _new()
	var lab := Game.lab
	var car := _find(r, "VOITURE")
	_ride(r, car, VehicleLab.DRAG["x0"], VehicleLab.DRAG["z"], EAST, 0.0)
	_steps(30, {})
	var top := 0.0
	for i in 60 * 10:
		Game.step(DT, {"mz": 1.0})
		top = maxf(top, lab.speed)
	t.check(lab.t50 > 2.0 and lab.t50 < 6.0, "voiture : 0-50 km/h en %.2f s" % lab.t50)
	t.check(lab.t100 < 0.0 and lab.max_kmh < 100.0 and lab.max_kmh > 85.0, "voiture : 100 km/h hors d'atteinte (max %.0f km/h)" % lab.max_kmh)
	t.check(absf(top * 3.6 - car.ground_speed() * 3.6) < 3.0, "vitesse mesurée = vitesse de la voiture (%.1f / %.1f km/h)" % [top * 3.6, car.ground_speed() * 3.6])
	t.check(lab.long_g > 0.0 and lab.hud_text().contains("0-50 :"), "accélération positive, 0-50 au HUD")
	_steps(60 * 5, {"mz": -1.0})
	var b: Dictionary = lab.last_brake
	t.check(not b.is_empty() and float(b["v0"]) > 80.0 and float(b["d"]) > 10.0 and float(b["d"]) < 40.0, "freinage %s km/h -> 0 : %s m" % [b.get("v0"), b.get("d")])
	t.check(not lab.last_accel.is_empty() and float(lab.last_accel["max_kmh"]) > 85.0, "0-100 enregistré à la levée du pied (%s)" % [lab.last_accel])
	t.check(lab.hud_text().contains("Freinage"), "freinage au HUD")
	# virage : g latéral ; frein à main : dérapage
	_ride(r, car, -60.0, 104.0, EAST, 18.0)
	var lat := 0.0
	var slip := 0.0
	for i in 60:
		Game.step(DT, {"mz": 1.0, "mx": 1.0})
		lat = maxf(lat, absf(lab.lat_g))
	for i in 40:
		Game.step(DT, {"mx": 1.0, "jump": true})
		slip = maxf(slip, absf(lab.slip_deg))
	t.check(lat > 0.4 and lat < 2.0, "virage : %.2f g latéral" % lat)
	t.check(slip > 4.0, "frein à main : dérapage de %.0f°" % slip)
	# mur de crash
	car.hp = car.max_hp()
	_ride(r, car, float(VehicleLab.CRASH["x"]) - 50.0, VehicleLab.CRASH["z"], EAST, 20.0)
	var hp0 := car.hp
	_steps(60 * 4, {"mz": 1.0})
	var c: Dictionary = lab.last_crash.duplicate()
	print("j44 : choc sur le mur de crash : %s" % [c])
	t.check(not c.is_empty() and c["where"] == "mur de crash" and float(c["kmh"]) > 60.0 and float(c["hp"]) > 0.0 and car.hp < hp0, "choc mesuré sur le mur de crash (%s)" % [c])
	t.check(car.x < float(VehicleLab.CRASH["x"]) - 0.5, "la voiture ne traverse pas le mur (x %.2f)" % car.x)
	t.check(lab.hud_text().contains("Choc"), "choc au HUD")

func _laps(t: Node) -> void:
	_new()
	var lab := Game.lab
	lab.veh = null
	var seq := [VehicleLab.CPS[0], VehicleLab.CPS[1], VehicleLab.CPS[2], VehicleLab.CPS[3], VehicleLab.CPS[0]]
	for k in 2:
		for i in seq.size():
			if k == 1 and i == 0:
				continue
			for _s in (60 * 6 if k == 0 else 60 * 5):   # 6 s (puis 5 s) entre deux points
				lab._laps(DT, Vector2(500, 500))
			lab._laps(DT, seq[i])
	t.check(lab.laps == 2 and absf(lab.last_lap - 20.0) < 0.2 and absf(lab.best_lap - 20.0) < 0.2, "chrono : deux tours, meilleur %.2f s" % lab.best_lap)
	lab._laps(DT, VehicleLab.CPS[1])
	for _s in 60 * 3:
		lab._laps(DT, Vector2(500, 500))
	lab._laps(DT, VehicleLab.CPS[0])
	t.check(lab.laps == 2, "un tour sans les points de passage ne compte pas")
	t.check(VehicleLab._clock(83.456) == "1:23,46", "affichage du chrono (%s)" % VehicleLab._clock(83.456))

func _cones(t: Node) -> void:
	var r := _new()
	var lab := Game.lab
	t.check(lab.cones.size() == int(VehicleLab.SLALOM["n"]) + 10, "plots : slalom et cible de 10")
	var car := _find(r, "VOITURE")
	var c0: Dictionary = lab.cones[0]
	_ride(r, car, float(c0["x"]) - 12.0, c0["z"], EAST, 10.0)
	_steps(60 * 2, {"mz": 1.0})
	t.check(int(lab.knocked["slalom"]) >= 1 and bool(c0["down"]) and Vector2(c0["x"], c0["z"]).distance_to(Vector2(c0["x0"], c0["z0"])) > 1.0, "voiture : plot du slalom renversé et projeté (%d)" % lab.knocked["slalom"])
	var moto := _find(r, "MOTO")
	_ride(r, moto, VehicleLab.TARGET.x + 12.0, VehicleLab.TARGET.y, WEST, 12.0)
	_steps(60 * 2, {"mz": 1.0})
	t.check(int(lab.knocked["target"]) >= 3, "moto : %d plots de la cible renversés" % lab.knocked["target"])
	r.leave_vehicle(true)
	lab.reset_vehicle(Game)
	t.check(int(lab.knocked["slalom"]) == 0 and not bool(lab.cones[0]["down"]), "réinitialiser : plots relevés")

func _keys(t: Node) -> void:
	var r := _new()
	var lab := Game.lab
	var car := _find(r, "VOITURE")
	_ride(r, car, 0.0, 40.0, EAST, 15.0)
	car.hp = car.max_hp() * 0.1
	car.fuel = 0.0
	lab.service(Game)
	t.check(car.hp == car.max_hp() and car.fuel == float(car.def["tank"]), "R : réparé et plein fait")
	lab.reset_vehicle(Game)
	t.check(car.speed == 0.0 and car.slip == 0.0 and not car.air and lab.best_lap < 0.0, "X : arrêté, d'aplomb, mesures effacées")
	lab.to_hangar(Game)
	t.check(Vector2(car.x, car.z).distance_to(Vector2(car.spawn["x"], car.spawn["z"])) < 0.01 and r.ride != null, "P : la voiture revient à sa place, conducteur à bord")
	_ride(r, car, 0.0, 40.0, EAST, 0.0)
	lab.spawn_or_stow(Game)
	t.check(r.ride == null and Vector2(car.x, car.z).distance_to(Vector2(car.spawn["x"], car.spawn["z"])) < 0.01, "C en voiture : rangée au hangar")
	Game.player.pos = Vector3(0.0, 0.0, 40.0)
	Game.player.yaw = 0.0
	var placed := 0
	for i in r.vehicles.size():
		lab.spawn_or_stow(Game)
		for v in r.vehicles:
			if Vector2(v.x, v.z).distance_to(Vector2(0.0, 40.0)) < 6.0:
				placed += 1
				v.x = v.spawn["x"]
				v.z = v.spawn["z"]
	t.check(placed == r.vehicles.size(), "C à pied : chaque machine sort devant le joueur (%d / %d)" % [placed, r.vehicles.size()])
	lab.to_hangar(Game)
	t.check(Game.player.pos.distance_to(VehicleLab.START) < 0.01, "P à pied : retour au hangar")
	var night := Game.daynight.is_night()
	lab.toggle_daynight(Game)
	_steps(60 * 20, {})
	t.check(Game.daynight.is_night() != night, "N : bascule jour / nuit")
	car.hp = 0.0
	r.damage_vehicle(car, 1.0)
	_steps(60 * 15, {})
	t.check(car.state != "ok", "voiture détruite (%s)" % car.state)
	Game.player.pos = Vector3(car.x + 2.0, 0.0, car.z)
	if car.state == "gone":
		Game.player.pos = Vector3(car.spawn["x"] + 2.0, 0.0, car.spawn["z"])
	lab.service(Game)
	t.check(car.state == "ok" and car.hp == car.max_hp(), "R : une épave revient neuve")

func _log(t: Node) -> void:
	var path := "user://j44_vehicle_log.jsonl"
	var r := _new()
	var lab := Game.lab
	lab.log_path = path
	var car := _find(r, "VOITURE")
	_ride(r, car, VehicleLab.DRAG["x0"], VehicleLab.DRAG["z"], EAST, 0.0)
	_steps(30, {})
	_steps(60 * 5, {"mz": 1.0})
	_steps(60 * 4, {"mz": -1.0})
	lab._log = null
	var txt := FileAccess.get_file_as_string(path)
	var lines := txt.strip_edges().split("\n")
	var evs := {}
	for l in lines:
		var d: Variant = JSON.parse_string(l)
		if d is Dictionary:
			evs[String(d["ev"])] = true
	t.check(lines.size() > 20 and evs.has("sample") and evs.has("brake") and evs.has("accel"), "journal : %d lignes (%s)" % [lines.size(), evs.keys()])
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
