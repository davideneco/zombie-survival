class_name ZombieHit
extends RefCounted
## v0.20.0 : boîtes de touche des zombies ordinaires alignées sur leurs MODÈLES animés (data/zombie_models.json, clé "hit", produite par
## tools/measure-zombie-hit.gd). Ce n'est PAS un port du JS : le JS tire sur des silhouettes en primitives (Rules.ZOMBIE_*), le port Godot dessine des modèles
## cartoon dont la tête est plus basse, plus grosse et en avant. Les boss, les gargouilles et l'Ange gardent les boîtes de Rules (golden JS).
## Pur : lit seulement la table et l'état de la simulation (aucun nœud). `enabled = false` (tests golden, --old-zombies) rétablit les boîtes du JS.

const TABLE_PATH := "res://data/zombie_models.json"

static var enabled := true
static var _table: Dictionary = {}
static var _specs: Dictionary = {}

static func table() -> Dictionary:
	if _table.is_empty():
		var f := FileAccess.open(TABLE_PATH, FileAccess.READ)
		_table = JSON.parse_string(f.get_as_text()) as Dictionary
	return _table

## Ce zombie est-il dessiné par un modèle animé (donc touché par ses boîtes) ?
static func uses_model(z: ZombieSim) -> bool:
	return enabled and not (z is BossSim) and z.kind != "gargoyle"

static func variant_key(z: ZombieSim) -> String:
	if z.kind == "armored":
		return "armored"
	if z.kind == "bloat":
		return "bloat"
	if z.crawler:
		return "crawler"
	if z.runner:
		return "runner"
	if z.limp:
		return "limp"
	return "normal"

## Champ de la variante, en suivant « like » (même règle que ZombieModels.variant).
static func _vfield(key: String, field: String, dflt: Variant) -> Variant:
	var raw: Dictionary = (table()["variants"] as Dictionary)[key]
	if raw.has(field):
		return raw[field]
	if raw.has("like"):
		return _vfield(String(raw["like"]), field, dflt)
	return dflt

static func _anims(key: String) -> Dictionary:
	if not _specs.has("a:" + key):
		var a: Dictionary = (table()["anims"] as Dictionary).duplicate()
		var raw: Dictionary = (table()["variants"] as Dictionary)[key]
		if raw.has("like"):
			for k in _anims(String(raw["like"])):
				a[k] = _anims(String(raw["like"]))[k]
		if raw.has("anim"):
			for k in raw["anim"]:
				a[k] = raw["anim"][k]
		_specs["a:" + key] = a
	return _specs["a:" + key]

## Nom de l'animation que la vue joue pour cet état de la simulation (même arbre de décision que zombie_model_view.gd _alive_state).
static func anim_of(z: ZombieSim, key: String) -> String:
	var a := _anims(key)
	if z.spawn_t > 0.0:
		return String(a["vault"] if z.spawn_type == "window" else a["idle"])
	if z.attacking and not z.crawler:
		return String(a["attack"])
	if not z.vault.is_empty():
		return String(a["vault"])
	if z.crawler:
		return String(a["crawl"])
	if z.moving:
		var sp := z.speed * (Rules.LIMP_SPEED if z.limp else 1.0)
		var run := z.runner or sp >= float(table()["run_from_speed"])
		if String(a["walk"]) == "Run":
			return "Run"
		return String(a["run"] if (run and not z.limp) else a["walk"])
	return String(a["idle"])

## Boîtes en repère du zombie (cap retiré, pieds en y = 0, face vers +Z), mètres : { hc: centre de tête, hr: rayon, bc: centre du corps, bh: demi-tailles }.
static func shapes(z: ZombieSim) -> Dictionary:
	var key := variant_key(z)
	var an := anim_of(z, key)
	var ck := "%s|%d|%s" % [key, 1 if z.crawler else 0, an]
	var sc := z.body_scale()
	if not _specs.has(ck):
		var v: Dictionary = (table()["variants"] as Dictionary)[key]
		var model := String(v["crawl_model"]) if (z.crawler and v.has("crawl_model")) else String(_vfield(key, "model", "basic"))
		var e: Dictionary = (table()["models"] as Dictionary)[model]
		var hit: Dictionary = e["hit"]
		var h: Dictionary = hit[an] if hit.has(an) else hit["Walk"]
		_specs[ck] = {
			"e_scale": float(e["scale"]) * float(_vfield(key, "scale", 1.0)), "e_xz": float(e["xz"]) * float(_vfield(key, "xz", 1.0)),
			"hc": _vec(h["hc"]), "hr": float(h["hr"]), "bc": _vec(h["bc"]), "bh": _vec(h["bh"]),
		}
	var sp: Dictionary = _specs[ck]
	var bw := sc.x / sc.y
	var xz: float = sp["e_xz"] * (sqrt(bw) if key == "bloat" else 1.0)
	var s: float = sp["e_scale"] * sc.y
	var k := Vector3(s * xz, s, s * xz)
	return {"hc": (sp["hc"] as Vector3) * k, "hr": float(sp["hr"]) * s, "bc": (sp["bc"] as Vector3) * k, "bh": (sp["bh"] as Vector3) * k}

static func _vec(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))
