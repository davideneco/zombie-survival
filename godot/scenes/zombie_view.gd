extends Node3D
## Silhouette de zombie faite de primitives (J1 ; les modèles articulés viennent avec le jalon des zombies). Suit un ZombieSim :
## position interpolée entre deux pas physiques, cap, marche (balancement des jambes et des bras tendus), chute à la mort.

const SKIN := Color("7d8f6a")
const SHIRT := Color("5a4a3c")
const PANTS := Color("2f3640")
const DEATH_FALL_TIME := 0.5
const SINK_START := 3.0

var sim: ZombieSim
var _prev_pos := Vector3.ZERO
var _legs: Array[Node3D] = []
var _arms: Array[Node3D] = []
var _body: Node3D

func setup(z: ZombieSim) -> void:
	sim = z
	_prev_pos = z.pos
	position = z.pos
	_body = Node3D.new()
	add_child(_body)
	_part(_body, SphereMesh.new(), Vector3(0, 1.83, 0.04), Vector3(0.4, 0.4, 0.4), SKIN)
	_part(_body, BoxMesh.new(), Vector3(0, 1.3, 0), Vector3(0.5, 0.7, 0.28), SHIRT)
	for sx in [-1.0, 1.0]:
		var leg := Node3D.new()
		leg.position = Vector3(sx * 0.13, 0.9, 0)
		_part(leg, BoxMesh.new(), Vector3(0, -0.45, 0), Vector3(0.2, 0.9, 0.22), PANTS)
		_body.add_child(leg)
		_legs.append(leg)
		var arm := Node3D.new()
		arm.position = Vector3(sx * 0.35, 1.58, 0)
		_part(arm, BoxMesh.new(), Vector3(0, -0.3, 0), Vector3(0.15, 0.62, 0.15), SKIN)
		_body.add_child(arm)
		_arms.append(arm)

func _part(parent: Node3D, mesh: Mesh, pos: Vector3, size: Vector3, color: Color) -> void:
	var m := MeshInstance3D.new()
	if mesh is BoxMesh:
		(mesh as BoxMesh).size = size
	elif mesh is SphereMesh:
		(mesh as SphereMesh).radius = size.x / 2.0
		(mesh as SphereMesh).height = size.y
	m.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.9
	m.material_override = mat
	m.position = pos
	parent.add_child(m)

## Appelé à chaque pas physique avant la simulation : mémorise la position précédente pour l'interpolation.
func remember() -> void:
	_prev_pos = sim.pos

func _process(_dt: float) -> void:
	var f := Engine.get_physics_interpolation_fraction()
	position = _prev_pos.lerp(sim.pos, f)
	rotation.y = sim.yaw
	if sim.dead:
		_body.rotation.x = -deg_to_rad(90.0) * minf(1.0, sim.death_t / DEATH_FALL_TIME)
		_body.position.y = -maxf(0.0, sim.death_t - SINK_START) * 0.8
		return
	var swing := sin(sim.walk_t) * 0.7 if sim.moving else 0.0
	_legs[0].rotation.x = swing
	_legs[1].rotation.x = -swing
	var reach := -1.45 if sim.attack_windup >= 0.0 else -1.2   # bras tendus devant
	_arms[0].rotation.x = reach + swing * 0.15
	_arms[1].rotation.x = reach - swing * 0.15
