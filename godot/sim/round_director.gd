class_name RoundDirector
extends RefCounted
## Manches (port de startRound et de la gestion des manches de la boucle de main.js) : nombre de zombies, cadence d'apparition,
## pause entre manches. Pur : step() dit ce qu'il faut faire, Game exécute.

var round_number := 0
var to_spawn := 0
var spawn_timer := 0.0
var intermission := Rules.INTERMISSION_FIRST
var zombie_health := 0.0
var zombie_speed := 0.0

## Évènements renvoyés par step()
const NONE := 0
const SPAWN := 1
const ROUND_START := 2
const ROUND_END := 3

func reset() -> void:
	round_number = 0
	to_spawn = 0
	spawn_timer = 0.0
	intermission = Rules.INTERMISSION_FIRST

func start_round() -> void:
	round_number += 1
	var r := round_number
	to_spawn = Pap.js_round((Rules.ROUND_BASE + r * Rules.ROUND_PER) * 1.0)
	zombie_health = float(Game.zombie_health_at(r))
	var Z: Dictionary = Config.at("zombie")
	zombie_speed = minf(float(Z["speedStart"]) + r * float(Z["speedPerRound"]), float(Z["speedMax"]))
	spawn_timer = Rules.SPAWN_FIRST_DELAY

## Un pas de dt s avec `alive` zombies vivants. Renvoie un des évènements (un seul par pas).
func step(dt: float, alive: int) -> int:
	if to_spawn > 0:
		spawn_timer -= dt
		if spawn_timer <= 0.0 and alive < int(Config.at("zombie.maxAlive")):
			to_spawn -= 1
			spawn_timer = maxf(Rules.SPAWN_GAP_MIN, Rules.SPAWN_GAP_START - round_number * Rules.SPAWN_GAP_PER)
			return SPAWN
	elif alive == 0 and round_number > 0 and intermission <= 0.0:
		intermission = Rules.INTERMISSION
		return ROUND_END
	if intermission > 0.0:
		intermission -= dt
		if intermission <= 0.0:
			start_round()
			return ROUND_START
	return NONE
