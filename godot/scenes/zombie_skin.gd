extends RefCounted
## J9 : matériaux de peau des zombies (port de zombieMaterial de src/zombieSkin.js) : un ShaderMaterial par pièce et par zombie (cellule d'atlas, teinte, sang,
## flash de dégât en uniformes), sur DEUX atlas partagés (chair, tissus) et un masque de sang partagé : mémoire constante.

const GfxAssets := preload("res://scenes/gfx_assets.gd")
const SHADER := preload("res://shaders/zombie_skin.gdshader")
const COLS := 4
const ROWS := 3
## CELLS de zombieSkin.js
const FACE := [0, 1, 2, 3]
const SKIN := [4, 5, 6, 7]
const PLAGUE_FACE := 8
const PLAGUE_SKIN := 9
const STONE_FACE := 10
const STONE_SKIN := 11
const SHIRT := [0, 1, 2, 3, 4, 5]
const PANTS := [6, 7, 8, 9]
const STONE_CLOTH := 10
const BURLAP := 11

## cellVec : coin et taille de la cellule dans l'atlas (v vers le haut, comme Three.js).
static func cell_vec(idx: int) -> Vector4:
	return Vector4(float(idx % COLS) / COLS, 1.0 - float(idx / COLS + 1) / ROWS, 1.0 / COLS, 1.0 / ROWS)

static func set_cell(m: ShaderMaterial, idx: int) -> void:
	m.set_shader_parameter("cell", cell_vec(idx))

## atlas : "flesh" ou "cloth".
static func make(atlas: String, cell: int, blood: float, tint: Color, quality: int) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = SHADER
	m.set_shader_parameter("atlas", GfxAssets.texture("zombie_%s.png" % atlas))
	m.set_shader_parameter("blood_mask", GfxAssets.texture("zombie_blood.png"))
	m.set_shader_parameter("cell", cell_vec(cell))
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("blood", blood)
	m.set_shader_parameter("blood_seed", Vector2(randf(), randf()))
	m.set_shader_parameter("bump_on", 0.0 if quality == 0 else 1.0)
	return m
