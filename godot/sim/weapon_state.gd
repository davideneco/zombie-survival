class_name WeaponState
extends WeaponSim
## Une arme de l'inventaire : état (chargeur, réserve, rechargement, niveau du Pack-a-Punch, obus sous canon) et statistiques
## effectives `cfg` = base + papStats + atouts (équivalent de Player.statsOf de src/player.js). Hérite du chargeur de WeaponSim (J1).

const FIRE_RESUME_GAP := 0.1   ## player.js FIRE_RESUME_GAP : au-delà de ce retard sur next_shot, le tir ne « rattrape » pas

var id: String
var pap := 0
var gl := 0                    ## obus du lance-grenades sous canon (niveau III des fusils d'assaut)

func _init(weapon_id: String) -> void:
	super(weapon_id)
	id = weapon_id

## Recalcule `cfg` : { ...base, ...papStats(base, pap) } puis Double Tap (cadence x1,33, dégâts x1,25) et Speed Cola (rechargement x0,5).
func refresh(perks: Dictionary) -> void:
	var base := Config.weapon(id)
	var s := base.duplicate(true)
	s.merge(Pap.pap_stats(base, pap), true)
	if perks.get("doubletap", false):
		s["fireRate"] = float(s["fireRate"]) * 1.33
		s["damage"] = float(s["damage"]) * 1.25
	if perks.get("speedcola", false):
		s["reloadTime"] = float(s["reloadTime"]) * 0.5
	if perks.get("deadshot", false):   # v0.27.0 : Œil-de-lynx (sim/perk_fx.gd)
		s["headMult"] = float(s["headMult"]) * float(PerkFx.cfg("deadshot.headMult"))
		s["spread"] = float(s["spread"]) * float(PerkFx.cfg("deadshot.spreadMult"))
	if perks.get("bandolier", false):  # v0.27.0 : Cartouchière
		s["maxReserve"] = roundi(float(s["maxReserve"]) * float(PerkFx.cfg("bandolier.reserveMult")))
	cfg = s
	if reserve > int(s["maxReserve"]):   # Cartouchière perdue : la réserve revient dans la borne
		reserve = int(s["maxReserve"])

## Remplit la réserve (borne, mur, munitions max, Pack-a-Punch) ; refait aussi le plein d'obus sous canon.
func refill() -> void:
	reserve = int(cfg["maxReserve"])
	if cfg.has("gl"):
		gl = int(cfg["gl"]["shells"])

## Consomme une balle. Semi : la cadence est un plafond (une balle par clic). Sinon on cumule à partir du tir prévu, pour ne pas
## arrondir la période à l'image supérieure ; après une pause, on repart de `now` (pas de rafale de rattrapage).
func consume(now: float) -> void:
	ammo -= 1
	var period := 1.0 / float(cfg["fireRate"])
	next_shot = now + period if String(cfg["type"]) == "semi" or now - next_shot > FIRE_RESUME_GAP else next_shot + period
