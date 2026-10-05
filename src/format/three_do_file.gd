class_name ThreeDoFile
extends RefCounted
## Reader for the ".3DO" format written by MAKEMAP.EXE for Sebastian
## Aaltonen's "3D-engine v4.0" (used by I've got some BALLS, 1999).
##
## Layout (little endian):
##   header   : float version (>= 4.0), int32 object_count, int32 material_count,
##              int32 point_count, char[20] background bitmap
##   objects  : object_count x { header[0x218C], uv[n_uv] (2 x f32),
##              vertex[n_vert] (3 x f32), face[n_face] (7 x i32) }
##   points   : point_count x record[0x8E]  (lights, helpers, route points ...)
##
## Values are exposed exactly as stored in the file ("raw"). Conversion to the
## Godot coordinate system is done by [Coords].

const OBJECT_HEADER_SIZE := 0x218C
const POINT_RECORD_SIZE := 0x8E
const MIN_VERSION := 4.0

enum PointType { LIGHT = 1, DIRECTIONAL_LIGHT = 2, HELPER = 9, HELPER_ALT = 99 }


class MeshObject:
	extends RefCounted
	var name: String
	## Pivot (rotation centre / position) in raw vertex space.
	var pivot: Vector3
	## Rotation speeds from the ROX=/ROY=/ROZ= name tags.
	var spin := Vector3i.ZERO
	var material_index: int
	## SP? tag: 0 = solid, 1 = NOCOL, 2..6 = colour gates.
	var special: int
	## MOV=XXYY / SPD=? tags.
	var route: int
	var route_point: int
	var route_speed: int
	## ADS=/ADs= velocity boost (raw, see BallWorld for how it is applied).
	var boost: Vector3
	## Material.
	var blend_mode: int  ## 1 = normal, 2 = additive
	var transparency: float
	var self_illumination: float
	var two_sided: bool
	var diffuse: Color
	var ambient: Color
	var texture: String
	## Geometry, absolute raw coordinates.
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	## 7 ints per face: v0, v1, v2, uv0, uv1, uv2, smooth flag.
	var faces := PackedInt32Array()

	func face_count() -> int:
		return faces.size() / 7


class PointRecord:
	extends RefCounted
	var name: String
	var type: int
	## Position as stored. NOTE: stored as (x, z, y) relative to vertex space.
	var position: Vector3
	var color: Color
	var light_range: int
	var glow: float
	## MOV=/SPD= tags (moving lights / diamonds).
	var route: int
	var route_point: int
	var route_speed: int
	## ROU=XXYY, RWT=?, RSP=? and route point angles (degrees).
	var route_id: int
	var route_index: int
	var route_wait: int
	var route_speed_percent: int
	var route_angles := Vector3i.ZERO

	func is_light() -> bool:
		return type == PointType.LIGHT or type == PointType.DIRECTIONAL_LIGHT

	func is_helper() -> bool:
		return not is_light() and type > 0


var version: float
var material_count: int
var background: String
var objects: Array[MeshObject] = []
var points: Array[PointRecord] = []


static func load_file(path: String) -> ThreeDoFile:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		push_error("3DO: cannot read %s (%s)" % [path, error_string(FileAccess.get_open_error())])
		return null
	return parse(bytes, path)


static func parse(bytes: PackedByteArray, source := "<memory>") -> ThreeDoFile:
	var file := ThreeDoFile.new()
	if bytes.size() < 36:
		push_error("3DO: %s is truncated" % source)
		return null
	file.version = bytes.decode_float(0)
	if file.version < MIN_VERSION:
		push_error("3DO: %s has version %.1f, need at least %.1f" % [source, file.version, MIN_VERSION])
		return null
	var object_count := bytes.decode_s32(4)
	file.material_count = bytes.decode_s32(8)
	var point_count := bytes.decode_s32(12)
	file.background = _cstring(bytes, 16, 20)

	var p := 36
	for i in object_count:
		if p + OBJECT_HEADER_SIZE > bytes.size():
			push_error("3DO: %s object %d is truncated" % [source, i])
			return null
		var obj := _read_object_header(bytes, p)
		var vert_count := bytes.decode_s32(p + 0x2C)
		var uv_count := bytes.decode_s32(p + 0x30)
		var face_count := bytes.decode_s32(p + 0x34)
		p += OBJECT_HEADER_SIZE
		var needed := uv_count * 8 + vert_count * 12 + face_count * 28
		if p + needed > bytes.size():
			push_error("3DO: %s object %d geometry is truncated" % [source, i])
			return null
		obj.uvs.resize(uv_count)
		for k in uv_count:
			obj.uvs[k] = Vector2(bytes.decode_float(p), bytes.decode_float(p + 4))
			p += 8
		obj.vertices.resize(vert_count)
		for k in vert_count:
			obj.vertices[k] = Vector3(bytes.decode_float(p), bytes.decode_float(p + 4), bytes.decode_float(p + 8))
			p += 12
		obj.faces.resize(face_count * 7)
		for k in face_count * 7:
			obj.faces[k] = bytes.decode_s32(p)
			p += 4
		file.objects.append(obj)

	for i in point_count:
		if p + POINT_RECORD_SIZE > bytes.size():
			push_error("3DO: %s point %d is truncated" % [source, i])
			return null
		file.points.append(_read_point(bytes, p))
		p += POINT_RECORD_SIZE
	return file


static func _read_object_header(b: PackedByteArray, p: int) -> MeshObject:
	var o := MeshObject.new()
	o.name = _cstring(b, p, 32)
	o.pivot = _vec3(b, p + 0x20)
	o.spin = Vector3i(b.decode_s32(p + 0x38), b.decode_s32(p + 0x3C), b.decode_s32(p + 0x40))
	o.material_index = b.decode_s32(p + 0x44)
	o.special = b.decode_s32(p + 0x48)
	o.route = b.decode_s32(p + 0x4C)
	o.route_point = b.decode_s32(p + 0x50)
	o.route_speed = b.decode_s32(p + 0x54)
	o.boost = _vec3(b, p + 0x74)
	o.blend_mode = b.decode_s32(p + 0x2154)
	o.transparency = b.decode_float(p + 0x2158)
	o.self_illumination = b.decode_float(p + 0x215C)
	o.two_sided = b.decode_s32(p + 0x2160) != 0
	var d := _vec3(b, p + 0x2164)
	o.diffuse = Color(d.x, d.y, d.z)
	var a := _vec3(b, p + 0x2170)
	o.ambient = Color(a.x, a.y, a.z)
	o.texture = _cstring(b, p + 0x2180, 12)
	return o


static func _read_point(b: PackedByteArray, p: int) -> PointRecord:
	var r := PointRecord.new()
	r.name = _cstring(b, p, 32)
	r.type = b.decode_s32(p + 32)
	r.position = _vec3(b, p + 36)
	var c := _vec3(b, p + 48)
	r.color = Color(c.x, c.y, c.z)
	r.light_range = b.decode_s32(p + 84)
	r.glow = b.decode_float(p + 88)
	r.route = b.decode_s32(p + 104)
	r.route_point = b.decode_s32(p + 108)
	r.route_speed = b.decode_s32(p + 112)
	r.route_id = b.decode_s32(p + 116)
	r.route_index = b.decode_s32(p + 120)
	r.route_wait = b.decode_s32(p + 124)
	r.route_speed_percent = b.decode_s32(p + 128)
	# The record is 0x8E bytes long, so only the low half of the last angle exists.
	r.route_angles = Vector3i(b.decode_s32(p + 132), b.decode_s32(p + 136), b.decode_s16(p + 140))
	return r


static func _vec3(b: PackedByteArray, p: int) -> Vector3:
	return Vector3(b.decode_float(p), b.decode_float(p + 4), b.decode_float(p + 8))


static func _cstring(b: PackedByteArray, p: int, max_len: int) -> String:
	var end := p
	while end < p + max_len and b[end] != 0:
		end += 1
	return b.slice(p, end).get_string_from_ascii()
