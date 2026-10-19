extends SceneTree
## Écrit un .pck Godot depuis un manifeste « chemin dans le pack<TAB>fichier source » (tools/pck-tool.py). Lancé par tools/export-windows.sh :
##   godot --headless --path <projet vide> --script tools/pck-pack.gd -- <manifeste> <sortie.pck>
func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		printerr("usage : -- <manifeste> <sortie.pck>")
		quit(2)
		return
	var packer := PCKPacker.new()
	if packer.pck_start(args[1]) != OK:
		printerr("pck_start a échoué : ", args[1])
		quit(1)
		return
	var n := 0
	for line in FileAccess.get_file_as_string(args[0]).split("\n", false):
		var cols := line.split("\t")
		if packer.add_file("res://" + cols[0], cols[1]) != OK:
			printerr("add_file a échoué : ", cols[0])
			quit(1)
			return
		n += 1
	if packer.flush() != OK:
		printerr("flush a échoué")
		quit(1)
		return
	print("pck-pack : %d fichiers -> %s" % [n, args[1]])
	quit(0)
