extends RefCounted
## J11 : parité solo. Enjambement du joueur (Espace devant un obstacle bas, invite, durée, caméra, pas de tir), se débloquer (invite, maintien, recharge),
## visée (marche x0,6, pas de sprint, souris plus lente), étalement des tirs selon le FOV et le rapport d'écran, pause sur perte de focus.

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}

var _t: Node

func run(t: Node) -> void:
	_t = t
	_vault(t)
	_aim(t)
	_spread(t)
	_unstick(t)
	_stuck_scan(t)
	_focus(t)
	_assets_and_texts(t)
	_mini_soak(t)

func _new() -> void:
	Game.new_game(5, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9
	Game.world.open_all_doors()

func _steps(n: int, input := IDLE) -> void:
	for _i in n:
		Game.step(DT, input)

## Cherche un obstacle enjambable avec une place libre en face : renvoie { pos, yaw } ou {}.
func _find_vault_spot() -> Dictionary:
	var col: Collision = Game.collision
	var p := Game.player
	for v: Dictionary in col.vaults:
		if not v.has("segs") or float(v["h"]) > 1.0:
			continue
		var sg: Dictionary = v["segs"][0]
		var mx := (float(sg["ax"]) + float(sg["bx"])) / 2.0
		var mz := (float(sg["az"]) + float(sg["bz"])) / 2.0
		var ex := float(sg["bx"]) - float(sg["ax"])
		var ez := float(sg["bz"]) - float(sg["az"])
		var l := sqrt(ex * ex + ez * ez)
		if l < 0.4:
			continue
		for side: float in [1.0, -1.0]:
			var nx := -ez / l * side
			var nz := ex / l * side
			var pos := Vector3(mx + nx * 0.6, 0.0, mz + nz * 0.6)
			p.pos = pos
			p.vel = Vector3.ZERO
			p.yaw = atan2(nx, nz)   # regarde vers (-nx, -nz)
			p.vy = 0.0
			var q := col.resolve(pos, float(Config.at("player.radius")))
			if Vector2(q.x - pos.x, q.z - pos.z).length() > 0.01:
				continue
			p.step(DT, Game.time, IDLE, col, Game.world.levels, Game.world)
			if p.vault_ready:
				return {"pos": pos, "yaw": p.yaw}
	return {}

func _vault(t: Node) -> void:
	_new()
	var p := Game.player
	var spot := _find_vault_spot()
	t.check(not spot.is_empty(), "enjambement : un obstacle bas trouvé dans le monde")
	if not spot.is_empty():
		print("enjambement : spot %.2f,%.2f,%.1f (--pos=x,z,lacet en degrés)" % [spot["pos"].x, spot["pos"].z, rad_to_deg(spot["yaw"])])
	if spot.is_empty():
		return
	p.pos = spot["pos"]
	p.yaw = spot["yaw"]
	p.pitch = 0.0
	p.vel = Vector3.ZERO
	_steps(1)
	t.check(p.vault_ready, "enjambement : invite prête devant l'obstacle")
	t.check(Prompts.text(Game).ends_with("Enjamber"), "enjambement : invite « Enjamber » (« %s »)" % Prompts.text(Game))
	var start := p.pos
	var heard := [0]
	Game.vaulted.connect(func() -> void: heard[0] += 1)
	var arms_ammo: int = Game.arms.current.ammo
	_steps(1, {"mx": 0.0, "mz": 0.0, "jump": true, "fire": true})
	t.check(not p.vault.is_empty(), "enjambement : lancé par Espace")
	t.check(heard[0] == 1, "enjambement : son émis une fois")
	t.check(p.vy == 0.0, "enjambement : pas de saut")
	_steps(10, {"mx": 0.0, "mz": 0.0, "fire": true})
	t.check(Game.arms.current.ammo == arms_ammo, "enjambement : pas de tir pendant l'enjambement")
	t.check(p.eye_height() > float(Config.at("player.eye")) + 0.1, "enjambement : la caméra monte (%.2f)" % p.eye_height())
	_steps(int(ceil(float(Config.at("vault.time")) / DT)))
	t.check(p.vault.is_empty(), "enjambement : fini après %.1f s" % float(Config.at("vault.time")))
	var dist := Vector2(p.pos.x - start.x, p.pos.z - start.z).length()
	t.check(dist > 0.9 and dist < 3.0, "enjambement : de l'autre côté de l'obstacle (%.2f m)" % dist)
	t.near(p.pos.y, 0.0, "enjambement : au sol", 1e-6)
	t.near(p.eye_height(), float(Config.at("player.eye")), "enjambement : caméra revenue", 1e-9)
	t.check(not p.vault_ready, "enjambement : pas de nouvel enjambement pendant la recharge ou face à rien")
	# zone fermée : refusé (jamais de contournement d'une porte payante)
	_new()
	spot = _find_vault_spot()
	if not spot.is_empty():
		var zi := Game.world.zone_of(spot["pos"].x - sin(spot["yaw"]) * 1.5, spot["pos"].z - cos(spot["yaw"]) * 1.5)
		Game.world.zone_open[Game.world.zone_of(spot["pos"].x, spot["pos"].z)] = 1
		if zi >= 0 and zi != Game.world.zone_of(spot["pos"].x, spot["pos"].z):
			Game.world.zone_open[zi] = 0
			p = Game.player
			p.pos = spot["pos"]
			p.yaw = spot["yaw"]
			_steps(1)
			t.check(not p.vault_ready, "enjambement : refusé vers une zone fermée")
	# non enjambables : la face d'un mur de bâtiment ne propose rien
	_new()
	p = Game.player
	_steps(5)
	t.check(not p.vault_ready, "enjambement : rien à enjamber au départ")
	# à terre : jamais
	_new()
	spot = _find_vault_spot()
	if not spot.is_empty():
		p = Game.player
		p.pos = spot["pos"]
		p.yaw = spot["yaw"]
		p.downed = true
		p.bleedout = 40.0
		_steps(2, {"mx": 0.0, "mz": 0.0, "jump": true})
		t.check(p.vault.is_empty() and not p.vault_ready, "enjambement : impossible à terre")

func _aim(t: Node) -> void:
	_new()
	var p := Game.player
	p.pos = Vector3(0.0, 0.0, 0.0)
	# marche à plat : on mesure la vitesse établie en visée puis hors visée
	var speeds: Array[float] = []
	for aim in [false, true]:
		_new()
		p = Game.player
		var x0 := p.pos
		_steps(60, {"mx": 0.0, "mz": 0.0})
		x0 = p.pos
		p.yaw = 0.0
		_steps(30, {"mx": 0.0, "mz": 1.0, "sprint": true, "aim": aim})
		speeds.append(Vector2(p.vel.x, p.vel.z).length())
	t.near(speeds[0], float(Config.at("player.sprintSpeed")), "visée : sprint hors visée", 0.05)
	t.near(speeds[1], float(Config.at("player.walkSpeed")) * Rules.AIM_SPEED_MULT, "visée : marche x0,6 et pas de sprint", 0.05)
	var a: WeaponArms = Game.arms
	a.aim = 0.0
	t.near(a.sens_zoom(), 1.0, "visée : souris normale hors visée")
	a.aim = 1.0
	t.near(a.sens_zoom(), 0.6, "visée : souris x0,6 sans lunette ni zoom")
	for id in ["sniper", "barrett", "svd"]:
		var cfg: Dictionary = Config.at("weapons.%s" % id)
		if cfg.has("adsFov"):
			a.give_weapon(id)
			t.near(a.sens_zoom(), 0.3, "visée : souris x0,3 avec lunette (%s)" % id)
	a.aim = 0.0

func _spread(t: Node) -> void:
	_new()
	var a: WeaponArms = Game.arms
	a.aim = 0.0
	Game.player.yaw = 0.0
	Game.player.pitch = 0.0
	var fwd := Game.player.forward()
	# étalement horizontal / vertical : le rapport d'écran élargit l'horizontale
	for fov in [60.0, 80.0, 100.0]:
		for aspect in [1.0, 16.0 / 9.0]:
			Game.settings.values["fov"] = fov
			Game.view_aspect = aspect
			var mx := 0.0
			var my := 0.0
			for _i in 400:
				var d: Vector3 = a._spread_dir(Game, 1.0)
				mx = maxf(mx, absf(d.x / -d.z))
				my = maxf(my, absf(d.y / -d.z))
			var th := tan(deg_to_rad(fov) / 2.0)
			t.check(mx > 0.9 * th * aspect and mx < 1.01 * th * aspect, "dispersion : horizontale fov %d aspect %.2f (%.3f pour %.3f)" % [fov, aspect, mx, th * aspect])
			t.check(my > 0.9 * th and my < 1.01 * th, "dispersion : verticale fov %d (%.3f pour %.3f)" % [fov, my, th])
	Game.settings.values["fov"] = 80.0
	Game.view_aspect = 16.0 / 9.0
	t.check(fwd.z < -0.99, "dispersion : visée vers -Z")

func _unstick(t: Node) -> void:
	_new()
	var p := Game.player
	var U: Unstick = Game.unstick
	t.check(U != null, "déblocage : module présent sur la carte")
	# pousser contre un mur : le joueur marche sur place
	p.pos = Vector3(p.pos.x, 0.0, p.pos.z)
	var wall := _find_wall_spot()
	t.check(not wall.is_empty(), "déblocage : un mur trouvé")
	if not wall.is_empty():
		print("déblocage : mur à %.2f,%.2f,%.1f (--pos=x,z,lacet en degrés)" % [wall["pos"].x, wall["pos"].z, rad_to_deg(wall["yaw"])])
	if wall.is_empty():
		return
	p.pos = wall["pos"]
	p.yaw = wall["yaw"]
	_steps(int(Config.at("unstick.stuckAfter") * 60) - 30, {"mx": 0.0, "mz": 1.0})
	t.check(not U.stuck, "déblocage : pas coincé avant %s s" % Config.at("unstick.stuckAfter"))
	_steps(60, {"mx": 0.0, "mz": 1.0})
	t.check(U.stuck, "déblocage : coincé après %s s contre un mur" % Config.at("unstick.stuckAfter"))
	t.check(Prompts.text(Game).contains("se débloquer"), "déblocage : invite (« %s »)" % Prompts.text(Game))
	var heard := [0]
	Game.unstuck.connect(func(_a: Vector2, _b: Vector2, _d: float, _c: bool) -> void: heard[0] += 1)
	var before := p.pos
	_steps(60, {"mx": 0.0, "mz": 1.0, "unstick": true})
	t.check(Prompts.text(Game).contains("Maintenir pour se débloquer"), "déblocage : invite avec décompte (« %s »)" % Prompts.text(Game))
	_steps(75, {"mx": 0.0, "mz": 1.0, "unstick": true})
	t.check(heard[0] == 1, "déblocage : déclenché après le maintien")
	t.check(not U.stuck and U.cool > 29.0, "déblocage : recharge de %s s" % Config.at("unstick.cooldown"))
	var spot_d := Vector2(p.pos.x - before.x, p.pos.z - before.z).length()
	t.check(spot_d > 0.1 and spot_d <= float(Config.at("unstick.maxDist")) + 1.0, "déblocage : déplacé de %.1f m" % spot_d)
	var zi := Game.world.zone_of(p.pos.x, p.pos.z)
	t.check(zi >= 0 and Game.world.is_zone_open(zi), "déblocage : arrivée dans une zone ouverte")
	var q := Game.collision.resolve(p.pos, float(Config.at("player.radius")))
	t.check(Vector2(q.x - p.pos.x, q.z - p.pos.z).length() < 0.06, "déblocage : arrivée sans poussée de collision")
	# recharge : coincé de nouveau, l'invite annonce l'attente
	p.pos = wall["pos"]
	p.yaw = wall["yaw"]
	_steps(300, {"mx": 0.0, "mz": 1.0})
	t.check(U.stuck and Prompts.text(Game).begins_with("Déblocage disponible dans"), "déblocage : recharge annoncée (« %s »)" % Prompts.text(Game))
	# en marche normale : jamais coincé
	_new()
	_steps(5)
	Game.player.yaw = 0.0
	_steps(600, {"mx": 0.0, "mz": 1.0})
	t.check(not Game.unstick.stuck or Game.player.pos.distance_to(Game.world.start_pos) < 5.0, "déblocage : pas d'invite en marche libre")

## Un point au pied d'un mur plein, face à lui (le joueur ne peut pas avancer).
func _find_wall_spot() -> Dictionary:
	var col: Collision = Game.collision
	var radius := float(Config.at("player.radius"))
	for s: Dictionary in col.segs:
		if int(s["vid"]) != 0 or float(s["h"]) < 3.0:
			continue
		var ex := float(s["bx"]) - float(s["ax"])
		var ez := float(s["bz"]) - float(s["az"])
		var l := sqrt(ex * ex + ez * ez)
		if l < 8.0:
			continue
		var mx := (float(s["ax"]) + float(s["bx"])) / 2.0
		var mz := (float(s["az"]) + float(s["bz"])) / 2.0
		for side: float in [1.0, -1.0]:
			var nx := -ez / l * side
			var nz := ex / l * side
			var pos := Vector3(mx + nx * 1.5, 0.0, mz + nz * 1.5)
			var zi := Game.world.zone_of(pos.x, pos.z)
			if zi < 0 or not Game.world.is_zone_open(zi):
				continue
			var q := col.resolve(pos, radius)
			if Vector2(q.x - pos.x, q.z - pos.z).length() > 0.01:
				continue
			var fl := {"y": 0.0, "region": 0}
			Game.world.levels.floor_at(pos.x, pos.z, 0.0, fl)
			if int(fl["region"]) != 0 or absf(float(fl["y"])) > 0.01:
				continue
			return {"pos": pos, "yaw": atan2(nx, nz)}
	return {}

# ------------------------------------------------------------------ stuck-scan : composantes, objets inaccessibles, poches-pièges (tools/stuck-scan.mjs)
func _label_near(nav: NavGrid, labels: PackedInt32Array, x: float, z: float) -> int:
	var ix := nav.cx(x)
	var iz := nav.cz(z)
	var best := 0
	var bd := 99
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var jx := ix + dx
			var jz := iz + dz
			if not nav.inside(jx, jz):
				continue
			var l := labels[nav.idx(jx, jz)]
			var d := dx * dx + dz * dz
			if l != 0 and d < bd:
				bd = d
				best = l
	return best

## Marche vers (x1, z1) avec le vrai PlayerSim.step ; renvoie la position finale.
func _walk(p: PlayerSim, x0: float, z0: float, x1: float, z1: float, secs: float) -> Vector2:
	const dt := 0.05
	p.pos = Vector3(x0, 0.0, z0)
	p.vel = Vector3.ZERO
	p.vy = 0.0
	p.pitch = 0.0
	p.region = 0
	var tm := 0.0
	for _i in int(secs / dt):
		var dx := x1 - p.pos.x
		var dz := z1 - p.pos.z
		if sqrt(dx * dx + dz * dz) < 0.3:
			break
		p.yaw = atan2(-dx, -dz)
		tm += dt
		p.step(dt, tm, {"mx": 0.0, "mz": 1.0}, Game.collision, Game.world.levels, Game.world)
	return Vector2(p.pos.x, p.pos.z)

func _stuck_scan(t: Node) -> void:
	_new()
	var w := Game.world
	var nav := w.nav
	var main := Game.unstick.main_label(w)
	var comp := nav.components()
	var labels: PackedInt32Array = comp["labels"]
	var sizes: Array = comp["sizes"]
	t.check(main > 0 and int(sizes[main]) > 500000, "stuck-scan : composante principale de %d cases" % int(sizes[main]))
	# poches : cases hors composante principale
	var acc: Dictionary = {}
	for iz in nav.nz:
		var row := iz * nav.nx
		for ix in nav.nx:
			var l := labels[row + ix]
			if l == 0 or l == main:
				continue
			var a: Dictionary = acc.get(l, {})
			if a.is_empty():
				a = {"id": l, "size": 0, "cells": PackedInt32Array()}
				acc[l] = a
			a["size"] += 1
			if a["cells"].size() < 4000:
				a["cells"].append(row + ix)
	var pockets: Array = []
	var R := 4
	for a: Dictionary in acc.values():
		var best := 1 << 30
		var pc := Vector2i(-1, -1)
		var mc := Vector2i(-1, -1)
		for i: int in a["cells"]:
			var ix := i % nav.nx
			var iz := i / nav.nx
			for dz in range(-R, R + 1):
				for dx in range(-R, R + 1):
					var jx := ix + dx
					var jz := iz + dz
					if jx < 0 or jz < 0 or jx >= nav.nx or jz >= nav.nz or labels[jz * nav.nx + jx] != main:
						continue
					var d := dx * dx + dz * dz
					if d < best:
						best = d
						pc = Vector2i(ix, iz)
						mc = Vector2i(jx, jz)
		a["gap"] = sqrt(float(best)) * nav.cell if pc.x >= 0 else -1.0
		a["pc"] = Vector2(nav.world_x(pc.x), nav.world_z(pc.y)) if pc.x >= 0 else Vector2.ZERO
		a["mc"] = Vector2(nav.world_x(mc.x), nav.world_z(mc.y)) if mc.x >= 0 else Vector2.ZERO
		pockets.append(a)
	# objets hors de la composante principale : inaccessibles à pied
	var unreachable: Array[String] = []
	var reach := func(x: float, z: float) -> bool:
		var ix := nav.cx(x)
		var iz := nav.cz(z)
		var rr := ceili(3.0 / nav.cell)
		for dz in range(-rr, rr + 1):
			for dx in range(-rr, rr + 1):
				var jx := ix + dx
				var jz := iz + dz
				if nav.inside(jx, jz) and labels[nav.idx(jx, jz)] == main and sqrt(float(dx * dx + dz * dz)) * nav.cell <= 3.0:
					return true
		return false
	if not reach.call(w.start_pos.x, w.start_pos.z):
		unreachable.append("départ")
	for st: Dictionary in w.objects["stations"]:
		if not reach.call(float(st["x"]), float(st["z"])):
			unreachable.append("borne (%.0f ; %.0f)" % [st["x"], st["z"]])
	for m: Dictionary in w.objects["machines"]:
		if not reach.call(float(m["pos"]["x"]), float(m["pos"]["z"])):
			unreachable.append("machine %s (%.0f ; %.0f)" % [m["type"], m["pos"]["x"], m["pos"]["z"]])
	for ww: Dictionary in w.objects["wallWeapons"]:
		if not reach.call(float(ww["pos"]["x"]), float(ww["pos"]["z"])):
			unreachable.append("arme au mur %s" % ww["id"])
	for v: Dictionary in w.objects["vehicleSpawns"]:
		if not reach.call(float(v["x"]), float(v["z"])):
			unreachable.append("moto %s" % v["type"])
	for d: Dictionary in w.doors:
		for pt: Array in d["points"]:
			if not reach.call(float(pt[0]), float(pt[1])):
				unreachable.append("porte %d (%.0f ; %.0f)" % [d["id"], pt[0], pt[1]])
	print("stuck-scan : %d composantes, principale %d cases (%.0f m2), %d poches dont %d à moins de 3 m ; hors composante principale : %s" % [
		sizes.size() - 1, int(sizes[main]), float(sizes[main]) * nav.cell * nav.cell, pockets.size(), pockets.filter(func(k: Dictionary) -> bool: return float(k["gap"]) >= 0.0 and float(k["gap"]) <= 3.0).size(),
		"aucun" if unreachable.is_empty() else ", ".join(unreachable)])
	t.check(unreachable.is_empty(), "stuck-scan : objets inaccessibles à pied : %s" % ", ".join(unreachable))
	# poches-pièges : un joueur y entre-t-il et en sort-il ?
	var p := Game.player
	var tested := 0
	var enterable := 0
	var trapped: Array[String] = []
	for k: Dictionary in pockets:
		if float(k["gap"]) < 0.0 or float(k["gap"]) > 3.0:
			continue
		tested += 1
		var pc: Vector2 = k["pc"]
		var mc: Vector2 = k["mc"]
		var entered := false
		var failed := false
		var fail_at := Vector2.ZERO
		for a in 8:
			var ang := a * PI / 4.0
			var sx := pc.x + cos(ang) * 3.2
			var sz := pc.y + sin(ang) * 3.2
			if _label_near(nav, labels, sx, sz) != main:
				continue
			var q := Game.collision.resolve(Vector3(sx, 0.0, sz), 0.4)
			if Vector2(q.x - sx, q.z - sz).length() > 0.05:
				continue
			var e := _walk(p, sx, sz, pc.x, pc.y, 3.0)
			if e.distance_to(pc) > 0.9 and _label_near(nav, labels, e.x, e.y) != int(k["id"]):
				continue
			entered = true
			var out := _walk(p, e.x, e.y, mc.x, mc.y, 3.0)
			var ok := _label_near(nav, labels, out.x, out.y) == main or out.distance_to(mc) < 0.9
			var tt := 0
			while tt < 16 and not ok:
				var a2 := tt * PI / 8.0
				out = _walk(p, e.x, e.y, e.x + cos(a2) * 6.0, e.y + sin(a2) * 6.0, 3.0)
				ok = _label_near(nav, labels, out.x, out.y) == main or out.distance_to(mc) < 0.9
				tt += 1
			if not ok:
				failed = true
				fail_at = out
				break
		if entered:
			enterable += 1
		if failed:
			trapped.append("poche %d (%.0f cases) en (%.1f ; %.1f), bloqué en (%.2f ; %.2f)" % [k["id"], k["size"], pc.x, pc.y, fail_at.x, fail_at.y])
	print("stuck-scan : %d poches proches testées, %d où l'on peut entrer, %d poches-pièges" % [tested, enterable, trapped.size()])
	for tr in trapped.slice(0, 12):
		print("  piège : ", tr)
	t.check(trapped.is_empty(), "stuck-scan : poches-pièges : %d (voir la liste)" % trapped.size())

# ------------------------------------------------------------------ pause sur perte de focus
func _focus(t: Node) -> void:
	var m: CanvasLayer = load("res://scenes/ui/menus.gd").new()
	t.add_child(m)
	Game.new_game(3, "arena", [Rules.J1_WEAPON])
	m.open_title()
	t.check(not m.focus_lost(), "focus : rien à faire sur le titre")
	m.begin_game()
	t.check(m.in_game and Game.playing and m.stack.layers.is_empty(), "focus : partie en cours")
	t.check(m.focus_lost() and m.stack.top() == UiStack.PAUSE, "focus : la perte de focus ouvre la pause")
	t.check(not m.focus_lost() and m.stack.layers.size() == 1, "focus : pas de seconde pause")
	m.escape()
	t.check(m.stack.layers.is_empty(), "focus : Échap reprend la partie")
	m.toggle_map()
	t.check(not m.focus_lost(), "focus : la carte ouverte ne passe pas en pause")
	Game.debug_open = true
	t.check(m.escape() == "debug" and not Game.debug_open, "debug : Échap ferme le menu debug avant la pause")
	m.queue_free()

# ------------------------------------------------------------------ données cuites, textes, tir en vue externe
func _assets_and_texts(t: Node) -> void:
	for c: Dictionary in CharacterDefs.LIST:
		t.check(FileAccess.file_exists("res://assets/portraits/%s.png" % c["id"]), "portrait : %s" % c["id"])
	var vj: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/world/vehicles.json"))
	var sigs: Array = vj["tram"].get("signals", [])
	t.check(sigs.size() == 4, "aiguillage : 4 têtes de signal cuites (%d)" % sigs.size())
	for sg: Dictionary in sigs:
		t.near(sg["tx"] * sg["tx"] + sg["tz"] * sg["tz"], 1.0, "signal %s : cap unitaire" % sg["arm"], 1e-3)
	# rails : les surfaces de l'instance « rails » portent des couleurs de sommet (cuites par la version courante de tools/bake-world.page.js)
	if FileAccess.file_exists("res://data/world/instances.bin"):
		var f := FileAccess.open("res://data/world/instances.bin", FileAccess.READ)
		f.get_buffer(4)
		var hl := f.get_32()
		var head: Dictionary = JSON.parse_string(f.get_buffer(hl).get_string_from_utf8())
		var rails := 0
		var with_col := 0
		for m: Dictionary in head["meshes"]:
			if String(m["name"]).to_lower().contains("rail"):
				rails += 1
				for sf: Dictionary in m["surfaces"]:
					if sf.has("col"):
						with_col += 1
		t.check(rails > 0, "rails : une instance de rails (%d)" % rails)
		t.check(with_col > 0, "rails : couleurs de sommet cuites (%d surfaces) : sans elles les rails sont blancs" % with_col)
	# invites des véhicules : les lettres suivent les liaisons
	var B := Keybinds.new()
	var txt := Prompts._keys("E Se lever · O portes (fermées) · H gong · Espace frein d'urgence · B aiguillage", B)
	t.check(txt.contains("[O] portes") and txt.contains("[H] gong") and txt.contains("[B] aiguillage") and txt.begins_with("[E] "), "invites : touches du tram suivent les liaisons (« %s »)" % txt)
	# tir en vue externe : le rayon part du pilote (caméra avancée de sa distance au pivot)
	_new()
	t.near(Game.arms._external_dist(Game), 0.0, "tir : vue à la première personne, origine à l'oeil")
	Game.rides.cam.dist = 6.0
	t.near(Game.arms._external_dist(Game), 6.0 if Game.rides.cam.external() else 0.0, "tir : vue externe, origine avancée de la distance de la caméra")
	Game.rides.cam.dist = 0.0
	# le plan cuit du JS (eau, passages dorés) remplace celui de la grille quand il est là
	var img := MapImage.build(Game.world)
	var crop: Dictionary = Game.world.objects["mapCrop"]
	var sc := float(Game.world.objects["mapView"]["scale"])
	t.check(img.get_width() == int(round((float(crop["x1"]) - float(crop["x0"])) * sc)), "plan : largeur du rectangle découpé")
	if FileAccess.file_exists(MapImage.BAKED):
		var water := 0
		for y in range(0, img.get_height(), 4):
			for x in range(0, img.get_width(), 4):
				var c := img.get_pixel(x, y)
				if c.b8 > c.r8 + 20 and c.b8 > 50:
					water += 1
		t.check(water > 500, "plan : le plan du JS montre l'eau (%d échantillons bleus)" % water)

## Une partie de bot courte (3 manches) : pas de pas trop long, manche 1 à 3 jouées, rien ne reste en vie, aucune erreur.
func _mini_soak(t: Node) -> void:
	Game.new_game(21, "strasbourg", Config.at("startWeapons", []))
	Game.flow_threaded = false
	var bot := SoakBot.new(21)
	bot.setup(Game)
	var worst := 0
	var total := 0
	var steps := 0
	var round_start := {}
	for i in 60 * 400:
		var input := bot.think(Game)
		var t0 := Time.get_ticks_usec()
		Game.step(1.0 / 60.0, input)
		var us := Time.get_ticks_usec() - t0
		bot.after_step(Game, us)
		worst = maxi(worst, us)
		total += us
		steps += 1
		if not round_start.has(Game.round_number):
			round_start[Game.round_number] = Game.time
		if Game.round_number >= 4:
			break
	t.check(Game.round_number >= 4, "partie de bot : manche 4 atteinte en moins de 400 s de jeu (t = %.0f s)" % Game.time)
	t.check(not Game.over and not Game.player.dead, "partie de bot : le joueur est en vie")
	t.check(Game.kills >= 7 + 10 + 13 - 3, "partie de bot : %d tués après trois manches" % Game.kills)
	t.check(total / float(maxi(1, steps)) < 4000.0, "partie de bot : pas moyen %.2f ms (cible 4 ms)" % (total / float(maxi(1, steps)) / 1000.0))
	Game._stop_flow_thread()
