extends RefCounted
## v0.36.0 : voiture conduisible (sim/car_sim.gd, Rides, ZombieSim.car_aim, vues). Suite j43 :
##   - physique sur un terrain vide (doublure J5Stub) : accélération, vitesse maximale, freinage, roue libre, marche arrière, braquage qui diminue avec
##     la vitesse, rayon de braquage, dérapage léger en virage serré, glisse au frein à main, essence (consommation, réserve, panne sèche) ;
##   - collision : mur de face à 10, 20 et 26 m/s (jamais traversé, arrêt, dégâts selon la vitesse, occupants blessés sans en mourir), mur de biais
##     (la voiture glisse le long et s'aligne), pilier, mur fin à pleine vitesse, autre voiture (boîte dynamique), moto garée poussée, bord de la carte ;
##   - écrasement : au-dessus de vmin le zombie est tué ou blessé et projeté, en dessous la voiture pousse au pas ;
##   - carte de Strasbourg : emplacements (zone, place libre, hors tram, ligne droite), boîtes dynamiques, monter / conduire / descendre par la portière,
##     caméras (1re personne dans l'habitacle, 3e derrière, touche V), phares, klaxon (appât), invites, tableau de bord, zombies qui visent la
##     carrosserie et frappent la caisse (le joueur ne prend qu'une part), écrasement avec points, bidon d'essence (+8 L), PV à 0 : feu, explosion,
##     épave, retour, borne du parking, motos et vélos toujours là (26), golden des motos non touchés (la suite j5 les rejoue).

const DT := 1.0 / 60.0

func run(t: Node) -> void:
	_physics(t)
	_steering(t)
	_fuel(t)
	_walls(t)
	_obstacles(t)
	_roadkill_stub(t)
	_map_spots(t)
	_map_drive(t)
	_map_zombies(t)
	_map_damage(t)
	_map_misc(t)

# ------------------------------------------------------------------ doublure : terrain vide
func _stub(half := 3000.0) -> J5Stub:
	var g := J5Stub.new()
	g.collision = Collision.new(half)
	g.collision.build()
	g.rng.seed = 1
	return g

func _car(g: J5Stub, x := 0.0, z := 0.0, yaw := 0.0) -> CarSim:
	var c := CarSim.new(0, {"x": x, "z": z, "yaw": yaw})
	c.fuel = float(c.def["tank"])
	c.seats[0] = 0
	g.vehicles = [c]
	return c

func _run(g: J5Stub, c: CarSim, n: int, inp: Dictionary) -> void:
	for _i in n:
		g.time += DT
		c.update(DT, g, inp, true)
		if c.key != "":
			g.collision.set_dynamic(c.key, [c.dyn_box()], "car")

const FWD := {"fwd": true}
const NONE := {}

func _physics(t: Node) -> void:
	var g := _stub()
	var c := _car(g)
	t.check(c.def["name"] == "VOITURE" and int(c.def["seats"]) == 4 and c.seats.size() == 4, "définition de la voiture : 4 places")
	t.check(String(Config.at("vehicles.types.grosseMoto.name")) == "GROSSE MOTO" and Config.at("vehicles.types.moto.maxSpeed") == 21, "Config des motos intacte")
	# accélération : 0 -> 50 km/h, 0 -> 80 km/h, vitesse maximale
	var t50 := -1.0
	var t80 := -1.0
	for i in 60 * 30:
		_run(g, c, 1, FWD)
		if t50 < 0.0 and c.speed >= 50.0 / 3.6:
			t50 = (i + 1) * DT
		if t80 < 0.0 and c.speed >= 80.0 / 3.6:
			t80 = (i + 1) * DT
	print("j43 : 0-50 km/h %.2f s, 0-80 km/h %.2f s, vitesse au bout de 30 s %.1f km/h" % [t50, t80, c.speed * 3.6])
	t.check(t50 > 1.8 and t50 < 4.0, "0 -> 50 km/h en %.2f s (2 à 4 s)" % t50)
	t.check(t80 > 4.5 and t80 < 10.0, "0 -> 80 km/h en %.2f s (4,5 à 10 s)" % t80)
	t.check(c.speed <= float(c.def["maxSpeed"]) + 1e-9 and c.speed > float(c.def["maxSpeed"]) - 0.5, "vitesse maximale %.2f m/s (CarSim.DEF %s)" % [c.speed, c.def["maxSpeed"]])
	t.check(absf(c.slip) < 1e-6, "en ligne droite : aucun dérapage")
	t.near(c.yaw, 0.0, "en ligne droite : cap inchangé", 1e-9)
	t.check(c.z < -500.0 or c.z > -400.0, "(essai) la voiture a roulé")
	# freinage depuis 20 m/s
	c.reset()
	c.seats[0] = 0
	c.speed = 20.0
	var z0 := c.z
	var n := 0
	while c.speed > 0.0 and n < 600:
		_run(g, c, 1, {"back": true})
		n += 1
	var dist := absf(c.z - z0)
	print("j43 : freinage 72 km/h -> 0 : %.2f s, %.1f m" % [n * DT, dist])
	t.check(dist > 7.0 and dist < 14.0, "freinage depuis 72 km/h : %.1f m (7 à 14)" % dist)
	t.check(c.brake_lamp == false or c.speed <= 0.0, "feux stop pendant le freinage")
	# marche arrière : après l'arrêt, recule jusqu'à reverseSpeed
	_run(g, c, 60 * 6, {"back": true})
	t.check(c.speed < 0.0 and c.speed >= -float(c.def["reverseSpeed"]) - 1e-9 and c.speed < -float(c.def["reverseSpeed"]) + 0.3, "marche arrière : %.2f m/s (max %s)" % [c.speed, c.def["reverseSpeed"]])
	t.check(c.reversing, "feux de recul en marche arrière")
	# roue libre : la voiture ralentit seule
	c.speed = 15.0
	_run(g, c, 60 * 3, NONE)
	t.check(c.speed < 15.0 and c.speed > 8.0, "roue libre : 15 -> %.1f m/s en 3 s" % c.speed)
	_run(g, c, 60 * 30, NONE)
	t.check(c.speed == 0.0, "roue libre : arrêt complet")
	# frein à main : arrête aussi la voiture
	c.speed = 15.0
	n = 0
	while c.speed > 0.0 and n < 600:
		_run(g, c, 1, {"hb": true})
		n += 1
	t.check(c.speed == 0.0 and n * DT < 2.5, "frein à main : arrêt en %.2f s" % (n * DT))
	t.check(c.brake_lamp, "frein à main : feux stop")
	# non conduite : immobile
	c.speed = 0.0
	var px := c.x
	c.update(DT, g, {"fwd": true}, false)
	t.near(c.x, px, "voiture sans conducteur : immobile", 1e-12)

func _turn_radius(g: J5Stub, sp: float, steer: float, hb := false) -> Dictionary:
	var c := _car(g)
	c.speed = sp
	var inp := {"fwd": true, "steer": steer, "hb": hb}
	var max_slip := 0.0
	var yaw0 := c.yaw
	var pts: Array = []
	for i in 240:
		# vitesse tenue (régulateur) : on mesure la géométrie du virage
		if not hb:
			c.speed = sp
		_run(g, c, 1, inp)
		max_slip = maxf(max_slip, absf(c.slip))
		if i > 60:
			pts.append(Vector2(c.x, c.z))
	# rayon : vitesse de lacet moyenne
	var yr := absf(VehicleSim.ang_diff(c.yaw, yaw0)) / (240 * DT)
	return {"r": absf(sp) / maxf(yr, 1e-6), "slip": max_slip, "yaw_rate": yr, "steer_angle": absf(c.steer_angle), "car": c}

func _steering(t: Node) -> void:
	var g := _stub()
	var slow := _turn_radius(g, 4.0, 1.0)
	var fast := _turn_radius(g, 22.0, 1.0)
	print("j43 : braquage à 4 m/s %.3f rad (rayon %.1f m) ; à 22 m/s %.3f rad (rayon %.1f m, glisse max %.2f m/s)" % [slow["steer_angle"], slow["r"], fast["steer_angle"], fast["r"], fast["slip"]])
	t.check(slow["steer_angle"] > 2.0 * fast["steer_angle"], "le braquage diminue avec la vitesse (%.3f -> %.3f rad)" % [slow["steer_angle"], fast["steer_angle"]])
	t.check(slow["r"] > 4.0 and slow["r"] < 7.5, "rayon de braquage au pas : %.1f m (4 à 7,5)" % slow["r"])
	t.check(fast["r"] > 25.0, "à 80 km/h le virage est large : %.1f m" % fast["r"])
	t.check(fast["slip"] > 0.05 and fast["slip"] < 3.0, "virage serré à 80 km/h : dérapage léger (%.2f m/s)" % fast["slip"])
	var mid := _turn_radius(g, 8.0, 0.4)
	t.check(mid["slip"] < 0.3, "virage modéré à 30 km/h : pas de glisse (%.2f m/s)" % mid["slip"])
	var left := _turn_radius(g, 8.0, -1.0)
	var right := _turn_radius(g, 8.0, 1.0)
	t.check(left["car"].yaw > 0.0 and right["car"].yaw < 0.0, "Q tourne à gauche (cap %.2f), D à droite (cap %.2f)" % [left["car"].yaw, right["car"].yaw])
	var hb := _turn_radius(g, 15.0, 1.0, true)
	print("j43 : frein à main à 54 km/h : glisse max %.2f m/s, lacet %.2f rad/s" % [hb["slip"], hb["yaw_rate"]])
	t.check(hb["slip"] > 1.5, "frein à main en virage : la voiture glisse (%.2f m/s)" % hb["slip"])
	t.check(hb["car"].speed < 15.0, "frein à main : la voiture ralentit en glissant")
	# la glisse se résorbe en ligne droite
	var c: CarSim = hb["car"]
	c.speed = 10.0
	c.slip = 3.0
	_run(g, c, 60, {"fwd": true})
	t.check(absf(c.slip) < 1e-6, "la glisse se résorbe en ligne droite")

func _fuel(t: Node) -> void:
	var g := _stub()
	var c := _car(g)
	var f0 := c.fuel
	_run(g, c, 600, FWD)
	var used := f0 - c.fuel
	print("j43 : essence : %.3f L en 10 s pied au plancher (réservoir %s L)" % [used, c.def["tank"]])
	t.check(used > 0.2 and used < 1.5, "consommation : %.3f L en 10 s" % used)
	var f1 := c.fuel
	_run(g, c, 600, NONE)
	t.check(c.fuel < f1 and f1 - c.fuel < used * 0.3, "au ralenti : %.4f L en 10 s" % (f1 - c.fuel))
	var start := CarSim.new(1, {"x": 0.0, "z": 0.0, "yaw": 0.0})
	t.near(start.fuel, float(start.def["tank"]) * float(start.def["startFuel"]), "réservoir au départ : 60 %")
	# réserve : bips ; puis panne sèche
	c.fuel = float(c.def["tank"]) * 0.1
	c.events.clear()
	_run(g, c, 60 * 5, FWD)
	t.check(c.events.has("beep"), "réserve : bips")
	c.fuel = 0.0
	c.speed = 0.0
	c.events.clear()
	_run(g, c, 60 * 5, FWD)
	t.check(c.events.has("dry") and c.speed <= float(Config.at("vehicles.fuel.pushSpeed")) + 1e-9 and c.speed > 1.0, "panne sèche : au pas (%.2f m/s)" % c.speed)

# ------------------------------------------------------------------ collisions
## Mur (segment) en z = -WALL ; la voiture part de 0 vers -z à la vitesse v, sans gaz (le choc se fait à ~v).
const WALL := 5.0
func _wall_case(v: float, angle := 0.0, gas := false) -> Dictionary:
	var g := J5Stub.new()
	g.collision = Collision.new(400.0)
	g.collision.add_segment(-200.0, -WALL, 200.0, -WALL)
	g.collision.build()
	var c := CarSim.new(0, {"x": 0.0, "z": 0.0, "yaw": angle})
	c.seats[0] = 0
	g.vehicles = [c]
	c.speed = v
	var crossed := false
	var min_gap := INF
	var hp0 := c.hp
	var hurt := 0.0
	var impact := 0.0
	for i in 60 * 4:
		g.time += DT
		c.update(DT, g, {"fwd": gas}, true)
		impact = maxf(impact, c.last_impact)
		for cx in [-1.0, 1.0]:
			for cz in [-1.0, 1.0]:
				var w := c.to_world([cx * c.half_w(), 0.0, cz * c.half_l()])
				min_gap = minf(min_gap, w.z + WALL)
				if w.z < -WALL - 0.02:
					crossed = true
	for e: Array in g.log:
		if e[0] == "hurt":
			hurt += float(e[1])
	return {"crossed": crossed, "gap": min_gap, "lost": hp0 - c.hp, "hurt": hurt, "car": c, "impact": impact}

func _walls(t: Node) -> void:
	var prev := -1.0
	for v in [10.0, 20.0, 26.0]:
		var r := _wall_case(v)
		var c: CarSim = r["car"]
		print("j43 : mur de face à %.0f m/s (choc à %.1f m/s) : écart minimal %.3f m, PV perdus %.0f, blessure %.0f" % [v, r["impact"], r["gap"], r["lost"], r["hurt"]])
		t.check(not r["crossed"] and float(r["gap"]) > -0.02, "mur de face à %.0f m/s : jamais traversé (écart %.3f m)" % [v, r["gap"]])
		t.check(absf(c.speed) < 2.0, "mur de face à %.0f m/s : arrêté (%.2f m/s)" % [v, c.speed])
		t.check(float(r["lost"]) > prev, "mur à %.0f m/s : plus de dégâts plus vite (%.0f PV)" % [v, r["lost"]])
		prev = r["lost"]
		var W: Dictionary = c.def["wall"]
		t.near(float(r["lost"]), (float(r["impact"]) - float(W["free"])) * float(W["perMs"]), "mur à %.0f m/s : la caisse perd (choc - %s) x %s PV" % [v, W["free"], W["perMs"]], 0.05)
		t.check(c.state == "ok", "un choc seul ne détruit pas la voiture (%.0f / %s PV)" % [c.hp, c.def["hp"]])
		if v >= 20.0:
			t.check(float(r["hurt"]) > 0.0 and float(r["hurt"]) <= float(c.def["crash"]["maxDamage"]) + 1e-6, "mur à %.0f m/s : occupant blessé (%.0f PV, plafonné)" % [v, r["hurt"]])
	var soft := _wall_case(2.8)
	t.check(float(soft["lost"]) == 0.0 and float(soft["hurt"]) == 0.0, "contact au pas : ni dégâts ni blessure")
	# de biais : la voiture glisse le long du mur et s'aligne
	var sl := _wall_case(18.0, 0.6)
	var c2: CarSim = sl["car"]
	print("j43 : mur de biais (34°) à 18 m/s : cap final %.2f rad (départ 0,60), vitesse %.1f m/s, PV perdus %.0f" % [VehicleSim.ang_diff(c2.yaw, 0.0), c2.ground_speed(), sl["lost"]])
	t.check(not sl["crossed"], "mur de biais : jamais traversé")
	t.check(c2.yaw > 0.85, "mur de biais : la voiture pivote vers l'axe du mur (cap %.2f)" % c2.yaw)
	t.check(float(sl["lost"]) < float(_wall_case(18.0)["lost"]), "mur de biais : moins de dégâts que de face")
	# mur fin à pleine vitesse, pied au plancher, en diagonale : jamais traversé
	for a in [0.0, 0.3, -0.45, 1.2]:
		var r2 := _wall_case(26.0, a, true)
		t.check(not r2["crossed"], "mur fin à 94 km/h, cap %.2f : pas de traversée" % a)

func _obstacles(t: Node) -> void:
	# pilier (cercle) pile devant
	var g := J5Stub.new()
	g.collision = Collision.new(400.0)
	g.collision.add_circle(0.0, -20.0, 0.5)
	g.collision.build()
	var c := CarSim.new(0, {"x": 0.0, "z": 0.0, "yaw": 0.0})
	c.seats[0] = 0
	g.vehicles = [c]
	c.speed = 15.0
	var inside := false
	for i in 240:
		g.time += DT
		c.update(DT, g, {"fwd": true}, true)
		if c.contains(0.0, -20.0, 0.45):
			inside = true
	t.check(not inside, "pilier : la caisse ne le traverse pas")
	t.check(c.hp < c.max_hp(), "pilier à 54 km/h : dégâts (%.0f PV)" % (c.max_hp() - c.hp))
	# autre voiture (boîte dynamique) : obstacle
	var g2 := J5Stub.new()
	g2.collision = Collision.new(400.0)
	g2.collision.build()
	var a := CarSim.new(0, {"x": 0.0, "z": 0.0, "yaw": 0.0})
	var b := CarSim.new(1, {"x": 0.0, "z": -15.0, "yaw": PI / 2.0})
	a.seats[0] = 0
	g2.vehicles = [a, b]
	g2.collision.set_dynamic(b.key, [b.dyn_box()], "car")
	a.speed = 14.0
	var overlap := false
	for i in 240:
		g2.time += DT
		a.update(DT, g2, {"fwd": true}, true)
		b.update(DT, g2, {}, false)
		g2.collision.set_dynamic(a.key, [a.dyn_box()], "car")
		for cx in [-1.0, 1.0]:
			for cz in [-1.0, 1.0]:
				var w := a.to_world([cx * a.half_w() * 0.95, 0.0, cz * a.half_l() * 0.95])
				if b.contains(w.x, w.z, -0.02):
					overlap = true
	t.check(not overlap, "voiture contre voiture garée : pas d'interpénétration")
	t.check(absf(a.speed) < 2.0 and a.hp < a.max_hp(), "voiture contre voiture : arrêt et dégâts")
	t.near(b.x, 0.0, "la voiture garée ne bouge pas", 1e-9)
	# le joueur et les zombies sont repoussés par la boîte de la voiture
	var q := g2.collision.resolve(Vector3(b.x, 0.0, b.z), 0.4)
	t.check(not b.contains(q.x, q.z, 0.35), "boîte dynamique : un piéton est repoussé hors de la caisse")
	# moto garée devant : poussée, pas d'arrêt net
	var g3 := J5Stub.new()
	g3.collision = Collision.new(400.0)
	g3.collision.build()
	var car := CarSim.new(0, {"x": 0.0, "z": 0.0, "yaw": 0.0})
	var moto := VehicleSim.new(1, "moto", {"x": 0.0, "z": -12.0, "yaw": 0.0})
	car.seats[0] = 0
	g3.vehicles = [car, moto]
	car.speed = 10.0
	for i in 120:
		g3.time += DT
		car.update(DT, g3, {"fwd": true}, true)
	t.check(Vector2(moto.x, moto.z + 12.0).length() > 0.5, "la moto garée est poussée (%.1f m)" % Vector2(moto.x, moto.z + 12.0).length())
	t.check(moto.hp < moto.max_hp(), "la moto heurtée à 36 km/h est abîmée")
	# bord de la carte
	var g4 := _stub(20.0)
	var e := _car(g4)
	e.speed = 20.0
	_run(g4, e, 240, FWD)
	t.check(e.z - e.half_l() >= -20.0 - 0.02, "bord de la carte : la voiture reste dedans (%.2f)" % (e.z - e.half_l()))
	# marche : on ne passe pas (doublure de monde : région > 0 au-delà de z = -10)
	var g5 := _stub()
	g5.world = StepWorld.new()
	var s := _car(g5)
	s.speed = 8.0
	_run(g5, s, 120, FWD)
	t.check(s.z - s.half_l() * 0.85 > -10.0 - 0.6, "marche : la voiture s'arrête devant (avant à %.2f)" % (s.z - s.half_l()))

class StepWorld extends RefCounted:
	func floor_at(_x: float, z: float, _y: float, out: Dictionary) -> Dictionary:
		out["y"] = 0.0 if z > -10.0 else 0.6
		out["region"] = 0 if z > -10.0 else 3
		return out

func _roadkill_stub(t: Node) -> void:
	var g := _stub()
	var c := _car(g)
	var z := ZombieSim.new()
	z.pos = Vector3(0.0, 0.0, -20.0)
	z.health = 150.0
	z.max_health = 150.0
	g.zombies = [z]
	c.speed = 15.0
	_run(g, c, 120, FWD)
	var hits := g.log.filter(func(e: Array) -> bool: return e[0] == "zhit")
	t.check(hits.size() >= 1 and float(hits[0][2]) > 100.0, "zombie écrasé à 54 km/h : %.0f dégâts" % (float(hits[0][2]) if not hits.is_empty() else 0.0))
	t.check(z.health <= 0.0, "zombie de 150 PV tué")
	# zombie solide : blessé et projeté sur le côté, la voiture passe
	var g2 := _stub()
	var c2 := _car(g2)
	var z2 := ZombieSim.new()
	z2.pos = Vector3(0.3, 0.0, -20.0)
	z2.health = 1.0e6
	z2.max_health = 1.0e6
	g2.zombies = [z2]
	c2.speed = 15.0
	_run(g2, c2, 120, FWD)
	t.check(not c2.contains(z2.pos.x, z2.pos.z, 0.3), "zombie survivant : projeté hors de la caisse")
	t.check(z2.pos.x > 0.5, "projeté du côté où il était (x %.2f)" % z2.pos.x)
	t.check(c2.z < -25.0, "la voiture continue (z %.1f)" % c2.z)
	# au pas : pas de dégâts, la voiture pousse
	var g3 := _stub()
	var c3 := _car(g3)
	var z3 := ZombieSim.new()
	z3.pos = Vector3(0.0, 0.0, -4.0)
	z3.health = 100.0
	z3.max_health = 100.0
	g3.zombies = [z3]
	c3.speed = 4.0
	_run(g3, c3, 60, FWD)
	t.check(z3.health == 100.0, "au pas : le zombie n'est pas blessé")
	t.check(c3.speed <= float(c3.def["roadkill"]["pushSpeed"]) + 1e-6, "au pas : la voiture pousse la foule (%.2f m/s)" % c3.speed)
	t.near(c3.roadkill_damage(5.0), 0.0, "sous vmin : aucun dégât")
	t.check(c3.roadkill_damage(20.0) > c3.roadkill_damage(10.0), "dégâts croissants avec la vitesse")

# ------------------------------------------------------------------ carte de Strasbourg
func _new_game(seed_value := 7) -> Rides:
	Game.mode = GameMode.CLASSIC
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9
	return Game.rides

func _steps(n: int, input: Dictionary) -> void:
	for _i in n:
		Game.step(DT, input)

func _cars(r: Rides) -> Array:
	return r.vehicles.filter(func(v: VehicleSim) -> bool: return v is CarSim)

func _map_spots(t: Node) -> void:
	var r := _new_game()
	var cars := _cars(r)
	t.check(cars.size() == CarSim.SPOTS.size() and cars.size() >= 2, "%d voitures sur la carte" % cars.size())
	t.check(r.vehicles.size() - cars.size() == 26, "motos et vélos toujours là : %d" % (r.vehicles.size() - cars.size()))
	var w: World = Game.world
	var tracks: Array = r.net.get("tracks", [])
	for c: CarSim in cars:
		var sp: Dictionary = CarSim.SPOTS[cars.find(c)]
		var zi := w.zone_of(c.x, c.z)
		t.check(zi >= 0 and String(sp["zone"]).begins_with(w.zone_names[zi]), "voiture %d : zone %s (%s)" % [c.id, w.zone_names[zi] if zi >= 0 else "?", sp["zone"]])
		var blocked := 0
		for a in range(-3, 4):
			for b in range(-8, 9):
				var p := c.to_world([a * 0.28, 0.0, b * 0.25])
				if w.nav.is_blocked_at(p.x, p.z):
					blocked += 1
		t.check(blocked == 0, "voiture %d : aucune case de navigation bloquée sous la caisse" % c.id)
		var items: Array = []
		w.collision.items_in(c.x - 4.0, c.z - 4.0, c.x + 4.0, c.z + 4.0, items)
		var hit := 0
		for it: Dictionary in items:
			if not w.collision.blocks(it, 0.1):
				continue
			var m: Vector3 = c.mtv_circle(it["x"], it["z"], it["r"]) if it.has("r") else c.mtv_segment(it["ax"], it["az"], it["bx"], it["bz"], c.x, c.z)
			if m.z > 0.0:
				hit += 1
		t.check(hit == 0, "voiture %d : aucun obstacle dans la caisse" % c.id)
		var dt_min := INF
		for tk: TramTrack in tracks:
			dt_min = minf(dt_min, float(tk.project(c.x, c.z, 40.0, {})["d"]))
		t.check(dt_min >= 6.0, "voiture %d : à %.1f m des voies du tram (>= 6)" % [c.id, dt_min])
		var ahead := 400.0
		for off in [-0.9, 0.0, 0.9]:
			ahead = minf(ahead, w.collision.ray_hit(c.x + cos(c.yaw) * off, 0.5, c.z - sin(c.yaw) * off, -sin(c.yaw), 0.0, -cos(c.yaw), 400.0))
		t.check(ahead >= 25.0, "voiture %d : %.0f m dégagés devant" % [c.id, ahead])
		Game.player.pos = Vector3(c.x + 30.0, 0.0, c.z)
		r.sync_car_boxes()
		t.check(w.collision.dyn.has(c.key), "voiture %d : boîte dynamique dans la collision (joueur à 30 m)" % c.id)
		Game.player.pos = Vector3(c.x + 200.0, 0.0, c.z)
		r.sync_car_boxes()
		t.check(not w.collision.dyn.has(c.key), "voiture %d : loin du joueur (200 m), hors de la collision" % c.id)
		t.check(not c.has_driver() and c.state == "ok" and c.fuel_frac() > 0.5, "voiture %d : libre, en état, 60 %% d'essence" % c.id)

func _first_car(r: Rides) -> CarSim:
	return _cars(r)[0]

func _map_drive(t: Node) -> void:
	var r := _new_game(21)
	var c := _first_car(r)
	var p: PlayerSim = Game.player
	# monter : invite, E, place du conducteur
	p.pos = c.to_world([-1.4, 0.0, 0.1])
	p.pos.y = 0.0
	t.check(r.prompt().contains("Monter dans la voiture"), "invite : monter dans la voiture (« %s »)" % r.prompt())
	Game.interact()
	t.check(r.ride != null and r.ride["v"] == c and int(r.ride["seat"]) == 0, "E : au volant")
	t.check(r.driving() and p.attached and r.car_of_player() == c, "conducteur aux commandes")
	t.check(r.prompt().contains("phares") and r.prompt().contains("klaxon"), "invite en voiture (« %s »)" % r.prompt())
	var gg := r.gauge()
	t.check(bool(gg.get("car", false)) and gg["name"] == "VOITURE" and gg.has("lights") and bool(gg["has_tank"]), "tableau de bord de la voiture")
	# caméras : 3e personne derrière la voiture, 1re dans l'habitacle
	r.cam.third_person = true
	_steps(60, {})
	var back := Vector2(-sin(c.yaw), -cos(c.yaw)) * -1.0
	var cp := Vector2(r.cam.cam_pos.x - c.x, r.cam.cam_pos.z - c.z)
	t.check(r.cam.placed and cp.length() > 4.0 and cp.normalized().dot(back) > 0.8, "3e personne : caméra derrière la voiture (%.1f m)" % cp.length())
	t.check(r.cam.cam_pos.y > 1.6, "3e personne : au-dessus du toit (%.2f m)" % r.cam.cam_pos.y)
	r.toggle_view()
	_steps(60, {})
	t.check(not r.cam.placed, "touche V : 1re personne")
	var eye := p.eye()
	t.check(c.contains(eye.x, eye.z, -0.3) and eye.y > 1.0 and eye.y < float(c.def["height"]), "1re personne : l'œil est dans l'habitacle (%.2f m)" % eye.y)
	t.check(Vector2(eye.x - c.x, eye.z - c.z).dot(Vector2(cos(c.yaw), -sin(c.yaw))) < 0.0, "1re personne : place du conducteur à gauche")
	r.toggle_view()
	# conduire : le joueur suit le siège, ne tire pas
	var x0 := Vector2(c.x, c.z)
	var ammo := Game.weapon.ammo
	_steps(120, {"mx": 0.0, "mz": 1.0, "fire": true})
	t.check(c.speed > 8.0, "la voiture accélère sur la carte (%.1f m/s)" % c.speed)
	t.check(Vector2(c.x, c.z).distance_to(x0) > 8.0, "la voiture avance (%.1f m)" % Vector2(c.x, c.z).distance_to(x0))
	t.check(Game.weapon.ammo == ammo, "au volant : pas de tir")
	var hip := c.hip_world(0)
	t.near(p.pos.x, hip.x, "le joueur suit son siège (x)", 1e-3)
	t.near(p.pos.z, hip.z, "le joueur suit son siège (z)", 1e-3)
	t.check(Game.collision.dyn.has(c.key) and Vector2(float(Game.collision.dyn[c.key]["boxes"][0]["x"]), float(Game.collision.dyn[c.key]["boxes"][0]["z"])).distance_to(Vector2(c.x, c.z)) < 1e-6, "la boîte dynamique suit la voiture")
	# phares et klaxon
	var l0 := c.lights
	t.check(r.toggle_car_lights() and c.lights != l0, "F en voiture : phares")
	r.tram_gong()
	t.check(not r.lure.is_empty() and r.lure.get("v") == c and c.horn_t > 0.0, "H en voiture : klaxon, appât sur la voiture")
	var lt := float(r.lure["t"])
	r.tram_gong()
	t.near(float(r.lure["t"]), lt, "klaxon : recharge (pas de second appât tout de suite)")
	_steps(30, {"mx": 0.0, "mz": 1.0})
	t.check(Vector2(float(r.lure["x"]), float(r.lure["z"])).distance_to(Vector2(c.x, c.z)) < 0.5, "l'appât du klaxon suit la voiture")
	# descendre : par la portière gauche, la voiture s'arrête
	_steps(60, {"mx": 0.0, "mz": -1.0})
	Game.interact()
	t.check(r.ride == null and not p.attached and c.seats[0] == null, "E : on descend")
	t.check(c.speed == 0.0 and c.slip == 0.0, "la voiture s'arrête quand le conducteur descend")
	var side := Vector2(p.pos.x - c.x, p.pos.z - c.z).dot(Vector2(cos(c.yaw), -sin(c.yaw)))
	t.check(side < -0.9 and not c.contains(p.pos.x, p.pos.z, 0.3), "on descend côté conducteur, hors de la caisse (%.2f m)" % side)
	_steps(60, {"mx": 0.0, "mz": 1.0})
	t.check(not c.contains(p.pos.x, p.pos.z, 0.3), "à pied : on ne traverse pas la voiture")
	# passager (places 1 à 3) : il peut tirer ; on sort par sa portière
	c.seats[0] = "pnj"
	p.pos = c.to_world([1.5, 0.0, 0.2])
	p.pos.y = 0.0
	Game.interact()
	t.check(r.ride != null and int(r.ride["seat"]) == 1 and not r.driving(), "deuxième place : passager avant")
	var ammo2 := Game.weapon.ammo
	_steps(5, {"fire": true})
	t.check(Game.weapon.ammo < ammo2, "le passager peut tirer")
	Game.interact()
	var side2 := Vector2(p.pos.x - c.x, p.pos.z - c.z).dot(Vector2(cos(c.yaw), -sin(c.yaw)))
	t.check(side2 > 0.9, "le passager descend à droite (%.2f m)" % side2)
	c.seats[0] = null

func _map_zombies(t: Node) -> void:
	var r := _new_game(23)
	var c := _first_car(r)
	var p: PlayerSim = Game.player
	p.pos = c.to_world([-1.4, 0.0, 0.1])
	p.pos.y = 0.0
	Game.interact()
	t.check(r.car_of_player() == c, "(zombies) au volant")
	# un zombie à 6 m devant à droite : il vient frapper la carrosserie, la caisse encaisse
	var zs := Game.debug_spawn(c.to_world([3.0, 0.0, -5.0]), 1.0)
	zs.spawn_t = 0.0
	zs.health = 1.0e6
	zs.max_health = 1.0e6
	var hp0 := p.health
	var chp0 := c.hp
	var strikes := 0
	for _i in 60 * 12:
		Game.step(DT, {})
		if zs.strike_damage > 0.0:
			strikes += 1
		p.health = maxf(p.health, 30.0)
	print("j43 : zombie contre la voiture : %d coups, voiture %.0f -> %.0f PV, joueur %.0f -> %.0f PV" % [strikes, chp0, c.hp, hp0, p.health])
	t.check(strikes >= 2, "le zombie frappe la voiture (%d coups)" % strikes)
	t.check(c.hp < chp0, "la voiture perd des PV sous les coups (%.0f)" % (chp0 - c.hp))
	t.check(not c.contains(zs.pos.x, zs.pos.z, 0.3), "le zombie reste hors de la caisse")
	t.check(Vector2(zs.pos.x, zs.pos.z).distance_to(c.closest_point(zs.pos.x, zs.pos.z)) < 1.3, "le zombie est au contact de la carrosserie")
	t.near(r.cabin_factor(), float(c.def["cabin"]), "la caisse encaisse : part des coups pour le joueur")
	Game.zombies.clear()
	# écrasement sur la carte : mort, points, la voiture perd quelques PV
	c.hp = c.max_hp()
	var zk := Game.debug_spawn(c.to_world([0.0, 0.0, -18.0]), 0.01)
	zk.spawn_t = 0.0
	zk.health = 90.0
	zk.max_health = 90.0
	var pts := Game.points
	var kills := Game.kills
	_steps(150, {"mx": 0.0, "mz": 1.0})
	t.check(zk.dead and Game.kills == kills + 1 and Game.points > pts, "zombie écrasé : mort et points (%d -> %d)" % [pts, Game.points])
	t.check(c.hp < c.max_hp() and c.hp >= c.max_hp() - 20.0, "écrasement : la voiture perd %.0f PV" % (c.max_hp() - c.hp))
	_steps(120, {"mx": 0.0, "mz": -1.0, "jump": true})
	Game.interact()
	Game.zombies.clear()

func _map_damage(t: Node) -> void:
	var r := _new_game(25)
	var c := _first_car(r)
	var p: PlayerSim = Game.player
	p.pos = c.to_world([-1.4, 0.0, 0.1])
	p.pos.y = 0.0
	Game.interact()
	Game.damage_vehicle(c, c.max_hp() + 10.0, "test")
	t.check(c.state == "burning", "0 PV : la voiture prend feu")
	t.check(r.prompt().contains("Descendre"), "en feu : on peut sortir")
	_steps(int(60 * float(Config.at("vehicles.damage.burnTime"))) + 10, {})
	t.check(c.state == "wreck" and r.ride == null and not p.attached, "explosion : épave, joueur éjecté")
	t.check(p.health >= 1.0, "l'explosion ne tue jamais (%.0f PV)" % p.health)
	t.check(Game.collision.dyn.has(c.key), "l'épave reste un obstacle")
	p.pos = c.to_world([-1.6, 0.0, 0.0])
	t.check(not r.prompt().contains("Monter dans la voiture"), "on ne monte pas dans une épave")
	_steps(int(60 * float(Config.at("vehicles.damage.wreckTime"))) + 10, {})
	t.check(c.state == "gone" and not Game.collision.dyn.has(c.key), "épave disparue : plus d'obstacle")
	Game.director.round_number = c.respawn_round
	p.pos = Vector3(c.spawn["x"] + 30.0, 0.0, c.spawn["z"])
	r.on_round_start()
	_steps(5, {})
	t.check(c.state == "ok" and c.hp == c.max_hp() and Game.collision.dyn.has(c.key), "manche de retour : la voiture revient")
	t.near(c.x, c.spawn["x"], "revient à son emplacement", 1e-9)
	t.near(c.fuel, float(c.def["tank"]) * float(Config.at("vehicles.fuel.respawn")), "revient avec 40 % d'essence", 1e-9)
	# explosion proche : la voiture perd des PV
	var hp0 := c.hp
	r.damage_in_radius(c.pos + Vector3(2, 0, 0), 5.0, 1000.0)
	t.check(c.hp < hp0, "explosion proche : la voiture perd %.0f PV" % (hp0 - c.hp))

func _map_misc(t: Node) -> void:
	var r := _new_game(27)
	var c := _first_car(r)
	var P: Powerups = Game.powerups
	# bidon : la voiture du joueur reçoit le plein d'un bidon de voiture (8 L)
	var p: PlayerSim = Game.player
	p.pos = c.to_world([-1.4, 0.0, 0.1])
	p.pos.y = 0.0
	Game.interact()
	c.fuel = 5.0
	P.items.clear()
	P.spawn(Game, p.pos, "fuel")
	_steps(1, {})
	t.near(c.fuel, 5.0 + float(c.def["jerrican"]) - float(c.def["idle"]) * DT, "bidon ramassé en voiture : +%s L" % c.def["jerrican"], 1e-3)
	t.check(P.items.is_empty(), "bidon ramassé")
	# bidons : seulement si une machine en a besoin ; voiture pleine : rien
	Game.interact()
	for v in r.vehicles:
		if v.has_tank():
			v.fuel = float(v.def["tank"])
	var drops := 0
	for _i in 5000:
		P.items.clear()
		P.maybe_drop_fuel(Game, Vector3(3, 0, 3))
		drops += P.items.size()
	t.check(drops == 0, "tout est plein : aucun bidon")
	c.fuel = float(c.def["tank"]) * 0.3
	drops = 0
	for _i in 5000:
		P.items.clear()
		P.maybe_drop_fuel(Game, Vector3(3, 0, 3))
		drops += P.items.size()
	t.check(drops > 50, "voiture à 30 %% : des bidons tombent (%d / 5000)" % drops)
	P.items.clear()
	# borne du parking : la voiture conduite jusqu'à une borne est servie
	var pk: Dictionary = r.parkings[0]
	c.x = float(pk["pump"]["x"]) + 3.0
	c.z = float(pk["pump"]["z"])
	c.hp = c.max_hp() - 100.0
	for v in r.vehicles:
		if v != c and Vector2(v.x - c.x, v.z - c.z).length() < 9.0:
			v.x += 50.0
	p.pos = Vector3(float(pk["pump"]["x"]) + 0.8, 0.0, float(pk["pump"]["z"]))
	var np := r.near_pump()
	t.check(not np.is_empty() and np["v"] == c, "borne du parking : la voiture est à portée")
	var sv := r.service_of(c)
	t.check(int(sv["cost"]) == int(ceil(100.0 * 2.0 + (float(c.def["tank"]) - c.fuel) * 50.0 - 1e-6)), "borne : prix du plein + réparation (%d pts)" % sv["cost"])
	# vue : la voiture a une vue propre (CarView) avec roues, volant, phares
	var view := CarView.new()
	view.setup(c)
	t.check(view.wheel_count() == 4 and view.has_steering_wheel() and view.headlight_count() == 2, "vue : 4 roues, volant, 2 phares")
	c.lights = true
	view.apply(1.0)
	t.check(view.headlights_on(), "vue : phares allumés")
	c.lights = false
	view.apply(1.0)
	t.check(not view.headlights_on(), "vue : phares éteints")
	t.check(view.triangles() > 8000, "vue : modèle détaillé (%d triangles)" % view.triangles())
	view.free()
	# règles du son : régime à rapports, klaxon synthétisé
	t.check(AudioRules.car_rpm(0.0, 26.0, 0.0) < AudioRules.car_rpm(10.0, 26.0, 1.0), "régime de la voiture")
	var horn := AudioRules.horn_samples(22050, 0.5)
	t.check(horn.size() == 11025 and absf(horn[100]) <= 1.0, "klaxon : %d échantillons" % horn.size())
