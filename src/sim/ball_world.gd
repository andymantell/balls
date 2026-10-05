class_name BallWorld
extends RefCounted
## Deterministic simulation of one level, reproducing the 1999 game's ball
## physics tick for tick (reverse engineered from BALLS.EXE v1.02 and checked
## against the original best-time replays).
##
## Runs at a fixed 16 ms tick. Everything is in Godot space (see [Coords]).

signal sound_requested(sound: StringName, volume: float)
signal ball_type_changed(ball_type: int)
signal diamond_collected(index: int, zapped: bool)
signal level_completed
signal ball_lost

const TICK_MSEC := 16
const TICK_SECONDS := 0.016

const GRAVITY := 0.1
const ACCELERATION := 0.1
const DIAGONAL_FACTOR := 0.7
const AIR_DRAG := 0.996
const CONTACT_DRAG := 0.999
const BALL_RADIUS := 10.0
## Collision probe look-ahead in ticks of velocity. v1.0+ uses 1/3; replays
## recorded with pre-release builds need 0.5 (Aug 18 1999) or 0 (Aug 14 1999).
var collision_lookahead := 1.0 / 3.0
const BROADPHASE_MARGIN := 25.0
const MAX_CONTACTS := 50
const BOUNCE_SOFTEN := 0.8
const BOUNCE_SOUND_MIN := 2.0
const BOUNCE_SOUND_MAX := 15.0
const BOOST_SCALE := 0.04
const BOOST_DAMP := 0.86
const RED_MULTIPLIER := 2.0
const JUMP_SPEED := 5.0
const JUMP_COOLDOWN := 60
const GREEN_BRAKE := 0.9
const BLUE_ZAP_RANGE := 150.0
const ZAP_FLASH_TICKS := 20
const DIAMOND_FADE := 0.05
const COLLECT_RADIUS := 23.0  ## (ball bbox 27 + diamond bbox 44) / 3, as in the original
const FALL_LIMIT := 100.0
const CAMERA_DISTANCE := [100.0, 140.0]
const CAMERA_SNAP := [50.0, 70.0]
const CAMERA_HEIGHT := 100.0

enum BallType { NORMAL, RED, YELLOW, BLUE, GREEN }
const TYPE_SOUNDS: Array[StringName] = [&"bnormal", &"bred", &"byellow", &"bblue", &"bgreen"]


class InputState:
	extends RefCounted
	var up := false
	var down := false
	var left := false
	var right := false
	var action := false


class MovingPoint:
	extends RefCounted
	var origin: Vector3
	var position: Vector3
	var prev_position: Vector3
	var route := 0
	var start_point := 0
	var point := 0
	var speed := 0
	var wait := 0

	func reset() -> void:
		position = origin
		prev_position = origin
		point = start_point
		wait = 0


class Diamond:
	extends RefCounted
	var point: MovingPoint
	var fade := 0.0  ## 0 = present, >0 = disappearing
	var alive := true


class Contact:
	extends RefCounted
	var object: SimObject
	var face: int
	var depth: float  ## |t| - radius (negative when penetrating)


## Configuration
var classic_acceleration := true  ## reproduce the original "Right is 0.7x" quirk

## Level content
var objects: Array[SimObject] = []
var routes: RouteTable
var points: Array[MovingPoint] = []  ## one per point record (index aligned)
var diamonds: Array[Diamond] = []
var start_position := Vector3.ZERO

## Ball state
var position := Vector3.ZERO
var prev_position := Vector3.ZERO
var velocity := Vector3.ZERO
var carry := Vector3.ZERO  ## velocity of the platform the ball rests on
var ball_type := BallType.NORMAL
var _prev_ball_type := BallType.NORMAL
var jump_timer := 0
var zap_timer := 0
var zap_target := Vector3.ZERO
var contact_count := 0
var roll_axis_angle := Vector3.ZERO  ## for rendering only

## Camera
var camera_mode := 0
var camera_position := Vector3.ZERO
var prev_camera_position := Vector3.ZERO

## Bookkeeping
var tick := 0
var elapsed_msec := 0
var finished := false
var lost := false


static func from_file(file: ThreeDoFile) -> BallWorld:
	var w := BallWorld.new()
	for m in file.objects:
		w.objects.append(SimObject.from_mesh(m))
	w.routes = RouteTable.from_points(file.points)
	for r in file.points:
		var mp := MovingPoint.new()
		mp.origin = Coords.from_point(r.position)
		mp.route = r.route
		mp.start_point = r.route_point
		mp.speed = r.route_speed
		mp.reset()
		w.points.append(mp)
		if r.is_helper() and r.name.begins_with("START"):
			w.start_position = mp.origin
		elif r.is_helper() and r.name.begins_with("DIA"):
			var d := Diamond.new()
			d.point = mp
			w.diamonds.append(d)
	w.reset()
	return w


func reset() -> void:
	for o in objects:
		o.reset()
	for p in points:
		p.reset()
	for d in diamonds:
		d.fade = 0.0
		d.alive = true
	position = start_position
	prev_position = start_position
	velocity = Vector3.ZERO
	carry = Vector3.ZERO
	ball_type = BallType.NORMAL
	_prev_ball_type = BallType.NORMAL
	jump_timer = 0
	zap_timer = 0
	contact_count = 0
	camera_mode = clampi(camera_mode, 0, 1)
	camera_position = start_position + Vector3(-CAMERA_DISTANCE[0] - 100.0 * camera_mode, CAMERA_HEIGHT, 0.0)
	prev_camera_position = camera_position
	tick = 0
	elapsed_msec = 0
	finished = false
	lost = false


func diamonds_left() -> int:
	var n := 0
	for d in diamonds:
		if d.alive and d.fade == 0.0:
			n += 1
	return n


func diamonds_present() -> int:
	var n := 0
	for d in diamonds:
		if d.alive:
			n += 1
	return n


## Horizontal unit vectors used for steering, derived from the camera.
func steering_axes() -> Array[Vector3]:
	var f := position - camera_position
	f.y = 0.0
	if f.length_squared() < 1e-8:
		f = Vector3.RIGHT
	f = f.normalized()
	return [f, f.cross(Vector3.UP)]


## Advances the simulation by one 16 ms tick.
func step(input: InputState) -> void:
	advance_environment()
	step_ball(input)


## Moves everything that does not depend on the ball: rotating objects,
## objects/lights/diamonds on routes and fading diamonds. The original does the
## rotation at the end of a tick; doing it at the start of the next one is
## equivalent because nothing reads it in between.
func advance_environment() -> void:
	for o in objects:
		o.prev_position = o.position
		o.prev_angles = o.angles
	for p in points:
		p.prev_position = p.position
	if tick > 0:
		_spin_objects()
	_move_objects_along_routes()
	_move_points_along_routes()
	_update_diamond_fades()


## The ball half of a tick. Call [method advance_environment] first.
func step_ball(input: InputState) -> void:
	prev_position = position
	prev_camera_position = camera_position

	_apply_steering(input)
	velocity.y -= GRAVITY
	_apply_ball_type(input)

	position += velocity + carry
	velocity *= AIR_DRAG

	var prev_carry := carry
	carry = Vector3.ZERO
	var contacts := _detect_contacts()
	contact_count = contacts.size()
	if _respond_to_contacts(contacts) <= 0:
		carry = Vector3.ZERO
	velocity += prev_carry - carry

	_collect_diamonds()
	_update_camera()

	tick += 1
	if not finished:
		elapsed_msec += TICK_MSEC
	if not lost and not finished and position.y + FALL_LIMIT <= _lowest_object_point():
		lost = true
		ball_lost.emit()


## Snapshot of everything [method step_ball] mutates (used by tests and tools).
func save_ball_state() -> Array:
	var fades := PackedFloat32Array()
	for d in diamonds:
		fades.append(d.fade)
	return [position, prev_position, velocity, carry, ball_type, _prev_ball_type, jump_timer,
		zap_timer, zap_target, contact_count, camera_position, prev_camera_position, tick,
		elapsed_msec, finished, lost, fades]


func load_ball_state(s: Array) -> void:
	position = s[0]
	prev_position = s[1]
	velocity = s[2]
	carry = s[3]
	ball_type = s[4]
	_prev_ball_type = s[5]
	jump_timer = s[6]
	zap_timer = s[7]
	zap_target = s[8]
	contact_count = s[9]
	camera_position = s[10]
	prev_camera_position = s[11]
	tick = s[12]
	elapsed_msec = s[13]
	finished = s[14]
	lost = s[15]
	var fades: PackedFloat32Array = s[16]
	for i in diamonds.size():
		diamonds[i].fade = fades[i]


func _lowest_object_point() -> float:
	var lowest := INF
	for o in objects:
		lowest = minf(lowest, o.position.y + o.bound_min.y)
	return lowest


func _apply_steering(input: InputState) -> void:
	var factor := 1.0
	if classic_acceleration:
		# BALLS.EXE tests (up && left) || right, so pressing Right alone
		# accelerates at 70%. Verified against the original replays.
		if (input.up and input.left) or input.right:
			factor = DIAGONAL_FACTOR
	elif (input.up or input.down) and (input.left or input.right):
		factor = DIAGONAL_FACTOR
	var amount := ACCELERATION * factor * (RED_MULTIPLIER if ball_type == BallType.RED else 1.0)
	var axes := steering_axes()
	var forward: Vector3 = axes[0]
	var right: Vector3 = axes[1]
	if input.up:
		velocity += forward * amount
	if input.down:
		velocity -= forward * amount
	if input.left:
		velocity -= right * amount
	if input.right:
		velocity += right * amount


func _update_diamond_fades() -> void:
	for d in diamonds:
		if d.alive and d.fade > 0.0:
			d.fade -= DIAMOND_FADE
			if d.fade <= 0.0:
				d.alive = false


func _apply_ball_type(input: InputState) -> void:
	match ball_type:
		BallType.YELLOW:
			if contact_count > 0 and jump_timer == 0 and input.action:
				velocity.y += JUMP_SPEED
				jump_timer = JUMP_COOLDOWN
			if jump_timer > 0:
				jump_timer -= 1
		BallType.BLUE:
			for i in diamonds.size():
				var d := diamonds[i]
				if d.alive and d.fade == 0.0 and position.distance_to(d.point.position) < BLUE_ZAP_RANGE:
					d.fade = 1.0
					zap_target = d.point.position
					zap_timer = ZAP_FLASH_TICKS
					sound_requested.emit(&"thun", 1.0)
					diamond_collected.emit(i, true)
					_check_completion()
			if zap_timer > 0:
				zap_timer -= 1
		BallType.GREEN:
			if input.action:
				velocity *= GREEN_BRAKE
	if ball_type != _prev_ball_type:
		sound_requested.emit(TYPE_SOUNDS[ball_type], 1.0)
		ball_type_changed.emit(ball_type)
	_prev_ball_type = ball_type


func _move_objects_along_routes() -> void:
	for o in objects:
		o.route_velocity = Vector3.ZERO
		if not RouteTable.is_valid_reference(o.route, o.route_point):
			continue
		if o.wait >= 1:
			o.wait -= 1
			continue
		var target := routes.get_point(o.route, o.route_point)
		if target == null:
			continue
		var dist := o.position.distance_to(target.position)
		if dist == 0.0:
			dist = 1.0
		var step_len := 0.01 * o.route_speed * target.speed_percent
		if step_len < dist:
			var delta := (target.position - o.position) * (step_len / dist)
			o.position += delta
			o.route_velocity = delta
			var prev := routes.get_point(o.route, routes.previous_index(o.route, o.route_point))
			if prev != null:
				var seg := prev.position.distance_to(target.position)
				if seg == 0.0:
					seg = 1.0
				var k := o.route_speed / seg
				o.angles = Vector3(
					fposmod(o.angles.x + RouteTable.angle_delta(target.angles.x, prev.angles.x) * -k, TAU),
					fposmod(o.angles.y + RouteTable.angle_delta(target.angles.y, prev.angles.y) * -k, TAU),
					fposmod(o.angles.z + RouteTable.angle_delta(target.angles.z, prev.angles.z) * -k, TAU))
		else:
			o.wait = target.wait
			o.position = target.position
			o.angles = target.angles
			o.route_point = routes.next_index(o.route, o.route_point)
		if o.spin_rate == Vector3.ZERO and o.angles != o.prev_angles:
			o.prev_vertices = o.vertices.duplicate()
			o.apply_rotation()


func _move_points_along_routes() -> void:
	for p in points:
		if not RouteTable.is_valid_reference(p.route, p.point):
			continue
		if p.wait >= 1:
			p.wait -= 1
			continue
		var target := routes.get_point(p.route, p.point)
		if target == null:
			continue
		var dist := p.position.distance_to(target.position)
		if dist == 0.0:
			dist = 1.0
		var step_len := 0.01 * p.speed * target.speed_percent
		if step_len < dist:
			p.position += (target.position - p.position) * (step_len / dist)
		else:
			p.wait = target.wait
			p.position = target.position
			p.point = routes.next_index(p.route, p.point)


func _detect_contacts() -> Array[Contact]:
	var result: Array[Contact] = []
	var probe := position + velocity * collision_lookahead
	var av := velocity.abs()
	var margin := Vector3(BROADPHASE_MARGIN, BROADPHASE_MARGIN, BROADPHASE_MARGIN) + av
	for o in objects:
		var rel := position - o.position
		if rel.x >= o.bound_max.x + margin.x or rel.x <= o.bound_min.x - margin.x:
			continue
		if rel.y >= o.bound_max.y + margin.y or rel.y <= o.bound_min.y - margin.y:
			continue
		if rel.z >= o.bound_max.z + margin.z or rel.z <= o.bound_min.z - margin.z:
			continue
		var lp := probe - o.position
		var verts := o.vertices
		var idx := o.indices
		for f in o.face_count():
			var fmax := o.face_max[f]
			var fmin := o.face_min[f]
			if rel.x >= fmax.x + margin.x or rel.x <= fmin.x - margin.x:
				continue
			if rel.z >= fmax.z + margin.z or rel.z <= fmin.z - margin.z:
				continue
			if rel.y >= fmax.y + margin.y or rel.y <= fmin.y - margin.y:
				continue
			var a := verts[idx[f * 3]]
			var b := verts[idx[f * 3 + 1]]
			var c := verts[idx[f * 3 + 2]]
			# Cast axis aligned lines through the probe: Y first, then X, then Z.
			var t := _axis_hit(lp, 1, a, b, c)
			var limit := maxf(av.y, BALL_RADIUS)
			if is_nan(t) or absf(t) >= limit:
				t = _axis_hit(lp, 0, a, b, c)
				limit = maxf(av.x, BALL_RADIUS)
				if is_nan(t) or absf(t) >= limit:
					t = _axis_hit(lp, 2, a, b, c)
					limit = maxf(av.z, BALL_RADIUS)
					if is_nan(t) or absf(t) >= limit:
						continue
			var contact := Contact.new()
			contact.object = o
			contact.face = f
			contact.depth = absf(t) - BALL_RADIUS
			if result.size() < MAX_CONTACTS:
				result.append(contact)
			else:
				result[MAX_CONTACTS - 1] = contact
	return result


## Signed distance along the given axis from [param p] to triangle ABC, or NAN.
## Equivalent to the original two-sided Moller-Trumbore test with an axis ray.
static func _axis_hit(p: Vector3, axis: int, a: Vector3, b: Vector3, c: Vector3) -> float:
	var u_axis := (axis + 1) % 3
	var v_axis := (axis + 2) % 3
	var e1u := b[u_axis] - a[u_axis]
	var e1v := b[v_axis] - a[v_axis]
	var e2u := c[u_axis] - a[u_axis]
	var e2v := c[v_axis] - a[v_axis]
	var det := e1u * e2v - e1v * e2u
	if absf(det) < 1e-6:
		return NAN
	var su := p[u_axis] - a[u_axis]
	var sv := p[v_axis] - a[v_axis]
	var u := (su * e2v - sv * e2u) / det
	if u < 0.0 or u > 1.0:
		return NAN
	var v := (e1u * sv - e1v * su) / det
	if v < 0.0 or u + v > 1.0:
		return NAN
	var hit := a[axis] + u * (b[axis] - a[axis]) + v * (c[axis] - a[axis])
	return hit - p[axis]


## Applies gate effects and bounces. Returns how many contacts carried the ball.
func _respond_to_contacts(contacts: Array[Contact]) -> int:
	if contacts.is_empty():
		return 0
	# The original only bounces off the deepest solid contact and the deepest
	# contact with an animated (rotating/moving) object.
	var deepest := 0
	var deepest_animated := 0
	for i in contacts.size():
		var c := contacts[i]
		if c.object.special != SimObject.Special.SOLID:
			continue
		if c.depth < contacts[deepest].depth:
			deepest = i
		if c.depth < contacts[deepest_animated].depth and c.object.is_animated():
			deepest_animated = i
	var carried := 0
	for i in contacts.size():
		var c := contacts[i]
		var o := c.object
		var gate := o.gate_ball_type()
		if gate >= 0:
			ball_type = gate
			continue
		if o.special != SimObject.Special.SOLID or (i != deepest and i != deepest_animated):
			continue
		if _carry_from_face(o, c.face):
			carried += 1
		_bounce(o, c)
	return carried


func _carry_from_face(o: SimObject, face: int) -> bool:
	var best := Vector3.ZERO
	for k in 3:
		var vi := o.indices[face * 3 + k]
		var d := o.vertices[vi] - o.prev_vertices[vi]
		for axis in 3:
			if absf(d[axis]) > absf(best[axis]):
				best[axis] = d[axis]
	best += o.route_velocity
	if best == Vector3.ZERO:
		return false
	for axis in 3:
		if absf(best[axis]) > absf(carry[axis]):
			carry[axis] = best[axis]
	return true


func _bounce(o: SimObject, c: Contact) -> void:
	var n := o.normals[c.face]
	var speed := velocity.length()
	if speed > 0.0:
		var dir := velocity / speed
		# Softened reflection: ~0.9 restitution head-on, ~0.6 at grazing angles.
		var k := -sin(BOUNCE_SOFTEN * asin(clampf(n.dot(dir), -1.0, 1.0)))
		var new_velocity := (dir + 2.0 * k * n) * speed
		var impact := minf((velocity - new_velocity).length(), BOUNCE_SOUND_MAX)
		if impact > BOUNCE_SOUND_MIN:
			sound_requested.emit(&"boun", int(impact) * 4 / 63.0)
		velocity = new_velocity
	position -= n * c.depth
	velocity *= CONTACT_DRAG
	var b := o.boost
	if b.x > 0.0 or b.y > 0.0 or b.z > 0.0:
		# ADS= pads. The raw vector is applied as (-x, y, -z) in D3D space.
		velocity = (velocity + Vector3(-b.x, b.y, b.z) * BOOST_SCALE) * BOOST_DAMP


func _collect_diamonds() -> void:
	for i in diamonds.size():
		var d := diamonds[i]
		if d.alive and d.fade == 0.0 and position.distance_to(d.point.position) < COLLECT_RADIUS:
			d.fade = 1.0
			sound_requested.emit(&"dia", 1.0)
			diamond_collected.emit(i, false)
			_check_completion()


func _check_completion() -> void:
	if not finished and diamonds_left() == 0:
		finished = true
		level_completed.emit()


func _update_camera() -> void:
	if camera_mode == 0:
		var flat := Vector2(position.x - camera_position.x, position.z - camera_position.z)
		var d := flat.length()
		if d > CAMERA_SNAP[0]:
			var move := flat / d * (d - CAMERA_DISTANCE[0])
			camera_position.x += move.x
			camera_position.z += move.y
		camera_position.y = position.y + CAMERA_HEIGHT
	else:
		var delta := position - camera_position
		var d := delta.length()
		if d > CAMERA_SNAP[1]:
			camera_position += delta / d * (d - CAMERA_DISTANCE[1])


func _spin_objects() -> void:
	for o in objects:
		if o.spin_rate == Vector3.ZERO:
			continue
		o.prev_vertices = o.vertices.duplicate()
		o.angles += o.spin_rate
		o.apply_rotation()


## Forces the ball state (used for replay playback).
func override_ball(pos: Vector3, vel: Vector3) -> void:
	position = pos
	velocity = vel


## Casts a ray straight down from [param from]; returns {position, normal} or {}.
func ground_below(from: Vector3, max_distance := 2000.0) -> Dictionary:
	var best_t := INF
	var best_n := Vector3.UP
	for o in objects:
		if not o.collides():
			continue
		var rel := from - o.position
		if rel.x < o.bound_min.x or rel.x > o.bound_max.x or rel.z < o.bound_min.z or rel.z > o.bound_max.z:
			continue
		if rel.y < o.bound_min.y:
			continue
		for f in o.face_count():
			var fmin := o.face_min[f]
			var fmax := o.face_max[f]
			if rel.x < fmin.x or rel.x > fmax.x or rel.z < fmin.z or rel.z > fmax.z or rel.y < fmin.y:
				continue
			var t := _axis_hit(rel, 1, o.vertices[o.indices[f * 3]], o.vertices[o.indices[f * 3 + 1]], o.vertices[o.indices[f * 3 + 2]])
			if is_nan(t) or t > 0.0 or -t > max_distance:
				continue
			if -t < best_t:
				best_t = -t
				best_n = o.normals[f]
	if best_t == INF:
		return {}
	return {"position": from - Vector3(0, best_t, 0), "normal": best_n}
