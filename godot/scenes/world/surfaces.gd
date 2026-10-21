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
## v0.24.1 : matériaux PBR des façades (godot/assets/pbr/, tools/pack-pbr.py ; a : détail d'albédo, m : normale RG + rugosité + AO ; VRAM compressés à l'import)
const PBR_PLASTER_A := preload("res://assets/pbr/wall_plaster/a.png")
const PBR_PLASTER_M := preload("res://assets/pbr/wall_plaster/m.png")
const PBR_STONE_A := preload("res://assets/pbr/wall_stone/a.png")
const PBR_STONE_M := preload("res://assets/pbr/wall_stone/m.png")
const PBR_TIMBER_A := preload("res://assets/pbr/wall_timber_plaster/a.png")
const PBR_TIMBER_M := preload("res://assets/pbr/wall_timber_plaster/m.png")
const PBR_STUCCO_A := preload("res://assets/pbr/wall_stucco/a.png")
const PBR_STUCCO_M := preload("res://assets/pbr/wall_stucco/m.png")
const PBR_WOOD_A := preload("res://assets/pbr/wood_beam/a.png")
const PBR_WOOD_M := preload("res://assets/pbr/wood_beam/m.png")

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

static func make(k: String, m: Dictionary, tex: Callable, rel: Callable = Callable()) -> ShaderMaterial:
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
			sm.set_shader_parameter("albedo", base)   # (v0.22.1 : relief des vagues calculé dans le shader, la normale cuite du JS et sa rugosité 0,08 ne servent plus)
			sm.set_shader_parameter("metallic", float(m["m"]))
			sm.set_shader_parameter("normal_depth", float(m["ns"]))
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
			_facade_pbr(sm, m, tex, rel)
		"foliage":
			sm.shader = FOLIAGE
			sm.set_shader_parameter("albedo_tex", tex.call(int(m["map"])))
			sm.set_shader_parameter("albedo", base)
			sm.set_shader_parameter("roughness", float(m["r"]))
			sm.set_shader_parameter("alpha_cut", float(m["at"]))
			sm.set_shader_parameter("sway", float(Config.at("graphics.trees.sway")))
	return sm

## Style de la façade d'après son rang de profondeur (architecture.js RANK + variante + 1 ; +0,5 pour la tuile voisine) : plaster 1-4, timber 5-7, sandstone 8-10, modern 11,
## gothic 12, shop 13-18, dormer 19, floodlit 23.
static func facade_style(rank: float) -> String:
	var r := int(floor(rank))
	if r >= 1 and r <= 4:
		return "plaster"
	if r >= 5 and r <= 7:
		return "timber"
	if r >= 8 and r <= 10:
		return "sandstone"
	if r == 11:
		return "modern"
	if r == 12 or r == 23:
		return "gothic"
	if r >= 13 and r <= 18:
		return "shop"
	if r == 19:
		return "dormer"
	return ""

static func _facade_pbr(sm: ShaderMaterial, m: Dictionary, tex: Callable, rel: Callable) -> void:
	var bi := int(m["bmap"]) if m.has("bmap") else -1
	var style := facade_style(float(m["rank"])) if m.has("rank") else ""
	if bi < 0 or style == "" or not rel.is_valid() or "--dbg-nopbr" in OS.get_cmdline_user_args():
		return
	var bump: Texture2D = tex.call(bi)
	var relief: Texture2D = rel.call(bi)
	if bump == null or relief == null:
		return
	sm.set_shader_parameter("bump_tex", bump)
	sm.set_shader_parameter("relief_tex", relief)
	sm.set_shader_parameter("wood_a", PBR_WOOD_A)
	sm.set_shader_parameter("wood_m", PBR_WOOD_M)
	sm.set_shader_parameter("trim_wood", 1.0 if style == "timber" else 0.0)
	match style:
		"plaster", "dormer":
			sm.set_shader_parameter("wall_a", PBR_PLASTER_A)
			sm.set_shader_parameter("wall_m", PBR_PLASTER_M)
			sm.set_shader_parameter("wall_scale", 1.6)
			sm.set_shader_parameter("wall_amt", 0.75)
		"timber":
			sm.set_shader_parameter("wall_a", PBR_TIMBER_A)
			sm.set_shader_parameter("wall_m", PBR_TIMBER_M)
			sm.set_shader_parameter("wall_scale", 1.2)
			sm.set_shader_parameter("wall_amt", 0.8)
		"modern":
			sm.set_shader_parameter("wall_a", PBR_STUCCO_A)
			sm.set_shader_parameter("wall_m", PBR_STUCCO_M)
			sm.set_shader_parameter("wall_scale", 2.0)
			sm.set_shader_parameter("wall_amt", 0.6)
		_:   # sandstone, gothic, shop (trumeaux de pierre) : grès
			sm.set_shader_parameter("wall_a", PBR_STONE_A)
			sm.set_shader_parameter("wall_m", PBR_STONE_M)
			sm.set_shader_parameter("wall_scale", 2.4)
			sm.set_shader_parameter("wall_amt", 0.9)
	sm.set_shader_parameter("pbr_k", 1.0)
