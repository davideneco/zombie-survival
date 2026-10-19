extends SceneTree
## Mesure les boîtes de touche des modèles de zombies animés (tête = crâne dessiné, corps = sommets habillés hors tête) sur les animations
## d'une variante, en mètres natifs du modèle (pieds à y = 0, face vers +Z). Sert à écrire "hit" dans data/zombie_models.json.
## Usage : godot --headless --path godot -s ../tools/measure-zombie-hit.gd > mesure.txt ; python3 tools/zombie-hit-merge.py mesure.txt
## (la ligne HITJSON est fusionnée par le script Python dans data/zombie_models.json, clé "hit" de chaque modèle).
const Models := preload("res://scenes/zombie_models.gd")

var _frame := 0

func _process(_dt: float) -> bool:
	_frame += 1
	if _frame < 3:
		return false
	var wanted: Array = OS.get_cmdline_user_args()
	var out := {}
	for model in ["basic", "chubby", "arm"]:
		if not wanted.is_empty() and not (model in wanted):
			continue
		out[model] = _measure(model)
	print("HITJSON ", JSON.stringify(out))
	return true

func _measure(model: String) -> Dictionary:
	var rig := Models.acquire(model, false)
	var holder := Node3D.new()
	root.add_child(holder)
	holder.add_child(rig.root)
	rig.ap.playback_default_blend_time = 0.0
	var skull: MeshInstance3D = null
	for m in rig.heads:
		if String(m.name) == "Head_Skull":
			skull = m
	var sa: AABB = skull.mesh.get_aabb()
	var hb := rig.skel.find_bone("Head")
	var rest_inv: Transform3D = rig.skel.get_bone_global_rest(hb).affine_inverse()
	var res := {}
	for an in rig.ap.get_animation_list():
		if an == "Death":
			continue   # mort : plus ciblable
		rig.ap.play(an)
		var len := rig.ap.get_animation(an).length
		var hc := []
		var xs: PackedFloat32Array = []
		var ys: PackedFloat32Array = []
		var zs: PackedFloat32Array = []
		for i in 8:
			rig.ap.seek(len * i / 8.0, true)
			rig.ap.advance(0.0)
			rig.skel.force_update_all_bone_transforms()
			var pose: Transform3D = rig.skel.get_bone_global_pose(hb) * rest_inv
			hc.append(pose * sa.get_center())
			for mi in rig.meshes:
				if mi.mesh == null or String(mi.name).begins_with("Head_") or mi.get_parent() != rig.skel and mi.skin == null:
					continue
				_skin_verts(rig, mi, xs, ys, zs)
		xs.sort()
		ys.sort()
		zs.sort()
		var n := xs.size()
		var mean := Vector3.ZERO
		var cmin := Vector3(1e9, 1e9, 1e9)
		var cmax := Vector3(-1e9, -1e9, -1e9)
		for c: Vector3 in hc:
			mean += c / hc.size()
			cmin = cmin.min(c)
			cmax = cmax.max(c)
		# tête : sphère au centre moyen du crâne dessiné, rayon = 85 % du demi-diamètre moyen + 25 % du battement (la sim n'a pas d'animation : on couvre le va-et-vient)
		var rng_max := maxf(cmax.y - cmin.y, cmax.z - cmin.z)
		var hr := 0.5 * (sa.size.x + sa.size.y + sa.size.z) / 3.0 * 0.85 + 0.25 * rng_max
		var lo := Vector3(xs[int(n * 0.03)], maxf(0.0, ys[int(n * 0.01)]), zs[int(n * 0.03)])
		var hi := Vector3(xs[int(n * 0.97)], ys[int(n * 0.99)], zs[int(n * 0.97)])
		res[an] = {
			"hc": _v3(mean), "hr": snappedf(hr, 0.001),
			"bc": _v3((lo + hi) * 0.5), "bh": _v3((hi - lo) * 0.5),
		}
	holder.queue_free()
	Models.release(rig)
	return res

func _v3(v: Vector3) -> Array:
	return [snappedf(v.x, 0.001), snappedf(v.y, 0.001), snappedf(v.z, 0.001)]

## Sommets habillés (CPU) d'un maillage dans le repère du modèle.
func _skin_verts(rig, mi: MeshInstance3D, xs: PackedFloat32Array, ys: PackedFloat32Array, zs: PackedFloat32Array) -> void:
	var skin: Skin = mi.skin
	var to_model: Transform3D = rig.root.global_transform.affine_inverse() * mi.global_transform
	for s in mi.mesh.get_surface_count():
		var arr := mi.mesh.surface_get_arrays(s)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var bones = arr[Mesh.ARRAY_BONES]
		var weights = arr[Mesh.ARRAY_WEIGHTS]
		for i in v.size():
			var p := Vector3.ZERO
			if bones == null or skin == null:
				p = to_model * v[i]
			else:
				var wsum := 0.0
				for k in 4:
					var w: float = weights[i * 4 + k]
					if w <= 0.0:
						continue
					var bi: int = bones[i * 4 + k]
					var bone_idx: int = rig.skel.find_bone(skin.get_bind_name(bi)) if skin.get_bind_name(bi) != "" else skin.get_bind_bone(bi)
					var xf: Transform3D = rig.skel.get_bone_global_pose(bone_idx) * skin.get_bind_pose(bi)
					p += (xf * v[i]) * w
					wsum += w
				if wsum > 0.0:
					p /= wsum
			xs.append(p.x)
			ys.append(p.y)
			zs.append(p.z)
