extends SceneTree
## Écrit la licence du moteur Godot (MIT) et la liste de ses composants tiers (texte fourni par le moteur lui-même).
## Lancé par tools/export-windows.sh : godot --headless --path <projet vide> --script tools/godot-licenses.gd -- <sortie.txt>
func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 1:
		printerr("usage : -- <sortie.txt>")
		quit(2)
		return
	var out := "Godot Engine %s\n\n%s\n\n" % [Engine.get_version_info().get("string", ""), Engine.get_license_text()]
	out += "================ Composants tiers du moteur ================\n\n"
	for part: Dictionary in Engine.get_copyright_info():
		out += "%s\n" % part.get("name", "")
		for p: Dictionary in part.get("parts", []):
			out += "  Fichiers : %s\n  Copyright : %s\n  Licence : %s\n" % [", ".join(p.get("files", PackedStringArray())), ", ".join(p.get("copyright", PackedStringArray())), p.get("license", "")]
		out += "\n"
	out += "================ Textes des licences ================\n\n"
	var texts: Dictionary = Engine.get_license_info()
	for k: String in texts:
		out += "---- %s ----\n%s\n\n" % [k, texts[k]]
	var f := FileAccess.open(args[0], FileAccess.WRITE)
	if f == null:
		printerr("écriture impossible : ", args[0])
		quit(1)
		return
	f.store_string(out)
	f.close()
	quit(0)
