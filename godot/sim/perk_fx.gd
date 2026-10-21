class_name PerkFx
extends RefCounted
## v0.27.0 : les NEUF nouveaux atouts du port (absents du JS), inspirés des atouts de la série Call of Duty Zombies sous des noms originaux,
## et la limite d'atouts portés. Code pur, sans nœud : Game possède une instance (`Game.pfx`) et l'appelle aux bons moments ; les vues
## lisent son état (gouttes du Vautour, tombe, Bastion, invulnérabilité) et écoutent Game.perk_event (sons, effets).
##
##   id               nom                inspiré de          effet
##   deadshot         ŒIL-DE-LYNX        Deadshot Daiquiri   tête x1,5 (headMult de l'arme), dispersion x0,65 (WeaponState.refresh)
##   electriccherry   CERISE-FOUDRE      Electric Cherry     recharger libère une décharge autour du joueur, d'autant plus forte que le chargeur était vide
##   widowswine       VEUVE NOIRE        Widow's Wine        frappé par un zombie : toile qui ralentit les zombies proches (recharge) ; couteau : ralentit sa cible
##   vultureaid       VAUTOUR            Vulture Aid         une part des zombies tués lâche une goutte : munitions (toutes les armes) ou points
##   tombstone        PIERRE TOMBALE     Tombstone           à terre : les atouts perdus (sauf elle et la Réanimation rapide) restent dans une tombe,
##                                                           au sol, à récupérer après 5 s et avant 90 s (dans la limite d'atouts)
##   dyingwish        ULTIME VOLONTÉ     Dying Wish          un coup fatal laisse à 1 PV, invulnérable quelques secondes (longue recharge)
##   stronghold       BASTION            Stronghold          immobile (dans un rayon de 3 m depuis 1,5 s) : dégâts reçus x0,7
##   deathperception  SIXIÈME SENS       Death Perception    radar 1,6 fois plus large ; 10 % de coups critiques (dégâts x2) aux armes à feu
##   bandolier        CARTOUCHIÈRE       Bandolier Bandit    réserve maximale de munitions x1,5 (WeaponState.refresh)
## Non retenus (raisons dans docs/GODOT_PORT.md, v0.27.0) : Who's Who et la PhD Slider (doublons de la Réanimation rapide / du PHD Flopper en solo),
## les boules de gomme (système d'objets à part), Timeslip, Victorious Tortoise, Ammo Regen, Blood Wolf.
##
## Limite : `slots` atouts portés (4) ; le distributeur refuse au-delà. La Bénédiction de l'Aube (finale) donne TOUS les atouts sans limite.
## Tout l'équilibrage est dans CONFIG (Config.at("perkFx.*"), section propre au port ajoutée par autoload/config.gd).

## Fiches des distributeurs (fusionnées dans Config.at("perks") : nom, description, prix, couleur, lettre du logo).
const PERKS := {
	"deadshot": {"name": "ŒIL-DE-LYNX", "desc": "Tirs à la tête +50 % · dispersion -35 %", "price": 1500, "color": "#6e1f2a", "letter": "L"},
	"electriccherry": {"name": "CERISE-FOUDRE", "desc": "Recharger libère une décharge électrique (chargeur vide : plus forte)", "price": 2000, "color": "#ff4f8b", "letter": "F"},
	"widowswine": {"name": "VEUVE NOIRE", "desc": "Frappé : une toile englue les zombies proches · couteau collant", "price": 4000, "color": "#3a1846", "letter": "N"},
	"vultureaid": {"name": "VAUTOUR", "desc": "Les zombies lâchent parfois des munitions ou des points", "price": 3000, "color": "#7a8b2a", "letter": "V"},
	"tombstone": {"name": "PIERRE TOMBALE", "desc": "À terre : vos atouts restent dans une tombe à récupérer", "price": 2000, "color": "#5f6368", "letter": "T"},
	"dyingwish": {"name": "ULTIME VOLONTÉ", "desc": "Un coup fatal vous laisse debout, invulnérable 4 s (recharge 150 s)", "price": 4000, "color": "#d9d4c5", "letter": "U"},
	"stronghold": {"name": "BASTION", "desc": "Immobile (3 m) : -30 % de dégâts reçus", "price": 2500, "color": "#2c4f7c", "letter": "B"},
	"deathperception": {"name": "SIXIÈME SENS", "desc": "Radar élargi · 10 % de coups critiques (dégâts x2)", "price": 2000, "color": "#1fb5a3", "letter": "6"},
	"bandolier": {"name": "CARTOUCHIÈRE", "desc": "Réserve de munitions +50 %", "price": 1500, "color": "#9a5b25", "letter": "C"},
}
const CONFIG := {
	"slots": 4,
	"deadshot": {"headMult": 1.5, "spreadMult": 0.65},
	"bandolier": {"reserveMult": 1.5},
	"electriccherry": {"radius": 2.5, "radiusEmpty": 2.0, "healthFrac": 1.25, "minEmpty": 0.15, "cooldown": 2.5},
	"widowswine": {"radius": 5.0, "slow": 0.35, "time": 6.0, "cooldown": 20.0, "knifeSlow": 0.5, "knifeTime": 3.0},
	"vultureaid": {"chance": 0.12, "ammoShare": 0.6, "ammoFrac": 0.2, "points": 50, "life": 20.0, "pickup": 1.6},
	"tombstone": {"life": 90.0, "pickup": 1.8, "arm": 5.0},
	"dyingwish": {"invuln": 4.0, "cooldown": 150.0},
	"stronghold": {"radius": 3.0, "settle": 1.5, "damageMult": 0.7},
	"deathperception": {"critChance": 0.10, "critMult": 2.0, "radarMult": 1.6},
}
const RNG_SEED_OFFSET := 7919   ## tirages propres aux atouts (critiques, gouttes) : la graine de la partie + ce décalage, sans toucher aux autres

var rng := RandomNumberGenerator.new()
var cherry_cd := 0.0
var web_cd := 0.0
var wish_cd := 0.0
var invuln := 0.0               ## Ultime Volonté : secondes d'invulnérabilité restantes
var anchor := Vector2.INF       ## Bastion : point d'ancrage
var settle := 0.0               ## Bastion : secondes passées près de l'ancre
var drops: Array = []           ## Vautour : [{ id, pos (Vector3), type "ammo"|"points", life }]
var tomb: Dictionary = {}       ## Pierre tombale : { pos (Vector3), perks (Array), life } ; vide si aucune
var _next := 1
var stats := {"cherry": 0, "cherry_kills": 0, "webs": 0, "slowed": 0, "drops": 0, "picked": 0, "crits": 0, "wishes": 0, "tombs": 0, "restored": 0, "blocked": 0.0}

static func cfg(path: String) -> Variant:
	return Config.at("perkFx.%s" % path, _at(CONFIG, path))

static func _at(d: Dictionary, path: String) -> Variant:
	var cur: Variant = d
	for k in path.split("."):
		cur = cur[k] if typeof(cur) == TYPE_DICTIONARY and cur.has(k) else null
	return cur

static func slots() -> int:
	return int(cfg("slots"))

static func is_new(id: String) -> bool:
	return PERKS.has(id)

func _init(seed_value := 0) -> void:
	rng.seed = seed_value + RNG_SEED_OFFSET

func reset() -> void:
	cherry_cd = 0.0
	web_cd = 0.0
	wish_cd = 0.0
	invuln = 0.0
	anchor = Vector2.INF
	settle = 0.0
	drops.clear()
	tomb = {}

## Bastion actif : le joueur est resté dans `radius` m depuis `settle` s.
func anchored(g: Node) -> bool:
	return g.arms.perks.get("stronghold", false) and settle >= float(cfg("stronghold.settle"))

# ------------------------------------------------------------------ pas
func step(g: Node, dt: float) -> void:
	cherry_cd = maxf(0.0, cherry_cd - dt)
	web_cd = maxf(0.0, web_cd - dt)
	wish_cd = maxf(0.0, wish_cd - dt)
	invuln = maxf(0.0, invuln - dt)
	var p: PlayerSim = g.player
	var here := Vector2(p.pos.x, p.pos.z)
	if g.arms.perks.get("stronghold", false) and not p.downed:
		if anchor == Vector2.INF or here.distance_to(anchor) > float(cfg("stronghold.radius")):
			anchor = here
			settle = 0.0
		else:
			settle += dt
	else:
		anchor = Vector2.INF
		settle = 0.0
	for i in range(drops.size() - 1, -1, -1):
		var d: Dictionary = drops[i]
		d["life"] = float(d["life"]) - dt
		var dp: Vector3 = d["pos"]
		if not p.downed and not p.dead and Vector2(dp.x - p.pos.x, dp.z - p.pos.z).length() < float(cfg("vultureaid.pickup")):
			_pick(g, d)
			drops.remove_at(i)
		elif float(d["life"]) <= 0.0:
			drops.remove_at(i)
	if not tomb.is_empty():
		tomb["life"] = float(tomb["life"]) - dt
		tomb["arm"] = maxf(0.0, float(tomb["arm"]) - dt)
		var tp: Vector3 = tomb["pos"]
		if float(tomb["arm"]) <= 0.0 and not p.downed and not p.dead and Vector2(tp.x - p.pos.x, tp.z - p.pos.z).length() < float(cfg("tombstone.pickup")):
			var got: Array[String] = []
			for id: String in tomb["perks"]:
				if not g.arms.perks.get(id, false) and (g.blessed or g.arms.perks.size() < slots()):
					g.add_perk(id)
					got.append(id)
			stats["restored"] = int(stats["restored"]) + got.size()
			g.announce("PIERRE TOMBALE", "Atouts récupérés : %d" % got.size())
			g.perk_event.emit("tomb_pick", {"pos": tp, "perks": got})
			tomb = {}
		elif float(tomb["life"]) <= 0.0:
			g.perk_event.emit("tomb_gone", {"pos": tp})
			tomb = {}

# ------------------------------------------------------------------ dégâts reçus (Bastion, Ultime Volonté)
## Dégâts qu'encaisse vraiment le joueur (après Bastion et invulnérabilité) ; -1 : l'Ultime Volonté a sauvé le joueur (pas de dégâts à appliquer).
func filter_damage(g: Node, amount: float) -> float:
	var p: PlayerSim = g.player
	if p.dead or p.downed:
		return amount
	if invuln > 0.0:
		stats["blocked"] = float(stats["blocked"]) + amount
		return 0.0
	if anchored(g):
		var m := float(cfg("stronghold.damageMult"))
		stats["blocked"] = float(stats["blocked"]) + amount * (1.0 - m)
		amount *= m
	if amount >= p.health and g.arms.perks.get("dyingwish", false) and wish_cd <= 0.0:
		p.health = 1.0
		p.last_hurt = g.time
		invuln = float(cfg("dyingwish.invuln"))
		wish_cd = float(cfg("dyingwish.cooldown"))
		stats["wishes"] = int(stats["wishes"]) + 1
		g.announce("ULTIME VOLONTÉ", "Invulnérable %d s !" % roundi(invuln))
		g.perk_event.emit("wish", {"pos": p.pos})
		return -1.0
	return amount

# ------------------------------------------------------------------ Veuve noire
## Un zombie vient de frapper le joueur : la toile part si la recharge le permet.
func on_struck(g: Node) -> void:
	if not g.arms.perks.get("widowswine", false) or web_cd > 0.0 or g.player.dead:
		return
	web_cd = float(cfg("widowswine.cooldown"))
	var R := float(cfg("widowswine.radius"))
	var n := 0
	for z: ZombieSim in g.zombies:
		if z.dead or z.spawn_t > 0.0:
			continue
		if Vector2(z.pos.x - g.player.pos.x, z.pos.z - g.player.pos.z).length() < R:
			z.slow(float(cfg("widowswine.slow")), float(cfg("widowswine.time")))
			n += 1
	stats["webs"] = int(stats["webs"]) + 1
	stats["slowed"] = int(stats["slowed"]) + n
	g.perk_event.emit("web", {"pos": g.player.pos, "radius": R, "count": n})

func on_knife(g: Node, z: ZombieSim) -> void:
	if g.arms.perks.get("widowswine", false) and not z.dead:
		z.slow(float(cfg("widowswine.knifeSlow")), float(cfg("widowswine.knifeTime")))

# ------------------------------------------------------------------ Cerise-foudre
## Début d'un rechargement de l'arme w (ammo = balles restantes AVANT de recharger).
func on_reload(g: Node, w: WeaponState) -> void:
	if not g.arms.perks.get("electriccherry", false) or cherry_cd > 0.0:
		return
	var mag := maxi(1, int(w.cfg["magSize"]))
	var empty := 1.0 - float(w.ammo) / float(mag)
	if empty < float(cfg("electriccherry.minEmpty")):
		return
	cherry_cd = float(cfg("electriccherry.cooldown"))
	var R := float(cfg("electriccherry.radius")) + float(cfg("electriccherry.radiusEmpty")) * empty
	var dmg := float(g.zombie_health_at(maxi(1, g.round_number))) * float(cfg("electriccherry.healthFrac")) * empty
	var hit := 0
	var kills := 0
	var p: Vector3 = g.player.pos
	for z: ZombieSim in g.zombies.duplicate():
		if z.dead or z.spawn_t > 0.0 or not z.targetable():
			continue
		if Vector2(z.pos.x - p.x, z.pos.z - p.z).length() < R and absf(z.pos.y - p.y) < 2.5:
			hit += 1
			if g.hit_zombie(z, false, dmg, 1.0, false, {"px": p.x, "pz": p.z}):
				kills += 1
	stats["cherry"] = int(stats["cherry"]) + 1
	stats["cherry_kills"] = int(stats["cherry_kills"]) + kills
	g.perk_event.emit("cherry", {"pos": p, "radius": R, "power": empty, "hit": hit})

# ------------------------------------------------------------------ Sixième sens
## Multiplicateur de dégâts d'une balle (critique).
func crit_mult(g: Node) -> float:
	if not g.arms.perks.get("deathperception", false):
		return 1.0
	if rng.randf() < float(cfg("deathperception.critChance")):
		stats["crits"] = int(stats["crits"]) + 1
		return float(cfg("deathperception.critMult"))
	return 1.0

# ------------------------------------------------------------------ Vautour
func on_kill(g: Node, z: ZombieSim) -> void:
	if not g.arms.perks.get("vultureaid", false) or z.is_boss:
		return
	if rng.randf() >= float(cfg("vultureaid.chance")):
		return
	var type := "ammo" if rng.randf() < float(cfg("vultureaid.ammoShare")) else "points"
	var d := {"id": _next, "pos": Vector3(z.pos.x, z.pos.y, z.pos.z), "type": type, "life": float(cfg("vultureaid.life"))}
	_next += 1
	drops.append(d)
	stats["drops"] = int(stats["drops"]) + 1
	g.perk_event.emit("vulture_drop", d)

func _pick(g: Node, d: Dictionary) -> void:
	stats["picked"] = int(stats["picked"]) + 1
	if String(d["type"]) == "ammo":
		var f := float(cfg("vultureaid.ammoFrac"))
		for w: WeaponState in g.arms.inventory:
			var mx := int(w.cfg["maxReserve"])
			w.reserve = mini(mx, w.reserve + ceili(mx * f))
	else:
		g.add_bonus_points(int(cfg("vultureaid.points")) * g.powerups.points_mult())
	g.perk_event.emit("vulture_pick", d)

# ------------------------------------------------------------------ Pierre tombale
## Le joueur tombe (avant que ses atouts ne soient effacés) : la tombe garde les autres atouts.
func on_down(g: Node) -> void:
	if not g.arms.perks.get("tombstone", false):
		return
	var keep: Array = []
	for id: String in g.arms.perks:   # ni la Pierre tombale elle-même, ni la Réanimation rapide (sinon les relevés seraient gratuits à l'infini)
		if id != "tombstone" and id != "quickrevive" and g.arms.perks[id]:
			keep.append(id)
	tomb = {"pos": g.player.pos, "perks": keep, "life": float(cfg("tombstone.life")), "arm": float(cfg("tombstone.arm"))}
	stats["tombs"] = int(stats["tombs"]) + 1
	g.perk_event.emit("tomb", {"pos": g.player.pos, "perks": keep})
