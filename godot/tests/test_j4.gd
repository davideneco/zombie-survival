extends RefCounted
## J4 : armes. Golden calculés par le JS (data/golden/j4.json : statsOf, dégâts selon la distance, tirs pour tuer, dégâts de zone, couteau,
## trajectoires de l'obus et de la grenade), puis scénarios de simulation (cadence, rechargement, plombs, perforation, M79, grenades, couteau,
## inventaire, achats au mur, bot qui tue la manche 1 avec chaque arme).

const DT := 1.0 / 60.0
const TOL := 1e-6
const LANE := Vector3(25, 0, 26)   ## départ d'un couloir de tir dégagé dans l'arène (vers -Z)

var _g: Dictionary

func run(t: Node) -> void:
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j4.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j4.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	_golden_stats(t)
	_golden_damage(t)
	_golden_area_melee(t)
	_golden_projectiles(t)
	_golden_kills(t)
	_scenarios(t)
	_bots(t)

# ------------------------------------------------------------------ golden : statistiques
func _golden_stats(t: Node) -> void:
	var fields := ["damage", "headMult", "pierce", "magSize", "maxReserve", "reloadTime", "spread", "fireRate", "pellets", "range", "falloffStart", "falloffEnd", "minMult", "splash", "blast", "boom", "ether", "gl", "zoom", "adsFov", "type", "cat"]
	for e: Dictionary in _g["stats"]:
		var w := WeaponState.new(e["id"])
		w.pap = int(e["lv"])
		w.refresh(e["perks"])
		var tag := "stats %s PaP%d %s" % [e["id"], e["lv"], e["perks"].keys()]
		for f: String in fields:
			if e["s"].has(f):
				t.check(w.cfg.has(f), "%s : %s présent" % [tag, f])
				if w.cfg.has(f):
					t.same(w.cfg[f], e["s"][f], "%s.%s" % [tag, f], TOL)
			elif f != "pierce" and f != "pellets":
				t.check(not w.cfg.has(f), "%s : %s absent" % [tag, f])
			else:
				t.check(not w.cfg.has(f), "%s : %s absent" % [tag, f])
	print("golden j4 : %d statistiques effectives" % _g["stats"].size())

func _golden_damage(t: Node) -> void:
	for e: Dictionary in _g["damage"]:
		var w := WeaponState.new(e["id"])
		w.pap = int(e["lv"])
		w.refresh({})
		var f := Pap.falloff_mult(w.cfg, float(e["d"]))
		var body := float(w.cfg["damage"]) * f
		t.near(body, e["body"], "dégâts %s PaP%d à %s m (corps)" % [e["id"], e["lv"], e["d"]], TOL)
		t.near(body * float(w.cfg["headMult"]), e["head"], "dégâts %s PaP%d à %s m (tête)" % [e["id"], e["lv"], e["d"]], TOL)
	print("golden j4 : %d dégâts" % _g["damage"].size())

# ------------------------------------------------------------------ golden : zone et couteau
func _golden_area_melee(t: Node) -> void:
	_new_lane(100)
	for e: Dictionary in _g["area"]:
		var z := _zombie(Vector3(LANE.x, 0, LANE.z - 10.0 - float(e["d"])), 1.0e9)
		Game.zombies.clear()
		Game.zombies.append(z)
		Game.arms.blast.area_damage(Game, Vector3(LANE.x, 1.0, LANE.z - 10.0), float(e["radius"]), float(e["damage"]))
		t.near(1.0e9 - z.health, e["v"], "dégâts de zone %s/%s à %s m" % [e["damage"], e["radius"], e["d"]], 1e-5)
	for e: Dictionary in _g["melee"]:
		t.near(WeaponMelee.damage(int(e["round"]), bool(e["weak"]), false, bool(e["axe"])), e["v"], "couteau manche %d tête %s hache %s" % [e["round"], e["weak"], e["axe"]], TOL)
	print("golden j4 : %d dégâts de zone, %d de couteau" % [_g["area"].size(), _g["melee"].size()])

# ------------------------------------------------------------------ golden : obus et grenade dans le vide
func _golden_projectiles(t: Node) -> void:
	_new_lane(101)
	var open := Collision.new(400.0, 400.0, 4.0)
	open.build()
	Game.collision = open   # pas d'obstacle : le JS testé n'en a pas non plus
	Game.zombies.clear()
	var booms: Array = []
	var cb := func(pos: Vector3, _r: float, _c: int) -> void: booms.append(pos)
	Game.explosion.connect(cb)
	for e: Dictionary in _g["shell"]:
		booms.clear()
		Game.arms.blast.shells.clear()
		Game.arms.blast.launch_shell(_v(e["o"]), _v(e["v"]))
		var steps := 0
		while booms.is_empty() and steps < 600:
			Game.arms.blast.update_shells(Game, DT)
			steps += 1
		t.check(booms.size() == 1, "obus : une explosion à la fin de la mèche")
		if booms.size() == 1:
			var end: Dictionary = e["end"]
			t.near(booms[0].x, end["x"], "obus x", 1e-4)
			t.near(booms[0].y, end["y"], "obus y", 1e-4)
			t.near(booms[0].z, end["z"], "obus z", 1e-4)
	for e: Dictionary in _g["nade"]:
		booms.clear()
		Game.arms.blast.nades.clear()
		Game.arms.blast.throw_grenade(_v(e["o"]), _v(e["v"]))
		var steps := 0
		while booms.is_empty() and steps < 600:
			Game.arms.blast.update_nades(Game, DT)
			steps += 1
		t.check(booms.size() == 1, "grenade : une explosion")
		if booms.size() == 1:
			var end: Dictionary = e["end"]
			t.near(booms[0].x, end["x"], "grenade x", 1e-3)
			t.near(booms[0].y, end["y"], "grenade y", 1e-3)
			t.near(booms[0].z, end["z"], "grenade z", 1e-3)
	Game.explosion.disconnect(cb)
	print("golden j4 : %d obus, %d grenades" % [_g["shell"].size(), _g["nade"].size()])

func _v(d: Dictionary) -> Vector3:
	return Vector3(d["x"], d["y"], d["z"])

# ------------------------------------------------------------------ golden : tirs pour tuer (par la vraie chaîne de tir)
func _golden_kills(t: Node) -> void:
	var dist := float(_g["killDist"])
	var n_ok := 0
	for e: Dictionary in _g["kills"]:
		_new_lane(102)
		_equip(e["id"], int(e["lv"]))
		var w := Game.arms.current
		w.cfg["spread"] = 0.0
		w.cfg["magSize"] = 1000
		w.ammo = 1000
		var z := _zombie(Vector3(LANE.x, 0, LANE.z - dist), float(Game.zombie_health_at(int(_g["killRound"]))))
		Game.zombies.append(z)
		_aim_at(Game.player, z.pos + (Vector3(0, 1.83, 0.07) if e["head"] else Vector3(0, 0.82, 0)))
		var steps := 0
		while not z.dead and steps < 60 * 120:
			Game.time += DT
			Game.arms.step(Game, DT, {"fire": steps % 2 == 0})
			steps += 1
		var used := 1000 - w.ammo
		t.check(z.dead, "%s PaP%d %s : le zombie meurt" % [e["id"], e["lv"], "tête" if e["head"] else "corps"])
		t.check(used == int(e["n"]), "%s PaP%d %s : %d tirs, JS %d" % [e["id"], e["lv"], "tête" if e["head"] else "corps", used, e["n"]])
		if used == int(e["n"]):
			n_ok += 1
	print("golden j4 : %d/%d scénarios « tirs pour tuer » égaux au JS" % [n_ok, _g["kills"].size()])

# ------------------------------------------------------------------ outils
func _aim_at(p: PlayerSim, target: Vector3) -> void:
	var d := target - p.eye()
	p.yaw = atan2(-d.x, -d.z)
	p.pitch = atan2(d.y, sqrt(d.x * d.x + d.z * d.z))

func _zombie(pos: Vector3, hp: float) -> ZombieSim:
	var z := ZombieSim.new()
	z.pos = pos
	z.health = hp
	z.max_health = hp
	z.speed = 0.0
	z.rng = Game.rng
	return z

## Partie dans l'arène, joueur au départ du couloir de tir, aucun zombie, M1911 seul.
func _new_lane(seed_value: int, weapons: Array = ["m1911"]) -> void:
	Game.new_game(seed_value, "arena", weapons)
	Game.player.pos = LANE
	Game.zombies.clear()

func _equip(id: String, lv: int) -> void:
	Game.arms = WeaponArms.new([id])
	Game.arms.current.pap = lv
	Game.arms.current.refresh({})
	Game.arms.current.ammo = int(Game.arms.current.cfg["magSize"])
	Game.arms.current.reserve = int(Game.arms.current.cfg["maxReserve"])

## Fait avancer l'armement (sans zombies ni manches) de n pas ; renvoie le nombre de tirs émis.
func _fire_steps(n: int, input: Dictionary) -> int:
	var shots := [0]
	var cb := func(_o, _e): shots[0] += 1
	Game.shot_fired.connect(cb)
	for _i in n:
		Game.time += DT
		Game.arms.step(Game, DT, input)
	Game.shot_fired.disconnect(cb)
	return shots[0]

# ------------------------------------------------------------------ scénarios
func _scenarios(t: Node) -> void:
	# --- auto : cadence réelle = fireRate
	_new_lane(110)
	_equip("rifle", 0)
	Game.arms.current.cfg["spread"] = 0.0
	var w := Game.arms.current
	var stamp := Game.time
	var fired := _fire_steps(60, {"fire": true})
	var expected := floori(60.0 * DT * float(w.cfg["fireRate"])) + 1
	t.check(absi(fired - expected) <= 1, "M4A1 : %d tirs en 1 s (≈ %d à 12,5/s)" % [fired, expected])
	t.check(w.ammo == int(w.cfg["magSize"]) - fired, "M4A1 : une balle par tir")
	# --- semi : un tir par clic, même bouton maintenu
	_new_lane(111)
	_equip("deagle", 0)
	t.check(_fire_steps(120, {"fire": true}) == 1, "Desert Eagle : bouton maintenu = un seul tir")
	t.check(_fire_steps(2, {"fire": false}) == 0 and _fire_steps(1, {"fire": true}) == 1, "Desert Eagle : nouveau clic = nouveau tir (une fois la cadence écoulée)")
	# --- fusil à pompe : 8 plombs par détente, une cartouche
	_new_lane(112)
	_equip("shotgun", 0)
	var pellets := _fire_steps(1, {"fire": true})
	t.check(pellets == 8, "pompe : 8 plombs (%d)" % pellets)
	t.check(Game.arms.current.ammo == int(Game.arms.current.cfg["magSize"]) - 1, "pompe : une cartouche")
	# --- chargeur vide : rechargement automatique, durée reloadTime, réserve décomptée
	_new_lane(113)
	_equip("m1911", 0)
	w = Game.arms.current
	w.ammo = 1
	_fire_steps(1, {"fire": true})
	t.check(w.ammo == 0 and not w.reloading, "M1911 : dernier coup tiré")
	_fire_steps(20, {"fire": false})
	_fire_steps(1, {"fire": true})
	t.check(w.reloading, "M1911 : chargeur vide, clic = rechargement")
	var reserve0 := w.reserve
	var rsteps := 0
	while w.reloading and rsteps < 600:
		_fire_steps(1, {})
		rsteps += 1
	t.near(rsteps * DT, float(w.cfg["reloadTime"]), "M1911 : durée du rechargement", 0.05)
	t.check(w.ammo == int(w.cfg["magSize"]) and w.reserve == reserve0 - int(w.cfg["magSize"]), "M1911 : chargeur plein, réserve décomptée")
	# --- recharge manuelle interrompue par un changement d'arme
	_new_lane(114, ["rifle", "m1911"])
	Game.arms.current.ammo = 5
	_fire_steps(1, {"reload": true})
	t.check(Game.arms.current.reloading, "R lance le rechargement")
	_fire_steps(1, {"weapon": 1})
	t.check(Game.arms.idx == 1 and not Game.arms.inventory[0].reloading, "changer d'arme annule le rechargement")
	# --- arbalète : recharge seule après le tir
	_new_lane(115)
	_equip("crossbow", 0)
	_fire_steps(1, {"fire": true})
	t.check(Game.arms.current.ammo == 0 and Game.arms.current.reloading, "arbalète : recharge seule après le tir")
	# --- perforation : le fusil de précision traverse, le pistolet non
	_new_lane(116)
	_equip("sniper", 0)
	Game.arms.current.cfg["spread"] = 0.0
	Game.arms.current.cfg["falloffStart"] = 2.0   # chute rapprochée pour comparer les trois zombies à 10, 13 et 16 m
	Game.arms.current.cfg["falloffEnd"] = 30.0
	Game.arms.current.cfg["minMult"] = 0.5
	var line: Array[ZombieSim] = []
	for i in 3:
		var z := _zombie(Vector3(LANE.x, 0, LANE.z - 10.0 - i * 3.0), 100000.0)
		line.append(z)
		Game.zombies.append(z)
	_aim_at(Game.player, line[0].pos + Vector3(0, 0.82, 0))
	_fire_steps(1, {"fire": true})
	t.check(line[0].health < 100000.0 and line[1].health < 100000.0 and line[2].health < 100000.0, "L96A1 : la balle traverse les trois zombies")
	t.check(line[0].health < line[2].health, "chaque zombie touché garde sa propre chute de dégâts")
	_new_lane(117)
	_equip("m1911", 0)
	Game.arms.current.cfg["spread"] = 0.0
	line.clear()
	for i in 2:
		var z2 := _zombie(Vector3(LANE.x, 0, LANE.z - 6.0 - i * 3.0), 100000.0)
		line.append(z2)
		Game.zombies.append(z2)
	_aim_at(Game.player, line[0].pos + Vector3(0, 0.82, 0))
	_fire_steps(1, {"fire": true})
	t.check(line[0].health < 100000.0 and line[1].health == 100000.0, "M1911 : la balle s'arrête au premier zombie")
	# --- mur : une caisse arrête le tir (la caisse centrale de l'arène)
	Game.new_game(118, "arena", ["rifle"])
	Game.player.pos = Vector3(0, 0, 6)
	Game.player.yaw = 0.0
	var zb := _zombie(Vector3(0, 0, -4), 100000.0)
	Game.zombies.append(zb)
	_aim_at(Game.player, zb.pos + Vector3(0, 0.8, 0))
	_fire_steps(1, {"fire": true})
	t.check(zb.health == 100000.0, "la caisse arrête la balle")
	# --- points : 10 par touche, 60 / 100 à la mort
	_new_lane(119)
	_equip("m1911", 0)
	Game.arms.current.cfg["spread"] = 0.0
	var zp := _zombie(Vector3(LANE.x, 0, LANE.z - 6.0), 60.0)
	Game.zombies.append(zp)
	var pts0 := Game.points
	_aim_at(Game.player, zp.pos + Vector3(0, 0.82, 0))
	_fire_steps(1, {"fire": true})
	t.check(Game.points - pts0 == Rules.POINTS_HIT, "touche sans tuer : 10 points")
	_fire_steps(30, {"fire": false})
	_fire_steps(1, {"fire": true})
	t.check(zp.dead and Game.points - pts0 == Rules.POINTS_HIT + Rules.POINTS_KILL, "mort au corps : +60 points")
	# --- visée : FOV de la lunette, dispersion
	_new_lane(120)
	_equip("sniper", 0)
	for _i in 60:
		_fire_steps(1, {"aim": true})
	t.near(Game.arms.fov(80.0), float(Game.arms.current.cfg["adsFov"]), "L96A1 : FOV de visée = adsFov", 0.05)
	_equip("rifle", 0)
	for _i in 60:
		_fire_steps(1, {"aim": true})
	t.near(Game.arms.fov(80.0), 60.0, "fusil sans lunette : FOV - 20", 0.05)
	var spread_hits := [0, 0]
	for mode in 2:   # même arme, debout puis en visée : plus de tirs au but en visée
		_new_lane(121)
		_equip("smg", 0)
		Game.arms.current.cfg["magSize"] = 100000
		Game.arms.current.cfg["spread"] = 0.1
		Game.arms.current.ammo = 100000
		var zt := _zombie(Vector3(LANE.x, 0, LANE.z - 20.0), 1.0e9)
		Game.zombies.append(zt)
		_aim_at(Game.player, zt.pos + Vector3(0, 0.82, 0))
		for _i in 300:
			_fire_steps(1, {"fire": true, "aim": mode == 1})
		spread_hits[mode] = int(1.0e9 - zt.health)
	t.check(spread_hits[1] > spread_hits[0] * 1.2, "la visée resserre la dispersion (%d contre %d de dégâts)" % [spread_hits[1], spread_hits[0]])
	_golden_blast_scenarios(t)
	_inventory(t)
	_melee(t)
	_shop(t)

# ------------------------------------------------------------------ explosifs
func _golden_blast_scenarios(t: Node) -> void:
	var booms: Array = []
	var cb := func(pos: Vector3, r: float, _c: int) -> void: booms.append([pos, r])
	Game.explosion.connect(cb)
	# M79 : projectile armé après 4 m -> explosion sur le zombie visé
	_new_lane(130)
	_equip("m79", 0)
	var M := Config.weapon("m79")
	Game.arms.current.cfg["spread"] = 0.0
	var z := _zombie(Vector3(LANE.x, 0, LANE.z - 15.0), 1.0e9)
	var z2 := _zombie(Vector3(LANE.x + 2.0, 0, LANE.z - 15.0), 1.0e9)
	Game.zombies.append_array([z, z2])
	_aim_at(Game.player, z.pos + Vector3(0, 1.0, 0))
	_fire_steps(1, {"fire": true})
	t.check(Game.arms.blast.shells.size() == 1, "M79 : un obus en vol")
	var guard := 0
	while booms.is_empty() and guard < 300:
		_fire_steps(1, {})
		guard += 1
	t.check(booms.size() == 1 and absf(float(booms[0][1]) - float(M["blast"]["radius"])) < 1e-9, "M79 : explosion au rayon de la config")
	t.check(z.health < 1.0e9 - 600.0, "M79 : le zombie visé subit l'explosion (%.0f)" % (1.0e9 - z.health))
	t.check(z2.health < 1.0e9 and z2.health > z.health, "M79 : un zombie à 2 m subit moins")
	t.check(Game.player.health == 100.0, "M79 : le tireur à 15 m ne souffre pas")
	t.check(Game.arms.current.ammo == 0 and Game.arms.current.reloading, "M79 : recharge seul")
	# avant l'armement (< 4 m) : 150 dégâts directs, pas d'explosion
	booms.clear()
	_new_lane(131)
	_equip("m79", 0)
	Game.arms.current.cfg["spread"] = 0.0
	var zn := _zombie(Vector3(LANE.x, 0, LANE.z - 2.5), 1.0e9)
	Game.zombies.append(zn)
	_aim_at(Game.player, zn.pos + Vector3(0, 1.0, 0))
	_fire_steps(1, {"fire": true})
	guard = 0
	while not Game.arms.blast.shells.is_empty() and guard < 120:
		_fire_steps(1, {})
		guard += 1
	t.check(booms.is_empty(), "M79 : pas d'explosion avant l'armement")
	t.near(1.0e9 - zn.health, float(M["damage"]), "M79 : 150 dégâts directs avant l'armement", 1e-6)
	# explosion au contact d'un mur : le tireur est blessé
	# dégâts au tireur : self x (1 - d / rayon), d horizontal ; l'obus du M79 ne blesse que le tireur
	Game.new_game(132, "arena", ["m79"])
	Game.player.pos = Vector3(0, 0, 20)
	var hp0 := Game.player.health
	var bs: Dictionary = WeaponBlast.shell_stats(0)["blast"]
	Game.arms.blast.explode(Game, Vector3(0, 1.0, 22), float(bs["radius"]), float(bs["damage"]), int(bs["color"]), float(bs["self"]))
	t.near(hp0 - Game.player.health, float(bs["self"]) * (1.0 - 2.0 / float(bs["radius"])), "explosion à 2 m : dégâts au tireur", 1e-6)
	# PHD Flopper : immunité
	Game.arms.add_perk("phdflopper")
	var hp1 := Game.player.health
	Game.hurt_player(50.0, "blast")
	t.check(Game.player.health == hp1, "PHD Flopper : immunité aux explosions")
	Game.hurt_player(10.0, "")
	t.check(Game.player.health == hp1 - 10.0, "PHD Flopper : pas d'immunité aux autres dégâts")
	# grenade à main
	booms.clear()
	_new_lane(133)
	var za := _zombie(Vector3(LANE.x, 0, LANE.z - 8.0), 1.0e9)
	Game.zombies.append(za)
	var g0 := Game.arms.grenades
	t.check(g0 == int(Config.at("grenade.start")), "grenades au départ")
	Game.player.pitch = 0.1
	_fire_steps(1, {"grenade": true})
	t.check(Game.arms.grenades == g0 - 1 and Game.arms.blast.nades.size() == 1, "une grenade lancée")
	guard = 0
	while booms.is_empty() and guard < 600:
		_fire_steps(1, {})
		guard += 1
	t.near(guard * DT, float(Config.at("grenade.fuse")), "grenade : mèche", 0.05)
	t.check(booms.size() == 1 and float(booms[0][1]) == float(Config.at("grenade.radius")), "grenade : rayon de la config")
	t.check(Game.arms.grenades == g0 - 1, "pas de grenade en plus")
	_fire_steps(1, {"grenade": true})
	_fire_steps(1, {"grenade": true})
	t.check(Game.arms.grenades == 0, "pas de lancer sans grenade")
	Game.arms.on_round_start()
	t.check(Game.arms.grenades == int(Config.at("grenade.perRound")), "nouvelle manche : +%d grenades" % int(Config.at("grenade.perRound")))
	for _i in 4:
		Game.arms.on_round_start()
	t.check(Game.arms.grenades == int(Config.at("grenade.max")), "grenades plafonnées à %d" % int(Config.at("grenade.max")))
	# pistolet à rayons : éclaboussure sur le voisin du zombie touché
	booms.clear()
	_new_lane(134)
	_equip("raygun", 0)
	Game.arms.current.cfg["spread"] = 0.0
	var zr := _zombie(Vector3(LANE.x, 0, LANE.z - 8.0), 1.0e9)
	var zs := _zombie(Vector3(LANE.x + 1.5, 0, LANE.z - 8.0), 1.0e9)
	Game.zombies.append_array([zr, zs])
	_aim_at(Game.player, zr.pos + Vector3(0, 0.82, 0))
	_fire_steps(1, {"fire": true})
	t.check(zs.health < 1.0e9 and booms.size() == 1, "pistolet à rayons : l'éclaboussure touche le voisin")
	Game.explosion.disconnect(cb)

# ------------------------------------------------------------------ inventaire
func _inventory(t: Node) -> void:
	Game.new_game(140, "arena", Config.at("startWeapons"))
	var a := Game.arms
	t.check(a.inventory.size() == 2 and a.current.id == "rifle", "départ : fusil et M1911, fusil en main")
	a.give_weapon("ak47")
	t.check(a.inventory.size() == 2 and a.current.id == "ak47" and not a.has_weapon("rifle"), "2 armes max : la nouvelle remplace celle en main")
	a.add_perk("mulekick")
	a.give_weapon("smg")
	t.check(a.inventory.size() == 3 and a.current.id == "smg", "Mule Kick : 3 armes")
	a.current.ammo = 3
	a.give_weapon("smg")
	t.check(a.current.reserve == int(a.current.cfg["maxReserve"]) and a.inventory.size() == 3, "arme déjà portée : réserve pleine")
	a.clear_perks()
	t.check(a.inventory.size() == 2 and a.idx < 2, "Mule Kick perdu : on perd la 3e arme")
	# Pack-a-Punch
	a.switch_weapon(0)
	var dmg0 := float(a.current.cfg["damage"])
	var id0 := a.current.id
	t.check(a.upgrade_current() and a.current.pap == 1, "PaP niveau I")
	t.near(float(a.current.cfg["damage"]), dmg0 * float(Config.pap_levels[1]["dmg"]), "PaP I : dégâts", TOL)
	t.check(a.current.ammo == int(a.current.cfg["magSize"]) and a.current.reserve == int(a.current.cfg["maxReserve"]), "PaP : chargeur et réserve pleins")
	a.upgrade_current()
	a.upgrade_current()
	t.check(not a.upgrade_current() and a.current.pap == 3 and a.current.id == id0, "PaP plafonné au niveau III")
	# atouts
	var base := float(a.current.cfg["damage"])
	var rt := float(a.current.cfg["reloadTime"])
	a.add_perk("doubletap")
	a.add_perk("speedcola")
	t.near(float(a.current.cfg["damage"]), base * 1.25, "Double Tap : dégâts x1,25", TOL)
	t.near(float(a.current.cfg["reloadTime"]), rt * 0.5, "Speed Cola : rechargement x0,5", TOL)
	# molette
	a.clear_perks()
	a.switch_weapon(0)
	var step := {"wheel": 1}
	a.step(Game, DT, step)
	t.check(a.idx == 1, "molette vers le bas : arme suivante")
	a.step(Game, DT, {"wheel": 1})
	t.check(a.idx == 0, "molette : retour à la première (cycle)")
	a.step(Game, DT, {"wheel": -1})
	t.check(a.idx == 1, "molette vers le haut : arme précédente")
	# lance-grenades sous canon (fusil d'assaut PaP III)
	_new_lane(141)
	_equip("rifle", 0)
	Game.arms.current.pap = 3
	Game.arms.current.refresh({})
	Game.arms.current.refill()
	t.check(Game.arms.current.gl == 3, "fusil d'assaut PaP III : 3 obus sous canon")
	_fire_steps(1, {"gl": true})
	t.check(Game.arms.current.gl == 2 and Game.arms.blast.shells.size() == 1, "clic molette : un obus")
	_fire_steps(1, {"gl": true})
	t.check(Game.arms.current.gl == 2, "obus sous canon : délai entre deux coups")

# ------------------------------------------------------------------ couteau
## v0.20.0 : la tête du modèle animé est plus basse que la sphère du JS (sommet à ~1,9 m, bas à ~1,0 m) : le « corps » se vise à 0,6 m.
func _melee(t: Node) -> void:
	var K: Dictionary = Config.at("knife")
	var cases := [
		{"name": "corps", "yaw_z": 0.0, "aim_y": 0.6, "aim_dx": 0.0, "dmg_head": false, "back": false},
		{"name": "tête", "yaw_z": 0.0, "aim_y": 1.83, "aim_dx": 0.0, "dmg_head": true, "back": false},
		{"name": "dos", "yaw_z": PI, "aim_y": 1.0, "aim_dx": 0.0, "dmg_head": false, "back": true},
		{"name": "cône (visée à côté)", "yaw_z": 0.0, "aim_y": 1.0, "aim_dx": 0.9, "dmg_head": false, "back": false},
	]
	for c in cases:
		_new_lane(150)
		Game.director.round_number = 10
		var z := _zombie(Vector3(LANE.x, 0, LANE.z - 1.3), 100000.0)
		z.yaw = float(c["yaw_z"])
		Game.zombies.append(z)
		_aim_at(Game.player, z.pos + Vector3(float(c["aim_dx"]), float(c["aim_y"]), 0.0))
		var pts0 := Game.points
		var elapsed := 0.0
		_fire_steps(1, {"knife": true})
		var hit_time := -1.0
		for i in 60:
			if z.health < 100000.0 and hit_time < 0.0:
				hit_time = i * DT
			_fire_steps(1, {})
			elapsed += DT
		var want := WeaponMelee.damage(10, bool(c["dmg_head"]), bool(c["back"]), false)
		t.near(100000.0 - z.health, want, "couteau (%s) : dégâts" % c["name"], 1e-6)
		t.check(Game.points - pts0 == int(K["points"]["hit"]), "couteau (%s) : %d points" % [c["name"], int(K["points"]["hit"])])
		t.check(hit_time >= 0.0 and hit_time <= float(K["hitDelay"]) + 3.0 * DT, "couteau (%s) : touche à hitDelay (%.3f s)" % [c["name"], hit_time])
	# cooldown : deux appuis rapprochés = un seul coup
	_new_lane(151)
	Game.director.round_number = 10
	var zc := _zombie(Vector3(LANE.x, 0, LANE.z - 1.3), 100000.0)
	Game.zombies.append(zc)
	_aim_at(Game.player, zc.pos + Vector3(0, 0.6, 0))
	_fire_steps(1, {"knife": true})
	_fire_steps(10, {"knife": true})
	_fire_steps(40, {})
	t.near(100000.0 - zc.health, WeaponMelee.damage(10, false, false, false), "couteau : un seul coup pendant le délai", 1e-6)
	# mort : 3 coups au plus dès la manche 10, 100 points la mort
	_new_lane(152)
	Game.director.round_number = 10
	var zk := _zombie(Vector3(LANE.x, 0, LANE.z - 1.3), float(Game.zombie_health_at(10)))
	Game.zombies.append(zk)
	_aim_at(Game.player, zk.pos + Vector3(0, 1.0, 0))
	var swings := 0
	var pts1 := Game.points
	while not zk.dead and swings < 6:
		_fire_steps(1, {"knife": true})
		_fire_steps(int(ceil(float(K["cooldown"]) / DT)) + 1, {})
		swings += 1
	t.check(zk.dead and swings <= 3, "couteau : un zombie de la manche 10 meurt en %d coups (3 attendus au plus)" % swings)
	t.check(Game.points - pts1 == 2 * int(K["points"]["hit"]) + int(K["points"]["kill"]) or swings < 3, "couteau : points de touche puis de mort")
	# Hache du Bourreau : touche aussi un second zombie proche
	_new_lane(153)
	Game.director.round_number = 10
	Game.arms.has_axe = true
	var za := _zombie(Vector3(LANE.x, 0, LANE.z - 1.3), 100000.0)
	var zb := _zombie(Vector3(LANE.x + 1.0, 0, LANE.z - 1.3), 100000.0)
	Game.zombies.append_array([za, zb])
	_aim_at(Game.player, za.pos + Vector3(0, 0.6, 0))
	_fire_steps(1, {"knife": true})
	_fire_steps(30, {})
	t.near(100000.0 - za.health, WeaponMelee.damage(10, false, false, true), "hache : dégâts x3", 1e-6)
	t.check(zb.health < 100000.0, "hache : touche aussi le voisin")
	# clic maintenu, chargeur et réserve vides : coup de couteau
	_new_lane(154)
	Game.director.round_number = 10
	_equip("m1911", 0)
	Game.arms.current.ammo = 0
	Game.arms.current.reserve = 0
	var zm := _zombie(Vector3(LANE.x, 0, LANE.z - 1.3), 100000.0)
	Game.zombies.append(zm)
	_aim_at(Game.player, zm.pos + Vector3(0, 1.0, 0))
	_fire_steps(40, {"fire": true})
	t.check(zm.health < 100000.0, "arme vide : le clic donne un coup de couteau")

# ------------------------------------------------------------------ achats au mur et bornes de munitions (carte de Strasbourg)
func _shop(t: Node) -> void:
	Game.new_game(160, "strasbourg", ["m1911"])
	var wws: Array = Game.world.objects["wallWeapons"]
	t.check(wws.size() > 10, "armes murales dans le monde cuit (%d)" % wws.size())
	# une arme murale que le joueur ne porte pas
	var ww: Dictionary = {}
	for c: Dictionary in wws:
		if c["id"] != "m1911":
			ww = c
			break
	Game.player.pos = Vector3(float(ww["pos"]["x"]) + 1.0, 0, float(ww["pos"]["z"]))
	Game.points = int(ww["price"]) - 1
	var denied := [0]
	var cb := func(_p): denied[0] += 1
	Game.purchase_denied.connect(cb)
	Game.interact()
	t.check(denied[0] == 1 and not Game.arms.has_weapon(ww["id"]) and Game.points == int(ww["price"]) - 1, "arme murale : refusée sans assez de points")
	Game.points = int(ww["price"]) + 7
	var bought := [""]
	var cb2 := func(id): bought[0] = id
	Game.weapon_acquired.connect(cb2)
	Game.interact()
	t.check(bought[0] == ww["id"] and Game.arms.current.id == ww["id"] and Game.points == 7, "arme murale : achetée au prix, mise en main")
	# munitions : prix x papAmmoMult, refusées si la réserve est pleine
	Game.arms.current.reserve = 0
	var ammo_price := int(round(float(ww["ammoPrice"]) * Pap.pap_ammo_mult(Game.arms.current.pap)))
	Game.points = ammo_price
	Game.interact()
	t.check(Game.arms.current.reserve == int(Game.arms.current.cfg["maxReserve"]) and Game.points == 0, "arme murale : munitions au prix d'achat des munitions (%d)" % ammo_price)
	Game.points = 5000
	Game.interact()
	t.check(Game.points == 5000, "réserve pleine : rien n'est dépensé")
	Game.arms.current.pap = 2
	Game.arms.current.refresh({})
	Game.arms.current.reserve = 0
	Game.points = 100000
	Game.interact()
	var paid := 100000 - Game.points
	t.check(paid == int(round(float(ww["ammoPrice"]) * Pap.pap_ammo_mult(2))) and paid > int(ww["ammoPrice"]), "arme améliorée : munitions plus chères (%d)" % paid)
	Game.purchase_denied.disconnect(cb)
	Game.weapon_acquired.disconnect(cb2)
	# borne de munitions
	var st: Dictionary = Game.world.objects["stations"][0]
	Game.player.pos = Vector3(float(st["x"]) + 1.0, 0, float(st["z"]))
	Game.arms.current.reserve = 0
	Game.points = 1000
	Game.interact()
	t.check(Game.arms.current.reserve == int(Game.arms.current.cfg["maxReserve"]) and Game.points == 1000 - int(Game.arms.current.cfg["ammoPrice"]), "borne : réserve pleine au prix de l'arme")
	# loin de tout : l'interaction ne fait rien
	Game.player.pos = Vector3(900, 0, 900)
	var p0 := Game.points
	Game.interact()
	t.check(Game.points == p0, "loin d'un mur ou d'une borne : rien")

# ------------------------------------------------------------------ bot : chaque arme tue la manche 1
func _bots(t: Node) -> void:
	var report := PackedStringArray()
	for id: String in Config.at("weapons"):
		Game.new_game(170, "arena", [id])
		var steps := 0
		var cleared := false
		while steps < 60 * 150 and not Game.over:
			Game.step(DT, Bot.think(Game))
			steps += 1
			if Game.round_number == 1 and Game.director.to_spawn == 0 and Game.alive_count() == 0 and Game.kills > 0:
				cleared = true
				break
		t.check(cleared and not Game.over, "bot avec %s : tue la manche 1 sans mourir (%d tués, %.1f s, %d PV)" % [id, Game.kills, Game.time, Game.player.health])
		report.append("%s %.0fs" % [id, Game.time])
	print("bot, manche 1 par arme : ", ", ".join(report))
