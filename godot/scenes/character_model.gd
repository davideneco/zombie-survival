class_name CharacterModel
extends Node3D
## v0.21.0 : modèle 3D d'un personnage jouable (assets/characters/<id>.glb, fabriqué par tools/build-characters.py, voir assets/characters/LICENSE.txt).
## Squelette humanoïde commun (mêmes noms d'os pour les 8) et animations : Idle, Walk, Run, Sit_Moto, Sit_Bike, Sit_Tram, Sit_Tram_Drive, Death.
## Repère du modèle : pieds à y = 0, face vers +Z (comme les zombies). Pour une moto ou une rame (avant = -Z), tourner le noeud de PI.
## Un même noeud sert au menu (aperçu qui tourne), à la vue externe du joueur (moto, vélo, rame) et, plus tard, à l'affichage d'un coéquipier (multijoueur) :
##   var m := CharacterModel.create("lea"); parent.add_child(m); m.play("Walk")
## Le chargement est paresseux : un .glb n'est lu qu'à la première demande de ce personnage (aucun n'est chargé au titre, hors aperçu du menu) ; `purge_except`
## libère les autres. Aucune lecture de la simulation.

const DIR := "res://assets/characters/"
const IDS := ["marc", "lea", "karim", "chloe", "lucian", "picsou", "klukai", "harry"]
const ANIMS := ["Idle", "Walk", "Run", "Sit_Moto", "Sit_Bike", "Sit_Tram", "Sit_Tram_Drive", "Death"]
const ONE_SHOT := ["Death"]
const BONES := ["Root", "Hips", "Abdomen", "Torso", "Neck", "Head", "Shoulder.L", "UpperArm.L", "LowerArm.L", "Shoulder.R", "UpperArm.R", "LowerArm.R",
	"UpperLeg.L", "LowerLeg.L", "Foot.L", "UpperLeg.R", "LowerLeg.R", "Foot.R"]
## Couleurs de la vue à la première personne (mains et manches de hands_rig.gd) : gant, manche, poignet. Reprennent `fp` de CHARACTERS (src/characters.js)
## et les matériaux du modèle (un test les compare).
const OUTFIT := {
	"marc": {"glove": "1c1c1e", "sleeve": "4a5530", "cuff": "262c1a"},
	"lea": {"glove": "4aa8e0", "sleeve": "dfe6ee", "cuff": "2c6a90"},
	"karim": {"glove": "2a2a2e", "sleeve": "d8541a", "cuff": "2a2a2e"},
	"chloe": {"glove": "e0d0b8", "sleeve": "b8283c", "cuff": "8a1c2c"},
	"lucian": {"glove": "24242a", "sleeve": "16161c", "cuff": "e8e8ee"},
	"picsou": {"glove": "f6f4ee", "sleeve": "b02020", "cuff": "f6f4ee"},
	"klukai": {"glove": "141418", "sleeve": "6a3a9a", "cuff": "3ac8ff"},
	"harry": {"glove": "f0cfb4", "sleeve": "1b1f33", "cuff": "e0b040"},
}

static var _scenes: Dictionary = {}     ## id -> PackedScene
static var _prepped: Dictionary = {}    ## id -> true (boucles posées)

var id := ""
var skeleton: Skeleton3D
var player: AnimationPlayer
var model: Node3D
var current := ""
var seated := false

static func ids() -> Array:
	return IDS

static func path_of(cid: String) -> String:
	return DIR + cid + ".glb"

static func exists(cid: String) -> bool:
	return ResourceLoader.exists(path_of(cid))

static func is_loaded(cid: String) -> bool:
	return _scenes.has(cid)

static func loaded_count() -> int:
	return _scenes.size()

static func scene_of(cid: String) -> PackedScene:
	if not _scenes.has(cid):
		_scenes[cid] = load(path_of(cid)) as PackedScene
	return _scenes[cid]

## Libère les modèles chargés sauf `keep` ("" : tous).
static func purge_except(keep: String) -> void:
	for k in _scenes.keys():
		if k != keep:
			_scenes.erase(k)
			_prepped.erase(k)

static func outfit(cid: String) -> Dictionary:
	var o: Dictionary = OUTFIT.get(cid, OUTFIT["marc"])
	return {"glove": Color(String(o["glove"])), "sleeve": Color(String(o["sleeve"])), "cuff": Color(String(o["cuff"]))}

## Une instance prête à poser (null si le modèle manque : l'appelant garde alors son repli).
static func create(cid: String) -> CharacterModel:
	if not exists(cid):
		return null
	var ps := scene_of(cid)
	if ps == null:
		return null
	var m := CharacterModel.new()
	m.id = cid
	m.name = "Character_" + cid
	m.model = ps.instantiate() as Node3D
	m.add_child(m.model)
	m.skeleton = _find(m.model, "Skeleton3D") as Skeleton3D
	m.player = _find(m.model, "AnimationPlayer") as AnimationPlayer
	if m.player != null and not _prepped.has(cid):
		_prepped[cid] = true
		for n in m.player.get_animation_list():
			var a := m.player.get_animation(n)
			a.loop_mode = Animation.LOOP_NONE if n in ONE_SHOT else Animation.LOOP_LINEAR
	return m

static func _find(n: Node, cls: String) -> Node:
	if n.is_class(cls):
		return n
	for c in n.get_children():
		var r := _find(c, cls)
		if r != null:
			return r
	return null

func play(anim: String, speed := 1.0, blend := 0.18) -> void:
	if player == null or not player.has_animation(anim):
		return
	if current == anim:
		player.speed_scale = speed
		return
	current = anim
	player.play(anim, blend, speed)
	seated = anim.begins_with("Sit_")
	set_props_visible(not seated)

## Les accessoires tenus à la main (canne, baguette : noeuds « Prop_* ») sont cachés assis.
func set_props_visible(on: bool) -> void:
	for c in _meshes():
		if c.name.begins_with("Prop_"):
			c.visible = on

func _meshes() -> Array:
	var out: Array = []
	_collect(model, out)
	return out

static func _collect(n: Node, out: Array) -> void:
	if n is MeshInstance3D:
		out.append(n)
	for c in n.get_children():
		_collect(c, out)

## Pose le modèle à la date t de l'animation (captures, tests) et le fige.
func pose(anim: String, t: float) -> void:
	if player == null or not player.has_animation(anim):
		return
	play(anim)
	player.speed_scale = 0.0
	player.seek(t, true)

## { tris, surfaces, meshes } du modèle (budget : 4 à 8 k triangles).
func stats() -> Dictionary:
	var tris := 0
	var surfaces := 0
	var meshes := _meshes()
	for mi: MeshInstance3D in meshes:
		var mesh := mi.mesh
		for s in mesh.get_surface_count():
			surfaces += 1
			var arr := mesh.surface_get_arrays(s)
			var idx = arr[Mesh.ARRAY_INDEX]
			tris += (idx.size() if idx != null else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return {"tris": tris, "surfaces": surfaces, "meshes": meshes.size()}

## Teinte les matériaux de rendu dans la couche de vue (`layers`) : les captures de première personne n'en ont pas besoin ; sert à l'aperçu du menu.
func set_layers(mask: int) -> void:
	for mi: MeshInstance3D in _meshes():
		mi.layers = mask
