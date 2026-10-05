class_name Coords
extends RefCounted
## Conversions between the original engine's coordinate conventions and Godot.
##
## The 1999 engine renders through Direct3D 6 in a left-handed space (+Y up).
## Godot is right-handed, so the port mirrors the Z axis. Physics behaves the
## same in the mirrored space, so all constants are kept verbatim.
##
## Helper points (START, DIA, ROU=, lights...) are stored by MAKEMAP with their
## Y and Z components swapped relative to mesh vertices.


## Mesh vertex / pivot / velocity: Direct3D -> Godot.
static func from_d3d(v: Vector3) -> Vector3:
	return Vector3(v.x, v.y, -v.z)


## Godot -> Direct3D (used when writing replays in the original format).
static func to_d3d(v: Vector3) -> Vector3:
	return Vector3(v.x, v.y, -v.z)


## Helper point position as stored in a .3DO point record -> Godot.
static func from_point(p: Vector3) -> Vector3:
	return Vector3(p.x, p.z, -p.y)


## Object orientation. [param angles] uses the original engine's semantics
## (radians around the D3D X, Y and Z axes, applied Z first, then X, then Y).
static func rotation_basis(angles: Vector3) -> Basis:
	if angles == Vector3.ZERO:
		return Basis.IDENTITY
	return Basis(Vector3.UP, -angles.y) * Basis(Vector3.RIGHT, -angles.x) * Basis(Vector3.BACK, angles.z)
