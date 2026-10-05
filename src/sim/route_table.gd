class_name RouteTable
extends RefCounted
## Route points ("ROU=XXYY") used by moving objects, lights and diamonds.
## Routes are numbered 1..98 and each holds up to 98 points (index 1..98),
## exactly like the fixed 99 x 99 table of the original engine.

const SIZE := 99
const DEFAULT_SPEED_PERCENT := 100


class RoutePoint:
	extends RefCounted
	var position: Vector3  ## Godot space
	var angles: Vector3  ## radians, original engine semantics
	var wait: int  ## ticks to wait on arrival (RWT=)
	var speed_percent: int  ## RSP= (defaults to 100)


var _routes := {}  ## route id -> Array[RoutePoint] (size SIZE, null = unused)


static func from_points(points: Array[ThreeDoFile.PointRecord]) -> RouteTable:
	var t := RouteTable.new()
	for r in points:
		if r.route_id <= 0 or r.route_id >= SIZE or r.route_index < 0 or r.route_index >= SIZE or r.type <= 0:
			continue
		var rp := RoutePoint.new()
		rp.position = Coords.from_point(r.position)
		rp.angles = Vector3(r.route_angles) * deg_to_rad(1.0)
		rp.wait = r.route_wait
		rp.speed_percent = r.route_speed_percent if r.route_speed_percent != 0 else DEFAULT_SPEED_PERCENT
		if not t._routes.has(r.route_id):
			var arr := []
			arr.resize(SIZE)
			t._routes[r.route_id] = arr
		t._routes[r.route_id][r.route_index] = rp
	return t


static func is_valid_reference(route: int, point: int) -> bool:
	return route > 0 and route < SIZE and point > 0 and point < SIZE


func get_point(route: int, index: int) -> RoutePoint:
	var arr = _routes.get(route)
	if arr == null or index < 0 or index >= SIZE:
		return null
	return arr[index]


## Index of the point after [param index] (wrapping to 1 like the original).
func next_index(route: int, index: int) -> int:
	var n := index + 1
	if n >= SIZE:
		n = 1
	if get_point(route, n) == null:
		n = 1
	return n


## Index of the point before [param index] (wrapping to the last used point).
func previous_index(route: int, index: int) -> int:
	var p := index - 1
	if p >= 1:
		return p
	p = SIZE - 1
	while p > 1 and get_point(route, p) == null:
		p -= 1
	return p


## Shortest signed angle from [param from] to [param to] in the original's quirky form.
static func angle_delta(a: float, b: float) -> float:
	if absf(a - b) < PI:
		return b - a
	if a < b:
		return b - a - TAU
	if b < a:
		return TAU - a + b
	return 0.0
