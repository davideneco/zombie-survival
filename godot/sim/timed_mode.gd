class_name TimedMode
extends RefCounted
## v0.33.0 : mode « Contre la montre » (menu « Mode de jeu »). Code pur, sans nœud. Propre au port.
## La partie se joue sur toute la Grande Île comme le Classique (portes payantes, machines, véhicules, tram), sans finale (pas d'horloge
## astronomique), avec un CHRONO qui descend :
##   - départ : `start` s (4 min) ; le chrono tourne pendant le jeu (pas pendant la pause ni les menus) ;
##   - chaque zombie tué rend `killBonus` s (+ `headBonus` s pour une mort à la tête) ; chaque manche finie rend `roundBonus` s ;
##   - le chrono ne dépasse jamais `max` s (les secondes en trop sont perdues) ;
##   - à 0 : fin de partie « TEMPS ÉCOULÉ » (la mort termine aussi la partie, comme en Classique).
## Score : points GAGNÉS (Game.points_earned, dépenses non déduites), manche atteinte ; statistiques à part (GameStats.by_mode["timed"]).

const CONFIG := {
	"start": 240.0,       ## chrono au départ (s)
	"killBonus": 2.0,     ## secondes rendues par zombie tué
	"headBonus": 1.0,     ## secondes en plus pour une mort à la tête
	"roundBonus": 15.0,   ## secondes rendues à la fin de chaque manche
	"max": 600.0,         ## plafond du chrono (s)
	"warn": 30.0,         ## en dessous : le chrono passe au rouge et clignote
}

var left := 0.0           ## secondes restantes
var gained := 0.0         ## secondes rendues depuis le départ (bonus réellement ajoutés, plafond compris)
var lost := 0.0           ## secondes de bonus perdues contre le plafond
var expired := false      ## le chrono est arrivé à 0 (fin de partie « TEMPS ÉCOULÉ »)

static func cfg(key: String) -> float:
	return float(Config.at("timedMode.%s" % key, CONFIG[key]))

func _init() -> void:
	left = cfg("start")

## Un pas de dt s de jeu. Renvoie true au pas où le chrono arrive à 0.
func step(dt: float) -> bool:
	if expired:
		return false
	left -= dt
	if left <= 0.0:
		left = 0.0
		expired = true
		return true
	return false

## Ajoute des secondes (plafonnées à `max`). Renvoie les secondes réellement ajoutées.
func add(seconds: float) -> float:
	if expired or seconds <= 0.0:
		return 0.0
	var room := maxf(0.0, cfg("max") - left)
	var got := minf(seconds, room)
	left += got
	gained += got
	lost += seconds - got
	return got

## Zombie tué (à la tête : bonus en plus). Renvoie les secondes ajoutées.
func on_kill(head: bool) -> float:
	return add(cfg("killBonus") + (cfg("headBonus") if head else 0.0))

## Manche finie. Renvoie les secondes ajoutées.
func on_round_end() -> float:
	return add(cfg("roundBonus"))

func warning() -> bool:
	return not expired and left < cfg("warn")

## « 4:00 », « 0:07 » (secondes arrondies au-dessus : le chrono affiche 0:00 seulement à la fin).
static func clock_text(seconds: float) -> String:
	var s := int(ceil(maxf(0.0, seconds)))
	return "%d:%02d" % [s / 60, s % 60]
