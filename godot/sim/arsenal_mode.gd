class_name ArsenalMode
extends RefCounted
## v0.33.0 : mode « Arsenal aléatoire » (menu « Mode de jeu »). Code pur, sans nœud. Propre au port.
## La partie se joue sur toute la Grande Île comme le Classique (portes payantes, atouts, véhicules, tram), sans finale, avec une seule arme
## IMPOSÉE qui change à chaque manche :
##   - au départ et au début de chaque manche, une arme est tirée au hasard (poids de la boîte mystère, CONFIG.box.pool), jamais la même
##     que celle de la manche d'avant ; les armes chères n'arrivent qu'avec les manches : prix <= `capBase` + `capPerRound` x manche
##     (manche 1 : pistolets, MP40, MP5, M4A1, FAMAS, Remington ; manche 4 : M249, Saiga ; manche 8 : Barrett), le pistolet à rayons
##     (sans prix) à partir de la manche `raygunRound` ;
##   - l'arme tirée REMPLACE tout l'inventaire (une seule arme), chargeur et réserve pleins ; le niveau de Pack-a-Punch de l'arme
##     d'avant passe à la nouvelle (une amélioration payée n'est pas perdue à la manche suivante) ;
##   - pas d'achat d'arme : armes murales et boîte mystère sont fermées ; les bornes de munitions, les atouts, le Pack-a-Punch, les
##     grenades, le couteau et les bonus (Munitions max…) restent ;
##   - si l'arme est dans le Pack-a-Punch au début de la manche, le changement attend qu'elle soit rendue.
## Score : points GAGNÉS, manche atteinte ; statistiques à part (GameStats.by_mode["arsenal"]).

const CONFIG := {
	"capBase": 1000,      ## prix plafond des armes tirées = capBase + capPerRound x manche
	"capPerRound": 500,
	"raygunRound": 10,    ## le pistolet à rayons (sans prix) entre dans le tirage à cette manche
	"noPricePrice": 6000, ## prix retenu pour une arme sans prix (pistolet à rayons) dans le plafond
}

var rng := RandomNumberGenerator.new()
var current := ""          ## arme imposée de la manche
var round_drawn := -1      ## manche pour laquelle `current` a été tirée (0 : départ, avant la manche 1)
var pending := false       ## changement en attente (arme dans le Pack-a-Punch)
var history: Array[String] = []   ## armes tirées, dans l'ordre (tests, écran de fin)

static func cfg(key: String) -> int:
	return int(Config.at("arsenalMode.%s" % key, CONFIG[key]))

func _init(seed_value := 1) -> void:
	rng.seed = seed_value + 7919

## Prix retenu d'une arme pour le plafond (le pistolet à rayons n'a pas de prix).
static func price_of(id: String) -> int:
	var p: Variant = Config.weapon(id).get("price")
	return int(p) if p != null else cfg("noPricePrice")

## Armes possibles à la manche r (r = 0 : le départ, comme la manche 1) : { id: poids } (poids de la boîte mystère).
static func pool(r: int) -> Dictionary:
	var cap := cfg("capBase") + cfg("capPerRound") * maxi(1, r)
	var out := {}
	var P: Dictionary = Config.at("box.pool", {})
	for id: String in P:
		if Config.weapon(id).is_empty():
			continue
		if Config.weapon(id).get("price") == null:
			if r >= cfg("raygunRound"):
				out[id] = float(P[id])
			continue
		if price_of(id) <= cap:
			out[id] = float(P[id])
	return out

## Tire l'arme de la manche r (jamais `current`). Pur : ne touche pas l'inventaire.
func draw(r: int) -> String:
	var P := pool(r)
	P.erase(current)
	if P.is_empty():
		return current
	var total := 0.0
	for id: String in P:
		total += float(P[id])
	var x := rng.randf() * total
	var ids: Array = P.keys()
	ids.sort()   # ordre stable : même tirage pour une même graine
	for id: String in ids:
		x -= float(P[id])
		if x <= 0.0:
			return id
	return String(ids[-1])

## Donne l'arme `id` : elle remplace tout l'inventaire, chargeur et réserve pleins, niveau de Pack-a-Punch de l'arme d'avant gardé.
static func equip(arms: WeaponArms, id: String) -> void:
	var lv := 0
	if not arms.inventory.is_empty():
		lv = arms.current.pap
	var w := WeaponState.new(id)
	w.pap = mini(lv, Config.pap_levels.size() - 1)
	w.refresh(arms.perks)
	w.ammo = int(w.cfg["magSize"])
	w.refill()
	w.reloading = false
	arms.inventory.clear()
	arms.inventory.append(w)
	arms.idx = 0

## Tirage et équipement pour la manche r ; si l'arme est dans le Pack-a-Punch, le changement attend (`pending`). Renvoie l'arme tirée
## ("" : en attente).
func roll(arms: WeaponArms, r: int) -> String:
	if r <= round_drawn:
		return ""
	if arms.locked:
		pending = true
		return ""
	pending = false
	round_drawn = r
	current = draw(r)
	history.append(current)
	equip(arms, current)
	return current

## À appeler à chaque pas : applique un changement en attente dès que l'arme est rendue par le Pack-a-Punch. Renvoie l'arme tirée ou "".
func poll(arms: WeaponArms, r: int) -> String:
	if pending and not arms.locked:
		return roll(arms, r)
	return ""

## Nom de l'arme imposée (« AK-47 »).
func weapon_name() -> String:
	return String(Config.weapon(current).get("name", current.to_upper()))
