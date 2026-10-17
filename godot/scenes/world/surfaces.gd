extends RefCounted
## J9 : matériaux « sur mesure » du monde cuit. world_view.gd construit un StandardMaterial3D par matériau de materials.json ; ici on reconnaît ceux qui avaient un
## shader modifié dans le JS (onBeforeCompile) et on en fait un ShaderMaterial (godot/shaders/) :
##   ground  : le plan de pavés (carte de cobble) -> ground.gdshader (src/ground.js : variations, mousse, taches, flaques, champ de distance aux façades)
##   water   : l'eau (sans carte de couleur, normale cuite, rugosité 0,08, métal 0,6) -> water.gdshader (deux couches de ridules qui dérivent)
##   facade  : façades dessinées sur canevas (couleurs de sommet + carte d'émission) -> facade.gdshader (texture de détail, architecture.js withDetail)
##   foliage : cartes de feuillage (alphaTest 0,46, double face) -> foliage.gdshader (vent, trees.js)
## La reconnaissance se fait sur les propriétés du matériau, pas sur son indice (une cuisson refaite change les indices).

const GfxAssets := preload("res://scenes/gfx_assets.gd")
const GROUND := preload("res://shaders/ground.gdshader")
const WATER := preload("res://shaders/water.gdshader")
const FACADE := preload("res://shaders/facade.gdshader")
const FOLIAGE := preload("res://shaders/foliage.gdshader")

## m : entrée de materials.json ; files : chemins des textures (textures.json) pour reconnaître le pavé.
static func kind(m: Dictionary, files: Array) -> String:
	var map := int(m["map"])
	if map >= 0 and map < files.size() and String(files[map]).ends_with("cobble/diff.jpg"):
		return "ground"
	if map < 0 and int(m["nmap"]) >= 0 and absf(float(m["r"]) - 0.08) < 0.001 and absf(float(m["m"]) - 0.6) < 0.001:
		return "water"
	if bool(m["vc"]) and map >= 0 and int(m["emap"]) >= 0 and "--dbg-nofacade" not in OS.get_cmdline_user_args():
		return "facade"
	if map >= 0 and absf(float(m["at"]) - 0.46) < 0.001 and int(m["side"]) == 2:
		return "foliage"
	return ""

static func make(k: String, m: Dictionary, tex: Callable) -> ShaderMaterial:
	var sm := ShaderMaterial.new()
	var base := Config.color(int(m["c"]))
	match k:
		"ground":
			sm.shader = GROUND
			sm.set_shader_parameter("albedo_tex", tex.call(int(m["map"])))
			sm.set_shader_parameter("normal_tex", tex.call(int(m["nmap"])))
			sm.set_shader_parameter("rough_tex", tex.call(int(m["rmap"])))
			sm.set_shader_parameter("albedo", base)
			sm.set_shader_parameter("roughness_k", float(m["r"]))
			sm.set_shader_parameter("normal_depth", float(m["ns"]))
			var rep: Array = m["rep"]
			sm.set_shader_parameter("uv_scale", Vector2(float(rep[0]), float(rep[1])))
			var G: Dictionary = Config.at("graphics.ground")
			var P: Dictionary = G["puddle"]
			sm.set_shader_parameter("puddle", Vector4(float(P["from"]), float(P["to"]), float(P["reflect"]), float(P["darken"])))
			sm.set_shader_parameter("apron_total", float(G["apron"]) + float(G["kerb"]) + float(G["gutter"]))
			var meta := GfxAssets.meta()
			if not meta.is_empty():
				sm.set_shader_parameter("sdf_tex", GfxAssets.texture("ground_sdf.png", false))
				sm.set_shader_parameter("noise_tex", GfxAssets.texture("ground_noise.png"))
				var o: Array = meta["sdf_origin"]
				var s: Array = meta["sdf_size"]
				sm.set_shader_parameter("sdf_origin", Vector2(float(o[0]), float(o[1])))
				sm.set_shader_parameter("sdf_size", Vector2(float(s[0]), float(s[1])))
				sm.set_shader_parameter("sdf_min", float(meta["sdf_min"]))
				sm.set_shader_parameter("sdf_range", float(meta["sdf_range"]))
			else:
				sm.set_shader_parameter("quality", 0.0)
		"water":
			sm.shader = WATER
			sm.set_shader_parameter("normal_tex", tex.call(int(m["nmap"])))
			sm.set_shader_parameter("albedo", base)
			sm.set_shader_parameter("roughness", float(m["r"]))
			sm.set_shader_parameter("metallic", float(m["m"]))
			sm.set_shader_parameter("normal_depth", float(m["ns"]))
			sm.set_shader_parameter("uv_repeat", float((m["rep"] as Array)[0]))
		"facade":
			sm.shader = FACADE
			sm.set_shader_parameter("albedo_tex", tex.call(int(m["map"])))
			sm.set_shader_parameter("emission_tex", tex.call(int(m["emap"])))
			var d := GfxAssets.texture("arch_detail.png")
			sm.set_shader_parameter("detail_tex", d)
			sm.set_shader_parameter("detail_k", 1.0 if d != null else 0.0)
			sm.set_shader_parameter("albedo", base)
			sm.set_shader_parameter("emission_color", Config.color(int(m["e"])))
			sm.set_shader_parameter("emission_energy", float(m["ei"]))
			sm.set_shader_parameter("roughness", float(m["r"]))
			sm.set_shader_parameter("metallic", float(m["m"]))
			var rep: Array = m["rep"]
			var off: Array = m["off"]
			sm.set_shader_parameter("uv_scale", Vector2(float(rep[0]), float(rep[1])))
			sm.set_shader_parameter("uv_offset", Vector2(float(off[0]), float(off[1])))
		"foliage":
			sm.shader = FOLIAGE
			sm.set_shader_parameter("albedo_tex", tex.call(int(m["map"])))
			sm.set_shader_parameter("albedo", base)
			sm.set_shader_parameter("roughness", float(m["r"]))
			sm.set_shader_parameter("alpha_cut", float(m["at"]))
			sm.set_shader_parameter("sway", float(Config.at("graphics.trees.sway")))
	return sm
