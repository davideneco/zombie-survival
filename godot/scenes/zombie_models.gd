class_name ZombieModels
extends RefCounted
## J16 : modèles animés des zombies (Quaternius « Zombie Apocalypse Kit », CC0 selon la page du pack, voir assets/zombies/LICENSE.txt). Table dans
## data/zombie_models.json (variante -> modèle, échelle, animations par état, teinte). Ce fichier charge la table, fabrique et RECYCLE les instances
## (pool : une instance = squelette + AnimationPlayer + maillages, rendue à sa variante par la vue), crée le matériau partagé et pose l'armure du chevalier.
## Repère des modèles : pieds à y = 0, face vers +Z (comme la vue en primitives : yaw de la simulation inchangé), mètres natifs du pack (x ~1,4 m de haut pour Basic).

const SHADER := preload("res://shaders/zombie_model.gdshader")
const GfxAssets := preload("res://scenes/gfx_assets.gd")
const TABLE_PATH := "res://data/zombie_models.json"
const DIR := "res://assets/zombies/"
const POOL_MAX := 40

static var _table: Dictionary = {}
static var _variants: Dictionary = {}
static var _pool: Dictionary = {}          ## "modèle" ou "modèle+armure" -> [Rig]
static var _prepped: Dictionary = {}       ## modèle -> true (boucles des animations posées)
static var _skin_mat: ShaderMaterial
static var _armor_mat: ShaderMaterial
static var _scenes: Dictionary = {}
static var view_us := 0                    ## --fps : microsecondes cumulées passées dans _process des vues de zombies (les deux vues)
static var created := 0                    ## instances fabriquées depuis le début (tests : le pool recycle)
static var show_boxes := false             ## --show-boxes : affiche les boîtes de touche de la simulation (captures, réglage des échelles)
static var use_old := false                ## --old-zombies : l'ancienne vue en primitives (zombie_view.gd) pour tous les zombies

## Une instance prête à poser : modèle, squelette, lecteur d'animations (avancé à la main par la vue), maillages (corps, tête séparée, armure).
class Rig extends RefCounted:
	var key := ""
	var model := ""
	var armor := false
	var root: Node3D
	var skel: Skeleton3D
	var ap: AnimationPlayer
	var meshes: Array[MeshInstance3D] = []
	var heads: Array[MeshInstance3D] = []
	var armor_nodes: Array[Node3D] = []
	var lens: Dictionary = {}

static func table() -> Dictionary:
	if _table.is_empty():
		var f := FileAccess.open(TABLE_PATH, FileAccess.READ)
		_table = JSON.parse_string(f.get_as_text()) as Dictionary
	return _table

## Variante d'un zombie d'après son état de simulation (un rampant peut apparaître en cours de vie : jambes arrachées).
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

## Variante complète : les champs de « like » complétés par ceux de la variante.
static func variant(key: String) -> Dictionary:
	if _variants.has(key):
		return _variants[key]
	var raw: Dictionary = (table()["variants"] as Dictionary)[key]
	var v: Dictionary = {}
	if raw.has("like"):
		v = (variant(String(raw["like"])) as Dictionary).duplicate(true)
	for k in raw:
		v[k] = raw[k]
	v["anim"] = _merge_anims(raw)
	_variants[key] = v
	return v

static func _merge_anims(raw: Dictionary) -> Dictionary:
	var a: Dictionary = (table()["anims"] as Dictionary).duplicate()
	if raw.has("like"):
		for k in (variant(String(raw["like"])).get("anim", {}) as Dictionary):
			a[k] = variant(String(raw["like"]))["anim"][k]
	if raw.has("anim"):
		for k in raw["anim"]:
			a[k] = raw["anim"][k]
	return a

## Modèle de la variante, compte tenu de l'état : l'armuré qui devient rampant passe sur le modèle qui sait ramper.
static func model_of(v: Dictionary, z: ZombieSim) -> String:
	if z.crawler and v.has("crawl_model"):
		return String(v["crawl_model"])
	return String(v["model"])

static func model_entry(model: String) -> Dictionary:
	return (table()["models"] as Dictionary)[model]

static func _scene(model: String) -> PackedScene:
	if not _scenes.has(model):
		_scenes[model] = load(DIR + String(model_entry(model)["file"])) as PackedScene
	return _scenes[model]

static func skin_material() -> ShaderMaterial:
	if _skin_mat == null:
		_skin_mat = ShaderMaterial.new()
		_skin_mat.shader = SHADER
		_skin_mat.set_shader_parameter("grime", GfxAssets.texture("zombie_blood.png"))
	return _skin_mat

static func armor_material() -> ShaderMaterial:
	if _armor_mat == null:
		_armor_mat = ShaderMaterial.new()
		_armor_mat.shader = SHADER
		_armor_mat.set_shader_parameter("grime", GfxAssets.texture("zombie_blood.png"))
		_armor_mat.set_shader_parameter("use_atlas", 0.0)
		_armor_mat.set_shader_parameter("base_color", Color(0.36, 0.38, 0.42))
		_armor_mat.set_shader_parameter("desat", 0.0)
		_armor_mat.set_shader_parameter("dirt", 0.6)
		_armor_mat.set_shader_parameter("rough", 0.5)
		_armor_mat.set_shader_parameter("metal", 0.75)
	return _armor_mat

## Rend un Rig (recyclé si possible) pour ce modèle, avec ou sans armure.
static func acquire(model: String, armor: bool) -> Rig:
	var k := model + ("+armor" if armor else "")
	var arr: Array = _pool.get(k, [])
	if not arr.is_empty():
		return arr.pop_back()
	return _make(model, armor)

## Remet une instance au pool (la vue la retire de l'arbre elle-même avant de la libérer).
static func release(r: Rig) -> void:
	if r == null:
		return
	if r.root.get_parent() != null:
		r.root.get_parent().remove_child(r.root)
	r.ap.stop()
	for m in r.meshes:
		m.visible = true
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for m in r.heads:
		m.visible = true
	r.root.position = Vector3.ZERO
	r.root.rotation = Vector3.ZERO
	var k := r.model + ("+armor" if r.armor else "")
	if not _pool.has(k):
		_pool[k] = []
	if (_pool[k] as Array).size() >= POOL_MAX:
		r.root.free()
		return
	(_pool[k] as Array).append(r)

## Libère tout le pool (retour au menu : les instances ne sont dans aucun arbre).
static func clear_pool() -> void:
	for k in _pool:
		for r: Rig in _pool[k]:
			if is_instance_valid(r.root):
				r.root.free()
	_pool.clear()

## Prépare n instances par modèle à l'avance (évite l'à-coup à la première apparition).
static func warm(n_basic := 6, n_other := 2) -> void:
	for spec in [["basic", false, n_basic], ["arm", true, n_other], ["chubby", false, n_other]]:
		var made: Array = []
		for i in int(spec[2]):
			made.append(acquire(String(spec[0]), bool(spec[1])))
		for r in made:
			release(r)

static func _make(model: String, armor: bool) -> Rig:
	created += 1
	var r := Rig.new()
	r.model = model
	r.armor = armor
	r.root = _scene(model).instantiate() as Node3D
	r.skel = r.root.find_children("*", "Skeleton3D", true, false)[0]
	r.ap = r.root.find_children("*", "AnimationPlayer", true, false)[0]
	r.ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.ap.playback_default_blend_time = 0.18
	if not _prepped.has(model):
		_prepped[model] = true
		var loops: Array = table()["loops"]
		for an in r.ap.get_animation_list():
			r.ap.get_animation(an).loop_mode = Animation.LOOP_LINEAR if an in loops else Animation.LOOP_NONE
	for an in r.ap.get_animation_list():
		r.lens[an] = r.ap.get_animation(an).length
	for n in r.root.find_children("*", "MeshInstance3D", true, false):
		var m := n as MeshInstance3D
		if skin_material().get_shader_parameter("atlas") == null:   # l'atlas de 512 px est le même dans les trois modèles : pris sur le premier maillage
			var sm := m.mesh.surface_get_material(0) as BaseMaterial3D
			if sm != null:
				skin_material().set_shader_parameter("atlas", sm.albedo_texture)
		m.material_override = skin_material()
		r.meshes.append(m)
		if String(m.name).begins_with("Head_"):
			r.heads.append(m)
	if armor:
		_add_armor(r)
	return r

## Casque (calotte + bord), cuirasse et épaulières fixés aux os par des BoneAttachment3D ; positions déduites du maillage de la tête et des os au repos.
static func _add_armor(r: Rig) -> void:
	var skull: MeshInstance3D = null
	for m in r.heads:
		if String(m.name) == "Head_Skull":
			skull = m
	var mat := armor_material()
	var hb := r.skel.find_bone("Head")
	var tb := r.skel.find_bone("Torso")
	var sb := r.skel.find_bone("Abdomen")
	var sa: AABB = skull.mesh.get_aabb()
	var c := sa.get_center()
	var hr := maxf(sa.size.x, sa.size.z) * 0.5
	# casque : calotte large sur le haut du crâne + bord
	var helm := SphereMesh.new()
	helm.radius = hr * 1.04
	helm.height = hr * 2.08
	helm.radial_segments = 20
	helm.rings = 10
	_attach(r, "Head", helm, Vector3(c.x, sa.position.y + sa.size.y * 0.62, c.z), Vector3(1.0, 0.62, 1.0), mat)
	var brim := CylinderMesh.new()
	brim.top_radius = hr * 1.08
	brim.bottom_radius = hr * 1.2
	brim.height = hr * 0.14
	brim.radial_segments = 20
	_attach(r, "Head", brim, Vector3(c.x, sa.position.y + sa.size.y * 0.5, c.z), Vector3.ONE, mat)
	var crest := BoxMesh.new()
	crest.size = Vector3(hr * 0.12, hr * 0.5, hr * 1.5)
	_attach(r, "Head", crest, Vector3(c.x, sa.position.y + sa.size.y * 0.9, c.z), Vector3.ONE, mat)
	# cuirasse : plastron et dos
	var tp := r.skel.get_bone_global_rest(tb).origin
	var chest := CapsuleMesh.new()
	chest.radius = 0.3
	chest.height = 0.62
	chest.radial_segments = 16
	chest.rings = 6
	_attach(r, "Torso", chest, tp + Vector3(0.0, 0.1, 0.03), Vector3(1.18, 0.78, 0.82), mat)
	var belt := CylinderMesh.new()
	belt.top_radius = 0.33
	belt.bottom_radius = 0.33
	belt.height = 0.09
	var ap := r.skel.get_bone_global_rest(sb).origin
	_attach(r, "Abdomen", belt, ap + Vector3(0.0, 0.02, 0.0), Vector3(1.0, 1.0, 0.8), mat)
	# épaulières
	for side in ["L", "R"]:
		var pad := SphereMesh.new()
		pad.radius = 0.15
		pad.height = 0.24
		var up := r.skel.get_bone_global_rest(r.skel.find_bone("UpperArm." + side)).origin
		_attach(r, "UpperArm." + side, pad, up + Vector3(0.0, 0.03, 0.0), Vector3(1.0, 0.85, 1.0), mat)

static func _attach(r: Rig, bone: String, mesh: Mesh, pos_model: Vector3, sc: Vector3, mat: Material) -> void:
	var ba := BoneAttachment3D.new()
	ba.bone_name = bone
	r.skel.add_child(ba)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	var rest := r.skel.get_bone_global_rest(r.skel.find_bone(bone))
	# position et orientation fixées en repère du modèle au repos, exprimées dans le repère de l'os
	mi.transform = rest.affine_inverse() * Transform3D(Basis.from_scale(sc), pos_model)
	ba.add_child(mi)
	r.meshes.append(mi)
	r.armor_nodes.append(ba)
