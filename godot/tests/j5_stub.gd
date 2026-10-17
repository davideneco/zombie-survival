class_name J5Stub
extends RefCounted
## Doublure de l'hôte (Game) pour tester VehicleSim, TramSim et Rides sans partie : collision, zombies, temps, journal des dégâts.

signal ride_event(name: String, data: Dictionary)
signal purchase_denied(price: int)
signal announced(title: String, sub: String)
signal explosion(pos: Vector3, radius: float, color: int)

var collision: Collision
var world: Object = null
var zombies: Array[ZombieSim] = []
var vehicles: Array[VehicleSim] = []
var player := PlayerSim.new()
var rides: Rides
var rng := RandomNumberGenerator.new()
var time := 0.0
var shake := 0.0
var points := 0
var playing := true
var round_number := 1
var log: Array = []
var arms: Object = null

func _init() -> void:
	player.pos = Vector3(1.0e5, 0, 1.0e5)

func announce(title: String, sub := "") -> void:
	log.append(["announce", title])

func damage_vehicle(v: Object, amt: float, src := "") -> void:
	if not (amt > 0.0) or v.state != "ok":
		return
	v.hp = maxf(0.0, v.hp - amt)
	log.append(["dmg", v.id, amt, src])

func hurt_occupants(_v: Object, dmg: float) -> void:
	var d := minf(dmg, 100.0 - 1.0)
	if d > 0.0:
		log.append(["hurt", d, "crash"])

func hurt_player(amount: float, src := "") -> void:
	log.append(["hurt", amount, src])

func hit_zombie(z: ZombieSim, _head: bool, dmg: float, _mult: float, _mel := false) -> bool:
	var a := dmg * z.armor
	var killed := a >= z.health
	z.health -= a
	log.append(["zhit", z.id, dmg, killed])
	return killed
