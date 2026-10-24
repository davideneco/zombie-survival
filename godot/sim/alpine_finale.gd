class_name AlpineFinale
extends FinaleSim
## v0.34.0 : fin de partie de la Station des Aiguilles, « La Nuit blanche ». La cloche de l'église Saint-Bernard (machine "clock") la lance quand
## toutes les zones sont ouvertes et dès la manche MIN_ROUND :
##   intro -> 3 vagues (la descente des pistes, le blizzard, l'avalanche) autour du joueur -> le Bourreau des neiges surgit au sol devant le joueur
##   (mêmes attaques et mêmes quatre phases que le Bourreau de la cathédrale, mais sans tour : la phase III se joue au sol, BossCtx.want_leap faux)
##   -> victoire (points, munitions, la Hache) -> l'aube se lève sur la station (Bénédiction de l'Aube, portes gratuites) -> Nuit éternelle.
## Le Maître Tanneur (manches 15, 20…) rôde dans les zones listées par le plan (tannerZones). Pur : réutilise FinaleSim (apparitions, ciel, barre).

const MIN_ROUND := 10
const BOSS_NAMES := ["LE BOURREAU DES NEIGES", "LA SENTENCE", "LA TEMPÊTE", "LE JUGEMENT"]
const WAVES := [
	{"name": "La descente des pistes", "count": 16, "kinds": {"normal": 0.7, "runner": 0.2, "crawler": 0.1}},
	{"name": "Le blizzard", "count": 20, "kinds": {"normal": 0.35, "runner": 0.45, "crawler": 0.1, "armored": 0.1}},
	{"name": "L'avalanche", "count": 24, "kinds": {"normal": 0.3, "runner": 0.25, "armored": 0.25, "bloat": 0.2}},
]

func _init(g_: Node) -> void:
	super(g_)
	want_leap = false

func is_ready() -> bool:
	return g.round_number >= MIN_ROUND and open_zones() >= g.world.zone_names.size()

func prompt() -> String:
	if g.finale_done:
		return "La cloche s'est tue. La station tient encore…"
	if active():
		return "La Nuit blanche est tombée : tenez bon !"
	if not is_ready():
		var need: Array = []
		if g.round_number < MIN_ROUND:
			need.append("manche %d requise" % MIN_ROUND)
		if open_zones() < g.world.zone_names.size():
			need.append("%d/%d zones ouvertes" % [open_zones(), g.world.zone_names.size()])
		return "La cloche de Saint-Bernard… (%s pour la Nuit blanche)" % " · ".join(PackedStringArray(need))
	return "E Sonner la cloche : la Nuit blanche, le Bourreau des neiges vous attend"

func use_clock() -> bool:
	if active() or g.finale_done or not is_ready():
		g.finale_sfx.emit("deny", 1.0)
		return false
	start()
	return true

func start() -> void:
	if active():
		return
	f = {"state": "intro", "t": 0.0, "wave": -1, "queue": [], "spawnT": 0.0, "np": 1, "banner": "LA NUIT BLANCHE", "boss": null, "addT": 0.0, "plT": 0.0}
	g.finale_sfx.emit("bell_x6", 1.0)
	g.announce("LA NUIT BLANCHE", "La cloche de Saint-Bernard sonne… la montagne répond")

func start_wave(n: int) -> void:
	var W: Dictionary = WAVES[n]
	f["wave"] = n
	f["state"] = "wave"
	f["t"] = 0.0
	var q: Array = []
	for _i in int(W["count"]):
		q.append(_pick(W["kinds"]))
	f["queue"] = q
	f["total"] = q.size()
	f["spawnT"] = 1.5
	g.announce("VAGUE %d / %d" % [n + 1, WAVES.size()], String(W["name"]).to_upper())
	g.finale_sfx.emit("round_start", 1.0)

## Point d'apparition d'une vague : au sol, dans une zone ouverte, entre 14 et 34 m du joueur (repli : 20 m devant lui).
func alpine_spawn_point() -> Vector2:
	var p: PlayerSim = g.player
	for k in 4:
		var gp: Vector3 = g.world.pick_ground(p.pos.x, p.pos.z, 14.0, 34.0 + k * 8.0, g.rng)
		if gp != Vector3.INF:
			return Vector2(gp.x, gp.z)
	return Vector2(p.pos.x + 20.0, p.pos.z)

func step(dt: float) -> void:
	if mark_t > 0.0:
		mark_t -= dt
	_sky_step(dt)
	_update_mini_bar()
	if f.is_empty():
		return
	f["t"] = float(f["t"]) + dt
	match String(f["state"]):
		"intro":
			f["banner"] = "LA NUIT BLANCHE"
			if float(f["t"]) > 6.0:
				start_wave(0)
		"wave":
			var W: Dictionary = WAVES[int(f["wave"])]
			f["spawnT"] = float(f["spawnT"]) - dt
			var q: Array = f["queue"]
			if not q.is_empty() and float(f["spawnT"]) <= 0.0 and alive_count() < int(F()["maxAlive"]):
				f["spawnT"] = 0.55
				var sp := alpine_spawn_point()
				spawn_at(q.pop_back(), 0, sp.x, sp.y)
			var left := q.size() + alive_count()
			f["banner"] = "LA NUIT BLANCHE — VAGUE %d/%d · %s · %d restants" % [int(f["wave"]) + 1, WAVES.size(), String(W["name"]).to_upper(), left]
			if q.is_empty() and alive_count() <= 1:
				f["state"] = "breather"
				f["t"] = 0.0
				g.announce("VAGUE TERMINÉE", "Reprenez votre souffle…" if int(f["wave"]) + 1 < WAVES.size() else "La neige tremble…")
				g.finale_sfx.emit("round_end", 1.0)
		"breather":
			var more: bool = int(f["wave"]) + 1 < WAVES.size()
			f["banner"] = ("Vague suivante dans %d s" % maxi(0, ceili(float(F()["breather"]) - float(f["t"])))) if more else "La neige tremble…"
			if float(f["t"]) > float(F()["breather"]):
				if more:
					start_wave(int(f["wave"]) + 1)
				else:
					start_boss1()
		"boss1":
			var b := f["boss"] as BossSim
			f["banner"] = "LE BOURREAU DES NEIGES"
			if b != null and f.get("bossAt", null) != null and float(f["t"]) > 2.0:
				var at: Vector2 = f["bossAt"]
				b.arrive(0, at.x, at.y, 0.0)
				f["bossAt"] = null
			if b != null and not b.dead and b.state == "chase":   # renforts épisodiques
				f["addT"] = float(f["addT"]) - dt
				if float(f["addT"]) <= 0.0 and alive_count() < 6:
					f["addT"] = 9.0
					var sp2 := alpine_spawn_point()
					spawn_at("runner" if _rand() < 0.3 else "normal", 0, sp2.x, sp2.y)
		"victory":
			f["banner"] = "LE BOURREAU DES NEIGES EST TOMBÉ"
			if float(f["t"]) > 4.0:
				win()
		"dawn":
			f["banner"] = "L'AUBE SE LÈVE SUR LA STATION"
			if float(f["t"]) > float(S()["dawn"]["sky"]):
				end_summit()
	if f.has("boss") and f["boss"] != null:
		(f["boss"] as BossSim).ctx = self

## Le Bourreau surgit de la neige à 12 m devant le joueur (case libre la plus proche).
func start_boss1() -> void:
	f["state"] = "boss1"
	f["t"] = 0.0
	var p: PlayerSim = g.player
	var fwd := Vector2(-sin(p.yaw), -cos(p.yaw))
	var at := Vector2(p.pos.x, p.pos.z) + fwd * 12.0
	var nav: NavGrid = g.world.nav
	var ci := nav.nearest_free(at.x, at.y, 20)
	if ci >= 0:
		at = Vector2(nav.world_x(ci % nav.nx), nav.world_z(ci / nav.nx))
	var b := BossSim.new(float(F()["bossHealth"]), self)
	b.boss_name = BOSS_NAMES[0]
	b.id = g.next_zombie_id()
	b.rng = g.rng
	b.pos = Vector3(at.x, 0.0, at.y)
	b.state = "hidden"
	b.bs = 9
	b.hidden_flag = true
	g.add_zombie(b)
	f["boss"] = b
	f["bossAt"] = at
	g.announce("LE BOURREAU DES NEIGES", "La neige se soulève devant vous…")

func boss_bar() -> Dictionary:
	var b := f.get("boss", null) as BossSim
	if b == null or b.dead or b.is_angel:
		return {}
	return {"hp": maxf(0.0, roundf(b.health)), "max": b.max_health, "phase": b.phase, "inv": b.is_invulnerable(), "name": BOSS_NAMES[clampi(b.phase - 1, 0, 3)], "thresholds": F()["boss"]["thresholds"]}

func on_kill(z: ZombieSim) -> void:
	if z.is_boss and not z.mini and not z.is_angel:
		if active():
			f["state"] = "victory"
			f["t"] = 0.0
			f["boss"] = z
		for o in g.zombies:
			if not o.dead and o != z:
				o.damage(1.0e9, false)
		event("boss_shock", {"x": z.pos.x, "y": z.pos.y, "z": z.pos.z})
		g.announce("LE BOURREAU DES NEIGES EST TOMBÉ", "Le vent retombe sur les Aiguilles…")
		g.finale_sfx.emit("powerup", 1.0)
		return
	super(z)

## Victoire : points, munitions pleines, la Hache ; puis l'aube (Bénédiction de l'Aube, portes gratuites) et la Nuit éternelle.
func win() -> void:
	g.finale_done = true
	for z in g.zombies:
		if not z.dead:
			z.become_ash()
	var p: PlayerSim = g.player
	if p.downed or p.dead:
		p.revive(g.time)
	g.to_spawn_zero()
	g.add_bonus_points(int(F()["boss"]["reward"]["points"]))
	for w: WeaponState in g.arms.inventory:
		w.refill()
	g.arms.has_axe = true
	g.eternal = true
	g.blessed = true
	g.free_doors = true
	for id: String in Config.at("perks"):
		if not g.arms.perks.get(id, false):
			g.add_perk(id)
	p.health = maxf(p.health, p.max_health * 0.6)
	dawn_on = true
	dawn_t0 = g.time
	sky_phase = "dawn"
	sky_t = 0.0
	f = {"state": "dawn", "t": 0.0, "np": 1, "banner": "L'AUBE SE LÈVE SUR LA STATION", "boss": null}
	g.finale_sfx.emit("powerup", 1.0)
	g.finale_sfx.emit("bell_x4", 1.0)
	g.announce("L'AUBE", "Le blizzard se lève : le soleil revient sur les Aiguilles")
	g.victory_screen.emit("STATION LIBÉRÉE", "Le Bourreau des neiges est vaincu : l'aube se lève sur la Station des Aiguilles.\nManche %d  ·  %d zombies tués  ·  +%d points  ·  munitions pleines\nVous ramassez la Hache du Bourreau : elle remplace votre couteau (dégâts x%d, touche deux zombies).\nBénédiction de l'Aube : tous les atouts, même à terre, sans limite  ·  toutes les portes sont gratuites.\nLa nuit reviendra : la Nuit éternelle commence, les zombies auront 30 %% de vie en plus." % [g.round_number, g.kills, int(F()["boss"]["reward"]["points"]), int(Config.at("knife.axe.dmgMult"))])

## Maître Tanneur : dans une zone ouverte de la liste du plan (tannerZones), à partir de la manche 15 toutes les 5 manches.
func maybe_spawn_tanner() -> bool:
	var T: Dictionary = Config.at("tanner")
	var r: int = g.round_number
	if T.is_empty() or r < int(T["fromRound"]) or (r - int(T["fromRound"])) % int(T["every"]) != 0 or active():
		return false
	for z in g.zombies:
		if z.mini and not z.dead:
			return false
	var open: Array[int] = []
	for n: String in g.world.objects.get("tannerZones", []):
		var i: int = g.world.zone_names.find(n)
		if i >= 0 and g.world.is_zone_open(i):
			open.append(i)
	if open.is_empty():
		return false
	var zi: int = open[int(floor(_rand() * open.size()))]
	var zc: Dictionary = g.world.objects["zones"][zi]["center"]
	var gp := Vector3.INF
	for k in 6:
		if gp != Vector3.INF:
			break
		gp = g.world.pick_ground(float(zc["x"]), float(zc["z"]), 0.0, 25.0 + k * 10.0, g.rng)
	var x: float = gp.x if gp != Vector3.INF else float(zc["x"])
	var zz: float = gp.z if gp != Vector3.INF else float(zc["z"])
	var tn := TannerSim.new(roundf(float(T["healthMult"]) * g.zombie_health_at(r)), self)
	tn.id = g.next_zombie_id()
	tn.rng = g.rng
	tn.pos = Vector3(x, 0.0, zz)
	g.add_zombie(tn)
	g.announce("MAÎTRE TANNEUR", "Il rôde dans %s…" % g.world.zone_names[zi])
	return true
