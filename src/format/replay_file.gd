class_name ReplayFile
extends RefCounted
## Original replay format (.rep): int32 frame count followed by one 28 byte
## record per 16 ms simulation tick:
##   float pos[3], float vel[3] (Direct3D space), uint8 action key, 3 pad bytes.
## Best times (.rec) are 7 bytes: int32 milliseconds + 3 initials.

const RECORD_SIZE := 28

var positions := PackedVector3Array()  ## Godot space
var velocities := PackedVector3Array()  ## Godot space
var actions := PackedByteArray()


func size() -> int:
	return positions.size()


func append(pos: Vector3, vel: Vector3, action: bool) -> void:
	positions.append(pos)
	velocities.append(vel)
	actions.append(1 if action else 0)


func clear() -> void:
	positions.clear()
	velocities.clear()
	actions.clear()


static func load_file(path: String) -> ReplayFile:
	var b := FileAccess.get_file_as_bytes(path)
	if b.size() < 4:
		return null
	var count := b.decode_s32(0)
	if count < 0 or 4 + count * RECORD_SIZE > b.size():
		push_warning("Replay %s is truncated" % path)
		count = maxi(0, (b.size() - 4) / RECORD_SIZE)
	var r := ReplayFile.new()
	var p := 4
	for i in count:
		r.positions.append(Coords.from_d3d(Vector3(b.decode_float(p), b.decode_float(p + 4), b.decode_float(p + 8))))
		r.velocities.append(Coords.from_d3d(Vector3(b.decode_float(p + 12), b.decode_float(p + 16), b.decode_float(p + 20))))
		r.actions.append(b[p + 24])
		p += RECORD_SIZE
	return r


func save_file(path: String) -> Error:
	var b := PackedByteArray()
	b.resize(4 + size() * RECORD_SIZE)
	b.encode_s32(0, size())
	var p := 4
	for i in size():
		var pos := Coords.to_d3d(positions[i])
		var vel := Coords.to_d3d(velocities[i])
		b.encode_float(p, pos.x)
		b.encode_float(p + 4, pos.y)
		b.encode_float(p + 8, pos.z)
		b.encode_float(p + 12, vel.x)
		b.encode_float(p + 16, vel.y)
		b.encode_float(p + 20, vel.z)
		b[p + 24] = actions[i]
		p += RECORD_SIZE
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	f.store_buffer(b)
	return OK


## Returns {"time_ms": int, "name": String} or an empty dictionary.
static func load_record(path: String) -> Dictionary:
	var b := FileAccess.get_file_as_bytes(path)
	if b.size() < 7:
		return {}
	return {"time_ms": b.decode_s32(0), "name": b.slice(4, 7).get_string_from_ascii()}
