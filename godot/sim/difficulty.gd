class_name Difficulty
extends RefCounted
## Difficulté de la partie (menu « Carte et difficulté »). Elle ne change que la vie et la vitesse des zombies ORDINAIRES (et de leurs
## variantes : chevalier de fer, pestiféré, rampant), pas les boss ni l'économie. NORMALE vaut exactement x1 : la simulation et tous les
## golden restent identiques (RoundDirector n'applique rien quand le multiplicateur vaut 1). Les valeurs sont un choix de jeu du port
## (le JS n'a qu'une difficulté) : Facile 0,75 de vie et 0,9 de vitesse ; Difficile 1,35 de vie et 1,1 de vitesse (la vitesse de manche
## est déjà plafonnée par CONFIG.zombie.speedMax, le multiplicateur s'applique APRES ce plafond).

const DEFAULT := "normal"
const LIST := [
	{"id": "easy", "name": "FACILE", "health": 0.75, "speed": 0.9, "desc": "Zombies plus fragiles (vie x0,75) et plus lents (vitesse x0,9)."},
	{"id": "normal", "name": "NORMALE", "health": 1.0, "speed": 1.0, "desc": "L'équilibrage d'origine du jeu."},
	{"id": "hard", "name": "DIFFICILE", "health": 1.35, "speed": 1.1, "desc": "Zombies plus résistants (vie x1,35) et plus rapides (vitesse x1,1)."},
]

static func ids() -> Array:
	var r: Array = []
	for d: Dictionary in LIST:
		r.append(d["id"])
	return r

static func valid(id: String) -> String:
	return id if id in ids() else DEFAULT

static func of(id: String) -> Dictionary:
	for d: Dictionary in LIST:
		if d["id"] == id:
			return d
	return LIST[1]

static func health_mult(id: String) -> float:
	return float(of(id)["health"])

static func speed_mult(id: String) -> float:
	return float(of(id)["speed"])

static func name_of(id: String) -> String:
	return String(of(id)["name"])
