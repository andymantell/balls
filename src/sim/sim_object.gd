class_name SimObject
extends RefCounted
## Collision/animation state of one mesh object of a level.
## Geometry is kept relative to [member position] (the object's pivot).

const SPIN_SCALE := 0.0032  ## radians per tick per unit of ROX=/ROY=/ROZ=

enum Special { SOLID = 0, NO_COLLISION = 1, GATE_NORMAL = 2, GATE_RED = 3, GATE_YELLOW = 4, GATE_BLUE = 5, GATE_GREEN = 6 }

var name: String
var special: int
var spin_rate := Vector3.ZERO  ## radians per tick (engine semantics)
var boost := Vector3.ZERO  ## raw ADS= value
var route := 0
var start_route_point := 0
var route_point := 0
var route_speed := 0
var wait := 0
var route_velocity := Vector3.ZERO  ## displacement during the current tick

var origin := Vector3.ZERO
var position := Vector3.ZERO
var angles := Vector3.ZERO
var prev_position := Vector3.ZERO
var prev_angles := Vector3.ZERO

var local_vertices := PackedVector3Array()
var vertices := PackedVector3Array()  ## rotated, relative to position
var prev_vertices := PackedVector3Array()
var indices := PackedInt32Array()  ## 3 per face
var local_normals := PackedVector3Array()
var normals := PackedVector3Array()  ## per face, unit length
var face_min := PackedVector3Array()
var face_max := PackedVector3Array()
var bound_min := Vector3.ZERO
var bound_max := Vector3.ZERO
var _applied_angles := Vector3(INF, INF, INF)


static func from_mesh(m: ThreeDoFile.MeshObject) -> SimObject:
	var o := SimObject.new()
	o.name = m.name
	o.special = m.special
	o.spin_rate = Vector3(m.spin) * SPIN_SCALE
	o.boost = m.boost
	o.route = m.route
	o.start_route_point = m.route_point
	o.route_speed = m.route_speed
	o.origin = Coords.from_d3d(m.pivot)
	o.local_vertices.resize(m.vertices.size())
	for i in m.vertices.size():
		o.local_vertices[i] = Coords.from_d3d(m.vertices[i]) - o.origin
	var fc := m.face_count()
	o.indices.resize(fc * 3)
	o.local_normals.resize(fc)
	for f in fc:
		var a := m.faces[f * 7]
		var b := m.faces[f * 7 + 1]
		var c := m.faces[f * 7 + 2]
		o.indices[f * 3] = a
		o.indices[f * 3 + 1] = b
		o.indices[f * 3 + 2] = c
		var va := o.local_vertices[a]
		# The original computes (B-A)x(C-A) in its left-handed space; mirrored
		# into Godot space the physical normal becomes (C-A)x(B-A).
		o.local_normals[f] = (o.local_vertices[c] - va).cross(o.local_vertices[b] - va).normalized()
	o.vertices = o.local_vertices.duplicate()
	o.prev_vertices = o.local_vertices.duplicate()
	o.normals = o.local_normals.duplicate()
	o.face_min.resize(fc)
	o.face_max.resize(fc)
	o.reset()
	return o


func is_animated() -> bool:
	return spin_rate != Vector3.ZERO or route_speed != 0


func collides() -> bool:
	return special != Special.NO_COLLISION


func gate_ball_type() -> int:
	return special - Special.GATE_NORMAL if special >= Special.GATE_NORMAL and special <= Special.GATE_GREEN else -1


func reset() -> void:
	position = origin
	prev_position = origin
	angles = Vector3.ZERO
	prev_angles = Vector3.ZERO
	wait = 0
	route_point = start_route_point
	route_velocity = Vector3.ZERO
	apply_rotation(true)
	prev_vertices = vertices.duplicate()


func face_count() -> int:
	return local_normals.size()


## Recomputes rotated geometry and bounds when the orientation changed.
func apply_rotation(force := false) -> void:
	if not force and angles == _applied_angles:
		return
	_applied_angles = angles
	var basis := Coords.rotation_basis(angles)
	var n := local_vertices.size()
	if n == 0:
		return
	for i in n:
		vertices[i] = basis * local_vertices[i]
	for f in local_normals.size():
		normals[f] = basis * local_normals[f]
	var bmin := Vector3(INF, INF, INF)
	var bmax := -bmin
	for f in local_normals.size():
		var a := vertices[indices[f * 3]]
		var b := vertices[indices[f * 3 + 1]]
		var c := vertices[indices[f * 3 + 2]]
		var fmin := a.min(b).min(c)
		var fmax := a.max(b).max(c)
		face_min[f] = fmin
		face_max[f] = fmax
		bmin = bmin.min(fmin)
		bmax = bmax.max(fmax)
	bound_min = bmin
	bound_max = bmax


func bound_diagonal() -> float:
	return (bound_max - bound_min).length()


## Rendering transform interpolated between the previous and current tick.
func interpolated_transform(alpha: float) -> Transform3D:
	var a := prev_angles.lerp(angles, alpha) if (angles - prev_angles).length() < PI else angles
	return Transform3D(Coords.rotation_basis(a), prev_position.lerp(position, alpha))
