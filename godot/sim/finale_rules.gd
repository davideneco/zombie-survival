class_name FinaleRules
extends RefCounted
## Utilitaires de la fin de partie hors équilibrage : trophée « Strasbourg libérée » (finale.js showLiberated : localStorage `zombie_trophy`
## devient un fichier de user://).

const TROPHY_PATH := "user://trophy.cfg"

## Enregistre une victoire et renvoie le nombre de trophées ; 0 si le fichier est inaccessible.
static func record_trophy(path: String, last: Dictionary) -> int:
	if path == "":
		return 0
	var cf := ConfigFile.new()
	cf.load(path)
	var n := int(cf.get_value("trophy", "n", 0)) + 1
	cf.set_value("trophy", "n", n)
	cf.set_value("trophy", "last", last)
	return n if cf.save(path) == OK else 0
