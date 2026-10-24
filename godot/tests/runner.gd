extends Node
## Lanceur de tests headless :
##   godot --headless --path godot res://tests/runner.tscn [-- --suite=j1]
## Passe par une scène pour que les autoloads (Config, Game) soient chargés. Code de sortie 0 si tout passe, 1 sinon.
## Chaque suite est un script tests/test_<nom>.gd avec une méthode run(t) ; t.check(ok, message), t.near(a, b, message, tol).

var failures: Array[String] = []
var checks := 0

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		failures.append(message)

func near(a: Variant, b: Variant, message: String, tol := 1e-6) -> void:
	checks += 1
	if typeof(a) not in [TYPE_INT, TYPE_FLOAT] or typeof(b) not in [TYPE_INT, TYPE_FLOAT] or absf(float(a) - float(b)) > tol * maxf(1.0, absf(float(b))):
		failures.append("%s : %s != %s" % [message, a, b])

## Compare récursivement deux valeurs JSON (dictionnaires de mêmes clés, nombres à tol près).
func same(a: Variant, b: Variant, message: String, tol := 1e-6) -> void:
	if typeof(b) == TYPE_DICTIONARY:
		if typeof(a) != TYPE_DICTIONARY:
			check(false, "%s : dictionnaire attendu" % message)
			return
		for k in b:
			if not a.has(k):
				check(false, "%s : clé « %s » absente" % [message, k])
			else:
				same(a[k], b[k], "%s.%s" % [message, k], tol)
		for k in a:
			if not b.has(k):
				check(false, "%s : clé « %s » en trop" % [message, k])
	elif typeof(b) == TYPE_ARRAY:
		if typeof(a) != TYPE_ARRAY or a.size() != b.size():
			check(false, "%s : tableau de %d éléments attendu" % [message, b.size()])
			return
		for i in b.size():
			same(a[i], b[i], "%s[%d]" % [message, i], tol)
	elif typeof(b) in [TYPE_INT, TYPE_FLOAT]:
		near(a, b, message, tol)
	else:
		check(a == b, "%s : %s != %s" % [message, a, b])

func _ready() -> void:
	var suites: Array[String] = ["j0", "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10", "j11", "j13", "j14", "j16", "j18", "j19", "j20", "j22", "j23", "j24", "j25", "j26", "j27", "j28", "j29", "j30", "j31", "j32", "j33", "j34", "j35", "j36", "j37", "j38", "j39", "j40"]
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--suite="):
			suites = [arg.substr(8)]
	for s in suites:
		var path := "res://tests/test_%s.gd" % s
		var script: Variant = load(path)
		if script == null:
			failures.append("suite introuvable : %s" % path)
			continue
		var before := checks
		var nfail := failures.size()
		await script.new().run(self)
		print("suite %s : %d contrôles, %d échecs" % [s, checks - before, failures.size() - nfail])
	var shown := 30   # --failures=N : en afficher davantage
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--failures="):
			shown = int(arg.substr(11))
	for f in failures.slice(0, shown):
		printerr("ECHEC ", f)
	if failures.size() > shown:
		printerr("... et %d autres" % (failures.size() - shown))
	print("%d contrôles, %d échecs (Godot %s, port v%s)" % [checks, failures.size(), Engine.get_version_info()["string"], Game.version()])
	get_tree().quit(1 if failures.size() > 0 else 0)
