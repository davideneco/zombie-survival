class_name Warmup
extends RefCounted
## v0.19.0 : préchauffage pendant l'écran de chargement, sous le voile. Godot compile les pipelines de rendu (et charge ressources et sons) à la PREMIÈRE apparition
## de chaque chose à l'écran : sur un poste lent ou sans cache de pipelines (premier lancement sous Windows) chaque première (premier bonus, première arme de la boîte,
## premier type de zombie, première explosion…) était un gel de plusieurs dizaines à centaines de ms en pleine partie. Mesure d'origine (journal --perf-log, caches
## froids) : 168 pipelines compilés d'un coup à la première image de jeu (442 ms), 1,1 s à 0,2 s de jeu, puis +3 pipelines au premier bonus (16 ms) et à la première
## offre de la boîte (30 ms), même sur un RTX 3060.
## Ici : toutes les choses visibles sont instanciées UNE fois en anneau autour du joueur, la caméra fait le tour (4 caps) et le tour des points d'intérêt (machines, véhicules),
## quelques images sont dessinées sous le voile, puis tout est retiré. La simulation n'est pas touchée (sims jetables, aucune graine de Game consommée).
##  - sons : tous chargés (Sfx.warm_all) et voix créées ;
##  - pools : instances de zombies (ZombieModels.warm), grilles de navigation des étages (une par image) ;
##  - rendu : zombies de tous types et états, bonus, armes (modèles, teintes du Pack-a-Punch), nounours, particules, taches, explosion, éclair de bouche, popups du HUD.

const WeaponModels := preload("res://scenes/weapon_models.gd")
const FRAMES_PER_STOP := 2
const ZOMBIE_POOL := {"basic": 26, "arm": 6, "chubby": 6}

var done := false
var frames := 0
var nodes_made := 0
var seconds := 0.0
var pipelines_before := 0
var pipelines_after := 0
var _host: Node3D
var _cam: Camera3D
var _root: Node3D
var _views: Array[Node3D] = []
var _rng := RandomNumberGenerator.new()

static func pipeline_total() -> int:
	var n := 0
	for k in [RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_CANVAS, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_MESH,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SURFACE, RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_DRAW,
			RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SPECIALIZATION]:
		n += RenderingServer.get_rendering_info(k)
	return n

## host : la scène principale ; cam : la caméra du jeu ; fx / weapon_view / machines_view / hud : vues de la partie ; make_view : Callable(ZombieSim) -> Node3D (vue de zombie
## ordinaire) ; progress : Callable(texte, fraction) pour la barre. Termine en rendant les choses comme avant.
func run(host: Node3D, cam: Camera3D, fx: Node3D, weapon_view: Node3D, machines_view: Node3D, hud: CanvasLayer, make_view: Callable, progress: Callable) -> void:
	var t0 := Time.get_ticks_msec()
	_host = host
	_cam = cam
	_rng.seed = 12345
	pipelines_before = pipeline_total()
	var tree := host.get_tree()
	var headless := DisplayServer.get_name() == "headless"
	# 1. sons, pools, grilles d'étage
	var pt := PerfLog.t()
	Sfx.warm_all()
	PerfLog.add(&"charge", pt)
	await progress.call("Préchauffage : sons", 0.05)
	await tree.process_frame
	await _warm_pools(tree, progress)
	await _warm_navs(tree, progress)
	# 2. choses visibles, en anneau autour du joueur
	var p0: Vector3 = Game.player.pos
	_root = Node3D.new()
	_root.name = "Warmup"
	host.add_child(_root)
	_build_ring(p0, fx, weapon_view, machines_view, hud, make_view)
	await progress.call("Préchauffage : effets", 0.4)
	if not headless:
		# 3. tour d'horizon sous le voile (4 caps) puis tour des points d'intérêt
		var eye := p0 + Vector3(0, float(Config.at("player.eye")), 0)
		for h in 4:
			_cam.position = eye
			_cam.rotation = Vector3(0.0, float(h) * PI / 2.0, 0.0)
			await _frames(tree, FRAMES_PER_STOP)
			await progress.call("Préchauffage : rendu", 0.4 + 0.1 * (h + 1))
		if machines_view != null:
			machines_view.warm_show(true)
		var stops := _stops()
		for i in stops.size():
			_cam.position = stops[i][0]
			_cam.rotation = Vector3(stops[i][2], stops[i][1], 0.0)
			await _frames(tree, FRAMES_PER_STOP)
			await progress.call("Préchauffage : rendu", 0.8 + 0.2 * float(i + 1) / stops.size())
	# 4. on range
	if machines_view != null:
		machines_view.warm_show(false)
	for v in _views:
		if is_instance_valid(v):
			v.get_parent().remove_child(v)
			v.free()
	_views.clear()
	_root.get_parent().remove_child(_root)
	_root.free()
	_root = null
	if fx != null:
		fx.clear()
	await tree.process_frame
	pipelines_after = pipeline_total()
	frames += 1
	seconds = (Time.get_ticks_msec() - t0) / 1000.0
	done = true
	PerfLog.event("préchauffage terminé : %.2f s, %d images, pipelines %d -> %d" % [seconds, frames, pipelines_before, pipelines_after])

func _frames(tree: SceneTree, n: int) -> void:
	for _i in n:
		await tree.process_frame
		frames += 1

## Zombies prêts à l'avance : une instance par rigs attendus (le pool se remplit une image sur trois).
func _warm_pools(tree: SceneTree, progress: Callable) -> void:
	if ZombieModels.use_old:
		return
	var n := 0
	for model: String in ZOMBIE_POOL:
		var made: Array = []
		for _i in int(ZOMBIE_POOL[model]):
			made.append(ZombieModels.acquire(model, model == "arm"))
			n += 1
			if n % 4 == 0:
				await tree.process_frame
		for r in made:
			ZombieModels.release(r)
	await progress.call("Préchauffage : zombies", 0.2)

## Grilles de navigation des étages : une par image (avant : à la première montée d'un joueur avec des zombies derrière, 575 ms d'un coup).
func _warm_navs(tree: SceneTree, progress: Callable) -> void:
	if Game.world == null or Game.world.levels == null:
		return
	var lv: Levels = Game.world.levels
	for r in lv.regions.size():
		lv.nav_of(r)
		await tree.process_frame
	await progress.call("Préchauffage : étages", 0.3)

func _ring(p0: Vector3, i: int, n: int, radius: float) -> Vector3:
	var a := TAU * float(i) / float(maxi(1, n))
	return p0 + Vector3(sin(a), 0.0, -cos(a)) * radius

func _add(n: Node3D, pos: Vector3) -> void:
	n.position = pos
	_root.add_child(n)
	nodes_made += 1

func _build_ring(p0: Vector3, fx: Node3D, weapon_view: Node3D, machines_view: Node3D, hud: CanvasLayer, make_view: Callable) -> void:
	var total := 0
	# zombies : types x états
	var kinds := ["normal", "run", "limp", "crawl", "armored", "bloat"]
	var states := ["", "death", "headless", "hit", "ground"]
	var count := kinds.size() * states.size()
	for si in states.size():
		for ki in kinds.size():
			var z := ZombieSim.new()
			z.id = 900000 + total
			z.rng = _rng
			var pos := _ring(p0, total, count, 5.0 + float(si % 2) * 2.5)
			z.pos = pos
			z.speed = 3.4 if kinds[ki] == "run" else 1.5
			z.health = 100.0
			z.max_health = 100.0
			z.init_traits(_rng)
			match kinds[ki]:
				"crawl":
					z.make_crawler()
				"armored", "bloat":
					z.make_kind(kinds[ki])
			z.limp = kinds[ki] == "limp"
			z.runner = kinds[ki] == "run"
			z.yaw = _rng.randf() * TAU
			match states[si]:
				"death":
					z.damage(1.0e9, false)
				"headless":
					z.damage(1.0e9, true)
				"hit":
					z.damage(1.0, false)
				"ground":
					z.start_ground_spawn(pos, z.yaw)
			var v: Node3D = make_view.call(z)
			if v != null:
				_views.append(v)
			total += 1
	# bonus au sol
	if machines_view != null:
		var t := 0
		for type: String in machines_view.POWERUP_COLORS.keys():
			var pu: Node3D = machines_view._make_powerup({"type": type})
			_add(pu, _ring(p0, t, 5, 3.2) + Vector3(0, 1.0, 0))
			t += 1
		_add(machines_view._make_teddy(), _ring(p0, 2, 7, 3.6) + Vector3(0, 0.6, 0))
	# v0.28.0 : wall weapon panel and ammo station (their shaders, labels and silhouette)
	_add(ShopView.sample(), _ring(p0, 5, 8, 3.4))
	# armes : modèles normaux (chargement des maillages) et un modèle par niveau du Pack-a-Punch
	var ids: Array = WeaponModels.table().keys()
	for i in ids.size():
		var m := WeaponModels.build(String(ids[i]), null)
		HandsRig.new().build(m, String(ids[i]))   # mains et manches : maillages et matériaux (v0.20.2)
		_add(m, _ring(p0, i, ids.size(), 2.4 + float(i % 3) * 0.5) + Vector3(0, 1.3 + float(i % 2) * 0.3, 0))
	for lv in range(1, 4):
		var tint: Variant = Config.color(int(Config.pap_levels[lv]["color"]))
		_add(WeaponModels.build(String(ids[0]), tint), _ring(p0, lv * 3, 11, 2.8) + Vector3(0, 1.5, 0))
	# v0.21.2 : le personnage choisi (fichier lu et pipelines de la peau compilés avant la première vue à la troisième personne : moto, vélo, rame), quatre poses autour du joueur
	var cid := String(CharacterDefs.of_slot(int(Game.settings.get_value("char")))["id"])
	var poses := ["Idle", "Sit_Moto", "Death", "Sprint"]
	for i in poses.size():
		var cm := CharacterModel.create(cid)
		if cm == null:
			break
		_add(cm, _ring(p0, i, poses.size(), 3.2))
		cm.rotation.y = TAU * float(i) / float(poses.size())
		cm.pose(poses[i], 0.4)
		if i == 0:
			# v0.31.0 : arme, couteau et hache tels que la 3e personne les montre (couche du monde, ombres) : leurs pipelines ne se compilent pas au premier coup
			var PA := load("res://scenes/player_avatar.gd")
			var MM := load("res://scenes/melee_models.gd")
			var held: Array = [WeaponModels.build(String(ids[0]), null), MM.build_knife(), MM.build_axe()]
			for k in held.size():
				var n: Node3D = held[k]
				PA._world(n, 0.10 if k == 0 else 0.0)
				cm.add_child(n)
				n.position = Vector3(0.25 - 0.25 * k, 1.1, 0.3)
	# particules, taches, explosion
	if fx != null:
		var c := p0 + Vector3(0, 0, -4.0)
		fx.blood(c + Vector3(0, 1.2, 0), true)
		fx.blood(c + Vector3(1, 1.0, 0))
		fx.dust(c + Vector3(-1, 1.0, 0))
		fx.dirt(c + Vector3(0, 0.3, 1.5), 18)
		fx.glass(c + Vector3(2, 1.5, 0), 0.0, 1.0)
		fx.decal(c.x, c.z + 2.0)
		fx.wall_decal(c + Vector3(-2, 1.4, 0), 1.0, 0.0)
		fx.explosion(p0 + Vector3(3.0, 0.0, -3.0), 5.0, 0xff8a2a)
	if weapon_view != null:
		weapon_view._on_shot(Vector3.ZERO, Vector3.ZERO)
		weapon_view._on_explosion(p0 + Vector3(-3.0, 1.0, -3.0), 2.0, 0xff8a2a)
	if hud != null:
		hud.popup("+60")
		hud.popup("+100", "head")
		hud.popup("MUNITIONS MAX", "bonus")
		hud.show_hit(true)
		hud.toast("...", 0.1)

## Points d'intérêt (position de caméra, cap, tangage) : machines, véhicules, première rame.
func _stops() -> Array:
	var out: Array = []
	var eye_h := float(Config.at("player.eye"))
	if Game.machines != null:
		var got := {}
		for m: Dictionary in Game.machines.list:
			if String(m["type"]) in ["box", "pap", "perk"] and not got.has(m["type"]):
				got[m["type"]] = true
				var yaw := float(m["yaw"])
				var mp := Vector3(float(m["pos"]["x"]), float(m["pos"]["y"]), float(m["pos"]["z"]))
				out.append([mp + Vector3(sin(yaw), 0.0, cos(yaw)) * 3.0 + Vector3(0, eye_h, 0), yaw, 0.0])
	if Game.rides != null:
		var seen := {}
		for v in Game.rides.vehicles:
			if not seen.has(v.type):
				seen[v.type] = true
				out.append([Vector3(v.x, eye_h, v.z) + Vector3(3.0, 0, 0), PI / 2.0, 0.0])
		if not Game.rides.trams.is_empty():
			var tr: TramSim = Game.rides.trams[0]
			var nose: Dictionary = tr.mods[tr.n - 1]
			var np := Vector3(nose["x"], 0.0, nose["z"])
			out.append([np + Vector3(nose["tx"], 0.0, nose["tz"]) * 9.0 + Vector3(0, eye_h, 0), atan2(float(nose["tx"]), float(nose["tz"])), 0.0])
	return out
