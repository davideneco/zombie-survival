extends Node
## Etat de partie : l'« hôte » du jeu (équivalent de l'objet game de src/main.js). Squelette de J0 ; rempli à partir de J1.
## Toute mutation autoritaire passera par une méthode d'ici (futur point d'émission réseau, voir docs/GODOT_PORT.md § 1.3).

var round_number := 0
var points := 0

func version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0.0.0"))

## Santé d'un zombie ordinaire à la manche r (courbe de CONFIG.zombie.health ; équivalent de game.zombieHealthAt).
func zombie_health_at(r: int) -> int:
	var h: Dictionary = Config.at("zombie.health")
	if r < int(h["softRound"]):
		return int(h["base"] + r * h["perRound"])
	return int(floor(h["hardBase"] * pow(h["hardGrowth"], r - h["softRound"] + 1) + 0.5))
