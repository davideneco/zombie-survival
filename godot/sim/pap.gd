class_name Pap
extends RefCounted
## Port de papStats, papAmmoMult, papPulse et falloffMult (src/config.js). Code pur, sans nœud ; contrôlé par les golden (tests/test_j0.gd).

const PAP_MAG := {"ak47": 75, "saiga": 20, "crossbow": 3, "m79": 3}

## Arrondi de Math.round (moitié vers +infini) ; GDScript arrondit la moitié en s'éloignant de zéro.
static func js_round(x: float) -> int:
	return int(floor(x + 0.5))

static func level(lv: int) -> Variant:
	var levels: Array = Config.pap_levels
	return levels[lv] if lv >= 0 and lv < levels.size() else null

static func pap_ammo_mult(lv: int) -> float:
	var l: Variant = level(lv)
	return float(l["ammo"]) if l != null else 1.0

static func pap_pulse(lv: int, t: float) -> float:
	var l: Variant = level(lv)
	if l != null and l.has("pulseHz"):
		return 0.55 + 0.9 * (0.5 + 0.5 * sin(2.0 * PI * float(l["pulseHz"]) * t))
	return 1.0

## Multiplicateur des dégâts selon la distance du tir (m). cfg : arme (falloffStart, falloffEnd, minMult).
static func falloff_mult(cfg: Dictionary, dist: float) -> float:
	if not cfg.has("falloffStart") or dist <= float(cfg["falloffStart"]):
		return 1.0
	if dist >= float(cfg["falloffEnd"]):
		return float(cfg["minMult"])
	return 1.0 - (1.0 - float(cfg["minMult"])) * (dist - float(cfg["falloffStart"])) / (float(cfg["falloffEnd"]) - float(cfg["falloffStart"]))

## Statistiques de base (arme) au niveau lv (1 à 3) ; dictionnaire vide au niveau 0.
static func pap_stats(base: Dictionary, lv: int) -> Dictionary:
	var l: Variant = level(lv)
	if l == null:
		return {}
	var id: String = base["id"]
	var cat: String = base.get("cat", "")
	var s := {"pap": lv}
	var names: Dictionary = Config.at("papNames", {})
	s["name"] = str(names.get(id, "%s +" % base["name"])) + (" " + str(l["roman"]) if lv > 1 else "")
	s["damage"] = float(base["damage"]) * (float(l["ray"]) if id == "raygun" else float(l["dmg"]))
	s["headMult"] = float(base["headMult"]) * float(l["head"])
	s["pierce"] = float(base.get("pierce", 0)) + float(l["pierce"])
	s["magSize"] = PAP_MAG[id] if lv > 1 and PAP_MAG.has(id) else js_round(float(base["magSize"]) * float(l["mag"]) * float(l["magX"]))
	s["maxReserve"] = js_round(float(base["maxReserve"]) * float(l["reserve"]))
	s["reloadTime"] = float(base["reloadTime"]) * float(l["reload"])
	s["spread"] = float(base["spread"]) * float(l["spread"])
	s["tracer"] = l["tracer"]
	if base.has("splash"):
		s["splash"] = {"radius": float(base["splash"]["radius"]) * 1.3, "damage": float(base["splash"]["damage"]) * 2.0}
	if base.has("papSplash"):
		s["splash"] = base["papSplash"].duplicate()
	if base.has("blast"):
		var b: Dictionary = base["blast"].duplicate()
		b["radius"] = float(b["radius"]) * 1.3
		b["damage"] = float(b["damage"]) * 2.0
		s["blast"] = b
	if cat == "mg":
		s["zoom"] = 45
		if lv == 3:
			s["fireRate"] = float(base["fireRate"]) * 1.15
	if cat == "shotgun":
		s["spread"] = float(s["spread"]) * 0.8
		if lv == 3:
			s["pellets"] = 12
			s["tracer"] = 0xff9a30
	if cat == "sniper" and lv == 3:
		s["boom"] = {"radius": 2, "frac": 0.4, "color": 0xff8a2a}
	if lv == 3 and cat in ["pistol", "ar", "smg", "mg"]:
		s["ether"] = {"chance": 0.2, "radius": 2, "frac": 0.5, "color": 0x66ffe0}
	if lv == 3 and cat == "ar":
		s["gl"] = {"shells": 3, "cooldown": 1}
	if id == "raygun":
		s["pierce"] = [0, 2, 3, 6][lv]
		s["splash"] = {"radius": float(base["splash"]["radius"]) * 1.3, "damage": float(base["splash"]["damage"]) * [0.0, 2.0, 2.8, 4.0][lv]}
	if id == "crossbow" and lv == 3:
		var ps: Dictionary = base["papSplash"].duplicate()
		ps["radius"] = float(ps["radius"]) + 1.0
		ps["damage"] = float(ps["damage"]) * 1.5
		s["splash"] = ps
	if id == "m79":
		var b2: Dictionary = base["blast"].duplicate()
		b2["radius"] = float(b2["radius"]) * [0.0, 1.3, 1.45, 1.6][lv]
		b2["damage"] = float(b2["damage"]) * [0.0, 2.0, 3.0, 4.5][lv]
		s["blast"] = b2
	return s
