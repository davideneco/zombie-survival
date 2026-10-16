class_name WeaponSim
extends RefCounted
## État d'une arme à feu du joueur (munitions, rechargement, cadence). Port de la partie tir de src/player.js.

var cfg: Dictionary
var ammo := 0
var reserve := 0
var reloading := false
var reload_t := 0.0
var next_shot := 0.0

func _init(id: String) -> void:
	cfg = Config.weapon(id)
	ammo = int(cfg["magSize"])
	reserve = int(cfg["startReserve"])

func start_reload() -> void:
	if reloading or ammo >= int(cfg["magSize"]) or reserve <= 0:
		return
	reloading = true
	reload_t = 0.0

func update(dt: float) -> void:
	if not reloading:
		return
	reload_t += dt
	if reload_t >= float(cfg["reloadTime"]):
		var take := mini(int(cfg["magSize"]) - ammo, reserve)
		ammo += take
		reserve -= take
		reloading = false

func can_fire(now: float) -> bool:
	return not reloading and ammo > 0 and now >= next_shot

## Consomme une balle ; semi : la cadence est un plafond (une balle par clic).
func consume(now: float) -> void:
	ammo -= 1
	next_shot = now + 1.0 / float(cfg["fireRate"])
