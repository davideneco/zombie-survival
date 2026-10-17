class_name WeaponArms
extends RefCounted
## L'armement du joueur : inventaire (2 armes, 3 avec Mule Kick), atouts qui touchent les armes, tir (balle, plombs, perforation, chute des
## dégâts, Éther, balles explosives, éclaboussure), visée (ADS), M79 et lance-grenades sous canon, couteau et Hache, grenades à main.
## Port de la partie arme de src/player.js, sans nœud ni rendu : `g` est l'hôte (autoload Game), `step` ne dépend que de dt.

const MAX_SHOTS_PER_FRAME := 3   ## player.js : plafond de tirs par image
const ADS_DELTA := 20.0          ## réduction du FOV en visée (armes sans lunette)
const ADS_RATE := 12.0           ## lissage de la visée : aim += (cible - aim) x min(1, dt x 12)
const ADS_SPREAD := 0.4          ## dispersion x0,4 en visée
const ADS_SCOPE_SPREAD := 0.05   ## x0,05 avec une lunette (adsFov)
const EMPTY_CLICK_RETRY := 0.3   ## clic à vide : prochain essai
const MELEE_RETRY := 0.1         ## chargeur et réserve vides : le clic maintenu retente le couteau toutes les 0,1 s
const GL_AIM_SPREAD := 0.4
const SHELL_AIM_MAX := 40.0      ## player.js fireLauncher : on vise le point visé par la caméra (au plus 40 m devant)
const SHELL_AIM_MIN := 2.0
const MUZZLE := Vector3(0.12, -0.12, -0.8)   ## bouche de l'arme dans le repère de la caméra (le JS lit viewmodels.js : valeur unique ici)

var inventory: Array[WeaponState] = []
var idx := 0
var perks: Dictionary = {}       ## atouts actifs (J6 les achète ; ici seulement leur effet sur les armes)
var grenades := 0
var has_axe := false             ## Hache du Bourreau (récompense de la finale, J10)
var aim := 0.0                   ## 0..1, fondu de la visée (FOV)
var aiming := false              ## bouton de visée maintenu (dispersion)
var blast := WeaponBlast.new()
var melee_t := -1.0              ## minuterie du coup de couteau, < 0 : pas de coup
var melee_hit := true
var next_melee := 0.0
var lunge_left := 0.0
var lunge_dir := Vector2.ZERO
var next_gl := 0.0
var locked := false              ## J6 : arme confisquée par le Pack-a-Punch (ni tir, ni changement d'arme)
var _trigger := false            ## clic maintenu / verrou « un tir par clic » des armes semi-automatiques
var _fire_prev := false

func _init(start_weapons: Array) -> void:
	grenades = int(Config.at("grenade.start"))
	for id in start_weapons:
		var w := WeaponState.new(String(id))
		w.refresh(perks)
		inventory.append(w)

var current: WeaponState:
	get: return inventory[idx]

func max_weapons() -> int:
	return 3 if perks.get("mulekick", false) else 2

func has_weapon(id: String) -> bool:
	for w in inventory:
		if w.id == id:
			return true
	return false

# ---------------------------------------------------------------- inventaire
func add_perk(id: String) -> void:
	perks[id] = true
	_refresh_all()

func clear_perks() -> void:
	perks = {}
	_refresh_all()
	if inventory.size() > max_weapons():   # Mule Kick perdu : on perd la 3e arme
		inventory.resize(max_weapons())
		if idx >= inventory.size():
			idx = 0
		switch_weapon(idx)

func _refresh_all() -> void:
	for w in inventory:
		w.refresh(perks)

## Nouvelle arme : prend un emplacement libre, sinon remplace l'arme en main. Une arme déjà portée est rechargée à fond.
func give_weapon(id: String) -> void:
	if Config.weapon(id).is_empty():
		return
	for i in inventory.size():
		if inventory[i].id == id:
			inventory[i].reserve = int(inventory[i].cfg["maxReserve"])
			switch_weapon(i)
			return
	var w := WeaponState.new(id)
	w.refresh(perks)
	if inventory.size() < max_weapons():
		inventory.append(w)
		switch_weapon(inventory.size() - 1)
	else:
		inventory[idx] = w
		switch_weapon(idx)

## Pack-a-Punch : améliore l'arme en main d'un niveau (chargeur et réserve pleins).
func upgrade_current() -> bool:
	var w := current
	if w.pap >= Config.pap_levels.size() - 1:
		return false
	w.pap += 1
	w.refresh(perks)
	w.ammo = int(w.cfg["magSize"])
	w.refill()
	w.reloading = false
	switch_weapon(idx)
	return true

## Munitions max (bonus) : toutes les armes portées font le plein de réserve (et d'obus), et les grenades remontent au maximum.
func max_ammo() -> void:
	for w in inventory:
		w.refill()
	grenades = int(Config.at("grenade.max"))

func switch_weapon(i: int) -> void:
	if i < 0 or i >= inventory.size():
		return
	current.reloading = false
	idx = i

func next_weapon() -> void:
	switch_weapon((idx + 1) % inventory.size())

func prev_weapon() -> void:
	switch_weapon((idx - 1 + inventory.size()) % inventory.size())

## Nouvelle manche : +perRound grenades, jusqu'à max.
func on_round_start() -> void:
	grenades = mini(int(Config.at("grenade.max")), grenades + int(Config.at("grenade.perRound")))

## FOV de la caméra selon la visée (player.js : ADS ; arme à lunette ou à zoom : adsFov / zoom).
func fov(base: float) -> float:
	var cfg := current.cfg
	var target := float(cfg.get("adsFov", cfg.get("zoom", 0.0)))
	return base - ((base - target) if target > 0.0 else ADS_DELTA) * aim

# ---------------------------------------------------------------- pas de simulation
## input : { fire (maintenu), reload (appui), aim (maintenu), knife, grenade, gl (appuis), weapon (indice), wheel (+1 / -1), mz (avant) }
func step(g: Node, dt: float, input_in: Dictionary) -> void:
	var now: float = g.time
	var input := input_in
	if locked or g.player.downed:   # à terre ou arme dans la machine : aucune action d'arme
		input = input_in.duplicate()
		for k in ["fire", "reload", "knife", "grenade", "gl", "aim"]:
			input[k] = false
		input.erase("weapon")
		input.erase("wheel")
	aiming = bool(input.get("aim", false)) and not g.player.dead
	aim += ((1.0 if aiming else 0.0) - aim) * minf(1.0, dt * ADS_RATE)
	if input.has("weapon"):
		switch_weapon(int(input["weapon"]))
	if input.has("wheel"):
		if int(input["wheel"]) > 0:
			next_weapon()
		elif int(input["wheel"]) < 0:
			prev_weapon()
	if bool(input.get("grenade", false)):
		throw_grenade(g)
	if bool(input.get("gl", false)):
		fire_gl(g, now)
	if bool(input.get("knife", false)):
		melee(g, now, float(input.get("mz", 0.0)) > 0.0)
	var w := current
	var was_reloading := w.reloading
	var held := bool(input.get("fire", false))
	if held and not _fire_prev:
		_trigger = true
	if not held:
		_trigger = false
	_fire_prev = held
	if bool(input.get("reload", false)):
		start_reload(w)
	if w.reloading:
		w.update(dt)
	else:
		var n := 0
		while n < MAX_SHOTS_PER_FRAME and _trigger and now >= w.next_shot:
			n += 1
			if w.ammo > 0:
				shoot(g, now)
				if bool(w.cfg.get("autoReload", false)) and w.ammo <= 0:
					start_reload(w)
			elif w.reserve > 0:
				start_reload(w)
				break
			else:
				w.next_shot = now + MELEE_RETRY   # chargeur et réserve vides : coup de couteau à la place du clic à vide
				if melee_t < 0.0 and now >= next_melee and not melee(g, now, false):
					w.next_shot = now + EMPTY_CLICK_RETRY
					g.weapon_event.emit("empty", {})
				break
			if String(w.cfg["type"]) == "semi":
				_trigger = false   # une balle par clic
				break
	if current == w and w.reloading and not was_reloading:
		g.weapon_event.emit("reload", {"id": w.id, "cat": String(w.cfg["cat"]), "time": float(w.cfg["reloadTime"])})
	_update_melee(g, dt)
	blast.update_shells(g, dt)
	blast.update_nades(g, dt)

func start_reload(w: WeaponState) -> void:
	w.start_reload()

# ---------------------------------------------------------------- tir
func _aim_mult(cfg: Dictionary, on: bool) -> float:
	if not on:
		return 1.0
	return ADS_SCOPE_SPREAD if cfg.has("adsFov") else ADS_SPREAD

## Direction d'un tir avec dispersion (sx, sy en NDC comme le setFromCamera du JS ; ouverture de J1 : voir docs).
func _spread_dir(g: Node, spread: float) -> Vector3:
	var p: PlayerSim = g.player
	var tan_half := tan(deg_to_rad(Rules.FOV_DEG) / 2.0)
	var sx: float = (g.rng.randf() - 0.5) * 2.0 * spread * tan_half
	var sy: float = (g.rng.randf() - 0.5) * 2.0 * spread * tan_half
	var fwd := p.forward()
	var right := Vector3(cos(p.yaw), 0, -sin(p.yaw))
	var up := right.cross(fwd)
	return (fwd + right * sx + up * sy).normalized()

func shoot(g: Node, now: float) -> void:
	var w := current
	var cfg := w.cfg
	w.consume(now)
	var p: PlayerSim = g.player
	var mul := _aim_mult(cfg, aiming) * (Rules.MOVING_SPREAD_MULT if p.moving else 1.0)
	if String(cfg["type"]) == "launcher":
		fire_launcher(g, cfg, mul)
		return
	var origin := p.eye()
	var pellets := int(cfg.get("pellets", 1))
	var budget := maxi(1, int(cfg.get("pierce", 1)))
	for _p in pellets:
		var dir := _spread_dir(g, float(cfg["spread"]) * mul)
		var res := Hitscan.cast(origin, dir, float(cfg["range"]), g.zombies, g.collision, budget)
		var end: Vector3 = origin + dir * float(res["wall_t"])
		var hits: Array = res["hits"]
		for h: Dictionary in hits:
			# chute des dégâts selon la distance, propre à chaque zombie touché
			var dmg := float(cfg["damage"]) * Pap.falloff_mult(cfg, float(h["t"]))
			var at0: Vector3 = origin + dir * float(h["t"])
			var killed: bool = g.hit_zombie(h["z"], bool(h["head"]), dmg, float(cfg["headMult"]), false, {"ray": String(cfg.get("id", "")) == "raygun", "px": at0.x, "pz": at0.z})
			var at: Vector3 = origin + dir * float(h["t"])
			if g.has_signal("impact"):
				g.impact.emit(at, true, killed and not bool(h["head"]))
			if cfg.has("ether") and g.rng.randf() < float(cfg["ether"]["chance"]):   # Éther (niveau III)
				blast.splash(g, at, float(cfg["ether"]["radius"]), dmg * float(cfg["ether"]["frac"]), int(cfg["ether"]["color"]))
		if hits.size() >= budget:
			end = origin + dir * float(hits[hits.size() - 1]["t"])
		elif g.has_signal("impact"):
			g.impact.emit(end, false, false)   # la balle finit dans un mur (ou à bout de portée) : poussière
		if cfg.has("splash"):
			var sp: Dictionary = cfg["splash"]
			blast.splash(g, end, float(sp["radius"]), float(sp["damage"]), int(sp.get("color", 0x44ff66)))
		if cfg.has("boom"):   # balles explosives (fusils de précision, niveau III)
			var bm: Dictionary = cfg["boom"]
			blast.splash(g, end, float(bm["radius"]), float(cfg["damage"]) * float(bm["frac"]), int(bm["color"]))
		g.shot_fired.emit(origin, end)

## Lance-grenades : un vrai projectile, qui part de la bouche et vise le point visé par la caméra (au plus 40 m devant) ;
## si le canon est plaqué contre un mur, il part de l'œil.
func fire_launcher(g: Node, cfg: Dictionary, mul: float) -> void:
	var p: PlayerSim = g.player
	var ro := p.eye()
	var rd := _spread_dir(g, float(cfg["spread"]) * mul)
	var fwd := p.forward()
	var right := Vector3(cos(p.yaw), 0, -sin(p.yaw))
	var up := right.cross(fwd)
	var origin := ro + right * MUZZLE.x + up * MUZZLE.y + fwd * -MUZZLE.z
	var to_m := origin - ro
	var len_m := to_m.length()
	if len_m > 1e-4:
		to_m /= len_m
		var hit: float = g.collision.ray_hit(ro.x, ro.y, ro.z, to_m.x, to_m.y, to_m.z, len_m)
		if hit < len_m:
			origin = ro + to_m * maxf(0.0, hit - 0.05)
	var far := minf(SHELL_AIM_MAX, g.collision.ray_hit(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, SHELL_AIM_MAX))
	var target := ro + rd * maxf(far, SHELL_AIM_MIN)
	var dir := (target - origin).normalized()
	var proj: Dictionary = Config.weapon("m79")["proj"]
	blast.launch_shell(origin, dir * float(proj["speed"]), int(cfg.get("pap", 0)))
	g.shot_fired.emit(origin, origin + dir)

## Lance-grenades sous canon (clic molette) : un obus de M79 ordinaire, avec un délai entre deux coups.
func fire_gl(g: Node, now: float) -> bool:
	var w := current
	if not w.cfg.has("gl") or w.gl <= 0 or now < next_gl or g.player.dead:
		return false
	w.gl -= 1
	next_gl = now + float(w.cfg["gl"]["cooldown"])
	var m := Config.weapon("m79")
	fire_launcher(g, {"spread": m["spread"], "pap": 0}, GL_AIM_SPREAD if aiming else 1.0)
	return true

## Grenade à main : part de l'œil, 15 m/s vers l'avant, +3 m/s vers le haut, plus la vitesse du joueur.
func throw_grenade(g: Node) -> bool:
	var p: PlayerSim = g.player
	if p.dead or grenades <= 0:
		return false
	grenades -= 1
	var dir := p.forward()
	var origin := p.eye() + dir * WeaponBlast.NADE_THROW_FWD
	var v := dir * WeaponBlast.NADE_THROW_SPEED + Vector3(0, WeaponBlast.NADE_THROW_LIFT, 0) + Vector3(p.vel.x, 0, p.vel.z)
	blast.throw_grenade(origin, v)
	return true

# ---------------------------------------------------------------- couteau
## Lance un coup (touche V, ou clic maintenu chargeur et réserve vides). Faux si impossible.
func melee(g: Node, now: float, forward: bool) -> bool:
	if g.player.dead or melee_t >= 0.0 or now < next_melee:
		return false
	var K: Dictionary = Config.at("knife")
	next_melee = now + float(K["cooldown"])
	melee_t = 0.0
	melee_hit = false
	lunge_left = 0.0
	g.weapon_event.emit("knife_swing", {})
	if forward:   # fente : on avance de lunge m vers un zombie proche, si on avance
		var d := WeaponMelee.lunge_target(g.player, g.zombies)
		if d >= 0.0:
			lunge_left = minf(float(K["lunge"]), maxf(0.0, d - WeaponMelee.LUNGE_STOP))
			lunge_dir = Vector2(-sin(g.player.yaw), -cos(g.player.yaw))
	return true

func _update_melee(g: Node, dt: float) -> void:
	if melee_t < 0.0:
		return
	var K: Dictionary = Config.at("knife")
	var p: PlayerSim = g.player
	if p.dead:
		melee_t = -1.0
		lunge_left = 0.0
		return
	melee_t += dt
	if lunge_left > 0.0:
		var step := minf(lunge_left, float(K["lunge"]) / float(K["lungeTime"]) * dt)
		lunge_left -= step
		p.pos.x += lunge_dir.x * step
		p.pos.z += lunge_dir.y * step
		p.pos = g.collision.resolve(p.pos, float(Config.at("player.radius")))
	if not melee_hit and melee_t >= float(K["hitDelay"]):
		melee_hit = true
		_melee_strike(g)
	if melee_t >= float(K["anim"]):
		melee_t = -1.0

func _melee_strike(g: Node) -> void:
	var K: Dictionary = Config.at("knife")
	var p: PlayerSim = g.player
	var tgt := WeaponMelee.pick_target(p, g.zombies, g.collision)
	if tgt.is_empty():
		return   # dans le vide : seul le souffle
	var z: ZombieSim = tgt["z"]
	var back := WeaponMelee.is_back(p, z)
	var mdmg := WeaponMelee.damage(g.round_number, bool(tgt["head"]), back, has_axe)
	if z.is_boss and not z.mini:   # Bourreau : dégâts fixes (face / dos : BossSim.damage)
		mdmg = float(K["boss"]["dmg"]) * (float(K["axe"]["dmgMult"]) if has_axe else 1.0)
	g.hit_zombie(z, bool(tgt["head"]), mdmg, 1.0, true, {"back": back, "ax": p.pos.x, "az": p.pos.z})
	var zarmor: Variant = z.get("armor")
	g.weapon_event.emit("knife_hit", {"metal": (zarmor != null and not is_equal_approx(float(zarmor), 1.0)) or g.is_boss(z)})
	if has_axe:   # Hache du Bourreau : touche aussi le zombie le plus proche de la cible
		var A: Dictionary = K["axe"]
		var extra := 0
		for o: ZombieSim in g.zombies:
			if extra >= int(A["extra"]):
				break
			if o == z or o.dead or absf(o.pos.y - z.pos.y) > WeaponMelee.CONE_VERTICAL:
				continue
			if Vector2(o.pos.x - z.pos.x, o.pos.z - z.pos.z).length() > float(A["splash"]):
				continue
			if Vector2(o.pos.x - p.pos.x, o.pos.z - p.pos.z).length() > float(K["range"]) + float(A["splash"]) + 0.4:
				continue
			extra += 1
			g.hit_zombie(o, false, WeaponMelee.damage(g.round_number, false, false, true), 1.0, true)
